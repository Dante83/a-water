function BucketFace(points, cubeCenter, constantAxis){
  this.points = points;
  this.plane;
  this.constantAxis = constantAxis;

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

BucketFace.prototype.flattenToXY = function(point, ignoreDimension){
  var xyOut = [];
  while(xyOut.length < 2){
    if(i !== this.constantAxis){
      xyOut.push(this.points[i]);
    }
  }

  return xyOut;
}

BucketFace.prototype.isPointOnFace = function(point){
  //Center our plane and the point above at the origin, by removing the minimum coordinates;
  var offset = {
    x: Math.min(...this.points.map((x) => x[0])),
    y: Math.min(...this.points.map((x) => x[1])),
    z: Math.min(...this.points.map((x) => x[2]))
  };
  var offsetCoordinates = this.points.map((point) => [point[0] - offset.x, point[1] - offset.x, point[2] - offset.x]);
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
