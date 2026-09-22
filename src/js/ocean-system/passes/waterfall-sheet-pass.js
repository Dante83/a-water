//── WaterfallSheetPass ──────────────────────────────────────────────────────
//
//Phase 6 (WATER-TYPES.md): the water between a lip and whatever it lands on.
//
//Through Phase 4 a fall was drawn by the flowing-water HEIGHTFIELD stretched over
//the step, a steep ramp one or two cells long that the cliff clipped through. This
//pass draws the fall as its own surface: a ribbon extruded across the fall's width
//along the path ARestlessOcean.WaterfallNappe traces for the water (airborne off each
//lip, sliding down chutes, landing on ledges, plunging into pools). Cascades are one
//ribbon per chain of falls, not one per fall.
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
//Traces run on the CPU against a-land's height and water reads, one chain per frame, and
//again whenever a-land's height cache changes (finer tiles sharpen the ground a trace was
//run on) or its terrain is edited. A trace that meets unloaded ground is simply retried.
//The ground read goes to the DIRECTOR with a NaN miss value: a-land's public
//api.getHeightAt drops that argument and answers 0 m for unloaded ground, which is a
//plausible height and would put a fall's landing at sea level.
//
//RENDER STATE
//Transparent, no depth write, DoubleSide, renderOrder 5 (after the flowing surface's 3,
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
  this._dirtyGeometry = false;
  this._retryAtMs = 0;
  this._lastInvalidateMs = -1e9;
  this._corridors = [];
  this._sceneFog = null;
};

ARestlessOcean.Passes.WaterfallSheetPass.RENDER_ORDER = 5;
ARestlessOcean.Passes.WaterfallSheetPass.MAX_CORRIDORS = 24;
ARestlessOcean.Passes.WaterfallSheetPass.RETRY_MS = 1000;
ARestlessOcean.Passes.WaterfallSheetPass.REBUILD_MS = 2000;
//The creek-material uniforms the sheet aliases (see the header).
ARestlessOcean.Passes.WaterfallSheetPass.SHARED_UNIFORMS = [
  'brightestDirectionalLight', 'brightestDirectionalLightDirection', 'skyAmbientColor',
  'waterAbsorption', 'waterScattering', 'waterSurfaceY', 'specBoost', 't',
  'sunShadowMap', 'sunShadowMatrix', 'sunShadowMapSize', 'sunShadowRadius', 'sunShadowBias', 'sunShadowEnabled',
  'refractionLinearDepth', 'refractionColorTexture', 'gBufferNormal', 'refractionDepthTexture',
  'inverseProjectionMatrix', 'inverseViewMatrix', 'screenResolution',
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
    fragmentShader: def.fragmentShader,
    transparent: true,
    depthWrite: false,
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
    }
  };
};

//Start over: new falls list, a-land height residency changed, or a terrain edit.
ARestlessOcean.Passes.WaterfallSheetPass.prototype.invalidate = function(){
  this._queue.length = 0;
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
  const hc = og._landDirector && og._landDirector.heightCache;
  const ver = hc && typeof hc.version === 'number' ? hc.version : 0;
  if(ver !== this._heightVersion && !this._queue.length && now - this._lastInvalidateMs >= ARestlessOcean.Passes.WaterfallSheetPass.REBUILD_MS){
    this._heightVersion = ver;
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
  //One trace per frame. A trace over unloaded ground returns null; retry after a pause
  //rather than spinning on it every frame.
  if(this._queue.length && ctx.timeMs >= this._retryAtMs){
    const env = this._env();
    const i = this._queue.shift();
    const c = this.cascades[i];
    if(env && c){
      const nappe = ARestlessOcean.WaterfallNappe.trace(c.chain, env);
      if(nappe){
        c.nappe = nappe;
        c.ribbon = ARestlessOcean.WaterfallNappe.buildRibbon(nappe, env);
        this._dirtyGeometry = true;
      }
      else {
        this._queue.push(i);
        this._retryAtMs = ctx.timeMs + WS.RETRY_MS;
      }
    }
  }
  if(this._dirtyGeometry && !this._queue.length) this._rebuildGeometry();
  this.mesh.visible = this.enabled && this.mesh.geometry.index !== null && this.mesh.geometry.index.count > 0;
  //The water's rule for the scene fog chunk: only while atmospheric perspective is off
  //(waterfall-sheet.glsl, end of main). AP can become ready a few frames in, like the
  //water's own late recompile, so this is checked every tick and recompiles once.
  const og = this.oceanGrid;
  const sceneFog = !(og.atmosphericPerspectiveEnabled && og.atmosphereFunctionsGLSL);
  if(sceneFog !== this._sceneFog){
    this._sceneFog = sceneFog;
    this.material.defines = this.material.defines || {};
    if(sceneFog) this.material.defines.SHEET_SCENE_FOG = 1;
    else delete this.material.defines.SHEET_SCENE_FOG;
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
  const flowA = new Float32Array(nV * 4), flowB = new Float32Array(nV * 4);
  const index = new Uint32Array(nI);
  let v = 0, k = 0;
  for(let i = 0; i < this.cascades.length; ++i){
    const r = this.cascades[i].ribbon;
    if(!r) continue;
    position.set(r.position, v * 3); normal.set(r.normal, v * 3);
    tangent.set(r.tangent, v * 3); across.set(r.across, v * 3);
    flowA.set(r.flowA, v * 4); flowB.set(r.flowB, v * 4);
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
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  if(nV){
    geo.computeBoundingSphere();
    //The vertex stage displaces by up to ~uLumpAmp along the normal and uEdgeWobble across.
    geo.boundingSphere.radius += 1.0;
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
      u.fallCorridorB.value[i].set(caps[i].r, 0, 0, 0);
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
  if(this.mesh){
    if(this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
  if(this.material){ this.material.dispose(); this.material = null; }
  this.cascades.length = 0;
  this.nappes.length = 0;
  this._queue.length = 0;
};
