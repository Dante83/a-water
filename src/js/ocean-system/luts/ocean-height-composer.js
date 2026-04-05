AWater.AOcean.LUTlibraries.OceanHeightComposer = function(parentOceanGrid){
  let data = parentOceanGrid.data;
  this.renderer = parentOceanGrid.renderer;
  this.baseTextureWidth = data.patch_data_size;
  this.baseTextureHeight = data.patch_data_size;
  this.N = data.number_of_octaves;
  this.OceanMaterialHeightBandLibrary = parentOceanGrid.oceanHeightBandLibrary;
  this.numCascades = this.OceanMaterialHeightBandLibrary.numCascades;

  // ===== Per-cascade displacement packer =====
  // Packs each cascade's x/y/z FFT outputs into a single RGB texture.
  // These are sampled in the vertex/fragment shaders at worldXZ/cascadePatchSize[c]
  // for seamless tiling across tile boundaries (no fract wrapping per-tile).
  const packVertShader = [
    'void main(){',
    '  gl_Position = vec4(position, 1.0);',
    '}'
  ].join('\n');
  const packFragShader = [
    'uniform sampler2D xTexture;',
    'uniform sampler2D yTexture;',
    'uniform sampler2D zTexture;',
    'uniform vec2 resolution;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / resolution.xy;',
    '  gl_FragColor = vec4(',
    '    texture2D(xTexture, uv).x,',
    '    texture2D(yTexture, uv).x,',
    '    texture2D(zTexture, uv).x,',
    '    1.0',
    '  );',
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

  const cascadeRTOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false
  };
  this.cascadeDisplacementTargets = [];
  this.cascadeDisplacementTextures = [];
  for(let c = 0; c < this.numCascades; c++){
    const rt = new THREE.WebGLRenderTarget(this.baseTextureWidth, this.baseTextureHeight, cascadeRTOptions);
    rt.texture.wrapS = THREE.RepeatWrapping;
    rt.texture.wrapT = THREE.RepeatWrapping;
    this.cascadeDisplacementTargets.push(rt);
    this.cascadeDisplacementTextures.push(rt.texture);
  }

  let self = this;
  this.tick = function(){
    //Pack per-cascade xyz displacements into individual RGB render targets.
    //The vertex/fragment shaders sample these directly at worldXZ/cascadePatchSize[c].
    for(let c = 0; c < self.numCascades; c++){
      self._packMaterial.uniforms.xTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][0];
      self._packMaterial.uniforms.yTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][1];
      self._packMaterial.uniforms.zTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][2];
      self.renderer.setRenderTarget(self.cascadeDisplacementTargets[c]);
      self.renderer.render(self._packScene, self._cascadeCamera);
    }
    self.renderer.setRenderTarget(null);
  };
}
