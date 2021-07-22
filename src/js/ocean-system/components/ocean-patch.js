AWater.AOcean.OceanPatch = function(parentOceanGrid, initialPosition){
  let scene = parentOceanGrid.scene;
  this.initialPosition = initialPosition;
  this.position = new THREE.Vector3();
  this.parentOceanGrid = parentOceanGrid;

  let geometry = new THREE.PlaneBufferGeometry(parentOceanGrid.patchSize, parentOceanGrid.patchSize, parentOceanGrid.patchVertexSize, parentOceanGrid.patchVertexSize);
  THREE.BufferGeometryUtils.computeTangents(geometry);
  this.plane = new THREE.Mesh(geometry, parentOceanGrid.oceanMaterial.clone());
  this.plane.rotateX(-Math.PI * 0.5);
  scene.add(this.plane);

  //Set the velocity of the small water waves on the surface
  const windVelocity = new THREE.Vector2(this.parentOceanGrid.windVelocity.x, this.parentOceanGrid.windVelocity.y);
  const windVelocityMagnitude = windVelocity.length();
  const windVelocityDirection = windVelocity.divideScalar(windVelocityMagnitude)
  this.plane.material.uniforms.smallNormalMapVelocity.value.set(this.parentOceanGrid.randomWindVelocities[0], this.parentOceanGrid.randomWindVelocities[1]);
  this.plane.material.uniforms.largeNormalMapVelocity.value.set(this.parentOceanGrid.randomWindVelocities[2], this.parentOceanGrid.randomWindVelocities[3]);
  this.plane.material.uniforms.lightScatteringAmounts.value.copy(this.parentOceanGrid.data.light_scattering_amounts);
  this.plane.material.uniforms.smallNormalMapStrength.value = this.parentOceanGrid.data.small_normal_map_strength;
  this.plane.material.uniforms.largeNormalMapStrength.value = this.parentOceanGrid.data.large_normal_map_strength;
  this.plane.material.uniforms.linearScatteringHeightOffset.value = this.parentOceanGrid.data.linear_scattering_height_offset;
  this.plane.material.uniforms.linearScatteringTotalScatteringWaveHeight.value = this.parentOceanGrid.data.linear_scattering_total_wave_height;

  let self = this;
  this.tick = function(time){
    self.plane.material.uniforms.displacementMap.value = self.parentOceanGrid.oceanHeightComposer.displacementMap;
    self.plane.material.uniforms.refractionCubeMap.value = self.parentOceanGrid.refractionCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.reflectionCubeMap.value = self.parentOceanGrid.reflectionCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.depthCubeMap.value = self.parentOceanGrid.depthCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.smallNormalMap.value = self.parentOceanGrid.smallNormalMap;
    self.plane.material.uniforms.largeNormalMap.value = self.parentOceanGrid.largeNormalMap;
    self.plane.material.uniforms.matrixWorld.value.copy(self.plane.matrixWorld);
    if(self.parentOceanGrid.brightestDirectionalLight){
      const brightestDirectionalLight = self.parentOceanGrid.brightestDirectionalLight;
      const color = brightestDirectionalLight.color;
      const intensity = brightestDirectionalLight.intensity;
      self.plane.material.uniforms.brightestDirectionalLight.value.set(color.r * intensity, color.g * intensity, color.b * intensity);
    }
    else{
      self.plane.material.uniforms.brightestDirectionalLight.value.set(1.0,1.0,1.0);
    }
    self.plane.material.uniforms.t.value = time * 0.001;
  };
}
