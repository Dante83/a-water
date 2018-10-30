function ParticleFiller(particleSystem, bucketGrid, collidableScene, fluidCollisionBound){
  //
  //NOTE: We want to construct this after we have both the particle system,
  //and the static environment set up. Particles will then be added into the system,
  //such that they fill in the space between those particles and then forces will
  //be minimized.
  //
  this.particles = [];
  this.bucketGrid = bucketGrid;
  this.particleSystem = particleSystem;
  this.shouldCollideWithTheseBuckets = fluidCollisionBound.filterBucketsInsideVersesOutside();
  this.shouldNotCollideWithTheseBuckets = collidableScene.filterBucketsInsideVersesOutside();
  var thisParticleFiller = this;

  this.fillMesh = function(targetDensity){
    //Periodically add points to our system such that it matches the target density.
    let cubedRootOfDensity = targetDensity ** (1.0 / 3.0);
    let bucketGridLengthInMeters = thisParticleFiller.bucketGrid.gridLengthInMeters;
    let xPoints = Math.ceil(cubedRootOfDensity * bucketGridLengthInMeters[0]);
    let yPoints = Math.ceil(cubedRootOfDensity * bucketGridLengthInMeters[1]);
    let zPoints = Math.ceil(cubedRootOfDensity * bucketGridLengthInMeters[2]);
    let startingPosition = thisParticleFiller.bucketGrid.gridLowerCoordinates.slice(0);

    //For our particle system to add the particles
    let newPositions = [];
    let newVelocities = []; //NOTE: In the future, maybe we want to make these non-static and expand upon this class a bit more?

    for(let x = 0; x < xPoints; x++){
      let xPosition = startingPosition[0] + x * cubedRootOfDensity;
      for(let y = 0; y < yPoints; y++){
        let yPosition = startingPosition[1] + y * cubedRootOfDensity;
        for(let z = 0; z < zPoints; z++){
          let zPosition = startingPosition[2] + z * cubedRootOfDensity;

          //Hash point position.
          let hash = thisParticleFiller.bucketGrid.getHashKeyFromPosition([xPosition, yPosition, zPosition]);
          if(thisParticleFiller.shouldCollideWithTheseBuckets[hash].isInMesh &&
            !thisParticleFiller.shouldNotCollideWithTheseBuckets[hash].isInMesh
          ){
            newPositions.push([xPosition, yPosition, zPosition]);
            newVelocities.push([0.0,0.0,0.0]);
          }
        }
      }
    }

    thisParticleFiller.particleSystem.addParticles(newPositions, newVelocities);
  };
}
