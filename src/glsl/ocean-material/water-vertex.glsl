precision highp float;

attribute vec3 tangent;
attribute vec3 bitangent;

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

uniform float sizeOfOceanPatch;
uniform sampler2D cascadeDisplacementTextures[6];
uniform float cascadePatchSizes[6];
uniform float waveHeightMultiplier;
uniform float chop;

#if(!$atmospheric_perspective_enabled)
  #include <fog_pars_vertex>
#endif


void main() {
  vec3 offsetPosition = position;
  mat3 instanceMatrixMat3 = mat3(instanceMatrix[0].xyz, instanceMatrix[1].xyz, instanceMatrix[2].xyz );
  mat3 modelMatrixMat3 = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz );

  vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));
  float distanceToVertex = distance(cameraPosition.xyz, worldPositionOfVertex.xyz);
  vec2 worldXZ = worldPositionOfVertex.xz;

  //Per-cascade displacement fade: fine cascades fade out at distance so coarse mesh
  //tessellation doesn't have to follow sub-mesh-resolution wave shapes.
  //Each cascade fades over 10x its patch size — same ratio as fragment normal weighting.
  vec3 displacement = vec3(0.0);
  displacement += texture2D(cascadeDisplacementTextures[0], worldXZ / cascadePatchSizes[0]).xyz;
  displacement += texture2D(cascadeDisplacementTextures[1], worldXZ / cascadePatchSizes[1]).xyz;
  displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[2] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[2], worldXZ / cascadePatchSizes[2]).xyz;
  displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[3] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[3], worldXZ / cascadePatchSizes[3]).xyz;
  displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[4] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[4], worldXZ / cascadePatchSizes[4]).xyz;
  displacement += clamp(1.0 - distanceToVertex / (cascadePatchSizes[5] * 10.0), 0.0, 1.0) * texture2D(cascadeDisplacementTextures[5], worldXZ / cascadePatchSizes[5]).xyz;
  displacement *= waveHeightMultiplier;
  displacement.x *= -chop;
  displacement.z *= -chop;

  offsetPosition += displacement;

  //Set up our varyings
  vUv = uv;
  vWorldXZ = worldPositionOfVertex.xz;
  vDisplacedPosition = offsetPosition;
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
  #if(!$atmospheric_perspective_enabled)
    #include <fog_vertex>
  #endif

  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);
}
