precision highp float;

//Waterfall mist vertex stage. The mesh is the set of CONES ARestlessOcean.WaterfallMistHull builds
//along the water's paths: closed, round, wound outward. Nothing is displaced here; the stage hands
//the fragment stage each cone's axis point and direction (the density is a function of the
//distance to the axis, so it is zero on the wall by construction) and the curtain's own normal and
//across direction (used only to tell which side of the sheet a sample is on).

attribute vec3 aCenter;      //the cone's axis point at this ring
attribute vec3 aFlowTangent; //the cone's axis direction (down the flow, unit)
attribute vec3 aFlowAcross;  //the curtain's across direction (unit)
attribute vec4 aMistA;       //across (m from the curtain's middle), u (0 lip, 1 landing, 1..2 run-out), radius (m), seed
attribute vec4 aMistB;       //aeration, run length (m), 0, curtain half-width (m)
attribute vec3 aMistC;       //the run's landing point

varying vec3 vWorldPos;
varying vec3 vCenter;
varying vec3 vN;
varying vec3 vT;
varying vec3 vA;
varying vec4 vMistA;
varying vec4 vMistB;
varying vec3 vEnd;
varying float vViewDepth;

#include <fog_pars_vertex>

void main(){
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vCenter = (modelMatrix * vec4(aCenter, 1.0)).xyz;
  vN = normal;
  vT = aFlowTangent;
  vA = aFlowAcross;
  vMistA = aMistA;
  vMistB = aMistB;
  vEnd = (modelMatrix * vec4(aMistC, 1.0)).xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewDepth = -mvPosition.z;
  //The fog chunk reads `mvPosition` and `transformed` by those names (see waterfall-sheet-vertex.glsl).
  #ifdef USE_FOG
    vec3 transformed = position;
  #endif
  #include <fog_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
