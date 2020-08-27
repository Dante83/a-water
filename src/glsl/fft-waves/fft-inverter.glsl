precision highp float;

//With a lot of help from https://youtu.be/8kgpxtggFog
uniform sampler2D pingpongTexture;
uniform float oneOverNSquared;

//We might want to do this in the vertex shader rather then
//running through another shader pass for this.
void main(){
  vec2 uv = vWorldPosition.xy;
  //float h = texture2D(pingpongTexture, position).r;
  //gl_FragColor = vec4(vec3(h * oneOverNSquared), 1.0);
  gl_FragColor = vec4(texture2D(pingpongTexture, position).r, 0.0, 0.0, 1.0);
}
