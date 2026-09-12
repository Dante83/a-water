//── Terrain ortho pass (foam height atlas + boat-hull exclusion atlas) ──────
//
//Extracted verbatim from ocean-grid.js (0.2.0 lines 787-838, 911-919 and the
//tick block at 2683-2782) as part of the Phase 0 decomposition. Behaviour is
//unchanged; see WATER-TYPES-PROGRESS.md for the full old-line -> new-file map.
//
//WHY FOAM AND EXCLUSION LIVE IN ONE MODULE
//WATER-TYPES.md Phase 0 lists these as two passes. In the code they are welded
//together and splitting them would be a regression risk, not a tidy-up:
//  - they share one `positionPassMaterial` (the swap target for both)
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
//WHY A PER-MESH SWAP RATHER THAN scene.overrideMaterial
//It used to be an override, and for ordinary meshes the two are identical — the
//position pass wants one material on everything. But an override replaces the
//VERTEX stage too, and a sibling system's terrain may keep its entire geometry
//there: a-land's CDLOD patches share one [0,1]x[0,1] grid at y = 0 and place
//themselves from per-patch uniforms, so under an override every patch in the
//world collapsed onto a single 1 m quad at the origin. The foam atlas therefore
//saw NO a-land terrain at all — no shore foam, no shore splash emission, and
//the WaterField's standalone base layer fell through to open-ocean depth
//everywhere. Silently, because a missing capture reads exactly like open water.
//
//So: everything still gets `positionPassMaterial`, except foreign terrain,
//which gets a twin of its own material (their vertex stage, our fragment stage)
//from ARestlessOcean.Passes.ForeignTerrainTwin — the same machinery the
//refraction G-buffer uses. Restored in a finally, like that pass.
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
  //Twins for a sibling system's terrain, built in init(). See the header.
  this._geoTwins = null;
  this._swappedMeshes = [];

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

//── The two ortho half-widths, in metres — SINGLE SOURCE OF TRUTH ──────────
//These drive, in this file: both OrthographicCamera extents and both texel
//sizes; outside it: the foam terrain readback handed to ocean-splash.js, and
//the FOAM_ORTHO_HALF_WIDTH / EXCLUSION_ORTHO_HALF_WIDTH consts spliced into
//water-shader.glsl by the template's fragmentShader(). Before Phase 0 these
//were nine bare literals across five files, two of them inside GLSL, with
//comments in ocean-grid.js admitting they had to be kept in sync by hand.
//
//Changing FOAM changes the shore-foam sample window (4096 m across at 1024^2
//= 4 m/texel today). Changing EXCLUSION tightens the boat-hull mask; that is
//the deferred fit-to-boat fix, which was blocked precisely on this hoist.
//Both feed the shader as consts, not uniforms — they are per-session values
//and uniform slots are scarce here.
ARestlessOcean.Passes.TerrainOrthoPass.FOAM_ORTHO_HALF_WIDTH = 2048.0;
ARestlessOcean.Passes.TerrainOrthoPass.EXCLUSION_ORTHO_HALF_WIDTH = 250.0;

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
  const foamHalf = ARestlessOcean.Passes.TerrainOrthoPass.FOAM_ORTHO_HALF_WIDTH;
  this.foamCamera = new THREE.OrthographicCamera(-foamHalf, foamHalf, foamHalf, -foamHalf, 0.1, grid.foamCameraHeight + 500.0);
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
  const exclHalf = ARestlessOcean.Passes.TerrainOrthoPass.EXCLUSION_ORTHO_HALF_WIDTH;
  this.exclusionCamera = new THREE.OrthographicCamera(-exclHalf, exclHalf, exclHalf, -exclHalf, 0.1, grid.foamCameraHeight + 500.0);
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
  //Cloned, not aliased. In 0.2.0 this assigned the module-global directly and
  //nothing anywhere cloned it, so two ocean grids would have shared one uniforms
  //map — and worldMatrix would have pointed at whichever grid constructed last.
  this.positionPassMaterial.uniforms = ARestlessOcean.cloneUniforms(ARestlessOcean.Materials.Ocean.positionPassMaterial.uniforms);
  this.positionPassMaterial.uniforms.worldMatrix.value = grid.camera.matrixWorld;

  //Foreign-terrain twin: their vertex stage, a fragment stage that writes the
  //same thing positionPassMaterial does — world position in RGB, hence the .g
  //channel carrying world-Y downstream, and .a = 1 marking "geometry here".
  //It cannot read a vWorldPosition varying (the no-varyings rule — see the twin
  //module's header), so it reconstructs world position from gl_FragCoord via the
  //spliced prologue. That works for an orthographic camera exactly as it does
  //for a perspective one.
  if(ARestlessOcean.Passes.ForeignTerrainTwin){
    this._geoTwins = new ARestlessOcean.Passes.ForeignTerrainTwin([
      'layout(location = 0) out vec4 gPosition;',
      'void main(){',
      '  gPosition = vec4(aroTwinWorldPos(aroTwinViewPos()), 1.0);',
      '}'
    ].join('\n'));
  }
};

//Swap every visible object onto the position-pass material for the duration of
//the ortho renders, restoring in _restoreMaterials(). Foreign terrain gets its
//twin instead; see the header for why it cannot take the shared material.
//
//No isMesh filter, deliberately: scene.overrideMaterial applied to Points and
//Lines too, and this replaces it, so the set of things captured must not move.
ARestlessOcean.Passes.TerrainOrthoPass.prototype._swapMaterials = function(scene){
  const self = this;
  const landRoot = this.oceanGrid._landTerrainRoot;
  const twins = this._geoTwins;
  this._swappedMeshes.length = 0;
  scene.traverse(function(obj){
    if(!obj.visible || !obj.material) return;
    let replacement = self.positionPassMaterial;
    if(twins && ARestlessOcean.Passes.ForeignTerrainTwin.isForeignTerrain(obj, landRoot)){
      replacement = twins.resolve(obj.material);
    }
    self._swappedMeshes.push({ mesh: obj, original: obj.material });
    obj.material = replacement;
  });
};

ARestlessOcean.Passes.TerrainOrthoPass.prototype._restoreMaterials = function(){
  for(let i = 0, n = this._swappedMeshes.length; i < n; ++i){
    this._swappedMeshes[i].mesh.material = this._swappedMeshes[i].original;
  }
  this._swappedMeshes.length = 0;
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
  const foamHalf = ARestlessOcean.Passes.TerrainOrthoPass.FOAM_ORTHO_HALF_WIDTH;
  const exclHalf = ARestlessOcean.Passes.TerrainOrthoPass.EXCLUSION_ORTHO_HALF_WIDTH;
  const foamTexel = (2.0 * foamHalf) / this.foamRenderTarget.width; // 4096m / 1024px = 4m
  const exclTexel = (2.0 * exclHalf) / this.exclusionRenderTarget.width; // 500m / 1024px ~ 0.488m
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
    this._swapMaterials(scene);
    renderer.setClearAlpha(0.0);
    //Null the backdrop for these top-down position passes too. With a
    //scene.background set, THREE's background quad stamps alpha 1 into the
    //foam/exclusion atlases over open water — and the exclusion .a channel is
    //the water shader's discard gate (worldPosition.y > discardHeight). That
    //made every open-water fragment within exclusion range discard (near water
    //gone, horizon — outside range — survived). Restored at the block's end.
    const _foamSavedBackground = scene.background;
    scene.background = null;
    //⚠ try/finally, because this pass leaves the SCENE mutated while it renders:
    //every object's material is swapped out. A throw between here and the
    //restore (a shader that fails to compile, a bad uniform) would strand the
    //whole scene painted with the position-pass material, permanently, and the
    //symptom would look nothing like its cause. Same guard, same reason, as
    //RefractionGBufferPass.tick.
    try {
    if(renderFoam){
      this.foamCamera.position.set(foamSnapX, ctx.heightOffset + grid.foamCameraHeight, foamSnapZ);
      this.foamCamera.lookAt(foamSnapX, ctx.heightOffset - 1.0, foamSnapZ);
      this.foamCamera.updateProjectionMatrix();
      //⚠ BEFORE the twins are fed, not after: they reconstruct world position by
      //unprojecting through this camera, and matrixWorld is otherwise only
      //refreshed inside renderer.render() — one frame too late, which would
      //smear the whole capture by the camera's own snap delta.
      this.foamCamera.updateMatrixWorld(true);
      if(this._geoTwins){
        this._geoTwins.updateCamera(this.foamCamera,
                                    this.foamRenderTarget.width,
                                    this.foamRenderTarget.height);
      }
      renderer.setRenderTarget(this.foamRenderTarget);
      renderer.clear();
      renderer.render(scene, this.foamCamera);
      renderer.setRenderTarget(null);
      this._lastFoamSnapX = foamSnapX;
      this._lastFoamSnapZ = foamSnapZ;
      //Copy the just-rendered terrain-height ortho to the CPU (async) so the
      //splash system can detect the shoreline. Only fires on snap-change, so
      //the transfer is rare.
      if(ctx.onFoamRendered){
        ctx.onFoamRendered(this.foamRenderTarget, foamSnapX, foamSnapZ, foamHalf);
      }
    }
    if(renderExcl){
      this.exclusionCamera.position.set(exclSnapX, ctx.heightOffset + grid.foamCameraHeight, exclSnapZ);
      this.exclusionCamera.lookAt(exclSnapX, ctx.heightOffset - 1.0, exclSnapZ);
      this.exclusionCamera.updateProjectionMatrix();
      this.exclusionCamera.updateMatrixWorld(true);
      //a-land terrain is not on layer 30, so no twin can be drawn by this
      //camera — but keep them in step anyway rather than leaving them pointed at
      //the foam camera, so a future layer-30 terrain does not silently smear.
      if(this._geoTwins){
        this._geoTwins.updateCamera(this.exclusionCamera,
                                    this.exclusionRenderTarget.width,
                                    this.exclusionRenderTarget.height);
      }
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
    } finally {
      //Restore our original materials + clear state (captured BEFORE zeroing —
      //the old code captured alpha AFTER setClearAlpha(0) and so "restored" 0,
      //leaking a 0 clear alpha into the rest of the frame).
      this._restoreMaterials();
      this.positionPassMaterial.side = THREE.FrontSide;
      renderer.setRenderTarget(currentRenderTarget);
      renderer.setClearAlpha(prevClearAlpha);
      scene.background = _foamSavedBackground;
    }
    this._staleFrames = 0;
    this._everRendered = true;
  }
};

ARestlessOcean.Passes.TerrainOrthoPass.prototype.dispose = function(){
  if(this.foamCamera) this.scene.remove(this.foamCamera);
  if(this.exclusionCamera) this.scene.remove(this.exclusionCamera);
  if(this.positionPassMaterial) this.positionPassMaterial.dispose();
  if(this._geoTwins) this._geoTwins.dispose();
  if(this.foamRenderTarget) this.foamRenderTarget.dispose();
  if(this.exclusionRenderTarget) this.exclusionRenderTarget.dispose();
  this.foamRenderTarget = null;
  this.exclusionRenderTarget = null;
};
