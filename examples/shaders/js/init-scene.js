document.addEventListener("DOMContentLoaded", function(){
    let scene = new THREE.Scene();
    let textureWidth = 512;
    let textureHeight = 512;
    let N = 512;
    let camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.0, 0.1);
    let renderer = new THREE.WebGLRenderer();
    renderer.setSize(textureWidth, textureHeight);
    document.body.appendChild(renderer.domElement);

    //Initialize our GPU Compute Renderers
    let staticGPUCompute = new THREE.GPUComputationRenderer(textureWidth, textureHeight, renderer);
    let hkRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, renderer);
    let butterflyRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, renderer);
    let waveHeightRenderer = new THREE.GPUComputationRenderer(textureWidth, textureHeight, renderer);

    //Create 4 different textures for each of our noise LUTs.
    let offset = textureWidth * textureHeight;
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

    //Produce the texture for our h0 shader
    let h0TextureInit = staticGPUCompute.createTexture();
    let h0TextureVar = staticGPUCompute.addVariable('textureH0', h0ShaderMaterialData.fragmentShader, h0TextureInit);
    staticGPUCompute.setVariableDependencies(h0TextureVar, [noise1Var, noise2Var, noise3Var, noise4Var]);
    h0TextureVar.material.uniforms = {
      ...h0TextureVar.material.uniforms,
      ...JSON.parse(JSON.stringify(h0ShaderMaterialData.uniforms))
    }
    h0TextureVar.material.uniforms.N.value = N;
    h0TextureVar.material.uniforms.L.value = 1000.0;
    h0TextureVar.material.uniforms.A.value = 20.0;
    h0TextureVar.material.uniforms.L_.value = (26.0 * 26.0) / 9.81;
    h0TextureVar.material.uniforms.w.value = new THREE.Vector2(1.0, 0.0);

    //Now compute our h_0 texture for future use
    let error1 = staticGPUCompute.init();
    if(error1 !== null){
      console.error(`Static GPU Compute Renderer: ${error1}`);
    }
    staticGPUCompute.compute();
    staticGPUCompute.compute(); //Must be run twice to fill up second ping pong shader? Weird.

    //Now compute our twiddle data for injection
    let twiddleTexture = computeTwiddleIndices(h0TextureVar.material.uniforms.N.value, renderer);

    //Initialize our h_k shader
    let hkTextureInit = hkRenderer.createTexture();
    let hkTextureVar = hkRenderer.addVariable('textureHk', hkShaderMaterialData.fragmentShader, hkTextureInit);
    hkRenderer.setVariableDependencies(hkTextureVar, []);//Note: We use manual texture dependency injection here.
    hkTextureVar.material.uniforms = JSON.parse(JSON.stringify(hkShaderMaterialData.uniforms));
    hkTextureVar.material.uniforms.textureH0.value = staticGPUCompute.getCurrentRenderTarget(h0TextureVar).texture;
    hkTextureVar.material.uniforms.L.value = 1000.0;
    hkTextureVar.material.uniforms.uTime.value = 500.0;
    hkTextureVar.material.uniforms.N.value = N;

    let error3 = hkRenderer.init();
    if(error3 !== null){
      console.error(`Dynamic GPU Compute Renderer: ${error3}`);
    }
    hkRenderer.compute();

    //Set up our butterfly height generator
    butterflyTextureVars = [];
    let numPingPongIterations = Math.ceil(Math.log(N) / Math.log(2));
    let butterflyTextureInit = hkRenderer.createTexture();
    butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_0`, butterflyTextureData.fragmentShader('hk_texture', true), butterflyTextureInit));
    butterflyRenderer.setVariableDependencies(butterflyTextureVars[0], []);
    butterflyTextureVars[0].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
    butterflyTextureVars[0].material.uniforms.pingpong_hk_texture = {};
    butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.type = 't';
    butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.value = hkRenderer.getCurrentRenderTarget(hkTextureVar).texture;
    butterflyTextureVars[0].material.uniforms.direction.value = 0;
    butterflyTextureVars[0].material.uniforms.stageFraction.value = 0.0;
    butterflyTextureVars[0].material.uniforms.twiddleTexture.value = twiddleTexture;
    for(let i = 1; i < numPingPongIterations; i++){
      let butterflyTextureInit = hkRenderer.createTexture();
      butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_${i}`, butterflyTextureData.fragmentShader(i - 1), butterflyTextureInit));
      butterflyRenderer.setVariableDependencies(butterflyTextureVars[i], [butterflyTextureVars[i - 1]]);
      butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
      butterflyTextureVars[i].material.uniforms.direction.value = 0;
      butterflyTextureVars[i].material.uniforms.stageFraction.value = i / (numPingPongIterations - 1.0);
      butterflyTextureVars[i].material.uniforms.twiddleTexture.value = twiddleTexture;
    }
    let numPingPongIterationsTimes2 = numPingPongIterations * 2;
    for(let i = numPingPongIterations; i < numPingPongIterationsTimes2; i++){
      let butterflyTextureInit = hkRenderer.createTexture();
      butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_${i}`, butterflyTextureData.fragmentShader(i - 1), butterflyTextureInit));
      butterflyRenderer.setVariableDependencies(butterflyTextureVars[i], [butterflyTextureVars[i - 1]]);
      butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(butterflyTextureData.uniforms));
      butterflyTextureVars[i].material.uniforms.direction.value = 1;
      butterflyTextureVars[i].material.uniforms.stageFraction.value = (i - numPingPongIterations) / (numPingPongIterations - 1.0);
      butterflyTextureVars[i].material.uniforms.twiddleTexture.value = twiddleTexture;
    }
    let finalButterflyTextureVar = butterflyTextureVars[numPingPongIterationsTimes2 - 1];

    let error4 = butterflyRenderer.init();
    if(error4 !== null){
      console.error(`Butterfly Texture Renderer: ${error4}`);
    }
    butterflyRenderer.compute();

    //Initialize our wave height shader
    let waveHeightTextureInit = waveHeightRenderer.createTexture();
    let waveHeightTextureVar = waveHeightRenderer.addVariable('textureWaveHeight', waveHeightShaderMaterialData.fragmentShader, waveHeightTextureInit);
    waveHeightRenderer.setVariableDependencies(waveHeightTextureVar, []);//Note: We use manual texture dependency injection here.
    waveHeightTextureVar.material.uniforms = JSON.parse(JSON.stringify(waveHeightShaderMaterialData.uniforms));
    waveHeightTextureVar.material.uniforms.butterflyTexture.value = butterflyRenderer.getCurrentRenderTarget(finalButterflyTextureVar).texture;
    waveHeightTextureVar.material.uniforms.N.value = N;

    let error5 = waveHeightRenderer.init();
    if(error5 !== null){
      console.error(`Wave Height Renderer: ${error5}`);
    }

    var geometry = new THREE.PlaneGeometry(1.5, 1.5, 1);
    var plane = new THREE.Mesh(geometry, testOutputMaterial);
    plane.position.set(0.0,0.0,1.0);
    scene.add(plane);
    var lastTime = (new Date()).getTime();

    var animate = function(){
      currentTime = (new Date()).getTime();
      requestAnimationFrame(animate);
      let deltaTime = (currentTime - lastTime) / 1000.0 || 0.0;
      lastTime = currentTime;

      //Update the time variable of our phillipse spectrum
      hkTextureVar.material.uniforms.uTime.value += deltaTime;

      //Compute the next frame
      hkRenderer.compute();

      //Update our ping-pong butterfly texture
      butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.value = hkRenderer.getCurrentRenderTarget(hkTextureVar).texture;
      butterflyRenderer.compute();

      waveHeightTextureVar.material.uniforms.butterflyTexture.value = butterflyRenderer.getCurrentRenderTarget(finalButterflyTextureVar).texture;
      waveHeightRenderer.compute();

      let outTexture = waveHeightRenderer.getCurrentRenderTarget(waveHeightTextureVar).texture;
      testOutputMaterial.uniforms.inTexture.value = outTexture;

      renderer.render(scene, camera);
    }
    animate();
});
