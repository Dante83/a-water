precision highp float;

//Ocean splash particle vertex stage (instanced camera-facing quads, GLSL1).
//
//One 4-corner quad (`position` = corner in -1..1, z 0) drawn once per live particle.
//The per-particle attributes are INSTANCED: aCenter holds the WORLD-space point (the
//mesh sits at the origin with an identity model matrix, so modelViewMatrix is the
//plain view matrix). The CPU sim writes centre, velocity, age and size every frame;
//spawn-time constants (seed, type, coarseness) are refreshed when a slot is recycled.
//
//Quads, not GL points (Phase 6b): gl_PointSize is capped by the hardware (and by our
//old uMaxPointSize 512 px), so a 1-1.5 m waterfall mist puff a few metres away shrank
//as you walked up to it. A quad has no cap.

attribute vec3 aCenter;    //world-space particle centre (metres)
attribute vec3 aVel;       //world-space velocity (m/s); stretches the type-3 splash streaks
attribute float aSize;     //world-space radius of this droplet (metres)
attribute float aAge01;    //age / lifetime, 0 at birth .. 1 at death
attribute float aSeed;     //per-particle random in [0,1] for shader variety
attribute float aType;     //0 crest mist, 1 impact burst, 2 waterfall mist, 3 waterfall splash
attribute float aCoarse;   //0 = fine hanging mist .. 1 = coherent falling droplet

uniform float uViewportHeight; //renderer drawing-buffer height in pixels (1 px size floor)
uniform float uFallStreakTime; //s: a splash streak is as long as the path it covers in this time
uniform float uSizeScale;      //size multiplier for the mist puff + the small-drop cluster
uniform vec2 uWind;            //world-space wind (x, z); projected into the billboard plane below

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
//light shadow.matrix): maps world -> shadow-map UV+depth. aCenter is already
//world-space (identity model), so this matches the water surface exactly.
uniform mat4 sunShadowMatrix;

varying vec2 vUv;              //0..1 across the quad, y-DOWN like the old gl_PointCoord
varying float vHalfW;          //world half-width of the (round) quad, for the camera-inside fade
varying float vAge01;
varying float vSeed;
varying float vType;
varying float vCoarse;         //fine-mist..droplet grade, drives the fragment look
varying float vViewZ;          //positive view-space depth, matches G-buffer
varying vec3 vAmbient;         //smooth sky-ambient term (unshadowed)
varying vec3 vSunCol;          //sun colour * scale; the fragment wraps it over a normal
varying float vGlow;           //forward-scatter additive (backlit through-glow)
varying vec3 vSunDirView;      //view-space direction TO the sun, for the wrap normal
varying vec4 vSunShadowCoord;  //world position in scene-sun shadow space
varying vec3 vToCamW;          //world-space direction from the particle to the camera
varying vec2 vWindDir;         //view-space (billboard-plane) wind direction for the noise scroll

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
  vec4 mvPosition = modelViewMatrix * vec4(aCenter, 1.0);
  vViewZ = -mvPosition.z;

  //The quad is as wide as the old point sprite was: aSize * uSizeScale world units across
  //(the mist puff and the small-drop cluster share it; the cluster needs the room for its
  //many tiny drops). Floored at ~1.5 px across so far spray does not alias away, which is
  //what the old clamp(pointPx, 1.0, ...) did.
  float focalPx = 0.5 * uViewportHeight * projectionMatrix[1][1];
  float halfW = max(0.5 * aSize * uSizeScale, 0.75 * max(0.001, vViewZ) / focalPx);
  vHalfW = halfW;
  vec2 axis = vec2(1.0, 0.0);
  float halfL = halfW;
  //Type 3, waterfall splash: a streak along the motion as the camera sees it, as long as
  //the path covered in uFallStreakTime (motion blur of a fast droplet). Falls back to the
  //round clump when the motion is toward the camera or the particle is slow.
  if(aType > 2.5){
    vec2 vv = (viewMatrix * vec4(aVel, 0.0)).xy;
    float vl = length(vv);
    if(vl > 1e-3){
      axis = vv / vl;
      halfL = halfW + 0.5 * vl * uFallStreakTime;
    }
  }
  vec2 perp = vec2(-axis.y, axis.x);
  mvPosition.xy += axis * (position.x * halfL) + perp * (position.y * halfW);
  //y-DOWN like gl_PointCoord, so the fragment's sprite maths is unchanged.
  vUv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);

  vAge01 = aAge01;
  vSeed = aSeed;
  vType = aType;
  vCoarse = aCoarse;

  //Forward-scatter cosine. aCenter is world-space (identity model matrix), so the
  //camera ray travels camera -> particle, i.e. -toCam; it then continues toward the
  //sun (sunDir). cosT peaks at +1 when looking through the mist toward the sun.
  vec3 toCam = normalize(cameraPosition - aCenter);
  vToCamW = toCam;
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
  vSunShadowCoord = sunShadowMatrix * vec4(aCenter, 1.0);
  //Wind direction in the billboard plane (view space), so the fragment can scroll the haze noise
  //along it. World wind is horizontal (uWind.x, 0, uWind.y); y is negated to match gl_PointCoord
  //y-down (vUv). Normalised to a pure direction — the scroll RATE is the fragment's uWindNoiseSpeed.
  vec3 windView = (viewMatrix * vec4(uWind.x, 0.0, uWind.y, 0.0)).xyz;
  vWindDir = (length(windView.xy) > 1e-4) ? normalize(vec2(windView.x, -windView.y)) : vec2(0.0, 0.0);

  gl_Position = projectionMatrix * mvPosition;
}
