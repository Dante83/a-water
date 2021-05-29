precision highp float;

uniform sampler2D waveHeightTexture;
uniform float halfWidthOfPatchOverWaveScaleFactor;

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  gl_FragColor = vec4(vec3(1.0), 1.0);
}
