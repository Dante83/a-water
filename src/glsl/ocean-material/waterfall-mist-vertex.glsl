precision highp float;

//Waterfall mist vertex stage. The mesh is the HULL ARestlessOcean.WaterfallMistHull builds
//round the curtain: a closed, curved cone whose far side the fragment stage draws and marches
//back from. Nothing is displaced here; the stage only hands the fragment stage the curtain's
//own frame at this row, so every sample is measured in metres from the curtain however it
//bends.

attribute vec3 aCenter;      //the curtain's centre point at this row
attribute vec3 aFlowTangent; //down the flow (unit)
attribute vec3 aFlowAcross;  //toward +across (unit)
attribute vec4 aMistA;       //s (m of path), across (m from the middle), layer (+1 / -1), radius (m)
attribute vec4 aMistB;       //aeration, foot fade length (m), free-fall flag, half-width (m)
attribute vec3 aMistC;       //the strand's landing point
attribute vec2 aMistD;       //the horizontal direction the water runs at the landing (unit)

varying vec3 vWorldPos;
varying vec3 vCenter;
varying vec3 vN;
varying vec3 vT;
varying vec3 vA;
varying vec4 vMistA;
varying vec4 vMistB;
varying vec3 vEnd;
varying vec2 vEndDir;
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
  vEndDir = aMistD;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewDepth = -mvPosition.z;
  //The fog chunk reads `mvPosition` and `transformed` by those names (see waterfall-sheet-vertex.glsl).
  #ifdef USE_FOG
    vec3 transformed = position;
  #endif
  #include <fog_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
