precision highp float;

varying vec3 vWorldPosition;
varying vec2 vUv;
varying float vHeight;
varying vec3 vDisplacement;
varying vec3 vViewVector;

//uniform vec3 cameraDirection;
uniform float sizeOfOceanPatch;
uniform float largeNormalMapStrength;
uniform float smallNormalMapStrength;
uniform sampler2D displacementMap;
uniform sampler2D smallNormalMap;
uniform sampler2D largeNormalMap;
uniform samplerCube reflectionCubeMap;
uniform samplerCube refractionCubeMap;
uniform samplerCube depthCubeMap;

uniform vec2 smallNormalMapVelocity;
uniform vec2 largeNormalMapVelocity;

uniform vec3 brightestDirectionalLight;
uniform vec3 lightScatteringAmounts;

uniform float linearScatteringHeightOffset;
uniform float linearScatteringTotalScatteringWaveHeight;

uniform float t;

//Fog variables
#include <fog_pars_fragment>

uniform vec4 directLightingColor;

//R0 For Schlick's Approximation
//With n1 = 1.33 and n0 = 1.05
const float r0 = 0.01968152171;
const vec3 inverseGamma = vec3(0.454545454545454545454545);
const vec3 gamma = vec3(2.2);

vec2 vec2Modulo(vec2 inputUV){
    return (inputUV - floor(inputUV));
}

//From https://blog.selfshadow.com/publications/blending-in-detail/
vec3 combineNormals(vec3 normal1, vec3 normal2){
  vec3 t = normal1.xyz * vec3(2.0,  2.0, 2.0) + vec3(-1.0, -1.0,  0.0);
  vec3 u = normal2.xyz * vec3(-2.0, -2.0, 2.0) + vec3(1.0,  1.0, -1.0);
  vec3 r = t * dot(t, u) - u * t.z;
  return (normalize(r) + vec3(1.0)) * 0.5;
}

//Including this because someone removed this in a future versio of THREE. Why?!
vec3 MyAESFilmicToneMapping(vec3 color) {
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}

void main(){
  mat3 instanceMatrixMat3 = mat3(instanceMatrix[0].xyz, instanceMatrix[1].xyz, instanceMatrix[2].xyz );
  mat3 modelMatrixMat3 = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz );
  vec2 cameraOffset = vec2(cameraPosition.x, cameraPosition.z);
  float height = (vDisplacement.y  + linearScatteringHeightOffset) / linearScatteringTotalScatteringWaveHeight;

  vec2 uvOffset = (vUv * sizeOfOceanPatch + cameraOffset) / sizeOfOceanPatch;
  vec3 displacement = texture2D(displacementMap, uvOffset).xyz;
  displacement.x *= -1.0;
  displacement.z *= -1.0;

  vec3 offsetPosition = displacement;

  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
  float distanceToWorldPosition = distance(worldPosition.xyz, cameraPosition.xyz);
  float LOD = pow(2.0, clamp(7.0 - (distanceToWorldPosition / (sizeOfOceanPatch * 7.0)), 1.0, 7.0));
  offsetPosition = vPosition + displacement;

  //Calculate our normal for this vertex
  vec3 deltaTangent = tangent / LOD;
  vec2 tangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset + deltaTangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vec3 vt = texture2D(displacementMap, tangentUVOffset).xyz;
  vt.x *= -1.0;
  vt.z *= -1.0;
  vec3 deltaBitangent = bitangent / LOD;
  vec2 biTangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset + deltaBitangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vec3 vb = texture2D(displacementMap, biTangentUVOffset).xyz;
  vb.x *= -1.0;
  vb.z *= -1.0;
  //Change in height with respect to x
  vec3 dhDt = normalize((vt + deltaTangent * sizeOfOceanPatch) - displacement);
  //Change in height with respect to z
  vec3 dhDbt = normalize((vb + deltaBitangent * sizeOfOceanPatch) - displacement);
  vec3 displacedNormal = cross(dhDt, dhDbt);

  tangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset - deltaTangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vt = texture2D(displacementMap, tangentUVOffset).xyz;
  vt.x *= -1.0;
  vt.z *= -1.0;
  biTangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset - deltaBitangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vb = texture2D(displacementMap, biTangentUVOffset).xyz;
  vb.x *= -1.0;
  vb.z *= -1.0;
  //Change in height with respect to x
  dhDt = normalize((vt - deltaTangent * sizeOfOceanPatch) - displacement);
  //Change in height with respect to z
  dhDbt = normalize((vb - deltaBitangent * sizeOfOceanPatch) - displacement);
  displacedNormal = (cross(dhDt, dhDbt) + displacedNormal) * 0.5;
  displacedNormal = displacedNormal.xzy;

  //Get the reflected and refracted information of the scene
  vec2 smallNormalMapOffset = (((vUv * 3.0) * (sizeOfOceanPatch / 3.0) + cameraOffset + t * smallNormalMapVelocity) / (sizeOfOceanPatch / 3.0));
  vec2 largeNormalMapOffset = (((vUv * 5.0) * (sizeOfOceanPatch / 5.0) + cameraOffset - t * largeNormalMapVelocity) / (sizeOfOceanPatch / 5.0));
  vec3 smallNormalMap = texture2D(smallNormalMap, smallNormalMapOffset).xyz;
  smallNormalMap = 2.0 * smallNormalMap - 1.0;
  smallNormalMap.xy *= smallNormalMapStrength;
  smallNormalMap = normalize(smallNormalMap);
  smallNormalMap = (smallNormalMap + 1.0) * 0.5;
  vec3 largeNormalMap = texture2D(largeNormalMap, largeNormalMapOffset).xyz;
  largeNormalMap = 2.0 * largeNormalMap - 1.0;
  largeNormalMap.xy *= largeNormalMapStrength;
  largeNormalMap = normalize(largeNormalMap);
  largeNormalMap = (largeNormalMap + 1.0) * 0.5;
  vec3 combinedNormalMap = combineNormals(smallNormalMap, largeNormalMap);
  vec3 normalizedDisplacedNormalMap = (normalize(displacedNormal) + vec3(1.0)) * 0.5;
  combinedNormalMap = combineNormals(normalizedDisplacedNormalMap, combinedNormalMap);
  combinedNormalMap = combinedNormalMap * 2.0 - vec3(1.0);
  combinedNormalMap = combinedNormalMap.xzy;
  vec3 normalizedViewVector = normalize(vViewVector.xyz);
  vec3 reflectedCoordinates = reflect(normalizedViewVector, combinedNormalMap);
  vec3 refractedCoordinates = refract(normalizedViewVector, combinedNormalMap, 1.005 / 1.333);
  vec3 reflectedLight = textureCube(reflectionCubeMap, reflectedCoordinates).rgb; //Reflection
  vec3 refractedLight = textureCube(refractionCubeMap, refractedCoordinates).rgb; //Refraction
  vec3 pointXYZ = textureCube(depthCubeMap, refractedCoordinates).rgb; //Scattering
  float distanceToPoint = distance(pointXYZ, vWorldPosition);
  vec3 normalizedTransmittancePercentColor = normalize(lightScatteringAmounts);
  vec3 percentOfSourceLight = clamp(exp(-distanceToPoint / lightScatteringAmounts), 0.0, 1.0);
  refractedLight = percentOfSourceLight * pow(refractedLight, gamma);
  //Increasing brightness with height inspired by, https://80.lv/articles/tutorial-ocean-shader-with-gerstner-waves/
  vec3 inscatterLight = pow(max(vHeight, 0.0) * length(vec3(1.0) - percentOfSourceLight) * pow(normalizedTransmittancePercentColor, vec3(2.5))  * brightestDirectionalLight, gamma);

  //Apply Schlick's approximation for the fresnel amount
  //https://en.wikipedia.org/wiki/Schlick%27s_approximation
  float oneMinusCosTheta = 1.0 - dot(combinedNormalMap, -normalizedViewVector);
  float reflectedLightPercent = clamp(r0 + (1.0 -  r0) * pow(0.9 * oneMinusCosTheta, 5.0), 0.0, 1.0);
  reflectedLight = pow(reflectedLight, gamma);

  //Total light
  vec3 totalLight = inscatterLight + mix(refractedLight, reflectedLight, reflectedLightPercent);

  gl_FragColor = vec4(pow(MyAESFilmicToneMapping(totalLight), inverseGamma), 1.0);

  #include <fog_fragment>
}
