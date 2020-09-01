//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.Ocean.foamPass = {
  uniforms: {
    test: {type: 'f', value: 0.00},
  },

  fragmentShader: [
  ].join('\n'),

  vertexShader: [
    {vertex_glsl}
  ].join('\n'),
};
