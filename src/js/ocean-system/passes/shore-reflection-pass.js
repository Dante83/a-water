//── Shore reflection (Phase 3b) ────────────────────────────────────────────
//
//WHAT IT ADDS. A real coast sends part of every wave back out to sea: a steep
//rock shore reflects about half the incident height, a gentle beach almost none
//(Battjes 1974, Kr ≈ 0.1 ξ²). The outgoing crests cross the incoming ones in a
//visible cross-hatch. The FFT ocean has no idea where the shore is and 3a's
//breakers only carry energy IN, so without this layer every shore is a perfect
//absorber. See NEARSHORE-WAVES.md § 5.4, § 5.9 and § 8 (3b).
//
//WHAT IT IS. A camera-following, world-snapped 2D linear wave equation that
//carries ONLY the reflected (scattered) height. The incident is never simulated:
//it is the FFT, rendered exactly as before, so nothing is double-counted. Shore
//cells are driven by the FFT height and give back Kr of it.
//
//THE MODEL (each piece measured in research/nearshore-spike, § 5.9):
//  * Medium. c(h) is the linear-dispersion phase speed at the spectral peak
//    (Eckart's kh ≈ k0h / sqrt(tanh k0h)), in the constant-amplitude form
//        η_tt = c ∇·(c ∇η)
//    whose WKB amplitude is exactly constant, so a reflection leaves at Kr × the
//    DEEP-WATER incident everywhere, which is Battjes' definition. (The divergence
//    form would shoal it, the plain c²∇²η form amplify it.) Refraction over the
//    bathymetry comes for free.
//  * Where the water stops. At the h_min = L0 / 18π contour, where the local
//    wavelength falls to ~10 cells, not at the shoreline: shoreward of it the grid
//    cannot carry the wave, and the masked FFT has gone to zero anyway.
//  * The shore is a Robin (impedance) boundary. A dry neighbour is a ghost cell
//        ghost = η_p − α' dx v_p / c + source,   α = (1 − Kr) / (1 + Kr)
//    so arriving simulated waves (another shore's reflection) come back with THIS
//    shore's Kr, and a Kr ≈ 0 beach is itself the absorber. α' = α cosθ / (|nx| + |ny|):
//    the staircase has |nx| + |ny| faces per metre of true shore, and cosθ makes the
//    incident reflect at exactly Kr at any angle. A hard (Dirichlet) emitter was
//    § 8's first plan; it reflects every arriving wave at −1 (§ 5.9 point 2).
//  * The source is the SHOREWARD characteristic of the incident only:
//        source = cosθ (1 − α) / (1 + cosθ) · (dx inc_t / (|nx| + |ny|) / c + (c0 / c)(inc_p − inc_q))
//    The plain total-field source also cancels any incident travelling AWAY from
//    the shore, and the FFT's directional spread always has some (§ 5.9 point 4).
//    inc_t is the frame-to-frame difference of the incident at the cell.
//  * The incident is the UNMASKED cascade height (the depth part of WaveMask is
//    what shoaling took; Battjes' Kr is relative to deep water), weighed by the
//    fetch part, mip-filtered to the grid and faded out for cascades the grid
//    cannot carry. c0 is the deep-water peak phase speed.
//  * Kr. Battjes with ξ = (h/s) / sqrt(Hs / L0) at the boundary cell, the same
//    mean-slope reading ShoreBreaker uses. Capped at 1.
//  * Cell size dx = L0 / 30, so the cost is fixed and the window scales with the
//    sea (≈ 1.9 m cells and a ±480 m window at 8 m/s wind). A sponge on the rim.
//  * Breaking. The equation is linear and cannot break, so a narrow strait
//    between two reflective shores rang up to 3–4 m of reflected height in 1–3 m
//    of water (headless, island-sholes, 2026-09-13). Where |η| passes McCowan's
//    amplitude 0.39 h the cell loses energy at a rate that grows with the excess.
//    h is read back from c as c²/g, exact in the shallow water where it matters.
//    ⚠ Floor at Hs / 2 (a look-and-sanity choice, not a fit): the shore cells sit
//    on the ~1 m h_min contour, and a pure McCowan cap there clipped a cliff's
//    single reflection to a third of the incident. The floor lets one full
//    reflection of a significant wave through anywhere and breaks only pile-up.
//
//ONE SOURCE, FIVE GPU CONSUMERS. ARestlessOcean.ShoreReflection.GLSL is spliced
//at `$shore_reflection_functions` into the water vertex (geometry) and fragment
//(normals, debug 62), the ocean CSM caster, the CPU height bake and the camera
//submersion probe. Each reads the state texture bilinearly.
//
//⚠ Float precision. ANGLE GL-EGL over Mesa radeonsi samples RGBA32F at half
//precision (§ 5.8), which silently wrecks any float-state sim. init() runs a
//self-test and disables the layer if it fails.

ARestlessOcean.ShoreReflection = {};

//⚠ PARKED (2026-09-13). Off: no pass, no render targets, no per-frame step, and
//every consumer splices STUB_GLSL (no sampler). Reasons, in
//WATER-TYPES-PROGRESS.md § Phase 3b:
//  - 0.58 ms/frame on the reference iGPU.
//  - On the current two-way FFT spectrum (h_0-pass's symmetric cos² spreading) a
//    reflection has nothing directional to stand out against.
//Flip to true to bring it back.
ARestlessOcean.ShoreReflection.ENABLED = false;

ARestlessOcean.ShoreReflection.G = 9.80665;
ARestlessOcean.ShoreReflection.RESOLUTION = 512;
ARestlessOcean.ShoreReflection.CELLS_PER_WAVELENGTH = 30.0;
ARestlessOcean.ShoreReflection.MIN_DX = 0.25;     //m; 3 m/s wind would ask for ~0.18
ARestlessOcean.ShoreReflection.MAX_DX = 4.0;      //m; a storm would ask for ~6
ARestlessOcean.ShoreReflection.MIN_HS = 0.1;      //m; below this the layer is off
//Rim sponge (cells) and its peak damping rate (1/s). A graded (1 − d/W)² ramp
//over ~1.5 peak wavelengths: a uniform band's inner edge reflects on its own.
ARestlessOcean.ShoreReflection.SPONGE_CELLS = 48.0;
ARestlessOcean.ShoreReflection.SPONGE_RATE = 3.0;
//Consumers fade the height out over the same rim, so the sponge never shows as
//a cut line.
ARestlessOcean.ShoreReflection.EDGE_FADE_START = 1.0 - 2.0 * 48.0 / 512.0;
//Re-centre when the camera is this fraction of the half-width from the centre.
ARestlessOcean.ShoreReflection.RECENTER_FRACTION = 0.25;
//Courant number the time step is clamped to (2D stability limit is 1/√2).
ARestlessOcean.ShoreReflection.COURANT = 0.6;
//Depth-limited breaking of the reflected field: amplitude limit (× h) and the
//damping rate (1/s) reached at twice that amplitude.
ARestlessOcean.ShoreReflection.BREAK_AMPLITUDE = 0.39;
ARestlessOcean.ShoreReflection.BREAK_RATE = 4.0;
ARestlessOcean.ShoreReflection.BREAK_HS_FLOOR = 0.5;
//Grid resolvability of a cascade: its representative wavelength over dx. Below
//LO cells the 5-point Laplacian's dispersion error is large; the cascade is
//left out of the incident rather than reflected wrongly.
ARestlessOcean.ShoreReflection.RESOLVE_LO = 5.0;
ARestlessOcean.ShoreReflection.RESOLVE_HI = 10.0;
//Lower clamp on cosθ between the wave direction and the shore normal. Lee and
//side-on shores still get the FFT's spread; without a floor their α' → 0 would
//turn them into perfect walls for arriving simulated waves.
ARestlessOcean.ShoreReflection.COS_MIN = 0.35;
//Shore normal from central differences of shoreSDF on WaterField cascade 1
//(4 m texels), ± this many metres; see ShoreBreaker.NORMAL_STEP for why.
ARestlessOcean.ShoreReflection.NORMAL_STEP = 4.0;
//The medium is rebaked at least this often (ms) even if nothing is known to
//have changed: the field streams in tiles.
ARestlessOcean.ShoreReflection.REBAKE_MS = 1000.0;

//── Consumer chunk ─────────────────────────────────────────────────────────
//What consumers splice when the layer is parked or this file is missing: the
//same functions and scalar uniforms (debug 62 reads them), and no sampler.
ARestlessOcean.ShoreReflection.STUB_GLSL = [
  'uniform float shoreReflectionEnabled;',
  'uniform vec2 shoreReflectionCenter;',
  'uniform float shoreReflectionHalfWidth;',
  'float shoreReflectionHeightAt(vec2 xz){ return 0.0; }',
  'vec2 shoreReflectionSlopeAt(vec2 xz){ return vec2(0.0); }'
].join('\n');
//The chunk a consumer should splice right now.
ARestlessOcean.ShoreReflection.consumerGLSL = function(){
  const SR = ARestlessOcean.ShoreReflection;
  return SR.ENABLED ? SR.GLSL : SR.STUB_GLSL;
};
ARestlessOcean.ShoreReflection.createUniforms = function(){
  return {
    shoreReflectionEnabled:     {value: 0.0},
    shoreReflectionMap:         {value: null},
    shoreReflectionCenter:      {value: new THREE.Vector2()},
    shoreReflectionHalfWidth:   {value: 1.0},
    shoreReflectionCell:        {value: 1.0},    //dx, m
    shoreReflectionHeightScale: {value: 1.0}
  };
};

//s = ARestlessOcean.Passes.ShoreReflectionPass.prototype.consumerState()
ARestlessOcean.ShoreReflection.writeUniforms = function(u, s){
  if(!u.shoreReflectionEnabled) return;
  const on = !!(s && s.enabled && s.texture);
  u.shoreReflectionEnabled.value = on ? 1.0 : 0.0;
  if(!on) return;
  u.shoreReflectionMap.value = s.texture;
  u.shoreReflectionCenter.value.set(s.centerX, s.centerZ);
  u.shoreReflectionHalfWidth.value = s.halfWidth;
  u.shoreReflectionCell.value = s.dx;
  u.shoreReflectionHeightScale.value = s.heightScale;
};

ARestlessOcean.ShoreReflection.copyUniforms = function(dst, src){
  if(!dst.shoreReflectionEnabled || !src.shoreReflectionEnabled) return;
  dst.shoreReflectionEnabled.value = src.shoreReflectionEnabled.value;
  dst.shoreReflectionMap.value = src.shoreReflectionMap.value;
  dst.shoreReflectionCenter.value.copy(src.shoreReflectionCenter.value);
  dst.shoreReflectionHalfWidth.value = src.shoreReflectionHalfWidth.value;
  dst.shoreReflectionCell.value = src.shoreReflectionCell.value;
  dst.shoreReflectionHeightScale.value = src.shoreReflectionHeightScale.value;
};

//GLSL ES 1.00. shoreReflectionHeightAt(xz): reflected height (m) with the rim
//fade. shoreReflectionSlopeAt(xz): its gradient, central differences one cell
//apart (the fragment has no spare varyings to carry it from the vertex).
ARestlessOcean.ShoreReflection.GLSL = (function(){
  const SR = ARestlessOcean.ShoreReflection;
  return [
    '//── ShoreReflection (spliced from shore-reflection-pass.js — edit it THERE) ──',
    'uniform float shoreReflectionEnabled;',
    'uniform sampler2D shoreReflectionMap;',
    'uniform vec2 shoreReflectionCenter;',
    'uniform float shoreReflectionHalfWidth;',
    'uniform float shoreReflectionCell;',
    'uniform float shoreReflectionHeightScale;',
    'float shoreReflectionHeightAt(vec2 xz){',
    '  if(shoreReflectionEnabled < 0.5) return 0.0;',
    '  vec2 d = (xz - shoreReflectionCenter) / shoreReflectionHalfWidth;',
    '  float m = max(abs(d.x), abs(d.y));',
    '  if(m >= 1.0) return 0.0;',
    '  float edge = 1.0 - smoothstep(' + SR.EDGE_FADE_START.toFixed(6) + ', 1.0, m);',
    '  return edge * shoreReflectionHeightScale * texture2D(shoreReflectionMap, d * 0.5 + 0.5).r;',
    '}',
    'vec2 shoreReflectionSlopeAt(vec2 xz){',
    '  if(shoreReflectionEnabled < 0.5) return vec2(0.0);',
    '  vec2 ex = vec2(shoreReflectionCell, 0.0);',
    '  vec2 ez = vec2(0.0, shoreReflectionCell);',
    '  return vec2(shoreReflectionHeightAt(xz + ex) - shoreReflectionHeightAt(xz - ex),',
    '              shoreReflectionHeightAt(xz + ez) - shoreReflectionHeightAt(xz - ez)) / (2.0 * shoreReflectionCell);',
    '}'
  ].join('\n');
})();

//── Sea state → grid ───────────────────────────────────────────────────────
//sbp = ShoreBreaker.paramsFrom(...) (Hs as rendered, ω_p, wind direction).
ARestlessOcean.ShoreReflection.gridFor = function(sbp, out){
  const SR = ARestlessOcean.ShoreReflection;
  out = out || {};
  const w = Math.max(sbp.omega, 1e-3);
  out.omega = w;
  out.L0 = 2.0 * Math.PI * SR.G / (w * w);
  out.c0 = SR.G / w;
  //Quantised to quarter-octaves so a slow wind ramp does not reset the sim every frame.
  const raw = out.L0 / SR.CELLS_PER_WAVELENGTH;
  const q = Math.pow(2.0, Math.round(Math.log2(raw) * 4.0) / 4.0);
  out.dx = Math.min(SR.MAX_DX, Math.max(SR.MIN_DX, q));
  out.hMin = Math.max(0.05, out.L0 / (18.0 * Math.PI));
  out.halfWidth = 0.5 * SR.RESOLUTION * out.dx;
  return out;
};

//═══════════════════════════════════════════════════════════════════════════
ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.ShoreReflectionPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.enabled = true;
  this.heightScale = 1.0;
  this.supported = false;       //set by init's precision self-test
  this.active = false;          //simulating this frame
  this.centerX = 0.0;
  this.centerZ = 0.0;
  this.grid = null;             //gridFor() of the running sim
  this.stepCount = 0;
  this.bakeCount = 0;
  this._read = 0;
  this._needsReset = true;
  this._lastBakeMs = -1e9;
  this._lastRefills = -1;
  this._lastTimeMs = null;
  this._scene = null;
  this._camera = null;
  this._state = null;
  this._medium = null;
  this._stepMaterial = null;
  this._bakeMaterial = null;
  this._clearMaterial = null;
};

ARestlessOcean.Passes.ShoreReflectionPass.prototype.init = function(){
  const SR = ARestlessOcean.ShoreReflection;
  const RES = SR.RESOLUTION;
  const gl = this.renderer.getContext();
  const isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined') && (gl instanceof WebGL2RenderingContext);
  if(!isWebGL2 || !ARestlessOcean.Passes.WaterFieldPass || !ARestlessOcean.WaveMask){
    console.warn('[shoreReflection] needs WebGL2, WaterFieldPass and WaveMask; disabled.');
    return;
  }
  this._scene = new THREE.Scene();
  this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null));

  //Consumers sample the state bilinearly; a float texture with LinearFilter
  //and no OES_texture_float_linear samples as zero (see WaterFieldPass.init).
  const canFilterFloat = !!(this.renderer.extensions && this.renderer.extensions.has('OES_texture_float_linear'));
  const makeTarget = function(filter){
    return new THREE.WebGLRenderTarget(RES, RES, {
      minFilter: filter, magFilter: filter,
      format: THREE.RGBAFormat, type: THREE.FloatType,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false
    });
  };
  const stateFilter = canFilterFloat ? THREE.LinearFilter : THREE.NearestFilter;
  this._state = [makeTarget(stateFilter), makeTarget(stateFilter)];
  this._medium = makeTarget(THREE.NearestFilter);

  this._buildMaterials();
  this.supported = this._precisionSelfTest();
  if(!this.supported){
    console.warn('[shoreReflection] float render targets sample below full precision on this GPU/driver '
      + '(NEARSHORE-WAVES.md § 5.8); the reflection layer is disabled.');
  }
};

ARestlessOcean.Passes.ShoreReflectionPass.prototype._buildMaterials = function(){
  const SR = ARestlessOcean.ShoreReflection;
  const WF = ARestlessOcean.Passes.WaterFieldPass;
  const f = function(v){ return (+v).toFixed(6); };
  const vert = 'void main(){ gl_Position = vec4(position, 1.0); }';
  //GLSL3 ShaderMaterials get no GLSL1 compatibility defines from three, and
  //WaterFieldPass.SAMPLE_GLSL is written with texture2D.
  const out = [
    'layout(location = 0) out highp vec4 srOut;',
    '#define gl_FragColor srOut',
    '#define texture2D texture'
  ].join('\n');
  const common = [
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    out,
    'uniform vec2 srRes;',
    'uniform vec2 srCenter;',
    'uniform float srDx;',
    'vec2 srCellXZ(ivec2 p){ return srCenter + (vec2(p) + 0.5 - 0.5 * srRes) * srDx; }',
    'bool srInWindow(ivec2 p){ return all(greaterThanEqual(p, ivec2(0))) && all(lessThan(p, ivec2(srRes))); }'
  ].join('\n');

  //── Medium bake: (c, α', source gain, faceScale) per cell; c = 0 is "not simulated".
  const bakeFrag = [
    common,
    'uniform float srOmega;',
    'uniform float srHMin;',
    'uniform float srHs;',
    'uniform float srL0;',
    'uniform float srDepthCap;',
    'uniform vec2 srWaveDir;',
    WF.SAMPLE_GLSL,
    'float srShoreSmooth(vec2 xz){',
    '  return waterFieldCascadeSample(waterFieldCascade1, waterFieldCascadeCenter[1], waterFieldCascadeHalfWidth[1], xz).b;',
    '}',
    'void main(){',
    '  ivec2 p = ivec2(gl_FragCoord.xy);',
    '  vec2 xz = srCellXZ(p);',
    '  vec4 field = waterFieldAt(xz);',
    '  float h = field.g;',
    //At the provider's depth cap the depth is unknown, not shallow (see WaveMask).
    '  if(h >= srDepthCap * 0.98) h = 1.0e4;',
    '  if(field.a > 0.5 || field.b <= 0.0 || h <= 0.0){ gl_FragColor = vec4(0.0); return; }',
    //Wet but shoreward of h_min: not simulated, but filled from its neighbours so
    //the reflection reaches the waterline (.g = -1 marks it).
    '  if(h < srHMin){ gl_FragColor = vec4(0.0, -1.0, 0.0, 0.0); return; }',
    '  float k0 = srOmega * srOmega / ' + f(SR.G) + ';',
    '  float X = min(k0 * h, 40.0);',
    '  float e2 = exp(-2.0 * X);',
    '  float k = k0 / sqrt((1.0 - e2) / (1.0 + e2));',
    '  float c = srOmega / k;',
    '  vec2 ex = vec2(' + f(SR.NORMAL_STEP) + ', 0.0);',
    '  vec2 ez = vec2(0.0, ' + f(SR.NORMAL_STEP) + ');',
    '  vec2 grad = vec2(srShoreSmooth(xz + ex) - srShoreSmooth(xz - ex), srShoreSmooth(xz + ez) - srShoreSmooth(xz - ez)) / ' + f(2.0 * SR.NORMAL_STEP) + ';',
    '  float gl = length(grad);',
    '  vec2 nLand = gl > 0.0001 ? -grad / gl : srWaveDir;',
    '  float faceScale = 1.0 / (abs(nLand.x) + abs(nLand.y));',
    '  float cosT = clamp(dot(srWaveDir, nLand), ' + f(SR.COS_MIN) + ', 1.0);',
    '  float slope = h / max(field.b, 1.0);',
    '  float xi = slope / sqrt(max(srHs, 0.0001) / srL0);',
    '  float Kr = min(1.0, 0.1 * xi * xi);',
    '  float alpha = (1.0 - Kr) / (1.0 + Kr);',
    '  gl_FragColor = vec4(c, alpha * cosT * faceScale, cosT * (1.0 - alpha) / (1.0 + cosT), faceScale);',
    '}'
  ].join('\n');
  const bakeUniforms = Object.assign({
    srRes: {value: new THREE.Vector2(SR.RESOLUTION, SR.RESOLUTION)},
    srCenter: {value: new THREE.Vector2()},
    srDx: {value: 1.0},
    srOmega: {value: 1.0},
    srHMin: {value: 1.0},
    srHs: {value: 1.0},
    srL0: {value: 1.0},
    srDepthCap: {value: 1.0e9},
    srWaveDir: {value: new THREE.Vector2(1.0, 0.0)}
  }, WF.createSampleUniforms());
  this._bakeMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: bakeUniforms,
    vertexShader: vert, fragmentShader: bakeFrag, depthTest: false, depthWrite: false
  });

  //── Step: state = (η, v, incident at this cell last step, 1 if .b is valid).
  const N = 6;
  let incLines = '';
  for(let c = 0; c < N; ++c){
    const m = c < 3 ? 'ma.' + 'xyz'[c] : 'mb.' + 'xyz'[c - 3];
    incLines += '  h += srCascadeWeight[' + c + '] * ' + m + ' * textureLod(srCascadeArray, vec3((xz + srCascadeOffset[' + c + ']) / srCascadePatch[' + c + '], ' + c + '.0), srCascadeLod[' + c + ']).y;\n';
  }
  //Phase 10: the composer's cascades are one sampler2DArray, so this pass reads a
  //layer per cascade instead of declaring six samplers of its own. That is six
  //texture units back in a program that already carries the field and the medium.
  const cascadeDecl = 'precision highp sampler2DArray;\nuniform sampler2DArray srCascadeArray;\n';
  const stepFrag = [
    common,
    'uniform sampler2D srState;',
    'uniform sampler2D srMedium;',
    'uniform vec2 srShift;',
    'uniform float srDt;',
    'uniform float srIncDt;',
    'uniform float srC0;',
    'uniform float srHs;',
    cascadeDecl,
    'uniform vec2 srCascadeOffset[6];',
    'uniform float srCascadePatch[6];',
    'uniform float srCascadeLod[6];',
    'uniform float srCascadeWeight[6];',
    WF.SAMPLE_GLSL,
    ARestlessOcean.WaveMask.GLSL,
    'float srIncident(vec2 xz, vec3 ma, vec3 mb){',
    '  float h = 0.0;',
    incLines + '  return h;',
    '}',
    'float srSponge(ivec2 p){',
    '  float d = float(min(min(p.x, p.y), min(int(srRes.x) - 1 - p.x, int(srRes.y) - 1 - p.y)));',
    '  float w = max(0.0, 1.0 - d / ' + f(SR.SPONGE_CELLS) + ');',
    '  return ' + f(SR.SPONGE_RATE) + ' * w * w;',
    '}',
    'void main(){',
    '  ivec2 p = ivec2(gl_FragCoord.xy);',
    '  vec4 med = texelFetch(srMedium, p, 0);',
    '  float cp = med.r;',
    '  ivec2 shift = ivec2(srShift);',
    '  if(cp <= 0.0){',
    '    if(med.g > -0.5){ gl_FragColor = vec4(0.0); return; }',
    //Waterline band: the mean of the wet neighbours (simulated or filled) last step.
    //A band a few cells wide settles within a few frames, against a ~6 s period.
    '    ivec2 fn[4] = ivec2[4](ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1));',
    '    float sum = 0.0;',
    '    float cnt = 0.0;',
    '    for(int k = 0; k < 4; ++k){',
    '      ivec2 q = p + fn[k];',
    '      if(!srInWindow(q)) continue;',
    '      vec4 mq = texelFetch(srMedium, q, 0);',
    '      if(mq.r <= 0.0 && mq.g > -0.5) continue;',
    '      ivec2 qs = q + shift;',
    '      sum += srInWindow(qs) ? texelFetch(srState, qs, 0).r : 0.0;',
    '      cnt += 1.0;',
    '    }',
    '    gl_FragColor = vec4(cnt > 0.0 ? sum / cnt : 0.0, 0.0, 0.0, 0.0);',
    '    return;',
    '  }',
    '  ivec2 ps = p + shift;',
    '  vec4 s = srInWindow(ps) ? texelFetch(srState, ps, 0) : vec4(0.0);',
    '  ivec2 nb[4] = ivec2[4](ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1));',
    '  bool dry[4] = bool[4](false, false, false, false);',
    '  bool anyDry = false;',
    '  float flux = 0.0;',
    '  for(int k = 0; k < 4; ++k){',
    '    ivec2 q = p + nb[k];',
    //Window rim: plain Neumann; the sponge has already absorbed what gets there.
    '    if(!srInWindow(q)) continue;',
    '    float cq = texelFetch(srMedium, q, 0).r;',
    '    if(cq > 0.0){',
    '      ivec2 qs = q + shift;',
    '      float eq = srInWindow(qs) ? texelFetch(srState, qs, 0).r : 0.0;',
    '      flux += 0.5 * (cp + cq) * (eq - s.r);',
    '    } else {',
    '      dry[k] = true;',
    '      anyDry = true;',
    '    }',
    '  }',
    '  float incNow = 0.0;',
    '  float incValid = 0.0;',
    '  if(anyDry){',
    '    vec2 xp = srCellXZ(p);',
    '    vec4 field = waterFieldAt(xp);',
    '    vec3 ma;',
    '    vec3 mb;',
    //Fetch part of WaveMask only: depth forced deep and wet, so the TMA shoaling
    //loss and the dry gate do not apply (Kr is relative to the deep incident).
    '    waveMaskCascades(vec4(field.r, ' + f(ARestlessOcean.WaveMask.DEEP) + ', field.b, 0.0), ma, mb);',
    '    incNow = srIncident(xp, ma, mb);',
    '    float incT = s.a > 0.5 ? (incNow - s.b) / srIncDt : 0.0;',
    '    for(int k = 0; k < 4; ++k){',
    '      if(!dry[k]) continue;',
    '      float incQ = srIncident(srCellXZ(p + nb[k]), ma, mb);',
    '      float src = med.b * (med.a * srDx * incT / cp + (srC0 / cp) * (incNow - incQ));',
    '      flux += -med.g * srDx * s.g + cp * src;',
    '    }',
    '    incValid = 1.0;',
    '  }',
    '  float v = s.g + srDt * cp * flux / (srDx * srDx);',
    '  float aMax = max(' + f(SR.BREAK_AMPLITUDE) + ' * cp * cp / ' + f(SR.G) + ', ' + f(SR.BREAK_HS_FLOOR) + ' * srHs);',
    '  float damp = srSponge(p) + ' + f(SR.BREAK_RATE) + ' * clamp(abs(s.r) / max(aMax, 0.001) - 1.0, 0.0, 1.0);',
    '  v /= 1.0 + srDt * damp;',
    '  float eta = (s.r + srDt * v) / (1.0 + srDt * damp);',
    '  gl_FragColor = vec4(eta, v, incNow, incValid);',
    '}'
  ].join('\n');
  const stepUniforms = Object.assign({
    srRes: {value: new THREE.Vector2(SR.RESOLUTION, SR.RESOLUTION)},
    srCenter: {value: new THREE.Vector2()},
    srDx: {value: 1.0},
    srState: {value: null},
    srMedium: {value: null},
    srShift: {value: new THREE.Vector2()},
    srDt: {value: 1.0 / 60.0},
    srIncDt: {value: 1.0 / 60.0},
    srC0: {value: 1.0},
    srHs: {value: 1.0},
    srCascadeOffset: {value: [0, 1, 2, 3, 4, 5].map(function(){ return new THREE.Vector2(); })},
    srCascadePatch: {value: [1, 1, 1, 1, 1, 1]},
    srCascadeLod: {value: [0, 0, 0, 0, 0, 0]},
    srCascadeWeight: {value: [0, 0, 0, 0, 0, 0]}
  }, WF.createSampleUniforms(), ARestlessOcean.WaveMask.createUniforms());
  stepUniforms.srCascadeArray = {value: null};
  this._stepMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: stepUniforms,
    vertexShader: vert, fragmentShader: stepFrag, depthTest: false, depthWrite: false
  });

  this._clearMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: {},
    vertexShader: vert,
    fragmentShader: 'precision highp float;\n' + out + '\nvoid main(){ gl_FragColor = vec4(0.0); }',
    depthTest: false, depthWrite: false
  });
};

ARestlessOcean.Passes.ShoreReflectionPass.prototype._draw = function(material, target){
  const mesh = this._scene.children[0];
  mesh.material = material;
  this.renderer.setRenderTarget(target);
  this.renderer.render(this._scene, this._camera);
};

//Accumulate +0.001 from 10.0 through a float render target 100 times; a
//half-precision sampler loses every increment (§ 5.8).
ARestlessOcean.Passes.ShoreReflectionPass.prototype._precisionSelfTest = function(){
  const targets = [0, 1].map(function(){
    return new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: THREE.FloatType,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false
    });
  });
  const vert = 'void main(){ gl_Position = vec4(position, 1.0); }';
  const head = 'precision highp float;\nprecision highp sampler2D;\nlayout(location = 0) out highp vec4 srOut;\n';
  const seed = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, uniforms: {}, vertexShader: vert,
    fragmentShader: head + 'void main(){ srOut = vec4(10.0); }', depthTest: false, depthWrite: false});
  const inc = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, uniforms: {src: {value: null}}, vertexShader: vert,
    fragmentShader: head + 'uniform sampler2D src;\nvoid main(){ srOut = texelFetch(src, ivec2(gl_FragCoord.xy), 0) + vec4(0.001); }',
    depthTest: false, depthWrite: false});
  const prevRT = this.renderer.getRenderTarget();
  this._draw(seed, targets[0]);
  let r = 0;
  for(let i = 0; i < 100; ++i){
    inc.uniforms.src.value = targets[r].texture;
    this._draw(inc, targets[1 - r]);
    r = 1 - r;
  }
  const gl = this.renderer.getContext();
  const prevPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  if(prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const buf = new Float32Array(4);
  this.renderer.readRenderTargetPixels(targets[r], 0, 0, 1, 1, buf);
  if(prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPack);
  this.renderer.setRenderTarget(prevRT);
  targets.forEach(function(t){ t.dispose(); });
  seed.dispose();
  inc.dispose();
  this.selfTestValue = buf[0];
  return Math.abs(buf[0] - 10.1) < 0.01;
};

//ctx: {timeMs, cameraX, cameraZ, enabled, breakerParams (ShoreBreaker.paramsFrom), waveMaskParams, depthCap}
ARestlessOcean.Passes.ShoreReflectionPass.prototype.tick = function(ctx){
  const SR = ARestlessOcean.ShoreReflection;
  const grid = this.oceanGrid;
  const sbp = ctx.breakerParams;
  const composer = grid.oceanHeightComposer;
  const field = grid.waterFieldPass;
  const lastTime = this._lastTimeMs;
  this._lastTimeMs = ctx.timeMs;
  this.active = !!(this.supported && this.enabled && ctx.enabled && sbp && sbp.enabled && sbp.Hs >= SR.MIN_HS
    && field && field.cascades.length === 3 && composer && composer.cascadeDisplacementTexture);
  if(!this.active){
    //Frozen, not cleared: switching the layer back on (or a sea briefly under
    //MIN_HS) resumes the field instead of waiting tens of seconds for it to
    //rebuild. A new cell size or a camera jump still resets it below.
    return;
  }

  //Sea state → grid. A different cell size is a different sim: start over.
  const g = SR.gridFor(sbp, this._gridScratch || (this._gridScratch = {}));
  if(!this.grid || g.dx !== this.grid.dx){
    this.grid = Object.assign({}, g);
    this._needsReset = true;
  } else {
    Object.assign(this.grid, g);
  }
  const dx = this.grid.dx;

  const prevRT = this.renderer.getRenderTarget();
  let shiftX = 0, shiftZ = 0;
  if(this._needsReset){
    this.centerX = Math.round(ctx.cameraX / dx) * dx;
    this.centerZ = Math.round(ctx.cameraZ / dx) * dx;
    this._draw(this._clearMaterial, this._state[0]);
    this._draw(this._clearMaterial, this._state[1]);
    this._lastBakeMs = -1e9;
    this._needsReset = false;
  } else if(Math.abs(ctx.cameraX - this.centerX) > this.grid.halfWidth || Math.abs(ctx.cameraZ - this.centerZ) > this.grid.halfWidth){
    //Teleported out of the window: nothing in the old field is still in view.
    this.centerX = Math.round(ctx.cameraX / dx) * dx;
    this.centerZ = Math.round(ctx.cameraZ / dx) * dx;
    this._draw(this._clearMaterial, this._state[0]);
    this._draw(this._clearMaterial, this._state[1]);
    this._lastBakeMs = -1e9;
  } else {
    const limit = SR.RECENTER_FRACTION * this.grid.halfWidth;
    if(Math.abs(ctx.cameraX - this.centerX) > limit || Math.abs(ctx.cameraZ - this.centerZ) > limit){
      shiftX = Math.round((ctx.cameraX - this.centerX) / dx);
      shiftZ = Math.round((ctx.cameraZ - this.centerZ) / dx);
      this.centerX += shiftX * dx;
      this.centerZ += shiftZ * dx;
    }
  }

  //Medium: whenever the window moved, the field refilled, or on a slow clock.
  const refills = field.refillCount;
  if(shiftX !== 0 || shiftZ !== 0 || refills !== this._lastRefills || ctx.timeMs - this._lastBakeMs > SR.REBAKE_MS){
    const bu = this._bakeMaterial.uniforms;
    field.bindUniforms(bu);
    bu.srCenter.value.set(this.centerX, this.centerZ);
    bu.srDx.value = dx;
    bu.srOmega.value = this.grid.omega;
    bu.srHMin.value = this.grid.hMin;
    bu.srHs.value = sbp.Hs;
    bu.srL0.value = this.grid.L0;
    bu.srDepthCap.value = ctx.depthCap;
    bu.srWaveDir.value.set(sbp.waveDirX, sbp.waveDirZ);
    this._draw(this._bakeMaterial, this._medium);
    this._lastRefills = refills;
    this._lastBakeMs = ctx.timeMs;
    this.bakeCount++;
  }

  //One step per frame, clamped to the Courant limit (a hitch slows the
  //reflection down rather than blowing it up).
  const frameDt = lastTime === null ? 1.0 / 60.0 : Math.max(1e-3, (ctx.timeMs - lastTime) * 0.001);
  const dtMax = SR.COURANT * dx / this.grid.c0;
  const su = this._stepMaterial.uniforms;
  field.bindUniforms(su);
  if(ctx.waveMaskParams) ARestlessOcean.WaveMask.writeUniforms(su, ctx.waveMaskParams);
  su.srCenter.value.set(this.centerX, this.centerZ);
  su.srDx.value = dx;
  su.srShift.value.set(shiftX, shiftZ);
  su.srDt.value = Math.min(frameDt, dtMax);
  su.srIncDt.value = frameDt;
  su.srC0.value = this.grid.c0;
  su.srHs.value = sbp.Hs;
  su.srState.value = this._state[this._read].texture;
  su.srMedium.value = this._medium.texture;
  const offsets = grid.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
  const bandLo = ctx.waveMaskParams && ctx.waveMaskParams.bandKLo;
  const bandHi = ctx.waveMaskParams && ctx.waveMaskParams.bandKHi;
  const kp = this.grid.omega * this.grid.omega / SR.G;
  const texRes = composer.baseTextureWidth || 512;
  su.srCascadeArray.value = composer.cascadeDisplacementTexture;
  for(let c = 0; c < 6; ++c){
    const patch = composer._cascadePatchSizes[c];
    su.srCascadeOffset.value[c].copy(offsets[c]);
    su.srCascadePatch.value[c] = patch;
    su.srCascadeLod.value[c] = Math.max(0.0, Math.log2(dx / (patch / texRes)));
    //The wavelength carrying most of this cascade's energy, as WaveMask picks it.
    let kRep = kp;
    if(bandLo && bandHi) kRep = Math.min(bandHi[c], Math.max(bandLo[c], kp));
    const cells = (2.0 * Math.PI / Math.max(kRep, 1e-6)) / dx;
    const t = Math.min(1.0, Math.max(0.0, (cells - SR.RESOLVE_LO) / (SR.RESOLVE_HI - SR.RESOLVE_LO)));
    su.srCascadeWeight.value[c] = t * t * (3.0 - 2.0 * t) * composer.waveHeightMultiplier;
  }
  this._draw(this._stepMaterial, this._state[1 - this._read]);
  this._read = 1 - this._read;
  this.stepCount++;
  this.renderer.setRenderTarget(prevRT);
};

//What the consumer chunk needs (ShoreReflection.writeUniforms).
ARestlessOcean.Passes.ShoreReflectionPass.prototype.consumerState = function(){
  const s = this._consumer || (this._consumer = {});
  s.enabled = this.active;
  s.texture = this._state ? this._state[this._read].texture : null;
  s.centerX = this.centerX;
  s.centerZ = this.centerZ;
  s.halfWidth = this.grid ? this.grid.halfWidth : 1.0;
  s.dx = this.grid ? this.grid.dx : 1.0;
  s.heightScale = this.heightScale;
  return s;
};

//Debug: synchronous read of the current state and medium (two 512² float reads;
//stalls the GPU). Returns {state, medium, res, centerX, centerZ, dx} or null.
ARestlessOcean.Passes.ShoreReflectionPass.prototype.readback = function(){
  if(!this._state || !this.grid) return null;
  const RES = ARestlessOcean.ShoreReflection.RESOLUTION;
  const gl = this.renderer.getContext();
  const prevPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  if(prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const state = new Float32Array(RES * RES * 4);
  const medium = new Float32Array(RES * RES * 4);
  this.renderer.readRenderTargetPixels(this._state[this._read], 0, 0, RES, RES, state);
  this.renderer.readRenderTargetPixels(this._medium, 0, 0, RES, RES, medium);
  if(prevPack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPack);
  return {state: state, medium: medium, res: RES, centerX: this.centerX, centerZ: this.centerZ, dx: this.grid.dx};
};

ARestlessOcean.Passes.ShoreReflectionPass.prototype.dispose = function(){
  if(this._state) this._state.forEach(function(t){ t.dispose(); });
  if(this._medium) this._medium.dispose();
  [this._stepMaterial, this._bakeMaterial, this._clearMaterial].forEach(function(m){ if(m) m.dispose(); });
};
