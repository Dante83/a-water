//Node checks for the shore pass (2026-09-30, step C): the breaker never puts its trough
//under the bed, swash foam is continuous through the uprush/backwash turn and leaves a
//residue on the drain, the steep-shore foam cut keeps a collar, and the GLSL carries the
//same constants as the JS mirror.
//Run: node tests/shore/shore-breaker-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {};
globalThis.THREE = { Vector2: class { constructor(x, y){ this.x = x; this.y = y; } }, Vector3: class { constructor(){ this.x = 0; this.y = 0; this.z = 0; } } };
const load = p => vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/' + p, import.meta.url), 'utf8'));
load('luts/ocean-wave-field.js');
const SB = ARestlessOcean.ShoreBreaker;
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + '  ' + (info || '')); if(!ok) fails++; };

const params = t => ({enabled: true, time: t, Hs: 1.6, omega: 2 * Math.PI / 9, waveDirX: 0, waveDirZ: -1,
  seaLevel: 0, depthCap: 40, foamGain: 1, heightScale: 1});

//── 1. Troughs keep BED_FILM of water over the bed.
{
  let worst = Infinity, n = 0, troughs = 0;
  for(let t = 0; t < 30; t += 0.37){
    for(let h = 0.02; h < 3.0; h += 0.07){
      const s = h / 0.05;   //a 1:20 beach
      const field = {level: 0, depth: h, shoreSDF: s, dryMask: 0, flowWeight: 0};
      const out = SB.evaluate(3.0, -s, field, 0, 1, params(t), {}, field, 0, 0.05);
      if(out.W < 0.01) continue;
      n++;
      if(out.eta < 0) troughs++;
      worst = Math.min(worst, out.eta + Math.max(h - SB.BED_FILM, 0.0));
    }
  }
  check('breaker trough never below bed + film', worst >= -1e-9, 'samples ' + n + ', troughs ' + troughs + ', min margin ' + worst.toFixed(4) + ' m');
  check('breaker still has troughs (not flattened)', troughs > n * 0.2, troughs + '/' + n);
}

//── 2. Swash foam: continuous at the turn, residue on the drain, zero at the end.
{
  const p0 = params(0);
  const w = p0.omega;
  const field = {level: 0, depth: 0.2, shoreSDF: 2.0, dryMask: 0, flowWeight: 0};
  const probe = {level: 0, depth: 6 * 0.08, shoreSDF: 6.0};
  const foamAt = d => {
    //Solve time for shoreline phase d (the noise term shifts theta; search a window).
    const out = SB.evaluateSwash(10, 0, field, 0, 1, Object.assign({}, p0, {time: d}), {}, field, probe);
    return out;
  };
  //Sample finely over two periods and look for jumps other than the bore arrival (0 -> 1).
  let prev = null, maxJump = 0, bigJumps = 0, sawResidue = false;
  const T = 2 * Math.PI / w;
  for(let t = 0; t < 2 * T; t += T / 2000){
    const o = foamAt(t);
    if(prev !== null){
      const j = o.foam - prev;
      if(Math.abs(j) > 0.05){ if(j > 0) bigJumps++; else maxJump = Math.max(maxJump, -j); }
    }
    if(o.foam > 0.02 && o.foam < SB.BACKWASH_FOAM * 0.9 + 0.02) sawResidue = true;
    prev = o.foam;
  }
  check('swash foam has no downward jump (turn is continuous)', maxJump <= 0.05, 'largest drop ' + maxJump.toFixed(3));
  check('swash foam jumps up only at bore arrivals', bigJumps <= 3, bigJumps + ' upward jumps in 2 periods');
  check('backwash leaves a thinning residue', sawResidue);
}

//── 3. Steep shore keeps a foam collar.
{
  let foamSteep = 0;
  for(let t = 0; t < 20; t += 0.05){
    const h = 0.6, s = h / 0.4;
    const field = {level: 0, depth: h, shoreSDF: s, dryMask: 0, flowWeight: 0};
    const out = SB.evaluate(0, -s, field, 0, 1, params(t), {}, field, 0, 0.4);
    foamSteep = Math.max(foamSteep, out.foam);
  }
  check('steep (1:2.5) shore still foams', foamSteep > 0.2, 'peak foam ' + foamSteep.toFixed(3));
}

//── 4. GLSL carries the JS constants (the four GPU consumers splice this string).
{
  const g = SB.GLSL;
  const f = v => (+v).toFixed(6);
  check('GLSL has BED_FILM clamp', g.includes('-max(h - ' + f(SB.BED_FILM) + ', 0.0)'));
  check('GLSL has SURGE_FOAM_CUT', g.includes(f(SB.SURGE_FOAM_CUT) + ' * Kr * Kr'));
  check('GLSL has BACKWASH_FOAM', g.includes(f(SB.BACKWASH_FOAM) + ' * pow('));
  check('GLSL has the slope fade', g.includes(f(SB.SWASH_SLOPE_FADE_LO)) && g.includes(f(SB.SWASH_SLOPE_FADE_HI)));
}

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
