/**
* Bucket Grid
*
* Provides us with a hashed grid that we can use to accelerate the search for all
* nearby registered points to the given bucket.
*/
//TODO: In the future, rather than checking all the particles every time
//instead estimate it's time of departure and check back and recalculate
//the departure time at X% of the departure time. (try different values to see how it works)

function BucketGrid(upperCorner, lowerCorner, approximateSearchDiameter, bucketGridID, parentParticleSystem, bucketConstants, performanceDebugger){
  performanceDebugger.spotCheckPerformance('bucket grid initialization', true);
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
  this.staticScene;
  this.parentParticleSystem = parentParticleSystem;
  this.bucketConstants = bucketConstants;
  this.particleConstants = parentParticleSystem.particleConstants;
  performanceDebugger.spotCheckPerformance('bucket grid initialization', false);

  performanceDebugger.spotCheckPerformance('bucket grid function initialization', true);
  this.getHashKeyFromPosition = function(position){
    performanceDebugger.spotCheckPerformance('get hash key', true);
    let bucketGridLocalCoordinates = [];
    bucketGridLocalCoordinates[0] = position[0] - thisBucketGrid.gridUpperCoordinates['x'];
    bucketGridLocalCoordinates[1] = position[1] - thisBucketGrid.gridUpperCoordinates['y'];
    bucketGridLocalCoordinates[2] = position[2] - thisBucketGrid.gridUpperCoordinates['z'];

    let inverseRadius = this.particleConstants.inverseRadius;
    let subCalculation1 = Math.floor(bucketGridLocalCoordinates[0] * inverseRadius) + Math.floor(bucketGridLocalCoordinates[1] * inverseRadius) + Math.floor(bucketGridLocalCoordinates[2] * inverseRadius);
    subCalculation1++;
    performanceDebugger.spotCheckPerformance('get hash key', false);
    return 3.0 * subCalculation1;
  }

  function PointCoord(x, y, z){
    this.x = x;
    this.y = y;
    this.z = z;

    this.setCoordByNum = function(coordNum,  value){
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
        thisBucketGrid.errorOnce('serCoordByNumError', 'Invalid number entered into setCoordByNum.');
      }
    }
  }

  /**
  *BEGIN Bucket Object
  */
  function Bucket(upperCorner, lowerCorner, parentBucketGrid){
    performanceDebugger.spotCheckPerformance('bucket initialization', true);
    this.points = [];
    this.particles = [];
    this.pointsMarkedForRemoval = [];
    this.pointsMarkedForAddition = [];
    this.upperCorner = upperCorner;
    this.lowerCorner = lowerCorner;
    this.faces = [];
    this.corners = [];
    this.connectedBuckets = {};
    this.needsUpdate = false;
    this.parentBucketGrid = parentBucketGrid;
    this.IntersectsStaticMesh = false;
    this.staticMeshSearchablePoints = [];
    this.staticMeshKDTree;
    var thisBucket = this;
    let bucketConstants = parentBucketGrid.bucketConstants;
    performanceDebugger.spotCheckPerformance('bucket initialization', false);

    performanceDebugger.spotCheckPerformance('construct corners', true);
    let upperCornerIndices = bucketConstants.bucketCornerIndices;
    for(let i = 0; i < 8; i++){
      //Iterate through all permuations/combinations between the upper and lower corner points
      var useUpperCorner = upperCornerIndices[i];
      var newCorner = new PointCoord(0.0, 0.0, 0.0);
      for(let j = 0; j < 3; j++){
        if(useUpperCorner[j]){
          newCorner.setCoordByNum(j,  upperCorner[j]);
        }
        else{
          newCorner.setCoordByNum(j,  lowerCorner[j]);
        }
      }
      this.corners.push(newCorner);
    }
    performanceDebugger.spotCheckPerformance('construct corners', false);

    performanceDebugger.spotCheckPerformance('construct faces', true);
    let center = [];
    for(var i = 0; i < 3; i++){
      center.push((upperCorner[i] + lowerCorner[i]) * 0.5);
    }
    this.hashKey = thisBucketGrid.getHashKeyFromPosition(center);
    this.center = center;
    //Construct all of our faces from these points
    //Note that a face contains points for which one axis is the same
    this.faces = [];
    let faceIndices = bucketConstants.bucketFaceIndices;
    for(let i = 0; i < 3; i++){
      //Hold the ith dimension from the upper corner constant...
      let coordinatesForFaceA = [];
      let coordinatesForFaceB = [];

      //For each corner
      performanceDebugger.spotCheckPerformance('construct faces inner loop', true);
      for(let j = 0; j < 4; j++){
        let useUpperCoordinateForThisDim = faceIndices[j];
        //For each coordinate in each corner
        let coordinateSetA = [];
        let coordinateSetB = [];
        let k = 0;
        for(let dim = 0; dim < 3; dim++){
          if(dim !== i){
            coordinateSetA.push(useUpperCoordinateForThisDim[k] ? upperCorner[dim] : lowerCorner[dim]);
            coordinateSetB.push(useUpperCoordinateForThisDim[k] ? lowerCorner[dim] : upperCorner[dim]);
            k = 1;
          }
          else{
            coordinateSetA.push(upperCorner[dim]);
            coordinateSetB.push(lowerCorner[dim]);
          }
        }
        coordinatesForFaceA.push(coordinateSetA);
        coordinatesForFaceB.push(coordinateSetB);
      }
      performanceDebugger.spotCheckPerformance('construct faces inner loop', false);
      //The face here is internal to buckets and not Face from THREE.JS
      performanceDebugger.spotCheckPerformance('construct faces trigger face constructors', true);
      this.faces.push(new Face(coordinatesForFaceA, this.center, i));
      this.faces.push(new Face(coordinatesForFaceB, this.center, i));
      performanceDebugger.spotCheckPerformance('construct faces trigger face constructors', false);
    }
    performanceDebugger.spotCheckPerformance('construct faces', false);

    /**
    *BEGIN Face Object
    */
    function Face(points, cubeCenter, constantAxis){
      this.points = points;
      this.plane;
      this.constantAxis = constantAxis;
      var thisFace = this;

      //Two of our lines off the same point should produce a perpendicular cross product equal to the normal vector (ignoring the sign)
      let normalVector = [0.0,0.0,0.0];
      normalVector[constantAxis] = 1.0 * Math.sign(points[0][constantAxis] - cubeCenter[constantAxis]);

      //The offset from the origin, because we're parallel to one of the axis - is
      //just the value in the one axis that does not change.
      let point4 = points[3];
      let offset = point4[0] * normalVector[0] + point4[1] * normalVector[0] + point4[2] * normalVector[0];

      //Now create a three js plane...
      //NOTE: We might just be able to copy over the three js code and update it to our needs,
      //thus avoiding a lot of costly computations for calculating the intersects line method.
      this.plane = new THREE.Plane(new THREE.Vector3(...normalVector), offset);
    };

    Face.prototype.flattenToXY = function(point, ignoreDimension){
      var xyOut = [];
      while(xyOut.length < 2){
        if(i !== thisFace.constantAxis){
          xyOut.push(thisFace.points[i]);
        }
      }

      return xyOut;
    }

    Face.prototype.isPointOnFace = function(point){
      //Center our plane and the point above at the origin, by removing the minimum coordinates;
      var offset = {
        x: Math.min(...thisFace.points.map((x) => x[0])),
        y: Math.min(...thisFace.points.map((x) => x[1])),
        z: Math.min(...thisFace.points.map((x) => x[2]))
      };
      var offsetCoordinates = points.map((point) => [point[0] - offset.x, point[1] - offset.x, point[2] - offset.x]);
      var offsetPoint = [point.x - offset.x, point.y - offset.y, point.z - offset.z]

      //Reduce our system to two dimensions
      var zeroDimension = offsetPoint.findIndex((point) => point === 0.0);
      pointInXYCoordinates = thisFace.flattenToXY(offsetPoint);

      //check if our point is less than zero in either dimension. If either is false, return false.
      if(pointInXYCoordinates[0] < 0.0 || pointInXYCoordinates[1] < 0.0){
        return false;
      }

      //Get the maximum x-y coordinates while reducing the rest of our points to two dimensions as well.
      var xyPoints = offsetCoordinates.map((x) => thisFace.flattenToXY(x));
      var maxXCoordinate = Math.max(...xyPoints.map((point) => point[0]));
      var maxYCoordinate = Math.max(...xyPoints.map((point) => point[0]));

      //Check if our point is less than the maximum values in either dimension. If either is false, return false.
      if(pointInXYCoordinates[0] > maxXCoordinate || pointInXYCoordinates[1] > maxYCoordinate){
        return false;
      }

      return true;
    };
    /**
    *END Face Object
    */
  }

  Bucket.prototype.toBox3 = function(){
    return new THREE.Box3(new THREE.Vector3(thisFace.upperCorner[0], thisFace.upperCorner[1], thisFace.upperCorner[2]), new THREE.Vect3(thisFace.lowerCorner[0], thisFace.lowerCorner[1], thisFace.lowerCorner[2]));
  };

  Bucket.prototype.addPoints = function(points, particles = false){
    thisBucket.needsUpdate = true;
    if(!thisBucketGrid.bucketsNeedingUpdates.includes(thisBucket)){
      thisBucketGrid.bucketsNeedingUpdates.push(thisBucket);
    }

    //Add all of these points to the bucket
    thisBucket.pointsMarkedForAddition = [...pointsMarkedForAddition, ...points];

    //Add this point to the bucket
    thisBucket.markPointsForAddition(points);

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
  };

  //We don't actualy 'remove points' unless they're being detached from the grid entirely
  Bucket.prototype.detachPointFromGrid = function(point){
    delete point.bucketGrids[thisBucket.bucketGridID];
    thisBucket.markPointForRemoval[point];
  };

  Bucket.prototype.markPointsForAddition = function(points){
    thisBucket.pointsMarkedForAddition = [...thisBucket.pointsMarkedForAddition, ...points];
  };

  Bucket.prototype.markPointForAddition = function(point){
    thisBucket.pointsMarkedForAddition.push(point);
  };

  Bucket.prototype.markPointForRemoval = function(point){
    thisBucket.pointsMarkedForRemoval.push(point);
  };

  Bucket.prototype.markPointsForRemoval = function(points){
    thisBucket.pointsMarkedForRemoval = [...thisBucket.pointsMarkedForRemoval, ...points];
  };

  Bucket.prototype.flushPoints = function(){
    var newPoints;

    //Note: Ideally, we'd just do a property swap for each pair exchange. Buckets,
    //after all, not only lose particles, but also gain them, and particles are effectively
    //exchangable (you can't tell one particle from another). Then you'd only have to swap properties
    //instead of reconstructing the entire particle list (as filtering particles can be a bit expensive)
    //But, for now, this should work rather well and is at least a little more optimized then normal.
    for(var i = 0; i < thisBucket.points.length; i++){
      var point = thisBucket.points[i];
      if(!(thisBucket.pointsMarkedForRemoval.includes(point) || thisBucket.pointsMarkedForAddition.includes(point))){
        newPoints.push(thisBucket.points[i]);
      }
    }

    thisBucket.points = newPoints;
    thisBucket.pointsMarkedForRemoval = [];
    thisBucket.pointsMarkedForAddition = [];
    thisBucket.needsUpdate = false;
  };

  Bucket.prototype.constructStaticMeshOctree = function(){
    //If the number of points is non-zero...
    if(thisBucket.staticMeshSearchablePoints.length > 0){
      bucket.IntersectsStaticMesh = true;

      //Create a KD Tree from all points in this bucket.
      //https://github.com/ubilabs/kd-tree-javascript
      function distance2PointSquared(a, b){
        let diff1 = a[0] - b[0];
        let diff2 = a[1] - b[1];
        let diff3 = a[2] - b[2];
        return (diff1 * diff1) + (diff2 * diff2) + (diff3 * diff3);
      }
      thisBucket.staticMeshKDTree = new kdTree(thisBucket.staticMeshSearchablePoints, [0, 1, 2]);
    };
  }

  Bucket.prototype.findPointsInsideStaticMesh = function(points, searchRadius){
    var pointsInsideOfMesh = [];
    if(thisBucket.IntersectsStaticMesh){
      for(let i = 0, pointsLength = points.length; i < pointsLength; i++){
        //Do the Static Mesh KD tree search for the nearest point to this particle.
        var point = points[i];
        let pointPosition = point.position;
        let nearestCoordinates = thisBucket.staticMeshKDTree.nearest([pointPosition.x, pointPosition.y, pointPosition.z], 1, [searchRadius]);

        //Hash this value to get the searchable point in the static scene.
        let p = nearestCoordinates[0][0];
        let staticScene = thisBucket.staticScene;
        let staticSceneHashDigitsCount = staticScene.hashDigitsCount;
        let hash = [p.x.toFixed(staticSceneHashDigitsCount), p.y.toFixed(staticSceneHashDigitsCount), p.z.toFixed(staticSceneHashDigitsCount)]
        let hashedNearestPoint = staticScene.hashedPoints[hash];
        let pointVector = new THREE.Vector3(point[0], point[1], point[2]);

        //Use the method described here:
        //https://blender.stackexchange.com/questions/31693/how-to-find-if-a-point-is-inside-a-mesh
        //to determine if each particle is inside of the mesh.
        //Start by going all the nearest candidate faces...
        let nearestFace = false;
        let nearestPointOnFace;
        let nearestFaceDistance;
        for(let j = 0, facesLength = hashedNearestPoint.faces.length; j < facesLength; j++){
          let face = hashedNearestPoint.faces[j];
          var triangle = face.triangle;
          var nearestPointOnTriangle = new THREE.Vector3();
          triangle.closestPointToPoint(new THREE.Vector3(), nearestPointOnTriangle);
          let distance = pointVector.distanceToSquared(nearestPointOnTriangle);
          if(j === 0 || nearestFaceDistance > distance){
            nearestFace = face;
            nearestPointOnFace = nearestPointOnTriangle;
            nearestFaceDistance = distance;
          }
        }

        //Now use the normal of the mesh face to decide if the particle is inside or outside.
        nearestPointOnFace.sub(pointVector);
        let isInsideOfMesh = nearestPointOnFace.dot(nearestFace.normal);

        //If point is inside of the mesh, add to the list of points that need returning
        if(isInsideOfMesh){
          pointsInsideOfMesh.push(point);
        }
      }
      return pointsInsideOfMesh;
    };
  }
  /**
  *END Bucket Object
  */

  this.addBucket = function(upperCorner, radius){
    var lowerCorner = upperCorner.map((x) => x - radius);
    this.buckets.push(new Bucket(upperCorner, lowerCorner, thisBucketGrid));
    this.hashedBuckets[this.buckets[this.buckets.length - 1].hashKey] = this.buckets[this.buckets.length - 1];

    var coords = ['x', 'y', 'z'];
    for(let i = 0; i < 3; i++){
      let coord = coords[i];
      var previousVal = this.gridUpperCoordinates[coord];
      if(previousVal === false || previousVal < upperCorner[coord]){
        this.gridUpperCoordinates[coord] = upperCorner[coord];
      }

      var previousVal = this.gridLowerCoordinates[coord];
      if(previousVal === false || previousVal > lowerCorner[coord]){
        this.gridLowerCoordinates[coord] = lowerCorner[coord];
      }

      //Presume a cube structure
      this.gridLength[coord] = Math.round((this.gridUpperCoordinates[coord] - this.gridLowerCoordinates[coord]) / radius, 1);
    }
  };

  this.connectBuckets = function(){
    performanceDebugger.spotCheckPerformance('connect buckets', true);
    for(let i = 0, numBuckets = this.buckets.length; i < numBuckets; i++){
      let bucket = this.buckets[i];
      var center = bucket.center;
      //Yes, there ARE a whole bunch of corner buckets, but we don't actually require them for our purposes and the suffering
      //of naming things (Genesis 2:19... it never ends O_O) is real. Like, what necessarily defines forward, back, up, down, or right or left.
      //Z seems like a fine coordinate to make my 'up', but I think Three JS actually thinks Y is up. Weird little program...
      //In the event that we need those, I have also made these 'axial' so that I can include the 'corner' cases later -
      //that is, probably when we need to predict when particles are leaving a given grid.
      var currentHash = thisBucketGrid.getHashKeyFromPosition([center.x - 1, center.y, center.z]);
      var xMinus1 = this.hashedBuckets.hasOwnProperty(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;
      currentHash = thisBucketGrid.getHashKeyFromPosition([center.x + 1, center.y, center.z]);
      var xPlus1 = this.hashedBuckets.hasOwnProperty(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;
      currentHash = thisBucketGrid.getHashKeyFromPosition([center.x, center.y - 1, center.z]);
      var yMinus1 = this.hashedBuckets.hasOwnProperty(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;
      currentHash = thisBucketGrid.getHashKeyFromPosition([center.x, center.y + 1, center.z]);
      var yPlus1 = this.hashedBuckets.hasOwnProperty(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;
      currentHash = thisBucketGrid.getHashKeyFromPosition([center.x, center.y, center.z - 1]);
      var zMinus1 = this.hashedBuckets.hasOwnProperty(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;
      currentHash = thisBucketGrid.getHashKeyFromPosition([center.x, center.y, center.z + 1]);
      var zPlus1 = this.hashedBuckets.hasOwnProperty(this.hashedBuckets) ? this.hashedBuckets[currentHash] : false;

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
    };
    performanceDebugger.spotCheckPerformance('connect buckets', false);
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
          distanceSquared: sumOfSquares,
          inverseDistance: inverseDistance,
          vect2Point: {x: xDiff * inverseDistance, y: yDiff * inverseDistance, z: zDiff * inverseDistance}
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

  this.flush = function(){
    let buckets = this.bucketsNeedingUpdates;
    for(let i = 0, bucketsLength = buckets.length; i < bucketsLength; i++){
      buckets[i].flush();
    }
    this.bucketsNeedingUpdates = [];
  };

  this.constructStaticMeshOctree = function(){
    for(let i = 0, bucketsLength = this.buckets.length; i < bucketsLength; i++){
      let bucket = this.buckets[i];
      bucket.constructStaticMeshOctree();
    }
  };
  performanceDebugger.spotCheckPerformance('bucket grid function initialization', false);

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
