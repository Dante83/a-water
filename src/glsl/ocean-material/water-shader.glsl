precision highp float;

varying vec2 vUv;
varying vec2 vWorldXZ;
varying vec3 vPosition;
varying vec3 vDisplacedPosition;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec3 vInView;
varying mat4 vInstanceMatrix;
varying mat4 vModelMatrix;
varying mat3 vNormalMatrix;

//uniform vec3 cameraDirection;
uniform float sizeOfOceanPatch;
uniform float chop;
uniform float largeNormalMapStrength;
uniform float smallNormalMapStrength;
uniform float baseHeightOffset;
uniform sampler2D cascadeDisplacementTextures[6];
uniform float cascadePatchSizes[6];
uniform float waveHeightMultiplier;
uniform sampler2D smallNormalMap;
uniform sampler2D largeNormalMap;
uniform sampler2D exclusionMap;
uniform sampler2D reflectionTexture;
uniform sampler2D refractionColorTexture;
uniform sampler2D refractionDepthTexture;
uniform vec2 screenResolution;
uniform vec2 cameraNearFar;
uniform mat4 inverseProjectionMatrix;
uniform mat4 inverseViewMatrix;
uniform mat4 reflectionViewProjectionMatrix;

#if($caustics_enabled)
  uniform sampler2D causticMap;
  uniform float causticIntensityMultiplier;
#endif

#if($foam_enabled)
  //Foam maps
  uniform sampler2D foamRenderMap;
  uniform sampler2D foamDiffuseMap;
  uniform sampler2D foamOpacityMap;
  uniform sampler2D foamNormalMap;
  uniform sampler2D foamRoughnessMap;
  uniform float foamStartLevel;
#endif

uniform vec2 smallNormalMapVelocity;
uniform vec2 largeNormalMapVelocity;

uniform vec3 brightestDirectionalLight;
uniform vec3 brightestDirectionalLightDirection;
uniform vec3 waterAbsorption;
uniform vec3 waterScattering;
uniform float waterMieG;

uniform float linearScatteringHeightOffset;
uniform float linearScatteringTotalScatteringWaveHeight;

uniform float t;
uniform float patchDataSize;

//Fog variables
#if(!$atmospheric_perspective_enabled)
  #include <fog_pars_fragment>
#endif

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

uniform sampler2D blueNoiseTexture;
uniform float blueNoiseTime;


//R0 For Schlick's Approximation
//With n1 = 1.33 and n0 = 1.0
const float r0 = 0.02;
const vec3 inverseGamma = vec3(0.454545454545454545454545);
const vec3 gamma = vec3(2.2);

vec2 vec2Modulo(vec2 inputUV){
  return (inputUV - floor(inputUV));
}

float linearizeDepth(float depthSample){
  float near = cameraNearFar.x;
  float far = cameraNearFar.y;
  return near * far / (far - depthSample * (far - near));
}

#if(!$atmospheric_perspective_enabled)
  //When atmospheric perspective is enabled, sRGBToLinear is provided by the injected atmosphere functions
  vec4 sRGBToLinear( in vec4 value ) {
  	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
  }
#endif

vec4 linearTosRGB(vec4 value ) {
  return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}

//From https://blog.selfshadow.com/publications/blending-in-detail/
vec3 combineNormals(vec3 normal1, vec3 normal2){
  vec4 n1 = vec4(normal1.xyz, 1.0);
  vec4 n2 = vec4(normal2.xyz, 1.0);
  n1 = n1.xyzz * vec4(2.0, 2.0, 2.0, -2.0) + vec4(-1.0, -1.0, -1.0, 1.0);
  n2 = n2 * 2.0 - vec4(1.0);
  vec3 r;
  r.x = dot(n1.zxx,  n2.xyz);
  r.y = dot(n1.yzy,  n2.xyz);
  r.z = dot(n1.xyw, -n2.xyz);

  return 0.5 * (normalize(r) + vec3(1.0));
}

//Including this because someone removed this in a future versio of THREE. Why?!
vec3 MyAESFilmicToneMapping(vec3 color) {
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}

//Henyey-Greenstein phase function for Mie scattering in water
//g = asymmetry parameter (0.85-0.95 for ocean particles, strongly forward-scattering)
float waterMiePhase(float cosTheta, float g){
  float g2 = g * g;
  float denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * 3.14159265 * denom * sqrt(denom));
}

//Fresnel reflectance at air->water interface (for light entering the water from above)
//Schlick approximation with n_water = 1.33
float fresnelAirToWater(float cosTheta){
  float r0 = 0.02;
  return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
}

#if($caustics_enabled)
  float causticShader(vec2 uv, float t){
    float tModified = (t / 20.0);
    vec2 uv1 = uv + vec2(0.8, 0.1) * tModified;
    vec2 uv2 = uv - vec2(0.2, 0.7) * tModified;
    float aSample1 = texture(causticMap, uv1).r;
    float aSample2 = texture(causticMap, uv2).g;
    return min(aSample1, aSample2);
  }
#endif

//Converted from the Minstrel Water Engine
/*
MIT License

Copyright (c) 2018 Jingping Yu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
#if($foam_enabled)
  //Foam amount is now pre-computed in the FFT normal map alpha channel
#endif

#if($atmospheric_perspective_enabled)
  //Atmospheric perspective for ground-level surfaces.
  //Uses distance-based extinction with LUT-sampled multi-scattered inscattering.
  //At the same height: S(A->B) = S(A->inf) * (1 - T(A->B))
  vec3 applyAtmosphericPerspective(vec3 color, vec3 worldPos){
    vec3 worldViewDir = normalize(worldPos - cameraPosition);
    //Convert view direction from THREE.js world space to a-starry-sky's coordinate
    //system. Sun world direction = (-sp.z, sp.y, -sp.x) from quadOffset, so the
    //inverse transform from world to sky coords is: skyDir = (-world.z, world.y, -world.x)
    vec3 viewDir = vec3(-worldViewDir.z, worldViewDir.y, -worldViewDir.x);
    float dist = length(worldPos - cameraPosition) * METERS_TO_KM * atmDistanceScale;

    //Distance-based extinction along the camera-to-surface path
    vec3 extinction = exp(-(RAYLEIGH_BETA + EARTH_MIE_BETA_EXTINCTION) * dist);

    //Attenuate surface color
    color *= extinction;

    //LUT coordinates for inscattering lookup
    float viewCosZenith = max(viewDir.y, 0.0);
    float xParam = parameterizationOfCosOfViewZenithToX(viewCosZenith);
    float yHeight = parameterizationOfHeightToY(RADIUS_OF_EARTH + atmCameraHeight);

    //Sun inscattering from 3D LUTs
    float zSun = parameterizationOfCosOfSourceZenithToZ(max(atmSunPosition.y, 0.0));
    vec3 uv3Sun = vec3(xParam, yHeight, zSun);
    vec3 mieSun = texture(atmosphereMieInscattering, uv3Sun).rgb;
    vec3 raySun = texture(atmosphereRayleighInscattering, uv3Sun).rgb;
    float cosViewSun = dot(viewDir, atmSunPosition);
    vec3 fogSun = pow(atmSunHorizonFade, 3.0) * atmScatteringSunIntensity
                * (miePhaseFunction(cosViewSun) * mieSun + rayleighPhaseFunction(cosViewSun) * raySun)
                * (1.0 - extinction);

    //Moon inscattering from 3D LUTs
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
  mat3 instanceMatrixMat3 = mat3(vInstanceMatrix[0].xyz, vInstanceMatrix[1].xyz, vInstanceMatrix[2].xyz );
  mat3 modelMatrixMat3 = mat3(vModelMatrix[0].xyz, vModelMatrix[1].xyz, vModelMatrix[2].xyz );

  //Use the displaced position from the vertex shader directly — ensures worldPosition
  //matches the actual geometry (vertex shader applies displacementFade; resampling here
  //would skip that, causing LOD tile edge divergence).
  vec3 offsetPosition = vDisplacedPosition;
  //Still need displacement for height-based effects (translucency, scattering)
  vec3 displacement = offsetPosition - vPosition;
  float height = (offsetPosition.y + linearScatteringHeightOffset) / linearScatteringTotalScatteringWaveHeight;
  vec4 worldPosition = vModelMatrix * vInstanceMatrix * vec4(offsetPosition, 1.0);
  vec2 exclusionPosition = 0.5 * (((worldPosition.xz - cameraPosition.xz) / vec2(1024.0)) + 1.0);
  exclusionPosition = vec2(exclusionPosition.x, 1.0 - exclusionPosition.y);
  if(exclusionPosition.x < 1.0 && exclusionPosition.x > 0.0 && exclusionPosition.y < 1.0 && exclusionPosition.y > 0.0){
    vec2 discardHeightData = texture2D(exclusionMap, exclusionPosition).ga;
    float discardHeight = discardHeightData.x;
    if((discardHeightData.y > 0.5) && worldPosition.y > discardHeight){
      discard;
    }
  }
  float distanceToWorldPosition = distance(worldPosition.xyz, cameraPosition.xyz);
  float LOD = pow(2.0, clamp(7.0 - (distanceToWorldPosition / (sizeOfOceanPatch * 7.0)), 2.0, 7.0));

  //Compute surface normal inline from per-cascade displacements via central differences.
  //Each cascade is sampled at its own world-space UV — no tile-boundary seams.
  //Accumulate gradients dPdx/dPdz across all cascades, then compute the cross-product normal.
  float normalLodFactor = clamp(1.0 - distanceToWorldPosition / (sizeOfOceanPatch * 7.0), 0.0, 1.0);
  float normalDetailFade = mix(0.15, 1.0, normalLodFactor * normalLodFactor);
  vec3 totalDPdx = vec3(0.0);
  vec3 totalDPdz = vec3(0.0);
  vec2 rawDdxXZ = vec2(0.0);
  vec2 rawDdzXZ = vec2(0.0);

  //Cascade 0 — Sobel 3x3 for normals; simple central diff for Jacobian
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[0] / patchDataSize;
    vec2 uv = vWorldXZ / cascadePatchSizes[0];
    vec3 rawBL = texture2D(cascadeDisplacementTextures[0], uv + vec2(-eps, -eps)).xyz;
    vec3 rawB  = texture2D(cascadeDisplacementTextures[0], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawBR = texture2D(cascadeDisplacementTextures[0], uv + vec2( eps, -eps)).xyz;
    vec3 rawL  = texture2D(cascadeDisplacementTextures[0], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR  = texture2D(cascadeDisplacementTextures[0], uv + vec2( eps,  0.0)).xyz;
    vec3 rawTL = texture2D(cascadeDisplacementTextures[0], uv + vec2(-eps,  eps)).xyz;
    vec3 rawT  = texture2D(cascadeDisplacementTextures[0], uv + vec2( 0.0,  eps)).xyz;
    vec3 rawTR = texture2D(cascadeDisplacementTextures[0], uv + vec2( eps,  eps)).xyz;
    rawDdxXZ += (rawR.xz - rawL.xz) / (2.0 * worldStep);
    rawDdzXZ += (rawT.xz - rawB.xz) / (2.0 * worldStep);
    vec3 dBL = rawBL; dBL.x *= -chop; dBL.z *= -chop;
    vec3 dB  = rawB;  dB.x  *= -chop; dB.z  *= -chop;
    vec3 dBR = rawBR; dBR.x *= -chop; dBR.z *= -chop;
    vec3 dL  = rawL;  dL.x  *= -chop; dL.z  *= -chop;
    vec3 dR  = rawR;  dR.x  *= -chop; dR.z  *= -chop;
    vec3 dTL = rawTL; dTL.x *= -chop; dTL.z *= -chop;
    vec3 dT  = rawT;  dT.x  *= -chop; dT.z  *= -chop;
    vec3 dTR = rawTR; dTR.x *= -chop; dTR.z *= -chop;
    totalDPdx += ((dBR + 2.0*dR + dTR) - (dBL + 2.0*dL + dTL)) / (8.0 * worldStep);
    totalDPdz += ((dTL + 2.0*dT + dTR) - (dBL + 2.0*dB + dBR)) / (8.0 * worldStep);
  }
  //Cascade 1
  {
    float eps = 1.0 / patchDataSize;
    float worldStep = cascadePatchSizes[1] / patchDataSize;
    vec2 uv = vWorldXZ / cascadePatchSizes[1];
    vec3 rawBL = texture2D(cascadeDisplacementTextures[1], uv + vec2(-eps, -eps)).xyz;
    vec3 rawB  = texture2D(cascadeDisplacementTextures[1], uv + vec2( 0.0, -eps)).xyz;
    vec3 rawBR = texture2D(cascadeDisplacementTextures[1], uv + vec2( eps, -eps)).xyz;
    vec3 rawL  = texture2D(cascadeDisplacementTextures[1], uv + vec2(-eps,  0.0)).xyz;
    vec3 rawR  = texture2D(cascadeDisplacementTextures[1], uv + vec2( eps,  0.0)).xyz;
    vec3 rawTL = texture2D(cascadeDisplacementTextures[1], uv + vec2(-eps,  eps)).xyz;
    vec3 rawT  = texture2D(cascadeDisplacementTextures[1], uv + vec2( 0.0,  eps)).xyz;
    vec3 rawTR = texture2D(cascadeDisplacementTextures[1], uv + vec2( eps,  eps)).xyz;
    rawDdxXZ += (rawR.xz - rawL.xz) / (2.0 * worldStep);
    rawDdzXZ += (rawT.xz - rawB.xz) / (2.0 * worldStep);
    vec3 dBL = rawBL; dBL.x *= -chop; dBL.z *= -chop;
    vec3 dB  = rawB;  dB.x  *= -chop; dB.z  *= -chop;
    vec3 dBR = rawBR; dBR.x *= -chop; dBR.z *= -chop;
    vec3 dL  = rawL;  dL.x  *= -chop; dL.z  *= -chop;
    vec3 dR  = rawR;  dR.x  *= -chop; dR.z  *= -chop;
    vec3 dTL = rawTL; dTL.x *= -chop; dTL.z *= -chop;
    vec3 dT  = rawT;  dT.x  *= -chop; dT.z  *= -chop;
    vec3 dTR = rawTR; dTR.x *= -chop; dTR.z *= -chop;
    totalDPdx += ((dBR + 2.0*dR + dTR) - (dBL + 2.0*dL + dTL)) / (8.0 * worldStep);
    totalDPdz += ((dTL + 2.0*dT + dTR) - (dBL + 2.0*dB + dBR)) / (8.0 * worldStep);
  }
  //Cascade 2 (L=64m) — distance-weighted: fades out by 640m
  {
    float cascadeWeight2 = clamp(1.0 - distanceToWorldPosition / (cascadePatchSizes[2] * 10.0), 0.0, 1.0);
    if(cascadeWeight2 > 0.001){
      float eps = 1.0 / patchDataSize;
      float worldStep = cascadePatchSizes[2] / patchDataSize;
      vec2 uv = vWorldXZ / cascadePatchSizes[2];
      vec3 rawBL = texture2D(cascadeDisplacementTextures[2], uv + vec2(-eps, -eps)).xyz;
      vec3 rawB  = texture2D(cascadeDisplacementTextures[2], uv + vec2( 0.0, -eps)).xyz;
      vec3 rawBR = texture2D(cascadeDisplacementTextures[2], uv + vec2( eps, -eps)).xyz;
      vec3 rawL  = texture2D(cascadeDisplacementTextures[2], uv + vec2(-eps,  0.0)).xyz;
      vec3 rawR  = texture2D(cascadeDisplacementTextures[2], uv + vec2( eps,  0.0)).xyz;
      vec3 rawTL = texture2D(cascadeDisplacementTextures[2], uv + vec2(-eps,  eps)).xyz;
      vec3 rawT  = texture2D(cascadeDisplacementTextures[2], uv + vec2( 0.0,  eps)).xyz;
      vec3 rawTR = texture2D(cascadeDisplacementTextures[2], uv + vec2( eps,  eps)).xyz;
      rawDdxXZ += cascadeWeight2 * (rawR.xz - rawL.xz) / (2.0 * worldStep);
      rawDdzXZ += cascadeWeight2 * (rawT.xz - rawB.xz) / (2.0 * worldStep);
      vec3 dBL = rawBL; dBL.x *= -chop; dBL.z *= -chop;
      vec3 dB  = rawB;  dB.x  *= -chop; dB.z  *= -chop;
      vec3 dBR = rawBR; dBR.x *= -chop; dBR.z *= -chop;
      vec3 dL  = rawL;  dL.x  *= -chop; dL.z  *= -chop;
      vec3 dR  = rawR;  dR.x  *= -chop; dR.z  *= -chop;
      vec3 dTL = rawTL; dTL.x *= -chop; dTL.z *= -chop;
      vec3 dT  = rawT;  dT.x  *= -chop; dT.z  *= -chop;
      vec3 dTR = rawTR; dTR.x *= -chop; dTR.z *= -chop;
      totalDPdx += cascadeWeight2 * ((dBR + 2.0*dR + dTR) - (dBL + 2.0*dL + dTL)) / (8.0 * worldStep);
      totalDPdz += cascadeWeight2 * ((dTL + 2.0*dT + dTR) - (dBL + 2.0*dB + dBR)) / (8.0 * worldStep);
    }
  }
  //Cascade 3 (L=16m) — distance-weighted: fades out by 160m
  {
    float cascadeWeight3 = clamp(1.0 - distanceToWorldPosition / (cascadePatchSizes[3] * 10.0), 0.0, 1.0);
    if(cascadeWeight3 > 0.001){
      float eps = 1.0 / patchDataSize;
      float worldStep = cascadePatchSizes[3] / patchDataSize;
      vec2 uv = vWorldXZ / cascadePatchSizes[3];
      vec3 rawBL = texture2D(cascadeDisplacementTextures[3], uv + vec2(-eps, -eps)).xyz;
      vec3 rawB  = texture2D(cascadeDisplacementTextures[3], uv + vec2( 0.0, -eps)).xyz;
      vec3 rawBR = texture2D(cascadeDisplacementTextures[3], uv + vec2( eps, -eps)).xyz;
      vec3 rawL  = texture2D(cascadeDisplacementTextures[3], uv + vec2(-eps,  0.0)).xyz;
      vec3 rawR  = texture2D(cascadeDisplacementTextures[3], uv + vec2( eps,  0.0)).xyz;
      vec3 rawTL = texture2D(cascadeDisplacementTextures[3], uv + vec2(-eps,  eps)).xyz;
      vec3 rawT  = texture2D(cascadeDisplacementTextures[3], uv + vec2( 0.0,  eps)).xyz;
      vec3 rawTR = texture2D(cascadeDisplacementTextures[3], uv + vec2( eps,  eps)).xyz;
      rawDdxXZ += cascadeWeight3 * (rawR.xz - rawL.xz) / (2.0 * worldStep);
      rawDdzXZ += cascadeWeight3 * (rawT.xz - rawB.xz) / (2.0 * worldStep);
      vec3 dBL = rawBL; dBL.x *= -chop; dBL.z *= -chop;
      vec3 dB  = rawB;  dB.x  *= -chop; dB.z  *= -chop;
      vec3 dBR = rawBR; dBR.x *= -chop; dBR.z *= -chop;
      vec3 dL  = rawL;  dL.x  *= -chop; dL.z  *= -chop;
      vec3 dR  = rawR;  dR.x  *= -chop; dR.z  *= -chop;
      vec3 dTL = rawTL; dTL.x *= -chop; dTL.z *= -chop;
      vec3 dT  = rawT;  dT.x  *= -chop; dT.z  *= -chop;
      vec3 dTR = rawTR; dTR.x *= -chop; dTR.z *= -chop;
      totalDPdx += cascadeWeight3 * ((dBR + 2.0*dR + dTR) - (dBL + 2.0*dL + dTL)) / (8.0 * worldStep);
      totalDPdz += cascadeWeight3 * ((dTL + 2.0*dT + dTR) - (dBL + 2.0*dB + dBR)) / (8.0 * worldStep);
    }
  }
  //Cascades 4 (L=4m) and 5 (L=1m) are excluded from normal/Jacobian computation.
  //The small/large normal maps cover this frequency range close-up — adding both
  //doubles the micro-detail and floods the specular with too many bright facets.
  totalDPdx *= waveHeightMultiplier;
  totalDPdz *= waveHeightMultiplier;
  rawDdxXZ *= waveHeightMultiplier;
  rawDdzXZ *= waveHeightMultiplier;

  //Jacobian: detect surface folds for foam
  vec2 foamDdx = -chop * rawDdxXZ;
  vec2 foamDdz = -chop * rawDdzXZ;
  float jacobian = (1.0 + foamDdx.x) * (1.0 + foamDdz.y) - foamDdx.y * foamDdz.x;
  float turbulence = max(0.0, 1.0 - jacobian);
  float fftFoamAmount = smoothstep(0.1, 1.0, turbulence);

  //Surface tangent vectors → normal via cross product
  vec3 Tx = vec3(1.0 + totalDPdx.x, totalDPdx.y, totalDPdx.z);
  vec3 Tz = vec3(totalDPdz.x, totalDPdz.y, 1.0 + totalDPdz.z);
  vec3 displacedNormal = normalize(cross(Tz, Tx));
  if(displacedNormal.y < 0.0) displacedNormal = -displacedNormal;
  //Blend toward flat normal at fold points and at distance
  float foldBlend = smoothstep(0.0, 0.3, jacobian);
  displacedNormal = mix(vec3(0.0, 1.0, 0.0), displacedNormal, foldBlend * normalDetailFade);
  //The FFT normal is in object space (x, y, z) - swizzle to match expected xzy convention
  displacedNormal = displacedNormal.xzy;

  //Get the reflected and refracted information of the scene
  vec2 smallNormalMapOffset = (vWorldXZ + t * smallNormalMapVelocity) / (sizeOfOceanPatch / 2.0);
  vec2 largeNormalMapOffset = (vWorldXZ - t * largeNormalMapVelocity) / sizeOfOceanPatch;
  vec3 smallNormalMap = texture2D(smallNormalMap, smallNormalMapOffset).xyz;
  smallNormalMap = 2.0 * smallNormalMap - 1.0;
  float smallNormalMapFadeout = clamp((500.0 - distanceToWorldPosition) / 250.0, 0.0, 1.0);
  smallNormalMap.x *= smallNormalMapStrength * smallNormalMapFadeout;
  smallNormalMap.y *= smallNormalMapStrength * smallNormalMapFadeout;
  smallNormalMap = normalize(smallNormalMap);
  smallNormalMap = (smallNormalMap + 1.0) * 0.5;
  vec3 largeNormalMap = texture2D(largeNormalMap, largeNormalMapOffset).xyz;
  largeNormalMap = 2.0 * largeNormalMap - 1.0;
  float largeNormalMapFadeout = clamp((3000.0 - distanceToWorldPosition) / 2500.0, 0.0, 1.0);
  largeNormalMap.x *= largeNormalMapStrength * largeNormalMapFadeout;
  largeNormalMap.y *= largeNormalMapStrength * largeNormalMapFadeout;
  largeNormalMap = normalize(largeNormalMap);
  largeNormalMap = (largeNormalMap + 1.0) * 0.5;
  vec3 combinedNormalMap = combineNormals(smallNormalMap, largeNormalMap);
  #if($foam_enabled)
    vec3 foamNormal = texture2D(foamNormalMap, smallNormalMapOffset).xyz;
    foamNormal = 2.0 * foamNormal - 1.0;
    float foamAmount = fftFoamAmount;
    vec2 foamPosition = 0.5 * (((worldPosition.xz - cameraPosition.xz) / vec2(2048.0)) + 1.0);
    foamPosition = vec2(foamPosition.x, 1.0 - foamPosition.y);
    if(foamPosition.x < 1.0 && foamPosition.x > 0.0 && foamPosition.y < 1.0 && foamPosition.y > 0.0){
      vec2 foamHeightData = texture2D(foamRenderMap, foamPosition).ga;
      if((foamHeightData.y > 0.5)){
        foamAmount = max(foamAmount, 1.0 - abs(clamp(worldPosition.y - foamHeightData.x - 10.0, 0.0, 10.0) / 10.0));
      }
    }
    foamNormal.x *= 0.5 * foamAmount * largeNormalMapFadeout;
    foamNormal.y *= 0.5 * foamAmount * largeNormalMapFadeout;
    foamNormal = normalize(foamNormal);
    foamNormal = (foamNormal + 1.0) * 0.5;
    combinedNormalMap = combineNormals(combinedNormalMap, foamNormal);
  #endif
  vec3 normalizedDisplacedNormalMap = (normalize(displacedNormal) + vec3(1.0)) * 0.5;
  combinedNormalMap = combineNormals(normalizedDisplacedNormalMap, combinedNormalMap);
  combinedNormalMap = combinedNormalMap * 2.0 - vec3(1.0);
  combinedNormalMap = normalize(combinedNormalMap);
  combinedNormalMap = combinedNormalMap.xzy;

  vec3 normalizedViewVector = normalize(worldPosition.xyz - cameraPosition);
  vec2 screenUV = gl_FragCoord.xy / screenResolution;

  //Planar reflection: project world position through the reflection camera's VP matrix
  vec4 reflectionClipPos = reflectionViewProjectionMatrix * worldPosition;
  vec2 reflectionUV;
  if(reflectionClipPos.w > 0.0){
    reflectionUV = reflectionClipPos.xy / reflectionClipPos.w * 0.5 + 0.5;
    reflectionUV += combinedNormalMap.xz * 0.02; //Distort by surface normal
    reflectionUV = clamp(reflectionUV, 0.001, 0.999);
  } else {
    //Fragment is behind the reflection camera (heavily displaced crest) — use screen-space fallback
    reflectionUV = clamp(screenUV + combinedNormalMap.xz * 0.02, 0.001, 0.999);
  }
  vec3 reflectedLight = texture2D(reflectionTexture, reflectionUV).rgb;

  //At the horizon the reflection projection degenerates and samples black.
  //Detect near-black reflection samples and replace with a sky-area sample
  //from the reflection texture to avoid a dark seam at the horizon.
  float reflBrightness = dot(reflectedLight, vec3(0.299, 0.587, 0.114));
  vec3 horizonFallback = texture2D(reflectionTexture, vec2(0.5, 0.85)).rgb;
  reflectedLight = mix(reflectedLight, horizonFallback, 1.0 - smoothstep(0.0, 0.005, reflBrightness));

  //Screen-space refraction
  //Distort UVs based on the surface normal to simulate refraction
  vec2 distortion = combinedNormalMap.xz * 0.03;
  vec2 refractedUV = clamp(screenUV + distortion, 0.001, 0.999);

  //Sample refraction color and depth
  float refractionDepthRaw = texture2D(refractionDepthTexture, refractedUV).r;
  float refractionDepthLinear = linearizeDepth(refractionDepthRaw);
  float surfaceDepthLinear = linearizeDepth(gl_FragCoord.z);

  //If distorted UV samples something closer than the water surface, fall back to undistorted
  if(refractionDepthLinear < surfaceDepthLinear - 0.5){
    refractedUV = screenUV;
    refractionDepthRaw = texture2D(refractionDepthTexture, refractedUV).r;
    refractionDepthLinear = linearizeDepth(refractionDepthRaw);
  }

  vec3 refractedLight = texture2D(refractionColorTexture, refractedUV).rgb;

  //Reconstruct world-space position from refraction depth
  vec4 clipPos = vec4(refractedUV * 2.0 - 1.0, refractionDepthRaw * 2.0 - 1.0, 1.0);
  vec4 viewPos = inverseProjectionMatrix * clipPos;
  viewPos /= viewPos.w;
  vec3 pointXYZ = (inverseViewMatrix * viewPos).xyz;

  //Use the reconstructed Y position to distinguish underwater vs above-water geometry
  float distanceToPoint;
  bool isDeepWater;
  //Detect sky/far-plane fragments: if the refraction depth is near the far plane,
  //this is sky bleeding through, not real underwater geometry.
  bool isFarPlane = refractionDepthLinear > cameraNearFar.y * 0.99;
  if(!isFarPlane && pointXYZ.y < baseHeightOffset && refractionDepthLinear > surfaceDepthLinear){
    //Underwater geometry visible - use actual depth difference for scattering
    distanceToPoint = min(refractionDepthLinear - surfaceDepthLinear, 500.0);
    isDeepWater = false;
  }
  else{
    //Above-water geometry, sky, or far-plane - no background light survives this depth.
    //Zero out refracted light to prevent HDR sky/sun from bleeding through.
    distanceToPoint = 1000.0;
    isDeepWater = true;
  }

  //Physically-based underwater light transport
  //Extinction = absorption + scattering (Beer-Lambert for both)
  vec3 extinction = waterAbsorption + waterScattering;
  vec3 transmittance = exp(-extinction * distanceToPoint);

  refractedLight = sRGBToLinear(vec4(refractedLight, 1.0)).rgb;
  if(isDeepWater){
    refractedLight = vec3(0.0);
  }

  //Sun light entering the water column
  //Fresnel transmission at the air->water interface from above
  float sunCosZenith = max(dot(-brightestDirectionalLightDirection, vec3(0.0, 1.0, 0.0)), 0.0);
  float sunTransmission = 1.0 - fresnelAirToWater(sunCosZenith);

  //Mie phase function: how much scattered light reaches the camera
  //The scattered light must travel TOWARD the camera (-normalizedViewVector),
  //so the scattering angle is between the incoming sun direction and the
  //outgoing direction toward the camera.
  float cosViewSun = dot(-normalizedViewVector, brightestDirectionalLightDirection);
  float phaseSingle = waterMiePhase(cosViewSun, waterMieG);

  //Multi-scattering approximation: in a thick water column, repeated scattering
  //events isotropize the light field. Model this as an additive isotropic term.
  float phaseMulti = 1.0 / (4.0 * 3.14159265);

  //Single-scattering integral over the water column depth
  //integral of scattering * exp(-extinction * d) dd from 0 to depth
  //= (scattering / extinction) * (1 - exp(-extinction * depth))
  vec3 inscatterIntegral = waterScattering / max(extinction, vec3(0.0001)) * (1.0 - transmittance);

  //Combine single-scatter (directional Mie) and multi-scatter (isotropic).
  //Single-scatter dominates in thin water (wave crests). Multi-scatter fills
  //in the base color for deep water columns.
  vec3 inscatterLight = inscatterIntegral * (phaseSingle + phaseMulti) * sunTransmission * brightestDirectionalLight;

  //Wave-crest translucency: estimate light path thickness through the wave body.
  //At a crest the water is thin - light from the sun side passes through a short
  //path and exits toward the camera, giving the characteristic green-gold glow.
  //This only occurs when the crest is backlit (looking through the wave toward the sun).
  //
  //Thickness is approximated from wave height above base water level and the
  //angle between the surface normal and the sun direction. No ray marching needed -
  //just geometry: a steep wave face lit from behind has a very short internal path.
  float waveElevation = max(height, 0.0);
  float sunNormalDot = max(dot(combinedNormalMap, -brightestDirectionalLightDirection), 0.05);
  float minCrestThickness = 3.0;
  float crestThickness = max(linearScatteringTotalScatteringWaveHeight * (1.0 - waveElevation) / sunNormalDot, minCrestThickness);
  float waveThickness = mix(distanceToPoint, crestThickness, waveElevation);
  vec3 waveTransmittance = exp(-extinction * waveThickness);

  //Backlit factor: the translucent glow is only visible when looking through
  //the wave toward the sun. The view vector and light direction face toward each
  //other when backlit (dot < 0), so negate to get a positive value for backlit crests.
  float backlitFactor = max(-dot(normalizedViewVector, brightestDirectionalLightDirection), 0.0);
  backlitFactor *= backlitFactor;

  //Thin crests: transmitted sunlight passes through the wave body with its own
  //absorption color (green-gold for thin water), added on top of the volume inscatter.
  vec3 crestLight = waveTransmittance * sunTransmission * brightestDirectionalLight * waveElevation * backlitFactor;
  inscatterLight += crestLight;

  //Apply Schlick's approximation for the fresnel amount
  //https://graphicscompendium.com/raytracing/11-fresnel-beer

  float cosTheta = clamp(dot(combinedNormalMap, -normalizedViewVector), 0.0, 1.0);
  float fresnelFactor = r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
  reflectedLight = sRGBToLinear(vec4(reflectedLight, 1.0)).rgb;

  #if($caustics_enabled)
    //Calculate caustic lighting using reconstructed world position
    float causticLightingR = causticShader(0.01 * pointXYZ.xz + 0.005, t);
    float causticLightingG = causticShader(0.01 * pointXYZ.xz, t);
    float causticLightingB = causticShader(0.01 * pointXYZ.xz - 0.005, t);
    vec3 causticLighting = causticIntensityMultiplier * 20.0 * vec3(causticLightingR, causticLightingG, causticLightingB);
    if(distance(cameraPosition, pointXYZ.xyz) > 2500.0){
      causticLighting = vec3(1.0);
    }
    refractedLight *= (causticLighting);
  #endif
  refractedLight *= transmittance;

  //Calculate specular lighting and surface lighting
  float lightMag = length(brightestDirectionalLight);
  vec3 normalizedLightIntensity = lightMag > 0.001 ? brightestDirectionalLight / lightMag : vec3(0.0);
  vec3 directionalSurfaceLighting = normalizedLightIntensity * max(dot(combinedNormalMap, -brightestDirectionalLightDirection), 0.0);
  vec3 reflectedViewDir = reflect(normalizedViewVector, combinedNormalMap);
  float specularDot = max(dot(reflectedViewDir, -brightestDirectionalLightDirection), 0.0);
  float specularAmount = pow(specularDot, 200.0);
  vec3 specular = 1.7 * normalizedLightIntensity * specularAmount;

  //Total light
  vec3 totalLight = specular + (2.0 / 255.0) * directionalSurfaceLighting + (253.0 / 255.0) * ((inscatterLight + refractedLight) * (1.0 - fresnelFactor) + reflectedLight * fresnelFactor);
  #if($foam_enabled)
    float foamOpacity = foamAmount * texture2D(foamOpacityMap, smallNormalMapOffset).r;
    vec3 foamLight = texture2D(foamDiffuseMap, smallNormalMapOffset).rgb;
    totalLight = mix(totalLight, 2.0 * directionalSurfaceLighting * foamLight, (foamOpacity * foamAmount));
  #endif

  // #if($atmospheric_perspective_enabled)
  //   totalLight = applyAtmosphericPerspective(totalLight, worldPosition.xyz);
  // #endif

  gl_FragColor = linearTosRGB(vec4(MyAESFilmicToneMapping(totalLight), 1.0));

  //Blue noise dithering to break banding (same technique as a-starry-sky)
  float goldenRatio = 1.61803398875;
  float framePhase = fract(blueNoiseTime * 0.001);
  ivec2 temporalOffset = ivec2(
    128.0 * fract(framePhase * goldenRatio),
    128.0 * fract(framePhase * goldenRatio * goldenRatio)
  );
  gl_FragColor.rgb += (texelFetch(blueNoiseTexture, (ivec2(mod(gl_FragCoord.xy, 128.0)) + temporalOffset) % 128, 0).rgb - vec3(0.5)) / vec3(128.0);

  #if(!$atmospheric_perspective_enabled)
    #include <fog_fragment>
  #endif
}
