precision highp float;

varying vec2 vWorldXZ;
varying vec3 vPosition;
varying vec3 vDisplacedPosition;
//World position of the displaced vertex. Replaces the two mat4 varyings
//(vInstanceMatrix, vModelMatrix) the fragment used to rebuild it from: a mat4
//varying costs 4 of the 16 varying slots GLSL ES 3.0 guarantees, the shader was
//at exactly 16, and Phase 2 needed two more. The instance matrix is a pure
//translation, so interpolating the product is identical to the old rebuild.
varying vec3 vWorldPosition;
//Phase 2: rest water level (.x) and the six per-cascade wave weights from
//WaveMask, packed as (level, w0, w1, w2) and (w3, w4, w5). Computed once per
//vertex so the fragment's normals and the geometry weigh cascades the same.
varying vec4 vFieldLevelMaskA;
varying vec3 vFieldMaskB;
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

//WaterField cascades (Phase 1b) — see water-shader.glsl's waterFieldAt
//for the full explanation. Duplicated here rather than shared: vertex and
//fragment are separate GLSL compilation units in three.js, and this file
//already duplicates cascadeDisplacementTextures/cascadePatchSizes/
//cascadeSpatialOffsets the same way, so this follows the existing pattern
//rather than inventing a new one.
//
//THIS is the piece Phase 1b was missing at first: waterFieldLevelAt existed
//and was correct, but nothing called it from here, so the actual REST
//GEOMETRY of the ocean mesh never moved — only fragment-shader shading
//terms (crest translucency, debug overlays) and camera-relative debug
//queries (submersion probe, foam-ortho placement) ever read it. The mesh's
//baked flat plane at baseHeightOffset was still what every vertex sat on,
//so a lake at a different level never visibly raised.
uniform float baseHeightOffset;
uniform sampler2D waterFieldCascade0;
uniform sampler2D waterFieldCascade1;
uniform sampler2D waterFieldCascade2;
uniform vec2 waterFieldCascadeCenter[3];
uniform float waterFieldCascadeHalfWidth[3];

//RT0 of each cascade: (level, depth, shoreSDF, dryMask) — see WaterFieldPass's
//Phase 2 header.
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
//Mirrors water-shader.glsl's waterFieldAt exactly (point-containment,
//finest -> coarse, smoothstep crossfade at cascade boundaries). Keep the two
//in sync by hand if either changes — there is no shared-chunk mechanism in
//this pipeline (see the comment above on why this is duplicated at all).
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

//WaveMask uniforms + waveMaskCascades(field, out a, out b). The body is NOT in
//this file: ocean-grid.js's buildVertexShader splices ARestlessOcean.WaveMask.GLSL
//(ocean-wave-field.js) in at this token, the same source the ocean CSM caster
//and the CPU height bake use. A bare token rather than a comment so the min
//build's GLSL comment strip cannot eat it.
$wave_mask_functions
//Phase 3a ShoreBreaker uniforms + shoreBreakerEval / shoreBreakerHeightAt,
//spliced the same way from ARestlessOcean.ShoreBreaker.GLSL (ocean-wave-field.js).
//Must come after waterFieldAt, which the geometry helper calls.
$shore_breaker_functions
//Phase 3b ShoreReflection uniforms + shoreReflectionHeightAt, spliced from
//ARestlessOcean.ShoreReflection.GLSL (shore-reflection-pass.js).
$shore_reflection_functions
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
  //Phase 2: the water field at this vertex, and from it one weight per cascade
  //(depth-limited and fetch-limited spectrum, see WaveMask). Sampled at the
  //UNDISPLACED worldXZ: a wave's amplitude must not depend on where that same
  //wave has pushed the vertex, or it feeds back on itself.
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

  //Phase 3a: depth-limited breakers, phase-locked to the shore (ShoreBreaker).
  //The coherent peak-frequency train that WaveMask took out of the long
  //cascades as the water shoaled, put back shoaled, pitched forward and capped
  //at breaking. Sampled at the UNDISPLACED worldXZ for the same reason as the
  //field above. Faded with camera distance because clipmap cells outgrow the
  //nearshore wavelength; the fragment carries it further as normals and foam.
  offsetPosition.y += shoreBreakerHeightAt(worldXZ, field, shoreBreakerDistanceFade(worldPositionOfVertex.xyz));

  //Phase 3b: the wave the shore sends back (ShoreReflection). A wave-equation
  //field around the camera; zero outside its window, faded out at the rim.
  //Undisplaced worldXZ, like everything else that is a property of the place.
  offsetPosition.y += shoreReflectionHeightAt(worldXZ);

  //Phase 1b: shift this vertex's rest height from the mesh's baked flat
  //plane (baseHeightOffset) to the real WaterField level at its position —
  //a lake sitting above/below the surrounding ocean actually raises/lowers
  //the geometry here, not just fragment shading. Sampled at the UNDISPLACED
  //worldXZ (before `displacement` above), not vDisplacedPosition — sampling
  //the wave-displaced position would make the shoreline crawl as waves move
  //(see WATER-TYPES.md's FFT-displacement gotcha).
  offsetPosition.y += (field.r - baseHeightOffset);

  //Set up our varyings
  vWorldXZ = worldPositionOfVertex.xz;
  vDisplacedPosition = offsetPosition;
  vPosition = position;
  vFieldLevelMaskA = vec4(field.r, waveMaskA);
  vFieldMaskB = waveMaskB;

  //Shadow coord — project the displaced world position into the sun's light-clip
  //space so the fragment shader can compare against the shadow depth texture.
  //One coord for the scene-wide Three.js map (environment casters), four for
  //the ocean-only CSM cascades. The fragment shader walks the four fine→coarse
  //and uses the first cascade whose UVs fall inside [0,1].
  vec4 worldDisplacedPosition = modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
  vWorldPosition = worldDisplacedPosition.xyz;
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
  float dHdX = waveMaskA.x * (hR - hL) / (2.0 * ndStep) * waveHeightMultiplier;
  float dHdZ = waveMaskA.x * (hT - hB) / (2.0 * ndStep) * waveHeightMultiplier;
  vec3 normalOffsetN = normalize(vec3(-dHdX, 1.0, -dHdZ));
  vec4 shadowSamplePos = vec4(worldDisplacedPosition.xyz + normalOffsetN * oceanShadowNormalBias, 1.0);

  vOceanShadowCoord0 = oceanShadowMatrix0 * shadowSamplePos;
  vOceanShadowCoord1 = oceanShadowMatrix1 * shadowSamplePos;
  vOceanShadowCoord2 = oceanShadowMatrix2 * shadowSamplePos;
  vOceanShadowCoord3 = oceanShadowMatrix3 * shadowSamplePos;

  //Add support for three.js fog
  #if(!$atmospheric_perspective_enabled)
    //⚠ THE FOG CHUNK HERE IS OURS, NOT THREE'S. UnderwaterFogChunk replaces
    //THREE.ShaderChunk.fog_vertex wholesale, and its body reads the two names
    //three's original had in scope: `mvPosition` for view depth and
    //`transformed` for the world position. This shader computes neither under
    //those names, so without these the material fails to compile the instant
    //anything sets scene.fog — which is precisely what going underwater does.
    //Only reachable with atmospheric perspective OFF, because the other path
    //excludes the fog chunks entirely, which is why it went unseen until a
    //scene ran the standalone (no a-starry-sky) configuration underwater.
    //`transformed` is pre-model so that the chunk's own
    //`modelMatrix * vec4(transformed, 1.0)` lands on the same world position
    //worldDisplacedPosition already computed above.
    #ifdef USE_FOG
      vec3 transformed = (instanceMatrix * vec4(offsetPosition, 1.0)).xyz;
      vec4 mvPosition = viewMatrix * modelMatrix * vec4(transformed, 1.0);
    #endif
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
