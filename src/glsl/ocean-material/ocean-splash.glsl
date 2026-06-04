precision highp float;

//Ocean splash particle fragment stage (THREE.Points, GLSL1).
//
//Each point is a camera-facing sprite quad (gl_PointCoord spans 0..1). We
//composite a supplied spray sprite, fade it in/out over the particle lifetime,
//and soft-fade it against scene geometry using the refraction G-buffer linear
//depth so droplets sink into terrain and hulls instead of hard-clipping.

uniform sampler2D splashSprite;   //retained for compatibility, now unused (shape is procedural)
uniform sampler2D uLinearDepth;   //G-buffer attachment 2: positive view-Z, a=hasGeom
uniform vec2 uResolution;         //G-buffer / drawing-buffer size in pixels
uniform float uSoftRange;         //metres over which we soft-fade into geometry
uniform float uOpacity;           //global artistic opacity (FUDGE)
uniform int uDebugMode;           //0 = normal, 1 = tint by emitter type
uniform float uNoiseScale;        //3D noise frequency across the droplet
uniform float uErode;             //silhouette erosion threshold (higher = grainier)
uniform float uSoftEdge;          //erosion smoothstep width (lower = sharper, sparklier)
uniform float uNoiseEvolve;       //noise dissolve rate over the particle life

//Scene sun shadow receive (same map + params as the water shader's sunShadow*).
uniform sampler2D sunShadowMap;   //THREE directional-light depth shadow map
uniform vec2 sunShadowMapSize;    //shadow map resolution in texels
uniform float sunShadowRadius;    //PCF tap spread (light.shadow.radius)
uniform float sunShadowBias;      //depth bias (light.shadow.bias + console offset)
uniform int sunShadowEnabled;     //0 = no shadow map this frame

varying float vAge01;
varying float vSeed;
varying float vType;
varying float vViewZ;
varying vec3 vAmbient;      //smooth sky-ambient term
varying vec3 vSunCol;       //sun colour * scale, wrapped over the synthesized normal
varying float vGlow;        //forward-scatter additive (backlit through-glow)
varying vec3 vSunDirView;   //view-space direction TO the sun
varying vec4 vSunShadowCoord;

//This is a raw ShaderMaterial, so (unlike THREE built-ins) no tonemap or output
//color-space conversion is applied for us. The water surface self-applies the
//same pair, and we blend over its already-sRGB-encoded pixels, so we must match
//or the spray reads too dark on the shadow side and clips harshly on the lit one.
vec3 acesTonemap(vec3 x){
  const float a = 2.51; const float b = 0.03;
  const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 linearToSrgb(vec3 c){ return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

//Compact 3D value noise (iq-style integer hash + trilinear smoothstep interp). Cheap
//enough to run per-fragment on hundreds of sprites; quality is fine for soft mist.
float hash3(vec3 p){
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise3(vec3 x){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
//Three-octave fractal sum -> billowy cloud-style field in roughly [0,1].
float fbm3(vec3 p){
  float a = 0.5;
  float s = 0.0;
  for(int i = 0; i < 3; i++){
    s += a * vnoise3(p);
    p *= 2.0;
    a *= 0.5;
  }
  return s;
}

//Scene sun shadow: 3x3 PCF on the directional-light depth map. A derivative-free
//cut of the water shader getSunShadow (no dFdx slope bias) so it stays GLSL1-safe;
//soft spray does not need acne suppression. Returns 1 = lit, 0 = fully shadowed.
float getSplashSunShadow(){
  if(sunShadowEnabled == 0) return 1.0;
  vec3 sc = vSunShadowCoord.xyz / vSunShadowCoord.w;
  if(sc.z > 1.0 || sc.z < 0.0) return 1.0;
  vec2 edgeDist = min(sc.xy, vec2(1.0) - sc.xy);
  float edge = min(edgeDist.x, edgeDist.y);
  if(edge < 0.0) return 1.0;
  float refZ = sc.z + sunShadowBias;
  vec2 texelSize = (1.0 / sunShadowMapSize) * sunShadowRadius;
  float shadow = 0.0;
  for(int x = -1; x <= 1; x++){
    for(int y = -1; y <= 1; y++){
      float d = texture2D(sunShadowMap, sc.xy + vec2(float(x), float(y)) * texelSize).r;
      shadow += refZ < d ? 1.0 : 0.0;
    }
  }
  shadow *= (1.0 / 9.0);
  //Fade toward lit over the outer 5% of the frustum so the boundary is not a hard line.
  float fade = smoothstep(0.0, 0.05, edge);
  return mix(1.0, shadow, fade);
}

void main(){
  //Procedural mist droplet: a soft sphere whose silhouette is eroded by 3D noise so
  //each billboard reads as a rough-edged, cloud-like puff rather than a flat disc.
  vec2 pc = (gl_PointCoord - 0.5) * 2.0;   //-1..1 across the quad
  float r = length(pc);                    //0 at centre .. ~1.41 at the corner
  //Reconstruct a hemisphere height so the noise wraps over a 3D surface (a fake
  //volume cue) instead of lying flat on the disc.
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 spherePos = vec3(pc, z);
  //Per-particle offset (vSeed) makes every droplet unique; advancing along Z by
  //vAge01 evolves the field so the puff dissolves organically as it ages.
  vec3 nCoord = spherePos * uNoiseScale + vec3(vSeed * 51.3, vSeed * 17.7, vAge01 * uNoiseEvolve);
  float n = fbm3(nCoord);                  //~0..1
  //Soft round falloff (squared so the centre is denser and the edge fades to clear),
  //then CARVE it with noise: low-noise regions go transparent, so the puff reads as a
  //wispy translucent cloud with holes and a dissolving silhouette rather than a solid
  //white disc. Nothing here saturates to 1, so the look stays cloud-like; uOpacity is
  //the peak. uErode = how much is carved away; uSoftEdge = how soft the carve edge.
  float core = clamp(1.0 - r, 0.0, 1.0);
  core = core * core;
  float carve = smoothstep(uErode, uErode + uSoftEdge, n);
  float density = core * carve;

  //Lifetime fade: a quick rise then a long ease-out, like real spray thinning.
  float fadeIn = smoothstep(0.0, 0.15, vAge01);
  float fadeOut = 1.0 - smoothstep(0.55, 1.0, vAge01);
  float ageAlpha = fadeIn * fadeOut;

  //Soft-particle fade. Sample scene depth under this fragment. .a marks where
  //solid geometry was written; over open water / sky it is 0 and we must NOT
  //fade (otherwise spray over the open sea vanishes against the cleared buffer).
  vec2 screenUV = gl_FragCoord.xy / uResolution;
  vec4 depthSample = texture2D(uLinearDepth, screenUV);
  float sceneZ = depthSample.r;
  float hasGeom = depthSample.a;
  float softFade = 1.0;
  if(hasGeom > 0.5){
    softFade = clamp((sceneZ - vViewZ) / max(0.001, uSoftRange), 0.0, 1.0);
  }

  float alpha = density * ageAlpha * softFade * uOpacity;

  //Synthesize a camera-facing spherical normal from the sprite coords and half-Lambert
  //wrap the sun over it: the side toward the sun lights up, the far side falls to the
  //(bluish) sky-ambient, so each puff gains a light/dark gradient and reads as a 3D
  //billow rather than a flat white patch. The +0.3 z-bias keeps rim normals from going
  //fully edge-on (a harsh black terminator). The forward-scatter glow (vGlow) is added
  //ungated so a backlit puff still blooms through.
  vec3 N = normalize(vec3(pc, z + 0.3));
  float wrap = clamp(dot(N, vSunDirView) * 0.5 + 0.5, 0.0, 1.0);
  //Scene sun shadow gates BOTH sun terms (wrap reflection and forward glow): a puff
  //in the rock/lighthouse shadow gets no direct sun and nothing to forward-scatter,
  //so it falls to the smooth (unshadowed) sky-ambient.
  float sunShadow = getSplashSunShadow();
  vec3 lit = vAmbient + vSunCol * (wrap + vGlow) * sunShadow;
  vec3 color = linearToSrgb(acesTonemap(lit));

  if(uDebugMode == 1){
    //Crest mist = red, impact burst = magenta; procedural density kept as the alpha.
    vec3 tint = mix(vec3(1.0, 0.1, 0.1), vec3(1.0, 0.2, 0.8), step(0.5, vType));
    color = tint;
    alpha = density * ageAlpha;
  }

  if(alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha);
}
