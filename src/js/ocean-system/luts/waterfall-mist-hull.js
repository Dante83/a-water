//── WaterfallMistHull ───────────────────────────────────────────────────────
//
//The proxy volumes the waterfall mist is raymarched in (waterfall-mist.glsl). Pure math, no
//THREE. For every few strands of the curtain (ARestlessOcean.WaterfallNappe.buildRibbon's rows)
//and every free-fall run of each, it builds a CONE: a closed round tube along the water's own
//path, narrow where the water leaves the lip and opening downward, running on a little way
//horizontally past the landing where the mist rolls out over the pool. Neighbouring cones
//overlap lower down and merge into the body of the fall.
//
//WHY TUBES AND NOT A SLAB. The first version thickened the ribbon along its own normal. That
//normal twists wherever the weave bends or tears, and the hull's walls twisted with it; the
//shader measured the density in the same twisting frame, so a wall could be non-empty (flat
//sheets of mist standing in the air) and the floor clamp made one more. A round tube needs only
//its axis point and axis direction at each ring: the shader's distance to the axis is the same
//number the hull was built from, so the density is zero on the wall BY CONSTRUCTION
//(test: mist-hull-test.mjs "no wall leak"). Rings are parallel-transported, so the tube does not
//twist either.
//
//Returns {position, normal, across, tangent, center, mistA, mistB, mistC, index, vertexCount, tubes}:
//  position  hull vertex (world)
//  normal / across   the CURTAIN's frame at the ring (unit): used only to tell which side of the
//            sheet a sample is on, for the sheet's occlusion
//  tangent   the tube's axis direction at the ring (unit)
//  center    the tube's axis point at the ring
//  mistA = (acrossM, u, radius, seed)   acrossM: the strand's offset from the middle of the
//            curtain (m); u: 0 at the lip, 1 at the landing, 1..2 along the run-out; radius: the
//            tube's radius here (m); seed: per tube
//  mistB = (aeration, length, speed, halfWidth)   length: the run's arc length (m), from lip to landing;
//            speed: the water's speed at the ring (m/s, easing off over the run-out); halfWidth: the curtain's
//  mistC = (landing point xyz, tau)   the run's landing (axis point at its last row), world; tau: the
//            water's TIME OF FLIGHT at the ring (s), the coordinate the shader lays the noise out in, so the
//            foam rides the water and stretches as it accelerates, exactly as the sheet's grain does
//
//FUDGE: every option below is a look choice (the cone's opening angle and where the foam gives
//way to haze), not a plume model; all are options so a world can retune them.
ARestlessOcean.WaterfallMistHull = ARestlessOcean.WaterfallMistHull || {};
(function(H){
  H.DEFAULTS = {
    strandStride: 2,        //a cone for every this-many strands (and always the two edge strands)
    sides: 8,               //facets round each cone
    radiusTop: 0.3,         //m, at the lip
    radiusPerDrop: 0.18,    //m of landing radius per m of drop...
    radiusMin: 0.6,         //...within these
    radiusMax: 9.0,
    radiusExponent: 0.85,   //radius(u) = top + (landing - top) * u^exponent
    footSpread: 2.0,        //run-out length past the landing, in landing radii
    footRings: 4,
    footGrow: 0.35,         //extra radius over the run-out, as a fraction
    footLift: 0.7,          //the run-out's axis stands this fraction of its radius above the landing
    footSlow: 0.75,         //the water's speed has dropped by this fraction at the end of the run-out (it spreads over the pool)
    minDrop: 0.8,           //m: shorter runs (ledge hops) get no cone
    minRun: 3,              //rows
    minPresence: 0.01
  };
  const opt = function(o, k){ return (o && o[k] !== undefined) ? o[k] : H.DEFAULTS[k]; };

  const norm3 = function(v){
    const l = Math.hypot(v[0], v[1], v[2]);
    return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, -1, 0];
  };

  H.build = function(rib, o){
    if(!rib || !rib.index || !rib.index.length) return null;
    const nV = rib.vertexCount;
    const P = rib.position, Nn = rib.normal, T = rib.tangent, A = rib.across, fA = rib.flowA, fB = rib.flowB;
    const M = Math.max(opt(o, 'sides') | 0, 3), stride = Math.max(opt(o, 'strandStride') | 0, 1);
    const footRings = Math.max(opt(o, 'footRings') | 0, 1);

    const used = new Uint8Array(nV);
    for(let i = 0; i < rib.index.length; ++i) used[rib.index[i]] = 1;
    const qualifies = function(v){ return used[v] && fB[v * 4 + 2] > 0.5 && fB[v * 4 + 1] >= opt(o, 'minPresence'); };

    //Strands (tau restarts at each strand's first row) and their free-fall runs.
    const runs = [];
    let strand = -1, runStart = -1;
    const closeRun = function(end, sj){   //vertices [runStart, end)
      if(runStart >= 0 && end - runStart >= opt(o, 'minRun')) runs.push({a: runStart, b: end, strand: sj});
      runStart = -1;
    };
    for(let v = 0; v < nV; ++v){
      const newStrand = v === 0 || fA[v * 4] < fA[(v - 1) * 4] - 1e-6;
      if(newStrand){ closeRun(v, strand); ++strand; }
      if(qualifies(v)){ if(runStart < 0) runStart = v; }
      else closeRun(v, strand);
    }
    closeRun(nV, strand);
    const nStrands = strand + 1;

    const pos = [], nor = [], acr = [], tan = [], cen = [], mA = [], mB = [], mC = [], idx = [];
    const ranges = [];
    let tubes = 0, vBase = 0;
    for(let r = 0; r < runs.length; ++r){
      const run = runs[r];
      if(!(run.strand % stride === 0 || run.strand === nStrands - 1)) continue;
      const n = run.b - run.a;
      //Axis: the run's rows.
      const c = [], tg = [], s = [];
      for(let i = 0; i < n; ++i){
        const v = run.a + i;
        c.push([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
        let t = [T[v * 3], T[v * 3 + 1], T[v * 3 + 2]];
        if(Math.hypot(t[0], t[1], t[2]) < 1e-6 && i + 1 < n) t = [P[(v + 1) * 3] - P[v * 3], P[(v + 1) * 3 + 1] - P[v * 3 + 1], P[(v + 1) * 3 + 2] - P[v * 3 + 2]];
        tg.push(norm3(t));
        s.push(i === 0 ? 0.0 : s[i - 1] + Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1], c[i][2] - c[i - 1][2]));
      }
      const drop = c[0][1] - c[n - 1][1];
      if(drop < opt(o, 'minDrop') || !(s[n - 1] > 1e-3)) continue;
      const rEnd = Math.min(Math.max(opt(o, 'radiusPerDrop') * drop, opt(o, 'radiusMin')), opt(o, 'radiusMax'));
      const rTop = Math.min(opt(o, 'radiusTop'), rEnd);
      const expo = opt(o, 'radiusExponent');
      const radius = [], u = [], src = [], tauR = [], spdR = [];
      for(let i = 0; i < n; ++i){
        const uu = s[i] / s[n - 1];
        u.push(uu); radius.push(rTop + (rEnd - rTop) * Math.pow(uu, expo)); src.push(run.a + i);
        tauR.push(fA[(run.a + i) * 4]); spdR.push(Math.max(fA[(run.a + i) * 4 + 3], 0.5));
      }
      //Run-out: bend the axis from the landing's heading round to horizontal, lifting it clear of the pool.
      const landing = c[n - 1], tl = tg[n - 1];
      let h = [tl[0], 0, tl[2]];
      if(Math.hypot(h[0], h[2]) < 1e-3) h = [A[run.a * 3 + 2], 0, -A[run.a * 3]];   //straight down: out along the sheet's side
      h = norm3([h[0], 0, h[2]]);
      const footLen = opt(o, 'footSpread') * rEnd, step = footLen / footRings;
      for(let m = 1; m <= footRings; ++m){
        const f = m / footRings;
        const tm = norm3([tl[0] + (h[0] - tl[0]) * f, tl[1] + (h[1] - tl[1]) * f, tl[2] + (h[2] - tl[2]) * f]);
        const tp = tg[tg.length - 1];
        const dir = norm3([tp[0] + tm[0], tp[1] + tm[1], tp[2] + tm[2]]);
        const prev = c[c.length - 1];
        const rm = rEnd * (1.0 + opt(o, 'footGrow') * f);
        const nc = [prev[0] + dir[0] * step, prev[1] + dir[1] * step, prev[2] + dir[2] * step];
        nc[1] = Math.max(nc[1], landing[1] + opt(o, 'footLift') * rm);
        c.push(nc); tg.push(tm); radius.push(rm); u.push(1.0 + f); src.push(run.b - 1);
        //Time of flight and speed along the run-out: the water slows as it spreads, and time keeps running.
        const vNew = Math.max(spdR[n - 1] * (1.0 - opt(o, 'footSlow') * f), 0.5), vOld = spdR[spdR.length - 1];
        tauR.push(tauR[tauR.length - 1] + Math.hypot(nc[0] - prev[0], nc[1] - prev[1], nc[2] - prev[2]) / Math.max(0.5 * (vOld + vNew), 0.5));
        spdR.push(vNew);
      }
      const nR = c.length;

      //Rings, parallel-transported. First frame: the sheet's across direction made perpendicular to the axis.
      const frameN = new Array(nR);
      const a0 = [A[run.a * 3], A[run.a * 3 + 1], A[run.a * 3 + 2]];
      const d0 = a0[0] * tg[0][0] + a0[1] * tg[0][1] + a0[2] * tg[0][2];
      let nn = [a0[0] - d0 * tg[0][0], a0[1] - d0 * tg[0][1], a0[2] - d0 * tg[0][2]];
      if(Math.hypot(nn[0], nn[1], nn[2]) < 1e-6) nn = [1, 0, 0];
      nn = norm3(nn);
      for(let i = 0; i < nR; ++i){
        const d = nn[0] * tg[i][0] + nn[1] * tg[i][1] + nn[2] * tg[i][2];
        let q = [nn[0] - d * tg[i][0], nn[1] - d * tg[i][1], nn[2] - d * tg[i][2]];
        if(Math.hypot(q[0], q[1], q[2]) < 1e-6) q = [tg[i][1], -tg[i][2], tg[i][0]];
        nn = norm3(q);
        frameN[i] = nn;
      }

      //The facets are TANGENT to the radius the shader uses (the polygon is circumscribed: its corners stand
      //out to R / cos(pi/M)), so the density, which is zero at distance R from the axis, is zero on every
      //facet, not just at the corners (an inscribed polygon's flat faces sit inside the circle).
      const circ = 1.0 / Math.cos(Math.PI / M);
      const seed = (tubes * 0.6180339887) % 1.0;
      const firstV = vBase;
      const push = function(p, i){
        const v = src[i];
        pos.push(p[0], p[1], p[2]);
        nor.push(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]);
        acr.push(A[v * 3], A[v * 3 + 1], A[v * 3 + 2]);
        tan.push(tg[i][0], tg[i][1], tg[i][2]);
        cen.push(c[i][0], c[i][1], c[i][2]);
        mA.push(fA[v * 4 + 1] * fB[v * 4 + 3], u[i], radius[i], seed);
        mB.push(fB[v * 4], s[n - 1], spdR[i], fB[v * 4 + 3]);
        mC.push(landing[0], landing[1], landing[2], tauR[i]);
        ++vBase;
      };
      for(let i = 0; i < nR; ++i){
        const nv = frameN[i], tv = tg[i];
        const bv = [tv[1] * nv[2] - tv[2] * nv[1], tv[2] * nv[0] - tv[0] * nv[2], tv[0] * nv[1] - tv[1] * nv[0]];
        for(let k = 0; k < M; ++k){
          const ph = 2.0 * Math.PI * k / M, cs = Math.cos(ph) * radius[i] * circ, sn = Math.sin(ph) * radius[i] * circ;
          push([c[i][0] + nv[0] * cs + bv[0] * sn, c[i][1] + nv[1] * cs + bv[1] * sn, c[i][2] + nv[2] * cs + bv[2] * sn], i);
        }
      }
      const apex = vBase; push(c[0], 0);
      const base = vBase; push(c[nR - 1], nR - 1);
      //Faces, wound one way, then flipped as a whole if that came out inward.
      const tri = [];
      for(let i = 0; i + 1 < nR; ++i) for(let k = 0; k < M; ++k){
        const a = firstV + i * M + k, b = firstV + i * M + (k + 1) % M, cc = firstV + (i + 1) * M + k, d = firstV + (i + 1) * M + (k + 1) % M;
        tri.push(a, cc, b, b, cc, d);
      }
      for(let k = 0; k < M; ++k){
        tri.push(apex, firstV + k, firstV + (k + 1) % M);
        tri.push(base, firstV + (nR - 1) * M + (k + 1) % M, firstV + (nR - 1) * M + k);
      }
      let vol = 0.0;
      for(let t = 0; t < tri.length; t += 3){
        const ia = tri[t] * 3, ib = tri[t + 1] * 3, ic = tri[t + 2] * 3;
        vol += (pos[ia] * (pos[ib + 1] * pos[ic + 2] - pos[ib + 2] * pos[ic + 1])
              - pos[ia + 1] * (pos[ib] * pos[ic + 2] - pos[ib + 2] * pos[ic])
              + pos[ia + 2] * (pos[ib] * pos[ic + 1] - pos[ib + 1] * pos[ic])) / 6.0;
      }
      for(let t = 0; t < tri.length; t += 3){
        if(vol >= 0.0) idx.push(tri[t], tri[t + 1], tri[t + 2]);
        else idx.push(tri[t], tri[t + 2], tri[t + 1]);
      }
      ranges.push({v0: firstV, v1: vBase, rings: nR, sides: M, drop: drop, radiusEnd: rEnd});
      ++tubes;
    }
    if(!tubes) return null;
    return {position: new Float32Array(pos), normal: new Float32Array(nor), across: new Float32Array(acr), tangent: new Float32Array(tan),
            center: new Float32Array(cen), mistA: new Float32Array(mA), mistB: new Float32Array(mB), mistC: new Float32Array(mC),
            index: new Uint32Array(idx), vertexCount: vBase, tubes: tubes, ranges: ranges};
  };
})(ARestlessOcean.WaterfallMistHull);
