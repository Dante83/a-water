precision highp float;

//Waterfall cloud vertex stage. One instanced icosahedron per PUFF (WaterfallCloudPass picks them
//every frame from ARestlessOcean.WaterfallCloudPuffs): the unit proxy is scaled by uProxyScale so its
//INSCRIBED sphere is the puff's (it holds the whole puff), and placed at the puff's middle. Nothing
//else happens here; the fragment stage gets the puff (the same at every vertex of an instance).

attribute vec4 aPuff;    //the puff's middle (world) and its radius (m)
attribute vec4 aPuffB;   //peak density (relative, 0..1), age (share of its life), seed, the pool's still level

uniform float uProxyScale;

varying vec3 vWorldPos;
varying vec4 vPuff;
varying vec4 vPuffB;
varying float vViewDepth;

#include <fog_pars_vertex>

void main(){
  vec4 worldPos = vec4(aPuff.xyz + position * aPuff.w * uProxyScale, 1.0);
  vWorldPos = worldPos.xyz;
  vPuff = aPuff;
  vPuffB = aPuffB;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewDepth = -mvPosition.z;
  //The fog chunk reads `mvPosition` and `transformed` by those names (see waterfall-sheet-vertex.glsl).
  #ifdef USE_FOG
    vec3 transformed = position;
  #endif
  #include <fog_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
