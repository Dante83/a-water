//── UnderwaterVolumePass ────────────────────────────────────────────────────
//
//UNDERWATER-VOLUME.md. The light the water scatters toward a submerged camera,
//computed in WORLD SPACE once per frame and sampled by every material that fogs
//underwater, so the seabed, the objects on it and the curtain all fade into the
//SAME lit water instead of one flat murk colour each.
//
//WHAT IT IS
//A froxel volume: screen x × screen y × depth slices along each camera ray,
//slices spaced by a power law (fine near the eye, coarse far away). Stored as a
//2D ATLAS of slices side by side, never a sampler3D: the fog chunk reaches every
//THREE material in the scene and a sampler3D would force GLSL3 on all of them
//(a-land's ObjectMaterial made the same call for its light probes).
//
//TWO DRAWS, both fullscreen over the atlas
//  inject     per froxel, at a jittered world point P in it: the light P scatters
//             toward the camera, radiance per metre of path:
//               sun    the refracted beam, attenuated down its slanted path to P,
//                      through a Henyey-Greenstein phase, × the SHAFTS (the caustic
//                      pattern where P's sun ray crossed the surface, the web the
//                      seabed gets, so the shafts land on the floor's caustics) ×
//                      the SHADOW there (a-land's WaterLightField: is the water at
//                      that crossing in sun).
//               sky    isotropic, attenuated straight down to P.
//               glow   multiple scatter, R∞ of both (sun part shadowed by the
//                      sunlit fraction of the water around, not at a point).
//             × the fog TEXTURE (a look term, see textureAmplitude).
//             Then blended with last frame's value at the same world point
//             (reprojected), which turns the jitter into a smooth average.
//  integrate  per froxel, the in-scatter summed from the camera to the slice's FAR
//             face, each slice weighted by the exact integral of the transmittance
//             across it: (e^(-σ·a) − e^(-σ·b)) / σ. The medium is homogeneous, so
//             transmittance is analytic and lives in the consumers, per channel;
//             only the in-scatter, which varies in space, is stored.
//
//NO POINT IS ZEROED. A froxel above the still level or under the bed scatters as
//if at the surface / at its depth: the slice that straddles the seabed or the
//surface then changes smoothly with the camera. Zeroing it (phase 1) flipped whole
//froxel columns lit/unlit as the camera moved. Only rays that stop at a fragment
//are ever read, and those stop at the bed and the surface anyway.
//
//CONSUMERS
//  color · T(path) + uwVolumeInscatter(worldPos)
//The lookup is CONSUMER_GLSL below. Consumers must only trust it in the MAIN
//camera's pass: a mirror or capture pass renders from another eye, and the
//volume's froxels are this camera's. The lookup returns w = 0 when the rendering
//camera is not the volume's, and the consumer falls back to its analytic murk.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.UnderwaterVolumePass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  //Live knobs (console: oceanGrid.underwaterVolumePass.<knob>).
  this.enabled = true;
  this.width = 320;            //froxels across (320x180: sharp enough to read the shafts, Dante 2026-09-26)
  this.height = 180;           //froxels down
  this.depth = 64;             //slices (≤ MAX_SLICES)
  this.maxRangeM = 200.0;      //the volume ends at min(this, where 1% of the light survives)
  this.slicePower = 2.0;       //slice s ∈ [0,1] sits at range · s^power
  this.phaseG = 0.5;           //Henyey-Greenstein asymmetry of the sun term (matches UW_HG_G)
  this.gazeWeight = 1.0;       //1 = the physical sun halo; 0 = the old view-independent murk
  this.shaftStrength = 5.0;    //the caustic on the sun beam: 1 = the seabed web contrast, 0 = none (5: a look choice, Dante 2026-09-26)
  //Smallest caustic cell the SHAFTS use (the seabed keeps its own). A view ray drifts across the
  //web as it goes deeper and the integral averages whatever cells it crosses, so fine cells
  //cancel to a flat dimming; shafts are the coarse part of the web. A look knob.
  this.shaftCellM = 2.0;
  this.shadow = true;          //the sun's visibility where the beam entered (a-land's WaterLightField)
  this.glowShadowRadiusM = 10.0; //the glow's shadow: the sunlit fraction of the water this far around
  //FOG TEXTURE: a LOOK TERM, not physics (flagged per convention). Real water is patchy
  //(plankton, silt, bubbles), but nothing here measures where; this is a drifting world-space
  //noise on the scattering coefficient. 0 = the homogeneous, physical medium.
  this.textureAmplitude = 0.3; //±fraction of the scattering it varies by
  this.textureScaleM = 8.0;    //size of the patches
  this.textureDrift = new THREE.Vector3(0.08, 0.03, 0.05);  //m/s the patches drift
  this.jitter = true;          //jitter each froxel's sample point every frame...
  this.historyWeight = 0.6;    //...and blend with the reprojected last frame (0 = no history; higher = smoother, softer)
  this.debugInscatterOnly = false; //consumers draw only the volume's light (like UW_DEBUG_FOG_MODE 3)
  this.active = false;

  this._alloc = null;          //{w, h, d, tilesX, tilesY} the targets were built for
  this.scatterTargets = null;  //ping-pong: this frame's blended scatter, last frame's (history)
  this._write = 0;
  this.integratedTarget = null;
  this._frame = 0;
  this._causticMean = null;    //{map, mean}: the web's measured average (see _measureCausticMean)
  this._historyValid = false;
  this._prevViewProj = new THREE.Matrix4();
  this._prevCam = new THREE.Vector4();

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
//a-land carries a hand copy with its own u_ names (terrain.frag alandUwVolume), and
//so does the water shader: keep the three in step.
ARestlessOcean.Passes.UnderwaterVolumePass.CONSUMER_GLSL = [
  //Declared once per program: the water shader carries its own copy under the same guard.
  '#ifndef ARO_UWVOL_DECLARED',
  '#define ARO_UWVOL_DECLARED',
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
  '}',
  '#endif'
].join('\n');

ARestlessOcean.Passes.UnderwaterVolumePass.prototype.init = function(){
  const WF = ARestlessOcean.Passes.WaterFieldPass;
  const MAXS = ARestlessOcean.Passes.UnderwaterVolumePass.MAX_SLICES;
  const quadVert = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
  //Which froxel this atlas texel is: its slice k, and its pixel inside the slice.
  const froxelGLSL = [
    'uniform vec4 uGrid;',      //(w, h, d, tiles across)
    'uniform vec4 uShape;',     //(range m, slice power, atlas w, atlas h)
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
      uFroxelAngle: {value: 0.01},                       //radians per froxel, vertically
      uFieldOn: {value: 0.0},
      uFallbackLevel: {value: 0.0},
      uScattering: {value: new THREE.Vector3()},
      uExtinction: {value: new THREE.Vector3()},
      uRInf: {value: new THREE.Vector3()},
      uSunWater: {value: new THREE.Vector3(0, -1, 0)},   //the direction the refracted sun TRAVELS
      uSunBeam: {value: new THREE.Vector3()},            //its irradiance across the beam, just below the surface
      uSunDown: {value: new THREE.Vector3()},            //its irradiance on a level plane, just below the surface
      uSkyDown: {value: new THREE.Vector3()},            //the sky's, on a level plane
      uPhase: {value: new THREE.Vector2(0.5, 1.0)},      //(HG g, gaze weight)
      //Shafts: a-water's caustic model (CAUSTIC_MODEL; a-land's alandCausticPattern, grey).
      uCausticMap: {value: null},
      uCausticMeanTex: {value: null},                    //1×1: the web's measured mean (uCausticShape.y < 0 = use it)
      uCausticTime: {value: 0.0},
      uCausticShape: {value: new THREE.Vector4()},       //(amplitude × shaftStrength, texture mean, contrast depth, focus)
      uCausticScale: {value: new THREE.Vector4()},       //(base UV, tile per depth, min tile, map size px)
      //Shadow: a-land's WaterLightField (R = water × sun visibility, G = water, mip-mapped).
      uLightMap: {value: null},
      uLightFrame: {value: new THREE.Vector4()},         //(centre x, centre z, half-width m, map size px); hw 0 = none
      uGlowRadius: {value: 10.0},
      uTexture: {value: new THREE.Vector4()},            //(amplitude, 1 / scale m, 0, 0)
      uTexOffset: {value: new THREE.Vector3()},
      uJitter: {value: new THREE.Vector3()},             //per-frame phase (x, y, depth); 0.5 = centre
      //History: last frame's blended scatter, and where its froxels were.
      uHistory: {value: null},
      uHistoryWeight: {value: 0.0},
      uPrevViewProj: {value: new THREE.Matrix4()},
      uPrevCam: {value: new THREE.Vector4()}
    }),
    vertexShader: quadVert,
    fragmentShader: [
      'precision highp float;',
      'precision highp sampler2D;',
      'layout(location = 0) out vec4 oScatter;',
      WF.SAMPLE_GLSL,
      froxelGLSL,
      'uniform mat4 uInvProj, uCamWorld, uPrevViewProj;',
      'uniform vec3 uCamPos;',
      'uniform float uFroxelAngle, uFieldOn, uFallbackLevel, uCausticTime, uGlowRadius, uHistoryWeight;',
      'uniform vec3 uScattering, uExtinction, uRInf, uSunWater, uSunBeam, uSunDown, uSkyDown, uTexOffset, uJitter;',
      'uniform vec2 uPhase;',
      'uniform vec4 uCausticShape, uCausticScale, uLightFrame, uTexture, uPrevCam;',
      'uniform sampler2D uCausticMap, uCausticMeanTex, uLightMap, uHistory;',
      'const float PI = 3.14159265359;',
      'const float INV_4PI = 0.07957747154;',
      'float hg(float c, float g){',
      '  float g2 = g * g;',
      '  return (1.0 - g2) * INV_4PI / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);',
      '}',
      //── shafts: the caustic web where the ray crossed the surface ──
      //a-land's alandCausticPattern (grey: in-scatter does not disperse enough to see). Explicit
      //LOD from the froxel's footprint, so a far froxel reads the web pre-averaged instead of
      //aliasing (and so the atlas's tile seams cannot pick a garbage mip).
      'float causticTap(vec2 uv, float lod){',
      '  float tm = uCausticTime / 8.0;',
      '  return min(textureLod(uCausticMap, uv + vec2(0.8, 0.1) * tm, lod).r,',
      '             textureLod(uCausticMap, uv - vec2(0.2, 0.7) * tm, lod).g);',
      '}',
      'float causticPattern(vec2 pxz, float path, float footM){',
      '  float baseUV = uCausticScale.x;',
      '  float tile = clamp(uCausticScale.y * path, uCausticScale.z, 1.0 / baseUV);',
      '  float level = log2(1.0 / (tile * baseUV));',
      '  float l0 = floor(level), lt = level - l0;',
      '  float raw = 0.0;',
      '  for(int k = 0; k < 2; ++k){',
      '    float s = baseUV * exp2(l0 + float(k));',
      '    float lod = log2(max(footM * s * uCausticScale.w, 1.0));',
      '    raw += (k == 0 ? 1.0 - lt : lt) * causticTap(s * pxz, lod);',
      '  }',
      '  float c = smoothstep(0.0, 1.0, raw);',
      '  float fade = exp(-path / uCausticShape.z) * smoothstep(0.0, uCausticShape.w, path);',
      '  float mean = uCausticShape.y < 0.0 ? texelFetch(uCausticMeanTex, ivec2(0), 0).r : uCausticShape.y;',
      '  return max(0.0, 1.0 + fade * uCausticShape.x * (c - mean));',
      '}',
      //── shadow: the sunlit fraction of the water around xz ──
      'float sunlitAt(vec2 xz, float radiusM){',
      '  if(uLightFrame.z <= 0.0) return 1.0;',
      '  vec2 uv = (xz - uLightFrame.xy) / (2.0 * uLightFrame.z) + 0.5;',
      '  if(any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;',
      '  float texelM = 2.0 * uLightFrame.z / uLightFrame.w;',
      '  vec2 m = textureLod(uLightMap, uv, log2(max(radiusM / texelM, 1.0))).rg;',
      '  return m.y > 0.01 ? clamp(m.x / m.y, 0.0, 1.0) : 1.0;',
      '}',
      //── fog texture (a look term) ──
      'float hash31(vec3 p){',
      '  p = fract(p * 0.1031);',
      '  p += dot(p, p.zyx + 31.32);',
      '  return fract((p.x + p.y) * p.z);',
      '}',
      'float vnoise(vec3 x){',
      '  vec3 i = floor(x), f = fract(x);',
      '  f = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),',
      '             mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);',
      '}',
      'float fogTexture(vec3 P){',
      '  if(uTexture.x <= 0.0) return 1.0;',
      '  vec3 q = P * uTexture.y + uTexOffset;',
      '  float n = 0.5 * vnoise(q) + 0.3 * vnoise(q * 2.03 + 17.1) + 0.2 * vnoise(q * 4.11 + 5.3);',
      '  return max(0.0, 1.0 + uTexture.x * (2.0 * n - 1.0));',
      '}',
      //In-scattered radiance per metre at P toward the camera, looking along viewDir. footM:
      //the froxel's width there.
      'vec3 scatterAt(vec3 P, vec3 viewDir, float footM){',
      '  float level = uFieldOn > 0.5 ? waterFieldAt(P.xz).r : uFallbackLevel;',
      '  float d = max(level - P.y, 0.0);',             //metres below the still surface
      '  float cw = max(-uSunWater.y, 0.05);',
      '  vec3 sunAtP = exp(-uExtinction * d / cw);',    //down the slanted beam
      '  vec3 skyAtP = exp(-uExtinction * d);',         //diffuse light, straight down
      '  vec2 S = P.xz - uSunWater.xz * (d / cw);',     //where P's sun ray crossed the surface
      '  float beam = 1.0, glow = 1.0;',
      '  if(uLightFrame.z > 0.0){ beam = sunlitAt(S, 1.0); glow = sunlitAt(S, uGlowRadius); }',
      '  if(uCausticShape.x > 0.0) beam *= causticPattern(S, d / cw, footM);',
      //cos θ between the light's travel and the scattered ray back to the eye (−viewDir).
      '  float p = mix(INV_4PI, hg(-dot(viewDir, uSunWater), uPhase.x), uPhase.y);',
      '  vec3 single = uScattering * (uSunBeam * sunAtP * (p * beam) + uSkyDown * skyAtP / (2.0 * PI));',
      //The multiple-scatter glow: R∞ of the total downwelling, spread Lambertian (as
      //underwaterInscatterSurface), as an emission that integrates to it over a long path.
      '  vec3 multi = uExtinction * uRInf * (uSunDown * sunAtP * glow + uSkyDown * skyAtP) / PI;',
      '  return (single + multi) * fogTexture(P);',
      '}',
      //Last frame's blended scatter at world point P (its froxel centres: slice k at s = (k+½)/D).
      'bool historyAt(vec3 P, out vec3 h){',
      '  h = vec3(0.0);',
      '  if(uHistoryWeight <= 0.0) return false;',
      '  vec4 clip = uPrevViewProj * vec4(P, 1.0);',
      '  if(clip.w <= 1e-4) return false;',
      '  vec2 uv = clip.xy / clip.w * 0.5 + 0.5;',
      '  if(any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return false;',
      '  vec2 px = clamp(uv * uGrid.xy, vec2(0.5), uGrid.xy - 0.5);',
      '  float s = pow(clamp(length(P - uPrevCam.xyz) / uPrevCam.w, 0.0, 1.0), 1.0 / uShape.y);',
      '  float c = clamp(s * uGrid.z - 0.5, 0.0, uGrid.z - 1.0);',
      '  float k0 = floor(c), k1 = min(k0 + 1.0, uGrid.z - 1.0);',
      '  vec2 t0 = vec2(k0 - floor(k0 / uGrid.w) * uGrid.w, floor(k0 / uGrid.w));',
      '  vec2 t1 = vec2(k1 - floor(k1 / uGrid.w) * uGrid.w, floor(k1 / uGrid.w));',
      '  h = mix(textureLod(uHistory, (t0 * uGrid.xy + px) / uShape.zw, 0.0).rgb,',
      '          textureLod(uHistory, (t1 * uGrid.xy + px) / uShape.zw, 0.0).rgb, c - k0);',
      '  return true;',
      '}',
      //Interleaved gradient noise (Jimenez): a per-froxel offset for the per-frame jitter.
      'float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }',
      'void main(){',
      '  int k; ivec2 px;',
      '  if(!froxelAt(ivec2(gl_FragCoord.xy), k, px)){ oScatter = vec4(0.0); return; }',
      '  vec2 fp = vec2(px);',
      '  vec2 jxy = fract(vec2(ign(fp + 17.0), ign(fp + 43.0)) + uJitter.xy) - 0.5;',
      '  float jz = fract(ign(fp) + uJitter.z);',
      '  vec2 ndc = (fp + 0.5 + jxy) / uGrid.xy * 2.0 - 1.0;',
      '  vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);',
      '  vec3 dir = normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);',
      '  float t0 = sliceDistance(float(k) / uGrid.z);',
      '  float t1 = sliceDistance(float(k + 1) / uGrid.z);',
      '  float t = mix(t0, t1, jz);',
      '  vec3 P = uCamPos + dir * t;',
      '  vec3 cur = scatterAt(P, dir, max(t * uFroxelAngle, 1e-3));',
      '  vec3 h;',
      '  if(historyAt(P, h)) cur = mix(cur, h, uHistoryWeight);',
      '  oScatter = vec4(cur, 1.0);',
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

//The average of smoothstep(web) over the plane, measured ONCE per caustic map on the GPU (the
//same sampler, filtering and two-scroll min the shader uses; 4096 samples over many cells and
//scroll phases) into a 1×1 target the inject shader reads directly. No CPU readback: float
//readbacks come back empty on some drivers (and did in headless Chrome). Returns the target's
//texture, or null until the map has loaded (the shader then uses the model's constant).
ARestlessOcean.Passes.UnderwaterVolumePass.prototype._measureCausticMean = function(map, CM){
  const cached = this._causticMean;
  if(cached && cached.map === map) return cached.target.texture;
  if(!map || !map.image || !(map.image.width > 0)) return null;
  if(cached) cached.target.dispose();
  const rt = new THREE.WebGLRenderTarget(1, 1, {type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false});
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {uMap: {value: map}},
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'precision highp float;',
      'layout(location = 0) out vec4 o;',
      'uniform sampler2D uMap;',
      'float tap(vec2 uv, float tm){ return min(textureLod(uMap, uv + vec2(0.8, 0.1) * tm, 0.0).r, textureLod(uMap, uv - vec2(0.2, 0.7) * tm, 0.0).g); }',
      'void main(){',
      '  float sum = 0.0;',
      '  for(int i = 0; i < 4096; ++i){',
      //Irrational strides so the samples spread over many tiles and scroll phases.
      '    vec2 p = vec2(float(i % 64), float(i / 64));',
      '    vec2 uv = p * vec2(0.1373, 0.1719) + vec2(p.y * 0.0311, p.x * 0.0257);',
      '    float tm = fract(dot(p, vec2(0.0123, 0.0371))) * 40.0;',
      '    sum += smoothstep(0.0, 1.0, 0.5 * tap(uv, tm) + 0.5 * tap(uv * 2.0 + 0.37, tm));',
      '  }',
      '  o = vec4(sum / 4096.0, 0.0, 0.0, 1.0);',
      '}'
    ].join('\n'),
    depthTest: false, depthWrite: false
  });
  const prevMat = this._quad.material;
  this._quad.material = mat;
  const prevRT = this.renderer.getRenderTarget();
  this.renderer.setRenderTarget(rt);
  this.renderer.render(this._scene, this._camera);
  this.renderer.setRenderTarget(prevRT);
  this._quad.material = prevMat;
  mat.dispose();
  this._causticMean = {map: map, target: rt};
  return rt.texture;
};

//(Re)build the atlases when the froxel counts change.
ARestlessOcean.Passes.UnderwaterVolumePass.prototype._ensureTargets = function(){
  const w = Math.max(1, this.width | 0), h = Math.max(1, this.height | 0);
  const d = Math.max(1, Math.min(this.depth | 0, ARestlessOcean.Passes.UnderwaterVolumePass.MAX_SLICES));
  const a = this._alloc;
  if(a && a.w === w && a.h === h && a.d === d) return a;
  this._disposeTargets();
  const tilesX = Math.ceil(Math.sqrt(d));
  const tilesY = Math.ceil(d / tilesX);
  //Float (radeonsi samples half-float targets wrongly, see FlowFoamPass), filtered when the
  //extension allows: the consumers and the history read them bilinearly.
  const canFilterFloat = !!(this.renderer.extensions && this.renderer.extensions.has('OES_texture_float_linear'));
  const filter = canFilterFloat ? THREE.LinearFilter : THREE.NearestFilter;
  const make = function(){
    return new THREE.WebGLRenderTarget(w * tilesX, h * tilesY, {
      minFilter: filter, magFilter: filter, format: THREE.RGBAFormat, type: THREE.FloatType,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping
    });
  };
  this.scatterTargets = [make(), make()];
  this.integratedTarget = make();
  this._alloc = {w: w, h: h, d: d, tilesX: tilesX, tilesY: tilesY};
  this._historyValid = false;
  return this._alloc;
};

ARestlessOcean.Passes.UnderwaterVolumePass.prototype._disposeTargets = function(){
  if(this.scatterTargets){ this.scatterTargets[0].dispose(); this.scatterTargets[1].dispose(); }
  if(this.integratedTarget) this.integratedTarget.dispose();
  this.scatterTargets = this.integratedTarget = null;
  this._alloc = null;
};

//ctx: {camera, time (s), sunWater (refracted, the direction it travels), sunColor (colour ×
//intensity, above the water), sunCosAir, absorption, scattering (1/m, Vector3-like), skyDown
//(the sky's level-plane irradiance), fallbackLevel (still level when there is no field),
//causticMap, causticModel (ARestlessOcean.CAUSTIC_MODEL), causticTime (s),
//waterLight ({map, frame} from a-land, or null)}. Call only while the viewer is submerged;
//stand() otherwise.
ARestlessOcean.Passes.UnderwaterVolumePass.prototype.tick = function(ctx){
  const U = this.uniforms;
  if(!this.enabled || !this.injectMaterial || !ctx || !ctx.camera){ this.stand(); return; }
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
  I.uShape.value.set(range, this.slicePower, al.w * al.tilesX, al.h * al.tilesY);
  I.uInvProj.value.copy(cam.projectionMatrixInverse);
  I.uCamWorld.value.copy(cam.matrixWorld);
  I.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
  //projectionMatrix[5] = 1 / tan(fovY / 2): the vertical angle one froxel spans.
  I.uFroxelAngle.value = 2.0 / (Math.max(cam.projectionMatrix.elements[5], 1e-3) * al.h);
  I.uScattering.value.set(sc.x, sc.y, sc.z);
  I.uExtinction.value.set(ex, ey, ez);
  I.uRInf.value.set(rInf(sc.x, ex), rInf(sc.y, ey), rInf(sc.z, ez));
  I.uSunWater.value.set(sw.x, sw.y, sw.z);
  I.uSunBeam.value.set(col.x * beam, col.y * beam, col.z * beam);
  I.uSunDown.value.set(col.x * down, col.y * down, col.z * down);
  I.uSkyDown.value.set(ctx.skyDown.x, ctx.skyDown.y, ctx.skyDown.z);
  I.uPhase.value.set(this.phaseG, this.gazeWeight);

  //Shafts.
  const CM = ctx.causticModel, cmap = ctx.causticMap;
  const cmapSize = (cmap && cmap.image && cmap.image.width) ? cmap.image.width : 1024;
  if(cmap && CM && this.shaftStrength > 0.0){
    I.uCausticMap.value = cmap;
    I.uCausticTime.value = ctx.causticTime || 0.0;
    //Centred on the web's MEASURED mean, so the shafts move light around instead of dimming the
    //water (CM.textureMean is the seabed model's constant; against the smoothstepped web it
    //left the shaft term averaging ~0.85 and the water 15% darker per unit of strength).
    I.uCausticMeanTex.value = this._measureCausticMean(cmap, CM);
    I.uCausticShape.value.set(CM.amplitude * this.shaftStrength, I.uCausticMeanTex.value ? -1.0 : CM.textureMean,
                              CM.contrastDepthM, CM.focusM);
    I.uCausticScale.value.set(CM.baseUV, CM.tilePerDepth, Math.max(CM.minTileM, this.shaftCellM), cmapSize);
  } else {
    I.uCausticShape.value.x = 0.0;
  }
  //Shadow.
  const wl = this.shadow ? ctx.waterLight : null;
  if(wl && wl.map && wl.frame){
    const size = (wl.map.image && wl.map.image.width) ? wl.map.image.width : 512;
    I.uLightMap.value = wl.map;
    I.uLightFrame.value.set(wl.frame.x, wl.frame.y, wl.frame.z, size);
  } else {
    I.uLightFrame.value.set(0, 0, 0, 1);
  }
  I.uGlowRadius.value = this.glowShadowRadiusM;
  //Fog texture.
  const t = ctx.time || 0.0;
  I.uTexture.value.set(Math.max(this.textureAmplitude, 0.0), 1.0 / Math.max(this.textureScaleM, 0.01), 0, 0);
  I.uTexOffset.value.copy(this.textureDrift).multiplyScalar(-t / Math.max(this.textureScaleM, 0.01));
  //Jitter: R2 low-discrepancy sequence per frame.
  this._frame = (this._frame + 1) % 65536;
  if(this.jitter){
    const n = this._frame;
    I.uJitter.value.set((0.5 + n * 0.7548776662) % 1.0, (0.5 + n * 0.5698402910) % 1.0, (0.5 + n * 0.6180339887) % 1.0);
  } else {
    I.uJitter.value.set(0.5, 0.5, 0.5);
  }
  //History (last frame's blended scatter), unless it is stale.
  const write = this._write, read = 1 - write;
  I.uHistory.value = this.scatterTargets[read].texture;
  I.uHistoryWeight.value = this._historyValid ? Math.min(Math.max(this.historyWeight, 0.0), 0.98) : 0.0;
  I.uPrevViewProj.value.copy(this._prevViewProj);
  I.uPrevCam.value.copy(this._prevCam);

  const G = this.integrateMaterial.uniforms;
  G.uScatter.value = this.scatterTargets[write].texture;
  G.uGrid.value.copy(I.uGrid.value);
  G.uShape.value.copy(I.uShape.value);
  G.uExtinction.value.copy(I.uExtinction.value);

  const prevRT = this.renderer.getRenderTarget();
  const prevXr = this.renderer.xr ? this.renderer.xr.enabled : false;
  if(this.renderer.xr) this.renderer.xr.enabled = false;
  this._quad.material = this.injectMaterial;
  this.renderer.setRenderTarget(this.scatterTargets[write]);
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

  this._prevViewProj.copy(U.uwVolViewProj.value);
  this._prevCam.copy(U.uwVolCam.value);
  this._historyValid = true;
  this._write = read;
  this.active = true;
};

//The viewer surfaced (or the volume is off): every consumer falls back, and the
//history is stale by the time it dives again.
ARestlessOcean.Passes.UnderwaterVolumePass.prototype.stand = function(){
  this.uniforms.uwVolOn.value = 0.0;
  this.active = false;
  this._historyValid = false;
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
  this._disposeTargets();
  if(this._causticMean){ this._causticMean.target.dispose(); this._causticMean = null; }
  if(this.injectMaterial) this.injectMaterial.dispose();
  if(this.integrateMaterial) this.integrateMaterial.dispose();
  if(this._quad) this._quad.geometry.dispose();
};
