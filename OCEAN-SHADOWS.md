# OCEAN-SHADOWS: the ocean CSM next to what a-land learned

Status: REVIEW (2026-09-26). Nothing changed yet. Branch `underwater-occluders`.

a-water's ocean self-shadow (`ocean-shadow-csm.js`, receiver in `water-shader.glsl`
`getOceanShadow`) and a-land's object/terrain CSM (`a-faraway-land/src/js/core/csm.js`,
`TerrainSunCSM.js`) are both EVSM, both cascaded, both RGBA32F. a-land has since measured
a lot about how EVSM misbehaves on a CONTINUOUS HEIGHTFIELD, and the sea is one.

## Measured baseline (headless, island-sholes-ocean, debug mode 1 = ocean shadow factor)

| sun | C0 (60 m) | C1 (240 m) | C2 |
|---|---|---|---|
| 70° | mean 1.000, 0% < 0.9 | 1.000 | 1.000 |
| 12° | mean 0.933, 12% < 0.9, 6% < 0.5 | 0.993 | 1.000 |

At a high sun it is clean: no false self-shadow anywhere. At a low sun the shadows are there,
but they read as SOFT ROUND BLOTCHES scattered over the swell, not as long thin shadows trailing
down-sun from each crest. There is no ground truth yet, so "blotchy" is a judgement, not a
measurement. Getting one is step 0 below.

## Side by side

| | a-water ocean CSM | a-land CSM | matters for the sea? |
|---|---|---|---|
| Depth slab | `halfExtent·cos(elev) + 50 m`: **158 m for C0 at a 12° sun**, for waves ±2 m | the honest relief + the tallest real caster (③e: "a rock spanning 0.6% of a 330 m slab has no depth precision left") | **Yes, most.** A wave spans ~2.5% of C0's slab, so across a crest the warp moves exp(5·0.025) = 1.13: almost no contrast for Chebyshev, the minVariance floor dominates, and shadows go soft and blotchy. |
| Blur | 9 taps, stride 2 (8 texels each side), ISOTROPIC in the light map | `blurStrides`: the stride along the sun shrinks with elevation to keep the GROUND reach constant (floor 0.35) | **Yes.** An ortho texel lands 1/sin(elev) long on the sea along the sun: ×4.8 at 12°. The same kernel reaches 0.5 m across the sun and 2.4 m along it in C0, which smears a thin trailing shadow into a blob. |
| Receiver bias | none | kernel-sized slope bias (blurTexels + 0.6 = 5.6 texels): "a continuous heightfield shadows itself everywhere it is not flat… the blur is what disagrees" (EVSM's negative moment is concave) | **Probably.** It is clean at 70°, but that regime is the forgiving one. Needs the ground truth to judge at a low sun. |
| Warp `c` | 5.0 (comment: "good float32 balance") | 5.0, deliberately. 5 is the HALF-float ceiling (float32 allows 44), but a-land measured higher c WORSE because deep baseline samples dominate M1 | **Unknown.** The sea has no far-plane baseline inside the footprint (caster = receiver everywhere), which is the case a-land's argument rests on. Worth one sweep once the slab is fixed. |
| Clear baseline | far-plane moments, collapsed by premultiplied alpha; receiver-side guard (`M1 < 0.999` → lit) | a prefill of the GROUND (later the terrain itself) | Little. The sea covers its own footprint; the guard handles dry land. A source-side fix is tidy, not visible. |
| Cascade fade / margin | 20% fade, 9-texel inset | same idea (`fadeFraction`, 4 reach + 1 slack) | Already aligned. |
| Update | all 4 cascades every frame (waves move) | amortized (nothing moves) | Different on purpose. |

## Proposed order (each measured before and after, at 12° and 30°)

0. **A ground truth first.** A debug mode that ray-marches the fragment toward the sun through
   the cascade displacement textures (the same field the casters draw). Then every step below
   gets judged against physics instead of taste, the way a-land's tables were.
1. **Plane-relative depth.** The caster writes its distance along the light MINUS the still sea
   plane's distance at that map point (a linear function of map coordinates, computed
   analytically). The receiver does the same. The slab then only has to hold wave relief,
   ±(crest height + margin)/sin(elev), instead of the plane's tilt across the whole cascade:
   **158 m → about 20 m for C0 at 12°**, the same win in every cascade, at every sun angle. One
   change in the caster fragment and in `sampleOceanCascadeEVSM`; needs create-shader.py.
2. **Elevation-corrected blur.** Shrink the stride along the sun azimuth by sin(elev) (floor like
   a-land's 0.35) so the kernel covers the same ground both ways. JS + the blur shader only.
3. **Kernel-sized slope bias at the receiver,** only if step 0 shows false shadow on
   sun-facing slopes after 1 and 2.
4. **Sweep `c`** (5 / 10 / 20) on the fixed slab.

Rough cost: 1 is a few lines each side; 2 is small; 0 is a debug mode of perhaps 40 lines.
None of them costs frame time worth mentioning.

## Also noticed

- The underwater occluder map (UNDERWATER-VOLUME.md phase 3b) needed a-land's two terrain
  lessons verbatim: cull patches by node rect (three cannot), and zero the skirts.
