function Kernal(distance, constants){
  //NOTE: We presume that our origin to particle vector is pre-normalized to reduce duplicate computations
  var parentKernal = this;
  this.distance = distance;
  this.distanceSquared = distance * distance;
  this.originToParticleVect = originToParticleVect;
  this.mullerKernalValue = 0.0;
  this.mullerSpikyKernalValue = 0.0;
  this.mullerSpikyKernalFirstDerivative = 0.0;
  this.mullerSpikyKernalSecondDerivative = 0.0;
  this.gradient = 0.0;
  this.laplacian = 0.0;

  ////
  //Redefine constants locally for one less lookup per constant
  ////
  this.influenceRadius = constants.influenceRadius
  this.influenceRadiusSquared = constants.influenceRadiusSquared
  this.oneOverInfluenceRadiusSquared = constants.oneOverInfluenceRadiusSquared
  this.influenceRadiusCubed = constants.influenceRadiusCubed
  this.mullerCoefficient = constants.mullerCoefficient
  this.oneOverInfluenceRadius = constants.oneOverInfluenceRadius
  this.mullerSpikyCoefficient = constants.mullerSpikyCoefficient
  this.mullerSpikyFirstDerivativeCoeficient = constants.mullerSpikyFirstDerivativeCoeficient
  this.mullerSpikySecondDerivativeCoeficient = constants.mullerSpikySecondDerivativeCoeficient

  MullerKernal();
  MullerSpikyKernal();

  function MullerKernal(){
    if(this.distance <= this.constants.influenceRadius){
      let mullerVariableComponent = (1.0 - (this.distanceSquared * this.constants.oneOverInfluenceRadiusSquared));
      parentKernal.mullerKernalValue = this.constants.mullerCoefficient * mullerVariableComponent * mullerVariableComponent * mullerVariableComponent;
    }
  }

  function MullerSpikyKernal(){
    if(distance <= this.constants.influenceRadius){
      //(1 - r/h) values
      let variableComponent = (1.0 - (distance * this.constants.oneOverInfluenceRadius));
      let variableComponentSquared = variableComponent * variableComponent;
      let variableComponentCubed = variableComponentSquared * variableComponent;

      this.mullerSpikyKernalValue = this.constants.mullerSpikyCoefficient * variableComponentCubed;
      parentKernal.mullerSpikyKernalFirstDerivative = this.constants.mullerSpikyFirstDerivativeCoeficient * variableComponentSquared;
      parentKernal.mullerSpikyKernalSecondDerivative = this.constants.mullerSpikySecondDerivativeCoeficient * variableComponent;
    }
  }

  this.gradient = function(distance, directionToCenter){
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
