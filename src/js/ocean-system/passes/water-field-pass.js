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
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
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
};

//Fixed-resolution cascades — independent of the drawing buffer.
ARestlessOcean.Passes.WaterFieldPass.prototype.resize = function(){};

//Re-centre and re-fill any cascade whose snapped origin moved. ctx:
//{cameraX, cameraZ, seaLevel, waterType, foamMap, foamCameraXZ, foamHalfWidth}
ARestlessOcean.Passes.WaterFieldPass.prototype.tick = function(ctx){
  const u = this._fillMaterial.uniforms;
  const prevRT = this.renderer.getRenderTarget();
  let filled = 0;

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

    this.renderer.setRenderTarget(c.target);
    this.renderer.render(this._fillScene, this._fillCamera);
    filled++;
  }

  if(filled > 0) this.renderer.setRenderTarget(prevRT);
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
  const pack = function(b){
    return {level: b[0], depth: b[1], flowX: b[2], flowZ: b[3], cascade: i};
  };

  if(opts && opts.async){
    this._probeBuf = this._probeBuf || new Float32Array(4);
    return this.renderer.readRenderTargetPixelsAsync(c.target, px, py, 1, 1, this._probeBuf)
      .then(function(){ return pack(self._probeBuf); })
      .catch(function(){ return null; });
  }
  const buf = new Float32Array(4);
  this.renderer.readRenderTargetPixels(c.target, px, py, 1, 1, buf);
  return Promise.resolve(pack(buf));
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

ARestlessOcean.Passes.WaterFieldPass.prototype.dispose = function(){
  for(let i = 0; i < this.cascades.length; ++i) this.cascades[i].target.dispose();
  this.cascades.length = 0;
  if(this._fillScene){
    this._fillScene.traverse(function(o){ if(o.isMesh && o.geometry) o.geometry.dispose(); });
  }
  if(this._fillMaterial) this._fillMaterial.dispose();
};
