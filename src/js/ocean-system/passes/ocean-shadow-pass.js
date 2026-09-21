//── Ocean shadow pass (CSM orchestration) ──────────────────────────────────
//
//Extracted from ocean-grid.js (0.2.0 lines 921-930, 1106-1108 and the tick
//block at 3344-3381) as part of the Phase 0 decomposition. Behaviour is
//unchanged; see WATER-TYPES-PROGRESS.md for the old-line map.
//
//This is the ORCHESTRATION layer only. The cascaded shadow map itself already
//lives in its own file — ARestlessOcean.OceanShadowCSM (ocean-shadow-csm.js) —
//and is NOT modified here. What this pass owns is the wiring: constructing the
//CSM behind a guard, registering each clipmap ring mesh as a caster, driving the
//per-frame render, and pushing the resulting cascade textures and shadow
//matrices back into every water material's uniforms.
//
//⚠️ ORDERING: this must run AFTER the per-instance uniform upload loop in
//OceanGrid.tick. The shadow material picks up the FFT cascade state BY
//REFERENCE from the first mesh's uniforms (see OceanShadowCSM.render's
//sharedOceanUniforms argument), so if this ran first the shadow pass would
//displace its casters with last frame's wave state and the self-shadow would
//visibly lag the surface.
//
//SUN BELOW HORIZON: OceanShadowCSM.render() early-exits, so we disable the
//sampler rather than let the water shader read stale moment maps.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.OceanShadowPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.scene = oceanGrid.scene;
  //The underlying CSM. Null when ocean-shadow-csm.js or its generated material
  //isn't loaded (older builds) — every call site below tolerates that.
  this.csm = null;
};

ARestlessOcean.Passes.OceanShadowPass.prototype.init = function(){
  //Ocean-only cascaded shadow map. Dedicated tight-frustum depth pass that
  //only contains the water InstancedMeshes — gives per-wave self-shadow that
  //the scene-wide sun shadow map can't resolve. Safe to skip if the shadow
  //material isn't loaded (older builds without ocean-shadow.js).
  if(ARestlessOcean.OceanShadowCSM && ARestlessOcean.Materials.Ocean.oceanShadowMaterial){
    this.csm = new ARestlessOcean.OceanShadowCSM(this.oceanGrid, this.scene);
  } else {
    this.csm = null;
  }
};

ARestlessOcean.Passes.OceanShadowPass.prototype.resize = function(){};

//Register one clipmap ring mesh as a shadow caster. Called from the mesh
//construction loop; ringIndex filters which rings are close enough to matter.
ARestlessOcean.Passes.OceanShadowPass.prototype.addCaster = function(mesh, ringIndex){
  if(this.csm) this.csm.addCaster(mesh, ringIndex);
};

//ctx: {camera, sunLight, instanceKeys, instances, sunDirectionScratch, oceanShadowOverride}
//sunDirectionScratch is written in place (it is the grid's shared scratch, kept
//shared so the value stays observable to the rest of tick exactly as before).
ARestlessOcean.Passes.OceanShadowPass.prototype.tick = function(ctx){
  const keys = ctx.instanceKeys;
  const instances = ctx.instances;
  if(!this.csm || !ctx.sunLight || keys.length === 0) return;

  const mainLight = ctx.sunLight;
  const sunDir = ctx.sunDirectionScratch;
  sunDir.set(mainLight.position.x, mainLight.position.y, mainLight.position.z);
  sunDir.sub(mainLight.target.position).negate().normalize();
  const firstMeshUniforms = instances[keys[0]].material.uniforms;
  this.csm.render(this.renderer, ctx.camera, sunDir, firstMeshUniforms);

  //Sun below horizon -> CSM.render() early-exits; disable the sampler so
  //the water shader doesn't read stale maps.
  const sunBelowHorizon = -sunDir.y <= 0.0;
  const cascades = this.csm.cascades;
  const numCascades = this.csm.numCascades;
  for(let i = 0, numKeys = keys.length; i < numKeys; ++i){
    const u = instances[keys[i]].material.uniforms;
    if(sunBelowHorizon || ctx.oceanShadowOverride === false){
      u.oceanShadowEnabled.value = 0;
      if(sunBelowHorizon) continue;
    } else {
      u.oceanShadowEnabled.value = 1;
    }
    //Push the moment array (RGBA32F, post-blur), the shadow matrices and the map
    //sizes. Phase 10: the four cascades are layers of ONE sampler2DArray, so the
    //texture is a single assignment; the fragment cascade walk picks the layer.
    //Matrices live as separate uniform names (oceanShadowMatrix0..3) and must be
    //projected per-vertex; mapSize stays a plain vec2 array.
    u.oceanShadowMap.value = this.csm.cascadeArray.texture;
    for(let c = 0; c < numCascades; c++){
      u.oceanShadowMapSize.value[c].set(cascades[c].cfg.mapSize, cascades[c].cfg.mapSize);
    }
    u.oceanShadowMatrix0.value.copy(cascades[0].shadowMatrix);
    u.oceanShadowMatrix1.value.copy(cascades[1].shadowMatrix);
    u.oceanShadowMatrix2.value.copy(cascades[2].shadowMatrix);
    u.oceanShadowMatrix3.value.copy(cascades[3].shadowMatrix);
  }
};

ARestlessOcean.Passes.OceanShadowPass.prototype.dispose = function(){
  if(this.csm){
    //Phase 10: one array target for all four cascades, plus the blur scratch.
    if(this.csm.cascadeArray) this.csm.cascadeArray.dispose();
    if(this.csm._blurTarget) this.csm._blurTarget.dispose();
  }
  this.csm = null;
};
