varying vec3 vWorldPosition;

uniform sampler2D wavetextures[$numwaveTextures];
uniform float beginFadingHeight[$numwaveTextures];
uniform float vanishingHeight[$numwaveTextures];
uniform float cornerDepth[4];

void main(){
  vec2 position = gl_FragCoord.xy / resolution.xy;
  float combinedWaveHeight = 0.0;

  //Get our position in a values between 0 and 1 for easier work
  vec2 np = (position + vec2(1.0)) * 0.5;
  float weight = sqrt(np.x * np.x + np.y * np.y);
  float weights = weight;
  float weightedSum = weight * cornerDepth[0];
  weight = sqrt((1.0 - np.x) * (1.0 - np.x) + np.y * np.y);
  weights = weights + weight;
  weightedSum = weightedSum + weight * cornerDepth[1];
  weight = sqrt((1.0 - np.x) * (1.0 - np.x) + (1.0 - np.y) * (1.0 - np.y));
  weights = weights + weight;
  weightedSum = weightedSum + weight * cornerDepth[2];
  weight = sqrt(np.x * np.x + (1.0 - np.y) * (1.0 - np.y));
  weights = weights + weight;
  weightedSum = weightedSum + weight * cornerDepth[3];
  float waterDepth = weightedSum / weights;

  #pragma unroll
  for(int i = 0; i < $numwaveTextures; i++){
    float waveheight_i = texture2D(wavetextures[i], position).r;

    if(waterDepth > beginFadingHeight[i]){
      combinedWaveHeight += waveheight_i;
    }
    else if(waterDepth > vanishingHeight[i]){
      float heightModifier = clamp((waterDepth - vanishingHeight[i]) / (beginFadingHeight[i] - vanishingHeight[i]), 0.0, 1.0);
      combinedWaveHeight += heightModifier * waveheight_i;
    }
  }

  gl_FragColor = vec4(combinedWaveHeight, 0.0, 0.0, 0.0);
}
