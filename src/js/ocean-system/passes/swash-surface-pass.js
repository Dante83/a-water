//── SwashSurfacePass (WATER-TYPES 9c, first cut; shore pass round 3) ───────
//
//WHAT IT FIXES. a-land wets its ground from our water field, which holds the STILL
//level. On a surf beach that put its wet band at the mean waterline: the swash ran
//up past it over dry-looking sand, and the backwash uncovered a dark, glossy strip
//a-land still called "submerged" (Dante, 2026-09-30, "some remain after the surf
//pulls back").
//
//WHAT IT IS. A camera-following, world-snapped 256² float ping-pong at 0.5 m/texel
//(±64 m), stepped once per frame and handed to a-land every frame
//(ALand.runtime.TerrainMaterial.setSwashSurface):
//
//    r  the LIVE level: the field's still level + this frame's breaker and swash
//       (ShoreBreaker, the same GLSL the water vertex draws with). Lakes and
//       rivers: their still level, unchanged.
//    g  the recent HIGH WATER: max(live, last frame's − dryRate·dt). Ground under
//       it was covered a moment ago; a-land reads it as wet sand, drying as the
//       memory falls away below it.
//    b  the swash's TERRITORY: 1 on the water side and on sand the swash can run up
//       to (shoreSwashEval's reach, the water shader's own rule), 0 two metres past
//       it. a-land applies its surf rules only here. Without it, a-land's surf rule
//       (capillary height above the live level, no distance limit) wet every low
//       patch in the window, inland grass and all, inside a hard 128 m square
//       (Dante, 2026-10-05). It used to hold the surf's height, for debugging.
//    a  1 = valid.
//
//Not the full 9c (a world-anchored wetness ring with per-material drying in
//a-land): the memory lives here, as a level, so a-land needs no state of its own.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.SwashSurfacePass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.targets = null;
  this.read = 0;
  this.centerX = 0.0;
  this.centerZ = 0.0;
  this._prevCenterX = 0.0;
  this._prevCenterZ = 0.0;
  this._lastTimeMs = null;
  this.active = false;
  //Live knobs.
  this.enabled = true;
  //m/s the high-water memory falls back: 0.01 lets a 0.5 m run-up band dry over ~50 s.
  this.dryRate = 0.01;
};

ARestlessOcean.Passes.SwashSurfacePass.RESOLUTION = 256;
ARestlessOcean.Passes.SwashSurfacePass.HALF_WIDTH = 64.0;

ARestlessOcean.Passes.SwashSurfacePass.prototype.init = function(){
  const SP = ARestlessOcean.Passes.SwashSurfacePass;
  const RES = SP.RESOLUTION;
  const canFilterFloat = !!(this.renderer.extensions && this.renderer.extensions.has('OES_texture_float_linear'));
  const filter = canFilterFloat ? THREE.LinearFilter : THREE.NearestFilter;
  const make = function(){
    return new THREE.WebGLRenderTarget(RES, RES, {
      minFilter: filter, magFilter: filter, format: THREE.RGBAFormat, type: THREE.FloatType,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping
    });
  };
  this.targets = [make(), make()];
  const uniforms = Object.assign({
      uPrev: {value: null},
      uPrevCenter: {value: new THREE.Vector2()},
      uCenter: {value: new THREE.Vector2()},
      uHalfWidth: {value: SP.HALF_WIDTH},
      uDt: {value: 0.0},
      uDryRate: {value: this.dryRate},
      uFresh: {value: 1.0}
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
      'uniform sampler2D uPrev;',
      'uniform vec2 uPrevCenter, uCenter;',
      'uniform float uHalfWidth, uDt, uDryRate, uFresh;',
      ARestlessOcean.Passes.WaterFieldPass.SAMPLE_GLSL,
      ARestlessOcean.FlowHandoff.GLSL,
      ARestlessOcean.ShoreBreaker.GLSL,
      'void main(){',
      '  vec2 xz = uCenter + (vUv * 2.0 - 1.0) * uHalfWidth;',
      '  vec4 f = waterFieldAt(xz);',
      //Fade 1: a-land wants the surface as it IS here, not the clipmap's distance fade.
      '  float eta = shoreBreakerHeightAt(xz, f, 1.0);',
      '  float live = f.r + eta;',
      '  vec2 puv = (xz - uPrevCenter) / (2.0 * uHalfWidth) + 0.5;',
      '  float high = live;',
      '  if(uFresh < 0.5 && puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0){',
      '    vec4 prev = texture2D(uPrev, puv);',
      '    if(prev.a > 0.5) high = max(live, prev.g - uDryRate * uDt);',
      '  }',
      //The territory (see the header): the swash's reach inland from the still shoreline.
      '  float territory = 1.0;',
      '  if(f.b <= 0.0){',
      '    territory = 0.0;',
      '    if(shoreSwashActive(f)){',
      '      float reach; float swashFoam;',
      '      shoreSwashEval(xz, f, shoreBreakerPhaseField(xz), shoreBreakerSmoothGrad(xz), reach, swashFoam);',
      '      territory = 1.0 - smoothstep(reach, reach + 2.0, -f.b);',
      '    }',
      '  }',
      '  gl_FragColor = vec4(live, high, territory, 1.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });
  this._scene = new THREE.Scene();
  this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  this._scene.add(this._quad);
  this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._fresh = true;
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
  if(!this.targets) this.init();
  const SP = ARestlessOcean.Passes.SwashSurfacePass;
  const texel = 2.0 * SP.HALF_WIDTH / SP.RESOLUTION;
  let dt = this._lastTimeMs === null ? 0.0 : (ctx.timeMs - this._lastTimeMs) * 0.001;
  this._lastTimeMs = ctx.timeMs;
  dt = Math.min(Math.max(dt, 0.0), 0.1);
  this._prevCenterX = this.centerX;
  this._prevCenterZ = this.centerZ;
  this.centerX = Math.round(ctx.cameraX / texel) * texel;
  this.centerZ = Math.round(ctx.cameraZ / texel) * texel;

  const u = this.material.uniforms;
  if(!grid.waterFieldPass.bindUniforms(u)) return;
  ARestlessOcean.ShoreBreaker.writeUniforms(u, sbp);
  ARestlessOcean.FlowHandoff.writeUniforms(u, grid._flowHandoffState);
  u.uPrev.value = this.targets[this.read].texture;
  u.uPrevCenter.value.set(this._prevCenterX, this._prevCenterZ);
  u.uCenter.value.set(this.centerX, this.centerZ);
  u.uDt.value = dt;
  u.uDryRate.value = this.dryRate;
  u.uFresh.value = this._fresh ? 1.0 : 0.0;
  const write = 1 - this.read;
  const prevRT = this.renderer.getRenderTarget();
  this.renderer.setRenderTarget(this.targets[write]);
  this.renderer.render(this._scene, this._camera);
  this.renderer.setRenderTarget(prevRT);
  this.read = write;
  this._fresh = false;
  this.active = true;
  TM.setSwashSurface({map: this.targets[this.read].texture, center: {x: this.centerX, y: this.centerZ}, halfWidth: SP.HALF_WIDTH});
};

ARestlessOcean.Passes.SwashSurfacePass.prototype.dispose = function(){
  const TM = (typeof ALand !== 'undefined' && ALand.runtime && ALand.runtime.TerrainMaterial) || null;
  if(TM && TM.setSwashSurface) TM.setSwashSurface(null);
  if(this.targets){ this.targets[0].dispose(); this.targets[1].dispose(); this.targets = null; }
  if(this.material) this.material.dispose();
  if(this._quad) this._quad.geometry.dispose();
};
