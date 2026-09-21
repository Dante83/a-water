precision highp float;

//Waterfall sheet vertex stage (Phase 6). The ribbon is built on the CPU by
//ARestlessOcean.WaterfallNappe.buildRibbon in WORLD space and the mesh sits at the
//origin, so there is no displacement here: the nappe's shape is its trajectory,
//and everything that moves (the grain, the whitewater) moves in the fragment stage.

attribute vec4 aFlowA;   //tau (s of flight since the trace began), across (-1..1), thickness (m), speed (m/s)
attribute vec4 aFlowB;   //aeration (0..1), presence (0..1), airborne (0..1), half-width (m)

uniform mat4 sunShadowMatrix;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec4 vFlowA;
varying vec4 vFlowB;
varying vec4 vSunShadowCoord;
varying float vViewDepth;

#include <fog_pars_vertex>

void main(){
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vFlowA = aFlowA;
  vFlowB = aFlowB;
  vSunShadowCoord = sunShadowMatrix * worldPos;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewDepth = -mvPosition.z;
  //The fog chunk (UnderwaterFogChunk, or a-starry-sky's) reads `mvPosition` and
  //`transformed` by those names — see the same note in water-vertex.glsl.
  #ifdef USE_FOG
    vec3 transformed = position;
  #endif
  #include <fog_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
