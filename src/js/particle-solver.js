function SystemSolver(origin, interpolator, constants){
  this.constants = constants;
  this.operators = interpolator.OperatorAt(origin);

  this.onBeginTimeStep(){
    //Update all particle densities

  }

  this.accumulatePressureForces(timeStepInSeconds){
    for(let i = 0; i < this.contants.predictAndCorrectMaxIterations; i++){
      //Predict velocity and position


      //Resolve collisions


      //Compute pressure from density error
      //NOTE: originally just compute pressure, computePressure from EOS

      //Compute pressure gradient force
      //Was originally just accumulate Pressure force getForce_Pressure


      //Compute max density error
      let maxDensityError;
      var densityErrorRatio = maxDensityError * this.constants.inverseOfTargetDensity;

      if(Math.abs(densityErrorRatio) < this.constants.maxDensityErrorRatio){
        break;
      }
    }
  }

  //
  //NOTE: Deprecated
  //
  this.computePressureFromEOS(density){
    let pressure = this.constants.eosScale * this.constants.inverseOfEosExponent * (((density * this.constants.inverseOfTargetDensity) - 1.0)**this.constants.eosExponent);

    //
    //NOTE: Simply multiplying clamping or multiplying the negative pressure by a constant seems rather arbitrary.
    //It would appear that another possible solution to this problem is to estimate the density more accurately, by
    //considering that large sections of white space do not contribute to the pressure. But for now, this definitely works.
    //And it's probably cheaper.
    //
    return pressure >= 0.0 ? pressure : pressure * this.constants.negativePressureScale;
  }

  //
  //NOTE: Deprecated
  //
  this.getForce_Pressure(mass, pressure, inverseDensity){
    return -1 * mass * inverseDensity * this.operators.gradientOf(pressure);
  }

  //
  //NOTE: Deprecated
  //
  this.getForce_Viscosity(mass, viscosityCoefficient, speed){
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
