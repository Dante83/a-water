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
    'uniform float foamDecayRate;',
    'uniform float foamAdd;',
    'uniform float foamThreshold;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / resolution.xy;',
    '  float eps = 1.0 / resolution.x;',
    '  float dx = texture2D(xTexture, uv).x;',
    '  float dy = texture2D(yTexture, uv).x;',
    '  float dz = texture2D(zTexture, uv).x;',
    //Central differences on XZ displacement for Jacobian
    '  float dxR = texture2D(xTexture, uv + vec2(eps, 0.0)).x;',
    '  float dxL = texture2D(xTexture, uv + vec2(-eps, 0.0)).x;',
    '  float dxT = texture2D(xTexture, uv + vec2(0.0, eps)).x;',
    '  float dxB = texture2D(xTexture, uv + vec2(0.0, -eps)).x;',
    '  float dzR = texture2D(zTexture, uv + vec2(eps, 0.0)).x;',
    '  float dzL = texture2D(zTexture, uv + vec2(-eps, 0.0)).x;',
    '  float dzT = texture2D(zTexture, uv + vec2(0.0, eps)).x;',
    '  float dzB = texture2D(zTexture, uv + vec2(0.0, -eps)).x;',
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
    //Read previous frame foam, apply exponential decay
    '  float prevFoam = texture2D(prevFoamTexture, uv).a;',
    '  float foam = prevFoam * exp(-foamDecayRate);',
    '  foam = clamp(foam, 0.0, 1.0);',
    //Accumulate where Jacobian indicates breaking (negative = folded surface)
    '  float biasedJacobian = max(0.0, -(jacobian - foamBias));',
    '  if(biasedJacobian > foamThreshold){',
    '    foam += foamAdd * biasedJacobian;',
    '  }',
    '  gl_FragColor = vec4(dx, dy, dz, foam);',
    '}'
  ].join('\n');

  //Slope pack shader — reads packed butterfly IFFT output (R=dh/dx, G=dh/dz) into stable RT
  const slopePackFragShader = [
    'uniform sampler2D slopeTexture;',
    'uniform vec2 resolution;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / resolution.xy;',
    '  vec2 slopes = texture2D(slopeTexture, uv).rg;',
    '  gl_FragColor = vec4(slopes.r, slopes.g, 0.0, 1.0);',
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
      foamBias: {type: 'f', value: 0.6},
      foamDecayRate: {type: 'f', value: 0.03},
      foamAdd: {type: 'f', value: 0.6},
      foamThreshold: {type: 'f', value: 0.0}
    },
    vertexShader: packVertShader,
    fragmentShader: packFragShader,
    depthTest: false,
    depthWrite: false
  });
  this._packScene = new THREE.Scene();
  this._packScene.add(new THREE.Mesh(cascadeQuadGeo, this._packMaterial));

  this._slopePackMaterial = new THREE.ShaderMaterial({
    uniforms: {
      slopeTexture: {type: 't', value: null},
      resolution: {type: 'v2', value: new THREE.Vector2(this.baseTextureWidth, this.baseTextureHeight)}
    },
    vertexShader: packVertShader,
    fragmentShader: slopePackFragShader,
    depthTest: false,
    depthWrite: false
  });
  this._slopePackScene = new THREE.Scene();
  this._slopePackScene.add(new THREE.Mesh(cascadeQuadGeo.clone(), this._slopePackMaterial));

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

  //Ping-pong displacement+foam targets per cascade.
  //We write to one and read the previous frame's foam from the other.
  this.cascadeDisplacementTargetsA = [];
  this.cascadeDisplacementTargetsB = [];
  this.cascadeDisplacementTextures = [];
  this._foamPingPong = 0; //0 = write A read B, 1 = write B read A
  for(let c = 0; c < this.numCascades; c++){
    const rtA = new THREE.WebGLRenderTarget(this.baseTextureWidth, this.baseTextureHeight, cascadeRTOptions);
    rtA.texture.wrapS = THREE.RepeatWrapping;
    rtA.texture.wrapT = THREE.RepeatWrapping;
    const rtB = new THREE.WebGLRenderTarget(this.baseTextureWidth, this.baseTextureHeight, cascadeRTOptions);
    rtB.texture.wrapS = THREE.RepeatWrapping;
    rtB.texture.wrapT = THREE.RepeatWrapping;
    this.cascadeDisplacementTargetsA.push(rtA);
    this.cascadeDisplacementTargetsB.push(rtB);
    this.cascadeDisplacementTextures.push(rtA.texture);
  }

  //Stable slope output RTs — one per cascade, RG = (dh/dx, dh/dz)
  this.cascadeSlopeTargets = [];
  this.cascadeSlopeTextures = [];
  for(let c = 0; c < this.numCascades; c++){
    const rt = new THREE.WebGLRenderTarget(this.baseTextureWidth, this.baseTextureHeight, cascadeRTOptions);
    rt.texture.wrapS = THREE.RepeatWrapping;
    rt.texture.wrapT = THREE.RepeatWrapping;
    this.cascadeSlopeTargets.push(rt);
    this.cascadeSlopeTextures.push(rt.texture);
  }

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

    //Blit slope FFT results into stable slope RTs (R=dh/dx, G=dh/dz).
    for(let c = 0; c < self.numCascades; c++){
      self._slopePackMaterial.uniforms.slopeTexture.value = self.OceanMaterialHeightBandLibrary.slopesPerCascade[c];
      self.renderer.setRenderTarget(self.cascadeSlopeTargets[c]);
      self.renderer.render(self._slopePackScene, self._cascadeCamera);
    }

    self.renderer.setRenderTarget(null);
  };
}
