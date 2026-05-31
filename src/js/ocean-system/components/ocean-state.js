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
    //Broadband foam (Crest UpdateFoam port). All four feed the broadband
    //pack material in ocean-height-composer.js.
    //  foam_coverage: foam fires when broadband Jacobian < this. Higher =
    //    more crests covered. 0.55 (Crest default) is sparse, 0.80 is busy,
    //    0.95 blankets everything.
    //  foam_fade_rate: per-second decay. 0.3 = ~3.3 s e-fold (lingering),
    //    0.8 = Crest default (~1.25 s, snappy).
    //  foam_strength: per-frame add multiplier. 1.0 = Crest default; raise
    //    to make firing pixels saturate faster, lower for thinner foam.
    //  foam_advection_scale: fraction of wind speed used as foam drift.
    //    0.04 ≈ Stokes drift for wind-driven seas; 0 = pinned, 0.1 = visibly
    //    chases wind.
    'foam_coverage': {type: 'number', default: 0.85},
    'foam_fade_rate': {type: 'number', default: 0.25},
    'foam_strength': {type: 'number', default: 4.0},
    'foam_advection_scale': {type: 'number', default: 0.04},
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
    //Broadband foam knobs — A-Frame attribute changes propagate into the
    //live JS fields on the grid, which the per-frame tick pushes onto the
    //broadband pack material's uniforms.
    if(oldData.foam_coverage !== this.data.foam_coverage) this.oceanGrid.foamCoverage = this.data.foam_coverage;
    if(oldData.foam_fade_rate !== this.data.foam_fade_rate) this.oceanGrid.foamFadeRate = this.data.foam_fade_rate;
    if(oldData.foam_strength !== this.data.foam_strength) this.oceanGrid.foamStrength = this.data.foam_strength;
    if(oldData.foam_advection_scale !== this.data.foam_advection_scale) this.oceanGrid.foamAdvectionScale = this.data.foam_advection_scale;
  },
  tick: function(time, timeDelta){
    //Do nothing to start :D
  }
});
