function BucketFace(points, cubeCenter, constantAxis, parentBucket){
  this.points = points;
  this.plane;
  this.constantAxis = constantAxis;
  this.parentBucket = parentBucket;

  //Two of our lines off the same point should produce a perpendicular cross product equal to the normal vector (ignoring the sign)
  let normalArray = [0.0,0.0,0.0];
  normalArray[constantAxis] = Math.sign(cubeCenter[constantAxis] - points[0][constantAxis]);
  this.normalVector = new THREE.Vector3(...normalArray);

  //The offset from the origin, because we're parallel to one of the axis - is
  //just the value in the one axis that does not change.
  let offset = -1.0 * normalArray[constantAxis] * points[0][constantAxis];

  //Now create a three js plane...
  //NOTE: We might just be able to copy over the three js code and update it to our needs,
  //thus avoiding a lot of costly computations for calculating the intersects line method.
  this.plane = new THREE.Plane(this.normalVector, offset);
};

BucketFace.prototype.isPointOnFace = function(pointOnPlane){
  //Get the non-constant axis associated with this face.
  let xAxis = (this.constantAxis + 1) % 3;
  let yAxis = (this.constantAxis + 2) % 3;
  let xAxisPointPos = pointOnPlane[xAxis];
  let yAxisPointPos = pointOnPlane[yAxis];
  let maxX = this.points[0][xAxis];
  let minX = this.points[0][xAxis];
  let maxY =  this.points[0][yAxis];
  let minY =  this.points[0][yAxis];

  let testConditionsMet = 0;
  for(let i = 1; i < 3; i++){
    let testXCoord = this.points[i][xAxis];
    let testYCoord = this.points[i][yAxis];

    if(testXCoord < minX){
      minX = testXCoord;
      testConditionsMet++;
    }
    else if(testXCoord > maxX){
      maxX = testXCoord;
      testConditionsMet++;
    }

    if(testYCoord < minY){
      minY = testYCoord;
      testConditionsMet++;
    }
    else if(testYCoord > maxY){
      maxY = testYCoord;
      testConditionsMet++;
    }

    if(testConditionsMet === 2){
      break;
    }
  }

  if(xAxisPointPos >= minX && xAxisPointPos <= maxX && yAxisPointPos >= minY && yAxisPointPos <= maxY){
    return true;
  }

  return false;
};

BucketFace.prototype.getConnectedBucketHash = function(){
  //Grab the center of our points, which because they're a cube is
  //actually the average of their positions.
  let centerOfMassPoint = this.points[0].slice(0);
  for(let i = 1; i < 4; i++){
    for(let coord = 0; coord < 3; coord++){
      centerOfMassPoint[coord] += this.points[i][coord];
    }
  }
  for(let coord = 0; coord < 3; coord++){
    centerOfMassPoint[coord] *= 0.25;
  }

  //Now convert this to a vector for easier use.
  centerOfMassPoint = new THREE.Vector3(...centerOfMassPoint);

  //Use this point and the normal vector to find out where to search for our
  //second point, it should be in the direction of the normal and
  //half a bucket point away from our starting vector we found above.
  let approximateConnectedBucketCenterVect3 = new THREE.Vector3();
  approximateConnectedBucketCenterVect3.addVectors(centerOfMassPoint, this.normalVector);
  let approximateConnectedBucketCenter = [];
  approximateConnectedBucketCenterVect3.toArray(approximateConnectedBucketCenter, 0);

  //Take this point and hash it, return this hash.
  //Even if it is not in this bucket grid, it might be in another bucket grid.
  //Really that's not our concern. What our concern is, is getting that bucket.
  return this.parentBucket.parentBucketGrid.getHashKeyFromPosition(approximateConnectedBucketCenter);
}
