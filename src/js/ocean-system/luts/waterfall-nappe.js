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
//   airborne:  dA = fall height / L_b, L_b = BREAKUP_K · q^BREAKUP_EXP metres, a
//              jet break-up length of the Horeni form (6·q^0.32; quoted from
//              memory of the plunge-jet literature — ⚠ verify before tuning on it);
//   impact:    dA = normal speed lost / IMPACT_AERATION_SPEED;
//   chute:     dA = path / CHUTE_AERATION_LENGTH where the bed is steeper than
//              tan 30° (self-aerated chute flow);
//   gentle:    A decays over AERATION_DECAY_LENGTH (bubbles rise out).
// The rendering turns a into whitewater; clear lip water stays clear.
//
// PRESENCE is where the sheet should draw instead of the heightfield surface:
// 1 airborne, and on attached stretches smoothstep(tan 20°, tan 30°) of the path
// slope. The flowing-water material fades itself out with the SAME band inside the
// fall's corridor (the capsules below), so on flat ledges and pools between steps
// the creek surface draws and on the steps the sheet does.
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
    presenceLo: Math.tan(20.0 * Math.PI / 180.0),
    presenceHi: Math.tan(30.0 * Math.PI / 180.0),
    presenceSmoothRows: 3,      //± rows of box smoothing on presence
    settleRun: 3.0,             //m of gentle attached path after the last fall to stop
    plungeMinDepth: 0.4,        //m, water at least this deep ...
    plungeMaxFroude: 0.6,       //... and at most this Froude number is a pool to plunge into
    plungeDepth: 0.3,           //m the sheet runs on under a pool's surface
    plungeMinFall: 0.3,         //m the jet must fall below its takeoff before a pool counts
    detachMargin: 0.0005,       //m per step the bed must out-drop the free parabola by to launch
    breakupK: 6.0,
    breakupExp: 0.32,
    impactAerationSpeed: 3.0,   //m/s of lost normal speed per unit of aeration budget
    chuteAerationLength: 5.0,   //m
    aerationDecayLength: 3.0,   //m
    minImpactSpeed: 0.5,        //m/s normal speed below which a touchdown is not recorded
    capsuleLength: 4.0,         //m of plan length per corridor capsule
    capsuleMargin: 0.75,        //m added to the half-width
    colSpacing: 0.5             //m between ribbon columns
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
  //  {q, hc, vc, width, discharge, samples[], rows[], impacts[], plunge, capsules[]}
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
    const q = Q / W;
    const hc = Math.cbrt(q * q / G), vc = Math.cbrt(G * q);
    const Lb = opt(o, 'breakupK') * Math.pow(q, opt(o, 'breakupExp'));

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
    let airborne = false, tau = 0.0, path = 0.0, A = 0.0, gentleRun = 0.0, passed = false;
    let everAirborneOrSteep = false;
    const samples = [], impacts = [];
    let plunge = null;
    const pushSample = function(){
      const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const shl = Math.sqrt(vx * vx + vz * vz);
      samples.push({x: px, y: py, z: pz, tau: tau, speed: s, h: thickness(s),
                    air: airborne ? 1.0 : 0.0, aer: 1.0 - Math.exp(-A),
                    hx: shl > 1e-4 ? vx / shl : hx, hz: shl > 1e-4 ? vz / shl : hz});
    };
    pushSample();
    const maxTime = opt(o, 'maxTime'), maxPath = opt(o, 'maxPath');
    const detach = opt(o, 'detachMargin');
    const plungeDepth = opt(o, 'plungeDepth');
    const plungeFall = opt(o, 'plungeMinFall');
    const minImpact = opt(o, 'minImpactSpeed');
    const steep = opt(o, 'presenceHi'), gentle = opt(o, 'presenceLo');

    while(tau < maxTime && path < maxPath){
      const ox = px, oy = py, oz = pz;
      const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
      h = thickness(s);
      if(airborne){
        vy -= G * dt;
        px += vx * dt; py += vy * dt; pz += vz * dt;
        const g2 = env.groundAt(px, pz);
        if(g2 == null) break;
        const w = waterHere(env, px, pz);
        const level = w ? g2 + w.depth : -Infinity;
        //A pool only counts once the jet has really fallen: water right at a lip is
        //the creek it just left.
        if(isPool(w, o) && py <= level && (takeoffY - py) > plungeFall){
          //Into a pool: the impact is where the jet crosses its surface.
          if(!plunge){
            plunge = {x: px, y: level, z: pz, vx: vx, vy: vy, vz: vz, nx: 0, ny: 1, nz: 0, vn: -vy, level: level};
            impacts.push(plunge);
            A += Math.max(-vy, 0.0) / opt(o, 'impactAerationSpeed');
          }
          if(py <= level - plungeDepth){ tau += dt; path += Math.hypot(px - ox, py - oy, pz - oz); pushSample(); break; }
        }
        else if(py <= g2 + h){
          //Touchdown on a ledge or the chute below: lose the normal component.
          const pl = Math.sqrt(vx * vx + vz * vz) || 1.0;
          if(!groundNormalUpwind(env, px, pz, vx / pl, vz / pl, 0.5, nrm)) break;
          const vn = vx * nrm[0] + vy * nrm[1] + vz * nrm[2];
          if(vn < 0.0){
            if(-vn >= minImpact){
              impacts.push({x: px, y: g2 + h, z: pz, vx: vx, vy: vy, vz: vz, nx: nrm[0], ny: nrm[1], nz: nrm[2], vn: -vn, level: g2 + h});
            }
            A += -vn / opt(o, 'impactAerationSpeed');
            vx -= vn * nrm[0]; vy -= vn * nrm[1]; vz -= vn * nrm[2];
          }
          py = g2 + attachedOffset(env, px, pz, g2, h);
          airborne = false;
        }
        A += Math.max(oy - py, 0.0) / Lb;
        everAirborneOrSteep = true;
      }
      else {
        const pl = Math.sqrt(vx * vx + vz * vz);
        const dxp = pl > 1e-4 ? vx / pl : hx, dzp = pl > 1e-4 ? vz / pl : hz;
        if(!groundNormalUpwind(env, px, pz, dxp, dzp, 0.5, nrm)) break;
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
        if(gb == null || gHere == null) break;
        const offB = attachedOffset(env, bx, bz, gb, h);
        if((gHere - gb) > (py - by) + detach){
          airborne = true;
          takeoffY = py;
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
        if(sNow < 0.05) { tau += dt; pushSample(); break; }
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
          break;
        }
      }
      tau += dt;
      path += Math.hypot(px - ox, py - oy, pz - oz);
      if(!passed && ((px - last.bottom[0]) * lx + (pz - last.bottom[2]) * lz) > -0.5) passed = true;
      pushSample();
      if(passed && !airborne && everAirborneOrSteep && gentleRun >= opt(o, 'settleRun')) break;
    }

    const nappe = {q: q, hc: hc, vc: vc, Lb: Lb, width: W, discharge: Q, chain: chain,
                   samples: samples, impacts: impacts, plunge: plunge,
                   rows: [], capsules: []};
    N.resample(nappe, o);
    N.buildCapsules(nappe, o);
    return nappe;
  };

  //Uniform arc-length rows with presence, trimmed to where the sheet shows.
  N.resample = function(nappe, o){
    const S = nappe.samples, ds = opt(o, 'rowSpacing');
    if(S.length < 2) return;
    const cum = [0.0];
    for(let i = 1; i < S.length; ++i){
      cum.push(cum[i - 1] + Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y, S[i].z - S[i - 1].z));
    }
    const total = cum[cum.length - 1];
    const rows = [];
    let j = 0;
    const keys = ['x', 'y', 'z', 'tau', 'speed', 'h', 'air', 'aer', 'hx', 'hz'];
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
    //Presence: airborne → 1; attached → the path slope band.
    const lo = opt(o, 'presenceLo'), hi = opt(o, 'presenceHi');
    const raw = new Array(rows.length);
    for(let i = 0; i < rows.length; ++i){
      const a = rows[Math.max(i - 1, 0)], b = rows[Math.min(i + 1, rows.length - 1)];
      const dPlan = Math.hypot(b.x - a.x, b.z - a.z);
      const slope = dPlan > 1e-6 ? (a.y - b.y) / dPlan : (a.y > b.y ? 1e3 : 0.0);
      raw[i] = Math.max(rows[i].air, smoothstep(lo, hi, slope));
    }
    const R = opt(o, 'presenceSmoothRows');
    for(let i = 0; i < rows.length; ++i){
      //Max-then-box: a smoothed max keeps a one-row airborne hop from averaging away.
      let m = 0.0, sum = 0.0, cnt = 0;
      for(let k = -R; k <= R; ++k){
        const v = raw[Math.min(Math.max(i + k, 0), rows.length - 1)];
        sum += v; ++cnt; m = Math.max(m, v);
      }
      rows[i].presence = 0.5 * (m + sum / cnt);
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

  //Corridor capsules over the rows where the sheet draws: {ax, az, bx, bz, r}. The
  //flowing-water material fades its own surface out inside them (on steep level only).
  N.buildCapsules = function(nappe, o){
    const rows = nappe.rows, len = opt(o, 'capsuleLength');
    const r = 0.5 * nappe.width + opt(o, 'capsuleMargin');
    const caps = [];
    let start = null, plan = 0.0, prev = null;
    for(let i = 0; i < rows.length; ++i){
      const row = rows[i];
      const on = row.presence > 0.05;
      if(on && !start){ start = row; plan = 0.0; }
      if(start && prev) plan += Math.hypot(row.x - prev.x, row.z - prev.z);
      if(start && (!on || plan >= len || i === rows.length - 1)){
        caps.push({ax: start.x, az: start.z, bx: row.x, bz: row.z, r: r});
        start = on ? row : null; plan = 0.0;
      }
      prev = row;
    }
    nappe.capsules = caps;
  };

  //Extrude the rows across the width into ribbon arrays. Attached rows drape each
  //vertex onto its own ground (+ the water's thickness there); airborne rows stay rigid.
  //Returns {position, normal, flowA, flowB, index, vertexCount} (typed arrays).
  //  flowA = (tau, across −1..1, thickness, speed)
  //  flowB = (aeration, presence, airborne, arc length)
  N.buildRibbon = function(nappe, env, o){
    const rows = nappe.rows;
    if(rows.length < 2) return null;
    const W = nappe.width;
    const nCols = Math.max(2, Math.ceil(W / opt(o, 'colSpacing')) + 1);
    const nV = rows.length * nCols;
    const position = new Float32Array(nV * 3), normal = new Float32Array(nV * 3);
    const flowA = new Float32Array(nV * 4), flowB = new Float32Array(nV * 4);
    const gn = [0, 1, 0];
    let v = 0;
    for(let i = 0; i < rows.length; ++i){
      const row = rows[i];
      const attached = 1.0 - row.air;
      for(let c = 0; c < nCols; ++c, ++v){
        const across = -1.0 + 2.0 * c / (nCols - 1);
        const x = row.x + row.ax * across * 0.5 * W;
        const z = row.z + row.az * across * 0.5 * W;
        let y = row.y;
        let nx = row.nx, ny = row.ny, nz = row.nz;
        if(attached > 0.0){
          const g = env.groundAt(x, z);
          if(g != null){
            const yd = g + attachedOffset(env, x, z, g, row.h);
            y = y + (yd - y) * attached;
            if(groundNormal(env, x, z, 0.5, gn)){
              nx += (gn[0] - nx) * attached; ny += (gn[1] - ny) * attached; nz += (gn[2] - nz) * attached;
              const l = Math.hypot(nx, ny, nz) || 1.0;
              nx /= l; ny /= l; nz /= l;
            }
          }
        }
        position[v * 3] = x; position[v * 3 + 1] = y; position[v * 3 + 2] = z;
        normal[v * 3] = nx; normal[v * 3 + 1] = ny; normal[v * 3 + 2] = nz;
        flowA[v * 4] = row.tau; flowA[v * 4 + 1] = across; flowA[v * 4 + 2] = row.h; flowA[v * 4 + 3] = row.speed;
        flowB[v * 4] = row.aer; flowB[v * 4 + 1] = row.presence; flowB[v * 4 + 2] = row.air; flowB[v * 4 + 3] = row.s;
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
    return {position: position, normal: normal, flowA: flowA, flowB: flowB, index: index, vertexCount: nV};
  };
})(ARestlessOcean.WaterfallNappe);
