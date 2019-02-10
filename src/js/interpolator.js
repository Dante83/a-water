function InterpolationEngine(bucketGrid, kernal, kernalConstants, numberOfKernalPoints){
  this.kernalConstants = kernalConstants;
  this.kernal = kernal;
  this.particleConstants = bucketGrid.particleConstants;
  this.bucketGrid = bucketGrid;
  this.parentParticleSystem = bucketGrid.parentParticleSystem;
  var thisInterpolationEngine = this;
}

//
//NOTE: Unused.
//
InterpolationEngine.prototype.evalFDensityAtOrigin = function(origin, particlesInSearchRadius){
  //Find all neighboring particles and while we're here, get our multiplicative coeficients
  const particleMass = this.particleConstants.mass;
  const particleRadius = this.particleConstants.radius;
  const oneOverRadiusSquared = this.particleConstants.oneOverRadiusSquared;
  let densitySum = 0.0;
  for(let i = 0, numParticlesInNeighborhood = particlesInSearchRadius.length; i < numParticlesInNeighborhood; i++){
    let distanceSquared = particlesInSearchRadius[i].distanceSquared;
    densitySum += this.kernal.getMullerKernal(distanceSquared);
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
  return vect2Center.clone().multiplyScalar(-1.0 * this.kernal.mullerSpikyKernalFirstDerivative);
}

//
//NOTE: Both of these don't exist?!
//
// InterpolationEngine.prototype.gradientOf = function(nameOfInterpolatedQuantity, interpolatedQuantityAtOrigin, densityAtOrigin, originParticle, neighboringParticles){
//   let addativeConst = interpolatedQuantityAtOrigin / (densityAtOrigin * densityAtOrigin);
//   let sum = 0.0;
//   for(let i = 0, numParticlesInNeighborhood = neighboringParticles.length; i < numParticlesInNeighborhood; i++){
//     let neighboringParticleData = neighboringParticles[i];
//     let vector2Center = neighboringParticleData.vect2Point.clone().multiplyScalar(-1.0 * originParticle.mullerSpikyKernalFirstDerivative[i]);
//
//     //Coeficient parameters
//     let particle = neighboringParticleData.point;
//     sum += (addativeConst + particle.inverseDensitySquared * particle[nameOfInterpolatedQuantity]) * vector2Center;
//   };
//
//   return densityAtOrigin * this.particleConstants.mass * sum;
// };

// InterpolationEngine.prototype.laplacianOf = function(nameOfInterpolatedQuantity, interpolatedQuantityAtOrigin, originParticle, neighboringParticles){
//   let sum = 0.0;
//   for(let i = 0, numParticlesInNeighborhood = neighboringParticles.length; i < numParticlesInNeighborhood; i++){
//     let neighboringParticle = neighboringParticles[i];
//     let particle = neighboringParticle.point;
//     sum += (particle[nameOfInterpolatedQuantity] - interpolatedQuantityAtOrigin) * originParticle.mullerSpikyKernalFirstDerivative[i] / particle.density;
//   };
//
//   return this.particleConstants.mass * sum;
// };

//Unlike the interpolator, we also need to determine a host of properties for each of our particles
//We might as well do these all at once, duplicating information that is re-used on every stage
//in order to minimize the number of operations needed.
InterpolationEngine.prototype.updateParticles = function(){
  let particles = this.parentParticleSystem.particles;

  //Find all neighboring particles and while we're here, get our multiplicative coeficients
  const particleMass = this.particleConstants.mass;
  const particleRadius = this.particleConstants.radius;
  const oneOverRadiusSquared = this.particleConstants.oneOverRadiusSquared;
  for(let i = 0, numParticles = particles.length; i < numParticles; i++){
    let particle = particles[i];
    particle.updateParticlesInNeighborhood();
    let particlesInSearchRadius = particle.particlesInNeighborhood;
    let densitySum = 0.0;
    for(let j = 0, numParticlesInNeighborhood = particlesInSearchRadius.length; j < numParticlesInNeighborhood; j++){
      let distanceSquared = particlesInSearchRadius[j].distanceSquared;
      densitySum += this.kernal.getMullerKernal(distanceSquared);
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
