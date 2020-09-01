AWater.AOcean.OceanGrid = function(data, scene, renderer, camera, staticMeshes){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  this.renderer = renderer;
  this.camera = camera;
  this.oceanPatches = [];
  this.oceanPatchesById = {};
  this.oceanPatchOffsets = [];
  this.oceanPatchIsInFrustrum = [];
  this.hasOceanPatchOffsetByOffsetId = [];
  this.drawDistance = data.draw_distance;
  this.startingPoint = [0.0, 0.0];
  this.patchSize = data.patch_size;
  this.heightOffset = data.height_offset;
  this.data = data;
  this.time = 0.0;
  this.staticMeshes = staticMeshes;
  this.downVector = new THREE.Vector3(0.0, -1.0, 0.0);
  this.defaultDepth = 500;
  this.raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.0,100.0,0.0),
    this.downVector
  );
  this.cameraFrustum = new THREE.Frustum();

  //Set up our cube camera for reflections and refractions
  //this.colorRenderTarget = new THREE.WebGLRenderTargetCube(512, 512);
  this.reflectionRefractionCubeCamera = new THREE.CubeCamera(0.1, 100000.0, 256, {
    format: THREE.RGBFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter
  });
  this.scene.add(this.reflectionRefractionCubeCamera);

  //Set up another cube camera for depth
  //this.depthRenderTarget = new THREE.WebGLRenderTargetCube(128, 128);
  this.depthCubeCamera = new THREE.CubeCamera(0.1, 100000.0, 128, {
    type: THREE.FloatType,
    format: THREE.RedFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter
  });
  this.scene.add(this.depthCubeCamera);

  //Enable all layers except for the effect layer that are enabled on the primary camera
  for(let i = 0; i < 32; ++i){
    const layerTest = camera.layers.test(i);
    this.reflectionRefractionCubeCamera.layers.disableAll();
    this.depthCubeCamera.layers.disableAll();
    if(i !== data.effect_layer && layerTest){
      this.reflectionRefractionCubeCamera.layers.enable();
      this.depthCubeCamera.layers.enable();
    }
  }

  //Create our Bayer Matrix
  //Thanks to http://www.anisopteragames.com/how-to-fix-color-banding-with-dithering/
  const bayerMatrixData = [
  0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21];

  let gl = renderer.getContext();
  let bayerImage = gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 8, 8, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(data))

  let textureLoader = new THREE.TextureLoader();
  const bayerMatrixTexture = textureLoader.load(bayerImage,  function(){
      starColors.magFilter = THREE.NearestFilter;
      starColors.minFilter = THREE.NearestFilter;
      starColors.wrapS = THREE.RepeatWrapping;
      starColors.wrapW = THREE.RepeatWrapping;
      starColors.needsUpdate = true;
    });

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

  //Determine what our fade out start and end heights are
  //This is a bit of a hack but we're going to leave it static for now
  this.numberOfOceanHeightBands = 5;
  this.beginsFadingOutAtHeight = [];
  this.vanishingHeight = [];
  let distanceBetweenBands = 80.0;
  for(let i = 0; i < this.numberOfOceanHeightBands; ++i){
    this.beginsFadingOutAtHeight.push(distanceBetweenBands * i);
    this.vanishingHeight.push(0.0);
  }

  //Initialize all shader LUTs for future ocean viewing
  //Initialize our ocean variables and all associated shaders.
  this.oceanHeightBandLibrary = new AWater.AOcean.LUTlibraries.OceanHeightBandLibrary(this);
  let dwd = data.default_water_depth;
  let defaultHeights = [dwd, dwd, dwd, dwd];
  this.oceanHeightComposer = new AWater.AOcean.LUTlibraries.OceanHeightComposer(this, defaultHeights);

  //Set up our ocean material that is used for all of our ocean patches
  this.oceanMaterial = new THREE.ShaderMaterial({
    vertexShader: AWater.AOcean.Materials.Ocean.waterMaterial.vertexShader,
    fragmentShader: AWater.AOcean.Materials.Ocean.waterMaterial.fragmentShader,
    side: THREE.DoubleSide,
    flatShading: true,
    transparent: true,
    lights: false
  });
  this.oceanMaterial.uniforms = AWater.AOcean.Materials.Ocean.waterMaterial.uniforms;
  this.oceanMaterial.uniforms.bayerMatrixTexture = bayerMatrixTexture;

  let self = this;
  this.positionPassMaterial = new THREE.ShaderMaterial({
    vertexShader: AWater.AOcean.Materials.Ocean.positionPassMaterial.vertexShader,
    fragmentShader: AWater.AOcean.Materials.Ocean.positionPassMaterial.fragmentShader,
    side: THREE.DoubleSide,
    flatShading: true,
    transparent: false,
    lights: false
  });
  this.positionPassMaterial.uniforms = THREE.UniformsUtils.merge([
    self.positionPassMaterial.uniforms,
    AWater.AOcean.Materials.Ocean.waterMaterial.uniforms
  ]);
  this.positionPassMaterial.uniforms.worldMatrix = this.camera.matrixWorld;

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
        let patch = new AWater.AOcean.OceanPatch(self.scene, self);
        patch.position.x = newGridCoordX;
        patch.position.y = newGridCoordY;
        patch.update();
        newOceanPatches.push(patch);
        newOceanPatchesById[id] = patch;
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

    //Frustum Cull our grid
    self.cameraFrustum.setFromMatrix(self.camera.children[0].projectionMatrix.clone().multiply(self.camera.children[0].matrixWorldInverse));

    //Update our camera layers
    for(let i = 0; i < 32; ++i){
      const layerTest = camera.layers.test(i);
      self.reflectionRefractionCubeCamera.layers.disableAll();
      self.depthCubeCamera.layers.disableAll();
      if(i !== data.effect_layer && layerTest){
        self.reflectionRefractionCubeCamera.layers.enable();
        self.depthCubeCamera.layers.enable();
      }
    }

    //Snap a cubemap picture of our environment to create reflections and refractions
    self.depthCubeCamera.position.copy(self.camera.position);
    self.reflectionRefractionCubeCamera.position.copy(self.camera.position);
    //self.scene.overrideMaterial = self.positionPassMaterial;
    self.depthCubeCamera.update(self.renderer, self.scene);
    self.scene.overrideMaterial = null;
    self.reflectionRefractionCubeCamera.update(self.renderer, self.scene);

    //Update the scene fog based on whether we are above or below the
    //water.


    //Update each of our ocean grid height maps
    self.oceanHeightBandLibrary.tick(time);
    self.oceanHeightComposer.tick();

    //Update individual changes on each of our ocean patches
    for(let i = 0, numOceanPatches = self.oceanPatches.length; i < numOceanPatches; ++i){
      //Only update our GPU shader for this mesh if it it's visible
      if(self.cameraFrustum.intersectsObject(self.oceanPatches[i].plane)){
        self.oceanPatches[i].tick(time);
      }
    }
  };
}
