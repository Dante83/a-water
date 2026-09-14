//── FlowSurfacePass ─────────────────────────────────────────────────────────
//
//Phase 4 of the multi-water plan (WATER-TYPES.md): the flowing-water surface.
//Creeks and rivers are drawn here; still water (ocean, lakes) stays on the FFT
//clipmap. The split is ARestlessOcean.FlowHandoff's weight (ocean-wave-field.js),
//packed into the WaterField, and the two surfaces dither against the same
//threshold across it so they never both draw or both miss a pixel.
//
//WHY A FIELD-GRID SHEET AND NOT RIBBONS (decided with Dante, 2026-09-14)
//a-land exports no river centrelines — no spline, no river body, no graph — only
//the per-texel flow field. Its creeks are ~14 m wide at 1 m field texels, and
//their level is a staircase that falls one metre at a time down the bed. So the
//geometry is two camera-following grids whose vertices read the field level,
//and everything the material does is in world space (level-gradient normals now;
//flow-map advection and wave profile buffers next). Phase 5's ribbons replace
//only the geometry.
//
//THE MATERIAL
//A clone of the water material with the $flowing_water variant
//(OceanGrid.createFlowingWaterMaterial), registered with the grid so it gets
//the whole per-frame uniform stream. The variant compiles out the six FFT cascade
//samplers, caustics, ocean foam and the ocean CSM, which is what makes room for
//flow at all: the ocean program is at 31 of 32 texture units.
//
//GEOMETRY AND LOD (declared here, per the cross-cutting rules)
//  near  1 m cells  over ±128 m, vertices on WaterField cascade 0 texel centres
//  far   4 m cells  over ±512 m, on cascade 1 texel centres, with a hole under
//        the near grid that stops one far cell short of it so the two overlap by
//        a cell (hides the T-junction cracks between the 1 m and 4 m edges)
//Beyond the far grid the hand-off window fades the weight to zero over its outer
//15%, and the clipmap draws creeks as sloped still water, as before Phase 4.
//Vertices that can never show flowing water are dropped under their level in the
//vertex shader (see water-vertex.glsl), so a window over open sea costs vertices
//and little fill.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.FlowSurfacePass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.rings = [];
  this.material = null;
  this.enabled = true;
  this._ready = false;
  this._state = {enabled: false, centerX: 0, centerZ: 0, halfWidth: 0};
};

//cell: metres per grid cell; halfWidth: metres; hole: half-width of the square
//left out for the finer ring (0 = none). Each cell size matches the WaterField
//cascade whose texel centres its vertices sit on.
ARestlessOcean.Passes.FlowSurfacePass.RINGS = [
  {cell: 1.0, halfWidth: 128.0, hole: 0.0},
  {cell: 4.0, halfWidth: 512.0, hole: 124.0}
];

//A flat grid in XZ at y = 0, centred on the origin, cells of `cell` metres,
//optionally with a square hole. Position only: the water material reads nothing
//else (see ocean-patch-geometry.js).
ARestlessOcean.Passes.FlowSurfacePass.buildGrid = function(cell, halfWidth, hole){
  const n = Math.round(2.0 * halfWidth / cell);
  const verts = n + 1;
  const positions = new Float32Array(verts * verts * 3);
  for(let j = 0; j < verts; ++j){
    for(let i = 0; i < verts; ++i){
      const o = (j * verts + i) * 3;
      positions[o] = -halfWidth + i * cell;
      positions[o + 1] = 0.0;
      positions[o + 2] = -halfWidth + j * cell;
    }
  }
  const indices = [];
  for(let j = 0; j < n; ++j){
    for(let i = 0; i < n; ++i){
      if(hole > 0.0){
        const x0 = -halfWidth + i * cell, z0 = -halfWidth + j * cell;
        if(x0 >= -hole && x0 + cell <= hole && z0 >= -hole && z0 + cell <= hole) continue;
      }
      const a = j * verts + i, b = a + 1, c = a + verts, d = c + 1;
      //Counter-clockwise seen from +Y, the same winding as the clipmap tiles.
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(verts * verts > 65535 ? new THREE.BufferAttribute(new Uint32Array(indices), 1)
                                          : new THREE.BufferAttribute(new Uint16Array(indices), 1));
  return geometry;
};

ARestlessOcean.Passes.FlowSurfacePass.prototype.init = function(scene){
  const og = this.oceanGrid;
  const FS = ARestlessOcean.Passes.FlowSurfacePass;
  this.material = og.createFlowingWaterMaterial();
  for(let r = 0; r < FS.RINGS.length; ++r){
    const spec = FS.RINGS[r];
    const geometry = FS.buildGrid(spec.cell, spec.halfWidth, spec.hole);
    //One material per ring, like the clipmap: each registered mesh gets its own
    //uniforms written by the per-frame loop.
    const material = r === 0 ? this.material : og.createFlowingWaterMaterial();
    //InstancedMesh with one identity instance: the water vertex shader
    //multiplies by instanceMatrix. The mesh itself carries the snapped centre.
    const mesh = new THREE.InstancedMesh(geometry, material, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;       //no ocean CSM caster, no scene shadow caster
    mesh.receiveShadow = true;
    //Above the skirt (1) and the clipmap (2): the two dither against each other
    //and never overlap, so the order only matters for overdraw.
    mesh.renderOrder = 3;
    mesh.userData.flowingWater = true;
    mesh.layers.set(ARestlessOcean.OCEAN_LAYER);
    scene.add(mesh);
    const key = '__flow_surface_' + r + '__';
    og.registerOceanMesh(key, mesh);
    this.rings.push({spec: spec, mesh: mesh, key: key});
  }
  this._ready = true;
};

//ctx: {cameraX, cameraZ, heightOffset, enabled}
ARestlessOcean.Passes.FlowSurfacePass.prototype.tick = function(ctx){
  this.enabled = ctx.enabled !== false;
  for(let r = 0; r < this.rings.length; ++r){
    const ring = this.rings[r];
    const cell = ring.spec.cell;
    //Vertices on the matching cascade's texel CENTRES: the cascade centre snaps
    //to multiples of its texel, so its centres sit at (k + ½)·texel.
    const cx = (Math.floor(ctx.cameraX / cell) + 0.5) * cell;
    const cz = (Math.floor(ctx.cameraZ / cell) + 0.5) * cell;
    ring.mesh.position.set(cx, ctx.heightOffset, cz);
    ring.mesh.visible = this.enabled;
    ring.centerX = cx;
    ring.centerZ = cz;
  }
  const outer = this.rings[this.rings.length - 1];
  this._state.enabled = this._ready && this.enabled;
  if(outer){
    this._state.centerX = outer.centerX;
    this._state.centerZ = outer.centerZ;
    //One cell inside the outer edge, so the fade finishes on geometry.
    this._state.halfWidth = outer.spec.halfWidth - outer.spec.cell;
  }
};

//The square this surface covers, for FlowHandoff (OceanGrid.flowHandoffState).
ARestlessOcean.Passes.FlowSurfacePass.prototype.handoffState = function(){
  return this._state;
};

ARestlessOcean.Passes.FlowSurfacePass.prototype.resize = function(){};

ARestlessOcean.Passes.FlowSurfacePass.prototype.dispose = function(){
  for(let r = 0; r < this.rings.length; ++r){
    const ring = this.rings[r];
    this.oceanGrid.unregisterOceanMesh(ring.key);
    if(ring.mesh.parent) ring.mesh.parent.remove(ring.mesh);
    ring.mesh.geometry.dispose();
    ring.mesh.material.dispose();
  }
  this.rings.length = 0;
  this._ready = false;
  this._state.enabled = false;
};
