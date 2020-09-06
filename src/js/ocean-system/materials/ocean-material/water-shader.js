//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.Ocean.waterMaterial = {
  uniforms: {
    displacementMap: {type: 't', value: null},
    normalMap: {type: 't', value: null},
    isBelowWater: {type: 'i', value: 0},
    depthCubemap: {value: null},
    reflectionRefractionCubemap: {value: null},
    matrixWorld: {type: 'mat4', value: new THREE.Matrix4()},
  },

  fragmentShader: [
    'precision highp float;',

    'varying vec3 vViewVector;',
    'varying vec4 colorMap;',
    'varying vec2 vUv;',

    '//uniform vec3 cameraDirection;',
    'uniform int isBelowWater;',
    'uniform sampler2D normalMap;',
    'uniform samplerCube depthCubemap;',
    'uniform samplerCube reflectionRefractionCubemap;',

    "//R0 For Schlick's Approximation",
    '//With n1 = 1.33 and n0 = 1.05',
    'const float r0 = 0.0200593121995247656062922;',

    'void main(){',
      '//Get the reflected and refracted information of the scene',
      'vec3 fNormal = normalize(texture2D(normalMap, vUv).xyz);',
      'vec3 normalizedViewVector = normalize(vViewVector);',
      'vec3 reflectedCoordinates = reflect(normalizedViewVector, fNormal);',
      'reflectedCoordinates.y = clamp(reflectedCoordinates.y, 0.0, 1.0);',
      'vec3 refractedCoordinates = refract(normalizedViewVector, fNormal, 1.0 / 1.33);',
      'vec3 reflectedLight = textureCube(reflectionRefractionCubemap, reflectedCoordinates).rgb; //Reflection',
      'vec3 refractedLight = textureCube(reflectionRefractionCubemap, refractedCoordinates).rgb; //Refraction',

      "//Apply Schlick's approximation for the fresnel amount",
      '//https://en.wikipedia.org/wiki/Schlick%27s_approximation',
      'float oneMinusCosTheta = 1.0 - dot(fNormal, -normalizedViewVector);',
      'float reflectedLightPercent = min(r0 + (1.0 -  r0) * pow(oneMinusCosTheta, 5.0), 1.0);',
      'float refractedLightPercent = 1.0 - reflectedLightPercent;',
      'reflectedLightPercent *= 0.92;',

      '//Get the depth data for linear fog',
      'vec3 refractedRayCollisionPoint = textureCube(depthCubemap, refractedCoordinates).xyz;',
      'float distanceFromSurface = distance(vViewVector, refractedRayCollisionPoint);',

      '//Total light',
      'vec3 reducedRefractedLight = refractedLight * refractedLightPercent;',
      'float redAttenuatedLight = reducedRefractedLight.r * clamp((200.0 - distanceFromSurface) / 200.0, 0.0, 1.0);',
      'float greenAttenuatedLight = reducedRefractedLight.g * clamp((400.0 - distanceFromSurface) / 400.0, 0.0, 1.0);',
      'float blueAttenuatedLight = reducedRefractedLight.b * clamp((500.0 - distanceFromSurface) / 500.0, 0.0, 1.0);',
      'vec3 totalLight = reflectedLightPercent * reflectedLight + vec3(redAttenuatedLight, greenAttenuatedLight, blueAttenuatedLight);',

      '//Check if we are above or below the water to see what kind of fog is applied',
      'gl_FragColor = vec4(totalLight, 1.0);',
    '}',
  ].join('\n'),

  vertexShader: [
    'precision highp float;',

    'attribute vec4 tangent;',

    'varying vec3 tangentSpaceViewDirection;',
    'varying vec3 vViewVector;',
    'varying vec4 colorMap;',
    'varying vec2 vUv;',

    'uniform sampler2D displacementMap;',
    'uniform mat4 matrixWorld;',

    'void main() {',
      '//Set up our displacement map',
      'vec3 offsetPosition = position;',
      'vec3 displacement = texture2D(displacementMap, uv).xyz;',
      'displacement.x *= -1.0;',
      'displacement.z *= -1.0;',
      'offsetPosition.x += displacement.x;',
      'offsetPosition.z += displacement.y;',
      'offsetPosition.y += displacement.z;',
      'vViewVector = (matrixWorld * vec4(displacement + position, 1.0)).xyz - cameraPosition;',

      '//Set up our UV maps',
      'vUv = uv;',

      '//Have the water fade from dark blue to teal as it approaches the shore.',
      'colorMap = vec4(displacement, 1.0);',

      'gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);',
    '}',
  ].join('\n'),
};
