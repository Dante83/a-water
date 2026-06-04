# Sea Spray & Mist Research — Splash Emulation for the Water System

Research notes on simulating airborne water from wave action: crest spindrift, breaking
whitewater, shore impact, and hull slap. Written to sit alongside `ocean-splash.js`
(the CPU-pooled `THREE.Points` system already in this branch) and to map out what we
could pull in or build next.

> Scope reminder: real-time, WebGL/THREE.js, A-Frame. Everything below is judged for a
> game/visualisation budget, not offline VFX. Offline techniques are summarised only so
> we know what we are approximating.

---

## 1. Taxonomy — the distinct phenomena

"Splash" is several physically different things that read differently on screen. Treating
them separately is what makes water feel alive. Ordered roughly by scale:

| # | Phenomenon | Physical cause | Visual read | Lifetime | Our coverage |
|---|------------|----------------|-------------|----------|--------------|
| 1 | **Spindrift / spray** | Wind shears droplets off wave crests | Thin streaks blown downwind off the top | 0.5–2 s | `_emitCrest` (type 0) |
| 2 | **Spume / foam streaks** | Persistent surface foam (whitecaps) advected by flow | Flat on-surface streaks, not airborne | seconds–minutes | FFT broadband-foam RT (separate system) |
| 3 | **Breaking-wave whitewater / plunge** | Wave overturns, entrains air, throws a curtain | Dense vertical sheet + ballistic droplets | 1–3 s | partially (crest), no plunge sheet yet |
| 4 | **Shore swash & uprush spray** | Wave runs up a slope, decelerates, throws up | Burst angled up the beach normal | 0.5–2 s | `_emitShore` → `emitImpact` (type 1) |
| 5 | **Impact splash (object hits water)** | Hull, rock, body enters/strikes water | Radial crown + ballistic jets | 0.5–2 s | `emitImpact` via `buoyancy-splash` |
| 6 | **Wake spray / bow spray** | Vessel pushes water aside at speed | Continuous sheets off the bow/hull | continuous | NOT yet (deferred: continuous hull-slap) |
| 7 | **Mist / haze layer** | Aerosolised fine droplets hanging over surf | Volumetric fog band hugging the surf zone | persistent | NOT yet (candidate: see §6) |

The first thing most engines get wrong is collapsing 1, 3, 5 into one "particle puff."
Keeping the *emission rule* distinct per type (steepness+rise vs. impact speed vs. plunge
front) is more important than the particle shader itself.

---

## 2. How this is generally approached

Three broad strategies, usually combined:

### 2.1 Particle systems (the workhorse)
Billboarded sprites or instanced quads spawned by an emission heuristic, integrated
ballistically (gravity + drag + wind), faded over life. This is what we do.

- **CPU particles** — simple, debuggable, fine to a few thousand. Emission can read
  arbitrary CPU state (our analytic Gerstner field, foam RT readback, physics events).
  Cost is the per-frame attribute upload and JS integration. *This is our v1.*
- **GPU particles** (transform feedback / `GPUComputeRenderer` ping-pong textures) —
  position/velocity live in float textures, updated by a fragment shader. Scales to
  100k+. Downside: emission from CPU events needs a plumbing channel (write into an
  emission texture or a ring-buffer of spawn slots), and debugging is opaque. This is
  the documented scale-up path in `project_splash_particles`.
- **Stretched / streak billboards** — quad stretched along the velocity vector so fast
  droplets read as motion-blurred streaks (essential for wind-blown spindrift). Cheap
  upgrade over round sprites; cited as deferred work. Crest, Sea of Thieves, and most
  AAA water do this.

### 2.2 Mesh / sheet-based whitewater (breaking waves)
A plunging breaker is poorly served by point sprites — it is a *sheet* of water. Options:

- **Curtain mesh**: a strip of geometry extruded along the breaking front, animated with
  a flipbook/erosion alpha. Cheap, very art-directed; good for a fixed shoreline.
- **Metaball / screen-space fluid** (Müller "Screen Space Fluids"): render particles as
  spheres into a depth buffer, smooth (bilateral blur) the depth, reconstruct normals,
  shade as a surface. Gives connected, liquid-looking sheets from particles. Heavier;
  used in offline-ish realtime demos. Probably overkill for our budget.
- **SPH / FLIP fluid sims** baked or live — out of scope for an open ocean; reserved for
  hero close-ups (e.g. a single dramatic crash). Tools: NVIDIA Flow, Houdini bake → VAT.

### 2.3 Texture / shader-only (no particles)
- **Whitecap & foam masks** driven by wave Jacobian/steepness, blended on the surface
  (we already do broadband-Jacobian foam). This is *foam*, not airborne mist, but it is
  half the read of "rough sea" and cheaper than any particle.
- **Scrolling spray texture on a skirt/band** near shore — a translucent animated texture
  on a ribbon following the coastline. Zero simulation, reads as continuous surf haze.
- **Screen-space spray post-fx**: detect high-foam / high-slope pixels and bloom/jitter
  them. Rarely convincing alone; good as a sweetener.

**Industry baseline today:** GPU particles for spray + Jacobian foam on the surface +
stretched billboards for wind streaks + (sometimes) a screen-space mist band near surf.
Notably, the current crop of **THREE.js/WebGPU ocean kits converge on cascaded FFT +
Jacobian surface foam but do NOT ship airborne spray** (verified June 2026 for Tidewater
— source-included, foam only; and Three.js Water Pro — three foam layers, no spray). So
our particle spray genuinely fills a gap the off-the-shelf kits leave open. (See §5 for
the corrected note on Crest's spray status — unconfirmed, not "definitely none.")

---

## 3. Emission heuristics — the part that actually matters

The look lives in *where and when* you spawn, far more than the sprite. Field-tested rules:

### 3.1 Crest spindrift (open water)
Spawn where the surface is **steep AND rising** (a crest about to throw):
- steepness = `1 - normal.y` over a threshold (we use 0.32),
- vertical velocity = finite-difference of height over a small dt, over a threshold,
- optionally gate on **wave age / breaking criterion**: foam/whitecap coverage from the
  Jacobian, or the Phillips/JONSWAP-derived breaking probability.
- Launch mostly **downwind** with a small upward component; carry a fraction of wind
  velocity (`crestWindFactor`). Real spindrift is almost horizontal in strong wind.

Refinement worth doing: tie spawn *rate* to wind speed (Beaufort). The classic empirical
fit (Monahan & O'Muircheartaigh 1980) gives whitecap fractional coverage
`W = 2.95e-6 · U₁₀^3.52` — i.e. roughly **cubic in wind speed** with a low-wind cutoff
(Monahan 1993 forces a minimum-wind threshold below which there are no whitecaps). The
cubic exponent is a useful approximation, not gospel — satellite-derived fits land
anywhere from ~quadratic to >3.5 depending on method and sea state (see §10 refs). For
our purposes the takeaway is the *shape*: a hard low-wind cutoff (~3–4 m/s ≈ Beaufort 3)
then a steep super-linear rise. A single `windSpeed → spawnChance` curve of that shape
makes calm vs. storm read correctly for free, and the cutoff early-out is also a perf win.

### 3.2 Breaking / plunge front
Beyond per-point steepness, detect a **moving breaking line**: places where the wave
face exceeds a critical slope and the horizontal particle velocity exceeds the phase
speed (the classic kinematic breaking criterion). Emit a denser, more vertical curtain
there, optionally with a curtain mesh (§2.2). We do not do this yet; it is the biggest
visual gap for dramatic seas.

### 3.3 Shore swash
Where the wave surface height meets terrain height (within a band) and is rising, burst
**up and away from the terrain gradient** — exactly our `_emitShore`. Key realism levers:
- spray volume ∝ closing speed (we do, via `rise`),
- bias direction by beach slope (steep rock → vertical wall of spray; shallow sand →
  low sheet running up the beach),
- add a brief **backwash** darkening / no-spray phase so it pulses with the wave period.

### 3.4 Object impact (hull/body)
Burst ∝ impact speed, in a cone around the contact normal, biased upward (our
`emitImpact`). Two upgrades:
- **entry crown vs. continuous slap**: a one-shot crown on entry (have it) PLUS a
  continuous emission while a fast hull is in contact (deferred — `buoyancy-splash`
  currently fires once on entry only).
- **bow spray**: sample hull velocity vs. water; where the bow pushes water sideways,
  emit continuous sheets. Needs hull velocity + waterline contact, which buoyancy
  already computes.

---

## 4. Rendering the droplets — shading & compositing

What separates "white dots" from "spray":

1. **Soft particles** — fade alpha as the sprite approaches scene depth so droplets sink
   into hulls/terrain instead of hard-clipping. We do this against the refraction
   G-buffer linear depth (`uLinearDepth`), gated on `a>0.5` so open-water spray survives.
2. **Lifetime alpha curve** — fast fade-in, long ease-out (we do). Real spray thins as it
   disperses; a linear fade looks like teleporting dots.
3. **Lighting** — spray is mostly **scattering**, not specular. Tint by sun colour + sky
   ambient (we pass `sunColor`/`skyAmbientColor`). Strong **back-lighting / rim** is the
   signature look: spray glows when the sun is behind it (forward Mie scattering). Worth
   adding: a `dot(viewDir, sunDir)`-driven brightness boost so backlit mist halos.
4. **Stretched billboards** for streaks (deferred, see §2.1).
5. **Depth sorting / blending** — `NormalBlending` with `depthWrite:false` (we do). Some
   engines use **additive** for thin backlit mist and **alpha** for dense crowns; a
   per-type blend would help, but additive needs care with tonemapping.
6. **Tonemap parity** — RAW ShaderMaterial means we self-apply ACES + sRGB to match the
   water surface we blend over (documented gotcha in `ocean-splash.glsl`).
7. **Colour** — not pure white. Aerated water is slightly blue-green in the core, white
   at the edges; deep shadow spray picks up the water body colour. A subtle tint by
   `vAge01` (whiter young, greyer old) adds realism cheaply.

---

## 5. Libraries / engines worth studying or pulling from

Realistically THREE.js gives us the primitives; most "libraries" are references, not drop-ins.

*Verified June 2026 via web research — versions and claims checked against current
sources (see §10). Where I previously asserted things from memory and was wrong, it's
flagged ⚠️.*

| Source | What to take | Notes (verified 2026-06) |
|--------|--------------|--------------------------|
| **Crest (Unity)** — now **Crest Water 4** (URP/HDRP, v4.22.3 Aug 2025) and **Crest Water 5** | Jacobian foam model (already ported), LOD/cascade architecture, breaking-wave detection ideas | ⚠️ **Correction:** I earlier said "no spray, foam only." I could NOT confirm that from current sources — Crest is described as managing "spray and foam" whitewater, and the paid v4/v5 line is closed-source. Treat Crest's spray status as *unverified*; our spray remains bespoke regardless. The **open-source** legacy `crest-oceanrender` (Unity) on GitHub is the one that is foam-centric. |
| **Three.js Water Pro** (paid) | Reference for a modern **TSL + WebGPU** FFT ocean with **three foam layers** (wave-break whitecaps, ambient surface foam, shoreline foam) | Closed/paid. Foam is surface-layer; no airborne-spray particle system advertised. Good architecture reference, not a drop-in. |
| **Tidewater** (paid, ~May 2026, **source included**, $75) | Closest analogue to *our* stack: cascaded FFT (3 spectrum bands) + Gerstner swells, **CPU mirror for buoyancy**, world-locked 512 **wake field**, compression-driven foam, underwater (Snell window, caustics, god rays), WebGPU + WebGL2/TSL | ⚠️ Confirmed **surface foam only — no airborne spray/whitewater particles**. So spray is still an open niche even in the current paid kits. Validates our architecture choices almost point-for-point. |
| **WebTide** (Barth Paléologue, **MIT**, GitHub `BarthPaleologue/WebTide`) | Clean Tessendorf FFT + Phillips spectrum on WebGPU; foam left as a stated Jacobian extension | Open source, great study ref; no foam/spray implemented yet. |
| **jbouny/fft-ocean** (GitHub) | Older but readable WebGL FFT ocean for THREE | Foam-light; historical reference. |
| **three.quarks** (v0.17.0, ~May 2026) | Mature THREE VFX lib: **batched rendering**, many emitter shapes (cone/sphere/mesh-surface…), bursts, curves, sprite-sheet/flipbook, trails, **visual editor + JSON export**, ~Unity-Shuriken parity | Zero-dep core + single-three runtime. Strongest candidate to replace our hand-rolled pool *if emitter authoring gets painful*; trades fine control for features. |
| **THREE.js `GPUComputeRenderer`** | GPU particle ping-pong if we exceed ~5k CPU particles | In `examples/`; the documented scale path. Don't pre-optimise. |
| **THREE.js `Points` + custom shader** | what we use now | Fine to a few thousand. |
| **NVIDIA WaveWorks / FFT papers** | spectrum-driven whitecap & spray emission | Reference math, not code. |
| **Tessendorf, *Simulating Ocean Water*** | Jacobian/foam breaking criterion | Canonical source for *where* to spray; the Jacobian is what WebTide/Tidewater/Crest all key foam off. |
| **"Screen Space Fluids" (van der Laan / Müller)** | particle→surface for connected sheets | Heavy; only if we want liquid plunge sheets. |
| **Sea of Thieves / AC IV: Black Flag GDC talks** | art-direction of layered spray + foam + mist | Best look references for stylised-but-believable seas. |
| **Houdini Whitewater Solver → VAT** | bake a hero crash sim to a flipbook mesh / vertex-anim texture | For a single scripted dramatic wave, not ambient sea. The SideFX whitewater solver is the industry standard for offline spray/foam/bubble layering — useful as a *model* for the spray/foam/mist split even though we can't run it live. |

**2026 landscape, in one line:** the current crop of THREE/WebGPU ocean kits (Water Pro,
Tidewater) have converged on **cascaded FFT + Jacobian-driven surface foam** — and *none
of them ship airborne spray*. Our CPU-particle spray + impact/shore/crest emitters is
genuinely filling a gap the off-the-shelf kits leave open. So there's nothing to "just
import" for spray; the useful imports would be *foam/architecture* references (we're
already aligned) and a *general particle lib* (three.quarks) if we outgrow the hand-roll.

**Recommendation (unchanged, now evidence-backed):** stay with our CPU `THREE.Points`
pool for ambient spray; evaluate `three.quarks` only if emitter authoring becomes painful;
reserve `GPUComputeRenderer` for a measured particle-count problem.

### 5.1 The high end — what AAA & film actually do for spray

The off-the-shelf web kits (§5) are the *floor*. Above them, spray stops being "a particle
emitter bolted onto an FFT surface" and becomes **a classified diffuse-material layer
derived from the fluid state**. The canonical model — and the one nearly everything else
cites — is:

> **Ihmsen et al. 2012, *Unified Spray, Foam and Bubbles for Particle-Based Fluids*** (The
> Visual Computer). One particle pool of "diffuse" water-air mixture, generated by three
> physically-motivated **potentials**, then **classified by local neighbour count** into
> three behaviours:
>
> | Potential (where to spawn) | Reads | Our analogue |
> |---|---|---|
> | **Trapped-air** Iₜₐ — neighbours moving *differently* (shear/convergence trap air) | churn, wakes, impact fronts | ❌ none yet |
> | **Wave-crest** I_wc — surface convex *and* moving along its normal (a crest about to throw) | spindrift off breaking tops | ✅ our `crestSteepness × rise` gate **is a hand-rolled I_wc** |
> | **Kinetic energy** I_k — ½·m·v² | fast water → more spray | ✅ our impact `burst ∝ speed` |
>
> | Class (how it behaves), chosen by neighbour count | Behaviour | Our analogue |
> |---|---|---|
> | **Spray** (few neighbours, airborne) | ballistic: gravity + air drag | ✅ exactly our integrator |
> | **Foam** (medium, on the surface) | advected by local fluid velocity, lifetime fade | ⚠️ we do this *separately* as the Jacobian foam RT, not as particles |
> | **Bubbles** (many neighbours, submerged) | buoyancy + drag, follow the flow | ❌ none |

The big takeaway for us: **we've independently reinvented two of Ihmsen's three potentials
and the spray class.** The conceptual upgrades that would move us toward the high end are
(a) a **trapped-air potential** (emit where neighbouring surface velocities diverge — i.e.
along wakes and impact fronts, not just on crests), and (b) treating spray/foam/bubbles as
**one classified continuum** rather than three unrelated systems. Even keeping our CPU/
heuristic approach, borrowing the *potential* formulation gives a principled "how much
spray, where" instead of per-emitter fudge thresholds.

**Above that again (mostly out of real-time reach, useful as targets):**

- **Real-time particle fluids in the browser are now genuinely a thing.** `matsuoka-601/
  webgpu-ocean` (MIT) runs **MLS-MPM at ~100k particles on integrated GPUs, ~300k on
  discrete**, in WebGPU — and explicitly lists *implementing Ihmsen diffuse rendering* as
  TODO. This is the closest thing to a "high-end spray in WebGPU" reference codebase, and
  it's open. Not a drop-in for an open *ocean* (it's a contained 3D fluid), but the
  MLS-MPM + diffuse-particle stack is exactly the next tier.
- **SIGGRAPH 2023 course**, *Building a Real-Time System on GPUs for Simulation and
  Rendering of Realistic 3D Liquid in Video Games* — the AAA "how to ship GPU fluid + spray
  at frame budget" reference.
- **Film tier (offline, for look targets):** Disney's **Splash** solver drove *Moana*'s
  whitewater (FLIP surface + POP-solver sheeting particles breaking into drips past a
  velocity/density threshold — note: a *threshold*, same idea as ours, just on a real sim).
  Weta's **Stomakhin et al. 2022, *Guided Bubbles and Wet Foam for Realistic Whitewater***
  (SIGGRAPH) is the current film-grade foam/bubble standard. SideFX **Houdini Whitewater
  Solver** productises the spray/foam/bubble split — the same three classes as Ihmsen.
- **Bleeding edge:** SIGGRAPH Asia 2025, *Kinetic Free-Surface Flows and Foams with Sharp
  Interfaces* (Tsinghua / LightSpeed / Inria) — kinetic/lattice-Boltzmann free surfaces
  with foam; research, not shippable, but signals where foam sims are heading.

**On Sea of Thieves specifically** (your look target): its fame is the **wave *shape* and
shading**, not a fancy spray sim — FFT (Tessendorf) + Gerstner swells, and famously
*non-PBR* water shading, presented by Rare at SIGGRAPH. Their whitewater is Niagara
particle VFX on top, art-directed, not a unified diffuse sim. So "closer to Sea of Thieves"
is a realistic and worthy bar: it's reachable with *better emission heuristics + better
sprites/lighting* on the system you already have — you do **not** need an MLS-MPM fluid to
get there. The diffuse-potential framing above is the bridge.

---

## 6. Textures & sprites

The sprite carries a lot of the read. Options ranked by effort:

1. **Procedural radial sprite** (what we ship as fallback): radial alpha gradient + faint
   speckle so a cluster reads as droplets not a disc. Good enough for distant mist.
2. **Authored single droplet/puff sprite** — a soft, slightly irregular blob with internal
   structure. One good 256² RGBA with premultiplied edges beats a perfect circle.
   `setSprite(tex)` is already wired for this.
3. **Sprite sheet / flipbook** — 4×4 or 8×8 frames of a dispersing puff; index by
   `vAge01` so each particle plays a dissipation animation. Big realism jump for crowns
   and plunge curtains. Requires a `uAtlasDims` uniform + UV offset in the vertex/frag
   shader. Strong candidate for the next iteration.
4. **Erosion / dissolve mask** — a greyscale noise texture used with a moving threshold
   (`smoothstep(t, t+w, noise)`) to dissolve spray organically instead of a uniform alpha
   fade. Cheap, very effective, pairs with any sprite.
5. **Curtain/sheet textures** — long streaky alpha textures for the shore skirt / plunge
   curtain mesh approach (§2.2/§2.3).

**Sourcing:** Kenney (CC0) particle packs, ambientCG, or render our own in Houdini/Blender
(simulate once, render an 8×8 flipbook to PNG). Flipbooks are the highest leverage texture
investment.

**Procedural-vs-texture verdict:** procedural for the *distribution and motion* (we have
this), authored flipbook for the *individual puff*. Pure procedural droplet shading
(SDF blobs in the fragment shader) is possible but rarely worth it over a good sprite.

---

## 7. Mist / haze layer (the missing volumetric piece)

Distinct from droplets: the persistent **fine aerosol haze** hanging over an active surf
zone or a stormy sea. Approaches, cheap → dear:

1. **Soft particle slabs** — a few dozen large, slow, low-opacity soft billboards parked
   over the surf band, gently advected by wind. Reuses our particle system with a third
   `type`. Cheapest path; probably what we should do first.
2. **Fog volume / height fog tint** — bias the existing atmospheric/underwater fog upward
   in the surf zone so a low band reads as haze. Integrates with our existing fog chunk
   work; no new particles.
3. **Raymarched volumetric** — proper but expensive; only if a hero stormy look demands it.

Backlighting is everything for mist — it should glow against the sun and nearly vanish
with the sun behind camera.

---

## 8. Performance & integration notes (our engine specifics)

- **Pass isolation:** the splash mesh lives on `OCEAN_LAYER` (29) and OceanGrid toggles
  `mesh.visible` so it renders ONLY in the main pass — never in refraction/shadow/foam
  offscreen passes. This is the `project_perf_over_time` discipline; keep any new
  spray/mist meshes on the same layer with the same toggle.
- **Live tuning:** all knobs are plain JS fields (per `feedback_aframe_live_uniforms`),
  hot-editable from `window.oceanSplash`. `setSplashDebug(1)` tints by type. Keep new
  parameters as plain fields, not A-Frame data.
- **Emission cost:** the crest/shore scans are O(grid cells) on the CPU each frame. Wind-
  gated spawn (§3.1) doubles as a perf win — no spray in calm seas means no scan cost if
  we early-out on `windSpeed`.
- **Readback:** shore emission depends on an *async* readback of the foam terrain-height
  RT on snap-change only (rare, non-blocking). Don't move this to a per-frame sync read.
- **Shader pipeline:** spray GLSL lives in `ocean-splash{,-vertex}.glsl` + template + YAML
  entry; `create-shader.py` generates the material — **edit the GLSL/template, not the
  generated `.js`** (per `feedback_shader_workflow`). Dante runs the script.

---

## 9. Prioritised roadmap (synthesised)

What gives the most look per unit effort, building on what exists:

1. **Wind-speed-gated emission curve** (§3.1) — makes calm↔storm read correctly, and is a
   perf win. Small, pure-JS change.
2. **Stretched/streak billboards** for spindrift (§2.1) — the single biggest "this is sea
   spray not confetti" upgrade. Vertex-shader change.
3. **Backlight/rim brightening** in the fragment shader (§4.3) — cheap, transformative for
   sun-behind-spray shots.
4. **Authored sprite + flipbook atlas** (§6) — swap the procedural fallback; add `vAge01`
   frame indexing.
5. **Continuous hull/bow spray** (§3.4) — make `buoyancy-splash` fire while a fast hull is
   in contact, not just on entry.
6. **Mist slab particles** (§7.1) — a third particle type for surf haze.
7. **Plunge curtain mesh + breaking-line detection** (§2.2, §3.2) — biggest effort,
   reserved for dramatic shorelines.
8. **Trapped-air potential emitter** (§5.1, Ihmsen Iₜₐ) — emit where neighbouring surface
   velocities *diverge* (wakes, impact fronts), not just on crests. Principled mid-tier
   upgrade that closes the gap toward the AAA diffuse-material model without a fluid sim.
9. **Unify foam + spray + bubbles as one classified continuum** (§5.1) — the real
   "high-end" restructure: one diffuse pool, neighbour-count classification. Big; only if
   we ever want to genuinely chase the Ihmsen/Houdini tier.

Items 1–3 are low-risk shader/JS tweaks to the existing system; 4–6 are additive; 7–8 are
new subsystems; 9 is an architectural re-think (aspirational).

---

## 10. References

*Links verified June 2026. Academic refs are by citation; the rest are live URLs.*

**Current THREE / WebGPU ocean kits & code (2025–2026):**
- Three.js Water Pro (TSL/WebGPU FFT, 3 foam layers; paid) — https://threejsresources.com/tool/three-js-water-pro
- Tidewater — "I Built Tidewater, a Three.js Ocean Kit" (cascaded FFT + wakes + buoyancy, source included; ~May 2026) — https://ilikekillnerds.com/2026/05/21/i-built-tidewater-threejs-ocean-kit/
- WebTide — Tessendorf FFT on WebGPU, MIT — blog: https://barthpaleologue.github.io/Blog/posts/ocean-simulation-webgpu/ · code: https://github.com/BarthPaleologue/WebTide
- jbouny/fft-ocean (WebGL FFT for THREE) — https://github.com/jbouny/fft-ocean
- Stylized water in R3F (Codrops, Mar 2025) — https://tympanus.net/codrops/2025/03/04/creating-stylized-water-effects-with-react-three-fiber/

**Particle libs:**
- three.quarks (v0.17.0) — https://github.com/Alchemist0823/three.quarks · docs https://docs.quarks.art/docs · editor https://github.com/Alchemist0823/three.quarks-editor
- THREE.js `GPUComputeRenderer` / `Points` — three.js examples.

**Ocean systems (engine refs):**
- Crest Ocean System docs — https://crest.readthedocs.io/ · Crest Water 4 URP (Asset Store) — https://assetstore.unity.com/packages/tools/particles-effects/crest-water-4-urp-ocean-rivers-lakes-141674 · Crest Water 5 — https://assetstore.unity.com/packages/tools/particles-effects/crest-water-5-oceans-rivers-lakes-268614
- Legacy open-source crest-oceanrender (Unity) — https://github.com/belzecue/crest-oceanrender
- SideFX Houdini Whitewater Solver (offline spray/foam/bubble reference) — https://www.sidefx.com/docs/houdini/fluid/whitewater.html

**Technique & theory (surface / general):**
- Tessendorf, J. — *Simulating Ocean Water* (Jacobian foam / breaking criterion).
- van der Laan, Green, Sainz — *Screen Space Fluid Rendering with Curvature Flow* (particles → connected surface).
- NVIDIA — *WaveWorks* (spectrum-driven whitecaps & spray).
- Insomniac (Mike Day, 2009) — *Insomniac's Water Rendering System* (spray from surface velocity) — https://www.gamedevs.org/uploads/insomniac-water.pdf

**High-end spray / diffuse-material (§5.1) — the genuinely advanced tier:**
- ⭐ **Ihmsen et al. 2012 — *Unified Spray, Foam and Bubbles for Particle-Based Fluids*** (The Visual Computer) — the canonical 3-potential / neighbour-count classification model. PDF: https://cg.informatik.uni-freiburg.de/publications/2012_CGI_sprayFoamBubbles.pdf · https://link.springer.com/article/10.1007/s00371-012-0697-9
- `matsuoka-601/webgpu-ocean` — real-time **MLS-MPM** fluid in WebGPU (~100k–300k particles), MIT; TODO lists Ihmsen diffuse rendering — https://github.com/matsuoka-601/webgpu-ocean
- SIGGRAPH 2023 Course — *Building a Real-Time System on GPUs for Simulation and Rendering of Realistic 3D Liquid in Video Games* — https://dl.acm.org/doi/abs/10.1145/3587423.3595537
- Stomakhin et al. 2022 (Weta) — *Guided Bubbles and Wet Foam for Realistic Whitewater* (SIGGRAPH) — https://alexey.stomakhin.com/research/siggraph2022_whitewater.pdf
- *Moana* whitewater (Disney **Splash** solver + POP sheeting) — https://www.sidefx.com/community/walt-disney-animation-studios-moana/
- SideFX Houdini **Whitewater Solver** (spray/foam/bubble split, offline standard) — https://www.sidefx.com/docs/houdini/fluid/whitewater.html
- SIGGRAPH Asia 2025 — *Kinetic Free-Surface Flows and Foams with Sharp Interfaces* (Tsinghua / LightSpeed / Inria), listed at https://www.realtimerendering.com/kesen/siga2025Papers.htm

**Look targets / art direction:**
- *Sea of Thieves* water — FFT (Tessendorf) + Gerstner, non-PBR shading, Niagara whitewater VFX; Rare SIGGRAPH talk. Overview: https://konstantinkz.github.io/blog/water/
- GDC talks — *AC IV: Black Flag* ocean (layered spray art direction).

**Physical basis for wind-gated emission (§3.1):**
- Monahan, E.C. & O'Muircheartaigh, I. (1980) — whitecap coverage `W = 2.95e-6 · U₁₀^3.52`.
- Monahan, E.C. (1993) — cubic wind dependence with low-wind threshold.
- Callaghan et al. (2008), GRL — whitecap coverage vs. wind speed & history — https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2008GL036165
- Brumer et al. (2017), *J. Phys. Oceanogr.* — whitecap coverage dependence (cubic increasingly questioned; ~quadratic to >3.5 by method) — https://journals.ametsoc.org/view/journals/phoc/47/9/jpo-d-17-0005.1.xml

---

*Companion to `ocean-splash.js`, `ocean-splash.glsl`, `ocean-splash-vertex.glsl`, and the
`project_splash_particles` memory. Update both when the spray system evolves.*
