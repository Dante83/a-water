# Multi Water Types: the architecture

How `a-restless-ocean` grows from one ocean into rivers, waterfalls, lakes and
shorelines that feed into each other — over terrain that answers back.

Companion documents, and the order to read them in:

1. [`update-suggestions.md`](./update-suggestions.md) — the v0.3.0 wishlist (compiled
   2026-06-12). Still the best catalogue of *what we want*; two of its ground-rule
   assumptions about a-land have since gone stale (see § Corrections).
2. [`a-land-water-contract.md`](./a-land-water-contract.md) — the terrain side's answer,
   agreed with Dante 2026-07-10. **The data contract.** a-land's source cites this file
   by relative path from four places.
3. **This file** — the architecture and the sequencing that turn the contract into
   rendered water. Written 2026-09-07.

---

## Context

`a-restless-ocean` 0.2.0 renders **one** body of water: a camera-anchored FFT clipmap on a
single global plane at `y = height_offset`. Every subsystem is built around that singular
assumption — one `underwaterFactor`, one submersion probe, one water type (and
`water_type` already means *Jerlov optical preset*, not body kind), five bare-global CPU
height samplers with no body identity, and a shore-detection path that is four lines of
`worldPosition.y - terrainHeight` against a 4 m/texel ortho re-render.

Meanwhile `a-faraway-land` has **shipped its entire hydrology side.** `WaterSolve.js`
(873 lines, merged to its mainline) runs a full steady-state solve — priority-flood fill,
D8/rho8 routing, drainage accumulation, Leopold-Maddock channel width, Manning depth, and
**Froude-number regime classification** — and exports it as three per-tile PNG pyramids
plus a `simulation` block in `map.json`. `WaterReader.getWaterAt(x, z)` already answers
`{depth, level, vx, vz, energy, type}` on the CPU. a-land even seeds its `waterTypes`
palette in *our* Jerlov vocabulary.

So the gap is entirely on the water side. The world already knows where its rivers, lakes,
waterfalls and dry zones are, how deep and how fast they run, and how turbulent each cell
is. We render none of it.

**Intended outcome:** rivers driven by River-Editor-class techniques, waterfalls and
splashy places, shorelines with waves that break properly, and — the part that actually
matters — all three feeding into each other continuously.

---

## Decisions taken (2026-09-07, with Dante)

1. **Lakes are ocean.** A lake is the existing clipmap surface with its Y read from
   a-land's level field and different FFT dynamics (short fetch, low wind). There is no
   lake renderer.
2. **Ribbons for flowing water.** Still water (ocean + lakes) rides the clipmap; rivers,
   creeks and chutes are extruded ribbon meshes carrying a flow-aligned parameterization
   the clipmap cannot express. Same material family, blended in a band where `|v|` crosses
   the flow threshold.
3. **WebGL2 only.** No WebGPU track. (Investigated: compute-in-a-worker *does* coexist with
   a WebGL2 main thread — `navigator.gpu` is exposed in `DedicatedWorkerGlobalScope` — but
   there is no zero-copy interop. Output must round-trip `mapAsync` to a transferable
   `ArrayBuffer` and back up as an attribute, costing 2-3 frames of latency. Viable for
   particle microsims, useless for field solves. Deliberately out of scope.)
4. **a-land is required for rivers and lakes.** The ocean and shorelines stay standalone —
   the 0.2.0 "helps, not needs" promise holds for them. Rivers, lakes and waterfalls
   declare a hard `terrain-provider` dependency and no-op without it. Fountains are the
   exception: authored, not solved, so they work standalone.

---

## What already exists — do not re-derive this

### a-land, shipped

| Thing | Where |
| --- | --- |
| Steady-state hydrology solve | `a-faraway-land/src/js/runtime/terrain/WaterSolve.js` — outputs `level`, `depth`, `velX/velZ`, `energy` (0-1, Froude-derived), `type`, `oceanDry`, `bodies[]`, `waterfalls[]` |
| Tile encode | `.../terrain/WaterTileExport.js` — the contract oracle; a-land's tests assert decode == encode |
| Tile export + `simulation` block | `a-faraway-land/editor/src/save.js:1018-1408`; the block is written at `:1380-1402` |
| CPU read | `.../streaming/WaterReader.js:100` `getWaterAt(x,z)` → `{depth, level, vx, vz, energy, type}`; surfaced at `director/TerrainDirector.js:2048-2057` |
| `getHeightAt` / `getNormalAt` | `runtime/components/land-terrain.js:284-330` — **`getNormalAt` is implemented** |
| Beach + offshore shelf sculpt | `.../terrain/ShoreBake.js` |
| Wind field | `getWindField()` / `getWindAt(x,z)`; a-land's `WIND.md:1751` says a-water needs exactly this accessor and nothing else |
| Shader injection registry | `a-faraway-land/src/js/core/material-extensions.js` — splices at `// @inject:<name>` |

Water-type seeds already agreed: `0 ocean, 1 lake, 2 river, 3 whitewater`, whitewater at
`energy >= 0.75` (`WaterSolve.js:91-93`), palette `[{IB,0.05},{I,0.02},{1C,0.3},{3C,0.7}]`
(`save.js:1387-1390`).

### a-land, contract debts

Tile events, the two material sockets, body `id`s, hydrograph connectivity, the terrain-only
render layer and `shoreline.fetchBake` are all **specified but not built.** See § Amendments.

### a-water, the extension points that matter

| Thing | Where |
| --- | --- |
| The god file | `ocean-grid.js` (3497 L); constructor `:53`, per-frame uniform upload loop **`:3132-3336`** |
| **The precedent to copy** | `_createHorizonSkirt()` `ocean-grid.js:1388-1410` — clones the water material, rebuilds only the vertex shader with a different flag, registers itself into `oceanGridInstanceKeys`, and gets the whole FFT / light / atmosphere uniform stream for free |
| **The precedent to avoid** | `horizon-skirt.glsl` — a forked copy of the water shader, never instantiated, deliberately unbundled (`make-combined.py:39-41`) because its atmosphere GLSL drifted |
| Shader variant mechanism | Flag string substitution, not `#define`: `water-shader-template.txt:192-211`, `ocean-grid.js:886-890` |
| Generic tile builder | `ocean-patch-geometry.js:22` `OceanTile(worldSize, numCells, t,r,b,l)` — reusable as-is for bounded patches |
| Terrain-height ortho (the field's seed) | `foamCamera` `ocean-grid.js:792-796` (1024 sq, +/-2048 m, **4 m/texel**), rendered snap-gated at `:2683-2782` via `scene.overrideMaterial = positionPassMaterial` |
| Sibling-detection pattern to fork | `_resolveSkyProvider()` `ocean-grid.js:594`, plus the standalone fog scaffold at `:616` |
| Nested config | `ocean-config/config-core.js:138-223` `applyNestedConfig`; new group tags auto-hide via `:98-107` |
| Layers | `OCEAN_LAYER = 29` (`ocean-grid.js:51`); 30 = exclusion masks; 7-10 = CSM casters |
| Splash emitter API | `ocean-splash.js:498` `spawn(...)`, `:525` `emitImpact(...)` — already the shared "moving water hits a solid" channel |

### Single-ocean assumptions that must break

`oceanMaterial.uniforms` aliases the module-global template (`ocean-grid.js:908` — needs a
`cloneUniforms()` factory before any second body exists); `heightOffset` is one scalar
consumed by clip planes, both ortho cameras, the CSM pivot, the skirt Y and the submersion
probe; the five `ARestlessOcean.sampleWater*` globals have no body identity; the 2048 m and
250 m ortho half-widths are magic numbers duplicated between `ocean-grid.js` and
`water-shader.glsl:1189, 1444`; cascade count 6 is hardcoded into GLSL array sizes.

---

## The architecture

**One field. Three surface families. Shared services. One query.**

```
  a-faraway-land -- waterLevel . waterFlow . waterClass tiles + simulation{}
                              |
                              v
        +-----------------------------------------------+
        |  WaterField    (Phase 1 - the keystone)        |
        |  world-anchored cascade RTs + CPU reader       |
        |  level . depth . flow . energy . type          |
        |  shoreSDF . shoreNormal . dryMask              |
        +-----------------------------------------------+
                              |
      +-----------------------+-----------------------+
      v                       v                       v
   STILL                   FLOWING                 FALLING
   clipmap                 ribbons                 sheets + particles
   ocean, lakes            rivers, creeks          waterfalls, fountains
   FFT spectrum,           flow-map advection      ballistic sheet,
   TMA depth attn,         + wave profile buffers  plunge ring, mist
   breakers at shore       + foam accumulation
      |                       |                       |
      +-----------------------+-----------------------+
                              v
   shared services: foam accumulation RT . dynamic-waves sim .
   splash pool . underwater . caustics . ocean CSM . getWaterStateAt(x,z)
```

Three rules hold the whole thing together:

- **The field is the only source of truth about where water is.** Nothing samples terrain
  directly ever again. `depth == 0` is the universal discard; `oceanDry` distinguishes
  "below sea level but deliberately dry" — a-land's painted Dry Zones and dammed bays —
  from "not yet loaded".
- **Surfaces are material variants, not renderers.** Every family is a flag permutation of
  `water-shader.glsl` on a material clone registered into `oceanGridInstanceKeys`, so it
  inherits lighting, atmosphere, shadows, refraction and underwater for free. That is the
  horizon-skirt lesson, and `horizon-skirt.glsl` is what ignoring it looks like.
- **Families cross-fade over the field's own `energy` channel**, which a-land made
  continuous across regime boundaries precisely so we could do this. There is no "river
  object" boundary to see.

### How the River Editor techniques map onto this

Jean-Philippe Grenier's River Editor (<https://80.lv/articles/river-editor-water-simulation-in-real-time>)
is the named reference. The mapping is not one-to-one, because half of what it does at
runtime, a-land already did offline:

| River Editor | Ours |
| --- | --- |
| Lattice-Boltzmann shallow-water solve, 9 floats per cell, ping-pong | **Not needed at runtime.** a-land's priority-flood → D8 → Manning → Froude solve is the steady-state equivalent, baked. Live LBM stays shelved (floods, dam breaks, editor terraforming). |
| LBM velocity field advects foam and UVs | **Phase 4.** Two-phase flow-map advection — the Vlachos/Portal 2 crossfade, two samples offset half a cycle so scrolling never visibly stretches — over foam and detail UVs, driven by `waterFlow`. |
| Wave particles, later **Wave Profile Buffers** | **Phase 4, the centrepiece.** WPB samples on `(world position, time, wave direction)` with *no UVs*, which is exactly why it survives a curved, banked ribbon where a scrolled normal map tears and pulses. Build it as a shared primitive; the ocean can borrow it later. |
| Two imaginary infinite plane area lights for volumetric scattering | **Keep ours.** We already run physical Henyey-Greenstein inscatter plus Jerlov absorption, which is strictly better than the approximation. |
| Spline authoring with width / depth / flow handles | Lives in a-land's editor (contract §1). We consume the bake. |

"Flow graphs for deep rivers" is the **hydrograph** — Phase 7. It is what makes
"connections so they can feed into each other" a data structure rather than an art problem,
and it is the one significant amendment we owe a-land.

---

## The phases

Each is a session. Phases 0-3 are the spine; 4-7 are the new water; 8-9 close the loop.

### Phase 0 — Decompose `ocean-grid.js` *(do this first)*

3497 lines, and this plan hands it six new passes. Extract the existing ones — refraction
MRT, reflection/SSR, foam ortho, exclusion ortho, caustic projection, height readback, CSM
orchestration — into pass modules sharing an `init / resize / tick / dispose` lifecycle.
Pure refactor, zero visual diff.

Also the two prerequisites that only matter once a second body exists: a `cloneUniforms()`
factory to kill the `:908` global alias, and hoisting the 2048 m / 250 m ortho half-widths
into uniforms so they stop being duplicated in GLSL.

*Files:* `ocean-grid.js` into new `ocean-system/passes/*.js`; `make-combined.py:27`
`JS_FILE_NAMES`; `examples/demos/islands.html` script order.

### Phase 1 — `WaterField`: the terrain bridge and the field cache *(keystone)*

The single highest-leverage phase. Everything after it reads this.

- **`terrain-provider` prop**, symmetric to `sky_provider`. Fork `_resolveSkyProvider()`
  (`ocean-grid.js:594`) — same DOM-presence resolution, same reasoning about why
  token-absence cannot distinguish "not yet initialised" from "absent". `auto` resolves to
  `a-faraway-land` when `<a-land-terrain>` is present, else `standalone`.
- **`WaterField`**: camera-anchored, world-anchored cascade render targets (2-3 rings — the
  clipmap philosophy applied to data) holding, per texel: `level` (water surface Y),
  `depth`, `flow.xz`, `energy`, `type`, `shoreSDF`, `shoreNormal`, `dryMask`. Populated by
  decoding a-land's three tile stacks. `shoreSDF` and `shoreNormal` are **ours** to derive
  — jump-flood over the depth mask, then normalize the depth gradient — the contract
  deliberately leaves them on our side.
- **Standalone fallback**, behaviourally identical to 0.2.0: global sea level, `depth` from
  the existing foam ortho, `flow = 0`, `energy = 0`, `type` from `water_type`. The ocean
  must not notice whether the field arrived.
- **CPU mirror** reading the same decoded tiles, so GPU and CPU cannot drift.
- **Cache invalidation** on tile stream or edit. Needs a-land's tile events (§ Amendments);
  until they land, poll the director's generation counters.

*Files:* new `ocean-system/field/water-field.js` and `.../water-tile-decoder.js` (mirror
`WaterReader.js`'s scalar decoders *exactly* — they are the contract oracle), new
`config-terrain.js`, `ocean-state.js` schema, `ocean-grid.js` provider resolution.

> **Gotcha, worth writing down now:** FFT displacement is horizontal too. Any body or dry
> mask must be sampled at the **displaced** position, or shoreline edges crawl.

> **Gotcha, from a-land's own decoder header:** water tiles carry data in the alpha channel.
> A canvas `drawImage`/`getImageData` round-trip premultiplies and destroys the 24-bit
> surface height wherever depth < 255. Decode without canvas.

### Phase 2 — Still water on the level field (lakes fall out)

- `water-vertex.glsl:66-74`: sample the field for `Y` before cascade displacement.
- `water-shader.glsl`: `discard` where `depth == 0`. This subsumes the current layer-30
  exclusion mask for terrain indents. Keep the mask component for boat hulls, which the
  field knows nothing about.
- Clipmap ring placement (`ocean-grid.js:1033-1069`) and the submersion probe stop assuming
  one plane.
- **Per-body FFT dynamics** — the "lakes are just ocean" payoff. The honest constraint from
  `update-suggestions.md` still holds: the FFT field is global, so wave-shape variation is
  **per-cascade amplitude masks** driven by the field's `type` and `energy` (cheap, about
  90% of the effect), not a second spectrum bank. A tarn masks cascades 0-2 to near zero
  and reads as glass; the coast keeps them.
- **TMA finite-depth spectrum**: multiply the JONSWAP in `h_0-pass.glsl` by the
  Kitaigorodskii depth function, with a representative depth per cascade from the field.
- Mirror both in the CPU twin (`ocean-wave-field.js`), or buoyancy desyncs from the render.

*Files:* `water-vertex.glsl`, `water-shader.glsl`, `h_0-pass.glsl`,
`ocean-height-band-library.js:37,373-415`, `ocean-wave-field.js`, `ocean-grid.js`.

### Phase 3.0 — Investigation: nearshore wave dynamics *(research run, before building Phase 3)*

Prompted by the first `surveyShore()` on simple-islands (2026-09-12, numbers in
`WATER-TYPES-PROGRESS.md` § Phase 1c). The seabed sits at ~30° from a few metres out. At
12 m/s that means mostly plunging shore-break in a ~10 m surf zone, and at steep faces a
real share of the energy **reflects** instead of breaking. Phase 3 as written is
parametric: breaker profiles swept along `shoreSDF`. That gives breaking. It does not
give the other half of a real coast: water that runs up, drains back, piles into
coves, and bounces off rock with some energy loss. The question is whether that other
half needs a volume-conserving nearshore model, and if so, which one we can afford.

**Families to evaluate** (a starting list, not a shortlist):

1. **Parametric only.** Phase 3 as written: phase-locked breakers plus a swash sheet.
   Cheapest, and trivially CPU-mirrored. No reflection, no run-up interaction with
   terrain shape.
2. **Local shallow-water / Boussinesq height-field sim** in a camera window over the
   surf zone, forced at its offshore edge by the FFT field. Volume conservation,
   run-up, backwash and reflection emerge from it. The hard parts are known: the moving
   wet/dry front on 30° slopes at 1 m cells, CFL-limited timesteps, and absorbing the
   offshore boundary so the sim does not reflect back into the FFT ocean.
3. **Virtual-pipe SWE** (Mei, Decaudin & Hu 2007 lineage): volume-conserving by
   construction, robust wet/dry, cheap on a GPU. Well proven in erosion tools, and
   possibly the same machinery as the deferred live-river solver. Non-dispersive, so it
   will not carry swell shape by itself.
4. **Wave packets / Water Surface Wavelets** (Jeschke & Wojtan 2017; Jeschke et al.
   2018): reflection, refraction and diffraction at coastlines without a full grid
   solve. Already named under Deferred for ambient swell; evaluate it here for shores.
5. **2D wave equation / iWave-class** (Tessendorf): the Phase 8 dynamic-waves sim with
   reflective boundaries. Cheap reflection, reusable service, but no breaking and no
   run-up.

**Questions the run must answer:**

- **What shipped games actually do** for surf, swash and cliff reflection, and at what
  cost. Survey first, rather than assuming "the latest games simulate it". Many may
  fake it convincingly, which is itself the answer.
- **Hand-off.** How does a nearshore model take energy from the FFT ocean without
  double-counting it? That means a blend band keyed on `shoreSDF` and depth, with the
  FFT attenuated inside it. How does it hand energy back out as reflected waves?
- **Reflection coefficient per shore texel.** Classic coastal engineering gives
  reflection as a function of the same surf-similarity number `surveyShore()` already
  computes (Battjes 1974: Kr ≈ 0.1·ξ², capped at 1; check the source). If so, 1c's ξ
  map is directly a boundary condition, and cliffs vs beaches fall out of one field.
- **CPU parity** (cross-cutting rule). A GPU sim breaks the analytic Gerstner twin
  inside the surf zone. Is a readback window acceptable for buoyancy and splash, given
  the known `readRenderTargetPixelsAsync` PBO collision?
- **Foam and splash coupling.** Can the sim's convergence and velocity drive the foam
  accumulation RT and `_emitShore` directly, replacing the Jacobian-only shore drive?
- **Budget.** A cost per surf-zone window at 1 m cells in WebGL2, measured, not
  estimated.

**Deliverable:** `NEARSHORE-WAVES.md`, holding the game survey, a comparison of the
families against the questions above, and a recommendation that either confirms Phase 3
as written, amends it (e.g. parametric breakers plus a pipe-SWE swash layer with
ξ-driven reflection), or splits out a new phase. Spike prototypes run in a scratch
harness under headless Chrome (SwiftShader WebGL2, the real pass files loaded
directly), which is how 1c was verified without a browser session.

*Interacts with:* Phase 3 (may rewrite it), Phase 8's dynamic-waves sim (candidate shared
service), the deferred live-river SWE (candidate shared solver), and a-faraway-land's
beach-shaping tooling. That tooling is the cheaper lever if the answer is "rolling surf
needs gentler bathymetry, not more simulation".

### Phase 3 — Shorelines that break

Everything here reads `shoreSDF`, `shoreNormal` and `depth` from Phase 1.

- **Amplitude attenuation, shoaling, refraction** per texel: bend the displacement-sample
  direction toward `shoreNormal`, weighted by depth, so crests arrive shore-parallel.
- **Depth-limited breakers**: a phase-locked breaker profile — steep front, curling crest
  mask, foam burst — swept along `shoreSDF` iso-contours at sqrt(g*h), triggered on
  McCowan's `H > 0.78 * d`, with amplitude from the incoming cascade energy so storm seas
  make bigger surf.
- **Swash, backwash, wet sand**: a thin planar sheet running up the beach on breaker phase,
  using `getNormalAt` for slope. The wet-sand half is Phase 9.
- **Shallow colour** falls out of the existing Jerlov absorption for free, once it is fed
  true water-column depth instead of view distance — turquoise over bright sand as physics
  rather than paint.
- Retire `water-shader.glsl:1441-1470`'s 0.5-to-4 m `shoreFade` heuristic.
- `_emitShore` (`ocean-splash.js:815-935`) gains a **breaker** trigger, and drops its own
  finite-difference terrain scan in favour of the field.

### Phase 4 — The flowing-water material family

The shared base for every moving-water thing. Ships with **creeks** as its proof — the
cheapest rung, a terrain-conforming strip with a parallax-shaded bed and no refraction pass
— so the phase has a visible result on its own.

- **Two-phase flow-map advection** over foam and detail UVs.
- **Wave profile buffers** as the surface-wave primitive (see the mapping table above).
- **A foam accumulation RT.** Note that `water-shader.glsl:1439`'s comment already claims
  one exists. It does not — foam today is instantaneous per-fragment Jacobian
  (`:1344-1370`), which physically cannot produce the streaks that make a river read as
  flowing. This is a real new pass, and rivers do not work without it.
- **A `water_body_type` shader flag** joining `foam_enabled`, `caustics_enabled` and
  `atmospheric_perspective_enabled` in `water-shader-template.txt:192-211`.
- **CPU `queryFlow(x, z)`** so debris, splash ballistics and a-avatar can read the current.

### Phase 5 — Rivers: ribbons from the flow field

- **Centerline extraction** from the field: trace downstream along `flow` from each channel
  head, or consume a-land's optional spline hints where authored.
- **Ribbon generation**: extrude across-flow to the wet width, sample `level` for Y,
  **superelevate in bends** from curvature times v-squared over g*r, and carry a
  flow-aligned parameterization. `OceanTile()` is not the right builder here — this is a
  new generator — but it should emit the same vertex layout so the material clone works
  unchanged.
- **Banks**: the ribbon's outer edge feeds the wet-band publish (Phase 9) and an SDF foam
  collar around placed rocks.
- **Blend band** where `|v|` crosses the flow threshold, so a river entering a lake fades
  from ribbon to clipmap over metres rather than at a polygon edge.
- **LOD**: beyond the readback window, ribbons drop to flow-map only — no WPB, no foam RT.

### Phase 6 — Waterfalls and fountains

a-land already hands us `simulation.waterfalls[]` with `top`, `bottom`, `width`,
`discharge` and `drop`. Placement is solved; rendering is ours.

- **Tier 1, the sheet**: a ribbon from lip to plunge, scrolling shredded-noise alpha with
  vertical stretch increasing down the fall, Fresnel-lit edges.
- **Tier 2, the pool**: a base mist volume reusing the existing mist shader; a plunge-pool
  foam ring with radial flow injected into the foam RT and the flow field; splash particles
  at lip and impact via `emitImpact` (`ocean-splash.js:525` — already the right channel);
  and a dynamic-waves impulse so the pool genuinely churns.
- **Fountains**: the same emitter and sheet machinery, authored rather than solved
  (`<ocean-fountain>` with jet direction, discharge, basin level). The one member of the
  flowing family that needs no a-land.
- The tier-1 interface is deliberately **lip spline plus pool point**, which is exactly what
  a particle-fluid microsim would drop into later.

> **The structural cost, stated plainly:** nothing in the codebase supports a vertical water
> surface today. Displacement adds to Y, normals assume +Y up, `underwaterFactor` is a plane
> comparison, and the foam ortho is strictly top-down. Waterfalls are a genuinely new
> surface, not a variant, and this phase should be scoped expecting that.

### Phase 7 — The hydrograph: confluences, estuaries, plunge pools

This is the "connections so they can feed into each other" phase, and the one that needs a
contract amendment.

- **The hydrograph**: nodes (source, confluence, lake inlet and outlet, waterfall lip,
  plunge pool, river mouth, sink) and edges (reaches carrying discharge, width, slope,
  Froude). a-land's solve already computes every one of these — `bodies[]` and
  `waterfalls[]` *are* the nodes, with their connectivity thrown away at export time.
  Getting it back is a small ask. The fallback — tracing downstream through the flow field
  at load — is possible but fragile at braided reaches.
- **Estuaries** blend three channels at once: level (river reach fading to sea level), type
  (silty green into coastal blue), and flow (reach velocity decaying into the FFT's ambient
  drift). A brackish foam line is nearly free: divergence-test the flow field and seed foam
  at convergence.
- **Plunge pools** wire a waterfall's dynamic-waves impulse and foam injection to the
  correct downstream body via its edge.
- **Audio hooks**: publish surf intensity, river loudness, waterfall proximity and a
  camera-submerged flag on the A-Frame event bus. We never ship sound. We do know where the
  noise is — and the hydrograph is what makes "the nearest waterfall" an answerable query.

### Phase 8 — `getWaterStateAt(x, z)` and interaction

One sanctioned entry point returning `{level, depth, flow, orbitalVelocity, bodyId, type,
energy}`, consolidating the analytic Gerstner twin (`ocean-wave-field.js`), the
triple-buffered FFT readback (`ocean-grid.js:1160-1381`) and the field. The five existing
`ARestlessOcean.sampleWater*` globals become thin shims over it — today a swimmer in a
mountain river is answered with **ocean height**, silently.

Then: a **local dynamic-waves sim** (2D wave equation, camera-centered, with the
shallow-water term from the field so ripples slow, steepen and reflect off shores
naturally); an **interaction-emitter API** generalizing the existing `buoyancy-splash`
trigger; and **rain** as a field of ring kernels. Consumers: `buoyant.js`, a-avatar wading
and swimming, flow-riding debris.

### Phase 9 — Terrain feedback

Close the loop the other way, through a-land's `material-extensions.js` sockets:

- **`water-wet-band`** — land owns the wetness state (accumulation map, drying clock). We
  publish only *where our animated surface is this frame*: a small ortho
  water-surface-height RT near shore, plus its world-to-UV transform. Static waterlines
  (lakes, rivers) need no per-frame feed; the `waterLevel` tiles already say where they are.
- **`water-caustics-receive`** — depth-gated caustics from our existing projector
  (`ocean-grid.js:297-473`) instead of generic lit-mesh splash.

Both sockets are specified in contract §4 and **not yet placed** in a-land's shaders.

---

## Amendments to negotiate with a-land

Per the contract's own preamble: *"where the two documents disagree, flag it in both —
neither side wins silently."* Ordered by how soon we hit a wall without them.

1. **Hydrograph connectivity** *(blocks Phase 7)* — `simulation.bodies[]` needs stable
   `id`s, and we need `edges[]` linking source → reach → lake → outlet → fall → pool → sea,
   plus `from` / `to` on each `waterfalls[]` entry. The solve computes all of it; only the
   export discards it.
2. **Tile events** *(blocks Phase 1 invalidation)* — `a-land-tiles-ready` and
   `a-land-tile-changed` DOM events. `world-authority.js:44` has `invalidateTile`; nothing
   surfaces it to siblings.
3. **Material sockets** *(blocks Phase 9)* — place `// @inject:water-wet-band` and
   `// @inject:water-caustics-receive` in the terrain shaders. The registry exists; the
   sockets are not in the source.
4. **Formalize the terrain-only render layer** — we already run this convention on layer 30.
   Contract §3 promises a-land will flag terrain meshes so our ortho bakes never capture
   props and boats. Nearly free on their side.
5. **`shoreline.fetchBake`** *(optional, Phase 3 quality)* — per-shore open-water exposure
   so surf amplitude follows geography. Absence means "use the ocean's own wind fetch".

### Corrections to the companion documents

- `update-suggestions.md`'s ground rules state that a-land "has no hydrology of any kind
  yet" and that `getNormalAt` is a stub. Both were true in June 2026. **Both are false now.**
- `a-land-water-contract.md` §2 sketches `bodies[].id` and `bodies[].discharge`;
  `save.js:1392-1397` actually writes `{kind, level, areaM2, outletM3s?, auto?}` — no `id`,
  and `outletM3s` rather than `discharge`.
- Contract §3 promises three separate queries (`getWaterLevelAt` / `getWaterDepthAt` /
  `getWaterFlowAt`). One combined `getWaterAt` shipped instead — better, and already exposed
  on the public `land-terrain.api` (`land-terrain.js:333`) alongside `getHeightAt` and
  `getNormalAt`. Amend the contract to match reality.

---

## Cross-cutting rules

- **Shaders**: edit the `.glsl` and the `-template.txt`, never the generated `.js`. Then
  stop and hand it to Dante to run `create-shader.py` — do not invoke the build scripts.
  GLSL comments must not mix apostrophes with embedded double quotes; it breaks
  `create-shader.py`'s quote picker and corrupts the JS output.
- **Never fork `water-shader.glsl`.** New surfaces are flag permutations on material clones
  registered into `oceanGridInstanceKeys`. `horizon-skirt.glsl` is the cautionary tale, and
  it is unbundled for exactly this reason.
- **A new source file** must be added to `make-combined.py:27` `JS_FILE_NAMES` **in the
  right order** and to `examples/demos/islands.html`. Debug-only code goes inside the
  `$DEBUG_START$` / `$DEBUG_END$` markers (stripped from dist at `make-combined.py:74`);
  watch the min-build GLSL strip, which has eaten an injection-point marker before.
- **Config discipline**: every feature ships a nested-config child (`<ocean-terrain>`,
  `<ocean-shoreline>`, `<ocean-river>`, `<ocean-waterfall>`, `<ocean-fountain>`,
  `<ocean-interaction>`) through `ocean-config/`, debug modes documented in
  `DEBUG_MODES.md`, and an example page. If it cannot be authored from HTML, it did not
  ship.
- **Live-tunable uniforms** are plain JS fields uploaded in the per-frame loop at
  `ocean-grid.js:3132-3336` — not A-Frame `data`, and not the construction loop.
- **Sim LOD is declared at construction.** Every new pass states its gate: dynamic waves
  decimate by distance to nearest injector, ribbons drop to flow-map only beyond the
  readback window, waterfalls LOD from sheet to billboard, breakers cull by shore-SDF
  window. The clipmap philosophy, applied to simulation.
- **CPU/GPU parity is a promise, not an aspiration.** Any displacement change lands in
  `ocean-wave-field.js` in the same session, or buoyancy and splash silently disagree with
  what is on screen.
- **Naming**: `water_type` already means Jerlov optical preset (`ocean-state.js:40`). Body
  kind needs a different key. Do not overload it.
- **Physical before stylistic.** Where both paths exist, take the physical one, and flag any
  fudge explicitly in a comment.

---

## Verification

Per phase, in the browser, against `examples/demos/islands.html` and a new
`examples/demos/rivers.html` built on an a-land world with a solved bake.

- **Phase 1** — `window.oceanGrid` is already exported; add a field inspector and one debug
  mode per channel (level, depth, flow, energy, type, shoreSDF) in the 40+ range of
  `DEBUG_MODES.md`. Assert the GPU decode matches `WaterReader.sampleTile` at sampled
  points: a-land's `tests/test-water/` suite is the encode oracle, and our decoder must
  agree byte-for-byte or 24-bit level heights corrupt wherever depth < 255.
- **Phase 2** — a lake at altitude renders at its own level with no clipmap seam, and the
  ocean is visually unchanged from 0.2.0 with no provider present. That standalone
  regression is worth re-running every phase, not just this one.
- **Phase 3** — breakers track the shoreline as the level changes; buoyancy and spray still
  agree with the rendered surface inside the surf zone.
- **Phase 5** — walk a river from source to sea. No visible transition at the
  ribbon-to-clipmap blend band, and no UV stretching in bends. That second one is the WPB
  acceptance test.
- **Phase 8** — `getWaterStateAt` answers correctly for a point in a mountain river, which
  today returns ocean height.
- **Perf** — every phase re-checks `tickCPU`. Note the known a-starry-sky program-churn
  regression (programs 67 to 88+, bleeding into our offscreen passes); do not attribute new
  cost to new passes without ruling that out first.

---

## Deferred, deliberately

Runtime LBM and hybrid SWE rivers — floods, dam breaks, terraforming a riverbed in the
editor and watching the water re-route. The baked river deliberately shares its data
contract, so a live solver is a backend swap rather than a new feature.

Particle-fluid microsims at waterfall lips and plunge pools. "Water Surface Wavelets"-class
ambient swell that refracts and diffracts around coasts (the shoreline half of that
question is now Phase 3.0's investigation). Kelvin wakes. Underwater god rays.

The shared wind and weather bus — a-land's `getWindField()` is built and waiting, and its
`WIND.md` says we are one of the two consumers it was written for. A small, high-charm phase
whenever it is wanted.

And WebGPU, per decision 3.
