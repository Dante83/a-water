//── <ocean-atmosphere> config group ───────────────────────────────────────────
//Controls atmospheric perspective on the water surface and which sky system
//provides lighting and fog data.

ARestlessOcean.OCEAN_CONFIG_ELEMENTS['ocean-atmosphere'] = {
  'enabled':        'atmospheric_perspective_enabled',
  'distance-scale': 'atmospheric_perspective_distance_scale',
  'sky-provider':   'sky_provider'
};

Object.assign(ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS, {
  'ocean-atmosphere-enabled':        'atmospheric_perspective_enabled',
  'ocean-atmosphere-distance-scale': 'atmospheric_perspective_distance_scale',
  'ocean-sky-provider':              'sky_provider'
});
