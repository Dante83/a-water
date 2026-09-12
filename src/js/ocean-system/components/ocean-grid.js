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
  this.drawDistance = data.draw_distance;
  this.patchSize = data.patch_size;
  this.heightOffset = data.height_offset;
  this.causticsEnabled = data.caustics_enabled;
  this.causticsStrength = data.caustics_strength;
  this.reflectionScale = data.reflection_scale;
  this.reflectionDistanceFalloff = data.reflection_distance_falloff;
  //SSR march step cap (live-tunable via window.setSsrMaxSteps). 48 = original
  //full reach. The SSR ray-march is the dominant per-pixel water cost; lower
  //trades reflection reach for fill rate, 0 = sky-only (bottleneck A/B test).
  this.ssrMaxSteps = 48;
  //How much ripple detail the SKY half of the SSR follows (live-tunable via
  //window.setSsrSkyNormalBlend). 0 reproduces the original macroNormal-only
  //behaviour — a reflection that tracks only the long swell and reads as a
  //mirror while the surface under it ripples. 1 = full detail. The geometry
  //raymarch is unaffected either way; it needs the smooth normal or it marches
  //into a different depth footprint per pixel and breaks up into noise.
  this.ssrSkyNormalBlend = 1.0;
  //...and the same for the geometry raymarch (window.setSsrMarchNormalBlend).
  //Separate knob because the two fail in opposite directions: detail here can
  //scatter the march into noise, while too little is the flat-mirror look. Set
  //BOTH to 0 to get the pre-2026-09-11 reflection back exactly.
  this.ssrMarchNormalBlend = 1.0;
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

  let rendererSize = new THREE.Vector2();
  this.renderer.getDrawingBufferSize(rendererSize);


  //Screen-space G-buffer for the refraction pass (albedo / world-normal /
  //linear-depth MRT). Lives in ARestlessOcean.Passes.RefractionGBufferPass;
  //read its header for the per-mesh material-swap rationale. Guarded like the
  //other passes so a missing script tag degrades rather than throws.
  if(ARestlessOcean.Passes && ARestlessOcean.Passes.RefractionGBufferPass){
    this.refractionGBufferPass = new ARestlessOcean.Passes.RefractionGBufferPass(this);
    this.refractionGBufferPass.init(rendererSize.x, rendererSize.y);
    //Back-compat alias — the target was `oceanGrid.refractionGBufferTarget` in
    //0.2.0 and is still read by the uniform upload loop and ocean-splash.js.
    this.refractionGBufferTarget = this.refractionGBufferPass.target;
  } else {
    this.refractionGBufferPass = null;
    this.refractionGBufferTarget = null;
  }

  //── Underwater planar reflection + above-water transmission ──────────────
  //Both submerged-only render targets, the mirror camera, the clip plane and
  //the one-shot clipping-shader warm live in
  //ARestlessOcean.Passes.ReflectionPass. Read its header before touching the
  //tick ordering — the one-frame lag on the underwater murk values and the
  //fogFar > 0 rule are both load-bearing.
  if(ARestlessOcean.Passes && ARestlessOcean.Passes.ReflectionPass){
    this.reflectionPass = new ARestlessOcean.Passes.ReflectionPass(this);
    this.reflectionPass.init(rendererSize.x, rendererSize.y);
    //Back-compat aliases — read by the per-instance uniform upload loop.
    this.reflectionResolutionScale = this.reflectionPass.resolutionScale;
    this._reflectionTarget = this.reflectionPass.target;
    this._aboveWaterTransmissionTarget = this.reflectionPass.transmissionTarget;
    this._reflectionTextureMatrix = this.reflectionPass._reflectionTextureMatrix;
  } else {
    this.reflectionPass = null;
    this.reflectionResolutionScale = 0.5;
    this._reflectionTarget = null;
    this._aboveWaterTransmissionTarget = null;
    this._reflectionTextureMatrix = new THREE.Matrix4();
  }

  //── Underwater caustic projection — KNOBS ────────────────────────────────
  //The projector itself (slide RT, SpotLight, per-frame update) lives in
  //ARestlessOcean.Passes.CausticProjectionPass; read its header for why a
  //SpotLight cookie is the mechanism. These knobs stay on the grid so the
  //existing window.oceanGrid.causticLight* console tuning keeps working, and
  //because causticsStrength is also consumed by the water shader uniforms.
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

  //The projector pass itself. Guarded like OceanShadowCSM / OceanSplash so a
  //missing script tag degrades to "no underwater caustics" rather than throwing.
  if(ARestlessOcean.Passes && ARestlessOcean.Passes.CausticProjectionPass){
    this.causticProjectionPass = new ARestlessOcean.Passes.CausticProjectionPass(this);
    this.causticProjectionPass.init();
    //Back-compat alias — the projector was `oceanGrid.causticSpotLight` in 0.2.0.
    this.causticSpotLight = this.causticProjectionPass.light;
  } else {
    this.causticProjectionPass = null;
    this.causticSpotLight = null;
  }

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
  //The underwater seabed/curtain murk (see the UnderwaterFogChunk pass) hooks a
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


  //Resolve now (constructor time, before any material compiles) and, if we own
  //the sky, lay down the scaffold so the curtain/seabed fog materials built
  //below pick it up on first compile.
  //Underwater fog chunk. Not a render pass — a one-shot installer for the
  //THREE.ShaderChunk.fog_* ocean branch that fogs directly-viewed seabed. It
  //also writes the standalone fog scaffold when no a-starry-sky is present to
  //provide the reservation slot. See its header for the THREE.Fog smuggle.
  this._skyProvider = this._resolveSkyProvider();

  //── Terrain provider resolution (WATER-TYPES.md Phase 1b) ──────────────────
  //Same posture as _resolveSkyProvider above: resolve off DOM/markup presence,
  //not off some a-faraway-land-owned flag, because <a-land-terrain>'s map.json
  //fetch is async and we need an answer before it has necessarily resolved.
  this._resolveTerrainProvider = function(){
    const declared = (self.data && typeof self.data.terrain_provider === 'string')
      ? self.data.terrain_provider.toLowerCase() : 'auto';
    if(declared === 'standalone' || declared === 'a-faraway-land'){
      return declared;
    }
    const hasGlobal = (typeof ALand !== 'undefined');
    const hasElement = (typeof document !== 'undefined') &&
      !!document.querySelector('a-land-terrain');
    return (hasGlobal || hasElement) ? 'a-faraway-land' : 'standalone';
  };
  this._terrainProvider = this._resolveTerrainProvider();
  this._landTerrainApi = null;
  this._landDirector = null;
  //Scene-graph root of a-land's geometry. The refraction G-buffer uses it to
  //tell a sibling system's terrain (which it must capture with a geometry-only
  //twin) from our own ShaderMaterials (which it must keep skipping).
  this._landTerrainRoot = null;

  //Discover a-faraway-land's land-terrain component for the water-field seam.
  //Retried from tick() exactly like _discoverSkyDirector below, for the same
  //reason: DOM order between <a-land-terrain> and <a-restless-ocean> isn't
  //guaranteed, and <a-land-terrain>'s own map.json fetch is async, so the
  //component can exist in the DOM well before its director/api are ready.
  this._discoverTerrainDirector = function(){
    if(self._landTerrainApi) return true;
    const el = document.querySelector('a-land-terrain');
    const comp = el && el.components && el.components['land-terrain'];
    //⚠ mapJson IS PART OF THE READINESS TEST, not a detail. a-land builds its
    //director as soon as the component initialises and only THEN fetches
    //map.json ("director initialized" logs before "map.json loaded"), so
    //accepting a bare director hands the tile decoder a mapJson of undefined.
    //It then latches available=false for the life of the session and silently
    //never requests a single tile.
    if(comp && comp.api && comp.director && comp.director.mapJson){
      self._landTerrainApi = comp.api;
      self._landDirector = comp.director;
      self._landTerrainRoot = el.object3D || null;
      self._subscribeTerrainEdits(comp.director);
      return true;
    }
    return false;
  };

  //── Terrain edit invalidation (Phase 1c) ─────────────────────────────────
  //a-land routes every world mutation through its WorldAuthority
  //(core/world-authority.js) — brush strokes and layer replays both end in
  //invalidateTile. That IS the tile-event source a-land-water-contract.md §3
  //promised, so no polling and no a-land change.
  //
  //An edit changes the GROUND, which moves two things we cache: the foam ortho
  //capture (the standalone depth) and every cascade's depth + shoreSDF. The
  //baked water tiles on disk do NOT change with a brush stroke, so the
  //decoder's tile cache is left alone — if a-land ever re-solves water live,
  //that is the moment to drop it too.
  //
  //Throttled, because a stroke emits events every frame: at most one forced
  //refresh per TERRAIN_EDIT_THROTTLE_MS while events arrive, plus one trailing
  //refresh TERRAIN_EDIT_SETTLE_MS after the last, since a-land re-composites
  //the edited height tiles over the next few frames and the first capture can
  //land before they have.
  this._terrainEditLastEventMs = 0;
  this._terrainEditLastForceMs = 0;
  this._terrainEditTrailingPending = false;
  this._terrainEditUnsubscribe = null;
  this._subscribeTerrainEdits = function(director){
    if(self._terrainEditUnsubscribe) return;
    const authority = director && director.worldAuthority;
    if(!authority || typeof authority.subscribe !== 'function') return;
    self._terrainEditUnsubscribe = authority.subscribe(function(event){
      if(!event || (event.type !== 'tileInvalidate' && event.type !== 'heightChange')) return;
      self._terrainEditLastEventMs = performance.now();
      self._terrainEditTrailingPending = true;
    });
  };
  this._consumeTerrainEdits = function(){
    if(!self._terrainEditTrailingPending) return;
    const now = performance.now();
    const force = function(){
      self._terrainEditLastForceMs = now;
      if(self.terrainOrthoPass) self.terrainOrthoPass.invalidate();
      if(self.waterFieldPass) self.waterFieldPass.invalidate();
    };
    if(now - self._terrainEditLastEventMs >= ARestlessOcean.OceanGrid.TERRAIN_EDIT_SETTLE_MS){
      self._terrainEditTrailingPending = false;   //the trailing refresh
      force();
    } else if(now - self._terrainEditLastForceMs >= ARestlessOcean.OceanGrid.TERRAIN_EDIT_THROTTLE_MS){
      force();                                     //mid-stroke, throttled
    }
  };
  if(this._terrainProvider === 'a-faraway-land'){
    this._discoverTerrainDirector();
  }
  if(ARestlessOcean.Passes && ARestlessOcean.Passes.UnderwaterFogChunk){
    this.underwaterFogChunk = new ARestlessOcean.Passes.UnderwaterFogChunk(this);
    this.underwaterFogChunk.init(this._skyProvider);
  } else {
    this.underwaterFogChunk = null;
  }



  //Terrain ortho atlases: the foam terrain-height capture and the layer-30
  //boat-hull exclusion capture. Both live in
  //ARestlessOcean.Passes.TerrainOrthoPass — read its header for why they are
  //one module rather than two. Guarded like the other passes.
  this.foamCameraHeight = data.foam_camera_height;
  if(ARestlessOcean.Passes && ARestlessOcean.Passes.TerrainOrthoPass){
    this.terrainOrthoPass = new ARestlessOcean.Passes.TerrainOrthoPass(this);
    this.terrainOrthoPass.init();
    //Back-compat aliases — all of these were OceanGrid fields in 0.2.0 and are
    //still read by the per-instance uniform upload loop and the debug hooks.
    this.foamRenderTarget = this.terrainOrthoPass.foamRenderTarget;
    this.exclusionRenderTarget = this.terrainOrthoPass.exclusionRenderTarget;
    this.foamCamera = this.terrainOrthoPass.foamCamera;
    this.exclusionCamera = this.terrainOrthoPass.exclusionCamera;
    this.positionPassMaterial = this.terrainOrthoPass.positionPassMaterial;
    this._foamCameraXZ = this.terrainOrthoPass.foamCameraXZ;
    this._exclusionCameraXZ = this.terrainOrthoPass.exclusionCameraXZ;
  } else {
    this.terrainOrthoPass = null;
    this.foamRenderTarget = null;
    this.exclusionRenderTarget = null;
    this.foamCamera = null;
    this.exclusionCamera = null;
    this.positionPassMaterial = null;
    this._foamCameraXZ = new THREE.Vector2();
    this._exclusionCameraXZ = new THREE.Vector2();
  }

  //Initialize all shader LUTs for future ocean viewing
  //Initialize our ocean variables and all associated shaders.
  //WaterField — the per-texel water field every later phase reads. In Phase 1a
  //it is filled with the same answers 0.2.0 assumed (global plane + foam-ortho
  //depth), so nothing changes visually; Phase 1b swaps the fill for a real
  //a-faraway-land tile decode. See the pass header.
  if(ARestlessOcean.Passes && ARestlessOcean.Passes.WaterFieldPass){
    this.waterFieldPass = new ARestlessOcean.Passes.WaterFieldPass(this);
    this.waterFieldPass.init();
  } else {
    this.waterFieldPass = null;
  }

  //═══════════════════════════════════════════════════════════════════════════
  // THE WATER-LEVEL SEAM
  //═══════════════════════════════════════════════════════════════════════════
  //Every consumer that used to read `heightOffset` directly asks these instead.
  //
  //In Phase 1a they return exactly what those consumers computed before, so
  //routing everything through them is provably a no-op — that is the whole
  //point. Phase 1b replaces the BODIES with a real field lookup (a cached
  //readback of waterFieldPass's cascades, or a-land's getWaterAt) and not one
  //call site has to move again.
  //
  //Keep them cheap and synchronous: they are called per patch, per emitter and
  //per frame. Phase 1b routes through a-land's own getWaterAt, which is a
  //synchronous JS cache read (WaterReader's LRU) — NOT a GPU readback. Do not
  //route this through WaterFieldPass.probeAt/readRenderTargetPixels; that is
  //a debug/console path and stalls the GPU, which this comment has always
  //forbidden at this call frequency.
  this.waterLevelAt = function(x, z){
    if(self._terrainProvider === 'a-faraway-land' && self._landTerrainApi){
      const w = self._landTerrainApi.getWaterAt(x, z);
      //null: dry, or the tile hasn't warmed yet (a-land loads it in the
      //background) — fall through to the standalone answer, never "nothing".
      if(w) return w.level;
    }
    return self.heightOffset;
  };
  //Water column depth (metres) at a world position; 0 means dry.
  this.waterDepthAt = function(x, z){
    if(self._terrainProvider === 'a-faraway-land' && self._landTerrainApi){
      const w = self._landTerrainApi.getWaterAt(x, z);
      if(w) return w.depth;
    }
    return ARestlessOcean.Passes.WaterFieldPass
      ? ARestlessOcean.Passes.WaterFieldPass.OPEN_OCEAN_DEPTH : 1000.0;
  };
  //The analytic Gerstner twin is pointed at this same seam too — see
  //_syncWaveFieldSeam below. It cannot be done here: ARestlessOcean.waveField
  //does not exist until the band library is constructed a few lines down.
  //
  //Keeping the twin on the seam matters: if the CPU surface and the rendered
  //surface disagree about the rest level, buoyancy floats objects at a
  //different height than the water you can see.
  this._syncWaveFieldSeam = function(){
    const wf = ARestlessOcean.waveField;
    //Self-healing rather than one-shot: regenerateH0() builds a NEW
    //OceanWaveField on every wind change, which would silently drop the
    //provider and send the twin back to a flat plane.
    if(wf && wf.levelProvider !== self.waterLevelAt){
      wf.levelProvider = self.waterLevelAt;
    }
    if(wf && wf.maskProvider !== self.waveMasksAt){
      wf.maskProvider = self.waveMasksAt;
    }
  };

  //═══════════════════════════════════════════════════════════════════════════
  // THE WAVE-MASK SEAM (Phase 2)
  //═══════════════════════════════════════════════════════════════════════════
  //Per-cascade wave weights from the water field — see ARestlessOcean.WaveMask
  //(ocean-wave-field.js) for the physics. The GPU evaluates it per vertex from
  //WaterFieldPass's RT0; this is the CPU mirror for the analytic twin, the
  //submersion probe and the debug readback, fed from the same sources the GPU
  //field is filled from rather than from a readback of it:
  //  a-faraway-land: getWaterAt (the contract oracle the GPU decode is verified
  //    byte-exact against), with shoreSDF from a cached 8-ray search.
  //  standalone:     the splash system's CPU copy of the foam ortho, which is
  //    the texture the GPU base fill reads its depth from.
  this.waveMaskEnabled = true;
  this._waveMaskParams = null;
  this.waveMaskParams = function(){
    const lib = self.oceanHeightBandLibrary;
    if(!lib) return null;
    self._waveMaskParams = ARestlessOcean.WaveMask.paramsFrom(
      lib, self.heightOffset, self._waterFieldDepthCap(), self.waveMaskEnabled, self._waveMaskParams);
    return self._waveMaskParams;
  };
  //a-land saturates its depth encoding at simulation.maxDepth; standalone has
  //no cap. WaveMask treats depth at the cap as deep (see its header).
  this._waterFieldDepthCap = function(){
    if(self._terrainProvider === 'a-faraway-land' && self._landDirector){
      const mj = self._landDirector.mapJson;
      const md = mj && mj.simulation && mj.simulation.maxDepth;
      if(md > 0) return md;
    }
    return 1.0e9;
  };

  //CPU mirror of the GPU field texel (level, depth, shoreSDF, dryMask).
  //`out` is {level, depth, shoreSDF, dryMask}; returns it.
  this._fieldScratch = {level: 0, depth: 0, shoreSDF: 0, dryMask: 0};
  this.waterFieldSampleAt = function(x, z, out){
    out = out || {level: 0, depth: 0, shoreSDF: 0, dryMask: 0};
    const OPEN = ARestlessOcean.Passes.WaterFieldPass
      ? ARestlessOcean.Passes.WaterFieldPass.OPEN_OCEAN_DEPTH : 1000.0;
    out.level = self.heightOffset;
    out.depth = OPEN;
    out.shoreSDF = 1.0e6;
    out.dryMask = 0.0;
    if(self._terrainProvider === 'a-faraway-land' && self._landTerrainApi){
      const w = self._landTerrainApi.getWaterAt(x, z);
      if(w){
        out.level = w.level;
        out.depth = w.depth;
        //shoreSDF only matters to WaveMask for INLAND water; skip the search
        //over the ocean, where the GPU's value is ignored too.
        if(Math.abs(w.level - self.heightOffset) > ARestlessOcean.WaveMask.INLAND_START){
          out.shoreSDF = self._cpuShoreDistance(x, z);
        }
        return out;
      }
      //null = dry OR not loaded. The GPU writes an authoritative dry, but no
      //CPU consumer floats anything on dry land, so fall through to the
      //standalone answer rather than zeroing the waves under a loading tile.
    }
    const splash = self.oceanSplash;
    if(splash && typeof splash.sampleTerrainHeight === 'function'){
      const ground = splash.sampleTerrainHeight(x, z);
      if(ground !== null) out.depth = Math.max(0.0, out.level - ground);
    }
    return out;
  };

  //Distance to the nearest dry point (metres), for the inland fetch proxy.
  //The GPU uses an exact jump-flood SDF; this marches 8 rays (doubling step,
  //then a bisection) and takes the shortest, which overestimates by at most
  //1/cos(22.5°) ≈ 8% between rays. The fetch proxy's k_p goes as F^(-2/3),
  //so that is a ~5% shift in the local peak — below anything visible.
  //Cached on a 2 m grid; cleared whenever the GPU field is invalidated (tile
  //arrival, terrain edit), which is also when the answer can change.
  this._shoreCache = new Map();
  this._shoreCacheInvalidation = -1;
  const SHORE_RAY_DIRS = [];
  for(let r = 0; r < 8; r++){
    SHORE_RAY_DIRS.push([Math.cos(r * Math.PI / 4), Math.sin(r * Math.PI / 4)]);
  }
  this._cpuShoreDistance = function(x, z){
    const wfp = self.waterFieldPass;
    const inval = wfp ? wfp.invalidationCount : 0;
    if(inval !== self._shoreCacheInvalidation || self._shoreCache.size > 8192){
      self._shoreCache.clear();
      self._shoreCacheInvalidation = inval;
    }
    const CELL = 2.0;
    const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
    const key = cx + ',' + cz;
    const hit = self._shoreCache.get(key);
    if(hit !== undefined) return hit;
    const api = self._landTerrainApi;
    const px = cx * CELL, pz = cz * CELL;
    const MAX = 512.0;   //= cascade 0's "no shore in footprint" value (2·halfWidth)
    let best = MAX;
    for(let r = 0; r < 8; r++){
      const dx = SHORE_RAY_DIRS[r][0], dz = SHORE_RAY_DIRS[r][1];
      let wet = 0.0;
      let s = 1.0;
      while(s < best && !(api.getWaterAt(px + dx * s, pz + dz * s) === null)){
        wet = s;
        s *= 2.0;
      }
      if(s >= best) continue;
      let dry = s;
      for(let b = 0; b < 6; b++){
        const mid = 0.5 * (wet + dry);
        if(api.getWaterAt(px + dx * mid, pz + dz * mid) === null) dry = mid; else wet = mid;
      }
      best = Math.min(best, 0.5 * (wet + dry));
    }
    self._shoreCache.set(key, best);
    return best;
  };

  //Per-cascade wave weights at (x, z) into out6. Installed on the analytic twin
  //as its maskProvider (_syncWaveFieldSeam), and read by the submersion probe.
  this.waveMasksAt = function(x, z, out6){
    out6 = out6 || [1, 1, 1, 1, 1, 1];
    const p = self._waveMaskParams || self.waveMaskParams();
    const s = self.waterFieldSampleAt(x, z, self._fieldScratch);
    return ARestlessOcean.WaveMask.compute(out6, s.level, s.depth, s.shoreSDF, s.dryMask, p);
  };

  this.oceanHeightBandLibrary = new ARestlessOcean.LUTlibraries.OceanHeightBandLibrary(this);
  this.oceanHeightComposer = new ARestlessOcean.LUTlibraries.OceanHeightComposer(this);
  this._syncWaveFieldSeam();

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
      .replace(/\$horizon_skirt/g, skirt ? '1' : '0')
      //Phase 2: the shared WaveMask GLSL (ocean-wave-field.js). A function
      //replacement, so a `$` in the GLSL could never be read as a pattern.
      .replace('$wave_mask_functions', function(){ return ARestlessOcean.WaveMask.GLSL; });
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
  //Per-grid CLONE of the module-global uniform template, not an alias. In 0.2.0
  //this was a straight assignment, so the line below (and anything else writing
  //through oceanMaterial.uniforms) wrote into the global — fine with one ocean,
  //a cross-body stomp with two. See ARestlessOcean.cloneUniforms for the array
  //deep-clone that UniformsUtils.clone does not do.
  this.oceanMaterial.uniforms = ARestlessOcean.cloneUniforms(ARestlessOcean.Materials.Ocean.waterMaterial.uniforms);
  //Phase 2 WaveMask uniforms. Defined in ocean-wave-field.js next to the GLSL
  //they feed, rather than in the template, so the three consumers (this
  //material, the CSM caster, the height bake) share one declaration.
  Object.assign(this.oceanMaterial.uniforms, ARestlessOcean.WaveMask.createUniforms());
  this.oceanMaterial.uniforms.sizeOfOceanPatch.value = this.patchSize;

  //Ocean-only cascaded shadow map, orchestrated by
  //ARestlessOcean.Passes.OceanShadowPass. Dedicated tight-frustum depth pass
  //that only contains the water InstancedMeshes — gives per-wave self-shadow
  //that the scene-wide sun shadow map can't resolve. Each mesh registers
  //itself below via addCaster().
  if(ARestlessOcean.Passes && ARestlessOcean.Passes.OceanShadowPass){
    this.oceanShadowPass = new ARestlessOcean.Passes.OceanShadowPass(this);
    this.oceanShadowPass.init();
    //Back-compat alias — the CSM was `oceanGrid.oceanShadowCSM` in 0.2.0 and is
    //still read by the debug helpers and the EVSM console setters. Null when
    //ocean-shadow-csm.js or its generated material isn't loaded.
    this.oceanShadowCSM = this.oceanShadowPass.csm;
  } else {
    this.oceanShadowPass = null;
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
      //Material.clone() runs UniformsUtils.clone, which slices arrays rather
      //than deep-cloning them — so re-clone the uniforms properly on top.
      const tileMaterial = self.oceanMaterial.clone();
      tileMaterial.uniforms = ARestlessOcean.cloneUniforms(self.oceanMaterial.uniforms);
      const mesh = new THREE.InstancedMesh(geometry, tileMaterial, instanceCount[key]);
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
      if(self.oceanShadowPass){
        self.oceanShadowPass.addCaster(mesh, k);
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
    //Tile geometry spans [0, tileSize]; placing at gx*tileSize centers the 4×4 ring on the camera.
    //Y is the flat BASE plane (heightOffset), never the field: the vertex
    //shader adds (field level − baseHeightOffset) per vertex, so a patch placed
    //at waterLevelAt() would count the field twice wherever it differs from sea
    //level at the patch origin.
    self.oceanPatches.push(new ARestlessOcean.OceanPatch(
      self,
      new THREE.Vector3(gx * tileSize, self.heightOffset, gy * tileSize),
      oceanPatchGeometryInstances[key],
      instanceIterations[key],
      k
    ));
    instanceIterations[key] += 1;
  });

  this.numCells = numCells;
  this.ringCount = ringCount;
  this.globalCameraPosition = new THREE.Vector3();


  //═══════════════════════════════════════════════════════════════════════════
  // FFT surface sampling on the CPU — the EXACT rendered water, for buoyancy.
  //═══════════════════════════════════════════════════════════════════════════
  //Both readback mechanisms (the scalable local height field and the per-frame
  //submersion probe) live in ARestlessOcean.Passes.HeightReadbackPass — read its
  //header for the async-readback rationale and the triple-buffering. It also
  //installs the public ARestlessOcean.sampleWater* / requestFFTSnapshot API.
  if(ARestlessOcean.Passes && ARestlessOcean.Passes.HeightReadbackPass){
    this.heightReadbackPass = new ARestlessOcean.Passes.HeightReadbackPass(this);
    this.heightReadbackPass.init();
    this.heightReadbackPass.installGlobalAPI();
    //Back-compat aliases — both were OceanGrid methods in 0.2.0 and are called
    //by buoyant.js / the debug console through the grid.
    this.sampleFFTHeightAt = function(x, z){ return self.heightReadbackPass.sampleFFTHeightAt(x, z); };
    this.sampleWaterHeightFieldCached = function(x, z){ return self.heightReadbackPass.sampleWaterHeightFieldCached(x, z); };
  } else {
    this.heightReadbackPass = null;
    this.sampleFFTHeightAt = function(){ return null; };
    this.sampleWaterHeightFieldCached = function(){ return null; };
  }

  //Build the horizon-skirt mesh and register it as another instance key so the
  //per-frame uniform loop pushes the same FFT-ocean updates into its (cloned)
  //uniforms object. ringIndex is pinned to 5 here and NOT touched in the
  //per-frame loop, so the skirt keeps its coarse cascade-displacement settings.
  //Called at construction when the sky was found in init, and again from tick
  //if a-starry-sky shows up late (see _discoverSkyDirector).
  this._createHorizonSkirt = function(){
    if(self.horizonSkirtMesh){ return; }
    const skirtMaterial = self.oceanMaterial.clone();
    //Same array deep-clone as the tile materials above.
    skirtMaterial.uniforms = ARestlessOcean.cloneUniforms(self.oceanMaterial.uniforms);
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

  //Iterate every ocean surface mesh — all clipmap ring InstancedMeshes plus
  //the horizon skirt. The one sanctioned way for anything outside this
  //constructor to reach the water materials, so the instance map and key list
  //stay closure-private. Used by the debug setters today; the passes
  //WATER-TYPES.md adds next get it for free.
  this.forEachOceanMesh = function(cb){
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      cb(oceanPatchGeometryInstances[oceanGridInstanceKeys[i]], oceanGridInstanceKeys[i]);
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
  //Toggle THREE.CameraHelper wireframes for every shadow camera in play so
  //you can SEE the frustums in 3D — way more useful than reading dimensions
  //out of a dump. White = scene sun shadow (Three.js DirectionalLight), and
  //C0..C3 (ocean CSM) get red/orange/yellow/green for fine→coarse. Helpers
  //are added directly to the scene; update() is called per-frame from tick.
  //Call as setShadowHelpers(1) / setShadowHelpers(0).
  this._shadowHelpers = null;

  //Live-tuning setters + the window.* console surface. Installed from
  //ocean-system/passes/ocean-debug-controls.js; the whole console block is
  //stripped from the dist builds by make-combined.py's DEBUG markers.
  if(typeof ARestlessOcean.installOceanDebugControls === 'function'){
    ARestlessOcean.installOceanDebugControls(this);
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
        oceanMesh.material.side = under ? THREE.BackSide : THREE.FrontSide;
      }
    }
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

    //Late terrain discovery — same reasoning as sky discovery above.
    if(self._terrainProvider === 'a-faraway-land' && !self._landTerrainApi){
      self._discoverTerrainDirector();
    }

    //Terrain edits force the ortho + field refresh. Must run BEFORE the ortho
    //tick below, so the field re-fills against the fresh capture this frame.
    self._consumeTerrainEdits();

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
      //⚠ AND RE-ENABLE OUR LAYER ON IT. Ocean meshes live on OCEAN_LAYER and off
      //layer 0, so a camera that has not been told about that renders no water at
      //all. The constructor enables it on whatever camera existed then; A-Frame
      //swaps the scene camera on entering VR, on a <a-camera> being added late,
      //and on look-controls rebuilding the rig — every one of which landed here
      //with the new camera blind to the ocean.
      self.camera.layers.enable(ARestlessOcean.OCEAN_LAYER);
    }
    const sceneCamera = self.camera;
    sceneCamera.getWorldPosition(self.globalCameraPosition);

    //Ensure render targets match current drawing buffer size (A-Frame may resize after construction)
    self.renderer.getDrawingBufferSize(rendererSize);
    if(self.refractionGBufferTarget &&
       (self.refractionGBufferTarget.width !== rendererSize.x || self.refractionGBufferTarget.height !== rendererSize.y)){
      self.refractionGBufferPass.resize(rendererSize.x, rendererSize.y);
      //setSize replaces the depth texture object, so refresh the alias.
      self.refractionGBufferTarget = self.refractionGBufferPass.target;
      if(self.reflectionPass) self.reflectionPass.resize(rendererSize.x, rendererSize.y);
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

    //Hide all of our ocean grid elements
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].visible = false;
    }

    //Render scene to the refraction G-buffer (3 MRT attachments: albedo,
    //world-normal, linear-depth). The ocean meshes are hidden above; the
    //underwater curtain is skipped inside the pass.
    if(self.refractionGBufferPass){
      self.refractionGBufferPass.tick({
        scene: scene,
        camera: sceneCamera,
        skipMesh: self.underwaterCurtainMesh
      });
    }

    //Underwater planar reflection — rendered from the mirror camera while the
    //ocean grid is still hidden (so water is never in its own reflection) and
    //materials are restored to their lit originals. Gated on last frame's
    //submersion state — the probe runs later in tick, and one frame of lag on
    //the in/out transition is invisible. Pure overhead above water, so skip.
    if(self._wasUnderwater && self.reflectionPass){
      self.reflectionPass.tick({scene: scene, camera: sceneCamera});
    }


    //Foam + boat-hull exclusion ortho atlases. Snap-gated inside the pass, so
    //pure camera rotation costs nothing. Runs while the ocean meshes are still
    //hidden (they are shown again just below).
    if(self.terrainOrthoPass){
      self.terrainOrthoPass.tick({
        scene: scene,
        cameraX: self.globalCameraPosition.x,
        cameraZ: self.globalCameraPosition.z,
        heightOffset: self.waterLevelAt(self.globalCameraPosition.x, self.globalCameraPosition.z),
        onFoamRendered: function(rt, snapX, snapZ, halfWidth){
          if(self.oceanSplash){
            self.oceanSplash.requestTerrainReadback(rt, snapX, snapZ, halfWidth);
          }
        }
      });
      //foamRenderMap / exclusionMap always point at their (persistent) textures,
      //whether or not the pass re-rendered this frame.
      this.foamRenderMap = self.terrainOrthoPass.foamRenderTarget.texture;
      this.exclusionMap = self.terrainOrthoPass.exclusionRenderTarget.texture;
    }

    //Re-assert the analytic twin's level provider (a wind change rebuilds the
    //wave field and would otherwise drop it). Identity check, so it is free.
    self._syncWaveFieldSeam();

    //Refresh the water field. Cheap: each cascade re-fills only when its own
    //snapped centre moves, so the coarse rings are nearly always skipped. Runs
    //after the terrain ortho above because the standalone fill reads its output.
    if(self.waterFieldPass && self.terrainOrthoPass){
      self.waterFieldPass.tick({
        cameraX: self.globalCameraPosition.x,
        cameraZ: self.globalCameraPosition.z,
        seaLevel: self.heightOffset,
        waterType: self.data.water_type | 0,
        foamMap: self.terrainOrthoPass.foamRenderTarget.texture,
        foamCameraXZ: self.terrainOrthoPass.foamCameraXZ,
        foamHalfWidth: ARestlessOcean.Passes.TerrainOrthoPass.FOAM_ORTHO_HALF_WIDTH
      });
      //Publish the same field to a sibling terrain, by reference. It is how the
      //underwater mirror pass cuts above-water ground out of its render: a-land
      //carries no clipping chunks, so renderer.clippingPlanes never reached it,
      //and a single clip PLANE would be the wrong shape anyway once a lake sits
      //above an ocean. The clip itself stays disarmed until reflection-pass.js
      //brackets its mirror render with setWaterClipEnabled — binding the field
      //is not the same as switching it on, and the ordinary view must never be
      //clipped. One call per frame for every patch at once.
      if(self._terrainProvider === 'a-faraway-land'
         && typeof ALand !== 'undefined' && ALand.runtime && ALand.runtime.TerrainMaterial
         && ALand.runtime.TerrainMaterial.setWaterField
         && self.waterFieldPass.cascades.length === 3){
        const wfc = self.waterFieldPass.cascades;
        ALand.runtime.TerrainMaterial.setWaterField({
          cascades: [wfc[0].target.textures[0],
                     wfc[1].target.textures[0],
                     wfc[2].target.textures[0]],
          centers: [{x: wfc[0].centerX || 0, y: wfc[0].centerZ || 0},
                    {x: wfc[1].centerX || 0, y: wfc[1].centerZ || 0},
                    {x: wfc[2].centerX || 0, y: wfc[2].centerZ || 0}],
          halfWidths: [wfc[0].halfWidth, wfc[1].halfWidth, wfc[2].halfWidth]
        });
      }
    }

    //Show all of our ocean grid elements again
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].visible = true;
    }

    //Update each of our ocean grid height maps
    self.oceanHeightBandLibrary.tick(time);

    self.oceanHeightComposer.tick();

    //Refresh the local CPU height field for scalable exact buoyancy queries
    //(tiny GPU pass + async read; no-ops unless something asked for it).
    if(self.heightReadbackPass) self.heightReadbackPass.tick();

    //── Underwater submersion probe ────────────────────────────────────────
    //One 2-texel readback at the camera giving the wave-displaced water level —
    //the only way to drive the air/water swap without it popping under passing
    //crests. Async where supported; see HeightReadbackPass for why.
    let waterSurfaceY = self.heightReadbackPass
      ? self.heightReadbackPass.probeWaterSurfaceY()
      : self.waterLevelAt(self.globalCameraPosition.x, self.globalCameraPosition.z);

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
    if(self.causticProjectionPass){
      self.causticProjectionPass.tick({
        time: time,
        waterSurfaceY: waterSurfaceY,
        underwaterFactor: underwaterFactor,
        causticMap: self.causticMap,
        cameraX: self.globalCameraPosition.x,
        cameraZ: self.globalCameraPosition.z,
        sunLight: self.brightestDirectionalLight
      });
    }

    //Underwater fog. Fill A-Starry-Sky's reserved fog-shader slot once it is
    //available, then swap scene.fog between A-Starry-Sky's atmospheric fog
    //(above water) and our ocean fog (underwater). Both are THREE.Fog, so the
    //swap never recompiles; A-Starry-Sky's FogRenderer keeps updating its own
    //(now-detached) Fog harmlessly while we own scene.fog underwater. Negative
    //fogNear selects the injected ocean branch.
    if(self.underwaterFogChunk){
      self._fogChunkInjected = self.underwaterFogChunk.tick();
    }
    //Warm the underwater (clipping) shader variants once, a short delay after
    //the fog chunk is injected — the delay lets the injection's own needsUpdate
    //recompiles flush first so the warmed clipping program builds against the
    //FINAL chunk source (warming earlier would just get invalidated and rebuilt
    //on the dip, defeating the point). If the player somehow dives within this
    //window the old lazy compile still covers correctness; this only moves the
    //hitch off the dip in the common case.
    if(self.reflectionPass) self.reflectionPass.tickWarm(self._fogChunkInjected);
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
        //Waterline smuggled through fog.near. The SIGN is the ocean-branch gate
        //(a-starry-sky's convention too), so the magnitude carries the height —
        //and it must stay positive for the gate to hold.
        //
        //⚠ IT USED TO BE `-Math.max(waterSurfaceY, 0.001)`, WHICH SILENTLY
        //DESTROYS ANY WATER LEVEL BELOW ZERO. A sea level of -150 clamped to
        //0.001, so the shader placed the surface at y≈0 and computed
        //uwCamDepth = uwSurfaceY - cameraPosition.y ≈ 151 m for a camera one
        //metre under — full Beer-Lambert extinction over 151 m, i.e. a black
        //screen in ankle-deep water, with the Snell's window in the wrong place
        //to match. It hid for as long as it did only because every scene until
        //now floated its water within a metre or two of y=0, where being
        //clamped to zero is a small error rather than a catastrophic one.
        //
        //So bias the magnitude instead of clamping it — the same move fogFar
        //already makes for its linear/sRGB flag (+10). Supports any surface
        //above -SURFACE_Y_BIAS; float32 resolution at that magnitude is well
        //under a millimetre, so the waterline loses nothing.
        //A sibling terrain system gets the SAME fog, but through a typed channel
        //rather than this smuggle. a-land's ground shader is its own — it inlines
        //three's fog math instead of running whichever chunk is installed — so it
        //never saw the ocean branch, and ran plain linear fog against our
        //side-channel values instead: smoothstep(-9850, ~0.5, depth) saturates at
        //every fragment, replacing the terrain wholesale with the murk colour and
        //erasing its lighting (caustics included) after the fact. Handing it
        //parameters keeps the MODEL here and the application there — nothing about
        //how these numbers are derived crosses the boundary.
        //
        //⚠ IT MUST BE THE *FINISHED* MURK, NOT `_uwMurkScratch`. That vector is a
        //PARAMETER, not a colour: the isotropic baseline `albedo·(E_sun+E_sky)/4π`
        //at depth 0, which the fog chunk then finishes on the GPU by (a) re-weighting
        //through the angular factor, (b) adding the isotropic multiple-scatter floor
        //`uwMsRatio`, and (c) darkening by the CAMERA's depth. It is handed to the
        //chunk raw because the chunk re-derives all three per fragment; handing the
        //same vector to a sibling that uses it directly as "the colour a long path
        //asymptotes to" under-shoots by roughly 2.5-3x before depth darkening even
        //enters. That is a terrain that fades to near-black while the water it sits
        //in fades to teal — the two visibly disagreeing at infinity.
        //
        //So evaluate the chunk's own `uwMurk` here, on the CPU, with the same three
        //terms in the same order. The one thing that cannot be reproduced is the HG
        //gaze term, which is per-fragment — but UW_MURK_GAZE_WEIGHT is 0.0 in BOTH
        //shaders, which collapses `uwHGiso` to 1/4π and makes `uwAngFactor` the
        //view-independent `2 - sunFrac`. ⚠ If that constant is ever raised, this
        //stops being exact and the sibling needs the sun direction too.
        if(self._landTerrainApi && typeof ALand !== 'undefined'
           && ALand.runtime && ALand.runtime.TerrainMaterial
           && ALand.runtime.TerrainMaterial.setOceanFog){
          if(!self._uwLandMurk){ self._uwLandMurk = new THREE.Vector3(); }
          const angFactor = 2.0 - sunFrac;          //4π·sunFrac·(1/4π) + 2·(1 - sunFrac)
          const msRatioX = 4.0 * rInfA(albX) / Math.max(albX, 1e-4);
          const msRatioY = 4.0 * rInfA(albY) / Math.max(albY, 1e-4);
          const msRatioZ = 4.0 * rInfA(albZ) / Math.max(albZ, 1e-4);
          self._uwLandMurk.set(
            self._uwMurkScratch.x * (angFactor + msRatioX) * dDarkenX,
            self._uwMurkScratch.y * (angFactor + msRatioY) * dDarkenY,
            self._uwMurkScratch.z * (angFactor + msRatioZ) * dDarkenZ
          );
          ALand.runtime.TerrainMaterial.setOceanFog({
            surfaceY: waterSurfaceY,
            extinction: {x: extX, y: extY, z: extZ},
            murk: self._uwLandMurk,
            downwell: 1.0
          });
        }
        const yBias = ARestlessOcean.Passes.UnderwaterFogChunk.SURFACE_Y_BIAS;
        self._oceanFog.near = -Math.max(waterSurfaceY + yBias, 0.001);
        self._oceanFog.far = sunFrac;                            //> 0: sRGB-encoded output + |fogFar| = sunFrac
        self.scene.fog = self._oceanFog;
      } else if(self.scene.fog === self._oceanFog){
        //Surfaced (or chunk not injected): hand scene.fog back to A-Starry-Sky.
        self.scene.fog = (self._capturedSkyFog !== undefined) ? self._capturedSkyFog : null;
        //...and stand the sibling terrain's underwater fog down with it, or the
        //ground keeps its murk after we break the surface.
        if(typeof ALand !== 'undefined' && ALand.runtime && ALand.runtime.TerrainMaterial
           && ALand.runtime.TerrainMaterial.setOceanFog){
          ALand.runtime.TerrainMaterial.setOceanFog(null);
        }
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

    //Phase 2 wave-mask parameters, once per frame (wind can change at runtime).
    const waveMaskParams = self.waveMaskParams();

    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      const uniformsRef = oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms;
      ARestlessOcean.WaveMask.writeUniforms(uniformsRef, waveMaskParams);
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
        uniformsRef.meteringSurveyValid.value = 1.0;
      }
      uniformsRef.causticMap.value = self.causticMap;
      uniformsRef.causticIntensityMultiplier.value = self.causticsStrength;
      uniformsRef.reflectionScale.value = self.reflectionScale;
      uniformsRef.reflectionDistanceFalloff.value = self.reflectionDistanceFalloff;
      uniformsRef.ssrMaxSteps.value = self.ssrMaxSteps;
      uniformsRef.ssrSkyNormalBlend.value = self.ssrSkyNormalBlend;
      uniformsRef.ssrMarchNormalBlend.value = self.ssrMarchNormalBlend;
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
      //WaterField cascades (Phase 1b) — see water-shader.glsl's waterFieldLevelAt.
      if(self.waterFieldPass && self.waterFieldPass.cascades.length === 3){
        const wfc = self.waterFieldPass.cascades;
        uniformsRef.waterFieldCascade0.value = wfc[0].target.textures[0];
        uniformsRef.waterFieldCascade1.value = wfc[1].target.textures[0];
        uniformsRef.waterFieldCascade2.value = wfc[2].target.textures[0];
        for(let ci = 0; ci < 3; ++ci){
          uniformsRef.waterFieldCascadeCenter.value[ci].set(
            wfc[ci].centerX || 0, wfc[ci].centerZ || 0);
          uniformsRef.waterFieldCascadeHalfWidth.value[ci] = wfc[ci].halfWidth;
        }
      }

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
        if(self.underwaterFogChunk && self.underwaterFogChunk._sharedUwSunDir){
          self.underwaterFogChunk._sharedUwSunDir.copy(directionalLightDirection);
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
    //Phase 2: the BASE plane, like the clipmap patches — the shared vertex
    //shader lifts each skirt vertex by (field level − baseHeightOffset), so
    //placing the skirt at waterLevelAt(camera) counted a lake's height twice
    //and floated a lake-level sheet out to the horizon.
    if(self.horizonSkirtMesh){
      self.horizonSkirtMesh.position.set(sceneCamera.position.x,
        self.heightOffset, sceneCamera.position.z);
    }


    //Ocean-only CSM pass. MUST run after every ocean material has had its
    //cascade textures/uniforms refreshed for this frame — the shadow material
    //picks up the current FFT state by reference. The pass then pushes the
    //resulting depth textures + shadow matrices back to each water material.
    if(self.oceanShadowPass){
      self.oceanShadowPass.tick({
        camera: sceneCamera,
        sunLight: self.directionalLights.length > 0 ? self.directionalLights[0] : null,
        instanceKeys: oceanGridInstanceKeys,
        instances: oceanPatchGeometryInstances,
        sunDirectionScratch: directionalLightDirection,
        oceanShadowOverride: self._oceanShadowOverride
      });
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
    if(self.underwaterFogChunk) self.underwaterFogChunk.broadcastSunDir();

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

//Phase 1c terrain-edit refresh pacing — see _subscribeTerrainEdits.
ARestlessOcean.OceanGrid.TERRAIN_EDIT_THROTTLE_MS = 150;
ARestlessOcean.OceanGrid.TERRAIN_EDIT_SETTLE_MS = 400;
