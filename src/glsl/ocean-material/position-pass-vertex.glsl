precision highp float;

//attribute vec3 baseDepth;
varying vec3 vWorldPosition;
uniform mat4 worldMatrix;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz / worldPosition.w;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
