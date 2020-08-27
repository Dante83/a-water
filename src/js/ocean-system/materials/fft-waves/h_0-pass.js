//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.h0ShaderMaterialData = {
  uniforms: {
    N: {type: 'f', value: 256.0},
    L: {type: 'f', value: 1000.0},
    A: {type: 'f', value: 20.0},
    L_: {type: 'f', value: 0.0},
    w: {type: 'v2', value: new THREE.Vector2(1.0, 0.0)}
  },

  fragmentShader: [
    'precision highp float;',

    '//With a lot of help from https://youtu.be/i0BPrGuOdPo',
    'uniform float N; //256.0',
    'uniform float L; //1000.0',
    'uniform float A; //20',
    'uniform vec2 w;//(1,0)',
    'uniform float L_; //Windspeed squared over the gravitational acceleration',

    'const float g = 9.80665;',
    'const float pi = 3.141592653589793238462643383279502884197169;',
    'const float piTimes2 = 6.283185307179586476925286766559005768394338798750211641949;',
    'const float oneOverSqrtOf2 = 0.707106781186547524400844362104849039284835937688474036588;',

    '//Box-Muller Method',
    'vec4 gaussRand(vec2 uv){',
      'vec2 texCoord = vec2(uv.xy);',
      'float noise00 = clamp(texture2D(textureNoise1, texCoord).r + 0.00001, 0.0, 1.0);',
      'float noise01 = clamp(texture2D(textureNoise2, texCoord).r + 0.00001, 0.0, 1.0);',
      'float noise02 = clamp(texture2D(textureNoise3, texCoord).r + 0.00001, 0.0, 1.0);',
      'float noise03 = clamp(texture2D(textureNoise4, texCoord).r + 0.00001, 0.0, 1.0);',

      'float u0 = piTimes2 * noise00;',
      'float v0 = sqrt(-2.0 * log(noise01));',
      'float u1 = piTimes2 * noise02;',
      'float v1 = sqrt(-2.0 * log(noise03));',

      'return vec4(v0 * cos(u0), v0 * sin(u0), v1 * cos(u1), v1 * sin(u1));',
    '}',

    'void main(){',
      'vec2 uv = gl_FragCoord.xy / resolution.xy;',
      'vec2 x = uv.xy * N;',
      'vec2 k = vec2(piTimes2 / L) * x;',
      'float magK = length(k);',
      'if (magK < 0.0001) magK = 0.0001;',
      'float magSq = magK * magK;',
      'float L_ = 26.0 * 26.0 / 9.80665;',
      'float h0_coeficient = sqrt(A / (magSq * magSq)) * exp(-1.0/(magSq * L_ * L_)) * exp(-magSq * pow(L / 2000.0, 2.0)) / sqrt(2.0);',

      '//sqrt(Ph(k) / sqrt(2))',
      'float h0_k = clamp(h0_coeficient * pow(dot(normalize(k), normalize(w)), 2.0), 0.0, 1000000.0);',

      '//sqrt(Ph(-k) / sqrt(2))',
      'float h0_minus_k = clamp(h0_coeficient * pow(dot(normalize(-k), normalize(w)), 2.0), 0.0, 1000000.0);',

      'vec4 gaussianRandomNumber = gaussRand(uv);',

      'gl_FragColor =vec4(gaussianRandomNumber.xy * h0_k, gaussianRandomNumber.zw * h0_minus_k);',
    '}',
  ].join('\n')
};
