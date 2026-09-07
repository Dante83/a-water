//── Underwater fog chunk installer ─────────────────────────────────────────
//
//Extracted from ocean-grid.js (0.2.0 lines 609-688, 2187-2493 and 2495-2519)
//as part of the Phase 0 decomposition, by mechanical rename only. See
//WATER-TYPES-PROGRESS.md for the old-line map.
//
//NOT A RENDER PASS. This is a shader-chunk installer: it runs once, writes
//global THREE.ShaderChunk.fog_* strings, and then does nothing per frame except
//one cheap scene traversal to keep a sun-direction uniform current. It carries
//the pass lifecycle purely so OceanGrid can drive every subsystem uniformly.
//
//THE PROBLEM IT SOLVES
//Geometry seen DIRECTLY underwater — the seabed, the shoreline, the boat hull —
//is drawn by its OWN materials and never touches the water shader. Without this
//it renders un-fogged and flat while the water surface right next to it is fully
//fogged, and the two read as different media.
//
//TWO PROVIDERS, ONE SLOT
//a-starry-sky's `advanced` atmospheric perspective globally patches
//THREE.ShaderChunk.fog_* and deliberately leaves an empty branch keyed on
//`fogNear < 0.0`, marked with a //$$...$$ reservation token. inject()
//string-replaces that token with our per-channel Beer-Lambert absorption fog.
//
//Standalone (no a-starry-sky), that slot never exists — so
//installStandaloneScaffold() writes a minimal fog_* scaffold carrying the SAME
//reservation tokens, and inject() then fills it unchanged. The scaffold
//deliberately does NOT replicate a-starry-sky's atmosphere; only the plumbing
//the ocean branch needs (the vFogWorldPosition varying, the sRGB helpers the
//chunk calls, the ACES operator, and a stock linear-fog else-branch).
//
//WHY POLLED RATHER THAN CALLED ONCE
//The a-starry-sky token only exists after its FogRenderer has run, which is some
//frames after we initialise. inject() is therefore called every tick and returns
//immediately once it has succeeded (or while the token is still absent).
//
//THE SMUGGLE
//THREE.Fog carries one Color and two floats, and that is the entire channel to
//the chunk. So: fog.color is the inscatter murk colour (linear, sRGB-pre-
//compensated so THREE's upload encode cancels), fog.near is -waterSurfaceY
//(negative selects the ocean branch AND carries the world-Y gate), and fog.far
//is the sun/sky inscatter split — with a +10 offset marking the linear RT pass.
//fog.far must never be <= 0: a-starry-sky routes that into its atmospheric
//branch before ever reaching ours. See reflection-pass.js for the full story.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.UnderwaterFogChunk = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this._standaloneFogScaffoldInstalled = false;
  this._fogChunkInjected = false;
  this._sharedUwSunDir = null;
};

//Install the standalone scaffold if this scene has no a-starry-sky to provide
//the reservation slot. skyProvider is resolved by OceanGrid off DOM presence.
ARestlessOcean.Passes.UnderwaterFogChunk.prototype.init = function(skyProvider){
  if(skyProvider === 'standalone'){
    this.installStandaloneScaffold();
  }
};

ARestlessOcean.Passes.UnderwaterFogChunk.prototype.resize = function(){};

//Per-frame: retry the injection until it takes, then keep the sun direction
//current. Returns whether the chunk is armed, which gates the underwater murk
//block and the reflection pass's shader warm.
ARestlessOcean.Passes.UnderwaterFogChunk.prototype.tick = function(){
  this.inject();
  return this._fogChunkInjected;
};

//Install a minimal, self-contained fog scaffold into THREE.ShaderChunk.fog_*
//carrying the SAME reservation tokens a-starry-sky leaves, so the existing
//_injectUnderwaterFogChunk() can fill them unchanged. We deliberately do NOT
//replicate a-starry-sky's atmosphere here — only the plumbing the ocean
//branch needs: the vFogWorldPosition varying, the sRGB helpers the chunk
//calls, and a stock linear-fog else-branch for fogNear >= 0. Idempotent and
//skipped entirely when a-starry-sky owns the slot.
ARestlessOcean.Passes.UnderwaterFogChunk.prototype.installStandaloneScaffold = function(){
  const grid = this.oceanGrid;
  if(this._standaloneFogScaffoldInstalled) return;
  const fragToken = '//$$OCEAN_SHADER_SHADER_FRAGMENT_RESERVATION$$';
  const vertToken = '//$$OCEAN_SHADER_SHADER_VERTEX_RESERVATION$$';
  //If something already provided the token (a-starry-sky raced us), don't
  //clobber it — let _injectUnderwaterFogChunk fill whatever is there.
  if(THREE.ShaderChunk.fog_fragment &&
     THREE.ShaderChunk.fog_fragment.indexOf(fragToken) !== -1){
    this._standaloneFogScaffoldInstalled = true;
    return;
  }
  THREE.ShaderChunk.fog_pars_vertex = [
    '#ifdef USE_FOG',
    '  varying float vFogDepth;',
    '  varying vec3 vFogWorldPosition;',
    '#endif'
  ].join('\n');
  THREE.ShaderChunk.fog_vertex = [
    '#ifdef USE_FOG',
    '  ' + vertToken,
    '#endif'
  ].join('\n');
  THREE.ShaderChunk.fog_pars_fragment = [
    '#ifdef USE_FOG',
    '  uniform vec3 fogColor;',
    '  varying float vFogDepth;',
    '  varying vec3 vFogWorldPosition;',
    '  #ifdef FOG_EXP2',
    '    uniform float fogDensity;',
    '  #else',
    '    uniform float fogNear;',
    '    uniform float fogFar;',
    '  #endif',
    //sRGB <-> linear helpers the injected ocean branch calls by name. Match
    //a-starry-sky's signatures (vec4 in / vec4 out) so the chunk GLSL is
    //identical on both paths.
    '  vec4 fogsRGBToLinear(vec4 c){',
    '    return vec4(mix(c.rgb / 12.92, pow((c.rgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c.rgb)), c.a);',
    '  }',
    '  vec4 fogLinearTosRGB(vec4 c){',
    '    return vec4(mix(c.rgb * 12.92, 1.055 * pow(c.rgb, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c.rgb)), c.a);',
    '  }',
    //Narkowicz ACES fit — the SAME operator a-starry-sky and water-shader.glsl
    //use. The ocean branch tonemaps its fogged result on the sRGB (main-canvas)
    //path so underwater scene geometry matches the water surface and the
    //reflection (which both go through MyAES). a-starry-sky declares this itself
    //on its path, so this copy is standalone-only — the two scaffolds are never
    //both installed, so there is no duplicate-symbol collision.
    '  vec3 MyAESFilmicToneMapping(vec3 color){',
    '    return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);',
    '  }',
    '#endif'
  ].join('\n');
  THREE.ShaderChunk.fog_fragment = [
    '#ifdef USE_FOG',
    '  #ifdef FOG_EXP2',
    '    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);',
    '    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);',
    '  #else',
    //fogNear < 0 selects the ocean branch (same convention as the a-starry-sky
    //path). The reservation token is filled by _injectUnderwaterFogChunk; the
    //else is plain linear fog so any above-water fog still works standalone.
    '    if(fogNear < 0.0){',
    '      ' + fragToken,
    '    } else {',
    '      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);',
    '      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);',
    '    }',
    '  #endif',
    '#endif'
  ].join('\n');
  this._standaloneFogScaffoldInstalled = true;
};

//Fill A-Starry-Sky's reserved underwater-fog slot. Its `advanced` atmospheric
//perspective globally patches THREE.ShaderChunk.fog_fragment / fog_vertex and
//leaves an empty `else if(fogNear < 0.0)` branch marked with a //$$...$$
//token. String-replace that token with a per-channel Beer-Lambert absorption
//fog. Polled from tick() — the token only exists once A-Starry-Sky's
//FogRenderer has run, and only in `advanced` mode; a harmless no-op
//otherwise. Runs once, then forces a one-time recompile so already-built
//materials pick up the new chunk.
ARestlessOcean.Passes.UnderwaterFogChunk.prototype.inject = function(){
  const grid = this.oceanGrid;
  if(this._fogChunkInjected) return;
  const fragToken = '//$$OCEAN_SHADER_SHADER_FRAGMENT_RESERVATION$$';
  const vertToken = '//$$OCEAN_SHADER_SHADER_VERTEX_RESERVATION$$';
  const fragChunk = THREE.ShaderChunk.fog_fragment;
  const vertChunk = THREE.ShaderChunk.fog_vertex;
  const parsFragChunk = THREE.ShaderChunk.fog_pars_fragment;
  if(!fragChunk || fragChunk.indexOf(fragToken) === -1) return;  //not patched yet

  //fog_pars_fragment runs at file scope (uniform declarations). Append our
  //sun-direction uniform there — fog_fragment runs inside main() so uniform
  //declarations don't work in our reservation slot. Idempotent guard so
  //repeated calls don't accumulate copies.
  if(parsFragChunk && parsFragChunk.indexOf('uniform vec3 uwSunDir;') === -1){
    THREE.ShaderChunk.fog_pars_fragment = parsFragChunk + '\nuniform vec3 uwSunDir;\n';
  }

  //Per-channel extinction (1/m) baked into the chunk as a const vec3 —
  //THREE.Fog only smuggles one Color + two floats, so for per-channel
  //chromatic falloff (red dies faster than blue, the cue that distant
  //underwater geometry reads cyan/blue) we inject extinction directly. It
  //is read once at the current water_type / explicit RGB; a live water-type
  //swap would need a chunk re-injection + needsUpdate sweep (rare, paid as
  //a one-time recompile when it happens).
  const presetJ = ARestlessOcean.JERLOV_PRESETS[grid.data.water_type | 0];
  const absV = presetJ ? presetJ.absorption : grid.data.water_absorption;
  const sctV = presetJ ? presetJ.scattering : grid.data.water_scattering;
  const ex = Math.max(absV.x + sctV.x, 1e-4);
  const ey = Math.max(absV.y + sctV.y, 1e-4);
  const ez = Math.max(absV.z + sctV.z, 1e-4);
  const extLit = 'vec3(' + ex.toFixed(6) + ',' + ey.toFixed(6) + ',' + ez.toFixed(6) + ')';
  //Per-channel multiple-scatter ratio for the diffuse "ocean colour" glow the
  //chunk adds below. fogColor already carries albedo·(E_sun+E_sky)/4π, and we
  //want fogColor·uwMsRatio == R∞·(E_sun+E_sky)/π — the semi-infinite diffuse
  //reflectance term that matches water-shader.glsl's underwaterInscatterSurface.
  //Solving: uwMsRatio = 4·R∞/albedo, R∞ = (1-√(1-a))/(1+√(1-a)). ~4× the old
  //a²/(1-a)/(4π) floor at ocean albedos (~0.2) so the murk reads as real teal.
  const rInf = function(a){ const s = Math.sqrt(Math.max(1.0 - a, 0.0)); return (1.0 - s) / (1.0 + s); };
  const albMx = (sctV.x / ex), albMy = (sctV.y / ey), albMz = (sctV.z / ez);
  const msx = 4.0 * rInf(albMx) / Math.max(albMx, 1e-4);
  const msy = 4.0 * rInf(albMy) / Math.max(albMy, 1e-4);
  const msz = 4.0 * rInf(albMz) / Math.max(albMz, 1e-4);
  const msLit = 'vec3(' + msx.toFixed(6) + ',' + msy.toFixed(6) + ',' + msz.toFixed(6) + ')';

  //Smuggle convention for the ocean branch (fogFar > 0 && fogNear < 0):
  //  fogColor.rgb = isotropic-baseline inscatter at depth 0, per channel.
  //                 `waterAlbedo · (E_sun + E_sky) / (4π)` — i.e., the
  //                 surface equilibrium AS IF both sun and sky had isotropic
  //                 phase. The chunk re-weights below to push sun through
  //                 Henyey-Greenstein while keeping sky isotropic.
  //  -fogNear     = water surface Y (the waterline) — selects ocean branch
  //                 AND drives the world-Y gate.
  //  fogFar       = signed sun-fraction smuggle:
  //                   sign(fogFar)  → linear-vs-sRGB target encoding
  //                                   (+ = sRGB canvas, − = linear RT).
  //                   |fogFar|      → fraction of E_sun in (E_sun + E_sky),
  //                                   used to split HG-vs-isotropic terms.
  //  uwSunDir     = world-space direction sunlight TRAVELS (away from sun),
  //                 matching water-shader.glsl's brightestDirectionalLightDirection.
  //                 Declared in fog_pars_fragment via the append above.
  //Per-channel extinction is the const `uwExt` baked in above.
  //NO WORLD-Y GATE: the ocean branch only runs when the camera is submerged
  //(scene.fog is swapped to the ocean fog underwater; above water it's
  //a-starry-sky's atmospheric fog and this branch is never entered). When
  //submerged the whole view is underwater, so every fragment fogs uniformly.
  //Above-water geometry (the lighthouse etc.) is never DIRECTLY visible from
  //below — any sightline from a submerged camera to an air-side point crosses
  //the surface, and the FFT surface mesh (clipmap + horizon skirt) is rendered
  //along it and overdraws those pixels with the Snell-window transmission
  //composite. So the over-fog on those hidden fragments is masked by the real
  //wavy surface; the surface mesh IS the per-fragment medium boundary. This
  //replaces the old flat `vFogWorldPosition.y < uwSurfaceY` plane gate, whose
  //single-point/2-cascade probe height left a flat fog ceiling that bobbed at
  //the wrong (long-swell-only) frequency and an un-fogged band under crests.
  //The mirror RT independently clips y>waterline (see _renderUnderwater
  //Reflection's _reflClipPlane), so its fragments are all below-surface too —
  //removing the gate doesn't change that pass. vFogWorldPosition is
  //A-Starry-Sky's existing advanced-fog varying; the vertex slot below fills
  //it for the ocean branch (still used for the per-fragment depth darkening).
  const fragGLSL = [
    'const vec3 uwExt = ' + extLit + ';',
    'const vec3 uwMsRatio = ' + msLit + ';',
    //Phase-function constants. g=0.85 is the canonical clean-ocean
    //Henyey-Greenstein asymmetry parameter (Mobley 1994), but a phase
    //that peaked makes perpendicular-to-sun scatter ~100× weaker than
    //the forward halo — the horizon under a noon sun reads nearly black.
    //0.5 (turbid coastal range) lifts the perpendicular contribution so
    //the horizon picks up real sun light and asymptotes to teal. Match
    //the same value in water-shader.glsl's underwaterInscatterSurface.
    //The 1/(4π) is the steradian-normalisation baked into HG.
    'const float UW_HG_G = 0.5;',
    'const float UW_INV_4PI = 0.07957747154;',
    //Gaze-dependence of the murk's SUN single-scatter term. 1.0 = full HG halo
    //(physical: brighter toward the sun); 0.0 = isotropic (view-independent
    //teal) so the direct seabed (down gaze) and reflected ceiling (up gaze)
    //fade to the SAME teal. Kept at 0.0 for the uniform "colour of the water"
    //look. MUST match UW_MURK_GAZE_WEIGHT in water-shader.glsl so the seabed/
    //curtain fog (this chunk) and the ceiling/body fog (the water shader) stay
    //in lockstep. Flip both to 1.0 to restore the physical sun glow.
    'const float UW_MURK_GAZE_WEIGHT = 0.0;',
    //Underwater fog isolation taps — debugging the seabed-vs-ceiling murk match.
    //MUST match UW_DEBUG_FOG_MODE in water-shader.glsl applyUnderwaterFog.
    //  0 = normal production blend.
    //  1 = NO fog (raw input color passes straight through).
    //  2 = fog a CONSTANT input color (vec3(0.5)) — isolates the fog blend
    //      from the geometry colour; both paths start from the same input.
    //  3 = output the MURK only (full fog) — shows EXACTLY what each path
    //      fades to. Top (ceiling murk) vs bottom (this seabed murk).
    'const int UW_DEBUG_FOG_MODE = 0;',
    //Underwater path-length scale. 1.0 = physically true geometric distance:
    //extinction integrates over the REAL ray length, no magnification — the
    //distance to a rock is the distance to a rock, a surface->floor reflection
    //bounce is just its real longer path. Was 0.3, a non-physical clarity fudge
    //(see the matching note in water-shader.glsl). Set water visibility via
    //water_type / the Jerlov coefficients instead. Must match the water-shader
    //UW_DIST_SCALE so the ceiling and direct-view seabed asymptote to the same
    //effective extinction.
    'const float UW_DIST_SCALE = 1.0;',
    //Downwelling depth attenuation of the SURFACE lighting (distinct from the
    //inscatter fog). The light that illuminates a fragment travelled DOWN
    //through the water column to reach it, so it is Beer-Lambert attenuated by
    //the fragment's vertical depth below the surface — the same physics the
    //water-shader seabed branch applies to its sun term (exp(-extinction*downPath)).
    //Without this, nearby geometry (rocks, seabed, hull) renders at full
    //THREE-lit brightness no matter how deep the dive, because uwT≈1 at short
    //range. We reuse uwExt so red dies first → deep geometry reads blue-green
    //then dark, matching the water colour. 1.0 = physically full attenuation;
    //lower toward 0 to keep deep geometry brighter/more visible (stylistic).
    'const float UW_DOWNWELL_STRENGTH = 1.0;',
    'float uwSurfaceY = -fogNear;',
    //Path length is the true geometric distance through water (x the 1.0 scale
    //above). Direction-isotropic — a surface at the camera's own depth fogs the
    //same as one above or below it at the same range.
    //  * MAIN render (real camera below water): the whole camera→frag ray
    //    is in water → discount the full geometric length.
    //  * MIRROR render (mirror camera above water, by the reflection-trick
    //    equivalence the mirror straight-line = the real bounce path): the
    //    camera→bounce segment is ALREADY fogged by the water shader's
    //    applyUnderwaterFog at the ceiling, so this branch only fogs the
    //    post-bounce leg = (1 - t)·totalLen, then applies the same discount.
    //    For an object TOUCHING the surface t collapses to the frag →
    //    second leg = 0 → no extra fog, so the reflection of that touching
    //    point matches the surrounding water surface.
    '  vec3 dir = vFogWorldPosition - cameraPosition;',
    '  float totalLen = length(dir);',
    '  float uwDist;',
    '  if(cameraPosition.y < uwSurfaceY){',
    '    uwDist = totalLen * UW_DIST_SCALE;',
    '  } else {',
    '    float t = (uwSurfaceY - cameraPosition.y) / dir.y;',
    '    t = clamp(t, 0.0, 1.0);',
    '    uwDist = (1.0 - t) * totalLen * UW_DIST_SCALE;',
    '  }',
    '  vec3 uwT = exp(-uwExt * uwDist);',
    //HG sun phase. cosθ = dot(incident, scattered) = dot(uwSunDir, -viewDir)
    //= -dot(uwSunDir, viewDir). cosθ ≈ +1 when the camera looks TOWARD the
    //sun (forward scatter, peaked HG); ≈ -1 looking down-sun.
    '  vec3 uwViewDir = (totalLen > 1e-4) ? (dir / totalLen) : vec3(0.0, -1.0, 0.0);',
    '  float uwCosTheta = -dot(uwViewDir, uwSunDir);',
    '  float uwG2 = UW_HG_G * UW_HG_G;',
    '  float uwHG = (1.0 - uwG2) * UW_INV_4PI',
    '             / pow(max(1.0 + uwG2 - 2.0 * UW_HG_G * uwCosTheta, 1e-4), 1.5);',
    //Angular factor that turns the isotropic-baseline fogColor into the
    //actual physical inscatter. Derivation: real = α·(E_sun·p_HG + E_sky·p_sky),
    //baseline (full iso) = α·(E_sun + E_sky)·(1/4π). With sunFrac = E_sun/(E_sun+E_sky):
    //  real / baseline = 4π · sunFrac · p_HG + 2 · (1 - sunFrac)
    //  (sky uses p_sky = 1/(2π) for a uniform upper-hemisphere with isotropic
    //   phase; 4π·1/(2π) = 2). |fogFar| carries sunFrac, sign carries
    //   linear/sRGB.
    //fogFar magnitude carries BOTH the sunFrac and the output-domain flag:
    //  main canvas (sRGB) → fogFar = sunFrac        in [0,1]
    //  reflection RT (linear) → fogFar = sunFrac+10 in [10,11]
    //The sign can't carry the flag — a-starry-sky reserves fogFar<=0 for its
    //atmospheric branch (which would steal this whole pass from us). >5 ⇒
    //linear RT output, skip the sRGB roundtrip; else sRGB main canvas.
    '  bool uwInputIsSRGB = fogFar < 5.0;',
    '  float uwSunFrac = uwInputIsSRGB ? fogFar : (fogFar - 10.0);',
    //Blend the HG halo toward isotropic (1/4π) by UW_MURK_GAZE_WEIGHT — at 0.0
    //the sun term is view-independent, mirroring underwaterInscatterSurface's
    //pSun blend so the direct seabed murk matches the reflected ceiling murk.
    '  float uwHGiso = mix(UW_INV_4PI, uwHG, UW_MURK_GAZE_WEIGHT);',
    '  float uwAngFactor = 4.0 * 3.14159265359 * uwSunFrac * uwHGiso',
    '                    + 2.0 * (1.0 - uwSunFrac);',
    //Single-scatter (angular) term + isotropic multiple-scatter floor. The
    //angular term collapses toward 0 perpendicular to the sun (the horizon
    //under a high sun), which read as black; the MS floor (fogColor·uwMsRatio,
    //view-independent) keeps the distance fading to a real teal. Mirrors
    //water-shader.glsl underwaterInscatterSurface so seabed and ceiling agree.
    '  vec3 uwMurkSurface = fogColor * uwAngFactor + fogColor * uwMsRatio;',
    //Camera-depth darkening (NOT fragment depth). Inscatter is front-loaded
    //near the eye, so the equilibrium every long ray fades to is the medium's
    //radiance at the CAMERA's depth — one "colour of the water" in all
    //directions. Darkening by the far fragment's own depth instead crushed
    //the deep seabed / abyss veil to black and made it disagree with the
    //ceiling (which darkens by ~0) and the curtain (camera depth). Matches
    //water-shader.glsl underwaterInscatterSurface's camDepthDarken. In the
    //mirror RT pass cameraPosition is the above-water mirror cam, so this
    //clamps to 0 — surface-level inscatter for the post-bounce leg, correct.
    //INVESTIGATED 2026-06-06 (camera-Y console probe in _renderUnderwater
    //Reflection): RULED OUT as the direct-vs-reflected brightness divergence.
    //The probe confirmed the mirror cam is always above water when submerged
    //(mirrorCamDepth ≡ 0), so this term IS 0 in the reflection — but the same
    //real depth (mainCamDepth) is applied to BOTH views: directly here for the
    //seabed, and for the reflection via the pre-darkened fogColor swap
    //(_uwBaselineCamDepth) in stage 1 PLUS underwaterInscatterSurface's
    //camDepthDarken (real cam) in stage 2. Identical factor on both sides → it
    //cancels in the comparison and cannot open a gap between them. The real
    //asymmetry left is the HG sun-halo VIEW DIRECTION (this seabed gaze vs the
    //ceiling's up gaze), not the depth term.
    '  float uwCamDepth = max(0.0, uwSurfaceY - cameraPosition.y);',
    '  vec3 uwMurk = uwMurkSurface * exp(-uwExt * uwCamDepth);',
    //fog_fragment runs AFTER colorspace_fragment, so gl_FragColor here is
    //already in the target encoding — the sRGB roundtrip is needed ONLY
    //for the sRGB-encoded path. Doing it unconditionally pushed the
    //reflection RT's linear data through a spurious pow(·, 2.4) cycle.
    '  vec3 uwLinear = uwInputIsSRGB',
    '    ? fogsRGBToLinear(vec4(gl_FragColor.rgb, 1.0)).rgb',
    '    : gl_FragColor.rgb;',
    //Downwelling attenuation of the lit surface colour. uwFragDepth is THIS
    //fragment's depth below the surface (vertical column the light descended
    //through), independent of the camera-depth darkening on the murk above —
    //so no double-count. A fragment at the surface (depth 0) keeps full light;
    //a deep one fades toward dark. Applied only in the production blend so the
    //UW_DEBUG_FOG_MODE isolation taps stay pure diagnostics.
    '  float uwFragDepth = max(0.0, uwSurfaceY - vFogWorldPosition.y);',
    '  vec3 uwDownwell = exp(-uwExt * uwFragDepth * UW_DOWNWELL_STRENGTH);',
    //Fog blend, with the UW_DEBUG_FOG_MODE isolation taps (see const above).
    '  if(UW_DEBUG_FOG_MODE == 1){ /* raw input, no fog */ }',
    '  else if(UW_DEBUG_FOG_MODE == 2){ uwLinear = vec3(0.5) * uwT + uwMurk * (vec3(1.0) - uwT); }',
    '  else if(UW_DEBUG_FOG_MODE == 3){ uwLinear = uwMurk; }',
    '  else { uwLinear = uwLinear * uwDownwell * uwT + uwMurk * (vec3(1.0) - uwT); }',
    //sRGB (main-canvas) path: TONEMAP the fogged result with MyAES before
    //encoding — the renderer is NoToneMapping, so scene geometry arrives here
    //un-tonemapped (raw linear radiance), and without this it would sRGB-encode
    //straight, reading far brighter than the same geometry seen in the water
    //surface or the reflection (both of which go through MyAES). This mirrors
    //a-starry-sky's OWN atmospheric branch, which MyAES-tonemaps its fogged
    //ground — so above-water and below-water scene geometry now tonemap alike.
    //LINEAR RT (reflection) path: do NOT tonemap here — the ceiling composite
    //applies MyAES once when it samples this RT, so tonemapping now would
    //double it.
    '  gl_FragColor.rgb = uwInputIsSRGB',
    '    ? fogLinearTosRGB(vec4(MyAESFilmicToneMapping(uwLinear), 1.0)).rgb',
    '    : uwLinear;'
  ].join('\n');
  const vertGLSL = [
    'vFogDepth = - mvPosition.z;',
    'vFogWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;'
  ].join('\n');

  THREE.ShaderChunk.fog_fragment = fragChunk.replace(fragToken, fragGLSL);
  if(vertChunk && vertChunk.indexOf(vertToken) !== -1){
    THREE.ShaderChunk.fog_vertex = vertChunk.replace(vertToken, vertGLSL);
  }
  this._fogChunkInjected = true;

  //Sun-direction broadcast for the chunk's HG sun phase. The chunk's GLSL
  //references `uwSunDir` (world-space, points FROM sun TO scene = the
  //direction sunlight travels — same convention as water-shader.glsl's
  //brightestDirectionalLightDirection). Three's UniformsUtils.clone deep-
  //clones Vector3, so we can't share a single reference via UniformsLib;
  //instead we patch the per-shader-lib uniforms map so NEWLY-built fog
  //materials get the slot, then per-frame traverse the scene and write
  //the current sun direction into each material's local Vector3 clone.
  //_sharedUwSunDir is the source-of-truth that the tick updates; the
  //traversal copies it onto every fog material.
  if(!this._sharedUwSunDir){
    this._sharedUwSunDir = new THREE.Vector3(0.0, -1.0, 0.0);
  }
  const shaderLibNames = ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon'];
  for(let i = 0; i < shaderLibNames.length; ++i){
    const lib = THREE.ShaderLib && THREE.ShaderLib[shaderLibNames[i]];
    if(lib && lib.uniforms && !lib.uniforms.uwSunDir){
      lib.uniforms.uwSunDir = { value: new THREE.Vector3(0.0, -1.0, 0.0) };
    }
  }
  if(THREE.UniformsLib && THREE.UniformsLib.fog && !THREE.UniformsLib.fog.uwSunDir){
    THREE.UniformsLib.fog.uwSunDir = { value: new THREE.Vector3(0.0, -1.0, 0.0) };
  }

  //Rebuild fog-enabled materials already compiled against the old chunk
  //(one-time startup hitch). At the same time, attach the uwSunDir uniform
  //to any material that lacks it — covers existing scenes that were built
  //before the ShaderLib patch above could take effect.
  if(grid.scene){
    grid.scene.traverse(function(obj){
      if(!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for(let i = 0; i < mats.length; ++i){
        const m = mats[i];
        if(!m || !m.fog) continue;
        if(m.uniforms && !m.uniforms.uwSunDir){
          m.uniforms.uwSunDir = { value: new THREE.Vector3(0.0, -1.0, 0.0) };
        }
        m.needsUpdate = true;
      }
    });
  }
};

//Per-frame broadcast of the current sun direction to every fog-receiving
//material's `uwSunDir` uniform. Source is `this._sharedUwSunDir`, which the
//tick updates once after probing the directional-light list. Cost is one
//scene traversal per frame; the per-material write is a Vector3.copy().
ARestlessOcean.Passes.UnderwaterFogChunk.prototype.broadcastSunDir = function(){
  const grid = this.oceanGrid;
  if(!grid.scene || !this._sharedUwSunDir) return;
  const src = this._sharedUwSunDir;
  grid.scene.traverse(function(obj){
    if(!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for(let i = 0; i < mats.length; ++i){
      const m = mats[i];
      if(!m || !m.fog || !m.uniforms) continue;
      //Self-heal: a material added to the scene AFTER the chunk-injection
      //traversal won't have the slot yet. Attach it on first sight and
      //flag needsUpdate so the next render rebuilds the program with the
      //appended fog_pars_fragment uniform declaration in scope.
      if(!m.uniforms.uwSunDir){
        m.uniforms.uwSunDir = { value: new THREE.Vector3() };
        m.needsUpdate = true;
      }
      m.uniforms.uwSunDir.value.copy(src);
    }
  });
};

//The chunk writes global THREE.ShaderChunk state, so there is nothing to
//release — tearing it down would break every other material in the scene.
ARestlessOcean.Passes.UnderwaterFogChunk.prototype.dispose = function(){};
