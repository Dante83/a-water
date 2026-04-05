//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.waveComposerShaderMaterial = {
  uniforms: function(numberOfWaveComponents){
    return {
      xWavetextures: {value: new Array(numberOfWaveComponents)},
      yWavetextures: {value: new Array(numberOfWaveComponents)},
      zWavetextures: {value: new Array(numberOfWaveComponents)},
      cascadeScales: {value: new Array(numberOfWaveComponents).fill(1.0)},
      N: {type: 'f', value: 0.0},
      waveHeightMultiplier: {type: 'f', value: 1.0}
    };
  },

  fragmentShader: function(numberOfWaveComponents){
    let originalGLSL = [
    'varying vec3 vWorldPosition;',

    'uniform sampler2D xWavetextures[$total_offsets];',
    'uniform sampler2D yWavetextures[$total_offsets];',
    'uniform sampler2D zWavetextures[$total_offsets];',
    'uniform float cascadeScales[$total_offsets];',
    'uniform float N;',
    'uniform float waveHeightMultiplier;',

    'float fModulo1(float a){',
      'return (a - floor(a));',
    '}',

    'void main(){',
      'vec2 position = gl_FragCoord.xy / resolution.xy;',
      'vec2 baseUV = position;',
      'vec3 combinedWaveHeight = vec3(0.0);',

      '//Interpolations',
      'float waveHeight_x;',
      'float waveHeight_y;',
      'float waveHeight_z;',
      'vec2 cascadeUV;',

      '$unrolled_wave_composer',

      '//Each cascade covers independent frequency bands — no overlap division needed',
      'gl_FragColor = vec4(waveHeightMultiplier * combinedWaveHeight, 1.0);',
    '}',
    ];

    let numberOfWaveComponentsGLSL = "";
    for(let i = 0; i < numberOfWaveComponents; ++i){
      numberOfWaveComponentsGLSL += `cascadeUV = baseUV * cascadeScales[${i}];\n`;
      numberOfWaveComponentsGLSL += `waveHeight_x = texture2D(xWavetextures[${i}], cascadeUV).x;\n`;
      numberOfWaveComponentsGLSL += `waveHeight_y = texture2D(yWavetextures[${i}], cascadeUV).x;\n`;
      numberOfWaveComponentsGLSL += `waveHeight_z = texture2D(zWavetextures[${i}], cascadeUV).x;\n`;
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
