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
    noiseShaderMaterial.offset += offset;
    let noiseTexture1 = StaticLUTRenderer(textureWidth, textureHeight, renderer, noiseShaderMaterial).texture;
    noiseShaderMaterial.offset += offset;
    let noiseTexture2 = StaticLUTRenderer(textureWidth, textureHeight, renderer, noiseShaderMaterial).texture;
    noiseShaderMaterial.offset += offset;
    let noiseTexture3 = StaticLUTRenderer(textureWidth, textureHeight, renderer, noiseShaderMaterial).texture;
    noiseShaderMaterial.offset += offset;
    let noiseTexture4 = StaticLUTRenderer(textureWidth, textureHeight, renderer, noiseShaderMaterial).texture;

    //Determine the initial values of our h0 shaders
    h0ShaderMaterial.uniforms.noise_r0.value = noiseTexture1;
    h0ShaderMaterial.uniforms.noise_i0.value = noiseTexture2;
    h0ShaderMaterial.uniforms.noise_r1.value = noiseTexture3;
    h0ShaderMaterial.uniforms.noise_i1.value = noiseTexture4;
    h0ShaderMaterial.uniforms.N.value = 256.0;
    h0ShaderMaterial.uniforms.L.value = 1000.0;
    h0ShaderMaterial.uniforms.A.value = 20.0;
    h0ShaderMaterial.uniforms.L_Value.value = 0.0;
    h0ShaderMaterial.uniforms.K.set(1.0, 1.5);
    h0ShaderMaterial.uniforms.w.set(2.0, 1.7);

    //Produce the texture for our h0 shader
    let h0TextureLUT = StaticLUTRenderer(textureWidth, textureHeight, renderer, h0ShaderMaterial).texture;

    //Pass this texture onto the plane material for viewing.
    let planeMaterial = new THREE.MeshBasicMaterial({map: StaticLUTRenderer(textureWidth, textureHeight, renderer, noiseShaderMaterial).texture});

    var geometry = new THREE.PlaneGeometry(1, 1, 1);
    var plane = new THREE.Mesh(geometry, planeMaterial);
    scene.add(plane);

    var animate = function(){
    	requestAnimationFrame(animate);
    	renderer.render(scene, camera);
    }
    animate();
});
