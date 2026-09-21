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
//elements are clonable objects. Arrays of primitives (cascadePatchSizes) are left
//as the plain slice — those are wholesale-reassigned each frame and must stay
//shared by reference where ocean-shadow-csm.js deliberately aliases them.
//
//Phase 10 note: the cascade displacement maps and the ocean CSM moments used to be
//arrays of textures here (six and four). They are single sampler2DArray textures
//now, so they are no longer Array values at all and take UniformsUtils.clone's
//ordinary reference-share path, which is the correct handling for a texture.
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

//── Array render targets ──────────────────────────────────────────────────────
//Collapses a family of same-shape render targets into one WebGLArrayRenderTarget,
//so that N texture units in the consuming shader become 1. WebGL2 only guarantees
//MAX_TEXTURE_IMAGE_UNITS >= 16 and the water program was asking for 33; a program
//over the device limit does not LINK, and there is no degraded path. See
//WATER-TYPES.md Phase 10, and A-Starry-Sky's TEXTURE-ARRAYS.md for the pattern.
//
//WHY THIS WRAPPER EXISTS, AND IT IS NOT STYLE. In three r173
//(A-Frame 1.7 ships super-three 0.173) WebGLArrayRenderTarget's constructor calls
//super(width, height, options) -- which builds a correctly configured Texture from
//those options -- and then THROWS IT AWAY:
//
//    this.texture = new DataArrayTexture( null, width, height, depth );
//
//A fresh DataArrayTexture is NearestFilter/NearestFilter, ClampToEdgeWrapping,
//generateMipmaps false, RGBAFormat and UnsignedByteType. So `type: FloatType` in
//the options object does nothing at all, and a displacement cascade would quietly
//come back as 8-bit: the waves would still draw, just stepped. Every property has
//to be re-applied to .texture by hand, which is what this does.
//
//Write to one layer with renderer.setRenderTarget(rt, layerIndex) -- three routes
//that second argument to framebufferTextureLayer for an array target. Mipmaps need
//no help: render() ends in updateRenderTargetMipmap, which resolves the target
//through getTargetType and correctly answers TEXTURE_2D_ARRAY. Do NOT hand-roll
//gl.generateMipmap around three's state cache.
ARestlessOcean.createArrayRenderTarget = function(width, height, depth, options){
  const opts = options || {};
  const renderTarget = new THREE.WebGLArrayRenderTarget(width, height, depth, opts);
  const texture = renderTarget.texture;

  //The re-application. Order does not matter; completeness does.
  if(opts.format !== undefined) texture.format = opts.format;
  if(opts.type !== undefined) texture.type = opts.type;
  if(opts.internalFormat !== undefined) texture.internalFormat = opts.internalFormat;
  if(opts.colorSpace !== undefined) texture.colorSpace = opts.colorSpace;
  texture.minFilter = opts.minFilter === undefined ? THREE.NearestFilter : opts.minFilter;
  texture.magFilter = opts.magFilter === undefined ? THREE.NearestFilter : opts.magFilter;
  texture.wrapS = opts.wrapS === undefined ? THREE.ClampToEdgeWrapping : opts.wrapS;
  texture.wrapT = opts.wrapT === undefined ? THREE.ClampToEdgeWrapping : opts.wrapT;
  texture.anisotropy = opts.anisotropy === undefined ? 1 : opts.anisotropy;
  //Must be true before the FIRST setRenderTarget or the texture is allocated with
  //a single mip level and every later generateMipmap has nothing to fill.
  texture.generateMipmaps = opts.generateMipmaps === true;

  return renderTarget;
};

//Guards the silent half of the trap above: if a driver or a future three ever
//hands back a target that is not what was asked for, say so once, loudly, rather
//than letting quantised data look like a shading bug. Called right after creation.
ARestlessOcean.assertArrayRenderTarget = function(label, renderTarget, expected){
  const texture = renderTarget.texture;
  const problems = [];
  for(const key in expected){
    if(texture[key] !== expected[key]){
      problems.push(key + ' is ' + texture[key] + ', expected ' + expected[key]);
    }
  }
  if(problems.length > 0){
    console.error('[a-restless-ocean] array render target "' + label +
      '" did not take its options: ' + problems.join('; ') +
      '. Float data may have been quantised -- see ARestlessOcean.createArrayRenderTarget.');
  }
  return problems.length === 0;
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
