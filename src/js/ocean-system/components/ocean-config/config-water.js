//── <ocean-water> config group ─────────────────────────────────────────────────
//Controls water type, wave shape, and optical (absorption/scattering) properties.
//All three authoring forms are supported:
//   <ocean-water type="5" chop="1.0" wind="0 3"></ocean-water>            (compact)
//   <ocean-water><ocean-chop>1.0</ocean-chop></ocean-water>               (value-tag)
//   <ocean-water><ocean-wind-x>0</ocean-wind-x></ocean-water>             (component)

ARestlessOcean.OCEAN_CONFIG_ELEMENTS['ocean-water'] = {
  'type':                  'water_type',
  'absorption':            'water_absorption',
  'scattering':            'water_scattering',
  'chop':                  'chop',
  'height-offset':         'height_offset',
  'wind':                  'wind_velocity',
  'jonswap-gamma':         'jonswap_gamma',
  'jonswap-fetch':         'jonswap_fetch',
  'directional-turbulence':'directional_turbulence',
  'draw-distance':         'draw_distance',
  'patch-size':            'patch_size',
  'patch-data-size':       'patch_data_size',
  'wave-scale-multiple':   'wave_scale_multiple',
  'number-of-octaves':     'number_of_octaves'
};

Object.assign(ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS, {
  //<ocean-water> value tags
  'ocean-water-type':            'water_type',
  'ocean-water-absorption':      'water_absorption',
  'ocean-water-scattering':      'water_scattering',
  'ocean-chop':                  'chop',
  'ocean-height-offset':         'height_offset',
  'ocean-wind':                  'wind_velocity',
  'ocean-jonswap-gamma':         'jonswap_gamma',
  'ocean-jonswap-fetch':         'jonswap_fetch',
  'ocean-directional-turbulence':'directional_turbulence',
  'ocean-draw-distance':         'draw_distance',
  'ocean-patch-size':            'patch_size',
  'ocean-patch-data-size':       'patch_data_size',
  'ocean-wave-scale-multiple':   'wave_scale_multiple',
  'ocean-number-of-octaves':     'number_of_octaves'
});

//Per-component tags. wind_velocity is a directional vec2 → x/y.
//water_absorption and water_scattering are RGB color coefficients → r/g/b
//(mapped to A-Frame's internal {x,y,z} representation).
Object.assign(ARestlessOcean.OCEAN_CONFIG_COMPONENT_TAGS, {
  'ocean-wind-x':              {key: 'wind_velocity',    component: 'x'},
  'ocean-wind-y':              {key: 'wind_velocity',    component: 'y'},
  'ocean-water-absorption-r':  {key: 'water_absorption', component: 'x'},
  'ocean-water-absorption-g':  {key: 'water_absorption', component: 'y'},
  'ocean-water-absorption-b':  {key: 'water_absorption', component: 'z'},
  'ocean-water-scattering-r':  {key: 'water_scattering', component: 'x'},
  'ocean-water-scattering-g':  {key: 'water_scattering', component: 'y'},
  'ocean-water-scattering-b':  {key: 'water_scattering', component: 'z'}
});
