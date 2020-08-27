precision highp float;

uniform sampler2D combinedWaveHeights;
uniform float N;

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  float outputputColor = texture2D(combinedWaveHeights, uv).x / (N * N);
  gl_FragColor = vec4(vec3(outputColor), 1.0);
}
