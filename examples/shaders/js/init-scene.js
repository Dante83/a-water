document.addEventListener("DOMContentLoaded", function(){
    let scene = new THREE.Scene();
    let textureWidth = 100;
    let textureHeight = 100;
    let camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.0, 0.1);
    let renderer = new THREE.WebGLRenderer();
    renderer.setSize(textureWidth, textureHeight);
    document.body.appendChild(renderer.domElement);

    //Initialize our GPU Compute Renderer
    var gpuCompute = new GPUComputationRenderer(textureWidth, textureHeight, renderer);

    //Create 4 different textures for each of our noise LUTs.
    let offset = textureWidth * textureHeight;
    let noiseInit0 = gpuCompute.createTexture();
    let noise1Var = gpuCompute.addVariable('textureNoise1', noiseShaderMaterialData.fragmentShader, noiseInit0);
    gpuCompute.setVariableDependencies(noise1Var, [noise1Var]);
    console.log(noise1Var.material.uniforms);
    noise1Var.material.uniforms = JSON.parse(JSON.stringify(noiseShaderMaterialData.uniforms));
    console.log(noise1Var);
    noise1Var.material.uniforms.offset.value = 1.0;
    // let noiseTexture2 = gpuCompute.createTexture();
    // let noiseVar2 = gpuCompute.addVariable('noiseVariable2', noiseShaderMaterialData.fragmentShader, noiseTexture);
    // noiseVar2.material.uniforms.offset.value = noiseVar1.material.uniforms.offset.value + textureWidth * textureHeight;
    // let noiseTexture3 = gpuCompute.createTexture();
    // let noiseVar3 = gpuCompute.addVariable('noiseVariable3', noiseShaderMaterialData.fragmentShader, noiseTexture);
    // noiseVar3.material.uniforms.offset.value = noiseVar2.material.uniforms.offset.value + textureWidth * textureHeight;
    // let noiseTexture4 = gpuCompute.createTexture();
    // let noiseVar4 = gpuCompute.addVariable('noiseVariable4', noiseShaderMaterialData.fragmentShader, noiseTexture);
    // noiseVar4.material.uniforms.offset.value = noiseVar3.material.uniforms.offset.value + textureWidth * textureHeight;

    //Determine the initial values of our h0 shaders
    // h0ShaderMaterial.uniforms.N.value = 256.0;
    // h0ShaderMaterial.uniforms.L.value = 1000.0;
    // h0ShaderMaterial.uniforms.A.value = 20.0;
    // h0ShaderMaterial.uniforms.L_Value.value = (26.0 * 26.0) / 9.81;
    // h0ShaderMaterial.uniforms.w.value = new THREE.Vector2(1.0, 0.0);

    //Produce the texture for our h0 shader
    // let h0TextureLUT = StaticLUTRenderer(textureWidth, textureHeight, renderer, h0ShaderMaterial);
    //
    // hkShaderMaterial.uniforms.h_0_k.value = h0TextureLUT;
    // hkShaderMaterial.uniforms.L.value = 1000.0;
    // hkShaderMaterial.uniforms.uTime.value = 500.0;
    // hkShaderMaterial.uniforms.N.value = 256.0;
    // let hkTextureLUT = StaticLUTRenderer(textureWidth, textureHeight, renderer, hkShaderMaterial);
    // let twiddleIndicesResult = computeTwiddleIndices(256.0, renderer);
    // let twiddleTextureLUT = twiddleIndicesResult.dataTexture;
    // let twiddleIndicesButterflySpan = twiddleIndicesResult.butterflySpan;
    // let twiddleIndicesN = twiddleIndicesResult.N;
    //

    let error = gpuCompute.init();
    if(error !== null){
      console.error(error);
    }
    let outTexture = gpuCompute.getCurrentRenderTarget(noise1Var).texture;
    //noise1Var.material.uniforms['textureNoise1'] = outTexture;
    testOutputMaterial.uniforms.inTexture = outTexture;

    var geometry = new THREE.PlaneGeometry(1.5, 1.5, 1);
    var plane = new THREE.Mesh(geometry, testOutputMaterial);
    plane.position.set(0.0,0.0,1.0);
    scene.add(plane);
    var log2N = Math.round(Math.log(256) / Math.log(2));

    var lastTime = (new Date()).getTime();
    var animate = function(){
       currentTime = (new Date()).getTime();
     	 requestAnimationFrame(animate);
       let deltaTime = (currentTime - lastTime) / 1000.0 || 0.0;
       lastTime = currentTime;

    //   hkShaderMaterial.uniforms.uTime.value += deltaTime;
    //   hkTextureLUT = StaticLUTRenderer(textureWidth, textureHeight, renderer, hkShaderMaterial);
    //
    //   //Clear shader pass for twiddle indices
    //   pingpongMaterial.uniforms.twiddleIndices.value = twiddleTextureLUT;
    //   pingpongMaterial.uniforms.pingpong_0.value = hkTextureLUT;
    //   pingpongMaterial.uniforms.pingpong_1.value = null;
    //   pingpongMaterial.uniforms.numStages.value = log2N * 2;
    //   pingpongMaterial.uniforms.stage.value = 0;
    //   pingpongMaterial.uniforms.pingpong.value = 0;
    //   pingpongMaterial.uniforms.direction.value = 0;
    //   pingpongMaterial.uniforms.N.value = 256.0;
    //   pingpongMaterial.uniforms.butterflySpan = twiddleIndicesButterflySpan;
    //   pingpongMaterial.uniforms.butterflyN = twiddleIndicesN;
    //   let pingpong_0 = StaticLUTRenderer(textureWidth, textureHeight, renderer, pingpongMaterial);
    //   pingpongMaterial.uniforms.stage.value = 1;
    //   pingpongMaterial.uniforms.pingpong.value = 1;
    //   pingpongMaterial.uniforms.pingpong_1 = pingpong_0;
    //   let pingpong_1 = StaticLUTRenderer(textureWidth, textureHeight, renderer, pingpongMaterial);

      //Update our vertical pingpong texture
      //let pingpong = 0;
      // for(let i = 2; i < log2N; i++){
      //   if(pingpong){
      //     //Write to pingpong 0
      //     pingpong_0 = StaticLUTRenderer(textureWidth, textureHeight, renderer, pingpongMaterial);
      //     pingpongMaterial.uniforms.pingpong_0.value = pingpong_1;
      //   }
      //   else{
      //     //Write to pingpong 1
      //     pingpong_1 = StaticLUTRenderer(textureWidth, textureHeight, renderer, pingpongMaterial);
      //     pingpongMaterial.uniforms.pingpong_1.value = pingpong_0;
      //   }
      //
      //   pingpongMaterial.uniforms.stage.value += 1;
      //   pingpong ^= 1;
      //   pingpongMaterial.uniforms.pingpong.value = pingpong; //Switch back and forth between 0 and 1
      // }
      //
      // //Update our horizontal pingpong texture
      // pingpongMaterial.uniforms.direction.value = 1;
      // for(let i = 0; i < log2N; i++){
      //   if(pingpong){
      //     //Write to pingpong 0
      //     pingpong_0 = StaticLUTRenderer(textureWidth, textureHeight, renderer, pingpongMaterial);
      //     pingpongMaterial.uniforms.pingpong_0.value = pingpong_0;
      //   }
      //   else{
      //     //Write to pingpong 1
      //     pingpong_1 = StaticLUTRenderer(textureWidth, textureHeight, renderer, pingpongMaterial);
      //     pingpongMaterial.uniforms.pingpong_0.value = pingpong_1;
      //   }
      //
      //   pingpongMaterial.uniforms.stage.value += 1;
      //   pingpong ^= 1;
      //   pingpongMaterial.uniforms.pingpong.value = pingpong; //Switch back and forth between 0 and 1
      // }
      //Invert shader
      // heightMapShader.pingpongTexture = pingpong ? pingpong_1 : pingpong_0;
      // heightMapShader.oneOverNSquared = 1.0 / (256.0 * 256.0);

      //finalRender = StaticLUTRenderer(textureWidth, textureHeight, renderer, heightMapShader);
      //NOTE: This is claiming this isn't a function for some reason getCurrentRenderTarget(noiseVar1)
      // console.log(gpuCompute.getCurrentRenderTarget(noiseVar1));
      // debugger;
      gpuCompute.compute();

      let outTexture = gpuCompute.getCurrentRenderTarget(noise1Var).texture;
      //noise1Var.material.uniforms['textureNoise1'] = outTexture;
      testOutputMaterial.uniforms.inTexture = outTexture;

    	renderer.render(scene, camera);
    }
    animate();
});
