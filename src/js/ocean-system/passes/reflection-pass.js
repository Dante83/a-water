//── Reflection pass (underwater planar mirror + above-water transmission) ───
//
//Extracted from ocean-grid.js (0.2.0 lines 254-295, 1772-2060 and the tick
//invocations at 2577-2584 / 2678-2681 / 2905-2908) as part of the Phase 0
//decomposition. The two render bodies were moved by mechanical rename only —
//self.<own field> became this.<field> and every other self.X became grid.X —
//so no statement changed and nothing was reordered. See
//WATER-TYPES-PROGRESS.md for the old-line map.
//
//TWO TARGETS, BOTH ONLY WHEN SUBMERGED
//
//1. `target` — the underwater planar reflection. The TIR mirror the ceiling
//   samples OUTSIDE Snell's window: the underwater scene rendered from a camera
//   mirrored across the wave-displaced water plane. Half-res (the sample is
//   wave-distorted and fogged, so it needs no crispness) and HalfFloat (so
//   un-tone-mapped linear radiance is not clamped at 1).
//
//2. `transmissionTarget` — the above-water transmission. What the ceiling's
//   Snell-window transmitted ray samples. The refraction G-buffer cannot serve
//   this role (raw albedo, sky dome hidden, no atmospheric fog), so this replays
//   the same camera fully lit with the sky dome restored.
//
//⚠️ THE ONE-FRAME LAG IS INTENTIONAL — DO NOT "FIX" IT
//This pass runs EARLY in OceanGrid.tick, before the submersion probe and before
//the underwater murk block. It therefore reads eight values that the current
//frame has not computed yet, and gets LAST frame's:
//    _wasUnderwater      (the gate on whether this pass runs at all)
//    _lastWaterSurfaceY  (the mirror plane)
//    _uwBaselineCamDepth _uwReflSurfaceMurk _uwReflCamDepthMurk
//    _uwSunFrac          (smuggled through fog.far — see below)
//    _capturedSkyFog _aboveWaterBackground
//The surface moves at swell speed and the air/water swap is smoothed over a 1 m
//band, so one frame of lag is invisible. Reordering the tick to "fix" this would
//mean rendering the mirror after the murk block, i.e. after the ocean meshes are
//shown again — and then the water appears in its own reflection.
//
//⚠️ fogFar MUST STAY > 0 IN THE MIRROR PASS
//a-starry-sky's fog_fragment routes on `if(fogFar <= 0.0)` into its ATMOSPHERIC
//branch, checked BEFORE our `else if(fogNear < 0.0)` ocean branch. A negative
//fogFar (once used to signal "linear output") therefore sent the whole mirror
//pass into a-starry-sky's atmospheric fog and our ocean chunk never ran in the
//reflection at all. The linear/sRGB flag rides in fogFar's MAGNITUDE instead:
//+10 offset for the linear RT pass, bare sunFrac for the main canvas.
//
//⚠️ THE SHADER WARM RUNS THROUGH THE REAL RENDER PATH
//Going from zero clipping planes to one changes NUM_CLIPPING_PLANES and forces
//every scene material to recompile — the multi-hundred-ms hitch on first dip.
//renderer.compile() does NOT bake the global clipping define, so warming that
//way is useless (measured: Programs still jumped +37 on the first dip). We drive
//the actual reflection pass once instead.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.ReflectionPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;

  //Half-res: the sample is wave-distorted and fogged so it needs no crispness,
  //and the whole pass is skipped entirely above water.
  this.resolutionScale = 0.5;
  this.target = null;
  this.transmissionTarget = null;
  this._reflectionCamera = null;
  this._reflectionTextureMatrix = null;
  this._reflScratch = null;
  this._reflClipPlane = null;
  this._uwTxScratch = null;
  this._shadersWarmed = false;
  this._warmCountdown = undefined;
};

ARestlessOcean.Passes.ReflectionPass.prototype.init = function(width, height){
  const w = Math.max(1, (width * this.resolutionScale) | 0);
  const h = Math.max(1, (height * this.resolutionScale) | 0);
  const opts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType
  };
  this.target = new THREE.WebGLRenderTarget(w, h, opts);
  this.transmissionTarget = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType
  });
  this._reflectionCamera = new THREE.PerspectiveCamera();
  this._reflectionTextureMatrix = new THREE.Matrix4();
};

ARestlessOcean.Passes.ReflectionPass.prototype.resize = function(width, height){
  const w = Math.max(1, (width * this.resolutionScale) | 0);
  const h = Math.max(1, (height * this.resolutionScale) | 0);
  this.target.setSize(w, h);
  this.transmissionTarget.setSize(w, h);
};

//Both RTs, in the order the 0.2.0 tick ran them. Called only while submerged
//(the caller gates on last frame's _wasUnderwater) and only while the ocean
//meshes are hidden, so the water never appears in its own reflection.
ARestlessOcean.Passes.ReflectionPass.prototype.tick = function(ctx){
  this.renderUnderwaterReflection(ctx.scene, ctx.camera);
  this.renderAboveWaterTransmission(ctx.scene, ctx.camera);
};

//Drive the one-shot shader warm. Counts down a short delay after the fog chunk
//is injected so the warmed clipping program builds against the FINAL chunk
//source — warming earlier would just get invalidated and rebuilt on the dip,
//defeating the point.
ARestlessOcean.Passes.ReflectionPass.prototype.tickWarm = function(fogChunkInjected){
  if(this._shadersWarmed || !fogChunkInjected) return;
  this._warmCountdown = (this._warmCountdown === undefined) ? 20 : (this._warmCountdown - 1);
  if(this._warmCountdown <= 0){ this.warmUnderwaterShaders(); }
};

//Render the underwater scene from a camera mirrored across the rest water
//plane (y = heightOffset) into the planar-reflection target — the TIR
//mirror the ceiling samples outside Snell's window. Reflecting the camera's
//position, forward and up across the plane and then doing a normal lookAt
//keeps the virtual camera right-handed (no winding flip) — the
//THREE.Reflector trick. Caller renders this while the ocean grid is hidden.
ARestlessOcean.Passes.ReflectionPass.prototype.renderUnderwaterReflection = function(scene, mainCamera){
  const grid = this.oceanGrid;
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
  const h = (grid._lastWaterSurfaceY !== undefined)
    ? grid._lastWaterSurfaceY
    : grid.heightOffset;
  const reflCam = this._reflectionCamera;
  if(!this._reflScratch){
    this._reflScratch = {
      pos: new THREE.Vector3(), fwd: new THREE.Vector3(),
      up: new THREE.Vector3(), quat: new THREE.Quaternion(),
      target: new THREE.Vector3(), clearColor: new THREE.Color(),
      murk: new THREE.Color()
    };
  }
  const s = this._reflScratch;
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
  this._reflectionTextureMatrix.set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );
  this._reflectionTextureMatrix.multiply(reflCam.projectionMatrix);
  this._reflectionTextureMatrix.multiply(reflCam.matrixWorldInverse);

  //Hide the sky dome — only the underwater scene belongs in the mirror;
  //empty directions then read as the dark clear colour (the ceiling shader
  //fogs them toward the murk). The ocean grid is already hidden by the
  //caller, so the water never appears in its own reflection.
  const atmRenderer = grid.skyDirector && grid.skyDirector.renderers && grid.skyDirector.renderers.atmosphereRenderer;
  const skyMesh = atmRenderer && atmRenderer.skyMesh;
  const skyWasVisible = skyMesh ? skyMesh.visible : false;
  if(skyMesh){ skyMesh.visible = false; }
  //Keep the underwater curtain visible in the mirror so the direct view and
  //the reflected view share the same backdrop. Hiding it left empty mirror
  //directions falling back to the dark clear colour while the direct view
  //filled the same directions with the murk-coloured curtain — so the
  //reflected horizon colours stopped matching the direct horizon.

  const prevRT = this.renderer.getRenderTarget();
  const prevToneMapping = this.renderer.toneMapping;
  this.renderer.getClearColor(s.clearColor);
  const prevClearAlpha = this.renderer.getClearAlpha();

  //Force scene.fog to the UNDERWATER ocean fog for the mirror RT (don't just
  //inherit it). The chunk then fogs the reflected geometry over the bounce
  //path: by the reflection-trick equivalence the mirror camera's straight-line
  //distance to a fragment equals the real cam→surface→reflected-point path, so
  //it's one segment. Setting it explicitly (rather than relying on the prior
  //frame's swap still being mounted) guarantees the reflection never picks up
  //the atmospheric fog on the boundary frame. Only do it when the ocean fog is
  //actually armed (chunk injected); otherwise leave whatever is mounted.
  const prevFog = scene.fog;
  if(grid._fogChunkInjected){ scene.fog = grid._oceanFog; }
  //Swap the chunk's fogColor to the CAMERA-DEPTH-darkened baseline for this
  //pass so the reflected geometry fogs toward the same teal the direct seabed
  //reaches (see _uwBaselineCamDepth). The mirror cam is above water so the
  //chunk can't derive the camera-depth darkening itself. Save/restore the raw
  //RGB (the tick rewrites fogColor from _uwMurkScratch every frame anyway).
  const prevFogColorR = grid._oceanFog.color.r;
  const prevFogColorG = grid._oceanFog.color.g;
  const prevFogColorB = grid._oceanFog.color.b;
  if(grid._uwBaselineCamDepth){
    //SRGBToLinear pre-comp (see _toFogUniform) — same reason as the main pass.
    grid._oceanFog.color.setRGB(grid._toFogUniform(grid._uwBaselineCamDepth.x),
                                grid._toFogUniform(grid._uwBaselineCamDepth.y),
                                grid._toFogUniform(grid._uwBaselineCamDepth.z));
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
  const prevFogFar = grid._oceanFog.far;
  const sunFracForRT = (grid._uwSunFrac !== undefined) ? grid._uwSunFrac : 0.5;
  grid._oceanFog.far = sunFracForRT + 10.0;

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
  if(!this._reflClipPlane){
    this._reflClipPlane = new THREE.Plane(new THREE.Vector3(0.0, -1.0, 0.0), 0.0);
  }
  this._reflClipPlane.constant = h;
  const prevClippingPlanes = this.renderer.clippingPlanes;
  const prevLocalClipping = this.renderer.localClippingEnabled;
  this.renderer.clippingPlanes = [this._reflClipPlane];
  this.renderer.localClippingEnabled = true;

  //Linear output (NoToneMapping) so the colour feeds straight into the
  //ceiling's linear composite without a tone-map / encode round-trip.
  this.renderer.toneMapping = THREE.NoToneMapping;
  this.renderer.setRenderTarget(this.target);
  //Clear to the SURFACE-level inscatter murk (LINEAR — the RT is NoToneMapping
  //and feeds the ceiling's linear composite directly), not black and not the
  //camera-depth murk. This RT is the reflected (post-bounce) leg, whose path
  //starts at the surface, so its infinite-depth equilibrium is the surface
  //murk — the SAME teal the reflected geometry fogs to (mirror cam above water
  //→ uwCamDepth 0). Empty/curtain-gap directions then match the reflected
  //seabed instead of going dim, so the ceiling's TIR lookup reads teal, not a
  //dark void. Falls back to the camera-depth murk, then a seeded default,
  //before the first surface-murk update (one-frame lag, invisible).
  const m = grid._uwReflCamDepthMurk || grid._uwReflSurfaceMurk || grid._uwMurkCamDepthScratch;
  if(m){ s.murk.setRGB(m.x, m.y, m.z); } else { s.murk.setRGB(0.02, 0.06, 0.08); }
  this.renderer.setClearColor(s.murk, 1.0);
  this.renderer.clear();
  this.renderer.render(scene, reflCam);

  this.renderer.clippingPlanes = prevClippingPlanes;
  this.renderer.localClippingEnabled = prevLocalClipping;
  grid._oceanFog.far = prevFogFar;
  grid._oceanFog.color.setRGB(prevFogColorR, prevFogColorG, prevFogColorB);
  scene.fog = prevFog;
  this.renderer.setClearColor(s.clearColor, prevClearAlpha);
  this.renderer.toneMapping = prevToneMapping;
  this.renderer.setRenderTarget(prevRT);
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
ARestlessOcean.Passes.ReflectionPass.prototype.warmUnderwaterShaders = function(){
  const grid = this.oceanGrid;
  if(this._shadersWarmed) return;
  if(!grid.scene || !grid.camera || !this.renderer) return;
  if(!this.target || !this.transmissionTarget) return;
  try {
    //Reflection = the clipping warm (the +37). Transmission adds no new
    //programs (same materials as a normal above-water frame) but is cheap and
    //keeps the Snell-window source primed too.
    this.renderUnderwaterReflection(grid.scene, grid.camera);
    this.renderAboveWaterTransmission(grid.scene, grid.camera);
  } catch(e){ /* best-effort warm; never break the frame over a precompile */ }
  this._shadersWarmed = true;
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
ARestlessOcean.Passes.ReflectionPass.prototype.renderAboveWaterTransmission = function(scene, mainCamera){
  const grid = this.oceanGrid;
  if(!this._uwTxScratch){
    this._uwTxScratch = { clearColor: new THREE.Color() };
  }
  const s = this._uwTxScratch;

  const atmRenderer = grid.skyDirector && grid.skyDirector.renderers && grid.skyDirector.renderers.atmosphereRenderer;
  const skyMesh = atmRenderer && atmRenderer.skyMesh;
  const skyWasVisible = skyMesh ? skyMesh.visible : false;
  if(skyMesh){ skyMesh.visible = true; }

  //Sun/moon disk planes are hidden underwater for the main render (sky-dome
  //swap), but the Snell window should still show them refracted through the
  //surface — so force them visible just for this above-water capture and
  //restore afterward (mirrors skyMesh above).
  const rends = grid.skyDirector && grid.skyDirector.renderers;
  const sunMesh = rends && rends.sunRenderer && rends.sunRenderer.sunMesh;
  const moonMesh = rends && rends.moonRenderer && rends.moonRenderer.moonMesh;
  const sunWasVisible = sunMesh ? sunMesh.visible : false;
  const moonWasVisible = moonMesh ? moonMesh.visible : false;
  if(sunMesh){ sunMesh.visible = true; }
  if(moonMesh){ moonMesh.visible = true; }

  const curtain = grid.underwaterCurtainMesh;
  const curtainWasVisible = curtain ? curtain.visible : false;
  if(curtain){ curtain.visible = false; }

  //Swap the ocean underwater fog for the captured above-water fog (the
  //a-starry-sky atmospheric perspective version, captured in tick on every
  //above-water frame). Above-water fragments would otherwise get NO fog
  //at all here — the ocean chunk's world-Y gate excludes them, and the
  //atmospheric perspective branch isn't entered when scene.fog is the
  //ocean fog. Fall back to whatever's mounted if no capture exists yet.
  const prevFog = scene.fog;
  if(grid._capturedSkyFog !== undefined){
    scene.fog = grid._capturedSkyFog;
  }

  //Background swap — while submerged scene.background was set to the
  //murk colour; for this pass we want the captured above-water bg (the
  //sky colour) so cleared/sky-dome pixels read correctly.
  const prevBackground = scene.background;
  if(grid._aboveWaterBackground !== undefined){
    scene.background = grid._aboveWaterBackground;
  }

  const prevRT = this.renderer.getRenderTarget();
  const prevToneMapping = this.renderer.toneMapping;
  this.renderer.getClearColor(s.clearColor);
  const prevClearAlpha = this.renderer.getClearAlpha();

  //Linear output — feeds straight into the ceiling's linear composite
  //without a tone-map / encode round-trip.
  this.renderer.toneMapping = THREE.NoToneMapping;
  this.renderer.setRenderTarget(this.transmissionTarget);
  this.renderer.setClearColor(0x000000, 1.0);
  this.renderer.clear();
  this.renderer.render(scene, mainCamera);

  scene.fog = prevFog;
  scene.background = prevBackground;
  this.renderer.setClearColor(s.clearColor, prevClearAlpha);
  this.renderer.toneMapping = prevToneMapping;
  this.renderer.setRenderTarget(prevRT);
  if(skyMesh){ skyMesh.visible = skyWasVisible; }
  if(sunMesh){ sunMesh.visible = sunWasVisible; }
  if(moonMesh){ moonMesh.visible = moonWasVisible; }
  if(curtain){ curtain.visible = curtainWasVisible; }
};

ARestlessOcean.Passes.ReflectionPass.prototype.dispose = function(){
  if(this.target) this.target.dispose();
  if(this.transmissionTarget) this.transmissionTarget.dispose();
  this.target = null;
  this.transmissionTarget = null;
};
