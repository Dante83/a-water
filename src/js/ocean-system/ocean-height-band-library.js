function OceanHeightBandLibrary(parentOceanGrid){
  let renderer = parentOceanGrid.renderer;
  let data = parentOceanGrid.data;
  this.numLevels = parentOceanGrid.numberOfOceanHeightBands;

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
  this.hkVar;
  this.hkTexture;
  this.textureWidth = data.patch_data_size;
  this.textureHeight = data.patch_data_size;

  //The main library that is used in our wave engine
  this.filteredHkTextures = new Array(this.numLevels);
  this.wavesFilteredByAmplitude = new Array(this.numLevels);

  this.N = data.number_of_octaves; //N is The number of octaves that are used for the FFT
  this.L = data.patch_size; //L is the horizontal dimension of the patch
  let windVelocity = new THREE.Vector2(data.wind_velocity.x, data.wind_velocity.y);
  this.L_ = windVelocity.dot(windVelocity) * data.patch_data_size; //(Wind speed squared divided by gravity) (For some reason this gets multipled by the patch size?)
  this.w = windVelocity.clone().normalize(); //w is the wind direction
  this.renderer = renderer;
  document.body.appendChild(renderer.domElement);

  //Now compute our twiddle data for injection
  this.twiddleTexture = computeTwiddleIndices(this.N, renderer);

  //From https://planetcalc.com/4442/
  let maxWaveAmplitutude = 0.54 * this.L_;

  this.staticGPUComputer = new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer);
  this.hkRenderer = new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer);
  let hkRenderer = this.hkRenderer;

  //Create 4 different textures for each of our noise LUTs.
  let offset = this.textureWidth * this.textureHeight;
  let staticGPUCompute = this.staticGPUComputer;
  this.noiseTexture1 = staticGPUCompute.createTexture();
  this.noiseVar1 = staticGPUCompute.addVariable('textureNoise1', noiseShaderMaterialData.fragmentShader, this.noiseTexture1);
  let noiseVar1 = this.noiseVar1;
  staticGPUCompute.setVariableDependencies(noiseVar1, []);
  noiseVar1.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
  noiseVar1.material.uniforms.offset.value = 1.0;
  this.noiseTexture2 = staticGPUCompute.createTexture();
  this.noiseVar2 = staticGPUCompute.addVariable('textureNoise2', noiseShaderMaterialData.fragmentShader, this.noiseTexture2);
  let noiseVar2 = this.noiseVar2;
  staticGPUCompute.setVariableDependencies(noiseVar2, []);
  noiseVar2.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
  noiseVar2.material.uniforms.offset.value = noiseVar1.material.uniforms.offset.value + this.textureWidth * this.textureHeight;
  this.noiseTexture3 = staticGPUCompute.createTexture();
  this.noiseVar3 = staticGPUCompute.addVariable('textureNoise3', noiseShaderMaterialData.fragmentShader, this.noiseTexture3);
  let noiseVar3 = this.noiseVar3;
  staticGPUCompute.setVariableDependencies(noiseVar3, []);
  noiseVar3.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
  noiseVar3.material.uniforms.offset.value = noiseVar2.material.uniforms.offset.value + this.textureWidth * this.textureHeight;
  this.noiseTexture4 = staticGPUCompute.createTexture();
  this.noiseVar4 = staticGPUCompute.addVariable('textureNoise4', noiseShaderMaterialData.fragmentShader, this.noiseTexture4);
  let noiseVar4 = this.noiseVar4;
  staticGPUCompute.setVariableDependencies(noiseVar4, []);
  noiseVar4.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
  noiseVar4.material.uniforms.offset.value = noiseVar3.material.uniforms.offset.value + this.textureWidth * this.textureHeight;

  //Produce the textures for our h0 shader
  this.h0Texture = staticGPUCompute.createTexture();
  this.h0Var = staticGPUCompute.addVariable('textureH0', h0ShaderMaterialData.fragmentShader, this.h0Texture);
  let h0Var = this.h0Var;
  staticGPUCompute.setVariableDependencies(h0Var, [noiseVar1, noiseVar2, noiseVar3, noiseVar4]);
  h0Var.material.uniforms = {
    ...h0Var.material.uniforms,
    ...JSON.parse(JSON.stringify(h0ShaderMaterialData.uniforms))
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
  this.hkTexture = hkRenderer.createTexture();
  this.hkVar = hkRenderer.addVariable('textureHk', hkShaderMaterialData.fragmentShader, this.hkTexture);
  let hkVar = this.hkVar;
  hkRenderer.setVariableDependencies(hkVar, []);//Note: We use manual texture dependency injection here.
  hkVar.material.uniforms = JSON.parse(JSON.stringify(hkShaderMaterialData.uniforms));
  hkVar.material.uniforms.textureH0.value = this.staticGPUComputer.getCurrentRenderTarget(h0Var).texture;
  hkVar.material.uniforms.L.value = 1000.0;
  hkVar.material.uniforms.uTime.value = 500.0;
  hkVar.material.uniforms.N.value = this.N;

  //Now set up each of our filters
  this.hkBandTextures = [];
  this.hkBandVars = [];

  //This. This is totally ad-hoc crud. It's probably some exponentials or hyper-exponentials,
  //but fact that the numbers are as they are really makes little sense to me.
  //Honestly, the mere sight of this fills me with disgust. Blegh! I spit upon thee magic numbers!
  let frequencyRadaii = [0.05, 0.01, 0.002, 0.0014, 0.0];
  let bandFrequencyLimits = [10000.0, 750000.0, 10000000.0, 30000000.0, 100000000.0];
  for(let i = 0; i < this.numLevels; i++){
    this.hkBandTextures.push(hkRenderer.createTexture());
    this.hkBandVars.push(hkRenderer.addVariable(`textureHkBand_${i}`, amplitudeFilterShaderMaterial.fragmentShader(), this.hkBandTextures[i]));
    hkRenderer.setVariableDependencies(this.hkBandVars[i], [hkVar]);//Note: We use manual texture dependency injection here.
    this.hkBandVars[i].material.uniforms = JSON.parse(JSON.stringify(amplitudeFilterShaderMaterial.uniforms));
    this.hkBandVars[i].material.uniforms.frequencyRadiusStart.value = frequencyRadaii[i];
    this.hkBandVars[i].material.uniforms.maxBandwidthStart.value = bandFrequencyLimits[i];
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
  for(let i = 0; i < this.numLevels; i++){
    //Initialize our GPU Compute Renderer
    this.butterflyRenderers.push(new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer));
    let butterflyRenderer = this.butterflyRenderers[i];

    //Set up our butterfly height generator
    let butterflyTextureVars = [];
    let numPingPongIterations = Math.ceil(Math.log(this.N) / Math.log(2));
    let butterflyTextureInit = this.hkRenderer.createTexture();
    butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_0`, butterflyTextureData.fragmentShader('hk_texture', true), butterflyTextureInit));
    butterflyRenderer.setVariableDependencies(butterflyTextureVars[0], []);
    butterflyTextureVars[0].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
    butterflyTextureVars[0].material.uniforms.pingpong_hk_texture = {};
    butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.type = 't';
    butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.value = this.hkRenderer.getCurrentRenderTarget(this.hkBandVars[i]).texture;
    butterflyTextureVars[0].material.uniforms.direction.value = 0;
    butterflyTextureVars[0].material.uniforms.stageFraction.value = 0.0;
    butterflyTextureVars[0].material.uniforms.twiddleTexture.value = this.twiddleTexture;

    //Now we can perform the remaining butterfly operations using the above texture
    for(let i = 1; i < numPingPongIterations; i++){
      let butterFlyTexture = butterflyRenderer.createTexture();
      butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_${i}`, butterflyTextureData.fragmentShader(i - 1), butterFlyTexture));
      butterflyRenderer.setVariableDependencies(butterflyTextureVars[i], [butterflyTextureVars[i - 1]]);
      butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
      butterflyTextureVars[i].material.uniforms.direction.value = 0;
      butterflyTextureVars[i].material.uniforms.stageFraction.value = i / (numPingPongIterations - 1.0);
      butterflyTextureVars[i].material.uniforms.twiddleTexture.value = this.twiddleTexture;
    }
    let numPingPongIterationsTimes2 = numPingPongIterations * 2;
    for(let i = numPingPongIterations; i < numPingPongIterationsTimes2; i++){
      let butterFlyTexture = butterflyRenderer.createTexture();
      butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_${i}`, butterflyTextureData.fragmentShader(i - 1), butterFlyTexture));
      butterflyRenderer.setVariableDependencies(butterflyTextureVars[i], [butterflyTextureVars[i - 1]]);
      butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
      butterflyTextureVars[i].material.uniforms.direction.value = 1;
      butterflyTextureVars[i].material.uniforms.stageFraction.value = (i - numPingPongIterations) / (numPingPongIterations - 1.0);
      butterflyTextureVars[i].material.uniforms.twiddleTexture.value = this.twiddleTexture;
    }
    this.finalButterflyTextureVars.push(butterflyTextureVars[numPingPongIterationsTimes2 - 1]);
    this.butterflyTextureVarHolder.push(butterflyTextureVars);

    let error4 = butterflyRenderer.init();
    if(error4 !== null){
      console.error(`Butterfly Texture Renderer: ${error4}`);
    }
    butterflyRenderer.compute();
  }

  let self = this;
  this.tick = function(time, activeTextures){
    //Update the time variable of our phillipse spectrum and update hk
    self.hkVar.material.uniforms.uTime.value = time / 1000.0;
    self.hkRenderer.compute();

    //Grab each of the textures from each of our filters
    for(let i = 0; i < self.numLevels; ++i){
      //Get the hk for the given band
      self.butterflyTextureVarHolder[i][0].material.uniforms.pingpong_hk_texture.value = self.hkRenderer.getCurrentRenderTarget(self.hkBandVars[i]).texture;
      self.butterflyRenderers[i].compute();

      //Store this for future requests
      self.wavesFilteredByAmplitude[i] = self.butterflyRenderers[i].getCurrentRenderTarget(self.finalButterflyTextureVars[i]).texture;
    }
  };
}
