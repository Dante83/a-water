AFRAME.registerPrimitive('a-fluid-system', {
  defaultComponents: {
    'fluid-params': {}
  },
  mappings: {
    name: 'fluid-params.name',
    width: 'fluid-params.search-bucket-diameter',
    upper_corner: 'fluid-params.upper-corner',
    lower_corner: 'fluid-params.lower-corner',
    target_density: 'fluid-params.target-density',
    particle_radius: 'fluid-params.particle-radius',
    drag_coefficient: 'fluid-params.drag-coeficient',
    particle_mass: 'fluid-params.particle-mass',
    static_scene_accuracy: 'fluid-params.static-scene-accuracy',
    draw_style: 'fluid-params.draw-style',
    sph_iterations_per_second: 'fluid-params.sph-iterations-per-second',
    time_to_sph_iteration_write_update: 'fluid-params.time-to-sph-iteration-write-update'
  }
});
