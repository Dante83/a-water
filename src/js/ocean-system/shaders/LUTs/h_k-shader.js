//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var hkShaderMaterial = new THREE.ShaderMaterial({
  uniforms: {
    h_o_k: {type: 't', value: null},
    noise_i0: {type: 't', value: null},
    N: {type: 'f', value: 256.0},
    L: {type: 'f', value: 1000.0},
    L: {type: 'f', value: 0.0},
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

    '//With a lot of help from https://youtu.be/i0BPrGuOdPo',
    'uniform sampler2D h_0_k;',
    'uniform float L; //1000.0',
    'uniform float t; //20',
    'const float g = 9.80665;',
    'const float pi = 3.141592653589793238462643383279502884197169;',

    'vec2 cMult(vec2 a, vec2 b){',
      'return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);',
    '}',

    'vec2 cAdd(vec2 a, vec2 b){',
      'return vec2(a.x + b.x, a.y + b.y);',
    '}',

    'vec2 conj(vec2 a){',
      'return vec2(a.x, -a.y);',
    '}',

    'void main(){',
      'vec2 x = vWorldPosition.xy * N;',
      'vec2 k = vec2(piTimes2 / L) * x;',
      'float magK = length(k);',
      'if (magK < 0.0001) magK = 0.0001;',
      'float w = (g * magK)',

      'vec4 tilda_h0 = texture2D(h_0_k, texCoord);',
      'tilda_h0_k = tilda_h0.xy;',
      'tilda_h0__minus_k_conj = conj(tilda_h0.zw);',

      'float sinus = sin(w * t);',
      'float cosinus = cos(w * t);',

      '//Euler Formula',
      'vec2 expIwt = vec2(sinus, cosinus);',
      'vec2 expIwtConj = vec2(sinus, -cosinus);',

      '//dy',
      'vec2 hk_t_dy = cAdd(cMult(tilda_h0_k, expIwt), cMult(tilda_h0__minus_k_conj, expIwtConj));',

      '//We can actually pull this back in later on, because our hk_t_dx and hk_t_dz are just dependent',
      '//upon the above, k and magnitude',
      '//gl_FragColor =vec4(gaussianRandomNumber.xy * h0_k, gaussianRandomNumber.zw * h0_minusk);',
      'gl_FragColor =vec4(dx, 0.0, 1.0);',
    '}',
  ].join('\n')
});
