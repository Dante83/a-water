//── WaterfallMistPass ───────────────────────────────────────────────────────
//
//The volumetric mist of the waterfalls: where the sheet (WaterfallSheetPass) turns to air and
//spray, a raymarched, sun-lit, self-shadowing cloud takes over. It replaces the old billboard
//mist (OceanSplash type 2) on the falls; the splash clumps and every other spray stay as they
//were (see OceanSplash.fallMistVolumetric).
//
//THE VOLUME is a hull round the curtain (ARestlessOcean.WaterfallMistHull): the sheet's own
//woven ribbon thickened into a closed, curved cone that widens as the water falls and runs on
//past the landing. The pass has no tracing of its own; it rides the sheet pass's cascades, and
//rebuilds a cascade's hull only when the sheet swaps in a new ribbon (geometryVersion).
//
//ONE LIGHT, ONE SKY. As the sheet, the material aliases the flowing material's uniform objects
//(SHARED_UNIFORMS), so the sun, sky, scene shadow, depth and atmosphere are the creek's own.
//
//RENDER STATE. Transparent, no depth write, and NO depth TEST: the hull straddles the curtain,
//whose depth would hide the half of the mist in front of it. The fragment stage does the
//occlusion itself (see waterfall-mist.glsl). Front faces are culled, so each pixel is the far
//side of the cone and the camera may stand inside it. renderOrder 8: after the creek (3) and the
//sheet (5), before the splash (10). OCEAN_LAYER, so the refraction G-buffer, the mirror, the foam
//ortho and the CSM all skip it. The grid decides when it is shown (wantVisible, underwater).

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.WaterfallMistPass = function(oceanGrid, sheetPass){
  this.oceanGrid = oceanGrid;
  this.sheetPass = sheetPass;
  this.mesh = null;
  this.material = null;
  this.enabled = true;
  //Whether the mist should be on screen this frame (the sheet is up, there is a hull). The grid
  //turns that into mesh.visible at the end of its tick, after the offscreen passes.
  this.wantVisible = false;
  //Hull options (WaterfallMistHull.DEFAULTS), live: set then call rebuild().
  this.hullOptions = {};
  this._geometryVersion = -1;
  this._hulls = new WeakMap();
  this._atmReady = false;
};

ARestlessOcean.Passes.WaterfallMistPass.RENDER_ORDER = 8;
//The flowing material's uniforms the mist aliases (see the header).
ARestlessOcean.Passes.WaterfallMistPass.SHARED_UNIFORMS = [
  'brightestDirectionalLight', 'brightestDirectionalLightDirection', 'skyAmbientColor', 't',
  'sunShadowMap', 'sunShadowMatrix', 'sunShadowMapSize', 'sunShadowRadius', 'sunShadowBias', 'sunShadowEnabled',
  'refractionDepthTexture', 'inverseProjectionMatrix', 'screenResolution', 'underwaterFactor',
  'atmosphereTransmittance', 'atmosphereMieInscattering', 'atmosphereRayleighInscattering',
  'atmSunPosition', 'atmMoonPosition', 'atmSunHorizonFade', 'atmMoonHorizonFade',
  'atmScatteringSunIntensity', 'atmScatteringMoonIntensity', 'atmMoonLightColor',
  'atmCameraHeight', 'atmDistanceScale'
];

ARestlessOcean.Passes.WaterfallMistPass.prototype.init = function(scene){
  const WM = ARestlessOcean.Passes.WaterfallMistPass;
  const def = ARestlessOcean.Materials.Ocean.waterfallMistMaterial;
  const og = this.oceanGrid;
  const uniforms = ARestlessOcean.cloneUniforms(def.uniforms);
  const flow = og.flowSurfacePass && og.flowSurfacePass.material;
  if(flow){
    for(let i = 0; i < WM.SHARED_UNIFORMS.length; ++i){
      const name = WM.SHARED_UNIFORMS[i];
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
    //Cull the FRONT faces: each pixel is where its view ray leaves the cone.
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
  this.mesh.renderOrder = WM.RENDER_ORDER;
  this.mesh.castShadow = false;
  this.mesh.receiveShadow = false;
  this.mesh.frustumCulled = true;
  this.mesh.visible = false;
  this.mesh.layers.set(ARestlessOcean.OCEAN_LAYER);
  this.mesh.userData.waterfallMist = true;
  scene.add(this.mesh);
};

//Merge every cascade's hull into the one geometry (one draw call).
ARestlessOcean.Passes.WaterfallMistPass.prototype._rebuildGeometry = function(){
  const sp = this.sheetPass;
  const hulls = [];
  let nV = 0, nI = 0;
  for(let i = 0; i < sp.cascades.length; ++i){
    const rib = sp.cascades[i].ribbon;
    if(!rib) continue;
    let h = this._hulls.get(rib);
    if(h === undefined){
      h = ARestlessOcean.WaterfallMistHull.build(rib, this.hullOptions);
      this._hulls.set(rib, h);
    }
    if(!h) continue;
    hulls.push(h);
    nV += h.vertexCount; nI += h.index.length;
  }
  const position = new Float32Array(nV * 3), normal = new Float32Array(nV * 3);
  const tangent = new Float32Array(nV * 3), across = new Float32Array(nV * 3), center = new Float32Array(nV * 3);
  const mistA = new Float32Array(nV * 4), mistB = new Float32Array(nV * 4);
  const mistC = new Float32Array(nV * 3), mistD = new Float32Array(nV * 2);
  const index = new Uint32Array(nI);
  let v = 0, k = 0;
  for(let i = 0; i < hulls.length; ++i){
    const h = hulls[i];
    position.set(h.position, v * 3); normal.set(h.normal, v * 3);
    tangent.set(h.tangent, v * 3); across.set(h.across, v * 3); center.set(h.center, v * 3);
    mistA.set(h.mistA, v * 4); mistB.set(h.mistB, v * 4);
    mistC.set(h.mistC, v * 3); mistD.set(h.mistD, v * 2);
    for(let j = 0; j < h.index.length; ++j) index[k + j] = h.index[j] + v;
    v += h.vertexCount; k += h.index.length;
  }
  const old = this.mesh.geometry;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('aFlowTangent', new THREE.BufferAttribute(tangent, 3));
  geo.setAttribute('aFlowAcross', new THREE.BufferAttribute(across, 3));
  geo.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
  geo.setAttribute('aMistA', new THREE.BufferAttribute(mistA, 4));
  geo.setAttribute('aMistB', new THREE.BufferAttribute(mistB, 4));
  geo.setAttribute('aMistC', new THREE.BufferAttribute(mistC, 3));
  geo.setAttribute('aMistD', new THREE.BufferAttribute(mistD, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  if(nV) geo.computeBoundingSphere();
  this.mesh.geometry = geo;
  old.dispose();
};

//Throw the cached hulls away and rebuild them (after changing hullOptions).
ARestlessOcean.Passes.WaterfallMistPass.prototype.rebuild = function(){
  this._hulls = new WeakMap();
  this._geometryVersion = -1;
};

//ctx: {enabled}
ARestlessOcean.Passes.WaterfallMistPass.prototype.tick = function(ctx){
  this.enabled = ctx.enabled !== false;
  if(!this.mesh) return;
  const sp = this.sheetPass;
  if(sp && sp.geometryVersion !== this._geometryVersion){
    this._geometryVersion = sp.geometryVersion;
    this._rebuildGeometry();
  }
  const idx = this.mesh.geometry.index;
  //Up only while the sheet is up: a fall nobody is drawing has no mist either.
  this.wantVisible = this.enabled && !!sp && !!sp.mesh && sp.mesh.visible && idx !== null && idx.count > 0;
  //Atmospheric perspective, as the sheet does it: rebuild the fragment shader once it is ready.
  const og = this.oceanGrid;
  const atm = !!(og.atmosphericPerspectiveEnabled && og.atmosphereFunctionsGLSL);
  if(atm !== this._atmReady){
    this._atmReady = atm;
    this.material.fragmentShader = ARestlessOcean.Materials.Ocean.waterfallMistMaterial.fragmentShader(atm, og.atmosphereFunctionsGLSL);
    this.material.needsUpdate = true;
  }
};

ARestlessOcean.Passes.WaterfallMistPass.prototype.resize = function(){};

ARestlessOcean.Passes.WaterfallMistPass.prototype.dispose = function(){
  if(this.mesh){
    if(this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
  if(this.material){ this.material.dispose(); this.material = null; }
  this._hulls = new WeakMap();
  this.wantVisible = false;
};
