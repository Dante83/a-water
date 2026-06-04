//Ocean splash particles — airborne spray for breaking wave crests and for the
//unified "moving water hits a solid" impact (shore/terrain AND boat hulls).
//
//Design (see plan dreamy-noodling-petal):
//  - One packed, fixed-capacity CPU particle pool (structure-of-arrays). Indices
//    [0, liveCount) are alive; death is an O(1) swap-remove with the last live
//    slot, which keeps the GPU draw range contiguous.
//  - One THREE.Points mesh drawn ONLY in the main pass. OceanGrid owns this
//    object and toggles mesh.visible so it never enters the refraction / shadow /
//    foam offscreen passes (those run earlier in OceanGrid.tick).
//  - Three emitters, one spawn pool:
//      crest  — sample the analytic Gerstner field around the camera; steep +
//               rising tops throw mist.
//      shore  — sample the same field against a CPU copy of the foam-camera
//               terrain-height ortho; water arriving at the waterline bursts.
//      hull   — driven by the buoyancy-splash event via OceanGrid.
//  - shore and hull both funnel through emitImpact(): your "treat them the same"
//    framing. Crest steepness / impact speed thresholds are physical; the spray
//    counts, sizes and lifetimes are artistic and flagged FUDGE.
//
//CPU sim (not GPU) is deliberate for v1: a few-thousand-particle pool is trivially
//60fps and debuggable, and avoids CPU->GPU emission plumbing. GPUComputeRenderer
//is the documented scale-up path if we ever need far more particles.

AWater.AOcean.OceanSplash = function(oceanGrid, scene, configOverrides){
  this.oceanGrid = oceanGrid;
  this.scene = scene;
  this.renderer = oceanGrid.renderer;

  const cfg = configOverrides || {};
  //8000 (~0.4 MB of SoA backing) gives headroom so the denser crest clusters and
  //the shore sheet can both be live without either starving the pool (spawn() drops
  //silently when full). Was 4000 when crests emitted one particle per cell.
  const capacity = cfg.capacity || 8000;
  this.capacity = capacity;
  this.liveCount = 0;

  //── Live-tunable knobs (plain JS, not A-Frame data — hot-editable from the
  //   console per the live-uniforms workflow). Physical where it matters,
  //   FUDGE where it is art direction. ───────────────────────────────────────
  this.enabled = true;
  this.gravity = 9.81;          //m/s^2, real.
  this.airDrag = 0.7;           //per-second velocity retention exponent (FUDGE).
  this.maxEmitDistance = 160.0; //m: do not emit beyond this from camera.
  this.useRenderedHeight = true;//Spawn against the ACTUAL rendered FFT surface (the
                                //async height-field snapshot), not the analytic twin.
                                //The analytic field shares the spectrum but NOT the
                                //GPU's phases, so its crests sit elsewhere — left on,
                                //bursts fired over visibly-flat/trough water. Falls
                                //back to analytic outside the snapshot's ~512 m window.

  //Crest mist.
  this.crestEnabled = true;
  this.crestRadius = 120.0;            //m scan radius around camera.
  this.crestGridStep = 11.0;           //m grid spacing for candidate tops.
  this.crestSteepnessThreshold = 0.05; //1 - normal.y. NOW a near-flat REJECT, not the
                                       //primary gate. The phase-correct slope reads off
                                       //the 2 m/texel FFT field, which is smooth — it
                                       //cuts the sharp short-wave slopes, so the old
                                       //0.18 (~35deg) almost never passed there and crest
                                       //mist vanished. Crest selection is now carried by
                                       //"elevated AND rising" (the upper front face of a
                                       //crest), which the smoothed field DOES resolve.
  this.crestRiseThreshold = 0.4;       //m/s upward surface velocity (rendered FFT dH/dt).
  this.crestMinHeight = 0.45;          //m ABOVE MEAN sea level a candidate must sit.
                                       //This is now the PRIMARY crest selector (with
                                       //rise): spray tears off elevated, rising water,
                                       //not flat sea or troughs. Raise toward Hs/2 to
                                       //pick only the biggest tops; lower for more mist.
  this.crestSpawnChance = 0.5;         //per-candidate cell per-frame (FUDGE). Was 0.10,
                                       //which thinned 90% of cells so survivors were lone
                                       //specks; combined with the cluster emit below this
                                       //now lets crests read as PUFFS, like the shore sheet.
  this.crestClusterCount = 5;          //particles per qualifying crest cell (FUDGE). The
                                       //crest analogue of the shore sheet: a cluster reads
                                       //as a puff of mist congregating on the top, where a
                                       //single particle just zipped past unnoticed.
  this.crestClusterRadius = 1.3;       //m horizontal spread of a cluster around the crest.
  this.crestSize = 0.22;               //m droplet radius (FUDGE).
  this.crestLifetime = 0.6;            //s (FUDGE). Short on purpose: crest mist is a
                                       //near-field puff that dissipates within ~10 m,
                                       //not a streak that flies across the view. At
                                       //high wind, drift (~10 m/s) × lifetime sets the
                                       //travel range, so lifetime is the range cap.
  this.crestVelInherit = 0.8;          //fraction of the surface's own rise the
                                       //spray launches with — physical: torn
                                       //spray is the crest continuing ballistically.
  this.crestUpSpeed = 1.6;             //m/s additive launch floor (FUDGE).
  this.crestWindFactor = 0.5;          //fraction of wind carried by mist (FUDGE).

  //Impact (shore + hull).
  this.impactEnabled = true;
  this.shoreEnabled = true;
  this.shoreBand = 0.6;          //m |waterY - terrainY| counted as "at shore".
  this.shoreRiseThreshold = 0.5; //m/s rising water needed to break.
  this.shoreGridStep = 2.0;      //m scan spacing within the readback ortho. Finer
                                 //than the old 4 m so the waterline resolves as a
                                 //continuous edge, not a handful of scattered cells.
  this.shoreGradEps = 6.0;       //m baseline for the terrain-slope finite difference.
                                 //CRITICAL: the foam-height ortho is ~4 m/texel, so the
                                 //old 1 m eps sampled the SAME texel twice → gradient 0
                                 //→ a flat (0,1,0) normal → the reflection launch had no
                                 //surface to bounce off and every burst fired straight
                                 //UP. The eps is clamped to >=1.5 texels at runtime so
                                 //neighbouring samples land in DIFFERENT texels and the
                                 //cliff slope (hence the reflected, forward spray) is
                                 //actually resolved.
  this.shoreScanRadius = 90.0;   //m around camera to look for shoreline.
  this.shoreNearRadius = 45.0;   //m: inside this every shore cell fires (dense, a
                                 //solid sheet); beyond it cells are probabilistically
                                 //thinned — far spray reads fine sparse and folds
                                 //into foam coverage anyway.
  this.shoreFarKeep = 0.25;      //prob a far (> shoreNearRadius) cell still fires.
  this.shoreFrontBias = -0.2;    //skip cells whose direction-from-camera dotted with
                                 //camera-forward is below this (~ behind the camera).
  this.shoreSheetSpan = 2.5;     //m: spread each cell's burst ALONG the waterline
                                 //tangent so adjacent cells overlap into a sheet
                                 //rather than each firing as an isolated point geyser.
  this.shoreJetScale = 1.6;      //multiplier on the Torricelli surge-jet launch
                                 //(v = shoreJetScale * sqrt(2 g H), H = wave surge
                                 //above mean). 1.0 = physical; raise it for taller,
                                 //more dramatic spray off tall cliffs (the 2 m FFT
                                 //field SMOOTHS crest height, so the physical jet runs
                                 //a touch conservative — a small boost reads truer).
  this.impactBurstPerSpeed = 6.0;//particles per m/s of impact speed (FUDGE).
  this.impactMinBurst = 4;
  this.impactMaxBurst = 60;
  this.impactSize = 0.3;         //m (FUDGE) — droplet size at impactSizeRefSpeed.
  this.impactSizeRefSpeed = 8.0; //m/s impact speed that yields the nominal impactSize.
                                 //Droplet scale grows with impact energy so a big
                                 //breaker throws fat sheets and a small lap a fine fizz.
                                 //Without this every burst rendered the SAME droplet
                                 //size regardless of wave, so all spray read alike.
  this.impactSizeMaxScale = 2.5; //cap on the size multiplier (a freak surge speed must
                                 //not spawn giant blobs).
  this.impactLifetime = 1.4;     //s (FUDGE).
  this.impactVelScale = 0.9;     //launch speed as fraction of impact speed (FUDGE).
  this.impactMinLaunch = 7.0;    //m/s FLOOR on burst launch speed (FUDGE). The shore
                                 //`rise` now reads the phase-correct FFT field, whose
                                 //vertical velocity is gentle (~0.5-2 m/s) — far below
                                 //the energy of water actually striking a rock. Without
                                 //a floor the launch was ~1 m/s and spray just sat at the
                                 //waterline. The floor stands in for the impact jet (run-up
                                 //momentum we do not measure), so spray reflects UP off the
                                 //ground. Tune up for taller spray, down for a low fizz.
  this.impactMaxLaunch = 26.0;   //m/s HARD CAP on burst launch speed. Was 7 to tame the
                                 //old ANALYTIC rise (it read 20+ m/s from a phantom
                                 //phase → 25 m geysers). The launch now comes from the
                                 //physical surge jet (sqrt(2 g H)), bounded by real wave
                                 //height, so the cap can sit high enough for a big wave
                                 //to genuinely leap up a cliff (~16 m/s ≈ 13 m of reach)
                                 //without re-admitting the runaway analytic spike.
  this.impactSpread = 0.55;      //cone half-spread around the launch axis.
  this.impactReflect = 1.0;      //0 = launch coned about the surface NORMAL (old
                                 //behaviour); 1 = launch coned about the MIRROR of the
                                 //incoming water velocity reflected off that surface, so
                                 //water thrown at a cliff sprays BACK along its path
                                 //(directional sheet) rather than always straight up the
                                 //rock. Only engages when the caller supplies an incoming
                                 //velocity (shore does; hull falls back to the normal cone).
  this.impactRunUp = 1.2;        //wall run-up: inviscid mirror reflection alone leaves a
                                 //vertical cliff spraying horizontally (no up). Real water
                                 //climbs the face on a head-on slam, so we add upward lift
                                 //proportional to how square-on the impact is (-incoming·n).
                                 //Glancing flat-beach backwash gets little → low seaward
                                 //wash; head-on cliff strikes get a tall sheet. (FUDGE: the
                                 //run-up term is not in the inviscid bounce.)
  this.impactWindRampTime = 1.1; //s for impact spray to feel its FULL wind share.
                                 //Impact droplets are knocked off a solid (shore/hull)
                                 //and should arc up ballistically first; the wind they
                                 //feel ramps 0->1 over this time so a strong wind does
                                 //not instantly blow the launch flat. Crest mist is
                                 //exempt (torn off already moving with the air). Raised
                                 //0.6->1.1 because the reflected forward launch was being
                                 //bent downwind before it could carry — the longer ramp
                                 //lets the ballistic arc read first. (Pairs with
                                 //impactWindFactor for the eventual drift strength.)
  this.impactWindFactor = 0.35;  //fraction of wind speed impact spray ultimately
                                 //drifts at. Heavy thrown droplets do NOT reach wind
                                 //speed — only fine mist does. At 1.0 the sim pulled
                                 //every droplet to full wind, so they accelerated to
                                 //~wind m/s and smeared into a flat downwind sheet
                                 //(the "dominated by wind" look). 0.35 keeps the drift
                                 //comparable to the launch, so spray stays a local arc.

  //Render-side art knobs (pushed to uniforms each frame).
  this.opacity = 0.55;           //PEAK puff opacity. Well below 1 so the noise-carved
                                 //cloud stays translucent (a solid 1.0 reads as opaque
                                 //"marshmallows", not mist).
  this.sizeScale = 5.0;          //mist puffs are clumps of aerosol, not single droplets,
                                 //so blow the world radius up ~5x over the spawn size.
  this.softRange = 1.5;          //m soft-particle fade depth.
  this.maxPointSize = 512.0;     //raised from 256 so the 5x-larger near puffs are not
                                 //clamped flat (watch fill-rate: big translucent sprites
                                 //+ 3-octave noise is the main cost here).
  this.debugMode = 0;            //0 normal, 1 tint-by-type.

  //── Forward-scatter (Mie) phase knobs. The mist blooms when the view ray passes
  //   near the sun direction — the dependable "sunlit spray" cue. Applied to the sun
  //   term only (ambient stays smooth). ───────────────────────────────────────────
  this.phaseG = 0.85;            //forward-lobe asymmetry; toward 1 = tighter sun halo.
  this.phaseGain = 0.6;          //halo strength multiplier on the sun term (FUDGE).
  this.receiveShadow = true;     //darken puffs that sit in the scene sun shadow
                                 //(rocks / lighthouse). Spray does NOT cast — point
                                 //sprites cannot write a usable shape into the shadow
                                 //map; receive-only is the practical path.

  //── Procedural mist-shape knobs. Each billboard is a soft sphere eroded by 3D noise
  //   (no sprite texture). erode/softEdge are the spray-vs-fog dial. ────────────────
  this.noiseScale = 2.5;         //3D noise frequency across the droplet.
  this.erode = 0.35;             //silhouette erosion threshold (higher = grainier).
  this.softEdge = 0.25;          //erosion smoothstep width (lower = sharper, sparklier).
  this.noiseEvolve = 0.6;        //how fast the noise field dissolves over the life.

  //── Debug surface probe. A single bright ball parked ON the sampled emission
  //   surface (the same rendered-FFT _surfaceHeight the crest/shore emitters
  //   spawn against), placed in front of the camera. Lets us eyeball whether the
  //   spawn HEIGHT actually sits on the visible waterline — isolating "is my
  //   spawn point right?" from "do the particles look right?". buoyancy reads the
  //   same height source and bobs correctly, so if this ball rides the surface,
  //   position is good and the analytic RISE gate is the remaining suspect.
  this.debugMarker = false;      //window.setSplashMarker(1) to turn on.
  this.debugMarkerAhead = 20.0;  //m in front of camera to park the probe.

  //── Apply caller overrides. Every knob above is a plain field, so a config
  //   object passed at construction (e.g. from the ocean component / scene HTML)
  //   can dial in or down ANY of them at start — capacity was already consumed
  //   above for the pool sizing, the rest take effect live. Unknown keys are
  //   harmless. Same fields stay hot-editable on the instance at runtime. ──────
  for(const k in cfg){
    if(cfg.hasOwnProperty(k)) this[k] = cfg[k];
  }

  //── Pool storage (structure-of-arrays). position/aSize/aAge01/aSeed/aType are
  //   GPU attribute backings; vel/age/lifetime stay CPU-only. ────────────────
  this._positions = new Float32Array(capacity * 3);
  this._sizes = new Float32Array(capacity);
  this._age01 = new Float32Array(capacity);
  this._seeds = new Float32Array(capacity);
  this._types = new Float32Array(capacity);
  this._vel = new Float32Array(capacity * 3);
  this._age = new Float32Array(capacity);
  this._life = new Float32Array(capacity);

  const geometry = new THREE.BufferGeometry();
  this._posAttr = new THREE.BufferAttribute(this._positions, 3).setUsage(THREE.DynamicDrawUsage);
  this._sizeAttr = new THREE.BufferAttribute(this._sizes, 1).setUsage(THREE.DynamicDrawUsage);
  this._ageAttr = new THREE.BufferAttribute(this._age01, 1).setUsage(THREE.DynamicDrawUsage);
  this._seedAttr = new THREE.BufferAttribute(this._seeds, 1).setUsage(THREE.DynamicDrawUsage);
  this._typeAttr = new THREE.BufferAttribute(this._types, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', this._posAttr);
  geometry.setAttribute('aSize', this._sizeAttr);
  geometry.setAttribute('aAge01', this._ageAttr);
  geometry.setAttribute('aSeed', this._seedAttr);
  geometry.setAttribute('aType', this._typeAttr);
  geometry.setDrawRange(0, 0);
  this.geometry = geometry;

  const def = AWater.AOcean.Materials.Ocean.splashMaterial;
  this.material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(def.uniforms),
    vertexShader: def.vertexShader,
    fragmentShader: def.fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending
  });

  //Procedural soft-droplet sprite so the system renders before a real sprite is
  //supplied. Swap later with setSprite().
  this._defaultSprite = AWater.AOcean.OceanSplash.makeRadialSprite();
  this.material.uniforms.splashSprite.value = this._defaultSprite;

  this.mesh = new THREE.Points(geometry, this.material);
  this.mesh.frustumCulled = false; //positions move every frame; bounds are stale.
  this.mesh.renderOrder = 10;      //draw after opaque scene + water.
  this.mesh.visible = false;       //OceanGrid flips this on after offscreen passes.
  this.mesh.layers.set(AWater.AOcean.OCEAN_LAYER);
  scene.add(this.mesh);

  //Terrain-height field, copied from the foam ortho on snap-change (async).
  this._terrain = null;          //Float32Array RGBA, G = world Y, A = hasGeom.
  this._terrainW = 0;
  this._terrainH = 0;
  this._terrainCamX = 0;
  this._terrainCamZ = 0;
  this._terrainHalf = 2048.0;    //foam ortho half-width (metres).
  this._terrainReadPending = false;

  this._prevTime = -1.0;
};

//Camera-facing soft sprite: white core easing to transparent, faint speckle so a
//cluster reads as droplets rather than a flat disc.
AWater.AOcean.OceanSplash.makeRadialSprite = function(){
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, 0.0, size * 0.5, size * 0.5, size * 0.5);
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
};

//Parse a declarative "key=value, key=value" string into a config object for the
//constructor's third arg. Uses '=' and ',' (NOT ':' / ';') on purpose: an A-Frame
//attribute already claims those as its own property delimiters, so a nested map has
//to avoid them. Values coerce: true/false -> bool, numeric -> Number, else string.
//Blank/empty -> {}. Unknown keys are harmless (the constructor copies them anyway).
AWater.AOcean.OceanSplash.parseConfig = function(str){
  const cfg = {};
  if(!str) return cfg;
  const parts = str.split(',');
  for(let i = 0; i < parts.length; i++){
    const eq = parts[i].indexOf('=');
    if(eq < 0) continue;
    const key = parts[i].slice(0, eq).trim();
    if(!key) continue;
    const raw = parts[i].slice(eq + 1).trim();
    let val;
    if(raw === 'true') val = true;
    else if(raw === 'false') val = false;
    else if(raw !== '' && !isNaN(Number(raw))) val = Number(raw);
    else val = raw;
    cfg[key] = val;
  }
  return cfg;
};

//Swap in an authored spray sprite (a THREE.Texture).
AWater.AOcean.OceanSplash.prototype.setSprite = function(texture){
  if(texture && texture.isTexture){
    this.material.uniforms.splashSprite.value = texture;
  }
};

//Spawn one particle. type: 0 crest mist, 1 impact burst.
AWater.AOcean.OceanSplash.prototype.spawn = function(px, py, pz, vx, vy, vz, size, life, type){
  if(this.liveCount >= this.capacity) return; //pool full: drop (cheap, bounded).
  const i = this.liveCount++;
  const p3 = i * 3;
  this._positions[p3] = px; this._positions[p3 + 1] = py; this._positions[p3 + 2] = pz;
  this._vel[p3] = vx; this._vel[p3 + 1] = vy; this._vel[p3 + 2] = vz;
  this._sizes[i] = size;
  this._life[i] = life;
  this._age[i] = 0.0;
  this._age01[i] = 0.0;
  this._seeds[i] = Math.random();
  this._types[i] = type;
};

//Unified impact burst — shore and hull both call this. worldPos is the contact
//point, (nx,ny,nz) the surface normal (the solid face the water strikes), speed the
//closing speed of water vs solid in m/s. (tanX,tanZ,span) are optional: when given,
//each particle's spawn point is jittered up to ±span/2 ALONG the (tanX,tanZ) tangent,
//so a row of shore cells lays down one continuous SHEET instead of isolated point
//geysers. Omit them (hull impacts) for a burst from a single point.
//(inVx,inVy,inVz) are optional: the incoming WATER velocity. When supplied (shore),
//the launch axis becomes the mirror of that velocity reflected off the surface (plus
//run-up), so spray leaves DIRECTIONALLY along the bounce instead of coning straight
//up the normal. Omit them (hull) to keep the old normal-cone launch.
AWater.AOcean.OceanSplash.prototype.emitImpact = function(px, py, pz, nx, ny, nz, speed, tanX, tanZ, span, countScale, inVx, inVy, inVz){
  if(!this.enabled || !this.impactEnabled) return;
  if(speed <= 0.0) return;
  let count = Math.round(speed * this.impactBurstPerSpeed);
  if(count < this.impactMinBurst) count = this.impactMinBurst;
  if(count > this.impactMaxBurst) count = this.impactMaxBurst;
  //countScale lets the dense shore-contour scan emit a FEW particles per cell
  //(many cells × few each = a sheet) without each cell dumping a full hull-sized
  //burst and overflowing the pool. Floor of 1 so a firing cell always shows.
  if(countScale !== undefined){ count = Math.max(1, Math.round(count * countScale)); }
  const nl = Math.max(1e-4, Math.sqrt(nx * nx + ny * ny + nz * nz));
  nx /= nl; ny /= nl; nz /= nl;
  //Launch axis. By default spray cones up the surface normal (old behaviour). When
  //the caller hands us the incoming water velocity AND reflection is enabled, the
  //axis becomes the MIRROR of that velocity bounced off the surface: water moving
  //into the face (incoming·n < 0) is thrown back out along the reflection, so a wave
  //hitting a cliff sprays seaward along its own path rather than dribbling up the
  //rock. Inviscid reflection alone leaves a vertical wall spraying flat, so we add
  //run-up — upward lift scaled by how square-on the slam is (-incoming·n) — which is
  //what lifts a real sheet up the face. Glancing flat-beach backwash gets little of
  //either and washes low; head-on cliff strikes throw a tall directional sheet.
  let axisX = nx, axisY = ny, axisZ = nz;
  if(this.impactReflect > 0.0 && inVx !== undefined){
    const vl = Math.sqrt(inVx * inVx + inVy * inVy + inVz * inVz);
    if(vl > 1e-4){
      const ivx = inVx / vl, ivy = inVy / vl, ivz = inVz / vl;
      const idotn = ivx * nx + ivy * ny + ivz * nz; //<0 => water moves INTO the face.
      if(idotn < 0.0){
        const rx = ivx - 2.0 * idotn * nx; //mirror reflection (unit in, unit out).
        const ry = ivy - 2.0 * idotn * ny;
        const rz = ivz - 2.0 * idotn * nz;
        const runUp = this.impactRunUp * (-idotn);
        const b = this.impactReflect;
        let ax = rx * b + nx * (1.0 - b);
        let ay = ry * b + ny * (1.0 - b) + runUp;
        let az = rz * b + nz * (1.0 - b);
        const al = Math.sqrt(ax * ax + ay * ay + az * az);
        if(al > 1e-4){ axisX = ax / al; axisY = ay / al; axisZ = az / al; }
      }
    }
  }
  //Cap the launch: shore "rise" can read 20+ m/s, which fires spray dozens of
  //metres up (the geyser). Torn shore spray actually leaves at a few m/s.
  let launch = speed * this.impactVelScale;
  if(launch < this.impactMinLaunch) launch = this.impactMinLaunch;
  if(launch > this.impactMaxLaunch) launch = this.impactMaxLaunch;
  const haveTan = (span && span > 0.0 && (tanX !== undefined));
  //Per-burst size scale from impact energy. sqrt so droplet scale tracks momentum
  //gently (spray scale grows slower than raw speed); 1.0 at the reference speed.
  let sizeE = Math.sqrt(speed / Math.max(0.1, this.impactSizeRefSpeed));
  if(sizeE > this.impactSizeMaxScale) sizeE = this.impactSizeMaxScale;
  const burstSize = this.impactSize * sizeE;
  for(let k = 0; k < count; ++k){
    //Random direction within a cone around the launch axis, biased upward so a
    //burst sheets into the air rather than spraying sideways.
    let rx = Math.random() * 2.0 - 1.0;
    let ry = Math.random() * 2.0 - 1.0;
    let rz = Math.random() * 2.0 - 1.0;
    let dx = axisX + rx * this.impactSpread;
    let dy = axisY + ry * this.impactSpread;
    let dz = axisZ + rz * this.impactSpread;
    if(dy < 0.2) dy = 0.2;
    const dl = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy + dz * dz));
    const sp = launch * (0.5 + Math.random() * 0.7);
    //Smear the spawn position along the waterline tangent (sheet) when supplied.
    let sx = px, sz = pz;
    if(haveTan){
      const off = (Math.random() - 0.5) * span;
      sx += tanX * off; sz += tanZ * off;
    }
    this.spawn(
      sx, py, sz,
      (dx / dl) * sp, (dy / dl) * sp, (dz / dl) * sp,
      burstSize * (0.7 + Math.random() * 0.7),
      this.impactLifetime * (0.7 + Math.random() * 0.6),
      1.0
    );
  }
};

//Sample the cached terrain-height field at world (x,z). Returns the terrain Y, or
//null when outside the ortho or where no geometry was captured (open water/sky).
AWater.AOcean.OceanSplash.prototype.sampleTerrainHeight = function(x, z){
  const data = this._terrain;
  if(!data) return null;
  const half = this._terrainHalf;
  //Mirror the foam-map mapping in water-shader.glsl exactly:
  //  u = 0.5 * ((x - camX)/half + 1);  v = 1 - 0.5 * ((z - camZ)/half + 1)
  const u = 0.5 * (((x - this._terrainCamX) / half) + 1.0);
  let v = 0.5 * (((z - this._terrainCamZ) / half) + 1.0);
  v = 1.0 - v;
  if(u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return null;
  const px = Math.min(this._terrainW - 1, Math.max(0, Math.floor(u * this._terrainW)));
  const py = Math.min(this._terrainH - 1, Math.max(0, Math.floor(v * this._terrainH)));
  const idx = (py * this._terrainW + px) * 4;
  if(data[idx + 3] < 0.5) return null; //alpha 0 => no geometry there.
  return data[idx + 1];                //G channel = world Y (position pass output).
};

//Kick an async readback of the foam terrain-height ortho into a CPU array. Called
//by OceanGrid only when the foam camera actually re-rendered (snap-change), so the
//(16 MB at 1024^2) transfer is rare and never blocks the frame.
AWater.AOcean.OceanSplash.prototype.requestTerrainReadback = function(renderTarget, camX, camZ, half){
  if(!this.shoreEnabled || this._terrainReadPending) return;
  if(typeof this.renderer.readRenderTargetPixelsAsync !== 'function') return;
  const w = renderTarget.width;
  const h = renderTarget.height;
  if(!this._terrainBuf || this._terrainBuf.length !== w * h * 4){
    this._terrainBuf = new Float32Array(w * h * 4);
  }
  const buf = this._terrainBuf;
  const self = this;
  this._terrainReadPending = true;
  this.renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, w, h, buf).then(function(){
    self._terrain = buf;
    self._terrainW = w;
    self._terrainH = h;
    self._terrainCamX = camX;
    self._terrainCamZ = camZ;
    self._terrainHalf = half;
    self._terrainReadPending = false;
  }).catch(function(){ self._terrainReadPending = false; });
};

//Height of the WATER WE ACTUALLY SEE at world (x,z). Prefers the rendered FFT
//surface (async cached snapshot, ~15 Hz, no GPU stall) so spray spawns where the
//visible wave is; falls back to the analytic twin when the snapshot is cold or the
//point is outside its ~512 m window. Use this for spawn POSITION and elevation
//GATES; use the analytic field for rates (rise) so a finite difference stays
//within one phase system. (ocean-grid keeps the snapshot warm only on request, so
//tick() calls requestFFTSnapshot each frame.)
AWater.AOcean.OceanSplash.prototype._surfaceHeight = function(field, x, z, t){
  if(this.useRenderedHeight && AWater.AOcean.sampleWaterHeightFFT){
    const h = AWater.AOcean.sampleWaterHeightFFT(x, z);
    if(h !== null && h !== undefined) return h;
  }
  return field.sampleHeight(x, z, t);
};

//Emit crest mist by scanning the analytic field around the camera for steep,
//rising tops. Vertical velocity via a small time difference; steepness via the
//surface normal.
AWater.AOcean.OceanSplash.prototype._emitCrest = function(field, t, camX, camZ, windX, windZ){
  if(!this.crestEnabled) return;
  const step = this.crestGridStep;
  const r = this.crestRadius;
  const maxD2 = this.maxEmitDistance * this.maxEmitDistance;
  const dt = 0.05;
  const nrm = this._scratchN || (this._scratchN = new THREE.Vector3());
  //Jitter the grid origin per frame so spawn points are not a static lattice.
  const jx = (Math.random() - 0.5) * step;
  const jz = (Math.random() - 0.5) * step;
  for(let gx = -r; gx <= r; gx += step){
    for(let gz = -r; gz <= r; gz += step){
      const d2 = gx * gx + gz * gz;
      if(d2 > maxD2) continue;
      if(Math.random() > this.crestSpawnChance) continue;
      const x = camX + gx + jx;
      const z = camZ + gz + jz;
      //All gates read the RENDERED FFT field (phase-correct) wherever the snapshot
      //covers this point; the analytic twin is only a cold-start fallback. Reading
      //them off the water we SEE (same source as _surfaceHeight) is what stops mist
      //erupting where the analytic phase has a crest but the rendered surface is flat.
      //
      //PRIMARY crest selector = "elevated AND rising": the upper front face of a
      //crest, which the smoothed 2 m field resolves well. (Steepness from that field
      //is unreliable — it cuts short-wave slopes — so it is demoted to a near-flat
      //reject below, not the gate that decides where mist lives.)
      const h0 = this._surfaceHeight(field, x, z, t);
      if((h0 - field.heightOffset) < this.crestMinHeight) continue;
      let rise = (this.useRenderedHeight && AWater.AOcean.sampleWaterRiseFFT)
        ? AWater.AOcean.sampleWaterRiseFFT(x, z) : null;
      if(rise === null){
        const h0a = field.sampleHeight(x, z, t);
        const h1a = field.sampleHeight(x, z, t + dt);
        rise = (h1a - h0a) / dt;
      }
      if(rise < this.crestRiseThreshold) continue;
      let steepness = (this.useRenderedHeight && AWater.AOcean.sampleWaterSlopeFFT)
        ? AWater.AOcean.sampleWaterSlopeFFT(x, z) : null;
      if(steepness === null){ field.sampleNormal(x, z, t, nrm); steepness = 1.0 - nrm.y; }
      if(steepness < this.crestSteepnessThreshold) continue;
      //Emit a CLUSTER, not a lone particle, so the crest reads as a puff of mist
      //congregating on the top (the shore sheet's analogue). Each droplet is spread
      //over a small radius and re-sampled onto the surface so the puff hugs the crest.
      //Launch inherits the surface's own upward speed (`rise`): torn spray is the
      //crest's water continuing ballistically once the wave form decelerates past its
      //peak. crestUpSpeed is a small additive floor so gentle seas still mist a little.
      const cluster = this.crestClusterCount;
      for(let c = 0; c < cluster; ++c){
        const sx = x + (Math.random() - 0.5) * this.crestClusterRadius;
        const sz = z + (Math.random() - 0.5) * this.crestClusterRadius;
        const sh = this._surfaceHeight(field, sx, sz, t);
        const up = rise * this.crestVelInherit * (0.7 + Math.random() * 0.5) + this.crestUpSpeed;
        this.spawn(
          sx, sh + 0.1, sz,
          windX * this.crestWindFactor + (Math.random() - 0.5) * 0.6,
          up,
          windZ * this.crestWindFactor + (Math.random() - 0.5) * 0.6,
          this.crestSize * (0.7 + Math.random() * 0.6),
          this.crestLifetime * (0.7 + Math.random() * 0.6),
          0.0
        );
      }
    }
  }
};

//Emit shore impact bursts as a continuous SHEET along the waterline. We scan a
//fine grid for cells sitting on the rest-waterline contour, and at each one lay a
//short ribbon of spray ALONG the contour tangent (not a single point cone) so the
//whole shoreline reads as a wall of spray rather than scattered geysers. Density
//is biased toward the camera-forward direction and thinned with distance, so the
//budget goes to visible spray. Needs the terrain field. (fwdX,fwdZ) = camera fwd.
AWater.AOcean.OceanSplash.prototype._emitShore = function(field, t, camX, camZ, fwdX, fwdZ){
  if(!this.shoreEnabled || !this._terrain) return;
  const step = this.shoreGridStep;
  const r = this.shoreScanRadius;
  const maxD2 = this.maxEmitDistance * this.maxEmitDistance;
  const nearR2 = this.shoreNearRadius * this.shoreNearRadius;
  const dt = 0.05;
  //Terrain-slope finite-difference step. Must straddle at least ~1.5 foam-ortho
  //texels or both samples land in the same texel and the gradient reads zero (the
  //"every burst poofs straight up" bug — a flat normal gives the reflection nothing
  //to bounce off). Derive the texel size from the readback resolution so this holds
  //if the ortho is ever resized.
  const texel = (this._terrainW > 0 && this._terrainHalf > 0)
    ? (2.0 * this._terrainHalf / this._terrainW) : 4.0;
  const eps = Math.max(this.shoreGradEps, texel * 1.5);
  for(let gx = -r; gx <= r; gx += step){
    for(let gz = -r; gz <= r; gz += step){
      const d2 = gx * gx + gz * gz;
      if(d2 > maxD2) continue;
      //Camera-front bias: skip cells roughly behind the camera. (gx,gz) is the
      //offset from camera; dot with forward, normalised by distance.
      const dist = Math.sqrt(d2);
      if(dist > 1e-3){
        const fdot = (gx * fwdX + gz * fwdZ) / dist;
        if(fdot < this.shoreFrontBias) continue;
      }
      //Distance thinning: keep every near cell (solid sheet), probabilistically
      //drop far ones (sparse far spray is fine and accumulates over frames).
      if(d2 > nearR2 && Math.random() > this.shoreFarKeep) continue;
      const x = camX + gx;
      const z = camZ + gz;
      const terrainY = this.sampleTerrainHeight(x, z);
      if(terrainY === null) continue;
      //True shoreline = terrain that breaks the surface near the REST waterline.
      //Gating terrain against MEAN sea level (not the swinging instantaneous wave)
      //keeps the contact a fixed beach contour. The old |h0 - terrainY| test fired
      //wherever a passing wave grazed the seabed height, so on any shallow
      //submerged shelf it sprayed across a wide underwater area, not the shore.
      if(Math.abs(terrainY - field.heightOffset) > this.shoreBand) continue;
      //Rise = the RENDERED FFT water's own dH/dt (phase-correct) so a burst only
      //fires when the water you SEE is actually surging up the beach — not when the
      //analytic phantom wave happens to peak here (that mistimed, one-sided bunching).
      //Analytic finite difference is the cold-start fallback only.
      let rise = (this.useRenderedHeight && AWater.AOcean.sampleWaterRiseFFT)
        ? AWater.AOcean.sampleWaterRiseFFT(x, z) : null;
      if(rise === null){
        const h0a = field.sampleHeight(x, z, t);
        const h1a = field.sampleHeight(x, z, t + dt);
        rise = (h1a - h0a) / dt;
      }
      if(rise < this.shoreRiseThreshold) continue;
      //"Has the VISIBLE water climbed onto this beach point?" reads the rendered FFT
      //height, so a burst can't erupt where the analytic phase is high but the water
      //you SEE is in a trough (the pink-burst-at-a-minimum). It also pins the spawn
      //to the visible surface — never under the terrain / rendered water.
      const h0 = this._surfaceHeight(field, x, z, t);
      if(h0 < terrainY) continue;
      //Terrain gradient (uphill direction): central difference where both neighbours
      //are on the terrain, one-sided where a neighbour falls into the sea/sky (null).
      //This is the slope the spray reflects off, so a real (non-zero) value here is
      //what gives the burst its forward, up-the-face momentum.
      const xp = this.sampleTerrainHeight(x + eps, z);
      const xm = this.sampleTerrainHeight(x - eps, z);
      const zp = this.sampleTerrainHeight(x, z + eps);
      const zm = this.sampleTerrainHeight(x, z - eps);
      let gradX = 0.0, gradZ = 0.0;
      if(xp !== null && xm !== null) gradX = (xp - xm) / (2.0 * eps);
      else if(xp !== null) gradX = (xp - terrainY) / eps;
      else if(xm !== null) gradX = (terrainY - xm) / eps;
      if(zp !== null && zm !== null) gradZ = (zp - zm) / (2.0 * eps);
      else if(zp !== null) gradZ = (zp - terrainY) / eps;
      else if(zm !== null) gradZ = (terrainY - zm) / eps;
      //Waterline tangent = the horizontal direction ALONG the shore = perpendicular
      //to the (gradX,gradZ) uphill direction in the XZ plane. The burst is smeared
      //along this so neighbouring cells overlap into one continuous sheet.
      let tanX = -gradZ, tanZ = gradX;
      const tl = Math.sqrt(tanX * tanX + tanZ * tanZ);
      if(tl > 1e-4){ tanX /= tl; tanZ /= tl; } else { tanX = 1.0; tanZ = 0.0; }
      //Impact ENERGY, not just the gentle surface rise-rate. A wave that has surged
      //high above mean carries the momentum a cliff turns into a vertical jet; model
      //the jet speed with Torricelli's head->velocity v = sqrt(2 g H) on the surge
      //height H. So a 3 m wave throws ~7-8 m/s and big storm waves really leap, while
      //gentle swell stays a low fizz — spray that scales with wave size. `rise` (the
      //timing gate) is the floor so a fast-rising small wave still pops.
      const surge = Math.max(0.0, h0 - field.heightOffset);
      const jet = this.shoreJetScale * Math.sqrt(2.0 * this.gravity * surge);
      const impactSpeed = Math.max(rise, jet);
      //Incoming water velocity for the reflection launch: the surge climbs the beach
      //UPHILL (the +gradient horizontal direction) at roughly the jet speed and lifts
      //at `rise`. We pass the TRUE geometric face normal (-gradX,1,-gradZ) — not an
      //up-biased one — because the reflection needs the real surface; the upward throw
      //now emerges from run-up inside emitImpact instead of a hand-tuned ny. (With
      //impactReflect=0 the launch falls back to coning about this geometric normal.)
      const gl = Math.sqrt(gradX * gradX + gradZ * gradZ);
      let ux = 0.0, uz = 0.0;
      if(gl > 1e-4){ ux = gradX / gl; uz = gradZ / gl; }
      this.emitImpact(x, h0 + 0.1, z, -gradX, 1.0, -gradZ, impactSpeed,
        tanX, tanZ, this.shoreSheetSpan, 0.25, ux * jet, rise, uz * jet);
    }
  }
};

//Lazily build the debug surface-probe ball. It is a CHILD of the splash points
//mesh (which sits at the origin and is never transformed), so it inherits that
//mesh's visible toggle for free — OceanGrid hides the splash mesh during every
//offscreen pass and shows it only in the main pass, so the probe is automatically
//excluded from refraction / reflection / foam captures with no extra plumbing.
//MeshBasicMaterial = unlit, so it reads the same bright red regardless of sun.
AWater.AOcean.OceanSplash.prototype._ensureMarker = function(){
  if(this._marker) return;
  const geo = new THREE.SphereGeometry(0.5, 16, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  const m = new THREE.Mesh(geo, mat);
  m.layers.set(AWater.AOcean.OCEAN_LAYER);
  m.frustumCulled = false;
  m.renderOrder = 11;
  this._marker = m;
  this.mesh.add(m);
};

//Per-frame update. ctx: {time, camX, camZ, windX, windZ, sunColor(THREE.Color),
//skyAmbient(THREE.Color), viewportHeight, resW, resH, linearDepthTexture}.
AWater.AOcean.OceanSplash.prototype.tick = function(ctx){
  const u = this.material.uniforms;
  //Push art / lighting uniforms regardless of enable state so a toggle is instant.
  u.uOpacity.value = this.opacity;
  u.uSizeScale.value = this.sizeScale;
  u.uSoftRange.value = this.softRange;
  u.uMaxPointSize.value = this.maxPointSize;
  u.uDebugMode.value = this.debugMode;
  u.uViewportHeight.value = ctx.viewportHeight;
  u.uResolution.value.set(ctx.resW, ctx.resH);
  u.uPhaseG.value = this.phaseG;
  u.uPhaseGain.value = this.phaseGain;
  u.uNoiseScale.value = this.noiseScale;
  u.uErode.value = this.erode;
  u.uSoftEdge.value = this.softEdge;
  u.uNoiseEvolve.value = this.noiseEvolve;
  if(ctx.linearDepthTexture) u.uLinearDepth.value = ctx.linearDepthTexture;
  if(ctx.sunColor) u.sunColor.value.copy(ctx.sunColor);
  if(ctx.skyAmbient) u.skyAmbientColor.value.copy(ctx.skyAmbient);
  if(ctx.sunDir) u.sunDir.value.copy(ctx.sunDir);

  //Scene sun shadow receive. ocean-grid hands us the same shadow map + params it
  //wires into the water surface, so spray darkens consistently under the rocks /
  //lighthouse. Gated by our own receiveShadow knob so it can be toggled alone.
  if(this.receiveShadow && ctx.sunShadowEnabled && ctx.sunShadowMap){
    u.sunShadowEnabled.value = 1;
    u.sunShadowMap.value = ctx.sunShadowMap;
    u.sunShadowMatrix.value.copy(ctx.sunShadowMatrix);
    u.sunShadowMapSize.value.set(ctx.sunShadowMapW, ctx.sunShadowMapH);
    u.sunShadowRadius.value = ctx.sunShadowRadius;
    u.sunShadowBias.value = ctx.sunShadowBias;
  } else {
    u.sunShadowEnabled.value = 0;
  }

  let dt = 0.0;
  if(this._prevTime >= 0.0) dt = (ctx.time - this._prevTime) / 1000.0;
  this._prevTime = ctx.time;
  if(dt < 0.0) dt = 0.0;
  if(dt > 0.05) dt = 0.05; //clamp big stalls so bursts do not teleport.

  const field = AWater.AOcean.waveField;

  //Keep the rendered-FFT height snapshot warm so the emitters can spawn against the
  //water we actually see (see _surfaceHeight). ocean-grid renders it only on demand.
  if((this.enabled || this.debugMarker) && this.useRenderedHeight && AWater.AOcean.requestFFTSnapshot){
    AWater.AOcean.requestFFTSnapshot();
  }

  //Debug surface probe: park the ball ON the sampled emission surface in front of
  //the camera. Same height source the emitters use, so its alignment with the
  //visible waterline tells us whether spawn POSITION is correct (vs the rise gate).
  if(this.debugMarker && field){
    this._ensureMarker();
    const fx = ctx.camFwdX || 0.0, fz = ctx.camFwdZ || 1.0;
    const mx = ctx.camX + fx * this.debugMarkerAhead;
    const mz = ctx.camZ + fz * this.debugMarkerAhead;
    const my = this._surfaceHeight(field, mx, mz, field.currentTimeSeconds);
    this._marker.position.set(mx, my, mz);
    this._marker.visible = true;
  } else if(this._marker){
    this._marker.visible = false;
  }

  if(this.enabled && field && dt > 0.0){
    this._emitCrest(field, field.currentTimeSeconds, ctx.camX, ctx.camZ, ctx.windX, ctx.windZ);
    if(this.impactEnabled){
      this._emitShore(field, field.currentTimeSeconds, ctx.camX, ctx.camZ,
                      ctx.camFwdX || 0.0, ctx.camFwdZ || 1.0);
    }
  }

  //── Simulate + compact. Swap-remove dead slots with the last live slot. ─────
  const pos = this._positions, vel = this._vel, age = this._age, life = this._life;
  const sizes = this._sizes, age01 = this._age01, seeds = this._seeds, types = this._types;
  const drag = Math.exp(-this.airDrag * dt);
  const gdt = this.gravity * dt;
  //Air drag is a force on the velocity RELATIVE TO THE AIR, so it damps the
  //horizontal velocity toward the air velocity it FEELS — which is what carries
  //spray downwind. Vertical wind is ~0, so vy keeps damping toward 0 under gravity.
  //Time constant 1/airDrag (~1.4s) < lifetime, so a droplet only partially
  //converges: it drifts, it doesn't snap to the wind.
  //
  //The air a droplet feels ramps from STILL (0) to full wind over a per-type time:
  //impact spray is knocked off a solid and arcs ballistically before the wind grabs
  //it (early couple~0 → drag damps its launch toward zero, so the up-arc reads),
  //then the wind ramps in and carries the survivors. Crest mist couples instantly.
  const windX = ctx.windX || 0.0;
  const windZ = ctx.windZ || 0.0;
  const impactRamp = this.impactWindRampTime;
  let n = this.liveCount;
  let i = 0;
  while(i < n){
    age[i] += dt;
    if(age[i] >= life[i]){
      //Swap-remove: move last live particle into slot i, shrink, retry i.
      const last = n - 1;
      if(i !== last){
        const di = i * 3, dl = last * 3;
        pos[di] = pos[dl]; pos[di + 1] = pos[dl + 1]; pos[di + 2] = pos[dl + 2];
        vel[di] = vel[dl]; vel[di + 1] = vel[dl + 1]; vel[di + 2] = vel[dl + 2];
        age[i] = age[last]; life[i] = life[last];
        sizes[i] = sizes[last]; seeds[i] = seeds[last]; types[i] = types[last];
      }
      n--;
      continue;
    }
    const p3 = i * 3;
    //Ballistic integrate with light air drag toward the FELT air velocity. Impact
    //spray (type 1) ramps its felt wind in over impactWindRampTime so it arcs up
    //first, AND only ever drifts at impactWindFactor of the wind (heavy droplets do
    //not reach wind speed). Crest mist (type 0) feels full wind immediately.
    let couple = 1.0;
    if(types[i] > 0.5){
      let ramp = impactRamp > 0.0 ? age[i] / impactRamp : 1.0;
      if(ramp > 1.0) ramp = 1.0;
      couple = ramp * this.impactWindFactor;
    }
    const fwX = windX * couple, fwZ = windZ * couple;
    vel[p3] = fwX + (vel[p3] - fwX) * drag;
    vel[p3 + 1] = (vel[p3 + 1] - gdt) * drag;
    vel[p3 + 2] = fwZ + (vel[p3 + 2] - fwZ) * drag;
    pos[p3] += vel[p3] * dt;
    pos[p3 + 1] += vel[p3 + 1] * dt;
    pos[p3 + 2] += vel[p3 + 2] * dt;
    //Re-absorbed once it falls (descending) back to the surface it lands on: the
    //WATER we see in open sea, or the LAND where terrain rises above the water
    //(shore spray arcs up a rock and dies ON the rock, instead of sinking through
    //it to the distant waterline). killY = whichever surface is higher here.
    if(field){
      let killY = this._surfaceHeight(field, pos[p3], pos[p3 + 2], field.currentTimeSeconds);
      if(this._terrain){
        const tY = this.sampleTerrainHeight(pos[p3], pos[p3 + 2]);
        if(tY !== null && tY > killY) killY = tY;
      }
      if(pos[p3 + 1] < killY && vel[p3 + 1] < 0.0){
        const last = n - 1;
        if(i !== last){
          const di = i * 3, dl = last * 3;
          pos[di] = pos[dl]; pos[di + 1] = pos[dl + 1]; pos[di + 2] = pos[dl + 2];
          vel[di] = vel[dl]; vel[di + 1] = vel[dl + 1]; vel[di + 2] = vel[dl + 2];
          age[i] = age[last]; life[i] = life[last];
          sizes[i] = sizes[last]; seeds[i] = seeds[last]; types[i] = types[last];
        }
        n--;
        continue;
      }
    }
    age01[i] = age[i] / life[i];
    i++;
  }
  this.liveCount = n;

  this._posAttr.needsUpdate = true;
  this._sizeAttr.needsUpdate = true;
  this._ageAttr.needsUpdate = true;
  this._seedAttr.needsUpdate = true;
  this._typeAttr.needsUpdate = true;
  this.geometry.setDrawRange(0, n);
};
