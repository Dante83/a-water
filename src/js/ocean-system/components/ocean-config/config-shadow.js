//── <ocean-shadow> config group ───────────────────────────────────────────────
//Controls how the ocean samples the scene sun shadow map. The bias offset
//compensates for depth-fight stripes at grazing sun angles.

ARestlessOcean.OCEAN_CONFIG_ELEMENTS['ocean-shadow'] = {
  'sun-bias': 'sun_shadow_bias'
};

Object.assign(ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS, {
  'ocean-shadow-sun-bias': 'sun_shadow_bias'
});

//All groups are now registered — inject the CSS that hides config elements so
//their text content doesn't flash on first paint. display:none cascades to all
//nested value/component tags. Mirrors how a-starry-sky hides its <sky-*> tags.
ARestlessOcean.injectConfigElementStyle();
