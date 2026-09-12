# Multi Water Types: progress log

Running record of the phases in [`WATER-TYPES.md`](./WATER-TYPES.md) as they land.
One section per phase: what shipped, where things moved, what was deviated from,
what is deferred, and what still needs a human to look at it.

The architecture doc stays the plan. This file is the log.

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
