# Surface shading

Files read: `water-shader.glsl` from the normal construction (`:2589-2650`) through the
body colour, Fresnel, glint and compositing (`:2930-3540`), and the underwater inscatter
functions (`:1483-1589`).

The comments in this stretch of the shader are a history of fights with the sun glint and
the horizon. Several of those fights have the same cause, so the suggestions here are
fewer than the length of the code would suggest.

---

## 1. Fix: Schlick is a poor fit for water

**Where:** `fresnelAirToWater` (`:1434`) and `fresnelFactor` (`:3050`).

Schlick's approximation was fitted for metals and high-index dielectrics. For water it
errs in both directions: ✔

| angle of incidence | exact (unpolarised) | Schlick | ratio |
| --- | --- | --- | --- |
| 0° | 0.0204 | 0.0204 | 1.00 |
| 45° | 0.0279 | 0.0225 | 0.81 |
| 60° | 0.0597 | 0.0510 | 0.85 |
| 75° | 0.212 | 0.240 | 1.13 |
| 80° | 0.348 | 0.398 | 1.14 |
| 85° | 0.584 | 0.641 | 1.10 |

The reflection is 15–19% too weak across the middle distance, where most of a lake or a
river is seen, and 10–14% too strong toward the horizon. The underside already uses the
exact formula (`fresnelWaterToAir`, `:1596`); the top side should too. It is a handful of
arithmetic operations and no square root beyond the one for the refracted cosine.

---

## 2. Fix + Quality: the sun glint is not a BRDF

**Where:** `:3487-3503`.

    specular = brightestDirectionalLight · pow(R·L, 275) · specBoost

The glint that ships is a Phong lobe on the reflected ray with a brightness boost. The
Cook-Torrance terms above it are computed and then left as dead code, with a note that a
microfacet model "can't simultaneously be tight and wide".

Two problems:

- **It does not conserve energy and has no units.** The lobe's peak is `boost × E`
  whatever its width, so widening it with distance (`specFalloffFar`) adds light. This
  works today because the light arrives pre-scaled to about 2–3. It will not survive
  physical units ([07 §2](./07-physical-units.md#2-the-constants-that-are-not-unit-safe)):
  the correct glint radiance is the sun's illuminance times a normalised distribution,
  and its peak is bounded by the sun's own luminance times the Fresnel factor.
- **The tight-or-wide dilemma is a missing variable, not a limit of microfacets.** A
  pixel's glint needs two things: the *mean* slope over the pixel's footprint (which the
  resolved waves set) and the *spread* of slopes inside the footprint (which the
  unresolved waves set). The shader feeds the distribution a point-sampled normal and one
  scalar roughness, so it sparkles when the normal is under-sampled and smears when the
  roughness is raised to hide that. §3 supplies both quantities properly.

**Proposal:** the standard ocean glint (Cox & Munk's slope statistics in a microfacet
form; Bruneton, Neyret & Holzschuch 2010 give a real-time version):

    L = E_sun · p(ζ_h) · F(v·h) / (4 · cosθ_v · cos⁴θ_h · (1 + Λ(v) + Λ(l)))

with `p` a Gaussian over slopes whose mean and covariance come from §3, plus the sun
disc's own angular size added to the covariance so that a mirror-calm lake returns
`F × L_sun` and not infinity. The Smith `Λ` is already in the file
(`smithMaskingBeckmann`). The shape of the glitter path, including its lengthening toward
the horizon and its widening with wind, then falls out of the slope covariance instead of
`specFalloffFar`, `specFresnelGate` and `specularSunFade`.

If close-range sparkle is wanted on top, that is a separate, well-studied addition
(counting discrete glints per pixel) and should not be asked of the mean lobe.

---

## 3. Quality: carry slope statistics, not distance fades

**Where:** `:3014-3034` (roughness from distance), `:3398-3411` (the 8-texel cascade-5
filter), `:2644-2650` (macro normal from cascade 0 only), and the open speck-band bug.

The slope variance that the mips have averaged away is estimated per cascade as

    lostFrac = smoothstep(0.5·L, 4·L, distance)

Distance is a stand-in for pixel footprint. It ignores field of view, resolution, and
above all the viewing angle: a pixel looking down from a cliff at 100 m resolves far more
than a pixel grazing the surface at 100 m, and both get the same roughness.

Two steps, the first cheap:

- **Use the footprint.** The river branch already does this for its ripple profile:
  `fwidth(vWorldXZ)` against the texel size gives the mip level actually in use, and the
  lost variance follows from the spectrum (`:2464-2466`). The same line per ocean cascade
  replaces the distance ramp. The footprint is anisotropic at grazing angles, so the lost
  variance should be too (more is lost along the view than across it), which is what
  stretches reflections vertically.
- **Store the moments.** LEAN/LEADR mapping: alongside each cascade's slopes keep their
  second moments (`sx²`, `sz²`, `sx·sz`) and let the mip chain filter them. At any mip,
  the mean slope is the filtered normal and `E[s²] − E[s]²` is exactly the variance that
  filtering removed. `h_k-pass.glsl` already has an analytic slope branch (`$isSlope`),
  so exact slopes are available to square. One more half-float array with mips.

What this replaces: the distance ramp, the precomputed `cascadeRMSSlope` table, the
special 8-texel filter for cascade 5, the choice of "cascade 0 only" for the specular
normal, and the `MACRO_SLOPE_MAX` clamp. It also gives foam a statistical fold test
([04 §9](./04-lakes.md#9-the-speck-band-on-calm-water)).

**The grazing Fresnel then needs no ceiling hack.** `:3049` caps the horizon reflectance
at `max(1 − α, F₀)`, borrowed from an environment-BRDF fit for rough metals. The
slope-averaged Fresnel for a sea surface is already written twenty lines of history away,
as the dead `ctF` at `:3458`: `pow(1 − cosθ, 5·exp(−2.69σ)) / (1 + 22.7·σ^1.5)`. One
caution if it is revived: in its source `σ` is the standard deviation of slope, and the
code passes it `ctAlpha = √(2σ²)`, which overstates the roughening by √2.

---

## 4. Fix: a light-independent term in the composite

**Where:** `:3363-3365`, `:3540`.

    normalizedLightIntensity   = brightestDirectionalLight / length(…)
    directionalSurfaceLighting = normalizedLightIntensity · max(N·L, 0) · shadow
    totalLight = … + (2/255)·directionalSurfaceLighting + (253/255)·(…)

The light is normalised before use, so this term has the same magnitude at noon, at dusk
and under a crescent moon: a fixed 0.8% of display white, tinted by whichever light is
brightest, on every sun-facing slope. At noon it is invisible. At night it is a constant
glow that does not dim with the scene.

Water has no diffuse surface reflection; its "diffuse" is the body colour, which is
already there. Remove the term and give the full weight back to the physical sum.

---

## 5. Quality: say what the scattering coefficient is

**Where:** `JERLOV_PRESETS` (`ocean-grid.js:20-28`), `underwaterInscatterShadowed`
(`:1510`), the transmittance at `:2942`.

The presets pair absorption of 0.02–0.5 /m with scattering of 0.001–0.09 /m. Total
scattering in real sea water is ten to a hundred times larger than that; the numbers are
the right size for the *backscattering* coefficient `b_b`. And that is how the shader
uses them: the body colour is `R∞(b/(a+b))`, which for small albedo is `≈ ¼·b/(a+b)`,
against the standard ocean-colour result `R ≈ 0.33·b_b/(a + b_b)`. The two agree to
within a quarter. So the model is right, and the name is what misleads.

It is worth making explicit, because three things follow:

- **Document it as `b_b`**, so nobody "corrects" the presets to textbook total-scattering
  values and turns the sea to milk.
- **Add the forward scattering separately.** It does not dim the seabed, it blurs it.
  Sampling the refraction buffer at a mip that grows with `b_f × path` gives turbid water
  its soft-focus bed for one LOD bias, and it is the missing cue between "clear" and
  "murky" at equal brightness.
- **Parameterise by content.** Chlorophyll, dissolved organic matter and mineral
  particles each have a known spectral absorption and backscatter per unit concentration.
  Three sliders then span every natural water, the Jerlov types become presets of those
  three, and lakes, rivers and plumes use the same sliders
  ([04 §6](./04-lakes.md#6-feature-per-body-water-colour)).

---

## 6. Fix: the water path length

**Where:** `:2931-2939`.

    effectiveDepth = verticalDepth + horizontalDist · 0.008

The path a view ray travels through water to the bed depends on the refracted angle, not
on how far away the camera is. Refraction bends even a grazing ray steeply downward: the
angle from vertical inside the water never exceeds 48.6°, so the path is between 1.0 and
1.51 times the depth, always.

The added term makes shallow water more opaque with distance: at 500 m it adds 4 m of
water to every pixel. A sandbar seen across a bay loses its turquoise; from close by it
has it. The stated purpose is to make the horizon settle to the open-water colour, but
pixels with no bed behind them already take a 500 m path, and near the horizon the
Fresnel term hands the pixel to the reflection anyway.

**Proposal:** `path = verticalDepth / cosθ_t` with `θ_t` from Snell's law on the view
ray, and drop the horizontal term. If a far-distance fade is still wanted for other
reasons (the refraction sample gets unreliable far away), fade the *sample*, not the
water's clarity.

---

## 7. Quality: crest translucency from thickness

**Where:** `:3306-3316`.

The green glow through a wave crest is gated on height above the rest level and on
looking toward the sun. It cannot tell a thin crest from a thick swell of the same
height, and a breaker's lip (thin, low) gets less than a rounded swell top (thick, high).

What makes the glow is how much water the sunlight crossed on its way through. One or two
extra height samples, stepped from the fragment toward the sun, estimate the chord
through the wave; `exp(−K·chord)` with the body's own attenuation then gives the colour
and the brightness together: thin lips bright and yellow-green, thick faces dark and
blue-green, flat water nothing. The shore breaker's `eta` can feed the same estimate so
surf gets it too.

---

## 8. Quality: calibrate whitecaps against wind

Foam coverage rises with a tuned `foamWindBias`. There is a measured target: the
fraction of open sea covered by whitecaps is about `3.84×10⁻⁶ · U₁₀^3.41`
(Monahan & O'Muircheartaigh ⚠), which is 1% at 10 m/s and 4% at 15 m/s. ✔ (arithmetic)

A headless test that renders a top-down patch at a few wind speeds and counts foam pixels
would turn the bias from a look knob into a calibrated one, and would catch the day a
shader change doubles the foam.

Real whitecaps also have two stages: a bright, short-lived active crest and a fading
patch behind it that lasts several seconds. The second needs history, which the shader
comments already say is wanted (a camera-following foam buffer). The entrained-air
reservoir is that buffer:
[08 §1](./08-shared-foundations.md#1-feature-entrained-air-the-reservoir-under-the-foam).
