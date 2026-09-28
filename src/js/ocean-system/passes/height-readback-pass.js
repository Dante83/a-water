//── Height readback pass ────────────────────────────────────────────────────
//
//Extracted verbatim from ocean-grid.js (0.2.0 lines 1151-1380 and the
//submersion-probe block at 2798-2874) as part of the Phase 0 decomposition.
//Behaviour is unchanged; see WATER-TYPES-PROGRESS.md for the old-line map.
//
//Everything here answers one question on the CPU: "how high is the RENDERED
//water at this world position?" Both mechanisms in this file are GPU->CPU
//readbacks off the same source (oceanHeightComposer's cascade displacement
//targets), which is why they live together.
//
//1. THE LOCAL HEIGHT FIELD — for buoyancy, splash emission, anything that needs
//   many queries. Once every ~66 ms a tiny GPU pass composites the cascades'
//   height into a 256^2 RT covering a 512 m region that follows the camera, and
//   we async-read just THAT (a few hundred KB, not the 12 MB of full cascade
//   textures). Every query is then a cheap bilinear lookup of the cached field
//   — exact (it IS the rendered surface, so floats ride the water you see) and
//   O(1) per probe regardless of object count. Objects outside the region get
//   null and the caller falls back to the analytic Gerstner twin.
//
//   Triple-buffered: only one read is ever in flight, so 3 buffers guarantee the
//   in-flight write target is neither the current nor the previous snapshot.
//   That is what lets sampleWaterRiseFFT finite-difference two stable fields.
//
//   The field only runs while a consumer asked for it recently
//   (requestFFTSnapshot extends a 1 s window) — it is off when nothing floats.
//
//2. THE SUBMERSION PROBE — one query, every frame, at the camera. Reads two 1-px
//   texels from cascades 0 (4096 m) and 1 (1024 m), which carry the dominant
//   swell; the small cascades add at most decimetre chop and are skipped. This
//   is what drives the air/water swap without it popping under passing crests.
//
//   The read is ASYNC (PBO fence) where supported. A synchronous
//   readRenderTargetPixels drains the ENTIRE GPU command queue before it
//   returns, and that stall grows with GPU load — which is exactly why rotating
//   (more geometry in flight) made the frame freeze. The async result lands a
//   few frames later; the surface moves at swell speed and the swap is smoothed
//   over a 1 m band, so the lag is invisible. A fresh pair of reads is issued
//   only once the previous pair resolves, and the last resolved height is reused
//   every frame in between.
//
//There is also sampleFFTHeightAt: an EXACT synchronous single-texel read that
//stalls the GPU queue. DEBUG ground truth only — see ARestlessOcean.debugWaveAt.
//
//NOTE for Phase 0 commit B: the four `cascadeSpatialOffsets` reads below go
//through oceanGrid.oceanMaterial.uniforms, which in 0.2.0 aliases the MODULE-
//GLOBAL water uniform template rather than per-grid state. Moved verbatim here;
//the cloneUniforms() work fixes all four in one place.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.HeightReadbackPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;

  //Tunables. RES = grid resolution; SIZE = world metres covered, so SIZE/RES is
  //m/texel and caps the smallest wave the field can resolve; INTERVAL_MS is the
  //refresh throttle (waves move slowly so ~15 Hz is plenty — the cached field is
  //reused every frame in between).
  this.HEIGHT_FIELD_RES = 256;
  this.HEIGHT_FIELD_SIZE = 512.0;          //metres; 2 m/texel at res 256.
  this.HEIGHT_FIELD_INTERVAL_MS = 66;      //~15 Hz refresh.

  this._hfSnap = null;            //resolved {data, originX, originZ, size, res, time}.
  this._hfSnapPrev = null;        //prior resolved snapshot, kept for dH/dt (rise).
  this._hfBufs = null;            //triple-buffered readback.
  this._hfBackIdx = 0;
  this._hfPending = false;
  this._hfWantedUntil = 0;        //only run while a consumer asked recently.
  this._hfLastIssue = 0;
  this._hfN = 0;
  this._fftProbeBuf = null;

  this._heightFieldMaterial = null;
  this._heightFieldScene = null;
  this._heightFieldCamera = null;
  this._heightFieldRT = null;

  //Submersion probe state.
  this._probeWaterSurfaceY = undefined;
  this._probePending = false;
  this._probeBuf0 = null;
  this._probeBuf1 = null;
  //Phase 3a: a 1-texel GPU evaluation of the shore breaker + swash at the camera,
  //read back with the two cascade texels (see _renderBreakerProbe).
  this._breakerProbeBuf = null;
  this._breakerProbeRT = null;
  this._breakerProbeScene = null;
  this._breakerProbeMaterial = null;
  this._surfaceProbeBuffer = null;
};

//── Local height-field GPU pass (composite cascades -> small RT) ─────────────
//The fragment shader mirrors the water vertex shader's cascade composition (sum
//each cascade's .y at (worldXZ+offset)/patch), but over a region grid instead of
//mesh vertices, and bakes heightOffset + waveHeightMultiplier in.
ARestlessOcean.Passes.HeightReadbackPass.prototype.init = function(){
  const HF_N = this.oceanGrid.oceanHeightComposer.numCascades;
  const HEIGHT_FIELD_SIZE = this.HEIGHT_FIELD_SIZE;
  const HEIGHT_FIELD_RES = this.HEIGHT_FIELD_RES;

  //Phase 2: each cascade is weighed by WaveMask and the rest level is read per
  //texel from the water field — exactly what water-vertex.glsl does — so a
  //float on a glassy lake does not ride ocean swell, and a region straddling a
  //lake rim is not baked onto one plane.
  const maskSwizzle = ['hfMaskA.x', 'hfMaskA.y', 'hfMaskA.z', 'hfMaskB.x', 'hfMaskB.y', 'hfMaskB.z'];
  let hfSumLines = '';
  for(let c = 0; c < HF_N; c++){
    const w = c < maskSwizzle.length ? maskSwizzle[c] + ' * ' : '';
    hfSumLines += 'dy += ' + w + 'texture(hfCascadeArray, vec3((worldXZ + hfCascadeOffset[' + c + ']) / hfCascadePatch[' + c + '], ' + c + '.0)).y;\n';
  }
  const fieldReady = !!(ARestlessOcean.Passes.WaterFieldPass && ARestlessOcean.WaveMask);
  const reflectionReady = !!(ARestlessOcean.ShoreReflection && ARestlessOcean.ShoreReflection.ENABLED);
  const hfVert = 'varying vec2 vHfUv;\nvoid main(){ vHfUv = uv; gl_Position = vec4(position, 1.0); }';
  const hfFrag = [
    'precision highp float;',
    'varying vec2 vHfUv;',
    //Phase 10: the composer publishes one sampler2DArray rather than HF_N
    //separate maps, so this bake reads a layer per cascade. highp because this
    //is the buoyancy height field, in metres.
    'precision highp sampler2DArray;',
    'uniform sampler2DArray hfCascadeArray;',
    'uniform vec2 hfCascadeOffset[' + HF_N + '];',
    'uniform float hfCascadePatch[' + HF_N + '];',
    'uniform float hfWhm;',
    'uniform float hfHeightOffset;',
    'uniform float hfUseField;',
    'uniform vec2 hfRegionOrigin;',
    'uniform float hfRegionSize;',
    fieldReady ? ARestlessOcean.Passes.WaterFieldPass.SAMPLE_GLSL : '',
    fieldReady ? ARestlessOcean.WaveMask.GLSL : '',
    //Phase 4: flowing water is not the FFT surface (see FlowHandoff). Before
    //ShoreBreaker, whose swash reads it.
    fieldReady ? ARestlessOcean.FlowHandoff.GLSL : 'float flowHandoffWeightAt(vec2 xz){ return 0.0; }\nfloat flowBankSink(vec4 f){ return 0.0; }',
    fieldReady ? ARestlessOcean.ShoreBreaker.GLSL : '',
    //Phase 3b: the shore reflection rides in the same sum.
    reflectionReady ? ARestlessOcean.ShoreReflection.GLSL : 'float shoreReflectionHeightAt(vec2 xz){ return 0.0; }',
    'void main(){',
    '  vec2 worldXZ = hfRegionOrigin + vHfUv * hfRegionSize;',
    '  vec3 hfMaskA = vec3(1.0);',
    '  vec3 hfMaskB = vec3(1.0);',
    '  float level = hfHeightOffset;',
    '  float breaker = 0.0;',
    '  float breakerSpray = 0.0;',
    '  float breakerDir = 0.0;',
    '  float breakerCrest = 0.0;',
    '  float stillKeep = 1.0;',
    //Phase 3a: the breakers and swash ride in the same sum, so floats and splash see
    //them. Fade 1: the bake covers ±256 m, well inside ShoreBreaker.FADE_NEAR. This is
    //shoreBreakerHeightAt unrolled, because the splash emitter also wants the breaker
    //FOAM (it peaks on the breaking front), the shoreward direction and the crest.
    //Readback layout: .r height, .g breaker foam, .b shoreward direction (atan2 of
    //z, x; radians), .a breaker crest height above the level (no swash).
    fieldReady ? [
      '  if(hfUseField > 0.5){',
      '    vec4 field = waterFieldAt(worldXZ);',
      '    level = field.r;',
      '    waveMaskCascades(field, hfMaskA, hfMaskB);',
      //Phase 4, in lockstep with water-vertex.glsl.
      '    stillKeep = 1.0 - flowHandoffWeightAt(worldXZ);',
      //Phase 8e: the bank sink both water surfaces apply (flowBankSink).
      '    level -= (1.0 - stillKeep) * flowBankSink(field);',
      '    hfMaskA *= stillKeep;',
      '    hfMaskB *= stillKeep;',
      '    bool breakerOn = shoreBreakerActive(field);',
      '    bool swashOn = shoreSwashActive(field);',
      '    if(breakerOn || swashOn){',
      '      vec4 sGrad = shoreBreakerSmoothGrad(worldXZ);',
      '      vec4 sPhase = shoreBreakerPhaseField(worldXZ);',
      '      float sBrk; float sXi; float sReach; float sSwashFoam;',
      '      if(breakerOn) breakerCrest = shoreBreakerEval(worldXZ, field, sPhase, sGrad, breakerSpray, sBrk, sXi);',
      '      breaker = breakerCrest;',
      '      if(swashOn) breaker += shoreSwashEval(worldXZ, field, sPhase, sGrad, sReach, sSwashFoam);',
      '      breakerDir = atan(-sGrad.y, -sGrad.x);',
      '      breaker *= stillKeep;',
      '      breakerSpray *= stillKeep;',
      '      breakerCrest *= stillKeep;',
      '    }',
      '  }'
    ].join('\n') : '',
    '  float dy = 0.0;',
    '  ' + hfSumLines,
    '  gl_FragColor = vec4(level + dy * hfWhm + breaker + stillKeep * shoreReflectionHeightAt(worldXZ), breakerSpray, breakerDir, breakerCrest);',
    '}'
  ].join('\n');
  const hfUniforms = {
    hfCascadeArray: {value: null},
    hfCascadeOffset: {value: (function(){ const a = []; for(let i = 0; i < HF_N; i++) a.push(new THREE.Vector2()); return a; })()},
    hfCascadePatch: {value: new Array(HF_N).fill(1.0)},
    hfWhm: {value: 1.0},
    hfHeightOffset: {value: 0.0},
    hfUseField: {value: 0.0},
    hfRegionOrigin: {value: new THREE.Vector2()},
    hfRegionSize: {value: HEIGHT_FIELD_SIZE}
  };
  if(fieldReady){
    Object.assign(hfUniforms, ARestlessOcean.Passes.WaterFieldPass.createSampleUniforms());
    Object.assign(hfUniforms, ARestlessOcean.WaveMask.createUniforms());
    Object.assign(hfUniforms, ARestlessOcean.ShoreBreaker.createUniforms());
    Object.assign(hfUniforms, ARestlessOcean.FlowHandoff.createUniforms());
  }
  if(reflectionReady) Object.assign(hfUniforms, ARestlessOcean.ShoreReflection.createUniforms());
  this._heightFieldMaterial = new THREE.ShaderMaterial({
    uniforms: hfUniforms,
    vertexShader: hfVert,
    fragmentShader: hfFrag,
    depthTest: false,
    depthWrite: false
  });
  this._heightFieldScene = new THREE.Scene();
  this._heightFieldScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._heightFieldMaterial));
  this._heightFieldCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._heightFieldRT = new THREE.WebGLRenderTarget(HEIGHT_FIELD_RES, HEIGHT_FIELD_RES, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat, type: THREE.FloatType,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false
  });
  this._hfN = HF_N;
  this._hfFieldReady = fieldReady;
  this._maskScratch = [1, 1, 1, 1, 1, 1];
};

//Fixed-size field RT — independent of the drawing buffer.
ARestlessOcean.Passes.HeightReadbackPass.prototype.resize = function(){};

//Extend the "a consumer wants this" window. The field is off when nothing floats.
ARestlessOcean.Passes.HeightReadbackPass.prototype.request = function(){
  this._hfWantedUntil = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) + 1000;
};

//EXACT synchronous single-texel readback — DEBUG ground truth only (each call
//stalls the GPU queue). See ARestlessOcean.debugWaveAt.
ARestlessOcean.Passes.HeightReadbackPass.prototype.sampleFFTHeightAt = function(x, z){
  const grid = this.oceanGrid;
  const composer = grid.oceanHeightComposer;
  if(!composer || !composer.cascadeDisplacementArray) return null;
  this._fftProbeBuf = this._fftProbeBuf || new Float32Array(4);
  const buf = this._fftProbeBuf;
  const res = composer.baseTextureWidth;
  const offsets = grid.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
  const whm = composer.waveHeightMultiplier;
  let h = grid.waterLevelAt(x, z);
  const mask = grid.waveMasksAt ? grid.waveMasksAt(x, z, this._maskScratch) : null;
  //Phase 10: one array target, so the cascade is chosen by BINDING ITS LAYER
  //first. readRenderTargetPixels has no layer argument in three r173 — it reads
  //whatever is attached to the target's own framebuffer — but setRenderTarget's
  //second argument attaches the layer to exactly that framebuffer, so binding
  //immediately before the read is exact rather than a trick.
  const prevTarget = this.renderer.getRenderTarget();
  for(let c = 0; c < composer.numCascades; c++){
    const patch = composer._cascadePatchSizes[c];
    let u = (x + offsets[c].x) / patch;
    let v = (z + offsets[c].y) / patch;
    u -= Math.floor(u); v -= Math.floor(v);
    const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
    const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
    this.renderer.setRenderTarget(composer.cascadeDisplacementArray, c);
    this.renderer.readRenderTargetPixels(composer.cascadeDisplacementArray, px, py, 1, 1, buf);
    h += (mask && c < 6 ? mask[c] : 1.0) * buf[1] * whm; //.y (green) = vertical displacement.
  }
  this.renderer.setRenderTarget(prevTarget);
  return h;
};

//Render the field + issue the async readback. Region follows the camera,
//snapped to the texel grid so the sampled field doesn't shimmer as it pans.
ARestlessOcean.Passes.HeightReadbackPass.prototype.updateHeightField = function(){
  const self = this;
  const grid = this.oceanGrid;
  const HEIGHT_FIELD_SIZE = this.HEIGHT_FIELD_SIZE;
  const HEIGHT_FIELD_RES = this.HEIGHT_FIELD_RES;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  if(now > this._hfWantedUntil) return;
  if(this._hfPending) return;
  if(now - this._hfLastIssue < this.HEIGHT_FIELD_INTERVAL_MS) return;
  const composer = grid.oceanHeightComposer;
  if(!composer || !composer.cascadeDisplacementTexture) return;
  if(typeof this.renderer.readRenderTargetPixelsAsync !== 'function') return;

  const texel = HEIGHT_FIELD_SIZE / HEIGHT_FIELD_RES;
  const originX = Math.floor((grid.globalCameraPosition.x - HEIGHT_FIELD_SIZE * 0.5) / texel) * texel;
  const originZ = Math.floor((grid.globalCameraPosition.z - HEIGHT_FIELD_SIZE * 0.5) / texel) * texel;
  const u = this._heightFieldMaterial.uniforms;
  const offsets = grid.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
  u.hfCascadeArray.value = composer.cascadeDisplacementTexture;
  for(let c = 0; c < this._hfN; c++){
    u.hfCascadePatch.value[c] = composer._cascadePatchSizes[c];
    u.hfCascadeOffset.value[c].copy(offsets[c]);
  }
  u.hfWhm.value = composer.waveHeightMultiplier;
  //Fallback level (region centre) for when the field is not bound; with the
  //field bound the bake reads level per texel (Phase 2).
  u.hfHeightOffset.value = grid.waterLevelAt(originX + HEIGHT_FIELD_SIZE * 0.5, originZ + HEIGHT_FIELD_SIZE * 0.5);
  u.hfUseField.value = 0.0;
  if(this._hfFieldReady && grid.waterFieldPass && grid.waterFieldPass.bindUniforms(u)){
    const p = grid.waveMaskParams ? grid.waveMaskParams() : null;
    if(p){
      ARestlessOcean.WaveMask.writeUniforms(u, p);
      const sbp = grid._shoreBreakerParams;
      if(sbp) ARestlessOcean.ShoreBreaker.writeUniforms(u, sbp);
      ARestlessOcean.FlowHandoff.writeUniforms(u, grid._flowHandoffState);
      u.hfUseField.value = 1.0;
    }
  }
  u.hfRegionOrigin.value.set(originX, originZ);
  u.hfRegionSize.value = HEIGHT_FIELD_SIZE;
  if(ARestlessOcean.ShoreReflection){
    ARestlessOcean.ShoreReflection.writeUniforms(u, grid.shoreReflectionPass ? grid.shoreReflectionPass.consumerState() : null);
  }

  const prevRT = this.renderer.getRenderTarget();
  this.renderer.setRenderTarget(this._heightFieldRT);
  this.renderer.render(this._heightFieldScene, this._heightFieldCamera);
  this.renderer.setRenderTarget(prevRT);

  if(!this._hfBufs){
    const sz = HEIGHT_FIELD_RES * HEIGHT_FIELD_RES * 4;
    //Triple-buffered: only one read is ever in flight, so 3 buffers guarantee
    //the in-flight write target is neither the current nor the previous
    //snapshot. That lets us retain a stable PREVIOUS field to finite-difference
    //for surface rise (dH/dt) without the next readback clobbering it mid-transfer.
    this._hfBufs = [new Float32Array(sz), new Float32Array(sz), new Float32Array(sz)];
  }
  const buf = this._hfBufs[this._hfBackIdx];
  this._hfPending = true;
  this._hfLastIssue = now;
  this.renderer.readRenderTargetPixelsAsync(this._heightFieldRT, 0, 0, HEIGHT_FIELD_RES, HEIGHT_FIELD_RES, buf).then(function(){
    self._hfSnapPrev = self._hfSnap; //keep the prior field so consumers can read dH/dt.
    self._hfSnap = {data: buf, originX: originX, originZ: originZ, size: HEIGHT_FIELD_SIZE, res: HEIGHT_FIELD_RES, time: now};
    self._hfBackIdx = (self._hfBackIdx + 1) % 3; //rotate; never reuse current/prev.
    self._hfPending = false;
  }).catch(function(){ self._hfPending = false; });
};

//Bilinear lookup of a GIVEN resolved snapshot's baked height (.x) at world
//(x,z). Returns null outside that snapshot's region. Shared by the cached-height,
//rise and slope samplers so they all read the same field consistently.
ARestlessOcean.Passes.HeightReadbackPass.prototype.sampleSnapHeight = function(s, x, z){
  if(!s) return null;
  const uu = (x - s.originX) / s.size;
  const vv = (z - s.originZ) / s.size;
  if(uu < 0.0 || uu > 1.0 || vv < 0.0 || vv > 1.0) return null;
  const res = s.res, data = s.data;
  const fx = uu * res - 0.5, fy = vv * res - 0.5;
  let x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  let x1 = x0 + 1, y1 = y0 + 1;
  x0 = x0 < 0 ? 0 : (x0 > res - 1 ? res - 1 : x0);
  x1 = x1 < 0 ? 0 : (x1 > res - 1 ? res - 1 : x1);
  y0 = y0 < 0 ? 0 : (y0 > res - 1 ? res - 1 : y0);
  y1 = y1 < 0 ? 0 : (y1 > res - 1 ? res - 1 : y1);
  const h00 = data[(y0 * res + x0) * 4], h10 = data[(y0 * res + x1) * 4];
  const h01 = data[(y1 * res + x0) * 4], h11 = data[(y1 * res + x1) * 4];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * ty;
};

//Phase 3a: breaker state at world (x,z) from the CURRENT snapshot, nearest texel
//(2 m). out = {spray, dirX, dirZ, crest}: spray is the breaker foam (it peaks on
//the breaking front and decays within ~1/14 of a wave cycle behind it), (dirX,
//dirZ) the unit shoreward direction, crest the breaker height above the rest
//level (m). Returns null outside the snapshot or before it resolves.
ARestlessOcean.Passes.HeightReadbackPass.prototype.sampleBreakerSpray = function(x, z, out){
  const s = this._hfSnap;
  if(!s) return null;
  const uu = (x - s.originX) / s.size;
  const vv = (z - s.originZ) / s.size;
  if(uu < 0.0 || uu >= 1.0 || vv < 0.0 || vv >= 1.0) return null;
  const col = Math.floor(uu * s.res), row = Math.floor(vv * s.res);
  const i = (row * s.res + col) * 4;
  out = out || {};
  out.spray = s.data[i + 1];
  const a = s.data[i + 2];
  out.dirX = Math.cos(a);
  out.dirZ = Math.sin(a);
  out.crest = s.data[i + 3];
  return out;
};

//Cheap bilinear lookup of the CURRENT field. Returns null outside the region or
//before the first field resolves -> caller falls back to analytic.
ARestlessOcean.Passes.HeightReadbackPass.prototype.sampleWaterHeightFieldCached = function(x, z){
  return this.sampleSnapHeight(this._hfSnap, x, z);
};

//Phase-correct surface RISE (dH/dt, m/s) at world (x,z): finite difference of
//the two most recent rendered-FFT snapshots — the rendered water's OWN vertical
//velocity. The analytic twin shares the spectrum but not the GPU's phases, so
//its "rising here?" answer fired spray over visibly-flat/trough water (the
//bunched, mistimed shore bursts). Returns null until two snapshots exist or
//outside the region -> caller falls back to the analytic rate.
ARestlessOcean.Passes.HeightReadbackPass.prototype.sampleRise = function(x, z){
  const cur = this._hfSnap, prev = this._hfSnapPrev;
  if(!cur || !prev) return null;
  const dt = (cur.time - prev.time) / 1000.0;
  if(dt <= 1e-4) return null;
  const hc = this.sampleSnapHeight(cur, x, z);
  const hp = this.sampleSnapHeight(prev, x, z);
  if(hc === null || hp === null) return null;
  return (hc - hp) / dt;
};

//Phase-correct STEEPNESS (1 - normal.y) at world (x,z) from the rendered-FFT
//height field's OWN slope (central differences, one texel eps). Same motivation
//as the rise sampler: the analytic normal peaks on phantom crests, so mist tore
//off flat water. Returns null outside the region -> caller falls back to analytic.
ARestlessOcean.Passes.HeightReadbackPass.prototype.sampleSlope = function(x, z){
  const s = this._hfSnap;
  if(!s) return null;
  const eps = s.size / s.res; //one texel (~2 m).
  const hxp = this.sampleSnapHeight(s, x + eps, z);
  const hxn = this.sampleSnapHeight(s, x - eps, z);
  const hzp = this.sampleSnapHeight(s, x, z + eps);
  const hzn = this.sampleSnapHeight(s, x, z - eps);
  if(hxp === null || hxn === null || hzp === null || hzn === null) return null;
  const dhdx = (hxp - hxn) / (2.0 * eps);
  const dhdz = (hzp - hzn) / (2.0 * eps);
  const ny = 1.0 / Math.sqrt(1.0 + dhdx * dhdx + dhdz * dhdz);
  return 1.0 - ny;
};

//── Breaker probe (Phase 3a) ───────────────────────────────────────────────
//The submersion probe summed only the rest level and cascades 0-1, so inside a
//surf zone it answered a surface up to a metre away from the one being drawn:
//the air/water swap, the underwater fog plane, the caustic projector and the
//mirror's clip plane all followed a surface without its breakers or swash
//(Phase 3a browser round 1: "can't see the breakers from underwater", and a
//twitchy waterline). This renders the SAME shoreBreakerHeightAt the water vertex
//shader calls, at the camera, into a 1x1 float target, so the probe cannot
//drift from the geometry. Fade 1: the camera is where the geometry fade is 1.
//Returns false when there is nothing to evaluate (breakers off, no field).
ARestlessOcean.Passes.HeightReadbackPass.prototype._renderBreakerProbe = function(){
  const grid = this.oceanGrid;
  const sbp = grid._shoreBreakerParams;
  if(!this._hfFieldReady || !ARestlessOcean.ShoreBreaker || !sbp || !sbp.enabled) return false;
  if(!grid.waterFieldPass) return false;
  if(!this._breakerProbeMaterial){
    const reflectionReady = !!(ARestlessOcean.ShoreReflection && ARestlessOcean.ShoreReflection.ENABLED);
    const uniforms = Object.assign({probeXZ: {value: new THREE.Vector2()}},
      ARestlessOcean.Passes.WaterFieldPass.createSampleUniforms(),
      ARestlessOcean.ShoreBreaker.createUniforms(),
      reflectionReady ? ARestlessOcean.ShoreReflection.createUniforms() : {});
    this._breakerProbeMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: 'void main(){ gl_Position = vec4(position, 1.0); }',
      fragmentShader: [
        'precision highp float;',
        'uniform vec2 probeXZ;',
        ARestlessOcean.Passes.WaterFieldPass.SAMPLE_GLSL,
        ARestlessOcean.FlowHandoff.GLSL,
        ARestlessOcean.ShoreBreaker.GLSL,
        reflectionReady ? ARestlessOcean.ShoreReflection.GLSL : 'float shoreReflectionHeightAt(vec2 xz){ return 0.0; }',
        'void main(){',
        '  gl_FragColor = vec4(shoreBreakerHeightAt(probeXZ, waterFieldAt(probeXZ), 1.0) + shoreReflectionHeightAt(probeXZ), 0.0, 0.0, 1.0);',
        '}'
      ].join('\n'),
      depthTest: false,
      depthWrite: false
    });
    this._breakerProbeScene = new THREE.Scene();
    this._breakerProbeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._breakerProbeMaterial));
    this._breakerProbeRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: THREE.FloatType,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false
    });
  }
  const u = this._breakerProbeMaterial.uniforms;
  if(!grid.waterFieldPass.bindUniforms(u)) return false;
  ARestlessOcean.ShoreBreaker.writeUniforms(u, sbp);
  if(ARestlessOcean.ShoreReflection){
    ARestlessOcean.ShoreReflection.writeUniforms(u, grid.shoreReflectionPass ? grid.shoreReflectionPass.consumerState() : null);
  }
  u.probeXZ.value.set(grid.globalCameraPosition.x, grid.globalCameraPosition.z);
  const prevRT = this.renderer.getRenderTarget();
  this.renderer.setRenderTarget(this._breakerProbeRT);
  this.renderer.render(this._breakerProbeScene, this._heightFieldCamera);
  this.renderer.setRenderTarget(prevRT);
  return true;
};

//── Underwater submersion probe ────────────────────────────────────────────
//Returns the wave-displaced water surface Y at the camera. See the module
//header for the async-vs-blocking rationale.
ARestlessOcean.Passes.HeightReadbackPass.prototype.probeWaterSurfaceY = function(){
  const self = this;
  const grid = this.oceanGrid;
  const composer = grid.oceanHeightComposer;
  const probeReady = composer && composer.cascadeDisplacementArray && composer.numCascades > 1;
  const canAsyncProbe = typeof this.renderer.readRenderTargetPixelsAsync === 'function';
  if(this._probeWaterSurfaceY === undefined){ this._probeWaterSurfaceY = grid.waterLevelAt(grid.globalCameraPosition.x, grid.globalCameraPosition.z); }
  let waterSurfaceY = this._probeWaterSurfaceY;

  if(probeReady && canAsyncProbe){
    if(!this._probePending){
      this._probePending = true;
      this._probeBuf0 = this._probeBuf0 || new Float32Array(4);
      this._probeBuf1 = this._probeBuf1 || new Float32Array(4);
      const bufs = [this._probeBuf0, this._probeBuf1];
      const res = composer.baseTextureWidth;
      const offsets = grid.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
      const whm = composer.waveHeightMultiplier;
      const promises = [];
      //Draw the breaker probe BEFORE issuing any async read: three r173 leaves the
      //pixel-pack buffer bound across readRenderTargetPixelsAsync's await, so keep
      //every draw of this pass ahead of the reads (NEARSHORE-WAVES.md § 5.7).
      const breakerProbeDrawn = this._renderBreakerProbe();
      //Phase 10: cascades 0 and 1 are layers of one array target, so each read is
      //preceded by binding its layer. readRenderTargetPixelsAsync issues its
      //readPixels synchronously (only the fence is awaited), so the layer bound at
      //issue time is the layer that gets captured — rebinding for the next cascade
      //cannot disturb a read already in flight.
      const prevProbeTarget = this.renderer.getRenderTarget();
      for(let c = 0; c < 2; ++c){
        const patch = composer._cascadePatchSizes[c];
        let u = (grid.globalCameraPosition.x + offsets[c].x) / patch;
        let v = (grid.globalCameraPosition.z + offsets[c].y) / patch;
        u -= Math.floor(u);
        v -= Math.floor(v);
        const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
        const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
        const rt = composer.cascadeDisplacementArray;
        this.renderer.setRenderTarget(rt, c);
        promises.push(this.renderer.readRenderTargetPixelsAsync(rt, px, py, 1, 1, bufs[c]));
      }
      this.renderer.setRenderTarget(prevProbeTarget);
      //Phase 3a: breaker + swash at the camera, from the same GLSL as the geometry.
      this._breakerProbeBuf = this._breakerProbeBuf || new Float32Array(4);
      const breakerBuf = this._breakerProbeBuf;
      breakerBuf[0] = 0.0;
      if(breakerProbeDrawn){
        promises.push(this.renderer.readRenderTargetPixelsAsync(this._breakerProbeRT, 0, 0, 1, 1, breakerBuf));
      }
      Promise.all(promises).then(function(){
        //.y (green) channel = vertical displacement, summed over both cascades,
        //each weighed by its wave mask at the camera (Phase 2).
        const gx = grid.globalCameraPosition.x, gz = grid.globalCameraPosition.z;
        const m = grid.waveMasksAt ? grid.waveMasksAt(gx, gz, self._maskScratch) : [1, 1];
        self._probeWaterSurfaceY = grid.waterLevelAt(gx, gz)
          + (m[0] * self._probeBuf0[1] + m[1] * self._probeBuf1[1]) * whm
          + breakerBuf[0];
        self._probePending = false;
      }).catch(function(){ self._probePending = false; });
    }
    //waterSurfaceY already holds the last resolved value (set above).
  } else if(probeReady){
    //Blocking fallback (original behaviour) — renderers without async readback.
    this._surfaceProbeBuffer = this._surfaceProbeBuffer || new Float32Array(4);
    const buf = this._surfaceProbeBuffer;
    const res = composer.baseTextureWidth;
    const offsets = grid.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
    const whm = composer.waveHeightMultiplier;
    waterSurfaceY = grid.waterLevelAt(grid.globalCameraPosition.x, grid.globalCameraPosition.z);
    const prevProbeTarget = this.renderer.getRenderTarget();
    const mask = grid.waveMasksAt
      ? grid.waveMasksAt(grid.globalCameraPosition.x, grid.globalCameraPosition.z, this._maskScratch) : [1, 1];
    for(let c = 0; c < 2; ++c){
      const patch = composer._cascadePatchSizes[c];
      let u = (grid.globalCameraPosition.x + offsets[c].x) / patch;
      let v = (grid.globalCameraPosition.z + offsets[c].y) / patch;
      u -= Math.floor(u);
      v -= Math.floor(v);
      const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
      const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
      const rt = composer.cascadeDisplacementArray;
      this.renderer.setRenderTarget(rt, c);   //Phase 10: pick the cascade's layer.
      this.renderer.readRenderTargetPixels(rt, px, py, 1, 1, buf);
      waterSurfaceY += mask[c] * buf[1] * whm;   //.y (green) channel = vertical displacement
    }
    this.renderer.setRenderTarget(prevProbeTarget);
    if(this._renderBreakerProbe()){
      this.renderer.readRenderTargetPixels(this._breakerProbeRT, 0, 0, 1, 1, buf);
      waterSurfaceY += buf[0];
    }
    this._probeWaterSurfaceY = waterSurfaceY;
  }
  return waterSurfaceY;
};

//── The exact surface at the camera (Phase 8e, the waterline) ──────────────
//A point probe under the camera (the drawn surface to the millimetre, see the probes
//below), carried forward on its own rise over the read's age, so the air/water
//decision is made against the water on screen and not a frame or two behind it. null
//until it has resolved, or once it is older than CAMERA_PROBE_MAX_AGE (the caller keeps
//probeWaterSurfaceY's answer then).
//Oldest camera probe read still trusted (s). Headless runs at ~1 fps; raise it there.
ARestlessOcean.Passes.HeightReadbackPass.CAMERA_PROBE_MAX_AGE = 0.3;
ARestlessOcean.Passes.HeightReadbackPass.prototype.exactCameraSurfaceY = function(){
  const c = this.oceanGrid.globalCameraPosition;
  if(!c) return null;
  const r = this.probeSurface('__aro_camera__', c.x, c.z);
  if(!r) return null;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const age = (now - r.time) / 1000.0;
  if(!(age >= 0.0) || age > ARestlessOcean.Passes.HeightReadbackPass.CAMERA_PROBE_MAX_AGE) return null;
  //Carried at most 0.1 s at most 3 m/s: vy is a finite difference between reads, and
  //carried over a long age it threw the decision tens of centimetres off (headless: 13 m).
  const vy = Math.max(-3.0, Math.min(3.0, r.vy));
  //Without the dynamic ripples (rings, wakes, a swimmer's idle rings right beside the lens):
  //they are the water's texture, not which medium the camera is in, and at 3-5 Hz they
  //flipped the whole frame back and forth at the cusp (Dante 2026-09-27: Liam and the world
  //flashing white/dark while the lens straddled the surface).
  return r.y - (r.ripple || 0.0) + vy * Math.min(age, 0.1);
};

//── Surface point probes (Phase 8, for bodies IN the water) ──────────────────
//The local height field is 2 m a texel, bakes each texel's height at its REST
//position, and refreshes at ~15 Hz. That is right for spray and many floats,
//and wrong for one body a camera is looking at: a calm sea is all short waves
//the field cannot resolve, the drawn surface is pushed sideways by chop (the
//height above a point came from somewhere else), and nothing in it says which
//way the water is MOVING. A swimmer read it and sat still in water that moved
//around him (2026-09-27).
//
//A probe is one named point, evaluated by the SAME displacement sum as
//water-vertex.glsl (all cascades, masks, distance fades, chop, breakers, the
//shore reflection, the field level) into a 16x2 float target, every frame:
//  row 0  the rest point P0 whose displaced particle lands on the query point
//         (fixed-point inversion of P = P0 + D(P0)), and the drawn height there.
//  row 1  where the particle from LAST read's P0 is now. Against last read's
//         query point, that is the drawn water's own particle velocity: the
//         orbit that should carry a floating body, in the rendered phase.
//Phase 8e: the drawn surface includes DynamicWaves rings and wakes, filtered
//exactly as the clipmap vertex filters them near the camera, so the height (row
//0 .r) carries them and row 0 .a says how much of it they are (result.ripple).
//The velocity (row 1) leaves them out: an interactor's own crater springing back
//read as the water rushing up at it, a new entry, a new crater.
ARestlessOcean.Passes.HeightReadbackPass.PROBE_MAX = 16;
ARestlessOcean.Passes.HeightReadbackPass.PROBE_EXPIRE_MS = 1000;

//── The drawn surface as GLSL (shared) ─────────────────────────────────────
//surfaceAt(xz) exactly as water-vertex.glsl builds the surface, for the point
//probes below and for anything else that must agree with the drawn water to the
//millimetre (Phase 8e: the waterline overlay, WaterlinePass). surfaceGLSL() returns
//the declarations + surfaceAt; createSurfaceUniforms() a fresh uniform set for a
//material that splices it; bindSurfaceUniforms(u, x, z) fills one each frame (x, z:
//where spHeightOffset, the standalone level, is taken).
ARestlessOcean.Passes.HeightReadbackPass.prototype._surfaceSetup = function(){
  if(this._surfSetup) return this._surfSetup;
  const HF_N = this._hfN;
  const fieldReady = this._hfFieldReady;
  const reflectionReady = !!(ARestlessOcean.ShoreReflection && ARestlessOcean.ShoreReflection.ENABLED);
  const breakerReady = fieldReady && !!ARestlessOcean.ShoreBreaker;
  const DW = ARestlessOcean.DynamicWaves;
  const rippleReady = !!(DW && DW.ENABLED && this.oceanGrid.dynamicWavesPass && this.oceanGrid.dynamicWavesMesh);
  //The distance fades of water-vertex.glsl, cascade by cascade (0 and 1 unfaded).
  const FADE = [0.0, 0.0, 50.0, 100.0, 250.0, 500.0];
  const maskSwizzle = ['mA.x', 'mA.y', 'mA.z', 'mB.x', 'mB.y', 'mB.z'];
  let sum = '';
  for(let c = 0; c < HF_N; c++){
    const m = c < maskSwizzle.length ? maskSwizzle[c] + ' * ' : '';
    const f = (c < FADE.length && FADE[c] > 0.0) ? 'smoothstep(spCascadePatch[' + c + '] * ' + FADE[c].toFixed(1) + ', 0.0, dist) * ' : '';
    //textureLod 0, not texture: neighbouring pixels here are unrelated points, so
    //texture()'s derivatives picked the coarsest mip, where displacement averages
    //to nothing. The water vertex samples level 0 (vertex shaders have no LOD).
    sum += '  d += ' + m + f + 'textureLod(spCascadeArray, vec3((xz + spCascadeOffset[' + c + ']) / spCascadePatch[' + c + '], ' + c + '.0), 0.0).xyz;\n';
  }
  const glsl = [
    'precision highp float;',
    'precision highp sampler2DArray;',
    'uniform sampler2DArray spCascadeArray;',
    'uniform vec2 spCascadeOffset[' + HF_N + '];',
    'uniform float spCascadePatch[' + HF_N + '];',
    'uniform float spWhm;',
    'uniform float spChop;',
    'uniform float spHeightOffset;',
    'uniform float spUseField;',
    'uniform vec3 spCamPos;',
    fieldReady ? ARestlessOcean.Passes.WaterFieldPass.SAMPLE_GLSL : '',
    fieldReady ? ARestlessOcean.WaveMask.GLSL : '',
    fieldReady ? ARestlessOcean.FlowHandoff.GLSL : 'float flowHandoffWeightAt(vec2 xz){ return 0.0; }\nfloat flowBankSink(vec4 f){ return 0.0; }',
    breakerReady ? ARestlessOcean.ShoreBreaker.GLSL : '',
    reflectionReady ? ARestlessOcean.ShoreReflection.GLSL : 'float shoreReflectionHeightAt(vec2 xz){ return 0.0; }',
    rippleReady ? DW.GLSL : DW ? DW.STUB_GLSL : 'float dynamicWavesVertexHeightAt(vec2 xz, float cell){ return 0.0; }\nfloat dynamicWavesMeshCellAt(vec2 xz, vec2 c){ return 0.0; }',
    //Displacement of the rest point xz (chop applied), and its height with
    //level + breaker + reflection + dynamic ripple, exactly as the water vertex
    //builds it; .w is the ripple alone.
    'vec4 surfaceAt(vec2 xz){',
    '  vec3 mA = vec3(1.0);',
    '  vec3 mB = vec3(1.0);',
    '  float level = spHeightOffset;',
    '  float extra = 0.0;',
    fieldReady ? [
      '  if(spUseField > 0.5){',
      '    vec4 field = waterFieldAt(xz);',
      '    level = field.r;',
      '    waveMaskCascades(field, mA, mB);',
      '    float keep = 1.0 - flowHandoffWeightAt(xz);',
      '    mA *= keep; mB *= keep;',
      breakerReady ? '    extra = keep * (shoreBreakerHeightAt(xz, field, 1.0) + shoreReflectionHeightAt(xz));'
                   : '    extra = keep * shoreReflectionHeightAt(xz);',
      //Phase 8e: the bank sink both surfaces apply (flowBankSink), so a body at a creek
      //mouth or bank wades on the surface that is drawn there.
      '    extra -= (1.0 - keep) * flowBankSink(field);',
      '  }'
    ].join('\n') : '',
    '  float dist = distance(spCamPos, vec3(xz.x, level, xz.y));',
    '  vec3 d = vec3(0.0);',
    sum,
    '  d *= spWhm;',
    '  d.x *= -spChop;',
    '  d.z *= -spChop;',
    '  float ripple = dynamicWavesVertexHeightAt(xz, dynamicWavesMeshCellAt(xz, spCamPos.xz));',
    '  return vec4(d.x, level + d.y + extra + ripple, d.z, ripple);',
    '}',
  ].join('\n');
  this._surfSetup = {glsl: glsl, fieldReady: fieldReady, breakerReady: breakerReady,
                     reflectionReady: reflectionReady, rippleReady: rippleReady};
  return this._surfSetup;
};

ARestlessOcean.Passes.HeightReadbackPass.prototype.surfaceGLSL = function(){
  return this._surfaceSetup().glsl;
};

ARestlessOcean.Passes.HeightReadbackPass.prototype.createSurfaceUniforms = function(){
  const st = this._surfaceSetup();
  const HF_N = this._hfN;
  const DW = ARestlessOcean.DynamicWaves;
  const fieldReady = st.fieldReady, breakerReady = st.breakerReady, reflectionReady = st.reflectionReady, rippleReady = st.rippleReady;
  const uniforms = {
    spCascadeArray: {value: null},
    spCascadeOffset: {value: (function(){ const a = []; for(let i = 0; i < HF_N; i++) a.push(new THREE.Vector2()); return a; })()},
    spCascadePatch: {value: new Array(HF_N).fill(1.0)},
    spWhm: {value: 1.0},
    spChop: {value: 1.0},
    spHeightOffset: {value: 0.0},
    spUseField: {value: 0.0},
    spCamPos: {value: new THREE.Vector3()}
  };
  if(fieldReady){
    Object.assign(uniforms, ARestlessOcean.Passes.WaterFieldPass.createSampleUniforms());
    Object.assign(uniforms, ARestlessOcean.WaveMask.createUniforms());
    Object.assign(uniforms, ARestlessOcean.FlowHandoff.createUniforms());
    if(breakerReady) Object.assign(uniforms, ARestlessOcean.ShoreBreaker.createUniforms());
  }
  if(reflectionReady) Object.assign(uniforms, ARestlessOcean.ShoreReflection.createUniforms());
  if(rippleReady){
    Object.assign(uniforms, DW.createUniforms());
    uniforms.dynamicWavesMeshCell.value = this.oceanGrid.dynamicWavesMesh.cell;
    uniforms.dynamicWavesMeshRing.value = this.oceanGrid.dynamicWavesMesh.ring;
  } else if(DW){
    Object.assign(uniforms, {dynamicWavesEnabled: {value: 0.0}, dynamicWavesCenter: {value: new THREE.Vector2()}, dynamicWavesHalfWidth: {value: 1.0}});
  }
  return uniforms;
};

//Fill the shared surface uniforms for this frame. False when the FFT is not up yet.
ARestlessOcean.Passes.HeightReadbackPass.prototype.bindSurfaceUniforms = function(u, refX, refZ){
  const grid = this.oceanGrid;
  const composer = grid.oceanHeightComposer;
  if(!composer || !composer.cascadeDisplacementTexture) return false;
  const offsets = grid.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
  u.spCascadeArray.value = composer.cascadeDisplacementTexture;
  for(let c = 0; c < this._hfN; c++){
    u.spCascadePatch.value[c] = composer._cascadePatchSizes[c];
    u.spCascadeOffset.value[c].copy(offsets[c]);
  }
  u.spWhm.value = composer.waveHeightMultiplier;
  //The grid's own chop (ocean-grid.js writes data.chop into each water mesh), not
  //the shared template's default.
  u.spChop.value = (grid.data && grid.data.chop !== undefined) ? grid.data.chop
    : (grid.oceanMaterial.uniforms.chop ? grid.oceanMaterial.uniforms.chop.value : 1.0);
  u.spCamPos.value.copy(grid.globalCameraPosition);
  u.spHeightOffset.value = grid.waterLevelAt(refX, refZ);
  u.spUseField.value = 0.0;
  if(this._hfFieldReady && grid.waterFieldPass && grid.waterFieldPass.bindUniforms(u)){
    const wp = grid.waveMaskParams ? grid.waveMaskParams() : null;
    if(wp){
      ARestlessOcean.WaveMask.writeUniforms(u, wp);
      const sbp = grid._shoreBreakerParams;
      if(sbp && ARestlessOcean.ShoreBreaker && u.shoreBreakerEnabled !== undefined) ARestlessOcean.ShoreBreaker.writeUniforms(u, sbp);
      ARestlessOcean.FlowHandoff.writeUniforms(u, grid._flowHandoffState);
      u.spUseField.value = 1.0;
    }
  }
  if(ARestlessOcean.ShoreReflection && ARestlessOcean.ShoreReflection.ENABLED && u.shoreReflectionEnabled){
    ARestlessOcean.ShoreReflection.writeUniforms(u, grid.shoreReflectionPass ? grid.shoreReflectionPass.consumerState() : null);
  }
  if(this._surfaceSetup().rippleReady && u.dynamicWavesMeshCell){
    ARestlessOcean.DynamicWaves.writeUniforms(u, grid.dynamicWavesPass.consumerState());
  }
  return true;
};

ARestlessOcean.Passes.HeightReadbackPass.prototype._initSurfaceProbe = function(){
  const MAX = ARestlessOcean.Passes.HeightReadbackPass.PROBE_MAX;
  const frag = [
    this.surfaceGLSL(),
    'uniform vec4 spProbe[' + MAX + '];',   //xy query point, zw last read's rest point
    'void main(){',
    '  int i = int(gl_FragCoord.x);',
    '  vec4 p = spProbe[i];',
    '  if(gl_FragCoord.y < 1.0){',
    '    vec2 p0 = p.xy;',
    '    for(int k = 0; k < 4; k++){ p0 = p.xy - surfaceAt(p0).xz; }',
    '    vec4 s0 = surfaceAt(p0);',
    '    gl_FragColor = vec4(s0.y, p0, s0.w);',
    '  } else {',
    '    vec4 s = surfaceAt(p.zw);',
    '    gl_FragColor = vec4(s.y - s.w, p.zw + s.xz, 1.0);',
    '  }',
    '}'
  ].join('\n');
  const uniforms = this.createSurfaceUniforms();
  const probes = [];
  for(let i = 0; i < MAX; i++) probes.push(new THREE.Vector4());
  uniforms.spProbe = {value: probes};
  this._spMaterial = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: 'void main(){ gl_Position = vec4(position, 1.0); }',
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false
  });
  this._spScene = new THREE.Scene();
  this._spScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._spMaterial));
  this._spRT = new THREE.WebGLRenderTarget(MAX, 2, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat, type: THREE.FloatType,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false
  });
  this._spBuf = new Float32Array(MAX * 2 * 4);
  this._spPending = false;
  this._spIssued = null;        //the slots as they were when the in-flight read was drawn
};

//Register (or move) probe `key` to (x, z) and return its latest result, or null
//until one has resolved. The result object is the probe's own and is updated in
//place: {y, vx, vy, vz, ripple, time}. y is the drawn surface above the point the probe
//stood on when it was ISSUED (time, performance.now() ms); v is the drawn water's
//particle velocity there (m/s), 0 until two reads exist. A probe nobody asks
//about for PROBE_EXPIRE_MS is dropped.
ARestlessOcean.Passes.HeightReadbackPass.prototype.probeSurface = function(key, x, z){
  if(!this._spProbes) this._spProbes = new Map();
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  let p = this._spProbes.get(key);
  if(!p){
    if(this._spProbes.size >= ARestlessOcean.Passes.HeightReadbackPass.PROBE_MAX) return null;
    p = {x: x, z: z, asked: now, p0x: x, p0z: z, has0: false, lastX: 0, lastZ: 0, lastY: 0, lastT: 0,
         result: null};
    this._spProbes.set(key, p);
  }
  p.x = x; p.z = z; p.asked = now;
  return p.result;
};

ARestlessOcean.Passes.HeightReadbackPass.prototype._renderSurfaceProbe = function(){
  if(!this._spProbes || this._spProbes.size === 0 || this._spPending) return false;
  const grid = this.oceanGrid;
  const composer = grid.oceanHeightComposer;
  if(!composer || !composer.cascadeDisplacementTexture) return false;
  if(typeof this.renderer.readRenderTargetPixelsAsync !== 'function') return false;
  if(!this._spMaterial) this._initSurfaceProbe();
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const expire = ARestlessOcean.Passes.HeightReadbackPass.PROBE_EXPIRE_MS;
  for(const [k, p] of this._spProbes){ if(now - p.asked > expire) this._spProbes['delete'](k); }
  if(this._spProbes.size === 0) return false;

  const u = this._spMaterial.uniforms;
  const issued = [];
  let i = 0;
  for(const p of this._spProbes.values()){
    //The first read has no rest point yet: invert from the query point itself.
    u.spProbe.value[i].set(p.x, p.z, p.has0 ? p.p0x : p.x, p.has0 ? p.p0z : p.z);
    issued.push({probe: p, x: p.x, z: p.z, hadP0: p.has0});
    i++;
  }
  this.bindSurfaceUniforms(u, issued[0].x, issued[0].z);
  const prevRT = this.renderer.getRenderTarget();
  this.renderer.setRenderTarget(this._spRT);
  this.renderer.render(this._spScene, this._heightFieldCamera);
  this.renderer.setRenderTarget(prevRT);
  this._spIssued = {slots: issued, time: now};
  return true;
};

ARestlessOcean.Passes.HeightReadbackPass.prototype._readSurfaceProbe = function(){
  const self = this;
  const MAX = ARestlessOcean.Passes.HeightReadbackPass.PROBE_MAX;
  const issued = this._spIssued;
  const buf = this._spBuf;
  this._spPending = true;
  this.renderer.readRenderTargetPixelsAsync(this._spRT, 0, 0, MAX, 2, buf).then(function(){
    self._spPending = false;
    const t = issued.time;
    for(let i = 0; i < issued.slots.length; i++){
      const s = issued.slots[i], p = s.probe;
      const r0 = i * 4, r1 = (MAX + i) * 4;
      const y = buf[r0];
      if(!isFinite(y)) continue;
      const ripple = isFinite(buf[r0 + 3]) ? buf[r0 + 3] : 0.0;
      const res = p.result || (p.result = {y: 0, vx: 0, vy: 0, vz: 0, ripple: 0, time: 0});
      //Row 1 is last read's particle, now. Last read's particle was AT last
      //read's query point, at last read's height. The difference is its path.
      if(s.hadP0 && p.lastT > 0 && t > p.lastT){
        const dt = (t - p.lastT) / 1000.0;
        res.vx = (buf[r1 + 1] - p.lastX) / dt;
        res.vy = (buf[r1] - p.lastY) / dt;
        res.vz = (buf[r1 + 2] - p.lastZ) / dt;
      }
      res.y = y;
      res.ripple = ripple;
      res.time = t;
      p.p0x = buf[r0 + 1]; p.p0z = buf[r0 + 2]; p.has0 = true;
      //Ripple-free, like row 1 (see the header).
      p.lastX = s.x; p.lastZ = s.z; p.lastY = y - ripple; p.lastT = t;
    }
  }).catch(function(){ self._spPending = false; });
};

//Per-frame entry: refresh the local field (no-ops unless something asked for it).
//The submersion probe is called separately from OceanGrid.tick because its
//result feeds the underwater state machine mid-tick.
//three r173 leaves the pixel-pack buffer bound across readRenderTargetPixelsAsync's
//await, so every draw goes ahead of every read (NEARSHORE-WAVES.md § 5.7).
ARestlessOcean.Passes.HeightReadbackPass.prototype.tick = function(){
  const probeDrawn = this._renderSurfaceProbe();
  this.updateHeightField();
  if(probeDrawn) this._readSurfaceProbe();
};

//Install the public ARestlessOcean.sampleWater* surface. Consumers call
//requestFFTSnapshot() each frame they want the field kept warm.
//Phase 8: WaterState.install (field/water-state.js) then replaces
//sampleWaterHeightFFT with a shim over getWaterStateAt — same answer, same
//0.2.0 signature. The rest here are shape queries and stay as they are.
ARestlessOcean.Passes.HeightReadbackPass.prototype.installGlobalAPI = function(){
  const self = this;
  ARestlessOcean.requestFFTSnapshot = function(){ self.request(); };
  ARestlessOcean.sampleWaterHeightFFT = function(x, z){ return self.sampleWaterHeightFieldCached(x, z); };
  ARestlessOcean.sampleWaterHeightFFTExact = function(x, z){ return self.sampleFFTHeightAt(x, z); };
  ARestlessOcean.sampleWaterRiseFFT = function(x, z){ return self.sampleRise(x, z); };
  ARestlessOcean.sampleWaterSlopeFFT = function(x, z){ return self.sampleSlope(x, z); };
  ARestlessOcean.sampleBreakerSprayFFT = function(x, z, out){ return self.sampleBreakerSpray(x, z, out); };
};

ARestlessOcean.Passes.HeightReadbackPass.prototype.dispose = function(){
  if(this._heightFieldScene){
    this._heightFieldScene.traverse(function(obj){
      if(obj.isMesh && obj.geometry) obj.geometry.dispose();
    });
  }
  if(this._heightFieldMaterial) this._heightFieldMaterial.dispose();
  if(this._heightFieldRT) this._heightFieldRT.dispose();
  if(this._breakerProbeMaterial) this._breakerProbeMaterial.dispose();
  if(this._breakerProbeRT) this._breakerProbeRT.dispose();
  if(this._spMaterial) this._spMaterial.dispose();
  if(this._spRT) this._spRT.dispose();
  this._spMaterial = null;
  this._spRT = null;
  this._spProbes = null;
  this._breakerProbeMaterial = null;
  this._breakerProbeRT = null;
  this._heightFieldRT = null;
  this._hfBufs = null;
  this._hfSnap = null;
  this._hfSnapPrev = null;
};
