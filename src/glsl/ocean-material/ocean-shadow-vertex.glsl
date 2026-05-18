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

void main() {
  vec3 offsetPosition = position;
  vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));
  float distanceToVertex = distance(mainCameraPosition.xyz, worldPositionOfVertex.xyz);
  vec2 worldXZ = worldPositionOfVertex.xz;

  //Mirrors water-vertex.glsl exactly: smoothstep distance fade per cascade,
  //L*20 range. Keep this in lockstep with water-vertex.glsl — caster Y must
  //match receiver Y at the same world XZ or the entire EVSM shadow cascade
  //flips to fully-shadowed.
  vec3 displacement = vec3(0.0);
  displacement += texture2D(cascadeDisplacementTextures[0], (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0]).xyz;
  displacement += texture2D(cascadeDisplacementTextures[1], (worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1]).xyz;
  displacement += smoothstep(cascadePatchSizes[2] *  30.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[2], (worldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2]).xyz;
  displacement += smoothstep(cascadePatchSizes[3] *  50.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[3], (worldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3]).xyz;
  displacement += smoothstep(cascadePatchSizes[4] * 100.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[4], (worldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4]).xyz;
  displacement += smoothstep(cascadePatchSizes[5] * 200.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[5], (worldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5]).xyz;
  displacement *= waveHeightMultiplier;
  displacement.x *= -chop;
  displacement.z *= -chop;

  offsetPosition += displacement;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
}
