precision highp float;

//Ocean shadow-caster fragment — depth-only. When the render target has
//a depth texture attached, the color output is ignored and only gl_FragDepth
//(implicit from gl_Position.z / gl_Position.w) is written. We still emit a
//black pixel because WebGL requires a color write to not DCE the pass.

void main(){
  gl_FragColor = vec4(0.0);
}
