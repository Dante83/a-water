//── FlowSurfacePass ─────────────────────────────────────────────────────────
//
//Phase 4 of the multi-water plan (WATER-TYPES.md): the flowing-water surface.
//Creeks and rivers are drawn here; still water (ocean, lakes) stays on the FFT
//clipmap. The split is ARestlessOcean.FlowHandoff's weight (ocean-wave-field.js),
//packed into the WaterField and blurred into a band several metres wide, across
//which this surface alpha-blends over the (flattened) clipmap.
//
//WHY A FIELD-GRID SHEET AND NOT RIBBONS (decided with Dante, 2026-09-14)
//a-land exports no river centrelines — no spline, no river body, no graph — only
//the per-texel flow field. Its creeks are ~14 m wide at 1 m field texels, and
//their level is a staircase that falls one metre at a time down the bed. So the
//geometry is two camera-following grids whose vertices read the field level,
//and everything the material does is in world space (level-gradient normals,
//two-phase flow-map advection, and wave profile buffers next). Phase 5's ribbons
//replace only the geometry.
//
//THE MATERIAL
//A clone of the water material with the $flowing_water variant
//(OceanGrid.createFlowingWaterMaterial), registered with the grid so it gets
//the whole per-frame uniform stream. The variant compiles out the FFT cascade
//sampling, the ocean's fold/shore foam drive and the ocean CSM lookup. Its foam
//and current come from FlowFoamPass (one sampler for both).
//
//CAUSTICS ARE NOT COMPILED OUT, and this comment used to say they were. They
//were switched back on for the flowing variant in round 7 (2026-09-15) —
//$caustics_enabled is an independent flag, and ocean-grid.js:1016 explains why:
//the in-shader seabed caustic is world-space, so it works on a creek bed 20 m up
//exactly as it does on the seabed, and without it a lake and the creek running
//into it lit their beds differently.
//
//The budget line this used to carry ("31 of 32 texture units") is also out of
//date. Phase 10 collapsed the six cascade maps and the four ocean-CSM cascades
//into two sampler2DArrays; the still-water ocean program measures 22 of 32 now.
//
//GEOMETRY AND LOD (declared here, per the cross-cutting rules)
//  near  1 m cells  over ±128 m
//  mid   2 m cells  over ±240 m, with a hole under the near grid that stops one
//        mid cell short of it so the two overlap (hides the T-junction cracks)
//Every vertex sits on a WaterField cascade 0 (1 m) texel centre, and the whole
//surface stays inside cascade 0. It used to reach ±512 m on cascade 1, and at 4 m
//a texel the hand-off drew blocky squares and the dilated bank weight drew wedges
//over lakes (browser round 2, 2026-09-14): a 14 m creek is 3½ texels there. Past
//the window the hand-off weight fades to zero over its outer 15%, inside the
//cascade's own edge crossfade, and the clipmap draws distant creeks as sloped
//still water, as before Phase 4.
//Vertices that can never show flowing water are dropped under their level in the
//vertex shader (see water-vertex.glsl), so a window over open sea costs vertices
//and little fill.

//THE RIPPLE PROFILE BUFFER (step 4)
//The flowing material's small waves come from one periodic 1D profile, after the
//wave profile buffers of Jeschke & Wojtan (Water Surface Wavelets, 2018): instead of
//summing hundreds of waves per pixel, a GPU pass sums them once per frame along a
//line, and the material samples that line along eight directions. The profile holds
//waves i = 2..200 over WAVE_PERIOD metres (wavelengths 4 m down to 4 cm):
//  * slope amplitude ∝ i^-1/2, i.e. equal slope variance per octave, the saturation
//    range a wind or turbulence driven ripple field settles into;
//  * capillary-gravity dispersion, ω² = (g·k + σ/ρ·k³)·tanh(k·h), at a representative
//    creek depth (one global h — a look approximation, flagged);
//  * a fixed random phase per wave.
//r = height, g = slope along the profile, both scaled to unit RMS slope. The target is
//mipmapped, so the material's texture lookups average ripples finer than a pixel
//(and it folds the lost variance into roughness). Sampled with repeat wrapping.
//Time wraps every TIME_WRAP seconds to keep ω·t inside float precision; that is one
//imperceptible reshuffle every quarter of an hour.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.FlowSurfacePass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.rings = [];
  this.material = null;
  this.enabled = true;
  this._ready = false;
  this._state = {enabled: false, centerX: 0, centerZ: 0, halfWidth: 0};
  this.foamPass = null;
  //Live knob on the small-wave slope (step 4; 1 = the material's defaults).
  this.rippleScale = 1.0;
};

//cell: metres per grid cell; halfWidth: metres; hole: half-width of the square
//left out for the finer ring (0 = none). Each cell size matches the WaterField
//cascade whose texel centres its vertices sit on.
ARestlessOcean.Passes.FlowSurfacePass.RINGS = [
  {cell: 1.0, halfWidth: 128.0, hole: 0.0},
  {cell: 2.0, halfWidth: 240.0, hole: 124.0}
];
//Hand-off window half-width (m): inside cascade 0's 90% (230 m) edge crossfade.
ARestlessOcean.Passes.FlowSurfacePass.WINDOW_HALF_WIDTH = 228.0;
//Ripple profile buffer (see the header).
ARestlessOcean.Passes.FlowSurfacePass.WAVE_PERIOD = 8.0;
ARestlessOcean.Passes.FlowSurfacePass.WAVE_RES = 1024;
ARestlessOcean.Passes.FlowSurfacePass.WAVE_I_MIN = 2;
ARestlessOcean.Passes.FlowSurfacePass.WAVE_I_MAX = 200;
ARestlessOcean.Passes.FlowSurfacePass.WAVE_DEPTH = 0.3;
ARestlessOcean.Passes.FlowSurfacePass.TIME_WRAP = 900.0;

ARestlessOcean.Passes.FlowSurfacePass.prototype._initWaveProfile = function(){
  const FS = ARestlessOcean.Passes.FlowSurfacePass;
  const renderer = this.oceanGrid.renderer;
  const canFilterFloat = !!(renderer.extensions && renderer.extensions.has('OES_texture_float_linear'));
  this.waveTarget = new THREE.WebGLRenderTarget(FS.WAVE_RES, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
    minFilter: canFilterFloat ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter,
    magFilter: canFilterFloat ? THREE.LinearFilter : THREE.NearestFilter,
    generateMipmaps: canFilterFloat, depthBuffer: false, stencilBuffer: false
  });
  //Unit RMS slope: each wave i carries slope amplitude i^-1/2, so the slope variance is
  //Σ (1/i) / 2 over the band.
  let harmonic = 0.0;
  for(let i = FS.WAVE_I_MIN; i <= FS.WAVE_I_MAX; i++) harmonic += 1.0 / i;
  const norm = 1.0 / Math.sqrt(0.5 * harmonic);
  const f = function(v){ return v.toFixed(6); };
  this.waveMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {uTime: {value: 0.0}},
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'precision highp float;',
      'layout(location = 0) out vec4 oProfile;',
      'uniform float uTime;',
      'void main(){',
      '  float p = gl_FragCoord.x / ' + f(FS.WAVE_RES) + ' * ' + f(FS.WAVE_PERIOD) + ';',
      '  float eta = 0.0, slope = 0.0;',
      '  for(int i = ' + FS.WAVE_I_MIN + '; i <= ' + FS.WAVE_I_MAX + '; i++){',
      '    float fi = float(i);',
      '    float k = 6.2831853 * fi / ' + f(FS.WAVE_PERIOD) + ';',
      '    float omega = sqrt((9.81 * k + 7.28e-5 * k * k * k) * tanh(k * ' + f(FS.WAVE_DEPTH) + '));',
      '    float phase = fract(sin(fi * 78.233) * 43758.5453) * 6.2831853;',
      '    float slopeAmp = inversesqrt(fi);',
      '    float arg = k * p - omega * uTime + phase;',
      '    eta += slopeAmp / k * cos(arg);',
      '    slope -= slopeAmp * sin(arg);',
      '  }',
      '  oProfile = vec4(eta * ' + f(norm) + ', slope * ' + f(norm) + ', 0.0, 1.0);',
      '}'
    ].join('\n'),
    depthTest: false, depthWrite: false
  });
  this._waveScene = new THREE.Scene();
  this._waveScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.waveMaterial));
  this._waveCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
};

ARestlessOcean.Passes.FlowSurfacePass.prototype._stepWaveProfile = function(timeMs){
  const renderer = this.oceanGrid.renderer;
  this.waveMaterial.uniforms.uTime.value = (timeMs * 0.001) % ARestlessOcean.Passes.FlowSurfacePass.TIME_WRAP;
  const prevRT = renderer.getRenderTarget();
  renderer.setRenderTarget(this.waveTarget);
  renderer.render(this._waveScene, this._waveCamera);
  renderer.setRenderTarget(prevRT);
};

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
    //A transparent layer over the clipmap: across the hand-off band its alpha is the
    //flow weight (water-shader.glsl). Drawn after the opaque clipmap; the small offset
    //keeps it winning ties with the flattened still surface at the same level.
    material.transparent = true;
    material.depthWrite = true;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -2;
    //InstancedMesh with one identity instance: the water vertex shader
    //multiplies by instanceMatrix. The mesh itself carries the snapped centre.
    const mesh = new THREE.InstancedMesh(geometry, material, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;       //no ocean CSM caster, no scene shadow caster
    mesh.receiveShadow = true;
    //Above the skirt (1) and the clipmap (2): it alpha-blends over the clipmap across
    //the hand-off band, so it must draw after it.
    mesh.renderOrder = 3;
    mesh.userData.flowingWater = true;
    mesh.layers.set(ARestlessOcean.OCEAN_LAYER);
    scene.add(mesh);
    const key = '__flow_surface_' + r + '__';
    og.registerOceanMesh(key, mesh);
    this.rings.push({spec: spec, mesh: mesh, key: key});
  }
  this._initWaveProfile();
  //The foam accumulation target this surface's foam and flow come from.
  if(ARestlessOcean.Passes.FlowFoamPass){
    this.foamPass = new ARestlessOcean.Passes.FlowFoamPass(og);
    this.foamPass.init();
    //<ocean-river> knobs (ocean-state.js); undefined keeps the pass defaults.
    const d = og.data || {};
    const fp = this.foamPass;
    if(d.river_foam_decay !== undefined) fp.decayTime = d.river_foam_decay;
    if(d.river_foam_convergence !== undefined) fp.convergenceGain = d.river_foam_convergence;
    if(d.river_foam_bank !== undefined) fp.bankShearGain = d.river_foam_bank;
    if(d.river_foam_step !== undefined) fp.stepGain = d.river_foam_step;
    if(d.river_foam_fall !== undefined) fp.fallGain = d.river_foam_fall;
  }
  //The still/flowing speed band is packed into the field (refills it).
  const cfg = og.data || {};
  if(og.waterFieldPass && cfg.river_flow_low !== undefined && cfg.river_flow_high !== undefined
     && (cfg.river_flow_low !== og.waterFieldPass.flowLo || cfg.river_flow_high !== og.waterFieldPass.flowHi)){
    og.waterFieldPass.setFlowBand(cfg.river_flow_low, cfg.river_flow_high);
  }
  this._ready = true;
};

//ctx: {timeMs, cameraX, cameraZ, heightOffset, enabled}
ARestlessOcean.Passes.FlowSurfacePass.prototype.tick = function(ctx){
  this.enabled = ctx.enabled !== false;
  const og = this.oceanGrid;
  const fp = this.foamPass;
  if(fp && this.enabled && og.waterFieldPass && og.waterFieldPass.cascades.length === 3){
    const mj = og._landDirector && og._landDirector.mapJson;
    fp.tick({
      timeMs: ctx.timeMs,
      cameraX: ctx.cameraX,
      cameraZ: ctx.cameraZ,
      fieldCascade: og.waterFieldPass.cascades[0],
      waterfalls: (mj && mj.simulation && mj.simulation.waterfalls) || null,
      //Phase 6: traced falls (last frame's; WaterfallSheetPass ticks after this pass).
      nappes: og.waterfallSheetPass ? og.waterfallSheetPass.liveNappes() : null
    });
  }
  const foamTex = fp ? fp.texture() : null;
  if(this.enabled && this.waveTarget) this._stepWaveProfile(ctx.timeMs);
  for(let r = 0; r < this.rings.length; ++r){
    const ring = this.rings[r];
    //Vertices on cascade 0's texel CENTRES, (k + ½) m: cascade 0 snaps its centre to
    //whole metres, and every ring's half-width is a whole number of its (integer) cells.
    const cx = Math.floor(ctx.cameraX) + 0.5;
    const cz = Math.floor(ctx.cameraZ) + 0.5;
    ring.mesh.position.set(cx, ctx.heightOffset, cz);
    ring.mesh.visible = this.enabled;
    ring.centerX = cx;
    ring.centerZ = cz;
    const u = ring.mesh.material.uniforms;
    u.flowFoamMap.value = foamTex;
    u.flowWaveProfile.value = this.waveTarget ? this.waveTarget.texture : null;
    u.flowRippleScale.value = this.rippleScale;
    if(foamTex) u.flowFoamWindow.value.set(fp.centerX, fp.centerZ, ARestlessOcean.Passes.FlowFoamPass.HALF_WIDTH);
    else u.flowFoamWindow.value.set(0, 0, 0);
  }
  const outer = this.rings[this.rings.length - 1];
  this._state.enabled = this._ready && this.enabled;
  if(outer){
    this._state.centerX = outer.centerX;
    this._state.centerZ = outer.centerZ;
    this._state.halfWidth = Math.min(ARestlessOcean.Passes.FlowSurfacePass.WINDOW_HALF_WIDTH, outer.spec.halfWidth - outer.spec.cell);
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
  if(this.foamPass){ this.foamPass.dispose(); this.foamPass = null; }
  if(this.waveTarget){ this.waveTarget.dispose(); this.waveTarget = null; }
  if(this.waveMaterial) this.waveMaterial.dispose();
  this.rings.length = 0;
  this._ready = false;
  this._state.enabled = false;
};
