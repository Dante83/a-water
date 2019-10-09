function StaticLUTRenderer(width, height, webGLRenderer, inputMaterial){
  // Create a different scene to hold our buffer objects
  let bufferScene = new THREE.Scene();
  let bufferCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.0, 1.0);
  let geometry = new THREE.PlaneGeometry(2, 2, 1);
  let plane = new THREE.Mesh(geometry, inputMaterial);
  bufferScene.add(plane);
  let bufferTexture = new THREE.WebGLRenderTarget(width, height,
    {
      format:  THREE.RGBAFormat,
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter
    });
  webGLRenderer.render(bufferScene, bufferCamera, bufferTexture);
  return bufferTexture;
}
