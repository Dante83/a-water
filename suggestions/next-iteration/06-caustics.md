# Caustics

Files read: `causticShader` and `causticOctaves` (`water-shader.glsl:1634-1661`), the
seabed branch (`:3091-3239`), and `passes/caustic-projection-pass.js` with its
`CAUSTIC_MODEL` contract for a-land.

The current model is a scrolling texture with careful physical dressing: scale follows
depth, the pattern is projected along the refracted sun ray, it is mean-preserving, it
has dispersion and a focus distance. All of that is right. What it cannot be is *related
to the water above it*.

---

## 1. Quality: quick wins on the current caustics

Each is a line or two in the seabed branch.

- **Tie strength to the surface.** `causticIntensityMultiplier` is global, so a
  mirror-calm tarn has the same dancing light on its bed as a choppy bay. A flat surface
  focuses nothing. Scale the contrast by the local short-wave slope: the wave masks for
  cascades 4 and 5 on still water, `rippleSlope` on flowing water. Gusts
  ([04 §3](./04-lakes.md#3-feature-gusts)) would then be visible on the lake bed as well
  as on the surface.
- **Foam casts a shadow.** Foam scatters the sun before it enters the water. The seabed
  under a foam patch should lose direct light and caustics both. For flowing water and
  the plume the foam is a texture lookup at `pSurfaceHit.xz`, which is already computed
  for the shadow test (`:3106`). A whitewater creek's bed goes from uniformly lit to
  dappled.
- **Turbidity kills contrast.** Contrast fades with a fixed 8 m e-fold
  (`CAUSTIC_CONTRAST_DEPTH`). In clear water the pattern survives much deeper; in a silty
  plume it is gone in a metre, because forward scattering blurs the rays. Make the e-fold
  inversely proportional to the water's scattering, and multiply by `1 − plumeC` until
  the plume is in the optical model
  ([02 §4](./02-river-mouths-and-plumes.md#4-quality-put-the-sediment-in-the-optical-model)).
- **`min(a, b)` and the 0.25 pivot.** The pattern is the minimum of two scrolling
  channels, re-centred on a hand-measured mean. It works, but the pivot must be
  re-measured whenever the texture or the threshold pair changes, and an error there
  silently brightens or darkens every shallow bed. If the texture stays, bake the mean
  into it (store `pattern / mean`) so the shader has no constant to keep in step.

---

## 2. Feature: caustics from the real surface

The surface that focuses the light is known: the FFT cascades, the shore breaker, the
river's ripple profile, the dynamic-waves rings. A caustic is a function of that
surface's curvature, so it can be computed instead of imitated.

**The math.** For small slopes and a sun at the zenith, a ray entering at `x` lands on a
bed at depth `d` at

    x' = x − d·(1 − 1/n)·∇η(x)

The light arriving at `x'` is concentrated by the inverse of the area change:

    I = 1 / |det(𝐈 − d·(1 − 1/n)·𝐇)|

with `𝐇` the Hessian of the surface height (three numbers: `η_xx`, `η_zz`, `η_xz`).
Energy is conserved by construction, so the mean is 1 with nothing to calibrate. A sun
away from the zenith shears the mapping along the refracted ray, which the existing
`pSurfaceHit` projection already handles.

**As a pre-pass** (one more render target of the kind the library already steps each
frame, camera-following and world-snapped like the foam):

1. Evaluate `𝐇` from the slope fields by finite differences. `h_k-pass.glsl` has an
   analytic slope branch, so the slopes are exact and one difference gives curvature.
   Add the dynamic-waves, breaker and ripple-profile slopes where they apply.
2. Write `I` for four depths (say 0.5, 2, 6 and 15 m) into the four channels. Each depth
   reads the surface at a mip matched to the scale that focuses there (the existing
   comment's estimate: cells about 0.16 × depth), which is also what makes the pattern
   coarsen with depth correctly.
3. The seabed branch reads it at `pSurfaceHit.xz`, interpolating between channels in log
   depth. `CAUSTIC_TILE_PER_DEPTH`, the two-octave blend, the advection phases and the
   texture itself go away.

**What it buys:**

- The pattern moves with the waves that make it, in their direction, at their speed. The
  current two-direction scroll has no relation to the wind.
- A wading child's rings focus rings of light on the creek bed. A boat's wake draws a V
  on the sand. A breaker's passing sweeps a bright bar up the beach ahead of it.
- Calm water has none, rough water has a fine busy net, long low swell has slow broad
  bands: automatically.
- One texture serves three consumers: the seabed branch, a-land's caustics socket, and
  the underwater spot-light projector, which today each re-derive the pattern
  (`CAUSTIC_MODEL` is "the same model, written out twice").

**Costs and cautions:**

- The determinant goes through zero at a focus (that is what a caustic is), so `I` needs
  a clamp, and past the first focus the true pattern folds over itself, which this
  formula does not follow. In practice the depth-matched mip keeps most of the bed near
  or before first focus. The exact alternative is to draw a grid of triangles displaced
  to `x'` with additive blending and brightness from the triangle's area change; it
  handles folds correctly and costs a 512² vertex grid per depth layer. Start with the
  determinant.
- **It changes the a-land contract.** Today a-land receives constants and evaluates the
  texture model itself. It would instead receive a texture, a world-to-UV transform and
  the depth layers. That is a simpler contract, but it is a change on both sides and
  should be agreed first.
- The pass costs a 512² or 1024² fullscreen draw with roughly thirty texture reads. It
  can be skipped when no shallow bed is in view.

---

## 3. Feature: caustics above the water

The 0.3.0 notes list "water as a light source: reflected glow on the land". The glow is
steady. What makes it read as *water* light is that it moves: the rippling net on the
underside of a bridge, a boat's hull, a cliff overhanging a cove.

Reflection focuses light by the same geometry as refraction, with `2·d·𝐇` in place of
`d·(1 − 1/n)·𝐇`. So the texture from §2 (or a second set of channels) modulates the
reflected glow for surfaces that face the water and are in shade. Small, and it uses
data that already crosses to a-land.

---

## 4. Feature: light shafts that match

The underwater volume pass draws god rays. If their intensity along a shaft is taken
from the same texture at the point where the shaft enters the water, the shafts stand
over the bright lines on the bed and move with them, which is how they look in a real
shallow sea. I did not check how the shafts are modulated today; if they already follow
the surface this is done, and if they use an independent noise it is a one-sampler
change once §2 exists.
