#!/usr/bin/env python3
"""
make-caustic-map.py — regenerates examples/*/image-dir/a-water-assets/caustic-map.webp

Replaces the original 256x256 sRGB-authored caustic texture (Minstrel-era asset)
with a 1024x1024 photon-splat render authored in LINEAR intensity:

  * Two decorrelated periodic wave height fields (R and G channels — the water
    shader and the underwater caustic projector both min() two scrolling taps,
    one from each channel; B duplicates G like the original asset did).
  * Vertical rays are refracted by each field's slopes (paraxial approximation)
    and splatted onto the output grid. The displacement scale is solved so ~5%
    of rays sit past the first caustic fold — a just-past-focus web of connected
    filaments, matching the character of the original texture.
  * Splat density is linear radiant intensity (mean 1, energy conserving), so
    the texture is LINEAR data: ocean-grid.js correctly tags it
    THREE.LinearSRGBColorSpace and no sRGB decode applies.

The smoothstep contrast thresholds the consumers apply to min(R, G) were
re-solved so the OUTPUT distribution (mean / faint coverage / hot-line
coverage) matches what the old texture + smoothstep(0.15, 0.85) produced —
the tuned seabed look is preserved, only resolution and filament crispness
change. This script re-solves and prints them; if you change any knob below,
update BOTH consumers with the printed values:

  * water-shader.glsl  — CAUSTIC_THRESHOLD_LO / CAUSTIC_THRESHOLD_HI
  * ocean-grid.js      — the smoothstep(LO, HI, min(a, b)) line in
                         _causticProjectionMaterial's fragment shader

Run from anywhere; paths are repo-relative to this file. Requires numpy + PIL.
"""
import os
import numpy as np
from PIL import Image

N_OUT  = 1024      # output texture resolution
N_RAY  = 4096      # ray-trace grid (16x supersampling of the splat)
K0     = 8.0       # dominant caustic cells per tile (FFT-matched to old map)
K_SIG  = 2.5       # spectral bandwidth around K0
BLUR_SIGMA = 8.0   # px of periodic gaussian glow — keeps the min() interlock
                   # connected instead of only sparkling at line crossings.
                   # 2.5 proved too thin at 1024: the two scrolled taps only
                   # overlapped at crossings ("bright dots, missing lines").
                   # 8px ~= the old 256px asset's 2px filament width.
FOLD_FRACTION = 0.05   # fraction of rays past the caustic fold (det J < 0)
SEED_R, SEED_G = 101, 202
TONE_PERCENTILE = 99.7  # splat density that maps to 1.0 in the 8-bit texture

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_PATHS = [os.path.join(REPO, 'examples', d, 'image-dir/a-water-assets/caustic-map.webp')
             for d in ('demos', 'ocean-sky', 'personal-ocean')]
# Canonical output-distribution target: (mean, coverage>0.1, coverage>0.5) of
# smoothstep(0.15, 0.85, min(R, G)) measured on the ORIGINAL 256px asset
# (recoverable via git history of examples/ocean-sky/.../caustic-map.webp).
# Hardcoded so re-running after the asset is replaced still matches the
# original tuned look rather than drifting toward the previous run.
TARGET_STATS = np.array([0.00763601, 0.01568167, 0.00024333])


def height_field(n, seed):
    r = np.random.default_rng(seed)
    spec = r.normal(size=(n, n)) + 1j * r.normal(size=(n, n))
    k = np.fft.fftfreq(n, d=1.0 / n)
    kx, ky = np.meshgrid(k, k)
    kr = np.sqrt(kx**2 + ky**2)
    env = np.exp(-((kr - K0) ** 2) / (2 * K_SIG**2))
    env[kr < 2.0] = 0.0     # kill the DC/low-frequency drift
    h = np.real(np.fft.ifft2(spec * env))
    return h / h.std()


def spectral_grad(field):
    n = field.shape[0]
    k = np.fft.fftfreq(n, d=1.0 / n)
    kx, ky = np.meshgrid(k, k)
    F = np.fft.fft2(field)
    return (np.real(np.fft.ifft2(2j * np.pi * kx * F)),
            np.real(np.fft.ifft2(2j * np.pi * ky * F)))


def fold_fraction(gx, gy, c):
    gxx, gxy = spectral_grad(gx)
    _, gyy = spectral_grad(gy)
    detJ = (1 + c * gxx) * (1 + c * gyy) - (c * gxy) ** 2
    return (detJ < 0).mean()


def splat_channel(seed):
    h = height_field(N_RAY, seed)
    gx, gy = spectral_grad(h)
    lo, hi = 1e-4, 1.0
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if fold_fraction(gx, gy, mid) < FOLD_FRACTION:
            lo = mid
        else:
            hi = mid
    c = 0.5 * (lo + hi)
    ix, iy = np.meshgrid(np.arange(N_RAY), np.arange(N_RAY))
    px = np.mod((ix + c * gx * N_RAY) * (N_OUT / N_RAY), N_OUT)
    py = np.mod((iy + c * gy * N_RAY) * (N_OUT / N_RAY), N_OUT)
    x0 = np.floor(px).astype(int); y0 = np.floor(py).astype(int)
    fx = px - x0; fy = py - y0
    x1 = (x0 + 1) % N_OUT; y1 = (y0 + 1) % N_OUT
    acc = np.zeros((N_OUT, N_OUT))
    np.add.at(acc, (y0, x0), (1 - fx) * (1 - fy))
    np.add.at(acc, (y0, x1), fx * (1 - fy))
    np.add.at(acc, (y1, x0), (1 - fx) * fy)
    np.add.at(acc, (y1, x1), fx * fy)
    acc /= (N_RAY / N_OUT) ** 2     # mean 1 — energy conserving
    k = np.fft.fftfreq(N_OUT, d=1.0 / N_OUT)
    kx, ky = np.meshgrid(k, k)
    g = np.exp(-2 * (np.pi * BLUR_SIGMA / N_OUT) ** 2 * (kx**2 + ky**2))
    return np.clip(np.real(np.fft.ifft2(np.fft.fft2(acc) * g)), 0, None)


def smoothstep(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def min_of_independent_taps(a, b, rng, n=600000):
    h, w = a.shape
    return np.minimum(a[rng.integers(0, h, n), rng.integers(0, w, n)],
                      b[rng.integers(0, h, n), rng.integers(0, w, n)])


def pipeline_stats(out):
    return np.array([out.mean(), (out > 0.1).mean(), (out > 0.5).mean()])


def main():
    print('splatting R channel...'); r = splat_channel(SEED_R)
    print('splatting G channel...'); g = splat_channel(SEED_G)
    scale = 1.0 / np.percentile(np.concatenate([r.ravel(), g.ravel()]), TONE_PERCENTILE)
    r8 = np.clip(r * scale, 0, 1)
    g8 = np.clip(g * scale, 0, 1)
    out = np.stack([r8, g8, g8], axis=-1)
    img = Image.fromarray((out * 255 + 0.5).astype(np.uint8))
    for p in OUT_PATHS:
        img.save(p, lossless=True)
        print('wrote', p, '(%d bytes)' % os.path.getsize(p))

    # ── Solve the consumer smoothstep thresholds against the original look ──
    rng = np.random.default_rng(3)
    target = TARGET_STATS
    # Round-trip through the saved webp so lossy/quantization effects are included.
    saved = np.asarray(Image.open(OUT_PATHS[0]).convert('RGB')).astype(float) / 255.0
    new_min = min_of_independent_taps(saved[..., 0], saved[..., 1], rng)
    best = None
    for lo in np.linspace(0.0, 0.5, 101):
        for hi in np.linspace(lo + 0.1, 1.0, 46):
            st = pipeline_stats(smoothstep(lo, hi, new_min))
            err = np.abs(np.log((st + 1e-6) / (target + 1e-6))).sum()
            if best is None or err < best[0]:
                best = (err, lo, hi, st)
    print('old pipeline stats  (mean, cov>0.1, cov>0.5):', target)
    print('new pipeline stats  (mean, cov>0.1, cov>0.5):', best[3])
    print('=> set CAUSTIC_THRESHOLD_LO = %.3f, CAUSTIC_THRESHOLD_HI = %.3f' % (best[1], best[2]))
    print('   in water-shader.glsl AND the projection smoothstep in ocean-grid.js')


if __name__ == '__main__':
    main()
