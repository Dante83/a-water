//── WaterField ─────────────────────────────────────────────────────────────
//
//Phase 1 of the multi-water plan (WATER-TYPES.md). THE keystone: every phase
//after this one reads the field rather than assuming a plane.
//
//WHAT IT IS
//0.2.0 rendered one body of water on one global plane at y = height_offset, and
//every subsystem was built on that scalar — one submersion probe, one CSM pivot,
//one skirt Y, one clip plane. WaterField replaces the scalar with a FIELD:
//camera-following, world-anchored cascade render targets carrying, per texel:
//
//    RT0:  level    depth     flow.x    flow.z
//    RT1:  energy   type      shoreSDF  dryMask
//
//`shoreNormal` is deliberately NOT stored — it is normalize(gradient(shoreSDF)),
//cheaper to derive where it is sampled than to carry two more channels.
//
//PHASE 1c — shoreSDF AND dryMask
//  shoreSDF  signed distance to the nearest wet/dry boundary, in METRES:
//            positive over water, negative over land. Derived here by a jump
//            flood over the finished (base + tile decode) depth channel — see
//            _composeShoreField. ±2·halfWidth when the cascade has no shore in it.
//  dryMask   1 = the terrain provider SAYS dry here; 0 = wet, or no provider
//            answer yet (see water-tile-decode-pass.js).
//
//⚠ Each cascade only sees shores INSIDE ITS OWN FOOTPRINT. Near a cascade edge
//the SDF overestimates (the true nearest shore may be just outside), so a
//consumer must crossfade cascades exactly the way waterFieldLevelAt does rather
//than trusting one cascade to its rim.
//
//THE THREE RULES (from the architecture doc, and they are load-bearing)
//  1. The field is the ONLY source of truth about where water is. Nothing
//     samples terrain directly ever again.
//  2. `depth == 0` is the universal discard.
//  3. The ocean must not notice whether a terrain provider is present.
//     Standalone fills the same field with the 0.2.0 answers, so consumers
//     never branch on "do we have terrain data".
//
//WHY CASCADES RATHER THAN ONE BIG TEXTURE
//The clipmap philosophy applied to data. Shorelines need metre resolution; the
//horizon needs kilometres of reach; one texture cannot do both without being
//enormous. Three world-anchored rings, each texel-snapped exactly like the foam
//ortho so the field does not shimmer as the camera pans, and each re-filled only
//when its own snapped centre moves — so the coarse rings cost almost nothing.
//
//⚠️ PHASE 1a SCOPE — THIS FILE IS CURRENTLY STANDALONE-ONLY
//The fill below reproduces exactly what the ocean already believed in 0.2.0:
//level = height_offset, depth from the existing foam ortho's terrain capture,
//flow = 0, energy = 0, type = water_type. That is deliberate. It lets the seam be
//cut and every consumer rerouted with ZERO visual change, before any
//a-faraway-land data is involved. Phase 1b swaps _fillMaterial's shader for a
//real tile decode and nothing downstream has to move again.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.WaterFieldPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;

  this.cascades = [];
  this._fillScene = null;
  this._fillCamera = null;
  this._fillMaterial = null;
  this._probeBuf = null;
  this._probePending = false;

  //Phase 1c shore-field machinery — see _composeShoreField.
  this._scratch = null;      //shared MRT the base fill + tile decode render into
  this._jfaTargets = null;   //ping-pong seed targets
  this._seedMaterial = null;
  this._jfaMaterial = null;
  this._composeMaterial = null;
  this._blitMaterial = null;
  this._readTarget = null;   //single-attachment copy target for RT1 readback
  this.shoreFieldEnabled = true;
  //Cumulative cascade refills (debug). Each is ~12 fullscreen 512² draws with the
  //shore field on. A count rather than a timing: GL is async, and browsers clamp
  //performance.now() coarsely enough that a CPU timing of the submit reads 0.00.
  this.refillCount = 0;
};

//Cascade half-widths in metres, fine -> coarse. Cascade 0 carries shoreline
//detail at 1 m/texel; cascade 2 reaches past the visible horizon so the field
//never runs out from under the clipmap.
ARestlessOcean.Passes.WaterFieldPass.CASCADE_HALF_WIDTHS = [256.0, 1024.0, 4096.0];
ARestlessOcean.Passes.WaterFieldPass.RESOLUTION = 512;
//Depth used where we have no terrain information at all (outside the foam
//ortho's footprint). Open ocean: deep enough that every depth-driven term
//saturates, without being infinite.
ARestlessOcean.Passes.WaterFieldPass.OPEN_OCEAN_DEPTH = 1000.0;

ARestlessOcean.Passes.WaterFieldPass.prototype.init = function(){
  const RES = ARestlessOcean.Passes.WaterFieldPass.RESOLUTION;
  const halfWidths = ARestlessOcean.Passes.WaterFieldPass.CASCADE_HALF_WIDTHS;

  //⚠ FILTERING A FLOAT TEXTURE NEEDS OES_texture_float_linear, AND THE FAILURE
  //IS SILENT AND CATASTROPHIC. Without that extension a FloatType texture with
  //LinearFilter is INCOMPLETE, and an incomplete texture samples as (0,0,0,1) —
  //so waterFieldLevelAt reads level 0 instead of the sea level, the vertex
  //shader's `level - baseHeightOffset` delta becomes +150 on a -150 m world,
  //and the entire ocean surface lifts above every hilltop and floods the map.
  //Nothing logs; readRenderTargetPixels still returns the correct -150, because
  //a readback does not go through the sampler at all, so probes disagree with
  //what the shader sees.
  //
  //So ask, and fall back to NEAREST. A cascade texel is 1 m at cascade 0, and
  //point-sampling the level is a fine trade against not rendering at all — it
  //costs the soft shoreline blend the LinearFilter note below describes.
  const canFilterFloat = !!(this.renderer && this.renderer.extensions
    && this.renderer.extensions.has('OES_texture_float_linear'));
  const fieldFilter = canFilterFloat ? THREE.LinearFilter : THREE.NearestFilter;
  this.floatLinearSupported = canFilterFloat;

  for(let i = 0; i < halfWidths.length; ++i){
    //LinearFilter is correct HERE even though the Phase 1b tile decode must use
    //NEAREST on its SOURCE tiles: by this point the values are already decoded
    //floats, so interpolating them is meaningful. Blending level across a
    //shoreline is benign (dry texels still carry the plane) and blending depth
    //toward 0 at the shore is exactly the soft edge we want.
    //
    //⚠️ FloatType, NOT HalfFloatType. `level` is an absolute world Y, and
    //a-land worlds span thousands of metres (simple-islands' verticalRange is
    //[-200, 4000]). Half-float carries a 10-bit mantissa, so near 4000 m its
    //step is ~4 m — it would quantise the water surface to metres. Full float
    //also lets the readback below share the Float32Array convention the rest of
    //the codebase uses; a half-float target read into a Float32Array returns
    //reinterpreted bits, which is how this was first caught.
    //Cost: 512^2 * 16 B * 2 attachments * 3 cascades ~= 25 MB.
    const target = new THREE.WebGLRenderTarget(RES, RES, {
      count: 2,
      minFilter: fieldFilter,
      magFilter: fieldFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });
    this.cascades.push({
      target: target,
      halfWidth: halfWidths[i],
      texel: (2.0 * halfWidths[i]) / RES,
      centerX: undefined,   //undefined => never filled, forces the first fill
      centerZ: undefined
    });
  }

  this._fillMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uCascadeCenter:    {value: new THREE.Vector2()},
      uCascadeHalfWidth: {value: 1.0},
      uSeaLevel:         {value: 0.0},
      uWaterType:        {value: 0.0},
      uOpenOceanDepth:   {value: ARestlessOcean.Passes.WaterFieldPass.OPEN_OCEAN_DEPTH},
      uFoamMap:          {value: null},
      uFoamCameraXZ:     {value: new THREE.Vector2()},
      uFoamHalfWidth:    {value: 2048.0}
    },
    vertexShader: [
      'out vec2 vUv;',
      'void main(){',
      '  vUv = uv;',
      '  gl_Position = vec4(position.xy, 0.0, 1.0);',
      '}'
    ].join('\n'),
    //Standalone fill. Mirrors the 0.2.0 answers exactly — see the file header
    //for why this is deliberately dumb in Phase 1a.
    fragmentShader: [
      'precision highp float;',
      'layout(location = 0) out vec4 gLevelDepthFlow;',
      'layout(location = 1) out vec4 gClass;',
      'in vec2 vUv;',
      'uniform vec2 uCascadeCenter;',
      'uniform float uCascadeHalfWidth;',
      'uniform float uSeaLevel;',
      'uniform float uWaterType;',
      'uniform float uOpenOceanDepth;',
      'uniform sampler2D uFoamMap;',
      'uniform vec2 uFoamCameraXZ;',
      'uniform float uFoamHalfWidth;',
      'void main(){',
      '  vec2 worldXZ = uCascadeCenter + (vUv * 2.0 - 1.0) * uCascadeHalfWidth;',
      //Standalone: one global plane, everywhere.
      '  float level = uSeaLevel;',
      //Depth from the foam ortho terrain capture. That RT is written by the
      //position pass, so .g is world Y and .a is the geometry-present mask.
      //The UV mapping MUST match water-shader.glsl's foam sample exactly, which
      //is why both now read the same FOAM_ORTHO_HALF_WIDTH constant.
      '  vec2 fuv = 0.5 * (((worldXZ - uFoamCameraXZ) / vec2(uFoamHalfWidth)) + 1.0);',
      '  fuv = vec2(fuv.x, 1.0 - fuv.y);',
      '  float depth = uOpenOceanDepth;',
      '  if(fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0){',
      '    vec2 terrain = texture(uFoamMap, fuv).ga;',
      //.a > 0.5 means the ortho actually captured geometry here. Where it did
      //not, we are over open water and keep the open-ocean depth.
      '    if(terrain.y > 0.5) depth = max(0.0, level - terrain.x);',
      '  }',
      '  gLevelDepthFlow = vec4(level, depth, 0.0, 0.0);',
      //energy 0 and dryMask 0: standalone has no turbulence field and no notion
      //of a deliberately-dry basin. shoreSDF stays 0 until Phase 1c derives it.
      '  gClass = vec4(0.0, uWaterType, 0.0, 0.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });

  this._fillScene = new THREE.Scene();
  this._fillScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._fillMaterial));
  this._fillCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  this._initShoreField();
};

//── Phase 1c: the shore field ───────────────────────────────────────────────
//
//WHY A SCRATCH TARGET
//shoreSDF is a function of the FINISHED depth channel — base fill and tile
//decode both — so it cannot be written in the same draw that produces depth,
//and a pass cannot read the target it writes. So the base fill and tile decode
//render into one shared scratch MRT (refills are sequential, so one serves all
//three cascades), the jump flood runs over its depth, and a compose pass writes
//the finished cascade. c.target keeps its identity, so every texture reference
//already handed out (water shader uniforms, a-land's setWaterField) stays valid.
//
//THE SEEDS ARE BOUNDARY POINTS, NOT TEXELS
//A texel whose wetness differs from a 4-neighbour seeds the position HALF A
//TEXEL toward that neighbour — the shoreline itself, which lies between the two
//texel centres. Seeding the texel centre instead would make every distance one
//texel short on one side or the other. Because both sides seed the SAME point,
//one flood serves both the wet and the dry half; the sign comes from the texel's
//own wetness.
//
//COST
//Seed + 10 flood steps (256 … 1, plus one extra step of 1 — "JFA+1", which
//mops up the rare wrong-seed texel) + compose = 12 fullscreen 512² draws per
//refilled cascade. Cascade 0 refills once per metre of camera travel.
ARestlessOcean.Passes.WaterFieldPass.prototype._initShoreField = function(){
  const RES = ARestlessOcean.Passes.WaterFieldPass.RESOLUTION;
  const nearestFloat = function(count){
    return new THREE.WebGLRenderTarget(RES, RES, {
      count: count,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });
  };
  this._scratch = nearestFloat(2);
  this._jfaTargets = [nearestFloat(1), nearestFloat(1)];
  this._readTarget = nearestFloat(1);

  const vertexShader = this._fillMaterial.vertexShader;
  const resDefine = 'const int RES = ' + RES + ';';

  //Seed: boundary point (see header) in texel-index space, a = 1; else a = 0.
  this._seedMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {uDepthTex: {value: null}},
    vertexShader: vertexShader,
    fragmentShader: [
      'precision highp float;',
      resDefine,
      'layout(location = 0) out vec4 oSeed;',
      'uniform sampler2D uDepthTex;',
      'float wetAt(ivec2 q){',
      '  q = clamp(q, ivec2(0), ivec2(RES - 1));',   //the rim compares against itself: never a seed
      '  return texelFetch(uDepthTex, q, 0).g > 0.0 ? 1.0 : 0.0;',
      '}',
      'void main(){',
      '  ivec2 p = ivec2(gl_FragCoord.xy);',
      '  float w = wetAt(p);',
      '  vec2 dir = vec2(0.0);',
      '  float n = 0.0;',
      '  if(wetAt(p + ivec2(1, 0)) != w){ dir += vec2( 1.0, 0.0); n += 1.0; }',
      '  if(wetAt(p - ivec2(1, 0)) != w){ dir += vec2(-1.0, 0.0); n += 1.0; }',
      '  if(wetAt(p + ivec2(0, 1)) != w){ dir += vec2(0.0,  1.0); n += 1.0; }',
      '  if(wetAt(p - ivec2(0, 1)) != w){ dir += vec2(0.0, -1.0); n += 1.0; }',
      '  if(n < 0.5){ oSeed = vec4(0.0); return; }',
      //Opposite neighbours cancel (a one-texel strip): the boundary is the texel itself.
      '  oSeed = vec4(vec2(p) + 0.5 * dir, 0.0, 1.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });

  this._jfaMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {uSeedTex: {value: null}, uStep: {value: 1}},
    vertexShader: vertexShader,
    fragmentShader: [
      'precision highp float;',
      resDefine,
      'layout(location = 0) out vec4 oSeed;',
      'uniform sampler2D uSeedTex;',
      'uniform int uStep;',
      'void main(){',
      '  ivec2 p = ivec2(gl_FragCoord.xy);',
      '  vec2 pf = vec2(p);',
      '  vec4 best = vec4(0.0);',
      '  float bestD = 1e20;',
      '  for(int dy = -1; dy <= 1; dy++){',
      '    for(int dx = -1; dx <= 1; dx++){',
      '      ivec2 q = p + ivec2(dx, dy) * uStep;',
      '      if(q.x < 0 || q.y < 0 || q.x >= RES || q.y >= RES) continue;',
      '      vec4 s = texelFetch(uSeedTex, q, 0);',
      '      if(s.a < 0.5) continue;',
      '      vec2 d = s.xy - pf;',
      '      float dd = dot(d, d);',
      '      if(dd < bestD){ bestD = dd; best = s; }',
      '    }',
      '  }',
      '  oSeed = best;',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });

  this._composeMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uFieldA: {value: null},
      uFieldB: {value: null},
      uSeedTex: {value: null},
      uTexel: {value: 1.0},
      uNoShore: {value: 1.0}
    },
    vertexShader: vertexShader,
    fragmentShader: [
      'precision highp float;',
      'layout(location = 0) out vec4 gLevelDepthFlow;',
      'layout(location = 1) out vec4 gClass;',
      'uniform sampler2D uFieldA, uFieldB, uSeedTex;',
      'uniform float uTexel, uNoShore;',
      'void main(){',
      '  ivec2 p = ivec2(gl_FragCoord.xy);',
      '  vec4 a = texelFetch(uFieldA, p, 0);',
      '  vec4 b = texelFetch(uFieldB, p, 0);',
      '  vec4 s = texelFetch(uSeedTex, p, 0);',
      '  float side = a.g > 0.0 ? 1.0 : -1.0;',
      '  float dist = s.a > 0.5 ? distance(vec2(p), s.xy) * uTexel : uNoShore;',
      '  gLevelDepthFlow = a;',
      '  gClass = vec4(b.r, b.g, side * dist, b.a);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });

  //Copies one attachment of an MRT into _readTarget. The three bundled with
  //A-Frame 1.7 has no textureIndex argument on readRenderTargetPixels — it only
  //ever reads COLOR_ATTACHMENT0 — so RT1 can only be read back through a copy.
  this._blitMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {uSrc: {value: null}},
    vertexShader: vertexShader,
    fragmentShader: [
      'precision highp float;',
      'layout(location = 0) out vec4 oColor;',
      'uniform sampler2D uSrc;',
      'void main(){ oColor = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0); }'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });
};

//Draw the shared fullscreen quad with `material` into `target`.
ARestlessOcean.Passes.WaterFieldPass.prototype._drawQuad = function(material, target){
  const mesh = this._fillScene.children[0];
  const prevMat = mesh.material;
  mesh.material = material;
  this.renderer.setRenderTarget(target);
  this.renderer.render(this._fillScene, this._fillCamera);
  mesh.material = prevMat;
};

//Jump flood over the scratch field's depth, then write the finished cascade.
ARestlessOcean.Passes.WaterFieldPass.prototype._composeShoreField = function(c){
  const RES = ARestlessOcean.Passes.WaterFieldPass.RESOLUTION;
  const depthTex = this._scratch.textures[0];
  let read = 0;

  if(this.shoreFieldEnabled){
    this._seedMaterial.uniforms.uDepthTex.value = depthTex;
    this._drawQuad(this._seedMaterial, this._jfaTargets[0]);

    const steps = [];
    for(let k = RES >> 1; k >= 1; k >>= 1) steps.push(k);
    steps.push(1);   //JFA+1
    const ju = this._jfaMaterial.uniforms;
    for(let i = 0; i < steps.length; ++i){
      ju.uSeedTex.value = this._jfaTargets[read].texture;
      ju.uStep.value = steps[i];
      this._drawQuad(this._jfaMaterial, this._jfaTargets[1 - read]);
      read = 1 - read;
    }
  } else {
    //Disabled (perf A/B): an empty seed target reads as "no shore anywhere".
    const prevColor = this.renderer.getClearColor(new THREE.Color());
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(this._jfaTargets[0]);
    this.renderer.setClearColor(0x000000, 0.0);
    this.renderer.clear(true, false, false);
    this.renderer.setClearColor(prevColor, prevAlpha);
  }

  const cu = this._composeMaterial.uniforms;
  cu.uFieldA.value = this._scratch.textures[0];
  cu.uFieldB.value = this._scratch.textures[1];
  cu.uSeedTex.value = this._jfaTargets[read].texture;
  cu.uTexel.value = c.texel;
  cu.uNoShore.value = 2.0 * c.halfWidth;
  this._drawQuad(this._composeMaterial, c.target);
};

//Fixed-resolution cascades — independent of the drawing buffer.
ARestlessOcean.Passes.WaterFieldPass.prototype.resize = function(){};

//Re-centre and re-fill any cascade whose snapped origin moved. ctx:
//{cameraX, cameraZ, seaLevel, waterType, foamMap, foamCameraXZ, foamHalfWidth}
ARestlessOcean.Passes.WaterFieldPass.prototype.tick = function(ctx){
  const u = this._fillMaterial.uniforms;
  const prevRT = this.renderer.getRenderTarget();
  let filled = 0;

  //a-faraway-land initialises asynchronously (it fetches map.json), so it is
  //normally discovered several frames AFTER the cascades have already done
  //their one and only standalone fill. Without this the tile decode would
  //deadlock: fillCascade only runs inside the refill branch below, so a static
  //camera would never build the decoder, never request a tile, and therefore
  //never get the tile-arrival invalidate that would have triggered a refill.
  //Building the decode pass the moment the director appears — and forcing one
  //refill — is what kicks the first fetches off.
  const og = this.oceanGrid;
  const terrainReady = !!(og && og._terrainProvider === 'a-faraway-land' && og._landDirector);
  if(terrainReady && !this._tileDecodePass && ARestlessOcean.Passes.WaterTileDecodePass){
    this._tileDecodePass = new ARestlessOcean.Passes.WaterTileDecodePass(og);
    this.invalidate();
  }

  for(let i = 0; i < this.cascades.length; ++i){
    const c = this.cascades[i];
    //Snap the centre to this cascade's own texel grid so the sampled field does
    //not shimmer as the camera pans — same discipline as the foam ortho.
    const cx = Math.round(ctx.cameraX / c.texel) * c.texel;
    const cz = Math.round(ctx.cameraZ / c.texel) * c.texel;
    if(cx === c.centerX && cz === c.centerZ) continue;   //still valid

    c.centerX = cx;
    c.centerZ = cz;
    u.uCascadeCenter.value.set(cx, cz);
    u.uCascadeHalfWidth.value = c.halfWidth;
    u.uSeaLevel.value = ctx.seaLevel;
    u.uWaterType.value = ctx.waterType;
    u.uFoamMap.value = ctx.foamMap;
    u.uFoamCameraXZ.value.copy(ctx.foamCameraXZ);
    u.uFoamHalfWidth.value = ctx.foamHalfWidth;

    //Into the shared scratch, not c.target — see _initShoreField's header.
    this.renderer.setRenderTarget(this._scratch);
    this.renderer.render(this._fillScene, this._fillCamera);

    //Phase 1b: layer real a-land tile data on top of the standalone base
    //fill above, still writing into c.target. See WaterTileDecodePass's
    //header for why this must stay a *second* draw over the standalone
    //answer rather than replacing it outright — texels a-land has not
    //answered yet (still loading, or outside its world) keep the standalone
    //fallback. Since Phase 1c a DRY answer is written, not skipped.
    if(terrainReady && this._tileDecodePass){
      this._tileDecodePass.fillCascade(c, og._landDirector, ctx);
    }

    //Phase 1c: jump-flood shoreSDF, then write the finished cascade.
    this._composeShoreField(c);

    filled++;
    this.refillCount++;
  }

  if(filled > 0) this.renderer.setRenderTarget(prevRT);
};

//Force every cascade to re-fill on the next tick. Called when a-land tile data
//arrives (WaterTileDecodePass wires this to the decoder's onTileLoaded): the
//cascades are texel-snap gated, so a cascade whose centre has not moved would
//otherwise keep serving the fill it did before those tiles existed — and the
//very first fill ALWAYS runs against an empty tile cache, so without this the
//decoded water never reaches the field at all unless the camera happens to
//move afterwards. A refill is three quad renders plus a handful of tile quads,
//so running it a few dozen times while tiles stream in is cheap.
ARestlessOcean.Passes.WaterFieldPass.prototype.invalidate = function(){
  for(let i = 0; i < this.cascades.length; ++i) this.cascades[i].centerX = undefined;
};

//Pick the finest cascade that contains this world position, or -1.
ARestlessOcean.Passes.WaterFieldPass.prototype.cascadeIndexFor = function(x, z){
  for(let i = 0; i < this.cascades.length; ++i){
    const c = this.cascades[i];
    if(c.centerX === undefined) continue;
    if(Math.abs(x - c.centerX) < c.halfWidth && Math.abs(z - c.centerZ) < c.halfWidth) return i;
  }
  return -1;
};

//Single-texel readback of the field at a world position, for console probing
//and (Phase 1b) the GPU-vs-getWaterAt parity check.
//
//⚠️ SYNCHRONOUS BY DEFAULT, deliberately. This app already keeps three async
//readbacks in flight (the local height field, the submersion probe's two
//cascade texels, and the splash terrain readback). readRenderTargetPixelsAsync
//works through a PIXEL_PACK_BUFFER, and overlapping PBO reads stomp each other
//— the browser says so out loud ("readPixels: PIXEL_PACK_BUFFER must be null"),
//and the result is a buffer full of whatever was there before. A probe that
//lies is worse than no probe, so this one takes the synchronous stall. It is a
//debug/verification path called by hand, not per frame.
//
//Pass {async: true} to use the PBO path anyway — useful only for demonstrating
//the collision.
//Returns {level, depth, flowX, flowZ, cascade} or null.
ARestlessOcean.Passes.WaterFieldPass.prototype.probeAt = function(x, z, opts){
  const self = this;
  const i = this.cascadeIndexFor(x, z);
  if(i < 0) return Promise.resolve(null);
  const c = this.cascades[i];
  const RES = ARestlessOcean.Passes.WaterFieldPass.RESOLUTION;
  const u = (x - c.centerX) / (2.0 * c.halfWidth) + 0.5;
  const v = (z - c.centerZ) / (2.0 * c.halfWidth) + 0.5;
  const px = Math.min(RES - 1, Math.max(0, Math.floor(u * RES)));
  const py = Math.min(RES - 1, Math.max(0, Math.floor(v * RES)));
  //World position of the texel CENTRE — the point this texel's value was
  //actually decoded at. Up to half a texel from (x, z); see compareAgainstLandTerrain.
  const texelX = c.centerX - c.halfWidth + (px + 0.5) * c.texel;
  const texelZ = c.centerZ - c.halfWidth + (py + 0.5) * c.texel;
  const pack = function(b, k){
    const out = {level: b[0], depth: b[1], flowX: b[2], flowZ: b[3], cascade: i,
      texelX: texelX, texelZ: texelZ};
    if(k){ out.energy = k[0]; out.type = k[1]; out.shoreSDF = k[2]; out.dryMask = k[3]; }
    return out;
  };

  if(opts && opts.async){
    this._probeBuf = this._probeBuf || new Float32Array(4);
    return this.renderer.readRenderTargetPixelsAsync(c.target, px, py, 1, 1, this._probeBuf)
      .then(function(){ return pack(self._probeBuf); })
      .catch(function(){ return null; });
  }
  //⚠ Unbind any PIXEL_PACK_BUFFER first. This app keeps async readbacks in
  //flight (local height field, submersion probe, splash terrain), and those go
  //through a PBO. A synchronous readPixels while one is bound fails outright —
  //"readPixels: PIXEL_PACK_BUFFER must be null" — and leaves the buffer holding
  //whatever it held before, i.e. zeros. That makes this probe REPORT A FIELD
  //FULL OF ZEROES while the cascade is perfectly fine, which is worse than not
  //probing at all: it frames a healthy field as catastrophically broken.
  //Restore the previous binding so the in-flight read is undisturbed.
  const gl = this.renderer.getContext();
  const canPack = (typeof WebGL2RenderingContext !== 'undefined') && (gl.PIXEL_PACK_BUFFER !== undefined);
  const prevPack = canPack ? gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) : null;
  if(prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const buf = new Float32Array(4);
  const cls = new Float32Array(4);
  this.renderer.readRenderTargetPixels(c.target, px, py, 1, 1, buf);
  this._copyAttachment(c, 1);
  this.renderer.readRenderTargetPixels(this._readTarget, px, py, 1, 1, cls);
  if(prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPack);
  return Promise.resolve(pack(buf, cls));
};

//Copy attachment `index` of cascade `c` into _readTarget (see _blitMaterial).
ARestlessOcean.Passes.WaterFieldPass.prototype._copyAttachment = function(c, index){
  const prevRT = this.renderer.getRenderTarget();
  this._blitMaterial.uniforms.uSrc.value = c.target.textures[index];
  this._drawQuad(this._blitMaterial, this._readTarget);
  this.renderer.setRenderTarget(prevRT);
};

//Synchronous full readback of one cascade, both attachments. Debug-only (the
//shore survey and overlay): two 512² float reads stall the GPU. Same
//PIXEL_PACK_BUFFER guard as probeAt, for the same reason.
//Returns {a: Float32Array (level depth flowX flowZ), b: Float32Array (energy
//type shoreSDF dryMask), res, centerX, centerZ, halfWidth, texel} or null.
//Row 0 is the cascade's min-Z edge, column 0 its min-X edge.
ARestlessOcean.Passes.WaterFieldPass.prototype.readCascade = function(index){
  const c = this.cascades[index | 0];
  if(!c || c.centerX === undefined) return null;
  const RES = ARestlessOcean.Passes.WaterFieldPass.RESOLUTION;
  const gl = this.renderer.getContext();
  const canPack = (typeof WebGL2RenderingContext !== 'undefined') && (gl.PIXEL_PACK_BUFFER !== undefined);
  const prevPack = canPack ? gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) : null;
  if(prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const a = new Float32Array(RES * RES * 4);
  const b = new Float32Array(RES * RES * 4);
  this.renderer.readRenderTargetPixels(c.target, 0, 0, RES, RES, a);
  this._copyAttachment(c, 1);
  this.renderer.readRenderTargetPixels(this._readTarget, 0, 0, RES, RES, b);
  if(prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPack);
  return {a: a, b: b, res: RES, centerX: c.centerX, centerZ: c.centerZ,
    halfWidth: c.halfWidth, texel: c.texel};
};

//Pipeline self-test. Renders a KNOWN CONSTANT into cascade 0 and reads it
//straight back, which separates "the fill shader is wrong" from "the fill never
//ran / we are reading uninitialised memory". Returns a Promise of a report
//string. Debug-only; safe to call at any time (it refills the cascade after).
ARestlessOcean.Passes.WaterFieldPass.prototype.selfTest = function(){
  const self = this;
  const c = this.cascades[0];
  if(!c) return Promise.resolve('no cascade 0');
  const mat = this._fillMaterial;
  const prevRT = this.renderer.getRenderTarget();

  //Swap in a constant-writing shader on a throwaway material so the real fill
  //material is untouched.
  const testMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {},
    vertexShader: mat.vertexShader,
    fragmentShader: [
      'precision highp float;',
      'layout(location = 0) out vec4 gA;',
      'layout(location = 1) out vec4 gB;',
      'in vec2 vUv;',
      'void main(){',
      '  gA = vec4(11.0, 22.0, 33.0, 44.0);',
      '  gB = vec4(55.0, 66.0, 77.0, 88.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });
  const mesh = this._fillScene.children[0];
  const realMat = mesh.material;
  mesh.material = testMat;
  this.renderer.setRenderTarget(c.target);
  this.renderer.render(this._fillScene, this._fillCamera);
  this.renderer.setRenderTarget(prevRT);
  mesh.material = realMat;

  const buf = new Float32Array(4);
  return this.renderer.readRenderTargetPixelsAsync(c.target, 10, 10, 1, 1, buf)
    .then(function(){
      testMat.dispose();
      //Force a refill of every cascade on the next tick.
      for(let i = 0; i < self.cascades.length; ++i) self.cascades[i].centerX = undefined;
      const got = Array.prototype.slice.call(buf).join(', ');
      const pass = (buf[0] === 11 && buf[1] === 22 && buf[2] === 33 && buf[3] === 44);
      return (pass ? 'PASS' : 'FAIL') + ' — wrote [11, 22, 33, 44], read back [' + got + ']'
        + (pass ? '' : '  => the MRT write or the readback path is broken, not the fill logic');
    })
    .catch(function(e){
      testMat.dispose();
      return 'FAIL — readback threw: ' + e.message;
    });
};

//Phase 1b parity check: compares the GPU cascade's decoded answer at a world
//position against a-land's own getWaterAt (the CPU contract oracle) at the
//SAME point. WATER-TYPES.md:449-451 treats this as a byte-for-byte
//requirement, not "close enough" — any deltaLevel/deltaDepth beyond float32
//rounding (~1 cm at these magnitudes) is a decode bug in
//water-tile-decode-pass.js, not noise. Debug/console use only.
ARestlessOcean.Passes.WaterFieldPass.prototype.compareAgainstLandTerrain = function(x, z){
  const og = this.oceanGrid;
  if(!og || !og._landTerrainApi) return Promise.resolve('no landTerrainApi discovered');
  //⚠ Ask a-land about the TEXEL CENTRE, not (x, z). probeAt point-samples the
  //texel containing (x, z), whose value was decoded at its centre — up to half
  //a texel away. On this world's ~30° underwater slopes that half texel alone is
  //0.05–0.15 m of depth, which is exactly what the first run of this test
  //reported as "mismatches" (level agreed to the millimetre; depth tracked slope).
  return this.probeAt(x, z).then(function(gpu){
    const cpu = gpu ? og._landTerrainApi.getWaterAt(gpu.texelX, gpu.texelZ) : null;
    return {
      x: x, z: z,
      texelX: gpu ? gpu.texelX : null, texelZ: gpu ? gpu.texelZ : null,
      cpu: cpu,
      gpu: gpu,
      deltaLevel: (cpu && gpu) ? (gpu.level - cpu.level) : null,
      deltaDepth: (cpu && gpu) ? (gpu.depth - cpu.depth) : null
    };
  });
};

ARestlessOcean.Passes.WaterFieldPass.prototype.dispose = function(){
  for(let i = 0; i < this.cascades.length; ++i) this.cascades[i].target.dispose();
  this.cascades.length = 0;
  if(this._fillScene){
    this._fillScene.traverse(function(o){ if(o.isMesh && o.geometry) o.geometry.dispose(); });
  }
  if(this._fillMaterial) this._fillMaterial.dispose();
  if(this._scratch) this._scratch.dispose();
  if(this._jfaTargets){ this._jfaTargets[0].dispose(); this._jfaTargets[1].dispose(); }
  if(this._readTarget) this._readTarget.dispose();
  [this._seedMaterial, this._jfaMaterial, this._composeMaterial, this._blitMaterial]
    .forEach(function(m){ if(m) m.dispose(); });
  if(this._tileDecodePass){ this._tileDecodePass.dispose(); this._tileDecodePass = null; }
};
