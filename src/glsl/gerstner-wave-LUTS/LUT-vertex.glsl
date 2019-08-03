#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

varying vec3 vWorldPosition;

void main() {
  gl_Position = vec4(position, 1.0);
}
