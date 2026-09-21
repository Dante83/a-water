ARestlessOcean.LUTlibraries.OceanHeightComposer = function(parentOceanGrid){
  let data = parentOceanGrid.data;
  this.renderer = parentOceanGrid.renderer;
  this.baseTextureWidth = data.patch_data_size;
  this.baseTextureHeight = data.patch_data_size;
  this.N = data.number_of_octaves;
  this.OceanMaterialHeightBandLibrary = parentOceanGrid.oceanHeightBandLibrary;
  this.numCascades = this.OceanMaterialHeightBandLibrary.numCascades;

  // ===== Per-cascade displacement packer =====
  // Packs each cascade's x/y/z FFT outputs into the RGB of its displacement RT
  // (alpha unused). Undoes the IFFT half-texel checkerboard shift.
  const packVertShader = [
    'void main(){',
    '  gl_Position = vec4(position, 1.0);',
    '}'
  ].join('\n');

  //Displacement pack shader: sample the three FFT output textures, undo the
  //IFFT half-texel shift, write xyz to RGB (alpha unused).
  const packFragShader = [
    'uniform sampler2D xTexture;',
    'uniform sampler2D yTexture;',
    'uniform sampler2D zTexture;',
    'uniform vec2 resolution;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / resolution.xy;',
    //h_0 and h_k pack the spectrum with DC centered at (N/2, N/2). The IFFT
    //produces a result shifted by N/2 in both axes; undo it with the standard
    //checkerboard (-1)^(x+y) sign flip applied per IFFT output texel.
    '  vec2 texCoord = floor(uv * resolution);',
    '  float ifftSign = mod(texCoord.x + texCoord.y, 2.0) < 0.5 ? 1.0 : -1.0;',
    '  float dx = texture2D(xTexture, uv).x * ifftSign;',
    '  float dy = texture2D(yTexture, uv).x * ifftSign;',
    '  float dz = texture2D(zTexture, uv).x * ifftSign;',
    '  gl_FragColor = vec4(dx, dy, dz, 1.0);',
    '}'
  ].join('\n');

  const cascadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const cascadeQuadGeo = new THREE.PlaneGeometry(2, 2);
  this._packMaterial = new THREE.ShaderMaterial({
    uniforms: {
      xTexture: {type: 't', value: null},
      yTexture: {type: 't', value: null},
      zTexture: {type: 't', value: null},
      resolution: {type: 'v2', value: new THREE.Vector2(this.baseTextureWidth, this.baseTextureHeight)}
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
  //pulls back, which stabilises the per-fragment central-difference normals:
  //they sample a mip level matched to the screen-pixel footprint, killing the
  //high-freq shimmer that comes from sub-pixel cascade content.
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

  //ONE displacement target, with a layer per cascade (Phase 10). Every cascade
  //RT was already identical — same patch_data_size resolution, same RGBA32F,
  //same filters and wrapping; Crest-style banding varies the world-space patch
  //SIZE, not the texel count — so the six of them were a textbook texture-array
  //family. As six separate sampler2D uniforms they cost six of the water
  //program's texture units in BOTH the fragment and the vertex stage; as one
  //sampler2DArray they cost one each. See WATER-TYPES.md Phase 10.
  //
  //An array rather than an atlas specifically because of the two properties
  //above: cascades tile, so they need REPEAT wrapping, and they are mipmapped
  //to stabilise the central-difference normals at distance. Atlas sub-rects
  //give neither — they bleed at every mip level and need hand-rolled fract().
  //
  //The pack pass fully rewrites every texel each frame from the band library's
  //FFT output, so there's no history to keep — the ping-pong this used to need
  //died with the alpha-channel foam.
  this.cascadeDisplacementArray = ARestlessOcean.createArrayRenderTarget(
    this.baseTextureWidth, this.baseTextureHeight, this.numCascades, cascadeRTOptions);
  this.cascadeDisplacementTexture = this.cascadeDisplacementArray.texture;
  //The failure this guards is silent and looks like a shading bug: in three r173
  //WebGLArrayRenderTarget discards its options, and an unnoticed UnsignedByteType
  //would quantise metres of wave displacement to 8 bits. See
  //ARestlessOcean.createArrayRenderTarget.
  ARestlessOcean.assertArrayRenderTarget('cascadeDisplacement', this.cascadeDisplacementArray, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipMapLinearFilter,
    wrapS: THREE.RepeatWrapping,
    generateMipmaps: true
  });

  //Zero-clear at construction so any sample taken before the first tick() (or
  //a driver that returns NaN for uninitialized FloatType RTs) reads defined
  //data rather than garbage displacement.
  const prevRenderTarget = this.renderer.getRenderTarget();
  const prevClearColor = new THREE.Color();
  this.renderer.getClearColor(prevClearColor);
  const prevClearAlpha = this.renderer.getClearAlpha();
  this.renderer.setClearColor(0x000000, 0.0);
  for(let c = 0; c < this.numCascades; c++){
    //Second argument is the layer — three routes it to framebufferTextureLayer
    //for an array target.
    this.renderer.setRenderTarget(this.cascadeDisplacementArray, c);
    this.renderer.clear(true, false, false);
  }
  this.renderer.setClearColor(prevClearColor, prevClearAlpha);
  this.renderer.setRenderTarget(prevRenderTarget);

  let self = this;
  this.tick = function(){
    //Pack each cascade's xyz displacement into the RGB of one layer of the
    //displacement array. Single target per cascade (no ping-pong): the band
    //library regenerates the FFT output every frame, so the displacement is
    //always fully rewritten.
    //
    //MIPMAPS, AND WHY THE FLAG IS TOGGLED. three regenerates mipmaps at the end
    //of every render() into a target whose texture asks for them — and for an
    //array target that rebuilds the chain for EVERY layer, not just the one
    //just drawn. Left alone, six layer renders would do six full-array chain
    //builds a frame where the six separate targets did one each. So the flag is
    //held down until the last layer, which leaves exactly one chain build per
    //frame, covering every layer written this pass. This stays inside three's
    //own path (textureNeedsGenerateMipmaps is re-read per render) rather than
    //calling gl.generateMipmap behind three's state cache.
    const displacementTexture = self.cascadeDisplacementTexture;
    const lastCascade = self.numCascades - 1;
    for(let c = 0; c < self.numCascades; c++){
      self._packMaterial.uniforms.xTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][0];
      self._packMaterial.uniforms.yTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][1];
      self._packMaterial.uniforms.zTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][2];
      displacementTexture.generateMipmaps = (c === lastCascade);
      self.renderer.setRenderTarget(self.cascadeDisplacementArray, c);
      self.renderer.render(self._packScene, self._cascadeCamera);
    }

    self.renderer.setRenderTarget(null);
  };
}
