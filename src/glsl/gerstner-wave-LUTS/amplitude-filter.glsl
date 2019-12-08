varying vec3 vWorldPosition;

uniform float centralAmplitude;
uniform float bandwidth;

void main(){
  vec2 position = gl_FragCoord.xy / resolution.xy;
  float maxBandwidth = centralAmplitude - bandwidth;
  float minBandwidth = centralAmplitude + bandwidth;

  vec2 hkTexel = texture2D(textureHk, position).rg;
  float redChannelOut = 0.0;
  if(hkTexel.r > minBandwidth && hkTexel.r <= centralAmplitude){
    redChannelOut = (hkTexel.r - minBandwidth) / (centralAmplitude - minBandwidth);
  }
  else if(hkTexel.r < maxBandwidth && hkTexel.r >= centralAmplitude){
    redChannelOut = (maxBandwidth - hkTexel.r) / (maxBandwidth - centralAmplitude);
  }

  float greenChannelOut = 0.0;
  if(hkTexel.g > minBandwidth && hkTexel.g <= centralAmplitude){
    greenChannelOut = (hkTexel.g - minBandwidth) / (centralAmplitude - minBandwidth);
  }
  else if(hkTexel.g < maxBandwidth && hkTexel.g >= centralAmplitude){
    greenChannelOut = (maxBandwidth - hkTexel.g) / (maxBandwidth - centralAmplitude);
  }

  gl_FragColor = vec4(redChannelOut, greenChannelOut, 0.0, 0.0);
}
