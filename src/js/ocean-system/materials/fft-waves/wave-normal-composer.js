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

      '//Sobel 3x3: sample displacement at all 8 neighbors + center',
      'vec3 rawTL = texture2D(displacementTexture, uv + vec2(-texelSize, -texelSize)).xyz;',
      'vec3 rawT  = texture2D(displacementTexture, uv + vec2(       0.0, -texelSize)).xyz;',
      'vec3 rawTR = texture2D(displacementTexture, uv + vec2( texelSize, -texelSize)).xyz;',
      'vec3 rawL  = texture2D(displacementTexture, uv + vec2(-texelSize,        0.0)).xyz;',
      'vec3 rawR  = texture2D(displacementTexture, uv + vec2( texelSize,        0.0)).xyz;',
      'vec3 rawBL = texture2D(displacementTexture, uv + vec2(-texelSize,  texelSize)).xyz;',
      'vec3 rawB  = texture2D(displacementTexture, uv + vec2(       0.0,  texelSize)).xyz;',
      'vec3 rawBR = texture2D(displacementTexture, uv + vec2( texelSize,  texelSize)).xyz;',

      '//Compute Jacobian for foam FIRST using raw values (before sign inversion)',
      '//Use world-space derivatives for proper Jacobian of horizontal displacement',
      'float worldStepFoam = patchSize * texelSize;',
      'vec2 foamDdx = -(rawR.xz - rawL.xz) / (2.0 * worldStepFoam);',
      'vec2 foamDdy = -(rawB.xz - rawT.xz) / (2.0 * worldStepFoam);',
      'float jacobian = (1.0 + foamDdx.x) * (1.0 + foamDdy.y) - foamDdx.y * foamDdy.x;',
      '//Foam where surface compresses significantly (J well below 1)',
      'float turbulence = max(0.0, 1.0 - jacobian);',
      'float foam = smoothstep(0.1, 1.0, turbulence);',

      '//Apply sign inversion for normals (matching water shader convention)',
      'vec3 dispTL = rawTL; dispTL.x *= -1.0; dispTL.z *= -1.0;',
      'vec3 dispT  = rawT;  dispT.x  *= -1.0; dispT.z  *= -1.0;',
      'vec3 dispTR = rawTR; dispTR.x *= -1.0; dispTR.z *= -1.0;',
      'vec3 dispL  = rawL;  dispL.x  *= -1.0; dispL.z  *= -1.0;',
      'vec3 dispR  = rawR;  dispR.x  *= -1.0; dispR.z  *= -1.0;',
      'vec3 dispBL = rawBL; dispBL.x *= -1.0; dispBL.z *= -1.0;',
      'vec3 dispB  = rawB;  dispB.x  *= -1.0; dispB.z  *= -1.0;',
      'vec3 dispBR = rawBR; dispBR.x *= -1.0; dispBR.z *= -1.0;',

      '//World-space step between samples',
      'float worldStep = patchSize * texelSize;',

      '//Sobel 3x3 partial derivatives (weighted central differences)',
      'vec3 dPdx = ((dispTR + 2.0 * dispR + dispBR) - (dispTL + 2.0 * dispL + dispBL)) / (8.0 * worldStep);',
      'vec3 dPdz = ((dispBL + 2.0 * dispB + dispBR) - (dispTL + 2.0 * dispT + dispTR)) / (8.0 * worldStep);',

      '//Surface tangent vectors (flat plane is XZ, height is Y)',
      'vec3 Tx = vec3(1.0 + dPdx.x, dPdx.y, dPdx.z);',
      'vec3 Tz = vec3(dPdz.x, dPdz.y, 1.0 + dPdz.z);',

      'vec3 normal = normalize(cross(Tz, Tx));',

      '//Ensure normal points upward (Y > 0)',
      'if(normal.y < 0.0) normal = -normal;',

      '//Where the surface folds (Jacobian near zero or negative), the normal is unreliable',
      '//Blend toward flat (0,1,0) to eliminate artifacts at sharp ridges',
      'float foldBlend = smoothstep(0.0, 0.3, jacobian);',
      'normal = mix(vec3(0.0, 1.0, 0.0), normal, foldBlend);',

      '//Pack normal into [0,1] range, foam in alpha',
      'gl_FragColor = vec4(normal * 0.5 + 0.5, foam);',
    '}',
    ];

    return originalGLSL.join('\n');
  }
};
