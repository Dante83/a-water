//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.waveHeightShaderMaterialData = {
  uniforms: {
    combinedWaveHeights: {type: 't', value: null},
    N: {type: 'f', value: 0.0},
    waveHeightMultiplier: {type: 'f', value: 1.0}
  },

  fragmentShader: [
    'precision highp float;',

    'uniform sampler2D combinedWaveHeights;',
    'uniform float N;',
    'uniform float waveHeightMultiplier;',

    'void main(){',
      'vec2 uv = gl_FragCoord.xy / resolution.xy;',
      'float outputputColor = waveHeightMultiplier * texture2D(combinedWaveHeights, uv).xyz / (N * N);',
      'gl_FragColor = vec4(vec3(outputColor), 1.0);',
    '}',
  ].join('\n')
};
