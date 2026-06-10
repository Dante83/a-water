//<a-restless-ocean> is the a-water public-API primitive — a single tag that
//wires up the OceanGrid system on a regular A-Frame entity. The name
//mirrors how a-starry-sky exposes <a-starry-sky>: a descriptive adjective
//("restless" for the always-moving FFT wave field, like "starry" for the
//star-filled sky) prefixed to the natural element it renders. The chosen
//adjective also dodges a name clash with A-Frame core's built-in <a-ocean>
//(a stylized animated wave plane with mapping keys amplitudeVariance /
//speedVariance), so no override gymnastics are needed.
//
//Configuration is read at init by ocean-state.applyNestedConfig in three layers
//(each overrides the one before it):
//  1. the flat  ocean-state="key: value; ..."  attribute (default layer)
//  2. grouped child elements with values as ATTRIBUTES (compact):
//       <ocean-water type="5" chop="1.0" wind="0 3"></ocean-water>
//  3. the same grouped elements with values as a-starry-sky-style TEXT-CONTENT
//     child tags (most legible, wins):
//       <ocean-water><ocean-chop>1.0</ocean-chop><ocean-wind>0 3</ocean-wind></ocean-water>
//Groups: <ocean-water> <ocean-foam> <ocean-caustics> <ocean-reflection>
//        <ocean-atmosphere> <ocean-shadow>, and <ocean-splash> (any OceanSplash
//knob by kebab-case name / <ocean-splash-*> tag). See OCEAN_CONFIG_ELEMENTS
//(attribute map) and OCEAN_CONFIG_VALUE_TAGS (value-tag map) in ocean-state.js.
//
//Textures resolve through a nested <ocean-assets-dir> tree, like a-starry-sky's
//<sky-assets-dir> — set the folder once and flag the sub-dirs:
//  <ocean-assets-dir dir="image-dir/a-water-assets">
//    <ocean-assets-dir dir="foam" foam-path></ocean-assets-dir>
//    <ocean-assets-dir dir="." caustics-path></ocean-assets-dir>
//  </ocean-assets-dir>
AFRAME.registerPrimitive('a-restless-ocean', {
  defaultComponents: {
    'ocean-state': {}
  }
});
