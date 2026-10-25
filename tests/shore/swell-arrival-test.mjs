//Node checks for the swell arrival field (2026-10-24): a JS reference of SwellArrivalPass's
//seed / Godunov relax / finish, run on small synthetic grids, plus the breaker reading it.
//  1. a plane wave refracting over a straight depth step obeys Snell's law (crests straight)
//  2. a round island: fronts wrap it, E is high on the weather side and low in the lee
//  3. a channel across the wave direction fills from its MOUTH (∇τ runs along it)
//  4. a pond below sea level, ringed by land, is never reached and gets no surf
//  5. a shallow bar caps the height in the lagoon behind it (Hlim)
//  6. the GLSL carries the swell uniforms and gates
//Run: node tests/shore/swell-arrival-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {};
globalThis.THREE = { Vector2: class { constructor(x, y){ this.x = x; this.y = y; } }, Vector3: class { constructor(){ this.x = 0; this.y = 0; this.z = 0; } } };
const load = p => vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/' + p, import.meta.url), 'utf8'));
load('luts/ocean-wave-field.js');
const SB = ARestlessOcean.ShoreBreaker;
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + '  ' + (info || '')); if(!ok) fails++; };

const INF = 1e9;
//Reference solver. depth[i + j*N] (m, <= 0 dry), all water at sea level.
function solve(N, texel, depth, dir, omega, Hs, opts){
  opts = opts || {};
  const g = SB.G, k0 = omega * omega / g;
  const seedDepth = Math.min(40, Math.max(6, 1.5 / k0));
  const deepC = g / omega;
  const at = (i, j) => depth[i + j * N];
  const inside = (i, j) => i >= 0 && j >= 0 && i < N && j < N;
  //Static: the shadow march, cascade 1 only (8 m taps, off-grid = open).
  const passable = new Uint8Array(N * N), seed = new Uint8Array(N * N);
  for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){
    const h = at(i, j);
    if(!(h > 0)) continue;
    passable[i + j * N] = 1;
    const rim = (i === 0 && dir[0] > 0.1) || (i === N - 1 && dir[0] < -0.1) || (j === 0 && dir[1] > 0.1) || (j === N - 1 && dir[1] < -0.1);
    if(!(h >= seedDepth || rim)) continue;
    let shadow = false;
    for(let k = 1; k <= 32; k++){
      const x = (i + 0.5) * texel - dir[0] * 8 * k, z = (j + 0.5) * texel - dir[1] * 8 * k;
      const qi = Math.floor(x / texel), qj = Math.floor(z / texel);
      if(!inside(qi, qj)) break;
      if(!(at(qi, qj) > 0)){ shadow = true; break; }
    }
    seed[i + j * N] = shadow ? 0 : (h >= seedDepth ? 1 : 2);
  }
  //Rim seeds only when there is no deep seed at all (the GPU's max reduction).
  const hasDeep = seed.some(v => v === 1);
  for(let n = 0; n < N * N; n++) seed[n] = (seed[n] === 1 || (!hasDeep && seed[n] === 2)) ? 1 : 0;
  const speed = h => { h = Math.max(h, SB.MIN_DEPTH); const X = k0 * h; return omega * h * Math.sqrt(Math.tanh(X)) / X; };
  let S = new Float32Array(N * N * 4), T = new Float32Array(N * N * 4);
  for(let n = 0; n < N * N; n++){
    if(seed[n]){ S[4 * n] = 0; S[4 * n + 1] = 1e4; S[4 * n + 2] = 1; S[4 * n + 3] = 0; }
    else { S[4 * n] = INF; }
  }
  const offX = texel * dir[0] / deepC, offZ = texel * dir[1] / deepC;
  const Hb = Hs / SB.GAMMA;
  const iters = opts.iters || 768;
  for(let it = 0; it < iters; it++){
    for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){
      const n = i + j * N, o = 4 * n;
      if(seed[n]){ T[o] = 0; T[o + 1] = 1e4; T[o + 2] = 1; T[o + 3] = 0; continue; }
      if(!passable[n]){ T[o] = INF; T[o + 1] = T[o + 2] = T[o + 3] = 0; continue; }
      const nb = (qi, qj, off) => {
        if(!inside(qi, qj) || !passable[qi + qj * N]) return [INF, null];
        const q = 4 * (qi + qj * N);
        return [S[q] < 0.5 * INF ? S[q] + off : INF, q];
      };
      const [tL, qL] = nb(i - 1, j, -offX), [tR, qR] = nb(i + 1, j, offX);
      const [tD, qD] = nb(i, j - 1, -offZ), [tU, qU] = nb(i, j + 1, offZ);
      const fromL = tL <= tR, fromD = tD <= tU;
      const a = Math.min(tL, tR), b = Math.min(tD, tU);
      const qa = fromL ? qL : qR, qb = fromD ? qD : qU;
      if(Math.min(a, b) >= 0.5 * INF){ T[o] = INF; T[o + 1] = T[o + 2] = T[o + 3] = 0; continue; }
      const h = at(i, j), nd = texel / speed(h);
      let t, wa, wb;
      if(Math.abs(a - b) >= nd){ if(a < b){ t = a + nd; wa = 1; wb = 0; } else { t = b + nd; wa = 0; wb = 1; } }
      else { t = 0.5 * (a + b + Math.sqrt(2 * nd * nd - (a - b) * (a - b))); wa = t - a; wb = t - b; const ws = wa + wb; wa /= ws; wb /= ws; }
      const gx = wa > 0 ? (t - a) * (fromL ? 1 : -1) : 0, gz = wb > 0 ? (t - b) * (fromD ? 1 : -1) : 0;
      const gl = Math.hypot(gx, gz);
      const dx = gl > 0 ? gx / gl : dir[0], dz = gl > 0 ? gz / gl : dir[1];
      const alpha = Math.acos(Math.min(1, Math.max(-1, dx * dir[0] + dz * dir[1])));
      const fa = Math.min(1, Math.max(0, 1 - alpha / Math.PI + Math.sin(2 * alpha) / (2 * Math.PI)));
      const hSrc = (wa > 0 && wb > 0) ? Math.min(S[qa + 1], S[qb + 1]) : (wa > 0 ? S[qa + 1] : S[qb + 1]);
      T[o] = t;
      T[o + 1] = Math.min(hSrc, SB.GAMMA * Math.max(h, SB.MIN_DEPTH));
      T[o + 2] = fa * fa;
      T[o + 3] = (wa > 0 ? wa * S[qa + 3] : 0) + (wb > 0 ? wb * S[qb + 3] : 0) + (h < Hb ? texel : 0);
    }
    const tmp = S; S = T; T = tmp;
  }
  const reached = n => passable[n] && S[4 * n] < 0.5 * INF;
  const tau = (i, j) => S[4 * (i + j * N)] + ((i + 0.5) * texel * dir[0] + (j + 0.5) * texel * dir[1]) / deepC;
  return {S, passable, seed, reached, tau, deepC, at: (i, j) => S.subarray(4 * (i + j * N), 4 * (i + j * N) + 4)};
}

const omega = 2 * Math.PI / 9, Hs = 1.6;

//── 1. Snell: deep (60 m) for x < 40 texels, then a 4 m shelf. dir 30° off +x.
{
  const N = 120, texel = 4, depth = new Float32Array(N * N);
  for(let j = 0; j < N; j++) for(let i = 0; i < N; i++) depth[i + j * N] = i < 40 ? 60 : 4;
  const th = 30 * Math.PI / 180, dir = [Math.cos(th), Math.sin(th)];
  const r = solve(N, texel, depth, dir, omega, Hs, {iters: 400});
  //Crest normal on the shelf from the τ gradient (central differences, away from edges).
  const i = 90, j = 60;
  const gx = (r.tau(i + 1, j) - r.tau(i - 1, j)) / (2 * texel), gz = (r.tau(i, j + 1) - r.tau(i, j - 1)) / (2 * texel);
  const thShelf = Math.atan2(gz, gx);
  const k0 = omega * omega / SB.G, c = h => { const X = k0 * h; return omega * h * Math.sqrt(Math.tanh(X)) / X; };
  const thSnell = Math.asin(Math.sin(th) * c(4) / c(60));
  const err = Math.abs(thShelf - thSnell) * 180 / Math.PI;
  check('Snell refraction on a straight shelf', err < 1.0, 'got ' + (thShelf * 180 / Math.PI).toFixed(2) + '°, Snell ' + (thSnell * 180 / Math.PI).toFixed(2) + '°');
  //Crests straight: the direction is the same along the shelf.
  const g2x = (r.tau(i + 1, 30) - r.tau(i - 1, 30)) / 8, g2z = (r.tau(i, 31) - r.tau(i, 29)) / 8;
  const dAng = Math.abs(Math.atan2(g2z, g2x) - thShelf) * 180 / Math.PI;
  check('crests stay straight along the shelf', dAng < 0.5, dAng.toFixed(3) + '° apart');
}

//── 2. A round island (r = 15 texels) on a sloping shoal in 30 m water; dir +x.
let island;
{
  const N = 140, texel = 4, depth = new Float32Array(N * N);
  const cx = 70, cz = 70;
  for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){
    const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz);
    depth[i + j * N] = d < 15 ? -1 : Math.min(30, (d - 15) * 0.5);
  }
  const r = island = solve(N, texel, depth, [1, 0], omega, Hs);
  const Ew = r.at(cx - 17, cz)[2], El = r.at(cx + 17, cz)[2], Es = r.at(cx, cz + 17)[2];
  check('island: weather side fully exposed', Ew > 0.9, 'E ' + Ew.toFixed(3));
  check('island: lee side reached (fronts wrap it)', r.reached((cx + 17) + cz * N), '');
  check('island: lee side weak', El < 0.2, 'E ' + El.toFixed(3));
  check('island: flank in between', Es > El && Es < Ew, 'E ' + Es.toFixed(3));
}

//── 3. A channel 5 texels wide along +x, open to the sea at x = 0, wave direction +z (across it).
{
  const N = 100, texel = 4, depth = new Float32Array(N * N);
  for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){
    const inChannel = j >= 48 && j < 53;
    depth[i + j * N] = i < 10 ? 30 : (inChannel ? 2 : -2);
  }
  const r = solve(N, texel, depth, [0, 1], omega, Hs);
  let along = 0, n = 0;
  for(let i = 30; i < 80; i += 5){
    const j = 50;
    const gx = (r.tau(i + 1, j) - r.tau(i - 1, j)), gz = (r.tau(i, j + 1) - r.tau(i, j - 1));
    n++; if(Math.abs(gx) > 3 * Math.abs(gz) && gx > 0) along++;
  }
  check('channel: fronts run up it from the mouth', along === n, along + '/' + n + ' samples along +x');
}

//── 4. A pond 6 m deep inside an island: never reached; the breaker reads E = 0 and stays flat.
{
  const N = 100, texel = 4, depth = new Float32Array(N * N);
  for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){
    const d = Math.hypot(i + 0.5 - 50, j + 0.5 - 50);
    depth[i + j * N] = d < 8 ? 6 : (d < 25 ? -3 : 30);
  }
  const r = solve(N, texel, depth, [1, 0], omega, Hs);
  let any = false;
  for(let j = 42; j < 58; j++) for(let i = 42; i < 58; i++) if(r.reached(i + j * N)) any = true;
  check('pond inside land is never reached', !any, '');
  const field = {level: 0, depth: 0.8, shoreSDF: 3, dryMask: 0, flowWeight: 0};
  const p = {enabled: true, time: 3.3, Hs: Hs, omega: omega, waveDirX: 1, waveDirZ: 0, seaLevel: 0, depthCap: 40, foamGain: 1, heightScale: 1};
  const o = SB.evaluate(0, 0, field, 1, 0, p, {}, field, 0, 0.1, {tau: 0, Hlim: 0, E: 0, surf: 0, gradX: 0, gradZ: 0});
  check('breaker is flat where the swell never arrives', o.eta === 0 && o.foam === 0 && o.W === 0, '');
}

//── 5. A bar: deep, a 0.4 m bar 10 texels wide, then a 3 m lagoon.
{
  const N = 100, texel = 4, depth = new Float32Array(N * N);
  for(let j = 0; j < N; j++) for(let i = 0; i < N; i++) depth[i + j * N] = i < 20 ? 30 : (i < 30 ? 0.4 : 3);
  const r = solve(N, texel, depth, [1, 0], omega, Hs);
  const lag = r.at(60, 50);
  check('bar caps the lagoon height', Math.abs(lag[1] - SB.GAMMA * 0.4) < 1e-3, 'Hlim ' + lag[1].toFixed(3));
  check('surf distance counts the bar', lag[3] >= 10 * texel - 1e-3 && lag[3] <= 10 * texel + 1e-3, 'surf ' + lag[3].toFixed(1) + ' m');
}

//── 6. The breaker with a swell sample: phase from τ, height from E, Hlim, surf.
{
  const field = {level: 0, depth: 1.2, shoreSDF: 20, dryMask: 0, flowWeight: 0};
  const p = {enabled: true, time: 0, Hs: Hs, omega: omega, waveDirX: 1, waveDirZ: 0, seaLevel: 0, depthCap: 40, foamGain: 1, heightScale: 1};
  const k0 = omega * omega / SB.G, X = k0 * 1.2, c = omega * 1.2 * Math.sqrt(Math.tanh(X)) / X;
  const sw = tau => ({tau: tau, Hlim: 1e4, E: 1, surf: 0, gradX: 1 / c, gradZ: 0});
  const a = SB.evaluate(0, 0, field, 1, 0, Object.assign({}, p, {time: 5}), {}, field, 0, 0, sw(2));
  const noise = SB.PHASE_NOISE_AMP * (SB.noise(5 * 0.004, 5 * 0.0028) - 0.5);
  check('phase is ω(t − τ) (+ the phase noise)', Math.abs(a.theta - (omega * 3 + noise)) < 1e-9 && a.W > 0.1, 'θ ' + a.theta.toFixed(4));
  const half = SB.evaluate(0, 0, field, 1, 0, Object.assign({}, p, {time: 5}), {}, field, 0, 0, Object.assign(sw(2), {Hlim: 0.2}));
  check('Hlim caps the wave height', Math.abs(half.H - 0.2) < 1e-9, 'H ' + half.H.toFixed(3));
  const decayed = SB.evaluate(0, 0, field, 1, 0, Object.assign({}, p, {time: 5}), {}, field, 0, 0, Object.assign(sw(2), {Hlim: 0.2, surf: SB.SURF_DECAY_M}));
  check('surf distance decays the wave', Math.abs(decayed.H - 0.2 / Math.E) < 1e-9, 'H ' + decayed.H.toFixed(3));
  const crease = SB.evaluate(0, 0, field, 1, 0, Object.assign({}, p, {time: 5}), {}, field, 0, 0, Object.assign(sw(2), {gradX: 0.1 / c}));
  check('a crease (short ∇τ) fades the breaker', crease.W === 0, 'W ' + crease.W);
  //No swell sample: the old shore-distance path, unchanged.
  const old = SB.evaluate(0, 0, field, 1, 0, Object.assign({}, p, {time: 5}), {}, field, 0, 0);
  check('without a swell sample the old phase stands', old.W > 0.1 && old.theta !== a.theta, 'θ ' + old.theta.toFixed(4));
}

//── 7. The GLSL carries the same thing.
{
  const G = SB.GLSL;
  check('GLSL declares the swell field', /uniform sampler2D shoreSwellField;/.test(G) && /uniform float shoreSwellOn;/.test(G));
  check('GLSL phase from τ', G.includes('theta = w * (shoreBreakerTime - shoreSwellTau(xz, sw));'));
  check('GLSL Hlim + surf decay', G.includes('min(Hsh, sw.g) * exp(-sw.a / ' + SB.SURF_DECAY_M.toFixed(6) + ')'));
  check('GLSL swash sized by surf decay', G.includes('surfKeep = exp(-sw.a / ' + SB.SURF_DECAY_M.toFixed(6) + ');'));
  check('GLSL swash bar cap', G.includes('float hlimP = shoreSwellAt(probeXZ).g;') && G.includes('min(shoreBreakerHs * sqrt(fDir), barCap) * surfKeep'));
  check('GLSL swash foam scales with height', G.includes('* k * foamK * shoreBreakerFoamGain'));
  check('GLSL swash phase NOT timed by τ', !G.includes('swShore') && !/frontDelay \+= /.test(G));
}

//── 8. The swash: sized by the swell, timed by the shoreline alone. Timing it by τ at the
//nearest shore point drained shallow flats into branching fingers (2026-10-24).
{
  const field = {depth: 0.2, shoreSDF: 2.0, level: 0.0, dryMask: 0, flowWeight: 0};
  const p = {enabled: true, Hs: 1.5, omega: 2 * Math.PI / 8, seaLevel: 0, depthCap: 1e9, time: 3.0,
             waveDirX: 1, waveDirZ: 0, heightScale: 1, foamGain: 1};
  const probe = {depth: 1.0, shoreSDF: 20.0};
  const sw = (tau, surf) => ({tau: tau, Hlim: 1e4, E: 1, surf: surf, gradX: 0, gradZ: 0});
  const a = SB.evaluateSwash(0, 0, field, -1, 0, p, {}, field, probe, sw(0, 0));
  const b = SB.evaluateSwash(0, 0, field, -1, 0, p, {}, field, probe, sw(5.3, 0));
  check('swash phase ignores τ', a.theta === b.theta && a.eta === b.eta, 'θ ' + a.theta.toFixed(4) + ' vs ' + b.theta.toFixed(4));
  const c = SB.evaluateSwash(0, 0, field, -1, 0, p, {}, field, probe, sw(0, 2 * SB.SURF_DECAY_M));
  check('swash shrinks across a surf flat', c.R2 < 0.5 * a.R2, 'R2 ' + a.R2.toFixed(3) + ' → ' + c.R2.toFixed(3));
  //Behind a sill: the probe (1 m deep) was reached over 5 cm of water → Hlim 0.039.
  const bar = SB.evaluateSwash(0, 0, field, -1, 0, p, {}, field, probe, Object.assign(sw(0, 0), {probeHlim: SB.GAMMA * 0.05}));
  check('swash behind a sill is small', bar.reach < 0 || bar.R2 < 0.25 * a.R2, 'R2 ' + bar.R2.toFixed(3));
  //Ordinary beach: the probe's Hlim is its own breaking cap (ratio 1) → unchanged.
  const beach = SB.evaluateSwash(0, 0, field, -1, 0, p, {}, field, probe, Object.assign(sw(0, 0), {probeHlim: SB.GAMMA * 1.0}));
  check('ordinary beach swash unchanged by the bar test', Math.abs(beach.R2 - a.R2) < 1e-9, 'R2 ' + beach.R2.toFixed(3));
  //A few cm of swash makes little foam.
  const tiny = SB.evaluateSwash(0, 0, field, -1, 0, Object.assign({}, p, {Hs: 0.03}), {}, field, probe, sw(0, 0));
  check('tiny swash: little foam', tiny.foam < 0.2 * Math.max(a.foam, 1e-3) || tiny.foam < 0.05, 'foam ' + tiny.foam.toFixed(3) + ' vs ' + a.foam.toFixed(3));
}

//── 9. WaveMask shelter: sea-level water the swell does not reach is fetch-limited.
{
  const WM = globalThis.ARestlessOcean.WaveMask;
  const p = {enabled: true, peakK: 0.006, windSpeed: 12, oceanFetch: 1e5, seaLevel: 0, depthCap: 1e9,
             bandKLo: [0.0015, 0.006, 0.025, 0.1, 0.4, 1.6], bandKHi: [0.006, 0.025, 0.1, 0.4, 1.6, 6.3]};
  const open = WM.compute(new Array(6), 0, 30, 40, 0, p);
  const openE = WM.compute(new Array(6), 0, 30, 40, 0, p, 1.0);
  const shut = WM.compute(new Array(6), 0, 30, 40, 0, p, 0.0);
  check('exposed water keeps the ocean spectrum', open.every((v, i) => v === openE[i]));
  check('unreached sea-level water loses its long bands', shut[1] < 0.1 * open[1] && shut[3] < open[3], 'c1 ' + open[1].toFixed(3) + ' → ' + shut[1].toFixed(3) + ', c3 ' + open[3].toFixed(3) + ' → ' + shut[3].toFixed(3));
  const G = WM.GLSL, S = SB.GLSL;
  check('GLSL waveMaskCascadesExposed + plain wrapper', G.includes('void waveMaskCascadesExposed(vec4 field, float exposed') && G.includes('waveMaskCascadesExposed(field, 1.0, a, b);'));
  check('GLSL shoreSwellExposure', S.includes('float shoreSwellExposure(vec2 xz)'));
}

//── 10. E is blurred over a fraction of the wavelength (crease jumps; browser round 4).
{
  globalThis.ARestlessOcean.Passes = globalThis.ARestlessOcean.Passes || {};
  load('passes/swell-arrival-pass.js');
  const SAP = globalThis.ARestlessOcean.Passes.SwellArrivalPass;
  const s8 = SAP.blurSigmaFor(2 * Math.PI / 8, 4), s4 = SAP.blurSigmaFor(2 * Math.PI / 4, 4), s20 = SAP.blurSigmaFor(2 * Math.PI / 20, 4);
  check('E blur σ ≈ 0.35 L0 at 8 s', Math.abs(s8 * 4 - 0.35 * 99.9) < 0.5, (s8 * 4).toFixed(1) + ' m');
  check('E blur σ clamped', Math.abs(s4 * 4 - SAP.E_BLUR_MIN_M) < 1e-6 && Math.abs(s20 * 4 - SAP.E_BLUR_MAX_M) < 1e-6, (s4 * 4).toFixed(1) + ' / ' + (s20 * 4).toFixed(1) + ' m');
}

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
