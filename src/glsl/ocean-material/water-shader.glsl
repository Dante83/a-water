precision highp float;

varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec3 vInView;
varying mat4 vInstanceMatrix;
varying mat4 vModelMatrix;
varying mat3 vNormalMatrix;

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
//With n1 = 1.33 and n0 = 1.0
const float r0 = 0.02;
const vec3 inverseGamma = vec3(0.454545454545454545454545);
const vec3 gamma = vec3(2.2);

vec2 vec2Modulo(vec2 inputUV){
    return (inputUV - floor(inputUV));
}

vec4 sRGBToLinear( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}

vec4 linearTosRGB(vec4 value ) {
  return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}

//From https://blog.selfshadow.com/publications/blending-in-detail/
vec3 combineNormals(vec3 normal1, vec3 normal2){
  vec4 n1 = vec4(normal1.xyz, 1.0);
  vec4 n2 = vec4(normal2.xyz, 1.0);
  n1 = n1.xyzz * vec4(2.0, 2.0, 2.0, -2.0) + vec4(-1.0, -1.0, -1.0, 1.0);
  n2 = n2 * 2.0 - vec4(1.0);
  vec3 r;
  r.x = dot(n1.zxx,  n2.xyz);
  r.y = dot(n1.yzy,  n2.xyz);
  r.z = dot(n1.xyw, -n2.xyz);

  return 0.5 * (normalize(r) + vec3(1.0));
}

//Including this because someone removed this in a future versio of THREE. Why?!
vec3 MyAESFilmicToneMapping(vec3 color) {
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}

void main(){
  mat3 instanceMatrixMat3 = mat3(vInstanceMatrix[0].xyz, vInstanceMatrix[1].xyz, vInstanceMatrix[2].xyz );
  mat3 modelMatrixMat3 = mat3(vModelMatrix[0].xyz, vModelMatrix[1].xyz, vModelMatrix[2].xyz );
  vec2 cameraOffset = vec2(cameraPosition.x, cameraPosition.z);

  vec2 uvOffset = (vUv * sizeOfOceanPatch + cameraOffset) / sizeOfOceanPatch;
  vec3 displacement = texture2D(displacementMap, uvOffset).xyz;
  displacement.x *= -1.0;
  displacement.z *= -1.0;
  vec3 offsetPosition = vPosition + displacement;
  float height = (offsetPosition.y  + linearScatteringHeightOffset) / linearScatteringTotalScatteringWaveHeight;

  vec4 worldPosition = vModelMatrix * vInstanceMatrix * vec4(offsetPosition, 1.0);
  float distanceToWorldPosition = distance(worldPosition.xyz, cameraPosition.xyz);
  float LOD = pow(2.0, clamp(7.0 - (distanceToWorldPosition / (sizeOfOceanPatch * 7.0)), 2.0, 7.0));

  //Calculate our normal for this vertex
  float displacementFadeout = clamp((2500.0 - distanceToWorldPosition) / 2500.0, 0.0, 1.0);
  displacement *= displacementFadeout;
  vec3 tangent = vTangent;
  vec3 bitangent = vBitangent;
  vec3 deltaTangent = tangent / LOD;
  vec2 tangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset + deltaTangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vec3 vt = texture2D(displacementMap, tangentUVOffset).xyz * displacementFadeout;
  vt.x *= -1.0;
  vt.z *= -1.0;
  vec3 deltaBitangent = bitangent / LOD;
  vec2 biTangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset + deltaBitangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vec3 vb = texture2D(displacementMap, biTangentUVOffset).xyz * displacementFadeout;
  vb.x *= -1.0;
  vb.z *= -1.0;
  //Change in height with respect to x
  vec3 dhDt = normalize((vt + deltaTangent * sizeOfOceanPatch) - displacement);
  //Change in height with respect to z
  vec3 dhDbt = normalize((vb + deltaBitangent * sizeOfOceanPatch) - displacement);
  vec3 displacedNormal = cross(dhDt, dhDbt);

  tangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset - deltaTangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vt = texture2D(displacementMap, tangentUVOffset).xyz * displacementFadeout;
  vt.x *= -1.0;
  vt.z *= -1.0;
  biTangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset - deltaBitangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;
  vb = texture2D(displacementMap, biTangentUVOffset).xyz * displacementFadeout;
  vb.x *= -1.0;
  vb.z *= -1.0;
  //Change in height with respect to x
  dhDt = normalize((vt - deltaTangent * sizeOfOceanPatch) - displacement);
  //Change in height with respect to z
  dhDbt = normalize((vb - deltaBitangent * sizeOfOceanPatch) - displacement);
  displacedNormal = (cross(dhDt, dhDbt) + displacedNormal) * 0.5;
  displacedNormal = normalize(displacedNormal.xzy);

  //Get the reflected and refracted information of the scene
  vec2 smallNormalMapOffset = (((vUv * 2.0) * (sizeOfOceanPatch / 2.0) + cameraOffset + t * smallNormalMapVelocity) / (sizeOfOceanPatch / 2.0));
  vec2 largeNormalMapOffset = (((vUv * 1.0) * (sizeOfOceanPatch / 1.0) + cameraOffset - t * largeNormalMapVelocity) / (sizeOfOceanPatch / 1.0));
  vec3 smallNormalMap = texture2D(smallNormalMap, smallNormalMapOffset).xyz;
  smallNormalMap = 2.0 * smallNormalMap - 1.0;
  float smallNormalMapFadeout = clamp((500.0 - distanceToWorldPosition) / 250.0, 0.0, 1.0);
  smallNormalMap.x *= smallNormalMapStrength * smallNormalMapFadeout;
  smallNormalMap.y *= smallNormalMapStrength * smallNormalMapFadeout;
  smallNormalMap = normalize(smallNormalMap);
  smallNormalMap = (smallNormalMap + 1.0) * 0.5;
  vec3 largeNormalMap = texture2D(largeNormalMap, largeNormalMapOffset).xyz;
  largeNormalMap = 2.0 * largeNormalMap - 1.0;
  float largeNormalMapFadeout = clamp((1000.0 - distanceToWorldPosition) / 500.0, 0.0, 1.0);
  largeNormalMap.x *= largeNormalMapStrength * largeNormalMapFadeout;
  largeNormalMap.y *= largeNormalMapStrength * largeNormalMapFadeout;
  largeNormalMap = normalize(largeNormalMap);
  largeNormalMap = (largeNormalMap + 1.0) * 0.5;
  vec3 combinedNormalMap = combineNormals(smallNormalMap, largeNormalMap);
  vec3 normalizedDisplacedNormalMap = (normalize(displacedNormal) + vec3(1.0)) * 0.5;
  combinedNormalMap = combineNormals(normalizedDisplacedNormalMap, combinedNormalMap);
  combinedNormalMap = combinedNormalMap * 2.0 - vec3(1.0);
  combinedNormalMap = normalize(combinedNormalMap);
  combinedNormalMap = combinedNormalMap.xzy;
  vec3 normalizedViewVector = normalize(worldPosition.xyz - cameraPosition);
  vec3 reflectedCoordinates = reflect(normalizedViewVector, combinedNormalMap);
  vec3 refractedCoordinates = refract(normalizedViewVector, combinedNormalMap, 1.0/1.333);
  vec3 reflectedLight = textureCube(reflectionCubeMap, reflectedCoordinates).rgb; //Reflection
  vec3 refractedLight = textureCube(refractionCubeMap, refractedCoordinates).rgb; //Refraction
  vec3 pointXYZ = textureCube(depthCubeMap, refractedCoordinates).rgb; //Scattering
  float distanceToPoint = distance(pointXYZ, worldPosition.xyz);
  vec3 normalizedTransmittancePercentColor = normalize(lightScatteringAmounts);
  vec3 percentOfSourceLight = clamp(exp(-distanceToPoint / (lightScatteringAmounts * 6.0)), 0.0, 1.0);
  refractedLight = percentOfSourceLight * sRGBToLinear(vec4(refractedLight, 1.0)).rgb;
  //Increasing brightness with height inspired by, https://80.lv/articles/tutorial-ocean-shader-with-gerstner-waves/
  vec3 inscatterLight = pow(max(height, 0.0) * length(vec3(1.0) - percentOfSourceLight) * pow(normalizedTransmittancePercentColor, vec3(2.5))  * brightestDirectionalLight, gamma);

  //Apply Schlick's approximation for the fresnel amount
  //https://graphicscompendium.com/raytracing/11-fresnel-beer

  //Weird hack because of our odd anysotropy, I shouldn't have to clamp or normalize this...
  vec3 NinView = normalize(vNormalMatrix * combinedNormalMap);
  float oneMinusCosTheta = clamp(1.0 - dot(NinView, vInView), 0.0, 0.87) / 0.87;
  float fresnelFactor = r0 + (1.0 -  r0) * pow(oneMinusCosTheta, 5.0);
  reflectedLight = sRGBToLinear(vec4(reflectedLight, 1.0)).rgb;

  //Total light
  vec3 totalLight = (inscatterLight + refractedLight) * (1.0 - fresnelFactor) + reflectedLight * fresnelFactor;

  gl_FragColor = linearTosRGB(vec4(MyAESFilmicToneMapping(totalLight), 1.0));

  #include <fog_fragment>
}
