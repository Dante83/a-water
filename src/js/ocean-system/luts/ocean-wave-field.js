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
