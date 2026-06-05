precision highp float;

//Ocean splash particle fragment stage (THREE.Points, GLSL1).
//
//Each point is a camera-facing sprite quad (gl_PointCoord spans 0..1). We
//composite a supplied spray sprite, fade it in/out over the particle lifetime,
//and soft-fade it against scene geometry using the refraction G-buffer linear
//depth so droplets sink into terrain and hulls instead of hard-clipping.

uniform sampler2D splashSprite;   //retained for compatibility, now unused (shape is procedural)
uniform sampler2D uLinearDepth;   //G-buffer attachment 2: positive view-Z, a=hasGeom
uniform vec2 uResolution;         //G-buffer / drawing-buffer size in pixels
uniform float uSoftRange;         //metres over which we soft-fade into geometry
uniform float uOpacity;           //global artistic opacity (FUDGE)
uniform int uDebugMode;           //0 = normal, 1 = tint by emitter type
uniform float uNoiseScale;        //3D noise frequency across the droplet
uniform float uErode;             //silhouette erosion threshold (higher = grainier)
uniform float uSoftEdge;          //erosion smoothstep width (lower = sharper, sparklier)
uniform float uNoiseEvolve;       //noise dissolve rate over the particle life
uniform float uOpacityCoarse;     //peak opacity at coarse=1 (droplets are dense/bright)
uniform float uErodeCoarse;       //erosion threshold at coarse=1 (near 0 = coherent blob)
uniform float uSparkle;           //sun-specular strength on the SDF water beads
uniform float uDropletCells;      //droplet cluster: grid cells across the billboard
uniform float uDropletRadius;     //droplet cluster: individual drop size scale
uniform float uDropletSpread;     //droplet cluster: gaussian tightness (higher = tighter)
uniform float uAbsorb;            //droplet body absorption (water tint, not soap bubble)
uniform sampler2D meteringSurveyTexture; //a-starry-sky fisheye sky (worldXZ->UV) for rim reflection
uniform int uHasSkyTex;           //1 = meteringSurveyTexture is bound this frame
uniform float uTime;              //seconds, drives the droplet wobble animation
uniform float uWobbleFreq;        //droplet wobble frequency (rad/s)
uniform float uWobbleAmp;         //droplet aspect-breathe amplitude (jitters the a/b ratio)
uniform float uHarmonic;          //droplet spherical-harmonic surface-wobble amplitude
uniform float uSizeFalloff;       //cluster size distribution exponent (higher = big drops rarer)
uniform float uSkyBoost;          //brightness lift on the drop sky-reflection (rim reads as sky)
uniform float uWindNoiseSpeed;    //rate the haze noise scrolls along the wind (wisps blow past)
uniform vec3 sunDir;              //world-space direction TO the BRIGHTEST light (sun by day, MOON by
                                  //night) — drives forward-scatter geometry, NOT the day/night gate
uniform float uSunElevation;      //sin(true SOLAR elevation). Gates the daytime sky lifts so a high
                                  //MOON (which becomes the brightest light at night) never switches on
                                  //the blue day-fill — that was the night mist-glow bug.
uniform float uWaterBounce;       //strength of the LIGHT-FROM-BELOW term (sunlit water bouncing its
                                  //colour up onto the spray underside; the other half of the ambient)
uniform float uNightAmbient;      //floor the ambient (both hemisphere halves) drops to at deep night.
                                  //White foam over a black sea reads as a GLOW under any ambient, so
                                  //the sky+water fill must dim to ~this fraction once the sun is down.
uniform vec2 uWind;               //wind velocity (m/s); its LENGTH gates the misty haze look
uniform float uMistWindMin;       //m/s wind below which spray stays beaded droplets (no haze)
uniform float uMistWindMax;       //m/s wind at/above which the haze (mist) look is fully present
uniform float uFoamMix;           //0 = clear glassy beads (bubble look), 1 = opaque aerated FOAM
uniform float uFoamOpacity;       //body alpha of a foam bead (aerated water is near-opaque)
uniform float uFoamAlbedo;        //brightness of the foam body (white aerated water; ~1+)
uniform float uFoamSkyFill;       //brightness of the blue daytime sky-bounce added to foam ambient
                                  //(lifts shadow-side foam off charcoal; day-gated so night is dark)
uniform float uFoamCalmFade;      //0..1 how much CALM seas thin the foam (0 = constant, 1 = gone)
uniform float uDropTopSize;       //cell-local radius of the LARGEST cluster drop (size variety)
uniform float uWindBreakup;       //how hard rising wind shreds big drops into fine spray (0 = off)

//Scene sun shadow receive (same map + params as the water shader's sunShadow*).
uniform sampler2D sunShadowMap;   //THREE directional-light depth shadow map
uniform vec2 sunShadowMapSize;    //shadow map resolution in texels
uniform float sunShadowRadius;    //PCF tap spread (light.shadow.radius)
uniform float sunShadowBias;      //depth bias (light.shadow.bias + console offset)
uniform int sunShadowEnabled;     //0 = no shadow map this frame

varying float vAge01;
varying float vSeed;
varying float vType;
varying float vCoarse;
varying vec3 vToCamW;       //world-space direction from the particle to the camera
varying vec2 vWindDir;      //view-space (billboard-plane) wind direction, drives the noise scroll
varying float vViewZ;
varying vec3 vAmbient;      //smooth sky-ambient term
varying vec3 vSunCol;       //sun colour * scale, wrapped over the synthesized normal
varying float vGlow;        //forward-scatter additive (backlit through-glow)
varying vec3 vSunDirView;   //view-space direction TO the sun
varying vec4 vSunShadowCoord;

//This is a raw ShaderMaterial, so (unlike THREE built-ins) no tonemap or output
//color-space conversion is applied for us. The water surface self-applies the
//same pair, and we blend over its already-sRGB-encoded pixels, so we must match
//or the spray reads too dark on the shadow side and clips harshly on the lit one.
vec3 acesTonemap(vec3 x){
  const float a = 2.51; const float b = 0.03;
  const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 linearToSrgb(vec3 c){ return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

//Compact 3D value noise (iq-style integer hash + trilinear smoothstep interp). Cheap
//enough to run per-fragment on hundreds of sprites; quality is fine for soft mist.
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
//Three-octave fractal sum -> billowy cloud-style field in roughly [0,1].
float fbm3(vec3 p){
  float a = 0.5;
  float s = 0.0;
  for(int i = 0; i < 3; i++){
    s += a * vnoise3(p);
    p *= 2.0;
    a *= 0.5;
  }
  return s;
}

//Core water-drop primitive: an oriented, volume-conserving, harmonic-wobbling spheroid at a
//local billboard offset p (centred-quad pc space, y-DOWN), rest radius rad, stretched by `aspect`
//(a/b) along axA, with surface-wobble amplitude wobAmp. The Wolfram aspect-breathe (uWobbleAmp)
//and the spherical-harmonic surface ripple (modes 2-4, bubble_builder style) both ride uTime.
//Writes a VIEW-space normal (y flipped UP, so the sun glint sits on top) plus the camera-ward
//height to outZ; returns soft silhouette coverage. Used by the small-drop cluster.
float wobbleDrop(vec2 p, float rad, vec2 axA, vec2 axP, float aspect, float wobAmp,
                 float pseed, out vec3 outN, out float outZ){
  outN = vec3(0.0, 0.0, 1.0);
  outZ = 0.0;
  float breathe = 1.0 + uWobbleAmp * sin(uWobbleFreq * uTime + pseed * 6.2831853);
  float A = max(0.35, aspect * breathe);
  float a = rad * pow(A, 0.6666667);                //long semi-axis along axA (a*b^2 = rad^3)
  float b = rad * pow(A, -0.3333333);               //short semi-axes (perpendicular + to camera)
  float al = dot(p, axA);
  float pe = dot(p, axP);
  float u = al / a;
  float v = pe / b;
  float rho = sqrt(u * u + v * v);                  //1 at the unperturbed edge
  float theta = atan(v, u);
  float W = 0.0;
  float dW = 0.0;
  for(int k = 0; k < 3; k++){
    float m = float(k) + 2.0;                       //modes 2, 3, 4
    float ph = uWobbleFreq * uTime * (0.7 + 0.3 * float(k)) + pseed * 6.2831853 * (float(k) + 1.0);
    float amp = wobAmp * (0.6 / m);                 //taper the higher modes
    W  += amp * sin(m * theta + ph);
    dW += amp * m * cos(m * theta + ph);
  }
  float edge = 1.0 + W;                             //wobbly boundary radius
  if(rho > edge) return 0.0;
  outZ = b * sqrt(max(0.0, edge * edge - rho * rho));
  //Surface normal: radial ellipsoid gradient tilted tangentially by the harmonic slope. Flip y:
  //p is y-DOWN gl_PointCoord space, lighting wants a y-UP view normal (glint on top, not bottom).
  vec2 tang = vec2(-sin(theta), cos(theta));
  vec2 nUV = vec2(u, v) - tang * dW;
  vec2 nxy = axA * (nUV.x / a) + axP * (nUV.y / b);
  outN = normalize(vec3(nxy.x, -nxy.y, outZ / (b * b)));
  return smoothstep(1.0, 0.8, rho / edge);          //soft wobbly silhouette
}

//Cluster of small SDF water droplets inside one billboard. Tiles the sprite into a grid; each
//cell may host one wobbling drop, gaussian-culled toward the centre so the whole reads as a soft
//puff of finite drops. Each drop now wobbles (less for the smaller ones — surface tension holds
//them rigid). Writes the hit droplet view-space normal to outN; returns soft coverage.
float dropletCluster(vec2 uv, float seed, out vec3 outN){
  outN = vec3(0.0, 0.0, 1.0);
  vec2 g = uv * uDropletCells;
  vec2 cell = floor(g);
  float r0 = hash3(vec3(cell, seed));
  float r1 = hash3(vec3(cell.yx, seed + 9.0));
  //Gaussian presence: cells near the billboard centre almost always carry a drop; outer
  //cells are progressively culled, so the cluster tapers to a soft round puff of drops.
  vec2 cc = (cell + 0.5) / uDropletCells - 0.5;     //cell centre in [-0.5, 0.5]
  float gauss = exp(-dot(cc, cc) * 4.0 * uDropletSpread);
  if(r0 > gauss) return 0.0;
  vec2 jit = (vec2(r0, r1) - 0.5) * 0.35;           //keep the drop inside its cell
  //Exponential size falloff: raising r1 to uSizeFalloff makes MOST drops tiny and large ones
  //increasingly rare (the bubble-breakup distribution). Higher uSizeFalloff = fewer big drops.
  //Wind SHREDS chunks: a building sea breaks big drops into fine spray, so as wind rises we bias
  //the size distribution smaller (steeper falloff) AND cap the top size down. Calm seas keep the
  //rare large chunks; storms are nearly all fine grains. (uWindBreakup dials the strength.)
  float wE = smoothstep(2.0, 10.0, length(uWind));
  float fall = uSizeFalloff * (1.0 + uWindBreakup * wE);
  float radMin = 0.04;
  float radMax = uDropTopSize / (1.0 + uWindBreakup * wE * 0.5); //smaller tops at high wind
  float rad = mix(radMin, radMax, pow(r1, fall)) * uDropletRadius;   //cell-local units
  //Map the cell-local drop into the centred billboard (pc, -1..1) frame for wobbleDrop.
  vec2 centerPc = ((cell + 0.5 + jit) / uDropletCells) * 2.0 - 1.0;
  vec2 pc = uv * 2.0 - 1.0;
  float radPc = rad * 2.0 / uDropletCells;
  //Smaller drops wobble LESS (surface tension holds them spherical); larger members jiggle more.
  float wobAmp = uHarmonic * clamp(rad / (radMax * uDropletRadius), 0.2, 1.0);
  float pseed = seed + cell.x * 1.7 + cell.y * 3.1;
  float zc;
  return wobbleDrop(pc - centerPc, radPc, vec2(1.0, 0.0), vec2(0.0, 1.0), 1.0, wobAmp, pseed, outN, zc);
}

//Sky reflection colour for a view-space drop normal. The water surface reflects the sky via the
//atmospheric LUT (computeSkyRadiance), which the splash shader does not have; the metering-survey
//fisheye it CAN reach is dim/low-res, so a drop sampling it alone read as a dark-rimmed bubble.
//Instead we synthesize a reliable BRIGHT sky: a vertical gradient anchored to the scene ambient
//(so it tracks time of day) and lifted by uSkyBoost so the Fresnel rim reads as real reflected
//sky, then blend in the fisheye for directional detail when it is actually bound.
vec3 skyReflect(vec3 viewN){
  vec3 worldN = normalize(viewN * mat3(viewMatrix));   //view->world (orthonormal transpose)
  vec3 reflectDir = reflect(-normalize(vToCamW), worldN);
  float up = clamp(reflectDir.y * 0.5 + 0.5, 0.0, 1.0); //horizon (0) .. zenith (1)
  vec3 sky = vAmbient * uSkyBoost * mix(0.8, 1.6, up);  //brighter, bluer toward the zenith
  if(uHasSkyTex == 1){
    vec2 skyUV = clamp(reflectDir.xz * 0.5 + 0.5, 0.01, 0.99);
    sky = mix(sky, texture2D(meteringSurveyTexture, skyUV).rgb * uSkyBoost, 0.4);
  }
  return sky;
}

//═══ UNIFIED aerated-water shading ═══════════════════════════════════════════════════════════
//Mist and foam are ONE material — air-laden water — at different optical densities, so they share
//ONE lighting model (no more two drifting paths). `N` = view-space normal (y-up). `aer` = foaminess
//0..1: thin translucent MIST (light passes, forward-scatters into the warm sun glow) -> dense
//opaque FOAM (multiple-scattered bright white with a real lit/shadow form). `dGlint` = wet sun
//sparkle for the bead tier (0 for the mist puff).
vec3 aeratedWater(vec3 N, float aer, float sunShadow, float dGlint){
  float wrap = clamp(dot(N, vSunDirView) * 0.5 + 0.5, 0.0, 1.0); //form: bright sun side -> dark back
  float glow = vGlow * (1.0 - 0.8 * aer);                        //forward-scatter glow: mist >> foam
  //Daytime sky irradiance on foam must DIE as the sun nears the horizon, or its (cold blue) lift
  //pops vividly against the warm/dark dusk water. Steeper gate => a MIDDAY lift only, gone by sunset;
  //dusk/night then fall back to the plain (correctly dark) hemisphere base. Gate on the TRUE solar
  //elevation, not sunDir.y — sunDir is the brightest light, which is the MOON at night (a high moon
  //would otherwise read as daytime and switch the blue fill back on => night mist glow).
  float dayF = smoothstep(0.04, 0.22, uSunElevation);
  //Ambient FILL kept MODEST relative to the sun term below, or the lit/shadow FORM washes out (the
  //old flat flood is exactly what erased the shadow side). Dim a-starry-sky hemisphere base (tracks
  //time of day) + an explicit blue sky-dome bounce so SHADOW-side spray reads blue, not charcoal.
  //BOTH lifts are now day-gated: brightness is ~log(energy), so a day-scaled boost reads even where
  //an un-gated add popped at the dark end. Night/dusk foam sits at the plain vAmbient base.
  vec3 ambient = vAmbient * mix(1.0, uFoamAlbedo, aer * dayF)
               + vec3(0.45, 0.62, 0.92) * (uFoamSkyFill * dayF * aer);
  //LIGHT FROM BELOW — the other half of the ambient. Sky lights the top; the bright sunlit water
  //bounces its own (teal) colour up onto the spray's UNDERSIDE. Without it the down/shadow side has
  //only the dim sky hemisphere and reads charcoal. downFace = how much this normal faces the water;
  //driven by the sun+sky energy (so it tracks time of day) and day-gated so night stays dark.
  vec3 worldN = normalize(N * mat3(viewMatrix));
  float downFace = clamp(-worldN.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 waterBounce = vec3(0.16, 0.34, 0.40) * (vSunCol * 0.6 + vAmbient)
                   * (uWaterBounce * dayF * downFace * mix(0.6, 1.0, aer));
  //Body colour: cool translucent water (mist) -> bright near-white aerated foam.
  vec3 body = mix(vec3(0.60, 0.74, 0.95), vec3(1.0), aer);
  //Direct sun: half-Lambert WRAP supplies the form (sun side bright, anti-sun side falls to the
  //blue ambient = the shadow side). Glow (mist) + glint (beads) ride on top. Scene shadow gates it.
  vec3 direct = vSunCol * (wrap * mix(0.8, 1.1, aer) + glow) * sunShadow + vSunCol * dGlint;
  //AMBIENT day/night: white foam over a black sea glows under ANY ambient, so the whole hemisphere
  //fill (sky top + water bottom) must dim to a low floor once the sun sets. Wider window than dayF so
  //twilight keeps a real ambient while the blue day-fill is already gone. DIRECT (moon) is left alone
  //so a present moon still lights the spray — what was glowing here was the un-dimmed sky ambient.
  float nightDim = mix(uNightAmbient, 1.0, smoothstep(-0.08, 0.06, uSunElevation));
  return (ambient * body + waterBounce) * nightDim + direct;
}

//Scene sun shadow: 3x3 PCF on the directional-light depth map. A derivative-free
//cut of the water shader getSunShadow (no dFdx slope bias) so it stays GLSL1-safe;
//soft spray does not need acne suppression. Returns 1 = lit, 0 = fully shadowed.
float getSplashSunShadow(){
  if(sunShadowEnabled == 0) return 1.0;
  vec3 sc = vSunShadowCoord.xyz / vSunShadowCoord.w;
  if(sc.z > 1.0 || sc.z < 0.0) return 1.0;
  vec2 edgeDist = min(sc.xy, vec2(1.0) - sc.xy);
  float edge = min(edgeDist.x, edgeDist.y);
  if(edge < 0.0) return 1.0;
  float refZ = sc.z + sunShadowBias;
  vec2 texelSize = (1.0 / sunShadowMapSize) * sunShadowRadius;
  float shadow = 0.0;
  for(int x = -1; x <= 1; x++){
    for(int y = -1; y <= 1; y++){
      float d = texture2D(sunShadowMap, sc.xy + vec2(float(x), float(y)) * texelSize).r;
      shadow += refZ < d ? 1.0 : 0.0;
    }
  }
  shadow *= (1.0 / 9.0);
  //Fade toward lit over the outer 5% of the frustum so the boundary is not a hard line.
  float fade = smoothstep(0.0, 0.05, edge);
  return mix(1.0, shadow, fade);
}

void main(){
  //Procedural mist droplet: a soft sphere whose silhouette is eroded by 3D noise so
  //each billboard reads as a rough-edged, cloud-like puff rather than a flat disc.
  vec2 pc = (gl_PointCoord - 0.5) * 2.0;   //-1..1 across the quad
  float r = length(pc);                    //0 at centre .. ~1.41 at the corner
  //Reconstruct a hemisphere height so the noise wraps over a 3D surface (a fake
  //volume cue) instead of lying flat on the disc.
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 spherePos = vec3(pc, z);
  //Per-particle offset (vSeed) makes every billboard unique; advancing along Z by vAge01 evolves
  //the field so the puff dissolves as it ages. The noise MUST stay anchored to a view-stable frame:
  //the old scroll added vWindDir (the wind projected into the billboard plane), which ROTATES with
  //the camera, so a static particle's pattern crawled when you turned/moved — the shimmer. Advance
  //the field along its own evolve (Z) axis by uTime instead: the wisps still morph/flow over time,
  //but with no view-dependent term the puff looks identical from every angle. The bulk wind motion
  //still reads — the CPU sim already pushes each particle along the wind.
  float windAdvance = uTime * uWindNoiseSpeed;
  vec3 nCoord = spherePos * uNoiseScale
              + vec3(vSeed * 51.3, vSeed * 17.7, vAge01 * uNoiseEvolve + windAdvance);
  float n = fbm3(nCoord);                  //~0..1

  //── ONE MATERIAL: aerated water across a mist<->foam continuum ─────────────────────────────
  //`aer` (foaminess 0..1) needs BOTH a coarse/chunky particle AND an energetic sea, so LIGHT waves
  //stay sparse translucent droplets and only a building sea whips up dense opaque foam. uFoamMix is
  //the global foaminess master. windE is the shared wave-energy term (also fades + shreds size).
  float windE = smoothstep(2.0, 10.0, length(uWind));
  float aer = clamp(vCoarse * windE * uFoamMix, 0.0, 1.0);

  //GEOMETRY select: fine spray becomes a noise-eroded PUFF only when strong wind shreds it
  //(windMist); otherwise spray is resolved DROPLETS (a bead cluster). Lighting is unified below.
  float windMist = smoothstep(uMistWindMin, uMistWindMax, length(uWind));
  float beadMix = mix(1.0, smoothstep(0.4, 0.65, vCoarse), windMist);

  //Mist PUFF silhouette (noise-eroded soft sphere) — used when beadMix is low.
  float corePow = mix(2.0, 4.0, vCoarse);
  float erode = mix(uErode, uErodeCoarse, vCoarse);
  float core = pow(clamp(1.0 - r, 0.0, 1.0), corePow);
  float carve = smoothstep(erode, erode + uSoftEdge, n);
  float hazeDensity = core * carve;

  vec3 Hh = normalize(vSunDirView + vec3(0.0, 0.0, 1.0));//half-vector to the sun
  float sunShadow = getSplashSunShadow();

  //Bead CLUSTER silhouette + normal — used when beadMix is high. Translucent droplets (mist end)
  //keep a faint wet-glass sky-Fresnel rim; dense foam suppresses it (rim scaled by 1-aer).
  float dropCov = 0.0;
  vec3 dropN = vec3(0.0, 0.0, 1.0);
  float dGlint = 0.0;
  vec3 rim = vec3(0.0);
  if(beadMix > 0.001){
    dropCov = dropletCluster(gl_PointCoord, vSeed, dropN);
    dGlint = pow(max(0.0, dot(dropN, Hh)), 80.0) * uSparkle * sunShadow;
    float fres = pow(1.0 - clamp(dropN.z, 0.0, 1.0), 3.0);
    rim = skyReflect(dropN) * (fres * (1.0 - aer) * 1.2);
  }

  //ONE lighting model lights BOTH the mist puff (Nhaze) and the foam beads (dropN), so they share
  //the sun colour + form and never drift apart again. The mist puff Z-biases its normal off a
  //harsh terminator; the rim rides only the bead path.
  vec3 Nhaze = normalize(vec3(pc.x, -pc.y, z + 0.3)); //negate y: gl_PointCoord is y-down
  vec3 litHaze = aeratedWater(Nhaze, aer, sunShadow, 0.0);
  vec3 litDrop = aeratedWater(dropN, aer, sunShadow, dGlint) + rim;
  vec3 lit = mix(litHaze, litDrop, beadMix);

  //COVERAGE (silhouette) and OPACITY (translucent mist -> opaque foam) are separate: the aeration
  //axis drives opacity so light waves read see-through and storm foam reads solid. Calmer seas thin
  //the whole thing (foamWind), matching the size break-up in the cluster.
  float density = mix(hazeDensity, dropCov, beadMix);
  float foamWind = mix(1.0 - uFoamCalmFade, 1.0, windE);
  float opacity = mix(uOpacity, uFoamOpacity, aer) * foamWind;

  //Lifetime fade: a quick rise then a long ease-out, like real spray thinning.
  float fadeIn = smoothstep(0.0, 0.15, vAge01);
  float fadeOut = 1.0 - smoothstep(0.55, 1.0, vAge01);
  float ageAlpha = fadeIn * fadeOut;

  //Soft-particle fade. Sample scene depth under this fragment. .a marks where solid
  //geometry was written; over open water / sky it is 0 and we must NOT fade (otherwise
  //spray over the open sea vanishes against the cleared buffer).
  vec2 screenUV = gl_FragCoord.xy / uResolution;
  vec4 depthSample = texture2D(uLinearDepth, screenUV);
  float sceneZ = depthSample.r;
  float hasGeom = depthSample.a;
  float softFade = 1.0;
  if(hasGeom > 0.5){
    softFade = clamp((sceneZ - vViewZ) / max(0.001, uSoftRange), 0.0, 1.0);
  }

  float alpha = density * ageAlpha * softFade * opacity;
  vec3 color = linearToSrgb(acesTonemap(lit));

  if(uDebugMode == 1){
    //Crest mist = red, impact burst = magenta; procedural density kept as the alpha.
    vec3 tint = mix(vec3(1.0, 0.1, 0.1), vec3(1.0, 0.2, 0.8), step(0.5, vType));
    color = tint;
    alpha = density * ageAlpha;
  } else if(uDebugMode == 2){
    //Coarseness ramp: deep blue = fine mist, white = coarse droplet. Lets the emission
    //bands (crest/impact Coarse Min/Max) be eyeballed directly on screen while tuning.
    color = mix(vec3(0.1, 0.2, 0.9), vec3(1.0, 1.0, 1.0), vCoarse);
    alpha = density * ageAlpha;
  }

  if(alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha);
}
