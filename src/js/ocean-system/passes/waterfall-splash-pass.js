//── WaterfallSplashPass ─────────────────────────────────────────────────────
//
//The splash bursts where the waterfalls land: at every touchdown the trace recorded (each
//ledge, and the plunge) a raymarched burst of spray is thrown up off the water, rises against
//drag, falls back, and fires again. The first of the foot particles; it stands in for the old
//type-3 splash clumps (OceanSplash), which stay off while the volumetric mist is drawing.
//
//THE VOLUMES are blobs (ARestlessOcean.WaterfallSplashHull: a sphere per landing, and the model
//of the burst inside it). Like the mist, the pass has no tracing of its own; it rides the sheet
//pass's cascades and rebuilds a cascade's blobs only when the sheet swaps in a new trace
//(geometryVersion).
//
//THE FOAM FOG is drawn in the same blobs (waterfall-splash.glsl: the third term of the density,
//after the column and the falling skirt), so it costs no extra overdraw.
//
//THE RINGS. Each fall's landing line (WaterfallSplashHull.ringLines) sends drawn trains of waves
//across its pool: every frame the pass hands the FALL_RINGS_MAX wet segments nearest the camera to
//ARestlessOcean.DynamicWaves.fallRings, which the water's ripple chunk draws (dynamic-waves-pass.js
//"Fall rings"). Live: ringsEnabled, ringOptions (WaterfallSplashHull.RING_DEFAULTS, then rebuild()),
//DynamicWaves.FALL_RINGS (wavelength, decay, wobble, groups, gain); console ringStats().
//
//THE SURFACE MIST. A second mesh (mistMesh, a child of the splash mesh, so it shows and hides with
//it) draws the SAME material in its surface-mist mode (uSurfaceMist 1, every other uniform shared):
//one box per landing line, reaching uSMReach downstream, inside which a thin layer of mist lies on the
//pool's still level (waterfall-splash.glsl "THE SURFACE MIST"). The fall rings' functions are
//spliced into the fragment at its FALL_RINGS injection point; their uniforms ride along with the
//splash's. The boxes rebuild themselves when uSMReach or uSMHeight changes.
//
//ONE LIGHT, ONE SKY, and the RENDER STATE: as WaterfallMistPass (read its header). The material
//aliases the flowing material's uniform objects; transparent, no depth write, no depth test,
//front faces culled, OCEAN_LAYER. renderOrder 9: after the mist (8), before the spray (10).

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.WaterfallSplashPass = function(oceanGrid, sheetPass){
  this.oceanGrid = oceanGrid;
  this.sheetPass = sheetPass;
  this.mesh = null;
  this.material = null;
  this.enabled = true;
  //Whether the splash should be on screen this frame (the sheet is up, there are blobs). The grid
  //turns that into mesh.visible at the end of its tick, after the offscreen passes.
  this.wantVisible = false;
  //Hull options (WaterfallSplashHull.DEFAULTS), live: set then call rebuild().
  this.hullOptions = {};
  this._geometryVersion = -1;
  this._hulls = new WeakMap();
  this._atmReady = false;
  //Rings (see the header).
  this.ringsEnabled = true;
  this.ringOptions = {};
  this._ringSegments = [];
  this._ringPick = [];
  this._ringReason = 'not ticked';
  this.mistMesh = null;
  this.mistMaterial = null;
};

//renderOrder of the surface mist: after the volumetric mist (8), before the splash (9).
ARestlessOcean.Passes.WaterfallSplashPass.MIST_RENDER_ORDER = 8.5;

//The splash fragment with the fall rings' functions spliced in (a stub that draws nothing without them).
ARestlessOcean.Passes.WaterfallSplashPass.fragmentSource = function(atm, atmGLSL){
  const DW = ARestlessOcean.DynamicWaves;
  const rings = DW && DW.FALL_RINGS_GLSL ? DW.FALL_RINGS_GLSL : [
    '#define FALL_RINGS_N 1',
    'float dwSurfaceLevel = -1.0e9;',
    'uniform vec4 fallRingSeg[1];', 'uniform vec4 fallRingParam[1];', 'uniform vec4 fallRingExtra[1];', 'uniform float fallRingCount;',
    'uniform vec4 fallRingWave;', 'uniform vec4 fallRingNoise;',
    'float fallRingsHeightAt(vec2 xz){ return 0.0; }'
  ].join('\n');
  return ARestlessOcean.Materials.Ocean.waterfallSplashMaterial.fragmentShader(atm, atmGLSL)
    .replace('//FALL_RINGS_INJECTION_POINT', function(){ return rings; });
};

//How often (ms) a ring segment asks again whether there is water under it.
ARestlessOcean.Passes.WaterfallSplashPass.WET_RECHECK_MS = 1000.0;

ARestlessOcean.Passes.WaterfallSplashPass.RENDER_ORDER = 9;

ARestlessOcean.Passes.WaterfallSplashPass.prototype.init = function(scene){
  const WS = ARestlessOcean.Passes.WaterfallSplashPass;
  const def = ARestlessOcean.Materials.Ocean.waterfallSplashMaterial;
  const og = this.oceanGrid;
  const uniforms = ARestlessOcean.cloneUniforms(def.uniforms);
  const flow = og.flowSurfacePass && og.flowSurfacePass.material;
  //The flowing material's uniforms the mist aliases are the ones the splash needs too.
  const shared = ARestlessOcean.Passes.WaterfallMistPass.SHARED_UNIFORMS;
  if(flow){
    for(let i = 0; i < shared.length; ++i){
      const name = shared[i];
      if(flow.uniforms[name]) uniforms[name] = flow.uniforms[name];
    }
  }
  //The fall rings' uniforms (the surface mist rides the waves): DynamicWaves' own objects.
  if(ARestlessOcean.DynamicWaves && ARestlessOcean.DynamicWaves.createUniforms){
    const ru = ARestlessOcean.DynamicWaves.createUniforms();
    ['fallRingSeg', 'fallRingParam', 'fallRingExtra', 'fallRingCount', 'fallRingWave', 'fallRingNoise'].forEach(function(k){ if(ru[k]) uniforms[k] = ru[k]; });
  }
  this.material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: def.vertexShader,
    fragmentShader: WS.fragmentSource(false, null),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    //Cull the FRONT faces: each pixel is where its view ray leaves the blob's proxy.
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
    lights: false,
    fog: true
  });
  //The same fog-chunk swap the sheet makes, so the scene fog and the underwater fog reach it.
  //(Every <fog_fragment>: the surface mist's fragment applies the fog too.)
  if(THREE.fogParsVert && THREE.fogVert && THREE.fogParsFrag && THREE.fogFrag){
    this.material.onBeforeCompile = function(shader){
      shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', THREE.fogParsVert);
      shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', THREE.fogVert);
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', THREE.fogParsFrag);
      shader.fragmentShader = shader.fragmentShader.split('#include <fog_fragment>').join(THREE.fogFrag);
    };
  }
  //The surface mist: the same material in its other mode, every uniform shared but the switch.
  this.mistMaterial = this.material.clone();
  this.mistMaterial.uniforms = Object.assign({}, uniforms, {uSurfaceMist: {value: 1.0}});
  this.mistMaterial.onBeforeCompile = this.material.onBeforeCompile;
  this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
  this.mesh.renderOrder = WS.RENDER_ORDER;
  this.mesh.castShadow = false;
  this.mesh.receiveShadow = false;
  this.mesh.frustumCulled = true;
  this.mesh.visible = false;
  this.mesh.layers.set(ARestlessOcean.OCEAN_LAYER);
  this.mesh.userData.waterfallSplash = true;
  scene.add(this.mesh);
  //A child: it shows and hides with the splash (the grid toggles the splash mesh round its passes).
  this.mistMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mistMaterial);
  this.mistMesh.renderOrder = WS.MIST_RENDER_ORDER;
  this.mistMesh.castShadow = false;
  this.mistMesh.receiveShadow = false;
  this.mistMesh.frustumCulled = true;
  this.mistMesh.layers.set(ARestlessOcean.OCEAN_LAYER);
  this.mistMesh.userData.waterfallSurfaceMist = true;
  this.mesh.add(this.mistMesh);
};

//A box (8 corners, 12 triangles wound outward) per landing line, for the surface mist: the line's
//segments and as far downstream as the mist reaches, padded; from below the deepest trough to above
//the mist. Attributes as the shader's surface-mist mode reads them.
ARestlessOcean.Passes.WaterfallSplashPass.prototype._buildMistBoxes = function(segments){
  const R = Math.max(this.material.uniforms.uSMReach.value, 1.0);
  //Tall enough for the layer's top (5 e-folds over the level).
  const H = Math.max(this.material.uniforms.uSMHeight.value, 0.01);
  this._mistBuiltFor = R + ':' + H;
  const byLine = new Map();
  for(let i = 0; i < segments.length; ++i){
    const g = segments[i];
    const key = g._hull + ':' + g.line;
    if(!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(g);
  }
  const pos = [], cen = [], sA = [], sB = [], sC = [], idx = [];
  byLine.forEach(function(segs){
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, level = 0.0, amp = 0.0, all = false, size = 0.0;
    for(let i = 0; i < segs.length; ++i) size += segs[i].size !== undefined ? segs[i].size : 1.0;
    size /= segs.length;
    //The mist reaches size x uSMReach (a short step's stays near its foot).
    const Rl = R * size;
    for(let i = 0; i < segs.length; ++i){
      const g = segs[i];
      const ends = [[g.ax, g.az], [g.bx, g.bz]];
      if(g.nx !== 0.0 || g.nz !== 0.0){ ends.push([g.ax + g.nx * Rl, g.az + g.nz * Rl], [g.bx + g.nx * Rl, g.bz + g.nz * Rl]); }
      else all = true;
      for(let e = 0; e < ends.length; ++e){
        x0 = Math.min(x0, ends[e][0]); x1 = Math.max(x1, ends[e][0]);
        z0 = Math.min(z0, ends[e][1]); z1 = Math.max(z1, ends[e][1]);
      }
      level += g.y; amp += g.amp;
    }
    level /= segs.length; amp /= segs.length;
    const pad = all ? Rl : 0.5 * Rl;
    x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    const y0 = level - 0.5, y1 = level + 0.5 + 5.5 * H;
    const cx = 0.5 * (x0 + x1), cy = 0.5 * (y0 + y1), cz = 0.5 * (z0 + z1);
    const strength = amp / ARestlessOcean.WaterfallSplashHull.RING_DEFAULTS.amplitude;
    const base = pos.length / 3;
    const corners = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    for(let k = 0; k < 8; ++k){
      pos.push(corners[k][0], corners[k][1], corners[k][2]);
      cen.push(cx, cy, cz, 0.0);
      sA.push(0.5 * (x1 - x0), 0.5 * (y1 - y0), 0.5 * (z1 - z0), segs[0].seed);
      sB.push(level, strength, size, 0.0);
      sC.push(0.0, 0.0, 0.0, 0.0);
    }
    const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
    for(let q = 0; q < quads.length; ++q){
      const f = quads[q];
      for(const tri of [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]){
        //Outward: the face normal points away from the box's middle.
        const a = corners[tri[0]], b = corners[tri[1]], c = corners[tri[2]];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const out = nx * ((a[0] + b[0] + c[0]) / 3 - cx) + ny * ((a[1] + b[1] + c[1]) / 3 - cy) + nz * ((a[2] + b[2] + c[2]) / 3 - cz);
        if(out >= 0.0) idx.push(base + tri[0], base + tri[1], base + tri[2]);
        else idx.push(base + tri[0], base + tri[2], base + tri[1]);
      }
    }
  });
  const old = this.mistMesh.geometry;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aCenter', new THREE.BufferAttribute(new Float32Array(cen), 4));
  geo.setAttribute('aSplashA', new THREE.BufferAttribute(new Float32Array(sA), 4));
  geo.setAttribute('aSplashB', new THREE.BufferAttribute(new Float32Array(sB), 4));
  geo.setAttribute('aSplashC', new THREE.BufferAttribute(new Float32Array(sC), 4));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  if(pos.length) geo.computeBoundingSphere();
  this.mistMesh.geometry = geo;
  old.dispose();
};

//Merge every cascade's blobs into the one geometry (one draw call).
ARestlessOcean.Passes.WaterfallSplashPass.prototype._rebuildGeometry = function(){
  const sp = this.sheetPass;
  const env = typeof sp._env === 'function' ? sp._env() : null;
  const hulls = [];
  const segments = [];
  let nV = 0, nI = 0;
  for(let i = 0; i < sp.cascades.length; ++i){
    const nap = sp.cascades[i].nappe;
    if(!nap) continue;
    let h = this._hulls.get(nap);
    if(h === undefined){
      h = ARestlessOcean.WaterfallSplashHull.build(nap, this.hullOptions, env);
      this._hulls.set(nap, h);
    }
    if(!h) continue;
    hulls.push(h);
    const lines = ARestlessOcean.WaterfallSplashHull.ringLines(h.ranges, this.ringOptions);
    for(let j = 0; j < lines.length; ++j){
      lines[j]._hull = hulls.length;
      lines[j].wet = true;
      lines[j].wetCheckedMs = -1e9;
      segments.push(lines[j]);
    }
    nV += h.vertexCount; nI += h.index.length;
  }
  const position = new Float32Array(nV * 3), center = new Float32Array(nV * 4);
  const splashA = new Float32Array(nV * 4), splashB = new Float32Array(nV * 4), splashC = new Float32Array(nV * 4);
  const index = new Uint32Array(nI);
  let v = 0, k = 0;
  for(let i = 0; i < hulls.length; ++i){
    const h = hulls[i];
    position.set(h.position, v * 3); center.set(h.center, v * 4);
    splashA.set(h.splashA, v * 4); splashB.set(h.splashB, v * 4); splashC.set(h.splashC, v * 4);
    for(let j = 0; j < h.index.length; ++j) index[k + j] = h.index[j] + v;
    v += h.vertexCount; k += h.index.length;
  }
  const old = this.mesh.geometry;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aCenter', new THREE.BufferAttribute(center, 4));
  geo.setAttribute('aSplashA', new THREE.BufferAttribute(splashA, 4));
  geo.setAttribute('aSplashB', new THREE.BufferAttribute(splashB, 4));
  geo.setAttribute('aSplashC', new THREE.BufferAttribute(splashC, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  if(nV) geo.computeBoundingSphere();
  this.mesh.geometry = geo;
  old.dispose();
  this._ringSegments = segments;
  if(this.mistMesh) this._buildMistBoxes(segments);
};

//Hand the wet ring segments nearest the camera to the water (DynamicWaves.fallRings).
ARestlessOcean.Passes.WaterfallSplashPass.prototype._tickRings = function(timeMs){
  const DW = ARestlessOcean.DynamicWaves;
  if(!DW || !DW.fallRings) return;
  const st = DW.fallRings;
  st.count = 0;
  if(timeMs !== undefined) st.timeSec = timeMs * 0.001;
  this._ringReason = !this.ringsEnabled ? 'ringsEnabled false' : !this.wantVisible ? 'splash not visible (no sheet up)'
                   : !this._ringSegments.length ? 'no ring segments (no plunge traced?)' : 'running';
  if(this._ringReason !== 'running') return;
  const og = this.oceanGrid;
  const cam = og.globalCameraPosition;
  const cx = cam ? cam.x : 0.0, cz = cam ? cam.z : 0.0;
  const sp = this.sheetPass;
  const env = sp && typeof sp._env === 'function' ? sp._env() : null;
  const recheck = ARestlessOcean.Passes.WaterfallSplashPass.WET_RECHECK_MS;
  const reach = 5.0 * DW.FALL_RINGS.decay;
  const gain = Math.max(DW.FALL_RINGS.gain, 0.0);
  const pick = this._ringPick;
  pick.length = 0;
  for(let i = 0; i < this._ringSegments.length; ++i){
    const g = this._ringSegments[i];
    //Distance from the camera to the segment (nearest first).
    const ex = g.bx - g.ax, ez = g.bz - g.az, l2 = ex * ex + ez * ez;
    const u = l2 > 1e-9 ? Math.min(Math.max(((cx - g.ax) * ex + (cz - g.az) * ez) / l2, 0.0), 1.0) : 0.0;
    const dist = Math.hypot(cx - (g.ax + ex * u), cz - (g.az + ez * u));
    if(dist > reach + 400.0) continue;
    //Water under it? Re-asked every second: a-land answers null while the tile loads.
    //...and its level, which the waves are gated on (the build-time one may predate the tile).
    if(env && typeof env.waterAt === 'function' && timeMs - g.wetCheckedMs > recheck){
      const wa = env.waterAt(g.ax, g.az), wb = env.waterAt(g.bx, g.bz);
      const okA = !!(wa && wa.depth > 0.02), okB = !!(wb && wb.depth > 0.02);
      g.wet = okA || okB;
      if(g.wet){
        const lv = okA && okB ? 0.5 * (wa.level + wb.level) : okA ? wa.level : wb.level;
        if(isFinite(lv) && Math.abs(lv - g.y) > 0.1){ g.y = lv; this._mistLevelsDirty = true; }
      }
      g.wetCheckedMs = timeMs;
    }
    if(!g.wet) continue;
    g._dist = dist;
    pick.push(g);
  }
  pick.sort(function(a, b){ return a._dist - b._dist; });
  const n = Math.min(pick.length, DW.FALL_RINGS_MAX);
  for(let i = 0; i < n; ++i){
    const g = pick[i];
    st.seg[i].set(g.ax, g.az, g.bx, g.bz);
    st.param[i].set(g.amp * gain, g.nx, g.nz, g.seed);
    if(st.extra) st.extra[i].set(g.y, g.size !== undefined ? g.size : 1.0, 0.0, 0.0);
  }
  //A line's level moved (its tile arrived): the mist boxes sit at it.
  if(this._mistLevelsDirty && this.mistMesh){
    this._mistLevelsDirty = false;
    this._buildMistBoxes(this._ringSegments);
  }
  st.count = n;
};

//Console: what the rings are doing.
ARestlessOcean.Passes.WaterfallSplashPass.prototype.ringStats = function(){
  const DW = ARestlessOcean.DynamicWaves;
  const segs = this._ringSegments;
  let wet = 0;
  for(let i = 0; i < segs.length; ++i) if(segs[i].wet) wet++;
  const near = this._ringPick.length ? this._ringPick[0] : null;
  const mi = this.mistMesh && this.mistMesh.geometry.index;
  return {reason: this._ringReason, segments: segs.length, wet: wet, drawn: DW && DW.fallRings ? DW.fallRings.count : 0,
          mistBoxes: mi ? mi.count / 36 : 0,
          nearestM: near ? +near._dist.toFixed(1) : null, nearestAmplitudeM: near ? +(near.amp * DW.FALL_RINGS.gain).toFixed(3) : null,
          settings: DW ? Object.assign({}, DW.FALL_RINGS) : null};
};

//Throw the cached blobs away and rebuild them (after changing hullOptions).
ARestlessOcean.Passes.WaterfallSplashPass.prototype.rebuild = function(){
  this._hulls = new WeakMap();
  this._geometryVersion = -1;
};

//ctx: {enabled, timeMs}
ARestlessOcean.Passes.WaterfallSplashPass.prototype.tick = function(ctx){
  this.enabled = ctx.enabled !== false;
  if(!this.mesh) return;
  const sp = this.sheetPass;
  if(sp && sp.geometryVersion !== this._geometryVersion){
    this._geometryVersion = sp.geometryVersion;
    this._rebuildGeometry();
  }
  const idx = this.mesh.geometry.index;
  //Up only while the sheet is up: a fall nobody is drawing does not splash either.
  this.wantVisible = this.enabled && !!sp && !!sp.mesh && sp.mesh.visible && idx !== null && idx.count > 0;
  this._tickRings(ctx.timeMs);
  //The fog pulses with the pool's waves: hand it their wavenumber and frequency (FALL_RINGS is live).
  const DW = ARestlessOcean.DynamicWaves;
  if(DW && DW.writeFallRingUniforms) DW.writeFallRingUniforms(this.material.uniforms);
  //The mist boxes follow uSMReach and uSMHeight (live knobs): rebuild them when either changes.
  const mu = this.material.uniforms;
  if(this.mistMesh && this._mistBuiltFor !== undefined && this._mistBuiltFor !== Math.max(mu.uSMReach.value, 1.0) + ':' + Math.max(mu.uSMHeight.value, 0.01)){
    this._buildMistBoxes(this._ringSegments);
  }
  if(DW && DW.FALL_RINGS && this.material.uniforms.uRingWave){
    const k = 2.0 * Math.PI / Math.max(DW.FALL_RINGS.wavelength, 0.05);
    this.material.uniforms.uRingWave.value.set(k, Math.sqrt(DW.G * k));
  }
  //Atmospheric perspective, as the sheet does it: rebuild the fragment shader once it is ready.
  const og = this.oceanGrid;
  const atm = !!(og.atmosphericPerspectiveEnabled && og.atmosphereFunctionsGLSL);
  if(atm !== this._atmReady){
    this._atmReady = atm;
    this.material.fragmentShader = ARestlessOcean.Passes.WaterfallSplashPass.fragmentSource(atm, og.atmosphereFunctionsGLSL);
    this.material.needsUpdate = true;
    if(this.mistMaterial){
      this.mistMaterial.fragmentShader = this.material.fragmentShader;
      this.mistMaterial.needsUpdate = true;
    }
  }
};

ARestlessOcean.Passes.WaterfallSplashPass.prototype.resize = function(){};

ARestlessOcean.Passes.WaterfallSplashPass.prototype.dispose = function(){
  if(this.mesh){
    if(this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
  if(this.mistMesh){ this.mistMesh.geometry.dispose(); this.mistMesh = null; }
  if(this.mistMaterial){ this.mistMaterial.dispose(); this.mistMaterial = null; }
  if(this.material){ this.material.dispose(); this.material = null; }
  this._hulls = new WeakMap();
  this._ringSegments = [];
  this.wantVisible = false;
  if(ARestlessOcean.DynamicWaves && ARestlessOcean.DynamicWaves.fallRings) ARestlessOcean.DynamicWaves.fallRings.count = 0;
};
