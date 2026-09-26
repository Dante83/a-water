//── UnderwaterVolumePass ────────────────────────────────────────────────────
//
//UNDERWATER-VOLUME.md, phase 1. The light the water scatters toward a submerged
//camera, computed in WORLD SPACE once per frame and sampled by every material
//that fogs underwater, so the seabed, the objects on it and the curtain all fade
//into the SAME lit water instead of one flat murk colour each.
//
//WHAT IT IS
//A froxel volume: screen x × screen y × depth slices along each camera ray,
//slices spaced by a power law (fine near the eye, coarse far away). Stored as a
//2D ATLAS of slices side by side, never a sampler3D: the fog chunk reaches every
//THREE material in the scene and a sampler3D would force GLSL3 on all of them
//(a-land's ObjectMaterial made the same call for its light probes).
//
//TWO DRAWS, both fullscreen over the atlas
//  inject     per froxel, at its world point P: is P in water (WaterField level
//             and depth), and how much light does it scatter toward the camera
//             (the sun beam refracted and attenuated down to P, through a
//             Henyey-Greenstein phase; the sky, isotropic; the multiple-scatter
//             glow). Radiance per metre of path.
//  integrate  per froxel, the in-scatter summed from the camera to the slice's FAR
//             face, each slice weighted by the exact integral of the transmittance
//             across it: (e^(-σ·a) − e^(-σ·b)) / σ. The medium is homogeneous, so
//             transmittance is analytic and lives in the consumers, per channel;
//             only the in-scatter, which varies in space, is stored.
//
//CONSUMERS
//  color · T(path) + uwVolumeInscatter(worldPos)
//The lookup is CONSUMER_GLSL below. Consumers must only trust it in the MAIN
//camera's pass: a mirror or capture pass renders from another eye, and the
//volume's froxels are this camera's. The lookup returns w = 0 when the rendering
//camera is not the volume's, and the consumer falls back to its analytic murk.
//
//NOT YET (later phases, UNDERWATER-VOLUME.md): shafts (the caustic at the
//surface crossing), the refracted-sun shadow, temporal jitter.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.UnderwaterVolumePass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  //Live knobs (console: oceanGrid.underwaterVolumePass.<knob>).
  this.enabled = true;
  this.width = 160;            //froxels across
  this.height = 90;            //froxels down
  this.depth = 64;             //slices (≤ MAX_SLICES)
  this.maxRangeM = 200.0;      //the volume ends at min(this, where 1% of the light survives)
  this.slicePower = 2.0;       //slice s ∈ [0,1] sits at range · s^power
  this.phaseG = 0.5;           //Henyey-Greenstein asymmetry of the sun term (matches UW_HG_G)
  this.gazeWeight = 1.0;       //1 = the physical sun halo; 0 = the old view-independent murk
  this.debugInscatterOnly = false; //consumers draw only the volume's light (like UW_DEBUG_FOG_MODE 3)
  this.active = false;

  this._alloc = null;          //{w, h, d, tilesX, tilesY} the targets were built for
  this.scatterTarget = null;
  this.integratedTarget = null;

  //SHARED uniform objects: every consumer material holds these same objects by
  //reference, so one write per frame reaches all of them.
  this.uniforms = {
    uwVolAtlas: {value: null},
    uwVolOn: {value: 0.0},                         //0 off, 1 on, 2 = debug: in-scatter only
    uwVolViewProj: {value: new THREE.Matrix4()},
    uwVolCam: {value: new THREE.Vector4()},        //(camera world xyz, range m)
    uwVolGrid: {value: new THREE.Vector4()},       //(froxels across, down, slices, tiles across)
    uwVolShape: {value: new THREE.Vector4()}       //(slice power, atlas w, atlas h, 0)
  };
};

ARestlessOcean.Passes.UnderwaterVolumePass.MAX_SLICES = 128;

//GLSL ES 1.00 (texture2D, so it compiles in every material the fog chunk reaches).
//`vec4 uwVolumeInscatter(vec3 worldPos)`: rgb = linear radiance scattered toward
//the camera between it and worldPos; w = 1 when valid, 0 = use the analytic murk.
//a-land carries a hand copy with its own u_ names (terrain.frag alandUwVolume):
//keep the two in step.
ARestlessOcean.Passes.UnderwaterVolumePass.CONSUMER_GLSL = [
  'uniform sampler2D uwVolAtlas;',
  'uniform float uwVolOn;',
  'uniform mat4 uwVolViewProj;',
  'uniform vec4 uwVolCam;',
  'uniform vec4 uwVolGrid;',
  'uniform vec4 uwVolShape;',
  'vec3 uwVolSlice(vec2 px, float k){',
  '  float ty = floor(k / uwVolGrid.w);',
  '  float tx = k - ty * uwVolGrid.w;',
  '  return texture2D(uwVolAtlas, (vec2(tx, ty) * uwVolGrid.xy + px) / uwVolShape.yz).rgb;',
  '}',
  'vec4 uwVolumeInscatter(vec3 worldPos){',
  '  if(uwVolOn < 0.5) return vec4(0.0);',
  //Only the volume's own camera (a stereo eye is within a few cm of it).
  '  if(length(cameraPosition - uwVolCam.xyz) > 0.25) return vec4(0.0);',
  '  vec4 clip = uwVolViewProj * vec4(worldPos, 1.0);',
  '  if(clip.w <= 1e-4) return vec4(0.0);',
  '  vec2 px = clamp((clip.xy / clip.w * 0.5 + 0.5) * uwVolGrid.xy, vec2(0.5), uwVolGrid.xy - 0.5);',
  '  float s = pow(clamp(length(worldPos - uwVolCam.xyz) / uwVolCam.w, 0.0, 1.0), 1.0 / uwVolShape.x);',
  //Slice k holds the light up to its FAR face, s = (k + 1) / D.
  '  float c = s * uwVolGrid.z - 1.0;',
  '  if(c < 0.0) return vec4(uwVolSlice(px, 0.0) * (c + 1.0), 1.0);',
  '  float k0 = floor(c);',
  '  float k1 = min(k0 + 1.0, uwVolGrid.z - 1.0);',
  '  return vec4(mix(uwVolSlice(px, k0), uwVolSlice(px, k1), c - k0), 1.0);',
  '}'
].join('\n');

ARestlessOcean.Passes.UnderwaterVolumePass.prototype.init = function(){
  const WF = ARestlessOcean.Passes.WaterFieldPass;
  const MAXS = ARestlessOcean.Passes.UnderwaterVolumePass.MAX_SLICES;
  const quadVert = [
    'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');
  //Which froxel this atlas texel is: its slice k, and its pixel inside the slice.
  const froxelGLSL = [
    'uniform vec4 uGrid;',      //(w, h, d, tiles across)
    'uniform vec4 uShape;',     //(range m, slice power, 0, 0)
    'bool froxelAt(ivec2 p, out int k, out ivec2 px){',
    '  int W = int(uGrid.x), H = int(uGrid.y);',
    '  int tx = p.x / W, ty = p.y / H;',
    '  k = ty * int(uGrid.w) + tx;',
    '  px = ivec2(p.x - tx * W, p.y - ty * H);',
    '  return k < int(uGrid.z);',
    '}',
    'float sliceDistance(float s){ return uShape.x * pow(s, uShape.y); }'
  ].join('\n');

  const fieldUniforms = WF.createSampleUniforms();
  this.injectMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: Object.assign(fieldUniforms, {
      uGrid: {value: new THREE.Vector4()},
      uShape: {value: new THREE.Vector4()},
      uInvProj: {value: new THREE.Matrix4()},
      uCamWorld: {value: new THREE.Matrix4()},
      uCamPos: {value: new THREE.Vector3()},
      uFieldOn: {value: 0.0},
      uFallbackLevel: {value: 0.0},
      uScattering: {value: new THREE.Vector3()},
      uExtinction: {value: new THREE.Vector3()},
      uRInf: {value: new THREE.Vector3()},
      uSunWater: {value: new THREE.Vector3(0, -1, 0)},   //the direction the refracted sun TRAVELS
      uSunBeam: {value: new THREE.Vector3()},            //its irradiance across the beam, just below the surface
      uSunDown: {value: new THREE.Vector3()},            //its irradiance on a level plane, just below the surface
      uSkyDown: {value: new THREE.Vector3()},            //the sky's, on a level plane
      uPhase: {value: new THREE.Vector2(0.5, 1.0)}       //(HG g, gaze weight)
    }),
    vertexShader: quadVert,
    fragmentShader: [
      'precision highp float;',
      'layout(location = 0) out vec4 oScatter;',
      WF.SAMPLE_GLSL,
      froxelGLSL,
      'uniform mat4 uInvProj, uCamWorld;',
      'uniform vec3 uCamPos;',
      'uniform float uFieldOn, uFallbackLevel;',
      'uniform vec3 uScattering, uExtinction, uRInf, uSunWater, uSunBeam, uSunDown, uSkyDown;',
      'uniform vec2 uPhase;',
      'const float PI = 3.14159265359;',
      'const float INV_4PI = 0.07957747154;',
      'float hg(float c, float g){',
      '  float g2 = g * g;',
      '  return (1.0 - g2) * INV_4PI / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);',
      '}',
      //In-scattered radiance per metre at P toward the camera, looking along viewDir.
      'vec3 scatterAt(vec3 P, vec3 viewDir){',
      '  float level = uFallbackLevel;',
      '  float column = 1.0;',
      '  if(uFieldOn > 0.5){ vec4 f = waterFieldAt(P.xz); level = f.r; column = f.g; }',
      '  float d = level - P.y;',                      //metres below the still surface
      '  if(d <= 0.0 || column <= 0.0 || d > column) return vec3(0.0);', //air, dry ground, under the bed
      '  float cw = max(-uSunWater.y, 0.05);',
      '  vec3 sunAtP = exp(-uExtinction * d / cw);',    //down the slanted beam
      '  vec3 skyAtP = exp(-uExtinction * d);',         //diffuse light, straight down
      //cos θ between the light's travel and the scattered ray back to the eye (−viewDir).
      '  float p = mix(INV_4PI, hg(-dot(viewDir, uSunWater), uPhase.x), uPhase.y);',
      '  vec3 single = uScattering * (uSunBeam * sunAtP * p + uSkyDown * skyAtP / (2.0 * PI));',
      //The multiple-scatter glow: R∞ of the total downwelling, spread Lambertian (as
      //underwaterInscatterSurface), as an emission that integrates to it over a long path.
      '  vec3 multi = uExtinction * uRInf * (uSunDown * sunAtP + uSkyDown * skyAtP) / PI;',
      '  return single + multi;',
      '}',
      'void main(){',
      '  int k; ivec2 px;',
      '  if(!froxelAt(ivec2(gl_FragCoord.xy), k, px)){ oScatter = vec4(0.0); return; }',
      '  vec2 ndc = (vec2(px) + 0.5) / uGrid.xy * 2.0 - 1.0;',
      '  vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);',
      '  vec3 dir = normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);',
      '  float t0 = sliceDistance(float(k) / uGrid.z);',
      '  float t1 = sliceDistance(float(k + 1) / uGrid.z);',
      '  oScatter = vec4(scatterAt(uCamPos + dir * (0.5 * (t0 + t1)), dir), 1.0);',
      '}'
    ].join('\n'),
    depthTest: false, depthWrite: false
  });

  this.integrateMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uScatter: {value: null},
      uGrid: {value: new THREE.Vector4()},
      uShape: {value: new THREE.Vector4()},
      uExtinction: {value: new THREE.Vector3()}
    },
    vertexShader: quadVert,
    fragmentShader: [
      'precision highp float;',
      'precision highp sampler2D;',
      'layout(location = 0) out vec4 oLight;',
      'uniform sampler2D uScatter;',
      'uniform vec3 uExtinction;',
      froxelGLSL,
      'void main(){',
      '  int k; ivec2 px;',
      '  if(!froxelAt(ivec2(gl_FragCoord.xy), k, px)){ oLight = vec4(0.0); return; }',
      '  int W = int(uGrid.x), H = int(uGrid.y), TX = int(uGrid.w);',
      '  vec3 sum = vec3(0.0);',
      '  vec3 ta = vec3(1.0);',                        //transmittance at the slice's near face
      '  for(int j = 0; j < ' + MAXS + '; ++j){',
      '    if(j > k) break;',
      '    float b = sliceDistance(float(j + 1) / uGrid.z);',
      '    vec3 tb = exp(-uExtinction * b);',
      '    ivec2 at = ivec2((j - (j / TX) * TX) * W, (j / TX) * H) + px;',
      '    sum += texelFetch(uScatter, at, 0).rgb * (ta - tb) / uExtinction;',
      '    ta = tb;',
      '  }',
      '  oLight = vec4(sum, 1.0);',
      '}'
    ].join('\n'),
    depthTest: false, depthWrite: false
  });

  this._scene = new THREE.Scene();
  this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.injectMaterial);
  this._quad.frustumCulled = false;
  this._scene.add(this._quad);
  this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
};

//(Re)build the two atlases when the froxel counts change.
ARestlessOcean.Passes.UnderwaterVolumePass.prototype._ensureTargets = function(){
  const w = Math.max(1, this.width | 0), h = Math.max(1, this.height | 0);
  const d = Math.max(1, Math.min(this.depth | 0, ARestlessOcean.Passes.UnderwaterVolumePass.MAX_SLICES));
  const a = this._alloc;
  if(a && a.w === w && a.h === h && a.d === d) return a;
  if(this.scatterTarget){ this.scatterTarget.dispose(); this.integratedTarget.dispose(); }
  const tilesX = Math.ceil(Math.sqrt(d));
  const tilesY = Math.ceil(d / tilesX);
  //Float (radeonsi samples half-float targets wrongly, see FlowFoamPass). The
  //integrated atlas is read bilinearly by the consumers when the extension allows.
  const canFilterFloat = !!(this.renderer.extensions && this.renderer.extensions.has('OES_texture_float_linear'));
  const make = function(filter){
    return new THREE.WebGLRenderTarget(w * tilesX, h * tilesY, {
      minFilter: filter, magFilter: filter, format: THREE.RGBAFormat, type: THREE.FloatType,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping
    });
  };
  this.scatterTarget = make(THREE.NearestFilter);
  this.integratedTarget = make(canFilterFloat ? THREE.LinearFilter : THREE.NearestFilter);
  this._alloc = {w: w, h: h, d: d, tilesX: tilesX, tilesY: tilesY};
  return this._alloc;
};

//ctx: {camera, sunWater (refracted, the direction it travels), sunColor (colour ×
//intensity, above the water), absorption, scattering (1/m, Vector3-like), skyDown
//(the sky's level-plane irradiance, Vector3-like), fallbackLevel (still level
//when there is no field)}. Call only while the viewer is submerged; stand() off otherwise.
ARestlessOcean.Passes.UnderwaterVolumePass.prototype.tick = function(ctx){
  const U = this.uniforms;
  if(!this.enabled || !this.injectMaterial || !ctx || !ctx.camera){ U.uwVolOn.value = 0.0; this.active = false; return; }
  const al = this._ensureTargets();
  const cam = ctx.camera;
  cam.updateWorldMatrix(true, false);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

  const ab = ctx.absorption, sc = ctx.scattering;
  const ex = Math.max(ab.x + sc.x, 1e-4), ey = Math.max(ab.y + sc.y, 1e-4), ez = Math.max(ab.z + sc.z, 1e-4);
  const rInf = function(s, e){
    const q = Math.sqrt(Math.max(1.0 - s / e, 0.0));
    return (1.0 - q) / (1.0 + q);
  };
  //Where 1% of the light survives, along the clearest channel.
  const range = Math.max(1.0, Math.min(this.maxRangeM, Math.log(100.0) / Math.min(ex, ey, ez)));

  //The sun just below the surface. Schlick at the AIR angle (as the murk always has);
  //across the beam the refracted flux is squeezed by cos θair / cos θwater.
  const sw = ctx.sunWater, col = ctx.sunColor;
  const cosA = ctx.sunCosAir !== undefined ? Math.max(ctx.sunCosAir, 0.0) : 0.0;
  const cosW = Math.max(-sw.y, 0.05);
  const om = 1.0 - cosA;
  const trans = cosA > 0.0 ? 1.0 - (0.02037 + (1.0 - 0.02037) * om * om * om * om * om) : 0.0;
  const down = trans * cosA, beam = down / cosW;

  const I = this.injectMaterial.uniforms;
  const fieldOn = !!(this.oceanGrid.waterFieldPass && this.oceanGrid.waterFieldPass.bindUniforms(I));
  I.uFieldOn.value = fieldOn ? 1.0 : 0.0;
  I.uFallbackLevel.value = ctx.fallbackLevel || 0.0;
  I.uGrid.value.set(al.w, al.h, al.d, al.tilesX);
  I.uShape.value.set(range, this.slicePower, 0, 0);
  I.uInvProj.value.copy(cam.projectionMatrixInverse);
  I.uCamWorld.value.copy(cam.matrixWorld);
  I.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
  I.uScattering.value.set(sc.x, sc.y, sc.z);
  I.uExtinction.value.set(ex, ey, ez);
  I.uRInf.value.set(rInf(sc.x, ex), rInf(sc.y, ey), rInf(sc.z, ez));
  I.uSunWater.value.set(sw.x, sw.y, sw.z);
  I.uSunBeam.value.set(col.x * beam, col.y * beam, col.z * beam);
  I.uSunDown.value.set(col.x * down, col.y * down, col.z * down);
  I.uSkyDown.value.set(ctx.skyDown.x, ctx.skyDown.y, ctx.skyDown.z);
  I.uPhase.value.set(this.phaseG, this.gazeWeight);

  const G = this.integrateMaterial.uniforms;
  G.uScatter.value = this.scatterTarget.texture;
  G.uGrid.value.copy(I.uGrid.value);
  G.uShape.value.copy(I.uShape.value);
  G.uExtinction.value.copy(I.uExtinction.value);

  const prevRT = this.renderer.getRenderTarget();
  const prevXr = this.renderer.xr ? this.renderer.xr.enabled : false;
  if(this.renderer.xr) this.renderer.xr.enabled = false;
  this._quad.material = this.injectMaterial;
  this.renderer.setRenderTarget(this.scatterTarget);
  this.renderer.render(this._scene, this._camera);
  this._quad.material = this.integrateMaterial;
  this.renderer.setRenderTarget(this.integratedTarget);
  this.renderer.render(this._scene, this._camera);
  this.renderer.setRenderTarget(prevRT);
  if(this.renderer.xr) this.renderer.xr.enabled = prevXr;

  U.uwVolAtlas.value = this.integratedTarget.texture;
  U.uwVolViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  U.uwVolCam.value.set(I.uCamPos.value.x, I.uCamPos.value.y, I.uCamPos.value.z, range);
  U.uwVolGrid.value.copy(I.uGrid.value);
  U.uwVolShape.value.set(this.slicePower, al.w * al.tilesX, al.h * al.tilesY, 0);
  U.uwVolOn.value = this.debugInscatterOnly ? 2.0 : 1.0;
  this.active = true;
};

//The viewer surfaced (or the volume is off): every consumer falls back.
ARestlessOcean.Passes.UnderwaterVolumePass.prototype.stand = function(){
  this.uniforms.uwVolOn.value = 0.0;
  this.active = false;
};

//The shared uniforms for a sibling (a-land's setOceanFog volume), or null when off.
ARestlessOcean.Passes.UnderwaterVolumePass.prototype.handover = function(){
  if(!this.active) return null;
  const U = this.uniforms;
  return {
    atlas: U.uwVolAtlas.value, viewProj: U.uwVolViewProj.value, cam: U.uwVolCam.value,
    grid: U.uwVolGrid.value, shape: U.uwVolShape.value, debugInscatterOnly: this.debugInscatterOnly
  };
};

ARestlessOcean.Passes.UnderwaterVolumePass.prototype.resize = function(){};

ARestlessOcean.Passes.UnderwaterVolumePass.prototype.dispose = function(){
  if(this.scatterTarget){ this.scatterTarget.dispose(); this.integratedTarget.dispose(); }
  this.scatterTarget = this.integratedTarget = null;
  this._alloc = null;
  if(this.injectMaterial) this.injectMaterial.dispose();
  if(this.integrateMaterial) this.integrateMaterial.dispose();
  if(this._quad) this._quad.geometry.dispose();
};
