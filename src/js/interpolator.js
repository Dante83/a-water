function InterpolationEngine(bucketGrid, kernalConstants, numberOfKernalPoints){
  this.kernalConstants = kernalConstants;
  this.particleConstants = bucketGrid.particleConstants;
  this.bucketGrid = bucketGrid;
  this.parentParticleSystem = bucketGrid.parentParticleSystem;
  var thisInterpolationEngine = this;

  //For logging
  this.logs = {};

  //
  //Construct our lookup tables
  //
  this.distances = new Float32Array(numberOfKernalPoints);
  this.mullerKernalValues = new Float32Array(numberOfKernalPoints);
  this.mullerSpikyKernalFirstDerivatives = new Float32Array(numberOfKernalPoints);
  this.mullerSpikyKernalSecondDerivative = new Float32Array(numberOfKernalPoints);
  this.delta = this.particleConstants.radius / numberOfKernalPoints;
  let kernal = new Kernal(kernalConstants);
  for(let i = 0; i < numberOfKernalPoints; i++){
    let d = this.delta * i;
    kernal.updateKernal(d);
    this.distances[i] = d;
    this.mullerKernalValues[i] = kernal.mullerKernalValue;
    this.mullerSpikyKernalFirstDerivatives[i] = kernal.mullerSpikyKernalFirstDerivative;
    this.mullerSpikyKernalSecondDerivative[i] = kernal.mullerSpikyKernalSecondDerivative;
  }

  //
  //These are used to power up our lookup tables on the fly
  //
  this.isNotZero = true;
  this.kernal_i;
  this.inverseDeltaX = 1.0 / this.delta;
}

InterpolationEngine.prototype.evalFKernalState = function(distance){
  if(distance < this.particleConstants.radius){
    this.isNotZero = true;
    let deltaPercent = distance * this.inverseDeltaX;
    this.kernal_i = Math.floor(deltaPercent);
  }
  else{
    this.isNotZero = false;
  }
};

InterpolationEngine.prototype.evalFMullerKernal = function(distance){
  if(this.isNotZero){
    let i = this.kernal_i;
    let deltaY = this.mullerKernalValues[i + 1] - this.mullerKernalValues[i];
    return deltaY  * this.inverseDeltaX * (distance - this.distances[i]) + this.mullerKernalValues[i];
  }
  return 0.0;
};

InterpolationEngine.prototype.evalFMullerSpikyFirstDerivativeKernal = function(distance){
  if(this.isNotZero){
    let i = this.kernal_i;
    let deltaY = this.mullerSpikyKernalFirstDerivatives[i + 1] - this.mullerSpikyKernalFirstDerivatives[i];
    return deltaY  * this.inverseDeltaX * (distance - this.distances[i]) + this.mullerSpikyKernalFirstDerivatives[i];
  }
  return 0.0;
};

InterpolationEngine.prototype.evalFMullerSpikySecondDerivativeKernal = function(distance){
  if(this.isNotZero){
    let i = this.kernal_i;
    let deltaY = this.mullerSpikyKernalSecondDerivative[i + 1] - this.mullerSpikyKernalSecondDerivative[i];
    return deltaY  * this.inverseDeltaX * (distance - this.distances[i]) + this.mullerSpikyKernalSecondDerivative[i];
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

//logNTimes(name, maxNumLogs, msg)
InterpolationEngine.prototype.logNTimes = function(name, maxNumLogs, msg){
  if(this.logs[name] == null){
    this.logs[name] = 1;
    console.log(msg);
  }
  if(this.logs[name] <= maxNumLogs){
    this.logs[name] += 1;
    console.log(`${name}: ${msg}`);
  }
};
