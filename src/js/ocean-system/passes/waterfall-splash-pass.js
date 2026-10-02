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
};

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
  this.material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: def.vertexShader,
    fragmentShader: def.fragmentShader(false, null),
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
  this.mesh.userData.waterfallSplash = true;
  scene.add(this.mesh);
};

//Merge every cascade's blobs into the one geometry (one draw call).
ARestlessOcean.Passes.WaterfallSplashPass.prototype._rebuildGeometry = function(){
  const sp = this.sheetPass;
  const env = typeof sp._env === 'function' ? sp._env() : null;
  const hulls = [];
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
};

//Throw the cached blobs away and rebuild them (after changing hullOptions).
ARestlessOcean.Passes.WaterfallSplashPass.prototype.rebuild = function(){
  this._hulls = new WeakMap();
  this._geometryVersion = -1;
};

//ctx: {enabled}
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
  //Atmospheric perspective, as the sheet does it: rebuild the fragment shader once it is ready.
  const og = this.oceanGrid;
  const atm = !!(og.atmosphericPerspectiveEnabled && og.atmosphereFunctionsGLSL);
  if(atm !== this._atmReady){
    this._atmReady = atm;
    this.material.fragmentShader = ARestlessOcean.Materials.Ocean.waterfallSplashMaterial.fragmentShader(atm, og.atmosphereFunctionsGLSL);
    this.material.needsUpdate = true;
  }
};

ARestlessOcean.Passes.WaterfallSplashPass.prototype.resize = function(){};

ARestlessOcean.Passes.WaterfallSplashPass.prototype.dispose = function(){
  if(this.mesh){
    if(this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
  if(this.material){ this.material.dispose(); this.material = null; }
  this._hulls = new WeakMap();
  this.wantVisible = false;
};
