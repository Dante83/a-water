precision highp float;

uniform sampler2D combinedWaveHeights;
uniform float N;
uniform float waveHeightMultiplier;

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  float outputputColor = waveHeightMultiplier * texture2D(combinedWaveHeights, uv).xyz / (N * N);

  gl_FragColor = vec4(vec3(outputColor), determinant);
}
