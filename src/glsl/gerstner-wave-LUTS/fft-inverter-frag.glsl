#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

varying vec3 vWorldPosition;

//With a lot of help from https://youtu.be/8kgpxtggFog
uniform sampler2D pingpongTexture;
uniform int pingpong;
uniform float oneOverNSquared;

//We might want to do this in the vertex shader rather then
//running through another shader pass for this.
void main(){
  vec2 position = vWorldPosition.xy * N;
  float h = texture2D(pingpongTexture, position).r;
  gl_FragColor = vec4(vec3(h * oneOverNSquared), 1.0);
}
