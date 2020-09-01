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
    bayerMatrixTexture: {type: 't', value: null}
  },

  fragmentShader: [
    'precision highp float;',

    'varying vec3 vWorldPosition;',
    'varying vec4 colorMap;',
    'varying vec3 vNormal;',
    'varying vec2 vUv;',

    '//uniform vec3 cameraDirection;',
    'uniform int isBelowWater;',
    'uniform sampler2D bayerMatrixTexture;',
    'uniform samplerCube depthCubemap;',
    'uniform samplerCube reflectionRefractionCubemap;',

    "//R0 For Schlick's Approximation",
    '//With n1 = 1.33 and n0 = 1.05',
    'const float r0 = -0.0200593121995247656062922;',

    'void main(){',
      '//Get the reflected and refracted information of the scene',
      'vec3 fNormal = normalize(vNormal).xzy;',
      'fNormal *= -1.0;',
      'vec3 fWorldPosition = normalize(vWorldPosition);',
      'vec3 reflectedCoordinates = reflect(fWorldPosition, fNormal);',
      'vec3 refractedCoordinates = refract(fWorldPosition, -fNormal, 1.0 / 1.33);',
      'vec3 reflectedLight = textureCube(reflectionRefractionCubemap, reflectedCoordinates).rgb; //Reflection',
      'vec3 refractedLight = textureCube(reflectionRefractionCubemap, refractedCoordinates).rgb; //Refraction',
      'reflectedLight = reflectedLight;',
      'refractedLight = refractedLight;',

      "//Apply Schlick's approximation for the fresnel amount",
      '//https://en.wikipedia.org/wiki/Schlick%27s_approximation',
      'float oneMinusCosTheta = 1.0 - dot(fNormal, fWorldPosition);',
      'float reflectedLightPercent = clamp(r0 + (1.0 -  r0) * pow(oneMinusCosTheta, 5.0), 0.0, 1.0);',
      'float refractedLightPercent = 1.0 - reflectedLightPercent;',

      '//Get the depth data for linear fog',
      'vec3 refractedRayCollisionPoint = textureCube(depthCubemap, refractedCoordinates).xyz;',
      'float distanceFromSurface = distance(vWorldPosition, refractedRayCollisionPoint);',

      '//Total light',
      'vec3 reducedRefractedLight = refractedLight * refractedLightPercent;',
      'float redAttenuatedLight = reducedRefractedLight.r * clamp((50.0 - distanceFromSurface) / 50.0, 0.0, 1.0);',
      'float greenAttenuatedLight = reducedRefractedLight.g * clamp((180.0 - distanceFromSurface) / 180.0, 0.0, 1.0);',
      'float blueAttenuatedLight = reducedRefractedLight.b * clamp((300.0 - distanceFromSurface) / 300.0, 0.0, 1.0);',
      'vec3 totalLight = (reflectedLightPercent * reflectedLight + vec3(redAttenuatedLight, greenAttenuatedLight, blueAttenuatedLight));',

      'vec3 filmicLight = ACESFilmicToneMapping(totalLight);',

      'filmicLight += vec3(texture2D(bayerMatrixTexture, gl_FragCoord.xy / 8.0).r / 32.0 - (1.0 / 128.0));',

      '//Check if we are above or below the water to see what kind of fog is applied',
      'gl_FragColor = vec4(filmicLight, 1.0);',
    '}',
  ].join('\n'),

  vertexShader: [
    'precision highp float;',

    '//attribute vec3 baseDepth;',
    'varying vec3 vWorldPosition;',
    'varying vec4 colorMap;',
    'varying vec3 vNormal;',

    'uniform sampler2D displacementMap;',
    'uniform sampler2D normalMap;',
    'uniform mat4 matrixWorld;',

    'void main() {',
      'vec3 offsetPosition = position;',
      'vec3 displacement = texture2D(displacementMap, uv).rgb;',
      'offsetPosition.z += displacement.r;',
      'vec4 worldPosition = matrixWorld * vec4(position, 1.0);',
      'worldPosition.y += displacement.r;',
      'vWorldPosition = worldPosition.xyz - cameraPosition;',

      '//Have the water fade from dark blue to teal as it approaches the shore.',
      'vNormal = texture2D(normalMap, uv).rgb;',
      'colorMap = vec4(displacement, 1.0);',

      'gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);',
    '}',
  ].join('\n'),
};
