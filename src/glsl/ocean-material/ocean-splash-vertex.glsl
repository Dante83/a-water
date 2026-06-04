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

//Forward-scatter (Mie) phase. Spray droplets scatter overwhelmingly forward, so the
//mist blooms when you look THROUGH it toward the sun. uSunDir is the world-space
//direction TO the sun; uPhaseG is the forward-lobe tightness; uPhaseGain dials how
//strongly the halo brightens the sun term.
uniform vec3 sunDir;           //world-space direction TO the sun (normalised)
uniform float uPhaseG;         //forward lobe asymmetry g in [0,1)
uniform float uPhaseGain;      //forward-scatter halo strength (FUDGE)

//Scene sun shadow receive. Same matrix the water shader uses (THREE directional
//light shadow.matrix): maps world -> shadow-map UV+depth. position is already
//world-space (identity model), so this matches the water surface exactly.
uniform mat4 sunShadowMatrix;

varying float vAge01;
varying float vSeed;
varying float vType;
varying float vViewZ;          //positive view-space depth, matches G-buffer
varying vec3 vAmbient;         //smooth sky-ambient term (unshadowed)
varying vec3 vSunCol;          //sun colour * scale; the fragment wraps it over a normal
varying float vGlow;           //forward-scatter additive (backlit through-glow)
varying vec3 vSunDirView;      //view-space direction TO the sun, for the wrap normal
varying vec4 vSunShadowCoord;  //world position in scene-sun shadow space

//Henyey-Greenstein single-lobe phase. g>0 biases scattering forward (toward sun).
float hgPhase(float cosT, float g){
  float g2 = g * g;
  return (1.0 / (4.0 * 3.14159265)) * (1.0 - g2) / pow(max(1e-4, 1.0 + g2 - 2.0 * g * cosT), 1.5);
}
//Dual-lobe blend: a strong forward lobe (gF) plus a weak wide/back lobe. This is the
//practical minimum that reads as spray Mie scattering rather than a flat sprite.
float dualPhase(float cosT, float gF){
  const float gB = -0.2;
  const float w = 0.15;
  return mix(hgPhase(cosT, gF), hgPhase(cosT, gB), w);
}

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

  //Forward-scatter cosine. position is world-space (identity model matrix), so the
  //camera ray travels camera -> particle, i.e. -toCam; it then continues toward the
  //sun (sunDir). cosT peaks at +1 when looking through the mist toward the sun.
  vec3 toCam = normalize(cameraPosition - position);
  float cosT = dot(-toCam, sunDir);
  float phase = dualPhase(cosT, uPhaseG);

  //Split the lighting so the fragment can SHAPE it: a smooth sky-ambient term, a sun
  //colour the fragment wraps over a synthesized spherical normal (sun-facing side
  //bright, far side -> ambient, so the puff reads as a 3D billow not flat steam), and
  //a view-dependent forward-scatter glow added ungated (the backlit bloom, which must
  //NOT be multiplied by the wrap or it would cancel the through-light). The ambient
  //term stays smooth and unshadowed (the Ghost of Tsushima Mie-vs-ambient split).
  vAmbient = skyAmbientColor * uAmbientScale;
  vSunCol = sunColor * uSunScale;
  vGlow = uPhaseGain * phase;
  vSunDirView = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);
  vSunShadowCoord = sunShadowMatrix * vec4(position, 1.0);

  gl_Position = projectionMatrix * mvPosition;
}
