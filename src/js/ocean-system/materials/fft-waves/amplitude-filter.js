//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.amplitudeFilterShaderMaterial = {
  uniforms: {
    frequencyRadiusStart: {type: 'f', value: 0.00},
    maxBandwidthStart: {type: 'f', value: 30000000.0},
  },

  fragmentShader: function(){
    return [
    'precision highp float;',

    'varying vec3 vWorldPosition;',

    'uniform float frequencyRadiusStart;',
    'uniform float maxBandwidthStart;',

    'void main(){',
      'vec2 position = gl_FragCoord.xy / resolution.xy;',
      'vec2 hkTexel = texture2D(textureHk, position).rg;',

      '//Low has a radius greater than 0.05 and a band limit of 10000',
      '//Low medium has a radius greater than 0.01 and a band limit of 750000',
      '//medium has a radius greater than 0.002 and a band limit of 10000000.0',
      '//medium high as a radius greater than 0.0014 and a band limit of 30000000.0',

      "//This could use fading... but for now, we don't need fading, we need this to work",
      '//So our filters are hard.',
      'float redChannelOut = 0.0;',
      'float greenChannelOut = 0.0;',
      'float radiusOfFrequency = sqrt(position.x * position.x + position.y * position.y);',
      'bool frequencyInRange = radiusOfFrequency > frequencyRadiusStart;',
      'if(abs(hkTexel.r) < maxBandwidthStart && frequencyInRange){',
        'redChannelOut = hkTexel.r;',
      '}',
      'if(abs(hkTexel.g) < maxBandwidthStart && frequencyInRange){',
        'greenChannelOut = hkTexel.g;',
      '}',

      'gl_FragColor = vec4(redChannelOut, greenChannelOut, 0.0, 1.0);',
    '}',
    ].join('\n');
  }
};
