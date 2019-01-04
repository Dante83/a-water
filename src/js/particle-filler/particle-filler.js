function ParticleFiller(particleSystem, collidableScene, fluidCollisionBound){
  //
  //NOTE: We want to construct this after we have both the particle system,
  //and the static environment set up. Particles will then be added into the system,
  //such that they fill in the space between those particles and then forces will
  //be minimized.
  //
  this.particles = [];
  this.particleSystem = particleSystem;
  this.bucketGrid = particleSystem.bucketGrid;
  this.shouldCollideWithTheseBuckets = fluidCollisionBound;
  this.shouldNotCollideWithTheseBuckets = collidableScene;
  var thisParticleFiller = this;

  this.fillMesh = function(){
    //
    //For testing purposes. Honestly, we need to figure out the steady state density for our particles.
    //That is, the point at which all the forces on our particles are zero. We might even require optimization
    //methods if our particle density varies with position.
    //
    let density = 8.0 / (this.particleSystem.particleConstants.radius);

    //Periodically add points to our system such that it matches the target density.
    let cubedRootOfDensity = density ** (1.0 / 3.0);
    let bucketGridLengthInMeters = thisParticleFiller.bucketGrid.gridLengthInMeters;
    let xPoints = Math.ceil(cubedRootOfDensity * bucketGridLengthInMeters[0]);
    let yPoints = Math.ceil(cubedRootOfDensity * bucketGridLengthInMeters[1]);
    let zPoints = Math.ceil(cubedRootOfDensity * bucketGridLengthInMeters[2]);
    let startingPosition = thisParticleFiller.bucketGrid.gridLowerCoordinates.slice(0);
    let endingPosition = thisParticleFiller.bucketGrid.gridUpperCoordinates.slice(0);

    let xDiff = (endingPosition[0] - startingPosition[0]) / xPoints;
    let yDiff = (endingPosition[1] - startingPosition[1]) / yPoints;
    let zDiff = (endingPosition[2] - startingPosition[2]) / zPoints;

    //For our particle system to add the particles
    let newPositions = [];
    let newVelocities = []; //NOTE: In the future, maybe we want to make these non-static and expand upon this class a bit more?

    let xPosition = startingPosition[0];
    for(let x = 0; x < xPoints; x++){
      let yPosition = startingPosition[1];
      for(let y = 0; y < yPoints; y++){
        let zPosition = startingPosition[2];
        for(let z = 0; z < zPoints; z++){
          //Hash point position.
          //
          //TODO: This specifically tests if it is TRULY inside of the mesh, but ignores buckets that just collide with the mesh
          //but are not entirely in either category. These should be handled individually in a seperate if branch that
          //check the particle in the event that it falls along the edge to determine inside verses outside.
          //
          let hash = thisParticleFiller.bucketGrid.getHashKeyFromPosition([xPosition, yPosition, zPosition]);
          if((hash in thisParticleFiller.bucketGrid.hashedBuckets) &&
            thisParticleFiller.shouldCollideWithTheseBuckets[hash].isInMesh &&
            !thisParticleFiller.shouldNotCollideWithTheseBuckets[hash].isInMesh
          ){
            newPositions.push([xPosition, yPosition, zPosition]);
            newVelocities.push([0.0,0.0,0.0]);
          }
          zPosition += zDiff;
        }
        yPosition += yDiff;
      }
      xPosition += xDiff;
    }

    //Ready to display those extra particles :D
    this.particleSystem.parentFluidParams.el.emit('draw-collided-points', {collidedPoints: newPositions});

    //Let's stop right here. We want to make sure we have actually added the particles
    //but first I need to make sure they're actually inside.
    thisParticleFiller.particleSystem.addParticles(newPositions, newVelocities);
  };
}
