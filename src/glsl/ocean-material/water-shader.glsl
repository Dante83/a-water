precision highp float;

varying vec2 vWorldXZ;
varying vec3 vPosition;
varying vec3 vDisplacedPosition;
//Displaced world position, plus the Phase 2 field level and per-cascade wave
//weights. See water-vertex.glsl for why these replaced the two mat4 varyings.
varying vec3 vWorldPosition;
varying vec4 vFieldLevelMaskA;   //(rest level, w0, w1, w2)
varying vec3 vFieldMaskB;        //(w3, w4, w5)
varying vec4 vSunShadowCoord;
varying vec4 vOceanShadowCoord0;
varying vec4 vOceanShadowCoord1;
varying vec4 vOceanShadowCoord2;
varying vec4 vOceanShadowCoord3;

//Half-widths of the two top-down ortho atlases, in metres. These MUST match
//the OrthographicCamera extents the JS side builds (TerrainOrthoPass), so the
//JS owns the value and splices it in here at material-build time rather than
//us keeping a second copy in sync by hand. They are per-session constants, not
//per-frame values, so they are consts rather than uniforms: uniform slots are
//scarce in this shader (see the THREE.Fog smuggle in the underwater path).
const float FOAM_ORTHO_HALF_WIDTH = $foam_ortho_half_width;
const float EXCLUSION_ORTHO_HALF_WIDTH = $exclusion_ortho_half_width;

//WaterField cascades (Phase 1b) — RT0 of WaterFieldPass's three world-anchored
//rings, fine -> coarse: (level, depth, shoreSDF, dryMask) since Phase 2. The
//fragment reads dryMask for the dry discard; the rest level comes in on a
//varying from the vertex stage. Center/halfWidth mirror
//WaterFieldPass.CASCADE_HALF_WIDTHS and are uploaded per-frame alongside the
//textures since cascades re-centre as the camera moves.
//
//Declared HERE, before waterFieldAt below, not down with the rest of
//this shader's uniforms (baseHeightOffset etc.) — GLSL requires an identifier
//to be declared before its first use in the same translation unit, and this
//file's functions are defined near the top, above most of its uniform block.
uniform sampler2D waterFieldCascade0;
uniform sampler2D waterFieldCascade1;
uniform sampler2D waterFieldCascade2;
uniform vec2 waterFieldCascadeCenter[3];
uniform float waterFieldCascadeHalfWidth[3];

//── The water-field seam (WaterField, Phase 1) ─────────────────────────────
//The field texel (level, depth, shoreSDF, dryMask) at a world XZ. Since Phase 2
//the fragment only reads dryMask here; rest level arrives on vFieldLevelMaskA,
//computed at the vertex (every site that used to read baseHeightOffset).
//
//Phase 1b: samples WaterFieldPass's own cascades (RT0), the exact
//textures water-tile-decode-pass.js fills. Selection is point-containment
//first, finest -> coarsest - the SAME test WaterFieldPass.cascadeIndexFor
//runs on the CPU side, so the GPU and CPU seams always agree on which
//cascade "owns" a given world position.
//
//Point containment, not distance, picks the cascade. The original Phase 1a
//note is still the reason cascade 0 (1 m/texel, 512 m across) matters here: a
//far clipmap ring's cells can be wider than a small lake, and reading a coarse
//cascade there would smear the lake's ~50 m shore cliff across several texels.
//Point containment already puts anything within 256 m of the camera - which
//covers a lake this size - on cascade 0, so the cliff resolves within 1-2
//texels instead.
//
//A smoothstep crossfade over the last 10% of a cascade's half-width avoids a
//hard pop as a fragment crosses from one cascade into the next-coarser one.
//Unrolled rather than a loop over the uniform arrays — this file never
//dynamically indexes a uniform array (see cascadePatchSizes/cascadeSpatialOffsets
//above, always literal-indexed), so this stays consistent with that and sidesteps
//ES 1.00's constant-index-expression restriction on sampler arrays entirely.
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

//Mirrors water-vertex.glsl's waterFieldAt exactly — keep the two in sync.
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
  //Inside cascade 2, or beyond every cascade — clamp to the coarsest rather
  //than falling back to the flat plane, so the seam never has a hard
  //discontinuity at the edge of the field's reach.
  return sampleWaterFieldCascade2(worldXZ);
}

//Phase 4 FlowHandoff (flowHandoffWeightAt): how much of this place belongs to the
//flowing surface. Spliced from ARestlessOcean.FlowHandoff.GLSL in
//ocean-wave-field.js; after the waterField samplers, which it reads, and before
//ShoreBreaker, whose swash reads it.
$flow_handoff_functions
//Phase 3a ShoreBreaker (uniforms, shoreBreakerEval, shoreBreakerActive): spliced
//from ARestlessOcean.ShoreBreaker.GLSL in ocean-wave-field.js by ocean-grid.js,
//the same chunk the vertex, the CSM caster and the height bake use. After
//waterFieldAt, which it calls. Bare token so the min build cannot strip it.
$shore_breaker_functions
//Phase 3b ShoreReflection (shoreReflectionHeightAt, shoreReflectionSlopeAt):
//spliced from ARestlessOcean.ShoreReflection.GLSL in shore-reflection-pass.js.
$shore_reflection_functions

//uniform vec3 cameraDirection;
uniform float sizeOfOceanPatch;
uniform int ringIndex;
uniform float chop;
uniform float baseHeightOffset;
//Phase 10: the six per-cascade displacement maps are ONE sampler2DArray, a layer
//per cascade, so they cost one texture unit here instead of six. They were always
//the same resolution and format — Crest-style banding varies the world patch SIZE,
//not the texel count. highp is what three already gives a ShaderMaterial, stated
//here because this data is metres of displacement and mediump would quantise it.
precision highp sampler2DArray;
uniform sampler2DArray cascadeDisplacementArray;
uniform float cascadePatchSizes[6];
uniform vec2 cascadeSpatialOffsets[6];
//Per-cascade slope variance σ² (in slope² units). Precomputed from JONSWAP +
//directional spread in ocean-height-band-library.js. Used in the Fresnel
//block to rebuild "effective roughness" of distant water — cascades whose
//detail has been mipped/aliased away below the pixel grid contribute their
//σ² to an α²_GGX that clamps grazing Fresnel via the Karis split-sum form.
uniform float cascadeRMSSlope[6];
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
//Live-tunable cap on the SSR march step count. The 48-step ray-march (plus its
//8-step binary refine and 4 silhouette taps) is the dominant per-pixel water
//cost; this lets us trade reflection reach for fill rate, or set 0 to skip the
//march entirely (sky-only) as an A/B bottleneck check.
uniform float ssrMaxSteps;
//How much ripple detail the SKY reflection tracks. 0 = reflect off macroNormal
//(cascade 0 only — long swell, the original behaviour, a near-mirror), 1 = off
//displacedNormal (every cascade, so the reflection breaks up with the ripples).
//The geometry raymarch is NOT affected; it always uses macroNormal. Live-tunable
//via window.setSsrSkyNormalBlend for A/B.
uniform float ssrSkyNormalBlend;
//The same knob for the GEOMETRY raymarch. 0 = reflect off macroNormal (cascade 0
//only), which is what this pass did for its whole life; 1 = off displacedNormal,
//so a reflected shoreline's silhouette breaks up with the ripples instead of
//sliding around as one rigid shape. Separate from ssrSkyNormalBlend because the
//two have opposite failure modes and want isolating: too much detail here
//scatters the march between neighbouring pixels, too little leaves the reflection
//looking like a flat mirror. Live-tunable via window.setSsrMarchNormalBlend.
uniform float ssrMarchNormalBlend;
uniform sampler2D meteringSurveyTexture;
//0 until a sky provider actually hands one over. Sampling an unbound sampler2D
//is not an error in GL — three binds a default empty texture and it returns
//black — so without this flag the miss is invisible. See
//computeStandaloneSkyRadiance.
uniform float meteringSurveyValid;

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
#if($flowing_water)
  //Phase 4: FlowFoamPass's target — r foam coverage, gb flow (m/s), a energy —
  //and the square it covers (centre x, centre z, half-width; 0 = none).
  uniform sampler2D flowFoamMap;
  uniform vec3 flowFoamWindow;
  //Phase 4 step 4: FlowSurfacePass's ripple profile buffer — r height, g slope along
  //the profile, each normalized to unit RMS slope over one FLOW_WAVE_PERIOD, and its
  //mips, so ripples finer than a pixel average away instead of glittering.
  uniform sampler2D flowWaveProfile;
  //Live knob on ripple slope (1 = the physical-ish defaults below).
  uniform float flowRippleScale;
  //Phase 6: the waterfall corridors (WaterfallSheetPass). Each is a flat-ended box
  //along a stretch of a fall's traced path: A = (start xz, end xz), B.x = half-width.
  //Inside one, the waterfall sheet draws wherever the level is steep, so this surface
  //steps aside there (see flowFallOwn). Flat ends, not capsules: a round cap reaches a
  //half-width (~5 m) past the lip and would erase the creek running up to it.
  const int FALL_CORRIDOR_MAX = 24;
  uniform vec4 fallCorridorA[FALL_CORRIDOR_MAX];
  uniform vec4 fallCorridorB[FALL_CORRIDOR_MAX];
  uniform int fallCorridorCount;
  float fallCorridorWeight(vec2 p){
    float w = 0.0;
    for(int i = 0; i < FALL_CORRIDOR_MAX; ++i){
      if(i >= fallCorridorCount) break;
      vec2 a = fallCorridorA[i].xy;
      vec2 d = fallCorridorA[i].zw - a;
      float len = length(d);
      if(len < 1e-3) continue;
      d /= len;
      vec2 q = p - a;
      float along = dot(q, d);
      float across = abs(q.x * d.y - q.y * d.x);
      float r = fallCorridorB[i].x;
      //Half a metre of soft edge all round, so neighbouring boxes overlap cleanly.
      float inside = smoothstep(-0.5, 0.0, along) * smoothstep(-0.5, 0.0, len - along)
                   * (1.0 - smoothstep(r - 0.5, r, across));
      w = max(w, inside);
    }
    return w;
  }
  const float FLOW_WAVE_PERIOD = $flow_wave_period;
  //Cheap value noise for standing-wave patches (a look choice, see below).
  float flowHash(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
  float flowValueNoise(vec2 q){
    vec2 i = floor(q);
    vec2 f = q - i;
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(flowHash(i), flowHash(i + vec2(1.0, 0.0)), f.x),
               mix(flowHash(i + vec2(0.0, 1.0)), flowHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
#endif

//Foam-texture scroll velocity (m/s). Driven from a randomized wind vector in
//ocean-grid.js so foam drifts with the prevailing wind direction.
uniform vec2 foamScrollVelocity;
//Wind-driven foam bias ("dip the Jacobian", Sea-of-Thieves style). 0 in calm
//seas; rises with wind so the fold threshold is met by progressively gentler
//folds, and at storm strength by the open surface itself, turning the sea white.
//Computed CPU-side from wind speed over a tunable range (ocean-grid.js).
uniform float foamWindBias;

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
//Phase 10: the four moment maps are ONE sampler2DArray, a layer per cascade, so
//they cost one texture unit instead of four. They were already identical 2048²
//RGBA32F targets — only the ortho extent differs, and that lives in the matrix,
//not the texture. highp is stated because the warped second moment reaches
//~22000 and mediump would throw the variance term away (declared once for the
//whole fragment stage, up with cascadeDisplacementArray).
uniform sampler2DArray oceanShadowMap;
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
//Opacity for the translucent cascade-band overlay (debug mode 40). 0 = scene
//only, 1 = overlay only; in between blends the cascade colours over the real
//render so fade boundaries can be read against the actual waves.
uniform float debugBlend;
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

//Microfacet roughness for the Cook-Torrance sun-glint BRDF. Represents the
//sub-pixel slope variance the FFT spectrum cannot resolve — capillary waves
//and ripples below the smallest cascade's wavelength. The mesh-resolved
//FFT slopes (cascade chain) drive the meso-normal, the roughness drives
//the statistical microfacet distribution within each pixel. Low values
//(~0.05) give tight pinpoint glints, higher (~0.15) widen into a soft glow.
//Live-tunable from the console via setSurfaceRoughness().
uniform float surfaceRoughness;

//── Crest-style sun-glint controls (OceanReflection.hlsl:104-118) ────────────
//specFresnelGate blends the Phong sun glint from our legacy ungated-additive
//path (0.0 = byte-identical to before) to Crest's Fresnel-gated path (1.0),
//where the glint rides INSIDE the reflection and shares its Schlick R_theta.
//Near field (looking down, R_theta tiny) then cannot bloom however wide the
//lobe; grazing mid/far (R_theta->1) brightens the glint with distance, curing
//the mid-band dead zone. specBoost is Crest's _DirectionalLightBoost (the
//compensation lever once the Fresnel gate dims the near field). The lobe
//falloff varies from a near exponent to specFalloffFar over specFalloffFarDist
//(Crest _DirectionalLightFallOffFar / _DirectionalLightFarDistance, sqrt ramp);
//specFalloffFar defaults equal to the near exponent so the ramp is a no-op.
uniform float specFresnelGate;
uniform float specBoost;
uniform float specFalloffFar;
uniform float specFalloffFarDist;

uniform float t;
uniform float patchDataSize;

//── Underwater state ─────────────────────────────────────────────────────
//Signed metres of camera submersion: + above the water surface, − below.
//Sourced CPU-side (ocean-grid.js) from a single-texel readback of the FFT
//displacement at the camera XZ — cascades 0+1, the dominant swell.
uniform float cameraSubmersion;
//Smooth 0→1 underwater blend (1 = fully submerged). Crossfades the fog
//model so bobbing through the waterline doesn't pop.
uniform float underwaterFactor;
//World-space Y of the wave-displaced water surface near the camera — the
//air/water split threshold for per-fragment fog (Phase 1+ design).
uniform float waterSurfaceY;
//Underwater planar-reflection RT (the TIR mirror) + the world→UV texture
//matrix that projects a ceiling fragment into that mirrored render.
uniform sampler2D underwaterReflectionTexture;
uniform mat4 underwaterReflectionMatrix;
//Above-water transmission RT — a separate submerged-frame render of the
//FULLY-LIT scene (sky dome restored, real materials, atmospheric perspective,
//ocean grid hidden, underwater curtain hidden, scene.fog swapped back to the
//a-starry-sky version). Sampled by the Snell-window transmitted-ray branch
//of computeUnderwaterCeiling. The refraction G-buffer is unshaded raw
//albedo with above-water content unfogged, useless for the upward view
//through the surface; this target is the proper above-the-surface capture.
uniform sampler2D aboveWaterTransmissionTexture;

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

//Wave-normal distortion applied to the underwater reflection sample — this
//is what makes the planar (flat-plane) mirror ripple with the FFT waves.
const float UNDERWATER_REFLECTION_DISTORTION = 0.06;

//Artistic widening of the Snell-window edge, in units of cos(incidence). The
//true water->air Fresnel curve spikes from ~15% to 100% within ~3 degrees of
//the critical angle, so the window reads as a hard ring. This eases the
//approach to total internal reflection over a wider angular band. Higher =
//softer, blurrier window edge. Set to 0.0 for the strict physical curve.
const float UNDERWATER_TIR_SOFTNESS = 0.13;

//Effective-depth proxy: meters of underwater path per meter of horizontal
//camera-to-fragment distance. Lets transmittance decay toward the horizon
//even when no underwater geometry was hit by the refraction ray.
const float HORIZONTAL_DEPTH_SCALE = 0.008;

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
  //Depth clips stay hard — sc.z outside [0,1] genuinely means no info.
  if(sc.z > 1.0 || sc.z < 0.0) return 1.0;
  //Hard-reject only OUTSIDE the lateral frustum. Fragments just inside the
  //edge still sample the map; the fade band below blends them toward "lit"
  //so the boundary doesn't read as a hard line on the water. Without this,
  //a tall caster's long shadow gets sliced by the frustum edge as a sharp
  //diagonal — see modes 25/26 (added 2026-05-20) to visualise.
  vec2 edgeDist = min(sc.xy, vec2(1.0) - sc.xy);
  float edge = min(edgeDist.x, edgeDist.y);
  if(edge < 0.0) return 1.0;
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
  shadow *= (1.0 / 9.0);
  //Soft edge fade: lerp from shadow value toward fully lit over the outer
  //5% of UV space. At a 200m frustum that's a 10m fade band; at 800m it's
  //40m. Wide enough to hide the cutoff, narrow enough to keep the shadow's
  //real silhouette inside the frustum sharp.
  float fade = smoothstep(0.0, 0.05, edge);
  return mix(1.0, shadow, fade);
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
//The 4-cascade selection is written out rather than looped so that each step
//can fade into the next coarser cascade with its own pair of coordinates.
//(Before Phase 10 it had no choice: the maps were an array of samplers, whose
//indices GLSL ES requires to be constant. They are one sampler2DArray now, so
//this shape is a deliberate one.) The `if(found) return` pattern short-circuits
//the texture read once a covering cascade is found — typically C0 near camera,
//C3 at horizon.

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

//Takes the cascade's LAYER rather than a sampler. Phase 10: a sampler2DArray
//cannot be passed around the way a sampler2D was, and does not need to be —
//the cascade is a coordinate now.
float sampleOceanCascadeEVSM(int cascadeLayer, vec3 sc){
  //Sample the 4 moments with hardware bilinear (LinearFilter on the float
  //target), warp the fragment depth into the same domain, and take the
  //min of the two Chebyshev bounds. Linear filtering of warped moments
  //is mathematically valid because the warp is monotonic — bilinear
  //interpolation of moments equals the moments of the bilinear-
  //interpolated warped depth.
  vec4 moments = texture(oceanShadowMap, vec3(sc.xy, float(cascadeLayer)));
  //No-caster guard. A real occluder warps to M1 = E[exp(evsmExpC·z)] with
  //z in [0,1], so M1 >= exp(0) = 1 always; the separable Gaussian blur is a
  //convex average and preserves M1 >= 1. Therefore M1 < 1 is impossible for
  //any real occluder — it can ONLY be the caster no-occluder clear
  //baseline. That baseline is meant to be the far-plane moments (M1 = exp(c)
  //≈ 148 = fully lit), but the renderer's premultiplied alpha multiplies the
  //clear RGB by the clear alpha (= M4 = exp(-2c) ≈ 0), collapsing M1 to
  //exp(-c) ≈ 0.0067. That fake near-plane occluder shadows every open-water
  //texel beyond the caster footprint and kills the sun glint there (visible
  //as the dead band; mode 4 shows these texels black). Real M1 ≥ 1, collapsed
  //M1 ≈ exp(-c) < 1, so reading M1 < 1 as "no occluder → fully lit" cancels
  //the artifact without touching genuine wave-on-wave self-shadow inside the
  //footprint. (Fixing the clear at the source so mode 4 reads correctly is a
  //separate follow-up — this makes the shadow itself correct.)
  if(moments.x < 0.999) return 1.0;
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
    float shadow0 = sampleOceanCascadeEVSM(0, sc0);
    float w0 = oceanCascadeFadeWeight(sc0, margin0);
    if(w0 >= 1.0) return shadow0;
    vec3 sc1 = shadowCoord1.xyz / shadowCoord1.w;
    float margin1 = oceanCascadeMarginUV(1);
    if(oceanCascadeContains(sc1, margin1)){
      float shadow1 = sampleOceanCascadeEVSM(1, sc1);
      return mix(shadow1, shadow0, w0);
    }
    return shadow0;
  }

  //C1 → fades into C2
  vec3 sc1 = shadowCoord1.xyz / shadowCoord1.w;
  float margin1 = oceanCascadeMarginUV(1);
  if(oceanCascadeContains(sc1, margin1)){
    float shadow1 = sampleOceanCascadeEVSM(1, sc1);
    float w1 = oceanCascadeFadeWeight(sc1, margin1);
    if(w1 >= 1.0) return shadow1;
    vec3 sc2 = shadowCoord2.xyz / shadowCoord2.w;
    float margin2 = oceanCascadeMarginUV(2);
    if(oceanCascadeContains(sc2, margin2)){
      float shadow2 = sampleOceanCascadeEVSM(2, sc2);
      return mix(shadow2, shadow1, w1);
    }
    return shadow1;
  }

  //C2 → fades into C3
  vec3 sc2 = shadowCoord2.xyz / shadowCoord2.w;
  float margin2 = oceanCascadeMarginUV(2);
  if(oceanCascadeContains(sc2, margin2)){
    float shadow2 = sampleOceanCascadeEVSM(2, sc2);
    float w2 = oceanCascadeFadeWeight(sc2, margin2);
    if(w2 >= 1.0) return shadow2;
    vec3 sc3 = shadowCoord3.xyz / shadowCoord3.w;
    float margin3 = oceanCascadeMarginUV(3);
    if(oceanCascadeContains(sc3, margin3)){
      float shadow3 = sampleOceanCascadeEVSM(3, sc3);
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
    return sampleOceanCascadeEVSM(3, sc3);
  }
  return 1.0;
}

#if($atmospheric_perspective_enabled)
  //Forward declaration — defined later, alongside applyAtmosphericPerspective.
  vec3 computeSkyRadiance(vec3 worldDir);
#endif

//── The standalone sky ─────────────────────────────────────────────────────
//What the SSR miss-path reflects when there is no sky provider in the scene.
//
//The two paths that existed both need a-starry-sky: computeSkyRadiance wants its
//atmosphere LUTs, and the atmosphere-off fallback samples `meteringSurveyTexture`,
//which ocean-grid.js only ever assigns from `skyDirector`. With no sky provider
//that sampler stays unbound, GL quietly returns black for every fetch, and the
//water reflects a black sky — CONSTANT black, so the reflection carried no
//directional information at all and the surface read as a flat mirror no matter
//what the waves did. That is the whole "reflections do not bend with the wave
//vertices" symptom: not the ray direction (macroNormal is fine), the thing being sampled.
//
//So synthesise a sky from the lights the scene DOES have. skyAmbientColor is the
//hemispheric fill a-water already reads (from a-starry-sky, or from the scene's
//own HemisphereLight in standalone), so treat it as the hemisphere's mean and
//spread a horizon→zenith gradient around it; add the sun as a tight lobe so a
//glint still lands in the right place. Crude next to a real atmosphere, but it
//VARIES WITH DIRECTION, which is the entire job here.
vec3 computeStandaloneSkyRadiance(vec3 worldDir){
  //pow < 1 keeps most of the gradient near the horizon, where a reflection ray
  //off water actually spends its time — a linear ramp puts all the change
  //overhead where the water never looks.
  float up = pow(clamp(worldDir.y, 0.0, 1.0), 0.55);
  vec3 horizon = skyAmbientColor * 0.75;
  vec3 zenith  = skyAmbientColor * 1.35;
  vec3 sky = mix(horizon, zenith, up);
  //⚠ NO SUN DISK HERE, DELIBERATELY. An earlier version added one, and it was
  //wrong twice over. The sun's reflection off this water is ALREADY produced, by
  //the Crest-style Phong lobe below (`specular`, pow(specRdotL, specFallOff)),
  //which composites alongside this reflection rather than through it — so a disk
  //in here is a SECOND sun, double-counted. Worse, it is a second sun of the
  //wrong shape: this function is evaluated on a direction reflected off the
  //SMOOTH normal, so it renders as one round mirror blob sitting on top of the
  //real, ripple-broken glitter path instead of joining it. If the sun ever needs
  //to appear in the sky reflection itself, it belongs on the same normal the
  //Phong lobe uses, not here.
  //Rays aimed below the horizon are looking into the water, not the sky. Fading
  //toward the horizon colour rather than returning the zenith keeps the grazing
  //band continuous where the SSR march runs out of steps.
  sky = mix(horizon, sky, smoothstep(-0.15, 0.02, worldDir.y));
  return sky;
}

//Screen-space reflection using the refraction color+depth buffer (already rendered
//from the main camera with water hidden — zero extra render passes).
//Exponential stepping covers nearby geometry detail AND distant sky.
//Sky fallback: LUT-based atmosphere (when enabled) or metering survey fisheye.
//Returns LINEAR radiance — caller must NOT apply sRGBToLinear to the result.
//Geometry hits come from the sRGB refraction buffer and are converted here.
//TWO DIRECTIONS, NOT ONE.
//  marchDir — the ray the depth-buffer raymarch follows. Wants the SMOOTH normal:
//             per-pixel normal jitter makes neighbouring fragments march into
//             different depth footprints and the geometry reflection breaks into
//             noise. This is why the SSR ray was put on macroNormal originally,
//             and that reasoning still holds.
//  skyDir   — the direction the sky is sampled along on a MISS. Wants the exact
//             opposite: sub-metre ripple detail is the entire reason a real sea
//             surface glitters rather than mirroring. Sharing one direction meant
//             the sky reflection only ever tracked the long swell, which reads as
//             a reflection that barely moves while the water under it ripples.
//Callers that want the old single-direction behaviour pass the same vector twice.
vec3 screenSpaceReflection(vec3 worldPos, vec3 marchDir, vec3 skyDir){
  vec3 reflectDir  = skyDir;      //every sky lookup below reads this
  vec3 viewPos     = (ssrViewMatrix * vec4(worldPos,    1.0)).xyz;
  vec3 viewReflect = normalize(mat3(ssrViewMatrix) * marchDir);

  //Sky fallback: use LUT-based sky radiance when atmosphere is enabled for correct horizon
  //colors; fall back to metering survey fisheye for the no-atmosphere build path.
  #if($atmospheric_perspective_enabled)
    vec3 skyColor = computeSkyRadiance(reflectDir);
  #else
    //A sky provider can still be present with atmospheric perspective switched
    //off, in which case its metering survey is the better source — it is a real
    //render of the real sky. Only fall back when nothing bound one.
    vec2 skyUV = clamp(reflectDir.xz * 0.5 + 0.5, 0.01, 0.99);
    vec3 skyColor = (meteringSurveyValid > 0.5)
                  ? texture2D(meteringSurveyTexture, skyUV).rgb
                  : computeStandaloneSkyRadiance(reflectDir);
  #endif

  //Note: a procedural sun-disk/halo addition was attempted here to fill the
  //"dark hole" in computeSkyRadiance at the sun direction at sunset (the
  //Mie forward-scattering peak gets crushed by the horizon fade — softened
  //since computeSkyRadiance moved from fade^3 to the dome-matching fade^2). It
  //produced wrong colors when combined with the LUT's dim plum baseline.
  //The proper fix is to either (a) sample a-starry-sky's actual sun render
  //target in the SSR fallback, or (b) hide the sun mesh during the G-buffer
  //refraction pass and have the sky LUT include a proper sun peak.
  //Deferred to a follow-up session.

  //Reflected ray pointing behind the camera — skip march, return sky directly.
  if(viewReflect.z > 0.0){
    return skyColor;
  }

  //Exponential step: starts at 0.25m, grows 1.15x each step. Was 0.5m / 1.3x,
  //then 1.2x; the slower growth pulls the step size at mid-distance hits down
  //(at iter ~15: ~30 m/step at 1.3x → ~3.8 m at 1.2x → ~2.0 m at 1.15x), so
  //binary refinement starts from a tighter bracket and converges to ~cm-level
  //residual. The 1.15x tightening also halves the stride stripes lean on the
  //jitter for (see below), trading reach — full 48-step span drops from ~7.9 km
  //to ~1.2 km, still far past where the edge-fade kills SSR.
  //Per-pixel blue-noise jitter of the march phase. The exponential step
  //boundaries are otherwise coherent across neighboring fragments, so whether
  //a sample lands inside a reflected object depth footprint flips in visible
  //stripes — worst on flat water (wind 0), where wave normals no longer dither
  //the ray directions for free. Scaling the initial step by [0.75, 1.25]
  //decorrelates the whole exponential ladder per pixel, turning the stripes
  //into fine stable grain. STATIC noise (no temporalOffset): there is no TAA
  //pass to resolve temporal shimmer, so the pattern must not change per frame.
  float ssrJitter = texelFetch(blueNoiseTexture, ivec2(mod(gl_FragCoord.xy, 128.0)), 0).r;
  float stepLen = 0.25 * (0.75 + 0.5 * ssrJitter);
  vec3 curPos = viewPos;
  vec3 prevPos = viewPos;

  //48 is the hard loop ceiling (GLSL ES requires a constant bound); ssrMaxSteps
  //caps the live count below it. Hitting the cap with no crossing falls through
  //to the sky return below — identical to running out of steps naturally.
  for(int i = 0; i < 48; i++){
    if(float(i) >= ssrMaxSteps){ break; }
    prevPos = curPos;
    curPos  += viewReflect * stepLen;
    stepLen *= 1.15;

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
      //curPos. 8 iterations narrows it to ~1/256 of the last step length, so
      //real hits converge to sub-cm residual even when the outer step has
      //grown to tens of metres at the horizon. Was 5 iterations (1/32);
      //3 extra iterations cost 3 depth taps per accepted hit and visibly
      //sharpen where the reflection of an object meets the waterline.
      //Thickness-bug rays (ray passes behind thin geometry whose back face is
      //not in the depth buffer) still converge, but only to the thin object's
      //front face — which the silhouette check below then rejects.
      vec3 lo = prevPos;
      vec3 hi = curPos;
      vec2  hitUV         = uv;
      float hitSceneDepth = sceneDepth;
      float hitDelta      = depthDelta;
      for(int j = 0; j < 8; j++){
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
      //Soft acceptance, same reasoning as silhouetteConfidence above: a hard
      //hitDelta cutoff flips between accept and reject across adjacent
      //fragments whose refined residuals straddle the threshold, striping the
      //reflection. Fade out over the top half of the threshold instead.
      float convergenceConfidence =
        1.0 - smoothstep(convergenceThreshold * 0.5, convergenceThreshold, hitDelta);
      if(convergenceConfidence > 0.0 && silhouetteConfidence > 0.0){
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
        return mix(skyColor, hitColor, edgeFade * silhouetteConfidence * convergenceConfidence);
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

//Narkowicz ACES, ours, PRIVATELY NAMED. three removed its copy at some point, so we carry one.
//
//⚠ DO NOT RENAME THIS BACK TO MyAESFilmicToneMapping. That is a-starry-sky's global, declared
//unguarded in its fog chunk, and this shader includes that chunk whenever the sibling sky is
//present. Two bodies of one function in one translation unit is a LINK failure, not a warning:
//
//    ERROR: 0:1326: 'MyAESFilmicToneMapping' : function already has a body
//
//and the whole water material fails to compile. It bites the instant scene.fog turns on, i.e.
//on going underwater, which is why the surface can look fine right up until you dive.
//
//THE OLD #ifndef ARO_AES_TONEMAP GUARD DID NOT HELP, and it is worth saying why so nobody
//reinstates it: ARO_AES_TONEMAP is OUR define. a-starry-sky has never heard of it and does not
//set it, so the guard only ever protected us from our own second declaration (UnderwaterFogChunk)
//and never from the sibling's — the collision that actually happens. A private name cannot
//collide with anything, which is why this is a rename and not a better guard.
//
//The operator is identical to a-starry-sky's and to UnderwaterFogChunk's, so nothing about the
//look changes; only the symbol does.
vec3 aroAESFilmicToneMapping(vec3 color) {
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}

//Fresnel reflectance at air->water interface (for light entering the water from above)
//Schlick approximation with n_water = 1.33 — uses the file-level r0 constant.
float fresnelAirToWater(float cosTheta){
  return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
}

//Henyey–Greenstein single-parameter phase function. Properly normalised
//(integrates to 1 over the sphere), so the 1/(4π) is baked in. g>0 means
//forward-scattering; g≈0.85 is the canonical ocean-water value (Mobley 1994).
const float UW_PI = 3.14159265359;
//Henyey-Greenstein asymmetry. 0.85 is the canonical clean-ocean value
//(Mobley 1994), but with that peaked phase the inscatter looking
//perpendicular to the sun (e.g. underwater cam at the horizon while the
//sun is overhead) is ~100× weaker than the forward halo — so the horizon
//read as nearly black even at midday. Dropping to 0.5 (turbid coastal
//range) lifts perpendicular scatter so the horizon picks up real sun
//light and asymptotes to a visible teal.
const float UW_HG_G = 0.5;
const float UW_INV_4PI = 0.07957747154;
//How much the murk's SUN single-scatter term keeps its view (gaze) dependence.
//1.0 = full Henyey-Greenstein halo (physical: brighter looking toward the sun,
//dimmer away). 0.0 = collapse the sun phase to isotropic (1/4π), making the
//equilibrium teal view-INDEPENDENT so the directly-viewed seabed (down gaze) and
//the reflected ceiling (up gaze) fade to the SAME teal — the uniform "colour of
//the water" look. Kept at 0.0: with the sky-ambient term restored the murk is no
//longer dark, but the physical halo at 1.0 still reintroduces a top/bottom
//difference between seabed and ceiling, which we don't want here. Flip to 1.0 if
//you prefer the physical sun glow. MUST stay in lockstep with the chunk's
//UW_MURK_GAZE_WEIGHT in ocean-grid.js _injectUnderwaterFogChunk so the seabed/
//curtain fog uses the same phase as this ceiling/body path.
const float UW_MURK_GAZE_WEIGHT = 0.0;
//Underwater fog isolation taps — debugging the seabed-vs-ceiling murk match.
//MUST match UW_DEBUG_FOG_MODE in ocean-grid.js _injectUnderwaterFogChunk so both
//the direct-seabed (chunk) and reflected-ceiling (this applyUnderwaterFog) paths
//are bisected together.
//  0 = normal production blend.
//  1 = NO fog (raw input passes through).
//  2 = fog a CONSTANT input color (vec3(0.5)) — isolates the blend from content.
//  3 = output the inscatter MURK only (full fog) — shows what each path fades to.
const int UW_DEBUG_FOG_MODE = 0;
//Underwater path-length scale. 1.0 = physically true geometric distance:
//extinction (absorption + scattering, per metre) integrates over the REAL ray
//length, with NO magnification. The distance to a rock is the distance to a
//rock; a surface->floor reflection bounce is just its real, longer path. Was
//0.3 — a non-physical clarity fudge that made the water ~3.3x clearer than its
//Jerlov coefficients AND disagreed with the camera-depth darkening (line ~818),
//which always integrated full extinction over true depth. Set water visibility
//PHYSICALLY via water_type / the Jerlov coefficients instead of discounting
//distance. Must match UW_DIST_SCALE in the chunk (ocean-grid.js
//_injectUnderwaterFogChunk) so the ceiling and direct-view seabed agree.
const float UW_DIST_SCALE = 1.0;
float henyeyGreenstein(float cosTheta, float g){
  float g2 = g * g;
  return (1.0 - g2) * UW_INV_4PI
         / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5);
}

//Single-scatter inscatter equilibrium of the water medium, evaluated at the
//surface (depth 0) for a given view direction. Two contributions:
//  • Sun  — collimated downwelling, Henyey-Greenstein phase along the view ray.
//           Strongly view-direction-dependent: bright halo when you look toward
//           the sun, dim when you look away.
//  • Sky  — diffuse hemispherical downwelling, treated as isotropic phase
//           (1/4π). View-direction-independent.
//Both are scaled by waterAlbedo = scattering / extinction — the medium's
//single-scatter albedo, the fraction of an absorbed photon that re-emerges
//as scattered radiance. Result is per-channel pre-tonemap LDR or HDR.
//
//Convention (matches water-shader.glsl :1640-1648): `brightestDirectionalLightDirection`
//points FROM the sun TO the scene — i.e., the direction sunlight travels.
//HG cos θ = dot(incident, scattered) = dot(lightDir, -viewDir) = -dot(lightDir, viewDir).
//cos θ = +1 when the camera looks TOWARD the sun (viewDir = -lightDir) — HG peaks
//there (forward scattering, the halo-around-the-sun look).
vec3 underwaterInscatterSurface(vec3 viewDirWorld){
  vec3 extinction = waterAbsorption + waterScattering;
  vec3 albedo = waterScattering / max(extinction, vec3(1e-4));
  //Same directDownwelling / ambientDownwelling components the body-colour blend
  //uses (water-shader.glsl :1373) so all three fog paths reference one source.
  //Computed inline because applyUnderwaterFog is called BEFORE the main()
  //block that builds those variables — we redo the small calc here.
  float sunCosZenith = max(dot(-brightestDirectionalLightDirection, vec3(0.0, 1.0, 0.0)), 0.0);
  float sunTransmission = 1.0 - fresnelAirToWater(sunCosZenith);
  vec3 directDownwelling = brightestDirectionalLight * sunTransmission * sunCosZenith;
  vec3 ambientDownwelling = skyAmbientColor;
  //Sun: HG-phased single scatter into the view ray. Blend the HG halo toward
  //the isotropic phase (1/4π) by UW_MURK_GAZE_WEIGHT — at 0.0 the sun term is
  //view-independent so the murk equilibrium no longer depends on gaze (the
  //direct-vs-reflected horizon test; see the const above).
  float cosTheta = -dot(viewDirWorld, brightestDirectionalLightDirection);
  float pSun = mix(UW_INV_4PI, henyeyGreenstein(cosTheta, UW_HG_G), UW_MURK_GAZE_WEIGHT);
  //Sky: hemispherical isotropic approximation. 1/(2π) is the contribution of
  //a uniform upper hemisphere to a single-scattering point with isotropic
  //phase (∫ p_iso L_sky dω over the hemisphere = E_sky/(2π)).
  float pSky = 1.0 / (2.0 * UW_PI);
  vec3 singleScatter = albedo * (directDownwelling * pSun + ambientDownwelling * pSky);
  //Multiple-scatter diffuse glow — the dominant visible murk, and the term that
  //keeps the off-sun water from reading black. Single scatter (above) is
  //forward-peaked through pSun so it collapses to ~0 perpendicular to the sun;
  //real water re-scatters its own light many times into an isotropic volume
  //glow. Model that glow with the semi-infinite-medium diffuse reflectance
  //(the "ocean colour" similarity relation), R∞ = (1-√(1-a))/(1+√(1-a)) per
  //channel, driven by the total downwelling and spread Lambertian (1/π). This
  //is ~4× the old a²/(1-a)/(4π) floor at ocean albedos (~0.2), which read as a
  //barely-there tint — R∞ is what makes the water a real teal volume. View-
  //independent, so the horizon fades to that teal instead of black.
  vec3 totalDownwelling = directDownwelling + ambientDownwelling;
  vec3 sqrtOneMinusA = sqrt(max(vec3(1.0) - albedo, vec3(0.0)));
  vec3 rInf = (vec3(1.0) - sqrtOneMinusA) / (vec3(1.0) + sqrtOneMinusA);
  vec3 multiScatter = rInf * totalDownwelling * (1.0 / UW_PI);
  //Camera-depth darkening. Inscatter along any view ray is front-loaded near
  //the eye — each scattering point is weighted by exp(-ext·distanceFromCamera) —
  //so the equilibrium the fog fades to is the medium's radiance at the CAMERA's
  //depth, the same "colour of the water" in every direction. Using this here
  //(instead of each caller darkening by its own fragment/surface depth) is what
  //makes the ceiling, curtain, seabed veil and abyss all converge to one teal
  //rather than diverging (bright ceiling band vs black curtain). Above water
  //camDepth clamps to 0 — the ray enters at the surface — so the body-colour
  //blend keeps its surface-level inscatter unchanged.
  float camDepth = max(0.0, waterSurfaceY - cameraPosition.y);
  vec3 camDepthDarken = exp(-(waterAbsorption + waterScattering) * camDepth);
  return (singleScatter + multiScatter) * camDepthDarken;
}

//Apply underwater volumetric fog along a path through water. `color` is the
//radiance of the fragment being fogged (post-shading, pre-tonemap). `dist`
//is the straight path length through water for this fog segment.
//`viewDirWorld` is the world-space camera→fragment direction; drives HG
//forward-scatter — looking toward the sun lights the murk brighter than
//looking away. This is the volumetric counterpart to the body-colour blend,
//and shares the same `underwaterInscatterSurface()` source — which already
//camera-depth-darkens the equilibrium — so all three paths agree on the
//medium's equilibrium colour.
vec3 applyUnderwaterFog(vec3 color, float dist, vec3 viewDirWorld){
  vec3 extinction = waterAbsorption + waterScattering;
  vec3 transmittance = exp(-extinction * dist);
  //The equilibrium is camera-depth-darkened inside underwaterInscatterSurface
  //(inscatter is front-loaded near the eye), so there is no per-fragment depth
  //term here — every long ray fades to the same camera-depth water colour.
  vec3 inscatter = underwaterInscatterSurface(viewDirWorld);
  //UW_DEBUG_FOG_MODE isolation taps (see const above), matched to the fog chunk.
  if(UW_DEBUG_FOG_MODE == 1){ return color; }                                          //raw input, no fog
  if(UW_DEBUG_FOG_MODE == 2){ return vec3(0.5) * transmittance + inscatter * (vec3(1.0) - transmittance); } //constant input
  if(UW_DEBUG_FOG_MODE == 3){ return inscatter; }                                      //murk only
  return color * transmittance + inscatter * (vec3(1.0) - transmittance);
}

//Fresnel reflectance for a ray INSIDE the water striking the underside of the
//surface (water n≈1.333 → air n=1.0). Unlike the air→water case this has a
//critical angle (~48.6°): once the incidence angle exceeds it the ray is
//totally internally reflected and reflectance is 1.0 — the underside becomes
//a perfect mirror. cosI is the cosine of the incidence angle at the interface.
float fresnelWaterToAir(float cosI){
  cosI = clamp(cosI, 0.0, 1.0);
  float etaWA = 1.333;                          //n_water / n_air
  float sinT2 = etaWA * etaWA * (1.0 - cosI * cosI);

  //Strict physical reflectance where the ray still transmits.
  float physical;
  if(sinT2 >= 1.0){
    physical = 1.0;                             //total internal reflection
  } else {
    float cosT = sqrt(1.0 - sinT2);
    float rs = (etaWA * cosI - cosT) / (etaWA * cosI + cosT);
    float rp = (etaWA * cosT - cosI) / (etaWA * cosT + cosI);
    physical = clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
  }

  //Artistic softening (deliberate fudge — see UNDERWATER_TIR_SOFTNESS). The
  //physical curve still reaches 1.0 exactly at the true critical angle, but a
  //smoothstep ramp climbs to 1.0 starting UNDERWATER_TIR_SOFTNESS earlier in
  //cos(incidence). max() keeps the window interior at its low physical
  //reflectance and only widens the otherwise-abrupt edge ring.
  float cosCrit = sqrt(max(0.0, 1.0 - 1.0 / (etaWA * etaWA)));
  float softEdge = smoothstep(cosCrit + UNDERWATER_TIR_SOFTNESS, cosCrit, cosI);
  return max(physical, softEdge);
}

//Smith masking-shadowing function for a Beckmann microfacet distribution.
//Rational-fit Lambda approximation: cheap, accurate to ~1%, branch-friendly.
//Ported verbatim from the Water sibling (Acerola FFTWater.shader) which in
//turn cites Walter et al. 2007 ("Microfacet Models for Refraction"). Result
//is the Lambda(omega) term that combines as G = 1/(1 + Lambda_v + Lambda_l).
float smithMaskingBeckmann(vec3 H, vec3 S, float roughness){
  float hdots = max(0.001, dot(H, S));
  float a = hdots / (roughness * sqrt(1.0 - hdots * hdots));
  float a2 = a * a;
  return a < 1.6 ? (1.0 - 1.259 * a + 0.396 * a2) / (3.535 * a + 2.181 * a2) : 0.0;
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

    //Sun inscatter. horizonFade is squared (NOT cubed) here to match the sky
    //dome exactly — a-starry-sky multiplies intensityFader twice in
    //linearAtmosphericPass. This function must track the VISIBLE sky so the
    //SSR sky fallback and skirt stay continuous with the dome at twilight;
    //fade cubed left them darker than the dome by a factor of fade.
    //applyAtmosphericPerspective keeps fade cubed (the fog convention).
    float zSun = parameterizationOfCosOfSourceZenithToZ(max(atmSunPosition.y, 0.0));
    vec3 uv3Sun = vec3(xParam, yHeight, zSun);
    vec3 mieSun = texture(atmosphereMieInscattering, uv3Sun).rgb;
    vec3 raySun = texture(atmosphereRayleighInscattering, uv3Sun).rgb;
    float cosViewSun = dot(skyDir, atmSunPosition);
    vec3 skySun = (atmSunHorizonFade * atmSunHorizonFade) * atmScatteringSunIntensity
                * (miePhaseFunction(cosViewSun) * mieSun + rayleighPhaseFunction(cosViewSun) * raySun);

    //Moon inscatter
    float zMoon = parameterizationOfCosOfSourceZenithToZ(max(atmMoonPosition.y, 0.0));
    vec3 uv3Moon = vec3(xParam, yHeight, zMoon);
    vec3 mieMoon = texture(atmosphereMieInscattering, uv3Moon).rgb;
    vec3 rayMoon = texture(atmosphereRayleighInscattering, uv3Moon).rgb;
    float cosViewMoon = dot(skyDir, atmMoonPosition);
    vec3 skyMoon = (atmMoonHorizonFade * atmMoonHorizonFade) * atmScatteringMoonIntensity * atmMoonLightColor
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

//═══════════════════════════════════════════════════════════════════════════
// THE UNDERWATER CEILING IS NOT PART OF ATMOSPHERIC PERSPECTIVE
//═══════════════════════════════════════════════════════════════════════════
//It used to live inside the `#if($atmospheric_perspective_enabled)` block that
//just closed, purely because it was written next to the sky-radiance helpers.
//The cost of that accident: `atmosphereReady` in ocean-grid.js is
//`atmosphericPerspectiveEnabled && atmosphereFunctionsGLSL`, and the GLSL only
//ever comes from a-starry-sky — so EVERY scene without a sky provider compiled
//a water shader with no underwater branch at all. A submerged camera then ran
//the above-water pipeline, where `cosTheta` (the Schlick dot against the
//force-upward `displacedNormal`) clamps to 0 on every ceiling fragment, pinning
//`fresnelFactor` at its horizon ceiling — so the surface rendered as a pure SSR
//mirror of the seabed. That is what standalone/a-faraway-land scenes were
//showing underwater.
//
//Nothing here needs the atmosphere: `fresnelWaterToAir`,
//`underwaterInscatterSurface` and `applyUnderwaterFog` are all declared above
//this point and outside the gate, and the two RT samplers it reads
//(`underwaterReflectionTexture`, `aboveWaterTransmissionTexture`) are declared
//with the rest of the uniforms. Keep it that way — anything added below that
//reaches for `computeSkyRadiance` or `applyAtmosphericPerspective` puts the
//standalone path straight back into the same hole.

  //Appearance of the water surface seen from below — the "ceiling". The view
  //ray travels up through the water column and strikes the underside of the
  //surface; the water→air Fresnel term splits it between:
  //  - reflection  — total internal reflection past the ~48.6° critical angle
  //                  (and partial before it): the underside mirrors the
  //                  underwater scene via the planar reflection pass.
  //  - transmission— the ray refracts out into the air. refract() bends it
  //                  away from the normal, so as the incidence sweeps
  //                  0°→48.6° the air-side ray sweeps 0°→90° — the whole 180°
  //                  above-water hemisphere folds into the ~97° Snell-window
  //                  cone (zenith straight up, horizon at the cone edge).
  //Foam sits on top, then the camera→ceiling water column is fogged.
  vec3 computeUnderwaterCeiling(vec3 worldPos, vec3 surfaceNormal, vec3 foamColor,
                                float foamBlend, vec2 screenUV,
                                float camToFragDist){
    //Underside normal faces down toward the submerged camera.
    vec3 n = -normalize(surfaceNormal);
    vec3 viewDir = normalize(worldPos - cameraPosition);   //camera → ceiling (up)
    float cosI = max(dot(-viewDir, n), 0.0);               //incidence at the interface

    float reflectance = fresnelWaterToAir(cosI);

    //TRANSMISSION — true Snell refraction water→air (n_water=1.333 → n_air=1.0).
    //refract() with the per-fragment wave normal does double duty: cone
    //compression (whole 180° air hemisphere folds into the ~97° Snell cone,
    //half-angle 48.6°) AND ripple-glass jitter, in one step. The refracted
    //direction is then projected via the transmission camera's matrices
    //(= main scene camera) onto its screen UV to sample the air-side capture.
    //Convention: n points DOWN (toward submerged camera = INTO water from
    //air side), viewDir points UP (camera→ceiling = INTO the surface from
    //water side). refract(I, N, eta) with eta = n_in / n_out = 1.333 then
    //returns the air-side ray bending away from the normal.
    vec3 refracted = refract(viewDir, n, 1.333);
    vec2 refrUV;
    if(dot(refracted, refracted) < 0.0001){
      //TIR — refract() returned zero. Reflectance is 1.0 here so the mix
      //below is pure reflection; the transmitted sample is invisible. Sane
      //fallback for edge-precision pixels just below critical.
      refrUV = screenUV;
    } else {
      //Project a far point along the refracted ray onto the transmission
      //camera's screen. 1km is past the curtain hemisphere; for any
      //refracted direction with a forward component (clip.w > 0) the
      //screen UV samples the right pixel of the air-world capture. Behind-
      //camera tangents fall back to the non-refracted UV.
      vec3 virtualPoint = worldPos + refracted * 1000.0;
      //ssrViewMatrix/ssrProjectionMatrix mirror the scene camera matrices —
      //projectionMatrix/viewMatrix are auto-declared only in vertex shaders,
      //but these uniforms (already used by the SSR path) carry the same data
      //into the fragment shader.
      vec4 clip = ssrProjectionMatrix * ssrViewMatrix * vec4(virtualPoint, 1.0);
      if(clip.w > 0.001){
        refrUV = (clip.xy / clip.w) * 0.5 + 0.5;
      } else {
        refrUV = screenUV;
      }
    }
    refrUV = clamp(refrUV, vec2(0.001), vec2(0.999));
    vec3 transmitted = texture2D(aboveWaterTransmissionTexture, refrUV).rgb;

    //REFLECTION (total internal reflection — Fresnel reflectance climbs to
    //1.0 past the critical angle). Planar mirror: underwater scene rendered
    //from a camera mirrored across the rest water plane (ocean-grid.js
    //_renderUnderwaterReflection). Wave-normal offset ripples the flat-plane
    //mirror with the FFT surface.
    vec4 reflProj = underwaterReflectionMatrix * vec4(worldPos, 1.0);
    vec2 reflUV = reflProj.xy / max(reflProj.w, 0.0001);
    reflUV += n.xz * UNDERWATER_REFLECTION_DISTORTION;
    vec3 reflected = texture2D(underwaterReflectionTexture,
                               clamp(reflUV, vec2(0.001), vec2(0.999))).rgb;

    vec3 ceiling = mix(transmitted, reflected, reflectance);
    //Foam is a near-opaque scattering layer — bright mottling on the ceiling.
    //(foamBlend arrives as 0 while submerged because the foam system is gated off
    //below water — see the underwaterFactor guards on the foam blocks — so this
    //is a no-op underwater, which is the only time this ceiling path runs anyway.)
    ceiling = mix(ceiling, foamColor, foamBlend);
    //Two-stage fog compose for the reflected bounce path:
    //  Stage 1 — chunk on the reflection RT fogs the post-bounce leg
    //            (surface→reflected-fragment) into `reflected` already.
    //  Stage 2 — applyUnderwaterFog here fogs the pre-bounce leg
    //            (cam→ceiling-fragment, all underwater).
    //Total = pre + post = full underwater bounce path. Without this stage
    //the equator of the reflected curtain reads too bright because the
    //chunk's (1-t)·totalLen mirror-branch only counts the post-bounce half,
    //and the gradient between deep-dark and shallow-bright pixels flattens.
    //The Snell-window `transmitted` content is above-water (chunk skipped
    //it) so this is its only underwater fog — also correct.
    vec3 viewDirCeiling = normalize(worldPos - cameraPosition);
    //$DEBUG_START$
    //── BISECTION TAPS (2026-06-06): expose each stage of the ceiling build so we
    //can find WHERE the reflected ceiling goes dark vs the teal direct seabed.
    //Only fire for debug modes 50-55; mode 0 falls straight through to the real
    //return below. Each tap returns a vec3 that flows through the normal
    //MyAES+sRGB output, so the radiance taps (50/51/53/54) read as they'd
    //contribute and the scalar taps (52 reflectance, 55 distance) read as
    //monotonic gray. Walk them in order: if 54 is teal but mode 0 is dark, the
    //fog isn't reaching its equilibrium (check 55 distance → transmittance);
    //if 53 is dark, the dark is upstream in 50/51/52.
    if(oceanShadowDebugMode == 50){ return reflected; }                                  //raw mirror-RT sample (already stage-1 fogged)
    if(oceanShadowDebugMode == 51){ return transmitted; }                                //raw Snell-window (above-water) sample
    if(oceanShadowDebugMode == 52){ return vec3(reflectance); }                          //Fresnel water->air (1 = TIR mirror)
    if(oceanShadowDebugMode == 53){ return ceiling; }                                    //mix(transmitted, reflected) PRE stage-2 fog
    if(oceanShadowDebugMode == 54){ return underwaterInscatterSurface(viewDirCeiling); } //the teal the stage-2 fog fades toward
    if(oceanShadowDebugMode == 55){ return vec3(clamp(camToFragDist / 50.0, 0.0, 1.0)); }//cam->ceiling distance, /50m gray
    //$DEBUG_END$
    return applyUnderwaterFog(ceiling, camToFragDist * UW_DIST_SCALE, viewDirCeiling);
  }

void main(){
  //Shadow factor — once per fragment. 1.0 = fully lit, 0.0 = fully shadowed.
  //sunShadowFactor is computed LATER, after macroNormal is available — the
  //ocean CSM uses a normal-based slope bias to avoid the per-triangle
  //faceting that dFdx/dFdy produces.

  //Use the displaced position from the vertex shader directly — ensures worldPosition
  //matches the actual geometry (vertex shader applies displacementFade; resampling here
  //would skip that, causing LOD tile edge divergence).
  vec3 offsetPosition = vDisplacedPosition;
  vec4 worldPosition = vec4(vWorldPosition, 1.0);
  //Phase 2 per-cascade wave weights (WaveMask), interpolated from the vertex.
  float waveMask0 = vFieldLevelMaskA.y;
  float waveMask1 = vFieldLevelMaskA.z;
  float waveMask2 = vFieldLevelMaskA.w;
  float waveMask3 = vFieldMaskB.x;
  float waveMask4 = vFieldMaskB.y;
  float waveMask5 = vFieldMaskB.z;
  float restWaterLevel = vFieldLevelMaskA.x;
  //Exclusion sample. The half-width comes from TerrainOrthoPass via the
  //const at the top of this file, so it can no longer drift from
  //exclusionCamera's ortho extent. The exclusion target
  //covers only the small layer-30 mask volumes near the camera (boat
  //interior hulls etc.), not the broad terrain — that's foamRenderMap.
  vec2 exclusionPosition = 0.5 * (((worldPosition.xz - exclusionCameraXZ) / vec2(EXCLUSION_ORTHO_HALF_WIDTH)) + 1.0);
  exclusionPosition = vec2(exclusionPosition.x, 1.0 - exclusionPosition.y);
  //Exclusion-map discard. The exclusion render captures layer-30 meshes
  //(boat hulls, etc.) from above — discardHeight is the topmost layer-30
  //Y at this XZ, and we discard water fragments above that height so the
  //water surface doesn't poke through a boat's interior. Only fires above
  //water: when the camera is submerged the same discard would kill the
  //ceiling fragments above the camera (no boat present to hide), so we
  //gate it on `underwaterFactor < 0.5`.
  if(underwaterFactor < 0.5 &&
     exclusionPosition.x < 1.0 && exclusionPosition.x > 0.0 &&
     exclusionPosition.y < 1.0 && exclusionPosition.y > 0.0){
    vec2 discardHeightData = texture2D(exclusionMap, exclusionPosition).ga;
    float discardHeight = discardHeightData.x;
    if((discardHeightData.y > 0.5) && worldPosition.y > discardHeight){
      discard;
    }
  }
  //Phase 2 dry discard: no water where the terrain provider SAYS dry. Sampled
  //at the DISPLACED position, so the cut stays fixed in the world while chop
  //slides the surface across it (sampling vWorldXZ would make the edge crawl).
  //Only a KNOWN dry (dryMask, a-land's answer) discards. A standalone depth of
  //0 is a guess from the foam ortho, which captures EVERYTHING above the water:
  //a pier deck, a boat, an overhanging branch; discarding on it would cut holes
  //under every dock. dryMask is linearly filtered, so > 0.999 means all taps are
  //dry: the cut sits a texel inland of the shoreline, under the terrain, rather
  //than half a texel seaward of it where it would show seabed. Not gated on
  //underwaterFactor: the ceiling has no water over dry land either.
  //
  //Phase 3a swash: EXCEPT inside the band the run-up can reach. There the sheet
  //is a flat surface at rest level plus the swash height, and where the beach is
  //higher than the sheet the depth test hides it, which is what draws the moving
  //waterline. shoreSwashCovers only pays extra taps within ~60 m of a shore.
  vec4 dryTestField = waterFieldAt(worldPosition.xz);
  #if($flowing_water)
    //Phase 4: the bank. a-land stamps a creek as a disc of level per bed cell,
    //so past the last wet texel the ground often lies BELOW the continued
    //level and the terrain cannot hide the cut, which the clipmap relies on.
    //Cut where the jump-flooded shore distance crosses zero: it is seeded half
    //way between wet and dry texel centres and filters smoothly, so the bank
    //runs on a clean line instead of the one-metre texel staircase that any
    //threshold on the (decoded) dry mask draws.
    if(dryTestField.b < 0.0 && flowHandoffDryAt(worldPosition.xz) > 0.0) discard;
    //The vertex stage drops vertices that can never show flowing water below
    //their level. A triangle joining one of those to a kept vertex slopes down
    //through the air as a wall, so cut anything far under the level — far enough
    //to clear the bank taper above (BANK_TAPER_MAX), which is a real part of the
    //surface, while still catching the 30 m drop of a culled vertex.
    if(worldPosition.y < dryTestField.r - 4.0) discard;
  #else
  //Browser round 7: also cut on the shore line itself, as the flowing surface does
  //(see its bank cut above). dryMask > 0.999 lands a texel inland of the shore, and
  //wherever the rendered terrain sits a little below the level there (coarse terrain
  //LODs, a solve cell that rounded dry) that texel of flat water showed as a sheet
  //hanging over the bank. shoreSDF crosses zero half way between the last wet and
  //first dry texel centres, and only a KNOWN dry tap (a-land's answer) may cut.
  bool dryByShoreLine = dryTestField.b < 0.0 && flowHandoffDryAt(worldPosition.xz) > 0.0;
  if((dryTestField.a > 0.999 || dryByShoreLine) && !shoreSwashCovers(worldPosition.xz, dryTestField)){
    discard;
  }
  //Phase 4 browser round 7: no triangle that BRIDGES two water levels. A dry texel
  //takes the level of its nearest water (WaterFieldPass's compose), so where two
  //bodies meet under dry ground (a beach between the sea and a creek or lagoon
  //behind it) the level steps. A coarse clipmap cell with one vertex on either side
  //of that step is a thin wall metres tall, and the swash exception above kept it
  //on the beach: the spikes seen from ~400 m that shrank away on approach as the
  //cells got finer. The level this fragment interpolated from its vertices must be
  //the level of the place it lands on. Flowing water (a < -0.5) is exempt: a creek
  //the clipmap still draws beyond the flowing window really is sloped.
  if(dryTestField.a > -0.5 && abs(vFieldLevelMaskA.x - dryTestField.r) > 1.0){
    discard;
  }
  #endif
  //Phase 4: flowing water belongs to FlowSurfacePass. Across the hand-off band
  //(WaterFieldPass blurs the weight over ~8 m) the two surfaces ALPHA cross-fade:
  //this surface draws wherever the water is not fully flowing, its waves already
  //flattened by 1 - w in the vertex stage, and the flowing surface is a transparent
  //layer over it with alpha = w. It used to dither the two against a blue-noise
  //threshold; over a band several metres wide that read as speckle between two
  //different models (browser round 6). Sampled at the displaced position, like the
  //dry discard above. 0 when no flowing surface exists, so creeks stay here then.
  float flowHandoffW = flowHandoffWeightAt(worldPosition.xz);
  #if($flowing_water)
    if(flowHandoffW <= 0.002) discard;
    float flowHandoffAlpha = flowHandoffW;
    //THIN WATER IS NOT A SURFACE (Phase 4 close-out, the simplest form of the River
    //Editor's thickness-dependent scattering). island-sholes creeks are 5-20 cm deep
    //over a 1 m height grid with +-0.4 m of material displacement, and the bank taper
    //in the vertex stage slides the sheet onto its bed on purpose, so wherever the
    //water is a few centimetres thick the sheet and the terrain are coincident. That
    //is the z-fighting and the holes of browser round 10. Real water that thin shows
    //the bed, not a surface: fade the sheet out below FLOW_FADE_FULL_M and drop it
    //entirely below FLOW_FADE_MIN_M, which also keeps it out of the depth buffer.
    //Thickness is what the depth buffer sees, not a-land's solve depth: this surface
    //minus the ground the refraction G-buffer holds under the SAME pixel (undistorted,
    //so a bank behind the water cannot stand in for the bed). Measured from the 32-bit
    //depth texture, not the half-float linear depth, whose steps are 3 cm by 50 m.
    //Positive where the ground is under the sheet, negative where the polygon offset
    //pulled the sheet in front of ground that is really above it.
    const float FLOW_FADE_MIN_M = 0.03;
    const float FLOW_FADE_FULL_M = 0.10;
    float flowSheetThickness = 1000.0;
    float flowThicknessAlpha = 1.0;
    if(underwaterFactor < 0.5){
      vec2 flowGroundUV = gl_FragCoord.xy / screenResolution;
      float flowGroundRaw = texture2D(refractionDepthTexture, flowGroundUV).r;
      //1.0 is the clear: no ground under this pixel, so the column is deep.
      if(flowGroundRaw < 1.0){
        vec4 flowGroundView = inverseProjectionMatrix * vec4(flowGroundUV * 2.0 - 1.0, flowGroundRaw * 2.0 - 1.0, 1.0);
        flowGroundView /= flowGroundView.w;
        flowSheetThickness = worldPosition.y - (inverseViewMatrix * flowGroundView).y;
        flowThicknessAlpha = smoothstep(FLOW_FADE_MIN_M, FLOW_FADE_FULL_M, flowSheetThickness);
      }
    }
    //$DEBUG_START$
    if(oceanShadowDebugMode == 66) flowThicknessAlpha = max(flowThicknessAlpha, 0.01);
    //$DEBUG_END$
    if(flowThicknessAlpha <= 0.002) discard;
    //Phase 6: inside a fall's corridor, where the LEVEL is steep, the waterfall sheet is
    //the surface and this one steps aside. Gated on the level slope (tan 10 to 20 degrees,
    //over a 0.75 m stencil) rather than the whole corridor, so the flat plunge pool the
    //sheet dives into, and any ledge pool between steps, stay here and depth-clip it.
    float flowFallCorridor = fallCorridorWeight(worldPosition.xz);
    float flowFallOwn = 0.0;
    if(flowFallCorridor > 0.0){
      const float FALL_EPS = 0.75;
      float fxm = waterFieldAt(worldPosition.xz - vec2(FALL_EPS, 0.0)).r;
      float fxp = waterFieldAt(worldPosition.xz + vec2(FALL_EPS, 0.0)).r;
      float fzm = waterFieldAt(worldPosition.xz - vec2(0.0, FALL_EPS)).r;
      float fzp = waterFieldAt(worldPosition.xz + vec2(0.0, FALL_EPS)).r;
      float fallLevelSlope = length(vec2(fxp - fxm, fzp - fzm)) / (2.0 * FALL_EPS);
      flowFallOwn = flowFallCorridor * smoothstep(0.176, 0.364, fallLevelSlope);
    }
    if(flowFallOwn >= 0.998) discard;
  #else
    if(flowHandoffW >= 0.998) discard;
  #endif
  //Phase 3a: a ripple floor for the two smallest cascades in very shallow water and
  //on the swash sheet (normals only; the geometry is untouched).
  //WaveMask weighs a whole cascade by its LONGEST wavelength, so in a few
  //centimetres of water C4/C5 go to ~0. Over dry texels that the swash covers, the
  //weights are exactly 0 (dry). The sheet was then a perfect mirror, and the wide
  //Phong sun lobe drew a soft round blob on it (browser round 4). Real swash and
  //shallow water are never glassy: the short ripples and the bore turbulence are
  //local, not depth-limited swell.
  if(shoreBreakerEnabled > 0.5){
    const float SHALLOW_RIPPLE_FLOOR = 0.5;
    float shallowRipple = SHALLOW_RIPPLE_FLOOR * (dryTestField.a > 0.5 ? 1.0 : 1.0 - smoothstep(0.3, 1.5, dryTestField.g));
    waveMask4 = max(waveMask4, shallowRipple);
    waveMask5 = max(waveMask5, shallowRipple);
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
  //Cascade 5 height-slope contribution to rawDdx/rawDdz saved separately so
  //the spec-normal block can subtract its 1-texel-eps version and add back a
  //wide-eps low-pass version (option 2 — sub-pixel sampling correlation for
  //the Beckmann lobe without disturbing displacedNormal).
  vec2 c5NativeHeightSlope = vec2(0.0);
  #if(!$flowing_water)
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[0] / patchDataSize;
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0];
    vec3 rawL = texture(cascadeDisplacementArray, vec3(uv + vec2(-eps,  0.0), 0.0)).xyz;
    vec3 rawR = texture(cascadeDisplacementArray, vec3(uv + vec2( eps,  0.0), 0.0)).xyz;
    vec3 rawB = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0, -eps), 0.0)).xyz;
    vec3 rawT = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0,  eps), 0.0)).xyz;
    rawDdx += waveMask0 * (rawR - rawL) / (2.0 * worldStep);
    rawDdz += waveMask0 * (rawT - rawB) / (2.0 * worldStep);
    cascade0HeightSlope = vec2(rawDdx.y, rawDdz.y);
  }
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[1] / patchDataSize;
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1];
    vec3 rawL = texture(cascadeDisplacementArray, vec3(uv + vec2(-eps,  0.0), 1.0)).xyz;
    vec3 rawR = texture(cascadeDisplacementArray, vec3(uv + vec2( eps,  0.0), 1.0)).xyz;
    vec3 rawB = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0, -eps), 1.0)).xyz;
    vec3 rawT = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0,  eps), 1.0)).xyz;
    rawDdx += waveMask1 * (rawR - rawL) / (2.0 * worldStep);
    rawDdz += waveMask1 * (rawT - rawB) / (2.0 * worldStep);
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
    //Phase 2: a masked cascade is ABSENT, not lost to distance, so the mask
    //scales the resolved slope and the lost variance alike.
    float waveMask = waveMask2;
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2];
    vec3 rawL = texture(cascadeDisplacementArray, vec3(uv + vec2(-eps,  0.0), 2.0)).xyz;
    vec3 rawR = texture(cascadeDisplacementArray, vec3(uv + vec2( eps,  0.0), 2.0)).xyz;
    vec3 rawB = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0, -eps), 2.0)).xyz;
    vec3 rawT = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0,  eps), 2.0)).xyz;
    vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);
    vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);
    rawDdx += waveMask * fade * cDdx;
    rawDdz += waveMask * fade * cDdz;
    float oneMinusFade = waveMask * (1.0 - fade);
    lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);
  }
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[3] / patchDataSize;
    float fade = smoothstep(cascadePatchSizes[3] * 100.0, 0.0, distanceToWorldPosition);
    //Phase 2: a masked cascade is ABSENT, not lost to distance, so the mask
    //scales the resolved slope and the lost variance alike.
    float waveMask = waveMask3;
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3];
    vec3 rawL = texture(cascadeDisplacementArray, vec3(uv + vec2(-eps,  0.0), 3.0)).xyz;
    vec3 rawR = texture(cascadeDisplacementArray, vec3(uv + vec2( eps,  0.0), 3.0)).xyz;
    vec3 rawB = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0, -eps), 3.0)).xyz;
    vec3 rawT = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0,  eps), 3.0)).xyz;
    vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);
    vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);
    rawDdx += waveMask * fade * cDdx;
    rawDdz += waveMask * fade * cDdz;
    float oneMinusFade = waveMask * (1.0 - fade);
    lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);
  }
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[4] / patchDataSize;
    float fade = smoothstep(cascadePatchSizes[4] * 250.0, 0.0, distanceToWorldPosition);
    //Phase 2: a masked cascade is ABSENT, not lost to distance, so the mask
    //scales the resolved slope and the lost variance alike.
    float waveMask = waveMask4;
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4];
    vec3 rawL = texture(cascadeDisplacementArray, vec3(uv + vec2(-eps,  0.0), 4.0)).xyz;
    vec3 rawR = texture(cascadeDisplacementArray, vec3(uv + vec2( eps,  0.0), 4.0)).xyz;
    vec3 rawB = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0, -eps), 4.0)).xyz;
    vec3 rawT = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0,  eps), 4.0)).xyz;
    vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);
    vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);
    rawDdx += waveMask * fade * cDdx;
    rawDdz += waveMask * fade * cDdz;
    float oneMinusFade = waveMask * (1.0 - fade);
    lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);
  }
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[5] / patchDataSize;
    float fade = smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToWorldPosition);
    //Phase 2: a masked cascade is ABSENT, not lost to distance, so the mask
    //scales the resolved slope and the lost variance alike.
    float waveMask = waveMask5;
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5];
    vec3 rawL = texture(cascadeDisplacementArray, vec3(uv + vec2(-eps,  0.0), 5.0)).xyz;
    vec3 rawR = texture(cascadeDisplacementArray, vec3(uv + vec2( eps,  0.0), 5.0)).xyz;
    vec3 rawB = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0, -eps), 5.0)).xyz;
    vec3 rawT = texture(cascadeDisplacementArray, vec3(uv + vec2( 0.0,  eps), 5.0)).xyz;
    vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);
    vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);
    rawDdx += waveMask * fade * cDdx;
    rawDdz += waveMask * fade * cDdz;
    //Save cascade 5's height-slope contribution (with the same fade, pre
    //waveHeightMultiplier) so specNormal can swap it for a low-pass version.
    c5NativeHeightSlope = vec2(waveMask * fade * cDdx.y, waveMask * fade * cDdz.y);
    float oneMinusFade = waveMask * (1.0 - fade);
    lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);
  }
  #else
  //Phase 4 flowing water (FlowSurfacePass): no FFT here. This surface IS the
  //field level, which falls along the channel, so a creek is lit as sloping
  //water. Central differences over 1.5 m either side: a-land steps the level
  //down the bed one metre at a time, and a one-texel stencil would facet every
  //step. Stored pre-multiplier, like the cascade slopes it replaces.
  {
    const float LEVEL_EPS = 1.5;
    float lxm = waterFieldAt(vWorldXZ - vec2(LEVEL_EPS, 0.0)).r;
    float lxp = waterFieldAt(vWorldXZ + vec2(LEVEL_EPS, 0.0)).r;
    float lzm = waterFieldAt(vWorldXZ - vec2(0.0, LEVEL_EPS)).r;
    float lzp = waterFieldAt(vWorldXZ + vec2(0.0, LEVEL_EPS)).r;
    vec2 levelSlope = vec2(lxp - lxm, lzp - lzm) / (2.0 * LEVEL_EPS) / max(waveHeightMultiplier, 0.0001);
    rawDdx.y = levelSlope.x;
    rawDdz.y = levelSlope.y;
    cascade0HeightSlope = levelSlope;
  }
  //Phase 4 stand-in for falls, now only OUTSIDE Phase 6 corridors. Where the level drops faster than tan 30 degrees the
  //sheet is a waterfall stretched over its step, which this heightfield cannot draw
  //(the lumpy glass sheets of the browser rounds). Until Phase 6 gives falls their
  //own geometry, such cells are all whitewater: full foam and a rough surface. It is
  //the same onset as FlowFoamPass step foam, but not gated on speed or its window.
  float flowFallSheet = smoothstep(0.577, 1.0, length(cascade0HeightSlope) * waveHeightMultiplier);
  //Phase 6: inside a fall's corridor the waterfall sheet draws the fall, so this stand-in
  //stays for the small bed steps a-land does not export as falls.
  flowFallSheet *= 1.0 - flowFallCorridor;
  //The current, foam and energy here (FlowFoamPass), read once for the waves below and
  //for the foam further down. Zero outside the pass window.
  vec4 flowFoamSample = vec4(0.0);
  float flowFoamInside = 0.0;
  if(flowFoamWindow.z > 0.0){
    vec2 ffOffset = abs(vWorldXZ - flowFoamWindow.xy);
    float ffEdge = max(ffOffset.x, ffOffset.y);
    flowFoamInside = 1.0 - smoothstep(0.9 * flowFoamWindow.z, flowFoamWindow.z, ffEdge);
    if(flowFoamInside > 0.0){
      flowFoamSample = texture2D(flowFoamMap, (vWorldXZ - flowFoamWindow.xy) / (2.0 * flowFoamWindow.z) + 0.5);
    }
  }
  vec2 flowVelocity = flowFoamSample.gb * flowFoamInside;
  float flowSpeed = length(flowVelocity);

  //── Phase 4 step 4: small waves on flowing water ─────────────────────────
  //RIPPLES. Water moving over a bed is never a mirror: turbulence roughens its
  //surface with capillary-gravity ripples. FlowSurfacePass keeps one periodic 1D
  //profile of that spectrum (see its header: equal slope per octave, lambda 4 m to
  //4 cm, dispersion with surface tension, animated). Sixteen directions of it, each
  //stretched by a different incommensurate factor so the 8 m period never lines
  //up, are summed here, and advected WITH the current by the same two-phase trick
  //as the foam grain (two layers half a period apart, each weighted to zero at its
  //own reset), so ripples ride the stream without the shear smearing them out.
  //Only normals: at creek scale the heights are millimetres to centimetres, far
  //below the 1-2 m mesh, so the geometry and the CPU buoyancy twin are untouched.
  //RMS slope rises with a-land's Froude-derived energy (decision 3: energy drives
  //roughness) and fades in with speed. Outside the pass window the current is
  //unknown: gentle ripples, not advected. The slope constants are look choices
  //inside the physical range (river surfaces measure roughly 0.05-0.2).
  const float FLOW_RIPPLE_SLOPE_CALM = 0.035;
  const float FLOW_RIPPLE_SLOPE_TURBULENT = 0.13;
  float flowEnergy = mix(0.25, flowFoamSample.a, flowFoamInside);
  float rippleGate = mix(1.0, smoothstep(0.05, 0.6, flowSpeed), flowFoamInside);
  //NEVER A MIRROR. The energy and the speed gate can both collapse on the same texel —
  //a slack pool, or one of the stagnation points the foam pass's SMOOTHED velocity field
  //has — and at browser round 7c, the bubble Dante found, the two together left an rms slope of
  //0.027, well under the 0.05-0.2 real river surfaces measure. A near-mirror holds the
  //sun's Phong lobe together, and it drew a soft round blob on the creek (debug 22).
  //Bed turbulence and the lightest wind roughen a stream everywhere, so the floor is the
  //low end of that measured range: it is physical, and it is the flowing twin of
  //SHALLOW_RIPPLE_FLOOR on the swash sheet.
  const float FLOW_RIPPLE_SLOPE_MIN = 0.05;
  float rippleSlope = max(FLOW_RIPPLE_SLOPE_MIN * flowFoamInside,
                          (FLOW_RIPPLE_SLOPE_CALM + FLOW_RIPPLE_SLOPE_TURBULENT * flowEnergy) * rippleGate) * flowRippleScale;
  const float RIPPLE_ADVECT_PERIOD = 2.0;
  float rippleA = fract(t / RIPPLE_ADVECT_PERIOD);
  float rippleB = fract(rippleA + 0.5);
  float rippleMix = abs(1.0 - 2.0 * rippleA);
  vec2 xa = vWorldXZ - flowVelocity * rippleA * RIPPLE_ADVECT_PERIOD;
  vec2 xb = vWorldXZ - flowVelocity * rippleB * RIPPLE_ADVECT_PERIOD + vec2(3.7, 1.9);
  //Sixteen directions, each with its own smooth amplitude field in space (the
  //amplitude function of the wavelet method): a single profile per direction is an
  //endless set of straight crests, and a handful of those sum into a visible
  //crosshatch. Letting each direction come and go in patches a few metres across
  //breaks the crests into the short, shifting ripple cells real streams show.
  //E[amp²] of 0.3 + 0.7·noise is about 0.55; the normalization uses that expectation
  //rather than the local sum, so the patches keep their contrast.
  vec2 rippleSlopeVec = vec2(0.0);
  float rippleScaleSq = 0.0;
  for(int d = 0; d < 16; d++){
    float fd = float(d);
    float ang = (fd + 0.5) * 0.19634954 + 0.09 * sin(fd * 2.39);
    vec2 dir = vec2(cos(ang), sin(ang));
    float stretch = 1.0 + 0.071 * fd;
    float off = fract(sin(fd * 12.9898) * 43758.5453);
    float amp = 0.3 + 0.7 * flowValueNoise(xa * 0.21 + vec2(fd * 7.13, fd * 3.37));
    float sa = texture2D(flowWaveProfile, vec2(dot(xa, dir) * stretch / FLOW_WAVE_PERIOD + off, 0.5)).g;
    float sb = texture2D(flowWaveProfile, vec2(dot(xb, dir) * stretch / FLOW_WAVE_PERIOD + off, 0.5)).g;
    rippleSlopeVec += dir * mix(sa, sb, rippleMix) * stretch * amp;
    rippleScaleSq += stretch * stretch;
  }
  //Unit RMS slope per direction, summed; renormalize to one, then scale.
  rippleSlopeVec *= rippleSlope * inversesqrt(0.5 * 0.55 * rippleScaleSq);
  //The part of that slope variance the mips averaged away at this pixel. Levels lost
  //= log2(texels per pixel); the buffer holds wave i = 2..200 (of an 8 m period) at
  //equal slope per octave, and a mip level L resolves waves up to i = 512 / 2^L.
  float rippleTexelsPerPixel = length(fwidth(vWorldXZ)) * 1.5 / FLOW_WAVE_PERIOD * 1024.0;
  float rippleResolvedI = clamp(512.0 / max(rippleTexelsPerPixel, 1.0), 2.0, 200.0);
  float flowRippleLostVar = rippleSlope * rippleSlope * (log(200.0) - log(rippleResolvedI)) / log(100.0);

  //STANDING WAVES. In a fast shallow reach the wave that holds still in the world
  //is the one whose phase speed equals the current: deep-water c = sqrt(g/k) = |v|
  //gives k = g/|v|^2, crests facing upstream. Across Froude 1 the flow throws them
  //up as an undular jump, height roughly (Fr - 1) times the depth, capped by
  //McCowan at 0.78 of the depth; they give way to broken whitewater by Fr ~ 4.
  //They form over bed features, not as ruled lines down a whole reach, so a
  //smooth noise keyed along and across the flow breaks them into patches (look
  //choice). Only where the wavelength is resolvable, 0.3 to 8 m.
  if(flowFoamInside > 0.0 && flowSpeed > 0.3){
    float swDepth = max(waterFieldAt(vWorldXZ).g, 0.02);
    float froude = flowSpeed / sqrt(9.81 * swDepth);
    float ksw = 9.81 / (flowSpeed * flowSpeed);
    float lambdaSw = 6.2831853 / ksw;
    float swGate = smoothstep(0.9, 1.3, froude) * (1.0 - smoothstep(3.0, 4.5, froude))
                 * smoothstep(0.3, 0.6, lambdaSw) * (1.0 - smoothstep(6.0, 9.0, lambdaSw));
    if(swGate > 0.0){
      vec2 vdir = flowVelocity / flowSpeed;
      float along = dot(vWorldXZ, vdir);
      float across = dot(vWorldXZ, vec2(-vdir.y, vdir.x));
      float swPatch = smoothstep(0.35, 0.8, flowValueNoise(vec2(along * 0.07, across * 0.12)));
      float swHeight = min(0.78, froude - 1.0) * swDepth;
      float swAmp = 0.5 * max(swHeight, 0.0) * swGate * swPatch * flowRippleScale;
      rippleSlopeVec += -vdir * swAmp * ksw * sin(ksw * along);
    }
  }
  rawDdx.y += rippleSlopeVec.x / max(waveHeightMultiplier, 0.0001);
  rawDdz.y += rippleSlopeVec.y / max(waveHeightMultiplier, 0.0001);
  #endif
  rawDdx *= waveHeightMultiplier;
  rawDdz *= waveHeightMultiplier;
  c5NativeHeightSlope *= waveHeightMultiplier;
  lostSlopeVar *= waveHeightMultiplier * waveHeightMultiplier;

  //── Phase 3a: shore breakers (ShoreBreaker) ─────────────────────────────
  //The vertex stage lifts the geometry; here the same function is evaluated at
  //this fragment and at two half-metre neighbours for its slope, so the breaker
  //faces light correctly and the foam lands on the breaking front. Not faded by
  //distance like the geometry: normals and foam are per pixel, so a far coast
  //still shows its white lines. One-sided differences reuse the three field taps
  //for the shore normal as well.
  float breakerEta = 0.0;
  float breakerFoam = 0.0;
  float breakerBreaking = 0.0;
  float breakerXi = 0.0;
  float swashFoam = 0.0;
  float swashReach = -1.0;
  vec2 breakerSlope = vec2(0.0);
  {
    vec4 bField = waterFieldAt(vWorldXZ);
    bool bBreakerOn = shoreBreakerActive(bField);
    bool bSwashOn = shoreSwashActive(bField);
    if(bBreakerOn || bSwashOn){
      const float BREAKER_EPS = 0.5;
      vec4 bFieldX = waterFieldAt(vWorldXZ + vec2(BREAKER_EPS, 0.0));
      vec4 bFieldZ = waterFieldAt(vWorldXZ + vec2(0.0, BREAKER_EPS));
      //Shore normal from the smooth 4 m field (see ShoreBreaker.NORMAL_STEP).
      //xy: shore-distance gradient (normal), zw: depth gradient (phase consistency).
      vec4 bGrad = shoreBreakerSmoothGrad(vWorldXZ);
      float unusedFoam;
      float unusedBreaking;
      float unusedXi;
      float unusedReach;
      vec4 bPhase = shoreBreakerPhaseField(vWorldXZ);
      vec4 bPhaseX = shoreBreakerPhaseField(vWorldXZ + vec2(BREAKER_EPS, 0.0));
      vec4 bPhaseZ = shoreBreakerPhaseField(vWorldXZ + vec2(0.0, BREAKER_EPS));
      float breakerEtaX = 0.0;
      float breakerEtaZ = 0.0;
      if(bBreakerOn){
        breakerEta = shoreBreakerEval(vWorldXZ, bField, bPhase, bGrad, breakerFoam, breakerBreaking, breakerXi);
        breakerEtaX = shoreBreakerEval(vWorldXZ + vec2(BREAKER_EPS, 0.0), bFieldX, bPhaseX, bGrad, unusedFoam, unusedBreaking, unusedXi);
        breakerEtaZ = shoreBreakerEval(vWorldXZ + vec2(0.0, BREAKER_EPS), bFieldZ, bPhaseZ, bGrad, unusedFoam, unusedBreaking, unusedXi);
      }
      //The swash sheet rides the same slope and normal path as the breaker.
      if(bSwashOn){
        breakerEta += shoreSwashEval(vWorldXZ, bField, bPhase, bGrad, swashReach, swashFoam);
        breakerEtaX += shoreSwashEval(vWorldXZ + vec2(BREAKER_EPS, 0.0), bFieldX, bPhaseX, bGrad, unusedReach, unusedFoam);
        breakerEtaZ += shoreSwashEval(vWorldXZ + vec2(0.0, BREAKER_EPS), bFieldZ, bPhaseZ, bGrad, unusedReach, unusedFoam);
      }
      breakerSlope = vec2(breakerEtaX - breakerEta, breakerEtaZ - breakerEta) / BREAKER_EPS;
    }
  }
  //── Phase 3b: the shore's reflected wave (ShoreReflection) ───────────────
  //Its slope from the state texture one cell either side: there are no spare
  //varyings to carry it down from the vertex.
  vec2 reflectionSlope = shoreReflectionSlopeAt(vWorldXZ);
  breakerSlope += reflectionSlope;
  rawDdx.y += breakerSlope.x;
  rawDdz.y += breakerSlope.y;
  //macroSlope below re-applies waveHeightMultiplier to cascade 0's slope; the
  //breaker slope is already in metres per metre, so divide it back out. The
  //breaker is the swell near a shore, which is exactly what the macro normal
  //(specular orientation) is meant to follow.
  cascade0HeightSlope += breakerSlope / max(waveHeightMultiplier, 0.0001);

  //Jacobian: detect surface folds — still used for inscatter modulation and normal blending
  vec2 foamDdx = -chop * rawDdx.xz;
  vec2 foamDdz = -chop * rawDdz.xz;
  float jacobian = (1.0 + foamDdx.x) * (1.0 + foamDdz.y) - foamDdx.y * foamDdz.x;
  float turbulence = max(0.0, 1.0 - jacobian);

  //── Foam from the per-fragment combined fold (RESTORED 2026-05-31) ────────
  //Validated path (the bingo state): foam = the summed fold of ALL six cascades
  //at the real displaced surface (`turbulence` ~line 1212, full per-fragment
  //resolution), thresholded so only steep / near-breaking water fires. It tracks
  //every visible crest because the crest IS the constructive sum of all cascades,
  //which is exactly what `turbulence` measures.
  //
  //DO NOT route this back through the world-locked broadband foam RT: that pass
  //can only sample a SUBSET of cascades (a 64-256 m tile cannot represent the
  //256-4096 m swell bands), so its fold decorrelates from the all-cascade crest
  //and foam scatters into random splotches that miss the real crests. Persistence
  //(the trailing wake) and live longevity need a CAMERA-following foam history
  //buffer, not the world tile RT — see the broadband-foam memory for the plan.
  //FOAM_TURB_THRESHOLD: lower = more foam (gentler folds fire). GAIN: ramp speed.
  const float FOAM_TURB_THRESHOLD = 0.5;
  const float FOAM_TURB_GAIN      = 4.0;
  //foamWindBias is the wind-driven Jacobian dip: it lifts the fold signal as the
  //sea roughens so gentler folds cross the threshold, and once it exceeds
  //THRESHOLD the flat open surface itself foams (storm streaks). 0 in calm seas,
  //so the validated calm-water behaviour above is unchanged.
  float fftFoamAmount = clamp((turbulence + foamWindBias - FOAM_TURB_THRESHOLD) * FOAM_TURB_GAIN, 0.0, 1.0);

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
  #if($flowing_water)
    //The flowing surface casts no ocean CSM shadow and has no waves to
    //self-shadow; the clipmap caster under it is flattened to this very level,
    //so sampling the CSM here would only shadow the surface with itself.
    float oceanShadowRaw = 1.0;
  #else
    float oceanShadowRaw = getOceanShadow(vOceanShadowCoord0, vOceanShadowCoord1, vOceanShadowCoord2, vOceanShadowCoord3, macroNormal, sunDirToSky);
  #endif
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
  //Weight of the second foam layer. 0.5 on the ocean: the plain average of two
  //differently oriented tiles, which breaks up the repeat.
  float foamLayerMix = 0.5;
  #if($flowing_water)
    //Phase 4: two-phase flow-map advection (Vlachos, Portal 2). Both layers
    //scroll WITH the current, each resetting once per period, half a period
    //apart; each is weighted to zero exactly at its own reset, so the texture
    //moves at the water speed without ever stretching past half a period of
    //travel. The foam COVERAGE is advected for real by FlowFoamPass; these
    //layers only carry the bubble grain along with it.
    //(flowFoamSample, flowFoamInside and flowVelocity are read with the normals above.)
    const float FLOW_PHASE_PERIOD = 1.0;
    float flowPhaseA = fract(t / FLOW_PHASE_PERIOD);
    float flowPhaseB = fract(flowPhaseA + 0.5);
    foamTextureUV  = (worldPosition.xz - flowVelocity * flowPhaseA * FLOW_PHASE_PERIOD) / 2.0;
    foamTextureUV2 = (worldPosition.xz - flowVelocity * flowPhaseB * FLOW_PHASE_PERIOD) / 2.0 + vec2(0.37, 0.61);
    foamLayerMix = abs(1.0 - 2.0 * flowPhaseA);
  #endif

  #if($foam_enabled)
    //Foam is a top-surface effect, so the WHOLE foam system is gated off when the
    //camera is submerged. This is a uniform branch on underwaterFactor (same value
    //for every fragment), so the foam-map fetch + shore boost here AND the foam
    //texture sampling + Lambert lighting further down drop out wholesale for the
    //underwater pass — freeing budget for spray/mist. Above water: unchanged.
    float foamAmount = 0.0;
    if(underwaterFactor < 0.5){
    //fftFoamAmount is now the broadband foam RT sample — it already includes
    //Crest-style accumulation + wind advection + dt-scaled decay, so no live
    //turbulence boost is needed. The shore branch still adds its turbulence-
    //driven boost on top for the breaker-line near terrain.
    #if($flowing_water)
    //Phase 4: the flowing surface's foam is FlowFoamPass's accumulated coverage.
    foamAmount = max(flowFoamInside * flowFoamSample.r, flowFallSheet);
    #else
    foamAmount = fftFoamAmount;
    //Phase 3a: foam on the breaking front and the bore behind it, scaled by the
    //dissipated fraction 1 - Kr^2 (see ShoreBreaker). Replaces the shoreFade
    //heuristic below whenever breakers are on; the heuristic stays as the
    //fallback for standalone scenes, where breakers are off.
    foamAmount = max(foamAmount, max(breakerFoam, swashFoam));
    vec2 foamPosition = 0.5 * (((worldPosition.xz - foamCameraXZ) / vec2(FOAM_ORTHO_HALF_WIDTH)) + 1.0);
    foamPosition = vec2(foamPosition.x, 1.0 - foamPosition.y);
    if(shoreBreakerEnabled < 0.5 && foamPosition.x < 1.0 && foamPosition.x > 0.0 && foamPosition.y < 1.0 && foamPosition.y > 0.0){
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
    #endif
    } //end if(underwaterFactor < 0.5) — foam system off below the surface
  #else
    float foamAmount = 0.0;
  #endif

  vec3 normalizedViewVector = normalize(worldPosition.xyz - cameraPosition);
  vec2 screenUV = gl_FragCoord.xy / screenResolution;

  //Screen-space reflection: reflect the view ray off the displaced water normal and
  //ray-march against the refraction depth buffer (already rendered this frame, free).
  //Correctly samples sky/atmosphere at the horizon — no planar camera terrain capture.
  vec3 worldIncidentDir = normalize(worldPosition.xyz - cameraPosition);
  //BOTH SSR DIRECTIONS COME OFF A BLEND, and both default to full wave detail.
  //
  //This pass spent its whole life reflecting off `macroNormal` — cascade 0 only,
  //i.e. the long swell with every ripple filtered out. The comment that used to
  //sit here justified it as avoiding "high-frequency per-pixel noise", and that
  //concern is real for the MARCH (see below) — but it was written before the
  //blue-noise step jitter and the soft convergence/silhouette gates went in, and
  //it was applied to the sky lookup too, where it has no upside at all. The
  //visible cost was a reflection that behaves like a mirror on a flat plane: a
  //reflected shoreline whose silhouette slides around as one rigid shape while
  //the water under it is visibly rippling.
  //
  //The two directions are kept separate because their failure modes are
  //opposite. Too much detail in the MARCH scatters neighbouring fragments into
  //different depth footprints and the geometry reflection breaks into noise or
  //stripes. Too little in EITHER is the flat mirror. Blend each independently
  //(window.setSsrMarchNormalBlend / setSsrSkyNormalBlend) — 0 on both reproduces
  //the original behaviour exactly for an A/B.
  //
  //displacedNormal rather than specNormal only because specNormal is not built
  //until much further down this function. specNormal is the better target — its
  //cascade-5 wide-eps low-pass exists precisely to kill far-field sparkle — and
  //moving the SSR call below it is the fix if the horizon reads noisy, in
  //preference to dialing these back down.
  vec3 ssrMarchNormal   = normalize(mix(macroNormal, displacedNormal, ssrMarchNormalBlend));
  vec3 ssrReflectDir    = reflect(worldIncidentDir, ssrMarchNormal);
  vec3 ssrSkyNormal     = normalize(mix(macroNormal, displacedNormal, ssrSkyNormalBlend));
  vec3 ssrSkyDir        = reflect(worldIncidentDir, ssrSkyNormal);
  //screenSpaceReflection() always returns LINEAR values (see function comment).
  //
  //SKIPPED WHEN SUBMERGED. Everything this feeds is overwritten wholesale by
  //computeUnderwaterCeiling below, so the 48-step march is pure waste on every
  //underwater frame. It is also the thing a submerged camera used to actually
  //SEE while the ceiling model was gated off behind atmospheric perspective:
  //the above-water Fresnel pins at its horizon ceiling below the surface (see
  //cosTheta), which made totalLight almost purely this term — a screen-space
  //mirror of the seabed, marched from under it. `underwaterFactor` is a uniform,
  //so this branch is fully coherent across the draw.
  vec3 reflectedLight   = (underwaterFactor >= 0.5)
                        ? vec3(0.0)
                        : screenSpaceReflection(worldPosition.xyz, ssrReflectDir, ssrSkyDir);

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

  //Phase 3a swash: bubbles where the sheet is thin (the leading edge of the uprush
  //and the draining film). Thickness is measured against the refraction G-buffer's
  //own ground point, per pixel. It used to use the foam ortho's terrain height,
  //which is ~4 m per texel and follows the camera, so on a gentle beach the 25 cm
  //band became metre-wide white steps that grew as the camera rose (browser
  //round 4). Along the refracted ray rather than straight down, which is close
  //enough on a sheet this thin.
  #if($foam_enabled)
    if(underwaterFactor < 0.5 && shoreBreakerEnabled > 0.5 && swashReach > 0.0 && refractionDepthLinear < cameraNearFar.y * 0.99){
      float sheetThickness = worldPosition.y - pointXYZ.y;
      foamAmount = max(foamAmount, 0.8 * shoreBreakerFoamGain * (1.0 - smoothstep(0.0, 0.25, sheetThickness)));
    }
  #endif

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
  //Body-colour inscatter equilibrium is now produced by
  //`underwaterInscatterSurface(viewDir)` at the blend site below — the same
  //HG-phased single-scatter model that the chunk fog and the underwater
  //ceiling fog use. The old `waterAlbedo · Edown / π` Lambertian form lived
  //here; it was a surface-reflectance approximation that disagreed with the
  //volumetric inscatter the chunk fades to. One source now, three callers.

  //Fresnel with a distance-driven roughness clamp on the grazing peak.
  //
  //Plain Schlick on the macro normal would tell us that distant water at
  //grazing angle is a near-perfect mirror of the sky. Real ocean isn't:
  //you see the SIDES of waves at grazing, not their sky-facing tops, and
  //the microfacets that WOULD reflect the horizon sky are masked by their
  //neighbours (Smith G2). The rendered surface compounds the problem —
  //small-cascade slope detail mips/aliases away with distance, so the
  //pixel-scale "macro normal" lies about how flat the surface really is.
  //
  //Fix: rebuild the lost-to-LOD slope variance per pixel. Each cascade
  //contributes its precomputed σ² (cascadeRMSSlope[c], integrated from
  //JONSWAP in ocean-height-band-library.js) once the viewer is far enough
  //that the cascade's wavelengths are sub-pixel. Sum gives α²_GGX. Apply
  //the Karis split-sum horizon clamp: the grazing Fresnel ceiling drops
  //from 1.0 toward F0 as roughness grows, exactly the energy roll-off a
  //GGX-prefiltered cubemap would integrate. Distance-aware, physically
  //motivated, and replaces the failed 2db241e fresnelNormalAlpha/
  //fresnelDistanceRoughness stack — which used hardcoded m-range fades
  //ungrounded in actual cascade slope content and so crushed mid-distance
  //reflection variance independently of how rough the surface really was.
  //
  //Each cascade fades from "fully resolved" at d=0.5·L to "fully lost"
  //at d=4·L. Cascade 0 (4096 m) is never lost in any scene we render;
  //cascade 5 (4 m) starts contributing roughness past ~2 m and is fully
  //folded in by ~16 m. The displacement-fade ranges (×50…×500·L in the
  //vertex block) are intentionally longer — displacement itself is
  //still meaningful well past where individual wavelets are resolvable.
  //Phase 2: slope variance scales with amplitude², so each cascade's σ² is
  //weighted by its wave mask squared — a glassy tarn does not borrow the open
  //ocean's horizon roughness.
  float waveMaskSq[6];
  waveMaskSq[0] = waveMask0 * waveMask0;
  waveMaskSq[1] = waveMask1 * waveMask1;
  waveMaskSq[2] = waveMask2 * waveMask2;
  waveMaskSq[3] = waveMask3 * waveMask3;
  waveMaskSq[4] = waveMask4 * waveMask4;
  waveMaskSq[5] = waveMask5 * waveMask5;
  float alpha2 = 0.0;
  for(int c = 0; c < 6; c++){
    float lostFrac = smoothstep(0.5 * cascadePatchSizes[c], 4.0 * cascadePatchSizes[c], distanceToWorldPosition);
    alpha2 += lostFrac * waveMaskSq[c] * cascadeRMSSlope[c];
  }
  //waveHeightMultiplier scales the displacement amplitude in the vertex
  //shader; slope scales linearly with amplitude so slope variance scales
  //quadratically. Apply on the shader side so live artistic changes to
  //wave_scale_multiple flow through without recomputing cascadeRMSSlope.
  alpha2 *= waveHeightMultiplier * waveHeightMultiplier;
  #if($flowing_water)
    //Phase 4: the ripple slope the profile mips averaged away (see the flowing normals).
    alpha2 += flowRippleLostVar;
    //PLACEHOLDER: Phase 6 falls (see flowFallSheet): a fall sheet is broken water,
    //slope variance 0.2 (GGX roughness about 0.63).
    alpha2 = max(alpha2, 0.2 * flowFallSheet);
  #endif
  //Beckmann-to-GGX: α²_GGX ≈ 2·σ²_slope. Clamp keeps the horizon-ceiling
  //term well-defined when several cascades pile in at extreme range.
  alpha2 = clamp(2.0 * alpha2, 0.0, 1.0);
  float alphaRough = sqrt(alpha2);

  //Karis "Real Shading in Unreal Engine 4" environment BRDF — the grazing
  //Fresnel ceiling becomes max(1-α, F0) instead of 1.0. Standard Schlick
  //is the α=0 limit; α=1 collapses to flat F0 (no grazing peak at all).
  //displacedNormal is force-flipped UPWARD twice on the way here (the two
  //`if(displacedNormal.y < 0.0)` guards), which is right for a viewer in air and
  //degenerate for one under the surface: the dot then goes negative on every
  //ceiling fragment and clamps to 0, pinning fresnelFactor at horizonCeiling
  //(≈1) across the whole view. Face the normal at whoever is looking so the term
  //stays meaningful on both sides. The real underwater reflectance is still
  //fresnelWaterToAir inside the ceiling model — this keeps the above-water curve
  //honest for debug mode 12 and for fresnelT, which would otherwise read 0.
  vec3 fresnelNormal = faceforward(displacedNormal, normalizedViewVector, displacedNormal);
  float cosTheta = clamp(dot(fresnelNormal, -normalizedViewVector), 0.0, 1.0);
  float horizonCeiling = max(1.0 - alphaRough, r0);
  float fresnelFactor = r0 + (horizonCeiling - r0) * pow(1.0 - cosTheta, 5.0);

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
      //LO/HI are solved by src/python/make-caustic-map.py so the smoothstep
      //output distribution over the generated 1024px linear-intensity caustic
      //texture matches what the original 256px asset produced with the old
      //0.15/0.85 pair — same seabed energy and hot-line coverage, just sharper
      //filaments. Regenerating the texture re-solves these; keep this pair and
      //the projection-pass smoothstep in ocean-grid.js in sync with the script
      //output. CAUSTIC_TEXTURE_MEAN stays the tuned pivot it always was.
      const float CAUSTIC_THRESHOLD_LO    = 0.0;
      const float CAUSTIC_THRESHOLD_HI    = 1.0;
      //UV multiplier sets caustic texture tile size. The texture itself encodes
      //multiple caustic structures, so the visible caustic period is texture_tile / N.
      //0.3 → ~3.3 m tile, ~0.5-1 m visible caustic scale (real pool shimmer).
      //Previous 0.02 (50 m tile) was invisible at close range; 1.0 (1 m tile) was
      //sub-pixel and averaged to flat. 0.3 is the sweet spot for 1 unit = 1 m world.
      //(0.3 is now the DEEP-water scale, CAUSTIC_BASE_UV below; shallower beds get finer
      //cells, by depth.)
      //Project the caustic texture ALONG the refracted sun ray, not straight
      //down. pSurfaceHit (already computed above for the seabed shadow lookup)
      //is where THIS seabed point's refracted sun ray pierces the surface, so
      //sampling the caustic pattern there parallel-projects the surface web
      //down sunDirInWater onto the seabed. As the sun lowers the web slides
      //and stretches the way real caustics do, and a steep seabed face no
      //longer gets a smeared top-down slice. Collapses to the old straight-
      //down look exactly at solar zenith (sunDirInWater vertical ⇒
      //pSurfaceHit.xz == pointXYZ.xz).
      //ONE MODEL FOR EVERY BODY (hero-creek rounds 1-2). Round 1 gave creeks their own
      //constants and the pond beside them kept the ocean ones, so the two textures clashed
      //across the hand-off. The physics says a single model covers both:
      //- SCALE follows DEPTH. The ripples whose rays focus at depth h have curvature about
      //  4 / h (a lens of index n focuses at n / (n - 1) / curvature), and at slope s a
      //  ripple of curvature k has wavelength 2 pi s / k, about 0.16 h at s = 0.1. So the
      //  cells on a bed are about 0.16 x its depth: ~10 cm under a 0.6 m creek, ~0.8 m
      //  under 5 m of sea, which is where the ocean tile (0.3 UV, 3.3 m, ~4 cells) was
      //  already tuned. Deep water is unchanged. Two fixed octave scales are blended
      //  rather than one scale driven by depth, because multiplying world position by a
      //  depth that varies across the bed would warp the pattern.
      //- FOCUS. Rays need depth to converge: no pattern at the waterline, sharpening over
      //  the first ~0.25 m (the finest ripples, a few cm, focus there).
      //- DISPERSION. Red and blue refract about 0.6 mm apart per metre of depth at slope
      //  0.1 (index 1.331 vs 1.339): invisible in a creek, millimetres in the sea.
      const float CAUSTIC_BASE_UV = 0.3;
      const float CAUSTIC_TILE_PER_DEPTH = 0.65;
      const float CAUSTIC_MIN_TILE_M = 0.25;
      const float CAUSTIC_FOCUS_M = 0.25;
      const float CAUSTIC_DISPERSION_PER_M = 0.0006;
      float causticTile = clamp(CAUSTIC_TILE_PER_DEPTH * downPath, CAUSTIC_MIN_TILE_M, 1.0 / CAUSTIC_BASE_UV);
      float causticLevel = log2(1.0 / (causticTile * CAUSTIC_BASE_UV));
      float causticLevel0 = floor(causticLevel);
      float causticLevelT = causticLevel - causticLevel0;
      vec3 causticSampleRaw = vec3(0.0);
      for(int k = 0; k < 2; k++){
        float causticScale = CAUSTIC_BASE_UV * exp2(causticLevel0 + float(k));
        vec2 causticUV = causticScale * pSurfaceHit.xz;
        float causticSplit = causticScale * CAUSTIC_DISPERSION_PER_M * downPath;
        vec3 causticOctave = vec3(causticShader(causticUV + causticSplit, t),
                                  causticShader(causticUV, t),
                                  causticShader(causticUV - causticSplit, t));
        causticSampleRaw += (k == 0 ? 1.0 - causticLevelT : causticLevelT) * causticOctave;
      }
      vec3 causticSample = smoothstep(vec3(CAUSTIC_THRESHOLD_LO), vec3(CAUSTIC_THRESHOLD_HI), causticSampleRaw);
      dbgCausticSample = causticSample;
      float causticDepthFade = exp(-downPath / CAUSTIC_CONTRAST_DEPTH) * smoothstep(0.0, CAUSTIC_FOCUS_M, downPath);
      causticMod = vec3(1.0) + causticDepthFade * causticIntensityMultiplier * CAUSTIC_AMP * (causticSample - vec3(CAUSTIC_TEXTURE_MEAN));
    #endif

    vec3 ambientUW = skyAmbientColor * waterAlbedo;
    //Lambertian seabed: L = albedo * E * NdotL / pi for the direct sun, the
    //same units the foam plate uses (INV_PI below). The sky ambient needs no
    ///pi: a uniform sky of radiance L_sky delivers E = pi * L_sky, so the pi
    //cancels.
    //
    //HISTORY. This used to carry no /pi on purpose ("pragmatic seabed scale",
    //2026-05-16): dividing erased the seabed against the bright inscatter in
    //clean deep water. Phase 3a, tuning pass 3 (2026-09-13), put it back. The
    //shallows over a beach were lit pi times brighter than the foam next to
    //them. Sand under a few centimetres of water measured as bright as dry sand
    //(submerged sand should be clearly darker), and breaker foam read grey
    //against milky shallows. If deep clear water loses its seabed again,
    //compensate THERE (inscatter or extinction), not with a unit mismatch here.
    const float SEABED_INV_PI = 0.31830988618;
    refractedLight *= (SEABED_INV_PI * sunDown * NdotL_seabed * causticMod * seabedShadowFactor + ambientUW);
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
    //Lambertian direct sun (/pi), same convention as the seabed branch above and
    //the foam plate: Phase 3a tuning pass 3.
    const float TERRAIN_INV_PI = 0.31830988618;
    refractedLight *= (TERRAIN_INV_PI * brightestDirectionalLight * NdotL_terrain * terrainShadowFactor + skyAmbientColor);
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
  float waveHeightAboveRest = max(0.0, worldPosition.y - restWaterLevel);
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
  //Far-horizon / deep: transmittance → 0, refractedLight → the medium's
  //single-scatter equilibrium for the camera→surface view ray.
  //Continuous across the whole range — no branching, no far-plane cliff.
  //
  //Inscatter uses the same `underwaterInscatterSurface()` function the chunk
  //fog and the underwater-ceiling `applyUnderwaterFog` call — one HG-phased
  //volumetric model, three callers. View-direction dependence (HG sun phase)
  //means deep water reads brighter looking down-sun than perpendicular to it
  //— the same forward-scatter halo that paints god rays under water.
  //
  //Crest translucency adds to the body channel — it's transmitted light, so
  //it picks up the same (1 - fresnelFactor) weight as the rest of the body
  //at the final composition step.
  vec3 bodyInscatter = underwaterInscatterSurface(normalizedViewVector);
  vec3 dbgInscatterEquilibrium = bodyInscatter;
  refractedLight = refractedLight * transmittance + bodyInscatter * (vec3(1.0) - transmittance) + crestTranslucency;
  vec3 dbgBody = refractedLight;

  //Calculate specular lighting and surface lighting
  float lightMag = length(brightestDirectionalLight);
  vec3 normalizedLightIntensity = lightMag > 0.001 ? brightestDirectionalLight / lightMag : vec3(0.0);
  vec3 directionalSurfaceLighting = normalizedLightIntensity * max(dot(macroNormal, -brightestDirectionalLightDirection), 0.0) * sunShadowFactor;

  //── Cook-Torrance microfacet sun-glint specular ─────────────────────────
  //Ported from the Water sibling (Acerola FFTWater.shader): Beckmann D +
  //Smith-Beckmann G + roughness-aware Schlick F. The FFT cascade chain
  //(sampled per-fragment from the displacement textures) drives the
  //per-pixel meso-normal; the surfaceRoughness uniform drives the
  //statistical microfacet distribution width for the sub-pixel slope
  //variance the spectrum cannot resolve (capillary waves, sub-cascade-5
  //ripples). This replaces the previous Phong lobe — Phong's mesh-scale
  //facet integration produced wave-face-sized bright smears instead of
  //the pinpoint glints real ocean has, because a Phong pow(NdotR, n)
  //fires whenever an entire mesh facet aligns rather than statistically
  //weighting the unresolved facets within each pixel.
  //
  //Hypothesis (2026-05-19): the BRDF was being fed a per-pixel sample of
  //cascade 5's high-k content via 1-texel-eps central differences. Adjacent
  //pixels landed on nearly-uncorrelated samples, so Cook-Torrance fired
  //only on the lucky-aligned ones (quartz fleck), and widening α to
  //compensate collapsed everything to a fuzzy blob.
  //
  //Fix: build specNormal exactly as displacedNormal — same Crest-style
  //choppy cross product, same Tx/Tz form, all 6 cascades present — but
  //swap cascade 5's height-slope contribution from the native 1-texel-eps
  //to an 8-texel-eps central difference. The wider stride lets the GPU's
  //bilinear filter average across cascade 5's sub-meter content, giving a
  //slope value that varies smoothly per-pixel instead of independently
  //per-pixel. Cascades 0-4 (meter-to-km wave faces — the visible swell)
  //are untouched, so the sun pillar's geometry still rides the real waves.
  //
  //This is the analogue of Acerola's slope-texture-with-tile-8 sampling
  //(FFTWater.shader:251-264) but using a wide eps to get the same
  //implicit-low-pass behavior on a height texture.
  vec2 c5FilteredHeightSlope = vec2(0.0);
  #if(!$flowing_water)
  {
    float specEps = 8.0 / patchDataSize;
    float specWorldStep = cascadePatchSizes[5] * 8.0 / patchDataSize;
    float fade5 = smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToWorldPosition);
    vec2 uv5 = (vWorldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5];
    float hL = texture(cascadeDisplacementArray, vec3(uv5 + vec2(-specEps, 0.0), 5.0)).y;
    float hR = texture(cascadeDisplacementArray, vec3(uv5 + vec2( specEps, 0.0), 5.0)).y;
    float hB = texture(cascadeDisplacementArray, vec3(uv5 + vec2( 0.0, -specEps), 5.0)).y;
    float hT = texture(cascadeDisplacementArray, vec3(uv5 + vec2( 0.0,  specEps), 5.0)).y;
    c5FilteredHeightSlope = vec2(hR - hL, hT - hB) / (2.0 * specWorldStep);
    c5FilteredHeightSlope *= waveMask5 * fade5 * waveHeightMultiplier;
  }
  #endif
  //Total height slope for spec = full displacedNormal slope minus cascade-5
  //native contribution plus cascade-5 filtered contribution. Same cross
  //product form (chop derivatives unchanged — they don't suffer from
  //per-pixel noise the way the height slope does).
  vec2 specHeightSlope = vec2(
    rawDdx.y - c5NativeHeightSlope.x + c5FilteredHeightSlope.x,
    rawDdz.y - c5NativeHeightSlope.y + c5FilteredHeightSlope.y
  );
  vec3 specTx = vec3(1.0 + foamDdx.x, specHeightSlope.x, foamDdx.y);
  vec3 specTz = vec3(foamDdz.x, specHeightSlope.y, 1.0 + foamDdz.y);
  vec3 specNormal = normalize(cross(specTz, specTx));
  if(specNormal.y < 0.0) specNormal = -specNormal;
  specNormal = normalize(mix(vec3(0.0, 1.0, 0.0), specNormal, foldBlend));
  if(specNormal.y < 0.0) specNormal = -specNormal;

  //Effective roughness: max of the artist-controlled baseline and the
  //distance-grown σ²_GGX from the cascade fade (already computed above
  //for the Fresnel horizon clamp). Near camera α ≈ surfaceRoughness;
  //at distance the cascade-fade slopes pile in, widening the lobe so the
  //horizon doesn't collapse to a mirror.
  float ctAlpha = max(surfaceRoughness, alphaRough);
  float ctAlpha2 = ctAlpha * ctAlpha;

  vec3 ctLightDir = -brightestDirectionalLightDirection;
  vec3 ctViewDir  = -normalizedViewVector;
  vec3 ctHalfDir  = normalize(ctLightDir + ctViewDir);
  vec3 ctMacroN   = vec3(0.0, 1.0, 0.0);

  float ctNdotH = max(0.0001, dot(specNormal, ctHalfDir));
  float ctNdotL = max(0.0,    dot(specNormal, ctLightDir));
  float ctNdotV = max(0.0001, dot(specNormal, ctViewDir));
  float ctMacroNdotL = max(0.001, dot(ctMacroN, ctLightDir));
  float ctNdotH2 = ctNdotH * ctNdotH;

  //Beckmann normal distribution
  float ctD = exp((ctNdotH2 - 1.0) / (ctAlpha2 * ctNdotH2))
            / (3.14159265 * ctAlpha2 * ctNdotH2 * ctNdotH2);

  //Smith masking-shadowing (Beckmann form)
  float ctMaskV = smithMaskingBeckmann(ctHalfDir, ctViewDir,  ctAlpha);
  float ctMaskL = smithMaskingBeckmann(ctHalfDir, ctLightDir, ctAlpha);
  float ctG = 1.0 / (1.0 + ctMaskV + ctMaskL);

  //Roughness-aware Schlick Fresnel (Water sibling variant — Schlick's exponent
  //softens with α so rough surfaces don't get a sharp grazing peak).
  float ctFNum = pow(1.0 - ctNdotV, 5.0 * exp(-2.69 * ctAlpha));
  float ctF = r0 + (1.0 - r0) * ctFNum / (1.0 + 22.7 * pow(ctAlpha, 1.5));
  ctF = clamp(ctF, 0.0, 1.0);

  //Sun fade: a-starry-sky's brightestDirectionalLight carries meaningful
  //magnitude when the sun is below the horizon (twilight residual). Fade
  //specular to zero from ~9° above horizon down so post-sunset crests
  //don't bloom orange.
  float specularSunFade = smoothstep(0.0, 0.15, sunZenithFactor);

  //── Crest-style sun-disk highlight ─────────────────────────────────────
  //Crest (Ocean.shader:113): pow(dot(reflect(view, N), L), n) · boost ·
  //lightColor · shadow. No F, no G, no /4·NdotL_macro divider — just a
  //Phong term on the reflected ray with a brightness boost. Sidesteps
  //Cook-Torrance's lobe-width trade-off: a true microfacet BRDF can't
  //simultaneously be tight (peaky for pinpoint glints) and wide (covers
  //the actual ±15-25° wave-face spread) — too tight gives sparse flecks,
  //too wide smears diffusely. Phong-on-R with boost decouples the visual
  //sharpness (controlled by exponent) from the apparent brightness
  //(controlled by boost), which is why Crest's pillar reads as the
  //dazzling pinpoint a real sun glint looks like.
  //
  //Falloff 275.0 and boost 7.0 are Crest's defaults; tune via uniform
  //later if you want live control.
  //
  //The Cook-Torrance ctF/ctG/ctD machinery above is left computed so
  //debug modes 23/24 still work — they're free as dead code once the
  //compiler proves the result is unused, and they document the path we
  //tried.
  vec3 specReflectDir = reflect(-ctViewDir, specNormal);
  specReflectDir.y = max(specReflectDir.y, 0.0);
  float specRdotL = max(0.0, dot(specReflectDir, ctLightDir));
  //Distance-varying falloff (Crest OceanReflection.hlsl:105-111): widen the
  //Phong lobe with distance so the mip-flattened mid/far normal still catches
  //the sun instead of going dark. sqrt ramp broadens early; boost stays
  //constant — the Fresnel gate at compositing (not energy conservation) is
  //what keeps the near field from blooming. We tried this ramp BEFORE the
  //Fresnel gate existed and it smeared the horizon into one sheen, because
  //the wide lobe was the only thing controlling visibility; with the gate the
  //wide lobe just rides inside Fresnel. specFalloffFar defaults to the near
  //exponent (275) so the ramp is a no-op until dialed.
  const float SPEC_PHONG_FALLOFF_NEAR = 275.0;
  float specFallOffAlpha = sqrt(clamp(distanceToWorldPosition / max(specFalloffFarDist, 1.0), 0.0, 1.0));
  float specFallOff = mix(SPEC_PHONG_FALLOFF_NEAR, specFalloffFar, specFallOffAlpha);
  vec3 specular = brightestDirectionalLight * pow(specRdotL, specFallOff) * specBoost;
  specular *= specularSunFade * sunShadowFactor;

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
  //Sun-glint placement (Crest OceanReflection.hlsl:113-118). Crest adds the
  //Phong glint INTO the reflection colour, so it shares the reflection's
  //Fresnel gate (R_theta). specFresnelGate blends our two paths:
  //  ungated portion  — added raw outside the Fresnel mix (legacy behavior).
  //  gated portion    — folded into the reflection group, multiplied by
  //                     fresnelFactor, so it can't bloom looking down (tiny F)
  //                     and strengthens toward grazing mid/far (F->1).
  //At specFresnelGate = 0.0 this is byte-identical to the old additive glint.
  vec3 specularUngated = specular * (1.0 - specFresnelGate);
  vec3 reflectionPlusGlint = (attenuatedReflection + specular * specFresnelGate) * fresnelFactor;
  vec3 totalLight = specularUngated + (2.0 / 255.0) * directionalSurfaceLighting + (253.0 / 255.0) * (refractedLight * (1.0 - fresnelFactor) + reflectionPlusGlint);
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
    //dbg* are declared unconditionally (debug modes + computeUnderwaterCeiling read
    //them later); the actual foam sampling/lighting/blend is gated off underwater,
    //matching the foamAmount guard above. Submerged → dbgFoamBlend stays 0, so the
    //ceiling foam mix is a no-op and no foam textures are fetched.
    vec3  dbgFoamColor  = vec3(0.0);
    float dbgFoamMask   = 0.0;
    float dbgFoamBlend  = 0.0;
    float dbgFoamAmount = foamAmount;
    if(underwaterFactor < 0.5){
    //Two-layer foam sampling: average a 90°-rotated, differently-scaled second sample
    //with the first to break up the repeating brick pattern (same trick as the large normal map).
    //foamLayerMix is 0.5 on the ocean (the plain average) and the two-phase
    //flow weight on flowing water.
    vec3  foamAlbedo = mix(texture2D(foamDiffuseMap, foamTextureUV).rgb, texture2D(foamDiffuseMap, foamTextureUV2).rgb, foamLayerMix);
    float foamMask   = mix(texture2D(foamOpacityMap, foamTextureUV).r,   texture2D(foamOpacityMap, foamTextureUV2).r,   foamLayerMix);
    //Blend packed normals in [0,1] space, then decode once
    vec2  foamNMXZ   = 2.0 * mix(texture2D(foamNormalMap, foamTextureUV).xy, texture2D(foamNormalMap, foamTextureUV2).xy, foamLayerMix) - 1.0;

    //Foam normal: perturb the FFT surface normal with the foam normal map.
    vec3 foamSurfaceNormal = normalize(displacedNormal + vec3(foamNMXZ.x, 0.0, foamNMXZ.y) * 0.5);

    //Energy-conserving Lambert: a real diffuse plate returns albedo/π × E_inc
    //after integrating the cosine lobe over the hemisphere. Foam is the only
    //surface in this shader actually shaded as a Lambert plate, so it's the
    //only place that visibly suffers from a missing 1/π. With HDR sun magnitude
    //~5-6 at noon and a near-white foam albedo, dropping the factor returns
    //~5× the radiance the plate would physically emit, slamming the AES tonemap
    //shoulder and leaving no headroom for the foam normal map to modulate.
    const float INV_PI = 0.31830988618;
    float foamNdotL = max(0.0, dot(foamSurfaceNormal, -brightestDirectionalLightDirection));
    vec3 foamDiffuse = INV_PI * foamNdotL * lightMag * normalizedLightIntensity * foamAlbedo * sunShadowFactor;

    //Sky ambient: same hemisphere model as the water surface ambient above.
    float foamSkyFactor = 0.5 + 0.5 * dot(foamSurfaceNormal, vec3(0.0, 1.0, 0.0));
    vec3 foamAmbient = skyAmbientColor * foamSkyFactor * foamAlbedo;

    //── Field-driven foam shape (2026-05-31) ──────────────────────────────────
    //Previously this used Crest's sliding-black-point: foamAmount only moved a
    //threshold on the bubble OPACITY texture, so the texture (foamMask) owned the
    //silhouette. Because that texture is world-locked (foamTextureUV = worldXZ/2,
    //~2 m tiles, line 1285), foam puffs sat at fixed world cells and just blinked
    //on/off as crests pulsed over them — they never tracked the waves, and the
    //brightest bubbles even leaked through where foamAmount was near zero.
    //
    //Now the wave-foam FIELD (foamAmount, crest-located out of the broadband RT)
    //owns WHERE foam is, and the bubble texture only grains the interior. Foam now
    //appears on — and moves with — the field instead of the static texture.
    //foamShapeFeather is the soft edge of a field patch; foamGrainFloor stops a
    //dark texel from fully eating thin/edge foam.
    const float foamShapeFeather = 0.04;
    const float foamGrainFloor   = 0.5;
    float foamShape = smoothstep(foamShapeFeather, 0.5, foamAmount);
    float foamBlend = foamShape * mix(foamGrainFloor, 1.0, foamMask);
    #if($flowing_water)
      //Phase 4: on flowing water the bubble texture is NOT world-locked (the
      //two-phase layers ride the current), which was the whole objection above,
      //so Crest's sliding black point is right here after all: a bubble shows
      //where the grain beats 1 - coverage. Thin foam breaks into flecks and
      //streaks that travel; dense foam closes up into whitewater.
      const float FLOW_FOAM_FEATHER = 0.12;
      foamBlend = smoothstep(1.0 - foamAmount - FLOW_FOAM_FEATHER, 1.0 - foamAmount + FLOW_FOAM_FEATHER, foamMask)
                * smoothstep(0.0, 0.05, foamAmount);
    #endif
    dbgFoamColor  = foamDiffuse + foamAmbient;
    dbgFoamMask   = foamMask;
    dbgFoamBlend  = foamBlend;
    totalLight = mix(totalLight, foamDiffuse + foamAmbient, foamBlend);
    } //end if(underwaterFactor < 0.5) — foam off below the surface
  #else
    vec3 dbgFoamColor = vec3(0.0);
    float dbgFoamMask = 0.0;
    float dbgFoamBlend = 0.0;
    float dbgFoamAmount = 0.0;
  #endif

  //Modes 50-55 are the ceiling bisection taps — they need the ceiling built, so
  //keep computing it for them (it short-circuits to the requested stage inside
  //the function). Every other non-zero debug mode clobbers gl_FragColor below,
  //so skip both post-lighting steps then.
  bool runPostLighting = (oceanShadowDebugMode == 0 ||
                          (oceanShadowDebugMode >= 50 && oceanShadowDebugMode <= 55));

  //THE UNDERWATER CEILING IS UNGATED — see the banner above
  //computeUnderwaterCeiling. Gating this on $atmospheric_perspective_enabled is
  //what left every scene without a sky provider with no underwater water at all.
  //
  //Camera is below the surface: this fragment is the underside of the water (the
  //"ceiling"). Replace the above-water lighting wholesale with the water→air
  //ceiling model — screen-space refraction (rippled transmission) + Fresnel/TIR
  //planar reflection + foam, fogged by the water column. ocean-grid.js flips the
  //mesh to BackSide on the same gate, so only ceiling fragments land here.
  if(runPostLighting && underwaterFactor >= 0.5){
    totalLight = computeUnderwaterCeiling(worldPosition.xyz, displacedNormal,
                                          dbgFoamColor, dbgFoamBlend,
                                          screenUV,
                                          distanceToWorldPosition);
  }

  #if($atmospheric_perspective_enabled)
    //Above water: Mie+Rayleigh atmospheric perspective. THIS is the part that
    //genuinely needs a-starry-sky's LUTs, and the only part still gated.
    //Atmospheric perspective is the most expensive post-lighting step (multiple
    //3D LUT samples), so it stays on mode 0 alone — the 50-55 taps are ceiling
    //taps and never reach here.
    if(oceanShadowDebugMode == 0 && underwaterFactor < 0.5){
      totalLight = applyAtmosphericPerspective(totalLight, worldPosition.xyz);
    }
  #endif

  //Keep the real shaded result around so translucent debug overlays (mode 40)
  //can blend over it instead of replacing it (debugBlend opacity).
  vec4 finalRenderedColor = linearTosRGB(vec4(aroAESFilmicToneMapping(totalLight), 1.0));
  gl_FragColor = finalRenderedColor;

  //$DEBUG_START$
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
      storedDepth = log(max(texture(oceanShadowMap, vec3(sc0d.xy, 0.0)).r, 1.0)) / evsmExpC;
    } else if(oceanCascadeContains(sc1d, dbgMargin1)){
      refDepth = sc1d.z;
      storedDepth = log(max(texture(oceanShadowMap, vec3(sc1d.xy, 1.0)).r, 1.0)) / evsmExpC;
    } else if(oceanCascadeContains(sc2d, dbgMargin2)){
      refDepth = sc2d.z;
      storedDepth = log(max(texture(oceanShadowMap, vec3(sc2d.xy, 2.0)).r, 1.0)) / evsmExpC;
    } else if(oceanCascadeContains(sc3d, dbgMargin3)){
      refDepth = sc3d.z;
      storedDepth = log(max(texture(oceanShadowMap, vec3(sc3d.xy, 3.0)).r, 1.0)) / evsmExpC;
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
    float h = (worldPosition.y - restWaterLevel) / 5.0;
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
  //Mode 29: SHORE-FOAM GATE BREAKDOWN. One look tells you which half of the
  //shore-foam chain is failing, because there are two independent halves and they
  //fail identically (no foam) from the outside:
  //  BLACK   = outside the foam ortho footprint entirely. Expected far from the
  //            camera; if it is black AT the shore, the ortho half-width or the
  //            snapped centre is wrong.
  //  RED     = inside the footprint, but the capture mask is 0 — the ortho saw no
  //            terrain at this texel. THIS IS THE CAPTURE HALF. Solid red along a
  //            visible coastline means the terrain never reached the atlas (for a
  //            sibling system's ground: the geometry-only twin, or the camera's
  //            near plane sitting BELOW the shoreline it is meant to capture).
  //  GREEN   = shoreProximity — terrain captured, and this is how close the water
  //            surface is to it (bright green = within ~0.5 m, gone by ~4 m).
  //  BLUE    = the drive term, turbulence*2.5 + fftFoamAmount*0.5. THIS IS THE
  //            WAVE-ACTION HALF. Green with no blue = the shore was found and the
  //            water simply is not breaking there (calm wind, no chop).
  //So: red at the shore → capture. Green but never cyan → drive. Cyan → the gate
  //is passing and the problem is downstream in the foam blend (modes 31-33).
  //⚠ foamRenderMap only exists under $foam_enabled, so the body is gated with it.
  else if(oceanShadowDebugMode == 29){
  #if($foam_enabled)
    vec2 fp = 0.5 * (((worldPosition.xz - foamCameraXZ) / vec2(FOAM_ORTHO_HALF_WIDTH)) + 1.0);
    fp = vec2(fp.x, 1.0 - fp.y);
    if(fp.x < 1.0 && fp.x > 0.0 && fp.y < 1.0 && fp.y > 0.0){
      vec2 fhd = texture2D(foamRenderMap, fp).ga;
      if(fhd.y > 0.5){
        float wat = worldPosition.y - fhd.x;
        float sFade = clamp((wat - 0.5) / 3.5, 0.0, 1.0);
        float sProx = (1.0 - sFade) * (1.0 - sFade);
        float drive = clamp(turbulence * 2.5 + fftFoamAmount * 0.5, 0.0, 1.0);
        gl_FragColor = vec4(0.0, sProx, drive, 1.0);
      } else {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
      }
    } else {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
  #else
    //MAGENTA = the foam system is compiled out entirely, so none of the chain
    //this mode inspects exists. Not a diagnosis, a wrong-question answer, which
    //beats a black screen that reads like a real result.
    gl_FragColor = vec4(0.6, 0.0, 0.6, 1.0);
  #endif
  }
  //Mode 27: underwaterFactor as a continuous ramp — the value ITSELF, not the
  //binary every other mode thresholds it into. Black = 0 (fully in air), white =
  //1 (fully submerged), mid-grey = mid-crossfade. Read it when the surface model
  //looks wrong at the waterline: the shader picks the ceiling at >= 0.5 and the
  //CPU flips the mesh to BackSide on the same test, so a camera parked in the
  //grey band is the one place those two can disagree. Tinted teal so a grey
  //ocean does not read as a mid value.
  else if(oceanShadowDebugMode == 27){
    gl_FragColor = vec4(vec3(0.1, 1.0, 0.9) * underwaterFactor, 1.0);
  }
  //Mode 28: the CEILING normal — `n = -displacedNormal`, the one
  //computeUnderwaterCeiling actually shades with, encoded like mode 18. Mode 18
  //shows the force-upward normal and therefore can never show this, which made
  //the two impossible to tell apart when the underwater Fresnel looked wrong.
  //Submerged, this should be the photographic negative of mode 18.
  else if(oceanShadowDebugMode == 28){
    gl_FragColor = vec4((-displacedNormal) * 0.5 + 0.5, 1.0);
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
  //Mode 21: specNormal (the normal actually fed to Cook-Torrance) as RGB,
  //same [-1,1] → [0,1] encoding as modes 18/19. Compare against 18 to see
  //whether the option-(2) low-pass cascade-5 build is producing the smooth
  //meso-normal we intended, or collapsing to plain macroNormal (would read
  //identical to mode 19) or carrying too much high-k content (would read
  //identical to mode 18).
  else if(oceanShadowDebugMode == 21){
    gl_FragColor = vec4(specNormal * 0.5 + 0.5, 1.0);
  }
  //Mode 22: isolated specular contribution as RGB. This is the full Cook-
  //Torrance output that gets folded into totalLight at the composite line —
  //sun shadow and specularSunFade are baked in, so this is what the lobe
  //ACTUALLY produces at this fragment. Tone-mapped with the same
  //AESFilmic+sRGB pair as the main path so the dynamic range reads in
  //gamma space (raw HDR clamps to ~white at the sun pillar). If this is
  //black across the whole image when the sun is in front of camera, the
  //BRDF is silent and we have a normal/lobe problem; if it's bright but
  //scattered as fleck noise, the spec normal is too high-frequency.
  else if(oceanShadowDebugMode == 22){
    gl_FragColor = linearTosRGB(vec4(aroAESFilmicToneMapping(specular), 1.0));
  }
  //Mode 23: NdotH grayscale, raised to a strong contrast so the lobe-firing
  //zone reads. White (≈1.0) where specNormal aligns with the half-vector
  //(lobe fires); 0.5 means N⊥H (lobe is dead). Use this to see whether the
  //sun pillar's GEOMETRY is forming — i.e., are there pixels achieving
  //NdotH > 0.95 in the band where you'd expect the pillar? If yes, the
  //pillar IS there in the half-vector sense and the dimness is downstream
  //(F, G, ctMacroNdotL divider). If everywhere reads dark grey, the
  //specNormal distribution isn't reaching H at all and we need a wider α
  //or a different lobe shape.
  else if(oceanShadowDebugMode == 23){
    float v = pow(max(0.0, ctNdotH), 64.0);
    gl_FragColor = vec4(vec3(v), 1.0);
  }
  //Mode 24: raw ctF * ctG * ctD product (the BRDF amplitude before
  //ctNdotL / ctMacroNdotL scaling and light/shadow/fade multiplication).
  //Scaled by 1/5 so the wider-α lobe (Beckmann peak ~14 at α=0.15) reads
  //as bright in the pillar zone. If this lights up where mode 23 lights
  //up, the BRDF lobe is firing correctly on the actual specNormal
  //distribution. If mode 23 is bright but this is still dim, α is still
  //too narrow for our wave-face slope spread.
  else if(oceanShadowDebugMode == 24){
    float v = ctF * ctG * ctD / 5.0;
    gl_FragColor = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
  }
  //Mode 25: scene sun shadow value at the WATER SURFACE position, raw.
  //White = fully lit, black = fully shadowed. Use to see the exact shape of
  //the lighthouse/terrain shadow on the water and where its hard cutoff sits.
  else if(oceanShadowDebugMode == 25){
    float v = getSunShadow(vSunShadowCoord);
    gl_FragColor = vec4(vec3(v), 1.0);
  }
  //Mode 26: which axis of sunShadowCoord is gating this fragment. Tells us
  //precisely which clip is producing the cutoff line — colour says why a
  //fragment reads as "lit" outside the frustum.
  //  WHITE  = inside the shadow camera frustum, real shadow value applies
  //  RED    = sc.x outside [0,1]  (lateral, sun azimuth axis)
  //  GREEN  = sc.y outside [0,1]  (lateral, perpendicular axis)
  //  BLUE   = sc.z > 1.0          (past the shadow camera's FAR plane)
  //  BLACK  = sc.z < 0.0          (between light and near plane)
  else if(oceanShadowDebugMode == 26){
    vec3 sc = vSunShadowCoord.xyz / vSunShadowCoord.w;
    vec3 tint = vec3(1.0); //inside the frustum
    if(sc.z < 0.0)                          tint = vec3(0.0);
    else if(sc.z > 1.0)                     tint = vec3(0.2, 0.2, 1.0);
    else if(sc.x < 0.0 || sc.x > 1.0)       tint = vec3(1.0, 0.2, 0.2);
    else if(sc.y < 0.0 || sc.y > 1.0)       tint = vec3(0.2, 1.0, 0.2);
    gl_FragColor = vec4(tint, 1.0);
  }
  //Mode 31: raw foamOpacityMap value (foamMask) as grayscale. If the brightest
  //patches don't reach white (~0.6+), the texture peak is the limiting factor
  //and even with full foamAmount the smoothstep edge eats the blend. Fix at
  //texture-load or by lowering Crest's 0.4 feather constant.
  else if(oceanShadowDebugMode == 31){
    gl_FragColor = vec4(vec3(dbgFoamMask), 1.0);
  }
  //Mode 32: foamBlend (the smoothstep output, what actually drives the mix
  //toward foam color). White = 100% foam-tinted, black = pure water. If this
  //is uniformly dim/black on visible wave crests, the smoothstep math is the
  //blocker even though both foamAmount and foamMask are non-zero.
  else if(oceanShadowDebugMode == 32){
    gl_FragColor = vec4(vec3(dbgFoamBlend), 1.0);
  }
  //Mode 33: foam color (foamDiffuse + foamAmbient) pre-tonemap, tonemapped
  //the same way the final surface is. Compare against the water at the same
  //pixel — if foam color barely beats water radiance, the INV_PI scale is
  //too aggressive and the mix has no headroom to read as "white".
  else if(oceanShadowDebugMode == 33){
    gl_FragColor = linearTosRGB(vec4(aroAESFilmicToneMapping(dbgFoamColor), 1.0));
  }
  //Mode 30: per-cascade Jacobian computed in-shader from each cascade's
  //displacement (per-cascade only, no summing). Six vertical strips: C0 left
  //→ C5 right. grey=1=flat, black=0=folded, white=2=stretched. Shows which
  //bands actually fold; the live foam uses the SUMMED fold (`turbulence`), so a
  //single strip sitting near grey is fine — folds come from the combination.
  #if(!$flowing_water)
  else if(oceanShadowDebugMode == 30){
    float strip = gl_FragCoord.x / screenResolution.x;
    int idx = int(min(strip * 6.0, 5.0));
    float j = 1.0;
    float eps = 1.0 / patchDataSize;
    if(idx >= 0 && idx <= 5){
      float patchL = cascadePatchSizes[idx];
      float worldStep = patchL / patchDataSize;
      vec2 uv = (vWorldXZ + cascadeSpatialOffsets[idx]) / patchL;
      //One sample set with a runtime layer. This was a six-branch if/else chain
      //until Phase 10, for one reason only: GLSL ES forbids indexing an ARRAY OF
      //SAMPLERS with a non-constant expression. A sampler2DArray has no such
      //restriction — the layer is just a coordinate — so the chain collapses.
      float layer = float(idx);
      vec2 dL = texture(cascadeDisplacementArray, vec3(uv + vec2(-eps, 0.0), layer)).xz;
      vec2 dR = texture(cascadeDisplacementArray, vec3(uv + vec2( eps, 0.0), layer)).xz;
      vec2 dB = texture(cascadeDisplacementArray, vec3(uv + vec2(0.0,-eps), layer)).xz;
      vec2 dT = texture(cascadeDisplacementArray, vec3(uv + vec2(0.0, eps), layer)).xz;
      float dDxdx = (dR.x - dL.x) / (2.0 * worldStep);
      float dDzdz = (dT.y - dB.y) / (2.0 * worldStep);
      float dDxdz = (dT.x - dB.x) / (2.0 * worldStep);
      j = (1.0 - chop * dDxdx) * (1.0 - chop * dDzdz) - chop * chop * dDxdz * dDxdz;
    }
    gl_FragColor = vec4(vec3(clamp(j * 0.5, 0.0, 1.0)), 1.0);
  }
  #endif
  //Mode 35: Snell's-window diagnostic for the underwater ceiling. Tells you at
  //a glance whether the camera is detected as submerged and which part of the
  //ceiling you are looking at — recomputes the same terms computeUnderwaterCeiling
  //uses, so it tracks the real path exactly.
  //  DARK BLUE    = underwaterFactor < 0.5 — camera NOT detected as submerged,
  //                 so the ceiling model never runs (a detection issue, not optics).
  //  RED          = total internal reflection — the TIR mirror, OUTSIDE the
  //                 window (looking too grazing; tilt back toward straight up).
  //  GREEN→YELLOW  = inside the transmitting window; green near the centre,
  //                 yellowing toward the cone edge as Fresnel reflectance climbs.
  //If the whole ceiling is one flat colour, you are seeing only that zone —
  //sweep the camera from straight-up to grazing and it should run green→red.
  else if(oceanShadowDebugMode == 35){
    if(underwaterFactor < 0.5){
      gl_FragColor = vec4(0.0, 0.0, 0.35, 1.0);
    } else {
      vec3 ceilN = -normalize(displacedNormal);
      vec3 ceilV = normalize(worldPosition.xyz - cameraPosition);
      float ceilCosI = max(dot(-ceilV, ceilN), 0.0);
      float ceilRefl = fresnelWaterToAir(ceilCosI);
      vec3 ceilRefr = refract(ceilV, ceilN, 1.333);
      //0.0001, matching computeUnderwaterCeiling's own test. It used to be 0.25,
      //which reported TIR for legitimately-transmitting near-critical rays —
      //refract() returns exactly vec3(0) on TIR and a UNIT vector otherwise, so
      //anything above zero-ish is a transmitting ray. The two disagreed exactly
      //at the window rim, which is the one place you consult this mode about.
      bool ceilTIR = dot(ceilRefr, ceilRefr) < 0.0001;
      vec3 tint = ceilTIR ? vec3(1.0, 0.0, 0.0)
                          : mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), ceilRefl);
      gl_FragColor = vec4(tint, 1.0);
    }
  }
  //Mode 36: foam/fold-vs-height alignment (the magenta test, Dante 2026-05-31).
  //Isolates ONE cascade (C4) and asks: does the Jacobian FOLD land on that
  //cascade CREST? RED = crest side of C4 (height Dy > 0). BLUE = live per-cascade
  //fold strength (clamp(1 - J), positive where the surface pinches). Uses the
  //EXACT same J formula the composer accumulates foam from.
  //  MAGENTA            = fold on crest  -> foam-on-crest, the correct result.
  //  PURE BLUE in the dark/trough areas = fold on trough -> the per-cascade
  //                       Jacobian is anti-correlated with height (chop/sign
  //                       mismatch between geometry pinch and the foam pass).
  //  PURE RED           = crest with no fold.
  //If it is mostly magenta, the foam IS on crests and the trough look is a
  //consumption/lighting artefact, not a generation sign error.
  else if(oceanShadowDebugMode == 36){
    //VISIBLE-surface magenta test (2026-05-31): the previous per-cascade probe
    //tested ONE band's height (Dy of C0/C4), which is NOT the visible wave top —
    //the surface you see is the SUM of all cascades. Test against that instead.
    //RED  = fragment above mean sea level (worldPosition.y > baseHeightOffset) =
    //       a real visible crest. BLUE = summed-fold turbulence (max(0,1-J) from
    //       the all-cascade Jacobian, line ~1212) ×4 gain. MAGENTA = fold on a
    //       visible crest = correct whitecap placement. If RED is all-or-nothing,
    //       baseHeightOffset isn't the mean and we pick a better reference.
    float crest = step(restWaterLevel, worldPosition.y);
    float fold  = clamp(turbulence * 4.0, 0.0, 1.0);
    gl_FragColor = vec4(crest, 0.0, fold, 1.0);
  }
  //Mode 40: cascade-band colour field, blended translucently over the real
  //render (opacity = debugBlend, set via window.setDebugBlend). Each FFT
  //cascade gets a rainbow colour; per fragment we weight those colours by the
  //SAME per-cascade distance fades the normal path uses (C0/C1 always full;
  //C2 ×50, C3 ×100, C4 ×250, C5 ×500), then normalise to the surviving mix.
  //So the hue at a fragment tells you which cascades are still alive there:
  //near camera reads as the full rainbow average, and as the small cascades
  //fade with distance the hue slides toward the C0/C1 (red/orange) + C5
  //(violet) survivors. The hue-shift rings ARE the fade boundaries — line them
  //up against where the sun glint dies to confirm the dead band sits on a
  //cascade cutoff. Recomputes the fades locally (they're block-scoped above).
  else if(oceanShadowDebugMode == 40){
    float f0 = 1.0;
    float f1 = 1.0;
    float f2 = smoothstep(cascadePatchSizes[2] * 50.0,  0.0, distanceToWorldPosition);
    float f3 = smoothstep(cascadePatchSizes[3] * 100.0, 0.0, distanceToWorldPosition);
    float f4 = smoothstep(cascadePatchSizes[4] * 250.0, 0.0, distanceToWorldPosition);
    float f5 = smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToWorldPosition);
    vec3 cascadeField =
        f0 * vec3(1.0, 0.0, 0.0)   //C0 red
      + f1 * vec3(1.0, 0.5, 0.0)   //C1 orange
      + f2 * vec3(1.0, 1.0, 0.0)   //C2 yellow
      + f3 * vec3(0.0, 1.0, 0.0)   //C3 green
      + f4 * vec3(0.0, 0.4, 1.0)   //C4 blue
      + f5 * vec3(0.6, 0.0, 1.0);  //C5 violet
    cascadeField /= max(f0 + f1 + f2 + f3 + f4 + f5, 0.001);
    gl_FragColor = mix(finalRenderedColor, vec4(cascadeField, 1.0), debugBlend);
  }
  //Raw camera→fragment distance as a greyscale ruler: black at the eye, white
  //at ≥10 m (distance / 10, clamped). A plain sanity check for the underwater
  //fog path lengths — this is the straight-line metres to the surface being
  //shaded (the cam→surface leg for the ceiling), NOT the UW_DIST_SCALE-discounted
  //optical path, so the gradient reads in real-world metres.
  else if(oceanShadowDebugMode == 41){
    gl_FragColor = vec4(vec3(clamp(distanceToWorldPosition / 10.0, 0.0, 1.0)), 1.0);
  }
  //Mode 42: is the reflection RT HDR? — the punch-through test. Recomputes the
  //EXACT reflected-RT sample computeUnderwaterCeiling reads (same down-normal,
  //matrix, distortion), BEFORE any fog, and visualises its magnitude:
  //  GREY      = in-range [0,1] reflected radiance (max channel as greyscale).
  //  RED GLOW  = HDR (any channel > 1), saturating to pure red by ~2.0. These are
  //              the fragments that punch straight through the post-bounce |SP|
  //              murk: a ~0.1 murk cannot veil a >1 radiance until transmittance
  //              is near zero, so the reflected floor stays sharp/bright.
  //  DARK BLUE = camera not detected as submerged (ceiling path never runs).
  //If the reflected floor reads RED where it looks "clear" in the normal render,
  //the HDR tonemap-domain split is confirmed (the RT is NoToneMapping/linear,
  //so its geometry is un-compressed HDR, unlike the post-tonemap direct seabed).
  else if(oceanShadowDebugMode == 42){
    if(underwaterFactor < 0.5){
      gl_FragColor = vec4(0.0, 0.0, 0.35, 1.0);
    } else {
      vec3 dbgCeilN = -normalize(displacedNormal);
      vec4 dbgReflProj = underwaterReflectionMatrix * vec4(worldPosition.xyz, 1.0);
      vec2 dbgReflUV = dbgReflProj.xy / max(dbgReflProj.w, 0.0001);
      dbgReflUV += dbgCeilN.xz * UNDERWATER_REFLECTION_DISTORTION;
      vec3 dbgRefl = texture2D(underwaterReflectionTexture,
                               clamp(dbgReflUV, vec2(0.001), vec2(0.999))).rgb;
      float dbgMax = max(max(dbgRefl.r, dbgRefl.g), dbgRefl.b);
      float dbgOver = clamp(dbgMax - 1.0, 0.0, 1.0);
      vec3 dbgCol = vec3(min(dbgMax, 1.0));
      dbgCol.r += dbgOver;
      dbgCol.g *= (1.0 - dbgOver);
      dbgCol.b *= (1.0 - dbgOver);
      gl_FragColor = vec4(clamp(dbgCol, 0.0, 1.0), 1.0);
    }
  }

  //Phase 3a ShoreBreaker debug views.
  //Mode 60: breaker class by surf similarity xi (Battjes bands) where a breaker
  //         exists: green spilling (xi < 0.5), yellow plunging (< 3.3), red
  //         surging. Brighter where the wave is breaking right now; white = foam.
  //         Dark blue = no breaker layer (deep water, land, lee of the wind).
  //Mode 61: breaker height alone, grey = 0, white = +1 m, black = -1 m; red
  //         where breaking.
  else if(oceanShadowDebugMode == 60){
    vec3 dbgCls = breakerXi < 0.5 ? vec3(0.15, 0.8, 0.3) : (breakerXi < 3.3 ? vec3(0.95, 0.8, 0.2) : vec3(0.9, 0.2, 0.2));
    vec3 dbgCol = breakerXi > 0.0 ? dbgCls * (0.35 + 0.65 * breakerBreaking) : vec3(0.02, 0.05, 0.2);
    gl_FragColor = vec4(mix(dbgCol, vec3(1.0), breakerFoam), 1.0);
  }
  else if(oceanShadowDebugMode == 61){
    vec3 dbgCol = vec3(clamp(0.5 + 0.5 * breakerEta, 0.0, 1.0));
    gl_FragColor = vec4(mix(dbgCol, vec3(1.0, 0.1, 0.1), 0.5 * breakerBreaking), 1.0);
  }
  //Phase 3b ShoreReflection debug view.
  //Mode 62: reflected height alone, grey = 0, white = +0.5 m, black = -0.5 m,
  //         tinted blue inside the simulation window so its extent shows.
  else if(oceanShadowDebugMode == 62){
    float dbgEta = shoreReflectionHeightAt(vWorldXZ);
    vec2 dbgD = abs(vWorldXZ - shoreReflectionCenter) / max(shoreReflectionHalfWidth, 0.001);
    float dbgIn = (shoreReflectionEnabled > 0.5 && max(dbgD.x, dbgD.y) < 1.0) ? 1.0 : 0.0;
    vec3 dbgCol = vec3(clamp(0.5 + dbgEta, 0.0, 1.0));
    gl_FragColor = vec4(mix(dbgCol * 0.6, dbgCol * vec3(0.8, 0.9, 1.1), dbgIn), 1.0);
  }
  #if($flowing_water)
  //Mode 63 (flowing surface only): FlowFoamPass coverage, grayscale; blue tint
  //outside the foam window. Mode 64: the current it carries, hue = direction,
  //brightness = speed (full at 3 m/s).
  else if(oceanShadowDebugMode == 63){
    gl_FragColor = vec4(mix(vec3(0.0, 0.0, 0.25), vec3(flowFoamSample.r), flowFoamInside), 1.0);
  }
  else if(oceanShadowDebugMode == 65){
    //Mode 65: flowing-surface small-wave slope (ripples + standing waves) as RG around
    //grey, blue = the slope variance averaged into roughness.
    gl_FragColor = vec4(clamp(0.5 + 2.0 * rippleSlopeVec, 0.0, 1.0), clamp(flowRippleLostVar * 40.0, 0.0, 1.0), 1.0);
  }
  else if(oceanShadowDebugMode == 64){
    float dbgSpeed = clamp(length(flowVelocity) / 3.0, 0.0, 1.0);
    float dbgHue = atan(flowVelocity.y, flowVelocity.x) / 6.2831853 + 0.5;
    vec3 dbgRgb = clamp(abs(fract(dbgHue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    gl_FragColor = vec4(dbgRgb * dbgSpeed, 1.0);
  }
  else if(oceanShadowDebugMode == 66){
    //Mode 66: rendered sheet thickness (surface minus G-buffer ground under the pixel),
    //grey 0 to 0.5 m. Red = below FLOW_FADE_MIN_M (the sheet is dropped there), yellow
    //= inside the fade band, blue = no ground under the pixel (deep).
    vec3 dbgCol = vec3(clamp(flowSheetThickness / 0.5, 0.0, 1.0));
    if(flowSheetThickness > 999.0) dbgCol = vec3(0.0, 0.2, 0.8);
    else if(flowSheetThickness < FLOW_FADE_MIN_M) dbgCol = vec3(0.8, 0.0, 0.0);
    else if(flowSheetThickness < FLOW_FADE_FULL_M) dbgCol = mix(vec3(0.9, 0.8, 0.0), dbgCol, flowThicknessAlpha);
    gl_FragColor = vec4(dbgCol, 1.0);
  }
  #endif

  //Debug overlays — only drawn when oceanShadowDebugMode is non-zero. Bottom-
  //left: raw jacobian mapped [0,2] → [0,1] (grey=1.0=flat, black=0=folded,
  //white=2=stretched). Bottom-right: fftFoamAmount [0,1]. Top strip: 4-up
  //ocean-CSM cascade depth thumbnails (C0..C3 left→right). Depth values land
  //in a narrow band (~0.3-0.7 of the 200m depth window) so the visualisation
  //contrast-stretches that range to black-white. White edges are texels with
  //no caster (cleared to 1.0) — useful for seeing the cascade footprint
  //shrink as you move toward C0.
  if(oceanShadowDebugMode != 0 && !(oceanShadowDebugMode >= 50 && oceanShadowDebugMode <= 55)){
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
      //One read with a runtime layer. This was a four-branch chain until Phase 10
      //because an ARRAY OF SAMPLERS demands a constant integral index; a
      //sampler2DArray takes the cascade as a coordinate instead. Recover the
      //blurred mean depth from the M1_pos moment (R channel) via
      //z = log(M1) / c — the inverse of the caster's exp(c·z) warp.
      float m1 = texture(oceanShadowMap, vec3(thumbUV, float(cascadeIndex))).r;
      float d = log(max(m1, 1.0)) / evsmExpC;
      //Sea-surface depths cluster in [0.3, 0.7]; stretch that band so wave
      //structure shows as gray gradients; cleared/no-caster texels (d=1)
      //stay white.
      float v = clamp((d - 0.3) * 2.5, 0.0, 1.0);
      gl_FragColor = vec4(vec3(v), 1.0);
    }
  }
  //$DEBUG_END$

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

  #if($flowing_water)
    //The hand-off cross-fade and the thin-water fade (see the discards above).
    //Debug views stay opaque.
    if(oceanShadowDebugMode == 0) gl_FragColor.a = flowHandoffAlpha * flowThicknessAlpha * (1.0 - flowFallOwn);
  #endif
}
