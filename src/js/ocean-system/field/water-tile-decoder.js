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
  //World extent in metres (map.json bounds.size, origin at 0,0 like the tile
  //grid). 0 = unknown, which leaves tilesIntersecting unclamped on that axis.
  const size = mj && mj.bounds && mj.bounds.size;
  this.worldSizeX = (size && size[0]) || 0;
  this.worldSizeZ = (size && size[1]) || 0;

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

//Does a-land say there is water at this world point? The CPU half of the
//field's dryMask, at LOD 0, for callers that must tell "dry" from "not loaded
//yet", which getWaterAt cannot (it answers null for both). Returns:
//  'wet'     — at least one wet corner with depth > 0 (sampleTile would answer)
//  'dry'     — the tile is indexed dry / 404'd, or this footprint is dry in it
//  'loading' — no answer yet (kicks the load, like getTile)
//  'none'    — outside a-land's world; the standalone ocean is the answer
//The footprint test mirrors WaterReader.sampleTile's null branches exactly.
ARestlessOcean.WaterTileDecoder.prototype.answerAt = function(worldX, worldZ){
  if(!this.available) return 'none';
  const span = this.spanForLod(0);
  if(worldX < 0 || worldZ < 0) return 'none';
  if(this.worldSizeX > 0 && worldX >= this.worldSizeX) return 'none';
  if(this.worldSizeZ > 0 && worldZ >= this.worldSizeZ) return 'none';
  const tx = Math.floor(worldX / span), ty = Math.floor(worldZ / span);
  if(this.isKnownDry(0, tx, ty)) return 'dry';
  const entry = this.getTile(0, tx, ty);
  if(!entry){
    return (this._cache.get('0_' + tx + '_' + ty) === 'dry') ? 'dry' : 'loading';
  }
  const t = entry.w;
  const L = entry.levelTex.image.data;
  let fx = (worldX - tx * span) / span * (t - 1);
  let fy = (worldZ - ty * span) / span * (t - 1);
  fx = Math.min(t - 1, Math.max(0, fx));
  fy = Math.min(t - 1, Math.max(0, fy));
  const x0 = fx | 0, y0 = fy | 0;
  const x1 = x0 < t - 1 ? x0 + 1 : x0, y1 = y0 < t - 1 ? y0 + 1 : y0;
  const ax = fx - x0, az = fy - y0;
  const idx = [y0 * t + x0, y0 * t + x1, y1 * t + x0, y1 * t + x1];
  const wt = [(1 - ax) * (1 - az), ax * (1 - az), (1 - ax) * az, ax * az];
  for(let k = 0; k < 4; ++k){
    if(wt[k] > 0 && L[idx[k] * 4 + 3] > 0) return 'wet';
  }
  return 'dry';
};

//Every tile at `lod` intersecting a world-space AABB, clamped to the world's own
//tile grid. Returns [{tileX, tileY, originX, originZ, span, entry, dry}]:
//  dry: true    — a-land has ANSWERED "no water in this whole tile" (absent from
//                 the wetTiles index, or its level tile 404'd). Phase 1c: the
//                 caller writes an authoritative dry quad, so the standalone
//                 fallback plane cannot flood a below-sea-level Dry Zone.
//  entry: null  — still loading. Skipped; the standalone fallback survives until
//                 onTileLoaded re-fills the cascade.
//Tiles outside the world grid are not returned at all: beyond a-land's bounds
//there is no answer to give, and the standalone ocean is the right one.
ARestlessOcean.WaterTileDecoder.prototype.tilesIntersecting = function(minX, minZ, maxX, maxZ, lod){
  const out = [];
  if(!this.available) return out;
  const span = this.spanForLod(lod);
  const x0 = Math.max(0, Math.floor(minX / span));
  const y0 = Math.max(0, Math.floor(minZ / span));
  let x1 = Math.floor(maxX / span);
  let y1 = Math.floor(maxZ / span);
  if(this.worldSizeX > 0) x1 = Math.min(x1, Math.ceil(this.worldSizeX / span) - 1);
  if(this.worldSizeZ > 0) y1 = Math.min(y1, Math.ceil(this.worldSizeZ / span) - 1);
  for(let ty = y0; ty <= y1; ++ty){
    for(let tx = x0; tx <= x1; ++tx){
      let entry = null;
      let dry = this.isKnownDry(lod, tx, ty);
      if(!dry){
        entry = this.getTile(lod, tx, ty);
        dry = (this._cache.get(lod + '_' + tx + '_' + ty) === 'dry');
      }
      out.push({
        tileX: tx, tileY: ty,
        originX: tx * span, originZ: ty * span, span: span,
        entry: entry, dry: dry
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

ARestlessOcean.WaterTileDecoder.RETRY_MS = 5000;

ARestlessOcean.WaterTileDecoder.prototype._load = function(lod, tileX, tileY, key){
  const self = this;
  this._cache.set(key, 'loading');
  const decode = (typeof ALand !== 'undefined' && ALand.runtime && ALand.runtime.streaming
    && ALand.runtime.streaming.decodePngRGBA) || null;
  if(!decode){ this._cache.set(key, 'dry'); return; }

  const urls = ['waterLevel', 'waterFlow', 'waterClass'].map(function(s){
    return self.director._urlForTile(s, lod, tileX, tileY);
  });
  //A MISSING tile (404) is an answer: all-dry. A FAILED fetch (network error, 5xx) is
  //not, and used to be filed as 'dry' too — authoritative, so the field forced that
  //tile's water dry for the rest of the session. It stays unknown and is retried.
  const FAILED = {};
  Promise.all(urls.map(function(u){
    return fetch(u).then(function(r){
      if(r.status >= 500) return FAILED;
      if(!r.ok) return null;
      return r.arrayBuffer().then(function(buf){ return decode(new Uint8Array(buf)); });
    })['catch'](function(){ return FAILED; });
  })).then(function(tiles){
    if(tiles.indexOf(FAILED) !== -1){
      setTimeout(function(){
        if(self._cache.get(key) !== 'loading') return;
        self._cache['delete'](key);                    //the next getTile asks again
        if(self.onTileLoaded) self.onTileLoaded();     //and a refill will make it
      }, ARestlessOcean.WaterTileDecoder.RETRY_MS);
      return;
    }
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
