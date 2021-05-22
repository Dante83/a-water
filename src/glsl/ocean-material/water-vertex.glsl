precision highp float;

attribute vec4 tangent;

varying float height;
varying vec3 tangentSpaceViewDirection;
varying vec3 vViewVector;
varying vec4 colorMap;
varying vec2 vUv;

uniform float sizeOfOceanPatch;
uniform sampler2D displacementMap;
uniform mat4 matrixWorld;
#include <fog_pars_vertex>

void main() {
  //Set up our displacement map
  vec3 offsetPosition = position;
  vec4 displacement = texture2D(displacementMap, uv  + (vec2(cameraPosition.x, -cameraPosition.z) / sizeOfOceanPatch));
  displacement.x *= -1.0;
  displacement.z *= -1.0;
  offsetPosition.x += displacement.x;
  offsetPosition.z += displacement.y;
  offsetPosition.y += displacement.z;
  vViewVector = (matrixWorld * vec4(displacement.xyz + position, 1.0)).xyz - cameraPosition;

  //Set up our UV maps
  vUv = uv;

  //Have the water fade from dark blue to teal as it approaches the shore.
  colorMap = vec4(displacement.xyz, 1.0);

  //Add support for three.js fog
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <fog_vertex>

  gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);
}
