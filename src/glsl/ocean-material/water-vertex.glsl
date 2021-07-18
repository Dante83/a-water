precision highp float;

attribute vec4 tangent;

varying float height;
varying vec3 tangentSpaceViewDirection;
varying vec3 vViewVector;
varying vec3 vWorldPosition;
varying vec4 colorMap;
varying vec2 vUv;
varying vec3 displacedNormal;
varying mat3 modelMatrixMat3;
varying mat3 tbnMatrix;

uniform float sizeOfOceanPatch;
uniform sampler2D displacementMap;
uniform mat4 matrixWorld;
#include <fog_pars_vertex>

vec2 vec2Modulo(vec2 inputUV){
    return (inputUV - floor(inputUV));
}

void main() {
  //Set up our displacement map
  vec3 offsetPosition = position;
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vViewVector = worldPosition.xyz - cameraPosition;
  modelMatrixMat3 = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz );

  vec2 uvOffset = vec2Modulo(uv + (vec2(cameraPosition.x, -cameraPosition.z) / sizeOfOceanPatch));
  vec4 displacement = texture2D(displacementMap, uvOffset);
  displacement.x *= -1.0;
  displacement.z *= -1.0;
  offsetPosition.x += displacement.x;
  offsetPosition.z += displacement.y;
  offsetPosition.y += displacement.z;

  //Normal map
  vec3 bitangent = cross(normal.xyz, tangent.xyz);
  tbnMatrix = mat3(tangent.xyz, bitangent.xyz, normal.xyz);
  vec3 v0 = vec3(uv, 0.0);
  vec3 vt = v0 + (1.0 / 128.0) * tangent.xyz;
  vec3 vb = v0 + (1.0 / 128.0) * bitangent;

  vec3 displacementV0 = texture2D(displacementMap, vec2Modulo(v0.xy + (vec2(cameraPosition.x, -cameraPosition.z) / sizeOfOceanPatch))).xyz;
  displacementV0.x *= -1.0;
  displacementV0.z *= -1.0;
  v0.x += displacementV0.x / sizeOfOceanPatch;
  v0.z += displacementV0.y / sizeOfOceanPatch;
  v0.y += displacementV0.z / sizeOfOceanPatch;
  vec3 displacementVT = texture2D(displacementMap, vec2Modulo(vt.xy + (vec2(cameraPosition.x, -cameraPosition.z) / sizeOfOceanPatch))).xyz;
  displacementVT.x *= -1.0;
  displacementVT.z *= -1.0;
  vt.x += displacementVT.x / sizeOfOceanPatch;
  vt.z += displacementVT.y / sizeOfOceanPatch;
  vt.y += displacementVT.z / sizeOfOceanPatch;
  vec3 displacementVB = texture2D(displacementMap, vec2Modulo(vb.xy + (vec2(cameraPosition.x, -cameraPosition.z) / sizeOfOceanPatch))).xyz;
  displacementVB.x *= -1.0;
  displacementVB.z *= -1.0;
  vb.x += displacementVB.x / sizeOfOceanPatch;
  vb.z += displacementVB.y / sizeOfOceanPatch;
  vb.y += displacementVB.z / sizeOfOceanPatch;

  displacedNormal = normalize(cross(vt - v0, vb - v0));
  displacedNormal = displacedNormal.xzy;
  displacedNormal.x *= -1.0;
  displacedNormal.z *= -1.0;


  //Set up our UV maps
  vUv = uv;

  //Have the water fade from dark blue to teal as it approaches the shore.
  colorMap = vec4(displacement.xyz, 1.0);

  //Add support for three.js fog
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vWorldPosition = (projectionMatrix * mvPosition).xyz;
  #include <fog_vertex>

  gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);
}
