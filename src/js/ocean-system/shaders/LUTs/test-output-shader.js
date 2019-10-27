//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var testOutputMaterial = new THREE.ShaderMaterial({
  uniforms: {
    inTexture: {type: 't', value: null}
  },

  vertexShader: [
    '#ifdef GL_ES',
    'precision mediump float;',
    'precision mediump int;',
    '#endif',

    'varying vec2 vUv;',

    'void main() {',
      'vec4 worldPosition = modelMatrix * vec4( position, 1.0 );',
      'vUv = uv;',

      'gl_Position = vec4(worldPosition.xy, 0.0, 1.0);',
    '}',
  ].join('\n'),

  fragmentShader: [
    '#ifdef GL_ES',
    'precision mediump float;',
    'precision mediump int;',
    '#endif',

    'uniform sampler2D inTexture;',
    'varying vec2 vUv;',

    'void main(){',
      'gl_FragColor = texture2D(inTexture, vUv);',
    '}',
  ].join('\n')
});
