varying vec3 vWorldPosition;

uniform sampler2D displacementMap;

float fModulo1(float a){
  return (a - floor(a));
}

void main(){
  vec2 position = gl_FragCoord.xy / resolution.xy;
  float sizeExpansion = (resolution.x + 1.0) / resolution.x; //Expand by exactly one pixel
  vec2 uv = sizeExpansion * position;
  vec2 wrappedUV = vec2(fModulo1(uv.x), fModulo1(uv.y));

  vec2 waveDisplacement = texture2D(displacementMap, wrappedUV).xz;

  //Get jacobian from the displacement and use this to determine the amount of foam
  float jacobian = dFdx(waveDisplacement.x) * dFdy(waveDisplacement.y) - dFdy(waveDisplacement.x) * dFdx(waveDisplacement.y);
  float foamAmount = clamp(clamp(jacobian, 0.0, 1.0) - 0.9, 0.0, 1.0);

  gl_FragColor = vec4(vec3(foamAmount), 1.0);
}
