#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

uniform sampler2D butterflyTexture;
uniform float N;

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  float outputputColor = texture2D(butterflyTexture, uv).x / (N * N);
  gl_FragColor = vec4(vec3(outputputColor), 1.0);
}
