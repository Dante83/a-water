//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var pingpongMaterial = new THREE.ShaderMaterial({
  uniforms: {
    twiddleIndices: {type: 't', value: null},
    pingpong_0: {type: 't', value: null},
    pingpong_1: {type: 't', value: null},
    stage: {type: 'i', value: 1},
    N: {type: 'f', value: 0.0},
    numStages: {type: 'i', value: 2},
    pingpong: {type: 'i', value: 1},
    direction: {type: 'i', value: 1},
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

    '//With a lot of help from https://youtu.be/i0BPrGuOdPo',
    'uniform sampler2D twiddleIndices;',
    'uniform sampler2D pingpong_0;',
    'uniform sampler2D pingpong_1;',

    'uniform float N;',
    'uniform int numStages;',
    'uniform int stage;',
    'uniform int pingpong;',
    'uniform int direction;',

    'const float pi = 3.141592653589793238462643383279502884197169;',

    'vec2 cMult(vec2 a, vec2 b){',
      'return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);',
    '}',

    'vec2 cAdd(vec2 a, vec2 b){',
      'return vec2(a.x + b.x, a.y + b.y);',
    '}',

    'vec4 horizontalButterflies(vec2 position){',
      'vec4 data = texture2D(twiddleIndices, vec2(stage / numStages, position.x));',

      'if(pingpong == 0){',
        'vec2 p = texture2D(pingpong_0, vec2(data.z, position.y)).rg;',
        'vec2 q = texture2D(pingpong_0, vec2(data.w, position.y)).rg;',
        'vec2 w = vec2(data.x, data.y);',

        'vec2 H = cAdd(p, cMult(w, q));',
        'return vec4(H.x, H.y, 0.0, 1.0);',
      '}',
      'else{',
        'vec2 p = texture2D(pingpong_1, vec2(data.z, position.y)).rg;',
        'vec2 q = texture2D(pingpong_1, vec2(data.w, position.y)).rg;',
        'vec2 w = vec2(data.x, data.y);',

        'vec2 H = cAdd(p, cMult(w, q));',
        'return vec4(H.x, H.y, 0.0, 1.0);',
      '}',
    '}',

    'vec4 verticalButterflies(vec2 position){',
      'vec4 data = texture2D(twiddleIndices, vec2(stage / numStages, position.y));',

      'if(pingpong == 0){',
        'vec2 p = texture2D(pingpong_0, vec2(position.x, data.z)).rg;',
        'vec2 q = texture2D(pingpong_0, vec2(position.x, data.w)).rg;',
        'vec2 w = vec2(data.x, data.y);',

        'vec2 H = cAdd(p, cMult(w, q));',
        'return vec4(H.x, H.y, 0.0, 1.0);',
      '}',
      'else{',
        'vec2 p = texture2D(pingpong_1, vec2(position.x, data.z)).rg;',
        'vec2 q = texture2D(pingpong_1, vec2(position.x, data.w)).rg;',
        'vec2 w = vec2(data.x, data.y);',

        'vec2 H = cAdd(p, cMult(w, q));',
        'return vec4(H.x, H.y, 0.0, 1.0);',
      '}',
    '}',

    'void main(){',
      'vec2 position = vWorldPosition.xy;',
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
  ].join('\n')
});
