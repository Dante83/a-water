AWater.AOcean.LUTlibraries.OceanHeightComposer = function(parentOceanGrid){
  let data = parentOceanGrid.data;
  this.renderer = parentOceanGrid.renderer;
  this.baseTextureWidth = data.patch_data_size;
  this.baseTextureHeight = data.patch_data_size;
  this.N = data.number_of_octaves;
  this.OceanMaterialHeightBandLibrary = parentOceanGrid.oceanHeightBandLibrary;
  this.numCascades = this.OceanMaterialHeightBandLibrary.numCascades;

  // ===== Per-cascade displacement + foam packer =====
  // Packs each cascade's x/y/z FFT outputs into RGB, and computes persistent
  // Jacobian-based foam in the alpha channel (Water-style accumulation).
  const packVertShader = [
    'void main(){',
    '  gl_Position = vec4(position, 1.0);',
    '}'
  ].join('\n');

  //Displacement pack shader with Jacobian foam accumulation.
  //Computes the Jacobian from XZ displacement finite differences (central differences),
  //reads the previous frame's foam from a persistent texture, applies exponential decay,
  //and accumulates new foam where the Jacobian indicates wave folding/breaking.
  const packFragShader = [
    'uniform sampler2D xTexture;',
    'uniform sampler2D yTexture;',
    'uniform sampler2D zTexture;',
    'uniform sampler2D prevFoamTexture;',
    'uniform vec2 resolution;',
    'uniform float patchSize;',
    'uniform float chop;',
    'uniform float foamBias;',
    'uniform float foamDecayMultiplier;',
    'uniform float foamAdd;',
    'uniform float foamThreshold;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / resolution.xy;',
    '  float eps = 1.0 / resolution.x;',
    //h_0 and h_k pack the spectrum with DC centered at (N/2, N/2). The IFFT
    //then produces a result shifted by N/2 in both axes. Undo that with the
    //standard checkerboard (-1)^(x+y) sign flip applied per IFFT output texel.
    //Neighbour taps for the Jacobian read texels one step over — opposite
    //parity — so each tap gets its own sign before the finite-difference math.
    '  vec2 texCoord = floor(uv * resolution);',
    '  float ifftSignC = mod(texCoord.x + texCoord.y, 2.0) < 0.5 ? 1.0 : -1.0;',
    '  float ifftSignN = -ifftSignC;',
    '  float dx = texture2D(xTexture, uv).x * ifftSignC;',
    '  float dy = texture2D(yTexture, uv).x * ifftSignC;',
    '  float dz = texture2D(zTexture, uv).x * ifftSignC;',
    //Central differences on XZ displacement for Jacobian
    '  float dxR = texture2D(xTexture, uv + vec2(eps, 0.0)).x * ifftSignN;',
    '  float dxL = texture2D(xTexture, uv + vec2(-eps, 0.0)).x * ifftSignN;',
    '  float dxT = texture2D(xTexture, uv + vec2(0.0, eps)).x * ifftSignN;',
    '  float dxB = texture2D(xTexture, uv + vec2(0.0, -eps)).x * ifftSignN;',
    '  float dzR = texture2D(zTexture, uv + vec2(eps, 0.0)).x * ifftSignN;',
    '  float dzL = texture2D(zTexture, uv + vec2(-eps, 0.0)).x * ifftSignN;',
    '  float dzT = texture2D(zTexture, uv + vec2(0.0, eps)).x * ifftSignN;',
    '  float dzB = texture2D(zTexture, uv + vec2(0.0, -eps)).x * ifftSignN;',
    //dDx/dx, dDz/dz, dDx/dz (cross term)
    //One UV texel = patchSize/resolution meters, so dD/dx = dD/duv / patchSize
    '  float worldStep = patchSize / resolution.x;',
    '  float dDxdx = (dxR - dxL) / (2.0 * worldStep);',
    '  float dDzdz = (dzT - dzB) / (2.0 * worldStep);',
    '  float dDxdz = (dxT - dxB) / (2.0 * worldStep);',
    //Jacobian: vertex shader applies -chop to raw x/z, so actual world derivatives
    //are -chop*dDxdx and -chop*dDzdz. Match wave-normal-composer convention.
    //dDz/dx ≈ dDx/dz for irrotational waves, so we use dDxdz for both cross terms.
    '  float jacobian = (1.0 - chop * dDxdx) * (1.0 - chop * dDzdz) - chop * chop * dDxdz * dDxdz;',
    //Read previous frame foam. Blend center with 4-neighbor average (spatial diffusion)
    //so foam spreads into soft patches rather than staying as sharp point-source pixels.
    //Sharp foam edges alias against mesh triangle boundaries and appear as straight tris.
    '  float prevFoam = texture2D(prevFoamTexture, uv).a;',
    '  float foamN = texture2D(prevFoamTexture, uv + vec2(0.0,  eps)).a;',
    '  float foamS = texture2D(prevFoamTexture, uv + vec2(0.0, -eps)).a;',
    '  float foamE = texture2D(prevFoamTexture, uv + vec2( eps, 0.0)).a;',
    '  float foamW = texture2D(prevFoamTexture, uv + vec2(-eps, 0.0)).a;',
    '  float foam = mix(prevFoam, 0.25 * (foamN + foamS + foamE + foamW), 0.15) * foamDecayMultiplier;',
    '  foam = clamp(foam, 0.0, 1.0);',
    //Crests have J < 1 (compressed), troughs have J > 1 (stretched).
    //Accumulate where J falls below the bias threshold (compressed/breaking crests).
    '  float biasedJacobian = max(0.0, -(jacobian - foamBias));',
    '  if(biasedJacobian > foamThreshold){',
    '    foam += foamAdd * biasedJacobian;',
    '  }',
    '  gl_FragColor = vec4(dx, dy, dz, foam);',
    '}'
  ].join('\n');

  const cascadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const cascadeQuadGeo = new THREE.PlaneGeometry(2, 2);
  this._packMaterial = new THREE.ShaderMaterial({
    uniforms: {
      xTexture: {type: 't', value: null},
      yTexture: {type: 't', value: null},
      zTexture: {type: 't', value: null},
      prevFoamTexture: {type: 't', value: null},
      resolution: {type: 'v2', value: new THREE.Vector2(this.baseTextureWidth, this.baseTextureHeight)},
      patchSize: {type: 'f', value: 1000.0},
      chop: {type: 'f', value: data.chop || 0.75},
      //Equivalent to Crest _WaveFoamCoverage. Formula is max(0, foamBias - jacobian), same as
      //Crest saturate(_WaveFoamCoverage - det). Flat water J=1.0 always, so foamBias must be
      //< 1.0 or flat water accumulates foam.
      //
      //Per-cascade Jacobian sensitivity: our ×4 cascade doubling means each band spans
      //2 octaves — so an individual cascade's per-pixel slope only carries half the total
      //broadband steepness at a given crest. A 16 m wave with 0.5 m amplitude has slope
      //~0.20 → J ≈ 0.65 within its own cascade, which a 0.5 bias misses entirely.
      //
      //0.85 catches typical C2/C3 crests (biasedJacobian ~0.1-0.2 at fire pixels →
      //steady-state foam alpha ~0.7-1.0). C4/C5 will fire heavily but the water shader
      //only samples C2+C3 alpha so their over-firing is harmless. The earlier "constant
      //sparkle at 0.9" note pre-dates the C0+C1 → C2+C3 alpha-read swap; sparkle came
      //from chop content in those alpha reads, not from the bias level itself.
      foamBias: {type: 'f', value: 0.85},
      //Pre-multiplied by Math.exp(-decay_rate). At 60 fps, decay_rate r gives
      //half-life ≈ ln(2)/r frames ≈ ln(2)/(60·r) seconds. Common values:
      //   r=0.015 → ~0.8 s half-life (Crest default, looked too snappy here)
      //   r=0.005 → ~2.3 s half-life (foam trail readable as the wave passes)
      //   r=0.002 → ~5.8 s half-life (long-lived foam, risks saturation)
      //Mutate at runtime via _packMaterial.uniforms.foamDecayMultiplier.value
      //= Math.exp(-rate).
      foamDecayMultiplier: {type: 'f', value: Math.exp(-0.005)},
      //Per-frame foam contribution at a firing pixel. With foamBias 0.85 and a
      //moderate per-cascade fold (biasedJacobian ~0.1-0.2), 0.08 left the alpha
      //plateauing around 0.4-0.6 on open-water crests — not enough to bring
      //foamBlackPoint = 1 - fftFoamAmount down to where the foam texture's
      //bright spots cross the smoothstep edge. 0.4 saturates firing pixels to
      //the [0,1] clamp within ~5-10 frames, matching the near-shore behaviour
      //where shoreBoost slams foamAmount to 1.0 directly.
      foamAdd: {type: 'f', value: 0.4},
      foamThreshold: {type: 'f', value: 0.0}
    },
    vertexShader: packVertShader,
    fragmentShader: packFragShader,
    depthTest: false,
    depthWrite: false
  });
  this._packScene = new THREE.Scene();
  this._packScene.add(new THREE.Mesh(cascadeQuadGeo, this._packMaterial));

  this._cascadeCamera = cascadeCamera;
  this._cascadePatchSizes = this.OceanMaterialHeightBandLibrary.cascadePatchSizes;
  this.waveHeightMultiplier = data.wave_scale_multiple;

  //Mipmaps on the displacement RT let the GPU pick the right LOD as the camera
  //pulls back, which fixes two problems at once:
  //  - Foam alpha aliasing: the C0/C1 foam channels stop reading as 1-pixel
  //    sparkle at mid-distance because the GPU integrates them properly.
  //  - Normal sampling stability: the per-fragment central-difference normals
  //    sample a mip level matched to screen-pixel footprint, killing the
  //    high-freq shimmer that comes from sub-pixel cascade content.
  //Three.js auto-calls gl.generateMipmap on the RT texture after each render
  //when generateMipmaps:true. Float RTs need OES_texture_float_linear (gated
  //in ocean-height-band-library.js).
  const cascadeRTOptions = {
    minFilter: THREE.LinearMipMapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: true
  };

  //Ping-pong displacement+foam targets per cascade.
  //We write to one and read the previous frame's foam from the other.
  this.cascadeDisplacementTargetsA = [];
  this.cascadeDisplacementTargetsB = [];
  this.cascadeDisplacementTextures = [];
  this._foamPingPong = 0; //0 = write A read B, 1 = write B read A
  //First-frame prevFoamTexture sample reads from rtB which has never been
  //rendered to — uninitialized FloatType texture content is undefined per
  //the WebGL spec and can come back as NaN on some drivers. NaN then
  //propagates through the foam accumulator (NaN * decay = NaN, clamp(NaN)
  //undefined) and locks the alpha channel at NaN forever, killing all
  //open-water foam. Explicit zero-clear at construction guarantees a
  //well-defined starting state for both ping-pong sets.
  const prevRenderTarget = this.renderer.getRenderTarget();
  const prevClearColor = new THREE.Color();
  this.renderer.getClearColor(prevClearColor);
  const prevClearAlpha = this.renderer.getClearAlpha();
  this.renderer.setClearColor(0x000000, 0.0);
  for(let c = 0; c < this.numCascades; c++){
    const rtA = new THREE.WebGLRenderTarget(this.baseTextureWidth, this.baseTextureHeight, cascadeRTOptions);
    rtA.texture.wrapS = THREE.RepeatWrapping;
    rtA.texture.wrapT = THREE.RepeatWrapping;
    const rtB = new THREE.WebGLRenderTarget(this.baseTextureWidth, this.baseTextureHeight, cascadeRTOptions);
    rtB.texture.wrapS = THREE.RepeatWrapping;
    rtB.texture.wrapT = THREE.RepeatWrapping;
    this.renderer.setRenderTarget(rtA);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(rtB);
    this.renderer.clear(true, false, false);
    this.cascadeDisplacementTargetsA.push(rtA);
    this.cascadeDisplacementTargetsB.push(rtB);
    this.cascadeDisplacementTextures.push(rtA.texture);
  }
  this.renderer.setClearColor(prevClearColor, prevClearAlpha);
  this.renderer.setRenderTarget(prevRenderTarget);

  // ===== Broadband foam packer =====
  // Mirrors Crest's UpdateFoam.compute architecture: a single foam RT that
  // accumulates from the SUMMED-displacement Jacobian (C2+C3+C4 together)
  // instead of per-cascade, advects previous-frame foam by a wind velocity
  // so foam rides the surface, and decays with frame-rate-independent dt
  // scaling. Replaces the live in-shader `turbulence` boost which had no
  // temporal smoothing and produced "blop into existence" foam.
  //
  // Tile choice: 256 m matches C2's patch size. C3 (64 m) and C4 (16 m)
  // both divide 256, so all three cascades' wave content wraps seamlessly
  // at the foam tile boundary — no seams. C1 (1024 m) and C0 (4096 m) are
  // skipped: their slope contribution per pixel is tiny (long-wavelength
  // swells), and including them would force foamTileSize up to 1024 m,
  // quadrupling foam-texel size for marginal Jacobian gain.
  this.broadbandFoamResolution = this.baseTextureWidth;
  this.broadbandFoamTileSize = this._cascadePatchSizes[2]; // = 256 m

  const broadbandPackFragShader = [
    'uniform sampler2D cascadeDispC2;',
    'uniform sampler2D cascadeDispC3;',
    'uniform sampler2D cascadeDispC4;',
    'uniform vec2 cascadeOffsetC2;',
    'uniform vec2 cascadeOffsetC3;',
    'uniform vec2 cascadeOffsetC4;',
    'uniform float cascadeSizeC2;',
    'uniform float cascadeSizeC3;',
    'uniform float cascadeSizeC4;',
    'uniform sampler2D prevFoamTexture;',
    'uniform vec2 resolution;',
    'uniform float foamTileSize;',
    'uniform vec2 windVelocity;',
    'uniform float advectionScale;',
    'uniform float deltaTime;',
    'uniform float foamFadeRate;',
    'uniform float foamCoverage;',
    'uniform float foamStrength;',
    'uniform float chop;',
    'uniform float waveHeightMultiplier;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / resolution;',
    //World position represented by this foam-tile texel. The tile is
    //world-aligned with REPEAT wrap so worldXZ % foamTileSize maps to
    //the same texel from any matching world position.
    '  vec2 worldXZ = uv * foamTileSize;',
    //1 m offset for forward-difference broadband derivatives. Larger than
    //a single cascade texel (smallest C4 texel = 16/512 = 0.03 m) so the
    //difference is robust against single-texel noise but still small
    //enough to resolve crest-scale slope variation.
    '  const float worldEps = 1.0;',
    '  vec2 worldXZ_dx = worldXZ + vec2(worldEps, 0.0);',
    '  vec2 worldXZ_dz = worldXZ + vec2(0.0, worldEps);',
    //Summed displacement at center + +X + +Z. .xz is the horizontal
    //displacement; .y (height) is unused here because the Jacobian only
    //depends on horizontal stretch/compression.
    '  vec2 d   = vec2(0.0);',
    '  vec2 dDX = vec2(0.0);',
    '  vec2 dDZ = vec2(0.0);',
    '  d   += texture2D(cascadeDispC2, (worldXZ    + cascadeOffsetC2) / cascadeSizeC2).xz;',
    '  dDX += texture2D(cascadeDispC2, (worldXZ_dx + cascadeOffsetC2) / cascadeSizeC2).xz;',
    '  dDZ += texture2D(cascadeDispC2, (worldXZ_dz + cascadeOffsetC2) / cascadeSizeC2).xz;',
    '  d   += texture2D(cascadeDispC3, (worldXZ    + cascadeOffsetC3) / cascadeSizeC3).xz;',
    '  dDX += texture2D(cascadeDispC3, (worldXZ_dx + cascadeOffsetC3) / cascadeSizeC3).xz;',
    '  dDZ += texture2D(cascadeDispC3, (worldXZ_dz + cascadeOffsetC3) / cascadeSizeC3).xz;',
    '  d   += texture2D(cascadeDispC4, (worldXZ    + cascadeOffsetC4) / cascadeSizeC4).xz;',
    '  dDX += texture2D(cascadeDispC4, (worldXZ_dx + cascadeOffsetC4) / cascadeSizeC4).xz;',
    '  dDZ += texture2D(cascadeDispC4, (worldXZ_dz + cascadeOffsetC4) / cascadeSizeC4).xz;',
    //waveHeightMultiplier matches the scale the water shader applies, so
    //our Jacobian sees the same slope magnitudes the visible waves have.
    '  d   *= waveHeightMultiplier;',
    '  dDX *= waveHeightMultiplier;',
    '  dDZ *= waveHeightMultiplier;',
    '  vec2 dDxz_dx = (dDX - d) / worldEps;',
    '  vec2 dDxz_dz = (dDZ - d) / worldEps;',
    //Broadband Jacobian. Surface map is P(u,v) = (u - chop*Dx, h, v - chop*Dz):
    //  J = (1 - chop*dDx/du)(1 - chop*dDz/dv) - chop² * dDz/du * dDx/dv
    //Flat water → J = 1, compressed crest → J < 1, fold → J < 0.
    '  float jacobian = (1.0 - chop * dDxz_dx.x) * (1.0 - chop * dDxz_dz.y)',
    '                 - chop * chop * dDxz_dz.x * dDxz_dx.y;',
    //Crest's saturate(_WaveFoamCoverage - det) but using our Jacobian
    //convention where flat water is J=1. foamCoverage is the threshold
    //below which foam fires. Squared so mild folds (flanks of a crest)
    //contribute geometrically less than steep folds (the peak itself) —
    //e.g. a 0.05 fold → 0.0025, a 0.30 fold → 0.09 (36× harder firing).
    //This narrows the fire zone to the crest peak instead of painting
    //foam across the whole "almost-folded" flank region. Tried cubed once
    //(216× sharpness) — read as too sparse, the squared shape is the keeper.
    '  float rawGen  = clamp(foamCoverage - jacobian, 0.0, 1.0);',
    '  float foamGen = rawGen * rawGen;',
    //Wind-advected previous foam read. Surface drift is a small fraction
    //of wind speed (~3-5% for wind-driven seas, Stokes drift + air-water
    //coupling). advectionScale is exposed so the user can tune.
    '  vec2 prevWorldXZ = worldXZ - deltaTime * windVelocity * advectionScale;',
    '  vec2 prevUV = prevWorldXZ / foamTileSize;',
    '  float foam = texture2D(prevFoamTexture, prevUV).r;',
    //Frame-rate-independent decay (Crest UpdateFoam.compute:76).
    '  foam *= max(0.0, 1.0 - foamFadeRate * deltaTime);',
    //Broadband-Jacobian foam accumulation. 5.0 matches Crest\'s hard-coded
    //multiplier on the saturate() term in UpdateFoam.compute:102.
    '  foam += 5.0 * deltaTime * foamStrength * foamGen;',
    '  gl_FragColor = vec4(clamp(foam, 0.0, 1.0), 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  this._broadbandPackMaterial = new THREE.ShaderMaterial({
    uniforms: {
      cascadeDispC2: {type: 't', value: null},
      cascadeDispC3: {type: 't', value: null},
      cascadeDispC4: {type: 't', value: null},
      //MUST match the cascadeSpatialOffsets defined in
      //water-shader-template.txt:19-26 (and the matching definitions in
      //horizon-skirt-template.txt / ocean-shadow.js). The water shader
      //samples cascade2Disp at (worldXZ + offset)/patchSize; if the
      //broadband foam pack uses a different offset, foam fires at the
      //unshifted alignment while visible waves are at the shifted one →
      //foam appears in spots uncorrelated with visible crests.
      cascadeOffsetC2: {type: 'v2', value: new THREE.Vector2(218.6, 60.4)},
      cascadeOffsetC3: {type: 'v2', value: new THREE.Vector2( 30.2, 54.7)},
      cascadeOffsetC4: {type: 'v2', value: new THREE.Vector2(  1.44, 7.55)},
      cascadeSizeC2: {type: 'f', value: this._cascadePatchSizes[2]},
      cascadeSizeC3: {type: 'f', value: this._cascadePatchSizes[3]},
      cascadeSizeC4: {type: 'f', value: this._cascadePatchSizes[4]},
      prevFoamTexture: {type: 't', value: null},
      resolution: {type: 'v2', value: new THREE.Vector2(this.broadbandFoamResolution, this.broadbandFoamResolution)},
      foamTileSize: {type: 'f', value: this.broadbandFoamTileSize},
      //World-XZ surface drift velocity. Updated per-frame from
      //ocean-grid.js with the configured wind vector scaled by advectionScale.
      windVelocity: {type: 'v2', value: new THREE.Vector2(0, 0)},
      //Fraction of wind speed used as surface drift. 0.03-0.05 is a
      //reasonable physical range; bump up to ~0.1 if foam should visibly
      //chase the wave crests downwind.
      advectionScale: {type: 'f', value: 0.04},
      deltaTime: {type: 'f', value: 1.0 / 60.0},
      //Per-second decay. Lower than Crest's 0.8 (~1.25 s e-fold) because
      //our broadband Jacobian fires less frequently than Crest's per-LOD
      //(we sum only C2+C3+C4 vs Crest's accumulated-below-LOD tex). At 0.3
      //e-folding time is ~3.3 s so each foam patch has time to register
      //visually before dissipating, even with sparse firing events.
      foamFadeRate: {type: 'f', value: 0.3},
      //Crest _WaveFoamCoverage equivalent. Foam fires when broadband
      //Jacobian < foamCoverage. Crest defaults to 0.55. 0.85 was too
      //generous (lit up most of the surface), 0.72 caught only the
      //hardest breakers. 0.80 catches more mid-strength crests — every
      //visible peak gets at least a foam streak — without the over-foam
      //blanket that 0.85 produced.
      foamCoverage: {type: 'f', value: 0.80},
      //Crest _WaveFoamStrength equivalent. Multiplier on per-frame add.
      //Back to Crest's 1.0 — pushing both coverage and strength at once
      //was double-counting brightness. With foamFadeRate=0.3 and the
      //widened coverage, this gives steady-state foam ~0.5-1.0 at firing
      //pixels which is the right working range for the smoothstep mix.
      foamStrength: {type: 'f', value: 1.0},
      chop: {type: 'f', value: data.chop || 1.0},
      waveHeightMultiplier: {type: 'f', value: data.wave_scale_multiple || 1.5}
    },
    vertexShader: packVertShader,
    fragmentShader: broadbandPackFragShader,
    depthTest: false,
    depthWrite: false
  });
  this._broadbandPackScene = new THREE.Scene();
  this._broadbandPackScene.add(new THREE.Mesh(cascadeQuadGeo, this._broadbandPackMaterial));

  //Single-channel foam RT (RGBA float, foam in .r). REPEAT wrap so the
  //water shader can sample at any world position via worldXZ/foamTileSize.
  //No mipmaps — foam is sampled at a coarse, broadband scale where mip
  //averaging would erase the per-crest highlight pattern.
  const broadbandFoamRTOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false
  };
  this.broadbandFoamTargetA = new THREE.WebGLRenderTarget(this.broadbandFoamResolution, this.broadbandFoamResolution, broadbandFoamRTOptions);
  this.broadbandFoamTargetB = new THREE.WebGLRenderTarget(this.broadbandFoamResolution, this.broadbandFoamResolution, broadbandFoamRTOptions);
  this._broadbandFoamPingPong = 0;
  this.broadbandFoamTexture = this.broadbandFoamTargetA.texture;
  //Zero-clear both ping-pong sets — see same note in the per-cascade
  //section above. Uninitialized FloatType reads can return NaN.
  this.renderer.setClearColor(0x000000, 0.0);
  this.renderer.setRenderTarget(this.broadbandFoamTargetA);
  this.renderer.clear(true, false, false);
  this.renderer.setRenderTarget(this.broadbandFoamTargetB);
  this.renderer.clear(true, false, false);
  this.renderer.setClearColor(prevClearColor, prevClearAlpha);
  this.renderer.setRenderTarget(prevRenderTarget);

  this._lastTickTimeMs = -1;

  let self = this;
  this.tick = function(){
    //Determine which set to write to and which to read previous foam from
    const writeTargets = self._foamPingPong === 0 ? self.cascadeDisplacementTargetsA : self.cascadeDisplacementTargetsB;
    const readTargets = self._foamPingPong === 0 ? self.cascadeDisplacementTargetsB : self.cascadeDisplacementTargetsA;

    //Pack per-cascade xyz displacements + foam into individual RGBA render targets.
    for(let c = 0; c < self.numCascades; c++){
      self._packMaterial.uniforms.xTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][0];
      self._packMaterial.uniforms.yTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][1];
      self._packMaterial.uniforms.zTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][2];
      self._packMaterial.uniforms.prevFoamTexture.value = readTargets[c].texture;
      self._packMaterial.uniforms.patchSize.value = self._cascadePatchSizes[c];
      self.renderer.setRenderTarget(writeTargets[c]);
      self.renderer.render(self._packScene, self._cascadeCamera);
    }

    //Update the texture references that the ocean material reads
    for(let c = 0; c < self.numCascades; c++){
      self.cascadeDisplacementTextures[c] = writeTargets[c].texture;
    }

    //Flip ping-pong for next frame
    self._foamPingPong = 1 - self._foamPingPong;

    // ===== Broadband foam pass =====
    // Runs AFTER the per-cascade loop so the cascade displacement textures
    // it samples (C2/C3/C4) hold this frame's displacement, not last frame's.
    const nowMs = performance.now();
    //Cap dt at 100 ms so a tab-switch / browser-pause doesn't wipe the
    //foam (decay multiplier would go negative) or warp prev-foam reads
    //to nonsense world positions via the advection term.
    const dt = self._lastTickTimeMs < 0 ? (1.0 / 60.0) : Math.min(0.1, (nowMs - self._lastTickTimeMs) / 1000.0);
    self._lastTickTimeMs = nowMs;
    const bbWrite = self._broadbandFoamPingPong === 0 ? self.broadbandFoamTargetA : self.broadbandFoamTargetB;
    const bbRead  = self._broadbandFoamPingPong === 0 ? self.broadbandFoamTargetB : self.broadbandFoamTargetA;
    const bbU = self._broadbandPackMaterial.uniforms;
    bbU.cascadeDispC2.value = self.cascadeDisplacementTextures[2];
    bbU.cascadeDispC3.value = self.cascadeDisplacementTextures[3];
    bbU.cascadeDispC4.value = self.cascadeDisplacementTextures[4];
    bbU.prevFoamTexture.value = bbRead.texture;
    bbU.deltaTime.value = dt;
    //waveHeightMultiplier is mutable from JS at runtime (live wind/scale
    //changes), so re-push every frame in case it changed.
    bbU.waveHeightMultiplier.value = self.waveHeightMultiplier;
    self.renderer.setRenderTarget(bbWrite);
    self.renderer.render(self._broadbandPackScene, self._cascadeCamera);
    self.broadbandFoamTexture = bbWrite.texture;
    self._broadbandFoamPingPong = 1 - self._broadbandFoamPingPong;

    self.renderer.setRenderTarget(null);
  };
}
