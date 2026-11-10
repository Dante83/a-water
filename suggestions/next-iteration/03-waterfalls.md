# Waterfalls

Files read: `luts/waterfall-nappe.js` (header and defaults), the headers of
`waterfall-sheet.glsl`, `waterfall-mist.glsl`, `waterfall-splash.glsl` and
`waterfall-cloud.glsl`, and how `flow-foam-pass.js` places the foot's foam.

This is the most developed part of the new water, and the parcel state machine (attached,
airborne, impact, wall, plunge) is the right shape. I read the models, not every line of
the 3,000 lines of shader, so these are suggestions about the hydraulics and about
phenomena that are missing, not a line-by-line audit of the rendering.

---

## 1. Fix: the brink is not at critical depth

**Where:** `waterfall-nappe.js`, header: "flow approaching a free overfall is critical,
so the parcel starts at v_c".

Critical depth occurs three to four depths *upstream* of a free overfall. At the brink
itself the pressure under the jet has dropped to atmospheric, the surface has drawn down,
and the depth is about **0.715 of critical** (Rouse's end-depth ratio, for a level
rectangular channel ⚠). By continuity the brink speed is `v_c / 0.715 ≈ 1.40·v_c`.

The parcel model cannot find this by itself: it slides a parcel under gravity and Manning
friction, and the drawdown is a pressure effect.

What changes if it is put in:

- The jet leaves 40% faster, so it lands 40% further out for the same drop.
- The sheet at the lip is 28% thinner, which is where the "glassy tongue" look lives.

**Proposal:** over the last three or four critical depths before each takeoff, blend the
parcel's speed up to `1.4·v_c` (and its thickness down to match). A few lines in the
attached state.

---

## 2. Quality: check the foot against the drop-structure relations

For a vertical drop onto a level apron there are standard relations in the drop number
`D = q² / (g·Δz³)` (Rand, as given in Chow ⚠):

| quantity | relation |
| --- | --- |
| landing distance | `L_d / Δz = 4.30·D^0.27` |
| pool behind the nappe | `y_p / Δz = 1.00·D^0.22` |
| depth at the nappe's foot | `y₁ / Δz = 0.54·D^0.425` |
| depth after the jump | `y₂ / Δz = 1.66·D^0.27` |

For `q = 1 m²/s` over a 5 m drop: land 3.2 m out, a 1.05 m pool behind the curtain,
13 cm of fast water at the foot, a jump up to 1.2 m. ✔ (arithmetic only)

Three uses:

- **A test.** The traced landing distance on a synthetic ledge should come out near
  `L_d`. That pins the trace (and §1) to something external. `tests/waterfall-nappe/`
  is the place.
- **The water behind the curtain.** A ledge fall has standing water behind the nappe at
  `y_p`. Nothing draws it today.
- **The jump below a ledge.** On a cascade, each step lands supercritical and jumps to
  `y₂` a short way on. That is where the foam and the standing wave belong
  ([01 §1](./01-rivers.md#1-fix-standing-waves-use-the-deep-water-wavenumber-where-it-cannot-apply)),
  rather than in a band of fixed depth per metre of drop (`fallDepthPerDrop`,
  `flow-foam-pass.js:76`).

These hold for a ledge with a run-out, not for a deep plunge pool, where §4 applies.

---

## 3. Quality: tall falls do not arrive at √(2gH)

The header gives the jet a break-up length of the Horeni form, `6·q^0.32` m, and asks for
it to be verified. My recollection is the same relation, `L_b ≈ 5.89·q^0.319` ⚠, so the
constants agree with what I remember, but that is two memories of one source and it
should still be checked against the plunge-pool literature (Ervine, Falvey & Withers
1997 cite it).

Past `L_b` the fall is no longer a sheet. It is a cloud of drops and ligaments falling
through air it has dragged along with it, and it stops accelerating: single large drops
top out near 9 m/s, a dense core in its own downdraught somewhat faster. A 100 m fall of
small discharge arrives at perhaps 20–30 m/s, not the 44 m/s that free fall gives.

`sheetDragCd` is marked as a fudge, and the splash hull has its own "vanish" rule for
falls that have turned to rain. One model would serve both: let drag grow with the
aeration `a` the trace already carries (clear sheet: negligible; fully broken: drag that
converges on a terminal speed), and let everything at the foot (impact speed, splash
height, ring strength, foam source) read the resulting speed. Tall thin falls then land
softly and wide, and short heavy ones land hard, without separate rules.

---

## 4. Feature: the bubble plume in the pool

A plunging jet drives air far below the surface. For a round jet of speed `V` and
diameter `d`, the bubbles reach a depth of about

    H ≈ V·d / (2·u_T·tan α)

with bubble rise speed `u_T ≈ 0.22 m/s` and a cone half-angle `α ≈ 12.5°` (Clanet &
Lasheras 1997 ⚠). A 10 cm jet at 10 m/s gives about 10 m: in any real pool the bubbles
reach the bed. They then rise over `H / u_T` seconds while the current carries them
downstream, and surface as the boil line some metres from the curtain.

Today the sheet runs 0.3 m under the surface and stops (`plungeDepth`), and the foot's
foam is a band at the landing. The pool's most recognisable feature, the milky turquoise
cloud under the surface and the boil where it comes up, is absent.

This is the same quantity the rapids and the surf need, so it is written up once:
[08 §1](./08-shared-foundations.md#1-feature-entrained-air-the-reservoir-under-the-foam).
For falls specifically: the source is at each recorded impact with strength from the
impact speed and discharge, and the foam band at the foot becomes the place where that
air surfaces, not a rectangle.

---

## 5. Quality: one pulse from lip to foot

A fall's discharge is never steady. Thickness bands travel down the sheet, and each one
arriving at the foot throws up a burst.

The sheet's grain already rides the water by sampling at `(τ − t)`, with `τ` the time of
flight. The splash's pulse is three unrelated sines (`uPulseRate` and two harmonics) with
their phase scattered by noise. So the bursts at the foot are not caused by anything
visible coming down.

**Proposal:** define one launch-time signal `m(t₀, across)` at the lip: low-frequency
noise, a few tenths of a hertz.

- The sheet evaluates it at `t₀ = t − τ` to modulate thickness and aeration. Bands appear
  and travel down at the water's own speed, stretching as it accelerates, for free.
- The splash, the foam source and the pool rings evaluate it at `t₀ = t − T_fall`, the
  full time of flight at that point across the lip.

A thick band then visibly reaches the foot and the splash answers it. The noise function
and `τ` both exist; this is wiring.

---

## 6. Feature: wind on the falling water

a-land has a wind field (`core/wind-field.js`) and the progress notes list the wind bus
as built and waiting. A thin fall is the most wind-sensitive thing in a landscape: it
sways, frays, and in a strong gust blows sideways or stalls.

The trace runs once per fall, so re-tracing per frame is out. It does not need to:
a parcel under a steady side force drifts by `½·a_w·τ²`, with `a_w` proportional to the
wind speed squared and to how broken the water is. That is a vertex-shader offset using
values the ribbon already carries (`τ` and aeration), zero at the lip and growing down
the fall. The mist cones and the clouds should take the same wind so the whole fall leans
together.

---

## 7. Feature: bows in the mist

Spray in sunlight makes a rainbow, and a waterfall is where most people have seen one up
close. The mist and cloud shaders already use a two-lobe Henyey-Greenstein phase; a bow
is one more narrow lobe.

- Primary bow at a scattering angle of about 138° (42° from the antisolar point), red
  outside at 137.6° and violet inside at 139.5°. Secondary at about 129° with the colours
  reversed, much fainter, and a darker band between them.
- Width follows drop size: about a degree for spray drops near the foot, widening and
  whitening to a fogbow for the fine mist that drifts away. The foam-to-haze coordinate
  `u` in the mist cones is a ready proxy for drop size.
- Single scattering only: weight it by the transmittance to the sun and to the eye, so
  the dense core stays white and the bow sits in the thin edges.

In physical units the lobe's weight can come from a small Mie table instead of being
tuned by eye.

---

## 8. Feature: spray wets the rock

Rock beside a fall is dark, glossy and often green in a halo that follows the spray. The
splash and mist hulls know where spray goes and how much. Deposited into a static map and
handed to a-land through the same socket as wet sand, it would tie the fall to its cliff
more than any further work on the water itself. Shared with
[01 §8](./01-rivers.md#8-feature-wet-banks-and-spray-zones).

---

## 9. Questions I could not answer from the code

- **What draws a fall a kilometre away?** I found no distance LOD in
  `waterfall-sheet-pass.js`. If distant falls are fully traced and raymarched, an impostor
  (a lit white strip from the ribbon's coarse rows, no volumes) is a performance item; if
  they are simply absent, it is a visual one.
- **Behind the curtain.** The sheet composites as the creek does, refracting what is
  behind it. Standing behind a fall and looking out through it is a different path
  (backlit, thin, the bright world beyond). Worth a look in the browser to see what
  happens today before deciding whether it needs anything.
