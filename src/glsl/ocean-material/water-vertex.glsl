precision highp float;

attribute vec3 tangent;
attribute vec3 bitangent;

varying vec3 vWorldPosition;
varying vec2 vUv;
varying float vHeight;
varying vec3 vDisplacement;
varying vec3 vViewVector;
varying vec3 vPosition;

uniform float sizeOfOceanPatch;
uniform sampler2D displacementMap;
uniform float linearScatteringHeightOffset;
uniform float linearScatteringTotalScatteringWaveHeight;

#include <fog_pars_vertex>

vec2 vec2Modulo(vec2 inputUV){
    return (inputUV - floor(inputUV));
}

void main() {
  //Set up our displacement map
  vPosition = position;
  vec3 offsetPosition = position;
  mat3 instanceMatrixMat3 = mat3(instanceMatrix[0].xyz, instanceMatrix[1].xyz, instanceMatrix[2].xyz );
  mat3 modelMatrixMat3 = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz );

  vec2 cameraOffset = vec2(cameraPosition.x, cameraPosition.z);
  vec2 uvOffset = (uv * sizeOfOceanPatch + cameraOffset) / sizeOfOceanPatch;
  vec3 displacement = texture2D(displacementMap, uvOffset).xyz;
  displacement.x *= -1.0;
  displacement.z *= -1.0;
  offsetPosition += displacement;

  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
  float distanceToWorldPosition = distance(worldPosition.xyz, cameraPosition.xyz);
  float LOD = pow(2.0, clamp(7.0 - (distanceToWorldPosition / (sizeOfOceanPatch * 7.0)), 1.0, 7.0));
  offsetPosition = position + displacement;

  //Set up our UV maps
  vUv = uv;

  vec3 cameraSpacePosition = worldPosition.xyz;
  vWorldPosition = worldPosition.xyz;
  vHeight = (offsetPosition.y  + linearScatteringHeightOffset) / linearScatteringTotalScatteringWaveHeight;

  //Calculate our view vector in tangent space
  vViewVector = normalize(cameraSpacePosition.xyz - cameraPosition);

  //Add support for three.js fog
  #include <fog_vertex>

  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
}
