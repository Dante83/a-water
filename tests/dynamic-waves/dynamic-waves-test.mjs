//Node checks for Phase 8e: DynamicWaves damping (wavelength-aware, and no longer a
//spring), the vertex-spacing estimate the geometric ripple is filtered by, and the
//capsule interactor (contact where the surface crosses a limb, the limb's own velocity,
//the footprint sized without its own ripple).
//Run: node tests/dynamic-waves/dynamic-waves-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {};
const load = p => vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/' + p, import.meta.url), 'utf8'));
load('passes/dynamic-waves-pass.js');
load('components/water-interactor.js');
const DW = ARestlessOcean.DynamicWaves;
const WI = ARestlessOcean.WaterInteraction;
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + '  ' + (info || '')); if(!ok) fails++; };
const f3 = x => (+x).toFixed(3);

//── 1. The step on ONE plane wave (periodic, uniform depth) is a scalar recurrence,
//exactly what the shader does per cell: η⁺(1+a dt) = 2η − η⁻(1 − a dt) − (g dt²/dx) R η + νc dt L (η − η⁻),
//R the fitted kernel's response, L the 5-point Laplacian's eigenvalue (≤ 0).
function runMode(kCells, depthIdx, damping, viscM2, seconds){
  const dt = DW.DT, dx = DW.DX, g = DW.G;
  const R = DW.kernelResponse(depthIdx, kCells, 0.0);
  const L = -2.0 * (1.0 - Math.cos(kCells));
  const nuC = viscM2 / (dx * dx);
  let e = 1.0, em = 1.0;            //start at rest at amplitude 1
  const n = Math.round(seconds / dt);
  const hist = [e];
  for(let i = 0; i < n; ++i){
    const next = (2.0 * e - em * (1.0 - damping * dt) - g * dt * dt * R * e / dx + nuC * dt * L * (e - em)) / (1.0 + damping * dt);
    em = e; e = next; hist.push(e);
  }
  //Peaks → decay rate and period.
  const peaks = [];
  for(let i = 1; i < hist.length - 1; ++i) if(hist[i] > hist[i - 1] && hist[i] >= hist[i + 1] && hist[i] > 0) peaks.push([i * dt, hist[i]]);
  return {R: R, peaks: peaks};
}
function fitMode(r){
  const p = r.peaks;
  if(p.length < 3) return null;
  const a = p[0], b = p[p.length - 1];
  return {period: (b[0] - a[0]) / (p.length - 1), rate: Math.log(a[1] / b[1]) / (b[0] - a[0])};
}
{
  //Damping off: the reference period of each mode.
  //λ in cells: 4 (0.5 m), 8 (1 m), 16 (2 m); depth 4 cells (the deep kernel).
  const lambdas = [4, 8, 16];
  for(const lam of lambdas){
    const k = 2.0 * Math.PI / lam;
    const ref = fitMode(runMode(k, 3, 0.0, 0.0, 20.0));
    const now = fitMode(runMode(k, 3, DW.DAMPING, DW.VISCOSITY, 20.0));
    const kM = k / DW.DX;
    const want = DW.DAMPING + 0.5 * DW.VISCOSITY * (2.0 * (1.0 - Math.cos(k))) / (DW.DX * DW.DX);
    check('λ ' + (lam * DW.DX) + ' m: decay rate = DAMPING + ν·L/2',
      now && Math.abs(now.rate - want) / want < 0.03, 'measured ' + f3(now && now.rate) + '/s, expect ' + f3(want) + '/s (e-fold ' + f3(1 / want) + ' s)');
    check('λ ' + (lam * DW.DX) + ' m: damping does not detune (period within 1%)',
      ref && now && Math.abs(now.period - ref.period) / ref.period < 0.01, 'undamped ' + f3(ref && ref.period) + ' s, damped ' + f3(now && now.period) + ' s');
    void kM;
  }
  //The old iWave height-damping form DID detune: show the check would have caught it.
  const k = 2.0 * Math.PI / 8;
  const R = DW.kernelResponse(3, k, 0.0), dt = DW.DT;
  let e = 1, em = 1; const hist = [];
  for(let i = 0; i < 1200; ++i){ const nx = (e * (2 - DW.DAMPING * dt) - em - DW.G * dt * dt * R * e / DW.DX) / (1 + DW.DAMPING * dt); em = e; e = nx; hist.push(e); }
  const pk = []; for(let i = 1; i < hist.length - 1; ++i) if(hist[i] > hist[i - 1] && hist[i] >= hist[i + 1] && hist[i] > 0) pk.push(i * dt);
  const oldPeriod = (pk[pk.length - 1] - pk[0]) / (pk.length - 1);
  const ref = fitMode(runMode(k, 3, 0.0, 0.0, 20.0));
  check('old iWave form at the new DAMPING would detune a 1 m ripple > 1%', Math.abs(oldPeriod - ref.period) / ref.period > 0.01,
    'old ' + f3(oldPeriod) + ' s vs ' + f3(ref.period) + ' s');
  //Stability at the Nyquist corner with the live clamp (8 cells²/s): bounded.
  let ok = true;
  { const kc = Math.PI; const Rn = DW.kernelResponse(3, kc, Math.PI / 4); const L = -8.0; let a = 1, b = 1;
    for(let i = 0; i < 6000; ++i){ const nx = (2 * a - b * (1 - DW.DAMPING * dt) - DW.G * dt * dt * Rn * a / DW.DX + 8 * dt * L * (a - b)) / (1 + DW.DAMPING * dt); b = a; a = nx; if(!isFinite(a) || Math.abs(a) > 10) { ok = false; break; } } }
  check('grid corner stays bounded at the viscosity clamp', ok);
}

//── 2. Vertex-spacing estimate: ≥ the clipmap's real spacing, ≤ 2×, continuous.
{
  const cell = 0.25, ring = 16.0;       //patch_size 8, 32 cells, ring 0 = ±16 m
  const real = d => { let k = 0; while(d > ring * Math.pow(2, k)) k++; return cell * Math.pow(2, k); };
  let lo = Infinity, hi = 0, maxJump = 0, prev = null;
  for(let d = 0.0; d <= 200.0; d += 0.01){
    const est = DW.meshCellAt(cell, ring, d, 0, 0, 0);
    const r = est / real(d);
    lo = Math.min(lo, r); hi = Math.max(hi, r);
    if(prev !== null) maxJump = Math.max(maxJump, Math.abs(est - prev));
    prev = est;
  }
  check('mesh cell estimate ≥ real spacing', lo >= 0.999, 'min ratio ' + f3(lo));
  check('mesh cell estimate ≤ 2× real spacing', hi <= 2.001, 'max ratio ' + f3(hi));
  check('mesh cell estimate continuous (no step at ring edges)', maxJump < 0.01, 'max step ' + f3(maxJump) + ' m per cm');
  check('Chebyshev, not Euclidean', DW.meshCellAt(cell, ring, 20, 20, 0, 0) === DW.meshCellAt(cell, ring, 20, 0, 0, 0));
  check('uniform mesh (ring 0) keeps its cell', DW.meshCellAt(1.0, 0.0, 50, 50, 0, 0) === 1.0);
  //Where the geometric ripple lives on the clipmap: full inside d where cell ≤ FULL.
  const fullD = DW.VERTEX_CELL_FULL / cell * ring / 2.0, zeroD = DW.VERTEX_CELL_ZERO / cell * ring / 2.0;
  check('geometric ripple spans the ripple window (±32 m)', fullD >= 0.5 * DW.RESOLUTION * DW.DX, 'full to ' + fullD + ' m, gone at ' + zeroD + ' m');
}

//── 3. Capsule interactor against a mocked water state.
{
  const water = {surfaceY: 0.0, ripple: 0.0, flowX: 0, flowZ: 0, vy: 0};
  ARestlessOcean.getWaterStateAt = (x, z, out) => {
    out = out || {};
    out.status = 'wet'; out.surfaceY = water.surfaceY + water.ripple; out.ripple = water.ripple;
    out.flowX = water.flowX; out.flowZ = water.flowZ;
    out.orbitalX = 0; out.orbitalY = water.vy; out.orbitalZ = 0; out.source = 'probe';
    return out;
  };
  const emitters = [];
  DW.emitters.length = 0;
  const sprays = [];
  WI.impact = (x, y, z, speed) => { sprays.push({x, y, z, speed}); return true; };
  DW.poke = () => {};

  //A shin from the ankle (y −0.4) to the knee (y +0.1): the surface (0) crosses it at t 0.8.
  const shin = new WI.Interactor({radius: 0.06});
  let st;
  for(let i = 0; i < 3; ++i) st = shin.updateSegment(0, -0.4, 0, 0, 0.1, 0, 1 / 60);
  check('capsule contact where the surface crosses the segment', Math.abs(st.contactT - 0.8) < 1e-9, 't ' + f3(st.contactT));
  check('capsule contact straddles the waterline (frac ≈ 0.5)', Math.abs(st.submerged - 0.5) < 1e-6, 'frac ' + f3(st.submerged));
  check('capsule is in the water', st.inWater === true);
  const e = shin._emitter;
  //Waterline radius 0.06, floored at two ripple cells (0.25 m) as for spheres.
  check('capsule rings: emitter at the contact, footprint floored at 2 cells', e && e.x === 0 && Math.abs(e.radius - 2 * DW.DX) < 1e-9 && e.depth > 0, e && ('R ' + f3(e.radius) + ' depth ' + f3(e.depth)));

  //All under: the upper end. All out: the lower end.
  const deep = new WI.Interactor({radius: 0.06});
  deep.updateSegment(0, -1.0, 0, 0, -0.5, 0, 1 / 60);
  check('segment all under → contact at the upper end', deep.state.contactT === 1.0 && Math.abs(deep.state.depth - 0.5) < 1e-9);
  const dry = new WI.Interactor({radius: 0.06});
  dry.updateSegment(0, 0.5, 0, 0, 1.0, 0, 1 / 60);
  check('segment all out → contact at the lower end, not in water', dry.state.contactT === 0.0 && !dry.state.inWater);
  check('level segment → middle', WI.segmentContact(-0.1, -0.1, 0.0) === 0.5);

  //The water rising along a STILL limb slides the contact up the shin, but the limb
  //is not moving: no velocity, no wade spray, no entry spray from the slide.
  sprays.length = 0;
  const still = new WI.Interactor({radius: 0.06});
  let maxV = 0;
  for(let i = 0; i < 60; ++i){
    water.surfaceY = -0.3 + 0.4 * i / 60;
    still.updateSegment(0, -0.4, 0, 0, 0.1, 0, 1 / 60);
    maxV = Math.max(maxV, Math.hypot(still.state.vx, still.state.vy, still.state.vz));
  }
  check('rising water along a still limb: limb velocity stays 0', maxV < 1e-9, 'max |v| ' + f3(maxV));
  check('rising water along a still limb: no spray', sprays.length === 0, sprays.length + ' sprays');
  water.surfaceY = 0.0;

  //A shin swept sideways at 2 m/s through the waterline wades (sprays); at 0.5 m/s it doesn't.
  const sweep = (speed) => {
    sprays.length = 0;
    const i0 = new WI.Interactor({radius: 0.06});
    for(let i = 0; i < 180; ++i){ const x = speed * i / 60; i0.updateSegment(x, -0.4, 0, x, 0.1, 0, 1 / 60); }
    return sprays.length;
  };
  const fast = sweep(2.0), slow = sweep(0.5);
  check('capsule wading at 2 m/s sprays, at 0.5 m/s does not', fast > 5 && slow === 0, fast + ' vs ' + slow);

  //Rotating limb (knee fixed, ankle swinging): velocity at the contact interpolates the ends.
  const swing = new WI.Interactor({radius: 0.06});
  swing.updateSegment(0, -0.4, 0, 0, 0.1, 0, 1 / 60);
  swing.updateSegment(0.05, -0.4, 0, 0, 0.1, 0, 1 / 60);   //ankle moved 5 cm in 1/60 s: 3 m/s
  check('contact velocity = limb velocity at t (ankle 3 m/s, knee 0, t 0.8 → 0.6 m/s)', Math.abs(swing.state.vx - 3.0 * 0.2) < 1e-6, 'vx ' + f3(swing.state.vx));

  //Ripple feedback: the footprint ignores the water's ripple (its own depression).
  const a = new WI.Interactor({radius: 0.2});
  a.update(0, 0, 0, 1 / 60); a.update(0, 0, 0, 1 / 60);
  const d0 = a._emitter.depth, r0 = a._emitter.radius;
  water.ripple = -0.05;
  a.update(0, 0, 0, 1 / 60);
  check('footprint sized without the ripple (no self-feedback)', a._emitter.depth === d0 && a._emitter.radius === r0, f3(d0) + ' → ' + f3(a._emitter.depth));
  check('but the state sees the drawn (rippled) surface', Math.abs(a.state.depth + 0.05) < 1e-9, 'depth ' + f3(a.state.depth));
  water.ripple = 0.0;

  //rippleScale scales the footprint depth, not its radius or the state.
  const b = new WI.Interactor({radius: 0.2, rippleScale: 0.25});
  b.update(0, 0, 0, 1 / 60); b.update(0, 0, 0, 1 / 60);
  check('rippleScale 0.25 presses a quarter as deep, same radius', Math.abs(b._emitter.depth - 0.25 * d0) < 1e-12 && b._emitter.radius === r0 && b.state.submerged === 0.5,
    f3(b._emitter.depth) + ' vs ' + f3(d0));

  //Foam: a limb cutting the waterline at 1.3 m/s churns foamK·(1.3 − 0.3) = 1/s; standing
  //still, none; fully under, none.
  const fw = new WI.Interactor({radius: 0.06});
  for(let i = 0; i < 10; ++i){ const x = 1.3 * i / 60; fw.updateSegment(x, -0.4, 0, x, 0.1, 0, 1 / 60); }
  check('foam while cutting the waterline: foamK·(speed − 0.3)', Math.abs(fw._emitter.foam - 1.0) < 1e-6, 'foam ' + f3(fw._emitter.foam) + '/s');
  const fs = new WI.Interactor({radius: 0.06});
  for(let i = 0; i < 10; ++i) fs.updateSegment(0, -0.4, 0, 0, 0.1, 0, 1 / 60);
  const fu = new WI.Interactor({radius: 0.06});
  for(let i = 0; i < 10; ++i){ const x = 1.3 * i / 60; fu.update(x, -1.0, 0, 1 / 60); }
  check('no foam standing still, none fully under', fs._emitter.foam === 0 && fu._emitter.foam === 0);

  //The plain sphere path is unchanged: enter once, entry spray at the closing speed.
  sprays.length = 0;
  const hand = new WI.Interactor({radius: 0.08});
  let enters = 0; hand.onEnter = () => enters++;
  for(let i = 0; i < 40; ++i) hand.update(0, 0.3 - 3.0 * i / 60, 0, 1 / 60);
  check('sphere: one enter, entry spray at ~3 m/s', enters === 1 && sprays.length >= 1 && Math.abs(sprays[0].speed - 3.0) < 1e-6, enters + ' enters, ' + sprays.length + ' sprays');
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nall passed');
process.exit(fails ? 1 : 0);
