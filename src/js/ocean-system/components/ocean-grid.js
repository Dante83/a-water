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
  this.smallNormalMap;
  this.largeNormalMap;
  this.windVelocity = data.wind_velocity;
  this.randomWindVelocities = [
    this.windVelocity.x - Math.random() * 0.2,
    -this.windVelocity.y - Math.random() * 0.2,
    this.windVelocity.x - Math.random() * 0.1,
    -this.windVelocity.y - Math.random() * 0.1
  ];
  this.raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.0,100.0,0.0),
    this.downVector
  );
  this.cameraFrustum = new THREE.Frustum();

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
    texture.format = THREE.RGBFormat;
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
    texture.format = THREE.RGBFormat;
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
  //this.colorRenderTarget = new THREE.WebGLRenderTargetCube(512, 512);
  this.reflectionCubeRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
    format: THREE.RGBFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    mapping: THREE.EquirectangularReflectionMapping
  });
  this.reflectionCubeCamera = new THREE.CubeCamera(0.25 * this.drawDistance, 10000.0, this.reflectionCubeRenderTarget);
  this.scene.add(this.reflectionCubeCamera);
  if(data.use_reflection_cubemap_for_environment_map){
    this.scene.environment = this.reflectionCubeRenderTarget.texture;
  }

  this.refractionCubeRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
    format: THREE.RGBFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    mapping: THREE.EquirectangularRefractionMapping
  });
  this.refractionCubeCamera = new THREE.CubeCamera(0.0, 10000.0, this.refractionCubeRenderTarget);
  this.scene.add(this.refractionCubeCamera);

  //Set up another cube camera for depth
  // this.depthCubeMapRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
  //   format: THREE.RGBFormat,
  //   generateMipmaps: false,
  //   depthBuffer: true,
  //   minFilter: THREE.NearestFilter,
  //   magFilter: THREE.NearestFilter,
  //   mapping: THREE.EquirectangularRefractionMapping,
  // });
  // this.depthCubeCamera = new THREE.CubeCamera(0.1, 512.0, this.depthCubeMapRenderTarget);
  // this.scene.add(this.depthCubeCamera);

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
    let cameraXZOffset = self.camera.position.clone();
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
    // self.depthCubeCamera.position.copy(self.camera.position);
    self.reflectionCubeCamera.position.copy(self.camera.position);
    self.refractionCubeCamera.position.copy(self.camera.position);
    //self.scene.overrideMaterial = self.positionPassMaterial;

    //self.depthCubeCamera.update(self.renderer, self.scene);
    //self.scene.overrideMaterial = null;
    self.reflectionCubeCamera.update(self.renderer, self.scene);
    self.refractionCubeCamera.update(self.renderer, self.scene);

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
