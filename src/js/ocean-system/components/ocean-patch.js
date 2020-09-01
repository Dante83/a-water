AWater.AOcean.OceanPatch = function(scene, parentOceanGrid){
  this.outofBoundsTime = 0;
  this.position = {};
  this.position.x;
  this.position.y;
  this.ageOutOfRange = 0;
  this.staticMeshes = parentOceanGrid.staticMeshes;
  this.cornerHeights = [0.0,0.0,0.0,0.0];
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

    //Update our heightmap data
    let hw = self.parentOceanGrid.patchSize * 0.5;
    let cornerOffsets = [[hw, hw], [hw, -hw], [-hw, hw], [-hw, -hw]];
    let numberOfStaticMeshElements = self.staticMeshes ? self.staticMeshes.length : 0;
    let raycasterPosition = new THREE.Vector3(0.0, 0.0, 0.0);
    for(let i = 0; i < 4; ++i){
      //Determine the height at this position by casing a ray at each of the static meshes and determining
      //the closest one
      let results;
      if(numberOfStaticMeshElements > 0){
        //Get the corner postion
        let cornerPosition = [self.position.x + cornerOffsets[i][0], self.position.y + cornerOffsets[i][1]];
        raycasterPosition.set(cornerPosition[0], 5.0 + self.parentOceanGrid.heightOffset, cornerPosition[1]);
        parentOceanGrid.raycaster.set(raycasterPosition, self.parentOceanGrid.downVector);
        results = parentOceanGrid.raycaster.intersectObjects(self.parentOceanGrid.staticMeshes, true);
        self.cornerHeights[i] = results && results.length > 0 ? results[0].distance : self.parentOceanGrid.defaultDepth;
      }
      else{
        //Everything stays normal and we presume a constant dept everywhere
        self.cornerHeights[i] = self.parentOceanGrid.defaultDepth;
        self.dissipationVector[i][0] = 0.0;
        self.dissipationVector[i][1] = 0.0;
      }
    }

    //Use our heights either way to set up the color of our material based on the water depth.
  }

  this.tick = function(time){
    self.plane.material.uniforms.displacementMap.value = self.parentOceanGrid.oceanHeightComposer.displacementMap;
    self.plane.material.uniforms.normalMap.value = self.parentOceanGrid.oceanHeightComposer.normalMap;
    self.plane.material.uniforms.depthCubemap.value = self.parentOceanGrid.depthCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.reflectionRefractionCubemap.value = self.parentOceanGrid.reflectionRefractionCubeCamera.renderTarget.texture;
    self.plane.material.uniforms.matrixWorld.value.copy(self.plane.matrixWorld);
  };
}