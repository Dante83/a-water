AFRAME.registerPrimitive('a-fluid-debugger', {
  defaultComponents: {
    'fluid-debugger': {}
  },
  mappings: {
    particle_system_id: 'my-particle-system',
    draw_particle_system: false,
    particle_system_color: {x: 1.0, y: 0.0, z: 0.0, w: 0.2},
    draw_buckets: false,
    buckets_color: {x: 1.0, y: 1.0, z: 0.0, w: 0.4},
    draw_static_mesh: false,
    static_mesh_color: {x: 1.0, y: 1.0, z: 1.0, w: 1.0},
    draw_points: false,
    draw_surface_mesh: false,
  }
});
