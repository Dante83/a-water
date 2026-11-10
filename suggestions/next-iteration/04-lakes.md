# Lakes

Files read: the `WaveMask` section of `luts/ocean-wave-field.js`, the reflection paths in
`water-shader.glsl` (`reflectedSurfaceLight`, the land cube, the sky fallbacks),
`passes/reflection-pass.js`, and a-land's `core/wind-field.js` and `WaterTileExport.js`.

A lake today is the ocean's spectrum with its long cascades masked off by depth (TMA) and
by a fetch proxy. That is a sound base. What it lacks is what makes still water look like
a particular lake on a particular day: where the wind reaches it, how it moves across it,
what it reflects, and what colour it is.

---

## 1. Quality: directional fetch instead of 2 × shoreSDF

**Where:** `ocean-wave-field.js:413-425`, `:555`.

The fetch is `2 × shoreSDF`, which the comment calls a proxy: exact at the centre of a
round lake, short near every rim. So a lake calms toward all of its shores equally.

A real lake is glassy under its upwind shore and roughest against its downwind shore.
That asymmetry is the first thing that says "wind", and a symmetric proxy cannot make it.

**Proposal:** a fetch field, computed in the WaterField's own space by a small ping-pong:

    F(x) = wet(x) ? F(x − ŵ·Δx) + Δx : 0

with `ŵ` the direction the wind blows toward. It converges in as many steps as the lake
is texels long and only needs redoing when the wind direction moves by more than about
ten degrees, so it can be spread over frames like the swell-arrival solve. Engineering
practice averages nine radials over ±45° with cos² weights ("effective fetch"), which
stops a narrow inlet from counting as open water; three radials would be enough here.

Everything downstream is unchanged: `WaveMask.peakK(U, F)` already takes a fetch. The
contract note about a "reserved class channel" for directional fetch from a-land becomes
unnecessary, since wind direction changes at runtime and a baked fetch could not follow.

---

## 2. Quality: shelter from the land

Fetch says how far the wind has blown over water. It says nothing about a ridge or a
treeline upwind, which leaves calm water for ten to thirty times its height downwind.

a-land already holds the data: the skyline atlas that `landLightVisibility` reads answers
"how high is the horizon from here in this direction". Asked along the upwind direction
instead of toward the sun, it gives a shelter factor: fully sheltered where the horizon
stands above a few degrees, open below about one. a-land's wind field also has a terrain
response of its own; whichever is easier to reach
([08 §2](./08-shared-foundations.md#2-quality-consume-the-wind-bus)), the result is a
local wind speed that scales both the cascade masks and the capillary roughness.

---

## 3. Feature: gusts

Watch a lake for a minute and the thing that moves is not the waves. It is dark patches
of ruffled water sweeping across a bright surface: cat's paws. Capillary and short
gravity waves answer a gust within seconds and die as fast, so the patches trace the
wind's structure directly.

The wave masks are per place and per cascade already. Multiplying the two shortest
cascades and the micro-roughness by a gust factor `g(x, t)` drawn from the wind field's
gust structure gives the effect: where `g` is high the water is rough, reflects the sky
diffusely and reads dark-blue; where it is low it is a mirror. The long cascades should
not follow (they integrate the wind over minutes).

This is the largest single improvement to how a lake reads for the work involved.

---

## 4. Feature: slicks and windrows

Two related looks, both a mask on roughness:

- **Slicks.** Natural surface films damp capillary waves. On a light-wind day they show
  as smooth, bright, wandering lanes through otherwise ruffled water.
- **Langmuir windrows.** Above about 3 m/s the wind sets up paired rolls under the
  surface, and foam, leaves and film gather in the convergence lines between them:
  parallel streaks aligned with the wind, spaced a few metres to tens of metres apart.

A slow, wind-aligned, stretched noise that lowers roughness (and, for windrows, collects
foam) is enough. It also gives foam on a lake somewhere to go other than fading in place.

---

## 5. Quality: reflections that a calm lake deserves

Above water the reflection is screen-space, backed by the land G-buffer cube and the sky.
The cube's own header notes that a-land culls placed objects to the main camera's
frustum, so off-screen props are a known gap, and screen-space reflection cannot show
what the screen does not: the far bank's trees when the camera looks down, anything
behind a foreground object.

On rough water none of this shows. On a mirror-calm lake the reflection *is* the picture,
and its gaps are the first thing seen.

**Proposal:** an optional planar reflection for still bodies. `ReflectionPass` already
renders a mirrored camera into a half-resolution target for the underwater ceiling; the
same machinery, mirrored about the lake's level, run only when the camera is near a body
whose slope variance is low. Blur by roughness through the target's mips. It costs one
more half-resolution scene render while it is active, so it wants a quality switch, and
it should fade to the existing path as the water roughens (which is exactly when the
existing path is good enough).

---

## 6. Feature: per-body water colour

Every body shares the ocean's absorption and scattering (the flowing material and the
waterfall sheet alias the same uniform objects). Lakes vary more than seas do:

| water | why | look |
| --- | --- | --- |
| clear alpine | almost nothing but water | deep blue, bed visible at 10 m+ |
| glacial | suspended rock flour, strong backscatter | opaque turquoise |
| humic / peat | dissolved organics absorb blue | tea brown, black when deep |
| productive lowland | chlorophyll absorbs blue and red | green, murky |

a-land's class tile carries a water-type index and a body index per texel, and
`simulation.bodies[]` describes each body. A small table of coefficients keyed by body or
type, sampled through the field and blended across hand-offs, would cover it. The
[shading notes](./05-surface-shading.md#5-quality-say-what-the-scattering-coefficient-is)
suggest parameterising water by what is in it (chlorophyll, dissolved organics, mineral
particles) so these presets are three numbers each instead of six.

The river plume's sediment
([02 §4](./02-river-mouths-and-plumes.md#4-quality-put-the-sediment-in-the-optical-model))
is the same mechanism with a concentration that varies in space.

---

## 7. Quality: the lake's own shore

- **Small breakers where the wind arrives.** With a directional fetch there is a local
  wave height at each shore. The shore-breaker model scaled down to it gives the downwind
  beach its line of small spilling waves and leaves the upwind beach still.
- **The foam line.** Wind drags surface foam at about 3% of its speed. With that drift,
  foam and debris accumulate along the downwind shore, which is where they are on any
  real lake.
- **A wet margin** through the terrain socket, as for rivers
  ([01 §8](./01-rivers.md#8-feature-wet-banks-and-spray-zones)).

---

## 8. Feature: rain

Nothing in the water responds to rain (I found no rain input in any pass). On a lake it
is transformative: the mirror goes matt, and close by each drop leaves a ring.

- Near the camera, random impulses into the dynamic-waves simulation, which already makes
  rings.
- Everywhere else, a rise in micro-roughness and a procedural ring normal pattern, since
  the simulation window is small.
- A single `rain` rate drives both, later fed by whatever weather source the sky and land
  agree on.

---

## 9. The speck band on calm water

`WATER-TYPES.md` records an open bug: sparse white fold-foam specks in a ring around the
camera, visible on a calm lake because cascade 5 is the only foam source left. Forcing
non-mipmapped filtering spreads them everywhere, so it is the Jacobian evaluated on an
under-resolved cascade.

I do not have the root cause either. But the proposed cure (stop a sub-pixel cascade
feeding the fold test) is a special case of a broader change: decide foam from slope
*statistics* over the pixel instead of from one point sample of the Jacobian. If each
cascade's unresolved slope variance is known per pixel
([05 §3](./05-surface-shading.md#3-quality-carry-slope-statistics-not-distance-fades)),
the fold test becomes "what fraction of this pixel's footprint is folded", which is a
smooth number and cannot speckle. That would fix the band without first explaining it.
