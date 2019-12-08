//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var amplitudeFilterShaderMaterial = {
  uniforms: {
    centralAmplitude: {type: 'f', value: 0.0},
    bandwidth: {type: 'f', value: 1.0}
  },

  fragmentShader: function(){
    return [
    'varying vec3 vWorldPosition;',

    'uniform float centralAmplitude;',
    'uniform float bandwidth;',

    'void main(){',
      'vec2 position = gl_FragCoord.xy / resolution.xy;',
      'float maxBandwidth = centralAmplitude - bandwidth;',
      'float minBandwidth = centralAmplitude + bandwidth;',

      'vec2 hkTexel = texture2D(hkTexture, position);',
      'float redChannelOut = 0.0;',
      'if(hkTexel.r > minBandwidth && hkTexel.r <= centralAmplitude){',
        'redChannelOut = (hkTexel.r - minBandwidth) / (centralAmplitude - minBandwidth);',
      '}',
      'else if(hkTexel.r < maxBandwidth && hkTexel.r >= centralAmplitude){',
        'redChannelOut = (maxBandwidth - hkTexel.r) / (maxBandwidth - centralAmplitude);',
      '}',

      'float greenChannelOut = 0.0;',
      'if(hkTexel.g > minBandwidth && hkTexel.g <= centralAmplitude){',
        'greenChannelOut = (hkTexel.g - minBandwidth) / (centralAmplitude - minBandwidth);',
      '}',
      'else if(hkTexel.g < maxBandwidth && hkTexel.g >= centralAmplitude){',
        'greenChannelOut = (maxBandwidth - hkTexel.g) / (maxBandwidth - centralAmplitude);',
      '}',

      'gl_FragColor = vec4(redChannelOut, greenChannelOut, 0.0, 0.0);',
    '}',
    ].join('\n');
  }
};
