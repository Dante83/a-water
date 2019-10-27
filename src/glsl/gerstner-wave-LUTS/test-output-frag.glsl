#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

uniform sampler2D inTexture;
varying vec2 vUv;

void main(){
  gl_FragColor = texture2D(inTexture, vUv);
}
