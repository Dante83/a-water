function OceanHeightComposer(data, renderer, OceanMaterialHeightBandLibrary, patchHeights){
  this.baseTextureWidth = data.patch_data_size;
  this.baseTextureHeight = data.patch_data_size;
  this.outputTextureWidth = this.baseTextureWidth;
  this.outputTextureHeight = this.baseTextureHeight;
  this.N = data.number_of_octaves;
  this.OceanMaterialHeightBandLibrary = OceanMaterialHeightBandLibrary;
  this.numberOfWaveComponents = OceanMaterialHeightBandLibrary;
  this.combinedWaveHeights;

  //Initialize our wave height composer renderer
  this.waveHeightComposerRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
  this.waveHeightWrapperRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
  this.waveHeightComposerTexture = this.waveHeightComposerRenderer.createTexture();
  this.waveHeightComposerVar = this.waveHeightComposerRenderer.addVariable('waveHeightTexture', waveComposerShaderMaterial.fragmentShader(this.numberOfWaveComponents), this.waveHeightComposerTexture);
  console.log(this.waveHeightComposerVar);
  debugger;
  let whcVar = this.waveHeightComposerVar;
  hkRenderer.setVariableDependencies(whcVar, []);//Note: We use manual texture dependency injection here.
  whcVar.material.uniforms = hkShaderMaterialData.uniforms(this.numberOfWaveComponents);

  //Set our uniforms
  for(let i = 0; i < this.numberOfWaveComponents; ++i){
    whcVar.material.uniforms.textureH0.value[i] = this.OceanMaterialHeightBandLibrary.wavesFilteredByAmplitude[i];
    whcVar.material.uniforms.textureH0.value[i] = this.OceanMaterialHeightBandLibrary.wavesFilteredByAmplitude[i];
    whcVar.material.uniforms.textureH0.value[i] = this.OceanMaterialHeightBandLibrary.wavesFilteredByAmplitude[i];
  }

  //Implement our variables and attributes after we update what the vertex shader is

  this.combinedWaveHeights = this.waveHeightComposerRenderer.getCurrentRenderTarget(this.waveHeightComposerVar).texture;

  //TODO: Massively increase the scale of our texture to a size that allows for smoothing details
  //while making the texture tileable.
  let waveHeightTextureInit = this.waveHeightWrapperRenderer.createTexture(this.outputTextureWidth, this.outputTextureHeight, true, true, THREE.LinearMipMapLinearFilter, THREE.LinearMipMapLinearFilter);
  this.waveheightVar = waveHeightRenderer.addVariable('textureWaveHeight', waveHeightShaderMaterialData.fragmentShader, waveHeightTextureInit);
  this.waveHeightWrapperRenderer.setVariableDependencies(this.waveheightVar, []);//Note: We use manual texture dependency injection here.
  this.waveheightVar.material.uniforms = JSON.parse(JSON.stringify(waveHeightShaderMaterialData.uniforms));
  this.waveheightVar.material.uniforms.combinedWaveHeights.value = this.combinedWaveHeights;
  this.waveheightVar.material.uniforms.N.value = this.N;

  let error5 = this.waveHeightWrapperRenderer.init();
  if(error5 !== null){
    console.error(`Wave Height Renderer: ${error5}`);
  }
  this.waveHeightWrapperRenderer.compute();

  //Also set up up our normal map renderer
  let waveNormalMapTextureInit = this.waveNormalMapRenderer.createTexture(textureWidth, textureHeight, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearMipMapLinearFilter, THREE.LinearMipMapLinearFilter);
  this.waveNormalMapTextureVar = this.waveNormalMapRenderer.addVariable('textureWaveNormalMap', waveNormalMapMaterialData.fragmentShader, waveNormalMapTextureInit);
  this.waveNormalMapRenderer.setVariableDependencies(this.waveNormalMapTextureVar, []);//Note: We use manual texture dependency injection here.
  this.waveNormalMapTextureVar.material.uniforms = JSON.parse(JSON.stringify(waveNormalMapMaterialData.uniforms));
  this.waveNormalMapTextureVar.material.uniforms.waveHeightTexture.value = this.waveHeightWrapperRenderer.getCurrentRenderTarget(this.waveheightVar).texture;

  let error6 = this.waveNormalMapRenderer.init();
  if(error6 !== null){
    console.error(`Wave Normal Map Renderer: ${error6}`);
  }

  self = this;
  this.tick(){
    //Update our uniforms
    for(let i = 0; i < this.numberOfWaveComponents; ++i){
      whcVar.material.uniforms.textureH0.value[i] = this.OceanMaterialHeightBandLibrary.wavesFilteredByAmplitude[i];
      whcVar.material.uniforms.textureH0.value[i] = this.OceanMaterialHeightBandLibrary.wavesFilteredByAmplitude[i];
      whcVar.material.uniforms.textureH0.value[i] = this.OceanMaterialHeightBandLibrary.wavesFilteredByAmplitude[i];
    }
    self.waveHeightRenderer.compute();

    //Create our wrapped texture
    this.waveheightVar.material.uniforms.combinedWaveHeights.value = self.waveHeightComposerRenderer.getCurrentRenderTarget(self.waveHeightComposerVar).texture;
    this.waveHeightWrapperRenderer.compute();
    let waveHeightTexture = self.waveHeightWrapperRenderer.getCurrentRenderTarget(this.waveheightVar).texture;

    //Use this to produce our normal map
    self.waveNormalMapTextureVar.material.uniforms.waveHeightTexture.value = waveHeightTexture;
    self.waveNormalMapRenderer.compute();

    return {
      heightMap: waveHeightTexture,
      normalMap: self.waveNormalMapRenderer.getCurrentRenderTarget(self.waveNormalMapTextureVar).texture
    };
  }
}
