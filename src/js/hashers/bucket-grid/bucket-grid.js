/**
* Bucket Grid
*
* Provides us with a hashed grid that we can use to accelerate the search for all
* nearby registered points to the given bucket.
*/
//TODO: In the future, rather than checking all the particles every time
//instead estimate it's time of departure and check back and recalculate
//the departure time at X% of the departure time. (try different values to see how it works)

function BucketGrid(upperCorner, lowerCorner, approximateSearchDiameter, bucketGridID, parentParticleSystem, bucketConstants){
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
    bucketGridLocalCoordinates[0] = position[0] - thisBucketGrid.gridUpperCoordinates[0];
    bucketGridLocalCoordinates[1] = position[1] - thisBucketGrid.gridUpperCoordinates[1];
    bucketGridLocalCoordinates[2] = position[2] - thisBucketGrid.gridUpperCoordinates[2];

    let inverseRadius = this.particleConstants.inverseRadius;
    //Choosing a prime of 97 via https://planetmath.org/goodhashtableprimes
    let hashSection1 = Math.floor(bucketGridLocalCoordinates[0] * inverseRadius) * 97;
    let hashSection2 = (hashSection1 + (Math.floor(bucketGridLocalCoordinates[1] * inverseRadius) * 9409) % thisBucketGrid.halfMaxInteger);
    let finalHash = (hashSection2 + (Math.floor(bucketGridLocalCoordinates[2] * inverseRadius) * 912673) % thisBucketGrid.halfMaxInteger);
    perfDebug.spotCheckPerformance('get hash key', false);
    return finalHash;
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

  this.getPotentialPointsForSearch = function(position, radius){
    var hashOfUpperCornerBucket = this.getHashKeyFromPosition(position.map((x) => x + radius));
    var hashofLowerCornerBucket = this.getHashKeyFromPosition(position.map((x) => x - radius));
    var pointsFound = [];
    var pointCollections = [];

    var rowRange = 0;
    var currentBucket = this.hashedBuckets[hashOfUpperCornerBucket];
    var lowerCornerBucket = this.hashedBuckets[hashofLowerCornerBucket];
    var searchLengthInBuckets = Math.round((currentBucket.center.x - lowerCornerBucket.center.x) / this.approximateSearchDiameter);

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

  this.findPointsInSphere = function(position, radius){
    let potentialPoints = this.getPotentialPointsForSearch(position, radius);
    let foundPoints = [];
    let radiusSquared = radius * radius;
    for(var i = 0, potentialPointsLength = potentialPoints.length; i < potentialPointsLength; i++){
      let potentialPoint = potentialPoints[i];
      let xDiff = potentialPoint.x - position.x;
      let yDiff = potentialPoint.y - position.y;
      let zDiff = potentialPoint.z - position.z;
      let sumOfSquares = xDiff * xDiff + yDiff * yDiff + zDiff + zDiff;
      if(sumOfSquares < radiusSquared){
        let distance = Math.sqrt(sumOfSquares);
        let inverseDistance = 1.0 / distance;
        foundPoints.push({
          point: potentialPoints[i],
          distance: distance,
          vect2Point: new THREE.Vector3(xDiff * inverseDistance, yDiff * inverseDistance, zDiff * inverseDistance);
        });
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

function BucketConstants(){
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
