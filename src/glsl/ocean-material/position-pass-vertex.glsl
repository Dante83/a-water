precision highp float;

//attribute vec3 baseDepth;
varying vec3 vWorldPosition;
uniform mat4 worldMatrix;

void main() {
  vWorldPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
