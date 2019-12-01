function OceanMaterialHkLibrary(data, renderer){
  const minHeight = 25.0;
  const maxHeight = 1.0;
  this.numVariations = 16;

  //We have 16 wave heights that we fade between
  this.staticGPUComputers = [];
  this.hkRenderers = [];
  this.noiseVar1 = [];
  this.noiseVar2 = [];
  this.noiseVar3 = [];
  this.noiseVar4 = [];
  this.noiseTexture1 = [];
  this.noiseTexture2 = [];
  this.noiseTexture3 = [];
  this.noiseTexture4 = [];
  this.h0Vars = [];
  this.h0Textures = [];
  this.hkVars = [];
  this.hkTextures = [];
  this.hkTextureOuts = {};
  this.activeTextures = [];
  for(let i = 0; i < this.numVariations; ++i){
    this.activeTextures.push(false);
  }
  this.textureWidth = data.patch_data_size;
  this.textureHeight = data.patch_data_size;
  this.N = data.number_of_octaves; //N is The number of octaves that are used for the FFT
  this.L = data.patch_size * 64; //L is the horizontal dimension of the patch
  let windVelocity = new THREE.Vector2(data.wind_velocity.x, data.wind_velocity.y);
  this.L_ = windVelocity.dot(windVelocity) / 9.80665; //(Wind speed squared divided by gravity)
  this.w = windVelocity.clone().normalize(); //w is the wind direction
  this.renderer = renderer;
  document.body.appendChild(renderer.domElement);

  //Now compute our twiddle data for injection
  this.twiddleTexture = computeTwiddleIndices(this.N, renderer);

  for(let i = 0; i < this.numVariations; ++i){
    //From https://planetcalc.com/4442/
    let heightFactor = Math.min(Math.max(minHeight + (maxHeight - minHeight) * (i / this.numVariations), minHeight), maxHeight);
    let maxWaveAmplitutude = 0.54 * this.L_ * heightFactor; //Amplitude is twice the height

    this.staticGPUComputers.push(new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer));
    this.hkRenderers.push(new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer));
    let hkRenderer = this.hkRenderers[i];

    //Create 4 different textures for each of our noise LUTs.
    let offset = this.textureWidth * this.textureHeight;
    let staticGPUCompute = this.staticGPUComputers[i];
    this.noiseTexture1.push(staticGPUCompute.createTexture());
    this.noiseVar1.push(staticGPUCompute.addVariable('textureNoise1', noiseShaderMaterialData.fragmentShader, this.noiseTexture1[i]));
    let noiseVar1 = this.noiseVar1[i];
    staticGPUCompute.setVariableDependencies(noiseVar1, []);
    noiseVar1.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
    noiseVar1.material.uniforms.offset.value = 1.0;
    this.noiseTexture2.push(staticGPUCompute.createTexture());
    this.noiseVar2.push(staticGPUCompute.addVariable('textureNoise2', noiseShaderMaterialData.fragmentShader, this.noiseTexture2[i]));
    let noiseVar2 = this.noiseVar2[i];
    staticGPUCompute.setVariableDependencies(noiseVar2, []);
    noiseVar2.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
    noiseVar2.material.uniforms.offset.value = noiseVar1.material.uniforms.offset.value + this.textureWidth * this.textureHeight;
    this.noiseTexture3.push(staticGPUCompute.createTexture());
    this.noiseVar3.push(staticGPUCompute.addVariable('textureNoise3', noiseShaderMaterialData.fragmentShader, this.noiseTexture3[i]));
    let noiseVar3 = this.noiseVar3[i];
    staticGPUCompute.setVariableDependencies(noiseVar3, []);
    noiseVar3.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
    noiseVar3.material.uniforms.offset.value = noiseVar2.material.uniforms.offset.value + this.textureWidth * this.textureHeight;
    this.noiseTexture4.push(staticGPUCompute.createTexture());
    this.noiseVar4.push(staticGPUCompute.addVariable('textureNoise4', noiseShaderMaterialData.fragmentShader, this.noiseTexture4[i]));
    let noiseVar4 = this.noiseVar4[i];
    staticGPUCompute.setVariableDependencies(noiseVar4, []);
    noiseVar4.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
    noiseVar4.material.uniforms.offset.value = noiseVar3.material.uniforms.offset.value + this.textureWidth * this.textureHeight;

    //Produce the textures for our h0 shader
    this.h0Textures.push(staticGPUCompute.createTexture());
    this.h0Vars.push(staticGPUCompute.addVariable('textureH0', h0ShaderMaterialData.fragmentShader, this.h0Textures[i]));
    let h0Var = this.h0Vars[i];
    this.h0Textures.push(h0Var);
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
    this.hkTextures.push(hkRenderer.createTexture());
    this.hkVars.push(hkRenderer.addVariable('textureHk', hkShaderMaterialData.fragmentShader, this.hkTextures[i]));
    let hkVar = this.hkVars[i];
    hkRenderer.setVariableDependencies(hkVar, []);//Note: We use manual texture dependency injection here.
    hkVar.material.uniforms = JSON.parse(JSON.stringify(hkShaderMaterialData.uniforms));
    hkVar.material.uniforms.textureH0.value = this.staticGPUComputers[i].getCurrentRenderTarget(h0Var).texture;
    hkVar.material.uniforms.L.value = 1000.0;
    hkVar.material.uniforms.uTime.value = 500.0;
    hkVar.material.uniforms.N.value = this.N;

    let error3 = hkRenderer.init();
    if(error3 !== null){
      console.error(`Dynamic GPU Compute Renderer: ${error3}`);
    }
    hkRenderer.compute();
  }

  self = this;
  this.tick = function(time, activeTextures){
    for(let i = 0; i < self.numVariations; ++i){
      //If this texture is active
      if(self.activeTextures[i]){
        //Update the time variable of our phillipse spectrum and update hk
        self.hkVars[i].material.uniforms.uTime.value = time / 1000.0;
        self.hkRenderers[i].compute();
        this.hkTextureOuts[i] = self.hkRenderers[i].getCurrentRenderTarget(self.hkVars[i]).texture;
      }
    }
  };

  this.waterDepthToIndex = function(waterDepth){
    let i = Math.max(Math.min(Math.round((waterDepth - minHeight) * (this.numVariations / (maxHeight - minHeight))), this.numVariations), 0);
    return i;
  };
}
