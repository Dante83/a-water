precision highp float;

varying vec2 vUv;
varying vec2 vWorldXZ;
varying vec3 vPosition;
varying vec3 vDisplacedPosition;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec3 vInView;
varying mat4 vInstanceMatrix;
varying mat4 vModelMatrix;
varying mat3 vNormalMatrix;
varying vec4 vSunShadowCoord;
varying vec4 vOceanShadowCoord0;
varying vec4 vOceanShadowCoord1;
varying vec4 vOceanShadowCoord2;
varying vec4 vOceanShadowCoord3;

//uniform vec3 cameraDirection;
uniform float sizeOfOceanPatch;
uniform int ringIndex;
uniform float chop;
uniform float largeNormalMapStrength;
uniform float smallNormalMapStrength;
uniform float baseHeightOffset;
uniform sampler2D cascadeDisplacementTextures[6];
uniform sampler2D cascadeSlopeTextures[6];
uniform float cascadePatchSizes[6];
uniform vec2 cascadeSpatialOffsets[6];
uniform float waveHeightMultiplier;
uniform sampler2D smallNormalMap;
uniform sampler2D largeNormalMap;
uniform sampler2D exclusionMap;
uniform sampler2D reflectionTexture;
uniform sampler2D refractionColorTexture;
uniform sampler2D refractionDepthTexture;
uniform vec2 screenResolution;
uniform vec2 cameraNearFar;
uniform mat4 inverseProjectionMatrix;
uniform mat4 inverseViewMatrix;
uniform mat4 reflectionViewProjectionMatrix;
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
  uniform sampler2D foamRoughnessMap;
  uniform float foamStartLevel;
#endif

uniform vec2 smallNormalMapVelocity;
uniform vec2 largeNormalMapVelocity;

uniform vec3 brightestDirectionalLight;
uniform vec3 brightestDirectionalLightDirection;

//Sun shadow map receive. When sunShadowEnabled == 0 the sample function short-
//circuits to 1.0 (unshadowed) so the whole feature is a no-op with no caster.
uniform sampler2D sunShadowMap;
uniform vec2 sunShadowMapSize;
uniform float sunShadowRadius;
uniform float sunShadowBias;
uniform int sunShadowEnabled;

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
//screen is always on regardless of mode.
uniform int oceanShadowDebugMode;
uniform vec3 skyAmbientColor;
uniform float ambientWaterWeight;
uniform vec3 waterAbsorption;
uniform vec3 waterScattering;
uniform float waterMieG;

// Ambient directional lights (for scattering contributions)
uniform int ambientLightCount;
uniform vec3 ambientLightColors[8];
uniform vec3 ambientLightDirections[8];

// New physically-based scattering parameters
uniform float k1ScatterAmount;
uniform float k2ViewDependence;
uniform float k3DirectScatter;
uniform float k4ParallaxScatter;
uniform float waterTurbidity;
uniform float fresnelAbsorptionAmount;

uniform float linearScatteringHeightOffset;
uniform float linearScatteringTotalScatteringWaveHeight;

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
const vec3 inverseGamma = vec3(0.454545454545454545454545);
const vec3 gamma = vec3(2.2);

vec2 vec2Modulo(vec2 inputUV){
  return (inputUV - floor(inputUV));
}

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

//UV margin = 5 texels of inset, sized to exceed the EVSM Gaussian blur
//reach (4 texels each side). Fragments closer than this to a cascade
//edge fall through to the next coarser cascade so they never sample
//moments contaminated by the clear-color baseline outside the caster.
float oceanCascadeMarginUV(int cascadeIdx){
  return 5.0 / oceanShadowMapSize[cascadeIdx].x;
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
    vec3 skyColor = min(texture2D(meteringSurveyTexture, skyUV).rgb, vec3(4.0));
  #endif

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

    float sceneDepth = linearizeDepth(texture2D(refractionDepthTexture, uv).r);
    float rayDepth   = -curPos.z;
    float depthDelta = rayDepth - sceneDepth;
    float farThreshold = cameraNearFar.y * 0.95;
    //Loose crossing gate — every accepted hit gets binary-search refinement
    //and a silhouette check below, so thickness can be generous here.
    float maxThickness = stepLen + 1.0;

    if(depthDelta > 0.0 && depthDelta < maxThickness && uv.y > 0.5 &&
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
        float midDepth = linearizeDepth(texture2D(refractionDepthTexture, midUV).r);
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
      float dN = abs(linearizeDepth(texture2D(refractionDepthTexture, hitUV + vec2( 0.0,  px.y)).r) - hitSceneDepth);
      float dS = abs(linearizeDepth(texture2D(refractionDepthTexture, hitUV + vec2( 0.0, -px.y)).r) - hitSceneDepth);
      float dE = abs(linearizeDepth(texture2D(refractionDepthTexture, hitUV + vec2( px.x, 0.0)).r) - hitSceneDepth);
      float dW = abs(linearizeDepth(texture2D(refractionDepthTexture, hitUV + vec2(-px.x, 0.0)).r) - hitSceneDepth);
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
        vec3  hitColor = sRGBToLinear(vec4(texture2D(refractionColorTexture, hitUV).rgb, 1.0)).rgb;
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

//From https://blog.selfshadow.com/publications/blending-in-detail/
vec3 combineNormals(vec3 normal1, vec3 normal2){
  vec4 n1 = vec4(normal1.xyz, 1.0);
  vec4 n2 = vec4(normal2.xyz, 1.0);
  n1 = n1.xyzz * vec4(2.0, 2.0, 2.0, -2.0) + vec4(-1.0, -1.0, -1.0, 1.0);
  n2 = n2 * 2.0 - vec4(1.0);
  vec3 r;
  r.x = dot(n1.zxx,  n2.xyz);
  r.y = dot(n1.yzy,  n2.xyz);
  r.z = dot(n1.xyw, -n2.xyz);

  return 0.5 * (normalize(r) + vec3(1.0));
}

//Including this because someone removed this in a future versio of THREE. Why?!
vec3 MyAESFilmicToneMapping(vec3 color) {
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}

//GGX microfacet normal distribution (D term)
//From Atlas GDC 2019 / Cook-Torrance: cos_theta = dot(N, H), alpha = roughness
float ggxDistribution(float cosTheta, float alpha) {
  float a2 = alpha * alpha;
  float d = 1.0 + (a2 - 1.0) * cosTheta * cosTheta;
  return a2 / (3.14159265 * d * d);
}

//Smith masking-shadowing (G term) — Beckmann rational approximation
//cos_theta is either NdotL or NdotV depending on which term you're computing
float smithMaskingShadowing(float cosTheta, float alpha) {
  float a = cosTheta / (alpha * sqrt(max(1.0 - cosTheta * cosTheta, 1e-6)));
  float a2 = a * a;
  return a < 1.6 ? (1.0 - 1.259 * a + 0.396 * a2) / (3.535 * a + 2.181 * a2) : 0.0;
}

//Henyey-Greenstein phase function for Mie scattering in water
//g = asymmetry parameter (0.85-0.95 for ocean particles, strongly forward-scattering)
float waterMiePhase(float cosTheta, float g){
  float g2 = g * g;
  float denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * 3.14159265 * denom * sqrt(denom));
}

//Fresnel reflectance at air->water interface (for light entering the water from above)
//Schlick approximation with n_water = 1.33
float fresnelAirToWater(float cosTheta){
  float r0 = 0.02;
  return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
}

// New physically-based scattering terms
// H(x) - Heaviside step function (0 if x < 0, 1 if x >= 0)
float heaviside(float x) {
  return x >= 0.0 ? 1.0 : 0.0;
}

// Term 1: k₁ H ⟨ωᵢ · -ωₒ⟩⁴(0.5 - 0.5(ωᵢ · ωₙ))³
// Wave height scattering — H is wave height, backlit + normal modulation
float scatterTerm1(vec3 sunDir, vec3 viewDir, vec3 normal, float waveHeight, float k1) {
  // H: wave height drives scattering amount (reference: displacementFoam.y * _HeightModifier)
  float H = max(0.0, waveHeight);

  // ⟨ωᵢ · -ωₒ⟩⁴: clamped backlit dot raised to 4th power
  float backlitDot = max(dot(sunDir, -viewDir), 0.0);
  float backlitTerm = backlitDot * backlitDot * backlitDot * backlitDot; // pow 4

  // (0.5 - 0.5(ωᵢ · ωₙ))³: sun-normal angle modulation
  float sunNormalDot = dot(sunDir, normal);
  float normalModulation = pow(0.5 - 0.5 * sunNormalDot, 3.0);

  return k1 * H * backlitTerm * normalModulation;
}

// Term 2: k₂(ωₒ · ωₙ)²
// View-dependent scattering from surface orientation
// Bright when normal faces camera, dark at grazing angles
float scatterTerm2(vec3 viewDir, vec3 normal, float k2) {
  // Use negative view direction: points FROM camera TO surface
  // This makes it positive when normal faces camera
  float viewNormalDot = max(dot(-viewDir, normal), 0.0);
  return k2 * viewNormalDot * viewNormalDot;
}

// Fresnel denominator: 1/(1 + A(ωᵢ))
// A(ωᵢ) based on absorption at incident angle
float fresnelAbsorption(vec3 sunDir, vec3 normal, float absorptionAmount) {
  float sunNormalDot = max(dot(sunDir, normal), 0.0);
  float A = absorptionAmount * (1.0 - sunNormalDot);
  return 1.0 / (1.0 + A);
}

// Term 3: k₃(ωᵢ · ωₙ)
// Direct sun-normal scattering
float scatterTerm3(vec3 sunDir, vec3 normal, float k3) {
  return k3 * max(dot(sunDir, normal), 0.0);
}

// Term 4: k₄ P_f
// P_f = bubble density (foam/turbulence driven)
float scatterTerm4(float bubbleDensity, float k4) {
  return k4 * bubbleDensity;
}

// Accumulate ambient light scattering from all directional lights
vec3 ambientLightScattering(vec3 viewDir, vec3 normal, float waveElevation) {
  vec3 totalAmbientScatter = vec3(0.0);

  for(int i = 0; i < ambientLightCount && i < 8; ++i) {
    // Simple ambient contribution: backlit scattering weighted by light color
    float ambientBacklit = max(-dot(viewDir, ambientLightDirections[i]), 0.0);
    ambientBacklit *= ambientBacklit; // Square for contrast

    // Modulate by wave elevation (higher crests scatter more)
    float ambientTerm = ambientBacklit * waveElevation;

    // Add contribution from this light
    totalAmbientScatter += ambientLightColors[i] * ambientTerm;
  }

  return totalAmbientScatter;
}

#if($caustics_enabled)
  float causticShader(vec2 uv, float t){
    float tModified = (t / 20.0);
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

  mat3 instanceMatrixMat3 = mat3(vInstanceMatrix[0].xyz, vInstanceMatrix[1].xyz, vInstanceMatrix[2].xyz );
  mat3 modelMatrixMat3 = mat3(vModelMatrix[0].xyz, vModelMatrix[1].xyz, vModelMatrix[2].xyz );

  //Use the displaced position from the vertex shader directly — ensures worldPosition
  //matches the actual geometry (vertex shader applies displacementFade; resampling here
  //would skip that, causing LOD tile edge divergence).
  vec3 offsetPosition = vDisplacedPosition;
  //Still need displacement for height-based effects (translucency, scattering)
  vec3 displacement = offsetPosition - vPosition;
  float height = (offsetPosition.y + linearScatteringHeightOffset) / linearScatteringTotalScatteringWaveHeight;
  vec4 worldPosition = vModelMatrix * vInstanceMatrix * vec4(offsetPosition, 1.0);
  vec2 exclusionPosition = 0.5 * (((worldPosition.xz - cameraPosition.xz) / vec2(1024.0)) + 1.0);
  exclusionPosition = vec2(exclusionPosition.x, 1.0 - exclusionPosition.y);
  if(exclusionPosition.x < 1.0 && exclusionPosition.x > 0.0 && exclusionPosition.y < 1.0 && exclusionPosition.y > 0.0){
    vec2 discardHeightData = texture2D(exclusionMap, exclusionPosition).ga;
    float discardHeight = discardHeightData.x;
    if((discardHeightData.y > 0.5) && worldPosition.y > discardHeight){
      discard;
    }
  }
  float distanceToWorldPosition = distance(worldPosition.xyz, cameraPosition.xyz);
  float LOD = pow(2.0, clamp(7.0 - (distanceToWorldPosition / (sizeOfOceanPatch * 7.0)), 2.0, 7.0));

  //Analytical surface normals from FFT slope textures.
  //Each cascade's slope texture contains R=dh/dx, G=dh/dz computed in the frequency domain
  //(h_k spectrum multiplied by i*kx / i*kz, then IFFTed). This gives exact gradients at ALL
  //frequencies with zero finite-difference aliasing — replaces the old Sobel approach that
  //was limited to cascades 0-1 due to Nyquist constraints.
  float normalLodFactor = clamp(1.0 - distanceToWorldPosition / (sizeOfOceanPatch * 7.0), 0.0, 1.0);
  float normalDetailFade = mix(0.15, 1.0, normalLodFactor * normalLodFactor);

  //Central differences on displacement for Jacobian and normals — cascades 0-1 only.
  //Computes full 3D displacement derivatives (not just XZ) so the surface normal
  //can be computed from the cross product of displaced tangent vectors (Crest-style).
  //Using finite differences for ALL components ensures height and chop derivatives
  //are consistent — mixing analytical FFT slopes with finite-difference chop derivatives
  //creates a precision mismatch that produces incorrect normals.
  vec3 rawDdx = vec3(0.0);
  vec3 rawDdz = vec3(0.0);
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
  if(ringIndex <= 3){
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[2] / patchDataSize;
    float fade = clamp(1.0 - distanceToWorldPosition / (cascadePatchSizes[2] * 10.0), 0.0, 1.0);
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2];
    vec3 rawL = texture2D(cascadeDisplacementTextures[2], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[2], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[2], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[2], uv + vec2( 0.0,  eps)).xyz;
    rawDdx += fade * (rawR - rawL) / (2.0 * worldStep);
    rawDdz += fade * (rawT - rawB) / (2.0 * worldStep);
  }
  if(ringIndex <= 2){
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[3] / patchDataSize;
    float fade = clamp(1.0 - distanceToWorldPosition / (cascadePatchSizes[3] * 10.0), 0.0, 1.0);
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3];
    vec3 rawL = texture2D(cascadeDisplacementTextures[3], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[3], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[3], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[3], uv + vec2( 0.0,  eps)).xyz;
    rawDdx += fade * (rawR - rawL) / (2.0 * worldStep);
    rawDdz += fade * (rawT - rawB) / (2.0 * worldStep);
  }
  if(ringIndex <= 1){
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[4] / patchDataSize;
    float fade = clamp(1.0 - distanceToWorldPosition / (cascadePatchSizes[4] * 10.0), 0.0, 1.0);
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4];
    vec3 rawL = texture2D(cascadeDisplacementTextures[4], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[4], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[4], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[4], uv + vec2( 0.0,  eps)).xyz;
    rawDdx += fade * (rawR - rawL) / (2.0 * worldStep);
    rawDdz += fade * (rawT - rawB) / (2.0 * worldStep);
  }
  if(ringIndex == 0){
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[5] / patchDataSize;
    float fade = clamp(1.0 - distanceToWorldPosition / (cascadePatchSizes[5] * 10.0), 0.0, 1.0);
    vec2 uv = (vWorldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5];
    vec3 rawL = texture2D(cascadeDisplacementTextures[5], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[5], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[5], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[5], uv + vec2( 0.0,  eps)).xyz;
    rawDdx += fade * (rawR - rawL) / (2.0 * worldStep);
    rawDdz += fade * (rawT - rawB) / (2.0 * worldStep);
  }
  rawDdx *= waveHeightMultiplier;
  rawDdz *= waveHeightMultiplier;

  //Jacobian: detect surface folds — still used for inscatter modulation and normal blending
  vec2 foamDdx = -chop * rawDdx.xz;
  vec2 foamDdz = -chop * rawDdz.xz;
  float jacobian = (1.0 + foamDdx.x) * (1.0 + foamDdz.y) - foamDdx.y * foamDdz.x;
  float turbulence = max(0.0, 1.0 - jacobian);

  //Persistent foam: read from displacement texture alpha (accumulated by the composer
  //via Jacobian-based ping-pong each frame). Sum active cascades with LOD fade.
  float fftFoamAmount = 0.0;
  {
    vec2 uv0 = (vWorldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0];
    fftFoamAmount += texture2D(cascadeDisplacementTextures[0], uv0).a;
  }
  {
    vec2 uv1 = (vWorldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1];
    fftFoamAmount += texture2D(cascadeDisplacementTextures[1], uv1).a;
  }
  if(ringIndex <= 3){
    vec2 uv2 = (vWorldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2];
    float fade2 = clamp(1.0 - distanceToWorldPosition / (cascadePatchSizes[2] * 10.0), 0.0, 1.0);
    fftFoamAmount += fade2 * texture2D(cascadeDisplacementTextures[2], uv2).a;
  }
  if(ringIndex <= 2){
    vec2 uv3 = (vWorldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3];
    float fade3 = clamp(1.0 - distanceToWorldPosition / (cascadePatchSizes[3] * 10.0), 0.0, 1.0);
    fftFoamAmount += fade3 * texture2D(cascadeDisplacementTextures[3], uv3).a;
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
  displacedNormal = normalize(mix(vec3(0.0, 1.0, 0.0), displacedNormal, foldBlend * normalDetailFade));
  if(displacedNormal.y < 0.0) displacedNormal = -displacedNormal;

  //Macro-scale normal from cascade 0 only — used for GGX specular orientation.
  //Using cascade 0+1 normals for NdotH creates a "sand-ripple" pattern when the moon
  //is perpendicular to the view: each 1-4m wave face creates its own sharp specular
  //hotspot. Cascade 0 only gives a wide, smooth specular lobe (Sea of Thieves style).
  //Fresnel still uses displacedNormal (cascade 0+1) so it correctly matches the geometry.
  vec2 macroSlope = cascade0HeightSlope * waveHeightMultiplier;
  float macroSlopeLen = length(macroSlope);
  if(macroSlopeLen > 1.2) macroSlope *= 1.2 / macroSlopeLen;
  vec3 macroNormal = normalize(vec3(-macroSlope.x, 1.0, -macroSlope.y));
  if(macroNormal.y < 0.0) macroNormal = -macroNormal;
  macroNormal = normalize(mix(vec3(0.0, 1.0, 0.0), macroNormal, foldBlend * normalDetailFade));
  if(macroNormal.y < 0.0) macroNormal = -macroNormal;

  //Shadow factor: scene-wide map (env casters) × ocean CSM (wave self-shadow).
  //Multiplied into every sun-driven term below (SSS, diffuse, specular, foam),
  //but NOT into sky ambient / reflection / refraction. Either being 0 forces
  //full shadow; both 1 means fully lit. macroNormal is the smooth wave normal
  //(cascade 0 only), used by the ocean shadow's normal-based slope bias.
  vec3 sunDirToSky = -brightestDirectionalLightDirection;
  float oceanShadowRaw = getOceanShadow(vOceanShadowCoord0, vOceanShadowCoord1, vOceanShadowCoord2, vOceanShadowCoord3, macroNormal, sunDirToSky);
  float oceanShadowBoosted = clamp(1.0 - OCEAN_SHADOW_DEBUG_DARKNESS_BOOST * (1.0 - oceanShadowRaw), 0.0, 1.0);
  float sunShadowFactor = getSunShadow(vSunShadowCoord) * oceanShadowBoosted;

  //Additive world-space normal blending (Crest-style):
  //Decode only xy of each map (tangent x → world x, tangent y → world z) and
  //add directly to displacedNormal.xz. The y component stays anchored to the
  //FFT value, so hemisphere inversions from steep waves + strong maps are impossible.
  //Normal map UV scale: tile at world-space frequencies appropriate for micro-ripples.
  //Small: ~12m tiles (capillary/wind ripples). Large: sampled at two perpendicular
  //angles (~80m) and averaged — breaks the corduroy banding that comes from scrolling
  //a single directional map in the wind direction.
  vec2 smallNormalMapOffset = (worldPosition.xz + t * smallNormalMapVelocity) / 12.0;
  vec2 largeNormalMapOffset = (worldPosition.xz + t * largeNormalMapVelocity) / 80.0;
  //90°-rotated second sample of the large map to kill directional bias
  vec2 largeNormalMapOffset2 = (vec2(-worldPosition.z, worldPosition.x) + t * largeNormalMapVelocity) / 80.0;
  //Foam textures use a separate UV at a larger world-scale so they don't tile tiny.
  //Two layers: one rotated 90° at a different scale (Crest technique) to kill the brick-tiling pattern.
  vec2 foamTextureUV  = (worldPosition.xz + t * smallNormalMapVelocity) / (sizeOfOceanPatch / 2.0);
  vec2 foamTextureUV2 = (vec2(-worldPosition.z, worldPosition.x) + t * smallNormalMapVelocity) / (sizeOfOceanPatch * 0.365);
  float smallNormalMapFadeout = clamp((500.0 - distanceToWorldPosition) / 250.0, 0.0, 1.0);
  float largeNormalMapFadeout = clamp((3000.0 - distanceToWorldPosition) / 2500.0, 0.0, 1.0);

  //Normal maps re-enabled at reduced strength.
  //The current textures (water-normal-1/2.png) are too rocky — ideally replace them
  //with softer water ripple textures (like Crest's WaveNormals.png). For now, use
  //very low multipliers (0.05) so they add subtle variation to break up coherent FFT
  //banding without imposing a stone-like texture on the surface.
  float normalMapScale = 0.15;
  vec2 smallNM = texture2D(smallNormalMap, smallNormalMapOffset).xy * 2.0 - 1.0;
  vec2 largeNM = (texture2D(largeNormalMap, largeNormalMapOffset).xy +
                  texture2D(largeNormalMap, largeNormalMapOffset2).xy) - 1.0;

  vec3 combinedNormalMap = displacedNormal;
  combinedNormalMap.xz += smallNM * smallNormalMapStrength * normalMapScale * smallNormalMapFadeout;
  combinedNormalMap.xz += largeNM * largeNormalMapStrength * normalMapScale * largeNormalMapFadeout;
  #if($foam_enabled)
    float foamAmount = fftFoamAmount;
    vec2 foamPosition = 0.5 * (((worldPosition.xz - cameraPosition.xz) / vec2(2048.0)) + 1.0);
    foamPosition = vec2(foamPosition.x, 1.0 - foamPosition.y);
    if(foamPosition.x < 1.0 && foamPosition.x > 0.0 && foamPosition.y < 1.0 && foamPosition.y > 0.0){
      vec2 foamHeightData = texture2D(foamRenderMap, foamPosition).ga;
      if((foamHeightData.y > 0.5)){
        foamAmount = max(foamAmount, 1.0 - abs(clamp(worldPosition.y - foamHeightData.x - 10.0, 0.0, 10.0) / 10.0));
      }
    }
    vec2 foamNM = texture2D(foamNormalMap, smallNormalMapOffset).xy * 2.0 - 1.0;
    combinedNormalMap.xz += foamNM * 0.5 * foamAmount * largeNormalMapFadeout;
  #else
    float foamAmount = 0.0;
  #endif
  combinedNormalMap = normalize(combinedNormalMap);

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
  //DIAGNOSTIC: reflection zeroed to isolate the refraction/equilibrium term.
  //vec3 reflectedLight   = vec3(0.0);
  vec3 reflectedLight   = screenSpaceReflection(worldPosition.xyz, ssrReflectDir);

  //Screen-space refraction
  //Distort UVs based on FFT normal only — same reason as reflection: avoids visible normal map tiling
  vec2 distortion = displacedNormal.xz * 0.03;
  vec2 refractedUV = clamp(screenUV + distortion, 0.001, 0.999);

  //Sample refraction color and depth
  float refractionDepthRaw = texture2D(refractionDepthTexture, refractedUV).r;
  float refractionDepthLinear = linearizeDepth(refractionDepthRaw);
  float surfaceDepthLinear = linearizeDepth(gl_FragCoord.z);

  //If distorted UV samples something closer than the water surface, fall back to undistorted
  if(refractionDepthLinear < surfaceDepthLinear - 0.5){
    refractedUV = screenUV;
    refractionDepthRaw = texture2D(refractionDepthTexture, refractedUV).r;
    refractionDepthLinear = linearizeDepth(refractionDepthRaw);
  }

  vec3 refractedLight = sRGBToLinear(vec4(texture2D(refractionColorTexture, refractedUV).rgb, 1.0)).rgb;

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
  bool hasUnderwaterGeom = !isFarPlane && pointXYZ.y < baseHeightOffset && refractionDepthLinear > surfaceDepthLinear;
  float verticalDepth = hasUnderwaterGeom ? max(worldPosition.y - pointXYZ.y, 0.0) : 0.0;
  float horizontalDist = length(worldPosition.xz - cameraPosition.xz);
  //horizontalDepthScale: how many meters of effective depth per meter of horizontal
  //distance. 0.02 → 100m of horizontal fetch ≈ 2m of water, 500m ≈ 10m — enough for
  //blue/green to be meaningfully attenuated at the horizon without choking shallows.
  float horizontalDepthScale = 0.02;
  float effectiveDepth = min(verticalDepth + horizontalDist * horizontalDepthScale, 500.0);
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
  //  ambientDownwelling — diffuse sky hemisphere irradiance (skyAmbientColor).
  //                       Weighted by ambientWaterWeight because skyAmbientColor's
  //                       magnitude isn't in the same units as direct light; a
  //                       literal 1.0 multiplier over-drives the blue glow.
  //The 0.5 is the round-trip factor: light travels down to the scattering event and
  //back up, so the integrated radiance is ∫ L * exp(-2*ext*d) dd = L * albedo / 2.
  //Extinction ordering matters for dusk: orange sky sampled through the water is
  //filtered by transmittance = exp(-extinction * d). Blue must have the SMALLEST
  //extinction so it survives long paths (real clean ocean: Pope & Fry 1997), else
  //a red-heavy sky tinted by green-biased transmittance reads olive.
  vec3 waterAlbedo = waterScattering / max(extinction, vec3(0.0001));
  vec3 directDownwelling = brightestDirectionalLight * sunTransmission * sunCosZenith;
  vec3 ambientDownwelling = skyAmbientColor * ambientWaterWeight;
  vec3 inscatterEquilibrium = waterAlbedo * (directDownwelling + ambientDownwelling) * 0.5;

  //Mie phase function: how much scattered light reaches the camera
  //The scattered light must travel TOWARD the camera (-normalizedViewVector),
  //so the scattering angle is between the incoming sun direction and the
  //outgoing direction toward the camera.
  float cosViewSun = dot(-normalizedViewVector, brightestDirectionalLightDirection);
  float phaseSingle = waterMiePhase(cosViewSun, waterMieG);

  //Multi-scattering approximation: in a thick water column, repeated scattering
  //events isotropize the light field. Model this as an additive isotropic term.
  float phaseMulti = 1.0 / (4.0 * 3.14159265);

  // === NEW PHYSICALLY-BASED SCATTERING MODEL ===
  // Calculate each scattering term separately for debugging/visualization

  float waveElevation = max(height, 0.0);

  // Calculate individual scattering terms
  float term1 = scatterTerm1(-brightestDirectionalLightDirection, normalizedViewVector, displacedNormal, height, k1ScatterAmount);
  float term2 = scatterTerm2(normalizedViewVector, displacedNormal, k2ViewDependence);
  float fresnelFresnel = fresnelAbsorption(-brightestDirectionalLightDirection, displacedNormal, fresnelAbsorptionAmount);
  float term3 = scatterTerm3(-brightestDirectionalLightDirection, displacedNormal, k3DirectScatter);
  //Bubble turbidity: microbubble haze present in all ocean water, not just at foam crests.
  //Uses turbulence (instant Jacobian compression) for wave-dependent churn, plus a constant
  //floor (0.2) for the baseline scatter always present in ocean water.
  //fftFoamAmount is kept for white foam rendering; turbulence drives the scatter model.
  float bubbleDensity = clamp(turbulence + 0.2, 0.0, 1.0);
  //DIAGNOSTIC: term4 (bubble-density haze) zeroed to test whether its raw
  //sun-color * density output (no waterScattering multiplier) is the source of
  //the dusk olive-green tint. Restore by re-enabling the scatterTerm4() call.
  float term4 = 0.0;
  //float term4 = scatterTerm4(bubbleDensity, k4ParallaxScatter);

  // First scattering term: (k₁ ... + k₂ ...) * C_ss * L_sun * Fresnel
  vec3 mainScatter = (term1 + term2) * waterScattering * brightestDirectionalLight * fresnelFresnel * sunShadowFactor;

  // Second scattering term: k₃(ωᵢ · ωₙ) * C_ss * L_sun
  vec3 directScatter = term3 * waterScattering * brightestDirectionalLight * sunShadowFactor;

  // Fourth scattering term: k₄ P_b * L_sun (bubble density, not foam accumulation)
  vec3 term4Scatter = term4 * brightestDirectionalLight * sunShadowFactor;

  // L_scatter = (k1 + k2) * C_ss * L_sun * 1/(1 + A(ωᵢ))
  //           + k3 * C_ss * L_sun
  //           + k4 * P_f * L_sun
  vec3 inscatterLight = (mainScatter + directScatter + term4Scatter) * waterTurbidity;

  // Add ambient light contributions from all directional lights
  vec3 ambientScatter = ambientLightScattering(normalizedViewVector, displacedNormal, waveElevation);
  inscatterLight += ambientScatter * waterScattering;

  /* OLD CODE - COMMENTED OUT FOR REFERENCE
  //Jacobian SSS modulation (Crest technique): flat areas appear clearer/deeper by reducing
  //inscatter; wave crests remain bright as the Jacobian pinches and thins the water column.
  //turbulence is 0 on flat water, >0 at compressed crests.
  //NOTE: was mix(0.5, 1.0) but the 2x contrast made wave crests pitch-black at night
  //(crests have turbulence=0 → inscatter halved → only visible light source gone).
  //Reduced to mix(0.8, 1.0) — still physically meaningful but visually acceptable at night.
  inscatterLight *= mix(0.8, 1.0, turbulence);

  //Wave-crest translucency: estimate light path thickness through the wave body.
  //At a crest the water is thin - light from the sun side passes through a short
  //path and exits toward the camera, giving the characteristic green-gold glow.
  //This only occurs when the crest is backlit (looking through the wave toward the sun).
  //
  //Thickness is approximated from wave height above base water level and the
  //angle between the surface normal and the sun direction. No ray marching needed -
  //just geometry: a steep wave face lit from behind has a very short internal path.
  float minCrestThickness = 3.0;
  float crestThickness = max(linearScatteringTotalScatteringWaveHeight * (1.0 - waveElevation) / sunNormalDot, minCrestThickness);
  float waveThickness = mix(distanceToPoint, crestThickness, waveElevation);
  vec3 waveTransmittance = exp(-extinction * waveThickness);

  //Backlit factor: the translucent glow is only visible when looking through
  //the wave toward the sun. The view vector and light direction face toward each
  //other when backlit (dot < 0), so negate to get a positive value for backlit crests.
  float backlitFactor = max(-dot(normalizedViewVector, brightestDirectionalLightDirection), 0.0);
  backlitFactor *= backlitFactor;

  //Thin crests: transmitted sunlight passes through the wave body with its own
  //absorption color (green-gold for thin water), added on top of the volume inscatter.
  vec3 crestLight = waveTransmittance * sunTransmission * brightestDirectionalLight * waveElevation * backlitFactor;
  inscatterLight += crestLight;
  */

  //Apply Schlick's approximation for the fresnel amount
  //https://graphicscompendium.com/raytracing/11-fresnel-beer
  //Use macro-scale FFT normal (displacedNormal) rather than the full micro-detail combinedNormalMap.
  //Micro-ripples drive the GGX specular D term above; using them here too floods every steep
  //wave face with sky reflection, washing out the whole surface with white.
  float cosTheta = clamp(dot(displacedNormal, -normalizedViewVector), 0.0, 1.0);
  float fresnelFactor = r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);

  //Two decoupled Fresnels so reflection and body weight don't fight over a single value:
  //  fresnelFactor — physical Schlick (→1 at horizon) weights reflectedLight. Full sky
  //                  at the horizon kills the pea-green tint that came from the old cap.
  //  fresnelBody   — soft cap at 0.3 weights (1 - fresnelBody) body color, so at horizon
  //                  sky is fully on but body still contributes ~70% instead of 0. This
  //                  preserves body visibility without fighting the sky reflection.
  float fresnelBody = min(fresnelFactor, 0.3);
  //Clamp HDR values — metering survey is linear float and can be bright near the sun.
  //Cap at 4.0 to prevent saturation while preserving sky brightness range.
  reflectedLight = min(reflectedLight, vec3(4.0));

  #if($caustics_enabled)
    //Calculate caustic lighting using reconstructed world position
    float causticLightingR = causticShader(0.02 * pointXYZ.xz + 0.005, t);
    float causticLightingG = causticShader(0.02 * pointXYZ.xz, t);
    float causticLightingB = causticShader(0.02 * pointXYZ.xz - 0.005, t);
    vec3 causticLighting = causticIntensityMultiplier * 20.0 * vec3(causticLightingR, causticLightingG, causticLightingB);
    if(distance(cameraPosition, pointXYZ.xyz) > 2500.0){
      causticLighting = vec3(1.0);
    }
    refractedLight *= (causticLighting);
  #endif
  //Blend refracted sample with backscatter equilibrium by transmittance.
  //Near-field, shallow: transmittance ≈ 1, refractedLight ≈ sampled scene.
  //Far-horizon / deep: transmittance → 0, refractedLight → inscatterEquilibrium.
  //Continuous across the whole range — no branching, no far-plane cliff.
  refractedLight = refractedLight * transmittance + inscatterEquilibrium * (vec3(1.0) - transmittance);

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
  float specDistAlpha = sqrt(clamp(distanceToWorldPosition / 200.0, 0.0, 1.0));
  vec3 specNormal = normalize(mix(displacedNormal, macroNormal, specDistAlpha));
  float sunFallOff = mix(600.0, 300.0, specDistAlpha);
  //NOTE: no foam-exponent collapse. fftFoamAmount is a wave-compression proxy and
  //reads nonzero on every steep crest — collapsing fallOff there paints the mid-
  //field with broad white highlights that look like wet splatter. The foam diffuse/
  //opacity pass below handles actual whitewater visuals separately.
  vec3 sunReflect = reflect(brightestDirectionalLightDirection, specNormal);
  float sunLobe = pow(max(dot(sunReflect, -normalizedViewVector), 0.0), sunFallOff);
  //Fresnel gate at N·V: head-on barely reflects, grazing catches the full lobe.
  float NdotV = max(dot(specNormal, -normalizedViewVector), 0.0);
  float fresnelSpec = r0 + (1.0 - r0) * pow(1.0 - NdotV, 5.0);
  //Specular boost: Crest's _DirectionalLightBoost defaults ~5; dropped to 3 because
  //the Fresnel gate already pushes grazing waves to full intensity.
  float specularBoost = 3.0;
  vec3 specular = sunLobe * fresnelSpec * specularBoost * lightMag * normalizedLightIntensity * sunShadowFactor;

  //Total light. Sky reflection is geometric — the sky itself isn't darkened
  //by a cloud passing overhead — but in real photos shadowed water reflects
  //a slightly dimmer sky-dome because sun-lit surroundings contribute to its
  //apparent brightness. Attenuate the reflected term by 15% in fully shadowed
  //regions to match that visual cue without killing reflection altogether.
  float reflectionShadowAttenuation = mix(0.85, 1.0, sunShadowFactor);
  vec3 totalLight = specular + (2.0 / 255.0) * directionalSurfaceLighting + (253.0 / 255.0) * ((inscatterLight + refractedLight) * (1.0 - fresnelBody) + reflectedLight * reflectionShadowAttenuation * fresnelFactor);
  //Ambient sky irradiance: diffuse illumination from the sky dome hitting the surface.
  //Without this, high-Fresnel wave faces (crests tilted toward camera) appear black when
  //there is nothing bright to reflect — the Fresnel model alone produces no light there.
  //NdotUp weights by sky exposure; (1-fresnel) keeps this from fighting reflections.
  //Hemisphere ambient: 1.0 facing straight up, 0.5 facing horizontal, 0.0 facing down.
  //Prevents steep wave faces from going black — a vertical face still sees half the sky dome.
  //Hemisphere sky ambient: color from a-starry-sky's y-axis hemisphere light.
  //View-independent and color-correct at all times of day (blue at noon, orange-tinted at sunset).
  //skyFactor: 1.0 facing straight up, 0.5 horizontal, 0.0 facing down.
  //Use FFT geometry normal (no texture maps) for ambient — avoids printing normal map pattern onto the lighting.
  //Crest does the same: geometry normals for SSS/ambient, texture normals only for specular/refraction.
  float skyFactor = 0.5 + 0.5 * dot(displacedNormal, vec3(0.0, 1.0, 0.0));
  totalLight += skyAmbientColor * skyFactor * (1.0 - fresnelFactor) * 0.1;

  //Soft "shadow tint" on the assembled water lighting. Direct-sun terms are
  //already shadow-modulated upstream, but sky reflection + refraction +
  //ambient dominate the open-ocean pixel and aren't sun-driven, so killing
  //the sun-lit fraction alone only darkens the surface ~15-25%. This extra
  //multiply pushes shadowed water visibly darker so cloud/wave shadows read
  //the way they do in real photos. Not strictly physical — it's a
  //perceptual nudge — but matches viewer expectation. Applied BEFORE the
  //foam blend so foam keeps its own per-fragment shadow without double-dip.
  totalLight *= mix(0.7, 1.0, sunShadowFactor);

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
    totalLight = applyAtmosphericPerspective(totalLight, worldPosition.xyz);
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

  //TEMP DEBUG: bottom-left = raw jacobian mapped [0,2] → [0,1] (grey=1.0=flat, black=0=folded, white=2=stretched)
  //            bottom-right = fftFoamAmount [0,1]
  //            top strip = 4-up ocean-CSM cascade depth thumbnails (C0..C3 left→right).
  //            Depth values land in a narrow band (~0.3-0.7 of the 200m depth window)
  //            so the visualisation contrast-stretches that range to black-white.
  //            White edges are texels with no caster (cleared to 1.0) — useful for
  //            seeing the cascade footprint shrink as you move toward C0.
  {
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

  //Blue noise dithering to break banding (same technique as a-starry-sky)
  float goldenRatio = 1.61803398875;
  float framePhase = fract(blueNoiseTime * 0.001);
  ivec2 temporalOffset = ivec2(
    128.0 * fract(framePhase * goldenRatio),
    128.0 * fract(framePhase * goldenRatio * goldenRatio)
  );
  gl_FragColor.rgb += (texelFetch(blueNoiseTexture, (ivec2(mod(gl_FragCoord.xy, 128.0)) + temporalOffset) % 128, 0).rgb - vec3(0.5)) / vec3(128.0);

  #if(!$atmospheric_perspective_enabled)
    #include <fog_fragment>
  #endif
}
