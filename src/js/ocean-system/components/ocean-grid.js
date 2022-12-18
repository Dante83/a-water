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
  this.data = data;
  this.time = 0.0;
  this.smallNormalMap;
  this.largeNormalMap;
  this.windVelocity = data.wind_velocity;
  this.reflectionClipPlane = new THREE.Plane();
  this.reflectionClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, this.heightOffset * 2.0, 0));
  this.refractionClipPlane = new THREE.Plane();
  this.refractionClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, this.heightOffset * 2.0, 0));
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
  this.reflectionCubeCamera = new THREE.CubeCamera(0.1, 10000.0, this.reflectionCubeRenderTarget);
  this.scene.add(this.reflectionCubeCamera);

  this.refractionCubeRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
    mapping: THREE.CubeRefractionMapping
  });
  this.refractionCubeCamera = new THREE.CubeCamera(0.1, 1000.0, this.refractionCubeRenderTarget);
  this.scene.add(this.refractionCubeCamera);

  //Set up another cube camera for depth
  this.depthCubeMapRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
    mapping: THREE.CubeRefractionMapping,
    type: THREE.FloatType
  });
  this.depthCubeCamera = new THREE.CubeCamera(0.1, 1000.0, this.depthCubeMapRenderTarget);
  this.scene.add(this.depthCubeCamera);

  //Initialize all shader LUTs for future ocean viewing
  //Initialize our ocean variables and all associated shaders.
  this.oceanHeightBandLibrary = new AWater.AOcean.LUTlibraries.OceanHeightBandLibrary(this);
  this.oceanHeightComposer = new AWater.AOcean.LUTlibraries.OceanHeightComposer(this);

  //Set up our ocean material that is used for all of our ocean patches
  this.oceanMaterial = new THREE.ShaderMaterial({
    vertexShader: AWater.AOcean.Materials.Ocean.waterMaterial.vertexShader,
    fragmentShader: AWater.AOcean.Materials.Ocean.waterMaterial.fragmentShader,
    side: THREE.FrontSide,
    transparent: false,
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
          instanceIterations[instanceCountID] = 0;
          scene.add(oceanPatchGeometryInstances[instanceCountID]);

          //Set the velocity of the small water waves on the surface
          const uniformsRef = oceanPatchGeometryInstances[instanceCountID].material.uniforms;
          uniformsRef.smallNormalMapVelocity.value.set(this.randomWindVelocities[0], this.randomWindVelocities[1]);
          uniformsRef.largeNormalMapVelocity.value.set(this.randomWindVelocities[2], this.randomWindVelocities[3]);
          uniformsRef.lightScatteringAmounts.value.copy(this.data.light_scattering_amounts);
          uniformsRef.smallNormalMapStrength.value = this.data.small_normal_map_strength;
          uniformsRef.largeNormalMapStrength.value = this.data.large_normal_map_strength;
          uniformsRef.linearScatteringHeightOffset.value = this.data.linear_scattering_height_offset;
          uniformsRef.linearScatteringTotalScatteringWaveHeight.value = this.data.linear_scattering_total_wave_height;
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

    //Update the state of our ocean grid
    self.time = time;
    for(let i = 0; numOceanPatches = self.oceanPatches.length, i < numOceanPatches; ++i){
      const oceanPatch = self.oceanPatches[i];
      const xOffset = oceanPatch.initialPosition.x + self.globalCameraPosition.x;
      const yOffset = oceanPatch.initialPosition.y + self.heightOffset;
      const zOffset = oceanPatch.initialPosition.z + self.globalCameraPosition.z;
      let newMatrix = new THREE.Matrix4();
      newMatrix.makeTranslation(xOffset, yOffset, zOffset);
      self.oceanPatches[i].instanceMeshRef.setMatrixAt(oceanPatch.instanceID, newMatrix);
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

    //Snap a cubemap picture of our environment to create reflections and refractions
    self.depthCubeCamera.position.copy(self.globalCameraPosition);
    self.reflectionCubeCamera.position.copy(self.globalCameraPosition);
    self.reflectionCubeCamera.position.y = 2.0 * self.heightOffset - self.globalCameraPosition.y;
    self.refractionCubeCamera.position.copy(self.globalCameraPosition);
    self.reflectionCubeCamera.position.y = 0.0;
    self.scene.overrideMaterial = self.positionPassMaterial;
    self.depthCubeCamera.update(self.renderer, self.scene);
    self.scene.overrideMaterial = null;
    const rendererClippingEnabledBefore = self.renderer.localClippingEnabled;
    const originalGlobalClipPlane = self.renderer.clippingPlanes.length > 0 ? [...self.renderer.clippingPlanes] : [];
    self.renderer.clippingPlanes = [self.reflectionClipPlane];
    self.reflectionCubeCamera.update(self.renderer, self.scene);
    self.renderer.clippingPlanes = [self.refractionClipPlane];
    self.refractionCubeCamera.update(self.renderer, self.scene);
    self.renderer.clippingPlanes = originalGlobalClipPlane;

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
      uniformsRef.displacementMap.value = self.oceanHeightComposer.displacementMap;
      uniformsRef.refractionCubeMap.value = self.refractionCubeCamera.renderTarget.texture;
      uniformsRef.reflectionCubeMap.value = self.reflectionCubeCamera.renderTarget.texture;
      uniformsRef.depthCubeMap.value = self.depthCubeCamera.renderTarget.texture;
      uniformsRef.smallNormalMap.value = self.smallNormalMap;
      uniformsRef.largeNormalMap.value = self.largeNormalMap;
      if(self.brightestDirectionalLight){
        const intensity = brightestDirectionalLight.intensity;
        const color = brightestDirectionalLight.color;
        uniformsRef.brightestDirectionalLight.value.set(color.r * intensity, color.g * intensity, color.b * intensity);
      }
      else{
        uniformsRef.brightestDirectionalLight.value.set(1.0,1.0,1.0);
      }
      uniformsRef.t.value = time * 0.001;
    }
  };
}
