AWater.AOcean.OceanGrid = function(data, scene, renderer, camera){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  this.renderer = renderer;
  this.camera = camera;
  this.cameraWorldPosition = new THREE.Vector3();
  this.oceanPatches = [];
  this.oceanPatchIsInFrustrum = [];
  this.drawDistance = data.draw_distance;
  this.patchSize = data.patch_size;
  this.dataPatchSize = data.patch_size;
  this.patchVertexSize = data.patch_vertex_size;
  this.heightOffset = data.height_offset;
  this.data = data;
  this.time = 0.0;
  this.smallNormalMap;
  this.largeNormalMap;
  this.windVelocity = data.wind_velocity;
  const randomAngle1 = Math.random() * 2.0 * Math.PI;
  const randomAngle2 = Math.random() * 2.0 * Math.PI;
  this.randomWindVelocities = [
    2.0 * Math.cos(randomAngle1),
    2.0 * Math.sin(randomAngle1),
    1.0 * Math.cos(randomAngle2),
    1.0 * Math.sin(randomAngle2),
  ];
  this.raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.0,100.0,0.0),
    this.downVector
  );
  this.cameraFrustum = new THREE.Frustum();

  this.brightestDirectionalLight = false;

  //Make sure the magnitude of the wind velocity is greater then 0.01, otherwise
  //set it to this to avoid data errors.
  this.windVelocity.x = Math.abs(this.data.wind_velocity.x) < 0.01 ? 0.01 : this.windVelocity.x;
  this.windVelocity.y = Math.abs(this.data.wind_velocity.y) < 0.01 ? 0.01 : this.windVelocity.y;

  //Load up the textures for our ocean smaller waves
  const textureLoader = new THREE.TextureLoader();
  let smallNormalMapTexturePromise = new Promise(function(resolve, reject){
    textureLoader.load(data.small_normal_map, function(texture){resolve(texture);});
  });
  smallNormalMapTexturePromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.encoding = THREE.LinearEncoding;
    texture.format = THREE.RGBAFormat;
    self.smallNormalMap = texture;
  }, function(err){
    console.error(err);
  });

  let largeNormalMapTexturePromise = new Promise(function(resolve, reject){
    textureLoader.load(data.large_normal_map, function(texture){resolve(texture);});
  });
  largeNormalMapTexturePromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.encoding = THREE.LinearEncoding;
    texture.format = THREE.RGBAFormat;
    self.largeNormalMap = texture;
  }, function(err){
    console.error(err);
  });

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
  this.reflectionCubeRenderTarget = new THREE.WebGLCubeRenderTarget(512, {});
  this.reflectionCubeCamera = new THREE.CubeCamera(50.0, 10000, this.reflectionCubeRenderTarget);
  this.scene.add(this.reflectionCubeCamera);

  this.refractionCubeRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
    mapping: THREE.CubeRefractionMapping
  });
  this.refractionCubeCamera = new THREE.CubeCamera(0.1, 0.5 * this.drawDistance, this.refractionCubeRenderTarget);
  this.scene.add(this.refractionCubeCamera);

  //Set up another cube camera for depth
  this.depthCubeMapRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
    mapping: THREE.CubeRefractionMapping,
    type: THREE.FloatType
  });
  this.depthCubeCamera = new THREE.CubeCamera(0.1, 0.5 * this.drawDistance, this.depthCubeMapRenderTarget);
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
    transparent: true,
    lights: false,
    fog: true
  });
  this.oceanMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', THREE.fogParsVert);
    shader.vertexShader = shader.vertexShader.replace(`#include <fog_vertex>`, THREE.fogVert);
    shader.fragmentShader = shader.fragmentShader.replace(`#include <fog_pars_fragment>`, THREE.fogParsFrag);
    shader.fragmentShader = shader.fragmentShader.replace(`#include <fog_fragment>`, THREE.fogFrag);
  };
  this.oceanMaterial.uniforms = AWater.AOcean.Materials.Ocean.waterMaterial.uniforms;
  this.oceanMaterial.uniforms.sizeOfOceanPatch.value = this.patchSize;

  let self = this;
  this.positionPassMaterial = new THREE.ShaderMaterial({
    vertexShader: AWater.AOcean.Materials.Ocean.positionPassMaterial.vertexShader,
    fragmentShader: AWater.AOcean.Materials.Ocean.positionPassMaterial.fragmentShader,
    side: THREE.DoubleSide,
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
    //Update the brightest directional light if we don't have one
    if(this.brightestDirectionalLight === false){
      for(let i = 0, numItems = self.scene.children.length; i < numItems; ++i){
        let child = self.scene.children[i];
        if(child.type === 'DirectionalLight' &&
        (this.brightestDirectionalLight === false ||
          child.intensity > self.brightestDirectionalLight.intensity)){
          self.brightestDirectionalLight = child;
        }
      }
    }

    //Copy the camera position in the world...
    self.cameraWorldPosition.setFromMatrixPosition(self.camera.matrixWorld);

    //Update the state of our ocean grid
    self.time = time;
    let cameraXZOffset = self.cameraWorldPosition.clone();
    cameraXZOffset.y = this.heightOffset;
    for(let i = 0; i < self.oceanPatches.length; ++i){
      self.oceanPatches[i].plane.position.copy(self.oceanPatches[i].initialPosition).add(cameraXZOffset);
    }

    //Frustum Cull our grid
    self.cameraFrustum.setFromProjectionMatrix(self.camera.children[0].projectionMatrix.clone().multiply(self.camera.children[0].matrixWorldInverse));

    //Hide all of our ocean grid elements
    for(let i = 0; i < self.oceanPatches.length; ++i){
      self.oceanPatches[i].plane.visible = false;
    }

    //Snap a cubemap picture of our environment to create reflections and refractions
    self.depthCubeCamera.position.copy(self.cameraWorldPosition);
    self.reflectionCubeCamera.position.copy(self.cameraWorldPosition);
    self.refractionCubeCamera.position.copy(self.cameraWorldPosition);
    self.scene.overrideMaterial = self.positionPassMaterial;
    self.depthCubeCamera.update(self.renderer, self.scene);
    self.scene.overrideMaterial = null;
    self.reflectionCubeCamera.update(self.renderer, self.scene);
    self.refractionCubeCamera.update(self.renderer, self.scene);

    //Show all of our ocean grid elements again
    for(let i = 0; i < self.oceanPatches.length; ++i){
      self.oceanPatches[i].plane.visible = true;
    }

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
