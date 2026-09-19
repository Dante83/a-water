# Multi Water Types: progress log

Running record of the phases in [`WATER-TYPES.md`](./WATER-TYPES.md) as they land.
One section per phase: what shipped, where things moved, what was deviated from,
what is deferred, and what still needs a human to look at it.

The architecture doc stays the plan. This file is the log.

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
