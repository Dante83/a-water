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
//Phase 10: the six per-cascade displacement maps are ONE sampler2DArray, a layer
//per cascade, so they cost one texture unit here instead of six. They were always
//the same resolution and format — Crest-style banding varies the world patch SIZE,
//not the texel count. highp is what three already gives a ShaderMaterial, stated
//here because this data is metres of displacement and mediump would quantise it.
precision highp sampler2DArray;
uniform sampler2DArray cascadeDisplacementArray;
uniform float cascadePatchSizes[6];
uniform vec2 cascadeSpatialOffsets[6];
uniform float waveHeightMultiplier;
uniform float chop;
uniform vec3 mainCameraPosition;
//The mip each cascade is read at: water-vertex.glsl's oceanCascadeLod, copied
//exactly and keyed off the MAIN camera like the fades. A caster read at mip 0
//under a receiver read at its spacing's mip would sit at a different height.
uniform float patchDataSize;
uniform vec2 oceanMeshSpacing;
float oceanMeshCellAt(vec2 xz, vec2 camXZ){
  if(oceanMeshSpacing.x <= 0.0) return 0.0;
  if(oceanMeshSpacing.y <= 0.0) return oceanMeshSpacing.x;
  vec2 d = abs(xz - camXZ);
  return oceanMeshSpacing.x * max(1.0, 2.0 * max(d.x, d.y) / oceanMeshSpacing.y);
}
float oceanCascadeLod(float cell, float patchSize){
  return cell > 0.0 ? max(0.0, log2(cell * patchDataSize / patchSize)) : 0.0;
}
//Plane-relative depth: see water-vertex.glsl oceanShadowRelief. 0 = the hardware depth.
uniform float oceanShadowRelief;
varying float vRelZ;

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
//Phase 4: the still/flowing hand-off, so the caster flattens where the receiver does.
$flow_handoff_functions
//Phase 3a: the breakers too, from the same splice as the receiver, so a breaker
//crest is not self-shadowed by a caster that never rose.
$shore_breaker_functions
//Phase 3b: the shore reflection, same reason.
$shore_reflection_functions

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
  //Phase 4 — keep in lockstep with water-vertex.glsl.
  float stillKeep = 1.0 - flowHandoffWeightAt(worldXZ);
  waveMaskA *= stillKeep;
  waveMaskB *= stillKeep;

  float meshCell = oceanMeshCellAt(worldXZ, mainCameraPosition.xz);
  vec3 displacement = vec3(0.0);
  displacement += waveMaskA.x * textureLod(cascadeDisplacementArray, vec3((worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0], 0.0), oceanCascadeLod(meshCell, cascadePatchSizes[0])).xyz;
  displacement += waveMaskA.y * textureLod(cascadeDisplacementArray, vec3((worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1], 1.0), oceanCascadeLod(meshCell, cascadePatchSizes[1])).xyz;
  displacement += waveMaskA.z * smoothstep(cascadePatchSizes[2] *  50.0, 0.0, distanceToVertex) * textureLod(cascadeDisplacementArray, vec3((worldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2], 2.0), oceanCascadeLod(meshCell, cascadePatchSizes[2])).xyz;
  displacement += waveMaskB.x * smoothstep(cascadePatchSizes[3] * 100.0, 0.0, distanceToVertex) * textureLod(cascadeDisplacementArray, vec3((worldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3], 3.0), oceanCascadeLod(meshCell, cascadePatchSizes[3])).xyz;
  displacement += waveMaskB.y * smoothstep(cascadePatchSizes[4] * 250.0, 0.0, distanceToVertex) * textureLod(cascadeDisplacementArray, vec3((worldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4], 4.0), oceanCascadeLod(meshCell, cascadePatchSizes[4])).xyz;
  displacement += waveMaskB.z * smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToVertex) * textureLod(cascadeDisplacementArray, vec3((worldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5], 5.0), oceanCascadeLod(meshCell, cascadePatchSizes[5])).xyz;
  displacement *= waveHeightMultiplier;
  displacement.x *= -chop;
  displacement.z *= -chop;

  offsetPosition += displacement;
  //Phase 3a — keep in lockstep with water-vertex.glsl (fade keyed on the MAIN camera, via shoreBreakerCamera).
  offsetPosition.y += stillKeep * shoreBreakerHeightAt(worldXZ, field, shoreBreakerDistanceFade(worldPositionOfVertex.xyz));
  offsetPosition.y += stillKeep * shoreReflectionHeightAt(worldXZ);
  offsetPosition.y += (field.r - baseHeightOffset);
  vec4 casterWorld = modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
  vRelZ = 0.5 - (casterWorld.y - field.r) / max(oceanShadowRelief, 1e-3);
  gl_Position = projectionMatrix * viewMatrix * casterWorld;
}
