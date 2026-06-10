//Root namespace for a-restless-ocean. Everything the library exposes — the
//OceanGrid renderer, the wave/LUT libraries, the materials, the config helpers —
//hangs off the global ARestlessOcean object.
ARestlessOcean = {
  DefaultData: {},
  Materials: {
    FFTWaves: {},
    Ocean: {}
  },
  Renderers: {},
  LUTlibraries: {}
};

//── Backwards compatibility ────────────────────────────────────────────────────
//The library was previously published as `a-water`, with its namespace under
//`AWater.AOcean`. Code written against the old name keeps working: reading
//`AWater.AOcean` returns (via the getter below) the same live ARestlessOcean
//object, so `AWater.AOcean.OceanGrid`, `AWater.AOcean.sampleWaterHeight`, etc. all
//still resolve. The first access logs a one-time deprecation notice. This alias is
//slated for removal — migrate `AWater.AOcean.X` references to `ARestlessOcean.X`.
(function(){
  let warned = false;
  AWater = {
    get AOcean(){
      if(!warned){
        warned = true;
        console.warn('[a-restless-ocean] `AWater.AOcean` is deprecated — use the ' +
                     '`ARestlessOcean` namespace instead. This compatibility alias ' +
                     'will be removed in a future release.');
      }
      return ARestlessOcean;
    }
  };
})();
