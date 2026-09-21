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
//NOT HERE (deferred, flagged): atmospheric perspective. With a-starry-sky's AP on, the
//creek gets AP and this sheet gets the scene fog chunk instead; falls are drawn within
//a few hundred metres, where the difference is small.

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

uniform sampler2D foamOpacityMap;
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

#include <fog_pars_fragment>

const float PI = 3.14159265359;
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

//The sky the sheet reflects: the water's ambient-built sky (computeStandaloneSkyRadiance),
//NOT a-starry-sky's metering survey. That fisheye is what the creek's SSR falls back to with
//atmospheric perspective OFF, but on hero-creek-sky (AP on) it read back all zeros and the
//sheet reflected black even along clamped, upward rays (2026-09-21) — the creek never
//noticed because with AP on it reflects computeSkyRadiance instead. skyAmbientColor is the
//metered sky wherever there is one, so this sky is on the right brightness scale everywhere.
//
//A waterfall is VERTICAL, so much of what it reflects is at or below the horizon: rays that
//point below it would see terrain, not sky, and fade to a dim ground bounce.
//FUDGE: the 0.25 bounce is a stand-in for the terrain's radiance.
vec3 skyRadiance(vec3 dir){
  vec3 sky = computeStandaloneSkyRadiance(normalize(vec3(dir.x, max(dir.y, 0.0), dir.z)));
  return mix(skyAmbientColor * 0.25, sky, smoothstep(-0.3, 0.05, dir.y));
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
  vec3 Ns = normalize(N + (acrossDir * foamNMXZ.x + flowDir * foamNMXZ.y) * uSurfaceRough);
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
  vec3 reflected = skyRadiance(reflect(-V, Ns));
  vec3 R = reflect(-L, Ns);
  vec3 glint = brightestDirectionalLight * pow(max(0.0, dot(R, V)), uSpecFalloff) * specBoost * sunShadow;
  vec3 inscatter = underwaterInscatterSurface(-V);

  //── What is behind: the creek's refraction model (see COMPOSITING) ─────────
  vec2 screenUV = gl_FragCoord.xy / screenResolution;
  vec2 refrUV = clamp(screenUV + (Ns.xz - N.xz) * uRefraction, vec2(0.001), vec2(0.999));
  vec3 behind = skyRadiance(-V);        //nothing behind: the sky seen through the water
  float behindDist = 1000.0;
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
    //Relit as water-shader.glsl relights above-water terrain seen through the water.
    vec3 bgN = normalize(texture2D(gBufferNormal, uv).rgb);
    float bgShadow = getSunShadow(sunShadowMatrix * vec4(P, 1.0));
    behind = texture2D(refractionColorTexture, uv).rgb
           * (INV_PI * brightestDirectionalLight * max(0.0, dot(bgN, L)) * bgShadow + skyAmbientColor);
    behindDist = distance(vWorldPos, P);
    break;
  }
  //Water the view crosses to get there: the column on the lead-in, the sheet on the fall.
  float waterPath = mix(min(behindDist, 50.0), min(behindDist, path), airborne);
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

  float outAlpha = presence * edgeAlpha * strandAlpha * soft * uOpacity;
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
  //$DEBUG_END$

  #include <fog_fragment>
}
