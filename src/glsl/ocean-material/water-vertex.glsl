precision highp float;

attribute vec3 tangent;
attribute vec3 bitangent;

varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec3 vInView;
varying mat4 vInstanceMatrix;
varying mat4 vModelMatrix;
varying mat3 vNormalMatrix;

uniform float sizeOfOceanPatch;
uniform sampler2D displacementMap;
uniform float linearScatteringHeightOffset;
uniform float linearScatteringTotalScatteringWaveHeight;

#include <fog_pars_vertex>

vec2 vec2Modulo(vec2 inputUV){
    return (inputUV - floor(inputUV));
}

//Hash-based value noise to break FFT tiling repetition at distance
float hash(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbmNoise(vec2 p){
  float v = 0.0;
  v += 0.5 * valueNoise(p);
  v += 0.25 * valueNoise(p * 2.03);
  v += 0.125 * valueNoise(p * 4.01);
  return v / 0.875;
}

void main() {
  //Set up our displacement map
  vec3 offsetPosition = position;
  mat3 instanceMatrixMat3 = mat3(instanceMatrix[0].xyz, instanceMatrix[1].xyz, instanceMatrix[2].xyz );
  mat3 modelMatrixMat3 = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz );

  vec2 cameraOffset = vec2(cameraPosition.x, cameraPosition.z);
  vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));
  float distanceToVertex = distance(cameraPosition.xyz, worldPositionOfVertex.xyz);
  vec2 uvOffset = (uv * sizeOfOceanPatch + cameraOffset) / sizeOfOceanPatch;
  //Fade FFT displacement proportional to mesh LOD to prevent vertex-density aliasing
  //Matches LOD curve: full detail near camera, tapers as tessellation drops
  float lodFactor = clamp(1.0 - distanceToVertex / (sizeOfOceanPatch * 7.0), 0.0, 1.0);
  float displacementFade = mix(0.15, 1.0, lodFactor * lodFactor);
  vec3 displacement = texture2D(displacementMap, uvOffset).xyz * displacementFade;
  displacement.x *= -1.0;
  displacement.z *= -1.0;

  //Add procedural noise that fades in with distance to break FFT tiling repetition
  float noiseFadeIn = smoothstep(200.0, 1500.0, distanceToVertex);
  float noiseHeight = (fbmNoise(worldPositionOfVertex.xz * 0.003) - 0.5) * 2.0;
  displacement.y += noiseHeight * noiseFadeIn * linearScatteringTotalScatteringWaveHeight * 0.15;

  offsetPosition += displacement;

  //Set up our varyings
  vUv = uv;
  vTangent = tangent;
  vBitangent = bitangent;
  vPosition = position;
  //From https://stackoverflow.com/questions/59492385/angle-between-view-vector-and-normal
  vec4 posInView = (modelViewMatrix * instanceMatrix * vec4(offsetPosition, 1.0));
  posInView /= posInView[3];
  vInView = normalize(-posInView.xyz);
  vInstanceMatrix = instanceMatrix;
  vModelMatrix = modelMatrix;
  vNormalMatrix = normalMatrix;

  //Add support for three.js fog
  #include <fog_vertex>

  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
}
