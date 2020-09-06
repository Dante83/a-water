AWater.AOcean.OceanPatch = function(parentOceanGrid, initialPosition){
  let scene = parentOceanGrid.scene;
  this.initialPosition = initialPosition;
  this.position = new THREE.Vector3();
  this.staticMeshes = parentOceanGrid.staticMeshes;
  this.parentOceanGrid = parentOceanGrid;

  let geometry = new THREE.PlaneBufferGeometry(parentOceanGrid.patchSize, parentOceanGrid.patchSize, 128, 128);
  THREE.BufferGeometryUtils.computeTangents(geometry);
  this.plane = new THREE.Mesh(geometry, parentOceanGrid.oceanMaterial.clone());
  this.plane.rotateX(-Math.PI * 0.5);
  scene.add(this.plane);

  let self = this;
  this.tick = function(time){
    self.plane.material.uniforms.displacementMap.value = self.parentOceanGrid.oceanHeightComposer.displacementMap;
    self.plane.material.uniforms.normalMap.value = self.parentOceanGrid.oceanHeightComposer.normalMap;
    self.plane.material.uniforms.depthCubemap.value = self.parentOceanGrid.depthCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.reflectionRefractionCubemap.value = self.parentOceanGrid.reflectionRefractionCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.matrixWorld.value.copy(self.plane.matrixWorld);
  };
}
