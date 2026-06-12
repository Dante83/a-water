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

//Maps are populated by the per-group files that follow (config-water.js, etc.)
//so each group's tags live in their own file. applyNestedConfig and the style
//injection run after all groups are registered.
ARestlessOcean.OCEAN_CONFIG_ELEMENTS = {};
ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS = {};

//Per-component tags for vec2/vec3 values (see config-water.js). Each entry maps
//to {key, component} where component is 'x'/'y'/'z' (A-Frame's internal names).
//r→x, g→y, b→z for color-like vec3s; x/y for directional vec2s.
ARestlessOcean.OCEAN_CONFIG_COMPONENT_TAGS = {};

//── Bundled asset resolution (a-starry-sky <sky-assets-dir> style) ─────────────
ARestlessOcean.DEFAULT_ASSET_DIR = './image-dir/a-water-assets';
ARestlessOcean.ASSET_FILENAMES = {
  foam: {
    'foam_color_map': 'Foam002_1K_Color.png',
    'foam_opacity_map': 'Foam002_1K_Opacity.png',
    'foam_normal_map': 'Foam002_1K_NormalGL.png'
  },
  caustics: {
    'caustics_map': 'caustic-map.webp'
  }
};

ARestlessOcean.ASSET_KEYS = (function(){
  const set = {};
  for(const group in ARestlessOcean.ASSET_FILENAMES){
    for(const key in ARestlessOcean.ASSET_FILENAMES[group]){ set[key] = true; }
  }
  return set;
})();

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

//Inject a stylesheet that hides all config group elements so their text content
//doesn't flash on first paint. display:none cascades, so every nested value tag
//goes with its parent. Called at the end of config-shadow.js after all groups
//have registered their keys into OCEAN_CONFIG_ELEMENTS.
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

//Resolve one <ocean-assets-dir> tree onto data's texture keys.
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

//Read the nested config elements that are direct children of the entity and
//overlay them onto component.data. Group elements (ocean-water, ocean-foam, …)
//set flat schema keys; <ocean-splash> fills component.data.splashConfig.
ARestlessOcean.applyNestedConfig = function(component){
  const el = component.el;
  const data = component.data;
  if(!el || !el.children) return;
  const maps = ARestlessOcean.OCEAN_CONFIG_ELEMENTS;
  const valueTags = ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS;
  const componentTags = ARestlessOcean.OCEAN_CONFIG_COMPONENT_TAGS;
  const children = el.children;
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
      //a-starry-sky form: one <ocean-*> tag per value, text content is the value.
      //Three sub-forms are supported (all may coexist):
      //  full vector:  <ocean-wind>0 3</ocean-wind>
      //  grouped:      <ocean-wind><ocean-wind-x>0</ocean-wind-x><ocean-wind-y>3</ocean-wind-y></ocean-wind>
      //  flat:         <ocean-wind-x>0</ocean-wind-x>  (direct child of the group element)
      //Grouped form is preferred for readability; flat is a shorthand.
      const applyComponent = function(ctag, raw){
        if(!data[ctag.key] || typeof data[ctag.key] !== 'object') data[ctag.key] = {};
        data[ctag.key][ctag.component] = parseFloat(('' + raw).trim());
      };
      const leaves = child.children;
      for(let g = 0; g < leaves.length; g++){
        const leaf = leaves[g];
        const ltag = leaf.tagName ? leaf.tagName.toLowerCase() : '';
        const key = valueTags[ltag];
        if(key){
          if(leaf.children.length > 0){
            //Grouped component form: recurse one level into the sub-tags.
            const subLeaves = leaf.children;
            for(let s = 0; s < subLeaves.length; s++){
              const subLeaf = subLeaves[s];
              const sltag = subLeaf.tagName ? subLeaf.tagName.toLowerCase() : '';
              const ctag = componentTags[sltag];
              if(ctag){ applyComponent(ctag, subLeaf.textContent); }
            }
          } else {
            setKey(key, leaf.textContent);
          }
        } else {
          const ctag = componentTags[ltag];
          if(ctag){ applyComponent(ctag, leaf.textContent); }
        }
      }
    } else if(tag === 'ocean-splash'){
      const cfg = data.splashConfig || {};
      for(let a = 0; a < child.attributes.length; a++){
        const attr = child.attributes[a];
        cfg[ARestlessOcean.kebabToCamel(attr.name)] = ARestlessOcean.coerceConfigValue(attr.value);
      }
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
