//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.Ocean.waterMaterial = {
  uniforms: {
    displacementMap: {type: 't', value: null},
    smallNormalMap: {type: 't', value: null},
    largeNormalMap: {type: 't', value: null},
    causticMap: {type: 't', value: null},
    foamDiffuseMap: {type: 't', value: null},
    foamOpacityMap: {type: 't', value: null},
    foamNormalMap: {type: 't', value: null},
    foamRoughnessMap: {type: 't', value: null},
    smallNormalMapVelocity: {type: 'vec2', value: new THREE.Vector2()},
    largeNormalMapVelocity: {type: 'vec2', value: new THREE.Vector2()},
    reflectionCubeMap: {value: null},
    refractionCubeMap: {value: null},
    depthCubeMap: {value: null},
    sizeOfOceanPatch: {type: 'f', value: 1.0},
    fogNear: {type: 'f', value: null},
    fogFar: {type: 'f', value: null},
    fogDensity: {type: 'f', value: null},
    fogColor: {type: 'v3', value: new THREE.Color()},
    t: {type: 'f', value: 0.0},
    brightestDirectionalLight: {type: 'vec3', value: new THREE.Vector3(1.0,1.0,1.0)},
    brightestDirectionalLightDirection: {type: 'vec3', value: new THREE.Vector3(1.0,1.0,1.0)},
    largeNormalMapStrength: {type: 'f', value: 0.45},
    smallNormalMapStrength: {type: 'f', value: 0.35},
    lightScatteringAmounts: {type: 'vec3', value: new THREE.Vector3(88.0, 108.0, 112.0)},
    linearScatteringHeightOffset: {type: 'f', value: 10.0},
    linearScatteringTotalScatteringWaveHeight: {type: 'f', value: 20.0}
  },

  fragmentShader: [
    'precision highp float;',

    'varying vec2 vUv;',
    'varying vec3 vPosition;',
    'varying vec3 vTangent;',
    'varying vec3 vBitangent;',
    'varying vec3 vInView;',
    'varying mat4 vInstanceMatrix;',
    'varying mat4 vModelMatrix;',
    'varying mat3 vNormalMatrix;',

    '//uniform vec3 cameraDirection;',
    'uniform float sizeOfOceanPatch;',
    'uniform float largeNormalMapStrength;',
    'uniform float smallNormalMapStrength;',
    'uniform sampler2D displacementMap;',
    'uniform sampler2D smallNormalMap;',
    'uniform sampler2D largeNormalMap;',
    'uniform sampler2D causticMap;',
    'uniform samplerCube reflectionCubeMap;',
    'uniform samplerCube refractionCubeMap;',
    'uniform samplerCube depthCubeMap;',

    '//Foam maps',
    'uniform sampler2D foamDiffuseMap;',
    'uniform sampler2D foamOpacityMap;',
    'uniform sampler2D foamNormalMap;',
    'uniform sampler2D foamRoughnessMap;',

    'uniform vec2 smallNormalMapVelocity;',
    'uniform vec2 largeNormalMapVelocity;',

    'uniform vec3 brightestDirectionalLight;',
    'uniform vec3 brightestDirectionalLightDirection;',
    'uniform vec3 lightScatteringAmounts;',

    'uniform float linearScatteringHeightOffset;',
    'uniform float linearScatteringTotalScatteringWaveHeight;',

    'uniform float t;',

    '//Fog variables',
    '#include <fog_pars_fragment>',

    'uniform vec4 directLightingColor;',

    "//R0 For Schlick's Approximation",
    '//With n1 = 1.33 and n0 = 1.0',
    'const float r0 = 0.02;',
    'const vec3 inverseGamma = vec3(0.454545454545454545454545);',
    'const vec3 gamma = vec3(2.2);',

    'vec2 vec2Modulo(vec2 inputUV){',
        'return (inputUV - floor(inputUV));',
    '}',

    'vec4 sRGBToLinear( in vec4 value ) {',
    '	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );',
    '}',

    'vec4 linearTosRGB(vec4 value ) {',
      'return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );',
    '}',

    '//From https://blog.selfshadow.com/publications/blending-in-detail/',
    'vec3 combineNormals(vec3 normal1, vec3 normal2){',
      'vec4 n1 = vec4(normal1.xyz, 1.0);',
      'vec4 n2 = vec4(normal2.xyz, 1.0);',
      'n1 = n1.xyzz * vec4(2.0, 2.0, 2.0, -2.0) + vec4(-1.0, -1.0, -1.0, 1.0);',
      'n2 = n2 * 2.0 - vec4(1.0);',
      'vec3 r;',
      'r.x = dot(n1.zxx,  n2.xyz);',
      'r.y = dot(n1.yzy,  n2.xyz);',
      'r.z = dot(n1.xyw, -n2.xyz);',

      'return 0.5 * (normalize(r) + vec3(1.0));',
    '}',

    '//Including this because someone removed this in a future versio of THREE. Why?!',
    'vec3 MyAESFilmicToneMapping(vec3 color) {',
      'return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);',
    '}',

    'float causticShader(vec2 uv, float t){',
      'float tModified = (t / 20.0);',
      'vec2 uv1 = uv + vec2(0.8, 0.1) * tModified;',
      'vec2 uv2 = uv - vec2(0.2, 0.7) * tModified;',
      'float aSample1 = texture(causticMap, uv1).r;',
      'float aSample2 = texture(causticMap, uv2).g;',
      'return min(aSample1, aSample2);',
    '}',

    '//Converted from the Minstrel Water Engine',
    '/*',
    'MIT License',

    'Copyright (c) 2018 Jingping Yu',

    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',

    'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.',

    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
    'SOFTWARE.',
    '*/',
    'float foamAmount(vec2 vUv, float textureSize){',
      'float texelSize = 1.0 / textureSize;',
    '	vec2 dDdy = -0.5 * (texture2D(displacementMap, vUv + vec2(0.0, texelSize)).xz - texture2D(displacementMap, vUv + vec2(0.0, -texelSize)).xz) / 8.0;',
    '	vec2 dDdx = -0.5 * (texture2D(displacementMap, vUv + vec2(texelSize, 0.0)).xz - texture2D(displacementMap, vUv + vec2(-texelSize, 0.0)).xz) / 8.0;',
    '	float jacobian = (1.0 + dDdx.x) * (1.0 + dDdy.y) - dDdx.y * dDdy.x;',
    '	float turb = max(0.0, 1.0 - jacobian);',
    '	float xx = 1.0 + 3.0 * smoothstep(1.2, 1.8, turb);',
    '	xx = min(turb, 1.0);',
    '	xx = smoothstep(0.0, 1.0, turb);',
    '	return xx;',
    '}',

    'void main(){',
      'mat3 instanceMatrixMat3 = mat3(vInstanceMatrix[0].xyz, vInstanceMatrix[1].xyz, vInstanceMatrix[2].xyz );',
      'mat3 modelMatrixMat3 = mat3(vModelMatrix[0].xyz, vModelMatrix[1].xyz, vModelMatrix[2].xyz );',
      'vec2 cameraOffset = vec2(cameraPosition.x, cameraPosition.z);',

      'vec2 uvOffset = (vUv * sizeOfOceanPatch + cameraOffset) / sizeOfOceanPatch;',
      'vec3 displacement = texture2D(displacementMap, uvOffset).xyz;',
      'displacement.x *= -1.0;',
      'displacement.z *= -1.0;',
      'vec3 offsetPosition = vPosition + displacement;',
      'float height = (offsetPosition.y  + linearScatteringHeightOffset) / linearScatteringTotalScatteringWaveHeight;',

      'vec4 worldPosition = vModelMatrix * vInstanceMatrix * vec4(offsetPosition, 1.0);',
      'float distanceToWorldPosition = distance(worldPosition.xyz, cameraPosition.xyz);',
      'float LOD = pow(2.0, clamp(7.0 - (distanceToWorldPosition / (sizeOfOceanPatch * 7.0)), 2.0, 7.0));',

      '//Calculate our normal for this vertex',
      'float displacementFadeout = clamp((2500.0 - distanceToWorldPosition) / 2500.0, 0.0, 1.0);',
      'displacement *= displacementFadeout;',
      'vec3 tangent = vTangent;',
      'vec3 bitangent = vBitangent;',
      'vec3 deltaTangent = tangent / LOD;',
      'vec2 tangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset + deltaTangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;',
      'vec3 vt = texture2D(displacementMap, tangentUVOffset).xyz * displacementFadeout;',
      'vt.x *= -1.0;',
      'vt.z *= -1.0;',
      'vec3 deltaBitangent = bitangent / LOD;',
      'vec2 biTangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset + deltaBitangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;',
      'vec3 vb = texture2D(displacementMap, biTangentUVOffset).xyz * displacementFadeout;',
      'vb.x *= -1.0;',
      'vb.z *= -1.0;',
      '//Change in height with respect to x',
      'vec3 dhDt = normalize((vt + deltaTangent * sizeOfOceanPatch) - displacement);',
      '//Change in height with respect to z',
      'vec3 dhDbt = normalize((vb + deltaBitangent * sizeOfOceanPatch) - displacement);',
      'vec3 displacedNormal = cross(dhDt, dhDbt);',

      'tangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset - deltaTangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;',
      'vt = texture2D(displacementMap, tangentUVOffset).xyz * displacementFadeout;',
      'vt.x *= -1.0;',
      'vt.z *= -1.0;',
      'biTangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset - deltaBitangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;',
      'vb = texture2D(displacementMap, biTangentUVOffset).xyz * displacementFadeout;',
      'vb.x *= -1.0;',
      'vb.z *= -1.0;',
      '//Change in height with respect to x',
      'dhDt = normalize((vt - deltaTangent * sizeOfOceanPatch) - displacement);',
      '//Change in height with respect to z',
      'dhDbt = normalize((vb - deltaBitangent * sizeOfOceanPatch) - displacement);',
      'displacedNormal = (cross(dhDt, dhDbt) + displacedNormal) * 0.5;',
      'displacedNormal = normalize(displacedNormal.xzy);',

      '//Get the reflected and refracted information of the scene',
      'vec2 smallNormalMapOffset = (((vUv * 2.0) * (sizeOfOceanPatch / 2.0) + cameraOffset + t * smallNormalMapVelocity) / (sizeOfOceanPatch / 2.0));',
      'vec2 largeNormalMapOffset = (((vUv * 1.0) * (sizeOfOceanPatch / 1.0) + cameraOffset - t * largeNormalMapVelocity) / (sizeOfOceanPatch / 1.0));',
      'vec3 smallNormalMap = texture2D(smallNormalMap, smallNormalMapOffset).xyz;',
      'smallNormalMap = 2.0 * smallNormalMap - 1.0;',
      'float smallNormalMapFadeout = clamp((500.0 - distanceToWorldPosition) / 250.0, 0.0, 1.0);',
      'smallNormalMap.x *= smallNormalMapStrength * smallNormalMapFadeout;',
      'smallNormalMap.y *= smallNormalMapStrength * smallNormalMapFadeout;',
      'smallNormalMap = normalize(smallNormalMap);',
      'smallNormalMap = (smallNormalMap + 1.0) * 0.5;',
      'vec3 largeNormalMap = texture2D(largeNormalMap, largeNormalMapOffset).xyz;',
      'largeNormalMap = 2.0 * largeNormalMap - 1.0;',
      'float largeNormalMapFadeout = clamp((3000.0 - distanceToWorldPosition) / 2500.0, 0.0, 1.0);',
      'largeNormalMap.x *= largeNormalMapStrength * largeNormalMapFadeout;',
      'largeNormalMap.y *= largeNormalMapStrength * largeNormalMapFadeout;',
      'largeNormalMap = normalize(largeNormalMap);',
      'largeNormalMap = (largeNormalMap + 1.0) * 0.5;',
      'vec3 combinedNormalMap = combineNormals(smallNormalMap, largeNormalMap);',
      'vec3 foamNormal = texture2D(foamNormalMap, smallNormalMapOffset).xyz;',
      'foamNormal = 2.0 * smallNormalMap - 1.0;',
      'float foamAmount = foamAmount(uvOffset, 25.0);',
      'foamNormal.x *= foamAmount * largeNormalMapFadeout;',
      'foamNormal.y *= foamAmount * largeNormalMapFadeout;',
      'foamNormal = normalize(foamNormal);',
      'foamNormal = (foamNormal + 1.0) * 0.5;',
      'combinedNormalMap = combineNormals(combinedNormalMap, foamNormal);',
      'vec3 normalizedDisplacedNormalMap = (normalize(displacedNormal) + vec3(1.0)) * 0.5;',
      'combinedNormalMap = combineNormals(normalizedDisplacedNormalMap, combinedNormalMap);',
      'combinedNormalMap = combinedNormalMap * 2.0 - vec3(1.0);',
      'combinedNormalMap = normalize(combinedNormalMap);',
      'combinedNormalMap = combinedNormalMap.xzy;',

      'vec3 normalizedViewVector = normalize(worldPosition.xyz - cameraPosition);',
      'vec3 reflectedCoordinates = reflect(normalizedViewVector, combinedNormalMap);',
      '//Why?! O_O, ok, so I grabbed this from https://www.youtube.com/watch?v=kXH1-uY0wjY',
      '//and... it makes absolutely no sense, but apparently 1.0/1.333 - the actual',
      '//refraction coeficient for water is way too high. Is this not physically based',
      '//or maybe I am thinking about cubemaps wrong?',
      'vec3 refractedCoordinates = refract(normalizedViewVector, combinedNormalMap, 1.0 / 1.025);',
      'vec3 reflectedLight = textureCube(reflectionCubeMap, reflectedCoordinates).rgb; //Reflection',
      'vec3 refractedLight = textureCube(refractionCubeMap, refractedCoordinates).rgb; //Refraction',
      'vec3 pointXYZ = textureCube(depthCubeMap, refractedCoordinates).xyz; //Scattering',
      'float distanceToPoint = distance(pointXYZ, worldPosition.xyz);',
      'vec3 normalizedTransmittancePercentColor = normalize(lightScatteringAmounts);',
      'vec3 percentOfSourceLight = clamp(exp(-2.25 * distanceToPoint / (lightScatteringAmounts)), 0.0, 1.0);',
      'refractedLight = sRGBToLinear(vec4(refractedLight, 1.0)).rgb;',
      '//Increasing brightness with height inspired by, https://80.lv/articles/tutorial-ocean-shader-with-gerstner-waves/',
      'vec3 inscatterLight = pow(max(height, 0.0) * length(vec3(1.0) - percentOfSourceLight) * pow(normalizedTransmittancePercentColor, vec3(2.5))  * brightestDirectionalLight, gamma);',

      "//Apply Schlick's approximation for the fresnel amount",
      '//https://graphicscompendium.com/raytracing/11-fresnel-beer',

      "//Weird hack because of our odd anysotropy, I shouldn't have to clamp or normalize this...",
      'vec3 NinView = normalize(vNormalMatrix * combinedNormalMap);',
      'float oneMinusCosTheta = 1.0 - dot(NinView, vInView);',
      'float fresnelFactor = r0 + (1.0 -  r0) * pow(oneMinusCosTheta, 5.0);',
      'reflectedLight = sRGBToLinear(vec4(reflectedLight, 1.0)).rgb;',

      '//Caculate caustic lighting',
      "//Probably needs offsetting based on height but let's just see how this is",
      'float causticLightingR = causticShader(0.01 * pointXYZ.xz + 0.005, t);',
      'float causticLightingG = causticShader(0.01 * pointXYZ.xz, t);',
      'float causticLightingB = causticShader(0.01 * pointXYZ.xz - 0.005, t);',
      'vec3 causticLighting = 20.0 * vec3(causticLightingR, causticLightingG, causticLightingB);',
      'if(distance(cameraPosition, pointXYZ.xyz) > 2500.0){',
        'causticLighting = vec3(1.0);',
      '}',
      'refractedLight *= (0.5 + causticLighting);',
      'refractedLight *= percentOfSourceLight;',

      '//Calculate specular lighting and surface lighting',
      'vec3 directionalSurfaceLighting = max(sRGBToLinear(vec4(brightestDirectionalLight * dot(combinedNormalMap, -brightestDirectionalLightDirection), 1.0)).rgb, vec3(0.0));',
      'vec3 specular = 1.7 * brightestDirectionalLight * clamp((dot(reflectedCoordinates, -brightestDirectionalLightDirection) - 0.995) / 0.005, 0.0, 1.0);',

      '//Total light',
      'vec3 totalLight = specular + (2.0 / 255.0) * directionalSurfaceLighting + (253.0 / 255.0) * ((inscatterLight + refractedLight) * (1.0 - fresnelFactor) + reflectedLight * fresnelFactor);',
      'float foamOpacity = foamAmount * texture2D(foamOpacityMap, smallNormalMapOffset).r;',
      'vec3 foamLight = texture2D(foamDiffuseMap, smallNormalMapOffset).rgb;',
      'totalLight += (1.0 + texture2D(foamRoughnessMap, smallNormalMapOffset).rgb) * mix(vec3(0.0), directionalSurfaceLighting, foamOpacity * foamAmount);',

      'gl_FragColor = linearTosRGB(vec4(MyAESFilmicToneMapping(totalLight), 1.0));',

      '#include <fog_fragment>',
    '}',
  ].join('\n'),

  vertexShader: [
    'precision highp float;',

    'attribute vec3 tangent;',
    'attribute vec3 bitangent;',

    'varying vec2 vUv;',
    'varying vec3 vPosition;',
    'varying vec3 vTangent;',
    'varying vec3 vBitangent;',
    'varying vec3 vInView;',
    'varying mat4 vInstanceMatrix;',
    'varying mat4 vModelMatrix;',
    'varying mat3 vNormalMatrix;',

    'uniform float sizeOfOceanPatch;',
    'uniform sampler2D displacementMap;',
    'uniform float linearScatteringHeightOffset;',
    'uniform float linearScatteringTotalScatteringWaveHeight;',

    '#include <fog_pars_vertex>',

    'vec2 vec2Modulo(vec2 inputUV){',
        'return (inputUV - floor(inputUV));',
    '}',

    'void main() {',
      '//Set up our displacement map',
      'vec3 offsetPosition = position;',
      'mat3 instanceMatrixMat3 = mat3(instanceMatrix[0].xyz, instanceMatrix[1].xyz, instanceMatrix[2].xyz );',
      'mat3 modelMatrixMat3 = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz );',

      'vec2 cameraOffset = vec2(cameraPosition.x, cameraPosition.z);',
      'vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));',
      'float distanceToVertex = distance(cameraPosition.xyz, worldPositionOfVertex.xyz);',
      'vec2 uvOffset = (uv * sizeOfOceanPatch + cameraOffset) / sizeOfOceanPatch;',
      'float displacementFadeout = clamp((2500.0 - distanceToVertex) / 2500.0, 0.0, 1.0);',
      'vec3 displacement = texture2D(displacementMap, uvOffset).xyz * displacementFadeout;',
      'displacement.x *= -1.0;',
      'displacement.z *= -1.0;',
      'offsetPosition += displacement;',

      '//Set up our varyings',
      'vUv = uv;',
      'vTangent = tangent;',
      'vBitangent = bitangent;',
      'vPosition = position;',
      '//From https://stackoverflow.com/questions/59492385/angle-between-view-vector-and-normal',
      'vec4 posInView = (modelViewMatrix * instanceMatrix * vec4(offsetPosition, 1.0));',
      'posInView /= posInView[3];',
      'vInView = normalize(-posInView.xyz);',
      'vInstanceMatrix = instanceMatrix;',
      'vModelMatrix = modelMatrix;',
      'vNormalMatrix = normalMatrix;',

      '//Add support for three.js fog',
      '#include <fog_vertex>',

      'gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);',
    '}',
  ].join('\n'),
};
