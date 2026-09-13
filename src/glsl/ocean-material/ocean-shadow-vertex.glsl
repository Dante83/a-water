precision highp float;

//Ocean shadow-caster vertex — replicates the displacement logic from
//water-vertex.glsl so the shadow depth texture captures actual wave
//geometry (not a flat sea). Runs inside a sun-aligned orthographic
//camera managed by ocean-shadow-csm.js.
//
//CRITICAL: this MUST match water-vertex.glsl exactly (same ring-gating,
//same distance fade, same uniforms) — otherwise the caster surface ends
//up at a different height than the receiver surface for the same world
//XZ, which makes refZ < d fail everywhere and the entire cascade reads
//as fully shadowed.
//
//distanceToVertex is keyed off the MAIN camera position, not the light
//camera (the built-in cameraPosition refers to whichever camera the
//renderer is currently using, which here is the light). Pushed in via
//mainCameraPosition each frame.

uniform float sizeOfOceanPatch;
uniform int ringIndex;
uniform sampler2D cascadeDisplacementTextures[6];
uniform float cascadePatchSizes[6];
uniform vec2 cascadeSpatialOffsets[6];
uniform float waveHeightMultiplier;
uniform float chop;
uniform vec3 mainCameraPosition;

//Phase 2: the receiver lifts each vertex to the WaterField level and weighs
//every cascade by WaveMask, so the caster must too — a masked (flatter)
//receiver under an unmasked caster sits BELOW the caster and reads as fully
//shadowed, which is exactly the failure the note above warns about. The field
//sampling mirrors water-vertex.glsl's waterFieldAt; the mask body is spliced
//in by ocean-shadow-csm.js from ARestlessOcean.WaveMask.GLSL.
uniform float baseHeightOffset;
uniform sampler2D waterFieldCascade0;
uniform sampler2D waterFieldCascade1;
uniform sampler2D waterFieldCascade2;
uniform vec2 waterFieldCascadeCenter[3];
uniform float waterFieldCascadeHalfWidth[3];

vec4 sampleWaterFieldCascade0(vec2 worldXZ){
  vec2 uv = (worldXZ - waterFieldCascadeCenter[0]) / (2.0 * waterFieldCascadeHalfWidth[0]) + 0.5;
  return texture2D(waterFieldCascade0, uv);
}
vec4 sampleWaterFieldCascade1(vec2 worldXZ){
  vec2 uv = (worldXZ - waterFieldCascadeCenter[1]) / (2.0 * waterFieldCascadeHalfWidth[1]) + 0.5;
  return texture2D(waterFieldCascade1, uv);
}
vec4 sampleWaterFieldCascade2(vec2 worldXZ){
  vec2 uv = (worldXZ - waterFieldCascadeCenter[2]) / (2.0 * waterFieldCascadeHalfWidth[2]) + 0.5;
  return texture2D(waterFieldCascade2, uv);
}
vec4 waterFieldAt(vec2 worldXZ){
  vec2 d0 = abs(worldXZ - waterFieldCascadeCenter[0]);
  float hw0 = waterFieldCascadeHalfWidth[0];
  float m0 = max(d0.x, d0.y);
  if(m0 < hw0){
    vec4 field = sampleWaterFieldCascade0(worldXZ);
    float edgeT = smoothstep(hw0 * 0.9, hw0, m0);
    if(edgeT > 0.0) field = mix(field, sampleWaterFieldCascade1(worldXZ), edgeT);
    return field;
  }
  vec2 d1 = abs(worldXZ - waterFieldCascadeCenter[1]);
  float hw1 = waterFieldCascadeHalfWidth[1];
  float m1 = max(d1.x, d1.y);
  if(m1 < hw1){
    vec4 field = sampleWaterFieldCascade1(worldXZ);
    float edgeT = smoothstep(hw1 * 0.9, hw1, m1);
    if(edgeT > 0.0) field = mix(field, sampleWaterFieldCascade2(worldXZ), edgeT);
    return field;
  }
  return sampleWaterFieldCascade2(worldXZ);
}

$wave_mask_functions

void main() {
  vec3 offsetPosition = position;
  vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));
  float distanceToVertex = distance(mainCameraPosition.xyz, worldPositionOfVertex.xyz);
  vec2 worldXZ = worldPositionOfVertex.xz;

  //Mirrors water-vertex.glsl exactly: smoothstep distance fade per cascade.
  //Ranges: C2 ×50, C3 ×100, C4 ×250, C5 ×500. Keep this in lockstep with
  //water-vertex.glsl — caster Y must match receiver Y at the same world XZ
  //or the entire EVSM shadow cascade flips to fully-shadowed.
  vec4 field = waterFieldAt(worldXZ);
  vec3 waveMaskA;
  vec3 waveMaskB;
  waveMaskCascades(field, waveMaskA, waveMaskB);

  vec3 displacement = vec3(0.0);
  displacement += waveMaskA.x * texture2D(cascadeDisplacementTextures[0], (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0]).xyz;
  displacement += waveMaskA.y * texture2D(cascadeDisplacementTextures[1], (worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1]).xyz;
  displacement += waveMaskA.z * smoothstep(cascadePatchSizes[2] *  50.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[2], (worldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2]).xyz;
  displacement += waveMaskB.x * smoothstep(cascadePatchSizes[3] * 100.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[3], (worldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3]).xyz;
  displacement += waveMaskB.y * smoothstep(cascadePatchSizes[4] * 250.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[4], (worldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4]).xyz;
  displacement += waveMaskB.z * smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[5], (worldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5]).xyz;
  displacement *= waveHeightMultiplier;
  displacement.x *= -chop;
  displacement.z *= -chop;

  offsetPosition += displacement;
  offsetPosition.y += (field.r - baseHeightOffset);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
}
