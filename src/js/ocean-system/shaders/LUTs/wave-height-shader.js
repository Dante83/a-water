//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
var waveHeightShaderMaterialData = {
  uniforms: {
    butterflyTexture: {type: 't', value: null},
    N: {type: 'f', value: 0.0},
  },

  fragmentShader: [
    '#ifdef GL_ES',
    'precision mediump float;',
    'precision mediump int;',
    '#endif',

    'uniform sampler2D butterflyTexture;',
    'uniform float N;',

    'float fModulo1(float a){',
      'return (a - floor(a));',
    '}',

    'void main(){',
      'float sizeExpansion = (resolution.x + 1.0) / resolution.x; //Expand by exactly one pixel',
      'vec2 uv = sizeExpansion * (gl_FragCoord.xy / resolution.xy);',
      'vec2 wrappedUV = vec2(fModulo1(uv.x), fModulo1(uv.y));',
      'float outputputColor = texture2D(butterflyTexture, wrappedUV).x / (N * N);',
      'gl_FragColor = vec4(vec3(outputputColor), 1.0);',
    '}',
  ].join('\n')
};
