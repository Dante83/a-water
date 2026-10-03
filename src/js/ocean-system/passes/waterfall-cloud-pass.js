//── WaterfallCloudPass ──────────────────────────────────────────────────────
//
//The big, thin, billowy clouds that break off the falls' feet and drift away: the last of the foot
//particles. Every frame the puffs (ARestlessOcean.WaterfallCloudPuffs: born in the plume, swelling,
//rising, thinning, carried out by the spray and then the wind) of every landing line are worked out,
//the nearest MAX_PUFFS kept and sorted far to near, and drawn as ONE instanced icosahedron each, inside
//which waterfall-cloud.glsl marches a sky cloud's density and light.
//
//THE LINES are the splash pass's (WaterfallSplashPass._ringSegments, from WaterfallSplashHull.ringLines):
//their ends, downstream normals, sizes, and the still levels and wetness it re-reads from a-land. The
//cloud pass rebuilds its lines whenever the splash pass swaps in a new set.
//
//THE NOISE is ARestlessOcean.WaterfallCloudNoise's (A-Starry-Sky's cloud noise, ported), baked on the
//GPU over the first few frames a fall is up; the clouds stay hidden until it is done.
//
//THE WIND is the ocean's (oceanGrid.windVelocity: x world X, y world Z), handed to the puffs (they drift
//off with windCoupling of it as they age).
//
//ONE LIGHT, ONE SKY, and the RENDER STATE: as WaterfallMistPass (read its header). The material aliases
//the flowing material's uniform objects; transparent, no depth write, no depth test, front faces culled,
//OCEAN_LAYER; hidden for every offscreen pass and underwater by the grid. renderOrder 7.5: before the mist
//cones (8), the surface mist (8.5) and the splash (9), so the plume draws over the clouds behind it.
//
//Live: puffOptions (WaterfallCloudPuffs.DEFAULTS, read every frame), material.uniforms.u*, enabled;
//console cloudStats(), hideWaterfallClouds(), waterfallCloudPass.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.WaterfallCloudPass = function(oceanGrid, sheetPass, splashPass){
  this.oceanGrid = oceanGrid;
  this.sheetPass = sheetPass;
  this.splashPass = splashPass;
  this.mesh = null;
  this.material = null;
  this.enabled = true;
  //Whether the clouds should be on screen this frame; the grid turns it into mesh.visible at the end of
  //its tick, after the offscreen passes.
  this.wantVisible = false;
  this.puffOptions = {};
  this._segmentsFor = null;
  this._lines = [];
  this._picked = [];
  this._atmReady = false;
  this._reason = 'not ticked';
};

ARestlessOcean.Passes.WaterfallCloudPass.RENDER_ORDER = 7.5;
//Instances allocated (puffOptions.maxPuffs is clamped to this).
ARestlessOcean.Passes.WaterfallCloudPass.MAX_PUFFS = 96;

ARestlessOcean.Passes.WaterfallCloudPass.prototype.init = function(scene){
  const WC = ARestlessOcean.Passes.WaterfallCloudPass;
  const def = ARestlessOcean.Materials.Ocean.waterfallCloudMaterial;
  const og = this.oceanGrid;
  const uniforms = ARestlessOcean.cloneUniforms(def.uniforms);
  const flow = og.flowSurfacePass && og.flowSurfacePass.material;
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
    fragmentShader: ARestlessOcean.spliceLandLight(def.fragmentShader(false, null)),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    //Cull the FRONT faces: each pixel is where its view ray leaves the puff's proxy.
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
    lights: false,
    fog: true
  });
  //The same fog-chunk swap as the splash, so the scene fog and the underwater fog reach it.
  if(THREE.fogParsVert && THREE.fogVert && THREE.fogParsFrag && THREE.fogFrag){
    this.material.onBeforeCompile = function(shader){
      shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', THREE.fogParsVert);
      shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', THREE.fogVert);
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', THREE.fogParsFrag);
      shader.fragmentShader = shader.fragmentShader.split('#include <fog_fragment>').join(THREE.fogFrag);
    };
  }
  //The proxy: a unit icosahedron (one subdivision) scaled so its INSCRIBED sphere is the unit sphere.
  const ico = new THREE.IcosahedronGeometry(1.0, 1);
  const pos = ico.getAttribute('position');
  let inR = 1.0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for(let i = 0; i < pos.count; i += 3){
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(b.clone().sub(a)).normalize();
    inR = Math.min(inR, Math.abs(n.dot(a)));
  }
  uniforms.uProxyScale.value = 1.0 / inR * 1.01;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', pos);
  if(ico.index) geo.setIndex(ico.index);
  this._aPuff = new THREE.InstancedBufferAttribute(new Float32Array(WC.MAX_PUFFS * 4), 4);
  this._aPuffB = new THREE.InstancedBufferAttribute(new Float32Array(WC.MAX_PUFFS * 4), 4);
  this._aPuff.setUsage(THREE.DynamicDrawUsage);
  this._aPuffB.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPuff', this._aPuff);
  geo.setAttribute('aPuffB', this._aPuffB);
  geo.instanceCount = 0;
  this.mesh = new THREE.Mesh(geo, this.material);
  this.mesh.renderOrder = WC.RENDER_ORDER;
  this.mesh.castShadow = false;
  this.mesh.receiveShadow = false;
  //The puffs move every frame and the geometry's bounds are the unit proxy's: no culling.
  this.mesh.frustumCulled = false;
  this.mesh.visible = false;
  this.mesh.layers.set(ARestlessOcean.OCEAN_LAYER);
  this.mesh.userData.waterfallClouds = true;
  scene.add(this.mesh);
};

//ctx: {enabled, timeMs}
ARestlessOcean.Passes.WaterfallCloudPass.prototype.tick = function(ctx){
  this.enabled = ctx.enabled !== false;
  if(!this.mesh) return;
  const og = this.oceanGrid;
  const sp = this.splashPass;
  const P = ARestlessOcean.WaterfallCloudPuffs;
  const N = ARestlessOcean.WaterfallCloudNoise;
  this.wantVisible = false;
  this.mesh.geometry.instanceCount = 0;
  //Only while the splash is up (it is up only while the sheet is).
  if(!this.enabled){ this._reason = 'enabled false'; return; }
  if(!sp || !sp.wantVisible){ this._reason = 'splash not visible (no sheet up)'; return; }
  //The noise first (spread over a few frames).
  if(!N.ready){
    N.step(og.renderer);
    this._reason = N.ready ? 'noise baked' : 'baking noise';
    if(!N.ready) return;
  }
  const u = this.material.uniforms;
  u.uSunElevation.value = ARestlessOcean.Passes.WaterfallMistPass.solarElevation(og);
  if(u.uShapeNoise.value !== N.shape){ u.uShapeNoise.value = N.shape; u.uDetailNoise.value = N.detail; }
  //The lines follow the splash pass's segments.
  if(sp._ringSegments !== this._segmentsFor){
    this._segmentsFor = sp._ringSegments;
    this._lines = P.lines(sp._ringSegments || []);
  }
  if(!this._lines.length){ this._reason = 'no landing lines'; return; }
  const cam = og.globalCameraPosition || {x: 0.0, y: 0.0, z: 0.0};
  const wv = og.windVelocity;
  const wind = wv ? {x: wv.x, z: wv.y} : null;
  const opts = Object.assign({}, this.puffOptions);
  opts.maxPuffs = Math.min(opts.maxPuffs !== undefined ? opts.maxPuffs : P.DEFAULTS.maxPuffs, ARestlessOcean.Passes.WaterfallCloudPass.MAX_PUFFS);
  const picked = P.pick(this._lines, (ctx.timeMs || 0.0) * 0.001, wind, cam, opts, this._picked);
  const A = this._aPuff.array, B = this._aPuffB.array;
  for(let i = 0; i < picked.length; ++i){
    const p = picked[i];
    A[i * 4] = p.x; A[i * 4 + 1] = p.y; A[i * 4 + 2] = p.z; A[i * 4 + 3] = p.r;
    B[i * 4] = p.density; B[i * 4 + 1] = p.age01; B[i * 4 + 2] = p.seed; B[i * 4 + 3] = p.level;
  }
  this._aPuff.needsUpdate = true;
  this._aPuffB.needsUpdate = true;
  this.mesh.geometry.instanceCount = picked.length;
  this.wantVisible = picked.length > 0;
  this._reason = picked.length ? 'running' : 'no live puffs near the camera';
  //Atmospheric perspective, as the splash does it: rebuild the fragment shader once it is ready.
  const atm = !!(og.atmosphericPerspectiveEnabled && og.atmosphereFunctionsGLSL);
  if(atm !== this._atmReady){
    this._atmReady = atm;
    this.material.fragmentShader = ARestlessOcean.spliceLandLight(ARestlessOcean.Materials.Ocean.waterfallCloudMaterial.fragmentShader(atm, og.atmosphereFunctionsGLSL));
    this.material.needsUpdate = true;
  }
};

//Console: what the clouds are doing.
ARestlessOcean.Passes.WaterfallCloudPass.prototype.stats = function(){
  const N = ARestlessOcean.WaterfallCloudNoise;
  const pk = this._picked;
  let rMin = Infinity, rMax = 0.0, dMax = 0.0;
  for(let i = 0; i < pk.length; ++i){ rMin = Math.min(rMin, pk[i].r); rMax = Math.max(rMax, pk[i].r); dMax = Math.max(dMax, pk[i].density); }
  return {reason: this._reason, lines: this._lines.length, drawn: this.mesh ? this.mesh.geometry.instanceCount : 0,
          radiusM: pk.length ? [+rMin.toFixed(1), +rMax.toFixed(1)] : null, peakDensity: +dMax.toFixed(3),
          nearestM: pk.length ? +pk[pk.length - 1].dist.toFixed(1) : null,
          noise: N.ready ? 'baked in ' + N.bakeMs.toFixed(1) + ' ms (CPU side)' : 'not baked',
          options: Object.assign({}, ARestlessOcean.WaterfallCloudPuffs.DEFAULTS, this.puffOptions)};
};

ARestlessOcean.Passes.WaterfallCloudPass.prototype.resize = function(){};

ARestlessOcean.Passes.WaterfallCloudPass.prototype.dispose = function(){
  if(this.mesh){
    if(this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
  if(this.material){ this.material.dispose(); this.material = null; }
  this.wantVisible = false;
};
