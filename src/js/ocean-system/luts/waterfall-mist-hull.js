//── WaterfallMistHull ───────────────────────────────────────────────────────
//
//The proxy volume the waterfall mist is raymarched in (waterfall-mist.glsl). Pure math, no
//THREE: it takes the ribbon ARestlessOcean.WaterfallNappe.buildRibbon wove for the curtain and
//thickens it into a CLOSED hull, the curved cone the water sweeps out as it falls: the ribbon
//pushed out along its own normal both ways by a radius that grows with the distance fallen,
//the outer strands pushed out sideways, the foot pushed on past the landing, the whole hull
//held above the water it lands in. The fragment stage draws the hull's far side and marches
//back toward the camera, so what matters here is that the hull is closed, consistently wound
//(outward) and hugs the curtain.
//
//Returns {position, normal, tangent, across, center, mistA, mistB, index, vertexCount}:
//  position  hull vertex (world)
//  normal / tangent / across   the curtain's own frame at the row (unit): the shader measures
//            every sample in this frame, in metres from `center`, so the noise is continuous
//            over the hull however the curtain bends
//  center    the curtain's centre point at the row
//  mistA = (s, acrossM, side, radius)   s: metres of path since the strand began; acrossM: the
//            seed's offset from the middle of the curtain; side: +1 / -1 (which layer);
//            radius: the hull's half-thickness here, m
//  mistB = (aeration, along, fallFlag, halfWidth)   along: 1 inside, ramping to 0 at the last row
//            (the density's fade at the hull's foot)
//
//FUDGE: radiusBase / radiusSpread / aerationGrowth / edgeSpread / footSpread are look choices
//(the cone's opening angle), not a plume model; they are options so a world can retune them.
//The proxy volume the waterfall mist is raymarched in (waterfall-mist.glsl). Pure math, no
//THREE: it takes the ribbon ARestlessOcean.WaterfallNappe.buildRibbon wove for the curtain and
//thickens its FREE-FALL part into a CLOSED hull, the curved cone the water sweeps out as it
//falls: the ribbon pushed out along its own normal both ways by a radius that grows with the
//distance fallen, the outer strands pushed out sideways, the foot pushed on past the landing, the
//whole hull held above the water it lands in. The fragment stage draws the hull's far side and
//marches back toward the camera, so what matters here is that the hull is closed, consistently
//wound (outward) and hugs the curtain. The attached rows (the lead-in above the lip and the
//landing tail on the ground) are left out: the creek draws those, and the tail's flaps, folded
//where strands slide into one another, crumpled the foot of the hull.
//
//Returns {position, normal, tangent, across, center, mistA, mistB, mistC, mistD, index, vertexCount}:
//  position  hull vertex (world)
//  normal / tangent / across   the curtain's own frame at the row (unit): the shader measures
//            every sample in this frame, in metres from `center`, so the noise is continuous
//            over the hull however the curtain bends
//  center    the curtain's centre point at the row
//  mistA = (s, acrossM, side, radius)   s: metres of path since the strand began; acrossM: the
//            seed's offset from the middle of the curtain; side: +1 / -1 (which layer);
//            radius: the hull's half-thickness here, m
//  mistB = (aeration, footLen, fallFlag, halfWidth)   footLen: m past the landing over which the
//            density fades out (the same for the whole strand, so strands that land at slightly
//            different rows do not cut teeth into it)
//  mistC = the strand's landing point (its last row's centre), world
//  mistD = the horizontal direction the water runs at the landing (unit, x z)
//
//FUDGE: radiusBase / radiusSpread / aerationGrowth / edgeSpread / footSpread are look choices
//(the cone's opening angle), not a plume model; they are options so a world can retune them.
ARestlessOcean.WaterfallMistHull = ARestlessOcean.WaterfallMistHull || {};
(function(H){
  H.DEFAULTS = {
    radiusBase: 0.3,        //m, half-thickness where the fall starts
    radiusSpread: 0.12,     //m of half-thickness per m fallen (the cone's opening)
    aerationGrowth: 1.0,    //extra radius as a fraction of itself at full aeration
    radiusMax: 4.0,         //m
    edgeSpread: 0.6,        //how far (in radii) the outer strands' hull stands out sideways
    footSpread: 1.6,        //how far (in radii) the last row's hull runs on past the landing
    footFade: 0.85,         //the density is gone this fraction of footSpread past the landing
    floorLift: 0.04,        //m above the lowest row's height the hull is held (the pool it lands in)
    airOnly: 1              //1: only the free-fall rows (fallFlag); 0: every row the ribbon draws
  };
  const opt = function(o, k){ return (o && o[k] !== undefined) ? o[k] : H.DEFAULTS[k]; };

  H.build = function(rib, o){
    if(!rib || !rib.index || !rib.index.length) return null;
    const nV = rib.vertexCount;
    const P = rib.position, Nn = rib.normal, T = rib.tangent, A = rib.across, fA = rib.flowA, fB = rib.flowB;

    //The triangles the hull is made of: the ribbon's, over its free-fall rows.
    const air = opt(o, 'airOnly') ? 0.5 : -1.0;
    const keep = [];
    for(let t = 0; t < rib.index.length; t += 3){
      const a = rib.index[t], b = rib.index[t + 1], c = rib.index[t + 2];
      if(fB[a * 4 + 2] > air && fB[b * 4 + 2] > air && fB[c * 4 + 2] > air) keep.push(a, b, c);
    }
    if(!keep.length) return null;
    const ri = new Uint32Array(keep);
    const used = new Uint8Array(nV);
    for(let i = 0; i < ri.length; ++i) used[ri[i]] = 1;

    //Strand boundaries: tau (time of flight) restarts at each strand's first row. Per strand: the
    //path length at its first USED row (the cone opens from there), and its last used row (the
    //landing: its height is the floor, its point and heading the foot's).
    const s = new Float32Array(nV), s0 = new Float32Array(nV), endV = new Int32Array(nV).fill(-1);
    const last = new Uint8Array(nV);
    let begin = 0;
    const closeStrand = function(end){   //[begin, end)
      let lo = -1, hi = -1;
      for(let v = begin; v < end; ++v){ if(used[v]){ if(lo < 0) lo = v; hi = v; } }
      if(lo < 0) return;
      for(let v = begin; v < end; ++v){ s0[v] = s[lo]; endV[v] = hi; }
      last[hi] = 1;
    };
    for(let v = 0; v < nV; ++v){
      if(v === 0 || fA[v * 4] < fA[(v - 1) * 4] - 1e-6){
        closeStrand(v);
        begin = v; s[v] = 0.0;
      }
      else{
        const dx = P[v * 3] - P[(v - 1) * 3], dy = P[v * 3 + 1] - P[(v - 1) * 3 + 1], dz = P[v * 3 + 2] - P[(v - 1) * 3 + 2];
        s[v] = s[v - 1] + Math.hypot(dx, dy, dz);
      }
    }
    closeStrand(nV);

    const nH = nV * 2;   //layer +1 at v, layer -1 at nV + v
    const position = new Float32Array(nH * 3), normal = new Float32Array(nH * 3);
    const tangent = new Float32Array(nH * 3), across = new Float32Array(nH * 3), center = new Float32Array(nH * 3);
    const mistA = new Float32Array(nH * 4), mistB = new Float32Array(nH * 4);
    const mistC = new Float32Array(nH * 3), mistD = new Float32Array(nH * 2);
    const rBase = opt(o, 'radiusBase'), rSpread = opt(o, 'radiusSpread'), aerG = opt(o, 'aerationGrowth'), rMax = opt(o, 'radiusMax');
    const edgeSp = opt(o, 'edgeSpread'), footSp = opt(o, 'footSpread'), footFade = opt(o, 'footFade'), lift = opt(o, 'floorLift');
    const radiusAt = function(v){
      const fallen = Math.max(s[v] - s0[v], 0.0);
      return Math.min((rBase + rSpread * fallen) * (1.0 + aerG * fB[v * 4]), rMax);
    };
    for(let v = 0; v < nV; ++v){
      if(!used[v]) continue;
      const e = endV[v];
      const r = radiusAt(v);
      const acrossN = fA[v * 4 + 1];
      const acrossM = acrossN * fB[v * 4 + 3];
      //Sideways: the outer strands stand out, along their own across direction.
      let ox = 0.0, oy = 0.0, oz = 0.0;
      if(Math.abs(acrossN) > 0.99){
        const sg = acrossN > 0.0 ? 1.0 : -1.0;
        ox += A[v * 3] * sg * r * edgeSp; oy += A[v * 3 + 1] * sg * r * edgeSp; oz += A[v * 3 + 2] * sg * r * edgeSp;
      }
      //The landing's heading: the water's horizontal direction at the strand's last row.
      let dx = T[e * 3], dz = T[e * 3 + 2];
      const dl = Math.hypot(dx, dz);
      if(dl > 1e-4){ dx /= dl; dz /= dl; } else { dx = 0.0; dz = 1.0; }
      //The foot runs on horizontally past the landing, by the radius the strand has opened to there.
      const rEnd = radiusAt(e);
      if(last[v]){ ox += dx * footSp * rEnd; oz += dz * footSp * rEnd; }
      const fy = P[e * 3 + 1] + lift;
      for(let side = 0; side < 2; ++side){
        const h = side === 0 ? 1 : -1, w = side * nV + v;
        position[w * 3] = P[v * 3] + Nn[v * 3] * r * h + ox;
        position[w * 3 + 1] = Math.max(P[v * 3 + 1] + Nn[v * 3 + 1] * r * h + oy, fy);
        position[w * 3 + 2] = P[v * 3 + 2] + Nn[v * 3 + 2] * r * h + oz;
        normal[w * 3] = Nn[v * 3]; normal[w * 3 + 1] = Nn[v * 3 + 1]; normal[w * 3 + 2] = Nn[v * 3 + 2];
        tangent[w * 3] = T[v * 3]; tangent[w * 3 + 1] = T[v * 3 + 1]; tangent[w * 3 + 2] = T[v * 3 + 2];
        across[w * 3] = A[v * 3]; across[w * 3 + 1] = A[v * 3 + 1]; across[w * 3 + 2] = A[v * 3 + 2];
        center[w * 3] = P[v * 3]; center[w * 3 + 1] = P[v * 3 + 1]; center[w * 3 + 2] = P[v * 3 + 2];
        mistA[w * 4] = s[v]; mistA[w * 4 + 1] = acrossM; mistA[w * 4 + 2] = h; mistA[w * 4 + 3] = r;
        mistB[w * 4] = fB[v * 4]; mistB[w * 4 + 1] = footFade * footSp * rEnd; mistB[w * 4 + 2] = fB[v * 4 + 2]; mistB[w * 4 + 3] = fB[v * 4 + 3];
        mistC[w * 3] = P[e * 3]; mistC[w * 3 + 1] = P[e * 3 + 1]; mistC[w * 3 + 2] = P[e * 3 + 2];
        mistD[w * 2] = dx; mistD[w * 2 + 1] = dz;
      }
    }

    //Faces. Each ribbon triangle becomes one on each layer, wound so its geometric normal points
    //away from the curtain (+normal on the + layer, -normal on the - layer); each ribbon edge
    //used by a single triangle (the rim: edge strands, torn edges, both ends) becomes a wall
    //quad between the layers, wound away from its triangle.
    const idx = [];
    const gn = function(a, b, c){
      const ax = position[b * 3] - position[a * 3], ay = position[b * 3 + 1] - position[a * 3 + 1], az = position[b * 3 + 2] - position[a * 3 + 2];
      const bx = position[c * 3] - position[a * 3], by = position[c * 3 + 1] - position[a * 3 + 1], bz = position[c * 3 + 2] - position[a * 3 + 2];
      return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    };
    const edges = new Map();
    const edgeKey = function(a, b){ return a < b ? a * 4294967296 + b : b * 4294967296 + a; };
    //Orientation. The weave is not wound the same way everywhere (a few quads come out
    //reversed next to their neighbours, which a per-triangle test against the frame's normal
    //cannot repair either: it disagrees on the near-degenerate ones). So: orient the triangles
    //to agree with their neighbours across shared edges, component by component, then let each
    //component's majority decide which way it faces against the frame's normal.
    const nT = ri.length / 3;
    const nbr = new Map();
    for(let t = 0; t < nT; ++t) for(let e = 0; e < 3; ++e){
      const k = edgeKey(ri[t * 3 + e], ri[t * 3 + (e + 1) % 3]);
      const l = nbr.get(k);
      if(l) l.push(t); else nbr.set(k, [t]);
    }
    const flip = new Int8Array(nT);   //0 unvisited, +1 native, -1 reversed
    const comp = new Int32Array(nT).fill(-1);
    const compVote = [];
    for(let seed = 0; seed < nT; ++seed){
      if(flip[seed] !== 0) continue;
      const ci = compVote.length;
      let vote = 0.0;
      flip[seed] = 1; comp[seed] = ci;
      const stack = [seed];
      while(stack.length){
        const t = stack.pop();
        const a = ri[t * 3], b = ri[t * 3 + 1], c = ri[t * 3 + 2];
        const g = gn(a, b, c);
        const nx = Nn[a * 3] + Nn[b * 3] + Nn[c * 3], ny = Nn[a * 3 + 1] + Nn[b * 3 + 1] + Nn[c * 3 + 1], nz = Nn[a * 3 + 2] + Nn[b * 3 + 2] + Nn[c * 3 + 2];
        const gl = Math.hypot(g[0], g[1], g[2]), nl = Math.hypot(nx, ny, nz);
        if(gl > 1e-12 && nl > 1e-12) vote += flip[t] * (g[0] * nx + g[1] * ny + g[2] * nz) / (gl * nl);
        for(let e = 0; e < 3; ++e){
          const p = ri[t * 3 + e], q = ri[t * 3 + (e + 1) % 3];
          const l = nbr.get(edgeKey(p, q));
          if(l.length !== 2) continue;   //a rim, or a pinch: nothing to agree with
          const u = l[0] === t ? l[1] : l[0];
          if(flip[u] !== 0) continue;
          //does u's native winding run this edge the same way as t's?
          let same = false;
          for(let f = 0; f < 3; ++f) if(ri[u * 3 + f] === p && ri[u * 3 + (f + 1) % 3] === q) same = true;
          flip[u] = same ? -flip[t] : flip[t];
          comp[u] = ci;
          stack.push(u);
        }
      }
      compVote.push(vote);
    }
    for(let t = 0; t < nT; ++t){
      const a = ri[t * 3], b = ri[t * 3 + 1], c = ri[t * 3 + 2];
      //which side of the frame's normal the + layer's triangle faces: native * flip * sign(vote)
      const up = (flip[t] * (compVote[comp[t]] >= 0.0 ? 1 : -1)) > 0;
      //+ layer: normal side; - layer: reversed
      if(up){ idx.push(a, b, c); idx.push(nV + a, nV + c, nV + b); }
      else{ idx.push(a, c, b); idx.push(nV + a, nV + b, nV + c); }
      //the + layer's directed edges as emitted
      const tri = up ? [a, b, c] : [a, c, b];
      for(let e = 0; e < 3; ++e){
        const p = tri[e], q = tri[(e + 1) % 3], k = edgeKey(p, q);
        const rec = edges.get(k);
        if(rec) rec.n++;
        else edges.set(k, {a: p, b: q, n: 1});
      }
    }
    edges.forEach(function(rec){
      if(rec.n !== 1) return;
      //The + layer runs this rim edge p -> q, so the wall runs it q -> p on that layer (and p -> q
      //on the - layer, whose triangles are reversed): q+ p+ p- q-.
      const p = rec.a, q = rec.b, p2 = nV + p, q2 = nV + q;
      idx.push(q, p, p2, q, p2, q2);
    });

    return {position: position, normal: normal, tangent: tangent, across: across, center: center,
            mistA: mistA, mistB: mistB, mistC: mistC, mistD: mistD, index: new Uint32Array(idx), vertexCount: nH};
  };
})(ARestlessOcean.WaterfallMistHull);
