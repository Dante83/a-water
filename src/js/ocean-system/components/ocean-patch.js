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

  //Set the velocity of the small water waves on the surface
  const windVelocity = new THREE.Vector2(this.parentOceanGrid.windVelocity.x, this.parentOceanGrid.windVelocity.y);
  const windVelocityMagnitude = windVelocity.length();
  const windVelocityDirection = windVelocity.divideScalar(windVelocityMagnitude)
  this.plane.material.uniforms.smallNormalMapVelocity.value.set(this.parentOceanGrid.randomWindVelocities[0], this.parentOceanGrid.randomWindVelocities[1]);
  this.plane.material.uniforms.smallNormalMapVelocity.value.normalize();
  const smallWaveVelocity = 0.7 * windVelocityMagnitude;
  this.plane.material.uniforms.smallNormalMapVelocity.value.multiplyScalar(Math.sqrt(smallWaveVelocity));
  this.plane.material.uniforms.largeNormalMapVelocity.value.set(this.parentOceanGrid.randomWindVelocities[2], this.parentOceanGrid.randomWindVelocities[3]);
  this.plane.material.uniforms.largeNormalMapVelocity.value.normalize();
  this.plane.material.uniforms.largeNormalMapVelocity.value.multiplyScalar(Math.sqrt(1.4 * smallWaveVelocity));

  let self = this;
  this.tick = function(time){
    self.plane.material.uniforms.displacementMap.value = self.parentOceanGrid.oceanHeightComposer.displacementMap;
    self.plane.material.uniforms.normalMap.value = self.parentOceanGrid.oceanHeightComposer.normalMap;
    self.plane.material.uniforms.foamMap.value = self.parentOceanGrid.oceanHeightComposer.foamMap;
    self.plane.material.uniforms.depthCubemap.value = self.parentOceanGrid.depthCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.refractionCubeMap.value = self.parentOceanGrid.refractionCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.reflectionCubeMap.value = self.parentOceanGrid.reflectionCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.smallNormalMap.value = self.parentOceanGrid.smallNormalMap;
    self.plane.material.uniforms.largeNormalMap.value = self.parentOceanGrid.largeNormalMap;
    self.plane.material.uniforms.matrixWorld.value.copy(self.plane.matrixWorld);
    self.plane.material.uniforms.t.value = time * 0.001;
  };
}
