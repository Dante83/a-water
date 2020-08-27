AWater.AOcean.LUTlibraries.OceanHeightComposer = function(parentOceanGrid, patchHeights){
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

  //Make a shortcut to our materials namespace
  const materials = AWater.AOcean.Materials.FFTWaves;

  //Initialize our wave height composer renderer
  this.waveHeightComposerRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
  this.waveNormalMapRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
  this.waveHeightComposerTexture = this.waveHeightComposerRenderer.createTexture();
  this.waveHeightComposerVar = this.waveHeightComposerRenderer.addVariable('waveHeightTexture', materials.waveComposerShaderMaterial.fragmentShader(this.numberOfWaveComponents), this.waveHeightComposerTexture);
  let whcVar = this.waveHeightComposerVar;
  this.waveHeightComposerVar.material.minFilter = THREE.LinearFilter;
  this.waveHeightComposerVar.material.magFilter = THREE.LinearFilter;
  this.waveHeightComposerVar.material.wrapS = THREE.RepeatWrapping;
  this.waveHeightComposerVar.material.wrapT = THREE.RepeatWrapping;
  this.waveHeightComposerRenderer.setVariableDependencies(whcVar, []);//Note: We use manual texture dependency injection here.
  whcVar.material.uniforms = materials.waveComposerShaderMaterial.uniforms(this.numberOfWaveComponents);

  //Set our uniforms
  for(let i = 0; i < this.numberOfWaveComponents; ++i){
    whcVar.material.uniforms.wavetextures.value[i] = this.OceanMaterialHeightBandLibrary.wavesFilteredByAmplitude[i];
    whcVar.material.uniforms.beginFadingHeight.value[i] = parentOceanGrid.beginsFadingOutAtHeight[i];
    whcVar.material.uniforms.vanishingHeight.value[i] = 0.0;
  }
  for(let i = 0; i < 4; ++i){
    whcVar.material.uniforms.cornerDepth.value[i] = patchHeights[i];
  }
  whcVar.material.uniforms.N.value = this.N;

  let error5 = this.waveHeightComposerRenderer.init();
  if(error5 !== null){
    console.error(`Wave Height Composer Renderer: ${error5}`);
  }
  this.waveHeightComposerRenderer.compute();

  //Also set up up our normal map renderer
  let waveNormalMapTextureInit = this.waveNormalMapRenderer.createTexture(this.outputTextureWidth, this.outputTextureHeight, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearMipMapLinearFilter, THREE.LinearMipMapLinearFilter);
  this.waveNormalMapTextureVar = this.waveNormalMapRenderer.addVariable('textureWaveNormalMap', materials.waveNormalMapMaterialData.fragmentShader, waveNormalMapTextureInit);
  this.waveNormalMapRenderer.setVariableDependencies(this.waveNormalMapTextureVar, []);//Note: We use manual texture dependency injection here.
  this.waveNormalMapTextureVar.material.uniforms = JSON.parse(JSON.stringify(materials.waveNormalMapMaterialData.uniforms));
  this.waveNormalMapTextureVar.material.uniforms.waveHeightTexture.value = this.waveHeightComposerRenderer.getCurrentRenderTarget(whcVar).texture;
  this.waveNormalMapTextureVar.material.minFilter = THREE.LinearFilter;
  this.waveNormalMapTextureVar.material.magFilter = THREE.LinearFilter;
  this.waveNormalMapTextureVar.material.wrapS = THREE.RepeatWrapping;
  this.waveNormalMapTextureVar.material.wrapT = THREE.RepeatWrapping;

  let error6 = this.waveNormalMapRenderer.init();
  if(error6 !== null){
    console.error(`Wave Normal Map Renderer: ${error6}`);
  }

  let self = this;
  this.tick = function(){
    //Update our uniforms
    for(let i = 0; i < this.numberOfWaveComponents; ++i){
      self.waveHeightComposerVar.material.uniforms.wavetextures.value[i] = this.OceanMaterialHeightBandLibrary.wavesFilteredByAmplitude[i];
    }
    self.waveHeightComposerRenderer.compute();
    let waveHeightTexture = self.waveHeightComposerRenderer.getCurrentRenderTarget(self.waveHeightComposerVar).texture;

    //Use this to produce our normal map
    self.waveNormalMapTextureVar.material.uniforms.waveHeightTexture.value = waveHeightTexture;
    self.waveNormalMapRenderer.compute();

    return {
      heightMap: waveHeightTexture,
      normalMap: self.waveNormalMapRenderer.getCurrentRenderTarget(self.waveNormalMapTextureVar).texture
    };
  };
}
