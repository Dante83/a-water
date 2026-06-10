# A-Restless-Ocean

A-Restless-Ocean (formerly *a-water*) is a drop-in **procedural ocean** for the
[A-Frame Web Framework](https://aframe.io/). A single `<a-restless-ocean>` tag gives
you a horizon-spanning FFT wave field with physically-grounded water colour,
reflections, self-shadowing, foam, caustics, splash/spray and full underwater
rendering — and it integrates with [a-starry-sky](https://github.com/Dante83/A-Starry-Sky)
for matching sky, sun and atmosphere, or runs standalone.

> **Warning:** this is a heavy real-time renderer — it expects a reasonably powerful
> desktop GPU. It is not intended for mobile phones.

## Prerequisites

Built for [A-Frame](https://aframe.io/) **1.2.0+** and a WebGL2-capable browser.

```html
<script src="https://aframe.io/releases/1.2.0/aframe.min.js"></script>
```

**[a-starry-sky](https://github.com/Dante83/A-Starry-Sky) is highly recommended.** It isn't
a hard requirement — the ocean detects its absence and runs standalone — but the water
reflects and lights from the sky, so a-starry-sky is what makes it look its best: it supplies
the sun/moon, lighting and atmosphere and unlocks sun glint, day/night, eclipses and matching
underwater fog. See [Sky integration](#sky-integration).

## Installing

Copy `dist/a-restless-ocean.v0.2.0.min.js` and the asset folder into your project, then
add the script after A-Frame (and after a-starry-sky, if you use it):

```html
<script src="https://aframe.io/releases/1.2.0/aframe.min.js"></script>
<script src="{PATH_TO_JS}/a-restless-ocean.v0.2.0.min.js"></script>
```

## Quick start

Add `<a-restless-ocean>` to your scene and make sure there is a camera — the ocean
follows the scene's primary camera so it always surrounds the viewer:

```html
<a-scene>
  <a-entity camera look-controls wasd-controls position="0 1.6 0"></a-entity>
  <a-restless-ocean></a-restless-ocean>
</a-scene>
```

That alone gives you an animated, infinite ocean. Everything below is optional tuning.

## Gallery — see it in action

The quickest way to get a feel for the ocean is to watch it move. Every look below has a
**live demo — click through and fly around**, then copy its snippet (or grab the full scene
under `examples/showcase/`) as a starting point. Pair each with your own island/scene assets
and an `<a-starry-sky>` for the sky.

| # | Look | Shows off | Demo |
|---|---|---|---|
| 1 | Tropical Lagoon | clear shallows + caustics | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/tropical-lagoon) |
| 2 | Open Blue Ocean | deep-water body colour | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/open-blue-ocean) |
| 3 | North Sea Storm | whitecaps + spray | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/north-sea-storm) |
| 4 | Glassy Dawn | mirror reflections | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/glassy-dawn) |
| 5 | Caribbean Shoals | strong caustics + foam | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/caribbean-shoals) |
| 6 | Arctic Twilight | long low-sun shadows | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/arctic-twilight) |
| 7 | Sunset Gold | sun-glint pillar | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/sunset-gold) |
| 8 | Murky Harbor | coastal turbidity | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/murky-harbor) |
| 9 | Underwater Reef | below-surface view | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/underwater-reef) |
| 10 | Whitecap Gale | maximum spindrift | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/whitecap-gale) |
| 11 | Moonlit Calm | night reflection | [▶](https://code-panda.com/pages/projects/a_restless_ocean/showcase/moonlit-calm) |

### 1. Tropical Lagoon
Clear, calm turquoise shallows with bright caustics. — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/tropical-lagoon) · `examples/showcase/tropical-lagoon.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>5</ocean-water-type>
    <ocean-wind>3 1</ocean-wind>
    <ocean-chop>0.7</ocean-chop>
  </ocean-water>
  <ocean-caustics>
    <ocean-caustics-strength>1.6</ocean-caustics-strength>
  </ocean-caustics>
  <ocean-foam>
    <ocean-foam-start>0.12</ocean-foam-start>
  </ocean-foam>
</a-restless-ocean>
```

### 2. Open Blue Ocean
Deep navy with a steady mid swell. — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/open-blue-ocean) · `examples/showcase/open-blue-ocean.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>1</ocean-water-type>
    <ocean-wind>8 5</ocean-wind>
    <ocean-chop>1.0</ocean-chop>
  </ocean-water>
</a-restless-ocean>
```

### 3. North Sea Storm
Grey, wind-blown, heavy whitecaps and spray. — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/north-sea-storm) · `examples/showcase/north-sea-storm.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>3</ocean-water-type>
    <ocean-wind>22 8</ocean-wind>
    <ocean-chop>1.2</ocean-chop>
    <ocean-jonswap-gamma>4.0</ocean-jonswap-gamma>
  </ocean-water>
  <ocean-foam>
    <ocean-foam-start>0.05</ocean-foam-start>
  </ocean-foam>
  <ocean-splash>
    <ocean-splash-capacity>40000</ocean-splash-capacity>
    <ocean-splash-impact-min-launch>10</ocean-splash-impact-min-launch>
    <ocean-splash-wind-grab-start>12</ocean-splash-wind-grab-start>
  </ocean-splash>
</a-restless-ocean>
```

### 4. Glassy Dawn
Near-still, mirror-flat, crisp reflections. — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/glassy-dawn) · `examples/showcase/glassy-dawn.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>1</ocean-water-type>
    <ocean-wind>1 0.5</ocean-wind>
    <ocean-chop>0.4</ocean-chop>
  </ocean-water>
  <ocean-reflection>
    <ocean-reflection-scale>1.0</ocean-reflection-scale>
    <ocean-fresnel-distance-roughness>0.4</ocean-fresnel-distance-roughness>
  </ocean-reflection>
</a-restless-ocean>
```

### 5. Caribbean Shoals
Vivid turquoise with strong caustics and shore foam. — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/caribbean-shoals) · `examples/showcase/caribbean-shoals.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>6</ocean-water-type>
    <ocean-wind>5 2</ocean-wind>
    <ocean-chop>0.9</ocean-chop>
  </ocean-water>
  <ocean-caustics>
    <ocean-caustics-strength>2.0</ocean-caustics-strength>
  </ocean-caustics>
  <ocean-foam>
    <ocean-foam-start>0.08</ocean-foam-start>
  </ocean-foam>
</a-restless-ocean>
```

### 6. Arctic Twilight
Cold, dark water under a low sun with long shadows. — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/arctic-twilight) · `examples/showcase/arctic-twilight.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>2</ocean-water-type>
    <ocean-wind>10 6</ocean-wind>
    <ocean-chop>1.0</ocean-chop>
  </ocean-water>
  <ocean-shadow>
    <ocean-shadow-sun-bias>-0.0017</ocean-shadow-sun-bias>
  </ocean-shadow>
  <ocean-reflection>
    <ocean-reflection-scale>0.8</ocean-reflection-scale>
  </ocean-reflection>
</a-restless-ocean>
```

### 7. Sunset Gold
Built to show off the sun-glint pillar. — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/sunset-gold) · `examples/showcase/sunset-gold.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>1</ocean-water-type>
    <ocean-wind>7 4</ocean-wind>
    <ocean-chop>1.0</ocean-chop>
  </ocean-water>
  <ocean-reflection>
    <ocean-reflection-scale>1.2</ocean-reflection-scale>
    <ocean-fresnel-distance-roughness>0.85</ocean-fresnel-distance-roughness>
  </ocean-reflection>
</a-restless-ocean>
```

### 8. Murky Harbor
Green coastal water with short underwater visibility. — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/murky-harbor) · `examples/showcase/murky-harbor.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>7</ocean-water-type>
    <ocean-wind>4 2</ocean-wind>
    <ocean-chop>0.8</ocean-chop>
  </ocean-water>
  <ocean-foam>
    <ocean-foam-start>0.10</ocean-foam-start>
  </ocean-foam>
</a-restless-ocean>
```

### 9. Underwater Reef
Fly the camera below the surface for the ceiling / caustic view. — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/underwater-reef) · `examples/showcase/underwater-reef.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>5</ocean-water-type>
    <ocean-wind>4 2</ocean-wind>
    <ocean-chop>0.8</ocean-chop>
    <ocean-height-offset>6</ocean-height-offset>
  </ocean-water>
  <ocean-caustics>
    <ocean-caustics-strength>1.8</ocean-caustics-strength>
  </ocean-caustics>
</a-restless-ocean>
```

### 10. Whitecap Gale
Maximum spray, spindrift stripping off the surface. — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/whitecap-gale) · `examples/showcase/whitecap-gale.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>4</ocean-water-type>
    <ocean-wind>28 10</ocean-wind>
    <ocean-chop>1.2</ocean-chop>
  </ocean-water>
  <ocean-foam>
    <ocean-foam-start>0.04</ocean-foam-start>
  </ocean-foam>
  <ocean-splash>
    <ocean-splash-capacity>50000</ocean-splash-capacity>
    <ocean-splash-crest-min-height>0.8</ocean-splash-crest-min-height>
    <ocean-splash-wind-grab-start>10</ocean-splash-wind-grab-start>
    <ocean-splash-wind-grab-full>28</ocean-splash-wind-grab-full>
  </ocean-splash>
</a-restless-ocean>
```

### 11. Moonlit Calm
Quiet night water (pair with a night `<a-starry-sky>`). — [demo](https://code-panda.com/pages/projects/a_restless_ocean/showcase/moonlit-calm) · `examples/showcase/moonlit-calm.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>1</ocean-water-type>
    <ocean-wind>2 1</ocean-wind>
    <ocean-chop>0.5</ocean-chop>
  </ocean-water>
  <ocean-reflection>
    <ocean-reflection-scale>1.0</ocean-reflection-scale>
    <ocean-fresnel-distance-roughness>0.6</ocean-fresnel-distance-roughness>
  </ocean-reflection>
  <ocean-atmosphere>
    <ocean-sky-provider>a-starry-sky</ocean-sky-provider>
  </ocean-atmosphere>
</a-restless-ocean>
```

## Configuration

Everything is tuned with grouped child elements, the a-starry-sky way: one `<ocean-…>`
element per setting, its value held as that element's text content, grouped under the
relevant `<ocean-water>` / `<ocean-foam>` / … parent:

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>5</ocean-water-type>
    <ocean-chop>1.0</ocean-chop>
    <ocean-wind>0 3</ocean-wind>
    <ocean-height-offset>6</ocean-height-offset>
  </ocean-water>
  <ocean-foam>
    <ocean-foam-start>0.1</ocean-foam-start>
  </ocean-foam>
</a-restless-ocean>
```

> For terse or programmatic setups the same settings also accept a compact attribute form
> (`<ocean-water type="5" chop="1.0">`) and a flat `ocean-state="key: value; …"` string —
> see `ocean-state.js` — but the value-tag form above is the one documented here.

### `<ocean-water>` — wave field & water body

| Value tag | Default | Description |
|---|---|---|
| `<ocean-water-type>` | `0` | Jerlov water-type preset. `0` = custom (use `<ocean-water-absorption>`/`-scattering>`); `1`–`4` open-ocean (clear→bluer), `5`–`7` coastal (greener→murkier). |
| `<ocean-water-absorption>` | `0.30 0.057 0.010` | Per-channel absorption (m⁻¹), used when type `0`. Red-heavy extinction → deep water reads blue. |
| `<ocean-water-scattering>` | `0.005 0.005 0.005` | Per-channel scattering (m⁻¹), used when type `0`. |
| `<ocean-chop>` | `1.0` | Horizontal wave sharpening (Gerstner-style choppiness). |
| `<ocean-wind>` | `8 5` | Wind vector (x z). Magnitude drives wave size; direction orients the swell. |
| `<ocean-height-offset>` | `0` | World-Y of the rest water plane (m). |
| `<ocean-jonswap-gamma>` | `3.3` | JONSWAP peak-enhancement (sea sharpness). |
| `<ocean-jonswap-fetch>` | `100000` | JONSWAP fetch (m) — how developed the sea is. |
| `<ocean-directional-turbulence>` | `0.145` | Cross-wind spread. `0` = streaky aligned waves, `1` = isotropic chop. |
| `<ocean-draw-distance>` | `10000` | Furthest wave tiles from the camera (m). The simplest perf lever. |
| `<ocean-patch-size>` | `256` | World size of the base wave patch (m). |
| `<ocean-patch-data-size>` | `512` | FFT texture resolution. |
| `<ocean-wave-scale-multiple>` | `1.5` | Overall wave-height multiplier. |

### `<ocean-foam>`

| Value tag | Default | Description |
|---|---|---|
| `<ocean-foam-enabled>` | `true` | Master foam toggle. |
| `<ocean-foam-start>` | `0.10` | Wave-fold threshold at which foam appears (lower = more foam). |
| `<ocean-foam-camera-height>` | `100` | Height of the foam/exclusion ortho camera (m). **Raise it above your tallest island** or the top gets clipped. |

The foam textures (`<ocean-foam-color-map>` / `-opacity-map` / `-normal-map`) are bundled;
point the whole folder somewhere else with [`<ocean-assets-dir>`](#assets) rather than
setting each path.

### `<ocean-caustics>`

| Value tag | Default | Description |
|---|---|---|
| `<ocean-caustics-enabled>` | `true` | Underwater caustic light toggle. |
| `<ocean-caustics-strength>` | `1.0` | Caustic intensity multiplier. |

The caustic projection texture (`<ocean-caustics-map>`) is bundled; relocate it with
[`<ocean-assets-dir>`](#assets).

### `<ocean-reflection>`

| Value tag | Default | Description |
|---|---|---|
| `<ocean-reflection-scale>` | `1.0` | Sky-reflection strength. `1.0` = full HDR sky. |
| `<ocean-reflection-distance-falloff>` | `0.0` | Extra reflection reduction toward the horizon (fakes statistical roughness). |
| `<ocean-fresnel-distance-roughness>` | `0.85` | Grazing-angle Fresnel roll-off. `0` = none; `~0.85` ≈ ocean-photo horizon. |

### `<ocean-atmosphere>`

| Value tag | Default | Description |
|---|---|---|
| `<ocean-atmosphere-enabled>` | `true` | Distance haze / inscattering on the water. |
| `<ocean-atmosphere-distance-scale>` | `1.0` | Scales how quickly distance haze accumulates. |
| `<ocean-sky-provider>` | `auto` | `auto` \| `a-starry-sky` \| `standalone` — see [Sky integration](#sky-integration). |

### `<ocean-shadow>`

| Value tag | Default | Description |
|---|---|---|
| `<ocean-shadow-sun-bias>` | `-0.0012` | Additive bias when sampling the scene sun shadow on the water. Nudge if you see a grazing-sun shadow stripe. |

### `<ocean-splash>` — spray & mist

The spray system has ~100 art-direction knobs; the common public controls are below. **Any**
knob is settable as an `<ocean-splash-…>` value tag — take its name and prefix it with
`ocean-splash-` (e.g. `<ocean-splash-crest-spawn-chance>`). All stay live-editable at runtime
via `window.oceanSplash`. See the top of `ocean-splash.js` for the full list.

| Value tag | Default | Description |
|---|---|---|
| `<ocean-splash-enabled>` | `true` | Master spray toggle. |
| `<ocean-splash-capacity>` | `24000` | Particle pool size (memory / density ceiling). |
| `<ocean-splash-max-emit-distance>` | `160` | Don't emit spray beyond this distance from the camera (m). |
| `<ocean-splash-crest-enabled>` | `true` | Mist torn off breaking wave crests. |
| `<ocean-splash-crest-min-height>` | `0.0` | Min height above mean sea level for a crest to spray (raise toward Hs/2 for only the biggest tops). |
| `<ocean-splash-shore-enabled>` | `true` | Shoreline / cliff impact sheets. |
| `<ocean-splash-shore-jet-scale>` | `1.6` | Strength of the surge-jet sheet leaving a cliff. |
| `<ocean-splash-impact-enabled>` | `true` | Object-impact bursts (fed by `buoyant`). |
| `<ocean-splash-impact-min-launch>` | `7.0` | Floor on burst launch speed (m/s). |
| `<ocean-splash-impact-max-launch>` | `26.0` | Cap on burst launch speed (m/s). |
| `<ocean-splash-impact-burst-per-speed>` | `6.0` | Particles emitted per m/s of impact speed. |
| `<ocean-splash-wind-grab-start>` | `14.0` | Wind speed at which air starts overpowering the spray (m/s). |
| `<ocean-splash-wind-grab-full>` | `32.0` | Wind speed at which spray is fully wind-captured (m/s). |
| `<ocean-splash-size-scale>` | `10.0` | Overall spray puff size multiplier. |

## Assets

The ocean ships a foam texture set and a caustic texture. They default to
`./image-dir/a-water-assets/`. To relocate them, point an `<ocean-assets-dir>` tree at
your folder — the same "set the directory once and flag the sub-dirs" pattern as
a-starry-sky's `<sky-assets-dir>`:

```html
<a-restless-ocean>
  <ocean-assets-dir dir="my-assets/ocean">
    <ocean-assets-dir dir="foam" foam-path></ocean-assets-dir>
    <ocean-assets-dir dir="." caustics-path></ocean-assets-dir>
  </ocean-assets-dir>
</a-restless-ocean>
```

* `foam-path` — the dir holds the three foam textures: `Foam002_1K_Color.png`,
  `Foam002_1K_Opacity.png`, `Foam002_1K_NormalGL.png`.
* `caustics-path` — the dir holds `caustic-map.webp`. `dir="."` means "the same folder
  as the parent `dir`".
* If you set just the outer `dir` with **no** flagged children, every bundled texture is
  loaded straight from that folder.

Keep the bundled filenames and you never type a per-texture path. If you renamed a file,
override that one with its value tag (e.g. `<ocean-caustics-map>my-caustics.webp</ocean-caustics-map>`),
which wins over the `<ocean-assets-dir>` resolution.

## Sky integration

The ocean needs sky/sun/atmosphere context for its lighting, reflections and underwater
fog. `<ocean-sky-provider>` (inside `<ocean-atmosphere>`) decides where that comes from:

* **`auto`** (default) — if an `<a-starry-sky>` element is present, use it; otherwise run
  standalone. "Drop it in and it figures itself out."
* **`a-starry-sky`** — force the a-starry-sky path. Put `<a-restless-ocean>` in a scene
  with [a-starry-sky](https://github.com/Dante83/A-Starry-Sky) and the ocean picks up its
  sun/moon, lighting and atmosphere automatically (sun glint, day/night, eclipses).
* **`standalone`** — install a minimal fog scaffold and light from a plain
  `THREE.DirectionalLight` + `HemisphereLight`, with no atmosphere dependency.

## Feature notes

* **Underwater** — move the camera below `<ocean-height-offset>` and the renderer switches to
  the below-surface model: Snell's window, total-internal-reflection ceiling, caustic
  god-light and depth-graded fog.
* **Shadows** — the ocean self-shadows its own waves (4-cascade EVSM) and receives the
  scene's directional sun shadow on the surface, seabed and shoreline.
* **Exclusion masks** — add `ocean-static-mask` to any mesh and the ocean will not render
  where that mesh covers the water plane. Useful for cliff alcoves, building interiors,
  and boat hulls where the ocean surface would otherwise poke through.

```html
<!-- Prevent water rendering inside a cove or boat hull -->
<a-entity gltf-model="url(boat-hull.glb)" ocean-static-mask></a-entity>
```

* **Buoyancy** — add `buoyant` to any entity to have it float on the wave field. The
  default rigid solver applies Archimedes force and righting torque so the body bobs
  and rocks to its own waterline from its `density`. The kinematic solver is a
  gentler plane-fit for props where surprises are unwelcome. Impact splashes fire
  automatically (requires `<ocean-splash>`).

```html
<!-- Simple floating buoy -->
<a-entity geometry="primitive: sphere; radius: 0.5"
          material="color: red"
          position="0 0 0"
          buoyant="density: 0.3"></a-entity>

<!-- Boat on the rigid solver with a tuned hull probe footprint -->
<a-entity gltf-model="url(boat.glb)"
          buoyancy-hull="points: -2 -1, -2 1, 2 -1, 2 1; inset: 0.9"
          buoyant="solver: rigid; density: 0.35; maxTilt: 20"></a-entity>
```

  `buoyancy-hull` lets you lay out explicit local-space probe points (x z pairs,
  metres) so the float samples the hull footprint rather than the bounding box corners.
  Without it, four inset bounding-box corners are used automatically.

## Author
* **David Evans / Dante83** — *Main Developer*
* **Claude (Anthropic)** - *Coding Buddy & AI Contributor (v0.2.0)*

## References & Special Thanks
* **[Oreon Engine](https://github.com/fynnfluegge/oreon-engine) / [Oreon Engine FFT Waves](https://youtu.be/B3YOLg0sA2g)** — the multi-pass GPU FFT / butterfly technique driving the wave heightmaps.
* The **[Crest](https://github.com/wave-harmonic/crest)** ocean library — inspiration for the banded distance-based wave cascades, broadband-Jacobian foam and camera-centred surface.
* **[a-starry-sky](https://github.com/Dante83/A-Starry-Sky)** — the sky, sun/moon and atmosphere this ocean integrates with.
* Caustics texture: a variation of [Water Caustics](https://opengameart.org/content/water-caustics-effect-small).
* Foam texture: [Foam 2 (ambientCG)](https://ambientcg.com/view?id=Foam002).
* All the work behind [THREE.JS](https://threejs.org/) and [A-Frame](https://aframe.io/).
* *And so many other websites and individuals. Thank you for filling our worlds with amazing oceans, deep, mysterious, and uncharted.*

## License
This project is licensed under the MIT License — see the [LICENSE.md](./LICENSE.md) file for details.
