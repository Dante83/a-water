//
//NOTE: Eliminate our big memory hogs, faces and corners.
//Instead, we should create them on the fly, while running our static mesh collision
//system on each cell. This should reduce our memory foot-print for each particle system.
//Our ultimate goal is to let this use a lot of memory, but we also want to use that memory
//efficiently when we get it.
//
function Bucket(upperCorner, lowerCorner, parentBucketGrid){
  perfDebug.spotCheckPerformance('bucket initialization', true);
  this.upperCorner = upperCorner.slice(0);
  this.lowerCorner = lowerCorner.slice(0);
  this.hash;
  this.points = [];
  this.pointsMarkedForRemoval = [];
  this.pointsMarkedForAddition = [];
  this.listOfConnectedBuckets = [];
  this.connectedBuckets = {};
  this.needsUpdate = false;

  //Intersection components associated with static meshes.
  this.instersectsStaticMesh = false;
  this.isInStaticMesh = null;
  this.nearestStaticPointBucket = null;
  this.staticMeshPoints = [];

  this.parentBucketGrid = parentBucketGrid;
  this.bucketConstants = parentBucketGrid.bucketConstants;
  perfDebug.spotCheckPerformance('bucket initialization', false);
}

Bucket.prototype.getCenter = function(){
  let center = [];
  for(let i = 0; i < 3; i++){
    center.push((this.upperCorner[i] + this.lowerCorner[i]) * 0.5);
  }

  return center;
}

Bucket.prototype.getCorners = function(){
  let corners = [];
  let upperCorner = this.upperCorner;
  let lowerCorner = this.lowerCorner;

  perfDebug.spotCheckPerformance('construct corners', true);
  let upperCornerIndices = this.bucketConstants.bucketCornerIndices;
  for(let i = 0; i < 8; i++){
    //Iterate through all permuations/combinations between the upper and lower corner points
    var useUpperCorner = upperCornerIndices[i];
    var newCorner = [];
    for(let j = 0; j < 3; j++){
      if(useUpperCorner[j]){
        newCorner[j] = upperCorner[j];
      }
      else{
        newCorner[j] = lowerCorner[j];
      }
    }
    corners.push(newCorner);
  }
  perfDebug.spotCheckPerformance('construct corners', false);

  return corners;
}

Bucket.prototype.getFaces = function(){
  perfDebug.spotCheckPerformance('construct faces', true);
  //Construct all of our faces from these points
  //Note that a face contains points for which one axis is the same
  let faces = [];
  let faceIndices = this.bucketConstants.bucketFaceIndices;
  let upperCorner = this.upperCorner;
  let lowerCorner = this.lowerCorner;
  let center = this.getCenter();
  for(let i = 0; i < 3; i++){
    //Hold the ith dimension from the upper corner constant...
    let coordinatesForFaceA = [];
    let coordinatesForFaceB = [];

    //For each corner
    perfDebug.spotCheckPerformance('construct faces inner loop', true);
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
    perfDebug.spotCheckPerformance('construct faces inner loop', false);
    //The face here is internal to buckets and not Face from THREE.JS
    perfDebug.spotCheckPerformance('construct faces trigger face constructors', true);
    faces.push(new BucketFace(coordinatesForFaceA, center, i, this));
    faces.push(new BucketFace(coordinatesForFaceB, center, i, this));
    perfDebug.spotCheckPerformance('construct faces trigger face constructors', false);
  }
  perfDebug.spotCheckPerformance('construct faces', false);

  return faces;
}

Bucket.prototype.toBox3 = function(){
  return new THREE.Box3(new THREE.Vector3(thisFace.upperCorner[0], thisFace.upperCorner[1], thisFace.upperCorner[2]), new THREE.Vect3(thisFace.lowerCorner[0], thisFace.lowerCorner[1], thisFace.lowerCorner[2]));
};

Bucket.prototype.addParticles = function(points){
  this.needsUpdate = true;

  if(!this.parentBucketGrid.bucketsNeedingUpdates.includes(this)){
    this.parentBucketGrid.bucketsNeedingUpdates.push(this);
  }

  //Add all of these points to the bucket
  this.pointsMarkedForAddition = this.pointsMarkedForAddition.length > 0 ? [...this.pointsMarkedForAddition, ...points] : points.slice(0);

  //Detach this point from the original bucket if such a bucket exists
  let filteredPoints = this.points.filter((x) => x !== false);
  if(filteredPoints.length > 0){
    point.bucketGrids[this.bucketGridID].bucket.markPointsForRemoval(filteredPoints);
  }

  //Set this points bucket for this bucket grid to this bucket
  for(let i = 0, numPoints = points.length; i < numPoints; i++){
    let point = points[i];
    point.bucket = this;
  }

  //
  //TODO: This would be an excellent stage to predict the departure times for each of these particles
  //
};

//We don't actualy 'remove points' unless they're being detached from the grid entirely
Bucket.prototype.detachPointFromGrid = function(point){
  delete point.bucketGrids[this.bucketGridID];
  this.markPointForRemoval[point];
};

Bucket.prototype.markPointsForAddition = function(points){
  this.pointsMarkedForAddition = [...this.pointsMarkedForAddition, ...points];
};

Bucket.prototype.markPointForAddition = function(point){
  this.pointsMarkedForAddition.push(point);
};

Bucket.prototype.markPointForRemoval = function(point){
  this.pointsMarkedForRemoval.push(point);
};

Bucket.prototype.markPointsForRemoval = function(points){
  this.pointsMarkedForRemoval = [...this.pointsMarkedForRemoval, ...points];
};

Bucket.prototype.flushPoints = function(){
  let newPoints = [];

  //Note: Ideally, we'd just do a property swap for each pair exchange. Buckets,
  //after all, not only lose particles, but also gain them, and particles are effectively
  //exchangable (you can't tell one particle from another). Then you'd only have to swap properties
  //instead of reconstructing the entire particle list (as filtering particles can be a bit expensive)
  //But, for now, this should work rather well and is at least a little more optimized then normal.
  for(let i = 0; i < this.pointsMarkedForAddition.length; i++){
    let newPoint = this.pointsMarkedForAddition[i];
    //Check we don't double add this
    if(this.points.indexOf(newPoint) === -1){
      newPoints.push(newPoint);
    }
  }
  this.points = this.points.filter(x => this.pointsMarkedForRemoval.indexOf(x) === -1);

  this.points = [...this.points, ...newPoints];
  this.pointsMarkedForRemoval = [];
  this.pointsMarkedForAddition = [];
  this.needsUpdate = false;
};

//
//TODO: This needs re-doing according to our current setup.
//
//NOTE: This method presumes that each of our buckets, and the movement of our particles
//in a single frame is small compared to the size of a given section of mesh. High speed particles,
//might accidently start moving through walls. To handle this, we may want to expand the searh radius for
//our impact sites.
Bucket.prototype.findPointsInsideStaticMesh = function(points, searchRadius){
  var pointsInsideOfMesh = [];

  //Determine all buckets
  if(this.IntersectsStaticMesh){
    for(let i = 0, pointsLength = this.points.length; i < pointsLength; i++){
      //Do the Static Mesh KD tree search for the nearest point to this particle.
      var point = this.points[i];
      let pointPosition = point.position;

      //Hash this value to get the searchable point in the static scene.
      let p = nearestCoordinates[0][0];
      let staticScene = this.staticScene;
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
};
