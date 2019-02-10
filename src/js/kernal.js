function Kernal(kernalConstants){
  this.kernalConstants = kernalConstants;
  this.mullerSpikyKernalFirstDerivative = null;
  this.mullerSpikyKernalSecondDerivative = null;
  this.mullerAtZeroDistance = this.getMullerKernal(0.0);
}

Kernal.prototype.updateSpikyKernals = function(distance){
  //Get the Mueller Kernal
  if(distance > this.kernalConstants.particleRadius){
    this.mullerSpikyKernalFirstDerivative = 0.0;
    this.mullerSpikyKernalSecondDerivative = 0.0;
    return false;
  }

  //Get the Meuller Spiky Kernal
  //Note that we ignore the actual spiky kernal as we only use it for the gradient
  //and the laplacian.
  //(1 - r/h) values
  let variableComponent = (1.0 - (distance * this.kernalConstants.oneOverParticleRadius));

  this.mullerSpikyKernalFirstDerivative = this.kernalConstants.mullerSpikyFirstDerivativeCoeficient * variableComponent * variableComponent;
  this.mullerSpikyKernalSecondDerivative = this.kernalConstants.mullerSpikySecondDerivativeCoeficient * variableComponent;
  return true;
};

Kernal.prototype.getMullerKernal = function(distanceSquared){
  if(distanceSquared > this.kernalConstants.particleRadiusSquared){
    return 0.0;
  }

  let mullerVariableComponent = (1.0 - (distanceSquared * this.kernalConstants.oneOverParticleRadiusSquared));
  return this.kernalConstants.mullerCoefficient * mullerVariableComponent * mullerVariableComponent * mullerVariableComponent;
};

//Interpolaters use many of the variables over and over again - no use in doing these calculations for each one
//when we can just create them once and use them everywhere.
function KernalConstants(particleRadius){
    ////
    //MULLER KERNAL CONSTANTS
    ////
    this.particleRadius = particleRadius;
    this.oneOverParticleRadius = 1.0 / particleRadius;
    this.particleRadiusSquared = particleRadius * particleRadius;
    this.oneOverParticleRadiusSquared = 1.0 / this.particleRadiusSquared;
    this.particleRadiusCubed = this.particleRadiusSquared * particleRadius;
    this.mullerCoefficient = 315.0 / (64.0 * Math.PI * this.particleRadiusCubed);

    ////
    //MULLER SPIKY KERNAL CONSTANTS
    ////
    let oneOverParticleRadius = 1.0 / particleRadius;
    this.mullerSpikyCoefficient = 15.0 / (Math.PI * this.particleRadiusCubed);
    this.mullerSpikyFirstDerivativeCoeficient = -3.0 * this.mullerSpikyCoefficient * this.oneOverParticleRadius;
    this.mullerSpikySecondDerivativeCoeficient = -2.0 * this.mullerSpikyCoefficient * this.oneOverParticleRadius;
}
