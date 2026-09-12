//── WaterTileDecodePass ────────────────────────────────────────────────────
//
//WATER-TYPES.md Phase 1b. Draws a-land's decoded water tiles on top of
//WaterFieldPass's standalone base fill, one quad per LOD-0 tile intersecting
//a cascade, clipped to the cascade's world footprint.
//
//This is the GLSL mirror of a-land's WaterReader.sampleTile (the contract
//oracle, a-faraway-land/src/js/runtime/streaming/WaterReader.js:47-77) and
//MUST match its four-branch behaviour exactly:
//  - depth/vx/vz/energy: bilinear over ALL 4 corners (a dry corner
//    contributes 0, diluting the average — it is NOT excluded).
//  - level: bilinear, but renormalised over WET corners ONLY (a dry corner
//    is excluded from the level average entirely, not treated as level=0).
//  - type: taken from the single highest-weight WET corner.
//  - fully-dry or fully-zero-depth footprint: sampleTile returns null.
//
//PHASE 1c — A LOADED TILE IS AUTHORITATIVE, DRY INCLUDED
//That null used to be a `discard`, which left the standalone base fill standing
//under it: sea level plus foam-ortho depth. Anywhere a-land says "dry" but the
//ground sits below sea level — a painted Dry Zone, a dammed bay — the fallback
//plane flooded it, breaking rule 1 (the field is the only source of truth about
//where water is). Now a dry answer is WRITTEN:
//    level = uSeaLevel (the same value the base fill wrote, so the level blend
//            across a shoreline is unchanged), depth = flow = energy = 0,
//    type = uWaterType, dryMask = 1.
//Whole tiles a-land answers as dry (absent from wetTiles, or 404) are drawn
//with uForceDry = 1 and never fetched. Only tiles still LOADING are skipped, so
//the fallback survives exactly where a-land has not answered yet.
//
//dryMask: 1 = the terrain provider says dry here; 0 = wet, or no provider
//answer yet. `depth == 0` stays the universal discard — dryMask is what tells
//"known dry" from "guessed".
//
//texelFetch (not texture()) is required on the four corner texels: NEAREST
//filtering alone cannot give per-corner wetness testing, which this decode
//needs to do explicitly before any interpolation. This is why the source
//textures must be raw + NEAREST (see water-tile-decoder.js) — filtering
//them first would average across the wet/dry boundary before we ever get a
//chance to mask it out, corrupting `level` exactly where the contract
//(a-land-water-contract.md, and WATER-TYPES.md:449-451) says it must not.
//
//Runs once per cascade tile-refill (rare — texel-snap gated, same as the
//base fill), not per rendered fragment. The final waterFieldLevelAt() in
//water-shader.glsl only ever reads the already-decoded cascade RT.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.WaterTileDecodePass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.decoder = null;
  this._decoderDirector = null;

  const geo = new THREE.PlaneGeometry(2, 2);
  this._scene = new THREE.Scene();
  this._material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uLevelTex:   {value: null},
      uFlowTex:    {value: null},
      uClassTex:   {value: null},
      uTileRes:    {value: 1},
      uMaxDepth:   {value: 60.0},
      uVelocityRange: {value: 16.0},
      uVR0:        {value: 0.0},
      uVScale:     {value: 1.0},
      uNdcMin:     {value: new THREE.Vector2(-1, -1)},
      uNdcMax:     {value: new THREE.Vector2(1, 1)},
      uTileUvMin:  {value: new THREE.Vector2(0, 0)},
      uTileUvMax:  {value: new THREE.Vector2(1, 1)},
      uSeaLevel:   {value: 0.0},
      uWaterType:  {value: 0.0},
      uForceDry:   {value: 0.0}
    },
    vertexShader: [
      'out vec2 vTileUv;',
      'uniform vec2 uNdcMin, uNdcMax, uTileUvMin, uTileUvMax;',
      'void main(){',
      '  vec2 t = uv;',   //PlaneGeometry's own UV: 0..1, matching (position+1)/2 —
                            //same convention WaterFieldPass._fillMaterial relies on.
      '  vec2 ndc = mix(uNdcMin, uNdcMax, t);',
      '  vTileUv = mix(uTileUvMin, uTileUvMax, t);',
      '  gl_Position = vec4(ndc, 0.0, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'layout(location = 0) out vec4 gLevelDepthFlow;',
      'layout(location = 1) out vec4 gClass;',
      'in vec2 vTileUv;',
      'uniform sampler2D uLevelTex, uFlowTex, uClassTex;',
      'uniform float uTileRes, uMaxDepth, uVelocityRange, uVR0, uVScale;',
      'uniform float uSeaLevel, uWaterType, uForceDry;',
      '',
      //The authoritative dry answer — see the file header (Phase 1c).
      'void writeDry(){',
      '  gLevelDepthFlow = vec4(uSeaLevel, 0.0, 0.0, 0.0);',
      '  gClass = vec4(0.0, uWaterType, 0.0, 1.0);',
      '}',
      '',
      'float depthFromByte(float b){ float t = b / 255.0; return t * t * uMaxDepth; }',
      'float velFrom16(float raw){ return (raw - 32768.0) / 32767.0 * uVelocityRange; }',
      '',
      'void main(){',
      '  if(uForceDry > 0.5){ writeDry(); return; }',
      //Tile-local fractional coordinate, matching WaterReader.sampleTile's
      //fx/fy EXACTLY: fx = (worldX - tileOriginX)/tileSize*(t-1) === vTileUv.x*(t-1).
      '  vec2 fxy = vTileUv * vec2(uTileRes - 1.0);',
      '  ivec2 c0 = ivec2(floor(fxy));',
      '  c0 = clamp(c0, ivec2(0), ivec2(uTileRes) - ivec2(2));',
      '  vec2 t = clamp(fxy - vec2(c0), 0.0, 1.0);',
      '  ivec2 offs[4] = ivec2[4](ivec2(0,0), ivec2(1,0), ivec2(0,1), ivec2(1,1));',
      '  float wt[4] = float[4]((1.0-t.x)*(1.0-t.y), t.x*(1.0-t.y), (1.0-t.x)*t.y, t.x*t.y);',
      '',
      '  float depth = 0.0, vx = 0.0, vz = 0.0, energy = 0.0;',
      '  float wetW = 0.0, bestW = -1.0, kind = 0.0, level = 0.0;',
      '',
      '  for(int k = 0; k < 4; k++){',
      '    ivec2 px = c0 + offs[k];',
      '    float wk = wt[k];',
      '    if(wk <= 0.0) continue;',
      '    vec4 L = texelFetch(uLevelTex, px, 0) * 255.0;',
      '    vec4 F = texelFetch(uFlowTex,  px, 0) * 255.0;',
      '    vec4 C = texelFetch(uClassTex, px, 0) * 255.0;',
      '    float db = L.a;',
      '    depth  += depthFromByte(db) * wk;',
      '    vx     += velFrom16(F.r * 256.0 + F.g) * wk;',
      '    vz     += velFrom16(F.b * 256.0 + F.a) * wk;',
      '    energy += (C.r / 255.0) * wk;',
      '    if(db > 0.0){',
      '      float n = (L.r * 65536.0 + L.g * 256.0 + L.b) / 16777215.0;',
      '      level += (uVR0 + n * uVScale) * wk;',
      '      wetW += wk;',
      '      if(wk > bestW){ bestW = wk; kind = C.g; }',
      '    }',
      '  }',
      '',
      '  if(wetW <= 0.0){ writeDry(); return; }',   //fully dry footprint — sampleTile returns null here
      '  level /= wetW;',
      '  if(!(depth > 0.0)){ writeDry(); return; }', //fully zero-depth footprint — sampleTile returns null here
      '',
      '  gLevelDepthFlow = vec4(level, depth, vx, vz);',
      //shoreSDF (.b) is left 0 here; WaterFieldPass's compose pass derives it.
      '  gClass = vec4(energy, kind, 0.0, 0.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false,
    transparent: false
  });
  this._mesh = new THREE.Mesh(geo, this._material);
  this._scene.add(this._mesh);
  this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
};

//Ensures the decoder exists and is bound to the current landDirector
//(rebuilt if a-land's director reference ever changes — e.g. a scene
//reload swaps the <a-land-terrain> element).
ARestlessOcean.Passes.WaterTileDecodePass.prototype._ensureDecoder = function(landDirector){
  //Keyed on the mapJson IDENTITY as well as the director, so a decoder built
  //before a-land finished fetching its map (and therefore latched
  //available=false) is rebuilt the moment real data lands, instead of sitting
  //there refusing to fetch anything forever. Identity rather than presence, so
  //a map that genuinely has no water sources doesn't rebuild every frame.
  const mapJson = landDirector && landDirector.mapJson;
  if(this.decoder && this._decoderDirector === landDirector
     && this._decoderMapJson === mapJson) return this.decoder;
  if(this.decoder) this.decoder.dispose();
  this._decoderMapJson = mapJson;
  const grid = this.oceanGrid;
  this.decoder = new ARestlessOcean.WaterTileDecoder(landDirector, function(){
    //A tile landed. Cascades only re-fill when their snapped centre moves, and
    //the first fill always runs against an empty cache, so without this the
    //decoded tiles would never reach the field unless the camera happened to
    //move afterwards. Fires from a fetch promise (between frames), never
    //mid-loop.
    if(grid.waterFieldPass) grid.waterFieldPass.invalidate();
  });
  this._decoderDirector = landDirector;
  return this.decoder;
};

//Draws every tile intersecting cascade `c`'s world footprint, at the LOD
//matching that cascade's texel density. `ctx` carries {seaLevel, waterType} for
//the authoritative dry writes. Called
//from WaterFieldPass.tick() immediately after that cascade's standalone
//base fill, with `c.target` still the active render target — this pass
//never sets/restores the render target itself.
ARestlessOcean.Passes.WaterTileDecodePass.prototype.fillCascade = function(c, landDirector, ctx){
  const decoder = this._ensureDecoder(landDirector);
  if(!decoder.available) return;

  const vr = (typeof ALand !== 'undefined' && ALand.core && ALand.core.heightEncoding)
    ? ALand.core.heightEncoding(landDirector.mapJson) : [0, 1];
  const maxDepth = (decoder.sim && decoder.sim.maxDepth) || 60;
  const velocityRange = (decoder.sim && decoder.sim.velocityRange) || 16;

  const minX = c.centerX - c.halfWidth, maxX = c.centerX + c.halfWidth;
  const minZ = c.centerZ - c.halfWidth, maxZ = c.centerZ + c.halfWidth;
  //Read tiles at this cascade's own texel density — see lodForWidth's note.
  const lod = decoder.lodForWidth(2.0 * c.halfWidth);
  const tiles = decoder.tilesIntersecting(minX, minZ, maxX, maxZ, lod);

  const u = this._material.uniforms;
  u.uMaxDepth.value = maxDepth;
  u.uVelocityRange.value = velocityRange;
  u.uVR0.value = vr[0];
  u.uVScale.value = vr[1] - vr[0];
  u.uSeaLevel.value = ctx ? ctx.seaLevel : 0.0;
  u.uWaterType.value = ctx ? ctx.waterType : 0.0;

  //⚠ autoClear MUST be off for these draws. Each renderer.render() would
  //otherwise clear the whole cascade first, wiping the standalone base fill
  //AND every tile already drawn — leaving only the last tile's footprint and
  //zeroes everywhere else, which reads back as level 0 and shoves the entire
  //ocean surface up to y=0.
  const prevAutoClear = this.renderer.autoClear;
  this.renderer.autoClear = false;

  for(let i = 0; i < tiles.length; ++i){
    const t = tiles[i];
    //Still loading: skip, keeping the standalone fallback until it lands.
    if(!t.entry && !t.dry) continue;

    const span = t.span;
    const tMinX = t.originX, tMaxX = t.originX + span;
    const tMinZ = t.originZ, tMaxZ = t.originZ + span;
    const clipMinX = Math.max(tMinX, minX), clipMaxX = Math.min(tMaxX, maxX);
    const clipMinZ = Math.max(tMinZ, minZ), clipMaxZ = Math.min(tMaxZ, maxZ);
    if(clipMinX >= clipMaxX || clipMinZ >= clipMaxZ) continue;   //no overlap

    u.uForceDry.value = t.dry ? 1.0 : 0.0;
    if(!t.dry){
      u.uLevelTex.value = t.entry.levelTex;
      u.uFlowTex.value = t.entry.flowTex;
      u.uClassTex.value = t.entry.clsTex;
      u.uTileRes.value = t.entry.w;
    }

    u.uNdcMin.value.set((clipMinX - c.centerX) / c.halfWidth, (clipMinZ - c.centerZ) / c.halfWidth);
    u.uNdcMax.value.set((clipMaxX - c.centerX) / c.halfWidth, (clipMaxZ - c.centerZ) / c.halfWidth);
    u.uTileUvMin.value.set((clipMinX - tMinX) / span, (clipMinZ - tMinZ) / span);
    u.uTileUvMax.value.set((clipMaxX - tMinX) / span, (clipMaxZ - tMinZ) / span);

    this.renderer.render(this._scene, this._camera);
  }

  this.renderer.autoClear = prevAutoClear;
};

ARestlessOcean.Passes.WaterTileDecodePass.prototype.dispose = function(){
  if(this.decoder) this.decoder.dispose();
  this._mesh.geometry.dispose();
  this._material.dispose();
};
