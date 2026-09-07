# Multi Water Types: progress log

Running record of the phases in [`WATER-TYPES.md`](./WATER-TYPES.md) as they land.
One section per phase: what shipped, where things moved, what was deviated from,
what is deferred, and what still needs a human to look at it.

The architecture doc stays the plan. This file is the log.

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
