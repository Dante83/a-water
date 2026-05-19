AWater.AOcean.LUTlibraries.OceanHeightBandLibrary = function(parentOceanGrid){
  let renderer = parentOceanGrid.renderer;
  let data = parentOceanGrid.data;

  //Linear filtering of float textures is core in WebGL2; only probe the
  //extension on WebGL1. The short-circuit order matters in three.js v173+,
  //where extensions.get() logs a console warning whenever the extension is
  //missing even if the result is then ignored.
  if(!renderer.capabilities.isWebGL2 && !renderer.extensions.get("OES_texture_float_linear")){
    console.error("No linear interpolation of OES textures allowed.");
    return false;
  }

  //Cascade configuration: 6 tiles at ×4 doubling, each carrying a 2-octave
  //wavelength slice [L/8, L/2]. Adopted from Crest's FFTSpectrum.compute
  //WAVE_SAMPLE_FACTOR pattern (Crest uses 16 cascades at ×2; we compress to
  //6 at ×4 since our shader-side arrays are hardcoded [6]).
  //
  //  c=0 L=4096  → λ ∈ [512, 2048] m  (long swell, no upper cap on largest)
  //  c=1 L=1024  → λ ∈ [128, 512]  m
  //  c=2 L=256   → λ ∈ [32,  128]  m
  //  c=3 L=64    → λ ∈ [8,   32]   m
  //  c=4 L=16    → λ ∈ [2,   8]    m
  //  c=5 L=4     → λ ∈ [0.5, 2]    m  (capillary chop, no lower cap on smallest)
  //
  //Contiguous: each cascade's upper bound = next cascade's lower bound.
  //
  //The point of the L/8..L/2 slice is that each tile contains only 2–8
  //wavelengths of its dominant chop, so the tile's repeat distance is many
  //times the dominant wavelength — no visible tiling artifacts. The narrow
  //spectral band concentrates the FFT's 256² bin budget into the wavelengths
  //we want at that scale, instead of dribbling it across the whole k^-4 tail
  //(which is what wasted cascade 5's content under the previous design and
  //caused the "flat goo up close" look).
  //
  //Dispersion (ω = √(g·k)) reads cascadePatchSizes as meters so wave period/
  //speed remain physical.
  this.cascadePatchSizes = [4096.0, 1024.0, 256.0, 64.0, 16.0, 4.0];
  //Per-cascade spectral band in centered-FFT coord units (maxCoord = max(|nx|, |ny|)).
  //WAVE_SAMPLE_LOW..HIGH defines the kept octaves; non-edge cascades cull both
  //ends, the largest cascade allows everything below its HIGH, and the
  //smallest cascade allows everything above its LOW (so the long-swell and
  //capillary tails aren't lost at the band edges).
  const WAVE_SAMPLE_LOW = 2.0;
  const WAVE_SAMPLE_HIGH = 8.0;
  this.numCascades = this.cascadePatchSizes.length;
  this.textureWidth = data.patch_data_size;
  this.textureHeight = data.patch_data_size;
  this.N = data.number_of_octaves;
  this.renderer = renderer;
  document.body.appendChild(renderer.domElement);

  //Wind and JONSWAP parameters (shared across cascades).
  //
  //Sanity check for the default config (wind {8,5} → U=9.43 m/s, fetch 100 km,
  //gamma 3.3, wave_scale_multiple 1.5):
  //  omega_p   ≈ 22 · (g² / (U·F))^(1/3)        ≈ 1.03 rad/s
  //  T_p       = 2π / omega_p                   ≈ 6.1 s
  //  λ_p       = g·T_p² / (2π)                  ≈ 58 m
  //  H_s (PM)  = 0.21 · U² / g                  ≈ 1.91 m
  //  H_s (J3.3) ≈ H_s_PM · gamma^0.3            ≈ 2.73 m
  //  H_s × 1.5 (artistic boost from data.wave_scale_multiple) ≈ 4.1 m
  //
  //So with default settings expect significant wave height around 4 m and a
  //dominant wavelength near 58 m.
  let windVelocity = new THREE.Vector2(data.wind_velocity.x, data.wind_velocity.y);
  this.w = windVelocity.clone().normalize();
  const g = 9.80665;
  let windSpeed = windVelocity.length();
  let fetch = data.jonswap_fetch || 100000.0;
  this.jonswapGamma = data.jonswap_gamma || 3.3;
  //ω_p, the peak angular frequency. The JONSWAP fetch formula 22·(g²/(U·F))^(1/3)
  //is calibrated for moderate-to-strong winds; at very low wind speeds it returns
  //unphysically low ω_p (e.g. U=1 m/s gives ω_p ≈ 2.17 → λ_p ≈ 13 m, but a 1 m/s
  //breeze can't actually produce 13-m waves regardless of fetch). Cap from below
  //with the full Pierson-Moskowitz rule ω_p = 0.86·g/U so the dominant wavelength
  //collapses with the wind at low speeds.
  this.omega_p = windSpeed > 0.001
    ? Math.max(22.0 * Math.pow(g * g / (windSpeed * fetch), 1.0 / 3.0), 0.86 * g / windSpeed)
    : 1000000.0;

  //Per-cascade slope variance σ², computed analytically from the same JONSWAP
  //integrand the GPU h_0 pass uses. The water shader uses this to rebuild the
  //"effective roughness" of distant water: as the renderer mips/aliases away
  //a cascade's slope detail, that cascade's σ² contributes to a Karis-style
  //horizon clamp on Fresnel. Without it, distant water collapses to a smooth
  //macroNormal (NaN slope variance at the pixel scale) → full-Schlick at
  //grazing → bright sky mirror to the horizon. See water-shader.glsl Fresnel
  //block. cascadeRMSSlope is in units of (slope)² — feed directly into α²_GGX
  //after multiplying by waveHeightMultiplier² (which the shader does).
  this.cascadeRMSSlope = AWater.AOcean.LUTlibraries.OceanHeightBandLibrary.computeCascadeSlopeVariance(
    this.cascadePatchSizes, this.N, this.omega_p, this.jonswapGamma,
    (data.directional_turbulence !== undefined) ? data.directional_turbulence : 0.145
  );

  //Shared twiddle texture (same N for all cascades)
  this.twiddleTexture = AWater.AOcean.Materials.FFTWaves.computeTwiddleIndices(this.N, renderer);

  //Make a shortcut to our materials namespace
  const materials = AWater.AOcean.Materials.FFTWaves;

  //A is a dimensionless multiplier on the JONSWAP h_0 coefficient. Physical
  //alpha (0.0081) is baked into the shader and gives the true variance, so
  //A=1.0 = strictly physical amplitudes. `wave_scale_multiple` (applied as
  //waveHeightMultiplier in the vertex shader) is the user-facing artistic
  //dial. Previous A=2.5 was a hidden 2.5× boost that doubled-up with
  //wave_scale_multiple — it dated to the pre-rescale era where the world
  //was 14× too big and physical amplitudes read too small on-screen.
  let maxWaveAmplitude = 1.0;

  //Per-cascade noise UV offsets for decorrelation (golden-ratio based)
  const noiseOffsets = [];
  const phi = (1.0 + Math.sqrt(5.0)) / 2.0;
  for(let c = 0; c < this.numCascades; c++){
    noiseOffsets.push(new THREE.Vector2(
      ((c * phi) % 1.0),
      ((c * phi * phi) % 1.0)
    ));
  }

  // ========================================================================
  // STATIC GPU COMPUTE: Noise textures (shared) + h0 per cascade
  // ========================================================================
  this.staticGPUComputer = new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer);
  let staticGPUCompute = this.staticGPUComputer;

  //Create 4 noise textures (shared across all cascades)
  let offset = this.textureWidth * this.textureHeight;
  this.noiseTexture1 = staticGPUCompute.createTexture();
  this.noiseVar1 = staticGPUCompute.addVariable('textureNoise1', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture1);
  this.noiseVar1.minFilter = THREE.ClosestFilter;
  this.noiseVar1.magFilter = THREE.ClosestFilter;
  staticGPUCompute.setVariableDependencies(this.noiseVar1, []);
  this.noiseVar1.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  this.noiseVar1.material.uniforms.offset.value = 1.0;

  this.noiseTexture2 = staticGPUCompute.createTexture();
  this.noiseVar2 = staticGPUCompute.addVariable('textureNoise2', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture2);
  staticGPUCompute.setVariableDependencies(this.noiseVar2, []);
  this.noiseVar2.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  this.noiseVar2.material.uniforms.offset.value = this.noiseVar1.material.uniforms.offset.value + offset;
  this.noiseVar2.minFilter = THREE.ClosestFilter;
  this.noiseVar2.magFilter = THREE.ClosestFilter;

  this.noiseTexture3 = staticGPUCompute.createTexture();
  this.noiseVar3 = staticGPUCompute.addVariable('textureNoise3', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture3);
  staticGPUCompute.setVariableDependencies(this.noiseVar3, []);
  this.noiseVar3.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  this.noiseVar3.material.uniforms.offset.value = this.noiseVar2.material.uniforms.offset.value + offset;
  this.noiseVar3.minFilter = THREE.ClosestFilter;
  this.noiseVar3.magFilter = THREE.ClosestFilter;

  this.noiseTexture4 = staticGPUCompute.createTexture();
  this.noiseVar4 = staticGPUCompute.addVariable('textureNoise4', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture4);
  staticGPUCompute.setVariableDependencies(this.noiseVar4, []);
  this.noiseVar4.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  this.noiseVar4.material.uniforms.offset.value = this.noiseVar3.material.uniforms.offset.value + offset;
  this.noiseVar4.minFilter = THREE.ClosestFilter;
  this.noiseVar4.magFilter = THREE.ClosestFilter;

  //Per-cascade coord-space band [sampleLow, sampleHigh) on max(|nx|,|ny|).
  //Largest cascade keeps everything below HIGH (no LOW cull → long-swell tail);
  //smallest cascade keeps everything above LOW (no HIGH cull → capillary tail).
  this.cascadeSampleLow = [];
  this.cascadeSampleHigh = [];
  for(let c = 0; c < this.numCascades; c++){
    this.cascadeSampleLow.push(c === 0 ? 0.0 : WAVE_SAMPLE_LOW);
    this.cascadeSampleHigh.push(c === this.numCascades - 1 ? this.N : WAVE_SAMPLE_HIGH);
  }

  //Create h0 for each cascade (different L, noise offset, and k-band)
  this.h0Vars = [];
  for(let c = 0; c < this.numCascades; c++){
    let h0Texture = staticGPUCompute.createTexture();
    let h0Var = staticGPUCompute.addVariable(`textureH0_${c}`, materials.h0ShaderMaterialData.fragmentShader, h0Texture);
    h0Var.minFilter = THREE.ClosestFilter;
    h0Var.magFilter = THREE.ClosestFilter;
    staticGPUCompute.setVariableDependencies(h0Var, [this.noiseVar1, this.noiseVar2, this.noiseVar3, this.noiseVar4]);
    h0Var.material.uniforms = {
      ...h0Var.material.uniforms,
      ...JSON.parse(JSON.stringify(materials.h0ShaderMaterialData.uniforms))
    };
    h0Var.material.uniforms.N.value = this.N;
    h0Var.material.uniforms.L.value = this.cascadePatchSizes[c];
    h0Var.material.uniforms.A.value = maxWaveAmplitude;
    h0Var.material.uniforms.L_.value = 0.0;
    //Per-cascade wind rotation — each cascade's wave fronts run a slightly
    //different direction so the dominant visual motif can't recur at a
    //single cascade's tile period. ±30° spread keeps the overall "wind
    //from one direction" feel intact while decorrelating the cascades'
    //wave-front orientations. Hardcoded; see also [c] index below.
    h0Var.material.uniforms.w.value = AWater.AOcean.LUTlibraries.OceanHeightBandLibrary.rotateWindForCascade(this.w, c);
    h0Var.material.uniforms.omega_p.value = this.omega_p;
    h0Var.material.uniforms.gamma.value = this.jonswapGamma;
    h0Var.material.uniforms.noiseUVOffset.value = noiseOffsets[c];
    h0Var.material.uniforms.sampleLow.value = this.cascadeSampleLow[c];
    h0Var.material.uniforms.sampleHigh.value = this.cascadeSampleHigh[c];
    h0Var.material.uniforms.directionalTurbulence.value = (data.directional_turbulence !== undefined) ? data.directional_turbulence : 0.145;
    this.h0Vars.push(h0Var);
  }

  //Initialize and compute static textures
  let error1 = staticGPUCompute.init();
  if(error1 !== null){
    console.error(`Static GPU Compute Renderer: ${error1}`);
  }
  staticGPUCompute.compute();
  staticGPUCompute.compute(); //Must be run twice to fill up second ping pong shader

  // ========================================================================
  // DYNAMIC GPU COMPUTE: h_k time evolution per cascade (3 axes × 6 cascades)
  // ========================================================================
  this.hkRenderer = new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer);

  //Create h_k variables for each cascade and axis
  //hkVars[cascade][axis] where axis: 0=X, 1=Y, 2=Z
  this.hkVars = [];
  for(let c = 0; c < this.numCascades; c++){
    let cascadeVars = [];
    let h0Texture = staticGPUCompute.getCurrentRenderTarget(this.h0Vars[c]).texture;
    let cascadeL = this.cascadePatchSizes[c];

    //Y axis (height)
    let hkYTexture = this.hkRenderer.createTexture();
    let hkYVar = this.hkRenderer.addVariable(`textureHkY_${c}`, materials.hkShaderMaterialData.fragmentShader(false, true), hkYTexture);
    hkYVar.minFilter = THREE.ClosestFilter;
    hkYVar.magFilter = THREE.ClosestFilter;
    this.hkRenderer.setVariableDependencies(hkYVar, []);
    hkYVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
    hkYVar.material.uniforms.textureH0.value = h0Texture;
    hkYVar.material.uniforms.L.value = cascadeL;
    hkYVar.material.uniforms.uTime.value = 500.0;
    hkYVar.material.uniforms.N.value = this.N;

    //X axis (horizontal displacement)
    let hkXTexture = this.hkRenderer.createTexture();
    let hkXVar = this.hkRenderer.addVariable(`textureHkX_${c}`, materials.hkShaderMaterialData.fragmentShader(true, false), hkXTexture);
    hkXVar.minFilter = THREE.ClosestFilter;
    hkXVar.magFilter = THREE.ClosestFilter;
    this.hkRenderer.setVariableDependencies(hkXVar, []);
    hkXVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
    hkXVar.material.uniforms.textureH0.value = h0Texture;
    hkXVar.material.uniforms.L.value = cascadeL;
    hkXVar.material.uniforms.uTime.value = 500.0;
    hkXVar.material.uniforms.N.value = this.N;

    //Z axis (horizontal displacement)
    let hkZTexture = this.hkRenderer.createTexture();
    let hkZVar = this.hkRenderer.addVariable(`textureHkZ_${c}`, materials.hkShaderMaterialData.fragmentShader(false, false), hkZTexture);
    hkZVar.minFilter = THREE.ClosestFilter;
    hkZVar.magFilter = THREE.ClosestFilter;
    this.hkRenderer.setVariableDependencies(hkZVar, []);
    hkZVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
    hkZVar.material.uniforms.textureH0.value = h0Texture;
    hkZVar.material.uniforms.L.value = cascadeL;
    hkZVar.material.uniforms.uTime.value = 500.0;
    hkZVar.material.uniforms.N.value = this.N;

    cascadeVars.push(hkXVar, hkYVar, hkZVar); //[X, Y, Z]
    this.hkVars.push(cascadeVars);
  }

  let error3 = this.hkRenderer.init();
  if(error3 !== null){
    console.error(`Dynamic GPU Compute Renderer: ${error3}`);
  }
  this.hkRenderer.compute();

  // ========================================================================
  // MANUAL PING-PONG BUTTERFLY FFT
  // ========================================================================
  //Instead of creating N GPUComputationRenderer variables per butterfly chain,
  //use 2 raw WebGLRenderTargets and alternate between them for each stage.
  //This saves massive VRAM (2 targets vs ~18 per chain).

  let numStages = Math.ceil(Math.log(this.N) / Math.log(2));
  let textureWidth = this.textureWidth;
  let textureHeight = this.textureHeight;

  //Create shared fullscreen quad for butterfly rendering
  let butterflyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let butterflyQuadGeometry = new THREE.PlaneGeometry(2, 2);
  let butterflyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      inputTexture: {type: 't', value: null},
      twiddleTexture: {type: 't', value: this.twiddleTexture},
      stageFraction: {type: 'f', value: 0.0},
      direction: {type: 'i', value: 0},
      resolution: {type: 'v2', value: new THREE.Vector2(textureWidth, textureHeight)}
    },
    fragmentShader: materials.butterflyTextureData.fragmentShader,
    depthTest: false,
    depthWrite: false
  });
  let butterflyQuad = new THREE.Mesh(butterflyQuadGeometry, butterflyMaterial);
  let butterflyScene = new THREE.Scene();
  butterflyScene.add(butterflyQuad);

  //Create render target options
  let rtOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false
  };

  //Create 2 ping-pong targets per butterfly chain
  //butterflyTargets[cascade][axis] = [pingTarget, pongTarget]
  this.butterflyTargets = [];
  for(let c = 0; c < this.numCascades; c++){
    let cascadeTargets = [];
    for(let axis = 0; axis < 3; axis++){
      const ping = new THREE.WebGLRenderTarget(textureWidth, textureHeight, rtOptions);
      const pong = new THREE.WebGLRenderTarget(textureWidth, textureHeight, rtOptions);
      //Explicitly set RepeatWrapping — constructor options may not propagate in all Three.js versions
      ping.texture.wrapS = ping.texture.wrapT = THREE.RepeatWrapping;
      pong.texture.wrapS = pong.texture.wrapT = THREE.RepeatWrapping;
      cascadeTargets.push([ping, pong]);
    }
    this.butterflyTargets.push(cascadeTargets);
  }

  //Output displacement textures per cascade: wavesPerCascade[cascade][axis]
  this.wavesPerCascade = [];
  for(let c = 0; c < this.numCascades; c++){
    this.wavesPerCascade.push([null, null, null]); //[X, Y, Z]
  }

  //Helper: run full 2D butterfly FFT on an input texture, return result texture
  let self = this;
  function runButterflyFFT(inputTexture, pingTarget, pongTarget){
    let read = pingTarget;
    let write = pongTarget;

    //Horizontal butterfly passes
    for(let i = 0; i < numStages; i++){
      butterflyMaterial.uniforms.inputTexture.value = (i === 0) ? inputTexture : read.texture;
      butterflyMaterial.uniforms.direction.value = 0;
      butterflyMaterial.uniforms.stageFraction.value = i / (numStages - 1.0);
      renderer.setRenderTarget(write);
      renderer.render(butterflyScene, butterflyCamera);
      let tmp = read; read = write; write = tmp;
    }

    //Vertical butterfly passes
    for(let i = 0; i < numStages; i++){
      butterflyMaterial.uniforms.inputTexture.value = read.texture;
      butterflyMaterial.uniforms.direction.value = 1;
      butterflyMaterial.uniforms.stageFraction.value = i / (numStages - 1.0);
      renderer.setRenderTarget(write);
      renderer.render(butterflyScene, butterflyCamera);
      let tmp = read; read = write; write = tmp;
    }

    //Restore render target
    renderer.setRenderTarget(null);

    //Result is in read.texture
    return read.texture;
  }

  // ========================================================================
  // REGENERATE H0: Re-run the static spectrum pass with new wind parameters.
  // Must be called whenever wind_velocity changes at runtime so that the
  // frozen h0 textures (which drive all hk evolution) reflect the new wind.
  // ========================================================================
  this.regenerateH0 = function(newWindVelocity){
    const g = 9.80665;
    let wv = new THREE.Vector2(newWindVelocity.x, newWindVelocity.y);
    let windSpeed = wv.length();
    let newW = windSpeed > 0.001 ? wv.clone().normalize() : new THREE.Vector2(0.0, 0.0);
    //Mirror the construction-time ω_p cap (see above). Without this, the
    //fetch formula gives unphysically low ω_p at very low wind speeds.
    let newOmega_p = windSpeed > 0.001
      ? Math.max(22.0 * Math.pow(g * g / (windSpeed * fetch), 1.0 / 3.0), 0.86 * g / windSpeed)
      : 1000000.0;

    //Update h0 uniforms for every cascade. Wind direction gets per-cascade
    //rotation (see construction-time comment) so cascades' wave-front
    //directions decorrelate, breaking visible motif recurrence at single-
    //cascade tile periods.
    for(let c = 0; c < self.numCascades; c++){
      self.h0Vars[c].material.uniforms.w.value = AWater.AOcean.LUTlibraries.OceanHeightBandLibrary.rotateWindForCascade(newW, c);
      self.h0Vars[c].material.uniforms.omega_p.value = newOmega_p;
    }

    //Re-run the static compute twice to fill both ping-pong buffers
    staticGPUCompute.compute();
    staticGPUCompute.compute();

    //Update textureH0 in every hk variable to the newly written render target
    for(let c = 0; c < self.numCascades; c++){
      let newH0Texture = staticGPUCompute.getCurrentRenderTarget(self.h0Vars[c]).texture;
      for(let axis = 0; axis < 3; axis++){
        self.hkVars[c][axis].material.uniforms.textureH0.value = newH0Texture;
      }
    }

    self.w = newW;
    self.omega_p = newOmega_p;

    //Recompute per-cascade slope variances — depends on omega_p.
    self.cascadeRMSSlope = AWater.AOcean.LUTlibraries.OceanHeightBandLibrary.computeCascadeSlopeVariance(
      self.cascadePatchSizes, self.N, self.omega_p, self.jonswapGamma,
      (data.directional_turbulence !== undefined) ? data.directional_turbulence : 0.145
    );
  };

  // ========================================================================
  // TICK: Per-frame update
  // ========================================================================
  this.tick = function(time){
    //`time` is A-Frame's tick clock in MILLISECONDS. The h_k shader uses
    //uTime in cos(w * uTime) where w has units rad/s, so uTime must be in
    //seconds for physical dispersion to read correctly. /1000.0 = real time.
    //(The historical /512.0 ran the simulation at ~1.95x real-time, a fudge
    //tuned for the old huge-world scale where waves looked too slow.)
    for(let c = 0; c < self.numCascades; c++){
      for(let axis = 0; axis < 3; axis++){
        self.hkVars[c][axis].material.uniforms.uTime.value = time / 1000.0;
      }
    }
    self.hkRenderer.compute();

    //Run butterfly FFT for each cascade and axis (displacement)
    for(let c = 0; c < self.numCascades; c++){
      for(let axis = 0; axis < 3; axis++){
        let hkTexture = self.hkRenderer.getCurrentRenderTarget(self.hkVars[c][axis]).texture;
        let targets = self.butterflyTargets[c][axis];
        self.wavesPerCascade[c][axis] = runButterflyFFT(hkTexture, targets[0], targets[1]);
      }
    }
  };
}

//Per-cascade wind-direction rotation. Each cascade's h_0 spectrum is built
//from a rotated copy of the master wind vector so the resulting wave-front
//orientation differs slightly between cascades. The cascades still tile at
//their physical L periods, but because each cascade's dominant wave fronts
//run a different way, the combined visual signature can't repeat with one
//cascade's period — the recurrent "motif" is broken.
//
//Angles in degrees, indexed by cascade 0..5. C0 is the anchor (0°); the
//others fan out within a ±30° envelope. Order alternates sign so adjacent
//cascades sit on opposite sides of the master direction — keeps the total
//directional moment near zero so the surface still reads as "wind from one
//direction" rather than a chaotic chop-from-everywhere look.
AWater.AOcean.LUTlibraries.OceanHeightBandLibrary.CASCADE_WIND_ANGLES_DEG = [0, 10, -10, 20, -20, 30];

//Compute per-cascade slope variance σ² by mirroring the discrete h_0 spectrum
//the GPU writes. For each cascade we loop over every (nx, ny) bin in the same
//[sampleLow, sampleHigh) centered-FFT band, build h_0_coefficient² with the
//same JONSWAP + cos² spread + amplitude scaling, then accumulate k² ·
//E[|h(k,t)|²] across the band. The result is the total slope variance the
//ocean surface would carry in that cascade if every wavelength were
//well-resolved on screen — the water shader uses this as the "energy lost
//to mipping/aliasing" budget that drives a distance-roughness Fresnel clamp.
//
//Variance derivation:
//  Each texel stores h_0(k_+) AND h_0*(k_-) in (xy, zw). gaussRand gives
//  unit-variance real+imaginary parts, so:
//    E[|h_0(k_+)|²] = 2 · h0_coef² · spread_k²       (xy magnitude squared)
//    E[|h_0(k_-)|²] = 2 · h0_coef² · spread_-k²      (zw magnitude squared)
//  The hk pass forms h(k,t) = h_0(k_+) e^{iωt} + h_0*(k_-) e^{-iωt}, whose
//  expected squared magnitude (cross terms vanish under independence) is the
//  sum of the two terms above. spread_-k² = spread_k² because the spread is
//  symmetric under k → -k.
//  Slope variance accumulates k² weight: σ²_slope += k² · E[|h(k,t)|²].
//
//Returns Float32Array length numCascades. Result is in units of (slope)² —
//feed into α²_GGX in the shader after scaling by waveHeightMultiplier².
AWater.AOcean.LUTlibraries.OceanHeightBandLibrary.computeCascadeSlopeVariance = function(
    cascadePatchSizes, N, omega_p, gamma, directionalTurbulence){
  const g = 9.80665;
  const piTimes2 = 2.0 * Math.PI;
  const JONSWAP_ALPHA = 0.0081;
  const WAVE_SAMPLE_LOW = 2.0;
  const WAVE_SAMPLE_HIGH = 8.0;
  const turb = Math.max(0.0, Math.min(1.0, directionalTurbulence));

  const numCascades = cascadePatchSizes.length;
  //Plain Array (not Float32Array) to match the three.js uniform-upload pattern
  //used for cascadePatchSizes — the GLSL `float[6]` uniform reads a JS Array.
  const out = new Array(numCascades);

  const halfN = N * 0.5;

  for(let c = 0; c < numCascades; c++){
    const L = cascadePatchSizes[c];
    const dk = piTimes2 / L;
    const sampleLow  = (c === 0) ? 0.0 : WAVE_SAMPLE_LOW;
    const sampleHigh = (c === numCascades - 1) ? N : WAVE_SAMPLE_HIGH;
    const sampleLowCulled = Math.max(sampleLow, 1.0);

    //Angle-average of spread² over the full ring (see derivation in the
    //inner-loop comment block below). Constant per cascade.
    //  <(mix(cos²θ, ½, turb))²>_θ = (1-t)²·3/8 + (1-t)·t·½ + t²/4
    const oneMinusTurb = 1.0 - turb;
    const spreadSqAvg = oneMinusTurb * oneMinusTurb * (3.0 / 8.0)
                      + oneMinusTurb * turb * 0.5
                      + turb * turb * 0.25;

    let acc = 0.0;
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

        //JONSWAP S(ω) → S(k) via |dω/dk| = g/(2ω); 1D-omni → 2D via /k.
        const omega = Math.sqrt(g * magK);
        const sigma = omega <= omega_p ? 0.07 : 0.09;
        const r = Math.exp(-((omega - omega_p) * (omega - omega_p)) /
                           (2.0 * sigma * sigma * omega_p * omega_p));
        const pm = JONSWAP_ALPHA * g * g / Math.pow(omega, 5.0) *
                   Math.exp(-1.25 * Math.pow(omega_p / omega, 4.0));
        const jonswap = pm * Math.pow(gamma, r);
        const Sk = jonswap * g / (2.0 * omega);

        //h_0 coefficient (A=1 in current build; physical amplitudes baked in).
        const h0CoefSq = Sk * dk * dk / (2.0 * magK);

        //Spread² is angle-averaged because we're integrating over the whole
        //band; per-bin direction cancels in the sum. Derivation:
        //  <(mix(cos²θ, ½, turb))²>_θ
        //    = (1-turb)² · <cos⁴θ> + 2(1-turb)·turb · ½ · <cos²θ> + turb² · ¼
        //    = (1-turb)² · 3/8     + (1-turb)·turb · ½             + turb² / 4
        //Cascade wind rotation doesn't affect the band sum (rotating k and w
        //by the same angle is invariant under dot). spreadSqAvg computed once
        //above this loop.

        //Texel-total variance (h_0(k_+) and h_0*(k_-) packed together).
        //gauss.xy carries variance 2; the +k and -k parts each contribute
        //2 · h0_coef² · spread² → factor of 4 combined (spread_-k² = spread_k²).
        const texelVar = 4.0 * h0CoefSq * spreadSqAvg;

        acc += k2 * texelVar;
      }
    }
    out[c] = acc;
  }

  return out;
};

AWater.AOcean.LUTlibraries.OceanHeightBandLibrary.rotateWindForCascade = function(w, c){
  const angles = AWater.AOcean.LUTlibraries.OceanHeightBandLibrary.CASCADE_WIND_ANGLES_DEG;
  const angleDeg = (c >= 0 && c < angles.length) ? angles[c] : 0;
  const angle = angleDeg * Math.PI / 180;
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  return new THREE.Vector2(w.x * cs - w.y * sn, w.x * sn + w.y * cs);
};
