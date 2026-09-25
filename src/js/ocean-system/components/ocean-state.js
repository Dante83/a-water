//The party responsible for updating our view of the fluid system.
//Config map declarations and parsing utilities live in ocean-config/ — one file
//per group element (<ocean-water>, <ocean-foam>, …) for easy navigation.

//WHY THE PER-FRAME WORK IS DRIVEN BY A SYSTEM, NOT THE COMPONENT'S TICK.
//A-Frame 1.7 ticks components by component TYPE, in the order the types were
//REGISTERED (scene.componentOrder), and it ticks systems after every component.
//This file loads in <head> with the ocean scripts, so any camera controller
//registered later (a page's inline fly-controls, a rig from another library)
//ticked AFTER the ocean. Every frame the ocean then rendered its refraction
//G-buffer and copied the view matrices before the camera moved, while the main
//render used the moved camera: a one-frame lag that only shows in motion.
//Vertical motion showed it worst. Near the waterline every depth comparison
//shifted by the camera's step per frame, and the refraction lit a white band
//along the shore whenever the camera rose, gone as soon as it stopped (Phase 3a
//browser round 5; headless trace: G-buffer camera Y == last frame's render Y).
//A system tick runs after all component ticks and before the render, so the
//ocean always sees the camera the frame will be drawn with.
AFRAME.registerSystem('ocean-state', {
  init: function(){
    this.oceans = [];
  },
  tick: function(time, timeDelta){
    for(let i = 0; i < this.oceans.length; ++i){
      const component = this.oceans[i];
      if(component.oceanGrid && component.el.isPlaying){
        component.oceanGrid.tick(time);
      }
    }
  }
});

AFRAME.registerComponent('ocean-state', {
  oceanGrid: null,
  oceanRenderer: null,
  schema: {
    'draw_distance': {type: 'number', default: 10000.0},
    //Clipmap base-tile world size (m). Does NOT change the FFT wave spectrum
    //(that's cascadePatchSizes in ocean-height-band-library.js) — it sets the
    //near-camera mesh tessellation: vertex spacing = patch_size / numCells
    //(numCells=32). 8 m → 0.25 m/vertex, which Nyquist-matches the finest
    //cascade's 0.5–2 m chop. Larger flattens the near field; smaller shrinks the
    //crisp ring and grows ringCount = ceil(log2(draw_distance/patch_size)).
    'patch_size': {type: 'number', default: 8.0},
    'patch_data_size': {type: 'number', default: 512.0},
    'wave_scale_multiple': {type: 'number', default: 1.5},
    'number_of_octaves': {type: 'number', default: 512.0},
    'wind_velocity': {type: 'vec2', default: {x: 8.0, y: 5.0}},
    'height_offset': {type: 'number', default: 0.0},
    //Bundled-texture defaults come from ARestlessOcean.ASSET_FILENAMES (single
    //source of truth); override the folder once with an <ocean-assets-dir> tree
    //or an individual path with the matching <ocean-…-map> value tag / attribute.
    'caustics_map': {type: 'string', default: ARestlessOcean.defaultAssetPath('caustics_map')},
    'foam_color_map': {type: 'string', default: ARestlessOcean.defaultAssetPath('foam_color_map')},
    'foam_opacity_map': {type: 'string', default: ARestlessOcean.defaultAssetPath('foam_opacity_map')},
    'foam_normal_map': {type: 'string', default: ARestlessOcean.defaultAssetPath('foam_normal_map')},
    //Height (m) of the foam + exclusion ortho cameras above rest water plane.
    //Raise above your tallest island/cliff or its top gets clipped.
    'foam_camera_height': {type: 'number', default: 100.0},
    'caustics_enabled': {type: 'bool', default: true},
    'caustics_strength': {type: 'number', default: 1.0},
    //The underwater SpotLight projector: 'auto' stands it down (removed from the scene, which
    //frees two texture units in every lit program) when a-faraway-land advertises its own
    //caustics (ALand.runtime.waterCaustics); 'on' forces it; 'off' never casts it.
    'caustics_projector': {type: 'string', default: 'auto', oneOf: ['auto', 'on', 'off']},
    'foam_enabled': {type: 'bool', default: true},
    'foam_start': {type: 'number', default: 0.10},
    //Jerlov water type preset selector. 0 = custom (use the explicit
    //water_absorption/water_scattering vec3 attributes below). 1..7 picks a
    //preset from ARestlessOcean.JERLOV_PRESETS in ocean-grid.js — open-ocean
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
    'fresnel_distance_roughness': {type: 'number', default: 0.85},
    'atmospheric_perspective_enabled': {type: 'bool', default: true},
    'atmospheric_perspective_distance_scale': {type: 'number', default: 1.0},
    //Who provides the sky/atmosphere this ocean integrates with.
    //  'auto'         — detect at runtime: if an <a-starry-sky> element is in
    //                   the page (or the StarrySky global is registered) use it,
    //                   otherwise run standalone. The default; "drop it in and
    //                   it figures itself out."
    //  'a-starry-sky' — force the a-starry-sky path (wait for its reserved fog
    //                   slot; never install our own).
    //  'standalone'   — force standalone even if a-starry-sky is on the page:
    //                   install our own minimal underwater-fog scaffold so the
    //                   seabed murk works off a plain DirectionalLight +
    //                   HemisphereLight, no atmosphere dependency.
    'sky_provider': {type: 'string', default: 'auto'},
    //terrain_provider: 'auto' | 'standalone' | 'a-faraway-land'. Symmetric to
    //sky_provider above — see _resolveTerrainProvider in ocean-grid.js. When
    //a-faraway-land is present, the WaterField seam (waterLevelAt/waterDepthAt)
    //decodes real per-position level/depth from its tiles instead of the flat
    //height_offset plane.
    'terrain_provider': {type: 'string', default: 'auto'},
    //Phase 4 flowing water (<ocean-river>): creeks and rivers from a-faraway-land's
    //hydrology, drawn by FlowSurfacePass. Needs terrain_provider a-faraway-land.
    //  flow_low/high  still -> flowing speed band (m/s) of ARestlessOcean.FlowHandoff
    //  foam_*         FlowFoamPass: decay time (s) and source gains (see its header)
    'river_enabled': {type: 'bool', default: true},
    'river_flow_low': {type: 'number', default: 0.05},
    'river_flow_high': {type: 'number', default: 0.25},
    'river_foam_decay': {type: 'number', default: 6.0},
    'river_foam_convergence': {type: 'number', default: 1.5},
    'river_foam_bank': {type: 'number', default: 0.6},
    'river_foam_step': {type: 'number', default: 1.2},
    'river_foam_fall': {type: 'number', default: 0.25},
    'jonswap_gamma': {type: 'number', default: 3.3},
    'jonswap_fetch': {type: 'number', default: 100000.0},
    //Directional spreading turbulence: 0 = pure cos²(θ) (waves aligned to wind),
    //1 = isotropic. Crest default 0.145 — enough cross-wind chop to avoid the
    //parallel-streak look without losing wind direction.
    'directional_turbulence': {type: 'number', default: 0.145},
    'chop': {type: 'number', default: 1.0},
    //Additive offset applied on top of the scene DirectionalLight's
    //shadow.bias when the water shader samples the sun shadow map.
    //Negative pushes water-receiver refZ TOWARD the light (less shadow);
    //positive pushes it AWAY (more shadow, helps surface ledges of small
    //caster). The default -0.0012 cancels a depth-fight stripe seen at
    //grazing sun where submerged terrain just below the water surface
    //was shadowing the water itself (world-Y deltas of ~1 m collapse to
    //sub-bias deltas in shadow space at near-horizon sun). Tune via the
    //live setSunShadowBias() console hook.
    'sun_shadow_bias': {type: 'number', default: -0.0012}
    //Splash/spray is configured via the nested <ocean-splash> child element
    //(see ocean-config/config-core.js), not a flat attribute — its ~100
    //art-direction knobs would swamp this schema. Any OceanSplash knob is
    //settable there by its kebab-case name and stays live-editable at runtime
    //via window.oceanSplash.
  },
  init: function(){
    //Overlay any nested config child elements (<ocean-water>, <ocean-splash>, …)
    //onto this.data BEFORE OceanGrid reads it (the grid captures data by reference
    //in its constructor), so grouped XML authoring and the flat attribute string
    //feed the exact same state.
    ARestlessOcean.applyNestedConfig(this);

    //Get our renderer to pass in
    let renderer = this.el.sceneEl.renderer;
    let scene = this.el.sceneEl.object3D;
    let camera = this.el.sceneEl.camera;
    let self = this;

    //Update the position of the objects
    scene.updateMatrixWorld();

    //Set up our ocean grid
    this.oceanGrid = new ARestlessOcean.OceanGrid(scene, renderer, camera, this);

    //When we've finished loading, now we can commence ticking our grid. The
    //ticking itself happens in the ocean-state SYSTEM (see the top of this file).
    if(this.system && this.system.oceans.indexOf(this) < 0){
      this.system.oceans.push(this);
    }
  },
  remove: function(){
    if(this.system){
      const i = this.system.oceans.indexOf(this);
      if(i >= 0) this.system.oceans.splice(i, 1);
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
});
