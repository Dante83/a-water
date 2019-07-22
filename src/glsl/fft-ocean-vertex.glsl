#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

varying vec3 vWorldPosition;
uniform float depth;
uniform vec2 windVector;
uniform vec2 waterDirection;
uniform float largestWaveAmplitude;
uniform float A; //Philips spectrum parameter.
uniform float lengthParameter;

void main() {
  //Calculate the height of of our vertex based on the FFT based waves
  float twoPi = 6.283185307179586476925286766559005768394338798750211641949;
  float g = 9.80665;
  float vertexOffset = 0.0;
  for(int n = 0; n < 6; n++){
    vec2 L;
    vec2 nm = vec2((float) n);
    //Note that 2 * pi * (n - N / 2) / L
    vec2 k = twoPi * (nm - vec2(3.0)) / L;
    float kDotWindVector = k.dot(windVector);
    vec2 exponent = 1.0 / (largestWaveAmplitude * k)
    vec2 phillipsSpectrumOfn = kDotWindVector * kDotWindVector * exp(-1.0 / (exponent * exponent));
  }

  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorldPosition = worldPosition.xyz;
  vec3 normalizedWorldPosition = normalize(vWorldPosition);

  vec3 simplifiedRayleigh = vec3(0.0005 / 94.0, 0.0005 / 40.0, 0.0005 / 18.0);
  float pixelFade = 1.0 - clamp(1.0 - exp(normalizedWorldPosition.z), 0.0, 1.0);
  betaRPixel = simplifiedRayleigh * (rayleigh - (1.0 - pixelFade));

  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
