//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('ocean_state', {
  oceanGrid: null,
  oceanRenderer: null,
  oceanCollider: null,
  schema: {
    'draw_distance': {type: 'number', default: 1000.0},
    'patch_size': {type: 'number', default: 10.0},
    'patch_data_size': {type: 'number', default: 512},
    'L': {type: 'number', default: 1000.0},
    'A': {type: 'number', default: 20.0},
    'number_of_octaves': {type: 'number', default: 512},
    'wind_velocity': {type: 'vec2', default: {x: 0.0, y: 0.0}},
    'water_depth': {type: 'number', default: 1.0},
  },
  init: function(){
    //Get our renderer to pass in
    let renderer = this.el.sceneEl.renderer;
    let scene = this.el.sceneEl.object3D;
    let self = this;

    //Set up our ocean grid
    this.oceanGrid = new OceanGrid(this.data, scene, renderer);
  },
  tick: function(time, timeDelta){
    this.oceanGrid.tick(time);
  }
});
