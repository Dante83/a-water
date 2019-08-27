document.addEventListener("DOMContentLoaded", function(){
    var scene = new THREE.Scene();
    var textureWidth = 100.0;
    var textureHeight = 100.0;
    var camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.0, 0.1);
    var renderer = new THREE.WebGLRenderer();
    renderer.setSize(textureWidth, textureHeight);
    document.body.appendChild(renderer.domElement);

    //Create 4 different textures for each of our noise LUTs.
    let offset = textureWidth * textureHeight;
    noiseShaderMaterial.uniforms.offset.value = 1.0;
    let noiseTexture1 = StaticLUTRenderer(textureWidth, textureHeight, renderer, noiseShaderMaterial);
    noiseShaderMaterial.uniforms.offset.value += textureWidth * textureHeight;
    let noiseTexture2 = StaticLUTRenderer(textureWidth, textureHeight, renderer, noiseShaderMaterial);
    noiseShaderMaterial.uniforms.offset.value += textureWidth * textureHeight;
    let noiseTexture3 = StaticLUTRenderer(textureWidth, textureHeight, renderer, noiseShaderMaterial);
    noiseShaderMaterial.uniforms.offset.value += textureWidth * textureHeight;
    let noiseTexture4 = StaticLUTRenderer(textureWidth, textureHeight, renderer, noiseShaderMaterial);

    //Determine the initial values of our h0 shaders
    h0ShaderMaterial.uniforms.noise_r0.value = noiseTexture1;
    h0ShaderMaterial.uniforms.noise_i0.value = noiseTexture2;
    h0ShaderMaterial.uniforms.noise_r1.value = noiseTexture3;
    h0ShaderMaterial.uniforms.noise_i1.value = noiseTexture4;
    h0ShaderMaterial.uniforms.N.value = 256.0;
    h0ShaderMaterial.uniforms.L.value = 1000.0;
    h0ShaderMaterial.uniforms.A.value = 20.0;
    h0ShaderMaterial.uniforms.L_Value.value = (26.0 * 26.0) / 9.81;
    h0ShaderMaterial.uniforms.w.value = new THREE.Vector2(1.0, 0.0);

    //Produce the texture for our h0 shader
    let h0TextureLUT = StaticLUTRenderer(textureWidth, textureHeight, renderer, h0ShaderMaterial);

    hkShaderMaterial.uniforms.h_0_k.value = h0TextureLUT;
    hkShaderMaterial.uniforms.L.value = 1000.0;
    hkShaderMaterial.uniforms.uTime.value = 500.0;
    hkShaderMaterial.uniforms.N.value = 256.0;
    let hkTextureLUT = StaticLUTRenderer(textureWidth, textureHeight, renderer, hkShaderMaterial);
    let twiddleTextureLUT = computeTwiddleIndices(256.0, renderer);

    //Pass this texture onto the plane material for viewing.
    let planeMaterial = new THREE.MeshBasicMaterial({map: hkTextureLUT});

    var geometry = new THREE.PlaneGeometry(1, 1, 1);
    var plane = new THREE.Mesh(geometry, planeMaterial);
    scene.add(plane);

    var log2N = Math.round(Math.log(256) / Math.log(2));

    var lastTime = (new Date()).getTime();
    var animate = function(){
      currentTime = (new Date()).getTime();
    	requestAnimationFrame(animate);
      let deltaTime = (currentTime - lastTime) / 1000.0 || 0.0;
      lastTime = currentTime;

      hkShaderMaterial.uniforms.uTime.value += deltaTime;
      hkTextureLUT = StaticLUTRenderer(textureWidth, textureHeight, renderer, hkShaderMaterial);

      //Clear shader pass for twiddle indices
      pingpongMaterial.uniforms.twiddleIndices.value = twiddleTextureLUT;
      pingpongMaterial.uniforms.pingpong_0.value = hkTextureLUT;
      pingpongMaterial.uniforms.pingpong_1.value = null;
      pingpongMaterial.uniforms.numStages.value = log2N * 2;
      pingpongMaterial.uniforms.stage.value = 0;
      pingpongMaterial.uniforms.pingpong.value = 0;
      pingpongMaterial.uniforms.direction.value = 0;
      pingpongMaterial.uniforms.N.value = 256.0;
      let pingpong_0 = StaticLUTRenderer(textureWidth, textureHeight, renderer, pingpongMaterial);
      // pingpongMaterial.uniforms.stage.value = 1;
      // pingpongMaterial.uniforms.pingpong.value = 1;
      // pingpongMaterial.uniforms.pingpong_1 = pingpong_0;
      // let pingpong_1 = StaticLUTRenderer(textureWidth, textureHeight, renderer, pingpongMaterial);

      // //Update our vertical pingpong texture
      // let pingpong = 0;
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
      //finalRender = StaticLUTRenderer(textureWidth, textureHeight, renderer, pingpongMaterial);
      planeMaterial.map = pingpong_0;

    	renderer.render(scene, camera);
    }
    animate();
});
