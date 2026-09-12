//── <ocean-terrain> config group ──────────────────────────────────────────────
//Which terrain system supplies real water level/depth data to the WaterField
//seam (WATER-TYPES.md Phase 1b). Symmetric to <ocean-atmosphere>'s sky-provider.

ARestlessOcean.OCEAN_CONFIG_ELEMENTS['ocean-terrain'] = {
  'provider': 'terrain_provider'
};

Object.assign(ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS, {
  'ocean-terrain-provider': 'terrain_provider'
});
