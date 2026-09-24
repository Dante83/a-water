//Node checks for ARestlessOcean.WaterfallNappe (Phase 6): synthetic terrain with known
//answers — a hero-creek-like step, a 45° chute, a 10 m vertical drop, a four-step staircase
//cascade, a chute into a dry bowl, an over-wide export over a narrow wet channel, a pool
//reaching the lip, a jut below the lip, a lip over a lake and a hop run-out; and the SKIRT
//(many strands woven into one sheet): a straight lip, a curved lip, a rock in the fall, a
//cross-sloped landing, wind on the sheet and a creek shallow at its banks.
//Run: node tests/waterfall-nappe/nappe-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {};
vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/luts/waterfall-nappe.js', import.meta.url), 'utf8'));
const N = ARestlessOcean.WaterfallNappe;
let fails = 0;
const check = (name, ok, info) => { console.log((ok?'PASS ':'FAIL ')+name+'  '+(info||'')); if(!ok) fails++; };
const f2 = x => x.toFixed(2);
function summarize(n){
  const air = n.samples.filter(s=>s.air).length;
  return `samples ${n.samples.length} rows ${n.rows.length} impacts ${n.impacts.length} plunge ${!!n.plunge} corr ${n.corridors.length} q ${f2(n.q)} hc ${f2(n.hc)} vc ${f2(n.vc)} airSteps ${air}`;
}
// 1. hero-creek-like: creek flows +Z with slope 0.01, step of 3 m over 1 m at z 764..765, pool (level 2.5) below on flat bed 1.5
//Skirt helpers: vertices / triangle sample points (centroid and edge midpoints) under the ground.
const verticesInside = (rib, ground, tol = 0.01) => {
  let n = 0;
  for(let v = 0; v < rib.vertexCount; v++){ const x = rib.position[v*3], y = rib.position[v*3+1], z = rib.position[v*3+2]; if(ground(x,z) > y + tol) n++; }
  return n;
};
const trianglesInside = (rib, ground, tol = 0.05) => {
  const P = i => [rib.position[i*3], rib.position[i*3+1], rib.position[i*3+2]];
  let n = 0;
  for(let t = 0; t < rib.index.length; t += 3){
    const a = P(rib.index[t]), b = P(rib.index[t+1]), c = P(rib.index[t+2]);
    const pts = [[(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3, (a[2]+b[2]+c[2])/3], [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2],
                 [(b[0]+c[0])/2, (b[1]+c[1])/2, (b[2]+c[2])/2], [(a[0]+c[0])/2, (a[1]+c[1])/2, (a[2]+c[2])/2]];
    if(pts.some(p => ground(p[0], p[2]) > p[1] + tol)) n++;
  }
  return n;
};
//Row k = 0 of every strand that falls: its water at the moment the spine leaves the lip.
const lipRow = n => n.strands.filter(st => st && st.rows.length).map(st => st.rows.find(r => r.k === 0)).filter(Boolean);
//The quads a weave without tears would have: neighbouring strands both holding rows k and k+1.
const fullQuads = n => {
  let full = 0;
  for(let j = 0; j + 1 < n.strands.length; j++){
    const a = n.strands[j], b = n.strands[j+1];
    if(!a || !b) continue;
    const kb = new Set(b.rows.map(r => r.k));
    for(const r of a.rows) if(a.rows.some(q => q.k === r.k + 1) && kb.has(r.k) && kb.has(r.k + 1)) full++;
  }
  return full;
};
{
  const ground = (x,z) => z < 764.5 ? 4.5 + (764.5 - z)*0.01 : (z < 765.5 ? 4.5 - 3*(z-764.5) : 1.5);
  const water = (x,z) => z < 764.5 ? {level: ground(x,z)+0.25, depth:0.25, vx:0, vz:1.2} : (ground(x,z) < 2.5 ? {level: 2.5, depth: 2.5-ground(x,z), vx:0, vz:0.3} : null);
  const fall = {top:[472.3,4.5,764.5], bottom:[472.3,1.5,766.5], width:8.2, discharge:4.23, drop:3};
  const n = N.trace([fall], {groundAt: ground, waterAt: water});
  console.log(summarize(n));
  check('hero: q from the field (0.25 m × 1.2 m/s), hc≈0.21', Math.abs(n.q-0.30)<0.01 && Math.abs(n.hc-0.209)<0.01, 'q '+f2(n.q)+' hc '+f2(n.hc));
  check('hero: plunges into pool', !!n.plunge, n.plunge && `at z ${f2(n.plunge.z)} vy ${f2(n.plunge.vy)}`);
  const lip = n.samples.find(s=>s.air);
  check('hero: leaves bed near lip', lip && Math.abs(lip.z-764.5)<0.6, lip && `z ${f2(lip.z)} speed ${f2(lip.speed)}`);
  check('hero: landing 0.5..3 m past lip', n.plunge && n.plunge.z-764.5>0.5 && n.plunge.z-764.5<3.0);
  check('hero: sheet rows exist', n.rows.length > 4);
  const rib = N.buildRibbon(n, {groundAt: ground, waterAt: water});
  check('hero: ribbon', rib && rib.vertexCount>0 && rib.tangent.length === rib.vertexCount*3, rib && `verts ${rib.vertexCount}`);
  check('hero: sheet is the free fall (+ 3 m lead-in, 3 m tail) only', n.rows.every(r => r.presence < 0.01 || r.air > 0.0 || n.rows.some(q => q.air > 0 && q.s - r.s >= -3.26 && q.s - r.s <= 3.26)), '');
}
// 2. 45° chute 10 m drop, flat above and below (no pool water)
{
  const ground = (x,z) => z < 0 ? 10 : (z < 10 ? 10 - z : 0);
  const water = (x,z) => null;
  const fall = {top:[0,10,0.5], bottom:[0,0,10.5], width:6, discharge:5, drop:10};
  const n = N.trace([fall], {groundAt: ground, waterAt: water});
  console.log(summarize(n));
  const air = n.samples.filter(s=>s.air).length / n.samples.length;
  check('chute: mostly attached', air < 0.2, 'air frac '+f2(air));
  const vmax = Math.max(...n.samples.map(s=>s.speed));
  check('chute: terminal speed 3..14 m/s (friction, < free-fall 14)', vmax>3 && vmax<14, f2(vmax));
  //The chute itself is the creek's own surface: the sheet FALLS only over the short flight off the
  //sharp top edge (a 2 m/s parabola meets a 45° face ~0.8 m out). Down the slope past it (45°,
  //under faceSlope) the rows are the creek's COMPLEMENT only (fall flag 0: drawn where the creek
  //is not, since 2026-09-23), never the free-fall sheet.
  const onChute = n.rows.filter(r => r.z > 4.5 && r.z < 9 && r.presence > 0.01);
  check('chute: down the chute the sheet is only the creek\'s complement (no fall flag)', onChute.every(r => r.fallFlag <= 0.5), onChute.length+' rows');
  check('chute: aerated at bottom', n.samples.at(-1).aer > 0.5, f2(n.samples.at(-1).aer));
}
// 3. vertical 10 m drop
{
  const ground = (x,z) => z < 0 ? 10 : 0;
  const fall = {top:[0,10,0.5], bottom:[0,0,1.5], width:6, discharge:5, drop:10};
  const n = N.trace([fall], {groundAt: ground, waterAt: ()=>null});
  console.log(summarize(n));
  const lip = n.samples.findIndex(s=>s.air);
  const land = n.impacts[0];
  const t = land ? n.samples.find(s=>Math.abs(s.x-land.x)<1e-9 && Math.abs(s.z-land.z)<1e-9) : null;
  check('vertical: free fall, impact vy ≈ -√(2g·10)=-14', land && Math.abs(land.vy + 14.0) < 1.2, land && f2(land.vy));
  check('vertical: landing x = v0·t (≈1-3 m)', land && land.z > 0.8 && land.z < 3.5, land && f2(land.z));
  //The landing tail (landTail) and the last corridor box (corridorTail) run on past the landing.
  const lastFall = n.rows.filter(r => r.fallFlag > 0.5).at(-1);
  const tail = n.rows.at(-1).s - lastFall.s;
  check('vertical: landing tail ≥ 2.5 m (gentle run restarts at takeoff)', tail >= 2.5, 'tail '+f2(tail));
  const cEnd = Math.max(...n.corridors.map(c => c.bz));
  check('vertical: corridor reaches ≥ 1.5 m past the landing', cEnd - lastFall.z >= 1.5, 'past '+f2(cEnd - lastFall.z));
}
// 4. staircase cascade: 4 steps of 2.5 m, 3 m ledges, as a chain of 4 falls
{
  const ground = (x,z) => { const k = Math.min(Math.max(Math.floor(z/3),0),4); return 10 - 2.5*k; };
  const falls = [0,1,2,3].map(k=>({top:[0,10-2.5*k,3*(k+1)-0.5], bottom:[0,10-2.5*(k+1),3*(k+1)+0.5], width:5, discharge:3, drop:2.5}));
  const chains = N.chains(falls.slice().reverse());
  check('cascade: one chain of 4', chains.length===1 && chains[0].length===4, chains.map(c=>c.length).join(','));
  const n = N.trace(chains[0], {groundAt: ground, waterAt: ()=>null});
  console.log(summarize(n));
  check('cascade: ≥3 ledge impacts (bounces)', n.impacts.length>=3, n.impacts.map(i=>`z${f2(i.z)} vn${f2(i.vn)}`).join(' '));
  const ends = n.rows.length ? n.rows[n.rows.length-1].z : 0;
  check('cascade: sheet runs past last step', ends > 12, f2(ends));
}
// 6. chute into a dry bowl: must stop (pond), not slosh for the whole budget
{
  const ground = (x,z) => z < 0 ? 10 : (z < 10 ? 10 - z : 0.02*(z-18)*(z-18) - 1.28);
  const n = N.trace([{top:[0,10,0.5], bottom:[0,0,10.5], width:6, discharge:5, drop:10}], {groundAt: ground, waterAt: ()=>null});
  const tEnd = n.samples.at(-1).tau;
  check('bowl: trace stops (< 15 s, not the 60 s budget)', tEnd < 15, 'tau '+tEnd.toFixed(1)+' rows '+n.rows.length);
}
// 7. export width 14 m over a 5 m wet channel, offset 1 m: width from the water, centred
{
  const ground = (x,z) => z < 0 ? 10 + Math.abs(x-1)*0.3 : Math.abs(x-1)*0.3;
  const water = (x,z) => (z < 0 && Math.abs(x - 1) <= 2.5) ? {level: ground(x,z)+0.3, depth: 0.3, vx:0, vz:1.5} : null;
  const n = N.trace([{top:[0,10,0.5], bottom:[0,0,1.5], width:14.1, discharge:5, drop:10}], {groundAt: ground, waterAt: water});
  check('wet width: ~5 m, not 14.1', n.width > 4 && n.width < 6, 'width '+n.width.toFixed(2));
  check('wet width: centred on the channel (x≈1)', Math.abs(n.samples[0].x - 1) < 0.3, 'x0 '+n.samples[0].x.toFixed(2));
}
// 8. a rock jutting into one side of the lip: the sheet must narrow, not pass through it
{
  const ground = (x,z) => { const base = z < 0 ? 10 : 0; return (x > 1.5 && z > -0.5 && z < 1.5) ? 12 : base; };
  const fall = {top:[0,10,0.5], bottom:[0,0,1.5], width:6, discharge:5, drop:10};
  const n = N.trace([fall], {groundAt: ground, waterAt: ()=>null});
  const rib = N.buildRibbon(n, {groundAt: ground, waterAt: ()=>null});
  let inside = 0;
  for(let v = 0; v < rib.vertexCount; v++){ const x = rib.position[v*3], y = rib.position[v*3+1], z = rib.position[v*3+2]; if(ground(x,z) > y + 0.01) inside++; }
  check('wall: no ribbon vertex inside the jutting rock', inside === 0, 'inside '+inside+' of '+rib.vertexCount);
}
// 9. a deep slow pool whose wet texels reach the cliff top (a per-texel field overhanging the
//    ramp): the step that leaves the lip must not count as a sliding plunge into it
{
  const ground = (x,z) => z < 0 ? 10 : 0;
  const water = (x,z) => z < -0.05 ? {level: 10.3, depth: 0.3, vx:0, vz:1.5} : {level: 3, depth: 3, vx:0, vz:0.1};
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:4, discharge:2, drop:10}], {groundAt: ground, waterAt: water});
  console.log(summarize(n));
  check('lip pool: the fall is traced, not skipped', n.samples.filter(s=>s.air).length > 20 && n.rows.some(r=>r.fallFlag>0.5), 'airSteps '+n.samples.filter(s=>s.air).length);
  check('lip pool: plunges after really falling', n.plunge && n.plunge.vy < -8, n.plunge && 'vy '+f2(n.plunge.vy));
}
// 10. a rock jutting into one side of the fall BELOW the lip, open air under it: the strands
//     over it land on it and pour off its edge, the rest fall past it, and no part of the
//     sheet passes through the rock or comes out of its face
{
  const jut = (x,z) => x > 1.0 && z > 0.2 && z < 1.2;
  const ground = (x,z) => jut(x,z) ? 9.5 : (z < 0 ? 10 : 0);
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:6, discharge:5, drop:10}], {groundAt: ground, waterAt: ()=>null});
  const rib = N.buildRibbon(n, {groundAt: ground, waterAt: ()=>null});
  const onJut = n.strands.filter(st => st && st.impacts.some(im => jut(im.x, im.z)));
  check('jut: the strands over it land on it', onJut.length >= 2, 'strands '+onJut.length);
  check('jut: no vertex inside the rock', verticesInside(rib, ground) === 0, 'inside '+verticesInside(rib, ground));
  check('jut: no triangle through the rock', trianglesInside(rib, ground) === 0, 'inside '+trianglesInside(rib, ground)+' of '+rib.index.length/3);
}
// 11. a 3.75 m creek leaving a lip over a wide lake: the sheet must not flare to the lake's width
{
  const ground = (x,z) => z < 0 ? 10 + (Math.abs(x) > 1.875 ? 1 : 0) : 0;
  const water = (x,z) => z < 0 ? (Math.abs(x) <= 1.875 ? {level: 10.3, depth: 0.3, vx:0, vz:1.5} : null) : (z < 0.3 ? null : {level: 3, depth: 3, vx:0, vz:0.05});
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:14, discharge:3, drop:10}], {groundAt: ground, waterAt: water});
  const rib = N.buildRibbon(n, {groundAt: ground, waterAt: water});
  let xMax = 0;
  for(let v = 0; v < rib.vertexCount; v++) if(rib.flowB[v*4+1] > 0.01) xMax = Math.max(xMax, Math.abs(rib.position[v*3]));
  check('lake: no flare past the creek', xMax < 1.875 + 0.5, 'max |x| '+f2(xMax)+' lip '+f2(n.width));
}
// 12. a supercritical run-out of 8 cm steps below a real fall: the hops must not be impacts
{
  const ground = (x,z) => z < 0 ? 10 : (z < 3 ? 0 : -0.08*Math.floor(z-2));
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:4, discharge:4, drop:10}], {groundAt: ground, waterAt: ()=>null});
  const small = n.impacts.filter(i => i.z > 3.2);
  check('hops: only the real landing is an impact', n.impacts.length >= 1 && small.length === 0, n.impacts.map(i=>`z${f2(i.z)} w${f2(i.w)}`).join(' '));
}
// 13. falls-lab A (Phase 6b): an 18 m sheer ledge into a 2.5 m deep lake. The splash emits from
//     the impacts, so the landing must be a real, fast plunge into the lake, not a slide.
{
  const ground = (x,z) => z < 0 ? 42.3 : 21.8;
  const water = (x,z) => z < -0.05 ? {level: 42.55, depth: 0.25, vx:0, vz:1.3} : {level: 24.3, depth: 2.5, vx:0, vz:0.1};
  const n = N.trace([{top:[0,42.3,-0.5], bottom:[0,24.3,0.5], width:12, discharge:9.1, drop:18}], {groundAt: ground, waterAt: water});
  console.log(summarize(n));
  const land = n.impacts.length ? n.impacts[n.impacts.length - 1] : null;
  check('plunge lake: plunges into the lake', !!n.plunge && n.plunge.vy < -15, n.plunge && 'vy '+f2(n.plunge.vy));
  check('plunge lake: lands 0.3..4 m out from the lip', n.plunge && n.plunge.z > 0.3 && n.plunge.z < 4, n.plunge && 'z '+f2(n.plunge.z));
  check('plunge lake: the landing is an impact at the lake surface, weighted as a real fall',
    land && Math.abs(land.y - 24.3) < 0.5 && land.vn > 15 && (land.w === undefined || land.w > 0.5),
    land && `y ${f2(land.y)} vn ${f2(land.vn)} w ${land.w !== undefined ? f2(land.w) : '-'}`);
}
// 14. a still pool behind a 0.4 m sill at the lip (what a carve can leave, falls-lab E 2026-09-23):
//     the creek still carries its discharge over the edge, so the trace must reach it and fall,
//     not brake to a stop in the pool.
{
  //The sill ramps up 0.4 m over the last metre before the lip, like E's (0.5 m over ~1 m).
  const ground = (x,z) => z >= 0 ? 0 : 10 + 0.4 * Math.min(Math.max((z + 1.4) / 1.0, 0), 1);
  const water = (x,z) => z < -1.4 ? {level: 10.5, depth: 0.5, vx: 0, vz: 0} : (z < 0 ? {level: ground(x,z) + 0.1, depth: 0.1, vx: 0, vz: 1.0} : null);
  const n = N.trace([{top:[0,10.4,-0.3], bottom:[0,0,0.7], width:6, discharge:5, drop:10}], {groundAt: ground, waterAt: water});
  console.log(summarize(n));
  check('sill pool: the fall is traced over the sill', n.samples.filter(s=>s.air).length > 20 && n.stop !== 'stopped' && n.stop !== 'stall' && n.stop !== 'climb', 'stop '+n.stop+' airSteps '+n.samples.filter(s=>s.air).length);
}
// 15. THE SKIRT (2026-09-22): a straight lip over a pool, a 5 m creek between banks. One strand
//     per 0.5 m, every one falls, the lip row is one straight line across the creek, the weave
//     has no tears, and the foot's impacts cover the width and carry the whole discharge.
{
  const ground = (x,z) => z < 0 ? 10 + (Math.abs(x) > 2.5 ? 1 : 0) : 0;
  const water = (x,z) => z < 0 ? (Math.abs(x) <= 2.5 ? {level: 10.3, depth: 0.3, vx: 0, vz: 1.5} : null) : (z > 0.3 ? {level: 3, depth: 3, vx: 0, vz: 0.05} : null);
  const env = {groundAt: ground, waterAt: water};
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:14, discharge:3, drop:10}], env);
  const rib = N.buildRibbon(n, env);
  const falling = n.strands.filter(st => st && st.rows.some(r => r.fallFlag > 0.5));
  check('skirt: 11 strands over the 5 m creek, all fall', n.strands.length === 11 && falling.length === 11, 'strands '+n.strands.length+' falling '+falling.length);
  const lip = lipRow(n), zs = lip.map(r => r.z), xs = lip.map(r => r.x);
  check('skirt: the lip row is one straight line across', Math.max(...zs) - Math.min(...zs) < 0.1, 'z spread '+f2(Math.max(...zs) - Math.min(...zs)));
  check('skirt: the lip row spans the creek', Math.abs(Math.max(...xs) - Math.min(...xs) - 5.0) < 0.6, 'span '+f2(Math.max(...xs) - Math.min(...xs)));
  const full = fullQuads(n);
  check('skirt: no tears over a plain pool', rib.index.length / 6 >= 0.9 * full, 'quads '+rib.index.length/6+' of '+full);
  const plunges = n.impacts.filter(im => im.y > 2.5 && im.y < 3.5);
  const wSum = plunges.reduce((s, im) => s + im.width, 0), qSum = n.impacts.reduce((s, im) => s + im.discharge, 0);
  check('skirt: the plunge is a line of impacts across the width', plunges.length >= 2 && Math.abs(wSum - 5.0) < 1.5, 'clusters '+plunges.length+' width '+f2(wSum));
  check('skirt: the impacts carry the discharge (each strand lands once)', Math.abs(qSum - n.discharge) < 0.05 * n.discharge, 'Σ '+f2(qSum)+' of '+f2(n.discharge));
}
// 16. a CURVED lip (the brink bows downstream toward the banks, z = 0.15·x²): each strand
//     leaves the ground at the true edge in front of it, and the sheet's lip row follows it.
{
  const edge = x => 0.15 * x * x;
  const ground = (x,z) => z < edge(x) ? 10 : 0;
  const water = (x,z) => (z < edge(x) && Math.abs(x) <= 2.5) ? {level: 10.3, depth: 0.3, vx: 0, vz: 1.5} : null;
  const env = {groundAt: ground, waterAt: water};
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:5, discharge:3, drop:10}], env);
  let worst = 0;
  for(const st of n.strands){
    if(!st) continue;
    const i = st.samples.findIndex(s => s.air);
    if(i > 0){ const s = st.samples[i - 1]; worst = Math.max(worst, Math.abs(s.z - edge(s.x))); }
  }
  check('curved lip: every strand takes off at the edge (≤ 0.25 m)', worst <= 0.25, 'worst '+f2(worst));
  //The edges leave later than the middle (0.94 m further to go), and the sheet holds together
  //across that: rows are the water's time, not each strand's own lip.
  const rib = N.buildRibbon(n, env), full = fullQuads(n);
  check('curved lip: the sheet stays whole across the curve', rib.index.length / 6 >= 0.9 * full, 'quads '+rib.index.length/6+' of '+full);
}
// 17. a ROCK standing in the fall (a column a metre out from the lip, taller than it): the strands
//     that hit it lose their speed into its face and fall down it, those beside it fall past,
//     the sheet tears round it, and nothing is drawn on or through it.
{
  const rock = (x,z) => Math.abs(x) < 0.4 && z > 0.8 && z < 1.5;
  const ground = (x,z) => rock(x,z) ? 12 : (z < 0 ? 10 : 0);
  const env = {groundAt: ground, waterAt: () => null};
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:5, discharge:3, drop:10}], env);
  const rib = N.buildRibbon(n, env);
  const hit = n.strands.filter(st => st && st.impacts.some(im => im.ny === 0 && rock(im.x - im.nx * 0.05, im.z - im.nz * 0.05)));
  check('rock: the strands in front of it hit its face', hit.length >= 1, 'strands '+hit.length);
  const yMax = Math.max(...Array.from({length: rib.vertexCount}, (_, v) => rib.position[v*3+1]));
  check('rock: nothing drawn on top of it', yMax < 11, 'max y '+f2(yMax));
  check('rock: no vertex inside it', verticesInside(rib, ground) === 0, 'inside '+verticesInside(rib, ground));
  check('rock: no triangle through it', trianglesInside(rib, ground) === 0, 'inside '+trianglesInside(rib, ground)+' of '+rib.index.length/3);
  //Beside the rock the sheet still falls: strands past |x| 0.75 are unaffected.
  const beside = n.strands.filter(st => st && st.rows.length && Math.abs(st.rows[0].x) > 0.75 && st.rows.some(r => r.fallFlag > 0.5));
  check('rock: the water beside it falls as before', beside.length >= 6, 'strands '+beside.length);
}
// 18. landing on ground that slopes ACROSS the fall (0.4 m per m): each strand lands on the
//     ground under it, so the foot follows the slope. A row rigid across lands at one height
//     and is a metre off at each side of a 5 m sheet.
{
  const ground = (x,z) => z < 0 ? 10 : 0.4 * x;
  const env = {groundAt: ground, waterAt: () => null};
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:5, discharge:3, drop:10}], env);
  const rib = N.buildRibbon(n, env);
  const lands = n.strands.filter(Boolean).map(st => st.impacts[0]).filter(Boolean);
  const off = Math.max(...lands.map(im => Math.abs(im.y - ground(im.x, im.z))));
  const ys = lands.map(im => im.y);
  check('slope: every strand lands on the ground under it', off < 0.7 && lands.length >= 9, 'worst '+f2(off)+' landings '+lands.length);
  check('slope: the foot is not one height (it follows the slope)', Math.max(...ys) - Math.min(...ys) > 1.5, 'spread '+f2(Math.max(...ys) - Math.min(...ys)));
  check('slope: no vertex under the ground', verticesInside(rib, ground) === 0, 'inside '+verticesInside(rib, ground));
}
// 19. WIND on the sheet: 10 m/s blowing downstream bows a 10 m curtain out; the same wind
//     across the fall is edge-on to the sheet and barely moves it; still air changes nothing.
{
  const ground = (x,z) => z < 0 ? 10 : 0;
  const fall = {top:[0,10,-0.5], bottom:[0,0,0.5], width:4, discharge:3, drop:10};
  const land = env => { const n = N.trace([fall], env); return n.strands[n.spine].impacts[0]; };
  const base = land({groundAt: ground, waterAt: () => null});
  const still = land({groundAt: ground, waterAt: () => null, wind: {x: 0, z: 0}});
  const down = land({groundAt: ground, waterAt: () => null, wind: {x: 0, z: 10}});
  const across = land({groundAt: ground, waterAt: () => null, wind: {x: 10, z: 0}});
  check('wind: still air changes nothing', still.z === base.z && still.x === base.x, '');
  check('wind: a downstream wind bows the curtain out 0.2..2.5 m', down.z - base.z > 0.2 && down.z - base.z < 2.5, 'Δz '+f2(down.z - base.z));
  check('wind: a wind along the lip is edge-on (< 0.1 m)', Math.abs(across.x - base.x) < 0.1 && Math.abs(across.z - base.z) < 0.1, 'Δx '+f2(across.x - base.x)+' Δz '+f2(across.z - base.z));
}
// 20. a creek deep in the middle and shallow at the banks: the edge strands carry less and run thinner.
{
  const depth = x => 0.07 + 0.3 * (1 - (x / 2.5) * (x / 2.5));
  const ground = (x,z) => z < 0 ? 10 - depth(Math.min(Math.abs(x), 2.5)) + (Math.abs(x) > 2.5 ? 1 : 0) : 0;
  const water = (x,z) => (z < 0 && Math.abs(x) <= 2.5) ? {level: 10.07, depth: depth(x), vx: 0, vz: 1.2} : null;
  const n = N.trace([{top:[0,10,-0.5], bottom:[0,0,0.5], width:5, discharge:6, drop:10}], {groundAt: ground, waterAt: water});
  const S = n.strands.filter(Boolean), mid = n.strands[n.spine], edgeSt = S[0];
  check('uneven: edge strands carry less than the middle', edgeSt.q < 0.5 * mid.q, 'edge q '+f2(edgeSt.q)+' mid q '+f2(mid.q));
  check('uneven: ...and run thinner', edgeSt.samples[0].h < mid.samples[0].h, 'edge h '+f2(edgeSt.samples[0].h)+' mid h '+f2(mid.samples[0].h));
}
// 21. A CARVED SITE (a-land's fall-site carve, simulation 0.2.0): the ground is one canonical shape
//     and the export says where it is, so the trace discovers nothing. The reach runs 30° off
//     the axes; the entry's own top/bottom/width are D8's (a cell to one side, a diagonal step,
//     4·√Q wide) and must be ignored: heading = the lip normal exactly, the seeds on one line
//     back on the approach as wide as the wet width, no rail, and one straight sheet off the lip.
const siteFrame = (nx, nz) => ({s: (x,z) => x * nx + z * nz, t: (x,z) => x * nz - z * nx,
                                at: (s,t) => [s * nx + t * nz, s * nz - t * nx]});
{
  //the carve's banks blend out past the wet width and the water reaches onto them: the bank
  //stands a metre outside it here (a wall right at the edge seeds pushes them off it)
  const nx = Math.sin(Math.PI / 6), nz = Math.cos(Math.PI / 6), F = siteFrame(nx, nz), hw = 4;
  const ground = (x,z) => F.s(x,z) < 0 ? 10 + (Math.abs(F.t(x,z)) > hw + 1 ? 1 : 0) : 2;
  const water = (x,z) => { const s = F.s(x,z), t = F.t(x,z);
    if(s < 0) return Math.abs(t) <= hw + 1 ? {level: 10.4, depth: 0.4, vx: 1.5 * nx, vz: 1.5 * nz} : null;
    return s > 0.3 ? {level: 4, depth: 2, vx: 0.05 * nx, vz: 0.05 * nz} : null; };
  const env = {groundAt: ground, waterAt: water};
  const L0 = F.at(0, -hw), L1 = F.at(0, hw), top = F.at(-0.5, 1.5), bot = F.at(0.5, 2.5);
  const fall = {top: [top[0], 10, top[1]], bottom: [bot[0] + 0.7, 2, bot[1]], width: 14, discharge: 9, drop: 8,
                site: {lip: [[L0[0], 10, L0[1]], [L1[0], 10, L1[1]]], normal: [nx, nz], drop: 8, treadAbove: 10, treadBelow: 2,
                       approach: 3, landing: 2, wetWidth: 2 * hw, depth: 0.4, discharge: 4.8,
                       pool: {centre: [0, 4, 0], radius: 4, depth: 2.4, kind: 'dug'}, cascade: 0, step: 0, steps: 1}};
  const job = N.beginTrace([fall], env);
  check('site: heading is the lip normal exactly', Math.abs(job.hx - nx) < 1e-9 && Math.abs(job.hz - nz) < 1e-9, 'h '+job.hx.toFixed(4)+','+job.hz.toFixed(4));
  const seeds = job.seeds.filter(Boolean), ss = seeds.map(q => F.s(q.x, q.z)), ts = seeds.map(q => F.t(q.x, q.z));
  check('site: the seeds are one line on the approach, railed to a metre short of the lip', Math.abs(job.rail - Math.max(0, job.up - 1)) < 1e-9 && Math.max(...ss.map(v => Math.abs(v + job.up))) < 1e-9,
        'up '+f2(job.up)+' rail '+job.rail);
  check('site: ...as wide as the wet width', Math.abs(Math.max(...ts) - Math.min(...ts) - (2 * hw - 0.5)) < 0.01 && job.W === 2 * hw && job.Q === 4.8,
        'span '+f2(Math.max(...ts) - Math.min(...ts))+' W '+job.W+' Q '+job.Q);
  const n = N.trace([fall], env), rib = N.buildRibbon(n, env);
  const falling = n.strands.filter(st => st && st.rows.some(r => r.fallFlag > 0.5));
  const lip = lipRow(n), ls = lip.map(r => F.s(r.x, r.z));
  check('site: every strand falls, off one straight lip', falling.length === n.strands.length && Math.max(...ls) - Math.min(...ls) < 0.1,
        'falling '+falling.length+'/'+n.strands.length+' lip s spread '+f2(Math.max(...ls) - Math.min(...ls)));
  check('site: the sheet is whole', rib.index.length / 6 >= 0.9 * fullQuads(n), 'quads '+rib.index.length/6+' of '+fullQuads(n));
}
// 22. a carved STAIRCASE: every step is a chain of its own (each lands in its own pool and leaves
//     off its own approach), and each step's trace falls off ITS lip, square to it.
{
  const nx = Math.sin(Math.PI / 6), nz = Math.cos(Math.PI / 6), F = siteFrame(nx, nz), hw = 3;
  const lvl = s => s < 0 ? 20 : (s < 11 ? 14 : (s < 22 ? 8 : 2));
  const ground = (x,z) => lvl(F.s(x,z)) + (Math.abs(F.t(x,z)) > hw ? 1 : 0);
  const water = (x,z) => { const s = F.s(x,z), t = F.t(x,z);
    return Math.abs(t) <= hw ? {level: lvl(s) + 0.4, depth: 0.4, vx: 1.5 * nx, vz: 1.5 * nz} : null; };
  const env = {groundAt: ground, waterAt: water};
  const step = k => { const sL = 11 * k, a = F.at(sL, -hw), b = F.at(sL, hw), tp = F.at(sL - 0.5, 0), bt = F.at(sL + 0.5, 0);
    return {top: [tp[0], lvl(sL - 0.5), tp[1]], bottom: [bt[0], lvl(sL + 0.5), bt[1]], width: 10, discharge: 3, drop: 6,
            site: {lip: [[a[0], lvl(sL - 0.5), a[1]], [b[0], lvl(sL - 0.5), b[1]]], normal: [nx, nz], drop: 6, approach: k ? 11 : 3,
                   landing: 2, wetWidth: 2 * hw, discharge: 3, pool: {centre: [0, 0, 0], radius: 3, depth: 1.8, kind: 'dug'},
                   cascade: 7, step: k, steps: 3}}; };
  const other = {top: [500, 5, 500], bottom: [500, 1, 501], width: 4, discharge: 1, drop: 4};
  const chains = N.chains([step(2), other, step(0), step(1)]);
  const sited = chains.filter(ch => ch[0].site);
  check('staircase: every carved step is its own chain', chains.length === 4 && sited.length === 3 && sited.every(ch => ch.length === 1),
        chains.map(ch => ch.map(f => f.site ? f.site.step : 'x').join('')).join(' | '));
  const naps = sited.map(ch => N.trace(ch, env));
  const falls = naps.map(nap => nap.strands.filter(st => st && st.rows.some(r => r.fallFlag > 0.5)).length);
  const leads = naps.map(nap => nap.corridors.find(b => b.lead > 0.05)).map(b => b ? ((b.bx - b.ax) * nx + (b.bz - b.az) * nz) / Math.hypot(b.bx - b.ax, b.bz - b.az) : 0);
  check('staircase: every step draws its own falling sheet, square to its lip', falls.every(f => f > 0) && leads.every(d => d > 0.999),
        'falling '+falls.join(',')+' leads '+leads.map(f2).join(' '));
}
// 5. island-sholes chains (only when the sibling project is checked out)
{
  const p = new URL('../../../a-faraway-project/island-sholes/map.json', import.meta.url);
  if(fs.existsSync(p)){
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    const c = N.chains(m.simulation.waterfalls);
    console.log('island-sholes chains:', c.map(ch=>ch.length+'@'+ch[0].top.map(v=>v.toFixed(0)).join(',')).join(' | '));
  }
}
process.exit(fails?1:0);
