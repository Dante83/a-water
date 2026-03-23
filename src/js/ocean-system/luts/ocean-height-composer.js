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
  this.waveHeightComposerVar.format = THREE.RGBAFormat;
  this.waveHeightComposerVar.type = THREE.FloatType;
  this.waveHeightComposerVar.anisotropy = 4;
  this.waveHeightComposerVar.samples = 8;
  this.waveHeightComposerVar.wrapS = THREE.RepeatWrapping;
  this.waveHeightComposerVar.wrapT = THREE.RepeatWrapping;
  this.waveHeightComposerVar.generateMipmaps = true;
  this.waveHeightComposerVar.needsUpdate = true;
  this.waveHeightComposerRenderer.setVariableDependencies(whcVar, []);//Note: We use manual texture dependency injection here.
  whcVar.material.uniforms = materials.waveComposerShaderMaterial.uniforms(this.numberOfWaveComponents);

  //Set our uniforms
  whcVar.material.uniforms.N.value = this.N;

  let error5 = this.waveHeightComposerRenderer.init();
  if(error5 !== null){
    console.error(`Wave Height Composer Renderer: ${error5}`);
  }
  this.waveHeightComposerRenderer.compute();

  //Initialize the normal map composer - computes normals from displacement via central differences
  this.waveNormalComposerRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
  this.waveNormalComposerTexture = this.waveNormalComposerRenderer.createTexture();
  this.waveNormalComposerVar = this.waveNormalComposerRenderer.addVariable(
    'waveNormalTexture',
    materials.waveNormalComposerShaderMaterial.fragmentShader(),
    this.waveNormalComposerTexture
  );
  let wncVar = this.waveNormalComposerVar;
  wncVar.minFilter = THREE.LinearFilter;
  wncVar.magFilter = THREE.LinearFilter;
  wncVar.format = THREE.RGBAFormat;
  wncVar.type = THREE.FloatType;
  wncVar.wrapS = THREE.RepeatWrapping;
  wncVar.wrapT = THREE.RepeatWrapping;
  wncVar.needsUpdate = true;
  this.waveNormalComposerRenderer.setVariableDependencies(wncVar, []);
  wncVar.material.uniforms = {
    displacementTexture: {type: 't', value: null},
    texelSize: {type: 'f', value: 1.0 / this.baseTextureWidth},
    patchSize: {type: 'f', value: parentOceanGrid.patchSize}
  };

  let error6 = this.waveNormalComposerRenderer.init();
  if(error6 !== null){
    console.error(`Wave Normal Composer Renderer: ${error6}`);
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

    //Compute normals from the displacement map
    self.waveNormalComposerVar.material.uniforms.displacementTexture.value = this.displacementMap;
    self.waveNormalComposerRenderer.compute();
    this.normalMap = self.waveNormalComposerRenderer.getCurrentRenderTarget(self.waveNormalComposerVar).texture;
  };
}
