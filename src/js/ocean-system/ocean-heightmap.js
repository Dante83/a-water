function OceanHeightmap(data, renderer, oceanMaterialHkLibrary, cornerHeights, cornerDissipationVectors){
  const textureWidth = data.patch_data_size;
  const textureHeight = data.patch_data_size;
  this.N = data.number_of_octaves;
  this.renderer = renderer;
  this.oceanMaterialHkLibrary = oceanMaterialHkLibrary;
  this.cornerHeights = cornerHeights;
  this.cornerDissipationVectors = cornerDissipationVectors;
  this.hkLibraryIds = [false, false, false, false];
  document.body.appendChild(renderer.domElement);

  //Initialize our GPU Compute Renderers
  this.butterflyRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer);
  this.waveHeightRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer);
  this.waveNormalMapRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer);

  //Set up our butterfly height generator
  this.butterflyTextureVars = [];
  let numPingPongIterations = Math.ceil(Math.log(this.N) / Math.log(2));
  let butterFlyTexture = this.butterflyRenderer.createTexture();
  this.butterflyTextureVars.push(this.butterflyRenderer.addVariable(`pingpong_0`, butterflyTextureDataInitializer.fragmentShader(), butterFlyTexture));
  this.butterflyRenderer.setVariableDependencies(this.butterflyTextureVars[0], []);
  this.butterflyTextureVars[0].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureDataInitializer.uniforms));

  //We now use four hk textures for each of the corners to initialize our first butterfly texture
  let i0 = oceanMaterialHkLibrary.waterDepthToIndex(cornerHeights[0]);
  this.hkLibraryIds[0] = i0;
  let i1 = oceanMaterialHkLibrary.waterDepthToIndex(cornerHeights[1]);
  this.hkLibraryIds[1] = i1;
  let i2 = oceanMaterialHkLibrary.waterDepthToIndex(cornerHeights[2]);
  this.hkLibraryIds[2] = i2;
  let i3 = oceanMaterialHkLibrary.waterDepthToIndex(cornerHeights[3]);
  this.hkLibraryIds[3] = i3;
  this.butterflyTextureVars[0].material.uniforms.hkTexture_0 = {};
  this.butterflyTextureVars[0].material.uniforms.hkTexture_0.value = this.oceanMaterialHkLibrary.hkTextureOuts[i0];
  this.butterflyTextureVars[0].material.uniforms.hkTexture_1 = {};
  this.butterflyTextureVars[0].material.uniforms.hkTexture_1.value = this.oceanMaterialHkLibrary.hkTextureOuts[i1];
  this.butterflyTextureVars[0].material.uniforms.hkTexture_2 = {};
  this.butterflyTextureVars[0].material.uniforms.hkTexture_2.value = this.oceanMaterialHkLibrary.hkTextureOuts[i2];
  this.butterflyTextureVars[0].material.uniforms.hkTexture_3 = {};
  this.butterflyTextureVars[0].material.uniforms.hkTexture_3.value = this.oceanMaterialHkLibrary.hkTextureOuts[i3];
  this.butterflyTextureVars[0].material.uniforms.direction.value = 0;
  this.butterflyTextureVars[0].material.uniforms.stageFraction.value = 0.0;
  this.butterflyTextureVars[0].material.uniforms.twiddleTexture.value = this.oceanMaterialHkLibrary.twiddleTexture;

  //Now we can perform the remaining butterfly operations using the above texture
  for(let i = 1; i < numPingPongIterations; i++){
    let butterFlyTexture = this.butterflyRenderer.createTexture();
    this.butterflyTextureVars.push(this.butterflyRenderer.addVariable(`pingpong_${i}`, butterflyTextureData.fragmentShader(i - 1), butterFlyTexture));
    this.butterflyRenderer.setVariableDependencies(this.butterflyTextureVars[i], [this.butterflyTextureVars[i - 1]]);
    this.butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
    this.butterflyTextureVars[i].material.uniforms.direction.value = 0;
    this.butterflyTextureVars[i].material.uniforms.stageFraction.value = i / (numPingPongIterations - 1.0);
    this.butterflyTextureVars[i].material.uniforms.twiddleTexture.value = this.oceanMaterialHkLibrary.twiddleTexture;
  }
  let numPingPongIterationsTimes2 = numPingPongIterations * 2;
  for(let i = numPingPongIterations; i < numPingPongIterationsTimes2; i++){
    let butterFlyTexture = this.butterflyRenderer.createTexture();
    this.butterflyTextureVars.push(this.butterflyRenderer.addVariable(`pingpong_${i}`, butterflyTextureData.fragmentShader(i - 1), butterFlyTexture));
    this.butterflyRenderer.setVariableDependencies(this.butterflyTextureVars[i], [this.butterflyTextureVars[i - 1]]);
    this.butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
    this.butterflyTextureVars[i].material.uniforms.direction.value = 1;
    this.butterflyTextureVars[i].material.uniforms.stageFraction.value = (i - numPingPongIterations) / (numPingPongIterations - 1.0);
    this.butterflyTextureVars[i].material.uniforms.twiddleTexture.value = this.oceanMaterialHkLibrary.twiddleTexture;
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

  //This that is used in internal functions
  let self = this;
  this.tick = function(time){
    //Update our ping-pong butterfly texture
    self.butterflyTextureVars[0].material.uniforms.hkTexture_0.value = self.oceanMaterialHkLibrary.hkTextureOuts[self.hkLibraryIds[0]];
    self.butterflyTextureVars[0].material.uniforms.hkTexture_1.value = self.oceanMaterialHkLibrary.hkTextureOuts[self.hkLibraryIds[1]];
    self.butterflyTextureVars[0].material.uniforms.hkTexture_2.value = self.oceanMaterialHkLibrary.hkTextureOuts[self.hkLibraryIds[2]];
    self.butterflyTextureVars[0].material.uniforms.hkTexture_3.value = self.oceanMaterialHkLibrary.hkTextureOuts[self.hkLibraryIds[3]];
    self.butterflyRenderer.compute();

    self.waveHeightTextureVar.material.uniforms.butterflyTexture.value = self.butterflyRenderer.getCurrentRenderTarget(self.finalButterflyTextureVar).texture;
    self.waveHeightRenderer.compute();

    let waveHeightTexture = self.waveHeightRenderer.getCurrentRenderTarget(self.waveHeightTextureVar).texture;

    self.waveNormalMapTextureVar.material.uniforms.waveHeightTexture.value = waveHeightTexture;
    self.waveNormalMapRenderer.compute();

    return {
      heightMap: waveHeightTexture,
      normalMap: self.waveNormalMapRenderer.getCurrentRenderTarget(self.waveNormalMapTextureVar).texture
    };
  }
}
