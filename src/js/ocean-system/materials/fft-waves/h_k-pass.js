//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.hkShaderMaterialData = {
  uniforms: {
    textureH0: {type: 't', value: null},
    N: {type: 'f', value: 256.0},
    L: {type: 'f', value: 1000.0},
    uTime: {type: 'f', value: 0.0}
  },

  fragmentShader: function(isXAxis = false, isYAxis = false, isSlope = false){
    let originalGLSL = [
    'precision highp float;',

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
      'vec2 hk_tilda = cAdd(cMult(tilda_h0_k, expIwt), cMult(tilda_h0_minus_k_conj, expIwtConj));',

      '//k runs 0..2π·N/L over the FFT grid, but n > N/2 are negative frequencies',
      '//and should wrap into [-π·N/L, 0]. Without centering, every k-weighted',
      "//term below picks up a sign error at high n. The slope spectrum's error",
      "//scales as k × H (up to N× too large); chop's only as -kx/|k| (bounded,",
      '//hence "benign" in earlier comments) — but always doing the unwrap keeps',
      '//the math consistent and removes a footnote.',
      'float halfKmax = piTimes2 * N / (2.0 * L);',
      'vec2 kCentered = vec2(',
        'k.x > halfKmax ? k.x - 2.0 * halfKmax : k.x,',
        'k.y > halfKmax ? k.y - 2.0 * halfKmax : k.y',
      ');',
      'float magKCentered = max(length(kCentered), 0.0001);',

      '#if($isSlope)',
        '//Packed analytical slope spectrum: P(k) = (kx + i*kz) * i*H(k,t)',
        '//After IFFT: R = dh/dx, G = dh/dz — exact derivatives, zero aliasing at',
        '//all frequencies. Derivation: slopeX = i*kx*H, slopeZ = i*kz*H. Pack as',
        '//P = slopeX + i*slopeZ. Then IFFT(P) = slopeX(x) + i*slopeZ(x), giving',
        '//both slopes in one FFT chain.',
        'vec2 iH = vec2(-hk_tilda.y, hk_tilda.x);',
        'hk_tilda = cMult(kCentered, iH);',
      '#elif($isXAxis)',
        'vec2 dx = vec2(0.0, -kCentered.x / magKCentered);',
        'hk_tilda = cMult(dx, hk_tilda);',
      '#elif(!$isXAxis && !$isYAxis)',
        'vec2 dy = vec2(0.0, -kCentered.y / magKCentered);',
        'hk_tilda = cMult(dy, hk_tilda);',
      '#endif',
      'gl_FragColor = vec4(hk_tilda, 0.0, 1.0);',
    '}',
    ];

    let updatedLines = [];
    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      let updatedGLSL = originalGLSL[i].replace(/\$isSlope/g, isSlope ? '1' : '0');
      updatedGLSL = updatedGLSL.replace(/\$isXAxis/g, isXAxis ? '1' : '0');
      updatedGLSL = updatedGLSL.replace(/\$isYAxis/g, isYAxis ? '1' : '0');
      //Otherwise is z-axis, and sure, it is true these are dependent values but this is just easier

      updatedLines.push(updatedGLSL);
    }

    return updatedLines.join('\n');
  }
};
