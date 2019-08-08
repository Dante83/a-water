function StaticLUTRenderer(width, height, webGLRenderer, material){
  // Create a different scene to hold our buffer objects
  let bufferScene = new THREE.Scene();
  let bufferCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.0, 1.0);
  var geometry = new THREE.PlaneGeometry(2, 2);
  var plane = new THREE.Mesh(geometry, noiseShaderMaterial);
  bufferScene.add(plane);
  let bufferTexture = new THREE.WebGLRenderTarget(width, height, {minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter});

  webGLRenderer.render(bufferScene, bufferCamera, bufferTexture);
  return bufferTexture;
}
