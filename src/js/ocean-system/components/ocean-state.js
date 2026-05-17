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
    //Height (m) of the foam + exclusion ortho cameras above rest water plane.
    //Raise above your tallest island/cliff or its top gets clipped.
    'foam_camera_height': {type: 'number', default: 100.0},
    'caustics_enabled': {type: 'bool', default: true},
    'caustics_strength': {type: 'number', default: 1.0},
    'foam_enabled': {type: 'bool', default: true},
    'foam_start': {type: 'number', default: 0.10},
    'large_normal_map_strength': {type: 'number', default: 0.30},
    'small_normal_map_strength': {type: 'number', default: 0.20},
    //Jerlov water type preset selector. 0 = custom (use the explicit
    //water_absorption/water_scattering vec3 attributes below). 1..7 picks a
    //preset from AWater.AOcean.JERLOV_PRESETS in ocean-grid.js — open-ocean
    //types 1..4, coastal types 5..7. See that table for the (a, b) values
    //and a per-type description.
    'water_type': {type: 'number', default: 0},
    //Custom absorption/scattering in m^-1, used only when water_type == 0.
    //Tropical-clean preset from the 2026-05-14 water-review SUMMARY, sitting
    //just under Pope & Fry 1997 pure-water (R=0.35, G=0.045, B=0.011) at RGB
    //sampling wavelengths. Wavelength-flat scattering at clean-ocean magnitude.
    //Yields albedo ≈(0.016, 0.080, 0.333) — navy body, red-heavy extinction so
    //deep water reads blue. Keep in sync with water-shader-template.txt.
    'water_absorption': {type: 'vec3', default: {x: 0.30, y: 0.057, z: 0.010}},
    'water_scattering': {type: 'vec3', default: {x: 0.005, y: 0.005, z: 0.005}},
    //Sky-reflection attenuators. 1.0 = full HDR sky reflection (current physical
    //value, can look unrealistically bright vs photo). reflection_distance_falloff
    //subtracts additional reflection at horizon-ish distances to fake the
    //statistical roughness convolution real water provides at range.
    'reflection_scale': {type: 'number', default: 1.0},
    'reflection_distance_falloff': {type: 'number', default: 0.0},
    //Distance-based Fresnel grazing-peak cap (Kulla-Conty-style roll-off).
    //0 = no effect. 0.85 ≈ ocean-photo-like horizon.
    'fresnel_distance_roughness': {type: 'number', default: 0.7},
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
