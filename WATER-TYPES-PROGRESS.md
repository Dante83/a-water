# Multi Water Types: progress log

Running record of the phases in [`WATER-TYPES.md`](./WATER-TYPES.md) as they land.
One section per phase: what shipped, where things moved, what was deviated from,
what is deferred, and what still needs a human to look at it.

The architecture doc stays the plan. This file is the log.

---

## Shore pass (2026-09-30, branch `fix-shoreline-waves-and-add-connectors`)

Dante's report: (1) dark rings round settling foam; (2) foam puts big splotchy shadows on
the floor; (3) Liam casts no sharp shadow on the water; (4) shore foam is chunky, gets cut
off and sits under the land; (5) rivers make no plume; (6) rivers and the sea don't join.
Plan: A foam look → B hero shadow → C surf meets the land → D river mouths.

### Step A — shore foam look (written, headless-compiled; regen committed)

- **Dark rings: the foam colour map's gaps.** Foam002_1K_Color is near black in its gaps
  by design. Measured: 29% of texels have opacity < 0.1, and their linear albedo is 0.03.
  The composite gave those texels 0.5 · foamShape weight (`foamGrainFloor` 0.5) toward
  albedo × light. So every fading fringe laid dark colour over the sand under thin water,
  which read as a ring. The waterfall sheet found the same thing (PROGRESS "dark navy gaps").
  - Now foam is `mix(foamWhite, texture, 0.35·mask)`: white where the texture is
    transparent, with a hint of its tint on the bubbles.
  - The grain floor is 0.15, and the mask is stretched `smoothstep(0.05, 0.45)` (median 0.24),
    so bubbles read solid.
  - ⚠ Net effect: foam is brighter (effective albedo ~0.3 → ~0.75). Tune `foamWhite` if it
    blows out.
- **Splotchy "shadows": the ocean CSM on foam alone.** Nothing darkens the floor by foam.
  Foam diffuse took the whole `sunShadowFactor`, which includes the blurred EVSM wave
  self-shadow (60 m/240 m cascades, "soft round blotches"). The water round the foam barely
  uses that term, so the blotches showed only where foam lay, and over the swash they read
  as shadows on the sand.
  - Foam now takes `foamOceanShadowK` (0.25) of the ocean term on the open sea, and none
    where the foam is surf foam.
  - Terrain and object shadow (`sunShadowNoOcean`) stay whole.
- **Lace, not slabs.** Surf foam (breaker, swash, thin sheet) and body foam
  (`dynamicWavesFoamAt`) are tracked apart as `shoreFoamAmount` and drawn with a sliding
  black point on a grain that is NOT world-locked:
  - it is offset inland by the swash sheet's current run-up (η / bed slope, along the
    smooth shore normal), so it runs up the beach and slides back down;
  - it drifts shoreward at `shoreLaceDrift` m/s in two flow-map phases (2 s period), the
    flowing variant's trick;
  - the threshold is on the grain's rank, u ≈ (m/0.55)^0.8 (fits the opacity CDF within
    ~2%), so coverage a covers a of the surface.
  Open-sea FFT foam keeps the field-shaped blend (`seaFoamAmount`). The flowing variant is
  unchanged apart from the albedo and grain-floor fix.
- **Live knobs** (on `oceanGrid`): `foamWhite` 0.8, `foamGrainFloor` 0.15,
  `foamOceanShadowK` 0.25, `shoreLaceDrift` 0.8.
- **Verified:**
  - A one-shot regen (create-shader.py's watcher body run once) is byte-identical on the
    untouched tree.
  - Headless Chromium/SwiftShader on a standalone page (aframe 1.7 + the 55 src files in
    make-combined order + `<a-restless-ocean>`): all 26 programs compile, no shader errors.
  - Not verified: the shore paths themselves. Standalone has no water field, so breakers and
    swash are off. Debug 31/32/33 (mask, blend, colour) and 18 (ocean shadow) are the A/B
    on an island page.

### Step B — hero shadow: Liam on the water (written, headless-verified in debug 70)

- **Why nobody cast a shadow on the water.** On a-land pages the shared sun has
  castShadow off, so `getSunShadow` is 1. The only object shadow the water saw was
  a-land's WaterLightField (1 m texels, still level), and a person is narrower than a
  texel. Even a real shadow barely showed: the body colour (`underwaterInscatterSurface`)
  was never shadowed, and the Crest-style `inscatterShadow` 0.65 floor fed dead code.
- **`passes/hero-shadow-pass.js` (new; add it to every page's script list after
  waterline-pass.js, and it's in make-combined.py).**
  - One sun-aligned ortho depth map, 2048² over ±12 m around the camera (1.2 cm/texel),
    snapped to texels, 60 m deep.
  - Casters: visible meshes with castShadow on and a bounding radius under 15 m, near
    the box. Skinned meshes are posed: three picks USE_SKINNING from the object, so one
    override MeshDepthMaterial covers them. `userData.heroShadow = false/true` excludes or
    forces a mesh. The ocean's own ShaderMaterials are skipped.
  - Casters sit on layer 27 for the one render. ⚠ The first cut used 29, which is
    `OCEAN_LAYER`: every water tile carries it, so a flat, undisplaced copy of the sea went
    into the map and "shadowed" every trough (debug 70 caught it). Any non-caster found on
    27 is taken off it for the render.
  - No casters, or the sun below the horizon: no render, `heroShadowEnabled` = 0.
  - OceanGrid's light list only takes direct scene children. The pass falls back to the
    first DirectionalLight anywhere in the scene (an A-Frame light entity nests its light).
- **Water shader:**
  - `heroShadowAt(p)` is a PCSS-lite: 8 blocker taps, then a penumbra of sun angle
    (0.0093 rad) × blocker height, then 12 Poisson taps, with a fade at the box edge.
  - It multiplies into the surface shadow (`sunShadowNoOcean`, so foam, glint and body
    too), the seabed seen through the water (at its sun-ray surface point) and terrain
    seen through thin water.
  - The body colour now takes the sun shadow: `underwaterInscatterShadowed(view,
    mix(bodyShadowFloor, 1, sunShadowNoOcean))` scales the direct downwelling only, and
    the sky light stays whole. The dead 0.65 copy is gone.
- **Debug 70:** the hero shadow alone, tinted blue inside the box.
- **Live knobs:**
  - `oceanGrid.heroShadowPass.enabled`, `.halfWidth` (12), `.depthRange` (60), `.softness` (1);
  - `oceanGrid.bodyShadowFloor` (0.25, share of the direct sun a shadowed body keeps).
- **Verified headless** (standalone page, a box and a sphere with castShadow, calm sea):
  - debug 70 shows both shadows, crisp, no acne, no false trough shadows after the layer
    fix;
  - all programs compile;
  - dynamic-waves and nappe tests pass.
  - ⚠ Not verified: how strongly the shadow reads in the NORMAL render. The standalone
    water body is almost black (about 1/255 inscatter, unmetered sun), so an on/off A/B
    moved only a handful of pixels. On a metered a-land page the body is teal and the
    direct sun dominates, so the shadow should show. If it's too faint or too strong, the
    knob is `bodyShadowFloor`.
  - Also not verified: Liam himself (peaceful-island isn't in this session). Check that
    his meshes have castShadow on; if not, set `userData.heroShadow = true` on them.

### Step C — surf that meets the land (written, unit-tested, headless-compiled)

- **Troughs above the bed.** The skewed breaker waveform runs to −H/2 below the rest level,
  and in the inner surf that is under the sand, so the terrain drew in front of the foam. Now
  `shoreBreakerEval` (and the JS mirror) returns `max(η, −max(h − BED_FILM, 0))`
  (BED_FILM 3 cm). All four GPU consumers get it through the splice: vertex, fragment, CSM
  caster, CPU bake.
- **The soft waterline.** `waterEdgeK = smoothstep(0, 5 cm, surface − G-buffer ground)`,
  top side only, with ground behind. It fades the surface's reflection, glint and
  Fresnel, so the water meets the terrain as a wet film, not a hard line cut by the depth
  test along the 2–16 m mesh facets. Foam thins over the last ~2 cm with it.
- **Thin-sheet foam no longer peaks AT the cut line.** It was brightest at zero thickness,
  which is exactly where the terrain slices the water, so it ended in a hard white edge.
  Now it rises over 0–4 cm and falls over 6–25 cm: a front line inside the water that
  moves with the swash (it is per pixel off the G-buffer).
- **Backwash foam.** Swash foam was uprush-only, so the backwash was bare water (an open
  item since tuning pass 3). Now the bore foam thins to BACKWASH_FOAM (0.4) at the turn,
  continuously, then drains as (1 − x)^1.5. Step A's lace grain follows the run-up, so the
  residue slides back down the beach.
- **Steep shores.**
  - The swash slope fade is widened from 0.15/0.35 to 0.22/0.45 (island-sholes' shores are
    0.24–0.42, so the swash was mostly off).
  - The breaker foam cut is now `1 − 0.6·Kr²` instead of `1 − Kr²`, so a surging shore
    keeps a white collar.
  - ⚠ If the "walls of water round the rocks" (tuning pass 2) come back, narrow the slope
    fade first.
- **Cascade crossfade: not needed.** `waterFieldAt` already crossfades over the last 10%
  of each cascade (the survey that flagged it was wrong).
- **Tests.** `node tests/shore/shore-breaker-test.mjs` (10 checks):
  - troughs never below bed + film over 3.5k samples, while 54% are still troughs;
  - swash foam has no downward jump through the turn and jumps up only at bore arrivals;
  - the backwash leaves a residue;
  - a 1:2.5 shore still foams (peak 0.33);
  - the GLSL carries the JS constants.
- **Not verified** (needs an island page): the look. Debug 31–33 for foam; the soft edge
  is best judged on a gentle beach at a low camera.

### Step D1–D3 — river mouths join the sea (written, GPU-headless-verified on a synthetic creek)

- **Why they never met.** a-land stands a creek on its Manning level right to the coast
  (wtr-6 met the sea with a 0.37 m step). The hand-off blended only the WEIGHT over 8 m,
  never the level. The sea kept full waves ~4 m from the flat creek end. At the mouth, a
  6 cm still-side cut plus the flowing sheet's 3–10 cm fade drew neither surface.
- **D1 level ramp (`WaterFieldPass._mouthField` + compose `mouthLevel`).**
  - The mouth field: seeded on still (w < 0.02) sea-level (±0.5 m) wet texels, then relaxed
    one texel per draw over the 8-neighbourhood through WET texels only. That is a chamfer
    distance, so it bends round banks and never jumps land, carrying the seed's level.
  - Water within `mouthRampM` (25 m) eases down to that level: `mix(seaLevel, level,
    smoothstep(0, L, d))`, never below bed + 3 cm, never raised. Dry texels take their
    nearest wet texel's RAMPED level.
  - Everything downstream reads RT0, so the flowing surface, clipmap, probes, CPU bake and
    a-land's clip all agree for free.
  - Cost: ≤ 32 draws of 512², only when a cascade refills.
  - Sea-level mouths only: a pool inside a creek would otherwise drag the reach above it
    down to the pool.
- **D2 mouth band.** The band seed's new b channel is the weight of flowing texels within
  the ramp. It is spread by a MAX of a tent over `mouthBandM` (16 m), not a blur: a blur
  of a 7 m creek reached ~4 m into the sea. The swash uprush is now damped by the weight
  too, not only the drawdown (GLSL and JS mirror).
- **D3.** At a sea mouth (level within 0.5 m of sea level) the still side's thin-water band
  cut is 1.5 cm instead of 6 cm. The creek-fringe puddles that cut exists for are inland.
- **GPU check (headless, real passes):** a synthetic 7-texel creek (0.37 m deep, bed rising
  2 cm/m from −0.2 m) paints the scratch field into the sea, then the real compose runs.
  - Creek level along its axis: 0.001 at the mouth (0.17 before), then 0.026, 0.098, 0.217,
    0.372, 0.531 every 4 m, meeting its own level (0.65) at 24 m. Depth never under
    3 cm.
  - Hand-off weight in the sea at 4/8/12/16 m out: 0.86/0.54/0.21/0 (was ~0 past 4 m).
  - With the bed ABOVE the sea (0.3 m at the mouth) the ramp is bed-limited, as designed:
    a waterfall into the sea stays a fall. (Harness: scratchpad `mouth.mjs`.)
- **Live knobs:** `oceanGrid.waterFieldPass.mouthRampM` (25) and `.mouthBandM` (16), 0 = off.
  They apply at the next refill, `.invalidate()`.
- **Not verified:** a real a-land mouth (wtr-6). Check that the seam closes at the coast,
  that the river doesn't dry out in its last metres (it keeps ≥ 3 cm), and that no surf
  breaks over the mouth.

### Step D4–D5 — river plumes (written, GPU-headless-verified on a synthetic creek)

- **`passes/mouth-plume-pass.js` (new; in make-combined.py after flow-surface-pass.js; add
  it to the page script lists).** A 512² float ping-pong at 1 m over ±256 m, camera-snapped.
  - Channels: r concentration, gb current, a front foam.
  - Built only when the flowing surface exists (a-land rivers).
  - Flowing texels are the source: concentration 1, the field's current, and
    FlowFoamPass's foam × `riverFoamHandoff`.
  - Still wet texels, current: a screened diffusion over wet neighbours (dry ones left
    out: the coast is a wall), k = 1/(1 + texel²/4L²), so a jet spreads and slows with
    e-fold `jetLength` (40 m). No mouth list.
  - Still wet texels, concentration: advected by that current, with diffusion
    `plumeDiffusion` and decay `plumeLife` (90 s).
  - Still wet texels, front foam: advected, lingers `foamLife` (20 s, salt water), seeded
    where the jet converges past `convergenceOnset` (0.08/s) and where concentration drops
    faster than `frontOnset` (0.1/m).
  - ⚠ Tuned headless: with low onsets, the jet's own deceleration and gentle thinning laced
    the whole plume (64–75% cover).
- **Still water material** (one sampler, still variant only; the worst program now uses 25
  of 32 units):
  - the body leans to `albedo` (0.20, 0.17, 0.09, lit as a diffuse suspension) by
    concentration × `strength` (0.7), and clarity drops ×(1 − 0.8·C);
  - front foam goes in as lace;
  - the lace grain drifts with the plume current.
- **GPU check (headless, real passes):** the D1 synthetic creek (1.2 m/s), 1600 steps at
  60 fps (~27 s):
  - current along the axis at 1/4/6/11/16/26/46 m out: −1.07/−0.76/−0.62/−0.40/−0.28/
    −0.13/−0.03 m/s, fanning sideways (−0.41 m/s 10 m off the axis, 4 m out);
  - concentration 0.93/0.68/0.54/0.30/0.14/0.02;
  - foam 4–8% along the axis, and a line on the jet's edge (43% at 4 m off the axis).
  - A settled jet takes ~L² steps, about 25–30 s after a river comes into the window.
    (Harness: scratchpad `plume.mjs`.)
- **Live knobs:** `oceanGrid.mouthPlumePass.{enabled, jetLength, plumeLife, plumeDiffusion,
  foamLife, convergenceGain, convergenceOnset, frontGain, frontOnset, riverFoamHandoff,
  albedo, strength}`.
- **Not verified:** a real mouth, the colour against a-land's sea, and whether the plume
  should be browner or greener for island-sholes' creeks.

### Step D6 — a-land follow-up (spec, for a session in a-faraway-land)

The runtime versions above stay as the fallback. Better data from the bake:
1. **Ramp the stage at the coast.** In the river stage solve, pin each reach that ends in
   the sea (a still, sea-level neighbour) to `seaLevel` at its mouth cell and blend the
   Manning stage up to its own value over ~25 m of channel. Then `mouthRampM` can drop to
   0 for baked worlds.
2. **Carry velocity into the sea.** Write a decaying jet (the mouth velocity ×
   exp(−d/40 m) over sea texels within ~60 m of the mouth, direction continued) instead of
   exactly zero. Keep the sea's body id; only flow changes. Note that the hand-off weight
   reads |v|: a jet above FLOW_LO (0.05 m/s) turns sea texels "flowing". Either cap the
   jet under 0.05 m/s at its edge, or write it to a separate channel (preferred: the
   contract's spare RT1 bits or a new mouth layer).
3. **Mouth nodes (Phase 7 hydrograph)**: position, width, outflow direction, discharge.
   With those, a-water can size the plume by discharge rather than by the field's
   speed alone.
Each needs a rebake of every world. That is why the runtime versions come first.

### Round 5 — surf fades into the plume; the swash tip thins out (2026-09-30)

Round 4 confirmed by Dante: the dark edges are gone. Two follow-ups from his screenshot:
- **Waves vanish at the river mouth.** The mouth band spreads the hand-off weight ~16 m into
  the sea, but the breaker and swash gates still switch off at w = 0.5 (drawdown and uprush
  faded only up to 0.2), and the swash foam never faded, so the surf ended on the w = 0.5
  contour. Breaker W, swash height AND swash foam now fade to 0 by `SURF_FLOW_FADE_W` 0.5,
  in GLSL and the JS mirror. Test: ~0 at w = 0.49 (breaker 0.0000, swash 0.0011).
- **The swash stops abruptly on the sand.** The lace ran at full cover to where the sheet
  meets the terrain. Its cover now drops over the last 10 cm of water (G-buffer thickness),
  so the tip breaks into flecks and clear film.
- **Hero map and instanced meshes.** The round-2 blobs were probably this layer collision
  all along, and instanced casters now render through their own depth twins, so the
  exclusion is no longer needed for correctness. It stays off by default for cost (every
  instance, each frame). Try `oceanGrid.heroShadowPass.includeInstanced = true` and watch
  the frame rate.

Verified headless: 31 programs compile, the shore tests pass (new flow-gate check).

### Round 4 — THE DARK SHORE EDGES: a layer collision with a-land (2026-09-30)

Dante's bisect: surf off, shimmer off, landShadow off, hero off and water hidden changed
nothing. The artefact starts once peaceful-island logs "hero self-shadow cascade registered
with a-land", and it shows on land too.

**Cause.** a-land's TerrainSunCSM renders its terrain cascades with `layers.set(7)`
(CASTER_LAYER) and Liam's hero cascade with `layers.set(8)` (HERO_LAYER). Each is a plain
`renderer.render(scene, cam)` that swaps caster materials in only for a-land's registered
casters. `OceanShadowCSM` put our ring 0-1 water tiles on layers **7 and 8** (with 9 and 10),
so a-land drew them with the water material into its EVSM moments buffers. That is colour
read as a depth distribution: false shadows round Liam and the camera, shaped by the water
mesh (hence the shore edges). a-land's own comment names this trap. Hiding
`<a-restless-ocean>`'s object3D didn't help, because the tiles are added to the scene directly.
a-land's sky capture camera (SKY_LAYER 8) was seeing them too.

**Fix.** The ocean CSM cascade layers are now **20-23**. Layer map, for next time:
- a-land: 7 (casters), 8 (hero cascade, sky capture);
- a-water: 20-23 (ocean CSM), 27 (HeroShadowPass), 29 (OCEAN_LAYER), 30 (exclusion atlas).

Headless: no object carries layer 7 or 8; tile masks are 20-23 + 29; the shore tests pass.

### Round 3 — the patches were a-land's WaterLightField at full resolution (2026-09-30)

Dante: the dark shoreline edges and the small dark patches that move with Liam and the
camera are visible ONLY from above water, only where surf lands, and Liam used to have one
under him. a-land bakes its WaterLightField only while the viewer is above water. It is
1 m texels with a-land's object shadow map in it (Liam included), and a-water read it at
mip 0 for the glint, foam, seabed and terrain seen through the water (round 2 moved only the
body). Foam shows it most, hence the surf.

- **R3a:** every read of the field now takes mip `oceanGrid.landShadowLod` (3 = 8 m; the
  shore nudge stays). Island and cliff shadows keep; object-scale shadows on the water come
  from the hero map. A/B: `oceanGrid.landShadowEnabled = false`.
- **R3b:** `oceanGrid.heroShadowPass.includeInstanced` (off) puts a-land's placed objects
  in the hero map, each through its own `customDepthMaterial` twin (conform, wind). Use it
  for trees and rocks at the shore; off by default because it draws every instance each
  frame.
- **Still open, a-land side:** the edge that STAYS after the backwash is a-land's static
  wet band plus damp tail at the MEAN sea level (9a). The round 1 swash runs well past it.
  Check with `ALand.runtime.TerrainMaterial.wetness.enabled = false`. Fix: 9c, which makes
  the band follow the live swash (next, cross-repo).
- Verified headless: 31 programs compile, the knobs are live, the shore tests pass.
- **R3c, 9c first cut: the wet sand follows the surf (a-water + a-land, both on branch
  `fix-shoreline-waves-and-add-connectors`).**
  - a-water: `passes/swash-surface-pass.js` (new; in make-combined.py; fetched by
    `_ensurePass` if a page lacks it). A 256² ping-pong at 0.5 m over ±64 m:
    - r = live level (field still level + `shoreBreakerHeightAt`, fade 1);
    - g = recent high water, max(live, prev − `dryRate`·dt), dryRate 0.01 m/s;
    - b = the surf part.
    It is handed to a-land every frame through `ALand.runtime.TerrainMaterial.setSwashSurface`,
    and built only when a-land has that socket.
  - a-land (terrain.frag `alandWetState`, TerrainMaterial):
    - where the map is bound, submersion and the lap band come from the LIVE level;
    - ground under the recent high water reads wet (`swash.memoryWetness` 0.8) and a
      little glossy (`memoryFilm` 0.5);
    - it fades back to the still level over the window's outer tenth;
    - lakes and rivers are unchanged (their r is the still level);
    - knobs: `ALand.runtime.TerrainMaterial.swash.{enabled, memoryWetness, memoryFilm,
      memoryFadeM}`.
    - shaders.js regenerated (one-shot regen byte-identical on the untouched tree first).
      `check-shader-compiles` passes, worst variant 21/32 samplers (the harness needed
      three from npm; unpkg is blocked here).
  - Headless (synthetic 1:12 beach, onshore wind, stub a-land socket):
    - the live level swings −0.14…+0.33 m;
    - the high water holds ~0.2–0.37 m and falls slowly;
    - sand is wet to ~4 m above the mean line and dry beyond.
    - Not seen rendered on a-land terrain.
  - ⚠ The earlier harness runs used an OFFSHORE wind (no surf at all), so those surf
    screenshots showed FFT drawdown only.

### Round 2 — Dante's browser check (2026-09-30, night)

Reports, with screenshots on island-sholes:
- (1) the dark band along the shore is still there;
- (2) dark blurry spots on the shallow seabed pop as the camera moves;
- (3) the river never reaches the ocean (wet enough to splash in, nothing drawn) and no plume;
- (4) the swash makes a "quantum jump" to its highest reach.

Found and fixed (headless: shore tests, both material variants compile, plume/mouth GPU
checks unchanged):

- **(2) The hero map was full of a-land's scatter.** a-land's shells, pebbles and plants
  are InstancedMeshes with castShadow on. One small bounding sphere stands for thousands
  of instances, and under the depth override they drew WITHOUT their conform displacement,
  so they cast blurry blobs on the seabed that popped as the scatter streamed.
  - InstancedMeshes are now out unless `userData.heroShadow = true`.
  - Casters are drawn by a per-mesh swap, using their own `customDepthMaterial` when they
    have one (a-land's conformed and wind-swayed twins), not scene.overrideMaterial.
  - Also: the body shadow read a-land's 1 m WaterLightField at mip 0, whose small-object
    blobs re-bake as the camera moves. The body now reads mip 3 (8 m): island and cliff
    shadows stay, pebble blobs go. The surface, foam and seabed keep mip 0.
- **(1) The WaterLightField's slack ring.** The bake is taken at the still level with a
  texel of slack round the water. The last texel or two of every shore are judged at a
  point UNDER the beach, where the sand hides the sun: a dark ring hugging the waterline,
  darker through the swash.
  - `landSunVisibilityLod` now reads it `LAND_VIS_SHORE_M` (2.5 m) out to sea along the
    smooth shore normal within that band, and across the dry band the swash covers.
  - ⚠ Inferred from the bake's description (the a-land WaterLightField code isn't on the
    pushed main). If the band persists, test with the seabed/terrain factor forced to 1.
- **(3) The mouth ramp made creeks invisible.** Over a beach berm it thinned the last
  metres to 3 cm, and the flowing surface draws nothing under 3 cm.
  - The ramp now keeps `min(depth, 10 cm)`.
  - Within 0.5 m of sea level the flowing sheet's thickness fade runs 0.5 → 3 cm instead
    of 3 → 10, so the creek crosses the beach as a film.
  - **The plume and hero passes also need their script tags**, which pages may not have.
    OceanGrid now fetches a missing pass file from its own source tree
    (`ARestlessOcean._ensurePass`, with a console note) and builds the pass once it lands.
    Headless: a page without either tag loaded hero-shadow-pass.js itself, and the pass ran.
- **(4) The swash is a flat sheet rising everywhere at once**, so on a flat upper beach
  the waterline raced (dz/dt over a slope of 0.03: 17.8 m/s measured).
  - Each dry point's WHOLE swash phase is now delayed by its travel time from the
    shoreline at `SWASH_FRONT_K` (√2) × √(g·R2), the ballistic run-up speed. That includes
    the wave-to-wave height: delaying only the local phase left the height switching on
    the global clock, and the line still leapt (8.9 m/s).
  - Measured: 4.4 m/s peak, reach 19 m (unchanged). New test in `shore-breaker-test.mjs`.
- **Not a regression:** a GL "feedback loop" warning burst (19, once) on a synthetic
  beach harness. It is identical on the pre-shore-pass commit ee9d255.

**Headless harness** (scratchpad, not committed): `beach.html` plus `paintonce.js` paint
a synthetic 1:12 beach field (land dry) into all three cascades, over a sand box.
Standalone never marks land dry, so waves spill over it without the paint.

---

## Waterline meniscus (2026-09-27, branch `waterline-meniscus`): v2 built, awaiting browser

**v1 (lens model) REVERSED** after Dante's browser check: it refracted/TIR'd rays through a
Laplace-profile lip and looked them up in a frame copy, which bent the sky DOWN into a thick
smeared water band. Crest does not bend anything (UnderwaterMeniscus.shader,
UnderwaterEffectShared.hlsl ComputeMeniscusWeight: a thin multiply strip / 3 px darkening).

**v2 (Crest-style):** a strip across the line, ±`meniscusWidthPx` (6 px at 1080 lines):
a 13-tap Gaussian blur of the finished frame ALONG the line's screen normal (so each side fades
into the other), times Crest's bluish multiply 1.3·(0.37, 0.4, 0.5) at `meniscusTintStrength` 0.5.
Frame copy: `WaterlinePass.captureCanvas`, in `OceanGrid.tock` after the other-medium pass.
JS only, **no regen**. Knobs live on `oceanGrid.waterlinePass`: `meniscus` (false = old line),
`meniscusWidthPx`, `meniscusTint`, `meniscusTintStrength`.

**Unlit seabed band under the line (Dante, 2026-09-27), FIXED.** Eye just above: a pale band of
bare, unfogged seabed between the waterline and the water view, with a hard lower edge. The
waterline test used the SMOOTH field (surfaceAt), but the mesh is flat triangles (a 25 cm cell
fans 8 from its centre, vertices every 12.5 cm) and strays ~1 cm on short waves (~40 px of near
plane). Where the mesh was higher, the near plane clipped the top surface away while the test
still said "air", so the native above-water seabed showed through. Now `wlDrawnHeight` finds the
fan triangle, displaces its corners exactly as the vertex shader does, and interpolates (mask
AND overlay). Headless A/B, 4 moments each: smooth = the band every time, drawn = none. A/B
switch: `oceanGrid.waterlineDrawnMesh = false`.

**The "big blue bar" (Dante's other report) is NOT the meniscus: it is the underwater LIGHT
VOLUME.** Headless on island-sholes-swim, eye ~3 cm under, looking level: with
`underwaterVolumePass.enabled = false` the ceiling between the line and the horizon is a
textured TIR mirror of the seabed and meets the direct view seamlessly; with it on, a flat,
darker slab sits over that band with a hard step at the horizon. Debug 55 shows that ceiling is
all within a few metres (stage-2 fog does little); 53 (pre-fog ceiling) is already the darker
tone. NEXT: how the volume's in-scatter lands on grazing ceiling fragments vs the direct column.

## ▶▶ RESUME HERE (2026-09-27, later): Phase 8e BUILT, awaiting regen + browser; then Phase 9

### 8e built (uncommitted on `phase-8-water-state`; Liam pages edited in peaceful-island-swim)

**Needs Dante: run `create-shader.py`** (water-vertex.glsl AND water-shader.glsl → water-shader.js). Until then the
old water-shader.js has no `$dynamic_waves_functions` in its vertex, so the ripples stay
normal-only; everything else (damping, probes, capsules) is live without it. A scratch regen
differs from the committed js by exactly the 8e lines, and it compiles clean on the 4090.

1. **Ripples fade, the short ones first.** `DynamicWaves.DAMPING` 0.3/s (amplitude, every
   wavelength) + `VISCOSITY` 0.01 m²/s on the vertical velocity (ν·k²/2), both LIVE console
   knobs. e-folds: λ 0.25 m 0.3 s, 0.5 m 0.9 s, 1 m 2 s, 2 m 2.9 s → a wake is gone within ~4 m.
   ⚠ Flagged fudge: clean water's ν is 1e-6; 0.01 stands in for films + turbulence.
   **Found on the way:** 8b's damping was iWave's η(2 − a·dt)/(1 + a·dt), which damps the
   HEIGHT: it also adds 2a/dt to every ω² (a 1 m ripple ran at a 0.63 s period instead of 0.79 s
   at the new rate). Replaced by true velocity damping, which leaves the period within 0.2%.
   Headless: a 5 cm poke peaks at 14 mm, then 4.9 mm at 1.2 s, 1 mm at 3 s, 0.5 mm at 4 s (8b: ~20 s).
2. **Ripples move the surface.** `water-vertex.glsl` adds `dynamicWavesVertexHeightAt` in
   both variants. It is BOX-FILTERED over the local vertex spacing (4×4 bilinear taps), because
   a ripple shorter than 2 vertices would alias into a crawling false wave. The spacing estimate
   `cell(d) = meshCell · max(1, 2d/R)` (Chebyshev distance to the camera, R = ring 0's
   half-width, 16 m) is continuous, so stitched clipmap rings can't crack. Per-mesh uniforms:
   `dynamicWavesMeshCell/Ring` (clipmap 0.25/16, flow rings 1/0 and 2/0, skirt 0 = off). Full
   weight to cell 1 m, gone by 2 m: on the clipmap that is the whole ±32 m window. The flow 1 m
   ring carries the part of a wake longer than ~2 m (so rivers get only the long wake, not
   rings: say so if they read flat). The fragment micro slope is unchanged. The ocean CSM leaves
   it out: the receiver subtracts it from its shadow position, since the caster doesn't draw it.
   - **Surface probes** add the same filtered height; row 0 .a / `result.ripple` /
     `getWaterStateAt(...).ripple` say how much of surfaceY is ripple. The probe VELOCITY
     leaves ripples out (an interactor's own crater springing back read as water rushing up:
     entry, new crater, loop).
   - **Interactors size their footprint on surfaceY − ripple.** On the drawn surface a limb's
     own depression read as "less submerged": shrink, spring back, grow, a ringing loop.
   - Not done (deliberately): the camera submersion probe (it only sums cascades 0–1 anyway),
     the CPU snapshot (2 m texels), so `buoyant` floats DON'T bob on rings yet, only
     probe riders (Liam) do. Liam IGNORES the ripple under him (peaceful-island-swim
     `liam-water.js` `selfRippleK`, default 1): at his own spot the ripple is almost all his,
     and riding it was a sink-press-sink loop. He still rides every FFT wave, the breakers and
     the swell; others' rings under him are lost (a point can't tell whose ring it is). His
     wet-skin waterline keeps the DRAWN surface (`drawnSurfaceY`). Console:
     `liam.components['liam-character'].water.selfRippleK`.
3. **Capsule interactors.** `water-interactor` gains `targetEnd` (+ `offsetEnd`);
   `Interactor.updateSegment(A, B, dt)`. The contact is where the (ripple-free) surface crosses
   the segment, clamped (upper end if it's all under, lower end if it's all out, middle if
   level). Its velocity is the LIMB's at that point, not the contact sliding as the water rises.
   Liam on both swim pages (`island-sholes-swim(-nosky).html`): shins foot→calf r 0.05, thighs
   calf→thigh r 0.07 (FOOT spray), forearms hand→lowerarm r 0.04 (HAND spray). That makes 11
   interactors + the bridge = 12 of 16 probe slots, and 11 emitters. Headless: every bone resolves,
   a wading shin sits at its waterline (t 0.34, 50% wet), no errors.

4. **Body splash (Dante: "super thin and goes a mile high").** Interactor spray went through
   `emitImpact`, which is tuned for waves slamming rock: a 7 m/s launch FLOOR, mostly faint type-1
   mist. A 2 m/s hand entry measured a median rise of 1.4 m, max 3.5 m. New
   `OceanSplash.emitBodySplash`, reached through `WaterInteraction.impact(…, radius)`, which
   interactors now pass. It throws the waterfall's type-3 clumps (opaque, streaked, dying on the
   water) from a crown ring of the contact radius, at 1.5× the closing speed (the crown sheet plus
   its jet), with a floor of 1.2 m/s and a cap of 5 m/s. Measured: hand entry at 2 m/s, median
   15 cm / max 0.6 m; wading foot at 1 m/s, max ~10 cm; chest plunge at 3 m/s, median 0.4 m / max
   1.3 m. Knobs are `oceanSplash.bodySplash*`, live. Floats' `buoyancy-splash` still uses
   `emitImpact`. This is the same clump the future waterfall plunge wants.
5. **Foam off his ripples.** The DynamicWaves state's spare `.b` channel is whitewater:
   - Emitters add `foam` (per second) and `foamBurst`. Interactors add
     foamK·(speed − foamMinSpeed) while cutting the waterline, and an entry crater leaves
     0.3·closing speed.
   - It is carried by the current like the ripples and fades over `DynamicWaves.FOAM_LIFE` 3 s
     (live).
   - The water fragment (both variants) takes `max(foamAmount, dynamicWavesFoamAt)`. This is a
     `water-shader.glsl` change too, so the regen covers both files.
   - Headless: a shin wading 1.3 m/s leaves a ~0.3 m white trail (1.2 at the head, 0.44 after
     3 s, gone by ~7 s). Knobs: interactor `foamK` / `foamMinSpeed`, FOAM_LIFE.
   - ⚠ The same run's wake peaked at 55 mm even at rippleScale 0.25. The drag head dominates
     (v²/2g: 8.6 cm at 1.3 m/s). If Liam is still loud, lower `dragK` next.

6. **Streams react, lakes meet them (after the 8e commit 1ff37fa; needs another regen).**
   - FlowSurfacePass gains a **0.25 m inner ring** (±16 m, 16.6k vertices; the 1 m ring gets a
     15 m hole, same overlap rule). At 1 m a vertex a creek could only SHADE Liam's rings; now
     they lift it. Its ripple spacing estimate grows to exactly 1 m at its edge
     (`rippleRing: 8`), so it agrees with the 1 m ring across the overlap.
   - **The bank sink is shared.** The flowing surface's edge taper moved to
     `FlowHandoff.GLSL` `flowBankSink(field)` (BANK_TAPER_M 1.5, BANK_TAPER_MAX_M 2). Both
     surfaces lower by `w × sink`: the creek as before (w = 1 inside it and on its banks, where
     the band keeps the raw weight), and the lake across the hand-off band. At a mouth the lake
     used to keep its level while the creek sank toward its bed, so the lake floated over it.
     Now both sit at one height and the lake bends down into the creek. The surface probe and
     the CPU height bake apply it too. The ocean CSM receiver leaves it out, like the ripple.
   - Not done: the lake doesn't take on the creek's ripple-profile NORMALS in the band. That
     needs the flow samplers in the still material. The alpha cross-fade still blends the
     shading. The full one-surface merge (the clipmap draws creeks) is designed but not built:
     sampler budget, dithered see-through edges, far-creek resolution.

7. **The waterline (Dante: "the world above turning white or dark" near the surface).**
   Headless repro at fixed heights over the drawn water: +0.02 m read "underwater" and the
   surface was culled over bare, unfogged seabed. At −0.02 m the near plane poked through
   the surface: a murk wall under clear sky, no waterline. Causes: one frame-wide switch; a
   camera probe that summed 2 of 6 cascades and ran a frame or two late; a near plane that
   can straddle the water.
   - **Exact state.** `HeightReadbackPass.exactCameraSurfaceY()`: a point probe at the camera
     (every cascade, chop, breakers, ripples, bank sink), carried forward on its rise (at most
     0.1 s and 3 m/s; reads older than `CAMERA_PROBE_MAX_AGE` 0.3 s fall back to the old probe).
   - **The frame goes underwater only when the whole near plane is under**
     (`_nearPlaneExtentY`, 2 cm margin, ±1 cm hysteresis). A/B:
     `ARestlessOcean.WATERLINE_NEAR_PLANE = false` brings back the eye rule.
   - **WaterlinePass** (new `passes/waterline-pass.js`, registered in all 13 script lists and
     make-combined.py): while the near plane can reach the water, a near-plane quad evaluates
     the drawn surface per pixel (`HeightReadbackPass.surfaceGLSL()`, refactored out of the
     probe and shared). Pixels whose ray starts under water get Beer-Lambert murk over the
     refraction G-buffer depth. Where the ray would meet the ceiling (culled, since the frame is
     still above-water), they get the mirror's murk colour, opaque under TIR and clear inside
     Snell's window. Plus a ~2 px meniscus. The murk is kept computed within 30 cm of the near
     plane so it is ready.
   - `water-shader.glsl` reads top/ceiling from `gl_FrontFacing` (`uwSide`) instead of the
     whole-frame uniform. With the mesh single-sided that equals the state.
   - ⚠ **Round 1 failed in Dante's browser** (black lines, lighting changes, no fog held below,
     Liam white). It drew the water DoubleSide within 30 cm of the surface and shaded the
     ceiling while the frame was still above-water. Headless with the FFT AND the breaker clock
     frozen (without that, probes at 1 fps are meaningless) showed two faults:
     - folded chop crests drew their far side through (bright blobs from below, specks from
       above);
     - the mirror target is black while the frame is above-water (it needs the curtain and
       a-land's ocean fog).
     A velocity × age carry-forward also threw the switch around (13 m in one headless read).
     Round 2 dropped DoubleSide and the above-water mirror, capped the carry, added hysteresis,
     and made the overlay cover the ceiling itself.
   - ⚠ **Round 2 broke underwater in Dante's browser** (no fog from below, no Snell's window,
     odd surface transition). `uwSide = gl_FrontFacing ? 0 : 1`, but three draws BackSide by
     flipping gl.frontFace, so the faces it draws report gl_FrontFacing TRUE and the whole
     ceiling was shaded as the top. Fixed with `#ifdef FLIP_SIDED` (as three's own chunks do).
     Found by A/B: the headless driver served the last commit's versions of every changed file
     (Fetch interception) and the frames diverged exactly there. Round 1 hid it: DoubleSide
     does not flip. Needs create-shader.py.
   - **Round 4 (Dante's screenshots: washed-out sky and land, a weak murk strip): BOTH SIDES
     RENDERED FOR REAL.** Every stand-in painted from a render target came out in the wrong
     units: the transmission render's contents are graded per library (self-graded sky, a-land
     tone-mapping its terrain in RTs, Liam not). So while the lens straddles the surface,
     `OceanGrid.tock()` (the ocean-state system's tock, after A-Frame's frame) draws the other
     medium's view straight onto the CANVAS, which gives the same tone mapping and output as any
     frame:
     - clear depth;
     - `WaterlinePass.renderMask()` writes near-depth over the side the frame already owns;
     - render the scene once more in the other state: `_renderWaterlineAirView` (FrontSide
       water, sky fog, dome/sun/moon, no curtain, a-land ocean fog off) or
       `_renderWaterlineWaterView` (BackSide water, ocean fog, a-land `setOceanFog` with
       params kept current in the band, curtain, no sky or spray);
     - the overlay (meniscus only when its side's pass ran) draws last.
     Materials with depthTest off (a-starry-sky's dome, sun, moon) are forced on for the pass.
     The overlay and mask live in their own scenes, so no offscreen pass sees them.
     ⚠ GL trap: with depthTest disabled GL does not write depth either. The first mask used
     `depthTest:false` and protected nothing. It is depthTest on + `depthFunc: AlwaysDepth`.
     Knobs: `oceanGrid.waterlineAirPass` / `.waterlineWaterPass = false` fall back to the
     stand-ins. Cost: one extra scene render, only while straddling. Skipped in WebXR.
     Headless, swim page and ocean page: eye under shows the true blue sky above the line and
     native underwater below; eye above shows the true underwater (teal fogged seabed) below the
     line.
   - **Open after round 4 (Dante, 15:35):** "right near the surface the lighting can get super
     bright" (pale seabed and Liam). Exposure is NOT it (a-land sets it from sun altitude only).
     A still headless camera at ±2 cm / −30 cm on the same spot gives matching teal, so it is
     likely transient. Catch it with `ARestlessOcean.debugWaterline()`, and isolate with
     `oceanGrid.waterlineWaterPass = false` / `.waterlineAirPass = false`. Suspects: the eye-above
     water pass runs without the light volume and with stale mirror/transmission targets (both
     only render with the eye under), and a-land's caustic mode follows the frame's state, not
     the pass's.
   - **Round 5 (from Dante's `debugWaterline()` dumps at the surface):**
     - (a) `exactProbe: null` in one: the exact read ran late (Firefox's async readback), and the
       frame fell back to the coarse probe (2 of 6 cascades), cm off. Now it keeps the last
       exact−coarse offset for up to 2 s instead.
     - (b) At the cusp the eye flips between states, so the SAME underwater pixels alternate
       between the native frame and the eye-above water pass. The pass lacked what the native
       frame has, so it read lighter and greyer: the flare. Fixed:
       - the light volume now ticks in the waterline band too (the pass and a-land get it);
       - the pass puts the fog surface just above the eye (both fogs measure from the eye);
       - the pass re-sends a-land's caustics with `viewerUnderwater: true` (it kept the
         frame's above-water mode).
       Headless comparison numbers were unreliable (the orbit camera frames different seabed
       at different heights). By eye the pass now matches the native look (teal, fogged,
       underwater caustic web). Browser check pending.
   - **Round 6 (Dante: Liam flashes black / white at the cusp, the world a little too):**
     - Idle rings: `water-interactor` `idleRipple`/`idleRate` (a footprint that breathes while
       straddling). Liam's pages: chest 12 mm @1.1 Hz, hands 6 mm @1.6 Hz (×LIAM_RIPPLE).
     - New instrument: `oceanGrid.waterlineDebugForce = 'water' | 'air'` redraws the WHOLE frame
       through that pass, for A/B against the native frame from the same pose. It found the
       passes restoring the water to a fixed side instead of the frame's own. That matters
       because three rebuilds a program when the FOG object changes but NOT when `side` does.
       Now they restore `_wasUnderwater`. With that, both passes match the native frame on their
       side (eye −0.3 m: underwater pass == native; eye +0.3 m: air pass == native).
     - NOT reproduced headless: Liam black (eye under, native) vs white (eye above, underwater
       pass). Next isolation in the browser: `oceanGrid.waterlineWaterPass = false` (does white
       go?), and whether Liam's own caustic/sun term reacts to a-land's `viewerUnderwater`,
       which the water pass flips on for its render.
   - **Round 7 — the flash found (Dante): it happened with the water pass off, in both forced
     modes, and with Liam a metre down while the lens straddled.** So it was the frame's STATE
     flipping, not any renderer: the exact camera probe included the dynamic ripples (Liam's idle
     rings right beside the lens), hysteresis was ±1 cm, and every flip swaps global state (fog,
     a-land ocean fog + caustic mode, which Liam's sun shares, the sky dome) at 3-5 Hz. Now:
     - the state decision uses the surface WITHOUT ripples;
     - hysteresis is ±5 cm while the lens straddles (the passes draw both sides per pixel, so a
       sticky state costs nothing);
     - the passes reuse the frame's shadow maps (`shadowMap.autoUpdate` off during tock). That
       also saves a second shadow render, and Liam's shadow had been missing in the pass.
     Headless: 0 flips in 40 s at the surface with idle rings running (only 42 frames: weak).
     The "white squares popping along the horizon" in `waterlineDebugForce = 'air'` are that
     debug mode drawing the WATER side of the lens as air: the water, culled from below, lets
     the dry seabed through, and far crest faces tilted at the eye pop in and out. Not a real
     path.
   - **Round 8 — THE FLASH, root cause (Dante: "it screws with the mountains … ambient light /
     light probes?"). Yes.** a-land re-captures a-starry-sky's dome through a SKY_LAYER cube
     camera ~4 Hz for `scene.environment`. a-water hid the dome with `visible = false` whenever
     the frame was underwater, so captures taken then were an empty sky, a black environment:
     Liam, terrain and mountains dark until the next capture. Headless: 17 of 38 captures with
     the dome hidden at 8 cm under. Now the underwater hide is `layers.disable(0)` (the main
     camera only), and the transmission pass and waterline air pass re-enable layer 0 for their
     renders. After: 0 of 39 hidden, no dome leak underwater, Liam normally lit underwater.
     (Also explains Liam's "dark silhouette underwater" all along.) Rounds 5-7's fixes stay:
     each was real, none was this.
   - **Confirmed by Dante in the browser (2026-09-27): "Perfect! Got it!"** The waterline works.
     Later idea (his): a surface-tension water LIP on the lens (a meniscus bead and drips as
     the camera leaves the water). It fits WaterlinePass's overlay: it already knows the
     per-pixel distance to the line.
   - **WebXR:** `OceanGrid.tock` skips while presenting, so in a headset the straddle falls back
     to the plain eye flip. To support it: the mask and overlay must derive the near-plane point
     from the built-in per-eye matrices (`inverse(projectionMatrix)`, `inverse(viewMatrix)`)
     instead of the mono `wlInvViewProj`. `renderer.render` in XR already draws both eyes.
   - **Round 3 (Dante: "a no-man's-land where the camera has yet to declare I'm underwater").**
     With the frame flipping only once the whole near plane was under, for ~10 cm the eye
     was under while the world rendered above-water, and the overlay's rough murk stood in
     for most of the view. Now the frame flips at the EYE (exact probe, ±1 cm hysteresis).
     WaterlinePass covers only the sliver on the other side of the line: murk below it with
     the eye above; with the eye under, the air view above it (the transmission render for
     rays going up, a Fresnel water top for rays going down). A/B:
     `ARestlessOcean.WATERLINE_NEAR_PLANE = true` brings back the round-2 rule.
     Two unit traps, both black on metered pages:
     - The murk is a display-space colour (fog is applied after three's tone mapping), so the
       overlay must not tone map it.
     - The transmission sample goes through the WATER SHADER's own curve
       (`aroAESFilmicToneMapping`, no exposure), not three's toneMapping() with the ~1.7e-5
       metering exposure.
     Headless on the swim page: −0.06 m = native underwater with a sky sliver and meniscus
     above the line; +0.03 m = above water with a murk strip below. The sliver's sky reads
     paler than the real one (tone curve), cosmetic.
   - Round 2 headless (frozen rough sea, and the swim page with Liam): straddle = sky / flat
     ceiling murk / fogged seabed, no black, no specks; fully under = native; above = native.
     The straddle ceiling is flat compared with the textured native one: a visible, clean step
     over those ~10 cm. The dark specks in the ceiling above Liam are there fully underwater
     too (not this change). NOT verified: live motion at 60 fps. That is Dante's browser check.

**Tests.** `node tests/dynamic-waves/dynamic-waves-test.mjs` (28 checks): the per-mode decay
rate matches DAMPING + ν·L/2 within 3%; damping doesn't detune; the old form would have; the grid
corner stays stable at the viscosity clamp (8 cells²/s; it goes unstable from ~15, and the first
clamp I wrote, 200, was wrong); the mesh-cell estimate is ≥ the real spacing, ≤ 2× it, and
continuous; capsule contact, still-limb-in-rising-water (no velocity, no spray), wading 2 vs
0.5 m/s, swing velocity, ripple-free footprint.

**Browser check (after the regen)**, on `island-sholes-swim.html` (wind −0.5):
- `ARestlessOcean.poke()`, or wade Liam: rings should visibly LIFT the surface near the camera
  (silhouette and reflections, not just the shading), die within a few seconds, and leave no
  crack or step at 16 m / 32 m from the camera (ring edges).
- The wake behind a wading Liam should fade over a few metres. Too short or too long:
  `ARestlessOcean.DynamicWaves.DAMPING` / `.VISCOSITY` live.
- Swim in waist-deep swell: shins and thighs should spray while cutting the waterline.
- **Liam's ripple strength** (Dante, 2026-09-27: "Liam is too powerful", which was hidden while
  ripples were normals only): new interactor knob `rippleScale` (multiplies the footprint
  depth and the entry crater; spray stays `sprayScale`'s). The swim pages set every contact to
  `LIAM_RIPPLE = 0.5`, which Dante SET BY EYE in the browser (2026-09-27, "about perfect"; the
  first guess was 0.25). `setLiamRipples(k)` still retunes it live.
- Liam should float steady in his own rings (selfRippleK 1); try 0 to see the loop it prevents.
- `setOceanShadowDebug(69)` still shows η.

### Before the build (2026-09-27): branch state and the 8e plan as written

The Liam pass is done and lives in peaceful-island (branch `liam-swim`). Its a-water commits
are on `phase-8-water-state`, and `development` has been fast-forwarded to it:
- 09f437e: `getWaterStateAt` keeps the height snapshot live and adds `opts.probe`, an exact
  point probe of the drawn surface plus its particle velocity.
- c07e43f: the refraction G-buffer no longer double-decodes sRGB albedo (everything seen
  through the water was dark and over-saturated), captures skinned meshes posed, and honours
  alphaTest.
- b3b239c, 12d71f5: interactors ring the water. Footprints are at least 2 cells (they were
  sub-cell, so the energy went in and no ring came out), each interactor has its own probe,
  an entry crater grows with speed, a drag head v²/2g is added (`dragK`), and `sprayScale`.

Branch state: a-water `development` = `phase-8-water-state` (it contains
`phase-9-terrain-feedback`). a-land `main` = `phase-8-body-id`. Nothing is pushed.
A-Starry-Sky's `camera-anchored-sun-light` IS merged into its development.

#### Phase 8e — dynamic waves you can see

Dante, browser, 2026-09-27, with Liam (peaceful-island `island-sholes-swim.html`; wind is
set to -1 there for calm testing): a little splash and a little ring, but nothing on the
ocean. He named the causes, and the code agrees:

1. **Ripples don't fade with distance.** `DynamicWaves.DAMPING` = 0.1/s, so a ring lives
   ~10 s and crosses much of the ±32 m window. Real short ripples die in a second or two:
   viscous damping 2νk² plus the surface film, strongest for SHORT waves. Make the damping
   wavelength-aware: raise the global rate, and/or raise `VISCOSITY`, which already acts
   on ∇² of the velocity and so hits short waves hardest. Judge by eye, a wake fading over
   a few metres.
2. **Ripples only touch the normals, not the height** (an 8b design choice: "centimetre
   ripples live in the lighting"). The clipmap near the camera is 0.25 m/vertex (patch_size 8 /
   32 cells), doubling each ring, and the ripple grid is 0.125 m. So:
   - `water-vertex.glsl` adds `dynamicWavesHeightAt(worldXZ)` inside the window, faded out
     where the ring's vertex spacing can no longer carry it (more than about half the ripple
     wavelength). Needs uniforms and the GLSL in the VERTEX stage too; today it's
     fragment-only (`$dynamic_waves_functions`).
   - Keep the fragment micro slope as it is.
   - Add the same height to the surface probe (`height-readback-pass.js` `surfaceAt`), so
     Liam and floats bob on rings and wakes.
   - Decide whether the ocean CSM caster and the height bake want it (probably not: they're
     metre-scale).
   - The flowing variant's vertex path (FlowSurfacePass) gets it too, which gives rivers
     geometric wakes.
   - ⚠ Needs Dante's `create-shader.py` (water-vertex.glsl + template). Don't run it
     yourself.
3. **No spray running through rough water.** Interactors are spheres at hands, feet and
   chest. In waist-deep swell the feet are deep under and never straddle the surface, and
   the shins and thighs that actually cut the waterline aren't modelled. Add a CAPSULE
   interactor along a bone segment (`target` + `targetEnd`): the contact is where the
   surface crosses the segment (clamped to it), and the footprint, drag head, entry and wade
   spray all come from that point. Then give Liam calf→thigh and forearm capsules on the
   swim pages.
4. **Later, and its own design talk: river shape.** The flowing surface is the solved level
   plus normal-only ripple profiles, so rivers read flat. 8e's item 2 gives them geometric
   wakes and rings for free. Standing waves, riffles and chute shape would need the FV solve
   (or a river heightmap) to supply the surface itself.

Test bed: peaceful-island-swim `island-sholes-swim.html` (Liam + interactors; `?at=1990,2540`
is swim depth, x≈1964 is knee-deep). Headless: a FRESH `--user-data-dir` plus CDP
`Network.setCacheDisabled`, and Liam loads in ~50 s. `DynamicWavesPass.readback()` gives the
field. ⚠ Headless runs ~1 fps, so probes go stale (>500 ms) and fall back to the analytic
twin: test probes in the browser.

### Then Phase 9, in order
1. **Water glow check (9b.3).** On `examples/demos/island-sholes-sky.html` at a low sun,
   the glow should hold still on the ground as the camera moves (debug views 12/13). Then
   settle the `shimmerFalloffM` / `shimmerReachM` / `shimmerShadowRadiusM` defaults with
   Dante. Details: "RESUME HERE (2026-09-26): sun-direction fix BUILT" below.
2. **9c: the ocean's moving swash and a drying clock.** The plan is in the "9c" section
   below. a-water publishes this frame's near-shore surface (swash/breaker) as a small ortho
   RT; a-land keeps a world-anchored wetness accumulation ring and dries it per porosity.
   It's the biggest plumbing of Phase 9. (Liam's per-bone wet/dry in peaceful-island is the
   same idea on a character, and it read well.)

⚠ Dante's page server (http-server :8080) sends `cache-control: max-age=3600`. Hard-reload,
or run `http-server -c-1`, or a test runs hour-old JS.

---

## Phase 8 — `getWaterStateAt`, dynamic waves, interaction — **CLOSED: 8a/8b/8c done, 8d rain deferred** (2026-09-26)

Branches: a-water `phase-8-water-state` (off development 917055d), a-land `phase-8-body-id`
(off main, in the MAIN checkout). 8a committed (a-water 97e9a22, a-land 722fd03). Dante
rebaked island-sholes; body ids are live (around spawn: wet/ocean, wet/lake, and rivers
with none). His "rivers 100% better" came from that rebake picking up the recent solver
work, **not** from 8a: the GPU decode reads class R/G only.

### ▶ RESUME HERE — Phase 8 closed; next is the Liam pass (2026-09-26)

8b committed (24343d2). **8c needs no regen**: pure JS, no GLSL. (8b's ripples still need
`create-shader.py` to draw.)

**What 8c is.** `src/js/ocean-system/components/water-interactor.js`:
- **`ARestlessOcean.WaterInteraction.impact(x, y, z, speed, n?, countScale?)`**: the one
  spray path. The grid's `buoyancy-splash` listener now goes through it too.
- **`WaterInteraction.Interactor`**: a sphere following a point. Each frame it reads
  `getWaterStateAt` (with velocity) and does three things:
  - Keeps a DynamicWaves **emitter**: waterline radius, volume-matched depth, fading once
    the sphere is covered deeper than its radius.
  - **Sprays** on entry (the water closing faster than 0.8 m/s) and while **wading**
    (through the waterline faster than 1.2 m/s relative to the CURRENT).
  - Keeps a **`state`** (inWater, submerged fraction, depth, surfaceY, the water's
    velocity, its own velocity) and fires enter/exit callbacks.
- **`water-interactor` component**, multiple instances allowed.
  `target` names an object inside the entity (a bone, e.g.
  `water-interactor__lhand="target: mixamorigLeftHand; radius: 0.08"`), and `offset` is in
  the target's space. The entity gets `water-enter` / `water-exit` events. This is the
  hook Liam will use: a handful per limb plus the torso, with `state.submerged` choosing
  walk / wade / swim.
- **Flow-riding debris**: `buoyant` gains `drift` (default on) and `driftTime` (1.5 s). The
  horizontal velocity relaxes toward the current at a rate scaled by the submerged fraction,
  and the body runs aground where the next step would be dry. It uses the current only, not
  the orbital velocity: the twin's phases would rock a float out of time with the visible
  waves.

**Verified.** Node unit test (mocked water state, 10 checks), including:
- one enter and one exit, and entry spray at the closing speed;
- the Gaussian volume equal to the displaced volume;
- wading at 2 m/s sprays and at 0.5 m/s doesn't;
- riding a 2 m/s current doesn't spray; dry ground is never "in water".

Two bugs came out of it. The first frame (and a teleport) read as "still" and sprayed in a
current; spray now waits for a known velocity. Headless on island-sholes (4090):
- A 3 m/s plunge gives one `water-enter` and two spray events, plus a ring.
- Wading 2 m/s: 17 sprays in 3 s and a visible V-wake. At 0.5 m/s: 1.
- A debris box in a 2.9 m/s creek reaches ~2.2 m/s and travels 15 m downstream in 10 s,
  following the creek's level down (11.4 → 10.6 m).

The second bug: wading was first measured against current + orbital. The twin's ~1 m/s
rms orbital (right size: Hs 2.9 m gives 0.94 m/s, theory ~0.8) is phase-random against the
rendered sea, so slow waders sprayed at random.

Harness note: calling `regenerateH0(wind)` directly leaves the twin at the old wind. The
real path (ocean-state.js:182) updates `data.wind_velocity` first, so there is no bug.

**Phase 8 CLOSED (2026-09-26).** 8d rain is **deferred by Dante**: no rain this iteration.
When it comes back, it is a field of ring kernels fed through the same DynamicWaves emitters.
The avatar (Liam swimming via `water-interactor` on his bones) is Dante's Liam pass, and it
doubles as the browser check of 8b/8c ripples.

### (earlier) RESUME HERE — 8b built (2026-09-26)

**Needs Dante: run `create-shader.py`** (water-shader.glsl → water-shader.js). Before the
regen the pass runs but nothing draws it: the old water-shader.js has no
`$dynamic_waves_functions` token, so the splice is a no-op. That makes it safe to load
either way. Then on island-sholes-ocean:
- `ARestlessOcean.poke()` (a stone 3 m ahead) and `setOceanShadowDebug(69)`.
- Drop an `<a-box buoyant>` into a creek or a calm lake. Rings are faint under an 8 m/s sea,
  which is correct: 2 m chop swamps centimetre ripples.

**What 8b is.** `ARestlessOcean.Passes.DynamicWavesPass`
(`src/js/ocean-system/passes/dynamic-waves-pass.js`; its header has the full model). An
iWave-class height field: 512² at 0.125 m (±32 m), camera-centred and world-snapped,
recentred by whole-cell shifts, fixed 1/60 s steps. It is spliced into the fragment of BOTH
water variants as micro slope only, not the macro normal. Cm ripples on a 1–2 m mesh are a
lighting feature, so there is no vertex, CSM, height-bake or CPU consumer. Debug mode 69 shows it.
- **Dispersion from a fitted kernel bank.** Radius 8 (197 taps, 30 radial classes),
  least-squares fitted at load to k·tanh(k·h) for h = 0.5/1/2/4 cells, over the whole
  Brillouin zone, with zero DC and a positivity re-weighting pass. The error is 3.5–7.7% in
  band. Deeper than 4 cells, waves longer than ~2 m run as over 0.5 m of water (a compact
  kernel's limit).
- **Variable depth, symmetric.** Σ_j K_{h_ij}(η_j − η_i) with the PAIR depth ½(h_i + h_j),
  from the WaterField. Dry cells are η = 0 walls, so banks reflect.
- **Advection** by WaterField RT1 flow, Catmull-Rom with a neighbour clamp. Rings ride the
  creek downstream.
- **Sources** are emitters: a Gaussian footprint pressed `depth` m down. The CHANGE since
  last frame is injected as a displacement (into η and η⁻ together). `buoyant` bodies are
  emitters by default (`ripples: true`): radius √(footprint/π) and depth = mean submerged
  height, so the Gaussian volume equals the displaced volume. `poke()` is a stone
  (`release: false`).

**Three bugs found and fixed headless, all worth remembering:**
1. **Tessendorf's closed-form kernel** truncated to 13×13 is off by up to 2× across the band
   and has non-zero DC. That is why the kernel is fitted instead.
2. **A kernel fitted only for |k| ≤ π along a few angles** left the Brillouin-zone corners
   free: R(π, π) = −55, an exponentially growing checkerboard (NaN in seconds). It is now
   fitted over the whole zone. The kernel of a cell's OWN depth was also non-symmetric,
   and the pair-depth form fixed that. A CPU replica stays bounded undamped over flat,
   0.4 and 0.08 beaches.
3. **Sources subtracted from η⁺ only** turned each displacement into a velocity kick
   (Δ/dt), overdriving a bobbing box's rings ~10× (a 0.4 m box made 4.7 m rings).
   Subtracting from η⁻ as well fixed it: the same box now peaks at its own plunge depth
   under itself.

**Verified headless (4090, scratch regen served via CDP Fetch, island-sholes):** no shader
or program errors; self-test 10.10004; **0.02 ms/step**; 60 fps.
- 5 cm stone at sea: the ring front runs ~1.1 m/s and decays 1.3 cm → 0.3 mm over 20 s.
- Creek at 2.6 m/s: the ring is carried ~10 m downstream in 3 s.
- Calm sea: a dropped 1 m box rings, then decays to 2 cm; a box dragged at 1 m/s leaves a
  5 cm wake.
- Rough sea: a box tossed ±1.6 m stays ≤ 0.56 m under itself.

**Next.** 8c: the interaction-emitter API (generalise `buoyancy-splash` with emitters), and
Liam as an emitter. 8d: rain.

### (earlier) RESUME HERE — 8a built (2026-09-26)


**No create-shader.py run is needed.** No shader changed. **For body ids, run Solve Water +
Bake & Export** on a world (island-sholes has the ocean plus lakes). Until then `bodyId` is
null everywhere, because old tiles have class.B = 0.

**What 8a is.** `ARestlessOcean.getWaterStateAt(x, z, out?, {source, velocity})` in
`src/js/ocean-system/field/water-state.js`, installed by OceanGrid right after
HeightReadbackPass. It returns status, level, surfaceY (+ which source answered it),
depth, flow (vx/vz/energy/flowWeight), orbital velocity, type/waterType and
bodyId/waterBody. It is one front door onto the three existing sources (a-land getWaterAt,
the FFT snapshot, the Gerstner twin), not a new source of truth.

**The premise was stale** (see the note under Phase 8 in WATER-TYPES.md): rivers already
answered with river level. 8a's actual fix is `status`: the decoder's `answerAt` now tells dry,
loading and outside-the-world apart, where every caller used to read all three as sea.

**Shims, answers unchanged.** `sampleWaterHeight` (twin), `sampleWaterHeightFFT`
(snapshot) and `queryFlow` are rewired over getWaterStateAt. A Node harness checked them
byte-identical against the pre-8a implementations across wet/dry/loading/outside/standalone.
Kept on their own samplers, because they are shape queries rather than state:
`sampleWaterDisplacement/Normal`, `sampleWaterRiseFFT/SlopeFFT`, `sampleWaterHeightFFTExact`.
For `dry`, level/surfaceY still hold the legacy fallback number so the shims stay exact. Read
`status` before floating anything.

**Orbital velocity.** The twin's analytic d/dt of the Gerstner sum without chop: water
moves at A·ω, and chop only leans the drawn crest. Node-checked against a numeric derivative
of sampleDisplacement. Inside the snapshot, the vertical part is replaced by the rendered
surface's rise (right phase); the horizontal part stays the twin's (right statistics, phase
unknown). In flowing water it is ~0, because the masks already hand the FFT off there.

**Body ids (a-land).** The worker now always ships `body` (it used to only with routing).
It is parked on `B._waterSolve.body`, and WaterTileExport writes class.B = id + 1 from the
wettest cell (like type). WaterReader decodes it as `body`. The contract §2 is updated.
Rivers get none, because WaterSolve claims only the ocean and lakes. River bodies wait for
Phase 7's hydrograph. The FV pass doesn't touch `body`, so its extra wet cells read as no
body. Tests: check-export (+7 asserts), whole water suite, navmesh/lighting/compile checks
all pass.

**Browser check.** On island-sholes-ocean, `ARestlessOcean.debugWaterStateAt()` at the
camera, then at a creek, a lake, dry ground, and past the world edge. Expect: creek → wet +
flow + body null; lake → wet + body (lake) after a rebake; dry → dry, depth 0; outside →
open-ocean. Also confirm floats and spray behave exactly as before (the shims).

**Liam will not show any of this yet.** Wading and swimming come from a-land's
`NavmeshQueryCore` (→ a-land `getWaterAt`, static level, no waves). Making the avatar ride
the moving surface is a consumer change: navmesh/avatar asks
`ARestlessOcean.getWaterStateAt` for surfaceY + orbital velocity when a-water is present.
That is next, alongside 8b.

**Next.** 8b local dynamic-waves sim; 8c the interaction-emitter API (generalise
`buoyancy-splash`); 8d rain. The avatar hookup above belongs with 8c.

---

## Phase 9 — terrain feedback: wet ground and caustics — **9a written + compile-verified, awaiting a-land regen + browser** (2026-09-25)

Branches: a-land `phase-9a-wet-band` (off main 3105c0a, in the MAIN checkout), a-water
`phase-9-terrain-feedback`. The `a-faraway-land-lbm` worktree was removed (lbm-river-solver was
fully merged into main).

### ▶ RESUME HERE — 9a built (2026-09-25)

**Needs Dante: run a-land's `src/python/create-shader.py`** (terrain.frag → shaders.js). No
a-water regen and no re-bake: the band reads the RT0 cascades a-water already hands over.

What shipped (a-land only):
- `terrain.frag`: `alandWaterFieldAt` (all of RT0, same cascade ownership and crossfade;
  `alandWaterFieldLevelAt` wraps it), `alandWetState` → (wet, porosity, film, submerged).
  Wet albedo (darken + saturate by wet × porosity) and film normal flattening go in BEFORE the
  surface capture, so a-water's seabed and SSR see wet ground too. Wet gloss =
  `mix(wet, film, porosity)` outside water. **F0 now runs through `g_dielectricF0` at all
  three sites** (0.04 dry → 0.02 film → 0.004 submerged, grain-to-water). Debug view 11
  (`aland-debug-render` HUD, "wet ground"): red bank, green film, blue submerged.
- `MaterialLibrary`: row 1 b/a of paramsTex = porosity / capillary rise, from
  `WETNESS_BY_SURFACE[surfaceType]` with per-material `porosity` / `capillaryRiseM`
  overrides (schema-validated; add/update handle them). Existing worlds need no re-save.
- `TerrainMaterial`: `u_wetOn/u_wetBand/u_wetLook` shared like the other field uniforms, on
  only while all three cascades are bound; live knobs on `ALand.runtime.TerrainMaterial.wetness`
  (copied in every `setWaterField`, so console edits stick):
  `enabled, bankBandM 1.5, runningBandM 2.5, capillaryScale 1, submergeFadeM 0.05,
  albedoAtFullPorosity 0.55, saturation 0.35, filmRoughness 0.08, filmFlatten 0.6`.
  **All starting points, none measured.**

Verified: `tests/test-sampler-budget/check-shader-compiles.mjs` on the 4090 (every variant
compiles and links, worst 18/32, no new samplers: the clip already pulled all three cascades
into every shading variant); splat-index (93+58+26), height-blend (25), layer-lifecycle (19),
project-file materials/manifest/save-writes all pass. **Not seen rendered yet.**

What to look at: island-sholes-ocean and hero-creek(-sky). Debug view 11 first (is the band
where the water is, at a sane width?), then lit. Suspects if it looks wrong: (1) cascade-2
texels are coarse, so far banks band blockily (expected; fade `bankBandM` by distance if it
shows); (2) ocean beaches only get a band at the MEAN sea level (the swash wetting is 9c);
(3) `sub` uses a 1 m slop on the dry side of shoreSDF, so a painted dry zone below a lake's
level within 1 m of the shore reads wet.

### 9a round 2 — Dante's first look (2026-09-25): "looks good", two problems

- **Caustics swim forward, then twitch back. FIXED (a-land, needs regen): round 17's bug, on a
  newer path.** a-land's underwater receive (`alandCausticMod`, added 09-22) measured depth
  from `u_uwSurfaceY`, which a-water fills with `probeWaterSurfaceY()`, the WAVE-DISPLACED
  surface at the camera. `hitXZ = xz − L.xz/upY · below`, so each wave slid the pattern by its
  height × the refracted sun's slope and back again. That is round 17 (projector pose on the
  probe) again, in code written after that fix. It now reads the STILL level per fragment from
  the field (`alandWaterFieldLevelAt`, new `u_waterFieldOn`), falling back to the probe only
  without a field. The fog keeps the probe (the air/water swap needs the real surface). This is
  also 9b's per-body depth. ⚠ If the twitch was seen from ABOVE water in a creek, this is not it:
  suspect the two-phase advection crossfade there (`CAUSTIC_ADVECT_PERIOD` 2 s × creek speed vs
  1 m cells; the smoothstep threshold is applied AFTER the mix, which turns the crossfade into a
  switch). Not changed until Dante says where.
- **White stair-stepped rings where the water meets the bank. NOT diagnosed yet.** Stair-stepped
  at field-texel scale, so something keyed to per-texel wet/dry. Suspects: (1) 9a's film strip
  (glossy, roughness 0.08, right at the waterline); (2) the still path's `dryTaps > 0.999` cut,
  which its own comment says draws "the one-metre texel staircase"; (3) foam. A/B asked of
  Dante: `ALand.runtime.TerrainMaterial.wetness.enabled = false`, then `filmRoughness = 1,
  filmFlatten = 0`, and a-land debug view 11 at the same spot.

### 9a round 3 (2026-09-25): the ring was the wet band; the caustic fix was not live yet

- **Ring: FIXED (a-land, needs regen).** Dante's A/B: it's the wet band, and it runs around
  the OUTSIDE of a damp patch. Cause: `sub` (depth under the local level > 5 cm) switched the
  gloss OFF (F0 0.004, the grain-to-water look) and the film switched it ON only where the
  depth ran out. Where a-water does not draw thin water, the patch was dull inside with a
  glossy rim. The dull look is the VIEWER's: only a submerged viewer sees the grain-to-water
  interface. From above, submerged ground is either under a-water's surface (whose seabed
  shading replaces ours) or under water too thin to draw, which is a film. `sub` is now
  gated on `u_uwFogOn`, and the film covers submerged ground above water. This also takes
  `sub`'s texel-scale shoreSDF gate out of the gloss.
- **Caustic twitch "still present": the fix wasn't in the regenerated file.** shaders.js was
  regenerated 09:55 (it has alandWetState, but `u_waterFieldOn` appears 0 times); the fix
  landed in terrain.frag at 10:06. Not a cache: needs one more a-land regen. ⚠ Still open after
  that: underwater, a-land's terrain ALSO receives a-water's projector SpotLight cookie
  (`terrain.frag` spot loop, `spotLightMap`), so the bed carries two caustic patterns. The
  projector is still anchored to the still level (round 17 intact, `caustic-projection-pass.js:354`),
  so it should not twitch, but this is exactly the double-draw Dante's toggle decision
  (a-water's caustics off when a-land's are on) removes. That's 9b.

### ▶ RESUME HERE — 9b built (2026-09-25): a-land owns the caustics

Plan: `~/.claude/plans/validated-rolling-pretzel.md`. a-land branch `phase-9b-caustics` (off
`phase-9a-wet-band`); a-water stays on `phase-9-terrain-feedback`.
**Needs Dante: a-land regen** (`cd a-faraway-land/src/python && python3 create-shader.py`). a-water
changed JS only, no regen.

- **a-water, the switch:** `<ocean-caustics projector="auto|on|off">` (`caustics_projector`, default
  auto). Auto REMOVES the SpotLight projector when a-land advertises `ALand.runtime.waterCaustics`
  (v1): one recompile at load, never per crossing, and every lit program gets back the
  `spotShadowMap` + `spotLightMap` units and loses a shadow depth pass. An older a-land keeps the old
  stand-down. `setCaustics` is now sent EVERY frame with `viewerUnderwater` and `sunDirAir`; an
  a-land without the capability still only gets it while submerged. The water shader's own
  above-water seabed caustics are unchanged.
- **a-land, one copy of the math:** terrain.frag's caustic block is fenced
  (`// @aland-caustics-begin/end`) and self-contained. ObjectMaterial cuts that span out of
  `ALand.runtime.shaders.terrainFrag` (no new generated file, no page edits). Each side supplies
  `alandCausticLevelAt` / `alandCausticWaterAt` / `alandCausticSunVisAt` (terrain: 3 cascades,
  horizon + object shadow; objects: cascade 0, `alandHorizonShadow` + `alandObjectSunShadow`).
- **Objects underwater:** caustic on light 0 in `_sunLitChunk` (twin of terrain's `dlColor *=
  sunCaustic`). ARMED LAZILY: compiled in only after the first `setCaustics`
  (`ObjectMaterial.armCaustics` → `invalidate()`), so a scene without an ocean pays nothing.
- **Reflected-sun shimmer (terrain + objects, viewer above water):** `alandShimmer`: the water point
  W under the reflected sun ray, Schlick r0 0.02 at the sun's incidence, water presence at W, the
  sun's visibility AT W, faces that see the water only (`dot(N, −dR)`), the same caustic pattern
  along the path. Diffuse only, not under P's own shadow. Knobs on `ALand.runtime.waterCaustics`:
  `shimmer` (true), `shimmerReachM` (20), `shimmerGain` (1 = physical). Debug view 12 (×20).
- Verified: `check-shader-compiles.mjs` on the 4090, terrain unchanged (worst 18), and the page
  now arms caustics through a real `setCaustics` and compiles BOTH object variants: unarmed 4
  units, armed 6, both link. `node --check` on all edited JS. **Not seen rendered.**
- Stages 2 and 3 landed together (they share the span). To judge the underwater half alone,
  set `ALand.runtime.waterCaustics.shimmer = false`.

What to look at: (1) swim near rocks/trees in island-sholes: one caustic pattern on terrain AND
objects, no twitch; `oceanGrid.causticSpotLight.parent` should be null. (2) Above water at a low
sun, a rock face or bank beside the water: dappled shimmer (view 12); none on flat ground; none
where the reflecting water is shaded. Suspects if wrong: shimmer too faint at a high sun is
PHYSICAL (2%); the object field lookup ends at 256 m (cascade 0).

### ▶ RESUME HERE (2026-09-26): sun-direction fix BUILT, test the water glow

**Next:** on `examples/demos/island-sholes-sky.html` (now on the new sky build), fly at a low sun
and check the glow holds still on the ground instead of sliding with the camera (debug views
12/13; `StarrySky.Methods.getDominantLightDirection()` should not change as you move). If it
still moves: confirm a-land `f922a43`'s glow shaders were regenerated, then suspect the glow's
own `h / tan(elevation)` placement. Then settle `shimmerFalloffM` / `shimmerReachM` /
`shimmerShadowRadiusM` defaults with Dante.

What landed (a-land + a-water now committed; A-Starry-Sky still UNCOMMITTED):
- **A-Starry-Sky, branch `camera-anchored-sun-light`** (off development): `LightingManager.js`
  owns `sourceLightTarget` (named `starry-sky-source-light-target`), set to the camera's world
  position each tick, light at target + 5000 × dir; new `StarrySky.Methods.getDominantLightDirection(out?)`.
  Plus two development-branch bugs that blacked out the dome: `starSkyWashoutRate` /
  `starDaylightCutoffFade` declared outside the metering pass (moved into `#if(!$isSunPass)`),
  and the dome's `AgXToneMapping` / `PBRNeutralToneMapping` colliding with three's injected
  tone-mapping chunk (renamed `sky…`, as the fog chunk already did). Dome confirmed back.
- **a-faraway-land, on `phase-9b-caustics`** (beside a staged `shaders.js` that is not ours):
  `land-terrain.js _anchorForeignSun` keeps the new rig (only drops its shadow map);
  `SkyEnvironment.js` also recognises the `skyToneMap` grade line. Tests 701/701, 8/8.
- **Consumer pages:** every page on the new sky build needs
  `<sky-assets-dir dir="milky_way" milky-way-path>` + the two Milky Way webps, or the dome
  waits forever. Added to peaceful-island and all five `examples/demos` sky pages (gitignored).
  `examples/personal-ocean/islands.html` not done.
- Open side issues: Liam's fragment shader declares 33 samplers (limit 32) in headless;
  peaceful-island 404s three wind files that aren't on a-faraway-land's current branch.

#### Caustics ride the water they formed under, not the camera's (2026-09-26, CONFIRMED by Dante)

Committed: a-land `e00915b` (+ `8ea606c`, the sun rig below), a-water on `phase-9-terrain-feedback`;
both fast-forwarded (a-water `development`, a-land `main`). A-Starry-Sky left uncommitted (another session).

Dante: the caustic current follows the water under the CAMERA. It did: `setCaustics` sent
`waterFlowAt(camera)` as one uniform (`u_causticFlow`, "the current the viewer is in"), and the
flowing-water min tile (`scale.z`) was picked by the same camera test. So a creek dragged the sea
bed's web, and the sea froze the creek's. No bake: the per-point current is already on the GPU.
- **a-water** (`ocean-grid.js _causticFlowField`): `setCaustics` also sends `flowField`,
  FlowFoamPass's window (gb = the current, the field the flowing surface's ripples ride) + centre,
  half-width, advect period, the FlowHandoff speed ramp and both min tiles. `flow` is kept for an
  a-land that predates it.
- **a-land** (`terrain.frag` caustic span, `TerrainMaterial.js`): `alandCausticCurrentAt(pxz)`
  reads the current where the light CROSSED THE SURFACE, and 0 outside the ±128 m window (faded
  over its last 10%). The min tile blends still→flowing on the same ramp. Two phases run
  everywhere once the window is bound (the branch must stay uniform); phase B's decorrelating
  offset scales with "flowing", so still water can't pulse. Objects get it through the shared
  uniforms. +1 sampler: `check-shader-compiles.mjs` all link, worst 20/32, caustics object 8.
- a-land regen done by Dante; "That's a bingo".
- Look for: stand in a creek and look at the sea bed (still web); stand at sea and look up a creek
  (web moving downstream). If the 2 s crossfade reads as a pulse on fast water, that's round 2's
  open item (smoothstep after the mix), now visible everywhere a creek is in view.

#### (history) PAUSED on an a-starry-sky sun-direction bug (2026-09-25)

The water glow "races" with the camera. Cause, verified in A-Starry-Sky: `LightingManager.js` puts
the sun light at `RADIUS_OF_SKY (5000) × sunDir` around the WORLD ORIGIN (`:591-593`, `:524-526`),
adds it to the scene root (`:40`), and makes its target THE CAMERA (`:23`). Every
`target − position` sun direction is therefore off by up to ~asin(|camera.xz| / 5000): about 36° at
island-sholes' (1537, 2522), and it swings as the camera moves. The glow places its pattern at
`h / tan(elevation)` metres along that direction, so at sunset it slides metres per step.
**It isn't only the glow:** three.js's own direct sun and shadows on a-land terrain and objects, and
every a-water sun term (`ocean-grid.js:1978, 2196, 2415, 2615`, `caustic-projection-pass.js:306`,
`ocean-shadow-pass.js:66`) use `position − target`.
Proposed fix (Dante to choose, in A-Starry-Sky): place the light at `camera + 5000 × sunDir` each frame
(target stays the camera), so every consumer gets the exact direction. Alternative: a-water-only
workaround `−normalize(position)` (leaves three's own terrain/object sun skewed).

Glow state before the pause (a-land `f922a43`, needs regen): the wet-strip cutoff is removed (it glows
down to the troughs); strength follows the sun's height, `shimmerStrength` 1.5 (30°+) →
`shimmerStrengthLowSun` 2.0 (5°), Dante's tuning; `shimmerPatternDepthM` 5 (cells as the underwater
caustic at 5 m; the size caps at ~3.3 m); debug views 12 (glow ×20) and 13 (factors: sunlit / falloff / facing).
Still to settle with Dante: default `shimmerFalloffM` / `shimmerReachM` / `shimmerShadowRadiusM`.

### 9b.3 (2026-09-25): the WATER GLOW replaces the physical shimmer

Dante on 9b.2: "the areas that are lit are so well lit you can't even see it". Physics agrees:
the rough mirror's mean is ~2% of the sun at 14:00, lost under direct light; the physical effect
is only worthwhile in shade. His spec, now built (a-land, needs regen): a GI-style fake for shade
near water. `alandShimmer` is now a **look term** (flagged in the shader):
- falloff `1/(1+(r/r0)²)` in the 3D distance r to the water (height above the still level, distance
  from the shore): 1 at the waterline;
- occlusion = the SUNLIT FRACTION of the water within `shimmerShadowRadiusM` (12 m), from the
  WaterLightField mips (now RG: sunlit water, water; R/G is exact even in half-shore patches). A
  mountain's shadow on the water kills it, a tree's barely dents it;
- the grey caustic pattern, projected along the sun's mirror direction (no vertical streaks), moving
  on the water's clock;
- strength `shimmerStrength` (0.25 of the sun) × falloff × sunlit fraction; additive, so it reads in shade.
Knobs on `ALand.runtime.waterCaustics`: `shimmer`, `shimmerStrength` 0.25, `shimmerFalloffM` 1.5,
`shimmerReachM` 8, `shimmerShadowRadiusM` 12 (`shimmerGain/LobeScale/MinSlope` are gone). a-water's
`slopeVariance` is still sent and now unused (kept for a baked water view).
Verified: compile page on the 4090, all variants link, the bake reads back 1/0 on both channels.
**Round 2 (Dante):** (1) "doesn't follow the camera past the first island": the code does follow
(cascade 0 re-centres every metre, `water-field-pass.js:672`; the bake reads the centre live and
publishes its frame), so the likely cause is (2): the glow landed on sunlit horizontal shore, where it
is invisible, and only read on the first island's shaded cliffs. Check if it persists:
`sharedWaterUniforms().caustics.u_waterLightFrame.value` should track the camera. (2) FIXED (a-land):
view factor `(1 − N.y)/2` of the water plane below, ×2, weighted by facing toward or away from the
water along the shoreSDF gradient (the span's lookup is now `alandCausticShoreAt` → (dist, grad)).
Flat ground and beaches get none; sea-facing cliffs and overhangs get it all.
**Future (Dante's idea):** an authored a-land editor "caustic light", like a point light that casts
the caustic onto terrain, for placed water features.

### (superseded by 9b.3) 9b.2 (2026-09-25): the water as a light source, a ROUGH mirror

Dante: the flat-mirror shimmer "reads too sharp and is invisible in any shaded areas, even though
those might be in range of a secondary bounce". Right: a choppy sea throws the sun into a lobe
(half-angle ≈ atan(2σ)), so a receiver gathers sunlit water from a patch around the mirror point.
a-land's probes can't supply it (LightBake bakes static lights only; sun and sky are real-time,
the sky only as `skyVis`), so it is a runtime field. Plan: `~/.claude/plans/validated-rolling-pretzel.md`.
**Needs Dante: a-land regen.** a-water: JS only.

- **a-water:** `setCaustics` carries `slopeVariance` = Σ `cascadeRMSSlope` × `waveHeightMultiplier²`.
- **a-land `ALand.runtime.WaterLightField`** (inside ObjectMaterial.js's closure: it needs `SUN_GLSL`
  and the bus, and no page needs a new script tag). A 512² R16F top-down map over field cascade 0,
  texel = `water (texel of slack) × horizonShadow × objects' sun shadow` at the still level, mip-mapped,
  baked every frame by `land-terrain._tickWaterLight` while caustics are handed over and the viewer is
  above water. Published as `u_waterLight` + `u_waterLightFrame` (the frame recorded AT BAKE TIME, so
  tick order can't put the map one cascade snap off).
- **`alandShimmer` now gathers:** footprint `r = t·tan θ / max(dR.y, 0.2)` → one `textureLod` at the
  matching mip; facing softened by sin θ (no hard cutoff line); caustic contrast × `exp(−r/tile)` (crisp
  just above the water, a glow higher up). Energy-consistent with the flat mirror over uniformly lit
  water, so `shimmerGain` 1 is still physical. New knobs: `shimmerLobeScale` (1; **0 = the old flat
  mirror, for A/B**), `shimmerMinSlope` (0.05, calm lakes and creeks). `alandCausticWaterAt` /
  `alandCausticSunVisAt` removed from the span (the map does that work now).
- Budget: terrain 18 lit / 19 editor, armed objects 7, the bake 3 (4090 limit 32).
- Verified on the 4090 (compile page): every variant links, and a synthetic 16² field (water left, land
  right) bakes to **1.000 / 0.000** read back. splat-index, layer-lifecycle, project-file pass. **Not
  seen rendered.**

What to look at: island-sholes-sky, view 12 and lit, at 14:00 and at a low sun. A shaded rock face looking
onto sunlit water should now glow softly; crisp ripples just above the waterline, softer higher up; no
hard line. Physics still says a noon shimmer is faint (F ≈ 2%).
Deferred: a baked "water view" (the `skyVis` analogue) if light visibly leaks behind rocks (the gather
can't see an occluder between the water and the receiver).

### 9b round 2 (2026-09-25): the shimmer is physical, so noon is invisible; a shoreline bug

Dante on island-sholes-sky near midday: shimmer only appears at `shimmerGain` 1000, on one rock,
never below the damp line. Two causes:
- **Physics, correct:** at a 65° sun F ≈ 0.02, and the reflected ray climbs at 65°, so
  `dot(N, −dR)` is ~0.05 on a near-vertical face: ~0.1% of the sun. At a 10° sun F ≈ 0.4 and the
  ray is nearly horizontal: ~100× more. **Dante chose to stay physical and judge it at a low
  sun** (not a look gain, and not a projected caustic band; that stays available as a separate
  flagged term if wanted later).
- **Bug, fixed (a-land 2nd commit, needs regen):** the water test at the reflecting point
  (`smoothstep(-0.5, 0.5, shoreSDF)`) called the first half-metre-plus beside a steep rock dry
  (the field's shoreline sits half way between 1 m texel centres), and for low points the
  reflecting point is that close (h / tan(elev)). Now `smoothstep(-1.5, 0, sdf)`, both sides.
- Reflection no longer disperses (one grey tap per octave).
- Not Jerlov-shaded, by design: reflected light never enters the water. Only F and the sun's
  visibility at the water point dim it.

### 9a round 4 (2026-09-25): both fixes live, "my land feels alive for the first time"; damp tail

The round-3 "not taking effect" was a regen run in the wrong folder (a-land's create-shader.py
only works from `a-faraway-land/src/python/`, and it is a watcher). Once regenerated, the ring and
the caustic twitch are both gone.
**Damp tail added (needs regen):** darkening now reaches past the wet band, dark but never
glossy (the partly saturated zone above the capillary fringe). The same profile stretched by
`wetness.dampReach` (2.5×, in height and width) at `wetness.dampDarkness` (0.6 of full), squared
so it thins out. Gloss/F0 still follow the wet band only. Debug view 11's red is now the full
moisture (band + tail).

### Caustics ownership — Dante's decision (2026-09-25)

**a-faraway-land owns the look on everything it shades** (terrain chunks AND objects such as
trees): the enhanced caustics become a chunk in a-land's shaders. a-water keeps its current
caustics but gains a **toggle to switch them off**, and it only reports above- vs below-water
view to a-land. When a-land's enhanced caustics are on, a-water's own are disabled. This
replaces the "who draws a creek bed seen from the bank" question in 9b below.
Deferred to its own branch: replace a-water's underwater fog on a-land's side with real
raymarched underwater fog + god rays, instead of tuning the built-in fog. It's error-prone,
so it stays out of 9b.

### The brief (as written before building)

Nothing built yet. Chosen over Phase 7 on 2026-09-25. Most of Phase 7's visible payoff (plunge
pools) was already covered by the fall-site carve and traced impacts, and its export amendment
would force a re-bake of every world. Phase 7's a-land export change (`bodies[].id`, `edges[]`,
`waterfalls[].from/to`) plus amendment 6 (`heightBakeId`) should ride along with one of Dante's
Solve + Bake runs whenever it happens, rather than force a bake of their own.

### What exists already (checked 2026-09-25, do not rebuild)

- **a-land's terrain already binds our three RT0 cascades** (`terrain.frag:756-793`,
  `TerrainMaterial.setWaterField`) for the mirror clip. RT0 = `level, depth, shoreSDF, dryMask`,
  and on a DRY texel `level` is the **nearest water's level** (`water-field-pass.js:479`), `.a` is
  `1 + w` of that water's still/flowing weight, and `shoreSDF` is negative metres to the shore.
  A bank fragment therefore already knows how high it sits above the water beside it, how far
  it is from it, and whether that water flows. **The static wet band needs no new texture.**
- **The contract's `@inject` sockets are superseded by typed channels.** Terrain materials splice
  once at construction and never re-subscribe (`TerrainMaterial.js:145` banner), so
  `setWaterField` / `setCaustics` / `setOceanFog` are how the two repos talk to each other now.
  Wetness follows the same pattern. Amend contract §4 when this lands.
- **Terrain caustics underwater already respect shadow**: `sunCaustic` multiplies `dlColor` beside
  `dirShadow` (`terrain.frag:~1900/1950`). But the depth comes from ONE `u_uwSurfaceY`, so it is
  ocean-only, and it is gated on the viewer being submerged.
- **Objects**: a-water registers nothing with `material-extensions`. The `ObjectMaterial.js` header
  promises wetness + caustics, but neither exists. Whatever objects get now comes from the caustic
  SpotLight projector (verify).
- a-land reserves `weather.wetness` (`editor/src/save.js:1528`): rain feeds the same function later.

### The F0 trap (Dante asked, 2026-09-25)

Disney's `specular` 0.5 → F0 0.04 (IOR 1.5). Water's IOR is 1.333 → F0 0.020 (specular ≈ 0.25).
**Our water is right everywhere** (`r0 = 0.02` in water-shader, waterfall-sheet and horizon-skirt; the
Karis ceiling, the CT glint and the underwater path all use it). **a-land hardcodes F0 0.04 at three
sites**: `ggxBRDF` (`terrain.frag:1074`), the area-light LTC (`:2101`) and the environment (`:2148`).
Wet ground reflects off a water film, so its F0 goes **DOWN** to 0.02 as the film forms. The "shine"
of wet ground is roughness dropping, not F0 rising. All three sites must take the same
wetness-driven F0, or direct and environment specular disagree at the waterline.

### 9a — static wet band (lakes, rivers, ocean mean level). a-land `terrain.frag` only, a few ALU

Insert after the material is final (after the impressions block, `terrain.frag:~1793`), before lighting:
- `vec4 wf = alandWaterFieldAt(xz)`: generalize `alandWaterFieldLevelAt` to return all of RT0
  with the same cascade crossfade (⚠ each cascade's SDF overestimates near its rim).
- Submerged (`y < level`, depth > 0): `wet = 1`. Wet sand under water IS darker (pores filled
  with water, not air). ⚠ Verify the refraction G-buffer picks up the wet albedo exactly once,
  and that Jerlov absorption doesn't darken it a second time for the same reason.
- Bank: `h = y − level`, `d = −shoreSDF`. Capillary fringe in height ×
  splash/lap band in distance: `wet = (1 − smoothstep(0, hCap, h)) · (1 − smoothstep(0, dMax, d))`.
  `hCap` follows porosity (sand ~0.3 m, soil ~0.5 m, rock ~0.03 m. Soil-physics ballpark from
  memory, **verify before tuning on it**). `dMax` widens with the flow weight `w` from `.a` (a river
  wets more bank than a pond). Gate on `u_waterClipOn`-style "field bound".
- Response (Lagarde, "Water drop 2 — rendering wet surfaces", 2013; Lekner & Dorf 1988 for why wet
  albedo darkens. **Quoted from memory, re-read before fixing the numbers**):
  - albedo `pow(albedo, 1 + k·wet·porosity)`. The power saturates as it darkens, which is the
    "saturate/dim" look. Porosity is from the layer (rock ~0.1, sand/soil ~1).
  - roughness → `mix(roughness, 0.08, wet²)`. Damp only glosses a little; a film glosses fully.
  - F0 → `mix(0.04, 0.02, smoothstep(0.7, 1.0, wet))`. Only once a film forms (see the trap above).
  - Normal: flatten toward the geometric normal only as a film forms (water fills the pores).
- Debug: a wetness view mode in a-land's existing debug switch.
- Cost: no new samplers (worst program unchanged), one extra RT0 tap per fragment where the
  field is bound.

### 9b — caustics everywhere the water is

- **Underwater, per body**: swap `u_uwSurfaceY` for the fragment's own `wf.level` so lakes and rivers
  get caustics with the right depth. Drop the "viewer submerged" gate: a creek bed seen from the bank
  should carry caustics too, unless a-water's own seabed relight already draws them there. Decide
  that ownership line first, so nothing doubles.
- **Above water: the reflected sun.** A bank, rock or hull within a few metres of the surface and
  facing it gets sun light reflected off the waves: `E_sun · F(θ_sun) · pattern`, sampled along
  the REFLECTED ray (mirror of the refracted-ray projection underwater), fading with `h` and
  `d`, gated by whether that water point is sunlit. It uses the same caustic model numbers
  (`ARestlessOcean.CAUSTIC_MODEL`), so it stays one look.
- **Objects**: the same two terms in `ObjectMaterial` through `material-extensions` (it does
  subscribe), or a typed channel like the terrain's.

### 9c — the ocean's moving swash and a drying clock

Per the contract, land owns an accumulation map (a world-anchored ring around the camera,
never saved to disk); we publish only this frame's surface height near shore (the Phase 3a
swash/breaker output as a small ortho RT + world→UV). Land sets `wet = max(wet, surfaceAbove)`, then
dries it at a per-porosity rate (τ ~ 30–120 s). Rain (`weather.wetness`) and splash impacts
add to the same map later. Biggest plumbing of the three, so it goes last.

### Order

9a → 9b underwater-per-body → 9b above-water → objects → 9c. Each step is visible alone.

---

## Phase 6 — waterfalls: the nappe and the sheet — **written, GPU-headless-verified on hero-creek, awaiting regen + browser** (2026-09-21)

Branch `phase-6-waterfalls`, off `development` at `4917375`. Plan:
`~/.claude/plans/adaptive-singing-bengio.md`.
**GLSL changed: run `create-shader.py`** (new `waterfall-sheet.js`; `water-shader.js`).

Dante's steering (do not re-litigate): cascades are the main case, not one drop; the fall's
colour inherits the creek's water data so the look is continuous apart from the white; foam
type is ours to find; particles only if the sheet cannot sell it; the target is a 4090, so
compute is not the constraint.

### What shipped

- **`luts/waterfall-nappe.js`: where the water goes.** a-land exports a fall as two bed points,
  so the lip, the path and the landing are traced here, once per CASCADE: falls chain when one's
  `bottom` is within 6 m of the next's `top` (island-sholes' "13 falls" are exact chains). One
  parcel, as a state machine on the terrain:
  - *attached*: gravity on the bed's tangent plane minus implicit Manning (n 0.04);
  - *airborne*: leaves wherever the BED out-drops a free parabola, which is what a lip is, so
    there is no lip detector;
  - *impact*: the velocity into the ground is lost and logged (spray, foam);
  - *plunge*: a POOL (≥ 0.4 m deep AND Froude ≤ 0.6) reached flying or sliding;
  - *stop*: settled after the last fall, stalled, or climbing (water pools, it does not slosh).
  Width = the wet span across the flow where the trace starts (capped at the export's width);
  q = the field's own depth × speed there (capped at the export's Q/W); start speed critical,
  (g·q)^⅓; thickness h = q/|v|; aeration budget seeded by a-land's energy, grown by fall height
  over a Horeni-form break-up length 6·q^0.32 (quoted from memory — **verify before tuning on
  it**), by impacts and by chute length; presence = where the sheet draws instead of the creek.
- **`passes/waterfall-sheet-pass.js`**: the traced ribbons, all cascades in one draw call,
  re-traced one cascade per frame when the falls list changes, a-land's height residency changes
  (coalesced to ≤ one round per 2 s) or the terrain is edited. Ground is read from the DIRECTOR
  with a NaN miss (`api.getHeightAt` drops that argument and answers 0 m for unloaded ground).
- **`waterfall-sheet.glsl`: one water.** The material aliases the flowing material's uniform
  OBJECTS (Jerlov, metered sun, sky ambient, scene shadow, sky, foam textures) — no second stream.
  The white is **computed**: the sheet is a slab of bubbly water, void fraction = 0.25 × aeration
  streaked by the creek's foam grain (×0.25–1.75), σ = 1.5·α/r (r 1.5 mm), two-stream reflectance and
  diffuse transmittance with g 0.85, so a back-lit fall glows and a clear lip stays clear. The
  grain is sampled at (across, τ − t): it rides the water and stretches as the jet accelerates.
- **The hand-off.** `water-shader.glsl` ($flowing_water): inside a trace's corridor boxes (flat
  ended — a round cap reached 5 m past the lip) the creek surface steps aside where its LEVEL is
  steep (tan 10°→20°, 0.75 m stencil), keeping plunge and ledge pools. `flowFallSheet` (Phase 4
  stand-in) now only applies outside corridors.
- **Tier 2.** `_emitFalls` and `FlowFoamPass._updateFalls` take every traced impact (each ledge,
  the plunge) at its real point and velocity; the bed-point placeholder is the fallback.

### Verified

- `node tests/waterfall-nappe/nappe-test.mjs`: 18/18 on synthetic terrain (hero-creek-like step;
  45° chute stays attached at a friction-limited 5.8 m/s; 10 m vertical lands at −14.3 m/s vs
  −14.0; four-step staircase bounces off all four ledges; chute into a dry bowl stops in 4 s;
  a 14.1 m export over a 5 m channel traces 5.25 m wide, centred).
- hero-creek's survey terrain in Node, D8 and FV water: leaves at the lip (764.5), catches the
  lower half of the 1 m bilinear cliff ramp, plunges (D8) or rides the supercritical run-out (FV).
- **Headless Chrome on the RTX 4090** (raw CDP, `--use-angle=vulkan`; SwiftShader + virtual time
  does not finish an a-land page in 170 s), shaders from a byte-exact create-shader twin:
  sheet and flowing programs link, worst program **21 of 32** texture units (unchanged: the sheet
  is its own program), aliasing confirmed, hero-creek builds 1 cascade / 360 vertices.

### Bugs found on the way (kept, because each will come back)

- Normal flipped by `gl_FrontFacing` made N·V < 0 → Fresnel 1 → an opaque white mirror. The
  ribbon's winding is not tied to the normal; face the normal to the VIEWER.
- A central-difference normal straddles a lip and tips the parcel early (phantom impacts): the
  parcel feels an UPWIND normal. Separation is tested on the bed, never the water surface (a deep
  creek drawing down to its brink "launched" parcels into their own creek).
- Field water is per texel, ground is bilinear: `level − ground` invents a metre of water over a
  cliff ramp. Use the field's `depth`.
- Pools must be slow as well as deep: the FV solve puts 0.7 m of Fr ≈ 1 water on the lip cell.
- Stall/climb tests on height fail twice (thickness grows as a parcel slows; the bed under a
  near-vertical slide jumps with sideways jitter): integrate upward VELOCITY.

### ⚠ Outstanding — needs Dante

1. Run `create-shader.py` (waterfall-sheet.js, water-shader.js), then look at hero-creek's fall
   (472, 765) in the browser: the seam at the lip, the white, the plunge spray.
2. **island-sholes cannot judge cascades until it is re-baked.** Its exported `waterfalls[]` is
   stale against its terrain: the four-fall chain's tops read 125.5 / 116.8 / 114.3 m where the
   ground is 73.2 / 72.9 / 68.2 m, and its creek water tiles float 40–50 m over the steep island.
   Solve Water + Bake & Export, then look at wtr-8.
3. Taste knobs, all live on `oceanGrid.waterfallSheetPass.material.uniforms`: `uLumpAmp`, `uLumpScale`,
   `uLumpRate`, `uEdgeWobble`, `uRefraction`, `uVoidMax` (0.25),
   `uBubbleRadius` (1.5 mm), `uSurfaceRough` (0.35), `uGrainScale`/`uGrainRate`, `uEdgeFray`,
   `uBreakup`. Debug `uDebugMode`: 1 presence, 2 aeration, 3 airborne (red) / attached (blue),
   4 thickness, 5 bubble optical depth, 6 grain UV, 7 alpha, 8 bubble light, 9 reflected sky,
   10 water transmittance to what is behind, 11 what is behind (relit, filtered).

### Round 2 — Dante's first browser run (hero-creek-sky), 2026-09-21

- **Crash: `e.fogColor is undefined`.** The sheet is `fog: true`, so three's refreshFogUniforms
  writes fogColor/Near/Far/Density every frame there is a `scene.fog` — and a-starry-sky always
  sets one. The template lacked them. The headless run missed it because hero-creek-OCEAN has no
  scene fog. Added (plus `uwSunDir`). a-starry-sky's fog chunks read only those four (its sky is
  baked in as constants), so nothing else was missing; verified on hero-creek-sky on the 4090.
- **The sheet reflected black under a-starry-sky.** It sampled the metering-survey fisheye, which
  **reads back all zeros on hero-creek-sky** (atmospheric perspective on; the render agreed with
  the readback). The creek never noticed: with AP on it reflects `computeSkyRadiance`. The sheet
  now reflects the water's ambient-built sky, with below-horizon rays fading to a dim ground
  bounce. ⚠ The splash's bead rims sample the same texture (`uHasSkyTex`); not changed here.
- **Dark navy gaps between the streaks** came from multiplying the slab's light by the creek's foam
  DIFFUSE map, which is dark between bubbles by design. Removed: bubbles scatter almost losslessly;
  the grain modulates the amount of air instead. Default `uVoidMax` 0.2 → 0.25.
- **A hot white band over the brink**: the flat approach rows before the first takeoff had slope
  presence and faced the sun. On a free overfall the creek draws the approach, so rows within
  `approachClear` (2 m) of the first real takeoff no longer draw.

### Round 3 — Dante at (479, 7.9, 773.4) on hero-creek-sky, 2026-09-21

"Back end of waterfall does not connect to the water nor at the front end."
- **Bottom gap: two different criteria.** The creek stepped aside wherever its LEVEL was steep
  (the FV solve runs 0.15 m of 4.8 m/s water down the ramp to the pool at z 769), but the sheet
  stopped drawing at its landing (766.3): nothing drew the metre between. Attached presence now
  IS the creek's test — `smoothstep(tan 10°, tan 20°, |∇level|)` over ±0.75 m of the bilinear
  field level (`WaterfallNappe.levelSlope`), so the two surfaces are exact complements. The path
  slope only stands in where there is no water to ask. `approachClear` (round 2) is gone.
- **Top: clear creek, then an instantly opaque sheet.** The upstream creek IS drawn to the lip
  (debug 66) — clear water over the grey carved bed. The jet's air was seeded from a-land's energy,
  0.9 "whitewater" on a creek the renderer draws clear. `startAeration` 0: the lip is a glassy
  tongue that whitens as it falls.
- Not changed: the pool narrows toward the fall base in the water data itself (FV: 7 wet
  cells across at z 766 against 10–12 in the pool), so the sheet (as wide as the creek at its
  start) overhangs the ramp's dry edges there.

### Round 4 — Dante's shots #4–#8 (hero-creek-sky), 2026-09-21

"One river fades out and the waterfall fades in … wider than the river … juts into the air
with a chunk of river popping through … the froth at the bottom is like a cube … the backside
has a hard time connecting." One design decision behind most of it, and one Phase 4 seam:
- **The sheet draws the FREE FALL only.** Round 3 also drew steep attached stretches, and those
  rows (a) draped vertex-by-vertex onto banks, twisting the corners into the air, (b) lay on the
  landing ramp as a flat white slab, (c) were wider than the creek there. Everything attached is
  now the creek's own surface; a heightfield only fails where the water leaves the ground. The
  ribbon is rigid across. Pure chutes are the creek's (steep heightfield + flowFallSheet foam).
- **Corridors span the channel at the lip** (`lipSpan`, the wet width where the jet takes off,
  10.25 m against the jet's 8.25 m), so the fringe's steep-level whitewater no longer pokes out.
- **The sheet uses the creek's refraction model**, not an alpha film: G-buffer terrain behind it,
  relit as the creek relights it, bent by the lumpy normal, filtered through the water crossed
  (the column on the lead-in, the sheet's thickness on the fall), let through by the bubbles'
  slabTdir. Opaque; alpha only for the fades. An alpha film read as bare rock where the creek
  read as 40 cm of tinted water — that was the "fades out, fades in".
- **Phase 4 seam found: the creek drops a strip just upstream of every lip**, with the sheet off
  and the terrain hidden too: its level sinks toward the ramp while the rendered cliff-top edge
  is still under it, so the thin-water fade (< 3 cm) discards it. The sheet now leads into each
  takeoff by `brinkLead` (2 m), clear water at the creek's level, covering it.
- **Shape**: the vertex stage displaces the ribbon along its normal by two-octave value noise in
  (across, τ − t) space — lumps ride and stretch with the water, height grows with aeration
  (`uLumpAmp` 0.3 m, `uLumpScale` 1.2 m, `uLumpRate` 3/s) — rebuilds the normal from the
  displaced surface, and wobbles the side columns (`uEdgeWobble` 0.4 m). FUDGE: look noise, not
  a jet-instability model. Answering Dante: neither surface had a heightmap at small scale —
  the creek's ripples are normals only (Phase 4 step 4), the sheet was a smooth ribbon.
- Test harness gotcha: `_corridors = []` from the console is undone by the next re-trace (≤ 2 s
  while tiles stream). To isolate the creek, override `_streamCorridors`.

### Round 5 — "the river's texture needs to continue into the lip", widths (Dante, 2026-09-21)

- **The creek's surface really is underground at every brink.** a-land's water level is
  interpolated between 1 m cells, and at a lip it blends the creek cell (4.91) with the fall
  cell (4.02): from z 764.5 to 765.2 on hero-creek the level runs BELOW the ground (4.25 vs 4.50
  at 764.75). That is the strip the creek "drops" (also why its thin-water fade fires there).
- **Hand-off by depth, not alpha.** The sheet's lead-in (2 m before each takeoff) and a new tail
  (1 m after each landing) are FULLY present at the creek's own level (bed + the cell's depth).
  The creek writes depth with a polygon offset toward the camera and wins wherever it exists;
  the sheet shows only through its holes. The old presence ramp left the sheet half-transparent
  exactly over the holes.
- **The scene fog chunk made the sheet look like terrain.** With a-starry-sky's AP on, its fog
  branch re-linearises, adds aerial perspective and tone-maps AGAIN — right for linear terrain,
  wrong for the already tone-mapped sheet (orange wash; the lead-in read as ground). The sheet now
  follows the water's rule: fog chunk only with AP off (`SHEET_SCENE_FOG`, toggled per tick).
- **Under-water terrain behind the lead-in is lit as the creek lights its seabed** (refracted sun
  filtered down the column + sky tinted by the water, column = depth + the creek's 0.008 grazing
  proxy), not as dry ground.
- **The lead-in wears the creek's ripples**: the same 16 directions of the shared
  `flowWaveProfile`, advected with the sheet's own velocity (energy fixed at a mid value; the
  creek reads it from FlowFoamPass). The fall keeps the grain normals.
- **Width follows the VISIBLE water** (≥ 6 cm, mid of the creek's 3→10 cm fade), recorded at every
  takeoff and landing, interpolated along the sheet with its centre offset: 8.0 m at the lip,
  7.25–8.5 m at the landings on hero-creek (was 8.25 m rigid, measured to 2 cm).

### Round 6 — the top: reflect like the creek (Dante, 2026-09-21)

"That foot might mask some of that bottom stuff and that top might be worth doing."
- The sheet now carries the creek's **screen-space reflection**, lifted verbatim from
  water-shader.glsl (the 48-step jittered march against the G-buffer, binary refinement,
  silhouette and convergence gates, relit hits), marching on the smooth displaced normal and
  sampling the sky on the detailed one, as the creek does.
- **The sky is the creek's sky**: with atmospheric perspective on, the fragment shader is built
  like the water's (the template is now a builder: `$atmospheric_perspective_enabled` substituted,
  a-starry-sky's atmosphere GLSL spliced in at the water's injection marker), so misses and the
  view through the sheet use `computeSkyRadiance`, and the sheet **applies aerial perspective**
  itself (`applyAtmosphericPerspective`, above water) — no longer deferred. The pass rebuilds the
  shader the tick AP becomes ready. With AP off: the ambient-built sky and the scene fog chunk.
- Trap: the injected atmosphere GLSL declares `PI`; the sheet's own `const float PI` was a
  link error ("'PI' : redefinition") on the sky page only. Removed. Both branches verified to
  link (hero-creek-sky with AP, hero-creek-ocean without).
- Result, headless on the 4090: the creek's ripples and its SSR glints of the banks run straight
  over the brink into the curl of the fall.

### Round 7 — "River > Fall start > Plunge > Foam > River … we need the river info in there" (2026-09-21)

Dante's instinct was right: the sheet was GUESSING where the creek stops drawing (fixed-length
lead-in/tail, CPU heights). Now it asks the creek's own rules, per pixel:
- **Alpha complement.** On attached rows (lead-in, tail) the sheet's alpha is `1 − creekVisible`,
  where `creekVisible` is the creek's thin-water fade (its field level over the G-buffer ground
  under the undistorted pixel, 3 → 10 cm) times its corridor step-aside (level steep inside a
  fall's box) — the same WaterField cascade 0 and the same corridor uniform objects (ring 0's,
  aliased). The free fall keeps full presence. Lead-in and tail are 3 m each; the complement
  hides whatever overlaps. Debug 12: red = creek visible, green = sheet's hand-off weight.
- **The creek writes depth where it has faded out.** Round 5's "hand-off by depth" left a hole at
  the foot: the flowing surface is transparent + depthWrite and only discards when fully faded,
  so a nearly invisible creek, polygon-offset toward the camera, hid the coincident tail. The
  attached rows now sit 3 cm ABOVE the creek (`ATTACHED_LIFT`) and blend over it by the complement.
- **Attached rows stand on the creek**: vertex y = max(creek level, traced height) — so the tail
  follows the pool's real level instead of running under it and under the banks at the edges
  ("the foam seems to go below ground near the edges"). The creek level is the MINIMUM over
  ±0.75 m along the flow: near the foot the field's cells still hold the ramp's level (2.4 m vs a
  1.9 m tail) and single vertices were yanked up, folding the tail into edge-on strips.
- **Lumps only on the free fall** (the tail's high aeration poked white lumps through the pool).
- 60 s run on hero-creek-sky: no errors; both AP branches link.

### Round 8 — a foam sheet under the river, bent strips top and bottom (Dante, 2026-09-21)

- **The bent triangle strips at the landing AND the takeoff were the lumps.** Full-height lumps
  on airborne rows, none on attached rows, switching within one 0.25 m row: that single row of
  triangles was sheared by up to 30 cm (and could clip the terrain). Everything that differs
  between the fall and the attached ends — lumps, air, the lift onto the creek, the hand-off —
  now ramps on a smoothed FREE-FALL WEIGHT (box over ±0.5 m, `fallSmooth`) carried in flowB.z.
- **The "sheet of foam under the river" was the landing tail**: the trace's post-impact aeration
  made it dense white, and a ±0.75 m minimum of the creek level sank it under a pool whose level
  rises downstream (1.55 → 1.85 m), where it showed through the clear creek. Attached rows now
  carry NO air (the pool's foam is the creek's own FlowFoamPass foam, fed by the traced
  impacts), and stand on min(level here, level 0.75 m downstream).
- **The jet dissolves into water the creek draws** over its last 35 cm (`PLUNGE_BLEND`) instead
  of cutting a hard line through it.
- Left: a thin bright line where the jet's lowest rows curve toward horizontal and catch the
  sky at grazing Fresnel; the creek's plunge foam has its own swirly advection artefacts (#8).

### Round 9 — bugs still there at Dante's angle; caustics, depth under the lip, mist (2026-09-21)

Dante's regenerated waterfall-sheet.js was byte-identical to the committed sources: the bugs were
real, my test angles had missed them. At his angle (south-west, above, looking across the face):
- **Dry texels hold their nearest WET texel's level** — beside a fall, often the creek 3 m up. The
  vertex lift yanked bank-side vertices up to it (the slivers down the fall's left side) and the
  creek-visibility test read "water" over dry bank (the lead-in spilling past the creek). Both now
  honour the field's dry flag (RT0.a ≥ 1 = known dry), as the creek's own discard does.
- **Seeing the fall's foam through the water at the lip (#15)**: one transparent mesh drawn in row
  order, no depth write, so the falling rows painted over the tongue in front of them. The sheet now
  writes depth (fully faded fragments discard) and the tongue shows its own water column.
- **The tongue whitened at once**: bubble optical depth now goes with aeration² (air works in from
  the surfaces; a nappe stays glassy for its first stretch), `uVoidMax` 0.25 → 0.5 to keep the foot.
- **Caustics on the lead-in's bed**: the creek's caustic block, lifted verbatim, in the sheet's
  seabed lighting (`$caustics_enabled` substituted by the builder; causticMap aliased).
- **Mist, not sea-foam chunks, at the plunge**: new splash particle type 2 (waterfall mist) is a
  haze puff at any wind (ocean-splash.glsl; the sea's mist look is gated on wind speed). Every
  traced impact rolls out fine, long-lived puffs (`fallMistRate` 20/s per m³/s, `fallMistSize`
  1 m, `fallMistLife` 2.8 s, `fallMistSpeed`, `fallMistRise`, `fallMistSpread`); the chunky
  emitImpact spray for falls is off by default (`fallSprayRate` 0, still a knob).
- Swirly foam in the pool: FlowFoamPass advection, not the fall (Dante: likely the solve's sampling).

### Round 10 — the front view: a dark crack and a white slab at the foot (Dante, 2026-09-21)

Reproduced at Dante's front angle; hiding the terrain and then the creek isolated it to the
sheet's own tail.
- **Root cause: the corridor covered the whole ribbon**, 3 m tail included, so the creek stepped
  aside over the landing zone (its level still slopes down to the pool there) and the tail drew
  plain clear water in its place: Fresnel-white at grazing, no foam, and a crack where it met
  the fall. Corridors now cover only the free fall (`fallFlag`); past the landing the creek keeps
  its foamy surface, the jet dissolves into it, and the tail only fills the creek's own holes.
- **Touchdown on the water's surface** (bed + field depth), not bed + jet thickness: landing on the
  bed then riding at the surface folded the ribbon back up 16 cm at the foot.
- **Two weights instead of one smoothed weight**: `fallFlag` per row (air, lift, hand-off — round
  8's ±0.5 m smoothing leaked bubbles onto flat post-impact rows: the white slab) and `lumpW`,
  ramped INSIDE each fall's ends (lumps and the edge wobble; the wobble had been ungated and swung
  the tail's edge columns 40 cm over the banks).
- **Tail level** = the level here, dropping to the downstream sample only where the level falls
  steeply ahead (the plain minimum sat it a few cm under the pool: "foam right underneath").
- Harness: Chrome's cache served a stale nappe once (a false TypeError); run.mjs now disables the
  network cache.
- Not the sheet: thin slivers of the CREEK's pool run up the base of the step at both banks (seen
  with the sheet hidden) — Phase 4 wet cells along the cliff foot.

### Round 11 — the seam, scaly glints, the tail under the water, still caustics (Dante, 2026-09-21)

Reproduced from the east bank (480, 5.5, 769) looking west. With the sheet hidden, the creek ended
on a clean line well upstream of the brink and the sheet's lead-in took over along that line: two
differently shaded waters swapped at once.
- **A shared cross-dissolve (Dante: "pass this into the river shaders").** The first corridor box of
  each free fall starts `corridorLead` (2 m) upstream of the takeoff and carries that length in
  B.y. Across it the CREEK fades out by distance (`fallCorridorWeights().y`, water-shader.glsl) and
  the sheet, which draws the exact complement with the same function, fades in. Beyond the lead,
  boxes step aside on steep level as before.
- **Tail under the water:** the jet is cut below the creek's surface wherever the creek draws at all
  (it was weighted by how much, so a partly drawn creek let the jet show through).
- **Scaly reflections on the face:** the grain's normals made the foam a field of sharp sky glints.
  Bubbles are not a mirror: the reflection normal leans back to the smooth sheet and SSR + glint
  fade with the bubble layer (`clearSurf = exp(−τ_b/2)`).
- **Caustics** (creek and sheet): on flowing water they now ride the current (two-phase advection,
  as the ripples), and their minimum cell is 1 m (was 0.25 m, fine static grain beside 2 m foam; a
  look choice). The ocean's caustics are unchanged. The inline octave loop became causticOctaves().
- Not found: the "triangle up top" — needs Dante's camera position.

### Round 12 — the triangle was the terrain; foam and water are two layers (Dante, 2026-09-21)

- **Dante found the triangle: terrain clipping through the sheet.** A rigid-across ribbon assumes
  a clean lip; banks and rocks jutting into its width sliced it. `buildRibbon` now marches each
  row's extent out from the centre (0.1 m steps) and stops where the ground first rises above
  the water, then relaxes neighbouring rows (±2) so one jut cannot pinch a single row: the sheet
  hugs the channel's walls. Test 8 (a rock jutting into one side of the lip): 0 vertices inside.
- **Scaly face, take two — "foam as foam on top, water with its reflection underneath".** Two
  surfaces: Nw (lumps + the creek's ripples, in the ground frame on the lead-in and the sheet's
  frame on the fall) carries Fresnel, SSR and the glint; Nf (the grain's normal map) lights only
  the matte foam. Composite: `bubbleLit + slabTdir · (F·reflection + glint + (1−F)·body)`: the
  foam covers the water layer by the light it scatters, and reflections show only in its gaps.
  Round 11 had only faded the foam-normal reflection; it still drove the glints.

### 2026-09-22 (late) — island-sholes rivers: stale bake, then thin sheets

**Symptom.** Rivers show in the a-land editor but not in `island-sholes-ocean.html`.
- **Cause 1, a stale bake.** The water tiles were from 09-18 and the terrain from 09-19, with the
  channels smoothed shut, so 99 % of the oval island's river sat about 1 m underground.
  - Fix: Solve Water and then **Bake & Export**. Save alone never rewrites the water tiles.
  - `WaterTileDecoder._checkStaleBake` now warns once when the baked bed disagrees with the
    ground (0-1 % of texels on hero-creek, 64-96 % on the stale tiles).
- **Cause 2, thin sheets.** After a fresh bake, the shallow-water pass spread the water into
  2-3 cm sheets: 4.55x the ground D8 wetted, 49 % of the oval's flowing texels under 3 cm.
  - The carve was a fixed point of D8, not of the shallow water that ships.

**Built (a-faraway-land-lbm worktree, `lbm-river-solver`, uncommitted):**
- **`WaterCarveLoop.js`:** carve, solve the shallow water, then keep side channels carrying
  ≥ 25 % of Q or wall the rest, and repeat. Plus spring pools and "D8 lakes count as channel".
  - Fixture: spill 4.65x → 1.18x; oval and long islands at a median ~30 cm, 3 % under 3 cm.
  - Tests: `check-carve-loop.js` and `check-carve-loop-gpu.mjs`.
- **`WaterFVBake` `shipMinDepthM` 0.03:** flowing water thinner than a-water can draw ships dry.

**Built here, needs `create-shader.py`** (water-shader.glsl, waterfall-sheet.glsl): the popping fix.
- The thin-water fade now runs on the **baked** depth (RT0.g), which does not move with the view.
- The rendered-ground thickness only guards 0.5-3 cm, against displacement or LOD poking
  through. It used to run the whole 3-10 cm fade, and the ground shifts with LOD, so water
  blinked as the camera moved.
- The hand-off band cuts at 6 cm baked, 2 cm rendered.
- Debug mode 66 now shows both rules.

**Open:**
- Dante's in-editor re-solve on the lbm worktree.
- `carveMinDepthM`: narrow a channel where its water would run too thin.
- Source reduction as a last resort.

### 2026-09-23 (later) — falls square to their lips; the trace survives pits, sills and ponds

Dante's first carved bake: sheets rotated off clean edges and started or ended in odd places.
- **Heading = the lip's own downhill** (`N.lipDownhill`, ground gradient over a 3 m disc straddling
  the edge). The field current was a-land's D8 step direction, 15-45° off (D's first step 40°).
  The current is only the fallback on a flat lip.
- **A landing's centre moves only as far as the jet spreads** (C slid 5.5 m).
- **Pre-fall speed floor:** while within 0.5 m of its start height and within start + 4 m of path, the
  parcel keeps at least v_c. After the carve, A had a 2 m pit behind its lip, E a 0.5 m sill with a
  still pond behind it, and the parcel braked to a stop in both.
  - Pre-fall climb stop 3× looser. The start search skips hollows (a dip that rises again).
  - nappe-test case 14 (a sill pool). 32/32.
- **a-land carve:** a steep run that ends at a sheer drop (a rounded brink) or is under 2 cells is
  not stepped. Likely source of A's pit in Dante's bake: his editor's route crossed the brink at
  an angle, which I couldn't reproduce offline.
- **Performance:** the whole 2048 D8 solve now takes 3 s (was 220 s). The unbounded 5e ramp was the cost.
- **Open:** C's half-width sheet is the carve. Its 21 m disc follows D8's off-centre route in C's flat
  26 m channel, so the rest of the floor ships dry. B's third step stalls in Dante's bake (offline
  its current carve gives a clean 3.2 m fall).

### 2026-09-23 (small hours) — a-land: channels sized by the ground, steep chutes carved into steps

Both in a-faraway-land `WaterSolve.js` (branch phase-6b-steep-chutes), both Dante's calls:
- **Section hydraulics** (`sectionHydraulics`, `_sectionFlow`): each centre samples the ground
  across the flow and bisects the level at which Manning over the REAL wetted section carries q.
  - The section is aimed along the chord two steps down, or along the D8 step before a fall, so it
    doesn't tilt over the lip. It is walled at widthK·√Q/2, so open ground keeps the old rectangle.
    Ground below the channel's own low point is clamped.
  - falls-lab: A runs 0.65 m deep at 2.2 m/s (was a 0.15 m film at 0.9 m/s, then 0.39 m at
    4.5 m/s), full width to the lip. C below its pool runs 4.3 m/s.
  - ⚠ C's pool outlet still steps ~0.5 m up out of its pool: 5c raises the pond, then 5e's rim
    lowers it back to the flat floor it sits in. Possibly the generator's geometry. Open.
  - ⚠ island-sholes D8 fixture: overhanging edges > 15 cm went 19% → 27% (deeper water in narrow
    gullies). Its real bake uses FV.
- **Steep chutes → steps** (`carveStepChutes`, `carveStepSlopeDeg` 25, `carveStepHeightM` 2.5; carve 1b).
  Along each run steeper than 25° (a chord of 2 cells, skipping cells that already drop a full
  step), the drop top→foot is split EVENLY into ~2.5 m steps: a sheer drop, then a flat tread.
  - Tread and foot discs (plus one disc-reach below) don't reach back upstream over their step.
  - Also in run(): a lake OUTLET can start a fall (a tread pool spilling over its step), and a
    fall run bridges one non-fall cell, but only while it's under waterfallMinDropM.
  - falls-lab carved: D 45° → 2.8/2.8/2.8/2.9 m steps, D 35° → one 2.1 m fall; A/B/C/E unchanged.
    New check-carve case 6 (off: 1 chute, on: 5 falls ~2.3 m).
  - ⚠ Only with carve ON: falls-lab has `carveChannels: false`, so it needs that flipped + a re-bake.
  - island-sholes (2 m cells): steps barely engage (a 50° face already drops a step per cell), so its
    cliff water is still the FV-bake question.
- a-land tests: 131 ok (check-lake-preview's crash predates this).

### 2026-09-22 (later night) — falls after the export fix: trace start + span fixes, energy-scaled mist

Dante's second pass after the re-bake: A left its lip at an angle, E had no fall, B's second step
never fell, B's small steps misted more than A, the clumps looked like footballs, a crescent bump
sat on a creek, and D's chutes didn't read as falls. Headless on falls-lab-sky:
- **Takeoff spans** were measured ON the lip cell, now a real few-cm brink. At A that gave a
  lopsided sliver (2.8 m offset, the "yeet"). At E it gave nothing, so the landing span went
  uncapped and took 26 m of sea (the grey slab).
  - Now measured `takeoffSpanBack` 1.5 m upstream. A failed takeoff falls back to W, centred.
- **Trace start** inherits the field's speed (≤ `maxStartSpeed` 10). A v_c start braked to a stall on
  B's near-flat tread. The start also steps toward the lip past pools and hollows.
  - All 9 falls now trace to a plunge or settle.
- **Mist and splash rates follow impact energy:** (vn / 10 m/s)^1.5, clamped 0.02-3. Puff size goes
  as √(vn/10). `fallMistRate` 50→20, `fallSplashRate` 40→15.
- **Clumps:** a solid body whose outline the noise displaces (the interior erosion made rings).
  Needs create-shader.py. They now read as white chips, so tuning is Dante's call.
- **Open, a-land:** channel hydraulic geometry is a 4·√Q rectangle and ignores the ground. Honest
  mass means 7-10 m/s creeks in narrow terrain channels, and a creek standing 0.36 m above its
  pool at C's outlet (5c raises the pond, then 5e's rim lowers it back). Proposed: solve each
  section's depth on the real terrain cross-section.
- **Open, a-water:** D's chutes are attached, so by the settled round-3/4 rule the creek surface
  draws them (the sheet is free fall only). Item 5 would reverse that for runs over ~35°.

### 2026-09-22 (night) — falls-lab browser pass: a-land shipped 1/7 of the discharge

Dante's first falls-lab look (7 shots): falls thin to streaks, football splash, A's landing tail
climbing the cliff base, C's mist a solid cloud, E's creek necking before the lip, murky green water.
- **Green water is grass beds** (debug 5/12/6: refraction of grass, Fresnel ~0). Not a bug.
- **Root cause of the thin falls: a-land's D8 export was not mass-consistent.** Depth × speed across
  a section carried 1/7 of Q at A. The trace reads the field, so it got q 0.19 instead of 0.75.
  Four faults, fixed in a-faraway-land `WaterSolve.js` (branch phase-6b-steep-chutes):
  1. Speed came from the first (farthest) disc to reach a cell, at 35-45% bank fade. Now the
     nearest centre wins among equal Q (to within 1%). `stampD2`/`stampC`.
  2. The Manning reach slope (8 cells) was measured across the fall, giving 9 cm at 34 m/s for 8 m
     above an 18 m lip. `_reachSlope` now stops at a fall step (`fallStep`, computed up front).
  3. The 5b surface smoothing averaged across the fall face, which dried the creek's sides for 6 m
     above the lip. It no longer averages across a fall step.
  4. The 5e edge ramp: it no longer seeds from ground downstream along the flow, never walks back
     up the flow, and reaches at most `edgeRampMaxM` 6 m.
  - New 6b: each section's speeds are rescaled so Σ depth·speed = Q (bounded 0.5-4×).
  - falls-lab 1 m: A/B/C/D/E sections now carry 9.1/6.4/27.4/6.4/9.1 m³/s, with A 0.39 m deep to
    the lip.
  - ⚠ Creek SPEEDS rise where the terrain's channel is narrower than 4·√Q (A ~4.5 m/s): mass is
    honest, but the hydraulic geometry isn't fitted to the ground.
  - ⚠ island-sholes D8 (the fixture, lbm off): floating edges >15 cm 19→24%, +68 of them within
    20 m of a fall (creeks now reach their lips at real depth).
- **Fall min drop scales with the cell** (`0.5·min(1, spacing)`): falls-lab baked at 2048 had no
  D falls. The D8 solve itself takes 220 s at 2048 vs 8 s at 1024 (superlinear): a perf bug.
- New check-falls-autolakes case 5: the sections carry Q (±25%). The old engine gives 37-41%.

### ▶ RESUME HERE (2026-09-23, fall sites round 6) — last polish before switching projects

Commits: a-land 3105c0a, a-water 1597900. **Needs Solve Water + Bake & Export** for the a-land half.

Three fixes:
- **B's "giant polygon."** Round 5's takeoff-to-lip strip box ran from the SPINE's takeoff (2.4 m
  off-centre) to the lip centre: a skewed box that ate a parallelogram of creek. It now runs along
  the lip normal.
- **D's lower pool cut off from the creek.** The round-5 face-drying also dried the pool's
  downstream rim. It now dries only between the lip and the landing. Offline, the pool (26.39 m)
  runs on into the creek (26.40 m, then down).
- **Floating pond beside D's upper pool.** The stadium's round ends dug into the shaped band. The
  pool is now no wider than the water plus half a shoulder, in both the carve and the site water.

**State:** Dante suggested switching projects soon. The known seams left are the sheet-lead
complement teeth (i26, partly gone with the strip fix) and short-step aeration.

### (earlier) RESUME HERE (2026-09-23, fall sites round 5) — stadium pools, dry faces

Commits: a-land 115234b, a-water def2213. No GLSL. **Needs Solve Water + Bake & Export.**

Dante's round-4 shots (6), reproduced headless at his camera positions:
- **Base clipping (B i22, D i32).** The dug pool was a disc, and a sheet's edges landed on
  tread-level rock in front of the face. The pool is now a STADIUM across the whole wet width.
- **C's lopsided foam (i28).** The bowl lake is narrower than the 21 m curtain. A lake is the pool
  now only where it takes all 5 samples along the landing line; otherwise the site digs a pool that
  runs into it at the lake's level.
- **"Chunk of lake floating in the sky" (i30), and A's foot.** Face cells past the lip kept the D8
  fall water (1.8-2.2 m on the rock under a 1 m texel). Site water now dries the face (past the lip,
  over its reach; everywhere that is neither pool nor body). Offline: 0 cells stand > 0.6 m over the
  pool on any face.
- **Sheet/creek interface.** A box from takeoff to lip + 0.5 m where the sheet owns the surface
  outright.

**Open** (Dante: "perfect is the enemy of the good"):
- **Teeth where the sheet's lead rows meet the creek (i26).** They are in the SHEET's complement
  cross-dissolve (they stay with the creek hidden). Every strand's first row starts on one line
  (z 330, presence 1), so it is the per-pixel complement, not the geometry.
- **B i24's "white surrounded by blue".** Aeration grows with drop, so a 3 m step stays mostly
  glassy at its top and edges. A look knob, not a bug.

### (earlier) RESUME HERE (2026-09-23, fall sites round 4) — the straddling texel, falls within falls

Commits: a-land 56e8321, a-water 68dd6d5 (plus 330139b, Dante's regen of round 3). No GLSL this
round.

Dante's round-3 bake shots, reproduced headless at his camera positions:
- **A's brink band ("sea foam").** The flowing surface drew the 1 m texel straddling the lip (lip
  level held half a texel over the face). Root fix in a-land's export: texels straddling a carved
  lip (across wet width + shoulders) are DRY. The same texel was behind A's strip, C's false
  plunges and the floating tile at the lip corner. check-export has a new case.
- **"Falls within falls" (B, D).** The corridor ended where a slow sheet lands (0.8 m out), and the
  creek's whitewater stand-in drew a fall past it. Sited corridors now reach landing + 2 m.
- **Hole in D's lower sheet.** Middle strands plunged into the lip texel 1.2 m up. Sited strands
  now plunge only into water at or below site.pool level + 0.5.
- **White slab over D's lower lip.** Slow water took off 2 m early. Sited strands now ride the rail
  to a metre short of the lip line.

**NEXT (Dante):**
1. Solve Water, then Bake & Export (the export fix acts on the tiles).
2. Look at A (the brink band and the corner tile), and at A's side seam, which was not reproduced
   headless.

### (earlier) RESUME HERE (2026-09-23, fall sites round 3) — every step a sheet, whole curtains

Commits: a-water f8bc9e3 (**GLSL: run create-shader.py**), a-land 452ccef.

Dante's round-2 bake shots, each reproduced headless before a fix went in:
1. **"Skipped" waterfalls on B and D**, draped creek on the faces. Chained by cascade, every strand
   ended in the first pool. Now a carved fall is a chain of its own.
2. **C's missing chunks.** Half the strands "plunged" 0.4 m under the lip into a 1 m water texel that
   straddles the brink and holds the lip's level over the face. Now a sited strand's pool must lie
   half the site's drop below its start, in both the airborne and the sliding plunge.
3. **River behind A's sheet** (right side). The STILL/opaque water surface (not the flowing one; it
   has no corridor uniforms) drew a lip-straddling texel's drape where the hand-off weight fell
   short near the still pool. Now the still surface discards level steeper than tan 30° (4 water
   field taps, no uniforms).
4. **Foam on A's approach, cut off at the sheet.** FlowFoamPass now has calm boxes (MAX_CALM 8) over
   each site's approach: no sources there, and foam decays toward the lip. a-land's site water
   also calms approach energy to 0 at the lip and dries the shoulders (films were drawing as
   shards).

**Harness (scratch, rebuilt):**
- `run.mjs`: CDP, `--use-angle=vulkan` on the 4090, per-view `js` hooks, `look` targets, and
  `swap` (Fetch fulfils a scratch JS such as a regenerated water-shader.js).
- `regen.py`: a byte-exact create-shader twin.
- `tiles.py`: decodes the exported tiles.
- `falls-carve.js` with BAKE=1: the 2048 bake emulated through the 1 m tiles.
- `prof2.js`.

**NEXT (Dante):**
1. `create-shader.py`.
2. falls-lab: Solve Water, **⌘S** (layers.json STILL has no Channels layer: last written 09-22),
   then Bake & Export.
3. Look at A-E. Only the a-land half (dry shoulders, calm approach energy) needs the rebake; the
   a-water fixes act on the current bake.

**Open:** small shards at the lip ends (C's corners, left of B's top step) were seen headless before
the shoulder-drying fix, and are not re-checked on a new bake.

### (earlier) RESUME HERE (2026-09-23, fall sites round 2) — one plunge, grabby sites, water over the lip

a-land `fall-site-carve` c4b8c11 + the site.shoulder export. a-water needs no code change.

**Dante's falls-lab bake** (5 shots) was diagnosed from the exported tiles (a `tiles.py` decoder in
scratch) before anything changed:
1. **Only 6 of the 13 falls carried a site.** The bake solves at 0.5 m on 1 m tiles, and a segment's
   top sat 2.2 cells behind the lip, outside the two-cell match window. So C and D were the OLD trace.
2. **C's "upwelling."** Over the flat approach the water stood 2.3 m deep, 7 m behind the lip,
   rising downstream. My 6b reach slope stops at the lip, so Manning saw almost no slope.
3. **B's "bump up."** Each pool is a lake at its spill level (the tread's bed), with the tread's water
   0.2 m above it. The tread carried about 12% of Q to the lip.
4. **A's "leaks."** The 12 m vertical gorge walls drew water on their tops at 1 m tile sampling.
5. **The lip cell itself** was a 2 cm film: Manning measured on its own step.

**Decisions (Dante):**
- No limit on a fall's height.
- Sites are grabbier: a longer approach, wider shoulders, the pool basin, and the cliff face.
- Physics fix plus site water.

**Built (a-land):**
- `carveFallMaxStepM` 0: one plunge. Chutes are still fitted into steps.
- The first approach is `carveFallApproachK`·W long (shortened to the plateau), ramping into the
  creek at both ends.
- Shoulders of max(1.5 m, 0.25 W).
- The pool disc may be wider than the water.
- A shaped band past the shoulders (cut and fill, capped) carries the face on straight.
- Lips sit where the whole width holds them.
- The cut cap counts the hill cut back past the lip.
- `attachFallSites` matches in metres.
- `run()`:
  - `_brinkDrawdown` (gradually varied flow from 1.02·yc at each lip) caps depth upstream and
    floors the lip cell;
  - `_stampFallSiteWater` (stage 6c, `opts.fallSites`): each approach on the drawdown with
    q = Q/W, each dug pool (the whole auto-lake and the wet width over its reach) at its next
    tread's water.
- Sites reach every re-solve (worker, inline, carve loop, Bake & Export).
- check-fall-sites is rewritten for one plunge, plus the site-water case and case 9 (drawdown).
  All 8 checks pass.

**Offline, the bake emulated at 2048** (carve → 1 m tiles → 2048 → re-solve), then the a-water trace:
- all 11 sites attached;
- A 1×17.8 m, B 4 steps, C 1, D 2+1, E 1×11 m;
- every fall carries 97-100% of Q in its sheet;
- 97-100% of quads intact;
- takeoff lines within 1-3 cm.

The remaining floating edges at the falls are the lips themselves (the face below).

**NEXT (Dante):**
1. Solve Water, then **⌘S** (falls-lab's layers.json had NO Channels layer, last written 09-22),
   then Bake & Export.
2. Look at A-E.

### (earlier) RESUME HERE (2026-09-23, fall-site carve) — BUILT: the river owns its falls

Branches `fall-site-carve` in both repos. a-land's is the MAIN checkout, off `main`, which was
fast-forwarded to the 6b steep-chutes commit.
- **a-land:** 1d7929c (the 6b base), 49a1376, 6b9c437, 2424a6b.
- **a-water:** 460b1a0, off `development` (fast-forwarded to 19e3ac6).

Plan: `~/.claude/plans/pasted-content-id-75e0-new-session-jiggly-whistle.md`. No GLSL changed, so
there is nothing to regenerate.

**Dante's decisions:**
- Steps are at most 8 m; pools are 0.3 × the drop; faces are vertical.
- Sites are carved only when `carveChannels` is on.
- A sheer face over 8 m becomes a gorge staircase, capped at `carveFallMaxCutM` 15 m of tread cut.
- A sea landing gets a scour pool in the seabed with a sand rim ring (kept 0.3 m under sea level).

**a-land (`WaterSolve.carveChannels` stage 1c, `_carveFallSites`):**
- Each fall run (fall cells ∪ 1b's steep cells) becomes a site: level approach, straight lip on the
  reach's chord, vertical face, equal steps, and a pool at each landing. On a chute, the most steps
  whose treads hold landing + pool + approach win. Lake landings: the lake is the pool.
- Sites override the discs in their footprint.
- **Gorge rule:** lips move back only over creek whose ground holds the top tread; otherwise the site
  is skipped (never drain a lake or pit behind).
- **Staircases link:** a site whose lip is within 12 m below another's foot continues its cascade, and
  its approach reaches back to that pool (not over a lake landing).
- **`carveFallAxisSnapDeg` 6 (FUDGE):** a lip within 6° of an axis or diagonal is laid on it. That
  avoids a one-cell jog, and the chord over a pool is only good to a few degrees.
- **Plumbing:** sites persist in the Channels op payload. `_park` attaches them to segments
  (`attachFallSites`); the Bake & Export re-solve reads them back from the payload (`rescaleFallSites`).
  `save.js` exports `waterfalls[].site` (simulation 0.2.0). Editor ribbons for sited falls are mint.
- **Tests:** new `tests/test-water/check-fall-sites.js` (8 cases, including the carve loop holding with
  pools); check-carve 6 re-controlled. All 8 checks pass.

**a-water (`waterfall-nappe.js`):**
- `beginTrace` → `siteTrace` when the entry has a site: heading = normal, seeds on the approach
  across the wet width, rail 0.
- `N.chains` links by `site.cascade/step`, and later lead boxes are square to their own site.
- Otherwise the old discovery path runs unchanged (the fallback).
- `nappe-test.mjs`: 61/61 (7 new).
- The contract §2 documents the site block.

**Offline acceptance** (scratch `falls-carve.js` / `falls-trace.mjs` over `make_terrain.py --grid` into
scratch, NOT the world). falls-lab at 1 m: 13 sites, all 13 segments attached.
- A: 3×5.9 m gorge steps into the lake.
- B: one 4-step cascade.
- C: one 21 m lip, 41 strands all plunging, 22.8 of 27.4 m³/s. The discovered trace gave 23 strands
  over 11 m, 18° off, with 5 nolip.
- D: 2×6 m and 1×2.7 m.
- E: 2×5.6 m, the second into a sea scour pool.
- Takeoff lines sit within 2 cm along every lip, 0.2-0.5 m before it (the 1 m bilinear face ramp).
- hero-creek: 1 site at (472, 765), attached; floating edges 0.5 → 0.8%.

**NEXT (Dante):**
1. Editor on falls-lab: Solve Water (the Channels layer now carries the sites), then Save, then Bake &
   Export. `map.json` should show `simulation.version` 0.2.0 and a `site` on each fall. The console logs
   "fall sites: N carved, M of K waterfalls drop over one".
2. Look at A-E in `examples/demos/falls-lab-ocean.html`, then hero-creek and island-sholes.

**Not done:** the headless browser pass (it needs the bake above), and island-sholes offline (no
generator grid).

### (earlier) RESUME HERE (2026-09-23) — DESIGN BRIEF: the river owns its falls (fall-site carve)

**Status:** design agreed in principle with Dante, nothing built. It starts in a NEW session.
The skirt work below is committed on a-water `phase-6b-waterfall-splash`.
⚠ a-faraway-land `phase-6b-steep-chutes` is still UNCOMMITTED (WaterSolve.js: sectionHydraulics,
carveStepChutes, lake-outlet falls, D8 mass fixes; plus two test files) in the MAIN checkout.
Run its tests and commit it before building on it. Never stash or reset that tree.

**Why.** Every hiccup of the skirt passes came from the ground at a fall, not from the fall:
- a sill behind the lip (E);
- a rock notch in the lip (C);
- a dry rib down the face (D);
- jagged treads that funnel every parcel into one groove (B);
- on the 1 m bilinear heightfield, every face is a one-texel ramp, and the field's level sinks
  under the ground at every brink.

Each fix covered one configuration, and the next world brings new ones. Dante's proposal: "I, the
river, take ownership of the terrain between two river heights and make waterfalls I deal nicely
with." Every fall becomes a clean drop over a cliff, and the renderer meets ONE shape.
Rivers do this in nature too: knickpoints erode into steps with plunge pools. It is the same
reasoning as his "carve steep chutes into steps" rule.

**The canonical fall site** (a-land carves it; it is part of the Channels layer, like carveChannels
and carveStepChutes in `src/js/runtime/terrain/WaterSolve.js`):
1. **Approach.** A flat tread at lip height, as wide as the section's wet width (sectionHydraulics),
   at least ~2 m (the sheet's lead-in) plus the landing of the step above. No sill, hollow or pool
   in front of the edge.
2. **Lip.** One straight edge, square to the reach's direction (not D8's axis/diagonal).
   It is level across the channel, so every strand leaves together.
3. **Face.** Vertical, or undercut by a texel. On 1 m texels it is still a one-texel ramp, but a
   known, clean one.
4. **Drop per step.** Between `waterfallMinDropM` and a maximum (~6-8 m?). A bigger total drop
   becomes a staircase of equal steps. Tread length ≥ the landing distance of the jet from the
   step above + the approach. For a jet of speed v over drop d, the landing is ≈ v·√(2d/g) out.
5. **Foot.** A plunge pool dug under each landing: depth ~ 0.2-0.5 × the drop (look knob), and
   long enough to hold the landing. Its surface sits at the next tread's level, so the creek's
   level there is flat, not a ramp.
6. **Banks.** The carve stays inside the channel corridor and blends into the banks over a few
   metres. Hand-sculpted cliffs outside the channel are untouched.

**What a-land EXPORTS per fall** (instead of just top/bottom bed points):
- the lip line (two end points, height);
- the face direction;
- the drop;
- the pool (centre, radius, level);
- the tread level above and below;
- the wet width;
- Q.

The a-water trace then stops DISCOVERING the lip: seeds sit on the exported approach, and the
heading is the lip normal. The rail, the start rule, the lip-heading disc, the wet-span gap bridging
and the steep-row complement become fallbacks for un-carved worlds, not the main path. Keep them;
old worlds and hand-made terrain still need them.

**Open questions for the session** (ask Dante; don't assume):
- Max step height, and how deep the pools are.
- Undercut faces or vertical?
- Should the carve also run with `carveChannels:false`, i.e. is a fall site always carved, or opt-in?
- Where a river meets the sea from a cliff (E), does the carve cut a notch into the cliff edge?
- The WaterCarveLoop (carve ↔ FV solve) has to converge with the pools in place (the FV solve
  must see them).

**Test worlds.** falls-lab (A plunge, B cascade, C wide curtain, D steep chutes, E sea cliff) is the
acceptance world: regenerate/bake it with the carve, then look at all five from Dante's angles.
hero-creek and island-sholes are the regression worlds.
**Harness.** Headless Chrome on the 4090 over CDP. Recipe in the entry below; scratch run.mjs,
regen.py, replay.mjs and viewer.html (three.js over dumped ground/water grids) live in session
77c7f435's scratchpad and are easy to rebuild.

### (earlier) RESUME HERE (2026-09-23, later) — skirt hiccups: brink seams, shards, fading water

Same branch, still uncommitted. Plan `~/.claude/plans/okies-got-a-couple-splendid-pillow.md`.
**GLSL changed: run `create-shader.py`** (`waterfall-sheet.js` and `water-shader.js`).

**Dante's report** (browser, falls-lab), 7 shots:
1. a seam where the creek meets the fall (A);
2. a very bad sawtooth gap at the sea-cliff drop (E);
3. shards, overlaps and a river "fading in and out" on jagged steps (B, D);
4. the wide curtain fading to nothing (C);
5. a curtain that splits and never rejoins (D's upper face).

Each was reproduced at his angle in the headless harness before any fix went in.

**What the causes turned out to be** (the plan's guesses were wrong for two of them):
- **E's gap.** Neither surface drew there. It was NOT dry texels (H1 in the plan: disproved, the
  field is wet to the lip).
  - The trace began 0.5 m from the lip: the start rule judged the bed, which lies below a raised
    sill behind the lip.
  - The lead-in rode 0.6 m above the creek: on the sill the field keeps its upstream depth while
    its interpolated level runs under the ground.
  - The creek's steep ramp showed as a white band just before the corridor began.
- **A's seam.** The lead corridor box lay along the chord of the spine's path, which drifts 9°.
  The creek's cross-dissolve lines ran diagonally across a straight lip.
- **C's narrow curtain.** The lip heading came from a 3 m disc beside a rock notch (13° off). The
  skewed wet scan then stopped at the notch's 1.5 m dry gap: 9 m of skirt on a 20 m lip.
- **D's split (img 7) is TERRAIN.** The carve left a dry rib down the 45° face. The strands go
  round it on both sides correctly. This is still open item 2 of the skirt entry below: a-land's call.
- **The fading on B and D.** The corridor stepped the creek aside round the spine's whole path, as
  wide as the skirt's widest reach plus 2 m. But:
  - B's skirt narrows to a line on long ramps (every parcel slides into one groove);
  - strands that slide over the brink without a real takeoff drew nothing.
  So in both places neither surface drew.
- **Streaming re-traces are not the cause.** Measured: two rebuilds in a minute of flying, with the
  quad counts unchanged.

**Fixes (`luts/waterfall-nappe.js` unless noted):**
- **The rail.** Where the start had to move in toward the lip, the lead-in still reaches
  `upstreamStart` back: the parcel is carried straight along the heading on the creek's surface,
  with no physics. The start rule itself is unchanged: judged by the water level instead, E's
  strands started in the still water behind the sill and stalled (`nolip`).
- **`attachedOffset`** never lifts above the field's own level: `max(h, min(depth, level − ground))`.
- **Lead corridor box** of its own, square to the lip (the chain's heading on the first fall,
  the water's heading on later ones), ending at the takeoff.
  - The boxes after it have lead 0.
  - The old first box kept its lead ramp at 1 past the takeoff, and that hid hero-creek's plunge
    pool from the foot of the curtain. The pool now draws up to the foot, as designed.
- **Per-box corridor radius** from the skirt's reach over that box's own rows (+ margin).
- **Lip heading disc** = ¼ W, clamped to 3-8 m.
- **`wetSpan` bridges dry gaps** up to `wetGap` 2 m. Seeds on the dry rock are skipped, so the
  sheet tears round it.
- **Corridor cap 24 → 48** (the lead box adds one per fall; falls-lab needs 30). Changed in
  water-shader.glsl, waterfall-sheet.glsl, the sheet template, the pass and ocean-grid.js.
- **Weave rules (`buildRibbon.joined`):**
  - along-flow leeway uses the slower strand's speed when one strand is flying and the other is not;
  - fold test on the offset SQUARE to the flow (crossed by more than a strand spacing);
  - ground test against the higher of the two strands' own ground, so no false tears along a face;
  - relative velocity > g·`tearTime` + `tearRelSpeed` (1 m/s, LOOK KNOB) tears, but only once the
    pair has drifted a spacing apart along the flow. Without that gate hero-creek's foot tore into teeth.
- **Steep water after a fall (Dante, amending "free fall only"):**
  - rows on bed steeper than `faceSlope` (55°) after the first real takeoff are FALLING (fall flag);
  - rows steeper than `gentleSlope` (20°) are present as the creek's COMPLEMENT;
  - a strand that crosses the spine's takeoff line without a real takeoff (`draws`) counts as past
    the brink too;
  - chute test 2 now asserts complement-only rows down the 45° chute.
- **Manning friction × cos(bed slope)**, FUDGE: water on a face is not pressed to it.
- **Vertex stage:** the attached lift onto the creek is capped at 0.3 m (`ATTACHED_LIFT_MAX`).

**Tried and reverted: Phase B** (re-syncing material time at each later lip of a cascade).
- It was built as a per-strand time warp at sync lines.
- Measured on D's two-fall chain, it made things worse or no better: the 2nd fall's along-flow p90
  went 4.35 → 5.71 m; the 4th fall's tears went 74 → 110.
- D's strands are out of step because they take different PATHS (the rib, separate channels,
  1-4 hops each), which re-timing cannot fix.

**Verified.**
- `node tests/waterfall-nappe/nappe-test.mjs`: 54/54.
- Headless on the 4090 with a scratch regen (HEAD regen byte-identical to the committed JS):
  - falls-lab A-E before and after;
  - hero-creek (472, 765) before and after (no regression; the pool now reaches the foot).
- Harness: scratch `run.mjs` (CDP), `regen.py`, `replay.mjs`, plus a three.js `viewer.html` over
  dumped ground/water grids (offline trace iteration without the browser).

**Open.**
1. A's lip still shows a thin straight line where the creek fades into the lead-in (was a diagonal).
2. B's middle ramp: the creek is thin and irregular, and the skirt collapses to a line there. The
   real fix is Phase C: the creek steps aside only where the sheet's rendered footprint is, not in
   boxes. Not started.
3. D's rib (terrain) as above.

### (earlier) RESUME HERE (2026-09-23) — the waterfall SKIRT: many strands woven into one sheet

Same branch as 6b below (`phase-6b-waterfall-splash`), on top of its uncommitted work; nothing
committed. Plan `~/.claude/plans/okies-so-our-waterfalls-tidy-oasis.md`.
**GLSL changed: run `create-shader.py`** (`waterfall-sheet.js`: the vertex stage and the template).

**Why.** Dante: the falls were "planes that don't blend to the terrain". The trace followed ONE
parcel down the middle and `buildRibbon` extruded it into rows rigid across at one height, so no
curved brink, sloped landing or rock in the fall could be met. His proposal (how others build
falls): drop a parcel every half metre along the lip, trace each, and run a mesh between the paths.
Decisions (Dante): strands are independent and the weave TEARS (no cloth coupling); wind is physical
drag in the trace plus gusts in the shader.

**What changed (`luts/waterfall-nappe.js`).**
- `trace` = `beginTrace` (heading, start line, seeds every `strandSpacing` 0.5 m over the VISIBLE
  water, each with its own q = depth × speed) → `stepTrace(job, k)` → `traceStrand` (the old state
  machine, per seed). The spine (the middle strand that falls and ends as a plunge or settle) gives
  `rows`, `samples`, corridors and the old single-parcel fields, so the old tests still read them.
- **Rows are material time** (`timeGrid`): row k of every strand is its water at the same moment,
  with steps sized so the fastest strand moves `rowSpacing`. Aligning at each strand's own takeoff
  tore C's curtain into ribbons (a 1 m bilinear lip ramp: some strands leave at the top, some half
  way down). tau is from the spine's takeoff, so the grain is one piece across.
- **The weave** (`buildRibbon`): quads between neighbours, torn where they part ACROSS the flow
  (> `tearFactor` × spacing), ALONG it past what speed explains (`tearTime` 0.3 s; a material
  line stretches as the sheet accelerates, and that is not a tear), or with ground over their
  midpoint. The across frame comes from the neighbours. The walls, spans, relax and "shrink and stay
  shrunk" are deleted; `colSpacing`/`wallStep`/`fallSpread`/`takeoffSpanBack` are gone.
- **Physics the single parcel never met**, each found on a skirt case:
  - A flying parcel that crosses into a FACE (ground > `wallJump` above it) loses its speed into
    the face (an impact) and falls on down it. It used to be snapped onto the rock's top.
    Not when it is already embedded: that looped one strand for 60 s on D.
  - A sliding parcel meeting a face slides along it, or stops head-on (`wall`); it used to climb it
    in one step.
  - **Across, a sliding parcel feels the water SURFACE slope** where it has water, not the bed's:
    the bed shelves to the banks, and every edge strand was pushed to the middle (one crossed a
    5 m creek before its lip).
  - Rims and slots: a gap behind reads the bed ahead, a gap behind plus a face ahead reads flat
    (in the slot between a cliff and a rock off it, the parcel ping-ponged).
  - The critical-speed hold is forward only. `lipSearch` 10 m: a strand circling a pool beside
    the lip gives up (`nolip`, was a 60 s budget).
- **Wind:** air drag on the airborne sheet from the wind NORMAL to it, a = ½ρ_a·Cd·Un|Un|/(ρ_w·h),
  with `sheetDragCd` 1 (FUDGE, flat plate). A 10 m/s downstream wind bows a 10 m curtain out; a wind
  along the lip is edge-on and does nothing. `env.wind` = the ocean's `windVelocity`.
- **Impacts** are clusters along the foot (`impactClusterWidth` 2.5 m), each with its own
  `width` and `discharge` (they sum to the fall's). The splash `_emitFalls`/`_emitFallSplash` and
  FlowFoamPass use them (with the fall's own as the fallback).

**Pass + shader.** `WaterfallSheetPass` traces `STRANDS_PER_TICK` 2 (~0.85 ms each), swaps a chain's
ribbon in whole when its last strand is done, and re-traces when the wind moves > 0.5 m/s.
`aFlowLump` is now vec2 (lump weight, s since the latest takeoff). The vertex stage adds a gust
sway about the traced bow: the same drag law, 2·`uWindSway` (0.3) × a slow noise, ½·a·t², free
fall only (the lip and the foot stay put); FUDGE for the gust itself. `uWind` is written per tick.
The fragment stage is unchanged: across × halfWidth is each strand's SEED offset, so the grain
rides the water.

**Verified.**
- `node tests/waterfall-nappe/nappe-test.mjs`: 54/54. The new cases are a straight lip (11
  strands, one lip line, no tears, and impacts that carry Q), a curved lip, a rock in the fall
  (strands hit it and fall down it; nothing on or through it), a cross-sloped landing, wind
  (down / along / still) and a creek shallow at its banks. Old 10 and 11 were rewritten for the
  skirt.
- Headless on the 4090, scratch regen (the regen of HEAD's GLSL is byte-identical to the
  committed JS):
  - All programs are runnable.
  - hero-creek: 23 strands, 1303/1352 quads, trace 20 ms.
  - falls-lab: every cascade builds. A is 23/23 plunging (2168/2245 quads), C 926/956, E 1521/1524.
    No `budget` strands.
- **Against HEAD's single-parcel version (swapped in on the same page):** C drew no curtain at
  all (mist only), and E's sheet was a slab floating at the foot, apart from its lip. With the
  skirt both are curtains from lip to water. (HEAD lacks 6b's own nappe fixes, so this is not
  quite the pre-skirt working tree.)

**Open.**
1. Dante: `create-shader.py`, then look at falls-lab A/C/E and hero-creek (472, 765).
2. **D's 45° face splits into two chutes round a central rib** (strands 0-9 end at x ≈ 673,
   10-15 at x ≈ 667). The skirt shows the rib the old ribbon hid. Terrain call: did the carve
   mean to leave it?
3. C's brink has a ~1 m notch (strands 9-16 leave early); the sheet folds and shades darker there.
   Real geometry.
4. Impacts: D's chain alone gives 24 clusters and FlowFoamPass keeps its nearest 16 over all
   falls. Raise the cap or thin clusters per landing if foam goes missing.
5. The corridors still run down the spine only (radius = the skirt's reach); a horseshoe lip may
   want boxes along the edge strands.
6. Not built: lateral smoothing between strands (planned as optional; no jitter seen headless).

### (earlier) RESUME HERE (2026-09-22, late) — Phase 6b built, awaiting create-shader.py + falls-lab bake

Branches: a-water `phase-6b-waterfall-splash` (off development 113cb10), a-faraway-land
`phase-6b-steep-chutes` (off main 5960a31, in the MAIN checkout). Plan
`~/.claude/plans/ready-to-start-on-agile-wirth.md`. Nothing committed yet.

**New test world `a-faraway-project/falls-lab`** (generated; `survey/make_terrain.py`, README).
- Five straight creeks, one kind of fall each:
  - A: 18 m plunge into a 2.5 m lake (x 210.5).
  - B: 4 × 3 m cascade (x 360.5).
  - C: 26 m wide curtain, 5 m drop (x 520.5).
  - D: steep chutes at 45° and 35° (x 670.5).
  - E: 18 m sea-cliff fall into a cove (x 820.5).
- Pages: `examples/demos/falls-lab-sky.html` / `-ocean.html` (gitignored).
- Dante's step: paste the 5 `_placeWaterIntent` lines, then Solve Water → Save → Bake & Export.
- Offline D8 solve (`survey/falls-solve.js`) finds all five archetypes.
- Generator lessons:
  - Creek centrelines sit on cell centres (x = k + 0.5).
  - The superellipse exponent is 8, or the corner land drops below the creek heads.
  - Re-runs only rewrite the heights; `--force` keeps `survey/`.

**Splash (needs create-shader.py: ocean-splash.js).** Headless-verified on hero-creek-sky with a
scratch regen (the regen of HEAD's GLSL matches the committed JS).
- **Instanced quads** replace THREE.Points: `aCenter` + `aVel` + the old per-particle attributes,
  expanded in view space. `uMaxPointSize` is retired.
- **Camera-inside fade:** a puff closer than its radius fades out (`vViewZ / vHalfW` 0.2 → 1).
  Without it, 10 m fall-mist quads walled the view near the foot.
- **Mist retuned:** `fallMistSize` 1.0 → 0.7. The 512 px cap had been shrinking the plume Dante
  tuned, and 0.7 matches that size at 8-10 m.
- **Type 3 = waterfall splash:** white aerated clumps with a ragged edge, streaked along the
  view-projected velocity (`fallStreakTime`).
  - `_emitFallSplash` runs per traced impact. It launches along `_launchAxis` (factored out of
    emitImpact: reflect + run-up) at `fallSplashSpeed` 0.5 × the impact speed, capped at 9 m/s.
  - It spawns at max(impact y, the water level).
  - Knobs: `fallSplashRate/Size/Life/Speed/MaxLaunch/Spread/Opacity`, `fallStreakTime`.
- **Water kill:** types 2 and 3 also die on a-land's CPU `getWaterAt` level when depth > 2 cm
  (known-dry aware). ocean-grid passes `getWaterAt` in the splash ctx.
- nappe-test case 13: the plunge lands at the lake SURFACE (y 24.30, vn 20). 31/31 pass.

**Steep chutes (a-faraway-land WaterSolve `_isFallStep`).** A fall cell now also passes on the bed
gradient projected along the flow (chord to the cell two D8 steps down), not only on the one D8 step.
- **The bug:** D8's diagonal zig-zag measured a 35° face at 24°, split the run, and culled the
  pieces under 2 m.
- **Results:** falls-lab D's 35° face is now a fall, and its 45° face 11.5 m (was 10.9).
  - New `check-falls-autolakes` case 4 (an oblique zig-zag chute): the old engine finds no fall.
  - The suite passes, except `check-lake-preview`, which already crashed on main with
    `ALand is not defined`.
- **island-sholes 5_9: small effect.** Steep D8 cells covered by falls went from 12 to 14 of 18.
  The cliff water there is the **FV bake's shipped surface on the faces**, not fall
  classification: an open decision for Dante (ship steep FV flow dry at export, or make it
  sheet corridors).

### (earlier) RESUME HERE (end of 2026-09-22) — Phase 6b: the splash at the foot

**State.** Dante: "we've really cooked already with this waterfall." Browser pass on hero-creek-sky
after the sweep below, then these commits (all headless-verified over CDP against his server, with
a scratch regen swapped in for the GLSL ones):
- **bcc2d64** still surface: thin-water rule inside the flowing hand-off band (puddle at (546, 643)).
- **58c8ca8** corridor 2 m past the landing ramp + margin 2 m, landing tail restored (regression
  from 17c48a5), FlowFoamPass realignment gated (the fork/swirl at the hydraulic jump).
- **e375117** landing tail boils (`uTailBoil` 0.12).
- **2a0b6e2** tail as wide as the creek draws water (the hourglass).
- **bc04041** fall mist has its own opacity (`fallMistOpacity` 0.6, rate 50). Page `opacity` 0.1
  had hidden it.

**Needs `create-shader.py`** if not run since bc04041: waterfall-sheet.js, water-shader.js,
ocean-splash.js.

**Phase 6b (next session): chunky splash at the foot.** Decided direction: ballistic particles
with a waterfall look, not a fluid sim. The trace already gives each impact's point, speed and
width, and a splash strip ~1 m tall is where ballistic arcs are close to exact.
1. **Point-size bug (seen by Dante).** Particles are GL points clamped at `maxPointSize` 512 px
   (ocean-splash-vertex.glsl:81). A 1-1.5 m mist puff within a few metres wants more, so puffs
   shrink as you approach. Fix: camera-facing instanced quads (also removes hardware point caps).
2. **A waterfall particle type.** White clumps and short droplet streaks, not the sea's foam
   beads and chunks (round 9 hid those for exactly that). Emitted from `nappe.impacts` weighted
   by `w`, launched from the impact speed with a reflected, run-up cone (`emitImpact` already
   does the kinematics).
3. **Die on water contact.** Particles already die on land; add a kill below the field's
   water level (known-dry aware), so a splash falls back INTO the pool instead of through it.
4. Knobs live on `oceanGrid.oceanSplash`, like `fallMistRate`/`fallMistOpacity`.
5. **Steep chutes: water on cliff faces (found 2026-09-22, stowed for 6b by Dante).**
   - **Symptom:** on island-sholes' steep island (tile 5_9), the rivers run on faces of 45-53°
     (median gradient 1.1-1.3). There a heightfield surface cannot sit on 1 m texels: half a
     texel of misalignment is half a metre of height. The level ends up metres under or over
     the rock (26-50 % buried; level minus ground p10 −2 m, p90 +5 m).
   - **What it looks like:** mode 66 shows deep water drawn under green terrain, with magenta
     guard rims where they almost meet. The flowing surface leaks through as "phantom water
     rushing down".
   - **The shallow-water pass misbehaves there too:** median depth 1.4 m on a 53° face, and
     ~30 pothole "lakes" of 1-32 m² at 22-65 m up the cliff.
   - **Cause:** a-land only calls a segment a waterfall when it drops ≥ `waterfallMinDropM`
     (2 m) past 30°. Everything else steep goes to the flowing surface, which cannot draw it.
   - **Plan:** treat any continuous flowing run steeper than ~35° as a fall segment (the
     sheet's attached mode, hugging the rock) whatever its drop, and suppress potholes on
     steep ground.
   - **Fallback if that stalls:** ship flowing water steeper than ~40° dry at export.
   - Every other island-sholes tile matches its terrain to a few cm, so this is steep-only.

**Not now:** PBF / MLS-MPM / DFSPH baked into a loop. Every fall and cascade step differs (width,
speed, landing), so a loop needs a bake per fall and repeats visibly, and the curtain already
carries the bulk. If a hero plunge ever needs churning mass, a live small-box sim on the 4090 can
slot in behind the same impact points.

**Also open:**
- A thin brown seam where the landing boil meets the creek foam. Over-compositing complements
  (sheet alpha 1 − c over creek alpha c) covers only 1 − c(1 − c), so 25 % terrain shows at
  c = 0.5. The fix sharpens the crossover or makes the sheet opaque where it draws, which changes
  every hand-off: ask Dante first.
- Orange terrain speckle through the creek at grazing angles (pre-existing, seen in the harness).
- Tail edges are straight (fray is free-fall only): a taste call.

### Earlier on 2026-09-22 — bug sweep of rivers + falls

Both of 2026-09-21's open items are fixed. A review of the nappe/pass, the sheet shaders and the
flowing-water path found more; plan `~/.claude/plans/let-s-give-it-a-snoopy-locket.md`.
**Needs `create-shader.py`** (waterfall-sheet.js + water-shader.js). Commits 55dd726..3f4efd8:

- **55dd726** commits the generated JS. `waterfall-sheet.js` had never been tracked, so a clean
  checkout drew no falls (ocean-grid builds the pass only when the material exists).
- **17c48a5, trace** (`node tests/waterfall-nappe/nappe-test.mjs`: 4 new cases, each fails on the
  old code):
  - A takeoff step no longer runs the attached checks. A pool texel overhanging the cliff foot
    read as a sliding plunge and skipped the whole free fall.
  - **Shrink and stay shrunk**: along each free-fall run each side may widen by at most
    `fallSpread` (0.05 m/m). Free-fall rows have no quarter-width floor inside rock, and each
    side's own half-width goes to the shader (`aFlowB.w`).
  - Landing spans are capped at the jet plus spread. A 3.75 m jet flared to 11 m over a lake.
  - Impacts are weighted by the drop since takeoff (`w`, hopDropLo/Hi). Run-out hops crowded the
    plunge out of the foam's nearest-16 and flooded the mist pool.
  - Touchdowns back off (bisection) to the surface crossing, and the first plunge stays the plunge.
- **25c25b2, pass**:
  - Failed traces go to a retry list on their own clock. One fall on ground that never loaded
    kept the queue full, and no sheet published.
  - Re-trace also when `waterFieldPass.invalidationCount` bumps (water tiles landing).
  - `dispose()` clears the creek's corridors.
- **fc88499, sheet GLSL**:
  - Behind the free fall, only field water at P is a bed. Dry rock was lit under a fall-high
    column: a near-black teal curtain.
  - The fall's ripples are in (across m, τ·3 m/s), advected with the water: glints ride down.
  - Seamless time wraps: whole tiles in both grain layers, periodic lump noise.
  - The frame comes from the trace (varyings), not the viewer-flipped normal.
  - Free-fall fragments under 20 % alpha skip depth, because they clipped the mist. Look knob
    `DEPTH_ALPHA_MIN`.
  - Soft contact reads the depth attachment; the refraction bend is in view space.
- **5207ca1, rivers**:
  - The level-bridge exemption and the all-dry cut were read from FILTERED RT0.a; both are
    decoded now.
  - Level gradients (normals, foam direction, step foam) drop dry taps (nearest-wet level =
    maybe another body).
  - The 2 m ring discards under the 1 m ring (`flowRingHole`); the overlap had double-blended.
  - A disabled flowing ring stays hidden.
- **3f4efd8, field**:
  - `invalidate()` marks cascades stale rather than un-centring them. That uploaded (0, 0)
    mid-frame.
  - A failed water-tile fetch retries after 5 s instead of going dry for the session.
  - G-buffer resize frees its old depth texture.

Harness: a scratch WebGL2 compile check (headless Chrome, `--dump-dom`) builds the water shader
still + flowing the way ocean-grid.js does, plus the sheet and foam pass. It is validated against
HEAD first. It proves the shaders LINK, not how they look.

**Browser checklist for Dante:**
- rock behind the fall no longer dark teal;
- glints travel down;
- no sheet re-growing below the jut;
- mist not clipped at the sheet edges;
- distant sloped creeks have no ragged bank holes;
- no square outline ~125 m out on creeks.

**Found, not done:**
- **Standing-wave phase** (water-shader.glsl `along = dot(vWorldXZ, vdir)`): at |x| ≈ 1 km any
  bend turns the phase to noise, because the phase gradient carries |x|·∇θ. A local origin
  cannot fix it: it jumps when the window recentres, and blended cells cancel. Needs a
  distance-along-flow coordinate advected in FlowFoamPass.
- ShoreBreaker/WaveMask still threshold filtered `field.a` (sub-texel at creek mouths). Their
  CPU mirrors must change in step.
- CPU twin flow weight ignores the GPU band blur.
- Dry-tap cascade switch has no crossfade.
- Sheet `creekWetAt` filters RT0.a (soft edge only).
- The SSR fisheye fallback with AP off is untested (the round-2 zeros were seen with AP ON).
- Derivatives inside the refraction branch (shadow slope bias).
- The depth attachment is 24-bit; 32F would not help without reversed-Z.

### Deferred

The plunge pool's
dynamic-waves impulse (Phase 8); fountains; hard vertical side edges (the fray is weak); the
PIC/SPH microsim behind the same lip + pool interface if the sheet does not sell big falls.

---

## Phase 10 — the sampler budget: cascades + ocean CSM become texture arrays — **written, headless-verified, awaiting regen + browser** (2026-09-20)

Branch `convert-textures-to-texture-arrays`, off `multi-water-types` at `e3f0f00`. Plan:
`~/.claude/plans/okies-we-should-have-humming-shannon.md`.
**GLSL changed: run `create-shader.py`** (water-shader.js + ocean-shadow.js).

**Measured 30 -> 22 texture units of 32**, on the linked program, on
`examples/demos/islands.html` under headless SwiftShader. Not counted in the GLSL: source
counting is wrong the moment a shader is specialised by flag, which is exactly when the count
matters.

### The premise in the Phase 10 scoping was wrong, and it was the headline

`WATER-TYPES.md` and `flow-surface-pass.js:21` both said caustics were compiled out of the
`$flowing_water` variant to make room for flow, so rivers had none. They had been switched back
ON five days earlier, in round 7 (2026-09-15): `$caustics_enabled` is independent of
`$flowing_water`, and `ocean-grid.js:1016` records why (the in-shader seabed caustic is
world-space, so it works on a creek bed 20 m up; with it off, a lake and the creek running into
it lit their beds differently). Rivers already had caustics. Both comments are corrected.

This does not change the decision, only the justification: the reason is Phase 6 wanting units
of its own, which was always the second bullet.

### What changed

- **`ARestlessOcean.createArrayRenderTarget` / `assertArrayRenderTarget`** (`ARestlessOcean.js`),
  next to `cloneUniforms` rather than in a new file, so nothing had to be registered in
  `make-combined.py` and six example pages.
- **Cascades 6 -> 1.** `ocean-height-composer.js` builds one `WebGLArrayRenderTarget` with a
  layer per cascade. Consumers: `water-shader.glsl`, `water-vertex.glsl`,
  `ocean-shadow-vertex.glsl` (the uniform is `cascadeDisplacementArray` now — renamed so a
  missed site fails loudly rather than silently changing type). This is one unit in the VERTEX
  stage too, which has its own limit.
- **Ocean CSM 4 -> 1.** `ocean-shadow-csm.js` renders each cascade into a layer. The separable
  blur keeps its shared 2D scratch and gained a second material for the horizontal pass, which
  is the only one whose source is the array (a target cannot be sampled while it is bound).
- **Three passes were pulled along**, because they read the same composer textures under other
  names: the height-readback bake (`hfCascadeTex[6]`), the shore-reflection step
  (`srCascade0..5`, six discrete uniforms), and the CSM caster's vertex stage.
- **The gate.** `OceanGrid.auditTextureUnitBudget()` counts samplers on every linked program and
  `console.error`s when one is over `MAX_TEXTURE_IMAGE_UNITS` — that failure used to be silent.
  Runs itself a few ticks in; `auditOceanTextureUnits()` is the console handle.
- **Two if/else chains collapsed.** A `sampler2DArray` takes its layer as a coordinate, while an
  array of samplers demands a constant index. The per-cascade Jacobian strip (debug mode 30) and
  the EVSM cascade thumbnail were both written out only to dodge that rule.

### three r173: three findings, all verified in the super-three 0.173 source

A-Starry-Sky's `TEXTURE-ARRAYS.md` was written against r185, so every load-bearing claim was
re-checked rather than inherited.

1. **`WebGLArrayRenderTarget` silently discards its options.** It builds a correct texture from
   `options`, then overwrites it with a bare `DataArrayTexture`: Nearest filters, ClampToEdge,
   no mips, RGBA **UnsignedByte**. `type: FloatType` in the options object does nothing. This is
   why the wrapper exists. Undetected it would not have looked like a bug — the waves would have
   drawn, merely stepped, because the displacement had been quantised to 8 bits.
   ⚠ **A-Starry-Sky has this latent**: `TextureArrayBuilder.build()` passes format/type/filters
   in options and only re-applies `generateMipmaps` and `anisotropy`. Its defaults happen to
   match `DataArrayTexture`'s, so nothing is broken there today — but the first family that
   wants Linear or Repeat or float will get Nearest, Clamp and bytes instead.
2. **`sampler2DArray` is available even though the ocean material sets no `glslVersion`.** three
   upgrades every non-`RawShaderMaterial` to `#version 300 es` unconditionally and adds
   `#define texture2D texture`, which is also why the existing `texelFetch` calls compile. And
   `generatePrecision` emits `precision highp sampler2DArray`, so the precision trap that cost a
   day on the river solver does not apply here. (There is no `RawShaderMaterial` anywhere in
   `src/`.) The shaders declare the precision anyway, to state the requirement.
3. **`readRenderTargetPixels` has no layer argument** — only a cube face. But
   `setRenderTarget(rt, layer)` attaches the layer to that target's own framebuffer and the read
   binds the same framebuffer, so binding the layer immediately before the read is exact. The
   async variant issues its `readPixels` before its first `await`, so rebinding for the next
   cascade cannot disturb a read already in flight. This is what the three buoyancy/submersion
   readbacks in `height-readback-pass.js` do now.

Also confirmed good at r173: `updateRenderTargetMipmap` resolves through `getTargetType` to
`TEXTURE_2D_ARRAY`, so mipmaps need no hand-rolled `generateMipmap`.

**One cost that is real.** three regenerates mipmaps at the end of every render into a target
that asks for them, and for an array target that rebuilds the chain for EVERY layer. Left alone,
six layer renders would do six full-array chain builds a frame where six separate targets did one
each. `ocean-height-composer.tick()` holds `generateMipmaps` down until the last layer, which
leaves exactly one chain build per frame covering every layer written — inside three's own path,
not behind its state cache.

### How it was verified without running create-shader.py

The house rule is that Dante runs the regen, and `create-shader.py` cannot be imported to
dry-run it (its watcher loop is at module level and starts rewriting generated JS immediately).
So the transform was reimplemented into a scratchpad directory and **proved faithful by
regenerating three untouched shaders — `ocean-splash.js`, `position-pass.js`, `horizon-skirt.js`
— and diffing them byte-for-byte against the committed output**. A temporary page loaded the
scratchpad-generated `water-shader.js` / `ocean-shadow.js` in place of the repo's; nothing
generated was written into the repo.

Before/after was then taken against a **detached HEAD worktree**, so the comparison ran the real
old code rather than a remembered version of it:

| Check | HEAD | After |
| --- | --- | --- |
| Worst program | **30** of 32 | **22** of 32 |
| Cascade texture tuple | Float / RGBA / LinearMipmapLinear / Repeat / mips | identical |
| Per-cascade row RMS (C0..C5) | 0, 0, 0.00012, 0.224, 0.410, 0.075 | 0, 0, 0.00009, 0.220, 0.373, 0.076 |
| EVSM M1 per cascade | 12.503, 12.372, 12.196, 12.208 | 12.490, 12.359, 12.191, 12.207 |
| Console output | — | identical apart from the count |

(Row RMS differs in the last digits because the FFT is time-varying and the two runs sample
different phases; the per-cascade profile is the same.)

**Cascades 0 and 1 read exactly zero, and that is pre-existing** — HEAD does the same. Those two
bands cover 1–4 km wavelengths, which carry no energy at these wind speeds. Worth knowing before
anyone reads it as a conversion bug: two of the six cascades appear to be costing memory and a
pack pass for nothing. Not investigated here.

### Still to do

- **Dante's browser check.** Waves have shape and distant water is neither shimmering (mips
  alive) nor over-blurred; ocean self-shadow via debug 25/26 and the cascade-band overlay 40;
  the boat floats, which is the only check that exercises the layer-bound CPU readback; and
  `hero-creek-ocean.html` for the `$flowing_water` variant, which takes a different path through
  the same declarations and was not compiled by the headless page.
- **`waterFieldCascade0/1/2` (3 -> 1)** — left alone deliberately. a-faraway-land's
  `terrain.frag:642-679` and `TerrainMaterial.js:134-136` read the same three textures we
  publish, so it has to land in both repos together.
- **Foam packing (4 -> 2)** — needs a regenerated asset.
- The dead `horizon-skirt.*` material still declares `cascadeDisplacementTextures[2]`. Left
  untouched by decision: `horizonSkirtMaterial` is never instantiated (the real skirt clones the
  ocean material) and `make-combined.py` already excludes it from `dist` as drifting dead code,
  so it links no program and costs no units.

---

## Phase 4 — flowing water, proven on creeks — **steps 1–3 written, headless-verified, awaiting regen + browser** (2026-09-14)

Branch `phase-4-flowing-water`, off `multi-water-types` at `c0f12e6`. Plan:
`~/.claude/plans/okies-i-think-we-re-delegated-stroustrup.md`.
**GLSL changed in every step: run `create-shader.py`** (water-shader.js + ocean-shadow.js).

### Decisions taken with Dante (2026-09-14)

1. **Field-grid sheet, not ribbons, for Phase 4.** a-land exports no centrelines
   (no spline, no river body, no graph). All shading is world-space, so Phase 5's
   ribbons swap the geometry only.
2. **Wave profile buffers stay in Phase 4**, as step 4 (not written yet).
3. **Foam is driven by our own physical terms, not a-land's energy.** On
   island-sholes every creek is 14 m wide and 0.2 m deep at 1–3 m/s (width 4√Q
   at the default 50 % source, 12.5 m³/s), so Froude ≥ 1 and energy = 1 everywhere.
   **Note for a-land:** that width formula makes every default creek supercritical.

### What the data looks like (fresh export, 2026-09-14 10:39)

- Five creeks. wtr-6's lower run is at x 1741–1785, z 2098–2231, passing through
  auto-lakes 15.99 and 14.05. The wtr-8 creek runs down the steep island through
  13 `waterfalls[]` entries. The two lakes sit at 15 m (1719, 1960) and 16 m (2034, 1989).
- a-land stamps a **disc of level and velocity per bed cell**. The level is a
  staircase down the bed, and past the last wet texel the ground often lies
  *below* the continued level. It renders no water and carves no channels.

### Step 1 — the hand-off weight (58f78b7)

- **Where the weight goes.** `w = smoothstep(0.05, 0.25, |v|)` is packed into
  **RT0.a**: wet `−w`, known-dry `1 + w_nearest`. No sampler is spent, and every
  older reader of the dryMask channel still answers the same question.
- **`ARestlessOcean.FlowHandoff`** (ocean-wave-field.js) holds the GLSL and a JS
  mirror.
  - It **decodes before filtering** (4× texelFetch).
  - It is spliced at `$flow_handoff_functions` into the water vertex and fragment,
    the CSM caster and the height bake.
  - The clipmap scales masks, breakers and reflection by `1 − w`, and
    dither-discards against a static blue-noise threshold.
- **CPU side.**
  - `oceanGrid.waterFlowAt` and `ARestlessOcean.queryFlow` read from a-land.
  - The wave twin applies the same weight.
  - `testWaterFieldParity` now checks flow and energy: **15/15 flowing points
    match `getWaterAt`**, with 0 mis-packed texels.
  - `showShoreField(c, 'flow' | 'energy' | 'handoff')` draws the new channels.

### Step 2 — the flowing surface (dfb2fad)

- **`ARestlessOcean.Passes.FlowSurfacePass`** (new flow-surface-pass.js) draws two
  camera-following grids:
  - 1 m cells over ±128 m on cascade 0's texel centres;
  - 4 m cells over ±512 m on cascade 1's, with one cell of overlap.
- **The `$flowing_water` variant** is substituted in ocean-grid.js, not the
  template.
  - It compiles out the FFT cascades, caustics and the ocean CSM: **17 samplers**
    against the ocean's 28 on this page.
  - Normals come from the level gradient (±1.5 m).
- **Registration.** `OceanGrid.createFlowingWaterMaterial` and `registerOceanMesh`
  hook it in, and the atmosphere recompile knows the variant.
- **The bank cut uses the shoreSDF zero line, not the dry mask.** The dry mask
  drew a 1 m staircase, because the terrain cannot hide a cut on ground below the
  level.
- **Culled vertices drop 30 m.** Their triangles are discarded below the level.
  Without that, walls showed.

### Step 3 — foam accumulation (5611501)

- **`ARestlessOcean.Passes.FlowFoamPass`** (new flow-foam-pass.js): 512² float
  ping-pong at 0.5 m (±128 m).
  - Channels: r = foam, gb = smoothed flow, a = energy.
  - Each step does semi-Lagrangian advection and decays with τ = 6 s.
  - Sources: convergence and bank shear above an onset, bed steps (|∇level|
    0.5–0.8) × |v|, and discs at the waterfall bases.
- **Measured.** A 1 m stencil read every disc-stamp edge as foam, giving
  creek-wide mean coverage 0.36. **A 2 m stencil plus onsets gives 0.045**, as
  streaks from the lake outlet lip and the chutes.
- **Material.**
  - Two-phase Vlachos advection of the bubble layers.
  - A sliding black point for the foam shape, which is valid here because the
    grain is not world-locked.
  - The ocean's layer average is now `mix(a, b, 0.5)`: identical output.
- Debug modes **63** (foam coverage) and **64** (current). The `<ocean-river>`
  config group lives in config-terrain.js, so no new script tag.
- **Headless.** island-sholes runs at 58–60 fps on the 4090. Standalone
  `islands.html` has no pass and no errors.

### Browser round 1 (Dante, 2026-09-14) and the a-land carve

Six screenshots:
- a flat sheet with polygon edges that stops short of the sea;
- spikes in the surf running around the island;
- water going over a hill;
- polygon lakes;
- a horizontal bar at a spring, and an upwelling out of a lake;
- a steep fall popping in and out;
- lakes with no shore waves.

**Diagnosis.** It came from an offline decode of the export plus headless live shader
patches.

- **Root cause: a-land never carved a channel.** Each creek is a disc of flat water per bed
  cell, 0.15–0.35 m deep, on the unmodified ground. About 25% of the dry texels beside a
  creek lie *below* its continued level (the floating edges). On steep ground the
  rendered terrain wins the depth test through a film that thin: the holes on the fall.
  Removing our wall discard and bank cut in live shader patches did not remove them.
- **The data is connected.** All flowing components touch still water, and wtr-6 reaches
  the waterline at z ≈ 2229 with a 0.37 m step. The sheet ending at the beach is real. A
  plume into the surf is estuary work.
- **The surf sand patches are the Phase 3a drawdown patches.** They go away with breakers
  off.
- **Not reproduced:** the spikes around the island. That needs Dante's camera position.

**Fix, in a-faraway-land:** branch `water-carve-channels`, commit `3d5ce1c`.
- `WaterSolve.carveChannels` derives the bed, and Solve Water now runs solve → carve →
  replace the *Channels* layer → solve again.
- Bake & Export's refresh does not re-carve.
- Offline on the same heights, floating bank texels beside flowing water drop 1144 → 224
  on the long island and 628 → 106 on wtr-10.
- Wet width is 13–15 texels, and the deepest cut is 3.47 m.
- `check-carve.js` added. `check-lake-preview.js` was already failing before this change.

**Decided with Dante:** a-land carving now. Then in a-water: step 4 (ripples + speed
roughness), lake shore lapping, and the fringes + mouth plume.

### Browser rounds 2–3 (2026-09-14)

- **2cb8f3d (JS).** Three fixes:
  - The flow sheet stays inside cascade 0 (1 m to ±128 m, 2 m to ±240 m, window
    228 m). On cascade 1, 4 m texels drew hand-off squares, and the bank dilation
    drew wedges over lakes.
  - energy ≥ 0.25 counts as flowing. a-land leaves some river cells nearly
    motionless, and they drew as sloped still slivers.
  - Breakers and swash are gated off on flowing water and on dry texels dilated from
    it, because the creek banks joined the shoreline.
- **Round 3 (camera at 1797, 26, 2499).** The big "sheets over land" are the real
  wtr-10 creek, confirmed with a binary debug patch: wet + flowing. The jagged
  textured patches are small still pools, rendered as tiny oceans.
  - The pools came from the carve. Manning depth grows where a steep reach flattens,
    so the bed dipped into pits.
  - a-land 9d1ae1b makes the centreline bed non-increasing. Offline, pools go
    35 → 3 on the long island.
  - The first editor re-bake after it still showed about 3× the carve. That was
    stale code or a double carve. The second solve logged 11,622 cut / 10,142 raised,
    which is correct; its export is pending.
- **Island-sholes has `rainRunoffPerKm2: 2` in its water settings.** Dante is testing
  with it at 0.
- **Step 4 (8e56a99, needs regen):** the ripple profile buffer and standing waves,
  normals only. See the commit message.

### Browser rounds 5–6 (2026-09-14, late)

**a-land (branch `water-carve-channels`).**
- f10fbfe: Manning uses the reach slope, 8 cells down the path, not one D8 step. A flat
  patch read as slope 0, which gave 2 m of water on a 0.3 m creek. The carve's
  min-combined discs made 7 m flats, hence the domes.
- f10fbfe also raised the carve cut limit to 40 m. On the jagged steep island that cut
  40–77 m slot canyons (mu2806ib: 13,798 cells cut deeper than 5 m).
- **ef1e621 sets `carveMaxCutM` to 3: "trench small, lake big"** (decided with Dante).
  `check-carve` gains an enclosed-ring control: uncapped 11.8 m, capped 3.7 m, a lake
  forms.
- **Workflow trap.** The Channels layer only persists on Save (⌘S). Bake & Export writes
  carved heights into the project's `tiles/height`, so an unsaved session leaves the
  carve baked in at startup; a terrain history rebuild removes it.

**a-water.**
- c16b41e: the vertex cull is dilated (no bare band between creek and pond), and the
  current turns down the water surface's slope (no D8 zig-zag).
- 6c567ee: the hand-off is an ~8 m alpha cross-fade.
  - WaterFieldPass blurs the weight; the flowing sheet is transparent with alpha = w.
  - A dither over that width read as speckle.
  - Caustics stay off on creeks: the projector samples ~0 there and darkened the bed.

### Browser round 7 (2026-09-15) — seven screenshots, headless-reproduced

Plan: `~/.claude/plans/okay-so-i-m-trying-valiant-quokka.md`. Scratch harness (not committed):
regen into scratch + CDP Fetch swap, and an offline tile audit (water tiles vs height tiles).

**a-water (uncommitted, GLSL changed → run `create-shader.py`).**
- **Beach spikes** at (1839, 19, 2359) looking at the steep island: confirmed by a debug patch
  painting fragments whose interpolated vertex level differs from their own field level. Dry
  texels inherit their nearest water's level, so a beach between the sea and a creek steps
  under the sand; coarse clipmap cells bridged the step, and the swash exception kept them.
  Fix: the still surface discards where `|vFieldLevel − field.r| > 1 m` (flowing texels exempt).
- **The creek never got the Jerlov preset.** The per-tile block became
  `applyStaticWaterUniforms`, also called by `createFlowingWaterMaterial` (verified: the
  flowing uniforms now equal the tiles', water-type 5).
- **Caustics when diving into a creek.** The SpotLight projector is scaled by
  `1 − flowWeight × windowFade` at the camera (creek: intensity 0; sea: unchanged). The
  clipmap's in-shader caustics fade by `1 − w` across the band.
- **Still shore cut** also on the shoreSDF zero line (known-dry taps only), as the flowing
  bank already was.
- **River mouth drained to sand** (the "tide" is the Phase 3a swash; a-water has no tide):
  drawdown fades out by band weight 0.2 (`SWASH_FLOW_DRAWDOWN_W`), GPU and CPU. FlowHandoff
  now splices before ShoreBreaker in the fragment and both height-readback shaders.
  - Time-lapse at the wtr-6 mouth, before: sand between the tip and the sea in 2 of 8 frames.
    After: attached through the cycle.
- **Not done (deferred):** the mouth plume (Phase 7, Dante). Closing still pockets in the mouth.
  The any-wet-corner decode is kept for `getWaterAt` parity.

**Data audit of the island-sholes export (tiles 08:40 height, 08:49 water).**
- Still water: terrain = level − depth to 0.07 m at p99.
- **Flowing water on the steep island (tile 5_9): 1931 of 2054 texels float 10–50 m above the
  terrain, depth not saturated.** The terrain holds deeper cuts than the solve saw, i.e. two
  carve states. Other creeks match within ~0.3 m. Needs one consistent Solve → Save → Bake &
  Export.

**a-faraway-land (branch `water-carve-channels`, uncommitted).**
- **The height pyramid was a 2x2 box on EDGE-ALIGNED tiles**: parent texels half a child texel
  off, alternating by quadrant.
  - Steep island, lods 2–4 against lod 0: p99 4.5–5.7 m, worst 9–12 m. This is the LOD
    "jumping".
  - Now `mipGenerator.heightmapEdgeQuadrant`: the coincident child texel, the suite's own
    invariant. A tent filter was tried first and still gave p99 3.9–4.7 m.
  - `heightPyramid` bumped 3 → 4, so the next bake re-derives every coarse tile.
  - `check-disk-pyramid` gains a plane-position check (the box is the failing control) and a
    shared-edge check. All lod-coherence checks pass.
- **Coarse water export:** a box-filtered texel is wet only at ≥ 50% wet footprint
  (`MIN_WET_FRACTION`); mean depth alone made 16 m squares of every creek.
  - test-water, navmesh and lighting export checks pass. check-lake-preview was already failing.

### Round 7b (2026-09-15) — after Dante's re-bake

- **⚠ The point-sampled height pyramid was wrong** (round 7 above). It is exact at every coarse
  texel and ALIASES everything between: on the steep island the rms laplacian went 0.26 m at
  lod 0 to 1.92 m at lod 1 (box 1.26), and the mountain rendered as a crosshatch of spikes.
  - `mipGenerator.heightmapEdgeQuadrant` is now a **[1 4 6 4 1]² binomial centred on the
    coincident child texel**: aligned (a symmetric kernel reproduces a plane exactly) and a
    proper half-band low pass. Roughness 0.72 at lod 1, relief kept (97.7 m of 99.7 m).
  - Near a tile edge the kernel shrinks symmetrically (clamping bent the surface by 0.45 m);
    on the edge itself it reads only the shared row, so neighbours agree bit for bit.
  - `heightPyramid` 4 → **5**, so the next bake rebuilds every coarse tile again.
  - `check-disk-pyramid` gains the checkerboard low-pass check (point sampling fails it).
- **The re-bake fixed the big data mismatch.** Flowing texels vs terrain: was p90 32 m, now
  p90 0.50 m / p99 3.7 m. The steep island is 1007 texels within ±8 m rather than 1931 at 38 m.
- **Creeks floating over their own bank** (Dante's shot at 1793, 2513): the transect shows the
  creek's level 0.3–0.5 m above the ground on BOTH banks, dry. a-land stamps wet only inside the
  hydraulic width, and the bank lip could be raised by at most `carveMaxFillM` 1 m, which cannot
  hold a channel that crosses a slope. Measured: 17% of dry cells beside flowing water sit under
  its level, p90 1.2 m, p99 4.1 m. **New `carveMaxBankFillM` = 3 m** (its own cap, matching
  carveMaxCutM); `check-carve`'s fill bound now tests it.
- **Creek caustics are back ON** (`ocean-grid.js` no longer forces `$caustics_enabled` false for
  the flowing variant). Round 6 blamed "the projector", but that is the SpotLight that lights the
  terrain; this flag is the in-shader seabed caustic, which is world-space and works on a creek
  bed. The clipmap's `1 − w` caustic fade from round 7 is removed with it. 18 samplers, 60 fps.

### Round 7c (2026-09-15) — after the second re-bake

**The second bake landed the pyramid and the bank cap.** Water vs terrain, from the audit:
still p99 0.03 m, flowing p99 3.7 m → **0.76 m**; dry-beside-still floating 7.2% → **1.0%**.

- **⚠ The point-sampled pyramid was replaced** (see round 7b) — the mountain's crosshatch was
  that. `mipGenerator.heightmapEdgeQuadrant` is now a [1 4 6 4 1]² binomial centred on the
  coincident child texel, with the kernel shrinking symmetrically near a tile edge (clamping
  bent a plane by 0.45 m) and collapsing to the shared row on the edge itself.
  **`heightPyramid` 4 → 5: the next bake rebuilds every coarse tile again.**
- **Creeks still stood proud of their bank** (1793, 2513): the transect shows the surface
  0.3–0.5 m over the ground on both banks, dry. a-land stamps wet only across the hydraulic
  width, so ground just outside it that lies under the water line stays dry.
  - **Tried and reverted in a-land:** flooding that fringe to the waterline. As a per-cell disc
    stamp it does not work — per-cell levels walk the floating edge one cell outward (122 cells
    left of 124), and a flat centreline level in the fringe brings back the steeper-reads-DEEPER
    inversion `check-rivers` guards (2.73 m on a steep reach). The finding is written into
    WaterSolve where the stamp is. A real fix is a fill over the reach, not a disc.
  - **Kept instead:** `carveMaxBankFillM` = 3 m (round 7b), and in a-water **the creek surface
    now tapers to its bed over the last 1.5 m of shore distance** (water-vertex.glsl), so the
    sheet ends on the ground the way shallow water does instead of in the air. The flowing
    below-level discard moved to `level − 4 m` to leave room for it.
- **"That weird bubble thing" (2307, 2129): the sun's specular lobe on near-mirror water.**
  Found with debug 22 after ruling out spray, foam (both the map and its sources), the planar
  reflection and the sky's sun. Measured at the blob: rms ripple slope **0.027**, against the
  0.05–0.2 real river surfaces measure — a-land's energy is low there and the speed gate nearly
  closed on top of it, and a near-mirror holds the lobe together.
  - `FLOW_RIPPLE_SLOPE_MIN` = 0.05 floors the ripple slope wherever the flowing sheet draws.
  - ⚠ **A live uniform edit from the console does not stick** — the per-frame stream rewrites
    `specBoost`, `reflectionScale` and the rest every frame. A/B those in a scratch shader.
  - ⚠ **`readRenderTargetPixels` on the FlowFoamPass targets reads all zeros** even when the
    pass is plainly writing (the material samples the same texture fine, and debug 63/64 show
    its foam and current). Do not diagnose that pass by readback; look through the material.

### Round 9 (2026-09-18) — "water floating in the air": the solve, not the renderer

Audit harness (scratch, not committed): the island-sholes export mosaicked back to a 4096² grid,
WaterSolve run on it in Node (676 river cells, 15 bodies, 13 falls: matches the editor), and
three metrics. **Edge overhang** = water depth standing past a dry creek-side cell, min(depth,
level − dry ground); **sideways** = the surface's downhill more than 45° off the current;
**pond steps**.

**a-faraway-land (uncommitted):**
- **WaterSolve stages 5b–5e** replace the per-disc `min(bed here, bed at centre) + depth` stamp,
  which DRAPED the low bank (a surface sloping across the flow; a-water's c16b41e then turned the
  current sideways: "water coming out of the sides").
  - 5b: the surface over the channel discs is the harmonic extension of the centreline (centres
    pinned at bed + Manning depth, 24 Jacobi sweeps). It is flat across the channel, continuous
    along it, and blends round D8 bends and confluences. Nearest-centre levels stepped at every
    Voronoi seam: 73% of the >15 cm overhangs.
  - 5c: an auto-pond a creek runs through stands at its outlet's surface (at most +1 m, and no
    higher than a rim that drains away). wtr-10's spring pond: outflow step 0.33 → 0.15 m.
  - 5d: dry hollows beside creeks or raised ponds fill when they close (≤ 400 cells). Anything
    that would float is unfilled again, so the edge never walks outward. User lakes and the
    ocean are never a source.
  - 5e: edges nothing contains come down to the ground at 10% (a Dijkstra from uncontained dry
    ground outside every disc).
- **Tried and dropped:** HAND (drain-into-channel) wetness. On planar slopes the D8 paths run
  parallel to the channel, so it dried half the creeks (overhang 65%).
- **Editor preview:** river ring verts sit on their own ground (no wet-level sheet over lower banks).
- **terrain.vert:** material displacement fades under flowing water plus a 3 m bank band
  (`ALand.runtime.TerrainMaterial.waterDispFlattenBandM`, 0 = off). Its GLSL is already
  regenerated into shaders.js.

| island-sholes | before | after |
|---|---|---|
| edge overhang > 5 cm | 22.9% | **4.2%** |
| edge overhang > 15 cm | 6.7% | **0.8%** |
| overhang p99 | 0.23 m | 0.14 m |
| sideways > 45° / > 60° | 34% / 20% | **20% / 10%** |
| creek depth p50 | 0.24 m | 0.18 m |

The remaining sideways cells are mostly 5e's edge ramps (a spill edge slopes by design). Pond
junction p90 is 0.80 m (was 0.73). That metric also counts creeks cascading INTO ponds over a
lip, which is a legitimate step. Tests: test-water 106 ok (check-lake-preview's PaintRaster crash
predates this), navmesh 35, compile 158. Solve time unchanged (~7–10 s per pass at 4096²).

### Round 10 (2026-09-18) — browser verdict on round 9, and the pivot

**Dante's shots:** z-fighting everywhere, the 15 m lake broken into chunks, ponds that float,
water blobs scattered down the steep island, sheets on the falls.

- **Regression, now fixed:** round 9's edge ramp floored water at 2 cm. The export had **47% of
  creek cells < 2 cm deep** (median 0.04 m; it was 0.2% / 0.22 m). A film that thin is coincident
  with the terrain (z-fighting), and the ground rises through it in holes (the "chunks").
  `edgeMinDepthM` is now 0.15. Harness on the new terrain: < 5 cm 36% → 5.5%, overhang
  > 15 cm 4.8% (original code 7.7%). Lesson: audit the depth distribution, not only the overhang.
  "Meets the ground" and "coincident with the ground" are the same thing to a depth buffer.
- **The real diagnosis:** island-sholes' creeks are 5–20 cm deep, against a 1 m grid, terrain
  displacement of ±0.4 m, and 0.4 m per cell on the steep island. Water thinner than the
  terrain's own detail cannot look right as a heightfield surface. That is not an SPH/LBM
  problem; it is below what this representation can hold. Games draw it as wet terrain.
- **Where Dante was aiming:** Jean-Philippe Grenier's river editor
  (https://80.lv/articles/river-editor-water-simulation-in-real-time):
  - a LATTICE BOLTZMANN shallow-water solve (D2Q9, 512×1024 on the GPU, fp16, ping-pong);
  - rendering by wave profile buffers + wave particles;
  - foam and two UV sets advected by the velocity field;
  - thickness-dependent volumetric scattering, so thin water goes transparent.
  Phase 4 already built most of the rendering half: WPB (step 4), two-phase advection + foam
  accumulation (steps 1–3). What was missing is the SIMULATION half. a-land's D8 stamp
  approximates it, and every round of today was patching that approximation.

### NEXT (decided with Dante 2026-09-18): the LBM shallow-water river solver, on new branches

- **Architecture:**
  - Long term, the solver lives in a-water and reads a-land.
  - FIRST it runs as an a-land editor bake (option "a"): run the LBM to a steady state and
    export the SAME waterLevel/waterFlow/waterClass tiles, so the tile contract and a-water are
    unchanged.
  - Write the GPU passes so the same shader code can later run live in a-water as a
    camera-following window. Cascade 0 is already 512² at 1 m, which matches Grenier's domain.
- **What a-land keeps:** the D8 solve for the whole-world questions: where rivers go, their
  discharge, lake intents and bodies, carve. It supplies the LBM with the bed (carved terrain),
  the inflows (sources, lake pour outlets, with their Q), the outflows (sea and map edge) and an
  initial state, so the LBM converges in seconds rather than filling from dry.
- **What the LBM fixes by construction:** continuous surfaces, ponds finding their own
  shorelines, splits at saddles (the 15 m lake's beach outlet that "gives up"), wetting and
  drying, eddies behind obstacles.
- **Phase 4 closes first**, on the current branch:
  - a thickness-based alpha fade in the flowing material (Grenier's volumetric term): water
    below ~10 cm fades out, which kills the remaining z-fighting;
  - step 5, the fall spray placeholder, plus docs.
  - Acceptance: a hero creek (gentle 1–3% valley, carved, ≥ 0.3 m deep) reads as water in its
    bed; thin water is never drawn as a surface; queryFlow works. island-sholes is the stress
    test, not the proof.
- **Phase 5 (centreline ribbons) is likely superseded:** Grenier renders the simulated grid
  directly. Re-plan it once the LBM runs.
- **Branches:** do NOT `git switch` in a-faraway-land. Another session's uncommitted work lives
  in that tree, and a branch switch would carry it along, then land its next commit on the
  wrong branch. Use a worktree, **with its start point named**.
  - **The LBM warm-starts from the D8 state, so it must branch from the improved D8.** That
    lives only on a-faraway-land's local `water-carve-channels`: 10b9d46 pyramid, cb7f963
    WaterSolve 5b–5e with `edgeMinDepthM` 0.15, and bfb9de5 displacement flatten. It is not
    merged into `multi-water-types` and not pushed. Checked 2026-09-18: the tree's
    uncommitted diffs are all the other session's (noise, TileCache, TerrainCompositor,
    bake-seam parts of layer-bridge.js/save.js); none are D8.
  - Before creating the worktree:
    1. Re-check for newer D8 edits of ours.
    2. Commit them to `water-carve-channels`, staging only our hunks.
    3. Then run `git worktree add ../a-faraway-land-lbm -b lbm-river-solver water-carve-channels`.
    A bare `-b` takes whatever HEAD happens to be.
  - For a-water, if its tree is shared at the time:
    `git worktree add ../a-water-lbm -b lbm-river-solver phase-4-flowing-water`.
- **Harness to reuse:** the scratch solve.js / audit.py / overhang.py flow. Export mosaic →
  4096² grid → Node solve → metrics (depth distribution, overhang, sideways). Rebuild it in the
  new worktree's tests/ if it is worth keeping.
- **Later, not now:** LBM on shores with waves (the Phase 3 nine-stage path stays).
- **Test world: `a-faraway-project/hero-creek`, GENERATED 2026-09-18.** It is not sculpted:
  `hero-creek/survey/make_terrain.py` holds every number, and `survey/README.md` has the
  steps, the source console lines, and a feature table.
  - A 1 km island. The creek valley's floor runs 14 m → sea, ~1.5% then ~1.3%.
  - Features: a meander, a tributary confluence, two boulders in the channel, a pond with
    TWO outlets cresting at exactly 8.664 m (a side channel rejoins downstream), a 3 m
    waterfall with a plunge pool, and the coast.
  - Carving is off (`carveChannels: false`). Sea level 0, 1 m solve grid.
  - How it was built:
    - Scaffolded with a-land's own `new-world.py`; only the height tiles are replaced.
    - Coarse LODs come from a numpy port of `heightmapEdgeQuadrant`, parity-tested
      against the JS to 0.007 mm.
    - Opened headless in the editor, with writes blocked: heights match on flat ground.
  - Offline D8 solve (water-carve-channels WaterSolve, sources 55% / 40%):
    - main channel centre 0.49–0.56 m deep, median flowing depth 0.33 m;
    - the pond fills to its sill; the 3.0 m fall is detected;
    - D8 routes the whole pond outflow down ONE outlet, which is the LBM's split test.
  - a-water page: `examples/demos/hero-creek-ocean.html` (gitignored like the others).
    Loads headless at 60 fps, terrain only until the editor's Solve + Bake & Export.
  - Lessons from building it:
    - Key a valley floor to z, never to arc length: the nearest point on a meander
      jumps between loops, and the floor stepped with it.
    - A tributary must join heading downstream.
    - A side outlet must leave its pond radially; one set at an angle ran along the rim
      and crested 0.6 m high.
    - The solve only counts a waterfall if one 1 m cell drops ≥ 0.5 m at > 30° and the
      whole run is ≥ 2 m.

- **LBM acceptance baseline: D8 on hero-creek** (first bake, 2026-09-18, sources 55% / 40%).
  - Graded by `hero-creek/survey/baseline.py`; rerun it on the LBM's export.
  - Dante's browser shots of this export show every D8 artifact below.

  | metric | D8 | the LBM should give |
  |---|---|---|
  | boulder mound: max level over the creek upstream | **1.14 m** | a few cm of pile-up, water going round |
  | side outlet: level in its first 11 m over the pond | **+0.45 m** | ≤ 0 (the surface drops over a sill) |
  | main outlet: dry metres in its first 60 m | **45** | 0 |
  | pond outflow split main / side | **0 / 100 %** | both carry flow (equal sills) |
  | depth p10 / p50 / p90 | 0.07 / 0.31 / 0.54 m | |
  | depth < 5 cm / < 10 cm | 7.0 / 16.3 % | |
  | overhang > 15 cm, max | 0.28 %, 0.63 m (at the side outlet) | |
  | sideways > 45° / > 60° | 7.9 / 5.4 % | |
  | waterfalls | one, 3 m, 22.7 m³/s | same |

  - Why each happens:
    - The boulder mound: the harmonic surface (5b) pins a channel-line cell on the boulder
      at its bed + depth.
    - The outlet climb: the same pin at the sill, and 5c cannot raise the pond because the
      other outlet drains at exactly that height.
    - The one-sided split: D8 is single-direction.
  - Do not patch these in D8 (the pivot decision). They are the LBM's first acceptance test.

### Round 11 (2026-09-18) — Phase 4 closed: thin water fades, fall placeholder, docs

Commits 1d13687 (fade) and 1d92371 (falls). Headless on the 4090 / ANGLE GL:
- no shader errors;
- sampler counts unchanged (max 31);
- 58–60 fps.

- **Thin water is not a surface.** The flowing sheet measures its RENDERED thickness:
  surface Y minus the refraction G-buffer ground under the same pixel.
  - It is measured undistorted, from the 32-bit depth texture. The half-float linear depth
    steps by 3 cm at 50 m.
  - Alpha fades from 1 at 10 cm to 0 at 3 cm, and below 3 cm the fragment is discarded, so
    it writes no depth.
  - Debug mode 66: grey = thickness, yellow = fade band, red = dropped, blue = no ground.
  - Rendered thickness rather than a-land's depth, because the depth buffer sees the
    rendered thickness (the bank taper and residual terrain displacement included).
- **⚠ The current island-sholes export is the round-10 film export.** Water tiles 15:40, while
  the `edgeMinDepthM` fix cb7f963 is 16:51.
  - Measured in cascade 0 at wtr-6: 34% of flowing texels < 3 cm and 44% < 10 cm, in the
    solve data itself. BANK_TAPER only moves < 3 cm to 38%.
  - So much of wtr-6 now draws as bed, which is right for 1–3 cm films, until a re-bake
    with cb7f963. Judge the fade after that re-bake, or on the hero-creek world.
- **Falls (a PLACEHOLDER until Phase 6):**
  - `OceanSplash._emitFalls` sprays at each `waterfalls[].bottom` from FlowFoamPass's
    nearest-first list, now kept as `nearFalls`. The water arrives at Torricelli speed along
    the fall, and emitImpact bounces it off the pool. Rate knob `fallSprayRate` 0.3 per m³/s
    (FUDGE); plus `fallSprayEnabled` and `fallSprayMinDrop`.
  - Measured at wtr-8's falls: 13 falls in range, and the spray adds ~4k live particles
    (pool 24k).
  - On the sheet, `flowFallSheet` (|∇level| from tan 30° to 45°) gives full foam and a slope
    variance floor of 0.2, not gated on speed or the foam window.
- **Docs:**
  - WATER-TYPES.md: the River Editor table's LBM row (was "Not needed at runtime") now points
    here; "Deferred" now defers only the runtime LBM.
  - Phase 4 "As built", a note that Phase 5 is likely superseded, the Phase 6 placeholder,
    and decision 2 amended.
  - The local DEBUG_MODES.md (gitignored) documents modes 63–66.

### Round 12 (2026-09-18) — hero-creek browser round 1

Dante's first look at hero-creek produced six shots.

**Image 2 (boulder mound), image 4 (lake exit climbing a ridge), image 5 (dead second
outlet).** Measured on the export: these are D8 artifacts. They are logged above as the
LBM's acceptance baseline, and D8 is not to be patched for them.

**Image 6: fall foam was ocean foam.** a646d00. FlowFoamPass decay now depends on
density:
- Dense whitewater collapses with a 1 s time constant. Fresh-water bubbles coalesce and
  burst fast; salt inhibits coalescence, which is why sea foam lingers.
- The sparse residue keeps 6 s, so streaks still ride the current.
- A fall's source is a band along its foot: the fall's width, 0.8 × drop metres
  downstream, 1–5 m.
- Before: a saturated disc 19 m across that reached back over the lip.

**Images 3 and 4: dark metre-wide caustic blobs with rainbow rims.** 604e1a5, flowing
variant only. **Needs create-shader.py.**
- The tile is 0.5 m, so cells are about 10 cm, the size of creek ripples.
- Contrast rises over the first 0.25 m of depth: rays need depth to focus. The old fade
  put the strongest pattern at the waterline.
- The R/B split is 0.6 mm per metre of depth, not a fixed 1.7 cm.
- The ocean probably shares the waterline-contrast issue. Not touched.

**Image 3: the lake inlet.** This is my terrain: the pond is a smooth bowl. A fanning
inlet needs momentum (LBM) or a delta (sediment, out of scope).

**Image 7: hard to read the ground.**
- The plain page's sun is lowered from about 70° to 33° elevation: relief shows.
- `hero-creek-sky.html` (new, gitignored) adds a-starry-sky, with ACES tone mapping as
  in a-land's hello-world. Headless, it misbehaves:
  - atmosphere ON: the near terrain is not drawn (3/3 runs);
  - atmosphere OFF: the water is not drawn (2/2 runs);
  - no shader errors.
  - Needs a browser check. Every other a-land ocean page leaves the sky out, so the
    a-land + a-starry-sky + ocean seam may never have been exercised.
- For you in the editor: the default Dirt layer (height mask 0–0.35 of the −20…180 m
  envelope, i.e. below 50 m) covers the whole island. Max ≈ 0.115 (below 3 m), feather
  ≈ 0.02 lets Grass show.

### Round 13 (2026-09-18) — hero-creek browser round 2

**hero-creek-sky.html works in a real browser.** The headless failures (near terrain or water
missing) were the harness.

**Pond vs creek caustics clashed (image 9).** e18b516: one depth-driven model for every body.
- Cell ≈ 0.16 × depth: the ripples that focus at depth h have curvature ~4/h, so at slope 0.1
  their wavelength is ~0.16 h.
- Two fixed octave scales are blended, never world position × a varying scale (that warps).
- The focus ramp (0.25 m) and depth-scaled dispersion now apply to every body.
- Deeper than ~5 m it is exactly the old 0.3 UV ocean tile.
- 12 caustic taps, was 6.
- **Needs create-shader.py.**

**Underwater in the sea blows out, and there are no underwater caustics (images 8, 9).
Sky page only.** Measured:
- Present with a-land + a-starry-sky + sea only. The pond on the same page is fine, as are
  the sea on the sky-less page and islands.html.
- It is not the ACES tone mapping I added: without it, it is worse.
- Debug 50 (the raw underwater mirror sample) is white on the sky page and dark on
  islands.html.
- Mirror-target pixels (half-float, read with the PBO unbound): 171–298 on the sky page,
  0.06 on the sky-less page.
- renderer.toneMappingExposure is **1.8e-5** on the sky page (a-land's SkyPhotometry
  auto-exposure) and 1 elsewhere. a-land's sun is ~124,000 lux (`u_sunLuxRGB`).
- Cause:
  - With a sky present, a-land lights its terrain in lux and relies on the screen's
    exposure to scale it back.
  - The ocean works in a-starry-sky units behind its own fixed ACES (it ignores renderer
    exposure). a-land's SkyEnvironment.js:245-256 documents exactly why a-land does not
    touch the shared lights.
  - Offscreen captures never get the screen exposure. So a-land terrain enters the ocean's
    underwater mirror ~30,000× too bright, and a-water's own contributions that land on
    a-land terrain on screen are crushed ×1.8e-5: the caustic SpotLight, and the underwater
    fog colour via the fog-chunk seam. The last two are inferred, not measured: the
    sky-less pond shows underwater light shafts, the sky pond none.
- **Options (decision for Dante: the a-land ↔ a-water lighting contract):**
  - A. a-water converts at the seam: its captures of foreign-lit content ×exposure, and its
    own light injected into foreign materials ÷exposure. Consumer-side, local.
  - B. a-water adopts the physical exposure throughout. Consistent, but touches every scene's
    look.
  - C. a-land publishes an offscreen/sibling rendering mode or conversion.
- **PARKED by Dante.** He expected a-land not to be physically based. It is, since a-land
  18c7c3e (2026-08-25, "Meter the world in lux…", on main and multi-water-types):
  - `land-terrain._applyPhotometry` drives the exposure every tick, with no setting;
  - it skips only while no sun altitude is known, so any page with a-land + a-starry-sky
    gets it.
  - No earlier ocean page combined a-land with the sky, which is why nobody saw it.

**Waterfall (images 10–11).** Dante: the LBM will not do the fall itself; a small PIC/SPH
should connect the two. Agreed, and written into WATER-TYPES.md § Phase 6: the lip is an LBM
sink seeding particles, the pool is an LBM source receiving them.

### Round 14 (2026-09-19) — the lighting seam was never about physical lighting

**Dante's observation is what cracked it:** island-sholes (a-land + a-water, no sky) renders
underwater *beautifully* — caustics, seabed, depth falloff — and peaceful-island (a-land + sky,
no water) is fine too. Only the triple dies. A units philosophy argument cannot explain that
shape; a switch can.

**The switch is one `if` in three r173.** `WebGLRenderer.js:16147`, and the same test in
`WebGLPrograms.js:6906`:

```js
let toneMapping = NoToneMapping;
if ( material.toneMapped ) {
  if ( _currentRenderTarget === null || _currentRenderTarget.isXRRenderTarget === true ) {
    toneMapping = _this.toneMapping;
  }
}
```

Tone mapping — and therefore `toneMappingExposure` — is applied **only when the draw target is
the canvas.** Inside any render target `TONE_MAPPING` is undefined, so a-land's terrain, which
opts in by hand at `terrain.frag`'s `#ifdef TONE_MAPPING`, compiles that line out entirely and
emits raw lux.

| Scene | `_applyPhotometry` | Exposure | Why it looked the way it did |
| --- | --- | --- | --- |
| island-sholes (land + water) | bails at `alt === null` | 1 | terrain never goes to lux — consistent |
| peaceful-island (land + sky) | runs | 1.8e-5 | screen only, no offscreen consumer |
| hero-creek-sky (all three) | runs | 1.8e-5 | our RTs get lux with no exposure → ~30,000× |

The sky never broke the water. The sky is the only thing that makes a-land's sun altitude
non-null, which flips it into lux — and lux is silently right on screen and silently wrong in
everyone else's render target. So this was an a-land-internal consistency bug that we were
merely the first library to trip, not the physically-based-lighting question, which stays
deferred and untouched.

**Fixed, both directions:**

- **Outbound** (a-land → our captures) — a-faraway-land `27c96a5`. `u_offscreenTone` carries
  (exposure, mode), written per draw from `material.onBeforeRender`, which three calls with the
  target already bound and before any uniform upload. The shader keeps three's path under
  `#ifdef TONE_MAPPING` and runs a transcribed copy of their curve in a new `#else`, so
  on-screen rendering is byte-for-byte unchanged. Mode 0 stands down, covering both the canvas
  and any capture made under `NoToneMapping` — which is what `PMREMGenerator` forces while
  grabbing an environment, so a captured dome is still never graded twice.
  `tests/test-lighting/offscreen-tone.test.js`, 17 checks, registered in that suite's `run.sh`.
  **Needs `create-shader.py` in a-faraway-land** — `check-shader-regen` fails loudly until then,
  by design.
- **Inbound** (our light → a-land's screen shaders) — a-water `edb3c5d`. The caustic SpotLight
  is a real light in three's list carrying an intensity tuned against exposure 1, so it arrived
  ~55,000× under and the seabed caustics were absent. Now divided by the renderer's exposure;
  no-op at exposure 1. Safe only because the ocean material never samples `spotLights[]` — noted
  in the comment for whoever changes that. JS only, **no regen needed.**

**Round 13 got one thing wrong, and it is worth correcting rather than quietly dropping:** it
listed the underwater fog colour as crushed alongside the SpotLight, flagged as *inferred, not
measured*. It is not crushed. a-land runs the sibling-ocean fog block **after** its tone map and
after `linearToOutputTexel` (`terrain.frag:2114`), so that colour was always display-referred.
No fix was needed and none was made.

**Round 13's option A was also the wrong shape** and should not be revived: scaling the mirror
sample on our side cannot work, because that buffer is *mixed units* — a-land terrain in lux,
our own foam and splash in sky units, the sky dome already graded with `toneMapped:false`. One
scale fixes a third of it and wrecks the rest. The library that moved the exposure owns the
consequence.

**Still to verify in a browser:** `hero-creek-sky.html` underwater — debug 50 (the raw mirror
sample) should no longer be white, and the pond should show light shafts the way the sky-less
page does. `ALand.runtime.TerrainMaterial.offscreenTone()` reports what the last draw resolved,
so a capture that still looks wrong can say whether the hook fired at all.

### Round 15 (2026-09-19, evening) — the round-14 fix is correct and is NOT the cause

Measured in Dante's browser, underwater in hero-creek-sky, by wrapping
`TerrainMaterial.resolveOffscreenTone`: **117,183 terrain draws, every one mode 0**
(`getRenderTarget() === null`), at exposure 1.80e-5. a-land's terrain never enters an a-water
render target underwater, so round 14's fix cannot be what is blowing the surface out. Above
water it does fire (2 of 6 draws headless), so the fix is real and stays — it is just not this.

**Round 13's headline measurement does not survive.** "Mirror 171-298 with a sky, 0.06 without"
was never evidence of unexposed lux, because the terrain is not in that buffer.
`foreign-terrain-twin.js` explains why: a-land's patches cannot be captured with their own
material at all (their geometry lives in their vertex shader), so our G-buffer and ortho passes
render a twin with OUR fragment stage. Two different scenes were being compared.

**Ruled out, in order:**
- *a-land rewriting the shared sun.* Measured `sunIntensity: 1`, `sunColor: ffffff`. It does not
  — `_applySun` writes a-land's own `_sunEl`, and it keeps its lux inside its own shaders on
  purpose (`land-terrain.js:897`).
- *The round-14 caustic compensation.* `foreignExposureCompensation=()=>1` changed nothing.

**Confirmed: it IS the exposure seam.** With the lux stood down on both families and the
exposure back at 1 (`setSunLux(null)` on TerrainMaterial and ObjectMaterial,
`_applyPhotometry` stubbed, exposure 1) the underwater view reads correctly. So some material
family carries it — and terrain is now excluded. **Next suspect: a-land's OBJECT materials.**
`ObjectMaterial.applyPhotometry` puts lux into ordinary `MeshStandardMaterial`s, which are
`toneMapped: true` and hit the identical three.js render-target rule. That family was never
probed — the probe keyed on `u_sunLuxRGB`, which is terrain only; objects use the `_bus`.

**Found by Dante's instinct, unrelated and real:** `_anchorForeignSun` sets
**`light.castShadow = false`** on a-starry-sky's directional light (`land-terrain.js:587`) and
re-targets it to a world-origin anchor. Confirmed live (`sunCastShadow: false`,
`alandAnchored: true`). a-land does this because it shadows from its horizon bake and
TerrainSunCSM. We read that light's shadow in three water-shader paths (surface, seabed,
terrain refraction), so on any sky+land page that map is gone and the gate fails silently.
Cheaper to fix than the seam, and independent of it.

### New bisect page: `examples/demos/island-sholes-sky.html` (2026-09-19)

Dante's idea, and the right one: island-sholes is the known-good a-land + a-water world, so
bolting a-starry-sky onto a copy of it asks whether the failure needs ALL THREE LIBRARIES or
needs hero-creek specifically (generated terrain, sparse materials, baked water bodies).

- Blows out like hero-creek → the three-way combination is sufficient; hero-creek's content is
  irrelevant.
- Still looks like island-sholes → the combination is not sufficient and something about
  hero-creek is the trigger; Dante's materials hypothesis moves to the front.

**Three things move with the sky and none is optional** (documented in the page header):
a-starry-sky itself, `toneMapping: ACESFilmic` (without it a-land's lux terrain is pure white),
and `ocean-atmosphere-enabled: true`.

> ⚠ **A REAL a-water BUG, found building that page: AP-off + a-starry-sky fails to LINK.**
> island-sholes runs `ocean-atmosphere-enabled false`. With AP off the water shader includes the
> underwater fog chunk AND carries its own `MyAESFilmicToneMapping`, so with a-starry-sky also
> declaring it there are two bodies in one translation unit: *"function already has a body"*, and
> the whole water material fails to compile. `underwater-fog-chunk.js:138-145` predicts exactly
> this but assumes "the two scaffolds are never both installed" — which does not hold for
> AP-off + sky. The `#ifndef ARO_AES_TONEMAP` guard there does not cover a-starry-sky's own
> declaration. Worked around in the page by pairing AP with the sky; **not fixed in the library.**

Validated headless: loads clean, 42 terrain patch materials, exposure 1.80e-5, sun lux 123,865.
Judge it in a real browser — headless loses hero-creek's terrain and is unreliable for looks.

### Round 16 (2026-09-19, late) — SOLVED. Three bugs, stacked

Dante's verdict: fixed. The underwater ceiling no longer glows.

**It was never one bug.** Each one masked the next, which is why every clean theory kept
dying:

1. **The water material was not linking at all underwater.** `water-shader.glsl` declared
   `MyAESFilmicToneMapping` and also includes whichever `fog_fragment` chunk is live; with a
   sibling sky that chunk is a-starry-sky's, which declares the same function unguarded. Two
   bodies, one translation unit, no program — and it bites the moment `scene.fog` turns on,
   i.e. on diving. The `#ifndef ARO_AES_TONEMAP` guard never covered it: that define is OURS
   and a-starry-sky has never heard of it, so it only ever protected us from our own second
   declaration. Fixed by renaming our copy private (`aroAESFilmicToneMapping`, a-water
   `dff89eb`). **Dante found this in the console**; it had been sitting in plain sight since
   the island-sholes-sky page was built, written up as a footnote instead of the headline.
   ⚠ `UnderwaterFogChunk` keeps the shared name on purpose — its `fragGLSL` is injected into
   whichever chunk is live and calls the operator by name, so renaming it there would leave
   every sky page linking against an undeclared function.
2. **The round-14 fix was right and never fired.** `resolveOffscreenTone` gated on
   `getRenderTarget() === null`, which was redundant — `#ifdef TONE_MAPPING` is three's own
   screen-vs-target answer, so the shader already knows — and it answered mode 0 on every
   draw. Gate removed (a-land `c75b624`).
3. **And the real reason it still stood down: a-water captures LINEAR.**
   `reflection-pass.js:293, :439` set `renderer.toneMapping = NoToneMapping` around the mirror
   and Snell-window targets, because a-water applies its own ACES when it samples them. The
   rule `NoToneMapping -> stand down` conflated *nobody is metering* with *someone is
   capturing linear and will grade it later*. The second still needs the exposure paid, just
   not the curve. **Mode 3** — exposure, no curve, unclamped — a-land `60d75d7`. Unclamped
   because the consumer is about to tone-map it.

**Separately real, and it shipped:** a-water now reads the sibling's metered sun and sky
(`lux x exposure`) instead of the raw light object, which a-land had quietly stopped using
(`8f51a52`). Metered sun `[2.23, 1.84, 1.50]` against the `[3.0, 2.71, 2.28]` hand-tuned for
island-sholes. Fixed the dark shore foam and the above-water darkening. No-op at exposure 1,
so no sky-less page moves.

**What actually broke the deadlock was bisection, not reasoning.** island-sholes-sky.html
(known-good world + sky, one variable) proved the three-way combination was sufficient and
hero-creek's content irrelevant. island-sholes-sky-night.html proved it was scale-driven. And
`aroForceOffscreenTone(true)` in `examples/demos/probe.js` was the only test that compared
BEHAVIOUR DURING THE DRAW rather than state sampled around it — every console and headless
reading was taken outside the capture passes, where `toneMapping` is ACES, and so never
observed the one moment that mattered.

> **Method note worth keeping.** Long stretches of this were spent reasoning from measurements
> taken with a broken instrument: the hook's own `mode0` report was used as evidence that the
> hook was fine. Prefer an A/B that changes behaviour (force it and look) over a probe that
> reports state.

**Tools left behind:**
- `examples/demos/probe.js` — load with `fetch('./probe.js?'+Date.now()).then(r=>r.text()).then(eval)`.
  Reports whether our materials have compiled programs, whether a regen landed, what fills the
  mirror/Snell buffers by owner, the hook's mode counts, and `aroForceOffscreenTone(on)`.
- `examples/demos/island-sholes-sky.html` and its `-night` twin — the bisect pair.

**Residual, accepted by Dante:** horizon darkness does not quite match at infinity. The ocean
fades back and forth there anyway.

**Still open, both independent of all of the above:**
- **a-land sets `castShadow = false` on the shared sun** (`land-terrain.js:587`), silently
  disabling our three scene-sun-shadow paths on any sky+land page. Found via Dante's hunch.
- **`ocean-atmosphere-enabled false` + a-starry-sky fails to link** — same collision class as
  bug 1, different symbols (`fogLinearTosRGB`, `fogsRGBToLinear`, `sRGBToLinear`, all shared
  with a-starry-sky by design). Only collides when both fog scaffolds install. Worked around
  in the bisect page by pairing AP with the sky; not fixed in the library.

### Round 17 (2026-09-19, late) — caustics swimming across the seabed (a-water `9f2866b`)

Underwater caustics drifted smoothly, then stopped, jittered and continued on a ~3 s cycle.
Measured, not guessed — and none of the obvious suspects:

- **Not frame stalls.** 209 frames in 10 s, worst only 1.6x the median, zero hitches.
- **Not the sun, the camera or the projector XZ.** 12 s standing still: zero movement in any.
- **One input moved:** `uSurfaceY`, 79 steps of up to 0.22 m.

That is `probeWaterSurfaceY()`, the wave-displaced surface at the camera, and the projector pose
was riding it. **At the surface that is harmless** — `uSurfaceY` moves with the projector so
`(uSurfaceY - ro.y)` is constant and the pattern stays anchored where the cone pierces the
surface. I read that as innocent, and it is, *at the surface*. **The seabed does not bob.**
Translate the projector up by d and every cookie ray goes with it, so its intersection with the
static bed slides sideways by `d * (rd.xz / rd.y)` — metres of lateral swim per wave, at the
swell period. 3 seconds is a wave period.

Fixed: the pose rides `grid.waterLevelAt()`, the still level, and `uSurfaceY` takes the same
value (they must agree or the surface anchoring breaks). Also the more honest anchor — `refr` is
Snell through a flat +Y plane, so this projector already approximates a MEAN surface, and the
real wave shape is carried by the pattern's own animation. Letting the pose bob double-counted it.
JS only, no regen.

> The same method note as round 16 applies, and it worked the second time: every hypothesis I
> formed by reading the code was wrong (frame stall, then sun-direction stepping via the 400 m
> lever, then "uSurfaceY cancels so it is innocent"). The per-frame recording named it in one run.

**Known and deliberately not chased:** ~21 fps on island-sholes-sky (median 47 ms) — even, no
hitches, so it did not cause this. Lead for a future session is in
`project_perf_over_time_2026_05_30` (a-starry-sky program churn bleeding into our offscreen
passes). Also latent, not hit: the caustic slide scrolls `uv + 0.8 * uTime/8` unbounded, so on a
page left running for many hours the increments fall below float32 resolution and the pattern
starts stepping. Hours, not seconds. Fix if it ever shows: wrap the scroll to the texture period.

### ▶ RESUME HERE (end of 2026-09-19)

**Milestones 1-3 are done.** The finite-volume solver has a CPU reference (the specification), a
GPU stepper that matches it, and an editor pass that runs inside a-land's Solve Water behind
`settings.water.params.lbm`. hero-creek is verified end to end from the SHIPPED tiles
(`survey/baseline.py`): pond 9.13 m over its 8.66 sill, outflow split **82/18** where D8 gives
0/100, main outlet 0 dry metres of 60, converged, no flood.

- **Solver work:** `../a-faraway-land-lbm`, branch `lbm-river-solver`. Design and all results in
  its `WATER-LBM.md`. Tests: `tests/test-water-lbm/run.sh` (40 checks, ~3 min; the GPU ones skip
  without a Chrome).
- **To run the editor with it:** dev server from `../a-faraway-land-lbm/editor` (`npm run dev`;
  the worktree has its own node_modules), then `ALandEditor.setShallowWater(true)` per project.
- **Test worlds:** `a-faraway-project/hero-creek/survey/` — `crop-scene.js` / `world-scene.js`
  are the scene definitions, `fv-gpu.mjs <crop|world>` runs either headless, `compare-crop.py
  <solver>` grades, `world-view.py [right] [left]` draws.

**NEXT, and island-sholes decides the order:**
- Run it there (several creeks, 4096² at 1 m, and the only world that might trip the
  `maxCells` ceiling). Watch for `box exceeds maxCells` and the tab OOM that world has hit before.
- **No warning → skip milestone 4** (windowing large domains); M3 already solves per connected
  component, so windowing would be machinery for a case that does not occur. Go to **milestone 5,
  the live a-water window**: the same GLSL running a 512 m window at frame rate, with D8 or the
  baked solve as edge conditions.
- **Warning fires → milestone 4 first**, splitting an oversized box into windows solved upstream
  to downstream.

**Open, not solver bugs:**
- **Thin water fades to nothing on shallow banks.** The band width is threshold ÷ bank slope:
  hero-creek's banks rise 0.074 m/m at the water's edge, so a-water's 3 cm cut-off is 0.40 m
  wide and the full 3→10 cm ramp is 1.35 m — and 4 m in the flattest quarter. Flow tuning does
  not move it (measured twice). The levers are steeper carved channels and a-water's Phase 9
  wet-sand albedo; an export min-depth threshold would only move the discontinuity.
- **Waterfalls clip into the cliff.** The solve carries water over the lip and down the next
  reach correctly, but a heightfield surface cannot draw a 3 m vertical face across one cell.
  That is the Phase 6 particle coupling (lip = sink seeding, foot = source receiving).
- **a-land papercut:** Bake & Export re-solves at `nativeBakeResolution()` and ignores the water
  panel's resolution, so that setting costs editor time and never reaches the export.
- **Uncommitted, deliberately:** a-water's regenerated `water-shader.js` (Dante's regen).
- **Lighting-unit seam: SOLVED 2026-09-19** — see round 16. Three stacked bugs; browser-verified
  by Dante. a-land needs `create-shader.py` for `60d75d7`.
- **Open a-water bug:** `ocean-atmosphere-enabled false` + a-starry-sky = water material
  fails to link (duplicate `MyAESFilmicToneMapping`). See round 15.
- **Open a-land bug:** `_anchorForeignSun` sets `castShadow = false` on the shared sun,
  silently disabling our three scene-sun-shadow paths on any sky+land page.

### LBM started (2026-09-18)

- **B0 done.**
  - No uncommitted D8 edits of ours in a-faraway-land: its 13 modified files are the other
    session's noise / tile-cache / bake-seam work.
  - Worktree `../a-faraway-land-lbm`, branch `lbm-river-solver`, **base `water-carve-channels`
    @ bfb9de5**.
  - The shared tree is untouched.
- **Design:** `a-faraway-land-lbm/WATER-LBM.md` (ba3ac3f). Awaiting Dante's answers to its
  three open questions before milestone 1 (CPU reference + physics tests).
- **Milestone 1 DONE** (a-faraway-land-lbm b892e31): the CPU reference `WaterLBMReference.js`
  plus `tests/test-water-lbm` (16 checks pass).
  - **Two equal sills split 50.5 / 49.5 %** (D8: 0 / 100).
  - Lake at rest exact (1e-14); Manning 0.15 %; weir head within ±15 % of theory.
  - Known limits: dam-break transients; narrow channels run deep.
  - Details in WATER-LBM.md.
  - Next: milestone 2, the GPU stepper checked against it.
- **Real-terrain check → the core moved to FINITE VOLUME** (a-faraway-land-lbm a2fca2f).
  - The LBM went unstable on the hero-creek crop: negative populations in thin, fast water on
    sloping banks.
  - Dante chose the scheme real-DEM flood models use: hydrostatic reconstruction + HLL,
    second order (`WaterFVReference.js`, same API, 18 checks pass).
  - Crop, D8 → FV: side outlet +0.45 → −0.11 m; dead outlet 45 m → 0; split 0/100 → 77/23;
    overhang 0.32 % → 0.
  - The river goes overbank and the pond over-tops its rim: correct for 21–23 m³/s in a
    ~17 m³/s channel. hero-creek needs lower flows or a deeper channel and a taller rim.
  - CPU: 36 min for 2400 s on 54k cells, hence the GPU (milestone 2, now for FV).
- **Note for the LBM hand-off (Dante, round 13):** the pond and creek still switch
  height/normal at the join rather than blending. Leave it: the LBM's own surface and waves
  replace the creek's height there.

### Milestone 2 DONE — the GPU stepper (2026-09-19)

`a-faraway-land-lbm/src/js/runtime/terrain/WaterFVGPU.js`: the finite-volume core as WebGL2
fragment passes on THREE's renderer. Full write-up in that repo's `WATER-LBM.md`.

- **hero-creek crop: 3020 s simulated in 6.4 s of wall clock** (115k steps, 18k steps/s),
  against **36 minutes** on the CPU for 2400 s.
- **Every `compare-crop.py` metric is identical to the CPU run** — pond level 9.31, split
  77/23, side outlet −0.11 m, 0 % overhang. Field against field, level agrees to p99 0.2 mm
  and the wet mask disagrees on 1 cell in 15450.
- **Parity harness:** `tests/test-water-lbm/check-gpu-parity.mjs` runs both solvers on the
  same seven scenes in headless Chrome over raw CDP — no npm dependencies, three.js cached
  on first run. Parity scenes pin `dtMax` so both walk the same clock; one scene grades the
  CFL reduction itself. Agreement is at fp32 noise, 1e-7 to 1e-8.
- **Throughput (RTX 4090):** 18k steps/s up to 256², 5.3k at 1024² (5.6 G cell-steps/s). Below
  256² it is draw-call bound, ~9 passes per step. A live 512 m window in a-water would cost
  0.08 ms per step on this GPU.
- **The bug worth remembering:** GLSL ES defaults fragment-stage `sampler2D` to **lowp**, and
  `RawShaderMaterial` adds no precision header — so every `texelFetch` came back quantised to
  about fp16 (1.2 read as 1.2001953125) while the fp32 render targets tested clean. Still
  water crept at 3 mm/s and Manning was 35 % out until `precision highp sampler2D;` went into
  each preamble. Anything computing in a RawShaderMaterial in either repo wants that line.
- The GPU deliberately drops the reference's global mass-debt rescale: instrumented on the
  crop, the negative-depth clip fired in **0 of 2024 steps**. It banks any clipped depth
  instead, and the parity suite asserts it stays zero.

### The whole island on the GPU (2026-09-19)

`hero-creek/survey/fv-gpu.mjs world` solves all 1024² of hero-creek with **D8's real
boundaries** instead of the crop's invented ones — intents become mass sources spread over a
disc (a point cannot take 16.6 m³/s: that is 28 cm in one cell in one step), ocean cells are
held at sea level, lakes deeper than 3 m are held and shallower ones simulated. That
translation is what milestone 3 has to do inside the editor, and it is now written and
measured.

- **3050 s of the whole island in 29 s of wall clock** (181k steps, dt 0.0168 s, set by the
  8 m deep sea).
- **It agrees with the crop it cannot see:** pond 9.33 vs 9.31, split 76/24 vs 77/23, side
  outlet −0.12 vs −0.11 m, depth p50 0.26 both. The crop's fake boundaries were telling the
  truth.
- The river **meets the sea at 0.00 m** — the Dirichlet ocean works.
- **Convergence is graded on the bulk now:** a steep creek always has a jump wandering a
  metre, so max level change sits at 5–8 cm forever while p99 is 0.3–0.6 cm and only ~180 of
  35,620 wet cells move more than 1 cm per 50 s.
- ⚠ **For milestone 3 and for a-water:** the FV solution wets **34,685 cells against D8's
  12,509**, because D8 stamps a 4√Q ribbon and the real flow spills out of a channel holding
  ~17 m³/s bank-full while carrying 23. **7.5 % of flowing cells are under 3 cm**, and
  a-water's thickness fade discards below 3 cm — so baking this world today would ring every
  creek with a halo of nearly-invisible water. It is hero-creek being over-fed (the
  in-bank fix: sources to ~45 %/35 %), but the export may also want a minimum-depth
  threshold of its own. Picture: `survey/out/world-d8-vs-fvworld.png`, drawn by
  `world-view.py` (thin water in red).

### Milestone 3 — the editor bake (2026-09-19, awaiting Dante's browser run)

`WaterFVBake.js` runs inside a-land's `generateWaterSolve`, between the D8 worker's result and
the park, on both paths (interactive Solve and Bake & Export's `carve:false` re-solve). It
hands back D8's own arrays in D8's units, so the preview, WaterTileExport, the tiles and
a-water cannot tell it ran. **Behind `settings.water.params.lbm`**; without the flag, without
float render targets, or on any error, D8's solve stands untouched.

**To try it** (the shared a-land tree holds another session's work — do not switch it):
1. Point the dev server at the worktree `../a-faraway-land-lbm` instead of `a-faraway-land`.
2. Open the project, then in the console:
   `ALandEditor.saveWaterSettings(Object.assign({}, ALandEditor.waterSettings(), { params: Object.assign({}, ALandEditor.waterSettings().params, { lbm: true }) }))`
3. **Set hero-creek's water resolution to 1024 or 2048 first.** It is 4096 on a 1024 m world —
   0.25 m cells, finer than the terrain the bed is sampled from, so it costs a minute or two
   per solve for no new information. island-sholes at 4096 over 4096 m is already 1 m.
4. Solve Water → ⌘S Save → Bake & Export, then open the a-water page.

The console logs `[a-land] shallow water: N domain(s), X -> Y wet cells (spill Zx), T s,
converged`, and warns when the spill ratio passes 2.5× — D8's 4√Q ribbon is full by
construction, so several times more wetted ground means the flow does not fit its channel.

- **It solves the water, not the world:** wet non-ocean cells are dilated by 16 m, labelled
  into connected components, and each component's box is solved alone. The sea is held, never
  simulated. hero-creek's creek is one 229k-cell domain, 2.3 s, converged.
- **The dilation is a correctness fix, not an optimisation.** Labelling D8's wet cells directly
  splits a creek at its waterfall; the downstream reach then has no inflow, drains and dries
  up. That is what hero-creek did on the first run here.
- **Still bodies keep D8's exact zeros**, and held cells (sea, deep lakes) are not written back
  at all, so the sea stays byte-identical. Energy is recomputed from the real depth and
  velocity rather than D8's hydraulic-geometry estimate.
- `tests/test-water-lbm/check-fv-bake.mjs` guards that contract on the real export (units,
  still bodies, drained cells, untouched sea, pond off its sill, water reaching the coast).

### ⚠ Outstanding — needs Dante

1. **Re-bake island-sholes** with a-faraway-land `water-carve-channels` (cb7f963 or later):
   Solve Water → ⌘S Save → Bake & Export. The current water tiles are the film export.
2. **Run `create-shader.py`** (again after e18b516, one caustic model). Only `water-shader.js` changes. Then open
   `examples/demos/island-sholes-ocean.html`:
   - wtr-6's lower run (≈ 1765, 20, 2115), the lake-14.05 outlet, and the wtr-8 falls
     (≈ 1480, 2525);
   - A/B with `oceanGrid.flowSurfaceEnabled = false`;
   - `setOceanShadowDebug(66)` for thickness, `(63)` / `(64)` for foam and current;
   - spray knobs on `oceanSplash.fallSprayRate` / `.fallSprayEnabled`.
3. **hero-creek** (generated, see NEXT): paste the two source lines from
   `hero-creek/survey/README.md` in the editor, then Solve Water → ⌘S Save → Bake & Export.
4. **Known look issues:**
   - A bright white line at the far confluence has not been investigated.
   - Wet-sand albedo under thin water is Phase 9. It matters more now that thin water
     draws as bed.
5. Headless terrain textures sometimes load grey. That is a harness flake, not
   ours.

---

## Phase 3b — shore reflection — **PARKED** (2026-09-13)

Branch `phase-3b-reflection`, off `multi-water-types` at `1efd476`.

> **Parked by Dante, 2026-09-13.** Reasons:
> - It costs 0.58 ms/frame on the reference iGPU.
> - On the current two-way FFT spectrum (round 2 below) a reflection cannot read.
> - Making the sea one-way would change the ocean's look and the buoyancy feel, so
>   Dante kept the two-way sea.
>
> What "parked" means in the code:
> - `ARestlessOcean.ShoreReflection.ENABLED = false` (in `shore-reflection-pass.js`).
> - No pass is constructed: no render targets, no self-test, no step.
> - Every consumer splices `STUB_GLSL` (no sampler, so the water program stays at
>   its old unit count).
> - Verified headless: pass null, no sampler in the water program, no shader errors,
>   60 fps.
>
> To revive: flip `ENABLED`, and consider the one-sided spectrum (round 2).
**GLSL changed: run `create-shader.py`** (it regenerates `water-shader.js` and
`ocean-shadow.js`).

### First task: oblique incidence (spike, committed d098492)

The measurements and tables are in `NEARSHORE-WAVES.md` § 5.9. They changed the design:
- **The mirror law emerges.** Direction error is ≤ 0.3° at shore angles 0/20/45° and
  incidence 0/30/60°.
- **§ 8's Dirichlet emitter is the wrong shore.** It sends any *simulated* wave back
  inverted at full strength (phase 175°, |R| = 1), so reflections would ring forever
  between shores.
- **Replaced by a Robin (impedance) shore with α = (1 − Kr)/(1 + Kr).**
  - α is spread over the staircase faces (× 1/(|nx| + |ny|)).
  - The shore is driven by the incident's **shoreward characteristic** only. The
    total-field source also cancelled 65–100% of an offshore-going incident; this
    one leaks 2–6%.
  - It reflects at Kr 0.498–0.503 at every angle tested.
- **Sloping bed.** The medium is c(h; Tp) in the constant-amplitude form
  η_tt = c∇·(c∇η), with the shore on the h_min = L0/18π contour. The deep gauge
  reads Kr 0.49 for a set 0.5, on both 1:10 and 30° slopes.
- **No separate absorber.** A Kr ≈ 0 shore absorbs by itself, including other shores'
  reflections.

### What shipped in step 1

- **`ARestlessOcean.Passes.ShoreReflectionPass` + `ARestlessOcean.ShoreReflection`**,
  in the new `src/js/ocean-system/passes/shore-reflection-pass.js`. The file header
  has the full model. Registered in `make-combined.py` and in the four example
  pages (gitignored; backups in the session scratchpad).
  - **Grid.** 512² RGBA32F ping-pong, state = (η, v, incident last step, valid).
    dx = L0/30 in quarter-octave steps, clamped to 0.25–4 m: 1.68 m and a ±430 m
    window on island-sholes. World-snapped; it re-centres by integer-cell shift
    once the camera is 25% of the half-width out.
  - **Medium bake.** (c, α·cosθ·faceScale, source gain, faceScale) per cell, from
    the WaterField. It re-bakes on a shift, on a field refill, and at least once a
    second.
    - Shore normal: shoreSDF central differences on cascade 1.
    - Kr: Battjes, with ξ from h/s.
    - cosθ: wind direction against the normal, floored at 0.35.
  - **Incident.** The unmasked cascades × WaveMask's fetch part, mip-filtered to
    dx, smooth-faded out below 5–10 cells per wavelength.
  - **Breaking.** Where |η| > max(0.39·h, Hs/2), damping grows with the excess.
    Without it, the steep-island ↔ oval-island strait rang up to 3–4 m of reflected
    height in 1–3 m of water. The Hs/2 floor is flagged as a look choice: a pure
    McCowan cap on the ~1 m shore contour clipped a cliff's single reflection to a
    third.
  - **Precision self-test** at init (100 × +0.001 through a float target). It
    disables the layer on the § 5.8 half-precision drivers.
  - **Enabled with the breakers** (same terrain-provider rule), when Hs ≥ 0.1 m.
- **Consumers.** `$shore_reflection_functions` is a new token in `water-vertex.glsl`,
  `water-shader.glsl` and `ocean-shadow-vertex.glsl`, spliced at runtime like
  ShoreBreaker. There is a stub if the file is missing.
  - Vertex: height.
  - Fragment: slope from central differences one cell apart, added to the normal
    and the macro normal, plus debug mode 62.
  - CSM caster: height.
  - Height bake: `.r`.
  - Camera submersion probe: the breaker probe texel.
  - The rim fade matches the sponge.
- **Console:** `setShoreReflectionEnabled`, `setShoreReflectionHeightScale`,
  `shoreReflectionStats()`.

### Verified headless (island-sholes-ocean.html, scratch regen served via CDP Fetch)

- **4090 / ANGLE GL:** no shader or program errors, 60 fps, self-test 10.10004.
  The standalone `islands.html` is inactive with its uniform at 0. Its 8 "Unable to
  serialize Texture" warnings are pre-existing (same count on the base code).
- **Reflections come from the right shores.** The steep island (1393, 2524) radiates
  outgoing rings, and the gentle oval and long islands send back essentially nothing.
- **Shore cells, over 15 s:** RMS(η)/RMS(incident) tracks each cell's own Kr.
  Bins Kr 0–0.1 / 0.1–0.2 / 0.2–0.35 / 0.35–0.5 / 0.5–0.7 / 0.7–0.9 / 0.9–1 give
  medians **0.08 / 0.18 / 0.29 / 0.47 / 0.52 / 0.63 / 0.66**. The top bins read low
  because part of the FFT incident travels away from those shores.
- **Stable for 100 s.** Strait RMS 0.14–0.22 m, max ≤ 2.1 m (Hs 2.94 m). Lee side
  ~0.05 m. No non-finite cells.
- **GPU cost** (timer query):
  - RTX 4090: step 0.016 ms, bake 0.014 ms.
  - **Radeon 7800X3D iGPU (RADV): step 0.58 ms/frame, bake 0.26 ms** (~1/s plus
    shifts).
  - That is over the spike's 0.24 ms because of the medium fetch and branching.
    Skipping the step when the window has no shore cells is the obvious saving (not
    done).

### ⚠ Outstanding — needs Dante

1. Run `create-shader.py`, then look at `examples/demos/island-sholes-ocean.html` near
   the steep island. Try `setOceanShadowDebug(62)`, and A/B with
   `setShoreReflectionEnabled(false)`. Does the cross-hatch read as a real coast or as
   noise? Is the strait's clapotis too lively?
2. The acceptance line in WATER-TYPES.md (§ Verification, Phase 3):
   - a steep shore at 12 m/s shows outgoing crests at about half the incident;
   - a 1:20 beach shows none;
   - oblique waves reflect at the mirror angle.

   Only the spike and the Kr-ratio check are numbers so far.

### Browser round 1 (2026-09-13) — "strongest near rocks?", "toggle changes little"

- **Fixed: toggling off reset the sim.** Off → on restarted from flat water, and the
  field took tens of seconds to rebuild. Off now freezes the field; only a new cell
  size or a camera jump out of the window clears it.
- **Fixed: a dead band at the waterline.** Cells shallower than h_min (0.92 m) were
  held at 0, which made the grey line along the rocks in debug 62. They are now
  filled each step from their wet neighbours. RMS reflected height against shore
  distance around the steep island, before → after:

  | shore distance | 0–2 m | 2–4 m | 4–8 m | 8–16 m | 16–32 m | 32–64 m | 64–128 m | 128–256 m |
  |---|---|---|---|---|---|---|---|---|
  | before | 0.17 | 0.34 | 0.32 | 0.25 | 0.19 | 0.11 | 0.08 | 0.06 |
  | after | **0.44** | 0.35 | 0.32 | 0.25 | 0.19 | 0.11 | 0.08 | 0.06 |

  The reflection now peaks at the rocks.
- **Not a bug: the lit render barely changes.**
  - In the steep ↔ oval strait the reflected height exceeds ±0.5 m (0.64 m RMS 25 m
    off the rock). It is carried by the ~52 m peak waves, whose slope (~0.06) is
    lost under the 2.9 m Hs chop.
  - The south shore Dante looked at is side-on to the −X waves, so it reflects
    little by design.
  - Halving dx (L0/60, window ±215 m) let the 8 m cascade in and changed nothing
    visible: that band holds too little energy.
- **Open question for Dante:** accept a physically subtle reflection, or add cues
  driven by it (clapotis foam, surge spray on rock faces).

### Browser round 2 (2026-09-13) — "should go back out and interfere; not seeing it"

Measured headless with a per-frame transect along the normal of a Kr 1 rock face on
the steep island (1440.5, 2362.1), normal (0.99, −0.10). Every frame, a sync read
of four heights over 160 m at 1 m spacing:
- rendered masked FFT
- breaker + swash
- reflection
- the unmasked incident the sim is driven by

Direction comes from the peak-band phase gradient.

**⚠ Root cause, pre-existing (not 3b): the FFT ocean is not directional.**
- `h_0-pass.glsl`'s spreading is `mix(d_k * d_k, 0.5, turb)`, with the same value
  for k and −k. So every wave has an equal twin travelling against the wind.
- In open water the space-time diagram is a chevron cross-hatch: crests run both
  ways. The peak band's phase gradient is incoherent: apparent L 100–1400 m and
  30–100 m/s.
- Crest's function is **Pos**CosSquared (the downwind half only); the "Pos" was
  lost in the port.
- With a sea that already contains its own "reflection", a real reflection cannot
  read as a wave going back out.

**The fix, prototyped only (scratch h_0-pass.js served headless, NOT committed):**

    float spread_k       = mix(d_minus_k > 0.0 ? 1.41421356 * d_minus_k * d_minus_k : 0.0, 0.5, turb);
    float spread_minus_k = mix(d_k       > 0.0 ? 1.41421356 * d_k       * d_k       : 0.0, 0.5, turb);

- **Why the halves are swapped:** `h_k-pass` evolves h₀(k)·e^{+iωt}, so the downwind
  half must sit on h₀(−k). Putting it on h₀(k) was measured travelling upwind.
- **√2** keeps the height variance (2cos⁴ averaged over the circle) the same when
  turb = 0.
- **Measured in open water:** crests run one way only. Peak band L 51 m at
  9.3 m/s (deep theory 9.0 m/s); short band 6.9 m/s. Coherence 1.00.
- `OceanWaveField.buildGerstnerComponents` (the buoyancy twin) has the same
  symmetric spread and needs the same change.

**With the fixed spectrum, at the rock:**
- The incident arrives (−s, L 55 m, 10 m/s), and **the reflection travels back
  out (+s)**.
- Variance of the total surface, reflection on / off, against distance from the
  rock: **3.49 (rock) → 0.93 (node, 10 m) → 1.63 (antinode, 18 m) → 1.04 (28 m)
  → 1.22 (44 m)**, then noise.
- In the space-time diagram the incoming diagonal crests turn into a standing
  checkerboard within ~40 m of the rock. That is the clapotis Dante expected.
- It fades past ~50 m: the reflection there carries 5–25% of the incident
  variance (convex island, spreading reflection).
- Near the rock the reflection variance is ~5× the rendered incident's, because
  the FFT is TMA depth-masked there and the reflection is relative to the deep
  incident. Worth a look once the spectrum is fixed.

**Decision for Dante:**
1. Take the one-sided spectrum. It changes the whole ocean's look: crests visibly
   travel downwind, and the height stays calibrated.
2. After that, reassess the reflection visually before any more tuning.

### Not done / next

- Skip the step when no shore cells are in the window (iGPU budget).
- Kr above ξ 2.5 is Battjes extrapolated (capped at 1). Rough and permeable rock
  should reflect less.
- Phase 8's boat, rain and avatar ripples can inject into the same field.

---

## Phase 3a — shorelines that break — **landed, browser-checked, merged** (2026-09-13)

Branch `phase-3a-breakers`, off `multi-water-types` at `9cfb079`. Step 1 is the
breaker layer itself. Swash, the splash trigger and shallow colour are still to
come (see *Next* below).

### What shipped in step 1

- **`ARestlessOcean.ShoreBreaker`**, in `ocean-wave-field.js` next to WaveMask. No
  new script tags. It has the same structure as WaveMask: one JS-owned GLSL chunk
  spliced at `$shore_breaker_functions`, plus a JS mirror (`evaluate`). The model,
  in brief (the file header has the full derivation and sources):
  - **Handoff.** The breaker carries √(1 − a²) of the peak, where a is WaveMask's
    TMA amplitude, so deep water is untouched and nothing is double-counted.
  - **Shoaling.** Eckart's wavenumber plus linear shoaling Ks.
  - **Breaking.** McCowan's cap, H ≤ 0.78 h, applied per individual wave.
  - **Direction.** A cos² directional spread against the shore normal (from
    ∇shoreSDF). Lee shores get nothing.
  - **Phase.** A closed-form shoreward travel time, ωT = (s/h)·I(k0h), with the
    integral I fitted to under 0.9% error from shallow to deep water.
  - **Shape.** Ruessink et al. 2012 (skewness and asymmetry from the Ursell
    number) feeding Abreu et al. 2010's waveform. The B → r inversion was derived
    numerically. The waveform is exactly zero-mean with a crest-to-trough range
    of 2, so η = (H/2)·w.
  - **Foam.** Foam trails the breaking front, scaled by 1 − Kr² (Battjes).
- **Four consumers.** They are the water vertex (geometry, faded out by
  400–1400 m), the water fragment (a finite-difference slope added into the
  normals and macro normal, breaker foam and debug modes 60/61), the ocean CSM
  caster, and the CPU height bake (so floats and splash ride the breakers).
- **Foam.** When breakers are on, breaker foam replaces the old `shoreFade` /
  `shoreBoost` heuristic. The heuristic remains as the fallback when they are off.
- **Controls.** Knobs are on the grid (`shoreBreakersEnabled`,
  `shoreBreakerFoamGain`, `shoreBreakerHeightScale`, `shoreBreakersStandalone`).
  Console helpers are `setShoreBreakersEnabled`, `setShoreBreakerFoamGain`,
  `setShoreBreakerHeightScale` and `probeShoreBreaker(x, z)`.

### Deviations from the plan, and why

- **Refraction is not done by bending the FFT sample direction.** Crests come out
  shore-parallel by construction, because the breaker phase runs along shoreSDF
  iso-contours. Bending the tile lookup would shear the FFT field. It is left
  out, not deferred.
- **The phase reads cascade 1 (4 m texels); amplitude reads cascade 0.** The
  first headless render showed radial streaks through every crest. Crest
  position integrates s/h, so 1 m noise in the jump-flooded distance and in the
  depth becomes crest wobble. Amplitude and breaking stay on the 1 m field so the
  waterline stays sharp.
- **Off standalone by default.** There, shoreSDF is jump-flooded from the foam
  ortho, which sees boats and docks as land, so a hull would grow a ring of
  breakers. `shoreBreakersStandalone = true` overrides this for scenes with
  nothing floating.
- **Look choices, flagged as such in the code:**
  - a per-wave height factor from smooth noise;
  - a ~7-wave set envelope;
  - ~90 m crest-bending phase noise;
  - the foam trail length (`FOAM_TRAIL` 14) and the residual sheet
    (`FOAM_RESIDUAL` 0.06).

### Verified headless (RTX 4090 via ANGLE GL, island-sholes-ocean.html)

- **Regen method.** The shaders were regenerated into scratch with
  create-shader.py's own `ConvertGLSLToStringArray` and template substitution,
  and served in place of the committed JS via CDP `Fetch`. As a control, the same
  regen of the HEAD sources reproduces the committed `water-shader.js` byte for
  byte.
- **Compile and frame rate.** Every program compiles (`renderer.info.programs`
  has no unrunnable diagnostics), at 60 fps.
- **GPU vs JS parity.** 512 surf-zone points were evaluated by the real GLSL in
  a scratch pass and compared with `ShoreBreaker.evaluate`, fed from the GPU
  field readback. Maximum η error is 2.2 mm on waves up to ±0.97 m (mean 0.56 mm);
  foam error is below 0.008. The JS hash runs in float32 (`Math.fround`) to get
  there. `shoreBreakerHeightAt`, which includes its own shore-normal taps, agrees
  equally well.
- **1D transect (JS, 1:30 beach).** The wave is sinusoidal offshore. Through the
  surf zone B rises to 0.86 and ψ falls to −85° (sawtooth). The mean stays at 0,
  and breaking starts at h ≈ Hs·Ks/0.78: about 5 m at 12 m/s and 0.2 m at 3 m/s.
- **Screenshots.** The oval island shows a surf band with foam along its windward
  beach. Mode 60 shows the steep island plunging on its windward face and nothing
  on its lee.
- **Not a breaker bug.** The first run showed a background-blue hole over the oval
  island in every mode, debug modes included. It was gone on the rerun: it was
  a-land's terrain streaming, which fits the four LOD-1 tiles it cancels on load.

### ⚠ Outstanding — needs Dante

1. **Regen.** Run `create-shader.py`. `water-vertex.glsl`, `water-shader.glsl` and
   `ocean-shadow-vertex.glsl` gained the token and the call sites.
2. **Browser look** on `examples/demos/island-sholes-ocean.html` (8 m/s onshore).
   First tuning suspects:
   - The surf zone reads as a milky wash from low angles. Knobs:
     `setShoreBreakerFoamGain`, `FOAM_RESIDUAL`.
   - Crest lines are hard to see through the foam. A/B with
     `setShoreBreakersEnabled(false)`.
   - `waveHeightMultiplier` (1.5 in that scene) scales the breaker Hs as well.

### Browser round 1 (2026-09-13, Dante)

The breakers read well, including beside the steep island. Three touch-ups are
parked, none of them fixed yet:
- **Breakers invisible from underwater.** Suspect: the submersion probe
  (`height-readback-pass.js`, camera probe) sums only cascades 0 and 1 times the
  masks. It never adds the breaker, so in the surf zone the air/water swap is
  decided against a surface that isn't the one being drawn.
- **Twitchy surface near the waterline.** Two candidates:
  1. The same probe mismatch, flipping the air/water state under passing crests.
  2. Crest jumps when cascade 1 refills. The phase is (s/h)·I with θ ≈ 60 rad at
     the shore, so a 1% change in the re-flooded shoreSDF moves a crest by
     ~0.6 rad. Test: watch `waterFieldPass.refillCount` against the twitch.
- **Screenshot oddities.** The scalloped grey band is the residual foam sheet
  behind the front: a hard edge where `dFront` wraps. There are also two square
  outlines in the shallows, source unknown (possibly a-land tiles or the foam
  ortho).

### Step 2 — swash (written, headless-verified, awaiting regen + browser)

- **`ShoreBreaker.evaluateSwash`** (JS) and **`shoreSwashEval`** (GLSL). The sheet
  is flat, at rest level plus z(t), and is allowed over the dry band the run-up can
  reach. Where the beach is higher than the sheet, the depth test hides it, so the
  moving waterline needs no terrain lookup.
  - **Run-up.** Stockdon et al. (2006) general form, for every ξ:
    R2 = 1.1(η̄ + S/2), with H0 = Hs·√fDir (so lee beaches barely swash). The
    foreshore slope β is read from cascade 1, 6 m offshore along the shore normal.
  - **Motion, per wave.** z rises from η̄ − S/2 to R2 × waveFactor over the first
    30% of the cycle (sin, decelerating), then drains under gravity (1 − x²).
    It is timed off the breaker phase, so the arriving bore starts the uprush.
  - **Seaward.** The swash fades out by the depth equal to the largest run-up.
  - **Reach.** 1.155·R2/β + 2 m. Beyond it the dry discard applies as before.
- **Geometry.** `shoreBreakerHeightAt` now returns breaker + swash, so the vertex,
  CSM caster and height bake picked it up with no new call sites.
- **Fragment changes.**
  - The dry discard asks `shoreSwashCovers` first.
  - The normals block adds the swash into the same finite-difference slope.
  - Uprush bore foam comes from the eval. Thin-sheet foam (< 25 cm against the
    foam-ortho terrain) marks the leading edge and the draining film.
- **Parity.** 1024 points, 755 of them on land: maximum η error 0.4 mm, reach
  within 0.1%, and 0 of 1024 disagree on which dry texels the sheet may cover.
  Everything compiles, at 59–60 fps.
- **Screenshots.** Tongues of water run up the oval beach with foamy thin edges,
  and on the backwash the drawdown briefly bares sand in the inner surf zone.
- **Headless-only terrain hole, now explained.** a-land's four cancelled LOD-1
  height tiles (see island-sholes notes) are what leave the oval island as a hole.
  Calling `heightStreamer.clearFailed()` after load streams them and the hole goes.

**Tuning suspects for the browser pass:**
- a faint line across the sand, possibly the reach cut where the sheet is still
  above a flatter upper beach;
- the milky wash from low angles;
- sand patches during drawdown;
- the square outlines Dante saw. Those are breaker foam fronts on isolated wet
  texels just inland, moving with the wave.

**Browser round 2 (Dante): creeping strips of sheet, fixed.** The swash was timed
with the breaker's LOCAL phase, (s/h)·I, which changes quickly with distance near
the shoreline. The sheet was therefore a set of short standing "waves": strips of
water and sand parallel to the shore that crept up the beach at shallow-water
speed and cut off the next uprush. The fix is to time the swash with the
SHORELINE phase (ωt plus the alongshore noise), identical at every cross-shore
distance, so the zone fills and drains as one sheet. Checked two ways:
- **JS waterline simulation (1:28, 8 m/s × 1.5).** Each wave runs 8–15 m up the
  sand in ~1.5 s, drains over ~4 s, then briefly sits below still water.
- **Headless frame sequences** show one advancing and retreating waterline, with
  no strips.

The band limit also went to 2 × the probed-slope reach (capped at 60 m), so a
flatter upper beach no longer gets a cut line. GPU parity after the change:
0.3 mm, 0 cover mismatches. **Dante confirmed in the browser: "Much better!"**

### Tuning pass 1 — the submersion probe knows about breakers (browser-confirmed by Dante 2026-09-13)

- **Cause.** `probeWaterSurfaceY` summed only the rest level and cascades 0–1. In
  a surf zone it therefore answered a surface without breakers or swash.
  Everything downstream followed that wrong surface: the air/water swap, the
  underwater fog plane, the caustic projector's surface Y and the mirror clip
  plane.
- **Fix** (`height-readback-pass.js`, `_renderBreakerProbe`). A 1×1 float pass
  evaluates the very `shoreBreakerHeightAt` the water vertex calls, at the
  camera, and it is read back async next to the two cascade texels. The draw
  happens before any async read is issued (the three r173 PBO window). The
  blocking fallback path gets it too. JS only, so no regen is needed.
- **Measured headless** (oval east beach, 8 m/s × 1.5), over 15 s:

  | Camera | Breaker term the probe now adds |
  | --- | --- |
  | x 1985 | −0.60 … +1.04 m |
  | x 1965 (inner) | −0.25 … +0.38 m |
  | x 2030 (outer) | −0.67 … +0.72 m |

  Those ranges are exactly the old probe's error. With the camera held 0.2 m
  above rest level at x 1985, the new probe goes underwater as crests wash over
  (5 swaps and 194 underwater frames in 12 s). The old probe never did.
- **Frames.** With the old probe, a trough under the camera left it "underwater"
  above the water, showing a torn ceiling with sky through it. With the new
  probe, the underside of the breaker crest reads correctly.
- **Browser result.** Breakers are visible from underwater. After tuning pass 2,
  Dante confirmed the waterline twitch is gone too, so the refill phase-jump
  suspect was not needed.

### Tuning pass 2 — walls of water around the steep island's rocks (browser-confirmed by Dante 2026-09-13)

**Report (browser round 3).** Near the steep island there were sheets and walls of
water standing around rocks, and wash climbing the cliffs. A GPU scan of
`shoreBreakerHeightAt` over a 384 m window found jumps of 2–3.5 m between 1 m
neighbours. The oval beach had none: its largest step was 0.24 m per metre, which
is a real wave front. Five causes, one fix each:

1. **Uncapped run-up.** Stockdon on a rock face (tanβ → 1) gives R2 ≈ 10 m.
   It is now capped at `SWASH_RUNUP_MAX_RATIO` 2 × H0. ⚠ The cap is from memory,
   not a checked fit.
2. **Hard gates before the tapers finished.**
   - The swash depth taper ran to 1.155·R2 but was gated off at 3·Hs+1 or the
     depth cap. It now completes by 0.8 of the nearest gate.
   - Inland, the geometry now fades to 0 by the reach, matching the discard.
   - Seaward it also fades by shore DISTANCE, so a shallow bar 30 m out is not
     swash.
   - The breaker hard-gated at a-land's depth cap, leaving a ring at the 10 m
     contour. It now fades from 0.7 to 0.98 of the cap.
3. **Shore normal from a 1 m one-sided difference.** Around rocks and along
   medial axes of the jump-flooded field it flipped from texel to texel, and the
   direction factor and the swash slope probe flipped with it.
   - Fix: central differences on cascade 1 at ±4 m (`shoreBreakerSmoothGrad`,
     which now returns ∇s and ∇h from the same four taps).
   - The swash fades where |∇s| < 0.35–0.75, i.e. on medial axes with no single
     shore.
4. **Crest phase inconsistent over rough bathymetry.** θ = (s/h)·I assumes the
   depth grows with distance. On a slope |∇θ| equals the dispersion k exactly
   (the ratio measures 1.00–1.05 on clean slopes); beside a rock it reached 5.3.
   The breaker now fades where |∇θ|/k is between 1.6 and 3.0, computed
   analytically from the same ∇s and ∇h.
5. **A flat swash sheet on steep faces.** It is a beach model (Stockdon's data
   go up to tanβ ≈ 0.2). It now fades out between foreshore slopes of 0.15 and
   0.35. Rock faces are left to 3b's reflection and to spray, or to a particle
   or SPH layer if that is wanted later (Dante's note).

**Result on the same 384 m strait window, three sample times:**

| Measure | Before | After |
| --- | --- | --- |
| Tallest water | 4.86 m | 1.74 m |
| Steps > 1 m | 196 | 0–4 |
| Steps > 0.5 m | ~1,260 | 70–340 |

The remaining ~1 m steps are breaker fronts in 3 m of water (plausible) and a
few waterline texels. The oval beach is unchanged (0 steps > 0.5 m). Parity is
unchanged: breaker 2.2 mm, swash 1.3 mm. Screenshots from above show foam around
the rocks and no walls. `water-shader.glsl` changed (`bGrad` is now a vec4), so
this **needs create-shader.py**.

### Tuning pass 3 — grey foam front, milky shallows, inland squares (seabed 1/π restored; squares not reproducible)

- **Grey foam front and milky shallows share one cause: a lighting-unit fudge.**
  - *Not the foam amount.* Foam compositing is a soft ramp
    (`smoothstep(0.04, 0.5, foamAmount)`), and there is no hard threshold.
  - *Not foam facing away from the sun.* A frozen-breaker A/B that lit breaker foam
    about an upward normal changed nothing. That edit was reverted.
  - *Not caustics.* With `causticsStrength = 0` the shallows are slightly
    brighter (mean RGB 190/209/202 → 197/220/213), because caustics modulate
    rather than add.
  - *The real cause.* The seabed relight (`water-shader.glsl`, the
    `refractedLight *= (sunDown * NdotL_seabed ...)` line) deliberately has no
    1/π. The comment dates from 2026-05-16: dividing erased the seabed against
    the inscatter in clean deep water. Foam is lit as energy-conserving Lambert
    WITH 1/π, so sand seen through thin water is lit about π× brighter than foam.
    The breaker foam reads grey against the shallows, and the shallows read milky.
  - *Measured* (tonemapped, one frame): dry sand is 214/204/191; sand under
    shallow water is 170/210/199, just as bright as dry sand. Wet, submerged sand
    should be clearly darker (lower albedo, surface Fresnel loss, absorption).
  - **Decision for Dante.** Put 1/π back on the seabed relight (physical, and
    consistent with foam), compensating the deep-water case another way. Or keep
    the fudge and lift foam instead. **Dante chose physical** ("I think we poked
    it once before").
  - **Done.** 1/π is now on the direct-sun term of both the seabed branch and
    the above-water terrain-through-refraction branch. Sky ambient stays without
    1/π, since a uniform sky of radiance L delivers E = πL. The 2026-05-16 history
    is kept in the comment.
  - **Headless before/after** (frozen breakers, tonemapped means):

    | Region | Before | After |
    | --- | --- | --- |
    | Sand under shallow water | 156/205/194 | 111/164/162 |
    | Dry sand (control) | 214/204/191 | unchanged |
    | Beach view | 186/204/194 | 160/181/175 |
    | Mid-depth view (~5 m) | 84/153/150 | 85/138/143 |
    | Deep view (~10 m, the depth cap) | 84/146/146 | 86/137/143 |

  - **Result.** The shallows are no longer milky, and foam and swash read white
    against the water. On this world the 5–10 m views dim only slightly (inscatter
    dominates), so the seabed is not erased. ⚠ Still worth checking in scenes with
    deeper, clearer water (islands.html, lake-ocean.html), which is where the old
    fudge came from. Needs create-shader.py. **Dante, after the regen: "Looking awesome" (2026-09-13).**
- **Square foam outlines inland: not reproducible after tuning pass 2.**
  - *Test.* A GPU scan counted breaker foam > 0.3 on texels that the 4 m field
    calls land (isolated wet pockets). It covered 512 m windows over the oval,
    steep and long islands, at 5 times each: 0 texels.
  - *Beach control.* The same scan found 8–16 k foam texels along the real
    shores.
  - *Likely explanation.* The phase-consistency gate already removes pocket
    breakers.
  - *Status.* A pocket-fade guard was written and then reverted, because there
    was nothing left for it to fix. Dante to re-check.
- **Sand through the backwash.** Dante's reading: no foam rolls back with the
  drawdown, so bare sand shows. A backwash foam/turbidity term is a candidate.
  On rocky bottoms the particles would differ, which is a texture and shader
  question.
- **Idea logged (Dante).** Nearby caustics driven by the actual rendered surface
  height instead of the scrolling texture, if cheap enough.

### Step 3 — breaker spray (written, headless-verified; JS only, no regen)

- **Height bake channels** (`height-readback-pass.js`). The bake now unrolls
  `shoreBreakerHeightAt` so it can also write:
  - `.g`: breaker foam (~1 on the breaking front, gone within ~1/14 cycle behind it);
  - `.b`: shoreward direction, atan2 of −∇s;
  - `.a`: breaker crest above the level.

  `.r` height is unchanged. `sampleBreakerSpray(x, z)` and the global
  `ARestlessOcean.sampleBreakerSprayFFT` read them, nearest texel, from the
  current snapshot.
- **`OceanSplash._emitBreakers`** runs next to `_emitShore`.
  - It scans the bake's 2 m grid within 120 m (camera-front bias, thinned beyond
    50 m).
  - Cells with breaker foam > 0.5 fire `emitImpact` along the crest line, leaning
    shoreward, at a Torricelli jet on the crest (v = 1.2·√(2g·crest)).
  - The count scales with how far the foam is above the threshold.
  - Knobs: `breakerSprayEnabled`, `breakerCountScale` (0.15), `breakerJetScale`,
    `breakerForward`, `breakerSprayThreshold`, `breakerScanRadius`,
    `breakerSheetSpan`.
- **Verified headless** (oval east beach):
  - The bake shows 466 front texels and 7 240 foam texels, max crest 1.2 m.
  - Mean live particles rise from 1.2–1.4 k to 3.7–3.8 k (max 5.2 k of the
    24 k pool).
  - With 8× the count, the spray sheets sit on the breaker lines in the surf zone
    and blow onshore with the 8 m/s wind.
- **Replaced by this:** the plan's "`.g`/`.b` = shoreSDF/Kr for `_emitShore`".
  `_emitShore`'s terrain-contact sheet stays as it was. It already rides the
  breakers and swash through the bake's `.r`.

### Tuning pass 4 — white edge when rising; round sun blob on shore water (written; needs create-shader.py)

- **Round sun blob (browser round 4), fixed.**
  - *Cause.* WaveMask weighs a whole cascade by its longest wavelength, so in
    centimetres of water C4/C5 go to ~0, and over dry texels the swash covers the
    weights are exactly 0. The sheet was a perfect mirror, and the Phong sun lobe
    (exponent 275, half-width ~4°, boost 7) drew a soft disc on it.
  - *Fix* (fragment, normals only). C4/C5 get a 0.5 weight floor on the swash
    sheet and fading out by 1.5 m depth, when breakers are on. Real swash and
    shallows are never glassy: the short ripples and bore turbulence are local,
    not depth-limited swell.
  - *Headless* (frozen breakers, 3 times × 2 angles): every frame that showed
    the blob now shows sparkle.
- **White edge growing as the camera rises, changed but NOT reproduced headless.**
  - *Suspected cause.* The thin-sheet foam compared the surface to the foam
    ortho's terrain height (~4 m texels, follows the camera), and the old
    `shoreFade` heuristic did the same, which is why Dante had seen a version
    of it before.
  - *Change.* The thin-sheet foam now measures thickness against the refraction
    G-buffer's per-pixel ground point (along the refracted ray), placed after
    `pointXYZ` is built.
  - *Test.* The white edge did not appear in the before or after frames at
    12 m and 30 m. **Dante to re-check.**
- **White edge — ROOT CAUSE FOUND, browser round 5: a one-frame camera lag in
  the whole ocean.**
  - *Dante's clue.* It appears only while the camera moves (worst when rising)
    and clears when it stops.
  - *Reproduced headless* by holding the real E key through CDP, so the page's
    fly-controls moved the rig in its normal tick. With debug mode 5 (refraction),
    the white band grew from 8 k to 38 k pixels while moving. The thin-sheet foam
    and a-land's morph catch-up (`morphCatchupMs` → 1) were both ruled out.
  - *Trace.* Each frame, the G-buffer's camera Y (`inverseViewMatrix`) equalled
    the main render's camera Y from the frame BEFORE (12.25/12.47, 12.47/12.64, …).
    The call trace per frame was `ocean-tick(G-buffer render) → fly-controls →
    main render`.
  - *Why.* A-Frame 1.7 `callComponentBehaviors` ticks by component type in
    REGISTRATION order (`scene.componentOrder`), not DOM order, and ticks systems
    after all components. `ocean-state` registers with the ocean scripts in
    `<head>`, so any camera controller registered later ticks after it.
  - *Fix* (`ocean-state.js`). An `ocean-state` SYSTEM now drives
    `oceanGrid.tick(time)` for every registered ocean component. A system tick
    runs after every component tick and before the render. The component
    registers and unregisters itself.
  - *Verified.* While moving, G-buffer camera Y == render camera Y on every
    frame, and the climbing frames show no white band.
  - *Side effect.* Components that read ocean state in their own tick
    (`buoyant`, splash consumers) now see it from the previous frame's ocean tick.
    The height snapshot is 15 Hz anyway. JS only, so no regen.

### Closing 3a (2026-09-13)

- **Shallow colour from true depth (the old step 4) is already in place.** The
  unified distance-depth model's `verticalDepth` is the real surface-to-seabed
  thickness from the refraction G-buffer. `shoreFade` survives only as the fallback
  when breakers are off.
- **Parked, not scheduled:**
  - spray by breaker class (plunging splash-up; offshore wind stripping spray off
    the crests);
  - backwash foam and turbidity (sand patches during drawdown; rocky-bottom
    particles);
  - caustics from the rendered surface height nearby.
- **Next: Phase 3b (shore reflection)**, in a new session. Start from
  `NEARSHORE-WAVES.md` § 8 (3b) and § 5.4 (the reflection-only emitter spike, with
  the harness in `research/nearshore-spike/`). Its first task is to verify oblique
  incidence in 2D.
- **Budgets and hooks 3b inherits from 3a:**
  - The water program is at ~28/32 samplers, and 3b adds 1.
  - Varyings are at 16/16, so 3b's normals must come from fragment finite
    differences.
  - The height bake's `.g`/`.b`/`.a` are now taken (breaker foam, shoreward
    direction, crest). Put the reflected height into `.r` and find another
    channel for Kr.
  - `ShoreBreaker` already computes ξ, Kr (Battjes) and the smooth shore normal
    (`shoreBreakerSmoothGrad`), and the ocean-state system tick ordering is fixed.

### Next (3a step 4, superseded; see Closing 3a)

- **Splash.** The `_emitShore` breaker trigger, reading shoreSDF and Kr from the
  height bake's spare `.g`/`.b` channels.
- **Colour.** Shallow colour from the true water-column depth.

---

## Phase 3.0 — nearshore wave dynamics investigation — **done** (research run, 2026-09-12)

Branch `phase-3.0-nearshore`, off `multi-water-types` at `189b06a`. The deliverable is
[`NEARSHORE-WAVES.md`](./NEARSHORE-WAVES.md). Nothing under `src/` changed and there is
no shader regen, so there is nothing to run.

### What was produced

- **`NEARSHORE-WAVES.md`** contains:
  - the game survey (HFW, Fluid Flux, Crest 4/5, Sea of Thieves, Uncharted, UE5, wave cages, Celeris)
  - the coastal formulas with sources (Battjes Kr, the breaker classes, Hunt and Stockdon run-up, the SWE validity table)
  - the spike results
  - the five-family matrix
  - answers to all six questions
  - the recommendation
- **`WATER-TYPES.md`**:
  - Phase 3.0 is marked done.
  - Phase 3 is amended into **3a** (parametric, ξ-driven), **3b** (new shore-reflection layer) and **3c** (deferred swash SWE).
  - The Phase 3 verification line covers reflection.
- **`research/nearshore-spike/`** holds a scratch WebGL2 harness (`sim.html`) and a
  headless-Chrome CDP driver (`run.mjs`). It is not bundled and not loaded by any page.
  It is committed so every number in the doc can be re-run. Deviation: the plan said
  scratchpad-only.

### Findings worth keeping

- **Classic Mei 2007 virtual pipes are depth-blind.** Their wave speed is √(g·dx), not
  √(gh). The depth-weighted two-pipe variant loses 78% of a packet through its `max(0)`
  clamp. A **signed flux per face** is the working primitive: exact speed, volume drift of
  10⁻⁸.
- **No solver reflects like Battjes by itself.**
  - 1:20 beach: SWE 0.48, wave equation 1.0, Battjes 0.017.
  - 30° shore: SWE 0.55–0.93, Battjes 0.76–1.
  - A *graded* absorber brings the wave equation to 0.013. A uniform band is
    non-monotonic because its edge reflects.
- **The reflection-only emitter** (`Kr × incident` at the shore) matches the analytic
  reflection to 0.8% RMS at 65 cells per wavelength. It needs ≥ ~30 cells per wavelength.
- **Budget, Radeon iGPU (RADV):**
  - wave equation: 0.07 / 0.24 / 0.82 ms per step at 256² / 512² / 1024²
  - face SWE: 0.20 / 0.72 / 2.28 ms per step at the same sizes
  - At dt 1/60 s and 1 m cells, stability holds to about 90 m depth.
- **The `readRenderTargetPixelsAsync` "PBO collision" is a three r173 bug.** It keeps
  `PIXEL_PACK_BUFFER` bound across its await, so any *sync* `readPixels` in that window
  gets `INVALID_OPERATION`. Reproduced. A three-line wrapper fix is independent of
  Phase 3.
- **⚠ ANGLE GL-EGL over Mesa radeonsi samples RGBA32F at half-float precision.** The same
  GPU through Vulkan is exact. Any float-state sim needs a startup self-test. Whether real
  users or WaterField hit that path is not checked.

### ⚠ Outstanding — needs Dante

1. ~~Read `NEARSHORE-WAVES.md` § 8 and accept, or change, the 3a / 3b / 3c split.~~
   **Accepted 2026-09-13.** 3c stays deferred. It gets built either here, if 3a's swash
   sheet reads fake, or with the live rivers, whichever comes first.
2. Decide whether a Dean-profile beach brush in a-faraway-land goes on its roadmap. It is
   the only way this world gets rolling spilling surf, which needs about 1:8 or gentler
   across the breaker band.
   In the meantime Dante hand-built `a-faraway-project/island-sholes` as a gentle-beach
   test world (1:20–1:55 near the shore). The 2026-09-13 rebuild has spilling, plunging
   and surging shores within a few hundred metres of each other. The survey script is in
   `island-sholes/survey/`, and the demo page is `examples/demos/island-sholes-ocean.html`.

---

## Phase 2 — still water on the level field — **landed** (browser-verified 2026-09-12, merged)

2026-09-12, branch `phase-2-still-water` off `multi-water-types`. **GLSL changed:
run `create-shader.py` (regenerates `water-shader.js` and `ocean-shadow.js`).**

### What shipped

**Per-cascade wave masks (`ARestlessOcean.WaveMask`, in `ocean-wave-field.js`).**
One weight per FFT cascade, per place, from two pieces of the spectrum's own
physics:

- **Depth (TMA).** Kitaigorodskii's φ(ω_h), with ω_h = √(k·h) under the FFT's
  deep-water dispersion. The weight is √φ, because φ scales energy.
- **Fetch, inland only.** A lake is the same JONSWAP with a short fetch. Its peak
  uses the band library's own ω_p formula at F, and the weight is the ratio of the
  Pierson-Moskowitz low-frequency cutoffs, exp(−0.625·(k_p,lake² − k_p,ocean²)/k²).
  "Inland" = |level − sea level| ramping over 0.5–2 m, so the coast keeps its swell.
  **Fetch is a proxy: 2·shoreSDF.** Exact at a round lake's centre, short near every rim.
- Each weight is evaluated at one wavenumber per cascade: the local spectral peak,
  clamped into that cascade's band.
- A depth at a-land's `maxDepth` cap counts as deep (the 1c carry item). A standalone
  depth of exactly 0 also counts as deep, because it is a foam-ortho guess (a pier or
  boat deck). A **known** dry (dryMask) weighs 0.

`WaveMask.GLSL` is spliced in at a `$wave_mask_functions` token in three places:
the water vertex shader, the ocean CSM caster and the CPU height bake.
`WaveMask.compute` is the JS mirror. The token is a bare line, not a comment, so the
min build's comment strip cannot eat it.

Where the weights are applied:

- **The water vertex shader** scales each cascade's displacement.
- **The water fragment shader** receives the weights on varyings and scales each
  cascade's slope, its lost-slope variance, the C5 spec low-pass and each cascade's
  σ² in the Fresnel horizon clamp. A glassy lake does not borrow ocean roughness.
- **The ocean CSM caster** now also applies the field level. That was missing since
  1b. A masked receiver under an unmasked caster would read as fully shadowed.
- **The CPU side** covers the analytic twin (`maskProvider`, components carry their
  cascade), the submersion probe, the exact debug readback, and the local height bake.
  The bake now reads level **per texel** from the field instead of once at the region
  centre.

**Dry discard.** `water-shader.glsl` discards where the field's dryMask > 0.999, sampled
at the displaced position. It fires only on a **known** dry, not on `depth == 0`: in
standalone, depth 0 is whatever the foam ortho saw above the water, and discarding on
it would cut holes under every dock. The layer-30 exclusion mask stays for hulls.

**One-plane assumptions removed.**
- Clipmap patches and the horizon skirt are now placed at `heightOffset`. They used
  `waterLevelAt(...)`, which counted the field twice, because the vertex shader already
  adds `level − baseHeightOffset`. Over a lake, the skirt floated a lake-level sheet
  out to the horizon.

### Deviations from the plan, and why

- **The TMA factor is not in `h_0-pass.glsl`.** That spectrum is global, so it could
  hold only one depth. See the amendment in `WATER-TYPES.md`.
- **`type`/`energy` do not drive the masks.** `type` is a Jerlov index (a-land
  `waterTypes[]`), not lake/ocean/river. "Inland" comes from the level instead.
- **The field channels were re-laid-out.** RT0 is now `level, depth, shoreSDF, dryMask`
  and RT1 is `flow.x, flow.z, energy, type`. The water program already binds **28
  active sampler units**, measured. A second trio of cascade samplers could break a
  32-unit GPU (three counts both stages together). The surface needs level, depth,
  shore distance and dryness, and flow belongs to the future ribbon material. a-land's
  clip still reads RT0.r. `probeAt`, `readCascade`, `surveyShore` and `showShoreField`
  were updated to match.
- **The `mat4` varyings `vInstanceMatrix`/`vModelMatrix` were replaced by
  `vWorldPosition`.** They used 8 of the 16 varying slots GLSL ES 3.0 guarantees, and
  the shader was at exactly 16. The instance matrix is a pure translation, so the
  result is identical.
- **The CPU shoreSDF is an 8-ray march over `getWaterAt`**, cached on a 2 m grid and
  cleared on `WaterFieldPass.invalidate`. It runs only for inland water. It
  overestimates by ≤8% between rays, which shifts the fetch peak by ~5%.

### Verified headless (SwiftShader WebGL2, A-Frame 1.7 / three r173, real files)

- **GLSL vs JS WaveMask:** 216 field inputs × 6 cascades × winds 12/3/0 m/s.
  Max difference **1.0e-5**.
- **Water material** (shader regenerated into scratch the same way `create-shader.py`
  does it): compiles and links. Active sampler units **28, same as HEAD**.
- **CSM caster** compiles (9 units). **The tile decode** compiles. A forced-dry texel
  reads RT0 `[-150, 0, 0, 1]`.
- **Field re-layout** on a synthetic 1:10 island: depth and shoreSDF match analytic to
  within half a texel (e.g. x=120: depth 2.057 vs 2.05, SDF 20.50 vs 20.50).
- **End to end:** the height bake with unit displacement per cascade vs
  `level + Σ WaveMask.compute` agrees to **≤ 1.1 cm**. The residual is bilinear at the
  steepest shoreline gradient.

Weights at 12 m/s (C0 … C5), for a feel of what you should see:

| place | C0 | C1 | C2 | C3 | C4 | C5 |
| --- | --- | --- | --- | --- | --- | --- |
| ocean, 20 m | .35 | .70 | .89 | 1 | 1 | 1 |
| ocean, 5 m | .18 | .35 | .48 | .70 | 1 | 1 |
| ocean, 1 m | .08 | .16 | .21 | .31 | .63 | .99 |
| lake, 36 m to shore | 0 | 0 | 0 | 0 | 0 | .54 |
| lake, 400 m to shore | 0 | 0 | 0 | .005 | .54 | .72 |

### Knobs, and the first tuning suspects

- `setWaveMaskEnabled(false)` switches the whole thing off (GPU and CPU), for A/B.
  `probeWaveMask(x, z)` prints the field sample and the six weights.
- **Lakes may read too calm.** The fetch ratio uses the ocean's fixed α = 0.0081 and
  ignores γ. Real young seas have a larger α (JONSWAP α ∝ (gF/U²)^−0.22) and are
  steeper at their peak. That is why every lake whose peak lands inside a cascade gets
  exactly exp(−0.625) ≈ 0.54 there. Adding α(F) is the physical lever.
- **Nearshore may read flat before Phase 3.** TMA is the saturated spectrum. It has no
  shoaling growth and no breakers.
- The fetch proxy calms every lake rim, not only the upwind one.
- There are six more exp/sqrt evaluations per ocean vertex, in the caster too. If the
  frame rate moves, compare it with the masks on and off.

### Browser round 1, 2026-09-12 — three reports

**1. Underwater state (murk, caustics) inside a painted-dry basin, below where
sea level would be. FIXED.** `waterLevelAt` falls back to sea level whenever
`getWaterAt` is null, and null means both "dry" and "not loaded". The new
`WaterTileDecoder.answerAt(x, z)` separates `wet / dry / loading / none`. It
mirrors `sampleTile`'s footprint test on the raw level bytes the decoder already
keeps. The submersion probe forces "not submerged" over a known dry, with a finite
sentinel because the value is also a uniform. The CPU wave-mask field uses the same
answer for its dryMask.

**2. Jagged lake edges, water stopping short of the bank. FIXED.** Fully-dry field
texels stored sea level. Next to a lake at −100 the surface fell 50 m inside one
texel, dove into the bank before the shoreline, and followed the texel staircase.
The compose pass now gives each dry texel the level of the wet texel beside its
jump-flood shore point. The surface runs flat past the shore, and the terrain's
depth test cuts it exactly. Where two bodies meet, the level steps at the midline
between them, under dry ground. It needs the shore field: with
`setShoreFieldEnabled(false)` the old sea-level answer returns. Verified headless on
a synthetic lake + sea: lake-side dry texels read −100, sea-side −150.

**3. A ring of foam specks in the middle of the lake at mid distance. NOT a Phase 2
bug; pre-existing, and not fixed yet.** Diagnosed on the real `lake-ocean.html`
under headless SwiftShader, driven over DevTools Protocol:
- The same speck band exists over the **open ocean**. It sits at mid distance only:
  none near the camera, none far.
- **It persists with `setWaveMaskEnabled(false)`**, so the masks are not causing it.
- Mode 32 (`foamBlend`) shows the specks are foam.
- It is **not** the splash particles (none alive).
- It is **not** the dry or exclusion discard (both neutralised live, specks stay).
- It is **not** terrain showing through (terrain hidden, specks stay white).
- It is **not** NaN (every cascade mip level and the foam ortho are clean).
- With the cascade textures forced to non-mipmapped filtering, the specks cover the
  whole view, near to far. So it is the fold (Jacobian) foam on under-resolved small
  cascades, and mipmapping only suppresses it outside a distance band.
- On the lake at 3 m/s, WaveMask leaves only C5 (weight 0.54), so this band is the
  only foam left to see.

Still unexplained: why the band survives at mid distance, when box-filtered mips
should only ever shrink the finite-difference slopes. Candidate fix, once that is
understood: LOD-aware fold foam, where a cascade's chop derivative stops feeding
`turbulence` once its texels are sub-pixel (normals keep it).

### ⚠ Outstanding — needs Dante

1. **Run `create-shader.py`.** (Done 2026-09-12, committed.) Without the regen, the old generated shader still
   declares the `mat4` varyings and the old sampling, and the new JS would feed it
   uniforms it does not have.
2. **`lake-ocean.html`, with some wind** (it runs at 0, where every weight is moot).
   Check that:
   - the lake is glassy while the coast keeps its swell;
   - swell calms over shallow water near the beach;
   - flipping `setWaveMaskEnabled` shows the difference;
   - no dark shadow band along attenuated shore water (the caster fix);
   - no lake-level sheet at the horizon when hovering over the lake (the skirt fix);
   - no water left in known-dry basins.
3. **The standalone islands demo:** docks and boats keep their water (no dry discard
   there), and the coasts calm.
4. **Floats:** a buoyant object on the lake should sit still, not bob on ocean swell.

---

## Phase 1c — shore distance, authoritative dry, edit invalidation — **written, headless-verified, not yet browser-verified**

2026-09-12, branch `phase-1c-shore-field` off `multi-water-types`. Closes out
Phase 1: the two RT1 channels that had been hard-wired to 0 since 1a, plus the
cache invalidation the plan promised. **No GLSL and no regen.** The water shader
does not read RT1 yet; Phase 3 will be the first consumer.

### What shipped

**`shoreSDF`** (RT1.b): signed distance to the nearest wet/dry boundary in
**metres**, positive over water and negative over land. It comes from a jump flood
over each cascade's *finished* depth (base fill + tile decode):

- The base fill and tile decode now render into one shared scratch MRT, and a
  compose pass writes the cascade. `c.target` keeps its identity, so every texture
  already handed out (water-shader uniforms, a-land's `setWaterField`) stays valid.
- **Seeds are boundary points, not texels.** A texel whose wetness differs from a
  4-neighbour seeds the point half a texel toward that neighbour, which is where
  the shoreline actually is. Both sides seed the same point, so one flood serves
  land and water, and the sign comes from the texel's own wetness. Seeding texel
  centres would make every distance a texel short on one side.
- Seed + 10 flood steps (256…1, plus JFA+1) + compose = 12 fullscreen 512² draws
  per refilled cascade. When a cascade holds no shore at all, the value is
  ±2·halfWidth.

**`dryMask`** (RT1.a), which fixes a real bug. The decode pass used to
`discard` dry footprints, leaving the standalone base fill underneath (sea level +
foam-ortho depth). **Any texel a-land says is dry but whose ground sits below sea
level was flooded by the fallback plane**: Dry Zones, dammed bays, whole known-dry
tiles. A loaded tile is now authoritative, and dry is written:
`level = sea level` (the same value the base fill wrote, so the level blend at a
shoreline is unchanged), `depth = flow = energy = 0`, `dryMask = 1`. Tiles a-land
answers as dry in full (absent from `wetTiles`, or 404) are drawn as a
`uForceDry` quad without fetching. Only tiles still **loading** are skipped, and
`tilesIntersecting` is now clamped to `map.json` `bounds.size`, so the ocean
outside the world stays standalone.

`dryMask` semantics: **1 = the provider says dry; 0 = wet, or no answer yet.**
`depth == 0` is still the discard. `dryMask` is what separates known from guessed.

**Edit invalidation.** a-land's `WorldAuthority` (`core/world-authority.js`)
already fans out `tileInvalidate` for every brush stroke and layer replay. That
*is* the tile-event source contract §3 promised, so there's no polling and no
a-land change. `ocean-grid.js` subscribes when the director is discovered and
forces the terrain ortho (`TerrainOrthoPass.invalidate()`, new) plus the field.
This runs before the ortho tick, so the field refills against a fresh capture,
throttled to 150 ms during a stroke with a trailing refresh 400 ms after the last
event (a-land re-composites the edited height tiles over the next few frames). The
decoder's water-tile cache is deliberately left alone, because baked water tiles
don't change with a brush stroke.

### Findings worth keeping

- **A-Frame 1.7's three has no `textureIndex` on `readRenderTargetPixels`.** It
  only reads COLOR_ATTACHMENT0, so RT1 can only be read back through a copy
  (`_blitMaterial` → `_readTarget`). `probeAt` and `readCascade` both do that.
- **three injects no `pc_fragColor` for `glslVersion: GLSL3`**, so declaring
  `layout(location = 0) out` on a single-attachment material is safe. It was
  checked in the minified bundle before relying on it.
- Each cascade's SDF sees only shores **inside its own footprint**: near a cascade
  rim it overestimates. Consumers must crossfade cascades as `waterFieldLevelAt`
  does, and the survey ignores the outer 40 m.

### Debug surface

`probeWaterField` now prints `shoreSDF / dryMask / type / energy`.
`dumpWaterField` prints the cumulative cascade refill count. New:
`setShoreFieldEnabled(b)` (perf A/B), `showShoreField(cascade, 'sdf'|'dry'|'slope')`
/ `hideShoreField()` (top-right canvas overlay), and **`surveyShore({wind, cascade})`**.
All are documented in `DEBUG_MODES.md` § "WaterField console helpers".

**`surveyShore` exists to answer "is this world too steep for surf?"** It reports
the mean nearshore slope `tanβ = depth / shoreSDF` in 0–5 / 5–20 / 20–40 m bands
and the share of cliff shoreline (>10 m deep within 5 m). It then classifies the
0–15 m band by Iribarren `ξ = tanβ / √(Hs/L0)` into Battjes' spilling / plunging /
surging, and prints the breaker depth (`Hs/0.78`) and surf-zone width at the median
slope. `Hs`/`Tp` use the live spectrum's own formulas, evaluated at the live wind
**and** a reference 12 m/s: `lake-ocean.html` runs at wind 0, where every shore
trivially "surges". A surf zone narrower than 2 texels is flagged, because Phase 3
breakers could not resolve it. ⚠ a-land depth saturates at `simulation.maxDepth`,
so texels at the cap only bound the slope from below, and the survey counts them.

### Verified headless (real WebGL2, SwiftShader, the actual pass files)

A scratch harness built a synthetic 1:10 island (shore radius 100 m) in a fake
foam ortho, then a fake a-land tile pair: one wet tile, and one known-dry tile over
ground *below* sea level.

- All six new shaders compile, with no GL errors or warnings.
- `shoreSDF` is within half a texel of analytic: 150 m out → 50.5, 0.5 m past the
  shore → 0.5, island centre → −98.7, diagonal (180, 180) → 154.9 vs 154.6.
  Coarse cascades agree at their own texel size.
- Survey slope logic: mean `tanβ` over 5–40 m = **0.102** on the 0.1 beach.
- Decode: wet tile → level −140.00, depth 3.99, type 1, dryMask 0. **Known-dry
  tile over below-sea-level ground → depth 0, dryMask 1**, where the old discard
  would have left 5 m of fallback water.
- `installOceanDebugControls` on a stub grid. `surveyShore()` on the 1:10 island:
  slope bands 0.110 / 0.103 / 0.102. At the 12 m/s reference it gives Hs 4.41 m,
  Tp 6.6 s, **95% spilling**, and a surf zone of ~54 m (hand calculation: ξ ≈ 0.39,
  ~56 m). The live near-zero wind prints "calm, no breakers" instead of a
  meaningless classification. All three `showShoreField` modes were rendered and
  inspected. The first isoline test (a modulo window) aliased into a visible axis
  cross, because axis-aligned distances land exactly on k+0.5; it is now a
  neighbour-crossing contour.

### ⚠ Outstanding — needs Dante

1. **Browser check on `lake-ocean.html`**, including the still-unverified 1b.5
   list below. Short version: `showShoreField(0,'sdf')` should hug both the ocean
   coast and the lake rim and not jump while panning; `showShoreField(0,'dry')`;
   paint a stroke at a shoreline and watch the overlay update without moving the
   camera; `testWaterFieldParity()` still agrees on wet points.
2. **`surveyShore()` at a few coasts.** Its numbers decide what comes next: mostly
   plunging/spilling with a surf zone of several metres → Phase 2 then 3; mostly
   surging/cliff → beach-shaping tooling in a-faraway-land first.
3. **Perf while flying:** `dumpWaterField()` refill time with
   `setShoreFieldEnabled(true)` vs `false`. Cascade 0 refills once per metre.

### Browser results, 2026-09-12 (`lake-ocean.html`)

**`showShoreField(0,'sdf')` looks right**: clean contours around the coast, the
channel and the small basin.

**`testWaterFieldParity()` reported 12/15 mismatches, and the bug was in the
test.** The mismatches had `deltaLevel` ≈ 0 and `deltaDepth` 0.05–0.15 m, larger
where the seabed is steeper. `probeAt` point-samples the texel containing
(x, z), whose value was decoded at its *centre*, up to half a texel away. The
test asked `getWaterAt` about (x, z) itself, and on ~30° slopes half a texel is
exactly that much depth. Proven headless against a-land's real
`WaterReader.sampleTile` on a steep, sloping-surface tile over 400 random points:
comparing against the query point differs by up to 0.41 m, and comparing against
the **texel centre is 0.0000 m** in both level and depth. The decode was
byte-exact all along. `compareAgainstLandTerrain` now asks a-land about the texel
centre. (This was latent since 1b and had nothing to do with 1c.)

**Re-run after the fix: 14 points compared, 0 mismatches.**

**The refill timing read 0.00 ms and has been removed.** The browser clamps
`performance.now()` too coarsely to time a few dozen draw submissions. It is now
a refill count; judge the cost by frame rate with the shore field on vs off.

**`surveyShore()` at two coasts near (1770, 2131) and (1833, 2374):**

| band offshore | median slope | p90 |
| --- | --- | --- |
| 0–5 m | 0.24–0.42 (1:4 – 1:2.4) | ~0.6–0.8 |
| 5–20 m | 0.56–0.65 (~30°) | 0.8–0.95 |
| 20–40 m | 0.61–0.64 (~32°) | 0.7 |

No cliff shoreline, but the seabed drops at roughly the angle of repose (~30°)
from a few metres out: the island's above-water slopes simply continue
underwater. Real sandy beaches are 1:10 to 1:50. At the 12 m/s reference sea
(Hs 4.4 m) the shore is **64–78% plunging, 8–13% surging**, with a surf zone of
~10–12 m. At the live 3 m/s (Hs 0.28 m) the surf zone is under a metre, which is
shore-break at the waterline. So the world is **not too steep for surf, but too
steep for long rolling surf**: expect dumping shore-break in a narrow band, not
lines of spilling breakers. Low-p10 slopes (1:25–1:30) exist locally, likely the
channel and basin.

That led to **Phase 3.0 in `WATER-TYPES.md`**: an investigation run into
volume-conserving nearshore dynamics (run-up, backwash, cliff reflection with energy
loss, what shipped games actually do) before Phase 3's breakers get built.

### Carry into Phase 2

- **a-land depth caps at `maxDepth` (50 m here).** Standalone used 1000 m for open
  ocean; inside the world the decode is authoritative and says 50. TMA must not
  read that as a shallow sea (50 m already attenuates swell longer than ~100 m).
  Likely fix: `max(decoded, standalone)` where the decoded depth is at the cap.
- No CPU mirror of `shoreSDF` yet. The first CPU consumer (`_emitShore` in Phase
  3) decides whether it's a readback or a CPU distance transform over tile data.

---

## Phase 1b.5 — the a-faraway-land rendering seam — **written, not yet verified**

2026-09-11, branch `multi-water-types`. Prompted by an underwater screenshot of
`examples/demos/lake-ocean.html`: a choppy mirror of the terrain on the ceiling,
a Fresnel that was clearly not a Fresnel, and reflections of a-land with no
grass or rock in them. Five separate causes, four of them integration gaps.
**Touches both repos** — a-land's changes are on its `multi-water-types` branch (`6db317b`).

### 0. a-land's ocean-fog work only existed in the GENERATED file — fixed first

`u_uwFogOn` appeared 3× in `a-faraway-land/src/js/runtime/shading/shaders.js`
and **0×** in `src/glsl/terrain/terrain.frag`, whose own header says
*"AUTO-GENERATED … Edit the .glsl sources, not this file."* The next
`create-shader.py` run over there would have deleted the entire underwater-fog
integration. Back-ported verbatim and diffed: every line of shader *code*
round-trips exactly. The only differences are the four comment blocks, which
were hand-written as JS comments and are now GLSL comments (the generator quotes
every non-blank source line, comments included) — cosmetic, and correct.

### 1. There was no underwater water without a sky provider — the screenshot

`computeUnderwaterCeiling` and the `underwaterFactor` dispatch both lived inside
`#if($atmospheric_perspective_enabled)`, purely because they were written next to
the sky-radiance helpers. But `ocean-grid.js:616` computes
`atmosphereReady = atmosphericPerspectiveEnabled && atmosphereFunctionsGLSL`, and
that GLSL only ever comes from a-starry-sky — so **every scene without a sky
provider compiled a water shader with no underwater branch at all.** A submerged
camera ran the above-water pipeline, where `cosTheta` (the Schlick dot against a
normal force-flipped upward twice) clamps to 0 on every ceiling fragment, pinning
`fresnelFactor` at its horizon ceiling. `totalLight` became almost purely the SSR
term: a screen-space mirror of the seabed, marched from underneath it. That is
the whole screenshot — the "choppy ground reflection" was the SSR march, and the
"messed up fresnel" was that clamp.

Now: only `applyAtmosphericPerspective` is gated. The ceiling is unconditional,
with a banner over it naming the trap. Verified by preprocessing the shader both
ways — with atmosphere off the ceiling and its call site survive, sky radiance
and AP are gone, and nothing is called that is not defined.

Also here: SSR is skipped outright when submerged (its result was computed and
then discarded on every underwater frame); the Fresnel normal is `faceforward`ed
at the viewer so the term stays meaningful on both sides and debug mode 12 stops
showing a white screen; and the shader's submersion test is now `>= 0.5` to match
the CPU flip in `ocean-grid.js`, which it had disagreed with at exactly 0.5.

### 2. The ortho bakes flattened a-land — no shore foam, no shore splash

`terrain-ortho-pass.js` used `scene.overrideMaterial`, which replaces the VERTEX
stage. a-land's patches share one `[0,1]²` grid at `y = 0` and place themselves
from per-patch uniforms (`CDLODPatch.js:36-44`), so under an override every patch
in the world collapsed onto a single 1 m quad at the origin — thousands of metres
outside the foam ortho's own extent. The foam atlas saw **no a-land terrain at
all**, silently, because a missing capture reads exactly like open water.

The twin machinery the refraction G-buffer invented moved out into
`passes/foreign-terrain-twin.js` (their vertex stage, our fragment stage, the
no-varyings rule, the gl_FragCoord reconstruction prologue, the FIFO-capped
cache, and the "is this foreign terrain" test). Both passes use it now. The ortho
pass swaps per-mesh instead of overriding — everything still gets
`positionPassMaterial`, foreign terrain gets a twin — inside a try/finally,
because the scene is left mutated across the render.

⚠ New file: registered in `make-combined.py`, both `islands.html`, and
`lake-ocean.html`. Both `islands.html` are CRLF and gitignored; line endings were
checked before and after.

### 3. The mirror's clip plane never reached a-land

`reflection-pass.js` cuts above-water geometry out of the TIR mirror with
`renderer.clippingPlanes`, which only reaches materials carrying three's
`clipping_planes` chunks. a-land's terrain shader carries none and sets no
`clipping` flag, so the whole island — above the waterline included — landed in
the mirror RT, which is exactly the artifact that block exists to prevent.

Rather than add the clipping chunks, a-land got a **per-fragment clip against the
water-level FIELD**, because a plane is the wrong shape: a lake at −100 above an
ocean at −150 means one scalar either cuts submerged ocean floor away or leaves
dry lakeside in the mirror. a-water publishes its three WaterField cascades by
reference once a frame (`TerrainMaterial.setWaterField`), a-land samples them with
the same finest-containing-cascade-plus-crossfade rule as `waterFieldLevelAt`, and
`reflection-pass.js` arms the discard for the mirror render only
(`setWaterClipEnabled`, returning the previous state exactly like
`setOceanFogEnabled`). `renderer.clippingPlanes` stays for everything else.

**The `// @inject:` registry was the nicer division and does not work here.** Only
`ObjectMaterial` subscribes to `MaterialExtensions._notify`; terrain materials
splice once at construction, so a sibling that loads after the first patches would
reach only whichever patches the pool later recycled. Noted in both repos; fix that
subscription and the GLSL could move back to a-water's side.

### 4. a-land was a flat tan in the G-buffer — the missing grass and rock

The geometry-only twin has to invent an albedo (`gbAlbedo = (0.5, 0.42, 0.32)`),
because a-land's colour comes out of splat `sampler2DArray` blending inside the
very fragment stage the twin replaces. SSR relights G-buffer hits, so every
above-water reflection of a-land came back flat tan; so did the refracted seabed.

a-land now carries a **surface-capture companion material**, built on exactly the
same terms as its shadow-caster twin (`this.uniforms` by identity, same vertex
source, same defines, same program cache key) with `ALAND_SURFACE_CAPTURE` added.
Under that define `terrain.frag` returns early the moment `albedo` and `N` are
final — before the PBR shading, the CSM lookups, the tone map and the fog — and
writes a plain G-buffer: 0 = linear unlit albedo, 1 = world normal, 2 = linear
view depth (carried exactly from `mvPosition` by a guarded varying, so skirt walls
are right). Exposed as `userData.alandSurfaceCaptureMaterial`, disposed with the
patch, and preferred by `refraction-gbuffer-pass.js` over its own twin whenever
present. The twin stays as the fallback.

### 5. The terrain and the water faded to different colours at infinity

Spotted from a second screenshot, and it turned out to be a third thing entirely
— **a-land is not missing the ocean fog. Its props have it right; only its ground
had a simplified copy.** Three populations, two of which already agreed:

| What | Fogged by | Model |
| --- | --- | --- |
| The water surface | `applyUnderwaterFog` + `underwaterInscatterSurface` | full, linear, pre-tonemap |
| a-land's **props**, the seabed, the curtain, every `MeshStandardMaterial` | a-water's injected `THREE.ShaderChunk.fog_fragment` | full, linear round-trip |
| a-land's **terrain ground** | its own inlined copy | the model minus three terms, in the wrong colour space |

The ground has to inline it — it is GLSL3 and `fog_fragment` writes `gl_FragColor`,
which it cannot `#include`. But the inlined copy diverged four ways:

1. **`murk` was the wrong quantity.** `_uwMurkScratch` is a *parameter*, not a
   colour: the isotropic baseline `albedo·(E_sun+E_sky)/4π` at depth 0, which the
   fog chunk finishes on the GPU with an angular factor, a multiple-scatter floor
   and camera-depth darkening. a-land was handed it labelled "the colour a long
   path asymptotes to" and used it directly. At the demo's Jerlov 1C that is
   **2.2–2.9× too dark before depth darkening even enters**, and the camera-depth
   term alone is another ~0.17–0.43× at 5 m down, ~0.001–0.03× at 20 m.
2. **It composited in display space against a linear constant.** The block runs
   after `linearToOutputTexel`, so a linear murk of 0.02 was written raw into an
   sRGB-encoded buffer — displaying at 0.02 where it should display at 0.152,
   another **7.6×**. a-land's own `ALAND_STARRY_FOG` branch two lines below
   already does the correct decode → composite → filmic → encode round-trip; the
   ocean branch simply never did.
3. **No tone map.** The chunk grades the fogged result through the same Narkowicz
   ACES fit the water surface and a-starry-sky use. Terrain that grades
   differently from the water it stands in is a seam at every shoreline.
4. **No mirror-pass path split.** In the planar mirror the camera is above water
   and its straight line to a fragment IS the bounce path, so only the
   post-bounce leg belongs to the terrain — the water shader fogs the rest. a-land
   fogged the whole length, double-counting the pre-bounce leg.

Fixed on both sides, keeping the division intact. a-water now evaluates the
chunk's own `uwMurk` on the CPU — `baseline · ((2 − sunFrac) + uwMsRatio) ·
exp(−ext·camDepth)` — and hands over that. ⚠ The one term that cannot be
reproduced CPU-side is the HG gaze factor, which is per-fragment; it is exact only
because `UW_MURK_GAZE_WEIGHT` is `0.0` in both shaders, collapsing `uwAngFactor` to
the view-independent `2 − sunFrac`. **Raising that constant breaks this** and the
sibling would need the sun direction too; noted at both ends.

a-land gained the round-trip (with *private* copies of the three grading helpers —
the ocean branch is a runtime test on a uniform, so unlike the `ALAND_STARRY_FOG`
branch its code compiles in scenes with three's stock fog chunk and no ocean at
all, where borrowing `fogsRGBToLinear` would be a link failure), the path split,
and a third typed setter `setOceanFogLinearOutput(on)` — the mirror RT is linear
HalfFloat and must skip the grade, which is the typed twin of the `fogFar > 5.0`
flag our own chunk reads out of the smuggle.

### 6. The water reflected a black sky — "flat reflections"

Reported as reflections that stay a perfect mirror instead of bending with the
wave vertices. The ray direction was never the problem: `ssrReflectDir` comes off
`macroNormal`, which is cascade-0 slope with no distance fade, and is fine.

**The thing being sampled was constant.** `screenSpaceReflection`'s miss path has
two branches and both need a sky provider. With atmospheric perspective on it
calls `computeSkyRadiance` (a-starry-sky's LUTs); with it off it samples
`meteringSurveyTexture` — which `ocean-grid.js:1641` only ever assigns from
`self.skyDirector`. No sky provider, no assignment, and an unbound `sampler2D` is
not an error in GL: three binds a default empty texture and every fetch returns
black. So every SSR ray that missed geometry returned **the same black**
regardless of `reflectDir`, which is exactly a mirror with no directional
information in it. It also explains the far field reading dark navy under a pale
blue sky — at grazing angles Fresnel weights that black reflection to ~1.

The same shape of bug as item 1, one file over: a feature that silently needs
a-starry-sky and degrades to a plausible-looking wrong answer without it.

Fixed by giving the standalone path a sky worth reflecting —
`computeStandaloneSkyRadiance`, built from the lights a-water already reads
(`skyAmbientColor` as the hemispheric mean, spread into a horizon→zenith gradient
weighted toward the horizon where a water reflection actually looks, plus a tight
sun lobe so the glint lands). Crude beside a real atmosphere; the point is that it
**varies with direction**. A new `meteringSurveyValid` uniform keeps the real
metering survey preferred whenever a provider bound one, so the
a-starry-sky-present-but-AP-off path is unchanged.

### 6b. Two follow-ons from item 6, one of them self-inflicted

**The sun disk I added to the standalone sky was wrong twice over — removed.**
The water's sun reflection is already produced, by the Crest-style Phong lobe
(`specular = brightestDirectionalLight * pow(specRdotL, specFallOff)`), which
composites *alongside* the SSR reflection rather than through it. A disk inside
`computeStandaloneSkyRadiance` was therefore a second, double-counted sun — and a
second sun of the wrong shape, because that function is evaluated on a direction
reflected off the SMOOTH normal. It rendered as one round mirror blob sitting on
top of the real ripple-broken glitter path. Exactly what a screenshot of the sun
track showed. The comment left behind says why nothing belongs there.

**The sky reflection only ever tracked the long swell.** `ssrReflectDir` is
`reflect(viewDir, macroNormal)`, and macroNormal is cascade-0-only — the big
smooth swell. That is right for the *raymarch*: per-pixel normal jitter makes
neighbouring fragments march into different depth footprints and the geometry
reflection breaks into noise, which is why it was put there. It is wrong for the
*sky miss*, where sub-metre ripple detail is the entire reason a sea surface
glitters instead of mirroring. One direction was serving both.

`screenSpaceReflection` now takes `marchDir` and `skyDir` separately. The march
keeps macroNormal; the sky samples along a reflection off
`mix(macroNormal, displacedNormal, ssrSkyNormalBlend)`, default 1.0, live-tunable
via `window.setSsrSkyNormalBlend` so 0 reproduces the old behaviour exactly for an
A/B. ⚠ If the far field sparkles, the cure is `specNormal` — whose cascade-5
wide-eps low-pass exists precisely to stop that — not a lower blend. It is not
used today only because it is built further down `main()` than the SSR call.

### 6c. The other half of 6b — the MARCH normal

Reported as a reflected silhouette that stays rigid while the water under it
ripples, with the guess that SSR was working off the flat pre-displacement plane.
Checked that first and it is not: `vDisplacedPosition = offsetPosition` in
`water-vertex.glsl:148`, after all six cascades have been added, so the SSR ray's
ORIGIN carries the full displacement. (Nor is it the horizon skirt — the skirt
runs the same displaced `offsetPosition` and only pins `clipPos.z`.)

The instinct was right about the effect though, and 6b only fixed half of it. That
change split `screenSpaceReflection` into `marchDir` and `skyDir` and moved the
SKY onto the detailed normal, but deliberately left the MARCH on `macroNormal` —
quoting the original "avoids high-frequency per-pixel noise" comment. The march is
exactly what decides where a reflected *shoreline* ends, so the half left behind
was the half governing the reported symptom.

`ssrMarchNormalBlend` now mirrors `ssrSkyNormalBlend`; both default to 1.0.
They are separate knobs on purpose — the failure modes are opposite. Too much
detail in the march scatters neighbouring fragments into different depth
footprints (the noise the original comment guarded against, written before the
blue-noise step jitter and the soft convergence/silhouette gates existed); too
little in either is the flat-mirror look. **Setting both to 0 reproduces the
pre-2026-09-11 reflection exactly.**

### 7. Shoreline foam — diagnosed: the capture works, the scene has no wind

**Resolved by mode 29: green, never cyan.** So item 2 did land — a-land's terrain
reaches the foam atlas, the shore is found, and `shoreProximity` is correct. What
is zero is the DRIVE term, and the reason is the scene, not the code:

`lake-ocean.html` sets `<ocean-wind-x>0</ocean-wind-x>` / `<ocean-wind-y>0</ocean-wind-y>`.
`ocean-grid.js:140-141` clamps that to 0.01 per axis (a guard against a degenerate
spectrum), so the effective wind speed is ~0.014 m/s. `foamWindStart` is **10 m/s**,
so `foamWindBias` is 0, and `fftFoamAmount = clamp((turbulence - 0.5) * 4, 0, 1)`
needs `turbulence > 0.5` — a hard fold — to produce anything. The shore drive,
`turbulence * 2.5 + fftFoamAmount * 0.5`, collapses to `turbulence * 2.5` on a sea
with no energy in it. No wind, no breaking, no foam. Working as written.

Note the shore term fires EARLIER than open-water whitecaps by design (×2.5 on
turbulence against a 0.5 threshold), so any real wind should show shore foam before
the open sea starts capping.

Two things follow that are worth not confusing with a bug:

- **The white specks on the open water in these screenshots are specular glint, not
  foam.** At this wind `fftFoamAmount` is ~0 everywhere.
- **There is no swash/run-up foam in the model at all.** Shore foam is keyed
  entirely to wave-breaking — deliberately, per the comment at the block: *"gated
  by wave action, not a static shallow-water belt"*. A real beach foams on a calm
  day from run-up; this will not. That is Phase 3 ("shorelines that break")
  territory, not a defect in what exists.

Debug mode 29 stays — it is what settled this, and it will settle the next one.

### 7b. The mode-29 instrument (kept)

Item 2 was supposed to fix this and evidently did not, or not fully. The chain has
two independent halves that fail identically from the outside — the ortho CAPTURE
(did the terrain reach the atlas?) and the wave-action DRIVE
(`turbulence*2.5 + fftFoamAmount*0.5`, and this demo runs at wind 0) — and every
static check on the capture half passes: the twin writes `vec4(worldPos, 1.0)` so
`.g` is world Y and `.a` is 1 exactly as `positionPassMaterial` did, the RT clears
to alpha 0, a-land's patches are `frustumCulled = false` on layer 0, and the
gl_FragCoord unprojection is correct for an orthographic camera (its inverse
projection is affine, so the w-divide is a no-op).

Guessing further without running it would be inventing a cause. **Debug mode 29**
was added instead: it renders the gate itself, so one screenshot says which half
is at fault — red at a visible shoreline is capture, green-without-blue is drive.
See `DEBUG_MODES.md`.

One known real limitation is already logged below under "Found while wiring this":
the foam ortho's near plane sits at `heightOffset + foam_camera_height`, so in
this demo it cannot see anything above y = −120 — the ocean shore at −150 is
inside that window, but the lake shore at −100 is not.

### Also

- `camera.layers.enable(OCEAN_LAYER)` was constructor-only while the tick
  re-reads `sceneEl.camera` every frame — a camera swap (VR, a late `<a-camera>`,
  look-controls rebuilding the rig) left the new camera blind to the ocean.
- `_isExternalTerrain`'s ancestry test caught everything under
  `<a-land-terrain>`'s `object3D`, `ObjectInstancer`'s prop group included. The
  marker test now comes first and the ancestry test is documented as the broader
  fallback.
- Debug mode 35's TIR threshold was `< 0.25` where production uses `< 0.0001`;
  they disagreed at the window rim, which is the one place the mode is consulted.
- New modes **27** (`underwaterFactor` as a continuous ramp — there was no way to
  see the value, only the binary) and **28** (the ceiling normal `-displacedNormal`,
  which mode 18 can never show). `DEBUG_MODES.md` updated.

### ⚠ Outstanding — needs Dante

1. **`create-shader.py` in BOTH repos.** a-water: `water-shader.glsl`. a-land:
   `terrain.vert` + `terrain.frag`. Neither generated file has been touched here.
   Pre-flighted by simulating both generators into a scratch file: both outputs
   parse as JS, both shaders stay `#if`/`#endif` balanced, and a-water's
   round-trips to byte-identical GLSL ignoring blank lines.
2. **Browser verification** — nothing here has been run. The per-phase checks are
   in the plan file; the short version is in § Verification below.
3. **`ocean-grid.js:1048` ships `side = BackSide` underwater under a comment that
   documents `DoubleSide` and records `BackSide` as the value that "turned the
   ceiling invisible from below".** One of the two is stale. Deliberately not
   touched — this needs whoever remembers which way round it went.

### Found while wiring this, deliberately NOT fixed

**The foam ortho's vertical window is still anchored to the one flat
`heightOffset`, so the lake gets no shore foam even now.** Both ortho cameras sit
at `heightOffset + foam_camera_height` with `near = 0.1`
(`terrain-ortho-pass.js:118`). In `lake-ocean.html` that is y = −120 looking down,
so the atlas captures y ∈ [−120, −650]: the ocean shore at −150 is inside it and
will now appear (it never did before item 2), but the lake shore at −100 sits
*above the near plane* and is still invisible to it.

This is not an a-land problem and item 2 does not claim to fix it — it is exactly
the assumption WATER-TYPES.md § "Single-ocean assumptions that must break" lists:
`heightOffset` is one scalar consumed by both ortho cameras. Fixing it means
deciding what a per-body ortho even means (one atlas per body? a camera that
follows the local field?), which is Phase 2's call, not a side effect of this one.

### Verification

On `examples/demos/lake-ocean.html`, served over http:

- **Dive.** The ceiling must be a Snell window with a TIR ring, not a mirror of
  the ground. Walk `setOceanShadowDebug(50 … 55)`. Mode 12 must stop being white.
  Mode 27 should ramp cleanly through the waterline; mode 28 should be mode 18's
  negative.
- **Mode 50** (raw mirror RT) must show only submerged terrain. Swim lake → ocean
  across the ridge and check neither body's clip cuts into the other's floor.
- **Surface, look at a shoreline.** The foam ring must appear around a-land's
  coast — it never has. `compareWaterField(x, z)` / `testWaterFieldParity()` must
  still agree with `getWaterAt`. Rotate on the spot: the snap gate must still
  suppress re-renders.
- **Reflections above water** must show grass and rock, not flat tan. Mode 11 too.
- **Regressions.** `terrain-provider="standalone"` (or remove `<a-land-terrain>`)
  → the ocean renders exactly as before, a flat plane at `ocean-height-offset`.
  Then the same dive on `examples/personal-ocean/islands.html`, which *has*
  a-starry-sky, to prove the atmosphere-on path is unchanged.

---

## Phase 1a — the WaterField seam — **landed**

Branch `phase-1-water-field`, 2026-09-07. Nine commits. **No visual change by
design** — that is the acceptance criterion, not a shortcoming.

### What shipped

`passes/water-field-pass.js` — three world-anchored, camera-following cascades
(256 / 1024 / 4096 m half-width at 512², **FloatType** MRT ×2):

    RT0: level  depth  flow.x  flow.z
    RT1: energy type   shoreSDF dryMask

Each snaps to its own texel grid (1 / 4 / 16 m) and re-fills only when that
snapped centre moves, so the coarse rings are skipped almost every frame.

The fill is **standalone-only**: `level = height_offset`, `depth` from the
existing foam ortho, `flow`/`energy` = 0. Exactly the 0.2.0 answers, which is
what lets the seam be cut with zero visual diff before any a-land data exists.

### The seam

Consumers no longer read `height_offset`. They ask:

- **CPU** — `oceanGrid.waterLevelAt(x, z)` / `waterDepthAt(x, z)`
- **CPU twin** — `OceanWaveField.levelAt(x, z)` via an injected `levelProvider`
- **GPU** — `waterFieldLevelAt(worldXZ, distanceToFragment)` in `water-shader.glsl`

Routed: clipmap tile placement, horizon skirt, both ortho cameras, CSM pivot,
reflection mirror plane, submersion probe, height-field bake, the analytic
Gerstner twin, three `ocean-splash.js` sites, and the fragment shader's
wave-height-above-rest plus two debug references.

Phase 1b replaces two function **bodies**. No call site moves again.

### Findings worth keeping

- **The vertex shader never referenced the rest level.** Clipmap tile Y comes
  from the instance matrix, which the CPU seam already covers. So the GPU seam
  is fragment-only — no GLSL forked across two files, which is the mistake
  `horizon-skirt.glsl` stands as the example of.
- **`distanceToFragment` is taken now, unused, on purpose.** Clipmap cells double
  per ring (0.25 m at ring 0, 100 m+ at the outer rings) and the test lake is only
  ~72 m across. Without distance-based cascade selection, one far vertex landing
  inside a small lake drags a whole cell to lake level — a 50 m spike on a
  triangle wider than the lake. 1b fills in the body; the call sites are ready.
- **Half-float is wrong for `level`.** It is an absolute world Y and a-land worlds
  span thousands of metres; near 4000 m a half-float step is ~4 m. FloatType.
- ⚠️ **`readRenderTargetPixelsAsync` collides with itself.** The app already runs
  three async readbacks (height field, submersion probe, splash terrain) and the
  browser says so — `readPixels: PIXEL_PACK_BUFFER must be null`, 24+ times a
  session. A fourth overlapping read returns stale buffer contents. The field
  probe is therefore **synchronous**. This is PRE-EXISTING and unreviewed: it may
  be producing occasional wrong buoyancy samples or a mistimed air/water swap
  today. Deferred by agreement, not dismissed.

### Debug surface

`probeWaterField(x, z)`, `scanWaterField(radius, n)`, `dumpWaterField()`,
`testWaterField()`. The field is invisible at this step, so these are how it gets
verified at all. `testWaterField()` — a known-constant round trip through the MRT
— is what isolated the PBO collision from a suspected fill bug.

### Next: Phase 1b

`terrain-provider` prop, decode a-land's three tile stacks into the cascades, CPU
mirror via `land-terrain.api.getWaterAt`, GPU-vs-CPU parity check. Acceptance is
one observation: the lake at **-100** sitting 50 m above the ocean at **-150**.

⚠️ `height_offset` here is 6 but `simple-islands`' `seaLevel` is **-150**. When
the bridge lands the water plane will jump — that is correct, not a regression.

---

## Phase 0 — Decompose `ocean-grid.js` — **landed**

Branch `phase-0-decompose-ocean-grid`, 2026-09-07. Ten commits, two logical
halves: **A** the extraction (pure refactor, zero visual diff intended), **B**
the two second-body prerequisites.

`ocean-grid.js` **3497 → 1712 lines (−51%)**, into eight new modules under
`src/js/ocean-system/passes/` totalling 2546 lines.

### Where everything went

Line ranges are the **0.2.0** `ocean-grid.js`, so older references in
`WATER-TYPES.md` and in commit messages stay chaseable.

| 0.2.0 `ocean-grid.js` lines | Now lives in |
| --- | --- |
| 231-252, 698-785, 2623-2671 | `passes/refraction-gbuffer-pass.js` |
| 254-295, 1772-2060, 2577-2584, 2678-2681, 2905-2908 | `passes/reflection-pass.js` |
| 297-473, 513, 2062-2185 | `passes/caustic-projection-pass.js` |
| 609-688, 2187-2493, 2495-2519 | `passes/underwater-fog-chunk.js` |
| 787-838, 911-919, 2683-2782 | `passes/terrain-ortho-pass.js` |
| 921-930, 1106-1108, 3344-3381 | `passes/ocean-shadow-pass.js` |
| 1151-1380, 2798-2874 | `passes/height-readback-pass.js` |
| 1436-1735 | `passes/ocean-debug-controls.js` |

Load order in all three registries is `passes/*` **before** `ocean-grid.js`.

### The pass contract

`ARestlessOcean.Passes.<Name>` — constructor takes `oceanGrid` and stores refs
only; `init()` builds GPU resources; `resize(w, h)`; `tick(ctx)` with a flat
options object; `dispose()`.

Two deliberate departures from the existing `OceanShadowCSM` / `OceanSplash`
house pattern:

- **Resources are built in `init()`, not the constructor.** Phase 1's
  `WaterField` will need passes constructed before the field exists.
- **`dispose()` is new.** Nothing in 0.2.0 disposed anything. Nothing calls it
  yet either — it is there for Phase 1's cache invalidation.

Every pass is constructed behind an `if(ARestlessOcean.Passes && …) else null`
guard, matching how `OceanShadowCSM` and `OceanSplash` already degrade. Back-compat
aliases (`oceanGrid.refractionGBufferTarget`, `.foamRenderMap`, `.exclusionMap`,
`.causticSpotLight`, `.oceanShadowCSM`, `._reflectionTarget`, …) all still point at
the pass-owned objects, so the per-instance uniform upload loop, `ocean-splash.js`
and `ocean-shadow-csm.js` needed no edits at all.

New helper: **`OceanGrid.forEachOceanMesh(cb)`** — iterates every clipmap ring
InstancedMesh plus the horizon skirt. The one sanctioned way to reach the water
materials from outside the constructor, so the instance map and key list stay
closure-private. The six passes Phase 1+ adds get it for free.

### Deviations from the plan, and why

- **Foam ortho and exclusion ortho are ONE module, not two.** They share the
  override material, the saved render-target/clear-alpha, the `scene.background
  = null` enter/exit dance whose exact ordering fixed two shipped bugs, and the
  stale-frame snap gate. Splitting them means duplicating that state dance or
  inventing a third coordinator. Phase 1's WaterField will likely subsume the
  foam half anyway.
- **`underwater-fog-chunk.js` and `ocean-debug-controls.js` were not in the
  plan's list.** Added because they were the two largest self-contained blocks
  left (~380 and ~300 lines) and both carry near-zero per-frame risk.
- **The reflection pass reads grid state directly rather than through `ctx`.**
  The plan proposed threading its eight underwater-murk inputs through `ctx`.
  Reading them off the grid is the transformation with zero semantic risk, and
  the values genuinely live on the grid. The intent — making the one-frame lag
  un-"fixable" by accident — is served by a prominent header note instead.
- **The B2 GLSL substitution went into `water-shader-template.txt`, not
  `ocean-grid.js`.** Better than planned: both fragment-shader build sites (the
  initial material and the one-shot atmospheric-perspective recompile) already
  route through `fragmentShader()`, so there is no second call site to forget.
- **No `pass-base.js`.** Redundant once `Passes: {}` is declared in
  `ARestlessOcean.js` and each module also self-creates it defensively.

### Dead code removed

All verified unreferenced across `src/` and both examples first:
`refractionClipPlane`, `foamClipPlane`, `raycaster` (constructed with an
**undefined** `this.downVector` — it never worked), `cameraFrustum`,
`oceanPatchIsInFrustrum`, `numberOfOceanHeightBands`, `underwaterFogBrightness`
(the 0.35 isotropic fudge, dead since the physical HG inscatter landed),
`dataPatchSize`, `numberOfPatches`.

### Latent traps fixed on the way past

- The caustic projector and the underwater murk block **shared one scratch
  `Vector3`** (`_uwSunDirScratch`). Both fully overwrite before reading and
  neither reads across, so it worked — but it was one edit away from not
  working. The pass owns its own scratch now.
- `positionPassMaterial.uniforms` aliased the module global and was **never
  cloned anywhere**. Fixed in B1.

### Commit B — the second-body prerequisites

Both are **no-ops for the current single ocean**, deliberately, so they could
land without a visual-diff argument.

**`ARestlessOcean.cloneUniforms()`.** `THREE.UniformsUtils.clone` deep-clones
Vector/Color/Matrix/Texture values but only `.slice()`s a plain **array** — so
every "cloned" water material shared one set of `Vector2`s with the module-global
template (`cascadeSpatialOffsets`, 6 of them; `oceanShadowMapSize`, 4). The new
factory adds a deep pass over array values whose elements are clonable objects.
Arrays of primitives (`cascadePatchSizes`) and of textures
(`cascadeDisplacementTextures`) stay a plain slice on purpose — they are
wholesale-reassigned each frame and `ocean-shadow-csm.js:276` deliberately
aliases them.

Zero visual diff verified by checking what actually writes these: **nothing
writes `cascadeSpatialOffsets` at all** (static per-cascade constants), and
`oceanShadowMapSize` is written per-mesh with the same per-cascade value.

**Ortho half-widths hoisted.** Nine bare literals across five files, two inside
GLSL, with comments in `ocean-grid.js` admitting they were kept in sync by hand.
Now `TerrainOrthoPass.FOAM_ORTHO_HALF_WIDTH` / `EXCLUSION_ORTHO_HALF_WIDTH` are
the single source, feeding both `OrthographicCamera` extents, both texel
derivations, the splash terrain-readback argument, and two GLSL `const`s spliced
in at material-build time. Consts rather than uniforms: per-session values, and
uniform slots are scarce in this shader.

### ⚠️ Outstanding — needs Dante

1. ~~`create-shader.py` re-run~~ — **done**. A `create-shader.py` watcher was
   already running and regenerated `water-shader.js` from the B2 edits on its
   own. Verified: the emitted GLSL substitutes to exactly `2048.0` / `250.0`
   (the old hardcoded values, so no behavioural change), no `$token` is left
   unsubstituted, and the min-build GLSL strip keeps both const declarations,
   both usage sites and the `ATMOSPHERE_FUNCTIONS_INJECTION_POINT` marker.
2. **Browser verification.** There is no test suite; this is the only real check.
   Per-pass, on `examples/personal-ocean/islands.html`:

   | Pass | What breaks if it is wrong |
   | --- | --- |
   | Caustics | Dive under — caustic god-light on the seabed |
   | Refraction MRT | Seabed visible through the water, not flat sky-coloured; debug modes for albedo / world-normal / linear-depth |
   | Terrain ortho | Shore foam ring around the islands; boat interior stays dry; **rotate on the spot** — the snap gate must suppress re-renders |
   | Height readback | Boat floats (`buoyant`); splash shore emission fires |
   | Reflection | Dive under and look **up** — Snell window, TIR ceiling, no black void; then surface; cross the waterline both ways |
   | CSM | Wave self-shadow; `window.setShadowHelpers(true)` still draws cascades; sun near horizon |
   | Fog chunk | Underwater fog on seabed and curtain; **first dip has no stall** |
   | Debug controls | `window.setOceanShadowDebug(1)`, `window.oceanGrid`, `window.oceanSplash` all still resolve |

   Plus sunrise → noon → sunset (the AP recompile is one-shot and easy to
   strand), and a walk from open water to shore to underwater and back.
3. **Regenerate `dist/`** when convenient — `make-combined.py` from
   `src/python/`, then hand-copy the `v0.2.0` pair over the `master` pair, which
   the script does not produce.

### What was verified, and how

No test suite exists, so verification was static and structural:

- **Sorted-line multiset diff** over all of `src/js` before and after every
  extraction. A pure move changes position, not content, so anything in that
  diff beyond deliberate renames is code that was dropped or mangled.
- **Statement-level diffs** with receiver prefixes normalised, for the risky
  bodies: underwater reflection 78 statements, above-water transmission 44, the
  fog scaffold 58, the fog injection 107, the sun-dir broadcast 16, the CSM
  render block 23 — all identical, same order.
- **Call-site counts** for `renderer.clear/render`, `setRenderTarget`,
  `setClearAlpha/Color`, `overrideMaterial`, `NearestFilter`, `FloatType`,
  `DoubleSide`, `layers.set(30)` — identical before and after.
- **Dangling-field scan**: `self.`/`this.` fields read but never assigned. Zero
  after the refactor; before, it correctly reported `downVector` (the dead
  raycaster).
- **DEBUG-strip simulation** on `ocean-debug-controls.js`: 314 → 224 lines, still
  parses, all 30 `window.*` handles gone, all 22 setters retained.
- **Registration parity**: the `passes/*.js` list in `make-combined.py` and both
  `islands.html` files matches the filesystem exactly, and all three load the
  passes before `ocean-grid.js`.
- Every one of the 40 files under `src/js` parses.

### Traps for whoever works here next

- ⚠️ **`ocean-grid.js` and both `islands.html` are CRLF.** A naive text-mode
  read/write round-trip flattens them to LF and rewrites every line, destroying
  the diff. This bit once during Phase 0. Preserve the endings.
- ⚠️ **Both `islands.html` are gitignored and untracked.** Edits there never show
  in `git status` and are **not recoverable from git**. Back them up before
  touching them. They are also one of the three places a new source file must be
  registered — the other two are `make-combined.py` and the other `islands.html`.
- ⚠️ **A forgotten script tag fails silently.** Every pass is guarded, so a
  missing file degrades the visuals rather than throwing.
- ⚠️ **Never write the literal DEBUG marker tokens in prose.** `make-combined.py`
  matches them with a non-greedy DOTALL regex per file; a mention in a comment
  creates a spurious match.

### Deferred, ranked

1. **The per-instance uniform upload loop** (0.2.0 `:3132-3330`, ~200 lines) is
   still in `ocean-grid.js`. Left there on purpose: it is the integration point
   every pass feeds and where Phase 1's WaterField uniforms will land. Next
   candidate once WaterField's shape is known.
2. **The clipmap construction block** is now the largest remaining chunk.
3. **`dispose()` is implemented but never called.** Wire it up when Phase 1
   needs cache invalidation.
4. **The fit-to-boat exclusion ortho** is now unblocked — B2 removed the reason
   it was deferred. A tighter extent buys sub-decimetre texels at the same
   16 MB and kills the residual keel-crease tris.

## Waterfall impact particles, step 1: volumetric mist

The falls' mist (OceanSplash type 2) is replaced by a raymarched volume, `WaterfallMistPass`
(`passes/waterfall-mist-pass.js`, `waterfall-mist.glsl`). The type-3 splash clumps and all other
spray are unchanged; the next step is flow-aligned water chunks to replace them on the falls.

- **Volume (round 2).** `WaterfallMistHull` (`luts/waterfall-mist-hull.js`, pure math) builds a CONE
  per few strands and per free-fall run: a closed round tube along the water's own path, narrow at
  the lip, opening downward (landing radius ~0.18 x the drop, so a tall fall opens wider), running
  on over the pool past the landing. Neighbouring cones overlap and merge. The pass rides the sheet
  pass's cascades (`geometryVersion`). Round 1 thickened the ribbon along its own normal instead;
  that frame twisted with the weave and the hull's walls (and a floor clamp) showed as flat sheets of
  mist in the real scene. A tube's density is a function of the distance to its AXIS over its radius,
  so it is zero on the wall by construction: the facets are tangent to the radius the shader uses
  (circumscribed polygon), and `mist-hull-test.mjs` checks "no wall leak".
- **Shader.** Each pixel is where its view ray leaves a cone; it marches back toward the camera over
  the exact cylinder chord. `u` (0 lip, 1 landing, 1..2 run-out) is measured per sample: FOAM in the
  middle of the fall (dense, bright, round lumps stretched along the flow, rushing down), HAZE toward
  the landing and over the pool (thin, soft, big puffs), fading in below the lip and out over the
  run-out. The noise is laid out in the water's TIME OF FLIGHT along the flow (each cone ring carries
  the traced row's tau and speed; the run-out slows) and in metres across it, periodic in time, so it
  RIDES THE WATER at its real speed and its cells stretch as the jet accelerates, like the sheet's
  grain. (Round 2 first advected it at a constant 6 m/s and cross-faded two copies half a period
  apart: the foam ran slower than the sheet behind it, and visibly stalled and re-accelerated at
  each swap.) `mist-hull-test.mjs` checks d(arc)/d(tau) = the water's speed. Lit by a short sun
  light-march (self-shadowing), dual-lobe Henyey-Greenstein phase, the scene sun shadow map and the
  sky ambient; sun/sky/shadow/depth/atmosphere are the creek's own uniform objects (`SHARED_UNIFORMS`).
- **No depth test.** The cones straddle the curtain, whose depth would hide the near half of the
  mist. Occlusion is analytic instead: the G-buffer clips the march (terrain), samples behind the
  curtain are dimmed inside its width (`uSheetOcclusion`); nothing is drawn below the landing's
  height (`uGroundFade`), so the cones may dip under the pool without a floor clamp.
- **Knobs.** `oceanSplash.fallMistVolumetric = false` brings the old puffs back.
  `waterfallMistPass.material.uniforms.u*` (foam/haze density, scale, stretch, erode, haze start,
  steps, ...) and `hullOptions` + `rebuild()` are live; `uDebugMode` 1-7 shows opacity, u, chord, the
  cones, path length, the foam/haze/ground weights and the density at the wall (must be 0 everywhere).
- **The foot (round 3).** The cones now END at the landing and the foam fades out smoothly toward it
  (`uFadeOutStart` 0.75 .. `uFadeOutEnd` 1): the hard chop where the cones ended is gone. The haze that
  rolled out over the pool (`WaterfallMistHull` option `runOut: 1`, with `uFadeOutEnd` ~1.8) is off by
  default, and while the volumetric mist is drawing the old type-3 splash clumps (the white footballs)
  are not emitted on the falls (`oceanSplash.fallSplashWithVolumetric = true` brings them back). Both
  are placeholders until the impact particles (step 2) are rebuilt.
- **Scaling with the fall (round 4).** One cone per ~1 m of width (a cone for every other 0.5 m strand;
  the stride grows so a very wide fall gets at most ~24 cones: `maxCones`). The count does not depend on
  height or discharge. A cone's landing radius is 0.18 x the drop, but never less than 1.4 x the gap
  between neighbouring cones (`radiusPerSpacing`), so cones always overlap into one body of foam; a short
  fall's cones open fast (`radiusExponentShort` 0.55, blending to 0.85 as the landing radius goes from 1.5
  to 4.5 m), since they were thin separate wisps that only merged where the foam was already fading. The
  foam lump size follows the fall (`uScaleRef` 10 m, sqrt, 0.5 .. 1.6 x) and the density floor at low
  aeration is higher (`uMinBody` 0.55, `uAerationHi` 0.55), as short falls aerate less (a 3 m fall peaks
  near 0.43, a 10 m one near 0.85).
- **Pages that load loose `src/` files** (the examples) need three more script tags: `materials/
  ocean-material/waterfall-mist.js`, `luts/waterfall-mist-hull.js`, `passes/waterfall-mist-pass.js`
  (the grid skips the pass silently if any is missing, and the old puffs keep drawing).
- **Checked.** `node tests/waterfall-mist/mist-hull-test.mjs` (closed, outward, no wall leak, opens
  downward and wider for a taller fall, ledge stairs). The shader was compiled, with and without
  atmospheric perspective, and rendered in headless Chromium against synthetic 10 m and 30 m falls
  with a stand-in sheet. NOT yet checked on a real a-land world, on a GPU, or at frame rate: the
  step counts (24 view, 3 sun) are tunables for that.

## Waterfall impact particles, step 2: splash bursts at the foot

The first of the foot particles: `WaterfallSplashPass` (`passes/waterfall-splash-pass.js`,
`waterfall-splash.glsl`), raymarched like the mist, renderOrder 9 (mist 8, spray 10). At every
touchdown the trace recorded (each ledge and the plunge) a burst of spray is thrown up, rises against
drag, falls back, and fires again. The old type-3 clumps stay off while the volume draws.

- **The model** (`luts/waterfall-splash-hull.js`, its header has the maths). Not a Gaussian ball:
  what a Gaussian IMPACT throws up. The water landing is `exp(-xi^2 / b^2)` across a blob's
  footprint; launch speed goes as the square root of the impact pressure, so
  `v0(xi) = v0c exp(-xi^2 / 2 b^2)`, `v0c = 0.35 x` the normal speed lost. The middle is the heaviest
  and the fastest. Each drop then flies under gravity and quadratic drag (terminal speed 4 m/s, a
  ~1 mm drop), which has a closed form for the rise, the apex `H = (vt^2 / 2g) ln(1 + v0^2 / vt^2)`
  and the fall back. The top of a burst is that flight evaluated per launch ring: at the apex a
  gentle splash is exactly the `exp(-xi^2 / b^2)` bell, a hard one the same bell flattened by drag;
  the sides land first, so the burst shrinks to its middle. Drag is the cap (no launch clamp).
- **The pulse.** The next burst fires when the last has landed: period = the middle's life x 1.15.
  3 m fall: 0.33 m high, 0.52 s. 10 m: 0.76 m, 0.79 s. 30 m: 1.40 m, 1.08 s. Each burst's launch
  speed (0.6..1 of the blob's) and middle are hashed from its index; neighbours are out of phase.
- **The vanish.** Fall height (from the landing speed) against the trace's own breakup length per
  strand (`Lb = 6 q^0.32`): full up to `mistLo` 3 lengths, gone by `mistHi` 8. FUDGE multiples of a
  physical length. Test falls (q 0.83): 10 m full, 30 m at 0.53, a thin 90 m one builds nothing.
- **Blobs.** One per touchdown on every other strand (stride grows past `maxBlobs` 24), `b` = 0.6 x
  the gap between them (at least 0.3 m). The proxy is an icosahedron round a sphere; the shader
  intersects the exact sphere, then clips the chord to the slab between the water and the burst's
  current top, and the density has a window that is zero on the sphere.
- **Shader.** Column under the top (`uFill` at the foot, 1 at the leading edge, soft `uTopSoft`
  above), thinning as it stretches, eroded by noise laid out in the launch ring and the height as
  a fraction of the top (it rides the drops; the carve rises with age: body, then flecks). Light,
  occlusion, atmosphere and fog are copied from the mist (keep in step).
- **Knobs.** `oceanGrid.waterfallSplashPass`: `material.uniforms.u*`; `hullOptions` + `rebuild()`
  (`launchFraction`, `terminalVelocity`, `rest`, `fan`, `lean`, `widthPerGap`, `mistLo`, `mistHi`);
  `uDebugMode` 1 opacity, 2 burst age, 3 strength, 4 the blobs, 5 launch speed profile.
- **Pages that load loose `src/` files** need three more script tags (falls-lab-sky.html has them):
  `materials/ocean-material/waterfall-splash.js`, `luts/waterfall-splash-hull.js`,
  `passes/waterfall-splash-pass.js`. Needs create-shader.py for the material.
- **Checked.** `node tests/waterfall-mist/splash-hull-test.mjs` (74 checks: the flight against the
  drag equation integrated numerically, the bell, the vanish, proxies hold their spheres, spheres
  hold their bursts, ledges, pools, wide falls). Both stages compiled, linked and rendered in headless
  Chrome (raw WebGL2, a three-like prefix, atmospheric perspective OFF) against the hull's output
  for 3 / 10 / 30 m landings. NOT checked: with atmospheric perspective on, through the real
  ShaderMaterial, on a real world, or at frame rate.
- **Round 2 (after Dante's first look): a standing column, not single bursts.** One ballistic burst
  per blob fired about once a second and cleared in between; a real foot fires several times a second
  and never clears, and it read as puffs lying on the surface. Now: the bursts overlap in the air, so
  the shader draws the standing column of their apexes, whose LAUNCH SPEED pulses at `uPulseRate` 5 Hz
  plus two harmonics that do not divide it (x1.618, x2.414), between `uPulseMin` 0.45 and 1, with the
  phase scattered over the footprint by 2D noise (`uPulseScatter`) so neighbouring spurts peak at
  different times. The top also carries its own drifting 2D height noise (`uHeightNoise` 0.55,
  `uHeightScale` 0.22 m, `uHeightDrift`). The volume is filled from the water to the top (`uFill`
  0.7) and its noise is in metres, stretched `uStretch` 4x along the axis and running up it at
  `uRiseRate` (periodic, no seam): vertical streaks like the foam coming down. A blob per strand now
  (`strandStride` 1, `maxBlobs` 48, b 0.3 m). The hull's flight / life / period are still tested but
  the shader uses only the apex; debug 2 and 5 both show the column height. Recompiled and rendered
  headless as before; needs create-shader.py again.
- **Round 3: x4 the size** (Dante). Height: `terminalVelocity` 4 -> 8 and `launchFraction` 0.35 -> 0.7
  (doubling both scales the apex by exactly 4: 3 m fall 1.31 m, 10 m 3.05 m, 30 m 5.60 m). Width:
  `widthPerGap` 2.4, `widthMin` 1.2 m. The shader's lengths x4 (`uSplashScale` 0.4, `uHeightScale`
  0.88, `uTopSoft` 0.4, `uLightLength` 2.4) and `uSplashDensity` /4 (1.25 per m), so the look is the
  same, larger; `uSteps` 24. Blobs now overlap ~5 deep across a fall: the overdraw lever is
  `hullOptions.strandStride` 2.
- **Round 4: radial, x1.5, half speed** (Dante). RADIAL term: the drops fly out along rays from a focus
  H / k under the origin (k = the hull's `fan`, now 0.6, passed as splashC.z), so the splash opens
  1 + k wide by its top; the launch ring is the sample's position over (1 + k z / H), density is
  divided by that squared (same drops, wider area), and the streaks run along the rays. x1.5: launch
  fraction and terminal speed both x sqrt(1.5) (0.857, 9.8 m/s: apex x1.5 exactly; 3 m fall 1.97 m,
  10 m 4.58 m, 30 m 8.40 m), widths 3.6 x gap / 1.8 m min, topSoft 0.6; shader lengths x1.5,
  density /1.5 (0.83), 28 steps. Time rates halved: `uPulseRate` 2.5, `uRiseRate` 2.5,
  `uHeightDrift` 0.75.
- **Round 5: the fall (the bounce)** (Dante: it juts up and vanishes; some should come back down).
  A falling SKIRT beside the column: the column's bell stretched `1 + fallReach` wide (hull option,
  0.8, in splashC.w; the blob radius grows to hold it: ~12.6 m on the 10 m test fall) and
  `uFallHeight` 0.75 as tall, drawn where the column is thin (x (1 - its mass)), its pulse LATE by
  `uFallDelay` 0.5 x the middle's fall time from its apex, so a spurt goes up and a moment later rains
  down round it. Its streaks run DOWN (`uFallSpeed` 1.5 x uRiseRate), density `uFallDensity` 1.5 of
  the column's, thinning to `uFallFloor` 0.5 at the water. Debug 6: column red, skirt green.
  `hullOptions.fallReach = 0` + rebuild() turns it off. Headless frames show a jet with a skirt of
  outward-leaning streaks round its base; the wide blobs show faint step hatching at 28 steps.
- **Round 6: the skirt killed the frame rate; overdraw fix.** The cost was overlap, not the skirt's
  maths: a blob per 0.5 m strand, each 1.8 m wide and (with the skirt) 12.6 m across, so a pixel
  near a fall marched ~13 overlapping blobs. Now a blob every 2 m (`strandStride` 4), its width no
  longer tied to the spacing (`widthMin` 1.8 m is b; `widthPerGap` 0.9), each carrying the water of
  its whole gap (`densityRefGap` 0.5: strength x gap / 0.5, so the look does not depend on the
  stride; tested), skirt `fallReach` 0.8 -> 0.5. Headless benchmark (raw WebGL2, 1400x600, one 12 m
  wide 10 m fall, ms per draw, two runs): round 4 (no skirt) 1.34 / 1.55, round 5 3.39 / 3.16, now
  0.81 / 0.83. Looks as dense as round 5 side by side.

## Waterfall impact particles, step 3: rings across the pool and foam fog at the foot (2026-10-02)

Branch `add-circular-ripples-under-waterfall`. Two more foot effects, both riding the splash blobs.

- **Rings across the pool: DRAWN, not simulated** (Dante's steer after the first try). The first
  version poked craters (+ an equal-volume crown) into the DynamicWaves field at Perlin-wandering spots:
  the field showed them (debug 69) but its damping kills a wave within a few metres, so in the normal
  render they died under the foam at the foot. The field is right for centimetre rings from bodies,
  wrong for a fall, which sends foot-high trains right across its pool. Now:
  - `WaterfallSplashHull.ringLines(ranges)`: each fall's LANDING LINE (the strands' plunge points in
    strand order; a break past `maxGap` 3 x the median spacing; a lone point is a zero-length segment),
    its downstream normal (from the arriving water's horizontal velocity, new `ranges[].hx/hz`), one
    phase per line, amplitude `amplitude` 0.18 m for a 10 m fall's single strand (x sqrt of the
    impact, 0.3..1.5).
  - `WaterfallSplashPass._tickRings`: every frame the 16 (`DynamicWaves.FALL_RINGS_MAX`) wet segments
    nearest the camera go into `DynamicWaves.fallRings` (wetness re-asked every second: a-land's
    getWaterAt is null while a tile loads, which is why the first version found no sources).
  - `dynamic-waves-pass.js` "Fall rings": the consumer chunk's `dynamicWavesSlopeAt` and
    `dynamicWavesVertexHeightAt` now return the simulated field PLUS
    `A · side · (1 − e^(−d/0.8)) · e^(−d/decay) · sets · sin(k·d′ − ω·t)`, d′ = d + `wobble` x Perlin
    (xz x `wobbleScale`, t x `drift`), ω² = g k (λ 4 m: 2.5 m/s), `sets` a beat at the group speed,
    `side` an angular fade to zero behind the line. Blended over the segments near the nearest
    (e^(−Δd/1.5 m)): no doubling at joints, two falls' trains cross-fade. Vertex height only where the
    mesh is finer than λ/4. So the sea, the flowing surface AND the probes (floating things bob) all
    get it, and it is spliced at runtime: no create-shader.py.
  - Knobs: `fallRings` (= `DynamicWaves.FALL_RINGS`: wavelength 4, decay 6, wobble 0.8, wobbleScale
    0.25, drift 0.15, groups 0.45, gain 1); `waterfallSplashPass.ringsEnabled`, `ringOptions` +
    `rebuild()`; console `ringStats()`, `hideWaterfallSplash(true)`.
  - ⚠ Lesson kept from the crater version: anything that injects into the DynamicWaves field
    continuously must be volume-neutral (the field has no DC restoring force; craters alone sank the
    window ~0.7 mm/s, CPU twin).
  - Checked: the chunk compiles + links in a vertex and a fragment stage (raw WebGL2, headless);
    top-down height render of a 6 m line + a lone point: trains downstream, wobbled fronts, wrap round
    the ends, calm behind, cross-fade between sources (the first render had a Voronoi seam and a hard
    behind-edge; fixed by the blend and the angular side). NOT checked in the real water material or
    in a world.
- **Foam fog** (`waterfall-splash.glsl`, "the fog"). A third term of the splash density, in the SAME
  blobs (no new overdraw): the finest spray hanging round the foot. Driven by the same impact: density
  x the blob's strength, top = `uFogHeight` 0.85 x the column's apex, breathing with `uFogPulse` 0.4 of
  the column's pulse `uFogLag` 0.6 s late (calmer than the splash). Wider (`uFogWidth` 1.1 b, opening
  by `uFogSpread` 0.8 to its top), fading with height (`exp(-uFogFade 1.8 z / top)`), soft billows
  (`uFogScale` 1.2 m cells, carve `uFogErode` 0.3 / `uFogSoft` 0.4) rising at `uFogRise` 0.5 m/s. Its
  middle wanders round the landing by Perlin gradient noise (`uFogWander` 0.5 b, `uFogDrift` 0.15).
  `uFogDensity` 0 turns it off. Debug 6 now shows the fog in blue.
  - **Round 2 (Dante, after the rings):** the fog ROLLS OUT in pulses with the pool's waves: density x
    mix(1, 1.6 x pulse^2, `uFogPulseDepth` 0.7), pulse = sin(k |lp| − ω x `uFogPulseSlow` 0.8 x t), k and
    ω copied every frame from `DynamicWaves.FALL_RINGS` into `uRingWave` (so retuning the rings retunes
    the fog). Bands at the rings' wavelength, a little slower than the waves. Bench unchanged (1.27 ms).
    Rings `gain` 1 -> 4 (Dante; ~0.7 m crest for a 10 m fall, cap ~1.1 m); wobble kept as is.
  - **Round 3: the pulsing mist moved onto the water** (Dante: the in-blob fog pulses died off too
    fast and went too high; it should ride the surface, inches to a foot, and fade further out than
    the waves). New SURFACE MIST: a second mesh in WaterfallSplashPass (`mistMesh`, a child of the
    splash mesh so the grid's show/hide covers it) drawing the SAME material with `uSurfaceMist` 1,
    every other uniform shared. One box per landing line (`_buildMistBoxes`: the line + `uSMReach` 30 m
    downstream, padded; level −1.6 .. +2.4 m), marched through the layer between the lowest trough and
    5 e-folds over the highest crest (`uSMAmpMax`, set per frame). Density = `uSMDensity` 2.0 x
    strength x e^(−y/`uSMHeight` 0.12 m) above the MOVING surface (level + the nearest line's ring
    wave) x e^(−d/`uSMDecay` 14 m) x bands at the rings' wavelength (`uSMPulseSlow` 0.8 of their speed,
    `uSMPulseDepth` 0.85) x 2-octave wisps (`uSMScale` 1.5 m, `uSMDrift`, `uSMErode`), downstream only.
    The fall-ring GLSL is spliced in at `//FALL_RINGS_INJECTION_POINT` (kept by make-combined's
    MARKER_KEEP) and its uniforms join the splash material. The in-blob fog's pulses are off
    (`uFogPulseDepth` 0.7 -> 0). Debug 4 shows the boxes orange, debug 1 its opacity.
    - Cost (headless, camera inside the box = every pixel marches, 1400x600): 3.0 ms with the full
      blended ring height + Perlin + per-sample shadow; 0.38 ms with the nearest line's wave inline and
      one light per pixel (a layer this thin does not need either), 0.2-0.46 ms with 2-octave wisps.
    - ⚠ Harness trap: my bench loop redrew the blended mist 30x into the same frame before the
      screenshot: a white carpet that was NOT the shader. Screenshot single draws only.
  - **Round 4 (Dante's browser tuning + floor + wisps):** defaults now Dante's: `uSMDensity` 10,
    `uSMHeight` 0.5, `uSMDecay` 2.5, `uSMPulseSlow` 3. New `uSMBase` 0.15: the distance falloff and the
    gaps between bands settle to it (a haze over the pool) until `uSMReach`. Wisps are STREAKS: 2D
    value-noise fbm (3 octaves, each rotated so the stretch shows no grid) in the line's frame,
    stretched `uSMWispStretch` 3 along the outward direction, streaming out at `uSMWispSpeed` 0.6 m/s,
    bent across by a drifting warp (`uSMWarp` 1.2 m), carved `uSMErode` 0.35 / `uSMWispSoft` 0.3. The
    boxes now rebuild themselves when `uSMReach` or `uSMHeight` changes (H 0.5 overran the old
    fixed 2.4 m top). Cost at these settings, camera inside the box: 1.57 ms with 3D noise + warp,
    0.65 ms with the 2D rotated fbm.
  - **Round 5: off the waves** (Dante: a cloud rolling out over the pool does not bob with the swell).
    The layer's height is now above the STILL level; `uSMAmpMax` and the per-sample wave are gone, the
    boxes are level −0.5 .. +0.5 + 5.5 H. The landing lines, band wavelength and downstream side still
    come from the fall rings. 0.31 ms at Dante's settings (was 0.65).
  - **Round 6: two falloffs.** With the haze as a FLOOR (mix(base, 1, e^(−d/decay))) uSMDecay stopped
    doing anything under ~2 m (the curve hit the floor inside the near-line ramp) and only uSMReach could
    end the haze (Dante had pulled it to 10). Now core + haze: (1 − base) e^(−d/`uSMDecay`) + base
    e^(−d/`uSMBaseDecay` 4 m); reach is only the soft cut-off. Defaults `uSMReach` 10, `uSMBase` 0.4
    (Dante's).
  - Defaults `uSMDecay` 2.5 -> 1, `uSMErode` 0.35 -> 0.1 (Dante: the carve broke the mist at the same
    spots every time).
- **Over-the-ledge bug (2026-10-02): rings and surface mist ran over the next cliff edge on short
  falls.** Root cause: the rings were keyed by xz only, so any water downstream within reach got them,
  including the creek a few metres lower past the next ledge. Two fixes:
  - **Level gate** (structural). Each line carries its pool's level (`fallRingExtra[i].x`, re-read live
    from a-land's getWaterAt with the wet check, since the build-time one can predate the tile). The
    consumer chunk has a global `dwSurfaceLevel` (−1e9 = unknown, no gate) that each call site sets
    before it asks: water-vertex.glsl `field.r`, water-shader.glsl `dryTestField.r`, the probe its
    `level`. A line draws only on water within 0.6..1.5 m of its level (smoothstep), and the nearest-
    line search skips lines at other levels. Needs create-shader.py (water-shader.js; ran already).
  - **Size** (Dante's). Each line's size = its drop / `sizeRef` 10 m, clamped 0.2..1.5
    (`RING_DEFAULTS`; ranges now carry `drop` = landing speed² / 2g). It scales the rings' decay and
    the surface mist's decay, haze decay, reach and box (`fallRingExtra[i].y`, mist `aSplashB.z`); the
    mist's line search is also level-gated (±1 m of its box's level).
  - Checked: 89 hull checks (+3: size clamp, default, recorded drop); the chunk compiles in both
    stages; a two-level render (a line at 0, a point at −3): no level → both, upper water → only the
    line, lower → only the point; mist at size 1 vs 0.2 (the short step's mist stays by its foot).
- **Perlin.** Hashed-gradient Perlin in both shaders: the fog's wander (twice per fragment) and the
  rings' front wobble (once per height evaluation).
- **Checked.** `node tests/waterfall-mist/splash-hull-test.mjs`: 86 checks (+11 on the ring lines:
  segments per plunge pair, downstream unit normal, across the fall, amplitude and its scaling per
  strand, lone point, one phase per line, gap breaks, fallbacks). The splash
  shader compiled, linked and rendered in the raw-WebGL2 headless harness (AP off). Bench, one 12 m
  wide 10 m fall, 1400x600: 0.99 ms/draw fog off, 1.32 ms fog on (+33%: the fog's noise runs over its
  wide footprint). NOT checked: through the real ShaderMaterial, with AP on, or at frame rate. waterfall-splash.js was already regenerated (fog defaults
  included) when the work finished.

## Waterfall impact particles, step 4: billowy clouds drifting off the foot (2026-10-02)

Branch `waterfall-billow-clouds` (off ec25a3f). The last foot piece: big, thin, billowy clouds that
break off the plume and float away. Dante's choices: discrete puffs (not a plume), drift = outflow then
wind, bake our own noise (port A-Starry-Sky's), backport the multi-scatter light afterwards (step 4b).

- **Puffs** (`luts/waterfall-cloud-puffs.js`, pure JS). Every landing line (the splash pass's
  `_ringSegments`: levels and wetness stay live) owns 3–8 slots. A slot is STATELESS, a closed form in
  the global time: born on the line (1.5 m downstream, 2 m up, x size), swells r0 2.5 → 9 m (x size^0.5,
  so a 3 m fall's clouds are still big), rises 0.22 m/s, leaves along the downstream normal at 1.4 m/s
  (e-fold 6 s), then drifts with 0.35 of `oceanGrid.windVelocity` (ramp 8 s); peak density (r0/r)^2,
  fade in 2 s, out over the last 35% of a 22–36 s life; reborn elsewhere on the line. Per frame the
  nearest 32 (max 64) are kept, sorted far → near (instance order = blend order).
  ⚠ A wind change jumps every puff to where the new wind would have carried it (no state to keep).
- **Noise** (`luts/waterfall-cloud-noise.js` + `waterfall-cloud-noise.glsl`): A-Starry-Sky's
  cloud-noise.glsl modes 0/1, ported (credit in the header). Shape 128^3 (the plan said 64; 56 Worley
  cells in 64 texels would alias), detail 32^3, RGBA8, linear, repeat. Baked 16 slices a frame the first
  time a fall is up; the clouds stay hidden until it is done. ⚠ r173's WebGL3DRenderTarget drops its
  options, so filters/wraps are set on the texture.
- **Shader** (`waterfall-cloud.glsl`, instanced icosahedra, inscribed sphere = the puff). The sky's
  recipe with the puff's envelope as coverage: soft ball with a flattened base, ERODED by the shape
  (`remap(env, (1-shape)·uShapeErode, 1)`, coordinates in radii so the billows swell with the puff and
  roll up at uRoll), then by the detail in metres (wispy d^6 low, billowy 1−d high). Light: two HG
  lobes (0.7 / −0.2), Wrenninge's octaves (4) + diffusion floor, 3 doubling sun segments on the cheap
  density, powder, sky occluded by one tap up, scene shadow at mid-chord, Hillaire's step. Jitter is the
  splash's static IGN (no blue-noise texture: it comes from the sky and may be null).
  - ⚠ First cut read as smooth blobs. The baked `.r` is ALREADY lifted by its Worley fBm; a second
    Nubis lift (by `.gba`) pushed it to ~1 and the erosion did nothing. The sky reads `.r` straight.
    Also a 2 m detail tile is invisible from 30 m (now 6 m).
- **Pass** (`passes/waterfall-cloud-pass.js`): rides the splash pass (up only while it is), aliases the
  flowing material's uniforms, the usual render state, renderOrder 7.5 (behind mist 8, surface mist 8.5,
  splash 9). Hidden in every offscreen pass, the waterline water view and underwater (ocean-grid.js).
- **Console:** `waterfallCloudPass` (puffOptions live, material.uniforms.u*), `cloudStats()`,
  `hideWaterfallClouds(bool)`; uDebugMode 1 opacity, 3 peak density, 4 proxies, 5 age, 6 shape/detail/envelope.
- **Checked:**
  - `node tests/waterfall-mist/cloud-puffs-test.mjs`: 24 checks (birth on the line, drift outflow →
    wind, rise, growth monotonic, thinning, fades, respawn elsewhere, stateless, finite, pick
    cap/nearest/far→near, dry lines, distance). The splash (89) and mist hull tests still pass.
  - Headless Chrome on the 4090 (three r173 via aframe 1.7, the real pass with a stubbed grid, materials
    generated into scratch, not the repo): compiles, the noise bakes (debug 6 shows the texture),
    1200x700 costs 0.12 ms (3 m fall), 0.45 ms (8 lines, 32 puffs), 0.64 ms with the camera inside
    them. Defaults tuned there (density 2, shape 0.45 tiles/radius, erode 1.3, detail 6 m, erode 1).
  - NOT checked: the real page (falls-lab-sky.html has the scripts now), AP on, real exposure. The bench
    sun saturated AES at 4.5 and the shading only showed at 1.6, so expect to tune uSunGain/uAmbient/
    uCloudDensity in the browser.
- **NEEDS create-shader.py** (two new materials: waterfall-cloud-noise.js, waterfall-cloud.js).
- **Step 4b (after the look is approved):** pull the HG octaves + Wrenninge + diffusion floor into a
  shared chunk and give it to the splash, foam fog, surface mist and mist cones behind `uMultiScatter`
  for an A/B (they use `(e^-τ + 0.4e^-0.2τ)/1.4` now).

### Step 4, round 2: thin water mist off the whole line, not clouds (2026-10-02)

Dante: "these are actually too powerful… rapidly fade and act like thin water mist, not actual clouds…
emanate along the entire boundary. Instead the waterfall kind of… farts."

- **The "fart"** was the emission: 3–8 slots per line, each born at a RANDOM spot as a fully formed
  2.5 m dense puff 2 m up, so a few separate blobs popped out. Now:
  - the line is cut into even stretches (0.8 per m, 4..32), with `perStretch` 2 puffs in each at
    independent ages. One per stretch alternated bright and dim along the row;
  - each slot gets a random phase (stretches fired in order would sweep);
  - births are low (0.8 m up, 0.5 m out) and wider than their stretch (r0 2.5 x size^0.5), so neighbours
    overlap;
  - fade-in is 2.5 s, so a puff peaks already spread out (a dense newborn was the bright pop).
- **Too powerful** = the sky's cumulus recipe:
  - life 22–36 s → 6–11 s, with an e-fold thinning from birth (`fadeTau` 3.5 s); under a quarter of its
    peak by 3/4 of its life;
  - density 2 → 0.8;
  - erosion 1.3 → 0.9;
  - new `uBillowy` 0.2 (the sky's 1−d knobs mostly off: wispy d^6 strands all through);
  - new `uEdgeSoft` 2 (envelope (1−|q|²)², no dome per puff, so the row melts into one sheet);
  - detail tile 6 → 3 m.
- **Overdraw:** thin puffs never reach the 1% early-out, so the camera inside 64 of them cost 5.1 ms.
  Steps 24 → 12 (uStepFrac 0.2), sun segments 3 → 2: no visible change, inside 1.78 → 0.99 ms,
  outside 0.87 → 0.58 ms (8 lines, 64 puffs, 1200x700, 4090). Instance cap 96, default maxPuffs 64.
- Checked: 28 puff checks (+ whole line: each slot in its stretch, no gap over two stretches, not a
  sweep; + fast fade). Bench renders: one continuous low band along the line thinning as it drifts.
  NOT checked in the browser yet; regen needed again (template + glsl changed).

### Step 4, round 3: the ocean spray's light profile (2026-10-02)

Dante: "the mist doesn't have the same lobe profile as the clouds… grab the profile from the ocean
waves, as those look colder."

The sea's spray lights its mist with `aeratedWater` (ocean-splash.glsl, foaminess 0): sun × sunScale 0.8 ×
(half-Lambert wrap × 0.8 + phaseGain 0.6 × a 4π-normalised HG pair, forward g 0.85 with 15% of a −0.2
back lobe), plus a sky fill lifted ×1.8 and tinted by the cool translucent-water body (0.60, 0.74, 0.95),
plus the teal of the sunlit water bounced up under it. The clouds' lobes (g 0.7, HALF backward) pour warm
sun on every side, so the mist read warm.

- New `uLobe` (1 = spray, the default; 0 = the cloud lobes) in waterfall-cloud.glsl:
  - `sprayPhase` is that light in our units, π × uSpraySun × (uSprayWrap + uSprayGain × dual). The wrap
    over a made-up normal becomes its volume mean, 0.4;
  - the ambient is the spray's (tint + bounce, the bounce at half its underside);
  - in spray mode the Wrenninge octaves are divided by their tau-0 sum (1.875) so thin mist matches the
    spray instead of glowing at twice it.
- Uniforms `uSprayG/uSprayGain/uSprayWrap/uSpraySun/uSprayAmbient/uMistTint/uWaterBounce` carry
  OceanSplash's values; keep them in step if the spray is retuned.
- Not ported: the spray's day/night gates (uSunElevation; the waterfall materials do not get it). At
  night its tinted ×1.8 fill may glow. Check at dusk.
- Bench A/B (density ×4 to see it; side, back and front sun): spray mode reads colder, blue-white bodies,
  no warm wash; the halo only near the sun. Cost unchanged.

### Step 4, round 4: the night gate for every foot volume (2026-10-02)

Dante: "we likely should get our sun elevation passed into our foam shaders. I've never seen any of these
at different times of day."

- `WaterfallMistPass.solarElevation(og)`: sin of the TRUE solar elevation, from a-starry-sky's sun
  (1 with no sky). Not the brightest light's, which is the moon at night. The grid's OceanSplash block now
  calls it too (it had the same code inline).
- Mist cones, splash + foam fog, surface mist and the clouds all get `uSunElevation` (set every frame by
  their pass) and `uNightAmbient` 0.07 (OceanSplash's). The sky fill × `nightDim()` =
  mix(0.07, 1, smoothstep(−0.08, 0.06, elevation)), the sea spray's gate. Direct light is untouched (the
  moon still lights it). The clouds' teal water bounce also takes the spray's `dayF`
  (smoothstep(0.04, 0.22)).
- Daytime is unchanged (the gate is 1 above ~3.4° of sun) for the splash, foam fog, mist cones and
  clouds. The surface mist changed slightly even in daytime: its colour now goes through the sky fill
  term with the gate.
- Checked: all three shaders compile, linked through three r173 in the headless bench (splash in both
  modes, mist cones, clouds). The clouds with the sun off: blue-white by day → a dark veil at night.
  The splash regen differs from HEAD only by the added lines.
- Not checked: any of it at real dusk/night in the browser (never looked at).
- NEEDS create-shader.py: waterfall-mist.js and waterfall-splash.js now change too, plus the two new
  cloud materials.

### Step 4, round 5: foam keeps its sunset colour (hue-keeping tone curve) (2026-10-02)

Dante (screenshots): the waterfall foam stays pretty much white until dusk; at night some foam goes dull
grey while foam in the pool stays weirdly bright.

- **Diagnosis (no code was wrong; numbers from a-land's SkyPhotometry).** Our light uniforms are a-land's
  metered `lux × exposure`. The exposure rises faster than the low sun fades. Display light on a sun-facing
  surface:
  - 45°: (2.6, 2.1, 1.7), sky (0.2, 0.27, 0.43);
  - 5°: (14.7, 6.5, 1.3);
  - 2°: (17.4, 4.1, 0.2), sky 1.5–1.6;
  - −12° (moon): (0.065, 0.079, 0.093), sky 0.04.

  The terrain is mostly flat, so the grazing beam barely lands on it; the vertical curtain, lit through
  from both faces, takes all of it. That much is physical: it IS the brightest thing in the scene. The
  per-channel AES then clips R and G to 1 and the sky adds blue, so the orange collapses to white.
- **Night curtain grey is right:** moon + sky on an albedo-1 slab ≈ 0.30 sRGB.
- **The pool's bright night patch does NOT fit** (foam lit the same way would be the same grey).
  Suspect: the moon's specular glint (specBoost 7), not foam. A/B pending from Dante:
  `oceanGrid.specBoost = 0` vs `oceanGrid.foamWhite = 0` at night.
- **Fix: `aroFoamToneMap(color, share)`** in water-shader.glsl, copied in waterfall-sheet.glsl. The
  brightest channel goes through AES and the others keep their ratio to it, mixed with per-channel AES
  by share. The share is foamBlend × foamHueKeep (water, above water only) or (1 − slabTdir) ×
  foamHueKeep (sheet bubbles; the water seen through the gaps stays per-channel).
  - One live knob, `oceanGrid.foamHueKeep` (0.7): the sheet aliases the creek's uniform
    (SHARED_UNIFORMS). 0 = the old look.
  - Predicted (foam facing the sun, sRGB), old → 0.7 → 1.0:
    - noon: 232,230,231 → 232,225,228 → 232,223,227 (no change);
    - dusk 5°: 254,250,243 → 254,215,184 → 254,198,149;
    - dusk 2°: 255,249,243 → 255,199,177 → 255,172,135;
    - night: 67,71,75 → 69,72,75 (no change).
- Checked: a standalone `<a-restless-ocean>` page (all 69 bundle files, aframe 1.7, scratch-generated
  materials) compiles the sea, the flowing variant and the sheet with zero console errors. The regen
  differs from HEAD only by the added lines.
- NEEDS create-shader.py: water-shader.js and waterfall-sheet.js too now (six materials in all).

### Step 4, round 6: the land's occlusion on foam, the curtain and the foot's mist (2026-10-02)

Dante (night screenshot): the white foam on the fall and on the water glows at night; surf/water foam
isn't that grey at night. Does the foam get ambient, shadows, self-shadow?

**Answer.** The sky fill was the WHOLE sky everywhere. The curtain had NO terrain shadow on a-land pages:
it reads only the scene shadow map, which a-land turns off. The pool foam had the sun's land shadow
(WaterLightField) but an unoccluded sky. Nothing self-shadowed except the mist's short sun march. A fall at
the back of a gorge sees a share of the sky, and at night the moon behind the wall still lit it, beside
cliffs a-land lights with its occlusion baked in (black).

- **a-faraway-land** (branch `foam-shader-additions`): `ALand.runtime.ObjectMaterial.siblingLight()`.
  Read-only, by reference, the live bus values its objects use:
  - horizon: skyline atlas, K, soft;
  - ground: lightmap, A = sky visibility.

  Either is null when off.
- **`ARestlessOcean.LandLight`** (new, `field/land-light.js`):
  - GLSL `landLightVisibility(p, L)` (a-land's horizonShadow, keep in step) and `landSkyVisibility(xz)`,
    spliced at `//LAND_LIGHT_INJECTION_POINT` by `ARestlessOcean.spliceLandLight` (ARestlessOcean.js);
    every build site uses it, with a stub returning 1 where the file is not loaded;
  - `update(uniforms)`, every frame in the grid's uniform loop (after WaterLightField);
  - the sheet and the foot volumes alias the 7 `land*` uniforms (both SHARED_UNIFORMS lists);
  - Console: `ARestlessOcean.LandLight.enabled = false` (A/B), `.stats()`.
- **Applied:**
  - water foam's sky fill × sky visibility (sea and pool);
  - curtain: sunShadow × skyline (sun and glint, so the moon behind the wall goes), sky fill ×
    sky visibility;
  - mist cones, splash/foam fog, surface mist: sun × skyline, sky × sky visibility at the fragment;
  - clouds: the same at mid-chord.
- ⚠ Both are taken at the GROUND under the point. The curtain's upper half sees a little more sky and a
  lower skyline than its foot, so it is over-occluded up there. The texels are metres. Pool foam's sky
  visibility is the BED's (deeper sees less), slightly dark near banks.
- Checked:
  - the standalone page compiles water, flowing, mist, splash, cloud and sheet both WITH land-light.js
    and WITHOUT it (stub), zero console errors;
  - functional, cloud bench with a fake a-land: open sky identical to no a-land; skyline above the sun
    removes the direct light; sky visibility 0.3 dims the fill; both: a dim blue-grey.
- NOT checked: against a real a-land bake (falls-lab-sky at night).
- NEEDS create-shader.py (all six foot/water materials) and the a-land branch on the page.
- Not built: self-shadow on the curtain (step 3 of the plan, if still needed after this).

### Night lighting: the units are NOT the problem (measured 2026-10-02)

Dante: at night the water reflects the ground green while the land in the distance is dark. "A
difference in our lighting models and units?"

- **Measured headless** (falls-lab-sky at sky-date 2022-10-15 01:00, the night driver in this session's
  scratch: CDP Fetch rewrites the page's sky-date, park the camera off the landing line):
  - a-land exposure 21.26 (EV100 −4.7), renderer.toneMapping 4 (three ACES filmic);
  - budget direct (0.00145, 0.00176, 0.00207) lux, sky 0.0019 lux;
  - our flow uniforms sun = (0.031, 0.037, 0.044), sky = 0.041, i.e. EXACTLY lux × exposure;
  - the "sun" is the MOON at ~2° altitude (dir.y −0.035) on that date;
  - LandLight live (horizon + ground both arriving).

  ⚠ The headless frame itself was unusable (terrain patches drawn as black bands: camera inside the
  bank or tiles unstreamed). Do not read the image, only the numbers.
- **Tone curves differ in the darks:** ours is Narkowicz's fit, a-land's is three's RRT+ODT ACES (black
  toe). Same input: ours 0.01 → 12/255 vs three 8; 0.04 → 49 vs 41. Ours ~20% brighter at night. A real
  but small contributor (night foam 42 vs 34).
- **But the metered light predicts the SSR-relit grass at ~(4, 13, 2)/255, near black.** The visible
  green needs far more light than that, so it comes from a path not yet identified. Candidates:
  - SSR relight (water-shader ~1185: albedo × (sun·N·L + sky), NO shadow, NO occlusion, NO 1/π
    unlike the seabed branch);
  - the mirror reflection RT (a-land captured in mode 3, exposure, no curve);
  - the above-water refraction relight branch (~3030).
- **Next:** Dante's A/B at night: debug 11 (reflection alone) vs 15 (body alone), then mode 0 with
  `oceanGrid.ssrMaxSteps = 0`. Whichever path it is gets the land occlusion at its hit point. Then
  consider matching three's ACES curve.

### Night lighting, found: our sky term is PI x too bright (2026-10-02)

- **Dante's A/B at night:**
  - debug 11 (reflection alone) has the green;
  - debug 15 (body) does not;
  - `ssrMaxSteps = 0` removes it.

  So it is the SSR relight. Still the biggest offender: the sea foam.
- **The unit bug.** `skyAmbientColor` is IRRADIANCE: a-land's metered skyLux × exposure, or a-starry-sky's
  hemisphere, calibrated against three's stock Lambert. A Lambert surface returns albedo/π of it, and
  a-land's terrain.frag does exactly that ("Multiplying irradiance by bare albedo overshoots by PI").
  Our shaders used bare `albedo × skyAmbientColor` everywhere, with the sun term already / π. By day the
  sun hid it. At night, with a 2° moon, the sky is nearly all the light, so white water and the
  reflected hills read ~3× bright. The SSR relight also lacked the sun's 1/π and had no shadow.
- **Fix, behind `oceanGrid.ambientPiFix`** (1 physical, default; 0 the old look; shared uniform reaching
  water, sheet and the foot volumes):
  - sea/pool foam ambient / π;
  - curtain sky fill / π;
  - mist cones, splash/foam fog, surface mist and clouds ambient / π;
  - SSR hit relight: (sun·N·L × land skyline + sky × land sky visibility) at the hit (0.5·(lo+hi)), / π.
- Predicted at the measured night light: sea foam 42/255 → ~15 (a-land grass ~8). By day: sunlit foam
  barely changes, shaded foam keeps ~1/3 of its sky fill.
- ⚠ NOT changed (same bug class, wider look impact; do one at a time):
  - the water BODY (inscatterEquilibrium = waterAlbedo × (direct + skyAmbientColor));
  - the seabed/terrain-through-water relight's ambient;
  - OceanSplash's spray (vAmbient = sky × 1.8);
  - the clouds' spray mode copies those spray constants, so it now sits /π under the spray.
- Checked: everything compiles with and without land-light.js, zero console errors. NEEDS
  create-shader.py.

### The rest of the sky terms get the 1/PI (2026-10-02)

Dante: "The foam and terrain match better now! Want to give the others a go?"

- **Audit.** Already right:
  - the water body (single scatter E/(2π), R∞ multi-scatter E/π, in water-shader AND the sheet's copy);
  - the river plume (albedo/π × (sun + sky));
  - the CPU underwater murk ((direct + ambient)/π).
- **Fixed, all behind the same `oceanGrid.ambientPiFix`:**
  - **Seabed** `ambientUW`. Its comment said "a uniform sky of radiance L delivers E = π L, so the π
    cancels", which reads the uniform as RADIANCE; it is irradiance. Now /π and × the land's sky
    visibility; comment corrected.
  - **Terrain seen through the water:** sky /π, × land sky visibility.
  - **The no-sky-provider sky** (`computeStandaloneSkyRadiance`, water + sheet copy): mean radiance =
    E/π. ⚠ This one is a big DAYTIME change on pages without a-starry-sky (islands.html etc.): their
    synthesized sky reflection drops to 1/π.
  - **The sheet's** SSR relight (as the water's), its below-horizon sky fallback, and the bed/terrain
    seen behind the curtain.
  - **OceanSplash spray:** `vAmbient` /π (drives both its mist body and its drops' sky reflection); the
    grid passes ambientPiFix in the splash ctx. The clouds' spray mode (uSprayAmbient 1.8 copies the
    spray's) is consistent with the spray again.
- **⚠ Bug fixed from the previous round:** both SSR functions march in VIEW space (ssrViewMatrix), so the
  hit point handed to the land occlusion was a view-space position. Now
  `worldPos + normalize(marchDir) · dot(hitView − viewPos, viewReflect)`. The sheet's LAND_LIGHT marker
  moved above its SSR function.
- Checked: water, flowing, mist, splash, cloud, SPRAY and sheet compile with and without land-light.js,
  zero errors. The regenerated ocean-splash.js differs from HEAD by the added lines only.
- NEEDS create-shader.py (now seven materials incl. ocean-splash.js).
- **Watch by day:**
  - shaded shallows and terrain-through-water lose ~2/3 of their sky fill;
  - spray mist and drops are /π (OceanSplash's ambientScale 1.8 was a lift for "dark grey smoke"; it
    may need re-tuning against the now-correct units rather than reverting the fix).

### Curtain vs mist at night: each part of the fall asked a different patch of ground (2026-10-02)

Dante (night, at the curtain): "the foam and sheet colors still aren't matching".

- **Measured from his screenshot:**
  - curtain top at the lip: (10, 14, 20) lit blue-grey;
  - the rest of the curtain: (4.6, 5.1, 2.7) = the cliff beside it (4.1, 5.2, 2.7). The curtain's own
    white water contributed ~nothing; it showed the rock behind it;
  - the mist at the base: grey-blue, brighter.
- **Cause:** the "taken at the ground" approximation of LandLight.
  - The lower curtain hangs over the cliff-FOOT texels: a corner that sees half the sky and a high
    skyline.
  - The lip sits over the open ledge top.
  - The mist's rays exit over the open pool.
- **Fix:** `landSkyVisibilityOpen(xz)` / `landLightVisibilityOpen(p, L)`, the most open of the point and
  four neighbours LAND_OPEN_R = 4 m away (field/land-light.js; stubs in ARestlessOcean.js). Used by the
  curtain (sun and sky), mist cones, splash/foam fog, surface mist and clouds. Sea/pool foam keep the plain
  lookup: they do lie on the ground.
- ⚠ In a gorge narrower than ~8 m a neighbour may land on the opposite wall (a max, so it can only
  brighten). The moon at 2° still leaves the lower curtain unlit by direct light while the lip is lit;
  that part is physical.
- Checked: compiles with and without land-light.js, zero errors. NEEDS create-shader.py.

### Night foam had no colour: a-land's sky hue went neutral after sunset (2026-10-03)

- **Dante's console at night:** skyAmbientColor = (0.1476, 0.1484, 0.1484), i.e. neutral. He suspected a
  brightness floor on the sea foam/sheet. Neither path has one (checked line by line).
- **Cause (a-faraway-land, SkyPhotometry.skyLuxRGB).** The sky's hue is 1 − T(sun altitude), the
  complement of the beam's transmittance. Below the horizon T ≈ 0 in every channel, so the hue is WHITE
  from sunset to sunrise (0.99, 1.00, 1.00 at −2…−20°).
- **Fix** (a-land branch `foam-shader-additions`):
  - below 2° the hue blends to the clear-sky blue `[0.55, 0.75, 1.0]` (the file's own fallback),
    fully by −4°: twilight's Chappuis blue hour, then the moonlit/starlit Rayleigh sky;
  - colour only: both are normalised to unit luma and the magnitude is still set by luma, so exposure
    and every brightness are unchanged;
  - the 3° dusk test (sky loses its blue dominance) still holds.
- **Reaches both libraries:**
  - a-water's skyAmbientColor (metered photometry);
  - a-land's own terrain, whose dome is scaled per channel to the same budget.

  So foam and ground go blue together.
- **Tests:** sky-photometry +6 (blue-dominant at −4…−45°, luma continuous through the blend band), 65
  pass. The whole a-land lighting suite passes (12 suites).
- **Still open from Dante's report:** the FALLING sheet reads differently from the foam where it lands.
  The falling water is thin (low aeration → see-through, shows the rock), the foot is dense. If it still
  reads wrong once the sky has colour, the knobs are the sheet's uVoidMax / uTailBoil.
- **DEFERRED (Dante, 2026-10-03): the falling sheet vs the foam where it lands.** "The sheet white is
  technically air bubbles as is the water, so their colors ought to mix nicely". A future iteration:
  one bubble-albedo/lighting model shared by the curtain slab and the water foam, so the two blend
  instead of meeting as two looks.

## Waterfall foot, step 4b + the falls' shadow (2026-10-03, branch `waterfall-billow-clouds`, uncommitted)

### 4b: multiple scattering in the splash, foam fog and mist cones

- Wrenninge's octaves (4) + diffusion floor (`uDiffusion` 0.5) replace the old two-exponential
  stand-in `(e^-τ + 0.4e^-0.2τ)/1.4`. The copies in waterfall-mist.glsl and waterfall-splash.glsl are
  kept in step. `uMultiScatter` 1 new / 0 old.
- **NORMALISED PER ANGLE:** the octaves' sum is divided by its own τ = 0 value at this view angle and
  multiplied by the single phase, so thin spray is lit EXACTLY as before from every side. A first cut
  divided by a flat 1.875: side-lit thin mist came out 1.5× brighter and the backlit halo 30% dimmer.
  Now:
  - side- or front-lit dense clumps keep 1.1× (τ 0.5) to ~4× (τ 8) more light on their shaded side;
  - backlit thick spray gets dimmer (0.5–0.9×): the glow no longer punches through a thick burst,
    which the old 0.4·e^-0.2τ tail let it do.
- The surface mist has no sun march, so it is unchanged.

### The falls' shadow: WaterfallShadowPass (new, passes/waterfall-shadow-pass.js)

- **Why:** sunlight went straight through every fall. On a-land pages the scene shadow map is off, and
  a-land's shadows know only the land.
- **The map:** one sun- (or moon-) aligned ortho map, 1024², fitted round the sheet mesh's bounds plus
  4 m, texel-snapped (HeroShadowPass pattern). It renders ONLY the sheet, through the sheet's own
  vertex stage with a caster fragment.
- **What a sheet takes from the light:** the bubble slab's REFLECTANCE along the light (two-stream, as
  the sheet draws itself): tauR = 0.15 · 1.5 voidFrac / r · path, R = tauR / (2 + tauR), × presence.
  Bubbles scatter forward, so a glassy tongue casts nothing, a white curtain a soft partial shadow, and
  dense white water nearly full.
- **Encoding:** RGB transmittance multiplied across layers (blend dst × src), A the nearest sheet depth
  (blend MIN).
- **Receivers:** `fallShadowAt(p)`, spliced at the LAND_LIGHT marker by `spliceLandLight` (stub without
  the file). Used on:
  - the sheet itself (lip on face, cascade on cascade);
  - the mist cones and splash per light step, the surface mist and clouds at mid-chord;
  - the water's surface sun (sunShadowNoOcean), body inscatter, seabed and terrain-through-water.
- Uniforms `fallShadowMap/Matrix/Params` live on the water material; the sheet and foot volumes alias
  them (both SHARED lists). Written by `writeUniforms` in the grid's loop; ticked right after the sheet.
- **Console:** `fallShadowStats()`, `waterfallShadowPass.enabled = false` (A/B), `.bias` (0.35 m),
  `.size`, `.margin`.
- **Checked** (standalone page, all 71 files):
  - every shader compiles with and without land-light.js;
  - a fake 10 m fully aerated sheet: map centre T 0.036 at depth 0.43, corners empty;
  - fallShadowAt behind the sheet 0.036, beside 1.0, in front toward the light 1.0.
- **Limits:**
  - one depth layer;
  - the foam grain at its mean;
  - a-land's cliff does not receive it yet (needs an a-land hook).
- NEEDS create-shader.py (water, sheet, mist, splash, cloud). The script is added to the demo pages
  that load waterfall-sheet-pass.js.
- **Dante's look (2026-10-03): "no real changes", and maybe z-fighting on the mesh behind.**
  - Expected for most views: the curtain's shadow falls AWAY from the light, on the cliff (a-land's, not
    a receiver) when the fall is front-lit. Only a BACKLIT fall shades the pool and foot volumes.
  - The z-fighting was the sheet receiving its own shadow: the map is fitted round the whole sheet
    mesh, lead-ins included, so a texel is tens of cm against a 0.35 m bias, and overlapping curtain
    parts acned each other. The sheet no longer receives it; the pool, seabed and foot volumes still do.
  - **Decision pending:** keep it for the backlit case, or revert the pass.
- **Kept as groundwork (Dante, 2026-10-03: "that also gives us something to hit next time").**
  NEXT: hand the falls' shadow map to a-faraway-land so its cliff and pool banks receive the curtain's
  shadow (the front-lit case, the one people see). Ideally a sibling hook like `siblingLight()` but
  the other way round (a-water → a-land), fitting the existing `setOceanFog` / `setWaterField` typed
  setters on TerrainMaterial. Then revisit sheet self-shadow with a tighter map (fit the airborne part
  only, not the lead-ins) so the texel beats the bias.
