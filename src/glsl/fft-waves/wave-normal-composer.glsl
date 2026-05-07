uniform sampler2D displacementTexture;
uniform float texelSize;
uniform float patchSize;
uniform float chop;

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  //Sobel 3x3: sample displacement at all 8 neighbors + center
  vec3 rawTL = texture2D(displacementTexture, uv + vec2(-texelSize, -texelSize)).xyz;
  vec3 rawT  = texture2D(displacementTexture, uv + vec2(       0.0, -texelSize)).xyz;
  vec3 rawTR = texture2D(displacementTexture, uv + vec2( texelSize, -texelSize)).xyz;
  vec3 rawL  = texture2D(displacementTexture, uv + vec2(-texelSize,        0.0)).xyz;
  vec3 rawR  = texture2D(displacementTexture, uv + vec2( texelSize,        0.0)).xyz;
  vec3 rawBL = texture2D(displacementTexture, uv + vec2(-texelSize,  texelSize)).xyz;
  vec3 rawB  = texture2D(displacementTexture, uv + vec2(       0.0,  texelSize)).xyz;
  vec3 rawBR = texture2D(displacementTexture, uv + vec2( texelSize,  texelSize)).xyz;

  //Compute Jacobian for foam FIRST using raw values (before sign inversion)
  //Use world-space derivatives for proper Jacobian of horizontal displacement
  //Scale by chop to match actual vertex positions (vertex shader applies -chop to xz)
  float worldStepFoam = patchSize * texelSize;
  vec2 foamDdx = -chop * (rawR.xz - rawL.xz) / (2.0 * worldStepFoam);
  vec2 foamDdy = -chop * (rawB.xz - rawT.xz) / (2.0 * worldStepFoam);
  float jacobian = (1.0 + foamDdx.x) * (1.0 + foamDdy.y) - foamDdx.y * foamDdy.x;
  //Foam where surface compresses (J below 1). Original (0.1, 1.0) was too
  //conservative; full (0.0, 0.5) painted every wave back. (0.05, 0.7) is the
  //middle: ordinary steep crests get a thin foam line, only true breakers
  //saturate the alpha channel.
  float turbulence = max(0.0, 1.0 - jacobian);
  float foam = smoothstep(0.05, 0.7, turbulence);

  //Apply sign inversion + chop scaling for normals (matching water shader convention)
  vec3 dispTL = rawTL; dispTL.x *= -chop; dispTL.z *= -chop;
  vec3 dispT  = rawT;  dispT.x  *= -chop; dispT.z  *= -chop;
  vec3 dispTR = rawTR; dispTR.x *= -chop; dispTR.z *= -chop;
  vec3 dispL  = rawL;  dispL.x  *= -chop; dispL.z  *= -chop;
  vec3 dispR  = rawR;  dispR.x  *= -chop; dispR.z  *= -chop;
  vec3 dispBL = rawBL; dispBL.x *= -chop; dispBL.z *= -chop;
  vec3 dispB  = rawB;  dispB.x  *= -chop; dispB.z  *= -chop;
  vec3 dispBR = rawBR; dispBR.x *= -chop; dispBR.z *= -chop;

  //World-space step between samples
  float worldStep = patchSize * texelSize;

  //Sobel 3x3 partial derivatives (weighted central differences)
  vec3 dPdx = ((dispTR + 2.0 * dispR + dispBR) - (dispTL + 2.0 * dispL + dispBL)) / (8.0 * worldStep);
  vec3 dPdz = ((dispBL + 2.0 * dispB + dispBR) - (dispTL + 2.0 * dispT + dispTR)) / (8.0 * worldStep);

  //Surface tangent vectors (flat plane is XZ, height is Y)
  vec3 Tx = vec3(1.0 + dPdx.x, dPdx.y, dPdx.z);
  vec3 Tz = vec3(dPdz.x, dPdz.y, 1.0 + dPdz.z);

  vec3 normal = normalize(cross(Tz, Tx));

  //Ensure normal points upward (Y > 0)
  if(normal.y < 0.0) normal = -normal;

  //Where the surface folds (Jacobian near zero or negative), the normal is unreliable
  //Blend toward flat (0,1,0) to eliminate artifacts at sharp ridges
  float foldBlend = smoothstep(0.0, 0.3, jacobian);
  normal = mix(vec3(0.0, 1.0, 0.0), normal, foldBlend);

  //Pack normal into [0,1] range, foam in alpha
  gl_FragColor = vec4(normal * 0.5 + 0.5, foam);
}
