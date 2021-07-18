precision highp float;

varying vec3 vViewVector;
varying vec3 vWorldPosition;
varying vec4 colorMap;
varying vec2 vUv;
varying vec3 displacedNormal;
varying mat3 modelMatrixMat3;
varying mat3 tbnMatrix;

//uniform vec3 cameraDirection;
uniform int isBelowWater;
uniform float sizeOfOceanPatch;
uniform sampler2D smallNormalMap;
uniform sampler2D largeNormalMap;
uniform samplerCube reflectionCubeMap;
uniform samplerCube refractionCubeMap;
uniform samplerCube depthCubeMap;

uniform vec2 smallNormalMapVelocity;
uniform vec2 largeNormalMapVelocity;

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
  vec3 t =  2.0 * normal1.xyz + vec3(-1.0, 0.0, -1.0);
  vec3 u =  normal2.xyz * vec3(-2.0, 2.0, -2.0) + vec3(1.0, -1.0, 1.0);
  vec3 r = t * dot(t, u) / t.y - u;

  return r * 0.5 + 0.5;
}

//Including this because someone removed this in a future versio of THREE. Why?!
vec3 MyAESFilmicToneMapping(vec3 color) {
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}

void main(){
  //Get the reflected and refracted information of the scene
  vec2 cameraOffset = vec2(cameraPosition.x, -cameraPosition.z);
  vec2 uvOffset = vec2Modulo(vUv + (cameraOffset / sizeOfOceanPatch));
  vec2 smallNormalMapOffset = vec2Modulo((vUv * 3.0) + ((cameraOffset + t * smallNormalMapVelocity) / (sizeOfOceanPatch / 3.0)));
  vec2 largeNormalMapOffset = vec2Modulo((vUv * 5.0) + ((cameraOffset - t * largeNormalMapVelocity) / (sizeOfOceanPatch / 5.0)));
  vec3 smallNormalMap = texture2D(smallNormalMap, smallNormalMapOffset).xzy;
  float normalMapZ = smallNormalMap.y;
  smallNormalMap.y = -smallNormalMap.z;
  smallNormalMap.z = normalMapZ;
  vec3 largeNormalMap = texture2D(largeNormalMap, largeNormalMapOffset).xzy;
  normalMapZ = largeNormalMap.y;
  largeNormalMap.y = -largeNormalMap.z;
  largeNormalMap.z = normalMapZ;
  vec3 combinedNormalMap = normalize(combineNormals(smallNormalMap, largeNormalMap));
  combinedNormalMap = combineNormals(combinedNormalMap, normalize(displacedNormal));
  combinedNormalMap = normalize(combinedNormalMap);
  vec3 normalizedViewVector = normalize(vViewVector);
  vec3 reflectedCoordinates = reflect(normalizedViewVector, combinedNormalMap);
  vec3 refractedCoordinates = refract(normalizedViewVector, combinedNormalMap, 1.005 / 1.333);
  vec3 reflectedLight = textureCube(reflectionCubeMap, reflectedCoordinates).rgb; //Reflection
  vec3 refractedLight = textureCube(refractionCubeMap, refractedCoordinates).rgb; //Refraction
  vec3 pointXYZ = textureCube(depthCubeMap, refractedCoordinates).rgb; //Scattering
  float distanceToPoint = distance(pointXYZ, vWorldPosition);
  vec3 transmittanceLightPercents = vec3(20.0, 25.0, 27.0) * 4.0;
  vec3 percentOfSourceLight = clamp(exp(-distanceToPoint / transmittanceLightPercents), 0.0, 1.0);
  refractedLight = percentOfSourceLight * pow(refractedLight, gamma);
  vec3 normalizedInscatterLight = (vec3(1.0) - percentOfSourceLight) * normalize(transmittanceLightPercents);

  //Apply Schlick's approximation for the fresnel amount
  //https://en.wikipedia.org/wiki/Schlick%27s_approximation
  float oneMinusCosTheta = 1.0 - dot(combinedNormalMap, -normalizedViewVector);
  float reflectedLightPercent = clamp(r0 + (1.0 -  r0) * pow(oneMinusCosTheta, 5.0), 0.0, 1.0);
  reflectedLight = reflectedLightPercent * pow(reflectedLight, gamma);

  //Total light
  vec3 totalLight = pow(normalizedInscatterLight, gamma) * 0.1 + refractedLight + reflectedLight;

  gl_FragColor = vec4(pow(totalLight, inverseGamma), 1.0);

  #include <fog_fragment>
}
