precision highp float;

//Ocean splash particle fragment stage (THREE.Points, GLSL1).
//
//Each point is a camera-facing sprite quad (gl_PointCoord spans 0..1). We
//composite a supplied spray sprite, fade it in/out over the particle lifetime,
//and soft-fade it against scene geometry using the refraction G-buffer linear
//depth so droplets sink into terrain and hulls instead of hard-clipping.

uniform sampler2D splashSprite;   //alpha-bearing droplet/mist sprite
uniform sampler2D uLinearDepth;   //G-buffer attachment 2: positive view-Z, a=hasGeom
uniform vec2 uResolution;         //G-buffer / drawing-buffer size in pixels
uniform float uSoftRange;         //metres over which we soft-fade into geometry
uniform float uOpacity;           //global artistic opacity (FUDGE)
uniform int uDebugMode;           //0 = normal, 1 = tint by emitter type

varying float vAge01;
varying float vSeed;
varying float vType;
varying float vViewZ;
varying vec3 vColor;

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

void main(){
  //Sprite. gl_PointCoord has its origin top-left; flip Y so authored sprites
  //read the conventional way. Spin each droplet a little by its seed so a
  //single round sprite does not betray the point-grid.
  vec2 pc = gl_PointCoord - 0.5;
  float ang = (vSeed - 0.5) * 6.2831853;
  float cs = cos(ang); float sn = sin(ang);
  vec2 spriteUV = vec2(cs * pc.x - sn * pc.y, sn * pc.x + cs * pc.y) + 0.5;
  spriteUV.y = 1.0 - spriteUV.y;
  vec4 sprite = texture2D(splashSprite, spriteUV);

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

  float alpha = sprite.a * ageAlpha * softFade * uOpacity;

  vec3 color = linearToSrgb(acesTonemap(vColor * sprite.rgb));

  if(uDebugMode == 1){
    //Crest mist = red, impact burst = magenta; alpha-only sprite shape kept.
    vec3 tint = mix(vec3(1.0, 0.1, 0.1), vec3(1.0, 0.2, 0.8), step(0.5, vType));
    color = tint;
    alpha = sprite.a * ageAlpha;
  }

  if(alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha);
}
