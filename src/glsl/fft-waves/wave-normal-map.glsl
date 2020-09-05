precision highp float;

uniform sampler2D waveHeightTexture;

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec2 onePixel = 1.0 / resolution.xy;

  //Origin
  vec3 s01 = texture2D(waveHeightTexture, uv).xyz;

  //Get all of our vertices top to bottom, left to right
  vec3 texOffset = texture2D(waveHeightTexture, uv + vec2(-onePixel.x, onePixel.y)).xyz;
  vec3 v00 = vec3(-onePixel.x, 0.0, onePixel.y) + vec3(-texOffset.x, texOffset.y, -texOffset.z);
  texOffset = texture2D(waveHeightTexture, uv + vec2(0.0, onePixel.y)).xyz;
  vec3 v10 = vec3(0.0, 0.0, onePixel.y) + vec3(-texOffset.x, texOffset.y, -texOffset.z);
  texOffset = texture2D(waveHeightTexture, uv + vec2(onePixel.x, onePixel.y)).xyz;
  vec3 v20 = vec3(onePixel.x, 0.0, onePixel.y) + vec3(-texOffset.x, texOffset.y, -texOffset.z);

  texOffset = texture2D(waveHeightTexture, uv + vec2(-onePixel.x, 0.0)).xyz;
  vec3 v01 = vec3(-onePixel.x, 0.0, 0.0) + vec3(-texOffset.x, texOffset.y, -texOffset.z);
  texOffset = texture2D(waveHeightTexture, uv + vec2(onePixel.x, 0.0)).xyz;
  vec3 v11 = vec3(onePixel.x, 0.0, 0.0) + vec3(-texOffset.x, texOffset.y, -texOffset.z);

  texOffset = texture2D(waveHeightTexture, uv + vec2(-onePixel.x, -onePixel.y)).xyz;
  vec3 v02 = vec3(-onePixel.x, 0.0, -onePixel.y) + vec3(-texOffset.x, texOffset.y, -texOffset.z);
  texOffset = texture2D(waveHeightTexture, uv + vec2(0.0, -onePixel.y)).xyz;
  vec3 v12 = vec3(0.0, 0.0, -onePixel.y) + vec3(-texOffset.x, texOffset.y, -texOffset.z);
  texOffset = texture2D(waveHeightTexture, uv + vec2(onePixel.x, -onePixel.y)).xyz;
  vec3 v22 = vec3(onePixel.x, 0.0, -onePixel.y) + vec3(-texOffset.x, texOffset.y, -texOffset.z);

  //Get each of our triangles along with their area
  vec3 potentialSum = cross(v01, v00);
  vec3 sum = potentialSum.y > 0.0 ? potentialSum : -potentialSum;
  potentialSum = cross(v00, v10);
  sum += potentialSum.y > 0.0 ? potentialSum : -potentialSum;
  potentialSum = cross(v10, v20);
  sum += potentialSum.y > 0.0 ? potentialSum : -potentialSum;
  potentialSum = cross(v20, v11);
  sum += potentialSum.y > 0.0 ? potentialSum : -potentialSum;

  potentialSum = cross(v11, v22);
  sum += potentialSum.y > 0.0 ? potentialSum : -potentialSum;
  potentialSum = cross(v22, v12);
  sum += potentialSum.y > 0.0 ? potentialSum : -potentialSum;
  potentialSum = cross(v12, v02);
  sum += potentialSum.y > 0.0 ? potentialSum : -potentialSum;
  potentialSum = cross(v02, v01);
  sum += potentialSum.y > 0.0 ? potentialSum : -potentialSum;

  gl_FragColor = vec4(normalize(sum), 1.0);
}
