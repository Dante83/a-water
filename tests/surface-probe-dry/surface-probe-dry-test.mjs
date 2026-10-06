//Node checks for the surface probes over dry ground (HeightReadbackPass._readSurfaceProbe,
//exactCameraSurfaceY): a probe where the drawn water discards as dry reads NO_WATER_Y with
//no velocity, the camera query hands that back so OceanGrid can call the eye over dry, and
//stepping back onto water gives a sane height with no velocity spike across the gap.
//Run: node tests/surface-probe-dry/surface-probe-dry-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {Passes: {}};
globalThis.THREE = new Proxy({}, {get: () => function(){}});
vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/passes/height-readback-pass.js', import.meta.url), 'utf8'));
const HRP = ARestlessOcean.Passes.HeightReadbackPass;
const MAX = HRP.PROBE_MAX;
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + '  ' + (info || '')); if(!ok) fails++; };

//A pass with no GPU: each "read" copies the rows this test queues into the buffer.
const pass = Object.create(HRP.prototype);
const cam = {x: 10, y: 5, z: 20};
pass.oceanGrid = {globalCameraPosition: cam};
pass._spBuf = new Float32Array(MAX * 2 * 4);
let rows = null;
pass.renderer = {readRenderTargetPixelsAsync: (rt, x, y, w, h, buf) => { buf.set(rows); return Promise.resolve(); }};
function read(row0, row1, timeMs){
  rows = new Float32Array(MAX * 2 * 4);
  rows.set(row0, 0); rows.set(row1, MAX * 4);
  pass.probeSurface('__aro_camera__', cam.x, cam.z);
  const p = pass._spProbes.get('__aro_camera__');
  pass._spIssued = {slots: [{probe: p, x: cam.x, z: cam.z, hadP0: p.has0}], time: timeMs};
  pass._readSurfaceProbe();
  return new Promise(r => setTimeout(r, 0)).then(() => p);
}

const now = performance.now();
let p = await read([0.4, 10, 20, 0], [0.4, 10, 20, 1], now - 40);
p = await read([0.5, 10, 20, 0], [0.45, 10, 20, 1], now - 20);
check('wet probe resolves', p.result && !p.result.dry && p.result.y === 0.5, 'y=' + (p.result && p.result.y));

//The camera walks onto a hillside below a creek: the shader writes the sentinel.
p = await read([HRP.NO_WATER_Y, 10, 20, 0], [123.0, 10, 20, 1], now - 10);
check('dry probe flagged', p.result.dry === true && p.result.y === HRP.NO_WATER_Y);
check('dry probe has no velocity', p.result.vx === 0 && p.result.vy === 0 && p.result.vz === 0);
check('dry restarts the inversion', p.has0 === false && p.lastT === 0);
const exact = pass.exactCameraSurfaceY();
check('camera query hands back NO_WATER_Y', exact === HRP.NO_WATER_Y, 'exact=' + exact);
check('which reads as dry to the caller', exact <= 0.5 * HRP.NO_WATER_Y);

//Back over water: a sane height and no velocity from the sentinel.
p = await read([0.6, 10, 20, 0], [0.6, 10, 20, 1], now - 5);
check('back on water: not dry', p.result.dry === false && Math.abs(p.result.y - 0.6) < 1e-6);
check('no velocity spike across the gap', Math.abs(p.result.vy) < 1.0, 'vy=' + p.result.vy);
const exact2 = pass.exactCameraSurfaceY();
check('camera query is the water again', Math.abs(exact2 - 0.6) < 0.01, 'exact=' + exact2);

console.log(fails ? '\n' + fails + ' failed' : '\nall passed');
process.exit(fails ? 1 : 0);
