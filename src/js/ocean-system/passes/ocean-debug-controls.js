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
    //How much ripple detail the SKY half of the SSR follows. 0 = the original
    //macroNormal-only reflection (tracks the long swell only, reads as a mirror
    //while the water ripples under it); 1 = full displacedNormal detail. The
    //geometry raymarch always stays on macroNormal. A/B this against the horizon:
    //if the far field sparkles, the cure is specNormal (cascade-5 low-passed),
    //not a lower blend — see the note at the call site in water-shader.glsl.
    grid.setSsrSkyNormalBlend = function(v){
      grid.ssrSkyNormalBlend = +v;
    };
    //The same for the geometry raymarch — this is the one that governs whether a
    //REFLECTED SHORELINE's silhouette breaks up with the waves or slides around as
    //one rigid shape. 0 = the original macroNormal march. If turning this up makes
    //the reflection noisy or stripey rather than merely detailed, that is the
    //failure mode the original macroNormal choice was guarding against.
    grid.setSsrMarchNormalBlend = function(v){
      grid.ssrMarchNormalBlend = +v;
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
      window.setSsrSkyNormalBlend = grid.setSsrSkyNormalBlend;
      window.setSsrMarchNormalBlend = grid.setSsrMarchNormalBlend;
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
            '| shoreSDF', r.shoreSDF === undefined ? '?' : r.shoreSDF.toFixed(2) + ' m',
            '| dryMask', r.dryMask,
            '| type', r.type, '| energy', r.energy === undefined ? '?' : r.energy.toFixed(3));
          //Same texel through the async PBO path, for comparison. If this
          //disagrees with the sync read above, the PBO collision is real.
          f.probeAt(px, pz, {async: true}).then(function(a){
            if(a) console.log('[waterField]   async(PBO) read of the same texel:',
              'level', a.level.toFixed(2), 'depth', a.depth.toFixed(2),
              a.level === r.level ? '(agrees)' : '(DISAGREES -> PBO collision)');
          });
        });
      };
      //Grid-scan the field around the camera and summarise it. Answers the
      //question a single probe cannot: is the depth channel actually alive, or
      //is every texel falling through to the open-ocean default because the
      //foam-ortho terrain read is broken?
      window.scanWaterField = function(radius, n){
        const f = grid.waterFieldPass;
        if(!f){ console.log('[waterField] pass not loaded'); return; }
        const R = radius || 400, N = n || 7;
        const cx = grid.globalCameraPosition.x, cz = grid.globalCameraPosition.z;
        const jobs = [];
        for(let i = 0; i < N; i++){
          for(let j = 0; j < N; j++){
            const x = cx + (i / (N - 1) * 2 - 1) * R;
            const z = cz + (j / (N - 1) * 2 - 1) * R;
            jobs.push(f.probeAt(x, z).then(function(r){ return {x: x, z: z, r: r}; }));
          }
        }
        Promise.all(jobs).then(function(all){
          let terrain = 0, open = 0, uncovered = 0;
          let dMin = Infinity, dMax = -Infinity, lMin = Infinity, lMax = -Infinity;
          const OPEN = ARestlessOcean.Passes.WaterFieldPass.OPEN_OCEAN_DEPTH;
          for(const a of all){
            if(!a.r){ uncovered++; continue; }
            if(a.r.depth === OPEN) open++; else terrain++;
            dMin = Math.min(dMin, a.r.depth); dMax = Math.max(dMax, a.r.depth);
            lMin = Math.min(lMin, a.r.level); lMax = Math.max(lMax, a.r.level);
          }
          console.log('[waterField scan] ' + N + 'x' + N + ' over +/-' + R + ' m around the camera');
          console.log('  level   min ' + lMin.toFixed(2) + '  max ' + lMax.toFixed(2)
            + (lMin === lMax ? '  (flat, as expected in Phase 1a)' : '  <- should be FLAT in Phase 1a'));
          console.log('  depth   min ' + dMin.toFixed(2) + '  max ' + dMax.toFixed(2));
          console.log('  texels: ' + terrain + ' saw terrain, ' + open + ' fell back to open-ocean ('
            + OPEN + ' m), ' + uncovered + ' outside every cascade');
          if(terrain === 0){
            console.log('  ⚠ NO texel found terrain. Either you are far from land, or the '
              + 'foam-ortho depth read is broken. Fly near an island and re-run.');
          }
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
      //Phase 1b: GPU cascade decode vs. a-land's own getWaterAt at the same
      //world point. compareWaterField(x, z) prints one point's delta;
      //testWaterFieldParity() sweeps a small grid and flags anything beyond
      //float32 rounding — this must be byte-for-byte, not "close enough"
      //(WATER-TYPES.md:449-451).
      window.compareWaterField = function(x, z){
        const f = grid.waterFieldPass;
        if(!f){ console.log('[waterField] pass not loaded'); return; }
        f.compareAgainstLandTerrain(x, z).then(function(r){
          console.log('[waterField parity]', r);
        });
      };
      window.testWaterFieldParity = function(radius, n){
        const f = grid.waterFieldPass;
        if(!f){ console.log('[waterField] pass not loaded'); return; }
        if(!grid._landTerrainApi){ console.log('[waterField parity] no a-land terrain discovered'); return; }
        const R = radius || 100, N = n || 5;
        const cx = grid.globalCameraPosition.x, cz = grid.globalCameraPosition.z;
        const jobs = [];
        for(let i = 0; i < N; i++){
          for(let j = 0; j < N; j++){
            const x = cx + (i / (N - 1) * 2 - 1) * R;
            const z = cz + (j / (N - 1) * 2 - 1) * R;
            jobs.push(f.compareAgainstLandTerrain(x, z));
          }
        }
        Promise.all(jobs).then(function(all){
          let checked = 0, mismatches = 0;
          for(const r of all){
            if(r.deltaLevel === null) continue;
            checked++;
            if(Math.abs(r.deltaLevel) > 0.05 || Math.abs(r.deltaDepth) > 0.05){
              mismatches++;
              console.log('[waterField parity] MISMATCH at texel centre', r.texelX.toFixed(2), r.texelZ.toFixed(2),
                'deltaLevel', r.deltaLevel.toFixed(3), 'deltaDepth', r.deltaDepth.toFixed(3));
            }
          }
          console.log('[waterField parity] ' + checked + ' points compared, ' + mismatches + ' mismatches'
            + (checked === 0 ? ' (no wet points in range — try near the lake/ocean)' : ''));
        });
      };
      //One-shot "why is the water wrong" dump. Covers the whole Phase 1b chain
      //in one call: provider wiring, what the field holds, whether the SHADER
      //can actually sample it, and the vertex delta that follows. The last two
      //matter because probeAt reads the texel back directly and so cannot see a
      //sampling failure — a float texture that is unfilterable on this GPU
      //reads back fine and still samples as black in the shader.
      window.diagnoseWaterField = function(x, z){
        const f = grid.waterFieldPass;
        const px = (x === undefined) ? grid.globalCameraPosition.x : x;
        const pz = (z === undefined) ? grid.globalCameraPosition.z : z;
        console.log('── WaterField diagnosis @', px.toFixed(1), pz.toFixed(1), '──');
        console.log('terrain_provider   :', grid._terrainProvider);
        console.log('landTerrainApi     :', grid._landTerrainApi ? 'found' : 'MISSING');
        console.log('landDirector       :', grid._landDirector ? 'found' : 'MISSING');
        console.log('landTerrainRoot    :', grid._landTerrainRoot ? 'found' : 'MISSING');
        console.log('heightOffset       :', grid.heightOffset);
        if(!f){ console.log('waterFieldPass     : MISSING'); return; }
        console.log('OES_texture_float_linear:', f.floatLinearSupported,
          f.floatLinearSupported ? '' : '  <- cascades fall back to NEAREST; before this fix they sampled BLACK');
        for(let i = 0; i < f.cascades.length; ++i){
          const c = f.cascades[i];
          console.log('  cascade ' + i, 'half', c.halfWidth, 'centre',
            c.centerX === undefined ? 'NEVER FILLED' : (c.centerX + ', ' + c.centerZ));
        }
        //Is the shader actually bound to the cascades? Find one ocean patch
        //material and look at the uniforms the vertex shader reads.
        let mat = null;
        grid.scene.traverse(function(o){
          if(!mat && o.isMesh && o.material && o.material.uniforms
             && o.material.uniforms.waterFieldCascade0) mat = o.material;
        });
        if(!mat){
          console.log('patch uniforms     : NO ocean material carries waterFieldCascade0'
            + '  <- water-shader.js is stale, re-run create-shader.py');
        } else {
          const u = mat.uniforms;
          console.log('patch uniforms     : cascade0 tex',
            u.waterFieldCascade0.value ? 'bound' : 'NULL  <- never uploaded',
            '| centre[0]', u.waterFieldCascadeCenter.value[0],
            '| half[0]', u.waterFieldCascadeHalfWidth.value[0]);
        }
        const dec = f._tileDecodePass && f._tileDecodePass.decoder;
        if(dec){
          let ready = 0, loading = 0, dry = 0;
          dec._cache.forEach(function(v){
            if(v === 'loading') loading++; else if(v === 'dry') dry++; else ready++;
          });
          console.log('tile cache         :', ready, 'decoded,', loading, 'loading,', dry, 'dry');
        } else {
          console.log('tile decode pass   : NOT BUILT  <- a-land never reached the field');
        }
        //Submersion state: is the murk dark because we think we are far deeper
        //than we are? Depth drives the camera-depth darkening, and view
        //distance drives extinction — these two lines separate them.
        const camY = grid.globalCameraPosition.y;
        const surfY = grid.waterLevelAt(px, pz);
        const probedY = grid._lastWaterSurfaceY;
        console.log('camera Y           :', camY.toFixed(2));
        console.log('surface Y here     :', surfY.toFixed(2),
          '| last probed surface', probedY === undefined ? 'none yet' : probedY.toFixed(2));
        console.log('submersion depth   :', (surfY - camY).toFixed(2), 'm',
          (surfY - camY) > 0 ? '(underwater)' : '(above water)');
        //Extinction scale: how far you can see before each channel is gone.
        //1/absorption is the e-folding distance in metres.
        //⚠ the Jerlov preset WINS over the explicit water_absorption vec3
        //whenever water_type is non-zero, so report whichever actually applies.
        const wt = grid.data.water_type | 0;
        const preset = ARestlessOcean.JERLOV_PRESETS[wt];
        const ab = preset ? preset.absorption : grid.data.water_absorption;
        console.log('water_type         :', wt,
          preset ? '(Jerlov preset — the explicit water_absorption vec3 is IGNORED)' : '(custom absorption)');
        if(ab && ab.x){
          console.log('e-fold distance    : R', (1 / ab.x).toFixed(1) + ' m,',
            'G', (1 / ab.y).toFixed(1) + ' m,', 'B', (1 / ab.z).toFixed(1) + ' m',
            ' <- past a few of these everything is black, whatever the depth');
        }
        const cpu = grid._landTerrainApi ? grid._landTerrainApi.getWaterAt(px, pz) : null;
        console.log('CPU getWaterAt     :', cpu ? ('level ' + cpu.level.toFixed(2) + ', depth ' + cpu.depth.toFixed(2)) : 'null (dry / not loaded)');
        f.probeAt(px, pz).then(function(r){
          if(!r){ console.log('GPU probe          : no cascade covers this point'); return; }
          console.log('GPU probe (texel)  : level', r.level.toFixed(2), 'depth', r.depth.toFixed(2), 'cascade', r.cascade);
          const delta = r.level - grid.heightOffset;
          console.log('vertex delta       :', delta.toFixed(2), 'm',
            Math.abs(delta) > 50.0
              ? '  <- ⚠ this is what moves the whole ocean surface; a large value here floods the world'
              : '');
        });
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
        console.log('[waterField] shore field', f.shoreFieldEnabled ? 'ON' : 'OFF',
          '| cascade refills so far', f.refillCount,
          '(~' + (f.shoreFieldEnabled ? 12 : 1) + ' fullscreen 512² draws each; judge cost by frame rate, ON vs OFF)');
      };
      //Perf A/B for the Phase 1c jump flood. Off = shoreSDF reads "no shore".
      window.setShoreFieldEnabled = function(on){
        const f = grid.waterFieldPass;
        if(!f) return;
        f.shoreFieldEnabled = !!on;
        f.invalidate();
      };

      //── Shore field (Phase 1c) ────────────────────────────────────────────
      //showShoreField(cascade, mode, opts)  mode: 'sdf' | 'dry' | 'slope'
      //  Draws one cascade into a top-right canvas (clear of the shader's own
      //  corner panels and top strip). -Z is UP, +X is right, the
      //  camera is the white dot at the centre (the cascades follow it).
      //  sdf   : blue = water, brown = land, darker = farther from the shore,
      //          a thin line every 10 m, white on the shoreline itself.
      //  dry   : blue = wet, red = a-land SAYS dry (dryMask 1), grey = dry by
      //          fallback only (no provider answer), black = outside the world.
      //  slope : the surveyShore() classes, per wet texel within 40 m of shore —
      //          green spilling, yellow plunging, orange surging, red cliff.
      //  opts.wind  reference wind (m/s) for 'slope' (default: live wind, or 12
      //             when the live wind is too calm to make surf)
      //  opts.live  re-draw every N ms (each draw is a synchronous 512² float
      //             readback — a debug stall, not something to leave running)
      //hideShoreField() removes it.
      //
      //surveyShore(opts) — "is this world too steep for surf?", with numbers.
      //  Reads cascade 0 (1 m texels, ±256 m around the camera) unless
      //  opts.cascade says otherwise, so FLY TO THE COAST YOU CARE ABOUT FIRST.
      //  opts.wind adds an evaluation at that wind (default 12 m/s) beside the
      //  live one. See _surveyShoreField below for the model and its caveats.
      const SHORE_RIM_MARGIN = 40.0;   //metres ignored at a cascade rim (the SDF there cannot see past the edge)
      const SHORE_BAND_MAX = 40.0;

      //Sea state for a wind speed, from the SAME formulas the spectrum uses:
      //Hs from ocean-wave-field.js's calibration, omega_p from
      //ocean-height-band-library.js (fetch-limited JONSWAP, floored at PM).
      const seaStateFor = function(windSpeed){
        const g = 9.81;
        const lib = grid.oceanHeightBandLibrary;
        const gamma = (lib && lib.jonswapGamma) || 3.3;
        const fetch = (grid.data && grid.data.jonswap_fetch) || 100000.0;
        const U = Math.max(windSpeed, 0.001);
        const Hs = 0.21 * U * U / g * Math.pow(gamma, 0.3);
        const omegaP = Math.max(22.0 * Math.pow(g * g / (U * fetch), 1.0 / 3.0), 0.86 * g / U);
        const Tp = 2.0 * Math.PI / omegaP;
        const L0 = g * Tp * Tp / (2.0 * Math.PI);
        return {wind: windSpeed, Hs: Hs, Tp: Tp, L0: L0, breakerDepth: Hs / 0.78};
      };
      const liveWindSpeed = function(){
        const w = grid.windVelocity;
        return w ? Math.sqrt(w.x * w.x + w.y * w.y) : 0.0;
      };
      //Iribarren (surf-similarity) number and the Battjes (1974) breaker bands.
      const iribarren = function(tanB, sea){ return tanB / Math.sqrt(Math.max(sea.Hs, 1e-6) / sea.L0); };
      const breakerClass = function(xi){ return xi < 0.5 ? 0 : (xi < 3.3 ? 1 : 2); };
      const CLASS_NAMES = ['spilling', 'plunging', 'surging'];

      //Per-texel nearshore slope for one cascade readback. A wet texel at
      //shore distance d with water depth h gives the MEAN slope between it and
      //the shoreline, tanβ = h / d — exactly the slope a wave crosses on its way
      //in, which is what the breaker models want (not the local gradient).
      //⚠ a-land depth saturates at simulation.maxDepth; texels at the cap only
      //bound the slope from below, and are counted as `saturated`.
      const collectShoreSlopes = function(field, maxDepth){
        const res = field.res, a = field.a;
        const rimTexels = Math.ceil(SHORE_RIM_MARGIN / field.texel);
        const out = [];
        let saturated = 0;
        for(let row = rimTexels; row < res - rimTexels; ++row){
          for(let col = rimTexels; col < res - rimTexels; ++col){
            const o = (row * res + col) * 4;
            const depth = a[o + 1], sdf = a[o + 2];
            if(!(depth > 0.0) || sdf <= 0.0 || sdf > SHORE_BAND_MAX) continue;
            if(maxDepth && depth >= maxDepth * 0.98) saturated++;
            out.push({sdf: sdf, depth: depth, tanB: depth / Math.max(sdf, 0.5 * field.texel)});
          }
        }
        return {samples: out, saturated: saturated};
      };
      const quantile = function(sorted, q){
        if(sorted.length === 0) return NaN;
        return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      };
      const landMaxDepth = function(){
        const mj = grid._landDirector && grid._landDirector.mapJson;
        return (mj && mj.simulation && mj.simulation.maxDepth) || 0;
      };

      window.surveyShore = function(opts){
        opts = opts || {};
        const f = grid.waterFieldPass;
        if(!f){ console.log('[surveyShore] pass not loaded'); return; }
        if(!f.shoreFieldEnabled){ console.log('[surveyShore] shore field is OFF — setShoreFieldEnabled(true) and wait a frame'); return; }
        const ci = opts.cascade | 0;
        const field = f.readCascade(ci);
        if(!field){ console.log('[surveyShore] cascade', ci, 'never filled'); return; }
        const maxDepth = landMaxDepth();
        const got = collectShoreSlopes(field, maxDepth);
        const samples = got.samples;
        const fmtSlope = function(t){
          return isFinite(t) ? (t.toFixed(3) + ' (1:' + (1 / Math.max(t, 1e-6)).toFixed(1) + ', ' + (Math.atan(t) * 180 / Math.PI).toFixed(1) + '°)') : 'n/a';
        };
        console.log('── surveyShore — cascade ' + ci + ' (' + field.texel.toFixed(2) + ' m texels, ±'
          + (field.halfWidth - SHORE_RIM_MARGIN) + ' m around ' + field.centerX.toFixed(0) + ', ' + field.centerZ.toFixed(0) + ') ──');
        if(samples.length === 0){
          console.log('No wet texels within ' + SHORE_BAND_MAX + ' m of a shore here. Fly to a coastline and re-run.');
          return;
        }
        //Slope by distance band.
        const bands = [[0, 5], [5, 20], [20, 40]];
        for(const band of bands){
          const t = samples.filter(function(s){ return s.sdf > band[0] && s.sdf <= band[1]; })
            .map(function(s){ return s.tanB; }).sort(function(x, y){ return x - y; });
          console.log('  ' + (band[0] + '–' + band[1] + ' m').padEnd(9) + ' offshore: n=' + String(t.length).padEnd(6)
            + ' p10 ' + fmtSlope(quantile(t, 0.1)) + '   median ' + fmtSlope(quantile(t, 0.5)) + '   p90 ' + fmtSlope(quantile(t, 0.9)));
        }
        //"Cliff": already more than 10 m deep within 5 m of the shoreline.
        const near = samples.filter(function(s){ return s.sdf <= 5.0; });
        const cliff = near.filter(function(s){ return s.depth > 10.0; }).length;
        console.log('  cliff shoreline (>10 m deep within 5 m): ' + (near.length ? (100 * cliff / near.length).toFixed(1) : '0') + '%');
        if(got.saturated > 0){
          console.log('  ⚠ ' + got.saturated + ' texels sit at a-land\'s maxDepth cap (' + maxDepth + ' m) — their slope is a LOWER bound');
        }

        //Breakers, evaluated where waves actually break for this sea: the
        //nearshore band 0 < d <= 15 m.
        const breakBand = samples.filter(function(s){ return s.sdf <= 15.0; });
        const tanMedian = quantile(breakBand.map(function(s){ return s.tanB; }).sort(function(x, y){ return x - y; }), 0.5);
        const live = liveWindSpeed();
        const refWind = opts.wind !== undefined ? +opts.wind : 12.0;
        const winds = (Math.abs(refWind - live) < 0.5) ? [live] : [live, refWind];
        for(const w of winds){
          const sea = seaStateFor(w);
          //Below ~5 cm there is no surf to classify, and ξ's √(Hs/L0) is
          //numerically meaningless at a near-zero wind (Tp → 0).
          if(sea.Hs < 0.05){
            console.log('  @ wind ' + w.toFixed(1) + ' m/s' + (w === live ? ' (live)' : ' (reference)')
              + ': Hs ' + sea.Hs.toFixed(3) + ' m — calm, no breakers to classify'
              + (w === live ? '; read the reference line' : ''));
            continue;
          }
          const counts = [0, 0, 0];
          for(const smp of breakBand) counts[breakerClass(iribarren(smp.tanB, sea))]++;
          const n = breakBand.length || 1;
          const surfWidth = sea.breakerDepth / Math.max(tanMedian, 1e-6);
          console.log('  @ wind ' + w.toFixed(1) + ' m/s' + (w === live ? ' (live)' : ' (reference)')
            + ': Hs ' + sea.Hs.toFixed(2) + ' m, Tp ' + sea.Tp.toFixed(1) + ' s, L0 ' + sea.L0.toFixed(0) + ' m'
            + ' → spilling ' + (100 * counts[0] / n).toFixed(0) + '%, plunging ' + (100 * counts[1] / n).toFixed(0)
            + '%, surging ' + (100 * counts[2] / n).toFixed(0) + '%'
            + ' | breaks in ' + sea.breakerDepth.toFixed(2) + ' m of water, surf zone ~' + surfWidth.toFixed(1) + ' m wide at the median slope'
            + (surfWidth < 2.0 * field.texel ? '  ⚠ narrower than 2 texels — Phase 3 breakers could not resolve it' : ''));
        }
        console.log('  Model: Battjes breaker bands on ξ = tanβ/√(Hs/L0) (spilling <0.5, plunging <3.3, surging ≥3.3),'
          + ' McCowan breaking at h = Hs/0.78, deep-water Hs/Tp from the live spectrum formulas.'
          + ' Surging = waves slosh up the rock without breaking; that is the "too steep" answer.');
      };

      let shoreCanvas = null, shoreLiveTimer = null;
      window.hideShoreField = function(){
        if(shoreLiveTimer){ clearInterval(shoreLiveTimer); shoreLiveTimer = null; }
        if(shoreCanvas && shoreCanvas.parentNode) shoreCanvas.parentNode.removeChild(shoreCanvas);
        shoreCanvas = null;
      };
      window.showShoreField = function(cascade, mode, opts){
        opts = opts || {};
        const f = grid.waterFieldPass;
        if(!f){ console.log('[showShoreField] pass not loaded'); return; }
        const ci = cascade | 0;
        mode = mode || 'sdf';
        const draw = function(){
          const field = f.readCascade(ci);
          if(!field) return;
          const res = field.res;
          if(!shoreCanvas){
            shoreCanvas = document.createElement('canvas');
            shoreCanvas.style.cssText = 'position:fixed;right:12px;top:12px;width:384px;height:384px;'
              + 'z-index:99999;border:1px solid #fff;image-rendering:pixelated;pointer-events:none;';
            document.body.appendChild(shoreCanvas);
          }
          shoreCanvas.width = res; shoreCanvas.height = res;
          const ctx2d = shoreCanvas.getContext('2d');
          const img = ctx2d.createImageData(res, res);
          const px = img.data;
          const live = liveWindSpeed();
          const sea = seaStateFor(opts.wind !== undefined ? +opts.wind : (live < 5.0 ? 12.0 : live));
          const hasWorld = !!grid._landDirector;
          const isoStep = 10.0;
          for(let row = 0; row < res; ++row){
            for(let col = 0; col < res; ++col){
              //Row 0 of the readback is the cascade's min-Z edge — drawn at the top, so -Z is up.
              const o = (row * res + col) * 4;
              const depth = field.a[o + 1], sdf = field.a[o + 2], dry = field.a[o + 3];
              let r = 0, g = 0, bl = 0;
              if(mode === 'dry'){
                if(depth > 0.0){ r = 40; g = 110; bl = 220; }
                else if(dry > 0.5){ r = 200; g = 50; bl = 50; }
                else if(hasWorld){ r = 110; g = 110; bl = 110; }
              } else if(mode === 'slope'){
                if(depth > 0.0 && sdf > 0.0 && sdf <= SHORE_BAND_MAX){
                  const tanB = depth / Math.max(sdf, 0.5 * field.texel);
                  if(sdf <= 5.0 && depth > 10.0){ r = 220; g = 30; bl = 30; }
                  else {
                    const k = breakerClass(iribarren(tanB, sea));
                    if(k === 0){ r = 60; g = 200; bl = 90; }
                    else if(k === 1){ r = 235; g = 215; bl = 60; }
                    else { r = 240; g = 140; bl = 40; }
                  }
                } else if(depth > 0.0){ r = 20; g = 45; bl = 90; }
                else { r = 60; g = 55; bl = 50; }
              } else {
                const t = Math.min(1.0, Math.abs(sdf) / 100.0);
                if(sdf > 0.0){ r = 90 * (1 - t); g = 170 * (1 - t) + 30; bl = 255 * (1 - t) + 60; }
                else { r = 190 * (1 - t) + 40; g = 140 * (1 - t) + 30; bl = 90 * (1 - t) + 20; }
                //Contour where the iso band changes toward the +X or +Z neighbour: a
                //clean 1-px line. A modulo window instead aliases — texels whose
                //distance lands exactly on k+0.5 (every axis-aligned run) miss it.
                const band = Math.floor(sdf / isoStep);
                const right = col < res - 1 ? field.a[o + 4 + 2] : sdf;
                const down = row < res - 1 ? field.a[o + res * 4 + 2] : sdf;
                if(Math.floor(right / isoStep) !== band || Math.floor(down / isoStep) !== band){ r = r * 0.55; g = g * 0.55; bl = bl * 0.55; }
                if(Math.abs(sdf) <= field.texel){ r = 255; g = 255; bl = 255; }
              }
              px[o] = r; px[o + 1] = g; px[o + 2] = bl; px[o + 3] = 255;
            }
          }
          ctx2d.putImageData(img, 0, 0);
          //Camera: the cascade is snapped around it, so it sits within a texel of the centre.
          const camCol = (grid.globalCameraPosition.x - (field.centerX - field.halfWidth)) / field.texel;
          const camRow = (grid.globalCameraPosition.z - (field.centerZ - field.halfWidth)) / field.texel;
          ctx2d.fillStyle = '#fff';
          ctx2d.beginPath(); ctx2d.arc(camCol, camRow, 4, 0, 2 * Math.PI); ctx2d.fill();
          ctx2d.font = '14px monospace';
          ctx2d.fillText('cascade ' + ci + ' ' + mode + ' | ' + field.texel.toFixed(0) + ' m/px | -Z up'
            + (mode === 'slope' ? ' | wind ' + sea.wind.toFixed(0) + ' m/s' : ''), 6, 18);
        };
        draw();
        if(shoreLiveTimer){ clearInterval(shoreLiveTimer); shoreLiveTimer = null; }
        if(opts.live) shoreLiveTimer = setInterval(draw, Math.max(250, +opts.live));
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
