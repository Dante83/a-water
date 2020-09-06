AWater.AOcean.OceanGrid = function(data, scene, renderer, camera, staticMeshes){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  this.renderer = renderer;
  this.camera = camera;
  this.oceanPatches = [];
  this.oceanPatchIsInFrustrum = [];
  this.drawDistance = data.draw_distance;
  this.startingPoint = [0.0, 0.0];
  this.patchSize = data.patch_size;
  this.heightOffset = data.height_offset;
  this.data = data;
  this.time = 0.0;
  this.staticMeshes = staticMeshes;
  this.raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.0,100.0,0.0),
    this.downVector
  );
  this.cameraFrustum = new THREE.Frustum();

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

  //Set up our cube camera for reflections and refractions
  //this.colorRenderTarget = new THREE.WebGLRenderTargetCube(512, 512);
  this.reflectionRefractionCubeCamera = new THREE.CubeCamera(0.1, 100000.0, 512, {
    format: THREE.RGBFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter
  });
  this.scene.add(this.reflectionRefractionCubeCamera);

  //Set up another cube camera for depth
  //this.depthRenderTarget = new THREE.WebGLRenderTargetCube(256, 256);
  this.depthCubeCamera = new THREE.CubeCamera(0.1, 100000.0, 256, {
    type: THREE.FloatType,
    format: THREE.RGBType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  });
  this.scene.add(this.depthCubeCamera);

  //Initialize all shader LUTs for future ocean viewing
  //Initialize our ocean variables and all associated shaders.
  this.oceanHeightBandLibrary = new AWater.AOcean.LUTlibraries.OceanHeightBandLibrary(this);
  this.oceanHeightComposer = new AWater.AOcean.LUTlibraries.OceanHeightComposer(this);

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
  this.oceanMaterial.uniforms.sizeOfOceanPatch.value = this.patchSize;

  let self = this;
  this.positionPassMaterial = new THREE.ShaderMaterial({
    vertexShader: AWater.AOcean.Materials.Ocean.positionPassMaterial.vertexShader,
    fragmentShader: AWater.AOcean.Materials.Ocean.positionPassMaterial.fragmentShader,
    side: THREE.DoubleSide,
    flatShading: true,
    transparent: false,
    lights: false
  });
  this.positionPassMaterial.uniforms = AWater.AOcean.Materials.Ocean.positionPassMaterial.uniforms;
  this.positionPassMaterial.uniforms.worldMatrix.value = this.camera.matrixWorld;

  //Get all ocean patch offsets
  let maxHalfPatchesPerSide = Math.ceil((this.drawDistance + this.patchSize) / this.patchSize);
  let drawDistanceSquared = this.drawDistance * this.drawDistance;
  for(let x = -maxHalfPatchesPerSide; x < maxHalfPatchesPerSide; ++x){
    for(let y = -maxHalfPatchesPerSide; y < maxHalfPatchesPerSide; ++y){
      let xCoord = x * this.patchSize;
      let yCoord = y * this.patchSize;
      if(x * x + y * y <= drawDistanceSquared){
        this.oceanPatches.push(new AWater.AOcean.OceanPatch(this, new THREE.Vector3(xCoord, this.heightOffset, yCoord)));
      }
    }
  }
  this.numberOfPatches = this.oceanPatches.length;

  this.tick = function(time){
    //Update the state of our ocean grid
    self.time = time;
    for(let i = 0; i < self.oceanPatches.length; ++i){
      self.oceanPatches[i].plane.position.copy(self.oceanPatches[i].initialPosition).add(self.camera.position);
    }

    //Frustum Cull our grid
    self.cameraFrustum.setFromMatrix(self.camera.children[0].projectionMatrix.clone().multiply(self.camera.children[0].matrixWorldInverse));

    //Hide all of our ocean grid elements
    for(let i = 0; i < self.oceanPatches.length; ++i){
      self.oceanPatches[i].plane.visible = false;
    }

    //Snap a cubemap picture of our environment to create reflections and refractions
    self.depthCubeCamera.position.copy(self.camera.position);
    self.reflectionRefractionCubeCamera.position.copy(self.camera.position);
    self.scene.overrideMaterial = self.positionPassMaterial;
    self.depthCubeCamera.update(self.renderer, self.scene);
    self.scene.overrideMaterial = null;
    self.reflectionRefractionCubeCamera.update(self.renderer, self.scene);

    //Show all of our ocean grid elements again
    for(let i = 0; i < self.oceanPatches.length; ++i){
      self.oceanPatches[i].plane.visible = true;
    }

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
      else{
        self.oceanPatches[i].visible = false;
      }
    }
  };
}
