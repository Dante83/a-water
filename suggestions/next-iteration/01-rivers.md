# Rivers and creeks

Files read: `passes/flow-surface-pass.js`, `passes/flow-foam-pass.js`, the
`$flowing_water` branches of `water-shader.glsl`, and a-land's `WaterFVBake.js` and
`WaterTileExport.js`.

The design is sound: a field-grid sheet, a 1D ripple profile after Jeschke & Wojtan, and
a foam history advected by the current. What follows is where the math inside it can be
tightened.

---

## 1. Fix: standing waves use the deep-water wavenumber where it cannot apply

**Where:** `water-shader.glsl:2468-2492`.

The block finds the wave that holds still against the current from the deep-water
relation `c = sqrt(g/k) = |v|`, so `k = g/v²`, and switches it on for Froude 0.9 to 4.5.

With `k = g/v²`, the relative depth is `kh = gh/v² = 1/Fr²`. Deep water needs `kh` well
above 1. So the approximation is valid only for Fr well under 1, and the gate opens
exactly where it fails. The full dispersion relation for a stationary wave is

    Fr² = tanh(kh) / (kh)

whose right side never exceeds 1. **A supercritical flow has no stationary gravity wave
at all.** ✔

| Fr | `kh` the shader uses (1/Fr²) | `kh` from the full relation |
| --- | --- | --- |
| 0.5 | 4.00 | 4.00 |
| 0.7 | 2.04 | 1.96 |
| 0.9 | 1.23 | 0.86 |
| 0.99 | 1.02 | 0.25 |
| 1.2 | 0.69 | none |
| 2.0 | 0.25 | none |

At Fr 0.9 the drawn wavelength is 30% too short; above 1 the shader draws a wave that
physics does not allow, at a wavelength of `2π·Fr²·h`.

What a river actually shows, and what to draw instead:

- **Subcritical, 0.4 < Fr < 1: lee waves.** Stationary trains downstream of a bed
  feature, with `kh` solved from the relation above. Two Newton steps from the deep-water
  guess are enough, or use `kh ≈ sqrt(3(1 − Fr²))` near Fr = 1 and `1/Fr²` below 0.6.
- **Crossing from Fr > 1 down to Fr < 1: the undular jump.** The waves stand on the
  *downstream* flow. The Bélanger relation gives its depth, `h₂/h₁ = ½(√(1 + 8Fr₁²) − 1)`,
  and its Froude number `Fr₂ = Fr₁ / (h₂/h₁)^1.5`; `k` then comes from the full relation at
  (`Fr₂`, `h₂`). ✔

  | Fr₁ | h₂/h₁ | Fr₂ | head lost / h₁ |
  | --- | --- | --- | --- |
  | 1.2 | 1.27 | 0.84 | 0.004 |
  | 1.5 | 1.68 | 0.69 | 0.047 |
  | 1.7 | 1.96 | 0.62 | 0.112 |
  | 2.5 | 3.07 | 0.46 | 0.72 |
  | 4.0 | 5.18 | 0.34 | 3.5 |

- **Fr₁ above about 1.7: a roller, not waves.** ⚠ (1.7 is the textbook limit; measured
  onsets of breaking are quoted lower, around 1.3–1.5.) The jump breaks, and the head it
  loses, `(h₂ − h₁)³ / (4·h₁·h₂)`, is the energy that makes whitewater. The current gate
  keeps smooth standing waves up to Fr 4.5, where the table says a jump is destroying
  most of the flow's head. That energy belongs in the foam source (§3), not in a sine.

A jump is a place, found where Fr falls through 1 along the flow: `v·∇Fr < 0` near
Fr = 1. The train should decay downstream from there rather than come and go with a noise
patch (`swPatch`, line 2487). That needs "distance since the jump", which is one advected
scalar: see the spare channel in §4.

**Also worth having:** capillary waves stand *upstream* of anything that pierces a
current faster than the minimum phase speed, `(4gσ/ρ)^¼` = 0.23 m/s. These are the fine
parallel lines ahead of a twig or a wading leg. `water-interactor` contacts and a-land's
object water masks know where such things are.

**Cost:** fragment shader only for the first two bullets.

---

## 2. Fix: foam is advected but not compressed

**Where:** `flow-foam-pass.js:203-206` (advection), `:226-230` (convergence as a source).

The step reads last frame's foam at `x − v·dt`. That solves `Df/Dt = 0`: foam moves but
its coverage never changes with the flow. Foam is a floating tracer, which obeys the
conservative form

    ∂f/∂t + ∇·(f v) = 0     ⇒     Df/Dt = −f ∇·v

so foam should thicken where the surface converges and thin where it spreads. That term
is what gathers foam into the lines and eddy cores that make a river read as flowing.

The pass does use convergence, but as a *source*: `max(0, −∇·v − onset)` creates foam
from nothing. So clean water converging makes foam (wrong), existing foam entering an
accelerating tongue does not thin (wrong), and foam in an eddy does not gather (missing).

**Proposal:** after the back-trace, `foam *= exp(−divV · dt)` with `divV` clamped to about
±2 /s, then saturate. Keep the entrainment sources separate (§3). The stencil already
computes `divV`.

A caveat to keep honest: the field is depth-averaged, so `∇·v` is non-zero wherever depth
changes (`∇·(h v) = 0` is what holds). That is the right behaviour for a surface tracer in
a shoaling or deepening reach, but it does mean a-land's stamp edges show up, so the term
wants the same smoothed flow the derivatives already use.

---

## 3. Quality: one foam source, from dissipated energy

**Where:** `flow-foam-pass.js:226-252`.

Three sources with three gains (convergence, bed step × speed, bank shear) stand in for
one physical quantity: the rate at which the flow loses energy to turbulence. Air is
entrained in proportion to that.

- **Stream power per unit bed area:** `Ω = ρ·g·q·S_f` in W/m², with `q = h·|v|` and `S_f`
  the fall of the water surface along the flow. The pass already has `levelGrad` and the
  field depth. A riffle, a chute and a bed step all show up as high `Ω` without separate
  detectors.
- **Jump loss:** where §1 finds a breaking jump, add its head loss times `ρ·g·q`.
- **Bank shear** stays as it is: it is a different mechanism (lateral shear, not bed
  friction) and the vorticity term captures it.

An onset is still right. Self-aeration of an open channel needs the turbulent boundary
layer to reach the surface and enough speed to break it; below roughly 1 m/s a smooth
stream entrains nothing however steep it is.

The header records a decision *not* to use a-land's energy channel because it saturated
at 1 on every island-sholes creek. That was D8's estimate from hydraulic geometry.
`WaterFVBake.js` now writes `energy = min(1, Fr / froudeWhitewater)` from a solved depth
and velocity, so on FV worlds the channel may be worth a second look (see §5).

---

## 4. Quality: the foam history blurs along the stream

**Where:** `flow-foam-pass.js:203-206`, bilinear read of the previous target.

A semi-Lagrangian step with a bilinear read diffuses by `D = a(1 − a)·Δx² / (2Δt)` per
step, `a` being the fractional texel shift. At 0.5 m texels and 60 fps: ✔

| current (m/s) | shift per frame (texels) | numerical D (m²/s) | spread after one 6 s lifetime |
| --- | --- | --- | --- |
| 0.5 | 0.017 | 0.12 | 1.2 m |
| 1 | 0.033 | 0.24 | 1.7 m |
| 2 | 0.067 | 0.47 | 2.4 m |
| 4 | 0.133 | 0.87 | 3.2 m |

The smear is along the flow, so streaks survive as streaks, but any structure along them
(a patch, a gap, the pulse below a fall) is averaged over metres. It is also a diffusion
nobody chose: it scales with speed and frame rate.

**Proposal:** `dynamic-waves-pass.js:705` already back-traces with a Catmull-Rom read.
Lift that into a shared chunk and use it here and in the plume pass, with the result
clamped to the min and max of the four nearest texels so it cannot ring. Cost is a few
more taps on a 512² target.

**While in there:** the target's four channels are all taken (foam, flow x, flow z,
energy). A second attachment (the WaterField targets already use MRT) would carry
entrained air ([08 §1](./08-shared-foundations.md#1-feature-entrained-air-the-reservoir-under-the-foam)),
foam age, and the "distance since jump" §1 wants.

---

## 5. Quality: retire the D8 workarounds on FV worlds

Several stencils exist because D8 routing writes a staircase of discs:

- the 5-tap flow smoothing over a 2 m reach (`flow-foam-pass.js:152-158`),
- steering the current toward the downhill of the level (`:176-200`),
- the 1.5 m `LEVEL_EPS` for the surface normal (`water-shader.glsl:2361-2377`).

a-land's finite-volume bake solves a real shallow-water surface, so on those worlds the
velocity is already smooth and already points the right way, and these filters now remove
real detail: eddies behind rocks, shear lines, the cross-slope in a bend.

**Proposal:** have a-land publish which solver produced the tiles (a field in
`map.json`'s `simulation` block; I did not find one, so this is a contract ask) and scale
the three stencils by it. Worth an A/B on hero-creek first with the stencil knobs turned
down by hand: `stencil` is already live on the pass.

---

## 6. Quality: the ripple profile

**Where:** `flow-surface-pass.js:109-164`, read at `water-shader.glsl:2432-2466`.

- **The 15-minute reshuffle can be removed exactly.** Time wraps at `TIME_WRAP = 900` s
  and the header accepts one reshuffle per wrap. If each wave's frequency is rounded to a
  whole multiple of `2π / TIME_WRAP`, every wave completes a whole number of cycles per
  wrap and the profile loops with no seam. The largest change to any frequency is under
  0.1%. ✔ One line in the GLSL string: `omega = round(omega * T / 2π) * 2π / T`.
- **One depth for every creek.** `WAVE_DEPTH = 0.3` is flagged as a look approximation.
  `tanh(kh)` only matters for waves longer than about four depths, so a few rows would
  cover it: make the target 1024×4 with rows for 0.05, 0.15, 0.5 and 2 m, and pick the
  row from the field depth. Shallow riffles then get slower long ripples than pools.
- **Sixteen directions, equally weighted.** Real stream ripples are not isotropic. Wind
  ripples run with the wind; turbulence-born ones are advected by the shear. Weighting
  each direction by `0.5 + 0.5·cos²` of its angle to the wind (once the wind bus is
  consumed, [08 §2](./08-shared-foundations.md#2-quality-consume-the-wind-bus)) costs
  nothing.
- **The ocean should borrow one idea back.** The river measures how much slope variance
  the mips lost from the actual pixel footprint, `fwidth(vWorldXZ)` (line 2464). The
  ocean still estimates it from distance (line 3016). See
  [05 §3](./05-surface-shading.md#3-quality-carry-slope-statistics-not-distance-fades).

---

## 7. Feature: boils and scars

Deep, fast rivers carry upwelling boils: smooth, slightly domed discs a few depths
across, ringed by a sharp line of ripples (the scar), drifting with the current and
lasting a few seconds. They are the texture that separates a big river from a wide creek,
and nothing in the current model makes them.

A sparse cellular pattern advected by the same two-phase scheme as the ripples would do:
inside a cell suppress the ripple slope, at its rim sharpen it, with cell size
proportional to depth and density rising with speed × depth. Normals only, in the
flowing branch of the fragment shader.

---

## 8. Feature: wet banks and spray zones

The wet-sand socket in a-land follows the surf. Rivers and falls have the same need and
simpler data: rock and soil are dark and glossy for a hand's width above the waterline
(capillary rise and wave wash), and for metres around rapids and falls (spray). The
WaterField already holds level and shore distance; the splash and mist hulls already know
where spray lands. Publishing a static "wetness" term through the existing socket would
seat the water in its bed. See also [03 §8](./03-waterfalls.md#8-feature-spray-wets-the-rock).

---

## 9. Quality: rivers past the window

Beyond `WINDOW_HALF_WIDTH` (228 m) a creek is drawn by the clipmap as sloped still
water. The WaterField's outer cascades still carry energy and level slope, so a far
rapid could at least keep its whiteness and roughness: a static foam fraction from
`energy × slope`, with no advection. I did not check how a distant rapid currently reads,
so this is a question to answer in the browser before it is a task.

---

## 10. Per-body water colour

The flowing material aliases the ocean's absorption and scattering uniforms, so a peat
creek, a glacial river and the sea share one colour. That belongs with the lakes:
[04 §6](./04-lakes.md#6-feature-per-body-water-colour).
