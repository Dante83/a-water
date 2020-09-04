precision highp float;

//With a lot of help from https://youtu.be/i0BPrGuOdPo
uniform sampler2D textureH0;
uniform float L; //1000.0
uniform float N; //256.0
uniform float uTime; //0.0
const float g = 9.80665;
const float piTimes2 = 6.283185307179586476925286766559005768394338798750211641949;
const float pi = 3.141592653589793238462643383279502884197169;

vec2 cMult(vec2 a, vec2 b){
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cAdd(vec2 a, vec2 b){
  return vec2(a.x + b.x, a.y + b.y);
}

vec2 conjugate(vec2 a){
  return vec2(a.x, -1.0 * a.y);
}

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec2 x = uv.xy * N;
  vec2 k = vec2(piTimes2 / L) * x;
  float magK = length(k);
  if (magK < 0.0001) magK = 0.0001;
  float w = sqrt(g * magK);

  vec4 tilda_h0 = texture2D(textureH0, uv.xy);
  vec2 tilda_h0_k = tilda_h0.rg;
  vec2 tilda_h0_minus_k_conj = conjugate(tilda_h0.ba);

  float cosOfWT = cos(w * uTime);
  float sinOfWT = sin(w * uTime);

  //Euler Formula
  vec2 expIwt = vec2(cosOfWT, sinOfWT);
  vec2 expIwtConj = vec2(cosOfWT, -sinOfWT);

  //dy
  vec2 hk_tilda = cAdd(cMult(tilda_h0_k, expIwt), cMult(tilda_h0_minus_k_conj, expIwtConj));

  #if($isXAxis)
    vec2 dx = vec2(0.0, -k.x / magK);
    hk_tilda = cMult(dx, hk_tilda);
  #elif(!$isXAxis && !$isYAxis)
    vec2 dy = vec2(0.0, -k.y / magK);
    hk_tilda = cMult(dy, hk_tilda);
  #endif
  gl_FragColor = vec4(hk_tilda, 0.0, 1.0);
}
