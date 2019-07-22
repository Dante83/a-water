//
//Many thanks to https://github.com/wwwtyro/glsl-atmosphere, which was useful in setting up my first GLSL project :D
//

#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

//
//Draw main loop
//
void main(){

  gl_FragColor = vec4(clamp(sqrt(skyColorSquared), 0.0, 1.0), 1.0);
}
