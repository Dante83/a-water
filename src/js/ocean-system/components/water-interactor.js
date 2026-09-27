//=============================================================================
// WaterInteraction — anything that touches the water (Phase 8c).
//=============================================================================
//
// One way in for everything that is not the water: a hand, a foot, a hull, a
// thrown rock. Each contact point is an Interactor, a sphere that follows a
// world position. Every frame it asks getWaterStateAt where the water is and
// answers three things:
//
//   RIPPLES  a DynamicWaves emitter: a Gaussian of the waterline radius pressed
//            down by the displaced volume. Only the change is injected, so a
//            leg held still is quiet, a leg dipping rings, a leg walking wakes.
//   SPRAY    WaterInteraction.impact() into the shared splash emitter: on entry
//            (the water closing on the point faster than splashMinSpeed) and
//            while wading (moving through the waterline faster than
//            wadeMinSpeed relative to the current).
//   EVENTS   'water-enter' / 'water-exit' on the entity, and a `state` object
//            (submerged fraction, depth, surface height, the water's velocity)
//            for whoever animates the thing: swim vs wade vs walk.
//
// The buoyant component predates this and keeps its own box-footprint emitter;
// its buoyancy-splash event now goes through WaterInteraction.impact() too, so
// spray from floats and from interactors is the same spray.
//
// A-Frame:  <a-entity water-interactor="radius: 0.3">
//           Several per entity, one per contact point, following named objects
//           inside it (bones work):
//           water-interactor__lhand="target: mixamorigLeftHand; radius: 0.08"
// JS:       const i = new ARestlessOcean.WaterInteraction.Interactor({radius: 0.3});
//           i.update(x, y, z, dtSeconds);  ...  i.dispose();

ARestlessOcean.WaterInteraction = {};

//Spray at a contact point: (x, y, z) on the surface, (nx, ny, nz) the direction
//the water is thrown (up for an entry), speed the closing speed in m/s. countScale
//thins it (wading sprays a little, continuously). Returns false when there is no
//splash system to take it.
ARestlessOcean.WaterInteraction.impact = function(x, y, z, speed, nx, ny, nz, countScale){
  const grid = ARestlessOcean.WaterState && ARestlessOcean.WaterState.grid;
  const splash = grid && grid.oceanSplash;
  if(!splash || !(speed > 0.0)) return false;
  if(nx === undefined){ nx = 0.0; ny = 1.0; nz = 0.0; }
  splash.emitImpact(x, y, z, nx, ny, nz, speed, undefined, undefined, undefined, countScale);
  return true;
};

//A crater where something went in fast: a one-shot depression (DynamicWaves.poke)
//that springs back and rings, sized by the body and the closing speed. Never
//narrower than two ripple cells, or it is all grid-scale noise the solver damps.
ARestlessOcean.WaterInteraction.crater = function(x, z, r, speed, k){
  const DW = ARestlessOcean.DynamicWaves;
  if(!DW || !DW.poke || !(k > 0.0) || !(speed > 0.0)) return;
  const R = Math.max(2.0 * r, 2.0 * (DW.DX || 0.125));
  DW.poke(x, z, Math.min(0.25, k * r * speed), R);
};

//Volume fraction of a sphere under a plane cutting it at normalised height t
//(0 = touching from above, 1 = just covered): t²(3 − 2t).
ARestlessOcean.WaterInteraction.sphereFraction = function(t){
  t = Math.min(1.0, Math.max(0.0, t));
  return t * t * (3.0 - 2.0 * t);
};

//─────────────────────────────────────────────────────────────────────────────
ARestlessOcean.WaterInteraction.Interactor = function(opts){
  opts = opts || {};
  this.radius = opts.radius || 0.3;
  this.ripples = opts.ripples !== false;
  this.splash = opts.splash !== false;
  //Entry spray: the water closing on the point at least this fast (m/s).
  this.splashMinSpeed = (opts.splashMinSpeed === undefined) ? 0.8 : opts.splashMinSpeed;
  //Wading spray: moving through the waterline at least this fast relative to the water.
  this.wadeMinSpeed = (opts.wadeMinSpeed === undefined) ? 1.2 : opts.wadeMinSpeed;
  this.splashCooldown = (opts.splashCooldown === undefined) ? 0.15 : opts.splashCooldown;
  //Entry crater: going in at speed throws the water out of the way, a hole far bigger
  //than the body's own volume, and that hole is what rings. Depth = craterK · radius ·
  //closing speed (m), capped; 0 turns it off. A foot at 3 m/s: ~10 cm.
  this.craterK = (opts.craterK === undefined) ? 0.5 : opts.craterK;
  //Moving through the water pushes it aside: the stagnation head v²/2g of the speed
  //relative to the water, added to the footprint while the point is at the surface.
  //1 = that head as is (1 m/s: 5 cm, 2 m/s: 20 cm). Displaced volume alone rang a
  //treading hand at millimetres; it is the motion that makes a swimmer's rings.
  this.dragK = (opts.dragK === undefined) ? 1.0 : opts.dragK;
  //Spray amount: multiplies the particles every entry and wade burst throws.
  this.sprayScale = (opts.sprayScale === undefined) ? 1.0 : opts.sprayScale;
  //Ask a-water for an exact surface probe at this point (getWaterStateAt opts.probe), so
  //the waterline is the DRAWN one — the one a body riding the waves is floating on. Against
  //the coarse snapshot a chest riding the swell flickered in and out of the water with the
  //wave phase and rang the water for nothing. Falls back to the snapshot when the probe
  //slots (16) are taken.
  this.probe = opts.probe !== false;
  this._probeKey = 'wi-' + (ARestlessOcean.WaterInteraction._n = (ARestlessOcean.WaterInteraction._n || 0) + 1);
  this._wsOpts = {velocity: true, probe: this.probe ? this._probeKey : undefined};
  //Below this submerged fraction the point counts as out of the water.
  this.contactFraction = 0.02;
  //What the owner reads.
  this.state = {
    inWater: false,
    submerged: 0.0,       //volume fraction of the sphere under the surface, 0..1
    depth: 0.0,           //centre below the surface, m (negative: above)
    surfaceY: null,
    status: null,         //getWaterStateAt status
    //Current + wave orbital velocity. Vertical is the rendered surface's own rise
    //near the camera; horizontal orbital is the twin's (right size, phase unknown).
    waterVX: 0.0, waterVY: 0.0, waterVZ: 0.0,
    vx: 0.0, vy: 0.0, vz: 0.0                   //the point's own velocity
  };
  this.onEnter = opts.onEnter || null;
  this.onExit = opts.onExit || null;
  this._emitter = null;
  this._prev = null;
  this._cool = 0.0;
  this._ws = null;
};

ARestlessOcean.WaterInteraction.Interactor.prototype.update = function(x, y, z, dt){
  const WI = ARestlessOcean.WaterInteraction;
  const st = this.state;
  const r = this.radius;
  dt = (dt > 1e-4) ? Math.min(dt, 0.1) : 0.0;

  //Own velocity, by difference. A first frame (or a teleport) reads as still,
  //and sprays nothing: in a current, "still" would read as wading upstream.
  let known = !!(this._prev && dt > 0.0);
  if(known){
    st.vx = (x - this._prev.x) / dt;
    st.vy = (y - this._prev.y) / dt;
    st.vz = (z - this._prev.z) / dt;
    if(st.vx * st.vx + st.vy * st.vy + st.vz * st.vz > 400.0){ st.vx = 0.0; st.vy = 0.0; st.vz = 0.0; known = false; }
  } else {
    st.vx = 0.0; st.vy = 0.0; st.vz = 0.0;
  }
  this._prev = this._prev || {};
  this._prev.x = x; this._prev.y = y; this._prev.z = z;
  this._cool = Math.max(0.0, this._cool - dt);

  const s = ARestlessOcean.getWaterStateAt
    ? (this._ws = ARestlessOcean.getWaterStateAt(x, z, this._ws, this._wsOpts)) : null;
  const wet = !!(s && s.status !== 'dry' && s.surfaceY !== null);
  st.status = s ? s.status : null;
  st.surfaceY = wet ? s.surfaceY : null;
  if(!wet){
    this._setSubmerged(0.0, 0.0, x, y, z, 0.0);
    return st;
  }
  st.waterVX = s.flowX + s.orbitalX;
  st.waterVY = s.orbitalY;
  st.waterVZ = s.flowZ + s.orbitalZ;
  const depth = s.surfaceY - y;
  const frac = WI.sphereFraction((depth + r) / (2.0 * r));
  const was = st.submerged;
  //Speed through the water (the probe's water velocity is the drawn water's own, so a
  //body riding the waves is not "moving" through them), for the drag head below.
  //Without the probe the horizontal orbital is the twin's, phase-random against the drawn
  //sea (~1 m/s rms at 8 m/s wind): measure against the current only, as wading spray does.
  const inPhase = s.source === 'probe';
  const ux = st.vx - (inPhase ? st.waterVX : s.flowX), uy = st.vy - st.waterVY,
        uz = st.vz - (inPhase ? st.waterVZ : s.flowZ);
  this._rel2 = known ? (ux * ux + uy * uy + uz * uz) : 0.0;
  this._setSubmerged(frac, depth, x, y, z, was);

  if(known && this.splash && this._cool <= 0.0 && frac > this.contactFraction){
    //Entry: the water closing on the point (water up, point down) while the sphere
    //still straddles the surface.
    const closing = st.waterVY - st.vy;
    if(frac < 0.98 && closing > this.splashMinSpeed){
      WI.impact(x, s.surfaceY, z, closing, undefined, undefined, undefined, this.sprayScale);
      WI.crater(x, z, r, closing, this.craterK);
      this._cool = this.splashCooldown;
    } else if(frac < 0.9){
      //Wading: through the waterline sideways, relative to the CURRENT. Not to the
      //waves' orbital velocity: the analytic twin's phases are not the rendered
      //sea's, and its ~1 m/s rms orbital (8 m/s wind) made a slow wader spray at
      //random (headless 2026-09-26). state.waterV* keeps the full velocity.
      const rx = st.vx - s.flowX, rz = st.vz - s.flowZ;
      const rel = Math.sqrt(rx * rx + rz * rz);
      if(rel > this.wadeMinSpeed){
        const inv = 1.0 / rel;
        WI.impact(x + rx * inv * r, s.surfaceY, z + rz * inv * r, rel, 0.6 * rx * inv, 0.8, 0.6 * rz * inv, 0.35 * this.sprayScale);
        this._cool = this.splashCooldown;
      }
    }
  }
  return st;
};

//Submerged fraction → the ripple emitter and the enter/exit edges.
ARestlessOcean.WaterInteraction.Interactor.prototype._setSubmerged = function(frac, depth, x, y, z, was){
  const st = this.state;
  const r = this.radius;
  st.submerged = frac;
  st.depth = depth;
  const inWater = frac > this.contactFraction;
  if(inWater !== st.inWater){
    st.inWater = inWater;
    const cb = inWater ? this.onEnter : this.onExit;
    if(cb) cb(this, st);
  }
  const DW = ARestlessOcean.DynamicWaves;
  if(!this.ripples || !DW) return;
  if(!this._emitter || this._emitter._removed) this._emitter = DW.addEmitter();
  const e = this._emitter;
  //Waterline radius where the surface cuts the sphere; a fully covered sphere
  //still bulges the surface over itself, less the deeper it goes.
  const a = Math.sqrt(Math.max(0.0, r * r - depth * depth));
  //Never under two ripple cells (DX 0.125 m). A hand's waterline is ~6 cm, and a
  //footprint that small only excites grid-scale modes, which the solver's viscosity
  //kills in ~0.2 s: the water took the energy and showed nothing (a submerged chest
  //pressed 0.7 m into an 8 cm spot, headless 2026-09-27). Same displaced volume,
  //spread over an area the grid can ring.
  const R = Math.max(a, 0.5 * r, 2.0 * (DW.DX || 0.125));
  const vol = frac * (4.0 / 3.0) * Math.PI * r * r * r;
  const deep = depth > r ? Math.exp(-(depth - r) / r) : 1.0;
  e.x = x; e.z = z;
  e.radius = R;
  const head = (frac > this.contactFraction && this.dragK > 0.0)
    ? Math.min(0.3, this.dragK * (this._rel2 || 0.0) / (2.0 * 9.81)) : 0.0;
  e.depth = deep * (vol / (Math.PI * R * R) + head);
  e.active = true;
};

ARestlessOcean.WaterInteraction.Interactor.prototype.dispose = function(){
  if(this._emitter){ this._emitter.remove(); this._emitter = null; }
};

//─────────────────────────────────────────────────────────────────────────────
if(typeof AFRAME !== 'undefined' && !AFRAME.components['water-interactor']){
  AFRAME.registerComponent('water-interactor', {
    multiple: true,
    schema: {
      //Name of an object inside this entity to follow (a bone, a mesh); '' = the entity.
      target: {type: 'string', default: ''},
      radius: {type: 'number', default: 0.3},
      //Local offset from the target, in the target's space.
      offset: {type: 'vec3', default: {x: 0, y: 0, z: 0}},
      ripples: {type: 'boolean', default: true},
      splash: {type: 'boolean', default: true},
      splashMinSpeed: {type: 'number', default: 0.8},
      wadeMinSpeed: {type: 'number', default: 1.2},
      craterK: {type: 'number', default: 0.5},
      dragK: {type: 'number', default: 1.0},
      sprayScale: {type: 'number', default: 1.0},
      probe: {type: 'boolean', default: true},
      enabled: {type: 'boolean', default: true}
    },
    init: function(){
      const self = this;
      this._world = new THREE.Vector3();
      this._target = null;
      this.interactor = new ARestlessOcean.WaterInteraction.Interactor({
        onEnter: function(i, st){ self.el.emit('water-enter', {id: self.id, state: st}, false); },
        onExit: function(i, st){ self.el.emit('water-exit', {id: self.id, state: st}, false); }
      });
      this.state = this.interactor.state;
    },
    update: function(){
      const d = this.data;
      const i = this.interactor;
      i.radius = Math.max(0.01, d.radius);
      i.ripples = d.ripples;
      i.splash = d.splash;
      i.splashMinSpeed = d.splashMinSpeed;
      i.wadeMinSpeed = d.wadeMinSpeed;
      i.craterK = d.craterK;
      i.dragK = d.dragK;
      i.sprayScale = d.sprayScale;
      i.probe = d.probe;
      i._wsOpts.probe = d.probe ? i._probeKey : undefined;
      this._target = null;   //re-resolve (the model may have changed)
      if(!d.enabled) i.dispose();
    },
    _resolveTarget: function(){
      if(this._target) return this._target;
      const name = this.data.target;
      const root = this.el.object3D;
      this._target = name ? root.getObjectByName(name) : root;
      return this._target;   //null until a model with that name has loaded
    },
    tick: function(time, timeDelta){
      if(!this.data.enabled) return;
      const t = this._resolveTarget();
      if(!t) return;
      const o = this.data.offset;
      t.updateWorldMatrix(true, false);
      this._world.set(o.x, o.y, o.z);
      t.localToWorld(this._world);
      this.interactor.update(this._world.x, this._world.y, this._world.z, (timeDelta || 16.7) / 1000.0);
    },
    remove: function(){
      this.interactor.dispose();
    }
  });
}
