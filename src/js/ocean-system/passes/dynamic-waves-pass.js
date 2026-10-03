//── Dynamic waves (Phase 8b) ───────────────────────────────────────────────
//
//WHAT IT ADDS. The water answering back: rings where something bobs, a wake
//behind something moving, ripples that run into a bank and come back. The FFT
//ocean and the flowing surface are both driven by statistics (a spectrum, a
//ripple profile); neither knows an object is there. This layer is a small,
//camera-centred simulation that only carries what objects put into the water.
//
//WHAT IT IS. An iWave-class (Tessendorf 2004) height field, world-snapped, 512²
//at DX = 0.125 m (a ±32 m window), stepped once per frame:
//
//    η⁺ = [ 2η − η⁻(1 − a·dt) − (g dt² / dx)·(K_h ∗ η) + ν dt ∇²(η − η⁻) ] / (1 + a·dt)
//
//  * K_h ∗ η is the vertical-derivative operator: in Fourier space it multiplies a
//    wave of grid wavenumber k by k·tanh(k·h), so ω² = g k tanh(k h), the full
//    linear dispersion relation with the LOCAL depth h. Long ripples outrun short
//    ones and a ring spreads into a proper train (a plain wave equation moves every
//    wavelength at one speed, which reads as rubber), and ripples slow and bunch up
//    as the water shoals toward a bank.
//  * K_h is not Tessendorf's closed-form kernel. That one, truncated to a 13×13
//    footprint, is off by up to 2× across the band and has a non-zero DC response
//    (measured 2026-09-26). Instead a bank of radial kernels (radius 8, 197 taps,
//    30 radial classes) is least-squares fitted at load to k·tanh(k·h) for
//    h = 0.5, 1, 2, 4 cells, with DC pinned to zero. Fit error ≤ 3% for k in
//    0.15-2.4 rad/cell at h ≤ 2 cells.
//  * Variable depth, symmetric. Applied as Σ_j K_h(i−j)·(η_j − η_i) with the depth
//    of the PAIR, h = ½(h_i + h_j), blended between the two nearest fitted kernels.
//    For uniform depth that is exactly K ∗ η (the kernel sums to zero); where the
//    depth varies it stays symmetric. The first version gave each cell the kernel
//    of its OWN depth: non-symmetric, and over a beach or a creek bank it grew
//    without bound (NaN in ~1 s on a 0.8 m creek, headless 2026-09-26).
//    Deeper than 4 cells (0.5 m) the 4-cell kernel stands in: a compact zero-DC
//    kernel always behaves like finite depth at long wavelengths, so waves longer
//    than ~2 m travel as they would over half a metre of water. That is the price
//    of a local operator, and it only touches the longest ripples.
//  * Fixed step, DT = 1/60 s, substepped from an accumulator: the leapfrog's
//    η − η⁻ is a velocity times the LAST step's dt, and reusing it under a
//    different dt pumps energy in.
//  * Dry cells (WaterField dryMask or depth 0) hold η = 0: banks reflect.
//  * a damps the VELOCITY (the centred (η⁺ − η⁻)/2dt), plus a sponge on the rim;
//    ν is a viscosity on the velocity, strongest on short waves (see DAMPING).
//    ⚠ Not iWave's η(2 − a·dt)/(1 + a·dt): that form damps the HEIGHT, which is a
//    spring as much as a damper: it adds 2a/dt to every ω² (12 rad²/s² at 8b's
//    a = 0.1, a 20% frequency error on a 1 m ripple) and would detune the whole
//    band at the damping 8e needed (8b ran on it).
//  * Advection. Before each step the field is carried by the current (WaterField
//    RT1 flow, baked into the medium), Catmull-Rom so a ripple is not smeared by
//    a fraction-of-a-cell move every frame. A ring dropped in a creek drifts
//    downstream, which is what makes it read as a river and not a pond.
//
//SOURCES. Everything that disturbs the water is an emitter: a Gaussian footprint
//(x, z, radius) pushed down by `depth` metres. Each frame the field receives the
//CHANGE of every footprint since the last frame, as a displacement (η and η⁻
//together, no velocity) — so a body sitting still adds nothing, a bobbing body
//rings, a moving body leaves a wake, and the water it displaces is conserved.
//ARestlessOcean.DynamicWaves.addEmitter() is the API (8c will grow it); poke()
//is a dropped stone: a depression left behind, with no body to lift back out.
//
//CONSUMERS. The fragment of both water variants (sea and flowing) splices
//`$dynamic_waves_functions` and adds dynamicWavesSlopeAt() to its micro slope;
//debug mode 69 shows η. Phase 8e: the VERTEX of both variants splices it too and
//adds dynamicWavesVertexHeightAt(), filtered to what each mesh can carry (see
//"Geometry" below): near the camera the clipmap is 0.25 m a vertex, fine enough
//for a ring to lift the surface. The surface probes (HeightReadbackPass) add the
//same filtered height, so a body riding the drawn water bobs on rings and wakes.
//The ocean CSM (caster and receiver depth) and the CPU height bake leave it
//out: centimetres against metre-scale shadows and a 2 m field.
//
//⚠ Float precision: the same self-test as ShoreReflectionPass (NEARSHORE-WAVES.md
//§ 5.8) disables the layer on drivers that sample RGBA32F at half precision.

ARestlessOcean.DynamicWaves = {};

ARestlessOcean.DynamicWaves.ENABLED = true;
ARestlessOcean.DynamicWaves.G = 9.80665;
ARestlessOcean.DynamicWaves.RESOLUTION = 512;
ARestlessOcean.DynamicWaves.DX = 0.125;             //m per cell -> ±32 m window
ARestlessOcean.DynamicWaves.KERNEL_RADIUS = 8;      //cells
ARestlessOcean.DynamicWaves.KERNEL_DEPTHS = [0.5, 1.0, 2.0, 4.0];   //cells
//── Damping (Phase 8e). Real short ripples die within a second or two and a wake
//fades over a few metres, the shorter the faster. Two terms, both read every
//step (live console knobs):
//  DAMPING    amplitude decay rate for EVERY wavelength (1/s): e^(−DAMPING·t).
//  VISCOSITY  ν on the water's vertical velocity (m²/s): amplitude decay ν·k²/2,
//             so it hits short waves hardest, like viscosity and a surface film.
//Together (k = 2π/λ):  λ 0.25 m → 0.3 s e-fold,  0.5 m → 0.9 s,  1 m → 2 s,
//2 m → 2.9 s. At group speed that is ~1.3 m per e-fold for a 1 m ripple, so a
//wake is gone (5%) within about 4 m.
//⚠ FUDGE, flagged: clean water's ν is 1e-6 m²/s, and on it a 1 m ripple would
//ring for hours. What actually kills ripples outdoors is surface films and
//turbulence, which no one term models; 0.01 is an effective value chosen by
//the target above, not measured. 8b's values (0.1 through the iWave damping
//form, and 0.25 cells²/s = 0.004 m²/s) left a ring alive ~10 s.
ARestlessOcean.DynamicWaves.DAMPING = 0.3;
ARestlessOcean.DynamicWaves.VISCOSITY = 0.01;
//── Foam (Phase 8e). Whitewater a body churns up where it cuts the waterline or plunges
//in: the third channel of the state, added by emitters (`foam`, per second, and a one-off
//`foamBurst`), carried by the current with the ripples (not by the ripples: foam drifts,
//it does not ride the wave's orbit), and fading with FOAM_LIFE (s, e-fold; live).
//The water fragment takes max(its foam, dynamicWavesFoamAt()).
ARestlessOcean.DynamicWaves.FOAM_LIFE = 3.0;
ARestlessOcean.DynamicWaves.SPONGE_CELLS = 32.0;
ARestlessOcean.DynamicWaves.SPONGE_RATE = 6.0;
ARestlessOcean.DynamicWaves.EDGE_FADE_START = 1.0 - 2.0 * 32.0 / 512.0;
ARestlessOcean.DynamicWaves.RECENTER_FRACTION = 0.25;
//Fixed step (s), and the most steps one frame may take: a longer hitch slows
//the water down rather than stalling the frame (the leapfrog limit is ~0.12 s).
ARestlessOcean.DynamicWaves.DT = 1.0 / 60.0;
ARestlessOcean.DynamicWaves.MAX_STEPS_PER_FRAME = 4;
ARestlessOcean.DynamicWaves.MAX_EMITTERS = 32;
ARestlessOcean.DynamicWaves.REBAKE_MS = 1000.0;

//── Kernel bank ────────────────────────────────────────────────────────────
//Fitted once, lazily. Returns {taps: [[dx, dy, class]...], classes, bank:
//Float32Array(depths × classes)}. See the header for what and why.
ARestlessOcean.DynamicWaves._kernel = null;
ARestlessOcean.DynamicWaves.kernel = function(){
  const DW = ARestlessOcean.DynamicWaves;
  if(DW._kernel) return DW._kernel;
  const P = DW.KERNEL_RADIUS;
  const classOf = new Map();
  const taps = [];
  for(let j = -P; j <= P; ++j){
    for(let i = -P; i <= P; ++i){
      const r2 = i * i + j * j;
      if(Math.sqrt(r2) > P + 0.01) continue;
      if(!classOf.has(r2)) classOf.set(r2, classOf.size);
      taps.push([i, j, classOf.get(r2)]);
    }
  }
  const U = classOf.size;
  //Basis responses to plane waves over the WHOLE Brillouin zone: row[c] = Σ over
  //the taps of class c of cos(kx·i + ky·j). The kernel is D4-symmetric, so the
  //triangle 0 ≤ ky ≤ kx ≤ π covers it. ⚠ Fitting |k| ≤ π along a few angles only
  //(the first version) left the zone's corners free: R(π, π) came out at −55, and
  //a negative symbol is an exponentially growing checkerboard.
  const samples = [];
  const NK = 40;
  for(let a = 0; a <= NK; ++a){
    for(let c2 = 0; c2 <= a; ++c2){
      const kx = Math.PI * a / NK, ky = Math.PI * c2 / NK;
      const row = new Float64Array(U);
      for(const t of taps) row[t[2]] += Math.cos(kx * t[0] + ky * t[1]);
      const k = Math.hypot(kx, ky);
      //DC pinned hard; the band a ripple lives in weighted fully; the grid-scale
      //tail loosely (it only has to stay positive: oscillate, and be damped).
      samples.push({k: k, row: row, w: a === 0 ? 200.0 : (k <= 2.4 ? 1.0 : 0.15)});
    }
  }
  const depths = DW.KERNEL_DEPTHS;
  const bank = new Float32Array(depths.length * U);
  const solve = function(h, out){
    const A = [];
    for(let p = 0; p < U; ++p) A.push(new Float64Array(U));
    const b = new Float64Array(U);
    for(const s of samples){
      const target = s.k * Math.tanh(s.k * h);
      for(let p = 0; p < U; ++p){
        b[p] += s.w * s.row[p] * target;
        for(let q = 0; q < U; ++q) A[p][q] += s.w * s.row[p] * s.row[q];
      }
    }
    for(let p = 0; p < U; ++p) A[p][p] += 1e-7;
    //Gaussian elimination with partial pivoting (30×30).
    for(let c = 0; c < U; ++c){
      let piv = c;
      for(let r = c + 1; r < U; ++r) if(Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      const tr = A[c]; A[c] = A[piv]; A[piv] = tr;
      const tb = b[c]; b[c] = b[piv]; b[piv] = tb;
      for(let r = c + 1; r < U; ++r){
        const f = A[r][c] / A[c][c];
        for(let q = c; q < U; ++q) A[r][q] -= f * A[c][q];
        b[r] -= f * b[c];
      }
    }
    for(let c = U - 1; c >= 0; --c){
      let v = b[c];
      for(let q = c + 1; q < U; ++q) v -= A[c][q] * out[q];
      out[c] = v / A[c][c];
    }
  };
  const response = function(x, s){ let r = 0.0; for(let c = 0; c < U; ++c) r += x[c] * s.row[c]; return r; };
  for(let d = 0; d < depths.length; ++d){
    const h = depths[d];
    const x = new Float64Array(U);
    for(const s of samples) s.w0 = s.w0 === undefined ? s.w : s.w0;
    for(const s of samples) s.w = s.w0;
    //Positivity: re-weight every sample whose response sits well under its target
    //(or below zero) until none does. A handful of rounds settles it.
    for(let round = 0; round < 12; ++round){
      solve(h, x);
      let bad = 0;
      for(const s of samples){
        if(s.k === 0) continue;
        const target = s.k * Math.tanh(s.k * h);
        if(response(x, s) < 0.5 * target){ s.w *= 4.0; bad++; }
      }
      if(!bad) break;
    }
    for(let c = 0; c < U; ++c) bank[d * U + c] = x[c];
  }
  DW._kernel = {taps: taps, classes: U, bank: bank};
  return DW._kernel;
};

//Response of the depth-d kernel to a plane wave (k rad/cell, angle th): for
//tests and the console. Should be ≈ k·tanh(k·KERNEL_DEPTHS[d]).
ARestlessOcean.DynamicWaves.kernelResponse = function(d, k, th){
  const K = ARestlessOcean.DynamicWaves.kernel();
  const cx = Math.cos(th || 0.0), cy = Math.sin(th || 0.0);
  let s = 0.0;
  for(const t of K.taps) s += K.bank[d * K.classes + t[2]] * Math.cos(k * (t[0] * cx + t[1] * cy));
  return s;
};

//── Emitters ───────────────────────────────────────────────────────────────
//An emitter is a Gaussian footprint exp(−|x − c|² / r²) pressed `depth` metres
//into the water. Move it, change its depth; the pass injects the difference each
//frame. Set active = false (or remove()) to lift it out — which itself makes a
//ring, as lifting something out of water does.
ARestlessOcean.DynamicWaves.emitters = [];

ARestlessOcean.DynamicWaves.addEmitter = function(opts){
  opts = opts || {};
  const list = ARestlessOcean.DynamicWaves.emitters;
  const e = {
    x: opts.x || 0.0, z: opts.z || 0.0,
    radius: opts.radius || 0.5,
    depth: opts.depth || 0.0,
    active: true,
    //Foam (see FOAM_LIFE): coverage added per second at the footprint's centre while it
    //moves, and a one-off amount consumed the next time it is injected.
    foam: opts.foam || 0.0,
    foamBurst: opts.foamBurst || 0.0,
    //false: deactivating drops it without lifting it back out (poke's stone).
    release: opts.release !== false,
    //What the field last received (null: never injected).
    _prev: null,
    _removed: false,
    remove: function(){ this.active = false; this._removed = true; }
  };
  list.push(e);
  return e;
};

//Console: ARestlessOcean.poke(x, z, strength = 0.05 m, radius = 0.4 m). A stone
//dropped in: the water is pressed down once and left to spring back on its own.
//With no args, 3 m in front of the camera.
ARestlessOcean.DynamicWaves.poke = function(x, z, strength, radius, foam){
  const e = ARestlessOcean.DynamicWaves.addEmitter({
    x: x, z: z, radius: radius || 0.4, depth: (strength === undefined) ? 0.05 : strength, release: false,
    foamBurst: foam || 0.0
  });
  e._lifeFrames = 1;
  return e;
};
ARestlessOcean.poke = function(x, z, strength, radius){
  const grid = ARestlessOcean.WaterState && ARestlessOcean.WaterState.grid;
  if(x === undefined && grid && grid.globalCameraPosition){
    const cam = grid.camera || (grid.el && grid.el.sceneEl && grid.el.sceneEl.camera);
    const c = grid.globalCameraPosition;
    let fx = 0.0, fz = -1.0;
    if(cam && cam.getWorldDirection){
      const v = cam.getWorldDirection(new THREE.Vector3());
      const l = Math.hypot(v.x, v.z);
      if(l > 1e-4){ fx = v.x / l; fz = v.z / l; }
    }
    x = c.x + 3.0 * fx; z = c.z + 3.0 * fz;
  }
  return ARestlessOcean.DynamicWaves.poke(x, z, strength, radius);
};

//── Consumer chunk ─────────────────────────────────────────────────────────
//What consumers splice when the layer is off: the same functions and the scalar
//uniforms debug 69 reads, and no sampler.
ARestlessOcean.DynamicWaves.STUB_GLSL = [
  'float dwSurfaceLevel = -1.0e9;',
  'uniform float dynamicWavesEnabled;',
  'uniform vec2 dynamicWavesCenter;',
  'uniform float dynamicWavesHalfWidth;',
  'float dynamicWavesHeightAt(vec2 xz){ return 0.0; }',
  'vec2 dynamicWavesSlopeAt(vec2 xz){ return vec2(0.0); }',
  'float dynamicWavesMeshCellAt(vec2 xz, vec2 camXZ){ return 0.0; }',
  'float dynamicWavesVertexHeightAt(vec2 xz, float cell){ return 0.0; }',
  'float dynamicWavesFoamAt(vec2 xz){ return 0.0; }'
].join('\n');

//── Geometry (Phase 8e) ────────────────────────────────────────────────────
//The ripple height also moves the water's vertices, where the mesh is fine
//enough to carry it. A vertex grid of spacing s can show wavelengths down to 2s;
//anything shorter sampled at the vertices comes back as a false, crawling long
//wave (aliasing). So the vertex takes the field BOX-FILTERED over its own
//spacing (4×4 bilinear taps; the box has zeros at λ = s, s/2, … and passes 64%
//at λ = 2s), and the fragment keeps adding the full-resolution slope on top.
//
//Each water mesh says how fine it is: dynamicWavesMeshCell, its finest vertex
//spacing (m; 0 = no geometric ripples, e.g. the horizon skirt), and
//dynamicWavesMeshRing, the half-width of the finest clipmap ring (m; 0 = the
//spacing is uniform, as on the flowing surface's rings). The clipmap doubles its
//spacing ring by ring around the camera, and every ring snaps at ring 0's cell,
//so ring k covers Chebyshev distance d ≤ R·2^k from the camera. The estimate
//    cell(d) = meshCell · max(1, 2d / R)
//is ≥ the real spacing everywhere and at most 2× it, and it is CONTINUOUS: a
//vertex shared by two rings along a stitched edge gets the same height from both
//sides, so the rings cannot crack apart. The weight fades out between
//VERTEX_CELL_FULL and VERTEX_CELL_ZERO, where 4 taps across the box would start
//to alias themselves.
ARestlessOcean.DynamicWaves.VERTEX_CELL_FULL = 1.0;   //m
ARestlessOcean.DynamicWaves.VERTEX_CELL_ZERO = 2.0;   //m

//── Fall rings ──────────────────────────────────────────────────────────────
//The waves a waterfall sends across its pool, DRAWN, not simulated. The field above is
//right for centimetre rings from bodies, but its damping (DAMPING, VISCOSITY) eats a wave
//within a few metres, which is the opposite of what a fall's foot does: it sends trains of
//foot-high waves right across the pool. So each fall's landing line (WaterfallSplashHull.
//ringLines; WaterfallSplashPass picks the FALL_RINGS_MAX segments nearest the camera every
//frame and fills DynamicWaves.fallRings) goes to the water as uniforms, and the consumers add
//  h = A · side · (1 − e^(−d/0.8)) · e^(−d/decay) · groups · sin(k·d′ − ω·t)
//blended over the segments near the nearest (weights e^(−(d − d_min)/1.5 m): one line's segments
//agree, two falls' trains cross-fade), d the distance to the segment, d′ = d + wobble · Perlin(xz ·
//wobbleScale, t · drift)
//(the fronts bend and wander instead of running ruler-straight), ω² = g·k (deep water: a 4 m
//wave runs at 2.5 m/s), `groups` a slow beat travelling at the group speed (the waves come in
//sets), and `side` fading by angle to zero behind the line (the creek above the lip is nearly
//straight behind it); the trains wrap a little round the line's ends.
//The first metre ramps in: the line itself is under the foam and the sheet.
//SIZE: each line's decay is scaled by its fall's size (drop / 10 m, 0.2..1.5: fallRingExtra.y), so
//a short step's waves die near its foot. LEVEL: each line carries its pool's water level
//(fallRingExtra.x) and its waves draw only on water within ~1 m of it: the creek past the next
//ledge, a few metres lower, is close in xz but is not this pool (they went over the cliff edge).
//A consumer says what water it is drawing by setting dwSurfaceLevel before it calls in (the
//vertex: the field's level; the fragment: the same; the probe: its level); left at its
//initial -1e9, there is no gate.
//They join the field's slope (fragment) and vertex height (geometry, filtered: gone where the
//mesh is coarser than a quarter wavelength), so the probes and anything floating ride them too.
//FUDGE: every FALL_RINGS value is a look choice; only the speed is physics.
ARestlessOcean.DynamicWaves.FALL_RINGS_MAX = 16;
ARestlessOcean.DynamicWaves.FALL_RINGS = {
  wavelength: 4.0,     //m
  decay: 6.0,          //m: e-fold of the height with distance from the line
  wobble: 0.8,         //m: how far the Perlin noise moves a front
  wobbleScale: 0.25,   //noise cells per metre
  drift: 0.15,         //noise cells per second
  groups: 0.45,        //0..1: how deep the sets are (0: an even train)
  gain: 4.0            //x every fall's amplitude (live; 1 -> 4 by Dante on 2026-10-02 after the first look)
};
//What WaterfallSplashPass fills each frame: seg[i] = (ax, az, bx, bz), param[i] = (amplitude m,
//downstream nx, nz, seed), extra[i] = (the pool's water level m, size scale), count, and the clock.
ARestlessOcean.DynamicWaves.fallRings = (function(){
  const N = ARestlessOcean.DynamicWaves.FALL_RINGS_MAX;
  const seg = [], param = [];
  //(Plain {x, y, z, w, set} outside three: the node tests load this file without it.)
  const v4 = function(){
    return typeof THREE !== 'undefined' ? new THREE.Vector4()
      : {x: 0, y: 0, z: 0, w: 0, set: function(x, y, z, w){ this.x = x; this.y = y; this.z = z; this.w = w; return this; }};
  };
  const extra = [];
  for(let i = 0; i < N; ++i){ seg.push(v4()); param.push(v4()); extra.push(v4()); }
  return {seg: seg, param: param, extra: extra, count: 0, timeSec: 0.0};
})();
ARestlessOcean.DynamicWaves.FALL_RINGS_GLSL = (function(){
  const N = ARestlessOcean.DynamicWaves.FALL_RINGS_MAX;
  return [
    '#define FALL_RINGS_N ' + N,
    'uniform vec4 fallRingSeg[' + N + '];',     //a.xz, b.xz
    'uniform vec4 fallRingParam[' + N + '];',   //amplitude (m), downstream normal xz ((0,0): all round), seed
    'uniform vec4 fallRingExtra[' + N + '];',   //the pool level (m), size scale (decay x this)
    'uniform float fallRingCount;',
    'uniform vec4 fallRingWave;',               //k (rad/m), omega (rad/s), decay (m), wobble (m)
    'uniform vec4 fallRingNoise;',              //wobble scale (1/m), noise time (cells), groups, wave time (s, wrapped)
    'float frHash(vec3 p){',
    '  p = fract(p * 0.3183099 + 0.1);',
    '  p *= 17.0;',
    '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
    '}',
    'vec3 frGrad(vec3 i){ return vec3(frHash(i), frHash(i + 19.19), frHash(i + 47.11)) * 2.0 - 1.0; }',
    //Perlin gradient noise, about -1..1.
    'float frPerlin(vec3 x){',
    '  vec3 i = floor(x);',
    '  vec3 f = fract(x);',
    '  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
    '  float n000 = dot(frGrad(i), f);',
    '  float n100 = dot(frGrad(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));',
    '  float n010 = dot(frGrad(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));',
    '  float n110 = dot(frGrad(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));',
    '  float n001 = dot(frGrad(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));',
    '  float n101 = dot(frGrad(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));',
    '  float n011 = dot(frGrad(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));',
    '  float n111 = dot(frGrad(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));',
    '  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);',
    '}',
    //Which water the caller is drawing (see the header): -1e9 = unknown, no level gate.
    'float dwSurfaceLevel = -1.0e9;',
    'float fallRingGate(vec4 ex){',
    '  return dwSurfaceLevel < -1.0e8 ? 1.0 : 1.0 - smoothstep(0.6, 1.5, abs(dwSurfaceLevel - ex.x));',
    '}',
    'float fallRingsHeightAt(vec2 xz){',
    '  if(fallRingCount < 0.5) return 0.0;',
    '  float decay = max(fallRingWave.z, 0.1);',
    //Nearest line on THIS water (other levels are not candidates).
    '  float dmin = 1.0e6;',
    '  for(int i = 0; i < ' + N + '; ++i){',
    '    if(float(i) >= fallRingCount) break;',
    '    if(fallRingGate(fallRingExtra[i]) <= 0.0) continue;',
    '    vec4 s = fallRingSeg[i];',
    '    vec2 ab = s.zw - s.xy;',
    '    vec2 dv = xz - (s.xy + ab * clamp(dot(xz - s.xy, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0));',
    '    dmin = min(dmin, length(dv));',
    '  }',
    '  if(dmin > 7.5 * decay) return 0.0;',
    //One wobble for every line (so neighbouring segments agree), drifting.
    '  float wob = fallRingWave.w * frPerlin(vec3(xz * fallRingNoise.x, fallRingNoise.y));',
    '  float k = fallRingWave.x, w = fallRingWave.y, tw = fallRingNoise.w;',
    '  float sum = 0.0, wsum = 0.0;',
    //Every segment near the nearest one contributes, weighted by how much further it is: along a
    //line the segments carry the same wave (no doubling at a joint), and where two falls' trains
    //meet they cross-fade over a couple of metres instead of a seam.
    '  for(int i = 0; i < ' + N + '; ++i){',
    '    if(float(i) >= fallRingCount) break;',
    '    vec4 s = fallRingSeg[i];',
    '    vec2 ab = s.zw - s.xy;',
    '    vec2 dv = xz - (s.xy + ab * clamp(dot(xz - s.xy, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0));',
    '    float d = length(dv);',
    '    vec4 ex = fallRingExtra[i];',
    '    float wt = exp(-(d - dmin) / 1.5) * fallRingGate(ex);',
    '    if(wt < 0.02) continue;',
    '    vec4 p = fallRingParam[i];',
    //Downstream: by ANGLE from the line (within half a metre, by distance), so the trains wrap a
    //little round the ends of the line and fade out behind it, with no edge.
    '    float side = dot(p.yz, p.yz) < 0.01 ? 1.0 : smoothstep(-0.35, 0.45, dot(dv, p.yz) / max(d, 0.5));',
    '    float dd = d + wob;',
    '    float ph = p.w * 6.2831853;',
    //Sets: a beat 1/6 of the wavenumber, at 1/12 of the frequency (the group speed, half the phase speed).
    '    float sets = 1.0 - fallRingNoise.z * 0.5 * (1.0 + sin(k / 6.0 * dd - w / 12.0 * tw + ph * 3.0));',
    '    float env = (1.0 - exp(-d / 0.8)) * exp(-d / (decay * max(ex.y, 0.05)));',
    '    sum += wt * p.x * side * env * sets * sin(k * dd - w * tw + ph);',
    '    wsum += wt;',
    '  }',
    '  return wsum > 0.0 ? sum / wsum : 0.0;',
    '}',
    'vec2 fallRingsSlopeAt(vec2 xz){',
    '  if(fallRingCount < 0.5) return vec2(0.0);',
    '  const float e = 0.1;',
    '  return vec2(fallRingsHeightAt(xz + vec2(e, 0.0)) - fallRingsHeightAt(xz - vec2(e, 0.0)),',
    '              fallRingsHeightAt(xz + vec2(0.0, e)) - fallRingsHeightAt(xz - vec2(0.0, e))) / (2.0 * e);',
    '}',
    //Geometry: only where the mesh is fine enough to carry the wave (a quarter wavelength), and
    //nowhere on a mesh that takes no ripples (cell 0: the horizon skirt).
    'float fallRingsVertexHeightAt(vec2 xz, float cell){',
    '  if(fallRingCount < 0.5 || cell <= 0.0) return 0.0;',
    '  float lambda = 6.2831853 / max(fallRingWave.x, 1.0e-3);',
    '  float w = 1.0 - smoothstep(0.125 * lambda, 0.25 * lambda, cell);',
    '  return w > 0.0 ? w * fallRingsHeightAt(xz) : 0.0;',
    '}'
  ].join('\n');
})();

ARestlessOcean.DynamicWaves.GLSL = (function(){
  const DW = ARestlessOcean.DynamicWaves;
  return [
    '//── DynamicWaves (spliced from dynamic-waves-pass.js — edit it THERE) ──',
    DW.FALL_RINGS_GLSL,
    'uniform float dynamicWavesEnabled;',
    'uniform sampler2D dynamicWavesMap;',
    'uniform vec2 dynamicWavesCenter;',
    'uniform float dynamicWavesHalfWidth;',
    'uniform float dynamicWavesCell;',
    'uniform float dynamicWavesScale;',
    'uniform float dynamicWavesMeshCell;',
    'uniform float dynamicWavesMeshRing;',
    'float dynamicWavesHeightAt(vec2 xz){',
    '  if(dynamicWavesEnabled < 0.5) return 0.0;',
    '  vec2 d = (xz - dynamicWavesCenter) / dynamicWavesHalfWidth;',
    '  float m = max(abs(d.x), abs(d.y));',
    '  if(m >= 1.0) return 0.0;',
    '  float edge = 1.0 - smoothstep(' + DW.EDGE_FADE_START.toFixed(6) + ', 1.0, m);',
    '  return edge * dynamicWavesScale * texture2D(dynamicWavesMap, d * 0.5 + 0.5).r;',
    '}',
    //Central differences one cell apart: the fragment has no varyings to spare.
    'vec2 dwFieldSlopeAt(vec2 xz){',
    '  if(dynamicWavesEnabled < 0.5) return vec2(0.0);',
    '  vec2 ex = vec2(dynamicWavesCell, 0.0);',
    '  vec2 ez = vec2(0.0, dynamicWavesCell);',
    '  return vec2(dynamicWavesHeightAt(xz + ex) - dynamicWavesHeightAt(xz - ex),',
    '              dynamicWavesHeightAt(xz + ez) - dynamicWavesHeightAt(xz - ez)) / (2.0 * dynamicWavesCell);',
    '}',
    //Geometry: see "Geometry (Phase 8e)" above. camXZ is the MAIN camera's (the
    //clipmap is centred on it); the mirror camera shares its XZ.
    'float dynamicWavesMeshCellAt(vec2 xz, vec2 camXZ){',
    '  if(dynamicWavesMeshRing <= 0.0) return dynamicWavesMeshCell;',
    '  vec2 d = abs(xz - camXZ);',
    '  return dynamicWavesMeshCell * max(1.0, 2.0 * max(d.x, d.y) / dynamicWavesMeshRing);',
    '}',
    'float dwFieldVertexHeightAt(vec2 xz, float cell){',
    '  if(dynamicWavesEnabled < 0.5 || cell <= 0.0) return 0.0;',
    '  float w = 1.0 - smoothstep(' + DW.VERTEX_CELL_FULL.toFixed(6) + ', ' + DW.VERTEX_CELL_ZERO.toFixed(6) + ', cell);',
    '  if(w <= 0.0) return 0.0;',
    '  float box = max(cell, dynamicWavesCell);',
    '  vec2 d = abs(xz - dynamicWavesCenter);',
    '  if(max(d.x, d.y) >= dynamicWavesHalfWidth + box) return 0.0;',
    '  float sum = 0.0;',
    '  for(int j = 0; j < 4; ++j){',
    '    for(int i = 0; i < 4; ++i){',
    '      sum += dynamicWavesHeightAt(xz + (vec2(float(i), float(j)) - 1.5) * (0.25 * box));',
    '    }',
    '  }',
    '  return w * sum * (1.0 / 16.0);',
    '}',
    //Foam coverage 0..1 (the state's third channel), faded at the window's rim.
    'float dynamicWavesFoamAt(vec2 xz){',
    '  if(dynamicWavesEnabled < 0.5) return 0.0;',
    '  vec2 d = (xz - dynamicWavesCenter) / dynamicWavesHalfWidth;',
    '  float m = max(abs(d.x), abs(d.y));',
    '  if(m >= 1.0) return 0.0;',
    '  float edge = 1.0 - smoothstep(' + DW.EDGE_FADE_START.toFixed(6) + ', 1.0, m);',
    '  return edge * clamp(texture2D(dynamicWavesMap, d * 0.5 + 0.5).b, 0.0, 1.0);',
    '}',
    //What the consumers call: the simulated field plus the waterfalls' rings.
    'vec2 dynamicWavesSlopeAt(vec2 xz){ return dwFieldSlopeAt(xz) + fallRingsSlopeAt(xz); }',
    'float dynamicWavesVertexHeightAt(vec2 xz, float cell){ return dwFieldVertexHeightAt(xz, cell) + fallRingsVertexHeightAt(xz, cell); }'
  ].join('\n');
})();

ARestlessOcean.DynamicWaves.consumerGLSL = function(){
  const DW = ARestlessOcean.DynamicWaves;
  return DW.ENABLED ? DW.GLSL : DW.STUB_GLSL;
};

ARestlessOcean.DynamicWaves.createUniforms = function(){
  return {
    dynamicWavesEnabled:    {value: 0.0},
    dynamicWavesMap:        {value: null},
    dynamicWavesCenter:     {value: new THREE.Vector2()},
    dynamicWavesHalfWidth:  {value: 1.0},
    dynamicWavesCell:       {value: 1.0},
    dynamicWavesScale:      {value: 1.0},
    //Per MESH, set once where the mesh is built; writeUniforms never touches them.
    dynamicWavesMeshCell:   {value: 0.0},
    dynamicWavesMeshRing:   {value: 0.0},
    //Fall rings: the arrays are the shared DynamicWaves.fallRings ones (filled once a frame).
    fallRingSeg:            {value: ARestlessOcean.DynamicWaves.fallRings.seg},
    fallRingParam:          {value: ARestlessOcean.DynamicWaves.fallRings.param},
    fallRingExtra:          {value: ARestlessOcean.DynamicWaves.fallRings.extra},
    fallRingCount:          {value: 0.0},
    fallRingWave:           {value: new THREE.Vector4(1.0, 1.0, 6.0, 0.0)},
    fallRingNoise:          {value: new THREE.Vector4(0.25, 0.0, 0.0, 0.0)}
  };
};

//The fall rings' scalars into a consumer's uniforms (the arrays are shared by reference).
ARestlessOcean.DynamicWaves.writeFallRingUniforms = function(u){
  if(!u.fallRingCount) return;
  const DW = ARestlessOcean.DynamicWaves, R = DW.FALL_RINGS, st = DW.fallRings;
  const k = 2.0 * Math.PI / Math.max(R.wavelength, 0.05), w = Math.sqrt(DW.G * k);
  //The wave clock wraps at the sets' period (12 carrier periods), so both stay continuous.
  const period = 24.0 * Math.PI / w;
  u.fallRingSeg.value = st.seg;
  u.fallRingParam.value = st.param;
  if(u.fallRingExtra) u.fallRingExtra.value = st.extra;
  u.fallRingCount.value = st.count;
  u.fallRingWave.value.set(k, w, R.decay, R.wobble);
  u.fallRingNoise.value.set(R.wobbleScale, st.timeSec * R.drift, Math.min(Math.max(R.groups, 0.0), 1.0), st.timeSec % period);
};

//Host-side twin of dynamicWavesMeshCellAt, for tests and the console.
ARestlessOcean.DynamicWaves.meshCellAt = function(meshCell, meshRing, x, z, camX, camZ){
  if(!(meshRing > 0.0)) return meshCell;
  return meshCell * Math.max(1.0, 2.0 * Math.max(Math.abs(x - camX), Math.abs(z - camZ)) / meshRing);
};

//s = DynamicWavesPass.prototype.consumerState()
ARestlessOcean.DynamicWaves.writeUniforms = function(u, s){
  ARestlessOcean.DynamicWaves.writeFallRingUniforms(u);
  if(!u.dynamicWavesEnabled) return;
  const on = !!(s && s.enabled && s.texture);
  u.dynamicWavesEnabled.value = on ? 1.0 : 0.0;
  if(!on || !u.dynamicWavesMap) return;
  u.dynamicWavesMap.value = s.texture;
  u.dynamicWavesCenter.value.set(s.centerX, s.centerZ);
  u.dynamicWavesHalfWidth.value = s.halfWidth;
  u.dynamicWavesCell.value = s.dx;
  u.dynamicWavesScale.value = s.scale;
};

//═══════════════════════════════════════════════════════════════════════════
ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.DynamicWavesPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.enabled = true;
  this.scale = 1.0;
  this.supported = false;
  this.active = false;
  this.centerX = 0.0;
  this.centerZ = 0.0;
  this.dx = ARestlessOcean.DynamicWaves.DX;
  this.halfWidth = 0.5 * ARestlessOcean.DynamicWaves.RESOLUTION * this.dx;
  this.stepCount = 0;
  this._read = 0;
  this._needsReset = true;
  this._lastBakeMs = -1e9;
  this._lastRefills = -1;
  this._lastTimeMs = null;
};

ARestlessOcean.Passes.DynamicWavesPass.prototype.init = function(){
  const DW = ARestlessOcean.DynamicWaves;
  const RES = DW.RESOLUTION;
  const gl = this.renderer.getContext();
  const isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined') && (gl instanceof WebGL2RenderingContext);
  if(!isWebGL2 || !ARestlessOcean.Passes.WaterFieldPass){
    console.warn('[dynamicWaves] needs WebGL2 and WaterFieldPass; disabled.');
    return;
  }
  this._scene = new THREE.Scene();
  this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null));

  const canFilterFloat = !!(this.renderer.extensions && this.renderer.extensions.has('OES_texture_float_linear'));
  const makeTarget = function(filter){
    return new THREE.WebGLRenderTarget(RES, RES, {
      minFilter: filter, magFilter: filter,
      format: THREE.RGBAFormat, type: THREE.FloatType,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false
    });
  };
  const stateFilter = canFilterFloat ? THREE.LinearFilter : THREE.NearestFilter;
  //state = (η now, η last step, 0, 0). _advected is the carried copy the step reads.
  this._state = [makeTarget(stateFilter), makeTarget(stateFilter)];
  this._advected = makeTarget(THREE.NearestFilter);
  //medium = (depth in cells, wet, flow x, flow z in cells/s).
  this._medium = makeTarget(THREE.NearestFilter);

  this._emitNow = [];
  this._emitPrev = [];
  this._emitFoam = new Array(DW.MAX_EMITTERS).fill(0.0);
  for(let i = 0; i < DW.MAX_EMITTERS; ++i){
    this._emitNow.push(new THREE.Vector4());
    this._emitPrev.push(new THREE.Vector4());
  }
  this._buildMaterials();
  const SRP = ARestlessOcean.Passes.ShoreReflectionPass;
  this.supported = SRP ? SRP.prototype._precisionSelfTest.call(this) : true;
  if(!this.supported){
    console.warn('[dynamicWaves] float render targets sample below full precision on this GPU/driver '
      + '(NEARSHORE-WAVES.md § 5.8); dynamic waves are disabled.');
  }
};

ARestlessOcean.Passes.DynamicWavesPass.prototype._buildMaterials = function(){
  const DW = ARestlessOcean.DynamicWaves;
  const WF = ARestlessOcean.Passes.WaterFieldPass;
  const K = DW.kernel();
  const f = function(v){ return (+v).toFixed(6); };
  const RES = DW.RESOLUTION;
  const vert = 'void main(){ gl_Position = vec4(position, 1.0); }';
  const common = [
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'layout(location = 0) out highp vec4 dwOut;',
    '#define gl_FragColor dwOut',
    '#define texture2D texture',
    'uniform vec2 dwCenter;',
    'uniform float dwDx;',
    'const int DW_RES = ' + RES + ';',
    'vec2 dwCellXZ(ivec2 p){ return dwCenter + (vec2(p) + 0.5 - 0.5 * float(DW_RES)) * dwDx; }',
    'bool dwInWindow(ivec2 p){ return all(greaterThanEqual(p, ivec2(0))) && all(lessThan(p, ivec2(DW_RES))); }'
  ].join('\n');

  //── Medium bake.
  const bakeFrag = [
    common,
    'uniform sampler2D dwFieldFlow;',     //WaterField cascade 0 RT1: flow.x flow.z energy type
    'uniform vec2 dwFieldFlowCenter;',
    'uniform float dwFieldFlowHalfWidth;',
    'uniform float dwDepthCap;',
    WF.SAMPLE_GLSL,
    'void main(){',
    '  ivec2 p = ivec2(gl_FragCoord.xy);',
    '  vec2 xz = dwCellXZ(p);',
    '  vec4 field = waterFieldAt(xz);',
    '  float h = field.g;',
    '  if(h >= dwDepthCap * 0.98) h = 1.0e4;',
    '  if(field.a > 0.5 || h <= 0.0){ gl_FragColor = vec4(0.0); return; }',
    '  vec2 fuv = (xz - dwFieldFlowCenter) / (2.0 * dwFieldFlowHalfWidth) + 0.5;',
    '  vec2 flow = (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) ? texture(dwFieldFlow, fuv).rg : vec2(0.0);',
    '  gl_FragColor = vec4(h / dwDx, 1.0, flow / dwDx);',
    '}'
  ].join('\n');
  this._bakeMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: Object.assign({
      dwCenter: {value: new THREE.Vector2()},
      dwDx: {value: this.dx},
      dwFieldFlow: {value: null},
      dwFieldFlowCenter: {value: new THREE.Vector2()},
      dwFieldFlowHalfWidth: {value: 1.0},
      dwDepthCap: {value: 1.0e9}
    }, WF.createSampleUniforms()),
    vertexShader: vert, fragmentShader: bakeFrag, depthTest: false, depthWrite: false
  });

  //── Advect (and re-centre): Catmull-Rom back-trace along the current.
  const advectFrag = [
    common,
    'uniform sampler2D dwState;',
    'uniform sampler2D dwMedium;',
    'uniform vec2 dwShift;',
    'uniform float dwDt;',
    'vec3 dwFetch(ivec2 q){ return dwInWindow(q) ? texelFetch(dwState, q, 0).rgb : vec3(0.0); }',
    'vec4 dwCR(float t){',
    '  float t2 = t * t, t3 = t2 * t;',
    '  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);',
    '}',
    'void main(){',
    '  ivec2 p = ivec2(gl_FragCoord.xy);',
    '  vec4 med = texelFetch(dwMedium, p, 0);',
    '  if(med.g < 0.5){ gl_FragColor = vec4(0.0); return; }',
    '  vec2 src = vec2(p) + dwShift - med.ba * dwDt;',
    '  if(dot(med.ba, med.ba) * dwDt * dwDt < 1.0e-8){',
    '    gl_FragColor = vec4(dwFetch(ivec2(floor(src + 0.5))), 0.0);',
    '    return;',
    '  }',
    '  vec2 b = floor(src);',
    '  vec2 t = src - b;',
    '  vec4 wx = dwCR(t.x);',
    '  vec4 wy = dwCR(t.y);',
    '  ivec2 o = ivec2(b);',
    '  vec3 acc = vec3(0.0);',
    '  vec3 lo = vec3(1.0e9);',
    '  vec3 hi = vec3(-1.0e9);',
    '  for(int j = 0; j < 4; ++j){',
    '    vec3 row = vec3(0.0);',
    '    for(int i = 0; i < 4; ++i){',
    '      vec3 v = dwFetch(o + ivec2(i - 1, j - 1));',
    '      row += wx[i] * v;',
    '      if(i == 1 || i == 2){ if(j == 1 || j == 2){ lo = min(lo, v); hi = max(hi, v); } }',
    '    }',
    '    acc += wy[j] * row;',
    '  }',
    //Clamp to the four nearest: Catmull-Rom overshoots, and an overshoot fed back
    //every frame grows.
    '  gl_FragColor = vec4(clamp(acc, lo, hi), 0.0);',
    '}'
  ].join('\n');
  this._advectMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      dwCenter: {value: new THREE.Vector2()},
      dwDx: {value: this.dx},
      dwState: {value: null},
      dwMedium: {value: null},
      dwShift: {value: new THREE.Vector2()},
      dwDt: {value: 1.0 / 60.0}
    },
    vertexShader: vert, fragmentShader: advectFrag, depthTest: false, depthWrite: false
  });

  //── Step. The kernel is unrolled per tap (the centre drops out of the pair form),
  //each weighted by the bank at the depth of the pair.
  let conv = '';
  for(const t of K.taps){
    if(t[0] === 0 && t[1] === 0) continue;
    conv += '  conv += dwPair(p, ivec2(' + t[0] + ', ' + t[1] + '), ' + t[2] + ', hc, eC);\n';
  }
  const depths = DW.KERNEL_DEPTHS;
  const nD = depths.length;
  const stepFrag = [
    common,
    'uniform sampler2D dwState;',       //advected (η, η⁻)
    'uniform sampler2D dwMedium;',
    'uniform float dwDt;',
    'uniform float dwDamping;',         //1/s, amplitude
    'uniform float dwViscosity;',       //cells²/s (VISCOSITY / DX²)
    'uniform float dwBank[' + (nD * K.classes) + '];',
    'uniform vec4 dwEmitNow[' + DW.MAX_EMITTERS + '];',
    'uniform vec4 dwEmitPrev[' + DW.MAX_EMITTERS + '];',
    'uniform float dwEmitFoam[' + DW.MAX_EMITTERS + '];',   //foam added at each centre this frame
    'uniform int dwEmitCount;',
    'uniform float dwFoamKeep;',        //exp(−DT / FOAM_LIFE)
    'const int DW_CLASSES = ' + K.classes + ';',
    //Kernel weight of radial class c at depth h (cells). Shallower than the first
    //fitted depth it scales down: in the shallow limit k·tanh(k·h) → h·k², linear in h.
    'float dwKW(int c, float h){',
    (function(){
      let s = '  if(h <= ' + f(depths[0]) + ') return dwBank[c] * h / ' + f(depths[0]) + ';\n';
      for(let i = 0; i < nD - 1; ++i){
        s += '  if(h <= ' + f(depths[i + 1]) + ') return mix(dwBank[' + i + ' * DW_CLASSES + c], dwBank[' + (i + 1) + ' * DW_CLASSES + c], (h - ' + f(depths[i]) + ') / ' + f(depths[i + 1] - depths[i]) + ');\n';
      }
      return s + '  return dwBank[' + (nD - 1) + ' * DW_CLASSES + c];';
    })(),
    '}',
    //One pair: the neighbour at offset o, at the pair's mean depth. A dry neighbour
    //is a wall (η = 0 there) seen at this cell's depth.
    'float dwPair(ivec2 p, ivec2 o, int c, float hc, float eC){',
    '  ivec2 q = clamp(p + o, ivec2(0), ivec2(DW_RES - 1));',
    '  vec2 mq = texelFetch(dwMedium, q, 0).rg;',
    '  float eq = texelFetch(dwState, q, 0).r;',
    '  float h = mq.g > 0.5 ? 0.5 * (hc + mq.r) : hc;',
    '  return dwKW(c, h) * (eq - eC);',
    '}',
    'float dwSponge(ivec2 p){',
    '  float d = float(min(min(p.x, p.y), min(DW_RES - 1 - p.x, DW_RES - 1 - p.y)));',
    '  float w = max(0.0, 1.0 - d / ' + f(DW.SPONGE_CELLS) + ');',
    '  return ' + f(DW.SPONGE_RATE) + ' * w * w;',
    '}',
    'float dwFootprint(vec4 e, vec2 xz){',
    '  vec2 d = xz - e.xy;',
    '  return e.w * exp(-dot(d, d) / max(e.z * e.z, 1.0e-6));',
    '}',
    'void main(){',
    '  ivec2 p = ivec2(gl_FragCoord.xy);',
    '  vec4 med = texelFetch(dwMedium, p, 0);',
    '  if(med.g < 0.5){ gl_FragColor = vec4(0.0); return; }',
    '  float hc = med.r;',
    '  vec3 s = texelFetch(dwState, p, 0).rgb;',
    '  float eC = s.r;',
    '  float conv = 0.0;',
    conv,
    '  float vC = s.r - s.g;',
    '  float lapV = -4.0 * vC;',
    '  ivec2 nb[4] = ivec2[4](ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1));',
    '  for(int k = 0; k < 4; ++k){',
    '    vec2 sq = texelFetch(dwState, clamp(p + nb[k], ivec2(0), ivec2(DW_RES - 1)), 0).rg;',
    '    lapV += sq.r - sq.g;',
    '  }',
    //Velocity damping (see the header): no spring term, so no detuning.
    '  float damp = dwDamping + dwSponge(p);',
    '  float next = (2.0 * s.r - s.g * (1.0 - damp * dwDt)',
    '             - ' + f(DW.G) + ' * dwDt * dwDt * conv / dwDx',
    '             + dwViscosity * dwDt * lapV) / (1.0 + damp * dwDt);',
    //Sources: the change of every footprint since the last frame, pushed down.
    '  vec2 xz = dwCellXZ(p);',
    '  float src = 0.0;',
    '  float foam = s.b * dwFoamKeep;',
    '  for(int i = 0; i < ' + DW.MAX_EMITTERS + '; ++i){',
    '    if(i >= dwEmitCount) break;',
    '    src += dwFootprint(dwEmitNow[i], xz) - dwFootprint(dwEmitPrev[i], xz);',
    '    vec2 fd = xz - dwEmitNow[i].xy;',
    '    foam += dwEmitFoam[i] * exp(-dot(fd, fd) / max(dwEmitNow[i].z * dwEmitNow[i].z, 1.0e-6));',
    '  }',
    //A DISPLACEMENT, so it moves η and the carried η⁻ alike. Subtracting it from
    //η⁺ alone makes η⁺ − η, the velocity, jump by src/dt: every bob of a floating
    //box became a kick, overdriving its rings by ~1/(ω·dt) ≈ 10× (a 0.4 m box
    //grew 4.7 m rings, headless 2026-09-26).
    '  gl_FragColor = vec4(next - src, s.r - src, min(foam, 1.5), 0.0);',
    '}'
  ].join('\n');
  const bankArr = Array.from(K.bank);
  this._stepMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      dwCenter: {value: new THREE.Vector2()},
      dwDx: {value: this.dx},
      dwState: {value: null},
      dwMedium: {value: null},
      dwDt: {value: 1.0 / 60.0},
      dwDamping: {value: DW.DAMPING},
      dwViscosity: {value: DW.VISCOSITY / (this.dx * this.dx)},
      dwBank: {value: bankArr},
      dwEmitNow: {value: this._emitNow},
      dwEmitPrev: {value: this._emitPrev},
      dwEmitFoam: {value: this._emitFoam},
      dwEmitCount: {value: 0},
      dwFoamKeep: {value: 1.0}
    },
    vertexShader: vert, fragmentShader: stepFrag, depthTest: false, depthWrite: false
  });

  this._clearMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: {},
    vertexShader: vert,
    fragmentShader: 'precision highp float;\nlayout(location = 0) out highp vec4 dwOut;\nvoid main(){ dwOut = vec4(0.0); }',
    depthTest: false, depthWrite: false
  });
};

ARestlessOcean.Passes.DynamicWavesPass.prototype._draw = function(material, target){
  const mesh = this._scene.children[0];
  mesh.material = material;
  this.renderer.setRenderTarget(target);
  this.renderer.render(this._scene, this._camera);
};

//Fill the emitter uniforms with (now, prev) pairs and retire what is done. An
//emitter whose last injection was at depth 0 and is inactive is dropped.
//frameDt (s): the time this frame's steps cover, for the foam rate.
ARestlessOcean.Passes.DynamicWavesPass.prototype._collectEmitters = function(frameDt){
  const DW = ARestlessOcean.DynamicWaves;
  const list = DW.emitters;
  let n = 0;
  for(let i = 0; i < list.length; ++i){
    const e = list[i];
    if(e._lifeFrames !== undefined){
      if(e._lifeFrames <= 0) e.active = false;
      e._lifeFrames--;
    }
    if(!e.active && !e.release){
      //Dropped without lifting out: forget it, inject nothing.
      e._prev = {x: e.x, z: e.z, r: e.radius, d: 0.0};
      continue;
    }
    const depthNow = e.active ? e.depth : 0.0;
    const now = {x: e.x, z: e.z, r: e.radius, d: depthNow};
    const prev = e._prev;
    const changed = !prev || prev.x !== now.x || prev.z !== now.z || prev.r !== now.r || prev.d !== now.d;
    //Outside the window both ends inject nothing; keep tracking it quietly.
    const inside = Math.abs(now.x - this.centerX) < this.halfWidth + 4.0 * now.r
                && Math.abs(now.z - this.centerZ) < this.halfWidth + 4.0 * now.r;
    if(changed && inside && n < DW.MAX_EMITTERS){
      this._emitNow[n].set(now.x, now.z, now.r, now.d);
      if(prev) this._emitPrev[n].set(prev.x, prev.z, prev.r, prev.d);
      else this._emitPrev[n].set(now.x, now.z, now.r, 0.0);
      if(this._emitFoam){
        this._emitFoam[n] = (e.active ? (e.foam || 0.0) * (frameDt || 0.0) : 0.0) + (e.foamBurst || 0.0);
        e.foamBurst = 0.0;
      }
      n++;
    }
    e._prev = now;
  }
  //Drop the finished: inactive and already lifted out.
  for(let i = list.length - 1; i >= 0; --i){
    const e = list[i];
    if(!e.active && e._prev && e._prev.d === 0.0) list.splice(i, 1);
  }
  return n;
};

//ctx: {timeMs, cameraX, cameraZ, enabled, depthCap}
ARestlessOcean.Passes.DynamicWavesPass.prototype.tick = function(ctx){
  const DW = ARestlessOcean.DynamicWaves;
  const field = this.oceanGrid.waterFieldPass;
  const lastTime = this._lastTimeMs;
  this._lastTimeMs = ctx.timeMs;
  this.active = !!(this.supported && this.enabled && ctx.enabled && field && field.cascades.length === 3);
  if(!this.active){
    //Emitters still need their baselines, or re-enabling injects a whole body at once.
    this._collectEmitters();
    return;
  }
  const dx = this.dx;
  const prevRT = this.renderer.getRenderTarget();
  let shiftX = 0, shiftZ = 0;
  const outside = Math.abs(ctx.cameraX - this.centerX) > this.halfWidth || Math.abs(ctx.cameraZ - this.centerZ) > this.halfWidth;
  if(this._needsReset || outside){
    this.centerX = Math.round(ctx.cameraX / dx) * dx;
    this.centerZ = Math.round(ctx.cameraZ / dx) * dx;
    this._draw(this._clearMaterial, this._state[0]);
    this._draw(this._clearMaterial, this._state[1]);
    this._lastBakeMs = -1e9;
    this._needsReset = false;
  } else {
    const limit = DW.RECENTER_FRACTION * this.halfWidth;
    if(Math.abs(ctx.cameraX - this.centerX) > limit || Math.abs(ctx.cameraZ - this.centerZ) > limit){
      shiftX = Math.round((ctx.cameraX - this.centerX) / dx);
      shiftZ = Math.round((ctx.cameraZ - this.centerZ) / dx);
      this.centerX += shiftX * dx;
      this.centerZ += shiftZ * dx;
    }
  }

  const refills = field.refillCount;
  if(shiftX !== 0 || shiftZ !== 0 || refills !== this._lastRefills || ctx.timeMs - this._lastBakeMs > DW.REBAKE_MS){
    const bu = this._bakeMaterial.uniforms;
    field.bindUniforms(bu);
    const c0 = field.cascades[0];
    bu.dwFieldFlow.value = c0.target.textures[1];
    bu.dwFieldFlowCenter.value.set(c0.centerX, c0.centerZ);
    bu.dwFieldFlowHalfWidth.value = c0.halfWidth;
    bu.dwCenter.value.set(this.centerX, this.centerZ);
    bu.dwDx.value = dx;
    bu.dwDepthCap.value = ctx.depthCap;
    this._draw(this._bakeMaterial, this._medium);
    this._lastRefills = refills;
    this._lastBakeMs = ctx.timeMs;
  }

  const frameDt = lastTime === null ? DW.DT : Math.max(0.0, (ctx.timeMs - lastTime) * 0.001);
  this._accum = Math.min((this._accum || 0.0) + frameDt, DW.MAX_STEPS_PER_FRAME * DW.DT);
  let steps = Math.floor(this._accum / DW.DT + 1e-6);
  this._accum -= steps * DW.DT;
  //A window shift must be applied this frame even if no step is due.
  if(steps === 0 && (shiftX !== 0 || shiftZ !== 0)) steps = 1;
  //Sources wait for a frame that steps: collecting advances each emitter's baseline.
  const emitCount = steps > 0 ? this._collectEmitters(steps * DW.DT) : 0;

  const au = this._advectMaterial.uniforms;
  const su = this._stepMaterial.uniforms;
  au.dwCenter.value.set(this.centerX, this.centerZ);
  au.dwMedium.value = this._medium.texture;
  au.dwDt.value = DW.DT;
  su.dwCenter.value.set(this.centerX, this.centerZ);
  su.dwState.value = this._advected.texture;
  su.dwMedium.value = this._medium.texture;
  su.dwDt.value = DW.DT;
  //Live knobs. Explicit viscosity on the velocity is stable while the grid corner's
  //factor |1 − 8·ν·dt| stays under 1 with the leapfrog on top: measured unstable
  //from ~15 cells²/s (tests/dynamic-waves), so the clamp is 8 (0.125 m²/s at
  //DX 0.125, 12× the default).
  su.dwDamping.value = Math.max(0.0, DW.DAMPING);
  su.dwViscosity.value = Math.min(8.0, Math.max(0.0, DW.VISCOSITY / (dx * dx)));
  su.dwFoamKeep.value = DW.FOAM_LIFE > 0.0 ? Math.exp(-DW.DT / DW.FOAM_LIFE) : 0.0;
  for(let i = 0; i < steps; ++i){
    //The shift and the frame's sources go in with the first step only.
    au.dwState.value = this._state[this._read].texture;
    au.dwShift.value.set(i === 0 ? shiftX : 0, i === 0 ? shiftZ : 0);
    this._draw(this._advectMaterial, this._advected);
    su.dwEmitCount.value = i === 0 ? emitCount : 0;
    this._draw(this._stepMaterial, this._state[1 - this._read]);
    this._read = 1 - this._read;
    this.stepCount++;
  }
  this.renderer.setRenderTarget(prevRT);
};

ARestlessOcean.Passes.DynamicWavesPass.prototype.consumerState = function(){
  const s = this._consumer || (this._consumer = {});
  s.enabled = this.active;
  s.texture = this._state ? this._state[this._read].texture : null;
  s.centerX = this.centerX;
  s.centerZ = this.centerZ;
  s.halfWidth = this.halfWidth;
  s.dx = this.dx;
  s.scale = this.scale;
  return s;
};

//Debug: synchronous read of the state (one 512² float read; stalls the GPU).
ARestlessOcean.Passes.DynamicWavesPass.prototype.readback = function(){
  if(!this._state) return null;
  const RES = ARestlessOcean.DynamicWaves.RESOLUTION;
  const gl = this.renderer.getContext();
  const prevPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  if(prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const state = new Float32Array(RES * RES * 4);
  const medium = new Float32Array(RES * RES * 4);
  this.renderer.readRenderTargetPixels(this._state[this._read], 0, 0, RES, RES, state);
  this.renderer.readRenderTargetPixels(this._medium, 0, 0, RES, RES, medium);
  if(prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPack);
  return {state: state, medium: medium, res: RES, centerX: this.centerX, centerZ: this.centerZ, dx: this.dx};
};

ARestlessOcean.Passes.DynamicWavesPass.prototype.dispose = function(){
  if(this._state) this._state.forEach(function(t){ t.dispose(); });
  if(this._advected) this._advected.dispose();
  if(this._medium) this._medium.dispose();
  [this._stepMaterial, this._bakeMaterial, this._advectMaterial, this._clearMaterial].forEach(function(m){ if(m) m.dispose(); });
};
