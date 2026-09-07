# The A-Land Water Contract

The answer to `update-suggestions.md` § "The A-Faraway-Land Contract", written from the
terrain side. Agreed with Dante 2026-07-10; a-land work happens on its `add_water_tooling`
branch. Where the two documents disagree, flag it in both — neither side wins silently.

> **Ground rule (the "helps, not needs" clause):** a-restless-ocean must run standalone.
> Everything below is an *optional* enrichment: the ocean discovers a-land data via
> events/attributes when present and falls back to its own defaults when absent. Every
> endpoint is documented as a plain data shape so a determined user can hand-author the
> same textures and JSON and drive the ocean themselves without a-land in the scene.

## 1. How water gets authored on the a-land side (context)

Water is a **global world bake** ("Solve Water"), not a per-layer recompute. The user
authors *intents* in the editor's Water chunk; the solve derives everything else:

- **Sea level** — one global height.
- **Lakes** — user-set height bits: "water surface at Y here." Presumed steady state.
- **Sources / sinks** — a source emits indefinitely at a discharge set by its initial
  authored area; sinks absorb. Conservation is deliberately magical: if a river
  overflows its evident intent, excess is softly absorbed rather than flooding the map.
- **River splines** — optional *hints* that override the solve's routing, not the
  primary way rivers exist.

The solve itself is steady-state hydrology on the LOD-0 heightmap (machinery already
proven in a-land's erosion bake): priority-flood fill → D8 routing → drainage
accumulation → discharge (Q ∝ drainage^m) → Manning's equation for per-cell depth and
velocity → **Froude number** (Fr = v/√(g·d)) for regime classification. Any terrain
modification the solve wants (channel bed carving) lands as a **generated terrain
layer** in a-land's layer stack, so re-running the solve replaces it non-destructively.

Two more authored layers ride on top: **Look** (Jerlov/turbidity paint, seeded by the
solve — high-energy reaches turbid, alpine ponds clear) and **Flow overrides** (sparse
painted velocity deltas over the baked field).

## 2. The water tile stack (the data contract)

The solve exports per-tile texture pyramids alongside height/splat, registered as new
`sources` entries in `map.json` (same `tiles/<name>/{lod}/{x}_{y}.png` scheme, same
tileSize/maxLod fields, same LOD discipline: one box-filtered derivation per producer,
streamed tiles byte-equal to live-composited ones at every lod).

### `waterLevel` — `type: "water-level-png"`
- **RGB**: 24-bit water *surface* height, encoded over `bounds.verticalRange` exactly
  like height tiles. Meaningful only where wet. No float formats needed: 24 bits scale
  with the range, so even an Olympus-Mons-to-Mariana world (±30 km) resolves to ~2 mm
  steps. Browsers decode `<img>` PNGs to 8-bit per channel regardless, which is why the
  wire format is split-channel PNG; runtimes are free to expand into float render
  targets internally.
- **A**: water depth, 8-bit **sqrt-encoded** over `simulation.maxDepth` metres
  (`depth = (v/255)² · maxDepth`). **0 = dry** — this doubles as the coverage mask.
  Sqrt encoding puts the resolution where shoaling lives: at `maxDepth` 60 m the first
  wet step is ~1 mm and steps near full depth are ~0.5 m, where nothing visual depends
  on them. (Depth is level − ground at bake time; we ship it precomputed so consumers
  never need a matching-LOD ground sample.)

### `waterFlow` — `type: "water-flow-png"`
- Velocity vector (world XZ), **16 bits per axis** via the same split-channel trick as
  height tiles: **RG** = X (hi, lo), **BA** = Z (hi, lo). Each axis signed-encoded over
  `±simulation.velocityRange` m/s with raw 32768 = exactly 0, scale 32767 — so still
  water is *bit-exact still* (no 8-bit drift shimmer in lakes) and steps at ±16 m/s are
  ~0.5 mm/s. Vector (not polar) encoding so bilinear filtering stays valid; consumers
  must reassemble hi/lo before filtering (sample the four channels, combine, then
  interpolate — same rule as height tiles).

### `waterClass` — `type: "water-class-png"`
- **R**: turbulence energy, 0–1, Froude-derived (see § 5). Continuous across regime
  boundaries — this is the backend cross-fade field.
- **G**: water type — index into `simulation.waterTypes[]` (Jerlov preset + turbidity),
  quantized; consumers may treat it as a blendable scalar between adjacent entries.
- **B, A**: reserved (candidates: foam persistence, shoreline fetch/exposure).

**Dry tiles are omitted.** A tile with no wet texels is simply not written; consumers
treat a missing water tile as all-dry (depth 0 everywhere). Water coverage is sparse,
so the three-texture stack costs roughly nothing over dry land. The `simulation` block
carries a `wetTiles` index (`{ "<lod>": [[x,y], ...] }`) so consumers can skip fetches
entirely and stale files from an earlier bake are ignorable.

### `map.json` `simulation` block (field already reserved in a-land's schema)
```json
"simulation": {
  "version": "0.1.0",
  "seaLevel": 12.0,
  "maxDepth": 60.0,
  "velocityRange": 8.0,
  "waterTypes": [ { "jerlov": "IB", "turbidity": 0.1 }, ... ],
  "bodies":     [ { "id": "lk_tarn", "kind": "lake|ocean|river", "level": 84.0, "discharge": 3.2 } ],
  "waterfalls": [ { "top": [x,y,z], "bottom": [x,y,z], "width": 4.0, "discharge": 3.2 } ],
  "shoreline":  { "fetchBake": "tiles/fetch/{lod}/{x}_{y}.png" }
}
```
`waterfalls` is placement metadata only — rendering them (baked-loop VAT, SPH, etc.) is
explicitly out of scope for v1. `shoreline.fetchBake` (per-shore open-water exposure so
surf amplitude follows geography) is optional and may ship later; absence means "use
the ocean's own wind fetch."

## 3. Runtime hooks (answering "Runtime data access")

- **`getNormalAt(x, z)`** — a-land commits to finishing the stub. `getHeightAt` is
  already bilinear on the LOD-coherence v2 sampler; normals get the same treatment.
- **New water queries** — `getWaterLevelAt`, `getWaterDepthAt`, `getWaterFlowAt`:
  CPU-side, bilinear, reading the same tile stack the GPU streams. This plus
  `getHeightAt`/`getNormalAt` is the buoyancy/wading story.
- **Tile events** — `WorldAuthority` already has `invalidateTile`; a-land will surface
  `a-land-tiles-ready` / `a-land-tile-changed` (lod, x, y, source) DOM events on the
  terrain element so the depth/shore cache re-bakes on change instead of polling.
- **Terrain-only render layer** — a-land formalizes the layer-30 convention (terrain
  meshes flagged, props excluded) so ortho depth bakes never capture boats.

Discovery: the ocean listens for the events / inspects the terrain element when a
`terrain-provider` (working name, symmetric to `sky-provider`) is pointed at it.
No provider → no behavior change from 0.2.0.

## 4. Terrain material sockets (answering "Terrain material hooks")

a-land places two reserved `MaterialExtensions` sockets in the terrain shaders:
- **`water-wet-band`** — **land owns the wetness state**: a persistent runtime
  wetness/drying map (accumulation texture, drying rate, never persisted to disk) that
  the socket reads to darken albedo / lift gloss. The ocean's only job is to publish
  *where its animated surface is this frame* — a small ortho water-surface-height
  render target near the shore plus its world→UV transform via the provider bridge
  (uniform fallback: waterline Y + swash reach). Land compares that against its
  heightmap each frame to wet texels, then dries them on its own clock. Static
  waterlines (lakes, rivers) need no per-frame feed — the `waterLevel` tiles suffice.
- **`water-caustics-receive`** — depth-gated caustics from the ocean's projector.

Additionally (a-land-internal, but it affects what shores look like): water depth and
flow speed join a-land's procedural mask family (height/slope/aspect/curvature), so
texture layers can key riverbed/wet-margin materials off the solve automatically.

## 5. Regime classification → backend selection

The solve classifies each wet cell; the ocean picks the rendering/sim backend per
region and cross-fades over the shared energy field (§ 2):

| Regime | Signal | Backend |
| --- | --- | --- |
| Deep / calm (ocean, lakes, slow rivers) | Fr « 1 | FFT/spectral clipmap surface (exists today), TMA finite-depth planned |
| Whitewater / rapids | Fr ≳ 1 (threshold is a user slider + per-body override) | wave-particle / flow-map family (v0.3.0 "flowing-water material"); LBM stays on the research shelf |
| Waterfalls | slope > threshold along a channel | metadata only for now (§ 2) |
| Splash/plunge microsim | — | SPH, deferred; inputs (discharge, segment geometry) already in the metadata |

Beaches deliberately do **not** use the river machinery: shoaling/refraction/shore foam
come from the ocean's planned TMA + shoreline pipeline, fed by `waterLevel` depth and
(optionally) the fetch bake.

## 6. Sequencing

1. **a-land**: Solve Water bake (fields + classification) → tile-stack export →
   `simulation` block → water queries + tile events + `getNormalAt` → material sockets.
2. **a-water**: can start *now* against a hand-authored fixture world (one lake, one
   river, one coast, tiles drawn by hand to this spec) — that fixture is also the
   documentation artifact proving the "drive it yourself" clause.
3. Format changes bump `simulation.version`; both repos' docs get the diff.
