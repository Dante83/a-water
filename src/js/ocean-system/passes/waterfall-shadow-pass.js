//── WaterfallShadowPass ─────────────────────────────────────────────────────
//
//THE FALLS' SHADOW (2026-10-03). Sunlight went straight through every waterfall: on a-land pages the
//scene's shadow map is off and a-land's own shadows know only the land, so the curtain lit the mist,
//splash, pool and its own lower face as if it were not there. This is one small sun-aligned OPACITY
//map of the waterfall sheets, the HeroShadowPass pattern (read its header): an orthographic camera
//along the brightest light, fitted round the sheets' bounds and snapped to texels, rendering ONLY the
//sheet mesh through a material of its own (the sheet's own vertex stage, so lumps, sway and wind are
//where they are drawn).
//
//WHAT A SHEET TAKES FROM THE LIGHT. Bubbles scatter forward (g ~ 0.85): most of the sun a white curtain
//intercepts carries on through it, diffused. What does NOT reach whatever is behind is the slab's
//REFLECTANCE, the same two-stream estimate the sheet draws itself with (waterfall-sheet.glsl, keep in
//step): tauB = 1.5 voidFrac / r x the path along the SUN through the sheet, tauR = 0.15 tauB,
//R = tauR / (2 + tauR). So a glassy tongue casts nothing, a white curtain a soft partial shadow
//(27 % at tauB 5) and dense white water nearly a full one. The foam grain is taken at its mean.
//
//THE MAP (RGBA half float, cleared to 1): RGB = transmittance, MULTIPLIED by every sheet layer (blend
//dst x src), so two cascades in line darken twice; A = the depth of the NEAREST sheet toward the light
//(blend MIN). A receiver further from the light than that depth (plus a bias) takes the transmittance;
//nearer, it is lit. One depth: a receiver between two stacked sheets takes both. Fine for a first cut.
//
//RECEIVERS (fallShadowAt(p), spliced with the land light by ARestlessOcean.spliceLandLight): the sheet
//itself (its bowed lip and lower face, overlapping cascades), the mist cones, splash, foam fog, surface
//mist and clouds, and the water's surface, body and seabed light. Sun or moon: the brightest light.
//
//Live: enabled, size, bias (m), margin (m); console fallShadowStats() via stats().

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.WaterfallShadowPass = function(oceanGrid, sheetPass){
  this.oceanGrid = oceanGrid;
  this.sheetPass = sheetPass;
  this.renderer = oceanGrid.renderer;
  this.enabled = true;
  this.size = 1024;
  this.bias = 0.35;       //m: a receiver must be this much further from the light than the sheet (its own thickness)
  this.margin = 4.0;      //m round the sheets' bounds
  this.target = null;
  this.material = null;
  this.active = false;
  this.matrix = new THREE.Matrix4();
  this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1.0);
  this.camera.layers.enableAll();
  this._sunDir = new THREE.Vector3();
  this._center = new THREE.Vector3();
  this._up = new THREE.Vector3();
  this._tmpV = new THREE.Vector3();
  this._range = 1.0;
  this._clear = new THREE.Color(1, 1, 1);
  this._bias = new THREE.Matrix4().set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );
};

//The receiver side, spliced at //LAND_LIGHT_INJECTION_POINT with the land light (stub where this file
//is not loaded: ARestlessOcean.spliceLandLight).
ARestlessOcean.Passes.WaterfallShadowPass.GLSL = [
  '//── The falls\' shadow (passes/waterfall-shadow-pass.js) ──',
  'uniform sampler2D fallShadowMap;   //RGB transmittance through the sheets, A nearest sheet depth toward the light',
  'uniform mat4 fallShadowMatrix;     //world -> [0,1] map uv and depth',
  'uniform vec2 fallShadowParams;     //(on, depth bias in map units)',
  'float fallShadowAt(vec3 p){',
  '  if(fallShadowParams.x < 0.5) return 1.0;',
  '  vec4 c = fallShadowMatrix * vec4(p, 1.0);',
  '  vec3 s = c.xyz / c.w;',
  '  if(any(lessThan(s, vec3(0.0))) || any(greaterThan(s, vec3(1.0)))) return 1.0;',
  '  vec4 m = textureLod(fallShadowMap, s.xy, 0.0);',
  '  return s.z > m.a + fallShadowParams.y ? m.r : 1.0;',
  '}'
].join('\n');
ARestlessOcean.Passes.WaterfallShadowPass.STUB_GLSL = 'float fallShadowAt(vec3 p){ return 1.0; }';

//The caster: the sheet's own vertex stage, and its bubble slab's reflectance along the light.
ARestlessOcean.Passes.WaterfallShadowPass.FRAGMENT = [
  'precision highp float;',
  'uniform float uVoidMax;',
  'uniform float uBubbleRadius;',
  'uniform float uTailBoil;',
  'uniform vec3 fallShadowLight;   //toward the light (unit)',
  'varying vec4 vFlowA;',
  'varying vec4 vFlowB;',
  'varying vec3 vWorldNormal;',
  'void main(){',
  '  float aeration = vFlowB.x, presence = vFlowB.y, airborne = vFlowB.z, thickness = vFlowA.z;',
  '  //waterfall-sheet.glsl\'s void fraction (keep in step), the foam grain at its mean (mix(0.25, 1.75, 0.5) = 1).',
  '  float airWeight = max(airborne, uTailBoil * (1.0 - airborne));',
  '  float voidFrac = uVoidMax * aeration * aeration * airWeight;',
  '  float cosL = abs(dot(normalize(vWorldNormal), fallShadowLight));',
  '  float path = thickness / max(cosL, 0.2);',
  '  float tauR = 0.15 * 1.5 * voidFrac / max(uBubbleRadius, 1e-5) * path;',
  '  float R = tauR / (2.0 + tauR);',
  '  float T = 1.0 - R * clamp(presence, 0.0, 1.0);',
  '  gl_FragColor = vec4(vec3(T), gl_FragCoord.z);',
  '}'
].join('\n');

ARestlessOcean.Passes.WaterfallShadowPass.prototype._ensure = function(){
  const sp = this.sheetPass;
  if(!this.material && sp && sp.material){
    const sm = sp.material;
    //The sheet's OWN uniform objects (same lumps, wind, time), plus the light direction.
    const u = Object.assign({}, sm.uniforms, {fallShadowLight: {value: new THREE.Vector3(0, 1, 0)}});
    this.material = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: sm.vertexShader,
      fragmentShader: ARestlessOcean.Passes.WaterfallShadowPass.FRAGMENT,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      fog: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendEquationAlpha: THREE.MinEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor
    });
  }
  if(!this.target || this.target.width !== this.size){
    if(this.target) this.target.dispose();
    this.target = new THREE.WebGLRenderTarget(this.size, this.size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false
    });
    this.target.texture.generateMipmaps = false;
  }
};

//params: {lightDirection: Vector3, the way the light travels (sun or moon)}
ARestlessOcean.Passes.WaterfallShadowPass.prototype.tick = function(params){
  this.active = false;
  const sp = this.sheetPass;
  if(!this.enabled || !sp || !sp.mesh || !sp.mesh.visible || !params || !params.lightDirection) return;
  const geo = sp.mesh.geometry;
  const idx = geo && geo.index;
  if(!idx || idx.count === 0) return;
  if(!geo.boundingSphere) geo.computeBoundingSphere();
  const bs = geo.boundingSphere;
  if(!bs || !(bs.radius > 0)) return;
  const dir = this._sunDir.copy(params.lightDirection).normalize();
  if(dir.y > -0.02) return;   //light at or below the horizon: nothing to shade
  this._ensure();
  if(!this.material) return;

  const R = bs.radius + this.margin;
  const center = this._center.copy(bs.center).applyMatrix4(sp.mesh.matrixWorld);
  const cam = this.camera;
  cam.up.copy(Math.abs(dir.y) > 0.99 ? this._up.set(0, 0, 1) : this._up.set(0, 1, 0));
  cam.position.copy(center).addScaledVector(dir, -R * 2.0);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  //Snap to whole texels in light space, or the shadow's edges crawl.
  const texel = 2.0 * R / this.size;
  const lc = this._tmpV.copy(center).applyMatrix4(cam.matrixWorldInverse);
  const sx = Math.round(lc.x / texel) * texel - lc.x;
  const sy = Math.round(lc.y / texel) * texel - lc.y;
  cam.left = -R + sx; cam.right = R + sx; cam.bottom = -R + sy; cam.top = R + sy;
  cam.near = R * 0.5;
  //Far enough to hold the receivers below the falls (the pool, the cliff foot), up to the light's slant.
  cam.far = R * 4.0;
  cam.updateProjectionMatrix();
  this._range = cam.far - cam.near;
  this.matrix.copy(this._bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  this.material.uniforms.fallShadowLight.value.copy(dir).negate();

  const r = this.renderer;
  const mesh = sp.mesh;
  const prevRT = r.getRenderTarget();
  const prevMat = mesh.material;
  const prevVis = mesh.visible;
  const prevAutoClear = r.autoClear;
  const prevClear = r.getClearColor(new THREE.Color());
  const prevAlpha = r.getClearAlpha();
  const prevShadowAuto = r.shadowMap ? r.shadowMap.autoUpdate : false;
  const prevXr = r.xr.enabled;
  try {
    mesh.material = this.material;
    mesh.visible = true;
    r.xr.enabled = false;
    if(r.shadowMap) r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.target);
    r.setClearColor(this._clear, 1.0);
    r.clear(true, false, false);
    r.autoClear = false;
    r.render(mesh, cam);
  } finally {
    mesh.material = prevMat;
    mesh.visible = prevVis;
    r.autoClear = prevAutoClear;
    r.setClearColor(prevClear, prevAlpha);
    if(r.shadowMap) r.shadowMap.autoUpdate = prevShadowAuto;
    r.xr.enabled = prevXr;
    r.setRenderTarget(prevRT);
  }
  this.active = true;
};

//Per material that declares the receiver's uniforms (the water's; the sheet and the foot volumes alias them).
ARestlessOcean.Passes.WaterfallShadowPass.prototype.writeUniforms = function(u){
  if(!u.fallShadowParams) return;
  const on = this.active && this.target;
  u.fallShadowParams.value.set(on ? 1.0 : 0.0, this.bias / Math.max(this._range, 1e-3));
  if(!on) return;
  u.fallShadowMap.value = this.target.texture;
  u.fallShadowMatrix.value.copy(this.matrix);
};

ARestlessOcean.Passes.WaterfallShadowPass.prototype.stats = function(){
  return {enabled: this.enabled, active: this.active, size: this.size, rangeM: +this._range.toFixed(1),
          texelM: this.camera ? +((this.camera.right - this.camera.left) / this.size).toFixed(3) : null};
};

ARestlessOcean.Passes.WaterfallShadowPass.prototype.dispose = function(){
  if(this.target) this.target.dispose();
  if(this.material) this.material.dispose();
  this.target = null; this.material = null; this.active = false;
};
