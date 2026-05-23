//Jerlov ocean water type presets (Jerlov 1968, 1976). Each row is
//{ absorption, scattering } in m^-1 at RGB sampling wavelengths (~615/540/465 nm).
//Index 0 is null — selects "custom" mode (use explicit water_absorption /
//water_scattering attributes). Indices 1..7 walk the Jerlov classification
//from clearest open ocean to turbid coastal water; resulting body-color
//albedo (b/(a+b)) shifts saturated-blue → blue-green → teal → green-grey
//as the type number rises, matching real ocean photography.
//
//   1 — Jerlov I:     open ocean, clearest, deep indigo/cobalt
//   2 — Jerlov IB:    clear open ocean, slightly less saturated
//   3 — Jerlov II:    typical open ocean, blue with hint of green
//   4 — Jerlov III:   Mediterranean-style blue-teal
//   5 — Coastal 1C:   clear coastal, turquoise/teal
//   6 — Coastal 3C:   green coastal
//   7 — Coastal 5C:   turbid green-grey
//
//Pope & Fry 1997 pure-water absorption sits just under Type 1. If the rendered
//water reads "too cobalt," step up the type number — higher types add CDOM /
//particulate scattering that lifts the green channel and desaturates the blue.
AWater.AOcean.JERLOV_PRESETS = [
  null,
  { absorption: {x: 0.279, y: 0.061, z: 0.015}, scattering: {x: 0.001, y: 0.002, z: 0.003} }, // I
  { absorption: {x: 0.284, y: 0.074, z: 0.025}, scattering: {x: 0.003, y: 0.004, z: 0.005} }, // IB
  { absorption: {x: 0.286, y: 0.078, z: 0.050}, scattering: {x: 0.005, y: 0.006, z: 0.008} }, // II
  { absorption: {x: 0.291, y: 0.099, z: 0.090}, scattering: {x: 0.010, y: 0.012, z: 0.015} }, // III
  { absorption: {x: 0.330, y: 0.135, z: 0.155}, scattering: {x: 0.030, y: 0.035, z: 0.040} }, // 1C
  { absorption: {x: 0.370, y: 0.190, z: 0.275}, scattering: {x: 0.050, y: 0.060, z: 0.060} }, // 3C
  { absorption: {x: 0.520, y: 0.330, z: 0.530}, scattering: {x: 0.080, y: 0.090, z: 0.090} }, // 5C
];

//Dedicated layer for ocean geometry (water patches + horizon skirt).
//
//Water meshes are taken OFF the default layer 0 and placed on this layer
//instead so that:
//  - the foam ortho camera (default layer 0) does not capture the water
//    surface itself — its position-pass output is meant to be terrain Y for
//    shore-foam height comparison, and capturing water mesh baseline Y
//    instead produced false shore-foam across the entire open ocean.
//  - the per-cascade ocean-CSM light cameras already use their own layers
//    (7..10, set by ocean-shadow-csm.js:addCaster) and are unaffected.
//  - any future cameras (or third-party scene cameras) that want to see the
//    ocean must `camera.layers.enable(AWater.AOcean.OCEAN_LAYER)` —
//    likewise any future ocean-class meshes (extra water bodies, foam
//    decals, etc.) should call `mesh.layers.set(AWater.AOcean.OCEAN_LAYER)`.
//  - cameras that should NOT see water (foam capture, exclusion capture)
//    intentionally do nothing — staying on layer 0 keeps them ignorant of
//    ocean geometry by design.
//
//Picked 29 because the exclusion camera already uses 30; keeping them
//adjacent makes the "ocean-system reserved layers" cluster obvious.
AWater.AOcean.OCEAN_LAYER = 29;

AWater.AOcean.OceanGrid = function(scene, renderer, camera, parentComponent){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  const data = parentComponent.data;
  this.parentComponent = parentComponent;
  this.renderer = renderer;
  this.camera = camera;
  //Main scene camera needs to see the ocean even though water meshes have
  //been moved off layer 0 — see OCEAN_LAYER comment above.
  this.camera.layers.enable(AWater.AOcean.OCEAN_LAYER);
  this.oceanPatches = [];
  this.oceanPatchIsInFrustrum = [];
  this.drawDistance = data.draw_distance;
  this.patchSize = data.patch_size;
  this.dataPatchSize = data.patch_size;
  this.heightOffset = data.height_offset;
  this.causticsEnabled = data.caustics_enabled;
  this.causticsStrength = data.caustics_strength;
  this.reflectionScale = data.reflection_scale;
  this.reflectionDistanceFalloff = data.reflection_distance_falloff;
  this.fresnelDistanceRoughness = data.fresnel_distance_roughness;
  this.surfaceRoughness = 0.08;
  this.foamEnabled = data.foam_enabled;
  this.foamStart = data.foam_start;
  //Live-tunable broadband foam parameters. Plain JS fields per the
  //feedback_aframe_live_uniforms convention — pushed to the broadband pack
  //material every frame so DevTools / external scripts can hot-tune them
  //(setFoamCoverage etc. console hooks are valid follow-ups).
  this.foamCoverage = data.foam_coverage;
  this.foamFadeRate = data.foam_fade_rate;
  this.foamStrength = data.foam_strength;
  this.foamAdvectionScale = data.foam_advection_scale;
  this.data = data;
  this.time = 0.0;
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
  //Foam-texture scroll velocity: wind-relative, ~20° off wind axis at 4% of
  //wind speed. Slow drift so the foam-bubble texture doesn't read as racing
  //across the surface.
  const windAngle = Math.atan2(this.windVelocity.y, this.windVelocity.x);
  const windSpeed = Math.sqrt(this.windVelocity.x ** 2 + this.windVelocity.y ** 2);
  const foamScrollSpeed = windSpeed * 0.04;
  this.foamScrollVelocityVec = [
    foamScrollSpeed * Math.cos(windAngle + 0.34),
    foamScrollSpeed * Math.sin(windAngle + 0.34),
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

  const textureLoader = new THREE.TextureLoader();

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

  //Set up screen-space G-buffer for refraction pass. Three attachments:
  //  0: albedo + opaque-mask in .a   (stub-grey for now; per-mesh in A1)
  //  1: world-space normal in .rgb
  //  2: linear view-space depth in .r (replaces the old separate linearize pass)
  //A WebGL2 MRT — the scene is rendered once via scene.overrideMaterial below,
  //and the water shader later samples albedo + normal to relight the seabed
  //inside the body-color path (Step 5 of docs/water-review/SUMMARY.txt).
  this.refractionGBufferTarget = new THREE.WebGLRenderTarget(
    rendererSize.x, rendererSize.y,
    {
      count: 3,
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
  this.refractionGBufferTarget.depthTexture.format = THREE.DepthFormat;

  //── Underwater planar reflection ─────────────────────────────────────────
  //The TIR "mirror" the underwater ceiling samples outside Snell's window —
  //the underwater scene rendered each submerged frame from a virtual camera
  //mirrored across the rest water plane. Half-resolution: the sample is
  //wave-distorted and fogged so it needs no crispness, and the whole pass is
  //skipped entirely above water. HalfFloat so un-tone-mapped (linear) scene
  //radiance is not clamped at 1.
  this.reflectionResolutionScale = 0.5;
  this._reflectionTarget = new THREE.WebGLRenderTarget(
    Math.max(1, (rendererSize.x * this.reflectionResolutionScale) | 0),
    Math.max(1, (rendererSize.y * this.reflectionResolutionScale) | 0),
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType
    }
  );
  this._reflectionCamera = new THREE.PerspectiveCamera();
  this._reflectionTextureMatrix = new THREE.Matrix4();

  //── Underwater caustic projection ────────────────────────────────────────
  //The water shader paints caustics onto the refracted seabed when the camera
  //is ABOVE water; submerged, the seabed is seen directly and never passes
  //through the water shader. To put caustics on it without touching the (often
  //imported, unknown) seabed materials, project them with a SpotLight cookie —
  //the one THREE light type whose `.map` is cast onto whatever it lights, on
  //any material, no shader surgery. SpotLight.map projects a single "slide"
  //across the cone and ignores texture repeat/offset, so the tiling AND the
  //animation are baked into the slide here: a small RT re-rendered each
  //submerged frame. The slide is periodic across [0,1] (integer tiling), and
  //the projector XZ is snapped to one tile, so the cast pattern is world-
  //stable as the camera swims (the foam-camera texel-snap trick).
  this.causticProjectionResolution = 2048;
  this.causticProjectionTiling = 48;      //caustic-map repeats across the slide (integer!)
  this.causticLightHeight = 400.0;        //metres the projector sits above the surface
  this.causticLightConeRadius = 115.0;    //ground radius the cone covers
  this.causticLightIntensity = 6.0;       //MAIN KNOB — caustic brightness on the seabed
  this._causticProjectionTarget = new THREE.WebGLRenderTarget(
    this.causticProjectionResolution, this.causticProjectionResolution,
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    }
  );
  this._causticProjectionScene = new THREE.Scene();
  this._causticProjectionCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._causticProjectionMaterial = new THREE.ShaderMaterial({
    uniforms: {
      causticMap: {value: null},
      uTime: {value: 0.0},
      uTiling: {value: this.causticProjectionTiling}
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){',
      '  vUv = uv;',
      '  gl_Position = vec4(position.xy, 0.0, 1.0);',
      '}'
    ].join('\n'),
    //Mirrors causticShader() in water-shader.glsl: two non-parallel scrolling
    //samples min'd together, then a smoothstep contrast curve. Integer uTiling
    //keeps the slide seamless across [0,1] so it tiles on the snap grid. The
    //three chromatically-offset taps give caustic light its R/B dispersion —
    //the foci of different wavelengths land slightly apart (matches the
    //+/-0.005 caustic-UV offset the water shader's causticShader uses).
    fragmentShader: [
      'uniform sampler2D causticMap;',
      'uniform float uTime;',
      'uniform float uTiling;',
      'varying vec2 vUv;',
      'float caustic(vec2 uv, float t){',
      '  vec2 uv1 = uv + vec2(0.8, 0.1) * t;',
      '  vec2 uv2 = uv - vec2(0.2, 0.7) * t;',
      '  float a = texture2D(causticMap, uv1).r;',
      '  float b = texture2D(causticMap, uv2).g;',
      '  return smoothstep(0.15, 0.85, min(a, b));',
      '}',
      'void main(){',
      '  vec2 uv = vUv * uTiling;',
      '  float t = uTime / 8.0;',
      '  float r = caustic(uv + vec2(0.005), t);',
      '  float g = caustic(uv,               t);',
      '  float b = caustic(uv - vec2(0.005), t);',
      '  gl_FragColor = vec4(r, g, b, 1.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  this._causticProjectionScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 2.0), this._causticProjectionMaterial
  ));

  //The projector. decay 0 + distance 0 → an even, slide-projector cast (not a
  //physical inverse-square point light). castShadow stays off — the scene sun
  //already shadows the seabed, and SpotLight.map updates its projection matrix
  //on its own (WebGLLights calls shadow.updateMatrices when a map is present).
  //Kept permanently in the scene with intensity driven to 0 above water:
  //toggling light.visible would change the visible-light count and recompile
  //every lit material on each waterline crossing.
  this.causticSpotLight = new THREE.SpotLight(0xffffff, 0.0);
  this.causticSpotLight.decay = 0.0;
  this.causticSpotLight.distance = 0.0;
  this.causticSpotLight.penumbra = 0.8;
  this.causticSpotLight.angle = Math.atan(this.causticLightConeRadius / this.causticLightHeight);
  this.causticSpotLight.castShadow = false;
  this.causticSpotLight.map = this._causticProjectionTarget.texture;
  this._causticLightAdded = false;

  //── Underwater fog (via A-Starry-Sky's fog reservation hook) ──────────────
  //Geometry seen DIRECTLY underwater (the seabed) is drawn by its own
  //materials and never touches the water shader. A-Starry-Sky's `advanced`
  //atmospheric perspective globally patches THREE.ShaderChunk.fog_* and leaves
  //an empty reserved branch keyed on `fogNear < 0.0`; _injectUnderwaterFogChunk()
  //below fills that slot with a per-channel Beer-Lambert absorption fog. At
  //runtime scene.fog is swapped between A-Starry-Sky's atmospheric fog (above
  //water) and our own THREE.Fog (underwater), which smuggles the water params:
  //  fog.color = per-channel extinction, fog.near = -waterSurfaceY (negative
  //  selects the ocean branch AND carries the waterline for the world-Y gate),
  //  fog.far = murk brightness.
  this.underwaterFogColor = new THREE.Color(0.12, 0.24, 0.27);   //sky-dome bg swap colour
  this.underwaterFogExtinction = new THREE.Vector3(0.305, 0.062, 0.015); //absorption+scattering, 1/m
  this.underwaterFogBrightness = 0.18;         //inscatter murk brightness (deep-water dark)
  this._oceanFog = new THREE.Fog(0x1a2d33, -1.0, 1.0);  //near<0 + far>0 => ocean branch
  this._capturedSkyFog = undefined;            //A-Starry-Sky's fog, tracked while above water
  this._fogChunkInjected = false;

  //G-buffer override material — one per source material, built on demand.
  //Writes linear albedo (baseColor × decoded albedoMap) + geometric world-
  //space normal + linear view-space depth. Per-mesh material swap in tick()
  //below picks the right variant for each mesh before the refraction render.
  //
  //Fallback texture for materials without a .map — sampling a null sampler
  //is undefined; bind a 1×1 white pixel and gate via hasAlbedoMap uniform.
  const whiteData = new Uint8Array([255, 255, 255, 255]);
  this._gBufferWhitePixel = new THREE.DataTexture(whiteData, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  this._gBufferWhitePixel.needsUpdate = true;

  const gBufferVertexShader = [
    'out vec3 vWorldNormal;',
    'out float vViewZ;',
    'out vec2 vUv;',
    'void main(){',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  vViewZ = -mvPosition.z;',
    '  vWorldNormal = normalize(mat3(modelMatrix) * normal);',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '}'
  ].join('\n');

  //Albedo path stores LINEAR values into the HalfFloat target. Source albedo
  //maps from GLTF (the island model) are sRGB-encoded, so decode here once.
  //Material.color values are already linear (THREE.Color stores linear).
  const gBufferFragmentShader = [
    'precision highp float;',
    'layout(location = 0) out vec4 gAlbedo;',
    'layout(location = 1) out vec4 gNormal;',
    'layout(location = 2) out vec4 gLinearDepth;',
    'in vec3 vWorldNormal;',
    'in float vViewZ;',
    'in vec2 vUv;',
    'uniform vec3 baseColor;',
    'uniform sampler2D albedoMap;',
    'uniform int hasAlbedoMap;',
    'vec3 srgbToLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }',
    'void main(){',
    '  vec3 albedo = baseColor;',
    '  if(hasAlbedoMap == 1){',
    '    vec3 texel = texture(albedoMap, vUv).rgb;',
    '    albedo *= srgbToLinear(texel);',
    '  }',
    '  gAlbedo = vec4(albedo, 1.0);',
    '  gNormal = vec4(normalize(vWorldNormal), 1.0);',
    '  gLinearDepth = vec4(vViewZ, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  //Cache keyed by source-material UUID; built lazily on first sight.
  this._gBufferMaterialCache = new Map();
  this._swappedMeshes = [];

  const grid = this;
  this._buildGBufferMaterialFor = function(srcMat){
    const hasMap = !!(srcMat.map && srcMat.map.isTexture);
    const fallbackColor = new THREE.Color(0.5, 0.42, 0.32);
    const baseColorRef = (srcMat.color && srcMat.color.isColor) ? srcMat.color : fallbackColor;
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        baseColor: { value: baseColorRef },
        albedoMap: { value: hasMap ? srcMat.map : grid._gBufferWhitePixel },
        hasAlbedoMap: { value: hasMap ? 1 : 0 }
      },
      vertexShader: gBufferVertexShader,
      fragmentShader: gBufferFragmentShader,
      side: srcMat.side !== undefined ? srcMat.side : THREE.FrontSide
    });
  };

  this._resolveGBufferMaterial = function(srcMat){
    if(Array.isArray(srcMat)){
      const arr = new Array(srcMat.length);
      for(let i = 0; i < srcMat.length; ++i){
        arr[i] = grid._resolveGBufferMaterial(srcMat[i]);
      }
      return arr;
    }
    let cached = grid._gBufferMaterialCache.get(srcMat.uuid);
    if(!cached){
      cached = grid._buildGBufferMaterialFor(srcMat);
      grid._gBufferMaterialCache.set(srcMat.uuid, cached);
    }
    return cached;
  };

  //Set up depth camera pointing down for edge foam
  this.foamRenderTarget = new THREE.WebGLRenderTarget(4096, 4096, {
    type: THREE.FloatType
  });
  this.foamCameraHeight = data.foam_camera_height;
  this.foamCamera = new THREE.OrthographicCamera(-2048.0, 2048.0, 2048.0, -2048.0, 0.1, this.foamCameraHeight + 500.0);
  this.scene.add(this.foamCamera);

  //Set up a depth camera pointing down for ocean exclusion mapping.
  //Unlike foamCamera this is NOT a terrain-height capture — it renders only
  //layer-30 meshes (boat interior hulls and similar volumes that need water
  //masked inside them). One small mesh near the camera, so the render
  //target is sized to that scope: 500 m × 500 m at 1024² ≈ 0.49 m/texel.
  //The previous 4096² × 2048 m × 2048 m sizing was a 256 MB FloatType
  //buffer to mask a single boat — pure VRAM waste.
  //
  //Keep the shader's exclusion-sample radius (water-shader.glsl, divide-by
  //in vec2(...)) in sync with this ortho extent's half-width.
  this.exclusionRenderTarget = new THREE.WebGLRenderTarget(1024, 1024, {
    type: THREE.FloatType
  });
  this.exclusionCamera = new THREE.OrthographicCamera(-250.0, 250.0, 250.0, -250.0, 0.1, this.foamCameraHeight + 500.0);
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
  //Vertex shader takes two template flags: $atmospheric_perspective_enabled
  //and $horizon_skirt. Ocean tiles use the {AP, no-skirt} variant; the
  //horizon skirt clones the material and uses the {AP, skirt} variant
  //which pins gl_Position.z just inside the far plane.
  function buildVertexShader(atmEnabled, skirt){
    return AWater.AOcean.Materials.Ocean.waterMaterial.vertexShader
      .replace(/\$atmospheric_perspective_enabled/g, atmEnabled ? '1' : '0')
      .replace(/\$horizon_skirt/g, skirt ? '1' : '0');
  }
  const vertexShaderSource = buildVertexShader(atmosphereReady, false);
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
    //Rebuild the vertex shader with the $horizon_skirt template flag set so
    //the rim verts (well past camera.far) survive frustum clipping via the
    //in-shader Z clamp. See water-vertex.glsl tail.
    skirtMaterial.vertexShader = buildVertexShader(atmosphereReady, true);
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
    //Horizon skirt is water-class geometry — move off the default layer so
    //the foam ortho camera does not capture it. See OCEAN_LAYER comment.
    this.horizonSkirtMesh.layers.set(AWater.AOcean.OCEAN_LAYER);
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
      //Move ocean patch off the default layer onto OCEAN_LAYER. Must happen
      //after addCaster, which enables the per-cascade caster layers (7..10);
      //we keep those, only swap default 0 → OCEAN_LAYER.
      mesh.layers.disable(0);
      mesh.layers.enable(AWater.AOcean.OCEAN_LAYER);

      const uniformsRef = mesh.material.uniforms;
      uniformsRef.foamScrollVelocity.value.set(self.foamScrollVelocityVec[0], self.foamScrollVelocityVec[1]);
      //Jerlov preset wins over the explicit RGB vec3s when water_type is in
      //range (1..N). water_type == 0 ⇒ fall through to the custom values.
      const jerlovPreset = AWater.AOcean.JERLOV_PRESETS[self.data.water_type | 0];
      if(jerlovPreset){
        uniformsRef.waterAbsorption.value.copy(jerlovPreset.absorption);
        uniformsRef.waterScattering.value.copy(jerlovPreset.scattering);
      } else {
        uniformsRef.waterAbsorption.value.copy(self.data.water_absorption);
        uniformsRef.waterScattering.value.copy(self.data.water_scattering);
      }
      uniformsRef.reflectionScale.value = self.reflectionScale;
      uniformsRef.reflectionDistanceFalloff.value = self.reflectionDistanceFalloff;
      uniformsRef.fresnelDistanceRoughness.value = self.fresnelDistanceRoughness;
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
  //Override flags so the per-frame tick can't trample the console toggle.
  //null = follow the normal per-frame logic (sun-below-horizon etc).
  //true/false = force the uniform to that state every frame.
  this._sunShadowOverride = null;
  this._oceanShadowOverride = null;
  //Additive offset on top of mainLight.shadow.bias when pushed to the water
  //shader. Sourced from the HTML attribute `sun_shadow_bias` (default
  //-0.0012, see ocean-state.js for full rationale). Positive → more
  //shadowed; negative → less shadowed. Use setSunShadowBias(x) from the
  //console for live tuning.
  this._sunShadowBiasOffset = (data && typeof data.sun_shadow_bias === 'number')
    ? data.sun_shadow_bias : -0.0012;
  this.setSunShadowBias = function(offset){
    self._sunShadowBiasOffset = +offset || 0.0;
  };
  this.setSunShadowEnabled = function(enabled){
    self._sunShadowOverride = enabled === null || enabled === undefined ? null : !!enabled;
    const v = self._sunShadowOverride === false ? 0 : 1;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.sunShadowEnabled.value = v;
    }
  };
  this.setOceanShadowEnabled = function(enabled){
    self._oceanShadowOverride = enabled === null || enabled === undefined ? null : !!enabled;
    const v = self._oceanShadowOverride === false ? 0 : 1;
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
  this.setReflectionScale = function(v){
    self.reflectionScale = +v;
  };
  this.setReflectionDistanceFalloff = function(v){
    self.reflectionDistanceFalloff = +v;
  };
  this.setFresnelDistanceRoughness = function(v){
    self.fresnelDistanceRoughness = +v;
  };
  this.setSurfaceRoughness = function(v){
    self.surfaceRoughness = +v;
  };
  //Live-tune atmospheric perspective strength. Default 1.0. Set to 0.0 to
  //fully bypass extinction + inscatter on the water surface (the per-frame
  //tick will still overwrite at the next ocean-grid update unless we keep
  //it in sync — that's why we also mirror onto the cached field).
  this.setAtmDistanceScale = function(v){
    self.atmosphericPerspectiveDistanceScale = +v;
  };
  //Render every ocean tile (FFT tiles + horizon skirt) as wireframe so the
  //clipmap cell structure and per-ring tessellation density are visible.
  //ShaderMaterial honours `wireframe` natively — no shader recompile needed.
  //Call from the console: setOceanWireframe(1) on, setOceanWireframe(0) off.
  this.setOceanWireframe = function(enabled){
    const flag = !!enabled;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.wireframe = flag;
    }
  };
  //Toggle THREE.CameraHelper wireframes for every shadow camera in play so
  //you can SEE the frustums in 3D — way more useful than reading dimensions
  //out of a dump. White = scene sun shadow (Three.js DirectionalLight), and
  //C0..C3 (ocean CSM) get red/orange/yellow/green for fine→coarse. Helpers
  //are added directly to the scene; update() is called per-frame from tick.
  //Call as setShadowHelpers(1) / setShadowHelpers(0).
  this._shadowHelpers = null;
  this.setShadowHelpers = function(enabled){
    const on = !!enabled;
    if(!on){
      if(self._shadowHelpers){
        for(let i = 0; i < self._shadowHelpers.length; i++){
          self.scene.remove(self._shadowHelpers[i]);
          self._shadowHelpers[i].dispose && self._shadowHelpers[i].dispose();
        }
        self._shadowHelpers = null;
      }
      return;
    }
    if(self._shadowHelpers) return;
    self._shadowHelpers = [];
    const colors = [0xff4040, 0xff9020, 0xffe040, 0x40e060]; //C0..C3 fine→coarse
    //THREE.CameraHelper uses vertex colours, so setting .material.color does
    //nothing visible — the default rainbow palette (yellow/magenta/red/green)
    //comes from the BufferGeometry's color attribute. Use setColors() to
    //override all five segments to a single solid colour so each helper is
    //distinguishable by its own colour rather than all wearing the rainbow.
    const tintHelper = function(helper, hex){
      const c = new THREE.Color(hex);
      if(typeof helper.setColors === 'function'){
        helper.setColors(c, c, c, c, c);
      } else {
        //Fallback for older Three.js without setColors: paint the color
        //attribute directly. Three colours per line segment vertex.
        const attr = helper.geometry && helper.geometry.attributes.color;
        if(attr){
          for(let i = 0; i < attr.count; i++){
            attr.setXYZ(i, c.r, c.g, c.b);
          }
          attr.needsUpdate = true;
        }
      }
      helper.material.depthTest = false;
      helper.material.toneMapped = false;
      helper.renderOrder = 999;
    };
    //Scene sun shadow camera (the one that gates lighthouse/terrain shadows).
    const light = self.brightestDirectionalLight;
    if(light && light.shadow && light.shadow.camera){
      const h = new THREE.CameraHelper(light.shadow.camera);
      tintHelper(h, 0xffffff);
      self.scene.add(h);
      self._shadowHelpers.push(h);
    }
    //Ocean CSM cascades.
    if(self.oceanShadowCSM && self.oceanShadowCSM.cascades){
      const cs = self.oceanShadowCSM.cascades;
      for(let i = 0; i < cs.length; i++){
        const h = new THREE.CameraHelper(cs[i].lightCamera);
        tintHelper(h, colors[i] || 0xffffff);
        self.scene.add(h);
        self._shadowHelpers.push(h);
      }
    }
  };

  //Dump the scene-wide directional-light shadow camera + the ocean CSM
  //cascades. Use this when terrain-on-water shadows clip at a moving line:
  //the scene shadow's ortho frustum is what gates non-ocean casters
  //(lighthouse, trees, rocks). Increase `sky-shadow-camera-size` in the
  //host scene if the printed footprint is smaller than the visible water.
  this.dumpShadowRanges = function(){
    const light = self.brightestDirectionalLight;
    if(light && light.shadow && light.shadow.camera){
      const sc = light.shadow.camera;
      const w = (sc.right - sc.left);
      const h = (sc.top - sc.bottom);
      const target = light.target ? light.target.position : null;
      console.log('[scene sun shadow]',
        'extent', w.toFixed(1), 'x', h.toFixed(1), 'm',
        'near/far', sc.near.toFixed(1), '/', sc.far.toFixed(1),
        'light pos', light.position.toArray().map(function(v){return v.toFixed(1);}).join(', '),
        'target', target ? target.toArray().map(function(v){return v.toFixed(1);}).join(', ') : 'none',
        'map', light.shadow.mapSize.x + 'x' + light.shadow.mapSize.y,
        '→ texel', (w / light.shadow.mapSize.x * 100).toFixed(1) + ' cm');
    } else {
      console.log('[scene sun shadow] no light/shadow camera registered');
    }
    if(self.oceanShadowCSM && self.oceanShadowCSM.cascades){
      const cs = self.oceanShadowCSM.cascades;
      for(let i = 0; i < cs.length; i++){
        const cfg = cs[i].cfg;
        console.log('[ocean CSM C' + i + ']',
          'extent', cfg.extent.toFixed(1), 'm',
          'depthRange', cs[i].depthRange.toFixed(1), 'm',
          'map', cfg.mapSize + 'x' + cfg.mapSize,
          '→ texel', (cfg.extent / cfg.mapSize * 100).toFixed(1) + ' cm',
          'layer', cfg.layer, 'maxRing', cfg.maxRing);
      }
    }
  };
  if(typeof window !== 'undefined'){
    window.dumpShadowRanges = this.dumpShadowRanges;
    window.setShadowHelpers = this.setShadowHelpers;
    window.setSunShadowBias = this.setSunShadowBias;
    window.setOceanShadowDebug = this.setOceanShadowDebug;
    window.setSunShadowEnabled = this.setSunShadowEnabled;
    window.setOceanShadowEnabled = this.setOceanShadowEnabled;
    window.setOceanShadowNormalBias = this.setOceanShadowNormalBias;
    window.setOceanEvsmExpC = this.setOceanEvsmExpC;
    window.setOceanEvsmMinVariance = this.setOceanEvsmMinVariance;
    window.setOceanEvsmLightBleedReduction = this.setOceanEvsmLightBleedReduction;
    window.setReflectionScale = this.setReflectionScale;
    window.setReflectionDistanceFalloff = this.setReflectionDistanceFalloff;
    window.setFresnelDistanceRoughness = this.setFresnelDistanceRoughness;
    window.setSurfaceRoughness = this.setSurfaceRoughness;
    window.setOceanWireframe = this.setOceanWireframe;
    window.setAtmDistanceScale = this.setAtmDistanceScale;
  }
  const oceanPatchTranslationMatrices = [];
  for(let i = 0, numOceanPatches = self.oceanPatches.length; i < numOceanPatches; ++i){
    oceanPatchTranslationMatrices.push(new THREE.Matrix4());
  }
  //Snapped camera offset (reused each frame, avoids allocation)
  const ringSnapX = new Float64Array(1);
  const ringSnapZ = new Float64Array(1);
  const directionalLightDirection = new THREE.Vector3();

  //── Underwater state ───────────────────────────────────────────────────
  //Tracks whether the camera was submerged last frame so the ocean side-flip
  //only fires on the actual transition.
  this._wasUnderwater = false;

  //Flip the ocean + horizon skirt to render their underside (the "ceiling")
  //when the camera is below the surface. water-shader.glsl switches to its
  //computeUnderwaterCeiling appearance under the same underwaterFactor > 0.5
  //gate, so the geometry that draws and the shading model stay in lockstep.
  //
  //The sky/fog swaps this once owned (global FogExp2, background, dome hiding)
  //now live in tick(): a scene.fog mode-swap into A-Starry-Sky's reserved
  //underwater-fog branch, plus the sky-dome hide + murk background. This
  //function only owns the discrete per-transition material.side flip.
  this._applyUnderwaterSceneState = function(under){
    for(let i = 0, n = oceanGridInstanceKeys.length; i < n; ++i){
      const oceanMesh = oceanPatchGeometryInstances[oceanGridInstanceKeys[i]];
      if(oceanMesh && oceanMesh.material){
        //DoubleSide while submerged so the ceiling renders regardless of the
        //tile geometry's winding direction (PlaneGeometry's rotateX flips the
        //winding; the previous BackSide guess turned the ceiling invisible
        //from below). FrontSide above water keeps the cheap default.
        oceanMesh.material.side = under ? THREE.DoubleSide : THREE.FrontSide;
      }
    }
  };

  //Render the underwater scene from a camera mirrored across the rest water
  //plane (y = heightOffset) into the planar-reflection target — the TIR
  //mirror the ceiling samples outside Snell's window. Reflecting the camera's
  //position, forward and up across the plane and then doing a normal lookAt
  //keeps the virtual camera right-handed (no winding flip) — the
  //THREE.Reflector trick. Caller renders this while the ocean grid is hidden.
  this._renderUnderwaterReflection = function(scene, mainCamera){
    const h = self.heightOffset;
    const reflCam = self._reflectionCamera;
    if(!self._reflScratch){
      self._reflScratch = {
        pos: new THREE.Vector3(), fwd: new THREE.Vector3(),
        up: new THREE.Vector3(), quat: new THREE.Quaternion(),
        target: new THREE.Vector3(), clearColor: new THREE.Color()
      };
    }
    const s = self._reflScratch;
    mainCamera.getWorldPosition(s.pos);
    mainCamera.getWorldDirection(s.fwd);
    mainCamera.getWorldQuaternion(s.quat);
    s.up.set(0.0, 1.0, 0.0).applyQuaternion(s.quat);

    //Mirror the camera across the rest water plane: y → 2h - y, and flip the
    //y of both the forward and up vectors.
    reflCam.position.set(s.pos.x, 2.0 * h - s.pos.y, s.pos.z);
    reflCam.up.set(s.up.x, -s.up.y, s.up.z);
    s.target.set(s.pos.x + s.fwd.x,
                 (2.0 * h - s.pos.y) - s.fwd.y,
                 s.pos.z + s.fwd.z);
    reflCam.lookAt(s.target);
    reflCam.projectionMatrix.copy(mainCamera.projectionMatrix);
    reflCam.updateMatrixWorld();

    //world position → reflection UV: bias(clip→[0,1]) · proj · view.
    self._reflectionTextureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    self._reflectionTextureMatrix.multiply(reflCam.projectionMatrix);
    self._reflectionTextureMatrix.multiply(reflCam.matrixWorldInverse);

    //Hide the sky dome — only the underwater scene belongs in the mirror;
    //empty directions then read as the dark clear colour (the ceiling shader
    //fogs them toward the murk). The ocean grid is already hidden by the
    //caller, so the water never appears in its own reflection.
    const atmRenderer = self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.atmosphereRenderer;
    const skyMesh = atmRenderer && atmRenderer.skyMesh;
    const skyWasVisible = skyMesh ? skyMesh.visible : false;
    if(skyMesh){ skyMesh.visible = false; }

    const prevRT = self.renderer.getRenderTarget();
    const prevToneMapping = self.renderer.toneMapping;
    self.renderer.getClearColor(s.clearColor);
    const prevClearAlpha = self.renderer.getClearAlpha();

    //Render the mirror with NO scene.fog. The water shader's computeUnderwaterCeiling
    //already fogs the whole ceiling (reflection included) via applyUnderwaterFog;
    //letting scene.fog also fog this pass would double-fog the TIR mirror.
    const prevFog = scene.fog;
    scene.fog = null;

    //Linear output (NoToneMapping) so the colour feeds straight into the
    //ceiling's linear composite without a tone-map / encode round-trip.
    self.renderer.toneMapping = THREE.NoToneMapping;
    self.renderer.setRenderTarget(self._reflectionTarget);
    self.renderer.setClearColor(0x000000, 1.0);
    self.renderer.clear();
    self.renderer.render(scene, reflCam);

    scene.fog = prevFog;
    self.renderer.setClearColor(s.clearColor, prevClearAlpha);
    self.renderer.toneMapping = prevToneMapping;
    self.renderer.setRenderTarget(prevRT);
    if(skyMesh){ skyMesh.visible = skyWasVisible; }
  };

  //Refresh the underwater caustic projector. Re-renders the animated caustic
  //slide, parks the SpotLight high above the camera aimed straight down (a
  //near-parallel cast so caustic cell size barely changes with seabed depth),
  //and crossfades its intensity through the waterline via underwaterFactor.
  //The projector XZ snaps to one slide-tile so the world-projected caustic
  //pattern stays put as the camera swims. Skipped entirely above water.
  this._updateCausticProjection = function(time, waterSurfaceY, underwaterFactor){
    const light = self.causticSpotLight;
    //Scene isn't available at construction — add the projector + its target
    //once, on the first tick that has a scene.
    if(!self._causticLightAdded && self.scene){
      self.scene.add(light);
      self.scene.add(light.target);
      self._causticLightAdded = true;
    }
    //Above water, or the caustic texture hasn't loaded yet: drive intensity to
    //zero (not light.visible — see the constructor note) and skip the RT cost.
    if(!self.causticMap || underwaterFactor <= 0.001){
      light.intensity = 0.0;
      return;
    }

    //Re-render the animated caustic slide.
    const mat = self._causticProjectionMaterial;
    mat.uniforms.causticMap.value = self.causticMap;
    mat.uniforms.uTime.value = time * 0.001;
    mat.uniforms.uTiling.value = self.causticProjectionTiling;
    const prevRT = self.renderer.getRenderTarget();
    self.renderer.setRenderTarget(self._causticProjectionTarget);
    self.renderer.render(self._causticProjectionScene, self._causticProjectionCamera);
    self.renderer.setRenderTarget(prevRT);

    //Park the projector above the camera, aimed straight down. Snapping XZ to
    //one caustic tile (footprint / tiling) means each move is a whole pattern
    //period — invisible — so the cast caustics read as world-anchored.
    const metersPerTile = (2.0 * self.causticLightConeRadius) / self.causticProjectionTiling;
    const snapX = Math.floor(self.globalCameraPosition.x / metersPerTile) * metersPerTile;
    const snapZ = Math.floor(self.globalCameraPosition.z / metersPerTile) * metersPerTile;
    light.position.set(snapX, waterSurfaceY + self.causticLightHeight, snapZ);
    light.target.position.set(snapX, waterSurfaceY - 100.0, snapZ);
    light.target.updateMatrixWorld();
    light.angle = Math.atan(self.causticLightConeRadius / self.causticLightHeight);
    light.intensity = self.causticLightIntensity * self.causticsStrength * underwaterFactor;
  };

  //Fill A-Starry-Sky's reserved underwater-fog slot. Its `advanced` atmospheric
  //perspective globally patches THREE.ShaderChunk.fog_fragment / fog_vertex and
  //leaves an empty `else if(fogNear < 0.0)` branch marked with a //$$...$$
  //token. String-replace that token with a per-channel Beer-Lambert absorption
  //fog. Polled from tick() — the token only exists once A-Starry-Sky's
  //FogRenderer has run, and only in `advanced` mode; a harmless no-op
  //otherwise. Runs once, then forces a one-time recompile so already-built
  //materials pick up the new chunk.
  this._injectUnderwaterFogChunk = function(){
    if(self._fogChunkInjected) return;
    const fragToken = '//$$OCEAN_SHADER_SHADER_FRAGMENT_RESERVATION$$';
    const vertToken = '//$$OCEAN_SHADER_SHADER_VERTEX_RESERVATION$$';
    const fragChunk = THREE.ShaderChunk.fog_fragment;
    const vertChunk = THREE.ShaderChunk.fog_vertex;
    if(!fragChunk || fragChunk.indexOf(fragToken) === -1) return;  //not patched yet

    //Smuggle convention for the ocean branch (fogFar > 0 && fogNear < 0):
    //  fogColor.rgb = per-channel extinction (absorption+scattering), 1/m
    //  fogFar       = inscatter murk brightness
    //  -fogNear     = water surface Y (the waterline)
    //WORLD-Y GATE: only fragments BELOW the waterline are fogged. Above-water
    //geometry (the lighthouse etc.) seen from a submerged camera must NOT be
    //fogged as if the whole camera->fragment path were water — that over-fogged
    //it into a flat silhouette. vFogWorldPosition is A-Starry-Sky's existing
    //advanced-fog varying; the vertex slot below fills it for the ocean branch.
    //uwMurk: the inscatter equilibrium — the colour distant water fades TO. It
    //is white light's survival through a 14 m reference column of THIS water,
    //so the deep-water hue tracks the extinction (red fully absorbed -> a dark
    //deep blue). Kept dim so the lit near seabed reads bright against a dark
    //far field, i.e. distance fades toward darkness rather than a bright haze.
    const fragGLSL = [
      'float uwSurfaceY = -fogNear;',
      'if(vFogWorldPosition.y < uwSurfaceY){',
      '  vec3 uwExtinction = max(fogColor, vec3(1e-5));',
      '  vec3 uwTransmittance = exp(-uwExtinction * vFogDepth);',
      '  vec3 uwMurk = exp(-uwExtinction * 14.0) * fogFar;',
      '  vec3 uwLinear = fogsRGBToLinear(vec4(gl_FragColor.rgb, 1.0)).rgb;',
      '  uwLinear = uwLinear * uwTransmittance + uwMurk * (vec3(1.0) - uwTransmittance);',
      '  gl_FragColor.rgb = fogLinearTosRGB(vec4(uwLinear, 1.0)).rgb;',
      '}'
    ].join('\n');
    const vertGLSL = [
      'vFogDepth = - mvPosition.z;',
      'vFogWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    ].join('\n');

    THREE.ShaderChunk.fog_fragment = fragChunk.replace(fragToken, fragGLSL);
    if(vertChunk && vertChunk.indexOf(vertToken) !== -1){
      THREE.ShaderChunk.fog_vertex = vertChunk.replace(vertToken, vertGLSL);
    }
    self._fogChunkInjected = true;

    //Rebuild fog-enabled materials already compiled against the old chunk
    //(one-time startup hitch).
    if(self.scene){
      self.scene.traverse(function(obj){
        if(!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for(let i = 0; i < mats.length; ++i){
          if(mats[i] && mats[i].fog){ mats[i].needsUpdate = true; }
        }
      });
    }
  };

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
    if(self.refractionGBufferTarget.width !== rendererSize.x || self.refractionGBufferTarget.height !== rendererSize.y){
      self.refractionGBufferTarget.setSize(rendererSize.x, rendererSize.y);
      self.refractionGBufferTarget.depthTexture = new THREE.DepthTexture(
        rendererSize.x, rendererSize.y, THREE.UnsignedIntType
      );
      self.refractionGBufferTarget.depthTexture.format = THREE.DepthFormat;
      self._reflectionTarget.setSize(
        Math.max(1, (rendererSize.x * self.reflectionResolutionScale) | 0),
        Math.max(1, (rendererSize.y * self.reflectionResolutionScale) | 0)
      );
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

    //Render scene to G-buffer (3 MRT attachments: albedo, world-normal,
    //linear-depth). scene.overrideMaterial can't carry per-mesh albedo, so
    //we swap each visible non-ocean mesh's material to a cached G-buffer
    //variant that reads that source material's own .color / .map. Restored
    //immediately after render.
    self._swappedMeshes.length = 0;
    scene.traverse(function(obj){
      if(!obj.isMesh || !obj.visible || !obj.material) return;
      //Skip ShaderMaterial sources — they're custom shaders (ocean, etc.)
      //whose attribute usage we can't safely replace with our G-buffer shader.
      if(obj.material.isShaderMaterial) return;
      if(Array.isArray(obj.material) && obj.material.some(function(m){ return m.isShaderMaterial; })) return;
      const gBuf = self._resolveGBufferMaterial(obj.material);
      self._swappedMeshes.push({ mesh: obj, original: obj.material });
      obj.material = gBuf;
    });

    const currentRefractionRT = self.renderer.getRenderTarget();
    self.renderer.setRenderTarget(self.refractionGBufferTarget);
    self.renderer.clear();
    self.renderer.render(scene, sceneCamera);
    self.renderer.setRenderTarget(currentRefractionRT);

    for(let i = 0, n = self._swappedMeshes.length; i < n; ++i){
      const entry = self._swappedMeshes[i];
      entry.mesh.material = entry.original;
    }
    self._swappedMeshes.length = 0;

    //Underwater planar reflection — rendered from the mirror camera while the
    //ocean grid is still hidden (so water is never in its own reflection) and
    //materials are restored to their lit originals. Gated on last frame's
    //submersion state — the probe runs later in tick, and one frame of lag on
    //the in/out transition is invisible. Pure overhead above water, so skip.
    if(self._wasUnderwater){
      self._renderUnderwaterReflection(scene, sceneCamera);
    }

    //Update our sea foam camera - use position pass material to output world-space height data
    self.scene.overrideMaterial = self.positionPassMaterial;
    self.renderer.setClearAlpha(0.0);
    const currentRenderTarget = self.renderer.getRenderTarget();
    //Snap foam/exclusion camera XZ to texel-sized increments so the orthos
    //sample the same world-space points across frames — otherwise the foam
    //and exclusion atlases shift by a fractional pixel each frame as the
    //player moves, producing visible flicker on the foam pattern. The water
    //shader must then sample using these SNAPPED positions (uploaded as
    //foamCameraXZ / exclusionCameraXZ uniforms), not raw cameraPosition.
    //Same pattern as the per-cell clipmap snap at the top of this tick.
    const foamTexel = (2.0 * 2048.0) / self.foamRenderTarget.width; // 4096m / 4096px = 1m
    const exclTexel = (2.0 *  250.0) / self.exclusionRenderTarget.width; // 500m / 1024px ≈ 0.488m
    const foamSnapX = Math.round(self.globalCameraPosition.x / foamTexel) * foamTexel;
    const foamSnapZ = Math.round(self.globalCameraPosition.z / foamTexel) * foamTexel;
    const exclSnapX = Math.round(self.globalCameraPosition.x / exclTexel) * exclTexel;
    const exclSnapZ = Math.round(self.globalCameraPosition.z / exclTexel) * exclTexel;
    self._foamCameraXZ = self._foamCameraXZ || new THREE.Vector2();
    self._exclusionCameraXZ = self._exclusionCameraXZ || new THREE.Vector2();
    self._foamCameraXZ.set(foamSnapX, foamSnapZ);
    self._exclusionCameraXZ.set(exclSnapX, exclSnapZ);

    self.foamCamera.position.set(foamSnapX, this.heightOffset + self.foamCameraHeight, foamSnapZ);
    self.foamCamera.lookAt(foamSnapX, this.heightOffset - 1.0, foamSnapZ);
    self.foamCamera.updateProjectionMatrix();
    self.renderer.setRenderTarget(self.foamRenderTarget);
    const clearAlpha = renderer.getClearAlpha();
    self.renderer.clear();
    self.renderer.render(scene, self.foamCamera);
    this.foamRenderMap = self.foamRenderTarget.texture;
    self.renderer.setRenderTarget(null);
    //Update our exclusion camera - also needs position pass material for height data
    self.exclusionCamera.position.set(exclSnapX, this.heightOffset + self.foamCameraHeight, exclSnapZ);
    self.exclusionCamera.lookAt(exclSnapX, this.heightOffset - 1.0, exclSnapZ);
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
    //Push wind velocity + the four live-tunable broadband foam knobs to
    //the composer BEFORE its tick so this frame's foam accumulator uses
    //the current settings. windVelocity is the same wind vector that
    //drives the spectrum (data.wind_velocity).
    const bbU = self.oceanHeightComposer._broadbandPackMaterial.uniforms;
    bbU.windVelocity.value.set(self.windVelocity.x, self.windVelocity.y);
    bbU.foamCoverage.value      = self.foamCoverage;
    bbU.foamFadeRate.value      = self.foamFadeRate;
    bbU.foamStrength.value      = self.foamStrength;
    bbU.advectionScale.value    = self.foamAdvectionScale;

    self.oceanHeightComposer.tick();

    //── Underwater submersion probe ────────────────────────────────────────
    //Read back a single FFT-displacement texel directly above/below the
    //camera so the CPU knows the wave-displaced water level — the only way
    //to drive the air/water swap without it popping under passing crests.
    //Cascades 0 (4096 m) + 1 (1024 m) carry the dominant swell; the small
    //cascades add at most decimetre chop and are skipped so this stays at
    //two 1-px readbacks. Each readback is a GPU sync — acceptable for 1 px,
    //and a candidate for async PBO readback if it ever shows on a profile.
    const composer = self.oceanHeightComposer;
    let waterSurfaceY = self.heightOffset;
    if(composer && composer.cascadeDisplacementTextures && composer.cascadeDisplacementTextures[1]){
      self._surfaceProbeBuffer = self._surfaceProbeBuffer || new Float32Array(4);
      const buf = self._surfaceProbeBuffer;
      const res = composer.baseTextureWidth;
      const offsets = self.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
      const whm = composer.waveHeightMultiplier;
      for(let c = 0; c < 2; ++c){
        const patch = composer._cascadePatchSizes[c];
        let u = (self.globalCameraPosition.x + offsets[c].x) / patch;
        let v = (self.globalCameraPosition.z + offsets[c].y) / patch;
        u -= Math.floor(u);
        v -= Math.floor(v);
        const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
        const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
        const tex = composer.cascadeDisplacementTextures[c];
        const rt = (composer.cascadeDisplacementTargetsA[c].texture === tex)
                 ? composer.cascadeDisplacementTargetsA[c]
                 : composer.cascadeDisplacementTargetsB[c];
        self.renderer.readRenderTargetPixels(rt, px, py, 1, 1, buf);
        waterSurfaceY += buf[1] * whm;   //.y (green) channel = vertical displacement
      }
    }
    const cameraSubmersion = self.globalCameraPosition.y - waterSurfaceY;
    //Smooth 0→1 underwater blend over a 1 m band centred on the surface so
    //bobbing through the waterline crossfades the fog instead of snapping.
    const uwHalfBand = 0.5;
    let uwT = (uwHalfBand - cameraSubmersion) / (2.0 * uwHalfBand);
    uwT = uwT < 0.0 ? 0.0 : (uwT > 1.0 ? 1.0 : uwT);
    const underwaterFactor = uwT * uwT * (3.0 - 2.0 * uwT);
    const isUnderwater = underwaterFactor >= 0.5;
    if(isUnderwater !== self._wasUnderwater){
      self._wasUnderwater = isUnderwater;
      self._applyUnderwaterSceneState(isUnderwater);
    }

    //Underwater caustic projector — caustics on the directly-viewed seabed.
    self._updateCausticProjection(time, waterSurfaceY, underwaterFactor);

    //Underwater fog. Fill A-Starry-Sky's reserved fog-shader slot once it is
    //available, then swap scene.fog between A-Starry-Sky's atmospheric fog
    //(above water) and our ocean fog (underwater). Both are THREE.Fog, so the
    //swap never recompiles; A-Starry-Sky's FogRenderer keeps updating its own
    //(now-detached) Fog harmlessly while we own scene.fog underwater. Negative
    //fogNear selects the injected ocean branch.
    self._injectUnderwaterFogChunk();
    if(self.scene){
      if(isUnderwater && self._fogChunkInjected){
        self._oceanFog.color.setRGB(self.underwaterFogExtinction.x,
                                    self.underwaterFogExtinction.y,
                                    self.underwaterFogExtinction.z);
        self._oceanFog.near = -Math.max(waterSurfaceY, 0.001);   //< 0 selects ocean branch; |near| = waterline
        self._oceanFog.far = self.underwaterFogBrightness;       //> 0
        self.scene.fog = self._oceanFog;
      } else if(self.scene.fog === self._oceanFog){
        //Surfaced (or chunk not injected): hand scene.fog back to A-Starry-Sky.
        self.scene.fog = (self._capturedSkyFog !== undefined) ? self._capturedSkyFog : null;
      } else {
        //Above water: track whatever fog A-Starry-Sky currently wants mounted.
        self._capturedSkyFog = self.scene.fog;
      }
    }

    //Sky-dome swap. a-starry-sky's Preetham atmosphere dome is drawn with
    //depthWrite off; above water the horizon skirt overdraws its lower
    //hemisphere, but submerged the skirt sits ABOVE the camera and can no
    //longer cover it — the dome's bright horizon band leaks into the view as
    //a white strip. Hide the dome and clear to the murk while underwater so
    //the horizon reads as water. The Snell window still sources its sky from
    //the atmosphere LUTs (computeSkyRadiance), not this mesh, so nothing seen
    //through the surface is lost. Done per frame so it survives any restate.
    if(self.scene){
      const atmR = self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.atmosphereRenderer;
      const domeMesh = atmR && atmR.skyMesh;
      if(domeMesh){
        if(self._aboveWaterBackground === undefined){
          self._aboveWaterBackground = self.scene.background;
        }
        domeMesh.visible = !isUnderwater;
        self.scene.background = isUnderwater ? self.underwaterFogColor : self._aboveWaterBackground;
      }
    }

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
      //Broadband foam RT + its tile size (water shader samples at
      //worldXZ / broadbandFoamTileSize with REPEAT wrap).
      uniformsRef.broadbandFoamTexture.value = self.oceanHeightComposer.broadbandFoamTexture;
      uniformsRef.broadbandFoamTileSize.value = self.oceanHeightComposer.broadbandFoamTileSize;
      uniformsRef.cascadePatchSizes.value = self.oceanHeightComposer._cascadePatchSizes;
      //Per-cascade slope variance σ² — sourced from the height-band library.
      //Re-pushed every frame because regenerateH0() (called when wind changes
      //at runtime) rewrites the array; pointing at the live ref keeps the
      //shader in sync without an extra change-detection path.
      uniformsRef.cascadeRMSSlope.value = self.oceanHeightBandLibrary.cascadeRMSSlope;
      uniformsRef.waveHeightMultiplier.value = self.oceanHeightComposer.waveHeightMultiplier;
      //G-buffer attachments — albedo (0), normal (1), linear-depth (2);
      //depthTexture is the MRT's own depth attachment, kept for unprojection.
      uniformsRef.refractionColorTexture.value = self.refractionGBufferTarget.textures[0];
      uniformsRef.gBufferNormal.value = self.refractionGBufferTarget.textures[1];
      uniformsRef.refractionDepthTexture.value = self.refractionGBufferTarget.depthTexture;
      uniformsRef.refractionLinearDepth.value = self.refractionGBufferTarget.textures[2];
      //Atlas snap origins — must match the snapped positions the foam/exclusion
      //cameras rendered at, so the water shader samples the right world point.
      uniformsRef.foamCameraXZ.value.copy(self._foamCameraXZ);
      uniformsRef.exclusionCameraXZ.value.copy(self._exclusionCameraXZ);
      uniformsRef.screenResolution.value.set(self.refractionGBufferTarget.width, self.refractionGBufferTarget.height);
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
      uniformsRef.causticMap.value = self.causticMap;
      uniformsRef.causticIntensityMultiplier.value = self.causticsStrength;
      uniformsRef.reflectionScale.value = self.reflectionScale;
      uniformsRef.reflectionDistanceFalloff.value = self.reflectionDistanceFalloff;
      uniformsRef.fresnelDistanceRoughness.value = self.fresnelDistanceRoughness;
      uniformsRef.surfaceRoughness.value = self.surfaceRoughness;
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
          //Console override (set via setSunShadowEnabled) wins over the
          //auto-detect, so toggling from devtools actually disables the
          //sampler instead of being clobbered next frame.
          uniformsRef.sunShadowEnabled.value = self._sunShadowOverride === false ? 0 : 1;
          uniformsRef.sunShadowMap.value = mainLight.shadow.map.texture;
          uniformsRef.sunShadowMatrix.value.copy(mainLight.shadow.matrix);
          uniformsRef.sunShadowMapSize.value.set(mainLight.shadow.mapSize.x, mainLight.shadow.mapSize.y);
          uniformsRef.sunShadowRadius.value = mainLight.shadow.radius;
          //Was `mainLight.shadow.bias - 0.003` — that extra -0.003 push pulled
          //water-surface refZ enough toward the light that real occluders
          //(lighthouse) could fail the depth comparison, so the lighthouse
          //shadow on the stone wall rendered correctly (Three.js's standard
          //path, no extra bias) but the SAME shadow on adjacent water did
          //not (our shader, with the -0.003 push). Now using a-starry-sky's
          //bias plus a live-tunable offset (setSunShadowBias from console).
          //Positive offset = more shadowed (refZ pushed away from light,
          //comparison fails more often). Negative = less shadowed. Range
          //typical: -0.005 to +0.005.
          uniformsRef.sunShadowBias.value = mainLight.shadow.bias + self._sunShadowBiasOffset;
        } else {
          uniformsRef.sunShadowEnabled.value = 0;
        }

      }
      else{
        uniformsRef.brightestDirectionalLight.value.set(1.0,1.0,1.0);
      }
      uniformsRef.t.value = time * 0.001;

      //Underwater state — guarded so the horizon-skirt material (separate
      //template, no underwater uniforms) is skipped without throwing.
      if(uniformsRef.underwaterFactor){
        uniformsRef.underwaterFactor.value = underwaterFactor;
        uniformsRef.cameraSubmersion.value = cameraSubmersion;
        uniformsRef.waterSurfaceY.value = waterSurfaceY;
        uniformsRef.underwaterReflectionTexture.value = self._reflectionTarget.texture;
        uniformsRef.underwaterReflectionMatrix.value.copy(self._reflectionTextureMatrix);
      }

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
            //Build both vertex variants once via the shared helper so the
            //skirt z-clamp stays in lockstep with the regular ocean across
            //this AP-recompile path.
            const newVtxSrc = buildVertexShader(true, false);
            const skirtVtxSrc = buildVertexShader(true, true);
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

    //Horizon skirt follows the camera in XZ and sits at the FFT ocean's rest
    //plane (heightOffset) so it is coplanar with the clipmap. Pinning it at
    //y=0 left a flat water sheet heightOffset metres below the real surface —
    //invisible from a normal above-water eye height but starkly visible as an
    //"odd second water mesh" once the camera drops underwater. All uniform
    //updates happen via the per-instance loop above — the skirt is registered
    //in oceanGridInstanceKeys so it gets the same FFT cascade textures, light
    //state, atm LUTs, etc. that real ocean tiles get.
    if(self.horizonSkirtMesh){
      self.horizonSkirtMesh.position.set(sceneCamera.position.x, self.heightOffset, sceneCamera.position.z);
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
        if(sunBelowHorizon || self._oceanShadowOverride === false){
          u.oceanShadowEnabled.value = 0;
          if(sunBelowHorizon) continue;
        } else {
          u.oceanShadowEnabled.value = 1;
        }
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

    //Refresh shadow-frustum visualisers if active. Both the scene sun shadow
    //camera and each CSM lightCamera move every frame; helpers need .update()
    //to redraw their wireframes against the current matrices.
    if(self._shadowHelpers){
      for(let i = 0; i < self._shadowHelpers.length; i++){
        self._shadowHelpers[i].update();
      }
    }
  };
}
