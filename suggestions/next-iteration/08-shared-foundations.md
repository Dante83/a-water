# Shared foundations

Things more than one of the other files leans on.

---

## 1. Feature: entrained air, the reservoir under the foam

Every kind of broken water in the library draws its white on the surface. Real
whitewater has two parts:

- **Air under the surface.** A fall, a breaking wave, a hydraulic jump and a ship's
  propeller all drive bubbles down into the water. Seen from above this is the milky,
  pale turquoise cloud that lingers after the white has gone: light scatters off the
  bubbles and is tinted by the water it crosses on the way down and back.
- **Foam on the surface**, which is largely those bubbles arriving at the top.

Modelling only the second is why foam has to be sourced by detectors (convergence, step
slope, a band at a fall's foot) and why it appears and vanishes in place.

**The model:** two coupled fields in one advected target.

    air  (below):   sources = dissipated energy;   loss = air / τ_rise
    foam (above):   source  = air / τ_rise;        loss = foam / τ_burst

- `τ_rise` is plume depth over bubble rise speed (about 0.2–0.3 m/s): a second or two in
  a creek, ten or more below a tall fall.
- `τ_burst` depends on the water: about a second in fresh water, many seconds in salt
  (the foam and plume passes already encode this difference as separate constants).
- Both are carried by the current; foam additionally drifts with the wind.

**Sources, all of which exist as numbers already:**

| where | source strength |
| --- | --- |
| waterfall impacts | impact speed and discharge from the nappe trace ([03 §4](./03-waterfalls.md#4-feature-the-bubble-plume-in-the-pool)) |
| rapids and jumps | stream power and jump head loss ([01 §3](./01-rivers.md#3-quality-one-foam-source-from-dissipated-energy)) |
| shore breakers | the breaker's `breaking` term |
| open-sea whitecaps | the fold test |
| interactors, wakes | the splash impulses |

**Rendering:** the air field adds backscatter to the body colour, through the same
optical model as everything else. It needs one extra input, the depth the bubbles sit
at, to get the tint right: light crosses roughly twice that depth of water, so a shallow
plume is white and a deep one is turquoise.

**Where it lives:** a second attachment on `FlowFoamPass`
([01 §4](./01-rivers.md#4-quality-the-foam-history-blurs-along-the-stream)) for flowing
water. For the sea it is the camera-following foam history buffer that the shader
comments at `water-shader.glsl:2602-2607` already call for.

**What it replaces:** the fall band (`fallGain`, `fallDepthPerDrop`), convergence as a
source, the dense/sparse two-rate decay, and the hand-off share at the river mouth. And
it gives whitecaps their fading patch
([05 §8](./05-surface-shading.md#8-quality-calibrate-whitecaps-against-wind)).

---

## 2. Quality: consume the wind bus

a-land ships `core/wind-field.js`: a mean wind and gust factor over time, a gust field
in space, and terrain sheltering, with a CPU/GLSL parity guarantee. Its header says it
was written with two consumers in mind and `WATER-TYPES.md` lists the water as one of
them, deferred. I found no reader of it in a-water; the water's wind is the
`wind_velocity` attribute.

One read of that field serves:

- lake shelter and gusts ([04 §2–3](./04-lakes.md#2-quality-shelter-from-the-land)),
- the direction and strength of the FFT spectrum itself,
- foam and plume drift ([02 §6](./02-river-mouths-and-plumes.md#6-feature-the-sea-pushes-back)),
- waterfall sway and where the mist goes ([03 §6](./03-waterfalls.md#6-feature-wind-on-the-falling-water)),
- ripple direction on rivers ([01 §6](./01-rivers.md#6-quality-the-ripple-profile)),
- spray from breakers.

The attribute stays as the fallback when no provider is present, as the light does.

---

## 3. Fix: wave time loses precision in long sessions

**Where:** `h_k-pass.glsl:35-44`, driven from `ocean-height-band-library.js:438`
(`uTime = time / 1000`).

The FFT phase is `cos(ω·uTime)` with `uTime` in seconds since the scene started,
unwrapped, in 32-bit float. The shortest waves have `ω` in the tens of rad/s. After an
hour the product is around 10⁵ and float resolution there is about 0.01 rad: harmless.
After twelve hours it is around 2×10⁶ with a resolution of 0.1–0.25 rad: the smallest
ripples begin to step instead of flow. The CPU twin computes the same phase in doubles
and does not degrade, so the two drift apart.

This only bites on installations that run all day, but the fix is exact and old
(Tessendorf describes it): round every frequency to a whole multiple of a base
`ω₀ = 2π / T`, and wrap time at `T`. Every wave then completes a whole number of cycles
per wrap and the animation loops seamlessly. With `T` of an hour the frequencies move by
at most `ω₀/2 ≈ 0.0009 rad/s`.

The river's ripple profile has the same issue and already wraps at 900 s, accepting a
visible reshuffle; the same rounding removes the reshuffle
([01 §6](./01-rivers.md#6-quality-the-ripple-profile)). Apply it in the JS twin as well
so buoyancy stays in phase.

---

## 4. Fix: audit per-step constants

The plume's diffusion ([02 §1](./02-river-mouths-and-plumes.md#1-fix-plume-diffusion-is-per-frame-not-per-second))
is a constant fraction applied once per frame, so its strength scales with frame rate.
I found that one by reading the plume pass closely; I did not read every ping-pong pass
to the same depth.

The pattern to search for is any `mix(a, b, constant)` or `x *= constant` inside a pass
that is stepped once per `tick`, where the constant is not built from `dt`. Candidates
to check: the plume's `uJetKeep` relaxation (it changes only how fast the jet settles,
not where), the shore-reflection state, the swash surface, and the dynamic-waves damping
if it is not already per-second. Each fix is the same: express the knob per second or as
a diffusivity, and take `1 − exp(−rate·dt)`.

A cheap guard: run each pass headless for the same simulated time at 30 and 120 steps
per second and compare the results.

---

## 5. Quality: one advection routine

Three passes carry a field along a current: dynamic waves (Catmull-Rom back-trace),
river foam (bilinear) and the plume (bilinear). The bilinear ones blur
([01 §4](./01-rivers.md#4-quality-the-foam-history-blurs-along-the-stream)).

Lift the Catmull-Rom read into a shared GLSL chunk with an optional limiter (clamp to the
neighbourhood's min and max) and an optional compression term (`× exp(−∇·v·dt)` for
tracers that float). The entrained-air field in §1 would be its fourth user.

---

## 6. Quality: capillary term in the ocean's dispersion

**Where:** `h_k-pass.glsl:35`, `w = sqrt(g * magK)`.

The river's profile uses `ω² = (g·k + (σ/ρ)·k³)·tanh(k·h)`; the ocean's FFT uses the
deep-water gravity term alone. Surface tension matters below about 6 cm of wavelength,
which is the bottom of the finest cascade. Adding `+ 7.28e-5·k³` under the square root
makes the smallest ripples run slightly faster and puts the two water types on one
relation. Low priority; noted for consistency.

---

## 7. Quality: physics regression tests

The repository already tests its models in Node (`tests/waterfall-nappe`,
`tests/shore`, …). Several suggestions here come with numbers that could sit beside
them:

| test | expected |
| --- | --- |
| stationary wavenumber vs Froude | the table in [01 §1](./01-rivers.md#1-fix-standing-waves-use-the-deep-water-wavenumber-where-it-cannot-apply); no solution for Fr > 1 |
| Bélanger jump | depth ratio, downstream Froude, head loss |
| nappe landing distance on a ledge | within tolerance of the drop-number relation ([03 §2](./03-waterfalls.md#2-quality-check-the-foot-against-the-drop-structure-relations)) |
| Fresnel | exact values at 0°, 45°, 60°, 80° ([05 §1](./05-surface-shading.md#1-fix-schlick-is-a-poor-fit-for-water)) |
| plume and foam at 30 vs 120 steps/s | equal within tolerance (§4) |
| exposure invariance | frame unchanged when lux doubles and exposure halves ([07 §6](./07-physical-units.md#6-checks-that-would-hold-it-in-place)) |
| whitecap fraction vs wind | near the empirical curve ([05 §8](./05-surface-shading.md#8-quality-calibrate-whitecaps-against-wind)) |
| tone curve parity | water and land agree on an 18% card ([07 §4](./07-physical-units.md#4-fix-the-waters-tone-curve-is-not-the-lands)) |

The value is less in catching today's errors than in stopping the next browser-tuning
round from moving a physical constant to compensate for a bug elsewhere.

---

## 8. Asks of a-faraway-land

Collected from the other files, for whoever next edits `a-land-water-contract.md`.

| ask | for |
| --- | --- |
| Publish which solver made the water tiles (D8 or finite-volume) | [01 §5](./01-rivers.md#5-quality-retire-the-d8-workarounds-on-fv-worlds) |
| Keep and export sea velocity within reach of a river mouth | [02 §3](./02-river-mouths-and-plumes.md#3-quality-the-plume-grows-in-while-you-watch) |
| Optionally export mouths (position, width, heading, discharge) | [02 §2](./02-river-mouths-and-plumes.md#2-quality-the-current-has-no-momentum) |
| Optical type per body in `simulation.bodies[]` | [04 §6](./04-lakes.md#6-feature-per-body-water-colour) |
| A wetness input on the terrain socket beyond the surf (banks, spray) | [01 §8](./01-rivers.md#8-feature-wet-banks-and-spray-zones), [03 §8](./03-waterfalls.md#8-feature-spray-wets-the-rock) |
| Caustics received as a texture and transform, not as model constants | [06 §2](./06-caustics.md#2-feature-caustics-from-the-real-surface) |
| Skyline atlas queried along an arbitrary direction (for wind shelter) | [04 §2](./04-lakes.md#2-quality-shelter-from-the-land) |
| Confirm the tone curve the renderer is expected to use | [07 §4](./07-physical-units.md#4-fix-the-waters-tone-curve-is-not-the-lands) |
