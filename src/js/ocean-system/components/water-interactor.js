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
// CAPSULES (Phase 8e). A sphere at a foot is deep under in waist-deep swell and
// never straddles the surface; what cuts the waterline there is the shin and the
// thigh. A capsule is a segment A→B with a radius: each frame the contact point
// is where the surface crosses the segment (clamped to it: the upper end if it is
// all under, the lower end if it is all out), and everything above (footprint,
// drag head, entry, wade spray) comes from a sphere of the capsule's radius at
// that point. Its velocity is the velocity of the LIMB at that point, not of the
// contact sliding along the limb as the water rises and falls.
//
// A-Frame:  <a-entity water-interactor="radius: 0.3">
//           Several per entity, one per contact point, following named objects
//           inside it (bones work):
//           water-interactor__lhand="target: mixamorigLeftHand; radius: 0.08"
//           and a capsule between two of them:
//           water-interactor__lshin="target: mixamorigLeftFoot; targetEnd: mixamorigLeftLeg; radius: 0.06"
// JS:       const i = new ARestlessOcean.WaterInteraction.Interactor({radius: 0.3});
//           i.update(x, y, z, dtSeconds);  ...  i.dispose();
//           i.updateSegment(ax, ay, az, bx, by, bz, dtSeconds);   //capsule

ARestlessOcean.WaterInteraction = {};

//Spray at a contact point: (x, y, z) on the surface, (nx, ny, nz) the direction
//the water is thrown (up for an entry), speed the closing speed in m/s. countScale
//thins it (wading sprays a little, continuously). radius (m) makes it a BODY splash
//(OceanSplash.emitBodySplash: clumps at the body's own speed, Phase 8e); without it,
//the shore/hull impact burst as before (floats' buoyancy-splash). Returns false when
//there is no splash system to take it.
ARestlessOcean.WaterInteraction.impact = function(x, y, z, speed, nx, ny, nz, countScale, radius){
  const grid = ARestlessOcean.WaterState && ARestlessOcean.WaterState.grid;
  const splash = grid && grid.oceanSplash;
  if(!splash || !(speed > 0.0)) return false;
  if(nx === undefined){ nx = 0.0; ny = 1.0; nz = 0.0; }
  if(radius > 0.0 && splash.emitBodySplash){
    splash.emitBodySplash(x, y, z, nx, ny, nz, speed, radius, countScale);
    return true;
  }
  splash.emitImpact(x, y, z, nx, ny, nz, speed, undefined, undefined, undefined, countScale);
  return true;
};

//A crater where something went in fast: a one-shot depression (DynamicWaves.poke)
//that springs back and rings, sized by the body and the closing speed. Never
//narrower than two ripple cells, or it is all grid-scale noise the solver damps.
//foam: whitewater left in the crater (0..1 coverage, Phase 8e).
ARestlessOcean.WaterInteraction.crater = function(x, z, r, speed, k, foam){
  const DW = ARestlessOcean.DynamicWaves;
  if(!DW || !DW.poke || !(speed > 0.0)) return;
  if(!(k > 0.0) && !(foam > 0.0)) return;
  const R = Math.max(2.0 * r, 2.0 * (DW.DX || 0.125));
  DW.poke(x, z, (k > 0.0) ? Math.min(0.25, k * r * speed) : 0.0, R, foam || 0.0);
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
  //Ripple strength: multiplies how far this point presses the water down (the footprint,
  //drag head included) and its entry crater. Spray is sprayScale's. Phase 8e put the
  //ripples into the geometry, and at 1 a swimming child made rings like an elephant: his
  //chest, thighs, shins and feet each press their own volume into overlapping footprints,
  //and each drag head alone is v²/2g (5 cm at 1 m/s). Fine as normals, far too tall as
  //surface. Lower it per body rather than in the solver, so a hull or a rock keeps its size.
  this.rippleScale = (opts.rippleScale === undefined) ? 1.0 : opts.rippleScale;
  //Foam (Phase 8e): whitewater this point churns into the DynamicWaves foam channel.
  //While it cuts the waterline moving through the water faster than foamMinSpeed it adds
  //foamK × (speed − foamMinSpeed) coverage per second at its footprint (capped at 1.5×
  //foamK); an entry leaves foamK × 0.3 × closing speed (capped at 1). 0 turns it off.
  //Not scaled by rippleScale: how white the water goes is the churn, not the wave height.
  this.foamK = (opts.foamK === undefined) ? 1.0 : opts.foamK;
  this.foamMinSpeed = (opts.foamMinSpeed === undefined) ? 0.3 : opts.foamMinSpeed;
  //Idle rings (Phase 8e): something alive in the water is never still. A kid treading
  //water sculls with his hands and kicks, and games show it with a steady ring off the
  //body even at rest. While the point straddles the surface its footprint breathes by
  //±idleRipple metres at idleRate Hz (a random phase per point, so a body's points do not
  //pulse in lockstep); the change is what the water rings with. 0 = off (floats, debris).
  this.idleRipple = (opts.idleRipple === undefined) ? 0.0 : opts.idleRipple;
  this.idleRate = (opts.idleRate === undefined) ? 1.2 : opts.idleRate;
  this._idlePhase = Math.random() * Math.PI * 2.0;
  this._idleT = 0.0;
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
  const st = this.state;
  dt = (dt > 1e-4) ? Math.min(dt, 0.1) : 0.0;

  //Own velocity, by difference. A first frame (or a teleport) reads as still,
  //and sprays nothing: in a current, "still" would read as wading upstream.
  const known = this._velocity(this._prev || (this._prev = {x: x, y: y, z: z, fresh: true}), x, y, z, dt, st);
  this._prev.x = x; this._prev.y = y; this._prev.z = z;
  const s = ARestlessOcean.getWaterStateAt
    ? (this._ws = ARestlessOcean.getWaterStateAt(x, z, this._ws, this._wsOpts)) : null;
  return this._step(s, x, y, z, known, dt);
};

//Capsule A→B (see the header). One water query per frame, at the XZ where the
//contact was last frame (the surface barely moves along a limb in one frame, and
//the probe is keyed to this interactor, so it follows).
ARestlessOcean.WaterInteraction.Interactor.prototype.updateSegment = function(ax, ay, az, bx, by, bz, dt){
  const st = this.state;
  dt = (dt > 1e-4) ? Math.min(dt, 0.1) : 0.0;
  const q = this._qXZ || (this._qXZ = {x: 0.5 * (ax + bx), z: 0.5 * (az + bz)});
  const s = ARestlessOcean.getWaterStateAt
    ? (this._ws = ARestlessOcean.getWaterStateAt(q.x, q.z, this._ws, this._wsOpts)) : null;
  const wet = !!(s && s.status !== 'dry' && s.surfaceY !== null);
  //Where the surface crosses the segment. Ripple-free, like the footprint (_step),
  //so the contact does not slide down into its own depression.
  const t = wet ? ARestlessOcean.WaterInteraction.segmentContact(ay, by, s.surfaceY - (s.ripple || 0.0)) : 0.5;
  const x = ax + t * (bx - ax), y = ay + t * (by - ay), z = az + t * (bz - az);
  q.x = x; q.z = z;
  //The limb's own velocity at parameter t: the ends by difference, interpolated.
  const pa = this._prevA || (this._prevA = {x: ax, y: ay, z: az, fresh: true});
  const pb = this._prevB || (this._prevB = {x: bx, y: by, z: bz, fresh: true});
  const va = this._va || (this._va = {vx: 0.0, vy: 0.0, vz: 0.0});
  const vb = this._vb || (this._vb = {vx: 0.0, vy: 0.0, vz: 0.0});
  const known = this._velocity(pa, ax, ay, az, dt, va) & this._velocity(pb, bx, by, bz, dt, vb);
  st.vx = va.vx + t * (vb.vx - va.vx);
  st.vy = va.vy + t * (vb.vy - va.vy);
  st.vz = va.vz + t * (vb.vz - va.vz);
  pa.x = ax; pa.y = ay; pa.z = az;
  pb.x = bx; pb.y = by; pb.z = bz;
  st.contactT = t;
  return this._step(s, x, y, z, !!known, dt);
};

//Parameter t ∈ [0, 1] along A→B where the height equals surfaceY; the higher end
//when the segment is all under, the lower end when it is all out. A level segment
//(a forearm lying on the water) takes its middle.
ARestlessOcean.WaterInteraction.segmentContact = function(ay, by, surfaceY){
  const dy = by - ay;
  if(Math.abs(dy) < 1e-4) return 0.5;
  return Math.min(1.0, Math.max(0.0, (surfaceY - ay) / dy));
};

//Velocity of a tracked point by difference into out.{vx,vy,vz}; false (and zero)
//on a first frame or a teleport (> 20 m/s).
ARestlessOcean.WaterInteraction.Interactor.prototype._velocity = function(prev, x, y, z, dt, out){
  let known = !prev.fresh && dt > 0.0;
  prev.fresh = false;
  if(known){
    out.vx = (x - prev.x) / dt;
    out.vy = (y - prev.y) / dt;
    out.vz = (z - prev.z) / dt;
    if(out.vx * out.vx + out.vy * out.vy + out.vz * out.vz > 400.0) known = false;
  }
  if(!known){ out.vx = 0.0; out.vy = 0.0; out.vz = 0.0; }
  return known;
};

//The contact point (x, y, z), its velocity already in state.v*, against water state s.
ARestlessOcean.WaterInteraction.Interactor.prototype._step = function(s, x, y, z, known, dt){
  const WI = ARestlessOcean.WaterInteraction;
  const st = this.state;
  const r = this.radius;
  this._cool = Math.max(0.0, this._cool - dt);
  this._idleT += dt;
  const wet = !!(s && s.status !== 'dry' && s.surfaceY !== null);
  st.status = s ? s.status : null;
  st.surfaceY = wet ? s.surfaceY : null;
  if(!wet){
    this._setSubmerged(0.0, 0.0, x, y, z, 0.0, 0.0, 0.0);
    return st;
  }
  st.waterVX = s.flowX + s.orbitalX;
  st.waterVY = s.orbitalY;
  st.waterVZ = s.flowZ + s.orbitalZ;
  const depth = s.surfaceY - y;
  const frac = WI.sphereFraction((depth + r) / (2.0 * r));
  const was = st.submerged;
  //Phase 8e: the footprint is sized against the water WITHOUT the dynamic ripples
  //(surfaceY − ripple, see getWaterStateAt). The drawn surface now includes them,
  //and this point's own depression under it read as "less submerged", so the
  //footprint shrank, the water sprang back, the footprint grew: a loop that rings.
  const calmDepth = depth - (s.ripple || 0.0);
  const calmFrac = WI.sphereFraction((calmDepth + r) / (2.0 * r));
  //Speed through the water (the probe's water velocity is the drawn water's own, so a
  //body riding the waves is not "moving" through them), for the drag head below.
  //Without the probe the horizontal orbital is the twin's, phase-random against the drawn
  //sea (~1 m/s rms at 8 m/s wind): measure against the current only, as wading spray does.
  const inPhase = s.source === 'probe';
  const ux = st.vx - (inPhase ? st.waterVX : s.flowX), uy = st.vy - st.waterVY,
        uz = st.vz - (inPhase ? st.waterVZ : s.flowZ);
  this._rel2 = known ? (ux * ux + uy * uy + uz * uz) : 0.0;
  this._setSubmerged(frac, depth, x, y, z, was, calmFrac, calmDepth);

  if(known && this.splash && this._cool <= 0.0 && frac > this.contactFraction){
    //Entry: the water closing on the point (water up, point down) while the sphere
    //still straddles the surface.
    const closing = st.waterVY - st.vy;
    if(frac < 0.98 && closing > this.splashMinSpeed){
      WI.impact(x, s.surfaceY, z, closing, undefined, undefined, undefined, this.sprayScale, r);
      WI.crater(x, z, r, closing, this.craterK * this.rippleScale, Math.min(1.0, this.foamK * 0.3 * closing));
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
        WI.impact(x + rx * inv * r, s.surfaceY, z + rz * inv * r, rel, 0.6 * rx * inv, 0.8, 0.6 * rz * inv, 0.35 * this.sprayScale, r);
        this._cool = this.splashCooldown;
      }
    }
  }
  return st;
};

//Submerged fraction → the enter/exit edges; the ripple-free fraction and depth
//(calmFrac, calmDepth) → the ripple emitter.
ARestlessOcean.WaterInteraction.Interactor.prototype._setSubmerged = function(frac, depth, x, y, z, was, calmFrac, calmDepth){
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
  const a = Math.sqrt(Math.max(0.0, r * r - calmDepth * calmDepth));
  //Never under two ripple cells (DX 0.125 m). A hand's waterline is ~6 cm, and a
  //footprint that small only excites grid-scale modes, which the solver's viscosity
  //kills in ~0.2 s: the water took the energy and showed nothing (a submerged chest
  //pressed 0.7 m into an 8 cm spot, headless 2026-09-27). Same displaced volume,
  //spread over an area the grid can ring.
  const R = Math.max(a, 0.5 * r, 2.0 * (DW.DX || 0.125));
  const vol = calmFrac * (4.0 / 3.0) * Math.PI * r * r * r;
  const deep = calmDepth > r ? Math.exp(-(calmDepth - r) / r) : 1.0;
  e.x = x; e.z = z;
  e.radius = R;
  const head = (calmFrac > this.contactFraction && this.dragK > 0.0)
    ? Math.min(0.3, this.dragK * (this._rel2 || 0.0) / (2.0 * 9.81)) : 0.0;
  //Idle breathing while straddling the surface (see idleRipple).
  let idle = 0.0;
  if(this.idleRipple > 0.0 && calmFrac > this.contactFraction && calmFrac < 0.95){
    idle = this.idleRipple * Math.sin(this._idleT * 2.0 * Math.PI * this.idleRate + this._idlePhase);
  }
  e.depth = this.rippleScale * (deep * (vol / (Math.PI * R * R) + head) + idle);
  //Foam while straddling the surface and moving through the water.
  const straddle = calmFrac > this.contactFraction && calmFrac < 0.95;
  const rel = Math.sqrt(this._rel2 || 0.0);
  e.foam = (straddle && this.foamK > 0.0)
    ? this.foamK * Math.min(1.5, Math.max(0.0, rel - this.foamMinSpeed)) : 0.0;
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
      //Phase 8e: a second object makes this a CAPSULE from target to targetEnd
      //(e.g. foot → knee), contacting the water where the surface crosses it.
      targetEnd: {type: 'string', default: ''},
      offsetEnd: {type: 'vec3', default: {x: 0, y: 0, z: 0}},
      radius: {type: 'number', default: 0.3},
      //Local offset from the target, in the target's space.
      offset: {type: 'vec3', default: {x: 0, y: 0, z: 0}},
      ripples: {type: 'boolean', default: true},
      splash: {type: 'boolean', default: true},
      splashMinSpeed: {type: 'number', default: 0.8},
      wadeMinSpeed: {type: 'number', default: 1.2},
      craterK: {type: 'number', default: 0.5},
      rippleScale: {type: 'number', default: 1.0},
      foamK: {type: 'number', default: 1.0},
      idleRipple: {type: 'number', default: 0.0},
      idleRate: {type: 'number', default: 1.2},
      foamMinSpeed: {type: 'number', default: 0.3},
      dragK: {type: 'number', default: 1.0},
      sprayScale: {type: 'number', default: 1.0},
      probe: {type: 'boolean', default: true},
      enabled: {type: 'boolean', default: true}
    },
    init: function(){
      const self = this;
      this._world = new THREE.Vector3();
      this._worldEnd = new THREE.Vector3();
      this._target = null;
      this._targetEnd = null;
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
      i.rippleScale = Math.max(0.0, d.rippleScale);
      i.foamK = Math.max(0.0, d.foamK);
      i.idleRipple = Math.max(0.0, d.idleRipple);
      i.idleRate = Math.max(0.0, d.idleRate);
      i.foamMinSpeed = d.foamMinSpeed;
      i.dragK = d.dragK;
      i.sprayScale = d.sprayScale;
      i.probe = d.probe;
      i._wsOpts.probe = d.probe ? i._probeKey : undefined;
      this._target = null;   //re-resolve (the model may have changed)
      this._targetEnd = null;
      if(!d.enabled) i.dispose();
    },
    _resolveTarget: function(){
      if(this._target) return this._target;
      const name = this.data.target;
      const root = this.el.object3D;
      this._target = name ? root.getObjectByName(name) : root;
      return this._target;   //null until a model with that name has loaded
    },
    _resolveTargetEnd: function(){
      if(this._targetEnd) return this._targetEnd;
      this._targetEnd = this.el.object3D.getObjectByName(this.data.targetEnd) || null;
      return this._targetEnd;
    },
    tick: function(time, timeDelta){
      if(!this.data.enabled) return;
      const t = this._resolveTarget();
      if(!t) return;
      const o = this.data.offset;
      t.updateWorldMatrix(true, false);
      this._world.set(o.x, o.y, o.z);
      t.localToWorld(this._world);
      const dt = (timeDelta || 16.7) / 1000.0;
      if(this.data.targetEnd){
        const e = this._resolveTargetEnd();
        if(!e) return;
        const oe = this.data.offsetEnd;
        e.updateWorldMatrix(true, false);
        this._worldEnd.set(oe.x, oe.y, oe.z);
        e.localToWorld(this._worldEnd);
        const a = this._world, b = this._worldEnd;
        this.interactor.updateSegment(a.x, a.y, a.z, b.x, b.y, b.z, dt);
        return;
      }
      this.interactor.update(this._world.x, this._world.y, this._world.z, dt);
    },
    remove: function(){
      this.interactor.dispose();
    }
  });
}
