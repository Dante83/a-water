varying vec3 vWorldPosition;

void main(){
  //Check if we are above or below the water to see what kind of fog is applied
  gl_FragColor = vec4(vWorldPosition, 1.0);
}
