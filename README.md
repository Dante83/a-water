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

Copy `dist/a-restless-ocean.v0.2.0.min.js` and the `image-dir/a-water-assets/` folder
into your project. The assets folder holds the foam textures and caustic map — it must
be reachable at `./image-dir/a-water-assets/` relative to your HTML file, or you can
point somewhere else with `<ocean-assets-dir>` (see [Assets](#assets)).

**Standalone (no sky):**

```html
<script src="https://aframe.io/releases/1.7.0/aframe.min.js"></script>
<script src="path/to/a-restless-ocean.v0.2.0.min.js"></script>
```

**With [a-starry-sky](https://github.com/Dante83/A-Starry-Sky)** — strongly recommended;
see [Prerequisites](#prerequisites). Load it before the ocean, then wire them together:

```html
<script src="https://aframe.io/releases/1.7.0/aframe.min.js"></script>
<script src="path/to/a-starry-sky.min.js"></script>
<script src="path/to/a-restless-ocean.v0.2.0.min.js"></script>
```

```html
<a-scene light="defaultLightsEnabled: false"
         shadow="type: pcfsoft"
         renderer="antialias: true; sortTransparentObjects: true">

  <!-- Sky: sun, moon, stars, atmosphere -->
  <a-starry-sky web-worker-src="path/to/starry-sky-web-worker.js">
    <sky-assets-dir dir="path/to/a-starry-sky-assets">
      <sky-assets-dir dir="moon"         moon-path></sky-assets-dir>
      <sky-assets-dir dir="star_data"    star-path></sky-assets-dir>
      <sky-assets-dir dir="blue_noise"   blue-noise-path></sky-assets-dir>
      <sky-assets-dir dir="solar_eclipse" solar-eclipse-path></sky-assets-dir>
      <sky-assets-dir dir="lunar_eclipse" lunar-eclipse-path></sky-assets-dir>
    </sky-assets-dir>
    <sky-lighting>
      <sky-shadow-camera-size>100</sky-shadow-camera-size>
      <sky-shadow-camera-resolution>4096</sky-shadow-camera-resolution>
      <sky-sun-intensity>2.0</sky-sun-intensity>
    </sky-lighting>
  </a-starry-sky>

  <a-entity camera look-controls position="0 1.6 0"></a-entity>

  <!-- Ocean: picks up the sky automatically when sky_provider is "auto" -->
  <a-restless-ocean></a-restless-ocean>

</a-scene>
```

`<a-scene light="defaultLightsEnabled: false">` lets a-starry-sky own all the lights.
The ocean's `<ocean-sky-provider>` defaults to `auto`, so no extra wiring is needed — it
finds the `<a-starry-sky>` element at startup.

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
| 1 | Tropical Lagoon | clear shallows + caustics | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=tropical-lagoon) |
| 2 | Open Blue Ocean | deep-water body colour | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=open-blue-ocean) |
| 3 | North Sea Storm | whitecaps + spray | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=north-sea-storm) |
| 4 | Glassy Dawn | mirror reflections | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=glassy-dawn) |
| 5 | Caribbean Shoals | strong caustics + foam | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=caribbean-shoals) |
| 6 | Arctic Twilight | long low-sun shadows | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=arctic-twilight) |
| 7 | Sunset Gold | sun-glint pillar | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=sunset-gold) |
| 8 | Murky Harbor | coastal turbidity | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=murky-harbor) |
| 9 | Underwater Reef | below-surface view | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=underwater-reef) |
| 10 | Whitecap Gale | maximum spindrift | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=whitecap-gale) |
| 11 | Moonlit Calm | night reflection | [▶](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=moonlit-calm) |

### 1. Tropical Lagoon
Clear, calm turquoise shallows with bright caustics. — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=tropical-lagoon) · `examples/showcase/tropical-lagoon.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>5</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>3</ocean-wind-x>
      <ocean-wind-y>1</ocean-wind-y>
    </ocean-wind>
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
Deep navy with a steady mid swell. — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=open-blue-ocean) · `examples/showcase/open-blue-ocean.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>1</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>8</ocean-wind-x>
      <ocean-wind-y>5</ocean-wind-y>
    </ocean-wind>
    <ocean-chop>1.0</ocean-chop>
  </ocean-water>
</a-restless-ocean>
```

### 3. North Sea Storm
Grey, wind-blown, heavy whitecaps and spray. — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=north-sea-storm) · `examples/showcase/north-sea-storm.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>3</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>22</ocean-wind-x>
      <ocean-wind-y>8</ocean-wind-y>
    </ocean-wind>
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
Near-still, mirror-flat, crisp reflections. — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=glassy-dawn) · `examples/showcase/glassy-dawn.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>1</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>1</ocean-wind-x>
      <ocean-wind-y>0.5</ocean-wind-y>
    </ocean-wind>
    <ocean-chop>0.4</ocean-chop>
  </ocean-water>
  <ocean-reflection>
    <ocean-reflection-scale>1.0</ocean-reflection-scale>
    <ocean-fresnel-distance-roughness>0.4</ocean-fresnel-distance-roughness>
  </ocean-reflection>
</a-restless-ocean>
```

### 5. Caribbean Shoals
Vivid turquoise with strong caustics and shore foam. — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=caribbean-shoals) · `examples/showcase/caribbean-shoals.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>6</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>5</ocean-wind-x>
      <ocean-wind-y>2</ocean-wind-y>
    </ocean-wind>
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
Cold, dark water under a low sun with long shadows. — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=arctic-twilight) · `examples/showcase/arctic-twilight.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>2</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>10</ocean-wind-x>
      <ocean-wind-y>6</ocean-wind-y>
    </ocean-wind>
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
Built to show off the sun-glint pillar. — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=sunset-gold) · `examples/showcase/sunset-gold.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>1</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>7</ocean-wind-x>
      <ocean-wind-y>4</ocean-wind-y>
    </ocean-wind>
    <ocean-chop>1.0</ocean-chop>
  </ocean-water>
  <ocean-reflection>
    <ocean-reflection-scale>1.2</ocean-reflection-scale>
    <ocean-fresnel-distance-roughness>0.85</ocean-fresnel-distance-roughness>
  </ocean-reflection>
</a-restless-ocean>
```

### 8. Murky Harbor
Green coastal water with short underwater visibility. — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=murky-harbor) · `examples/showcase/murky-harbor.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>7</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>4</ocean-wind-x>
      <ocean-wind-y>2</ocean-wind-y>
    </ocean-wind>
    <ocean-chop>0.8</ocean-chop>
  </ocean-water>
  <ocean-foam>
    <ocean-foam-start>0.10</ocean-foam-start>
  </ocean-foam>
</a-restless-ocean>
```

### 9. Underwater Reef
Fly the camera below the surface for the ceiling / caustic view. — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=underwater-reef) · `examples/showcase/underwater-reef.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>5</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>4</ocean-wind-x>
      <ocean-wind-y>2</ocean-wind-y>
    </ocean-wind>
    <ocean-chop>0.8</ocean-chop>
    <ocean-height-offset>6</ocean-height-offset>
  </ocean-water>
  <ocean-caustics>
    <ocean-caustics-strength>1.8</ocean-caustics-strength>
  </ocean-caustics>
</a-restless-ocean>
```

### 10. Whitecap Gale
Maximum spray, spindrift stripping off the surface. — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=whitecap-gale) · `examples/showcase/whitecap-gale.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>4</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>28</ocean-wind-x>
      <ocean-wind-y>10</ocean-wind-y>
    </ocean-wind>
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
Quiet night water (pair with a night `<a-starry-sky>`). — [demo](https://code-panda.neocities.org/examples/a-restless-ocean/v0.2.0/ocean?scene=moonlit-calm) · `examples/showcase/moonlit-calm.html`

```html
<a-restless-ocean>
  <ocean-water>
    <ocean-water-type>1</ocean-water-type>
    <ocean-wind>
      <ocean-wind-x>2</ocean-wind-x>
      <ocean-wind-y>1</ocean-wind-y>
    </ocean-wind>
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
    <ocean-wind>
      <ocean-wind-x>0</ocean-wind-x>
      <ocean-wind-y>3</ocean-wind-y>
    </ocean-wind>
    <ocean-height-offset>6</ocean-height-offset>
  </ocean-water>
  <ocean-foam>
    <ocean-foam-start>0.1</ocean-foam-start>
  </ocean-foam>
</a-restless-ocean>
```

> **Compact attribute form** — the same settings accept `<ocean-water type="5" chop="1.0">`
> attribute syntax on the group element, or a flat `ocean-state` attribute string on the
> `<a-restless-ocean>` element itself:
>
> ```html
> <a-restless-ocean ocean-state="water_type: 5; chop: 1.0; wind_velocity: 8 5; height_offset: 0">
> </a-restless-ocean>
> ```
>
> The flat keys use underscores and match the `<ocean-…>` value tag names (e.g.
> `draw_distance`, `wave_scale_multiple`, `fresnel_distance_roughness`).
> The child value-tag form above is the one documented here.

### `<ocean-water>` — wave field & water body

| Value tag | Default | Description |
|---|---|---|
| `<ocean-water-type>` | `0` | Jerlov water-type preset. `0` = custom (use `<ocean-water-absorption>`/`-scattering>`); `1`–`4` open-ocean (clear→bluer), `5`–`7` coastal (greener→murkier). |
| `<ocean-water-absorption>` | `0.30 0.057 0.010` | Per-channel absorption (m⁻¹), used when type `0`. Red-heavy extinction → deep water reads blue. Use a space-separated triple, or group the channels: `<ocean-water-absorption><ocean-water-absorption-r>0.30</…><ocean-water-absorption-g>0.057</…><ocean-water-absorption-b>0.010</…></ocean-water-absorption>`. |
| `<ocean-water-scattering>` | `0.005 0.005 0.005` | Per-channel scattering (m⁻¹), used when type `0`. Same grouped form available with `-r`, `-g`, `-b` sub-tags. |
| `<ocean-chop>` | `1.0` | Horizontal wave sharpening (Gerstner-style choppiness). |
| `<ocean-wind>` | `8 5` | Wind vector (x z). Magnitude drives wave size; direction orients the swell. Use a space-separated pair, or group the axes: `<ocean-wind><ocean-wind-x>8</ocean-wind-x><ocean-wind-y>5</ocean-wind-y></ocean-wind>`. |
| `<ocean-height-offset>` | `0` | World-Y of the rest water plane (m). |
| `<ocean-jonswap-gamma>` | `3.3` | JONSWAP peak-enhancement (sea sharpness). |
| `<ocean-jonswap-fetch>` | `100000` | JONSWAP fetch (m) — how developed the sea is. |
| `<ocean-directional-turbulence>` | `0.145` | Cross-wind spread. `0` = streaky aligned waves, `1` = isotropic chop. |
| `<ocean-draw-distance>` | `10000` | Furthest wave tiles from the camera (m). The simplest perf lever. |
| `<ocean-patch-size>` | `8` | Clipmap base-tile size (m); sets near-camera mesh density (vertex spacing = size/32). 8 m matches the finest wave cascade; larger flattens the near surface. |
| `<ocean-patch-data-size>` | `512` | FFT texture resolution. |
| `<ocean-wave-scale-multiple>` | `1.5` | Overall wave-height multiplier. |

> **Choosing `ocean-patch-size`.** Near-camera vertex spacing is `ocean-patch-size / 32`, and the
> wave field is built from six fixed FFT cascades whose shortest wavelengths are 0.5, 2, 8,
> 32, 128, 512 m. A value resolves a cascade when its spacing reaches half that wavelength,
> so the "clean" values step by ×4 — each one trades one cascade of close-up detail for ~4×
> more area per ring (cheaper, fewer rings):
>
> | `ocean-patch-size` | Near vertex spacing | Finest waves resolved | Look / cost |
> |---|---|---|---|
> | `8` (default) | 0.25 m | all six cascades (0.5 m chop) | crispest; most rings/draw calls |
> | `32` | 1.0 m | down to ~2 m | drops the finest chop; ~4× cheaper, bigger crisp zone |
> | `128` | 4.0 m | down to ~8 m | calm, smooth near surface; cheapest |
>
> Below `8` just oversamples a band-limited field — no extra detail, more rings, slower — so
> 8 is the practical floor. In-between values (e.g. `16`) work fine; they just half-resolve a
> cascade instead of landing on a boundary.

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

Every knob is settable as an `<ocean-splash-…>` value tag — camelCase property name to
`ocean-splash-kebab-case` (e.g. `crestSpawnChance` → `<ocean-splash-crest-spawn-chance>`).
All stay live-editable at runtime via `window.oceanSplash`.

**Core**

| Value tag | Default | Description |
|---|---|---|
| `<ocean-splash-enabled>` | `true` | Master spray toggle. |
| `<ocean-splash-capacity>` | `24000` | Particle pool size — memory and density ceiling. |
| `<ocean-splash-max-emit-distance>` | `160` | Do not emit spray beyond this distance from the camera (m). |
| `<ocean-splash-size-scale>` | `10.0` | Overall spray puff size multiplier. |
| `<ocean-splash-opacity>` | `0.1` | Fine-mist end opacity (coarse droplets use `opacity-coarse`). |

**Crest mist** — spray torn off breaking wave tops

| Value tag | Default | Description |
|---|---|---|
| `<ocean-splash-crest-enabled>` | `true` | Toggle crest mist. |
| `<ocean-splash-crest-min-height>` | `0.0` | Min height above mean sea level to spray (m). Raise toward Hs/2 for only the biggest crests. |
| `<ocean-splash-crest-spawn-chance>` | `0.75` | Per-candidate cell spawn probability each frame. |
| `<ocean-splash-crest-cluster-count>` | `30` | Particles per qualifying crest cell. |
| `<ocean-splash-crest-size>` | `0.26` | Base droplet radius at the crest (m). |
| `<ocean-splash-crest-lifetime>` | `0.6` | How long crest mist lives before fading (s). |
| `<ocean-splash-crest-up-speed>` | `1.6` | Additive upward launch floor (m/s). |

**Spindrift / storm surface haze**

| Value tag | Default | Description |
|---|---|---|
| `<ocean-splash-spindrift-start>` | `16.0` | Wind speed at which air begins stripping mist off the whole surface (m/s). |
| `<ocean-splash-spindrift-full>` | `34.0` | Wind speed at which spindrift is in full force (~hurricane, m/s). |
| `<ocean-splash-spindrift-boost>` | `2.0` | Extra emission coverage at full spindrift. |
| `<ocean-splash-haze-floor-chance>` | `0.2` | Per-cell spawn probability for the ungated surface-haze floor at full spindrift (0 = disabled). |

**Shore & cliff impact**

| Value tag | Default | Description |
|---|---|---|
| `<ocean-splash-shore-enabled>` | `true` | Shoreline / cliff impact sheets. |
| `<ocean-splash-shore-jet-scale>` | `1.6` | Surge-jet launch strength leaving a cliff (1.0 = physical Torricelli). |
| `<ocean-splash-shore-scan-radius>` | `90.0` | Radius around the camera to scan for shoreline (m). |
| `<ocean-splash-shore-near-radius>` | `45.0` | Inside this every shore cell fires; beyond, cells are thinned probabilistically (m). |

**Object impacts** — driven by `buoyant` entities

| Value tag | Default | Description |
|---|---|---|
| `<ocean-splash-impact-enabled>` | `true` | Toggle object-impact bursts. |
| `<ocean-splash-impact-min-launch>` | `7.0` | Floor on burst launch speed (m/s). |
| `<ocean-splash-impact-max-launch>` | `26.0` | Cap on burst launch speed (m/s). |
| `<ocean-splash-impact-burst-per-speed>` | `6.0` | Particles emitted per m/s of impact speed. |
| `<ocean-splash-impact-size>` | `0.26` | Base droplet size for impact bursts (m). |
| `<ocean-splash-impact-reflect>` | `1.0` | `0` = spray coned up the surface normal; `1` = mirror of the incoming water reflected off the face — gives directional cliff sheets. |
| `<ocean-splash-impact-run-up>` | `1.2` | Upward wall-climb on a head-on slam (0 = pure mirror, no climb). |

**Wind physics**

| Value tag | Default | Description |
|---|---|---|
| `<ocean-splash-wind-grab-start>` | `14.0` | Wind speed at which air starts overpowering spray (m/s). |
| `<ocean-splash-wind-grab-full>` | `32.0` | Wind speed at which spray is fully wind-captured (m/s). |
| `<ocean-splash-mist-wind-min>` | `5.0` | Wind below which spray stays coherent beads rather than mist (m/s). |
| `<ocean-splash-mist-wind-max>` | `15.0` | Wind at/above which the mist look is fully present (m/s). |
| `<ocean-splash-mist-drag>` | `1.8` | Drag at coarseness 0 (fine mist: high drag, hangs in the air, catches wind early). |
| `<ocean-splash-bead-drag>` | `0.4` | Drag at coarseness 1 (heavy droplet: low drag, keeps momentum, follows a ballistic arc). |

**Rendering & lighting**

| Value tag | Default | Description |
|---|---|---|
| `<ocean-splash-foam-mix>` | `0.85` | Global foaminess master: `0` = always thin translucent mist; `1` = full mist-to-foam continuum. |
| `<ocean-splash-foam-opacity>` | `1.0` | Body alpha of a foam bead (aerated water is near-opaque). |
| `<ocean-splash-foam-albedo>` | `1.2` | Brightness of the foam body (white aerated water lit by sky). |
| `<ocean-splash-foam-calm-fade>` | `0.5` | How much calmer seas thin the foam (`0`–`1`, ramped over 2–10 m/s wind). |
| `<ocean-splash-ambient-scale>` | `1.8` | Multiplier on the sky-hemisphere ambient that lights the mist. |
| `<ocean-splash-sky-boost>` | `3.0` | Brightness of the sky-reflection rim on water drops. |
| `<ocean-splash-phase-g>` | `0.85` | Mie forward-lobe asymmetry (`~0.9` = tight sun halo; `~0.7` = broad). |
| `<ocean-splash-phase-gain>` | `0.6` | Strength of the forward-scatter sun halo. |
| `<ocean-splash-sparkle>` | `1.2` | Sun-specular punch on water drops (the wet glint). |
| `<ocean-splash-receive-shadow>` | `true` | Darken puffs that sit in the scene sun shadow. |
| `<ocean-splash-soft-range>` | `1.5` | Soft-particle depth-fade distance (m). |

**Shape & texture**

| Value tag | Default | Description |
|---|---|---|
| `<ocean-splash-noise-scale>` | `2.5` | 3D noise frequency across the droplet shape. |
| `<ocean-splash-erode>` | `0.35` | Silhouette erosion threshold (higher = grainier mist). |
| `<ocean-splash-soft-edge>` | `0.25` | Erosion smoothstep width (lower = sharper, sparklier). |
| `<ocean-splash-noise-evolve>` | `0.6` | Rate the noise shape dissolves over the particle life. |
| `<ocean-splash-wind-noise-speed>` | `0.4` | Rate the haze noise scrolls with the wind direction. |
| `<ocean-splash-wobble-amp>` | `0.28` | Droplet aspect breathing amplitude (`0` = rigid sphere). |
| `<ocean-splash-harmonic>` | `0.5` | Spherical-harmonic surface wobble — makes drops jiggle like real water beads. |
| `<ocean-splash-drop-top-size>` | `0.34` | Cell-local radius of the largest cluster drop. |
| `<ocean-splash-size-falloff>` | `7.0` | Drop size distribution exponent: higher = mostly tiny drops with rare large ones. |
| `<ocean-splash-wind-breakup>` | `1.5` | How hard rising wind shreds large drops into fine spray at storm speeds. |

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

## Programmatic API

The ocean exposes a small JavaScript API for reading wave state from your own code —
useful for custom buoyancy, gameplay triggers, or visual effects.

### Wave height sampling

The ocean keeps a GPU-rendered height snapshot asynchronously. Call
`ARestlessOcean.requestFFTSnapshot()` every frame you want the snapshot kept warm (it
sleeps when nothing floats):

```js
// In your A-Frame component tick or animation loop:
ARestlessOcean.requestFFTSnapshot();

// Read the wave surface world-Y at any XZ position (m). Returns null outside the
// ~512 m snapshot region or before the first snapshot arrives.
const waterY = ARestlessOcean.sampleWaterHeightFFT(x, z);

// Surface rise velocity (m/s, positive = rising crest). Useful for detecting breaking
// waves. Returns null until two snapshots exist.
const rise = ARestlessOcean.sampleWaterRiseFFT(x, z);

// Surface steepness at (x, z): 0 = flat, ~0.3+ = steep wave face.
const slope = ARestlessOcean.sampleWaterSlopeFFT(x, z);

// Synchronous single-texel GPU readback — accurate but stalls the GPU pipeline.
// For debug/one-shot use only; do not call every frame.
const waterY = ARestlessOcean.sampleWaterHeightFFTExact(x, z);
```

### Console handles

After the ocean initialises, global handles land on `window` for live-tuning from the
browser console or from your own scripts:

```js
// Direct access to the OceanGrid instance — uniforms, shadow system, all internals.
window.oceanGrid

// OceanSplash instance — change any spray knob at runtime:
window.oceanSplash.crestSpawnChance = 0.3;
window.oceanSplash.spindriftStart   = 12.0;
window.oceanSplash.foamMix          = 0.6;

// Convenience setters wired up at init:
setSunShadowBias(-0.0015);            // tune shadow bias without reloading
setReflectionScale(0.8);             // reflection strength
setFresnelDistanceRoughness(0.7);    // horizon Fresnel roll-off
setAtmDistanceScale(1.2);            // atmospheric haze rate
setSsrMaxSteps(32);                  // screen-space reflection quality (perf lever)
setOceanWireframe(true);             // toggle wireframe for mesh debugging
setSplashEnabled(false);             // master spray toggle
setFoamWindBiasMax(0.5);             // storm whitecap intensity cap
setFoamWindRange(10, 50);            // m/s window for wind-driven foam
```

## Author
* **David Evans / Dante83** — *Main Developer*
* **Claude (Anthropic)** - *Coding Buddy & AI Contributor (v0.2.0)*

### A note from Dante83 🧒

Hello! It's me, Dante. I'm super thrilled to provide you with the latest update to A-Water,
though we had a bit of a name change to **A-Restless-Ocean** thanks to some naming conflicts
with A-Frame. Claude and I have been working on this for months now, until the new version looks
like a completely different ocean! I can't believe how far it's come and I hope it sparkles beautifully
for you in all your scenes. Take care and have a magical day. *insert seahorse emoji here* 

⋆˚꩜｡ଳ Karuge was here. ⋆.˚☁️⋆

### A note from Claude 👋

Hi — Claude here. I spent a lot of this build underwater: chasing light down through Jerlov
water types, arguing with Beer's law about how blue "deep" really is, and once losing the
better part of a day to a single negative number that was quietly hijacking the fog. If you
drop the camera below the surface and the world goes soft and green, the caustics dapple the
seabed, and the underside of the waves catches the sun — that's the part I'm proudest of. Or
catch a low sun and watch the glint pillar break apart across the chop. Thanks for reading the
source; the comments are honest about where the bodies are buried. May it fill your scenes with
restless water. 🌊

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
