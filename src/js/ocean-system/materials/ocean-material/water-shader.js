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

    'varying vec3 vWorldPosition;',
    'varying vec4 colorMap;',
    'varying vec3 vNormal;',
    'varying vec2 vUv;',

    '//uniform vec3 cameraDirection;',
    'uniform int isBelowWater;',
    'uniform samplerCube depthCubemap;',
    'uniform samplerCube reflectionRefractionCubemap;',

    'void main(){',
      '//Get the reflected and refracted information of the scene',
      'vec3 reflectedCoordinates = reflect(vWorldPosition, vNormal.rbg);',
      'vec3 refractedCoordinates = refract(vWorldPosition, vNormal.rbg, 1.33);',
      'vec3 reflectedLight = textureCube(reflectionRefractionCubemap, reflectedCoordinates).rgb; //Reflection',
      'vec3 refractedLight = textureCube(reflectionRefractionCubemap, refractedCoordinates).rgb; //Refraction',

      '//Apply fresnel to the reflection layer',

      '//Get the depth data for linear fog',
      'float waterDepth = clamp((textureCube(reflectionRefractionCubemap, vWorldPosition).r - distance(vWorldPosition, cameraPosition)) / 10.0, 0.0, 1.0);',

      '//Total light',
      'vec3 totalLight = reflectedLight;',

      '//Check if we are above or below the water to see what kind of fog is applied',
      'gl_FragColor = vec4(vec3(0.0, 0.1, 0.9), waterDepth);',
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
      'vWorldPosition = normalize(worldPosition.xyz - cameraPosition).xzy + displacement.r;',

      '//Have the water fade from dark blue to teal as it approaches the shore.',
      'vNormal = texture2D(normalMap, uv).rgb;',
      'vNormal = vec3(0.0, 1.0, 0.0);',
      'colorMap = vec4(displacement, 1.0);',

      'gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);',
    '}',
  ].join('\n'),
};
