AWater.AOcean.LUTlibraries.OceanHeightBandLibrary = function(parentOceanGrid){
  let renderer = parentOceanGrid.renderer;
  let data = parentOceanGrid.data;
  this.numLevels = parentOceanGrid.numberOfOceanHeightBands;

  //Enable the OES_texture_float_linear extension
  if(!renderer.capabilities.isWebGL2 && !renderer.extensions.get("OES_texture_float_linear")){
    console.error("No linear interpolation of OES textures allowed.");
    return false;
  }

  //Key inner variables
  this.staticGPUComputer;
  this.hkRenderer;
  this.noiseVar1;
  this.noiseVar2;
  this.noiseVar3;
  this.noiseVar4;
  this.noiseTexture1;
  this.noiseTexture2;
  this.noiseTexture3;
  this.noiseTexture4;
  this.h0Var;
  this.h0Texture;
  this.hkXVar;
  this.hkYVar;
  this.hkZVar;
  this.hkXTexture;
  this.hkYTexture;
  this.hkZTexture;
  this.textureWidth = data.patch_data_size;
  this.textureHeight = data.patch_data_size;

  //The main library that is used in our wave engine
  this.filteredHkXTextures = new Array(this.numLevels);
  this.filteredHkYTextures = new Array(this.numLevels);
  this.filteredHkZTextures = new Array(this.numLevels);
  this.wavesXFilteredByAmplitude = new Array(this.numLevels);
  this.wavesYFilteredByAmplitude = new Array(this.numLevels);
  this.wavesZFilteredByAmplitude = new Array(this.numLevels);

  this.N = data.number_of_octaves; //N is The number of octaves that are used for the FFT
  this.L = data.patch_size; //L is the horizontal dimension of the patch
  let windVelocity = new THREE.Vector2(data.wind_velocity.x, data.wind_velocity.y);
  this.L_ = windVelocity.dot(windVelocity) * data.patch_data_size; //(Wind speed squared divided by gravity) (For some reason this gets multipled by the patch size?)
  this.w = windVelocity.clone().normalize(); //w is the wind direction
  this.renderer = renderer;
  document.body.appendChild(renderer.domElement);

  //Now compute our twiddle data for injection
  this.twiddleTexture = AWater.AOcean.Materials.FFTWaves.computeTwiddleIndices(this.N, renderer);

  //From https://planetcalc.com/4442/
  let maxWaveAmplitutude = 0.54 * this.L_;

  this.staticGPUComputer = new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer);
  this.hkRenderer = new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer);
  let hkRenderer = this.hkRenderer;

  //Make a shortcut to our materials namespace
  const materials = AWater.AOcean.Materials.FFTWaves;

  //Create 4 different textures for each of our noise LUTs.
  let offset = this.textureWidth * this.textureHeight;
  let staticGPUCompute = this.staticGPUComputer;
  this.noiseTexture1 = staticGPUCompute.createTexture();
  this.noiseVar1 = staticGPUCompute.addVariable('textureNoise1', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture1);
  let noiseVar1 = this.noiseVar1;
  noiseVar1.minFilter = THREE.ClosestFilter;
  noiseVar1.magFilter = THREE.ClosestFilter;
  staticGPUCompute.setVariableDependencies(noiseVar1, []);
  noiseVar1.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  noiseVar1.material.uniforms.offset.value = 1.0;
  this.noiseTexture2 = staticGPUCompute.createTexture();
  this.noiseVar2 = staticGPUCompute.addVariable('textureNoise2', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture2);
  let noiseVar2 = this.noiseVar2;
  staticGPUCompute.setVariableDependencies(noiseVar2, []);
  noiseVar2.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  noiseVar2.material.uniforms.offset.value = noiseVar1.material.uniforms.offset.value + this.textureWidth * this.textureHeight;
  noiseVar2.minFilter = THREE.ClosestFilter;
  noiseVar2.magFilter = THREE.ClosestFilter;
  this.noiseTexture3 = staticGPUCompute.createTexture();
  this.noiseVar3 = staticGPUCompute.addVariable('textureNoise3', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture3);
  let noiseVar3 = this.noiseVar3;
  staticGPUCompute.setVariableDependencies(noiseVar3, []);
  noiseVar3.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  noiseVar3.material.uniforms.offset.value = noiseVar2.material.uniforms.offset.value + this.textureWidth * this.textureHeight;
  noiseVar3.minFilter = THREE.ClosestFilter;
  noiseVar3.magFilter = THREE.ClosestFilter;
  this.noiseTexture4 = staticGPUCompute.createTexture();
  this.noiseVar4 = staticGPUCompute.addVariable('textureNoise4', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture4);
  let noiseVar4 = this.noiseVar4;
  staticGPUCompute.setVariableDependencies(noiseVar4, []);
  noiseVar4.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  noiseVar4.material.uniforms.offset.value = noiseVar3.material.uniforms.offset.value + this.textureWidth * this.textureHeight;
  noiseVar4.minFilter = THREE.ClosestFilter;
  noiseVar4.magFilter = THREE.ClosestFilter;

  //Produce the textures for our h0 shader
  this.h0Texture = staticGPUCompute.createTexture();
  this.h0Var = staticGPUCompute.addVariable('textureH0', materials.h0ShaderMaterialData.fragmentShader, this.h0Texture);
  this.h0Var.minFilter = THREE.ClosestFilter;
  this.h0Var.magFilter = THREE.ClosestFilter;
  let h0Var = this.h0Var;
  staticGPUCompute.setVariableDependencies(h0Var, [noiseVar1, noiseVar2, noiseVar3, noiseVar4]);
  h0Var.material.uniforms = {
    ...h0Var.material.uniforms,
    ...JSON.parse(JSON.stringify(materials.h0ShaderMaterialData.uniforms))
  }
  h0Var.material.uniforms.N.value = this.N;
  h0Var.material.uniforms.L.value = this.L;
  h0Var.material.uniforms.A.value = maxWaveAmplitutude;
  h0Var.material.uniforms.L_.value = this.L_;
  h0Var.material.uniforms.w.value = this.w.clone();

  //Now compute our h_0 texture for future use
  let error1 = staticGPUCompute.init();
  if(error1 !== null){
    console.error(`Static GPU Compute Renderer: ${error1}`);
  }
  staticGPUCompute.compute();
  staticGPUCompute.compute(); //Must be run twice to fill up second ping pong shader? Weird.

  //Initialize our h_k shader
  this.hkYTexture = hkRenderer.createTexture();
  this.hkYVar = hkRenderer.addVariable('textureHk', materials.hkShaderMaterialData.fragmentShader(false, true), this.hkYTexture);
  let hkYVar = this.hkYVar;
  this.hkYVar.minFilter = THREE.ClosestFilter;
  this.hkYVar.magFilter = THREE.ClosestFilter;
  hkRenderer.setVariableDependencies(hkYVar, []);//Note: We use manual texture dependency injection here.
  hkYVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
  hkYVar.material.uniforms.textureH0.value = this.staticGPUComputer.getCurrentRenderTarget(h0Var).texture;
  hkYVar.material.uniforms.L.value = 1000.0;
  hkYVar.material.uniforms.uTime.value = 500.0;
  hkYVar.material.uniforms.N.value = this.N;

  //Z-Shader
  this.hkXTexture = hkRenderer.createTexture();
  this.hkXVar = hkRenderer.addVariable('textureHk', materials.hkShaderMaterialData.fragmentShader(true, false), this.hkXTexture);
  let hkXVar = this.hkXVar;
  this.hkXVar.minFilter = THREE.ClosestFilter;
  this.hkXVar.magFilter = THREE.ClosestFilter;
  hkRenderer.setVariableDependencies(hkXVar, []);//Note: We use manual texture dependency injection here.
  hkXVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
  hkXVar.material.uniforms.textureH0.value = this.staticGPUComputer.getCurrentRenderTarget(h0Var).texture;
  hkXVar.material.uniforms.L.value = 1000.0;
  hkXVar.material.uniforms.uTime.value = 500.0;
  hkXVar.material.uniforms.N.value = this.N;

  //X-Axis
  this.hkZTexture = hkRenderer.createTexture();
  this.hkZVar = hkRenderer.addVariable('textureHk', materials.hkShaderMaterialData.fragmentShader(false, false), this.hkZTexture);
  let hkZVar = this.hkZVar;
  this.hkZVar.minFilter = THREE.ClosestFilter;
  this.hkZVar.magFilter = THREE.ClosestFilter;
  hkRenderer.setVariableDependencies(hkZVar, []);//Note: We use manual texture dependency injection here.
  hkZVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
  hkZVar.material.uniforms.textureH0.value = this.staticGPUComputer.getCurrentRenderTarget(h0Var).texture;
  hkZVar.material.uniforms.L.value = 1000.0;
  hkZVar.material.uniforms.uTime.value = 500.0;
  hkZVar.material.uniforms.N.value = this.N;

  //Now set up each of our filters
  this.hkXBandTextures = [];
  this.hkXBandVars = [];
  this.hkYBandTextures = [];
  this.hkYBandVars = [];
  this.hkZBandTextures = [];
  this.hkZBandVars = [];

  //This. This is totally ad-hoc crud. It's probably some exponentials or hyper-exponentials,
  //but fact that the numbers are as they are really makes little sense to me.
  //Honestly, the mere sight of this fills me with disgust. Blegh! I spit upon thee magic numbers!
  let frequencyRadaii = [0.05, 0.01, 0.002, 0.0014, 0.0];
  let bandFrequencyLimits = [10000.0, 750000.0, 10000000.0, 30000000.0, 100000000.0];
  for(let i = 0; i < this.numLevels; i++){
    this.hkYBandTextures.push(hkRenderer.createTexture());
    this.hkYBandVars.push(hkRenderer.addVariable(`textureHkYBand_${i}`, materials.amplitudeFilterShaderMaterial.fragmentShader(false, true), this.hkYBandTextures[i]));
    hkRenderer.setVariableDependencies(this.hkYBandVars[i], [hkYVar]);//Note: We use manual texture dependency injection here.
    this.hkYBandVars[i].material.uniforms = JSON.parse(JSON.stringify(materials.amplitudeFilterShaderMaterial.uniforms));
    this.hkYBandVars[i].material.uniforms.frequencyRadiusStart.value = frequencyRadaii[i];
    this.hkYBandVars[i].material.uniforms.maxBandwidthStart.value = bandFrequencyLimits[i];
    this.hkYBandVars[i].minFilter = THREE.ClosestFilter;
    this.hkYBandVars[i].magFilter = THREE.ClosestFilter;

    this.hkXBandTextures.push(hkRenderer.createTexture());
    this.hkXBandVars.push(hkRenderer.addVariable(`textureHkXBand_${i}`, materials.amplitudeFilterShaderMaterial.fragmentShader(true, false), this.hkXBandTextures[i]));
    hkRenderer.setVariableDependencies(this.hkXBandVars[i], [hkXVar]);//Note: We use manual texture dependency injection here.
    this.hkXBandVars[i].material.uniforms = JSON.parse(JSON.stringify(materials.amplitudeFilterShaderMaterial.uniforms));
    this.hkXBandVars[i].material.uniforms.frequencyRadiusStart.value = frequencyRadaii[i];
    this.hkXBandVars[i].material.uniforms.maxBandwidthStart.value = bandFrequencyLimits[i];
    this.hkXBandVars[i].minFilter = THREE.ClosestFilter;
    this.hkXBandVars[i].magFilter = THREE.ClosestFilter;

    this.hkZBandTextures.push(hkRenderer.createTexture());
    this.hkZBandVars.push(hkRenderer.addVariable(`textureHkZBand_${i}`, materials.amplitudeFilterShaderMaterial.fragmentShader(false, false), this.hkZBandTextures[i]));
    hkRenderer.setVariableDependencies(this.hkZBandVars[i], [hkZVar]);//Note: We use manual texture dependency injection here.
    this.hkZBandVars[i].material.uniforms = JSON.parse(JSON.stringify(materials.amplitudeFilterShaderMaterial.uniforms));
    this.hkZBandVars[i].material.uniforms.frequencyRadiusStart.value = frequencyRadaii[i];
    this.hkZBandVars[i].material.uniforms.maxBandwidthStart.value = bandFrequencyLimits[i];
    this.hkZBandVars[i].minFilter = THREE.ClosestFilter;
    this.hkZBandVars[i].magFilter = THREE.ClosestFilter;
  }

  let error3 = hkRenderer.init();
  if(error3 !== null){
    console.error(`Dynamic GPU Compute Renderer: ${error3}`);
  }
  hkRenderer.compute();

  //Now hook each of the above bands into each of our ocean wave height bands
  this.butterflyRenderers = [];
  this.butterflyTextureVarHolder = [];
  this.finalButterflyTextureVars = [];
  for(let dimension = 0; dimension < 3; dimension++){
    this.butterflyRenderers.push([]);
    this.butterflyTextureVarHolder.push([]);
    this.finalButterflyTextureVars.push([]);
    for(let i = 0; i < this.numLevels; i++){
      //Initialize our GPU Compute Renderer
      this.butterflyRenderers[dimension].push(new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer));
      let butterflyRenderer = this.butterflyRenderers[dimension][i];

      //Set up our butterfly height generator
      let butterflyTextureVars = [];
      let numPingPongIterations = Math.ceil(Math.log(this.N) / Math.log(2));
      let butterflyTextureInit = this.hkRenderer.createTexture();
      butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_0`, materials.butterflyTextureData.fragmentShader('hk_texture', true), butterflyTextureInit));
      butterflyRenderer.setVariableDependencies(butterflyTextureVars[0], []);
      butterflyTextureVars[0].material.uniforms = JSON.parse(JSON.stringify(materials.butterflyTextureData.uniforms));
      butterflyTextureVars[0].material.uniforms.pingpong_hk_texture = {};
      butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.type = 't';
      butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.value = null;
      butterflyTextureVars[0].material.uniforms.direction.value = 0;
      butterflyTextureVars[0].material.uniforms.stageFraction.value = 0.0;
      butterflyTextureVars[0].material.uniforms.twiddleTexture.value = this.twiddleTexture;

      //Now we can perform the remaining butterfly operations using the above texture
      for(let i = 1; i < numPingPongIterations; i++){
        let butterFlyTexture = butterflyRenderer.createTexture();
        butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_${i}`, materials.butterflyTextureData.fragmentShader(i - 1), butterFlyTexture));
        butterflyRenderer.setVariableDependencies(butterflyTextureVars[i], [butterflyTextureVars[i - 1]]);
        butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(materials.butterflyTextureData.uniforms));
        butterflyTextureVars[i].material.uniforms.direction.value = 0;
        butterflyTextureVars[i].material.uniforms.stageFraction.value = i / (numPingPongIterations - 1.0);
        butterflyTextureVars[i].material.uniforms.twiddleTexture.value = this.twiddleTexture;
        butterflyTextureVars[i].minFilter = THREE.NearestFilter;
        butterflyTextureVars[i].magFilter = THREE.NearestFilter;
      }
      let numPingPongIterationsTimes2 = numPingPongIterations * 2;
      for(let i = numPingPongIterations; i < numPingPongIterationsTimes2; i++){
        let butterFlyTexture = butterflyRenderer.createTexture();
        butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_${i}`, materials.butterflyTextureData.fragmentShader(i - 1), butterFlyTexture));
        butterflyRenderer.setVariableDependencies(butterflyTextureVars[i], [butterflyTextureVars[i - 1]]);
        butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(materials.butterflyTextureData.uniforms));
        butterflyTextureVars[i].material.uniforms.direction.value = 1;
        butterflyTextureVars[i].material.uniforms.stageFraction.value = (i - numPingPongIterations) / (numPingPongIterations - 1.0);
        butterflyTextureVars[i].material.uniforms.twiddleTexture.value = this.twiddleTexture;
        butterflyTextureVars[i].minFilter = THREE.NearestFilter;
        butterflyTextureVars[i].magFilter = THREE.NearestFilter;
      }
      this.finalButterflyTextureVars[dimension].push(butterflyTextureVars[numPingPongIterationsTimes2 - 1]);
      this.butterflyTextureVarHolder[dimension].push(butterflyTextureVars);

      let error4 = butterflyRenderer.init();
      if(error4 !== null){
        console.error(`Butterfly Texture Renderer: ${error4}`);
      }
      butterflyRenderer.compute();
    }
  }

  let self = this;
  this.tick = function(time, activeTextures){
    //Update the time variable of our phillipse spectrum and update hk
    self.hkXVar.material.uniforms.uTime.value = time / 1000.0;
    self.hkYVar.material.uniforms.uTime.value = time / 1000.0;
    self.hkZVar.material.uniforms.uTime.value = time / 1000.0;
    self.hkRenderer.compute();

    //Grab each of the textures from each of our filters
    for(let i = 0; i < self.numLevels; ++i){
      //Get the hk for the given band
      self.butterflyTextureVarHolder[0][i][0].material.uniforms.pingpong_hk_texture.value = self.hkRenderer.getCurrentRenderTarget(self.hkXBandVars[i]).texture;
      self.butterflyRenderers[0][i].compute();

      //Store this for future requests
      self.wavesXFilteredByAmplitude[i] = self.butterflyRenderers[0][i].getCurrentRenderTarget(self.finalButterflyTextureVars[0][i]).texture;
    }

    for(let i = 0; i < self.numLevels; ++i){
      //Get the hk for the given band
      self.butterflyTextureVarHolder[1][i][0].material.uniforms.pingpong_hk_texture.value = self.hkRenderer.getCurrentRenderTarget(self.hkYBandVars[i]).texture;
      self.butterflyRenderers[1][i].compute();

      //Store this for future requests
      self.wavesYFilteredByAmplitude[i] = self.butterflyRenderers[1][i].getCurrentRenderTarget(self.finalButterflyTextureVars[1][i]).texture;
    }

    for(let i = 0; i < self.numLevels; ++i){
      //Get the hk for the given band
      self.butterflyTextureVarHolder[2][i][0].material.uniforms.pingpong_hk_texture.value = self.hkRenderer.getCurrentRenderTarget(self.hkZBandVars[i]).texture;
      self.butterflyRenderers[2][i].compute();

      //Store this for future requests
      self.wavesZFilteredByAmplitude[i] = self.butterflyRenderers[2][i].getCurrentRenderTarget(self.finalButterflyTextureVars[2][i]).texture;
    }
  };
}
