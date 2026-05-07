precision highp float;

varying vec3 vWorldPos;

#if($atmospheric_perspective_enabled)
  precision highp sampler3D;
  uniform sampler2D atmosphereTransmittance;
  uniform sampler3D atmosphereMieInscattering;
  uniform sampler3D atmosphereRayleighInscattering;
  uniform vec3 atmSunPosition;
  uniform vec3 atmMoonPosition;
  uniform float atmSunHorizonFade;
  uniform float atmMoonHorizonFade;
  uniform float atmScatteringSunIntensity;
  uniform float atmScatteringMoonIntensity;
  uniform vec3 atmMoonLightColor;
  uniform float atmCameraHeight;
  uniform float atmDistanceScale;

  //ATMOSPHERE_FUNCTIONS_INJECTION_POINT
#endif

//Pre-lit deep-water body color, computed CPU-side each frame to match the FFT
//ocean inscatterEquilibrium = waterAlbedo * (direct + ambient downwelling).
uniform vec3 oceanBodyColor;

//FFT cascade displacement maps + their world-space patch sizes / spatial offsets,
//pulled in from the same OceanHeightComposer the FFT ocean reads. We sample
//cascades 0+1 only (largest wavelengths) — at the distances this skirt covers
//the smaller cascades are sub-pixel and would only add aliasing.
uniform sampler2D cascadeDisplacementTextures[2];
uniform float cascadePatchSizes[2];
uniform vec2 cascadeSpatialOffsets[2];
uniform float patchDataSize;
uniform float waveHeightMultiplier;
uniform float chop;

//Schlick water-air r0 — same constant the FFT ocean uses (water-shader.glsl L182).
const float r0 = 0.02;

//Compute the same wave-displacement-derived surface normal the FFT ocean uses
//(water-shader.glsl L820-944), restricted to cascades 0+1 since the skirt only
//covers far distances where finer cascades are sub-pixel. Returns a normal that
//starts at (0,1,0) close to the camera and gradually picks up wave detail; an
//LOD fade collapses it back to flat at extreme distance, matching FFT outer
//tiles which do exactly the same fade.
vec3 computeWaveNormal(vec3 worldPos, float distanceToVertex){
  vec2 worldXZ = worldPos.xz;
  float normalLodFactor = clamp(1.0 - distanceToVertex / (cascadePatchSizes[0] * 7.0), 0.0, 1.0);
  float normalDetailFade = mix(0.15, 1.0, normalLodFactor * normalLodFactor);

  vec3 rawDdx = vec3(0.0);
  vec3 rawDdz = vec3(0.0);
  //Cascades unrolled — GLSL ES does not allow dynamic indexing of sampler arrays.
  //Same pattern the FFT ocean uses (water-shader.glsl L820+).
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[0] / patchDataSize;
    vec2 uv = (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0];
    vec3 rawL = texture2D(cascadeDisplacementTextures[0], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[0], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[0], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[0], uv + vec2( 0.0,  eps)).xyz;
    rawDdx += (rawR - rawL) / (2.0 * worldStep);
    rawDdz += (rawT - rawB) / (2.0 * worldStep);
  }
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[1] / patchDataSize;
    vec2 uv = (worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1];
    vec3 rawL = texture2D(cascadeDisplacementTextures[1], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR = texture2D(cascadeDisplacementTextures[1], uv + vec2( eps,  0.0)).xyz;
    vec3 rawB = texture2D(cascadeDisplacementTextures[1], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawT = texture2D(cascadeDisplacementTextures[1], uv + vec2( 0.0,  eps)).xyz;
    rawDdx += (rawR - rawL) / (2.0 * worldStep);
    rawDdz += (rawT - rawB) / (2.0 * worldStep);
  }
  rawDdx *= waveHeightMultiplier;
  rawDdz *= waveHeightMultiplier;

  vec2 totalSlope = vec2(rawDdx.y, rawDdz.y);
  vec3 Tx = vec3(1.0 - chop * rawDdx.x, totalSlope.x, -chop * rawDdx.z);
  vec3 Tz = vec3(-chop * rawDdz.x,      totalSlope.y, 1.0 - chop * rawDdz.z);
  vec3 n = normalize(cross(Tz, Tx));
  if(n.y < 0.0) n = -n;
  n = normalize(mix(vec3(0.0, 1.0, 0.0), n, normalDetailFade));
  if(n.y < 0.0) n = -n;
  return n;
}

#if($atmospheric_perspective_enabled)
  //Sky radiance along a world-space direction. Mirrors computeSkyRadiance() in
  //water-shader.glsl so the skirt Fresnel reflection matches the FFT ocean
  //SSR-fallback sky sample.
  vec3 computeSkyRadiance(vec3 worldDir){
    vec3 skyDir = vec3(-worldDir.z, worldDir.y, -worldDir.x);
    float viewCosZenith = max(skyDir.y, 0.0);
    float xParam = parameterizationOfCosOfViewZenithToX(viewCosZenith);
    float yHeight = parameterizationOfHeightToY(RADIUS_OF_EARTH + atmCameraHeight);

    float zSun = parameterizationOfCosOfSourceZenithToZ(max(atmSunPosition.y, 0.0));
    vec3 uv3Sun = vec3(xParam, yHeight, zSun);
    vec3 mieSun = texture(atmosphereMieInscattering, uv3Sun).rgb;
    vec3 raySun = texture(atmosphereRayleighInscattering, uv3Sun).rgb;
    float cosViewSun = dot(skyDir, atmSunPosition);
    vec3 skySun = pow(atmSunHorizonFade, 3.0) * atmScatteringSunIntensity
                * (miePhaseFunction(cosViewSun) * mieSun + rayleighPhaseFunction(cosViewSun) * raySun);

    float zMoon = parameterizationOfCosOfSourceZenithToZ(max(atmMoonPosition.y, 0.0));
    vec3 uv3Moon = vec3(xParam, yHeight, zMoon);
    vec3 mieMoon = texture(atmosphereMieInscattering, uv3Moon).rgb;
    vec3 rayMoon = texture(atmosphereRayleighInscattering, uv3Moon).rgb;
    float cosViewMoon = dot(skyDir, atmMoonPosition);
    vec3 skyMoon = pow(atmMoonHorizonFade, 3.0) * atmScatteringMoonIntensity * atmMoonLightColor
                 * (miePhaseFunction(cosViewMoon) * mieMoon + rayleighPhaseFunction(cosViewMoon) * rayMoon);

    vec3 transmittanceFade = texture(atmosphereTransmittance, vec2(xParam, yHeight)).rgb;
    vec3 baseSkyLighting = 0.25 * vec3(2E-3, 3.5E-3, 9E-3) * transmittanceFade;

    return skySun + skyMoon + baseSkyLighting;
  }

  //Mirrors applyAtmosphericPerspective() in water-shader.glsl.
  vec3 applyAtmosphericPerspective(vec3 color, vec3 worldPos){
    vec3 worldViewDir = normalize(worldPos - cameraPosition);
    vec3 viewDir = vec3(-worldViewDir.z, worldViewDir.y, -worldViewDir.x);
    float dist = length(worldPos - cameraPosition) * METERS_TO_KM * atmDistanceScale;

    vec3 extinction = exp(-(RAYLEIGH_BETA + EARTH_MIE_BETA_EXTINCTION) * dist);
    color *= extinction;

    float viewCosZenith = max(viewDir.y, 0.0);
    float xParam = parameterizationOfCosOfViewZenithToX(viewCosZenith);
    float yHeight = parameterizationOfHeightToY(RADIUS_OF_EARTH + atmCameraHeight);

    float zSun = parameterizationOfCosOfSourceZenithToZ(max(atmSunPosition.y, 0.0));
    vec3 uv3Sun = vec3(xParam, yHeight, zSun);
    vec3 mieSun = texture(atmosphereMieInscattering, uv3Sun).rgb;
    vec3 raySun = texture(atmosphereRayleighInscattering, uv3Sun).rgb;
    float cosViewSun = dot(viewDir, atmSunPosition);
    vec3 fogSun = pow(atmSunHorizonFade, 3.0) * atmScatteringSunIntensity
                * (miePhaseFunction(cosViewSun) * mieSun + rayleighPhaseFunction(cosViewSun) * raySun)
                * (1.0 - extinction);

    float zMoon = parameterizationOfCosOfSourceZenithToZ(max(atmMoonPosition.y, 0.0));
    vec3 uv3Moon = vec3(xParam, yHeight, zMoon);
    vec3 mieMoon = texture(atmosphereMieInscattering, uv3Moon).rgb;
    vec3 rayMoon = texture(atmosphereRayleighInscattering, uv3Moon).rgb;
    float cosViewMoon = dot(viewDir, atmMoonPosition);
    vec3 fogMoon = pow(atmMoonHorizonFade, 3.0) * atmScatteringMoonIntensity * atmMoonLightColor
                 * (miePhaseFunction(cosViewMoon) * mieMoon + rayleighPhaseFunction(cosViewMoon) * rayMoon)
                 * (1.0 - extinction);

    return color + fogSun + fogMoon;
  }
#endif

void main(){
  //Analytical hit point on the y=0 plane is just the interpolated vertex pos
  //(the ring lives in y=0 and barycentric interp on a flat plane is exact).
  vec3 worldViewDir = normalize(vWorldPos - cameraPosition);
  float distanceToVertex = length(vWorldPos - cameraPosition);

  //Wave-displaced normal sampled from the same cascade textures the FFT ocean
  //uses, so per-pixel Fresnel varies the same way wavy water does and the
  //skirt does NOT read as a perfect grazing mirror everywhere.
  vec3 normal = computeWaveNormal(vWorldPos, distanceToVertex);

  //Schlick Fresnel against the (now wave-tilted) normal — same form as
  //water-shader.glsl L1230. Wave faces tilted toward camera drop F well
  //below 1.0, exposing more body color.
  float cosTheta = clamp(dot(normal, -worldViewDir), 0.0, 1.0);
  float fresnelFactor = r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);

  vec3 color = oceanBodyColor;

#if($atmospheric_perspective_enabled)
  vec3 reflectDir = reflect(worldViewDir, normal);
  vec3 skyReflection = computeSkyRadiance(reflectDir);

  //Same Schlick split as water-shader.glsl L1329 (without the refracted +
  //specular + ambient terms — those need the full FFT light setup the skirt
  //does not have access to). Body weight = 1 - F, reflection weight = F.
  color = oceanBodyColor * (1.0 - fresnelFactor) + skyReflection * fresnelFactor;

  color = applyAtmosphericPerspective(color, vWorldPos);
#endif

  gl_FragColor = vec4(color, 1.0);
}
