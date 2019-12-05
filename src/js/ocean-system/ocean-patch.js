function OceanPatch(scene, parentOceanGrid){
  this.outofBoundsTime = 0;
  this.position = {};
  this.position.x;
  this.position.y;
  this.ageOutOfRange = 0;
  this.staticMeshes = parentOceanGrid.staticMeshes;
  this.cornerHeights = [0.0,0.0,0.0,0.0];
  this.dissipationVector = [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0]];
  this.parentOceanGrid = parentOceanGrid;
  this.customMaterial = false;

  let geometry = new THREE.PlaneBufferGeometry(parentOceanGrid.patchSize, parentOceanGrid.patchSize, 128, 128);
  this.oceanMaterial = new THREE.MeshStandardMaterial( {
    side: THREE.BackSide,
    flatShading: true
  } );
  this.plane = new THREE.Mesh(geometry, this.oceanMaterial);
  this.plane.rotateX(Math.PI * 0.5);
  scene.add(this.plane);
  let self = this;

  this.update = function(){
    //Change where the mesh is
    self.plane.position.set(self.position.x, self.parentOceanGrid.heightOffset, self.position.y);

    //Update our heightmap data
    let hw = self.parentOceanGrid.patchSize * 0.5;
    let cornerOffsets = [[hw, hw], [hw, -hw], [-hw, hw], [-hw, -hw]];
    let differentialOffsets = [[0.0, hw], [0.0, -hw], [-hw, 0.0], [hw, 0.0]];
    let numberOfStaticMeshElements = self.staticMeshes ? self.staticMeshes.length : 0;
    let raycasterPosition = new THREE.Vector3(0.0, 0.0, 0.0);
    for(let i = 0; i < 4; ++i){
      //Determine the height at this position by casing a ray at each of the static meshes and determining
      //the closest one
      let results;
      if(numberOfStaticMeshElements > 0){
        //Get the corner postion
        let cornerPosition = [self.position.x + cornerOffsets[i][0], self.position.y + cornerOffsets[i][1]];
        raycasterPosition.set(0.0,100.0,0.0);
        parentOceanGrid.raycaster.set(raycasterPosition, self.parentOceanGrid.downVector);
        console.log(self.parentOceanGrid.staticMeshes);
        results = parentOceanGrid.raycaster.intersectObjects(self.parentOceanGrid.staticMeshes, true);
        console.log(raycasterPosition);
        console.log(self.parentOceanGrid.downVector);
        console.log(results);
        debugger;
        self.cornerHeights[i] = results && results.length > 0 ? results[0] : self.parentOceanGrid.defaultDepth;

        //Go forward and back by a half width and determine the right and left
        //then use these to determine the slope along the x and y axis. This
        //can be used to determine how much the rise in terrain impacts waves
        //based on their direction, filtering out waves going parallel to shore.
        cornerPosition = [self.position.x + cornerOffsets[i][0] + differentialOffsets[2][0], self.position.y + cornerOffsets[i][1] + differentialOffsets[2][1]];
        raycasterPosition.set(cornerPosition[0], 5.0 + self.parentOceanGrid.heightOffset, cornerPosition[1]);
        parentOceanGrid.raycaster.set(raycasterPosition,parentOceanGrid.downVector);
        results = parentOceanGrid.raycaster.intersectObjects(self.parentOceanGrid.staticMeshes);
        let xInitialHeight = results.length > 0 ? results[0] : self.parentOceanGrid.defaultDepth;

        cornerPosition = [self.position.x + cornerOffsets[i][0] + differentialOffsets[3][0], self.position.y + cornerOffsets[i][1] + differentialOffsets[3][1]];
        raycasterPosition.set(cornerPosition[0], 5.0 + self.parentOceanGrid.heightOffset, cornerPosition[1]);
        parentOceanGrid.raycaster.set(raycasterPosition,parentOceanGrid.downVector);
        results = parentOceanGrid.raycaster.intersectObjects(self.parentOceanGrid.staticMeshes);
        let xFinalHeight = results.length > 0 ? results[0] : self.parentOceanGrid.defaultDepth;

        cornerPosition = [self.position.x + cornerOffsets[i][0] + differentialOffsets[1][0], self.position.y + cornerOffsets[i][1] + differentialOffsets[1][1]];
        raycasterPosition.set(cornerPosition[0], 5.0 + self.parentOceanGrid.heightOffset, cornerPosition[1]);
        parentOceanGrid.raycaster.set(raycasterPosition,parentOceanGrid.downVector);
        results = parentOceanGrid.raycaster.intersectObjects(self.parentOceanGrid.staticMeshes);
        let yInitialHeight = results.length > 0 ? results[0] : self.parentOceanGrid.defaultDepth;

        cornerPosition = [self.position.x + cornerOffsets[i][0] + differentialOffsets[0][0], self.position.y + cornerOffsets[i][1] + differentialOffsets[0][1]];
        raycasterPosition.set(cornerPosition[0], 5.0 + self.parentOceanGrid.heightOffset, cornerPosition[1]);
        parentOceanGrid.raycaster.set(raycasterPosition,parentOceanGrid.downVector);
        results = parentOceanGrid.raycaster.intersectObjects(self.parentOceanGrid.staticMeshes);
        let yFinalHeight = results.length > 0 ? results[0] : self.parentOceanGrid.defaultDepth;

        self.dissipationVector[i][0] = (xFinalHeight - xInitialHeight) / self.parentOceanGrid.patchSize;
        self.dissipationVector[i][1] = (yFinalHeight - yInitialHeight) / self.parentOceanGrid.patchSize;
      }
      else{
        //Everything stays normal and we presume a constant dept everywhere
        self.cornerHeights[i] = self.parentOceanGrid.defaultDepth;
        self.dissipationVector[i][0] = 0.0;
        self.dissipationVector[i][1] = 0.0;
      }
    }

    //Update our material if this is not the default state
    self.customMaterial = false;
    for(let i = 0; i < 4; ++i){
      //Use custom material
      if(self.cornerHeights[i] < self.parentOceanGrid.defaultDepth){
        self.customMaterial = new OceanHeightmap(self.parentOceanGrid.data, self.parentOceanGrid.renderer, self.parentOceanGrid.oceanMaterialHkLibrary, self.cornerHeights, self.dissipationVector);
        break;
      }
    }
    if(!self.customMaterial){
      self.parentOceanGrid.defaultHeightMap;
    }
  }

  this.tick = function(time, defaultOceanTextures){
    if(self.customMaterial){
      let customOceanTexture = self.customMaterial.tick(time);
      self.oceanMaterial.displacementMap = customOceanTexture.heightMap;
      self.oceanMaterial.normalMap = customOceanTexture.normalMap;
    }
    else{
      self.oceanMaterial.displacementMap = defaultOceanTextures.heightMap;
      self.oceanMaterial.normalMap = defaultOceanTextures.normalMap;
    }
  };
}
