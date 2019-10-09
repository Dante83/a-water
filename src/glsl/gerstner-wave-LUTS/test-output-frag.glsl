#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

varying vec3 vWorldPosition;
uniform sampler2D inTexture;

void main(){
  gl_FragColor = texture2D(inTexture, vWorldPosition.xy);
}
