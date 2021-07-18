//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.Ocean.positionPassMaterial = {
  uniforms: {
    worldMatrix: {type: 'mat4', value: new THREE.Matrix4()},
    viewMatrix: {type: 'mat4', value: new THREE.Matrix4()},
  },

  fragmentShader: [
    'varying vec3 vWorldPosition;',

    'void main(){',
      '//Check if we are above or below the water to see what kind of fog is applied',
      'gl_FragColor = vec4(vWorldPosition, 1.0);',
    '}',
  ].join('\n'),

  vertexShader: [
    'precision highp float;',

    '//attribute vec3 baseDepth;',
    'varying vec3 vWorldPosition;',
    'uniform mat4 worldMatrix;',

    'void main() {',
      'vWorldPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;',

      'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n'),
};
