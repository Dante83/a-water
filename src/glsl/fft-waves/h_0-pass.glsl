precision highp float;

//JONSWAP spectrum for ocean wave initialization
//Ref: Hasselmann et al. 1973, Tessendorf 2001
uniform float N; //256.0
uniform float L; //1000.0 - patch size in meters
uniform float A; //amplitude multiplier (artistic control)
uniform vec2 w; //wind direction (normalized)
uniform float omega_p; //peak angular frequency
uniform float gamma; //JONSWAP peak enhancement (typically 3.3)
uniform vec2 noiseUVOffset; //Per-cascade offset for decorrelated random phases
uniform float kMin; //Low wavenumber cutoff for this cascade band
uniform float kMax; //High wavenumber cutoff for this cascade band

const float g = 9.80665;
const float pi = 3.141592653589793238462643383279502884197169;
const float piTimes2 = 6.283185307179586476925286766559005768394338798750211641949;
const float JONSWAP_ALPHA = 0.0081; //Pierson-Moskowitz constant

//Box-Muller Method
vec4 gaussRand(vec2 uv){
  vec2 texCoord = fract(vec2(uv.xy) + noiseUVOffset);
  float noise00 = clamp(texture2D(textureNoise1, texCoord).r + 0.00001, 0.0, 1.0);
  float noise01 = clamp(texture2D(textureNoise2, texCoord).r + 0.00001, 0.0, 1.0);
  float noise02 = clamp(texture2D(textureNoise3, texCoord).r + 0.00001, 0.0, 1.0);
  float noise03 = clamp(texture2D(textureNoise4, texCoord).r + 0.00001, 0.0, 1.0);

  float u0 = piTimes2 * noise00;
  float v0 = sqrt(-2.0 * log(noise01));
  float u1 = piTimes2 * noise02;
  float v1 = sqrt(-2.0 * log(noise03));

  return vec4(v0 * cos(u0), v0 * sin(u0), v1 * cos(u1), v1 * sin(u1));
}

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec2 x = uv.xy * N;
  vec2 k = vec2(piTimes2 / L) * x;
  float magK = length(k);
  if (magK < 0.0001) magK = 0.0001;

  //Band-limit: zero out frequencies outside this cascade's range
  if (magK < kMin || magK > kMax){
    gl_FragColor = vec4(0.0);
    return;
  }

  //Dispersion relation
  float omega = sqrt(g * magK);

  //JONSWAP spectral width
  float sigma = omega <= omega_p ? 0.07 : 0.09;

  //Peak enhancement factor
  float r = exp(-pow(omega - omega_p, 2.0) / (2.0 * sigma * sigma * omega_p * omega_p));

  //Pierson-Moskowitz base spectrum in omega-space
  float pmSpectrum = JONSWAP_ALPHA * g * g / pow(omega, 5.0) * exp(-1.25 * pow(omega_p / omega, 4.0));

  //JONSWAP = PM * gamma^r
  float jonswap = pmSpectrum * pow(gamma, r);

  //Convert to k-space: S(k) = S(omega) * |domega/dk| = S(omega) * g/(2*omega)
  float Sk = jonswap * g / (2.0 * omega);

  //Tessendorf h0: sqrt(S_2D(k) * dk_x * dk_y / 2)
  //Convert 1D omnidirectional S(k) to 2D: S_2D = S(k) / k (Jacobian polar→Cartesian)
  //dk = 2*pi/L is the spacing between discrete k values
  float dk = piTimes2 / L;
  float h0_coefficient = A * sqrt(Sk * dk * dk / (2.0 * magK));

  //Directional spreading: cos^2(theta)
  //Use d*d instead of pow(d, 2.0) to avoid GLSL undefined behavior with negative base
  //Guard against zero wind to avoid NaN from normalize(vec2(0,0))
  if(length(w) < 0.0001){
    gl_FragColor = vec4(0.0);
    return;
  }
  float d_k = dot(normalize(k), normalize(w));
  float d_minus_k = dot(normalize(-k), normalize(w));
  float h0_k = h0_coefficient * d_k * d_k;
  float h0_minus_k = h0_coefficient * d_minus_k * d_minus_k;

  vec4 gaussianRandomNumber = gaussRand(uv);

  gl_FragColor = vec4(gaussianRandomNumber.xy * h0_k, gaussianRandomNumber.zw * h0_minus_k);
}
