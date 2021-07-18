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
    'varying vec3 vWorldPosition;',

    'uniform sampler2D xWavetextures[$total_offsets];',
    'uniform sampler2D yWavetextures[$total_offsets];',
    'uniform sampler2D zWavetextures[$total_offsets];',
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
      'float waveHeight_x;',
      'float waveHeight_y;',
      'float waveHeight_z;',

      '$unrolled_wave_composer',

      '// for(int i = 0; i < numberOfWaveTextures; i++){',
      '//   float waveHeight_x = texture2D(xWavetextures[i], wrappedUV).x;',
      '//   float waveHeight_y = texture2D(yWavetextures[i], wrappedUV).x;',
      '//   float waveHeight_z = texture2D(zWavetextures[i], wrappedUV).x;',
      '//   combinedWaveHeight += vec3(waveHeight_x, waveHeight_y, waveHeight_z);',
      '//   totalOffsets += 1.0;',
      '// }',

      'gl_FragColor = vec4(combinedWaveHeight / ($total_offsets_float * N * N), 1.0);',
    '}',
    ];

    let numberOfWaveComponentsGLSL = "";
    for(let i = 0; i < numberOfWaveComponents; ++i){
      numberOfWaveComponentsGLSL += `waveHeight_x = texture2D(xWavetextures[${i}], wrappedUV).x;\n`;
      numberOfWaveComponentsGLSL += `waveHeight_y = texture2D(yWavetextures[${i}], wrappedUV).x;\n`;
      numberOfWaveComponentsGLSL += `waveHeight_z = texture2D(zWavetextures[${i}], wrappedUV).x;\n`;
      numberOfWaveComponentsGLSL += "combinedWaveHeight += vec3(waveHeight_x, waveHeight_y, waveHeight_z);\n";
    }

    let updatedLines = [];

    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      let updatedCode = originalGLSL[i];
      updatedCode = updatedCode.replace(/\$unrolled_wave_composer/g, numberOfWaveComponentsGLSL);
      updatedCode = updatedCode.replace(/\$total_offsets_float/g, numberOfWaveComponents + '.0');
      updatedCode = updatedCode.replace(/\$total_offsets/g, numberOfWaveComponents);
      updatedLines.push(updatedCode);
    }

    return updatedLines.join('\n');
  }
};
