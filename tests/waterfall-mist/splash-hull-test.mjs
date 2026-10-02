//Node checks for ARestlessOcean.WaterfallSplashHull: the blobs the waterfall's splash bursts are
//marched in, and the model of the burst (a Gaussian impact, thrown up against quadratic drag).
//The FLIGHT must be the closed form it claims (continuous at the apex, back on the water at its
//life, never above its apex, landing below terminal speed); the SHAPE at the apex must be the
//exp(-xi^2 / b^2) bell for a gentle launch and flatter for a hard one; the middle must outlive the
//sides; every blob's proxy must be closed, outward and HOLD its sphere, and the sphere must hold
//the burst for its whole life; a taller fall must splash higher, longer and harder, until it is
//tall enough to have turned to rain, when it must not splash at all.
//Built on real traced nappes, as mist-hull-test.mjs.
//Run: node tests/waterfall-mist/splash-hull-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {};
for(const f of ['waterfall-nappe.js', 'waterfall-splash-hull.js']){
  vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/luts/' + f, import.meta.url), 'utf8'));
}
const N = ARestlessOcean.WaterfallNappe, H = ARestlessOcean.WaterfallSplashHull;
const G = 9.81, VT = H.DEFAULTS.terminalVelocity;
let fails = 0;
const check = (name, ok, info) => { console.log((ok?'PASS ':'FAIL ')+name+'  '+(info||'')); if(!ok) fails++; };
const f2 = x => x.toFixed(2);

//── The flight ──
for(const v0 of [0.5, 2.7, 4.9, 8.5, 15]){
  const T = H.life(v0, VT), Hm = H.apex(v0, VT), sUp = VT / G * Math.atan(v0 / VT);
  let zMax = 0, worstStep = 0, zPrev = 0, worstAcc = 0;
  const n = 4000, ds = T / n;
  //Integrate dv/dt = -g (1 + v|v| / vt^2) alongside, and compare.
  let v = v0, z = 0, worstErr = 0;
  for(let i = 1; i <= n; i++){
    const acc = s => -G * (1 + s * Math.abs(s) / (VT * VT));
    const k1 = acc(v), k2 = acc(v + 0.5 * ds * k1), k3 = acc(v + 0.5 * ds * k2), k4 = acc(v + ds * k3);
    const vNew = v + ds * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
    z += ds * 0.5 * (v + vNew); v = vNew;
    const zc = H.flight(v0, VT, i * ds);
    worstErr = Math.max(worstErr, Math.abs(zc - z));
    zMax = Math.max(zMax, zc);
    worstStep = Math.max(worstStep, Math.abs(zc - zPrev)); zPrev = zc;
  }
  const label = 'flight v0 '+v0+': ';
  check(label+'matches the drag equation integrated numerically', worstErr < 2e-3 * Math.max(Hm, 0.05), 'worst '+worstErr.toExponential(1)+' m of '+f2(Hm));
  check(label+'apex is the closed form, at the end of the rise', Math.abs(zMax - Hm) < 1e-3 * Math.max(Hm, 0.05) && Math.abs(H.flight(v0, VT, sUp) - Hm) < 1e-9, 'H '+f2(Hm)+' m at '+f2(sUp)+' s');
  check(label+'back on the water at its life', Math.abs(H.flight(v0, VT, T)) < 1e-9 && H.flight(v0, VT, 0) === 0, 'T '+f2(T)+' s');
  check(label+'lands below terminal speed and below its launch speed', -v < VT && -v < v0 + 1e-9, 'lands at '+f2(-v)+' m/s');
  check(label+'drag only ever lowers it (H <= v0^2 / 2g, T <= 2 v0 / g)', Hm <= v0 * v0 / (2 * G) + 1e-12 && T <= 2 * v0 / G + 1e-12, f2(Hm)+' vs '+f2(v0 * v0 / (2 * G))+' m');
}
{ //The shape at the apex.
  const b = 0.5, bell = (v0c, xi) => H.apex(H.launch(v0c, b, xi), VT) / H.apex(v0c, VT);
  let gentle = 0, hard = 0;
  for(let k = 1; k <= 20; k++){
    const xi = 2 * b * k / 20, g = Math.exp(-xi * xi / (b * b));
    gentle = Math.max(gentle, Math.abs(bell(0.4, xi) - g));
    hard = Math.max(hard, bell(12, xi) - g);
  }
  check('shape: a gentle splash is the exp(-xi^2 / b^2) bell', gentle < 0.01, 'worst '+gentle.toExponential(1));
  check('shape: a hard one is the bell with its top flattened by drag (fuller than the Gaussian)', hard > 0.1, 'up to '+f2(hard)+' above it');
  let mono = true;
  for(let k = 1; k <= 20; k++) if(!(H.life(H.launch(5, b, 2 * b * k / 20), VT) < H.life(H.launch(5, b, 2 * b * (k - 1) / 20), VT))) mono = false;
  check('shape: the middle outlives the sides (the burst shrinks to its middle)', mono);
}
check('vanish: full below mistLo breakup lengths, gone past mistHi, falling between',
      H.coherent(2 * 5, 5) === 1 && H.coherent(8.1 * 5, 5) === 0 && H.coherent(5 * 5, 5) > H.coherent(6 * 5, 5) && H.coherent(6 * 5, 5) > 0,
      f2(H.coherent(25, 5))+' at 5 Lb');

//── The hull ──
function audit(label, hull){
  const idx = hull.index, P = hull.position, nV = hull.vertexCount;
  check(label+': blobs exist', hull.blobs > 0 && idx.length === hull.blobs * 60 && nV === hull.blobs * 12, 'blobs '+hull.blobs);
  let finite = true;
  for(const a of [hull.position, hull.center, hull.splashA, hull.splashB, hull.splashC]) for(let i = 0; i < a.length; i++) if(!Number.isFinite(a[i])) finite = false;
  check(label+': every attribute finite, indices in range', finite && idx.every(i => i < nV));
  const dir = new Map();
  for(let t = 0; t < idx.length; t += 3) for(let e = 0; e < 3; e++){
    const k = idx[t + e] + ',' + idx[t + (e + 1) % 3];
    dir.set(k, (dir.get(k) || 0) + 1);
  }
  let open = 0, dup = 0;
  dir.forEach((n, k) => { const [a, b] = k.split(','); if(n !== 1) dup++; if(dir.get(b + ',' + a) !== 1) open++; });
  check(label+': closed and consistently wound', open === 0 && dup === 0, 'open '+open+' dup '+dup);
  //Outward, and every face plane at least R from the blob's middle: the proxy holds the sphere.
  let minPlane = Infinity, inward = 0;
  for(let t = 0; t < idx.length; t += 3){
    const v = idx[t], cx = hull.center[v*4], cy = hull.center[v*4+1], cz = hull.center[v*4+2], R = hull.center[v*4+3];
    const p = k => [P[idx[t+k]*3] - cx, P[idx[t+k]*3+1] - cy, P[idx[t+k]*3+2] - cz];
    const a = p(0), b = p(1), c = p(2);
    const n = [(b[1]-a[1])*(c[2]-a[2]) - (b[2]-a[2])*(c[1]-a[1]), (b[2]-a[2])*(c[0]-a[0]) - (b[0]-a[0])*(c[2]-a[2]), (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])];
    const d = (n[0]*a[0] + n[1]*a[1] + n[2]*a[2]) / Math.hypot(n[0], n[1], n[2]);
    if(d <= 0) inward++;
    minPlane = Math.min(minPlane, d / R);
  }
  check(label+': every proxy wound outward and holding its sphere (face planes at >= R)', inward === 0 && minPlane > 1 - 1e-4, 'nearest face at '+minPlane.toFixed(4)+' R');
  //The sphere holds the burst for its whole life, at every launch ring, spread and nudged as far as they go.
  let worst = 0, axisUp = true, onPeriod = true;
  hull.ranges.forEach(r => {
    const fan = hull.splashC[r.v0*4+2], vt = hull.splashC[r.v0*4+1], b = r.width, wide = (1 + fan) * (1 + hull.splashC[r.v0*4+3]);
    for(let k = 0; k <= 20; k++){
      const xi = 2 * b * k / 20, v0 = H.launch(r.launch, b, xi);
      for(let i = 0; i <= 40; i++){
        const s = r.life * i / 40, z = H.flight(v0, vt, s);
        if(z < 0) continue;
        worst = Math.max(worst, Math.hypot(xi * wide + 0.3 * b, z + 0.15) / r.radius);   //out to the falling skirt
      }
    }
    const ax = [hull.splashB[r.v0*4], hull.splashB[r.v0*4+1], hull.splashB[r.v0*4+2]];
    if(!(ax[1] > 0.9 && Math.abs(Math.hypot(...ax) - 1) < 1e-5)) axisUp = false;
    if(!(r.period > r.life && Math.abs(r.life - H.life(r.launch, vt)) < 1e-6 * r.life)) onPeriod = false;
  });
  check(label+': the sphere holds the burst for its whole life', worst < 1.0, 'furthest reach '+f2(worst)+' R');
  check(label+': up axis unit and mostly up; the next burst fires after the last has landed', axisUp && onPeriod);
}
const nappeOf = (fall, ground, water) => N.trace([fall], {groundAt: ground, waterAt: water || (() => null)});
const strongest = h => h.ranges.reduce((a, r) => r.strength > a.strength ? r : a, h.ranges[0]);

let r3, r10, r30;
{ //straight 10 m fall
  const hull = H.build(nappeOf({top:[0,10,-0.5], bottom:[0,0,0.5], width:6, discharge:5, drop:10}, (x,z) => z < 0 ? 10 : 0));
  audit('10 m', hull);
  r10 = strongest(hull);
  check('10 m: a blob every 2 m (every 4th strand, and the last)', hull.blobs >= 3 && hull.blobs <= 6, 'blobs '+hull.blobs);
  //Each blob carries its whole gap's water, so the total does not depend on how far apart they are.
  const sum = h => h.ranges.reduce((a, r) => a + r.strength, 0);
  const fine = H.build(nappeOf({top:[0,10,-0.5], bottom:[0,0,0.5], width:6, discharge:5, drop:10}, (x,z) => z < 0 ? 10 : 0), {strandStride: 1});
  check('10 m: the same water whatever the blob spacing (total strength at stride 4 vs 1)', Math.abs(sum(hull) / sum(fine) - 1) < 0.35, f2(sum(hull))+' vs '+f2(sum(fine)));
  check('10 m: neighbouring blobs overlap (b at least 0.6 x the gap: half the middle\'s water midway between two)', r10.width >= 0.6 * 2.0 - 1e-6, 'b '+f2(r10.width));
  console.log('     10 m: lands at '+f2(r10.vn)+' m/s, launch '+f2(r10.launch)+' m/s, apex '+f2(r10.apex)+' m, life '+f2(r10.life)+' s, period '+f2(r10.period)+' s, R '+f2(r10.radius)+' m, strength '+f2(r10.strength));
}
{ //a short 3 m fall: lower, quicker, weaker
  const hull = H.build(nappeOf({top:[0,3,-0.5], bottom:[0,0,0.5], width:6, discharge:5, drop:3}, (x,z) => z < 0 ? 3 : 0));
  audit('3 m', hull);
  r3 = strongest(hull);
  console.log('     3 m: lands at '+f2(r3.vn)+' m/s, launch '+f2(r3.launch)+' m/s, apex '+f2(r3.apex)+' m, life '+f2(r3.life)+' s, strength '+f2(r3.strength));
  check('a 10 m fall splashes higher, longer and harder than a 3 m one', r10.apex > 1.5 * r3.apex && r10.life > r3.life && r10.strength > 1.5 * r3.strength && r10.period > r3.period);
}
{ //a 30 m fall: higher still, but past mistLo breakup lengths it has begun to fade
  const hull = H.build(nappeOf({top:[0,30,-0.5], bottom:[0,0,0.5], width:6, discharge:5, drop:30}, (x,z) => z < 0 ? 30 : 0));
  audit('30 m', hull);
  r30 = strongest(hull);
  console.log('     30 m: lands at '+f2(r30.vn)+' m/s, launch '+f2(r30.launch)+' m/s, apex '+f2(r30.apex)+' m, life '+f2(r30.life)+' s, coherent '+f2(r30.coherent)+', strength '+f2(r30.strength));
  check('30 m: higher than the 10 m one, and partly turned to mist', r30.apex > r10.apex && r30.coherent < 1.0 && r30.coherent > 0.0 && r10.coherent === 1.0, 'coherent '+f2(r30.coherent));
}
{ //a tall thin fall: rain by the time it lands, no splash
  const hull = H.build(nappeOf({top:[0,90,-0.5], bottom:[0,0,0.5], width:6, discharge:1, drop:90}, (x,z) => z < 0 ? 90 : 0));
  check('90 m thin fall: it has turned to mist, nothing is built', hull === null, hull ? 'blobs '+hull.blobs+' coherent '+f2(strongest(hull).coherent) : '');
}
{ //a stair of ledges: the ledges splash too
  const ground = (x,z) => z < 0 ? 10 : (z < 4 ? 6 : (z < 8 ? 3 : 0));
  const hull = H.build(nappeOf({top:[0,10,-0.5], bottom:[0,0,9], width:5, discharge:4, drop:10}, ground));
  if(hull){
    audit('stair', hull);
    const levels = new Set(hull.ranges.map(r => Math.round(r.y)));
    check('stair: blobs at more than one height', levels.size >= 2, 'heights '+Array.from(levels).join(', '));
  }
  else check('stair: hull built', false, 'no blobs');
}
{ //a plunge into a pool: the blobs sit on the pool's surface
  const hull = H.build(nappeOf({top:[0,10,-0.5], bottom:[0,-2,0.5], width:6, discharge:5, drop:10}, (x,z) => z < 0 ? 10 : -2,
                               (x,z) => z >= 0 ? {depth: 2, level: 0, speed: 0.1, energy: 0} : null));
  if(hull){
    audit('pool', hull);
    check('pool: every blob on the pool surface', hull.ranges.every(r => Math.abs(r.y) < 0.05), 'y '+f2(Math.min(...hull.ranges.map(r => r.y)))+' .. '+f2(Math.max(...hull.ranges.map(r => r.y))));
  }
  else check('pool: hull built', false, 'no blobs');
}
{ //a very wide fall: the blob count is capped
  const hull = H.build(nappeOf({top:[0,10,-0.5], bottom:[0,0,0.5], width:48, discharge:30, drop:10}, (x,z) => z < 0 ? 10 : 0));
  audit('wide', hull);
  check('wide: at most about 48 blobs (+ the edge strand)', hull.blobs <= 50, 'blobs '+hull.blobs);
}
check('null nappe gives no hull', H.build(null) === null);
process.exit(fails?1:0);
