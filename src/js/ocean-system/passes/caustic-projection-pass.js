//── Underwater caustic projection pass ──────────────────────────────────────
//
//Extracted verbatim from ocean-grid.js (0.2.0 lines 297-473 and 2062-2185) as
//part of the Phase 0 decomposition. Behaviour is unchanged; see
//WATER-TYPES-PROGRESS.md for the full old-line -> new-file map.
//
//WHY THIS EXISTS
//The water shader paints caustics onto the refracted seabed when the camera is
//ABOVE water; submerged, the seabed is seen directly and never passes through
//the water shader at all. To put caustics on it without touching the (often
//imported, unknown) seabed materials, we project them with a SpotLight cookie —
//the one THREE light type whose `.map` is cast onto whatever it lights, on any
//material, with no shader surgery.
//
//SpotLight.map projects a single "slide" across the cone and ignores texture
//repeat/offset, so the tiling AND the animation are baked into the slide here:
//a small RT re-rendered each submerged frame. Each slide texel is unprojected
//through the projector's OWN shadow camera onto the water-surface plane and the
//pattern is evaluated in WORLD XZ — so the cast caustics are world-anchored by
//construction and the projector itself glides continuously with the camera.
//(This replaced an earlier integer-tile XZ snapping: the snap kept the PATTERN
//world-stable but made the cone envelope, decay vignette and the spot shadow POV
//hop one tile at a time as the camera swam.)
//
//OWNERSHIP SPLIT
//This pass owns the RESOURCES — the slide render target, its fullscreen scene /
//camera / material, the SpotLight, and the per-frame scratch vectors. OceanGrid
//keeps the KNOBS (causticLightIntensity, causticLightHeight,
//causticLightConeRadius, causticTexturePeriod, causticProjectionResolution,
//causticsStrength) so the existing `window.oceanGrid.causticLight*` console
//tuning paths keep working unchanged.
//
//ONE DELIBERATE CHANGE FROM 0.2.0: the sun-direction scratch Vector3 used to be
//`oceanGrid._uwSunDirScratch`, shared with the underwater murk block in tick.
//Both fully overwrite before reading and neither reads across, so it worked —
//but it was a latent trap. This pass now owns `_sunDirScratch`. No visual change.

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.CausticProjectionPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.scene = oceanGrid.scene;

  this.target = null;
  this.light = null;
  this._projectionScene = null;
  this._projectionCamera = null;
  this._projectionMaterial = null;
  this._lightAdded = false;
  //Refracted sun ray (in-water travel direction). Reused per frame to avoid alloc.
  this._refrScratch = new THREE.Vector3();
  //Direction TO the sun. Private to this pass — see the header note.
  this._sunDirScratch = new THREE.Vector3();
};

ARestlessOcean.Passes.CausticProjectionPass.prototype.init = function(){
  const grid = this.oceanGrid;

  this.target = new THREE.WebGLRenderTarget(
    grid.causticProjectionResolution, grid.causticProjectionResolution,
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    }
  );
  this._projectionScene = new THREE.Scene();
  this._projectionCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._projectionMaterial = new THREE.ShaderMaterial({
    uniforms: {
      causticMap: {value: null},
      uTime: {value: 0.0},
      //Inverse view-projection of the projector's shadow camera — the SAME
      //camera the cookie projects through, so slide texel <-> world mapping is
      //exact by construction. Filled per frame in tick().
      uInvVP: {value: new THREE.Matrix4()},
      uSurfaceY: {value: 0.0},
      uPeriod: {value: grid.causticTexturePeriod}
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){',
      '  vUv = uv;',
      '  gl_Position = vec4(position.xy, 0.0, 1.0);',
      '}'
    ].join('\n'),
    //Mirrors causticShader() in water-shader.glsl: two non-parallel scrolling
    //samples min'd together, then a smoothstep contrast curve. The pattern is
    //sampled in world XZ / uPeriod, the same parameterisation the water
    //shader uses (0.1 * pSurfaceHit.xz), so size, drift speed AND phase line
    //up across the waterline. The three chromatically-offset taps give
    //caustic light its R/B dispersion — the foci of different wavelengths
    //land slightly apart (matches the +/-0.005 caustic-UV offset the water
    //shader's causticShader uses).
    fragmentShader: [
      'uniform sampler2D causticMap;',
      'uniform float uTime;',
      'uniform mat4 uInvVP;',
      'uniform float uSurfaceY;',
      'uniform float uPeriod;',
      'varying vec2 vUv;',
      'float caustic(vec2 uv, float t){',
      '  vec2 uv1 = uv + vec2(0.8, 0.1) * t;',
      '  vec2 uv2 = uv - vec2(0.2, 0.7) * t;',
      '  float a = texture2D(causticMap, uv1).r;',
      '  float b = texture2D(causticMap, uv2).g;',
      //LO/HI are solved by make-caustic-map.py against the generated caustic
      //texture (must match CAUSTIC_THRESHOLD_LO/HI in water-shader.glsl).
      '  return smoothstep(0.0, 1.0, min(a, b));',
      '}',
      'void main(){',
      //Unproject this slide texel through the projector camera and intersect
      //the water-surface plane: the pattern is evaluated where the cookie ray
      //pierces the surface, so it stays world-anchored while the projector
      //moves, and the keystone of a tilted cone is handled exactly.
      '  vec2 ndc = vUv * 2.0 - 1.0;',
      '  vec4 pNear = uInvVP * vec4(ndc, -1.0, 1.0);',
      '  vec4 pFar  = uInvVP * vec4(ndc,  1.0, 1.0);',
      '  vec3 ro = pNear.xyz / pNear.w;',
      '  vec3 rd = normalize(pFar.xyz / pFar.w - ro);',
      //rd.y is always negative (the projector looks down); the min() guards
      //the degenerate near-horizontal case rather than dividing by ~0.
      '  float s = (uSurfaceY - ro.y) / min(rd.y, -0.001);',
      '  vec2 uv = (ro.xz + rd.xz * s) / uPeriod;',
      '  float t = uTime / 8.0;',
      '  float r = caustic(uv + vec2(0.005), t);',
      '  float g = caustic(uv,               t);',
      '  float b = caustic(uv - vec2(0.005), t);',
      '  gl_FragColor = vec4(r, g, b, 1.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  this._projectionScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 2.0), this._projectionMaterial
  ));

  //The projector. distance 0 -> no hard cutoff. decay 2 (inverse-square) gives
  //a soft depth falloff: fragments farther from the projector (= deeper, since
  //the projector sits above the surface and tracks the camera XZ) receive
  //less light, approximating the Beer-Lambert attenuation of sunlight on its
  //way down to the seabed. The runtime compensates intensity by
  //pow(causticLightHeight, decay) so surface-level brightness matches what
  //the old decay-0 cast produced — only the depth gradient is new.
  //castShadow ON — the scene sun shadow only darkens the seabed's DIFFUSE
  //term; this cookie light is additive, so without its own occlusion the web
  //lands on seabed inside an island/hull sun shadow. The water surface
  //cannot block the cone: ocean patches, the underwater curtain and the
  //horizon skirt all set castShadow = false, so only real scene casters
  //(terrain, hulls, lighthouse) register in the spot's shadow map.
  //castShadow stays PERMANENTLY true: toggling it at the waterline would
  //change NUM_SPOT_LIGHT_SHADOWS and recompile every lit material on each
  //crossing — the same churn the intensity-instead-of-visible rule below
  //avoids. The idle cost above water is one depth pass over whatever sits in
  //the cone; tick() parks the projector far below the world while surfaced so
  //that pass frustum-culls to zero draws.
  //Kept permanently in the scene with intensity driven to 0 above water:
  //toggling light.visible would change the visible-light count and recompile
  //every lit material on each waterline crossing. (SpotLight.map updates its
  //projection matrix on its own — WebGLLights calls shadow.updateMatrices
  //when a map is present.)
  this.light = new THREE.SpotLight(0xffffff, 0.0);
  this.light.decay = 2.0;
  this.light.distance = 0.0;
  //Low penumbra: THREE's spot falloff starts at angle*(1-penumbra), so a high
  //value vignettes most of the 60m cone — at 0.8 full brightness reached only
  //a ~12m ground radius and the visible seabed sat in the falloff ramp. 0.25
  //keeps full strength to ~45m; the remaining edge lands beyond underwater
  //visibility (Jerlov 1C ~13m) so no hard cone ring shows.
  this.light.penumbra = 0.25;
  this.light.angle = Math.atan(grid.causticLightConeRadius / grid.causticLightHeight);
  this.light.castShadow = true;
  this.light.shadow.mapSize.set(2048, 2048);
  //Tight depth range for perspective shadow precision at the receiver band:
  //the projector sits causticLightHeight (400 m) up the refracted sun ray, so
  //the seabed lives ~400-460 m from it and above-water casters (island peaks,
  //lighthouse) no closer than ~200 m. near=100/far=600 brackets both with
  //margin. light.distance stays 0 so SpotLightShadow.updateMatrices keeps our
  //far. normalBias 1.5 matches what the scene sun needed on the same imported
  //terrain (islands.html acne fix).
  this.light.shadow.camera.near = 100.0;
  this.light.shadow.camera.far = 600.0;
  this.light.shadow.normalBias = 1.5;
  //The slide pass reads this camera's projectionMatrixInverse before THREE's
  //own shadow pass has ever run updateMatrices — keep it valid from frame 0.
  this.light.shadow.camera.updateProjectionMatrix();
  this.light.map = this.target.texture;
  this._lightAdded = false;
};

//Screen-resolution independent — the slide RT is a fixed square.
ARestlessOcean.Passes.CausticProjectionPass.prototype.resize = function(){};

//How much to scale light we hand to FOREIGN materials, so a sibling's global exposure does not
//crush it. 1 whenever nobody is driving the exposure, which is the common case.
//
//Guarded on the tone-mapping MODE and not just the value: with NoToneMapping the exposure is
//never applied by anyone, so compensating for it would be a straight brightness bug. The bounds
//are a refusal to trust a number we do not own — a sibling mid-initialisation can publish an
//exposure of 0 or NaN, and an intensity of Infinity is a white screen with nothing in the
//console.
ARestlessOcean.Passes.CausticProjectionPass.prototype.foreignExposureCompensation = function(){
  const r = this.renderer;
  if(!r || r.toneMapping === THREE.NoToneMapping) return 1.0;
  const e = r.toneMappingExposure;
  if(!isFinite(e) || e <= 0.0) return 1.0;
  const c = 1.0 / e;
  return (c > 1e6) ? 1e6 : c;
};

//Refresh the underwater caustic projector. Positions the SpotLight high above
//the camera down the refracted sun ray (a near-parallel cast so caustic cell
//size barely changes with seabed depth), re-renders the animated caustic slide
//through the projector's own shadow camera (world-anchored — see init), and
//crossfades its intensity through the waterline via underwaterFactor. The
//projector tracks the camera XZ continuously; world anchoring lives in the
//slide content, so no snapping and no envelope/shadow jumps. Skipped entirely
//above water.
//
//ctx: {time, waterSurfaceY, underwaterFactor, causticMap, cameraX, cameraZ, sunLight}
ARestlessOcean.Passes.CausticProjectionPass.prototype.tick = function(ctx){
  const grid = this.oceanGrid;
  const light = this.light;
  //Scene isn't available at construction — add the projector + its target
  //once, on the first tick that has a scene.
  if(!this._lightAdded && this.scene){
    this.scene.add(light);
    this.scene.add(light.target);
    this._lightAdded = true;
  }
  //Above water, or the caustic texture hasn't loaded yet: drive intensity to
  //zero (not light.visible — see the init note) and skip the RT cost.
  //castShadow stays true (init note), so the spot's shadow depth pass
  //still runs while surfaced — park the projector far below the world so
  //that pass frustum-culls every caster and costs nothing. The y-check makes
  //the park a one-time move per surfacing, not a per-frame write.
  if(!ctx.causticMap || ctx.underwaterFactor <= 0.001){
    light.intensity = 0.0;
    if(light.position.y > -9000.0){
      light.position.set(0.0, -10000.0, 0.0);
      light.target.position.set(0.0, -10400.0, 0.0);
      light.target.updateMatrixWorld();
    }
    return;
  }

  //Surface anchor: the camera XZ, unsnapped — the slide pass below bakes
  //world anchoring into the pattern itself, so the projector (and with it
  //the cone envelope, decay vignette and shadow POV) moves smoothly.
  const anchorX = ctx.cameraX;
  const anchorZ = ctx.cameraZ;

  //Sun travel direction (from the brightest directional light toward the
  //scene — downward when the sun is up). Drives BOTH the projector tilt below
  //and the colour/brightness. cosZ is the same geometric "how much sun
  //overhead" factor the underwater inscatter uses (water-shader.glsl :1391),
  //so caustic falloff at low sun matches the rest of the underwater lighting
  //stack; without it a sun 1 degree above the horizon would cast full strength.
  let sunMult = 1.0;
  let haveSun = false;
  const sunDir = this._sunDirScratch;
  if(ctx.sunLight){
    const ml = ctx.sunLight;
    light.color.copy(ml.color);
    sunDir.set(ml.position.x, ml.position.y, ml.position.z)
      .sub(ml.target.position).negate().normalize();
    const cosZ = Math.max(-sunDir.y, 0.0);
    //Schlick air->water transmission (same as the murk dir term in tick) —
    //at grazing sun most light reflects OFF the surface and never enters
    //the water, so caustics must die toward sunset with the rest of the
    //underwater light, not linger at cosZ strength.
    const oneMinusCosZ = 1.0 - cosZ;
    const fresAW = 0.02037 + (1.0 - 0.02037)
                 * (oneMinusCosZ*oneMinusCosZ*oneMinusCosZ*oneMinusCosZ*oneMinusCosZ);
    sunMult = ml.intensity * cosZ * (1.0 - fresAW);
    haveSun = cosZ > 0.0;
  }

  //Tilt the projector along the sun ray REFRACTED into the water (Snell,
  //air->water n=1/1.33 at a flat +Y surface) instead of casting straight down,
  //so the caustic web rakes across the seabed at the true sun angle. refr is
  //the in-water travel direction — still downward, just leaned toward the
  //anti-solar azimuth. It collapses to (0,-1,0) at solar zenith, so this is a
  //pure superset of the old straight-down cast. Total internal reflection
  //can't occur air->water, but k<0 is guarded anyway; we also fall back to
  //straight down when the sun is at/below the horizon (projector is off via
  //sunMult->0 there regardless).
  const refr = this._refrScratch;
  if(haveSun){
    const eta = 1.0 / 1.33;
    const nDotI = sunDir.y;                       //dot((0,1,0), sunDir)
    const k = 1.0 - eta * eta * (1.0 - nDotI * nDotI);
    if(k >= 0.0){
      const scale = eta * nDotI + Math.sqrt(k);   //R = eta*I - scale*N
      refr.set(eta * sunDir.x, eta * sunDir.y - scale, eta * sunDir.z).normalize();
    } else {
      refr.set(0.0, -1.0, 0.0);
    }
  } else {
    refr.set(0.0, -1.0, 0.0);
  }
  //Place the projector one causticLightHeight UP the ray from the surface
  //anchor and the target down-ray; (target - position) prop. to refr => the cone
  //axis is the refracted sun ray, and a surface-level fragment stays exactly
  //causticLightHeight from the projector (keeps decayCompensation valid).
  const h = grid.causticLightHeight;
  const waterSurfaceY = ctx.waterSurfaceY;
  light.position.set(anchorX - refr.x * h, waterSurfaceY - refr.y * h, anchorZ - refr.z * h);
  light.target.position.set(anchorX + refr.x * 100.0, waterSurfaceY + refr.y * 100.0, anchorZ + refr.z * 100.0);
  light.target.updateMatrixWorld();
  light.angle = Math.atan(grid.causticLightConeRadius / grid.causticLightHeight);
  //Compensate for the projector's inverse-square decay so the surface-level
  //caustic brightness is invariant to `causticLightHeight`. A fragment at
  //y = surfaceY sits `causticLightHeight` metres from the projector; that
  //gives a `1 / height^decay` attenuation we cancel here. Fragments deeper
  //than the surface still attenuate (their distance to the projector is
  //larger), producing the depth falloff this decay was added for.
  const decayCompensation = Math.pow(grid.causticLightHeight, light.decay);
  //AND COMPENSATE FOR A SIBLING'S EXPOSURE, if one is driving it.
  //
  //This is the inbound half of the a-land lighting seam (the outbound half is a-land's
  //u_offscreenTone: our captures of its terrain were getting lux with no exposure). Here the
  //arrow points the other way. a-land meters the world in lux and pays for it by driving
  //renderer.toneMappingExposure to ~1.8e-5 at noon (land-terrain.js _applyPhotometry), and
  //every stock lit material applies that exposure through three's tone map. Our projector is a
  //real THREE.SpotLight in that same list, carried at an intensity tuned against exposure 1 —
  //so on any page with a-land AND a sky it arrives ~55,000x under and the seabed caustics
  //simply are not there. Measured: the sky-less pond shows light shafts, the sky pond none.
  //
  //Dividing by the exposure puts our contribution back on the scale the surface it lands on
  //will be graded at. It is a no-op at exposure 1, which is every scene without a-land
  //photometry, so nothing that looks right today moves.
  //
  //⚠ SAFE ONLY BECAUSE NOTHING OF OURS READS SPOT LIGHTS. The ocean material is a raw
  //ShaderMaterial that never includes <tonemapping_fragment> and never samples spotLights[] —
  //grep src/glsl — so this boost reaches exactly the tone-mapped materials it is correcting
  //for and cannot leak into our own shading. If the ocean ever starts reading spot lights,
  //this has to move behind a per-material split.
  light.intensity = grid.causticLightIntensity * grid.causticsStrength
                  * ctx.underwaterFactor * sunMult * decayCompensation
                  * this.foreignExposureCompensation();

  //Re-render the animated caustic slide LAST, through the projector pose
  //set above. shadow.updateMatrices is the same call WebGLLights makes when
  //it projects the cookie, so the camera we unproject the slide through is
  //bit-identical to the one that casts it back out.
  light.updateWorldMatrix(true, false);
  light.shadow.updateMatrices(light);
  const shadowCam = light.shadow.camera;
  const mat = this._projectionMaterial;
  mat.uniforms.causticMap.value = ctx.causticMap;
  mat.uniforms.uTime.value = ctx.time * 0.001;
  mat.uniforms.uSurfaceY.value = waterSurfaceY;
  mat.uniforms.uInvVP.value.copy(shadowCam.matrixWorld).multiply(shadowCam.projectionMatrixInverse);
  const prevRT = this.renderer.getRenderTarget();
  this.renderer.setRenderTarget(this.target);
  this.renderer.render(this._projectionScene, this._projectionCamera);
  this.renderer.setRenderTarget(prevRT);
};

ARestlessOcean.Passes.CausticProjectionPass.prototype.dispose = function(){
  if(this._lightAdded && this.scene){
    this.scene.remove(this.light);
    this.scene.remove(this.light.target);
    this._lightAdded = false;
  }
  if(this.light && this.light.shadow && this.light.shadow.map){
    this.light.shadow.map.dispose();
  }
  this._projectionScene.traverse(function(obj){
    if(obj.isMesh && obj.geometry) obj.geometry.dispose();
  });
  if(this._projectionMaterial) this._projectionMaterial.dispose();
  if(this.target) this.target.dispose();
  this.target = null;
};
