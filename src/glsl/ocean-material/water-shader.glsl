precision highp float;

varying vec2 vWorldXZ;
varying vec3 vPosition;
varying vec3 vDisplacedPosition;
varying mat4 vInstanceMatrix;
varying mat4 vModelMatrix;
varying vec4 vSunShadowCoord;
varying vec4 vOceanShadowCoord0;
varying vec4 vOceanShadowCoord1;
varying vec4 vOceanShadowCoord2;
varying vec4 vOceanShadowCoord3;

//uniform vec3 cameraDirection;
uniform float sizeOfOceanPatch;
uniform int ringIndex;
uniform float chop;
uniform float baseHeightOffset;
uniform sampler2D cascadeDisplacementTextures[6];
uniform float cascadePatchSizes[6];
uniform vec2 cascadeSpatialOffsets[6];
uniform float waveHeightMultiplier;
uniform sampler2D exclusionMap;
//Snapped XZ origins of the foam/exclusion ortho cameras for this frame —
//see template comment. Used in place of cameraPosition.xz when computing
//atlas UVs so the atlas pattern doesn't drift sub-texel as the player moves.
uniform vec2 foamCameraXZ;
uniform vec2 exclusionCameraXZ;
//Refraction G-buffer attachments — see water-shader-template.txt for the
//layout. The MRT is allocated and populated in ocean-grid.js's refraction pass.
uniform sampler2D refractionColorTexture;   //attachment 0: linear albedo
uniform sampler2D gBufferNormal;            //attachment 1: world-space normal
uniform sampler2D refractionDepthTexture;   //raw NDC depth (unprojection)
uniform sampler2D refractionLinearDepth;    //attachment 2: linear view-space depth
uniform vec2 screenResolution;
uniform vec2 cameraNearFar;
uniform mat4 inverseProjectionMatrix;
uniform mat4 inverseViewMatrix;
uniform mat4 ssrViewMatrix;
uniform mat4 ssrProjectionMatrix;
uniform sampler2D meteringSurveyTexture;

#if($caustics_enabled)
  uniform sampler2D causticMap;
  uniform float causticIntensityMultiplier;
#endif

#if($foam_enabled)
  //Foam maps
  uniform sampler2D foamRenderMap;
  uniform sampler2D foamDiffuseMap;
  uniform sampler2D foamOpacityMap;
  uniform sampler2D foamNormalMap;
  uniform float foamStartLevel;
#endif

//Foam-texture scroll velocity (m/s). Driven from a randomized wind vector in
//ocean-grid.js so foam drifts with the prevailing wind direction.
uniform vec2 foamScrollVelocity;

uniform vec3 brightestDirectionalLight;
uniform vec3 brightestDirectionalLightDirection;

//Sun shadow map receive. When sunShadowEnabled == 0 the sample function short-
//circuits to 1.0 (unshadowed) so the whole feature is a no-op with no caster.
uniform sampler2D sunShadowMap;
uniform vec2 sunShadowMapSize;
uniform float sunShadowRadius;
uniform float sunShadowBias;
uniform int sunShadowEnabled;
//Matrix is also declared in the vertex shader (where it builds vSunShadowCoord
//for the surface fragment); the fragment shader needs its own copy so it can
//project arbitrary world-space points (e.g. the Snell-refracted seabed-emergence
//point) into shadow space.
uniform mat4 sunShadowMatrix;

//Ocean-only cascaded shadow map — EVSM (Exponential Variance Shadow Map).
//Each cascade's texture stores 4 warped depth moments per texel (written
//by the caster, then separable-Gaussian-blurred by ocean-shadow-csm.js):
//  R = exp(c·z)
//  G = exp(2c·z)
//  B = -exp(-c·z)
//  A = exp(-2c·z)
//Receiver derives a probabilistic shadow bound via Chebyshev's inequality
//on each warp pair, taking the min — the negative-warp pair is what kills
//most of plain-VSM light bleed. Linear-filtered floats + the blur are
//what give EVSM its smoothness; without the blur per-texel variance is
//near zero and the bound degenerates to a hard depth comparison.
//
//Four cascades sampled fine→coarse: cascade 0 is the tightest (~60m),
//cascade 3 the widest (full draw distance). The fragment shader walks
//0→3 and uses the first cascade whose UVs fall inside [0,1], with a
//narrow fade band into the next coarser cascade so the boundary is not
//visible.
uniform sampler2D oceanShadowMap[4];
uniform vec2 oceanShadowMapSize[4];
uniform int oceanShadowEnabled;
//EVSM warp constant. MUST match the caster's evsmExpC exactly. Larger
//values reduce light bleed but compress depth precision; ~5 is a good
//float32 balance for ocean depth slabs up to 10 km.
uniform float evsmExpC;
//Floor on per-texel variance to prevent divide-by-zero in the Chebyshev
//bound on perfectly flat texels. Sub-pixel value; raise if grain shows.
uniform float evsmMinVariance;
//Light-bleed reduction. Remaps the Chebyshev p_max via linstep so values
//below this threshold become zero (firmly shadowed) and the rest stretch
//to [0,1]. ~0.2 is typical for outdoor scenes; raise if penumbras look
//hazy, lower if hard shadow edges feel too crisp.
uniform float evsmLightBleedReduction;
//Debug visualisation. 0 = normal render. 1 = full-screen shadow factor as
//grayscale (white = lit, black = fully shadowed). 2 = full-screen cascade
//index tint (C0=red, C1=green, C2=blue, C3=yellow, none=black). 3 =
//receiver's sc.z for the selected cascade (grayscale). 4 = caster's stored
//depth d at sc.xy for the selected cascade (grayscale). On flat water 3
//and 4 must match texel-for-texel; any visible difference means the
//caster/receiver matrices or the displacement-texture references are out
//of sync. The 4-up cascade-depth thumbnail strip along the top of the
//screen and the bottom-corner jacobian/foam panels are drawn only when
//this is non-zero.
uniform int oceanShadowDebugMode;
uniform vec3 skyAmbientColor;
uniform vec3 waterAbsorption;
uniform vec3 waterScattering;
//Sky-reflection attenuators. Real water has micro-roughness that statistically
//averages incident sky radiance over a cone; our FFT+normal-map captures that
//near camera only, so distant water acts as a perfect mirror against the HDR
//sky LUT. reflectionScale is a flat global multiplier; reflectionDistanceFalloff
//is the extra attenuation applied at distance to fake the roughness convolution.
uniform float reflectionScale;
uniform float reflectionDistanceFalloff;
//Distance-based Fresnel peak compression. At sub-pixel facet density the
//correct Fresnel is the integral of Schlick over the slope PDF, not the
//evaluation at the LOD-flattened mean normal — without this, the horizon
//reads as a bright mirror because every distant pixel collapses to a single
//"flat upward" facet that gives near-100% grazing F. Compressing the grazing
//peak with distance approximates the Kulla-Conty / Burley energy roll-off.
//Range 0..1. 0 = standard Schlick everywhere; 0.85 ≈ ocean-photo-like horizon.
uniform float fresnelDistanceRoughness;

uniform float t;
uniform float patchDataSize;

//Fog variables
#if(!$atmospheric_perspective_enabled)
  #include <fog_pars_fragment>
#endif

#if($atmospheric_perspective_enabled)
  precision highp sampler3D;
  uniform sampler2D atmosphereTransmittance;
  uniform sampler3D atmosphereMieInscattering;
  uniform sampler3D atmosphereRayleighInscattering;
  uniform vec3 atmSunPosition;
  uniform vec3 atmMoonPosition;
  uniform float atmSunHorizonFade;
  uniform float atmMoonHorizonFade;
  uniform float atmScatteringSunIntensity;
  uniform float atmScatteringMoonIntensity;
  uniform vec3 atmMoonLightColor;
  uniform float atmCameraHeight;
  uniform float atmDistanceScale;

  //ATMOSPHERE_FUNCTIONS_INJECTION_POINT
#endif

#if(!$atmospheric_perspective_enabled)
  //When atmospheric perspective is enabled, sRGBToLinear is provided by the
  //injected atmosphere functions (inside the #if block above). Otherwise we
  //need our own — declared here, BEFORE the SSR raymarch function that calls
  //it, because GLSL requires forward declarations before use.
  vec4 sRGBToLinear( in vec4 value ) {
  	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
  }
#endif

uniform sampler2D blueNoiseTexture;
uniform float blueNoiseTime;


//R0 For Schlick's Approximation
//With n1 = 1.33 and n0 = 1.0
const float r0 = 0.02;

//── Tunable shading constants ────────────────────────────────────────────
//Pulled out of inline literals so the physical-review session can locate
//and judge each fudge in one place. Anything labelled "empirical" here is
//a candidate to derive from a physical quantity once the unified scatter
//model in improvements.txt #11 lands.

//Refraction-UV distortion magnitude, in screen-space, scaled by the
//displaced FFT normal. Higher = more refractive shimmer but more visible
//tile-edge bleed near opaque geometry.
const float REFRACTION_DISTORTION = 0.03;

//Effective-depth proxy: meters of underwater path per meter of horizontal
//camera-to-fragment distance. Lets transmittance decay toward the horizon
//even when no underwater geometry was hit by the refraction ray.
const float HORIZONTAL_DEPTH_SCALE = 0.008;

//Phong sun-glint specular boost. Crest's _DirectionalLightBoost defaults
//~5; lowered to 3 because the Fresnel gate already pushes grazing waves
//to near-full intensity.
const float SPECULAR_BOOST = 3.0;

//Macro-normal slope clamp. Caps |∇h| before forming the cascade-0 macro
//normal so a wave face steeper than ~50° tilt doesn't produce a near-
//horizontal lighting normal (which blooms specular on the wrong faces).
//foldBlend below is the structural fold-handling step; this clamp is a
//numerical guard for the linearised slope→normal map.
const float MACRO_SLOPE_MAX = 1.2;

//── Crest sun back-scatter (Q8 sunset back-glow) ─────────────────────────
//A thin-slab forward-scatter term that lights the visible face of a wave
//crest when the sun is roughly OPPOSITE the camera (looking down-sun).
//Light enters the back of the wave, scatters forward through the thin
//water column at the crest, and exits toward the eye — producing the
//green-gold halo on backlit crests at sunrise/sunset. Crest-style
//(_SubSurfaceSunFallOff / _SubSurfaceHeightMax) shape; gated by wave
//height so flat water never glows, and by Fresnel-T so grazing waves
//reflect rather than transmit.
//
//SUB_SURFACE_HEIGHT_MIN  — wave height above rest (m) at which crests start
//                          to transmit. Below this the term is zero.
//SUB_SURFACE_HEIGHT_RANGE — softening range over which the term ramps in.
//SUB_SURFACE_FALL_OFF    — exponent of the forward-scatter lobe along the
//                          view-aligned-to-sun axis. Higher = tighter halo
//                          aligned with the sun direction; ~5-8 reads as a
//                          plausible Henyey-Greenstein forward peak.
//SUB_SURFACE_STRENGTH    — overall scalar on the contribution.
const float SUB_SURFACE_HEIGHT_MIN   = 0.4;
const float SUB_SURFACE_HEIGHT_RANGE = 1.8;
const float SUB_SURFACE_FALL_OFF     = 6.0;
const float SUB_SURFACE_STRENGTH     = 1.4;

float linearizeDepth(float depthSample){
  float near = cameraNearFar.x;
  float far = cameraNearFar.y;
  return near * far / (far - depthSample * (far - near));
}

//PCF-soft sample against the sun's shadow map. Returns 1.0 for fully lit,
//0.0 for fully shadowed. Fragments outside the shadow frustum read as lit so
//the map's edge doesn't produce a hard shadow seam across open ocean.
//
//On WebGL2 Three.js uses a depth-texture attachment for directional shadow
//maps, so sampling the red channel gives the normalized depth directly. The
//earlier RGBA-unpack variant was reading garbage on this pipeline, which is
//what caused the wave-shaped acne we saw over the rock mesh.
float getSunShadow(vec4 shadowCoord){
  if(sunShadowEnabled == 0) return 1.0;
  vec3 sc = shadowCoord.xyz / shadowCoord.w;
  if(sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0){
    return 1.0;
  }
  //Receiver-plane slope bias: dFdx/dFdy of sc.z give the rate at which shadow-space
  //depth changes per screen pixel. Steeply tilted surfaces need more bias to stay
  //above the depth-map quantisation noise, otherwise they self-shadow as acne.
  //Clamp because near-grazing pixels can produce huge derivatives that would push
  //refZ off the map entirely (peter-panning).
  float slopeBias = clamp(length(vec2(dFdx(sc.z), dFdy(sc.z))), 0.0, 0.01);
  float refZ = sc.z + sunShadowBias - slopeBias;
  vec2 texelSize = (1.0 / sunShadowMapSize) * sunShadowRadius;
  float shadow = 0.0;
  for(int x = -1; x <= 1; x++){
    for(int y = -1; y <= 1; y++){
      float d = texture2D(sunShadowMap, sc.xy + vec2(float(x), float(y)) * texelSize).r;
      shadow += refZ < d ? 1.0 : 0.0;
    }
  }
  return shadow * (1.0 / 9.0);
}

//EVSM evaluation. Each cascade's texture stores 4 warped depth moments
//per texel (computed by the caster, separable-Gaussian-blurred). Receiver
//converts its own fragment depth to the same warped domain, then derives
//a probabilistic shadow upper bound via Chebyshev's inequality on each
//warp pair. The min of the two bounds is what eliminates most of plain-
//VSM light bleed (the "E" in EVSM).
//
//Why Chebyshev: variance shadow maps replace the binary depth comparison
//with a statistical comparison. The bound is sharp (=1.0 fully lit) when
//the receiver depth is closer than the moment mean, and falls off
//smoothly past it. Per-triangle z-acne — the core failure mode of the
//old depth-comparison path on smooth ocean meshes — becomes a soft
//gradient instead of binary flips between adjacent triangles.
//
//Sampler-array indices in GLSL ES must be constant integral expressions,
//so the 4-cascade selection is unrolled rather than written as a for-loop.
//The `if(found) return` pattern short-circuits the texture read once a
//covering cascade is found — typically C0 near camera, C3 at horizon.

float chebyshevUpperBound(vec2 moments, float d){
  //moments.x = E[d_warp], moments.y = E[d_warp^2]. Variance = M2 - M1^2.
  //If the receiver depth is at or before the mean, no occluder is closer
  //than this fragment so it is fully lit. Past the mean, the bound falls
  //off as variance / (variance + diff^2), giving a smooth shadow gradient
  //whose hardness depends on per-texel depth variance.
  if(d <= moments.x) return 1.0;
  float variance = max(moments.y - moments.x * moments.x, evsmMinVariance);
  float diff = d - moments.x;
  return variance / (variance + diff * diff);
}

float reduceLightBleed(float pmax){
  //Plain VSM tends to leak light through partial occluders ("light bleed"
  //around tall thin shadow casters). The EVSM negative-warp pair already
  //removes most of it; a final linstep remap kills the remainder by
  //pushing the lower part of the bound to zero.
  return clamp((pmax - evsmLightBleedReduction) / (1.0 - evsmLightBleedReduction), 0.0, 1.0);
}

float sampleOceanCascadeEVSM(sampler2D momentMap, vec3 sc){
  //Sample the 4 moments with hardware bilinear (LinearFilter on the float
  //target), warp the fragment depth into the same domain, and take the
  //min of the two Chebyshev bounds. Linear filtering of warped moments
  //is mathematically valid because the warp is monotonic — bilinear
  //interpolation of moments equals the moments of the bilinear-
  //interpolated warped depth.
  vec4 moments = texture2D(momentMap, sc.xy);
  float dPos =  exp( evsmExpC * sc.z);
  float dNeg = -exp(-evsmExpC * sc.z);
  float pPos = chebyshevUpperBound(moments.xy, dPos);
  float pNeg = chebyshevUpperBound(moments.zw, dNeg);
  return reduceLightBleed(min(pPos, pNeg));
}

bool oceanCascadeContains(vec3 sc, float marginUV){
  //Both ends of z need gating: sc.z > 1 → past far plane, sc.z < 0 →
  //between light and near plane. Without the lower bound, fragments in
  //front of the cascade get sampled with junk depth and silently read
  //as lit. marginUV insets the lateral [0,1] window so fragments whose
  //blur-kernel reach would spill past the cascade edge fall through to
  //the next coarser cascade rather than reading clamp-to-edge garbage.
  return sc.x >= marginUV && sc.x <= 1.0 - marginUV
      && sc.y >= marginUV && sc.y <= 1.0 - marginUV
      && sc.z >= 0.0 && sc.z <= 1.0;
}

//UV margin sized to exceed the EVSM Gaussian blur reach. Blur uses a
//stride-2 9-tap kernel (8 texels each side), so a 9-texel inset keeps
//cascade-edge fragments out of the blur footprint and they fall through
//to the next coarser cascade rather than sampling moments contaminated
//by the clear-color baseline outside the caster.
float oceanCascadeMarginUV(int cascadeIdx){
  return 9.0 / oceanShadowMapSize[cascadeIdx].x;
}

//Returns 1.0 if the fragment is well inside the cascade and 0.0 if it sits
//right at the cascade's kernel-clipped edge — used to lerp between this
//cascade and the next coarser one in the overlap zone. Without fade, the
//walk-fine-to-coarse switch makes a visible discontinuity at every cascade
//boundary because consecutive cascades have different texel sizes, PCF
//radii, and (sometimes) caster geometry detail. The ratio scales with the
//cascade's usable size so the absolute fade width grows with cascade extent
//(matching three-csm's quadratic-margin idea).
const float OCEAN_SHADOW_FADE_FRACTION = 0.20;

//DEBUG amplifier on the ocean shadow only (NOT the scene shadow). Set to 1.0
//for physically-correct output. >1.0 over-darkens the shadowed regions to
//make subtle wave-on-wave occlusion visually obvious — useful when checking
//whether self-shadow is firing at all. Applied as
//  out = 1 - BOOST * (1 - shadow), clamped to [0,1].
const float OCEAN_SHADOW_DEBUG_DARKNESS_BOOST = 1.0;

float oceanCascadeFadeWeight(vec3 sc, float marginUV){
  float distToEdge = min(min(sc.x - marginUV, (1.0 - marginUV) - sc.x),
                         min(sc.y - marginUV, (1.0 - marginUV) - sc.y));
  float fadeWidth = OCEAN_SHADOW_FADE_FRACTION * (0.5 - marginUV);
  return clamp(distToEdge / fadeWidth, 0.0, 1.0);
}

float getOceanShadow(vec4 shadowCoord0, vec4 shadowCoord1, vec4 shadowCoord2, vec4 shadowCoord3, vec3 worldNormal, vec3 sunDir){
  if(oceanShadowEnabled == 0) return 1.0;

  //Walk fine→coarse. At each cascade hit, sample its EVSM moments; if
  //the fragment sits in the outer fade zone (near the cascade's edge),
  //also sample the next coarser cascade and lerp. This hides what would
  //otherwise be a visible character-change at every cascade boundary
  //(texel size jumps, caster detail differs because coarser cascades
  //pull from larger ocean rings). EVSM removes the per-cascade biasScale
  //gymnastics the depth-comparison path needed — the Chebyshev bound is
  //unitless and behaves identically across cascades.

  //C0 → fades into C1
  vec3 sc0 = shadowCoord0.xyz / shadowCoord0.w;
  float margin0 = oceanCascadeMarginUV(0);
  if(oceanCascadeContains(sc0, margin0)){
    float shadow0 = sampleOceanCascadeEVSM(oceanShadowMap[0], sc0);
    float w0 = oceanCascadeFadeWeight(sc0, margin0);
    if(w0 >= 1.0) return shadow0;
    vec3 sc1 = shadowCoord1.xyz / shadowCoord1.w;
    float margin1 = oceanCascadeMarginUV(1);
    if(oceanCascadeContains(sc1, margin1)){
      float shadow1 = sampleOceanCascadeEVSM(oceanShadowMap[1], sc1);
      return mix(shadow1, shadow0, w0);
    }
    return shadow0;
  }

  //C1 → fades into C2
  vec3 sc1 = shadowCoord1.xyz / shadowCoord1.w;
  float margin1 = oceanCascadeMarginUV(1);
  if(oceanCascadeContains(sc1, margin1)){
    float shadow1 = sampleOceanCascadeEVSM(oceanShadowMap[1], sc1);
    float w1 = oceanCascadeFadeWeight(sc1, margin1);
    if(w1 >= 1.0) return shadow1;
    vec3 sc2 = shadowCoord2.xyz / shadowCoord2.w;
    float margin2 = oceanCascadeMarginUV(2);
    if(oceanCascadeContains(sc2, margin2)){
      float shadow2 = sampleOceanCascadeEVSM(oceanShadowMap[2], sc2);
      return mix(shadow2, shadow1, w1);
    }
    return shadow1;
  }

  //C2 → fades into C3
  vec3 sc2 = shadowCoord2.xyz / shadowCoord2.w;
  float margin2 = oceanCascadeMarginUV(2);
  if(oceanCascadeContains(sc2, margin2)){
    float shadow2 = sampleOceanCascadeEVSM(oceanShadowMap[2], sc2);
    float w2 = oceanCascadeFadeWeight(sc2, margin2);
    if(w2 >= 1.0) return shadow2;
    vec3 sc3 = shadowCoord3.xyz / shadowCoord3.w;
    float margin3 = oceanCascadeMarginUV(3);
    if(oceanCascadeContains(sc3, margin3)){
      float shadow3 = sampleOceanCascadeEVSM(oceanShadowMap[3], sc3);
      return mix(shadow3, shadow2, w2);
    }
    return shadow2;
  }

  //C3 — no further cascade to fade into; hard transition to "lit" at edge.
  //That edge sits at the horizon for typical configs so the discontinuity
  //is barely visible.
  vec3 sc3 = shadowCoord3.xyz / shadowCoord3.w;
  float margin3 = oceanCascadeMarginUV(3);
  if(oceanCascadeContains(sc3, margin3)){
    return sampleOceanCascadeEVSM(oceanShadowMap[3], sc3);
  }
  return 1.0;
}

#if($atmospheric_perspective_enabled)
  //Forward declaration — defined later, alongside applyAtmosphericPerspective.
  vec3 computeSkyRadiance(vec3 worldDir);
#endif

//Screen-space reflection using the refraction color+depth buffer (already rendered
//from the main camera with water hidden — zero extra render passes).
//Exponential stepping covers nearby geometry detail AND distant sky.
//Sky fallback: LUT-based atmosphere (when enabled) or metering survey fisheye.
//Returns LINEAR radiance — caller must NOT apply sRGBToLinear to the result.
//Geometry hits come from the sRGB refraction buffer and are converted here.
vec3 screenSpaceReflection(vec3 worldPos, vec3 reflectDir){
  vec3 viewPos     = (ssrViewMatrix * vec4(worldPos,    1.0)).xyz;
  vec3 viewReflect = normalize(mat3(ssrViewMatrix) * reflectDir);

  //Sky fallback: use LUT-based sky radiance when atmosphere is enabled for correct horizon
  //colors; fall back to metering survey fisheye for the no-atmosphere build path.
  #if($atmospheric_perspective_enabled)
    vec3 skyColor = computeSkyRadiance(reflectDir);
  #else
    vec2 skyUV = clamp(reflectDir.xz * 0.5 + 0.5, 0.01, 0.99);
    vec3 skyColor = texture2D(meteringSurveyTexture, skyUV).rgb;
  #endif

  //Note: a procedural sun-disk/halo addition was attempted here to fill the
  //"dark hole" in computeSkyRadiance at the sun direction at sunset (the
  //Mie forward-scattering peak gets crushed by atmSunHorizonFade^3). It
  //produced wrong colors when combined with the LUT's dim plum baseline.
  //The proper fix is to either (a) sample a-starry-sky's actual sun render
  //target in the SSR fallback, or (b) hide the sun mesh during the G-buffer
  //refraction pass and have the sky LUT include a proper sun peak.
  //Deferred to a follow-up session.

  //Reflected ray pointing behind the camera — skip march, return sky directly.
  if(viewReflect.z > 0.0){
    return skyColor;
  }

  //Exponential step: starts at 0.5m, grows 1.3x each step.
  float stepLen = 0.5;
  vec3 curPos = viewPos;
  vec3 prevPos = viewPos;

  for(int i = 0; i < 48; i++){
    prevPos = curPos;
    curPos  += viewReflect * stepLen;
    stepLen *= 1.3;

    vec4 clip = ssrProjectionMatrix * vec4(curPos, 1.0);
    if(clip.w <= 0.0) break;
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;

    //Ray exited screen — return sky.
    if(uv.x < 0.01 || uv.x > 0.99 || uv.y < 0.01 || uv.y > 0.99){
      return skyColor;
    }

    float sceneDepth = texture2D(refractionLinearDepth, uv).r;
    float rayDepth   = -curPos.z;
    float depthDelta = rayDepth - sceneDepth;
    float farThreshold = cameraNearFar.y * 0.95;
    //Loose crossing gate — every accepted hit gets binary-search refinement
    //and a silhouette check below, so thickness can be generous here.
    float maxThickness = stepLen + 1.0;

    //Note: previously gated `uv.y > 0.5`, rejecting any hit whose projected
    //screen position lands in the lower half. That truncated reflections of
    //tall geometry (like the lighthouse) to whatever bit happened to project
    //into the upper half — usually just the very top of the base. Removed:
    //the depth + silhouette checks already do the work, and "lower-half hit"
    //is not a meaningful rejection criterion in itself (the bounced ray's
    //hit position has no necessary relationship to camera screen-space halves).
    if(depthDelta > 0.0 && depthDelta < maxThickness &&
       sceneDepth > 2.0 && sceneDepth < farThreshold){

      //Binary-search refinement: the actual crossing lies between prevPos and
      //curPos. 5 iterations narrows it to ~1/32 of the last step length, so
      //real hits converge to |hitDelta| < a few cm regardless of step size.
      //Thickness-bug rays (ray passes behind thin geometry whose back face is
      //not in the depth buffer) still converge, but only to the thin object's
      //front face — which the silhouette check below then rejects.
      vec3 lo = prevPos;
      vec3 hi = curPos;
      vec2  hitUV         = uv;
      float hitSceneDepth = sceneDepth;
      float hitDelta      = depthDelta;
      for(int j = 0; j < 5; j++){
        vec3 mid = 0.5 * (lo + hi);
        vec4 midClip = ssrProjectionMatrix * vec4(mid, 1.0);
        vec2 midUV   = midClip.xy / midClip.w * 0.5 + 0.5;
        float midDepth = texture2D(refractionLinearDepth, midUV).r;
        float midDelta = -mid.z - midDepth;
        if(midDelta > 0.0){
          hi            = mid;
          hitUV         = midUV;
          hitSceneDepth = midDepth;
          hitDelta      = midDelta;
        } else {
          lo = mid;
        }
      }

      //Silhouette check: sample 4 neighbors. A thick surface — even on its
      //edge — has at most ONE neighbor reading far background (the side
      //pointing away from the object). A thin object (tree, railing, wire)
      //has TWO opposing neighbors reading background. Using the 2nd-largest
      //delta instead of the max distinguishes the two cases and stops us
      //from rejecting the outline of every solid object.
      vec2 px = vec2(0.002);
      float dN = abs(texture2D(refractionLinearDepth, hitUV + vec2( 0.0,  px.y)).r - hitSceneDepth);
      float dS = abs(texture2D(refractionLinearDepth, hitUV + vec2( 0.0, -px.y)).r - hitSceneDepth);
      float dE = abs(texture2D(refractionLinearDepth, hitUV + vec2( px.x, 0.0)).r - hitSceneDepth);
      float dW = abs(texture2D(refractionLinearDepth, hitUV + vec2(-px.x, 0.0)).r - hitSceneDepth);
      //Second-largest of four: max of (min-of-each-pair, min-of-the-two-maxes).
      float secondMax = max(max(min(dN, dS), min(dE, dW)),
                            min(max(dN, dS), max(dE, dW)));
      float silhouetteThreshold = hitSceneDepth * 0.05 + 1.0;

      //Soft rejection: smoothstep out as the silhouette measure grows, instead
      //of a hard cutoff. Hard cutoffs produce moire/striping when the refined
      //hitUV jitters sub-pixel across adjacent fragments.
      float silhouetteConfidence =
        1.0 - smoothstep(silhouetteThreshold * 0.6, silhouetteThreshold, secondMax);

      //Convergence threshold scales with step size: 5 binary halvings of a
      //step of length L leaves at most L/32 of residual on a real crossing,
      //so 0.1*stepLen + 0.5 is generous margin. A constant 0.5 rejected every
      //far hit because exponential stepping reaches ~100m-per-step by iter 20.
      float convergenceThreshold = stepLen * 0.1 + 0.5;
      if(hitDelta < convergenceThreshold && silhouetteConfidence > 0.0){
        vec2  edgeDist = abs(hitUV * 2.0 - 1.0);
        float edgeFade = 1.0 - smoothstep(0.80, 1.0, max(edgeDist.x, edgeDist.y));
        //G-buffer attachment 0 is already LINEAR (the G-buffer fragment shader
        //sRGB-decodes source albedo before writing). The refraction sampling
        //below at the equivalent line correctly samples without a second decode
        //— this one used to do sRGBToLinear() here, which gamma-darkened the
        //reflection so lighthouse bricks read as near-black silhouettes.
        vec3  hitAlbedo = texture2D(refractionColorTexture, hitUV).rgb;
        //Apply approximate lighting at the hit point so the reflection matches
        //the lit appearance of the reflected geometry, not just raw albedo.
        //Lambertian sun diffuse (using gBufferNormal as the surface normal) +
        //skyAmbientColor as hemispheric fill. We don't have shadow info for
        //the hit point, so reflected-into-shadow regions will read slightly
        //overlit — acceptable trade for a cheap approximation.
        vec3  hitNormal = normalize(texture2D(gBufferNormal, hitUV).rgb);
        float hitNdotL  = max(0.0, dot(hitNormal, -brightestDirectionalLightDirection));
        vec3  hitLight  = brightestDirectionalLight * hitNdotL + skyAmbientColor;
        vec3  hitColor  = hitAlbedo * hitLight;
        return mix(skyColor, hitColor, edgeFade * silhouetteConfidence);
      }
      //Rejected — keep marching; a thicker surface may lie further along the ray.
    }
  }

  //Max steps without hit — sky.
  return skyColor;
}

vec4 linearTosRGB(vec4 value ) {
  return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}

//Including this because someone removed this in a future versio of THREE. Why?!
vec3 MyAESFilmicToneMapping(vec3 color) {
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}

//Fresnel reflectance at air->water interface (for light entering the water from above)
//Schlick approximation with n_water = 1.33 — uses the file-level r0 constant.
float fresnelAirToWater(float cosTheta){
  return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
}

#if($caustics_enabled)
  float causticShader(vec2 uv, float t){
    //Animation speed: t/8 — gentle ocean shimmer rather than rapids. Original
    //was t/20 (glacial); t/4 read as frantic. Two scrolling UVs with non-
    //parallel velocities create the interlock look.
    float tModified = (t / 8.0);
    vec2 uv1 = uv + vec2(0.8, 0.1) * tModified;
    vec2 uv2 = uv - vec2(0.2, 0.7) * tModified;
    float aSample1 = texture(causticMap, uv1).r;
    float aSample2 = texture(causticMap, uv2).g;
    return min(aSample1, aSample2);
  }
#endif

//Converted from the Minstrel Water Engine
/*
MIT License

Copyright (c) 2018 Jingping Yu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
#if($foam_enabled)
  //Foam amount is now pre-computed in the FFT normal map alpha channel
#endif

#if($atmospheric_perspective_enabled)
  //Compute sky radiance in a given world-space direction using the same atmosphere LUTs
  //as applyAtmosphericPerspective. This matches a-starry-sky's own sky rendering, so
  //reflection colors are continuous with the visible sky at any view direction.
  //Returns LINEAR radiance (same convention as the rest of the SSR path).
  vec3 computeSkyRadiance(vec3 worldDir){
    //Convert from THREE.js world coords to a-starry-sky coords (same transform as applyAtmosphericPerspective)
    vec3 skyDir = vec3(-worldDir.z, worldDir.y, -worldDir.x);

    //Clamp to horizon so reflection rays pointing slightly below horizon (off wave faces
    //tilted toward the viewer) snap to horizon color rather than sampling invalid LUT coords.
    float viewCosZenith = max(skyDir.y, 0.0);
    float xParam = parameterizationOfCosOfViewZenithToX(viewCosZenith);
    float yHeight = parameterizationOfHeightToY(RADIUS_OF_EARTH + atmCameraHeight);

    //Sun inscatter
    float zSun = parameterizationOfCosOfSourceZenithToZ(max(atmSunPosition.y, 0.0));
    vec3 uv3Sun = vec3(xParam, yHeight, zSun);
    vec3 mieSun = texture(atmosphereMieInscattering, uv3Sun).rgb;
    vec3 raySun = texture(atmosphereRayleighInscattering, uv3Sun).rgb;
    float cosViewSun = dot(skyDir, atmSunPosition);
    vec3 skySun = pow(atmSunHorizonFade, 3.0) * atmScatteringSunIntensity
                * (miePhaseFunction(cosViewSun) * mieSun + rayleighPhaseFunction(cosViewSun) * raySun);

    //Moon inscatter
    float zMoon = parameterizationOfCosOfSourceZenithToZ(max(atmMoonPosition.y, 0.0));
    vec3 uv3Moon = vec3(xParam, yHeight, zMoon);
    vec3 mieMoon = texture(atmosphereMieInscattering, uv3Moon).rgb;
    vec3 rayMoon = texture(atmosphereRayleighInscattering, uv3Moon).rgb;
    float cosViewMoon = dot(skyDir, atmMoonPosition);
    vec3 skyMoon = pow(atmMoonHorizonFade, 3.0) * atmScatteringMoonIntensity * atmMoonLightColor
                 * (miePhaseFunction(cosViewMoon) * mieMoon + rayleighPhaseFunction(cosViewMoon) * rayMoon);

    //Base sky ambient — matches a-starry-sky's own atmosphere pass main() (not linearAtmosphericPass).
    //Small bluish floor that fades with altitude/horizon via the 2D transmittance LUT.
    vec3 transmittanceFade = texture(atmosphereTransmittance, vec2(xParam, yHeight)).rgb;
    vec3 baseSkyLighting = 0.25 * vec3(2E-3, 3.5E-3, 9E-3) * transmittanceFade;

    return skySun + skyMoon + baseSkyLighting;
  }

  //Atmospheric perspective for ground-level surfaces.
  //Uses distance-based extinction with LUT-sampled multi-scattered inscattering.
  //At the same height: S(A->B) = S(A->inf) * (1 - T(A->B))
  vec3 applyAtmosphericPerspective(vec3 color, vec3 worldPos){
    vec3 worldViewDir = normalize(worldPos - cameraPosition);
    //Convert view direction from THREE.js world space to a-starry-sky's coordinate
    //system. Sun world direction = (-sp.z, sp.y, -sp.x) from quadOffset, so the
    //inverse transform from world to sky coords is: skyDir = (-world.z, world.y, -world.x)
    vec3 viewDir = vec3(-worldViewDir.z, worldViewDir.y, -worldViewDir.x);
    float dist = length(worldPos - cameraPosition) * METERS_TO_KM * atmDistanceScale;

    //Distance-based extinction along the camera-to-surface path
    vec3 extinction = exp(-(RAYLEIGH_BETA + EARTH_MIE_BETA_EXTINCTION) * dist);

    //Attenuate surface color
    color *= extinction;

    //LUT coordinates for inscattering lookup
    float viewCosZenith = max(viewDir.y, 0.0);
    float xParam = parameterizationOfCosOfViewZenithToX(viewCosZenith);
    float yHeight = parameterizationOfHeightToY(RADIUS_OF_EARTH + atmCameraHeight);

    //Sun inscattering from 3D LUTs
    float zSun = parameterizationOfCosOfSourceZenithToZ(max(atmSunPosition.y, 0.0));
    vec3 uv3Sun = vec3(xParam, yHeight, zSun);
    vec3 mieSun = texture(atmosphereMieInscattering, uv3Sun).rgb;
    vec3 raySun = texture(atmosphereRayleighInscattering, uv3Sun).rgb;
    float cosViewSun = dot(viewDir, atmSunPosition);
    vec3 fogSun = pow(atmSunHorizonFade, 3.0) * atmScatteringSunIntensity
                * (miePhaseFunction(cosViewSun) * mieSun + rayleighPhaseFunction(cosViewSun) * raySun)
                * (1.0 - extinction);

    //Moon inscattering from 3D LUTs
    float zMoon = parameterizationOfCosOfSourceZenithToZ(max(atmMoonPosition.y, 0.0));
    vec3 uv3Moon = vec3(xParam, yHeight, zMoon);
    vec3 mieMoon = texture(atmosphereMieInscattering, uv3Moon).rgb;
    vec3 rayMoon = texture(atmosphereRayleighInscattering, uv3Moon).rgb;
    float cosViewMoon = dot(viewDir, atmMoonPosition);
    vec3 fogMoon = pow(atmMoonHorizonFade, 3.0) * atmScatteringMoonIntensity * atmMoonLightColor
                 * (miePhaseFunction(cosViewMoon) * mieMoon + rayleighPhaseFunction(cosViewMoon) * rayMoon)
                 * (1.0 - extinction);

    return color + fogSun + fogMoon;
  }
#endif

void main(){
  //Shadow factor — once per fragment. 1.0 = fully lit, 0.0 = fully shadowed.
  //sunShadowFactor is computed LATER, after macroNormal is available — the
  //ocean CSM uses a normal-based slope bias to avoid the per-triangle
  //faceting that dFdx/dFdy produces.

  //Use the displaced position from the vertex shader directly — ensures worldPosition
  //matches the actual geometry (vertex shader applies displacementFade; resampling here
  //would skip that, causing LOD tile edge divergence).
  vec3 offsetPosition = vDisplacedPosition;
  vec4 worldPosition = vModelMatrix * vInstanceMatrix * vec4(offsetPosition, 1.0);
  //Exclusion sample. Half-width here MUST match exclusionCamera's ortho
  //half-width in ocean-grid.js (currently 250 m). The exclusion target
  //covers only the small layer-30 mask volumes near the camera (boat
  //interior hulls etc.), not the broad terrain — that's foamRenderMap.
  vec2 exclusionPosition = 0.5 * (((worldPosition.xz - exclusionCameraXZ) / vec2(250.0)) + 1.0);
  exclusionPosition = vec2(exclusionPosition.x, 1.0 - exclusionPosition.y);
  if(exclusionPosition.x < 1.0 && exclusionPosition.x > 0.0 && exclusionPosition.y < 1.0 && exclusionPosition.y > 0.0){
    vec2 discardHeightData = texture2D(exclusionMap, exclusionPosition).ga;
    float discardHeight = discardHeightData.x;
    if((discardHeightData.y > 0.5) && worldPosition.y > discardHeight){
      discard;
    }
  }
  float distanceToWorldPosition = distance(worldPosition.xyz, cameraPosition.xyz);

  //Per-cascade slope sampling. The fade-by-distance built into each cascade
  //branch below (`clamp(1 - dist/(cascadePatchSizes[c]*10), 0, 1)`) is the
  //sole distance attenuation — short-wavelength cascades die at their
  //physical ranges (C5 by 10m, C4 by 40m, C3 by 160m, etc.). The previous
  //outer `normalDetailFade = mix(0.15, 1.0, ...)` keyed off sizeOfOceanPatch
  //was a relic of the old 256m default patch_size; at the current 8m it
  //flattened every wave normal past ~56m. Removed — atmospheric perspective
  //handles long-range haze; per-cascade fades handle distance attenuation.

  //Central differences on displacement for Jacobian and normals — cascades 0-1 only.
  //Computes full 3D displacement derivatives (not just XZ) so the surface normal
  //can be computed from the cross product of displaced tangent vectors (Crest-style).
  //Using finite differences for ALL components ensures height and chop derivatives
  //are consistent — mixing analytical FFT slopes with finite-difference chop derivatives
  //creates a precision mismatch that produces incorrect normals.
  vec3 rawDdx = vec3(0.0);
  vec3 rawDdz = vec3(0.0);
  //Toksvig accumulator: per-cascade slope variance that the distance fades are
  //throwing away at this fragment. Each cascade's `1 - fade` is the fraction
  //of its geometric chop we've shed; (slope·(1-fade))² estimates the
  //statistical micro-roughness that USED to live in that wavelet but no
  //longer survives as displacement. We feed the sum into a shininess
  //attenuation at the specular lobe so the Phong lobe widens to cover the
  //missing facets — distance ocean stays "shiny + rough" instead of
  //collapsing to "shiny + mirror-flat" when all the small cascades are gone.
  float lostSlopeVar = 0.0;
  //Cascade 0 height slope saved separately for macro normal (specular)
  vec2 cascade0HeightSlope;
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[0] / patchDataSize;
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0];
    vec3 rawL = texture2D(cascadeDisplacementTextures[0], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[0], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[0], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[0], uv + vec2( 0.0,  eps)).xyz;
    rawDdx += (rawR - rawL) / (2.0 * worldStep);
    rawDdz += (rawT - rawB) / (2.0 * worldStep);
    cascade0HeightSlope = vec2(rawDdx.y, rawDdz.y);
  }
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[1] / patchDataSize;
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1];
    vec3 rawL = texture2D(cascadeDisplacementTextures[1], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[1], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[1], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[1], uv + vec2( 0.0,  eps)).xyz;
    rawDdx += (rawR - rawL) / (2.0 * worldStep);
    rawDdz += (rawT - rawB) / (2.0 * worldStep);
  }
  //Cascades 2..5: per-cascade smoothstep distance fade. Wide ranges
  //(C2 ×50, C3 ×100, C4 ×250, C5 ×500) keep small-wavelength chop alive
  //out to multi-km — relies on mipmaps in the composer RTs to avoid
  //sub-pixel aliasing at the far end. `smoothstep` instead of linear
  //`clamp` softens the fade-out tail so the cascade's vanishing point
  //doesn't read as a circular ring on the surface. Keep in lockstep with
  //water-vertex.glsl.
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[2] / patchDataSize;
    float fade = smoothstep(cascadePatchSizes[2] * 50.0, 0.0, distanceToWorldPosition);
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2];
    vec3 rawL = texture2D(cascadeDisplacementTextures[2], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[2], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[2], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[2], uv + vec2( 0.0,  eps)).xyz;
    vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);
    vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);
    rawDdx += fade * cDdx;
    rawDdz += fade * cDdz;
    float oneMinusFade = 1.0 - fade;
    lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);
  }
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[3] / patchDataSize;
    float fade = smoothstep(cascadePatchSizes[3] * 100.0, 0.0, distanceToWorldPosition);
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3];
    vec3 rawL = texture2D(cascadeDisplacementTextures[3], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[3], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[3], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[3], uv + vec2( 0.0,  eps)).xyz;
    vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);
    vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);
    rawDdx += fade * cDdx;
    rawDdz += fade * cDdz;
    float oneMinusFade = 1.0 - fade;
    lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);
  }
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[4] / patchDataSize;
    float fade = smoothstep(cascadePatchSizes[4] * 250.0, 0.0, distanceToWorldPosition);
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4];
    vec3 rawL = texture2D(cascadeDisplacementTextures[4], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[4], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[4], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[4], uv + vec2( 0.0,  eps)).xyz;
    vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);
    vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);
    rawDdx += fade * cDdx;
    rawDdz += fade * cDdz;
    float oneMinusFade = 1.0 - fade;
    lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);
  }
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[5] / patchDataSize;
    float fade = smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToWorldPosition);
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5];
    vec3 rawL = texture2D(cascadeDisplacementTextures[5], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[5], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[5], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[5], uv + vec2( 0.0,  eps)).xyz;
    vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);
    vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);
    rawDdx += fade * cDdx;
    rawDdz += fade * cDdz;
    float oneMinusFade = 1.0 - fade;
    lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);
  }
  rawDdx *= waveHeightMultiplier;
  rawDdz *= waveHeightMultiplier;
  lostSlopeVar *= waveHeightMultiplier * waveHeightMultiplier;

  //Jacobian: detect surface folds — still used for inscatter modulation and normal blending
  vec2 foamDdx = -chop * rawDdx.xz;
  vec2 foamDdz = -chop * rawDdz.xz;
  float jacobian = (1.0 + foamDdx.x) * (1.0 + foamDdz.y) - foamDdx.y * foamDdz.x;
  float turbulence = max(0.0, 1.0 - jacobian);

  //Persistent foam: read from displacement texture alpha (accumulated by the composer
  //via Jacobian-based ping-pong each frame). Sum active cascades with LOD fade.
  //Whitecap foam is a big-breaker phenomenon — Crest excludes the smaller
  //cascades from foam via _CrestMinimumWavesSlice for exactly this reason.
  //Including C2/C3 here turned every fine-chop Jacobian event into sparkle
  //noise that aliased at distance (the close-up "salt grain" pattern). Only
  //C0 + C1 (256–2048 m wavelengths) carry the kind of crest steepness that
  //actually breaks into whitecaps. C0 and C1 are sampled unconditionally —
  //they don't need a fade since they're the largest scales.
  float fftFoamAmount = 0.0;
  {
    vec2 uv0 = (vWorldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0];
    fftFoamAmount += texture2D(cascadeDisplacementTextures[0], uv0).a;
  }
  {
    vec2 uv1 = (vWorldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1];
    fftFoamAmount += texture2D(cascadeDisplacementTextures[1], uv1).a;
  }
  fftFoamAmount = clamp(fftFoamAmount, 0.0, 1.0);

  //Crest-style surface normal from cross product of displaced tangent vectors.
  //Surface parameterization: P(u,v) = (u - chop*Dx, Dy, v - chop*Dz)
  //Tangent vectors include the full Jacobian of the displacement mapping:
  //  Tx = dP/du = (1 - chop*dDx/du, dDy/du, -chop*dDz/du)
  //  Tz = dP/dv = (-chop*dDx/dv, dDy/dv, 1 - chop*dDz/dv)
  //All derivatives come from the same finite-difference samples for consistency.
  vec2 totalSlope = vec2(rawDdx.y, rawDdz.y);
  vec3 Tx = vec3(1.0 + foamDdx.x, totalSlope.x, foamDdx.y);
  vec3 Tz = vec3(foamDdz.x, totalSlope.y, 1.0 + foamDdz.y);
  vec3 displacedNormal = normalize(cross(Tz, Tx));
  //Cross product Y component equals the Jacobian determinant — positive when surface is
  //well-behaved, negative at folds. Force upward to avoid lighting inversion (Crest does
  //the same: crossProd.y = max(crossProd.y, 0.0001)).
  if(displacedNormal.y < 0.0) displacedNormal = -displacedNormal;
  //Blend toward flat normal at fold points and at distance
  float foldBlend = smoothstep(0.0, 0.3, jacobian);
  displacedNormal = normalize(mix(vec3(0.0, 1.0, 0.0), displacedNormal, foldBlend));
  if(displacedNormal.y < 0.0) displacedNormal = -displacedNormal;

  //Macro-scale normal from cascade 0 only — used for GGX specular orientation.
  //Using cascade 0+1 normals for NdotH creates a "sand-ripple" pattern when the moon
  //is perpendicular to the view: each 1-4m wave face creates its own sharp specular
  //hotspot. Cascade 0 only gives a wide, smooth specular lobe (Sea of Thieves style).
  //Fresnel still uses displacedNormal (cascade 0+1) so it correctly matches the geometry.
  vec2 macroSlope = cascade0HeightSlope * waveHeightMultiplier;
  float macroSlopeLen = length(macroSlope);
  if(macroSlopeLen > MACRO_SLOPE_MAX) macroSlope *= MACRO_SLOPE_MAX / macroSlopeLen;
  vec3 macroNormal = normalize(vec3(-macroSlope.x, 1.0, -macroSlope.y));
  if(macroNormal.y < 0.0) macroNormal = -macroNormal;
  macroNormal = normalize(mix(vec3(0.0, 1.0, 0.0), macroNormal, foldBlend));
  if(macroNormal.y < 0.0) macroNormal = -macroNormal;

  //Shadow factor: scene-wide map (env casters) × ocean CSM (wave self-shadow).
  //Multiplied into every sun-driven term below (SSS, diffuse, specular, foam),
  //but NOT into sky ambient / reflection / refraction. Either being 0 forces
  //full shadow; both 1 means fully lit. macroNormal is the smooth wave normal
  //(cascade 0 only), used by the ocean shadow's normal-based slope bias.
  vec3 sunDirToSky = -brightestDirectionalLightDirection;
  float oceanShadowRaw = getOceanShadow(vOceanShadowCoord0, vOceanShadowCoord1, vOceanShadowCoord2, vOceanShadowCoord3, macroNormal, sunDirToSky);
  //Fade ocean self-shadow as the sun approaches zenith. EVSM on a tessellated
  //wave mesh produces visible triangle-silhouette artifacts at high sun angles
  //because the cascade depth slab is huge relative to the actual wave-height
  //variation, so per-triangle plane discontinuities dominate the moment
  //variance. Physically waves cast almost no shadow at noon (shadow length =
  //tan(zenith) * height → 0), so weighting the term out at exactly the angles
  //where it breaks is also the physically correct behavior. Fade kicks in
  //around 53° from zenith and is fully gone by ~32°.
  float sunZenithFactor = -brightestDirectionalLightDirection.y;
  float oceanShadowZenithFade = 1.0 - smoothstep(0.4, 0.85, sunZenithFactor);
  oceanShadowRaw = mix(1.0, oceanShadowRaw, oceanShadowZenithFade);
  float oceanShadowBoosted = clamp(1.0 - OCEAN_SHADOW_DEBUG_DARKNESS_BOOST * (1.0 - oceanShadowRaw), 0.0, 1.0);
  float sunShadowFactor = getSunShadow(vSunShadowCoord) * oceanShadowBoosted;

  //Foam textures use a fixed meter-scale tile (~2 m / ~3 m perpendicular pair) so
  //individual bubble structure in the source photo reads at human scale.
  //Scroll direction is foamScrollVelocity (random wind-derived in ocean-grid.js).
  vec2 foamTextureUV  = (worldPosition.xz + t * foamScrollVelocity) / 2.0;
  vec2 foamTextureUV2 = (vec2(-worldPosition.z, worldPosition.x) + t * foamScrollVelocity) / 3.0;

  #if($foam_enabled)
    float foamAmount = fftFoamAmount;
    vec2 foamPosition = 0.5 * (((worldPosition.xz - foamCameraXZ) / vec2(2048.0)) + 1.0);
    foamPosition = vec2(foamPosition.x, 1.0 - foamPosition.y);
    if(foamPosition.x < 1.0 && foamPosition.x > 0.0 && foamPosition.y < 1.0 && foamPosition.y > 0.0){
      vec2 foamHeightData = texture2D(foamRenderMap, foamPosition).ga;
      if((foamHeightData.y > 0.5)){
        //Shore-zone foam: gated by wave action, not a static shallow-water belt.
        //shoreProximity is 1 right at terrain (water within ~0.5m above the
        //terrain top) and falls off quadratically to 0 over the next 3.5m, so
        //the breaker line is bright and dissipates with a soft tail past it.
        //
        //  shoreProximity vs waterAboveTerrain:
        //    0.5m → 1.00   1m → 0.73   2m → 0.33   3m → 0.08   4m → 0
        //
        //Quadratic ease-out feels more like real foam than the previous
        //symmetric smoothstep, which had a slow start and abrupt end.
        //
        //The boost itself is driven by turbulence (jacobian fold = wave is
        //breaking RIGHT NOW) plus a softer term in the persistent fftFoamAmount
        //accumulator (wave already broke and is decaying). Net effect: foam
        //forms when a wave hits shore and fades as that same wave passes.
        float waterAboveTerrain = worldPosition.y - foamHeightData.x;
        float shoreFade = clamp((waterAboveTerrain - 0.5) / 3.5, 0.0, 1.0);
        float shoreProximity = (1.0 - shoreFade) * (1.0 - shoreFade);
        float shoreBoost = shoreProximity * clamp(turbulence * 2.5 + fftFoamAmount * 0.5, 0.0, 1.0);
        foamAmount = max(foamAmount, shoreBoost);
      }
    }
  #else
    float foamAmount = 0.0;
  #endif

  vec3 normalizedViewVector = normalize(worldPosition.xyz - cameraPosition);
  vec2 screenUV = gl_FragCoord.xy / screenResolution;

  //Screen-space reflection: reflect the view ray off the displaced water normal and
  //ray-march against the refraction depth buffer (already rendered this frame, free).
  //Correctly samples sky/atmosphere at the horizon — no planar camera terrain capture.
  vec3 worldIncidentDir = normalize(worldPosition.xyz - cameraPosition);
  //Use macroNormal (cascade 0 only, ~2m/texel) for SSR ray direction — avoids the
  //high-frequency per-pixel noise that displacedNormal causes in reflection lookups.
  vec3 ssrReflectDir    = reflect(worldIncidentDir, macroNormal);
  //screenSpaceReflection() always returns LINEAR values (see function comment).
  vec3 reflectedLight   = screenSpaceReflection(worldPosition.xyz, ssrReflectDir);

  //Screen-space refraction
  //Distort UVs based on FFT normal only — same reason as reflection: avoids visible normal map tiling
  vec2 distortion = displacedNormal.xz * REFRACTION_DISTORTION;
  vec2 refractedUV = clamp(screenUV + distortion, 0.001, 0.999);

  //Sample refraction color and depth
  //Raw NDC depth is kept only for the unprojection at line ~1080
  //(refractedUV + refractionDepthRaw → clipPos → viewPos → world). The
  //linear-depth comparisons below sample the pre-linearised target — no
  //per-pixel divide here either.
  float refractionDepthRaw = texture2D(refractionDepthTexture, refractedUV).r;
  float refractionDepthLinear = texture2D(refractionLinearDepth, refractedUV).r;
  //G-buffer clear leaves linear depth at 0 in pixels with no scene geometry;
  //fold those into the far-plane so the isFarPlane test below behaves
  //identically to the old separate linearize pass (NDC=1 → far).
  if(refractionDepthLinear < 0.0001) refractionDepthLinear = cameraNearFar.y;
  float surfaceDepthLinear = linearizeDepth(gl_FragCoord.z);

  //If distorted UV samples something closer than the water surface, fall back to undistorted
  if(refractionDepthLinear < surfaceDepthLinear - 0.5){
    refractedUV = screenUV;
    refractionDepthRaw = texture2D(refractionDepthTexture, refractedUV).r;
    refractionDepthLinear = texture2D(refractionLinearDepth, refractedUV).r;
    if(refractionDepthLinear < 0.0001) refractionDepthLinear = cameraNearFar.y;
  }

  //G-buffer attachment 0 stores LINEAR albedo (sRGB-encoded source textures
  //are decoded inside the G-buffer fragment shader before write), so sample
  //directly here — no second decode.
  vec3 refractedLight = texture2D(refractionColorTexture, refractedUV).rgb;

  //Reconstruct world-space position from refraction depth
  vec4 clipPos = vec4(refractedUV * 2.0 - 1.0, refractionDepthRaw * 2.0 - 1.0, 1.0);
  vec4 viewPos = inverseProjectionMatrix * clipPos;
  viewPos /= viewPos.w;
  vec3 pointXYZ = (inverseViewMatrix * viewPos).xyz;

  //Unified distance-depth model — no isDeepWater branch.
  //  verticalDepth:   real water-column thickness (surface Y - seabed Y) when
  //                   the refraction ray actually hit underwater geometry, else 0.
  //  horizontalDist:  distance across the ocean surface between camera and fragment.
  //                   Acts as a grazing-path proxy: a ray skimming the surface
  //                   accumulates "fake" water in front of it, so transmittance
  //                   decays with distance even when no seabed is in the sample.
  //At the horizon horizontalDist → large, transmittance → 0, refractedLight asymptotes
  //to the backscatter equilibrium color (scattering / extinction) — which is what
  //a semi-infinite water column actually looks like. Kills sky-dome-through-water
  //leak without a depth threshold or deep-water color swap.
  bool isFarPlane = refractionDepthLinear > cameraNearFar.y * 0.99;
  //Compare the sampled point against the actual displaced water surface
  //(worldPosition.y), NOT the flat rest plane — wave crests routinely sit
  //several metres above baseHeightOffset and the flat-plane test would
  //wrongly call a rock under such a crest "above water."
  bool hasUnderwaterGeom = !isFarPlane && pointXYZ.y < worldPosition.y && refractionDepthLinear > surfaceDepthLinear;
  //Refraction ray hit no opaque geometry → the water column physically extends to
  //infinity below the surface, so we should behave as deep water and let the
  //refraction term hand off cleanly to inscatterEquilibrium. Without this, looking
  //straight down (where horizontalDist is tiny) leaves transmittance ≈ 1 and the
  //cleared-far-plane sky pixel from the refraction texture leaks through as white.
  //500.0 matches the effectiveDepth cap below — saturates transmittance to ~0.
  //  hasUnderwaterGeom — real water column.
  //  isFarPlane        — ray missed all geom; 500m saturates transmittance ~0
  //                      so the cleared sky pixel doesn't leak through bright.
  //  above-wave hit    — ray landed above the actual displaced surface; use
  //                      3D distance as a Beer-Lambert proxy so the blend
  //                      still mixes inscatter and we don't get a dark rim.
  float verticalDepth = hasUnderwaterGeom ? max(worldPosition.y - pointXYZ.y, 0.0)
                                          : (isFarPlane ? 500.0
                                                        : distance(worldPosition.xyz, pointXYZ));
  float horizontalDist = length(worldPosition.xz - cameraPosition.xz);
  //horizontalDepthScale: how many meters of effective depth per meter of horizontal
  //distance. 0.008 → 100m of horizontal fetch ≈ 0.8m of water, 1000m ≈ 8m — enough
  //for the horizon to asymptote to inscatter without choking shallows from a high
  //camera angle (where horizontalDist is large but the actual water column is thin).
  float effectiveDepth = min(verticalDepth + horizontalDist * HORIZONTAL_DEPTH_SCALE, 500.0);
  //Physically-based underwater light transport
  //Extinction = absorption + scattering (Beer-Lambert for both)
  vec3 extinction = waterAbsorption + waterScattering;
  vec3 transmittance = exp(-extinction * effectiveDepth);

  //Sun light entering the water column
  //Fresnel transmission at the air->water interface from above
  float sunCosZenith = max(dot(-brightestDirectionalLightDirection, vec3(0.0, 1.0, 0.0)), 0.0);
  float sunTransmission = 1.0 - fresnelAirToWater(sunCosZenith);

  //Backscatter equilibrium: asymptotic color of a semi-infinite water column.
  //(scattering / extinction) is the medium's single-scatter ALBEDO — a 0..1
  //reflectance — so it becomes visible radiance only when multiplied by the
  //actual downwelling light hitting the surface. Two drivers, à la Bruneton:
  //  directDownwelling  — brightestDirectionalLight * surface Fresnel * cos zenith.
  //                       Sun by day, moon by night (dim but physical). Zero at sub-
  //                       horizon so polar night ocean goes dark as it should.
  //  ambientDownwelling — diffuse sky hemisphere irradiance from a-starry-sky's
  //                       y-axis hemispherical light. After the 2026-05-14 unit
  //                       reconciliation (water-review SUMMARY Step 2), this is
  //                       used raw — same scale as brightestDirectionalLight.
  //Extinction ordering matters for dusk: orange sky sampled through the water is
  //filtered by transmittance = exp(-extinction * d). Blue must have the SMALLEST
  //extinction so it survives long paths (real clean ocean: Pope & Fry 1997), else
  //a red-heavy sky tinted by green-biased transmittance reads olive.
  vec3 waterAlbedo = waterScattering / max(extinction, vec3(0.0001));
  //Crest-style: dim the DIRECT downwelling in shadow so the body reads
  //visibly cooler/darker, but lerp toward a floor instead of multiplying
  //to zero — fully shadowed water otherwise becomes a near-black void
  //if ambientDownwelling happens to be tiny. The 0.65 floor keeps shadowed
  //crests reading as "blue but a touch deeper" rather than "ink." Reflection,
  //refracted scene, and ambient stay untouched.
  float inscatterShadow = mix(0.65, 1.0, sunShadowFactor);
  vec3 directDownwelling = brightestDirectionalLight * sunTransmission * sunCosZenith * inscatterShadow;
  vec3 ambientDownwelling = skyAmbientColor;
  //Lambertian flux→radiance conversion. Bruneton 2010 (CGF 29(2)):
  //  Lsea = SeaColor * Esky / pi
  //Esky here is irradiance (sun+sky downwelling at the surface, integrated
  //over solid angle). Treating it as radiance directly — the pre-2026-05-16
  //form — over-drives the body by ~π, which against AES-Filmic's shoulder
  //read as a glowing surface at midday once Jerlov 1C lifted the G/B
  //channels above ~2.0 pre-tonemap. The 1/π puts inscatter back onto the
  //same scale as the SSR reflection term it's blended against.
  vec3 inscatterEquilibrium = waterAlbedo * (directDownwelling + ambientDownwelling) * (1.0 / 3.14159265);
  //Unified body color is computed in the transmittance-weighted blend below:
  //  bodyColor = refractedLight * T + inscatterEquilibrium * (1 - T)
  //which is the UE-SLW / Bruneton form `waterAlbedo * (1 - T) * Edown` plus
  //the attenuated seabed sample. The phenomenological k1..k4 scatter stack and
  //the Crest-style crest-translucency block were deleted in the 2026-05-14
  //water-review Step 4. See SUMMARY Q8 for the crest-translucency follow-up
  //(currently no thin-slab term — sunset backlit crests will read less golden
  //until that lobe is re-introduced).

  //Apply Schlick's approximation for the fresnel amount.
  //https://graphicscompendium.com/raytracing/11-fresnel-beer
  //
  //Plain Schlick on displacedNormal — same as the development branch. The
  //2db241e commit layered TWO distance fades on top here (fresnelNormalAlpha
  //collapsing the normal toward macroNormal over 50 m, plus a grazing-peak
  //compression gated by fresnelDistanceRoughness over 10..160 m). Both were
  //added intending to be a "distance roughness" stand-in for slope-PDF
  //integration, but in combination with the cascade-restructured spectrum
  //they crushed the mid-distance reflection variation that gives the
  //ocean its rough-water reading — making mid/far look uniformly smooth
  //and dim regardless of atmospheric perspective. If per-crest Fresnel
  //highlights at the horizon become a problem, fix the source (cascade
  //fade ranges, slope amplitude) rather than re-introducing this stack.
  float cosTheta = clamp(dot(displacedNormal, -normalizedViewVector), 0.0, 1.0);
  float fresnelFactor = r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);

  //Energy-conserving Schlick: body and reflection share a single fresnelFactor.
  //  body weight       = 1 - fresnelFactor  (1 looking down, 0 at horizon)
  //  reflection weight = fresnelFactor      (0 looking down, 1 at horizon)
  //Sums to 1.0 — no additive double-count. The previous `fresnelBody = min(f, 0.3)`
  //decoupling was added to fight a pea-green tint at the horizon, but it left body
  //weight ≥ 0.7 everywhere AND reflection at full Schlick, summing to 1.4 — which
  //made the bright sky reflection dominate ~70% of every pixel and pulled the whole
  //ocean toward "blue-white sheet." If horizon tint returns, fix the horizon source
  //(inscatterEquilibrium hue) instead of double-weighting.
  //
  //Reflection HDR cap deleted in SUMMARY Step 3: the AES-Filmic tonemap below
  //has a smooth shoulder that absorbs HDR>1 cleanly (4.0 → 0.97, 10.0 → 1.0),
  //so a body-wide min(reflectedLight, 4.0) was throwing away ~1.5 stops of
  //sun-disk dynamic range AND distorting hue at the clamp (orange→grey). If
  //a firefly artifact appears on a single sun-disk specular sample, fix with
  //a localized clamp on the specular lobe only, not by reinstating this cap.


  //Relight the G-buffer sample. Two branches, picked by whether the sampled
  //point is below or above the water rest plane:
  //  (a) UNDERWATER:  Snell-bent sun + Beer-Lambert downpath + caustics +
  //                   underwater ambient (skyAmbient × waterAlbedo).
  //  (b) ABOVE WATER: standard sun × NdotL × sunShadow + skyAmbient.
  //Both branches drive the lit value from albedo × lighting, so at zero
  //ambient + zero direct, the body contribution is zero (no raw albedo leak).
  //Going above-water-style instead of "saturate to deep blue" lets us see
  //distant shore and just-above-water terrain naturally, with the thin water
  //layer between camera and sample handled by the transmittance blend below.
  //
  //Cheap planar Snell for the underwater branch: approximate the water surface
  //as a flat plane at y = worldPosition.y, refract once, attenuate the sun
  //leg along the refracted path (shorter than the air direction at low sun),
  //and sample the air-side sunShadowMap at the point where the sun ray
  //emerged from the surface (so the island casts a shadow on the seabed
  //beneath it). Ignores wave-surface curvature — that high-frequency
  //variation is what caustics encode.
  //Diagnostic: capture the raw causticShader output so debug mode 14 can
  //visualise it independently of the dim multiplicative chain.
  vec3 dbgCausticSample = vec3(0.0);
  if(hasUnderwaterGeom){
    vec3 seabedNormal = normalize(texture2D(gBufferNormal, refractedUV).rgb);

    //Snell refraction at the flat water surface (n_air/n_water = 1/1.33).
    vec3 sunDirInWater = refract(brightestDirectionalLightDirection, vec3(0.0, 1.0, 0.0), 1.0 / 1.33);
    vec3 sunDirToSeabed = -sunDirInWater;
    float upY = max(sunDirToSeabed.y, 0.05);
    float NdotL_seabed = max(0.0, dot(seabedNormal, sunDirToSeabed));

    //Refracted-path length from seabed up to the surface — shorter than
    //the air-direction approximation at grazing sun.
    float downPath = max(0.0, worldPosition.y - pointXYZ.y) / upY;
    vec3 sunDown = brightestDirectionalLight * sunTransmission * exp(-extinction * downPath);

    //Air-side surface emergence point for the shadow lookup.
    vec3 pSurfaceHit = pointXYZ + sunDirToSeabed * downPath;
    float seabedShadowFactor = 1.0;
    if(sunShadowEnabled == 1){
      vec4 seabedShadowCoord = sunShadowMatrix * vec4(pSurfaceHit, 1.0);
      seabedShadowFactor = getSunShadow(seabedShadowCoord);
    }

    vec3 causticMod = vec3(1.0);
    #if($caustics_enabled)
      //Caustic modulation around 1.0 (brief 04 sec 2): the divergence of
      //refracted sun rays redistributes energy across the seabed -- total
      //energy is conserved, so the operator is a mean-1 multiplier.
      //
      //Pivot at CAUSTIC_TEXTURE_MEAN, not 0.5: the smoothstep contrast
      //curve maps the raw min(R,G) tap distribution (already low-mean
      //from the double-min in causticShader) into a left-skewed [0,1]
      //sample whose empirical mean sits near 0.25. Subtracting 0.5
      //instead would darken most of the seabed because most pixels live
      //well below 0.5; subtracting 0.25 is the correct zero-mean shift
      //for THIS texture+contrast-curve.
      //
      //Depth-contrast fade (brief 04 sec 2 item 2): caustic ray bundles
      //spread out with depth, so even when total energy is conserved the
      //contrast of the pattern flattens. exp(-downPath / CONTRAST_DEPTH)
      //gives sharp caustic webs in 0-2 m water and a soft diffuse
      //modulation past 3 e-folds (~24 m at default 8 m e-fold).
      //
      //The whole factor still rides on sunDown (already Beer-Lambert
      //attenuated by downPath) so ABSOLUTE caustic brightness also fades
      //with depth and sunset on top of the contrast fade.
      const float CAUSTIC_AMP             = 3.0;
      const float CAUSTIC_TEXTURE_MEAN    = 0.25;
      const float CAUSTIC_CONTRAST_DEPTH  = 8.0;
      const float CAUSTIC_THRESHOLD_LO    = 0.15;
      const float CAUSTIC_THRESHOLD_HI    = 0.85;
      //UV multiplier sets caustic texture tile size. The texture itself encodes
      //multiple caustic structures, so the visible caustic period is texture_tile / N.
      //0.3 → ~3.3 m tile, ~0.5-1 m visible caustic scale (real pool shimmer).
      //Previous 0.02 (50 m tile) was invisible at close range; 1.0 (1 m tile) was
      //sub-pixel and averaged to flat. 0.3 is the sweet spot for 1 unit = 1 m world.
      float causticLightingR = causticShader(0.3 * pointXYZ.xz + 0.005, t);
      float causticLightingG = causticShader(0.3 * pointXYZ.xz, t);
      float causticLightingB = causticShader(0.3 * pointXYZ.xz - 0.005, t);
      vec3 causticSampleRaw = vec3(causticLightingR, causticLightingG, causticLightingB);
      vec3 causticSample = smoothstep(vec3(CAUSTIC_THRESHOLD_LO), vec3(CAUSTIC_THRESHOLD_HI), causticSampleRaw);
      dbgCausticSample = causticSample;
      float causticDepthFade = exp(-downPath / CAUSTIC_CONTRAST_DEPTH);
      causticMod = vec3(1.0) + causticDepthFade * causticIntensityMultiplier * CAUSTIC_AMP * (causticSample - vec3(CAUSTIC_TEXTURE_MEAN));
    #endif

    vec3 ambientUW = skyAmbientColor * waterAlbedo;
    //Pragmatic seabed scale: no /pi here even though strict Lambertian
    //convention would apply one (L = albedo * E * NdotL / pi). The /pi
    //belongs on inscatterEquilibrium (see :1147) because THAT term was
    //over-driving the surface; the seabed already barely beats the bright
    //inscatter in clean ocean (rocks dim relative to equilibrium in G/B),
    //so dividing it further erased it in mode 0 and made it visible only
    //in shallow water during the 2026-05-16 mode-5 + x10 diagnostic. We
    //accept the unit inconsistency between the two body terms: /pi where
    //it dims an over-bright term, no /pi where doing so would erase a
    //term that already reads as a small lift over equilibrium.
    refractedLight *= (sunDown * NdotL_seabed * causticMod * seabedShadowFactor + ambientUW);
  }
  else if(!isFarPlane){
    //Above-water terrain visible through wave distortion / grazing-angle
    //refraction. Light it the same way the terrain shader would: direct sun
    //× NdotL × sunShadow + sky ambient. The thin water column between the
    //water surface and the sample point is handled by the transmittance
    //blend below — short column ⇒ transmittance ≈ 1 ⇒ pass-through; long
    //column (e.g. far shore behind a wide ocean stretch) ⇒ transmittance
    //→ 0 ⇒ inscatter dominates.
    vec3 sampleNormal = normalize(texture2D(gBufferNormal, refractedUV).rgb);
    vec3 sunDirAir = -brightestDirectionalLightDirection;
    float NdotL_terrain = max(0.0, dot(sampleNormal, sunDirAir));
    float terrainShadowFactor = 1.0;
    if(sunShadowEnabled == 1){
      vec4 terrainShadowCoord = sunShadowMatrix * vec4(pointXYZ, 1.0);
      terrainShadowFactor = getSunShadow(terrainShadowCoord);
    }
    refractedLight *= (brightestDirectionalLight * NdotL_terrain * terrainShadowFactor + skyAmbientColor);
  }
  //DEBUG snapshots (read by oceanShadowDebugMode 5..10 at bottom of shader).
  //dbgRawRefraction here is post-seabed-relight (since we already passed the
  //caustics block) — that's what we actually feed into the blend, so it's the
  //meaningful "what would be the body-color contribution" value.
  vec3 dbgPostRelight = refractedLight;
  vec3 dbgTransmittance = transmittance;
  bool dbgHasUW = hasUnderwaterGeom;
  bool dbgIsFarPlane = isFarPlane;
  float dbgVerticalDepth = verticalDepth;
  float dbgEffectiveDepth = effectiveDepth;
  vec3 dbgInscatterEquilibrium = inscatterEquilibrium;
  vec3 dbgReflectedLight = reflectedLight;
  float dbgFresnelFactor = fresnelFactor;
  //Crest sun back-scatter (Q8). Forward-scatter lobe peaks when the camera
  //is looking AT the sun — sun behind the wave from camera POV ⇒ light
  //transmits through the thin water at the crest and exits toward the eye.
  //
  //Sign convention: `brightestDirectionalLightDirection` points FROM sun TO
  //surface (the direction sunlight travels). `normalizedViewVector` points
  //FROM camera TO surface. The scattering-angle cosine in Henyey-Greenstein
  //is dot(incident, scattered) measured outward from the scatter point.
  //Incident is +lightDir; scattered toward the camera is -viewDir; so
  //  cosScatter = dot(lightDir, -viewDir) = -dot(lightDir, viewDir).
  //Equivalently dot(-lightDir, viewDir) — the form used here, mirroring
  //the rest of the shader where -lightDir is the toward-sun vector.
  //Reaches +1 when the camera looks straight at the sun.
  //
  //Multiplied by waterAlbedo so the contribution picks up the body hue, and
  //by brightestDirectionalLight so dawn/dusk crests glow gold (warm sun
  //color) rather than white.
  //
  //Three gates keep this term invisible everywhere except backlit crests:
  //  crestGate    — only waves above SUB_SURFACE_HEIGHT_MIN contribute, so
  //                 the flat near-field never blooms (the failure mode of
  //                 the scrapped 2026-05-15 first attempt).
  //  sunUp        — fades to 0 below the horizon (no moon back-glow).
  //  fresnelT     — grazing-view waves reflect rather than transmit.
  //Additionally the body weight (1 - fresnelFactor) is applied at the
  //final composition step, so view-aligned grazing geometry never
  //double-counts a transmitted halo on top of a strong specular reflection.
  float waveHeightAboveRest = max(0.0, worldPosition.y - baseHeightOffset);
  float crestGate = smoothstep(SUB_SURFACE_HEIGHT_MIN,
                               SUB_SURFACE_HEIGHT_MIN + SUB_SURFACE_HEIGHT_RANGE,
                               waveHeightAboveRest);
  float cosScatter = max(0.0, dot(-brightestDirectionalLightDirection, normalizedViewVector));
  float backScatterLobe = pow(cosScatter, SUB_SURFACE_FALL_OFF);
  float sunUpForSubsurface = smoothstep(0.0, 0.15, sunZenithFactor);
  float fresnelT = 1.0 - fresnelFactor;
  vec3 crestTranslucency = waterAlbedo * brightestDirectionalLight
                         * backScatterLobe * crestGate * sunUpForSubsurface
                         * fresnelT * sunShadowFactor * SUB_SURFACE_STRENGTH;

  //Blend refracted sample with backscatter equilibrium by transmittance.
  //Near-field, shallow: transmittance ≈ 1, refractedLight ≈ sampled scene.
  //Far-horizon / deep: transmittance → 0, refractedLight → inscatterEquilibrium.
  //Continuous across the whole range — no branching, no far-plane cliff.
  //Crest translucency adds to the body channel — it's transmitted light, so
  //it picks up the same (1 - fresnelFactor) weight as the rest of the body
  //at the final composition step.
  refractedLight = refractedLight * transmittance + inscatterEquilibrium * (vec3(1.0) - transmittance) + crestTranslucency;
  vec3 dbgBody = refractedLight;

  //Calculate specular lighting and surface lighting
  float lightMag = length(brightestDirectionalLight);
  vec3 normalizedLightIntensity = lightMag > 0.001 ? brightestDirectionalLight / lightMag : vec3(0.0);
  vec3 directionalSurfaceLighting = normalizedLightIntensity * max(dot(macroNormal, -brightestDirectionalLightDirection), 0.0) * sunShadowFactor;

  //Crest-style Phong sun-glint specular.
  //The FFT cascades already encode microfacet statistics as explicit geometry, so a
  //full GGX D/G/F BRDF double-counts: the normal variance IS the roughness. Use a
  //clean Phong lobe centered on the reflected-sun direction with a distance-varying
  //exponent plus a distance-varying normal. Foam surfaces collapse to a low exponent.
  //
  //Key trick: the N used to reflect() fades from displacedNormal (all cascades) near
  //to macroNormal (cascade-0 only, ~2m/texel) far. Keeping cascade-1 ripple detail
  //in the reflect direction at long distance would land some sub-pixel facet in the
  //sun cone on every single wave — producing the mid-field "every crest blooms"
  //look. Cascade-0 only at the horizon gives a clean glint trail down the sun path
  //and darker water elsewhere.
  //specDistAlpha goes 0→1 over ~40 m (was 200 m for old huge-world tuning).
  float specDistAlpha = sqrt(clamp(distanceToWorldPosition / 40.0, 0.0, 1.0));
  vec3 specNormal = normalize(mix(displacedNormal, macroNormal, specDistAlpha));
  //Toksvig shininess reduction: the per-cascade fades upstream throw away
  //slope variance with distance (lostSlopeVar). Real water at those distances
  //is still rough — the facets just can't be resolved geometrically. Widen
  //the Phong lobe with classical Toksvig: s' = s / (1 + k·σ²). Without this
  //the surface collapses to mirror-flat specular as cascades fade and
  //mid/far-distance reads as "shiny but smooth" instead of "shiny + bumpy".
  //Start conservative — easy to dial toksvigK up if the effect is too subtle.
  const float toksvigK = 3.0;
  float sunFallOff = mix(600.0, 300.0, specDistAlpha) / (1.0 + toksvigK * lostSlopeVar);
  //NOTE: no foam-exponent collapse. fftFoamAmount is a wave-compression proxy and
  //reads nonzero on every steep crest — collapsing fallOff there paints the mid-
  //field with broad white highlights that look like wet splatter. The foam diffuse/
  //opacity pass below handles actual whitewater visuals separately.
  vec3 sunReflect = reflect(brightestDirectionalLightDirection, specNormal);
  float sunLobe = pow(max(dot(sunReflect, -normalizedViewVector), 0.0), sunFallOff);
  //Fresnel gate at N·V: head-on barely reflects, grazing catches the full lobe.
  float NdotV = max(dot(specNormal, -normalizedViewVector), 0.0);
  float fresnelSpec = r0 + (1.0 - r0) * pow(1.0 - NdotV, 5.0);
  //Horizon fade: a-starry-sky's brightestDirectionalLight still carries meaningful
  //orange magnitude when the sun is below the horizon (twilight residual), which
  //multiplied by SPECULAR_BOOST blooms every wave crest with bright orange post-
  //sunset. Fade specular to zero from ~9° above horizon down. sunZenithFactor
  //= -direction.y so it's negative when the sun is below the horizon.
  float specularSunFade = smoothstep(0.0, 0.15, sunZenithFactor);
  //Specular boost: Crest's _DirectionalLightBoost defaults ~5; dropped to 3 because
  //the Fresnel gate already pushes grazing waves to full intensity.
  vec3 specular = sunLobe * fresnelSpec * SPECULAR_BOOST * lightMag * normalizedLightIntensity * sunShadowFactor * specularSunFade;

  //Total light. Sun shadow is applied only to direct-sun terms (specular
  //and the directionalSurfaceLighting / inscatterShadow contributions inside
  //the body blend). Sky reflection and refraction stay untouched.
  //The body term `refractedLight` is the unified Beer-Lambert/inscatter
  //blend assembled above (T * sceneBack + (1 - T) * inscatterEquilibrium).
  //Distance-based reflection attenuation. distanceLodFactor goes ~1 near
  //camera → 0 at ~7 cascade-0 wavelengths; we want the OPPOSITE shape (1
  //near, falls off far) for an attenuator. smoothstep keeps the transition
  //gentle so there's no visible band.
  //Falloff range is meters: 0..160 m matches the scene scale.
  float reflectionDistanceAttenuation = mix(1.0, 1.0 - reflectionDistanceFalloff,
                                            smoothstep(0.0, 1.0, distanceToWorldPosition / 160.0));
  vec3 attenuatedReflection = reflectedLight * reflectionScale * reflectionDistanceAttenuation;
  vec3 totalLight = specular + (2.0 / 255.0) * directionalSurfaceLighting + (253.0 / 255.0) * (refractedLight * (1.0 - fresnelFactor) + attenuatedReflection * fresnelFactor);
  //2026-05-14 unit reconciliation, Step 2 finalizer: removed the additive
  //"hemisphere sky fill" term that used to live here. skyAmbientColor is
  //already consumed inside inscatterEquilibrium (= waterAlbedo * (direct +
  //skyAmbientColor)), which the transmittance-weighted refractedLight blend
  //carries into the body color. The sky's reflective contribution is already
  //handled by reflectedLight * fresnelFactor. Adding skyAmbientColor a third
  //time here was double-counting and produced a milky-white whitewash on top
  //of the saturated-but-dim navy body color. The Fresnel + body model is the
  //correct physical answer.

  #if($foam_enabled)
    //Two-layer foam sampling: average a 90°-rotated, differently-scaled second sample
    //with the first to break up the repeating brick pattern (same trick as the large normal map).
    vec3  foamAlbedo = 0.5 * (texture2D(foamDiffuseMap, foamTextureUV).rgb  + texture2D(foamDiffuseMap, foamTextureUV2).rgb);
    float foamMask   = 0.5 * (texture2D(foamOpacityMap, foamTextureUV).r    + texture2D(foamOpacityMap, foamTextureUV2).r);
    //Average packed normals in [0,1] space, then decode once
    vec2  foamNMXZ   = (texture2D(foamNormalMap, foamTextureUV).xy + texture2D(foamNormalMap, foamTextureUV2).xy) - 1.0;

    //Foam normal: perturb the FFT surface normal with the foam normal map.
    vec3 foamSurfaceNormal = normalize(displacedNormal + vec3(foamNMXZ.x, 0.0, foamNMXZ.y) * 0.5);

    //Lambert diffuse from the primary directional light (sun/moon)
    float foamNdotL = max(0.0, dot(foamSurfaceNormal, -brightestDirectionalLightDirection));
    vec3 foamDiffuse = foamNdotL * lightMag * normalizedLightIntensity * foamAlbedo * sunShadowFactor;

    //Sky ambient: same hemisphere model as the water surface ambient above.
    float foamSkyFactor = 0.5 + 0.5 * dot(foamSurfaceNormal, vec3(0.0, 1.0, 0.0));
    vec3 foamAmbient = skyAmbientColor * foamSkyFactor * foamAlbedo;

    //Crest WhiteFoamTexture technique: foam amount sets a sliding black-point on the
    //opacity texture. High foamAmount → black point near 0 → all texture values pass.
    //Low foamAmount → black point near 1 → only the brightest foam patches show.
    //This is fundamentally different from foamMask*foamAmount which suppresses both.
    //_WaveFoamFeather = 0.4 in Crest's defaults.
    float foamBlackPoint = clamp(1.0 - foamAmount, 0.0, 1.0);
    float foamBlend = smoothstep(foamBlackPoint, foamBlackPoint + 0.4, foamMask);
    totalLight = mix(totalLight, foamDiffuse + foamAmbient, foamBlend);
  #endif

  #if($atmospheric_perspective_enabled)
    //Atmospheric perspective is the most expensive post-lighting step (multiple
    //3D LUT samples). Any non-zero debug mode clobbers gl_FragColor below, so
    //skip it then — keeps debug captures snappy on dense ocean scenes.
    if(oceanShadowDebugMode == 0){
      totalLight = applyAtmosphericPerspective(totalLight, worldPosition.xyz);
    }
  #endif

  gl_FragColor = linearTosRGB(vec4(MyAESFilmicToneMapping(totalLight), 1.0));

  //Ocean-shadow debug overrides. Full-screen modes — replace the lighting
  //output entirely so we can see what the shadow path is computing.
  //Mode 1: shadow factor as grayscale. White = lit, black = fully shadowed.
  //Mode 2: cascade-index tint per fragment. Red=C0, green=C1, blue=C2,
  //        yellow=C3, black = fragment outside every cascade.
  if(oceanShadowDebugMode == 1){
    //Show ONLY the ocean cascade shadow (not multiplied by scene sun shadow)
    //so debug captures isolate cascade-side acne from scene-shadow acne.
    gl_FragColor = vec4(vec3(oceanShadowBoosted), 1.0);
  }
  else if(oceanShadowDebugMode == 2){
    //Use the same per-cascade margins the lighting path uses so the tint
    //rings match the cascade actually selected for shading.
    vec3 sc0 = vOceanShadowCoord0.xyz / vOceanShadowCoord0.w;
    vec3 sc1 = vOceanShadowCoord1.xyz / vOceanShadowCoord1.w;
    vec3 sc2 = vOceanShadowCoord2.xyz / vOceanShadowCoord2.w;
    vec3 sc3 = vOceanShadowCoord3.xyz / vOceanShadowCoord3.w;
    float dbgMargin0 = oceanCascadeMarginUV(0);
    float dbgMargin1 = oceanCascadeMarginUV(1);
    float dbgMargin2 = oceanCascadeMarginUV(2);
    float dbgMargin3 = oceanCascadeMarginUV(3);
    //Default magenta = water fragment fell outside every cascade. Was black,
    //but black blends visually with deep water and made the no-cascade case
    //hard to distinguish from a near-zero tint. If a band is the no-cascade
    //case, magenta is obvious; if it stays the original color, the bright
    //region is being produced by something OTHER than the cascade walk
    //(e.g., sky dome leaking through ring-stitch gaps in the water mesh).
    vec3 tint = vec3(1.0, 0.0, 1.0);
    if(oceanCascadeContains(sc0, dbgMargin0))      tint = vec3(1.0, 0.2, 0.2);
    else if(oceanCascadeContains(sc1, dbgMargin1)) tint = vec3(0.2, 1.0, 0.2);
    else if(oceanCascadeContains(sc2, dbgMargin2)) tint = vec3(0.2, 0.2, 1.0);
    else if(oceanCascadeContains(sc3, dbgMargin3)) tint = vec3(1.0, 1.0, 0.2);
    gl_FragColor = vec4(tint, 1.0);
  }
  else if(oceanShadowDebugMode == 3 || oceanShadowDebugMode == 4){
    //Mode 3 = receiver's sc.z (linear depth in [0,1]). Mode 4 = caster's
    //stored mean depth recovered from the M1_pos moment via z = log(M1)/c.
    //On flat water the two should match texel-for-texel inside every
    //cascade; differences indicate caster/receiver displacement drift.
    vec3 sc0d = vOceanShadowCoord0.xyz / vOceanShadowCoord0.w;
    vec3 sc1d = vOceanShadowCoord1.xyz / vOceanShadowCoord1.w;
    vec3 sc2d = vOceanShadowCoord2.xyz / vOceanShadowCoord2.w;
    vec3 sc3d = vOceanShadowCoord3.xyz / vOceanShadowCoord3.w;
    float dbgMargin0 = oceanCascadeMarginUV(0);
    float dbgMargin1 = oceanCascadeMarginUV(1);
    float dbgMargin2 = oceanCascadeMarginUV(2);
    float dbgMargin3 = oceanCascadeMarginUV(3);
    float refDepth = -1.0;
    float storedDepth = -1.0;
    if(oceanCascadeContains(sc0d, dbgMargin0)){
      refDepth = sc0d.z;
      storedDepth = log(max(texture2D(oceanShadowMap[0], sc0d.xy).r, 1.0)) / evsmExpC;
    } else if(oceanCascadeContains(sc1d, dbgMargin1)){
      refDepth = sc1d.z;
      storedDepth = log(max(texture2D(oceanShadowMap[1], sc1d.xy).r, 1.0)) / evsmExpC;
    } else if(oceanCascadeContains(sc2d, dbgMargin2)){
      refDepth = sc2d.z;
      storedDepth = log(max(texture2D(oceanShadowMap[2], sc2d.xy).r, 1.0)) / evsmExpC;
    } else if(oceanCascadeContains(sc3d, dbgMargin3)){
      refDepth = sc3d.z;
      storedDepth = log(max(texture2D(oceanShadowMap[3], sc3d.xy).r, 1.0)) / evsmExpC;
    }
    if(refDepth < 0.0){
      gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
    } else {
      float v = (oceanShadowDebugMode == 3) ? refDepth : storedDepth;
      gl_FragColor = vec4(vec3(v), 1.0);
    }
  }
  //Mode 5: refractedLight after the seabed-relight pass, before the equilibrium
  //blend. This is what feeds into totalLight as the "view-through-water" value.
  else if(oceanShadowDebugMode == 5){
    gl_FragColor = linearTosRGB(vec4(dbgPostRelight, 1.0));
  }
  //Mode 6: depth-path classification, 3-tone.
  //  RED   = hasUnderwaterGeom (refraction ray hit real seabed; correct path).
  //  BLUE  = isFarPlane (refraction ray missed all geometry → 500 m fallback,
  //          renders as dark deep body color).
  //  GREEN = !hasUnderwaterGeom && !isFarPlane (refraction ray landed on
  //          above-water geometry, e.g. a rock above the waterline; goes
  //          into the above-water relight branch with verticalDepth = 0).
  else if(oceanShadowDebugMode == 6){
    vec3 tint = dbgHasUW       ? vec3(1.0, 0.2, 0.2)
              : dbgIsFarPlane  ? vec3(0.2, 0.2, 1.0)
                               : vec3(0.2, 1.0, 0.2);
    gl_FragColor = vec4(tint, 1.0);
  }
  //Mode 7: transmittance grayscale (white = clear, black = fully attenuated).
  //Use luminance of the per-channel transmittance vector.
  else if(oceanShadowDebugMode == 7){
    float trans = dot(dbgTransmittance, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(vec3(trans), 1.0);
  }
  //Mode 8: verticalDepth (real water-column thickness) normalized 0-30m → 0-1.
  else if(oceanShadowDebugMode == 8){
    gl_FragColor = vec4(vec3(clamp(dbgVerticalDepth / 30.0, 0.0, 1.0)), 1.0);
  }
  //Mode 9: retired. The k1..k4 phenomenological scatter stack was deleted in
  //the 2026-05-14 water-review Step 4; this slot now returns black so the
  //debug-key index for modes 10..12 stays stable.
  else if(oceanShadowDebugMode == 9){
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
  //Mode 10: inscatterEquilibrium in isolation — backscatter color blended into
  //refractedLight by (1 - transmittance). At transmittance ~0.7 this contributes
  //~30%; if it's a saturated blue, even that fraction can wash out seabed detail.
  else if(oceanShadowDebugMode == 10){
    gl_FragColor = linearTosRGB(vec4(dbgInscatterEquilibrium, 1.0));
  }
  //Mode 11: reflectedLight (SSR sky reflection) in isolation. This is what
  //fresnelFactor multiplies into the final pixel — at grazing angles it can
  //dominate. If this is bright blue everywhere, the "blue ocean" is mostly
  //a reflected sky, not water-body color.
  else if(oceanShadowDebugMode == 11){
    gl_FragColor = linearTosRGB(vec4(dbgReflectedLight, 1.0));
  }
  //Mode 12: fresnelFactor as grayscale. White = full reflection (horizon),
  //black = full body (looking straight down). Tells us how much weight mode 11
  //actually carries in the final blend at this fragment.
  else if(oceanShadowDebugMode == 12){
    gl_FragColor = vec4(vec3(dbgFresnelFactor), 1.0);
  }
  //Mode 13: skyAmbientColor in isolation — diagnostic added 2026-05-14 after
  //Step 2 of the unit reconciliation deleted the 0.1 bridging scalars. Compare
  //against mode 11 (reflectedLight) and mode 10 (inscatterEquilibrium) on flat
  //water to see whether skyAmbientColor's actual runtime magnitude justifies
  //treating it as same-scale as brightestDirectionalLight, or whether a JS-side
  //calibration is still needed.
  else if(oceanShadowDebugMode == 13){
    gl_FragColor = linearTosRGB(vec4(skyAmbientColor, 1.0));
  }
  //Mode 15: body channel only (post seabed-relight + transmittance blend +
  //inscatter + crest translucency), shown without any Fresnel mixing, sky
  //reflection, or specular. This is exactly what the shader composites at
  //weight (1 - fresnelFactor); compare to mode 11 (reflection) to see who
  //dominates at this fragment.
  else if(oceanShadowDebugMode == 15){
    gl_FragColor = linearTosRGB(vec4(dbgBody, 1.0));
  }
  //Mode 14: raw causticShader sample (R, G, B from the three offset taps used
  //for chromatic dispersion). Outputs the value BEFORE any *15 amplitude or
  //multiplication by sunDown/NdotL/shadow. If this reads black, causticShader
  //is returning zero (texture not bound, or hasUnderwaterGeom false). If it
  //reads as a clear ripple pattern, caustics ARE computing and the visibility
  //problem is downstream (absolute brightness against the dim relit seabed).
  else if(oceanShadowDebugMode == 14){
    gl_FragColor = vec4(dbgCausticSample, 1.0);
  }
  //Mode 16: ringIndex tint — saturated hue per clipmap ring, cycling at 6.
  //Combined with setOceanWireframe(1) this lets you see ring boundaries
  //even though screen-space cell size stays roughly constant (which is the
  //whole point of the clipmap — world-space cells double per ring out).
  //Ring 0 red, 1 orange, 2 yellow, 3 green, 4 cyan, 5 blue, then cycles.
  else if(oceanShadowDebugMode == 16){
    int r = ringIndex - 6 * (ringIndex / 6);
    vec3 tint =
      r == 0 ? vec3(1.0, 0.2, 0.2) :
      r == 1 ? vec3(1.0, 0.6, 0.1) :
      r == 2 ? vec3(1.0, 1.0, 0.2) :
      r == 3 ? vec3(0.2, 1.0, 0.2) :
      r == 4 ? vec3(0.2, 1.0, 1.0) :
               vec3(0.3, 0.4, 1.0);
    gl_FragColor = vec4(tint, 1.0);
  }
  //Mode 17: surface height relative to sea level, grayscale.
  //  black = trough at -5 m   mid-grey = sea level   white = crest at +5 m
  //If distant water shows a uniform grey band instead of bright/dark
  //alternation, the displacement isn't reaching that fragment (cascades
  //died, or mips are averaging it away). If it varies all the way to the
  //horizon, displacement is fine and the "flat" look is purely a normal
  //or shading-side problem (compare mode 18 next).
  else if(oceanShadowDebugMode == 17){
    float h = (worldPosition.y - baseHeightOffset) / 5.0;
    gl_FragColor = vec4(vec3(clamp(h * 0.5 + 0.5, 0.0, 1.0)), 1.0);
  }
  //Mode 18: displacedNormal (all cascades, after distance fades) as RGB.
  //  (n.x, n.y, n.z) mapped from [-1,1] to [0,1]. Flat upward-facing water
  //  reads as (0.5, 1.0, 0.5) — pale green. Variation off pale green is the
  //  normal carrying chop/ripple detail. If distance collapses to flat pale
  //  green while mode 17 still shows height variation, the normal-finite-
  //  difference taps are getting mip-averaged below their wavelength →
  //  Toksvig territory.
  else if(oceanShadowDebugMode == 18){
    gl_FragColor = vec4(displacedNormal * 0.5 + 0.5, 1.0);
  }
  //Mode 19: macroNormal (cascade 0 only) as RGB, same encoding as mode 18.
  //A/B against mode 18: at close range mode 18 should be visibly more
  //varied (cascade 1-5 detail on top of cascade 0); at far range the two
  //should converge as small cascades fade.
  else if(oceanShadowDebugMode == 19){
    gl_FragColor = vec4(macroNormal * 0.5 + 0.5, 1.0);
  }
  //Mode 20: Toksvig lostSlopeVar, grayscale. Black = no variance lost
  //(cascades fully present, close range), white = significant variance
  //thrown away by per-cascade fading (small cascades dead, far range).
  //If this stays near-black even at distance, the Toksvig accumulator
  //isn't catching what we think it should; if it goes pure white instantly,
  //we've over-multiplied somewhere. Range-stretched ×4 for visibility.
  else if(oceanShadowDebugMode == 20){
    gl_FragColor = vec4(vec3(clamp(lostSlopeVar * 4.0, 0.0, 1.0)), 1.0);
  }

  //Debug overlays — only drawn when oceanShadowDebugMode is non-zero. Bottom-
  //left: raw jacobian mapped [0,2] → [0,1] (grey=1.0=flat, black=0=folded,
  //white=2=stretched). Bottom-right: fftFoamAmount [0,1]. Top strip: 4-up
  //ocean-CSM cascade depth thumbnails (C0..C3 left→right). Depth values land
  //in a narrow band (~0.3-0.7 of the 200m depth window) so the visualisation
  //contrast-stretches that range to black-white. White edges are texels with
  //no caster (cleared to 1.0) — useful for seeing the cascade footprint
  //shrink as you move toward C0.
  if(oceanShadowDebugMode != 0){
    float panelSize = 200.0;
    vec2 fc = gl_FragCoord.xy;
    if(fc.x < panelSize && fc.y < panelSize){
      gl_FragColor = vec4(vec3(jacobian * 0.5), 1.0);
    }
    if(fc.x > screenResolution.x - panelSize && fc.y < panelSize){
      gl_FragColor = vec4(vec3(fftFoamAmount), 1.0);
    }
    float thumbSize = 200.0;
    float topY = screenResolution.y - thumbSize;
    if(fc.y > topY && fc.x < thumbSize * 4.0){
      int cascadeIndex = int(fc.x / thumbSize);
      vec2 thumbUV = vec2((fc.x - float(cascadeIndex) * thumbSize) / thumbSize,
                          (fc.y - topY) / thumbSize);
      //Sampler2D arrays demand a constant integral index; unroll the four
      //selections rather than dynamic-indexing the array. Recover the
      //blurred mean depth from the M1_pos moment (R channel) via
      //z = log(M1) / c — the inverse of the caster's exp(c·z) warp.
      float m1 = 1.0;
      if(cascadeIndex == 0)      m1 = texture2D(oceanShadowMap[0], thumbUV).r;
      else if(cascadeIndex == 1) m1 = texture2D(oceanShadowMap[1], thumbUV).r;
      else if(cascadeIndex == 2) m1 = texture2D(oceanShadowMap[2], thumbUV).r;
      else                       m1 = texture2D(oceanShadowMap[3], thumbUV).r;
      float d = log(max(m1, 1.0)) / evsmExpC;
      //Sea-surface depths cluster in [0.3, 0.7]; stretch that band so wave
      //structure shows as gray gradients; cleared/no-caster texels (d=1)
      //stay white.
      float v = clamp((d - 0.3) * 2.5, 0.0, 1.0);
      gl_FragColor = vec4(vec3(v), 1.0);
    }
  }

  //Blue noise dithering to break banding (same technique as a-starry-sky).
  //Skipped when a debug mode is active so visualisations aren't speckled.
  if(oceanShadowDebugMode == 0){
    float goldenRatio = 1.61803398875;
    float framePhase = fract(blueNoiseTime * 0.001);
    ivec2 temporalOffset = ivec2(
      128.0 * fract(framePhase * goldenRatio),
      128.0 * fract(framePhase * goldenRatio * goldenRatio)
    );
    gl_FragColor.rgb += (texelFetch(blueNoiseTexture, (ivec2(mod(gl_FragCoord.xy, 128.0)) + temporalOffset) % 128, 0).rgb - vec3(0.5)) / vec3(128.0);
  }

  #if(!$atmospheric_perspective_enabled)
    #include <fog_fragment>
  #endif
}
