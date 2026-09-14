import json, base64, sys, numpy as np
tag, s0, s1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = json.load(open('transect-%s.json' % tag)); F, N = d['F'], d['N']
raw = np.frombuffer(base64.b64decode(d['data']), dtype=np.float32)
X = raw[:F*N*4].reshape(F, N, 4).astype(np.float64); t = raw[F*N*4:].astype(np.float64)
tu = np.arange(t[0], t[-1], 0.05)
names = ['rendered FFT', 'breaker', 'reflection', 'unmasked inc']
print(tag, 's %d-%d' % (s0, s1))
for ch in range(4):
    a = np.stack([np.interp(tu, t, X[:, s, ch]) for s in range(s0, s1)], 1)
    a = (a - a.mean(0)) * np.hanning(len(tu))[:, None]
    Z = np.fft.rfft(a, axis=0); f = np.fft.rfftfreq(len(tu), 0.05)
    for lo, hi in ((0.12, 0.25), (0.25, 0.5)):
        b = (f >= lo) & (f < hi)
        Zb = Z[b]
        cross = (Zb[:, 1:] * np.conj(Zb[:, :-1])).sum()        # summed over freq and s
        k = -np.angle(cross)                                   # rad/m; + means moving +s
        coh = np.abs(cross) / (np.abs(Zb[:, 1:]) * np.abs(Zb[:, :-1])).sum()
        fm = (f[b][:, None] * np.abs(Zb)**2).sum() / (np.abs(Zb)**2).sum()
        c = 2*np.pi*fm / k if abs(k) > 1e-6 else float('inf')
        print('  %-13s band %.2f-%.2f Hz: k %+.4f rad/m (L %6.1f m), moving %s, phase speed %6.2f m/s, coherence %.2f' % (
            names[ch], lo, hi, k, 2*np.pi/abs(k) if abs(k) > 1e-6 else float('inf'), '+s' if k > 0 else '-s', c, coh))
