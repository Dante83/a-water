//── SwellArrivalPass ───────────────────────────────────────────────────────
//
//WHERE THE SHORE BREAKERS COME FROM. ShoreBreaker (ocean-wave-field.js) used to
//take its crest phase from the distance to the NEAREST shoreline (the field's
//jump-flooded shoreSDF): θ = ωt + (s/h)·I(k0h). Every wet/dry edge seeds that
//distance, so every island, rock and dry speck on a flat sent out its own rings,
//an inlet broke outward from its medial axis onto both walls, and a pond at sea
//level got full surf (a-water-explorer on sunken-shores, Dante 2026-10-24). The
//wind direction only dimmed the height, and only to zero on an exact lee shore.
//
//This pass solves what that phase was standing in for: the TRAVEL TIME of the
//incoming swell, τ(x) = ∫ ds / c(h), from open deep water in the wave direction,
//through water only. The breaker's phase is then θ = ω(t − τ). So the crests
//come in from the sea, bend toward the shore as they shoal (refraction), wrap
//round islands into their lee, run up a channel from its mouth, and never reach
//water the sea does not reach (enclosed ponds, puddles below sea level).
//
//THE SOLVE (cascade 1's grid: 512² at 4 m, ±1024 m, the field the phase reads)
//  * Static (one draw per solve, a SNAPSHOT so a refill mid-solve cannot tear it):
//    r = depth, g = passable, b = seed, a = shoreSDF. Passable = wet, within 0.5 m
//    of sea level and not flowing (a river is a wall; the sea does not run up it).
//    Seed = passable, deep (k0h ≥ SEED_K0H, where c is within a few % of the deep
//    speed) or on the cascade's upwind rim, AND EXPOSED: a march upwind across
//    cascades 1 and 2 meets no dry ground. Deep water in an island's shadow is
//    not a seed; the relax fills it from the shadow's edges, a cheap stand-in for
//    diffraction.
//    Rim seeds are a FALLBACK: only when the cascade holds no exposed deep water at all
//    (a two-step max reduction of the deep flag decides, on the GPU). The rim's own δ is
//    unknown, and δ = 0 there is too EARLY over a shelf: rim fronts beat the deep water's
//    refracted ones and laid a second, wrongly angled train over them (node test 1).
//  * Relax: Jacobi iterations of the first-order Godunov eikonal update
//    |∇τ| = 1/c(h) over passable texels. Godunov rather than a chamfer: it is
//    exact for a plane wave at any angle, so straight crests stay straight. The
//    information front moves one texel per iteration; TOTAL_ITERS covers any path
//    a 512² grid can hold short of a maze, ITERS_PER_FRAME spreads them out.
//  * Finish (three draws): writes the DISPLAY target the shaders sample, E blurred
//    (E_BLUR_L0) through the two state targets the relax no longer needs. Dry texels
//    take the state of the water at their nearest shore point (stepping along
//    ∇shoreSDF), so the swash on a pond's beach reads the pond, which is
//    unreached, rather than the sea behind it.
//
//STATE, per texel: (δ, Hlim, E, surf)
//  δ    = τ − dot(xz, dir) / cDeep, seconds: the arrival delay relative to a
//         deep-water plane wave. World-anchored and small, so two solves agree
//         where the water agrees, and the swap between them does not move a
//         crest. Seeds are δ = 0.
//  Hlim = the largest height that got past the shallowest water on the way in,
//         min(γ·h) along the path. A wave that broke on a bar arrives in the
//         lagoon behind it small. 0 where unreached.
//  E    = the energy fraction for the direction the front has turned through
//         from `dir`, f(α)² with f the cos² spread factor the breaker already
//         used (1 head-on, ½ at 90°, 0 reversed). Squared: a front that has
//         wrapped 90° round an island is a lee, not half a sea. 0 where unreached.
//  surf = metres travelled through water shallower than the deep-water Hs breaks
//         in (Hs/γ): the breaker loses height along it (SURF_DECAY_M in
//         ShoreBreaker), so a wide flat is a dying bore, not white from end to end.
//
//WHEN IT SOLVES. Only when something it depends on moved: cascade 1 recentred
//by RECENTRE_M or more, the field was invalidated (tile arrivals), or the wave
//direction / ω / Hs / sea level changed past the thresholds below. A solve runs
//to completion against its snapshot and then swaps in; the shaders keep reading
//the previous solve, at ITS centre, until then. Idle frames cost nothing.
//
//COST. Static: one draw with ~72 taps per texel, plus two small reduction draws. Relax: a 5-tap draw at 512², ITERS_PER_FRAME
//of them per solving frame. Memory: 2 × state + static + 2 × display, RGBA32F,
//≈ 21 MB.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.SwellArrivalPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.enabled = true;
  this.itersPerFrame = ARestlessOcean.Passes.SwellArrivalPass.ITERS_PER_FRAME;
  this._solve = null;      //the solve in progress: its parameters and iteration count
  this._display = null;    //the finished solve the shaders read: {target, centerX, ...}
  this._displayIndex = 0;
  this.solveCount = 0;     //debug
};

ARestlessOcean.Passes.SwellArrivalPass.ITERS_PER_FRAME = 24;
ARestlessOcean.Passes.SwellArrivalPass.TOTAL_ITERS = 768;
//Re-solve when cascade 1 has moved this far from the displayed solve's centre (m).
ARestlessOcean.Passes.SwellArrivalPass.RECENTRE_M = 64.0;
ARestlessOcean.Passes.SwellArrivalPass.DIR_EPS_COS = Math.cos(2.0 * Math.PI / 180.0);
ARestlessOcean.Passes.SwellArrivalPass.OMEGA_REL = 0.03;
ARestlessOcean.Passes.SwellArrivalPass.HS_REL = 0.1;
//Seeds are water at least this deep in k0h (tanh 1.5 = 0.905: c within ~5% of deep).
ARestlessOcean.Passes.SwellArrivalPass.SEED_K0H = 1.5;
ARestlessOcean.Passes.SwellArrivalPass.SEED_DEPTH_MIN = 6.0;   //m
ARestlessOcean.Passes.SwellArrivalPass.SEED_DEPTH_MAX = 40.0;  //m; a-land decodes depth up to 60
//Water this close to sea level is the sea (the breaker's own `inland` gate starts here).
ARestlessOcean.Passes.SwellArrivalPass.SEA_LEVEL_TOL = 0.5;
ARestlessOcean.Passes.SwellArrivalPass.INF = 1.0e9;
//E is set per texel from the LOCAL front direction, so it jumps wherever two arrivals meet
//(a τ crease: behind an island, across a channel). The finished E is Gaussian-blurred with
//σ = E_BLUR_L0 × the deep-water wavelength (clamped to E_BLUR_MIN_M..E_BLUR_MAX_M), about the
//width a real shadow edge diffracts over. Unblurred, the WaveMask shelter cut the ocean from
//full to flat in one texel (browser round 4, 2026-10-24).
ARestlessOcean.Passes.SwellArrivalPass.E_BLUR_L0 = 0.35;
ARestlessOcean.Passes.SwellArrivalPass.E_BLUR_MIN_M = 12.0;
ARestlessOcean.Passes.SwellArrivalPass.E_BLUR_MAX_M = 64.0;

ARestlessOcean.Passes.SwellArrivalPass.prototype.init = function(){
  const RES = ARestlessOcean.Passes.WaterFieldPass.RESOLUTION;
  const field = this.oceanGrid.waterFieldPass;
  const linear = field && field.floatLinearSupported ? THREE.LinearFilter : THREE.NearestFilter;
  const make = function(filter){
    return new THREE.WebGLRenderTarget(RES, RES, {
      minFilter: filter,
      magFilter: filter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });
  };
  this._static = make(THREE.NearestFilter);
  this._state = [make(THREE.NearestFilter), make(THREE.NearestFilter)];
  this._displayTargets = [make(linear), make(linear)];
  //Max reduction of the deep-seed flag: 512² -> 16² -> 1² (see the header).
  const small = function(n){
    return new THREE.WebGLRenderTarget(n, n, {minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: THREE.FloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false});
  };
  this._reduce = [small(16), small(1)];

  this._scene = new THREE.Scene();
  this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  this._mesh.frustumCulled = false;
  this._scene.add(this._mesh);

  const SB = ARestlessOcean.ShoreBreaker;
  const SAP = ARestlessOcean.Passes.SwellArrivalPass;
  const f = function(v){ return (+v).toFixed(6); };
  const vertexShader = [
    'void main(){',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');
  const head = [
    'precision highp float;',
    'const int RES = ' + RES + ';',
    'const float INF = ' + SAP.INF.toExponential(1) + ';'
  ].join('\n');

  //Static snapshot + seeds (see the header).
  this._seedMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uField1: {value: null}, uField2: {value: null},
      uCenter1: {value: new THREE.Vector2()}, uHalfWidth1: {value: 1024.0},
      uCenter2: {value: new THREE.Vector2()}, uHalfWidth2: {value: 4096.0},
      uDir: {value: new THREE.Vector2(1, 0)},
      uSeaLevel: {value: 0.0}, uSeedDepth: {value: 20.0}
    },
    vertexShader: vertexShader,
    fragmentShader: [
      head,
      'layout(location = 0) out vec4 oStatic;',
      'uniform sampler2D uField1, uField2;',
      'uniform vec2 uCenter1, uCenter2, uDir;',
      'uniform float uHalfWidth1, uHalfWidth2, uSeaLevel, uSeedDepth;',
      //Depth of a cascade at a world point by its nearest texel; -1 outside it.
      'float depthIn(sampler2D tex, vec2 centre, float hw, vec2 xz){',
      '  vec2 uv = (xz - centre) / (2.0 * hw) + 0.5;',
      '  if(any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return -1.0;',
      '  return texelFetch(tex, ivec2(uv * float(RES)), 0).g;',
      '}',
      //True when the march upwind from xz meets dry ground: 32 taps at 8 m over cascade 1,
      //then 40 at 64 m over cascade 2 (≈ 2.8 km in all). Off both cascades counts as open.
      'bool shadowed(vec2 xz){',
      '  for(int k = 1; k <= 32; k++){',
      '    float d = depthIn(uField1, uCenter1, uHalfWidth1, xz - uDir * (8.0 * float(k)));',
      '    if(d < -0.5) break;',
      '    if(d <= 0.0) return true;',
      '  }',
      '  for(int k = 1; k <= 40; k++){',
      '    float d = depthIn(uField2, uCenter2, uHalfWidth2, xz - uDir * (256.0 + 64.0 * float(k)));',
      '    if(d < -0.5) return false;',
      '    if(d <= 0.0) return true;',
      '  }',
      '  return false;',
      '}',
      'void main(){',
      '  ivec2 p = ivec2(gl_FragCoord.xy);',
      '  vec4 a = texelFetch(uField1, p, 0);',
      '  float h = a.g;',
      //Wet, the sea's level, and not flowing (wet texels pack -flowWeight in .a).
      '  bool passable = h > 0.0 && abs(a.r - uSeaLevel) < ' + f(SAP.SEA_LEVEL_TOL) + ' && a.a > -0.5;',
      '  float seedKind = 0.0;',
      '  if(passable){',
      '    bool rim = (p.x == 0 && uDir.x > 0.1) || (p.x == RES - 1 && uDir.x < -0.1)',
      '            || (p.y == 0 && uDir.y > 0.1) || (p.y == RES - 1 && uDir.y < -0.1);',
      '    if(h >= uSeedDepth || rim){',
      '      vec2 xz = uCenter1 + ((vec2(p) + 0.5) / float(RES) - 0.5) * (2.0 * uHalfWidth1);',
      '      if(!shadowed(xz)) seedKind = h >= uSeedDepth ? 1.0 : 2.0;',
      '    }',
      '  }',
      //b: 0 none, 1 deep seed, 2 rim seed (used only when no texel is 1; see the header).
      '  oStatic = vec4(h, passable ? 1.0 : 0.0, seedKind, a.b);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });

  //r = 1 where any source texel in this block is a deep seed (static b == 1).
  this._reduceMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {uSrc: {value: null}, uBlock: {value: 32}, uFromStatic: {value: 1.0}},
    vertexShader: vertexShader,
    fragmentShader: [
      head,
      'layout(location = 0) out vec4 oMax;',
      'uniform sampler2D uSrc;',
      'uniform int uBlock;',
      'uniform float uFromStatic;',
      'void main(){',
      '  ivec2 base = ivec2(gl_FragCoord.xy) * uBlock;',
      '  float m = 0.0;',
      '  for(int j = 0; j < 32; j++){',
      '    if(j >= uBlock) break;',
      '    for(int i = 0; i < 32; i++){',
      '      if(i >= uBlock) break;',
      '      vec4 t = texelFetch(uSrc, base + ivec2(i, j), 0);',
      '      m = max(m, uFromStatic > 0.5 ? (abs(t.b - 1.0) < 0.5 ? 1.0 : 0.0) : t.r);',
      '    }',
      '  }',
      '  oMax = vec4(m, 0.0, 0.0, 1.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });

  //Seeds carry surf = -1 in the state so the relax can tell them (see main below).
  this._initMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {uStatic: {value: null}, uHasDeep: {value: null}},
    vertexShader: vertexShader,
    fragmentShader: [
      head,
      'layout(location = 0) out vec4 oState;',
      'uniform sampler2D uStatic, uHasDeep;',
      'void main(){',
      '  vec4 st = texelFetch(uStatic, ivec2(gl_FragCoord.xy), 0);',
      '  bool hasDeep = texelFetch(uHasDeep, ivec2(0), 0).r > 0.5;',
      '  bool seed = abs(st.b - 1.0) < 0.5 || (!hasDeep && st.b > 1.5);',
      '  oState = seed ? vec4(0.0, 1.0e4, 1.0, -1.0) : vec4(INF, 0.0, 0.0, 0.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });

  //One Jacobi sweep of the Godunov update (see the header). Neighbour arrival times are
  //taken in THIS texel's frame: δ_n + (plane(n) − plane(p)), so the plane offset is the
  //constant ±texel·dir/cDeep and no world coordinate enters the arithmetic.
  this._relaxMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uStatic: {value: null}, uState: {value: null},
      uTexel: {value: 4.0}, uOff: {value: new THREE.Vector2()},
      uDir: {value: new THREE.Vector2(1, 0)},
      uOmega: {value: 1.0}, uHb: {value: 1.0}
    },
    vertexShader: vertexShader,
    fragmentShader: [
      head,
      'layout(location = 0) out vec4 oState;',
      'uniform sampler2D uStatic, uState;',
      'uniform float uTexel, uOmega, uHb;',
      'uniform vec2 uOff, uDir;',
      //Phase speed c = ω/k with Eckart\'s kh ≈ k0h / sqrt(tanh k0h), as ShoreBreaker uses.
      'float speedAt(float h){',
      '  h = max(h, ' + f(SB.MIN_DEPTH) + ');',
      '  float X = uOmega * uOmega / ' + f(SB.G) + ' * h;',
      //tanh written out overflow-free (as shoreBreakerTanh): the built-in is NaN past X ≈ 44 on
      //some drivers (SwiftShader), and off-world water decodes 1000 m deep. A NaN arrival reads
      //as unreached, so an island's whole deep shadow went black (browser round 4, 2026-10-24).
      '  float e = exp(-2.0 * X);',
      '  return uOmega * h * sqrt((1.0 - e) / (1.0 + e)) / X;',
      '}',
      'vec4 nb(ivec2 q, float off, out float t){',
      '  t = INF;',
      '  if(q.x < 0 || q.y < 0 || q.x >= RES || q.y >= RES) return vec4(0.0);',
      '  if(texelFetch(uStatic, q, 0).g < 0.5) return vec4(0.0);',
      '  vec4 s = texelFetch(uState, q, 0);',
      '  if(s.r < 0.5 * INF) t = s.r + off;',
      '  return s;',
      '}',
      'void main(){',
      '  ivec2 p = ivec2(gl_FragCoord.xy);',
      '  vec4 st = texelFetch(uStatic, p, 0);',
      '  vec4 own = texelFetch(uState, p, 0);',
      '  if(own.a < -0.5){ oState = own; return; }',   //a seed
      '  if(st.g < 0.5){ oState = vec4(INF, 0.0, 0.0, 0.0); return; }',
      '  float tL, tR, tD, tU;',
      '  vec4 sL = nb(p - ivec2(1, 0), -uOff.x, tL);',
      '  vec4 sR = nb(p + ivec2(1, 0),  uOff.x, tR);',
      '  vec4 sD = nb(p - ivec2(0, 1), -uOff.y, tD);',
      '  vec4 sU = nb(p + ivec2(0, 1),  uOff.y, tU);',
      '  bool fromL = tL <= tR, fromD = tD <= tU;',
      '  float a = min(tL, tR), b = min(tD, tU);',
      '  vec4 sa = fromL ? sL : sR, sb = fromD ? sD : sU;',
      '  if(min(a, b) >= 0.5 * INF){ oState = vec4(INF, 0.0, 0.0, 0.0); return; }',
      '  float nd = uTexel / speedAt(st.r);',
      '  float t, wa, wb;',
      '  if(abs(a - b) >= nd){',
      '    if(a < b){ t = a + nd; wa = 1.0; wb = 0.0; } else { t = b + nd; wa = 0.0; wb = 1.0; }',
      '  } else {',
      '    t = 0.5 * (a + b + sqrt(2.0 * nd * nd - (a - b) * (a - b)));',
      '    wa = t - a; wb = t - b;',
      '    float ws = wa + wb; wa /= ws; wb /= ws;',
      '  }',
      //Direction of travel: the upwind gradient (the update satisfies |g| = 1/c).
      '  vec2 g = vec2(wa > 0.0 ? (t - a) * (fromL ? 1.0 : -1.0) : 0.0,',
      '                wb > 0.0 ? (t - b) * (fromD ? 1.0 : -1.0) : 0.0);',
      '  float gl = length(g);',
      '  vec2 dirP = gl > 0.0 ? g / gl : uDir;',
      '  float alpha = acos(clamp(dot(dirP, uDir), -1.0, 1.0));',
      '  float fa = clamp(1.0 - alpha / 3.14159265 + sin(2.0 * alpha) / 6.2831853, 0.0, 1.0);',
      '  float hSrc = (wa > 0.0 && wb > 0.0) ? min(sa.g, sb.g) : (wa > 0.0 ? sa.g : sb.g);',
      '  float hlim = min(hSrc, ' + f(SB.GAMMA) + ' * max(st.r, ' + f(SB.MIN_DEPTH) + '));',
      '  float surf = wa * max(sa.a, 0.0) + wb * max(sb.a, 0.0) + (st.r < uHb ? uTexel : 0.0);',
      '  oState = vec4(t, hlim, fa * fa, surf);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });

  //The display target (see the header): passable and reached keeps its state; dry ground
  //takes the state of the water across its nearest shore point; anything else is zero.
  this._finishMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {uStatic: {value: null}, uState: {value: null}, uTexel: {value: 4.0}},
    vertexShader: vertexShader,
    fragmentShader: [
      head,
      'layout(location = 0) out vec4 oSwell;',
      'uniform sampler2D uStatic, uState;',
      'uniform float uTexel;',
      'vec4 st(ivec2 q){ return texelFetch(uStatic, clamp(q, ivec2(0), ivec2(RES - 1)), 0); }',
      'vec4 reachedAt(ivec2 q){',
      '  q = clamp(q, ivec2(0), ivec2(RES - 1));',
      '  if(texelFetch(uStatic, q, 0).g < 0.5) return vec4(0.0);',
      '  vec4 s = texelFetch(uState, q, 0);',
      '  return s.r < 0.5 * INF ? vec4(s.rgb, max(s.a, 0.0)) : vec4(0.0);',
      '}',
      'void main(){',
      '  ivec2 p = ivec2(gl_FragCoord.xy);',
      '  vec4 s0 = st(p);',
      '  if(s0.g > 0.5){ oSwell = reachedAt(p); return; }',
      '  if(s0.r > 0.0){ oSwell = vec4(0.0); return; }',   //wet but not the sea (a river, a lake)
      //Dry: shoreSDF is negative here and grows toward the water.
      '  vec2 grad = vec2(st(p + ivec2(1, 0)).a - st(p - ivec2(1, 0)).a, st(p + ivec2(0, 1)).a - st(p - ivec2(0, 1)).a);',
      '  float gl = length(grad);',
      '  if(gl < 1e-6){ oSwell = vec4(0.0); return; }',
      '  vec2 q = vec2(p) + (grad / gl) * (max(-s0.a, 0.0) / uTexel + 1.0);',
      '  oSwell = reachedAt(ivec2(floor(q + 0.5)));',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });

  //One axis of the E blur (see E_BLUR_L0); the other channels pass through. On the second
  //axis (uMask) unreached texels (Hlim 0) are put back to 0, so a pond near the sea stays calm.
  this._blurMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {uSrc: {value: null}, uAxis: {value: new THREE.Vector2(1, 0)}, uSigma: {value: 4.0}, uMask: {value: 0.0}},
    vertexShader: vertexShader,
    fragmentShader: [
      head,
      'layout(location = 0) out vec4 oSwell;',
      'uniform sampler2D uSrc;',
      'uniform vec2 uAxis;',
      'uniform float uSigma, uMask;',
      'const int MAX_R = ' + Math.ceil(3.0 * SAP.E_BLUR_MAX_M / 2.0) + ';',
      'void main(){',
      '  ivec2 p = ivec2(gl_FragCoord.xy);',
      '  vec4 own = texelFetch(uSrc, p, 0);',
      '  int r = min(int(ceil(3.0 * uSigma)), MAX_R);',
      '  ivec2 ax = ivec2(uAxis);',
      '  float se = 0.0, sw = 0.0;',
      '  for(int k = -MAX_R; k <= MAX_R; k++){',
      '    if(k < -r || k > r) continue;',
      '    float w = exp(-0.5 * float(k * k) / (uSigma * uSigma));',
      '    se += w * texelFetch(uSrc, clamp(p + ax * k, ivec2(0), ivec2(RES - 1)), 0).b;',
      '    sw += w;',
      '  }',
      '  float e = se / sw;',
      '  if(uMask > 0.5 && own.g <= 0.0) e = 0.0;',
      '  oSwell = vec4(own.r, own.g, e, own.a);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });
};

//σ of the E blur in texels for this ω (see E_BLUR_L0).
ARestlessOcean.Passes.SwellArrivalPass.blurSigmaFor = function(omega, texel){
  const SAP = ARestlessOcean.Passes.SwellArrivalPass;
  const L0 = 2.0 * Math.PI * ARestlessOcean.ShoreBreaker.G / Math.max(omega * omega, 1e-6);
  return Math.min(SAP.E_BLUR_MAX_M, Math.max(SAP.E_BLUR_MIN_M, SAP.E_BLUR_L0 * L0)) / texel;
};

ARestlessOcean.Passes.SwellArrivalPass.prototype._draw = function(material, target){
  this._mesh.material = material;
  this.renderer.setRenderTarget(target);
  this.renderer.render(this._scene, this._camera);
};

//Seed depth for this ω (see SEED_K0H).
ARestlessOcean.Passes.SwellArrivalPass.seedDepthFor = function(omega){
  const SAP = ARestlessOcean.Passes.SwellArrivalPass;
  const k0 = omega * omega / ARestlessOcean.ShoreBreaker.G;
  return Math.min(SAP.SEED_DEPTH_MAX, Math.max(SAP.SEED_DEPTH_MIN, SAP.SEED_K0H / Math.max(k0, 1e-6)));
};

//True when the displayed solve no longer answers for these inputs.
ARestlessOcean.Passes.SwellArrivalPass.prototype._dirty = function(field, c1, p, seaLevel){
  const SAP = ARestlessOcean.Passes.SwellArrivalPass;
  const d = this._display;
  if(!d) return true;
  if(field.invalidationCount !== d.invalidationCount) return true;
  if(Math.max(Math.abs(c1.centerX - d.centerX), Math.abs(c1.centerZ - d.centerZ)) >= SAP.RECENTRE_M) return true;
  if(p.waveDirX * d.dirX + p.waveDirZ * d.dirZ < SAP.DIR_EPS_COS) return true;
  if(Math.abs(p.omega - d.omega) > SAP.OMEGA_REL * d.omega) return true;
  if(Math.abs(p.Hs - d.Hs) > SAP.HS_REL * Math.max(d.Hs, 0.1)) return true;
  if(Math.abs(seaLevel - d.seaLevel) > 0.01) return true;
  return false;
};

ARestlessOcean.Passes.SwellArrivalPass.prototype._start = function(field, c1, p, seaLevel){
  const c2 = field.cascades[2];
  const s = this._solve = {
    centerX: c1.centerX, centerZ: c1.centerZ, halfWidth: c1.halfWidth, texel: c1.texel,
    dirX: p.waveDirX, dirZ: p.waveDirZ, omega: p.omega, Hs: p.Hs, seaLevel: seaLevel,
    deepC: ARestlessOcean.ShoreBreaker.G / p.omega,
    invalidationCount: field.invalidationCount,
    iter: 0, read: 0
  };
  const su = this._seedMaterial.uniforms;
  su.uField1.value = c1.target.textures[0];
  su.uField2.value = c2.target.textures[0];
  su.uCenter1.value.set(c1.centerX, c1.centerZ);
  su.uHalfWidth1.value = c1.halfWidth;
  su.uCenter2.value.set(c2.centerX, c2.centerZ);
  su.uHalfWidth2.value = c2.halfWidth;
  su.uDir.value.set(s.dirX, s.dirZ);
  su.uSeaLevel.value = seaLevel;
  su.uSeedDepth.value = ARestlessOcean.Passes.SwellArrivalPass.seedDepthFor(s.omega);
  this._draw(this._seedMaterial, this._static);
  const ru = this._reduceMaterial.uniforms;
  ru.uSrc.value = this._static.texture; ru.uBlock.value = 32; ru.uFromStatic.value = 1.0;
  this._draw(this._reduceMaterial, this._reduce[0]);
  ru.uSrc.value = this._reduce[0].texture; ru.uBlock.value = 16; ru.uFromStatic.value = 0.0;
  this._draw(this._reduceMaterial, this._reduce[1]);
  this._initMaterial.uniforms.uStatic.value = this._static.texture;
  this._initMaterial.uniforms.uHasDeep.value = this._reduce[1].texture;
  this._draw(this._initMaterial, this._state[0]);
};

//ctx: {params (ShoreBreaker.paramsFrom), seaLevel}
ARestlessOcean.Passes.SwellArrivalPass.prototype.tick = function(ctx){
  const field = this.oceanGrid.waterFieldPass;
  const p = ctx.params;
  if(!this.enabled || !field || field.cascades.length !== 3 || !p || !p.enabled) return;
  const c1 = field.cascades[1], c2 = field.cascades[2];
  if(c1.centerX === undefined || c2.centerX === undefined) return;

  const SAP = ARestlessOcean.Passes.SwellArrivalPass;
  const prevRT = this.renderer.getRenderTarget();
  if(!this._solve && this._dirty(field, c1, p, ctx.seaLevel)) this._start(field, c1, p, ctx.seaLevel);
  const s = this._solve;
  if(s){
    const ru = this._relaxMaterial.uniforms;
    ru.uStatic.value = this._static.texture;
    ru.uTexel.value = s.texel;
    ru.uOff.value.set(s.texel * s.dirX / s.deepC, s.texel * s.dirZ / s.deepC);
    ru.uDir.value.set(s.dirX, s.dirZ);
    ru.uOmega.value = s.omega;
    ru.uHb.value = s.Hs / ARestlessOcean.ShoreBreaker.GAMMA;
    const n = Math.min(this.itersPerFrame, SAP.TOTAL_ITERS - s.iter);
    for(let i = 0; i < n; ++i){
      ru.uState.value = this._state[s.read].texture;
      this._draw(this._relaxMaterial, this._state[1 - s.read]);
      s.read = 1 - s.read;
    }
    s.iter += n;
    if(s.iter >= SAP.TOTAL_ITERS){
      const next = 1 - this._displayIndex;
      const fu = this._finishMaterial.uniforms;
      fu.uStatic.value = this._static.texture;
      fu.uState.value = this._state[s.read].texture;
      fu.uTexel.value = s.texel;
      //The relax is done with both state targets: finish into one, blur E through the other
      //and out to the display (see E_BLUR_L0).
      const tmpA = this._state[1 - s.read], tmpB = this._state[s.read];
      this._draw(this._finishMaterial, tmpA);
      const bu = this._blurMaterial.uniforms;
      bu.uSigma.value = SAP.blurSigmaFor(s.omega, s.texel);
      bu.uSrc.value = tmpA.texture; bu.uAxis.value.set(1, 0); bu.uMask.value = 0.0;
      this._draw(this._blurMaterial, tmpB);
      bu.uSrc.value = tmpB.texture; bu.uAxis.value.set(0, 1); bu.uMask.value = 1.0;
      this._draw(this._blurMaterial, this._displayTargets[next]);
      this._displayIndex = next;
      s.target = this._displayTargets[next];
      this._display = s;
      this._solve = null;
      this.solveCount++;
    }
  }
  this.renderer.setRenderTarget(prevRT);
};

//Adds the displayed solve to a ShoreBreaker params object (ShoreBreaker.writeUniforms
//carries it to every consumer). swellOn = 0 until the first solve lands; the breaker
//then keeps its old shore-distance phase.
ARestlessOcean.Passes.SwellArrivalPass.prototype.writeParams = function(p){
  if(!p) return;
  const d = this.enabled ? this._display : null;
  p.swellOn = d ? 1.0 : 0.0;
  p.swellTexture = d ? d.target.texture : null;
  p.swellCenterX = d ? d.centerX : 0.0;
  p.swellCenterZ = d ? d.centerZ : 0.0;
  p.swellHalfWidth = d ? d.halfWidth : 1024.0;
  p.swellDirX = d ? d.dirX : 1.0;
  p.swellDirZ = d ? d.dirZ : 0.0;
  p.swellDeepC = d ? d.deepC : 1.0;
};

//Drop the displayed solve and start over on the next tick.
ARestlessOcean.Passes.SwellArrivalPass.prototype.invalidate = function(){
  this._display = null;
  this._solve = null;
};

//Reads the displayed solve back (synchronous; debug only). Returns
//{data: Float32Array RES²×4, res, centerX, centerZ, halfWidth, dirX, dirZ, deepC, omega} or null.
ARestlessOcean.Passes.SwellArrivalPass.prototype.read = function(){
  const d = this._display;
  if(!d) return null;
  const RES = ARestlessOcean.Passes.WaterFieldPass.RESOLUTION;
  const data = new Float32Array(RES * RES * 4);
  this.renderer.readRenderTargetPixels(d.target, 0, 0, RES, RES, data);
  return {data: data, res: RES, centerX: d.centerX, centerZ: d.centerZ, halfWidth: d.halfWidth,
    dirX: d.dirX, dirZ: d.dirZ, deepC: d.deepC, omega: d.omega};
};

ARestlessOcean.Passes.SwellArrivalPass.prototype.dispose = function(){
  this._static.dispose();
  this._state[0].dispose(); this._state[1].dispose();
  this._displayTargets[0].dispose(); this._displayTargets[1].dispose();
  this._reduce[0].dispose(); this._reduce[1].dispose();
  for(const m of [this._seedMaterial, this._reduceMaterial, this._initMaterial, this._relaxMaterial, this._finishMaterial, this._blurMaterial]) m.dispose();
  this._mesh.geometry.dispose();
};
