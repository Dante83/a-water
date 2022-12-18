precision highp float;

attribute vec3 tangent;
attribute vec3 bitangent;

varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec3 vInView;
varying mat4 vInstanceMatrix;
varying mat4 vModelMatrix;
varying mat3 vNormalMatrix;

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
  vec3 offsetPosition = position;
  mat3 instanceMatrixMat3 = mat3(instanceMatrix[0].xyz, instanceMatrix[1].xyz, instanceMatrix[2].xyz );
  mat3 modelMatrixMat3 = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz );

  vec2 cameraOffset = vec2(cameraPosition.x, cameraPosition.z);
  vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));
  float distanceToVertex = distance(cameraPosition.xyz, worldPositionOfVertex.xyz);
  vec2 uvOffset = (uv * sizeOfOceanPatch + cameraOffset) / sizeOfOceanPatch;
  float displacementFadeout = clamp((2500.0 - distanceToVertex) / 2500.0, 0.0, 1.0);
  vec3 displacement = texture2D(displacementMap, uvOffset).xyz * displacementFadeout;
  displacement.x *= -1.0;
  displacement.z *= -1.0;
  offsetPosition += displacement;

  //Set up our varyings
  vUv = uv;
  vTangent = tangent;
  vBitangent = bitangent;
  vPosition = position;
  //From https://stackoverflow.com/questions/59492385/angle-between-view-vector-and-normal
  vec4 posInView = (modelViewMatrix * instanceMatrix * vec4(offsetPosition, 1.0));
  posInView /= posInView[3];
  vInView = normalize(-posInView.xyz);
  vInstanceMatrix = instanceMatrix;
  vModelMatrix = modelMatrix;
  vNormalMatrix = normalMatrix;

  //Add support for three.js fog
  #include <fog_vertex>

  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
}
