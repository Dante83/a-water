# Physical units for light

Files read: the sibling-photometry block in `ocean-grid.js:504-590`, a-land's
`runtime/shading/SkyPhotometry.js`, and every place the water shader turns a light into a
colour.

---

## 1. Where things stand

a-land meters the world in SI: about 124,000 lux of sun at noon, bought back by an
exposure near `1.8×10⁻⁵` derived from an EV100 equation. The water does not shade in
those units. `_readSiblingPhotometry` multiplies the sibling's lux by the sibling's
exposure and hands the shader *display-referred* numbers (its comment says so in
capitals), so the shader sees a sun of about 2.2 as it always has.

That was the right bridge. It also means the water is not yet physically based: it is
unit-agnostic code receiving physically derived inputs, and it works wherever the code
happens to be linear in the light. The places where it is not linear are §2.

---

## 2. The constants that are not unit-safe

Each of these carries a hidden assumption that the sun is "a few units" bright. Under
the current bridge they still behave, because the input is still a few units. They are
what would break, or already quietly misbehave when exposure moves a long way (night,
underwater, indoors).

| where | what | the assumption |
| --- | --- | --- |
| `water-shader.glsl:3499-3503` | Phong glint × `specBoost` | Peak radiance is `boost × E` at any lobe width. Not a BRDF; see [05 §2](./05-surface-shading.md#2-fix--quality-the-sun-glint-is-not-a-brdf). |
| `:3363-3365`, `:3540` | `(2/255)` × *normalised* light | Independent of light level entirely; see [05 §4](./05-surface-shading.md#4-fix-a-light-independent-term-in-the-composite). |
| `:1732` | `baseSkyLighting = 0.25·vec3(2e-3, 3.5e-3, 9e-3)` | A fixed sky-radiance floor in the old scale. Not multiplied by exposure, so it is a different brightness relative to the scene at every EV. |
| `:3466`, `:3312` | `specularSunFade`, `sunUpForSubsurface` | Fades keyed on sun elevation to hide a twilight residual in the old light. With metered light the residual is already dim; the fades then also cut real low-sun and moon glints. |
| `:3306-3316` | `SUB_SURFACE_STRENGTH` | A gain on a term with no normalisation; see [05 §7](./05-surface-shading.md#7-quality-crest-translucency-from-thickness). |
| `ambientPiFix` (several) | A/B switch between `E` and `E/π` | The 2026-10-02 notes settle it: the sky term is irradiance and Lambert returns `ρE/π`. Lock it to 1 and delete the switch. |
| waterfall and spray shaders | copies of the Phong sun and the tone tail | Each copy must change in step. |

None of these needs physical units to fix. Fixing them first makes the switch a
non-event.

---

## 3. How to carry SI through a material

The tempting design is "uniforms in lux, shade in lux, expose at the end". Two things
argue against doing it literally:

- **The sun's disc.** 100,000 lux from a disc of 6.87×10⁻⁵ sr is a luminance of about
  1.5×10⁹ cd/m². ✔ A mirror-calm lake reflects 2% of that at normal incidence and nearly
  all of it at grazing. Half-float targets top out at 65,504, and the reflection and
  transmission targets are half-float.
- **Precision.** GLSL `mediump` guarantees a range of only ±16,384. Any intermediate in
  lux on a device that honours `mediump` overflows.

The standard answer (Frostbite and Unreal both do this) is **pre-exposure**: keep every
uniform and every constant in SI, and multiply by the exposure at the moment a light is
*read*, not at the end. All arithmetic then runs on numbers near 1, all render targets
store pre-exposed radiance, and the final step is only the tone curve.

That is nearly what the bridge already does. The difference is where the multiply lives
and what the shader is told:

1. Uniforms: `sunIlluminance` (lux, RGB), `skyIlluminance` (lux, RGB), `preExposure`
   (scalar). The shader multiplies on read. JS stops pre-multiplying.
2. Any constant that is a radiance or an illuminance (the night-sky floor, a future
   bioluminescence, a lamp) is written in SI and multiplied the same way. That is the
   rule that keeps §2's table from growing back.
3. Sky *luminance* for reflections comes from the sky's lookup in cd/m², pre-exposed on
   read like the rest.
4. The pre-pass targets (reflection, transmission, underwater volume) are rendered with
   the same `preExposure`, and if exposure changes between the pre-pass and the main
   pass the consumer rescales by the ratio. With a one-frame lag that ratio is near 1,
   but an exposure jump (surfacing from a dive) will show a one-frame flash without it.

The radiometric conventions, stated once so every shader agrees:

| term | form |
| --- | --- |
| Lambert surface (foam, seabed, sediment) | `L = ρ·E / π` |
| Specular sun | `L = E_⊥ · D·F·G / (4·cosθ_v)`, peak ≤ `F·L_sun` |
| Sky reflection | `L = F · L_sky(direction)` |
| Body colour | `L = R·E_d / π`, `E_d` the downwelling illuminance just below the surface |
| Volume in-scatter | `dL = σ_s · p(θ) · E · ds` |

---

## 4. Fix: the water's tone curve is not the land's

**Where:** `aroAESFilmicToneMapping` (`water-shader.glsl:1413`), applied at `:3726`.

The water tone-maps inside its own shader with the Narkowicz ACES fit. a-land's
`SkyPhotometry.js` calibrates its exposure against three.js's ACES, which is a different
fit (Hill's, with an input scale of 1/0.6): its comment says an 18% card lands at about
0.0998 display-linear.

The same scene-linear value through both curves: ✔

| scene-linear in | water (Narkowicz) | land (three.js ACES) | ratio |
| --- | --- | --- | --- |
| 0.02 | 0.0105 | 0.0073 | 1.45 |
| 0.05 | 0.044 | 0.032 | 1.40 |
| 0.104 (the 18% card) | 0.133 | 0.100 | 1.33 |
| 0.18 | 0.267 | 0.213 | 1.25 |
| 0.5 | 0.616 | 0.558 | 1.11 |
| 1.0 | 0.804 | 0.763 | 1.05 |
| 4.0 | 0.973 | 0.952 | 1.02 |

For identical radiance the water is a third brighter than the land at mid grey and
nearly half again brighter in the shadows. The two agree only in the highlights. This
shows wherever the water is supposed to *be* the land: sand seen through a few
centimetres of water against the same sand dry, the reflection of a hill against the
hill, the soft waterline where the surface fades to nothing. Earlier notes describe
chasing mismatches of exactly this kind at the shore and the horizon, some of which were
unit errors that have since been fixed; this one is in the curve and survives them.

I verified the two curves numerically. I did not verify in a browser that a-land's
renderer is set to `ACESFilmicToneMapping` in the shipped examples, only that its
calibration assumes it.

**Proposal:** follow the renderer. Include three's `tonemapping_pars_fragment` and call
its `toneMapping()` so the water uses whatever curve the scene uses, with the
hue-keeping foam variant (`aroFoamToneMap`) rebuilt on top of that function instead of on
a private one. Standalone scenes with no tone mapping set can keep the present curve as
the default. The waterfall, mist, splash and cloud shaders carry copies of the same tail
and need the same change.

---

## 5. What physical units make possible

Not reasons to do it, but things that become easy afterwards.

- **Local lights on water.** a-land's lamps are in candela. A harbour light's long
  wavering reflection, or a lantern lighting the creek it stands by, is the same glint
  and body terms with a point source. Today the shader knows one directional light.
- **Night.** Moonlight is about 0.1–0.3 lux, starlight about 0.001. With metered
  exposure the moon glitter path is simply the sun's at one four-hundred-thousandth the
  input; no night gates, no special floors.
- **Emission.** Bioluminescence in a wake or a breaking wave is a few millicandela per
  square metre: invisible by day, vivid at a night exposure. The dynamic-waves and foam
  fields are the trigger.
- **Underwater exposure.** Ten metres down in coastal water the scene is ten to a
  hundred times darker than the surface. If the meter follows it (the camera's water
  state is already published for the sound hooks), diving dims and then adapts, and
  surfacing dazzles for a moment.

---

## 6. Checks that would hold it in place

Unit bugs do not show as errors; they show as "the foam looks a bit grey". A few
headless assertions would catch them:

- **Grey card.** An 18% Lambert plane beside a patch of full foam: the foam should be
  `ρ_foam / 0.18` times brighter in scene-linear.
- **Horizon.** Calm open water near the horizon should match the sky just above it times
  the Fresnel factor.
- **Ocean albedo.** A top-down average of deep open water under a high sun should
  reflect about 6% of the incident light in total (surface plus body). A result of 15%
  or 2% is a unit error somewhere.
- **Exposure invariance.** Double the lux and halve the exposure: the frame must not
  change. This one test finds every row of §2's table.

---

## 7. A note on wavelengths

a-land's photometry is anchored to Bruneton's three bands: 680, 550 and 440 nm. The
water's RGB coefficients do not say what wavelengths they stand for. Pure water absorbs
roughly 0.47 /m at 680 nm ⚠ against the 0.28–0.30 in the clearer Jerlov presets, which
suggests the red channel was set for a shorter or broader band. Neither is wrong, but
once the sun arrives as three band illuminances the water's coefficients should be
defined on the same three bands, or the red light the sky delivers and the red light the
water absorbs are not the same red.
