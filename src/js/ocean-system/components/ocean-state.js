//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('ocean-state', {
  oceanGrid: null,
  oceanRenderer: null,
  schema: {
    'draw_distance': {type: 'number', default: 10000.0},
    'patch_size': {type: 'number', default: 256.0},
    'patch_data_size': {type: 'number', default: 512.0},
    'wave_scale_multiple': {type: 'number', default: 1.5},
    'number_of_octaves': {type: 'number', default: 512.0},
    'wind_velocity': {type: 'vec2', default: {x: 8.0, y: 5.0}},
    'height_offset': {type: 'number', default: 0.0},
    'large_normal_map': {type: 'string', default: './image-dir/a-water-assets/water-normal-1.png'},
    'small_normal_map': {type: 'string', default: './image-dir/a-water-assets/water-normal-2.png'},
    'caustics_map': {type: 'string', default: './image-dir/a-water-assets/caustic-map.webp'},
    'foam_color_map': {type: 'string', default: './image-dir/a-water-assets/Foam002_1K_Color.png'},
    'foam_opacity_map': {type: 'string', default: './image-dir/a-water-assets/Foam002_1K_Opacity.png'},
    'foam_normal_map': {type: 'string', default: './image-dir/a-water-assets/Foam002_1K_NormalGL.png'},
    'foam_roughness_map': {type: 'string', default: './image-dir/a-water-assets/Foam002_1K_Roughness.png'},
    'caustics_enabled': {type: 'bool', default: 1},
    'caustics_strength': {type: 'number', default: 1.0},
    'foam_enabled': {type: 'bool', default: 1},
    'foam_start': {type: 'number', default: 0.10},
    'large_normal_map_strength': {type: 'number', default: 0.30},
    'small_normal_map_strength': {type: 'number', default: 0.20},
    'water_absorption': {type: 'vec3', default: {x: 0.06, y: 0.012, z: 0.004}},
    'water_scattering': {type: 'vec3', default: {x: 0.010, y: 0.038, z: 0.040}},
    'water_mie_g': {type: 'number', default: 0.85},
    'linear_scattering_height_offset': {type: 'number', default: 5.0},
    'linear_scattering_total_wave_height': {type: 'number', default: 12.0},
    'atmospheric_perspective_enabled': {type: 'bool', default: true},
    'atmospheric_perspective_distance_scale': {type: 'number', default: 1.0},
    'jonswap_gamma': {type: 'number', default: 3.3},
    'jonswap_fetch': {type: 'number', default: 100000.0},
    'chop': {type: 'number', default: 0.75}
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
  update: function(oldData){
    if(!this.oceanGrid) return;
    if(oldData.wind_velocity &&
       (oldData.wind_velocity.x !== this.data.wind_velocity.x ||
        oldData.wind_velocity.y !== this.data.wind_velocity.y)){
      this.oceanGrid.oceanHeightBandLibrary.regenerateH0(this.data.wind_velocity);
    }
  },
  tick: function(time, timeDelta){
    //Do nothing to start :D
  }
});
