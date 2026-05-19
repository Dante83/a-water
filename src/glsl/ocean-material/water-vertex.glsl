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

  //All 6 cascades are sampled unconditionally with a per-cascade distance
  //fade. Small-wavelength cascades get very wide fade ranges so capillary
  //and chop detail survive into mid- and far-distance — mipmaps on the
  //displacement RTs (composer) tame the sub-pixel aliasing that would
  //otherwise come with pushing C4/C5 this far:
  //  C2 (L=256m) ×50  → 12800 m   C3 (L=64m)  ×100 → 6400 m
  //  C4 (L=16m)  ×250 → 4000 m    C5 (L=4m)   ×500 → 2000 m
  //`smoothstep` (not linear clamp) softens the fade-out so the cascade's
  //vanishing point doesn't read as a visible ring on the surface.
  //
  //Step ring-index gates were removed earlier — they showed as ridges at
  //clipmap ring boundaries. Per-cascade smooth fades take their place.
  vec3 displacement = vec3(0.0);
  displacement += texture2D(cascadeDisplacementTextures[0], (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0]).xyz;
  displacement += texture2D(cascadeDisplacementTextures[1], (worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1]).xyz;
  displacement += smoothstep(cascadePatchSizes[2] *  50.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[2], (worldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2]).xyz;
  displacement += smoothstep(cascadePatchSizes[3] * 100.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[3], (worldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3]).xyz;
  displacement += smoothstep(cascadePatchSizes[4] * 250.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[4], (worldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4]).xyz;
  displacement += smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[5], (worldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5]).xyz;
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

  vec4 clipPos = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
  #if($horizon_skirt)
    //Horizon-skirt ring: pin Z just inside the far plane so rim verts (tens
    //of km past camera.far) survive frustum clipping. The skirt sets
    //depthWrite:false / renderOrder 1, so this clipPos.z value never
    //occludes real geometry (which writes its own correct depth). It only
    //makes the skirt survive long enough to draw beneath the FFT ocean and
    //above the sky dome's unwritten depth.
    clipPos.z = clipPos.w * 0.99999;
  #endif
  gl_Position = clipPos;
}
