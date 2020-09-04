precision highp float;

//attribute vec3 baseDepth;
varying vec3 vWorldPosition;
varying vec4 colorMap;
varying vec3 vNormal;
uniform sampler2D displacementMap;
uniform sampler2D normalMap;
uniform mat4 matrixWorld;

void main() {
  //Set up our normals
  vec3 normalMapNormal = texture2D(normalMap, uv).xzy;
  vec4 modelViewNormal = vec4(normalMapNormal, 1.0);
  vNormal = modelViewNormal.xyz;

  //Set up our displacement map
  vec3 offsetPosition = position;
  vec3 displacement = texture2D(displacementMap, uv).xyz;
  offsetPosition.x -= displacement.x;
  offsetPosition.z += displacement.y;
  offsetPosition.y -= displacement.z;
  vec4 worldPosition = matrixWorld * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz + displacement - cameraPosition;

  //Have the water fade from dark blue to teal as it approaches the shore.
  colorMap = vec4(displacement, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);
}
