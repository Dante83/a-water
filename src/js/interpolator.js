function Interpolator(origin, searchRadius, bucketGrid, constants){
  var parentInterpolator = Interpolator;
  this.origin = origin;
  this.neighborhoodRadius = searchRadius;
  this.bucketGrid = bucketGrid;
  this.constants = constants;
  this.parentParticleSystem = bucketGrid.parentParticleSystem;
  this.particleMass = this.parentParticleSystem.universalParticleProperties.mass;
  this.neighborhoodOfPoints = this.bucketGrid.findPointsInSphere(this.origin, this.searchRadius);
  for(var i = 0; i < this.neighborhoodOfPoints.length; i++){
    var point = this.neighborhoodOfPoints[i];
    point.distance = Math.sqrt(particle.distanceSquared);
    point.mullerKernalValue = this.mullerKernal(particle.distance);
    point.mullerSpikyKernal = this.mullerSpikyKernal(particle.distance);
  }

  this.interpolate(nameOfInterpolatedQuantity, useMuller = true, useMullerSpiky = false){
    var sum = 0.0;
    if(useMuller){
      this.neighborhoodOfPoints.particles.each(function(term){
        //The point here is actually a particle and therefore has access to the inverse density and interpolated quantities
        sum += term.mullerKernalValue * term.point.inverseDensity * term.point[nameOfInterpolatedQuantity];
      });
    }
    else if(useMullerSpiky){
      for(var i = 0; i < this.neighborhoodOfParticles.length; i++){
        //The point here is actually a particle and therefore has access to the inverse density and interpolated quantities
        sum += term.mullerSpikyKernal * term.point.inverseDensity * term.point[nameOfInterpolatedQuantity];
      }
    }
    return this.particleMass * sum;
  }

  this.mullerKernal = function(distance){
    if(distance <= this.constants.influenceRadius){
      var variableComponent = (1.0 - ((distance * distance) * this.constants.oneOverInfluenceRadiusSquared))
      return this.constants.mullerCoefficient * variableComponent * variableComponent * variableComponent;
    }

    return 0.0;
  }

  this.mullerSpikyKernal = function(distance){
    if(distance <= this.constants.influenceRadius){
      var variableComponent = (1.0 - (distance * this.constants.oneOverInfluenceRadius))
      return this.constants.mullerSpikyCoefficient * variableComponent * variableComponent * variableComponent;
    }

    return 0.0;
  }
}

//Interpolaters use many of the variables over and over again - no use in doing these calculations for each one
//when we can just create them once and use them everywhere.
function InterpolatorConstants(influenceRadius){
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
}
