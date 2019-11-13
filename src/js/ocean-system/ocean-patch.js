function OceanPatch(scene, oceanTextureData, patchWidth){
  this.outofBoundsTime = 0;
  this.position = {};
  this.position.x;
  this.position.y;
  this.ageOutOfRange = 0;

  let geometry = new THREE.PlaneBufferGeometry(patchWidth, patchWidth, 64, 64);
  let oceanMaterial = new THREE.MeshStandardMaterial( {
    side: THREE.BackSide,
    flatShading: true
  } );
  let plane = new THREE.Mesh(geometry, oceanMaterial);
  plane.rotateX(Math.PI * 0.5);
  scene.add(plane);
  let self = this;

  this.update = function(){
    //Change where the mesh is
    plane.position.set(self.position.x, 0.0, self.position.y);

    //Update our material
  }

  this.tick = function(oceanTextureData){
    oceanMaterial.displacementMap = oceanTextureData.waveHeight;
    oceanMaterial.normalMap = oceanTextureData.waveNormal;
  };
}
