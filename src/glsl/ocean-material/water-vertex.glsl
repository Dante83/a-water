precision highp float;

attribute vec3 tangent;
attribute vec3 bitangent;

varying vec3 vWorldPosition;
varying vec2 vUv;
varying mat3 modelMatrixMat3;
varying float vHeight;
varying vec3 vDisplacedNormal;
varying vec3 vDisplacement;
varying vec3 vViewVector;

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
  modelMatrixMat3 = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz );

  vec2 cameraOffset = vec2(cameraPosition.x, cameraPosition.z);
  vec2 uvOffset = (uv * sizeOfOceanPatch + cameraOffset) / sizeOfOceanPatch;
  vec3 displacement = texture2D(displacementMap, uvOffset).xyz;
  displacement.x *= -1.0;
  displacement.z *= -1.0;
  offsetPosition += displacement;

  vec4 worldPosition = modelMatrix * vec4(offsetPosition, 1.0);
  float distanceToWorldPosition = distance(worldPosition.xyz, cameraPosition.xyz);
  float LOD = pow(2.0, 8.0 - 8.0 * clamp(distanceToWorldPosition / 3000.0, 0.0, 1.0));
  offsetPosition = position + displacement;

  //Calculate our normal for this vertex
  vec3 deltaTangent = tangent / LOD;
  vec2 tangentUVOffset = (uv * sizeOfOceanPatch + cameraOffset + deltaTangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vec3 vt = texture2D(displacementMap, tangentUVOffset).xyz;
  vt.x *= -1.0;
  vt.z *= -1.0;
  vec3 deltaBitangent = bitangent / LOD;
  vec2 biTangentUVOffset = (uv * sizeOfOceanPatch + cameraOffset + deltaBitangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vec3 vb = texture2D(displacementMap, biTangentUVOffset).xyz;
  vb.x *= -1.0;
  vb.z *= -1.0;
  //Change in height with respect to x
  vec3 dhDt = normalize((vt + deltaTangent * sizeOfOceanPatch) - displacement);
  //Change in height with respect to z
  vec3 dhDbt = normalize((vb + deltaBitangent * sizeOfOceanPatch) - displacement);
  vec3 displacedNormal = cross(dhDt, dhDbt);

  tangentUVOffset = (uv * sizeOfOceanPatch + cameraOffset - deltaTangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vt = texture2D(displacementMap, tangentUVOffset).xyz;
  vt.x *= -1.0;
  vt.z *= -1.0;
  deltaBitangent = bitangent / LOD;
  biTangentUVOffset = (uv * sizeOfOceanPatch + cameraOffset - deltaBitangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vb = texture2D(displacementMap, biTangentUVOffset).xyz;
  vb.x *= -1.0;
  vb.z *= -1.0;
  //Change in height with respect to x
  dhDt = normalize((vt - deltaTangent * sizeOfOceanPatch) - displacement);
  //Change in height with respect to z
  dhDbt = normalize((vb - deltaBitangent * sizeOfOceanPatch) - displacement);
  displacedNormal = (cross(dhDt, dhDbt) + displacedNormal) * 0.5;
  vDisplacedNormal = displacedNormal.xzy;

  //Set up our UV maps
  vUv = uv;

  vec3 cameraSpacePosition = modelMatrixMat3 * worldPosition.xyz;
  vWorldPosition = worldPosition.xyz;
  vHeight = (offsetPosition.y  + linearScatteringHeightOffset) / linearScatteringTotalScatteringWaveHeight;

  //Calculate our view vector in tangent space
  vViewVector = normalize(cameraSpacePosition.xyz - cameraPosition);

  //Add support for three.js fog
  #include <fog_vertex>

  gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);
}
