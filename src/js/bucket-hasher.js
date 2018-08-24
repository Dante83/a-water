/**
* Bucket Grid
*
* Provides us with a hashed grid that we can use to accelerate the search for all
* nearby registered points to the given bucket.
*/
//TODO: In the future, rather than checking all the particles every time
//instead estimate it's time of departure and check back and recalculate
//the departure time at X% of the departure time. (try different values to see how it works)

function BucketGrid(approximateSearchDiameter, bucketGridID, parentParticleSystem){
  this.buckets = [];
  this.hashedBuckets = {};
  this.bucketGridID = bucketGridID;
  this.bucketsNeedingUpdates = [];
  this.approximateSearchDiameter = approximateSearchDiameter;
  this.numberOfCriticalDigits = -1.0 * Math.log(this.approximateSearchDiameter) / Math.log(10);
  this.gridUpperCoordinates = {x: false, y: false, z: false};
  this.gridLowerCoordinates = {x: false, y: false, z: false};
  this.gridLength = {x: false, y: false, z: false};
  var thisBucketGrid = this;
  this.parentParticleSystem = parentParticleSystem;

  this.getHashKeyFromPosition = function(position){
    var bucketGridLocalCoordinates = position.foreach(function(x, i){return (x - this.gridUpperCoordinates[i];});
    var gridAxialIndexCoordinates = bucketGridLocalCoordinates.foreach(function(x, i){return Math.floor(x / this.approximateSearchDiameter);});
    return (gridAxialIndexCoordinates[0] * 3) + (gridAxialIndexCoordinates[1] * 3 + 1) + (gridAxialIndexCoordinates[2] * 3 + 2);
  }

  function Bucket(upperCorner, lowerCorner, parentBucketGrid){
    this.points = [];
    this.pointsMarkedForRemoval = [];
    this.pointsMarkedForAddition = [];
    this.corners = [];
    this.connectedBuckets = {};
    this.needsUpdate = false;
    this.parentBucketGrid = parentBucketGrid;
    var thisBucket = this;

    for(var i = 0; i < 8; i++){
      //Iterate through all permuations/combinations between the upper and lower corner points
      var useUpperCorner = Array.from((dec >>> 0).toString(2), function(elem){return elem === '1' ? true : false;});
      var newCorner = new PointCoord(0.0, 0.0, 0.0);
      for(var j = 0; j < 3; j++){
        if(useUpperCorner){
          newCorner.setCoordByNum(j,  upperCorner[j]);
        }
        else{
          newCorner.setCoordByNum(j,  lowerCorner[j]);
        }
      }
      this.corners []= newCorner;
    }

    var center = [];
    for(var i = 0; i < 3; i++){
      center.push((upperCorner[i] + lowerCorner[i]) * 0.5);
    }
    this.hashKey = this.getHashKeyFromPosition(center);
    this.center = {x: center[0], y: center[1], z: center[2]};

    this.addPoint = function(point){
      //Time to request an object update
      this.needsUpdate = true;
      if(!this.bucketsNeedingUpdates.includes(thisBucket)){
        this.bucketsNeedingUpdates.push(thisBucket);
      }

      //Add this point to the bucket
      this.markPointForAddition(point);

      //Detach this point from the original bucket if such a bucket exists
      if(point.bucketGrids[this.bucketGridID].bucket !== false){
        point.bucketGrids[this.bucketGridID].bucket.markPointForRemoval(point);
      }

      //Set this points bucket for this bucket grid to this bucket
      point.bucketGrids[this.bucketGridID].bucket = thisBucket;

      //
      //TODO: This would be an excellent stage to predict this particles departure time from this bucket
      //
    }

    this.addPoints(points){
      this.needsUpdate = true;
      if(!this.bucketsNeedingUpdates.includes(thisBucket)){
        this.bucketsNeedingUpdates.push(thisBucket);
      }

      //Add all of these points to the bucket
      this.pointsMarkedForAddition = [...pointsMarkedForAddition, ...points];

      //Add this point to the bucket
      this.markPointsForAddition(points);

      //Detach this point from the original bucket if such a bucket exists
      var filteredPoints = points.filter((x) => x !== false);
      if(filteredPoints.length > 0){
        point.bucketGrids[this.bucketGridID].bucket.markPointsForRemoval(filteredPoints);
      }

      //Set this points bucket for this bucket grid to this bucket
      points.foreach(function(point){
        point.bucketGrids[this.bucketGridID].bucket = thisBucket;
      });

      //
      //TODO: This would be an excellent stage to predict the departure times for each of these particles
      //
    }

    //We don't actualy 'remove points' unless they're being detached from the grid entirely
    this.detachPointFromGrid = function(point){
      delete point.bucketGrids[this.bucketGridID];
      this.markPointForRemoval[point];
    }

    this.markPointsForAddition = function(points){
      this.pointsMarkedForAddition = [...this.pointsMarkedForAddition, ...points];
    }

    this.markPointForAddition = function(point){
      this.pointsMarkedForAddition.push(point);
    }

    this.markPointForRemoval = function(point){
      this.pointsMarkedForRemoval.push(point);
    }

    this.markPointsForRemoval = function(points){
      this.pointsMarkedForRemoval = [...this.pointsMarkedForRemoval, ...points];
    }

    this.flushPoints = function(){
      var newPoints;

      //Note: Ideally, we'd just do a property swap for each pair exchange. Buckets,
      //after all, not only lose particles, but also gain them, and particles are effectively
      //exchangable (you can't tell one particle from another). Then you'd only have to swap properties
      //instead of reconstructing the entire particle list (as filtering particles can be a bit expensive)
      //But, for now, this should work rather well and is at least a little more optimized then normal.
      for(var i = 0; i < this.points.length; i++){
        var point = this.points[i];
        if(!(this.pointsMarkedForRemoval.includes(point) || this.pointsMarkedForAddition.includes(point))){
          newPoints.push(this.points[i]);
        }
      }

      this.points = newPoints;
      this.pointsMarkedForRemoval = [];
      this.pointsMarkedForAddition = [];
      this.needsUpdate = false;
    }
  }

  this.addBucket = function(upperCorner){
    var lowerCorner = upperCorner.map((x) => x - this.approximateSearchDiameter);
    this.buckets.push(new Bucket(upperCorner, lowerCorner, thisBucketGrid));
    this.hashedBuckets[this.buckets[this.buckets.length - 1].hashKey] = this.buckets[this.buckets.length - 1];

    var coords = ['x', 'y', 'z'];
    coords.foreach(function(coord){
      var previousVal = this.gridUpperCoordinates[coord];
      if(previousVal === false || previousVal < upperCorner[coord]){
        this.gridUpperCoordinates[coord] = upperCorner[coord];
      }

      var previousVal = this.gridLowerCoordinates[coord];
      if(previousVal === false || previousVal > lowerCorner[coord]){
        this.gridLowerCoordinates[coord] = lowerCorner[coord];
      }

      //Presume a cube structure
      this.gridLength[coord] = round((this.gridUpperCoordinates[coord] - this.gridLowerCoordinates[coord]) / radius, 1);
    });
  }

  this.connectBuckets(){
    this.buckets.foreach(function(bucket){
      var center = bucket.center;
      //Yes, there ARE a whole bunch of corner buckets, but we don't actually require them for our purposes and the suffering
      //of naming things (Genesis 2:19... it never ends O_O) is real. Like, what necessarily defines forward, back, up, down, or right or left.
      //Z seems like a fine coordinate to make my 'up', but I think Three JS actually thinks Y is up. Weird little program...
      //In the event that we need those, I have also made these 'axial' so that I can include the 'corner' cases later -
      //that is, probably when we need to predict when particles are leaving a given grid.
      var currentHash = this.getHashKeyFromPosition([center.x - 1, center.y, center.z]);
      var xMinus1 = this.hashedBuckets.includes(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;
      currentHash = this.getHashKeyFromPosition([center.x + 1, center.y, center.z]);
      var xPlus1 = this.hashedBuckets.includes(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;
      currentHash = this.getHashKeyFromPosition([center.x, center.y - 1, center.z]);
      var yMinus1 = this.hashedBuckets.includes(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;
      currentHash = this.getHashKeyFromPosition([center.x, center.y + 1, center.z]);
      var yPlus1 = this.hashedBuckets.includes(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;
      currentHash = this.getHashKeyFromPosition([center.x, center.y, center.z - 1]);
      var zMinus1 = this.hashedBuckets.includes(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;
      currentHash = this.getHashKeyFromPosition([center.x, center.y, center.z + 1]);
      var zPlus1 = this.hashedBuckets.includes(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;

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
    });
  }

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
  }

  this.findPointsInSphere = function(position, radius){
    var potentialPoints = this.getPotentialPointsForSearch(position, radius);
    var foundPoints = [];
    var radiusSquared = radius * radius;
    for(var i = 0; i < potentialPoints.length; i++){
        var potentialPoint = potentialPoints[i];
        var xDiff = potentialPoint.x - position.x;
        var yDiff = potentialPoint.y - position.y;
        var zDiff = potentialPoint.z - position.z;
        var sumOfSquares = xDiff * xDiff + yDiff * yDiff + zDiff + zDiff;
        if(sumOfSquares < radiusSquared){
          var distance = Math.sqrt(sumOfSquares);
          var inverseDistance = 1.0 / distance;
          foundPoints.push({
            point: potentialPoints[i],
            distance: distance,
            distanceSquared: sumOfSquares,
            inverseDistance: inverseDistance,
            vect2Point: {x: xDiff * inverseDistance, y: yDiff * inverseDistance, z: zDiff * inverseDistance}
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
  }

  this.updateParticles(particles){
    var particlesToAddByHash = [];
    particles.foreach(function(particle){
      var newHash = this.getHashKeyFromPosition([particle.position.x, particle.position.y, particle.position.z]);
      if(newHash !== particle.bucketGrids[this.bucketGridID].bucket.hashKey){
        if(!particlesToAddByHash.includes(newHash)){
          particlesToAddByHash[newHash] = [];
        }
        particlesToAddByHash[newHash].push(particle);
      }
    });
    particlesToAddByHash.foreach(function(particleCollection, hashKey){
      this.hashedBuckets[hashKey].addParticles(particleCollection);
    });
  }

  this.flush(){
    this.bucketsNeedingUpdates.foreach(function(bucket){
      bucket.flush();
    });
    this.bucketsNeedingUpdates = [];
  }

  function PointCoord(x, y, z){
    this.x = x;
    this.y = y;
    this.z = z;

    function setCoordByNum(coordNum,  value){
      if(coordNum === 0){
        this.x = value;
      }
      else if(coordNum === 1){
        this.y = value;
      }
      else if(coordNum === 2){
        this.z = value;
      }
      else{
        this.errorOnce('serCoordByNumError', 'Invalid number entered into setCoordByNum.');
      }
    }
  }

  //
  //Logging stuff
  //
  this.logs = {};
  function errorOnce(name, msg){
    if(self.logs[name] !== 'logged'){
      self.logs[name] = 'logged';
      console.error(msg);
    }
  };
}
