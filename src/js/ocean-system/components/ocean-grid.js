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
ARestlessOcean.JERLOV_PRESETS = [
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
//    ocean must `camera.layers.enable(ARestlessOcean.OCEAN_LAYER)` —
//    likewise any future ocean-class meshes (extra water bodies, foam
//    decals, etc.) should call `mesh.layers.set(ARestlessOcean.OCEAN_LAYER)`.
//  - cameras that should NOT see water (foam capture, exclusion capture)
//    intentionally do nothing — staying on layer 0 keeps them ignorant of
//    ocean geometry by design.
//
//Picked 29 because the exclusion camera already uses 30; keeping them
//adjacent makes the "ocean-system reserved layers" cluster obvious.
ARestlessOcean.OCEAN_LAYER = 29;

ARestlessOcean.OceanGrid = function(scene, renderer, camera, parentComponent){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  const data = parentComponent.data;
  this.parentComponent = parentComponent;
  this.renderer = renderer;
  this.camera = camera;
  //Main scene camera needs to see the ocean even though water meshes have
  //been moved off layer 0 — see OCEAN_LAYER comment above.
  this.camera.layers.enable(ARestlessOcean.OCEAN_LAYER);
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
  //SSR march step cap (live-tunable via window.setSsrMaxSteps). 48 = original
  //full reach. The SSR ray-march is the dominant per-pixel water cost; lower
  //trades reflection reach for fill rate, 0 = sky-only (bottleneck A/B test).
  this.ssrMaxSteps = 48;
  this.fresnelDistanceRoughness = data.fresnel_distance_roughness;
  this.surfaceRoughness = 0.08;
  //Crest-style sun-glint controls (see water-shader.glsl). Defaults reproduce
  //the legacy ungated additive glint: gate 0, far falloff == near (275) so the
  //distance ramp is a no-op, boost 7.0. Dial via the window.setSpec* helpers.
  this.specFresnelGate = 0.0;
  this.specBoost = 7.0;
  this.specFalloffFar = 275.0;
  this.specFalloffFarDist = 200.0;
  this.foamEnabled = data.foam_enabled;
  this.foamStart = data.foam_start;
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
  //Wind-driven foam bias ("dip the Jacobian", Sea-of-Thieves style): as the sea
  //roughens we lift the fold signal in the water shader so progressively gentler
  //folds, and eventually the open surface itself, turn to foam/streaks. Ramps
  //linearly from foamWindStart (no extra bias, just real folds) to foamWindFull
  //(saturated), scaled to foamWindBiasMax added to the shader's `turbulence`.
  //With FOAM_TURB_THRESHOLD=0.5 the open surface starts foaming once the bias
  //passes ~0.5 and is fully white by ~0.75. Plain-JS, live-tunable per frame.
  this.foamWindStart = 10.0;    //m/s: whitecap-extra onset.
  this.foamWindFull = 50.0;     //m/s: bias saturates here (storm).
  this.foamWindBiasMax = 0.6;   //max value added to turbulence (FUDGE / art).
  this._foamWindBias = 0.0;     //computed each frame from current wind.
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
    //The caustic map is LINEAR intensity data, not a color image: it is a
    //photon-splat density render (see src/python/make-caustic-map.py), so no
    //sRGB decode applies. The consumer smoothstep thresholds (water-shader
    //CAUSTIC_THRESHOLD_LO/HI and the projection pass below) are solved by that
    //script against this texture — regenerate them together.
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.anisotropy = 8;
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
    //sRGB-authored photo used as linear albedo in the shader — must be decoded
    //on sample or the final linearTosRGB() double-encodes it (washed-out foam).
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
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
    //Mask data, not color — stays linear (no sRGB decode).
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.anisotropy = 8;
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
    //Vector data, not color — stays linear (no sRGB decode).
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.anisotropy = 8;
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

  //── Above-water transmission target ──────────────────────────────────────
  //Sampled by the underwater ceiling's Snell-window transmitted ray. The
  //refraction G-buffer is wrong for that lookup — it strips materials to
  //raw albedo, hides the sky dome, and skips above-water atmospheric fog,
  //so above-water content reads as flat unshaded ghost shapes through the
  //surface. This RT is a separate submerged-frame render of the FULLY-LIT
  //scene: sky dome restored, real materials, atmospheric perspective from
  //a-starry-sky reinstated, ocean grid + curtain hidden. Half-res HalfFloat
  //matching the reflection target — the sample is wave-distorted so it
  //needs no crispness, and HalfFloat keeps un-tone-mapped sky radiance
  //unclamped. Skipped entirely above water (the sample is never read then).
  this._aboveWaterTransmissionTarget = new THREE.WebGLRenderTarget(
    Math.max(1, (rendererSize.x * this.reflectionResolutionScale) | 0),
    Math.max(1, (rendererSize.y * this.reflectionResolutionScale) | 0),
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType
    }
  );

  //── Underwater caustic projection ────────────────────────────────────────
  //The water shader paints caustics onto the refracted seabed when the camera
  //is ABOVE water; submerged, the seabed is seen directly and never passes
  //through the water shader. To put caustics on it without touching the (often
  //imported, unknown) seabed materials, project them with a SpotLight cookie —
  //the one THREE light type whose `.map` is cast onto whatever it lights, on
  //any material, no shader surgery. SpotLight.map projects a single "slide"
  //across the cone and ignores texture repeat/offset, so the tiling AND the
  //animation are baked into the slide here: a small RT re-rendered each
  //submerged frame. Each slide texel is unprojected through the projector's
  //own shadow camera onto the water-surface plane and the pattern is
  //evaluated in WORLD XZ — so the cast caustics are world-anchored by
  //construction and the projector itself glides continuously with the camera.
  //(This replaced the earlier integer-tile XZ snapping: the snap kept the
  //PATTERN world-stable but made the cone envelope, decay vignette and the
  //spot shadow POV hop one tile at a time as the camera swam.)
  //4096 over the 25 m-radius cone = 82 px/m: the texture web's filaments
  //are ~2.6 cm at the 3.33 m period (the 8 px blur of the 1024 px texture),
  //so they need >~75 px/m to stay above a pixel in the slide. Shrinking the
  //cone radius (not raising this) is the cheap lever if they ever alias.
  this.causticProjectionResolution = 4096;
  //World-space caustic texture period — MUST match the above-water web:
  //water-shader.glsl samples causticUV = 0.3 * pSurfaceHit.xz → 1/0.3 ≈ 3.3 m
  //period (kept as the expression below so the derivation is visible).
  //Matching the period also matches the drift SPEED for free — both shaders
  //scroll at the same vec2(0.8,0.1)/8 UV/s, and world speed is UV speed ÷
  //UV-per-metre. (Drift DIRECTION can differ slightly while the projector is
  //tilted: the slide evaluates the pattern at the surface plane and the cone
  //carries it down-ray, exactly like the water shader's pSurfaceHit sample.)
  //If the water shader's 0.3 multiplier changes, re-derive (period = 1/mult).
  this.causticTexturePeriod = 1.0 / 0.3;
  this.causticLightHeight = 400.0;        //metres the projector sits above the surface
  //Ground radius the cone covers. Sized by RESOLUTION as well as visibility:
  //the slide RT spreads its 4096 px across the cone diameter, and the web's
  //filaments are ~2.6 cm at the 3.33 m period (the 8 px blur of the 1024 px
  //texture), so they need >~75 px/m to resolve. 25 m radius → 82 px/m ≈ 2 px
  //per filament; the old 60 m radius (34 px/m) left filaments SUB-PIXEL in
  //the slide and the contrast smoothstep turned the mip average into
  //pixelated speckle. Visibility (~13 m in Jerlov 1C) + sun-tilt swing of
  //the lit disc still fit comfortably inside 25 m.
  this.causticLightConeRadius = 25.0;
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
      //Inverse view-projection of the projector's shadow camera — the SAME
      //camera the cookie projects through, so slide texel ↔ world mapping is
      //exact by construction. Filled per frame in _updateCausticProjection.
      uInvVP: {value: new THREE.Matrix4()},
      uSurfaceY: {value: 0.0},
      uPeriod: {value: this.causticTexturePeriod}
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){',
      '  vUv = uv;',
      '  gl_Position = vec4(position.xy, 0.0, 1.0);',
      '}'
    ].join('\n'),
    //Mirrors causticShader() in water-shader.glsl: two non-parallel scrolling
    //samples min'd together, then a smoothstep contrast curve. The pattern is
    //sampled in world XZ / uPeriod, the same parameterisation the water
    //shader uses (0.1 * pSurfaceHit.xz), so size, drift speed AND phase line
    //up across the waterline. The three chromatically-offset taps give
    //caustic light its R/B dispersion — the foci of different wavelengths
    //land slightly apart (matches the +/-0.005 caustic-UV offset the water
    //shader's causticShader uses).
    fragmentShader: [
      'uniform sampler2D causticMap;',
      'uniform float uTime;',
      'uniform mat4 uInvVP;',
      'uniform float uSurfaceY;',
      'uniform float uPeriod;',
      'varying vec2 vUv;',
      'float caustic(vec2 uv, float t){',
      '  vec2 uv1 = uv + vec2(0.8, 0.1) * t;',
      '  vec2 uv2 = uv - vec2(0.2, 0.7) * t;',
      '  float a = texture2D(causticMap, uv1).r;',
      '  float b = texture2D(causticMap, uv2).g;',
      //LO/HI are solved by make-caustic-map.py against the generated caustic
      //texture (must match CAUSTIC_THRESHOLD_LO/HI in water-shader.glsl).
      '  return smoothstep(0.0, 1.0, min(a, b));',
      '}',
      'void main(){',
      //Unproject this slide texel through the projector camera and intersect
      //the water-surface plane: the pattern is evaluated where the cookie ray
      //pierces the surface, so it stays world-anchored while the projector
      //moves, and the keystone of a tilted cone is handled exactly.
      '  vec2 ndc = vUv * 2.0 - 1.0;',
      '  vec4 pNear = uInvVP * vec4(ndc, -1.0, 1.0);',
      '  vec4 pFar  = uInvVP * vec4(ndc,  1.0, 1.0);',
      '  vec3 ro = pNear.xyz / pNear.w;',
      '  vec3 rd = normalize(pFar.xyz / pFar.w - ro);',
      //rd.y is always negative (the projector looks down); the min() guards
      //the degenerate near-horizontal case rather than dividing by ~0.
      '  float s = (uSurfaceY - ro.y) / min(rd.y, -0.001);',
      '  vec2 uv = (ro.xz + rd.xz * s) / uPeriod;',
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

  //The projector. distance 0 → no hard cutoff. decay 2 (inverse-square) gives
  //a soft depth falloff: fragments farther from the projector (= deeper, since
  //the projector sits above the surface and tracks the camera XZ) receive
  //less light, approximating the Beer-Lambert attenuation of sunlight on its
  //way down to the seabed. The runtime compensates intensity by
  //pow(causticLightHeight, decay) so surface-level brightness matches what
  //the old decay-0 cast produced — only the depth gradient is new.
  //castShadow ON — the scene sun shadow only darkens the seabed's DIFFUSE
  //term; this cookie light is additive, so without its own occlusion the web
  //lands on seabed inside an island/hull sun shadow. The water surface
  //cannot block the cone: ocean patches, the underwater curtain and the
  //horizon skirt all set castShadow = false, so only real scene casters
  //(terrain, hulls, lighthouse) register in the spot's shadow map.
  //castShadow stays PERMANENTLY true: toggling it at the waterline would
  //change NUM_SPOT_LIGHT_SHADOWS and recompile every lit material on each
  //crossing — the same churn the intensity-instead-of-visible rule below
  //avoids. The idle cost above water is one depth pass over whatever sits in
  //the cone; _updateCausticProjection parks the projector far below the world
  //while surfaced so that pass frustum-culls to zero draws.
  //Kept permanently in the scene with intensity driven to 0 above water:
  //toggling light.visible would change the visible-light count and recompile
  //every lit material on each waterline crossing. (SpotLight.map updates its
  //projection matrix on its own — WebGLLights calls shadow.updateMatrices
  //when a map is present.)
  this.causticSpotLight = new THREE.SpotLight(0xffffff, 0.0);
  this.causticSpotLight.decay = 2.0;
  this.causticSpotLight.distance = 0.0;
  //Low penumbra: THREE's spot falloff starts at angle*(1-penumbra), so a high
  //value vignettes most of the 60m cone — at 0.8 full brightness reached only
  //a ~12m ground radius and the visible seabed sat in the falloff ramp. 0.25
  //keeps full strength to ~45m; the remaining edge lands beyond underwater
  //visibility (Jerlov 1C ~13m) so no hard cone ring shows.
  this.causticSpotLight.penumbra = 0.25;
  this.causticSpotLight.angle = Math.atan(this.causticLightConeRadius / this.causticLightHeight);
  this.causticSpotLight.castShadow = true;
  this.causticSpotLight.shadow.mapSize.set(2048, 2048);
  //Tight depth range for perspective shadow precision at the receiver band:
  //the projector sits causticLightHeight (400 m) up the refracted sun ray, so
  //the seabed lives ~400-460 m from it and above-water casters (island peaks,
  //lighthouse) no closer than ~200 m. near=100/far=600 brackets both with
  //margin. light.distance stays 0 so SpotLightShadow.updateMatrices keeps our
  //far. normalBias 1.5 matches what the scene sun needed on the same imported
  //terrain (islands.html acne fix).
  this.causticSpotLight.shadow.camera.near = 100.0;
  this.causticSpotLight.shadow.camera.far = 600.0;
  this.causticSpotLight.shadow.normalBias = 1.5;
  //The slide pass reads this camera's projectionMatrixInverse before THREE's
  //own shadow pass has ever run updateMatrices — keep it valid from frame 0.
  this.causticSpotLight.shadow.camera.updateProjectionMatrix();
  this.causticSpotLight.map = this._causticProjectionTarget.texture;
  this._causticLightAdded = false;

  //── Underwater fog (via A-Starry-Sky's fog reservation hook) ──────────────
  //Geometry seen DIRECTLY underwater (the seabed) is drawn by its own
  //materials and never touches the water shader. A-Starry-Sky's `advanced`
  //atmospheric perspective globally patches THREE.ShaderChunk.fog_* and leaves
  //an empty reserved branch keyed on `fogNear < 0.0`; _injectUnderwaterFogChunk()
  //below fills that slot with a Beer-Lambert absorption fog whose colour is
  //derived from the SAME waterAlbedo/downwelling/depthDarken stack the water
  //shader uses for its ceiling fog — so the seabed murk and the ceiling murk
  //read as the same medium. THREE.Fog only carries one Color + two floats, so
  //the smuggle puts the murk colour itself in fog.color (rather than
  //extinction, which the pre-2026-05-23 chunk did and which produced a navy
  //seabed against a teal ceiling). Monochrome distance falloff in exchange.
  //  fog.color = inscatter murk colour (linear) — matches water shader
  //  fog.near  = -waterSurfaceY (selects ocean branch + world-Y gate)
  //  fog.far   = scalar transmittance density (1/m), avg of extinction
  this.underwaterFogColor = new THREE.Color(0.12, 0.24, 0.27);   //sky-dome bg swap colour fallback
  //Multiplier on the computed murk colour. Our inscatter formula
  //(albedo · (sun + ambient) / π) assumes ISOTROPIC phase, but real water
  //is strongly forward-scattering — the back-scattered radiance reaching the
  //eye is a fraction of what the isotropic formula predicts. 0.35 is the
  //empirical compensation that makes shallow water read as "subtle absorption"
  //rather than "saturated cyan." Live-tunable; will likely become a data
  //attribute once we expose a user-facing parameter.
  this.underwaterFogBrightness = 0.35;
  this._oceanFog = new THREE.Fog(0x1a2d33, -1.0, 1.0);  //near<0 + far>0 => ocean branch
  this._capturedSkyFog = undefined;            //A-Starry-Sky's fog, tracked while above water
  this._fogChunkInjected = false;
  this._uwMurkScratch = new THREE.Vector3();   //per-frame murk scratch (avoid alloc)
  //Camera-depth-darkened murk for the curtain/background. Normally recomputed
  //each frame in the underwater inscatter block — but that block is gated on
  //`_fogChunkInjected`, which is false when a-starry-sky (whose reserved fog
  //slot we hook) is absent. Seed a default dark-teal so the curtain/background
  //consumers never dereference undefined and underwater degrades gracefully
  //instead of crashing when running without a-starry-sky.
  this._uwMurkCamDepthScratch = new THREE.Vector3(0.02, 0.06, 0.08);
  this._uwSunDirScratch = new THREE.Vector3();
  //Refracted (in-water) sun direction for the tilted caustic projector. Reused
  //per frame to avoid alloc. See _updateCausticProjection.
  this._causticRefrScratch = new THREE.Vector3();
  //Ambient (downwelling) hemisphere light discovered standalone — fills the
  //inscatter ambient term that normally comes from a-starry-sky's y-axis
  //hemispherical. Found in the per-frame light scan; null until then.
  this._fallbackHemiLight = null;

  //Sky downwelling ambient, shared by the underwater murk, the body-colour
  //blend, and splash lighting. a-starry-sky drives THREE oriented
  //HemisphereLights as a cheap SH-ambient probe (see A-Starry-Sky
  //LightingManager.js tick): xAxis points along the sun azimuth, yAxis straight
  //up (zenith), zAxis the perpendicular horizontal; each `.color` is that axis's
  //sky-side irradiance, `.groundColor` the seabed/ground bounce side.
  //
  //We USED to read only yAxis.color as "the downwelling sky" — but that axis
  //routinely clamps to ~black. Its value is the order-2 SH irradiance evaluated
  //straight up, then max-normalised against all 18 hemi channels; at most sun
  //elevations the zenith lobe rings slightly negative and evalSHHemi clamps it to
  //0, while the two HORIZONTAL axes carry the real sky colour. So reading the
  //zenith alone gave a black ambient and the whole underwater murk collapsed to
  //the sun-only term.
  //
  //The physically-correct "downwelling sky onto a horizontal surface" is exactly
  //what THREE computes when it lights an up-facing (+Y normal) receiver with
  //these three lights: each HemisphereLight contributes
  //mix(groundColor, color, 0.5 + 0.5*dot(N, axisDir)). For N = +Y the two
  //horizontal axes land at dot=0 -> 0.5*color, and the zenith axis at dot=1 ->
  //1.0*color. We take the SKY side only (drop groundColor — the murk inscatter is
  //driven by light entering the water from the sky, not by the floor bounce):
  //    skyAmbient = 0.5*xColor + 1.0*yColor + 0.5*zColor   (each * its intensity)
  //This is robust to the zenith clamping to 0 (the horizontals still sum to the
  //full horizon sky) and stays consistent with how the rest of the scene is lit.
  //Result lands in _skyAmbientScratch (linear RGB); returns true if a source was
  //found. NOT view/camera dependent — these are global scene lights shared by
  //every render pass (main and the reflection mirror alike), so this same value
  //fogs the directly-viewed seabed and the reflected ceiling identically.
  //THREE applies LinearToSRGB to a Fog's `.color` when it uploads it as the
  //`fogColor` uniform, so a color set with raw LINEAR values arrives ~brightened
  //in the shader. The underwater fog chunk reads `fogColor` directly as a linear
  //radiance (the murk baseline `albedo·(E_sun+E_sky)/4π`), so we must pre-apply
  //the inverse (SRGBToLinear) when writing _oceanFog.color — exactly as
  //a-starry-sky's FogRenderer does for its own fog (toFogUniform). Without this
  //the chunk-fogged seabed/curtain murk renders ~3× too bright (e.g. a 0.09 sRGB
  //murk reads as 0.57) while the water-shader ceiling — which reads plain Vector3
  //uniforms, not color-managed — stays correct. That mismatch was the glowing
  //seabed. Per-channel SRGBToLinear, matching THREE's sRGB transfer function.
  this._toFogUniform = function(v){
    return v < 0.04045 ? v * 0.0773993808 : Math.pow(v * 0.9478672986 + 0.0521327014, 2.4);
  };

  this._skyAmbientScratch = new THREE.Vector3();
  this._readSkyAmbient = function(){
    const out = self._skyAmbientScratch;
    if(self.skyDirector && self.skyDirector.lightingManager){
      const lm = self.skyDirector.lightingManager;
      const xL = lm.xAxisHemisphericalLight;
      const yL = lm.yAxisHemisphericalLight;
      const zL = lm.zAxisHemisphericalLight;
      const xI = xL.intensity * 0.5, yI = yL.intensity, zI = zL.intensity * 0.5;
      out.set(
        xL.color.r * xI + yL.color.r * yI + zL.color.r * zI,
        xL.color.g * xI + yL.color.g * yI + zL.color.g * zI,
        xL.color.b * xI + yL.color.b * yI + zL.color.b * zI
      );
      return true;
    } else if(self._fallbackHemiLight){
      //Single scene HemisphereLight: an up-facing receiver gets the full sky side.
      const hL = self._fallbackHemiLight;
      out.set(hL.color.r * hL.intensity, hL.color.g * hL.intensity, hL.color.b * hL.intensity);
      return true;
    }
    return false;
  };

  //── Sky provider resolution + standalone underwater-fog scaffold ──────────
  //The underwater seabed/curtain murk (see _injectUnderwaterFogChunk) hooks a
  //reservation slot in THREE.ShaderChunk.fog_* that a-starry-sky installs as
  //part of its atmospheric-perspective fog. Without a-starry-sky that slot
  //never exists, so the seabed renders un-fogged (flat). Detection by sniffing
  //for the token can't tell "a-starry-sky not initialised yet" from "no
  //a-starry-sky at all" (both look token-absent at frame 1), so we resolve the
  //provider up front off the DOM/markup instead.
  this._resolveSkyProvider = function(){
    const declared = (self.data && typeof self.data.sky_provider === 'string')
      ? self.data.sky_provider.toLowerCase() : 'auto';
    if(declared === 'standalone' || declared === 'a-starry-sky'){
      return declared;
    }
    //auto: the element's PRESENCE in the page is a deterministic signal
    //available before a-starry-sky has initialised — unlike its patched
    //ShaderChunk, which only appears a tick or two later.
    const hasGlobal = (typeof StarrySky !== 'undefined');
    const hasElement = (typeof document !== 'undefined') &&
      !!document.querySelector('a-starry-sky');
    return (hasGlobal || hasElement) ? 'a-starry-sky' : 'standalone';
  };

  //Install a minimal, self-contained fog scaffold into THREE.ShaderChunk.fog_*
  //carrying the SAME reservation tokens a-starry-sky leaves, so the existing
  //_injectUnderwaterFogChunk() can fill them unchanged. We deliberately do NOT
  //replicate a-starry-sky's atmosphere here — only the plumbing the ocean
  //branch needs: the vFogWorldPosition varying, the sRGB helpers the chunk
  //calls, and a stock linear-fog else-branch for fogNear >= 0. Idempotent and
  //skipped entirely when a-starry-sky owns the slot.
  this._installStandaloneFogScaffold = function(){
    if(self._standaloneFogScaffoldInstalled) return;
    const fragToken = '//$$OCEAN_SHADER_SHADER_FRAGMENT_RESERVATION$$';
    const vertToken = '//$$OCEAN_SHADER_SHADER_VERTEX_RESERVATION$$';
    //If something already provided the token (a-starry-sky raced us), don't
    //clobber it — let _injectUnderwaterFogChunk fill whatever is there.
    if(THREE.ShaderChunk.fog_fragment &&
       THREE.ShaderChunk.fog_fragment.indexOf(fragToken) !== -1){
      self._standaloneFogScaffoldInstalled = true;
      return;
    }
    THREE.ShaderChunk.fog_pars_vertex = [
      '#ifdef USE_FOG',
      '  varying float vFogDepth;',
      '  varying vec3 vFogWorldPosition;',
      '#endif'
    ].join('\n');
    THREE.ShaderChunk.fog_vertex = [
      '#ifdef USE_FOG',
      '  ' + vertToken,
      '#endif'
    ].join('\n');
    THREE.ShaderChunk.fog_pars_fragment = [
      '#ifdef USE_FOG',
      '  uniform vec3 fogColor;',
      '  varying float vFogDepth;',
      '  varying vec3 vFogWorldPosition;',
      '  #ifdef FOG_EXP2',
      '    uniform float fogDensity;',
      '  #else',
      '    uniform float fogNear;',
      '    uniform float fogFar;',
      '  #endif',
      //sRGB <-> linear helpers the injected ocean branch calls by name. Match
      //a-starry-sky's signatures (vec4 in / vec4 out) so the chunk GLSL is
      //identical on both paths.
      '  vec4 fogsRGBToLinear(vec4 c){',
      '    return vec4(mix(c.rgb / 12.92, pow((c.rgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c.rgb)), c.a);',
      '  }',
      '  vec4 fogLinearTosRGB(vec4 c){',
      '    return vec4(mix(c.rgb * 12.92, 1.055 * pow(c.rgb, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c.rgb)), c.a);',
      '  }',
      //Narkowicz ACES fit — the SAME operator a-starry-sky and water-shader.glsl
      //use. The ocean branch tonemaps its fogged result on the sRGB (main-canvas)
      //path so underwater scene geometry matches the water surface and the
      //reflection (which both go through MyAES). a-starry-sky declares this itself
      //on its path, so this copy is standalone-only — the two scaffolds are never
      //both installed, so there is no duplicate-symbol collision.
      '  vec3 MyAESFilmicToneMapping(vec3 color){',
      '    return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);',
      '  }',
      '#endif'
    ].join('\n');
    THREE.ShaderChunk.fog_fragment = [
      '#ifdef USE_FOG',
      '  #ifdef FOG_EXP2',
      '    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);',
      '    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);',
      '  #else',
      //fogNear < 0 selects the ocean branch (same convention as the a-starry-sky
      //path). The reservation token is filled by _injectUnderwaterFogChunk; the
      //else is plain linear fog so any above-water fog still works standalone.
      '    if(fogNear < 0.0){',
      '      ' + fragToken,
      '    } else {',
      '      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);',
      '      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);',
      '    }',
      '  #endif',
      '#endif'
    ].join('\n');
    self._standaloneFogScaffoldInstalled = true;
  };

  //Resolve now (constructor time, before any material compiles) and, if we own
  //the sky, lay down the scaffold so the curtain/seabed fog materials built
  //below pick it up on first compile.
  this._skyProvider = this._resolveSkyProvider();
  if(this._skyProvider === 'standalone'){
    this._installStandaloneFogScaffold();
  }

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
  //1024² RGBA FloatType = ~16 MB (was 4096² ≈ 268 MB). The ortho still covers
  //4096 m, so texel size is 4 m/texel (was 1 m). Shore-foam band is 0.5–4 m
  //(water-shader: shoreFade), so the breaker line quantises to ~4 m steps —
  //bump back to 2048² (2 m/texel, ~67 MB) if the shoreline reads stair-stepped.
  this.foamRenderTarget = new THREE.WebGLRenderTarget(1024, 1024, {
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
  //NEAREST filtering is mandatory here: the .g channel is a discard *threshold*
  //(boat world-Y) and .a is a 0/1 mask, neither of which may be interpolated
  //across the hard boat/no-boat boundary. The RT default (LinearFilter) blended
  //the below-water interior-floor height with the rim and the cleared (G=0=sea
  //level) texels, so along the hull rim discardHeight drifted below the water
  //(over-discard → ring straight to the seabed) or above it (under-discard →
  //water leaks into the hull). NEAREST gives each water fragment one clean texel.
  //NEAREST filtering is mandatory here: the .g channel is a discard *threshold*
  //(boat world-Y) and .a is a 0/1 mask, neither of which may be interpolated
  //across the hard boat/no-boat boundary. The RT default (LinearFilter) blended
  //the below-water interior-floor height with the rim and the cleared (G=0=sea
  //level) texels, so along the hull rim discardHeight drifted below the water
  //(over-discard → ring straight to the seabed) or above it (under-discard →
  //water leaks into the hull). NEAREST gives each water fragment one clean texel.
  //
  //Residual keel-crease tris + a ~1px waterline edge remain: they're texel-
  //resolution limited (~0.49 m/texel over this 500 m ortho). Confirmed via a
  //2048² test (the tris shrank with texel size). The sharp fix is a tighter
  //ortho extent (fit-to-boat, or a smaller fixed radius) for sub-decimetre
  //texels at this same 16 MB size — deferred, as it needs the hardcoded 250 m
  //half-width in water-shader.glsl uniform-ized (a create-shader.py regen).
  this.exclusionRenderTarget = new THREE.WebGLRenderTarget(1024, 1024, {
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter
  });
  this.exclusionCamera = new THREE.OrthographicCamera(-250.0, 250.0, 250.0, -250.0, 0.1, this.foamCameraHeight + 500.0);
  this.exclusionCamera.layers.disableAll();
  this.exclusionCamera.layers.set(30);
  this.scene.add(this.exclusionCamera);

  //Initialize all shader LUTs for future ocean viewing
  //Initialize our ocean variables and all associated shaders.
  this.oceanHeightBandLibrary = new ARestlessOcean.LUTlibraries.OceanHeightBandLibrary(this);
  this.oceanHeightComposer = new ARestlessOcean.LUTlibraries.OceanHeightComposer(this);

  //Discover a-starry-sky's SkyDirector for atmospheric perspective LUTs.
  //Also retried from tick: a-starry-sky may initialize AFTER this component
  //(DOM order or dynamic insertion), in which case both lookups miss here and
  //atmospheric perspective would otherwise silently stay off all session.
  this._discoverSkyDirector = function(){
    //Try the global reference first, then fall back to DOM query
    if(typeof StarrySky !== 'undefined' && StarrySky.skyDirectorRef){
      self.skyDirector = StarrySky.skyDirectorRef;
    }
    else{
      const skyEl = document.querySelector('a-starry-sky');
      if(skyEl && skyEl.components && skyEl.components.starryskywrapper){
        self.skyDirector = skyEl.components.starryskywrapper.skyDirector || null;
      }
    }
    return !!self.skyDirector;
  };
  if(this.atmosphericPerspectiveEnabled){
    if(this._discoverSkyDirector()){
      const luts = this.skyDirector.getAtmosphericLUTs();
      if(luts){
        this.atmosphereFunctionsGLSL = luts.atmosphereFunctionsString || null;
      }
    }
  }

  //Set up our ocean material that is used for all of our ocean patches
  //If atmospheric perspective is requested but sky isn't ready yet, start with it disabled
  //and recompile when the sky becomes available
  const atmosphereReady = this.atmosphericPerspectiveEnabled && this.atmosphereFunctionsGLSL;
  //Ocean material participates in scene.fog. NOTE: water-shader.glsl gates its
  //`#include <fog_fragment>` behind `#if(!$atmospheric_perspective_enabled)`, so
  //while AP is on the chunk does not yet fog the water surface — the bespoke
  //applyUnderwaterFog / applyAtmosphericPerspective still own that. Flag is true
  //regardless (was `!atmosphereReady`) so the fog varyings/uniforms exist and the
  //water is ready to route through the unified chunk once that gate is lifted.
  const useFog = true;
  //Vertex shader takes two template flags: $atmospheric_perspective_enabled
  //and $horizon_skirt. Ocean tiles use the {AP, no-skirt} variant; the
  //horizon skirt clones the material and uses the {AP, skirt} variant
  //which pins gl_Position.z just inside the far plane.
  function buildVertexShader(atmEnabled, skirt){
    return ARestlessOcean.Materials.Ocean.waterMaterial.vertexShader
      .replace(/\$atmospheric_perspective_enabled/g, atmEnabled ? '1' : '0')
      .replace(/\$horizon_skirt/g, skirt ? '1' : '0');
  }
  const vertexShaderSource = buildVertexShader(atmosphereReady, false);
  this.oceanMaterial = new THREE.ShaderMaterial({
    vertexShader: vertexShaderSource,
    fragmentShader: ARestlessOcean.Materials.Ocean.waterMaterial.fragmentShader(this.causticsEnabled, this.foamEnabled, atmosphereReady, this.atmosphereFunctionsGLSL),
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
  this.oceanMaterial.uniforms = ARestlessOcean.Materials.Ocean.waterMaterial.uniforms;
  this.oceanMaterial.uniforms.sizeOfOceanPatch.value = this.patchSize;

  this.positionPassMaterial = new THREE.ShaderMaterial({
    vertexShader: ARestlessOcean.Materials.Ocean.positionPassMaterial.vertexShader,
    fragmentShader: ARestlessOcean.Materials.Ocean.positionPassMaterial.fragmentShader,
    side: THREE.FrontSide,
    transparent: false,
    lights: false
  });
  this.positionPassMaterial.uniforms = ARestlessOcean.Materials.Ocean.positionPassMaterial.uniforms;
  this.positionPassMaterial.uniforms.worldMatrix.value = this.camera.matrixWorld;

  //Ocean-only cascaded shadow map. Dedicated tight-frustum depth pass that
  //only contains the water InstancedMeshes — gives per-wave self-shadow that
  //the scene-wide sun shadow map can't resolve. Registered with each mesh
  //below via addCaster(). Safe to skip if the shadow material isn't loaded
  //(older builds without ocean-shadow.js).
  if(ARestlessOcean.OceanShadowCSM && ARestlessOcean.Materials.Ocean.oceanShadowMaterial){
    this.oceanShadowCSM = new ARestlessOcean.OceanShadowCSM(this, scene);
  } else {
    this.oceanShadowCSM = null;
  }

  //── Splash particles ────────────────────────────────────────────────────────
  //Airborne spray for breaking crests and water-vs-solid impacts. OceanGrid owns
  //the Points mesh and hides it during every offscreen pass below (it is only
  //flipped visible at the very end of tick). Safe to skip if ocean-splash.js or
  //its generated material isn't loaded.
  if(ARestlessOcean.OceanSplash && ARestlessOcean.Materials.Ocean.splashMaterial){
    //Declarative start-time overrides from the nested <ocean-splash> element,
    //assembled by ocean-state.applyNestedConfig (e.g. impact-min-launch="9"
    //shore-jet-scale="2" enabled="false"). Any knob is settable; the same fields
    //stay live-editable on the instance via window.oceanSplash.
    const splashCfg = data.splashConfig || {};
    this.oceanSplash = new ARestlessOcean.OceanSplash(this, scene, splashCfg);
    //Hull impacts: the buoyancy component fires buoyancy-splash on water entry
    //(bubbles up to the scene). Feed it straight into the shared impact emitter.
    const splashSelf = this;
    if(this.parentComponent && this.parentComponent.el && this.parentComponent.el.sceneEl){
      this.parentComponent.el.sceneEl.addEventListener('buoyancy-splash', function(evt){
        const s = splashSelf.oceanSplash;
        if(!s) return;
        const d = evt.detail || {};
        const p = d.point;
        if(!p) return;
        s.emitImpact(p.x, p.y, p.z, 0.0, 1.0, 0.0, d.speed || 0.0);
      });
    }
  } else {
    this.oceanSplash = null;
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
  //Creation lives in this._createHorizonSkirt (defined below alongside the
  //instance-key registration it needs) and is called both at construction and
  //from tick when the sky is discovered late.

  //── Underwater curtain hemisphere ────────────────────────────────────────
  //A hidden BackSide hemisphere centered on the camera, drawn only while
  //submerged. Closes the gap where the sky dome (hidden underwater) used to
  //occupy pixels — the seabed silhouette + island silhouette no longer have
  //sky leaking past them in the distance; the curtain backstops every empty
  //below-horizon direction with the inscatter murk. The cap extends only
  //~10° above the horizon so the upward Snell-window view through the
  //ceiling never has the curtain in front of it. Radius chosen so
  //far-distance ceiling ripples still read against it; the per-fragment
  //underwater fog integrates the camera→curtain path and converges to murk.
  this.underwaterCurtainMesh = null;
  {
    const curtainOverhangDeg = 10.0;
    const curtainThetaStart = Math.PI * 0.5 - curtainOverhangDeg * Math.PI / 180.0;
    const curtainThetaLength = Math.PI - curtainThetaStart;
    const curtainGeom = new THREE.SphereGeometry(
      300.0, 24, 12,
      0, Math.PI * 2.0,
      curtainThetaStart, curtainThetaLength
    );
    //fog:true — the curtain runs through the underwater fog chunk so its
    //backdrop converges to the same per-fragment murk (and HG sun phase) as
    //the fogged geometry, keeping direct and reflected horizon colours matched.
    const curtainMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.BackSide,
      fog: true,
      depthWrite: false,
      depthTest: true
    });
    this.underwaterCurtainMesh = new THREE.Mesh(curtainGeom, curtainMat);
    this.underwaterCurtainMesh.frustumCulled = false;
    this.underwaterCurtainMesh.castShadow = false;
    this.underwaterCurtainMesh.receiveShadow = false;
    //Draw early so any real scene geometry (seabed, island, lighthouse base)
    //overdraws it — curtain only fills directions with nothing in front.
    this.underwaterCurtainMesh.renderOrder = -10;
    this.underwaterCurtainMesh.visible = false;
    //Off the foam-capture layer so the ortho foam camera ignores it.
    this.underwaterCurtainMesh.layers.set(ARestlessOcean.OCEAN_LAYER);
    scene.add(this.underwaterCurtainMesh);
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
      const geometry = ARestlessOcean.OceanTile(tileSize, numCells, top, right, bottom, left);
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
      mesh.layers.enable(ARestlessOcean.OCEAN_LAYER);

      const uniformsRef = mesh.material.uniforms;
      uniformsRef.foamScrollVelocity.value.set(self.foamScrollVelocityVec[0], self.foamScrollVelocityVec[1]);
      //Jerlov preset wins over the explicit RGB vec3s when water_type is in
      //range (1..N). water_type == 0 ⇒ fall through to the custom values.
      const jerlovPreset = ARestlessOcean.JERLOV_PRESETS[self.data.water_type | 0];
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
    self.oceanPatches.push(new ARestlessOcean.OceanPatch(
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

  //═══════════════════════════════════════════════════════════════════════════
  // FFT surface sampling on the CPU — the EXACT rendered water, for buoyancy.
  //═══════════════════════════════════════════════════════════════════════════
  //
  // sampleFFTHeightAt (EXACT, synchronous) reads single texels straight off the
  // GPU. Each call drains the GPU queue (a stall), so it's a DEBUG ground truth
  // only — see ARestlessOcean.debugWaveAt.
  //
  // The scalable path is the LOCAL HEIGHT FIELD below: once every ~frame a tiny
  // GPU pass composites the cascades' height into a small RT covering a region
  // that follows the camera, and we async-read just THAT (a few hundred KB, not
  // the 12 MB of full cascade textures). Every buoyancy query is then a cheap
  // bilinear lookup of the cached field — exact (it IS the rendered surface, so
  // floats ride the water you see) and O(1) per probe regardless of object
  // count. Objects outside the region return null → caller falls back to
  // analytic. Tunables: HEIGHT_FIELD_RES (grid resolution), HEIGHT_FIELD_SIZE
  // (world metres covered → SIZE/RES = m/texel, caps the smallest wave it
  // resolves), HEIGHT_FIELD_INTERVAL_MS (refresh throttle; waves move slowly so
  // ~15 Hz is plenty, the cached field is reused every frame between refreshes).
  const HEIGHT_FIELD_RES = 256;
  const HEIGHT_FIELD_SIZE = 512.0;          //metres; 2 m/texel at res 256.
  const HEIGHT_FIELD_INTERVAL_MS = 66;      //~15 Hz refresh.
  this._hfSnap = null;            //resolved {data, originX, originZ, size, res, time}.
  this._hfSnapPrev = null;        //prior resolved snapshot, kept for dH/dt (rise).
  this._hfBufs = null;            //triple-buffered readback (see _updateHeightField).
  this._hfBackIdx = 0;
  this._hfPending = false;
  this._hfWantedUntil = 0;        //only run while a consumer asked recently.
  this._hfLastIssue = 0;

  //EXACT synchronous single-texel readback — DEBUG ground truth only (each call
  //stalls the GPU queue). See ARestlessOcean.debugWaveAt.
  this.sampleFFTHeightAt = function(x, z){
    const composer = self.oceanHeightComposer;
    if(!composer || !composer.cascadeDisplacementTargets || !composer.cascadeDisplacementTargets[0]) return null;
    self._fftProbeBuf = self._fftProbeBuf || new Float32Array(4);
    const buf = self._fftProbeBuf;
    const res = composer.baseTextureWidth;
    const offsets = self.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
    const whm = composer.waveHeightMultiplier;
    let h = self.heightOffset;
    for(let c = 0; c < composer.cascadeDisplacementTargets.length; c++){
      const patch = composer._cascadePatchSizes[c];
      let u = (x + offsets[c].x) / patch;
      let v = (z + offsets[c].y) / patch;
      u -= Math.floor(u); v -= Math.floor(v);
      const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
      const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
      self.renderer.readRenderTargetPixels(composer.cascadeDisplacementTargets[c], px, py, 1, 1, buf);
      h += buf[1] * whm; //.y (green) = vertical displacement.
    }
    return h;
  };

  //── Local height-field GPU pass (composite cascades → small RT) ─────────────
  //Build the pass once. The fragment shader mirrors the water vertex shader's
  //cascade composition (sum each cascade's .y at (worldXZ+offset)/patch), but
  //over a region grid instead of mesh vertices, and bakes heightOffset + whm in.
  const HF_N = self.oceanHeightComposer.numCascades;
  let hfSumLines = '';
  for(let c = 0; c < HF_N; c++){
    hfSumLines += 'dy += texture2D(hfCascadeTex[' + c + '], (worldXZ + hfCascadeOffset[' + c + ']) / hfCascadePatch[' + c + ']).y;\n';
  }
  const hfVert = 'varying vec2 vHfUv;\nvoid main(){ vHfUv = uv; gl_Position = vec4(position, 1.0); }';
  const hfFrag = [
    'precision highp float;',
    'varying vec2 vHfUv;',
    'uniform sampler2D hfCascadeTex[' + HF_N + '];',
    'uniform vec2 hfCascadeOffset[' + HF_N + '];',
    'uniform float hfCascadePatch[' + HF_N + '];',
    'uniform float hfWhm;',
    'uniform float hfHeightOffset;',
    'uniform vec2 hfRegionOrigin;',
    'uniform float hfRegionSize;',
    'void main(){',
    '  vec2 worldXZ = hfRegionOrigin + vHfUv * hfRegionSize;',
    '  float dy = 0.0;',
    '  ' + hfSumLines,
    '  gl_FragColor = vec4(hfHeightOffset + dy * hfWhm, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');
  this._heightFieldMaterial = new THREE.ShaderMaterial({
    uniforms: {
      hfCascadeTex: {value: new Array(HF_N).fill(null)},
      hfCascadeOffset: {value: (function(){ const a = []; for(let i = 0; i < HF_N; i++) a.push(new THREE.Vector2()); return a; })()},
      hfCascadePatch: {value: new Array(HF_N).fill(1.0)},
      hfWhm: {value: 1.0},
      hfHeightOffset: {value: 0.0},
      hfRegionOrigin: {value: new THREE.Vector2()},
      hfRegionSize: {value: HEIGHT_FIELD_SIZE}
    },
    vertexShader: hfVert,
    fragmentShader: hfFrag,
    depthTest: false,
    depthWrite: false
  });
  this._heightFieldScene = new THREE.Scene();
  this._heightFieldScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._heightFieldMaterial));
  this._heightFieldCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._heightFieldRT = new THREE.WebGLRenderTarget(HEIGHT_FIELD_RES, HEIGHT_FIELD_RES, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat, type: THREE.FloatType,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false
  });
  this._hfN = HF_N;

  //Render the field + issue the async readback. Region follows the camera,
  //snapped to the texel grid so the sampled field doesn't shimmer as it pans.
  this._updateHeightField = function(){
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if(now > self._hfWantedUntil) return;
    if(self._hfPending) return;
    if(now - self._hfLastIssue < HEIGHT_FIELD_INTERVAL_MS) return;
    const composer = self.oceanHeightComposer;
    if(!composer || !composer.cascadeDisplacementTextures || !composer.cascadeDisplacementTextures[0]) return;
    if(typeof self.renderer.readRenderTargetPixelsAsync !== 'function') return;

    const texel = HEIGHT_FIELD_SIZE / HEIGHT_FIELD_RES;
    const originX = Math.floor((self.globalCameraPosition.x - HEIGHT_FIELD_SIZE * 0.5) / texel) * texel;
    const originZ = Math.floor((self.globalCameraPosition.z - HEIGHT_FIELD_SIZE * 0.5) / texel) * texel;
    const u = self._heightFieldMaterial.uniforms;
    const offsets = self.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
    for(let c = 0; c < self._hfN; c++){
      u.hfCascadeTex.value[c] = composer.cascadeDisplacementTextures[c];
      u.hfCascadePatch.value[c] = composer._cascadePatchSizes[c];
      u.hfCascadeOffset.value[c].copy(offsets[c]);
    }
    u.hfWhm.value = composer.waveHeightMultiplier;
    u.hfHeightOffset.value = self.heightOffset;
    u.hfRegionOrigin.value.set(originX, originZ);
    u.hfRegionSize.value = HEIGHT_FIELD_SIZE;

    const prevRT = self.renderer.getRenderTarget();
    self.renderer.setRenderTarget(self._heightFieldRT);
    self.renderer.render(self._heightFieldScene, self._heightFieldCamera);
    self.renderer.setRenderTarget(prevRT);

    if(!self._hfBufs){
      const sz = HEIGHT_FIELD_RES * HEIGHT_FIELD_RES * 4;
      //Triple-buffered: only one read is ever in flight, so 3 buffers guarantee
      //the in-flight write target is neither the current nor the previous
      //snapshot. That lets us retain a stable PREVIOUS field to finite-difference
      //for surface rise (dH/dt) without the next readback clobbering it mid-transfer.
      self._hfBufs = [new Float32Array(sz), new Float32Array(sz), new Float32Array(sz)];
    }
    const buf = self._hfBufs[self._hfBackIdx];
    self._hfPending = true;
    self._hfLastIssue = now;
    self.renderer.readRenderTargetPixelsAsync(self._heightFieldRT, 0, 0, HEIGHT_FIELD_RES, HEIGHT_FIELD_RES, buf).then(function(){
      self._hfSnapPrev = self._hfSnap; //keep the prior field so consumers can read dH/dt.
      self._hfSnap = {data: buf, originX: originX, originZ: originZ, size: HEIGHT_FIELD_SIZE, res: HEIGHT_FIELD_RES, time: now};
      self._hfBackIdx = (self._hfBackIdx + 1) % 3; //rotate; never reuse current/prev.
      self._hfPending = false;
    }).catch(function(){ self._hfPending = false; });
  };

  //Bilinear lookup of a GIVEN resolved snapshot's baked height (.x) at world
  //(x,z). Returns null outside that snapshot's region. Shared by the cached-height,
  //rise and slope samplers below so they all read the same field consistently.
  this._sampleSnapHeight = function(s, x, z){
    if(!s) return null;
    const uu = (x - s.originX) / s.size;
    const vv = (z - s.originZ) / s.size;
    if(uu < 0.0 || uu > 1.0 || vv < 0.0 || vv > 1.0) return null;
    const res = s.res, data = s.data;
    const fx = uu * res - 0.5, fy = vv * res - 0.5;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    let x1 = x0 + 1, y1 = y0 + 1;
    x0 = x0 < 0 ? 0 : (x0 > res - 1 ? res - 1 : x0);
    x1 = x1 < 0 ? 0 : (x1 > res - 1 ? res - 1 : x1);
    y0 = y0 < 0 ? 0 : (y0 > res - 1 ? res - 1 : y0);
    y1 = y1 < 0 ? 0 : (y1 > res - 1 ? res - 1 : y1);
    const h00 = data[(y0 * res + x0) * 4], h10 = data[(y0 * res + x1) * 4];
    const h01 = data[(y1 * res + x0) * 4], h11 = data[(y1 * res + x1) * 4];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * ty;
  };

  //Cheap bilinear lookup of the CURRENT field. Returns null outside the region or
  //before the first field resolves → caller falls back to analytic.
  this.sampleWaterHeightFieldCached = function(x, z){
    return self._sampleSnapHeight(self._hfSnap, x, z);
  };

  //Public surface. Consumers call requestFFTSnapshot() each frame they want the
  //field kept warm (it's off when nothing floats). sampleWaterHeightFFT is the
  //cheap cached path; *Exact is the synchronous debug stall path.
  ARestlessOcean.requestFFTSnapshot = function(){
    self._hfWantedUntil = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) + 1000;
  };
  ARestlessOcean.sampleWaterHeightFFT = function(x, z){ return self.sampleWaterHeightFieldCached(x, z); };
  ARestlessOcean.sampleWaterHeightFFTExact = function(x, z){ return self.sampleFFTHeightAt(x, z); };

  //Phase-correct surface RISE (dH/dt, m/s) at world (x,z): finite difference of
  //the two most recent rendered-FFT snapshots — the rendered water's OWN vertical
  //velocity. The analytic twin shares the spectrum but not the GPU's phases, so
  //its "rising here?" answer fired spray over visibly-flat/trough water (the
  //bunched, mistimed shore bursts). Returns null until two snapshots exist or
  //outside the region → caller falls back to the analytic rate.
  ARestlessOcean.sampleWaterRiseFFT = function(x, z){
    const cur = self._hfSnap, prev = self._hfSnapPrev;
    if(!cur || !prev) return null;
    const dt = (cur.time - prev.time) / 1000.0;
    if(dt <= 1e-4) return null;
    const hc = self._sampleSnapHeight(cur, x, z);
    const hp = self._sampleSnapHeight(prev, x, z);
    if(hc === null || hp === null) return null;
    return (hc - hp) / dt;
  };

  //Phase-correct STEEPNESS (1 - normal.y) at world (x,z) from the rendered-FFT
  //height field's OWN slope (central differences, one texel eps). Same motivation
  //as the rise sampler: the analytic normal peaks on phantom crests, so mist tore
  //off flat water. Returns null outside the region → caller falls back to analytic.
  ARestlessOcean.sampleWaterSlopeFFT = function(x, z){
    const s = self._hfSnap;
    if(!s) return null;
    const eps = s.size / s.res; //one texel (~2 m).
    const hxp = self._sampleSnapHeight(s, x + eps, z);
    const hxn = self._sampleSnapHeight(s, x - eps, z);
    const hzp = self._sampleSnapHeight(s, x, z + eps);
    const hzn = self._sampleSnapHeight(s, x, z - eps);
    if(hxp === null || hxn === null || hzp === null || hzn === null) return null;
    const dhdx = (hxp - hxn) / (2.0 * eps);
    const dhdz = (hzp - hzn) / (2.0 * eps);
    const ny = 1.0 / Math.sqrt(1.0 + dhdx * dhdx + dhdz * dhdz);
    return 1.0 - ny;
  };

  //Build the horizon-skirt mesh and register it as another instance key so the
  //per-frame uniform loop pushes the same FFT-ocean updates into its (cloned)
  //uniforms object. ringIndex is pinned to 5 here and NOT touched in the
  //per-frame loop, so the skirt keeps its coarse cascade-displacement settings.
  //Called at construction when the sky was found in init, and again from tick
  //if a-starry-sky shows up late (see _discoverSkyDirector).
  this._createHorizonSkirt = function(){
    if(self.horizonSkirtMesh){ return; }
    const skirtMaterial = self.oceanMaterial.clone();
    skirtMaterial.depthTest = true;
    skirtMaterial.depthWrite = false;
    skirtMaterial.fog = true;
    //Rebuild the vertex shader with the $horizon_skirt template flag set so
    //the rim verts (well past camera.far) survive frustum clipping via the
    //in-shader Z clamp. See water-vertex.glsl tail. AP readiness is computed
    //live: on the late-discovery path this runs after the AP recompile has
    //already updated self.oceanMaterial, and the clone above picked that up.
    const skirtAtmReady = !!(self.atmosphericPerspectiveEnabled && self.atmosphereFunctionsGLSL);
    skirtMaterial.vertexShader = buildVertexShader(skirtAtmReady, true);
    //Pin a coarse ringIndex so the vertex shader skips the finer cascades
    //2-5 in its displacement sum. The skirt is meant to be flat-ish; we just
    //want the FFT fragment shader to read wave normals at the same XZ.
    skirtMaterial.uniforms.ringIndex.value = 5;
    skirtMaterial.uniforms.sizeOfOceanPatch.value = self.patchSize;

    //RingGeometry: flat ring at y=0 rotated from the default XY plane. Outer
    //radius capped at 1e7 m (10000 km) — the z-clamp keeps the rim fragments
    //alive past camera.far.
    const skirtGeometry = new THREE.RingGeometry(8.0, 1.0e7, 256, 1);
    skirtGeometry.rotateX(-Math.PI / 2);

    //InstancedMesh with a single identity instance — the FFT vertex shader
    //multiplies by `instanceMatrix`, so we need the attribute present even
    //though there is only one "instance" of the skirt.
    self.horizonSkirtMesh = new THREE.InstancedMesh(skirtGeometry, skirtMaterial, 1);
    self.horizonSkirtMesh.setMatrixAt(0, new THREE.Matrix4());
    self.horizonSkirtMesh.instanceMatrix.needsUpdate = true;
    self.horizonSkirtMesh.frustumCulled = false;
    self.horizonSkirtMesh.castShadow = false;
    self.horizonSkirtMesh.receiveShadow = false;
    self.horizonSkirtMesh.renderOrder = 1;
    //Horizon skirt is water-class geometry — move off the default layer so
    //the foam ortho camera does not capture it. See OCEAN_LAYER comment.
    self.horizonSkirtMesh.layers.set(ARestlessOcean.OCEAN_LAYER);
    scene.add(self.horizonSkirtMesh);

    const skirtKey = '__horizon_skirt__';
    oceanPatchGeometryInstances[skirtKey] = self.horizonSkirtMesh;
    oceanGridInstanceKeys.push(skirtKey);
  };
  if(this.atmosphericPerspectiveEnabled && this.skyDirector){
    this._createHorizonSkirt();
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
  //Opacity for the cascade-band overlay (debug mode 40). 0 = scene only,
  //1 = overlay only, 0.5 = half-and-half. Call setOceanShadowDebug(40) first,
  //then setDebugBlend(0.5) to dial how strongly the cascade colours show over
  //the real waves.
  this.setDebugBlend = function(v){
    const blend = +v;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.debugBlend.value = blend;
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
  //SSR march step cap. 48 = full reach (default); try 32/16/8 to find the
  //fps/quality knee; 0 skips the march entirely (sky-only) as a bottleneck A/B.
  this.setSsrMaxSteps = function(v){
    self.ssrMaxSteps = +v;
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
  //Crest-style sun-glint live knobs. setSpecFresnelGate(0..1): 0 = legacy
  //ungated additive glint, 1 = Crest Fresnel-gated. setSpecFalloffFar /
  //setSpecFalloffFarDist drive the distance lobe-widening ramp (far defaults
  //to 275 = near, a no-op until lowered). setSpecBoost is _DirectionalLightBoost.
  this.setSpecFresnelGate = function(v){
    self.specFresnelGate = +v;
  };
  this.setSpecBoost = function(v){
    self.specBoost = +v;
  };
  this.setSpecFalloffFar = function(v){
    self.specFalloffFar = +v;
  };
  this.setSpecFalloffFarDist = function(v){
    self.specFalloffFarDist = +v;
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

  //$DEBUG_START$
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
    window.setDebugBlend = this.setDebugBlend;
    window.setSunShadowEnabled = this.setSunShadowEnabled;
    window.setOceanShadowEnabled = this.setOceanShadowEnabled;
    window.setOceanShadowNormalBias = this.setOceanShadowNormalBias;
    window.setOceanEvsmExpC = this.setOceanEvsmExpC;
    window.setOceanEvsmMinVariance = this.setOceanEvsmMinVariance;
    window.setOceanEvsmLightBleedReduction = this.setOceanEvsmLightBleedReduction;
    window.setReflectionScale = this.setReflectionScale;
    window.setSsrMaxSteps = this.setSsrMaxSteps;
    window.setReflectionDistanceFalloff = this.setReflectionDistanceFalloff;
    window.setFresnelDistanceRoughness = this.setFresnelDistanceRoughness;
    window.setSurfaceRoughness = this.setSurfaceRoughness;
    window.setSpecFresnelGate = this.setSpecFresnelGate;
    window.setSpecBoost = this.setSpecBoost;
    window.setSpecFalloffFar = this.setSpecFalloffFar;
    window.setSpecFalloffFarDist = this.setSpecFalloffFarDist;
    window.setOceanWireframe = this.setOceanWireframe;
    window.setAtmDistanceScale = this.setAtmDistanceScale;
    //Direct handle on the grid instance for console probes (RT readback etc.).
    window.oceanGrid = self;
    //Splash particles: debug tint (0 normal, 1 tint-by-type), master toggle, and
    //a direct handle on the OceanSplash instance for live-tuning its plain-JS
    //knobs (e.g. oceanSplash.crestSpawnChance = 0.2).
    window.setSplashDebug = function(n){ if(self.oceanSplash) self.oceanSplash.debugMode = n | 0; };
    window.setSplashEnabled = function(e){ if(self.oceanSplash) self.oceanSplash.enabled = !!e; };
    //Debug surface probe: a red ball parked on the sampled emission surface in
    //front of the camera, to check whether spawn HEIGHT tracks the visible
    //waterline. The probe is a child of the splash mesh, which only renders when
    //the system is enabled, so turning the probe on also forces enabled = true.
    window.setSplashMarker = function(e){
      if(!self.oceanSplash) return;
      self.oceanSplash.debugMarker = !!e;
      if(e) self.oceanSplash.enabled = true;
    };
    window.oceanSplash = self.oceanSplash;
    //Reflection-vector shore launch: setSplashReflect(reflect, runUp) tunes how the
    //impact sheet leaves a cliff. reflect 0=cone up the surface normal (old look),
    //1=mirror the incoming water off the face; runUp adds upward climb on a head-on
    //slam. e.g. setSplashReflect(1, 1.2) (defaults) → tall directional cliff sheets.
    window.setSplashReflect = function(reflect, runUp){
      if(!self.oceanSplash) return;
      if(reflect !== undefined) self.oceanSplash.impactReflect = +reflect;
      if(runUp !== undefined) self.oceanSplash.impactRunUp = +runUp;
    };
    //Wind-driven foam ("dip the Jacobian"): tune the storm-whitening ramp live.
    //setFoamWindBiasMax(0.6) sets the cap; setFoamWindRange(10,50) the m/s window.
    window.setFoamWindBiasMax = function(v){ self.foamWindBiasMax = +v; };
    window.setFoamWindRange = function(start, full){ self.foamWindStart = +start; self.foamWindFull = +full; };
  }
  //$DEBUG_END$
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
        oceanMesh.material.side = under ? THREE.BackSide : THREE.FrontSide;
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
    //Mirror across the DISPLACED surface at the camera's XZ (last frame's
    //CPU probe), not the flat rest plane. The chunk's `uwSurfaceY` is also
    //the displaced height (set from `-_oceanFog.near`), so this keeps the
    //mirror's reference plane and the chunk's fog-crossing plane in sync —
    //the complementary segment compose (chunk fogs |SP|, applyUnderwaterFog
    //fogs |CS|) only sums to the true bounce-path length when both planes
    //agree. Falls back to heightOffset before the first probe runs. Wave
    //amplitude away from the camera's XZ is still an unmodelled error, but
    //bringing the camera-XZ height into the mirror plane removes the bulk
    //of the mismatch under any swell.
    const h = (self._lastWaterSurfaceY !== undefined)
      ? self._lastWaterSurfaceY
      : self.heightOffset;
    const reflCam = self._reflectionCamera;
    if(!self._reflScratch){
      self._reflScratch = {
        pos: new THREE.Vector3(), fwd: new THREE.Vector3(),
        up: new THREE.Vector3(), quat: new THREE.Quaternion(),
        target: new THREE.Vector3(), clearColor: new THREE.Color(),
        murk: new THREE.Color()
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

    //Note: the mirror cam is the VIEWER mirrored across the rest plane, NOT the
    //camera-at-the-reflecting-pixel. When the viewer is underwater (mainCamY < h)
    //the mirror cam is ABOVE water (mirrorCamY = 2h - mainCamY > h), so the
    //chunk's uwCamDepth clamps to 0 in this pass. That's compensated by swapping
    //the pre-darkened _uwBaselineCamDepth into the fogColor for the mirror pass
    //(see the murk block), so the reflected ceiling fogs toward the same depth
    //equilibrium as the direct seabed. (This was probed as a suspected
    //direct-vs-reflected divergence — ruled out: the depth cancels between views.)

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
    //Keep the underwater curtain visible in the mirror so the direct view and
    //the reflected view share the same backdrop. Hiding it left empty mirror
    //directions falling back to the dark clear colour while the direct view
    //filled the same directions with the murk-coloured curtain — so the
    //reflected horizon colours stopped matching the direct horizon.

    const prevRT = self.renderer.getRenderTarget();
    const prevToneMapping = self.renderer.toneMapping;
    self.renderer.getClearColor(s.clearColor);
    const prevClearAlpha = self.renderer.getClearAlpha();

    //Force scene.fog to the UNDERWATER ocean fog for the mirror RT (don't just
    //inherit it). The chunk then fogs the reflected geometry over the bounce
    //path: by the reflection-trick equivalence the mirror camera's straight-line
    //distance to a fragment equals the real cam→surface→reflected-point path, so
    //it's one segment. Setting it explicitly (rather than relying on the prior
    //frame's swap still being mounted) guarantees the reflection never picks up
    //the atmospheric fog on the boundary frame. Only do it when the ocean fog is
    //actually armed (chunk injected); otherwise leave whatever is mounted.
    const prevFog = scene.fog;
    if(self._fogChunkInjected){ scene.fog = self._oceanFog; }
    //Swap the chunk's fogColor to the CAMERA-DEPTH-darkened baseline for this
    //pass so the reflected geometry fogs toward the same teal the direct seabed
    //reaches (see _uwBaselineCamDepth). The mirror cam is above water so the
    //chunk can't derive the camera-depth darkening itself. Save/restore the raw
    //RGB (the tick rewrites fogColor from _uwMurkScratch every frame anyway).
    const prevFogColorR = self._oceanFog.color.r;
    const prevFogColorG = self._oceanFog.color.g;
    const prevFogColorB = self._oceanFog.color.b;
    if(self._uwBaselineCamDepth){
      //SRGBToLinear pre-comp (see _toFogUniform) — same reason as the main pass.
      self._oceanFog.color.setRGB(self._toFogUniform(self._uwBaselineCamDepth.x),
                                  self._toFogUniform(self._uwBaselineCamDepth.y),
                                  self._toFogUniform(self._uwBaselineCamDepth.z));
    }
    //fogFar MUST stay > 0 here. a-starry-sky's fog_fragment routes on
    //`if(fogFar <= 0.0)` → its ATMOSPHERIC-perspective branch, checked BEFORE
    //our `else if(fogNear < 0.0)` ocean branch. The old NEGATIVE sign (meant to
    //signal "linear output" to our chunk) therefore sent the whole mirror pass
    //into a-starry-sky's atmospheric fog — our ocean chunk never ran in the
    //reflection at all, so the reflected geometry read bright/atmospheric
    //instead of teal. So we carry the linear/sRGB flag in fogFar's MAGNITUDE, not its
    //sign: add a +10 offset for the linear RT pass (range [10,11]) vs the main
    //canvas's bare sunFrac (range [0,1]). The chunk reads `fogFar > 5.0` ⇒
    //linear output (skip the sRGB roundtrip — this RT is NoToneMapping linear
    //HalfFloat, composited pre-tonemap so the single main-canvas tonemap encodes
    //once), and recovers sunFrac as `fogFar - 10.0`. Both passes keep fogFar > 0
    //so both correctly land in the ocean branch. Falls back to 0.5 if the probe
    //hasn't populated _uwSunFrac yet.
    const prevFogFar = self._oceanFog.far;
    const sunFracForRT = (self._uwSunFrac !== undefined) ? self._uwSunFrac : 0.5;
    self._oceanFog.far = sunFracForRT + 10.0;

    //Clip everything above the waterline out of the mirror cam's render.
    //Without this, cave walls, the above-water portion of the lighthouse, and
    //any other stationary world geometry sitting above the surface lands in
    //the RT and gets sampled by the underwater ceiling shader's TIR lookup —
    //producing the "dark band of cave stone where the underwater rock should
    //be reflected" artifact at the waterline. The water grid itself is hidden
    //by the caller, so the wavy ocean surface never collides with this plane.
    //Plane convention: distance(p) = normal·p + constant; fragments with
    //distance < 0 are clipped. normal=(0,-1,0), constant=waterSurfaceY clips
    //fragments where y > waterSurfaceY (above water).
    if(!self._reflClipPlane){
      self._reflClipPlane = new THREE.Plane(new THREE.Vector3(0.0, -1.0, 0.0), 0.0);
    }
    self._reflClipPlane.constant = h;
    const prevClippingPlanes = self.renderer.clippingPlanes;
    const prevLocalClipping = self.renderer.localClippingEnabled;
    self.renderer.clippingPlanes = [self._reflClipPlane];
    self.renderer.localClippingEnabled = true;

    //Linear output (NoToneMapping) so the colour feeds straight into the
    //ceiling's linear composite without a tone-map / encode round-trip.
    self.renderer.toneMapping = THREE.NoToneMapping;
    self.renderer.setRenderTarget(self._reflectionTarget);
    //Clear to the SURFACE-level inscatter murk (LINEAR — the RT is NoToneMapping
    //and feeds the ceiling's linear composite directly), not black and not the
    //camera-depth murk. This RT is the reflected (post-bounce) leg, whose path
    //starts at the surface, so its infinite-depth equilibrium is the surface
    //murk — the SAME teal the reflected geometry fogs to (mirror cam above water
    //→ uwCamDepth 0). Empty/curtain-gap directions then match the reflected
    //seabed instead of going dim, so the ceiling's TIR lookup reads teal, not a
    //dark void. Falls back to the camera-depth murk, then a seeded default,
    //before the first surface-murk update (one-frame lag, invisible).
    const m = self._uwReflCamDepthMurk || self._uwReflSurfaceMurk || self._uwMurkCamDepthScratch;
    if(m){ s.murk.setRGB(m.x, m.y, m.z); } else { s.murk.setRGB(0.02, 0.06, 0.08); }
    self.renderer.setClearColor(s.murk, 1.0);
    self.renderer.clear();
    self.renderer.render(scene, reflCam);

    self.renderer.clippingPlanes = prevClippingPlanes;
    self.renderer.localClippingEnabled = prevLocalClipping;
    self._oceanFog.far = prevFogFar;
    self._oceanFog.color.setRGB(prevFogColorR, prevFogColorG, prevFogColorB);
    scene.fog = prevFog;
    self.renderer.setClearColor(s.clearColor, prevClearAlpha);
    self.renderer.toneMapping = prevToneMapping;
    self.renderer.setRenderTarget(prevRT);
    if(skyMesh){ skyMesh.visible = skyWasVisible; }
  };

  //Pre-compile the underwater shader variants during load so the FIRST dip
  //doesn't stall. The only NEW program variant introduced underwater is the
  //clipping one: _renderUnderwaterReflection renders the whole scene with a
  //renderer-level clipping plane, and going from zero clipping planes to one
  //changes NUM_CLIPPING_PLANES, forcing every scene material to recompile the
  //first time it's drawn clipped (the multi-hundred-ms hitch on first
  //submersion; smooth after, once both variants are cached). Nothing else that
  //flips underwater changes a program: the ocean fog and a-starry-sky fog are
  //both linear THREE.Fog sharing ONE program (they differ only in uniform
  //values, and the fog-chunk injection already rebuilt that program above
  //water via its own needsUpdate sweep); .side and .visible are GL state, not
  //defines. So clipping is the whole fix.
  //
  //We warm through the REAL render path, not renderer.compile(): compile() does
  //NOT bake the global clipping-plane define, so it only re-created the no-clip
  //variants that already existed (measured: Programs still jumped +37 on the
  //first dip after a compile()-based warm). Driving the actual reflection pass
  //once renders the whole visible scene under the clip plane, compiling+linking
  //every clipping variant now (one controlled frame at load) instead of
  //mid-dive. The pass sets and restores its own fog/clip/sky/RT state, so this
  //is self-contained; the throwaway RT contents are discarded. Runs once.
  this._warmUnderwaterShaders = function(){
    if(self._underwaterShadersWarmed) return;
    if(!self.scene || !self.camera || !self.renderer) return;
    if(!self._reflectionTarget || !self._aboveWaterTransmissionTarget) return;
    try {
      //Reflection = the clipping warm (the +37). Transmission adds no new
      //programs (same materials as a normal above-water frame) but is cheap and
      //keeps the Snell-window source primed too.
      self._renderUnderwaterReflection(self.scene, self.camera);
      self._renderAboveWaterTransmission(self.scene, self.camera);
    } catch(e){ /* best-effort warm; never break the frame over a precompile */ }
    self._underwaterShadersWarmed = true;
  };

  //Render the fully-lit above-water scene from the submerged camera into the
  //above-water transmission target — the source the underwater ceiling's
  //Snell-window transmitted ray samples. The refraction G-buffer can't serve
  //this role (raw albedo, sky dome hidden, no atmospheric fog), so this
  //replays the same camera with: sky dome restored, materials un-swapped,
  //scene.fog handed back to a-starry-sky's atmospheric-perspective version
  //(so above-water terrain hazes naturally), ocean grid + curtain hidden
  //(they'd occlude the upward view). Linear output so the colour drops
  //straight into the ceiling composite. Caller hides the ocean grid; we
  //handle the rest.
  this._renderAboveWaterTransmission = function(scene, mainCamera){
    if(!self._uwTxScratch){
      self._uwTxScratch = { clearColor: new THREE.Color() };
    }
    const s = self._uwTxScratch;

    const atmRenderer = self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.atmosphereRenderer;
    const skyMesh = atmRenderer && atmRenderer.skyMesh;
    const skyWasVisible = skyMesh ? skyMesh.visible : false;
    if(skyMesh){ skyMesh.visible = true; }

    //Sun/moon disk planes are hidden underwater for the main render (sky-dome
    //swap), but the Snell window should still show them refracted through the
    //surface — so force them visible just for this above-water capture and
    //restore afterward (mirrors skyMesh above).
    const rends = self.skyDirector && self.skyDirector.renderers;
    const sunMesh = rends && rends.sunRenderer && rends.sunRenderer.sunMesh;
    const moonMesh = rends && rends.moonRenderer && rends.moonRenderer.moonMesh;
    const sunWasVisible = sunMesh ? sunMesh.visible : false;
    const moonWasVisible = moonMesh ? moonMesh.visible : false;
    if(sunMesh){ sunMesh.visible = true; }
    if(moonMesh){ moonMesh.visible = true; }

    const curtain = self.underwaterCurtainMesh;
    const curtainWasVisible = curtain ? curtain.visible : false;
    if(curtain){ curtain.visible = false; }

    //Swap the ocean underwater fog for the captured above-water fog (the
    //a-starry-sky atmospheric perspective version, captured in tick on every
    //above-water frame). Above-water fragments would otherwise get NO fog
    //at all here — the ocean chunk's world-Y gate excludes them, and the
    //atmospheric perspective branch isn't entered when scene.fog is the
    //ocean fog. Fall back to whatever's mounted if no capture exists yet.
    const prevFog = scene.fog;
    if(self._capturedSkyFog !== undefined){
      scene.fog = self._capturedSkyFog;
    }

    //Background swap — while submerged scene.background was set to the
    //murk colour; for this pass we want the captured above-water bg (the
    //sky colour) so cleared/sky-dome pixels read correctly.
    const prevBackground = scene.background;
    if(self._aboveWaterBackground !== undefined){
      scene.background = self._aboveWaterBackground;
    }

    const prevRT = self.renderer.getRenderTarget();
    const prevToneMapping = self.renderer.toneMapping;
    self.renderer.getClearColor(s.clearColor);
    const prevClearAlpha = self.renderer.getClearAlpha();

    //Linear output — feeds straight into the ceiling's linear composite
    //without a tone-map / encode round-trip.
    self.renderer.toneMapping = THREE.NoToneMapping;
    self.renderer.setRenderTarget(self._aboveWaterTransmissionTarget);
    self.renderer.setClearColor(0x000000, 1.0);
    self.renderer.clear();
    self.renderer.render(scene, mainCamera);

    scene.fog = prevFog;
    scene.background = prevBackground;
    self.renderer.setClearColor(s.clearColor, prevClearAlpha);
    self.renderer.toneMapping = prevToneMapping;
    self.renderer.setRenderTarget(prevRT);
    if(skyMesh){ skyMesh.visible = skyWasVisible; }
    if(sunMesh){ sunMesh.visible = sunWasVisible; }
    if(moonMesh){ moonMesh.visible = moonWasVisible; }
    if(curtain){ curtain.visible = curtainWasVisible; }
  };

  //Refresh the underwater caustic projector. Positions the SpotLight high
  //above the camera down the refracted sun ray (a near-parallel cast so
  //caustic cell size barely changes with seabed depth), re-renders the
  //animated caustic slide through the projector's own shadow camera (world-
  //anchored — see the constructor block), and crossfades its intensity
  //through the waterline via underwaterFactor. The projector tracks the
  //camera XZ continuously; world anchoring lives in the slide content, so no
  //snapping and no envelope/shadow jumps. Skipped entirely above water.
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
    //castShadow stays true (constructor note), so the spot's shadow depth pass
    //still runs while surfaced — park the projector far below the world so
    //that pass frustum-culls every caster and costs nothing. The y-check makes
    //the park a one-time move per surfacing, not a per-frame write.
    if(!self.causticMap || underwaterFactor <= 0.001){
      light.intensity = 0.0;
      if(light.position.y > -9000.0){
        light.position.set(0.0, -10000.0, 0.0);
        light.target.position.set(0.0, -10400.0, 0.0);
        light.target.updateMatrixWorld();
      }
      return;
    }

    //Surface anchor: the camera XZ, unsnapped — the slide pass below bakes
    //world anchoring into the pattern itself, so the projector (and with it
    //the cone envelope, decay vignette and shadow POV) moves smoothly.
    const anchorX = self.globalCameraPosition.x;
    const anchorZ = self.globalCameraPosition.z;

    //Sun travel direction (from the brightest directional light toward the
    //scene — downward when the sun is up). Drives BOTH the projector tilt below
    //and the colour/brightness. cosZ is the same geometric "how much sun
    //overhead" factor the underwater inscatter uses (water-shader.glsl :1391),
    //so caustic falloff at low sun matches the rest of the underwater lighting
    //stack; without it a sun 1° above the horizon would cast full strength.
    let sunMult = 1.0;
    let haveSun = false;
    const sunDir = self._uwSunDirScratch;
    if(self.brightestDirectionalLight){
      const ml = self.brightestDirectionalLight;
      light.color.copy(ml.color);
      sunDir.set(ml.position.x, ml.position.y, ml.position.z)
        .sub(ml.target.position).negate().normalize();
      const cosZ = Math.max(-sunDir.y, 0.0);
      //Schlick air->water transmission (same as the murk dir term above) —
      //at grazing sun most light reflects OFF the surface and never enters
      //the water, so caustics must die toward sunset with the rest of the
      //underwater light, not linger at cosZ strength.
      const oneMinusCosZ = 1.0 - cosZ;
      const fresAW = 0.02037 + (1.0 - 0.02037)
                   * (oneMinusCosZ*oneMinusCosZ*oneMinusCosZ*oneMinusCosZ*oneMinusCosZ);
      sunMult = ml.intensity * cosZ * (1.0 - fresAW);
      haveSun = cosZ > 0.0;
    }

    //Tilt the projector along the sun ray REFRACTED into the water (Snell,
    //air→water n=1/1.33 at a flat +Y surface) instead of casting straight down,
    //so the caustic web rakes across the seabed at the true sun angle. refr is
    //the in-water travel direction — still downward, just leaned toward the
    //anti-solar azimuth. It collapses to (0,-1,0) at solar zenith, so this is a
    //pure superset of the old straight-down cast. Total internal reflection
    //can't occur air→water, but k<0 is guarded anyway; we also fall back to
    //straight down when the sun is at/below the horizon (projector is off via
    //sunMult→0 there regardless).
    const refr = self._causticRefrScratch;
    if(haveSun){
      const eta = 1.0 / 1.33;
      const nDotI = sunDir.y;                       //dot((0,1,0), sunDir)
      const k = 1.0 - eta * eta * (1.0 - nDotI * nDotI);
      if(k >= 0.0){
        const scale = eta * nDotI + Math.sqrt(k);   //R = eta*I - scale*N
        refr.set(eta * sunDir.x, eta * sunDir.y - scale, eta * sunDir.z).normalize();
      } else {
        refr.set(0.0, -1.0, 0.0);
      }
    } else {
      refr.set(0.0, -1.0, 0.0);
    }
    //Place the projector one causticLightHeight UP the ray from the surface
    //anchor and the target down-ray; (target − position) ∝ refr ⇒ the cone axis
    //is the refracted sun ray, and a surface-level fragment stays exactly
    //causticLightHeight from the projector (keeps decayCompensation valid).
    const h = self.causticLightHeight;
    light.position.set(anchorX - refr.x * h, waterSurfaceY - refr.y * h, anchorZ - refr.z * h);
    light.target.position.set(anchorX + refr.x * 100.0, waterSurfaceY + refr.y * 100.0, anchorZ + refr.z * 100.0);
    light.target.updateMatrixWorld();
    light.angle = Math.atan(self.causticLightConeRadius / self.causticLightHeight);
    //Compensate for the projector's inverse-square decay so the surface-level
    //caustic brightness is invariant to `causticLightHeight`. A fragment at
    //y = surfaceY sits `causticLightHeight` metres from the projector; that
    //gives a `1 / height^decay` attenuation we cancel here. Fragments deeper
    //than the surface still attenuate (their distance to the projector is
    //larger), producing the depth falloff this decay was added for.
    const decayCompensation = Math.pow(self.causticLightHeight, light.decay);
    light.intensity = self.causticLightIntensity * self.causticsStrength
                    * underwaterFactor * sunMult * decayCompensation;

    //Re-render the animated caustic slide LAST, through the projector pose
    //set above. shadow.updateMatrices is the same call WebGLLights makes when
    //it projects the cookie, so the camera we unproject the slide through is
    //bit-identical to the one that casts it back out.
    light.updateWorldMatrix(true, false);
    light.shadow.updateMatrices(light);
    const shadowCam = light.shadow.camera;
    const mat = self._causticProjectionMaterial;
    mat.uniforms.causticMap.value = self.causticMap;
    mat.uniforms.uTime.value = time * 0.001;
    mat.uniforms.uSurfaceY.value = waterSurfaceY;
    mat.uniforms.uInvVP.value.copy(shadowCam.matrixWorld).multiply(shadowCam.projectionMatrixInverse);
    const prevRT = self.renderer.getRenderTarget();
    self.renderer.setRenderTarget(self._causticProjectionTarget);
    self.renderer.render(self._causticProjectionScene, self._causticProjectionCamera);
    self.renderer.setRenderTarget(prevRT);
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
    const parsFragChunk = THREE.ShaderChunk.fog_pars_fragment;
    if(!fragChunk || fragChunk.indexOf(fragToken) === -1) return;  //not patched yet

    //fog_pars_fragment runs at file scope (uniform declarations). Append our
    //sun-direction uniform there — fog_fragment runs inside main() so uniform
    //declarations don't work in our reservation slot. Idempotent guard so
    //repeated calls don't accumulate copies.
    if(parsFragChunk && parsFragChunk.indexOf('uniform vec3 uwSunDir;') === -1){
      THREE.ShaderChunk.fog_pars_fragment = parsFragChunk + '\nuniform vec3 uwSunDir;\n';
    }

    //Per-channel extinction (1/m) baked into the chunk as a const vec3 —
    //THREE.Fog only smuggles one Color + two floats, so for per-channel
    //chromatic falloff (red dies faster than blue, the cue that distant
    //underwater geometry reads cyan/blue) we inject extinction directly. It
    //is read once at the current water_type / explicit RGB; a live water-type
    //swap would need a chunk re-injection + needsUpdate sweep (rare, paid as
    //a one-time recompile when it happens).
    const presetJ = ARestlessOcean.JERLOV_PRESETS[self.data.water_type | 0];
    const absV = presetJ ? presetJ.absorption : self.data.water_absorption;
    const sctV = presetJ ? presetJ.scattering : self.data.water_scattering;
    const ex = Math.max(absV.x + sctV.x, 1e-4);
    const ey = Math.max(absV.y + sctV.y, 1e-4);
    const ez = Math.max(absV.z + sctV.z, 1e-4);
    const extLit = 'vec3(' + ex.toFixed(6) + ',' + ey.toFixed(6) + ',' + ez.toFixed(6) + ')';
    //Per-channel multiple-scatter ratio for the diffuse "ocean colour" glow the
    //chunk adds below. fogColor already carries albedo·(E_sun+E_sky)/4π, and we
    //want fogColor·uwMsRatio == R∞·(E_sun+E_sky)/π — the semi-infinite diffuse
    //reflectance term that matches water-shader.glsl's underwaterInscatterSurface.
    //Solving: uwMsRatio = 4·R∞/albedo, R∞ = (1-√(1-a))/(1+√(1-a)). ~4× the old
    //a²/(1-a)/(4π) floor at ocean albedos (~0.2) so the murk reads as real teal.
    const rInf = function(a){ const s = Math.sqrt(Math.max(1.0 - a, 0.0)); return (1.0 - s) / (1.0 + s); };
    const albMx = (sctV.x / ex), albMy = (sctV.y / ey), albMz = (sctV.z / ez);
    const msx = 4.0 * rInf(albMx) / Math.max(albMx, 1e-4);
    const msy = 4.0 * rInf(albMy) / Math.max(albMy, 1e-4);
    const msz = 4.0 * rInf(albMz) / Math.max(albMz, 1e-4);
    const msLit = 'vec3(' + msx.toFixed(6) + ',' + msy.toFixed(6) + ',' + msz.toFixed(6) + ')';

    //Smuggle convention for the ocean branch (fogFar > 0 && fogNear < 0):
    //  fogColor.rgb = isotropic-baseline inscatter at depth 0, per channel.
    //                 `waterAlbedo · (E_sun + E_sky) / (4π)` — i.e., the
    //                 surface equilibrium AS IF both sun and sky had isotropic
    //                 phase. The chunk re-weights below to push sun through
    //                 Henyey-Greenstein while keeping sky isotropic.
    //  -fogNear     = water surface Y (the waterline) — selects ocean branch
    //                 AND drives the world-Y gate.
    //  fogFar       = signed sun-fraction smuggle:
    //                   sign(fogFar)  → linear-vs-sRGB target encoding
    //                                   (+ = sRGB canvas, − = linear RT).
    //                   |fogFar|      → fraction of E_sun in (E_sun + E_sky),
    //                                   used to split HG-vs-isotropic terms.
    //  uwSunDir     = world-space direction sunlight TRAVELS (away from sun),
    //                 matching water-shader.glsl's brightestDirectionalLightDirection.
    //                 Declared in fog_pars_fragment via the append above.
    //Per-channel extinction is the const `uwExt` baked in above.
    //NO WORLD-Y GATE: the ocean branch only runs when the camera is submerged
    //(scene.fog is swapped to the ocean fog underwater; above water it's
    //a-starry-sky's atmospheric fog and this branch is never entered). When
    //submerged the whole view is underwater, so every fragment fogs uniformly.
    //Above-water geometry (the lighthouse etc.) is never DIRECTLY visible from
    //below — any sightline from a submerged camera to an air-side point crosses
    //the surface, and the FFT surface mesh (clipmap + horizon skirt) is rendered
    //along it and overdraws those pixels with the Snell-window transmission
    //composite. So the over-fog on those hidden fragments is masked by the real
    //wavy surface; the surface mesh IS the per-fragment medium boundary. This
    //replaces the old flat `vFogWorldPosition.y < uwSurfaceY` plane gate, whose
    //single-point/2-cascade probe height left a flat fog ceiling that bobbed at
    //the wrong (long-swell-only) frequency and an un-fogged band under crests.
    //The mirror RT independently clips y>waterline (see _renderUnderwater
    //Reflection's _reflClipPlane), so its fragments are all below-surface too —
    //removing the gate doesn't change that pass. vFogWorldPosition is
    //A-Starry-Sky's existing advanced-fog varying; the vertex slot below fills
    //it for the ocean branch (still used for the per-fragment depth darkening).
    const fragGLSL = [
      'const vec3 uwExt = ' + extLit + ';',
      'const vec3 uwMsRatio = ' + msLit + ';',
      //Phase-function constants. g=0.85 is the canonical clean-ocean
      //Henyey-Greenstein asymmetry parameter (Mobley 1994), but a phase
      //that peaked makes perpendicular-to-sun scatter ~100× weaker than
      //the forward halo — the horizon under a noon sun reads nearly black.
      //0.5 (turbid coastal range) lifts the perpendicular contribution so
      //the horizon picks up real sun light and asymptotes to teal. Match
      //the same value in water-shader.glsl's underwaterInscatterSurface.
      //The 1/(4π) is the steradian-normalisation baked into HG.
      'const float UW_HG_G = 0.5;',
      'const float UW_INV_4PI = 0.07957747154;',
      //Gaze-dependence of the murk's SUN single-scatter term. 1.0 = full HG halo
      //(physical: brighter toward the sun); 0.0 = isotropic (view-independent
      //teal) so the direct seabed (down gaze) and reflected ceiling (up gaze)
      //fade to the SAME teal. Kept at 0.0 for the uniform "colour of the water"
      //look. MUST match UW_MURK_GAZE_WEIGHT in water-shader.glsl so the seabed/
      //curtain fog (this chunk) and the ceiling/body fog (the water shader) stay
      //in lockstep. Flip both to 1.0 to restore the physical sun glow.
      'const float UW_MURK_GAZE_WEIGHT = 0.0;',
      //Underwater fog isolation taps — debugging the seabed-vs-ceiling murk match.
      //MUST match UW_DEBUG_FOG_MODE in water-shader.glsl applyUnderwaterFog.
      //  0 = normal production blend.
      //  1 = NO fog (raw input color passes straight through).
      //  2 = fog a CONSTANT input color (vec3(0.5)) — isolates the fog blend
      //      from the geometry colour; both paths start from the same input.
      //  3 = output the MURK only (full fog) — shows EXACTLY what each path
      //      fades to. Top (ceiling murk) vs bottom (this seabed murk).
      'const int UW_DEBUG_FOG_MODE = 0;',
      //Underwater path-length scale. 1.0 = physically true geometric distance:
      //extinction integrates over the REAL ray length, no magnification — the
      //distance to a rock is the distance to a rock, a surface->floor reflection
      //bounce is just its real longer path. Was 0.3, a non-physical clarity fudge
      //(see the matching note in water-shader.glsl). Set water visibility via
      //water_type / the Jerlov coefficients instead. Must match the water-shader
      //UW_DIST_SCALE so the ceiling and direct-view seabed asymptote to the same
      //effective extinction.
      'const float UW_DIST_SCALE = 1.0;',
      //Downwelling depth attenuation of the SURFACE lighting (distinct from the
      //inscatter fog). The light that illuminates a fragment travelled DOWN
      //through the water column to reach it, so it is Beer-Lambert attenuated by
      //the fragment's vertical depth below the surface — the same physics the
      //water-shader seabed branch applies to its sun term (exp(-extinction*downPath)).
      //Without this, nearby geometry (rocks, seabed, hull) renders at full
      //THREE-lit brightness no matter how deep the dive, because uwT≈1 at short
      //range. We reuse uwExt so red dies first → deep geometry reads blue-green
      //then dark, matching the water colour. 1.0 = physically full attenuation;
      //lower toward 0 to keep deep geometry brighter/more visible (stylistic).
      'const float UW_DOWNWELL_STRENGTH = 1.0;',
      'float uwSurfaceY = -fogNear;',
      //Path length is the true geometric distance through water (x the 1.0 scale
      //above). Direction-isotropic — a surface at the camera's own depth fogs the
      //same as one above or below it at the same range.
      //  * MAIN render (real camera below water): the whole camera→frag ray
      //    is in water → discount the full geometric length.
      //  * MIRROR render (mirror camera above water, by the reflection-trick
      //    equivalence the mirror straight-line = the real bounce path): the
      //    camera→bounce segment is ALREADY fogged by the water shader's
      //    applyUnderwaterFog at the ceiling, so this branch only fogs the
      //    post-bounce leg = (1 - t)·totalLen, then applies the same discount.
      //    For an object TOUCHING the surface t collapses to the frag →
      //    second leg = 0 → no extra fog, so the reflection of that touching
      //    point matches the surrounding water surface.
      '  vec3 dir = vFogWorldPosition - cameraPosition;',
      '  float totalLen = length(dir);',
      '  float uwDist;',
      '  if(cameraPosition.y < uwSurfaceY){',
      '    uwDist = totalLen * UW_DIST_SCALE;',
      '  } else {',
      '    float t = (uwSurfaceY - cameraPosition.y) / dir.y;',
      '    t = clamp(t, 0.0, 1.0);',
      '    uwDist = (1.0 - t) * totalLen * UW_DIST_SCALE;',
      '  }',
      '  vec3 uwT = exp(-uwExt * uwDist);',
      //HG sun phase. cosθ = dot(incident, scattered) = dot(uwSunDir, -viewDir)
      //= -dot(uwSunDir, viewDir). cosθ ≈ +1 when the camera looks TOWARD the
      //sun (forward scatter, peaked HG); ≈ -1 looking down-sun.
      '  vec3 uwViewDir = (totalLen > 1e-4) ? (dir / totalLen) : vec3(0.0, -1.0, 0.0);',
      '  float uwCosTheta = -dot(uwViewDir, uwSunDir);',
      '  float uwG2 = UW_HG_G * UW_HG_G;',
      '  float uwHG = (1.0 - uwG2) * UW_INV_4PI',
      '             / pow(max(1.0 + uwG2 - 2.0 * UW_HG_G * uwCosTheta, 1e-4), 1.5);',
      //Angular factor that turns the isotropic-baseline fogColor into the
      //actual physical inscatter. Derivation: real = α·(E_sun·p_HG + E_sky·p_sky),
      //baseline (full iso) = α·(E_sun + E_sky)·(1/4π). With sunFrac = E_sun/(E_sun+E_sky):
      //  real / baseline = 4π · sunFrac · p_HG + 2 · (1 - sunFrac)
      //  (sky uses p_sky = 1/(2π) for a uniform upper-hemisphere with isotropic
      //   phase; 4π·1/(2π) = 2). |fogFar| carries sunFrac, sign carries
      //   linear/sRGB.
      //fogFar magnitude carries BOTH the sunFrac and the output-domain flag:
      //  main canvas (sRGB) → fogFar = sunFrac        in [0,1]
      //  reflection RT (linear) → fogFar = sunFrac+10 in [10,11]
      //The sign can't carry the flag — a-starry-sky reserves fogFar<=0 for its
      //atmospheric branch (which would steal this whole pass from us). >5 ⇒
      //linear RT output, skip the sRGB roundtrip; else sRGB main canvas.
      '  bool uwInputIsSRGB = fogFar < 5.0;',
      '  float uwSunFrac = uwInputIsSRGB ? fogFar : (fogFar - 10.0);',
      //Blend the HG halo toward isotropic (1/4π) by UW_MURK_GAZE_WEIGHT — at 0.0
      //the sun term is view-independent, mirroring underwaterInscatterSurface's
      //pSun blend so the direct seabed murk matches the reflected ceiling murk.
      '  float uwHGiso = mix(UW_INV_4PI, uwHG, UW_MURK_GAZE_WEIGHT);',
      '  float uwAngFactor = 4.0 * 3.14159265359 * uwSunFrac * uwHGiso',
      '                    + 2.0 * (1.0 - uwSunFrac);',
      //Single-scatter (angular) term + isotropic multiple-scatter floor. The
      //angular term collapses toward 0 perpendicular to the sun (the horizon
      //under a high sun), which read as black; the MS floor (fogColor·uwMsRatio,
      //view-independent) keeps the distance fading to a real teal. Mirrors
      //water-shader.glsl underwaterInscatterSurface so seabed and ceiling agree.
      '  vec3 uwMurkSurface = fogColor * uwAngFactor + fogColor * uwMsRatio;',
      //Camera-depth darkening (NOT fragment depth). Inscatter is front-loaded
      //near the eye, so the equilibrium every long ray fades to is the medium's
      //radiance at the CAMERA's depth — one "colour of the water" in all
      //directions. Darkening by the far fragment's own depth instead crushed
      //the deep seabed / abyss veil to black and made it disagree with the
      //ceiling (which darkens by ~0) and the curtain (camera depth). Matches
      //water-shader.glsl underwaterInscatterSurface's camDepthDarken. In the
      //mirror RT pass cameraPosition is the above-water mirror cam, so this
      //clamps to 0 — surface-level inscatter for the post-bounce leg, correct.
      //INVESTIGATED 2026-06-06 (camera-Y console probe in _renderUnderwater
      //Reflection): RULED OUT as the direct-vs-reflected brightness divergence.
      //The probe confirmed the mirror cam is always above water when submerged
      //(mirrorCamDepth ≡ 0), so this term IS 0 in the reflection — but the same
      //real depth (mainCamDepth) is applied to BOTH views: directly here for the
      //seabed, and for the reflection via the pre-darkened fogColor swap
      //(_uwBaselineCamDepth) in stage 1 PLUS underwaterInscatterSurface's
      //camDepthDarken (real cam) in stage 2. Identical factor on both sides → it
      //cancels in the comparison and cannot open a gap between them. The real
      //asymmetry left is the HG sun-halo VIEW DIRECTION (this seabed gaze vs the
      //ceiling's up gaze), not the depth term.
      '  float uwCamDepth = max(0.0, uwSurfaceY - cameraPosition.y);',
      '  vec3 uwMurk = uwMurkSurface * exp(-uwExt * uwCamDepth);',
      //fog_fragment runs AFTER colorspace_fragment, so gl_FragColor here is
      //already in the target encoding — the sRGB roundtrip is needed ONLY
      //for the sRGB-encoded path. Doing it unconditionally pushed the
      //reflection RT's linear data through a spurious pow(·, 2.4) cycle.
      '  vec3 uwLinear = uwInputIsSRGB',
      '    ? fogsRGBToLinear(vec4(gl_FragColor.rgb, 1.0)).rgb',
      '    : gl_FragColor.rgb;',
      //Downwelling attenuation of the lit surface colour. uwFragDepth is THIS
      //fragment's depth below the surface (vertical column the light descended
      //through), independent of the camera-depth darkening on the murk above —
      //so no double-count. A fragment at the surface (depth 0) keeps full light;
      //a deep one fades toward dark. Applied only in the production blend so the
      //UW_DEBUG_FOG_MODE isolation taps stay pure diagnostics.
      '  float uwFragDepth = max(0.0, uwSurfaceY - vFogWorldPosition.y);',
      '  vec3 uwDownwell = exp(-uwExt * uwFragDepth * UW_DOWNWELL_STRENGTH);',
      //Fog blend, with the UW_DEBUG_FOG_MODE isolation taps (see const above).
      '  if(UW_DEBUG_FOG_MODE == 1){ /* raw input, no fog */ }',
      '  else if(UW_DEBUG_FOG_MODE == 2){ uwLinear = vec3(0.5) * uwT + uwMurk * (vec3(1.0) - uwT); }',
      '  else if(UW_DEBUG_FOG_MODE == 3){ uwLinear = uwMurk; }',
      '  else { uwLinear = uwLinear * uwDownwell * uwT + uwMurk * (vec3(1.0) - uwT); }',
      //sRGB (main-canvas) path: TONEMAP the fogged result with MyAES before
      //encoding — the renderer is NoToneMapping, so scene geometry arrives here
      //un-tonemapped (raw linear radiance), and without this it would sRGB-encode
      //straight, reading far brighter than the same geometry seen in the water
      //surface or the reflection (both of which go through MyAES). This mirrors
      //a-starry-sky's OWN atmospheric branch, which MyAES-tonemaps its fogged
      //ground — so above-water and below-water scene geometry now tonemap alike.
      //LINEAR RT (reflection) path: do NOT tonemap here — the ceiling composite
      //applies MyAES once when it samples this RT, so tonemapping now would
      //double it.
      '  gl_FragColor.rgb = uwInputIsSRGB',
      '    ? fogLinearTosRGB(vec4(MyAESFilmicToneMapping(uwLinear), 1.0)).rgb',
      '    : uwLinear;'
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

    //Sun-direction broadcast for the chunk's HG sun phase. The chunk's GLSL
    //references `uwSunDir` (world-space, points FROM sun TO scene = the
    //direction sunlight travels — same convention as water-shader.glsl's
    //brightestDirectionalLightDirection). Three's UniformsUtils.clone deep-
    //clones Vector3, so we can't share a single reference via UniformsLib;
    //instead we patch the per-shader-lib uniforms map so NEWLY-built fog
    //materials get the slot, then per-frame traverse the scene and write
    //the current sun direction into each material's local Vector3 clone.
    //_sharedUwSunDir is the source-of-truth that the tick updates; the
    //traversal copies it onto every fog material.
    if(!self._sharedUwSunDir){
      self._sharedUwSunDir = new THREE.Vector3(0.0, -1.0, 0.0);
    }
    const shaderLibNames = ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon'];
    for(let i = 0; i < shaderLibNames.length; ++i){
      const lib = THREE.ShaderLib && THREE.ShaderLib[shaderLibNames[i]];
      if(lib && lib.uniforms && !lib.uniforms.uwSunDir){
        lib.uniforms.uwSunDir = { value: new THREE.Vector3(0.0, -1.0, 0.0) };
      }
    }
    if(THREE.UniformsLib && THREE.UniformsLib.fog && !THREE.UniformsLib.fog.uwSunDir){
      THREE.UniformsLib.fog.uwSunDir = { value: new THREE.Vector3(0.0, -1.0, 0.0) };
    }

    //Rebuild fog-enabled materials already compiled against the old chunk
    //(one-time startup hitch). At the same time, attach the uwSunDir uniform
    //to any material that lacks it — covers existing scenes that were built
    //before the ShaderLib patch above could take effect.
    if(self.scene){
      self.scene.traverse(function(obj){
        if(!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for(let i = 0; i < mats.length; ++i){
          const m = mats[i];
          if(!m || !m.fog) continue;
          if(m.uniforms && !m.uniforms.uwSunDir){
            m.uniforms.uwSunDir = { value: new THREE.Vector3(0.0, -1.0, 0.0) };
          }
          m.needsUpdate = true;
        }
      });
    }
  };

  //Per-frame broadcast of the current sun direction to every fog-receiving
  //material's `uwSunDir` uniform. Source is `self._sharedUwSunDir`, which the
  //tick updates once after probing the directional-light list. Cost is one
  //scene traversal per frame; the per-material write is a Vector3.copy().
  this._broadcastUwSunDir = function(){
    if(!self.scene || !self._sharedUwSunDir) return;
    const src = self._sharedUwSunDir;
    self.scene.traverse(function(obj){
      if(!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for(let i = 0; i < mats.length; ++i){
        const m = mats[i];
        if(!m || !m.fog || !m.uniforms) continue;
        //Self-heal: a material added to the scene AFTER the chunk-injection
        //traversal won't have the slot yet. Attach it on first sight and
        //flag needsUpdate so the next render rebuilds the program with the
        //appended fog_pars_fragment uniform declaration in scope.
        if(!m.uniforms.uwSunDir){
          m.uniforms.uwSunDir = { value: new THREE.Vector3() };
          m.needsUpdate = true;
        }
        m.uniforms.uwSunDir.value.copy(src);
      }
    });
  };

  this.tick = function(time){

    //Late sky discovery — a-starry-sky can initialize after this component
    //(DOM order, dynamic insertion). Init's one-shot lookup would then have
    //missed it and atmospheric perspective would silently never activate, so
    //keep retrying until found. Cheap while unfound (a global/DOM check);
    //free once found. The skirt is created on the same condition init uses;
    //the AP recompile further down picks both up once the LUTs arrive.
    if(self.atmosphericPerspectiveEnabled && !self.skyDirector){
      if(self._discoverSkyDirector()){
        self._createHorizonSkirt();
      }
    }

    //Hide splash particles for the whole offscreen-pass block below (refraction
    //G-buffer, reflection, foam/exclusion orthos, CSM, caustics). They are
    //re-shown at the very end of tick so they appear only in the main render.
    if(self.oceanSplash) self.oceanSplash.mesh.visible = false;

    //Update directional lights list (collect all in scene)
    if(self.directionalLights.length === 0){
      for(let i = 0, numItems = self.scene.children.length; i < numItems; ++i){
        let child = self.scene.children[i];
        if(child.type === 'DirectionalLight'){
          self.directionalLights.push(child);
        }
        //Standalone ambient source for the underwater inscatter term — used
        //only when there's no a-starry-sky skyDirector to supply the y-axis
        //hemispherical. First HemisphereLight found wins.
        else if(!self._fallbackHemiLight && child.type === 'HemisphereLight'){
          self._fallbackHemiLight = child;
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
      self._aboveWaterTransmissionTarget.setSize(
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
    const curtainSkip = self.underwaterCurtainMesh;
    scene.traverse(function(obj){
      if(!obj.isMesh || !obj.visible || !obj.material) return;
      //Skip ShaderMaterial sources — they're custom shaders (ocean, etc.)
      //whose attribute usage we can't safely replace with our G-buffer shader.
      if(obj.material.isShaderMaterial) return;
      if(Array.isArray(obj.material) && obj.material.some(function(m){ return m.isShaderMaterial; })) return;
      //Skip the underwater curtain: a 300 m BackSide sphere would write a
      //spherical shell into refraction depth and the water shader's Snell-
      //window seabed lookup would sample curtain colour instead of seabed.
      if(obj === curtainSkip) return;
      const gBuf = self._resolveGBufferMaterial(obj.material);
      self._swappedMeshes.push({ mesh: obj, original: obj.material });
      obj.material = gBuf;
    });

    const currentRefractionRT = self.renderer.getRenderTarget();
    //Suppress the scene backdrop for this pass. A-Frame's `background` component
    //drives BOTH scene.background AND the renderer clear color/alpha, and THREE
    //clears a render target to those — filling the G-buffer's open-water texels
    //with the sky colour at alpha 1 ("geometry present"), so the water samples
    //the backdrop as its refraction and blends invisibly into it. We force the
    //clear to alpha 0 ("no seabed → fall back to body colour") AND null the
    //background so no background quad re-opaques it. Both restored right after,
    //so the MAIN render still shows the sky. (Mirrors the transmission pass.)
    const _savedBackground = scene.background;
    scene.background = null;
    self._refrClearColor = self._refrClearColor || new THREE.Color();
    self.renderer.getClearColor(self._refrClearColor);
    const _savedClearAlpha = self.renderer.getClearAlpha();
    self.renderer.setClearColor(0x000000, 0.0);
    self.renderer.setRenderTarget(self.refractionGBufferTarget);
    self.renderer.clear();
    self.renderer.render(scene, sceneCamera);
    self.renderer.setRenderTarget(currentRefractionRT);
    self.renderer.setClearColor(self._refrClearColor, _savedClearAlpha);
    scene.background = _savedBackground;

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
      self._renderAboveWaterTransmission(scene, sceneCamera);
    }

    //Update our sea foam camera - use position pass material to output world-space height data
    const currentRenderTarget = self.renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    //Snap foam/exclusion camera XZ to texel-sized increments so the orthos
    //sample the same world-space points across frames — otherwise the foam
    //and exclusion atlases shift by a fractional pixel each frame as the
    //player moves, producing visible flicker on the foam pattern. The water
    //shader must then sample using these SNAPPED positions (uploaded as
    //foamCameraXZ / exclusionCameraXZ uniforms), not raw cameraPosition.
    //Same pattern as the per-cell clipmap snap at the top of this tick.
    const foamTexel = (2.0 * 2048.0) / self.foamRenderTarget.width; // 4096m / 1024px = 4m
    const exclTexel = (2.0 *  250.0) / self.exclusionRenderTarget.width; // 500m / 1024px ≈ 0.488m
    const foamSnapX = Math.round(self.globalCameraPosition.x / foamTexel) * foamTexel;
    const foamSnapZ = Math.round(self.globalCameraPosition.z / foamTexel) * foamTexel;
    const exclSnapX = Math.round(self.globalCameraPosition.x / exclTexel) * exclTexel;
    const exclSnapZ = Math.round(self.globalCameraPosition.z / exclTexel) * exclTexel;
    self._foamCameraXZ = self._foamCameraXZ || new THREE.Vector2();
    self._exclusionCameraXZ = self._exclusionCameraXZ || new THREE.Vector2();
    self._foamCameraXZ.set(foamSnapX, foamSnapZ);
    self._exclusionCameraXZ.set(exclSnapX, exclSnapZ);

    //── Snap-gated re-render ───────────────────────────────────────────────
    //The foam/exclusion orthos capture STATIC terrain height from a fixed
    //top-down view, so their output is INVARIANT to camera yaw — it only
    //changes when the snapped origin translates. Re-rendering identical
    //FloatType atlases every frame during pure rotation was the bulk of the
    //per-frame GPU cost behind the "freezes when I rotate" symptom. We now
    //re-render only on a snap delta, with a periodic forced refresh so slow-
    //moving dynamic occluders (a drifting boat etc.) still imprint their
    //height within FOAM_MAX_STALE_FRAMES.
    const FOAM_MAX_STALE_FRAMES = 30;   // ~0.5 s @60 fps safety refresh
    self._foamStaleFrames = (self._foamStaleFrames || 0) + 1;
    const forceFoamRefresh = !self._foamEverRendered || self._foamStaleFrames >= FOAM_MAX_STALE_FRAMES;
    const renderFoam = forceFoamRefresh || self._lastFoamSnapX !== foamSnapX || self._lastFoamSnapZ !== foamSnapZ;
    const renderExcl = forceFoamRefresh || self._lastExclSnapX !== exclSnapX || self._lastExclSnapZ !== exclSnapZ;

    if(renderFoam || renderExcl){
      self.scene.overrideMaterial = self.positionPassMaterial;
      self.renderer.setClearAlpha(0.0);
      //Null the backdrop for these top-down position passes too. With a
      //scene.background set, THREE's background quad stamps alpha 1 into the
      //foam/exclusion atlases over open water — and the exclusion .a channel is
      //the water shader's discard gate (worldPosition.y > discardHeight). That
      //made every open-water fragment within exclusion range discard (near water
      //gone, horizon — outside range — survived). Restored at the block's end.
      var _foamSavedBackground = scene.background;
      scene.background = null;
      if(renderFoam){
        self.foamCamera.position.set(foamSnapX, this.heightOffset + self.foamCameraHeight, foamSnapZ);
        self.foamCamera.lookAt(foamSnapX, this.heightOffset - 1.0, foamSnapZ);
        self.foamCamera.updateProjectionMatrix();
        self.renderer.setRenderTarget(self.foamRenderTarget);
        self.renderer.clear();
        self.renderer.render(scene, self.foamCamera);
        self.renderer.setRenderTarget(null);
        self._lastFoamSnapX = foamSnapX;
        self._lastFoamSnapZ = foamSnapZ;
        //Copy the just-rendered terrain-height ortho to the CPU (async) so the
        //splash system can detect the shoreline. Only fires on snap-change, so
        //the transfer is rare. Half-width is 2048 m (see foamTexel above).
        if(self.oceanSplash){
          self.oceanSplash.requestTerrainReadback(self.foamRenderTarget, foamSnapX, foamSnapZ, 2048.0);
        }
      }
      if(renderExcl){
        self.exclusionCamera.position.set(exclSnapX, this.heightOffset + self.foamCameraHeight, exclSnapZ);
        self.exclusionCamera.lookAt(exclSnapX, this.heightOffset - 1.0, exclSnapZ);
        self.exclusionCamera.updateProjectionMatrix();
        self.renderer.setRenderTarget(self.exclusionRenderTarget);
        self.renderer.clear();
        //Capture the boat hull DOUBLE-SIDED for this pass only. The boat is a
        //thin/mixed-winding shell, so FrontSide back-face-culls every floor or
        //hull triangle whose normal points away from this top-down camera —
        //those texels capture nothing, read mask 0, and the water is never
        //discarded there, poking through one un-captured triangle at a time
        //("little tris" inside the hull). DoubleSide makes the capture purely
        //depth-based regardless of winding. Restored to FrontSide immediately
        //so the shared foam terrain pass is unaffected. (.side is a cull-state
        //toggle, not a #define — no shader recompile.)
        self.positionPassMaterial.side = THREE.DoubleSide;
        self.renderer.render(scene, self.exclusionCamera);
        self.positionPassMaterial.side = THREE.FrontSide;
        self.renderer.setRenderTarget(null);
        self._lastExclSnapX = exclSnapX;
        self._lastExclSnapZ = exclSnapZ;
      }
      //Restore our original materials + clear state (captured BEFORE zeroing —
      //the old code captured alpha AFTER setClearAlpha(0) and so "restored" 0,
      //leaking a 0 clear alpha into the rest of the frame).
      self.scene.overrideMaterial = null;
      self.renderer.setRenderTarget(currentRenderTarget);
      self.renderer.setClearAlpha(prevClearAlpha);
      scene.background = _foamSavedBackground;
      self._foamStaleFrames = 0;
      self._foamEverRendered = true;
    }
    //foamRenderMap / exclusionMap always point at their (persistent) textures,
    //whether or not we re-rendered this frame.
    this.foamRenderMap = self.foamRenderTarget.texture;
    this.exclusionMap = self.exclusionRenderTarget.texture;

    //Show all of our ocean grid elements again
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].visible = true;
    }

    //Update each of our ocean grid height maps
    self.oceanHeightBandLibrary.tick(time);

    self.oceanHeightComposer.tick();

    //Refresh the local CPU height field for scalable exact buoyancy queries
    //(tiny GPU pass + async read; no-ops unless something asked for it).
    self._updateHeightField();

    //── Underwater submersion probe ────────────────────────────────────────
    //Read two 1-px FFT-displacement texels above/below the camera so the CPU
    //knows the wave-displaced water level — the only way to drive the air/water
    //swap without it popping under passing crests. Cascades 0 (4096 m) + 1
    //(1024 m) carry the dominant swell; the small cascades add at most
    //decimetre chop and are skipped.
    //
    //The read is ASYNC (PBO fence) when the renderer supports it. A synchronous
    //readRenderTargetPixels drains the ENTIRE GPU command queue before it
    //returns, and that stall grows with GPU load — which is exactly why
    //rotating (more geometry in flight) made the frame freeze. The async result
    //lands a few frames later; the surface moves at swell speed and the swap is
    //smoothed over a 1 m band, so the lag is invisible (we already accept a
    //one-frame lag for the reflection mirror plane below). A fresh pair of reads
    //is issued only once the previous pair resolves (_probePending), and the
    //last resolved height is reused every frame in between. Falls back to the
    //blocking read on renderers without readRenderTargetPixelsAsync.
    const composer = self.oceanHeightComposer;
    const probeReady = composer && composer.cascadeDisplacementTextures && composer.cascadeDisplacementTextures[1];
    const canAsyncProbe = typeof self.renderer.readRenderTargetPixelsAsync === 'function';
    if(self._probeWaterSurfaceY === undefined){ self._probeWaterSurfaceY = self.heightOffset; }
    let waterSurfaceY = self._probeWaterSurfaceY;

    if(probeReady && canAsyncProbe){
      if(!self._probePending){
        self._probePending = true;
        self._probeBuf0 = self._probeBuf0 || new Float32Array(4);
        self._probeBuf1 = self._probeBuf1 || new Float32Array(4);
        const bufs = [self._probeBuf0, self._probeBuf1];
        const res = composer.baseTextureWidth;
        const offsets = self.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
        const whm = composer.waveHeightMultiplier;
        const promises = [];
        for(let c = 0; c < 2; ++c){
          const patch = composer._cascadePatchSizes[c];
          let u = (self.globalCameraPosition.x + offsets[c].x) / patch;
          let v = (self.globalCameraPosition.z + offsets[c].y) / patch;
          u -= Math.floor(u);
          v -= Math.floor(v);
          const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
          const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
          const rt = composer.cascadeDisplacementTargets[c];
          promises.push(self.renderer.readRenderTargetPixelsAsync(rt, px, py, 1, 1, bufs[c]));
        }
        Promise.all(promises).then(function(){
          //.y (green) channel = vertical displacement, summed over both cascades.
          self._probeWaterSurfaceY = self.heightOffset + (self._probeBuf0[1] + self._probeBuf1[1]) * whm;
          self._probePending = false;
        }).catch(function(){ self._probePending = false; });
      }
      //waterSurfaceY already holds the last resolved value (set above).
    } else if(probeReady){
      //Blocking fallback (original behaviour) — renderers without async readback.
      self._surfaceProbeBuffer = self._surfaceProbeBuffer || new Float32Array(4);
      const buf = self._surfaceProbeBuffer;
      const res = composer.baseTextureWidth;
      const offsets = self.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
      const whm = composer.waveHeightMultiplier;
      waterSurfaceY = self.heightOffset;
      for(let c = 0; c < 2; ++c){
        const patch = composer._cascadePatchSizes[c];
        let u = (self.globalCameraPosition.x + offsets[c].x) / patch;
        let v = (self.globalCameraPosition.z + offsets[c].y) / patch;
        u -= Math.floor(u);
        v -= Math.floor(v);
        const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
        const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
        const rt = composer.cascadeDisplacementTargets[c];
        self.renderer.readRenderTargetPixels(rt, px, py, 1, 1, buf);
        waterSurfaceY += buf[1] * whm;   //.y (green) channel = vertical displacement
      }
      self._probeWaterSurfaceY = waterSurfaceY;
    }
    //Stash this frame's displaced surface height for next frame's reflection
    //mirror plane (the RT renders BEFORE this probe runs, so there's a
    //one-frame lag — same pattern as `_wasUnderwater`).
    self._lastWaterSurfaceY = waterSurfaceY;
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
    //Warm the underwater (clipping) shader variants once, a short delay after
    //the fog chunk is injected — the delay lets the injection's own needsUpdate
    //recompiles flush first so the warmed clipping program builds against the
    //FINAL chunk source (warming earlier would just get invalidated and rebuilt
    //on the dip, defeating the point). If the player somehow dives within this
    //window the old lazy compile still covers correctness; this only moves the
    //hitch off the dip in the common case.
    if(!self._underwaterShadersWarmed && self._fogChunkInjected){
      self._warmCountdown = (self._warmCountdown === undefined) ? 20 : (self._warmCountdown - 1);
      if(self._warmCountdown <= 0){ self._warmUnderwaterShaders(); }
    }
    if(self.scene){
      if(isUnderwater && self._fogChunkInjected){
        //Murk colour derived from the SAME stack the water shader uses for its
        //own ceiling fog (water-shader.glsl :1344) so the seabed and the
        //ceiling read as the same medium:
        //  waterAlbedo = scattering / (absorption + scattering)
        //  direct      = sunColor * intensity * (1 - fresnelAirToWater) * cosZenith
        //  ambient     = skyAmbientColor (a-starry-sky y-hemispherical)
        //  inscatter   = waterAlbedo * (direct + ambient) / π
        //  depthDarken = exp(-extinction * cameraDepth)   (UNDERWATER_DEPTH_MURK=1)
        //  murk        = inscatter * depthDarken * userBrightness
        const presetJ = ARestlessOcean.JERLOV_PRESETS[self.data.water_type | 0];
        const absV = presetJ ? presetJ.absorption : self.data.water_absorption;
        const sctV = presetJ ? presetJ.scattering : self.data.water_scattering;
        const extX = Math.max(absV.x + sctV.x, 1e-4);
        const extY = Math.max(absV.y + sctV.y, 1e-4);
        const extZ = Math.max(absV.z + sctV.z, 1e-4);
        const albX = sctV.x / extX, albY = sctV.y / extY, albZ = sctV.z / extZ;
        let dirX = 0.0, dirY = 0.0, dirZ = 0.0;
        if(self.brightestDirectionalLight){
          const ml = self.brightestDirectionalLight;
          const i = ml.intensity;
          self._uwSunDirScratch.set(ml.position.x, ml.position.y, ml.position.z)
            .sub(ml.target.position).negate().normalize();
          //cosZenith = max(dot(-sunDir, up), 0); sunDir points sun->target, so -sunDir.y is the lift.
          const cosZ = Math.max(-self._uwSunDirScratch.y, 0.0);
          //Schlick air→water reflectance, r0 = ((1-1.333)/(1+1.333))^2 ≈ 0.02037
          const oneMinusCos = 1.0 - cosZ;
          const fres = 0.02037 + (1.0 - 0.02037) * (oneMinusCos*oneMinusCos*oneMinusCos*oneMinusCos*oneMinusCos);
          const trans = 1.0 - fres;
          const k = i * trans * cosZ;
          dirX = ml.color.r * k; dirY = ml.color.g * k; dirZ = ml.color.b * k;
        }
        //skyAmbient = hemisphere-mean sky downwelling (see _readSkyAmbient).
        //MUST match the GPU side: the skyAmbientColor uniform set below feeds
        //water-shader.glsl's underwaterInscatterSurface, and both now read the
        //same averaged source so the seabed murk and the ceiling/body fog agree.
        let ambX = 0.0, ambY = 0.0, ambZ = 0.0;
        if(self._readSkyAmbient()){
          ambX = self._skyAmbientScratch.x;
          ambY = self._skyAmbientScratch.y;
          ambZ = self._skyAmbientScratch.z;
        }
        const inv4Pi = 0.07957747154;
        const camDepth = Math.max(0.0, -cameraSubmersion);
        const dDarkenX = Math.exp(-extX * camDepth);
        const dDarkenY = Math.exp(-extY * camDepth);
        const dDarkenZ = Math.exp(-extZ * camDepth);
        //_uwMurkScratch is the COMBINED isotropic inscatter baseline at depth 0:
        //`waterAlbedo · (E_sun + E_sky) / (4π)` — the "if both sun and sky had
        //isotropic phase" version of the medium's single-scatter equilibrium.
        //The chunk then re-weights this on the GPU per fragment by an angular
        //factor that pushes E_sun's contribution through Henyey-Greenstein
        //(forward-scatter halo around the sun) and keeps E_sky isotropic. The
        //fraction-of-inscatter-from-sun (`sunFrac`) is smuggled via |fogFar|
        //so the chunk can do the split without a separate sky uniform. See
        //water-shader.glsl's `underwaterInscatterSurface` for the analogue
        //the body-colour blend uses.
        const sumX = dirX + ambX, sumY = dirY + ambY, sumZ = dirZ + ambZ;
        self._uwMurkScratch.set(
          albX * sumX * inv4Pi,
          albY * sumY * inv4Pi,
          albZ * sumZ * inv4Pi
        );
        //SRGBToLinear pre-comp (see _toFogUniform) so THREE's LinearToSRGB on
        //fogColor upload cancels and the chunk reads the true linear murk.
        self._oceanFog.color.setRGB(self._toFogUniform(self._uwMurkScratch.x),
                                    self._toFogUniform(self._uwMurkScratch.y),
                                    self._toFogUniform(self._uwMurkScratch.z));
        //Sun fraction (scalar). Computed on luminance-weighted total so it
        //collapses sensibly when E_sky dominates at night and E_sun at noon.
        //Clamped to (0, 1) and to a [0.01, 0.99] band so |fogFar| is always
        //a positive non-zero number — the chunk uses sign(fogFar) as the
        //linear/sRGB flag and abs(fogFar) as the fraction.
        const sumLuminance = sumX + sumY + sumZ;
        const sunLuminance = dirX + dirY + dirZ;
        let sunFrac = sumLuminance > 1e-6 ? (sunLuminance / sumLuminance) : 0.0;
        if(sunFrac < 0.01) sunFrac = 0.01;
        if(sunFrac > 0.99) sunFrac = 0.99;
        self._uwSunFrac = sunFrac;  //also stashed for _renderUnderwaterReflection
        //Camera-depth-darkened murk for the curtain (sky-leak fallback — the
        //curtain runs fog:true so the chunk produces its actual per-fragment
        //colour; this is only the cleared-pixel fallback). Lifted by the same
        //isotropic multiple-scatter floor the fog adds: baseline·(1+a/(1-a))
        //= baseline/(1-a) per channel. Kept OFF _uwMurkScratch itself since that
        //feeds the chunk's fogColor, which re-derives the MS term on the GPU.
        if(!self._uwMurkCamDepthScratch){
          self._uwMurkCamDepthScratch = new THREE.Vector3();
        }
        const msFullX = 1.0 / Math.max(1.0 - albX, 0.05);
        const msFullY = 1.0 / Math.max(1.0 - albY, 0.05);
        const msFullZ = 1.0 / Math.max(1.0 - albZ, 0.05);
        self._uwMurkCamDepthScratch.set(
          self._uwMurkScratch.x * msFullX * dDarkenX,
          self._uwMurkScratch.y * msFullY * dDarkenY,
          self._uwMurkScratch.z * msFullZ * dDarkenZ
        );
        //Surface-level inscatter equilibrium (R∞ "ocean colour", NO camera-depth
        //darkening) — the colour an infinite-depth ray fogs to when its path
        //starts at the SURFACE. That's exactly the reflected ray's post-bounce
        //leg, and it's what the reflected geometry reaches in the mirror RT
        //(mirror cam above water → uwCamDepth 0). The underwater-reflection RT
        //clears to THIS so its empty/infinite-depth directions match the
        //reflected seabed teal instead of going dim — otherwise the ceiling's
        //TIR lookup samples a dark void and the water surface reads black from
        //below even though looking straight down reaches teal. fogColor·(2 +
        //4·R∞/albedo): the 2 is the sky-hemisphere term, 4·R∞/albedo the diffuse
        //ocean-colour term (matches the chunk's uwMsRatio + water-shader R∞).
        if(!self._uwReflSurfaceMurk){ self._uwReflSurfaceMurk = new THREE.Vector3(); }
        const rInfA = function(a){ const s = Math.sqrt(Math.max(1.0 - a, 0.0)); return (1.0 - s) / (1.0 + s); };
        self._uwReflSurfaceMurk.set(
          self._uwMurkScratch.x * (2.0 + 4.0 * rInfA(albX) / Math.max(albX, 1e-4)),
          self._uwMurkScratch.y * (2.0 + 4.0 * rInfA(albY) / Math.max(albY, 1e-4)),
          self._uwMurkScratch.z * (2.0 + 4.0 * rInfA(albZ) / Math.max(albZ, 1e-4))
        );
        //Camera-depth-darkened murk for the MIRROR reflection pass. The reflected
        //(TIR) ray is seen by the real eye at camera depth, so — exactly like the
        //direct seabed — its inscatter equilibrium is the camera-depth murk, NOT
        //the brighter surface murk. The mirror camera sits ABOVE water, so the
        //chunk's own uwCamDepth term clamps to 0 and can't apply this; we pre-
        //darken the chunk's fogColor (it re-derives the angular + MS terms from
        //it) and the RT clear by the real camera-depth transmittance instead.
        //With BOTH fog stages now at the camera-depth equilibrium, the two-stage
        //composite collapses to one fog over the full bounce path → the reflection
        //reaches the SAME teal as the direct seabed, and faster (longer path).
        //  _uwBaselineCamDepth  → swapped into fogColor for the mirror pass.
        //  _uwReflCamDepthMurk  → the mirror RT clear (empty/infinite directions).
        if(!self._uwBaselineCamDepth){ self._uwBaselineCamDepth = new THREE.Vector3(); }
        self._uwBaselineCamDepth.set(
          self._uwMurkScratch.x * dDarkenX,
          self._uwMurkScratch.y * dDarkenY,
          self._uwMurkScratch.z * dDarkenZ
        );
        if(!self._uwReflCamDepthMurk){ self._uwReflCamDepthMurk = new THREE.Vector3(); }
        self._uwReflCamDepthMurk.set(
          self._uwReflSurfaceMurk.x * dDarkenX,
          self._uwReflSurfaceMurk.y * dDarkenY,
          self._uwReflSurfaceMurk.z * dDarkenZ
        );
        self._oceanFog.near = -Math.max(waterSurfaceY, 0.001);   //< 0 selects ocean branch; |near| = waterline
        self._oceanFog.far = sunFrac;                            //> 0: sRGB-encoded output + |fogFar| = sunFrac
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
        if(isUnderwater){
          //Camera-depth-darkened murk so the bg matches what the eye would
          //see at infinity in this water column. Mostly hidden behind the
          //curtain sphere, but still the right colour in the edge-case
          //where the curtain fails to cover a pixel (sky-leak fallback).
          const cdm = self._uwMurkCamDepthScratch;
          self.underwaterFogColor.setRGB(cdm.x, cdm.y, cdm.z);
          self.scene.background = self.underwaterFogColor;
        } else {
          self.scene.background = self._aboveWaterBackground;
        }
      }
      //Sun/moon disk planes (a-starry-sky's sunRenderer/moonRenderer) are
      //SEPARATE meshes from the atmosphere dome and render with depthWrite off,
      //so submerged they punch through the curtain as hard-edged disks — the
      //sharp circular cutoff matches their angular-diameter plane size. Hide
      //them for the main underwater render; the transmission pass re-shows them
      //so the Snell window still gets a refracted sun/moon through the surface.
      const rends = self.skyDirector && self.skyDirector.renderers;
      const sunMesh = rends && rends.sunRenderer && rends.sunRenderer.sunMesh;
      const moonMesh = rends && rends.moonRenderer && rends.moonRenderer.moonMesh;
      if(sunMesh){ sunMesh.visible = !isUnderwater; }
      if(moonMesh){ moonMesh.visible = !isUnderwater; }
    }

    //Curtain hemisphere — follow the camera, pick up the camera-depth-
    //darkened murk as a base. The chunk further darkens per-fragment by
    //the curtain fragment's actual depth (the bottom of the 300m
    //hemisphere is way deeper than the camera, so it reads near-black —
    //the "abyss" you see by looking down past the seabed).
    if(self.underwaterCurtainMesh){
      self.underwaterCurtainMesh.visible = isUnderwater;
      if(isUnderwater){
        self.underwaterCurtainMesh.position.copy(self.globalCameraPosition);
        const cdm = self._uwMurkCamDepthScratch;
        self.underwaterCurtainMesh.material.color.setRGB(cdm.x, cdm.y, cdm.z);
      }
    }

    //Update all of our uniforms
    let brightestDirectionalLight;
    if(self.brightestDirectionalLight){
      brightestDirectionalLight = self.brightestDirectionalLight;
    }

    //Wind-driven foam bias, computed once per frame from the CURRENT wind (so a
    //runtime storm ramp whitens the sea as it builds). windVelocity references the
    //A-Frame data, so it tracks live wind changes that also drive regenerateH0.
    {
      const ws = Math.sqrt(self.windVelocity.x * self.windVelocity.x + self.windVelocity.y * self.windVelocity.y);
      const span = self.foamWindFull - self.foamWindStart;
      let f = span > 1e-3 ? (ws - self.foamWindStart) / span : (ws >= self.foamWindStart ? 1.0 : 0.0);
      f = f < 0.0 ? 0.0 : (f > 1.0 ? 1.0 : f);
      self._foamWindBias = f * self.foamWindBiasMax;
    }

    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      const uniformsRef = oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms;
      for(let c = 0; c < 6; c++){
        uniformsRef.cascadeDisplacementTextures.value[c] = self.oceanHeightComposer.cascadeDisplacementTextures[c];
      }
      uniformsRef.cascadePatchSizes.value = self.oceanHeightComposer._cascadePatchSizes;
      //Per-cascade slope variance σ² — sourced from the height-band library.
      //Re-pushed every frame because regenerateH0() (called when wind changes
      //at runtime) rewrites the array; pointing at the live ref keeps the
      //shader in sync without an extra change-detection path.
      uniformsRef.cascadeRMSSlope.value = self.oceanHeightBandLibrary.cascadeRMSSlope;
      uniformsRef.waveHeightMultiplier.value = self.oceanHeightComposer.waveHeightMultiplier;
      uniformsRef.foamWindBias.value = self._foamWindBias;
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
      uniformsRef.ssrMaxSteps.value = self.ssrMaxSteps;
      uniformsRef.fresnelDistanceRoughness.value = self.fresnelDistanceRoughness;
      uniformsRef.surfaceRoughness.value = self.surfaceRoughness;
      uniformsRef.specFresnelGate.value = self.specFresnelGate;
      uniformsRef.specBoost.value = self.specBoost;
      uniformsRef.specFalloffFar.value = self.specFalloffFar;
      uniformsRef.specFalloffFarDist.value = self.specFalloffFarDist;
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
        //Stash the same direction for the chunk's HG sun phase. Convention
        //matches water-shader.glsl's `brightestDirectionalLightDirection`:
        //points FROM the sun TO the scene (the direction sunlight travels).
        //directionalLightDirection above is `(target - position).normalize()`
        //= same convention, so copy directly.
        if(self._sharedUwSunDir){
          self._sharedUwSunDir.copy(directionalLightDirection);
        }

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
        uniformsRef.aboveWaterTransmissionTexture.value = self._aboveWaterTransmissionTarget.texture;
      }

      //Sky ambient color = hemisphere-mean sky downwelling (see _readSkyAmbient).
      //View-independent and colour-correct at all times of day. Reading only the
      //y-axis hemisphere (the zenith) gave a near-black ambient because that SH
      //axis clamps to ~0; averaging the three axes fixes it. Falls back to a
      //scene HemisphereLight when running standalone (no a-starry-sky).
      if(self._readSkyAmbient()){
        uniformsRef.skyAmbientColor.value.copy(self._skyAmbientScratch);
      }

      //Sync atmospheric perspective uniforms from a-starry-sky
      if(self.atmosphericPerspectiveEnabled && self.skyDirector){
        const luts = self.skyDirector.getAtmosphericLUTs();
        //Some sky builds publish the LUTs a few frames before the functions
        //string. Skip ONLY this AP block until both exist — an early `return`
        //here would abort tick mid-loop and freeze the CSM/skirt/splash
        //updates below for the frame (and for good if the string never came).
        if(luts && (self.atmosphereFunctionsGLSL || luts.atmosphereFunctionsString)){
          //If we haven't recompiled with atmospheric perspective yet, do it now
          if(!self.atmosphereFunctionsGLSL){
            self.atmosphereFunctionsGLSL = luts.atmosphereFunctionsString;
            //Recompile all cloned materials on each ocean patch instance
            const newFragShader = ARestlessOcean.Materials.Ocean.waterMaterial.fragmentShader(
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
              mesh.material.fog = true;
              mesh.material.needsUpdate = true;
            }
            //Also update the source material for any future clones
            self.oceanMaterial.vertexShader = newVtxSrc;
            self.oceanMaterial.fragmentShader = newFragShader;
            self.oceanMaterial.fog = true;
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

    //Broadcast the current sun direction to every fog-receiving material so
    //the underwater chunk's HG sun phase reads the right vector. Cheap scene
    //traversal; the per-material write is a Vector3.copy().
    self._broadcastUwSunDir();

    //── Splash particles ──────────────────────────────────────────────────────
    //Run emission + sim last (the offscreen passes are done), then re-show the
    //mesh so it lands in this frame's main render only.
    if(self.oceanSplash){
      const sp = self.oceanSplash;
      self._splashSunColor = self._splashSunColor || new THREE.Color();
      self._splashAmbient = self._splashAmbient || new THREE.Color();
      self._splashSunDir = self._splashSunDir || new THREE.Vector3(0.0, 1.0, 0.0);
      if(self.brightestDirectionalLight){
        const ml = self.brightestDirectionalLight;
        self._splashSunColor.copy(ml.color).multiplyScalar(ml.intensity);
        //Direction TO the sun (world): the light points position -> target, so the
        //sun lies along (position - target). Feeds the splash forward-scatter phase.
        self._splashSunDir.set(ml.position.x, ml.position.y, ml.position.z)
          .sub(ml.target.position).normalize();
      } else {
        self._splashSunColor.setRGB(1.0, 1.0, 1.0);
      }
      //TRUE solar elevation (sin), independent of which light is brightest. brightestDirectionalLight
      //becomes the MOON at night, so its .y cannot tell day from night; the sky state's sun position
      //can. The splash gates its daytime sky-fill on this so a high moon never reads as daytime.
      let _sunElev = 1.0;
      if(self.skyDirector && self.skyDirector.getAtmosphericLUTs){
        const _luts = self.skyDirector.getAtmosphericLUTs();
        if(_luts && _luts.skyState && _luts.skyState.sun){
          const _sp = _luts.skyState.sun.position;
          const _spl = Math.sqrt(_sp.x * _sp.x + _sp.y * _sp.y + _sp.z * _sp.z);
          _sunElev = _spl > 1e-4 ? _sp.y / _spl : _sp.y;
        }
      }
      if(self._readSkyAmbient()){
        self._splashAmbient.setRGB(self._skyAmbientScratch.x, self._skyAmbientScratch.y, self._skyAmbientScratch.z);
      } else {
        self._splashAmbient.setRGB(0.3, 0.4, 0.5);
      }
      //Camera forward, flattened to the XZ plane and normalised. The shore scan
      //biases its detector density toward what the camera is actually looking at
      //(dense in front, thinned behind) so the budget is spent on visible spray.
      self._splashFwd = self._splashFwd || new THREE.Vector3();
      self.camera.getWorldDirection(self._splashFwd);
      let _fwdX = self._splashFwd.x, _fwdZ = self._splashFwd.z;
      const _fwdL = Math.sqrt(_fwdX * _fwdX + _fwdZ * _fwdZ);
      if(_fwdL > 1e-4){ _fwdX /= _fwdL; _fwdZ /= _fwdL; } else { _fwdX = 0.0; _fwdZ = 1.0; }
      //Scene sun shadow: hand the splash the SAME directional-light shadow map + params
      //the water surface receives (see the sunShadow* wiring above), so spray darkens
      //under the rocks / lighthouse consistently. Auto-detect + console override match.
      let _shEnabled = 0, _shMap = null, _shMatrix = null, _shW = 2048.0, _shH = 2048.0,
          _shRadius = 1.0, _shBias = 0.0;
      const _sLight = self.brightestDirectionalLight;
      if(_sLight && _sLight.castShadow && _sLight.shadow && _sLight.shadow.map){
        _shEnabled = (self._sunShadowOverride === false) ? 0 : 1;
        _shMap = _sLight.shadow.map.texture;
        _shMatrix = _sLight.shadow.matrix;
        _shW = _sLight.shadow.mapSize.x; _shH = _sLight.shadow.mapSize.y;
        _shRadius = _sLight.shadow.radius;
        _shBias = _sLight.shadow.bias + (self._sunShadowBiasOffset || 0.0);
      }
      //Sky reflection source for the bead rims: the same a-starry-sky metering fisheye the
      //water SSR fallback samples (worldXZ -> UV). Null when no sky system is present, in
      //which case the splash shader falls back to the flat sky-ambient colour.
      let _meterTex = null;
      if(self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.meteringSurveyRenderer){
        const _msr = self.skyDirector.renderers.meteringSurveyRenderer;
        _meterTex = _msr.meteringSurveyRenderer.getCurrentRenderTarget(_msr.meteringSurveyVar).texture;
      }
      sp.tick({
        time: time,
        camX: self.globalCameraPosition.x,
        camZ: self.globalCameraPosition.z,
        camFwdX: _fwdX,
        camFwdZ: _fwdZ,
        //Real wind velocity (m/s, world X/Z), NOT foamScrollVelocityVec — that
        //one is a deliberately-slowed foam-texture drift (windSpeed*0.04) and
        //would barely budge the spray. windVelocity.x->world X, .y->world Z.
        windX: self.windVelocity.x,
        windZ: self.windVelocity.y,
        sunColor: self._splashSunColor,
        skyAmbient: self._splashAmbient,
        sunDir: self._splashSunDir,
        sunElevation: _sunElev,
        sunShadowEnabled: _shEnabled,
        sunShadowMap: _shMap,
        sunShadowMatrix: _shMatrix,
        sunShadowMapW: _shW,
        sunShadowMapH: _shH,
        sunShadowRadius: _shRadius,
        sunShadowBias: _shBias,
        skyReflectTex: _meterTex,
        viewportHeight: self.refractionGBufferTarget.height,
        resW: self.refractionGBufferTarget.width,
        resH: self.refractionGBufferTarget.height,
        linearDepthTexture: self.refractionGBufferTarget.textures[2]
      });
      //Airborne spray is an above-water phenomenon: hide it whenever the camera is submerged, or the
      //mist/foam billboards punch through the underwater ceiling (they render on OCEAN_LAYER in the
      //main pass and do not depth-interact with the from-below surface). _wasUnderwater is the same
      //committed submersion state that drives the underwater fog/ceiling swap.
      sp.mesh.visible = sp.enabled && !self._wasUnderwater;
    }
  };
}
