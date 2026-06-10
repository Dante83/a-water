//── Nested-element config (a-starry-sky-style authoring) ───────────────────────
//<a-restless-ocean> accepts grouped child elements as a more legible alternative
//to one long flat ocean-state attribute string — the same idea a-starry-sky uses
//with <sky-time>, <sky-lighting>, etc. The children are inert HTML (no component
//is registered for them) that we read once at init and OVERLAY onto this.data, so
//OceanGrid keeps reading the same flat keys. Authoring example:
//
//   <a-restless-ocean>
//     <ocean-water type="5" chop="1.0" wind="0 3" height-offset="6"></ocean-water>
//     <ocean-foam enabled="true" start="0.1"></ocean-foam>
//     <ocean-splash capacity="24000" impact-min-launch="9"></ocean-splash>
//   </a-restless-ocean>
//
//Flat ocean-state="..." still works and acts as the default layer; any nested
//element attribute overrides it. Nested config is read at init only (static
//scene authoring), matching how a-starry-sky consumes its tags.

//Map each config element's kebab-case attributes to the flat ocean-state schema
//key they overlay. <ocean-splash> is handled separately (any knob, kebab->camel).
ARestlessOcean.OCEAN_CONFIG_ELEMENTS = {
  'ocean-water': {
    'type': 'water_type',
    'absorption': 'water_absorption',
    'scattering': 'water_scattering',
    'chop': 'chop',
    'height-offset': 'height_offset',
    'wind': 'wind_velocity',
    'jonswap-gamma': 'jonswap_gamma',
    'jonswap-fetch': 'jonswap_fetch',
    'directional-turbulence': 'directional_turbulence',
    'draw-distance': 'draw_distance',
    'patch-size': 'patch_size',
    'patch-data-size': 'patch_data_size',
    'wave-scale-multiple': 'wave_scale_multiple',
    'number-of-octaves': 'number_of_octaves'
  },
  'ocean-foam': {
    'enabled': 'foam_enabled',
    'start': 'foam_start',
    'color-map': 'foam_color_map',
    'opacity-map': 'foam_opacity_map',
    'normal-map': 'foam_normal_map',
    'camera-height': 'foam_camera_height'
  },
  'ocean-caustics': {
    'enabled': 'caustics_enabled',
    'strength': 'caustics_strength',
    'map': 'caustics_map'
  },
  'ocean-reflection': {
    'scale': 'reflection_scale',
    'distance-falloff': 'reflection_distance_falloff',
    'fresnel-distance-roughness': 'fresnel_distance_roughness'
  },
  'ocean-atmosphere': {
    'enabled': 'atmospheric_perspective_enabled',
    'distance-scale': 'atmospheric_perspective_distance_scale',
    'sky-provider': 'sky_provider'
  },
  'ocean-shadow': {
    'sun-bias': 'sun_shadow_bias'
  }
};

//The config child elements are inert unknown HTML tags, so until our JS reads
//them the browser renders their text-content values as raw inline text — a brief
//"5 1.0 0 3 …" flash on first paint. Inject a stylesheet that hides them, the way
//a-starry-sky hides its own <sky-*> tags. Hiding the group/structural elements is
//enough: display:none cascades, so every nested value tag (and the <ocean-splash-*>
//knobs) goes with its parent. Runs once at script load, before <body> is parsed.
ARestlessOcean.injectConfigElementStyle = function(){
  if(typeof document === 'undefined') return;
  const head = document.head || document.documentElement;
  if(!head || document.getElementById('a-restless-ocean-config-style')) return;
  const tags = Object.keys(ARestlessOcean.OCEAN_CONFIG_ELEMENTS).concat(['ocean-splash', 'ocean-assets-dir']);
  const style = document.createElement('style');
  style.id = 'a-restless-ocean-config-style';
  style.textContent = tags.join(',') + '{display:none !important;}';
  head.appendChild(style);
};
ARestlessOcean.injectConfigElementStyle();

//── Value-tag authoring (a-starry-sky text-content style) ──────────────────────
//The same settings as OCEAN_CONFIG_ELEMENTS, but expressed the way a-starry-sky
//does it: one <ocean-*> child element per value, the value held as that element's
//text content, e.g.
//   <ocean-water>
//     <ocean-water-type>5</ocean-water-type>
//     <ocean-chop>1.0</ocean-chop>
//     <ocean-wind>0 3</ocean-wind>
//   </ocean-water>
//Leaf names follow a-starry-sky's flat <sky-*> namespace, not the group path:
//distinctive settings drop the group noun (<ocean-chop>, <ocean-wind>), generic
//ones keep it so they stay globally unique (<ocean-foam-enabled>,
//<ocean-caustics-strength>). This is a flat map (leaf tag -> flat schema key); the
//grouping element it sits under is purely organisational. Value tags override the
//group element's attributes, which override the flat ocean-state string.
ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS = {
  //<ocean-water>
  'ocean-water-type': 'water_type',
  'ocean-water-absorption': 'water_absorption',
  'ocean-water-scattering': 'water_scattering',
  'ocean-chop': 'chop',
  'ocean-height-offset': 'height_offset',
  'ocean-wind': 'wind_velocity',
  'ocean-jonswap-gamma': 'jonswap_gamma',
  'ocean-jonswap-fetch': 'jonswap_fetch',
  'ocean-directional-turbulence': 'directional_turbulence',
  'ocean-draw-distance': 'draw_distance',
  'ocean-patch-size': 'patch_size',
  'ocean-patch-data-size': 'patch_data_size',
  'ocean-wave-scale-multiple': 'wave_scale_multiple',
  'ocean-number-of-octaves': 'number_of_octaves',
  //<ocean-foam>
  'ocean-foam-enabled': 'foam_enabled',
  'ocean-foam-start': 'foam_start',
  'ocean-foam-color-map': 'foam_color_map',
  'ocean-foam-opacity-map': 'foam_opacity_map',
  'ocean-foam-normal-map': 'foam_normal_map',
  'ocean-foam-camera-height': 'foam_camera_height',
  //<ocean-caustics>
  'ocean-caustics-enabled': 'caustics_enabled',
  'ocean-caustics-strength': 'caustics_strength',
  'ocean-caustics-map': 'caustics_map',
  //<ocean-reflection>
  'ocean-reflection-scale': 'reflection_scale',
  'ocean-reflection-distance-falloff': 'reflection_distance_falloff',
  'ocean-fresnel-distance-roughness': 'fresnel_distance_roughness',
  //<ocean-atmosphere>
  'ocean-atmosphere-enabled': 'atmospheric_perspective_enabled',
  'ocean-atmosphere-distance-scale': 'atmospheric_perspective_distance_scale',
  'ocean-sky-provider': 'sky_provider',
  //<ocean-shadow>
  'ocean-shadow-sun-bias': 'sun_shadow_bias'
};

//── Bundled asset resolution (a-starry-sky <sky-assets-dir> style) ─────────────
//Textures resolve through a nested <ocean-assets-dir> tree instead of four
//hardcoded per-texture paths — set the folder once and flag which sub-dir holds
//which asset group, exactly like a-starry-sky's <sky-assets-dir dir="moon" moon-path>:
//   <ocean-assets-dir dir="image-dir/a-water-assets">
//     <ocean-assets-dir dir="foam" foam-path></ocean-assets-dir>
//     <ocean-assets-dir dir="." caustics-path></ocean-assets-dir>
//   </ocean-assets-dir>
//ASSET_FILENAMES is the single source of truth for the bundled filenames (also
//feeds the schema defaults below via defaultAssetPath). A *-path flag resolves
//every filename in its group under the joined dir.
ARestlessOcean.DEFAULT_ASSET_DIR = './image-dir/a-water-assets';
ARestlessOcean.ASSET_FILENAMES = {
  //flagged with foam-path: the three bundled foam textures
  foam: {
    'foam_color_map': 'Foam002_1K_Color.png',
    'foam_opacity_map': 'Foam002_1K_Opacity.png',
    'foam_normal_map': 'Foam002_1K_NormalGL.png'
  },
  //flagged with caustics-path: the caustic projection texture
  caustics: {
    'caustics_map': 'caustic-map.webp'
  }
};

//Flat set of every schema key that names a bundled texture (derived from
//ASSET_FILENAMES) — used to detect an explicit per-texture override so the
//<ocean-assets-dir> resolution never clobbers it.
ARestlessOcean.ASSET_KEYS = (function(){
  const set = {};
  for(const group in ARestlessOcean.ASSET_FILENAMES){
    for(const key in ARestlessOcean.ASSET_FILENAMES[group]){ set[key] = true; }
  }
  return set;
})();

//Schema default path for a texture key: DEFAULT_ASSET_DIR + the bundled filename.
ARestlessOcean.defaultAssetPath = function(key){
  for(const group in ARestlessOcean.ASSET_FILENAMES){
    const names = ARestlessOcean.ASSET_FILENAMES[group];
    if(names[key]){ return ARestlessOcean.DEFAULT_ASSET_DIR + '/' + names[key]; }
  }
  return '';
};

//Join path segments with single slashes, dropping leading ./ or /, trailing /,
//and bare '.' segments so dir="." (asset lives in the parent dir) collapses away.
ARestlessOcean.joinPath = function(){
  const parts = [];
  for(let i = 0; i < arguments.length; i++){
    let seg = ('' + (arguments[i] === undefined || arguments[i] === null ? '' : arguments[i])).trim();
    seg = seg.replace(/^\.?\/+/, '').replace(/\/+$/, '');
    if(seg === '' || seg === '.'){ continue; }
    parts.push(seg);
  }
  return parts.join('/');
};

//Resolve one <ocean-assets-dir> tree onto data's texture keys. base = the root
//element's dir; each nested <ocean-assets-dir> with a *-path flag resolves its
//group's filenames under join(base, sub). With no flagged children the base dir
//itself is taken to hold every bundled asset. explicitKeys (keys already set by an
//attribute/value-tag override) are skipped so an explicit path always wins.
ARestlessOcean.applyAssetDir = function(data, rootEl, explicitKeys){
  explicitKeys = explicitKeys || {};
  const base = rootEl.getAttribute('dir') || '';
  const targets = [];
  const kids = rootEl.children;
  for(let i = 0; i < kids.length; i++){
    const kid = kids[i];
    if(!kid.tagName || kid.tagName.toLowerCase() !== 'ocean-assets-dir'){ continue; }
    const dir = ARestlessOcean.joinPath(base, kid.getAttribute('dir') || '');
    if(kid.hasAttribute('foam-path')){ targets.push({group: 'foam', dir: dir}); }
    if(kid.hasAttribute('caustics-path')){ targets.push({group: 'caustics', dir: dir}); }
  }
  if(targets.length === 0){
    const baseDir = ARestlessOcean.joinPath(base);
    for(const group in ARestlessOcean.ASSET_FILENAMES){ targets.push({group: group, dir: baseDir}); }
  }
  for(let i = 0; i < targets.length; i++){
    const names = ARestlessOcean.ASSET_FILENAMES[targets[i].group];
    for(const key in names){
      if(explicitKeys[key]){ continue; }
      data[key] = ARestlessOcean.joinPath(targets[i].dir, names[key]);
    }
  }
};

//Coerce a raw HTML attribute string to bool / number / vec2 / vec3 / string,
//mirroring A-Frame's own attribute typing so overlays match schema field types.
ARestlessOcean.coerceConfigValue = function(raw){
  if(raw === null || raw === undefined) return raw;
  const t = ('' + raw).trim();
  if(t === 'true') return true;
  if(t === 'false') return false;
  const parts = t.split(/[\s,]+/).filter(function(s){ return s.length > 0; });
  if(parts.length > 1){
    const nums = parts.map(Number);
    if(nums.every(function(n){ return !isNaN(n); })){
      if(nums.length === 2) return {x: nums[0], y: nums[1]};
      return {x: nums[0], y: nums[1], z: nums[2]};
    }
  }
  if(t !== '' && !isNaN(Number(t))) return Number(t);
  return t;
};

ARestlessOcean.kebabToCamel = function(s){
  return s.replace(/-([a-z])/g, function(_, c){ return c.toUpperCase(); });
};

//Read the nested config elements that are direct children of the entity and
//overlay them: structural elements onto component.data (flat schema keys); the
//<ocean-splash> element into component.data.splashConfig (consumed by OceanGrid
//when it builds the OceanSplash system).
ARestlessOcean.applyNestedConfig = function(component){
  const el = component.el;
  const data = component.data;
  if(!el || !el.children) return;
  const maps = ARestlessOcean.OCEAN_CONFIG_ELEMENTS;
  const valueTags = ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS;
  const children = el.children;
  //Texture keys set explicitly here (attribute or value tag) — an <ocean-assets-dir>
  //tree, resolved last, must not clobber them.
  const explicitAssetKeys = {};
  const assetDirEls = [];

  const setKey = function(key, raw){
    data[key] = ARestlessOcean.coerceConfigValue(raw);
    if(ARestlessOcean.ASSET_KEYS[key]){ explicitAssetKeys[key] = true; }
  };

  for(let i = 0; i < children.length; i++){
    const child = children[i];
    const tag = child.tagName ? child.tagName.toLowerCase() : '';
    if(maps[tag]){
      const map = maps[tag];
      //Compact form: values as attributes on the group element.
      for(let a = 0; a < child.attributes.length; a++){
        const attr = child.attributes[a];
        const key = map[attr.name];
        if(key){ setKey(key, attr.value); }
      }
      //a-starry-sky form: <ocean-*> value tags as text-content children. These
      //sit one level under the group element and override its attributes.
      const leaves = child.children;
      for(let g = 0; g < leaves.length; g++){
        const leaf = leaves[g];
        const ltag = leaf.tagName ? leaf.tagName.toLowerCase() : '';
        const key = valueTags[ltag];
        if(key){ setKey(key, leaf.textContent); }
      }
    } else if(tag === 'ocean-splash'){
      const cfg = data.splashConfig || {};
      //Compact form: any OceanSplash knob as a kebab-case attribute.
      for(let a = 0; a < child.attributes.length; a++){
        const attr = child.attributes[a];
        cfg[ARestlessOcean.kebabToCamel(attr.name)] = ARestlessOcean.coerceConfigValue(attr.value);
      }
      //Value-tag form: <ocean-splash-impact-min-launch>9</…> → impactMinLaunch.
      const leaves = child.children;
      for(let g = 0; g < leaves.length; g++){
        const leaf = leaves[g];
        const ltag = leaf.tagName ? leaf.tagName.toLowerCase() : '';
        if(ltag.indexOf('ocean-splash-') === 0){
          const knob = ARestlessOcean.kebabToCamel(ltag.slice('ocean-splash-'.length));
          cfg[knob] = ARestlessOcean.coerceConfigValue(leaf.textContent);
        }
      }
      data.splashConfig = cfg;
    } else if(tag === 'ocean-assets-dir'){
      assetDirEls.push(child);
    }
  }

  //Resolve <ocean-assets-dir> trees last so explicit per-texture paths win.
  for(let i = 0; i < assetDirEls.length; i++){
    ARestlessOcean.applyAssetDir(data, assetDirEls[i], explicitAssetKeys);
  }
};

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
    //(see ARestlessOcean.OCEAN_CONFIG_ELEMENTS above), not a flat attribute —
    //its ~100 art-direction knobs would swamp this schema. Any OceanSplash knob
    //is settable there by its kebab-case name (impact-min-launch, shore-jet-scale,
    //…) and stays live-editable at runtime via window.oceanSplash.
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
