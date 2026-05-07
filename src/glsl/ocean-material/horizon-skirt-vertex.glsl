precision highp float;

varying vec3 vWorldPos;

void main(){
  vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos4.xyz;
  vec4 clipPos = projectionMatrix * viewMatrix * worldPos4;
  //Pin verts to (just inside) the far plane so the skirt's outer rim — which sits
  //tens of km past camera.far — survives near/far frustum clipping. The fragment
  //still depthTest:false-overwrites the sky dome and is overwritten by the FFT
  //ocean (renderOrder:2), so the post-clamp z value doesn't matter for ordering.
  clipPos.z = clipPos.w * 0.999;
  gl_Position = clipPos;
}
