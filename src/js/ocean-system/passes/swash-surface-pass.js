//── SwashSurfacePass (WATER-TYPES 9c, first cut; shore pass round 3; world wet ground) ──
//
//WHAT IT FIXES. a-land wets its ground from our water field, which holds the STILL
//level. On a surf beach that put its wet band at the mean waterline: the swash ran
//up past it over dry-looking sand, and the backwash uncovered a dark, glossy strip
//a-land still called "submerged" (Dante, 2026-09-30, "some remain after the surf
//pulls back").
//
//WHAT IT IS. Two camera-following, world-snapped float maps, rendered every frame and
//handed to a-land (ALand.runtime.TerrainMaterial.setSwashSurface):
//
//    near  ±512 m at 0.5 m/texel (2048²): the sand at your feet and the beaches you see.
//    far   ±896 m at 1.75 m/texel (1024²): the far shores. It stops short of the water
//          field's cascade 1 (±1024 m), which the swash reads its phase and slope from.
//
//Each texel carries:
//
//    r  the LIVE level: the field's still level + this frame's breaker and swash
//       (ShoreBreaker, the same GLSL the water vertex draws with). Lakes and
//       rivers: their still level, unchanged.
//    g  the recent HIGH WATER: the higher of the live level and the swash's memory,
//       shoreSwashHighWater (the best recent wave peak, each less what has dried
//       since at dryRate). Ground under it was covered a moment ago; a-land reads it
//       as wet sand, drying as the memory falls away below it.
//    b  the swash's TERRITORY: 1 on the water side and on sand the swash can run up
//       to (shoreSwashEval's reach, the water shader's own rule), 0 two metres past
//       it. a-land applies its surf rules only here. Without it, a-land's surf rule
//       (capillary height above the live level, no distance limit) wet every low
//       patch in the window, inland grass and all (Dante, 2026-10-05).
//    a  1 = valid.
//
//WHY NO STATE. g used to be a ping-pong (max(live, last frame's g − dryRate·dt)), so the
//memory lived in one camera window: a second, wider map would have had to carry its own
//history, resampled and blurred every time the camera moved, and the two would disagree
//at the hand-off. The memory is now computed in closed form from the same wave sequence
//the sheet is drawn with, so both maps are the same function at two texel sizes and a
//fresh camera or an edited shore is at equilibrium at once. What the closed form cannot
//hold (splashes, wading, rain) is transient, local, and a-land's own ring (full 9c).

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.SwashSurfacePass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.maps = null;
  this.active = false;
  //Live knobs.
  this.enabled = true;
  this.farEnabled = true;
  //m/s the high-water memory falls back: 0.01 lets a 0.5 m run-up band dry over ~50 s.
  this.dryRate = 0.01;
};

ARestlessOcean.Passes.SwashSurfacePass.WINDOWS = {
  near: {resolution: 2048, halfWidth: 512.0},
  far: {resolution: 1024, halfWidth: 896.0}
};

ARestlessOcean.Passes.SwashSurfacePass.prototype.init = function(){
  const SP = ARestlessOcean.Passes.SwashSurfacePass;
  const canFilterFloat = !!(this.renderer.extensions && this.renderer.extensions.has('OES_texture_float_linear'));
  const filter = canFilterFloat ? THREE.LinearFilter : THREE.NearestFilter;
  const uniforms = Object.assign({
      uCenter: {value: new THREE.Vector2()},
      uHalfWidth: {value: 1.0},
      uDryRate: {value: this.dryRate}
    },
    ARestlessOcean.Passes.WaterFieldPass.createSampleUniforms(),
    ARestlessOcean.FlowHandoff.createUniforms(),
    ARestlessOcean.ShoreBreaker.createUniforms());
  this.material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'precision highp float;',
      'varying vec2 vUv;',
      'uniform vec2 uCenter;',
      'uniform float uHalfWidth, uDryRate;',
      ARestlessOcean.Passes.WaterFieldPass.SAMPLE_GLSL,
      ARestlessOcean.FlowHandoff.GLSL,
      ARestlessOcean.ShoreBreaker.GLSL,
      'void main(){',
      '  vec2 xz = uCenter + (vUv * 2.0 - 1.0) * uHalfWidth;',
      '  vec4 f = waterFieldAt(xz);',
      //Fade 1: a-land wants the surface as it IS here, not the clipmap's distance fade.
      '  float live = f.r + shoreBreakerHeightAt(xz, f, 1.0);',
      '  float high = live;',
      //The territory (see the header): the swash's reach inland from the still shoreline.
      '  float territory = f.b > 0.0 ? 1.0 : 0.0;',
      '  if(shoreSwashActive(f)){',
      '    vec4 grad = shoreBreakerSmoothGrad(xz);',
      '    high = max(live, f.r + shoreSwashHighWater(xz, f, grad, uDryRate));',
      '    if(f.b <= 0.0){',
      '      float reach; float swashFoam;',
      '      shoreSwashEval(xz, f, shoreBreakerPhaseField(xz), grad, reach, swashFoam);',
      '      territory = 1.0 - smoothstep(reach, reach + 2.0, -f.b);',
      '    }',
      '  }',
      '  gl_FragColor = vec4(live, high, territory, 1.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });
  this.maps = {};
  for(const name of Object.keys(SP.WINDOWS)){
    const w = SP.WINDOWS[name];
    this.maps[name] = {
      target: new THREE.WebGLRenderTarget(w.resolution, w.resolution, {
        minFilter: filter, magFilter: filter, format: THREE.RGBAFormat, type: THREE.FloatType,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
        wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping
      }),
      halfWidth: w.halfWidth,
      texel: 2.0 * w.halfWidth / w.resolution,
      center: {x: 0.0, y: 0.0}
    };
  }
  this._scene = new THREE.Scene();
  this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  this._scene.add(this._quad);
  this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
};

ARestlessOcean.Passes.SwashSurfacePass.prototype._renderMap = function(map, ctx){
  //Snapped to the texel, so the swash does not crawl across texels as the camera moves.
  map.center.x = Math.round(ctx.cameraX / map.texel) * map.texel;
  map.center.y = Math.round(ctx.cameraZ / map.texel) * map.texel;
  const u = this.material.uniforms;
  u.uCenter.value.set(map.center.x, map.center.y);
  u.uHalfWidth.value = map.halfWidth;
  this.renderer.setRenderTarget(map.target);
  this.renderer.render(this._scene, this._camera);
};

//ctx: {timeMs, cameraX, cameraZ}. Publishes to a-land when it has the socket.
ARestlessOcean.Passes.SwashSurfacePass.prototype.tick = function(ctx){
  const grid = this.oceanGrid;
  const TM = (typeof ALand !== 'undefined' && ALand.runtime && ALand.runtime.TerrainMaterial) || null;
  const socket = TM && TM.setSwashSurface;
  const sbp = grid._shoreBreakerParams;
  const wasActive = this.active;
  this.active = false;
  if(!socket) return;
  if(!this.enabled || !sbp || !sbp.enabled || !grid.waterFieldPass || grid.waterFieldPass.cascades.length !== 3){
    if(wasActive) TM.setSwashSurface(null);
    return;
  }
  if(!this.maps) this.init();
  const u = this.material.uniforms;
  if(!grid.waterFieldPass.bindUniforms(u)) return;
  ARestlessOcean.ShoreBreaker.writeUniforms(u, sbp);
  ARestlessOcean.FlowHandoff.writeUniforms(u, grid._flowHandoffState);
  u.uDryRate.value = this.dryRate;
  const prevRT = this.renderer.getRenderTarget();
  this._renderMap(this.maps.near, ctx);
  if(this.farEnabled) this._renderMap(this.maps.far, ctx);
  this.renderer.setRenderTarget(prevRT);
  this.active = true;
  const near = this.maps.near, far = this.maps.far;
  TM.setSwashSurface({
    map: near.target.texture, center: near.center, halfWidth: near.halfWidth,
    far: this.farEnabled ? {map: far.target.texture, center: far.center, halfWidth: far.halfWidth} : null
  });
};

ARestlessOcean.Passes.SwashSurfacePass.prototype.dispose = function(){
  const TM = (typeof ALand !== 'undefined' && ALand.runtime && ALand.runtime.TerrainMaterial) || null;
  if(TM && TM.setSwashSurface) TM.setSwashSurface(null);
  if(this.maps){
    for(const name in this.maps) this.maps[name].target.dispose();
    this.maps = null;
  }
  if(this.material) this.material.dispose();
  if(this._quad) this._quad.geometry.dispose();
};
