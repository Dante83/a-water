precision highp float;

//Ocean splash particle vertex stage (THREE.Points, GLSL1).
//
//The Points mesh lives at the world origin with an identity model matrix, so
//the per-particle `position` attribute already holds a WORLD-space point and
//modelViewMatrix collapses to the plain view matrix. CPU sim writes position,
//age and size every frame; spawn-time constants (seed, type) ride along in
//their own attributes and are only refreshed when a slot is recycled.

attribute float aSize;     //world-space radius of this droplet (metres)
attribute float aAge01;    //age / lifetime, 0 at birth .. 1 at death
attribute float aSeed;     //per-particle random in [0,1] for shader variety
attribute float aType;     //0 = open-water crest mist, 1 = impact burst

uniform float uViewportHeight; //renderer drawing-buffer height in pixels
uniform float uMaxPointSize;   //hardware-safe clamp for gl_PointSize
uniform float uSizeScale;      //global artistic size multiplier (FUDGE)

//Lighting is per-particle (vertex) rather than per-fragment: spray is a bright
//omnidirectional scatterer with no meaningful surface normal, so a single
//ambient + sun term is both cheaper and visually sufficient.
uniform vec3 sunColor;         //brightest directional light colour * intensity
uniform vec3 skyAmbientColor;  //a-starry-sky y-hemisphere ambient
uniform float uSunScale;       //artistic sun contribution (FUDGE)
uniform float uAmbientScale;   //artistic ambient contribution (FUDGE)

varying float vAge01;
varying float vSeed;
varying float vType;
varying float vViewZ;          //positive view-space depth, matches G-buffer
varying vec3 vColor;

void main(){
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mvPosition.z;

  //Perspective size attenuation: a droplet of world radius aSize subtends
  //(aSize * focalLengthPixels / distance) pixels. projectionMatrix[1][1] is
  //the vertical focal length in clip units, so 0.5 * viewportHeight * that
  //converts a world radius at unit distance into pixels.
  float focalPx = 0.5 * uViewportHeight * projectionMatrix[1][1];
  float pointPx = aSize * uSizeScale * focalPx / max(0.001, vViewZ);
  gl_PointSize = clamp(pointPx, 1.0, uMaxPointSize);

  vAge01 = aAge01;
  vSeed = aSeed;
  vType = aType;
  vColor = skyAmbientColor * uAmbientScale + sunColor * uSunScale;

  gl_Position = projectionMatrix * mvPosition;
}
