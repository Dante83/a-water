function InterpolationEngine(bucketGrid, kernalConstants, numberOfKernalPoints){
  this.kernalContants = kernalConstants;
  this.particleConstants = bucketGrid.particleConstants;
  this.bucketGrid = bucketGrid;
  this.parentParticleSystem = bucketGrid.parentParticleSystem;
  var thisInterpolationEngine = this;

  //
  //Construct our lookup tables
  //
  this.distances = new Float32Array(numberOfKernalPoints);
  this.mullerKernalValues = new Float32Array(numberOfKernalPoints);
  this.mullerSpikyKernalFirstDerivatives = new Float32Array(numberOfKernalPoints);
  this.mullerSpikyKernalSecondDerivative = new Float32Array(numberOfKernalPoints);
  this.delta = this.particleConstants.radius / numberOfKernalPoints;
  let kernal = new Kernal(kernalContants);
  for(let i = 0; i < numberOfKernalPoints; i++){
    let d = delta * i;
    kernal.updateKernal(d);
    this.distances[i] = d;
    this.mullerKernalValues[i] = kernal.mullerKernalValue;
    this.mullerSpikyKernalFirstDerivatives[i] = kernal.mullerSpikyKernalFirstDerivative;
    this.mullerSpikyKernalSecondDerivative[i] = kernal.mullerSpikyKernalSecondDerivative;
  }

  //
  //These are used to setup power up our lookup tables on the fly
  //
  this.isNotZero = true;
  this.kernal0i = i;
  this.oneOverDeltaX = 1.0 / this.delta;
  this.xF = null
}

InterpolationEngine.prototype.evalFKernalState = function(distance){
  if(distance < this.particleConstants.particleRadius){
    this.isNotZero = true;
    let deltaPercent = distance / this.delta;
    let i = Math.floor(deltaPercent);
    this.xf = this.distances[i];
  }
  this.isNotZero = false;
};

InterpolationEngine.prototype.evalFMullerKernal = function(distance){
  if(this.isNotZero){
    let deltaY = this.mullerKernalValues[i + 1] - this.mullerKernalValues[i];
    return deltaY  * this.oneOverDeltaX * (distance - this.xf) + this.kernal1.mullerKernalValue;
  }
  return 0.0;
};

InterpolationEngine.prototype.evalFMullerSpikyFirstDerivativeKernal = function(distance){
  if(this.isNotZero){
    let deltaY = this.mullerSpikyKernalFirstDerivatives[i + 1] - this.mullerSpikyKernalFirstDerivatives[i];
    return deltaY  * this.oneOverDeltaX * (distance - this.xf) + this.kernal1.mullerKernalValue;
  }
  return 0.0;
};

InterpolationEngine.prototype.evalFMullerSpikySecondDerivativeKernal = function(distance){
  if(this.isNotZero){
    let deltaY = this.mullerSpikyKernalSecondDerivative[i + 1] - this.mullerSpikyKernalSecondDerivative[i];
    return deltaY  * this.oneOverDeltaX * (distance - this.xf) + this.kernal1.mullerKernalValue;
  }
  return 0.0;
};

InterpolationEngine.prototype.evalFDensityAtOrigin = function(origin, particlesInSearchRadius){
  //Find all neighboring particles and while we're here, get our multiplicative coeficients
  const particleMass = this.particleConstants.mass;
  const particleRadius = this.particleConstants.radius;
  const oneOverRadiusSquared = this.particleConstants.oneOverRadiusSquared;
  let densitySum = 0.0;
  for(let i = 0, numParticlesInNeighborhood = particlesInSearchRadius.length; i < numParticlesInNeighborhood; i++){
    let distance = particlesInSearchRadius[i].distance;
    this.evalFKernalState(distance)
    densitySum += this.evalFMullerKernal(distance);
  }

  return particleMass * densitySum;
};

InterpolationEngine.prototype.interpolate = function(nameOfInterpolatedQuantity, origin, neighboringParticles){
  let sum = 0.0;
  for(let i = 0, numNeighbors = neighboringParticles.length; i < numNeighbors; i++){
    let neighboringParticle = neighboringParticles[i];
    sum += neighboringParticle.distance * (neighboringParticle.particle[nameOfInterpolatedQuantity] / neighboringParticle.density);
  };

  let returnQuantity = this.particleConstants.mass * sum;
  return returnQuantity;
};

InterpolationEngine.prototype.gradient = function(distance, vect2Center){
  return vect2Center.clone().multiplyScalar(-1.0 * this.evalFMullerSpikyFirstDerivativeKernal(distance));
}

InterpolationEngine.prototype.gradientOf = function(nameOfInterpolatedQuantity, interpolatedQuantityAtOrigin, densityAtOrigin, neighboringParticles){
  let interpolatedQuantityAtOrigin = interpolatedQuantityAtOrigin;
  let addativeConst = interpolatedQuantityAtOrigin / (densityAtOrigin * densityAtOrigin);
  let sum = 0.0;
  for(let i = 0, numParticlesInNeighborhood = neighboringParticles.length; i < numParticlesInNeighborhood; i++){
    let neighboringParticleData = neighboringParticles[i];
    let vector2Center = neighboringParticleData.vect2Point.clone().multiplyScalar(-1.0 * this.evalFMullerSpikyFirstDerivativeKernal(neighboringParticleData.distance));

    //Coeficient parameters
    let particle = neighboringParticleData.point;
    sum += (addativeConst + particle.inverseDensitySquared * particle[nameOfInterpolatedQuantity]) * vector2Center;
  };

  return densityAtOrigin * this.particleConstants.mass * sum;
};

InterpolationEngine.prototype.laplacianOf = function(nameOfInterpolatedQuantity, interpolatedQuantityAtOrigin, neighboringParticles){
  let sum = 0.0;
  for(let i = 0, numParticlesInNeighborhood = neighboringParticles.length; i < numParticlesInNeighborhood; i++){
    let neighboringParticle = neighboringParticles[i];
    let particle = neighboringParticle.point;
    let distance = neighboringParticle.distance;
    sum += (particle[nameOfInterpolatedQuantity] - interpolatedQuantityAtOrigin) * this.evalFMullerSpikySecondDerivativeKernal(distance) / particle.density;
  };

  return this.particleConstants.mass * sum;
};

//Unlike the interpolator, we also need to determine a host of properties for each of our particles
//We might as well do these all at once, duplicating information that is re-used on every stage
//in order to minimize the number of operations needed.
InterpolationEngine.prototype.updateParticles = function(){
  let particles = this.bucketGrid.particles;

  //Find all neighboring particles and while we're here, get our multiplicative coeficients
  const particleMass = this.particleConstants.mass;
  const particleRadius = this.particleConstants.radius;
  const oneOverRadiusSquared = this.particleConstants.oneOverRadiusSquared;
  for(let i = 0, numParticles = this.particles.length; i < numParticles; i++){
    let particle = this.particles[i];
    let particlesInSearchRadius = this.bucketGrid.findPointsInSphere(particle.position, particleRadius);
    particle.particlesInNeighborhood = particlesInSearchRadius;
    let densitySum = 0.0;
    for(let j = 0, numParticlesInNeighborhood = particlesInSearchRadius.length; j < numParticlesInNeighborhood; j++){
      let distance = particlesInSearchRadius[j].distance;
      this.evalFKernalState(distance)
      densitySum += this.evalFMullerKernal(distance);
    }
    particle.mullerKernalSum = densitySum;
    particle.density = particleMass * densitySum;
    particle.inverseDensity = 1.0 / particle.density;
    particle.inverseDensitySquared = particle.inverseDensity * particle.inverseDensity;
  }
};
