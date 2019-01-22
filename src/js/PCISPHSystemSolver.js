function PCISPHSystemSolver(interpolator, PCIConstants, parentParticleSystem){
  this.interpolator = interpolator;
  this.operators = interpolator.OperatorAt(origin);
  this.parentParticleSystem = parentParticleSystem;
  this.particles = parentParticleSystem.particles;
  this.PCIConstants = PCIConstants;
  this.particleConstants = parentParticleSystem.particleConstants;

  //
  //NOTE: We need to figure out how to integrate our gravitational and wind forces here.
  //
  this.updateParticleForces = function(timeIntervalInSeconds){
    //Predicted densities
    let delta = this.computeDelta(timeIntervalInSeconds);
    let predictedDensity = new Array(this.particles.length());

    //Initialize the buffer
    this.pressureForces = [];
    for(let i = 0, numParticles = this.particleSystem.particles.length(); i < numParticles; i++){
      this.particles.pressureForce.set(0.0, 0.0, 0.0);
    }

    //Predict the velocity and position
    //Not sure if I need to initialize the buffers or not...
    for(let i = 0, predAndCorrctMaxIter = this.maxNumberOfIterations; i < predAndCorrctMaxIter; i++){
      //Predict velocity and position
      for(let j = 0, partLen = this.particles.length; j < partLen; j++){
        let particle = this.particles[j];
        //WARNING: We do not know what f[j] is and we do not have a calculation for _pressureForces[j] yet...
        let a = f[j].clone().add(this.pressureForces[j];
        let b = x1.multiplyScalar((timeIntervalInSeconds * particle.inverseOfMass);
        this.tempVelocity[j] = particle.velocity.clone().add(b);
        a = this.tempVelocity[j].clone().multiplyScalar(timeIntervalInSeconds);
        this.tempPositions[j] = particle.position.clone().add(a);
      }

      //Resolve collisions
      //WARNING: We might need to refer back to ParticleSystemSolver3 for this...
      this.resolveCollision();

      //Compute pressure from density error
      const particleMass = this.particles[0].mass;//Because particle mass is constant
      for(let j = 0, partLen = this.particles.length; j < partLen; j++){
        let particle = this.particle[j];
        let weightSum = 0.0;

        for(let k = 0, particlesInNeighborhood = particle.particlesInNeighborhood; k < particlesInNeighborhood; k++){
          let dist = Math.sqrt(this.tempPositions.clone().dot(this.tempPositions.clone()));
          weightSum += kernal(dist); //NOTE: We need to update kernals or build another kernal to get out stupid
          //kernal like this.
        }
        weightSum += kernal(0);//Again with this kernal...

        let density = particleMass * weightSum;
        let densityError = (density - this.targetDensity);
        let pressure = delta * densityError;
        if(pressure < 0.0){
          pressure *= this.negativePressureScale;
          densityError *= this.negativePressureScale;
        }

        particlePressures[j] += pressure;
        predictedDensity[j] = density
        _densityErrors[j] = densityError;
      }

      //Compute pressure gradient force


      //Compute max density error
      //let maxDensityError = /*Let blank in book*/;
      let densityErrorRatio = maxDensityError * this.inverseOfTargetDensity;

      if(Math.abs(densityErrorRatio) < this.maxDensityErrorRatio){
        break;
      }
    }

    //Accumulate pressure force

  }

  this.computeDelta = function(timeIntervalInSeconds){
    //
    //NOTE: This part is described in section Appendix B.2
    //
  }
}

PCISPHSystemSolver.prototype.computePressureFromEoS(density){
  let constants = this.PCIConstants;
  let p = constants.eosScaleDivideByEosExponent * ((density * constants.inverseOfTargetDensity - 1.0)**constants.eosExponent);
  return p >= 0.0 ? p : p * constants.negativePressureScale;
}

PCISPHSystemSolver.prototype.computePressure(particle){
  for(let i = 0, numParticles = this.particles.length; i < numParticles; i++){
    let particle = this.particles[i];
    particle.pressure = this.computePressureFromEoS(particle.density);
  }
}

PCISPHSystemSolver.prototype.computePressureForce(){
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
}

PCISPHSystemSolver.prototype.accumulatePressureForce(){
  //
  //NOTE: The text gathers copies of each of our particles here, position, density, pressure and forces.
  //

  this.computePressureForce();
}

PCISPHSystemSolver.prototype.accumulateViscosityForce(){
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
}

PCISPHSystemSolver.prototype.computePsuedoVisocity(){
  //This is used to even out noise in our results, but it's not filled out in
  //the book.
}

function ParticleSolverConstants(targetDensity, eosExponent, speedOfSound, negativePressureScale, viscocityCoeficient){
  this.targetDensity = targetDensity;
  this.inverseOfTargetDensity = 1.0 / targetDensity;
  this.maxDensityErrorRatio = 0.01;
  this.maxNumberOfIterations = 5.0;
  this.eosExponent = eosExponent;
  this.speedOfSound = speedOfSound;
  this.inverseOfEosExponent = 1.0 / eosExponent;
  this.eosScale = this.targetDensity * this.speedOfSound * this.inverseOfEosExponent;
  this.eosScaleDivideByEosExponent = this.eosScale * this.inverseOfEosExponent;
  this.negativePressureScale = negativePressureScale;
}
