//── Hero shadow pass (shore pass, 2026-09-30) ──────────────────────────────
//
//WHAT IT FIXES. Liam cast no shadow on the water. On a-land pages the shared sun
//has castShadow off (a-land runs its own terrain CSM), so getSunShadow returns 1,
//and the only object shadow the water sees is a-land's WaterLightField: 1 m per
//texel, sampled at the STILL level. A person is ~0.5 m across, less than a texel,
//so their shadow averaged into nothing.
//
//WHAT IT DOES. One small sun-aligned orthographic depth map around the camera,
//2048² over ±12 m (≈1.2 cm per texel), holding only what should cast a crisp
//shadow on nearby water: meshes with castShadow on, near the camera, skinned
//meshes posed (three picks USE_SKINNING from the OBJECT, so one override
//MeshDepthMaterial covers them). Terrain, water, sky and anything huge are left
//out; terrain keeps a-land's field. The water shader samples it at the DISPLACED
//surface point (and at the seabed/terrain seen through shallow water), with a
//penumbra that grows with the blocker distance: sharp at the contact, softer where
//the caster stands high above the water.
//
//HOW IT PICKS CASTERS. Each frame the scene is walked once. A mesh casts when it is
//visible (with its parents), castShadow is on, it is not an InstancedMesh (scatter,
//spray: see tick), userData.heroShadow !== false, its
//bounding sphere is under MAX_CASTER_RADIUS and it lies within reach of the box.
//userData.heroShadow === true forces a mesh in whatever its castShadow. The picked
//meshes are put on LAYER for one render and taken off again, so nothing else is
//touched. When no caster is in range the pass skips the render and the water skips
//the lookup (heroShadowEnabled = 0).
//
//The waterline passes reuse this frame's map (the pass renders from OceanGrid.tick,
//once, before the frame).

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.HeroShadowPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  const HS = ARestlessOcean.Passes.HeroShadowPass;
  //Live knobs.
  this.enabled = true;
  this.halfWidth = HS.HALF_WIDTH;     //m, the box's half width around the camera
  this.depthRange = HS.DEPTH_RANGE;   //m, how far above the water a caster may stand
  this.softness = 1.0;                //× the sun's angular size for the penumbra
  //Round 3: a-land's placed objects (InstancedMeshes: trees, rocks, scatter) too, each drawn
  //through its own customDepthMaterial twin when it has one (conform + wind), so their
  //shadows sit where they stand. Off by default: it draws every instance each frame, and
  //the scatter's pebbles are not worth it. For trees and rocks at the shore.
  this.includeInstanced = false;
  this.size = HS.SIZE;

  this.target = null;
  this.active = false;                //casters rendered this frame
  this.matrix = new THREE.Matrix4();  //world → shadow UV/depth in [0,1]
  this.casterCount = 0;

  this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1.0);
  this.camera.layers.set(HS.LAYER);
  this.depthMaterial = new THREE.MeshDepthMaterial({depthPacking: THREE.BasicDepthPacking});
  this.depthMaterial.side = THREE.DoubleSide;
  this._casters = [];
  this._strays = [];
  this._center = new THREE.Vector3();
  this._sunDir = new THREE.Vector3();
  this._up = new THREE.Vector3();
  this._tmpV = new THREE.Vector3();
  this._tmpS = new THREE.Sphere();
  this._bias = new THREE.Matrix4().set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );
};

ARestlessOcean.Passes.HeroShadowPass.SIZE = 2048;
ARestlessOcean.Passes.HeroShadowPass.HALF_WIDTH = 12.0;
ARestlessOcean.Passes.HeroShadowPass.DEPTH_RANGE = 60.0;
//Layer the casters sit on for their one render. Taken elsewhere: 20-23 (ocean CSM
//cascades), a-land's CASTER_LAYER 7 and SKY_LAYER/HERO_LAYER 8 and 29 (OCEAN_LAYER,
//which every water tile carries: on it, a flat undisplaced copy of the sea rendered
//into this map and "shadowed" every trough). Anything else found on this layer is
//taken off it for the render (see tick).
ARestlessOcean.Passes.HeroShadowPass.LAYER = 27;
//Anything bigger than this (terrain chunks, water tiles, sky domes) is not a hero.
ARestlessOcean.Passes.HeroShadowPass.MAX_CASTER_RADIUS = 15.0;
//The sun's angular diameter (rad): the penumbra is this × the blocker distance.
ARestlessOcean.Passes.HeroShadowPass.SUN_ANGLE = 0.0093;

ARestlessOcean.Passes.HeroShadowPass.prototype._ensureTarget = function(){
  if(this.target && this.target.width === this.size) return;
  if(this.target) this.target.dispose();
  const depthTexture = new THREE.DepthTexture(this.size, this.size);
  depthTexture.type = THREE.UnsignedIntType;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;
  this.target = new THREE.WebGLRenderTarget(this.size, this.size, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    depthTexture: depthTexture
  });
  this.target.texture.generateMipmaps = false;
};

ARestlessOcean.Passes.HeroShadowPass.prototype._isOcean = function(obj){
  //The ocean's own meshes (clipmap, flow rings, skirt, curtain, splash) never cast here.
  const m = obj.material;
  if(!m) return true;
  if(m.isShaderMaterial || m.isRawShaderMaterial) return !obj.isSkinnedMesh && obj.userData.heroShadow !== true;
  return false;
};

//params: {scene, cameraPosition (Vector3), sunDirection (Vector3, the way light travels)}
ARestlessOcean.Passes.HeroShadowPass.prototype.tick = function(params){
  this.active = false;
  this.casterCount = 0;
  if(!this.enabled || !params || !params.scene || !params.sunDirection) return;
  const HS = ARestlessOcean.Passes.HeroShadowPass;
  const sunDir = this._sunDir.copy(params.sunDirection).normalize();
  //No sun above the horizon: nothing to cast.
  if(sunDir.y > -0.02) return;

  const center = this._center.copy(params.cameraPosition);
  const reach = this.halfWidth * 1.5 + this.depthRange * Math.sqrt(Math.max(0.0, 1.0 - sunDir.y * sunDir.y)) / Math.max(-sunDir.y, 0.05);
  const reach2 = reach * reach;
  const casters = this._casters;
  const strays = this._strays;
  casters.length = 0;
  strays.length = 0;
  const self = this;
  const tmpS = this._tmpS;
  const layerBit = 1 << HS.LAYER;
  (function walk(obj){
    if(!obj.visible) return;
    const already = (obj.layers.mask & layerBit) !== 0;
    let picked = false;
    if((obj.isMesh || obj.isSkinnedMesh) && obj.geometry){
      const ud = obj.userData;
      //Instanced meshes only when asked for. a-land's scattered shells, pebbles and plants are
      //InstancedMeshes with castShadow on: one small bounding sphere stands for thousands of
      //instances across the island, and drawn without their conform displacement they threw
      //blurry blobs on the seabed that popped as the scatter streamed (Dante, 2026-09-30).
      //Spray and other instanced effects the same.
      const wants = ud.heroShadow === true
        || (obj.castShadow && ud.heroShadow !== false && (!obj.isInstancedMesh || self.includeInstanced));
      if(wants && !self._isOcean(obj)){
        const g = obj.geometry;
        if(!g.boundingSphere) g.computeBoundingSphere();
        tmpS.copy(g.boundingSphere).applyMatrix4(obj.matrixWorld);
        //Skinned meshes' bind-pose sphere can sit far from the posed body: judge them by
        //their origin, with a generous radius.
        if(obj.isSkinnedMesh) tmpS.radius = Math.max(tmpS.radius, 2.0);
        //An instanced mesh's own sphere is one instance's, not where its instances are: take
        //it whole (the ortho frustum clips the rest).
        if(obj.isInstancedMesh){ casters.push(obj); picked = true; }
        else if(tmpS.radius <= HS.MAX_CASTER_RADIUS || ud.heroShadow === true){
          const dx = tmpS.center.x - center.x, dz = tmpS.center.z - center.z;
          if(dx * dx + dz * dz <= reach2 + tmpS.radius * tmpS.radius){ casters.push(obj); picked = true; }
        }
      }
    }
    if(already && !picked && obj !== params.scene) strays.push(obj);
    const ch = obj.children;
    for(let i = 0, n = ch.length; i < n; ++i) walk(ch[i]);
  })(params.scene);
  if(casters.length === 0) return;

  this._ensureTarget();
  //Sun-aligned box. Snap the centre to whole texels in light space, or the shadow
  //edges crawl as the camera moves.
  const cam = this.camera;
  const up = Math.abs(sunDir.y) > 0.99 ? this._up.set(0, 0, 1) : this._up.set(0, 1, 0);
  cam.up.copy(up);
  cam.position.copy(center).addScaledVector(sunDir, -this.depthRange);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  const texel = 2.0 * this.halfWidth / this.size;
  const lc = this._tmpV.copy(center).applyMatrix4(cam.matrixWorldInverse);
  const sx = Math.round(lc.x / texel) * texel - lc.x;
  const sy = Math.round(lc.y / texel) * texel - lc.y;
  cam.left = -this.halfWidth + sx; cam.right = this.halfWidth + sx;
  cam.bottom = -this.halfWidth + sy; cam.top = this.halfWidth + sy;
  cam.near = 0.1;
  cam.far = this.depthRange * 2.0;
  cam.updateProjectionMatrix();
  this.matrix.copy(this._bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

  const r = this.renderer;
  const scene = params.scene;
  const prevRT = r.getRenderTarget();
  const prevBackground = scene.background;
  const prevFog = scene.fog;
  const prevAutoClear = r.autoClear;
  const prevShadowAuto = r.shadowMap ? r.shadowMap.autoUpdate : false;
  for(let i = 0; i < strays.length; ++i) strays[i].layers.disable(HS.LAYER);
  //Per-mesh swap, not scene.overrideMaterial: a caster that brings its own depth twin
  //(customDepthMaterial: a-land's conformed and wind-swayed objects) casts with it, so its
  //shadow moves with it; an override replaces the vertex stage and loses that.
  const swapped = this._swapped || (this._swapped = []);
  swapped.length = 0;
  for(let i = 0; i < casters.length; ++i){
    const m = casters[i];
    m.layers.enable(HS.LAYER);
    swapped.push(m.material);
    m.material = m.customDepthMaterial || this.depthMaterial;
  }
  try {
    scene.background = null;
    scene.fog = null;
    if(r.shadowMap) r.shadowMap.autoUpdate = false;
    r.autoClear = true;
    r.setRenderTarget(this.target);
    r.clear(true, true, true);
    r.render(scene, cam);
  } finally {
    for(let i = 0; i < casters.length; ++i){
      casters[i].layers.disable(HS.LAYER);
      casters[i].material = swapped[i];
    }
    swapped.length = 0;
    for(let i = 0; i < strays.length; ++i) strays[i].layers.enable(HS.LAYER);
    scene.background = prevBackground;
    scene.fog = prevFog;
    r.autoClear = prevAutoClear;
    if(r.shadowMap) r.shadowMap.autoUpdate = prevShadowAuto;
    r.setRenderTarget(prevRT);
  }
  this.casterCount = casters.length;
  this.active = true;
};

//Per water material, every frame.
ARestlessOcean.Passes.HeroShadowPass.prototype.writeUniforms = function(u){
  if(!u.heroShadowEnabled) return;
  const on = this.active && this.target;
  u.heroShadowEnabled.value = on ? 1.0 : 0.0;
  if(!on) return;
  u.heroShadowMap.value = this.target.depthTexture;
  u.heroShadowMatrix.value.copy(this.matrix);
  //x: world metres per shadow texel, y: depth range (m) of [0,1], z: penumbra per metre
  //of blocker distance, in texels, w: fade band (fraction of the box) at its edge.
  const texel = 2.0 * this.halfWidth / this.size;
  u.heroShadowParams.value.set(texel, this.camera.far - this.camera.near,
    ARestlessOcean.Passes.HeroShadowPass.SUN_ANGLE * this.softness / texel, 2.0 / (2.0 * this.halfWidth));
};

ARestlessOcean.Passes.HeroShadowPass.prototype.dispose = function(){
  if(this.target) this.target.dispose();
  this.target = null;
  this.depthMaterial.dispose();
};
