//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var waveComposerShaderMaterial = {
  uniforms: function(numberOfWaveComponents){
    return {
      centralAmplitude: {value: new Array(numberOfWaveComponents)},
      beginFadingHeight: {type: new Array(numberOfWaveComponents)},
      fadeOutHeight: {type: new Array(numberOfWaveComponents)},
    }
  },

  fragmentShader: function(numberOfWaveComponents){
    let originalGLSL = [
    'varying vec3 vWorldPosition;',
    'const float estimatedHeight = 10.0;',

    'uniform sampler2D wavetextures[$numwaveTextures];',
    'uniform float beginFadingHeight[$numwaveTextures];',
    'uniform float fadeOutHeight[$numwaveTextures];',

    'void main(){',
      'vec2 position = gl_FragCoord.xy / resolution.xy;',
      'float combinedWaveHeight = 0.0;',

      'for(int i = 0; i < $numwaveTextures; i++){',
        'float waveheight_i = texture2D(wavetextures[i], position).r;',

        'if(estimatedHeight > beginFadingHeight[i]){',
          'combinedWaveHeight += waveheight_i;',
        '}',
        'else if(estimatedHeight > fadeOutHeight[i]){',
          'float heightModifier = clamp((estimatedHeight - fadeOutHeight[i]) / (beginFadingHeight[i] - fadeOutHeight[i]), 0.0, 1.0);',
          'combinedWaveHeight += heightModifier * waveheight_i;',
        '}',
      '}',

      'gl_FragColor = vec4(combinedWaveHeight, 0.0, 0.0, 0.0);',
    '}',
    ];

    let updatedLines = [];
    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      updatedLines.push(originalGLSL[i].replace(/\$numwaveTextures/g, numberOfWaveComponents));
    }

    return updatedLines.join('\n');
  }

  vertexShader: function(){
    return [
    ].join('\n');
  }
};
