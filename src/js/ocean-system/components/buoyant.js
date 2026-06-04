//=============================================================================
// buoyant — float an entity on the analytic ocean wave field.
//=============================================================================
//
// Two solvers, picked with `solver:`:
//
//   rigid  (default) — a real force-based buoyancy integrator. We sample the
//     submerged volume of the object column-by-column over its footprint and
//     apply Archimedes' force (ρ_water·g·V_submerged) against gravity, plus the
//     righting TORQUE that arises because the deeper side of a tilted hull gets
//     pushed up harder. So a body finds its own waterline from its `density`,
//     bobs, and rocks/rights itself in a swell — genuine physics, not a fake.
//     What keeps it from the classic exploding-rigid-body failure ("BOING") is
//     an ENERGY GOVERNOR: drag is physically ~quadratic (form drag) and we
//     additionally scale it by the body's instantaneous mechanical energy, so
//     calm bodies float freely while energetic ones get bled hard at the
//     extremes. That governor — plus implicit (unconditionally stable) damping
//     and hard velocity/tilt clamps — is what lets us run real torque physics on
//     whatever geometry/scale a player throws in without it x-flipping into
//     orbit.
//
//   kinematic — the forgiving plane-fit fallback. No forces: we fit a plane
//     through the sampled water heights under the probes and drive position +
//     tilt toward it (damped), with a gravity/spring ENTRY phase so a dropped or
//     submerged object falls/rises onto the surface before latching to wave
//     tracking. Can't tip or oscillate; good for a buoy or a "junk geometry"
//     prop where you never want surprises.
//
// Probe layout (the footprint we sample over) comes from a sibling
// `buoyancy-hull` component if present, else it's auto-derived from the object's
// bounding box (4 footprint corners). Bare `buoyant` on any model Just Works.
//
// ASSUMPTION: the entity is a direct child of the scene (its object3D transform
// is world space). That covers the common "prop floating on the sea" case. If
// you nest it under a moving rig, parent-relative handling isn't done yet.
//
// Needs the ocean's analytic field (ocean-wave-field.js) live at
// AWater.AOcean.waveField; until the ocean finishes booting, tick no-ops.

AFRAME.registerComponent('buoyancy-hull', {
  schema: {
    //Local-space probe footprint as "x z, x z, ..." (metres, object local XZ
    //before scale). Empty → auto: 4 corners of the bounding-box footprint.
    'points': {type: 'string', default: ''},
    //Pull auto bbox corners inward by this factor so probes sit on the hull,
    //not out past the bowsprit/overhang. 1 = exact corners.
    'inset': {type: 'number', default: 0.85}
  },
  init: function(){
    this.localProbes = null; //Array<{x, z}> resolved lazily (model loads async).
    this.parseExplicit();
    //Re-resolve the auto bbox whenever the model swaps in.
    this.el.addEventListener('object3dset', () => { if(!this.explicit) this.localProbes = null; });
    this.el.addEventListener('model-loaded', () => { if(!this.explicit) this.localProbes = null; });
  },
  update: function(){
    this.parseExplicit();
  },
  parseExplicit: function(){
    const raw = (this.data.points || '').trim();
    if(raw.length === 0){ this.explicit = false; this.localProbes = null; return; }
    const probes = [];
    raw.split(',').forEach((pair) => {
      const t = pair.trim().split(/\s+/).map(parseFloat);
      if(t.length >= 2 && isFinite(t[0]) && isFinite(t[1])){ probes.push({x: t[0], z: t[1]}); }
    });
    this.explicit = probes.length > 0;
    this.localProbes = this.explicit ? probes : null;
  },
  //Resolve (and cache) the local-space probe XZ list. Returns null until a
  //non-empty bounding box is available (async model still loading).
  getLocalProbes: function(){
    if(this.localProbes) return this.localProbes;
    const box = new THREE.Box3().setFromObject(this.el.object3D);
    if(box.isEmpty()) return null;
    //Bounding box is in WORLD units; convert footprint half-extents back to the
    //object's LOCAL frame so probes ride with its scale/yaw at sample time.
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const inv = new THREE.Matrix4().copy(this.el.object3D.matrixWorld).invert();
    const corners = [
      new THREE.Vector3(center.x + size.x * 0.5, center.y, center.z + size.z * 0.5),
      new THREE.Vector3(center.x - size.x * 0.5, center.y, center.z + size.z * 0.5),
      new THREE.Vector3(center.x + size.x * 0.5, center.y, center.z - size.z * 0.5),
      new THREE.Vector3(center.x - size.x * 0.5, center.y, center.z - size.z * 0.5)
    ];
    const inset = this.data.inset;
    this.localProbes = corners.map((c) => {
      c.applyMatrix4(inv);
      return {x: c.x * inset, z: c.z * inset};
    });
    return this.localProbes;
  }
});

AFRAME.registerComponent('buoyant', {
  //buoyancy-hull is optional but, if present, supplies the probe footprint.
  dependencies: [],
  schema: {
    'enabled': {type: 'boolean', default: true},
    //'rigid' = force-based Archimedes + torque (real physics, energy-governed).
    //'kinematic' = forgiving plane-fit + spring entry (can't tip or ring).
    'solver': {type: 'string', default: 'rigid'},
    //Where height samples come from (rigid solver):
    //  'fft' (default) = the EXACT rendered surface via the cached local height
    //               field (ocean-grid: a small camera-following RT, one tiny
    //               async read/frame shared by every float). Rides the water you
    //               SEE. Outside that region (far from camera) or before it
    //               resolves, falls back to analytic PER SAMPLE automatically.
    //  'analytic' = the CPU Gerstner twin (ocean-wave-field.js): ~46 cos across
    //               all cascades, ZERO GPU readback, worker/headless-friendly and
    //               the seam a future SIMD/WASM accel slots under — but its
    //               crests are phase-decoupled, so a float hovers over rendered
    //               troughs on big swell. Use for crowds / far-field / no-GPU.
    'source': {type: 'string', default: 'fft'},
    //Explicit body box dimensions "x y z" in LOCAL units (same convention as
    //`geometry` width/height/depth — the entity's scale is applied on top). This
    //drives the mass/volume/inertia AND the auto probe footprint, so you can size
    //the float exactly instead of trusting the bounding box. 0 0 0 (default) =
    //auto: read a box `geometry` if the entity has one, else fall back to the
    //world bounding box. So set `geometry` and `size` to the same numbers (or
    //just set `geometry` and let it bind) and the mesh + physics stay in lockstep.
    'size': {type: 'vec3', default: {x: 0, y: 0, z: 0}},
    //Density RELATIVE to water. <1 floats; the body settles with this fraction
    //of its volume submerged (0.5 ⇒ half under). 1 = neutrally buoyant; >1 sinks.
    'density': {type: 'number', default: 0.5},
    //Gravitational acceleration (m/s²). Drives both the rigid weight and the
    //kinematic entry free-fall.
    'gravity': {type: 'number', default: 9.8},
    //Apply pitch/roll. rigid: enables righting torque. kinematic: tilt to slope.
    //Off = pure bob (buoy).
    'tilt': {type: 'boolean', default: true},
    //Clamp total tilt away from upright (degrees). A hard safety wall; on hit we
    //also bleed angular energy so it doesn't pump against the clamp.
    'maxTilt': {type: 'number', default: 25.0},

    //--- rigid-solver drag / energy governor ---------------------------------
    //Linear viscous drag (1/s): gentle damping that's always present.
    'linearDrag': {type: 'number', default: 0.8},
    //Linear FORM drag (per m/s): the quadratic, fluid-like term that bites hard
    //at speed — this is most of what kills vertical "BOING".
    'formDrag': {type: 'number', default: 0.25},
    //Angular viscous + form drag, same idea for pitch/roll.
    'angularDrag': {type: 'number', default: 1.2},
    'angularFormDrag': {type: 'number', default: 0.4},
    //Energy-governor gain. Drag is multiplied by (1 + energyDamping · E/E_ref),
    //so the more mechanical energy the body carries, the more it's dissipated at
    //the extremes. 0 = pure (quadratic) fluid drag, no governor. This is the
    //artificial energy reduction that keeps the solver tame on bad input.
    'energyDamping': {type: 'number', default: 0.6},

    //--- kinematic-solver knobs (ignored by rigid) ---------------------------
    //Vertical origin offset vs. the surface at rest (metres).
    'draft': {type: 'number', default: 0.0},
    //Plane-follow response time constant (seconds).
    'damping': {type: 'number', default: 0.25},
    //Entry-phase bob period (seconds) of the spring that lifts a submerged body.
    'bobPeriod': {type: 'number', default: 1.6}
  },
  init: function(){
    //Reusable scratch so tick allocates nothing.
    this._up = new THREE.Vector3(0, 1, 0);
    this._n = new THREE.Vector3(0, 1, 0);
    this._nrm = new THREE.Vector3();
    this._euler = new THREE.Euler();
    this._scratchV = new THREE.Vector3();
    this._axis = new THREE.Vector3(1, 0, 0);
    this._dq = new THREE.Quaternion();
    this._qIdent = new THREE.Quaternion();
    this._qTilt = new THREE.Quaternion();
    this._qPhysTilt = new THREE.Quaternion(); //rigid: accumulated tilt-from-up.
    this._qTarget = new THREE.Quaternion();
    //Authored orientation (heading + model base) we tilt ON TOP of.
    this._baseQuat = this.el.object3D.quaternion.clone();

    //Rigid state.
    this._vy = 0.0;            //vertical velocity (m/s).
    this._wx = 0.0; this._wz = 0.0; //angular velocity about world x / z (rad/s).
    this._body = null;         //cached mass/volume/inertia (see _ensureBody).

    //Kinematic state.
    this._started = false;     //first valid sample snaps; afterwards we damp.
    this._settled = false;     //latched true once the entry phase comes to rest.
    this._wasInAir = false;    //one-shot splash on first water contact.
    this._buoyStiffness = 0.0;
  },
  update: function(){
    //Re-capture the authored heading if the user re-set rotation.
    this._baseQuat.copy(this.el.object3D.quaternion);
    //Buoyant-spring stiffness ω² from the desired bob period (kinematic entry).
    const T = Math.max(0.1, this.data.bobPeriod);
    const omega = (2.0 * Math.PI) / T;
    this._buoyStiffness = omega * omega;
    //size/density/gravity feed the cached body + footprint; force a recompute.
    this._body = null;
    this._autoLocal = null;
  },
  //Resolve the body's LOCAL box extents (pre-scale), or null to fall back to the
  //bounding box. Priority: explicit `size` → a box `geometry` component → null.
  _resolveLocalSize: function(){
    const s = this.data.size;
    if(s && (s.x > 0 || s.y > 0 || s.z > 0)){
      return {x: Math.max(1e-3, s.x), y: Math.max(1e-3, s.y), z: Math.max(1e-3, s.z)};
    }
    //Bind to a box geometry if the entity has one (a-box, geometry="primitive:box").
    const geo = this.el.getAttribute('geometry');
    if(geo && (geo.primitive === 'box' || geo.primitive === undefined) &&
       geo.width > 0 && geo.height > 0 && geo.depth > 0){
      return {x: geo.width, y: geo.height, z: geo.depth};
    }
    return null;
  },
  tick: function(time, timeDelta){
    if(!this.data.enabled) return;
    const field = AWater.AOcean.waveField;
    if(!field) return; //ocean not up yet.

    const hull = this.el.components['buoyancy-hull'];
    const local = hull ? hull.getLocalProbes() : this._autoProbes();
    if(!local || local.length === 0) return; //model still loading.

    const obj = this.el.object3D;
    obj.updateMatrixWorld();

    if(this.data.solver === 'kinematic'){
      this._solveKinematic(local, field, obj, time, timeDelta);
    } else {
      this._solveRigid(local, field, obj, time, timeDelta);
    }
  },

  //===========================================================================
  // RIGID — force-based Archimedes buoyancy + righting torque, energy-governed.
  //===========================================================================
  _solveRigid: function(local, field, obj, time, timeDelta){
    const body = this._ensureBody(local.length);
    if(!body) return;

    const t = time / 1000.0;
    //Clamp dt: a long stall (tab-out) must not inject a huge impulse.
    const dt = Math.min(0.05, Math.max(0.0, (timeDelta || 16.7) / 1000.0));
    if(dt <= 0.0) return;

    //Pick the height source once per tick. fft → the cached GPU snapshot (exact
    //rendered surface); keep the snapshot warm by requesting it. Until it
    //resolves (or on a renderer without async readback) sampleWaterHeightFFT
    //returns null and we fall back to the analytic twin per-sample.
    const useFFT = (this.data.source !== 'analytic');
    let fftSampler = null;
    if(useFFT && typeof AWater.AOcean.sampleWaterHeightFFT === 'function'){
      if(typeof AWater.AOcean.requestFFTSnapshot === 'function'){ AWater.AOcean.requestFFTSnapshot(); }
      fftSampler = AWater.AOcean.sampleWaterHeightFFT;
    }

    const com = obj.position; //world centre of mass (direct scene child).
    const v = this._scratchV;
    let Fup = 0.0, Tx = 0.0, Tz = 0.0, submHSum = 0.0;

    //Sum buoyancy column-by-column. Each probe owns an equal share of the
    //footprint area; its submerged height × that area is the column's submerged
    //volume → Archimedes force. localToWorld bakes in scale + heading + the
    //CURRENT tilt, so a rolled hull's lower corners read deeper and push back.
    for(let i = 0; i < local.length; i++){
      v.set(local[i].x, 0.0, local[i].z);
      obj.localToWorld(v);
      let waterY = fftSampler ? fftSampler(v.x, v.z) : null;
      if(waterY == null){ waterY = field.sampleHeight(v.x, v.z, t); } //snapshot not ready / analytic.
      //Submerged height of this column, clamped to the body's vertical extent.
      const submH = Math.min(2.0 * body.halfH, Math.max(0.0, waterY - (v.y - body.halfH)));
      submHSum += submH;
      if(submH <= 0.0) continue;
      const Fy = body.rhoG * body.colArea * submH; //upward (N).
      Fup += Fy;
      //Torque about COM from this up-force at lever (rx, rz): τ = r × F.
      const rx = v.x - com.x, rz = v.z - com.z;
      Tx += -rz * Fy;
      Tz +=  rx * Fy;
    }

    //--- Integrate linear (vertical) + angular (pitch/roll) ------------------
    const weight = body.mass * this.data.gravity;
    this._vy += ((Fup - weight) / body.mass) * dt;
    if(this.data.tilt){
      this._wx += (Tx / body.Ix) * dt;
      this._wz += (Tz / body.Iz) * dt;
    } else {
      this._wx = 0.0; this._wz = 0.0;
    }

    //--- Energy governor + fluid drag (implicit ⇒ unconditionally stable) -----
    //E = ½m·v² + ½(Ix·ωx² + Iz·ωz²). Drag grows with E so the more violently the
    //body is moving the harder it's bled — the "more energy ⇒ more edge damping"
    //model. The quadratic form-drag term is real fluid drag; the energy factor
    //is the explicit stability governor on top.
    //Fluid drag only acts on the SUBMERGED part — air drag is negligible, so a
    //body in free fall must not feel water resistance (that bug made gravity look
    //weak: terminal velocity in "air" was ~5 m/s). dragGate is the submerged
    //fraction (0 airborne → 1 fully under), so it's true free-fall above the
    //surface and full damping once it's in.
    const dragGate = submHSum / (local.length * 2.0 * body.halfH);
    const Ek = 0.5 * body.mass * this._vy * this._vy
             + 0.5 * (body.Ix * this._wx * this._wx + body.Iz * this._wz * this._wz);
    const gov = 1.0 + this.data.energyDamping * (Ek / body.eRef);
    const linC = (this.data.linearDrag + this.data.formDrag * Math.abs(this._vy)) * gov * dragGate;
    const angSpeed = Math.sqrt(this._wx * this._wx + this._wz * this._wz);
    const angC = (this.data.angularDrag + this.data.angularFormDrag * angSpeed) * gov * dragGate;
    this._vy /= (1.0 + linC * dt);
    const angAtt = 1.0 / (1.0 + angC * dt);
    this._wx *= angAtt; this._wz *= angAtt;

    //Hard final guards against pathological input (the last line vs. BOING).
    this._vy = Math.max(-40.0, Math.min(40.0, this._vy));

    //--- Apply ----------------------------------------------------------------
    obj.position.y += this._vy * dt;

    if(this.data.tilt){
      //Accumulate the world-frame tilt from angular velocity this step.
      const wlen = Math.sqrt(this._wx * this._wx + this._wz * this._wz);
      if(wlen > 1e-6){
        this._axis.set(this._wx / wlen, 0.0, this._wz / wlen);
        this._dq.setFromAxisAngle(this._axis, wlen * dt);
        this._qPhysTilt.premultiply(this._dq);
        this._qPhysTilt.normalize();
      }
      //Clamp total tilt; if we hit the wall, bleed angular energy so we don't
      //pump against it.
      const maxAng = this.data.maxTilt * Math.PI / 180.0;
      const tiltAng = 2.0 * Math.acos(Math.min(1.0, Math.abs(this._qPhysTilt.w)));
      if(tiltAng > maxAng && tiltAng > 1e-5){
        this._qIdent.identity();
        this._qPhysTilt.slerp(this._qIdent, 1.0 - maxAng / tiltAng);
        this._wx *= 0.3; this._wz *= 0.3;
      }
      this._qTarget.copy(this._qPhysTilt).multiply(this._baseQuat);
      obj.quaternion.copy(this._qTarget);
    }
  },

  //Cache mass / volume / inertia for the rigid solver. Recomputed when the
  //schema changes (density/gravity) or the bbox wasn't ready yet.
  _ensureBody: function(nProbes){
    if(this._body) return this._body;
    //World extents: explicit/geometry LOCAL size × entity scale, else world bbox.
    let sx, sy, sz;
    const localSize = this._resolveLocalSize();
    if(localSize){
      const sc = this.el.object3D.scale;
      sx = Math.max(1e-3, localSize.x * Math.abs(sc.x));
      sy = Math.max(1e-3, localSize.y * Math.abs(sc.y));
      sz = Math.max(1e-3, localSize.z * Math.abs(sc.z));
    } else {
      const box = new THREE.Box3().setFromObject(this.el.object3D);
      if(box.isEmpty()) return null;
      const size = box.getSize(new THREE.Vector3());
      sx = Math.max(1e-3, size.x); sy = Math.max(1e-3, size.y); sz = Math.max(1e-3, size.z);
    }
    const footprint = sx * sz;
    const volume = footprint * sy;
    const RHO_W = 1000.0; //water density (kg/m³); cancels in accelerations but
                          //keeps forces/energy in honest SI units.
    const mass = Math.max(1e-3, this.data.density * RHO_W * volume);
    this._body = {
      halfH: sy * 0.5,
      colArea: footprint / Math.max(1, nProbes),
      mass: mass,
      //Box inertia about world x (pitch) and z (roll) — valid near upright,
      //which maxTilt keeps us within.
      Ix: mass / 12.0 * (sy * sy + sz * sz),
      Iz: mass / 12.0 * (sx * sx + sy * sy),
      rhoG: RHO_W * this.data.gravity,
      //Energy scale ≈ work to lift the body its own half-height. Normalises the
      //governor so its gain is dimensionless and scale-independent.
      eRef: Math.max(1e-3, mass * this.data.gravity * sy * 0.5)
    };
    return this._body;
  },

  //===========================================================================
  // KINEMATIC — forgiving plane-fit + gravity/spring entry. No torque.
  //===========================================================================
  _solveKinematic: function(local, field, obj, time, timeDelta){
    //World position + yaw of the object so probes ride its heading. We read yaw
    //from the authored base quaternion (the current quaternion includes the tilt
    //WE applied last frame, which we don't want feeding back into placement).
    const px = obj.position.x, pz = obj.position.z;
    this._euler.setFromQuaternion(this._baseQuat, 'YXZ');
    const cosY = Math.cos(this._euler.y), sinY = Math.sin(this._euler.y);
    //Probes are stored pre-scale; reapply world scale so the footprint matches.
    const sx = obj.scale.x, sz = obj.scale.z;

    const t = time / 1000.0;
    //Least-squares plane y = a*x + b*z + c through the sampled probe heights.
    let n = 0, Sx = 0, Sz = 0, Sxx = 0, Szz = 0, Sxz = 0, Sy = 0, Sxy = 0, Szy = 0;
    for(let i = 0; i < local.length; i++){
      const lx = local[i].x * sx, lz = local[i].z * sz;
      const wx = px + (lx * cosY + lz * sinY);
      const wz = pz + (-lx * sinY + lz * cosY);
      const wy = field.sampleHeight(wx, wz, t);
      n++; Sx += wx; Sz += wz; Sy += wy;
      Sxx += wx * wx; Szz += wz * wz; Sxz += wx * wz;
      Sxy += wx * wy; Szy += wz * wy;
    }

    let a = 0, b = 0, c = Sy / n;
    if(n >= 3){
      const m11 = Sxx, m12 = Sxz, m13 = Sx;
      const m22 = Szz, m23 = Sz, m33 = n;
      const det = m11 * (m22 * m33 - m23 * m23)
                - m12 * (m12 * m33 - m23 * m13)
                + m13 * (m12 * m23 - m22 * m13);
      if(Math.abs(det) > 1e-9){
        const inv = 1.0 / det;
        a = inv * (Sxy * (m22 * m33 - m23 * m23)
                 - m12 * (Szy * m33 - m23 * Sy)
                 + m13 * (Szy * m23 - m22 * Sy));
        b = inv * (m11 * (Szy * m33 - m23 * Sy)
                 - Sxy * (m12 * m33 - m23 * m13)
                 + m13 * (m12 * Sy - Szy * m13));
        c = inv * (m11 * (m22 * Sy - Szy * m23)
                 - m12 * (m12 * Sy - Szy * m13)
                 + Sxy * (m12 * m23 - m22 * m13));
      }
    }

    const targetY = a * px + b * pz + c + this.data.draft;
    this._n.set(-a, 1.0, -b).normalize();

    const dt = Math.max(0.0, (timeDelta || 16.7) / 1000.0);
    const tau = this.data.damping;
    const k = tau > 1e-4 ? (1.0 - Math.exp(-dt / tau)) : 1.0;

    //Vertical: gravity/spring ENTRY until settled, then plane FOLLOW.
    if(this.data.gravity > 1e-4 && !this._settled){
      const err = targetY - obj.position.y; //>0 submerged, <0 in air.
      const inAir = err < -1e-3;
      if(inAir){
        this._vy -= this.data.gravity * dt;
      } else {
        this._vy += this._buoyStiffness * err * dt;
        this._vy *= Math.exp(-dt / Math.max(1e-3, tau));
      }
      if(this._wasInAir && !inAir && this._vy < -0.5){
        //Bubble to the scene so OceanGrid's splash system can hear it, and carry
        //the contact point (body XZ at the wave-plane height it just struck).
        this.el.emit('buoyancy-splash', {
          speed: -this._vy,
          point: {x: obj.position.x, y: targetY, z: obj.position.z}
        }, true);
      }
      this._wasInAir = inAir;
      obj.position.y += this._vy * dt;
      if(Math.abs(err) < 0.06 && Math.abs(this._vy) < 0.08){
        this._settled = true; this._vy = 0.0;
      }
    } else {
      const lerp = this._started ? k : 1.0; //snap on first valid frame.
      obj.position.y += (targetY - obj.position.y) * lerp;
    }

    if(this.data.tilt){
      const lerp = this._started ? k : 1.0;
      let nrm = this._n;
      const dot = Math.min(1.0, Math.max(-1.0, this._up.dot(nrm)));
      const ang = Math.acos(dot);
      const maxAng = this.data.maxTilt * Math.PI / 180.0;
      if(ang > maxAng && ang > 1e-5){
        const s = maxAng / ang;
        nrm = this._nrm.copy(this._n).lerp(this._up, 1.0 - s).normalize();
      }
      this._qTilt.setFromUnitVectors(this._up, nrm);
      this._qTarget.copy(this._qTilt).multiply(this._baseQuat);
      obj.quaternion.slerp(this._qTarget, lerp);
    }

    this._started = true;
  },

  //Auto probe footprint when no buoyancy-hull is attached. Cached; recomputed
  //if the bbox wasn't ready yet (async model).
  _autoProbes: function(){
    if(this._autoLocal) return this._autoLocal;
    const inset = 0.85;
    //Explicit/geometry size → 4 footprint corners directly in LOCAL space (no
    //bbox wait; localToWorld reapplies scale at sample time, like the bbox path).
    const localSize = this._resolveLocalSize();
    if(localSize){
      const hx = localSize.x * 0.5 * inset, hz = localSize.z * 0.5 * inset;
      this._autoLocal = [
        {x:  hx, z:  hz}, {x: -hx, z:  hz}, {x:  hx, z: -hz}, {x: -hx, z: -hz}
      ];
      return this._autoLocal;
    }
    const box = new THREE.Box3().setFromObject(this.el.object3D);
    if(box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const inv = new THREE.Matrix4().copy(this.el.object3D.matrixWorld).invert();
    const corners = [
      new THREE.Vector3(center.x + size.x * 0.5, center.y, center.z + size.z * 0.5),
      new THREE.Vector3(center.x - size.x * 0.5, center.y, center.z + size.z * 0.5),
      new THREE.Vector3(center.x + size.x * 0.5, center.y, center.z - size.z * 0.5),
      new THREE.Vector3(center.x - size.x * 0.5, center.y, center.z - size.z * 0.5)
    ];
    this._autoLocal = corners.map((cc) => {
      cc.applyMatrix4(inv);
      return {x: cc.x * inset, z: cc.z * inset};
    });
    return this._autoLocal;
  }
});
