//Ocean shadow-caster material — rendered into the ocean CSM's depth targets
//by ocean-shadow-csm.js. Uniforms mirror the subset of water-shader.glsl
//needed to displace vertices: cascade textures, patch sizes, spatial offsets,
//wave-height multiplier, and chop.
AWater.AOcean.Materials.Ocean.oceanShadowMaterial = {
  uniforms: {
    cascadeDisplacementTextures: {value: [null, null, null, null, null, null]},
    cascadePatchSizes: {value: [1000.0, 250.0, 64.0, 16.0, 4.0, 1.0]},
    cascadeSpatialOffsets: {value: [
      new THREE.Vector2(382.0,  618.0),
      new THREE.Vector2( 59.0,  154.5),
      new THREE.Vector2( 54.7,   15.1),
      new THREE.Vector2(  7.55,  13.7),
      new THREE.Vector2(  0.36,   1.89),
      new THREE.Vector2(  0.708,  0.09)
    ]},
    waveHeightMultiplier: {type: 'f', value: 1.0},
    sizeOfOceanPatch: {type: 'f', value: 1.0},
    chop: {type: 'f', value: 1.0},
    ringIndex: {type: 'i', value: 0},
    mainCameraPosition: {type: 'v3', value: new THREE.Vector3()}
  },

  fragmentShader: [
    'precision highp float;',

    '//Ocean shadow-caster fragment — depth-only. When the render target has',
    '//a depth texture attached, the color output is ignored and only gl_FragDepth',
    '//(implicit from gl_Position.z / gl_Position.w) is written. We still emit a',
    '//black pixel because WebGL requires a color write to not DCE the pass.',

    'void main(){',
      'gl_FragColor = vec4(0.0);',
    '}',
  ].join('\n'),

  vertexShader: [
    'precision highp float;',

    '//Ocean shadow-caster vertex — replicates the displacement logic from',
    '//water-vertex.glsl so the shadow depth texture captures actual wave',
    '//geometry (not a flat sea). Runs inside a sun-aligned orthographic',
    '//camera managed by ocean-shadow-csm.js.',
    '//',
    '//CRITICAL: this MUST match water-vertex.glsl exactly (same ring-gating,',
    '//same distance fade, same uniforms) — otherwise the caster surface ends',
    '//up at a different height than the receiver surface for the same world',
    '//XZ, which makes refZ < d fail everywhere and the entire cascade reads',
    '//as fully shadowed.',
    '//',
    '//distanceToVertex is keyed off the MAIN camera position, not the light',
    '//camera (the built-in cameraPosition refers to whichever camera the',
    '//renderer is currently using, which here is the light). Pushed in via',
    '//mainCameraPosition each frame.',

    'uniform float sizeOfOceanPatch;',
    'uniform int ringIndex;',
    'uniform sampler2D cascadeDisplacementTextures[6];',
    'uniform float cascadePatchSizes[6];',
    'uniform vec2 cascadeSpatialOffsets[6];',
    'uniform float waveHeightMultiplier;',
    'uniform float chop;',
    'uniform vec3 mainCameraPosition;',

    'void main() {',
      'vec3 offsetPosition = position;',
      'vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));',
      'float distanceToVertex = distance(mainCameraPosition.xyz, worldPositionOfVertex.xyz);',
      'vec2 worldXZ = worldPositionOfVertex.xz;',

      'vec3 displacement = vec3(0.0);',
      'displacement += texture2D(cascadeDisplacementTextures[0], (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0]).xyz;',
      'displacement += texture2D(cascadeDisplacementTextures[1], (worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1]).xyz;',
      'if(ringIndex <= 3){',
        'displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[2] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[2], (worldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2]).xyz;',
      '}',
      'if(ringIndex <= 2){',
        'displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[3] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[3], (worldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3]).xyz;',
      '}',
      'if(ringIndex <= 1){',
        'displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[4] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[4], (worldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4]).xyz;',
      '}',
      'if(ringIndex == 0){',
        'displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[5] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[5], (worldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5]).xyz;',
      '}',
      'displacement *= waveHeightMultiplier;',
      'displacement.x *= -chop;',
      'displacement.z *= -chop;',

      'offsetPosition += displacement;',
      'gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);',
    '}',
  ].join('\n'),
};
