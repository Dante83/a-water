AWater.AOcean.OceanPatch = function(scene, parentOceanGrid){
  this.outofBoundsTime = 0;
  this.position = {};
  this.position.x;
  this.position.y;
  this.ageOutOfRange = 0;
  this.staticMeshes = parentOceanGrid.staticMeshes;
  this.parentOceanGrid = parentOceanGrid;
  this.customOceanHeightComposer = false;

  let geometry = new THREE.PlaneBufferGeometry(parentOceanGrid.patchSize, parentOceanGrid.patchSize, 128, 128);
  this.plane = new THREE.Mesh(geometry, parentOceanGrid.oceanMaterial.clone());
  this.plane.rotateX(-Math.PI * 0.5);
  this.plane.layers.set(0);
  scene.add(this.plane);
  let self = this;

  this.update = function(){
    //Change where the mesh is
    self.plane.position.set(self.position.x, self.parentOceanGrid.heightOffset, self.position.y);
  }

  this.tick = function(time){
    self.plane.material.uniforms.displacementMap.value = self.parentOceanGrid.oceanHeightComposer.displacementMap;
    self.plane.material.uniforms.normalMap.value = self.parentOceanGrid.oceanHeightComposer.normalMap;
    self.plane.material.uniforms.depthCubemap.value = self.parentOceanGrid.depthCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.reflectionRefractionCubemap.value = self.parentOceanGrid.reflectionRefractionCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.matrixWorld.value.copy(self.plane.matrixWorld);
  };
}
