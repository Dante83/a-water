precision highp float;

varying vec3 vWorldPosition;
varying vec4 colorMap;
varying vec3 vNormal;
varying vec2 vUv;

//uniform vec3 cameraDirection;
uniform int isBelowWater;
uniform samplerCube depthCubemap;
uniform samplerCube reflectionRefractionCubemap;

void main(){
  //Get the reflected and refracted information of the scene
  vec3 reflectedCoordinates = reflect(vWorldPosition, vNormal.rbg);
  vec3 refractedCoordinates = refract(vWorldPosition, vNormal.rbg, 1.33);
  vec3 reflectedLight = textureCube(reflectionRefractionCubemap, reflectedCoordinates).rgb; //Reflection
  vec3 refractedLight = textureCube(reflectionRefractionCubemap, refractedCoordinates).rgb; //Refraction

  //Apply fresnel to the reflection layer

  //Get the depth data for linear fog
  float waterDepth = clamp((textureCube(reflectionRefractionCubemap, vWorldPosition).r - distance(vWorldPosition, cameraPosition)) / 10.0, 0.0, 1.0);

  //Total light
  vec3 totalLight = reflectedLight;

  //Check if we are above or below the water to see what kind of fog is applied
  gl_FragColor = vec4(vec3(0.0, 0.1, 0.9), waterDepth);
}
