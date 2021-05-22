//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.Ocean.waterMaterial = {
  uniforms: {
    displacementMap: {type: 't', value: null},
    normalMap: {type: 't', value: null},
    foamMap: {type: 't', value: null},
    smallNormalMap: {type: 't', value: null},
    largeNormalMap: {type: 't', value: null},
    isBelowWater: {type: 'i', value: 0},
    depthCubemap: {value: null},
    reflectionRefractionCubemap: {value: null},
    matrixWorld: {type: 'mat4', value: new THREE.Matrix4()},
    sizeOfOceanPatch: {type: 'f', value: 1.0},
    fogNear: {type: 'f', value: null},
    fogFar: {type: 'f', value: null},
    fogDensity: {type: 'f', value: null},
    fogColor: {type: 'v3', value: new THREE.Color()},
  },

  fragmentShader: [
    'precision highp float;',

    'varying vec3 vViewVector;',
    'varying vec4 colorMap;',
    'varying vec2 vUv;',

    '//uniform vec3 cameraDirection;',
    'uniform int isBelowWater;',
    'uniform float sizeOfOceanPatch;',
    'uniform sampler2D normalMap;',
    'uniform sampler2D smallNormalMap;',
    'uniform sampler2D largeNormalMap;',
    'uniform sampler2D foamMap;',
    'uniform samplerCube depthCubemap;',
    'uniform samplerCube reflectionRefractionCubemap;',

    'uniform vec2 smallNormalMapVelocity;',
    'uniform vec2 largeNormalMapVelocity;',

    '//Fog variables',
    '#include <fog_pars_fragment>',

    'uniform vec4 directLightingColor;',

    "//R0 For Schlick's Approximation",
    '//With n1 = 1.33 and n0 = 1.05',
    'const float r0 = 0.0200593121995247656062922;',

    'vec2 vec2Modulo(vec2 inputUV){',
        'return (inputUV - floor(inputUV));',
    '}',

    'void main(){',
      '//Get the reflected and refracted information of the scene',
      'vec2 cameraOffset = vec2(cameraPosition.x, -cameraPosition.z);',
      'vec2 uvOffset = vec2Modulo(vUv + (cameraOffset / sizeOfOceanPatch));',
      'vec2 smallNormalMapOffset = vec2Modulo((vUv * 3.0) + (cameraOffset / (sizeOfOceanPatch / 3.0)));',
      'vec2 largeNormalMapOffset = vec2Modulo((vUv * 5.0) + (cameraOffset / (sizeOfOceanPatch / 5.0)));',
      'vec3 fNormal = normalize(texture2D(normalMap, uvOffset).xyz);',
      'vec3 smallNormalMap = normalize(texture2D(smallNormalMap, smallNormalMapOffset).rgb);',
      'vec3 largeNormalMap = normalize(texture2D(largeNormalMap, largeNormalMapOffset).rgb);',
      'fNormal = vec3(0.0,1.0,0.0);',
      'float foamAmount = texture2D(foamMap, uvOffset).x;',
      'vec3 normalizedViewVector = normalize(vViewVector);',
      'vec3 reflectedCoordinates = reflect(normalizedViewVector, fNormal);',
      'reflectedCoordinates.y = clamp(reflectedCoordinates.y, 0.0, 1.0);',
      'vec3 refractedCoordinates = refract(normalizedViewVector, fNormal, 1.005 / 1.33);',
      'refractedCoordinates.y = clamp(reflectedCoordinates.y, 0.0, -1.0);',
      'vec3 reflectedLight = textureCube(reflectionRefractionCubemap, reflectedCoordinates).rgb; //Reflection',
      'vec3 refractedLight = textureCube(reflectionRefractionCubemap, refractedCoordinates).rgb; //Refraction',

      "//Apply Schlick's approximation for the fresnel amount",
      '//https://en.wikipedia.org/wiki/Schlick%27s_approximation',
      'float oneMinusCosTheta = 1.0 - dot(fNormal, -normalizedViewVector);',
      'float reflectedLightPercent = min(r0 + (1.0 -  r0) * pow(oneMinusCosTheta, 5.0), 1.0);',
      'float refractedLightPercent = 1.0 - reflectedLightPercent;',

      '//Get the depth data for linear fog',
      'vec3 refractedRayCollisionPoint = textureCube(depthCubemap, refractedCoordinates).xyz;',
      'float distanceFromSurface = distance(vViewVector, refractedRayCollisionPoint);',

      '//Total light',
      'vec3 reducedRefractedLight = 0.8 * refractedLight;',
      'float redPercent = clamp((500.0 - distanceFromSurface) / 500.0, 0.0, 1.0);',
      'float greenPercent = clamp((800.0 - distanceFromSurface) / 800.0, 0.0, 1.0);',
      'float bluePercent = clamp((1000.0 - distanceFromSurface) / 1000.0, 0.0, 1.0);',
      'float redAttenuatedLight = reducedRefractedLight.r * redPercent + refractedLightPercent * 0.1;',
      'float greenAttenuatedLight = reducedRefractedLight.g * greenPercent + refractedLightPercent  * 0.3;',
      'float blueAttenuatedLight = reducedRefractedLight.b * bluePercent + refractedLightPercent * 0.3;',
      'vec3 totalLight = abs(reflectedLightPercent * reflectedLight) + abs(vec3(redAttenuatedLight, greenAttenuatedLight, blueAttenuatedLight));',

      '//Check if we are above or below the water to see what kind of fog is applied',
      'gl_FragColor = vec4(totalLight, 1.0);',

      '//Just reset everything to the new normal maps for now',
      'gl_FragColor = vec4(largeNormalMap, 1.0);',

      '#include <fog_fragment>',
    '}',
  ].join('\n'),

  vertexShader: [
    'precision highp float;',

    'attribute vec4 tangent;',

    'varying float height;',
    'varying vec3 tangentSpaceViewDirection;',
    'varying vec3 vViewVector;',
    'varying vec4 colorMap;',
    'varying vec2 vUv;',

    'uniform float sizeOfOceanPatch;',
    'uniform sampler2D displacementMap;',
    'uniform mat4 matrixWorld;',
    '#include <fog_pars_vertex>',

    'void main() {',
      '//Set up our displacement map',
      'vec3 offsetPosition = position;',
      'vec4 displacement = texture2D(displacementMap, uv  + (vec2(cameraPosition.x, -cameraPosition.z) / sizeOfOceanPatch));',
      'displacement.x *= -1.0;',
      'displacement.z *= -1.0;',
      'offsetPosition.x += displacement.x;',
      'offsetPosition.z += displacement.y;',
      'offsetPosition.y += displacement.z;',
      'vViewVector = (matrixWorld * vec4(displacement.xyz + position, 1.0)).xyz - cameraPosition;',

      '//Set up our UV maps',
      'vUv = uv;',

      '//Have the water fade from dark blue to teal as it approaches the shore.',
      'colorMap = vec4(displacement.xyz, 1.0);',

      '//Add support for three.js fog',
      'vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
      '#include <fog_vertex>',

      'gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);',
    '}',
  ].join('\n'),
};
