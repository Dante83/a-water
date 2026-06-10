import os, re
import subprocess
import tempfile

#Bundles every a-restless-ocean source file into a single distributable, in the
#same load order the examples use (see examples/personal-ocean/islands.html — that
#order is the source of truth for inter-file dependencies). Produces two files in
#dist/:
#   a-restless-ocean.<VERSION>.js      — concatenated, debug-stripped, readable
#   a-restless-ocean.<VERSION>.min.js  — additionally GLSL-comment-stripped + terser
#
#Two strip passes run here:
#  1. DEBUG regions — anything between //$DEBUG_START$ and //$DEBUG_END$ markers is
#     removed from BOTH outputs so production never ships the in-browser debug
#     tooling (the 40-mode shader visualiser, the window.set* live tuners, console
#     probes). Dev runs the loose source files (islands.html) where the markers are
#     inert comments, so the tooling stays available while iterating.
#  2. GLSL comments — in the min build only, the quoted '//...' lines inside the
#     shader string-arrays are dropped to shrink the payload before terser.

VERSION  = 'v0.2.0'
LIB_NAME = 'a-restless-ocean'

#Ordered list of source files (relative to ../js/). Mirrors the proven <script>
#order in examples/personal-ocean/islands.html. Anything under materials/ carries
#GLSL as string-arrays and gets the extra comment-strip in the min build.
JS_FILE_NAMES = [
    'three_js_extensions/GPUComputeRenderer.js',
    'three_js_extensions/BufferGeometryUtils.js',
    'ARestlessOcean.js',
    'ocean-system/materials/fft-waves/noise-pass.js',
    'ocean-system/materials/fft-waves/h_0-pass.js',
    'ocean-system/materials/fft-waves/h_k-pass.js',
    'ocean-system/materials/fft-waves/compute-twiddle-indices.js',
    'ocean-system/materials/fft-waves/butterfly-pass.js',
    'ocean-system/materials/ocean-material/position-pass.js',
    'ocean-system/materials/ocean-material/water-shader.js',
    'ocean-system/materials/ocean-material/ocean-shadow.js',
    'ocean-system/materials/ocean-material/horizon-skirt.js',
    'ocean-system/materials/ocean-material/ocean-splash.js',
    'ocean-system/luts/ocean-height-band-library.js',
    'ocean-system/luts/ocean-wave-field.js',
    'ocean-system/luts/ocean-height-composer.js',
    'ocean-system/components/ocean-patch-geometry.js',
    'ocean-system/components/ocean-patch.js',
    'ocean-system/components/ocean-shadow-csm.js',
    'ocean-system/components/ocean-grid.js',
    'ocean-system/components/ocean-splash.js',
    'ocean-system/components/ocean-state.js',
    'ocean-system/components/a-restless-ocean.js',
    'ocean-system/components/ocean-static-mask.js',
    'ocean-system/components/buoyant.js',
]

#Drop the UMD `if(typeof exports !== 'undefined'){...}` tails so the bundle stays
#browser-global only (matches the original behaviour).
EXPORTS_REGEX = re.compile(r"(if\(typeof\sexports\s.*?\})", re.DOTALL)

#Remove a //$DEBUG_START$ ... //$DEBUG_END$ span. Non-greedy so each marker pair
#closes on its own END. Matched per-file, so a span never crosses a file boundary.
#In plain-JS files the markers are bare comments and the whole region (handles,
#methods) is deleted cleanly. In generated shader files the markers were emitted by
#create-shader.py as quoted entries ('//$DEBUG_START$',) — the regex matches inside
#the quotes and leaves a harmless empty '' string entry where the block was.
DEBUG_REGEX = re.compile(r"//\$DEBUG_START\$.*?//\$DEBUG_END\$", re.DOTALL)

#GLSL-comment strippers for the min build (operate on the quoted shader strings).
GLSL_LINE_COMMENT     = re.compile(r"([\'\"]\/\/.*[\'\"],)")
GLSL_TRAILING_COMMENT = re.compile(r"([\'\"].*)(\/\/.*)([\'\"],)")
GLSL_BLOCK_COMMENT    = re.compile(r"[\'\"]/\*[^*]*\*+(?:[^/*][^*]*\*+)*/[\'\"]\,")

def strip_glsl_comments(code):
    code = GLSL_LINE_COMMENT.sub('', code)
    code = GLSL_TRAILING_COMMENT.sub(r"\1\3", code)
    code = GLSL_BLOCK_COMMENT.sub('', code)
    return code

def main():
    output_dir = '../../dist/'
    js_path  = os.path.abspath(output_dir + LIB_NAME + '.' + VERSION + '.js')
    min_path = os.path.abspath(output_dir + LIB_NAME + '.' + VERSION + '.min.js')
    js_dir   = '../js/'

    #Load each file, strip UMD exports + debug regions. Keep blocks separate so the
    #min pass can target only the shader/material files for GLSL-comment removal.
    code_blocks = []
    is_material = []
    for name in JS_FILE_NAMES:
        with open(os.path.abspath(js_dir + name), 'r') as f:
            code = f.read()
        code = EXPORTS_REGEX.sub('', code)
        code = DEBUG_REGEX.sub('', code)
        code_blocks.append(code)
        is_material.append('materials/' in name)

    #Readable (non-minified) distributable.
    combined_code = '\n'.join(code_blocks)
    with open(js_path, 'w') as w:
        w.write(combined_code)
        print('Combined file written -> ' + js_path)

    #Minified distributable: extra GLSL-comment strip on the material blocks only
    #(so plain-JS strings containing '//', e.g. URLs, are never touched), then terser.
    min_blocks = [strip_glsl_comments(c) if mat else c
                  for c, mat in zip(code_blocks, is_material)]
    minify_src = '\n'.join(min_blocks)

    tmp_name = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js',
                                         dir=os.path.abspath(output_dir),
                                         delete=False) as tmp:
            tmp.write(minify_src)
            tmp_name = tmp.name
        proc = subprocess.Popen('terser ' + tmp_name, stdout=subprocess.PIPE, shell=True)
        (uglified_js, err) = proc.communicate()
        if proc.returncode == 0 and uglified_js:
            with open(min_path, 'w') as w:
                w.write(uglified_js.decode('utf-8'))
                print('Minified file written -> ' + min_path)
        else:
            print('terser produced no output (is it installed? `npm i -g terser`); '
                  'skipped the .min.js build.')
    finally:
        if tmp_name and os.path.exists(tmp_name):
            os.remove(tmp_name)

#Run everything you see above
main()
