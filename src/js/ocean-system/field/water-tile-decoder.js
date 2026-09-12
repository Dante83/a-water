//── WaterTileDecoder ───────────────────────────────────────────────────────
//
//WATER-TYPES.md Phase 1b: fetches and decodes a-land's exported water tile
//stack (waterLevel/waterFlow/waterClass, a-land-water-contract §2) at LOD 0
//and uploads them as raw GPU textures for WaterTileDecodePass to sample.
//
//THIS FILE NEVER DECODES THE WET-CORNER-AVERAGED SCALARS ITSELF. That
//decode (bilinear depth/vx/vz/energy over all 4 corners, level renormalised
//over WET corners only) happens once, in GLSL, at fill time — see
//water-tile-decode-pass.js. This file's only job is: raw bytes in, raw
//NEAREST-filtered textures out. Mirrors the split in a-land itself, where
//WaterReader.sampleTile (the CPU decode) and PngDecode.decodePngRGBA (the
//byte fetch) are separate concerns.
//
//DECODING NEVER TOUCHES CANVAS — same reason as a-land's own WaterReader:
//water tiles carry data in the alpha channel (level.A = depth mask) and a
//drawImage/getImageData round-trip premultiplies (RGB×A/255 and back),
//destroying RGB wherever A < 255. We depend on a-land's own hand-rolled
//decoder (ALand.runtime.streaming.decodePngRGBA) rather than vendoring a
//second copy — this code only ever runs when a-land is already loaded (the
//terrain-provider auto-detection in ocean-grid.js requires it), so the
//global is a safe dependency, same trust boundary as depending on
//StarrySky's globals for atmospheric perspective.
//
//URL COMPOSITION: tile URLs are fetched via `director._urlForTile(source,
//lod, x, y)` — an underscore-prefixed method, but one a-land's OWN
//WaterReader (a sibling module inside a-land) calls the exact same way
//(WaterReader.js:127). That makes it an internal-but-shared convention
//within a-land's runtime, not a private implementation detail we'd be
//reaching across a boundary to use — see WaterReader.js and
//TerrainDirector.js:370 for the counterpart.
//
//PER-CASCADE LOD. a-land's own getWaterAt only ever reads LOD 0, and the CPU
//seam still goes through it, so near-field parity is unaffected. But a cascade
//is 512/2048/8192 m across, and at LOD 0 (256 m tiles) the coarsest would want
//256 tiles — more than the cache can hold, so it would thrash forever and never
//converge. The pyramid lines up exactly with the cascades instead:
//
//    cascade 0   512 m across, 1 m/texel   <- LOD 0   256 m tiles,  1 m/texel
//    cascade 1  2048 m across, 4 m/texel   <- LOD 2  1024 m tiles,  4 m/texel
//    cascade 2  8192 m across, 16 m/texel  <- LOD 4  4096 m tiles, 16 m/texel
//
//so every cascade reads tiles at its OWN texel density and never needs more
//than a handful of them. lodForWidth() derives this from the tile count rather
//than from assumed texel sizes, so it stays right for other worlds.

ARestlessOcean.WaterTileDecoder = function(landDirector, onTileLoaded){
  this.director = landDirector;
  //Fired when a tile finishes decoding. The cascades are texel-snap gated, so
  //without this they would never re-fill to pick up tiles that arrived after
  //their last fill — and since the FIRST fill always runs with an empty cache,
  //that meant the tile data never landed at all unless the camera happened to
  //move afterwards.
  this.onTileLoaded = onTileLoaded || null;
  this._cache = new Map();   //key "lod_x_y" -> 'loading' | 'dry' | {w, levelTex, flowTex, clsTex}
  //Comfortably above the ~27 tiles the three cascades hold live at once, so
  //eviction never fights the working set.
  this._max = 64;

  const mj = landDirector && landDirector.mapJson;
  const src = mj && mj.sources && mj.sources.waterLevel;
  this.sim = (mj && mj.simulation) || null;
  this.available = !!(src && this.sim && typeof fetch !== 'undefined');
  this.tileSize = src ? src.tileSize : 0;     //LOD-0 tile span in metres
  this.maxLod = src ? (src.maxLod || 0) : 0;

  //wetTiles index (lod -> [[x,y],...]) marks dry tiles without a 404 round
  //trip — same shortcut WaterReader takes, but kept per-LOD since we read
  //more than one. A LOD with no index just falls through to the 404 path.
  this._wet = {};
  if(this.sim && this.sim.wetTiles){
    for(const lod in this.sim.wetTiles){
      const list = this.sim.wetTiles[lod];
      if(!list) continue;
      const set = {};
      for(let i = 0; i < list.length; ++i) set[list[i][0] + '_' + list[i][1]] = true;
      this._wet[lod] = set;
    }
  }
};

//Tile world span in metres at a given LOD: each step up doubles the footprint.
ARestlessOcean.WaterTileDecoder.prototype.spanForLod = function(lod){
  return this.tileSize * Math.pow(2, lod);
};

//Coarsest-to-finest: the smallest LOD that covers `worldWidth` in no more than
//MAX_TILES_ACROSS tiles per axis. Derived from tile COUNT rather than assumed
//texel density, so it holds for worlds whose tiles aren't 1 m/texel at LOD 0.
ARestlessOcean.WaterTileDecoder.MAX_TILES_ACROSS = 3;
ARestlessOcean.WaterTileDecoder.prototype.lodForWidth = function(worldWidth){
  const maxAcross = ARestlessOcean.WaterTileDecoder.MAX_TILES_ACROSS;
  let lod = 0;
  while(lod < this.maxLod && (worldWidth / this.spanForLod(lod)) > maxAcross) ++lod;
  return lod;
};

ARestlessOcean.WaterTileDecoder.prototype.isKnownDry = function(lod, tileX, tileY){
  const set = this._wet[lod];
  if(!set) return false;
  return !set[tileX + '_' + tileY];
};

//Synchronous cache read. Cache hit -> entry; miss -> kicks a background load
//and returns null (mirrors WaterReader.getWaterAt's null-then-warm contract).
ARestlessOcean.WaterTileDecoder.prototype.getTile = function(lod, tileX, tileY){
  if(!this.available || tileX < 0 || tileY < 0) return null;
  if(this.isKnownDry(lod, tileX, tileY)) return null;
  const key = lod + '_' + tileX + '_' + tileY;
  const entry = this._cache.get(key);
  if(entry === 'dry' || entry === 'loading' || !entry) {
    if(!entry) this._load(lod, tileX, tileY, key);
    return null;
  }
  return entry;
};

//All non-known-dry tiles at `lod` intersecting a world-space AABB. Returns
//[{tileX, tileY, originX, originZ, span, entry}], entry null while still
//loading — the caller skips those, and onTileLoaded re-fills the cascade once
//they land.
ARestlessOcean.WaterTileDecoder.prototype.tilesIntersecting = function(minX, minZ, maxX, maxZ, lod){
  const out = [];
  if(!this.available) return out;
  const span = this.spanForLod(lod);
  const x0 = Math.max(0, Math.floor(minX / span));
  const x1 = Math.floor(maxX / span);
  const y0 = Math.max(0, Math.floor(minZ / span));
  const y1 = Math.floor(maxZ / span);
  for(let ty = y0; ty <= y1; ++ty){
    for(let tx = x0; tx <= x1; ++tx){
      if(this.isKnownDry(lod, tx, ty)) continue;
      out.push({
        tileX: tx, tileY: ty,
        originX: tx * span, originZ: ty * span, span: span,
        entry: this.getTile(lod, tx, ty)
      });
    }
  }
  return out;
};

ARestlessOcean.WaterTileDecoder.prototype._makeDataTexture = function(data, w, h){
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  //No flip: PNG rows are decoded top-to-bottom into `data` in the same row
  //order a-land's exporter wrote them, and WaterReader.sampleTile indexes
  //that array directly with no flip (fy runs the same direction as the raw
  //row index). Flipping here would silently disagree with the CPU oracle.
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
};

ARestlessOcean.WaterTileDecoder.prototype._load = function(lod, tileX, tileY, key){
  const self = this;
  this._cache.set(key, 'loading');
  const decode = (typeof ALand !== 'undefined' && ALand.runtime && ALand.runtime.streaming
    && ALand.runtime.streaming.decodePngRGBA) || null;
  if(!decode){ this._cache.set(key, 'dry'); return; }

  const urls = ['waterLevel', 'waterFlow', 'waterClass'].map(function(s){
    return self.director._urlForTile(s, lod, tileX, tileY);
  });
  Promise.all(urls.map(function(u){
    return fetch(u).then(function(r){
      if(!r.ok) return null;
      return r.arrayBuffer().then(function(buf){ return decode(new Uint8Array(buf)); });
    })['catch'](function(){ return null; });
  })).then(function(tiles){
    if(!tiles[0]){ self._cache.set(key, 'dry'); return; }   //missing level tile = all-dry
    const w = tiles[0].w;
    //Flow/class degrade to still/empty if missing, same as WaterReader._load:
    //flow's "still" is raw 32768 = hi-byte 128 per axis, class's empty is
    //all-zero.
    let flowData = tiles[1] ? tiles[1].data : new Uint8Array(w * w * 4);
    if(!tiles[1]) for(let i = 0; i < flowData.length; i += 4){ flowData[i] = 128; flowData[i + 2] = 128; }
    const clsData = tiles[2] ? tiles[2].data : new Uint8Array(w * w * 4);

    const entry = {
      w: w,
      levelTex: self._makeDataTexture(tiles[0].data, w, w),
      flowTex: self._makeDataTexture(flowData, w, w),
      clsTex: self._makeDataTexture(clsData, w, w)
    };
    self._cache.set(key, entry);

    if(self._cache.size > self._max){
      for(const k of self._cache.keys()){
        const v = self._cache.get(k);
        if(v !== 'loading' && k !== key){
          if(v && v !== 'dry'){ v.levelTex.dispose(); v.flowTex.dispose(); v.clsTex.dispose(); }
          self._cache['delete'](k);
          break;
        }
      }
    }
    //Tell the field to re-fill — see the onTileLoaded note in the constructor.
    if(self.onTileLoaded) self.onTileLoaded();
  })['catch'](function(){ self._cache.set(key, 'dry'); });
};

ARestlessOcean.WaterTileDecoder.prototype.dispose = function(){
  for(const v of this._cache.values()){
    if(v && v !== 'dry' && v !== 'loading'){
      v.levelTex.dispose(); v.flowTex.dispose(); v.clsTex.dispose();
    }
  }
  this._cache.clear();
};
