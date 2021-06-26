precision highp float;

varying vec3 vViewVector;
varying vec4 colorMap;
varying vec2 vUv;
varying vec3 displacedNormal;
varying mat3 modelMatrixMat3;
varying mat3 tbnMatrix;

//uniform vec3 cameraDirection;
uniform int isBelowWater;
uniform float sizeOfOceanPatch;
uniform sampler2D normalMap;
uniform sampler2D smallNormalMap;
uniform sampler2D largeNormalMap;
uniform sampler2D foamMap;
uniform samplerCube reflectionCubeMap;
uniform samplerCube refractionCubeMap;

uniform vec2 smallNormalMapVelocity;
uniform vec2 largeNormalMapVelocity;

uniform float t;

//Fog variables
#include <fog_pars_fragment>

uniform vec4 directLightingColor;

//R0 For Schlick's Approximation
//With n1 = 1.33 and n0 = 1.05
const float r0 = 0.0200593121995247656062922;

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

#include <packing>

void main(){
  //Get the reflected and refracted information of the scene
  vec2 cameraOffset = vec2(cameraPosition.x, -cameraPosition.z);
  vec2 uvOffset = vec2Modulo(vUv + (cameraOffset / sizeOfOceanPatch));
  vec2 smallNormalMapOffset = vec2Modulo((vUv * 3.0) + ((cameraOffset + t * smallNormalMapVelocity) / (sizeOfOceanPatch / 3.0)));
  vec2 largeNormalMapOffset = vec2Modulo((vUv * 5.0) + ((cameraOffset + t * largeNormalMapVelocity) / (sizeOfOceanPatch / 5.0)));
  //vec3 fNormal = normalize(texture2D(normalMap, uvOffset).xyz) * 2.0 - 1.0;
  vec3 smallNormalMap = texture2D(smallNormalMap, smallNormalMapOffset).xzy;
  float normalMapZ = smallNormalMap.y;
  smallNormalMap.y = -smallNormalMap.z;
  smallNormalMap.z = normalMapZ;
  vec3 largeNormalMap = texture2D(largeNormalMap, largeNormalMapOffset).xzy;
  normalMapZ = largeNormalMap.y;
  largeNormalMap.y = -largeNormalMap.z;
  largeNormalMap.z = normalMapZ;
  vec3 combinedNormalMap = combineNormals(smallNormalMap, largeNormalMap);
  combinedNormalMap = combineNormals(combinedNormalMap, normalize(displacedNormal));
  float foamAmount = texture2D(foamMap, uvOffset).x;
  vec3 normalizedViewVector = normalize(vViewVector);
  vec3 reflectedCoordinates = reflect(normalizedViewVector, combinedNormalMap);
  vec3 refractedCoordinates = refract(normalizedViewVector, combinedNormalMap, 1.005 / 1.333);
  vec3 reflectedLight = textureCube(reflectionCubeMap, reflectedCoordinates).rgb; //Reflection
  vec3 refractedLight = textureCube(refractionCubeMap, refractedCoordinates).rgb; //Refraction

  //Apply Schlick's approximation for the fresnel amount
  //https://en.wikipedia.org/wiki/Schlick%27s_approximation
  float oneMinusCosTheta = 1.0 - dot(combinedNormalMap, normalizedViewVector);
  float reflectedLightPercent = min(r0 + (1.0 -  r0) * pow(oneMinusCosTheta, 5.0), 1.0);

  //Total light
  float redAttenuatedLight = refractedLight.r * 0.14;
  float greenAttenuatedLight = refractedLight.g * 0.22;
  float blueAttenuatedLight = refractedLight.b * 0.25;
  reflectedLight = reflectedLightPercent * reflectedLight;
  reflectedLight *= reflectedLight;
  refractedLight = vec3(redAttenuatedLight, greenAttenuatedLight, blueAttenuatedLight);
  refractedLight *= refractedLight;
  vec3 totalLight = sqrt(reflectedLight + refractedLight);

  //Check if we are above or below the water to see what kind of fog is applied
  gl_FragColor = vec4(totalLight, 1.0);

  #include <fog_fragment>
}
