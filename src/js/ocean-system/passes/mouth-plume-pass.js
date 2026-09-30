//── MouthPlumePass (shore pass, 2026-09-30) ────────────────────────────────
//
//WHAT IT FIXES. A river reaching the sea stopped dead: a-land writes the sea at
//exactly zero velocity, so the current, the river's foam and its colour all ended at
//the coast. Real mouths push a plume out: a jet of fresher, siltier water that spreads
//and slows, with a foam line where it meets the sea.
//
//WHAT IT IS. A camera-following, world-snapped 512² float ping-pong at 1 m/texel
//(±256 m, WaterField cascade 0's footprint), stepped once per frame:
//
//    r  plume concentration, 0..1 (1 = river water)
//    g  current.x (m/s) \  the river's current carried out into the sea
//    b  current.z (m/s) /
//    a  front foam, 0..1
//
//THE STEP, per texel
//  Flowing texels (the hand-off weight > 0.5) are the SOURCE: concentration 1, the
//  field's own current, and the river's advected foam (FlowFoamPass) handed over.
//  Still wet texels (the sea, lakes):
//  1. Current. A screened diffusion of the neighbours' current (dry neighbours left
//     out, so the coast is a wall, not a sink). Its steady state falls off as
//     exp(-d/jetLength) from the mouth: a jet that widens and slows with no explicit
//     mouth list. Each frame is one relaxation step, so a jet settles over tens of
//     seconds, and it follows the camera window like the foam does.
//  2. Concentration. Semi-Lagrangian advection by that current, a little diffusion,
//     and decay over plumeLife seconds (mixing into the sea).
//  3. Front foam. Advected the same way. It decays over foamLife (salt water:
//     bubbles don't coalesce, so sea foam lingers). It is seeded where the current
//     converges (the jet piling into still water) and where the concentration drops
//     steeply (the plume's edge: the brackish foam line).
//  Dry texels hold nothing.
//
//The still water material reads it (one sampler): it tints the body toward
//mouthPlumeAlbedo by concentration and makes the water less clear, draws the front
//foam as lace, and drifts the lace grain with the current.
//
//Every gain is a live field on the pass.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.MouthPlumePass = function(oceanGrid){
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

  //Live tunables.
  this.enabled = true;
  this.jetLength = 40.0;        //m: e-fold of the current out from the mouth
  this.plumeLife = 90.0;        //s: concentration mixing into the sea
  this.plumeDiffusion = 0.15;   //per step, share of the neighbour mean taken
  this.foamLife = 20.0;         //s: salt-water foam lingers
  //A slowing jet converges all along its axis (~0.09/s at 5 m out), so a low onset turned
  //the whole plume into lace (headless 2026-09-30: 64-75% cover over 16 m). The onset keeps
  //convergence foam to where the jet really piles up, right off the mouth.
  this.convergenceGain = 1.0;   //per (1/s) of convergence above its onset
  this.convergenceOnset = 0.08; //1/s
  //The plume's edge foams only where the concentration drops SHARPLY: the jet's shear lines
  //just off the mouth. A diffusing plume thins gradually (~0.08/m), and a gain on any
  //gradient laced it all over (headless 2026-09-30).
  this.frontGain = 3.0;         //per (1/m) of concentration drop above its onset
  this.frontOnset = 0.1;        //1/m
  this.riverFoamHandoff = 0.8;  //share of the river's foam carried over at the mouth
  //The look (water material): the silt's albedo, and how much of the body it takes at
  //full concentration (it also takes that share of the clarity away, ×0.8).
  this.albedo = new THREE.Vector3(0.20, 0.17, 0.09);
  this.strength = 0.7;
};

ARestlessOcean.Passes.MouthPlumePass.RESOLUTION = 512;
ARestlessOcean.Passes.MouthPlumePass.HALF_WIDTH = 256.0;

ARestlessOcean.Passes.MouthPlumePass.prototype.init = function(){
  const RES = ARestlessOcean.Passes.MouthPlumePass.RESOLUTION;
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
  const FH = ARestlessOcean.FlowHandoff;
  this.material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uPrev: {value: null},
      uPrevCenter: {value: new THREE.Vector2()},
      uCenter: {value: new THREE.Vector2()},
      uHalfWidth: {value: ARestlessOcean.Passes.MouthPlumePass.HALF_WIDTH},
      uTexel: {value: 1.0},
      uDt: {value: 0.0},
      uJetKeep: {value: 1.0},
      uPlumeLife: {value: 90.0},
      uPlumeDiffusion: {value: 0.15},
      uFoamLife: {value: 20.0},
      uGains: {value: new THREE.Vector4()},   //(convergence, onset, front, river foam hand-off)
      uFrontOnset: {value: 0.1},
      uFieldA: {value: null},
      uFieldB: {value: null},
      uFieldCenter: {value: new THREE.Vector2()},
      uFieldHalfWidth: {value: 256.0},
      uRiverFoam: {value: null},
      uRiverFoamCenter: {value: new THREE.Vector2()},
      uRiverFoamHalfWidth: {value: 128.0},
      uRiverFoamOn: {value: 0.0}
    },
    vertexShader: [
      'out vec2 vUv;',
      'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'layout(location = 0) out vec4 oPlume;',
      'in vec2 vUv;',
      'uniform sampler2D uPrev, uFieldA, uFieldB, uRiverFoam;',
      'uniform vec2 uPrevCenter, uCenter, uFieldCenter, uRiverFoamCenter;',
      'uniform float uHalfWidth, uTexel, uDt, uJetKeep, uPlumeLife, uPlumeDiffusion, uFoamLife, uFieldHalfWidth, uRiverFoamHalfWidth, uRiverFoamOn;',
      'uniform vec4 uGains;',
      'uniform float uFrontOnset;',
      'vec2 fieldUV(vec2 xz){ return (xz - uFieldCenter) / (2.0 * uFieldHalfWidth) + 0.5; }',
      'vec2 prevUV(vec2 xz){ return (xz - uPrevCenter) / (2.0 * uHalfWidth) + 0.5; }',
      'bool insideUV(vec2 uv){ return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0; }',
      //Last frame's state at a world point (zero outside last frame's window).
      'vec4 prevAt(vec2 xz){ vec2 uv = prevUV(xz); return insideUV(uv) ? texture(uPrev, uv) : vec4(0.0); }',
      'bool wetAt(vec2 xz){ return texture(uFieldA, fieldUV(xz)).g > 0.0; }',
      //The field's flowing weight, as FlowHandoff computes it (speed or energy).
      'float flowWeight(vec4 fb){',
      '  return max(smoothstep(' + (FH ? FH.FLOW_LO : 0.05).toFixed(4) + ', ' + (FH ? FH.FLOW_HI : 0.25).toFixed(4) + ', length(fb.xy)),',
      '             smoothstep(' + (FH ? FH.ENERGY_LO : 0.002).toFixed(4) + ', ' + (FH ? FH.ENERGY_HI : 0.02).toFixed(4) + ', fb.z));',
      '}',
      'void main(){',
      '  vec2 xz = uCenter + (vUv * 2.0 - 1.0) * uHalfWidth;',
      '  vec2 fuv = fieldUV(xz);',
      '  if(!insideUV(fuv)){ oPlume = vec4(0.0); return; }',
      '  vec4 fa = texture(uFieldA, fuv);',
      '  vec4 fb = texture(uFieldB, fuv);',
      '  if(!(fa.g > 0.0)){ oPlume = vec4(0.0); return; }',
      '  float w = flowWeight(fb);',
      //SOURCE: flowing water is river water, with its own current and foam.
      '  if(w > 0.5){',
      '    float riverFoam = 0.0;',
      '    if(uRiverFoamOn > 0.5){',
      '      vec2 ruv = (xz - uRiverFoamCenter) / (2.0 * uRiverFoamHalfWidth) + 0.5;',
      '      if(insideUV(ruv)) riverFoam = texture(uRiverFoam, ruv).r * uGains.w;',
      '    }',
      '    oPlume = vec4(1.0, fb.xy, riverFoam);',
      '    return;',
      '  }',
      //1. Current: screened diffusion over the wet 4-neighbourhood.
      '  vec2 e = vec2(uTexel, 0.0);',
      '  vec2 nsum = vec2(0.0); float ncount = 0.0; float csum = 0.0;',
      '  vec2 offs[4] = vec2[4](e.xy, -e.xy, e.yx, -e.yx);',
      '  for(int i = 0; i < 4; i++){',
      '    vec2 q = xz + offs[i];',
      '    if(!wetAt(q)) continue;',
      '    vec4 pq = prevAt(q);',
      '    nsum += pq.gb; csum += pq.r; ncount += 1.0;',
      '  }',
      '  vec4 here = prevAt(xz);',
      '  vec2 u = ncount > 0.0 ? uJetKeep * nsum / ncount : vec2(0.0);',
      //2. Concentration: advect by the current, diffuse a little, decay.
      '  vec4 back = prevAt(xz - u * uDt);',
      '  float conc = back.r;',
      '  if(ncount > 0.0) conc = mix(conc, csum / ncount, uPlumeDiffusion);',
      '  conc *= exp(-uDt / max(uPlumeLife, 0.1));',
      //3. Front foam: advected, lingering, made where the jet piles up and at the plume edge.
      '  float foam = back.a * exp(-uDt / max(uFoamLife, 0.1));',
      '  vec2 uxp = prevAt(xz + e.xy).gb, uxm = prevAt(xz - e.xy).gb;',
      '  vec2 uzp = prevAt(xz + e.yx).gb, uzm = prevAt(xz - e.yx).gb;',
      '  float divU = ((uxp.x - uxm.x) + (uzp.y - uzm.y)) / (2.0 * uTexel);',
      '  float cxp = prevAt(xz + e.xy).r, cxm = prevAt(xz - e.xy).r, czp = prevAt(xz + e.yx).r, czm = prevAt(xz - e.yx).r;',
      '  float gradC = length(vec2(cxp - cxm, czp - czm)) / (2.0 * uTexel);',
      //The edge is where the plume is thinning into the sea, not its middle.
      '  float edge = gradC * smoothstep(0.02, 0.15, conc) * (1.0 - smoothstep(0.5, 0.9, conc));',
      '  float S = uGains.x * max(0.0, -divU - uGains.y) + uGains.z * max(0.0, edge - uFrontOnset);',
      '  foam = 1.0 - (1.0 - foam) * exp(-max(S, 0.0) * uDt);',
      '  oPlume = vec4(clamp(conc, 0.0, 1.0), u, clamp(foam, 0.0, 1.0));',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });
  this._scene = new THREE.Scene();
  this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  this._scene.add(this._quad);
  this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
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

//ctx: {timeMs, cameraX, cameraZ, fieldCascade (WaterField cascade 0), riverFoam: FlowFoamPass or null}
ARestlessOcean.Passes.MouthPlumePass.prototype.tick = function(ctx){
  const c = ctx.fieldCascade;
  this.active = false;
  if(!this.enabled || !c || c.centerX === undefined) return;
  if(!this.targets) this.init();
  const MP = ARestlessOcean.Passes.MouthPlumePass;
  const texel = 2.0 * MP.HALF_WIDTH / MP.RESOLUTION;
  let dt = this._lastTimeMs === null ? 0.0 : (ctx.timeMs - this._lastTimeMs) * 0.001;
  this._lastTimeMs = ctx.timeMs;
  dt = Math.min(Math.max(dt, 0.0), 0.1);

  this._prevCenterX = this.centerX;
  this._prevCenterZ = this.centerZ;
  this.centerX = Math.round(ctx.cameraX / texel) * texel;
  this.centerZ = Math.round(ctx.cameraZ / texel) * texel;

  const u = this.material.uniforms;
  u.uPrev.value = this.targets[this.read].texture;
  u.uPrevCenter.value.set(this._prevCenterX, this._prevCenterZ);
  u.uCenter.value.set(this.centerX, this.centerZ);
  u.uTexel.value = texel;
  u.uDt.value = dt;
  //Screened diffusion u = k · mean(neighbours) decays as exp(-d/L) with
  //1/L² = 4(1 - k)/(k·texel²), so k = 1/(1 + texel²/(4L²)).
  const L = Math.max(this.jetLength, texel);
  u.uJetKeep.value = 1.0 / (1.0 + texel * texel / (4.0 * L * L));
  u.uPlumeLife.value = this.plumeLife;
  u.uPlumeDiffusion.value = this.plumeDiffusion;
  u.uFoamLife.value = this.foamLife;
  u.uGains.value.set(this.convergenceGain, this.convergenceOnset, this.frontGain, this.riverFoamHandoff);
  u.uFrontOnset.value = this.frontOnset;
  u.uFieldA.value = c.target.textures[0];
  u.uFieldB.value = c.target.textures[1];
  u.uFieldCenter.value.set(c.centerX, c.centerZ);
  u.uFieldHalfWidth.value = c.halfWidth;
  const rf = ctx.riverFoam;
  const rfTex = rf && rf.texture ? rf.texture() : null;
  u.uRiverFoam.value = rfTex;
  u.uRiverFoamOn.value = rfTex ? 1.0 : 0.0;
  if(rfTex){
    u.uRiverFoamCenter.value.set(rf.centerX, rf.centerZ);
    u.uRiverFoamHalfWidth.value = ARestlessOcean.Passes.FlowFoamPass.HALF_WIDTH;
  }

  const write = 1 - this.read;
  const prevRT = this.renderer.getRenderTarget();
  this.renderer.setRenderTarget(this.targets[write]);
  this.renderer.render(this._scene, this._camera);
  this.renderer.setRenderTarget(prevRT);
  this.read = write;
  this.active = true;
};

//Per water material, every frame.
ARestlessOcean.Passes.MouthPlumePass.prototype.writeUniforms = function(uniforms){
  if(!uniforms.mouthPlumeEnabled) return;
  const on = this.active && this.targets;
  uniforms.mouthPlumeEnabled.value = on ? 1.0 : 0.0;
  if(!on) return;
  uniforms.mouthPlumeMap.value = this.targets[this.read].texture;
  uniforms.mouthPlumeCenter.value.set(this.centerX, this.centerZ);
  uniforms.mouthPlumeHalfWidth.value = ARestlessOcean.Passes.MouthPlumePass.HALF_WIDTH;
  uniforms.mouthPlumeAlbedo.value.copy(this.albedo);
  uniforms.mouthPlumeStrength.value = this.strength;
};

ARestlessOcean.Passes.MouthPlumePass.prototype.dispose = function(){
  if(this.targets){ this.targets[0].dispose(); this.targets[1].dispose(); this.targets = null; }
  if(this.material) this.material.dispose();
  if(this._quad) this._quad.geometry.dispose();
};
