//<a-restless-ocean> is the a-water public-API primitive — a single tag that
//wires up the OceanGrid system on a regular A-Frame entity. The name
//mirrors how a-starry-sky exposes <a-starry-sky>: a descriptive adjective
//("restless" for the always-moving FFT wave field, like "starry" for the
//star-filled sky) prefixed to the natural element it renders. The chosen
//adjective also dodges a name clash with A-Frame core's built-in <a-ocean>
//(a stylized animated wave plane with mapping keys amplitudeVariance /
//speedVariance), so no override gymnastics are needed.
AFRAME.registerPrimitive('a-restless-ocean', {
  defaultComponents: {
    'ocean-state': {}
  }
});
