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
  this.normalMap;
  this.foamMap;

  //Make a shortcut to our materials namespace
  const materials = AWater.AOcean.Materials.FFTWaves;

  //Initialize our wave height composer renderer
  this.waveHeightComposerRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
  this.waveNormalMapRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
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

  //Also set up up our normal map renderer
  let waveNormalMapTextureInit = this.waveNormalMapRenderer.createTexture(this.outputTextureWidth, this.outputTextureHeight, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearFilter, THREE.LinearFilter);
  this.waveNormalMapTextureVar = this.waveNormalMapRenderer.addVariable('textureWaveNormalMap', materials.waveNormalMapMaterialData.fragmentShader, waveNormalMapTextureInit);
  this.waveNormalMapRenderer.setVariableDependencies(this.waveNormalMapTextureVar, []);//Note: We use manual texture dependency injection here.
  this.waveNormalMapTextureVar.material.uniforms = JSON.parse(JSON.stringify(materials.waveNormalMapMaterialData.uniforms));
  let displacementMap = this.waveHeightComposerRenderer.getCurrentRenderTarget(whcVar).texture;
  this.waveNormalMapTextureVar.material.uniforms.waveHeightTexture.value = displacementMap;
  this.waveNormalMapTextureVar.material.uniforms.halfWidthOfPatchOverWaveScaleFactor.value = (0.5 * data.patch_size) / data.wave_scale_multiple;
  this.waveNormalMapTextureVar.minFilter = THREE.LinearFilter;
  this.waveNormalMapTextureVar.magFilter = THREE.LinearFilter;
  this.waveNormalMapTextureVar.wrapS = THREE.RepeatWrapping;
  this.waveNormalMapTextureVar.wrapT = THREE.RepeatWrapping;

  let error6 = this.waveNormalMapRenderer.init();
  if(error6 !== null){
    console.error(`Wave Normal Map Renderer: ${error6}`);
  }

  let oceanFoamTextureInit = this.waveFoamRenderer.createTexture(this.outputTextureWidth, this.outputTextureHeight, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearFilter, THREE.LinearFilter);
  this.waveFoamTextureVar = this.waveFoamRenderer.addVariable('textureWaveFoam', materials.foamPass.fragmentShader, oceanFoamTextureInit);
  this.waveFoamRenderer.setVariableDependencies(this.waveFoamTextureVar, []);//Note: We use manual texture dependency injection here.
  this.waveFoamTextureVar.material.uniforms = JSON.parse(JSON.stringify(materials.foamPass.uniforms));
  this.waveFoamTextureVar.material.uniforms.displacementMap.value = displacementMap;
  this.waveFoamTextureVar.minFilter = THREE.LinearFilter;
  this.waveFoamTextureVar.magFilter = THREE.LinearFilter;
  this.waveFoamTextureVar.wrapS = THREE.RepeatWrapping;
  this.waveFoamTextureVar.wrapT = THREE.RepeatWrapping;

  let error7 = this.waveFoamRenderer.init();
  if(error7 !== null){
    console.error(`Wave Foam Map Renderer: ${error7}`);
  }

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

    //Use this to produce our normal map
    self.waveNormalMapTextureVar.material.uniforms.waveHeightTexture.value = this.displacementMap;
    self.waveNormalMapRenderer.compute();
    this.normalMap = self.waveNormalMapRenderer.getCurrentRenderTarget(self.waveNormalMapTextureVar).texture;

    //Also use this to update the foam map
    self.waveFoamTextureVar.material.uniforms.displacementMap.value = this.displacementMap;
    self.waveFoamRenderer.compute();
    this.foamMap = self.waveFoamRenderer.getCurrentRenderTarget(self.waveNormalMapTextureVar).texture;
  };
}
