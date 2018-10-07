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

BucketFace.prototype.isPointOnFace = function(point){
  //Get the two axis for our plane.
  let axis1 = 1;
  let axis2 = 2;
  let point1 = this.points[0];
  let point2 = this.points[2];
  let diff1 = Math.abs(point1[0] - point2[0]);
  let diff2 = Math.abs(point1[1] - point2[1]);
  if(diff2 < diff1){
    axis1 = 0;
    axis2 = 2;
  }
  point2 = this.points[3];
  diff1 = diff2;
  diff2 = Math.abs(point1[2] - point2[2]);
  if(diff2 < diff1){
    axis1 = 0;
    axis2 = 1;
  }

  let lowestAxis1 = this.points[0][axis1];
  let highestAxis1 = this.points[0][axis1];
  let lowestAxis2 = this.points[0][axis2];
  let highestAxis2 = this.points[0][axis2];
  for(let i = 1; i < 3; i++){
    let testPointOnAxis1 = this.points[i][axis1];
    let testPointOnAxis2 = this.points[i][axis2];
    if(testPointOnAxis1 < lowestAxis1){
      lowestAxis1 = testPointOnAxis1;
    }
    else if(testPointOnAxis1 > highestAxis1){
      highestAxis1 = testPointOnAxis1;
    }

    if(testPointOnAxis2 < lowestAxis2){
      lowestAxis2 = testPointOnAxis2;
    }
    else if(testPointOnAxis2 > highestAxis2){
      highestAxis2 = testPointOnAxis2;
    }
  }
  let axis1Val = point[axis1];
  let axis2Val = point[axis2];

  if(axis1Val >= lowestAxis1 && axis1Val <= highestAxis1 && axis2Val >= lowestAxis2 && axis2Val <= highestAxis2){
    return true;
  }

  return false;
};
