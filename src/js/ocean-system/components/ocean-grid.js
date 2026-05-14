AWater.AOcean.OceanGrid = function(scene, renderer, camera, parentComponent){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  const data = parentComponent.data;
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
  this.foamRenderMap;
  this.exclusionMap;
  this.windVelocity = data.wind_velocity;
  this.atmosphericPerspectiveEnabled = data.atmospheric_perspective_enabled;
  this.atmosphericPerspectiveDistanceScale = data.atmospheric_perspective_distance_scale;
  this.skyDirector = null;
  this.atmosphereFunctionsGLSL = null;
  //Clip planes with small bias to prevent waterline artifacts
  this.refractionClipPlane = new THREE.Plane();
  this.refractionClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, this.heightOffset, 0));
  this.foamClipPlane = new THREE.Plane();
  this.foamClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, this.heightOffset + 1.0, 0));
  //Normal map scroll velocities: wind-relative fixed angles (Crest-style).
  //Both maps scroll in the same general direction with slight non-perpendicular offsets.
  //Random angles caused the maps to sometimes scroll nearly perpendicular/opposite,
  //creating a plaid cross-hatch interference pattern.
  const windAngle = Math.atan2(this.windVelocity.y, this.windVelocity.x);
  const windSpeed = Math.sqrt(this.windVelocity.x ** 2 + this.windVelocity.y ** 2);
  const nmSpeed0 = windSpeed * 0.04; // 4% of wind speed, primary map
  const nmSpeed1 = windSpeed * 0.025; // 2.5% of wind speed, secondary map
  this.randomWindVelocities = [
    nmSpeed0 * Math.cos(windAngle + 0.34), // ~20deg off wind
    nmSpeed0 * Math.sin(windAngle + 0.34),
    nmSpeed1 * Math.cos(windAngle - 0.20), // ~12deg off wind, other side
    nmSpeed1 * Math.sin(windAngle - 0.20),
  ];
  this.raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.0,100.0,0.0),
    this.downVector
  );
  this.cameraFrustum = new THREE.Frustum();

  this.brightestDirectionalLight = false;
  this.directionalLights = [];

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

  //Number of cascades (matches ocean-height-band-library cascade count)
  this.numberOfOceanHeightBands = 6;

  let rendererSize = new THREE.Vector2();
  this.renderer.getDrawingBufferSize(rendererSize);

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

  //Ocean-only cascaded shadow map. Dedicated tight-frustum depth pass that
  //only contains the water InstancedMeshes — gives per-wave self-shadow that
  //the scene-wide sun shadow map can't resolve. Registered with each mesh
  //below via addCaster(). Safe to skip if the shadow material isn't loaded
  //(older builds without ocean-shadow.js).
  if(AWater.AOcean.OceanShadowCSM && AWater.AOcean.Materials.Ocean.oceanShadowMaterial){
    this.oceanShadowCSM = new AWater.AOcean.OceanShadowCSM(this, scene);
  } else {
    this.oceanShadowCSM = null;
  }

  //── Horizon skirt ─────────────────────────────────────────────────────────
  //Flat ring at y=0 that fills the angular sliver where the FFT ocean's
  //farthest patches fail the depth test against a-starry-sky's icosahedron
  //sky dome (radius 5000), or are clipped by the camera far plane.
  //
  //Architecture: the skirt mesh uses the FFT ocean material directly (cloned
  //so it has its own uniforms object that the per-frame tick loop updates
  //identically to the FFT tiles). Only difference is one substituted line in
  //the vertex shader to pin gl_Position.z to the far plane, so the outer rim
  //extends past camera.far without being frustum-clipped. Result: the skirt
  //inherits the full FFT lighting (Fresnel, refracted, body, specular,
  //scattering, atm perspective) by construction — no parallel implementation.
  //
  //Depth choreography:
  //  - Sky dome (renderOrder 0): depthWrite forced off in tick loop once its
  //    renderer wires up — the dome stops blocking anything behind it.
  //  - Skirt (renderOrder 1): depthTest:true, depthWrite:false. With the
  //    z-clamp the skirt's depth is ~0.9995 (just inside the far plane) so
  //    every closer scene object (island, lighthouse, etc.) wins the depth
  //    test and the skirt does NOT overdraw them. The dome's pixels (which
  //    skipped depthWrite) leave depth=1.0, so the skirt passes there and
  //    overdraws the dome's lower hemisphere as intended.
  //  - FFT ocean (renderOrder 2): default depth, draws last over the skirt
  //    wherever real ocean geometry exists.
  this.horizonSkirtMesh = null;
  if(this.atmosphericPerspectiveEnabled && this.skyDirector){
    const skirtMaterial = this.oceanMaterial.clone();
    skirtMaterial.depthTest = true;
    skirtMaterial.depthWrite = false;
    skirtMaterial.fog = false;
    //Substitute the final gl_Position assignment with a z-clamp variant so
    //the rim verts (well past camera.far) survive frustum clipping. Every
    //skirt fragment ends up at depth ~0.9995 — beyond any real scene depth
    //but inside the dome's pixels (which write no depth at all).
    skirtMaterial.vertexShader = skirtMaterial.vertexShader.replace(
      'gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);',
      'vec4 _skirtClipPos = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0); _skirtClipPos.z = _skirtClipPos.w * 0.99999; gl_Position = _skirtClipPos;'
    );
    //Pin a coarse ringIndex so the vertex shader skips the finer cascades
    //2-5 in its displacement sum. The skirt is meant to be flat-ish; we just
    //want the FFT fragment shader to read wave normals at the same XZ.
    skirtMaterial.uniforms.ringIndex.value = 5;
    skirtMaterial.uniforms.sizeOfOceanPatch.value = this.patchSize;

    //RingGeometry: flat ring at y=0 rotated from the default XY plane. Outer
    //radius capped at 1e7 m (10000 km) — the z-clamp keeps the rim fragments
    //alive past camera.far.
    const skirtGeometry = new THREE.RingGeometry(8.0, 1.0e7, 256, 1);
    skirtGeometry.rotateX(-Math.PI / 2);

    //InstancedMesh with a single identity instance — the FFT vertex shader
    //multiplies by `instanceMatrix`, so we need the attribute present even
    //though there is only one "instance" of the skirt.
    this.horizonSkirtMesh = new THREE.InstancedMesh(skirtGeometry, skirtMaterial, 1);
    this.horizonSkirtMesh.setMatrixAt(0, new THREE.Matrix4());
    this.horizonSkirtMesh.instanceMatrix.needsUpdate = true;
    this.horizonSkirtMesh.frustumCulled = false;
    this.horizonSkirtMesh.castShadow = false;
    this.horizonSkirtMesh.receiveShadow = false;
    this.horizonSkirtMesh.renderOrder = 1;
    scene.add(this.horizonSkirtMesh);
  }

  //── Clipmap grid construction ────────────────────────────────────────────
  //All tiles use the same fixed tessellation (numCells cells/edge = numCells+1 verts/edge).
  //Ring k has tile world size patchSize*2^k.
  //Ring 0: full 4×4 grid of tiles.  Ring k≥1: 12-tile frame (4×4 minus inner 2×2).
  //The outer edge of each ring borders the next (coarser) ring and needs T-junction
  //stitching via the existing edge flags (false = coarser neighbor).
  const numCells = 32;
  const ringCount = Math.max(1, Math.ceil(Math.log2(Math.max(2, this.drawDistance / this.patchSize))));

  //Instance key encodes ring index (bits 0-3) + edge flags (bits 4-7)
  function makeClipmapKey(k, top, right, bottom, left){
    return k | ((top ? 1 : 0) << 4) | ((right ? 1 : 0) << 5) | ((bottom ? 1 : 0) << 6) | ((left ? 1 : 0) << 7);
  }

  //Enumerate every tile in the clipmap, calling cb(k, gx, gy, tileSize, top, right, bottom, left)
  //gx/gy ∈ {-2,-1,0,1}: tile grid offset (geometry spans [gx*tileSize, (gx+1)*tileSize])
  function enumerateClipmapTiles(cb){
    for(let k = 0; k < ringCount; ++k){
      const tileSize = self.patchSize * Math.pow(2, k);
      const isLastRing = (k === ringCount - 1);
      for(let gx = -2; gx <= 1; ++gx){
        for(let gy = -2; gy <= 1; ++gy){
          //Ring k≥1: skip inner 2×2 — that area is covered by ring k-1
          if(k > 0 && gx >= -1 && gx <= 0 && gy >= -1 && gy <= 0) continue;
          //Outer edge flags: false when the edge faces the next (coarser) ring
          const top    = !(gy ===  1 && !isLastRing);
          const right  = !(gx ===  1 && !isLastRing);
          const bottom = !(gy === -2 && !isLastRing);
          const left   = !(gx === -2 && !isLastRing);
          cb(k, gx, gy, tileSize, top, right, bottom, left);
        }
      }
    }
  }

  //Count instances per key
  let instanceCount = {};
  enumerateClipmapTiles(function(k, gx, gy, tileSize, top, right, bottom, left){
    const key = makeClipmapKey(k, top, right, bottom, left);
    instanceCount[key] = (instanceCount[key] || 0) + 1;
  });

  //Create instanced meshes and ocean patches
  let oceanPatchGeometryInstances = {};
  let instanceIterations = {};
  let oceanGridInstanceKeys = [];

  enumerateClipmapTiles(function(k, gx, gy, tileSize, top, right, bottom, left){
    const key = makeClipmapKey(k, top, right, bottom, left);
    if(!oceanPatchGeometryInstances.hasOwnProperty(key)){
      oceanGridInstanceKeys.push(key);
      const geometry = AWater.OceanTile(tileSize, numCells, top, right, bottom, left);
      const mesh = new THREE.InstancedMesh(geometry, self.oceanMaterial.clone(), instanceCount[key]);
      mesh.frustumCulled = false;
      //Sit above the horizon skirt (renderOrder 1) so FFT ocean overwrites the
      //pure-inscatter skirt fragments wherever real ocean geometry exists.
      mesh.renderOrder = 2;
      //Ocean self-shadow is handled by the dedicated ocean-only CSM below;
      //casting into the scene-wide sun shadow map would re-rasterise ~900K
      //ocean triangles into a large target every render call, for no useful
      //wave-scale detail. receiveShadow stays on so environment casters
      //(trees, lighthouse, rocks) still occlude the water.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      oceanPatchGeometryInstances[key] = mesh;
      instanceIterations[key] = 0;
      scene.add(mesh);
      //Register as a caster in the ocean-only CSM. The CSM decides which
      //cascades this ring participates in based on its ring index (each
      //cascade has a maxRing). Larger rings only contribute to coarser
      //cascades; finest ring 0 contributes to all four. Layers are set
      //inside addCaster so per-cascade light cameras naturally pick the
      //right caster set without any per-frame layer toggling here.
      if(self.oceanShadowCSM){
        self.oceanShadowCSM.addCaster(mesh, k);
      }

      const uniformsRef = mesh.material.uniforms;
      uniformsRef.smallNormalMapVelocity.value.set(self.randomWindVelocities[0], self.randomWindVelocities[1]);
      uniformsRef.largeNormalMapVelocity.value.set(self.randomWindVelocities[2], self.randomWindVelocities[3]);
      uniformsRef.waterAbsorption.value.copy(self.data.water_absorption);
      uniformsRef.waterScattering.value.copy(self.data.water_scattering);
      uniformsRef.waterTurbidity.value = self.data.water_turbidity;
      uniformsRef.k1ScatterAmount.value = self.data.k1_scatter_amount;
      uniformsRef.k2ViewDependence.value = self.data.k2_view_dependence;
      uniformsRef.k3DirectScatter.value = self.data.k3_direct_scatter;
      uniformsRef.k4ParallaxScatter.value = self.data.k4_parallax_scatter;
      uniformsRef.waterMieG.value = self.data.water_mie_g;
      uniformsRef.smallNormalMapStrength.value = self.data.small_normal_map_strength;
      uniformsRef.largeNormalMapStrength.value = self.data.large_normal_map_strength;
      uniformsRef.linearScatteringHeightOffset.value = self.data.linear_scattering_height_offset;
      uniformsRef.linearScatteringTotalScatteringWaveHeight.value = self.data.linear_scattering_total_wave_height;
      uniformsRef.patchDataSize.value = self.data.patch_data_size;
      uniformsRef.chop.value = self.data.chop;
      uniformsRef.ringIndex.value = k;
      //sizeOfOceanPatch stays as base patchSize for consistent world-space normal-map UV scaling
    }
    //Tile geometry spans [0, tileSize]; placing at gx*tileSize centers the 4×4 ring on the camera
    self.oceanPatches.push(new AWater.AOcean.OceanPatch(
      self,
      new THREE.Vector3(gx * tileSize, self.heightOffset, gy * tileSize),
      oceanPatchGeometryInstances[key],
      instanceIterations[key],
      k
    ));
    instanceIterations[key] += 1;
  });

  this.numberOfPatches = this.oceanPatches.length;
  this.numCells = numCells;
  this.ringCount = ringCount;
  this.globalCameraPosition = new THREE.Vector3();

  //Register the horizon skirt as another instance key so the per-frame uniform
  //loop pushes the same FFT-ocean updates into its (cloned) uniforms object.
  //ringIndex was set to 5 at construction and is NOT touched in the per-frame
  //loop, so the skirt keeps its coarse cascade-displacement settings.
  if(this.horizonSkirtMesh){
    const skirtKey = '__horizon_skirt__';
    oceanPatchGeometryInstances[skirtKey] = this.horizonSkirtMesh;
    oceanGridInstanceKeys.push(skirtKey);
  }

  //Console helper — flip the ocean-shadow debug mode on every water tile
  //material at once. Call from the browser console as
  //  setOceanShadowDebug(0|1|2)
  //  0 = normal render, 1 = shadow factor as full-screen grayscale,
  //  2 = cascade-index tint (red C0, green C1, blue C2, yellow C3).
  //Cascade-depth thumbnails and the bottom-corner jacobian/foam panels
  //appear only when mode is non-zero.
  this.setOceanShadowDebug = function(mode){
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.oceanShadowDebugMode.value = mode | 0;
    }
  };
  //Diagnostic toggles — flip the scene-wide sun shadow or the ocean-only
  //CSM on/off across every water tile so we can isolate which one is
  //producing a given visible shadow. Call as setSunShadowEnabled(0) etc.
  //from the browser console.
  this.setSunShadowEnabled = function(enabled){
    const v = enabled ? 1 : 0;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.sunShadowEnabled.value = v;
    }
  };
  this.setOceanShadowEnabled = function(enabled){
    const v = enabled ? 1 : 0;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.oceanShadowEnabled.value = v;
    }
  };
  //Live-tune the receiver-side normal-offset bias from the console. Pushes
  //to every water tile material at once so the change is visible next
  //frame. Pass a value in WORLD METERS — typical range 0.05 to 2.0.
  this.setOceanShadowNormalBias = function(meters){
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.oceanShadowNormalBias.value = +meters;
    }
  };
  //EVSM warp constant. Pushes to BOTH the receiver materials and the
  //caster materials (via the CSM helper). Keep them in sync — caster
  //emits exp(c·z) moments and receiver computes exp(c·refZ); a mismatch
  //makes every comparison nonsense.
  this.setOceanEvsmExpC = function(c){
    const v = +c;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.evsmExpC.value = v;
    }
    if(self.oceanShadowCSM){
      self.oceanShadowCSM.setEvsmExpC(v);
    }
  };
  //EVSM minimum variance floor. Tiny number; raise (e.g. 1e-3) if you
  //see speckle in penumbra; lower (e.g. 1e-5) if shadow gradients feel
  //too soft.
  this.setOceanEvsmMinVariance = function(v){
    const f = +v;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.evsmMinVariance.value = f;
    }
  };
  //EVSM light-bleed reduction threshold in [0, 1). Higher = harder
  //shadows, more contrast; lower = softer with risk of light bleed.
  this.setOceanEvsmLightBleedReduction = function(v){
    const f = +v;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.evsmLightBleedReduction.value = f;
    }
  };
  if(typeof window !== 'undefined'){
    window.setOceanShadowDebug = this.setOceanShadowDebug;
    window.setSunShadowEnabled = this.setSunShadowEnabled;
    window.setOceanShadowEnabled = this.setOceanShadowEnabled;
    window.setOceanShadowNormalBias = this.setOceanShadowNormalBias;
    window.setOceanEvsmExpC = this.setOceanEvsmExpC;
    window.setOceanEvsmMinVariance = this.setOceanEvsmMinVariance;
    window.setOceanEvsmLightBleedReduction = this.setOceanEvsmLightBleedReduction;
  }
  const oceanPatchTranslationMatrices = [];
  for(let i = 0, numOceanPatches = self.oceanPatches.length; i < numOceanPatches; ++i){
    oceanPatchTranslationMatrices.push(new THREE.Matrix4());
  }
  //Snapped camera offset (reused each frame, avoids allocation)
  const ringSnapX = new Float64Array(1);
  const ringSnapZ = new Float64Array(1);
  const directionalLightDirection = new THREE.Vector3();
  this.tick = function(time){
    //Update directional lights list (collect all in scene)
    if(self.directionalLights.length === 0){
      for(let i = 0, numItems = self.scene.children.length; i < numItems; ++i){
        let child = self.scene.children[i];
        if(child.type === 'DirectionalLight'){
          self.directionalLights.push(child);
        }
      }
    }

    //Keep brightestDirectionalLight for backward compatibility
    if(this.brightestDirectionalLight === false && self.directionalLights.length > 0){
      self.brightestDirectionalLight = self.directionalLights[0];
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
    if(self.refractionColorTarget.width !== rendererSize.x || self.refractionColorTarget.height !== rendererSize.y){
      self.refractionColorTarget.setSize(rendererSize.x, rendererSize.y);
      self.refractionColorTarget.depthTexture = new THREE.DepthTexture(
        rendererSize.x, rendererSize.y, THREE.UnsignedIntType
      );
      self.refractionColorTarget.depthTexture.format = THREE.DepthFormat;
    }

    //Update the state of our ocean grid
    self.time = time;

    //Compute a single snapped camera offset shared by all rings.
    //Snapping at ring 0's cell size prevents the mesh from sliding continuously over the
    //displacement field (which would make the wave texture and surface detail drift at
    //different apparent speeds as the camera moves). All rings use the same offset so
    //their shared boundaries stay perfectly aligned — using per-ring granularities would
    //cause gaps since ring k and ring k+1 would snap to different values.
    const snapCellSize = self.patchSize / self.numCells;
    ringSnapX[0] = Math.floor(self.globalCameraPosition.x / snapCellSize) * snapCellSize;
    ringSnapZ[0] = Math.floor(self.globalCameraPosition.z / snapCellSize) * snapCellSize;

    for(let i = 0, numOceanPatches = self.oceanPatches.length; i < numOceanPatches; ++i){
      const oceanPatch = self.oceanPatches[i];
      const xOffset = oceanPatch.initialPosition.x + ringSnapX[0];
      const yOffset = oceanPatch.initialPosition.y;
      const zOffset = oceanPatch.initialPosition.z + ringSnapZ[0];
      const translationMatrix = oceanPatchTranslationMatrices[i];
      translationMatrix.makeTranslation(xOffset, yOffset, zOffset);
      self.oceanPatches[i].instanceMeshRef.setMatrixAt(oceanPatch.instanceID, translationMatrix);
    }

    //Inform the system that we need to update all the instance matrices every frame
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].instanceMatrix.needsUpdate = true;
    }

    //Frustum Cull our grid
    //self.cameraFrustum.setFromProjectionMatrix(self.camera.projectionMatrix.clone().multiply(self.camera.matrixWorldInverse));

    //Hide all of our ocean grid elements
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].visible = false;
    }

    //Render scene to screen-space refraction target (no clip plane - depth comparison in shader)
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
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
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
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
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
      uniformsRef.ssrViewMatrix.value.copy(sceneCamera.matrixWorldInverse);
      uniformsRef.ssrProjectionMatrix.value.copy(sceneCamera.projectionMatrix);
      //Metering survey: a-starry-sky 64x64 fisheye sky texture. World-space XZ maps
      //directly to UV, giving smooth, noise-free sky color for SSR fallback.
      if(self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.meteringSurveyRenderer){
        const msr = self.skyDirector.renderers.meteringSurveyRenderer;
        const meterTex = msr.meteringSurveyRenderer.getCurrentRenderTarget(msr.meteringSurveyVar).texture;
        //Enable linear filtering for smooth sky gradients (default is NearestFilter
        //which causes visible banding). Requires OES_texture_float_linear (WebGL2 / most devices).
        if(meterTex.magFilter !== THREE.LinearFilter){
          meterTex.minFilter = THREE.LinearFilter;
          meterTex.magFilter = THREE.LinearFilter;
          meterTex.needsUpdate = true;
        }
        uniformsRef.meteringSurveyTexture.value = meterTex;
      }
      uniformsRef.smallNormalMap.value = self.smallNormalMap;
      uniformsRef.largeNormalMap.value = self.largeNormalMap;
      uniformsRef.causticMap.value = self.causticMap;
      uniformsRef.causticIntensityMultiplier.value = self.causticsStrength;
      uniformsRef.foamStartLevel.value = self.foamStart;
      uniformsRef.foamDiffuseMap.value = self.foamColorMap;
      uniformsRef.foamOpacityMap.value = self.foamOpacityMap;
      uniformsRef.foamNormalMap.value = self.foamNormalMap;
      uniformsRef.foamRenderMap.value = self.foamRenderMap;
      uniformsRef.exclusionMap.value = self.exclusionMap;
      uniformsRef.baseHeightOffset.value = self.heightOffset;

      // Update all directional lights for ambient scattering
      if(self.directionalLights.length > 0){
        // Keep main light for backward compat
        const mainLight = self.directionalLights[0];
        const intensity = mainLight.intensity;
        const color = mainLight.color;
        uniformsRef.brightestDirectionalLight.value.set(color.r * intensity, color.g * intensity, color.b * intensity);
        directionalLightDirection.set(mainLight.position.x, mainLight.position.y, mainLight.position.z);
        directionalLightDirection.sub(mainLight.target.position).negate().normalize();
        uniformsRef.brightestDirectionalLightDirection.value.set(directionalLightDirection.x, directionalLightDirection.y, directionalLightDirection.z);

        //Wire sun shadow-map receive. Enabled only when the main light actually
        //casts and its shadow map has been rendered at least once (shadow.map
        //is null until the renderer runs the shadow pass).
        if(mainLight.castShadow && mainLight.shadow && mainLight.shadow.map){
          uniformsRef.sunShadowEnabled.value = 1;
          uniformsRef.sunShadowMap.value = mainLight.shadow.map.texture;
          uniformsRef.sunShadowMatrix.value.copy(mainLight.shadow.matrix);
          uniformsRef.sunShadowMapSize.value.set(mainLight.shadow.mapSize.x, mainLight.shadow.mapSize.y);
          uniformsRef.sunShadowRadius.value = mainLight.shadow.radius;
          uniformsRef.sunShadowBias.value = mainLight.shadow.bias - 0.003;
        } else {
          uniformsRef.sunShadowEnabled.value = 0;
        }

        // Pass all lights as arrays
        const lightCount = Math.min(self.directionalLights.length, 8); // Cap at 8 lights for perf
        if(uniformsRef.ambientLightColors && uniformsRef.ambientLightDirections && uniformsRef.ambientLightCount){
          uniformsRef.ambientLightCount.value = lightCount;
          for(let l = 0; l < lightCount; ++l){
            const light = self.directionalLights[l];
            const lIntensity = light.intensity;
            const lColor = light.color;
            uniformsRef.ambientLightColors.value[l].set(lColor.r * lIntensity, lColor.g * lIntensity, lColor.b * lIntensity);

            directionalLightDirection.set(light.position.x, light.position.y, light.position.z);
            directionalLightDirection.sub(light.target.position).negate().normalize();
            uniformsRef.ambientLightDirections.value[l].set(directionalLightDirection.x, directionalLightDirection.y, directionalLightDirection.z);
          }
        }
      }
      else{
        uniformsRef.brightestDirectionalLight.value.set(1.0,1.0,1.0);
      }
      uniformsRef.t.value = time * 0.001;

      //Sky ambient color from a-starry-sky's y-axis hemisphere light (pointing straight up).
      //This is view-independent and color-correct at all times of day.
      if(self.skyDirector && self.skyDirector.lightingManager){
        const yLight = self.skyDirector.lightingManager.yAxisHemisphericalLight;
        const skyIntensity = yLight.intensity;
        uniformsRef.skyAmbientColor.value.set(
          yLight.color.r * skyIntensity,
          yLight.color.g * skyIntensity,
          yLight.color.b * skyIntensity
        );
      }

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
            //Pre-build the skirt's vertex shader by re-applying the same final
            //gl_Position substitution we did at construction — keeps the z-clamp
            //alive across the AP recompile.
            const skirtVtxSrc = newVtxSrc.replace(
              'gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);',
              'vec4 _skirtClipPos = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0); _skirtClipPos.z = _skirtClipPos.w * 0.99999; gl_Position = _skirtClipPos;'
            );
            for(let j = 0; j < oceanGridInstanceKeys.length; ++j){
              const mesh = oceanPatchGeometryInstances[oceanGridInstanceKeys[j]];
              const isSkirt = (mesh === self.horizonSkirtMesh);
              mesh.material.vertexShader = isSkirt ? skirtVtxSrc : newVtxSrc;
              mesh.material.fragmentShader = newFragShader;
              mesh.material.fog = false;
              mesh.material.needsUpdate = true;
            }
            //Also update the source material for any future clones
            self.oceanMaterial.vertexShader = newVtxSrc;
            self.oceanMaterial.fragmentShader = newFragShader;
            self.oceanMaterial.fog = false;
            self.oceanMaterial.needsUpdate = true;
            //Stop the sky dome from writing depth so the skirt (renderOrder 1)
            //can pass its depth test against dome pixels and overdraw the
            //dome's lower hemisphere. The dome itself does not need its own
            //depth in the buffer (single mesh, sky-radiance-only shader);
            //sun/moon meshes depth-test against the unwritten far depth.
            const atmRenderer = self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.atmosphereRenderer;
            if(atmRenderer && atmRenderer.skyMesh && atmRenderer.skyMesh.material){
              atmRenderer.skyMesh.material.depthWrite = false;
            }
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

    //Horizon skirt follows the camera in XZ; it stays at y=0 (water plane).
    //All uniform updates happen via the per-instance loop above — the skirt
    //is registered in oceanGridInstanceKeys so it gets the same FFT cascade
    //textures, light state, atm LUTs, etc. that real ocean tiles get.
    if(self.horizonSkirtMesh){
      self.horizonSkirtMesh.position.set(sceneCamera.position.x, 0.0, sceneCamera.position.z);
    }

    //Ocean-only CSM pass. Runs after every ocean material has had its cascade
    //textures/uniforms refreshed for this frame, so the shadow material picks
    //up the current FFT state by reference. Then we push the resulting depth
    //texture + shadow matrix back to each water material.
    if(self.oceanShadowCSM && self.directionalLights.length > 0 && oceanGridInstanceKeys.length > 0){
      const mainLight = self.directionalLights[0];
      directionalLightDirection.set(mainLight.position.x, mainLight.position.y, mainLight.position.z);
      directionalLightDirection.sub(mainLight.target.position).negate().normalize();
      const firstMeshUniforms = oceanPatchGeometryInstances[oceanGridInstanceKeys[0]].material.uniforms;
      self.oceanShadowCSM.render(self.renderer, sceneCamera, directionalLightDirection, firstMeshUniforms);

      //Sun below horizon → CSM.render() early-exits; disable the sampler so
      //the water shader doesn't read stale maps.
      const sunBelowHorizon = -directionalLightDirection.y <= 0.0;
      const cascades = self.oceanShadowCSM.cascades;
      const numCascades = self.oceanShadowCSM.numCascades;
      for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
        const u = oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms;
        if(sunBelowHorizon){
          u.oceanShadowEnabled.value = 0;
          continue;
        }
        u.oceanShadowEnabled.value = 1;
        //Push every cascade's moment texture (RGBA32F, post-blur), shadow
        //matrix, and map size. Matrices live as separate uniform names
        //(oceanShadowMatrix0..3) and must be projected per-vertex;
        //texture/mapSize are arrays sampled in the fragment cascade walk.
        for(let c = 0; c < numCascades; c++){
          u.oceanShadowMap.value[c] = cascades[c].renderTarget.texture;
          u.oceanShadowMapSize.value[c].set(cascades[c].cfg.mapSize, cascades[c].cfg.mapSize);
        }
        u.oceanShadowMatrix0.value.copy(cascades[0].shadowMatrix);
        u.oceanShadowMatrix1.value.copy(cascades[1].shadowMatrix);
        u.oceanShadowMatrix2.value.copy(cascades[2].shadowMatrix);
        u.oceanShadowMatrix3.value.copy(cascades[3].shadowMatrix);
      }
    }
  };
}
