//Node checks for ARestlessOcean.WaterfallMistHull: the volume the waterfall mist is marched in
//must be a CLOSED, OUTWARD-wound, finite hull that widens as the water falls and stays above the
//water it lands in. Built on real nappe ribbons (a straight 10 m fall, a curved-lip fall).
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

function audit(label, hull, rib, groundMinY){
  const idx = hull.index, P = hull.position;
  check(label+': hull exists', !!hull && hull.vertexCount === rib.vertexCount * 2 && idx.length % 3 === 0 && idx.length > 0, 'verts '+hull.vertexCount+' tris '+idx.length/3);
  let finite = true;
  for(const a of [hull.position, hull.normal, hull.tangent, hull.across, hull.center, hull.mistA, hull.mistB, hull.mistC, hull.mistD]) for(let i = 0; i < a.length; i++) if(!Number.isFinite(a[i])) finite = false;
  check(label+': every attribute finite', finite);
  check(label+': indices in range', idx.every(i => i < hull.vertexCount));
  //Closed: every directed edge appears once and so does its reverse.
  const dir = new Map();
  for(let t = 0; t < idx.length; t += 3) for(let e = 0; e < 3; e++){
    const k = idx[t + e] + ',' + idx[t + (e + 1) % 3];
    dir.set(k, (dir.get(k) || 0) + 1);
  }
  let open = 0, dup = 0;
  dir.forEach((n, k) => { const [a, b] = k.split(','); if(n !== 1) dup++; if(dir.get(b + ',' + a) !== 1) open++; });
  check(label+': closed and consistently wound (each edge once each way)', open === 0 && dup === 0, 'open '+open+' dup '+dup);
  //Outward: the signed volume is positive.
  let vol = 0;
  for(let t = 0; t < idx.length; t += 3){
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = P[a], ay = P[a+1], az = P[a+2], bx = P[b], by = P[b+1], bz = P[b+2], cx = P[c], cy = P[c+1], cz = P[c+2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6.0;
  }
  check(label+': wound outward (signed volume > 0)', vol > 0, 'volume '+f2(vol)+' m3');
  let minY = Infinity;
  for(let t = 0; t < idx.length; t++) minY = Math.min(minY, P[idx[t] * 3 + 1]);
  check(label+': held above the water it lands in', minY >= groundMinY - 1e-3, 'min y '+f2(minY)+' floor '+f2(groundMinY));
  //The cone widens: the largest radius is down the fall, the smallest at its start.
  let rMin = Infinity, rMax = 0, nUsed = 0;
  for(let t = 0; t < idx.length; t++){ const r = hull.mistA[idx[t] * 4 + 3]; rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); nUsed++; }
  check(label+': the cone widens down the fall', rMax > 2.0 * rMin && rMax <= H.DEFAULTS.radiusMax + 1e-6, 'radius '+f2(rMin)+' .. '+f2(rMax));
  //Every layer-+ vertex has its layer-- twin on the opposite side of the centre.
  let mirrored = true;
  const nV = rib.vertexCount;
  for(let t = 0; t < idx.length; t++){
    const v = idx[t] % nV;
    if(hull.mistA[v * 4 + 2] !== 1 || hull.mistA[(nV + v) * 4 + 2] !== -1) mirrored = false;
  }
  check(label+': layers are tagged +1 / -1', mirrored);
}

{ //straight 10 m fall into dry ground
  const ground = (x,z) => z < 0 ? 10 : 0;
  const env = {groundAt: ground, waterAt: () => null};
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:6, discharge:5, drop:10}], env);
  const rib = N.buildRibbon(n, env);
  let ribMinY = Infinity;
  for(let v = 0; v < rib.vertexCount; v++) ribMinY = Math.min(ribMinY, rib.position[v*3+1]);
  const hull = H.build(rib);
  audit('straight', hull, rib, ribMinY);
}
{ //a curved lip: the strands fan out, the frame bends
  const ground = (x,z) => z < -0.002 * x * x ? 10 : 0;
  const env = {groundAt: ground, waterAt: () => null};
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:8, discharge:6, drop:10}], env);
  const rib = N.buildRibbon(n, env);
  let ribMinY = Infinity;
  for(let v = 0; v < rib.vertexCount; v++) ribMinY = Math.min(ribMinY, rib.position[v*3+1]);
  const hull = H.build(rib, {radiusSpread: 0.2});
  audit('curved', hull, rib, ribMinY);
}
check('null ribbon gives no hull', H.build(null) === null);
process.exit(fails?1:0);
