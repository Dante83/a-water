precision highp float;

attribute vec3 baseDepth;
varying vec3 vWorldPosition;
varying vec4 colorMap;

uniform sampler2D heightmap;
//uniform sampler2D jacobian;
//uniform sampler2D normalMapShadow;
//uniform vec3 cameraDirection;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec3 offsetPosition =  offsetVertexPosition + heightmap;

  //Fade the water out as it approaches the shoreline

  //Have the water fade from dark blue to teal as it approaches the shore.

  //Emulate underwater fog using the vertex position with the angle it makes with
  //the camera looking direction

  gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);
}
