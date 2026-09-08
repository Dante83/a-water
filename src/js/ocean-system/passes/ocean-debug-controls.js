//── Ocean debug controls ───────────────────────────────────────────────────
//
//Extracted from ocean-grid.js (0.2.0 lines 1436-1735) as part of the Phase 0
//decomposition. Every live-tuning setter and every window.* console handle the
//water system exposes, in one place — roughly 300 lines that were interleaved
//with real renderer state and made the god file harder to read than it needed
//to be.
//
//WHAT STAYED BEHIND, AND WHY
//The four override FIELDS these setters write — _sunShadowOverride,
//_oceanShadowOverride, _sunShadowBiasOffset and _shadowHelpers — are declared in
//ocean-grid.js, not here. They are read every frame by the uniform upload loop,
//the CSM pass and the splash system, and they must survive the production DEBUG
//strip. Only the setters and the console surface live in this file.
//
//THE DEBUG STRIP
//make-combined.py deletes everything between the DEBUG_START and DEBUG_END
//from both dist builds, matching PER FILE — a span may never cross a file
//boundary. The single marker pair below wraps the dumpShadowRanges helper and
//the whole window.* block, exactly as it did in ocean-grid.js. The set*
//functions themselves sit OUTSIDE the markers and ship in dist, which is also
//how 0.2.0 behaved: dist keeps the API, drops the console wiring.
//
//The one behavioural change from the verbatim 0.2.0 code: the setters that
//pushed a uniform to every water tile used to inline
//`for(...oceanGridInstanceKeys...) oceanPatchGeometryInstances[...]`, reaching
//straight into two OceanGrid closure locals. They now call
//grid.forEachOceanMesh(cb), so this file needs no access to the grid's
//internals — and the six passes WATER-TYPES.md adds next get the same helper.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

//Install every live-tuning setter onto the grid instance, then (in dev builds)
//the window.* console handles. Called once from the OceanGrid constructor.
ARestlessOcean.installOceanDebugControls = function(grid){
  const self = grid;
    //Console helper — flip the ocean-shadow debug mode on every water tile
    //material at once. Call from the browser console as
    //  setOceanShadowDebug(0|1|2)
    //  0 = normal render, 1 = shadow factor as full-screen grayscale,
    //  2 = cascade-index tint (red C0, green C1, blue C2, yellow C3).
    //Cascade-depth thumbnails and the bottom-corner jacobian/foam panels
    //appear only when mode is non-zero.
    grid.setOceanShadowDebug = function(mode){
      grid.forEachOceanMesh(function(mesh){
        mesh.material.uniforms.oceanShadowDebugMode.value = mode | 0;
      });
    };
    //Opacity for the cascade-band overlay (debug mode 40). 0 = scene only,
    //1 = overlay only, 0.5 = half-and-half. Call setOceanShadowDebug(40) first,
    //then setDebugBlend(0.5) to dial how strongly the cascade colours show over
    //the real waves.
    grid.setDebugBlend = function(v){
      const blend = +v;
      grid.forEachOceanMesh(function(mesh){
        mesh.material.uniforms.debugBlend.value = blend;
      });
    };
    grid.setSunShadowBias = function(offset){
      grid._sunShadowBiasOffset = +offset || 0.0;
    };
    grid.setSunShadowEnabled = function(enabled){
      grid._sunShadowOverride = enabled === null || enabled === undefined ? null : !!enabled;
      const v = grid._sunShadowOverride === false ? 0 : 1;
      grid.forEachOceanMesh(function(mesh){
        mesh.material.uniforms.sunShadowEnabled.value = v;
      });
    };
    grid.setOceanShadowEnabled = function(enabled){
      grid._oceanShadowOverride = enabled === null || enabled === undefined ? null : !!enabled;
      const v = grid._oceanShadowOverride === false ? 0 : 1;
      grid.forEachOceanMesh(function(mesh){
        mesh.material.uniforms.oceanShadowEnabled.value = v;
      });
    };
    //Live-tune the receiver-side normal-offset bias from the console. Pushes
    //to every water tile material at once so the change is visible next
    //frame. Pass a value in WORLD METERS — typical range 0.05 to 2.0.
    grid.setOceanShadowNormalBias = function(meters){
      grid.forEachOceanMesh(function(mesh){
        mesh.material.uniforms.oceanShadowNormalBias.value = +meters;
      });
    };
    //EVSM warp constant. Pushes to BOTH the receiver materials and the
    //caster materials (via the CSM helper). Keep them in sync — caster
    //emits exp(c·z) moments and receiver computes exp(c·refZ); a mismatch
    //makes every comparison nonsense.
    grid.setOceanEvsmExpC = function(c){
      const v = +c;
      grid.forEachOceanMesh(function(mesh){
        mesh.material.uniforms.evsmExpC.value = v;
      });
      if(grid.oceanShadowCSM){
        grid.oceanShadowCSM.setEvsmExpC(v);
      }
    };
    //EVSM minimum variance floor. Tiny number; raise (e.g. 1e-3) if you
    //see speckle in penumbra; lower (e.g. 1e-5) if shadow gradients feel
    //too soft.
    grid.setOceanEvsmMinVariance = function(v){
      const f = +v;
      grid.forEachOceanMesh(function(mesh){
        mesh.material.uniforms.evsmMinVariance.value = f;
      });
    };
    //EVSM light-bleed reduction threshold in [0, 1). Higher = harder
    //shadows, more contrast; lower = softer with risk of light bleed.
    grid.setOceanEvsmLightBleedReduction = function(v){
      const f = +v;
      grid.forEachOceanMesh(function(mesh){
        mesh.material.uniforms.evsmLightBleedReduction.value = f;
      });
    };
    grid.setReflectionScale = function(v){
      grid.reflectionScale = +v;
    };
    //SSR march step cap. 48 = full reach (default); try 32/16/8 to find the
    //fps/quality knee; 0 skips the march entirely (sky-only) as a bottleneck A/B.
    grid.setSsrMaxSteps = function(v){
      grid.ssrMaxSteps = +v;
    };
    grid.setReflectionDistanceFalloff = function(v){
      grid.reflectionDistanceFalloff = +v;
    };
    grid.setFresnelDistanceRoughness = function(v){
      grid.fresnelDistanceRoughness = +v;
    };
    grid.setSurfaceRoughness = function(v){
      grid.surfaceRoughness = +v;
    };
    //Crest-style sun-glint live knobs. setSpecFresnelGate(0..1): 0 = legacy
    //ungated additive glint, 1 = Crest Fresnel-gated. setSpecFalloffFar /
    //setSpecFalloffFarDist drive the distance lobe-widening ramp (far defaults
    //to 275 = near, a no-op until lowered). setSpecBoost is _DirectionalLightBoost.
    grid.setSpecFresnelGate = function(v){
      grid.specFresnelGate = +v;
    };
    grid.setSpecBoost = function(v){
      grid.specBoost = +v;
    };
    grid.setSpecFalloffFar = function(v){
      grid.specFalloffFar = +v;
    };
    grid.setSpecFalloffFarDist = function(v){
      grid.specFalloffFarDist = +v;
    };
    //Live-tune atmospheric perspective strength. Default 1.0. Set to 0.0 to
    //fully bypass extinction + inscatter on the water surface (the per-frame
    //tick will still overwrite at the next ocean-grid update unless we keep
    //it in sync — that's why we also mirror onto the cached field).
    grid.setAtmDistanceScale = function(v){
      grid.atmosphericPerspectiveDistanceScale = +v;
    };
    //Render every ocean tile (FFT tiles + horizon skirt) as wireframe so the
    //clipmap cell structure and per-ring tessellation density are visible.
    //ShaderMaterial honours `wireframe` natively — no shader recompile needed.
    //Call from the console: setOceanWireframe(1) on, setOceanWireframe(0) off.
    grid.setOceanWireframe = function(enabled){
      const flag = !!enabled;
      grid.forEachOceanMesh(function(mesh){
        mesh.material.wireframe = flag;
      });
    };
    grid.setShadowHelpers = function(enabled){
      const on = !!enabled;
      if(!on){
        if(grid._shadowHelpers){
          for(let i = 0; i < grid._shadowHelpers.length; i++){
            grid.scene.remove(grid._shadowHelpers[i]);
            grid._shadowHelpers[i].dispose && grid._shadowHelpers[i].dispose();
          }
          grid._shadowHelpers = null;
        }
        return;
      }
      if(grid._shadowHelpers) return;
      grid._shadowHelpers = [];
      const colors = [0xff4040, 0xff9020, 0xffe040, 0x40e060]; //C0..C3 fine→coarse
      //THREE.CameraHelper uses vertex colours, so setting .material.color does
      //nothing visible — the default rainbow palette (yellow/magenta/red/green)
      //comes from the BufferGeometry's color attribute. Use setColors() to
      //override all five segments to a single solid colour so each helper is
      //distinguishable by its own colour rather than all wearing the rainbow.
      const tintHelper = function(helper, hex){
        const c = new THREE.Color(hex);
        if(typeof helper.setColors === 'function'){
          helper.setColors(c, c, c, c, c);
        } else {
          //Fallback for older Three.js without setColors: paint the color
          //attribute directly. Three colours per line segment vertex.
          const attr = helper.geometry && helper.geometry.attributes.color;
          if(attr){
            for(let i = 0; i < attr.count; i++){
              attr.setXYZ(i, c.r, c.g, c.b);
            }
            attr.needsUpdate = true;
          }
        }
        helper.material.depthTest = false;
        helper.material.toneMapped = false;
        helper.renderOrder = 999;
      };
      //Scene sun shadow camera (the one that gates lighthouse/terrain shadows).
      const light = grid.brightestDirectionalLight;
      if(light && light.shadow && light.shadow.camera){
        const h = new THREE.CameraHelper(light.shadow.camera);
        tintHelper(h, 0xffffff);
        grid.scene.add(h);
        grid._shadowHelpers.push(h);
      }
      //Ocean CSM cascades.
      if(grid.oceanShadowCSM && grid.oceanShadowCSM.cascades){
        const cs = grid.oceanShadowCSM.cascades;
        for(let i = 0; i < cs.length; i++){
          const h = new THREE.CameraHelper(cs[i].lightCamera);
          tintHelper(h, colors[i] || 0xffffff);
          grid.scene.add(h);
          grid._shadowHelpers.push(h);
        }
      }
    };

    //$DEBUG_START$
    //Dump the scene-wide directional-light shadow camera + the ocean CSM
    //cascades. Use this when terrain-on-water shadows clip at a moving line:
    //the scene shadow's ortho frustum is what gates non-ocean casters
    //(lighthouse, trees, rocks). Increase `sky-shadow-camera-size` in the
    //host scene if the printed footprint is smaller than the visible water.
    grid.dumpShadowRanges = function(){
      const light = grid.brightestDirectionalLight;
      if(light && light.shadow && light.shadow.camera){
        const sc = light.shadow.camera;
        const w = (sc.right - sc.left);
        const h = (sc.top - sc.bottom);
        const target = light.target ? light.target.position : null;
        console.log('[scene sun shadow]',
          'extent', w.toFixed(1), 'x', h.toFixed(1), 'm',
          'near/far', sc.near.toFixed(1), '/', sc.far.toFixed(1),
          'light pos', light.position.toArray().map(function(v){return v.toFixed(1);}).join(', '),
          'target', target ? target.toArray().map(function(v){return v.toFixed(1);}).join(', ') : 'none',
          'map', light.shadow.mapSize.x + 'x' + light.shadow.mapSize.y,
          '→ texel', (w / light.shadow.mapSize.x * 100).toFixed(1) + ' cm');
      } else {
        console.log('[scene sun shadow] no light/shadow camera registered');
      }
      if(grid.oceanShadowCSM && grid.oceanShadowCSM.cascades){
        const cs = grid.oceanShadowCSM.cascades;
        for(let i = 0; i < cs.length; i++){
          const cfg = cs[i].cfg;
          console.log('[ocean CSM C' + i + ']',
            'extent', cfg.extent.toFixed(1), 'm',
            'depthRange', cs[i].depthRange.toFixed(1), 'm',
            'map', cfg.mapSize + 'x' + cfg.mapSize,
            '→ texel', (cfg.extent / cfg.mapSize * 100).toFixed(1) + ' cm',
            'layer', cfg.layer, 'maxRing', cfg.maxRing);
        }
      }
    };
    if(typeof window !== 'undefined'){
      window.dumpShadowRanges = grid.dumpShadowRanges;
      window.setShadowHelpers = grid.setShadowHelpers;
      window.setSunShadowBias = grid.setSunShadowBias;
      window.setOceanShadowDebug = grid.setOceanShadowDebug;
      window.setDebugBlend = grid.setDebugBlend;
      window.setSunShadowEnabled = grid.setSunShadowEnabled;
      window.setOceanShadowEnabled = grid.setOceanShadowEnabled;
      window.setOceanShadowNormalBias = grid.setOceanShadowNormalBias;
      window.setOceanEvsmExpC = grid.setOceanEvsmExpC;
      window.setOceanEvsmMinVariance = grid.setOceanEvsmMinVariance;
      window.setOceanEvsmLightBleedReduction = grid.setOceanEvsmLightBleedReduction;
      window.setReflectionScale = grid.setReflectionScale;
      window.setSsrMaxSteps = grid.setSsrMaxSteps;
      window.setReflectionDistanceFalloff = grid.setReflectionDistanceFalloff;
      window.setFresnelDistanceRoughness = grid.setFresnelDistanceRoughness;
      window.setSurfaceRoughness = grid.setSurfaceRoughness;
      window.setSpecFresnelGate = grid.setSpecFresnelGate;
      window.setSpecBoost = grid.setSpecBoost;
      window.setSpecFalloffFar = grid.setSpecFalloffFar;
      window.setSpecFalloffFarDist = grid.setSpecFalloffFarDist;
      window.setOceanWireframe = grid.setOceanWireframe;
      window.setAtmDistanceScale = grid.setAtmDistanceScale;
      //Direct handle on the grid instance for console probes (RT readback etc.).
      window.oceanGrid = self;

      //── WaterField probes (Phase 1) ───────────────────────────────────────
      //probeWaterField()      -> field under the camera
      //probeWaterField(x, z)  -> field at a world position
      //The field is invisible by design in Phase 1a (it holds the same answers
      //0.2.0 already assumed), so this is how you confirm it is alive and
      //carrying sane values rather than zeros.
      window.probeWaterField = function(x, z){
        const f = grid.waterFieldPass;
        if(!f){ console.log('[waterField] pass not loaded'); return; }
        const px = (x === undefined) ? grid.globalCameraPosition.x : x;
        const pz = (z === undefined) ? grid.globalCameraPosition.z : z;
        f.probeAt(px, pz).then(function(r){
          if(!r){ console.log('[waterField] no cascade covers', px.toFixed(1), pz.toFixed(1)); return; }
          console.log('[waterField] at', px.toFixed(1), pz.toFixed(1),
            '| cascade', r.cascade,
            '| level', r.level.toFixed(2),
            '| depth', r.depth.toFixed(2),
            '| flow', r.flowX.toFixed(2), r.flowZ.toFixed(2),
            '| expect level ==', grid.heightOffset, '(height_offset) in Phase 1a');
          //Same texel through the async PBO path, for comparison. If this
          //disagrees with the sync read above, the PBO collision is real.
          f.probeAt(px, pz, {async: true}).then(function(a){
            if(a) console.log('[waterField]   async(PBO) read of the same texel:',
              'level', a.level.toFixed(2), 'depth', a.depth.toFixed(2),
              a.level === r.level ? '(agrees)' : '(DISAGREES -> PBO collision)');
          });
        });
      };
      //Dump each cascade's world footprint — confirms they follow the camera
      //and stay snapped to their own texel grid.
      //Known-constant round trip through the field's MRT. Tells you whether the
      //render-and-read pipeline works at all, independent of the fill maths.
      window.testWaterField = function(){
        const f = grid.waterFieldPass;
        if(!f){ console.log('[waterField] pass not loaded'); return; }
        f.selfTest().then(function(msg){ console.log('[waterField selfTest] ' + msg); });
      };
      window.dumpWaterField = function(){
        const f = grid.waterFieldPass;
        if(!f){ console.log('[waterField] pass not loaded'); return; }
        for(let i = 0; i < f.cascades.length; i++){
          const c = f.cascades[i];
          console.log('[waterField] cascade ' + i,
            'half', c.halfWidth + ' m',
            'texel', c.texel.toFixed(2) + ' m',
            'centre', c.centerX === undefined ? 'NEVER FILLED' : (c.centerX.toFixed(1) + ', ' + c.centerZ.toFixed(1)));
        }
      };
      //Splash particles: debug tint (0 normal, 1 tint-by-type), master toggle, and
      //a direct handle on the OceanSplash instance for live-tuning its plain-JS
      //knobs (e.g. oceanSplash.crestSpawnChance = 0.2).
      window.setSplashDebug = function(n){ if(grid.oceanSplash) grid.oceanSplash.debugMode = n | 0; };
      window.setSplashEnabled = function(e){ if(grid.oceanSplash) grid.oceanSplash.enabled = !!e; };
      //Debug surface probe: a red ball parked on the sampled emission surface in
      //front of the camera, to check whether spawn HEIGHT tracks the visible
      //waterline. The probe is a child of the splash mesh, which only renders when
      //the system is enabled, so turning the probe on also forces enabled = true.
      window.setSplashMarker = function(e){
        if(!grid.oceanSplash) return;
        grid.oceanSplash.debugMarker = !!e;
        if(e) grid.oceanSplash.enabled = true;
      };
      window.oceanSplash = grid.oceanSplash;
      //Reflection-vector shore launch: setSplashReflect(reflect, runUp) tunes how the
      //impact sheet leaves a cliff. reflect 0=cone up the surface normal (old look),
      //1=mirror the incoming water off the face; runUp adds upward climb on a head-on
      //slam. e.g. setSplashReflect(1, 1.2) (defaults) → tall directional cliff sheets.
      window.setSplashReflect = function(reflect, runUp){
        if(!grid.oceanSplash) return;
        if(reflect !== undefined) grid.oceanSplash.impactReflect = +reflect;
        if(runUp !== undefined) grid.oceanSplash.impactRunUp = +runUp;
      };
      //Wind-driven foam ("dip the Jacobian"): tune the storm-whitening ramp live.
      //setFoamWindBiasMax(0.6) sets the cap; setFoamWindRange(10,50) the m/s window.
      window.setFoamWindBiasMax = function(v){ grid.foamWindBiasMax = +v; };
      window.setFoamWindRange = function(start, full){ grid.foamWindStart = +start; grid.foamWindFull = +full; };
    }
    //$DEBUG_END$
};
