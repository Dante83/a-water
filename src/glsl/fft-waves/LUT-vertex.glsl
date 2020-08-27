precision highp float;

varying vec2 vUv;

void main() {
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vUv = uv;

  gl_Position = vec4(worldPosition.xy, 0.0, 1.0);
}
