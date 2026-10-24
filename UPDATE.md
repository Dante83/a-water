**Version 0.3.0 — "the ocean meets the land"**

* Added **multiple bodies of water**: ocean, lakes, rivers, creeks and falls now render
  side by side as one material family (see [`WATER-TYPES.md`](./WATER-TYPES.md)).
* Decomposed the 3497-line `ocean-grid.js` down to 1712 lines, extracting its render passes
  into modules under `ocean-system/passes/` that share an `init / resize / tick / dispose`
  lifecycle. A pure refactor with no visual change, but it makes room for the new passes.
* Added **lakes** as ocean: still water on the clipmap with its level read from the land's
  water field and calmer wave dynamics.
* Added **flowing rivers and creeks** with a flow-aligned surface, current, ripples and
  accumulating flow foam, driven by the land's hydrology bake.
* Added a **water-field pipeline** that decodes per-tile level, flow and energy pyramids on
  the GPU and streams them as nested cascades.
* Added **`getWaterStateAt(x, z)`**, one call that answers surface height, depth, flow and
  turbulence anywhere in the world, plus whether the answer is wet, dry or still loading.
* Added `OceanGrid.forEachOceanMesh(cb)` as the sanctioned way to reach the water materials
  from outside the grid.
* Added `ARestlessOcean.cloneUniforms()`, which deep-clones the uniform arrays
  `THREE.UniformsUtils.clone` only shallow-copies, so a second body of water no longer
  shares `Vector2` instances with the first.
* Replaced nine hand-synced foam (2048 m) and hull-exclusion (250 m) ortho half-width literals
  with one constant, spliced into `water-shader.glsl` at material-build time.
* Removed dead fields from `ocean-grid.js`, including a `Raycaster` that never worked.
* Moved the wave cascades and ocean CSM into **texture arrays** to fit the 16-sampler floor.
* Reworked shorelines so waves **shoal, steepen and break** with depth, with a travelling
  swash front climbing and draining the beach.
* Rebuilt surf foam as **travelling lace** with backwash, with no dark rings or shadow blotches.
* Added a soft **waterline** where troughs stay above the bed and steep shores surge.
* Added **shore reflections** so waves bounce off cliffs and rocks and interfere with the
  incoming set.
* Added **river mouths** that ramp down into the sea, calm it, and carry current, silt and
  foam out in a **plume**.
* Published the live surf to a-faraway-land so its **wet sand** follows the swash and dries
  between waves, now over the whole world.
* Added **water as a light source**: reflected glow on the land, with caustics owned by the
  land when it is present.
* Added **waterfalls**: nappe curtains that carry the river's texture over the lip, with a
  sheet per step on steep chutes.
* Added **volumetric waterfall mist**, raymarched, flow-stretched and self-shadowing.
* Added **foot-of-the-fall splashes**: impact particles, pool rings, surface mist and foam fog.
* Added **billowing spray clouds** with multiple scattering, land occlusion and night lighting.
* Made waterfalls **cast shadows** into their pool.
* Took a-starry-sky's **clouds** into the ocean: shadows on the sea, seabed, waterfalls and
  light shafts, and clouds in reflections.
* Added **dynamic waves**: rings and wakes that fade, lift the surface and carry foam.
* Added the **`water-interactor`** component for wading and swimming, with sphere and
  **capsule** contacts that can follow bones.
* Added entry and wade **splash** and **drift** for anything that touches the water, and
  debris that rides the current.
* Added a **hero shadow map** so your avatar and props shadow the water.
* Added **surface probes** for cheap height, normal and submersion queries.
* Updated **`buoyant`** to ride the new wave field, and fixed texture overflow in its probes.
* Drew both sides of the surface with a **Crest-style meniscus** that follows the triangles.
* Added an **underwater volume pass** with fog and light shafts that works with or without
  a sky provider.
* Added **camera medium tracking** so code can tell if the eye is in air, in water or
  straddling the surface.
* Read each ocean cascade at the **mip** that matches the vertex spacing, removing shimmer.
* Improved **reflections**, including the land's grass and rock, and added distance fading
  for water.
* Replaced three's readback with **`readPixelsAsync`**, removing a GPU stall: long tasks
  dropped from 23 to 8 per 10 s at 4K.
* Added **`refractionScale`**, which renders the refraction G-buffer at a fraction of the
  screen: 4.2 ms to 2.4 ms at 4K with no visible change.
* Packed the foam mask into the foam colour map's alpha to save a texture unit.
* Added **sound hooks**: `onImpact`, `getCameraWaterState`, `getSeaState` and `getSurfAt`.

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
