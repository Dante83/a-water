function OceanPatch(scene, parentOceanGrid){
  this.outofBoundsTime = 0;
  this.position = {};
  this.position.x;
  this.position.y;
  this.ageOutOfRange = 0;
  this.staticMeshes = parentOceanGrid.staticMeshes;
  this.cornerHeights = [0.0,0.0,0.0,0.0];
  this.dissipationVector = [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0]];
  this.heightmapGenerator = parentOceanGrid.heightmapGenerator;
  this.parentOceanGrid = parentOceanGrid;

  let geometry = new THREE.PlaneBufferGeometry(parentOceanGrid.patchWidth, parentOceanGrid.patchWidth, 64, 64);
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

    //Update our heightmap data
    let hw = self.parentOceanGrid.patchWidth * 0.5;
    let cornerOffsets = [[hw, hw], [hw, -hw], [-hw, hw], [-hw, -hw]];
    let differentialOffsets = [[0.0, hw], [0.0, -hw], [-hw, 0.0], [hw, 0.0]];
    let numberOfStaticMeshElements = self.staticMeshes ? self.staticMeshes.length : 0;
    let raycasterPosition = new THREE.Vector3(0.0, 0.0, 0.0);
    for(let i = 0; i < 4; ++i){
      //Get the corner postion
      let cornerPosition = [self.position.x + cornerOffsets[i][0], self.position.y + cornerOffsets[i][1]];
      raycasterPosition.set(cornerPosition[0], 500, cornerPosition[1]);
      parentOceanGrid.raycaster.set(raycasterPosition, parentOceanGrid.downVector);

      //Determine the height at this position by casing a ray at each of the static meshes and determining
      //the closest one
      let results = parentOceanGrid.raycaster.intersectObjects(self.staticMeshes);
      self.cornerHeights[i] = results.length > 0 ? results[0] : self.parentOceanGrid.defaultDepth;

      //Go forward and back by a half width and determine the right and left
      //then use these to determine the slope along the x and y axis. This
      //can be used to determine how much the rise in terrain impacts waves
      //based on their direction, filtering out waves going parallel to shore.
      cornerPosition = [self.position.x + cornerOffsets[i][0] + differentialOffsets[2][0], self.position.y + cornerOffsets[i][1] + differentialOffsets[2][1]];
      raycasterPosition.set(cornerPosition[0], 500, cornerPosition[1]);
      parentOceanGrid.raycaster.set(raycasterPosition,parentOceanGrid.downVector);
      results = parentOceanGrid.raycaster.intersectObjects(self.staticMeshes);
      let xInitialHeight = results.length > 0 ? results[0] : self.parentOceanGrid.defaultDepth;

      cornerPosition = [self.position.x + cornerOffsets[i][0] + differentialOffsets[3][0], self.position.y + cornerOffsets[i][1] + differentialOffsets[3][1]];
      raycasterPosition.set(cornerPosition[0], 500, cornerPosition[1]);
      parentOceanGrid.raycaster.set(raycasterPosition,parentOceanGrid.downVector);
      results = parentOceanGrid.raycaster.intersectObjects(self.staticMeshes);
      let xFinalHeight = results.length > 0 ? results[0] : self.parentOceanGrid.defaultDepth;

      cornerPosition = [self.position.x + cornerOffsets[i][0] + differentialOffsets[1][0], self.position.y + cornerOffsets[i][1] + differentialOffsets[1][1]];
      raycasterPosition.set(cornerPosition[0], 500, cornerPosition[1]);
      parentOceanGrid.raycaster.set(raycasterPosition,parentOceanGrid.downVector);
      results = parentOceanGrid.raycaster.intersectObjects(self.staticMeshes);
      let yInitialHeight = results.length > 0 ? results[0] : self.parentOceanGrid.defaultDepth;

      cornerPosition = [self.position.x + cornerOffsets[i][0] + differentialOffsets[0][0], self.position.y + cornerOffsets[i][1] + differentialOffsets[0][1]];
      raycasterPosition.set(cornerPosition[0], 500, cornerPosition[1]);
      parentOceanGrid.raycaster.set(raycasterPosition,parentOceanGrid.downVector);
      results = parentOceanGrid.raycaster.intersectObjects(self.staticMeshes);
      let yFinalHeight = results.length > 0 ? results[0] : self.parentOceanGrid.defaultDepth;

      self.dissipationVector[i][0] = (xFinalHeight - xInitialHeight) / self.parentOceanGrid.patchWidth;
      self.dissipationVector[i][1] = (yFinalHeight - yInitialHeight) / self.parentOceanGrid.patchWidth;
    }

    //Update our material if this is not the default state
    self.customMaterial = false;
    for(let i = 0; i < 4; ++i){
      //Use custom material
      if(self.cornerHeights[i] >= self.parentOceanGrid.defaultDepth){
        self.customMaterial = new OceanHeightmap(self.parentOceanGrid.data, self.parentOceanGrid.renderer);
        break;
      }
    }
    if(!self.customMaterial){
      self.parentOceanGrid.defaultHeightMap;
    }
  }

  this.tick = function(time){
    if(self.customMaterial){
      self.customMaterial.tick(time);
      oceanMaterial.displacementMap = self.customMaterial.waveHeight;
      oceanMaterial.normalMap = self.customMaterial.waveNormal;
    }
    else{
      oceanMaterial.displacementMap = self.parentOceanGrid.defaultHeightMap.waveHeight;
      oceanMaterial.normalMap = self.parentOceanGrid.defaultHeightMap.waveNormal;
    }
  };
}
