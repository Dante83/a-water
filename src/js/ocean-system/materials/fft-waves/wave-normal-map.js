//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.waveNormalMapMaterialData = {
  uniforms: {
    waveHeightTexture: {type: 't', value: null},
    halfWidthOfPatchOverWaveScaleFactor: {type: 'f', value: 1.0}
  },

  fragmentShader: [
    'precision highp float;',

    'uniform sampler2D waveHeightTexture;',
    'uniform float halfWidthOfPatchOverWaveScaleFactor;',

    'void main(){',
      'vec2 uv = gl_FragCoord.xy / resolution.xy;',

      'gl_FragColor = vec4(vec3(1.0), 1.0);',
    '}',
  ].join('\n')
};
