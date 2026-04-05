AWater.AOcean.OceanGrid = function(scene, renderer, camera, parentComponent){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  data = parentComponent.data;
  this.parentComponent = parentComponent;
  this.renderer = renderer;
  this.camera = camera;
  this.oceanPatches = [];
  this.oceanPatchIsInFrustrum = [];
  this.drawDistance = data.draw_distance;
  this.patchSize = data.patch_size;
  this.dataPatchSize = data.patch_size;
  this.heightOffset = data.height_offset;
  this.causticsEnabled = data.caustics_enabled;
  this.causticsStrength = data.caustics_strength;
  this.foamEnabled = data.foam_enabled;
  this.foamStart = data.foam_start;
  this.data = data;
  this.time = 0.0;
  this.smallNormalMap;
  this.largeNormalMap;
  this.causticMap;
  this.foamColorMap;
  this.foamOpacityMap;
  this.foamNormalMap;
  this.foamRoughnessMap;
  this.foamRenderMap;
  this.exclusionMap;
  this.windVelocity = data.wind_velocity;
  this.atmosphericPerspectiveEnabled = data.atmospheric_perspective_enabled;
  this.atmosphericPerspectiveDistanceScale = data.atmospheric_perspective_distance_scale;
  this.skyDirector = null;
  this.atmosphereFunctionsGLSL = null;
  //Clip planes with small bias to prevent waterline artifacts
  this.reflectionClipPlane = new THREE.Plane();
  this.reflectionClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, this.heightOffset + 0.5, 0));
  this.refractionClipPlane = new THREE.Plane();
  this.refractionClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, this.heightOffset, 0));
  this.foamClipPlane = new THREE.Plane();
  this.foamClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, this.heightOffset + 1.0, 0));
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

  let self = this;

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
    texture.colorSpace = THREE.LinearSRGBColorSpace;
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
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.largeNormalMap = texture;
  }, function(err){
    console.error(err);
  });

  //Load our caustics texture
  let causticMapTexturePromise = new Promise(function(resolve, reject){
    textureLoader.load(data.caustics_map, function(texture){resolve(texture);});
  });
  causticMapTexturePromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.causticMap = texture;
  }, function(err){
    console.error(err);
  });

  //Pull in each of our foam textures
  let foamColorPromise = new Promise(function(resolve, reject){
    textureLoader.load(data.foam_color_map, function(texture){resolve(texture);});
  });
  foamColorPromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.foamColorMap = texture;
  }, function(err){
    console.error(err);
  });

  let foamOpacityPromise = new Promise(function(resolve, reject){
    textureLoader.load(data.foam_opacity_map, function(texture){resolve(texture);});
  });
  foamOpacityPromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.foamOpacityMap = texture;
  }, function(err){
    console.error(err);
  });

  let foamNormalMapPromise = new Promise(function(resolve, reject){
    textureLoader.load(data.foam_normal_map, function(texture){resolve(texture);});
  });
  foamNormalMapPromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.foamNormalMap = texture;
  }, function(err){
    console.error(err);
  });

  let foamRoughnessMapPromise = new Promise(function(resolve, reject){
    textureLoader.load(data.foam_roughness_map, function(texture){resolve(texture);});
  });
  foamRoughnessMapPromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.foamRoughnessMap = texture;
  }, function(err){
    console.error(err);
  });

  //Number of cascades (matches ocean-height-band-library cascade count)
  this.numberOfOceanHeightBands = 6;

  //Set up planar reflection render target and mirrored camera
  let rendererSize = new THREE.Vector2();
  this.renderer.getDrawingBufferSize(rendererSize);
  this.reflectionRenderTarget = new THREE.WebGLRenderTarget(
    rendererSize.x, rendererSize.y,
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType
    }
  );
  this.reflectionCamera = new THREE.PerspectiveCamera();

  //Set up screen-space refraction render target
  this.refractionColorTarget = new THREE.WebGLRenderTarget(
    rendererSize.x, rendererSize.y,
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(
        rendererSize.x, rendererSize.y,
        THREE.UnsignedIntType
      )
    }
  );
  this.refractionColorTarget.depthTexture.format = THREE.DepthFormat;

  //Set up depth camera pointing down for edge foam
  this.foamRenderTarget = new THREE.WebGLRenderTarget(4096, 4096, {
    type: THREE.FloatType
  });
  this.foamCamera = new THREE.OrthographicCamera(-2048.0, 2048.0, 2048.0, -2048.0, 0.1, 1000.0);
  this.scene.add(this.foamCamera);

  //Set up a depth camera pointing down for ocean exclusion mapping
  this.exclusionRenderTarget = new THREE.WebGLRenderTarget(4096, 4096, {
    type: THREE.FloatType
  });
  this.exclusionCamera = new THREE.OrthographicCamera(-1024.0, 1024.0, 1024.0, -1024.0, 0.1, 1000.0);
  this.exclusionCamera.layers.disableAll();
  this.exclusionCamera.layers.set(30);
  this.scene.add(this.exclusionCamera);

  //Initialize all shader LUTs for future ocean viewing
  //Initialize our ocean variables and all associated shaders.
  this.oceanHeightBandLibrary = new AWater.AOcean.LUTlibraries.OceanHeightBandLibrary(this);
  this.oceanHeightComposer = new AWater.AOcean.LUTlibraries.OceanHeightComposer(this);

  //Discover a-starry-sky's SkyDirector for atmospheric perspective LUTs
  if(this.atmosphericPerspectiveEnabled){
    //Try the global reference first, then fall back to DOM query
    if(typeof StarrySky !== 'undefined' && StarrySky.skyDirectorRef){
      this.skyDirector = StarrySky.skyDirectorRef;
    }
    else{
      const skyEl = document.querySelector('a-starry-sky');
      if(skyEl && skyEl.components && skyEl.components.starryskywrapper){
        this.skyDirector = skyEl.components.starryskywrapper.skyDirector;
      }
    }
    if(this.skyDirector){
      const luts = this.skyDirector.getAtmosphericLUTs();
      if(luts){
        this.atmosphereFunctionsGLSL = luts.atmosphereFunctionsString;
      }
    }
  }

  //Set up our ocean material that is used for all of our ocean patches
  //If atmospheric perspective is requested but sky isn't ready yet, start with it disabled
  //and recompile when the sky becomes available
  const atmosphereReady = this.atmosphericPerspectiveEnabled && this.atmosphereFunctionsGLSL;
  const useFog = !atmosphereReady;
  let vertexShaderSource = AWater.AOcean.Materials.Ocean.waterMaterial.vertexShader;
  vertexShaderSource = vertexShaderSource.replace(/\$atmospheric_perspective_enabled/g, atmosphereReady ? '1' : '0');
  this.oceanMaterial = new THREE.ShaderMaterial({
    vertexShader: vertexShaderSource,
    fragmentShader: AWater.AOcean.Materials.Ocean.waterMaterial.fragmentShader(this.causticsEnabled, this.foamEnabled, atmosphereReady, this.atmosphereFunctionsGLSL),
    side: THREE.FrontSide,
    transparent: false,
    lights: false,
    fog: useFog
  });
  if(useFog){
    this.oceanMaterial.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', THREE.fogParsVert);
      shader.vertexShader = shader.vertexShader.replace(`#include <fog_vertex>`, THREE.fogVert);
      shader.fragmentShader = shader.fragmentShader.replace(`#include <fog_pars_fragment>`, THREE.fogParsFrag);
      shader.fragmentShader = shader.fragmentShader.replace(`#include <fog_fragment>`, THREE.fogFrag);
    };
  }
  this.oceanMaterial.uniforms = AWater.AOcean.Materials.Ocean.waterMaterial.uniforms;
  this.oceanMaterial.uniforms.sizeOfOceanPatch.value = this.patchSize;

  this.positionPassMaterial = new THREE.ShaderMaterial({
    vertexShader: AWater.AOcean.Materials.Ocean.positionPassMaterial.vertexShader,
    fragmentShader: AWater.AOcean.Materials.Ocean.positionPassMaterial.fragmentShader,
    side: THREE.FrontSide,
    transparent: false,
    lights: false
  });
  this.positionPassMaterial.uniforms = AWater.AOcean.Materials.Ocean.positionPassMaterial.uniforms;
  this.positionPassMaterial.uniforms.worldMatrix.value = this.camera.matrixWorld;

  //Get all ocean patch offsets
  const maxHalfPatchesPerSide = Math.ceil((this.drawDistance + this.patchSize) / this.patchSize);
  const drawDistanceSquared = this.drawDistance * this.drawDistance;
  const minDistanceForUpdatedLOD = this.patchSize;
  let patchLODByBucketID = {};
  const numberOfLODs = 7;
  for(let x = -maxHalfPatchesPerSide; x < maxHalfPatchesPerSide; ++x){
    const xForID = x + maxHalfPatchesPerSide;
    for(let y = -maxHalfPatchesPerSide; y < maxHalfPatchesPerSide; ++y){
      const yForID = y + maxHalfPatchesPerSide;
      const xCoord = (x - 0.5) * this.patchSize;
      const yCoord = (y - 0.5) * this.patchSize;
      const xyDistToPlaneSquared = xCoord * xCoord + yCoord * yCoord;
      if(xyDistToPlaneSquared <= drawDistanceSquared){
        //Bit mask these into the same number to make a unique 32 bit integer id
        const bucketID = xForID | (4294901760 & (yForID * 65536));
        const distanceToPlane = Math.sqrt(xyDistToPlaneSquared);
        //Not sure why this works best when draw distance is at a 1/4. Maybe it's just the angle? But not sure...
        const tesselationFactor = Math.min(Math.max(Math.round(numberOfLODs * (1.0 - ( distanceToPlane / (this.patchSize * numberOfLODs) ) )), 1), numberOfLODs);
        patchLODByBucketID[bucketID] = 2 ** tesselationFactor;
      }
    }
  }

  //Get the instance count for each tile type with all down grades to enable instanced meshes
  let instanceCount = {};
  for(let x = -maxHalfPatchesPerSide; x < maxHalfPatchesPerSide; ++x){
    const xForID = x + maxHalfPatchesPerSide;
    for(let y = -maxHalfPatchesPerSide; y < maxHalfPatchesPerSide; ++y){
      const yForID = y + maxHalfPatchesPerSide;
      const xCoord = (x - 0.5) * this.patchSize;
      const yCoord = (y - 0.5) * this.patchSize;
      const xyDistToPlaneSquared = xCoord * xCoord + yCoord * yCoord;
      if(xyDistToPlaneSquared <= drawDistanceSquared){
        //Bit mask these into the same number to make a unique 32 bit integer id
        const LODID = xForID | (4294901760 & (yForID * 65536));
        const LOD = patchLODByBucketID[LODID];
        const LODTopID = xForID | (4294901760 & ((yForID + 1) * 65536));
        const LODTop = LODTopID in patchLODByBucketID ? patchLODByBucketID[LODTopID] >= LOD : true;
        const LODRightID = (xForID + 1) | (4294901760 & (yForID * 65536));
        const LODRight = LODRightID in patchLODByBucketID ? patchLODByBucketID[LODRightID] >= LOD : true;
        const LODBottomID = xForID | (4294901760 & ((yForID - 1) * 65536));
        const LODBottom = LODBottomID in patchLODByBucketID ? patchLODByBucketID[LODBottomID] >= LOD : true;
        const LODLeftID = (xForID - 1) | (4294901760 & (yForID * 65536));
        const LODLeft = LODLeftID in patchLODByBucketID ? patchLODByBucketID[LODLeftID] >= LOD : true;

        //I'm just going to presume our LODs will never be beyond 128
        //Which would have so many triangles, it would be silly.
        //We then just go down by one or stay the same, so we can add on
        //a couple of binary flags like so.
        let instanceCountID = Math.round(Math.log(LOD) / Math.log(2));
        instanceCountID += LODTop * 256;
        instanceCountID += LODRight * 512;
        instanceCountID += LODBottom * 1024;
        instanceCountID += LODLeft * 2048;
        if(!instanceCount.hasOwnProperty(instanceCountID)){
          instanceCount[instanceCountID] = 1;
        }
        else{
          instanceCount[instanceCountID]++;
        }
      }
    }
  }

  let oceanPatchGeometryInstances = {};
  let instanceIterations = {};
  let oceanGridInstanceKeys = [];
  const windVelocity = new THREE.Vector2(this.windVelocity.x, this.windVelocity.y);
  const windVelocityMagnitude = windVelocity.length();
  const windVelocityDirection = windVelocity.divideScalar(windVelocityMagnitude);
  for(let x = -maxHalfPatchesPerSide; x < maxHalfPatchesPerSide; ++x){
    const xForID = x + maxHalfPatchesPerSide;
    for(let y = -maxHalfPatchesPerSide; y < maxHalfPatchesPerSide; ++y){
      const yForID = y + maxHalfPatchesPerSide;
      const xCoord = (x - 0.5) * this.patchSize;
      const yCoord = (y - 0.5) * this.patchSize;
      const xyDistToPlaneSquared = xCoord * xCoord + yCoord * yCoord;
      if(xyDistToPlaneSquared <= drawDistanceSquared){
        //Bit mask these into the same number to make a unique 32 bit integer id
        const LOD = patchLODByBucketID[xForID | (4294901760 & (yForID * 65536))];
        const LODTopID = xForID | (4294901760 & ((yForID + 1) * 65536));
        const LODTop = LODTopID in patchLODByBucketID ? patchLODByBucketID[LODTopID] >= LOD : true;
        const LODRightID = (xForID + 1) | (4294901760 & (yForID * 65536));
        const LODRight = LODRightID in patchLODByBucketID ? patchLODByBucketID[LODRightID] >= LOD : true;
        const LODBottomID = xForID | (4294901760 & ((yForID - 1) * 65536));
        const LODBottom = LODBottomID in patchLODByBucketID ? patchLODByBucketID[LODBottomID] >= LOD : true;
        const LODLeftID = (xForID - 1) | (4294901760 & (yForID * 65536));
        const LODLeft = LODLeftID in patchLODByBucketID ? patchLODByBucketID[LODLeftID] >= LOD : true;

        let instanceCountID = Math.round(Math.log(LOD) / Math.log(2));
        instanceCountID += LODTop * 256;
        instanceCountID += LODRight * 512;
        instanceCountID += LODBottom * 1024;
        instanceCountID += LODLeft * 2048;
        if(!oceanPatchGeometryInstances.hasOwnProperty(instanceCountID)){
          oceanGridInstanceKeys.push(instanceCountID);
          const geometry = AWater.OceanTile(this.patchSize, LOD, LODTop, LODRight, LODBottom, LODLeft);
          oceanPatchGeometryInstances[instanceCountID] = new THREE.InstancedMesh(geometry, this.oceanMaterial.clone(), instanceCount[instanceCountID]);
          oceanPatchGeometryInstances[instanceCountID].frustumCulled = false;
          instanceIterations[instanceCountID] = 0;
          scene.add(oceanPatchGeometryInstances[instanceCountID]);

          //Set the velocity of the small water waves on the surface
          const uniformsRef = oceanPatchGeometryInstances[instanceCountID].material.uniforms;
          uniformsRef.smallNormalMapVelocity.value.set(this.randomWindVelocities[0], this.randomWindVelocities[1]);
          uniformsRef.largeNormalMapVelocity.value.set(this.randomWindVelocities[2], this.randomWindVelocities[3]);
          uniformsRef.waterAbsorption.value.copy(this.data.water_absorption);
          uniformsRef.waterScattering.value.copy(this.data.water_scattering);
          uniformsRef.waterMieG.value = this.data.water_mie_g;
          uniformsRef.smallNormalMapStrength.value = this.data.small_normal_map_strength;
          uniformsRef.largeNormalMapStrength.value = this.data.large_normal_map_strength;
          uniformsRef.linearScatteringHeightOffset.value = this.data.linear_scattering_height_offset;
          uniformsRef.linearScatteringTotalScatteringWaveHeight.value = this.data.linear_scattering_total_wave_height;
          uniformsRef.patchDataSize.value = this.data.patch_data_size;
          uniformsRef.chop.value = this.data.chop;
        }
        const instanceIteration = instanceIterations[instanceCountID];
        this.oceanPatches.push(new AWater.AOcean.OceanPatch(this, new THREE.Vector3(xCoord, this.heightOffset, yCoord), oceanPatchGeometryInstances[instanceCountID], instanceIteration));
        instanceIterations[instanceCountID] += 1;
      }
    }
  }

  this.numberOfPatches = this.oceanPatches.length;
  this.globalCameraPosition = new THREE.Vector3();
  const patchOffsetMatrix = new THREE.Matrix4();
  const oceanPatchTranslationMatrices = [];
  for(let i = 0; numOceanPatches = self.oceanPatches.length, i < numOceanPatches; ++i){
    oceanPatchTranslationMatrices.push(new THREE.Matrix4());
  }
  const directionalLightDirection = new THREE.Vector3();
  const reflectionVPMatrix = new THREE.Matrix4();
  const cameraWorldDirection = new THREE.Vector3();
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
    if(self.camera !== self.parentComponent.el.sceneEl.camera){
      //Attach the scene camera if it does not exist yet
      self.camera = self.parentComponent.el.sceneEl.camera;
    }
    const sceneCamera = self.camera;
    sceneCamera.getWorldPosition(self.globalCameraPosition);

    //Ensure render targets match current drawing buffer size (A-Frame may resize after construction)
    self.renderer.getDrawingBufferSize(rendererSize);
    if(self.reflectionRenderTarget.width !== rendererSize.x || self.reflectionRenderTarget.height !== rendererSize.y){
      self.reflectionRenderTarget.setSize(rendererSize.x, rendererSize.y);
      self.refractionColorTarget.setSize(rendererSize.x, rendererSize.y);
      self.refractionColorTarget.depthTexture = new THREE.DepthTexture(
        rendererSize.x, rendererSize.y, THREE.UnsignedIntType
      );
      self.refractionColorTarget.depthTexture.format = THREE.DepthFormat;
    }

    //Update the state of our ocean grid
    self.time = time;
    for(let i = 0; numOceanPatches = self.oceanPatches.length, i < numOceanPatches; ++i){
      const oceanPatch = self.oceanPatches[i];
      const xOffset = oceanPatch.initialPosition.x + self.globalCameraPosition.x;
      const yOffset = oceanPatch.initialPosition.y;
      const zOffset = oceanPatch.initialPosition.z + self.globalCameraPosition.z;
      const translationMatrix = oceanPatchTranslationMatrices[i];
      translationMatrix.makeTranslation(xOffset, yOffset, zOffset);
      self.oceanPatches[i].instanceMeshRef.setMatrixAt(oceanPatch.instanceID, translationMatrix);
    }

    //Inform the system that we need to update all the instance matrices every frame
    for(let i = 0; numKeys = oceanGridInstanceKeys.length, i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].instanceMatrix.needsUpdate = true;
    }

    //Frustum Cull our grid
    //self.cameraFrustum.setFromProjectionMatrix(self.camera.projectionMatrix.clone().multiply(self.camera.matrixWorldInverse));

    //Hide all of our ocean grid elements
    for(let i = 0; numKeys = oceanGridInstanceKeys.length, i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].visible = false;
    }

    //Planar reflection: mirror the camera across the water plane (y = heightOffset)
    const waterY = self.heightOffset;
    self.reflectionCamera.copy(sceneCamera);
    self.reflectionCamera.position.copy(self.globalCameraPosition);
    self.reflectionCamera.position.y = 2.0 * waterY - self.reflectionCamera.position.y;

    //Compute the camera's world-space look target (not local quaternion, which ignores parent transforms)
    sceneCamera.getWorldDirection(cameraWorldDirection);
    const cameraTarget = self.globalCameraPosition.clone().add(cameraWorldDirection);
    const mirroredTarget = new THREE.Vector3(cameraTarget.x, 2.0 * waterY - cameraTarget.y, cameraTarget.z);
    self.reflectionCamera.up.set(0, -1, 0);
    self.reflectionCamera.lookAt(mirroredTarget);
    self.reflectionCamera.updateMatrixWorld(true);
    self.reflectionCamera.updateProjectionMatrix();
    //matrixWorldInverse is not updated by updateMatrixWorld, compute it explicitly
    self.reflectionCamera.matrixWorldInverse.copy(self.reflectionCamera.matrixWorld).invert();

    //Modify projection matrix with oblique clip plane so near plane aligns with water surface
    //This prevents artifacts from geometry between the camera and the water plane
    const clipPlaneView = new THREE.Vector4();
    const reflClipPlane = self.reflectionClipPlane;
    clipPlaneView.set(reflClipPlane.normal.x, reflClipPlane.normal.y, reflClipPlane.normal.z, reflClipPlane.constant);
    clipPlaneView.applyMatrix4(self.reflectionCamera.matrixWorldInverse.clone().transpose().invert());
    const projMatrix = self.reflectionCamera.projectionMatrix;
    const q = new THREE.Vector4();
    q.x = (Math.sign(clipPlaneView.x) + projMatrix.elements[8]) / projMatrix.elements[0];
    q.y = (Math.sign(clipPlaneView.y) + projMatrix.elements[9]) / projMatrix.elements[5];
    q.z = -1.0;
    q.w = (1.0 + projMatrix.elements[10]) / projMatrix.elements[14];
    const c = clipPlaneView.multiplyScalar(2.0 / clipPlaneView.dot(q));
    projMatrix.elements[2] = c.x;
    projMatrix.elements[6] = c.y;
    projMatrix.elements[10] = c.z + 1.0;
    projMatrix.elements[14] = c.w;

    //Compute the reflection view-projection matrix for correct UV sampling in the shader
    reflectionVPMatrix.multiplyMatrices(self.reflectionCamera.projectionMatrix, self.reflectionCamera.matrixWorldInverse);

    const rendererClippingEnabledBefore = self.renderer.localClippingEnabled;
    const originalGlobalClipPlane = self.renderer.clippingPlanes.length > 0 ? self.renderer.clippingPlanes : [];

    //Render reflection with clip plane (only above-water geometry)
    self.renderer.clippingPlanes = [self.reflectionClipPlane];
    const currentReflectionRT = self.renderer.getRenderTarget();
    self.renderer.setRenderTarget(self.reflectionRenderTarget);
    self.renderer.clear();
    self.renderer.render(scene, self.reflectionCamera);
    self.renderer.setRenderTarget(currentReflectionRT);

    //Render scene to screen-space refraction target (no clip plane - depth comparison in shader)
    self.renderer.clippingPlanes = originalGlobalClipPlane;
    const currentRefractionRT = self.renderer.getRenderTarget();
    self.renderer.setRenderTarget(self.refractionColorTarget);
    self.renderer.clear();
    self.renderer.render(scene, sceneCamera);
    self.renderer.setRenderTarget(currentRefractionRT);

    //Update our sea foam camera - use position pass material to output world-space height data
    self.scene.overrideMaterial = self.positionPassMaterial;
    self.renderer.setClearAlpha(0.0);
    const currentRenderTarget = self.renderer.getRenderTarget();
    self.foamCamera.position.copy(self.globalCameraPosition);
    self.foamCamera.position.y = this.heightOffset + 100.0;
    self.foamCamera.lookAt(self.globalCameraPosition.x, this.heightOffset - 1.0, self.globalCameraPosition.z);
    self.foamCamera.updateProjectionMatrix();
    self.renderer.setRenderTarget(self.foamRenderTarget);
    const clearAlpha = renderer.getClearAlpha();
    self.renderer.clear();
    self.renderer.render(scene, self.foamCamera);
    this.foamRenderMap = self.foamRenderTarget.texture;
    self.renderer.setRenderTarget(null);
    //Update our exclusion camera - also needs position pass material for height data
    self.exclusionCamera.position.copy(self.globalCameraPosition);
    self.exclusionCamera.position.y = this.heightOffset + 100.0;
    self.exclusionCamera.lookAt(self.globalCameraPosition.x, this.heightOffset - 1.0, self.globalCameraPosition.z);
    self.exclusionCamera.updateProjectionMatrix();
    self.renderer.setRenderTarget(self.exclusionRenderTarget);
    self.renderer.clear();
    self.scene.overrideMaterial = self.positionPassMaterial;
    self.renderer.render(scene, self.exclusionCamera);
    this.exclusionMap = self.exclusionRenderTarget.texture;
    self.renderer.setRenderTarget(null);

    //Restore our original materials
    self.scene.overrideMaterial = null;
    self.renderer.setRenderTarget(currentRenderTarget);
    self.renderer.setClearAlpha(clearAlpha);

    //Show all of our ocean grid elements again
    for(let i = 0; numKeys = oceanGridInstanceKeys.length, i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].visible = true;
    }

    //Update each of our ocean grid height maps
    self.oceanHeightBandLibrary.tick(time);
    self.oceanHeightComposer.tick();

    //Update all of our uniforms
    let brightestDirectionalLight;
    if(self.brightestDirectionalLight){
      brightestDirectionalLight = self.brightestDirectionalLight;
    }
    for(let i = 0; numKeys = oceanGridInstanceKeys.length, i < numKeys; ++i){
      const uniformsRef = oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms;
      for(let c = 0; c < 6; c++){
        uniformsRef.cascadeDisplacementTextures.value[c] = self.oceanHeightComposer.cascadeDisplacementTextures[c];
      }
      uniformsRef.cascadePatchSizes.value = self.oceanHeightComposer._cascadePatchSizes;
      uniformsRef.waveHeightMultiplier.value = self.oceanHeightComposer.waveHeightMultiplier;
      uniformsRef.refractionColorTexture.value = self.refractionColorTarget.texture;
      uniformsRef.refractionDepthTexture.value = self.refractionColorTarget.depthTexture;
      uniformsRef.screenResolution.value.set(self.refractionColorTarget.width, self.refractionColorTarget.height);
      uniformsRef.cameraNearFar.value.set(sceneCamera.near, sceneCamera.far);
      uniformsRef.inverseProjectionMatrix.value.copy(sceneCamera.projectionMatrixInverse);
      uniformsRef.inverseViewMatrix.value.copy(sceneCamera.matrixWorld);
      uniformsRef.reflectionTexture.value = self.reflectionRenderTarget.texture;
      uniformsRef.reflectionViewProjectionMatrix.value.copy(reflectionVPMatrix);
      uniformsRef.smallNormalMap.value = self.smallNormalMap;
      uniformsRef.largeNormalMap.value = self.largeNormalMap;
      uniformsRef.causticMap.value = self.causticMap;
      uniformsRef.causticIntensityMultiplier.value = self.causticsStrength;
      uniformsRef.foamStartLevel.value = self.foamStart;
      uniformsRef.foamDiffuseMap.value = self.foamColorMap;
      uniformsRef.foamOpacityMap.value = self.foamOpacityMap;
      uniformsRef.foamNormalMap.value = self.foamNormalMap;
      uniformsRef.foamRoughnessMap.value = self.foamRoughnessMap;
      uniformsRef.foamRenderMap.value = self.foamRenderMap;
      uniformsRef.exclusionMap.value = self.exclusionMap;
      uniformsRef.baseHeightOffset.value = self.heightOffset;
      if(self.brightestDirectionalLight){
        const intensity = brightestDirectionalLight.intensity;
        const color = brightestDirectionalLight.color;
        uniformsRef.brightestDirectionalLight.value.set(color.r * intensity, color.g * intensity, color.b * intensity);
        directionalLightDirection.set(brightestDirectionalLight.position.x, brightestDirectionalLight.position.y, brightestDirectionalLight.position.z);
        directionalLightDirection.sub(brightestDirectionalLight.target.position).negate().normalize();
        uniformsRef.brightestDirectionalLightDirection.value.set(directionalLightDirection.x, directionalLightDirection.y, directionalLightDirection.z);
      }
      else{
        uniformsRef.brightestDirectionalLight.value.set(1.0,1.0,1.0);
      }
      uniformsRef.t.value = time * 0.001;

      //Sync atmospheric perspective uniforms from a-starry-sky
      if(self.atmosphericPerspectiveEnabled && self.skyDirector){
        const luts = self.skyDirector.getAtmosphericLUTs();
        if(luts){
          //If we haven't recompiled with atmospheric perspective yet, do it now
          if(!self.atmosphereFunctionsGLSL){
            self.atmosphereFunctionsGLSL = luts.atmosphereFunctionsString;
            //Recompile all cloned materials on each ocean patch instance
            const newFragShader = AWater.AOcean.Materials.Ocean.waterMaterial.fragmentShader(
              self.causticsEnabled, self.foamEnabled, true, self.atmosphereFunctionsGLSL
            );
            let newVtxSrc = AWater.AOcean.Materials.Ocean.waterMaterial.vertexShader;
            newVtxSrc = newVtxSrc.replace(/\$atmospheric_perspective_enabled/g, '1');
            for(let j = 0; j < oceanGridInstanceKeys.length; ++j){
              const mesh = oceanPatchGeometryInstances[oceanGridInstanceKeys[j]];
              mesh.material.vertexShader = newVtxSrc;
              mesh.material.fragmentShader = newFragShader;
              mesh.material.fog = false;
              mesh.material.needsUpdate = true;
            }
            //Also update the source material for any future clones
            self.oceanMaterial.vertexShader = newVtxSrc;
            self.oceanMaterial.fragmentShader = newFragShader;
            self.oceanMaterial.fog = false;
            self.oceanMaterial.needsUpdate = true;
          }
          const skyState = luts.skyState;
          uniformsRef.atmosphereTransmittance.value = luts.transmittance;
          uniformsRef.atmosphereMieInscattering.value = luts.mieInscatteringSum;
          uniformsRef.atmosphereRayleighInscattering.value = luts.rayleighInscatteringSum;
          uniformsRef.atmSunPosition.value.copy(skyState.sun.position);
          uniformsRef.atmMoonPosition.value.copy(skyState.moon.position);
          uniformsRef.atmSunHorizonFade.value = skyState.sun.horizonFade;
          uniformsRef.atmMoonHorizonFade.value = skyState.moon.horizonFade;
          uniformsRef.atmScatteringSunIntensity.value = skyState.sun.intensity * luts.atmosphericParameters.solarIntensity / 1367.0;
          uniformsRef.atmScatteringMoonIntensity.value = skyState.moon.intensity * luts.atmosphericParameters.lunarMaxIntensity / 29.0;
          uniformsRef.atmMoonLightColor.value.copy(skyState.moon.lightingModifier);
          uniformsRef.atmCameraHeight.value = luts.atmosphericParameters.cameraHeight;
          uniformsRef.atmDistanceScale.value = self.atmosphericPerspectiveDistanceScale;
          if(luts.blueNoiseTexture){
            uniformsRef.blueNoiseTexture.value = luts.blueNoiseTexture;
          }
        }
      }

      //Blue noise dithering — always update time, texture comes from sky if available
      uniformsRef.blueNoiseTime.value = performance.now();
    }
  };
}
