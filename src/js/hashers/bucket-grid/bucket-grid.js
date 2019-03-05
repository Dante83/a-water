/**
* Bucket Grid
*
* Provides us with a hashed grid that we can use to accelerate the search for all
* nearby registered points to the given bucket.
*/
//TODO: In the future, rather than checking all the particles every time
//instead estimate it's time of departure and check back and recalculate
//the departure time at X% of the departure time. (try different values to see how it works)

function BucketGrid(upperCorner, lowerCorner, approximateSearchDiameter, bucketGridID, parentParticleSystem, bucketConstants, minDistanceFromStaticCollider){
  perfDebug.spotCheckPerformance('bucket grid initialization', true);
  this.buckets = [];
  this.hashedBuckets = {};
  this.bucketGridID = bucketGridID;
  this.bucketsNeedingUpdates = [];
  this.approximateSearchDiameter = approximateSearchDiameter;
  this.numberOfCriticalDigits = -1.0 * Math.log(this.approximateSearchDiameter) / Math.log(10);
  this.gridUpperCoordinates = [upperCorner[0], upperCorner[1], upperCorner[2]];
  this.gridLowerCoordinates = [lowerCorner[0], lowerCorner[1], lowerCorner[2]];
  this.gridLength = [0.0,0.0,0.0];
  this.gridLengthInMeters = [0.0,0.0,0.0];
  this.halfMaxInteger = Math.floor(Number.MAX_SAFE_INTEGER * 0.5);
  this.testingIterator = 0;
  this.minDistanceFromStaticCollider = minDistanceFromStaticCollider;

  let inverseRadius = parentParticleSystem.particleConstants.inverseRadius;
  for(let i = 0; i < 3; i++){
    let gridDimensions = this.gridUpperCoordinates[i] - this.gridLowerCoordinates[i];
    this.gridLengthInMeters[i] = gridDimensions;
    this.gridLength[i] = Math.ceil(gridDimensions * inverseRadius);
  }

  var thisBucketGrid = this;
  this.staticScene;
  this.tempColliders;
  this.parentParticleSystem = parentParticleSystem;
  this.bucketConstants = bucketConstants;
  this.particleConstants = parentParticleSystem.particleConstants;
  perfDebug.spotCheckPerformance('bucket grid initialization', false);

  perfDebug.spotCheckPerformance('bucket grid function initialization', true);
  this.getHashKeyFromPosition = function(position){
    perfDebug.spotCheckPerformance('get hash key', true);
    let bucketGridLocalCoordinates = [];
    let inverseRadius = this.particleConstants.inverseRadius;
    bucketGridLocalCoordinates[0] = Math.floor((position[0] - thisBucketGrid.gridLowerCoordinates[0]) * inverseRadius);
    bucketGridLocalCoordinates[1] = Math.floor((position[1] - thisBucketGrid.gridLowerCoordinates[1]) * inverseRadius);
    bucketGridLocalCoordinates[2] = Math.floor((position[2] - thisBucketGrid.gridLowerCoordinates[2]) * inverseRadius);

    let hashSection1 = bucketGridLocalCoordinates[0];
    let hashSection2 = hashSection1 + bucketGridLocalCoordinates[1] * 1024;
    let finalHash = hashSection2 + bucketGridLocalCoordinates[2] * 1048576;
    perfDebug.spotCheckPerformance('get hash key', false);
    return finalHash.toString();
  }

  this.addBucket = function(upperCorner, radius){
    var lowerCorner = upperCorner.map((x) => x - radius);
    let newBucket = new Bucket(upperCorner, lowerCorner, thisBucketGrid);
    let center = newBucket.getCenter();
    let bucketHash = this.getHashKeyFromPosition(center);
    newBucket.hash = bucketHash;
    this.buckets.push(newBucket);
    this.hashedBuckets[bucketHash] = newBucket;
  };

  this.connectBuckets = function(){
    perfDebug.spotCheckPerformance('connect buckets', true);
    let offset = this.approximateSearchDiameter;
    let bucketHashes = Object.keys(this.hashedBuckets).map(x => parseInt(x));
    for(let i = 0, numBuckets = this.buckets.length; i < numBuckets; i++){
      let bucket = this.buckets[i];
      let center = bucket.getCenter();
      //Yes, there ARE a whole bunch of corner buckets, but we don't actually require them for our purposes and the suffering
      //of naming things (Genesis 2:19... it never ends O_O) is real. Like, what necessarily defines forward, back, up, down, or right or left.
      //Z seems like a fine coordinate to make my 'up', but I think Three JS actually thinks Y is up. Weird little program...
      //In the event that we need those, I have also made these 'axial' so that I can include the 'corner' cases later -
      //that is, probably when we need to predict when particles are leaving a given grid.
      let currentHash = thisBucketGrid.getHashKeyFromPosition([center[0] - offset, center[1], center[2]]);
      let xMinus1 = currentHash in this.hashedBuckets ? this.hashedBuckets[currentHash] : false;
      currentHash = thisBucketGrid.getHashKeyFromPosition([center[0] + offset, center[1], center[2]]);
      let xPlus1 = currentHash in this.hashedBuckets ? this.hashedBuckets[currentHash] : false;
      currentHash = thisBucketGrid.getHashKeyFromPosition([center[0], center[1] - offset, center[2]]);
      let yMinus1 = currentHash in this.hashedBuckets ? this.hashedBuckets[currentHash] : false;
      currentHash = thisBucketGrid.getHashKeyFromPosition([center[0], center[1] + offset, center[2]]);
      let yPlus1 = currentHash in this.hashedBuckets ? this.hashedBuckets[currentHash] : false;
      currentHash = thisBucketGrid.getHashKeyFromPosition([center[0], center[1], center[2] - offset]);
      let zMinus1 = currentHash in this.hashedBuckets ? this.hashedBuckets[currentHash] : false;
      currentHash = thisBucketGrid.getHashKeyFromPosition([center[0], center[1], center[2] + offset]);
      let zPlus1 = currentHash in this.hashedBuckets ? this.hashedBuckets[currentHash] : false;

      var connections ={
        axial:{
          x:{
            minus1: xMinus1,
            plus1: xPlus1,
          },
          y:{
            minus1: yMinus1,
            plus1: yPlus1
          },
          z:{
            minus1: zMinus1,
            plus1: zPlus1
          }
        }
      }

      bucket.connectedBuckets = connections;
      let listOfPossibleConnectedBuckets = [xMinus1, xPlus1, yMinus1, yPlus1, zMinus1, zPlus1];
      bucket.listOfConnectedBuckets = listOfPossibleConnectedBuckets.filter(x => x !== false);
    };
    perfDebug.spotCheckPerformance('connect buckets', false);
  };

  this.getPotentialPointsForSearch = function(inPosition, radius){
    let position = inPosition.isVector3 ? inPosition.toArray() : inPosition;
    var hashOfUpperCornerBucket = this.getHashKeyFromPosition(position.map((x) => x + radius));
    var hashofLowerCornerBucket = this.getHashKeyFromPosition(position.map((x) => x - radius));
    var pointsFound = [];
    var pointCollections = [];

    var rowRange = 0;
    var currentBucket = this.hashedBuckets[hashOfUpperCornerBucket];
    var lowerCornerBucket = this.hashedBuckets[hashofLowerCornerBucket];
    if(!currentBucket || !lowerCornerBucket){
      return [];
    }
    var searchLengthInBuckets = Math.round((currentBucket.getCenter()[0] - lowerCornerBucket.getCenter()[0]) / this.approximateSearchDiameter);

    //Fill in that curve
    var goDownZ = true;
    var goDownY = true;
    for(var x = 0; x < searchLengthInBuckets; x++){
      for(var y = 0; y < searchLengthInBuckets; y++){
        for(var z = 0; z < searchLengthInBuckets; z++){
          if(goDownZ){
            currentBucket = currentBucket.connectedBuckets.axial.z.minus1;
          }
          else{
            currentBucket = currentBucket.connectedBuckets.axial.z.plus1;
          }
          pointCollections.push(currentBucket.points);
        }
        goDownZ = !goDownZ;

        if(goDownY){
          currentBucket = currentBucket.connectedBuckets.axial.y.minus1;
        }
        else{
          currentBucket = currentBucket.connectedBuckets.axial.y.plus1;
        }
      }
      goDownY = !goDownY;

      //Go one down along x
      currentBucket = currentBucket.connectedBuckets.axial.x.minus1;
    }

    return pointsFound.concat(...pointCollections);
  };

  this.findPointsInSphere = function(position, radius, excludedParticleID){
    let potentialPoints = this.getPotentialPointsForSearch(position, radius);

    let foundPoints = [];
    let radiusSquared = radius * radius;
    for(var i = 0, potentialPointsLength = potentialPoints.length; i < potentialPointsLength; i++){
      if(potentialPoints[i].id !== excludedParticleID){
        let potentialPosition = potentialPoints[i].position;
        let xDiff = potentialPosition.x - position.x;
        let yDiff = potentialPosition.y - position.y;
        let zDiff = potentialPosition.z - position.z;
        let sumOfSquares = xDiff * xDiff + yDiff * yDiff + zDiff * zDiff;
        if(sumOfSquares < radiusSquared){
          let distance = Math.sqrt(sumOfSquares);
          let inverseDistance = 1.0 / distance;
          foundPoints.push({
            point: potentialPoints[i],
            distance: distance,
            distanceSquared: sumOfSquares,
            vect2Point: new THREE.Vector3(xDiff * inverseDistance, yDiff * inverseDistance, zDiff * inverseDistance)
          });
        }
      }
    }

    return foundPoints;

    //
    //TODO: In the future, we can probably do a variation of this that is attached to a particular particle and radius.
    //Then, we can cache the particles involved and even the buckets, and if all the buckets associated with this particle contain
    //the same number of particles, we might presume that our found points are the same as before, with, perhaps, a linear interpolated distance squared.
    //
  };

  this.updateParticles = function(particles){
    let particlesToAddByHash = [];
    for(let i = 0, particlesLength = particles.length; i < particlesLength; particles++){
      let particle = particles[i];
      let newHash = this.getHashKeyFromPosition([particle.position.x, particle.position.y, particle.position.z]);
      if(newHash !== particle.bucketGrids[thisBucketGrid.bucketGridID].bucket.hashKey){
        if(!particlesToAddByHash.includes(newHash)){
          particlesToAddByHash[newHash] = [];
        }
        particlesToAddByHash[newHash].push(particle);
      }
    }

    particlesToAddByHash.foreach(function(particleCollection, hashKey){
      this.hashedBuckets[hashKey].addParticles(particleCollection);
    });
  };

  this.flushPoints = function(){
    let buckets = this.bucketsNeedingUpdates;
    for(let i = 0, bucketsLength = buckets.length; i < bucketsLength; i++){
      buckets[i].flushPoints();
    }
    this.bucketsNeedingUpdates = [];
  };

  this.constructStaticMeshOctree = function(){
    for(let i = 0, bucketsLength = this.buckets.length; i < bucketsLength; i++){
      let bucket = this.buckets[i];
      bucket.constructStaticMeshOctree();
    }
  };
  perfDebug.spotCheckPerformance('bucket grid function initialization', false);

  //
  //Logging stuff
  //
  this.logs;
  this.errorOnce = function(name, msg){
    if(self.logs[name] !== 'logged'){
      self.logs[name] = 'logged';
      console.error(msg);
    }
  };
}

//With a bit of help from https://www.redblobgames.com/grids/line-drawing.html
BucketGrid.prototype.getSuperCoverOfLine = function(startingPoint, endingPoint, particle){
  let bcUCT = this.bucketConstants.unitCoordinateTransform;
  let bucketWidth = this.bucketConstants.bucketWidth;
  let delta = [(endingPoint.x - startingPoint.x) * bcUCT, (endingPoint.y - startingPoint.y) * bcUCT, (endingPoint.z - startingPoint.z) * bcUCT];
  let maxNumPoints = new THREE.Vector3(delta.map((x) => Math.abs(x)));
  let goForwardAlong = new THREE.Vector3(delta.map((x) => Math.sign(x)));
  let walkingPoint = startingPoint.toArray();

  //Initialize our supercover to include our starting point if it is in the bucket.
  let supercover = [];
  let startingHash = this.getHashKeyFromPosition(walkingPoint);
  if(startingHash in this.hashedBuckets){
    supercover.push(this.hashedBuckets[startingHash]);
  }
  if(this.getHashKeyFromPosition(endingPoint.toArray()) === startingHash){
    return supercover;
  }

  let i = new THREE.Vector3();
  let effectiveZero = bucketWidth * 0.0001;
  while(i.x < maxNumPoints.x || i.y < maxNumPoints.y || i.z < maxNumPoints.z){
    let xTest = (0.5+i.x) / maxNumPoints.x;
    let yTest = (0.5+i.y) / maxNumPoints.y;
    let zTest = (0.5+i.z) / maxNumPoints.z;
    let testDiagonalXY = Math.abs(xTest - yTest) < effectiveZero;
    let testDiagonalXZ = Math.abs(xTest - zTest) < effectiveZero;
    let testDiagonalYZ = Math.abs(yTest - zTest) < effectiveZero;
    let hash;
    if(testDiagonalXY || testDiagonalXZ || testDiagonalYZ){
      //The next step is diagonal...
      if(testDiagonalXY && testDiagonalXZ && testDiagonalYZ){
        //Along x, y and z...
        walkingPoint[0] += goForwardAlong.x;
        walkingPoint[1] += goForwardAlong.y;
        walkingPoint[2] += goForwardAlong.z;
        i.x++;
        i.y++;
        i.z++;
      }
      else if(testDiagonalXY && testDiagonalXZ){
        //Along y-z
        walkingPoint[1] += goForwardAlong.y;
        walkingPoint[2] += goForwardAlong.z;
        i.y++;
        i.z++;
      }
      else if(testDiagonalXZ && testDiagonalYZ){
        //Along x-y
        walkingPoint[0] += goForwardAlong.x;
        walkingPoint[1] += goForwardAlong.y;
        i.x++;
        i.y++;
      }
      else{
        //Along x-z
        walkingPoint[0] += goForwardAlong.x;
        walkingPoint[2] += goForwardAlong.z;
        i.x++;
        i.z++;
      }
    }
    else if(xTest < yTest && xTest < zTest){
      //Moves along x
      walkingPoint[0] += goForwardAlong.x;
      i.x++;
    }
    else if(yTest < xTest && yTest < zTest){
      //Moves along y
      walkingPoint[1] += goForwardAlong.y;
      i.y++;
    }
    else{
      //Moves along z
      walkingPoint[2] += goForwardAlong.z;
      i.z++;
    }

    //Retransform back into or our original coordinate system
    transformedWalkingPoint = [];
    transformedWalkingPoint.push(walkingPoint[0] * bucketWidth);
    transformedWalkingPoint.push(walkingPoint[1] * bucketWidth);
    transformedWalkingPoint.push(walkingPoint[2] * bucketWidth);
    hash = this.getHashKeyFromPosition(walkingPoint);
    if(hash in this.hashedBuckets){
      supercover.push(this.hashedBuckets[hash]);
    }
  }

  //Return our supercover
  return supercover;
};

BucketGrid.prototype.resolveStaticMeshCollision = function(particle, endingPosition, endingVelocity){
  //Get the starting position
  let startingPosition = particle.lastPosition;

  //Note: To reduce the cost of this function, it should only run for particles that either start or
  //end on with a colliding or in static mesh bucket. This allows most of our buckets to ignore
  //the static collision engine.

  //Check if the starting position is inside of our mesh. If so, return the particle to the
  //nearest point on the surface of the mesh and set it's velocity to zero.
  // let startingBucket = this.hashedBuckets[this.getHashKeyFromPosition(startingPosition.toArray())];
  // let initialParticleCollisionState = startingBucket.isPointInStaticMesh(startingPosition);
  // if(initialParticleCollisionState.collidesWithMesh){
  //   endingPosition = initialParticleCollisionState.collisionPoint;
  //   endingVelocity = new THREE.Vector3();
  //   return true;
  // }

  //Get the super-cover of all buckets between these two points.
  //if the starting and ending bucket are the same, presume that this is the super cover.
  let supercoverOfParticleMotion = this.getSuperCoverOfLine(startingPosition, endingPosition, particle);
  if(supercoverOfParticleMotion.length === 0){
    if(particle.id === 0){
      this.testingIterator += 1;
      this.testingIterator = this.testingIterator % 260;
    }
    return false;
  }

  if(particle.id === 0){
    if(this.testingIterator === 0){
      this.parentParticleSystem.parentFluidParams.el.emit('draw-moving-buckets', {
        particleSystem: this.parentParticleSystem,
        trackedBuckets: supercoverOfParticleMotion
      });
    }
    this.testingIterator += 1;
    this.testingIterator = this.testingIterator % 10;
  }

  //For each of these buckets, determine if any intersect our mesh.
  //If it does, add all the triangles into a set.
  let faces = [];
  for(let i = 0; i < supercoverOfParticleMotion.length; i++){
    let bucket = supercoverOfParticleMotion[i];
    if(bucket.instersectsStaticMesh){
      let staticMeshPoints = bucket.staticMeshPoints;
      for(let j = 0; j < staticMeshPoints.length; j++){
        let staticMeshPointFaces = staticMeshPoints[j].faces;
        for(let k = 0; k < staticMeshPointFaces.length; k++){
          if(faces.indexOf(staticMeshPointFaces[k]) === -1){
            faces.push(staticMeshPointFaces[k]);
          }
        }
      }
    }
  }
  //If we still have no faces then just let our particle go.
  if(faces.length === 0){
    return false;
  }

  //Prime the loop
  let originalVect = endingPosition.clone().sub(startingPosition);
  let orginalVectDistSq = originalVect.dot(originalVect)
  let distanceSquare2Beat = orginalVectDistSq;
  let triangle;
  let closestFace;
  let closestPoint2Face = new THREE.Vector3();
  let collisionPoint = new THREE.Vector3();
  let noIntersectingPointFound = true;
  let ray = new THREE.Ray(startingPosition, originalVect.clone().multiplyScalar(1.0 / Math.sqrt(orginalVectDistSq)));
  let closestDistanceSquared;
  //Iterate this for the other faces
  for(let i = 0; i < faces.length; i++){
    triangle = faces[i].triangle;
    let intersectsTriangle = ray.intersectTriangle(triangle.a, triangle.b, triangle.c, true, closestPoint2Face);
    if(intersectsTriangle !== null){
      let distanceSquared = startingPosition.distanceToSquared(closestPoint2Face);
      if(distanceSquare2Beat < distanceSquared){
        noIntersectingPointFound = false;
        collisionPoint = closestPoint2Face.clone();
        distanceSquare2Beat = distanceSquared;
        closestFace = faces[i];
      }
    }
  }
  if(noIntersectingPointFound){
    return false;
  }

  //
  //NOTE: In the future, we might want to include paintable friction
  //based on the triangle for better water solutions.
  //
  //Flip the normal of our particle about the triangle and return and ending
  //position along this ray equal to the depth inside the mesh, to assume a
  //perfectly elastic (frictionless) collision.
  let intersectedRay = endingPosition.clone().sub(collisionPoint);
  endingPosition = intersectedRay.reflect(closestFace.normal).negate();
  if(this.minDistanceFromStaticCollider > Math.sqrt(intersectedRay.clone().dot(intersectedRay))){
    console.log("BLING!");
    endingPosition.setLength(this.minDistanceFromStaticCollider);
  }
  endingPosition.add(collisionPoint);
  endingVelocity.reflect(closestFace.normal);

  return true;
};

function BucketConstants(bucketWidth){
  this.bucketWidth = bucketWidth;
  this.unitCoordinateTransform = 1.0 / bucketWidth;
  function pad(n, width) {
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join('0') + n;
  }

  this.bucketCornerIndices = [];
  for(let i = 0; i < 8; i++){
    this.bucketCornerIndices.push(Array.from(pad((i >>> 0).toString(2), 3), function(elem){return elem === '1' ? true : false;}));
  }
  this.bucketFaceIndices = [];
  for(let i = 0; i < 4; i++){
    this.bucketFaceIndices.push(Array.from(pad((i >>> 0).toString(2), 2), function(elem){return elem === '1' ? true : false;}));
  }
}
