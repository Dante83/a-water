//Node checks for the closed-form swash high water (ShoreBreaker.evaluateSwashHighWater, the
//CPU twin of shoreSwashHighWater; SwashSurfacePass reads it for a-land's wet sand). It must be
//what the old ping-pong memory converged to: g ← max(eta, g − dryRate·dt), stepped every frame
//from long ago. Checked up a 1:20 beach, at several moments, and at a dryRate of zero.
//Run: node tests/shore/swash-high-water-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {};
globalThis.THREE = { Vector2: class { constructor(x, y){ this.x = x; this.y = y; } }, Vector3: class { constructor(){ this.x = 0; this.y = 0; this.z = 0; } } };
vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/luts/ocean-wave-field.js', import.meta.url), 'utf8'));
const SB = ARestlessOcean.ShoreBreaker;
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + '  ' + (info || '')); if(!ok) fails++; };

const T = 9.0;
const params = t => ({enabled: true, time: t, Hs: 1.6, omega: 2 * Math.PI / T, waveDirX: -1, waveDirZ: 0,
  seaLevel: 0, depthCap: 40, foamGain: 1, heightScale: 1});
//A 1:20 beach: the shore normal points seaward (+x), the waves come in head on.
const probe = {level: 0, depth: 0.05 * SB.SWASH_PROBE, shoreSDF: SB.SWASH_PROBE, dryMask: 0, flowWeight: 0};
const fieldAt = d => ({level: 0, depth: 0, shoreSDF: -d, dryMask: 1, flowWeight: 0});
const eta = (x, z, d, t) => SB.evaluateSwash(x, z, fieldAt(d), 1, 0, params(t), {}, probe, probe).eta;
const closed = (x, z, d, t, rate) => SB.evaluateSwashHighWater(x, z, fieldAt(d), 1, 0, params(t), rate, probe, probe);
//What SwashSurfacePass writes to g: the higher of the live sheet and the memory.
const high = (x, z, d, t, rate) => Math.max(eta(x, z, d, t), closed(x, z, d, t, rate));

//The ping-pong, stepped at 60 Hz from `from` to each of `times`.
function simulate(x, z, d, rate, from, times){
  const dt = 1 / 60;
  let g = -1e6, t = from;
  const out = [];
  for(const tEnd of times){
    for(; t < tEnd; t += dt) g = Math.max(eta(x, z, d, t), g - rate * dt);
    out.push(g);
  }
  return out;
}

//── 1. Up the beach, at a few moments, the closed form tracks the simulated memory. The two
//   can differ by the phase noise drift over the memory (past peaks are timed with today's
//   noise) and by the 60 Hz sampling of each peak: a few centimetres at most.
const rate = 0.01;
const times = [1000, 1003.3, 1011.7, 1027.2, 1040];
let worst = 0, n = 0, worstAt = '';
for(const d of [0.5, 2, 4, 7, 10, 14]){
  for(const [x, z] of [[0, 0], [37, 113], [-260, 41]]){
    const sim = simulate(x, z, d, rate, times[0] - 400, times);
    times.forEach((t, i) => {
      const c = high(x, z, d, t, rate);
      const e = Math.abs(c - sim[i]);
      n++;
      if(e > worst){ worst = e; worstAt = 'd=' + d + ' x=' + x + ' t=' + t + ' sim=' + sim[i].toFixed(3) + ' closed=' + c.toFixed(3); }
    });
  }
}
check('closed form tracks the ping-pong (dryRate 0.01)', n > 0 && worst < 0.05, n + ' samples, worst ' + worst.toFixed(3) + ' m at ' + worstAt);

//── 2. The memory never sits below the live sheet's own peak run-up for this wave, and never
//   above the largest possible peak.
{
  let bad = 0;
  for(let t = 500; t < 560; t += 0.7){
    const o = SB.evaluateSwash(0, 0, fieldAt(3), 1, 0, params(t), {}, probe, probe);
    const c = closed(0, 0, 3, t, rate);
    if(c > o.peak * SB.WAVE_FACTOR_MAX + 1e-9) bad++;
  }
  check('never above the largest peak', bad === 0, bad + ' bad');
}

//── 3. No drying: the memory is the best peak of the last 64 waves, so it sits near the top.
{
  const c = closed(0, 0, 3, 1000, 0.0);
  const o = SB.evaluateSwash(0, 0, fieldAt(3), 1, 0, params(1000), {}, probe, probe);
  check('dryRate 0 holds a high peak', c > 0.75 * o.peak * SB.WAVE_FACTOR_MAX, 'c=' + c.toFixed(3) + ' max=' + (o.peak * SB.WAVE_FACTOR_MAX).toFixed(3));
}

//── 4. Faster drying, lower memory (on average over moments).
{
  let slow = 0, fast = 0;
  for(let t = 800; t < 900; t += 1.3){ slow += closed(0, 0, 3, t, 0.005); fast += closed(0, 0, 3, t, 0.05); }
  check('faster drying holds less', fast < slow, 'slow ' + slow.toFixed(2) + ' fast ' + fast.toFixed(2));
}

console.log(fails ? '\n' + fails + ' failed' : '\nall passed');
process.exit(fails ? 1 : 0);
