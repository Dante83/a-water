this.InterpolationEngine = function(searchRadius, bucketGrid, interpolationId, constants){
  this.searchRadius = searchRadius;
  this.bucketGrid = bucketGrid;
  this.kernalConstants = new KernalConstants(this.constants.influenceRadius);
  var parentInterpolationEngine = this;

  ////
  //Redefine kernal constants locally for one less lookup per constant
  ////
  this._influenceRadius = this.kernalConstants.influenceRadius;
  this._oneOverInfluenceRadiusSquared = this.kernalConstants.oneOverInfluenceRadiusSquared;
  this._mullerCoefficient = this.kernalConstants.mullerCoefficient;
  this._oneOverInfluenceRadius = this.kernalConstants.oneOverInfluenceRadius;

  //Unlike the interpolator, we also need to determine a host of properties for each of our particles
  //We might as well do these all at once, duplicating information that is re-used on every stage
  //in order to minimize the number of operations needed.
  function ParticleInterpolator(particles){
    this.particles = particles;

    //
    //NOTE: We are doing twice the calculations we really need to here, because any
    //particle A in the radius of particle B is symmetrically a particle B in the radius of particle A.
    //
    this.updateParticleNeighborhoods = function(){
      //Find all neighboring particles
      const particleMass = this.particles[0].mass; //NOTE: All particles have the same mass - no use in grabbing this over and over.
      for(let i = 0, pLen = this.particles.length; i < pLen; i++){
        let particle = this.particles[i];
        var particlesInSearchRadius = this.bucketGrid.findPointsInSphere(particle.position, this.searchRadius);
        particle.particlesInNeighborhood = particlesInSearchRadius;
        let densitySum = 0.0;
        for(let j = 0, d2PartLen = distancesToParticles.length; j < d2PartLen; j++){
          let distance = distancesToParticles
          densitySum += this.mullerKernal(d);
        }
        particle.density = particleMass * densitySum;
        particle.inverseDensity = 1.0 / particle.density;
      }
    }

    this.particleMullerKernal = function(distance, distanceSquared){
      if(distance <= this._influenceRadius){
        let mullerVariableComponent = (1.0 - (distanceSquared * this._oneOverInfluenceRadiusSquared));
        return this._mullerCoefficient * mullerVariableComponent * mullerVariableComponent * mullerVariableComponent;
      }
      return 0.0;
    }
  }

  function OperatorAt(origin, particleNeighborhood = false){
    let parentInterpolator = this;
    this.origin = origin;
    this.interpolatedQuantity = [];
    this.parentParticleSystem = bucketGrid.parentParticleSystem;
    this.particleMass = this.parentParticleSystem.universalParticleProperties.mass;
    this.searchResults = particleNeighborhood !== false ? this.bucketGrid.findPointsInSphere(this.origin, this.searchRadius) : particleNeighborhood;
    this.kernalObjects = [];
    for(let i = 0, srLen = this.searchResults.length; i < srLen; i++){
      this.kernalObjects.push(new Kernal(searchResults[i].distance, this.kernalConstants));
    }

    this.interpolate = function(nameOfInterpolatedQuantity){
      let sum = 0.0;
      for(let i = 0, srLen = this.searchResults.length; i < srLen; i++){
        //NOTE: The point here is actually a particle and therefore has access to the inverse density and interpolated quantities
        let result = this.searchResults[i];
        sum += this.kernalObjects[i].mullerKernalValue * result.point.inverseDensity * result.point[nameOfInterpolatedQuantity];
      };

      let returnQuantity = this.particleMass * sum;
      this.interpolatedQuantity[nameOfInterpolatedQuantity] = returnQuantity;
      return returnQuantity;
    }

    this.gradientOf = function(nameOfInterpolatedQuantity){
      let densityAtOrigin = this.interpolatedQuantity['density'];
      let inverseOfDensityAtOriginSquared = 1.0  / (densityAtOrigin * densityAtOrigin);
      let interpolatedQuantityAtOrigin = this.interpolatedQuantity[nameOfInterpolatedQuantity];
      let iQDivBySqOfInvDens = interpolatedQuantityAtOrigin * inverseOfDensityAtOriginSquared;
      let sum = 0.0;
      for(let i = 0, srLen = this.searchResults.length; i < srLen; i++){
        //Gradient Parameters
        let kernalObject = this.kernalObjects[i];
        let searchResult = this.searchResults[i];
        let distance = searchResult.distance;
        let directionToCenter = searchResult.vect2Point;

        //Coeficient parameters
        let particle = this.searchResults[i].point;
        let inverseOfParticleDensitySquared = particle.inverseDensity * particle.inverseDensity;

        sum += (iQDivBySqOfInvDens + inverseOfParticleDensitySquared * particle[nameOfInterpolatedQuantity]) * kernalObject.gradient(distance, directionToCenter);
      };

      return densityAtOrigin * this.particleMass * sum;
    }

    this.laplacianOf = function(nameOfInterpolatedQuantity){
      let sum = 0.0;
      let interpolatedQuantityAtOrigin = this.interpolatedQuantity[nameOfInterpolatedQuantity];
      for(let i = 0, srLen = this.searchResults.length; i < srLen; i++){
        let particle = this.searchResults[i].point;
        sum += (particle[nameOfInterpolatedQuantity] - interpolatedQuantityAtOrigin) * particle.inverseDensity * this.kernalObjects[i].mullerSpikyKernalSecondDerivative;
      };

      return this.particleMass * sum;
    }
  }
}

function InterpolatorConstants(influenceRadius){
  this.influenceRadius = influenceRadius;
}
