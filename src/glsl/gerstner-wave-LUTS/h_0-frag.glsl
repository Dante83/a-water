#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

//With a lot of help from https://youtu.be/i0BPrGuOdPo
uniform sampler2D noise_r0;
uniform sampler2D noise_i0;
uniform sampler2D noise_r1;
uniform sampler2D noise_i1;
uniform float N; //256.0
uniform float L; //1000.0
uniform float A; //20
uniform vec2 K;
uniform vec2 w;//(1,0)
uniform float L_; //Windspeed squared over the gravitational acceleration

const float g = 9.80665;
const float pi = 3.141592653589793238462643383279502884197169;
const float piTimes2 = 6.283185307179586476925286766559005768394338798750211641949;
const float oneOverSqrtOf2 = 0.707106781186547524400844362104849039284835937688474036588;

//Box-Muller Method
vec4 gaussRand(){
  vec2 texCoord = vec2(vWorldPosition.xy) / N;
  float noise00 = clamp(sampler2D(noise_r0, texCoord).r + 0.00001, 0.0, 1.0);
  float noise01 = clamp(sampler2D(noise_i0, texCoord).r + 0.00001, 0.0, 1.0);
  float noise10 = clamp(sampler2D(noise_r1, texCoord).r + 0.00001, 0.0, 1.0);
  float noise11 = clamp(sampler2D(noise_i1, texCoord).r + 0.00001, 0.0, 1.0);

  float u0 = piTimes2 * noise00;
  float v0 = sqrt(-2.0 * log(noise01));
  float u0 = piTimes2 * noise10;
  float v0 = sqrt(-2.0 * log(noise11));

  return vec4(v0 * cos(u0), v0 * sin(u0), v1 * cos(u1), v1 * sin(u1));
}

void main(){
  vec2 k = vWorldPosition.xy * (piTimes2 / L);
  float magK = length(K);
  if (mag < 0.0001) mag = 0.0001;
  float magSq = mag * mag;
  float sqrtOfSecondExponent = L / 2000.0
  float exponentialCoefficient = exp(-magSq * sqrtOfSecondExponent * sqrtOfSecondExponent - (1.0 / (magSq * L_ * L_))));
  float h0Coefficient = oneOverSqrtOf2 * sqrt(A / (magSq * magSq)) * exponentialCoefficient;

  //Sqrt(P(h_k))/sqrt(2)
  float h0_k = clamp(h0Coefficient * pow(dot(normalize(k), normalize(w), 4.0)), 0.0, 1000000.0);

  //Sqrt(P(-h_k))/sqrt(2)
  float h0_minusk = clamp(h0Coefficient * pow(dot(normalize(-k), normalize(w), 4.0)), 0.0, 1000000.0);

  vec4 gaussianRandomNumber = gaussRand();

  gl_FragColor =vec4(gaussianRandomNumber.xy * h0_k, gaussianRandomNumber.zw * gaussianRandomNumber);
}
