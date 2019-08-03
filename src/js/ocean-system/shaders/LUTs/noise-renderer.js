StaticLUTRenderer(width, height, webGLRenderer, material){
  // Create a different scene to hold our buffer objects
  let bufferScene = new THREE.Scene();
  let bufferCamera = new THREE.OrthographicCamera(0.0, 0.0, width, height, 0.0, 5.0);
  bufferScene.addCamera(bufferCamera);
  let plane = new THREE.Mesh(new THREE.PlaneGeometry(0.0, 0.0, width, height), moonShaderMaterial);
  bufferScene.add(plane);
  let bufferTexture = new THREE.WebGLRenderTarget(width, height, {minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter});

  requestAnimationFrame(render);
  webGLRenderer.render(bufferScene, bufferCamera, bufferTexture);

  return bufferTexture;
}
