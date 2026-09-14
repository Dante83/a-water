//── <ocean-terrain> config group ──────────────────────────────────────────────
//Which terrain system supplies real water level/depth data to the WaterField
//seam (WATER-TYPES.md Phase 1b). Symmetric to <ocean-atmosphere>'s sky-provider.

ARestlessOcean.OCEAN_CONFIG_ELEMENTS['ocean-terrain'] = {
  'provider': 'terrain_provider'
};

Object.assign(ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS, {
  'ocean-terrain-provider': 'terrain_provider'
});

//── <ocean-river> config group ────────────────────────────────────────────────
//Phase 4 flowing water: creeks and rivers read from the terrain provider's
//hydrology (so it lives beside <ocean-terrain>, which it requires). The foam
//knobs are FlowFoamPass's; each is also a live JS field on
//oceanGrid.flowSurfacePass.foamPass for console tuning.

ARestlessOcean.OCEAN_CONFIG_ELEMENTS['ocean-river'] = {
  'enabled':          'river_enabled',
  'flow-low':         'river_flow_low',
  'flow-high':        'river_flow_high',
  'foam-decay':       'river_foam_decay',
  'foam-convergence': 'river_foam_convergence',
  'foam-bank':        'river_foam_bank',
  'foam-step':        'river_foam_step',
  'foam-fall':        'river_foam_fall'
};

Object.assign(ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS, {
  'ocean-river-enabled':          'river_enabled',
  'ocean-river-flow-low':         'river_flow_low',
  'ocean-river-flow-high':        'river_flow_high',
  'ocean-river-foam-decay':       'river_foam_decay',
  'ocean-river-foam-convergence': 'river_foam_convergence',
  'ocean-river-foam-bank':        'river_foam_bank',
  'ocean-river-foam-step':        'river_foam_step',
  'ocean-river-foam-fall':        'river_foam_fall'
});
