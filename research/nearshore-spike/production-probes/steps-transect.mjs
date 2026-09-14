import {writeFileSync} from 'node:fs';
// Per-frame transect along a reflective shore's normal: rendered FFT (masked), breaker+swash, reflection, and the
// unmasked incident the sim is driven by. Sync-read right after the pass tick, so all four are the same frame.
export default async function({ev, sleep, OUT}){
  const P0 = [+(process.env.TX || 1440.5), +(process.env.TZ || 2362.1)], NRM = [+(process.env.NX || 0.99), +(process.env.NZ || -0.10)];
  const SECS = +(process.env.SECS || 60), TAG = process.env.TAG || 'base';
  const heal = `(()=>{try{const d=oceanGrid._landDirector; const s=d.heightStreamer||d.streamer; if(s&&s.clearFailed) s.clearFailed();}catch(e){} return 1;})()`;
  await ev(`(()=>{const r=document.querySelector('#rig'); r.object3D.position.set(${P0[0] + 80}, 40, ${P0[1]}); return 1;})()`);
  await sleep(8000); await ev(heal); await sleep(30000);
  const ok = await ev(`(()=>{
    const g = oceanGrid, pass = g.shoreReflectionPass, R = g.renderer, WF = ARestlessOcean.Passes.WaterFieldPass;
    const N = 160;
    const su = pass._stepMaterial.uniforms;
    let incLines = '', rendLines = '';
    for(let c = 0; c < 6; ++c){
      const m = c < 3 ? 'ma.' + 'xyz'[c] : 'mb.' + 'xyz'[c - 3];
      const uv = '(xz + srCascadeOffset[' + c + ']) / srCascadePatch[' + c + ']';
      incLines += 'inc += srCascadeWeight[' + c + '] * ' + m + ' * textureLod(srCascade' + c + ', ' + uv + ', srCascadeLod[' + c + ']).y;\\n';
      rendLines += 'fft += ' + m.replace('m', 'r') + ' * textureLod(srCascade' + c + ', ' + uv + ', 0.0).y;\\n';
    }
    let decl = ''; for(let c = 0; c < 6; ++c) decl += 'uniform sampler2D srCascade' + c + ';\\n';
    const frag = ['precision highp float;', 'precision highp int;', 'precision highp sampler2D;',
      'layout(location = 0) out highp vec4 tOut;', '#define texture2D texture',
      decl, 'uniform vec2 srCascadeOffset[6];', 'uniform float srCascadePatch[6];', 'uniform float srCascadeLod[6];', 'uniform float srCascadeWeight[6];',
      'uniform vec2 tP0;', 'uniform vec2 tN;', 'uniform float tWhm;',
      WF.SAMPLE_GLSL, ARestlessOcean.WaveMask.GLSL, ARestlessOcean.ShoreBreaker.GLSL, ARestlessOcean.ShoreReflection.GLSL,
      'void main(){',
      '  float s = floor(gl_FragCoord.x);',
      '  vec2 xz = tP0 + tN * s;',
      '  vec4 field = waterFieldAt(xz);',
      '  vec3 ra; vec3 rb; waveMaskCascades(field, ra, rb);',
      '  vec3 ma; vec3 mb; waveMaskCascades(vec4(field.r, 1.0e6, field.b, 0.0), ma, mb);',
      '  float fft = 0.0; float inc = 0.0;',
      rendLines, incLines,
      '  tOut = vec4(fft * tWhm, shoreBreakerHeightAt(xz, field, 1.0), shoreReflectionHeightAt(xz), inc);',
      '}'].join('\\n');
    const uni = Object.assign({}, su, ARestlessOcean.ShoreBreaker.createUniforms(), ARestlessOcean.ShoreReflection.createUniforms(),
      {tP0: {value: new THREE.Vector2(${P0[0]}, ${P0[1]})}, tN: {value: new THREE.Vector2(${NRM[0]}, ${NRM[1]}).normalize()}, tWhm: {value: 1}});
    const mat = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, uniforms: uni, vertexShader: 'void main(){ gl_Position = vec4(position, 1.0); }', fragmentShader: frag, depthTest: false, depthWrite: false});
    const rt = new THREE.WebGLRenderTarget(N, 1, {minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.FloatType, depthBuffer: false});
    const scene = new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)); const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const buf = new Float32Array(N * 4); const gl = R.getContext();
    window.__tr = {N, frames: [], times: []};
    const orig = pass.tick.bind(pass);
    pass.tick = function(ctx){
      orig(ctx);
      if(!pass.active || !window.__tr.on) return;
      if(g._shoreBreakerParams) ARestlessOcean.ShoreBreaker.writeUniforms(uni, g._shoreBreakerParams);
      ARestlessOcean.ShoreReflection.writeUniforms(uni, pass.consumerState());
      uni.tWhm.value = g.oceanHeightComposer.waveHeightMultiplier;
      const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.render(scene, cam); R.setRenderTarget(prev);
      const pp = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING); if(pp) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      R.readRenderTargetPixels(rt, 0, 0, N, 1, buf);
      if(pp) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pp);
      window.__tr.frames.push(buf.slice()); window.__tr.times.push(ctx.timeMs);
    };
    return JSON.stringify({dx: pass.grid.dx, c0: pass.grid.c0, omega: pass.grid.omega});
  })()`);
  console.log('instrument', ok);
  await ev(`window.__tr.on = true; 1`);
  await sleep(SECS * 1000);
  const b64 = await ev(`(()=>{const T=window.__tr; T.on=false; const F=T.frames.length, N=T.N; const o=new Float32Array(F*N*4+F);
    for(let f=0;f<F;f++){o.set(T.frames[f], f*N*4); o[F*N*4+f]=T.times[f]/1000;}
    const u=new Uint8Array(o.buffer); let s=''; for(let i=0;i<u.length;i+=32768) s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));
    return JSON.stringify({F, N, data: btoa(s)});})()`);
  writeFileSync(OUT + 'transect-' + TAG + '.json', b64);
}
