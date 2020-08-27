precision highp float;

varying vec3 vWorldPosition;
varying vec4 colorMap;

uniform vec3 cameraDirection;

void main() {
  gl_FragColor = colorMap;
}
