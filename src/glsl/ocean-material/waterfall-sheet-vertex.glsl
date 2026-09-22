precision highp float;

//Waterfall sheet vertex stage (Phase 6). The ribbon is built on the CPU by
//ARestlessOcean.WaterfallNappe.buildRibbon in WORLD space and the mesh sits at the
//origin: a smooth, rigid-across sheet along the traced path of the free fall.
//
//THE SHAPE IS HERE. A real falling sheet is not a ribbon: it carries lumps and ridges
//that travel down with the water, grow as it breaks up, and fray at the sides. So each
//vertex is pushed along the sheet's normal by value noise sampled in the same
//(across metres, time of flight) space as the fragment stage's grain, which makes the
//lumps ride the water and stretch as the jet accelerates, exactly as the grain does.
//Their height grows with the nappe's aeration (a glassy lip is smooth; a broken jet is
//not). The side columns are also pushed in and out across the flow, so the edges are
//ragged in geometry rather than a straight cut. The normal is rebuilt from the displaced
//surface by finite differences of the same noise, in the ribbon's own frame.
//FUDGE: the noise is a look choice (two octaves of value noise), not a jet instability
//model; uLumpAmp/uLumpScale/uLumpRate/uEdgeWobble are its knobs.

attribute vec4 aFlowA;       //tau (s of flight since the trace began), across (-1..1), thickness (m), speed (m/s)
attribute vec4 aFlowB;       //aeration (0..1), presence (0..1), free-fall weight (0..1, smoothed), half-width (m)
attribute vec3 aFlowTangent; //down the flow (unit)
attribute vec3 aFlowAcross;  //horizontal, toward +across (unit)

uniform mat4 sunShadowMatrix;
uniform float t;
uniform float uLumpAmp;      //m of lump at full aeration
uniform float uLumpScale;    //m across per lump
uniform float uLumpRate;     //lumps per second of flight along the fall
uniform float uEdgeWobble;   //m the side edges wander in and out
//The creek's WaterField, cascade 0 (the texture the flowing surface stands on; aliased).
uniform sampler2D waterFieldCascade0;
uniform vec2 waterFieldCascadeCenter[3];
uniform float waterFieldCascadeHalfWidth[3];

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec4 vFlowA;
varying vec4 vFlowB;
varying vec4 vSunShadowCoord;
varying float vViewDepth;
varying vec2 vFlowVel;       //plan velocity (m/s), for the creek's ripple advection on the lead-in

#include <fog_pars_vertex>

//The creek's level at xz (cascade 0), or `fallback` outside the flowing surface's window
//(FlowSurfacePass draws within ~0.89 of cascade 0's half-width).
float creekLevelAt(vec2 xz, float fallback){
  vec2 d = abs(xz - waterFieldCascadeCenter[0]);
  if(max(d.x, d.y) > 0.89 * waterFieldCascadeHalfWidth[0]) return fallback;
  vec2 uv = (xz - waterFieldCascadeCenter[0]) / (2.0 * waterFieldCascadeHalfWidth[0]) + 0.5;
  vec4 f = texture2D(waterFieldCascade0, uv);
  //Known-dry texels (RT0.a ≥ 1 there) hold their nearest wet texel's level — beside a fall
  //often the creek 3 m up, which yanked the ribbon's bank-side vertices into slivers (round 9).
  return f.a > 0.5 ? fallback : f.r;
}

float wfHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wfNoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wfHash(i), wfHash(i + vec2(1.0, 0.0)), f.x),
             mix(wfHash(i + vec2(0.0, 1.0)), wfHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
//Two octaves, zero-mean, roughly -0.5..0.5.
float wfLump(vec2 p){
  return 0.67 * wfNoise(p) + 0.33 * wfNoise(p * 2.03 + vec2(17.1, 5.3)) - 0.5;
}

void main(){
  float acrossM = aFlowA.y * aFlowB.w;
  float tau = aFlowA.x;
  float speed = max(aFlowA.w, 0.5);
  float aeration = aFlowB.x;
  //Wrapped like the fragment grain (mod 256 s) so the lumps stay in float precision.
  float tWrap = mod(t, 256.0);
  //Lumps on the free fall only: the attached ends are the creek's surface carried on, and
  //the landing tail (the most aerated rows) poked white lumps up through the pool.
  float amp = uLumpAmp * (0.15 + 0.85 * aeration) * aFlowB.z;

  vec3 N = normalize(normal);
  vec3 T = normalize(aFlowTangent);
  vec3 A = normalize(aFlowAcross);

  //Displacement along the normal, and its derivatives across (per metre) and along (per
  //second of flight) for the rebuilt normal.
  const float DU = 0.2;   //m
  const float DT = 0.04;  //s
  vec2 q  = vec2(acrossM / uLumpScale, (tau - tWrap) * uLumpRate);
  float d0 = amp * wfLump(q);
  float du = amp * wfLump(q + vec2(DU / uLumpScale, 0.0));
  float dv = amp * wfLump(q + vec2(0.0, DT * uLumpRate));
  vec3 dPdu = A + N * ((du - d0) / DU);
  vec3 dPdt = T * speed + N * ((dv - d0) / DT);
  vec3 Nd = normalize(cross(dPdt, dPdu));
  Nd *= sign(dot(Nd, N) + 1e-6);

  //Ragged sides: the outer columns wander in and out across the flow.
  float edge = smoothstep(0.6, 1.0, abs(aFlowA.y));
  float wobble = uEdgeWobble * edge * (wfLump(q * vec2(0.6, 1.7) + vec2(41.7, 3.1)) * 2.0) * (0.3 + 0.7 * aeration);

  vec3 displaced = position + N * d0 + A * sign(aFlowA.y) * wobble;
  //ATTACHED rows stand on the creek: at its level where it has one above the traced height
  //(so the two surfaces coincide wherever the creek draws, and the creek, polygon-offset
  //toward the camera, wins), at the trace's height where the creek's interpolated level
  //sinks under the brink. At the landing that is the pool's real level: rigid at the trace's
  //height, the tail ran under the pool and under the banks at its edges (round 7).
  //The creek's level as a MINIMUM: near the foot the field's cells still hold the ramp's
  //level (2.4 m at hero-creek's z 766 against a 1.9 m tail), and a plain sample yanked single
  //vertices half a metre up, folding the tail into edge-on strips.
  //Only the point itself and 0.75 m DOWNSTREAM: an upstream sample is exactly what reaches
  //back onto the ramp, and the full ±0.75 m minimum sank the tail under a pool whose level
  //rises downstream (1.55 → 1.85 m below hero-creek's fall), where it showed through the
  //clear creek as a sheet of foam under the river (round 8).
  vec2 fd = aFlowTangent.xz;
  fd = dot(fd, fd) > 1e-6 ? normalize(fd) * 0.75 : vec2(0.0);
  float creekY = min(creekLevelAt(displaced.xz, displaced.y), creekLevelAt(displaced.xz + fd, displaced.y));
  //...and ATTACHED_LIFT above it. The sheet draws ON TOP of the creek and its fragment alpha
  //is the complement of the creek's visibility there, so the two blend instead of stacking.
  //Coincident with the creek it lost the depth test to it (the creek is polygon-offset toward
  //the camera and writes depth even where it has faded to nearly nothing), which left a hole
  //at the foot: a faint creek in front of a hidden tail (round 7).
  const float ATTACHED_LIFT = 0.03;
  displaced.y = mix(max(creekY, displaced.y) + ATTACHED_LIFT, displaced.y, aFlowB.z);
  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * Nd);
  vFlowA = aFlowA;
  vFlowB = aFlowB;
  vec2 planT = aFlowTangent.xz;
  vFlowVel = dot(planT, planT) > 1e-6 ? normalize(planT) * aFlowA.w : vec2(0.0);
  vSunShadowCoord = sunShadowMatrix * worldPos;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewDepth = -mvPosition.z;
  //The fog chunk (UnderwaterFogChunk, or a-starry-sky's) reads `mvPosition` and
  //`transformed` by those names — see the same note in water-vertex.glsl.
  #ifdef USE_FOG
    vec3 transformed = displaced;
  #endif
  #include <fog_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
