#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

uniform maxAmplitude;
uniform waveDirection;

varying vec2 textureOffset;
uniform float scale;
uniform float wavelength;
uniform float phaseAngle;
vec2 windDirection;
vec2 waveDirection;
vec2 sharpness;

void main(){
  float xOffset;
  float yOffset;
  float zOffset;

  gl_FragColor =vec4(1.0);
}
