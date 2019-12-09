//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var waveComposerShaderMaterial = {
  uniforms: function(numberOfWaveComponents){
    return {
      wavetextures: {value: new Array(numberOfWaveComponents)},
      beginFadingHeight: {value: new Array(numberOfWaveComponents)},
      vanishingHeight: {value: new Array(numberOfWaveComponents)},
      cornerDepth: {value: new Array(4)},
      N: {type: 'f', value: 0.0}
    };
  },

  fragmentShader: function(numberOfWaveComponents){
    let originalGLSL = [
    'varying vec3 vWorldPosition;',

    'uniform sampler2D wavetextures[$numwaveTextures];',
    'uniform float beginFadingHeight[$numwaveTextures];',
    'uniform float vanishingHeight[$numwaveTextures];',
    'uniform float cornerDepth[4];',
    'uniform float N;',

    'float fModulo1(float a){',
      'return (a - floor(a));',
    '}',

    'void main(){',
      'vec2 position = gl_FragCoord.xy / resolution.xy;',
      'float sizeExpansion = (resolution.x + 1.0) / resolution.x; //Expand by exactly one pixel',
      'vec2 uv = sizeExpansion * position;',
      'vec2 wrappedUV = vec2(fModulo1(uv.x), fModulo1(uv.y));',
      'float combinedWaveHeight = 0.0;',

      '//Bilinear interpolation',
      'mat2 cornerDepthMatrix = mat2(',
        'cornerDepth[3], cornerDepth[1],',
        'cornerDepth[2], cornerDepth[0]',
      ');',
      'vec2 bilinearXTerm = vec2(1.0 - position.x, position.x);',
      'vec2 bilinearYTerm = vec2(1.0 - position.y, position.y);',
      'float waterDepth = dot((cornerDepthMatrix * bilinearYTerm), bilinearXTerm);',

      '//Interpolations',
      'float totalHeights = 0.0;',
      '#pragma unroll',
      'for(int i = 0; i < $numwaveTextures; i++){',
        'float waveheight_i = texture2D(wavetextures[i], wrappedUV).r;',

        'if(waterDepth > beginFadingHeight[i]){',
          'combinedWaveHeight = waveheight_i;',
          'totalHeights += 1.0;',
        '}',
        'else if(waterDepth > vanishingHeight[i]){',
          'float heightModifier = clamp((waterDepth - vanishingHeight[i]) / (beginFadingHeight[i] - vanishingHeight[i]), 0.0, 1.0);',
          'combinedWaveHeight += heightModifier * waveheight_i;',
        '}',
      '}',

      '//gl_FragColor = vec4(vec3(combinedWaveHeight / (N * N)), 0.0);',
      'gl_FragColor = vec4(vec3(combinedWaveHeight / (totalHeights * N * N)), 1.0);',
    '}',
    ];

    let updatedLines = [];
    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      updatedLines.push(originalGLSL[i].replace(/\$numwaveTextures/g, numberOfWaveComponents));
    }

    return updatedLines.join('\n');
  }
};
