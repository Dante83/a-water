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

uniform float sizeOfOceanPatch;
uniform float linearScatteringTotalScatteringWaveHeight;
uniform float linearScatteringHeightOffset;
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

  vec2 cameraOffset = (vec2(cameraPosition.x, -cameraPosition.z) / sizeOfOceanPatch);
  vec2 uvOffset = uv + cameraOffset;
  vec3 displacement = texture2D(displacementMap, uvOffset).xyz;
  offsetPosition += modelMatrixMat3 * displacement;

  //Normal map
  vec3 scaledDisplacement = displacement / sizeOfOceanPatch;
  height = (offsetPosition.z  + linearScatteringHeightOffset) / linearScatteringTotalScatteringWaveHeight;
  vec3 bitangent = cross(normalize(normal.xyz), normalize(tangent.xyz));
  vec3 v0 = vec3(uvOffset, 0.0);
  v0 = v0 + scaledDisplacement;
  vec3 vt = v0 + (1.0 / 12.0) * normalize(tangent.xyz);
  vec3 vb = v0 + (1.0 / 12.0) * normalize(bitangent.xyz);

  vec3 displacementVT = texture2D(displacementMap, vt.xy).xyz;
  vt = vt + scaledDisplacement;
  vec3 displacementVB = texture2D(displacementMap, vb.xy).xyz;
  vb = vb + scaledDisplacement;
  displacedNormal = normalize(cross(vt - v0, vb - v0));

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
