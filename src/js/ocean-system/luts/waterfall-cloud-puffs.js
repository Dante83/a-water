//── WaterfallCloudPuffs ─────────────────────────────────────────────────────
//
//The big, thin, billowy clouds that break off a waterfall's foot and drift away (the last of the
//foot particles, drawn by WaterfallCloudPass in waterfall-cloud.glsl). Pure math, no THREE.
//
//THE PUFFS. Every landing line (WaterfallSplashHull.ringLines: ends, downstream normal, still
//level, size = drop / 10 m) owns a few puff SLOTS. A slot is a puff that is born in the plume, swells,
//rises and thins as it drifts off, dies, and is born again at the foot. Everything is a closed form
//in the global time, so a slot is stateless (frame-rate independent, nothing to integrate, the same
//picture from any frame) and its births are staggered by a per-slot phase.
//  life      each slot has its own life, lifeMin..lifeMax s (seeded), and a random phase, so the births
//            do not beat or sweep. The line is cut into n even stretches, each with perStretch slots, so the mist comes
//            off the WHOLE line (a few random spots read as the fall puffing; Dante 2026-10-02); each
//            cycle is born somewhere inside the stretch.
//  birth     on the line, pushed birthOut x size downstream, at plumeHeight x size over the level;
//            radius r0 = radius0 x size^sizePower.
//  drift     v = outflow e^(-a / outflowTau) n  +  wind x windCoupling (1 - e^(-a / windTau))  +  rise y.
//            The spray's own push carries a puff out along the downstream normal and dies away; the
//            wind takes over as it ages; it rises slowly (warm wet air, and the spray's updraft).
//            Displacement is the integral of that, in closed form. A wind change moves every puff
//            to where the new wind would have carried it (no state to keep); it changes rarely.
//  growth    r = r0 + (rMax x size^sizePower - r0)(1 - e^(-a / growTau)).
//  thinning  the peak density goes as (r0 / r)^thinPower (2: about mass-conserving for a puff that swells mostly
//            sideways), times a fade-in over fadeIn s, an e-fold thinning from birth (fadeTau: thin
//            water mist, not cloud, dies fast) and a fade to zero over the last fadeOut of the life.
//
//Per frame (pick): every live puff of every wet line, culled by distance, the nearest maxPuffs kept,
//then sorted FAR TO NEAR: the instances are one draw, and instance order is blend order.
//
//FUDGE: every number in DEFAULTS is a look choice (no model of the vapour plume behind it).
ARestlessOcean.WaterfallCloudPuffs = ARestlessOcean.WaterfallCloudPuffs || {};
(function(P){
  P.DEFAULTS = {
    slotsMin: 4,          //stretches on a line, at least...
    slotsPerMeter: 0.8,   //...plus this many per m of the line's length (one every ~1.25 m: the whole line breathes)...
    slotsMax: 32,         //...at most this
    perStretch: 2,        //puffs per stretch, at independent ages (one alone left the row alternating bright and dim)
    lifeMin: 6.0,         //s: a puff's life, seeded between these
    lifeMax: 11.0,
    fadeIn: 2.5,          //s over which a newborn puff thickens, so it peaks already spread out (a dense newborn read as a puff of breath)
    fadeTau: 3.5,         //s: e-fold of its thinning from birth on (thin water mist dies fast)...
    fadeOut: 0.25,        //...and the share of the life over which the rest goes to zero at the end
    radius0: 1.0,         //m at birth, for a size-1 fall (10 m drop): wider than its stretch, so neighbours overlap...
    radiusMax: 7.0,       //m it swells toward, likewise...
    sizePower: 0.5,       //...both x size^this (0.5: a 3 m fall's clouds are still big, ~0.55 of a 10 m fall's)
    growTau: 4.0,         //s: e-fold of the swelling
    thinPower: 1.0,       //peak density goes as (r0 / r)^this (2: mass kept, spread over a disc; 1: the fade does the thinning)
    plumeHeight: 0.8,     //m over the still level it is born at (x size)
    birthOut: 0.5,        //m downstream of the line it is born at (x size)
    birthJitter: 0.6,     //m of random scatter round that (x size)
    outflow: 1.2,         //m/s the spray pushes it out along the downstream normal (x size^0.5)...
    outflowTau: 3.0,      //...dying away with this e-fold (s)
    windCoupling: 0.35,   //share of the wind it ends up drifting at...
    windTau: 4.0,         //...reached with this e-fold (s)
    rise: 0.35,           //m/s it rises
    minClearance: 0.4,    //its middle stays at least this share of its radius over the level
    maxDistance: 600.0,   //m from the camera beyond which a puff is not drawn
    maxPuffs: 64          //drawn at most (the nearest)
  };
  const opt = function(o, k){ return (o && o[k] !== undefined) ? o[k] : P.DEFAULTS[k]; };

  //A hash in [0, 1) of two numbers (deterministic, the same in every browser).
  const hash = function(a, b){
    let h = Math.imul((a * 73856093) | 0, 0x9E3779B1) ^ Math.imul((b * 19349663) | 0, 0x85EBCA77);
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
  P.hash = hash;

  //Group the ring segments into lines (segments of the same hull and line number), each with its
  //polyline, mean downstream normal, mean level, mean size and a seed.
  P.lines = function(segments){
    const byLine = new Map();
    for(let i = 0; i < segments.length; ++i){
      const g = segments[i];
      const key = (g._hull !== undefined ? g._hull : 0) + ':' + g.line;
      if(!byLine.has(key)) byLine.set(key, {segs: [], key: key});
      byLine.get(key).segs.push(g);
    }
    const out = [];
    let idx = 0;
    byLine.forEach(function(L){
      let nx = 0.0, nz = 0.0, size = 0.0, len = 0.0;
      for(let i = 0; i < L.segs.length; ++i){
        const g = L.segs[i];
        nx += g.nx; nz += g.nz;
        size += g.size !== undefined ? g.size : 1.0;
        len += Math.hypot(g.bx - g.ax, g.bz - g.az);
      }
      const nl = Math.hypot(nx, nz);
      out.push({segs: L.segs, key: L.key, index: idx++,
                nx: nl > 1e-6 ? nx / nl : 0.0, nz: nl > 1e-6 ? nz / nl : 0.0,
                size: size / L.segs.length, length: len,
                seed: Math.floor((L.segs[0].seed || 0.0) * 100003) + 7 * idx});
    });
    return out;
  };

  //Stretches along a line; it has stretchCount x perStretch slots.
  P.stretchCount = function(line, o){
    return Math.max(opt(o, 'slotsMin'), Math.min(opt(o, 'slotsMax'), Math.round(opt(o, 'slotsMin') + opt(o, 'slotsPerMeter') * line.length)));
  };
  P.slotCount = function(line, o){
    return P.stretchCount(line, o) * Math.max(Math.round(opt(o, 'perStretch')), 1);
  };

  //A point at fraction u of the way along a line's polyline (by length), its level there, and whether
  //the segment under it is wet.
  const along = function(line, u){
    const segs = line.segs;
    if(line.length < 1e-4){
      const g = segs[0];
      return {x: g.ax, z: g.az, y: g.y, wet: g.wet !== false};
    }
    let target = u * line.length;
    for(let i = 0; i < segs.length; ++i){
      const g = segs[i];
      const l = Math.hypot(g.bx - g.ax, g.bz - g.az);
      if(target <= l || i === segs.length - 1){
        const f = l > 1e-6 ? Math.min(Math.max(target / l, 0.0), 1.0) : 0.0;
        return {x: g.ax + (g.bx - g.ax) * f, z: g.az + (g.bz - g.az) * f, y: g.y, wet: g.wet !== false};
      }
      target -= l;
    }
    const g = segs[segs.length - 1];
    return {x: g.bx, z: g.bz, y: g.y, wet: g.wet !== false};
  };

  //Displacement after a time a of the drift with e-fold tau: the integral of (1 - e^(-s/tau)).
  const ramp = function(a, tau){ return a - tau * (1.0 - Math.exp(-a / tau)); };
  //...and of e^(-s/tau).
  const decay = function(a, tau){ return tau * (1.0 - Math.exp(-a / tau)); };

  //One slot at time tSec: {x, y, z, r, density (relative peak, 0..1), age01, seed, level, wet}, or null
  //before its first birth. wind = {x, z} m/s.
  P.puff = function(line, slot, tSec, wind, o){
    const s = line.seed * 31 + slot;
    const lifeMin = opt(o, 'lifeMin'), lifeMax = Math.max(opt(o, 'lifeMax'), lifeMin + 1e-3);
    const life = lifeMin + (lifeMax - lifeMin) * hash(s, 1);
    //Staggered by a random phase per slot (NOT k/n: slots in order along the line would fire in a
    //sweep), so the line always has puffs at every age.
    const phase = life * hash(s, 2);
    const tt = tSec + phase;
    const cycle = Math.floor(tt / life);
    const a = tt - cycle * life;
    const cs = (s * 977 + cycle * 131) | 0;
    const size = line.size;
    //Birth: slot k owns the k-th of n even stretches of the line (so the mist comes off ALL of it, not
    //from a few random spots), born somewhere inside its stretch each time, downstream of the line.
    const n = P.stretchCount(line, o);
    const stretch = Math.floor(slot / Math.max(Math.round(opt(o, 'perStretch')), 1));
    const at = along(line, (stretch + 0.15 + 0.7 * hash(cs, 3)) / n);
    const jit = opt(o, 'birthJitter') * size;
    const ang = 6.283185307 * hash(cs, 4);
    const out = opt(o, 'birthOut') * size;
    let nx = line.nx, nz = line.nz;
    //A line with no preferred side (a lone landing with no arrival direction): out every way.
    if(nx === 0.0 && nz === 0.0){ nx = Math.cos(ang); nz = Math.sin(ang); }
    const bx = at.x + nx * out + Math.cos(ang * 1.7) * jit * hash(cs, 5);
    const bz = at.z + nz * out + Math.sin(ang * 1.7) * jit * hash(cs, 5);
    //Drift.
    const vo = opt(o, 'outflow') * Math.sqrt(size);
    const dOut = vo * decay(a, opt(o, 'outflowTau'));
    const wc = opt(o, 'windCoupling');
    const dWind = ramp(a, opt(o, 'windTau'));
    const wx = wind ? wind.x : 0.0, wz = wind ? wind.z : 0.0;
    const rs = Math.pow(size, opt(o, 'sizePower'));
    const r0 = opt(o, 'radius0') * rs;
    const rMax = Math.max(opt(o, 'radiusMax') * rs, r0);
    const r = r0 + (rMax - r0) * (1.0 - Math.exp(-a / opt(o, 'growTau')));
    let y = at.y + opt(o, 'plumeHeight') * size + opt(o, 'rise') * a;
    y = Math.max(y, at.y + opt(o, 'minClearance') * r);
    const fadeIn = Math.min(a / Math.max(opt(o, 'fadeIn'), 1e-3), 1.0);
    const fo = Math.max(opt(o, 'fadeOut'), 1e-3) * life;
    const fadeOut = Math.min((life - a) / fo, 1.0) * Math.exp(-a / Math.max(opt(o, 'fadeTau'), 1e-3));
    const sm = function(x){ x = Math.min(Math.max(x, 0.0), 1.0); return x * x * (3.0 - 2.0 * x); };
    const thin = Math.pow(r0 / r, opt(o, 'thinPower'));
    return {x: bx + nx * dOut + wx * wc * dWind, y: y, z: bz + nz * dOut + wz * wc * dWind, r: r,
            density: thin * sm(fadeIn) * sm(fadeOut), age01: a / life, age: a, life: life,
            seed: hash(cs, 6), level: at.y, wet: at.wet, slot: slot, cycle: cycle};
  };

  //Every puff to draw this frame: the live ones of every wet line within maxDistance of the camera,
  //the nearest maxPuffs, sorted far to near. out (optional) is reused.
  P.pick = function(lines, tSec, wind, cam, o, out){
    out = out || [];
    out.length = 0;
    const maxD = opt(o, 'maxDistance');
    for(let i = 0; i < lines.length; ++i){
      const line = lines[i];
      const n = P.slotCount(line, o);
      for(let k = 0; k < n; ++k){
        const p = P.puff(line, k, tSec, wind, o);
        if(!p.wet || p.density <= 1e-3) continue;
        const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
        if(d - p.r > maxD) continue;
        p.dist = d;
        out.push(p);
      }
    }
    out.sort(function(a, b){ return a.dist - b.dist; });
    const m = Math.max(opt(o, 'maxPuffs') | 0, 0);
    if(out.length > m) out.length = m;
    out.reverse();
    return out;
  };
})(ARestlessOcean.WaterfallCloudPuffs);
