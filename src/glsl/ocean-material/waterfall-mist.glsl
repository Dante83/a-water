precision highp float;

//Waterfall mist fragment stage: a raymarched volume inside the CONES ARestlessOcean.WaterfallMistHull
//builds along the water's paths (a closed round tube per few strands and per free-fall run: narrow at
//the lip, opening downward, running on a little way over the pool past the landing).
//
//WHAT IT DRAWS. Each cone is closed and wound outward; the material culls its FRONT faces, so each
//fragment is the point X where a view ray LEAVES the cone. From X the stage marches back toward the
//camera (never past it: the camera may be inside) over the length of the ray's chord through the cone,
//and integrates the volume front to back. The chord is exact for a cylinder about the cone's axis.
//
//THE DENSITY is a function of the distance to the cone's AXIS over its radius, not of any frame that
//follows the ribbon, so it is zero on the cone's wall by construction (no flat sheets of mist standing
//in the air) and the cones cannot twist:
//  radial    (1 - x^2)^p, x = distance to the axis / radius
//  along     u runs 0 at the lip, 1 at the landing, 1..2 over the run-out. It fades the cone in below
//            the lip (uFadeIn) and out over the run-out, and sets WHAT the mist is:
//              FOAM in the middle of the fall: dense, bright, round lumps with some stretch along the
//                flow, so it reads as foam blasting down, riding the water at its own speed;
//              HAZE toward the landing (uHazeStart..1) and over the pool: thin, soft, large round
//                puffs, bluer, drifting out.
//            u is measured per SAMPLE (axial position / the run's length), so one tall cone changes
//            from foam to haze along its own length, and a short fall is all foam with a short haze tail.
//  noise     3D value noise laid out in the water's TIME OF FLIGHT along the flow (so it rides the water at
//            its real speed and its cells stretch as the jet accelerates, like the sheet's grain) and in
//            metres across it, periodic in time (it loops, no seam), shaped by smoothstep so the lumps
//            have defined, billowy edges and the thin rim erodes into clumps.
//  ground    nothing below the landing's height: the cone is allowed to dip under the pool, it just
//            has no density there (it is not clamped to the floor, which made flat walls).
//
//THE LIGHT. Each sample marches a few steps toward the sun for its own SELF-SHADOWING (Beer-Lambert,
//with a cheap multiple-scatter floor so the shaded side is not black), takes a dual-lobe Henyey-
//Greenstein phase (forward-scattering: a backlit fall glows), the scene's sun shadow map and the sky's
//ambient. Units are the sheet's: a white Lambert surface under the sun is INV_PI * brightestDirectionalLight.
//
//OCCLUSION. No depth test (the cones straddle the curtain, whose own depth would hide the half of
//the mist in front of it). Instead (1) the refraction G-buffer (terrain, objects) clips the march, soft
//by uSoftRange, and (2) the curtain is treated as the mostly opaque plane it is: samples behind it,
//inside its width and alongside the falling part of the cone, are dimmed (uSheetOcclusion).
//
//ATMOSPHERE and fog exactly as the sheet does them (see waterfall-sheet.glsl).

uniform vec3 brightestDirectionalLight;
uniform vec3 brightestDirectionalLightDirection;   //from the sun TOWARD the scene
uniform vec3 skyAmbientColor;
uniform float t;

uniform sampler2D sunShadowMap;
uniform mat4 sunShadowMatrix;
uniform vec2 sunShadowMapSize;
uniform float sunShadowRadius;
uniform float sunShadowBias;
uniform int sunShadowEnabled;

uniform sampler2D refractionDepthTexture;
uniform mat4 inverseProjectionMatrix;
uniform vec2 screenResolution;
uniform float underwaterFactor;

uniform float uMistDensity;      //global multiplier on the extinction below
uniform float uFoamDensity;      //1/m extinction at the core of the foam
uniform float uHazeDensity;      //... and of the haze
uniform float uFoamScale;        //m per noise cell in the foam
uniform float uHazeScale;        //... in the haze
uniform float uFoamRate;         //foam noise cells per second of the water's flight along the flow (a cell is that long x the water's speed: streaks that stretch as it accelerates)
uniform float uHazeRate;         //... in the haze (fewer, and the water is slower there: rounder puffs)
uniform float uErodeFoam;        //0..1: noise level below which the foam is carved away
uniform float uErodeHaze;        //... and the haze
uniform float uErodeSoft;        //width of the carve's edge (small: lumps with defined edges)
uniform float uRadialPow;        //exponent of the radial profile (1: soft cone, higher: dense core, soft rim)
uniform float uFadeIn;           //u over which the cone fades in below the lip
uniform float uHazeStart;        //u where foam begins to give way to haze (it is all haze by the landing)
uniform float uMinBody;          //least fraction of full density at low aeration
uniform float uAerationLo;       //aeration where the body starts to rise above uMinBody
uniform float uAerationHi;       //aeration where it is full
uniform float uGroundFade;       //m above the landing's height over which the mist fades in
uniform float uSteps;            //view-ray steps
uniform float uLightSteps;       //sun-ray steps
uniform float uLightLength;      //m the sun ray reaches
uniform float uAbsorption;       //sun-ray extinction as a multiple of the view's
uniform float uPhaseG;           //forward lobe of the phase function
uniform float uAmbient;          //sky fill
uniform float uSunGain;          //sun scatter gain
uniform vec3 uAlbedoFoam;        //single-scatter albedo of the foam
uniform vec3 uAlbedoHaze;        //... and of the haze
uniform float uMaxChord;         //m, longest run marched through a cone
uniform float uSoftRange;        //m of depth over which the mist fades into the ground
uniform float uSheetOcclusion;   //0..1: how opaque the curtain is to the mist behind it
uniform float uMistOpacity;
uniform int uDebugMode;

varying vec3 vWorldPos;
varying vec3 vCenter;  //the cone's axis point at this fragment
varying vec3 vN;       //the CURTAIN's normal here (for the occlusion only)
varying vec3 vT;       //the cone's axis direction (down the flow)
varying vec3 vA;       //the curtain's across direction (for the occlusion only)
varying vec4 vMistA;   //across (m from the curtain's middle), u, radius, seed
varying vec4 vMistB;   //aeration, run length (m), the water's speed (m/s), curtain half-width
varying vec3 vEnd;     //the run's landing point
varying float vTau;    //the water's time of flight at this fragment (s)
varying float vViewDepth;

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

  //Lifted verbatim from waterfall-sheet.glsl (keep in step). The injected functions are the LUT
  //helpers only; the sheet and the creek each define their own applyAtmosphericPerspective on top.
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

//(No PI of our own: the injected atmosphere functions declare one; a second is a link error.)
const float INV_PI = 0.31830988618;
const int MAX_STEPS = 64;
const int MAX_LIGHT_STEPS = 8;

//── Copied from waterfall-sheet.glsl (keep in step) ───────────────────────────
//Applied to AP's output as the sheet does: the sheet and its mist then tone-map alike.
vec4 linearTosRGB(vec4 value){
  return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055), value.rgb * 12.92, vec3(lessThanEqual(value.rgb, vec3(0.0031308)))), value.a);
}
vec3 aroAESFilmicToneMapping(vec3 color){
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}
//──────────────────────────────────────────────────────────────────────────────

//── Noise: ocean-splash.glsl's hash3 / vnoise3 ────────────────────────────────
float hash3(vec3 p){
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise3(vec3 x){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbmOct(vec3 p, int octaves){
  float a = 0.5, s = 0.0, norm = 0.0;
  for(int i = 0; i < 4; i++){
    if(i >= octaves) break;
    s += a * vnoise3(p);
    norm += a;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / norm;
}


//The cone's frame for the noise, set once per fragment in main(): the axis direction and two
//directions across it. (Only the noise uses them; the density mask is the distance to the axis.)
vec3 gT, gE1, gE2;

//Where along the run a sample is: u at the fragment, moved by its axial offset over the run's length.
float mistU(vec3 p, vec3 T){
  return clamp(vMistA.y + dot(p - vCenter, T) / max(vMistB.y, 1.0), 0.0, 2.0);
}

//Value noise PERIODIC along x with period `per` cells (a whole number): the time term is wrapped, and
//noise that did not repeat at the wrap would jump every lump at once.
float vnoise3p(vec3 x, float per){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, per), x1 = mod(i.x + 1.0, per);
  return mix(mix(mix(hash3(vec3(x0, i.y, i.z)),             hash3(vec3(x1, i.y, i.z)),             f.x),
                 mix(hash3(vec3(x0, i.y + 1.0, i.z)),       hash3(vec3(x1, i.y + 1.0, i.z)),       f.x), f.y),
             mix(mix(hash3(vec3(x0, i.y, i.z + 1.0)),       hash3(vec3(x1, i.y, i.z + 1.0)),       f.x),
                 mix(hash3(vec3(x0, i.y + 1.0, i.z + 1.0)), hash3(vec3(x1, i.y + 1.0, i.z + 1.0)), f.x), f.y), f.z);
}
float fbmPer(vec3 p, int octaves, float per){
  float a = 0.5, s = 0.0, norm = 0.0;
  for(int i = 0; i < 4; i++){
    if(i >= octaves) break;
    s += a * vnoise3p(p, per);
    norm += a;
    p = vec3(p.x * 2.0, p.y * 2.03 + 1.7, p.z * 2.03 + 3.1);   //x exactly x2 so the octave repeats too
    per *= 2.0;
    a *= 0.5;
  }
  return s / norm;
}

//The noise, laid out in the WATER'S OWN TIME OF FLIGHT along the flow and in metres across it. A
//parcel that passed the lip at time t0 is at tau = t - t0, so (tau - t) is the same for it all its
//life: the pattern RIDES THE WATER, at the water's real speed, and its cells stretch along the fall
//as the jet accelerates (equal time steps cover more metres where the water is faster), exactly as
//the sheet's grain does. No advection speed to pick, no cross-fade of two copies (which stalled and
//ghosted the pattern at each swap). The along-flow coordinate is the TIME at this sample: the
//fragment's tau, moved by its axial offset over the local speed.
const float MIST_PERIOD = 32.0;   //cells; the time term repeats after this many
float mistNoise(vec3 p, float rate, float scale, int octaves){
  vec3 q = p - vCenter;
  float tauP = vTau + dot(q, gT) / max(vMistB.z, 0.5);
  float xa = mod(tauP * rate - mod(t * rate, MIST_PERIOD) + vMistA.w * MIST_PERIOD, MIST_PERIOD);
  vec3 c = vec3(xa, dot(q, gE1) / scale + vMistA.w * 17.3, dot(q, gE2) / scale + vMistA.w * 9.1);
  return fbmPer(c, octaves, MIST_PERIOD);
}

//Density (1/m) at a world point for the cone this fragment belongs to.
float mistDensity(vec3 p, int octaves){
  vec3 q = p - vCenter;
  vec3 perp = q - gT * dot(q, gT);
  float R = max(vMistA.z, 1e-3);
  float x = length(perp) / R;
  if(x >= 1.0) return 0.0;
  float radial = pow(1.0 - x * x, uRadialPow);
  float u = mistU(p, gT);
  float fadeIn = smoothstep(0.0, max(uFadeIn, 1e-3), u);
  float fadeOut = 1.0 - smoothstep(1.25, 2.0, u);
  float body = max(smoothstep(uAerationLo, uAerationHi, vMistB.x), uMinBody);
  float ground = smoothstep(0.0, max(uGroundFade, 1e-3), p.y - vEnd.y);
  float env = radial * fadeIn * fadeOut * body * ground;
  if(env <= 0.0) return 0.0;
  float haze = smoothstep(uHazeStart, 1.0, u);
  float n = mistNoise(p, mix(uFoamRate, uHazeRate, haze), mix(uFoamScale, uHazeScale, haze), octaves);
  float lo = mix(uErodeFoam, uErodeHaze, haze) + 0.3 * (1.0 - radial);
  float shape = smoothstep(lo, lo + max(uErodeSoft, 1e-3), n);
  return uMistDensity * mix(uFoamDensity, uHazeDensity, haze) * env * shape;
}

//Dual-lobe Henyey-Greenstein, normalised so that isotropic scattering is 1 (a Lambert surface is
//INV_PI * E, so a sample's in-scatter reads in the sheet's units).
float hgIso(float cosT, float g){
  return (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-4), 1.5);
}
float mistPhase(float cosT){
  return mix(hgIso(cosT, uPhaseG), hgIso(cosT, -0.25), 0.25);
}

//The scene's sun shadow at a world point: four taps, no derivatives (this runs in a loop).
float sunShadowAt(vec3 p){
  if(sunShadowEnabled == 0) return 1.0;
  vec4 sp = sunShadowMatrix * vec4(p, 1.0);
  vec3 sc = sp.xyz / sp.w;
  if(sc.z > 1.0 || sc.z < 0.0) return 1.0;
  vec2 edgeDist = min(sc.xy, vec2(1.0) - sc.xy);
  float edge = min(edgeDist.x, edgeDist.y);
  if(edge < 0.0) return 1.0;
  float refZ = sc.z + sunShadowBias;
  vec2 ts = (1.0 / sunShadowMapSize) * sunShadowRadius;
  float s = 0.0;
  s += refZ < texture2D(sunShadowMap, sc.xy + vec2(-0.5, -0.5) * ts).r ? 1.0 : 0.0;
  s += refZ < texture2D(sunShadowMap, sc.xy + vec2( 0.5, -0.5) * ts).r ? 1.0 : 0.0;
  s += refZ < texture2D(sunShadowMap, sc.xy + vec2(-0.5,  0.5) * ts).r ? 1.0 : 0.0;
  s += refZ < texture2D(sunShadowMap, sc.xy + vec2( 0.5,  0.5) * ts).r ? 1.0 : 0.0;
  return mix(1.0, 0.25 * s, smoothstep(0.0, 0.05, edge));
}

void main(){
  vec3 N = normalize(vN), T = normalize(vT), A = normalize(vA);
  vec3 camToX = vWorldPos - cameraPosition;
  float distX = length(camToX);
  vec3 rd = camToX / max(distX, 1e-4);

  //How far back from X to march: the ray's chord through this cone (exact for a cylinder about the
  //axis; X is on its wall or its cap), never past the camera.
  float R = max(vMistA.z, 1e-3);
  vec3 w = vWorldPos - vCenter;
  w -= T * dot(w, T);
  vec3 rp = rd - T * dot(rd, T);
  float a = max(dot(rp, rp), 1e-4);
  float wr = dot(w, rp);
  float disc = max(wr * wr - a * (dot(w, w) - R * R), 0.0);
  float chord = (wr + sqrt(disc)) / a;
  float L = clamp(min(chord, distX), 0.0, uMaxChord);
  if(L < 1e-3) discard;
  int nSteps = int(clamp(uSteps, 4.0, float(MAX_STEPS)));
  float dt = L / float(nSteps);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 start = vWorldPos - rd * L;

  //What the ground behind says: view depth of the nearest opaque thing along this pixel.
  vec2 screenUV = gl_FragCoord.xy / screenResolution;
  float gRaw = texture2D(refractionDepthTexture, screenUV).r;
  float sceneDepth = 1e6;
  if(gRaw < 1.0){
    vec4 gv = inverseProjectionMatrix * vec4(screenUV * 2.0 - 1.0, gRaw * 2.0 - 1.0, 1.0);
    sceneDepth = -gv.z / gv.w;
  }

  vec3 Lsun = -normalize(brightestDirectionalLightDirection);   //toward the sun
  float cosT = dot(rd, Lsun);
  float phase = mistPhase(cosT);
  vec3 sunCol = INV_PI * brightestDirectionalLight * uSunGain;
  vec3 ambient = skyAmbientColor * uAmbient;

  gT = T;
  vec3 across = A - T * dot(A, T);
  if(dot(across, across) < 1e-4) across = cross(T, abs(T.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0));
  gE1 = normalize(across);
  gE2 = cross(T, gE1);

  float camSide = sign(dot(cameraPosition - vCenter, N));
  if(camSide == 0.0) camSide = 1.0;
  float hw = max(vMistB.w, 0.1);

  float Tr = 1.0;
  vec3 acc = vec3(0.0);
  float lightStep = uLightLength / max(uLightSteps, 1.0);
  int nLight = int(clamp(uLightSteps, 1.0, float(MAX_LIGHT_STEPS)));
  float depthLen = 0.0;

  for(int i = 0; i < MAX_STEPS; i++){
    if(i >= nSteps) break;
    float back = L - dt * (float(i) + jitter);   //metres back from X
    vec3 p = start + rd * (dt * (float(i) + jitter));
    float dens = mistDensity(p, 3);
    if(dens <= 0.002) continue;

    //Occlusion: the ground behind (view depth along the ray is linear in distance), then the curtain.
    float viewDepth = vViewDepth * (1.0 - back / max(distX, 1e-4));
    float vis = clamp((sceneDepth - viewDepth) / max(uSoftRange, 1e-3), 0.0, 1.0);
    vec3 dp = p - vCenter;
    float sideOK = smoothstep(-0.15, 0.15, dot(dp, N) * camSide);
    float acrossP = vMistA.x + dot(dp, A);
    float insideSheet = (1.0 - smoothstep(0.9 * hw, 1.05 * hw, abs(acrossP))) * (1.0 - smoothstep(1.0, 1.1, mistU(p, T)));
    vis *= mix(1.0, sideOK, uSheetOcclusion * insideSheet);
    float sigma = dens * vis;
    if(sigma <= 1e-4) continue;

    //Self-shadowing: march toward the sun through the same cone (two octaves, one noise copy).
    float tauL = 0.0;
    for(int k = 0; k < MAX_LIGHT_STEPS; k++){
      if(k >= nLight) break;
      vec3 q = p + Lsun * lightStep * (float(k) + 0.5 + 0.5 * jitter);
      tauL += mistDensity(q, 2) * lightStep;
    }
    tauL *= uAbsorption;
    //Direct term plus a wider, weaker one standing in for the light that scatters round the clump
    //(the shaded side is not black).
    float sunT = (exp(-tauL) + 0.4 * exp(-0.2 * tauL)) / 1.4;
    vec3 albedo = mix(uAlbedoFoam, uAlbedoHaze, smoothstep(uHazeStart, 1.0, mistU(p, T)));
    vec3 scatter = albedo * (sunCol * phase * sunT * sunShadowAt(p) + ambient);

    float stepT = exp(-sigma * dt);
    acc += Tr * (1.0 - stepT) * scatter;
    Tr *= stepT;
    depthLen += dt;
    if(Tr < 0.01) break;
  }

  float alpha = (1.0 - Tr) * uMistOpacity;
  if(uDebugMode == 0 && alpha < 0.003) discard;
  vec3 color = acc / max(1.0 - Tr, 1e-4);
  #if($atmospheric_perspective_enabled)
    if(underwaterFactor < 0.5) color = applyAtmosphericPerspective(color, vWorldPos - rd * 0.5 * L);
  #endif
  gl_FragColor = linearTosRGB(vec4(aroAESFilmicToneMapping(color), alpha));

  //$DEBUG_START$
  if(uDebugMode == 1) gl_FragColor = vec4(vec3(1.0 - Tr), 1.0);                                   //opacity
  else if(uDebugMode == 2) gl_FragColor = vec4(vec3(clamp(vMistA.y * 0.5, 0.0, 1.0)), 1.0);       //u at the exit point: 0 lip, .5 landing, 1 run-out end
  else if(uDebugMode == 3) gl_FragColor = vec4(vec3(clamp(L / uMaxChord, 0.0, 1.0)), 1.0);        //chord
  else if(uDebugMode == 4) gl_FragColor = vec4(0.9, 0.2, 0.9, 0.35);                              //the cones
  else if(uDebugMode == 5) gl_FragColor = vec4(vec3(clamp(depthLen / 4.0, 0.0, 1.0)), 1.0);       //path through mist
  else if(uDebugMode == 6){                                                                       //at mid-chord: foam weight (r), haze weight (g), ground (b)
    vec3 pm = vWorldPos - rd * 0.5 * L;
    float um = mistU(pm, T);
    float hz = smoothstep(uHazeStart, 1.0, um);
    gl_FragColor = vec4(1.0 - hz, hz, smoothstep(0.0, max(uGroundFade, 1e-3), pm.y - vEnd.y), 1.0);
  }
  else if(uDebugMode == 8){                                                                       //the raw noise at mid-chord, full contrast (to see / measure how the pattern moves)
    vec3 pm = vWorldPos - rd * 0.5 * L;
    float hz = smoothstep(uHazeStart, 1.0, mistU(pm, T));
    gl_FragColor = vec4(vec3(mistNoise(pm, mix(uFoamRate, uHazeRate, hz), mix(uFoamScale, uHazeScale, hz), 3)), 1.0);
  }
  else if(uDebugMode == 7) gl_FragColor = vec4(vec3(clamp(mistDensity(vWorldPos, 3) * 10.0, 0.0, 1.0)), 1.0);   //density AT the wall: must be 0 everywhere (bright = a leak)
  //$DEBUG_END$

  #if(!$atmospheric_perspective_enabled)
    #include <fog_fragment>
  #endif
}
