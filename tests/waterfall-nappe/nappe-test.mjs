//Node checks for ARestlessOcean.WaterfallNappe (Phase 6): synthetic terrain with known
//answers — a hero-creek-like step, a 45° chute, a 10 m vertical drop, a four-step staircase
//cascade, a chute into a dry bowl, and an over-wide export over a narrow wet channel.
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
  //The chute itself is the creek's own surface: the sheet draws only the short flight off the
  //sharp top edge (a 2 m/s parabola meets a 45° face ~0.8 m out), nothing down the slope.
  //Past the flight and its 3 m landing tail (attached rows the material draws only where the
  //creek does not), nothing down the slope.
  const onChute = n.rows.filter(r => r.z > 4.5 && r.z < 9 && r.presence > 0.01);
  const maxZ = n.rows.length ? Math.max(...n.rows.filter(r=>r.presence>0.01).map(r=>r.z)) : 0;
  check('chute: no sheet down the chute past the landing tail', onChute.length === 0 && maxZ < 4.5, 'sheet ends z '+maxZ.toFixed(2));
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
