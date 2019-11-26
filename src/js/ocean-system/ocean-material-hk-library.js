function OceanMaterialHkLibrary(data, renderer){
  const minHeight = 25.0;
  const maxHeight = 1.0;
  this.numVariations = 16;

  //We have 16 wave heights that we fade between
  this.staticGPUComputers = [];
  this.hkRenderers = [];
  this.h0Textures = [];
  this.hkTextures = [];
  this.hkTextureVars = [];
  this.activeTextures = [];
  const textureWidth = data.patch_data_size;
  const textureHeight = data.patch_data_size;
  this.N = data.number_of_octaves; //N is The number of octaves that are used for the FFT
  this.L = data.patch_size; //L is the horizontal dimension of the patch
  let windVelocity = new THREE.Vector2(data.wind_velocity.x, data.wind_velocity.y);
  this.L_ = windVelocity.dot(windVelocity) / 9.80665; //(Wind speed squared divided by gravity)
  this.w = windVelocity.clone().normalize(); //w is the wind direction
  this.renderer = renderer;
  document.body.appendChild(renderer.domElement);

  for(let i = 0; i < this.numVariations; ++i){
    //From https://planetcalc.com/4442/
    let heightFactor = Math.min(Math.max(minHeight + (maxHeight - minHeight) * (i / this.numVariations), minHeight), maxHeight);
    let maxWaveAmplitutude = 0.54 * this.L_ * heightFactor; //Amplitude is twice the height

    this.staticGPUComputers.push(new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer));
    this.hkRenderers.push(new THREE.GPUComputationRenderer(textureWidth, textureHeight, this.renderer));
    let hkRenderer = this.hkRenderers[i];

    //Create 4 different textures for each of our noise LUTs.
    let offset = textureWidth * textureHeight;
    let staticGPUCompute = this.staticGPUComputers[i];
    let noiseInit1 = staticGPUCompute.createTexture();
    let noise1Var = staticGPUCompute.addVariable('textureNoise1', noiseShaderMaterialData.fragmentShader, noiseInit1);
    staticGPUCompute.setVariableDependencies(noise1Var, []);
    noise1Var.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
    noise1Var.material.uniforms.offset.value = 1.0;
    let noiseInit2 = staticGPUCompute.createTexture();
    let noise2Var = staticGPUCompute.addVariable('textureNoise2', noiseShaderMaterialData.fragmentShader, noiseInit2);
    staticGPUCompute.setVariableDependencies(noise2Var, []);
    noise2Var.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
    noise2Var.material.uniforms.offset.value = noise1Var.material.uniforms.offset.value + textureWidth * textureHeight;
    let noiseInit3 = staticGPUCompute.createTexture();
    let noise3Var = staticGPUCompute.addVariable('textureNoise3', noiseShaderMaterialData.fragmentShader, noiseInit3);
    staticGPUCompute.setVariableDependencies(noise3Var, []);
    noise3Var.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
    noise3Var.material.uniforms.offset.value = noise2Var.material.uniforms.offset.value + textureWidth * textureHeight;
    let noiseInit4 = staticGPUCompute.createTexture();
    let noise4Var = staticGPUCompute.addVariable('textureNoise4', noiseShaderMaterialData.fragmentShader, noiseInit4);
    staticGPUCompute.setVariableDependencies(noise4Var, []);
    noise4Var.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
    noise4Var.material.uniforms.offset.value = noise3Var.material.uniforms.offset.value + textureWidth * textureHeight;

    //Produce the textures for our h0 shader
    let h0TextureInit = staticGPUCompute.createTexture();
    let h0TextureVar = staticGPUCompute.addVariable('textureH0', h0ShaderMaterialData.fragmentShader, h0TextureInit);
    this.h0Textures.push(h0TextureVar);
    staticGPUCompute.setVariableDependencies(h0TextureVar, [noise1Var, noise2Var, noise3Var, noise4Var]);
    h0TextureVar.material.uniforms = {
      ...h0TextureVar.material.uniforms,
      ...JSON.parse(JSON.stringify(h0ShaderMaterialData.uniforms))
    }
    h0TextureVar.material.uniforms.N.value = this.N;
    h0TextureVar.material.uniforms.L.value = this.L;
    h0TextureVar.material.uniforms.A.value = maxWaveAmplitutude;
    h0TextureVar.material.uniforms.L_.value = this.L_;
    h0TextureVar.material.uniforms.w.value = new THREE.Vector2(1.0, 0.0);

    //Now compute our h_0 texture for future use
    let error1 = staticGPUCompute.init();
    if(error1 !== null){
      console.error(`Static GPU Compute Renderer: ${error1}`);
    }
    staticGPUCompute.compute();
    staticGPUCompute.compute(); //Must be run twice to fill up second ping pong shader? Weird.

    //Initialize our h_k shader
    let hkTextureInit = hkRenderer.createTexture();
    this.hkTextureVars.push(hkRenderer.addVariable('textureHk', hkShaderMaterialData.fragmentShader, hkTextureInit));
    let hkTextureVar = this.hkTextureVars[i];
    hkRenderer.setVariableDependencies(hkTextureVar, []);//Note: We use manual texture dependency injection here.
    hkTextureVar.material.uniforms = JSON.parse(JSON.stringify(hkShaderMaterialData.uniforms));
    hkTextureVar.material.uniforms.textureH0.value = this.staticGPUComputers[i].getCurrentRenderTarget(h0TextureVar).texture;
    hkTextureVar.material.uniforms.L.value = 1000.0;
    hkTextureVar.material.uniforms.uTime.value = 500.0;
    hkTextureVar.material.uniforms.N.value = this.N;

    let error3 = hkRenderer.init();
    if(error3 !== null){
      console.error(`Dynamic GPU Compute Renderer: ${error3}`);
    }
    hkRenderer.compute();
  }

  self = this;
  this.tick = function(time, activeTextures){
    for(let i = 0; i < self.numVariations; ++i){
      if(self.activeTextures[i]){
        //Update the time variable of our phillipse spectrum and update hk
        self.hkRenderers[i].material.uniforms.uTime.value = time / 1000.0;
        self.hkRenderers[i].compute();
        self.hkTextures[i] = self.hkRenderers[i].getCurrentRenderTarget(self.hkTextureVars[i]).texture;
      }
    }
  };

  this.resetActiveTextures = function(){
    for(i = 0; i < self.numVariations; ++i){
      self.activeTextures[i] = false;
    }
  };

  this.waterDepthToIndex = function(waterDepth){
    let i = Math.max(Math.min(Math.round((waterDepth - minHeight) * (this.numVariations / (maxHeight - minHeight))), this.numVariations), 0);
    self.activeTextures[i] = true;
    return i;
  };
}
