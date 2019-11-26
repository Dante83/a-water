function OceanHeightmap(data, renderer, oceanMaterialHkLibrary, cornerHeights, cornerDissipationVectors){
  const textureWidth = data.patch_data_size;
  const textureHeight = data.patch_data_size;
  this.N = data.number_of_octaves;
  this.L = data.L;
  this.A = data.A;
  this.L_ = (26.0 * 26.0) / 9.81;
  this.w = data.wind_velocity;
  this.renderer = renderer;
  this.oceanMaterialHkLibrary = oceanMaterialHkLibrary;
  this.cornerHeights = cornerHeights;
  this.cornerDissipationVectors = cornerDissipationVectors;
  document.body.appendChild(renderer.domElement);

  //Initialize our GPU Compute Renderers
  this.butterflyRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer);
  this.waveHeightRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer);
  this.waveNormalMapRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer);

  //Now compute our twiddle data for injection
  let twiddleTexture = computeTwiddleIndices(this.N, renderer);

  //Set up our butterfly height generator
  this.butterflyTextureVars = [];
  let numPingPongIterations = Math.ceil(Math.log(this.N) / Math.log(2));
  let butterflyTextureInit = this.butterflyRenderer.createTexture();
  this.butterflyTextureVars.push(this.butterflyRenderer.addVariable(`pingpong_0`, butterflyTextureDataInitializer.fragmentShader(), butterflyTextureInit));
  this.butterflyRenderer.setVariableDependencies(this.butterflyTextureVars[0], []);
  this.butterflyTextureVars[0].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));

  //We now use four hk textures for each of the corners
  let i0 = oceanMaterialHkLibrary.waterDepthToIndex(cornerHeights[0]);
  this.targetHKRenderer0 = oceanMaterialHkLibrary.hkRenderers[i0];
  this.targetHKVar0 = oceanMaterialHkLibrary.hkTextureVars[i0];
  let i1 = oceanMaterialHkLibrary.waterDepthToIndex(cornerHeights[1]);
  this.targetHKRenderer1 = oceanMaterialHkLibrary.hkRenderers[i1];
  this.targetHKVar1 = oceanMaterialHkLibrary.hkTextureVars[i1];
  let i2 = oceanMaterialHkLibrary.waterDepthToIndex(cornerHeights[2]);
  this.targetHKRenderer2 = oceanMaterialHkLibrary.hkRenderers[i2];
  this.targetHKVar2 = oceanMaterialHkLibrary.hkTextureVars[i2];
  let i3 = oceanMaterialHkLibrary.waterDepthToIndex(cornerHeights[3]);
  this.targetHKRenderer3 = oceanMaterialHkLibrary.hkRenderers[i3];
  this.targetHKVar3 = oceanMaterialHkLibrary.hkTextureVars[i3];
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_0 = {};
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_0.value = this.targetHKRenderer0.getCurrentRenderTarget(this.targetHKVar0).texture;
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_1 = {};
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_1.value = this.targetHKRenderer1.getCurrentRenderTarget(this.targetHKVar1).texture;
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_2 = {};
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_2.value = this.targetHKRenderer2.getCurrentRenderTarget(this.targetHKVar2).texture;
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_3 = {};
  this.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_3.value = this.targetHKRenderer3.getCurrentRenderTarget(this.targetHKVar3).texture;

  this.butterflyTextureVars[0].material.uniforms.direction.value = 0;
  this.butterflyTextureVars[0].material.uniforms.stageFraction.value = 0.0;
  this.butterflyTextureVars[0].material.uniforms.twiddleTexture.value = twiddleTexture;
  for(let i = 1; i < numPingPongIterations; i++){
    let butterflyTextureInit = this.butterflyRenderer.createTexture();
    this.butterflyTextureVars.push(this.butterflyRenderer.addVariable(`pingpong_${i}`, butterflyTextureData.fragmentShader(i - 1), butterflyTextureInit));
    this.butterflyRenderer.setVariableDependencies(this.butterflyTextureVars[i], [this.butterflyTextureVars[i - 1]]);
    this.butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
    this.butterflyTextureVars[i].material.uniforms.direction.value = 0;
    this.butterflyTextureVars[i].material.uniforms.stageFraction.value = i / (numPingPongIterations - 1.0);
    this.butterflyTextureVars[i].material.uniforms.twiddleTexture.value = twiddleTexture;
  }
  let numPingPongIterationsTimes2 = numPingPongIterations * 2;
  for(let i = numPingPongIterations; i < numPingPongIterationsTimes2; i++){
    let butterflyTextureInit = this.butterflyRenderer.createTexture();
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
  let waveHeightTextureInit = this.waveHeightRenderer.createTexture(textureWidth, textureHeight, true, true, THREE.LinearMipMapLinearFilter, THREE.LinearMipMapLinearFilter);
  this.waveHeightTextureVar = this.waveHeightRenderer.addVariable('textureWaveHeight', waveHeightShaderMaterialData.fragmentShader, waveHeightTextureInit);
  this.waveHeightRenderer.setVariableDependencies(this.waveHeightTextureVar, []);//Note: We use manual texture dependency injection here.
  this.waveHeightTextureVar.material.uniforms = JSON.parse(JSON.stringify(waveHeightShaderMaterialData.uniforms));
  this.waveHeightTextureVar.material.uniforms.butterflyTexture.value = this.butterflyRenderer.getCurrentRenderTarget(this.finalButterflyTextureVar).texture;
  this.waveHeightTextureVar.material.uniforms.N.value = this.N;

  let error5 = this.waveHeightRenderer.init();
  if(error5 !== null){
    console.error(`Wave Height Renderer: ${error5}`);
  }
  this.waveHeightRenderer.compute();

  //Initialize our wave height shader
  let waveNormalMapTextureInit = this.waveNormalMapRenderer.createTexture(textureWidth, textureHeight, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearMipMapLinearFilter, THREE.LinearMipMapLinearFilter);
  this.waveNormalMapTextureVar = this.waveNormalMapRenderer.addVariable('textureWaveNormalMap', waveNormalMapMaterialData.fragmentShader, waveNormalMapTextureInit);
  this.waveNormalMapRenderer.setVariableDependencies(this.waveNormalMapTextureVar, []);//Note: We use manual texture dependency injection here.
  this.waveNormalMapTextureVar.material.uniforms = JSON.parse(JSON.stringify(waveNormalMapMaterialData.uniforms));
  this.waveNormalMapTextureVar.material.uniforms.waveHeightTexture.value = this.waveHeightRenderer.getCurrentRenderTarget(this.waveHeightTextureVar).texture;

  let error6 = this.waveNormalMapRenderer.init();
  if(error6 !== null){
    console.error(`Wave Normal Map Renderer: ${error6}`);
  }

  //To be removed when we eventually combine multiples of these
  this.heightmapTexture;

  //This that is used in internal functions
  let self = this;

  this.tick = function(time){
    //Update our ping-pong butterfly texture
    self.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_0.value = self.targetHKRenderer0.getCurrentRenderTarget(self.targetHKVar0).texture;
    self.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_1.value = self.targetHKRenderer1.getCurrentRenderTarget(self.targetHKVar1).texture;
    self.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_2.value = self.targetHKRenderer2.getCurrentRenderTarget(self.targetHKVar2).texture;
    self.butterflyTextureVars[0].material.uniforms.pingpong_hk_texture_3.value = self.targetHKRenderer3.getCurrentRenderTarget(self.targetHKVar3).texture;
    self.butterflyRenderer.compute();

    self.waveHeightTextureVar.material.uniforms.butterflyTexture.value = self.butterflyRenderer.getCurrentRenderTarget(self.finalButterflyTextureVar).texture;
    self.waveHeightRenderer.compute();

    let waveHeightTexture = self.waveHeightRenderer.getCurrentRenderTarget(self.waveHeightTextureVar).texture;

    self.waveNormalMapTextureVar.material.uniforms.waveHeightTexture.value = waveHeightTexture;
    self.waveNormalMapRenderer.compute();

    return {
      waveHeight: waveHeightTexture,
      waveNormal: self.waveNormalMapRenderer.getCurrentRenderTarget(self.waveNormalMapTextureVar).texture
    };
  }
}
