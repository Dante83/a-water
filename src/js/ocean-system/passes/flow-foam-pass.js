//── FlowFoamPass ────────────────────────────────────────────────────────────
//
//Phase 4 of the multi-water plan (WATER-TYPES.md): the foam accumulation render
//target for flowing water. The ocean's foam is instantaneous (the Jacobian of
//this frame's waves), which physically cannot draw what makes a river read as
//flowing: streaks of foam born at a rock or a chute and carried downstream for
//seconds. That needs foam with a HISTORY, moved by the current.
//
//WHAT IT IS
//A camera-following, world-snapped 512² float ping-pong at 0.5 m/texel (±128 m,
//inside WaterField cascade 0), stepped once per frame:
//
//    r  foam coverage, 0..1
//    g  flow.x  (m/s)   \  the field's current, lightly smoothed — the flowing
//    b  flow.z  (m/s)   /  material reads flow from HERE, so it spends one
//    a  energy, 0..1        sampler on flow and foam together
//
//THE STEP, per texel
//  1. Advect. Semi-Lagrangian: read last frame's foam at x − v·dt. Unconditionally
//     stable; at 9 m/s and 60 fps the backtrace is 0.3 texel. The previous
//     target is addressed through its own centre, so re-centring as the camera
//     moves costs nothing extra (no shift pass).
//  2. Decay. foam·exp(−dt/τ), with τ falling as the foam gets DENSER. This is fresh
//     water: salt inhibits bubble coalescence, which is why sea foam lingers, while
//     fresh-water bubbles merge and burst within about a second. So dense whitewater
//     collapses fast (decayTimeDense), and only the sparse residue that surfactants
//     hold up drifts on as streaks (decayTime).
//  3. Sources. Coverage saturates: foam = 1 − (1 − foam)·exp(−S·dt). S (1/s)
//     comes from what actually makes foam in a stream (decided with Dante: NOT
//     a-land's energy, which saturates at 1 on every island-sholes creek):
//       convergence  max(0, −∇·v)      water piling up: the foot of a chute,
//                                      a lake inlet, the lee of an obstruction
//       bank shear   |∇×v| within ~2 m of the bank
//       bed steps    |∇level| past tan 30° (a-land's own waterfall slope), × |v|
//       fall bases   a band along each simulation.waterfalls[] foot, as wide as the
//                    fall and a couple of metres deep (see _updateFalls), ∝ discharge
//     Energy only nudges the total (×0.6 at 0, ×1 at 1).
//  The current's DIRECTION is turned toward the water surface's downhill where the level
//  visibly slopes (a-land's D8 directions zig-zag across diagonal creeks); speed stays.
//  Convergence and shear start above an onset (entraining air takes a minimum
//  of turbulence). The derivatives use a 2 m stencil over a flow smoothed with a
//  5-tap cross of the same reach: a-land routes with D8 and stamps a disc of
//  level and velocity per bed cell, so at 1 m the field is a staircase of discs
//  and raw derivatives read every stamp edge as a convergence or a step.
//
//Every gain is a live JS field on the pass (see the prototype defaults) so the
//look can be tuned from the console without a rebuild.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.FlowFoamPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.targets = null;
  this.read = 0;
  this.centerX = 0.0;
  this.centerZ = 0.0;
  this._prevCenterX = 0.0;
  this._prevCenterZ = 0.0;
  this._lastTimeMs = null;
  this._fallCount = 0;
  this._fallsSource = null;

  //Live tunables (see header). Rates are 1/s.
  this.decayTime = 6.0;          //τ of the sparse residue, seconds (streaks)
  this.decayTimeDense = 1.0;     //τ of dense whitewater, seconds (fresh-water bubbles burst fast)
  this.convergenceGain = 1.5;    //per (1/s) of convergence above its onset
  this.convergenceOnset = 0.15;  //1/s: gentler piling-up entrains no air
  this.bankShearGain = 0.6;      //per (1/s) of vorticity at the bank, above its onset
  this.bankShearOnset = 0.5;     //1/s
  this.stepGain = 1.2;           //per (m/s) of flow over a bed step
  this.stepSlopeLo = 0.5;        //|∇level| where a step starts to foam
  this.stepSlopeHi = 0.8;        //and where it is fully a step (tan 30° = 0.577 between)
  this.stencil = 2.0;            //m: derivative and flow-smoothing reach
  this.fallGain = 0.25;          //per (m³/s) of waterfall discharge
  this.fallDepthPerDrop = 0.8;   //LOOK CHOICE: aerated band depth (m downstream) per m of drop, 1..5 m
  this.enabled = true;
  //The falls near the window this frame, nearest first: [{d, x, z, r, q, fall}], fall the
  //simulation.waterfalls[] entry. OceanSplash reads it for the plunge spray.
  this.nearFalls = [];
};

ARestlessOcean.Passes.FlowFoamPass.RESOLUTION = 512;
ARestlessOcean.Passes.FlowFoamPass.HALF_WIDTH = 128.0;
ARestlessOcean.Passes.FlowFoamPass.MAX_FALLS = 16;

ARestlessOcean.Passes.FlowFoamPass.prototype.init = function(){
  const RES = ARestlessOcean.Passes.FlowFoamPass.RESOLUTION;
  const MAX_FALLS = ARestlessOcean.Passes.FlowFoamPass.MAX_FALLS;
  //Float, not half: the flow channels carry m/s up to a-land's velocityRange and
  //radeonsi samples half-float targets wrongly (see project notes). Linear when
  //the extension allows, for the advection read and the material's sample.
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

  const falls = [];
  const fallsB = [];
  for(let i = 0; i < MAX_FALLS; ++i){ falls.push(new THREE.Vector4(0, 0, 0, 0)); fallsB.push(new THREE.Vector4(0, 1, 0, 1)); }
  this.material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uPrev: {value: null},
      uPrevCenter: {value: new THREE.Vector2()},
      uCenter: {value: new THREE.Vector2()},
      uHalfWidth: {value: ARestlessOcean.Passes.FlowFoamPass.HALF_WIDTH},
      uDt: {value: 0.0},
      uDecayTime: {value: this.decayTime},
      uDecayTimeDense: {value: this.decayTimeDense},
      uGains: {value: new THREE.Vector4()},
      uOnsets: {value: new THREE.Vector4()},   //(convergence, bank shear, step slope lo, hi)
      uStencil: {value: 2.0},
      uFieldA: {value: null},          //WaterField cascade 0 RT0: level depth shoreSDF packed
      uFieldB: {value: null},          //WaterField cascade 0 RT1: flow.x flow.z energy type
      uFieldCenter: {value: new THREE.Vector2()},
      uFieldHalfWidth: {value: 256.0},
      uFalls: {value: falls},          //(x, z, half-width along the foot, source rate)
      uFallsB: {value: fallsB},        //(downstream dir x, z, band depth, 0)
      uFallCount: {value: 0}
    },
    vertexShader: [
      'out vec2 vUv;',
      'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'layout(location = 0) out vec4 oFoam;',
      'in vec2 vUv;',
      'uniform sampler2D uPrev, uFieldA, uFieldB;',
      'uniform vec2 uPrevCenter, uCenter, uFieldCenter;',
      'uniform float uHalfWidth, uDt, uDecayTime, uDecayTimeDense, uFieldHalfWidth, uStencil;',
      'uniform vec4 uGains, uOnsets;',
      'uniform vec4 uFalls[' + MAX_FALLS + '], uFallsB[' + MAX_FALLS + '];',
      'uniform int uFallCount;',
      'vec2 fieldUV(vec2 xz){ return (xz - uFieldCenter) / (2.0 * uFieldHalfWidth) + 0.5; }',
      'vec2 flowAt(vec2 xz){',
      '  vec2 c = texture(uFieldB, fieldUV(xz)).xy;',
      '  float r = uStencil;',
      '  vec2 s = texture(uFieldB, fieldUV(xz + vec2(r, 0.0))).xy + texture(uFieldB, fieldUV(xz - vec2(r, 0.0))).xy',
      '         + texture(uFieldB, fieldUV(xz + vec2(0.0, r))).xy + texture(uFieldB, fieldUV(xz - vec2(0.0, r))).xy;',
      '  return 0.5 * c + 0.125 * s;',
      '}',
      'void main(){',
      '  vec2 xz = uCenter + (vUv * 2.0 - 1.0) * uHalfWidth;',
      '  vec4 fa = texture(uFieldA, fieldUV(xz));',
      '  vec4 fb = texture(uFieldB, fieldUV(xz));',
      '  vec2 v = flowAt(xz);',
      //Direction from the water surface: open-channel flow runs down its own surface
      //slope. a-land routes on D8, so a creek crossing the grid at an angle zig-zags
      //between diagonal velocities cell to cell and the foam wanders sideways (browser
      //round 5, oval island). Where the surface visibly slopes, turn a-land's direction
      //toward the downhill of the level (same speed); on flat water (lakes, pools) keep
      //a-land's.
      '  vec2 gradL = vec2(texture(uFieldA, fieldUV(xz + vec2(uStencil, 0.0))).r - texture(uFieldA, fieldUV(xz - vec2(uStencil, 0.0))).r,',
      '                    texture(uFieldA, fieldUV(xz + vec2(0.0, uStencil))).r - texture(uFieldA, fieldUV(xz - vec2(0.0, uStencil))).r) / (2.0 * uStencil);',
      '  float gradLen = length(gradL);',
      '  float speed = length(v);',
      '  if(speed > 0.05 && gradLen > 1e-4){',
      '    float align = smoothstep(0.003, 0.02, gradLen);',
      '    vec2 dirV = v / speed;',
      '    vec2 dirL = -gradL / gradLen;',
      //never turn the flow more than 90 degrees: past that the level gradient is noise
      '    if(dot(dirV, dirL) > 0.0){',
      '      vec2 dir = normalize(mix(dirV, dirL, 0.85 * align));',
      '      v = dir * speed;',
      '    }',
      '  }',
      '  float wet = fa.g > 0.0 ? 1.0 : 0.0;',
      //1. advect, 2. decay
      '  vec2 back = xz - v * uDt;',
      '  vec2 puv = (back - uPrevCenter) / (2.0 * uHalfWidth) + 0.5;',
      '  float inside = step(0.0, puv.x) * step(puv.x, 1.0) * step(0.0, puv.y) * step(puv.y, 1.0);',
      '  float foam = inside * texture(uPrev, puv).r;',
      '  float tau = mix(uDecayTime, uDecayTimeDense, smoothstep(0.15, 0.7, foam));',
      '  foam *= exp(-uDt / max(tau, 0.01));',
      //3. sources
      '  float H = uStencil;',
      '  vec2 vxp = flowAt(xz + vec2(H, 0.0)), vxm = flowAt(xz - vec2(H, 0.0));',
      '  vec2 vzp = flowAt(xz + vec2(0.0, H)), vzm = flowAt(xz - vec2(0.0, H));',
      '  float divV = ((vxp.x - vxm.x) + (vzp.y - vzm.y)) / (2.0 * H);',
      '  float curlV = ((vxp.y - vxm.y) - (vzp.x - vzm.x)) / (2.0 * H);',
      '  float convergence = max(0.0, -divV - uOnsets.x);',
      '  float bank = max(0.0, abs(curlV) - uOnsets.y) * (1.0 - smoothstep(0.5, 2.0, fa.b));',
      '  float lxp = texture(uFieldA, fieldUV(xz + vec2(H, 0.0))).r, lxm = texture(uFieldA, fieldUV(xz - vec2(H, 0.0))).r;',
      '  float lzp = texture(uFieldA, fieldUV(xz + vec2(0.0, H))).r, lzm = texture(uFieldA, fieldUV(xz - vec2(0.0, H))).r;',
      '  float bedSlope = length(vec2(lxp - lxm, lzp - lzm)) / (2.0 * H);',
      //tan 30° = 0.577: a-land classifies a waterfall cell at that slope.
      '  float stepT = smoothstep(uOnsets.z, uOnsets.w, bedSlope) * length(v);',
      '  float fall = 0.0;',
      '  for(int i = 0; i < ' + MAX_FALLS + '; ++i){',
      '    if(i >= uFallCount) break;',
      //A band along the foot: the curtain lands along a line as wide as the fall and
      //aerates a strip just downstream of it, not a disc reaching back up the fall.
      '    vec2 dirF = uFallsB[i].xy, p = xz - uFalls[i].xy;',
      '    float depthF = uFallsB[i].z;',
      '    float across = abs(dot(p, vec2(-dirF.y, dirF.x)));',
      '    float down = dot(p, dirF);',
      '    float dAcross = max(across - uFalls[i].z, 0.0);',
      '    float dDown = down < 0.0 ? -down * 4.0 : max(down - depthF, 0.0);',
      '    float d = length(vec2(dAcross, dDown));',
      '    fall += uFalls[i].w * (1.0 - smoothstep(0.0, 0.5 * depthF, d));',
      '  }',
      '  float S = (uGains.x * convergence + uGains.y * bank + uGains.z * stepT) * mix(0.6, 1.0, clamp(fb.z, 0.0, 1.0));',
      '  S += fall;',
      '  foam = 1.0 - (1.0 - foam) * exp(-max(S, 0.0) * uDt);',
      '  foam *= wet;',
      '  oFoam = vec4(clamp(foam, 0.0, 1.0), v, fb.z);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });
  this._scene = new THREE.Scene();
  this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  this._scene.add(this._quad);
  this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  //Clear both so the first read is foam-free (float targets start undefined on
  //some drivers).
  const prevRT = this.renderer.getRenderTarget();
  const prevColor = this.renderer.getClearColor(new THREE.Color());
  const prevAlpha = this.renderer.getClearAlpha();
  this.renderer.setClearColor(0x000000, 0.0);
  for(let i = 0; i < 2; ++i){
    this.renderer.setRenderTarget(this.targets[i]);
    this.renderer.clear(true, false, false);
  }
  this.renderer.setClearColor(prevColor, prevAlpha);
  this.renderer.setRenderTarget(prevRT);
};

//Where falls land, into uFalls/uFallsB, nearest first. Each source is a band along the
//landing: half-width = half the fall width, running fallDepthPerDrop·drop metres downstream
//(clamped 1..5 m).
//
//Phase 6: with traced nappes (WaterfallSheetPass.liveNappes) every IMPACT is a source —
//each ledge a cascade bounces off, and the plunge — at the point the water actually lands,
//heading the way it was moving, with drop = v_n²/2g (the height that normal speed was
//gained over). Without them, the Phase 4 placeholder: one band at each fall's `bottom`
//BED point, downstream = top → bottom.
ARestlessOcean.Passes.FlowFoamPass.prototype._updateFalls = function(ctx){
  const MAX_FALLS = ARestlessOcean.Passes.FlowFoamPass.MAX_FALLS;
  const u = this.material.uniforms;
  const hw = ARestlessOcean.Passes.FlowFoamPass.HALF_WIDTH;
  const near = [];
  const self = this;
  const consider = function(x, z, r, q, dx, dz, drop, fall){
    const ox = x - self.centerX, oz = z - self.centerZ;
    if(Math.abs(ox) > hw + r || Math.abs(oz) > hw + r) return;
    near.push({d: ox * ox + oz * oz, x: x, z: z, r: r, q: q, dx: dx, dz: dz, drop: drop, fall: fall});
  };
  if(ctx.nappes){
    for(let n = 0; n < ctx.nappes.length; ++n){
      const nap = ctx.nappes[n];
      for(let i = 0; i < nap.impacts.length; ++i){
        const im = nap.impacts[i];
        let dx = im.vx, dz = im.vz;
        const len = Math.sqrt(dx * dx + dz * dz);
        if(len > 1e-3){ dx /= len; dz /= len; } else { dx = 0.0; dz = 1.0; }
        consider(im.x, im.z, 0.5 * nap.width, nap.discharge, dx, dz, im.vn * im.vn / (2.0 * 9.81), null);
      }
    }
  }
  else {
    const falls = ctx.waterfalls || [];
    for(let i = 0; i < falls.length; ++i){
      const f = falls[i], b = f.bottom;
      if(!b) continue;
      const t = f.top || b;
      let dx = b[0] - t[0], dz = b[2] - t[2];
      const len = Math.sqrt(dx * dx + dz * dz);
      if(len > 1e-3){ dx /= len; dz /= len; } else { dx = 0.0; dz = 1.0; }
      const drop = f.drop !== undefined ? f.drop : Math.max(t[1] - b[1], 0.0);
      consider(b[0], b[2], 0.5 * (f.width || 4.0), f.discharge || 0.0, dx, dz, drop, f);
    }
  }
  near.sort(function(a, b){ return a.d - b.d; });
  const n = Math.min(near.length, MAX_FALLS);
  for(let i = 0; i < n; ++i){
    const s = near[i];
    const depth = Math.min(Math.max(this.fallDepthPerDrop * s.drop, 1.0), 5.0);
    u.uFalls.value[i].set(s.x, s.z, s.r, this.fallGain * s.q);
    u.uFallsB.value[i].set(s.dx, s.dz, depth, 0.0);
  }
  u.uFallCount.value = n;
  if(near.length > n) near.length = n;
  this.nearFalls = near;
};

//ctx: {timeMs, cameraX, cameraZ, fieldCascade (WaterField cascade 0), waterfalls}
ARestlessOcean.Passes.FlowFoamPass.prototype.tick = function(ctx){
  const c = ctx.fieldCascade;
  if(!this.enabled || !c || c.centerX === undefined) return;
  const RES = ARestlessOcean.Passes.FlowFoamPass.RESOLUTION;
  const HW = ARestlessOcean.Passes.FlowFoamPass.HALF_WIDTH;
  const texel = 2.0 * HW / RES;
  let dt = this._lastTimeMs === null ? 0.0 : (ctx.timeMs - this._lastTimeMs) * 0.001;
  this._lastTimeMs = ctx.timeMs;
  //Clamp: a stalled tab must not flush every streak in one step or backtrace
  //through a whole creek.
  dt = Math.min(Math.max(dt, 0.0), 0.1);

  this._prevCenterX = this.centerX;
  this._prevCenterZ = this.centerZ;
  this.centerX = Math.round(ctx.cameraX / texel) * texel;
  this.centerZ = Math.round(ctx.cameraZ / texel) * texel;
  this._updateFalls(ctx);

  const u = this.material.uniforms;
  u.uPrev.value = this.targets[this.read].texture;
  u.uPrevCenter.value.set(this._prevCenterX, this._prevCenterZ);
  u.uCenter.value.set(this.centerX, this.centerZ);
  u.uDt.value = dt;
  u.uDecayTime.value = this.decayTime;
  u.uDecayTimeDense.value = this.decayTimeDense;
  u.uGains.value.set(this.convergenceGain, this.bankShearGain, this.stepGain, 0.0);
  u.uOnsets.value.set(this.convergenceOnset, this.bankShearOnset, this.stepSlopeLo, this.stepSlopeHi);
  u.uStencil.value = this.stencil;
  u.uFieldA.value = c.target.textures[0];
  u.uFieldB.value = c.target.textures[1];
  u.uFieldCenter.value.set(c.centerX, c.centerZ);
  u.uFieldHalfWidth.value = c.halfWidth;

  const write = 1 - this.read;
  const prevRT = this.renderer.getRenderTarget();
  this.renderer.setRenderTarget(this.targets[write]);
  this.renderer.render(this._scene, this._camera);
  this.renderer.setRenderTarget(prevRT);
  this.read = write;
};

//The target holding this frame's foam + flow, and the square it covers.
ARestlessOcean.Passes.FlowFoamPass.prototype.texture = function(){
  return this.targets ? this.targets[this.read].texture : null;
};

ARestlessOcean.Passes.FlowFoamPass.prototype.resize = function(){};

ARestlessOcean.Passes.FlowFoamPass.prototype.dispose = function(){
  if(this.targets){ this.targets[0].dispose(); this.targets[1].dispose(); this.targets = null; }
  if(this.material) this.material.dispose();
  if(this._quad) this._quad.geometry.dispose();
};
