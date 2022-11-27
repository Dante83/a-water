//This is not your usual file, instead it is a kind of fragment file that contains
//a partial glsl fragment file with functions that are used in multiple locations
AWater.AOcean.Materials.Ocean.AtmosphereFunctions = {
  partialFragmentShader: function(textureWidth, textureHeight, textureDepth, textureZed, packingWidth, packingHeight, packingDepth, oceanParameters){
    let originalGLSL = [
    '//Based on the work of Oskar Elek',
    '//http://old.cescg.org/CESCG-2009/papers/PragueCUNI-Elek-Oskar09.pdf',
    '//and the thesis from http://publications.lib.chalmers.se/records/fulltext/203057/203057.pdf',
    '//by Gustav Bodare and Edvard Sandberg',

    'const float PI = 3.14159265359;',
    'const float PI_TIMES_FOUR = 12.5663706144;',
    'const float PI_TIMES_TWO = 6.28318530718;',
    'const float PI_OVER_TWO = 1.57079632679;',
    'const float ONE_OVER_RAYLEIGH_SCALE_HEIGHT = $oneOverRayleighScaleHeight;',
    'const float ONE_OVER_EIGHT_PI = 0.039788735772;',
    'const float ONE_OVER_FOUR_PI = 0.079577471545;',
    'const float METERS_TO_KM = 0.001;',
    'const float D_MAX = $dMax;',

    '//8 * (PI^3) *(( (n_air^2) - 1)^2) / (3 * N_atmos * ((lambda_color)^4))',
    '//I actually found the values from the ET Engine by Illation',
    '//https://github.com/Illation/ETEngine',
    '//Far more helpful for determining my mie and rayleigh values',
    'const vec3 RAYLEIGH_BETA = $rayleighBeta;',

    '//',
    '//General methods',
    '//',
    'float fModulo(float a, float b){',
      'return (a - (b * floor(a / b)));',
    '}',

    'vec3 vec3Modulo(vec3 a, vec3 b){',
      'float x = (a.x - (b.x * floor(a.x / b.x)));',
      'float y = (a.y - (b.y * floor(a.y / b.y)));',
      'float z = (a.z - (b.z * floor(a.z / b.z)));',
      'return vec3(x, y, z);',
    '}',

    'vec4 sRGBToLinear( in vec4 value ) {',
    '	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );',
    '}',

    '//',
    '//Scattering functions',
    '//',
    'float rayleighPhaseFunction(float cosTheta){',
      'return 1.12 + 0.4 * cosTheta;',
    '}',

    '//solar-zenith angle parameterization methods',
    'float inverseParameterizationToZenithAngle(float xz){',
        'return acos(2.0 * x - 1.0);',
    '}',

    'float parameterizationToToZenithAngle(float cosOfSolarZenithAngle){',
      'return 0.5 * (1.0 + cosOfSolarZenithAngle);',
    '}',

    'float inverseParameterizationToU(float u){',
      'return D_MAX * u;',
    '}',

    'float parameterizationToU(float x){',
      'return x / D_MAX;',
    '}',

    'float inverseParameterizationToU(float D, float v){',
      'return D * v;',
    '}',

    'float parameterizationToU(float D, float d){',
      'return d / D;',
    '}',

    '//2D-3D texture conversion methods',
    '//All of this stuff is zero-indexed',
    'const float textureWidth = $textureWidth;',
    'const float textureHeight = $textureHeight;',
    'const float packingWidth = $packingWidth;',
    'const float packingHeight = $packingHeight;',

    'vec3 get4DUVFrom2DUV(vec2 uv2){',
      'vec4 uv4;',
      'vec2 parentTextureDimensions = vec2(textureWidth * packingWidth, textureHeight * packingHeight);',
      'vec2 pixelPosition = uv2 * parentTextureDimensions;',
      'float w = floor(pixelPosition.x / textureWidth);',
      'float x = pixelPosition.x - w * textureWidth;',
      'float y = floor(pixelPosition.y / textureHeight);',
      'float z = pixelPosition.y - y * textureHeight;',
      'uv4.x = x / packingWidth;',
      'uv4.y = y / textureHeight;',
      'uv4.z = z / packingHeight;',
      'uv4.w = w / textureWidth;',

      'return uv4;',
    '}',
    ];

    const rayBet = oceanParameters.rayleighBeta;
    const rayleighBeta = `vec3(${rayBet.red.toFixed(16)}, ${rayBet.green.toFixed(16)}, ${rayBet.blue.toFixed(16)})`;
    const oneOverRayleighScaleHeight = 1.0 / oceanParameters.rayleighScaleHeight;

    let updatedLines = [];
    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      let updatedGLSL = originalGLSL[i].replace(/\$textureWidth/g, textureWidth.toFixed(1));
      updatedGLSL = updatedGLSL.replace(/\$textureHeight/g, textureHeight.toFixed(1));
      updatedGLSL = updatedGLSL.replace(/\$textureDepth/g, textureDepth.toFixed(1));
      updatedGLSL = updatedGLSL.replace(/\$textureZed/g, textureZed.toFixed(1));
      updatedGLSL = updatedGLSL.replace(/\$packingWidth/g, packingWidth.toFixed(1));
      updatedGLSL = updatedGLSL.replace(/\$packingHeight/g, packingHeight.toFixed(1));
      updatedGLSL = updatedGLSL.replace(/\$packingDepth/g, packingDepth.toFixed(1));
      updatedGLSL = updatedGLSL.replace(/\$oneOverRayleighScaleHeight/g, oneOverRayleighScaleHeight.toFixed(16));
      updatedGLSL = updatedGLSL.replace(/\$rayleighBeta/g, rayleighBeta);

      updatedLines.push(updatedGLSL);
    }

    return updatedLines.join('\n');
  }
}
