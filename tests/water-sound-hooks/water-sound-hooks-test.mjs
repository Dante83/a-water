//Node checks for the sound hooks: WaterInteraction.onImpact announcements (entry, wade,
//with spray off, opted out, unsubscribe, a throwing listener) and the camera-medium
//getter's fallback before the ocean is up.
//Run: node tests/water-sound-hooks/water-sound-hooks-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {};
const load = p => vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/' + p, import.meta.url), 'utf8'));
load('passes/dynamic-waves-pass.js');
load('components/water-interactor.js');
load('field/water-state.js');
const WI = ARestlessOcean.WaterInteraction;
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + '  ' + (info || '')); if(!ok) fails++; };

//Flat still water at y = 0, everywhere wet. Installed AFTER water-state.js, which defines
//the real getWaterStateAt.
ARestlessOcean.getWaterStateAt = (x, z, out) => {
  out = out || {};
  Object.assign(out, {status: 'wet', surfaceY: 0.0, ripple: 0.0, source: 'probe',
    flowX: 0.0, flowZ: 0.0, orbitalX: 0.0, orbitalY: 0.0, orbitalZ: 0.0});
  return out;
};
const dt = 1 / 60;

//Drop a sphere through the surface at `vy` m/s (negative = falling); returns the heard events.
function drop(opts, vy){
  const heard = [];
  const off = WI.onImpact(e => heard.push(e));
  const i = new WI.Interactor(Object.assign({radius: 0.1, ripples: false}, opts));
  for(let y = 0.3; y > -0.3; y += vy * dt) i.update(0, y, 0, dt);
  off();
  return heard;
}

//── 1. A slap: entry announced once, with closing speed, radius, tag and the surface point.
{
  const tag = {name: 'liam-hand'};
  const h = drop({tag: tag, splash: false}, -3.0);
  const e = h[0];
  check('entry announced with spray OFF', h.length === 1 && e.kind === 'entry', 'events=' + h.length);
  check('entry fields', e && Math.abs(e.speed - 3.0) < 1e-6 && e.radius === 0.1 && e.y === 0.0
    && e.source === tag && e.status === 'wet' && e.submerged > 0.02 && e.submerged < 0.98,
    e ? `speed=${e.speed} r=${e.radius} sub=${e.submerged.toFixed(3)}` : '');
}

//── 2. Too slow to splash: nothing.
check('gentle entry is silent', drop({}, -0.5).length === 0);

//── 3. announce:false opts out; nothing heard with spray on and no splash system.
check('announce:false is silent', drop({announce: false}, -3.0).length === 0);

//── 4. Wading: sideways through the waterline at 2 m/s, half under; cooldown bounds the rate.
{
  const heard = [];
  const off = WI.onImpact(e => heard.push(e));
  const i = new WI.Interactor({radius: 0.2, ripples: false, splash: false});
  for(let k = 0; k < 60; ++k) i.update(k * 2.0 * dt, 0.0, 0, dt);   //one second
  off();
  const wades = heard.filter(e => e.kind === 'wade');
  check('wade announced, rate bounded by cooldown', wades.length >= 5 && wades.length <= 7 && wades.length === heard.length,
    'wades/s=' + wades.length);
  check('wade speed is speed through the water', wades.length && Math.abs(wades[0].speed - 2.0) < 1e-6);
}

//── 5. Unsubscribe mid-dispatch + a throwing listener do not starve the others.
{
  let a = 0, b = 0;
  const offA = WI.onImpact(() => { a++; offA(); });
  const offT = WI.onImpact(() => { throw new Error('boom (expected in this test)'); });
  const offB = WI.onImpact(() => { b++; });
  const err = console.error; console.error = () => {};
  WI.announceImpact({kind: 'entry'});
  WI.announceImpact({kind: 'entry'});
  console.error = err;
  offT(); offB();
  check('self-unsubscribe + throwing listener', a === 1 && b === 2, `a=${a} b=${b}`);
  check('all listeners gone', WI._impactListeners.length === 0);
}

//── 6. No listeners: no event objects built (the interactor checks first).
{
  let built = 0;
  const real = WI.announceImpact;
  WI.announceImpact = () => { built++; };
  const i = new WI.Interactor({radius: 0.1, ripples: false});
  for(let y = 0.3; y > -0.3; y -= 3.0 * dt) i.update(0, y, 0, dt);
  WI.announceImpact = real;
  check('no listeners, no announce', built === 0);
}

//── 7. Camera medium before the ocean is up: invalid, in air.
{
  const c = ARestlessOcean.getCameraWaterState();
  check('camera state fallback', c.valid === false && c.underwater === false && c.factor === 0.0 && c.flips === 0);
  const fake = {getCameraWaterState: out => Object.assign(out || {}, {valid: true, underwater: true, factor: 1.0, flips: 3})};
  ARestlessOcean.WaterState.grid = fake;
  const keep = {};
  const r = ARestlessOcean.getCameraWaterState(keep);
  ARestlessOcean.WaterState.grid = null;
  check('camera state reads the grid into out', r === keep && keep.underwater === true && keep.flips === 3);
}

//── 8. Sea state (echo's surf): the spectrum's own Hs and peak period, the downwind direction.
{
  const z = ARestlessOcean.getSeaState();
  check('sea state before the ocean: invalid, flat', z.valid === false && z.Hs === 0.0);
  const U = 8.0, gamma = 3.3, omega = 0.877 * 9.81 / U;
  ARestlessOcean.WaterState.grid = {
    windVelocity: {x: 0.0, y: -U}, heightOffset: 0.25,
    oceanHeightBandLibrary: {jonswapGamma: gamma, omega_p: omega},
    oceanHeightComposer: {waveHeightMultiplier: 0.5}
  };
  const s = ARestlessOcean.getSeaState({});
  ARestlessOcean.WaterState.grid = null;
  const Hs = 0.21 * U * U / 9.81 * Math.pow(gamma, 0.3) * 0.5;
  check('sea state: Hs as rendered (× height multiplier)', s.valid && Math.abs(s.Hs - Hs) < 1e-3, `Hs=${s.Hs.toFixed(3)} want ${Hs.toFixed(3)}`);
  check('sea state: Tp = 2π/ω_p', Math.abs(s.Tp - 2 * Math.PI / omega) < 1e-9, `Tp=${s.Tp.toFixed(2)}`);
  check('sea state: waves travel downwind (windVelocity.y is z)', s.dirX === 0 && s.dirZ === -1 && s.seaLevel === 0.25);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
