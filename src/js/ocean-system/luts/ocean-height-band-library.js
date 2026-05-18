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
    h0Var.material.uniforms.w.value = this.w.clone();
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

    //Update h0 uniforms for every cascade
    for(let c = 0; c < self.numCascades; c++){
      self.h0Vars[c].material.uniforms.w.value = newW.clone();
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
