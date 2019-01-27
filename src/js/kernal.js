function Kernal(kernalConstants){
  this.kernalConstants = kernalConstants;
}

Kernal.prototype.updateKernal = function(distance){
  //
  //NOTE: We are ignoring the particle radius because we are interpolating between 0 and our radius
  //
  //Get the Mueller Kernal
  let mullerVariableComponent = (1.0 - (distance * distance * this.kernalConstants.oneOverParticleRadiusSquared));
  this.mullerKernalValue = this.kernalConstants.mullerCoefficient * mullerVariableComponent * mullerVariableComponent * mullerVariableComponent;

  //Get the Meuller Spiky Kernal
  //Note that we ignore the actual spiky kernal as we only use it for the gradient
  //and the laplacian.
  //(1 - r/h) values
  let variableComponent = (1.0 - (distance * this.kernalConstants.oneOverInfluenceRadius));

  this.mullerSpikyKernalFirstDerivative = this.kernalConstants.mullerSpikyFirstDerivativeCoeficient * variableComponent * variableComponent;
  this.mullerSpikyKernalSecondDerivative = this.kernalConstants.mullerSpikySecondDerivativeCoeficient * variableComponent;
};

Kernal.prototype.bootstrapMullerKernal = function(distanceSquared){
  if(distanceSquared < this.kernalConstants.particleRadiusSquared){
    let mullerVariableComponent = (1.0 - (distanceSquared * this.kernalConstants.oneOverParticleRadiusSquared));
    return this.kernalConstants.mullerCoefficient * mullerVariableComponent * mullerVariableComponent * mullerVariableComponent;
  }
  return 0.0;
};

//Interpolaters use many of the variables over and over again - no use in doing these calculations for each one
//when we can just create them once and use them everywhere.
function KernalConstants(particleRadius){
    ////
    //MULLER KERNAL CONSTANTS
    ////
    this.particleRadius = particleRadius;
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
