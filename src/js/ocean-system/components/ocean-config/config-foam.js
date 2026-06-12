//── <ocean-foam> config group ──────────────────────────────────────────────────
//Controls foam rendering: enable/disable, start depth, texture maps, and the
//height of the ortho camera used for the foam and exclusion renders.

ARestlessOcean.OCEAN_CONFIG_ELEMENTS['ocean-foam'] = {
  'enabled':      'foam_enabled',
  'start':        'foam_start',
  'color-map':    'foam_color_map',
  'opacity-map':  'foam_opacity_map',
  'normal-map':   'foam_normal_map',
  'camera-height':'foam_camera_height'
};

Object.assign(ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS, {
  'ocean-foam-enabled':      'foam_enabled',
  'ocean-foam-start':        'foam_start',
  'ocean-foam-color-map':    'foam_color_map',
  'ocean-foam-opacity-map':  'foam_opacity_map',
  'ocean-foam-normal-map':   'foam_normal_map',
  'ocean-foam-camera-height':'foam_camera_height'
});
