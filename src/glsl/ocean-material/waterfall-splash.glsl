precision highp float;

//Waterfall splash fragment stage: the bursts of spray thrown up where a fall lands, raymarched
//inside the BLOBS ARestlessOcean.WaterfallSplashHull builds (a sphere at each landing, drawn as an
//icosahedron round it). The first of the foot particles; the mist above it is waterfall-mist.glsl.
//
//WHAT IT DRAWS. The material culls FRONT faces, so each fragment is a point where a view ray leaves
//the proxy. The ray is intersected with the blob's exact sphere, clipped at the camera (which may be
//inside), and the volume is integrated front to back over that chord.
//
//THE DENSITY is the model in waterfall-splash-hull.js (read its header). In the blob's frame, z up
//its axis and (x, y) across it:
//  launch ring a sample's (x, y) is where its drops left the water: xi from the middle. They leave
//              at v0(xi) = v0 exp(-xi^2 / 2 b^2) and there are exp(-xi^2 / b^2) of them: the middle
//              is the heaviest and the fastest.
//  the pulse   at several bursts a second the drops of one burst are still in the air when the next
//              fires, so the splash never clears: it is a standing fountain whose LAUNCH SPEED
//              pulses. The pulse is a sum of three sines (uPulseRate and two harmonics that do not
//              divide it, so it does not repeat by eye), between uPulseMin and 1, and its phase is
//              scattered over the footprint by 2D noise, so neighbouring spurts peak at different
//              times instead of the whole foot bobbing as one.
//  height noise the launch speed is also scaled by its own slowly drifting 2D noise over the
//              footprint (uHeightNoise, uHeightScale): a ragged line of tops, not a smooth bell.
//  the top     Z = the apex of a drop launched at that speed (drag flattens the tall ones).
//  radial      the drops fly out as well as up, along rays from a focus under the water, so the
//              splash opens 1 + k wide by its top (k: the hull's fan) and its streaks run out along
//              the rays: a little spherical symmetry.
//  the fall    what goes up comes down: the water that leaves the top of the column lands further out
//              (the hull's fallReach, vSplashC.w: the falling skirt is the column's bell stretched
//              1 + fallReach wide and uFallHeight as tall), LATE (its pulse is the column's from
//              uFallDelay x the middle's fall time ago, so a spurt goes up and a moment later rains
//              down round it), drawn where the column is thin, with streaks that run DOWN at
//              uFallSpeed x uRiseRate and break into flecks sooner (uFallErode). The bounce.
//  the column  from the water to the top the volume is FILLED (uFill at the foot, 1 at the top),
//              with a soft edge above (uTopSoft).
//  noise       3D value noise in metres, its cells stretched uStretch times ALONG the axis and
//              running up it at uRiseRate cells a second (periodic in that direction, so it loops
//              without a seam): vertical streaks of spray, like the grain of the foam coming down.
//              The carve threshold rises toward the top, so the body breaks into streaks and flecks.
//  bounds      nothing below the water's level, and a window that is zero on the sphere, so the
//              density is zero on the blob's wall by construction.
//
//THE LIGHT, OCCLUSION, ATMOSPHERE AND FOG are the mist's (see waterfall-mist.glsl): a short sun march
//for self-shadowing, a dual-lobe Henyey-Greenstein phase, the scene's sun shadow map, the sky's
//ambient; no depth test, the refraction G-buffer clips the march softly.

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

uniform float uSplashDensity;    //1/m extinction at the middle of a full-strength burst
uniform float uSplashScale;      //m per noise cell
uniform float uErode;            //0..1: noise level below which the foot of the column is carved away
uniform float uErodeAge;         //... and how much more at its top (it breaks into streaks and flecks)
uniform float uErodeSoft;        //width of the carve edge
uniform float uStretch;          //how many times longer than wide a noise cell is, along the axis
uniform float uRiseRate;         //noise cells per second the pattern runs up the axis
uniform float uFill;             //0..1: density at the foot of the column, against 1 at its top
uniform float uTopSoft;          //m of soft edge above the top
uniform float uPulseRate;        //pulses per second
uniform float uPulseMin;         //the launch speed between pulses, as a fraction of the peak (never 0: it does not clear)
uniform float uPulseScatter;     //how far (in pulses) the 2D noise scatters the pulse phase over the footprint
uniform float uHeightNoise;      //0..1: how much of the launch speed the 2D height noise takes away at its lowest
uniform float uHeightScale;      //m per cell of the height noise
uniform float uHeightDrift;      //cells per second the height noise changes by
uniform float uFallDensity;      //the falling skirt's density, as a fraction of the column's
uniform float uFallHeight;       //its top, as a fraction of the column's
uniform float uFallDelay;        //how late it is, as a fraction of the middle's time to fall from its apex
uniform float uFallFloor;        //0..1: its density at the water, against 1 at its top (the rain thins as it falls)
uniform float uFallSpeed;        //its streaks run down at this times uRiseRate
uniform float uFallErode;        //how much more it is carved than the column (it is flecks and drops)
uniform float uGroundFade;       //m above the water's level over which the splash fades in
uniform float uSteps;            //view-ray steps
uniform float uLightSteps;       //sun-ray steps
uniform float uLightLength;      //m the sun ray reaches
uniform float uAbsorption;       //sun-ray extinction as a multiple of the view's
uniform float uPhaseG;           //forward lobe of the phase function
uniform float uAmbient;          //sky fill
uniform float uSunGain;          //sun scatter gain
uniform vec3 uAlbedo;            //single-scatter albedo
uniform float uSoftRange;        //m of depth over which the splash fades into the ground
uniform float uSplashOpacity;
uniform int uDebugMode;

varying vec3 vWorldPos;
varying vec4 vCenter;    //the blob's origin and radius
varying vec4 vSplashA;   //launch speed at the middle (m/s), ballistic period (s, unused here), the impact's width b (m), seed
varying vec4 vSplashB;   //up axis, strength
varying vec4 vSplashC;   //level, terminal speed (m/s), radial spread k, fall reach
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

//The apex of a drop launched upward at v0 under gravity and quadratic drag, terminal speed vt:
//waterfall-splash-hull.js apex (keep in step).
const float GRAV = 9.81;
const float TAU = 6.28318530718;
const float SPLASH_PERIOD = 32.0;   //cells; the rising term of the noise repeats after this many
float splashApex(float v0, float vt){
  return vt * vt / (2.0 * GRAV) * log(1.0 + v0 * v0 / (vt * vt));
}

//This fragment's blob, set once in main(): its frame, and how late the falling water is (s).
vec3 gAxis, gE1, gE2;
float gFallLag;
//The last splashDensity's share from the falling skirt (debug).
float gFallShare;

//The launch speed at a point of the footprint, as a fraction of the blob's peak at its middle: the
//pulse (three sines, phase scattered by 2D noise) times the height noise. Between 0 and 1, never 0.
float splashPulse(vec2 lp, float t){
  float seed = vSplashA.w;
  float n = vnoise3(vec3(lp / max(uHeightScale, 1e-3) + seed * 41.3, t * uHeightDrift + seed * 13.0));
  float m = vnoise3(vec3(lp / max(uHeightScale, 1e-3) * 0.6 + seed * 73.1 + 11.5, t * uHeightDrift * 0.7 + 5.0));
  float ph = TAU * (fract(t * uPulseRate) + seed + uPulseScatter * m);
  float ph2 = TAU * (fract(t * uPulseRate * 1.618) + seed * 3.0 + uPulseScatter * m * 1.3);
  float ph3 = TAU * (fract(t * uPulseRate * 2.414) + seed * 7.0 + uPulseScatter * m * 0.7);
  float p = 0.5 + 0.25 * sin(ph) + 0.15 * sin(ph2) + 0.10 * sin(ph3);
  return mix(uPulseMin, 1.0, p) * mix(1.0 - uHeightNoise, 1.0, n);
}

//Density (1/m) at a world point for the blob this fragment belongs to: the column plus the
//falling skirt round it. top (out): the height of the column there, as a fraction of the blob's highest.
float splashDensity(vec3 p, int octaves, out float top){
  top = 0.0;
  vec3 q = p - vCenter.xyz;
  float z = dot(q, gAxis);
  if(z <= 0.0) return 0.0;
  vec3 perp = q - gAxis * z;
  //RADIAL: the drops fly out as well as up, along rays from a focus below the water (H / k under the
  //origin, k = vSplashC.z), so the splash opens 1 + k wide by the blob's highest top: a little
  //spherical symmetry. lp is the launch ring a sample's ray came from; rr the distance along the ray
  //(z on the axis), which the streaks run along.
  float Hmax = max(splashApex(vSplashA.x, vSplashC.y), 1e-3);
  float k = vSplashC.z;
  float spread = 1.0 + k * z / Hmax;
  vec2 lp = vec2(dot(perp, gE1), dot(perp, gE2)) / spread;
  float rr = k > 1e-3 ? length(q + gAxis * (Hmax / k)) - Hmax / k : z;
  float b = max(vSplashA.z, 1e-3);
  float dd = length(q) / vCenter.w;
  float window = clamp(1.0 - dd * dd, 0.0, 1.0);
  float ground = smoothstep(0.0, max(uGroundFade, 1e-3), p.y - vSplashC.x);
  float base = window * ground / (spread * spread);   //the same drops over a wider area
  float cell = max(uSplashScale, 1e-3);
  float stretchCell = cell * max(uStretch, 1.0);
  vec2 noiseXY = lp / cell + vSplashA.w * vec2(17.3, 9.1);
  float e = exp(-dot(lp, lp) / (2.0 * b * b));
  float mass = e * e;

  //The column: going up.
  float dCol = 0.0;
  float Z = splashApex(vSplashA.x * e * splashPulse(lp, t), vSplashC.y);
  top = Z / Hmax;
  if(Z > 1e-3){
    float hh = z / Z;
    float over = (z - Z) / max(uTopSoft, 1e-3);
    float col = hh <= 1.0 ? mix(uFill, 1.0, hh * hh) : exp(-over * over);
    float env = mass * col * base;
    if(env > 1e-3){
      float up = mod(rr / stretchCell - mod(t * uRiseRate, SPLASH_PERIOD) + vSplashA.w * SPLASH_PERIOD, SPLASH_PERIOD);
      float n = fbmPer(vec3(up, noiseXY), octaves, SPLASH_PERIOD);
      float lo = uErode + uErodeAge * min(hh, 1.0) + 0.25 * (1.0 - mass);
      dCol = env * smoothstep(lo, lo + max(uErodeSoft, 1e-3), n);
    }
  }

  //The falling skirt: coming down round it, late.
  float dFall = 0.0;
  float reach = 1.0 + max(vSplashC.w, 0.0);
  vec2 lpF = lp / reach;
  float eF = exp(-dot(lpF, lpF) / (2.0 * b * b));
  float ZF = uFallHeight * splashApex(vSplashA.x * eF * splashPulse(lpF, t - gFallLag), vSplashC.y);
  if(uFallDensity > 0.0 && ZF > 1e-3 && vSplashC.w > 0.0){
    float hf = z / ZF;
    float overF = (z - ZF) / max(uTopSoft, 1e-3);
    float colF = hf <= 1.0 ? mix(uFallFloor, 1.0, hf * hf) : exp(-overF * overF);
    float envF = uFallDensity * eF * eF / (reach * reach) * colF * (1.0 - mass) * base;
    if(envF > 1e-3){
      float down = mod(rr / stretchCell + mod(t * uRiseRate * uFallSpeed, SPLASH_PERIOD) + 13.0, SPLASH_PERIOD);
      float n = fbmPer(vec3(down, noiseXY * 1.3 + 5.7), max(octaves - 1, 1), SPLASH_PERIOD);
      float lo = uErode + uErodeAge + uFallErode;
      dFall = envF * smoothstep(lo, lo + max(uErodeSoft, 1e-3), n);
    }
  }
  float d = dCol + dFall;
  gFallShare = d > 0.0 ? dFall / d : 0.0;
  return uSplashDensity * vSplashB.w * d;
}

void main(){
  vec3 C = vCenter.xyz;
  float R = max(vCenter.w, 1e-3);
  vec3 camToX = vWorldPos - cameraPosition;
  float distX = length(camToX);
  vec3 rd = camToX / max(distX, 1e-4);

  //The chord of the view ray through the blob's sphere, never behind the camera.
  vec3 oc = cameraPosition - C;
  float bq = dot(oc, rd);
  float disc = bq * bq - (dot(oc, oc) - R * R);
  //$DEBUG_START$
  if(uDebugMode == 4){ gl_FragColor = vec4(0.2, 0.9, 0.9, disc > 0.0 ? 0.35 : 0.08); return; }   //the blobs: sphere (bright), proxy (faint)
  //$DEBUG_END$
  if(disc <= 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max(-bq - sq, 0.0);
  float L = (-bq + sq) - t0;
  if(L < 1e-3) discard;

  gAxis = normalize(vSplashB.xyz);
  gE1 = normalize(cross(gAxis, abs(gAxis.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)));
  gE2 = cross(gAxis, gE1);
  //The falling water left the top this long ago: uFallDelay x the middle drop's fall from its apex.
  float vr = vSplashA.x / max(vSplashC.y, 0.1);
  gFallLag = uFallDelay * vSplashC.y / GRAV * log(sqrt(1.0 + vr * vr) + vr);

  //The splash is a low body in a wide sphere: clip the chord to the slab between the water and the
  //highest the blob ever throws, so the steps are spent where there is spray.
  float topMax = splashApex(vSplashA.x, vSplashC.y) + 3.0 * uTopSoft;
  float zc = dot(cameraPosition - C, gAxis);
  float zr = dot(rd, gAxis);
  float t1 = t0 + L;
  if(abs(zr) > 1e-4){
    float ta = -zc / zr, tb = (topMax - zc) / zr;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  }
  else if(zc < 0.0 || zc > topMax) discard;
  L = t1 - t0;
  if(L < 1e-3) discard;

  int nSteps = int(clamp(uSteps, 4.0, float(MAX_STEPS)));
  float dt = L / float(nSteps);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

  //What the ground behind says: view depth of the nearest opaque thing along this pixel.
  vec2 screenUV = gl_FragCoord.xy / screenResolution;
  float gRaw = texture2D(refractionDepthTexture, screenUV).r;
  float sceneDepth = 1e6;
  if(gRaw < 1.0){
    vec4 gv = inverseProjectionMatrix * vec4(screenUV * 2.0 - 1.0, gRaw * 2.0 - 1.0, 1.0);
    sceneDepth = -gv.z / gv.w;
  }

  vec3 Lsun = -normalize(brightestDirectionalLightDirection);   //toward the sun
  float phase = mistPhase(dot(rd, Lsun));
  vec3 sunCol = INV_PI * brightestDirectionalLight * uSunGain;
  vec3 ambient = skyAmbientColor * uAmbient;

  float Tr = 1.0;
  vec3 acc = vec3(0.0);
  float lightStep = uLightLength / max(uLightSteps, 1.0);
  int nLight = int(clamp(uLightSteps, 1.0, float(MAX_LIGHT_STEPS)));
  float topF;

  for(int i = 0; i < MAX_STEPS; i++){
    if(i >= nSteps) break;
    float along = t0 + dt * (float(i) + jitter);   //metres from the camera
    vec3 p = cameraPosition + rd * along;
    float dens = splashDensity(p, 3, topF);
    if(dens <= 0.002) continue;

    //Occlusion: the ground behind (view depth along the ray is linear in distance).
    float viewDepth = vViewDepth * along / max(distX, 1e-4);
    float sigma = dens * clamp((sceneDepth - viewDepth) / max(uSoftRange, 1e-3), 0.0, 1.0);
    if(sigma <= 1e-4) continue;

    //Self-shadowing: march toward the sun through the same burst (two octaves).
    float tauL = 0.0;
    for(int k = 0; k < MAX_LIGHT_STEPS; k++){
      if(k >= nLight) break;
      vec3 q = p + Lsun * lightStep * (float(k) + 0.5 + 0.5 * jitter);
      tauL += splashDensity(q, 2, topF) * lightStep;
    }
    tauL *= uAbsorption;
    float sunT = (exp(-tauL) + 0.4 * exp(-0.2 * tauL)) / 1.4;
    vec3 scatter = uAlbedo * (sunCol * phase * sunT * sunShadowAt(p) + ambient);

    float stepT = exp(-sigma * dt);
    acc += Tr * (1.0 - stepT) * scatter;
    Tr *= stepT;
    if(Tr < 0.01) break;
  }

  float alpha = (1.0 - Tr) * uSplashOpacity;
  if(uDebugMode == 0 && alpha < 0.003) discard;
  vec3 color = acc / max(1.0 - Tr, 1e-4);
  vec3 mid = cameraPosition + rd * (t0 + 0.5 * L);
  #if($atmospheric_perspective_enabled)
    if(underwaterFactor < 0.5) color = applyAtmosphericPerspective(color, mid);
  #endif
  gl_FragColor = linearTosRGB(vec4(aroAESFilmicToneMapping(color), alpha));

  //$DEBUG_START$
  if(uDebugMode == 1) gl_FragColor = vec4(vec3(1.0 - Tr), 1.0);                                   //opacity
  else if(uDebugMode == 3) gl_FragColor = vec4(vec3(clamp(vSplashB.w / 3.0, 0.0, 1.0)), 1.0);     //strength (white at 3)
  else if(uDebugMode == 6){                                                                       //at mid-chord: the column (red) against the falling skirt (green)
    float dm = splashDensity(mid, 1, topF);
    gl_FragColor = vec4(dm > 0.0 ? vec2(1.0 - gFallShare, gFallShare) : vec2(0.0), 0.0, 1.0);
  }
  else if(uDebugMode == 2 || uDebugMode == 5){                                                    //the column height at mid-chord, as a fraction of the blob's highest (watch it pulse)
    splashDensity(mid, 1, topF);
    gl_FragColor = vec4(vec3(topF), 1.0);
  }
  //$DEBUG_END$

  #if(!$atmospheric_perspective_enabled)
    #include <fog_fragment>
  #endif
}
