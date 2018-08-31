function PCISPHSystemSolver(interpolator, constants, parentParticleSystem){
  this.operators = interpolator.OperatorAt(origin);
  this.tempPositions = [];
  this.tempVelocities = [];
  this.pressureForces = [];
  this.parentParticleSystem = [];
  this.particles = this.parentParticleSystem.particles;

  ////
  //Redefine constants locally for one less lookup per constant
  ////
  this._targetDensity = constants.targetDensity;
  this._inverseOfTargetDensity = constants.inverseOfTargetDensity;
  this._maxDensityErrorRatio = constants.maxDensityErrorRatio;
  this._predictAndCorrectMaxIterations = constants.predictAndCorrectMaxIterations;
  this._eosExponent = constants.eosExponent;
  this._speedOfSound = constants.speedOfSound;
  this._inverseOfEosExponent = constants.inverseOfEosExponent;
  this._eosScale = constants.eosScale;
  this._negativePressureScale = constants.negativePressureScale;


  // this.onBeginTimeStep(){
  //   //Update all particle densities
  //
  // }

  this.accumulatePressureForce = function(timeIntervalInSeconds){
    //Initialize other variables
    let particlePressures;
    let particlePositions;
    let particleVelocities;

    //Not sure if I need to initialize the buffers or not...

    for(let i = 0, predAndCorrctMaxIter = this._predictAndCorrectMaxIterations; i < predAndCorrctMaxIter; i++){
      //Predict velocity and position
      for(let j = 0, partLen = this.particles.length; j < partLen; j++){
        let particle = this.particles[j];
        //WARNING: We do not know what f[j] is and we do not have a calculation for _pressureForces[j] yet...
        this.tempVelocity[j] = particle.velocity + timeIntervalInSeconds * particle.inverseOfMass  * (f[j] + _pressureForces[j]);
        this.tempPositions[j] = particle.position + timeIntervalInSeconds * this.tempVelocity[j];
      }

      //Resolve collisions
      //WARNING: We might need to refer back to ParticleSystemSolver3 for this...


      //Compute pressure from density error
      const particleMass = this.particles[0].mass;//Because particle mass is constant
      for(let j = 0, partLen = this.particles.length; j < partLen; j++){
        let particle = this.particle[j];
        let weightSum = 0.0;

        for(let k = 0, particlesInNeighborhood = particle.particlesInNeighborhood; k < particlesInNeighborhood; k++){
          let xSquared = this.tempPositions[k][0] * this.tempPositions[k][0];
          let ySquared = this.tempPositions[k][1] * this.tempPositions[k][1];
          let zSquared = this.tempPositions[k][2] * this.tempPositions[k][2];
          let dist = Math.sqrt(xSquared + ySquared + zSquared);
          weightSum += kernal(dist); //NOTE: We need to update kernals or build another kernal to get out stupid
          //kernal like this.
        }
        weightSum += kernal(0);//Again with this kernal...

        let density = particleMass * weightSum;
        let densityError = (density - this._targetDensity);
        let pressure = delta * densityError;//WTF Is delta?!
        if(pressure < 0.0){
          pressure *= this._negativePressureScale;
          densityError *= this._negativePressureScale;
        }

        particlePressures[j] += pressure;
        ds[j] = density//Densities?! WHERE IN THE FUCK?!
        _densityErrors[j] = densityError;
      }

      //Compute pressure gradient force
      //Was originally just accumulate Pressure force getForce_Pressure


      //Compute max density error
      //let maxDensityError = ;
      let densityErrorRatio = maxDensityError * this._inverseOfTargetDensity;

      if(Math.abs(densityErrorRatio) < this._maxDensityErrorRatio){
        break;
      }
    }

    //Accumulate pressure force

  }

  this.computePressureFromEOS = function(density){
    let pressure = this._eosScale * this._inverseOfEosExponent * (((density * this._inverseOfTargetDensity) - 1.0)**this._eosExponent);
    return pressure >= 0.0 ? pressure : pressure * this._negativePressureScale;
  }

  this.getForce_Pressure = function(mass, pressure, inverseDensity){
    return -1 * mass * inverseDensity * this.operators.gradientOf(pressure);
  }

  this.getForce_Viscosity = function(mass, viscosityCoefficient, speed){
    return mass * viscosityCoefficient * this.operators.laplacianOf(speed);
  }
}

function ParticleSolverConstants(targetDensity, eosExponent, speedOfSound, negativePressureScale){
  this.targetDensity = targetDensity;
  this.inverseOfTargetDensity = 1.0 / targetDensity;
  this.maxDensityErrorRatio = 0.01;
  this.predictAndCorrectMaxIterations = 5.0;
  this.eosExponent = eosExponent;
  this.speedOfSound = speedOfSound;
  this.inverseOfEosExponent = 1.0 / eosExponent;
  this.eosScale = this.targetDensity * this.speedOfSound * this.inverseOfEosExponent;
  this.negativePressureScale = negativePressureScale;
}
