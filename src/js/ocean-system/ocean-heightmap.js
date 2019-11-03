function OceanHeightmap(data, renderer){
  const textureWidth = data.patch_data_size;
  const textureHeight = data.patch_data_size;
  this.N = data.number_of_octaves;
  this.L = data.L;
  this.A = data.A;
  this.L_ = (26.0 * 26.0) / 9.81;
  this.w = data.wind_velocity;
  this.renderer = renderer;
  document.body.appendChild(renderer.domElement);

  //Initialize our GPU Compute Renderers
  this.staticGPUCompute = new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer);
  this.hkRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer);
  this.butterflyRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer);
  this.waveHeightRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer);

  //Create 4 different textures for each of our noise LUTs.
  let offset = textureWidth * textureHeight;
  let noiseInit1 = this.staticGPUCompute.createTexture();
  let noise1Var = this.staticGPUCompute.addVariable('textureNoise1', noiseShaderMaterialData.fragmentShader, noiseInit1);
  this.staticGPUCompute.setVariableDependencies(noise1Var, []);
  noise1Var.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
  noise1Var.material.uniforms.offset.value = 1.0;
  let noiseInit2 = this.staticGPUCompute.createTexture();
  let noise2Var = this.staticGPUCompute.addVariable('textureNoise2', noiseShaderMaterialData.fragmentShader, noiseInit2);
  this.staticGPUCompute.setVariableDependencies(noise2Var, []);
  noise2Var.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
  noise2Var.material.uniforms.offset.value = noise1Var.material.uniforms.offset.value + textureWidth * textureHeight;
  let noiseInit3 = this.staticGPUCompute.createTexture();
  let noise3Var = this.staticGPUCompute.addVariable('textureNoise3', noiseShaderMaterialData.fragmentShader, noiseInit3);
  this.staticGPUCompute.setVariableDependencies(noise3Var, []);
  noise3Var.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
  noise3Var.material.uniforms.offset.value = noise2Var.material.uniforms.offset.value + textureWidth * textureHeight;
  let noiseInit4 = this.staticGPUCompute.createTexture();
  let noise4Var = this.staticGPUCompute.addVariable('textureNoise4', noiseShaderMaterialData.fragmentShader, noiseInit4);
  this.staticGPUCompute.setVariableDependencies(noise4Var, []);
  noise4Var.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
  noise4Var.material.uniforms.offset.value = noise3Var.material.uniforms.offset.value + textureWidth * textureHeight;

  //Produce the texture for our h0 shader
  let h0TextureInit = this.staticGPUCompute.createTexture();
  let h0TextureVar = this.staticGPUCompute.addVariable('textureH0', h0ShaderMaterialData.fragmentShader, h0TextureInit);
  this.staticGPUCompute.setVariableDependencies(h0TextureVar, [noise1Var, noise2Var, noise3Var, noise4Var]);
  h0TextureVar.material.uniforms = {
    ...h0TextureVar.material.uniforms,
    ...JSON.parse(JSON.stringify(h0ShaderMaterialData.uniforms))
  }
  h0TextureVar.material.uniforms.N.value = this.N;
  h0TextureVar.material.uniforms.L.value = this.L;
  h0TextureVar.material.uniforms.A.value = this.A;
  h0TextureVar.material.uniforms.L_.value = this.L_;
  h0TextureVar.material.uniforms.w.value = new THREE.Vector2(1.0, 0.0);

  //Now compute our h_0 texture for future use
  let error1 = this.staticGPUCompute.init();
  if(error1 !== null){
    console.error(`Static GPU Compute Renderer: ${error1}`);
  }
  this.staticGPUCompute.compute();
  this.staticGPUCompute.compute(); //Must be run twice to fill up second ping pong shader? Weird.

  //Now compute our twiddle data for injection
  let twiddleTexture = computeTwiddleIndices(h0TextureVar.material.uniforms.N.value, renderer);

  //Initialize our h_k shader
  let hkTextureInit = this.hkRenderer.createTexture();
  this.hkTextureVar = this.hkRenderer.addVariable('textureHk', hkShaderMaterialData.fragmentShader, hkTextureInit);
  this.hkRenderer.setVariableDependencies(this.hkTextureVar, []);//Note: We use manual texture dependency injection here.
  this.hkTextureVar.material.uniforms = JSON.parse(JSON.stringify(hkShaderMaterialData.uniforms));
  this.hkTextureVar.material.uniforms.textureH0.value = this.staticGPUCompute.getCurrentRenderTarget(h0TextureVar).texture;
  this.hkTextureVar.material.uniforms.L.value = 1000.0;
  this.hkTextureVar.material.uniforms.uTime.value = 500.0;
  this.hkTextureVar.material.uniforms.N.value = this.N;

  let error3 = this.hkRenderer.init();
  if(error3 !== null){
    console.error(`Dynamic GPU Compute Renderer: ${error3}`);
  }
  this.hkRenderer.compute();

  //Set up our butterfly height generator
  this.butterflyTextureVars = [];
  let numPingPongIterations = Math.ceil(Math.log(this.N) / Math.log(2));
  let butterflyTextureInit = this.hkRenderer.createTexture();
  this.butterflyTextureVars.push(this.butterflyRenderer.addVariable(`pingpong_0`, butterflyTextureData.fragmentShader('hk_texture', true), butterflyTextureInit));
  this.butterflyRenderer.setVariableDependencies(this.butterflyTextureVars[0], []);
  this.butterflyTextureVars[0].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture = {};
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.type = 't';
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.value = this.hkRenderer.getCurrentRenderTarget(this.hkTextureVar).texture;
  this.butterflyTextureVars[0].material.uniforms.direction.value = 0;
  this.butterflyTextureVars[0].material.uniforms.stageFraction.value = 0.0;
  this.butterflyTextureVars[0].material.uniforms.twiddleTexture.value = twiddleTexture;
  for(let i = 1; i < numPingPongIterations; i++){
    let butterflyTextureInit = this.hkRenderer.createTexture();
    this.butterflyTextureVars.push(this.butterflyRenderer.addVariable(`pingpong_${i}`, butterflyTextureData.fragmentShader(i - 1), butterflyTextureInit));
    this.butterflyRenderer.setVariableDependencies(this.butterflyTextureVars[i], [this.butterflyTextureVars[i - 1]]);
    this.butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
    this.butterflyTextureVars[i].material.uniforms.direction.value = 0;
    this.butterflyTextureVars[i].material.uniforms.stageFraction.value = i / (numPingPongIterations - 1.0);
    this.butterflyTextureVars[i].material.uniforms.twiddleTexture.value = twiddleTexture;
  }
  let numPingPongIterationsTimes2 = numPingPongIterations * 2;
  for(let i = numPingPongIterations; i < numPingPongIterationsTimes2; i++){
    let butterflyTextureInit = this.hkRenderer.createTexture();
    this.butterflyTextureVars.push(this.butterflyRenderer.addVariable(`pingpong_${i}`, butterflyTextureData.fragmentShader(i - 1), butterflyTextureInit));
    this.butterflyRenderer.setVariableDependencies(this.butterflyTextureVars[i], [this.butterflyTextureVars[i - 1]]);
    this.butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
    this.butterflyTextureVars[i].material.uniforms.direction.value = 1;
    this.butterflyTextureVars[i].material.uniforms.stageFraction.value = (i - numPingPongIterations) / (numPingPongIterations - 1.0);
    this.butterflyTextureVars[i].material.uniforms.twiddleTexture.value = twiddleTexture;
  }
  this.finalButterflyTextureVar = this.butterflyTextureVars[numPingPongIterationsTimes2 - 1];

  let error4 = this.butterflyRenderer.init();
  if(error4 !== null){
    console.error(`Butterfly Texture Renderer: ${error4}`);
  }
  this.butterflyRenderer.compute();

  //Initialize our wave height shader
  let waveHeightTextureInit = this.waveHeightRenderer.createTexture();
  this.waveHeightTextureVar = this.waveHeightRenderer.addVariable('textureWaveHeight', waveHeightShaderMaterialData.fragmentShader, waveHeightTextureInit);
  this.waveHeightRenderer.setVariableDependencies(this.waveHeightTextureVar, []);//Note: We use manual texture dependency injection here.
  this.waveHeightTextureVar.material.uniforms = JSON.parse(JSON.stringify(waveHeightShaderMaterialData.uniforms));
  this.waveHeightTextureVar.material.uniforms.butterflyTexture.value = this.butterflyRenderer.getCurrentRenderTarget(this.finalButterflyTextureVar).texture;
  this.waveHeightTextureVar.material.uniforms.N.value = this.N;

  let error5 = this.waveHeightRenderer.init();
  if(error5 !== null){
    console.error(`Wave Height Renderer: ${error5}`);
  }

  //To be removed when we eventually combine multiples of these
  this.heightmapTexture;

  //This that is used in internal functions
  let self = this;

  this.tick = function(time){
    //Update the time variable of our phillipse spectrum and update hk
    self.hkTextureVar.material.uniforms.uTime.value = time / 1000.0;
    self.hkRenderer.compute();

    //Update our ping-pong butterfly texture
    self.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.value = self.hkRenderer.getCurrentRenderTarget(self.hkTextureVar).texture;
    self.butterflyRenderer.compute();

    self.waveHeightTextureVar.material.uniforms.butterflyTexture.value = self.butterflyRenderer.getCurrentRenderTarget(self.finalButterflyTextureVar).texture;
    self.waveHeightRenderer.compute();

    return self.waveHeightRenderer.getCurrentRenderTarget(self.waveHeightTextureVar).texture;
  }
}
