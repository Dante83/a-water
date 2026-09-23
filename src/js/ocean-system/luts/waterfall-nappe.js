//=============================================================================
// WaterfallNappe — where a fall's water actually goes (Phase 6)
//=============================================================================
//
// a-land exports a waterfall as two BED points and a few scalars:
//   {top:[x,y,z], bottom:[x,y,z], width, discharge, drop}
// `top` is the first fall cell, `bottom` the first cell below the run, both at
// cell centres and both at GROUND height. There is no lip line and no trajectory.
// The flowing-water heightfield can only stretch a steep ramp across that step,
// which is what clipped every fall into its cliff through Phase 4.
//
// This file answers the missing question on the CPU, once per fall (not per
// frame): follow the fall's water from a couple of metres upstream of the lip to
// wherever it comes to rest, as a SKIRT of parcels (strands) seeded every half metre
// across the creek, each traced on its own, and weave the sheet between neighbouring
// paths (see trace and buildRibbon). The renderer (WaterfallSheetPass) draws the weave.
//
// CASCADES ARE THE MAIN CASE, NOT THE EXCEPTION. island-sholes' "13 falls" are
// chains: each fall's `bottom` is exactly the next fall's `top` (125.5 → 116.8 →
// 114.3 → 111.8 …), plus one 49 m drop down a 36 m run, which is a chute, not a
// free fall. So each parcel is a small state machine on the terrain:
//
//   ATTACHED  sliding on the bed. Gravity projected onto the ground's tangent
//             plane, minus Manning friction (implicit, so steep fast chutes stay
//             stable). Friction is what gives a chute a terminal speed; on the
//             gentle creek above a lip it settles to the Manning velocity.
//   AIRBORNE  free flight, v.y -= g·dt. The parcel leaves the bed wherever the
//             ground falls away faster than a free parabola would — which is the
//             exact physical definition of a lip, so no lip detection is needed.
//   IMPACT    landing on a ledge: the velocity component into the ground is lost
//             (inelastic), recorded as an impact for the spray, and the parcel is
//             ATTACHED again. The next lip launches it again. That is the bounce
//             from one step to the next.
//   WALL      running into a face (a rock standing in the fall, a bank), flying or
//             sliding: the speed into it is lost (an impact, flying) and the parcel
//             goes on along it or down it; head-on and sliding, it stops there.
//             Across, a sliding parcel feels the creek's SURFACE slope where it has
//             water (flat across a creek), not the bed's, which shelves to the banks.
//   PLUNGE    reaching a POOL — water at least plungeMinDepth deep and slower than
//             Froude plungeMaxFroude — flying or sliding: an impact at the surface,
//             then the parcel runs plungeDepth under it and stops (the pool's own
//             surface depth-clips the sheet there). Fast water, however deep, is
//             ridden, not landed in.
//
// Flow per unit width q = Q / width sets everything else:
//   critical depth h_c = (q²/g)^(1/3), critical speed v_c = (g·q)^(1/3) — flow
//   approaching a free overfall is critical, so the parcel starts at v_c;
//   thickness along the path h = q / |v| (continuity: the jet thins as it speeds up).
//
// AERATION is a budget A with a = 1 − e^(−A):
//   start:     a = startAeration × the creek's energy where the trace begins (default 0);
//   airborne:  dA = fall height / L_b, L_b = BREAKUP_K · q^BREAKUP_EXP metres, a
//              jet break-up length of the Horeni form (6·q^0.32; quoted from
//              memory of the plunge-jet literature — ⚠ verify before tuning on it);
//   impact:    dA = normal speed lost / IMPACT_AERATION_SPEED;
//   chute:     dA = path / CHUTE_AERATION_LENGTH where the bed is steeper than
//              tan 30° (self-aerated chute flow);
//   gentle:    A decays over AERATION_DECAY_LENGTH (bubbles rise out).
// The rendering turns a into whitewater; clear lip water stays clear.
//
// PRESENCE is where the sheet draws: the free fall only, each airborne stretch in
// proportion to how far it falls (a 5 cm hop over a run-out is not a fall). Everything
// attached is the creek's own surface. The flowing-water material steps aside inside the
// corridor boxes around the airborne rows (below) where its level is steep: the heightfield
// ramp it would otherwise stretch down the step.
//
// No THREE here: pure math, so Node can test it (see the Phase 6 section of
// WATER-TYPES-PROGRESS.md).
//
// env contract (all world metres):
//   env.groundAt(x, z) → ground height, or null when the terrain is not loaded
//   env.waterAt(x, z)  → {level, depth, vx, vz} or null (a-land getWaterAt)

ARestlessOcean.WaterfallNappe = {};

(function(N){
  const G = 9.81;
  N.G = G;

  N.DEFAULTS = {
    dt: 0.01,                   //s, integration step
    maxTime: 60.0,              //s of flight + slide before giving up
    maxPath: 600.0,             //m
    manningN: 0.04,             //rough rock channel (Chow 1959 tables: 0.035-0.05)
    minDepth: 0.02,             //m, floor on h = q/|v| for the friction term
    upstreamStart: 2.0,         //m upstream of the first fall's `top` to start
    maxStartSpeed: 10.0,        //m/s cap on the field speed the parcel inherits at the start
    chainGap: 6.0,              //m, a fall's bottom → the next fall's top to chain them
    rowSpacing: 0.25,           //m of arc length between ribbon rows
    gentleSlope: Math.tan(20.0 * Math.PI / 180.0), //bed slope below which the parcel is on gentle ground (settling) ...
    chuteSlope: Math.tan(30.0 * Math.PI / 180.0),  //... and above which it is on a chute (self-aeration)
    faceSlope: Math.tan(55.0 * Math.PI / 180.0),   //bed slope above which water sliding after a fall is still FALLING: down a
                                //face no heightfield can draw (Dante 2026-09-23, amending "free fall only"; see resample)
    presenceSmoothRows: 1,      //± rows of box smoothing on presence
    hopDropLo: 0.25,            //m an airborne stretch must fall to start counting as a fall ...
    hopDropHi: 0.75,            //... and to count fully
    lipNormalRadius: 3.0,       //m: the disc round a lip whose mean downhill sets the heading
    brinkLead: 3.0,             //m the sheet leads into each takeoff ...
    fallSmooth: 0.5,            //m inside each end of a fall over which its lumps ramp in and out
    landTail: 3.0,              //... and runs on after each landing (see resample). Generous: the
                                //material draws them only where the creek does not.
    settleRun: 3.0,             //m of gentle attached path after the last fall to stop
    plungeMinDepth: 0.4,        //m, water at least this deep ...
    plungeMaxFroude: 0.6,       //... and at most this Froude number is a pool to plunge into
    plungeDepth: 0.3,           //m the sheet runs on under a pool's surface
    plungeMinFall: 0.3,         //m the jet must fall below its takeoff before a pool counts
    detachMargin: 0.0005,       //m per step the bed must out-drop the free parabola by to launch
    breakupK: 6.0,
    breakupExp: 0.32,
    startAeration: 0.0,         //aeration at the start per unit of the creek's energy (< 1). 0:
                                //a-land's energy said 0.9 "whitewater" on hero-creek's FV creek,
                                //which renders clear, and the jet left the lip already opaque
                                //white against it. The lip is a glassy tongue that whitens as it falls.
    impactAerationSpeed: 3.0,   //m/s of lost normal speed per unit of aeration budget
    chuteAerationLength: 5.0,   //m
    aerationDecayLength: 3.0,   //m
    minImpactSpeed: 0.5,        //m/s normal speed below which a touchdown is not recorded
    corridorLead: 2.0,          //m of creek/sheet cross-dissolve before each takeoff
    corridorTail: 2.0,          //m each run's last box reaches past the landing (the creek's ramp; see buildCorridors)
    corridorLength: 4.0,         //m of plan length per corridor box
    corridorMargin: 2.0,         //m added to the half-width: the creek's ramp runs a metre or two past the
                                 //lip span at the foot (bank slivers at hero-creek with 0.75)
    wetScanStep: 0.25,          //m, across-flow step of the wet-width scan
    wetGap: 2.0,                //m of dry the scan steps over inside a lip (a rock in the water); the seeds on
                                //it are skipped, so the sheet tears round the rock (beginTrace)
    wetMinDepth: 0.02,          //m of water that counts as wet for it (the corridor's lipSpan)
    visibleDepth: 0.06,         //m of water the creek visibly draws (mid of its 3→10 cm fade): the sheet's width
    minWidth: 1.0,              //m, narrowest jet
    minUnitDischarge: 0.01,     //m²/s below which the field's depth × speed is not trusted
    climbStop: 0.3,             //m an attached parcel may climb before it counts as ponded
    stallTime: 2.0,             //s ...
    stallDistance: 1.0,         //... and the plan progress it must make in that time
    lipSearch: 10.0,            //m past the start a strand may run without meeting a fall before it gives up
    wallJump: 0.25,             //m the ground may stand above a falling parcel where it crosses into it and still be a
                                //ledge it lands on; more is a wall it hits (traceStrand)
    strandSpacing: 0.5,         //m between the skirt's seeds across the creek (see trace)
    tearFactor: 3.0,            //× the seed spacing two neighbouring strands may drift apart ACROSS the flow and stay one sheet
    tearTime: 0.3,              //s of their speed they may drift apart ALONG it on top of that (buildRibbon)
    tearRelSpeed: 1.0,          //m/s two joined strands may differ in velocity past what that lag explains (g·tearTime):
                                //LOOK KNOB, lower tears more (the fins on jagged ledges), higher keeps more sheet
    tearGroundTolerance: 0.05,  //m the ground may stand above the midpoint between two strands before the sheet tears
    impactClusterWidth: 2.5,    //m of neighbouring strands' touchdowns merged into one impact (FlowFoamPass keeps
                                //only its nearest 16 over every fall: a 4-step cascade at 1.5 m filled it)
    sheetDragCd: 1.0            //air drag coefficient on the airborne sheet, face-on (FUDGE: flat-plate order of magnitude)
  };

  function opt(o, k){ return (o && o[k] !== undefined) ? o[k] : N.DEFAULTS[k]; }
  function smoothstep(a, b, x){ const t = Math.min(Math.max((x - a) / (b - a), 0.0), 1.0); return t * t * (3.0 - 2.0 * t); }

  //Ground normal by central differences (eps metres). Returns null off the loaded terrain.
  function groundNormal(env, x, z, eps, out){
    const hL = env.groundAt(x - eps, z), hR = env.groundAt(x + eps, z);
    const hD = env.groundAt(x, z - eps), hU = env.groundAt(x, z + eps);
    if(hL == null || hR == null || hD == null || hU == null) return null;
    let nx = hL - hR, ny = 2.0 * eps, nz = hD - hU;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }

  //The normal the PARCEL feels: along its plan direction (dx, dz) the slope is an
  //upwind (backward) difference — the ground it is on and has come over — and across
  //it a central one. A central difference along the flow reaches over a lip before the
  //water gets there and tilts the support early, which tipped parcels over sharp edges
  //half a stencil too soon and logged phantom impacts. Lips are found only by the
  //free-parabola test in trace().
  function groundNormalUpwind(env, x, z, dx, dz, eps, out){
    const g0 = env.groundAt(x, z), gb = env.groundAt(x - dx * eps, z - dz * eps);
    const cx = -dz, cz = dx;
    const gl = env.groundAt(x - cx * eps, z - cz * eps), gr = env.groundAt(x + cx * eps, z + cz * eps);
    if(g0 == null || gb == null || gl == null || gr == null) return null;
    let sa = (g0 - gb) / eps;
    let sc = (gr - gl) / (2.0 * eps);
    //ACROSS, water in a channel is driven by its SURFACE, not its bed: the bed shelves up to the
    //banks under a flat creek, and on that slope every strand but the middle one was pushed to
    //the middle (an edge strand crossed a 5 m creek before its lip). Where the parcel is in the
    //field's water, the across slope is the level's, one-sided where one side is dry (a bank).
    //Along the flow it stays the bed's: lips are found on the bed (see trace).
    const w0 = waterHere(env, x, z);
    if(w0){
      const wl = waterHere(env, x - cx * eps, z - cz * eps), wr = waterHere(env, x + cx * eps, z + cz * eps);
      const lv0 = g0 + w0.depth;
      if(wl && wr) sc = ((gr + wr.depth) - (gl + wl.depth)) / (2.0 * eps);
      else if(wl) sc = (lv0 - (gl + wl.depth)) / eps;
      else if(wr) sc = ((gr + wr.depth) - lv0) / eps;
      else sc = 0.0;
    }
    //...except just past a RIM: ground behind that is lower than here by more than 45° is a gap
    //the parcel flew over (a rock standing off a cliff), not a bed rising under it. Upwind, a
    //strand landing near a jut's front edge read a 19:1 up-slope and was pushed back off it.
    //There the bed ahead says what it is on, unless that is a wall too: a SLOT (a gap behind, a
    //face ahead, the foot between a cliff and a rock off it) reads as flat. Read off the face,
    //the parcel was thrown back at the cliff, and off the cliff back at the face, all budget long.
    if(sa > 1.0){
      const gf = env.groundAt(x + dx * eps, z + dz * eps);
      if(gf != null) sa = (gf - g0) / eps > 1.0 ? 0.0 : (gf - g0) / eps;
    }
    const gx = dx * sa + cx * sc, gz = dz * sa + cz * sc;
    const l = Math.sqrt(gx * gx + 1.0 + gz * gz);
    out[0] = -gx / l; out[1] = 1.0 / l; out[2] = -gz / l;
    return out;
  }

  //The field's water at (x, z) as {depth, fr}: depth from the field's own `depth`
  //(the field is per texel while the ground is interpolated, so `level − ground`
  //invents a metre of water wherever a wet texel overhangs a cliff ramp), and the
  //Froude number |v|/√(g·depth). Null when dry or unknown.
  function waterHere(env, x, z){
    const w = env.waterAt ? env.waterAt(x, z) : null;
    if(!w) return null;
    const d = (w.depth != null && isFinite(w.depth)) ? Math.max(w.depth, 0.0) : 0.0;
    if(!(d > 0.0)) return null;
    const v = Math.sqrt((w.vx || 0) * (w.vx || 0) + (w.vz || 0) * (w.vz || 0));
    return {depth: d, fr: v / Math.sqrt(G * d), level: (w.level != null && isFinite(w.level)) ? w.level : null};
  }

  //Height above the bed of the surface the attached parcel rides: the larger of the
  //jet's own thickness and the field's water depth, so an attached sheet sits ON the
  //creek surface rather than under it. The depth never lifts it above the field's own LEVEL:
  //on a sill at a brink the field keeps its upstream depth while its interpolated level runs
  //under the ground, and the lead-in rode 0.6 m over the creek there (falls-lab E, 2026-09-23).
  //Only ever lowers: where a wet texel overhangs a ramp (level − ground > depth), depth stands.
  function attachedOffset(env, x, z, gy, h){
    const w = waterHere(env, x, z);
    if(!w) return h;
    const d = w.level != null ? Math.min(w.depth, w.level - gy) : w.depth;
    return Math.max(h, d);
  }

  //A plunge pool: deep AND slow. Deep alone is not enough — the solver can put fast
  //water deeper than plungeMinDepth on the lip cell and down the ramp (Fr ≈ 1, measured
  //on hero-creek's FV solve), and the jet does not "land" in water that is leaving.
  function isPool(w, o){
    return !!w && w.depth >= opt(o, 'plungeMinDepth') && w.fr <= opt(o, 'plungeMaxFroude');
  }

  //Unit plan direction downhill across a lip at (x, z): the ground's gradient summed over a
  //disc of radius r (m), or null where the ground there is flat (under ~5°) or not loaded.
  N.lipDownhill = function(env, x, z, r){
    let gx = 0.0, gz = 0.0, cnt = 0;
    const st = Math.max(r / 6.0, 0.25), e = 0.5 * st;
    for(let a = -r; a <= r + 1e-6; a += st){
      for(let b = -r; b <= r + 1e-6; b += st){
        if(a * a + b * b > r * r) continue;
        const px = x + a, pz = z + b;
        const g1 = env.groundAt(px + e, pz), g0 = env.groundAt(px - e, pz);
        const g3 = env.groundAt(px, pz + e), g2 = env.groundAt(px, pz - e);
        if(g0 == null || g1 == null || g2 == null || g3 == null) return null;
        gx += (g1 - g0) / (2.0 * e); gz += (g3 - g2) / (2.0 * e); ++cnt;
      }
    }
    if(!cnt) return null;
    gx /= cnt; gz /= cnt;
    const gl = Math.sqrt(gx * gx + gz * gz);
    if(gl < 0.09) return null;
    return [-gx / gl, -gz / gl];
  };

  //Wet extent across the flow at (x, z) along the unit direction (ax, az), out to maxW/2
  //each side: {width, offset} where offset moves (x, z) to the middle of the wet span.
  //Null when (x, z) itself is dry or the water is unknown. maxGap (m, optional): dry runs up
  //to this long inside the span do not end it (a rock standing in a wide lip: falls-lab C's
  //1.5 m notch cut its scan, and the curtain, to 9 of its 20 m).
  N.wetSpan = function(env, x, z, ax, az, maxW, step, minDepth, maxGap){
    const isWet = function(d){
      const w = waterHere(env, x + ax * d, z + az * d);
      return !!w && w.depth >= minDepth;
    };
    if(!isWet(0.0)) return null;
    const half = 0.5 * maxW, gap = maxGap || 0.0;
    const reach = function(sign){
      let last = 0.0;
      for(let d = step; d <= half + 1e-6 && d - last <= gap + step + 1e-6; d += step) if(isWet(sign * d)) last = d;
      return last;
    };
    const r = reach(1.0), l = reach(-1.0);
    return {width: r + l + step, offset: 0.5 * (r - l)};
  };

  //Group falls into cascades: fall j follows fall i when j's top is within chainGap
  //(plan) of i's bottom and not above it by more than a metre. Returns arrays of
  //falls, upstream first. Every fall lands in exactly one chain.
  //A carved staircase (a-land fall sites, simulation 0.2.0) says so itself: the steps of one
  //site.cascade chain in site.step order, whatever their treads' length (each holds a pool and
  //an approach, often more than chainGap).
  N.chains = function(falls, o){
    const gap = opt(o, 'chainGap');
    const n = falls.length;
    const succ = new Array(n).fill(-1), hasPred = new Array(n).fill(false);
    for(let i = 0; i < n; ++i){
      const si = falls[i].site;
      if(!si || si.cascade == null) continue;
      for(let j = 0; j < n; ++j){
        const sj = falls[j].site;
        if(j !== i && sj && sj.cascade === si.cascade && sj.step === si.step + 1 && !hasPred[j]){ succ[i] = j; hasPred[j] = true; break; }
      }
    }
    for(let i = 0; i < n; ++i){
      if(succ[i] >= 0) continue;
      const b = falls[i].bottom;
      if(!b || !falls[i].top) continue;
      let best = -1, bestD = gap * gap;
      for(let j = 0; j < n; ++j){
        if(j === i || hasPred[j] || !falls[j].top) continue;
        const t = falls[j].top;
        const dx = t[0] - b[0], dz = t[2] - b[2], d2 = dx * dx + dz * dz;
        if(d2 <= bestD && t[1] <= b[1] + 1.0){ best = j; bestD = d2; }
      }
      if(best >= 0){ succ[i] = best; hasPred[best] = true; }
    }
    const out = [], used = new Array(n).fill(false);
    const walk = function(i){
      const c = [];
      while(i >= 0 && !used[i]){ used[i] = true; c.push(falls[i]); i = succ[i]; }
      return c;
    };
    for(let i = 0; i < n; ++i) if(!hasPred[i] && !used[i] && falls[i].top && falls[i].bottom) out.push(walk(i));
    for(let i = 0; i < n; ++i) if(!used[i] && falls[i].top && falls[i].bottom) out.push(walk(i)); //cycles, defensively
    return out;
  };

  //Trace a chain. Returns null when the terrain under the start is not loaded yet (the
  //caller retries), else the nappe:
  //  {strands[] (each {q, hc, vc, share, samples[], rows[], impacts[], plunge, stop}, or null),
  //   spine (the index of the middle strand that falls), width, discharge, impacts[] (clustered,
  //   each with its own width and discharge), corridors[], reach, halfWidth, spacing,
  //   and the spine's own q, hc, vc, samples[], rows[], plunge and
  //   stop: why it ended — plunge | settled | stopped | climb | stall | wall | nolip | unloaded | budget}
  //
  //THE SKIRT (2026-09-22). A fall is traced as MANY parcels, not one: a seed every
  //strandSpacing across the creek a couple of metres upstream of the lip, each run through the
  //state machine above on its own (traceStrand), and the sheet woven between neighbouring paths
  //(buildRibbon), like a cloth skirt hung off the brink. Each strand finds its own lip and its
  //own landing, so the sheet follows a curved brink, a sloped pool and a ledge that is not
  //square to the flow; where a rock splits the water its strands go different ways and the
  //weave tears between them. The single-parcel trace extruded rigid rows across the width at
  //one height instead, which could not meet anything that was not flat and square (the planes
  //that did not blend into the terrain, Dante 2026-09-22), and the walls, landing spans and
  //"shrink and stay shrunk" it needed to stay out of the rock are gone with it.
  //
  //Staged, so the pass can spread one chain's strands over several frames:
  //  job = N.beginTrace(chain, env, o)  the chain's heading, start line and seeds (null: unloaded)
  //  N.stepTrace(job, k)                traces up to k more strands; true once finished, with
  //                                     the result in job.nappe (null: retry later)
  //N.trace runs a job to the end.
  //
  //env.wind (optional) = {x, z} m/s: air drag on the airborne sheet (traceStrand). Absent = still air.
  N.trace = function(chain, env, o){
    const job = N.beginTrace(chain, env, o);
    if(!job) return null;
    while(!N.stepTrace(job, 1 << 30)){}
    return job.nappe;
  };

  N.beginTrace = function(chain, env, o){
    const first = chain[0], last = chain[chain.length - 1];
    let Q = 0.0, W = 0.0;
    for(let i = 0; i < chain.length; ++i){
      Q = Math.max(Q, chain[i].discharge || 0.0);
      W = Math.max(W, chain[i].width || 0.0);
    }
    if(!(W > 0.0)) W = 4.0;
    if(!(Q > 0.0)) Q = 0.5;
    const site = N.siteOf(first);
    if(site) return siteTrace(chain, env, o, site, Q);

    //No carved site (hand-made terrain, a world baked before simulation 0.2.0): find the lip.
    //Plan heading: square to the LIP. The ground's downhill direction averaged over a disc
    //round the lip straddles the edge, so it is the cliff line's normal. The field current
    //there is a-land's D8 step direction (axis or 45° diagonal): as the heading it swung the
    //sheets 15-45° off clean edges (falls-lab after the carve, 2026-09-23). The current is
    //only the fallback where the lip reads flat, then top → bottom.
    let hx = first.bottom[0] - first.top[0], hz = first.bottom[2] - first.top[2];
    let hl = Math.sqrt(hx * hx + hz * hz);
    //The disc grows with the fall's width (a quarter of it, up to 8 m): on a wide lip a 3 m disc
    //sat beside one rock notch and turned falls-lab C's 20 m curtain 13° off its edge. The
    //loaded-ground check falls back to the plain radius.
    const lipR = opt(o, 'lipNormalRadius');
    const lipN = N.lipDownhill(env, first.top[0], first.top[2], Math.min(Math.max(0.25 * W, lipR), 8.0))
              || N.lipDownhill(env, first.top[0], first.top[2], lipR);
    const w0 = env.waterAt ? env.waterAt(first.top[0], first.top[2]) : null;
    if(lipN){
      hx = lipN[0]; hz = lipN[1]; hl = 1.0;
    } else if(w0 && w0.vx != null && Math.sqrt(w0.vx * w0.vx + w0.vz * w0.vz) > 0.1){
      hx = w0.vx; hz = w0.vz; hl = Math.sqrt(hx * hx + hz * hz);
    }
    if(hl > 1e-6){ hx /= hl; hz /= hl; } else { hx = 0.0; hz = 1.0; }
    let lx = last.bottom[0] - last.top[0], lz = last.bottom[2] - last.top[2];
    const ll = Math.sqrt(lx * lx + lz * lz);
    if(ll > 1e-6){ lx /= ll; lz /= ll; } else { lx = hx; lz = hz; }

    //Start upstream of the lip, but not in still water or a hollow: on a cascade's short
    //tread, 2 m back is the rim of the pool below the step before, and a parcel launched
    //there climbed out of the pool and stalled (falls-lab B, 2026-09-22). Step toward the lip.
    let up = opt(o, 'upstreamStart');
    for(let t = 0; t < 3; ++t, up *= 0.5){
      const cx = first.top[0] - hx * up, cz = first.top[2] - hz * up;
      const cg = env.groundAt(cx, cz);
      if(cg == null || cg < first.top[1] - 0.3 || isPool(waterHere(env, cx, cz), o)) continue;
      //...and no dip on the way to the lip: a parcel launched behind a pit dies in it and the
      //fall draws nothing (a 2 m hollow the carve cut behind falls-lab A's lip, 2026-09-23).
      //A hollow is ground that dips > 0.3 m below the start and then RISES again toward the
      //lip; the brink itself only drops (a-land's top can sit just past it).
      let clear = true, lowG = cg;
      for(let d = up - 0.25; d > 0.0; d -= 0.25){
        const gd = env.groundAt(first.top[0] - hx * d, first.top[2] - hz * d);
        if(gd == null) continue;
        if(gd < lowG) lowG = gd;
        else if(lowG < cg - 0.3 && gd > lowG + 0.3){ clear = false; break; }
      }
      if(clear) break;
    }
    const px0 = first.top[0] - hx * up, pz0 = first.top[2] - hz * up;
    if(env.groundAt(px0, pz0) == null) return null;
    let px = px0, pz = pz0;
    //The jet is as wide as the WATER at the start, not a-land's exported width: that is
    //its hydraulic-geometry estimate (4·√Q, 14 m for every island-sholes fall), and a rigid
    //14 m airborne sheet over a 5 m gully stood out past both banks. Scan across the flow
    //for the wet extent (capped at the exported width) and centre the start on it.
    const step = opt(o, 'wetScanStep');
    const gap = opt(o, 'wetGap');
    const wet = N.wetSpan(env, px, pz, -hz, hx, W, step, opt(o, 'wetMinDepth'), gap);
    if(wet){
      W = Math.max(wet.width, opt(o, 'minWidth'));
      px += -hz * wet.offset; pz += hx * wet.offset;
      if(env.groundAt(px, pz) == null) return null;
    }
    //Seeds span the VISIBLE water (visibleDepth, the creek's own draw rule): the sheet leaves
    //the lip as wide as the river the creek draws there. Measured to 2 cm the fall came out
    //wider than the creek (hero-creek-sky, Dante). Where nothing is visible, the wet width.
    let span = W, spanOff = 0.0;
    const vis = N.wetSpan(env, px, pz, -hz, hx, W, step, opt(o, 'visibleDepth'), gap);
    //Between the outermost wet SAMPLES: wetSpan's width carries half a scan step of margin each
    //side, which put the edge seeds on the banks (dry, a metre up, carrying the whole Q/W).
    if(vis){ span = Math.max(vis.width - step, opt(o, 'minWidth')); spanOff = vis.offset; }
    return seedTrace(chain, env, o, {hx: hx, hz: hz, lx: lx, lz: lz, up: up,
                                      rail: Math.max(opt(o, 'upstreamStart') - up, 0.0),
                                      px: px, pz: pz, W: W, Q: Q, span: span, spanOff: spanOff, skipDry: !!wet});
  };

  //The carved site of a waterfalls[] entry (a-land simulation 0.2.0), checked for the fields the
  //trace reads; null for an entry without one.
  N.siteOf = function(f){
    const t = f && f.site;
    if(!t || !t.lip || t.lip.length !== 2 || !t.normal || !(t.wetWidth > 0)) return null;
    return t;
  };

  //THE CARVED SITE (a-land's fall-site carve, 2026-09-23: "the river owns its falls"). a-land
  //cut the ground at this fall into one shape: a flat approach, a straight lip level across,
  //square to the reach, a vertical face and a pool. So nothing is discovered: the heading is the
  //lip's normal, the seeds sit on the approach one line back from the lip, as wide as the wet
  //width, and no rail is needed (the approach is flat and at least carveFallApproachM long).
  //The start rule, the lip-heading disc and the wet-span scan above stay for un-carved falls.
  function siteTrace(chain, env, o, t, Q){
    const last = chain[chain.length - 1], tl = N.siteOf(last) || t;
    const cx = 0.5 * (t.lip[0][0] + t.lip[1][0]), cz = 0.5 * (t.lip[0][2] + t.lip[1][2]);
    let hx = t.normal[0], hz = t.normal[1];
    const hl = Math.hypot(hx, hz) || 1.0;
    hx /= hl; hz /= hl;
    let lx = tl.normal[0], lz = tl.normal[1];
    const ll = Math.hypot(lx, lz) || 1.0;
    lx /= ll; lz /= ll;
    const up = Math.min(opt(o, 'upstreamStart'), Math.max(t.approach || 0.0, 0.5));
    const px = cx - hx * up, pz = cz - hz * up;
    if(env.groundAt(px, pz) == null) return null;
    //the flat bed runs the whole wet width; the edge seeds sit half a spacing in from its ends,
    //where the bank starts to rise
    const span = Math.max(t.wetWidth - opt(o, 'strandSpacing'), opt(o, 'minWidth'));
    return seedTrace(chain, env, o, {hx: hx, hz: hz, lx: lx, lz: lz, up: up, rail: 0.0,
                                      px: px, pz: pz, W: t.wetWidth, Q: t.discharge > 0 ? t.discharge : Q,
                                      span: span, spanOff: 0.0, skipDry: false, site: t});
  }

  //Seeds across the start line (both paths above): an odd count spread over `span`, each with
  //the field's own discharge per width.
  function seedTrace(chain, env, o, a){
    const hx = a.hx, hz = a.hz, px = a.px, pz = a.pz, W = a.W, Q = a.Q, span = a.span, spanOff = a.spanOff;
    //An ODD count, so a strand runs down the middle (the spine: the corridors and the
    //single-parcel fields below follow it) and the across coordinate is symmetric.
    const nHalf = Math.max(Math.round(0.5 * span / opt(o, 'strandSpacing')), 0);
    const nS = 2 * nHalf + 1;
    const spacing = nHalf > 0 ? 0.5 * span / nHalf : 0.0;
    //Each strand's share of the width, summing to W (the wet width the flow crosses).
    const share = nHalf > 0 ? W / (nS - 1) : W;
    const qCap = Q / W;
    const seeds = new Array(nS);
    for(let j = 0; j < nS; ++j){
      const a = spanOff + (j - nHalf) * spacing;
      const sx = px - hz * a, sz = pz + hx * a;
      const gy = env.groundAt(sx, sz);
      if(gy == null){ seeds[j] = null; continue; }
      //Flow per unit width from the field's own water here (depth × speed), so each strand
      //carries what is drawn and the edges, shallow, run thin: a-land's exported discharge is
      //its default source (12.5 m³/s on every island-sholes creek), and forced through the
      //measured wet width it made a 1.7 m-thick jet out of a 1.8 m creek. Q/W where the field
      //is silent.
      let q = qCap, vField = 0.0;
      const wv = env.waterAt ? env.waterAt(sx, sz) : null;
      const wq = waterHere(env, sx, sz);
      //A seed on the dry rock the scan stepped over (wetGap) is no water: no strand, so the weave
      //tears round the rock. Only where the field has water at all (else every seed is Q/W).
      if(a.skipDry && !wq){ seeds[j] = null; continue; }
      if(wv && wv.vx != null){
        vField = Math.sqrt(wv.vx * wv.vx + (wv.vz || 0) * (wv.vz || 0));
        const fq = wq ? wq.depth * vField : 0.0;
        if(fq > opt(o, 'minUnitDischarge')) q = Math.min(fq, qCap);
      }
      const e0 = (wv && wv.energy != null && isFinite(wv.energy)) ? Math.min(Math.max(wv.energy, 0.0), 1.0) : 0.0;
      seeds[j] = {x: sx, z: sz, gy: gy, q: q, vField: vField, energy: e0,
                  share: (j === 0 || j === nS - 1) && nS > 1 ? 0.5 * share : share};
    }
    return {chain: chain, env: env, o: o, hx: hx, hz: hz, lx: a.lx, lz: a.lz, up: a.up, rail: a.rail,
            W: W, Q: Q, span: span, nHalf: nHalf, spacing: spacing, site: a.site || null,
            seeds: seeds, strands: new Array(nS), next: 0, nappe: null};
  }

  N.stepTrace = function(job, k){
    const nS = job.seeds.length;
    for(let n = 0; n < k && job.next < nS; ++n, ++job.next){
      const sd = job.seeds[job.next];
      job.strands[job.next] = sd ? N.traceStrand(sd, job) : null;
    }
    if(job.next < nS) return false;
    job.nappe = finishTrace(job);
    return true;
  };

  //One parcel from its seed to wherever it comes to rest (the state machine in the header).
  N.traceStrand = function(seed, job){
    const env = job.env, o = job.o;
    const dt = opt(o, 'dt'), nM = opt(o, 'manningN'), minDepth = opt(o, 'minDepth');
    const hx = job.hx, hz = job.hz, lx = job.lx, lz = job.lz;
    const last = job.chain[job.chain.length - 1];
    const W = job.W, upUsed = job.up;
    const wind = env.wind && (env.wind.x || env.wind.z) ? env.wind : null;
    //Air drag on the sheet, per unit of its speed-normal wind squared and over its thickness:
    //½·ρ_air·Cd / ρ_water. FUDGE (order of magnitude): Cd 1 is a flat plate face-on; a real
    //nappe is lumpy and breaks up, which only adds drag.
    const kDrag = 0.5 * 1.2 * opt(o, 'sheetDragCd') / 1000.0;
    let px = seed.x, pz = seed.z, gy = seed.gy;
    const q = seed.q;
    const hc = Math.cbrt(q * q / G), vc = Math.cbrt(G * q);
    const Lb = opt(o, 'breakupK') * Math.pow(q, opt(o, 'breakupExp'));
    let h = hc;
    let py = gy + attachedOffset(env, px, pz, gy, h);
    //Launch at the creek's own speed where it runs faster than critical: since a-land's export
    //carries its discharge (2026-09-22) the field speed is real, and a parcel started at v_c on
    //a near-flat cascade tread braked to a stall before its lip (falls-lab B).
    const v0 = Math.max(vc, Math.min(seed.vField, opt(o, 'maxStartSpeed')));
    let vx = hx * v0, vy = 0.0, vz = hz * v0;
    const nrm = [0, 1, 0];
    if(groundNormal(env, px, pz, 0.5, nrm)){
      const vn = vx * nrm[0] + vy * nrm[1] + vz * nrm[2];
      vx -= vn * nrm[0]; vy -= vn * nrm[1]; vz -= vn * nrm[2];
    }

    //h = q/|v|, floored for the friction term and capped at 2·h_c: a parcel that
    //stalls on a flat ledge would otherwise claim metres of thickness and be thrown
    //into the air by attachedOffset. Where the water really is deep, the field depth
    //wins in attachedOffset anyway.
    const thickness = function(s){ return Math.min(Math.max(q / Math.max(s, 1e-3), minDepth), 2.0 * hc); };
    let takeoffY = py;
    const startY = py;
    //How wide the channel's water is where the parcel leaves the ground (wetMinDepth, fringe
    //included): the corridor must hide the creek's heightfield ramp across ALL of it, or the
    //fringe's steep-level whitewater pokes out beside the sheet (hero-creek-sky).
    let lipSpan = 0.0;
    //The creek arrives with air in it already: a-land's energy (0 calm .. 1 whitewater) is
    //what the creek surface's own whitewater keys off, so a turbulent approach launches an
    //already-milky jet and a glassy one launches a clear jet.
    let A = -Math.log(1.0 - opt(o, 'startAeration') * seed.energy);
    let airborne = false, tau = 0.0, path = 0.0, gentleRun = 0.0, passed = false;
    let rise = 0.0, stallT0 = 0.0, stallX = px, stallZ = pz;
    let bedSlope = 0.0;   //the bed's slope along the path under an attached parcel, per sample (resample's steep rows)
    const stallTime = opt(o, 'stallTime'), stallDist = opt(o, 'stallDistance');
    let everAirborneOrSteep = false;
    const samples = [], impacts = [];
    let plunge = null;
    const pushSample = function(){
      const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const shl = Math.sqrt(vx * vx + vz * vz);
      samples.push({x: px, y: py, z: pz, tau: tau, speed: s, h: thickness(s),
                    air: airborne ? 1.0 : 0.0, aer: 1.0 - Math.exp(-A), dive: 0.0, bed: airborne ? 0.0 : bedSlope,
                    hx: shl > 1e-4 ? vx / shl : hx, hz: shl > 1e-4 ? vz / shl : hz});
    };
    //THE RAIL: where the start had to move in toward the lip (beginTrace: a hollow, a pool, a bed
    //under a sill), the lead-in still reaches upstreamStart back. Over that stretch the parcel is
    //carried at its start speed straight along the heading on the creek's surface, no physics:
    //a parcel run there stalls in the still water behind a sill or wanders round the hollow, and
    //without the stretch the sheet's lead-in began half a metre from the lip, the creek's own
    //ramp showing in the gap (falls-lab E, 2026-09-23).
    if(job.rail > 0.0){
      const sx = px, sz = pz, sy = py, stepL = v0 * dt;
      for(let d = job.rail; d > 1e-6; d -= stepL){
        const rx = sx - hx * d, rz = sz - hz * d, rg = env.groundAt(rx, rz);
        if(rg == null) continue;
        px = rx; pz = rz; py = rg + attachedOffset(env, rx, rz, rg, h);
        pushSample();
        tau += dt;
      }
      px = sx; pz = sz; py = sy;
    }
    stallT0 = tau;
    pushSample();
    const maxTime = opt(o, 'maxTime'), maxPath = opt(o, 'maxPath');
    const detach = opt(o, 'detachMargin');
    const plungeDepth = opt(o, 'plungeDepth');
    const plungeFall = opt(o, 'plungeMinFall');
    const minImpact = opt(o, 'minImpactSpeed');
    const steep = opt(o, 'chuteSlope'), gentle = opt(o, 'gentleSlope');

    let stop = 'budget';
    while(tau < maxTime && path < maxPath){
      const ox = px, oy = py, oz = pz;
      const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
      h = thickness(s);
      if(airborne){
        //Wind on the sheet: only the wind NORMAL to it pushes (a sheet edge-on to the wind feels
        //skin friction only). Its normal is square to the flow and to the horizontal across axis,
        //so the fall's own motion (in the sheet) never counts: near the lip, where the jet is
        //still flat, a horizontal wind barely acts; down the vertical curtain it bows the sheet
        //by ½·a·t², a ≈ ½ρ_a·Cd·U²/(ρ_w·h), about a metre over 10 m in a 10 m/s wind on a 5 cm sheet.
        if(wind){
          const pl = Math.sqrt(vx * vx + vz * vz);
          const cx = pl > 1e-3 ? -vz / pl : -hz, cz = pl > 1e-3 ? vx / pl : hx;
          //n = v × across (across has no y)
          let nx = vy * cz, ny = vz * cx - vx * cz, nz = -vy * cx;
          const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if(nl > 1e-6){
            nx /= nl; ny /= nl; nz /= nl;
            const un = wind.x * nx + wind.z * nz;
            const a = kDrag * un * Math.abs(un) / h;
            vx += a * nx * dt; vy += a * ny * dt; vz += a * nz * dt;
          }
        }
        vy -= G * dt;
        px += vx * dt; py += vy * dt; pz += vz * dt;
        const g2 = env.groundAt(px, pz);
        if(g2 == null){ stop = 'unloaded'; break; }
        const w = waterHere(env, px, pz);
        const level = w ? g2 + w.depth : -Infinity;
        //A pool only counts once the jet has really fallen: water right at a lip is
        //the creek it just left.
        if(isPool(w, o) && py <= level && (takeoffY - py) > plungeFall){
          //Into a pool: the impact is where the jet crosses its surface.
          if(!plunge){
            plunge = {x: px, y: level, z: pz, vx: vx, vy: vy, vz: vz, nx: 0, ny: 1, nz: 0, vn: -vy, level: level, w: 1.0};
            impacts.push(plunge);
            A += Math.max(-vy, 0.0) / opt(o, 'impactAerationSpeed');
          }
          if(py <= level - plungeDepth){ tau += dt; path += Math.hypot(px - ox, py - oy, pz - oz); pushSample(); stop = 'plunge'; break; }
        }
        else if(py <= g2 + attachedOffset(env, px, pz, g2, h)){
          //Touchdown on a ledge or the chute below: lose the normal component. On the WATER'S
          //surface where the field has some (bed + depth), not bed + jet thickness: landing on
          //the bed and then riding at the surface folded the ribbon back UP 16 cm at hero-creek's
          //foot — a dark crack with a white lip standing off the fall (round 10).
          //Back off to where the path actually crossed the surface. A jet flying into a rising
          //far bank is metres under the ground at the end of the step; snapping it up to the
          //ground THERE lifted the row to the top of the wall (a spike in the sheet).
          let t0 = 0.0, t1 = 1.0, gT = g2;
          for(let it = 0; it < 8; ++it){
            const tm = 0.5 * (t0 + t1);
            const mx = ox + (px - ox) * tm, mz = oz + (pz - oz) * tm, my = oy + (py - oy) * tm;
            const gm = env.groundAt(mx, mz);
            if(gm == null) break;
            if(my <= gm + attachedOffset(env, mx, mz, gm, h)) t1 = tm; else t0 = tm;
          }
          if(t1 < 1.0){
            const nx = ox + (px - ox) * t1, nz = oz + (pz - oz) * t1, gN = env.groundAt(nx, nz);
            if(gN != null){ px = nx; pz = nz; py = oy + (py - oy) * t1; gT = gN; }
          }
          //A WALL, not a ledge: where the path crosses into the ground, the ground stands far above
          //the parcel (a rock face in the fall, a far bank). On a ledge the crossing is at the
          //surface. Landing "on" a wall snapped the parcel up onto its top (a spike in the sheet
          //a whole rock high, once strands met rocks the single parcel never did). The jet
          //loses its speed into the face (an impact: spray) and falls on down it, still airborne:
          //the skirt folds round the rock.
          const bx = ox + (px - ox) * t0, bz = oz + (pz - oz) * t0, bY = oy + (py - oy) * t0;
          const gB = env.groundAt(bx, bz);
          //(Only from a point that is still in the air: a parcel already under the surface where
          //the step began is embedded, and "bouncing" it back there each step kept one falling
          //through the ground for the whole 60 s budget on falls-lab D.)
          if(gT + attachedOffset(env, px, pz, gT, h) - py > opt(o, 'wallJump')
             && gB != null && bY >= gB + attachedOffset(env, bx, bz, gB, h) - 1e-3){
            const e = 0.5;
            const gl = env.groundAt(px - e, pz), gr = env.groundAt(px + e, pz);
            const gd = env.groundAt(px, pz - e), gu = env.groundAt(px, pz + e);
            let dx = (gl != null && gr != null) ? gl - gr : 0.0, dz = (gd != null && gu != null) ? gd - gu : 0.0;
            const dl = Math.hypot(dx, dz);
            if(dl > 1e-6){ dx /= dl; dz /= dl; } else { const vl = Math.hypot(vx, vz) || 1.0; dx = -vx / vl; dz = -vz / vl; }
            const vIn = vx * dx + vz * dz;
            if(vIn < 0.0){
              const iw = smoothstep(opt(o, 'hopDropLo'), opt(o, 'hopDropHi'), takeoffY - py);
              if(-vIn >= minImpact && iw > 0.0){
                impacts.push({x: px, y: py, z: pz, vx: vx, vy: vy, vz: vz, nx: dx, ny: 0.0, nz: dz, vn: -vIn, level: py, w: iw});
              }
              A += -vIn / opt(o, 'impactAerationSpeed');
              vx -= vIn * dx; vz -= vIn * dz;
            }
            px = bx; py = bY; pz = bz;
            A += Math.max(oy - py, 0.0) / Lb;
            everAirborneOrSteep = true;
            tau += dt;
            path += Math.hypot(px - ox, py - oy, pz - oz);
            pushSample();
            continue;
          }
          const pl = Math.sqrt(vx * vx + vz * vz) || 1.0;
          if(!groundNormalUpwind(env, px, pz, vx / pl, vz / pl, 0.5, nrm)){ stop = 'unloaded'; break; }
          const vn = vx * nrm[0] + vy * nrm[1] + vz * nrm[2];
          if(vn < 0.0){
            //An impact is a spray and foam SOURCE with the fall's whole discharge, so it is
            //weighted like a fall's presence: by how far the water dropped since it left the
            //ground. The 5-10 cm hops over a supercritical run-out land at 1-2 m/s and, unweighted,
            //each was a full plunge: they crowded the real one out of the foam's nearest-16 and
            //filled the particle pool with mist.
            const surf = gT + attachedOffset(env, px, pz, gT, h);
            const iw = smoothstep(opt(o, 'hopDropLo'), opt(o, 'hopDropHi'), takeoffY - surf);
            if(-vn >= minImpact && iw > 0.0){
              impacts.push({x: px, y: surf, z: pz, vx: vx, vy: vy, vz: vz, nx: nrm[0], ny: nrm[1], nz: nrm[2], vn: -vn, level: surf, w: iw});
            }
            A += -vn / opt(o, 'impactAerationSpeed');
            vx -= vn * nrm[0]; vy -= vn * nrm[1]; vz -= vn * nrm[2];
          }
          py = gT + attachedOffset(env, px, pz, gT, h);
          airborne = false;
          rise = 0.0;
        }
        A += Math.max(oy - py, 0.0) / Lb;
        everAirborneOrSteep = true;
      }
      else {
        const pl = Math.sqrt(vx * vx + vz * vz);
        const dxp = pl > 1e-4 ? vx / pl : hx, dzp = pl > 1e-4 ? vz / pl : hz;
        if(!groundNormalUpwind(env, px, pz, dxp, dzp, 0.5, nrm)){ stop = 'unloaded'; break; }
        //Gravity on the tangent plane.
        const gn = -G * nrm[1];
        let ax = -gn * nrm[0], ay = -G - gn * nrm[1], az = -gn * nrm[2];
        //Implicit Manning: |a_f| = g n² |v|² / h^(4/3), h = q/|v|.
        //...times the SUPPORT, cos of the bed slope (nrm.y). FUDGE: Manning's law is for channel flow
        //pressed to its bed; water pouring down a near-vertical face barely touches it, and at full
        //friction a strand on one braked to a crawl beside its free-falling neighbours, fell out of
        //step with them and tore the curtain (falls-lab D, 2026-09-23). No change on gentle ground.
        const fr = G * nM * nM * s / Math.pow(h, 4.0 / 3.0) * Math.max(nrm[1], 0.0);
        vx = (vx + ax * dt) / (1.0 + fr * dt);
        vy = (vy + ay * dt) / (1.0 + fr * dt);
        vz = (vz + az * dt) / (1.0 + fr * dt);
        //Does the BED fall away faster than a free parabola over this step? Then this
        //is a lip. Measured on the bed, not the water surface: a deep creek draws its
        //surface down toward a brink, and testing the surface launched parcels out of
        //their own creek (and straight back into it as a "plunge") upstream of the lip.
        const bx = px + vx * dt, bz = pz + vz * dt, by = py + vy * dt - 0.5 * G * dt * dt;
        const gb = env.groundAt(bx, bz), gHere = env.groundAt(px, pz);
        if(gb == null || gHere == null){ stop = 'unloaded'; break; }
        //Sliding into a FACE (the ground ahead a wall above the bed here): water runs up against
        //a rock, it does not climb it in one step. Stepped onto its top, the path's rows ran
        //straight up through the rock before the climb test could stop the parcel. It loses the
        //speed INTO the face and slides on along it (a strand at a creek's edge beside a bank);
        //head-on, that is all its speed and it stops.
        if(gb - gHere > opt(o, 'wallJump') + 2.0 * s * dt){
          const e = 0.5;
          const gl = env.groundAt(px - e, pz), gr = env.groundAt(px + e, pz);
          const gd = env.groundAt(px, pz - e), gu = env.groundAt(px, pz + e);
          let dx = (gl != null && gr != null) ? gl - gr : 0.0, dz = (gd != null && gu != null) ? gd - gu : 0.0;
          const dl = Math.hypot(dx, dz);
          const vIn = dl > 1e-6 ? (vx * dx + vz * dz) / dl : 0.0;
          if(!(vIn < 0.0)){ stop = 'wall'; break; }
          dx /= dl; dz /= dl;
          vx -= vIn * dx; vz -= vIn * dz; vy = 0.0;
          //What is left runs along the face; none left (or a face that way too, a corner): stop.
          if(Math.hypot(vx, vz) < 0.05){ tau += dt; pushSample(); stop = 'wall'; break; }
          const sx = px + vx * dt, sz = pz + vz * dt, gs = env.groundAt(sx, sz);
          if(gs == null){ stop = 'unloaded'; break; }
          if(gs - gHere > opt(o, 'wallJump') + 2.0 * s * dt){ tau += dt; pushSample(); stop = 'wall'; break; }
          px = sx; pz = sz; py = gs + attachedOffset(env, sx, sz, gs, h);
          tau += dt;
          path += Math.hypot(px - ox, py - oy, pz - oz);
          pushSample();
          continue;
        }
        const offB = attachedOffset(env, bx, bz, gb, h);
        if((gHere - gb) > (py - by) + detach){
          airborne = true;
          takeoffY = py;
          const plx = Math.sqrt(vx * vx + vz * vz);
          const lux = plx > 1e-6 ? vx / plx : hx, luz = plx > 1e-6 ? vz / plx : hz;
          const lip = N.wetSpan(env, px, pz, -luz, lux, 3.0 * W, opt(o, 'wetScanStep'), opt(o, 'wetMinDepth'));
          if(lip) lipSpan = Math.max(lipSpan, lip.width + 2.0 * Math.abs(lip.offset));
          vy -= G * dt;
          px = bx; py = by; pz = bz;
          //Airborne from here: nothing below belongs to this step. The attached checks that
          //follow read the bed across the lip as a steep chute and could take a pool texel
          //overhanging the cliff foot for a sliding plunge — skipping the whole free fall.
          //The gentle run restarts here (those checks used to reset it by reading the lip
          //as steep): carried over the fall, the creek above the lip counted toward
          //'settled' and the trace stopped a metre past the landing, cutting the tail short.
          gentleRun = 0.0;
          tau += dt;
          path += Math.hypot(px - ox, py - oy, pz - oz);
          pushSample();
          continue;
        }
        else {
          px = bx; pz = bz; py = gb + offB;
          if(groundNormalUpwind(env, px, pz, dxp, dzp, 0.5, nrm)){
            const vn = vx * nrm[0] + vy * nrm[1] + vz * nrm[2];
            vx -= vn * nrm[0]; vy -= vn * nrm[1]; vz -= vn * nrm[2];
          }
        }
        //Bed slope, not the parcel's: the parcel rides the water surface, and a creek's
        //surface drawing down toward a brink is not a chute.
        const dPlan = Math.hypot(px - ox, pz - oz);
        const slope = dPlan > 1e-6 ? (gHere - gb) / dPlan : 0.0;
        if(slope > steep){ A += dPlan / opt(o, 'chuteAerationLength'); everAirborneOrSteep = true; }
        else A -= A * Math.min(dPlan / opt(o, 'aerationDecayLength'), 1.0);
        gentleRun = (slope < gentle) ? gentleRun + dPlan : 0.0;
        bedSlope = slope;
        let sNow = Math.sqrt(vx * vx + vy * vy + vz * vz);
        //Before its first fall the parcel is the creek arriving at a brink, and water goes
        //over a brink at no less than critical speed: however the approach reads (a still
        //pool the carve levelled behind the lip, a 0.5 m sill, a hollow), it is carrying
        //the discharge to the edge. Braked by friction there, the parcel stopped short and
        //the fall drew nothing (falls-lab A and E after the carve, 2026-09-23).
        //"Before its first fall" = still within half a metre of where it started: a hop over a
        //sill's crest is airborne too, and gating on that let the landings bleed it to a stop.
        //Only over the stretch where the lip should be (start distance + 4 m): a parcel that has
        //not found it by then is wandering a pond, and held at speed it ran the whole budget.
        //Forward only: a parcel sent back upstream (off a rock it landed on) is not the creek
        //arriving at its brink, and held at speed it ran off the back of the rock.
        if(py > startY - 0.5 && path < upUsed + 4.0 && sNow < vc && sNow > 1e-6 && vx * hx + vz * hz > 0.0){
          const k = vc / sNow; vx *= k; vy *= k; vz *= k; sNow = vc;
        }
        if(sNow < 0.05) { tau += dt; pushSample(); stop = 'stopped'; break; }
        //Water does not slosh up the far side of a hollow and back like a ball in a bowl:
        //it fills it. A parcel that RISES more than climbStop in one continuous climb, or
        //makes under stallDistance of plan progress in stallTime, has reached a pond (on
        //island-sholes one rolled round a carve hollow for the whole 60 s budget: 71k
        //vertices of sheet). Measured as the integral of upward velocity, not as height:
        //the parcel's height includes its thickness (which grows as it slows), and the bed
        //under a parcel sliding down a near-vertical face jumps by tens of centimetres for
        //a few centimetres of sideways jitter. Both read as climbing; neither is.
        rise = vy > 0.0 ? rise + vy * dt : 0.0;
        //(A creek still on its way to the lip may climb a sill a carve left; only a parcel
        //that has fallen is filling a pond when it climbs.)
        if(rise > opt(o, 'climbStop') * (py > startY - 0.5 ? 3.0 : 1.0)) { tau += dt; pushSample(); stop = 'climb'; break; }
        //Slid into a pool (a chute, or the lower half of a cliff ramp, running into
        //deep water): that is a plunge too. Without this the parcel rode the pool's
        //surface, since attachedOffset lifts it by the water depth, and skated across.
        //Gated on having come down something, so the deep creek above a lip is not a pool.
        const w = waterHere(env, px, pz);
        if(everAirborneOrSteep && isPool(w, o)){
          const level = gb + w.depth;
          //Only the first plunge is THE plunge: a jet that dove into a pool and was carried back
          //out over its shallow edge (the airborne branch's touchdown) is still that pool's water.
          if(!plunge){
            plunge = {x: px, y: level, z: pz, vx: vx, vy: vy, vz: vz, nx: 0, ny: 1, nz: 0,
                      vn: Math.max(-vy, 0.0), level: level, w: 1.0};
            impacts.push(plunge);
          }
          tau += dt; path += Math.hypot(px - ox, pz - oz);
          py = level - plungeDepth;
          pushSample();
          //The dive under the surface is not a chute: resample() must not read its drop
          //as path slope (it drew a patch of sheet over the run-out).
          samples[samples.length - 1].dive = 1.0;
          stop = 'plunge'; break;
        }
      }
      tau += dt;
      path += Math.hypot(px - ox, py - oy, pz - oz);
      //A strand that has not met its fall within lipSearch metres of its seed never will: it is
      //circling a pool beside the lip (falls-lab B, a whole 60 s budget at 1 m/s round a tread's
      //pool, too fast for the stall test). It would draw nothing and cost the frame.
      if(!everAirborneOrSteep && path > upUsed + opt(o, 'lipSearch')){ stop = 'nolip'; break; }
      if(tau - stallT0 >= stallTime){
        if(Math.hypot(px - stallX, pz - stallZ) < stallDist){ stop = 'stall'; break; }
        stallT0 = tau; stallX = px; stallZ = pz;
      }
      if(!passed && ((px - last.bottom[0]) * lx + (pz - last.bottom[2]) * lz) > -0.5) passed = true;
      pushSample();
      if(passed && !airborne && everAirborneOrSteep && gentleRun >= opt(o, 'settleRun')){ stop = 'settled'; break; }
    }

    const strand = {q: q, hc: hc, vc: vc, Lb: Lb, share: seed.share, samples: samples, impacts: impacts,
                    plunge: plunge, stop: stop, lipSpan: lipSpan, rows: []};
    N.prepareStrand(strand, o);
    return strand;
  };

  //The chain's result from its strands: the skirt, the spine (the middle strand that falls),
  //the corridors and the impacts.
  function finishTrace(job){
    const o = job.o, S = job.strands, nS = S.length, c = job.nHalf;
    const falls = function(st){ return !!st && !!st.takeoff; };
    const ends = function(st){ return falls(st) && (st.stop === 'plunge' || st.stop === 'settled'); };
    //The spine: the strand nearest the middle that falls and comes to rest the way a fall does
    //(a rock can stand in the middle of a lip, or in the fall, and the water that hits it dies in
    //the slot at its foot: the corridors would stop there), else the nearest that falls at all,
    //else the nearest that was traced.
    let spine = -1;
    const pick = function(ok){
      for(let d = 0; d <= c && spine < 0; ++d){
        if(ok(S[c - d])) spine = c - d;
        else if(ok(S[c + d])) spine = c + d;
      }
    };
    pick(ends);
    pick(falls);
    pick(function(st){ return !!st; });
    if(spine < 0) return null;
    const sp = S[spine];
    //A strand that goes over the brink without a real takeoff (slides down the step, or only hops)
    //is past the brink too, beyond the line through the spine's takeoff square to its heading: its
    //steep rows there are drawn as the creek's complement (resample). The corridor steps the creek
    //aside round the spine's whole path, and those strands drew nothing: six of falls-lab B's top
    //step, whose water just vanished there (Dante's "river fades in and out", 2026-09-23).
    if(sp.takeoff){
      const P = sp.samples[sp.takeoff.i];
      for(let j = 0; j < nS; ++j){
        const st = S[j];
        if(!st || st.takeoff) continue;
        let any = false;
        for(const q of st.samples){ q.after = ((q.x - P.x) * job.hx + (q.z - P.z) * job.hz) > 0.0 ? 1.0 : 0.0; any = any || q.after > 0.5; }
        st.draws = any;
      }
    }
    const grid = N.timeGrid(S, sp.takeoff ? sp.takeoff.tau : 0.0, o);
    for(let j = 0; j < nS; ++j) if(S[j]) N.resample(S[j], o, grid);
    let Q = 0.0, lipSpan = 0.0;
    for(let j = 0; j < nS; ++j){
      if(!S[j]) continue;
      Q += S[j].q * S[j].share;
      lipSpan = Math.max(lipSpan, S[j].lipSpan);
    }
    //How far the skirt reaches from the spine, across every drawn row: the corridors' radius.
    let reach = 0.0;
    const spineAt = rowIndexer(sp);
    for(let j = 0; j < nS; ++j){
      if(!S[j]) continue;
      const rows = S[j].rows;
      for(let i = 0; i < rows.length; ++i){
        if(rows[i].presence < 0.01) continue;
        const b = spineAt(rows[i].k);
        if(b) reach = Math.max(reach, Math.hypot(rows[i].x - b.x, rows[i].z - b.z));
      }
    }
    const nappe = {q: sp.q, hc: sp.hc, vc: sp.vc, Lb: sp.Lb, width: job.W, discharge: Q, chain: job.chain,
                   samples: sp.samples, impacts: [], plunge: sp.plunge, stop: sp.stop, lipSpan: lipSpan,
                   rows: sp.rows, corridors: [], strands: S, spine: spine, spacing: job.spacing,
                   halfWidth: c > 0 ? c * job.spacing : 0.5 * job.span, reach: reach,
                   hx: job.hx, hz: job.hz};
    nappe.impacts = clusterImpacts(nappe, o);
    N.buildCorridors(nappe, o);
    return nappe;
  }

  //rows[] of a strand by its global row index k (see resample): a lookup, null outside.
  function rowIndexer(st){
    const rows = st ? st.rows : null;
    if(!rows || !rows.length) return function(){ return null; };
    const k0 = rows[0].k;
    return function(k){ const i = k - k0; return (i >= 0 && i < rows.length) ? rows[i] : null; };
  }

  //Every strand logs its own touchdowns: the foot of the fall as a LINE of impacts across its
  //width, not one point in the middle. The spray and the foot foam key off the impacts (and the
  //foam keeps its nearest 16), so neighbouring strands' impacts on the same surface merge into
  //clusters up to impactClusterWidth wide, each carrying its strands' share of the discharge
  //and its own width. Weighted by discharge: a thin edge strand counts for less.
  function clusterImpacts(nappe, o){
    const S = nappe.strands, size = opt(o, 'impactClusterWidth');
    const ax = -nappe.hz, az = nappe.hx;
    const out = [];
    for(let j = 0; j < S.length; ++j){
      const st = S[j];
      if(!st) continue;
      const dis = st.q * st.share;
      for(let i = 0; i < st.impacts.length; ++i){
        const im = st.impacts[i], isPlunge = im === st.plunge;
        const along = im.x * ax + im.z * az;
        let best = null, bd = size;
        for(let m = 0; m < out.length; ++m){
          const cl = out[m];
          if(cl.plunge !== isPlunge || cl.lastJ < j - 1 || cl.lastJ === j) continue;
          const d = Math.hypot(im.x - cl.x0, im.z - cl.z0);
          if(d < bd && Math.abs(im.y - cl.y0) < 1.0){ best = cl; bd = d; }
        }
        if(!best){
          best = {plunge: isPlunge, lastJ: -1, x0: im.x, y0: im.y, z0: im.z, sum: 0.0, lo: along, hi: along,
                  acc: {x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, nx: 0, ny: 0, nz: 0, vn: 0, level: 0, w: 0}};
          out.push(best);
        }
        best.lastJ = j;
        best.sum += dis;
        best.lo = Math.min(best.lo, along); best.hi = Math.max(best.hi, along);
        for(const key in best.acc) best.acc[key] += dis * im[key];
      }
    }
    return out.map(function(cl){
      const s = cl.sum > 0.0 ? cl.sum : 1.0, a = cl.acc;
      const nl = Math.hypot(a.nx, a.ny, a.nz) || 1.0;
      return {x: a.x / s, y: a.y / s, z: a.z / s, vx: a.vx / s, vy: a.vy / s, vz: a.vz / s,
              nx: a.nx / nl, ny: a.ny / nl, nz: a.nz / nl, vn: a.vn / s, level: a.level / s, w: a.w / s,
              width: nappe.spacing > 0.0 ? Math.max(cl.hi - cl.lo + nappe.spacing, opt(o, 'minWidth')) : nappe.width,
              discharge: cl.sum};
    });
  }

  //Per-strand bookkeeping, once traced: each sample's fall weight (fallW), path length (s)
  //and time since its latest takeoff (tf), and the strand's first REAL takeoff (a fall, not
  //a hop): strand.takeoff = {i, tau}, or null for a strand that never falls (it draws nothing).
  N.prepareStrand = function(strand, o){
    const S = strand.samples;
    strand.takeoff = null;
    if(S.length < 2) return;
    //Each airborne stretch counts as a fall only in proportion to the height it falls: a
    //parcel skipping over a supercritical run-out makes 5-10 cm hops (hero-creek, below the
    //fall), and drawing those as sheet laid pale patches over the banks.
    const lo = opt(o, 'hopDropLo'), hi = opt(o, 'hopDropHi');
    for(let i = 0; i < S.length;){
      if(!S[i].air){ S[i].fallW = 0.0; ++i; continue; }
      let j = i;
      while(j < S.length && S[j].air) ++j;
      const y0 = S[Math.max(i - 1, 0)].y, y1 = S[Math.min(j, S.length - 1)].y;
      const w = smoothstep(lo, hi, y0 - y1);
      for(let k = i; k < j; ++k) S[k].fallW = w;
      i = j;
    }
    //tf: seconds since the latest takeoff, for the vertex stage's wind sway (a jet bows by
    //½·a·t² from where it left the ground, not from the top of the cascade).
    let tOff = 0.0;
    S[0].s = 0.0;
    for(let i = 0; i < S.length; ++i){
      if(i > 0) S[i].s = S[i - 1].s + Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y, S[i].z - S[i - 1].z);
      if(S[i].air && !(i > 0 && S[i - 1].air)) tOff = S[Math.max(i - 1, 0)].tau;
      S[i].tf = S[i].air ? S[i].tau - tOff : 0.0;
    }
    for(let i = 1; i < S.length; ++i) if(S[i].air && S[i].fallW > 0.5){ strand.takeoff = {i: i - 1, tau: S[i - 1].tau}; break; }
    //after: past the strand's first real takeoff (resample: steep water after a fall is the fall's).
    for(let i = 0; i < S.length; ++i) S[i].after = (strand.takeoff && i > strand.takeoff.i) ? 1.0 : 0.0;
  };

  //The index of the last sample at or before time t (samples are one integration step apart).
  function sampleAt(S, t){
    const dt = S.length > 1 ? (S[S.length - 1].tau - S[0].tau) / (S.length - 1) : 1.0;
    let i = Math.min(Math.max(Math.floor(t / Math.max(dt, 1e-6)), 0), S.length - 2);
    while(i > 0 && S[i].tau > t) --i;
    while(i < S.length - 2 && S[i + 1].tau <= t) ++i;
    return i;
  }

  //THE ROWS ARE MATERIAL TIME. Row k of every strand is where its water is at the same moment
  //t_k: a line of water released together, which is what a sheet is, and what its grain rides.
  //Aligned at each strand's own takeoff instead (rows k·rowSpacing past its own lip), a strand
  //leaving from the top of a lip's 1 m bilinear ramp and its neighbour sliding half way down it
  //first sat a metre apart in every row after, and the weave tore C's curtain into ribbons.
  //k = 0 is the spine's takeoff, t0. The step between rows is the time the FASTEST drawn strand
  //takes to cover rowSpacing, so no strand's rows are farther apart than that.
  N.timeGrid = function(strands, t0, o){
    const ds = opt(o, 'rowSpacing');
    const live = strands.filter(function(st){ return st && (st.takeoff || st.draws); });
    let tEnd = t0;
    for(let j = 0; j < live.length; ++j) tEnd = Math.max(tEnd, live[j].samples[live[j].samples.length - 1].tau);
    const vmax = function(t){
      let v = 0.25;
      for(let j = 0; j < live.length; ++j){
        const S = live[j].samples;
        if(t < S[0].tau || t > S[S.length - 1].tau) continue;
        v = Math.max(v, S[sampleAt(S, t)].speed);
      }
      return v;
    };
    const grid = [{k: 0, t: t0}];
    for(let t = t0, k = 0; t < tEnd; ){ t = Math.min(t + ds / vmax(t), tEnd); grid.push({k: ++k, t: t}); }
    for(let t = t0, k = 0; t > 0.0; ){ t = Math.max(t - ds / vmax(t), 0.0); grid.unshift({k: --k, t: t}); }
    grid.t0 = t0;
    return grid;
  };

  //One strand's samples as rows on the chain's time grid (timeGrid), with presence, trimmed to
  //where the sheet shows. tau is measured from the spine's takeoff, the same for every strand,
  //so the grain the material carries at (across, τ − t) is one piece across the sheet. A strand
  //that never really falls draws nothing (no rows).
  N.resample = function(nappe, o, grid){
    const S = nappe.samples;
    nappe.rows = [];
    if(S.length < 2) return;
    if(!nappe.takeoff && !nappe.draws) return;
    if(!grid) grid = N.timeGrid([nappe], nappe.takeoff ? nappe.takeoff.tau : 0.0, o);
    const tMin = S[0].tau, tMax = S[S.length - 1].tau;
    const rows = [];
    const keys = ['x', 'y', 'z', 'tau', 'speed', 'h', 'air', 'aer', 'hx', 'hz', 'fallW', 'dive', 'tf', 's', 'bed', 'after'];
    for(let g = 0; g < grid.length; ++g){
      const t = grid[g].t;
      if(t < tMin - 1e-9 || t > tMax + 1e-9) continue;
      const j = sampleAt(S, t);
      const seg = S[j + 1].tau - S[j].tau;
      const f = seg > 1e-9 ? Math.min(Math.max((t - S[j].tau) / seg, 0.0), 1.0) : 0.0;
      const r = {k: grid[g].k};
      for(let m = 0; m < keys.length; ++m) r[keys[m]] = S[j][keys[m]] + (S[j + 1][keys[m]] - S[j][keys[m]]) * f;
      r.tau -= grid.t0;
      const hl = Math.hypot(r.hx, r.hz);
      if(hl > 1e-6){ r.hx /= hl; r.hz /= hl; } else { r.hx = 0.0; r.hz = 1.0; }
      rows.push(r);
    }
    //Presence: the FREE FALL only — airborne stretches, by how far they fall (above).
    //Everything attached (the approach, ramps, chutes, the run into the pool) is the
    //creek's heightfield surface, which follows the ground and has the creek's true width
    //and look; a heightfield only fails where the water leaves the ground. Round 3 also
    //drew the steep attached stretches, and in the browser that gave a clear-film sheet
    //that read as bare ground where the creek stepped aside (the film is a thin alpha
    //layer, the creek an opaque refracting surface), a flat white slab on the landing ramp,
    //and draped edges climbing the banks into the air (Dante, hero-creek-sky, 2026-09-21).
    const raw = new Array(rows.length);
    for(let i = 0; i < rows.length; ++i) raw[i] = rows[i].air * rows[i].fallW;
    //AMENDED 2026-09-23 (Dante): water SLIDING down a face (bed steeper than faceSlope, 55°) after
    //the strand's first fall is still falling. A heightfield cannot draw water on a face, and a
    //strand that touched a cliff's bilinear ramp went "attached" there and drew nothing: holes
    //down the middle of a curtain (falls-lab D). Only after a fall: a creek's own steep bed
    //upstream of its lip stays the creek's.
    const face = opt(o, 'faceSlope'), gentleS = opt(o, 'gentleSlope');
    for(let i = 0; i < rows.length; ++i){
      if(rows[i].after > 0.5 && rows[i].air < 0.5 && rows[i].bed > face) raw[i] = 1.0;
    }
    //...plus brinkLead metres before each real takeoff and landTail metres after each
    //landing, FULLY present. On both sides of a fall the creek's heightfield drops a strip:
    //at the brink its level sinks toward the ramp while the rendered cliff-top edge is still
    //under it (Phase 4's thin-water fade discards < 3 cm; seen with the sheet off and the
    //terrain hidden), and below it the level still runs steeply down the ramp to the pool.
    //These rows sit just above the creek's own level (the vertex stage lifts them onto it)
    //and the material draws them as the COMPLEMENT of the creek's visibility at each pixel,
    //so they fill its holes and fade out wherever it draws. (Round 5 handed over by depth
    //alone; round 7 found the creek writes depth even where it has faded out.)
    const lead = opt(o, 'brinkLead'), tail = opt(o, 'landTail');
    const fall = raw.slice();
    for(let i = 1; i < rows.length; ++i){
      if(fall[i] > 0.5 && fall[i - 1] <= 0.5){
        for(let k = i - 1; k >= 0 && rows[i].s - rows[k].s < lead; --k) raw[k] = 1.0;
      }
      if(fall[i] <= 0.5 && fall[i - 1] > 0.5){
        for(let k = i; k < rows.length && rows[k].s - rows[i - 1].s < tail; ++k) raw[k] = 1.0;
      }
    }
    //Steep attached water after a fall (a chute between steps, the ramp between ledges) is present
    //too, but only as the creek's COMPLEMENT (fall flag 0: the material draws it where the creek
    //does not). Inside a fall's corridor the creek steps aside wherever its level is steep, and
    //there neither drew: the river "fading in and out" down falls-lab B and D's jagged steps.
    for(let i = 0; i < rows.length; ++i){
      if(rows[i].after > 0.5 && rows[i].air < 0.5 && rows[i].bed > gentleS) raw[i] = 1.0;
    }
    //A sliding plunge's dive inherits the presence of the row before it.
    for(let i = 1; i < rows.length; ++i) if(rows[i].dive > 0.0) raw[i] = raw[i - 1];
    //Plain box, narrow: it only softens the lip and the landing. It used to be a
    //max-then-box over ±3 rows, which gave the flat rows before a lip presence 0.57 and
    //laid a bright strip of sheet over the creek there (hero-creek, 2026-09-21).
    const R = opt(o, 'presenceSmoothRows');
    for(let i = 0; i < rows.length; ++i){
      let sum = 0.0, cnt = 0;
      for(let k = -R; k <= R; ++k){ sum += raw[Math.min(Math.max(i + k, 0), rows.length - 1)]; ++cnt; }
      rows[i].presence = sum / cnt;
    }
    //Two per-row weights for the vertex/fragment stages:
    //  fall  the free-fall flag (airborne by drop), per row — air in the water, the lift onto
    //        the creek and the hand-off follow it exactly. Round 8 smoothed this over ±0.5 m,
    //        and the smoothing leaked past every landing: flat post-impact rows carrying
    //        bubbles made a white slab lying on the water (round 10).
    //  lump  the LUMP weight: 1 inside a fall, ramping to 0 over fallSmooth metres INSIDE it at
    //        both ends, 0 elsewhere. Full lumps switching off within one row sheared that row
    //        of triangles by 30 cm (the bent strips of round 8); ramping them inside the fall
    //        cannot leak onto the attached rows.
    const fsm = opt(o, 'fallSmooth');
    for(let i = 0; i < rows.length; ++i){ rows[i].fallFlag = fall[i]; rows[i].lumpW = 0.0; }
    for(let i = 0; i < rows.length;){
      if(fall[i] <= 0.5){ ++i; continue; }
      let j = i;
      while(j < rows.length && fall[j] > 0.5) ++j;
      const s0 = rows[i].s, s1 = rows[j - 1].s;
      for(let k = i; k < j; ++k){
        const e = Math.min(rows[k].s - s0, s1 - rows[k].s);
        rows[k].lumpW = fall[k] * smoothstep(0.0, fsm, e);
      }
      i = j;
    }
    //Tangent frames. Across is horizontal, perpendicular to the plan heading of the
    //water there; the normal faces up-and-downstream.
    for(let i = 0; i < rows.length; ++i){
      const a = rows[Math.max(i - 1, 0)], b = rows[Math.min(i + 1, rows.length - 1)];
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const tl = Math.hypot(tx, ty, tz);
      //Coincident neighbours (a stalled end): along the plan heading, never a zero frame
      //(the vertex stage normalizes it).
      if(tl > 1e-6){ tx /= tl; ty /= tl; tz /= tl; } else { tx = rows[i].hx; ty = 0.0; tz = rows[i].hz; }
      const axx = -rows[i].hz, axz = rows[i].hx;
      //n = t × across (across has no y)
      let nx = ty * axz, ny = tz * axx - tx * axz, nz = -ty * axx;
      if(nx * rows[i].hx + ny + nz * rows[i].hz < 0.0){ nx = -nx; ny = -ny; nz = -nz; }
      let nl = Math.hypot(nx, ny, nz);
      if(!(nl > 1e-6)){ nx = 0.0; ny = 1.0; nz = 0.0; nl = 1.0; }
      rows[i].tx = tx; rows[i].ty = ty; rows[i].tz = tz;
      rows[i].ax = axx; rows[i].az = axz;
      rows[i].nx = nx / nl; rows[i].ny = ny / nl; rows[i].nz = nz / nl;
    }
    //Trim the gentle lead-in and run-out, keeping two rows of zero presence each side
    //so the fade has somewhere to finish.
    let i0 = 0, i1 = rows.length - 1;
    while(i0 < rows.length && rows[i0].presence < 0.01) ++i0;
    while(i1 > i0 && rows[i1].presence < 0.01) --i1;
    if(i0 >= rows.length){ nappe.rows = []; return; }
    nappe.rows = rows.slice(Math.max(i0 - 2, 0), Math.min(i1 + 3, rows.length));
  };

  //Corridor boxes (flat-ended) over the rows where the sheet draws: {ax, az, bx, bz, r}. The
  //flowing-water material fades its own surface out inside them (on steep level only).
  N.buildCorridors = function(nappe, o){
    //the chain's carved sites (a-land 0.2.0), for the lead box of each later lip
    const sites = (nappe.chain || []).map(N.siteOf).filter(Boolean);
    const siteNear = function(x, z){
      let best = null, bestD = Infinity;
      for(const t of sites){
        const cx = 0.5 * (t.lip[0][0] + t.lip[1][0]), cz = 0.5 * (t.lip[0][2] + t.lip[1][2]);
        const d = Math.hypot(x - cx, z - cz);
        if(d < bestD && d <= 0.5 * t.wetWidth + 4.0){ bestD = d; best = t; }
      }
      return best;
    };
    const rows = nappe.rows, len = opt(o, 'corridorLength'), leadLen = opt(o, 'corridorLead');
    //Wide enough for the whole skirt as it strays from the spine (reach), and for the creek's wet
    //span at the lip. LIMIT: boxes run down the SPINE only; a strongly curved (horseshoe) lip
    //may need boxes along its edge strands too, not built until a world shows one.
    const r = Math.max(0.5 * Math.max(nappe.width, nappe.lipSpan || 0.0), (nappe.reach || 0.0) + 0.5 * (nappe.spacing || 0.0)) + opt(o, 'corridorMargin');
    //...per BOX, from the skirt's reach over that box's own rows. One radius for the whole fall (its
    //widest reach, plus the lip span) stepped the creek aside metres beside a skirt that had since
    //narrowed to a line (its strands all slide into one groove on a long ramp), and there neither
    //surface drew: the river fading in and out down falls-lab B's steps (2026-09-23). With the
    //skirt's strands (not the old single-parcel nappe) each box is as wide as the sheet it covers.
    const S = nappe.strands, spacing = nappe.spacing || 0.0, margin = opt(o, 'corridorMargin');
    const atS = S ? S.map(rowIndexer) : null, k0Spine = rows.length ? rows[0].k : 0;
    const boxR = function(ka, kb){
      if(!atS) return r;
      let m = 0.0;
      for(let k = Math.min(ka, kb); k <= Math.max(ka, kb); ++k){
        const b = rows[k - k0Spine];
        if(!b) continue;
        for(let j = 0; j < atS.length; ++j){
          const a = atS[j](k);
          if(a && a.presence >= 0.01) m = Math.max(m, Math.hypot(a.x - b.x, a.z - b.z));
        }
      }
      return Math.max(m + 0.5 * spacing, 0.5 * opt(o, 'minWidth')) + margin;
    };
    const caps = [];
    const isFall = function(row){ return (row.fallFlag !== undefined ? row.fallFlag : row.presence) > 0.5; };
    let i = 0;
    while(i < rows.length){
      if(!isFall(rows[i])){ ++i; continue; }
      //A free-fall run [i, j). Its FIRST box starts leadLen metres upstream of the takeoff and
      //carries that length as `lead`: across it the creek fades out by distance while the sheet
      //fades in (the cross-dissolve, water-shader.glsl fallCorridorWeights). Only the free fall
      //is covered: past the landing the creek keeps its foamy surface (round 10).
      let j = i;
      while(j < rows.length && isFall(rows[j])) ++j;
      let k = i;
      while(k > 0 && rows[i].s - rows[k - 1].s <= leadLen) --k;
      //...and its LAST box runs corridorTail metres past the landing. The creek's level is a
      //1 m heightfield, so it is still ramping down from the brink onto the pool for a metre
      //or so past where the water lands; a box ending AT the landing handed that ramp back to
      //the creek, and the sheet, cutting itself at the creek's level there (the ramp, 0.7 m
      //above the pool at hero-creek), stopped short of the water: a strip of cliff between
      //the fall and the foam (Dante, 2026-09-22). The creek steps aside only where its level
      //is steep, so the flat pool past the ramp keeps its surface inside the box.
      let e = j;
      const tailLen = opt(o, 'corridorTail');
      const lf = rows[j - 1];   //plan metres, not arc length: the arc still holds the last of the drop
      while(e < rows.length && Math.hypot(rows[e].x - lf.x, rows[e].z - lf.z) < tailLen && !isFall(rows[e])) ++e;
      //The LEAD gets a box of its own, square to the lip and ending at the takeoff. Its ramp
      //lines (the creek's fade) run across the box, so a box laid along the chord of the path
      //turned them with the fall's drift: 9° at falls-lab A, a diagonal seam across a straight
      //lip (Dante's first shot, 2026-09-23). Square to the lip = the chain's heading (the lip
      //normal) on the first fall, the water's own plan heading at the takeoff on later ones.
      const lead = rows[i].s - rows[k].s;
      if(lead > 0.05){
        const first = caps.length === 0 && nappe.hx !== undefined;
        //A carved staircase knows every lip's normal: the step's own site, nearest this takeoff.
        const st = first ? null : siteNear(rows[i].x, rows[i].z);
        let dx = first ? nappe.hx : (st ? st.normal[0] : rows[i].hx), dz = first ? nappe.hz : (st ? st.normal[1] : rows[i].hz);
        const dl = Math.hypot(dx, dz) || 1.0;
        dx /= dl; dz /= dl;
        caps.push({ax: rows[i].x - dx * lead, az: rows[i].z - dz * lead, bx: rows[i].x, bz: rows[i].z, r: boxR(rows[k].k, rows[i].k), lead: lead});
      }
      let start = rows[i], plan = 0.0, prev = rows[i];
      for(let m = i; m < e; ++m){
        const row = rows[m];
        plan += Math.hypot(row.x - prev.x, row.z - prev.z);
        prev = row;
        if(plan >= len || m === e - 1){
          caps.push({ax: start.x, az: start.z, bx: row.x, bz: row.z, r: boxR(start.k, row.k), lead: 0.0});
          start = row; plan = 0.0;
        }
      }
      i = j;
    }
    nappe.corridors = caps;
  };

  //Weave the strands into one sheet. Vertices are the strands' own rows (the paths the water
  //took); a quad joins strands j and j+1 between rows k and k+1 where both have both rows and
  //the two are still one sheet there. It TEARS where they are not:
  //  - farther apart ACROSS the flow than tearFactor × the seed spacing, or along it by more
  //    than their speed explains (split round a rock, held on a ledge, or landing on
  //    different things), or
  //  - with ground above the midpoint between them (a rock or a rib standing between two
  //    strands that stayed close: the flat quad would pass through it).
  //The across frame at each vertex is the sheet's own (toward its +across neighbour), so a
  //skirt that lands on a slope or bows round a curved lip is lit as it lies.
  //Returns {position, normal, tangent, across, flowA, flowB, lump, index, vertexCount} (typed arrays).
  //  tangent = down the flow, across = toward +across (both unit): the vertex stage's
  //  displacement frame
  //  flowA = (tau from the strand's lip, across −1..1 by SEED, thickness, speed)
  //  flowB = (aeration, presence, free-fall flag, half-width m, so across × it is the seed's
  //          offset from the middle: a material coordinate, the grain rides the water)
  //  lump  = (lump weight, s since the latest takeoff) per vertex, 2 floats
  N.buildRibbon = function(nappe, env, o){
    const S = nappe.strands;
    if(!S || !S.length) return null;
    const nS = S.length, c = (nS - 1) / 2;
    const halfW = Math.max(nappe.halfWidth || 0.0, 1e-3);
    const spacing0 = Math.max(nappe.spacing || 0.0, opt(o, 'strandSpacing'));
    const tearD = opt(o, 'tearFactor') * spacing0;
    const relVelMax = G * opt(o, 'tearTime') + opt(o, 'tearRelSpeed');
    const tol = opt(o, 'tearGroundTolerance');
    const at = S.map(rowIndexer);
    const base = new Array(nS);
    let nV = 0;
    for(let j = 0; j < nS; ++j){ base[j] = nV; nV += S[j] ? S[j].rows.length : 0; }
    if(nV === 0) return null;
    const vid = function(j, k){ const r = at[j](k); return r ? base[j] + (k - S[j].rows[0].k) : -1; };
    //Are strands j and j+1 one sheet at row k?
    const tearT = opt(o, 'tearTime');
    const joined = function(j, k){
      if(j < 0 || j + 1 >= nS) return false;
      const a = at[j](k), b = at[j + 1](k);
      if(!a || !b) return false;
      //Rows are material time (timeGrid), and a material line stretches ALONG the flow as the
      //sheet accelerates: water that reached the lip 0.2 s after its neighbour (a curved brink)
      //is 1.5 m higher at 14 m/s, and that is still one sheet. Apart ACROSS the flow is a tear;
      //along it, only past what speed explains (a strand held on a ledge while its neighbour falls on).
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      let tx = a.tx + b.tx, ty = a.ty + b.ty, tz = a.tz + b.tz;
      const tl = Math.hypot(tx, ty, tz) || 1.0;
      tx /= tl; ty /= tl; tz /= tl;
      const along = dx * tx + dy * ty + dz * tz;
      const across = Math.hypot(dx - along * tx, dy - along * ty, dz - along * tz);
      if(across > tearD) return false;
      //Where one is in the air and the other on the ground, the lag speed explains is the SLOWER
      //one's: a strand held on a ledge (1 m/s) beside one falling on at 5 m/s is not a lagging
      //brink, and on the mean speed it stayed joined 2-4 m along: the shards on falls-lab B's
      //steps (Dante, 2026-09-23). Both flying, the mean (an edge strand slowed by a wall is still
      //the curtain's edge).
      const vLag = (a.air > 0.5) === (b.air > 0.5) ? 0.5 * (a.speed + b.speed) : Math.min(a.speed, b.speed);
      if(Math.abs(along) > tearD + vLag * tearT) return false;
      //...and MOVING APART: two strands of one sheet move alike. A curtain whose edge reached the
      //lip tearTime late differs from its middle by g·tearTime at most (the laggard is that much
      //slower in the same free fall); a strand stopped on a jagged ledge beside one falling on
      //differs by all its speed. Offsets alone could not tell them apart (a clean 18 m plunge
      //carries 2 m of smooth lag between neighbours at its foot), and the second made the fins.
      //Only once they HAVE drifted a strand spacing apart along the flow: at the foot a strand that
      //just landed sits beside one still falling, a hand's width apart, and tearing there cut the
      //curtain's foot into teeth (hero-creek, 2026-09-23).
      const rvx = a.speed * a.tx - b.speed * b.tx, rvy = a.speed * a.ty - b.speed * b.ty, rvz = a.speed * a.tz - b.speed * b.tz;
      if(Math.abs(along) > spacing0 && Math.hypot(rvx, rvy, rvz) > relVelMax) return false;
      //FOLDED: j+1 was seeded on j's +across side; once it has clearly crossed over to the other
      //(strands converging into a slot on a tread) the quad is inside out and lies over its
      //neighbours: the overlapping ribbons. Judged on the offset SQUARE to the flow: a neighbour
      //lagging along it is not a fold, however the two headings lean; and edge strands squeezed
      //together against a wall (falls-lab A's gorge) cross by a few centimetres, a harmless sliver.
      let hax = a.ax + b.ax, haz = a.az + b.az;
      const hal = Math.hypot(hax, haz) || 1.0;
      if(((dx - along * tx) * hax + (dz - along * tz) * haz) / hal < -spacing0) return false;
      //Ground standing between them: above the sheet there AND above the ground under both
      //strands (a rock or a rib between them). Against the mean height alone, a curtain close to
      //a face (every face is a steep ramp on the 1 m bilinear terrain) tore wherever a midpoint
      //fell inside the ramp, though both strands hug the same face.
      const mx = 0.5 * (a.x + b.x), mz = 0.5 * (a.z + b.z);
      const g = env && env.groundAt ? env.groundAt(mx, mz) : null;
      if(g == null) return true;
      const ga = env.groundAt(a.x, a.z), gb = env.groundAt(b.x, b.z);
      const under = (ga != null && gb != null) ? Math.max(ga, gb) : -Infinity;
      return !(g > Math.max(0.5 * (a.y + b.y), under) + tol);
    };
    const position = new Float32Array(nV * 3), normal = new Float32Array(nV * 3);
    const tangent = new Float32Array(nV * 3), acrossDir = new Float32Array(nV * 3);
    const flowA = new Float32Array(nV * 4), flowB = new Float32Array(nV * 4), lump = new Float32Array(nV * 2);
    let v = 0;
    for(let j = 0; j < nS; ++j){
      if(!S[j]) continue;
      const rows = S[j].rows;
      const across = c > 0 ? (j - c) / c : 0.0;
      for(let i = 0; i < rows.length; ++i, ++v){
        const row = rows[i];
        //The sheet's across direction here: to the joined neighbours, else the strand's own
        //horizontal (a lone strand, or a torn edge).
        const L = joined(j - 1, row.k) ? at[j - 1](row.k) : row;
        const R = joined(j, row.k) ? at[j + 1](row.k) : row;
        let ax = R.x - L.x, ay = R.y - L.y, az = R.z - L.z;
        let al = Math.hypot(ax, ay, az);
        if(!(al > 1e-4)){ ax = row.ax; ay = 0.0; az = row.az; al = 1.0; }
        ax /= al; ay /= al; az /= al;
        //n = t × across, turned to the side the strand's own frame faces
        let nx = row.ty * az - row.tz * ay, ny = row.tz * ax - row.tx * az, nz = row.tx * ay - row.ty * ax;
        let nl = Math.hypot(nx, ny, nz);
        if(!(nl > 1e-6)){ nx = row.nx; ny = row.ny; nz = row.nz; nl = 1.0; }
        if(nx * row.nx + ny * row.ny + nz * row.nz < 0.0) nl = -nl;
        position[v * 3] = row.x; position[v * 3 + 1] = row.y; position[v * 3 + 2] = row.z;
        normal[v * 3] = nx / nl; normal[v * 3 + 1] = ny / nl; normal[v * 3 + 2] = nz / nl;
        tangent[v * 3] = row.tx; tangent[v * 3 + 1] = row.ty; tangent[v * 3 + 2] = row.tz;
        acrossDir[v * 3] = ax; acrossDir[v * 3 + 1] = ay; acrossDir[v * 3 + 2] = az;
        flowA[v * 4] = row.tau; flowA[v * 4 + 1] = across; flowA[v * 4 + 2] = row.h; flowA[v * 4 + 3] = row.speed;
        flowB[v * 4] = row.aer; flowB[v * 4 + 1] = row.presence; flowB[v * 4 + 2] = row.fallFlag; flowB[v * 4 + 3] = halfW;
        lump[v * 2] = row.lumpW; lump[v * 2 + 1] = row.tf;
      }
    }
    const idx = [];
    for(let j = 0; j + 1 < nS; ++j){
      if(!S[j] || !S[j + 1] || !S[j].rows.length || !S[j + 1].rows.length) continue;
      const k0 = Math.max(S[j].rows[0].k, S[j + 1].rows[0].k);
      const k1 = Math.min(S[j].rows[S[j].rows.length - 1].k, S[j + 1].rows[S[j + 1].rows.length - 1].k);
      let prevJoined = joined(j, k0);
      for(let k = k0; k < k1; ++k){
        const nextJoined = joined(j, k + 1);
        if(prevJoined && nextJoined){
          const a = vid(j, k), b = vid(j + 1, k), d = vid(j, k + 1), e = vid(j + 1, k + 1);
          const pr = Math.max(flowB[a * 4 + 1], flowB[b * 4 + 1], flowB[d * 4 + 1], flowB[e * 4 + 1]);
          if(pr >= 0.01){ idx.push(a, d, b, b, d, e); }
        }
        prevJoined = nextJoined;
      }
    }
    return {position: position, normal: normal, tangent: tangent, across: acrossDir, flowA: flowA, flowB: flowB,
            lump: lump, index: new Uint32Array(idx), vertexCount: nV};
  };
})(ARestlessOcean.WaterfallNappe);
