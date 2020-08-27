//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.noiseShaderMaterialData = {
  uniforms: {
    offset: {type: 'f', value: 1.0},
  },

  fragmentShader: [
    'precision highp float;',

    'uniform float offset;',

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
