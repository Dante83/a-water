#ifdef GL_ES
precision mediump float;
precision mediump int;
#endif

varying vec3 vWorldPosition;

//With a lot of help from https://youtu.be/i0BPrGuOdPo
uniform sampler2D twiddleTexture;
uniform float N;
uniform int numStages;
uniform int stage;
uniform int pingpong;
uniform int direction;

const float pi = 3.141592653589793238462643383279502884197169;

vec2 cMult(vec2 a, vec2 b){
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cAdd(vec2 a, vec2 b){
  return vec2(a.x + b.x, a.y + b.y);
}

vec4 horizontalButterflies(vec2 position){
  vec4 data = texture2D(twiddleTexture, vec2(stage / numStages, position.x));

  vec2 p = texture2D(ping_pong_texture, vec2(data.z, position.y)).rg;
  vec2 q = texture2D(ping_pong_texture, vec2(data.w, position.y)).rg;
  vec2 w = vec2(data.x, data.y);

  vec2 H = cAdd(p, cMult(w, q));
  return vec4(H.x, H.y, 0.0, 1.0);
}

vec4 verticalButterflies(vec2 position){
  vec4 data = texture2D(twiddleTexture, vec2(stage / numStages, position.y));

  vec2 p = texture2D(ping_pong_texture, vec2(data.z, position.x)).rg;
  vec2 q = texture2D(ping_pong_texture, vec2(data.w, position.x)).rg;
  vec2 w = vec2(data.x, data.y);

  vec2 H = cAdd(p, cMult(w, q));
  return vec4(H.x, H.y, 0.0, 1.0);
}

void main(){
  vec2 position = gl_FragCoord.xy / resolution.xy;
  vec4 result;

  //If horizontal butterfly
  //(Note: We should probably pull this into another shader later.)
  if(direction == 0){
		result = horizontalButterflies(position);
  }
	else if(direction == 1){
		result = verticalButterflies(position);
  }

  gl_FragColor = result;
}
