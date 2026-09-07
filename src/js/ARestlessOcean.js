//Root namespace for a-restless-ocean. Everything the library exposes — the
//OceanGrid renderer, the wave/LUT libraries, the materials, the config helpers —
//hangs off the global ARestlessOcean object.
ARestlessOcean = {
  DefaultData: {},
  Materials: {
    FFTWaves: {},
    Ocean: {}
  },
  Renderers: {},
  LUTlibraries: {},
  //Render passes owned by OceanGrid (ocean-system/passes/*.js). Each pass module
  //also self-creates this object defensively, so load order cannot bite.
  Passes: {}
};

//── Uniform cloning ───────────────────────────────────────────────────────────
//THREE.UniformsUtils.clone() deep-clones the value types it knows about —
//Vector2/3/4, Color, Matrix3/4, Quaternion, Texture — but a value that is a
//plain ARRAY is only `.slice()`d. The water shader's uniforms are full of
//arrays of objects:
//
//    cascadeSpatialOffsets : [ 6 x THREE.Vector2 ]
//    oceanShadowMapSize    : [ 4 x THREE.Vector2 ]
//
//so a plain UniformsUtils.clone leaves every clone sharing ONE set of Vector2
//instances with the module-global template — and with each other. With a single
//ocean that is invisible (nothing mutates those vectors in place; the per-frame
//loop reassigns whole arrays). With a second water body it is a silent
//cross-body write: WATER-TYPES.md Phase 1 onward.
//
//cloneUniforms() is UniformsUtils.clone plus a deep pass over array values whose
//elements are clonable objects. Arrays of primitives (cascadePatchSizes) and of
//textures-or-null (cascadeDisplacementTextures) are left as the plain slice —
//those are wholesale-reassigned each frame and must stay shared by reference
//where ocean-shadow-csm.js deliberately aliases them.
ARestlessOcean.cloneUniforms = function(src){
  const dst = THREE.UniformsUtils.clone(src);
  for(const name in dst){
    const value = dst[name] && dst[name].value;
    if(!Array.isArray(value)) continue;
    for(let i = 0; i < value.length; ++i){
      const el = value[i];
      //Only element types with a real clone() and no GPU resource attached.
      //Textures are skipped on purpose: cloning one would orphan the upload.
      if(el && !el.isTexture && typeof el.clone === 'function' &&
         (el.isVector2 || el.isVector3 || el.isVector4 || el.isColor ||
          el.isMatrix3 || el.isMatrix4 || el.isQuaternion)){
        value[i] = el.clone();
      }
    }
  }
  return dst;
};

//── Backwards compatibility ────────────────────────────────────────────────────
//The library was previously published as `a-water`, with its namespace under
//`AWater.AOcean`. Code written against the old name keeps working: reading
//`AWater.AOcean` returns (via the getter below) the same live ARestlessOcean
//object, so `AWater.AOcean.OceanGrid`, `AWater.AOcean.sampleWaterHeight`, etc. all
//still resolve. The first access logs a one-time deprecation notice. This alias is
//slated for removal — migrate `AWater.AOcean.X` references to `ARestlessOcean.X`.
(function(){
  let warned = false;
  AWater = {
    get AOcean(){
      if(!warned){
        warned = true;
        console.warn('[a-restless-ocean] `AWater.AOcean` is deprecated — use the ' +
                     '`ARestlessOcean` namespace instead. This compatibility alias ' +
                     'will be removed in a future release.');
      }
      return ARestlessOcean;
    }
  };
})();
