//── LandLight ────────────────────────────────────────────────────────────────
//
//THE LAND'S LIGHT OCCLUSION, for white water. Foam, the waterfall curtain and the foot's mist are
//bright, near-white surfaces, and they were lit by the WHOLE sky and an unshadowed sun or moon:
//a fall at the back of a gorge sees a third of the sky, and at night, with the moon behind the
//cliff, it glowed while the cliff beside it, lit by a-land with its occlusion baked in, went black
//(Dante, 2026-10-02). a-faraway-land already has the answer for its own objects, and hands it out
//read-only (ObjectMaterial.siblingLight()):
//  horizon   its baked skyline angles: K azimuth bins per texel, the land's shadow on a light at
//            infinity in one lookup (shaders.js horizonShadow, HorizonShadow.js; keep in step).
//  ground    its world-space lightmap: A = SKY VISIBILITY (the cosine-weighted share of the sky
//            the ground there sees), R ao, GB bent normal.
//Both are taken at the GROUND: a point above it (a curtain's upper half over the pool) sees a little
//more sky and a lower skyline than they say, so the occlusion is a little too strong up there; the
//texels are metres, so a gorge reads right and a pebble does not.
//
//GLSL: `GLSL`, spliced at //LAND_LIGHT_INJECTION_POINT in the water, sheet, mist, splash and cloud shaders
//by ARestlessOcean.spliceLandLight (a stub of the same names where this file is not loaded), giving
//  float landLightVisibility(vec3 p, vec3 L)   the land's shadow on a light at infinity (L toward it)
//  float landSkyVisibility(vec2 xz)            the share of the sky the ground at xz sees
//  ...Open(...)                                 the most open of the point and four neighbours 4 m away, for water
//                                              standing in the air (a curtain, mist), not lying on the ground
//both 1 with no a-land, off its footprint, or with `enabled` false.
//UNIFORMS: the water material owns the objects; update(uniforms) refreshes them every frame (ocean-grid
//per-frame loop) and the curtain and foot volumes alias them (SHARED_UNIFORMS).
//
//Console: ARestlessOcean.LandLight.enabled = false (A/B), .stats().
ARestlessOcean.LandLight = ARestlessOcean.LandLight || {
  enabled: true,
  _last: null
};

(function(LL){
  LL.UNIFORM_NAMES = ['landHorizonTex', 'landHorizonAtlas', 'landHorizonFrame', 'landHorizonParams',
                      'landGroundTex', 'landGroundFrame', 'landLightOn'];

  LL.createUniforms = function(){
    return {
      landHorizonTex: {value: null},
      landHorizonAtlas: {value: new THREE.Vector4(1, 1, 1, 1)},
      landHorizonFrame: {value: new THREE.Vector4(0, 0, 1, 1)},
      landHorizonParams: {value: new THREE.Vector2(24, 0.03)},
      landGroundTex: {value: null},
      landGroundFrame: {value: new THREE.Vector4(0, 0, 1, 1)},
      landLightOn: {value: new THREE.Vector2(0, 0)}
    };
  };

  //Refresh a material's land-light uniforms from a-land (call every frame; it is a handful of writes).
  LL.update = function(u){
    if(!u || !u.landLightOn) return;
    let s = null;
    if(LL.enabled && typeof ALand !== 'undefined' && ALand.runtime && ALand.runtime.ObjectMaterial
       && typeof ALand.runtime.ObjectMaterial.siblingLight === 'function'){
      try { s = ALand.runtime.ObjectMaterial.siblingLight(); } catch(e){ s = null; }
    }
    LL._last = s;
    const h = s && s.horizon, g = s && s.ground;
    if(h){
      u.landHorizonTex.value = h.tex;
      u.landHorizonAtlas.value.copy(h.atlas);
      u.landHorizonFrame.value.set(h.origin.x, h.origin.y, h.extent.x, h.extent.y);
      u.landHorizonParams.value.set(h.K, h.soft);
    }
    else u.landHorizonTex.value = null;
    if(g){
      u.landGroundTex.value = g.tex;
      u.landGroundFrame.value.set(g.origin.x, g.origin.y, g.extent.x, g.extent.y);
    }
    else u.landGroundTex.value = null;
    u.landLightOn.value.set(h ? 1 : 0, g ? 1 : 0);
  };

  LL.stats = function(){
    const s = LL._last;
    return {enabled: LL.enabled, horizon: !!(s && s.horizon), ground: !!(s && s.ground),
            horizonK: s && s.horizon ? s.horizon.K : null,
            alandGetter: typeof ALand !== 'undefined' && !!(ALand.runtime && ALand.runtime.ObjectMaterial && ALand.runtime.ObjectMaterial.siblingLight)};
  };

  LL.GLSL = [
    '//── LandLight (field/land-light.js): a-land\'s skyline and sky visibility ──',
    'uniform sampler2D landHorizonTex;   //R skyline angle (rad, signed), K slices in a cols x rows atlas',
    'uniform vec4 landHorizonAtlas;      //(cols, rows, slice w, slice h) texels',
    'uniform vec4 landHorizonFrame;      //(origin x, origin z, extent x, extent z) world m',
    'uniform vec2 landHorizonParams;     //(K bins, soft rad)',
    'uniform sampler2D landGroundTex;    //A sky visibility (R ao, GB bent normal)',
    'uniform vec4 landGroundFrame;       //(origin x, origin z, extent x, extent z) world m',
    'uniform vec2 landLightOn;           //(horizon, ground) 1 = live',
    'const float LAND_TWO_PI = 6.283185307179586;',
    '//One slice fetch, bilinear inside the slice (clamped half a texel in so it cannot bleed into the next bin).',
    'float landHorizonSlice(float k, vec2 uv){',
    '  float cols = landHorizonAtlas.x, rows = landHorizonAtlas.y;',
    '  vec2 sz = landHorizonAtlas.zw;',
    '  vec2 f = clamp(uv * sz - 0.5, vec2(0.0), sz - 1.0);',
    '  vec2 org = vec2(mod(k, cols), floor(k / cols)) * sz;',
    '  return textureLod(landHorizonTex, (org + f + 0.5) / (vec2(cols, rows) * sz), 0.0).r;',
    '}',
    '//The land\'s shadow on a light at infinity, L toward it (a-land shaders.js horizonShadow, keep in step).',
    'float landLightVisibility(vec3 p, vec3 L){',
    '  if(landLightOn.x < 0.5) return 1.0;',
    '  vec2 uv = (p.xz - landHorizonFrame.xy) / landHorizonFrame.zw;',
    '  if(any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;',
    '  float K = landHorizonParams.x;',
    '  float az = atan(L.x, L.z);',
    '  float alt = atan(L.y, length(L.xz));',
    '  float fb = mod(az, LAND_TWO_PI) * (K / LAND_TWO_PI);',
    '  float b0 = min(floor(fb), K - 1.0);',
    '  float b1 = b0 + 1.0 >= K ? 0.0 : b0 + 1.0;',
    '  float ang = mix(landHorizonSlice(b0, uv), landHorizonSlice(b1, uv), fb - b0);',
    '  float s = max(landHorizonParams.y, 1e-4);',
    '  return smoothstep(-s, s, alt - ang);',
    '}',
    '//The share of the sky the ground at xz sees (a-land\'s baked sky visibility).',
    'float landSkyVisibility(vec2 xz){',
    '  if(landLightOn.y < 0.5) return 1.0;',
    '  vec2 uv = (xz - landGroundFrame.xy) / landGroundFrame.zw;',
    '  if(any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;',
    '  return textureLod(landGroundTex, uv, 0.0).a;',
    '}',
    '//FOR WATER STANDING IN THE AIR (the waterfall curtain, its mist, splash and clouds): the land fields are',
    '//taken at the GROUND, and the ground at the foot of a cliff sees half the sky and a high skyline; a sheet',
    '//a few metres out, or mist over the pool, sees the open side. Each part of a fall sampled its own patch',
    '//of ground, so the curtain over the cliff foot went dark (showing only the rock behind it) while the lip',
    '//over the ledge top and the mist over the pool stayed lit (Dante, 2026-10-02). These take the MOST OPEN',
    '//of the point and four neighbours LAND_OPEN_R m away, so a fall reads the open side of its gorge, and its',
    '//parts agree.',
    'const float LAND_OPEN_R = 4.0;',
    'float landSkyVisibilityOpen(vec2 xz){',
    '  float v = landSkyVisibility(xz);',
    '  v = max(v, landSkyVisibility(xz + vec2(LAND_OPEN_R, 0.0)));',
    '  v = max(v, landSkyVisibility(xz - vec2(LAND_OPEN_R, 0.0)));',
    '  v = max(v, landSkyVisibility(xz + vec2(0.0, LAND_OPEN_R)));',
    '  return max(v, landSkyVisibility(xz - vec2(0.0, LAND_OPEN_R)));',
    '}',
    'float landLightVisibilityOpen(vec3 p, vec3 L){',
    '  float v = landLightVisibility(p, L);',
    '  v = max(v, landLightVisibility(p + vec3(LAND_OPEN_R, 0.0, 0.0), L));',
    '  v = max(v, landLightVisibility(p - vec3(LAND_OPEN_R, 0.0, 0.0), L));',
    '  v = max(v, landLightVisibility(p + vec3(0.0, 0.0, LAND_OPEN_R), L));',
    '  return max(v, landLightVisibility(p - vec3(0.0, 0.0, LAND_OPEN_R), L));',
    '}'
  ].join('\n');

})(ARestlessOcean.LandLight);
