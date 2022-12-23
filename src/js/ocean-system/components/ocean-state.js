//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('ocean-state', {
  oceanGrid: null,
  oceanRenderer: null,
  schema: {
    'draw_distance': {type: 'number', default: 5000.0},
    'patch_size': {type: 'number', default: 256.0},
    'patch_data_size': {type: 'number', default: 512.0},
    'wave_scale_multiple': {type: 'number', default: 1.0},
    'number_of_octaves': {type: 'number', default: 256.0},
    'wind_velocity': {type: 'vec2', default: {x: 4.0, y: 3.5}},
    'height_offset': {type: 'number', default: 0.0},
    'large_normal_map': {type: 'string', default: './image-dir/a-water-assets/water-normal-1.png'},
    'small_normal_map': {type: 'string', default: './image-dir/a-water-assets/water-normal-2.png'},
    'ocean_caustics_map': {type: 'string', default: './image-dir/a-water-assets/caustic-map.webp'},
    'ocean_foam_color': {type: 'string', default: './image-dir/a-water-assets/foam002_1k_Color.png'},
    'ocean_foam_opacity': {type: 'string', default: './image-dir/a-water-assets/foam002_1k_Opacity.png'},
    'ocean_foam_normal_map': {type: 'string', default: './image-dir/a-water-assets/foam002_1k_NormalGL.png'},
    'ocean_foam_roughness': {type: 'string', default: './image-dir/a-water-assets/foam002_1k_Roughness.png'},
    'large_normal_map_strength': {type: 'number', default: 0.45},
    'small_normal_map_strength': {type: 'number', default: 0.35},
    'light_scattering_amounts': {type: 'vec3', default: {x: 88.0, y: 108.0, z: 112.0}},
    'linear_scattering_height_offset': {type: 'number', default: 10.0},
    'linear_scattering_total_wave_height': {type: 'number', default: 20.0}
  },
  init: function(){
    //Get our renderer to pass in
    let renderer = this.el.sceneEl.renderer;
    let scene = this.el.sceneEl.object3D;
    let camera = this.el.sceneEl.camera;
    let self = this;

    //Update the position of the objects
    scene.updateMatrixWorld();

    //Set up our ocean grid
    this.oceanGrid = new AWater.AOcean.OceanGrid(scene, renderer, camera, this);

    //When we've finished loading, now we can commence ticking our grid
    this.tick = function(time, timeDelta){
      this.oceanGrid.tick(time);
    }
  },
  tick: function(time, timeDelta){
    //Do nothing to start :D
  }
});
