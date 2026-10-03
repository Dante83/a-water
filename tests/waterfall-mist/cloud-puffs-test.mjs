//Node checks for ARestlessOcean.WaterfallCloudPuffs: the billowy clouds that drift off a fall's foot.
//A puff must be born on (just downstream of) its landing line, above the water; leave along the
//downstream normal and be carried off by the wind as it ages; rise; swell monotonically and thin
//as it swells; fade in and out; be born again after its life (somewhere else on the line); be the
//same at the same time (stateless); and the frame's pick must cap the count, keep the nearest and
//hand them over far to near. Built on real ring lines from traced nappes where possible.
//Run: node tests/waterfall-mist/cloud-puffs-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {};
for(const f of ['waterfall-cloud-puffs.js']){
  vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/luts/' + f, import.meta.url), 'utf8'));
}
const P = ARestlessOcean.WaterfallCloudPuffs, D = P.DEFAULTS;
let fails = 0;
const check = (name, ok, info) => { console.log((ok?'PASS ':'FAIL ')+name+'  '+(info||'')); if(!ok) fails++; };
const f2 = x => x.toFixed(2);
const finite = p => ['x','y','z','r','density','age01','seed','level'].every(k => Number.isFinite(p[k]));

//A straight 20 m line along x at level 5, downstream +z, size 1; and a lone point with no side.
const seg = (ax, az, bx, bz, extra) => Object.assign({ax, az, bx, bz, nx: 0, nz: 1, y: 5, size: 1, seed: 0.42, line: 0, _hull: 1, amp: 0.18, wet: true}, extra||{});
const straight = P.lines([seg(0, 0, 10, 0), seg(10, 0, 20, 0)]);
check('lines: two segments of one line make one line', straight.length === 1, 'lines '+straight.length);
const L = straight[0];
check('lines: length and normal', Math.abs(L.length - 20) < 1e-9 && L.nz === 1 && L.nx === 0, 'len '+L.length);
const lone = P.lines([seg(3, 3, 3, 3, {nx: 0, nz: 0, line: 0, _hull: 2})])[0];
const two = P.lines([seg(0, 0, 10, 0), seg(30, 0, 40, 0, {line: 1})]);
check('lines: separate line numbers stay separate', two.length === 2);
const nSlots = P.slotCount(L);
check('slots: stretches within min..max, perStretch each', P.stretchCount(L) >= D.slotsMin && P.stretchCount(L) <= D.slotsMax && nSlots === P.stretchCount(L) * D.perStretch, 'slots '+nSlots);

const wind0 = {x: 0, z: 0}, windX = {x: 8, z: 0};

//── Birth ──
let bornOk = true, bornInfo = '';
for(let k = 0; k < nSlots; ++k){
  for(let t = 0; t < 200; t += 0.37){
    const p = P.puff(L, k, t, wind0);
    if(p.age > 0.05) continue;
    const okX = p.x > -D.birthJitter - 0.01 && p.x < 20 + D.birthJitter + 0.01;
    const okZ = p.z > D.birthOut - D.birthJitter - 0.01 && p.z < D.birthOut + D.birthJitter + 0.2;
    const okY = p.y > 5 + 0.5 * D.plumeHeight;
    if(!(okX && okZ && okY)){ bornOk = false; bornInfo = 'slot '+k+' at ('+f2(p.x)+','+f2(p.y)+','+f2(p.z)+')'; }
  }
}
check('birth: on the line, just downstream, above the level', bornOk, bornInfo);

//── Drift ──
{
  const k = 0;
  //Find a birth time of slot 0.
  let t0 = 0; for(let t = 0; t < 100; t += 0.01){ if(P.puff(L, k, t, wind0).age < 0.011){ t0 = t; break; } }
  const a = P.puff(L, k, t0 + 0.02, wind0), b = P.puff(L, k, t0 + 3, wind0);
  check('drift: with no wind it leaves along the downstream normal', b.z - a.z > 1.0 && Math.abs(b.x - a.x) < 1e-6, 'dz '+f2(b.z - a.z)+' dx '+f2(b.x - a.x));
  check('drift: it rises', b.y > a.y, 'dy '+f2(b.y - a.y));
  const early = [P.puff(L, k, t0 + 0.5, windX), P.puff(L, k, t0 + 1.0, windX)];
  const aL = 0.9 * D.lifeMin;   //late, but still the same puff
  const late = [P.puff(L, k, t0 + aL - 0.25, windX), P.puff(L, k, t0 + aL, windX)];
  const vxE = (early[1].x - early[0].x) / 0.5, vzE = (early[1].z - early[0].z) / 0.5;
  const vxL = (late[1].x - late[0].x) / 0.25, vzL = (late[1].z - late[0].z) / 0.25;
  const vxExpect = windX.x * D.windCoupling * (1 - Math.exp(-(aL - 0.125) / D.windTau));
  check('drift: young, the outflow leads (z faster than wind x)', vzE > vxE, 'vx '+f2(vxE)+' vz '+f2(vzE));
  check('drift: old, the wind leads (x faster than z)', vxL > vzL, 'vx '+f2(vxL)+' vz '+f2(vzL));
  check('drift: the wind speed is windCoupling of the wind, ramped', Math.abs(vxL - vxExpect) < 0.05 * vxExpect, 'vx '+f2(vxL)+' vs '+f2(vxExpect));
  //── Growth and thinning over one life ──
  let rPrev = 0, mono = true, thinMono = true, peakPrev = Infinity, worst = '';
  const life = P.puff(L, k, t0 + 0.02, wind0).life;
  for(let a2 = 0.02; a2 < life - 0.05; a2 += 0.25){
    const p = P.puff(L, k, t0 + a2, wind0);
    if(p.r < rPrev - 1e-9){ mono = false; worst = 'r fell at '+f2(a2); }
    rPrev = p.r;
    const thin = (D.radius0 / p.r) ** 2;
    if(thin > peakPrev + 1e-9){ thinMono = false; }
    peakPrev = thin;
  }
  check('growth: the radius never shrinks', mono, worst);
  const rExpect = D.radius0 + (D.radiusMax - D.radius0) * (1 - Math.exp(-(life - 0.05) / D.growTau));
  check('growth: it swells toward radiusMax', Math.abs(rPrev - rExpect) < 0.05 * rExpect + 0.1 && rPrev <= D.radiusMax + 1e-9, 'r at death '+f2(rPrev)+' vs '+f2(rExpect));
  check('thinning: the peak density falls as it swells', thinMono);
  const pIn = P.puff(L, k, t0 + 0.05, wind0), pMid = P.puff(L, k, t0 + 0.3 * life, wind0), pEnd = P.puff(L, k, t0 + life - 0.02, wind0);
  check('fade: newborn and dying puffs are nearly empty, mid-life is not', pIn.density < 0.02 && pEnd.density < 0.02 && pMid.density > 0.02,
        'in '+pIn.density.toExponential(1)+' mid '+f2(pMid.density)+' end '+pEnd.density.toExponential(1));
  //── Respawn ──
  const again = P.puff(L, k, t0 + life + 0.05, wind0);
  check('respawn: after its life it is newborn again', again.age < 0.1 && again.cycle === pIn.cycle + 1, 'age '+f2(again.age));
  let moved = false;
  for(let c = 1; c < 6; ++c){ const q = P.puff(L, k, t0 + c * life + 0.05, wind0); if(Math.abs(q.x - pIn.x) > 0.05) moved = true; }
  check('respawn: later births land elsewhere on the line', moved);
  //Thin mist dies fast: by three quarters of its life a puff is under a quarter of its peak.
  let peak = 0; for(let a2 = 0.05; a2 < life; a2 += 0.05) peak = Math.max(peak, P.puff(L, k, t0 + a2, wind0).density);
  const dLate = P.puff(L, k, t0 + 0.75 * life, wind0).density;
  check('fade: it thins fast (under a quarter of its peak by 3/4 of its life)', dLate < 0.25 * peak, 'at 3/4 '+f2(dLate)+' peak '+f2(peak));
}

//── The whole line: every slot's births stay in its own stretch, and together they leave no gap ──
{
  const nSt = P.stretchCount(L), per = nSlots / nSt, stretch = 20 / nSt, xs = [];
  let inStretch = true;
  for(let k = 0; k < nSlots; ++k) for(let t = 0; t < 400; t += 0.05){
    const p = P.puff(L, k, t, wind0);
    if(p.age > 0.051) continue;
    //Back out the birth point on the line (the scatter is at most birthJitter).
    const x = p.x;
    const j = Math.floor(k / per);
    if(x < j * stretch - D.birthJitter - 1e-6 || x > (j + 1) * stretch + D.birthJitter + 1e-6) inStretch = false;
    xs.push(x);
  }
  xs.sort((a, b) => a - b);
  let gap = xs[0] - 0; for(let i = 1; i < xs.length; ++i) gap = Math.max(gap, xs[i] - xs[i - 1]); gap = Math.max(gap, 20 - xs[xs.length - 1]);
  check('whole line: each slot is born in its own stretch', inStretch, 'stretch '+f2(stretch)+' m');
  check('whole line: births cover it with no gap over two stretches', gap < 2 * stretch, 'largest gap '+f2(gap)+' m');
  //...and no sweep: neighbouring slots are not born in order.
  const firstBirth = k => { for(let t = 0; t < 30; t += 0.02) if(P.puff(L, k, t, wind0).age < 0.021) return t; return -1; };
  const b = []; for(let k = 0; k < nSlots; k += per) b.push(firstBirth(k));
  let ordered = true; for(let k = 1; k < b.length; ++k) if(b[k] < b[k - 1]) ordered = false;
  check('whole line: births are not a sweep along it', !ordered, b.map(f2).join(' '));
}

//── Stateless and finite ──
{
  const a = P.puff(L, 2, 123.456, windX), b = P.puff(L, 2, 123.456, windX);
  check('stateless: same slot, same time, same puff', JSON.stringify(a) === JSON.stringify(b));
  let ok = true;
  for(const line of [L, lone, ...two]) for(let k = 0; k < P.slotCount(line); ++k) for(let t = 0; t < 300; t += 1.3){
    const p = P.puff(line, k, t, windX);
    if(!finite(p) || p.r <= 0 || p.density < 0 || p.density > 1 + 1e-9 || p.y < p.level) ok = false;
  }
  check('finite: every puff of every line, all times', ok);
  const lp = P.puff(lone, 0, 10.0, wind0);
  check('lone point: puffs still leave (some direction)', Math.hypot(lp.x - 3, lp.z - 3) > 0.1, 'd '+f2(Math.hypot(lp.x - 3, lp.z - 3)));
}

//── Pick ──
{
  const many = [];
  for(let i = 0; i < 12; ++i) many.push(seg(i * 50, 0, i * 50 + 20, 0, {line: i}));
  const lines = P.lines(many);
  const cam = {x: 0, y: 6, z: -10};
  const out = P.pick(lines, 50.0, windX, cam, {maxPuffs: 10});
  check('pick: capped at maxPuffs', out.length === 10, 'n '+out.length);
  let farToNear = true;
  for(let i = 1; i < out.length; ++i) if(out[i].dist > out[i - 1].dist + 1e-9) farToNear = false;
  check('pick: sorted far to near', farToNear);
  const all = P.pick(lines, 50.0, windX, cam, {maxPuffs: 1000});
  const cut = all[all.length - 10].dist;
  check('pick: keeps the nearest', out.every(p => p.dist <= cut + 1e-9) && out[0].dist <= all[all.length - 10].dist + 1e-9);
  const dry = P.lines([seg(0, 0, 20, 0, {wet: false})]);
  check('pick: a dry line has no puffs', P.pick(dry, 50.0, windX, cam).length === 0);
  const far = P.pick(lines, 50.0, windX, {x: 5000, y: 0, z: 0});
  check('pick: nothing beyond maxDistance', far.length === 0);
}

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
