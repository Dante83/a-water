function ParticleFiller(particleSystem, staticCollisionBuckets, staticScene, fluidCollisionBuckets, fluidMesh){
  //
  //NOTE: We want to construct this after we have both the particle system,
  //and the static environment set up. Particles will then be added into the system,
  //such that they fill in the space between those particles and then forces will
  //be minimized.
  //
  this.particles = [];
  this.particleSystem = particleSystem;
  this.bucketGrid = particleSystem.bucketGrid;
  this.staticScene = staticScene;
  this.fluidMesh = fluidMesh;
  var self = this;

  this.fillMesh = function(targetSpacing){
    //
    //For testing purposes. Honestly, we need to figure out the steady state density for our particles.
    //That is, the point at which all the forces on our particles are zero. We might even require optimization
    //methods if our particle density varies with position.
    //
    let density = 8.0 / (targetSpacing);
    let staticScene = self.staticScene;
    let fluidMesh = self.fluidMesh;

    //Periodically add points to our system such that it matches the target density.
    let cubedRootOfDensity = density ** (1.0 / 3.0);
    let bucketGridLengthInMeters = self.bucketGrid.gridLengthInMeters;
    let xPoints = Math.ceil(cubedRootOfDensity * bucketGridLengthInMeters[0]);
    let yPoints = Math.ceil(cubedRootOfDensity * bucketGridLengthInMeters[1]);
    let zPoints = Math.ceil(cubedRootOfDensity * bucketGridLengthInMeters[2]);
    let startingPosition = self.bucketGrid.gridLowerCoordinates.slice(0);
    let endingPosition = self.bucketGrid.gridUpperCoordinates.slice(0);

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
          let hash = self.bucketGrid.getHashKeyFromPosition([xPosition, yPosition, zPosition]);
          let staticCollisionBucket = staticCollisionBuckets[hash];
          let fluidCollisionBucket = fluidCollisionBuckets[hash];
          let addPoint = false;
          if(hash in self.bucketGrid.hashedBuckets){
            if(staticCollisionBucket.isInMesh === false &&
              fluidCollisionBucket.isInMesh === true
            ){
              addPoint = true;
            }
            else{
              //As we're here, let's calculate the key components one at a time.
              let origin = new THREE.Vector3(xPosition, yPosition, zPosition);
              if(staticCollisionBucket.isInMesh === false && fluidCollisionBucket.isInMesh === null){
                //Just check that the point is in the fluid collision mesh
                addPoint = self.isOriginInMesh(origin, fluidMesh, hash);
              }
              else if(fluidCollisionBucket.isInMesh === true && staticCollisionBucket.isInMesh === null){
                //Just check that the point is outside of the static collision mesh.
                addPoint = !self.isOriginInMesh(origin, staticScene, hash);
              }
              else if(fluidCollisionBucket.isInMesh === null && staticCollisionBucket.isInMesh === null){
                //Check whether the point is both in the fluid collision mesh
                //and outside of the static collision mesh.
                addPoint = self.isOriginInMesh(origin, fluidMesh, hash);
                addPoint = addPoint && !self.isOriginInMesh(origin, staticScene, hash);
              }
            }
          }

          //Check our sentinal value from above.
          if(addPoint){
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
    self.particleSystem.addParticles(newPositions, newVelocities);
  };

  this.isOriginInMesh = function(origin, staticMesh, bucketHash){
    //Get the bucket hash and all nearby bucket hashes.
    let bucket = self.bucketGrid.hashedBuckets[bucketHash];
    let nearbyBucketHashes = bucket.listOfConnectedBuckets.map((x) => x.hash);
    let nearbyPoints = [];
    for(let i = 0; i < nearbyBucketHashes.length; i++){
      if(nearbyBucketHashes[i] in staticMesh.bucketCollisionPoints){
        nearbyPoints = [...nearbyPoints, ...staticMesh.bucketCollisionPoints[nearbyBucketHashes[i]]];
      }
    }
    nearbyPoints = [...nearbyPoints, ...staticMesh.bucketCollisionPoints[bucketHash]];

    //Now with all of our points, let's find the closest point and determine if it's inside or outside
    let faces = [];
    for(let i = 0; i < nearbyPoints.length; i++){
      faces = [...faces, ...nearbyPoints[i].faces];
    }

    //Now figure out the closest face to our collisionPoint
    let closestFace = faces[0];
    let nearbyFace = faces[0];
    let closestPointOnFace = new THREE.Vector3();
    nearbyFace.triangle.closestPointToPoint(origin, closestPointOnFace);

    if(faces.length > 1){
      let distToPointSq = origin.distanceToSquared(closestPointOnFace);
      //Get the closest collisionPoint on the first mesh face and the distance to that collisionPoint
      for(let i = 1, numMeshFaces = faces.length; i < numMeshFaces; i++){
        //Create a triangle from our mesh and then use the built in closest collisionPoint to collisionPoint method
        //from THREE JS in order to find the closest collisionPoint
        nearbyFace = faces[i];
        closestPointOnThisTriangle = new THREE.Vector3();
        nearbyFace.triangle.closestPointToPoint(origin, closestPointOnThisTriangle);

        //Check if the distance to this collisionPoint is less than the previous distance
        let newDistanceToPointSq = origin.distanceToSquared(closestPointOnThisTriangle);
        let testForInsideDistance = origin.clone().sub(closestPointOnThisTriangle).dot(nearbyFace.normal);
        if(newDistanceToPointSq < distToPointSq && Math.abs(testForInsideDistance) > 0.0001){
          //If it's closer, replace the previous face
          distToPointSq = newDistanceToPointSq;
          closestFace = nearbyFace;
          closestPointOnFace = closestPointOnThisTriangle;
        }
      }
    }

    return origin.sub(closestPointOnFace).dot(closestFace.normal.clone()) < 0.0;
  };
}
