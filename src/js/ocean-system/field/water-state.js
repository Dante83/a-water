//=============================================================================
// WaterState — getWaterStateAt(x, z): the one sanctioned "what water is here?"
//=============================================================================
//
// Phase 8 (WATER-TYPES.md). Before this, the answer was scattered over five
// globals and queryFlow, each reaching for its own source:
//
//   level / depth / flow / type   a-land's getWaterAt (a synchronous tile-cache read)
//   rendered surface height       HeightReadbackPass's FFT snapshot (±256 m of camera)
//   surface height, anywhere      the analytic Gerstner twin (OceanWaveField)
//
// This file puts them behind one call. It adds no new source of truth: every
// number here comes from one of the three above, through the same seams the
// renderer uses (waterLevelAt, waveMasksAt, FlowHandoff), so it cannot drift
// from what is drawn.
//
// What it adds is `status`. a-land's getWaterAt answers null for three different
// things — dry ground, a tile still loading, and outside the world — and every
// caller used to read all three as "open sea at heightOffset". That was the real
// "a swimmer in a mountain river is told ocean height" bug: not a wrong river
// level (the seams fixed that in Phases 1b-4), but no way to know the answer
// was a guess. WaterTileDecoder.answerAt tells them apart; status carries it.
//
//   'wet'         a-land has water here. level/depth/flow/type are real.
//   'dry'         a-land has ANSWERED "no water". depth is 0. level and surfaceY
//                 still hold the standalone fallback so legacy callers get the
//                 number they always got — do not float anything on it.
//   'loading'     a-land's tile has not warmed yet (a frame or two), or there is
//                 no decoder to ask. The renderer draws the standalone plane
//                 meanwhile, so level/surfaceY describe what is on screen.
//   'open-ocean'  standalone (no a-land), or outside a-land's world. The FFT
//                 ocean at heightOffset is the answer, and it is a true one.
//
// Returned object (reused `out`; read it before your next call):
//   status, level, surfaceY, depth,
//   flowX, flowZ, energy, flowWeight,           current (m/s), turbulence, still/flow hand-off
//   orbitalX, orbitalY, orbitalZ,               wave particle velocity at the surface (m/s)
//   type, waterType,                            index into simulation.waterTypes[] and its entry
//   bodyId, waterBody,                          index into simulation.bodies[] and its entry
//                                               ({kind: 'ocean'|'lake', level, …}); null for
//                                               rivers and creeks (a-land gives them no body)
//                                               and for tiles baked before Phase 8 (class.B 0)
//   source                                      'probe' | 'fft' | 'analytic' | null — who answered surfaceY
//   ripple                                      the part of surfaceY that is DynamicWaves rings and
//                                               wakes (m); only a probe carries it, 0 otherwise.
//                                               A body that is itself a ripple emitter should
//                                               size its footprint on surfaceY − ripple, or it
//                                               feels its own depression and chases it (8e)
//
// opts (optional):
//   source    'auto' (default: FFT snapshot, else twin) | 'fft' (snapshot only;
//             surfaceY null outside it) | 'analytic' (twin only)
//   velocity  true to fill orbital* (one extra sin/cos per wave component)
//   probe     a key (any string) for ONE body that must ride the drawn water: a
//             swimmer, a boat the camera follows. The point is evaluated exactly
//             as the water mesh draws it (every cascade, chop inverted) and
//             orbital* become the drawn water's own particle velocity, in phase.
//             One probe per body, moved by calling again; up to 16 at once. The
//             first frame or two answer as 'auto' while the probe warms up.
//
// The legacy globals are rewired as thin shims over this at install time, with
// byte-identical answers: sampleWaterHeight (twin), sampleWaterHeightFFT
// (snapshot) and queryFlow. The SHAPE queries — sampleWaterDisplacement,
// sampleWaterNormal, sampleWaterRiseFFT, sampleWaterSlopeFFT and the debug
// sampleWaterHeightFFTExact — are not water state and keep their own samplers.
//
// Cost: two cache reads (getWaterAt, answerAt only when that is null), one
// bilinear snapshot lookup or one twin evaluation. Fine per probe per frame.

ARestlessOcean.WaterState = {};

ARestlessOcean.WaterState.WET = 'wet';
ARestlessOcean.WaterState.DRY = 'dry';
ARestlessOcean.WaterState.LOADING = 'loading';
ARestlessOcean.WaterState.OPEN_OCEAN = 'open-ocean';

//Last grid wins, like the sampleWater* globals always have.
ARestlessOcean.WaterState.grid = null;

ARestlessOcean.WaterState.createState = function(){
  return {
    status: ARestlessOcean.WaterState.OPEN_OCEAN,
    level: 0.0, surfaceY: 0.0, depth: 0.0,
    flowX: 0.0, flowZ: 0.0, energy: 0.0, flowWeight: 0.0,
    orbitalX: 0.0, orbitalY: 0.0, orbitalZ: 0.0,
    type: 0, waterType: null, bodyId: null, waterBody: null,
    source: null,
    ripple: 0.0
  };
};

ARestlessOcean.WaterState._openOceanDepth = function(){
  return (ARestlessOcean.Passes && ARestlessOcean.Passes.WaterFieldPass)
    ? ARestlessOcean.Passes.WaterFieldPass.OPEN_OCEAN_DEPTH : 1000.0;
};

//Fill status, level, depth, flow and type — everything but the moving surface.
ARestlessOcean.WaterState._fillField = function(grid, x, z, out){
  const WS = ARestlessOcean.WaterState;
  out.flowX = 0.0; out.flowZ = 0.0; out.energy = 0.0; out.flowWeight = 0.0;
  out.type = 0; out.waterType = null; out.bodyId = null; out.waterBody = null;
  out.level = grid.heightOffset;
  out.depth = WS._openOceanDepth();
  out.status = WS.OPEN_OCEAN;
  if(grid._terrainProvider !== 'a-faraway-land' || !grid._landTerrainApi) return out;

  const w = grid._landTerrainApi.getWaterAt(x, z);
  if(w){
    out.status = WS.WET;
    out.level = w.level;
    out.depth = w.depth;
    out.flowX = w.vx || 0.0;
    out.flowZ = w.vz || 0.0;
    out.energy = w.energy || 0.0;
    //Same weight waterFlowAt / queryFlow always reported (window NOT applied).
    out.flowWeight = ARestlessOcean.FlowHandoff.weightFromVelocity(out.flowX, out.flowZ, grid.waterFieldPass, out.energy);
    out.type = w.type || 0;
    const mj = grid._landDirector && grid._landDirector.mapJson;
    const sim = mj && mj.simulation;
    out.waterType = (sim && sim.waterTypes && sim.waterTypes[out.type]) || null;
    if(w.body !== undefined && w.body !== null){
      out.bodyId = w.body;
      out.waterBody = (sim && sim.bodies && sim.bodies[w.body]) || null;
    }
    return out;
  }

  //null: dry, loading, or outside the world. Only the decoder can say which.
  const tdp = grid.waterFieldPass && grid.waterFieldPass._tileDecodePass;
  const decoder = tdp && tdp.decoder;
  const answer = decoder ? decoder.answerAt(x, z) : 'loading';
  if(answer === 'dry'){
    out.status = WS.DRY;
    out.depth = 0.0;
  } else if(answer === 'none'){
    out.status = WS.OPEN_OCEAN;
  } else {
    //'loading', or 'wet' in the decoder while getWaterAt's own cache is still
    //cold (two caches, warmed independently) — either way, not known yet.
    out.status = WS.LOADING;
  }
  return out;
};

//Surface particle velocity of the twin's Gerstner sum at (x, z, t), in m/s.
//d/dt of sampleDisplacement without chop: chop leans the drawn crest, but the
//water itself moves at A·ω, and that is what should push a swimmer.
ARestlessOcean.WaterState._twinOrbital = function(field, x, z, t, out){
  const comps = field.components;
  const mask = field._masksAt(x, z);
  let vx = 0.0, vy = 0.0, vz = 0.0;
  for(let i = 0; i < comps.length; i++){
    const c = comps[i];
    const arg = c.kx * x + c.ky * z - c.omega * t + c.phase;
    const aw = mask[c.cascade] * c.amp * c.omega;
    const cs = Math.cos(arg);
    vy += aw * Math.sin(arg);
    vx += c.dirX * aw * cs;
    vz += c.dirZ * aw * cs;
  }
  const m = field.waveHeightMultiplier;
  out.orbitalX = m * vx; out.orbitalY = m * vy; out.orbitalZ = m * vz;
};

ARestlessOcean.WaterState._scratch = null;

ARestlessOcean.getWaterStateAt = function(x, z, out, opts){
  const WS = ARestlessOcean.WaterState;
  out = out || WS.createState();
  const source = (opts && opts.source) || 'auto';
  const wantVelocity = !!(opts && opts.velocity);
  out.orbitalX = 0.0; out.orbitalY = 0.0; out.orbitalZ = 0.0;
  out.source = null;

  const grid = WS.grid;
  if(!grid){
    //Ocean not up yet. The old globals answered 0 here; so do we.
    const fresh = WS.createState();
    for(const k in fresh) out[k] = fresh[k];
    out.surfaceY = (source === 'fft') ? null : 0.0;
    return out;
  }
  WS._fillField(grid, x, z, out);
  out.ripple = 0.0;

  const field = ARestlessOcean.waveField;
  const t = field ? field.currentTimeSeconds : 0.0;
  const hrp = grid.heightReadbackPass;

  let y = null;
  const probeKey = opts && opts.probe;
  if(probeKey !== undefined && probeKey !== null && source === 'auto' && hrp && hrp.probeSurface){
    const r = hrp.probeSurface(probeKey, x, z);
    const pnow = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const age = r ? (pnow - r.time) / 1000.0 : Infinity;
    //A dry probe (no water drawn there) answers through the field paths below instead.
    if(r && !r.dry && age < 0.5){
      //Carried forward from when the probe was drawn, on the water's own rise.
      out.surfaceY = r.y + r.vy * Math.min(0.3, age);
      out.ripple = r.ripple || 0.0;
      out.orbitalX = r.vx; out.orbitalY = r.vy; out.orbitalZ = r.vz;
      out.source = 'probe';
      return out;
    }
  }
  if(source !== 'analytic' && hrp){
    //Asking IS wanting the field: the snapshot only refreshes while someone calls
    //requestFFTSnapshot, and without it a caller read a field frozen at whenever
    //splash or buoyant last asked — a swimmer held still while the drawn sea
    //rolled up and down through him. A snapshot older than half a second (the
    //field was asleep) is not the rendered surface; fall through to the twin.
    hrp.request();
    const snap = hrp._hfSnap;
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if(snap && now - snap.time < 500.0){
      y = hrp.sampleWaterHeightFieldCached(x, z);
      if(y !== null && y !== undefined){
        out.source = 'fft';
        //The snapshot is the surface when it was ISSUED (~15 Hz, then an async
        //read): typically 100-150 ms ago. On a 1 m swell that is a decimetre or
        //more behind the drawn water, so carry it forward on its own rise.
        const rise = hrp.sampleRise(x, z);
        if(rise !== null && rise !== undefined){
          y += rise * Math.min(0.3, (now - snap.time) / 1000.0);
        }
      } else y = null;
    }
  }
  if(y === null && source !== 'fft'){
    //Exactly what sampleWaterHeight always returned (twin level comes from the
    //same waterLevelAt seam, so it matches out.level wherever that is 'wet').
    y = field ? field.sampleHeight(x, z, t) : 0.0;
    out.source = field ? 'analytic' : null;
  }
  out.surfaceY = y;

  if(wantVelocity && field){
    WS._twinOrbital(field, x, z, t, out);
    //The snapshot is the rendered surface, and its rise is in the rendered
    //phase. Horizontal stays the twin's: statistically right, phase unknown.
    if(out.source === 'fft' && hrp){
      const rise = hrp.sampleRise(x, z);
      if(rise !== null && rise !== undefined) out.orbitalY = rise;
    }
  }
  return out;
};

//Wire a grid in and rewire the legacy globals as shims. Called by OceanGrid
//after HeightReadbackPass.installGlobalAPI and queryFlow, which it replaces.
ARestlessOcean.WaterState.install = function(grid){
  const WS = ARestlessOcean.WaterState;
  WS.grid = grid;
  const s = WS._scratch || (WS._scratch = WS.createState());
  const ANALYTIC = {source: 'analytic'};
  const FFT = {source: 'fft'};

  ARestlessOcean.sampleWaterHeight = function(x, z){
    return ARestlessOcean.getWaterStateAt(x, z, s, ANALYTIC).surfaceY;
  };
  if(grid.heightReadbackPass){
    ARestlessOcean.sampleWaterHeightFFT = function(x, z){
      return ARestlessOcean.getWaterStateAt(x, z, s, FFT).surfaceY;
    };
  }
  ARestlessOcean.queryFlow = function(x, z, out){
    out = out || {vx: 0, vz: 0, energy: 0, flowWeight: 0};
    WS._fillField(grid, x, z, s);
    out.vx = s.flowX; out.vz = s.flowZ; out.energy = s.energy; out.flowWeight = s.flowWeight;
    return out;
  };
};

//The camera's medium (OceanGrid.getCameraWaterState): what the last tick's submersion
//probe found at the eye. Before the ocean is up: valid false, in air.
ARestlessOcean.getCameraWaterState = function(out){
  const grid = ARestlessOcean.WaterState.grid;
  if(grid && grid.getCameraWaterState) return grid.getCameraWaterState(out);
  out = out || {};
  out.valid = false; out.overDry = true; out.submersion = 1.0e6; out.surfaceY = 0.0;
  out.factor = 0.0; out.underwater = false; out.band = false; out.straddle = false;
  out.x = 0.0; out.y = 0.0; out.z = 0.0; out.flips = 0; out.frame = 0;
  return out;
};

//The deep-water SEA STATE, for anything that needs the waves as numbers rather than pixels
//(echo-engine's surf: a-land says where the beaches are, this says how big the waves are that
//reach them). The SAME formulas the spectrum is calibrated with (ShoreBreaker.paramsFrom), read
//whether or not the shore breakers are drawn:
//   valid     false until the ocean is up (then Hs 0: no sea to hear)
//   Hs        significant wave height as rendered (× the composer's height multiplier), m
//   Tp        peak period, s (2π/ω_p from the band library)
//   dirX/Z    unit direction the waves TRAVEL (downwind)
//   windX/Z   the wind, m/s
//   seaLevel  the still surface, m
ARestlessOcean.getSeaState = function(out){
  out = out || {};
  const grid = ARestlessOcean.WaterState.grid;
  const lib = grid && grid.oceanHeightBandLibrary;
  out.valid = false; out.Hs = 0.0; out.Tp = 0.0; out.dirX = 1.0; out.dirZ = 0.0;
  out.windX = 0.0; out.windZ = 0.0; out.seaLevel = 0.0;
  if(!grid || !lib || !grid.windVelocity) return out;
  const g = ARestlessOcean.ShoreBreaker ? ARestlessOcean.ShoreBreaker.G : 9.81;
  const wx = grid.windVelocity.x, wz = grid.windVelocity.y;
  const U = Math.sqrt(wx * wx + wz * wz);
  const gamma = lib.jonswapGamma || 3.3;
  const composer = grid.oceanHeightComposer;
  out.valid = true;
  out.windX = wx; out.windZ = wz;
  out.Hs = 0.21 * U * U / g * Math.pow(gamma, 0.3) * (composer ? composer.waveHeightMultiplier : 1.0);
  out.Tp = lib.omega_p > 0 ? 2.0 * Math.PI / lib.omega_p : 0.0;
  if(U > 0.01){ out.dirX = wx / U; out.dirZ = wz / U; }
  out.seaLevel = grid.heightOffset || 0.0;
  return out;
};

//THE BREAKER AT A BEACH POINT, for sound: the same ShoreBreaker model (and the same phase
//clock) the shore breakers are drawn with, evaluated from geometry the CALLER supplies — the
//water depth there, how far it is from the shoreline, and the seaward normal. The GPU field
//those come from on the draw side is only readable by a full synchronous readback, which no
//per-frame caller can afford; a-land knows both numbers from its own terrain. So the timing is
//the drawn one up to how closely the caller's depth/distance match the field's.
//   valid     false when breakers are off (or the ocean is not up): the caller makes its own
//   breaking  0..1, the wave at this point is breaking
//   foam      0..1, the bore's foam: spikes as the front passes, trails as it drains — the
//             envelope of a breaker's CRASH
//   H, eta    local wave height and surface displacement, m
ARestlessOcean.getSurfAt = function(x, z, depth, shoreDist, nx, nz, out){
  out = out || {};
  out.valid = false; out.breaking = 0.0; out.foam = 0.0; out.H = 0.0; out.eta = 0.0;
  const SB = ARestlessOcean.ShoreBreaker, grid = ARestlessOcean.WaterState.grid;
  if(!SB || !grid) return out;
  const p = grid._shoreBreakerParams || (grid.shoreBreakerParams ? grid.shoreBreakerParams() : null);
  if(!p || !p.enabled) return out;
  const f = ARestlessOcean.WaterState._surfField || (ARestlessOcean.WaterState._surfField = {});
  f.level = p.seaLevel; f.depth = Math.max(0.0, +depth || 0.0); f.shoreSDF = Math.max(0.0, +shoreDist || 0.0);
  f.dryMask = 0.0; f.flowWeight = 0.0;
  const o = SB.evaluate(x, z, f, +nx || 0.0, +nz || 0.0, p, ARestlessOcean.WaterState._surfOut || (ARestlessOcean.WaterState._surfOut = {}), f);
  out.valid = true; out.breaking = o.breaking; out.foam = o.foam; out.H = o.H; out.eta = o.eta;
  return out;
};

//Console: ARestlessOcean.debugWaterStateAt(x, z)  — or, where the camera is,
//ARestlessOcean.debugWaterStateAt() . Logs and returns a copy.
//$DEBUG_START$
ARestlessOcean.debugWaterStateAt = function(x, z){
  const grid = ARestlessOcean.WaterState.grid;
  if(x === undefined && grid && grid.globalCameraPosition){
    x = grid.globalCameraPosition.x; z = grid.globalCameraPosition.z;
  }
  const s = ARestlessOcean.getWaterStateAt(x, z, null, {velocity: true});
  const f = function(v, d){ return (v === null || v === undefined) ? '—' : v.toFixed(d === undefined ? 2 : d); };
  console.log(`[water @ ${f(x, 1)}, ${f(z, 1)}] ${s.status}  level=${f(s.level)} surfaceY=${f(s.surfaceY)} (${s.source}) depth=${f(s.depth)}`
    + `  flow=(${f(s.flowX)}, ${f(s.flowZ)}) energy=${f(s.energy)} flowWeight=${f(s.flowWeight)}`
    + `  orbital=(${f(s.orbitalX)}, ${f(s.orbitalY)}, ${f(s.orbitalZ)})  type=${s.type}`
    + ` body=${s.bodyId}${s.waterBody ? ' (' + s.waterBody.kind + ')' : ''}`);
  return Object.assign({}, s);
};
//$DEBUG_END$
