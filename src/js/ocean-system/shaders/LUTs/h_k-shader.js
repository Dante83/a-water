//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var hkShaderMaterialData = {
  uniforms: {
    textureH0: {type: 't', value: null},
    N: {type: 'f', value: 256.0},
    L: {type: 'f', value: 1000.0},
    uTime: {type: 'f', value: 0.0}
  },

  fragmentShader: [
    '#ifdef GL_ES',
    'precision mediump float;',
    'precision mediump int;',
    '#endif',

    '//With a lot of help from https://youtu.be/i0BPrGuOdPo',
    'uniform sampler2D textureH0;',
    'uniform float L; //1000.0',
    'uniform float N; //256.0',
    'uniform float uTime; //0.0',
    'const float g = 9.80665;',
    'const float piTimes2 = 6.283185307179586476925286766559005768394338798750211641949;',
    'const float pi = 3.141592653589793238462643383279502884197169;',

    'vec2 cMult(vec2 a, vec2 b){',
      'return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);',
    '}',

    'vec2 cAdd(vec2 a, vec2 b){',
      'return vec2(a.x + b.x, a.y + b.y);',
    '}',

    'vec2 conjugate(vec2 a){',
      'return vec2(a.x, -1.0 * a.y);',
    '}',

    'void main(){',
      'vec2 uv = gl_FragCoord.xy / resolution.xy;',
      'vec2 x = uv.xy * N;',
      'vec2 k = vec2(piTimes2 / L) * x;',
      'float magK = length(k);',
      'if (magK < 0.0001) magK = 0.0001;',
      'float w = sqrt(g * magK);',

      'vec4 tilda_h0 = texture2D(textureH0, uv.xy);',
      'vec2 tilda_h0_k = tilda_h0.rg;',
      'vec2 tilda_h0_minus_k_conj = conjugate(tilda_h0.ba);',

      'float cosOfWT = cos(w * uTime);',
      'float sinOfWT = sin(w * uTime);',

      '//Euler Formula',
      'vec2 expIwt = vec2(cosOfWT, sinOfWT);',
      'vec2 expIwtConj = vec2(cosOfWT, -sinOfWT);',

      '//dy',
      'vec2 hk_t_dy = cAdd(cMult(tilda_h0_k, expIwt), cMult(tilda_h0_minus_k_conj, expIwtConj));',

      '//We can actually pull this back in later on, because our hk_t_dx and hk_t_dz are just dependent',
      '//upon the above, k and magnitude',
      '//gl_FragColor =vec4(gaussianRandomNumber.xy * h0_k, gaussianRandomNumber.zw * h0_minusk);',
      'gl_FragColor =vec4(hk_t_dy, 0.0, 1.0);',
    '}',
  ].join('\n')
};
