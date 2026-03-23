AWater.AOcean.Materials.FFTWaves.waveNormalComposerShaderMaterial = {
  uniforms: {
    displacementTexture: {type: 't', value: null},
    texelSize: {type: 'f', value: 1.0 / 512.0},
    patchSize: {type: 'f', value: 256.0}
  },

  fragmentShader: function(){
    let originalGLSL = [
    'uniform sampler2D displacementTexture;',
    'uniform float texelSize;',
    'uniform float patchSize;',

    'void main(){',
      'vec2 uv = gl_FragCoord.xy / resolution.xy;',

      '//Sample displacement at neighboring texels',
      'vec3 rawL = texture2D(displacementTexture, uv + vec2(-texelSize, 0.0)).xyz;',
      'vec3 rawR = texture2D(displacementTexture, uv + vec2( texelSize, 0.0)).xyz;',
      'vec3 rawD = texture2D(displacementTexture, uv + vec2(0.0, -texelSize)).xyz;',
      'vec3 rawU = texture2D(displacementTexture, uv + vec2(0.0,  texelSize)).xyz;',

      '//Compute Jacobian for foam FIRST using raw values (before sign inversion)',
      '//Use the same UV-space derivative as the original inline foamAmount() function:',
      '//  dDdx = -0.5 * (rawR.xz - rawL.xz) / 8.0',
      '//But scale by texelSize ratio to account for the GPU pass sampling at single-texel offsets',
      '//vs the original which also sampled at single-texel offsets, so the factor is the same.',
      'vec2 foamDdx = -0.0625 * (rawR.xz - rawL.xz);',
      'vec2 foamDdy = -0.0625 * (rawU.xz - rawD.xz);',
      'float jacobian = (1.0 + foamDdx.x) * (1.0 + foamDdy.y) - foamDdx.y * foamDdy.x;',
      'float turbulence = max(0.0, 1.0 - jacobian);',
      'float foam = smoothstep(0.0, 1.0, turbulence);',

      '//Now apply sign inversion for normals (matching water shader convention)',
      'vec3 dispL = rawL; dispL.x *= -1.0; dispL.z *= -1.0;',
      'vec3 dispR = rawR; dispR.x *= -1.0; dispR.z *= -1.0;',
      'vec3 dispD = rawD; dispD.x *= -1.0; dispD.z *= -1.0;',
      'vec3 dispU = rawU; dispU.x *= -1.0; dispU.z *= -1.0;',

      '//World-space step between samples',
      'float worldStep = patchSize * texelSize;',

      '//Partial derivatives of displacement with respect to world-space x and z',
      'vec3 dPdx = (dispR - dispL) / (2.0 * worldStep);',
      'vec3 dPdz = (dispU - dispD) / (2.0 * worldStep);',

      '//Surface tangent vectors (flat plane is XZ, height is Y)',
      'vec3 Tx = vec3(1.0 + dPdx.x, dPdx.y, dPdx.z);',
      'vec3 Tz = vec3(dPdz.x, dPdz.y, 1.0 + dPdz.z);',

      'vec3 normal = normalize(cross(Tz, Tx));',

      '//Ensure normal points upward (Y > 0)',
      'if(normal.y < 0.0) normal = -normal;',

      '//Pack normal into [0,1] range, foam in alpha',
      'gl_FragColor = vec4(normal * 0.5 + 0.5, foam);',
    '}',
    ];

    return originalGLSL.join('\n');
  }
};
