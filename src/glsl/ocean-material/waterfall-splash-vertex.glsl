precision highp float;

//Waterfall splash vertex stage. The mesh is the set of BLOBS ARestlessOcean.WaterfallSplashHull
//builds at the falls' landings: an icosahedron round each blob's sphere. Nothing is displaced here;
//the stage hands the fragment stage the blob's sphere and its burst (the same values at every
//vertex of a blob, so they arrive unchanged).

attribute vec4 aCenter;    //the blob's origin (the landing, on the water's surface) and its radius (m)
attribute vec4 aSplashA;   //launch speed at the middle (m/s), the pulse's period (s), the impact's width b (m), seed
attribute vec4 aSplashB;   //the burst's up axis (unit), strength
attribute vec4 aSplashC;   //level (nothing below this height), terminal speed (m/s), radial spread k (the hull's fan), fall reach (the hull's fallReach)

varying vec3 vWorldPos;
varying vec4 vCenter;
varying vec4 vSplashA;
varying vec4 vSplashB;
varying vec4 vSplashC;
varying float vViewDepth;

#include <fog_pars_vertex>

void main(){
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vCenter = vec4((modelMatrix * vec4(aCenter.xyz, 1.0)).xyz, aCenter.w);
  vSplashA = aSplashA;
  vSplashB = aSplashB;
  vSplashC = aSplashC;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewDepth = -mvPosition.z;
  //The fog chunk reads `mvPosition` and `transformed` by those names (see waterfall-sheet-vertex.glsl).
  #ifdef USE_FOG
    vec3 transformed = position;
  #endif
  #include <fog_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
