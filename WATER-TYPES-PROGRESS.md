# Multi Water Types: progress log

Running record of the phases in [`WATER-TYPES.md`](./WATER-TYPES.md) as they land.
One section per phase: what shipped, where things moved, what was deviated from,
what is deferred, and what still needs a human to look at it.

The architecture doc stays the plan. This file is the log.

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

### ▶ RESUME HERE — PAUSED on an a-starry-sky sun-direction bug (2026-09-25)

**Paused at Dante's request while he works in A-Starry-Sky. Do not edit A-Starry-Sky from here.**

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
