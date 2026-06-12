//── <ocean-caustics> config group ─────────────────────────────────────────────
//Controls underwater caustic projection: enable/disable, brightness multiplier,
//and the caustic texture map path.

ARestlessOcean.OCEAN_CONFIG_ELEMENTS['ocean-caustics'] = {
  'enabled':  'caustics_enabled',
  'strength': 'caustics_strength',
  'map':      'caustics_map'
};

Object.assign(ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS, {
  'ocean-caustics-enabled':  'caustics_enabled',
  'ocean-caustics-strength': 'caustics_strength',
  'ocean-caustics-map':      'caustics_map'
});
