//── Foreign-terrain material twin ───────────────────────────────────────────
//
//A sibling system's terrain (a-faraway-land today) cannot be captured into any
//of our offscreen passes the way an ordinary mesh can, because ITS GEOMETRY
//DOES NOT EXIST IN ITS GEOMETRY. a-land's CDLOD patches share one module-cached
//BufferGeometry that is a [0,1]x[0,1] grid in XZ at y = 0 (CDLODPatch.js) with
//no normal and no uv attribute; the world placement, the two-stage CDLOD morph,
//the heightmap decode and the per-material displacement are ALL in their vertex
//shader, driven by per-patch uniforms. Swap in any material with a vertex stage
//of our own — including via scene.overrideMaterial — and every patch in the
//world collapses onto one 1 m quad at the origin.
//
//So the only way to capture them is a TWIN: their vertex shader and their
//uniforms verbatim, our fragment stage. a-land proves the pairing links by
//doing exactly this for its own shadow caster (TerrainMaterial.js's
//casterMaterial pairs the same vertexSrc with a companion fragment stage that
//declares no varyings at all).
//
//THE NO-VARYINGS RULE
//The fragment stage handed in here must declare NO `in` varyings. It is paired
//with a foreign vertex shader whose varying names we do not know, and a
//fragment `in` with no matching vertex `out` is a link error (the reverse is
//legal). Everything a twin needs is therefore reconstructed from gl_FragCoord
//by the prologue below, which is spliced in front of every fragment stage.
//
//This module was extracted from ARestlessOcean.Passes.RefractionGBufferPass,
//which invented the technique, so that TerrainOrthoPass could stop flattening
//a-land with scene.overrideMaterial. The two passes now share one cache policy
//and one reconstruction prologue.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

//GLSL3. Spliced ahead of every twin fragment stage. Declares the three uniforms
//updateCamera() feeds and the three reconstructions built on them.
//
//`gbInverseView` is the camera's matrixWorld (view -> world), NOT its inverse —
//the name is inherited from the G-buffer pass, where it has always meant this.
ARestlessOcean.Passes.ForeignTerrainTwin_PROLOGUE = [
  'precision highp float;',
  'uniform vec3 gbAlbedo;',
  'uniform vec2 gbResolution;',
  'uniform mat4 gbInverseProjection;',
  'uniform mat4 gbInverseView;',
  //Unproject this fragment's own depth back to view space. Works for both
  //perspective and orthographic cameras — the perspective divide is a no-op
  //when the projection is affine.
  'vec3 aroTwinViewPos(){',
  '  vec4 ndc = vec4((gl_FragCoord.xy / gbResolution) * 2.0 - 1.0, gl_FragCoord.z * 2.0 - 1.0, 1.0);',
  '  vec4 viewH = gbInverseProjection * ndc;',
  '  return viewH.xyz / viewH.w;',
  '}',
  'vec3 aroTwinWorldPos(vec3 viewPos){',
  '  return (gbInverseView * vec4(viewPos, 1.0)).xyz;',
  '}',
  //Geometric normal from the screen-space derivatives of the view position.
  //Derivative cross products are sign-ambiguous; a visible surface faces the
  //camera, and in view space the camera looks down -Z, so +Z is outward.
  'vec3 aroTwinWorldNormal(vec3 viewPos){',
  '  vec3 n = normalize(cross(dFdx(viewPos), dFdy(viewPos)));',
  '  if(n.z < 0.0) n = -n;',
  '  return normalize(mat3(gbInverseView) * n);',
  '}'
].join('\n');

//Bounded, unlike an ordinary material cache: a-land's CDLOD patches come from a
//pool and dispose their material when released, so source UUIDs churn as the
//camera moves and an unbounded cache would accumulate twins for dead materials
//forever. Map keeps insertion order, so dropping the first key is FIFO; a twin
//evicted while its source is still alive is simply rebuilt.
ARestlessOcean.Passes.ForeignTerrainTwin_MAX = 128;

//fragmentShader: the body, WITHOUT the prologue and without `precision` (both
//are supplied). Must declare its own `layout(location = N) out` targets.
ARestlessOcean.Passes.ForeignTerrainTwin = function(fragmentShader){
  this.fragmentShader = ARestlessOcean.Passes.ForeignTerrainTwin_PROLOGUE + '\n' + fragmentShader;
  this._cache = new Map();
};

//THEIR vertex stage and uniforms, OUR fragment stage. Uniforms are copied by
//ENTRY reference, not by value — each {value:...} holder stays the same object,
//so every per-frame per-patch write on their side (patch origin, morph band,
//heightmap, camera position) is still seen here. Defines are copied so their
//vertex shader compiles the same way, and fog/lights are kept because their
//vertex stage #includes chunks that need USE_FOG and the light counts declared.
ARestlessOcean.Passes.ForeignTerrainTwin.prototype._build = function(srcMat){
  const uniforms = {};
  for(const k in srcMat.uniforms){
    if(srcMat.uniforms.hasOwnProperty(k)) uniforms[k] = srcMat.uniforms[k];
  }
  uniforms.gbAlbedo = { value: new THREE.Color(0.5, 0.42, 0.32) };
  uniforms.gbResolution = { value: new THREE.Vector2(1, 1) };
  uniforms.gbInverseProjection = { value: new THREE.Matrix4() };
  uniforms.gbInverseView = { value: new THREE.Matrix4() };

  const defines = {};
  if(srcMat.defines){
    for(const d in srcMat.defines){
      if(srcMat.defines.hasOwnProperty(d)) defines[d] = srcMat.defines[d];
    }
  }

  const mat = new THREE.ShaderMaterial({
    uniforms: uniforms,
    defines: defines,
    vertexShader: srcMat.vertexShader,
    fragmentShader: this.fragmentShader,
    side: srcMat.side !== undefined ? srcMat.side : THREE.FrontSide,
    glslVersion: srcMat.glslVersion || THREE.GLSL3,
    fog: srcMat.fog === undefined ? true : srcMat.fog,
    lights: srcMat.lights === undefined ? true : srcMat.lights
  });
  //Their vertex shader may compile to different variants (a-starry-sky's fog
  //chunk override lands in it); inherit the key so we cache per variant too.
  if(typeof srcMat.customProgramCacheKey === 'function'){
    mat.customProgramCacheKey = srcMat.customProgramCacheKey;
  }
  return mat;
};

ARestlessOcean.Passes.ForeignTerrainTwin.prototype.resolve = function(srcMat){
  let cached = this._cache.get(srcMat.uuid);
  if(!cached){
    cached = this._build(srcMat);
    this._cache.set(srcMat.uuid, cached);
    const cap = ARestlessOcean.Passes.ForeignTerrainTwin_MAX;
    while(this._cache.size > cap){
      const oldest = this._cache.keys().next().value;
      const dead = this._cache.get(oldest);
      this._cache['delete'](oldest);
      if(dead) dead.dispose();
    }
  }
  return cached;
};

ARestlessOcean.Passes.ForeignTerrainTwin.prototype.size = function(){
  return this._cache.size;
};

//Feed every live twin the camera it is about to be rendered from. Cheap — there
//are only a handful of distinct twins.
//
//⚠ The caller must have brought the camera's matrices up to date first. The
//ortho pass moves its cameras with position.set()/lookAt() immediately before
//rendering, and matrixWorld is only refreshed inside renderer.render() — one
//frame too late to read here.
ARestlessOcean.Passes.ForeignTerrainTwin.prototype.updateCamera = function(camera, width, height){
  if(this._cache.size === 0) return;
  this._cache.forEach(function(mat){
    mat.uniforms.gbInverseProjection.value.copy(camera.projectionMatrixInverse);
    mat.uniforms.gbInverseView.value.copy(camera.matrixWorld);
    mat.uniforms.gbResolution.value.set(width, height);
  });
};

ARestlessOcean.Passes.ForeignTerrainTwin.prototype.dispose = function(){
  this._cache.forEach(function(mat){ mat.dispose(); });
  this._cache.clear();
};

//Can this mesh be captured with a twin? Only geometry OUTSIDE the ocean system:
//our own ShaderMaterials stay skipped exactly as they were.
//
//The marker test is the reliable one — a-land stamps
//`userData.alandCasterMaterial` on every patch material it builds. The ancestry
//test is the fallback for a build that predates the marker; it is deliberately
//second because it is BROADER than "terrain": ObjectInstancer adds the prop /
//vegetation group under the same <a-land-terrain> object3D, and a prop with a
//ShaderMaterial would otherwise be captured as though it were ground.
ARestlessOcean.Passes.ForeignTerrainTwin.isForeignTerrain = function(obj, landTerrainRoot){
  const mat = obj.material;
  if(!mat || !mat.isShaderMaterial || !mat.vertexShader) return false;
  if(mat.userData && (mat.userData.alandCasterMaterial ||
                      mat.userData.alandSurfaceCaptureMaterial)) return true;
  if(!landTerrainRoot) return false;
  let p = obj;
  while(p){
    if(p === landTerrainRoot) return true;
    p = p.parent;
  }
  return false;
};
