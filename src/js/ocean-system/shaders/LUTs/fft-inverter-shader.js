//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var heightMapShader = new THREE.ShaderMaterial({
  uniforms: {
    pingpong: {type: 't', value: null},
    direction: {type: 'i', value: 1},
    oneOverNSquared: {type: 'f', value: 1.0},
  },

  transparent: false,
  lights: false,
  flatShading: true,
  clipping: false,

  vertexShader: [
    '#ifdef GL_ES',
    'precision mediump float;',
    'precision mediump int;',
    '#endif',

    'varying vec3 vWorldPosition;',

    'void main() {',
      'vec4 worldPosition = modelMatrix * vec4( position, 1.0 );',
      'vWorldPosition = clamp(vec3((position.xy + vec2(1.0)) * 0.5, 0.0), 0.0, 1.0);',

      'gl_Position = vec4(worldPosition.xy, 0.0, 1.0);',
    '}',
  ].join('\n'),

  fragmentShader: [
    '#ifdef GL_ES',
    'precision mediump float;',
    'precision mediump int;',
    '#endif',

    'varying vec3 vWorldPosition;',

    '//With a lot of help from https://youtu.be/8kgpxtggFog',
    'uniform sampler2D pingpongTexture;',
    'uniform int pingpong;',
    'uniform float oneOverNSquared;',

    '//We might want to do this in the vertex shader rather then',
    '//running through another shader pass for this.',
    'void main(){',
      'vec2 position = vWorldPosition.xy * N;',
      'float h = texture2D(pingpongTexture, position).r;',
      'gl_FragColor = vec4(vec3(h * oneOverNSquared), 1.0);',
    '}',
  ].join('\n')
});
