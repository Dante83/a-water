function OceanGrid(data, scene, renderer, camera){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  this.renderer = renderer;
  this.camera = camera;
  this.oceanPatches = [];
  this.oceanPatchesById = {};
  this.oceanPatchOffsets = [];
  this.hasOceanPatchOffsetByOffsetId = [];
  this.drawDistance = data.draw_distance;
  this.startingPoint = [0.0, 0.0];
  this.patchSize = data.patch_size;
  console.log(data);
  this.time = 0.0;

  console.log(this.camera.position.clone().applyMatrix4(this.camera.matrixWorld));

  //Get all ocean patch offsets
  let maxHalfPatchesPerSide = Math.ceil((this.drawDistance + this.patchSize) / this.patchSize);
  for(let x = -maxHalfPatchesPerSide; x < maxHalfPatchesPerSide; ++x){
    for(let y = -maxHalfPatchesPerSide; y < maxHalfPatchesPerSide; ++y){
      let xCoord = x * this.patchSize;
      let yCoord = y * this.patchSize;
      if(Math.sqrt(x * x + y * y) <= this.drawDistance){
        this.oceanPatchOffsets.push({x: xCoord, y: yCoord, x_i: x, y_i: y});
      }
    }
  }
  this.numberOfPatches = this.oceanPatchOffsets.length;

  //Initialize all shader LUTs for future ocean viewing
  //Initialize our ocean variables and all associated shaders.
  this.oceanHeightmap = new OceanHeightmap(data, this.renderer);
  let self = this;

  this.checkForNewGridElements = function(){
    //Grab the floor for approximate nearby coordinate center
    let globalCameraPosition = self.camera.position.clone();
    let nearbyGridCenterX_i = Math.floor((globalCameraPosition.x - self.startingPoint[0]) / self.patchSize);
    let nearbyGridCenterY_i = Math.floor((globalCameraPosition.z - self.startingPoint[1]) / self.patchSize);
    let nearbyGridCenterX = nearbyGridCenterX_i * self.patchSize + self.startingPoint[0];
    let nearbyGridCenterY = nearbyGridCenterY_i * self.patchSize + self.startingPoint[1];

    //Get all of our old patches
    let oldPatchesByAge = {};
    let numberOfOldPatches = 0;
    let mayHaveOldPatches = false;
    for(let i = 0, numPatches = self.oceanPatches.length; i < numPatches; ++i){
      let patch = self.oceanPatches[i];
      let diffX = nearbyGridCenterX - patch.x;
      let diffY = nearbyGridCenterY - patch.y;
      if(Math.sqrt(diffX * diffX + diffY * diffY) > this.drawDistance){
        patch.ageOutOfRange += 1;
        let patchAge = Math.min(patch.ageOutOfRange, 30);
        if(!(patchAge in oldPatchesByAge)){
          oldPatchesByAge[patchAge] = [];
          mayHaveOldPatches = true;
        }
        oldPatchesByAge[patchAge].push(patch);
        numberOfOldPatches += 1;
      }
      else{
        patch.ageOutOfRange = 0;
      }
    }

    //Creat our new patches
    let newOceanPatchesById = {};
    let newOceanPatches = [];
    let numberOfOldPatchesUsed;
    let patchAgeIterator = 30;
    let patchCounter = patchAgeIterator in oldPatchesByAge ? oldPatchesByAge[patchAgeIterator].length - 1 : 0;
    let patchCounterCheckerCounter = 0;
    for(let i = 0; i < self.numberOfPatches; ++i){
      //Get the test coordinates for the new patch
      let newGridCoordX = nearbyGridCenterX + this.oceanPatchOffsets[i].x;
      let newGridCoordY = nearbyGridCenterY + this.oceanPatchOffsets[i].y;

      //Check for this id
      let id = (nearbyGridCenterX_i + this.oceanPatchOffsets[i].x_i) * 65536 + nearbyGridCenterY_i + this.oceanPatchOffsets[i].y_i;
      if(id in this.oceanPatchesById){
        //The patch already exists, just add it into our ocean patches
        newOceanPatches.push(this.oceanPatchesById[id]);
        newOceanPatchesById[id] = this.oceanPatchesById[id];
      }
      else if(mayHaveOldPatches && numberOfOldPatchesUsed !== numberOfOldPatches){
        //Grab an old patch
        numberOfOldPatchesUsed += 1;
        while(patchCounter <= 0 && patchAgeIterator > 0){
          patchAgeIterator -= 1;
          patchCounter = patchAgeIterator in oldPatchesByAge ? oldPatchesByAge[patchAgeIterator].length - 1 : 0;
        }

        if(patchAgeIterator > 0){
          let patch = oldPatchesByAge[patchAgeIterator][patchCounter];
          patch.ageOutOfRange = 0;
          patch.position.x = newGridCoordX;
          patch.position.y = newGridCoordY;
          patch.update();
          newOceanPatches.push(patch);
          newOceanPatchesById[id] = patch;
          patchCounter -= 1;
        }

        if(numberOfOldPatchesUsed === numberOfOldPatches){
          mayHaveOldPatches = false;
        }
      }
      else if(newOceanPatches.length < self.numberOfPatches){
        //Create a new patch as we are out of old patches to use
        let patch = new OceanPatch(self.scene, self.oceanHeightmap.tick(self.time), self.patchSize);
        patch.position.x = newGridCoordX;
        patch.position.y = newGridCoordY;
        if(patchCounterCheckerCounter < 10){
          console.log(patch);
        }
        patch.update();
        newOceanPatches.push(patch);
        newOceanPatchesById[id] = patch;
        patchCounterCheckerCounter += 1;
      }
    }

    //Replace our patch collections to remove our old patches
    self.oceanPatches = newOceanPatches;
    self.oceanPatchesById = newOceanPatchesById;

    //NOTE: This is a good spot to update our visibility and level of detail

    //NOTE: Iterate all potential animation combinations for use in our patches
  };

  this.tick = function(time){
    //Update the state of our ocean grid
    self.time = time;
    self.checkForNewGridElements();

    //Update each of our ocean grid height maps
    let oceanHeightMap = self.oceanHeightmap.tick(time);
    for(let i = 0, numOceanPatches = self.oceanPatches.length; i < numOceanPatches; ++i){
      self.oceanPatches[i].tick(oceanHeightMap);
    }
  };
}
