varying vec3 vWorldPosition;

uniform sampler2D xWavetextures[$total_offsets];
uniform sampler2D yWavetextures[$total_offsets];
uniform sampler2D zWavetextures[$total_offsets];
uniform float cascadeScales[$total_offsets];
uniform float N;
uniform float waveHeightMultiplier;

float fModulo1(float a){
  return (a - floor(a));
}

void main(){
  vec2 position = gl_FragCoord.xy / resolution.xy;
  vec2 baseUV = position;
  vec3 combinedWaveHeight = vec3(0.0);

  //Interpolations
  float waveHeight_x;
  float waveHeight_y;
  float waveHeight_z;
  vec2 cascadeUV;

  $unrolled_wave_composer

  //Each cascade covers independent frequency bands — no overlap division needed
  gl_FragColor = vec4(waveHeightMultiplier * combinedWaveHeight, 1.0);
}
