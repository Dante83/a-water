import json, base64, sys, numpy as np
from PIL import Image
tag = sys.argv[1]; ch = int(sys.argv[2]); secs = float(sys.argv[3]) if len(sys.argv) > 3 else 20
d = json.load(open('transect-%s.json' % tag)); F, N = d['F'], d['N']
raw = np.frombuffer(base64.b64decode(d['data']), dtype=np.float32)
X = raw[:F*N*4].reshape(F, N, 4).astype(np.float64); t = raw[F*N*4:].astype(np.float64)
tu = np.arange(t[0], t[0] + secs, 0.05)
a = np.stack([np.interp(tu, t, X[:, s, ch]) for s in range(N)], 1)   # rows time, cols s
a = a - a.mean(0); r = 2.5 * a.std()
img = np.clip(0.5 + 0.5 * a / r, 0, 1)
Image.fromarray((img * 255).astype(np.uint8)).resize((N * 4, len(tu) * 2), Image.NEAREST).save('xt-%s-%d.png' % (tag, ch))
print('rows = time (%.2f s/row after resize %.3f), cols = s (0.25 m/px)' % (0.05, 0.025))
