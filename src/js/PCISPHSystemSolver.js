function PCISPHSystemSolver(interpolator, PCIConstants, parentParticleSystem){
  this.interpolator = interpolator;
  this.kernal = interpolator.kernal;
  this.parentParticleSystem = parentParticleSystem;
  this.particles = parentParticleSystem.particles;
  this.PCIConstants = PCIConstants;
  this.particleConstants = parentParticleSystem.particleConstants;
  this.gravitationalForce = new THREE.Vector3(0.0,0.0, this.particleConstants.mass * this.PCIConstants.gravity);
  this.logs = [];

  //Debugging variables
  this.debug_enableGravity = true;
  this.debug_enableWindResistance = true;
  this.debug_enableVicosityForces = true;
  this.debug_enablePressureForces = true;
  this.debug_enableCollisions = false;
  this.debug_enablePseudoVisocityFilter = false;
}

PCISPHSystemSolver.prototype.updateForces = function(timeIntervalInSeconds){
  let particles = this.particles;

  //Update the spiky kernal for all neighbors.
  for(let i = 0, numParticles = particles.length; i < numParticles; i++){
    let particle = particles[i];
    let neighboringParticleData = particle.particlesInNeighborhood;
    particle.mullerSpikyKernalFirstDerivative = [];
    particle.mullerSpikyKernalSecondDerivative = [];
    for(let j = 0, numNeighbors = neighboringParticleData.length; j < numNeighbors; j++){
      this.kernal.updateSpikyKernals(neighboringParticleData[j].distance);
      particle.mullerSpikyKernalFirstDerivative.push(this.kernal.mullerSpikyKernalFirstDerivative);
      particle.mullerSpikyKernalSecondDerivative.push(this.kernal.mullerSpikyKernalSecondDerivative);
    }
  }

  //Update the forces for all of our particles
  if(this.debug_enableVicosityForces){
    this.accumulateViscosityForce();
  }
  if(this.debug_enableWindResistance){
    this.calculateWindResistanceForce();
  }
  if(this.debug_enablePressureForces){
    this.accumulatePressureForce(timeIntervalInSeconds);
  }

  //Accumulate the forces for each particle
  for(let i = 0, numParticles = particles.length; i < numParticles; i++){
    let particle = particles[i];
    let force = new THREE.Vector3(0.0, 0.0, 0.0);

    if(this.debug_enableGravity){
      force.add(particle.constants.gravitationalForce);
    }
    if(this.debug_enableVicosityForces){
      force.add(particle.viscocityForce);
    }
    if(this.debug_enableWindResistance){
      force.add(particle.windResistanceForce);
    }
    if(this.debug_enablePressureForces){
      force.add(particle.pressureForce);
    }
    if(this.debug_enablePseudoVisocityFilter){
      this.pseudoViscocityFilter(timeIntervalInSeconds);
    }
    particle.force = force;
  }
};

PCISPHSystemSolver.prototype.setDeltaConstant = function(timeIntervalInSeconds){
  //Calculate the mass from our target density and target spacing
  //We're constructing a grid of particles in a cubic grid in order
  //to estimate our delta to avoid errors associated with low density particles.
  //This seems like an excellent method to improve in the future for situations
  //that involve complicated geometries.
  let particleRadius = this.particleConstants.radius;
  let targetSpacing = this.particleConstants.targetSpacing;
  let points = [];
  let sampleBoxLength = 3.0 * particleRadius;
  let halfSpacing = targetSpacing * 0.5;
  let hasOffset = false;
  let initalLoc = -1.5 * particleRadius;
  let z = initalLoc;
  let y;
  let x;
  let maxZNumIterations = Math.floor((3.0 * particleRadius) / halfSpacing);
  let maxXYNumIterationsWHasOffset = Math.floor((sampleBoxLength - halfSpacing) / targetSpacing);
  let maxXYNumIterationsWOHasOffset = Math.floor((sampleBoxLength) / targetSpacing);

  //As this is just used for a constant, we can set the lower corner to 0.0
  //and because it's square we can keep all the interations equal.
  //Also, because we're doing a sample we don't need to do all of them
  //and we will never break early.
  let offset;
  let maxXYNumIterations;
  for(let i = 0; i <= maxZNumIterations; i++){
    z += halfSpacing;
    if(hasOffset){
      offset = halfSpacing;
      maxXYNumIterations = maxXYNumIterationsWHasOffset;
    }
    else{
      offset = 0.0;
      maxXYNumIterations = maxXYNumIterationsWOHasOffset;
    }
    y = initalLoc + offset;
    for(let j = 0; j < maxXYNumIterations; j++){
      y += targetSpacing;
      x = initalLoc + offset;
      for(let k = 0; k < maxXYNumIterations; k++){
        x += targetSpacing;
        points.push(new THREE.Vector3(x, y, z));
      }
    }

    hasOffset = !hasOffset;
  }

  //Delta calculation.
  let denom = 0.0;
  let denom1 = new THREE.Vector3(0.0,0.0,0.0);
  let denom2 = 0.0;
  let particleRadiusSquared = this.particleConstants.radiusSquared;

  for(let i = 0, numPoints = points.length; i < numPoints; i++){
    let point = points[i];
    let distanceSquared = point.x * point.x + point.y * point.y + point.z * point.z;
    if(distanceSquared < particleRadiusSquared){
      let distance = Math.sqrt(distanceSquared);
      let direction = (distance > 0.0) ? point.clone().multiplyScalar(1.0 / distance) : new THREE.Vector3(0.0,0.0,0.0);

      //grad(Wij)
      this.kernal.updateSpikyKernals(distance);
      gradWij = this.interpolator.gradient(distance, direction);
      denom1.add(gradWij);
      denom2 += gradWij.dot(gradWij);
    }
  }

  //
  //NOTE: We really need a test for this, the number for our denom1 is really small and denom2 is really big!
  //

  denom -= denom1.dot(denom1) + denom2;
  let beta = 2.0 * (this.particleConstants.mass * timeIntervalInSeconds * this.PCIConstants.inverseOfTargetDensity);
  this.PCIConstants.delta = Math.abs(denom) > 0.0 ? -1.0 / (beta * denom) : 0.0;
};

PCISPHSystemSolver.prototype.computePressureForce = function(){
  let massSquared = this.parentParticleSystem.particleConstants.massSquared;
  for(let i = 0, numParticles = this.particles.length; i < numParticles; i++){
    let particle = this.particles[i];
    let ithParticlePressureOverDensitySquared =  particle.pressure * particle.inverseDensitySquared;
    let neighbors = particle.particlesInNeighborhood;
    particle.pressureForce.set(0.0,0.0,0.0);
    for(let j = 0, numNeighbors = neighbors.length; j < numNeighbors; j++){
      let neighbor = neighbors[j];
      let neighboringParticle = neighbor.point;
      if(neighbor.distance > 0.0){
        let scalarComponent = massSquared * (ithParticlePressureOverDensitySquared + (neighboringParticle.pressure * neighboringParticle.inverseDensitySquared));
        particle.pressureForce.sub(this.interpolator.gradient(neighbor.distance, neighbor.vect2Point).multiplyScalar(scalarComponent));
      }
    }
  }
};

//
//NOTE: I just went through our interpolator and killed all linear interpolation
//functions and replaced them with regular kernal values because it wasn't saving us
//any computations. A more efficient method was put in it's place and we're instead grabbing
//the results directly.
//
PCISPHSystemSolver.prototype.accumulatePressureForce = function(timeIntervalInSeconds){
  //
  //NOTE: The text gathers copies of each of our particles here, position, density, pressure and forces.
  //
  let particles = this.particles;
  let targetDensity = this.PCIConstants.targetDensity;
  let inverseTargetDensity = this.PCIConstants.inverseOfTargetDensity;
  let particleMass = this.particleConstants.mass;
  let inverseOfMass = this.particleConstants.inverseOfMass;
  let maxDensityErrorRatio = this.PCIConstants.maxDensityErrorRatio;
  let negativePressureScale = this.PCIConstants.negativePressureScale;
  let delta = this.PCIConstants.delta;

  //Reset pressure state
  let tempStates = [];
  let numParticles = this.particles.length;
  let predictedDensities = new Float32Array(numParticles);
  for(let i = 0, numParticles = particles.length; i < numParticles; i++){
    let particle = particles[i];
    particle.pressure = 0.0;
    particle.pressureForce.set(0.0,0.0,0.0);
    predictedDensities[i] = particle.density;
    tempStates.push(particle.cloneToPCITemp());
  }

  for(let i = 0; i < this.PCIConstants.maxNumberOfIterations; i++){
    //Predict velocity and positiosns
    for(let j = 0, numParticles = particles.length; j < numParticles; j++){
      let particle = particles[j];
      let tempState = tempStates[j];
      let tempVelocity = particle.velocity + timeIntervalInSeconds * inverseOfMass * (particle.forces + tempState.pressureForce);
      tempState.velocity = tempVelocity;
      tempState.position = particle.position + timeIntervalInSeconds * tempVelocity;
    }

    //Resolve collisions
    if(this.debug_enableCollisions){
      this.resolveCollisions(tempStates);
    }

    //Compure pressure from density error
    let maxDensityError = 0.0;
    let abs = Math.abs;
    for(let j = 0, numParticles = particles.length; j < numParticles; j++){
      //Now start the calculations
      let particle = particles[j];
      let weightSum = 0.0;
      let neighboringParticleData = particle.particlesInNeighborhood;
      for(let k = 0, numNeighbors = neighboringParticleData.length; k < numNeighbors; k++){
        let distanceSquared = neighboringParticleData[k].distanceSquared;
        weightSum += this.kernal.getMullerKernal(distanceSquared);
      }
      //NOTE: Our weight sums are too small because our particles are too far apart.
      //But they should always be below the BCC distance, which makes me wonder
      //if that is a good distance to approximate our mass with.
      weightSum += this.kernal.mullerAtZeroDistance;
      let density = particleMass * weightSum;
      let densityError = (density - targetDensity);
      let pressure = delta * densityError;

      if(pressure < 0.0){
        pressure *= negativePressureScale;
        densityError *= negativePressureScale;
      }

      particle.pressure += pressure;
      particle.density = density;
      let absDensityError = abs(densityError);
      if(absDensityError > maxDensityError){
        maxDensityError = absDensityError;
      }
    }

    //Compute pressure gradient force
    for(let j = 0, numParticles = particles.length; j < numParticles; j++){
      tempStates[i].pressureForce = 0.0;
    }
    this.computePressureForce();

    //Compute max density error
    let densityErrorRatio = maxDensityError * inverseTargetDensity;
    if(abs(densityErrorRatio) < maxDensityErrorRatio){
      break;
    }
  }
};

PCISPHSystemSolver.prototype.resolveCollisions = function(tempStates){
  //
  //TODO: Still need to do this one.
  //
}

PCISPHSystemSolver.prototype.accumulateViscosityForce = function(){
  let massSquared = this.particleConstants.viscosityCoefficientTimesMassSquared;
  let viscocityCoefficient = this.particleConstants.viscocityCoeficient;
  let viscocityCoeficientTimesMassSquared = viscocityCoefficient * viscocityCoefficient;
  for(let i = 0, numParticles = this.particles.length; i < numParticles; i++){
    let particle = this.particles[i];
    let ithParticlePressureOverDensitySquared =  particle.pressure * particle.inverseDensitySquared;
    let neighbors = particle.particlesInNeighborhood;
    particle.viscocityForce.set(0.0,0.0,0.0);
    let ithParticleVelocity = particle.velocity;
    for(let j = 0, numNeighbors = neighbors.length; j < numNeighbors; j++){
      let neighboringParticle = neighbors[j].point;
      let distance = neighbors[j].distance;
      let scalarComponent = viscocityCoeficientTimesMassSquared * neighboringParticle.inverseDensity;
      let littleViscosityForce = ithParticleVelocity.clone().sub(neighboringParticle.velocity).multiplyScalar(scalarComponent);
      particle.viscocityForce.add(littleViscosityForce);
    }
  }
};

PCISPHSystemSolver.prototype.pseudoViscocityFilter = function(timeIntervalInSeconds){
  let particles = this.particles;
  let particleMass = this.particleConstants.mass;
  let smoothedVelocities = [];
  let factor = Math.max(Math.min(timeIntervalInSeconds * this.PCIConstants.pseudoViscosityCoefficient, 0.0), 1.0);

  for(let i = 0, numParticles = particles.length; i < numParticles; i++){
    let particle = particles[i];
    let weightSum = 0.0;
    let smoothedVelocity = new THREE.Vector3(0.0,0.0,0.0);

    let neighbors = particle.particlesInNeighborhood;
    for(let j = 0; j < neighbors.length; j++){
      let neighbor = neighbors[j];
      let wj = particleMass * neighbor.point.inverseDensity * this.kernal.getMullerKernal(neighbor.distanceSquared);
      weightSum += wj;
      smoothedVelocity.add(neighbor.point.velocity).multiplyScalar(wj);
    }

    let wi = particleMass * particle.inverseDensity;
    if(weightSum > 0.0){
      smoothedVelocity.multiplyScalar(1.0 / weightSum);
    }

    particle.velocity = particle.velocity.lerp(smoothedVelocity, factor);
  }
};

PCISPHSystemSolver.prototype.calculateWindResistanceForce = function(timeIntervalInSeconds){
  for(let i = 0, numParticles = this.particles.length; i < numParticles; i++){
    //
    //NOTE: In the future, air resistance should not effect particles under water.
    //A cheap way of implementing this is to to determine the number of particles close to this particle.
    //The more particles, the less the epxpected air resistance. Over a certain number, air reistance
    //should be shunted to zero. This is cheap though and a better method would determine the percent of particle
    //exposed to the air, though that might be too much as we can't presume a spherical particle as the surface
    //connects between particles.
    //
    //For now, just apply the fully air resistance to every particle.
    let particle = this.particles[i];
    particle.windResistanceForce = particle.velocity.clone().add(this.particleConstants.localWindVelocity);
    particle.windResistanceForce.multiplyScalar(this.particleConstants.dragCoefficient);
  }
};

PCISPHSystemSolver.prototype.logNTimes = function(name, maxNumLogs, msg){
  if(this.logs[name] == null){
    this.logs[name] = 1;
    console.log(msg);
  }
  if(this.logs[name] <= maxNumLogs){
    this.logs[name] += 1;
    console.log(`${name}: ${msg}`);
  }
};

function ParticleSolverConstants(targetDensity, eosExponent, speedOfSound, negativePressureScale, visocityCoefficient, pseudoViscosityCoefficient, maxDensityErrorRatio, maxNumberOfPCISteps){
  this.targetDensity = targetDensity;
  this.inverseOfTargetDensity = 1.0 / targetDensity;
  this.maxDensityErrorRatio = maxDensityErrorRatio;
  this.maxNumberOfIterations = maxNumberOfPCISteps;
  this.eosExponent = eosExponent;
  this.speedOfSound = speedOfSound;
  this.inverseOfEosExponent = 1.0 / eosExponent;
  this.eosScale = this.targetDensity * this.speedOfSound * this.inverseOfEosExponent;
  this.eosScaleDivideByEosExponent = this.eosScale * this.inverseOfEosExponent;
  this.negativePressureScale = negativePressureScale;
  this.visocityCoefficient = visocityCoefficient;
  this.pseudoViscosityCoefficient = pseudoViscosityCoefficient;
  this.delta = null;
}
