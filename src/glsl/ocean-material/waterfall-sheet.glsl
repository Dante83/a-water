precision highp float;

//Waterfall sheet fragment stage (Phase 6).
//
//ONE WATER, NOT TWO. The creek above a lip and the pool below it are drawn by the
//flowing-water material; this sheet is drawn in between. Dante's brief was that the
//fall must look like the same water, only foamier. So every input that sets the
//colour of water here is the SAME uniform object as the flowing material's (the pass
//aliases them, it does not copy them): the Jerlov absorption/scattering, the metered
//sun, the sky ambient, the scene sun shadow, and the foam grain textures. The functions
//that turn them into colour are copies of the water shader's (underwaterInscatterSurface,
//the ambient-built sky, the Phong sun, getSunShadow, the ACES + sRGB tail), marked where
//they live so they can be kept in step.
//
//WHAT IS NEW IS THE WHITE. A fall is white because of the air in it, so the whitewater
//is an optical model of bubbly water (see AERATED WATER in main), not the creek's
//painted-on foam: the nappe's aeration sets the void fraction, the creek's foam grain
//streaks it, and the lighting is Lambert-like in the same units as the creek's foam.
//
//THE GRAIN RIDES THE WATER. The foam textures are sampled at
//  (across metres, (tau - t) * grainRate)
//where tau is the parcel's time of flight at this point of the path. A parcel launched
//at time t0 sits where tau = t - t0, so (tau - t) is constant along its life: the grain
//is carried with the water, and because equal time steps cover more metres where the
//water is faster, the grain STRETCHES down the fall exactly as the jet accelerates.
//No flow map, no advection pass.
//
//COMPOSITING: THE CREEK'S REFRACTION, NOT AN ALPHA LAYER. The creek draws clear water as
//an opaque surface that relights the terrain behind it from the refraction G-buffer and
//filters it through the water column (Beer-Lambert + inscatter). The sheet does the same,
//so where one hands over to the other they read as one water: an alpha-blended film
//looked like bare rock over the grey scarp where the creek had looked like 40 cm of tinted
//water (hero-creek-sky, 2026-09-21). The background is sampled a little off-axis along the
//lumpy normal (refraction), relit exactly as the creek relights terrain, and filtered
//through the water the view actually crosses: on the lead-in over the bed, the whole
//column down to it; on the free fall, only the sheet's thickness (air behind). The bubbles
//let slabTdir of that through. Output is opaque; alpha is kept only for the fades
//(presence, frayed edges, strands, the soft contact).
//
//ATMOSPHERE: exactly the creek's arrangement. With atmospheric perspective on, the atmosphere
//functions are injected (at the water's injection marker, by the template's builder), the
//sheet reflects a-starry-sky's sky and applies AP itself, and the scene fog chunk is left out;
//with it off, the scene fog chunk runs at the end of main.

uniform vec3 brightestDirectionalLight;
uniform vec3 brightestDirectionalLightDirection;   //from the sun TOWARD the scene
uniform vec3 skyAmbientColor;
uniform vec3 waterAbsorption;
uniform vec3 waterScattering;
uniform float waterSurfaceY;
uniform float specBoost;
uniform float t;

uniform sampler2D sunShadowMap;
uniform vec2 sunShadowMapSize;
uniform float sunShadowRadius;
uniform float sunShadowBias;
uniform int sunShadowEnabled;

uniform sampler2D refractionLinearDepth;
uniform sampler2D refractionColorTexture;   //G-buffer 0: linear albedo
uniform sampler2D gBufferNormal;            //G-buffer 1: world normal
uniform sampler2D refractionDepthTexture;   //raw NDC depth
uniform mat4 sunShadowMatrix;
uniform mat4 inverseProjectionMatrix;
uniform mat4 inverseViewMatrix;
uniform vec2 screenResolution;
//The creek's screen-space reflection (lifted from water-shader.glsl, see below) and what it reads.
uniform vec2 cameraNearFar;
uniform mat4 ssrViewMatrix;
uniform mat4 ssrProjectionMatrix;
uniform float ssrMaxSteps;
uniform sampler2D blueNoiseTexture;
uniform sampler2D meteringSurveyTexture;
uniform float meteringSurveyValid;
uniform float underwaterFactor;
//The creek's own visibility rules, evaluated here so the attached ends draw exactly where it
//does not (aliased from the flowing material: its WaterField cascade 0 and ring 0's corridors).
uniform sampler2D waterFieldCascade0;
uniform vec2 waterFieldCascadeCenter[3];
uniform float waterFieldCascadeHalfWidth[3];
const int FALL_CORRIDOR_MAX = 24;
uniform vec4 fallCorridorA[FALL_CORRIDOR_MAX];
uniform vec4 fallCorridorB[FALL_CORRIDOR_MAX];
uniform int fallCorridorCount;

uniform sampler2D foamOpacityMap;
//The creek's ripple profile buffer (FlowSurfacePass) and its live knob: the lead-in's surface
//IS the creek's, so it carries the creek's ripples.
uniform sampler2D flowWaveProfile;
uniform float flowRippleScale;
uniform sampler2D foamNormalMap;

uniform float uGrainScale;       //metres per foam tile ACROSS the sheet (the creek uses 2 m)
uniform float uGrainRate;        //foam tiles per second of flight ALONG it
uniform float uVoidMax;          //air void fraction at full aeration (free-falling jets: 0.1-0.5)
uniform float uBubbleRadius;     //m, mean bubble radius (white water: 1-2 mm)
uniform float uSurfaceRough;     //how hard the grain's normals break the jet's surface
uniform float uSpecFalloff;      //Phong exponent of the sun glint on the clear lip
uniform float uEdgeFray;         //how far the grain eats into the side edges (0..1 of half-width)
uniform float uBreakup;          //how far an airborne, aerated jet opens into strands (0..1)
uniform float uRefraction;       //how far the lumpy normal bends the view of what is behind (UV per unit normal)
uniform float uSoftRange;        //metres of depth over which the sheet fades into the ground
uniform float uOpacity;
uniform int uDebugMode;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec4 vFlowA;
varying vec4 vFlowB;
varying vec4 vSunShadowCoord;
varying float vViewDepth;
varying vec2 vFlowVel;

//Fog and atmosphere exactly as water-shader.glsl declares them: the scene fog chunk only
//with atmospheric perspective OFF (a-starry-sky's fog branch tone-maps AGAIN, which washed
//this already tone-mapped sheet toward the terrain's orange, round 5); with it ON, the
//atmosphere functions are injected here and the sheet applies AP itself, like the creek.
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

//(No PI of our own: the injected atmosphere functions declare one; a second is a link error.)
const float INV_PI = 0.31830988618;
//── Copied from water-shader.glsl (keep in step) ──────────────────────────────
const float r0 = 0.02;
const float UW_PI = 3.14159265359;
const float UW_HG_G = 0.5;
const float UW_INV_4PI = 0.07957747154;
const float UW_MURK_GAZE_WEIGHT = 0.0;

float fresnelAirToWater(float cosTheta){
  return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
}

float henyeyGreenstein(float cosTheta, float g){
  float g2 = g * g;
  return (1.0 - g2) * UW_INV_4PI / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5);
}

//water-shader.glsl underwaterInscatterSurface: the medium's single + multiple scatter
//equilibrium for a view direction (camera -> fragment).
vec3 underwaterInscatterSurface(vec3 viewDirWorld){
  vec3 extinction = waterAbsorption + waterScattering;
  vec3 albedo = waterScattering / max(extinction, vec3(1e-4));
  float sunCosZenith = max(dot(-brightestDirectionalLightDirection, vec3(0.0, 1.0, 0.0)), 0.0);
  float sunTransmission = 1.0 - fresnelAirToWater(sunCosZenith);
  vec3 directDownwelling = brightestDirectionalLight * sunTransmission * sunCosZenith;
  vec3 ambientDownwelling = skyAmbientColor;
  float cosTheta = -dot(viewDirWorld, brightestDirectionalLightDirection);
  float pSun = mix(UW_INV_4PI, henyeyGreenstein(cosTheta, UW_HG_G), UW_MURK_GAZE_WEIGHT);
  float pSky = 1.0 / (2.0 * UW_PI);
  vec3 singleScatter = albedo * (directDownwelling * pSun + ambientDownwelling * pSky);
  vec3 totalDownwelling = directDownwelling + ambientDownwelling;
  vec3 sqrtOneMinusA = sqrt(max(vec3(1.0) - albedo, vec3(0.0)));
  vec3 rInf = (vec3(1.0) - sqrtOneMinusA) / (vec3(1.0) + sqrtOneMinusA);
  vec3 multiScatter = rInf * totalDownwelling * (1.0 / UW_PI);
  float camDepth = max(0.0, waterSurfaceY - cameraPosition.y);
  vec3 camDepthDarken = exp(-(waterAbsorption + waterScattering) * camDepth);
  return (singleScatter + multiScatter) * camDepthDarken;
}

//water-shader.glsl computeStandaloneSkyRadiance: the sky when no provider bound one.
vec3 computeStandaloneSkyRadiance(vec3 worldDir){
  float up = pow(clamp(worldDir.y, 0.0, 1.0), 0.55);
  vec3 horizon = skyAmbientColor * 0.75;
  vec3 zenith  = skyAmbientColor * 1.35;
  vec3 sky = mix(horizon, zenith, up);
  sky = mix(horizon, sky, smoothstep(-0.15, 0.02, worldDir.y));
  return sky;
}

//── Lifted verbatim from water-shader.glsl (keep in step): the creek's sky and AP ──────
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

//What the sheet sees of the sky where nothing is behind it (and what the SSR below falls
//back to through its own lookup): the creek's sky. With atmospheric perspective ON that is
//a-starry-sky's own sky through its LUTs (computeSkyRadiance). With it OFF, the water's
//ambient-built sky rather than the metering-survey fisheye: that fisheye read back all zeros
//on hero-creek-sky and the sheet reflected black (round 2). Rays below the horizon would see
//terrain, not sky, and fade to a dim ground bounce (FUDGE 0.25) in both cases.
vec3 skyRadiance(vec3 dir){
  vec3 upDir = normalize(vec3(dir.x, max(dir.y, 0.0), dir.z));
  #if($atmospheric_perspective_enabled)
    vec3 sky = computeSkyRadiance(upDir);
  #else
    vec3 sky = computeStandaloneSkyRadiance(upDir);
  #endif
  return mix(skyAmbientColor * 0.25, sky, smoothstep(-0.3, 0.05, dir.y));
}

//── Lifted verbatim from water-shader.glsl (keep in step): the creek's SSR ─────────────
//The lip and the lead-in are the creek's surface carried on, so they reflect the banks and
//the sky the way the creek does (Dante, round 6: the top looked duller than the creek).
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

//── How visible the creek is here (water-shader.glsl, $flowing_water; keep in step) ──
//The same two rules that decide where the flowing surface draws: its thin-water fade
//(FLOW_FADE_MIN_M 3 cm → FLOW_FADE_FULL_M 10 cm of its level over the G-buffer ground under
//the pixel) and, inside a fall's corridor, stepping aside where its level is steep
//(flowFallOwn). Not mirrored: the still/flowing hand-off weight and the bank taper, which
//are ~1 and ~0 in a creek at a fall. Outside the flowing surface's window: 0 (no creek).
float creekCorridorWeight(vec2 p){
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
    float inside = smoothstep(-0.5, 0.0, along) * smoothstep(-0.5, 0.0, len - along)
                 * (1.0 - smoothstep(r - 0.5, r, across));
    w = max(w, inside);
  }
  return w;
}
float creekLevel0(vec2 xz){
  vec2 uv = (xz - waterFieldCascadeCenter[0]) / (2.0 * waterFieldCascadeHalfWidth[0]) + 0.5;
  return texture2D(waterFieldCascade0, uv).r;
}
float creekVisibleAt(vec2 xz, float groundY, bool haveGround){
  vec2 d = abs(xz - waterFieldCascadeCenter[0]);
  if(max(d.x, d.y) > 0.89 * waterFieldCascadeHalfWidth[0]) return 0.0;
  float level = creekLevel0(xz);
  float vis = haveGround ? smoothstep(0.03, 0.10, level - groundY) : 1.0;
  float corr = creekCorridorWeight(xz);
  if(corr > 0.0){
    const float FALL_EPS = 0.75;
    float fxm = creekLevel0(xz - vec2(FALL_EPS, 0.0)), fxp = creekLevel0(xz + vec2(FALL_EPS, 0.0));
    float fzm = creekLevel0(xz - vec2(0.0, FALL_EPS)), fzp = creekLevel0(xz + vec2(0.0, FALL_EPS));
    float slope = length(vec2(fxp - fxm, fzp - fzm)) / (2.0 * FALL_EPS);
    vis *= 1.0 - corr * smoothstep(0.176, 0.364, slope);
  }
  return vis;
}

//── The creek's ripples (water-shader.glsl, Phase 4 step 4), for the lead-in ─────────
//Same sixteen directions of the same profile buffer, advected with the current by the same
//two-phase trick. Differences, flagged: the energy is a mid value (the creek reads it from
//FlowFoamPass, which this pass does not sample), and FLOW_WAVE_PERIOD is written in here
//(the creek gets it substituted from FlowSurfacePass.WAVE_PERIOD; keep the two equal).
const float SHEET_FLOW_WAVE_PERIOD = 8.0;
float sheetHash(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float sheetValueNoise(vec2 q){
  vec2 i = floor(q);
  vec2 f = q - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sheetHash(i), sheetHash(i + vec2(1.0, 0.0)), f.x),
             mix(sheetHash(i + vec2(0.0, 1.0)), sheetHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 creekRippleSlope(vec2 xz, vec2 vel){
  float speed = length(vel);
  float rippleSlope = max(0.05, (0.035 + 0.13 * 0.5) * smoothstep(0.05, 0.6, speed)) * flowRippleScale;
  const float RIPPLE_ADVECT_PERIOD = 2.0;
  float ra = fract(t / RIPPLE_ADVECT_PERIOD);
  float rb = fract(ra + 0.5);
  float rmix = abs(1.0 - 2.0 * ra);
  vec2 xa = xz - vel * ra * RIPPLE_ADVECT_PERIOD;
  vec2 xb = xz - vel * rb * RIPPLE_ADVECT_PERIOD + vec2(3.7, 1.9);
  vec2 sv = vec2(0.0);
  float scaleSq = 0.0;
  for(int d = 0; d < 16; d++){
    float fd = float(d);
    float ang = (fd + 0.5) * 0.19634954 + 0.09 * sin(fd * 2.39);
    vec2 dir = vec2(cos(ang), sin(ang));
    float stretch = 1.0 + 0.071 * fd;
    float off = fract(sin(fd * 12.9898) * 43758.5453);
    float amp = 0.3 + 0.7 * sheetValueNoise(xa * 0.21 + vec2(fd * 7.13, fd * 3.37));
    float sa = texture2D(flowWaveProfile, vec2(dot(xa, dir) * stretch / SHEET_FLOW_WAVE_PERIOD + off, 0.5)).g;
    float sb = texture2D(flowWaveProfile, vec2(dot(xb, dir) * stretch / SHEET_FLOW_WAVE_PERIOD + off, 0.5)).g;
    sv += dir * mix(sa, sb, rmix) * stretch * amp;
    scaleSq += stretch * stretch;
  }
  return sv * rippleSlope * inversesqrt(0.5 * 0.55 * scaleSq);
}

//water-shader.glsl getSunShadow (3x3 PCF + receiver-plane slope bias + edge fade).
float getSunShadow(vec4 shadowCoord){
  if(sunShadowEnabled == 0) return 1.0;
  vec3 sc = shadowCoord.xyz / shadowCoord.w;
  if(sc.z > 1.0 || sc.z < 0.0) return 1.0;
  vec2 edgeDist = min(sc.xy, vec2(1.0) - sc.xy);
  float edge = min(edgeDist.x, edgeDist.y);
  if(edge < 0.0) return 1.0;
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
  return mix(1.0, shadow, smoothstep(0.0, 0.05, edge));
}

vec4 linearTosRGB(vec4 value){
  return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055), value.rgb * 12.92, vec3(lessThanEqual(value.rgb, vec3(0.0031308)))), value.a);
}

//Private name on purpose: see the ⚠ note on aroAESFilmicToneMapping in water-shader.glsl.
vec3 aroAESFilmicToneMapping(vec3 color){
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}
//──────────────────────────────────────────────────────────────────────────────

void main(){
  float tau       = vFlowA.x;
  float across    = vFlowA.y;
  float thickness = vFlowA.z;
  float aeration  = vFlowB.x;
  float presence  = vFlowB.y;
  float airborne  = vFlowB.z;
  float halfWidth = vFlowB.w;
  if(presence * uOpacity < 0.003) discard;

  vec3 V = normalize(cameraPosition - vWorldPos);
  //Double-sided: shade the face the camera sees. Turned toward the VIEWER, not by
  //gl_FrontFacing: the ribbon's winding is not tied to which way the nappe's normal points,
  //and a back-facing normal made N·V < 0, Fresnel 1, and the whole film an opaque mirror.
  //Both faces of a thin film are water surfaces, so either is right.
  vec3 N = normalize(vWorldNormal);
  if(dot(N, V) < 0.0) N = -N;
  vec3 L = -brightestDirectionalLightDirection;

  //── Grain, carried with the water (see the header) ─────────────────────────
  float tWrap = mod(t, 256.0);  //a whole number of tiles at uGrainRate 1, so the wrap is seamless there
  vec2 grainUV  = vec2(across * halfWidth / uGrainScale, (tau - tWrap) * uGrainRate);
  //Second layer rotated and rescaled, like the creek's foamTextureUV2, to break the tile.
  vec2 grainUV2 = vec2(grainUV.y * 0.73 + 0.31, -grainUV.x * 0.73 + 0.57);
  float foamMask   = 0.5 * (texture2D(foamOpacityMap, grainUV).r   + texture2D(foamOpacityMap, grainUV2).r);
  vec2  foamNMXZ   = 2.0 * (0.5 * (texture2D(foamNormalMap, grainUV).xy + texture2D(foamNormalMap, grainUV2).xy)) - 1.0;

  //Ribbon frame from the normal: across is horizontal, the flow direction lies in the sheet.
  vec3 acrossDir = cross(N, vec3(0.0, 1.0, 0.0));
  acrossDir = dot(acrossDir, acrossDir) > 1e-4 ? normalize(acrossDir) : vec3(1.0, 0.0, 0.0);
  vec3 flowDir = normalize(cross(acrossDir, N));

  float sunShadow = getSunShadow(vSunShadowCoord);

  //The jet's surface is not glass: it is broken by the same grain that carries its air,
  //so the clear parts glitter instead of mirroring one sky colour.
  vec3 NsGrain = normalize(N + (acrossDir * foamNMXZ.x + flowDir * foamNMXZ.y) * uSurfaceRough);
  //On the lead-in (attached, over the creek's bed) the surface is the creek's: its ripples,
  //not the fall's grain, so the creek's texture carries on into the lip.
  vec2 rs = creekRippleSlope(vWorldPos.xz, vFlowVel);
  vec3 NsCreek = normalize(N - vec3(rs.x, 0.0, rs.y));
  vec3 Ns = normalize(mix(NsCreek, NsGrain, airborne));
  float NdotV = clamp(dot(Ns, V), 0.0, 1.0);
  float path = thickness / max(NdotV, 0.2);

  //── AERATED WATER: a slab of bubbly water ───────────────────────────────
  //A waterfall is white because of AIR, and very little air does it. Bubbles of radius r
  //at void fraction α scatter with σ = 1.5·α/r per metre (geometric cross-section πr² per
  //bubble, extinction efficiency 2, α/(4/3·πr³) bubbles per m³): at α = 5 % and r = 1.5 mm
  //that is 50 per metre, an optical depth of 5 through a 10 cm sheet. So the white is
  //computed, not painted on: α comes from the nappe's aeration, streaked by the creek's own
  //foam grain; the slab's diffuse reflectance and transmittance come from a two-stream
  //estimate with the bubbles' forward-peaked phase (g = 0.85, the usual value for bubbles
  //of this size); what is not scattered or reflected shows the scene behind.
  float voidFrac = uVoidMax * aeration * mix(0.25, 1.75, foamMask);
  float tauB = 1.5 * voidFrac / uBubbleRadius * path;
  const float BUBBLE_G = 0.85;
  float tauR = (1.0 - BUBBLE_G) * tauB;
  float slabR = tauR / (2.0 + tauR);                    //diffusely reflected (toward the light's side)
  float slabTdir = exp(-tauB);                          //straight through, unscattered
  float slabTdif = max(1.0 - slabR - slabTdir, 0.0);    //diffusely transmitted
  //Irradiance on the camera's face and on the far face. The far face's light reaches the
  //camera by diffuse TRANSMISSION: a back-lit fall glows.
  float NdotL = dot(Ns, L);
  vec3 sunE = INV_PI * brightestDirectionalLight * sunShadow;
  vec3 frontE = sunE * max(NdotL, 0.0) + skyAmbientColor * (0.5 + 0.5 * Ns.y);
  vec3 backE  = sunE * max(-NdotL, 0.0) + skyAmbientColor * (0.5 - 0.5 * Ns.y);
  //Water absorption along the view path through the sheet; half of it applied to the
  //scattered light, which on average travels about half-way in before it turns round.
  vec3 Twater = exp(-(waterAbsorption + waterScattering) * path);
  //No foam-texture ALBEDO here: the creek's foam diffuse map is dark between its bubbles by
  //design (its opacity map hides those pixels), and multiplying a slab's light by it drew
  //the gaps as dark navy water. Bubbles scatter almost without loss; the grain already
  //modulates how much air there is (voidFrac), and the water's absorption tints it.
  vec3 bubbleLit = (slabR * frontE + slabTdif * backE) * mix(vec3(1.0), Twater, 0.5);

  //── The film's surface and its medium ─────────────────────────────────────
  float F = fresnelAirToWater(NdotV);
  //March on the smooth (displaced) normal, sample the sky on the detailed one: the creek's
  //split (see screenSpaceReflection). Detail in the march scatters it; none in the sky mirrors.
  vec3 reflected = screenSpaceReflection(vWorldPos, reflect(-V, N), reflect(-V, Ns));
  vec3 R = reflect(-L, Ns);
  vec3 glint = brightestDirectionalLight * pow(max(0.0, dot(R, V)), uSpecFalloff) * specBoost * sunShadow;
  vec3 inscatter = underwaterInscatterSurface(-V);

  //── What is behind: the creek's refraction model (see COMPOSITING) ─────────
  vec2 screenUV = gl_FragCoord.xy / screenResolution;
  vec2 refrUV = clamp(screenUV + (Ns.xz - N.xz) * uRefraction, vec2(0.001), vec2(0.999));
  vec3 behind = skyRadiance(-V);        //nothing behind: the sky seen through the water
  float behindDist = 1000.0;
  float bedColumn = -1.0;
  for(int attempt = 0; attempt < 2; ++attempt){
    vec2 uv = attempt == 0 ? refrUV : screenUV;
    float raw = texture2D(refractionDepthTexture, uv).r;
    if(raw >= 1.0) break;
    vec4 vp = inverseProjectionMatrix * vec4(uv * 2.0 - 1.0, raw * 2.0 - 1.0, 1.0);
    vp /= vp.w;
    vec3 P = (inverseViewMatrix * vp).xyz;
    //A bent sample that lands on something IN FRONT of the sheet is not behind it: retry
    //straight through.
    if(dot(P - vWorldPos, -V) < 0.0) continue;   //-V points from the camera to the fragment
    vec3 bgN = normalize(texture2D(gBufferNormal, uv).rgb);
    vec3 bgAlbedo = texture2D(refractionColorTexture, uv).rgb;
    behindDist = distance(vWorldPos, P);
    if(P.y < vWorldPos.y){
      //UNDER the water (the creek's bed below the lead-in): lit as water-shader.glsl lights
      //its seabed, by the sun refracted in and filtered down the column, plus the sky tinted
      //by the water. The above-water formula lit it as dry ground: a bright brown band
      //between the creek and the fall (Dante, round 5).
      vec3 sunDirInWater = refract(brightestDirectionalLightDirection, vec3(0.0, 1.0, 0.0), 1.0 / 1.33);
      vec3 toSunInWater = -sunDirInWater;
      float upY = max(toSunInWater.y, 0.05);
      float downPath = max(0.0, vWorldPos.y - P.y) / upY;
      float sunCosZenith = max(dot(L, vec3(0.0, 1.0, 0.0)), 0.0);
      vec3 ext = waterAbsorption + waterScattering;
      vec3 sunDown = brightestDirectionalLight * (1.0 - fresnelAirToWater(sunCosZenith)) * exp(-ext * downPath);
      float bedShadow = getSunShadow(sunShadowMatrix * vec4(P + toSunInWater * downPath, 1.0));
      vec3 waterAlbedo = waterScattering / max(ext, vec3(1e-4));
      behind = bgAlbedo * (INV_PI * sunDown * max(0.0, dot(bgN, toSunInWater)) * bedShadow + skyAmbientColor * waterAlbedo);
      //The creek's column: vertical depth plus its grazing-path proxy (HORIZONTAL_DEPTH_SCALE).
      bedColumn = (vWorldPos.y - P.y) + length(vWorldPos.xz - cameraPosition.xz) * 0.008;
    }
    else {
      //Above the water (the cliff behind a fall): lit as the creek lights terrain it sees
      //above its surface.
      float bgShadow = getSunShadow(sunShadowMatrix * vec4(P, 1.0));
      behind = bgAlbedo * (INV_PI * brightestDirectionalLight * max(0.0, dot(bgN, L)) * bgShadow + skyAmbientColor);
    }
    break;
  }
  //Water the view crosses to get there: the column on the lead-in, the sheet on the fall.
  float waterPath = mix(bedColumn >= 0.0 ? bedColumn : min(behindDist, 50.0), min(behindDist, path), airborne);
  vec3 Tbody = exp(-(waterAbsorption + waterScattering) * waterPath);
  vec3 body = behind * Tbody + inscatter * (vec3(1.0) - Tbody);
  vec3 color = F * reflected + glint + (1.0 - F) * (bubbleLit + slabTdir * body);

  //── Shape ───────────────────────────────────────────────────────────────
  //Side edges fray with the grain; an airborne, aerated jet opens into strands.
  float edgeN = abs(across) + (foamMask - 0.5) * uEdgeFray;
  float edgeAlpha = 1.0 - smoothstep(0.85, 1.0, edgeN);
  float strands = airborne * uBreakup * smoothstep(0.5, 1.0, aeration);
  float strandAlpha = smoothstep(strands - 0.1, strands + 0.1, foamMask + 0.25 * (1.0 - strands));
  //Soft contact with whatever is behind (the cliff it hugs, the ground it lands on).
  float soft = 1.0;
  float sceneDepth = texture2D(refractionLinearDepth, gl_FragCoord.xy / screenResolution).r;
  if(sceneDepth > 0.0001) soft = clamp((sceneDepth - vViewDepth) / max(uSoftRange, 1e-3), 0.0, 1.0);

  //THE HAND-OFF. On attached rows (the lead-in and the landing tail) the sheet is the
  //complement of the creek: it draws exactly as much as the creek does not, by the creek's
  //own rules at this pixel. A fixed-length overlap either left the creek's holes half filled
  //or laid a second, slightly different water over it (round 7, the interfaces still
  //struggled). The ground is the G-buffer ground under the undistorted pixel, as the creek reads it.
  float creekVis = 0.0;
  if(airborne < 0.999){
    float gRaw = texture2D(refractionDepthTexture, screenUV).r;
    float gY = 0.0;
    bool haveG = gRaw < 1.0;
    if(haveG){
      vec4 gv = inverseProjectionMatrix * vec4(screenUV * 2.0 - 1.0, gRaw * 2.0 - 1.0, 1.0);
      gv /= gv.w;
      gY = (inverseViewMatrix * gv).y;
    }
    creekVis = creekVisibleAt(vWorldPos.xz, gY, haveG);
  }
  float handoff = mix(1.0 - creekVis, 1.0, airborne);
  float outAlpha = presence * handoff * edgeAlpha * strandAlpha * soft * uOpacity;
  #if($atmospheric_perspective_enabled)
    //Aerial perspective, as the creek applies it (above water only).
    if(underwaterFactor < 0.5) color = applyAtmosphericPerspective(color, vWorldPos);
  #endif
  gl_FragColor = linearTosRGB(vec4(aroAESFilmicToneMapping(color), outAlpha));

  //$DEBUG_START$
  if(uDebugMode == 1) gl_FragColor = vec4(vec3(presence), 1.0);
  else if(uDebugMode == 2) gl_FragColor = vec4(vec3(aeration), 1.0);
  else if(uDebugMode == 3) gl_FragColor = vec4(airborne, 0.0, 1.0 - airborne, 1.0);
  else if(uDebugMode == 4) gl_FragColor = vec4(vec3(clamp(thickness / 0.5, 0.0, 1.0)), 1.0);
  else if(uDebugMode == 5) gl_FragColor = vec4(vec3(1.0 - exp(-0.1 * tauB)), 1.0);
  else if(uDebugMode == 6) gl_FragColor = vec4(fract(grainUV), 0.0, 1.0);
  else if(uDebugMode == 7) gl_FragColor = vec4(vec3(outAlpha), 1.0);
  else if(uDebugMode == 8) gl_FragColor = linearTosRGB(vec4(aroAESFilmicToneMapping(bubbleLit), 1.0));
  else if(uDebugMode == 9) gl_FragColor = linearTosRGB(vec4(aroAESFilmicToneMapping(reflected), 1.0));
  else if(uDebugMode == 10) gl_FragColor = vec4(vec3(dot(Tbody, vec3(1.0 / 3.0))), 1.0);
  else if(uDebugMode == 11) gl_FragColor = linearTosRGB(vec4(aroAESFilmicToneMapping(body), 1.0));
  else if(uDebugMode == 12) gl_FragColor = vec4(creekVis, handoff, 0.0, 1.0);
  //$DEBUG_END$

  //The scene fog chunk only when atmospheric perspective is OFF — the water's own rule
  //(water-shader.glsl). With a-starry-sky's AP on, its fog chunk takes the fragment back to
  //linear, adds aerial perspective and tone-maps it AGAIN: right for terrain, which outputs
  //linear, but on this already tone-mapped sheet it washed the colour out toward the
  //terrain's orange, and the lead-in read as ground next to the creek (round 5).
  #if(!$atmospheric_perspective_enabled)
    #include <fog_fragment>
  #endif
}
