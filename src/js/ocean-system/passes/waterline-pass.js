//── Waterline pass (Phase 8e) ──────────────────────────────────────────────
//
//WHAT IT FIXES. Above or below water used to be ONE switch for the whole frame,
//thrown by a height check at the camera. Near the surface the camera's near plane
//(10 cm out, ±8 cm tall at an 80° fov) pokes THROUGH the water: part of the view
//starts in air, part in water, and the switch can only be right for one of them.
//What was wrong looked wrong in a big way: a murk wall with clear sky over it, or
//bare unfogged seabed under a bright sky (headless 2026-09-27, island-sholes).
//
//WHAT IT DOES. OceanGrid flips the frame at the EYE (exact probe), so the native
//path always owns the medium the eye is in, and only the sliver of the view on the
//other side of the line can be wrong. This pass draws over exactly those pixels,
//from the near plane, after the scene. (Round 2 kept the frame above-water until the
//whole near plane was under, and this approximation then covered most of the screen
//for the first ~10 cm under: a bright seabed and a flat ceiling where the real murk
//belonged, Dante 2026-09-27.)
//  * For every pixel, where its point on the near plane sits against the DRAWN
//    surface (HeightReadbackPass.surfaceGLSL: every cascade, chop inverted,
//    breakers, reflection, ripples, bank sink), so the line is where the water is.
//  * Below that line, the water column between the lens and what the pixel sees:
//    Beer-Lambert over the scene depth from the refraction G-buffer (sky and
//    empty directions: the full murk), toward the murk OceanGrid computes for the
//    curtain. Where the ray meets the underside of the surface first, the frame
//    (still above-water, the mesh FrontSide) has culled that underside and shows
//    whatever lies beyond it, so the pixel is covered with the ceiling's colour: the
//    mirror's murk under total internal reflection, fading to clear inside Snell's
//    window (steeper than the critical angle), where the sky behind is about right.
//  * With the eye UNDER, the pixels above the line start in air, and they get the
//    REAL above-water render (OceanGrid.tock, after A-Frame's frame): depth is cleared,
//    renderMask() writes depth 0 over every pixel on the water side, and the scene is
//    drawn once more in the above-water state straight onto the canvas, so the depth
//    test keeps it to the air side. On the canvas it gets the same tone mapping and
//    colour output as any above-water frame; every stand-in painted from a render
//    target came out in the wrong units (black, then washed out: the transmission
//    render's contents are graded differently per library, Dante 2026-09-27). The old
//    stand-in (transmission render + a Fresnel water top) remains as the fallback when
//    that pass is off (OceanGrid.waterlineAirPass = false).
//  * A meniscus (WaterlinePass.meniscus): the lip of water on the lens, as Crest draws
//    it (UnderwaterMeniscus.shader, UnderwaterEffectShared.hlsl ComputeMeniscusWeight):
//    a soft strip along the line. The two views are blended ACROSS the line (a blur
//    along its screen normal, from a copy of the finished frame, so both sides are on
//    it), and a soft bluish multiply (Crest's 1.3 * (0.37, 0.4, 0.5)) darkens the middle
//    and fades out at the edges. Nothing is bent: an earlier lens model refracted and
//    reflected the lip and pulled the sky down into a smeared water band (Dante,
//    2026-09-27). Off: the old thin dark line.
//
//THE LINE IS THE DRAWN MESH, NOT THE SMOOTH FIELD. The water is triangles: near the
//camera a 25 cm cell fans 8 triangles from its centre (vertices every 12.5 cm), each flat
//between its corners. surfaceAt is the smooth field those corners sample, and on short
//waves it strays a centimetre from the flat triangle, which is ~40 px of near plane. Where
//the mesh was higher, the near plane had already clipped the top surface away but the
//test still said "air": the bare above-water seabed showed through, no murk, no light,
//with a hard edge at the test's line (Dante, 2026-09-27). wlDrawnHeight finds the fan
//triangle, displaces its corners exactly as the vertex shader does, and interpolates.
//
//LIMITS (flagged). One scalar alpha, so the murk's colour is right but the per-
//channel transmittance is averaged; the fog chunk's angular (sun-phase) term is
//not reproduced; no refractive lens distortion at the meniscus.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.WaterlinePass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.mesh = null;
  this.active = false;
  //Meniscus: width in pixels (either side) and opacity; the line colour is the murk × LINE_DARKEN.
  this.lineWidthPx = 2.0;
  this.lineOpacity = 0.55;
  this.lineDarken = 0.35;
  //Meniscus (read the header). Off: the old thin dark line above.
  this.meniscus = true;
  this.meniscusWidthPx = 6.0;            //half-width across the line, px at 1080 lines (scales with height)
  this.meniscusTint = new THREE.Vector3(0.48, 0.52, 0.65);   //Crest: 1.3 * (0.37, 0.4, 0.5), multiplied
  this.meniscusTintStrength = 0.5;       //0 = blend only, 1 = Crest's full multiply
  this.canvasCopy = null;
  //Longest water path the composite fogs over (m): past this it is the murk.
  this.maxFogDistance = 300.0;
  //Tone curve for the air view (eye under): 1 = the water shader's AES, 0 = as stored.
  this.airMode = 1;
};

//The overlay and the mask live in scenes of their own, drawn by OceanGrid.tock after
//the frame, so no offscreen pass ever sees them.
ARestlessOcean.Passes.WaterlinePass.prototype.init = function(scene){
  const hrp = this.oceanGrid.heightReadbackPass;
  if(!hrp || !hrp.surfaceGLSL) return;
  const uniforms = Object.assign(hrp.createSurfaceUniforms(), {
    wlInvViewProj: {value: new THREE.Matrix4()},
    wlEye: {value: new THREE.Vector3()},
    wlForward: {value: new THREE.Vector3(0, 0, -1)},
    wlDepth: {value: null},
    wlDepthOn: {value: 0.0},
    wlResolution: {value: new THREE.Vector2(1, 1)},
    wlMurk: {value: new THREE.Vector3(0.0, 0.05, 0.06)},
    wlCeiling: {value: new THREE.Vector3(0.0, 0.08, 0.09)},
    wlStateUnder: {value: 0.0},
    wlAirMode: {value: 1.0},
    wlMaskUnder: {value: 1.0},
    wlAir: {value: null},
    wlAirOn: {value: 0.0},
    wlViewProj: {value: new THREE.Matrix4()},
    wlExtinction: {value: new THREE.Vector3(0.3, 0.1, 0.1)},
    wlCompositeOn: {value: 1.0},
    wlLineWidth: {value: this.lineWidthPx},
    wlLineOpacity: {value: this.lineOpacity},
    wlLineDarken: {value: this.lineDarken},
    wlMaxFog: {value: this.maxFogDistance},
    wlCanvas: {value: null},
    wlMenOn: {value: 0.0},
    wlCanvasRes: {value: new THREE.Vector2(1, 1)},
    wlMenWidth: {value: 6.0},
    wlMenTint: {value: new THREE.Vector3(0.48, 0.52, 0.65)},
    wlMenTintStrength: {value: 0.5},
    wlMeshCell: {value: 0.0}
  });
  //The drawn surface's height under a near-plane point (read the header: THE LINE IS THE
  //DRAWN MESH). p0 is the rest point whose displaced particle lands under q.
  const drawnGLSL = [
    'uniform float wlMeshCell;',
    'vec3 wlVertex(vec2 r){ vec4 s = surfaceAt(r); return vec3(r.x + s.x, s.y, r.y + s.z); }',
    'float wlDrawnHeight(vec2 q, vec2 p0){',
    '  if(wlMeshCell <= 0.0) return surfaceAt(p0).y;',
    //ocean-patch-geometry.js: each cell fans 8 triangles from its centre, split along the
    //lines to its 4 corners and 4 edge midpoints, so the octant picks the triangle.
    '  vec2 c = (floor(p0 / wlMeshCell) + 0.5) * wlMeshCell;',
    '  vec2 dd = p0 - c;',
    '  vec2 sg = vec2(dd.x >= 0.0 ? 1.0 : -1.0, dd.y >= 0.0 ? 1.0 : -1.0);',
    '  vec2 axis = abs(dd.x) >= abs(dd.y) ? vec2(sg.x, 0.0) : vec2(0.0, sg.y);',
    '  vec3 A = wlVertex(c);',
    '  vec3 B = wlVertex(c + axis * (0.5 * wlMeshCell));',
    '  vec3 K = wlVertex(c + sg * (0.5 * wlMeshCell));',
    //Barycentric in the DISPLACED triangle (chop moves the corners sideways).
    '  vec2 e0 = B.xz - A.xz, e1 = K.xz - A.xz, e2 = q - A.xz;',
    '  float den = e0.x * e1.y - e1.x * e0.y;',
    '  if(abs(den) < 1.0e-12) return A.y;',
    '  float wb = (e2.x * e1.y - e1.x * e2.y) / den;',
    '  float wk = (e0.x * e2.y - e2.x * e0.y) / den;',
    '  return A.y + wb * (B.y - A.y) + wk * (K.y - A.y);',
    '}'
  ].join('\n');
  const vertexShader = [
    'uniform mat4 wlInvViewProj;',
    'varying vec3 vNear;',
    'void main(){',
    //The point of this pixel on the near plane (NDC z = −1), in world space. A
    //projective map is linear across the plane, so interpolating it is exact.
    '  vec4 w = wlInvViewProj * vec4(position.xy, -1.0, 1.0);',
    '  vNear = w.xyz / w.w;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');
  const fragmentShader = [
    hrp.surfaceGLSL(),
    drawnGLSL,
    'uniform vec3 wlEye;',
    'uniform vec3 wlForward;',
    'uniform sampler2D wlDepth;',
    'uniform float wlDepthOn;',
    'uniform vec2 wlResolution;',
    'uniform vec3 wlMurk;',
    'uniform vec3 wlCeiling;',
    'uniform float wlStateUnder;',
    'uniform sampler2D wlAir;',
    'uniform float wlAirOn;',
    'uniform mat4 wlViewProj;',
    //The transmission render as the water shader's Snell window shows it: its own AES
    //curve, NO exposure (water-shader.glsl aroAESFilmicToneMapping), then sRGB by the
    //colorspace chunk below. Through three's toneMapping() the metering exposure
    //(~1.7e-5 on a-starry-sky pages) made the air above the line black.
    'uniform float wlAirMode;',
    'vec3 wlAirTone(vec3 c){',
    '  if(wlAirMode < 0.5) return c;',
    '  return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);',
    '}',
    'vec2 wlProjectDir(vec3 from, vec3 dir){',
    '  vec4 c = wlViewProj * vec4(from + dir * 1000.0, 1.0);',
    '  return clamp(c.xy / max(c.w, 1.0e-4) * 0.5 + 0.5, vec2(0.001), vec2(0.999));',
    '}',
    'uniform vec3 wlExtinction;',
    'uniform float wlCompositeOn;',
    'uniform float wlLineWidth;',
    'uniform float wlLineOpacity;',
    'uniform float wlLineDarken;',
    'uniform float wlMaxFog;',
    'uniform sampler2D wlCanvas;',
    'uniform float wlMenOn;',
    'uniform vec2 wlCanvasRes;',
    'uniform float wlMenWidth;',       //half-width across the line (px)
    'uniform vec3 wlMenTint;',
    'uniform float wlMenTintStrength;',
    'varying vec3 vNear;',
    'void main(){',
    //The rest point whose displaced particle lands under this pixel (chop), then
    //the drawn height there.
    '  vec2 p0 = vNear.xz;',
    '  for(int k = 0; k < 3; k++){ p0 = vNear.xz - surfaceAt(p0).xz; }',
    '  float S = wlDrawnHeight(vNear.xz, p0);',
    '  float d = vNear.y - S;',                       //< 0: this ray starts under water
    '  float px = max(fwidth(d), 1.0e-6);',
    '  float under = 1.0 - smoothstep(-px, px, d);',
    '  vec4 col = vec4(0.0);',
    //Eye under: the part of the view that starts in AIR.
    '  if(wlStateUnder > 0.5){',
    '    float air = 1.0 - under;',
    '    if(wlAirOn > 0.5 && air > 0.0){',
    '      vec3 ray = normalize(vNear - wlEye);',
    '      vec3 up = wlAirTone(texture2D(wlAir, gl_FragCoord.xy / wlResolution).rgb);',
    '      vec3 r = vec3(ray.x, abs(ray.y), ray.z);',
    '      vec3 sky = wlAirTone(texture2D(wlAir, wlProjectDir(vNear, r)).rgb);',
    '      float c = clamp(-ray.y, 0.0, 1.0);',
    '      float F = 0.02 + 0.98 * pow(1.0 - c, 5.0);',
    '      vec3 top = mix(wlMurk, sky, F);',
    '      col = vec4(mix(up, top, smoothstep(-0.01, 0.02, -ray.y)), air);',
    '    }',
    '  } else if(wlCompositeOn > 0.5 && under > 0.0){',
    '    vec3 ray = vNear - wlEye;',
    '    float tLens = length(ray);',
    '    vec3 dir = ray / max(tLens, 1.0e-6);',
    '    float tScene = 1.0e6;',
    '    if(wlDepthOn > 0.5){',
    '      float z = texture2D(wlDepth, gl_FragCoord.xy / wlResolution).r;',
    '      if(z > 0.0) tScene = max(0.0, z / max(dot(dir, wlForward), 1.0e-3) - tLens);',
    '    }',
    //The underside of the surface, taken flat at S from the lens.
    '    float tCeil = dir.y > 1.0e-4 ? (S - vNear.y) / dir.y : 1.0e6;',
    '    if(tScene <= tCeil){',
    '      vec3 T = exp(-wlExtinction * min(tScene, wlMaxFog));',
    '      col = vec4(wlMurk, under * (1.0 - dot(T, vec3(1.0 / 3.0))));',
    '    } else {',
    //The underside: total internal reflection past the critical angle (cos 0.66 from
    //the vertical, n = 1.333), Snell's window inside it.
    '      float tir = 1.0 - smoothstep(0.60, 0.72, dir.y);',
    '      col = vec4(wlCeiling, under * tir);',
    '    }',
    '  }',
    //Meniscus off: a thin dark line.
    '  if(wlMenOn < 0.5){',
    '    float line = (1.0 - smoothstep(wlLineWidth * 0.5, wlLineWidth, abs(d) / px)) * wlLineOpacity;',
    '    if(line > col.a){',
    '      col.rgb = mix(col.rgb, wlMurk * wlLineDarken, line);',
    '      col.a = line;',
    '    }',
    '  }',
    '  vec4 outCol = linearToOutputTexel(col);',
    //Meniscus on: across the line (its screen normal from the height field's gradient),
    //a Gaussian blur of the finished frame, so each side fades into the other, times
    //Crest's bluish multiply. Both follow one profile, 1 on the line and 0 at the edge.
    '  if(wlMenOn > 0.5){',
    '    vec2 g = vec2(dFdx(d), dFdy(d));',
    '    float gl = max(length(g), 1.0e-9);',
    '    float distPx = d / gl;',
    '    if(abs(distPx) < wlMenWidth){',
    '      vec2 nrm = g / gl;',
    '      vec3 acc = vec3(0.0);',
    '      float wsum = 0.0;',
    '      for(int k = -6; k <= 6; k++){',
    '        float t = float(k) / 6.0;',
    '        float w = exp(-3.0 * t * t);',
    '        vec2 uv = (gl_FragCoord.xy + nrm * t * wlMenWidth) / wlCanvasRes;',
    '        acc += texture2D(wlCanvas, clamp(uv, vec2(0.0), vec2(1.0))).rgb * w;',
    '        wsum += w;',
    '      }',
    '      acc /= wsum;',
    '      float prof = pow(smoothstep(1.0, 0.0, abs(distPx) / wlMenWidth), 0.5);',
    '      acc *= mix(vec3(1.0), wlMenTint, wlMenTintStrength * prof);',
    //Over whatever the stand-in drew (premultiplied "over").
    '      float A = prof + outCol.a * (1.0 - prof);',
    '      outCol.rgb = (acc * prof + outCol.rgb * outCol.a * (1.0 - prof)) / max(A, 1.0e-4);',
    '      outCol.a = A;',
    '    }',
    '  }',
    '  if(outCol.a <= 0.001) discard;',
    '  gl_FragColor = outCol;',
    //⚠ NO tone mapping. The murk is a display-space colour, like the fog chunk's fogColor
    //(three applies fog AFTER tonemapping_fragment) and the scene.background OceanGrid
    //clears to. Tone-mapped, a-starry-sky's metering exposure (~1.7e-5) crushed it to
    //black: the black band at the waterline on the swim page (Dante, 2026-09-27).
    //(linearToOutputTexel above is that chunk, applied before the meniscus, which works
    //on the finished frame's display values.)
    '}'
  ].join('\n');
  this.material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    fog: false
  });
  this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  this.mesh.frustumCulled = false;
  this.mesh.renderOrder = 10000;       //after everything, the splash included
  this.mesh.visible = false;
  this.mesh.name = 'aro-waterline';
  this.overlayScene = new THREE.Scene();
  this.overlayScene.add(this.mesh);

  //The depth mask: the same per-pixel surface test, writing depth 0 (the quad sits on
  //the near plane) wherever the pixel starts under water, and nothing on the air side.
  this.maskMaterial = new THREE.ShaderMaterial({
    uniforms: uniforms,      //the SAME object: prepare() fills both
    vertexShader: [
      'uniform mat4 wlInvViewProj;',
      'varying vec3 vNear;',
      'void main(){',
      '  vec4 w = wlInvViewProj * vec4(position.xy, -1.0, 1.0);',
      '  vNear = w.xyz / w.w;',
      '  gl_Position = vec4(position.xy, -0.99999, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      hrp.surfaceGLSL(),
      drawnGLSL,
      'uniform float wlMaskUnder;',    //1: protect the water side, 0: protect the air side
      'varying vec3 vNear;',
      'void main(){',
      '  vec2 p0 = vNear.xz;',
      '  for(int k = 0; k < 3; k++){ p0 = vNear.xz - surfaceAt(p0).xz; }',
      '  bool under = vNear.y - wlDrawnHeight(vNear.xz, p0) <= 0.0;',
      '  if(under != (wlMaskUnder > 0.5)) discard;',
      '  gl_FragColor = vec4(0.0);',
      '}'
    ].join('\n'),
    //⚠ depthTest ON with AlwaysDepth, not depthTest off: with the depth test disabled GL
    //does not WRITE depth either, and the mask protected nothing (the whole frame was
    //overdrawn, headless 2026-09-27).
    depthTest: true,
    depthFunc: THREE.AlwaysDepth,
    depthWrite: true,
    colorWrite: false,
    fog: false
  });
  const maskMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.maskMaterial);
  maskMesh.frustumCulled = false;
  this.maskScene = new THREE.Scene();
  this.maskScene.add(maskMesh);
};

//The finished frame for the meniscus, copied off the canvas by OceanGrid.tock after the
//other-medium pass, before the overlay.
ARestlessOcean.Passes.WaterlinePass.prototype.captureCanvas = function(renderer){
  if(!this.mesh || !this.active || !this.meniscus) return;
  const size = this._canvasSize || (this._canvasSize = new THREE.Vector2());
  renderer.getDrawingBufferSize(size);
  const w = Math.max(1, Math.floor(size.x)), h = Math.max(1, Math.floor(size.y));
  if(!this.canvasCopy || this.canvasCopy.image.width !== w || this.canvasCopy.image.height !== h){
    if(this.canvasCopy) this.canvasCopy.dispose();
    this.canvasCopy = new THREE.FramebufferTexture(w, h);
    this.canvasCopy.minFilter = THREE.LinearFilter;
    this.canvasCopy.magFilter = THREE.LinearFilter;
  }
  renderer.copyFramebufferToTexture(this.canvasCopy);
  this.material.uniforms.wlCanvas.value = this.canvasCopy;
  this.material.uniforms.wlCanvasRes.value.set(w, h);
  //The strip's width follows the canvas height, so it covers the same share of the view.
  this.material.uniforms.wlMenWidth.value = Math.max(0.5, this.meniscusWidthPx * h / 1080.0);
};

//Drawn by OceanGrid.tock onto the canvas (autoClear off).
ARestlessOcean.Passes.WaterlinePass.prototype.renderMask = function(renderer, camera){
  if(this.maskScene) renderer.render(this.maskScene, camera);
};
ARestlessOcean.Passes.WaterlinePass.prototype.renderOverlay = function(renderer, camera){
  if(this.overlayScene && this.active) renderer.render(this.overlayScene, camera);
};

//Per frame, before the main render. ctx: {band, under (the frame's state), airTexture
//(the transmission render, for the eye-under case), camera, murk, ceiling (Vector3s),
//extinction (Vector3), depthTexture, width, height}. band false hides it.
ARestlessOcean.Passes.WaterlinePass.prototype.prepare = function(ctx){
  if(!this.mesh) return;
  const hrp = this.oceanGrid.heightReadbackPass;
  const cam = ctx.camera;
  this.active = !!(ctx.band && cam && hrp);
  //The other medium's view, drawn for real by OceanGrid.tock: the air above the line with
  //the eye under, the water below it with the eye above.
  this.airPassActive = !!(this.active && ctx.under && ctx.airPass);
  this.waterPassActive = !!(this.active && !ctx.under && ctx.waterPass);
  if(this.active){
    const u = this.material.uniforms;
    if(!hrp.bindSurfaceUniforms(u, this.oceanGrid.globalCameraPosition.x, this.oceanGrid.globalCameraPosition.z)){
      this.active = false;
    } else {
      cam.updateMatrixWorld();
      u.wlInvViewProj.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
      cam.getWorldPosition(u.wlEye.value);
      cam.getWorldDirection(u.wlForward.value);
      u.wlDepth.value = ctx.depthTexture || null;
      u.wlDepthOn.value = ctx.depthTexture ? 1.0 : 0.0;
      u.wlResolution.value.set(Math.max(1, ctx.width), Math.max(1, ctx.height));
      if(ctx.murk) u.wlMurk.value.copy(ctx.murk);
      if(ctx.ceiling) u.wlCeiling.value.copy(ctx.ceiling);
      if(ctx.extinction) u.wlExtinction.value.copy(ctx.extinction);
      //With the real water pass on, the overlay draws only the meniscus on that side.
      u.wlCompositeOn.value = (ctx.composite === false || (!ctx.under && ctx.waterPass)) ? 0.0 : 1.0;
      u.wlMaskUnder.value = ctx.under ? 1.0 : 0.0;
      u.wlStateUnder.value = ctx.under ? 1.0 : 0.0;
      u.wlAirMode.value = this.airMode;
      u.wlAir.value = ctx.airTexture || null;
      //With the real air pass on, the overlay draws only the meniscus on that side.
      u.wlAirOn.value = (ctx.airTexture && !ctx.airPass) ? 1.0 : 0.0;
      u.wlViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      u.wlLineWidth.value = this.lineWidthPx;
      u.wlLineOpacity.value = this.lineOpacity;
      u.wlLineDarken.value = this.lineDarken;
      u.wlMaxFog.value = this.maxFogDistance;
      u.wlMenOn.value = this.meniscus ? 1.0 : 0.0;
      //Ring 0's cell (the fan's size); every ring snaps to it (OceanGrid, ringSnapX).
      //0 = the smooth field (oceanGrid.waterlineDrawnMesh = false, for A/B).
      const g = this.oceanGrid;
      u.wlMeshCell.value = (g.waterlineDrawnMesh !== false && g.patchSize > 0 && g.numCells > 0) ? g.patchSize / g.numCells : 0.0;
      u.wlMenTint.value.copy(this.meniscusTint);
      u.wlMenTintStrength.value = this.meniscusTintStrength;
    }
  }
};

//Visibility is its own call: OceanGrid hides it for every offscreen pass and
//shows it only for the main render, like the splash.
ARestlessOcean.Passes.WaterlinePass.prototype.setVisible = function(v){
  if(this.mesh) this.mesh.visible = !!(v && this.active);
};

ARestlessOcean.Passes.WaterlinePass.prototype.dispose = function(){
  if(this.mesh){
    if(this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh = null;
  }
  if(this.canvasCopy){
    this.canvasCopy.dispose();
    this.canvasCopy = null;
  }
  if(this.maskMaterial){
    this.maskScene.children.forEach(function(m){ m.geometry.dispose(); });
    this.maskMaterial.dispose();
    this.maskMaterial = null;
  }
};
