AWater.LUTlibraries.WaterScatteringLUTLibrary = function(data, renderer, scene){
  this.renderer = renderer;
  this.data = data;
  document.body.appendChild(renderer.domElement);

  //Create our first renderer, for transmittance, this time we're dealing with 4-D Textures
  //According to Elok, we are excluding the view angle from our scattering equations because
  //the light scattering is extremely local as per, https://elek.pub/projects/SCCG2010/Elek2010.pdf
  const TRANSMITTANCE_TEXTURE_SIZE = 512; //64x64x64 (sun angle, view distance, max distance)
  const SCATTERING_TEXTURE_WIDTH = 2048; //32x64x64x32
  const SCATTERING_TEXTURE_HEIGHT = 2048; //32x64x64x32
  const SCATTERING_TEXTURE_PACKING_WIDTH;
  const SCATTERING_TEXTURE_PACKING_HEIGHT;
  this.transmittanceTextureSize = TRANSMITTANCE_TEXTURE_SIZE;
  let transmittanceRenderer = new THREE.GPUComputeRenderer(TRANSMITTANCE_TEXTURE_SIZE, TRANSMITTANCE_TEXTURE_SIZE, renderer);
  let singleScatteringRenderer = new THREE.GPUComputeRenderer(SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, renderer);
  let scatteringSumRenderer = new THREE.GPUComputeRenderer(SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, renderer);

  let materials = StarrySky.Materials.Atmosphere;

  //Depth texture parameters. Note that texture depth is packing width * packing height
  this.scatteringTextureWidth = 32;
  this.scatteringTextureHeight = 64;
  this.scatteringTextureDepth = 64;
  this.scatteringTextureZed = 32;
  this.scatteringTexturePackingWidth = 32;
  this.scatteringTexturePackingHeight = 64;

  //Grab our atmospheric functions partial, we also store it in the library
  //as we use it in the final atmospheric material.
  this.scatteringFunctionsString = materials.scatteringFunctions.partialFragmentShader(
    this.scatteringTextureWidth,
    this.scatteringTextureHeight,
    this.scatteringTextureDepth,
    this.scatteringTextureZed,
    this.scatteringTexturePackingWidth,
    this.scatteringTexturePackingHeight
  );
  let scatteringFunctions = this.scatteringFunctionsString;

  //Set up our transmittance texture
  let transmittanceTexture = transmittanceRenderer.createTexture();
  let transmittanceVar = transmittanceRenderer.addVariable('transmittanceTexture',
    materials.transmittanceMaterial.fragmentShader(this.data.waterParameters.numberOfRaySteps, atmosphereFunctions),
    transmittanceTexture
  );
  transmittanceRenderer.setVariableDependencies(transmittanceVar, []);
  transmittanceVar.material.uniforms = {};
  transmittanceVar.type = THREE.FloatType;
  transmittanceVar.format = THREE.RGBAFormat;
  transmittanceVar.minFilter = THREE.LinearFilter;
  transmittanceVar.magFilter = THREE.LinearFilter;
  transmittanceVar.wrapS = THREE.ClampToEdgeWrapping;
  transmittanceVar.wrapT = THREE.ClampToEdgeWrapping;
  transmittanceVar.encoding = THREE.LinearEncoding;

  //Check for any errors in initialization
  let error1 = transmittanceRenderer.init();
  if(error1 !== null){
    console.error(`Water Scattering LUT: Transmittance Renderer: ${error1}`);
  }

  //Run the actual shader
  transmittanceRenderer.compute();
  let transmittanceRenderTarget = transmittanceRenderer.getCurrentRenderTarget(transmittanceVar);
  let transmittanceLUT = transmittanceRenderTarget.texture;
  const BYTES_PER_32_BIT_FLOAT = 4;
  this.transferrableTransmittanceBuffer = new ArrayBuffer(BYTES_PER_32_BIT_FLOAT * TRANSMITTANCE_TEXTURE_SIZE * TRANSMITTANCE_TEXTURE_SIZE * 4);
  this.transferableTransmittanceFloat32Array = new Float32Array(this.transferrableTransmittanceBuffer);
  this.renderer.readRenderTargetPixels(transmittanceRenderTarget, 0, 0, TRANSMITTANCE_TEXTURE_SIZE, TRANSMITTANCE_TEXTURE_SIZE, this.transferableTransmittanceFloat32Array);

  //
  //Set up our single scattering texture
  //

  //Rayleigh
  // let singleScatteringRayleighTexture = singleScatteringRenderer.createTexture();
  // let singleScatteringRayleighVar = singleScatteringRenderer.addVariable('kthInscatteringRayleigh',
  //   materials.singleScatteringMaterial.fragmentShader(
  //     this.scatteringTextureWidth,
  //     this.scatteringTextureHeight,
  //     this.scatteringTexturePackingWidth,
  //     this.scatteringTexturePackingHeight,
  //     true, //Is Rayleigh
  //     atmosphereFunctions,
  //     this.data.skyAtmosphericParameters
  //   ),
  //   singleScatteringRayleighTexture
  // );
  // singleScatteringRenderer.setVariableDependencies(singleScatteringRayleighVar, []);
  // singleScatteringRayleighVar.material.uniforms = JSON.parse(JSON.stringify(materials.singleScatteringMaterial.uniforms));
  // singleScatteringRayleighVar.material.uniforms.transmittanceTexture.value = transmittanceLUT;
  // singleScatteringRayleighVar.type = THREE.FloatType;
  // singleScatteringRayleighVar.format = THREE.RGBAFormat;
  // singleScatteringRayleighVar.minFilter = THREE.NearestFilter;
  // singleScatteringRayleighVar.magFilter = THREE.NearestFilter;
  // singleScatteringRayleighVar.wrapS = THREE.ClampToEdgeWrapping;
  // singleScatteringRayleighVar.wrapT = THREE.ClampToEdgeWrapping;
  // singleScatteringRayleighVar.encoding = THREE.LinearEncoding;
  //
  // //Check for any errors in initialization
  // let error2 = singleScatteringRenderer.init();
  // if(error2 !== null){
  //   console.error(`Water Scattering LUT: Single Scattering Renderer: ${error2}`);
  // }
  //
  // //Run the scattering shader
  // singleScatteringRenderer.compute();
  // const mieSingleScatteringRenderTarget = singleScatteringRenderer.getCurrentRenderTarget(singleScatteringMieVar);
  // const rayleighSingleScatteringRenderTarget = singleScatteringRenderer.getCurrentRenderTarget(singleScatteringRayleighVar);
  // //Convert this to a 3-D LUT
  // const singleScatteringMieFloat32Array = new Float32Array(SCATTERING_TEXTURE_WIDTH * SCATTERING_TEXTURE_HEIGHT * 4);
  // renderer.readRenderTargetPixels(mieSingleScatteringRenderTarget, 0, 0, SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, singleScatteringMieFloat32Array);
  // const singleScatteringMie3DLUT = new THREE.DataTexture3D(singleScatteringMieFloat32Array, SCATTERING_TEXTURE_WIDTH, this.scatteringTextureHeight, this.scatteringTexturePackingHeight);
  // singleScatteringMie3DLUT.type = THREE.FloatType;
  // singleScatteringMie3DLUT.format = THREE.RGBAFormat;
  // singleScatteringMie3DLUT.minFilter = THREE.LinearFilter;
  // singleScatteringMie3DLUT.magFilter = THREE.LinearFilter;
  // singleScatteringMie3DLUT.wrapS = THREE.ClampToEdgeWrapping;
  // singleScatteringMie3DLUT.wrapT = THREE.ClampToEdgeWrapping;
  // singleScatteringMie3DLUT.wrapR = THREE.ClampToEdgeWrapping;
  // singleScatteringMie3DLUT.encoding = THREE.LinearEncoding;
  // singleScatteringMie3DLUT.needsUpdate = true;
  //
  // const singleScatteringRayleighFloat32Array = new Float32Array(SCATTERING_TEXTURE_WIDTH * SCATTERING_TEXTURE_HEIGHT * 4);
  // renderer.readRenderTargetPixels(rayleighSingleScatteringRenderTarget, 0, 0, SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, singleScatteringRayleighFloat32Array);
  // const singleScatteringRayleigh3DLUT = new THREE.DataTexture3D(singleScatteringRayleighFloat32Array, SCATTERING_TEXTURE_WIDTH, this.scatteringTextureHeight, this.scatteringTexturePackingHeight);
  // singleScatteringRayleigh3DLUT.type = THREE.FloatType;
  // singleScatteringRayleigh3DLUT.format = THREE.RGBAFormat;
  // singleScatteringRayleigh3DLUT.minFilter = THREE.LinearFilter;
  // singleScatteringRayleigh3DLUT.magFilter = THREE.LinearFilter;
  // singleScatteringRayleigh3DLUT.wrapS = THREE.ClampToEdgeWrapping;
  // singleScatteringRayleigh3DLUT.wrapT = THREE.ClampToEdgeWrapping;
  // singleScatteringRayleigh3DLUT.wrapR = THREE.ClampToEdgeWrapping;
  // singleScatteringRayleigh3DLUT.encoding = THREE.LinearEncoding;
  // singleScatteringRayleigh3DLUT.needsUpdate = true;
  //
  // //Combine our two shaders together into an inscattering sum texture
  // let inscatteringRayleighSumTexture = scatteringSumRenderer.createTexture();
  // let inscatteringRayleighSumVar = scatteringSumRenderer.addVariable('inscatteringRayleighSumTexture',
  //   materials.inscatteringSumMaterial.fragmentShader, //Initializing
  //   inscatteringRayleighSumTexture
  // );
  // scatteringSumRenderer.setVariableDependencies(inscatteringRayleighSumVar, []);
  // inscatteringRayleighSumVar.material.uniforms = JSON.parse(JSON.stringify(materials.inscatteringSumMaterial.uniforms));
  // inscatteringRayleighSumVar.material.uniforms.isNotFirstIteration.value = 0;
  // inscatteringRayleighSumVar.material.uniforms.inscatteringTexture.value = rayleighSingleScatteringRenderTarget.texture;
  // inscatteringRayleighSumVar.type = THREE.FloatType;
  // inscatteringRayleighSumVar.format = THREE.RGBAFormat;
  // inscatteringRayleighSumVar.minFilter = THREE.NearestFilter;
  // inscatteringRayleighSumVar.magFilter = THREE.NearestFilter;
  // inscatteringRayleighSumVar.wrapS = THREE.ClampToEdgeWrapping;
  // inscatteringRayleighSumVar.wrapT = THREE.ClampToEdgeWrapping;
  // inscatteringRayleighSumVar.encoding = THREE.LinearEncoding;
  //
  // //Check for any errors in initialization
  // let error3 = scatteringSumRenderer.init();
  // if(error3 !== null){
  //   console.error(`Water Scattering LUT: Single Scattering Sum Renderer: ${error3}`);
  // }
  // scatteringSumRenderer.compute();
  //
  // let rayleighScatteringSumRenderTarget = scatteringSumRenderer.getCurrentRenderTarget(inscatteringRayleighSumVar);
  // rayleighScatteringSumRenderTarget = scatteringSumRenderer.getCurrentRenderTarget(inscatteringRayleighSumVar);
  // let rayleighScatteringSum = rayleighScatteringSumRenderTarget.texture;
  //
  // //
  // //Set up our multiple scattering textures
  // //
  // let multipleScatteringRenderer = new THREE.StarrySkyComputationRenderer(SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, renderer);
  //
  // //Rayleigh
  // let multipleScatteringRayleighTexture = multipleScatteringRenderer.createTexture();
  // let multipleScatteringRayleighVar = multipleScatteringRenderer.addVariable('kthInscatteringRayleigh',
  //   materials.kthInscatteringMaterial.fragmentShader(
  //     this.scatteringTextureWidth,
  //     this.scatteringTextureHeight,
  //     this.scatteringTexturePackingWidth,
  //     this.scatteringTexturePackingHeight,
  //     true, //Is Rayleigh
  //     atmosphereFunctions,
  //     data.skyAtmosphericParameters
  //   ),
  //   multipleScatteringRayleighTexture
  // );
  // multipleScatteringRenderer.setVariableDependencies(multipleScatteringRayleighVar, []);
  // multipleScatteringRayleighVar.material.uniforms = JSON.parse(JSON.stringify(materials.kthInscatteringMaterial.uniforms));
  // multipleScatteringRayleighVar.material.uniforms.transmittanceTexture.value = transmittanceLUT;
  // multipleScatteringRayleighVar.material.uniforms.inscatteredLightLUT.value = singleScatteringRayleigh3DLUT;
  // multipleScatteringRayleighVar.type = THREE.FloatType;
  // multipleScatteringRayleighVar.format = THREE.RGBAFormat;
  // multipleScatteringRayleighVar.minFilter = THREE.NearestFilter;
  // multipleScatteringRayleighVar.magFilter = THREE.NearestFilter;
  // multipleScatteringRayleighVar.wrapS = THREE.ClampToEdgeWrapping;
  // multipleScatteringRayleighVar.wrapT = THREE.ClampToEdgeWrapping;
  // multipleScatteringRayleighVar.encoding = THREE.LinearEncoding;
  //
  // //Check for any errors in initialization
  // let error4 = multipleScatteringRenderer.init();
  // if(error4 !== null){
  //   console.error(`Water Scattering LUT: Multiple Scattering Renderer: ${error4}`);
  // }
  //
  // //Run the multiple scattering shader
  // multipleScatteringRenderer.compute();
  // let multipleMieScatteringRenderTarget = multipleScatteringRenderer.getCurrentRenderTarget(multipleScatteringMieVar);
  // let multipleRayleighScatteringRenderTarget = multipleScatteringRenderer.getCurrentRenderTarget(multipleScatteringRayleighVar);
  //
  // // //And create our 3-D Texture again...
  // let multipleScatteringRayleighFloat32Array = new Float32Array(SCATTERING_TEXTURE_WIDTH * SCATTERING_TEXTURE_HEIGHT * 4);
  // renderer.readRenderTargetPixels(multipleRayleighScatteringRenderTarget, 0, 0, SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, multipleScatteringRayleighFloat32Array);
  // let multipleScatteringRayleigh3DLUT = new THREE.DataTexture3D(multipleScatteringRayleighFloat32Array, SCATTERING_TEXTURE_WIDTH, this.scatteringTextureHeight, this.scatteringTexturePackingHeight);
  // multipleScatteringRayleigh3DLUT.type = THREE.FloatType;
  // multipleScatteringRayleigh3DLUT.format = THREE.RGBAFormat;
  // multipleScatteringRayleigh3DLUT.minFilter = THREE.LinearFilter;
  // multipleScatteringRayleigh3DLUT.magFilter = THREE.LinearFilter;
  // multipleScatteringRayleigh3DLUT.wrapS = THREE.ClampToEdgeWrapping;
  // multipleScatteringRayleigh3DLUT.wrapT = THREE.ClampToEdgeWrapping;
  // multipleScatteringRayleigh3DLUT.wrapR = THREE.ClampToEdgeWrapping;
  // multipleScatteringRayleigh3DLUT.encoding = THREE.LinearEncoding;
  // multipleScatteringRayleigh3DLUT.needsUpdate = true;
  //
  // //Sum
  // inscatteringRayleighSumVar.material.uniforms.isNotFirstIteration.value = 1;
  // inscatteringRayleighSumVar.material.uniforms.inscatteringTexture.value = multipleRayleighScatteringRenderTarget.texture;
  // inscatteringRayleighSumVar.material.uniforms.previousInscatteringSum.value = rayleighScatteringSum;
  // scatteringSumRenderer.compute();
  // rayleighScatteringSumRenderTarget = scatteringSumRenderer.getCurrentRenderTarget(inscatteringRayleighSumVar);
  // rayleighScatteringSum = rayleighScatteringSumRenderTarget.texture;
  //
  // // Let's just focus on the second order scattering until that looks correct, possibly giving
  // // another look over the first order scattering to make sure we have that correct as well.
  // for(let i = 0; i < data.skyAtmosphericParameters.numberOfScatteringOrders; ++i){
  //   multipleScatteringRayleighVar.material.uniforms.inscatteredLightLUT.value = multipleScatteringRayleigh3DLUT;
  //
  //   //Compute this mie and rayliegh scattering order
  //   multipleScatteringRenderer.compute();
  //   multipleRayleighScatteringRenderTarget = multipleScatteringRenderer.getCurrentRenderTarget(multipleScatteringRayleighVar);
  //
  //   //And create our 3-D textures again...
  //   if(i !== (data.skyAtmosphericParameters.numberOfScatteringOrders - 1)){
  //     multipleScatteringRayleighFloat32Array = new Float32Array(SCATTERING_TEXTURE_WIDTH * SCATTERING_TEXTURE_HEIGHT * 4);
  //     renderer.readRenderTargetPixels(multipleRayleighScatteringRenderTarget, 0, 0, SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, multipleScatteringRayleighFloat32Array);
  //     multipleScatteringRayleigh3DLUT = new THREE.DataTexture3D(multipleScatteringRayleighFloat32Array, SCATTERING_TEXTURE_WIDTH, this.scatteringTextureHeight, this.scatteringTexturePackingHeight);
  //     multipleScatteringRayleigh3DLUT.type = THREE.FloatType;
  //     multipleScatteringRayleigh3DLUT.format = THREE.RGBAFormat;
  //     multipleScatteringRayleigh3DLUT.minFilter = THREE.LinearFilter;
  //     multipleScatteringRayleigh3DLUT.magFilter = THREE.LinearFilter;
  //     multipleScatteringRayleigh3DLUT.wrapS = THREE.ClampToEdgeWrapping;
  //     multipleScatteringRayleigh3DLUT.wrapT = THREE.ClampToEdgeWrapping;
  //     multipleScatteringRayleigh3DLUT.wrapR = THREE.ClampToEdgeWrapping;
  //     multipleScatteringRayleigh3DLUT.encoding = THREE.LinearEncoding;
  //     multipleScatteringRayleigh3DLUT.needsUpdate = true;
  //   }
  //
  //   //Sum
  //   inscatteringRayleighSumVar.material.uniforms.inscatteringTexture.value = multipleRayleighScatteringRenderTarget.texture;
  //   inscatteringRayleighSumVar.material.uniforms.previousInscatteringSum.value = rayleighScatteringSum;
  //   inscatteringMieSumVar.material.uniforms.inscatteringTexture.value = multipleMieScatteringRenderTarget.texture;
  //   inscatteringMieSumVar.material.uniforms.previousInscatteringSum.value = mieScatteringSum;
  //   scatteringSumRenderer.compute();
  //   rayleighScatteringSumRenderTarget = scatteringSumRenderer.getCurrentRenderTarget(inscatteringRayleighSumVar);
  //   rayleighScatteringSum = rayleighScatteringSumRenderTarget.texture;
  //   mieScatteringSumRenderTarget = scatteringSumRenderer.getCurrentRenderTarget(inscatteringMieSumVar);
  //   mieScatteringSum = mieScatteringSumRenderTarget.texture;
  // }
  //
  // //And finally create a 3-D texture for our sum, which is what we really want...
  // renderer.readRenderTargetPixels(rayleighScatteringSumRenderTarget, 0, 0, SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, multipleScatteringRayleighFloat32Array);
  // multipleScatteringRayleigh3DLUT = new THREE.DataTexture3D(multipleScatteringRayleighFloat32Array, SCATTERING_TEXTURE_WIDTH, this.scatteringTextureHeight, this.scatteringTexturePackingHeight);
  // multipleScatteringRayleigh3DLUT.type = THREE.FloatType;
  // multipleScatteringRayleigh3DLUT.format = THREE.RGBAFormat;
  // multipleScatteringRayleigh3DLUT.minFilter = THREE.LinearFilter;
  // multipleScatteringRayleigh3DLUT.magFilter = THREE.LinearFilter;
  // multipleScatteringRayleigh3DLUT.wrapS = THREE.ClampToEdgeWrapping;
  // multipleScatteringRayleigh3DLUT.wrapT = THREE.ClampToEdgeWrapping;
  // multipleScatteringRayleigh3DLUT.wrapR = THREE.ClampToEdgeWrapping;
  // multipleScatteringRayleigh3DLUT.encoding = THREE.LinearEncoding;
  // multipleScatteringRayleigh3DLUT.needsUpdate = true;
  //
  // //Clean up and finishin attaching things we will need
  // this.transmittance = transmittanceLUT;
  // this.rayleighScatteringSum = multipleScatteringRayleigh3DLUT;
}
