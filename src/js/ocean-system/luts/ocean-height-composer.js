AWater.AOcean.LUTlibraries.OceanHeightComposer = function(parentOceanGrid){
  let data = parentOceanGrid.data;
  this.renderer = parentOceanGrid.renderer;
  this.baseTextureWidth = data.patch_data_size;
  this.baseTextureHeight = data.patch_data_size;
  this.outputTextureWidth = this.baseTextureWidth;
  this.outputTextureHeight = this.baseTextureHeight;
  this.N = data.number_of_octaves;
  this.OceanMaterialHeightBandLibrary = parentOceanGrid.oceanHeightBandLibrary;
  this.numberOfWaveComponents = parentOceanGrid.numberOfOceanHeightBands;
  this.parentOceanGrid = parentOceanGrid;
  this.combinedWaveHeights;
  this.displacementMap;

  //Make a shortcut to our materials namespace
  const materials = AWater.AOcean.Materials.FFTWaves;

  //Initialize our wave height composer renderer
  this.waveHeightComposerRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
  this.waveFoamRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
  this.waveHeightComposerTexture = this.waveHeightComposerRenderer.createTexture();
  this.waveHeightComposerVar = this.waveHeightComposerRenderer.addVariable('waveHeightTexture', materials.waveComposerShaderMaterial.fragmentShader(this.numberOfWaveComponents), this.waveHeightComposerTexture);
  let whcVar = this.waveHeightComposerVar;
  this.waveHeightComposerVar.material.uniforms.waveHeightMultiplier = data.wave_scale_multiple;
  this.waveHeightComposerVar.minFilter = THREE.LinearFilter;
  this.waveHeightComposerVar.magFilter = THREE.LinearFilter;
  this.waveHeightComposerVar.wrapS = THREE.RepeatWrapping;
  this.waveHeightComposerVar.wrapT = THREE.RepeatWrapping;
  this.waveHeightComposerRenderer.setVariableDependencies(whcVar, []);//Note: We use manual texture dependency injection here.
  whcVar.material.uniforms = materials.waveComposerShaderMaterial.uniforms(this.numberOfWaveComponents);

  //Set our uniforms
  whcVar.material.uniforms.N.value = this.N;

  let error5 = this.waveHeightComposerRenderer.init();
  if(error5 !== null){
    console.error(`Wave Height Composer Renderer: ${error5}`);
  }
  this.waveHeightComposerRenderer.compute();

  let self = this;
  this.tick = function(){
    //Update our uniforms
    for(let i = 0; i < this.numberOfWaveComponents; ++i){
      self.waveHeightComposerVar.material.uniforms.xWavetextures.value[i] = this.OceanMaterialHeightBandLibrary.wavesXFilteredByAmplitude[i];
      self.waveHeightComposerVar.material.uniforms.yWavetextures.value[i] = this.OceanMaterialHeightBandLibrary.wavesYFilteredByAmplitude[i];
      self.waveHeightComposerVar.material.uniforms.zWavetextures.value[i] = this.OceanMaterialHeightBandLibrary.wavesZFilteredByAmplitude[i];
    }
    self.waveHeightComposerRenderer.compute();
    this.displacementMap = self.waveHeightComposerRenderer.getCurrentRenderTarget(self.waveHeightComposerVar).texture;
  };
}
