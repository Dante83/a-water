//── Refraction G-buffer pass ────────────────────────────────────────────────
//
//Extracted verbatim from ocean-grid.js (0.2.0 lines 231-252, 698-785 and the
//tick block at 2623-2671) as part of the Phase 0 decomposition. Behaviour is
//unchanged; see WATER-TYPES-PROGRESS.md for the full old-line -> new-file map.
//
//WHAT IT PRODUCES
//A screen-space WebGL2 multiple-render-target with three attachments, rendered
//once per frame from the main camera while the ocean meshes are hidden:
//  0: albedo + opaque-mask in .a
//  1: world-space normal in .rgb
//  2: linear view-space depth in .r   (replaces an older separate linearize pass)
//plus a depth texture. The water shader samples albedo + normal to relight the
//seabed inside the body-colour path, and the splash system reads the linear
//depth for soft-particle fade.
//
//WHY A PER-MESH MATERIAL SWAP RATHER THAN scene.overrideMaterial
//overrideMaterial cannot carry per-mesh albedo — every mesh would render with
//one colour and one map. So each visible non-ocean mesh has its material
//swapped to a cached G-buffer variant that reads THAT source material's own
//.color / .map, and every material is restored immediately after the render.
//The cache is keyed by source-material UUID and built lazily on first sight.
//
//Two meshes are deliberately skipped:
//  - anything whose material is a ShaderMaterial (the ocean itself, and any
//    other custom shader whose attribute usage we cannot safely replace)
//  - the underwater curtain, a 300 m BackSide sphere that would otherwise write
//    a spherical shell into refraction depth, so the water shader's Snell-window
//    seabed lookup would sample curtain colour instead of seabed
//
//THE GEOMETRY-ONLY TWIN (external ShaderMaterial terrain, e.g. a-faraway-land)
//Skipping a ShaderMaterial outright is right for OUR shaders, but wrong for a
//sibling system's terrain: a-land's ground is a GLSL3 ShaderMaterial, so it was
//rendering into this MRT with its OWN program, which declares one output. The
//normal and linear-depth attachments were then left undefined for every terrain
//fragment — "Program has no frag output at location 1" — and the water shader
//read that garbage as a seabed sitting at the camera. Result: terrain neither
//refracted through nor reflected on the water.
//
//We cannot swap in the albedo shader above, because the geometry only EXISTS in
//their vertex stage. The machinery that keeps their vertex stage and replaces
//only the fragment stage now lives in ARestlessOcean.Passes.ForeignTerrainTwin
//(this pass invented it; TerrainOrthoPass needed it too). Read that module's
//header for the no-varyings rule and the reconstruction prologue.
//
//The twin reconstructs both geometry channels from gl_FragCoord alone. Albedo
//is the one thing it cannot recover — their colour comes from splat
//sampler2DArray blending inside the fragment stage we are replacing — so it
//writes a neutral tone. Geometry is right, which is what refraction needs; true
//terrain albedo needs a companion capture material on a-land's side, and this
//pass prefers `userData.alandSurfaceCaptureMaterial` over its own twin whenever
//a-land offers one.
//
//OceanGrid keeps `refractionGBufferTarget` as an alias onto this pass's
//`.target`, so the per-instance uniform upload loop and ocean-splash.js need no
//changes.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.RefractionGBufferPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;

  this.target = null;
  //Cache keyed by source-material UUID; built lazily on first sight.
  this._materialCache = new Map();
  //Geometry-only twins for external ShaderMaterial terrain — see the header.
  //Built in init(), once the fragment stage exists.
  this._geoTwins = null;
  this._swappedMeshes = [];
  //Meshes hidden for the duration of this pass because we cannot capture them
  //into the G-buffer correctly; restored immediately after the render.
  this._hiddenMeshes = [];
  this._whitePixel = null;
  this._vertexShader = null;
  this._fragmentShader = null;
  this._clearColor = new THREE.Color();
};

ARestlessOcean.Passes.RefractionGBufferPass.prototype.init = function(width, height){
  this.target = new THREE.WebGLRenderTarget(
    width, height,
    {
      count: 3,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(
        width, height,
        THREE.UnsignedIntType
      )
    }
  );
  this.target.depthTexture.format = THREE.DepthFormat;

  //Fallback texture for materials without a .map — sampling a null sampler
  //is undefined; bind a 1x1 white pixel and gate via hasAlbedoMap uniform.
  const whiteData = new Uint8Array([255, 255, 255, 255]);
  this._whitePixel = new THREE.DataTexture(whiteData, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  this._whitePixel.needsUpdate = true;

  //⚠ instanceMatrix is load-bearing for any InstancedMesh in the scene (a-land
  //instances its vegetation and props). Without it every instance collapses
  //onto the base transform, so the G-buffer shows one clump of geometry where
  //a field of it should be. three.js declares the attribute and USE_INSTANCING
  //for ShaderMaterial too, so this costs nothing when there is no instancing.
  this._vertexShader = [
    'out vec3 vWorldNormal;',
    'out float vViewZ;',
    'out vec2 vUv;',
    'void main(){',
    '  #ifdef USE_INSTANCING',
    '    mat4 instModel = modelMatrix * instanceMatrix;',
    '    vec4 mvPosition = viewMatrix * instModel * vec4(position, 1.0);',
    '    vWorldNormal = normalize(mat3(instModel) * normal);',
    '  #else',
    '    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '    vWorldNormal = normalize(mat3(modelMatrix) * normal);',
    '  #endif',
    '  vViewZ = -mvPosition.z;',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '}'
  ].join('\n');

  //Fragment stage for the geometry-only twin. Declares NO varyings on purpose
  //(see ForeignTerrainTwin's header): it is paired with a foreign vertex shader
  //whose varying names we do not know, and a fragment `in` with no matching
  //vertex `out` is a link error, while the reverse is legal. Everything it needs
  //comes from the reconstruction prologue the twin module splices in front.
  if(ARestlessOcean.Passes.ForeignTerrainTwin){
    this._geoTwins = new ARestlessOcean.Passes.ForeignTerrainTwin([
      'layout(location = 0) out vec4 gAlbedo;',
      'layout(location = 1) out vec4 gNormal;',
      'layout(location = 2) out vec4 gLinearDepth;',
      'void main(){',
      '  vec3 viewPos = aroTwinViewPos();',
      '  gAlbedo = vec4(gbAlbedo, 1.0);',
      '  gNormal = vec4(aroTwinWorldNormal(viewPos), 1.0);',
      '  gLinearDepth = vec4(-viewPos.z, 0.0, 0.0, 1.0);',
      '}'
    ].join('\n'));
  }

  //Albedo path stores LINEAR values into the HalfFloat target. Source albedo
  //maps from GLTF (the island model) are sRGB-encoded, so decode here once.
  //Material.color values are already linear (THREE.Color stores linear).
  this._fragmentShader = [
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
};

ARestlessOcean.Passes.RefractionGBufferPass.prototype.resize = function(width, height){
  this.target.setSize(width, height);
  //The old attachment's GPU texture is freed, not orphaned on every resize.
  if(this.target.depthTexture) this.target.depthTexture.dispose();
  this.target.depthTexture = new THREE.DepthTexture(
    width, height, THREE.UnsignedIntType
  );
  this.target.depthTexture.format = THREE.DepthFormat;
};

ARestlessOcean.Passes.RefractionGBufferPass.prototype._buildMaterialFor = function(srcMat){
  const hasMap = !!(srcMat.map && srcMat.map.isTexture);
  const fallbackColor = new THREE.Color(0.5, 0.42, 0.32);
  const baseColorRef = (srcMat.color && srcMat.color.isColor) ? srcMat.color : fallbackColor;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      baseColor: { value: baseColorRef },
      albedoMap: { value: hasMap ? srcMat.map : this._whitePixel },
      hasAlbedoMap: { value: hasMap ? 1 : 0 }
    },
    vertexShader: this._vertexShader,
    fragmentShader: this._fragmentShader,
    side: srcMat.side !== undefined ? srcMat.side : THREE.FrontSide
  });
};

//Recognition + twin construction + the bounded cache all live in
//ARestlessOcean.Passes.ForeignTerrainTwin now; see its header.
ARestlessOcean.Passes.RefractionGBufferPass.prototype._isExternalTerrain = function(obj){
  if(!this._geoTwins) return false;
  return ARestlessOcean.Passes.ForeignTerrainTwin.isForeignTerrain(
    obj, this.oceanGrid._landTerrainRoot);
};

ARestlessOcean.Passes.RefractionGBufferPass.prototype._resolveMaterial = function(srcMat){
  if(Array.isArray(srcMat)){
    const arr = new Array(srcMat.length);
    for(let i = 0; i < srcMat.length; ++i){
      arr[i] = this._resolveMaterial(srcMat[i]);
    }
    return arr;
  }
  let cached = this._materialCache.get(srcMat.uuid);
  if(!cached){
    cached = this._buildMaterialFor(srcMat);
    this._materialCache.set(srcMat.uuid, cached);
  }
  return cached;
};

//Render the scene into the G-buffer. The caller is responsible for hiding the
//ocean meshes first (they are hidden across this pass AND the ortho passes that
//follow, so the hide/show brackets live in OceanGrid.tick).
//
//ctx: {scene, camera, skipMesh}  — skipMesh is the underwater curtain.
ARestlessOcean.Passes.RefractionGBufferPass.prototype.tick = function(ctx){
  const self = this;
  const scene = ctx.scene;

  //scene.overrideMaterial can't carry per-mesh albedo, so we swap each visible
  //non-ocean mesh's material to a cached G-buffer variant that reads that source
  //material's own .color / .map. Restored immediately after render.
  this._swappedMeshes.length = 0;
  this._hiddenMeshes.length = 0;
  const curtainSkip = ctx.skipMesh;
  scene.traverse(function(obj){
    if(!obj.isMesh || !obj.visible || !obj.material) return;
    //Anything we cannot capture correctly is HIDDEN for this pass, not merely
    //left alone. "Skip the swap" was never the same as "skip the mesh": the
    //mesh still rendered, with a program that writes one output, into a
    //three-attachment target. That is the "Program has no frag output at
    //location 1" warning, and it left the normal and linear-depth attachments
    //undefined while albedo's alpha still claimed "geometry here" — so the
    //water shader confidently relit a seabed from garbage. Hiding makes the
    //miss well-defined instead: alpha stays 0 and the water falls back to
    //body colour, which is exactly what "we don't know what's back there"
    //should look like.
    if(obj.material.isShaderMaterial){
      //A sibling system's terrain (a-land) can still be captured properly, via
      //the geometry-only twin — see the header.
      if(self._isExternalTerrain(obj)){
        //PREFER THE SIBLING'S OWN CAPTURE MATERIAL when it offers one. a-land
        //exposes `userData.alandSurfaceCaptureMaterial` beside its shadow-caster
        //marker: same vertex stage, same uniforms, but a fragment stage that
        //writes ITS resolved splat albedo and ITS shading normal into our three
        //attachments. Our twin can only reconstruct geometry and has to invent a
        //flat tone for albedo, which is why reflections of a-land used to have
        //no grass or rock in them. Fall back to the twin when the sibling
        //predates the hook.
        const capture = obj.material.userData && obj.material.userData.alandSurfaceCaptureMaterial;
        const geoMat = capture || self._geoTwins.resolve(obj.material);
        self._swappedMeshes.push({ mesh: obj, original: obj.material });
        obj.material = geoMat;
        return;
      }
      obj.visible = false;
      self._hiddenMeshes.push(obj);
      return;
    }
    if(Array.isArray(obj.material) && obj.material.some(function(m){ return m.isShaderMaterial; })){
      obj.visible = false;
      self._hiddenMeshes.push(obj);
      return;
    }
    //The underwater curtain: a 300 m BackSide sphere that must not write a
    //spherical shell into refraction depth, or the water shader's Snell-window
    //seabed lookup samples curtain colour instead of seabed. It has to be
    //HIDDEN to achieve that — it is a MeshBasicMaterial, so merely leaving it
    //unswapped still drew it (and still wrote its depth), which is the very
    //thing this exclusion exists to prevent.
    if(obj === curtainSkip){
      obj.visible = false;
      self._hiddenMeshes.push(obj);
      return;
    }
    const gBuf = self._resolveMaterial(obj.material);
    self._swappedMeshes.push({ mesh: obj, original: obj.material });
    obj.material = gBuf;
  });

  //Feed the geometry-only twins this frame's camera. They reconstruct view
  //position by unprojecting gl_FragCoord, so they need the inverse projection,
  //the inverse view (to take the normal back to world space) and the target's
  //pixel size. Cheap — there are only a handful of distinct twins.
  if(this._geoTwins){
    this._geoTwins.updateCamera(ctx.camera, this.target.width, this.target.height);
  }

  const currentRefractionRT = this.renderer.getRenderTarget();
  //Suppress the scene backdrop for this pass. A-Frame's `background` component
  //drives BOTH scene.background AND the renderer clear color/alpha, and THREE
  //clears a render target to those — filling the G-buffer's open-water texels
  //with the sky colour at alpha 1 ("geometry present"), so the water samples
  //the backdrop as its refraction and blends invisibly into it. We force the
  //clear to alpha 0 ("no seabed -> fall back to body colour") AND null the
  //background so no background quad re-opaques it. Both restored right after,
  //so the MAIN render still shows the sky. (Mirrors the transmission pass.)
  const _savedBackground = scene.background;
  scene.background = null;
  this.renderer.getClearColor(this._clearColor);
  const _savedClearAlpha = this.renderer.getClearAlpha();
  //⚠ try/finally, because this pass leaves the SCENE mutated while it renders:
  //materials swapped out and meshes hidden. A throw between here and the
  //restore (a shader that fails to compile, a bad uniform) would strand the
  //scene in that state permanently — terrain invisible, materials replaced —
  //and the symptom would look nothing like its cause. The restore must be
  //unconditional.
  try {
    this.renderer.setClearColor(0x000000, 0.0);
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, ctx.camera);
  } finally {
    this.renderer.setRenderTarget(currentRefractionRT);
    this.renderer.setClearColor(this._clearColor, _savedClearAlpha);
    scene.background = _savedBackground;

    for(let i = 0, n = this._swappedMeshes.length; i < n; ++i){
      const entry = this._swappedMeshes[i];
      entry.mesh.material = entry.original;
    }
    this._swappedMeshes.length = 0;

    for(let i = 0, n = this._hiddenMeshes.length; i < n; ++i){
      this._hiddenMeshes[i].visible = true;
    }
    this._hiddenMeshes.length = 0;
  }
};

ARestlessOcean.Passes.RefractionGBufferPass.prototype.dispose = function(){
  this._materialCache.forEach(function(mat){
    if(Array.isArray(mat)){ mat.forEach(function(m){ m.dispose(); }); }
    else { mat.dispose(); }
  });
  this._materialCache.clear();
  if(this._geoTwins) this._geoTwins.dispose();
  this._swappedMeshes.length = 0;
  if(this._whitePixel) this._whitePixel.dispose();
  if(this.target){
    if(this.target.depthTexture) this.target.depthTexture.dispose();
    this.target.dispose();
  }
  this.target = null;
};
