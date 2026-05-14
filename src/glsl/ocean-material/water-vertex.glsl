precision highp float;

varying vec2 vWorldXZ;
varying vec3 vPosition;
varying vec3 vDisplacedPosition;
varying mat4 vInstanceMatrix;
varying mat4 vModelMatrix;
varying vec4 vSunShadowCoord;
//Four ocean-CSM shadow coords, fine→coarse. Split into individual varyings
//rather than an array so older GLSL ES drivers don't choke on varying arrays.
varying vec4 vOceanShadowCoord0;
varying vec4 vOceanShadowCoord1;
varying vec4 vOceanShadowCoord2;
varying vec4 vOceanShadowCoord3;

uniform float sizeOfOceanPatch;
uniform int ringIndex;
uniform sampler2D cascadeDisplacementTextures[6];
uniform float cascadePatchSizes[6];
uniform vec2 cascadeSpatialOffsets[6];
uniform float waveHeightMultiplier;
uniform float chop;
//Displacement-texture pixel resolution per side (RG=dh/dx,dh/dz storage).
//Used here only to size the finite-difference epsilon for the per-vertex
//normal estimate that drives normal-offset shadow bias.
uniform float patchDataSize;
//World-meter offset distance applied along the surface normal before
//projecting into each cascade shadow space. Decouples receiver sc.z from
//the caster surface plane so triangle-edge sampling mismatches no longer
//cross the depth-comparison threshold.
uniform float oceanShadowNormalBias;
uniform mat4 sunShadowMatrix;
//One shadow matrix per ocean CSM cascade. ocean-shadow-csm.js fits each
//cascade's light camera every frame and pushes its world→light-uv-space
//matrix into the corresponding slot.
uniform mat4 oceanShadowMatrix0;
uniform mat4 oceanShadowMatrix1;
uniform mat4 oceanShadowMatrix2;
uniform mat4 oceanShadowMatrix3;

#if(!$atmospheric_perspective_enabled)
  #include <fog_pars_vertex>
#endif


void main() {
  vec3 offsetPosition = position;

  vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));
  float distanceToVertex = distance(cameraPosition.xyz, worldPositionOfVertex.xyz);
  vec2 worldXZ = worldPositionOfVertex.xz;

  //Crest-style cascade-to-LOD binding: each ring only samples cascades it can resolve.
  //Ring k uses cascades 0 through (5 - k), clamped to [1, 5]. Fine cascades still get
  //a distance fade within their ring for smooth transitions at ring boundaries.
  //maxCascadeIdx: ring 0 → 5, ring 1 → 4, ring 2 → 3, ring 3 → 2, ring 4+ → 1
  vec3 displacement = vec3(0.0);
  displacement += texture2D(cascadeDisplacementTextures[0], (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0]).xyz;
  displacement += texture2D(cascadeDisplacementTextures[1], (worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1]).xyz;
  if(ringIndex <= 3){
    displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[2] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[2], (worldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2]).xyz;
  }
  if(ringIndex <= 2){
    displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[3] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[3], (worldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3]).xyz;
  }
  if(ringIndex <= 1){
    displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[4] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[4], (worldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4]).xyz;
  }
  if(ringIndex == 0){
    displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[5] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[5], (worldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5]).xyz;
  }
  displacement *= waveHeightMultiplier;
  displacement.x *= -chop;
  displacement.z *= -chop;

  offsetPosition += displacement;

  //Set up our varyings
  vWorldXZ = worldPositionOfVertex.xz;
  vDisplacedPosition = offsetPosition;
  vPosition = position;
  vInstanceMatrix = instanceMatrix;
  vModelMatrix = modelMatrix;

  //Shadow coord — project the displaced world position into the sun's light-clip
  //space so the fragment shader can compare against the shadow depth texture.
  //One coord for the scene-wide Three.js map (environment casters), four for
  //the ocean-only CSM cascades. The fragment shader walks the four fine→coarse
  //and uses the first cascade whose UVs fall inside [0,1].
  vec4 worldDisplacedPosition = modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
  vSunShadowCoord = sunShadowMatrix * worldDisplacedPosition;

  //Normal-offset bias: estimate surface normal from cascade-0 displacement
  //finite differences, then push the world position along that normal by
  //oceanShadowNormalBias meters before projecting into each cascade shadow
  //space. This is the structural fix for ocean self-shadow acne — receiver
  //and caster geometries are the SAME mesh, so a per-vertex sc.z that
  //matches the caster plane EXACTLY produces triangle-edge acne whenever a
  //receiver fragment samples a depth texel that the caster wrote from an
  //adjacent triangle. Offsetting receiver-side decouples the comparison.
  //Cascade 0 alone is enough — coarse waves dominate the normal, and the
  //offset only needs to point roughly outward from the surface.
  vec2 ndUV = (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0];
  float ndEps = 1.0 / patchDataSize;
  float ndStep = cascadePatchSizes[0] / patchDataSize;
  float hL = texture2D(cascadeDisplacementTextures[0], ndUV + vec2(-ndEps, 0.0)).y;
  float hR = texture2D(cascadeDisplacementTextures[0], ndUV + vec2( ndEps, 0.0)).y;
  float hB = texture2D(cascadeDisplacementTextures[0], ndUV + vec2( 0.0, -ndEps)).y;
  float hT = texture2D(cascadeDisplacementTextures[0], ndUV + vec2( 0.0,  ndEps)).y;
  float dHdX = (hR - hL) / (2.0 * ndStep) * waveHeightMultiplier;
  float dHdZ = (hT - hB) / (2.0 * ndStep) * waveHeightMultiplier;
  vec3 normalOffsetN = normalize(vec3(-dHdX, 1.0, -dHdZ));
  vec4 shadowSamplePos = vec4(worldDisplacedPosition.xyz + normalOffsetN * oceanShadowNormalBias, 1.0);

  vOceanShadowCoord0 = oceanShadowMatrix0 * shadowSamplePos;
  vOceanShadowCoord1 = oceanShadowMatrix1 * shadowSamplePos;
  vOceanShadowCoord2 = oceanShadowMatrix2 * shadowSamplePos;
  vOceanShadowCoord3 = oceanShadowMatrix3 * shadowSamplePos;

  //Add support for three.js fog
  #if(!$atmospheric_perspective_enabled)
    #include <fog_vertex>
  #endif

  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
}
