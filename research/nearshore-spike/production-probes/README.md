# Production probes (Phase 3b, 2026-09-13)

Scratch instruments used against the live island-sholes page, kept so the numbers in
WATER-TYPES-PROGRESS.md § Phase 3b (browser round 2) can be re-run. They are not
bundled. They expect the headless driver pattern from the Phase 3a notes: a
`run.mjs` that loads `examples/demos/island-sholes-ocean.html` over http, and
`serve.py`.

- `steps-transect.mjs`: hooks `ShoreReflectionPass.tick` and sync-reads a 160 m
  transect every frame. The four channels are masked FFT, breaker, reflection and
  the unmasked incident. Configured with env vars TX, TZ, NX, NZ, SECS and TAG.
- `phase.py <tag> s0 s1`: travel direction, wavelength and phase speed per channel,
  from the phase gradient of the peak band.
- `xt.py <tag> <channel> <secs>`: space-time diagram as a PNG.
- `regen_h0.py <outdir> k|minus`: a scratch `h_0-pass.js` with one-sided
  (PosCosSquared) spreading. `minus` is the variant that travels downwind.
