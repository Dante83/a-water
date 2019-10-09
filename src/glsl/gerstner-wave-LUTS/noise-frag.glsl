#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

//varying vec2 vWorldPosition;

uniform vec2 uImgSize;
uniform float offset;

//Additional work here to add more noise that is time dependent
float fModulo(float a, float b){
  return (a - (b * floor(a / b)));
}

//From http://byteblacksmith.com/improvements-to-the-canonical-one-liner-glsl-rand-for-opengl-es-2-0/
float rand(float x){
    float a = 12.9898;
    float b = 78.233;
    float c = 43758.5453;
    float dt= dot(vec2(x, x) ,vec2(a,b));
    float sn= mod(dt,3.14);
    return fract(sin(sn) * c);
}

void main(){
  //vec2 uv = vWorldPosition.xy / resolution.xy;
  //vec2 uv = vec2(1.0);
  //gl_FragColor = vec4(vec3(rand((uImgSize.x * (uv.x + uv.y * uImgSize.y)) * offset)), 1.0);
  gl_FragColor = vec4(1.0, 1.0, 0.0, 1.0);
}
