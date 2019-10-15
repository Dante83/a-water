//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var noiseShaderMaterialData = {
  uniforms: {
    offset: {type: 'f', value: 1.0},
  },

  fragmentShader: [
    '#ifdef GL_ES',
    'precision mediump float;',
    'precision mediump int;',
    '#endif',

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
      'vec2 uv = gl_FragCoord.xy / resolution.xy;',
      'gl_FragColor = vec4(vec3(rand((resolution.x * (uv.x + uv.y * resolution.y)) * offset)), 1.0);',
    '}',
  ].join('\n')
};
