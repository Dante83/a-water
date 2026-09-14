# Nearshore waves: Phase 3.0 findings

The research run from [`WATER-TYPES.md`](./WATER-TYPES.md) § Phase 3.0. It asks whether
the "other half" of a real coast needs a volume-conserving nearshore model before
Phase 3's breakers get built, and which model we could afford. The other half is water
that runs up, drains back, piles into coves, and bounces off rock with some energy loss.

2026-09-12, branch `phase-3.0-nearshore`. Every number below was measured with the
scratch harness in [`research/nearshore-spike/`](./research/nearshore-spike/). The
commands are in § 4.

> **The answer in one paragraph.** Shipped games do not simulate surf. They sweep an
> authored or baked breaker profile along the coast. Horizon Forbidden West does this,
> and so does Fluid Flux's coastline. The ones that also run a shallow-water sim use it
> for flow, streams and interaction, not for breaking. Our spikes show why. At 1 m
> cells, a volume-conserving SWE reflects **Kr ≈ 0.48** off a 1:20 beach, where Battjes
> predicts **0.017**. It over-runs that beach about 3×, and under-runs a 30° shore by
> about 45%. SWE is also only valid shoreward of about 3 m of water, and on
> simple-islands that band is about 5 m wide. The half that parametric breakers really
> cannot do is **reflection**. A linear wave equation that carries **only the reflected
> wave**, emitted at the shore as `Kr(ξ) × incident`, reproduces the analytic reflection
> to **0.8% RMS**. It costs **0.24 ms per step** for a 512² window on an integrated GPU.
> Its Kr comes straight from the ξ map that `surveyShore()` already computes. **The
> recommendation (§ 8)** is to amend Phase 3:
> - **3a** stays parametric (breakers and swash), with the breaker class, the swash
>   height and the foam energy all read from ξ.
> - **3b** is new: a shore-reflection layer, which is Phase 8's dynamic-waves service
>   pulled forward.
> - **3c** is a volume-conserving swash SWE. It is deferred, and gated on whether 3a's
>   swash sheet reads fake.

---

## 1. The question, with this world's numbers

`surveyShore()` on simple-islands (`WATER-TYPES-PROGRESS.md` § Phase 1c) found the
seabed at a median slope of 0.24–0.42 within 5 m of shore, and 0.56–0.65 (~30°) from
5 to 40 m out. The sea state formulas are the ones the spectrum uses
(`ocean-debug-controls.js:593-604`).

Put those through the surf-similarity number ξ₀ = tanβ / √(H₀/L₀) and Battjes' reflection
coefficient (§ 3). The result is that **this world reflects a lot**:

| sea | Hs | L₀ | breaker depth Hs/0.78 | slope where it breaks | ξ₀ | Kr ≈ 0.1ξ² (ξ<2.5) |
| --- | --- | --- | --- | --- | --- | --- |
| 12 m/s (reference) | 4.4 m | 68 m | 5.6 m (≈10 m out) | 0.56–0.65 | 2.2–2.55 | **0.48–0.65** |
| 3 m/s (live) | 0.28 m | 7.8 m | 0.36 m (<1 m out) | 0.24–0.42 | 1.3–2.2 | **0.16–0.49** |

Kr is a ratio of wave **heights**, so the reflected energy is Kr². At the reference sea,
half the incident height and about 30% of the energy comes back off the island. That
means a visible cross-hatch of outgoing crests near the shore. Physical-before-stylistic
(`WATER-TYPES.md` § Cross-cutting rules) says it should be there. Phase 3 as written
has no mechanism for it.

## 2. What shipped games do

| title / system | breaking | swash / run-up | reflection | method | cost published |
| --- | --- | --- | --- | --- | --- |
| **Horizon Forbidden West** (Guerrilla; SIGGRAPH 2022 Advances, Malan) | yes, the headline feature | follows the breaker animation | no | **One** hand-animated breaking-wave cross-section, baked to a deformation texture. It is swept along wavefronts laid out with artist "shape / guide / animation curves"; "the tools were efficient enough to allow a single artist to lay out all the wave animations in the game". | no; triangle density was the stated limit |
| **HFW follow-up** (SIGGRAPH 2024 talk, *Topology-Changing Rolling Waves*) | yes, overhangs | n/a | no | wave profiles + time curves on their wave-particle tech (abstract only; paywalled) | not seen |
| **Fluid Flux 2** (UE5 plugin) | yes | from its SWE | no | A shallow-water solver credited to Müller's "Real-time Simulation of Large Bodies of Water with Small Scale Details" (Chentanez & Müller 2010). Its own page says "the simulation domain does not support the wave break effect because the fluid approximation lacks the necessary data to render it". The coastline instead "uses a **signed distance field** to represent the water-ground edge intersection and renders animated wave profiles", "blended with the pre-baked simulated state" (80.lv, FF 2.0). | no |
| **Crest 5 Shallow Water** (paid add-on) | no (docs) | yes, "shoreline" preset | emergent | camera-following SW sim "combined with normal waves"; "cannot be baked"; "results will greatly depend on the profile of the terrain" | no; solver undocumented |
| **Crest 4** (open source, `../crest`) | no | no | **yes, for interaction ripples only** | `UpdateDynWaves.compute`: a 2D wave equation per LOD with a deep-water speed from the LOD's texel size, Courant-clamped, zeroed on dry texels, plus a linear `_attenuationInShallows` | no |
| **Sea of Thieves** (Rare; SIGGRAPH 2018) | not described | not described | not described | FFT ocean. A "GPU water surface simulation based on [Mei et al. 2007]" (virtual pipes) handles water on ship decks, waterfalls and streams. | no |
| **Uncharted 3 / 4** (Naughty Dog) | no | no | no | wave particles (Yuksel 2007) for local ocean detail (U3) and rapids (U4) | no |
| **UE5 Water plugin** | no | no | no | Gerstner waves per water body; spline shoreline, foam, depth colour | n/a |
| *Wave cages* (Jeschke et al. 2020, NVIDIA/IST; research, not shipped) | via particles | kinematic | no; boundary-safe warp only | Warps procedural waves (on Water Surface Wavelets) so they never cross terrain. It adds **3.6 ms / 6.1 ms** to the water pass at 720p / 1080p on an RTX 2080 Max-Q. Precompute is 2 s at 1024² and assumes static terrain. | yes |
| *Celeris-WebGPU* (coastal engineering, MIT) | yes, breaking model | yes | yes | Boussinesq / NLSW in the browser, **WebGPU only** | "faster than real time" on desktop, no numbers |

**Reading it.** Nobody we could verify ships physically derived swell reflection off a
coastline. Breakers are always parametric. Where a shallow-water sim exists, it drives
flow and local interaction. Crest 4's reflecting dynamic-waves sim is the closest thing
to family 5, and it is used for boat and object ripples. So "the latest games simulate
it" is **not** true for surf. It is partly true for swash (Crest 5, Fluid Flux), and not
true for reflection. Two claims are unverified from the sources we reached: AC4 Black
Flag's shore handling, and anything Sea of Thieves does at islands.

## 3. The coastal-engineering anchors

- **Surf similarity** ξ₀ = tanβ / √(H₀/L₀), with L₀ = gT²/2π. Breaker classes use Battjes
  1974's ξ₀ thresholds: spilling < 0.5 < plunging < 3.3 < surging/collapsing.
  `surveyShore()` uses exactly these (`ocean-debug-controls.js:610-611`). The
  breaker-point form ξ_b uses 0.4 / 2.0 instead.
- **Reflection (Battjes 1974)**: **Kr ≈ 0.1 ξ² for ξ < 2.5**. That is quoted from Coastal
  Wiki's *Surf similarity parameter*, citing Battjes 1974 and CIRIA/CUR/CETMEF 2007. The
  "capped at 1" in `WATER-TYPES.md` is ours, not the source's. Above ξ ≈ 2.5 the formula
  is outside its range. Rough and permeable faces (rubble, rock) reflect less than the
  smooth slopes it was fitted on. Seelig & Ahrens 1981 (CERC TP 81-1) and Zanuttigh &
  van der Meer 2008 give rough-slope fits, but neither full text was reachable (DTIC and
  journals returned 403). **Check them before choosing a Kr cap per material.**
- **Run-up** (Coastal Wiki, *Wave run-up*):
  - **Hunt 1959**: R ≈ η + Hξ, with setup η ≈ 0.2H.
  - **Stockdon et al. 2006**, 2% exceedance, for ξ ≥ 0.3: R₂ = 1.1(η + ½√(S_inc² + S_ig²)), with η = 0.35Hξ, S_inc = 0.75Hξ and S_ig = 0.06√(HL).
  - Stockdon, dissipative (ξ < 0.3): R₂ = 0.043√(HL).
  - Stockdon, reflective (ξ > 1.25): **R₂ ≈ 0.73 β √(HL)**.
- **Depth-limited breaking**: McCowan H_b ≈ 0.78 d, as Phase 3 already has.
- **Where shallow-water equations are valid.** SWE's √(gh) against linear dispersion, at
  the two reference sea states:

  | depth | 12 m/s (T 6.6 s): kh / SWE speed error | 3 m/s (T 2.24 s): kh / error |
  | --- | --- | --- |
  | 0.5 m | 0.22 / +0.8% | 0.68 / +7.2% |
  | 1 m | 0.31 / +1.6% | 1.03 / +15.5% |
  | 3 m | 0.55 / **+4.9%** | 2.44 / +58% |
  | 5 m | 0.74 / +8.4% | 4.0 / +100% |
  | 10 m | 1.14 / +18% | 8.0 / +183% |

  A 5% phase error means handing off at h ≈ 0.045·L₀. That is **≈3 m at 12 m/s** (5 m
  horizontally on a 30° shore) and **≈0.35 m at 3 m/s**. SWE is a model of the last few
  metres of this world's coast, not of its approaches.

## 4. The spike harness

`research/nearshore-spike/sim.html` is raw WebGL2 with no three.js, one file, and every
solver as a fullscreen-triangle GLSL pass on RGBA32F targets. `run.mjs` drives headless
Chrome over CDP, so async tests work. Driving it that way is the trick from Phase 2's
memory notes.

```bash
cd research/nearshore-spike
node run.mjs nvidia  "test=kr&mode=face&slope=0.05&H=1"          # RTX 4090, ANGLE GL
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json \
node run.mjs igpuvk  "test=costGPU&mode=wave&n=512"               # Ryzen 7800X3D iGPU, ANGLE Vulkan/RADV
```

- **Solvers** (`mode=`):
  - `pipe`: Mei et al. 2007 virtual pipes, A = dx².
  - `pipeD`: two depth-weighted one-way pipes per face.
  - `face`: one signed flux per face, a staggered SWE with hydrostatic face depth, a positivity limiter and optional Manning friction.
  - `wave`: a 2D wave equation with c² = gh, Neumann at dry texels, a velocity-damping sponge, and an optional depth-gated absorber.
- **Reflection test** (`test=kr`): a right-going linear wave packet (4 periods, T = 6.6 s,
  10 m of flat water) passes a gauge, climbs a plane slope and comes back. Kr = √(E_ref /
  E_inc) at the gauge, where incident and reflected are separated in time. A 150 m sponge
  absorbs the return. `flat=1` replaces the slope with a second sponge, which measures
  the sponge's own reflection. Other parameters: `slope`, `H`, `T`, `h0`, `dt`,
  `manning`, `absorbDepth`, `absorbRate`, `ramp=1` (graded), `dump=1` (gauge series).
- **Other tests**:
  - `test=scatter`: the reflection-only emitter (§ 5.4).
  - `test=volume`: a closed basin around a 30° island with a cove.
  - `test=costGPU`: `EXT_disjoint_timer_query_webgl2`, cross-checked by wall clock with a readPixels fence.
  - `test=readback`
  - `test=precision`
- **Hardware**:
  - Chrome 148.0.7778.215.
  - RTX 4090 through ANGLE GL (NVIDIA 535.309.01).
  - Ryzen 7 7800X3D integrated Radeon through ANGLE Vulkan/RADV (Vulkan 1.4.318). The Radeon is the budget reference.

## 5. Spike results

### 5.1 Virtual pipes as published are the wrong primitive for waves

- **Classic Mei 2007 (A = dx²) is depth-blind.** Linearise it: flux obeys f_t = g·dx·Δη and
  volume obeys η_t = −Δf/dx², which gives **η_tt = g·dx·∇²η**. The wave speed is √(g·dx),
  about 3.1 m/s at 1 m cells, whatever the water depth. The spike agrees. In 10 m of
  water (true c = 9.9 m/s), the packet had not reached a gauge 280 m away when a √(gh)
  wave would have passed it at 28 s. Its crests arrived from about 50 s onward. **No
  shoaling and no refraction are possible.** That is fine for erosion tools, and it is
  why Sea of Thieves could use it for water on a deck.
- **Depth-weighted two-pipe variant: loses energy.** Each face carries two one-way
  fluxes, each clamped at `max(0, …)`. When a wave reverses the flow, the clamp throws
  away the "negative" half of the increment. At the gauge the packet arrived at **0.11
  m** amplitude instead of 0.5, a 78% loss over 280 m.
- **Signed flux per face works.**
  - Arrival centroid **28.37 s vs 28.34 s** expected (h = 10 m) and **46.78 vs 47.06 s** (h = 2 m).
  - Amplitude kept (0.481).
  - The sponge reflects **Kr 0.015** at 10 m and 0.0006 at 50 m.

  This is what "pipe SWE" has to mean if we ever build one. It is 3 draws per step as
  written; an MRT merge would make it 2.

### 5.2 Nothing reflects like Battjes on its own

Plane slope, no absorber (face SWE, then linear wave equation):

| slope | H | ξ₀ | **Battjes Kr** | face SWE Kr | face SWE + Manning 0.025 | wave eq Kr |
| --- | --- | --- | --- | --- | --- | --- |
| 30° (0.577) | 1 m | 4.76 | 1 (out of range) | 0.93 | — | 1.00 |
| 30° | 3 m | 2.75 | 0.76 (edge of range) | **0.55** | 0.53 | — |
| 1:20 (0.05) | 1 m | 0.41 | **0.017** | **0.48** | — | 1.00 |
| 1:20 | 3 m | 0.24 | **0.006** | **0.51** | 0.44 | — |

Linear theory reflects totally from any slope: a wave that never breaks gives all its
energy back. Battjes' low Kr on gentle beaches **is breaking loss**. The staggered SWE has
no advection and no shock capturing, so it dissipates only a little, at its limiter and
through friction. On gentle beaches it reflects about 30× too much. On steep ones it
lands near Battjes, a little low.

**Run-up** (face SWE, 1 m cells):

| slope | H | SWE run-up | Stockdon R₂ | Hunt |
| --- | --- | --- | --- | --- |
| 30° | 1 m | 1.86 m | 3.5 m (reflective form) | 5.0 m |
| 30° | 3 m | 3.61 m | 6.0 m (reflective form) | 8.8 m |
| 1:20 | 1 m | 1.38 m | 0.48 m | 0.61 m |
| 1:20 | 3 m | 3.25 m | 0.61 m (dissipative form) | 1.31 m |

On a 30° slope one 1 m cell is 0.58 m of rise, and the swash tongue is a handful of cells.
SWE under-runs by about 45%. On the gentle beach nothing breaks, so the swash overshoots
by about 3×.

### 5.3 Absorbers can set Kr, but only if they are graded

The absorber is velocity damping wherever the still-water depth is below `absorbDepth`.

- **Uniform band, at the breaker depth.** Kr is non-monotonic in strength, because the
  band's edge is an impedance step that reflects on its own:
  - face SWE on 1:20, rates 0.05 → 0.2 → 0.5 → 1 → 3: Kr **0.32 → 0.16 → 0.15 → 0.19 → 0.28**
  - wave equation on 1:20, same rates: **0.52 → 0.09 → 0.13 → 0.24 → 0.45**
- **Graded band**, damping ∝ (1 − h/h_band)², like the sponge:

  | solver, slope | band to depth | rate | Kr | Battjes | run-up |
  | --- | --- | --- | --- | --- | --- |
  | wave eq, 1:20 | 2.5 m | 2 | **0.013** | 0.017 | (none modelled) |
  | wave eq, 1:20 | 5 m | 2 | 0.011 | 0.017 | — |
  | face SWE, 1:20 | 1.28 m (breaker depth) | 1–8 | 0.19–0.20 (floor) | 0.017 | 0.41 → 0 m |
  | face SWE, 1:20 | 5 m | 2 | 0.041 | 0.017 | 0 (killed) |
  | face SWE, 30°, H 3 | 3.85 m | 1 / 4 | 0.42 / 0.32 | 0.76 | 3.1 / 1.8 m |

  A graded band about 0.8 wavelengths wide lets the **linear wave equation hit Battjes**.
  The SWE can reach a low Kr only by killing the swash it was built to provide. Its best
  compromise was a breaker-depth band at rate 1: Kr 0.19 and run-up 0.41 m (Stockdon
  0.48 m). On a steep shore the surf zone is a small fraction of a wavelength, so no
  absorber is needed, and any absorber pushes Kr below Battjes.

### 5.4 The reflection-only emitter works

This test never simulates the incident wave. That is the FFT ocean's job. A shore column
is driven as a Dirichlet source, **η_sc = Kr · η_inc(shore, t)**, and the sim carries
only the outgoing reflection. The result is compared against the analytic mirror image
Kr · η_inc(2x_w − x, t) at a gauge 200 m offshore:

| Kr | T | cells per wavelength | relative RMS error | measured Kr |
| --- | --- | --- | --- | --- |
| 0.5 | 6.6 s | 65 | **0.82%** | 0.500 |
| 1.0 | 6.6 s | 65 | 0.82% | 1.000 |
| 0.3 | 3.0 s | 30 | 8.8% | 0.301 |

The amplitude is exact. The error is the 5-point Laplacian's numerical dispersion, so the
layer needs **≥ ~30 cells per local wavelength**. That makes cell size a function of the
sea state, not a constant (§ 8, 3b). The emitter carries no incident energy, so there is
nothing to double-count. The FFT incident is rendered exactly as it is today.

### 5.5 Volume, stability

- **Volume** (face SWE, 256² closed basin around a 30° island, 2 m mound, Manning 0.025,
  120 s): relative drift **−2.5 × 10⁻⁸** at dt 0.02 and −7 × 10⁻⁸ at dt 0.05. No
  negative or non-finite depths. Identical on the Radeon (−3.2 × 10⁻⁸).
- **Stable timestep** (1D channel; the 2D limit is √2 tighter):
  - face SWE: stable at Courant 0.69, blows up at 0.99 (h 10 m); stable at 0.74, blows up at 1.1 (h 50 m).
  - wave equation: stable at Courant 0.99 (h 10 m), blows up at 1.1 (h 50 m).
  - At **dt = 1/60 s and 1 m cells**, one step per frame holds to h ≈ 90 m in 2D. At 0.5 m cells it holds to ≈ 22 m. **CFL is not the constraint.**

### 5.6 Cost

GPU ms per step from the timer query. Wall clock agrees within 10% from 1024² up; below
that, a fixed per-batch overhead dominates the 4090's wall time. Every size in the table
evolves real state. The 4090 scales linearly from 1024² up (×3.2 to 2048², ×4.2 to
4096²), so its small-window numbers are a fixed-overhead floor.

| window | face SWE (3 draws), 4090 | face SWE, **Radeon iGPU** | wave eq (1 draw), 4090 | wave eq, **Radeon iGPU** |
| --- | --- | --- | --- | --- |
| 256² | 0.013 | **0.20** | ~0.007 (wall) | **0.070** |
| 512² | ~0.025 (wall) | **0.72** | ~0.010 (wall) | **0.24** |
| 1024² | 0.039 | **2.28** | 0.013 | **0.82** |
| 4096² | 0.53 | — | 0.35 | — |

At one step per frame, the integrated GPU affords a **512² reflection layer for about
0.24 ms**, or a 256² swash SWE for 0.2 ms. The 4090 numbers are there only to show
headroom.

### 5.7 Readback, and the PBO collision explained

- **Cost is negligible.** A PBO read of 64²–256² RGBA float takes ≤ 0.1 ms to issue and
  ≤ 0.1 ms to copy. It is ready by the first poll, which is the browser's 4 ms timer
  floor, so less than a frame. A synchronous read is 0.1–0.5 ms plus a GPU stall.
- **The "known collision" is a three r173 bug, reproduced.**
  `WebGLRenderer.readRenderTargetPixelsAsync` (super-three 0.173.5, which A-Frame 1.7
  pins) binds `PIXEL_PACK_BUFFER`, calls `readPixels`, then **awaits `probeAsync` with
  the buffer still bound**. It unbinds only by deleting the buffer after the copy. Any
  *synchronous* `readPixels` issued inside that window fails with `INVALID_OPERATION`
  ("PIXEL_PACK_BUFFER must be null"). The harness reproduces it on both GPUs. Two async
  reads do **not** collide, because each binds its own buffer.
- **Our synchronous readers**:
  - The field probe and `readCascade` (`water-field-pass.js:673,704`). The probe already unbinds first.
  - `sampleFFTHeightAt` (`height-readback-pass.js:194`, debug).
  - Our own async-less fallback at `:393`.
- **a-land's synchronous readers** are `NoiseGenGPU.js:407`, `TerrainSunCSM.js:2247` and
  `SkyEnvironment`. These are the likely sources of the ×24 per session warnings, but
  that is not verified in a live session.
- **The fix belongs in one place**: an `ARestlessOcean` async-read wrapper that unbinds
  `PIXEL_PACK_BUFFER` immediately after `readPixels`. It is three lines and independent
  of Phase 3.

### 5.8 A platform hazard found on the way

On **ANGLE GL-EGL over Mesa radeonsi** (the same Radeon, LLVM 20.1.2), an RGBA32F
texture **sampled in a shader has half-float precision**, while `readPixels` returns the
full value:
- 1234.5678 samples as 1234.0.
- 10.000123 samples as 10.0.
- A thousand +0.001 render-to-texture steps stay at 10.0.

Every SWE result on that backend was garbage, with an incident "peak" of 5.3 m from a
0.5 m wave. The **same GPU through ANGLE Vulkan/RADV is exact** and reproduces the 4090's
Kr to four digits. Any float-state sim should run a startup self-test (this harness's
`test=precision` is 20 lines) and disable itself on failure. It is **not checked**
whether Chrome's default Linux backend uses that path for real users, or whether
WaterField's float level (−150 m) is affected. Worth a look.

### 5.9 Phase 3b's first task: oblique incidence, and a better shore (2026-09-13)

Run at the start of Phase 3b (`test=oblique` and `test=slope` in `sim.html`). A 1024² 2D
wave equation at 30 cells per wavelength (T 6.6 s, h 10 m, dx 1.84 m, dt 1/60 s) holds
a straight shore at 0°, 20° or 45° to the grid. An infinite plane-wave packet arrives
at 0°, 30° or 60° from the shore normal. Only the scattered field is simulated. The
score is taken on a 33² gauge patch 200 m offshore, against the analytic mirror image,
with a quadrature fit of amplitude, phase and direction.

**1. The mirror law emerges.** § 8's Dirichlet emitter (shore cells forced to
`Kr · η_inc`) reflects at the mirror angle with a direction error of 0.3° or less, and
Kr within 2%, for every shore and incidence angle tested.
- If the cell is forced to the incident at its **mirror image** across the true
  shoreline, the phase error is 3° or less.
- If it is forced to the incident at the **cell centre** (§ 8 as written), the wave lags
  by 9–16°. That is a wall about half a cell out, which would not be visible.

**2. But a Dirichlet emitter is the wrong shore.** It forces the cell regardless of
what arrives, so a *simulated* wave hitting it (the reflection off another shore)
comes back **inverted at full strength** (measured phase 175°, |R| = 1.0). Across a
cove or strait, the reflected field would bounce between shores indefinitely.

**3. A Robin (impedance) shore fixes it.** Every dry neighbour of a wet cell is a ghost
cell. Its value makes the face reflect with that shore's Kr:

    ghost = η_p − α·dx·v_p / c + source,     α = (1 − Kr) / (1 + Kr)

- Kr = 1 is a rigid wall (Neumann), and Kr = 0 is a first-order absorbing boundary.
- **Arriving simulated waves** reflect as impedance theory predicts,
  R(θ) = (cosθ − α) / (cosθ + α): 0.50 at normal incidence and 0.45 at 30°, for Kr 0.5.
- **The staircase needs one correction.** A shore at angle φ to the grid has
  |nx| + |ny| cell faces per unit length, so α is spread over them
  (× 1 / (|nx| + |ny|)). Uncorrected, a 20° shore reflected 0.33 instead of 0.5.
  Corrected, every shore angle gives 0.49–0.50.

**4. The source must be the shoreward characteristic only.** The obvious source makes the
**total** field (incident + scattered) obey the impedance condition,
`inc_p − inc_q − α·dx·inc_t / c`. With α × cosθ_inc it reflects the incident at exactly
Kr at every angle.
- **It also cancels any incident travelling away from the shore.** Measured: 65–100% of
  such a wave re-emitted. The FFT holds exactly such components: the directional spread
  seen from any shore not facing the wind.
- **The fix drives the face with the incoming characteristic alone:**

      source = G · (1 − α)/2 · (faceScale · dx · inc_t / c + (c₀ / c) · (inc_p − inc_q))
      G = 2 cosθ / (1 + cosθ),  and the ghost's impedance uses α · cosθ · faceScale

  - c₀ is the incident's own speed and c the local simulated speed.
  - θ is the incident direction against the shore normal.
  - `inc_t` is a one-step backward difference, which is what a frame difference gives.
- **Result:** Kr **0.498–0.503**, with phase error of 3° or less, at every shore angle
  (0°, 20°) × incidence (0°, 30°, 60°). An offshore-going incident leaks only **2–6%**.

**5. Sloping bed, variable speed (`test=slope`).**
- **Setup.**
  - The bed runs from deep flat h₀ = 20 m up a plane slope. The simulated water stops
    at the **resolution contour h_min = L₀ / 18π**, where the local wavelength falls to
    about 10 cells: 1.2 m at T = 6.6 s.
  - The Robin shore sits there, driven by the **deep-water** incident at c₀. That is
    what the FFT renders, whatever the bathymetry.
  - The medium is c(h; T) from linear dispersion, in the **constant-amplitude form**
    η_tt = c ∇·(c ∇η). Its WKB amplitude is exactly constant, so the reflection leaves
    at Kr × the deep incident. That is Battjes' definition.
  - The divergence form would shoal it by c^−½ (Green's law). The plain c²∇²η form
    would amplify it by c^½.
- **Measured** by the energy ratio at a deep gauge (independent of delay):

| slope | Kr set | θ, shore angle | measured Kr | direction error |
| --- | --- | --- | --- | --- |
| 1:10 | 0.5 | 0°, 0° | 0.494 | 0° |
| 1:10 | 1.0 | 0°, 0° | 0.979 | 0° |
| 1:10 | 0.5 | 40°, 20° | 0.464 | 0° |
| 30° | 0.5 | 0°, 0° | 0.495 | 0° |
| 1:20 | 0.1 | 0°, 0° | 0.099 | 0° |

  The 40° case reads 7% low. Refraction turns the wave toward the normal before it
  reaches h_min, so the deep-water cosθ over-corrects.

**What this changes in § 8 (3b):**
- The emitter becomes a **Robin shore with a characteristic source**.
- The "graded absorber on dissipative shores" is not needed: a Kr ≈ 0 shore *is* the
  absorber, and it absorbs the reflections of other shores too.
- The shore sits on the h_min contour, not at shoreSDF = 0. There the masked FFT
  height has gone to zero, and the local wavelength is under-resolved.
- The incident is the **unmasked** cascade height, low-passed to the grid, and weighed
  only by the fetch part of WaveMask.

## 6. The families, compared

| | 1. Parametric only | 2. Boussinesq window | 3. Pipe / staggered SWE window | 4. Wavelets / wave cages | 5. Wave eq (iWave-class) |
| --- | --- | --- | --- | --- | --- |
| Breaking | **authored, the industry answer** | yes, with a breaking model | no (Fluid Flux says so; § 5.2) | via particles | no |
| Run-up / backwash | parametric (Stockdon from ξ) | yes | yes, but −45% steep / +3× gentle at 1 m (§ 5.2) | kinematic | no |
| Reflection | none | yes | emergent, wrong on gentle beaches without a closure (§ 5.2) | no (warp only) | **yes; Kr set per texel (§ 5.3, 5.4)** |
| Volume conservation | n/a | yes | **yes, 10⁻⁸** (§ 5.5) | n/a | n/a |
| Validity near shore | anywhere | kh ≲ 1–3 | **h ≲ 3 m** at 12 m/s (§ 3) | anywhere | any, if the emitted speed uses the dispersion relation at Tp (§ 8) |
| Hand-off from FFT | none needed | relaxation zone | forcing contour at ~3 m depth | replaces FFT | **none: emits reflected only** |
| CPU parity | analytic | readback | readback | analytic-ish | add to the existing 256² height readback composite (§ 7) |
| Cost (iGPU, 1 m) | ~0 | implicit/tridiagonal passes; the browser precedent (Celeris) is WebGPU | 0.20 ms @256², 0.72 @512² | +3.6 ms render (RTX 2080 MQ) + precompute | **0.07 @256², 0.24 @512²** |
| Sampler budget (28/32) | 0 | +1 | +1 | +1 or more | +1 |
| Terrain edits | free | re-init window | free | cage precompute is static | free (ξ map rebuilds with the field) |
| Reuse | — | none | **the future live-river solver** (add advection) | replaces our FFT | **Phase 8 dynamic waves** (boat, rain, avatar ripples) |

Two families are out. **Boussinesq** is out because its only browser precedent needs
WebGPU (deferred by decision 3), and its dispersion is only needed seaward of where FFT
already does the job. **Wavelets / wave cages** are out because they replace the FFT
ocean rather than complementing it, and their precompute assumes static terrain.
a-land edits.

## 7. Answers to the Phase 3.0 questions

**What do shipped games actually do?** They fake breaking with a swept profile (§ 2).
Swash comes from a sim in two commercial water systems. No reflection of swell at all.
"Many may fake it convincingly, which is itself the answer" holds for breaking. It does
not hold for reflection, which nobody fakes because nobody does it.

**How does the hand-off avoid double-counting?** For reflection, the problem disappears:
the layer never contains incident energy (§ 5.4). The FFT incident is attenuated exactly
as today (TMA masks, the dry discard), and the layer adds Kr × that same rendered height
back out. Energy then splits in one place: the reflected height fraction is Kr and the
dissipated energy fraction is 1 − Kr². So **3a's breaker foam and spray should scale
with 1 − Kr²**, and one ξ field drives both halves. If a swash SWE is built (3c), it is
forced along the h ≈ 0.045·L₀ contour, with the FFT faded to zero across that band. It
must not extend seaward of that contour (§ 3).

**Is the reflection coefficient a per-texel boundary condition from ξ?** Yes. The formula
is verified from a secondary source (§ 3), and the mechanism is verified in the spike.
Kr is the emitter gain at shore texels (§ 5.4). On gentle, dissipative shores, a graded
absorber in the surf zone catches the scattered energy that should not linger (§ 5.3).
`surveyShore()` already computes the per-texel mean slope `depth / shoreSDF` and ξ
(`ocean-debug-controls.js:620-635`). Moving that into a GPU pass is small. Cliffs and
beaches do fall out of one field. Two caveats. Above ξ ≈ 2.5 the formula is out of
range, so the cap becomes a per-material knob (smooth rock vs rubble), and it is flagged
as a fudge until the rough-slope fits are checked. Hs and L₀ are global (one sea state),
so ξ is a function of slope alone for any given frame.

**CPU parity: is a readback window acceptable?** Yes, and no new readback is needed. The
height readback pass (`height-readback-pass.js`) already composites the rendered surface
into a **256² RGBA float** RT over 512 m at 15 Hz. Its shader writes only `.r`
(`gl_FragColor = vec4(level + dy * hfWhm, 0, 0, 1)`). The reflection layer is sampled
into that `.r` sum, so buoyancy and splash ride the reflected crests with no extra
transfer. The free `.g` and `.b` channels can carry `shoreSDF` and Kr. That is the first
CPU mirror of `shoreSDF`, which Phase 1c left for "the first CPU consumer" to decide.
Outside 512 m, reflection is invisible to the CPU, and nothing out there floats close
enough to a shore to matter. The PBO collision is a three bug with a three-line
workaround (§ 5.7). Async reads never collide with each other.

**Foam and splash coupling?** Yes, with a smaller change than "replace the Jacobian
drive":
- **Foam:** add a shore injection term to the broadband foam RT. Breakers (3a) inject
  ∝ (1 − Kr²) × breaker phase. Reflective faces inject ∝ Kr × |∂η_sc/∂t| at the
  emitter, which is the collapsing splash-back line. Deep-water Jacobian foam is
  unchanged.
- **Splash:** `_emitShore` (`ocean-splash.js:819`) already gates on the rendered FFT rise
  and classifies beach vs cliff with a finite-difference terrain scan. Replace the scan
  with the readback's `shoreSDF` / Kr. The surging class (ξ > 3.3) is the cliff branch,
  and `impactSpeed` scales by Kr.
- **Volume convergence (−div q):** meaningful only if 3c exists.

**What does it cost?** § 5.6 measured it. The reflection layer is **0.24 ms per step at
512² on an integrated GPU**, 1 draw, one RGBA32F ping-pong pair, and one sampler unit
(28 → 29 of 32). A swash SWE would add 0.20 ms for 256² at 1 m, over 3 draws.

## 8. Recommendation: amend Phase 3, split into 3a / 3b / 3c

Physical before stylistic, but with the physics each piece can actually carry at 1 m.

### 3a — Shorelines that break *(Phase 3 as written, with ξ wired through)*
Keep everything in Phase 3 and change what drives it:
- **Breaker class from ξ₀ per texel.** Spilling, plunging and surging choose the profile
  and its trigger. Surging shores get no curling profile, only the collapse and the
  reflection. McCowan H > 0.78 d stays the trigger. This follows HFW's approach of one
  cross-section animation, but parameterised by class rather than authored per beach.
- **Swash sheet height from Stockdon** (§ 3): the dissipative, intermediate and
  reflective forms by ξ, driven on breaker phase. At our cell size this is more correct
  than the SWE spike's run-up (§ 5.2).
- **Breaker foam and spray scale with 1 − Kr².**
- The rest is unchanged: shoaling and refraction, shallow colour from true water-column
  depth, retiring `shoreFade`, and the `_emitShore` breaker trigger (reading the
  readback's `shoreSDF` / Kr per § 7).

### 3b — Shore reflection *(new; Phase 8's dynamic-waves sim, pulled forward as a service)*

> **Amended 2026-09-13 by § 5.9.** The emitter is a Robin shore driven by the incident's
> shoreward characteristic, on the h_min contour, with no separate absorber. Built as
> `shore-reflection-pass.js`; see `WATER-TYPES-PROGRESS.md` § Phase 3b.

- **The solver.** A camera-following, world-snapped 2D wave equation, like the
  foam-ortho snap. It holds **only scattered height**, 512² RGBA32F ping-pong.
- **The emitter.** Shore texels, the wet cells within one cell of `shoreSDF` = 0, are
  forced to `Kr(ξ) × η_FFT`. η_FFT is the masked, rendered cascade height; reuse the
  height-readback composite GLSL.
- **Absorbers.** A graded absorber sits where h < ~0.8 local wavelengths on dissipative
  shores. A sponge runs along the window rim.
- **Wave speed.** Offshore, √(gh) is up to 2× too fast (§ 3). Use the **linear-dispersion
  phase speed at Tp per texel** (tabulate c(h; Tp) once per sea-state change). This is
  Crest 4's deep-water-speed trick, keyed on the sea state rather than on texel size.
- **Cell size.** dx ≈ L_local/30 (§ 5.4). The window scales with the sea (≈1–2 m cells
  at 12 m/s, ≈0.25 m at 3 m/s) and the cost stays fixed.
- **Output.** Added to vertical displacement in `water-vertex.glsl`, the CSM caster and
  the height readback (parity, § 7). Normals get a finite-difference term in the vertex
  stage, because varyings are 16/16, so nothing new is passed down.
- **Sim LOD declared at construction.** Off when Hs < ~0.1 m, and off when the window's
  minimum `shoreSDF` exceeds its half-width.
- **First task.** Verify oblique incidence in 2D. The mirror law should emerge from the
  along-shore phase of the emitter (Huygens), but only normal incidence was spiked.
- **Reuse.** Phase 8's boat, rain and avatar ripples inject into the same field later.
  Its reflective boundaries come for free.

### 3c — Volume-conserving swash *(deferred; build only if 3a's sheet reads fake in the browser)*
- **The solver.** The signed-face-flux SWE of § 5.1, **not** Mei pipes. 256² at 1 m,
  shoreward of the h ≈ 0.045·L₀ contour only, forced there by the rendered surface.
- **Required from day one.** A graded breaking closure (§ 5.3), Manning friction, and the
  precision self-test (§ 5.8).
- **What it would add.** Cove pile-up and real backwash flow for foam advection.
- **Why it waits.** The same solver plus an advection term is the deferred live-river
  backend (`WATER-TYPES.md` § Deferred), so build it once, when rivers need it.

### Not simulation: the a-faraway-land lever
Rolling lines of spilling surf need ξ₀ < 0.5. At the 12 m/s sea that means tanβ < 0.13
(about 1:8) across the whole breaker band, and the world has 1:2 to 1:4. No amount of
simulation makes this world's surf roll. A **Dean equilibrium-profile beach brush** in
a-faraway-land is the lever: h = A·x^(2/3), with A set by sand grain size. That is the
standard coastal-engineering form, quoted from memory, so check the constants when the
brush is written. It should be offered alongside 3a. `surveyShore()` then confirms the
result in numbers.

## 9. What the spikes did not prove

- ~~**Oblique incidence and 2D emitter behaviour**~~ — measured in § 5.9 (2026-09-13).
  Corner and cove focusing are still unmeasured.
- **Kr above ξ ≈ 2.5 and for rough faces.** The source fits were not reachable (§ 3).
- **Nonlinear steepening.** The H = 3 m SWE packets steepened toward a bore over the 10 m
  flat (gauge peak 3.25 m for a 1.5 m amplitude). No shock capturing; relevant to 3c only.
- **Visual verdict.** None of this has been looked at in a browser. Whether the
  reflection cross-hatch reads as "real coast" or as noise at 12 m/s is Dante's call on
  first build.
- **The EGL/radeonsi precision bug's reach** into real users and existing float RTs (§ 5.8).

## Sources

- H. Malan, *Rendering Water in Horizon Forbidden West*, SIGGRAPH 2022 Advances —
  https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-Water-Malan.pdf
- *Simulation and Representation of Topology-Changing Rolling Waves for Massive Open Ocean
  Games*, SIGGRAPH 2024 Talks — https://dl.acm.org/doi/10.1145/3641233.3664308 (abstract)
- N. Ang et al., *The Technical Art of Sea of Thieves*, SIGGRAPH 2018 Talks —
  https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf
- Crest 5 Shallow Water docs — https://docs.crest.waveharmonic.com/Packages/ShallowWater/Introduction.html ,
  …/Manual.html , …/Shorelines.html ; Crest 4 source `../crest/.../Shaders/Resources/UpdateDynWaves.compute`
- Fluid Flux — https://imaginaryblend.com/2021/09/26/fluid-flux/ ,
  https://80.lv/articles/highly-realistic-coastline-set-up-in-ue5-with-fluid-flux-2-0
- UE5 Water System — https://dev.epicgames.com/documentation/en-us/unreal-engine/water-system-in-unreal-engine
- Wave particles — https://www.cemyuksel.com/research/waveparticles/
- S. Jeschke et al., *Making Procedural Water Waves Boundary-aware*, SCA 2020 —
  https://pub.ista.ac.at/~chafner/JeschkeWaveCages.pdf
- S. Jeschke et al., *Water Surface Wavelets*, SIGGRAPH 2018 — https://dl.acm.org/doi/10.1145/3197517.3201336
- Celeris-WebGPU — https://github.com/plynett/plynett.github.io
- Coastal Wiki, *Surf similarity parameter* — https://www.coastalwiki.org/wiki/Surf_similarity_parameter
  (Battjes 1974, *Surf Similarity*, ICCE 14 — https://icce-ojs-tamu.tdl.org/icce/article/view/2921)
- Coastal Wiki, *Wave run-up* — https://www.coastalwiki.org/wiki/Wave_run-up (Hunt 1959; Stockdon et al. 2006)
- Seelig & Ahrens 1981, CERC TP 81-1 — https://apps.dtic.mil/sti/tr/pdf/ADA101879.pdf (not reachable, 403)
- three.js / super-three 0.173.5 `WebGLRenderer.readRenderTargetPixelsAsync` —
  https://cdn.jsdelivr.net/npm/super-three@0.173.5/src/renderers/WebGLRenderer.js
