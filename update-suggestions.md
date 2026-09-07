# v0.3.0 Update Suggestions

Roadmap ideas for v0.3.0 of A-Restless-Ocean — the release where the ocean meets land.
Organized by category with a recommended core up top, and written so any future session
can pick an entry and run with it. (Compiled 2026-06-12.)

> **Ground rules every entry assumes:** shader work goes through the `.glsl` files +
> `-template.txt` + `src/python/create-shader.py`, never the generated `.js`; every
> shipped feature gets a nested-config child element wired through
> `ocean-config/config-core.js` (`<ocean-shoreline>`, `<ocean-river>`, ...), debug modes
> documented in `src/glsl/ocean-material/DEBUG_MODES.md`, and an example page; and the
> terrain sibling `../a-faraway-land` is at Phase D+ — CDLOD streaming and CPU
> `getHeightAt(x,z)` work, `getNormalAt` is a stub, the `MaterialExtensions`
> shader-injection registry exists, and there is no hydrology of any kind yet. Crest
> citations point into the Unity reference checkout at `../crest` (under
> `Assets/Crest/Crest/Scripts`).

## Recommended v0.3.0 Core

1. **World-anchored depth & shore cache** — the keystone; nearly everything below reads it
2. **TMA finite-depth spectrum** — the "modified JONSWAP" wish: waves that feel the bottom
3. **Shoreline pipeline v1** — attenuation, shoaling, refraction, shore foam, shallow color
4. **Local dynamic-waves sim** — interactive ripples that reflect off terrain; the a-avatar bridge
5. **The a-faraway-land contract** — three asks to land in the terrain repo NOW, in parallel
6. **ocean-grid.js decomposition** — the prerequisite chore: the god file must not absorb six new passes

---

## Foundations

### World-anchored depth & shore cache
The single highest-leverage feature in this document. We already render a top-down ortho
position pass of the terrain for foam and shore work
(`src/js/ocean-system/materials/ocean-material/position-pass.js`, driven from
`ocean-grid.js` on render layer 30) — that is 80% of Crest's `OceanDepthCache.cs`.
Promote it to a persistent, world-anchored cache storing **seabed depth below the water
surface**, **signed distance to shore**, and the **shore normal** (normalized depth
gradient), baked once on load and re-baked when terrain tiles stream in or the editor
terraforms (see the contract section). One texture unblocks: TMA spectrum attenuation,
the shoreline foam band, shallow-water color, depth-limited breakers, swash placement,
caustic gating, and the reflecting boundary for the dynamic-waves sim. This is half of
the "set ocean heights from a heightmap" wish — the seabed half; the water-surface half
is the water-level map in the Bodies & Zones section.

### TMA finite-depth spectrum (modified JONSWAP)
Multiply the JONSWAP spectrum in `src/glsl/fft-waves/h_0-pass.glsl` by the
**Kitaigorodskii depth function Φ(ω, h)** and it becomes the **TMA spectrum** (Bouws et
al. 1985) — the standard finite-depth modification: long components lose energy as they
feel the bottom, which is exactly what a shelving coast needs. Cascade configuration
(wind, fetch, gamma) already lives in `luts/ocean-height-band-library.js`, so the
plumbing is familiar; each cascade takes a representative depth from the cache. While in
the spectrum anyway: **swell injection** — a second narrowband, tightly-spread bank
(Ochi-Hubble-style double peak) so distant-storm swell can roll under local wind chop —
and an exposed **cos^2s directional spreading** exponent in place of the fixed cos²
turbulence. Honest caveat: an FFT cascade is one statistical sea state, so spectrum-space
depth attenuation is per-cascade, not per-texel; the per-texel half happens in
displacement space (shoreline pipeline, next), and the combination is the same dodge
Crest ships (`_attenuationInShallows` in `SimSettingsAnimatedWaves.cs`).

### Shoreline pipeline v1
Per-texel depth shaping in the water vertex/fragment stages, all reading the cache:
**amplitude attenuation** as depth shrinks, **shoaling** (apparent wavelength shortening
and steepening), **refraction** — bend the displacement-sample direction toward the
shore normal, weighted by depth, so crests arrive shore-parallel — a depth-driven
**shoreline foam band** (Crest `LodDataMgrFoam.cs`, `_shorelineFoamMaxDepth`) written
into the existing broadband foam RT so it advects and fades with the Jacobian foam for
free, and the **shallow color shift**: our Jerlov absorption already does the right
thing if fed true water-column depth instead of view distance — turquoise over bright
sand falls out of the physics instead of being painted. Critical detail: mirror the
amplitude attenuation in the CPU Gerstner twin (`luts/ocean-wave-field.js`) so buoyancy
and the splash emitters keep agreeing with the rendered surface near shore.

### Local dynamic-waves sim
A camera-centered, two-or-three-cascade **2D wave-equation sim** that anything may
inject impulses into — boat hulls, avatar wading and strokes, splash impacts, waterfall
plunge pools, rain — with output added to displacement and slope and fed into the
broadband foam RT. Crest's `LodDataMgrDynWaves.cs` + `SimSettingsWave.cs` is the
blueprint, including the shallow-water term: reading depth from the cache makes ripples
slow, steepen, and **reflect off shores naturally** — the practical near-term answer to
"wave ripples reflect off terrain" (the ambient-swell research version lives on the
Research Shelf). Couple it into the 256² height readback so floating objects bob in
each other's wakes. The single most life-giving feature for close-up play, and the
piece a-avatar builds on.

## The A-Faraway-Land Contract (add these now)

Rivers, lakes, and shorelines are joint custody with the terrain library. These three
asks are ordered by how soon we hit a wall without them; the list deliberately lives
here as the single source of truth — a-land sessions should plan against it.

> **Answered 2026-07-10:** a-land's side of the deal — the Solve Water bake, the
> water tile stack (`waterLevel`/`waterFlow` formats), the `simulation` map.json
> block, runtime hooks, and material sockets — is specified in
> [`a-land-water-contract.md`](./a-land-water-contract.md). Plan new water-meets-land
> work against that file; this section remains the wishlist it answers.

### Runtime data access
Finish **`getNormalAt`** (the Phase C.2 stub in `runtime/components/land-terrain.js` /
`runtime/director/TerrainDirector.js`) — swash direction, creek routing, and waterfall
placement all want CPU-side slope. Give the depth cache a way to see bare ground:
either export the **GPU heightmap tile handle plus world→UV transform** for our bake
shader, or formalize a **terrain-only render layer** so our ortho bake never captures
props and boats (we already run exactly this convention on layer 30 — option two is
nearly free). And emit **tiles-ready / tile-changed events** so the cache knows when to
re-bake instead of polling.

### Hydrology authoring layer
The big structural ask: a hydrology block in `map.json` plus editor support — per-body
**water level** (sea level by default, lakes at altitude), **river splines**
(centerline, width, depth, flow rate), and **lake masks** — registered through
`worldAuthority` so terrain and water always agree about what is wet. Stretch goal that
pays for itself: a **flow-accumulation/drainage bake** (a cheap D8 pass over the
heightmap in the existing Python tooling) that auto-suggests where creeks and rivers
want to live before anyone hand-authors a spline.

### Terrain material hooks
The `MaterialExtensions` registry (`src/js/core/material-extensions.js`, splicing
registered chunks at `// @inject:<name>` lines) already exists — what we need is two
named sockets placed in the terrain shaders and reserved for water: a **wet-sand band**
(we publish waterline + swash reach; terrain darkens albedo and lifts gloss below it,
with a slow drying timer) and **caustics-receive** (depth-gated, sharper sand caustics
from our projector instead of generic lit-mesh splash). Symmetric to the `//$$TOKEN$$`
fog-chunk pattern we already run with a-starry-sky — proven machinery, new sockets.

## Shorelines & Coastal Detail

### Depth-limited breaking waves
Waves break where height exceeds roughly **0.78× the local depth** (McCowan's
criterion). Sweep a **phase-locked breaker profile** along iso-contours of the shore
SDF — the Sea-of-Thieves/Assassin's-Creed school: an authored wave shape (steep front,
curling crest mask, foam burst) marching shoreward at √(gh), amplitude taken from the
incoming cascade energy so storm seas make bigger surf. Foam writes into the broadband
foam RT; the splash shore emitter gains a "breaker" trigger. Art-directable, cheap, and
reads as surf from a distance in a way no spectrum tweak ever will.

### Swash, backwash & wet sand
The last two meters of a beach: a thin **swash sheet** running up the sand after each
breaker (a planar decal strip driven by breaker phase and terrain slope from
`getNormalAt`), a receding **backwash film** with gravity streaks, and the **wet-sand
darkening band** through the reserved terrain hook above. The shore-impact splash
emitter already provides the foamy leading edge. This is where the eye lives on a
beach — small feature, outsized realism.

### Authored shoreline wave overlays
Where TMA plus breakers still read too uniform — pocket coves, harbor mouths — add a
handful of **spline/SDF-aligned Gerstner components** on top of the FFT field: Crest's
`ShapeGerstner.cs` + `WavesShoreline.asset` pattern, applied in the water vertex stage
and mirrored in the analytic twin. An artist's "more surf right here" knob that never
touches the global spectrum.

## Water Bodies, Levels & Zones

### Water-level map
Today the ocean is y = 0 everywhere. Lakes and river reaches need **per-body water
levels** from the hydrology layer: a coarse world-anchored level field (or per-body
SDF + level pairs) consumed by clipmap placement in `ocean-grid.js`, the buoyancy twin,
underwater-fog start depth, and the depth cache itself (depth = body level − terrain,
not 0 − terrain). Keep bodies mutually exclusive — each fragment belongs to exactly one
body, and blending happens only at estuaries (below). Gotcha worth writing down now:
FFT displacement is horizontal too, so body masks must be sampled at the displaced
position or shoreline edges will crawl. This is the other half of the "heightmap sets
water heights" wish.

### Water types & seamless distance blending
Per-body **parameter sets** — Jerlov class, wind/fetch/chop, foam tuning, scattering
tint — so a cold, clear mountain lake can sit one valley over from a fetch-pounded
coast. Blend weights come from a zone mask/SDF sampled per-vertex
(`components/ocean-static-mask.js` already does world-anchored masking; read it before
inventing anything new). The honest constraint: the FFT field is global, so wave-shape
blending is **per-cascade amplitude masks** (cheap, 90% of the effect) or a
**dual-h₀-bank crossfade** (two spectra with blended displacement — doubles FFT cost
while two zones are on screen). Distance does us a favor: beyond the readback window,
collapse everything toward the dominant open-water type — far water is statistical
anyway, which makes the distance blending seamless essentially for free.

## Rivers, Creeks & Waterfalls

One **flowing-water material family** with an upgrade ladder: creeks are the cheap
rung, rivers the solved-flow rung, waterfalls the vertical rung. All of it leans on the
hydrology layer from the contract section.

### Flowing-water material family
The shared base for everything in this section: **two-phase flow-map advection** (the
Valve/Vlachos Portal 2 trick — two samples offset half a cycle and crossfaded, so
scrolling never visibly stretches) over normals and foam, driven by a **flow-velocity
texture**, plus a CPU `queryFlow(x, z)` sampler in the spirit of Crest's
`LodDataMgrFlow.cs` + `QueryFlow.compute` so debris, splash ballistics, and a-avatar
can read the current. Build it once; creeks, rivers, estuaries, and even harbor
currents in the ocean proper all wear it.

### Spline rivers with a baked steady-state solve
The River Editor approach (Jean-Philippe Grenier,
https://80.lv/articles/river-editor-water-simulation-in-real-time): author a **spline**
in the a-land editor with width/depth/flow handles; at bake or load time run a
**shallow-water relaxation to steady state** over the local terrain patch (a few
hundred iterations on a small grid — offline-quality flow at zero runtime cost); bake
**flow + depth + foam-seed textures**; extrude a **banked mesh** along the solved
surface, superelevated in bends and dropping through rapids. Standing waves and rapids
fall out of the steady solve as obstacle-locked features rather than hand-placed FX.
One decision to settle early: do bakes persist as `map.json` sidecar tiles (fast load,
slower edit) or re-solve on load (fast edit, slower load)? Live solvers are on the
Research Shelf.

### Creeks
The answer to "I'm not even sure how we do creeks": a creek is **not a sim, it's a
decal**. Terrain-conforming flow strips with soft depth-blended edges, a
**parallax-shaded bed** (pebble texture offset by a fake water depth — sells
transparency with zero refraction passes), scrolled ripple normals from the flow
family, and **SDF foam collars** around placed rocks. Same material family as rivers,
so when a creek grows up and earns a spline + solve, nothing visually pops. Where
`getNormalAt` says the slope steepens, switch segments to a chute/cascade variant —
creeks do most of their charm where the ground changes its mind.

### Waterfalls, tiered
Tier 1 (build now): **authored ribbon/sheet meshes** from lip to plunge — scrolling
shredded-noise alpha with vertical stretch increasing down the fall, fresnel-lit edges,
a **base mist volume** reusing the existing mist shader, a **plunge-pool foam ring**
with radial flow injected into the flow texture and the broadband foam RT, splash-pool
particles at lip and impact, and a dynamic-waves impulse so the pool genuinely churns.
Tier 2: a cheap strip sim along the sheet for thickness variation. Tier 3 is the
**PIC/FLIP wish** — a true particle-fluid microsim at lip and plunge — which is
honestly a WebGPU-compute feature (Research Shelf). The point of tier 1 is that its
interface (lip spline + pool point) is exactly what a particle sim drops into later.
Don't wait for the sim to ship the waterfall.

### Estuaries & confluences
Where a river meets the sea, blend all three channels at once: **water level** (river
reach fading to sea level), **water type** (silty green into coastal blue via the zones
machinery), and **flow** (spline velocity decaying into the FFT field's ambient drift).
A brackish foam line where currents meet is nearly free — divergence-test the flow
texture and seed foam at convergence. Once zones and the flow family exist, this is
mostly an authoring-and-example-page problem — and it is the proof piece for "blend all
of these together seamlessly."

## Interaction & A-Avatar

a-avatar's swimming and wading work needs two things from us: honest queries, and water
that pushes back.

### Unified water query API
One sanctioned entry point — `getWaterStateAt(x, z)` returning surface height, velocity
(flow + wave orbital), depth, and body id/type — consolidating the analytic Gerstner
twin, the triple-buffered FFT readback in `ocean-grid.js`, and the future flow texture
and water-level map. Consumers: a-avatar locomotion (wade stance vs swim stance by
depth, current push while swimming), `buoyant.js`, and flow-riding debris. The twin
already answers height and normal; this entry is mostly plumbing plus a contract — and
it keeps the CPU/GPU parity promise from the shoreline pipeline honest.

### Wading & stroke impulses
Avatar feet, body, and arm pulls inject into the dynamic-waves sim: **wading wakes** as
capsule drag impulses at the feet (Crest's object-interaction inputs show the pattern),
**stroke ripples** as paired dipole impulses per pull, and hull pressure for boats
while we are in there. The splash system already speaks "hull burst" — generalize that
trigger into an **interaction-emitter API** (position, velocity, submerged area) so
wading kicks and oar dips emit spray without bespoke code per consumer.

### Boat Kelvin wakes
(Low effort, high charm.) An **analytic Kelvin wake** — the 19.47° wedge as a few
summed wave components anchored to the boat's track, amplitude from speed — added in
the water vertex stage and mirrored in the twin, plus a **foam trail** injected along
the track into the broadband foam RT. The dynamic-waves sim owns the near-field churn;
Kelvin arms persist far beyond its window, which is exactly where they read best.

### Rain on water
A weather-bus consumer (next section): **ring kernels** stamped into the dynamic-waves
sim at Poisson-disk points across the camera window, intensity from rain rate; sparse
**crown-splash sprites** from the existing pool; and a microfacet-roughness floor lift
so sun glints flatten the way rain actually reads. Keep it small — the dynamic sim does
the selling, not the particles.

## Visuals & Ambience

### Underwater god rays
We already project caustics from a dedicated SpotLight; extend the same projection into
the volume: march it through the HG-inscatter fog as a shadowed, striped light term,
quarter-res with temporal accumulation, gated by sun elevation and the depth cache. The
Snell window already frames the shot — this is the postcard of the underwater feature
set.

### Audio hooks (events, not audio)
We will never ship sounds, but we know where the noise is. Publish per-frame signals on
the A-Frame event bus: surf intensity (shore-band foam coverage near the listener),
river loudness (flow speed × depth at the nearest spline), waterfall proximity, and a
camera-submerged muffle flag. Scene authors wire the actual audio. Tiny feature,
outsized immersion.

## Architecture, Performance & Code Health

### Shared wind/weather bus
Wind currently lives in our spectrum config, a-starry-sky has its own sky state, and
mist drift and splash ballistics read their own knobs. Propose one **world weather
authority** — a-land's `worldAuthority` registry is the natural home — publishing wind
vector, gustiness, and rain rate. Consumers: the FFT spectrum (speed/fetch/direction),
per-cascade rotation, mist drift, splash ballistics, rain ripples, a-starry-sky cloud
drift, and someday a-land vegetation sway. One number and the whole world leans
together — and "the storm rolls in" finally becomes a one-call cinematic.

### WebGPU compute path
The honest unlock for the Research Shelf: three.js's WebGPURenderer turns our
fragment-shader ping-pong FFT into real compute and makes FLIP/LBM feasible at all.
Equally honest cost: a large port (every material, the MRT refraction pass, the
readback paths) plus a maintained WebGL2 fallback. Not v0.3.0. The forward-compatible
move now is to keep every new sim in an isolated pass module with a narrow interface,
so the eventual backend swap is mechanical rather than archaeological.

### Sim LOD & gating contract
Every new sim must know how to sleep: dynamic waves decimate tick rate by
distance-to-nearest-injector, river strips beyond the readback window drop to
flow-map-only, waterfalls LOD from sim to sheet to billboard, breakers cull by
shore-SDF window. `ocean-grid.js` already gates its passes (foam cam, caustics,
readback cadence) — write the convention down and make new features declare their gates
at construction. The clipmap philosophy, applied to simulation.

### ocean-grid.js decomposition (do this first)
3,500 lines, and this document proposes roughly six new render/sim passes for it to
own. Extract the existing passes — refraction MRT, reflection/SSR, foam, caustics,
height readback, shadow orchestration — into **pass modules** sharing an
init/resize/tick/dispose lifecycle, so the depth cache and dynamic waves arrive as
modules instead of another eight hundred lines in the god file. Pure refactor, zero
visual diff, and the biggest gift to whoever picks up the Foundations section.

### Config & examples discipline
Already the house rule, now in writing: every feature ships a nested-config child
(`<ocean-shoreline>`, `<ocean-river>`, `<ocean-waterfall>`, `<ocean-interaction>`)
through `config-core.js`, live-tunable uniforms as plain JS fields, debug modes in
`DEBUG_MODES.md`, and an example page beside `examples/demos/islands.html`. If it
cannot be authored from HTML, it did not ship.

## Research Shelf

### Ambient wave reflection & diffraction (the papers wish)
**"Water Surface Wavelets"** (Jeschke et al., SIGGRAPH 2018) advects the wave
*spectrum* over a coarse grid, giving ambient swell that refracts, diffracts, and
**reflects off arbitrary shorelines** at interactive rates; **"Water Wave Packets"**
(Jeschke & Wojtan, 2017) is the Lagrangian cousin; iWave (Tessendorf, 2004) and Wave
Particles (Yuksel et al., 2007) are the older, simpler alternates. Honest framing: the
dynamic-waves sim already reflects *interactive* ripples off terrain; this item is the
*ambient sea* reacting to the coast — harbor shadows, swell wrapping behind islands. It
would partially replace the FFT cascades in the near field, so prototype it standalone
before threading it into ocean-grid.

### Particle-fluid microsims (the PIC-SPH wish)
Localized **FLIP/PIC or position-based-fluids** boxes at waterfall lips and plunge
pools only — tens of thousands of particles in WebGPU compute, rendered as spray
sprites or screen-space fluid — dropping into waterfall tier 1's lip/pool interface.
Gated entirely on the WebGPU path; until then, tier 1 carries the look.

### Runtime LBM / hybrid SWE rivers
Live **lattice-Boltzmann shallow water** (or Chentanez & Müller's hybrid SWE +
particles) for the cases bakes cannot do: floods, dam breaks, terraforming a riverbed
in the editor and watching the water re-route. The baked river deliberately shares its
data contract (flow/depth textures), so a live solver is a backend swap, not a new
feature.

## Sequencing

The depth & shore cache comes first; TMA and shoreline v1 ride on it the same week. The
a-faraway-land contract proceeds in parallel and gates water levels, rivers, and wet
sand. The dynamic-waves sim needs only the cache and unblocks the whole interaction
section. The flow material stands alone; creeks need nothing but terrain; rivers add
hydrology and levels; estuaries add zones on top. Waterfall tier 1 is nearly
dependency-free — a good first pick for a session that wants a visible win on day one.
A realistic v0.3.0 is Foundations + the contract + shorelines + bodies/zones, plus
creeks, waterfall tier 1, and the query API — with the ocean-grid decomposition done
before any of it lands. The Research Shelf and the WebGPU port are explicitly not
v0.3.0; they are what v0.4.0 dreams about. :3
