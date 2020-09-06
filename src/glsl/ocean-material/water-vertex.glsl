precision highp float;

attribute vec4 tangent;

varying vec3 tangentSpaceViewDirection;
varying vec3 vViewVector;
varying vec4 colorMap;
varying vec2 vUv;

uniform sampler2D displacementMap;
uniform mat4 matrixWorld;

void main() {
  //Set up our displacement map
  vec3 offsetPosition = position;
  vec3 displacement = texture2D(displacementMap, uv).xyz;
  displacement.x *= -1.0;
  displacement.z *= -1.0;
  offsetPosition.x += displacement.x;
  offsetPosition.z += displacement.y;
  offsetPosition.y += displacement.z;
  vViewVector = (matrixWorld * vec4(displacement + position, 1.0)).xyz - cameraPosition;

  //Set up our UV maps
  vUv = uv;

  //Have the water fade from dark blue to teal as it approaches the shore.
  colorMap = vec4(displacement, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);
}
