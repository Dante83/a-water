# UNDERWATER-VOLUME — world-space underwater light: fog, shadows, god rays

Status: PHASE 1 BUILT (2026-09-26), awaiting Dante's a-land regen + browser look.
Branches: `underwater-volume` in a-water (off `development` a801d1a) and a-faraway-land (off `main` e00915b).

Decisions (Dante, 2026-09-26): the volume REPLACES the four fog copies (the analytic murk stays
only as the fallback), and the sun halo is PHYSICAL (`gazeWeight` 1, a live knob).

## Progress

**Phase 1 (2026-09-26): built.**
- `passes/underwater-volume-pass.js`: inject + integrate, 160×90×64 froxels in an 8×8 slice
  atlas (1280×720 RGBA32F, ×2), quadratic slices out to `min(200 m, ln 100 / min σ)` (27 m in
  island-sholes water). Ticked from ocean-grid's submerged branch with the same sun, sky and
  Jerlov numbers as the murk; `stand()` on surfacing. Registered in make-combined.py and the ten
  example pages (all gitignored).
- Fog chunk (`underwater-fog-chunk.js`): `uwVolumeInscatter` declared in fog_pars_fragment; the
  ocean branch uses it when valid. Shared uniforms reach built-in materials through a chained
  `onBeforeCompile` with an extended cache key (`attachVolume`), self-healing in the per-frame
  traversal. ⚠ On pages WITHOUT a-starry-sky's atmospheric perspective the water surface
  includes the fog chunk too (`#if(!$atmospheric_perspective_enabled)`), so the ceiling gets it
  there. That was already true of the murk.
- a-land (`terrain.frag` `alandUwVolume`, `TerrainMaterial` `u_uwVol*`, `setOceanFog({volume})`):
  **needs Dante's a-land regen.** An a-land without it ignores `volume` and keeps the murk.
- Verified headless on island-sholes-ocean (4090): no shader or GL errors, the atlas fills
  (in-scatter rising toward equilibrium along the ray; zero under the bed), the look with the
  volume on matches the murk within tuning, **0.14 ms GPU** for both passes (timer query).
  a-land's compile gate links. Not yet seen: terrain with the volume (regen), a low sun, the halo.
- Debug: `oceanGrid.underwaterVolumePass.debugInscatterOnly = true` draws only the volume's
  light (short paths toward the surface read dark, long horizontal ones bright). Knobs on the
  same object: `width/height/depth`, `maxRangeM`, `slicePower`, `phaseG`, `gazeWeight`, `enabled`.
- Physical change to flag: the sun beam uses the refracted irradiance across the beam,
  `E·(1−F)·cos θair / cos θwater`, not the level-plane `E·(1−F)·cos θair` the murk used for its
  single scatter (the multi-scatter glow keeps the level-plane value). About 30% more single
  scatter at a 30° sun, the same at a high sun.

## Why

Today the underwater murk is one analytic Beer-Lambert fog, copied four times and kept in step
by comments:

| copy | where | fades to |
|---|---|---|
| water shader (ceiling, TIR mirror, body) | `water-shader.glsl` `applyUnderwaterFog` / `underwaterInscatterSurface` | camera-depth murk |
| every THREE material (objects, hulls, seabed, curtain) | `underwater-fog-chunk.js` (fog_* reservation slot) | same, smuggled through `THREE.Fog` |
| a-land terrain + objects | `terrain.frag` `u_uw*` block | `u_uwMurk` |
| the curtain hemisphere | backstop for empty directions | same |

All four fade to ONE colour: the medium's equilibrium at the CAMERA's depth, view-independent
(`UW_MURK_GAZE_WEIGHT = 0`, chosen so the seabed and the reflected ceiling fade alike). So the
water is lit the same everywhere: no shade under a hull or a cliff, no brighter water toward
the surface, no sun halo, no shafts. Every one of those needs to know the light at a POINT in
the water, and we own everything that decides it: the still level per point (WaterField), the
terrain (a-land), the refracted sun, and the caustic pattern.

## The idea: one froxel volume of in-scattered light, sampled by everyone

A camera-aligned grid (froxels: screen x × screen y × exponential depth) of the light the water
scatters toward the camera, computed once per submerged frame in world space. Every consumer
replaces its fog with the same two lines:

    T = exp(-extinction * pathInWater)           // analytic: the medium is homogeneous
    color = color * T + inscatterVolume(screenUV, viewDistance)

Transmittance stays ANALYTIC (per channel, exact, the existing `uwPath` logic for rays that cross
the surface). Only the in-scatter, which is what varies in space, lives in the volume. That keeps
the volume one RGBA16F texture.

### Pass 1: inject (per froxel, at its jittered world point P)

- **In water at all?** `d = stillLevelAt(P.xz) - P.y` from WaterField (lakes and creeks, not
  just the sea). `d <= 0` scatters nothing, so a ray that leaves the water (the waterline, an air
  pocket, Snell's window) stops collecting.
- **Sun reaching P:** refracted sun `L` (Snell at a flat surface, as now), surface crossing
  `S = P - L * d / (-L.y)`, attenuation `exp(-ext * d / (-L.y))`, × `(1 - Fresnel)`.
- **Shadow:** a refracted-sun depth map (Pass 0) tells whether anything (seabed ridge, rock
  arch, hull, cliff) lies between P and S.
- **Caustic / shafts:** the caustic pattern at S at the path's scale (a-land's
  `alandCausticPattern`, the same one the seabed gets: its cells widen and its contrast fades
  with depth, the current per point now included). Because it is sampled at S along `L`, every
  froxel on the same refracted sun ray gets the same value: that IS a god ray. Froxels near the
  camera are small (5 cm at 5 m for a 160-wide grid), so the shafts resolve where they matter.
- **Phase:** Henyey-Greenstein on the sun term. The volume makes the halo consistent (every
  consumer samples the same volume), so `UW_MURK_GAZE_WEIGHT` can become physical (see decisions).
- **Sky + multi-scatter:** the existing isotropic sky term and the R∞ multi-scatter glow, now
  evaluated at P's OWN depth (`exp(-ext * d)`), so looking up is brighter than looking down.
  Sky occlusion under overhangs is a later option (a-land's horizon map).

### Pass 2: integrate (front to back along each froxel column)

Slice k gets `Σ_{j≤k} scatter_j · T(camera→j) · Δs_j` (Wronski / Hillaire: energy-conserving
per-slice integral). No compute in WebGL2, so one draw per slice, each summing the slices before
it (O(n²) taps, about 19 M for 160×90×64; well under a millisecond on the 4090).

### Pass 0: the refracted-sun depth map

An orthographic depth render along `L` over the volume's footprint (about ±100 m, one or two
cascades), of terrain (through the existing foreign-terrain TWIN, as TerrainOrthoPass and the
G-buffer already do), placed objects, and hulls. The water surface and skirt do not cast (as
the old caustic projector's shadow). It is also the right shadow for the seabed caustics
underwater (today `alandCausticSunVisAt` uses the AIR sun's shadow), so a later step can hand it
to a-land.

Above-water occluders are projected along `L` rather than the air ray: exact at the surface and
off by `h * (tan θair − tan θwater)` for a cliff h metres up. Combining with the scene's sun
shadow at S fixes that later if it shows.

### Storage: 2D slice atlas, not sampler3D

A `sampler3D` forces GLSL3 on every material the fog chunk reaches; a-land's ObjectMaterial
made the same call for its light probes (ObjectMaterial.js:278). So the volume is a 2D atlas
(slices side by side), read with two bilinear taps and a lerp in depth. It also sidesteps the
three r173 layered-target trap (WebGLArrayRenderTarget silently drops its type options).

### Consumers after the change

- Fog chunk: `color * T + volume`. The `THREE.Fog` smuggle keeps the waterline + linear flag;
  the murk colour it carries becomes the fallback when no volume is bound.
- a-land `u_uw*` block: the same, through a new socket `setUnderwaterVolume({atlas, frame})`,
  versioned like `waterCaustics`, so an a-land without it keeps `u_uwMurk`.
- Water shader ceiling: volume at the ceiling fragment. The TIR mirror's post-bounce leg is not
  on a camera ray, so it keeps the analytic murk (the volume's value at the surface point as its
  equilibrium).
- Curtain / background: the volume's last slice in that direction.

## Phases

1. **Volume, no shadow, no shafts.** Inject + integrate + atlas + the fog-chunk consumer.
   Per-point depth and HG only. Acceptance: at a fixed camera it matches today's look within
   tuning, and looking up is brighter than looking down. Debug view: a volume slice.
2. **Shafts:** the caustic at S. Temporal jitter + reprojection of the previous volume to
   kill the stepping of shafts across slices (blue noise, ~0.9 history).
3. **Shadow:** Pass 0 + the shadow tap. Acceptance: the column under a hull and the lee of a
   cliff are dark, and shafts stop at the hull's edge.
4. **a-land consumer** (socket + regen), then the water shader's ceiling + curtain. After this
   the four copies of the fog are one.
5. **Later:** sky occlusion (horizon map), the refracted shadow for a-land's seabed caustics,
   the air-sun shadow at S for tall occluders, and viewing shafts from ABOVE the water (a
   different volume: along the refraction ray, not the camera ray).

## Knobs (live JS fields, per convention)

`resolution` (160×90×64), `rangeM` (auto: `-ln(0.01) / min(extinction)`, capped at 200 m),
`sliceDistribution` (exponential k), `historyWeight` (0.9), `shaftStrength` (1 = physical),
`gazeWeight` (see decisions), `shadowCascadeHalfWidthsM` ([32, 128]).

## Risks

- **Sampler units.** +1 in every fogged material (the atlas), +1 in a-land terrain (20 → 21 of
  32). The water shader is the tight one: check the budget before phase 4.
- **The mirror pass** renders from the mirrored camera. Its fragments must NOT sample the
  real camera's volume (wrong froxels). Gate on the linear-RT flag it already carries.
- **Compile churn.** The chunk change recompiles every fogged material once. It must not happen
  per crossing: the "clipping-define churn" lesson from the first-dip stall.
