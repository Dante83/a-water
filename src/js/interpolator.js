function InterpolationEngine(searchRadius, bucketGrid, interpolationId, constants){3
  this.searchRadius = searchRadius;
  this.bucketGrid = bucketGrid;
  this.constants = constants;
  this.kernalConstants = new KernalConstants(this.constants.influenceRadius);
  var parentInterpolationEngine = this;

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
      for(let i = 0; i < this.particles.length; i++){
        let particle = this.particles[i];
        var particlesInSearchRadius = this.bucketGrid.findPointsInSphere(particle.position, this.searchRadius);
        particle.particlesInNeighborhood = particlesInSearchRadius;
        let densitySum = 0.0;
        for(let j = 0; j < distancesToParticles.length; j++){
          let distance = distancesToParticles
          densitySum += this.mullerKernal(d);
        }
        particle.density = this.particle.constants.mass * densitySum;
        particle.inverseDensity = 1.0 / particle.density;
      }
    }

    this.particleMullerKernal(distance, distanceSquared){
      if(distance <= this.kernalConstants.influenceRadius){
        var mullerVariableComponent = (1.0 - (distanceSquared * this.kernalConstants.oneOverInfluenceRadiusSquared));
        return this.kernalConstants.mullerCoefficient * mullerVariableComponent * mullerVariableComponent * mullerVariableComponent;
      }
      return 0.0;
    }
  }

  function OperatorAt(origin, particleNeighborhood = false){
    var parentInterpolator = this;
    this.origin = origin;
    this.interpolatedQuantity = [];
    this.parentParticleSystem = bucketGrid.parentParticleSystem;
    this.particleMass = this.parentParticleSystem.universalParticleProperties.mass;
    this.searchResults = particleNeighborhood !== false ? this.bucketGrid.findPointsInSphere(this.origin, this.searchRadius) : particleNeighborhood;
    this.kernalObjects = [];
    for(var i = 0; i < this.searchResults.length; i++){
      this.kernalObjects.push(new Kernal(searchResults[i].distance, this.kernalConstants));
    }

    this.interpolate(nameOfInterpolatedQuantity){
      var sum = 0.0;
      for(var i = 0; i < this.searchResults.length; i++){
        //NOTE: The point here is actually a particle and therefore has access to the inverse density and interpolated quantities
        var result = this.searchResults[i];
        sum += this.kernalObjects[i].mullerKernalValue * result.point.inverseDensity * result.point[nameOfInterpolatedQuantity];
      };

      var returnQuantity = this.particleMass * sum;
      this.interpolatedQuantity[nameOfInterpolatedQuantity] = returnQuantity;
      return returnQuantity;
    }

    this.gradientOf(nameOfInterpolatedQuantity){
      let densityAtOrigin = this.interpolatedQuantity['density'];
      let inverseOfDensityAtOriginSquared = 1.0  / (densityAtOrigin * densityAtOrigin);
      let interpolatedQuantityAtOrigin = this.interpolatedQuantity[nameOfInterpolatedQuantity];
      var iQDivBySqOfInvDens = interpolatedQuantityAtOrigin * inverseOfDensityAtOriginSquared;
      var sum = 0.0;
      for(var i = 0; i < this.searchResults.length; i++){
        //Gradient Parameters
        let kernalObject = this.kernalObjects[i];
        let searchResult = this.searchResults[i];
        let distance = searchResult.distance;
        let directionToCenter = searchResult.vect2Point;

        //Coeficient parameters
        let particle = this.searchResults[i].point;
        let inverseOfParticleDensitySquared = particle.inverseDensity * particle.inverseDensity;

        sum += (iQDivBySqOfInvDens + inverseOfParticleDensitySquared * particle[nameOfInterpolatedQuantity]) * kernalObject.gradient(distance, directionToCenter);
      });

      return densityAtOrigin * this.particleMass * sum;
    }

    this.laplacianOf(nameOfInterpolatedQuantity){
      var sum = 0.0;
      var interpolatedQuantityAtOrigin = this.interpolatedQuantity[nameOfInterpolatedQuantity];
      for(var i = 0; i < this.searchResults.length; i++){
        var particle = this.searchResults[i].point;
        sum += (particle[nameOfInterpolatedQuantity] - interpolatedQuantityAtOrigin) * particle.inverseDensity * this.kernalObjects[i].mullerSpikyKernalSecondDerivative;
      });

      return this.particleMass * sum;
    }
  }
}

function InterpolatorConstants(influenceRadius){
  this.influenceRadius = influenceRadius;
}
