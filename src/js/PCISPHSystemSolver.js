function PCISPHSystemSolver(interpolator, PCIConstants, parentParticleSystem){
  this.interpolator = interpolator;
  this.operators = interpolator.OperatorAt(origin);
  this.parentParticleSystem = parentParticleSystem;
  this.particles = parentParticleSystem.particles;
  this.PCIConstants = PCIConstants;
  this.particleConstants = parentParticleSystem.particleConstants;
  this.gravitationalForce = new THREE.Vector3(0.0,0.0, this.particleConstants.mass * this.PCIConstants.gravity);

  //Debugging variables
  this.debug_enableGravity = false;
  this.debug_enableWindResistance = false;
  this.debug_enableVicosityForces = false;
  this.debug_enablePressureForces = false;
  this.debug_enableCollisions = false;
  this.debug_enablePseudoVisocityFilter = false;
}

PCISPHSystemSolver.prototype.updateForces = function(timeIntervalInSeconds){
  let particles = this.particles;

  //Update the forces for all of our particles
  this.computePressure();
  this.accumulatePressureForce(timeIntervalInSeconds);
  this.accumulateViscosityForce();
  this.calculateWindResistanceForce();
  //this.computePseudoViscosityForce();

  //Accumulate the forces for each particle
  for(let i = 0, numParticles = particles.length; i < numParticles; i++){
    let particle = particles[i];
    let force = new THREE.Vector3(0.0, 0.0, 0.0);
    if(this.debug_enableGravity){
      force.add(gravitationalForce);
    }
    if(this.debug_enableWindResistance){
      force.add(gravitationalForce);
    }
    if(this.debug_enableVicosityForces){
      force.add(particle.viscocityForce);
    }
    if(this.debug_enablePressureForces){
      force.add(particle.pressureForce);
    }
    if(this.debug_enablePseudoVisocityFilter){
      this.pseudoViscocityFilter(timeIntervalInSeconds);
    }
  }
};

//NOTE: As this is dependent upone one variable, we might want to convert the results
//into an array.
PCISPHSystemSolver.prototype.computeDelta = function(timeIntervalInSeconds){
  //
  //NOTE: Come back here when you're done and make sure all of this works together.
  //

  //We're constructing a grid of particles in a cubic grid in order
  //to estimate our delta to avoid errors associated with low density particles.
  //This seems like an excellent method to improve in the future for situations
  //that involve complicated geometries.
  let points = [];
  let sampleBoxLength = 1.5 * this.particleConstants.radius;
  let halfSpacing = this.particleConstants.targetSpacing * 0.5;
  let numIters = Math.ceil(halfSpacing / sampleBoxLength);
  let hasOffset = false;
  let x = 0.0;
  let y = 0.0;
  let z = 0.0;

  //As this is just used for a constant, we can set the lower corner to 0.0
  //and because it's square we can keep all the interations equal.
  //Also, because we're doing a sample we don't need to do all of them
  //and we will never break early.
  for(let i = 0; i <= numIters; i++){
    y += halfSpacing;
    let halfSpacingPlusOffset = halfSpacing + (hasOffset ? halfSpacing : 0.0);
    for(let j = 0; j <= numIters; j++){
      z += halfSpacingPlusOffset;
      for(let k = 0; k <= numIters; k++){
        x += halfSpacingPlusOffset;
      }
    }
    hasOffset = !hasOffset;
  }
  points.push(new THREE.Vector3(x, y, z));

  //Delta calculation.
  let denom = 0.0;
  let a = new THREE.Vector3(0.0,0.0,0.0);
  let b = 0.0;
  let particleRadiusSquared = this.particleConstants.particleRadiusSquared;

  for(let i = 0, numPoints = points.length; i < numPoints; i++){
    let point = points[i];
    let distanceSquared = point.x * point.x + point.y * point.y + point.z * point.z;
    if(distanceSquared < particleRadiusSquared){
      let distance = Math.sqrt(distanceSquared);
      let direction = (distance > 0.0) ? point.clone().multiplyScalar(1.0 / distanceSquared) : new THREE.Vector3(0.0,0.0,0.0);

      //grad(Wij)
      gradWij = this.operators.gradient(distance, direction);
      a.add(gradWij);
      b += gradWij.dot(gradWij);
    }
  }

  denom -= a.dot(a) + denom2;
  return Math.abs(denom) > 0.0 ? -1.0 / (this.computeBeta(timeIntervalInSeconds) * denom) : 0.0;
};

PCISPHSystemSolver.prototype.computeBeta = function(timeIntervalInSeconds){
  let a = this.particleConstants.mass * timeIntervalInSeconds * this.PCIConstants.inverseOfTargetDensity;
  return 2.0 * a;
};

PCISPHSystemSolver.prototype.computePressureFromEoS = function(density){
  let constants = this.PCIConstants;
  let p = constants.eosScaleDivideByEosExponent * ((density * constants.inverseOfTargetDensity - 1.0)**constants.eosExponent);
  return p >= 0.0 ? p : p * constants.negativePressureScale;
};

PCISPHSystemSolver.prototype.computePressure = function(){
  for(let i = 0, numParticles = this.particles.length; i < numParticles; i++){
    let particle = this.particles[i];
    particle.pressure = this.computePressureFromEoS(particle.density);
  }
};

PCISPHSystemSolver.prototype.computePressureForce = function(){
  let massSquared = this.parentParticleSystem.particleConstants.massSquared;
  for(let i = 0, numParticles = this.particles.length; i < numParticles; i++){
    let particle = this.particles[i];
    let ithParticlePressureOverDensitySquared =  particle.pressure * particle.inverseDensitySquared;
    let neighbors = particle.particlesInNeighborhood;
    particle.pressureForce.set(0.0,0.0,0.0);
    for(let j = 0, numNeighbors = neighbors.length; j++){
      let neighbor = neighbors[j];
      let neighboringParticle = neighbor.point;
      if(neighbor.distance > 0.0){
        let scalarComponent = massSquared * (ithParticlePressureOverDensitySquared + (neighboringParticle.pressure * neighboringParticle.inverseDensitySquared));
        particle.pressureForce.sub(this.operators.gradient(neighbor.distance, neighbor.vect2Point).multiplyScalar(scalarComponent));
      }
    }
  }
};

//
//NOTE: We're still not sure how this computes our pressure force and I need to go over it.
//
PCISPHSystemSolver.prototype.accumulatePressureForce = function(timeIntervalInSeconds){
  //
  //NOTE: The text gathers copies of each of our particles here, position, density, pressure and forces.
  //
  let particles = this.particles;
  let targetDensity = this.PCIConstants.targetDensity;
  let inverseTargetDensity = this.PCIConstants.inverseDensity;
  let inverseOfMass = this.particleConstants.inverseOfMass;
  let maxDensityErrorRatio = this.PCIConstants.maxDensityErrorRatio;
  let negativePressureScale = this.PCIConstants.negativePressureScale;

  //
  //TODO: Fill out computeDelta
  //
  let delta = this.computeDelta(timeIntervalInSeconds);

  //Reset pressure state
  let tempStates = [];
  let predictedDensities = new Float32Array(numParticles);
  for(let i = 0, numParticles = particles.length; i < numParticles; i++){
    let particle = particles[i];
    particle.pressure = 0.0;
    particle.pressureForce.set(0.0,0.0,0.0);
    predictedDensities = particle.density;
    tempStates.push(particle.cloneToPCITemp());
  }

  for(let i = 0; i < this.PCIConstants.maxNumberOfIterations; i++){
    //Predict velocity and positiosns
    for(let i = 0, numParticles = particles.length; i < numParticles; i++){
      let particle = particles[i];
      let tempState = tempStates[i];
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
    for(let i = 0, numParticles = particles.length; i < numParticles; i++){
      let particle = particles[i];
      let weightSum = 0.0;
      let neighboringParticleData = particle.neighboringParticles;

      for(let j = 0, numNeighbors = neighboringParticleData.length; j < numNeighbors; j++){
        let distance = neighboringParticleData[j].distance;
        this.interpolator.evalFKernalState(distance);
        weightSum += this.interpolator.evalFMullerKernal(distance);
      }
      this.interpolator.isNotZero = true;
      weightSum += this.interpolator.evalFMullerKernal(0.0);

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
    for(let i = 0, numParticles = particles.length; i < numParticles; i++){
      tempState[i].pressureForce = 0.0;
    }
    this.accumulatePressureForce(computePressureForce);

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
    for(let j = 0, numNeighbors = neighbors.length; j++){
      let neighbor = neighbors[j];
      let neighboringParticle = neighbor.point;
      let distance = neighbor.distance;
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
  let factor = Math.max(Math.min(timeIntervalInSeconds * this.PCIConstants.pseudoViscosityCoefficient), 0.0) 1.0);

  for(let i = 0, numParticles = particles.length; i < numParticles; i++){
    let weightSum = 0.0;
    let smoothedVelocity = new Three.Vector3(0.0,0.0,0.0);

    let neighbors = particle.neighboringParticles;
    for(let j = 0; j < neighbors.length; j++){
      let neighbor = neighbors[j];
      this.interpolator.evalFKernalState(neighbor.distance);
      let kernalVal = this.interpolator.evalFMullerKernal(neighbor.distance);
      let wj = particleMass * neighbor.point.inverseDensity * kernalVal;
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

function ParticleSolverConstants(targetDensity, eosExponent, speedOfSound, gravity, negativePressureScale, visocityCoefficient, pseudoViscosityCoefficient, maxDensityErrorRatio, maxNumberOfPCISteps){
  this.gravity = gravity;
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
}
