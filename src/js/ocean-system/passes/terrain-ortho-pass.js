//── Terrain ortho pass (foam height atlas + boat-hull exclusion atlas) ──────
//
//Extracted verbatim from ocean-grid.js (0.2.0 lines 787-838, 911-919 and the
//tick block at 2683-2782) as part of the Phase 0 decomposition. Behaviour is
//unchanged; see WATER-TYPES-PROGRESS.md for the full old-line -> new-file map.
//
//WHY FOAM AND EXCLUSION LIVE IN ONE MODULE
//WATER-TYPES.md Phase 0 lists these as two passes. In the code they are welded
//together and splitting them would be a regression risk, not a tidy-up:
//  - they share one `positionPassMaterial` (scene.overrideMaterial for both)
//  - they share the saved render target / clear alpha captured before the block
//  - they share the scene.background = null enter/exit dance, whose exact
//    ordering fixed two shipped bugs (see the inline notes below)
//  - they share the _staleFrames snap-gate that suppresses re-renders during
//    pure camera rotation
//Separating them means either duplicating that state dance or inventing a third
//coordinator. One module with _renderFoam() / _renderExclusion() internals is
//the honest boundary. Phase 1's WaterField will likely subsume the foam half.
//
//WHAT EACH ATLAS IS
//foam: a 1024^2 FloatType top-down capture of terrain world position over a
//4096 m square (4 m/texel). The water shader maps world XZ into it to find
//shore proximity for the breaker line; ocean-splash.js reads it back to the CPU
//for shore emission. NOT layer-filtered — it captures the whole scene.
//
//exclusion: a 1024^2 FloatType NearestFilter capture of LAYER 30 ONLY (boat
//interior hulls and similar volumes that need water masked inside them) over a
//500 m square (~0.49 m/texel). The .g channel is a discard THRESHOLD (boat
//world-Y) and .a is a 0/1 mask, so NEAREST is mandatory — LinearFilter blended
//the below-water interior-floor height with the rim and the cleared texels, and
//along the hull rim the discard height drifted below the water (over-discard ->
//ring straight to the seabed) or above it (under-discard -> water leaks into
//the hull).
//
//Residual keel-crease tris + a ~1px waterline edge remain: they are texel-
//resolution limited over the 500 m ortho. Confirmed via a 2048^2 test (the tris
//shrank with texel size). The sharp fix is a tighter ortho extent (fit-to-boat)
//for sub-decimetre texels at the same 16 MB size — that needs the hardcoded
//half-widths hoisted out of water-shader.glsl first (Phase 0 commit B).

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

//~0.5 s @60 fps safety refresh, so slow-moving dynamic occluders (a drifting
//boat etc.) still imprint their height even without a snap delta.
ARestlessOcean.Passes.TerrainOrthoPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.scene = oceanGrid.scene;

  this.foamRenderTarget = null;
  this.exclusionRenderTarget = null;
  this.foamCamera = null;
  this.exclusionCamera = null;
  this.positionPassMaterial = null;

  //Snapped atlas centres, uploaded to the water shader as foamCameraXZ /
  //exclusionCameraXZ so it samples with the SAME origin we rendered from.
  this.foamCameraXZ = new THREE.Vector2();
  this.exclusionCameraXZ = new THREE.Vector2();

  this._staleFrames = 0;
  this._everRendered = false;
  this._lastFoamSnapX = undefined;
  this._lastFoamSnapZ = undefined;
  this._lastExclSnapX = undefined;
  this._lastExclSnapZ = undefined;
};

ARestlessOcean.Passes.TerrainOrthoPass.MAX_STALE_FRAMES = 30;

ARestlessOcean.Passes.TerrainOrthoPass.prototype.init = function(){
  const grid = this.oceanGrid;

  //Depth camera pointing down for edge foam.
  //1024^2 RGBA FloatType = ~16 MB (was 4096^2 ~ 268 MB). The ortho still covers
  //4096 m, so texel size is 4 m/texel (was 1 m). Shore-foam band is 0.5-4 m
  //(water-shader: shoreFade), so the breaker line quantises to ~4 m steps —
  //bump back to 2048^2 (2 m/texel, ~67 MB) if the shoreline reads stair-stepped.
  this.foamRenderTarget = new THREE.WebGLRenderTarget(1024, 1024, {
    type: THREE.FloatType
  });
  this.foamCamera = new THREE.OrthographicCamera(-2048.0, 2048.0, 2048.0, -2048.0, 0.1, grid.foamCameraHeight + 500.0);
  this.scene.add(this.foamCamera);

  //Depth camera pointing down for ocean exclusion mapping. Unlike foamCamera
  //this is NOT a terrain-height capture — it renders only layer-30 meshes. One
  //small mesh near the camera, so the render target is sized to that scope:
  //500 m x 500 m at 1024^2 ~ 0.49 m/texel. The previous 4096^2 x 2048 m x 2048 m
  //sizing was a 256 MB FloatType buffer to mask a single boat — pure VRAM waste.
  //
  //Keep the shader's exclusion-sample radius (water-shader.glsl, divide-by
  //in vec2(...)) in sync with this ortho extent's half-width.
  //NEAREST filtering is mandatory here — see the module header for why.
  this.exclusionRenderTarget = new THREE.WebGLRenderTarget(1024, 1024, {
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter
  });
  this.exclusionCamera = new THREE.OrthographicCamera(-250.0, 250.0, 250.0, -250.0, 0.1, grid.foamCameraHeight + 500.0);
  this.exclusionCamera.layers.disableAll();
  this.exclusionCamera.layers.set(30);
  this.scene.add(this.exclusionCamera);

  //Shared override material for BOTH orthos: writes world position into RGB,
  //hence the .g channel carrying world-Y downstream.
  this.positionPassMaterial = new THREE.ShaderMaterial({
    vertexShader: ARestlessOcean.Materials.Ocean.positionPassMaterial.vertexShader,
    fragmentShader: ARestlessOcean.Materials.Ocean.positionPassMaterial.fragmentShader,
    side: THREE.FrontSide,
    transparent: false,
    lights: false
  });
  this.positionPassMaterial.uniforms = ARestlessOcean.Materials.Ocean.positionPassMaterial.uniforms;
  this.positionPassMaterial.uniforms.worldMatrix.value = grid.camera.matrixWorld;
};

//Fixed-size atlases — independent of the drawing buffer.
ARestlessOcean.Passes.TerrainOrthoPass.prototype.resize = function(){};

//ctx: {scene, cameraX, cameraZ, heightOffset, onFoamRendered}
//onFoamRendered(renderTarget, snapX, snapZ, halfWidth) fires only on frames the
//foam atlas actually re-rendered — ocean-splash.js uses it to pull the terrain
//height field to the CPU for shore emission.
ARestlessOcean.Passes.TerrainOrthoPass.prototype.tick = function(ctx){
  const grid = this.oceanGrid;
  const scene = ctx.scene;
  const renderer = this.renderer;

  const currentRenderTarget = renderer.getRenderTarget();
  const prevClearAlpha = renderer.getClearAlpha();
  //Snap foam/exclusion camera XZ to texel-sized increments so the orthos
  //sample the same world-space points across frames — otherwise the foam
  //and exclusion atlases shift by a fractional pixel each frame as the
  //player moves, producing visible flicker on the foam pattern. The water
  //shader must then sample using these SNAPPED positions (uploaded as
  //foamCameraXZ / exclusionCameraXZ uniforms), not raw cameraPosition.
  //Same pattern as the per-cell clipmap snap at the top of OceanGrid.tick.
  const foamTexel = (2.0 * 2048.0) / this.foamRenderTarget.width; // 4096m / 1024px = 4m
  const exclTexel = (2.0 *  250.0) / this.exclusionRenderTarget.width; // 500m / 1024px ~ 0.488m
  const foamSnapX = Math.round(ctx.cameraX / foamTexel) * foamTexel;
  const foamSnapZ = Math.round(ctx.cameraZ / foamTexel) * foamTexel;
  const exclSnapX = Math.round(ctx.cameraX / exclTexel) * exclTexel;
  const exclSnapZ = Math.round(ctx.cameraZ / exclTexel) * exclTexel;
  this.foamCameraXZ.set(foamSnapX, foamSnapZ);
  this.exclusionCameraXZ.set(exclSnapX, exclSnapZ);

  //── Snap-gated re-render ───────────────────────────────────────────────
  //The foam/exclusion orthos capture STATIC terrain height from a fixed
  //top-down view, so their output is INVARIANT to camera yaw — it only
  //changes when the snapped origin translates. Re-rendering identical
  //FloatType atlases every frame during pure rotation was the bulk of the
  //per-frame GPU cost behind the "freezes when I rotate" symptom. We now
  //re-render only on a snap delta, with a periodic forced refresh so slow-
  //moving dynamic occluders (a drifting boat etc.) still imprint their
  //height within MAX_STALE_FRAMES.
  const MAX_STALE_FRAMES = ARestlessOcean.Passes.TerrainOrthoPass.MAX_STALE_FRAMES;
  this._staleFrames = this._staleFrames + 1;
  const forceRefresh = !this._everRendered || this._staleFrames >= MAX_STALE_FRAMES;
  const renderFoam = forceRefresh || this._lastFoamSnapX !== foamSnapX || this._lastFoamSnapZ !== foamSnapZ;
  const renderExcl = forceRefresh || this._lastExclSnapX !== exclSnapX || this._lastExclSnapZ !== exclSnapZ;

  if(renderFoam || renderExcl){
    scene.overrideMaterial = this.positionPassMaterial;
    renderer.setClearAlpha(0.0);
    //Null the backdrop for these top-down position passes too. With a
    //scene.background set, THREE's background quad stamps alpha 1 into the
    //foam/exclusion atlases over open water — and the exclusion .a channel is
    //the water shader's discard gate (worldPosition.y > discardHeight). That
    //made every open-water fragment within exclusion range discard (near water
    //gone, horizon — outside range — survived). Restored at the block's end.
    const _foamSavedBackground = scene.background;
    scene.background = null;
    if(renderFoam){
      this.foamCamera.position.set(foamSnapX, ctx.heightOffset + grid.foamCameraHeight, foamSnapZ);
      this.foamCamera.lookAt(foamSnapX, ctx.heightOffset - 1.0, foamSnapZ);
      this.foamCamera.updateProjectionMatrix();
      renderer.setRenderTarget(this.foamRenderTarget);
      renderer.clear();
      renderer.render(scene, this.foamCamera);
      renderer.setRenderTarget(null);
      this._lastFoamSnapX = foamSnapX;
      this._lastFoamSnapZ = foamSnapZ;
      //Copy the just-rendered terrain-height ortho to the CPU (async) so the
      //splash system can detect the shoreline. Only fires on snap-change, so
      //the transfer is rare. Half-width is 2048 m (see foamTexel above).
      if(ctx.onFoamRendered){
        ctx.onFoamRendered(this.foamRenderTarget, foamSnapX, foamSnapZ, 2048.0);
      }
    }
    if(renderExcl){
      this.exclusionCamera.position.set(exclSnapX, ctx.heightOffset + grid.foamCameraHeight, exclSnapZ);
      this.exclusionCamera.lookAt(exclSnapX, ctx.heightOffset - 1.0, exclSnapZ);
      this.exclusionCamera.updateProjectionMatrix();
      renderer.setRenderTarget(this.exclusionRenderTarget);
      renderer.clear();
      //Capture the boat hull DOUBLE-SIDED for this pass only. The boat is a
      //thin/mixed-winding shell, so FrontSide back-face-culls every floor or
      //hull triangle whose normal points away from this top-down camera —
      //those texels capture nothing, read mask 0, and the water is never
      //discarded there, poking through one un-captured triangle at a time
      //("little tris" inside the hull). DoubleSide makes the capture purely
      //depth-based regardless of winding. Restored to FrontSide immediately
      //so the shared foam terrain pass is unaffected. (.side is a cull-state
      //toggle, not a #define — no shader recompile.)
      this.positionPassMaterial.side = THREE.DoubleSide;
      renderer.render(scene, this.exclusionCamera);
      this.positionPassMaterial.side = THREE.FrontSide;
      renderer.setRenderTarget(null);
      this._lastExclSnapX = exclSnapX;
      this._lastExclSnapZ = exclSnapZ;
    }
    //Restore our original materials + clear state (captured BEFORE zeroing —
    //the old code captured alpha AFTER setClearAlpha(0) and so "restored" 0,
    //leaking a 0 clear alpha into the rest of the frame).
    scene.overrideMaterial = null;
    renderer.setRenderTarget(currentRenderTarget);
    renderer.setClearAlpha(prevClearAlpha);
    scene.background = _foamSavedBackground;
    this._staleFrames = 0;
    this._everRendered = true;
  }
};

ARestlessOcean.Passes.TerrainOrthoPass.prototype.dispose = function(){
  if(this.foamCamera) this.scene.remove(this.foamCamera);
  if(this.exclusionCamera) this.scene.remove(this.exclusionCamera);
  if(this.positionPassMaterial) this.positionPassMaterial.dispose();
  if(this.foamRenderTarget) this.foamRenderTarget.dispose();
  if(this.exclusionRenderTarget) this.exclusionRenderTarget.dispose();
  this.foamRenderTarget = null;
  this.exclusionRenderTarget = null;
};
