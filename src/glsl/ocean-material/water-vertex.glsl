precision highp float;

//attribute vec3 baseDepth;
varying vec3 vWorldPosition;
varying vec4 colorMap;
varying vec3 vNormal;

uniform sampler2D displacementMap;
uniform sampler2D normalMap;
uniform mat4 matrixWorld;

void main() {
  vec3 offsetPosition = position;
  vec3 displacement = texture2D(displacementMap, uv).rgb;
  offsetPosition.z += displacement.r;
  vec4 worldPosition = matrixWorld * vec4(position, 1.0);
  vWorldPosition = normalize(worldPosition.xyz - cameraPosition).xzy + displacement.r;

  //Have the water fade from dark blue to teal as it approaches the shore.
  vNormal = texture2D(normalMap, uv).rgb;
  vNormal = vec3(0.0, 1.0, 0.0);
  colorMap = vec4(displacement, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);
}
