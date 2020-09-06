precision highp float;

varying vec3 vViewVector;
varying vec4 colorMap;
varying vec2 vUv;

//uniform vec3 cameraDirection;
uniform int isBelowWater;
uniform float sizeOfOceanPatch;
uniform sampler2D normalMap;
uniform samplerCube depthCubemap;
uniform samplerCube reflectionRefractionCubemap;

//R0 For Schlick's Approximation
//With n1 = 1.33 and n0 = 1.05
const float r0 = 0.0200593121995247656062922;

void main(){
  //Get the reflected and refracted information of the scene
  vec3 fNormal = normalize(texture2D(normalMap, vUv + (vec2(cameraPosition.x, -cameraPosition.z) / sizeOfOceanPatch)).xyz);
  vec3 normalizedViewVector = normalize(vViewVector);
  vec3 reflectedCoordinates = reflect(normalizedViewVector, fNormal);
  reflectedCoordinates.y = clamp(reflectedCoordinates.y, 0.0, 1.0);
  vec3 refractedCoordinates = refract(normalizedViewVector, fNormal, 1.0 / 1.33);
  vec3 reflectedLight = textureCube(reflectionRefractionCubemap, reflectedCoordinates).rgb; //Reflection
  vec3 refractedLight = textureCube(reflectionRefractionCubemap, refractedCoordinates).rgb; //Refraction

  //Apply Schlick's approximation for the fresnel amount
  //https://en.wikipedia.org/wiki/Schlick%27s_approximation
  float oneMinusCosTheta = 1.0 - dot(fNormal, -normalizedViewVector);
  float reflectedLightPercent = min(r0 + (1.0 -  r0) * pow(oneMinusCosTheta, 5.0), 1.0);
  float refractedLightPercent = 1.0 - reflectedLightPercent;
  reflectedLightPercent *= 0.92;

  //Get the depth data for linear fog
  vec3 refractedRayCollisionPoint = textureCube(depthCubemap, refractedCoordinates).xyz;
  float distanceFromSurface = distance(vViewVector, refractedRayCollisionPoint);

  //Total light
  vec3 reducedRefractedLight = refractedLight * refractedLightPercent;
  float redAttenuatedLight = reducedRefractedLight.r * clamp((100.0 - distanceFromSurface) / 100.0, 0.0, 1.0);
  float greenAttenuatedLight = reducedRefractedLight.g * clamp((200.0 - distanceFromSurface) / 200.0, 0.0, 1.0);
  float blueAttenuatedLight = reducedRefractedLight.b * clamp((250.0 - distanceFromSurface) / 250.0, 0.0, 1.0);
  vec3 totalLight = reflectedLightPercent * reflectedLight + vec3(redAttenuatedLight, greenAttenuatedLight, blueAttenuatedLight);

  //Check if we are above or below the water to see what kind of fog is applied
  gl_FragColor = vec4(totalLight, 1.0);
}
