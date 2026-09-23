//── WaterfallSheetPass ──────────────────────────────────────────────────────
//
//Phase 6 (WATER-TYPES.md): the water between a lip and whatever it lands on.
//
//Through Phase 4 a fall was drawn by the flowing-water HEIGHTFIELD stretched over
//the step, a steep ramp one or two cells long that the cliff clipped through. This
//pass draws the fall as its own surface: a SKIRT woven between the paths
//ARestlessOcean.WaterfallNappe traces for the water, one strand every half metre across
//the creek (airborne off each lip, sliding down chutes, landing on ledges, plunging into
//pools), torn where the strands part round a rock. Cascades are one skirt per chain of
//falls, not one per fall.
//
//THE HAND-OFF WITH THE CREEK SURFACE
//The ribbon draws where the nappe's `presence` is up (airborne, or sliding down a bed
//steeper than tan 20°..30°). The flowing-water material fades ITSELF out over the same
//slope band, but only inside this pass's corridor boxes (fallCorridor* uniforms,
//streamed below), so flat ledges and pools between the steps stay on the creek surface
//and the steps move to the sheet. Outside a fall's corridor nothing changes: small bed
//steps a-land does not export as falls keep the creek's steep-level whitewater.
//
//ONE WATER
//The sheet's material aliases the flowing material's uniform OBJECTS (SHARED_UNIFORMS)
//rather than copying values: the grid's per-frame loop already writes those, so the fall
//is lit, coloured and foam-textured by the very numbers the creek is, with no second
//stream to drift. See waterfall-sheet.glsl.
//
//BUILDING
//Traces run on the CPU against a-land's height and water reads, STRANDS_PER_TICK strands a
//frame, and again whenever a-land's height or water residency changes (finer tiles sharpen
//the ground a trace was run on), its terrain is edited or the ocean's wind moves (the
//sheet's steady bow downwind is traced). A trace that meets unloaded ground is retried.
//The ground read goes to the DIRECTOR with a NaN miss value: a-land's public
//api.getHeightAt drops that argument and answers 0 m for unloaded ground, which is a
//plausible height and would put a fall's landing at sea level.
//
//RENDER STATE
//Transparent, writes depth (faded fragments discard), DoubleSide, renderOrder 5 (after the flowing surface's 3,
//before the splash's 10), OCEAN_LAYER. As a ShaderMaterial on OCEAN_LAYER it is already
//skipped by the refraction G-buffer, the mirror, the foam ortho and the ocean CSM, and it
//casts no scene shadow. Not registered with the grid: the water uniform loop assumes a
//Y-up surface.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.WaterfallSheetPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.mesh = null;
  this.material = null;
  this.enabled = true;
  //One entry per cascade: {chain, nappe (or null while unbuilt), ribbon}
  this.cascades = [];
  //Built nappes, for the spray and the foam (landing points, impacts).
  this.nappes = [];
  this._falls = null;
  this._heightVersion = -1;
  this._queue = [];
  //The chain being traced, strand by strand: {i, job} (WaterfallNappe.beginTrace), or null.
  this._job = null;
  //The wind the built traces were run in: {x, z} m/s.
  this._tracedWind = null;
  //Cascades whose trace met unloaded ground: {i, atMs}, retried on their own clock so one
  //fall on ground that never streams in cannot hold back the others (see tick).
  this._retry = [];
  this._dirtyGeometry = false;
  this._waterVersion = -1;
  this._lastInvalidateMs = -1e9;
  this._corridors = [];
  this._atmReady = false;
};

ARestlessOcean.Passes.WaterfallSheetPass.RENDER_ORDER = 5;
ARestlessOcean.Passes.WaterfallSheetPass.MAX_CORRIDORS = 48;   //water-shader.glsl + waterfall-sheet.glsl FALL_CORRIDOR_MAX (a lead box per fall since 2026-09-23: falls-lab needs 30)
ARestlessOcean.Passes.WaterfallSheetPass.RETRY_MS = 1000;
ARestlessOcean.Passes.WaterfallSheetPass.REBUILD_MS = 2000;
ARestlessOcean.Passes.WaterfallSheetPass.STRANDS_PER_TICK = 2;   //~0.85 ms each on hero-creek (4090 box, 2026-09-22)
//m/s the ocean's wind must change by before the sheets are re-traced (their steady bow is traced).
ARestlessOcean.Passes.WaterfallSheetPass.WIND_RETRACE = 0.5;
//The creek-material uniforms the sheet aliases (see the header).
ARestlessOcean.Passes.WaterfallSheetPass.SHARED_UNIFORMS = [
  'brightestDirectionalLight', 'brightestDirectionalLightDirection', 'skyAmbientColor',
  'waterAbsorption', 'waterScattering', 'waterSurfaceY', 'specBoost', 't',
  'sunShadowMap', 'sunShadowMatrix', 'sunShadowMapSize', 'sunShadowRadius', 'sunShadowBias', 'sunShadowEnabled',
  'refractionLinearDepth', 'refractionColorTexture', 'gBufferNormal', 'refractionDepthTexture',
  'inverseProjectionMatrix', 'inverseViewMatrix', 'screenResolution',
  'cameraNearFar', 'ssrViewMatrix', 'ssrProjectionMatrix', 'ssrMaxSteps', 'blueNoiseTexture',
  'meteringSurveyTexture', 'meteringSurveyValid', 'underwaterFactor',
  'atmosphereTransmittance', 'atmosphereMieInscattering', 'atmosphereRayleighInscattering',
  'atmSunPosition', 'atmMoonPosition', 'atmSunHorizonFade', 'atmMoonHorizonFade',
  'atmScatteringSunIntensity', 'atmScatteringMoonIntensity', 'atmMoonLightColor',
  'atmCameraHeight', 'atmDistanceScale',
  'waterFieldCascade0', 'waterFieldCascadeCenter', 'waterFieldCascadeHalfWidth',
  'causticMap', 'causticIntensityMultiplier',
  //Ring 0's corridor objects, which _streamCorridors fills: the sheet evaluates the creek's
  //step-aside rule with the very same boxes.
  'fallCorridorA', 'fallCorridorB', 'fallCorridorCount',
  'foamOpacityMap', 'foamNormalMap', 'flowWaveProfile', 'flowRippleScale'
];

ARestlessOcean.Passes.WaterfallSheetPass.prototype.init = function(scene){
  const WS = ARestlessOcean.Passes.WaterfallSheetPass;
  const def = ARestlessOcean.Materials.Ocean.waterfallSheetMaterial;
  const og = this.oceanGrid;
  const uniforms = ARestlessOcean.cloneUniforms(def.uniforms);
  const flow = og.flowSurfacePass && og.flowSurfacePass.material;
  if(flow){
    for(let i = 0; i < WS.SHARED_UNIFORMS.length; ++i){
      const name = WS.SHARED_UNIFORMS[i];
      if(flow.uniforms[name]) uniforms[name] = flow.uniforms[name];
    }
  }
  this.material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: def.vertexShader,
    fragmentShader: def.fragmentShader(false, null, !!og.causticsEnabled),
    transparent: true,
    //Writes depth: from above the lip the tongue must hide the fall behind it (one mesh,
    //drawn in row order, the fall painted over the tongue otherwise). Faded fragments discard.
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    lights: false,
    fog: true
  });
  //The same fog-chunk swap the water material makes (ocean-grid.js), so the scene fog
  //and the underwater fog reach the sheet as they reach the creek.
  if(THREE.fogParsVert && THREE.fogVert && THREE.fogParsFrag && THREE.fogFrag){
    this.material.onBeforeCompile = function(shader){
      shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', THREE.fogParsVert);
      shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', THREE.fogVert);
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', THREE.fogParsFrag);
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', THREE.fogFrag);
    };
  }
  this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
  this.mesh.renderOrder = WS.RENDER_ORDER;
  this.mesh.castShadow = false;
  this.mesh.receiveShadow = false;
  this.mesh.frustumCulled = true;
  this.mesh.visible = false;
  this.mesh.layers.set(ARestlessOcean.OCEAN_LAYER);
  this.mesh.userData.waterfallSheet = true;
  scene.add(this.mesh);
};

//The trace environment over a-land's director (see the header on the NaN miss).
ARestlessOcean.Passes.WaterfallSheetPass.prototype._env = function(){
  const og = this.oceanGrid;
  const dir = og._landDirector;
  if(!dir || typeof dir.getHeightAt !== 'function') return null;
  return {
    groundAt: function(x, z){
      const h = dir.getHeightAt(x, z, NaN);
      return (h === h) ? h : null;
    },
    waterAt: function(x, z){
      return typeof dir.getWaterAt === 'function' ? dir.getWaterAt(x, z) : null;
    },
    //The ocean's wind (windVelocity.x → world X, .y → world Z): drag on the airborne sheet.
    wind: og.windVelocity ? {x: og.windVelocity.x, z: og.windVelocity.y} : null
  };
};

//Start over: new falls list, a-land height residency changed, or a terrain edit.
ARestlessOcean.Passes.WaterfallSheetPass.prototype.invalidate = function(){
  this._queue.length = 0;
  this._retry.length = 0;
  this._job = null;
  for(let i = 0; i < this.cascades.length; ++i) this._queue.push(i);
};

ARestlessOcean.Passes.WaterfallSheetPass.prototype._syncFalls = function(now){
  const og = this.oceanGrid;
  const mj = og._landDirector && og._landDirector.mapJson;
  const falls = (mj && mj.simulation && mj.simulation.waterfalls) || null;
  if(falls !== this._falls){
    this._falls = falls;
    const chains = falls && falls.length ? ARestlessOcean.WaterfallNappe.chains(falls) : [];
    this.cascades = chains.map(function(c){ return {chain: c, nappe: null, ribbon: null}; });
    this.invalidate();
    this._dirtyGeometry = true;
  }
  //Residency changes arrive with every streamed tile, so they are coalesced: a re-trace
  //at most every REBUILD_MS, and only once the previous round has finished (otherwise the
  //queue refills forever and the merged geometry never publishes).
  //WATER residency too: a-land's getWaterAt answers null until a water tile has loaded, and
  //a trace run before then saw no water at all — the exported 14 m width and Q/W, no pools,
  //no spans — and nothing re-ran it once the water arrived. The field's invalidation count
  //bumps as decoded water tiles land.
  const hc = og._landDirector && og._landDirector.heightCache;
  const ver = hc && typeof hc.version === 'number' ? hc.version : 0;
  const wver = og.waterFieldPass && typeof og.waterFieldPass.invalidationCount === 'number' ? og.waterFieldPass.invalidationCount : 0;
  //...and the WIND: the sheets' steady bow downwind is traced (air drag, WaterfallNappe), so a
  //storm ramp re-traces them, coalesced the same way.
  const wv = og.windVelocity, tw = this._tracedWind;
  const windMoved = !!wv && (!tw || Math.hypot(wv.x - tw.x, wv.y - tw.z) > ARestlessOcean.Passes.WaterfallSheetPass.WIND_RETRACE);
  if((ver !== this._heightVersion || wver !== this._waterVersion || windMoved) && !this._queue.length && !this._job
     && now - this._lastInvalidateMs >= ARestlessOcean.Passes.WaterfallSheetPass.REBUILD_MS){
    this._heightVersion = ver;
    this._waterVersion = wver;
    if(wv) this._tracedWind = {x: wv.x, z: wv.y};
    this._lastInvalidateMs = now;
    this.invalidate();
  }
};

//ctx: {timeMs, enabled}
ARestlessOcean.Passes.WaterfallSheetPass.prototype.tick = function(ctx){
  const WS = ARestlessOcean.Passes.WaterfallSheetPass;
  this.enabled = ctx.enabled !== false;
  if(!this.mesh) return;
  this._syncFalls(ctx.timeMs);
  //STRANDS_PER_TICK strands a frame: a chain is a skirt of strands (WaterfallNappe.trace), one
  //job at a time, and its ribbon is swapped in whole when the last strand is done (the old
  //sheet stays up till then). A chain over unloaded ground (no job, or a null result) moves to
  //the retry list with its own clock rather than back onto the queue, so the queue drains and
  //the geometry publishes (it used to wait for an empty queue that one unstreamed fall kept full).
  const WN = ARestlessOcean.WaterfallNappe;
  const env = this._env();
  if(env){
    if(!this._job){
      let i = -1;
      if(this._queue.length) i = this._queue.shift();
      else if(this._retry.length && ctx.timeMs >= this._retry[0].atMs) i = this._retry.shift().i;
      const c = i >= 0 ? this.cascades[i] : null;
      if(c){
        const job = WN.beginTrace(c.chain, env);
        if(job) this._job = {i: i, job: job};
        else this._retry.push({i: i, atMs: ctx.timeMs + WS.RETRY_MS});
      }
    }
    if(this._job){
      const j = this._job;
      //The job keeps the env it began with; a fresh one per tick reads the same director.
      if(WN.stepTrace(j.job, WS.STRANDS_PER_TICK)){
        this._job = null;
        const c = this.cascades[j.i];
        if(c && j.job.nappe){
          c.nappe = j.job.nappe;
          c.ribbon = WN.buildRibbon(c.nappe, env);
          this._dirtyGeometry = true;
        }
        else if(c) this._retry.push({i: j.i, atMs: ctx.timeMs + WS.RETRY_MS});
      }
    }
  }
  if(this._dirtyGeometry && !this._queue.length && !this._job) this._rebuildGeometry();
  //The wind the gusts sway the sheet in (its steady part is in the trace).
  const wv = this.oceanGrid.windVelocity;
  if(wv && this.material.uniforms.uWind) this.material.uniforms.uWind.value.set(wv.x, wv.y);
  this.mesh.visible = this.enabled && this.mesh.geometry.index !== null && this.mesh.geometry.index.count > 0;
  //Atmospheric perspective, the water's way: with it ready, the fragment shader is rebuilt
  //with the atmosphere functions injected (the sheet then reflects a-starry-sky's sky and
  //applies AP itself, and leaves the scene fog chunk out). AP can become ready a few frames
  //in, like the water's own late recompile, so this is checked every tick and rebuilds once.
  const og = this.oceanGrid;
  const atm = !!(og.atmosphericPerspectiveEnabled && og.atmosphereFunctionsGLSL);
  if(atm !== this._atmReady){
    this._atmReady = atm;
    this.material.fragmentShader = ARestlessOcean.Materials.Ocean.waterfallSheetMaterial.fragmentShader(atm, og.atmosphereFunctionsGLSL, !!og.causticsEnabled);
    this.material.needsUpdate = true;
  }
  this._streamCorridors();
};

//Merge every built ribbon into the one geometry (one draw call).
ARestlessOcean.Passes.WaterfallSheetPass.prototype._rebuildGeometry = function(){
  this._dirtyGeometry = false;
  this.nappes = [];
  this._corridors = [];
  let nV = 0, nI = 0;
  for(let i = 0; i < this.cascades.length; ++i){
    const c = this.cascades[i];
    if(!c.nappe) continue;
    this.nappes.push(c.nappe);
    for(let k = 0; k < c.nappe.corridors.length; ++k) this._corridors.push(c.nappe.corridors[k]);
    if(c.ribbon){ nV += c.ribbon.vertexCount; nI += c.ribbon.index.length; }
  }
  const position = new Float32Array(nV * 3), normal = new Float32Array(nV * 3);
  const tangent = new Float32Array(nV * 3), across = new Float32Array(nV * 3);
  const flowA = new Float32Array(nV * 4), flowB = new Float32Array(nV * 4), lump = new Float32Array(nV * 2);
  const index = new Uint32Array(nI);
  let v = 0, k = 0;
  for(let i = 0; i < this.cascades.length; ++i){
    const r = this.cascades[i].ribbon;
    if(!r) continue;
    position.set(r.position, v * 3); normal.set(r.normal, v * 3);
    tangent.set(r.tangent, v * 3); across.set(r.across, v * 3);
    flowA.set(r.flowA, v * 4); flowB.set(r.flowB, v * 4); lump.set(r.lump, v * 2);
    for(let j = 0; j < r.index.length; ++j) index[k + j] = r.index[j] + v;
    v += r.vertexCount; k += r.index.length;
  }
  const old = this.mesh.geometry;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('aFlowTangent', new THREE.BufferAttribute(tangent, 3));
  geo.setAttribute('aFlowAcross', new THREE.BufferAttribute(across, 3));
  geo.setAttribute('aFlowA', new THREE.BufferAttribute(flowA, 4));
  geo.setAttribute('aFlowB', new THREE.BufferAttribute(flowB, 4));
  geo.setAttribute('aFlowLump', new THREE.BufferAttribute(lump, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  if(nV){
    geo.computeBoundingSphere();
    //The vertex stage displaces by up to ~uLumpAmp along the normal and uEdgeWobble across,
    //and the wind gusts by up to 1.5 m more.
    geo.boundingSphere.radius += 2.5;
  }
  this.mesh.geometry = geo;
  old.dispose();
};

//The corridor boxes into every flowing-water ring's material (see the header). The
//boxes nearest the camera win when there are more than MAX_CORRIDORS.
ARestlessOcean.Passes.WaterfallSheetPass.prototype._streamCorridors = function(){
  const WS = ARestlessOcean.Passes.WaterfallSheetPass;
  const fsp = this.oceanGrid.flowSurfacePass;
  if(!fsp) return;
  let caps = this.enabled && this.mesh.visible ? this._corridors : [];
  if(caps.length > WS.MAX_CORRIDORS){
    const cam = this.oceanGrid.globalCameraPosition;
    caps = caps.slice().sort(function(a, b){
      const da = (a.ax - cam.x) * (a.ax - cam.x) + (a.az - cam.z) * (a.az - cam.z);
      const db = (b.ax - cam.x) * (b.ax - cam.x) + (b.az - cam.z) * (b.az - cam.z);
      return da - db;
    }).slice(0, WS.MAX_CORRIDORS);
  }
  for(let r = 0; r < fsp.rings.length; ++r){
    const u = fsp.rings[r].mesh.material.uniforms;
    if(!u.fallCorridorA) continue;
    for(let i = 0; i < caps.length; ++i){
      u.fallCorridorA.value[i].set(caps[i].ax, caps[i].az, caps[i].bx, caps[i].bz);
      u.fallCorridorB.value[i].set(caps[i].r, caps[i].lead || 0.0, 0, 0);
    }
    u.fallCorridorCount.value = caps.length;
  }
};

//The traced nappes while the sheets are drawing (null otherwise), for the plunge spray
//(OceanSplash._emitFalls) and the foot foam (FlowFoamPass._updateFalls). Each carries
//`impacts` — every ledge touchdown and the plunge — and its width and discharge.
ARestlessOcean.Passes.WaterfallSheetPass.prototype.liveNappes = function(){
  return (this.mesh && this.mesh.visible && this.nappes.length) ? this.nappes : null;
};

ARestlessOcean.Passes.WaterfallSheetPass.prototype.resize = function(){};

ARestlessOcean.Passes.WaterfallSheetPass.prototype.dispose = function(){
  //Hand the creek its steps back: tick no longer runs to clear the boxes once the mesh is gone.
  const fsp = this.oceanGrid.flowSurfacePass;
  if(fsp){
    for(let r = 0; r < fsp.rings.length; ++r){
      const u = fsp.rings[r].mesh.material.uniforms;
      if(u.fallCorridorCount) u.fallCorridorCount.value = 0;
    }
  }
  if(this.mesh){
    if(this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
  if(this.material){ this.material.dispose(); this.material = null; }
  this.cascades.length = 0;
  this.nappes.length = 0;
  this._queue.length = 0;
  this._retry.length = 0;
  this._job = null;
};
