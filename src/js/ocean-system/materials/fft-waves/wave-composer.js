//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.waveComposerShaderMaterial = {
  uniforms: function(numberOfWaveComponents){
    return {
      xWavetextures: {value: new Array(numberOfWaveComponents)},
      yWavetextures: {value: new Array(numberOfWaveComponents)},
      zWavetextures: {value: new Array(numberOfWaveComponents)},
      N: {type: 'f', value: 0.0}
    };
  },

  fragmentShader: function(numberOfWaveComponents){
    let originalGLSL = [
    'precision highp float;',

    'varying vec3 vWorldPosition;',

    'uniform sampler2D xWavetextures[$numwaveTextures];',
    'uniform sampler2D yWavetextures[$numwaveTextures];',
    'uniform sampler2D zWavetextures[$numwaveTextures];',
    'uniform float N;',

    'float fModulo1(float a){',
      'return (a - floor(a));',
    '}',

    'void main(){',
      'vec2 position = gl_FragCoord.xy / resolution.xy;',
      'float sizeExpansion = (resolution.x + 1.0) / resolution.x; //Expand by exactly one pixel',
      'vec2 uv = sizeExpansion * position;',
      'vec2 wrappedUV = vec2(fModulo1(uv.x), fModulo1(uv.y));',
      'vec3 combinedWaveHeight = vec3(0.0);',

      '//Interpolations',
      'float totalOffsets = 0.0;',
      '#pragma unroll',
      'for(int i = 0; i < $numwaveTextures; i++){',
        'float waveHeight_x = texture2D(xWavetextures[i], wrappedUV).x;',
        'float waveHeight_y = texture2D(yWavetextures[i], wrappedUV).x;',
        'float waveHeight_z = texture2D(zWavetextures[i], wrappedUV).x;',
        'combinedWaveHeight += vec3(waveHeight_x, waveHeight_y, waveHeight_z);',
        'totalOffsets += 1.0;',
      '}',

      '//gl_FragColor = vec4(vec3(combinedWaveHeight / (N * N)), 0.0);',
      'gl_FragColor = vec4(combinedWaveHeight / (totalOffsets * N * N), 1.0);',
    '}',
    ];

    let updatedLines = [];
    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      updatedLines.push(originalGLSL[i].replace(/\$numwaveTextures/g, numberOfWaveComponents));
    }

    return updatedLines.join('\n');
  }
};
