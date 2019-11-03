function OceanPatch(scene, heightmap){
  let geometry = new THREE.PlaneBufferGeometry(3.0, 3.0, 64, 64);
  //let oceanMaterial = new THREE.MeshStandardMaterial( {side: THREE.DoubleSide, wireframe: false, map: heightmap} );
  let oceanMaterial = new THREE.MeshStandardMaterial({side: THREE.DoubleSide, wireframe: true, displacementMap: heightmap});
  let plane = new THREE.Mesh(geometry, oceanMaterial);
  plane.rotateX(Math.PI * 0.5);
  scene.add(plane);

  this.tick = function(heightmapTexture){
    oceanMaterial.displacementMap = heightmapTexture;
  };
}
