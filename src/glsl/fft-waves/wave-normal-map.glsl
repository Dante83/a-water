precision highp float;

uniform sampler2D waveHeightTexture;
const vec2 size = vec2(2.0,0.0);

vec2 fModulo1(vec2 a){
  return vec2((a.x - floor(a.x)), (a.y - floor(a.y)));
}

void main(){
  //By Kvark
  //https://stackoverflow.com/questions/5281261/generating-a-normal-map-from-a-height-map
  vec3 off = vec3(-1.0 / resolution.x, 0.0, 1.0 / resolution.y);
  float s11 = texture2D(waveHeightTexture, uv).y;
  float s01 = texture2D(waveHeightTexture, uv + off.xy).xyz;
  float s21 = texture2D(waveHeightTexture, uv + off.zy).xyz;
  float s10 = texture2D(waveHeightTexture, uv + off.yx).xyz;
  float s12 = texture2D(waveHeightTexture, uv + off.yz).xyz;
  vec3 va = normalize(s21 - s01);
  vec3 vb = normalize(s12 - s10);
  gl_FragColor = vec4(cross(va,vb), s11);
}
