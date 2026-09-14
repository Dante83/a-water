//=============================================================================
// OceanWaveField — analytic CPU mirror of the GPU FFT ocean, for physics.
//=============================================================================
//
// The rendered ocean is a 6-cascade GPU FFT (ocean-height-band-library.js). The
// CPU can't cheaply read that surface back every frame, so for buoyancy and any
// "what is the water height at (x, z)?" gameplay query we reconstruct a
// STATISTICAL twin of the same sea state out of a modest set of Gerstner waves.
//
// "Statistical twin" — not a per-fragment match. We pull our waves from the
// IDENTICAL JONSWAP spectrum, wind, per-cascade wind rotation, peak frequency
// (omega_p) and directional-spread formula the GPU h_0 pass uses (see
// h_0-pass.js), so the dominant wavelength, direction, period and significant
// wave height all agree with the rendered surface. The instantaneous height at
// a single point can differ from the FFT by tens of cm on chop because we use
// random phases (the GPU's phases live in noise textures we don't share) and a
// few dozen components instead of ~65k bins. For floating objects and swimmers
// that reads as correct — the body rides the right swell at the right cadence.
//
// Because every spectral parameter is read straight from the band library, the
// physics field and the renderer CANNOT drift apart: change the wind and both
// rebuild from the same omega_p. See ocean-height-band-library.js regenerateH0,
// which calls rebuild() on this field.
//
// Amplitude calibration: rather than chase the FFT's IFFT normalization
// analytically, we shape the components from the spectrum (relative energy per
// direction/scale) and then rescale the whole set so the surface variance
// matches the PHYSICAL significant wave height the band library documents
// (Hs ≈ 0.21·U²/g·gamma^0.3, ~2.73 m for the default wind). The artistic
// `wave_scale_multiple` dial is then applied on top here exactly as the vertex
// shader applies waveHeightMultiplier — so visual surface and physics surface
// share both the physical amplitude and the artistic boost.
//
// Public surface:
//   ARestlessOcean.waveField                         — active instance (or null)
//   ARestlessOcean.sampleWaterHeight(x, z)           — height at world XZ, now
//   ARestlessOcean.sampleWaterDisplacement(x,z,out)  — full Gerstner xyz, now
//   ARestlessOcean.sampleWaterNormal(x, z, out)      — surface normal, now
// The *(x, z, t)* instance methods take an explicit time (seconds) so a worker
// or a predict-ahead integrator can sample any time without a frame tick.

ARestlessOcean.OceanWaveField = function(bandLibrary, data){
  this.bandLibrary = bandLibrary;
  this.data = data;
  this.components = [];
  //Advanced once per frame by the band library tick (seconds; same /1000 base
  //as the h_k shader's uTime). The public sampleWaterHeight() convenience uses
  //this; the (x, z, t) instance methods take time explicitly instead.
  this.currentTimeSeconds = 0.0;
  this.rebuild();
};

//Number of directional buckets the spectrum energy of each cascade is collapsed
//into. Each non-empty bucket becomes one Gerstner wave whose direction is the
//energy-weighted mean of the bins that fell in it. 16 around the full circle is
//plenty to capture the wind lobe plus its cross-wind spread without producing
//more components than per-frame sampling wants to evaluate.
ARestlessOcean.OceanWaveField.NUM_DIRECTION_BUCKETS = 16;

//Buckets carrying less than this fraction of the peak bucket's energy are
//dropped — they contribute imperceptible motion but cost a full cos() per
//sample. Keeps the active component count to a few dozen.
ARestlessOcean.OceanWaveField.ENERGY_PRUNE_FRACTION = 0.0025;

//Rebuild the Gerstner component set from the band library's CURRENT spectrum
//state. Safe to call any time wind / fetch / gamma / turbulence change; the
//band library's regenerateH0 already does.
ARestlessOcean.OceanWaveField.prototype.rebuild = function(){
  const data = this.data;
  const bandLibrary = this.bandLibrary;

  //Artistic + framing dials, mirrored from the live component data so a runtime
  //change is picked up on the next rebuild. waveHeightMultiplier matches the
  //vertex shader's wave_scale_multiple; chop scales horizontal Gerstner
  //displacement like the shader's chop; heightOffset lifts the whole rest plane.
  this.heightOffset = (data.height_offset !== undefined) ? data.height_offset : 0.0;
  //Water-level seam for the analytic twin (Phase 1a). Null => use the flat
  //heightOffset above, which is exactly 0.2.0 behaviour. OceanGrid installs a
  //provider pointing at its own waterLevelAt, so the CPU twin and the rendered
  //surface cannot disagree about where the water is — if those drift, buoyancy
  //floats objects at a different height than the water you can see.
  this.levelProvider = null;
  //Per-cascade amplitude seam (Phase 2). Null => every cascade at full weight,
  //which is 0.2.0 behaviour. OceanGrid installs one that runs WaveMask.compute
  //on the same field the vertex shader reads, so a float on a glassy lake does
  //not keep bobbing on ocean swell. Signature: (x, z, out6) -> out6.
  this.maskProvider = null;
  this._maskScratch = [1, 1, 1, 1, 1, 1];
  this.waveHeightMultiplier = (data.wave_scale_multiple !== undefined) ? data.wave_scale_multiple : 1.5;
  this.chop = (data.chop !== undefined) ? data.chop : 1.0;

  const turbulence = (data.directional_turbulence !== undefined) ? data.directional_turbulence : 0.145;
  const windSpeed = (bandLibrary.w && this.data.wind_velocity)
    ? Math.sqrt(this.data.wind_velocity.x * this.data.wind_velocity.x +
                this.data.wind_velocity.y * this.data.wind_velocity.y)
    : 0.0;

  this.components = ARestlessOcean.OceanWaveField.buildGerstnerComponents(
    bandLibrary.cascadePatchSizes, bandLibrary.N, bandLibrary.omega_p,
    bandLibrary.jonswapGamma, turbulence, bandLibrary.w, windSpeed);
};

//Deterministic small LCG so a rebuild always lays the random phases down the
//same way (reproducible physics across reloads). Seed is arbitrary but fixed.
ARestlessOcean.OceanWaveField._mulberry32 = function(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
  };
};

//Collapse the discrete JONSWAP spectrum (the same one h_0-pass.js writes to the
//GPU) into a set of Gerstner traveling waves. Mirrors the bin loop in
//OceanHeightBandLibrary.computeCascadeSlopeVariance, but instead of summing
//slope variance we bucket each bin's height energy by direction (per cascade)
//and emit one wave per non-empty bucket.
//
// Returns Array<{kx, ky, omega, amp, phase, dirX, dirZ}> in WORLD units:
//   k = (kx, ky) maps to world (x, z); amp is metres (pre-waveHeightMultiplier);
//   omega rad/s; dir is the unit propagation direction.
ARestlessOcean.OceanWaveField.buildGerstnerComponents = function(
    cascadePatchSizes, N, omega_p, gamma, directionalTurbulence, windDir, windSpeed){
  const g = 9.80665;
  const piTimes2 = 2.0 * Math.PI;
  const JONSWAP_ALPHA = 0.0081;
  const WAVE_SAMPLE_LOW = 2.0;
  const WAVE_SAMPLE_HIGH = 8.0;
  const turb = Math.max(0.0, Math.min(1.0, directionalTurbulence));
  const numCascades = cascadePatchSizes.length;
  const numBuckets = ARestlessOcean.OceanWaveField.NUM_DIRECTION_BUCKETS;
  const halfN = N * 0.5;
  const rng = ARestlessOcean.OceanWaveField._mulberry32(0x0CEA0FED);

  //Dead-calm sea: no wind, no waves. omega_p was set to a sentinel huge value
  //by the band library, which would just produce zero energy anyway — bail to a
  //flat field so callers sit objects exactly on the rest plane.
  if(!(windSpeed > 0.001)){
    return [];
  }

  const components = [];
  let modelM0 = 0.0; //Σ amp²/2 across all components == surface height variance.

  for(let c = 0; c < numCascades; c++){
    const L = cascadePatchSizes[c];
    const dk = piTimes2 / L;
    const sampleLow  = (c === 0) ? 0.0 : WAVE_SAMPLE_LOW;
    const sampleHigh = (c === numCascades - 1) ? N : WAVE_SAMPLE_HIGH;
    const sampleLowCulled = Math.max(sampleLow, 1.0);

    //Per-cascade wind rotation — identical to the h_0 pass, so each cascade's
    //wave-front orientation matches what's rendered.
    const wRot = ARestlessOcean.LUTlibraries.OceanHeightBandLibrary.rotateWindForCascade(windDir, c);
    const wLen = Math.sqrt(wRot.x * wRot.x + wRot.y * wRot.y) || 1.0;
    const wnx = wRot.x / wLen, wny = wRot.y / wLen;

    //Per-direction-bucket accumulators: energy-weighted sums of k so each
    //bucket's emitted wave points along the mean direction of its bins.
    const sumVar = new Float64Array(numBuckets);
    const sumVarKx = new Float64Array(numBuckets);
    const sumVarKy = new Float64Array(numBuckets);

    for(let ny = 0; ny < N; ny++){
      const coordY = ny - halfN;
      for(let nx = 0; nx < N; nx++){
        const coordX = nx - halfN;
        const maxCoord = Math.max(Math.abs(coordX), Math.abs(coordY));
        if(maxCoord < sampleLowCulled || maxCoord >= sampleHigh) continue;

        const kx = dk * coordX;
        const ky = dk * coordY;
        const k2 = kx * kx + ky * ky;
        const magK = Math.sqrt(k2);
        if(magK < 1e-4) continue;

        //JONSWAP S(omega) → S(k) → 2D, exactly as h_0-pass.js.
        const omega = Math.sqrt(g * magK);
        const sigma = omega <= omega_p ? 0.07 : 0.09;
        const r = Math.exp(-((omega - omega_p) * (omega - omega_p)) /
                           (2.0 * sigma * sigma * omega_p * omega_p));
        const pm = JONSWAP_ALPHA * g * g / Math.pow(omega, 5.0) *
                   Math.exp(-1.25 * Math.pow(omega_p / omega, 4.0));
        const jonswap = pm * Math.pow(gamma, r);
        const Sk = jonswap * g / (2.0 * omega);

        //h_0 coefficient (A = 1, physical) and the directional spread for THIS
        //bin's own direction — same mix(cos²θ, ½, turb) the shader uses. We loop
        //the full grid, so the +k and −k partners are visited separately and
        //get their own (asymmetric) spread, just like on the GPU.
        const h0Coef = Math.sqrt(Sk * dk * dk / (2.0 * magK));
        const dKdotW = (kx * wnx + ky * wny) / magK;
        const spread = (1.0 - turb) * (dKdotW * dKdotW) + turb * 0.5;
        const h0k = h0Coef * spread;
        const binVar = h0k * h0k; //relative height energy of this bin.
        if(binVar <= 0.0) continue;

        //Bucket by propagation direction.
        let theta = Math.atan2(ky, kx); //(-π, π]
        let b = Math.floor((theta + Math.PI) / piTimes2 * numBuckets);
        if(b < 0) b = 0; else if(b >= numBuckets) b = numBuckets - 1;
        sumVar[b]   += binVar;
        sumVarKx[b] += binVar * kx;
        sumVarKy[b] += binVar * ky;
      }
    }

    //Emit one Gerstner wave per non-empty bucket. amp = √(2·energy) so that the
    //wave's own variance amp²/2 equals the bucket's accumulated energy.
    for(let b = 0; b < numBuckets; b++){
      const v = sumVar[b];
      if(v <= 0.0) continue;
      const meanKx = sumVarKx[b] / v;
      const meanKy = sumVarKy[b] / v;
      const kMag = Math.sqrt(meanKx * meanKx + meanKy * meanKy);
      if(kMag < 1e-5) continue;
      const amp = Math.sqrt(2.0 * v);
      components.push({
        kx: meanKx, ky: meanKy,
        dirX: meanKx / kMag, dirZ: meanKy / kMag,
        omega: Math.sqrt(g * kMag),
        amp: amp,
        phase: rng() * piTimes2,
        cascade: c
      });
      modelM0 += v;
    }
  }

  if(components.length === 0 || modelM0 < 1e-12){
    return [];
  }

  //Prune negligible components (cross-wind dribble) relative to the strongest.
  let peak = 0.0;
  for(let i = 0; i < components.length; i++){
    const e = 0.5 * components[i].amp * components[i].amp;
    if(e > peak) peak = e;
  }
  const cutoff = peak * ARestlessOcean.OceanWaveField.ENERGY_PRUNE_FRACTION;
  const kept = [];
  let keptM0 = 0.0;
  for(let i = 0; i < components.length; i++){
    const e = 0.5 * components[i].amp * components[i].amp;
    if(e >= cutoff){ kept.push(components[i]); keptM0 += e; }
  }
  if(kept.length === 0 || keptM0 < 1e-12) return [];

  //Calibrate absolute amplitude to the PHYSICAL significant wave height the
  //band library documents: Hs = 0.21·U²/g · gamma^0.3 (PM × JONSWAP boost).
  //Surface variance m0 = (Hs/4)². Rescale every amp by √(m0_target / m0_model)
  //so √(Σ amp²/2) lands on the right Hs — independent of any IFFT normalization
  //constant, which is why we don't try to derive amplitude through the FFT.
  const Hs = 0.21 * windSpeed * windSpeed / g * Math.pow(gamma, 0.3);
  const m0Target = (Hs * 0.25) * (Hs * 0.25);
  const ampScale = Math.sqrt(m0Target / keptM0);
  for(let i = 0; i < kept.length; i++){
    kept[i].amp *= ampScale;
  }
  return kept;
};

//Vertical water height at world (x, z) and time t (seconds). Cheap: one cos()
//per component. Ignores the horizontal Gerstner shift (the crest "leans"), which
//is the standard forgiving approximation for height queries — multi-probe
//averaging in the buoyant component smooths the residual. Use
//sampleDisplacement when you need the full leaned position.
ARestlessOcean.OceanWaveField.prototype.sampleHeight = function(x, z, t){
  const comps = this.components;
  const mask = this._masksAt(x, z);
  let h = 0.0;
  for(let i = 0; i < comps.length; i++){
    const c = comps[i];
    h += mask[c.cascade] * c.amp * Math.cos(c.kx * x + c.ky * z - c.omega * t + c.phase);
  }
  return this.levelAt(x, z) + this.waveHeightMultiplier * h;
};

//Full Gerstner displacement at world (x, z), t. out is a THREE.Vector3 (or any
//{x,y,z}); returns it. x/z carry the horizontal "lean" scaled by chop, y the
//height (incl. heightOffset). Useful for spray emitters, true-surface markers.
ARestlessOcean.OceanWaveField.prototype.sampleDisplacement = function(x, z, t, out){
  const comps = this.components;
  const mask = this._masksAt(x, z);
  let dx = 0.0, dy = 0.0, dz = 0.0;
  for(let i = 0; i < comps.length; i++){
    const c = comps[i];
    const arg = c.kx * x + c.ky * z - c.omega * t + c.phase;
    const amp = mask[c.cascade] * c.amp;
    dy += amp * Math.cos(arg);
    const s = amp * Math.sin(arg);
    dx -= c.dirX * s;
    dz -= c.dirZ * s;
  }
  out.x = this.waveHeightMultiplier * this.chop * dx;
  out.y = this.levelAt(x, z) + this.waveHeightMultiplier * dy;
  out.z = this.waveHeightMultiplier * this.chop * dz;
  return out;
};

//Surface normal at world (x, z), t via central differences of sampleHeight.
//Robust and cheap (4 height samples) — avoids the messy analytic Gerstner
//partials once the chop term is in play. out is a THREE.Vector3; returns it
//normalized.
ARestlessOcean.OceanWaveField.prototype.sampleNormal = function(x, z, t, out){
  const eps = 0.25; //metres; ~capillary-cascade scale, stable for tilt.
  const hL = this.sampleHeight(x - eps, z, t);
  const hR = this.sampleHeight(x + eps, z, t);
  const hD = this.sampleHeight(x, z - eps, t);
  const hU = this.sampleHeight(x, z + eps, t);
  out.x = -(hR - hL) / (2.0 * eps);
  out.y = 1.0;
  out.z = -(hU - hD) / (2.0 * eps);
  const inv = 1.0 / Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z);
  out.x *= inv; out.y *= inv; out.z *= inv;
  return out;
};

//===========================================================================
// Public convenience API — delegate to the active field at the current frame
// time. These are the entry points gameplay code (swimming, floating props,
// dock pilings) should reach for; they no-op gracefully before the ocean is up.
//===========================================================================
ARestlessOcean.waveField = null;

ARestlessOcean.sampleWaterHeight = function(x, z){
  const f = ARestlessOcean.waveField;
  return f ? f.sampleHeight(x, z, f.currentTimeSeconds) : 0.0;
};

ARestlessOcean.sampleWaterDisplacement = function(x, z, out){
  out = out || new THREE.Vector3();
  const f = ARestlessOcean.waveField;
  if(f) return f.sampleDisplacement(x, z, f.currentTimeSeconds, out);
  out.set(0, 0, 0);
  return out;
};

ARestlessOcean.sampleWaterNormal = function(x, z, out){
  out = out || new THREE.Vector3();
  const f = ARestlessOcean.waveField;
  if(f) return f.sampleNormal(x, z, f.currentTimeSeconds, out);
  out.set(0, 1, 0);
  return out;
};

//DEBUG: compare the analytic field (what buoyancy uses) against the ACTUAL
//rendered FFT surface (GPU readback, ocean-grid.sampleFFTHeightAt) at world
//(x, z). They share the same spectrum/wind/period, so they agree statistically
//— but their crests sit in DIFFERENT places because the analytic twin uses its
//own random phases (the GPU's phases live in noise textures we don't share). So
//a nonzero Δ at a point is EXPECTED, not a bug; it's why a float can ride a crest
//the rendered surface shows as a trough. Call from the console, e.g.
//   ARestlessOcean.debugWaveAt(2, -45)
//or watch a floating cube:  setInterval(()=>ARestlessOcean.debugWaveAt(2,-45),250)
//The FFT readback is synchronous (stalls the GPU) — debugging only, kill when done.
//$DEBUG_START$
ARestlessOcean.debugWaveAt = function(x, z){
  const a = ARestlessOcean.sampleWaterHeight(x, z);
  //Compare against the EXACT synchronous readback (ground truth), not the cached
  //snapshot, so the debug works even when no float is keeping the snapshot warm.
  const f = (typeof ARestlessOcean.sampleWaterHeightFFTExact === 'function')
    ? ARestlessOcean.sampleWaterHeightFFTExact(x, z) : null;
  if(f === null || f === undefined){
    console.log(`[wave @ ${x.toFixed(1)}, ${z.toFixed(1)}]  analytic=${a.toFixed(3)} m   (FFT readback not ready)`);
    return {analytic: a, fft: null};
  }
  console.log(`[wave @ ${x.toFixed(1)}, ${z.toFixed(1)}]  analytic=${a.toFixed(3)} m   FFT=${f.toFixed(3)} m   Δ=${(a - f).toFixed(3)} m`);
  return {analytic: a, fft: f, diff: a - f};
};
//$DEBUG_END$

//Rest water level at world (x, z) — the analytic twin's half of the water-level
//seam. Falls back to the flat heightOffset when no provider is installed, which
//is exactly 0.2.0 behaviour, so routing callers through this changes nothing
//until Phase 1b gives the provider real data.
ARestlessOcean.OceanWaveField.prototype.levelAt = function(x, z){
  return this.levelProvider ? this.levelProvider(x, z) : this.heightOffset;
};

//Per-cascade weights at (x, z) from the mask seam, or all ones. Returns a
//shared scratch array: read it before the next call.
ARestlessOcean.OceanWaveField.prototype._masksAt = function(x, z){
  const m = this._maskScratch;
  if(this.maskProvider){
    this.maskProvider(x, z, m);
  } else {
    for(let c = 0; c < 6; c++) m[c] = 1.0;
  }
  return m;
};

//=============================================================================
// WaveMask — per-cascade wave amplitude from the WaterField (Phase 2).
//=============================================================================
//
// The FFT spectrum is GLOBAL: one set of h_0 textures, evaluated once for the
// whole world. So it cannot hold a per-place water depth or a per-lake fetch.
// What can vary per place is how much of each cascade we keep. This is that
// weight, one per cascade, from two pieces of spectral physics the ocean
// spectrum itself already contains:
//
//  1. DEPTH (TMA). Bouws et al. 1985 multiply JONSWAP by Kitaigorodskii's
//     depth function φ(ω_h), ω_h = ω·√(h/g). Under the deep-water dispersion
//     the FFT uses (ω² = g·k) that is ω_h = √(k·h). φ scales ENERGY, so the
//     amplitude weight is √φ:
//        φ = ω_h²/2              ω_h ≤ 1
//        φ = 1 − (2 − ω_h)²/2    1 < ω_h < 2
//        φ = 1                   ω_h ≥ 2
//
//  2. FETCH (JONSWAP). A lake is the same spectrum with a short fetch. The
//     ocean's peak is ω_p = max(22·(g²/(U·F))^(1/3), 0.86·g/U) (the band
//     library's own formula), and the Pierson-Moskowitz low-frequency cutoff
//     exp(−1.25·(ω_p/ω)⁴) = exp(−1.25·(k_p/k)²) is what removes waves longer
//     than the peak. A body with a shorter fetch has a larger k_p; the
//     amplitude ratio against the ocean's own cutoff is
//        exp(−0.625·(k_p,local² − k_p,ocean²) / k²)   ≤ 1.
//     Only INLAND water gets a fetch (level differs from sea level): the
//     coast keeps the full ocean spectrum, because swell arrives from far
//     beyond any local shoreline. The fetch itself is a PROXY, 2·shoreSDF:
//     exact at the centre of a round lake, short near every rim (so a lake
//     calms toward all of its shores, not only the upwind one). A real
//     directional fetch is a-land contract's reserved class channel.
//
// Each cascade is a band of wavenumbers, and the weight is evaluated at ONE
// representative k per cascade: the local spectral peak clamped into that band,
// i.e. the wavenumber carrying most of the band's energy.
//
// What this does NOT do: shallow water also slows waves (ω² = g·k·tanh(k·h)),
// and a height weight cannot change phase speed. Shoaling growth and breaking
// are Phase 3. This is the equilibrium spectrum, not the surf zone.
//
// ONE SOURCE, THREE GPU CONSUMERS. `WaveMask.GLSL` is spliced into the water
// vertex shader, the ocean CSM caster and the CPU height-field bake at the
// `$wave_mask_functions` token, so the rendered surface, its shadow caster and
// the readback can never weigh a cascade differently. `WaveMask.compute` is the
// line-for-line JS mirror for the analytic twin and the submersion probe.
//
// Field sample convention (WaterFieldPass RT0): (level, depth, shoreSDF, dryMask).

ARestlessOcean.WaveMask = {};

ARestlessOcean.WaveMask.NUM_CASCADES = 6;
//Depth used for "treat as deep": a guessed zero (standalone foam ortho under a
//pier or boat deck) and texels at the terrain provider's depth cap.
ARestlessOcean.WaveMask.DEEP = 1.0e6;
//Inland = |level − sea level| ramps over this band (metres).
ARestlessOcean.WaveMask.INLAND_START = 0.5;
ARestlessOcean.WaveMask.INLAND_FULL = 2.0;
//Shortest fetch the proxy will report (metres).
ARestlessOcean.WaveMask.MIN_FETCH = 4.0;
//A decoded depth at or above this fraction of the provider's maxDepth is the
//encoding's saturation, not a shallow sea.
ARestlessOcean.WaveMask.DEPTH_CAP_FRACTION = 0.98;

ARestlessOcean.WaveMask.createUniforms = function(){
  const bandK = [];
  for(let c = 0; c < ARestlessOcean.WaveMask.NUM_CASCADES; ++c) bandK.push(new THREE.Vector2(0.0, 1.0e6));
  return {
    waveMaskEnabled:   {value: 1.0},
    waveMaskPeakK:     {value: 1.0},        //k_p of the OCEAN spectrum, rad/m
    waveMaskWindSpeed: {value: 0.0},        //|U|, m/s
    waveMaskOceanFetch:{value: 100000.0},   //the band library's JONSWAP fetch, m
    waveMaskSeaLevel:  {value: 0.0},
    waveMaskDepthCap:  {value: 1.0e9},      //provider maxDepth; effectively none standalone
    waveMaskBandK:     {value: bandK}       //per cascade (kLo, kHi), rad/m
  };
};

//Copy wave-mask uniform VALUES from src into dst (both from createUniforms).
ARestlessOcean.WaveMask.copyUniforms = function(dst, src){
  dst.waveMaskEnabled.value = src.waveMaskEnabled.value;
  dst.waveMaskPeakK.value = src.waveMaskPeakK.value;
  dst.waveMaskWindSpeed.value = src.waveMaskWindSpeed.value;
  dst.waveMaskOceanFetch.value = src.waveMaskOceanFetch.value;
  dst.waveMaskSeaLevel.value = src.waveMaskSeaLevel.value;
  dst.waveMaskDepthCap.value = src.waveMaskDepthCap.value;
  for(let c = 0; c < ARestlessOcean.WaveMask.NUM_CASCADES; ++c){
    dst.waveMaskBandK.value[c].copy(src.waveMaskBandK.value[c]);
  }
};

//Push params (see paramsFrom) into a createUniforms() object.
ARestlessOcean.WaveMask.writeUniforms = function(u, p){
  u.waveMaskEnabled.value = p.enabled ? 1.0 : 0.0;
  u.waveMaskPeakK.value = p.peakK;
  u.waveMaskWindSpeed.value = p.windSpeed;
  u.waveMaskOceanFetch.value = p.oceanFetch;
  u.waveMaskSeaLevel.value = p.seaLevel;
  u.waveMaskDepthCap.value = p.depthCap;
  for(let c = 0; c < ARestlessOcean.WaveMask.NUM_CASCADES; ++c){
    u.waveMaskBandK.value[c].set(p.bandKLo[c], p.bandKHi[c]);
  }
};

//Per-cascade wavenumber band from the band library's centred-FFT sample band
//[sampleLow, sampleHigh) on max(|nx|, |ny|): k = 2π·coord/L. DC is always culled
//(coord ≥ 1) and coord never exceeds N/2.
ARestlessOcean.WaveMask.bandFromLibrary = function(bandLibrary, outLo, outHi){
  const n = ARestlessOcean.WaveMask.NUM_CASCADES;
  for(let c = 0; c < n; ++c){
    const L = bandLibrary.cascadePatchSizes[c];
    const lo = Math.max(bandLibrary.cascadeSampleLow[c], 1.0);
    const hi = Math.min(bandLibrary.cascadeSampleHigh[c], bandLibrary.N * 0.5);
    outLo[c] = 2.0 * Math.PI * lo / L;
    outHi[c] = 2.0 * Math.PI * hi / L;
  }
};

//Peak wavenumber for wind speed U over fetch F, the band library's ω_p formula.
ARestlessOcean.WaveMask.peakK = function(U, F){
  const g = 9.80665;
  if(!(U > 0.001)) return 1.0e6;
  const omega = Math.max(22.0 * Math.pow(g * g / (U * Math.max(F, 1e-3)), 1.0 / 3.0), 0.86 * g / U);
  return omega * omega / g;
};

ARestlessOcean.WaveMask.depthAmplitude = function(kh){
  const wh = Math.sqrt(Math.max(kh, 0.0));
  const phi = (wh <= 1.0) ? 0.5 * wh * wh : ((wh < 2.0) ? 1.0 - 0.5 * (2.0 - wh) * (2.0 - wh) : 1.0);
  return Math.sqrt(phi);
};

//JS mirror of waveMaskCascades in GLSL below. out: array of 6 weights.
ARestlessOcean.WaveMask.compute = function(out, level, depth, shoreSDF, dryMask, p){
  const WM = ARestlessOcean.WaveMask;
  const n = WM.NUM_CASCADES;
  if(!p || !p.enabled){
    for(let c = 0; c < n; ++c) out[c] = 1.0;
    return out;
  }
  let h = depth;
  if(h >= p.depthCap * WM.DEPTH_CAP_FRACTION || (h <= 0.0 && dryMask < 0.5)) h = WM.DEEP;
  const t = Math.min(1.0, Math.max(0.0,
    (Math.abs(level - p.seaLevel) - WM.INLAND_START) / (WM.INLAND_FULL - WM.INLAND_START)));
  const inland = t * t * (3.0 - 2.0 * t);
  const kpO = p.peakK;
  let kpL = kpO;
  if(inland > 0.0 && p.windSpeed > 0.001){
    const fetch = Math.max(2.0 * shoreSDF, WM.MIN_FETCH);
    const kpF = Math.max(kpO, WM.peakK(p.windSpeed, Math.min(fetch, p.oceanFetch)));
    kpL = kpO + (kpF - kpO) * inland;
  }
  const wet = 1.0 - Math.min(1.0, Math.max(0.0, dryMask));
  for(let c = 0; c < n; ++c){
    const k = Math.min(p.bandKHi[c], Math.max(p.bandKLo[c], kpL));
    const fetchAmp = Math.exp(-0.625 * (kpL * kpL - kpO * kpO) / (k * k));
    out[c] = wet * fetchAmp * WM.depthAmplitude(k * h);
  }
  return out;
};

//Build the params object from the live ocean. seaLevel/depthCap come from the
//grid (the terrain provider owns the cap).
ARestlessOcean.WaveMask.paramsFrom = function(bandLibrary, seaLevel, depthCap, enabled, out){
  const WM = ARestlessOcean.WaveMask;
  out = out || {bandKLo: new Array(WM.NUM_CASCADES), bandKHi: new Array(WM.NUM_CASCADES)};
  out.enabled = enabled !== false;
  out.peakK = bandLibrary.omega_p * bandLibrary.omega_p / 9.80665;
  out.windSpeed = bandLibrary.windSpeed || 0.0;
  out.oceanFetch = bandLibrary.fetch || 100000.0;
  out.seaLevel = seaLevel;
  out.depthCap = depthCap;
  WM.bandFromLibrary(bandLibrary, out.bandKLo, out.bandKHi);
  return out;
};

//GLSL ES 1.00. Declares its own uniforms. Unrolled per cascade because the
//water shaders never dynamically index a uniform array.
ARestlessOcean.WaveMask.GLSL = [
  '//── WaveMask (spliced from ocean-wave-field.js — edit it THERE) ──',
  'uniform float waveMaskEnabled;',
  'uniform float waveMaskPeakK;',
  'uniform float waveMaskWindSpeed;',
  'uniform float waveMaskOceanFetch;',
  'uniform float waveMaskSeaLevel;',
  'uniform float waveMaskDepthCap;',
  'uniform vec2 waveMaskBandK[6];',
  'float waveMaskPeakKFor(float U, float F){',
  '  const float g = 9.80665;',
  '  float omega = max(22.0 * pow(g * g / (U * max(F, 0.001)), 1.0 / 3.0), 0.86 * g / U);',
  '  return omega * omega / g;',
  '}',
  'float waveMaskDepthAmplitude(float kh){',
  '  float wh = sqrt(max(kh, 0.0));',
  '  float phi = (wh <= 1.0) ? 0.5 * wh * wh : ((wh < 2.0) ? 1.0 - 0.5 * (2.0 - wh) * (2.0 - wh) : 1.0);',
  '  return sqrt(phi);',
  '}',
  'float waveMaskOne(vec2 bandK, float kpL, float kpO, float h, float wet){',
  '  float k = clamp(kpL, bandK.x, bandK.y);',
  '  float fetchAmp = exp(-0.625 * (kpL * kpL - kpO * kpO) / (k * k));',
  '  return wet * fetchAmp * waveMaskDepthAmplitude(k * h);',
  '}',
  '//field = (level, depth, shoreSDF, dryMask). Writes cascades 0-2 to a, 3-5 to b.',
  'void waveMaskCascades(vec4 field, out vec3 a, out vec3 b){',
  '  if(waveMaskEnabled < 0.5){ a = vec3(1.0); b = vec3(1.0); return; }',
  '  float h = field.g;',
  '  if(h >= waveMaskDepthCap * ' + ARestlessOcean.WaveMask.DEPTH_CAP_FRACTION.toFixed(4) + ' || (h <= 0.0 && field.a < 0.5)) h = ' + ARestlessOcean.WaveMask.DEEP.toFixed(1) + ';',
  '  float inland = smoothstep(' + ARestlessOcean.WaveMask.INLAND_START.toFixed(4) + ', ' + ARestlessOcean.WaveMask.INLAND_FULL.toFixed(4) + ', abs(field.r - waveMaskSeaLevel));',
  '  float kpO = waveMaskPeakK;',
  '  float kpL = kpO;',
  '  if(inland > 0.0 && waveMaskWindSpeed > 0.001){',
  '    float fetch = max(2.0 * field.b, ' + ARestlessOcean.WaveMask.MIN_FETCH.toFixed(4) + ');',
  '    float kpF = max(kpO, waveMaskPeakKFor(waveMaskWindSpeed, min(fetch, waveMaskOceanFetch)));',
  '    kpL = mix(kpO, kpF, inland);',
  '  }',
  '  float wet = 1.0 - clamp(field.a, 0.0, 1.0);',
  '  a = vec3(waveMaskOne(waveMaskBandK[0], kpL, kpO, h, wet),',
  '           waveMaskOne(waveMaskBandK[1], kpL, kpO, h, wet),',
  '           waveMaskOne(waveMaskBandK[2], kpL, kpO, h, wet));',
  '  b = vec3(waveMaskOne(waveMaskBandK[3], kpL, kpO, h, wet),',
  '           waveMaskOne(waveMaskBandK[4], kpL, kpO, h, wet),',
  '           waveMaskOne(waveMaskBandK[5], kpL, kpO, h, wet));',
  '}'
].join('\n');

//═══════════════════════════════════════════════════════════════════════════
// FlowHandoff — where still water gives way to flowing water (Phase 4).
//═══════════════════════════════════════════════════════════════════════════
//
// Still water (ocean, lakes) is the FFT clipmap. Flowing water (creeks, rivers)
// is its own surface, drawn by FlowSurfacePass with the flowing-water material
// variant. This is the one weight that splits the two: w = 0 still, w = 1
// flowing, smoothstep over the flow speed |v| between FLOW_LO and FLOW_HI. Lakes
// and the sea decode as bit-exact zero velocity (a-land's 16-bit flow encoding
// puts raw 32768 at exactly 0), so a river mouth or a lake inlet blends by
// itself, with no body boundary anywhere.
//
// WHERE IT IS STORED. The water program has no texture unit to spare for the
// field's RT1 (flow lives there), so WaterFieldPass's compose packs w into RT0's
// dryMask channel:
//     wet texel            a = −w              (0 for still water, as before)
//     known-dry texel      a = 1 + w_nearest   (w of the nearest wet texel)
//     unknown-dry texel    a = 0               (loading / standalone, as before)
// Every pre-Phase-4 reader of that channel asks `> 0.999`, `> 0.5`, `< 0.5` or
// clamps it to [0, 1], and each of those still answers the same question.
// Dilating w onto dry bank texels is what lets the flowing surface own the bank
// edge: the still surface is drawn up to one texel past the last wet texel
// (the terrain depth test cuts the true shoreline), and without it that band
// would read as still water beside every creek.
//
// ⚠ DECODE BEFORE FILTERING. A bilinear read between a flowing texel (−1) and
// its dilated bank (2) passes through (0, 1), which decodes as "still, wet".
// So flowHandoffWeightAt texelFetches the four texels, decodes each, and then
// interpolates — the same rule a-land states for its split-channel tiles.
//
// ONE SOURCE, FOUR GPU CONSUMERS: the water vertex (FFT, breakers and reflection
// scaled by 1 − w), the water fragment (the discard), the ocean CSM caster and
// the CPU height bake splice FlowHandoff.GLSL at `$flow_handoff_functions`,
// AFTER their waterField samplers. `FlowHandoff.weightFromVelocity` is the JS
// mirror; the CPU wave twin applies it through OceanGrid's mask provider.
//
// flowHandoffEnabled is 0 unless a FlowSurfacePass is actually drawing the
// flowing surface, so without one nothing changes: the clipmap keeps drawing
// creeks as it did before Phase 4.

ARestlessOcean.FlowHandoff = {};

//Speed band, m/s. Below LO the water is still; above HI it is fully flowing.
//LO sits above a-land's 16-bit step (~0.5 mm/s at ±16 m/s) and well above any
//numerical residue in a lake; HI is a slow creek.
ARestlessOcean.FlowHandoff.FLOW_LO = 0.05;
ARestlessOcean.FlowHandoff.FLOW_HI = 0.25;

ARestlessOcean.FlowHandoff.createUniforms = function(){
  return {
    flowHandoffEnabled: {value: 0.0},
    //(centre x, centre z, half-width) of the square the flowing surface covers.
    //The weight fades to 0 over its outer RIM_FRACTION, so the still surface
    //takes a creek back exactly where the flowing surface lets go of it.
    flowHandoffWindow:  {value: new THREE.Vector3(0.0, 0.0, 0.0)}
  };
};

ARestlessOcean.FlowHandoff.RIM_FRACTION = 0.15;

ARestlessOcean.FlowHandoff.copyUniforms = function(dst, src){
  dst.flowHandoffEnabled.value = src.flowHandoffEnabled.value;
  dst.flowHandoffWindow.value.copy(src.flowHandoffWindow.value);
};

//state: {enabled, centerX, centerZ, halfWidth} or null (off).
ARestlessOcean.FlowHandoff.writeUniforms = function(u, state){
  const on = !!(state && state.enabled && state.halfWidth > 0.0);
  u.flowHandoffEnabled.value = on ? 1.0 : 0.0;
  if(on) u.flowHandoffWindow.value.set(state.centerX, state.centerZ, state.halfWidth);
};

//JS mirror of the window fade in flowHandoffWeightAt.
ARestlessOcean.FlowHandoff.windowFade = function(x, z, state){
  if(!(state && state.enabled && state.halfWidth > 0.0)) return 0.0;
  const m = Math.max(Math.abs(x - state.centerX), Math.abs(z - state.centerZ));
  const hw = state.halfWidth;
  const t = Math.min(1.0, Math.max(0.0, (m - hw * (1.0 - ARestlessOcean.FlowHandoff.RIM_FRACTION)) / (hw * ARestlessOcean.FlowHandoff.RIM_FRACTION)));
  return 1.0 - t * t * (3.0 - 2.0 * t);
};

//JS mirror of the compose pass's weight. p: {flowLo, flowHi} or null (defaults).
ARestlessOcean.FlowHandoff.weightFromVelocity = function(vx, vz, p){
  const lo = p ? p.flowLo : ARestlessOcean.FlowHandoff.FLOW_LO;
  const hi = p ? p.flowHi : ARestlessOcean.FlowHandoff.FLOW_HI;
  const t = Math.min(1.0, Math.max(0.0, (Math.sqrt(vx * vx + vz * vz) - lo) / Math.max(hi - lo, 1e-6)));
  return t * t * (3.0 - 2.0 * t);
};

//Decode one packed RT0.a value into the flow weight (see the header).
ARestlessOcean.FlowHandoff.decodeWeight = function(a){
  return a < 0.0 ? -a : (a > 1.0 ? a - 1.0 : 0.0);
};

//GLSL, WebGL2 (texelFetch/textureSize). Needs the waterFieldCascade0..2 samplers
//and their centre/half-width uniforms declared above the splice point.
ARestlessOcean.FlowHandoff.GLSL = [
  '//── FlowHandoff (spliced from ocean-wave-field.js — edit it THERE) ──',
  'uniform float flowHandoffEnabled;',
  'uniform vec3 flowHandoffWindow;',
  'float flowHandoffDecode(float a){',
  '  return a < 0.0 ? -a : (a > 1.0 ? a - 1.0 : 0.0);',
  '}',
  '//Bilinear interpolation of the DECODED weight over one cascade.',
  'float flowHandoffCascade(sampler2D tex, vec2 centre, float hw, vec2 worldXZ){',
  '  ivec2 size = textureSize(tex, 0);',
  '  vec2 p = ((worldXZ - centre) / (2.0 * hw) + 0.5) * vec2(size) - 0.5;',
  '  vec2 i = floor(p);',
  '  vec2 f = p - i;',
  '  ivec2 lo = clamp(ivec2(i), ivec2(0), size - 1);',
  '  ivec2 hi = clamp(ivec2(i) + 1, ivec2(0), size - 1);',
  '  float w00 = flowHandoffDecode(texelFetch(tex, lo, 0).a);',
  '  float w10 = flowHandoffDecode(texelFetch(tex, ivec2(hi.x, lo.y), 0).a);',
  '  float w01 = flowHandoffDecode(texelFetch(tex, ivec2(lo.x, hi.y), 0).a);',
  '  float w11 = flowHandoffDecode(texelFetch(tex, hi, 0).a);',
  '  return mix(mix(w00, w10, f.x), mix(w01, w11, f.x), f.y);',
  '}',
  '//The field flow weight at a world XZ (no window). Same cascade',
  '//choice and 10% edge crossfade as waterFieldAt.',
  'float flowHandoffFieldWeightAt(vec2 worldXZ){',
  '  vec2 d0 = abs(worldXZ - waterFieldCascadeCenter[0]);',
  '  float hw0 = waterFieldCascadeHalfWidth[0];',
  '  float m0 = max(d0.x, d0.y);',
  '  if(m0 < hw0){',
  '    float w = flowHandoffCascade(waterFieldCascade0, waterFieldCascadeCenter[0], hw0, worldXZ);',
  '    float e = smoothstep(hw0 * 0.9, hw0, m0);',
  '    if(e > 0.0) w = mix(w, flowHandoffCascade(waterFieldCascade1, waterFieldCascadeCenter[1], waterFieldCascadeHalfWidth[1], worldXZ), e);',
  '    return w;',
  '  }',
  '  vec2 d1 = abs(worldXZ - waterFieldCascadeCenter[1]);',
  '  float hw1 = waterFieldCascadeHalfWidth[1];',
  '  float m1 = max(d1.x, d1.y);',
  '  if(m1 < hw1){',
  '    float w = flowHandoffCascade(waterFieldCascade1, waterFieldCascadeCenter[1], hw1, worldXZ);',
  '    float e = smoothstep(hw1 * 0.9, hw1, m1);',
  '    if(e > 0.0) w = mix(w, flowHandoffCascade(waterFieldCascade2, waterFieldCascadeCenter[2], waterFieldCascadeHalfWidth[2], worldXZ), e);',
  '    return w;',
  '  }',
  '  return flowHandoffCascade(waterFieldCascade2, waterFieldCascadeCenter[2], waterFieldCascadeHalfWidth[2], worldXZ);',
  '}',
  '//Known-dry fraction (1 = every tap dry), decoded per texel before filtering,',
  '//on the finest containing cascade. For the flowing surface, whose banks sit',
  '//where the packed channel cannot be filtered raw.',
  'float flowHandoffDryCascade(sampler2D tex, vec2 centre, float hw, vec2 worldXZ){',
  '  ivec2 size = textureSize(tex, 0);',
  '  vec2 p = ((worldXZ - centre) / (2.0 * hw) + 0.5) * vec2(size) - 0.5;',
  '  vec2 i = floor(p);',
  '  vec2 f = p - i;',
  '  ivec2 lo = clamp(ivec2(i), ivec2(0), size - 1);',
  '  ivec2 hi = clamp(ivec2(i) + 1, ivec2(0), size - 1);',
  '  float d00 = step(0.999, texelFetch(tex, lo, 0).a);',
  '  float d10 = step(0.999, texelFetch(tex, ivec2(hi.x, lo.y), 0).a);',
  '  float d01 = step(0.999, texelFetch(tex, ivec2(lo.x, hi.y), 0).a);',
  '  float d11 = step(0.999, texelFetch(tex, hi, 0).a);',
  '  return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);',
  '}',
  'float flowHandoffDryAt(vec2 worldXZ){',
  '  vec2 d0 = abs(worldXZ - waterFieldCascadeCenter[0]);',
  '  if(max(d0.x, d0.y) < waterFieldCascadeHalfWidth[0] * 0.9)',
  '    return flowHandoffDryCascade(waterFieldCascade0, waterFieldCascadeCenter[0], waterFieldCascadeHalfWidth[0], worldXZ);',
  '  vec2 d1 = abs(worldXZ - waterFieldCascadeCenter[1]);',
  '  if(max(d1.x, d1.y) < waterFieldCascadeHalfWidth[1] * 0.9)',
  '    return flowHandoffDryCascade(waterFieldCascade1, waterFieldCascadeCenter[1], waterFieldCascadeHalfWidth[1], worldXZ);',
  '  return flowHandoffDryCascade(waterFieldCascade2, waterFieldCascadeCenter[2], waterFieldCascadeHalfWidth[2], worldXZ);',
  '}',
  '//What the still surface gives away here: the field weight inside the flowing',
  '//surface window, faded out over its rim; 0 when there is no flowing surface.',
  'float flowHandoffWeightAt(vec2 worldXZ){',
  '  if(flowHandoffEnabled < 0.5) return 0.0;',
  '  vec2 dw = abs(worldXZ - flowHandoffWindow.xy);',
  '  float hw = flowHandoffWindow.z;',
  '  float rim = 1.0 - smoothstep(hw * ' + (1.0 - ARestlessOcean.FlowHandoff.RIM_FRACTION).toFixed(4) + ', hw, max(dw.x, dw.y));',
  '  if(rim <= 0.0) return 0.0;',
  '  return rim * flowHandoffFieldWeightAt(worldXZ);',
  '}'
].join('\n');

//═══════════════════════════════════════════════════════════════════════════
// ShoreBreaker — depth-limited breakers swept along the shore (Phase 3a).
//═══════════════════════════════════════════════════════════════════════════
//
// WHAT IT ADDS. Phase 2's WaveMask takes energy OUT of the long cascades as the
// water shoals (the TMA depth factor). Real waves do the opposite on their way
// in: they slow, bunch up, grow (shoaling), pitch forward, and break where the
// height reaches ~0.78 of the depth. None of that exists in an FFT tile, which
// has no idea where the shore is. This layer puts it back as ONE coherent wave
// train at the spectral peak, phase-locked to the shore through the WaterField:
// crests run along shoreSDF iso-contours and move shoreward at the local phase
// speed. It is the parametric half of WATER-TYPES.md Phase 3; see
// NEARSHORE-WAVES.md § 8 (3a) for why parametric, and § 3 for the formulas.
//
// THE MODEL, per point (field texel: level, depth h, shore distance s, dry):
//  * Handoff (no double counting). WaveMask scales the peak cascade by a(k_p h),
//    so the peak carries a² of its energy. The breaker carries the rest:
//    W = sqrt(1 − a²). Deep water W → 0 (the FFT is untouched), the surf zone
//    W → 1. A modelling choice rather than a published result — it is the
//    energy-conserving reading of "return what the mask removed".
//  * Local wavenumber. Eckart (1952): kh ≈ k0h / sqrt(tanh k0h), k0 = ω²/g.
//  * Shoaling. Linear theory, Ks = sqrt(cg0 / cg), cg = c/2 (1 + 2kh / sinh 2kh).
//  * Breaking. McCowan: H = min(Ks·H0, 0.78 h). Bigger individual waves break
//    further out, because the cap applies per wave.
//  * Direction. A cos² directional spread arriving at angle α to the shoreward
//    normal delivers the energy fraction f(α) = 1 − α/π + sin 2α / 2π
//    (1 head-on, ½ side-on, 0 on a lee shore). Height scales by sqrt(f).
//  * Phase. Crests travel shoreward over a bed of mean slope h/s. The travel
//    time from the shoreline, T = ∫ ds / c, integrates in closed form to
//    ωT = (s/h)·I(k0h) with I(X) = ∫0^X dx / sqrt(tanh x). I is fitted here as
//    sqrt(X² + 4X (1 + 0.3184X) / (1 + 0.516X)): exact limits 2√X (shallow) and
//    X + 1.234 (deep), under 0.9% error in between (fit 2026-09-13).
//  * Shape. Ruessink et al. (2012), 30 000+ field records: nonlinearity B and
//    phase ψ from the Ursell number Ur = (3/8) H k / (kh)³ —
//      B = 0.857 / (1 + exp((−0.471 − log10 Ur) / 0.297))
//      ψ = −π/2 + (π/2) tanh(0.815 / Ur^0.672)
//    fed into Abreu et al. (2010)'s waveform
//      w(θ) = f (sin θ + r sin φ / (1 + f)) / (1 − r cos(θ + φ)),  f = sqrt(1 − r²)
//    with φ = −ψ − π/2 and r = 2b / (1 + b²), b = √2 B / sqrt(9 + 2B²). The b(B)
//    inversion was derived numerically from w itself (its skewness/asymmetry
//    magnitude is exactly 3b / sqrt(2(1 − b²))), and w has zero mean and a
//    crest-to-trough range of exactly 2 for every r and φ, so η = (H/2)·w.
//    Offshore this is a sinusoid; through the surf zone it pitches forward into
//    the steep-fronted sawtooth of a spilling bore.
//  * Reflection vs dissipation. Battjes (1974): Kr ≈ 0.1 ξ², ξ = tanβ / sqrt(H0/L0).
//    Breaker foam scales with the dissipated fraction 1 − Kr². (3b carries Kr.)
//
// VARIATION (the parts that are not in the papers — flagged as look choices):
//  * Each wave gets its own height factor from smooth noise keyed on its crest
//    index, so the train is not a metronome, plus a slow ~7-wave set envelope.
//  * A smooth ~90 m phase noise bends the crest lines so a coast does not break
//    in perfect unison.
//
// ⚠ Standalone (no a-faraway-land) stays OFF by default: there the field's shore
// distance comes from the foam ortho, which sees boats and docks as land, and a
// hull would sprout breakers. See ocean-grid.js's shoreBreakerParams.
//
// ONE SOURCE, FOUR GPU CONSUMERS, like WaveMask: the water vertex (geometry), the
// water fragment (normals, foam, debug), the ocean CSM caster and the CPU height
// bake all splice ShoreBreaker.GLSL at `$shore_breaker_functions`, AFTER their
// waterFieldAt. `ShoreBreaker.evaluate` is the JS mirror.

ARestlessOcean.ShoreBreaker = {};

ARestlessOcean.ShoreBreaker.G = 9.80665;
ARestlessOcean.ShoreBreaker.GAMMA = 0.78;           //McCowan breaker index H/h
ARestlessOcean.ShoreBreaker.MIN_DEPTH = 0.05;       //m; floor for the h-divisions
ARestlessOcean.ShoreBreaker.FADE_NEAR = 400.0;      //m; full geometry
ARestlessOcean.ShoreBreaker.FADE_FAR = 1400.0;      //m; none (clipmap cells outgrow the wavelength)
ARestlessOcean.ShoreBreaker.PHASE_NOISE_SCALE = 90.0;
ARestlessOcean.ShoreBreaker.PHASE_NOISE_AMP = 2.2;  //rad
ARestlessOcean.ShoreBreaker.WAVE_NOISE_SCALE = 45.0;
ARestlessOcean.ShoreBreaker.SET_LENGTH = 7.0;       //waves per set
//Foam behind the breaking front, per wave cycle d in [0, 1): a bright bore that
//decays within ~1/FOAM_TRAIL of a wavelength, over a thin residual sheet.
ARestlessOcean.ShoreBreaker.FOAM_TRAIL = 14.0;
ARestlessOcean.ShoreBreaker.FOAM_RESIDUAL = 0.06;
//Swash (step 2). The sheet may cover dry field texels up to SWASH_BAND_MAX m
//inland; the actual reach per point comes from the run-up and the beach slope.
ARestlessOcean.ShoreBreaker.SWASH_BAND_MAX = 60.0;
ARestlessOcean.ShoreBreaker.SWASH_PROBE = 6.0;       //m offshore where the foreshore slope is read
ARestlessOcean.ShoreBreaker.SWASH_UPRUSH = 0.3;      //fraction of a wave period spent running up
ARestlessOcean.ShoreBreaker.WAVE_FACTOR_MAX = 1.155; //largest waveFactor() can return
//The discard band is this many times the run-up reach on the PROBED slope: the
//upper beach is often flatter than the slope 6 m offshore, and the sheet is only
//visible where it is above the sand anyway, so a generous band costs nothing
//but a cut line if it is too tight.
ARestlessOcean.ShoreBreaker.SWASH_REACH_MARGIN = 2.0;
//Run-up cap as a multiple of the deep-water height. Stockdon (2006) is fitted
//on sandy beaches (tanβ up to ~0.1); on a rock face (tanβ → 1) it returns
//~10 m for Hs 3 m. Run-up on steep smooth slopes tops out at roughly 2–3 H
//(Hunt-type R/H ≈ ξ saturating), and less on rough, permeable rock, so 2 is used.
//⚠ A look-and-sanity cap quoted from memory, not a checked fit — see
//NEARSHORE-WAVES.md § 3 on the unreached rough-slope sources.
ARestlessOcean.ShoreBreaker.SWASH_RUNUP_MAX_RATIO = 2.0;
//The seaward taper must reach zero before any hard gate (depth cap, the 3·Hs+1
//activity gate) or the sheet ends in a wall; it completes by this fraction of
//the nearest gate.
ARestlessOcean.ShoreBreaker.SWASH_TAPER_GATE_FRACTION = 0.8;
//The swash SHEET is a beach model: Stockdon's data are sandy beaches up to
//tanβ ≈ 0.2. On rock faces the wave reflects and bursts instead of gliding up,
//which is 3b's reflection layer and spray (or a particle/SPH layer later), and a
//flat sheet several metres tall around a rock ends in walls wherever its inputs
//change (browser round 3). Faded out between these foreshore slopes.
ARestlessOcean.ShoreBreaker.SWASH_SLOPE_FADE_LO = 0.15;
ARestlessOcean.ShoreBreaker.SWASH_SLOPE_FADE_HI = 0.35;
//The shore normal is taken from CENTRAL differences on cascade 1 (4 m texels),
//± this many metres. A one-sided 1 m difference of the jump-flooded distance
//flips direction texel to texel around small rocks and along medial axes, and
//the direction factor and the swash slope probe jumped with it (metre-scale
//steps in the sheet: browser round 3).
ARestlessOcean.ShoreBreaker.NORMAL_STEP = 4.0;
//A distance field has |∇s| = 1 except on medial axes and in corners, where
//central differences average opposing directions; the swash fades where the
//gradient is this short, since there is no single shore to run up.
ARestlessOcean.ShoreBreaker.NORMAL_CONFIDENCE_LO = 0.35;
ARestlessOcean.ShoreBreaker.NORMAL_CONFIDENCE_HI = 0.75;
//PHASE CONSISTENCY. The crest phase θ = (s/h)·I(k0h) assumes the depth grows
//with shore distance (a sloping bed). There its gradient is exactly the
//dispersion wavenumber: |∇θ| = k0·I'(k0h) = k. Around rocks, pinnacles and bars
//the depth does not follow the distance, |∇θ| runs far past k, and the crests
//tangle into metre-scale steps. The breaker fades where |∇θ| / k crosses this
//band (the swash is phase-free in space and is gated separately).
ARestlessOcean.ShoreBreaker.PHASE_RATIO_LO = 1.6;
ARestlessOcean.ShoreBreaker.PHASE_RATIO_HI = 3.0;

ARestlessOcean.ShoreBreaker.createUniforms = function(){
  return {
    shoreBreakerEnabled:  {value: 0.0},
    shoreBreakerTime:     {value: 0.0},
    shoreBreakerHs:       {value: 0.0},     //deep-water Hs as rendered (× waveHeightMultiplier), m
    shoreBreakerOmega:    {value: 1.0},     //spectral peak ω_p, rad/s
    shoreBreakerWaveDir:  {value: new THREE.Vector2(1.0, 0.0)},  //unit travel direction (world x, z)
    shoreBreakerSeaLevel: {value: 0.0},
    shoreBreakerDepthCap: {value: 1.0e9},
    shoreBreakerCamera:   {value: new THREE.Vector3()},
    shoreBreakerFoamGain: {value: 1.0},
    shoreBreakerHeightScale: {value: 1.0}
  };
};

ARestlessOcean.ShoreBreaker.writeUniforms = function(u, p){
  if(!u.shoreBreakerEnabled) return;
  u.shoreBreakerEnabled.value = p.enabled ? 1.0 : 0.0;
  u.shoreBreakerTime.value = p.time;
  u.shoreBreakerHs.value = p.Hs;
  u.shoreBreakerOmega.value = p.omega;
  u.shoreBreakerWaveDir.value.set(p.waveDirX, p.waveDirZ);
  u.shoreBreakerSeaLevel.value = p.seaLevel;
  u.shoreBreakerDepthCap.value = p.depthCap;
  u.shoreBreakerCamera.value.set(p.cameraX, p.cameraY, p.cameraZ);
  u.shoreBreakerFoamGain.value = p.foamGain;
  u.shoreBreakerHeightScale.value = p.heightScale;
};

ARestlessOcean.ShoreBreaker.copyUniforms = function(dst, src){
  if(!dst.shoreBreakerEnabled || !src.shoreBreakerEnabled) return;
  for(const key of ['shoreBreakerEnabled', 'shoreBreakerTime', 'shoreBreakerHs', 'shoreBreakerOmega',
    'shoreBreakerSeaLevel', 'shoreBreakerDepthCap', 'shoreBreakerFoamGain', 'shoreBreakerHeightScale']){
    dst[key].value = src[key].value;
  }
  dst.shoreBreakerWaveDir.value.copy(src.shoreBreakerWaveDir.value);
  dst.shoreBreakerCamera.value.copy(src.shoreBreakerCamera.value);
};

//Deep-water sea state from the SAME formulas the spectrum uses (Hs calibration
//in OceanWaveField, ω_p from the band library).
ARestlessOcean.ShoreBreaker.paramsFrom = function(bandLibrary, o, out){
  out = out || {};
  const g = ARestlessOcean.ShoreBreaker.G;
  const U = Math.sqrt(o.windX * o.windX + o.windZ * o.windZ);
  const gamma = bandLibrary.jonswapGamma || 3.3;
  out.enabled = !!o.enabled && U > 0.01;
  out.time = o.time;
  out.Hs = 0.21 * U * U / g * Math.pow(gamma, 0.3) * o.heightMultiplier;
  out.omega = bandLibrary.omega_p || 1.0;
  out.waveDirX = U > 0.01 ? o.windX / U : 1.0;
  out.waveDirZ = U > 0.01 ? o.windZ / U : 0.0;
  out.seaLevel = o.seaLevel;
  out.depthCap = o.depthCap;
  out.cameraX = o.cameraX; out.cameraY = o.cameraY; out.cameraZ = o.cameraZ;
  out.foamGain = o.foamGain !== undefined ? o.foamGain : 1.0;
  out.heightScale = o.heightScale !== undefined ? o.heightScale : 1.0;
  return out;
};

//── JS mirror ───────────────────────────────────────────────────────────────
const _sbFract = function(x){ return x - Math.floor(x); };
const _sbSmooth = function(e0, e1, x){ const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
//Float32 arithmetic throughout (Math.fround): the hash amplifies rounding, and
//the GPU evaluates it in highp float, so a double-precision mirror would drift.
const _sbF = Math.fround;
const _sbFractF = function(x){ x = _sbF(x); return _sbF(x - Math.floor(x)); };
ARestlessOcean.ShoreBreaker.hash = function(px, py){
  px = _sbF(px); py = _sbF(py);
  const k = _sbF(0.1031), c = _sbF(33.33);
  let x = _sbFractF(_sbF(px * k)), y = _sbFractF(_sbF(py * k)), z = _sbFractF(_sbF(px * k));
  const d = _sbF(_sbF(_sbF(x * _sbF(y + c)) + _sbF(y * _sbF(z + c))) + _sbF(z * _sbF(x + c)));
  x = _sbF(x + d); y = _sbF(y + d); z = _sbF(z + d);
  return _sbFractF(_sbF(_sbF(x + y) * z));
};
ARestlessOcean.ShoreBreaker.noise = function(px, py){
  const SB = ARestlessOcean.ShoreBreaker;
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = SB.hash(ix, iy), b = SB.hash(ix + 1, iy), c = SB.hash(ix, iy + 1), d = SB.hash(ix + 1, iy + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
};
ARestlessOcean.ShoreBreaker.depthAmplitude = function(kh){
  const wh = Math.sqrt(Math.max(kh, 0.0));
  const phi = (wh <= 1.0) ? 0.5 * wh * wh : ((wh < 2.0) ? 1.0 - 0.5 * (2.0 - wh) * (2.0 - wh) : 1.0);
  return Math.sqrt(phi);
};
ARestlessOcean.ShoreBreaker.waveFactor = function(m, x, z){
  const SB = ARestlessOcean.ShoreBreaker;
  const mm = m - 289.0 * Math.floor(m / 289.0);
  const n = SB.noise(x / SB.WAVE_NOISE_SCALE + mm * 7.13, z / SB.WAVE_NOISE_SCALE + mm * 3.71);
  const set = 0.5 + 0.5 * Math.sin(2.0 * Math.PI * mm / SB.SET_LENGTH + 6.2832 * SB.noise(x / 400.0 + 3.1, z / 400.0 + 8.7));
  return (0.55 + 0.5 * n) * (0.8 + 0.3 * set);
};

//field = {level, depth, shoreSDF, dryMask}; gradX/gradZ = ∇shoreSDF.
//Returns out = {eta, foam, breaking, H, W, xi, Kr, theta, B, psi} (eta without
//the camera-distance fade, i.e. what the bake sees near the camera).
//hGradX/hGradZ: gradient of the phase field's depth (same central differences as gradX/gradZ).
ARestlessOcean.ShoreBreaker.phaseRatio = function(phaseDepth, phaseShore, gradX, gradZ, hGradX, hGradZ, k0){
  const SB = ARestlessOcean.ShoreBreaker;
  const h = Math.max(phaseDepth, SB.MIN_DEPTH), s = Math.max(phaseShore, 0.0), X = k0 * h;
  const a = 0.3184, b = 0.516;
  const Q = X * X + 4.0 * X * (1.0 + a * X) / (1.0 + b * X);
  const I = Math.sqrt(Q);
  const dQ = 2.0 * X + 4.0 * ((1.0 + 2.0 * a * X) * (1.0 + b * X) - b * X * (1.0 + a * X)) / ((1.0 + b * X) * (1.0 + b * X));
  const dI = dQ / (2.0 * Math.max(I, 1e-6));
  const dThetaDs = I / h, dThetaDh = s * (k0 * dI * h - I) / (h * h);
  const gx = dThetaDs * gradX + dThetaDh * hGradX, gz = dThetaDs * gradZ + dThetaDh * hGradZ;
  const kh = X / Math.sqrt(Math.tanh(X));
  return Math.sqrt(gx * gx + gz * gz) / (kh / h);
};

ARestlessOcean.ShoreBreaker.evaluate = function(x, z, field, gradX, gradZ, p, out, phaseField, hGradX, hGradZ){
  const SB = ARestlessOcean.ShoreBreaker;
  out = out || {};
  out.eta = 0; out.foam = 0; out.breaking = 0; out.H = 0; out.W = 0; out.xi = 0; out.Kr = 0; out.theta = 0; out.B = 0; out.psi = 0;
  if(!p || !p.enabled || p.Hs < 0.02) return out;
  const h = field.depth, s = field.shoreSDF;
  if(s <= 0.0 || h <= 0.0 || field.dryMask > 0.5 || h >= p.depthCap * 0.98) return out;
  const inland = _sbSmooth(0.5, 2.0, Math.abs(field.level - p.seaLevel));
  const g = SB.G, w = p.omega, k0 = w * w / g;
  const hh = Math.max(h, SB.MIN_DEPTH);
  const X = k0 * hh;
  const aP = SB.depthAmplitude(X);
  //Fade out before the provider's depth cap: past it the depth is unknown and the
  //breaker hard-gates to 0, which left a wall along the cap contour.
  const pfC = phaseField || field;
  const ratio = SB.phaseRatio(pfC.depth, pfC.shoreSDF, gradX, gradZ, hGradX || 0.0, hGradZ || 0.0, k0);
  out.phaseRatio = ratio;
  const W = Math.sqrt(Math.max(0.0, 1.0 - aP * aP)) * (1.0 - inland) * (1.0 - _sbSmooth(0.7 * p.depthCap, 0.98 * p.depthCap, h))
    * (1.0 - _sbSmooth(SB.PHASE_RATIO_LO, SB.PHASE_RATIO_HI, ratio));
  out.W = W;
  if(W < 0.01) return out;
  const kh = X / Math.sqrt(Math.tanh(X));
  const k = kh / hh;
  const c = w / k;
  const kh2 = Math.min(2.0 * kh, 30.0);
  const cg = 0.5 * c * (1.0 + kh2 / Math.sinh(kh2));
  const Ks = Math.sqrt((0.5 * g / w) / cg);
  const gl = Math.sqrt(gradX * gradX + gradZ * gradZ);
  const nx = gl > 1e-4 ? gradX / gl : -p.waveDirX, nz = gl > 1e-4 ? gradZ / gl : -p.waveDirZ;
  const cosA = Math.min(1, Math.max(-1, -(p.waveDirX * nx + p.waveDirZ * nz)));
  const alpha = Math.acos(cosA);
  const fDir = Math.min(1, Math.max(0, 1.0 - alpha / Math.PI + Math.sin(2.0 * alpha) / (2.0 * Math.PI)));
  const pf = phaseField || field;
  const ph_h = Math.max(pf.depth, SB.MIN_DEPTH), ph_s = Math.max(pf.shoreSDF, 0.0), ph_X = k0 * ph_h;
  let theta = w * p.time + (ph_s / ph_h) * Math.sqrt(ph_X * ph_X + 4.0 * ph_X * (1.0 + 0.3184 * ph_X) / (1.0 + 0.516 * ph_X));
  theta += SB.PHASE_NOISE_AMP * (SB.noise(x / SB.PHASE_NOISE_SCALE + p.time * 0.004, z / SB.PHASE_NOISE_SCALE + p.time * 0.0028) - 0.5);
  out.theta = theta;
  const cyc = theta / (2.0 * Math.PI) + 0.25;
  const m = Math.floor(cyc);
  const fr = cyc - m;
  const A = SB.waveFactor(m, x, z) + (SB.waveFactor(m + 1, x, z) - SB.waveFactor(m, x, z)) * _sbSmooth(0.8, 1.0, fr);
  const Hsh = p.Hs * A * Math.sqrt(fDir) * Ks;
  const Hcap = SB.GAMMA * hh;
  const H = Math.min(Hsh, Hcap);
  out.H = H;
  out.breaking = _sbSmooth(0.85, 1.0, Hsh / Hcap);
  const Ur = Math.max(0.375 * H * k / (kh * kh * kh), 1e-4);
  const B = 0.857 / (1.0 + Math.exp((-0.471 - Math.log(Ur) / Math.LN10) / 0.297));
  const psi = -0.5 * Math.PI + 0.5 * Math.PI * Math.tanh(0.815 / Math.pow(Ur, 0.672));
  out.B = B; out.psi = psi;
  const b = Math.SQRT2 * B / Math.sqrt(9.0 + 2.0 * B * B);
  const r = 2.0 * b / (1.0 + b * b);
  const ph = -psi - 0.5 * Math.PI;
  const f = Math.sqrt(1.0 - r * r);
  const wv = f * (Math.sin(theta) + r * Math.sin(ph) / (1.0 + f)) / (1.0 - r * Math.cos(theta + ph));
  out.eta = 0.5 * H * wv * W * p.heightScale;
  const L0 = 2.0 * Math.PI * g / (w * w);
  const xi = (h / s) / Math.sqrt(Math.max(p.Hs, 1e-4) / L0);
  const Kr = Math.min(1.0, 0.1 * xi * xi);
  out.xi = xi; out.Kr = Kr;
  const dFront = _sbFract((theta + ph) / (2.0 * Math.PI));
  const foamPhase = (Math.exp(-SB.FOAM_TRAIL * dFront) + SB.FOAM_RESIDUAL * (1.0 - dFront)) * _sbSmooth(0.0, 0.02, dFront);
  out.foam = Math.min(1.0, out.breaking * (1.0 - Kr * Kr) * foamPhase * Math.min(1.0, 2.0 * W) * p.foamGain);
  return out;
};

//── Swash (Phase 3a step 2) ─────────────────────────────────────────────────
//Each breaker's bore runs up the beach and drains back. The sheet is a flat
//water surface at rest level + z(t), allowed over the dry band the run-up can
//reach; where the sand is higher than the sheet, the depth test hides it, so
//the moving waterline is exactly where z(t) meets the beach, with no terrain
//lookup.
//  * Run-up. Stockdon et al. (2006), 2% exceedance, with the general form used
//    for every ξ (their dissipative and reflective special cases are not
//    continuous with it):
//      R2 = 1.1 (η̄ + S/2),  η̄ = 0.35 β √(H0 L0),  S = √((0.75 β √(H0 L0))² + (0.06 √(H0 L0))²)
//    H0 is the deep-water Hs times sqrt(fDir), so lee beaches barely swash. β is
//    the foreshore slope, read from the smooth field SWASH_PROBE m offshore
//    along the shore normal.
//  * Motion, per wave. The waterline rises from η̄ − S/2 to R2 × waveFactor over
//    the first SWASH_UPRUSH of the cycle (decelerating, sin) and drains back
//    under gravity (accelerating, 1 − x²). Timed off the breaker phase, so the
//    bore arriving at the shoreline is what starts the uprush.
//  * Seaward, the swash fades out by the depth that equals the largest run-up,
//    so setup and drawdown reach just the inner surf zone.
//evaluateSwash returns out = {eta, reach, foam, R2, slope}: reach = how far inland
//(m, from the shoreline) the sheet can ever get at this point; foam = bore foam
//on the uprush.
ARestlessOcean.ShoreBreaker.evaluateSwash = function(x, z, field, gradX, gradZ, p, out, phaseField, probeField){
  const SB = ARestlessOcean.ShoreBreaker;
  out = out || {};
  out.eta = 0; out.reach = -1; out.foam = 0; out.R2 = 0; out.slope = 0;
  if(!p || !p.enabled || p.Hs < 0.02) return out;
  const s = field.shoreSDF, h = Math.max(field.depth, 0.0);
  if(s < -SB.SWASH_BAND_MAX || h >= p.depthCap * 0.98 || h > 3.0 * p.Hs + 1.0) return out;
  const inland = _sbSmooth(0.5, 2.0, Math.abs(field.level - p.seaLevel));
  if(inland >= 1.0) return out;
  const g = SB.G, w = p.omega, k0 = w * w / g;
  const gl = Math.sqrt(gradX * gradX + gradZ * gradZ);
  const nx = gl > 1e-4 ? gradX / gl : -p.waveDirX, nz = gl > 1e-4 ? gradZ / gl : -p.waveDirZ;
  const cosA = Math.min(1, Math.max(-1, -(p.waveDirX * nx + p.waveDirZ * nz)));
  const alpha = Math.acos(cosA);
  const fDir = Math.min(1, Math.max(0, 1.0 - alpha / Math.PI + Math.sin(2.0 * alpha) / (2.0 * Math.PI)));
  const H0 = p.Hs * Math.sqrt(fDir);
  if(H0 < 0.01) return out;
  const confidence = _sbSmooth(SB.NORMAL_CONFIDENCE_LO, SB.NORMAL_CONFIDENCE_HI, gl);
  const L0 = 2.0 * Math.PI * g / (w * w);
  const pr = probeField || phaseField || field;
  const slope = Math.min(1.0, Math.max(0.005, pr.depth / Math.max(pr.shoreSDF, 1.0)));
  const HL = Math.sqrt(H0 * L0);
  const setup = 0.35 * slope * HL;
  const Sinc = 0.75 * slope * HL, Sig = 0.06 * HL;
  const S = Math.sqrt(Sinc * Sinc + Sig * Sig);
  const R2 = Math.min(1.1 * (setup + 0.5 * S), SB.SWASH_RUNUP_MAX_RATIO * H0);
  out.R2 = R2; out.slope = slope;
  out.reach = Math.min(SB.SWASH_BAND_MAX, SB.SWASH_REACH_MARGIN * SB.WAVE_FACTOR_MAX * R2 / slope + 2.0);
  //The SHORELINE phase, the same at every cross-shore distance: the swash zone
  //fills and drains as one sheet, and the waterline climbs the beach because the
  //sheet rises. (Using the breaker's local phase here made standing strips of
  //sheet that crept shoreward at shallow-water speed; browser round 2.)
  let theta = w * p.time;
  theta += SB.PHASE_NOISE_AMP * (SB.noise(x / SB.PHASE_NOISE_SCALE + p.time * 0.004, z / SB.PHASE_NOISE_SCALE + p.time * 0.0028) - 0.5);
  const cyc = theta / (2.0 * Math.PI) + 0.25;
  const m = Math.floor(cyc);
  const fr = cyc - m;
  const A = SB.waveFactor(m, x, z) + (SB.waveFactor(m + 1, x, z) - SB.waveFactor(m, x, z)) * _sbSmooth(0.8, 1.0, fr);
  const d = _sbFract(theta / (2.0 * Math.PI));
  const up = SB.SWASH_UPRUSH;
  const c = d < up ? Math.sin(0.5 * Math.PI * d / up) : 1.0 - Math.pow((d - up) / (1.0 - up), 2.0);
  const zMin = setup - 0.5 * S, zMax = R2 * A;
  const gateDepth = Math.min(p.depthCap * 0.98, 3.0 * p.Hs + 1.0) * SB.SWASH_TAPER_GATE_FRACTION;
  const taper = 1.0 - _sbSmooth(0.0, Math.max(Math.min(SB.WAVE_FACTOR_MAX * R2, gateDepth), 0.05), h);
  //Inland, fade to nothing by the reach so the geometry agrees with the discard.
  //Inland, fade to nothing by the reach so the geometry agrees with the discard.
  //Seaward, also by shore DISTANCE: a shallow bar far from any shore is not swash.
  const reachFade = (1.0 - _sbSmooth(0.75 * out.reach, out.reach, -s)) * (1.0 - _sbSmooth(0.5 * out.reach, out.reach, s));
  const beachOnly = 1.0 - _sbSmooth(SB.SWASH_SLOPE_FADE_LO, SB.SWASH_SLOPE_FADE_HI, slope);
  const k = (1.0 - inland) * taper * reachFade * confidence * beachOnly;
  out.eta = (zMin + (zMax - zMin) * c) * k * p.heightScale;
  out.foam = Math.min(1.0, (d < up ? 1.0 - d / up : 0.0) * k * p.foamGain);
  return out;
};

//GLSL ES 1.00, mirrors evaluate() line for line. Requires the consumer to have
//defined `vec4 waterFieldAt(vec2 worldXZ)` above the splice point.
ARestlessOcean.ShoreBreaker.GLSL = (function(){
  const SB = ARestlessOcean.ShoreBreaker;
  const f = function(v){ return (+v).toFixed(6); };
  return [
    '//── ShoreBreaker (spliced from ocean-wave-field.js — edit it THERE) ──',
    'uniform float shoreBreakerEnabled;',
    'uniform float shoreBreakerTime;',
    'uniform float shoreBreakerHs;',
    'uniform float shoreBreakerOmega;',
    'uniform vec2 shoreBreakerWaveDir;',
    'uniform float shoreBreakerSeaLevel;',
    'uniform float shoreBreakerDepthCap;',
    'uniform vec3 shoreBreakerCamera;',
    'uniform float shoreBreakerFoamGain;',
    'uniform float shoreBreakerHeightScale;',
    'float shoreBreakerHash(vec2 p){',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'float shoreBreakerNoise(vec2 p){',
    '  vec2 i = floor(p);',
    '  vec2 fr = p - i;',
    '  vec2 u = fr * fr * (3.0 - 2.0 * fr);',
    '  float a = shoreBreakerHash(i);',
    '  float b = shoreBreakerHash(i + vec2(1.0, 0.0));',
    '  float c = shoreBreakerHash(i + vec2(0.0, 1.0));',
    '  float d = shoreBreakerHash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    'float shoreBreakerDepthAmplitude(float kh){',
    '  float wh = sqrt(max(kh, 0.0));',
    '  float phi = (wh <= 1.0) ? 0.5 * wh * wh : ((wh < 2.0) ? 1.0 - 0.5 * (2.0 - wh) * (2.0 - wh) : 1.0);',
    '  return sqrt(phi);',
    '}',
    'float shoreBreakerTanh(float x){ float e = exp(-2.0 * abs(x)); return sign(x) * (1.0 - e) / (1.0 + e); }',
    'float shoreBreakerWaveFactor(float m, vec2 xz){',
    '  float mm = m - 289.0 * floor(m / 289.0);',
    '  float n = shoreBreakerNoise(xz / ' + f(SB.WAVE_NOISE_SCALE) + ' + vec2(mm * 7.13, mm * 3.71));',
    '  float setEnv = 0.5 + 0.5 * sin(6.2831853 * mm / ' + f(SB.SET_LENGTH) + ' + 6.2832 * shoreBreakerNoise(xz / 400.0 + vec2(3.1, 8.7)));',
    '  return (0.55 + 0.5 * n) * (0.8 + 0.3 * setEnv);',
    '}',
    '//The field for the PHASE: cascade 1 (4 m texels) rather than the 1 m field.',
    '//Crest position integrates s / h, so texel noise in the fine depth and in the',
    '//jump-flooded distance becomes crest wobble and radial streaks; amplitude and',
    '//breaking keep the fine field so the waterline stays sharp.',
    'vec4 shoreBreakerPhaseField(vec2 xz){',
    '  return texture2D(waterFieldCascade1, (xz - waterFieldCascadeCenter[1]) / (2.0 * waterFieldCascadeHalfWidth[1]) + 0.5);',
    '}',
    '//Returns (ds/dx, ds/dz, dh/dx, dh/dz) from the same four taps.',
    'vec4 shoreBreakerSmoothGrad(vec2 xz){',
    '  vec2 ex = vec2(' + f(SB.NORMAL_STEP) + ', 0.0);',
    '  vec2 ez = vec2(0.0, ' + f(SB.NORMAL_STEP) + ');',
    '  vec4 px = shoreBreakerPhaseField(xz + ex);',
    '  vec4 nx = shoreBreakerPhaseField(xz - ex);',
    '  vec4 pz = shoreBreakerPhaseField(xz + ez);',
    '  vec4 nz = shoreBreakerPhaseField(xz - ez);',
    '  return vec4(px.b - nx.b, pz.b - nz.b, px.g - nx.g, pz.g - nz.g) / ' + f(2.0 * SB.NORMAL_STEP) + ';',
    '}',
    'float shoreBreakerPhaseRatio(vec4 phaseField, vec4 fieldGrad, float k0){',
    '  float h = max(phaseField.g, ' + f(SB.MIN_DEPTH) + ');',
    '  float s = max(phaseField.b, 0.0);',
    '  float X = k0 * h;',
    '  float den = 1.0 + 0.516 * X;',
    '  float Q = X * X + 4.0 * X * (1.0 + 0.3184 * X) / den;',
    '  float I = sqrt(Q);',
    '  float dQ = 2.0 * X + 4.0 * ((1.0 + 0.6368 * X) * den - 0.516 * X * (1.0 + 0.3184 * X)) / (den * den);',
    '  float dI = dQ / (2.0 * max(I, 0.000001));',
    '  vec2 g = (I / h) * fieldGrad.xy + (s * (k0 * dI * h - I) / (h * h)) * fieldGrad.zw;',
    '  float kh = X / sqrt(shoreBreakerTanh(X));',
    '  return length(g) / (kh / h);',
    '}',
    '//field = (level, depth, shoreSDF, dryMask); phaseField = shoreBreakerPhaseField(xz); fieldGrad = shoreBreakerSmoothGrad(xz).',
    '//Returns eta (m, no distance fade). foam, breaking in [0,1]; xiOut is the surf-similarity number.',
    'float shoreBreakerEval(vec2 xz, vec4 field, vec4 phaseField, vec4 fieldGrad, out float foam, out float breaking, out float xiOut){',
    '  vec2 shoreGrad = fieldGrad.xy;',
    '  foam = 0.0; breaking = 0.0; xiOut = 0.0;',
    '  if(shoreBreakerEnabled < 0.5 || shoreBreakerHs < 0.02) return 0.0;',
    '  float h = field.g;',
    '  float s = field.b;',
    '  if(s <= 0.0 || h <= 0.0 || field.a > 0.5 || h >= shoreBreakerDepthCap * 0.98) return 0.0;',
    '  float inland = smoothstep(0.5, 2.0, abs(field.r - shoreBreakerSeaLevel));',
    '  const float g = ' + f(SB.G) + ';',
    '  float w = shoreBreakerOmega;',
    '  float k0 = w * w / g;',
    '  float hh = max(h, ' + f(SB.MIN_DEPTH) + ');',
    '  float X = k0 * hh;',
    '  float aP = shoreBreakerDepthAmplitude(X);',
    '  float W = sqrt(max(0.0, 1.0 - aP * aP)) * (1.0 - inland) * (1.0 - smoothstep(0.7 * shoreBreakerDepthCap, 0.98 * shoreBreakerDepthCap, h))',
    '          * (1.0 - smoothstep(' + f(SB.PHASE_RATIO_LO) + ', ' + f(SB.PHASE_RATIO_HI) + ', shoreBreakerPhaseRatio(phaseField, fieldGrad, k0)));',
    '  if(W < 0.01) return 0.0;',
    '  float kh = X / sqrt(shoreBreakerTanh(X));',
    '  float k = kh / hh;',
    '  float c = w / k;',
    '  float kh2 = min(2.0 * kh, 30.0);',
    '  float sinh2 = 0.5 * (exp(kh2) - exp(-kh2));',
    '  float cg = 0.5 * c * (1.0 + kh2 / sinh2);',
    '  float Ks = sqrt((0.5 * g / w) / cg);',
    '  float gradLen = length(shoreGrad);',
    '  vec2 n = gradLen > 0.0001 ? shoreGrad / gradLen : -shoreBreakerWaveDir;',
    '  float cosA = clamp(-dot(shoreBreakerWaveDir, n), -1.0, 1.0);',
    '  float alpha = acos(cosA);',
    '  float fDir = clamp(1.0 - alpha / 3.14159265 + sin(2.0 * alpha) / 6.2831853, 0.0, 1.0);',
    '  float phH = max(phaseField.g, ' + f(SB.MIN_DEPTH) + ');',
    '  float phS = max(phaseField.b, 0.0);',
    '  float phX = k0 * phH;',
    '  float theta = w * shoreBreakerTime + (phS / phH) * sqrt(phX * phX + 4.0 * phX * (1.0 + 0.3184 * phX) / (1.0 + 0.516 * phX));',
    '  theta += ' + f(SB.PHASE_NOISE_AMP) + ' * (shoreBreakerNoise(xz / ' + f(SB.PHASE_NOISE_SCALE) + ' + vec2(shoreBreakerTime * 0.004, shoreBreakerTime * 0.0028)) - 0.5);',
    '  float cyc = theta / 6.2831853 + 0.25;',
    '  float m = floor(cyc);',
    '  float fr = cyc - m;',
    '  float A = mix(shoreBreakerWaveFactor(m, xz), shoreBreakerWaveFactor(m + 1.0, xz), smoothstep(0.8, 1.0, fr));',
    '  float Hsh = shoreBreakerHs * A * sqrt(fDir) * Ks;',
    '  float Hcap = ' + f(SB.GAMMA) + ' * hh;',
    '  float H = min(Hsh, Hcap);',
    '  breaking = smoothstep(0.85, 1.0, Hsh / Hcap);',
    '  float Ur = max(0.375 * H * k / (kh * kh * kh), 0.0001);',
    '  float B = 0.857 / (1.0 + exp((-0.471 - log(Ur) / 2.30258509) / 0.297));',
    '  float psi = -1.57079633 + 1.57079633 * shoreBreakerTanh(0.815 / pow(Ur, 0.672));',
    '  float bb = 1.41421356 * B / sqrt(9.0 + 2.0 * B * B);',
    '  float r = 2.0 * bb / (1.0 + bb * bb);',
    '  float ph = -psi - 1.57079633;',
    '  float ff = sqrt(1.0 - r * r);',
    '  float wv = ff * (sin(theta) + r * sin(ph) / (1.0 + ff)) / (1.0 - r * cos(theta + ph));',
    '  float L0 = 6.2831853 * g / (w * w);',
    '  float xi = (h / s) / sqrt(max(shoreBreakerHs, 0.0001) / L0);',
    '  xiOut = xi;',
    '  float Kr = min(1.0, 0.1 * xi * xi);',
    '  float dFront = fract((theta + ph) / 6.2831853);',
    '  float foamPhase = (exp(-' + f(SB.FOAM_TRAIL) + ' * dFront) + ' + f(SB.FOAM_RESIDUAL) + ' * (1.0 - dFront)) * smoothstep(0.0, 0.02, dFront);',
    '  foam = min(1.0, breaking * (1.0 - Kr * Kr) * foamPhase * min(1.0, 2.0 * W) * shoreBreakerFoamGain);',
    '  return 0.5 * H * wv * W * shoreBreakerHeightScale;',
    '}',
    '//── Swash (see evaluateSwash in ocean-wave-field.js for the model) ──',
    'float shoreBreakerDirectionFactor(vec2 shoreGrad, out vec2 n){',
    '  float gradLen = length(shoreGrad);',
    '  n = gradLen > 0.0001 ? shoreGrad / gradLen : -shoreBreakerWaveDir;',
    '  float alpha = acos(clamp(-dot(shoreBreakerWaveDir, n), -1.0, 1.0));',
    '  return clamp(1.0 - alpha / 3.14159265 + sin(2.0 * alpha) / 6.2831853, 0.0, 1.0);',
    '}',
    '//Smooth shore gradient: central differences on cascade 1 (see NORMAL_STEP).',
    'bool shoreSwashActive(vec4 field){',
    '  if(shoreBreakerEnabled < 0.5 || shoreBreakerHs < 0.02) return false;',
    '  if(field.b < -' + f(SB.SWASH_BAND_MAX) + ' || field.g >= shoreBreakerDepthCap * 0.98 || field.g > 3.0 * shoreBreakerHs + 1.0) return false;',
    '  return abs(field.r - shoreBreakerSeaLevel) < 2.0;',
    '}',
    '//Returns the swash elevation (m) at xz. reach = how far inland of the shoreline the',
    '//sheet can ever get here (m, negative = no swash); swashFoam = bore foam on the uprush.',
    'float shoreSwashEval(vec2 xz, vec4 field, vec4 phaseField, vec4 fieldGrad, out float reach, out float swashFoam){',
    '  vec2 shoreGrad = fieldGrad.xy;',
    '  reach = -1.0; swashFoam = 0.0;',
    '  if(!shoreSwashActive(field)) return 0.0;',
    '  float inland = smoothstep(0.5, 2.0, abs(field.r - shoreBreakerSeaLevel));',
    '  const float g = ' + f(SB.G) + ';',
    '  float w = shoreBreakerOmega;',
    '  float k0 = w * w / g;',
    '  vec2 n;',
    '  float fDir = shoreBreakerDirectionFactor(shoreGrad, n);',
    '  float H0 = shoreBreakerHs * sqrt(fDir);',
    '  if(H0 < 0.01) return 0.0;',
    '  float L0 = 6.2831853 * g / (w * w);',
    '  vec4 probe = shoreBreakerPhaseField(xz + n * (' + f(SB.SWASH_PROBE) + ' - field.b));',
    '  float slope = clamp(probe.g / max(probe.b, 1.0), 0.005, 1.0);',
    '  float HL = sqrt(H0 * L0);',
    '  float setup = 0.35 * slope * HL;',
    '  float Sinc = 0.75 * slope * HL;',
    '  float Sig = 0.06 * HL;',
    '  float S = sqrt(Sinc * Sinc + Sig * Sig);',
    '  float R2 = min(1.1 * (setup + 0.5 * S), ' + f(SB.SWASH_RUNUP_MAX_RATIO) + ' * H0);',
    '  reach = min(' + f(SB.SWASH_BAND_MAX) + ', ' + f(SB.SWASH_REACH_MARGIN * SB.WAVE_FACTOR_MAX) + ' * R2 / slope + 2.0);',
    '  //Shoreline phase at every distance: the swash zone fills and drains as one sheet.',
    '  float theta = w * shoreBreakerTime;',
    '  theta += ' + f(SB.PHASE_NOISE_AMP) + ' * (shoreBreakerNoise(xz / ' + f(SB.PHASE_NOISE_SCALE) + ' + vec2(shoreBreakerTime * 0.004, shoreBreakerTime * 0.0028)) - 0.5);',
    '  float cyc = theta / 6.2831853 + 0.25;',
    '  float m = floor(cyc);',
    '  float A = mix(shoreBreakerWaveFactor(m, xz), shoreBreakerWaveFactor(m + 1.0, xz), smoothstep(0.8, 1.0, cyc - m));',
    '  float d = fract(theta / 6.2831853);',
    '  const float up = ' + f(SB.SWASH_UPRUSH) + ';',
    '  float x = (d - up) / (1.0 - up);',
    '  float c = d < up ? sin(1.57079633 * d / up) : 1.0 - x * x;',
    '  float zMin = setup - 0.5 * S;',
    '  float zMax = R2 * A;',
    '  float gateDepth = min(shoreBreakerDepthCap * 0.98, 3.0 * shoreBreakerHs + 1.0) * ' + f(SB.SWASH_TAPER_GATE_FRACTION) + ';',
    '  float taper = 1.0 - smoothstep(0.0, max(min(' + f(SB.WAVE_FACTOR_MAX) + ' * R2, gateDepth), 0.05), max(field.g, 0.0));',
    '  float reachFade = (1.0 - smoothstep(0.75 * reach, reach, -field.b)) * (1.0 - smoothstep(0.5 * reach, reach, field.b));',
    '  float confidence = smoothstep(' + f(SB.NORMAL_CONFIDENCE_LO) + ', ' + f(SB.NORMAL_CONFIDENCE_HI) + ', length(shoreGrad));',
    '  float beachOnly = 1.0 - smoothstep(' + f(SB.SWASH_SLOPE_FADE_LO) + ', ' + f(SB.SWASH_SLOPE_FADE_HI) + ', slope);',
    '  float k = (1.0 - inland) * taper * reachFade * confidence * beachOnly;',
    '  swashFoam = min(1.0, (d < up ? 1.0 - d / up : 0.0) * k * shoreBreakerFoamGain);',
    '  return mix(zMin, zMax, c) * k * shoreBreakerHeightScale;',
    '}',
    '//True where the swash sheet may cover a DRY field texel: the dry discard asks this.',
    'bool shoreSwashCovers(vec2 xz, vec4 field){',
    '  if(field.b > 0.0 || !shoreSwashActive(field)) return false;',
    '  float reach; float swashFoam;',
    '  shoreSwashEval(xz, field, shoreBreakerPhaseField(xz), shoreBreakerSmoothGrad(xz), reach, swashFoam);',
    '  return -field.b < reach;',
    '}',
    '//Cheap pre-test: false where shoreBreakerEval is certain to return 0, so',
    '//callers skip the two extra field taps for the shore normal (open ocean, land).',
    'bool shoreBreakerActive(vec4 field){',
    '  if(shoreBreakerEnabled < 0.5 || shoreBreakerHs < 0.02) return false;',
    '  if(field.b <= 0.0 || field.g <= 0.0 || field.a > 0.5 || field.g >= shoreBreakerDepthCap * 0.98) return false;',
    '  float aP = shoreBreakerDepthAmplitude(shoreBreakerOmega * shoreBreakerOmega / ' + f(SB.G) + ' * max(field.g, ' + f(SB.MIN_DEPTH) + '));',
    '  return aP < 0.99995;',
    '}',
    '//Camera-distance fade for GEOMETRY (the clipmap cells outgrow the breaker',
    '//wavelength with distance). Foam and normals in the fragment are per pixel.',
    'float shoreBreakerDistanceFade(vec3 worldPos){',
    '  return smoothstep(' + f(SB.FADE_FAR) + ', ' + f(SB.FADE_NEAR) + ', distance(shoreBreakerCamera, worldPos));',
    '}',
    '//Geometry helper for the vertex, the CSM caster and the height bake: the two',
    '//extra field taps for the shore normal are only paid near a shore.',
    'float shoreBreakerHeightAt(vec2 xz, vec4 field, float fade){',
    '  if(fade <= 0.0) return 0.0;',
    '  bool breakerOn = shoreBreakerActive(field);',
    '  bool swashOn = shoreSwashActive(field);',
    '  if(!breakerOn && !swashOn) return 0.0;',
    '  vec4 grad = shoreBreakerSmoothGrad(xz);',
    '  vec4 phaseField = shoreBreakerPhaseField(xz);',
    '  float foam; float brk; float xi; float reach; float swashFoam;',
    '  float eta = breakerOn ? shoreBreakerEval(xz, field, phaseField, grad, foam, brk, xi) : 0.0;',
    '  if(swashOn) eta += shoreSwashEval(xz, field, phaseField, grad, reach, swashFoam);',
    '  return fade * eta;',
    '}'
  ].join('\n');
})();
