function Kernal(distance, constants){
  //NOTE: We presume that our origin to particle vector is pre-normalized to reduce duplicate computations
  var parentKernal = this;
  this.constants = constants;
  this.distance = distance;
  this.distanceSquared = distance * distance;
  this.originToParticleVect = originToParticleVect;
  this.mullerKernalValue = 0.0;
  this.mullerSpikyKernalValue = 0.0;
  this.mullerSpikyKernalFirstDerivative = 0.0;
  this.mullerSpikyKernalSecondDerivative = 0.0;
  this.gradient = 0.0;
  this.laplacian = 0.0;

  MullerKernal();
  MullerSpikyKernal();

  function MullerKernal(){
    if(this.distance <= this.constants.influenceRadius){
      var mullerVariableComponent = (1.0 - (this.distanceSquared * this.constants.oneOverInfluenceRadiusSquared));
      parentKernal.mullerKernalValue = this.constants.mullerCoefficient * mullerVariableComponent * mullerVariableComponent * mullerVariableComponent;
    }
  }

  function MullerSpikyKernal(){
    if(distance <= this.constants.influenceRadius){
      //(1 - r/h) values
      var variableComponent = (1.0 - (distance * this.constants.oneOverInfluenceRadius));
      var variableComponentSquared = variableComponent * variableComponent;
      var variableComponentCubed = variableComponentSquared * variableComponent;

      this.mullerSpikyKernalValue = this.constants.mullerSpikyCoefficient * variableComponentCubed;
      parentKernal.mullerSpikyKernalFirstDerivative = this.constants.mullerSpikyFirstDerivativeCoeficient * variableComponentSquared;
      parentKernal.mullerSpikyKernalSecondDerivative = this.constants.mullerSpikySecondDerivativeCoeficient * variableComponent;
    }
  }

  this.gradient(distance, directionToCenter){
    if(distance <= h){
      return {
        x: this.mullerSpikyKernalFirstDerivative * directionToCenter.x,
        y: this.mullerSpikyKernalFirstDerivative * directionToCenter.y,
        z: this.mullerSpikyKernalFirstDerivative * directionToCenter.z,
      }
    }
    return {x: 0.0, y: 0.0, z: 0.0};
  }
}

//Interpolaters use many of the variables over and over again - no use in doing these calculations for each one
//when we can just create them once and use them everywhere.
function KernalConstants(influenceRadius){
    ////
    //MUELLER KERNAL CONSTANTS
    ////
    this.influenceRadius = influenceRadius;
    this.influenceRadiusSquared = this.influenceRadius * this.influenceRadius;
    this.oneOverInfluenceRadiusSquared = 1.0 / this.influenceRadiusSquared;
    this.influenceRadiusCubed = this.influenceRadiusSquared * this.influenceRadius;
    this.mullerCoefficient = 315.0 / (64.0 * Math.PI * this.influenceRadiusCubed);

    ////
    //MUELLER SPIKY KERNAL CONSTANTS
    ////
    this.oneOverInfluenceRadius = 1.0 / this.influenceRadius;
    this.mullerSpikyCoefficient = 15.0 / (Math.PI * this.influenceRadiusCubed);
    this.mullerSpikyFirstDerivativeCoeficient = -3.0 * this.mullerSpikyCoefficient * this.oneOverInfluenceRadius;
    this.mullerSpikySecondDerivativeCoeficient = -2.0 * this.mullerSpikyCoefficient * this.oneOverInfluenceRadius;
}
