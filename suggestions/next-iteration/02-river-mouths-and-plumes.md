# River mouths and plumes

Files read: `passes/mouth-plume-pass.js`, the plume read in `water-shader.glsl`
(`:2559-2567`, `:3349-3357`), and a-land's `WaterFVBake.js` for what the bake does with
the sea.

The pass is a 512² ping-pong at 1 m per texel carrying concentration, current and front
foam. It works without a list of mouths, which is a real virtue. Its weak points are the
current model and how the plume enters the lighting.

---

## 1. Fix: plume diffusion is per frame, not per second

**Where:** `mouth-plume-pass.js:57` and `:173`.

    conc = mix(conc, csum / ncount, uPlumeDiffusion);   // 0.15 "per step"

A fixed share of the neighbour mean taken every step is a diffusivity of
`0.15 · Δx² / 4` per *frame*. In physical terms: ✔

| frame rate | effective diffusivity |
| --- | --- |
| 30 fps | 1.1 m²/s |
| 60 fps | 2.3 m²/s |
| 120 fps | 4.5 m²/s |
| 144 fps | 5.4 m²/s |

A plume on a 144 Hz display spreads five times faster than on a 30 fps phone, so the
look that was tuned on one machine is not the look on another.

**Proposal:** make the knob a diffusivity in m²/s and take the share from the time step:

    share = 1 − exp(−4 · D · dt / Δx²)

`D = 2.25` reproduces today's 60 fps look. The decay terms next to it already use
`exp(−dt/τ)` and are fine.

The same pattern is worth a grep across the other ping-pong passes; see
[08 §4](./08-shared-foundations.md#4-fix-audit-per-step-constants).

---

## 2. Quality: the current has no momentum

**Where:** `mouth-plume-pass.js:158-169`.

The current in the sea is a screened diffusion: each still texel takes `k` times the mean
of its wet neighbours. Its steady state solves `(∇² − 1/L²) u = 0`, so the river's
velocity leaks into the sea equally in all directions and dies as `exp(−d/L)`.

A river mouth does not do that. It is a jet: it carries momentum straight out, entrains
the water beside it, widens at a nearly constant angle, and slows along its axis. For a
plane turbulent jet the half-width grows linearly (about 1 in 10 ⚠) and the centreline
speed falls as `x^−½`; in shallow water, bed friction adds an exponential decay on top
(Özsoy & Ünlüata's shallow jet). A diffusion has none of this: no throw, no shear lines
along the jet's edges, no recirculation eddies either side of the mouth.

It also is not divergence-free, so concentration advected by it is silently created and
destroyed.

**Proposal, in the same pass:** let the velocity advect itself.

1. Back-trace the velocity along itself (as concentration already is).
2. Apply bed friction `u *= 1 / (1 + c_f·|u|·dt / h)` with the field depth: this is what
   gives the jet its length, and it replaces `jetLength` with depth-dependent physics
   (jets run further over deep water and die on a shoal).
3. Add a small eddy viscosity for the entrainment.
4. Remove divergence over time: one Jacobi pressure iteration per frame, the pressure
   kept in a channel of a second attachment. The steady state is what matters here, so
   amortising the solve over frames costs nothing visible.

This is Stam's stable-fluids loop spread across frames. The source texels and the dry
wall treatment stay as they are.

**The cheaper alternative** is analytic: if a-land exported the mouths (position, width,
heading, discharge), the similarity solution of a plane jet could be evaluated per
fragment with no solve at all. It loses the coast's influence on the jet, which the grid
solve keeps.

---

## 3. Quality: the plume grows in while you watch

Each frame is one relaxation step, so information moves one texel per frame and a jet of
length `L` texels takes on the order of `L²` frames to settle. With `jetLength = 40` that
is about 1600 frames: 27 s at 60 fps. The header says as much. The effect is that a plume
fills in after you arrive, and again after any teleport, because texels entering the
window start empty.

Three ways out, cheapest last:

- **Warm start.** When the window first becomes active, or the camera jumps by more than
  a few texels, run the step a few hundred times in one frame on a quarter-resolution
  target and upsample. A 128² target at 300 iterations is small.
- **A coarse outer cascade.** A second 4 m per texel window (±1 km) kept running, whose
  result seeds texels entering the fine window. This matches how the WaterField already
  nests.
- **Bake it.** The steady plume is static data. a-land's FV bake holds every ocean cell
  at sea level with zero velocity (`WaterFVBake.js`, boundaries). If the solve domain kept
  a margin of open sea and exported the velocity it found there, the runtime pass would
  only need to carry concentration and foam. This relaxes the contract's "the sea is
  exactly still" clause inside the mouth's reach, so it is a conversation with a-land,
  not a patch.

---

## 4. Quality: put the sediment in the optical model

**Where:** `water-shader.glsl:3349-3357`.

    plumeBody     = mouthPlumeAlbedo / π · (sun·cosZ·shadow + sky)
    bodyInscatter = mix(bodyInscatter, plumeBody, plumeC)
    transmittance *= 1 − 0.8·plumeC

The plume is painted over the body colour as a Lambert surface, and the seabed is dimmed
by a fixed factor. Everything else in the shader derives colour from absorption and
scattering. Two consequences:

- The plume has no depth. A thin veil at the plume's edge hides the bed as much per unit
  concentration as the thick core does, where real plume edges show the bed through a
  faint milkiness.
- The underwater passes do not know the plume exists (neither `underwater-volume-pass.js`
  nor `underwater-fog-chunk.js` reads it). Dive at a river mouth and the water is as
  clear as the open sea.

**Proposal:** give the sediment specific coefficients, an absorption and a backscatter
per unit concentration and per channel, and add them to the water's own:

    a   = a_water + c·a_sed
    b_b = b_water + c·b_sed

Then the existing transmittance and the existing `R∞` inscatter produce the plume's colour
and opacity together, the caustics dim in it automatically
([06 §1](./06-caustics.md#1-quality-quick-wins-on-the-current-caustics)), and the same
two numbers can be handed to the underwater fog when the camera is inside it.
`mouthPlumeAlbedo` and `strength` become a sediment type (silt, clay, peat-stained,
glacial flour) with measured-looking defaults.

**Second step, if the first reads flat:** a river plume is a buoyant layer of fresh water
half a metre to two metres thick riding on clearer sea. Treating it as a layer of
thickness `h_p` (thinning seaward with concentration) over the sea's own column gives the
right look from above (bed visible through the thin edge) and from below (a murky ceiling
with clear water under it).

---

## 5. Quality: let the front make itself

**Where:** `mouth-plume-pass.js:176-185`.

The foam line at the plume's edge is seeded from a hand-shaped band-pass on the
concentration gradient. Real plume fronts are sharp and foamy for a physical reason: the
buoyant layer spreads outward as a gravity current, and the surface converges at its
nose, so everything floating gathers there.

- Add the buoyant spreading velocity to the current: speed `√(g′·h_p)` directed down the
  concentration gradient, with reduced gravity `g′ = g·Δρ/ρ ≈ 0.25 m/s²` for fresh water
  over salt. The gradient is already computed. This gives the plume its lobed outline and
  a front that stays sharp instead of diffusing away.
- Advect foam conservatively, as proposed for the river
  ([01 §2](./01-rivers.md#2-fix-foam-is-advected-but-not-compressed)). Foam then collects
  on the front because the front is where the surface converges, with no edge detector.

The two onsets and gains (`convergenceOnset`, `frontOnset`, …), each added to stop the
plume lacing itself all over, should mostly become unnecessary.

---

## 6. Feature: the sea pushes back

At present the mouth calms the sea and the plume ignores it.

- **Waves against the outflow.** Waves meeting an opposing current shorten and steepen.
  For deep water and a collinear current `U`, the amplitude grows as
  `a/a₀ = c₀ / √(c·(c + 2U))` (Longuet-Higgins & Stewart) and the wave is blocked
  entirely when the opposing current reaches a quarter of its still-water phase speed.
  The short cascades are affected first: a 1 m/s outflow blocks everything with
  `c₀ < 4 m/s`, which is every wave shorter than about 10 m. The visible result is the
  band of short, steep, breaking chop across a river bar. Per-cascade wave masks already
  exist to carry an amplitude factor, and the plume pass has the current.
- **Alongshore drift.** Obliquely arriving swell drives a current along the beach that
  bends the plume downdrift; wind does the same at a few percent of its speed.
  `SwellArrivalPass` has the incidence and the wind bus has the wind
  ([08 §2](./08-shared-foundations.md#2-quality-consume-the-wind-bus)). One uniform
  ambient velocity added to the plume's advection is most of the effect.

---

## 7. Feature: inflows to lakes that dive

The same pass treats a lake like the sea, with the river water floating. Cold or silty
inflow is often denser than the lake and does the opposite: it runs out a short way, then
plunges under at a visible line where the colour stops dead and debris gathers. A
per-body switch (buoyant or plunging) and a plunge distance that grows with the inflow's
speed would cover it, and it is the signature of a glacial lake.

---

## 8. Small things

- **Sediment sorts with distance.** Sand drops out first, clay last, so a plume shifts
  from brown at the mouth to milky green at its edge. With a foam-age or plume-age
  channel, the sediment's coefficients can drift along the plume.
- **The `0.8` factor** on the river foam handed over at the mouth
  (`riverFoamHandoff`) can go once fresh-to-salt foam persistence is modelled in one
  place: the two passes already disagree on purpose about decay time, and salinity is
  just the plume concentration.
