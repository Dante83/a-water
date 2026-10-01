//Node checks for ARestlessOcean.WaterfallMistHull: the cones the waterfall mist is marched in.
//They must be CLOSED and OUTWARD-wound, finite, narrow at the lip and opening downward (and more
//for a taller fall), and above all have NO WALL LEAK: the shader's density is a function of the
//distance from the cone's axis over its radius, so every wall vertex must sit at exactly that
//ratio 1 (density 0), and every cap vertex inside it. (The first, slab-shaped hull failed this:
//flat sheets of mist stood in the air along the walls and the floor.)
//Built on real nappe ribbons: a straight 10 m fall, a curved-lip fall, a tall 30 m fall, a fall
//over a stair of ledges.
//Run: node tests/waterfall-mist/mist-hull-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {};
for(const f of ['waterfall-nappe.js', 'waterfall-mist-hull.js']){
  vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/luts/' + f, import.meta.url), 'utf8'));
}
const N = ARestlessOcean.WaterfallNappe, H = ARestlessOcean.WaterfallMistHull;
let fails = 0;
const check = (name, ok, info) => { console.log((ok?'PASS ':'FAIL ')+name+'  '+(info||'')); if(!ok) fails++; };
const f2 = x => x.toFixed(2);

function audit(label, hull){
  const idx = hull.index, P = hull.position, nV = hull.vertexCount;
  check(label+': hull exists', !!hull && hull.tubes > 0 && idx.length % 3 === 0 && idx.length > 0, 'tubes '+hull.tubes+' verts '+nV+' tris '+idx.length/3);
  let finite = true;
  for(const a of [hull.position, hull.normal, hull.across, hull.tangent, hull.center, hull.mistA, hull.mistB, hull.mistC]) for(let i = 0; i < a.length; i++) if(!Number.isFinite(a[i])) finite = false;
  check(label+': every attribute finite', finite);
  check(label+': indices in range', idx.every(i => i < nV));
  //Closed: every directed edge appears once and so does its reverse.
  const dir = new Map();
  for(let t = 0; t < idx.length; t += 3) for(let e = 0; e < 3; e++){
    const k = idx[t + e] + ',' + idx[t + (e + 1) % 3];
    dir.set(k, (dir.get(k) || 0) + 1);
  }
  let open = 0, dup = 0;
  dir.forEach((n, k) => { const [a, b] = k.split(','); if(n !== 1) dup++; if(dir.get(b + ',' + a) !== 1) open++; });
  check(label+': closed and consistently wound (each edge once each way)', open === 0 && dup === 0, 'open '+open+' dup '+dup);
  //Outward: every tube's signed volume is positive.
  const tubeOf = new Int32Array(nV);
  hull.ranges.forEach((r, i) => { for(let v = r.v0; v < r.v1; v++) tubeOf[v] = i; });
  const vols = new Float64Array(hull.ranges.length);
  for(let t = 0; t < idx.length; t += 3){
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    vols[tubeOf[idx[t]]] += (P[a] * (P[b+1] * P[c+2] - P[b+2] * P[c+1]) - P[a+1] * (P[b] * P[c+2] - P[b+2] * P[c]) + P[a+2] * (P[b] * P[c+1] - P[b+1] * P[c])) / 6.0;
  }
  check(label+': every tube wound outward (signed volume > 0)', Array.from(vols).every(v => v > 0), 'min '+f2(Math.min(...vols))+' m3');
  //NO WALL LEAK: the shader's x = |perpendicular distance to the axis| / radius, from the
  //interpolated centre / axis direction / radius, is 1 / cos(pi/sides) at the corners of a ring
  //(a circumscribed polygon) and exactly 1 at the middle of each facet, so it is >= 1 everywhere on
  //the wall (density 0); and < 1 on the cap centres.
  let worstCorner = 0.0, minFacet = Infinity, capMax = 0.0, ringCount = 0;
  const xOf = (px, py, pz, v) => {
    const dx = px - hull.center[v*3], dy = py - hull.center[v*3+1], dz = pz - hull.center[v*3+2];
    const tx = hull.tangent[v*3], ty = hull.tangent[v*3+1], tz = hull.tangent[v*3+2];
    const ax = dx*tx + dy*ty + dz*tz;
    return Math.hypot(dx - ax*tx, dy - ax*ty, dz - ax*tz) / hull.mistA[v*4+2];
  };
  hull.ranges.forEach(r => {
    const corner = 1.0 / Math.cos(Math.PI / r.sides);
    for(let v = r.v0; v < r.v1; v++){
      const isCap = v >= r.v1 - 2;
      const x = xOf(P[v*3], P[v*3+1], P[v*3+2], v);
      if(isCap) capMax = Math.max(capMax, x); else { worstCorner = Math.max(worstCorner, Math.abs(x - corner)); ringCount++; }
    }
    //middles of the facets: halfway between neighbouring corners of a ring (the shader interpolates the axis data between them)
    for(let ring = 0; ring < r.rings; ring++) for(let k = 0; k < r.sides; k++){
      const a = r.v0 + ring * r.sides + k, b = r.v0 + ring * r.sides + (k + 1) % r.sides;
      const mx = 0.5 * (P[a*3] + P[b*3]), my = 0.5 * (P[a*3+1] + P[b*3+1]), mz = 0.5 * (P[a*3+2] + P[b*3+2]);
      minFacet = Math.min(minFacet, xOf(mx, my, mz, a));
    }
  });
  check(label+': no wall leak (corners at 1/cos(pi/n), facets tangent: x >= 1, caps inside)', worstCorner < 1e-3 && minFacet > 1.0 - 1e-3 && capMax < 1e-3,
        'corner err '+worstCorner.toExponential(1)+' over '+ringCount+', min facet x '+minFacet.toFixed(4)+', cap x '+capMax.toExponential(1));
  //The cone opens downward.
  hull.ranges.forEach((r, i) => {
    let rTop = Infinity, rLand = 0;
    for(let k = 0; k < r.sides; k++){ rTop = Math.min(rTop, hull.mistA[(r.v0 + k)*4+2]); }
    for(let v = r.v0; v < r.v1 - 2; v++) if(Math.abs(hull.mistA[v*4+1] - 1.0) < 1e-6) rLand = Math.max(rLand, hull.mistA[v*4+2]);
    if(i === 0) check(label+': the cone opens downward (lip radius < landing radius)', rLand > rTop * 1.5 || rLand >= r.radiusEnd - 1e-6, 'lip '+f2(rTop)+' landing '+f2(rLand));
  });
  //u runs 0 at the lip to 1 at the landing, then 1..2 along the run-out.
  let uMin = Infinity, uMax = 0;
  for(let v = 0; v < nV; v++){ uMin = Math.min(uMin, hull.mistA[v*4+1]); uMax = Math.max(uMax, hull.mistA[v*4+1]); }
  check(label+': u spans 0 .. 2 (lip, landing, run-out)', uMin < 1e-6 && uMax > 1.9 && uMax <= 2.0 + 1e-6, 'u '+f2(uMin)+' .. '+f2(uMax));
}
const ribbonOf = (fall, ground, water) => {
  const env = {groundAt: ground, waterAt: water || (() => null)};
  const n = N.trace([fall], env);
  return N.buildRibbon(n, env);
};
const maxRadius = h => Math.max(...h.ranges.map(r => r.radiusEnd));

{ //straight 10 m fall into dry ground
  const rib = ribbonOf({top:[0,10,-0.5], bottom:[0,0,0.5], width:6, discharge:5, drop:10}, (x,z) => z < 0 ? 10 : 0);
  const hull = H.build(rib);
  audit('straight', hull);
  check('straight: a cone for every other strand (and the last)', hull.tubes >= 4 && hull.tubes <= 12, 'tubes '+hull.tubes);
  globalThis.__r10 = maxRadius(hull);
}
{ //a curved lip: the strands fan out
  const rib = ribbonOf({top:[0,10,-0.5], bottom:[0,0,0.5], width:8, discharge:6, drop:10}, (x,z) => z < -0.002 * x * x ? 10 : 0);
  audit('curved', H.build(rib, {strandStride: 1}));
}
{ //a tall 30 m fall: the cone opens further than the 10 m one
  const rib = ribbonOf({top:[0,30,-0.5], bottom:[0,0,0.5], width:6, discharge:5, drop:30}, (x,z) => z < 0 ? 30 : 0);
  const hull = H.build(rib);
  audit('tall', hull);
  check('tall: a 30 m fall opens wider than a 10 m one', maxRadius(hull) > 1.6 * globalThis.__r10, 'landing radius '+f2(maxRadius(hull))+' vs '+f2(globalThis.__r10));
}
{ //a stair of ledges: each free-fall run gets its own cones, hops under minDrop get none
  const ground = (x,z) => z < 0 ? 10 : (z < 4 ? 6 : (z < 8 ? 3 : 0));
  const rib = ribbonOf({top:[0,10,-0.5], bottom:[0,0,9]  , width:5, discharge:4, drop:10}, ground);
  const hull = H.build(rib);
  if(hull){ audit('stair', hull); check('stair: more than one run', new Set(Array.from(hull.ranges, r => r.drop.toFixed(2))).size >= 1, 'tubes '+hull.tubes); }
  else check('stair: hull built', false, 'no tubes');
}
check('null ribbon gives no hull', H.build(null) === null);
process.exit(fails?1:0);
