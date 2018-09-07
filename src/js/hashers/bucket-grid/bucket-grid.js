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
  this.staticScene;
  this.parentParticleSystem = parentParticleSystem;

  this.getHashKeyFromPosition = function(position){
    var bucketGridLocalCoordinates = position.foreach(function(x, i){return (x - this.gridUpperCoordinates[i]);});
    var gridAxialIndexCoordinates = bucketGridLocalCoordinates.foreach(function(x, i){return Math.floor(x / this.approximateSearchDiameter);});
    return (gridAxialIndexCoordinates[0] * 3) + (gridAxialIndexCoordinates[1] * 3 + 1) + (gridAxialIndexCoordinates[2] * 3 + 2);
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
        this.errorOnce('serCoordByNumError', 'Invalid number entered into setCoordByNum.');
      }
    }
  }

  function Bucket(upperCorner, lowerCorner, parentBucketGrid){
    this.points = [];
    this.pointsMarkedForRemoval = [];
    this.pointsMarkedForAddition = [];
    this.upperCorner = upperCorner;
    this.lowerCorner = lowerCorner;
    this.faces = [];
    this.connectedBuckets = {};
    this.needsUpdate = false;
    this.parentBucketGrid = parentBucketGrid;
    this.IntersectsStaticMesh = false;
    this.staticMeshSearchablePoints = [];
    this.staticMeshKDTree;
    var thisBucket = this;

    for(let i = 0; i < 8; i++){
      //Iterate through all permuations/combinations between the upper and lower corner points
      var useUpperCorner = Array.from((i >>> 0).toString(2), function(elem){return elem === '1' ? true : false;});
      var newCorner = new PointCoord(0.0, 0.0, 0.0);
      for(let j = 0; j < 3; j++){
        if(useUpperCorner){
          newCorner.setCoordByNum(j,  upperCorner[j]);
        }
        else{
          newCorner.setCoordByNum(j,  lowerCorner[j]);
        }
      }
      this.corners.push(newCorner);
    }

    //Construct all of our faces from these points
    //Note that a face contains points for which one axis is the same
    var faceCoordinateSets = [];
    for(var i = 0; i < 3; i++){
      //Hold the ith dimension from the upper corner constant...
      var coordinateSetA = [];
      var coordinateSetB = [];
      for(let j = 0; j < 4; j++){
        var useUpperCoordinateForThisDim = Array.from((j >>> 0).toString(1), function(elem){return elem === '1' ? true : false;});
        var upperCoordI = 0;
        for(let dim = 0; dim < 3; dim++){
          if(dim !== i){
            coordinateSetA.push(useUpperCoordinateForThisDim[upperCoordI] ? upperCorner[dim] : lowerCorner[dim]);
            coordinateSetB.push(useUpperCoordinateForThisDim[lowerCoordI] ? upperCorner[dim] : lowerCorner[dim]);
            upperAndLowerCoordI++;
          }
          else{
            coordinateSetA.push(upperCorner[dim]);
            coordinateSetB.push(lowerCorner[dim]);
          }
        }
      }
      faceCoordinateSets.push(coordinateSetA);
      faceCoordinateSets.push(coordinateSetB);
    }
    this.faces = [];
    for(let i = 0; i < 6; i++){
      this.faces.push(new Face(faceCoordinateSets));
    }

    var center = [];
    for(var i = 0; i < 3; i++){
      center.push((upperCorner[i] + lowerCorner[i]) * 0.5);
    }
    this.hashKey = thisBucket.getHashKeyFromPosition(center);
    this.center = {x: center[0], y: center[1], z: center[2]};

    this.addPoint = function(point){
      //Time to request an object update
      thisBucket.needsUpdate = true;
      if(!this.bucketsNeedingUpdates.includes(thisBucket)){
        thisBucket.bucketsNeedingUpdates.push(thisBucket);
      }

      //Add this point to the bucket
      thisBucket.markPointForAddition(point);

      //Detach this point from the original bucket if such a bucket exists
      if(point.bucketGrids[thisBucket.bucketGridID].bucket !== false){
        point.bucketGrids[thisBucket.bucketGridID].bucket.markPointForRemoval(point);
      }

      //Set this points bucket for this bucket grid to this bucket
      point.bucketGrids[thisBucket.bucketGridID].bucket = thisBucket;

      //
      //TODO: This would be an excellent stage to predict this particles departure time from this bucket
      //
    };

    this.addPoints = function(points){
      thisBucket.needsUpdate = true;
      if(!this.bucketsNeedingUpdates.includes(thisBucket)){
        thisBucket.bucketsNeedingUpdates.push(thisBucket);
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
    this.detachPointFromGrid = function(point){
      delete point.bucketGrids[thisBucket.bucketGridID];
      thisBucket.markPointForRemoval[point];
    };

    this.markPointsForAddition = function(points){
      thisBucket.pointsMarkedForAddition = [...thisBucket.pointsMarkedForAddition, ...points];
    };

    this.markPointForAddition = function(point){
      thisBucket.pointsMarkedForAddition.push(point);
    };

    this.markPointForRemoval = function(point){
      thisBucket.pointsMarkedForRemoval.push(point);
    };

    this.markPointsForRemoval = function(points){
      thisBucket.pointsMarkedForRemoval = [...thisBucket.pointsMarkedForRemoval, ...points];
    };

    this.flushPoints = function(){
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

    this.constructStaticMeshKDTree = function(){
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

    this.findPointsInsideStaticMesh = function(points, searchRadius){
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

    function Face(points){
      this.points = points;
      this.plane;
      this.isPointOnFace;
      this.normalVector;
      this.offset;
      var parentFace = this;

      this.constructPlane = function(){
        //Two of our lines off the same point should produce a perpendicular cross product equal to the normal vector (ignoring the sign)
        var point1 = this.points[0],  point2 = this.points[1], point3 = this.points[2], point4 = this.points[3];
        let vect1 = new THREE.Vector3(...this.constructDiff(point1, point2));
        let vect2 = new THREE.Vector3(...this.constructDiff(point1, point3));

        //And then crossing them to calculate the normal vector.
        parentFace.normalVector = new THREE.Vector3();
        normalVector.cross(vect1, vect2);
        normalVector.normalize();

        //The offset from the origin, because we're parallel to one of the axis - is
        //just the value in the one axis that does not change.
        parentFace.offset = this.recursiveOffsetFinder(dimension = 0)

        //Now create a three js plane...
        parentFace.plane = new THREE.plane(parentFace.normalVector, parentFace.offset);

        this.constructDiff = function(point1, point2){
          let diffX = point1[0] - point2[0];
          let diffY = point1[1] - point2[1];
          let diffZ = point1[2] - point2[2];

          return [diffX, diffY, diffZ];
        }

        this.recursiveOffsetFinder = function(dimension = 0){
          if(point1[dimension] === point2[dimension] && point1[dimension] === point3[dimension]){
            let returnVar = [0.0,0.0,0.0];
            returnVar[dimension] = point1[dimension];
            return returnVar;
          }
          else if(dimension > 3){
            return this.recursiveOffsetFinder(dimension + 1);
          }
          else{
            this.errorOnce('recursiveOffsetFinderError', 'We have gone beyond the maximum number of dimensions.');
          }
        };
      };

      this.isPointOnFace = function(point){
        //Center our plane and the point above at the origin, by removing the minimum coordinates;
        var offset = {
          x: Math.min(...this.points.map((x) => x[0])),
          y: Math.min(...this.points.map((x) => x[1])),
          z: Math.min(...this.points.map((x) => x[2]))
        };
        var offsetCoordinates = points.map((point) => [point[0] - offset.x, point[1] - offset.x, point[2] - offset.x]);
        var offsetPoint = [point.x - offset.x, point.y - offset.y, point.z - offset.z]

        //Reduce our system to two dimensions
        var zeroDimension = offsetPoint.findIndex((point) => point === 0.0);
        pointInXYCoordinates = this.flattenToXY(offsetPoint);

        //check if our point is less than zero in either dimension. If either is false, return false.
        if(pointInXYCoordinates[0] < 0.0 || pointInXYCoordinates[1] < 0.0){
          return false;
        }

        //Get the maximum x-y coordinates while reducing the rest of our points to two dimensions as well.
        var xyPoints = offsetCoordinates.map((x) => this.flattenToXY(x));
        var maxXCoordinate = Math.max(...xyPoints.map((point) => point[0]));
        var maxYCoordinate = Math.max(...xyPoints.map((point) => point[0]));

        //Check if our point is less than the maximum values in either dimension. If either is false, return false.
        if(pointInXYCoordinates[0] > maxXCoordinate || pointInXYCoordinates[1] > maxYCoordinate){
          return false;
        }

        return true;
      };

      this.flattenToXY = function(point, ignoreDimension){
        var xyOut = [];
        for(let i = 0; i < 3; i++){
          if(i !== ignoreDimension){
            xyOut.push(point[i]);
          }
        }

        return xyOut;
      };
    };

    this.toBox3 = function(){
      return new THREE.Box3(new THREE.Vect3(this.upperCorner[0], this.upperCorner[1], this.upperCorner[2]), new THREE.Vect3(this.lowerCorner[0], this.lowerCorner[1], this.lowerCorner[2]));
    };
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
  };

  this.connectBuckets = function(){
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
      let newHash = thisBucketGrid.getHashKeyFromPosition([particle.position.x, particle.position.y, particle.position.z]);
      if(newHash !== particle.bucketGrids[thisBucketGrid.bucketGridID].bucket.hashKey){
        if(!particlesToAddByHash.includes(newHash)){
          particlesToAddByHash[newHash] = [];
        }
        particlesToAddByHash[newHash].push(particle);
      }
    }

    particlesToAddByHash.foreach(function(particleCollection, hashKey){
      thisBucketGrid.hashedBuckets[hashKey].addParticles(particleCollection);
    });
  };

  this.flush = function(){
    let buckets = thisBucketGrid.bucketsNeedingUpdates;
    for(let i = 0, bucketsLength = buckets.length; i < bucketsLength; i++){
      buckets[i].flush();
    }
    thisBucketGrid.bucketsNeedingUpdates = [];
  };

  this.constructStaticMeshOctree = function(){
    for(let i = 0, bucketsLength = this.buckets.length; i < bucketsLength; i++){
      let bucket = this.buckets[i];
      bucket.constructStaticMeshOctree();
    }
  };

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
