precision highp float;

//Ocean shadow-caster fragment — EVSM (Exponential Variance Shadow Map).
//Instead of letting the depth buffer record gl_FragDepth and reading it
//back, we write four warped depth moments into an RGBA32F color target.
//
//Why EVSM: per-triangle z-acne on smooth meshes (the ocean) is structural
//to depth-comparison shadow maps. The receiver and caster are the same
//mesh, so adjacent triangles produce slightly different sc.z values that
//flip the depth comparison even with a calibrated bias. EVSM replaces the
//binary comparison with a probabilistic upper bound (Chebyshev), which
//absorbs sub-texel depth jitter as a smooth shadow gradient.
//
//Layout: store positive and negative exponential warps of the linear
//depth z in [0,1]. The negative warp is kept negative so monotonicity
//survives linear filtering and Gaussian blur in the post-blur pass.
//Receiver does Chebyshev on each warp and takes the min — this is the
//"two-warp" trick that removes most of plain-VSM light bleed.
//  R = exp(c·z)
//  G = exp(c·z)^2 = exp(2c·z)
//  B = -exp(-c·z)
//  A = (-exp(-c·z))^2 = exp(-2c·z)
//Storing all four moments separately rather than computing them on the
//fly in the receiver is what makes the variance computation correct
//across the linear-filtered + Gaussian-blurred reads.

uniform float evsmExpC;

void main(){
  float z = gl_FragCoord.z;
  float pos = exp(evsmExpC * z);
  float neg = -exp(-evsmExpC * z);
  gl_FragColor = vec4(pos, pos * pos, neg, neg * neg);
}
