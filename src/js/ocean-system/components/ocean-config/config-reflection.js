//── <ocean-reflection> config group ───────────────────────────────────────────
//Controls sky-reflection brightness and the distance-based Fresnel roughness
//that simulates statistical wave convolution at the horizon.

ARestlessOcean.OCEAN_CONFIG_ELEMENTS['ocean-reflection'] = {
  'scale':                    'reflection_scale',
  'distance-falloff':         'reflection_distance_falloff',
  'fresnel-distance-roughness':'fresnel_distance_roughness'
};

Object.assign(ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS, {
  'ocean-reflection-scale':             'reflection_scale',
  'ocean-reflection-distance-falloff':  'reflection_distance_falloff',
  'ocean-fresnel-distance-roughness':   'fresnel_distance_roughness'
});
