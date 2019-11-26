//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var butterflyTextureDataInitializer= {
  uniforms: {
    hkTexture_0: {type: 't', value: null},
    hkTexture_1: {type: 't', value: null},
    hkTexture_2: {type: 't', value: null},
    hkTexture_3: {type: 't', value: null},
    twiddleTexture: {type: 't', value: null},
    stageFraction: {type: 'f', value: 0.0},
    direction: {type: 'i', value: 1}
  },

  fragmentShader: function(pingpong_id, injectVariable = false){
    return [
    'varying vec3 vWorldPosition;',

    '//With a lot of help from https://youtu.be/i0BPrGuOdPo',
    'uniform sampler2D hkTexture_0;',
    'uniform sampler2D hkTexture_1;',
    'uniform sampler2D hkTexture_2;',
    'uniform sampler2D hkTexture_3;',
    'uniform sampler2D twiddleTexture;',
    'uniform float stageFraction;',
    'uniform int direction;',

    'const float pi = 3.141592653589793238462643383279502884197169;',

    'vec2 cMult(vec2 a, vec2 b){',
      'return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);',
    '}',

    'vec2 cAdd(vec2 a, vec2 b){',
      'return vec2(a.x + b.x, a.y + b.y);',
    '}',

    'vec4 horizontalButterflies(vec2 position){',
      'vec4 data = texture2D(twiddleTexture, vec2(stageFraction, position.x));',

      '//Get the weighted combination of our p and q values from frequency space',
      'vec2 p_0 = texture2D(hkTexture_0, vec2(data.z, position.y)).rg;',
      'vec2 p_1 = texture2D(hkTexture_1, vec2(data.z, position.y)).rg;',
      'vec2 p_2 = texture2D(hkTexture_2, vec2(data.z, position.y)).rg;',
      'vec2 p_3 = texture2D(hkTexture_3, vec2(data.z, position.y)).rg;',
      'vec2 weightedP = (position.x * p_0 + (1.0 - position.x) * p_1 + position.y * p_2 + (1.0 - position.y) * p_3) * 0.5;',

      'vec2 q_0 = texture2D(hkTexture_0, vec2(data.w, position.y)).rg;',
      'vec2 q_1 = texture2D(hkTexture_1, vec2(data.w, position.y)).rg;',
      'vec2 q_2 = texture2D(hkTexture_2, vec2(data.w, position.y)).rg;',
      'vec2 q_3 = texture2D(hkTexture_3, vec2(data.w, position.y)).rg;',
      'vec2 weightedQ = (position.x * q_0 + (1.0 - position.x) * q_1 + position.y * q_2 + (1.0 - position.y) * q_3) * 0.5;',

      '//TODO: Fade out our frequency space so that the amplitudes of all frequencies',
      '//approach zero unless they are aligned with the weighted vector of maximum',
      '//slope and approach zero at a rate decided by the heights of the corners.',

      'vec2 w = vec2(data.x, data.y);',
      'vec2 H = cAdd(weightedP, cMult(w, weightedQ));',
      'return vec4(H, 0.0, 1.0);',
    '}',

    'vec4 verticalButterflies(vec2 position){',
      'vec4 data = texture2D(twiddleTexture, vec2(stageFraction, position.y));',

      '//Get the weighted combination of our p and q values from frequency space',
      'vec2 p_0 = texture2D(hkTexture_0, vec2(position.x, data.z)).rg;',
      'vec2 p_1 = texture2D(hkTexture_1, vec2(position.x, data.z)).rg;',
      'vec2 p_2 = texture2D(hkTexture_2, vec2(position.x, data.z)).rg;',
      'vec2 p_3 = texture2D(hkTexture_3, vec2(position.x, data.z)).rg;',
      'vec2 weightedP = (position.x * p_0 + (1.0 - position.x) * p_1 + position.y * p_2 + (1.0 - position.y) * p_3) * 0.5;',

      'vec2 q_0 = texture2D(hkTexture_0, vec2(position.x, data.z)).rg;',
      'vec2 q_1 = texture2D(hkTexture_1, vec2(position.x, data.z)).rg;',
      'vec2 q_2 = texture2D(hkTexture_2, vec2(position.x, data.z)).rg;',
      'vec2 q_3 = texture2D(hkTexture_3, vec2(position.x, data.z)).rg;',
      'vec2 weightedQ = (position.x * q_0 + (1.0 - position.x) * q_1 + position.y * q_2 + (1.0 - position.y) * q_3) * 0.5;',

      '//TODO: Fade out our frequency space so that the amplitudes of all frequencies',
      '//approach zero unless they are aligned with the weighted vector of maximum',
      '//slope and approach zero at a rate decided by the heights of the corners.',

      'vec2 w = vec2(data.x, data.y);',
      'vec2 H = cAdd(weightedP, cMult(w, weightedQ));',
      'return vec4(H, 0.0, 1.0);',
    '}',

    'void main(){',
      'vec2 position = gl_FragCoord.xy / resolution.xy;',
      'vec4 result;',

      '//If horizontal butterfly',
      '//(Note: We should probably pull this into another shader later.)',
      'if(direction == 0){',
    '		result = horizontalButterflies(position);',
      '}',
    '	else if(direction == 1){',
    '		result = verticalButterflies(position);',
      '}',

      'gl_FragColor = result;',
    '}',
    ].join('\n');
  }
};
