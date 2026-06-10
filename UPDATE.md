**Version 0.2.0 — "a-restless-ocean"**

This release renames the library from **a-water** to **a-restless-ocean** (the public
tag is now `<a-restless-ocean>`) and is a near-total rewrite of the renderer. The
single flat wave plane of 0.1.0 became a horizon-spanning, physically-grounded ocean
with LOD, self-shadowing, foam, caustics, full underwater rendering, splash/spray and
a Crest-style spectral wave field. Highlights:

* Replaced the viewport-locked plane with a **clipmap LOD surface** (instanced rings,
  world-space cells doubling outward) so the ocean reaches the horizon at a fraction
  of the triangle count.
* Ported a **Crest-style banded FFT cascade** spectrum (one octave per cascade,
  directional spreading turbulence, JONSWAP fetch/gamma) for realistic, non-tiling
  wave shape across scales.
* **Per-fragment normals** (was per-vertex) with an 8-sample Sobel kernel, mipmapped
  normal render target, and distance-aware displacement/normal fades — kills the
  horizon shimmer, grain and visible FFT tiling.
* **Jerlov water-type presets** plus explicit physical absorption/scattering, so deep
  water reads as a real navy body rather than a tinted mirror.
* **Atmospheric perspective** integration (LUT inscattering) shared with the sky.
* **Sun glint / specular** reworked to a Fresnel-gated Phong-on-reflection lobe, with
  a Karis split-sum horizon-roughness cap to tame the grazing-angle white-out.
* Screen-space reflections with sRGB/HDR fixes and distance Fresnel roll-off.
* Ocean **self-shadowing** via a 4-cascade CSM using exponential variance shadow maps
  (EVSM), plus correct receipt of the scene's directional **sun shadow** on the water,
  seabed and shoreline.
* **Broadband-Jacobian foam** (summed wave-fold whitening, Crest-style) and
  **shoreline / heightmap foam** for edge foam around islands and terrain.
* Full **below-surface rendering**: Snell's window, total-internal-reflection ceiling,
  caustic god-light, depth fog and a physical Henyey-Greenstein inscatter that unifies
  the body colour, underwater fog and the scene fog chunk.
* A CPU-pooled **spray system**: crest mist torn off breaking wave tops, wind-driven
  spindrift, shoreline surge sheets and object-impact bursts fed by the buoyancy system.
* A volumetric **mist shader** (phase forward-scatter, procedural noise sphere, wrap
  lighting, shadow receipt) so spray puffs read as real vapour rather than flat sprites.
* New **`<a-restless-ocean>`** primitive with **grouped child-element configuration**
  (`<ocean-water>`, `<ocean-foam>`, `<ocean-caustics>`, `<ocean-reflection>`,
  `<ocean-atmosphere>`, `<ocean-shadow>`, `<ocean-splash>`) — the flat
  `ocean-state="…"` attribute still works as the default layer.
* A **`sky-provider`** option: drop the ocean into an `<a-starry-sky>` scene and it
  integrates automatically, or run **standalone** off a plain directional + hemisphere
  light with no atmosphere dependency.
* **Ocean fragment-exclusion masks** (`ocean-static-mask` component) for carving the
  ocean out of terrain indents and the interiors of boat hulls.
* A **`buoyant`** component for floating bodies — Archimedes force + righting torque
  on a rigid solver, or a forgiving kinematic plane-fit for props — with a companion
  `buoyancy-hull` component for custom probe footprints.
* The JS namespace moved from **`AWater.AOcean`** to **`ARestlessOcean`**. The old
  name still resolves through a compatibility shim that logs a one-time deprecation
  notice — migrate `AWater.AOcean.X` references to `ARestlessOcean.X`.

**Version 0.1.0**
* Implemented ocean FFT heightmap based on [Oreon Engine FFT Waves Tutorial](https://youtu.be/B3YOLg0sA2g).
* Emulated infinite ocean with a viewport-oriented approach (follows the camera) with motion emulated by moving the uv-coordinates.
* Added camera-centered, cubemap based refraction, reflection and depth exponential scattering.
* Added water surface detailing by combining normal maps from [Water Simulation](https://watersimulation.tumblr.com/post/115928250077/scrolling-normal-maps) along with additive normal map techniques from [Blending in Detail](https://blog.selfshadow.com/publications/blending-in-detail/).
* Added height based scattering glow to the waves with scattering glow dependent upon the brightest direct lighting in the scene.
