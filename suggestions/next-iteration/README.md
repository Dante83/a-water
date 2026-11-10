# Next-iteration suggestions

Ideas for the release after 0.3.0, written from a read of `development` at `bbc1244`
(2026-11-10) with `a-faraway-land` `main` checked out beside it. The weight is where it
was asked for: the new water (rivers, river mouths and plumes, waterfalls), then lakes,
then the shared shading, caustics, and the move to physical units. The open ocean is
mostly left alone.

This is a reading-and-arithmetic review. Nothing here was run in a browser, so every
"this looks wrong" is a claim about the code and the math, not about a screenshot.

## The files

| File | Covers |
| --- | --- |
| [01-rivers.md](./01-rivers.md) | Standing waves, foam transport and sources, the ripple profile, D8-era workarounds |
| [02-river-mouths-and-plumes.md](./02-river-mouths-and-plumes.md) | The plume solver, its optics, fronts, waves against the outflow |
| [03-waterfalls.md](./03-waterfalls.md) | Brink and foot hydraulics, tall falls, lip-to-foot coupling, bows in the mist |
| [04-lakes.md](./04-lakes.md) | Directional fetch, shelter, gusts, slicks, mirror reflections, per-body colour |
| [05-surface-shading.md](./05-surface-shading.md) | Fresnel, sun glint, slope statistics, crest translucency, body colour, foam |
| [06-caustics.md](./06-caustics.md) | Caustics computed from the real surface, and quick wins on the current ones |
| [07-physical-units.md](./07-physical-units.md) | Carrying SI light through the materials, the unit-unsafe constants, the tone curve |
| [08-shared-foundations.md](./08-shared-foundations.md) | Entrained air, the wind bus, time precision, frame-rate independence, tests |

## How entries are tagged

- **Fix** — the math or the algorithm is wrong or inconsistent as written.
- **Quality** — it is right, but a better method is within reach.
- **Feature** — something new.

Each entry says where it would live. The constraint as I understood it: A-Frame owns the
final render, so there is no full-screen pass over the finished frame. Off-screen
pre-passes into render targets, stepped from `tick`, are fine (the library already runs
about thirty). So everything is either "in a material" or "one more pre-pass of the
existing kind", and nothing asks for a post-process.

Line numbers are for the `.glsl` sources and pass files at `bbc1244`.

## If only ten things get done

Ordered by how much visible quality each buys for its cost.

1. **Mouth plume diffusion depends on frame rate** (Fix, an hour).
   [02 §1](./02-river-mouths-and-plumes.md#1-fix-plume-diffusion-is-per-frame-not-per-second)
2. **Standing waves use deep-water `k` exactly where deep water cannot apply** (Fix, a day).
   [01 §1](./01-rivers.md#1-fix-standing-waves-use-the-deep-water-wavenumber-where-it-cannot-apply)
3. **The tone curve differs from the land's** — the same radiance comes out 1.33× brighter
   on the water at mid grey (Fix, half a day).
   [07 §4](./07-physical-units.md#4-fix-the-waters-tone-curve-is-not-the-lands)
4. **Sun glint as a normalised BRDF**, before physical units arrive and break the Phong
   lobe (Fix + Quality, several days).
   [05 §2](./05-surface-shading.md#2-fix--quality-the-sun-glint-is-not-a-brdf)
5. **Entrained air as a second reservoir under the foam** — the milky turquoise under
   falls, rapids and breakers, and where foam comes from afterwards (Feature, a week).
   [08 §1](./08-shared-foundations.md#1-feature-entrained-air-the-reservoir-under-the-foam)
6. **Foam that is transported conservatively and sourced from dissipated energy**
   (Fix + Quality, several days). [01 §2–4](./01-rivers.md#2-fix-foam-is-advected-but-not-compressed)
7. **Directional fetch, shelter and gusts on lakes** — the upwind shore glassy, the
   downwind shore ruffled, cat's paws crossing between (Quality + Feature, a week).
   [04 §1–3](./04-lakes.md#1-quality-directional-fetch-instead-of-2--shoresdf)
8. **A plume with momentum**, warm-started, with its sediment in the same optical model
   as the rest of the water (Quality, a week).
   [02 §2–4](./02-river-mouths-and-plumes.md#2-quality-the-current-has-no-momentum)
9. **Caustics from the real surface**, one pre-pass shared by the seabed, the land socket
   and the underwater projector (Feature, one to two weeks).
   [06 §2](./06-caustics.md#2-feature-caustics-from-the-real-surface)
10. **Waterfall brink and foot hydraulics, and a pulse that travels from lip to foot**
    (Fix + Quality, several days). [03 §1–2, §5](./03-waterfalls.md#1-fix-the-brink-is-not-at-critical-depth)

## Confidence

Formulas I checked numerically are marked ✔ with the numbers (the script was a throwaway;
[08 §7](./08-shared-foundations.md#7-quality-physics-regression-tests) proposes keeping
such checks as tests). Literature constants quoted from memory are marked ⚠ and should be
verified against the source before anything is tuned on them.
