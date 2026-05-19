//Ocean shadow-caster material — rendered into the ocean CSM's depth targets
//by ocean-shadow-csm.js. Uniforms mirror the subset of water-shader.glsl
//needed to displace vertices: cascade textures, patch sizes, spatial offsets,
//wave-height multiplier, and chop.
AWater.AOcean.Materials.Ocean.oceanShadowMaterial = {
  uniforms: {
    cascadeDisplacementTextures: {value: [null, null, null, null, null, null]},
    cascadePatchSizes: {value: [4096.0, 1024.0, 256.0, 64.0, 16.0, 4.0]},
    cascadeSpatialOffsets: {value: [
      new THREE.Vector2(1564.7, 2531.3),
      new THREE.Vector2( 241.7,  632.8),
      new THREE.Vector2( 218.6,   60.4),
      new THREE.Vector2(  30.2,   54.7),
      new THREE.Vector2(   1.44,   7.55),
      new THREE.Vector2(   2.83,   0.36)
    ]},
    waveHeightMultiplier: {type: 'f', value: 1.0},
    sizeOfOceanPatch: {type: 'f', value: 1.0},
    chop: {type: 'f', value: 1.0},
    ringIndex: {type: 'i', value: 0},
    mainCameraPosition: {type: 'v3', value: new THREE.Vector3()},
    //EVSM warp constant. Larger values reduce light bleed but compress
    //precision at depth extremes; ~5 is a good float32 balance. MUST
    //match the receiver's evsmExpC exactly or the comparison breaks.
    evsmExpC: {type: 'f', value: 5.0}
  },

  fragmentShader: [
    'precision highp float;',

    '//Ocean shadow-caster fragment — EVSM (Exponential Variance Shadow Map).',
    '//Instead of letting the depth buffer record gl_FragDepth and reading it',
    '//back, we write four warped depth moments into an RGBA32F color target.',
    '//',
    '//Why EVSM: per-triangle z-acne on smooth meshes (the ocean) is structural',
    '//to depth-comparison shadow maps. The receiver and caster are the same',
    '//mesh, so adjacent triangles produce slightly different sc.z values that',
    '//flip the depth comparison even with a calibrated bias. EVSM replaces the',
    '//binary comparison with a probabilistic upper bound (Chebyshev), which',
    '//absorbs sub-texel depth jitter as a smooth shadow gradient.',
    '//',
    '//Layout: store positive and negative exponential warps of the linear',
    '//depth z in [0,1]. The negative warp is kept negative so monotonicity',
    '//survives linear filtering and Gaussian blur in the post-blur pass.',
    '//Receiver does Chebyshev on each warp and takes the min — this is the',
    '//"two-warp" trick that removes most of plain-VSM light bleed.',
    '//  R = exp(c·z)',
    '//  G = exp(c·z)^2 = exp(2c·z)',
    '//  B = -exp(-c·z)',
    '//  A = (-exp(-c·z))^2 = exp(-2c·z)',
    '//Storing all four moments separately rather than computing them on the',
    '//fly in the receiver is what makes the variance computation correct',
    '//across the linear-filtered + Gaussian-blurred reads.',

    'uniform float evsmExpC;',

    'void main(){',
      'float z = gl_FragCoord.z;',
      'float pos = exp(evsmExpC * z);',
      'float neg = -exp(-evsmExpC * z);',
      'gl_FragColor = vec4(pos, pos * pos, neg, neg * neg);',
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

      '//Mirrors water-vertex.glsl exactly: smoothstep distance fade per cascade.',
      '//Ranges: C2 ×50, C3 ×100, C4 ×250, C5 ×500. Keep this in lockstep with',
      '//water-vertex.glsl — caster Y must match receiver Y at the same world XZ',
      '//or the entire EVSM shadow cascade flips to fully-shadowed.',
      'vec3 displacement = vec3(0.0);',
      'displacement += texture2D(cascadeDisplacementTextures[0], (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0]).xyz;',
      'displacement += texture2D(cascadeDisplacementTextures[1], (worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[2] *  50.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[2], (worldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[3] * 100.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[3], (worldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[4] * 250.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[4], (worldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[5], (worldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5]).xyz;',
      'displacement *= waveHeightMultiplier;',
      'displacement.x *= -chop;',
      'displacement.z *= -chop;',

      'offsetPosition += displacement;',
      'gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);',
    '}',
  ].join('\n'),
};
