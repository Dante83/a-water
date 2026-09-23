precision highp float;

//Waterfall sheet vertex stage (Phase 6). The sheet is built on the CPU by
//ARestlessOcean.WaterfallNappe.buildRibbon in WORLD space and the mesh sits at the
//origin: a skirt woven between the traced paths of the water, one strand every half
//metre across the creek.
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
attribute vec4 aFlowB;       //aeration (0..1), presence (0..1), free-fall flag (0..1), half-width (m): across x it is
                             //the strand's seed offset from the middle, a coordinate that rides the water
attribute vec2 aFlowLump;    //x lump weight: 1 inside a fall, ramping to 0 inside its ends (WaterfallNappe.resample)
                             //y seconds since this stretch of the fall left the ground
attribute vec3 aFlowTangent; //down the flow (unit)
attribute vec3 aFlowAcross;  //toward +across, along the sheet to the neighbouring strands (unit)

uniform mat4 sunShadowMatrix;
uniform float t;
uniform float uLumpAmp;      //m of lump at full aeration
uniform float uLumpScale;    //m across per lump
uniform float uLumpRate;     //lumps per second of flight along the fall
uniform float uEdgeWobble;   //m the side edges wander in and out
uniform vec2 uWind;          //m/s, the ocean wind (world X, Z)
uniform float uWindSway;     //gust strength as a fraction of the mean wind (0: steady)
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
varying vec3 vFlowAcrossDir; //the ribbon's frame for the fragment stage (not the viewer-flipped normal)
varying vec3 vFlowDownDir;

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

//Value noise PERIODIC along y with period `per` cells (a whole number): the time term below
//is wrapped, and noise that does not repeat at the wrap jumped every lump on the sheet at once.
float wfHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wfNoise(vec2 p, float per){
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  float y0 = mod(i.y, per), y1 = mod(i.y + 1.0, per);
  return mix(mix(wfHash(vec2(i.x, y0)), wfHash(vec2(i.x + 1.0, y0)), f.x),
             mix(wfHash(vec2(i.x, y1)), wfHash(vec2(i.x + 1.0, y1)), f.x), f.y);
}
//Two octaves, zero-mean, roughly -0.5..0.5. The second octave is exactly ×2 (was 2.03) so it
//repeats too.
float wfLump(vec2 p, float per){
  return 0.67 * wfNoise(p, per) + 0.33 * wfNoise(p * 2.0 + vec2(17.1, 5.3), 2.0 * per) - 0.5;
}

void main(){
  float acrossM = aFlowA.y * aFlowB.w;
  float tau = aFlowA.x;
  float speed = max(aFlowA.w, 0.5);
  float aeration = aFlowB.x;
  //The time term, wrapped for float precision on a whole number of lump cells that is also
  //whole in the edge wobble's ×1.7 (a multiple of 10), with the noise periodic at that count.
  float lumpCells = max(10.0 * floor(25.6 * uLumpRate + 0.5), 10.0);
  float lumpPhase = mod(t * uLumpRate, lumpCells);
  //Lumps on the free fall only: the attached ends are the creek's surface carried on, and
  //the landing tail (the most aerated rows) poked white lumps up through the pool.
  float amp = uLumpAmp * (0.15 + 0.85 * aeration) * aFlowLump.x;

  vec3 N = normalize(normal);
  vec3 T = normalize(aFlowTangent);
  vec3 A = normalize(aFlowAcross);

  //Displacement along the normal, and its derivatives across (per metre) and along (per
  //second of flight) for the rebuilt normal.
  const float DU = 0.2;   //m
  const float DT = 0.04;  //s
  vec2 q  = vec2(acrossM / uLumpScale, tau * uLumpRate - lumpPhase);
  float d0 = amp * wfLump(q, lumpCells);
  float du = amp * wfLump(q + vec2(DU / uLumpScale, 0.0), lumpCells);
  float dv = amp * wfLump(q + vec2(0.0, DT * uLumpRate), lumpCells);
  vec3 dPdu = A + N * ((du - d0) / DU);
  vec3 dPdt = T * speed + N * ((dv - d0) / DT);
  vec3 Nd = normalize(cross(dPdt, dPdu));
  Nd *= sign(dot(Nd, N) + 1e-6);

  //Ragged sides: the outer columns wander in and out across the flow.
  float edge = smoothstep(0.6, 1.0, abs(aFlowA.y));
  //Free fall only (aFlowLump), like the lumps: on the attached tail the edge columns swung
  //40 cm sideways over the banks and stuck out as flags at both ends of the foot (round 10).
  float wobble = uEdgeWobble * edge * (wfLump(q * vec2(0.6, 1.7) + vec2(41.7, 3.1), 1.7 * lumpCells) * 2.0) * (0.3 + 0.7 * aeration) * aFlowLump.x;

  //Wind gusts on the free fall. The steady bow downwind is already in the trace (air drag on
  //the sheet, WaterfallNappe.traceStrand); this is the gusting about it, by the same law: the
  //wind normal to the sheet Un pushes it at a = 0.5 rho_air Cd Un|Un| / (rho_water h), so a
  //gust that changes the wind by a fraction s changes a by 2s, and the sheet moves 0.5 a t^2
  //over the t seconds since this stretch left the ground. Free fall only, ramped in and out
  //inside its ends (aFlowLump.x), so the lip and the foot stay where the trace put them.
  //Cd 1 as in the trace (sheetDragCd). FUDGE: the gust itself (two slow octaves of noise,
  //about 3 s across, drifting 20 m across the sheet) is a look choice.
  float un = dot(vec3(uWind.x, 0.0, uWind.y), N);
  float aDrag = 0.5 * 1.2 * un * abs(un) / (1000.0 * max(aFlowA.z, 0.02));
  float gust = 2.0 * wfLump(vec2(acrossM * 0.05 + 7.3, mod(t * 0.35, 100.0)), 100.0);
  float tf = aFlowLump.y;
  float sway = clamp(0.5 * aDrag * 2.0 * uWindSway * gust * tf * tf, -1.5, 1.5) * aFlowLump.x;

  vec3 displaced = position + N * (d0 + sway) + A * sign(aFlowA.y) * wobble;
  //ATTACHED rows stand on the creek: at its level where it has one above the traced height
  //(so the two surfaces coincide wherever the creek draws, and the creek, polygon-offset
  //toward the camera, wins), at the trace's height where the creek's interpolated level
  //sinks under the brink. At the landing that is the pool's real level: rigid at the trace's
  //height, the tail ran under the pool and under the banks at its edges (round 7).
  //The creek's level as a MINIMUM: near the foot the field's cells still hold the ramp's
  //level (2.4 m at hero-creek's z 766 against a 1.9 m tail), and a plain sample yanked single
  //vertices half a metre up, folding the tail into edge-on strips.
  vec2 fd = aFlowTangent.xz;
  fd = dot(fd, fd) > 1e-6 ? normalize(fd) * 0.75 : vec2(0.0);
  //The level HERE, dropping to the downstream sample only where the level falls steeply
  //ahead (the ramp). The plain minimum sat the tail a few cm under a pool whose level eases
  //down downstream, so the creek covered it where it draws and it showed where the creek
  //fades: foam "right underneath the water" (round 10).
  float lvHere = creekLevelAt(displaced.xz, displaced.y);
  float lvDown = creekLevelAt(displaced.xz + fd, displaced.y);
  float creekY = mix(lvHere, min(lvHere, lvDown), smoothstep(0.1, 0.25, lvHere - lvDown));
  //...and ATTACHED_LIFT above it. The sheet draws ON TOP of the creek and its fragment alpha
  //is the complement of the creek's visibility there, so the two blend instead of stacking.
  //Coincident with the creek it lost the depth test to it (the creek is polygon-offset toward
  //the camera and writes depth even where it has faded to nearly nothing), which left a hole
  //at the foot: a faint creek in front of a hidden tail (round 7).
  const float ATTACHED_LIFT = 0.03;
  //...by at most ATTACHED_LIFT_MAX. Beside a step face the field's texels still hold the upper
  //tread's level, and single vertices of a landing tail or a steep row were yanked up to it (up to a
  //whole step, 2-3 m on falls-lab B): spikes out of the sheet. Where the creek really is higher
  //than the trace (a pool over the tail) it is by centimetres, the trace rides the level.
  const float ATTACHED_LIFT_MAX = 0.3;
  creekY = min(creekY, displaced.y + ATTACHED_LIFT_MAX);
  displaced.y = mix(max(creekY, displaced.y) + ATTACHED_LIFT, displaced.y, aFlowB.z);
  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * Nd);
  vFlowA = aFlowA;
  vFlowB = aFlowB;
  //PLAN velocity: the unit tangent's xz part times the speed. normalize(planT) × speed took
  //the full 3D speed as horizontal and over-advected the lead-in's ripples on steep rows.
  vFlowVel = aFlowTangent.xz * aFlowA.w;
  vFlowAcrossDir = normalize(aFlowAcross);
  vFlowDownDir = normalize(aFlowTangent);
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
