//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var noiseShaderMaterial = new THREE.ShaderMaterial({
  uniforms: {
    offset: {type: 'f', value: 1.0},
    uImgSize: {type: 'v2', value: new THREE.Vector2(100.0, 100.0)},
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

    'uniform vec2 uImgSize;',
    'uniform float offset;',

    '//Additional work here to add more noise that is time dependent',
    'float fModulo(float a, float b){',
      'return (a - (b * floor(a / b)));',
    '}',

    '//From http://byteblacksmith.com/improvements-to-the-canonical-one-liner-glsl-rand-for-opengl-es-2-0/',
    'float rand(float x){',
        'float a = 12.9898;',
        'float b = 78.233;',
        'float c = 43758.5453;',
        'float dt= dot(vec2(x, x) ,vec2(a,b));',
        'float sn= mod(dt,3.14);',
        'return fract(sin(sn) * c);',
    '}',

    'void main(){',
      'gl_FragColor = vec4(vec3(rand((uImgSize.x * (vWorldPosition.x + vWorldPosition.y * uImgSize.y)) * offset)), 1.0);',
    '}',
  ].join('\n')
});