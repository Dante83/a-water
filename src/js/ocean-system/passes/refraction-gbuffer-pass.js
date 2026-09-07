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
  this._swappedMeshes = [];
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

  this._vertexShader = [
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
  const curtainSkip = ctx.skipMesh;
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
    const gBuf = self._resolveMaterial(obj.material);
    self._swappedMeshes.push({ mesh: obj, original: obj.material });
    obj.material = gBuf;
  });

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
  this.renderer.setClearColor(0x000000, 0.0);
  this.renderer.setRenderTarget(this.target);
  this.renderer.clear();
  this.renderer.render(scene, ctx.camera);
  this.renderer.setRenderTarget(currentRefractionRT);
  this.renderer.setClearColor(this._clearColor, _savedClearAlpha);
  scene.background = _savedBackground;

  for(let i = 0, n = this._swappedMeshes.length; i < n; ++i){
    const entry = this._swappedMeshes[i];
    entry.mesh.material = entry.original;
  }
  this._swappedMeshes.length = 0;
};

ARestlessOcean.Passes.RefractionGBufferPass.prototype.dispose = function(){
  this._materialCache.forEach(function(mat){
    if(Array.isArray(mat)){ mat.forEach(function(m){ m.dispose(); }); }
    else { mat.dispose(); }
  });
  this._materialCache.clear();
  this._swappedMeshes.length = 0;
  if(this._whitePixel) this._whitePixel.dispose();
  if(this.target){
    if(this.target.depthTexture) this.target.depthTexture.dispose();
    this.target.dispose();
  }
  this.target = null;
};
