# Scratch h_0-pass.js with one-sided (Crest PosCosSquared) spreading. argv: outdir, which ('k' puts the
# downwind half on h0(k), 'minus' puts it on h0(-k)).
import re, sys, os
A='/home/david/Documents/webland/a-water/src'
src=open(A+'/python/create-shader.py').read().split('def NextAction')[0]; ns={}; exec(compile(src,'create-shader.py','exec'), ns)
glsl=open(A+'/glsl/fft-waves/h_0-pass.glsl').read()
old="""  float spread_k = mix(d_k * d_k, 0.5, clamp(directionalTurbulence, 0.0, 1.0));
  float spread_minus_k = mix(d_minus_k * d_minus_k, 0.5, clamp(directionalTurbulence, 0.0, 1.0));"""
assert old in glsl
down = 'd_k > 0.0 ? 1.41421356 * d_k * d_k : 0.0'
up = 'd_minus_k > 0.0 ? 1.41421356 * d_minus_k * d_minus_k : 0.0'
a, b = (down, up) if sys.argv[2] == 'k' else (up, down)
new = """  float spread_k = mix(%s, 0.5, clamp(directionalTurbulence, 0.0, 1.0));
  float spread_minus_k = mix(%s, 0.5, clamp(directionalTurbulence, 0.0, 1.0));""" % (a, b)
glsl = glsl.replace(old, new)
t=open(A+'/js/ocean-system/materials/fft-waves/h_0-pass-template.txt').read()
f=ns['ConvertGLSLToStringArray'](glsl)
t=re.sub(r'\s+\{fragment_glsl\}', lambda m: f, t)
open(sys.argv[1]+'/h_0-pass.js','w').write(t); print('wrote', sys.argv[1], sys.argv[2])
