//Ocean-only cascaded shadow map.
//
//Motivation: Three.js's main sun shadow map has to cover the entire scene
//(trees, lighthouse, rocks) and therefore its frustum is too large to
//resolve individual wave crests. This component renders a dedicated
//depth-only pass of just the ocean InstancedMeshes into N tight,
//sun-aligned orthographic frusta — giving per-wave self-shadow that a
//scene-wide shadow map could never capture.
//
//Four cascades by default (Plan E):
//  C0   60 m  × 2048² → ~2.9 cm/texel  (sharp wave-on-wave near camera)
//  C1  240 m  × 2048² → ~11.7 cm/texel (mid distance)
//  C2 0.4 × drawDistance × 1024²       (broad chop / mid-far)
//  C3  2  × drawDistance × 1024²       (full draw-distance horizon coverage)
//C0/C1 stay fixed because wave-scale near you is a property of the
//simulation, not the world. C2/C3 scale with drawDistance so a smaller
//world automatically gets tighter horizon shadows. The receiver shader
//walks the cascades fine→coarse and uses the first one that contains
//the fragment.
//
//Caster ring filtering: each cascade has a maxRing index. The mesh's
//ringIndex (the clipmap LOD it was built with) determines which cascades
//it can cast into — close, fine ring 0 belongs to all four cascades but
//ring 2's huge 1km tile only contributes meaningfully to C3. Each cascade
//owns a layer (7..10). At addCaster time we enable the cascade's layer
//on the mesh iff the mesh's ring is small enough to qualify; the light
//camera per-cascade renders only its own layer. This avoids per-frame
//layer toggling and keeps non-qualifying meshes out of small frusta.

AWater.AOcean.OceanShadowCSM = function(oceanGrid, scene, configOverrides){
  this.oceanGrid = oceanGrid;
  this.scene = scene;

  //Cascade parameters. extent sets the ortho frustum's lateral size; mapSize
  //sets depth-texture resolution. layer is the THREE.Layers bit used to gate
  //which meshes render into this cascade. maxRing is the highest oceanGrid
  //ring index that gets registered as a caster for this cascade; smaller
  //cascades only need fine rings, large ones need the coarse outer rings
  //too so distant waves cast shadows in C3.
  //
  //Note: cascadeDepth (the sun-direction depth slab) and lightDistance are
  //DERIVED from extent in render(), not stored on the config — at low sun
  //elevations a fragment at +halfExtent on the sea plane projects to a
  //view-z offset close to halfExtent itself, so the depth window must scale
  //with extent or large cascades silently fail their z-range check (the
  //bug observed when C3 was tinted yellow only at the horizon and black
  //elsewhere). depth precision at the resulting wide slabs is still well
  //under a millimetre, plenty for wave-shadow resolution.
  const drawDistance = oceanGrid.drawDistance;
  const cfg = configOverrides || {};
  this.cascadeConfigs = cfg.cascades || [
    {extent: 60.0,                 mapSize: 2048, layer: 7,  maxRing: 0},
    {extent: 240.0,                mapSize: 2048, layer: 8,  maxRing: 1},
    //C2/C3 bumped from 1024² → 4096² to bring their world-space texel size
    //(extent/mapSize) down by 4× — the bias formula scales required peter-pan
    //with texel size, so smaller texels let coarse cascades self-shadow much
    //smaller waves before the bias overwhelms wave amplitude. Memory cost
    //~64 MB depth texture per cascade. Mobile is not a target here.
    //
    //maxRing must be high enough that the rings whose tiles physically occupy
    //the cascade extent ALL cast into it; otherwise a ring of texels gets no
    //caster, the depth stays cleared (=1.0), and the receiver reads as fully
    //lit there. Ring K covers world radius patchSize × 2^(K+1). For default
    //patchSize=256 and drawDistance=10km: C2 extent=4km → halfExtent=2km, so
    //must include ring 2 (covers 1024-2048m); without it, a 1-2km world band
    //in C2 stayed cleared (visible as mode 4 white strip).
    {extent: 0.4 * drawDistance,   mapSize: 4096, layer: 9,  maxRing: 99},
    //C3 is the horizon-coverage cascade — every existing ring should cast into
    //it, otherwise the outermost rings (whose tiles physically occupy the world
    //out to drawDistance) leave large swaths of C3 depth texture at cleared
    //depth = 1.0, and any fragment lookup there reads as no occluder → false
    //fully-lit white band along the horizon. ringCount is data-dependent
    //(ceil(log2(drawDistance/patchSize))), so use a value larger than any
    //plausible ring index rather than tracking it.
    {extent: 2.0 * drawDistance,   mapSize: 4096, layer: 10, maxRing: 99}
  ];
  this.numCascades = this.cascadeConfigs.length;
  //Wave-amplitude headroom added on top of the extent-derived depth slab.
  //Any wave displacement larger than this would project outside the slab
  //and get silently clipped to "no caster" in the depth texture.
  this._waveMargin = 50.0;

  //Cache the shared shadow-material definition. We don't build a single
  //material here — the caster vertex shader needs ringIndex, which differs
  //per-mesh (ring 0 sums all 6 cascades, ring 1 skips cascade 5, etc.) to
  //match water-vertex.glsl's ring-gated displacement. addCaster() builds a
  //per-mesh clone with ringIndex baked in. Uniform values otherwise get
  //synced each frame in render() so cascade textures track the FFT tick.
  this._shadowMatDef = AWater.AOcean.Materials.Ocean.oceanShadowMaterial;

  //Build per-cascade resources: render target + depth texture, ortho
  //camera, shadow matrix.
  this.cascades = [];
  for(let i = 0; i < this.numCascades; i++){
    const c = this.cascadeConfigs[i];
    //Render target with depth texture attached — sampled directly as a
    //depth value in the water fragment shader (WebGL2 / Three.js pattern).
    const depthTex = new THREE.DepthTexture(c.mapSize, c.mapSize);
    depthTex.type = THREE.UnsignedIntType;
    depthTex.format = THREE.DepthFormat;
    //NearestFilter is REQUIRED here. Tried LinearFilter to smooth per-triangle
    //depth discontinuities but it broke shadow comparison on this GPU/driver
    //combo (the entire ocean read as fully shadowed). Linear filtering on
    //depth textures sampled via sampler2D is GPU-dependent and unreliable —
    //only sampler2DShadow + hardware comparison mode (different shader path,
    //different uniform type) properly supports linear-filtered depth.
    depthTex.minFilter = THREE.NearestFilter;
    depthTex.magFilter = THREE.NearestFilter;
    const renderTarget = new THREE.WebGLRenderTarget(c.mapSize, c.mapSize, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthTexture: depthTex,
      depthBuffer: true
    });
    //Orthographic camera, re-fitted every frame to cover c.extent x
    //c.extent on the sea plane, centered at the main camera's XZ.
    //Near/far are placeholders — render() overrides them every frame to
    //bracket the pivot tightly along the sun direction, so depth precision
    //is spent on the wave-amplitude window rather than empty space.
    const lightCamera = new THREE.OrthographicCamera(
      -c.extent * 0.5, c.extent * 0.5,
       c.extent * 0.5, -c.extent * 0.5,
      1.0, 1000.0
    );
    lightCamera.matrixAutoUpdate = false;

    this.cascades.push({
      cfg: c,
      renderTarget: renderTarget,
      lightCamera: lightCamera,
      shadowMatrix: new THREE.Matrix4(),
      //Total NDC→world depth slab span for this cascade (= 2 × halfDepth,
      //set per frame in render() because halfDepth is derived from extent
      //+ waveMargin). The receiver shader divides oceanShadowBias by this
      //so a single user knob produces a consistent world-space peter-pan
      //across cascades whose slab spans differ by ~60×.
      depthRange: 0.0
    });
  }

  //Static bias/shadow matrix constant — converts light clip space [-1,1]
  //into texture UV space [0,1] + depth [0,1]. Same form as Three.js uses
  //internally for DirectionalLightShadow. Shared across all cascades.
  this._texSpaceMatrix = new THREE.Matrix4().set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  //Scratch vector for reading the main camera's WORLD position each frame.
  //mainCamera.position is a LOCAL offset relative to its parent (e.g., the
  //A-Frame rig that moves with the player); reading it directly anchors the
  //cascade to a fixed world point. getWorldPosition() walks the parent chain.
  this._cameraWorldPos = new THREE.Vector3();

  //Light-view-space basis (forward = sun direction, right perpendicular to
  //world-up and forward, up = forward × right). Rebuilt every frame once,
  //then reused per-cascade for texel-grid snapping. Without snapping the
  //pivot to texel increments along the light's right/up axes, the depth
  //texture samples shift sub-texel each frame as the camera moves and the
  //shadow pattern visibly swims/shimmers along wave edges (classic CSM
  //artifact). World-XZ snapping would only work for an overhead sun;
  //snapping in light view space stays correct at all sun angles.
  this._lightForward = new THREE.Vector3();
  this._lightRight = new THREE.Vector3();
  this._lightUp = new THREE.Vector3();
  this._worldUp = new THREE.Vector3(0.0, 1.0, 0.0);
  this._unsnappedPivot = new THREE.Vector3();
  this._snappedPivot = new THREE.Vector3();

  //Track which meshes we render as casters. ocean-grid adds meshes as they
  //get built; we sweep over the live set every frame. Parallel arrays of
  //per-mesh shadow materials and ring indices.
  this.oceanMeshes = [];
  this.shadowMaterials = [];
  this.casterRingIndices = [];
};

//Register an ocean InstancedMesh as a caster. Called from ocean-grid each
//time a clipmap tile gets instantiated. Builds a per-mesh shadow material
//clone with ringIndex copied from the source water material so the caster's
//displacement matches the receiver's ring-gated cascade selection.
//
//ringIndex determines which cascades the mesh participates in: each cascade
//has a maxRing, and the mesh joins cascade c only if ringIndex <= c.maxRing.
//Layer membership is set ONCE here (permanent), so the per-cascade light
//camera's layers.set() naturally selects the right caster set without any
//per-frame layer toggling.
AWater.AOcean.OceanShadowCSM.prototype.addCaster = function(mesh, ringIndex){
  if(this.oceanMeshes.indexOf(mesh) !== -1) return;
  const shadowMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(this._shadowMatDef.uniforms),
    vertexShader: this._shadowMatDef.vertexShader,
    fragmentShader: this._shadowMatDef.fragmentShader,
    side: THREE.DoubleSide
  });
  //Use the ringIndex parameter directly — at the call site in ocean-grid.js,
  //addCaster() runs BEFORE the per-tile loop assigns ringIndex onto the receiver
  //material, so reading mesh.material.uniforms.ringIndex.value would pick up the
  //template default (0), not the tile's actual ring. With ringIndex=0 every
  //caster sums all 6 cascades while receivers ring-gate correctly, producing a
  //caster-vs-receiver displacement mismatch that grows with wave amplitude and
  //appears as per-cascade false self-shadow (invisible on flat water).
  shadowMat.uniforms.ringIndex.value = ringIndex;
  this.oceanMeshes.push(mesh);
  this.shadowMaterials.push(shadowMat);
  this.casterRingIndices.push(ringIndex);

  //Enable each qualifying cascade's layer on the mesh. The mesh keeps its
  //original layer (typically 0, for main-camera rendering); we add the
  //shadow layers on top. Light cameras render only their own layer, so
  //meshes appear in shadow passes they belong to and nowhere else.
  for(let i = 0; i < this.numCascades; i++){
    if(ringIndex <= this.cascadeConfigs[i].maxRing){
      mesh.layers.enable(this.cascadeConfigs[i].layer);
    }
  }
};

//Per-frame: for each cascade, fit its camera, sync uniforms from the live
//water material, render depth-only into its target. Materials are swapped
//to the shadow ShaderMaterial once at the start and restored once at the
//end — all four cascades render under the same swap so we don't pay 4× the
//swap cost.
AWater.AOcean.OceanShadowCSM.prototype.render = function(renderer, mainCamera, sunDirection, sharedOceanUniforms){
  if(this.oceanMeshes.length === 0) return;
  //Sun below the horizon — skip every cascade pass entirely.
  if(-sunDirection.y <= 0.0) return;

  //Read main camera world position once — used for cascade fits AND pushed
  //onto every per-mesh shadow material so distance-based cascade fade
  //matches water-vertex.glsl. Built-in cameraPosition in the caster vertex
  //shader would refer to whichever LIGHT camera is active (which sits 400m
  //up-sun of the pivot), giving very different fade values.
  mainCamera.getWorldPosition(this._cameraWorldPos);

  //Sync displacement uniforms onto every per-mesh shadow material. We read
  //references directly from the water material's uniforms so wave textures
  //and parameters always track the current FFT state without per-frame
  //copying. ringIndex is baked in at addCaster() time and stays put. This
  //happens once per frame regardless of cascade count — the same caster
  //material is rasterised into each cascade's render target.
  for(let i = 0, L = this.shadowMaterials.length; i < L; i++){
    const u = this.shadowMaterials[i].uniforms;
    u.cascadeDisplacementTextures.value = sharedOceanUniforms.cascadeDisplacementTextures.value;
    u.cascadePatchSizes.value = sharedOceanUniforms.cascadePatchSizes.value;
    u.cascadeSpatialOffsets.value = sharedOceanUniforms.cascadeSpatialOffsets.value;
    u.waveHeightMultiplier.value = sharedOceanUniforms.waveHeightMultiplier.value;
    u.sizeOfOceanPatch.value = sharedOceanUniforms.sizeOfOceanPatch.value;
    u.chop.value = sharedOceanUniforms.chop.value;
    u.mainCameraPosition.value.copy(this._cameraWorldPos);
  }

  //Pivot Y must sit on the water plane, not at world origin. The cascade
  //depth window is centered on the pivot, so a Y=0 pivot in a scene with
  //heightOffset of 70+ pushes the entire water surface outside the near
  //plane at high sun angles → depth texture stays cleared. Reading from
  //oceanGrid keeps this in sync if heightOffset ever changes at runtime.
  const pivotX = this._cameraWorldPos.x;
  const pivotY = this.oceanGrid.heightOffset;
  const pivotZ = this._cameraWorldPos.z;

  //Build the light's view-space basis once per frame. Used per-cascade to
  //snap the pivot onto its texel grid. lightForward = sunDirection (already
  //a unit vector pointing FROM sun TO ground). lightRight is perpendicular
  //to forward in the horizontal plane (worldUp × forward); falls back to
  //world X when the sun is straight up/down (degenerate cross product).
  this._lightForward.copy(sunDirection);
  this._lightRight.crossVectors(this._worldUp, this._lightForward);
  if(this._lightRight.lengthSq() < 1e-6){
    this._lightRight.set(1.0, 0.0, 0.0);
  } else {
    this._lightRight.normalize();
  }
  this._lightUp.crossVectors(this._lightForward, this._lightRight).normalize();
  this._unsnappedPivot.set(pivotX, pivotY, pivotZ);
  const pivotForward = this._unsnappedPivot.dot(this._lightForward);
  const unsnappedRight = this._unsnappedPivot.dot(this._lightRight);
  const unsnappedUp    = this._unsnappedPivot.dot(this._lightUp);

  //Swap materials on every caster once. Three.js has a Scene.overrideMaterial
  //but using it for only the ocean would force single-pass rendering of the
  //whole scene — here we just flip per-mesh.
  const prevMaterials = [];
  for(let i = 0, L = this.oceanMeshes.length; i < L; i++){
    prevMaterials.push(this.oceanMeshes[i].material);
    this.oceanMeshes[i].material = this.shadowMaterials[i];
  }

  //Save renderer state once. We restore at the end after all cascades.
  const prevTarget = renderer.getRenderTarget();
  const prevClearColor = new THREE.Color();
  renderer.getClearColor(prevClearColor);
  const prevClearAlpha = renderer.getClearAlpha();
  //Freeze scene shadow auto-update while we render the CSM. Without this
  //flag, Three.js's render() side-effects a full scene-wide shadow map
  //repass on each call — which is expensive even when ocean castShadow is
  //off (trees, lighthouse, rocks all re-rasterise). 4 cascades × full
  //scene shadow repass would tank framerate.
  const prevShadowAutoUpdate = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;

  //Per-cascade: fit, render, compose shadow matrix.
  for(let i = 0; i < this.numCascades; i++){
    const cascade = this.cascades[i];
    const cfg = cascade.cfg;
    const lightCamera = cascade.lightCamera;

    //Depth slab and light-camera distance must scale with cascade extent.
    //At low sun elevations a fragment at the lateral edge (halfExtent from
    //pivot on the sea plane) projects to a view-z offset approaching
    //halfExtent itself, so a fixed 200m slab silently clipped large
    //cascades to "no caster". halfDepth = halfExtent + waveMargin encloses
    //the entire ortho footprint regardless of sun angle, plus headroom for
    //wave amplitude. lightDistance is then chosen so near = 100m (well
    //clear of zero) and far = lightDistance + halfDepth covers the back of
    //the slab. Per-cascade values: C0 near100/far260, C1 100/440,
    //C2 100/~2200, C3 100/~10200 — depth precision in 24-bit z is still
    //sub-millimetre at the largest slab.
    const halfExtent = cfg.extent * 0.5;
    const halfDepth = halfExtent + this._waveMargin;
    const lightDistance = halfDepth + 100.0;
    cascade.depthRange = halfDepth * 2.0;

    //Snap pivot onto this cascade's texel grid in light-view space. Each
    //cascade has its own texelSize (extent / mapSize), so the snap is
    //per-cascade. We project the unsnapped pivot onto the light's right
    //and up axes, round those projections to texel-size increments, then
    //reconstruct the world-space pivot from the snapped components.
    //Forward component is preserved unchanged — we only need lateral
    //texture-space alignment, not depth-axis snapping.
    const texelSize = cfg.extent / cfg.mapSize;
    const snappedRight = Math.round(unsnappedRight / texelSize) * texelSize;
    const snappedUp    = Math.round(unsnappedUp    / texelSize) * texelSize;
    this._snappedPivot.set(0.0, 0.0, 0.0)
      .addScaledVector(this._lightRight,   snappedRight)
      .addScaledVector(this._lightUp,      snappedUp)
      .addScaledVector(this._lightForward, pivotForward);
    const snappedPivotX = this._snappedPivot.x;
    const snappedPivotY = this._snappedPivot.y;
    const snappedPivotZ = this._snappedPivot.z;

    //Position = pivot - sunDir * lightDistance. sunDir points FROM sun TO
    //surface, so subtracting pushes the camera up-sun of the pivot.
    lightCamera.position.set(
      snappedPivotX - sunDirection.x * lightDistance,
      snappedPivotY - sunDirection.y * lightDistance,
      snappedPivotZ - sunDirection.z * lightDistance
    );
    //Order matters: with matrixAutoUpdate=false, Three.js's lookAt() reads
    //the camera's world position from matrixWorld, but matrixWorld only
    //refreshes from the LOCAL matrix — and the local matrix doesn't auto-
    //track position.set() in this mode. Without an explicit updateMatrix() +
    //updateMatrixWorld() BEFORE lookAt(), it computes orientation from last
    //frame's stale position and the cascade frustum lags one frame behind.
    lightCamera.updateMatrix();
    lightCamera.updateMatrixWorld(true);
    lightCamera.lookAt(snappedPivotX, snappedPivotY, snappedPivotZ);
    lightCamera.updateMatrix();
    lightCamera.updateMatrixWorld(true);
    //Tighten near/far around the pivot. With light at lightDistance from
    //the pivot, the pivot's view-z is -lightDistance, so brackets ±halfDepth
    //center the depth window on it. Massive precision win vs a generic
    //wide range.
    lightCamera.near = lightDistance - halfDepth;
    lightCamera.far  = lightDistance + halfDepth;
    lightCamera.updateProjectionMatrix();
    //Three.js only refreshes matrixWorldInverse inside renderer.render(),
    //but we consume it to compose shadowMatrix BEFORE that render — without
    //this explicit invert the shadow UVs are one-frame-stale (or
    //uninitialised on the first tick), which makes every fragment fall
    //outside the cascade and the whole feature silently no-ops.
    lightCamera.matrixWorldInverse.copy(lightCamera.matrixWorld).invert();

    //Compose the shadow matrix: world -> light view -> light projection ->
    //[0,1] texture-space. Water fragment shader multiplies worldPosition by
    //this and samples the depth texture at the resulting UV.
    cascade.shadowMatrix.identity();
    cascade.shadowMatrix.multiply(this._texSpaceMatrix);
    cascade.shadowMatrix.multiply(lightCamera.projectionMatrix);
    cascade.shadowMatrix.multiply(lightCamera.matrixWorldInverse);

    //Restrict this pass to this cascade's layer only. addCaster() enabled
    //the layer on every mesh whose ringIndex qualifies, so this mask
    //naturally selects the right subset without per-frame mesh toggling.
    lightCamera.layers.set(cfg.layer);

    renderer.setRenderTarget(cascade.renderTarget);
    renderer.setClearColor(0x000000, 1.0);
    renderer.clear(true, true, false);
    renderer.render(this.scene, lightCamera);
  }

  //Restore renderer state.
  renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClearColor, prevClearAlpha);

  //Restore materials.
  for(let i = 0, L = this.oceanMeshes.length; i < L; i++){
    this.oceanMeshes[i].material = prevMaterials[i];
  }
};

if(typeof exports !== 'undefined'){
  module.exports = AWater.AOcean.OceanShadowCSM;
}
