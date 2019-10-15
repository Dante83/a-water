#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

//With a lot of help from https://youtu.be/i0BPrGuOdPo
const uniform int numIndices = `${numberOfTwiddleIndices}`; //Let us magically set this at run time :D
uniform float indices[numIndices];
uniform float N; //256.0

const float g = 9.80665;
const float pi = 3.141592653589793238462643383279502884197169;
const float piTimes2 = 6.283185307179586476925286766559005768394338798750211641949;
const float oneOverSqrtOf2 = 0.707106781186547524400844362104849039284835937688474036588;

vec2 cMult(vec2 a, vec2 b){
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cAdd(vec2 a, vec2 b){
  return vec2(a.x + b.x, a.y + b.y);
}

vec2 conjugate(vec2 a){
  return vec2(a.x, -1.0 * a.y);
}

float fModulo(float a, float b){
  return (a - (b * floor(a / b)));
}

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec2 x = uv.xy * N;
  float k = fModulo(x.y * N / pow(2.0, x.x + 1.0), N);
  vec2 twiddle = vec2(cos(piTimes2 * k / N), sin(piTimes2 * k / N));
  int butterflySpan = int(pow(2.0, x.x));
  int butterflyWing = 0.0;

  if(fModulo(x.y, pow(2.0, x.x + 1.0)) < pow(2.0, x.x)){
    butterflyWing = 1.0;
  }

  //First stage bit reversed indices
  if(x.x == 0){
    //Top butterfly wing
    if(butterflyWing == 1){
      gl_FragColor = vec4(twiddle.x, twiddle.y, indices[int(x.y)], indices[int(x.y + 1.0)]);
    }
    else{

    }
  }
  else{
    //Top butterfly wing
    if(butterflyWing == 1){
      gl_FragColor = vec4(twiddle.x, twiddle.y, indices[int(x.y)], indices[int(x.y + 1.0)]);
    }
    else{

    }
  }
}
