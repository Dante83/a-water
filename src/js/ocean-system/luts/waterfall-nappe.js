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
// frame): follow one parcel of the fall's water from a couple of metres upstream
// of the lip to wherever it comes to rest, and record the path. The renderer
// (WaterfallSheetPass) extrudes that path across the fall's width.
//
// CASCADES ARE THE MAIN CASE, NOT THE EXCEPTION. island-sholes' "13 falls" are
// chains: each fall's `bottom` is exactly the next fall's `top` (125.5 → 116.8 →
// 114.3 → 111.8 …), plus one 49 m drop down a 36 m run, which is a chute, not a
// free fall. So the parcel is a small state machine on the terrain:
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
    chainGap: 6.0,              //m, a fall's bottom → the next fall's top to chain them
    rowSpacing: 0.25,           //m of arc length between ribbon rows
    gentleSlope: Math.tan(20.0 * Math.PI / 180.0), //bed slope below which the parcel is on gentle ground (settling) ...
    chuteSlope: Math.tan(30.0 * Math.PI / 180.0),  //... and above which it is on a chute (self-aeration)
    presenceSmoothRows: 1,      //± rows of box smoothing on presence
    hopDropLo: 0.25,            //m an airborne stretch must fall to start counting as a fall ...
    hopDropHi: 0.75,            //... and to count fully
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
    corridorLength: 4.0,         //m of plan length per corridor box
    corridorMargin: 0.75,        //m added to the half-width
    colSpacing: 0.5,            //m between ribbon columns
    wetScanStep: 0.25,          //m, across-flow step of the wet-width scan
    wetMinDepth: 0.02,          //m of water that counts as wet for it (the corridor's lipSpan)
    visibleDepth: 0.06,         //m of water the creek visibly draws (mid of its 3→10 cm fade): the sheet's width
    minWidth: 1.0,              //m, narrowest jet
    minUnitDischarge: 0.01,     //m²/s below which the field's depth × speed is not trusted
    climbStop: 0.3,             //m an attached parcel may climb before it counts as ponded
    stallTime: 2.0,             //s ...
    stallDistance: 1.0          //... and the plan progress it must make in that time
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
    const sa = (g0 - gb) / eps, sc = (gr - gl) / (2.0 * eps);
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
    return {depth: d, fr: v / Math.sqrt(G * d)};
  }

  //Height above the bed of the surface the attached parcel rides: the larger of the
  //jet's own thickness and the field's water depth, so an attached sheet sits ON the
  //creek surface rather than under it.
  function attachedOffset(env, x, z, gy, h){
    const w = waterHere(env, x, z);
    return Math.max(h, w ? w.depth : 0.0);
  }

  //A plunge pool: deep AND slow. Deep alone is not enough — the solver can put fast
  //water deeper than plungeMinDepth on the lip cell and down the ramp (Fr ≈ 1, measured
  //on hero-creek's FV solve), and the jet does not "land" in water that is leaving.
  function isPool(w, o){
    return !!w && w.depth >= opt(o, 'plungeMinDepth') && w.fr <= opt(o, 'plungeMaxFroude');
  }

  //Wet extent across the flow at (x, z) along the unit direction (ax, az), out to maxW/2
  //each side: {width, offset} where offset moves (x, z) to the middle of the wet span.
  //Null when (x, z) itself is dry or the water is unknown.
  N.wetSpan = function(env, x, z, ax, az, maxW, step, minDepth){
    const isWet = function(d){
      const w = waterHere(env, x + ax * d, z + az * d);
      return !!w && w.depth >= minDepth;
    };
    if(!isWet(0.0)) return null;
    const half = 0.5 * maxW;
    let r = 0.0, l = 0.0;
    while(r + step <= half && isWet(r + step)) r += step;
    while(l + step <= half && isWet(-(l + step))) l += step;
    return {width: r + l + step, offset: 0.5 * (r - l)};
  };

  //Group falls into cascades: fall j follows fall i when j's top is within chainGap
  //(plan) of i's bottom and not above it by more than a metre. Returns arrays of
  //falls, upstream first. Every fall lands in exactly one chain.
  N.chains = function(falls, o){
    const gap = opt(o, 'chainGap');
    const n = falls.length;
    const succ = new Array(n).fill(-1), hasPred = new Array(n).fill(false);
    for(let i = 0; i < n; ++i){
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

  //Follow one parcel down a chain. Returns null when the terrain under the start is
  //not loaded yet (the caller retries), else the nappe:
  //  {q, hc, vc, width, discharge, samples[], rows[], impacts[], plunge, corridors[],
  //   stop: why the trace ended — plunge | settled | stopped | climb | stall | unloaded | budget}
  N.trace = function(chain, env, o){
    const dt = opt(o, 'dt'), nM = opt(o, 'manningN'), minDepth = opt(o, 'minDepth');
    const first = chain[0], last = chain[chain.length - 1];
    let Q = 0.0, W = 0.0;
    for(let i = 0; i < chain.length; ++i){
      Q = Math.max(Q, chain[i].discharge || 0.0);
      W = Math.max(W, chain[i].width || 0.0);
    }
    if(!(W > 0.0)) W = 4.0;
    if(!(Q > 0.0)) Q = 0.5;

    //Plan heading: the field current at the lip when there is one, else top → bottom.
    let hx = first.bottom[0] - first.top[0], hz = first.bottom[2] - first.top[2];
    let hl = Math.sqrt(hx * hx + hz * hz);
    const w0 = env.waterAt ? env.waterAt(first.top[0], first.top[2]) : null;
    if(w0 && w0.vx != null && Math.sqrt(w0.vx * w0.vx + w0.vz * w0.vz) > 0.1){
      hx = w0.vx; hz = w0.vz; hl = Math.sqrt(hx * hx + hz * hz);
    }
    if(hl > 1e-6){ hx /= hl; hz /= hl; } else { hx = 0.0; hz = 1.0; }
    let lx = last.bottom[0] - last.top[0], lz = last.bottom[2] - last.top[2];
    const ll = Math.sqrt(lx * lx + lz * lz);
    if(ll > 1e-6){ lx /= ll; lz /= ll; } else { lx = hx; lz = hz; }

    const up = opt(o, 'upstreamStart');
    let px = first.top[0] - hx * up, pz = first.top[2] - hz * up;
    let gy = env.groundAt(px, pz);
    if(gy == null) return null;
    //The jet is as wide as the WATER at the start, not a-land's exported width: that is
    //its hydraulic-geometry estimate (4·√Q, 14 m for every island-sholes fall), and a rigid
    //14 m airborne sheet over a 5 m gully stood out past both banks. Scan across the flow
    //for the wet extent (capped at the exported width) and centre the start on it.
    const wet = N.wetSpan(env, px, pz, -hz, hx, W, opt(o, 'wetScanStep'), opt(o, 'wetMinDepth'));
    if(wet){
      W = Math.max(wet.width, opt(o, 'minWidth'));
      px += -hz * wet.offset; pz += hx * wet.offset;
      gy = env.groundAt(px, pz);
      if(gy == null) return null;
    }
    //Flow per unit width from the field's own water where it has some (depth × speed at the
    //start), so the jet carries what is drawn: a-land's exported discharge is its default
    //source (12.5 m³/s on every island-sholes creek), and forced through the measured wet
    //width it made a 1.7 m-thick jet out of a 1.8 m creek. Q/W where the field is silent.
    let q = Q / W;
    const wq = waterHere(env, px, pz), wv = env.waterAt ? env.waterAt(px, pz) : null;
    if(wq && wv && wv.vx != null){
      const fq = wq.depth * Math.sqrt(wv.vx * wv.vx + (wv.vz || 0) * (wv.vz || 0));
      if(fq > opt(o, 'minUnitDischarge')) q = Math.min(fq, q);
    }
    Q = q * W;
    const hc = Math.cbrt(q * q / G), vc = Math.cbrt(G * q);
    const Lb = opt(o, 'breakupK') * Math.pow(q, opt(o, 'breakupExp'));
    let h = hc;
    let py = gy + attachedOffset(env, px, pz, gy, h);
    let vx = hx * vc, vy = 0.0, vz = hz * vc;
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
    let lipSpan = 0.0;
    //The VISIBLE wet span (depth ≥ visibleDepth) across the flow at each takeoff and landing:
    //the sheet's width and centre follow them, so it matches the river it leaves and the
    //river it lands in. Measured to 2 cm, the old start width was wider than the river the
    //creek draws (its thin-water fade drops < 3 cm and is full only at 10 cm), and a rigid
    //width could not match a pool narrower than the lip (hero-creek-sky, Dante).
    const spans = [];
    const recordSpan = function(x, z, dvx, dvz){
      const l = Math.hypot(dvx, dvz) || 1.0;
      const sp = N.wetSpan(env, x, z, -dvz / l, dvx / l, 3.0 * W, opt(o, 'wetScanStep'), opt(o, 'visibleDepth'));
      if(sp) spans.push({i: samples.length, width: Math.max(sp.width, opt(o, 'minWidth')), offset: sp.offset});
    };
    //The creek arrives with air in it already: a-land's energy (0 calm .. 1 whitewater) is
    //what the creek surface's own whitewater keys off, so a turbulent approach launches an
    //already-milky jet and a glassy one launches a clear jet.
    const wStart = env.waterAt ? env.waterAt(px, pz) : null;
    const e0 = (wStart && wStart.energy != null && isFinite(wStart.energy)) ? Math.min(Math.max(wStart.energy, 0.0), 1.0) : 0.0;
    let A = -Math.log(1.0 - opt(o, 'startAeration') * e0);
    let airborne = false, tau = 0.0, path = 0.0, gentleRun = 0.0, passed = false;
    let rise = 0.0, stallT0 = 0.0, stallX = px, stallZ = pz;
    const stallTime = opt(o, 'stallTime'), stallDist = opt(o, 'stallDistance');
    let everAirborneOrSteep = false;
    const samples = [], impacts = [];
    let plunge = null;
    const pushSample = function(){
      const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const shl = Math.sqrt(vx * vx + vz * vz);
      samples.push({x: px, y: py, z: pz, tau: tau, speed: s, h: thickness(s),
                    air: airborne ? 1.0 : 0.0, aer: 1.0 - Math.exp(-A), dive: 0.0,
                    hx: shl > 1e-4 ? vx / shl : hx, hz: shl > 1e-4 ? vz / shl : hz});
    };
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
            recordSpan(px, pz, vx, vz);
            plunge = {x: px, y: level, z: pz, vx: vx, vy: vy, vz: vz, nx: 0, ny: 1, nz: 0, vn: -vy, level: level};
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
          recordSpan(px, pz, vx, vz);
          const pl = Math.sqrt(vx * vx + vz * vz) || 1.0;
          if(!groundNormalUpwind(env, px, pz, vx / pl, vz / pl, 0.5, nrm)){ stop = 'unloaded'; break; }
          const vn = vx * nrm[0] + vy * nrm[1] + vz * nrm[2];
          if(vn < 0.0){
            if(-vn >= minImpact){
              const surf = g2 + attachedOffset(env, px, pz, g2, h);
              impacts.push({x: px, y: surf, z: pz, vx: vx, vy: vy, vz: vz, nx: nrm[0], ny: nrm[1], nz: nrm[2], vn: -vn, level: surf});
            }
            A += -vn / opt(o, 'impactAerationSpeed');
            vx -= vn * nrm[0]; vy -= vn * nrm[1]; vz -= vn * nrm[2];
          }
          py = g2 + attachedOffset(env, px, pz, g2, h);
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
        const fr = G * nM * nM * s / Math.pow(h, 4.0 / 3.0);
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
        const offB = attachedOffset(env, bx, bz, gb, h);
        if((gHere - gb) > (py - by) + detach){
          recordSpan(px, pz, vx, vz);
          airborne = true;
          takeoffY = py;
          //How wide the channel's water is where it leaves the ground: the corridor must
          //hide the creek's heightfield ramp across ALL of it, fringe included, or the
          //fringe's steep-level whitewater pokes out beside the sheet (hero-creek-sky).
          const plx = Math.sqrt(vx * vx + vz * vz) || 1.0;
          const lip = N.wetSpan(env, px, pz, -vz / plx, vx / plx, 3.0 * W, opt(o, 'wetScanStep'), opt(o, 'wetMinDepth'));
          if(lip) lipSpan = Math.max(lipSpan, lip.width + 2.0 * Math.abs(lip.offset));
          vy -= G * dt;
          px = bx; py = by; pz = bz;
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
        const sNow = Math.sqrt(vx * vx + vy * vy + vz * vz);
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
        if(rise > opt(o, 'climbStop')) { tau += dt; pushSample(); stop = 'climb'; break; }
        //Slid into a pool (a chute, or the lower half of a cliff ramp, running into
        //deep water): that is a plunge too. Without this the parcel rode the pool's
        //surface, since attachedOffset lifts it by the water depth, and skated across.
        //Gated on having come down something, so the deep creek above a lip is not a pool.
        const w = waterHere(env, px, pz);
        if(everAirborneOrSteep && isPool(w, o)){
          const level = gb + w.depth;
          plunge = {x: px, y: level, z: pz, vx: vx, vy: vy, vz: vz, nx: 0, ny: 1, nz: 0,
                    vn: Math.max(-vy, 0.0), level: level};
          impacts.push(plunge);
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
      if(tau - stallT0 >= stallTime){
        if(Math.hypot(px - stallX, pz - stallZ) < stallDist){ stop = 'stall'; break; }
        stallT0 = tau; stallX = px; stallZ = pz;
      }
      if(!passed && ((px - last.bottom[0]) * lx + (pz - last.bottom[2]) * lz) > -0.5) passed = true;
      pushSample();
      if(passed && !airborne && everAirborneOrSteep && gentleRun >= opt(o, 'settleRun')){ stop = 'settled'; break; }
    }

    const nappe = {q: q, hc: hc, vc: vc, Lb: Lb, width: W, discharge: Q, chain: chain,
                   samples: samples, impacts: impacts, plunge: plunge, stop: stop, lipSpan: lipSpan, spans: spans,
                   rows: [], corridors: []};
    N.resample(nappe, o);
    N.buildCorridors(nappe, o);
    return nappe;
  };

  //Uniform arc-length rows with presence, trimmed to where the sheet shows.
  N.resample = function(nappe, o){
    const S = nappe.samples, ds = opt(o, 'rowSpacing');
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
    const cum = [0.0];
    for(let i = 1; i < S.length; ++i){
      cum.push(cum[i - 1] + Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y, S[i].z - S[i - 1].z));
    }
    const total = cum[cum.length - 1];
    const rows = [];
    let j = 0;
    const keys = ['x', 'y', 'z', 'tau', 'speed', 'h', 'air', 'aer', 'hx', 'hz', 'fallW', 'dive'];
    for(let s = 0.0; s <= total + 1e-6; s += ds){
      while(j < S.length - 2 && cum[j + 1] < s) ++j;
      const seg = cum[j + 1] - cum[j];
      const f = seg > 1e-9 ? Math.min(Math.max((s - cum[j]) / seg, 0.0), 1.0) : 0.0;
      const r = {s: s};
      for(let k = 0; k < keys.length; ++k) r[keys[k]] = S[j][keys[k]] + (S[j + 1][keys[k]] - S[j][keys[k]]) * f;
      const hl = Math.hypot(r.hx, r.hz);
      if(hl > 1e-6){ r.hx /= hl; r.hz /= hl; } else { r.hx = 0.0; r.hz = 1.0; }
      rows.push(r);
    }
    //Width and centre offset along the sheet, piecewise-linear between the recorded spans.
    const sp = (nappe.spans || []).map(function(e){ return {s: cum[Math.min(e.i, cum.length - 1)], width: e.width, offset: e.offset}; });
    for(let i = 0; i < rows.length; ++i){
      const r = rows[i];
      if(!sp.length){ r.w = nappe.width; r.off = 0.0; continue; }
      let k = 0;
      while(k < sp.length && sp[k].s <= r.s) ++k;
      if(k === 0){ r.w = sp[0].width; r.off = sp[0].offset; }
      else if(k === sp.length){ r.w = sp[k - 1].width; r.off = sp[k - 1].offset; }
      else {
        const a = sp[k - 1], b = sp[k], f = (r.s - a.s) / Math.max(b.s - a.s, 1e-6);
        r.w = a.width + (b.width - a.width) * f; r.off = a.offset + (b.offset - a.offset) * f;
      }
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
      const tl = Math.hypot(tx, ty, tz) || 1.0;
      tx /= tl; ty /= tl; tz /= tl;
      const axx = -rows[i].hz, axz = rows[i].hx;
      //n = t × across (across has no y)
      let nx = ty * axz, ny = tz * axx - tx * axz, nz = -ty * axx;
      if(nx * rows[i].hx + ny + nz * rows[i].hz < 0.0){ nx = -nx; ny = -ny; nz = -nz; }
      const nl = Math.hypot(nx, ny, nz) || 1.0;
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
    const rows = nappe.rows, len = opt(o, 'corridorLength');
    //As wide as the sheet, or as the channel's water at any lip (lipSpan, centred span
    //about the jet), whichever is wider.
    const r = 0.5 * Math.max(nappe.width, nappe.lipSpan || 0.0) + opt(o, 'corridorMargin');
    const caps = [];
    let start = null, plan = 0.0, prev = null;
    for(let i = 0; i < rows.length; ++i){
      const row = rows[i];
      //Only the FREE FALL: the creek steps aside under the jet and nowhere else. Covering the
      //whole ribbon (the 3 m lead-in and tail) hid the creek's foamy surface over the landing
      //zone, and the tail drew plain clear water there instead: a Fresnel-white slab with a
      //crack above it at the foot of the fall (round 10). The attached rows fill only the
      //creek's own holes (the material's complement).
      const on = (row.fallFlag !== undefined ? row.fallFlag : row.presence) > 0.5;
      if(on && !start){ start = row; plan = 0.0; }
      if(start && prev) plan += Math.hypot(row.x - prev.x, row.z - prev.z);
      if(start && (!on || plan >= len || i === rows.length - 1)){
        caps.push({ax: start.x, az: start.z, bx: row.x, bz: row.z, r: r});
        start = on ? row : null; plan = 0.0;
      }
      prev = row;
    }
    nappe.corridors = caps;
  };

  //Extrude the rows across the width into ribbon arrays: rigid across (every row is a
  //straight line at its own height). Rows used to drape onto the ground where the parcel
  //was attached, which climbed the banks and twisted the corners into the air; the sheet
  //only draws the free fall now, and a falling sheet is straight across.
  //Returns {position, normal, tangent, across, flowA, flowB, index, vertexCount} (typed arrays).
  //  tangent = down the flow, across = horizontal, toward +across (both unit): the vertex
  //  stage's displacement frame
  //  flowA = (tau, across −1..1, thickness, speed)
  //  flowB = (aeration, presence, free-fall flag, half-width m); lump = lump weight (see resample)
  N.buildRibbon = function(nappe, env, o){
    const rows = nappe.rows;
    if(rows.length < 2) return null;
    const W = nappe.width;
    let wMax = W;
    for(let i = 0; i < rows.length; ++i) wMax = Math.max(wMax, rows[i].w || 0.0);
    const nCols = Math.max(2, Math.ceil(wMax / opt(o, 'colSpacing')) + 1);
    const nV = rows.length * nCols;
    const position = new Float32Array(nV * 3), normal = new Float32Array(nV * 3);
    const tangent = new Float32Array(nV * 3), acrossDir = new Float32Array(nV * 3);
    const flowA = new Float32Array(nV * 4), flowB = new Float32Array(nV * 4), lump = new Float32Array(nV);
    let v = 0;
    for(let i = 0; i < rows.length; ++i){
      const row = rows[i];
      for(let c = 0; c < nCols; ++c, ++v){
        const across = -1.0 + 2.0 * c / (nCols - 1);
        const w = row.w || W, off = row.off || 0.0;
        position[v * 3] = row.x + row.ax * (off + across * 0.5 * w);
        position[v * 3 + 1] = row.y;
        position[v * 3 + 2] = row.z + row.az * (off + across * 0.5 * w);
        normal[v * 3] = row.nx; normal[v * 3 + 1] = row.ny; normal[v * 3 + 2] = row.nz;
        tangent[v * 3] = row.tx; tangent[v * 3 + 1] = row.ty; tangent[v * 3 + 2] = row.tz;
        acrossDir[v * 3] = row.ax; acrossDir[v * 3 + 1] = 0.0; acrossDir[v * 3 + 2] = row.az;
        flowA[v * 4] = row.tau; flowA[v * 4 + 1] = across; flowA[v * 4 + 2] = row.h; flowA[v * 4 + 3] = row.speed;
        flowB[v * 4] = row.aer; flowB[v * 4 + 1] = row.presence; flowB[v * 4 + 2] = row.fallFlag; flowB[v * 4 + 3] = 0.5 * (row.w || W);
        lump[v] = row.lumpW;
      }
    }
    const index = new Uint32Array((rows.length - 1) * (nCols - 1) * 6);
    let k = 0;
    for(let i = 0; i < rows.length - 1; ++i){
      for(let c = 0; c < nCols - 1; ++c){
        const a = i * nCols + c, b = a + 1, d = a + nCols, e = d + 1;
        index[k++] = a; index[k++] = d; index[k++] = b;
        index[k++] = b; index[k++] = d; index[k++] = e;
      }
    }
    return {position: position, normal: normal, tangent: tangent, across: acrossDir, flowA: flowA, flowB: flowB, lump: lump, index: index, vertexCount: nV};
  };
})(ARestlessOcean.WaterfallNappe);
