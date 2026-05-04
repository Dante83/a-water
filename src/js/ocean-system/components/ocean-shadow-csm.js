//Ocean-only cascaded shadow map — EVSM (Exponential Variance Shadow Map).
//
//Motivation: Three.js's main sun shadow map has to cover the entire scene
//(trees, lighthouse, rocks) and therefore its frustum is too large to
//resolve individual wave crests. This component renders a dedicated pass
//of just the ocean InstancedMeshes into N tight, sun-aligned orthographic
//frusta — giving per-wave self-shadow that a scene-wide shadow map could
//never capture.
//
//Why EVSM (vs regular depth + PCF, which we used to do): per-triangle
//z-acne on smooth meshes is structural to depth-comparison shadow maps.
//Caster and receiver are the SAME mesh, so adjacent triangles produce
//slightly different sc.z values that flip the binary depth comparison
//even with calibrated bias. EVSM stores 4 warped depth moments instead
//of a single depth, then evaluates Chebyshev's inequality to derive a
//probabilistic shadow bound — small per-triangle depth jitter becomes a
//smooth gradient rather than a binary flip. The negative-warp pair (the
//"E" in EVSM) eliminates most of plain-VSM light bleed.
//
//Pipeline per cascade per frame:
//  1. Caster pass: render ocean meshes into RGBA32F color target. The
//     caster fragment writes (exp(c·z), exp(2c·z), -exp(-c·z), exp(-2c·z)).
//  2. Horizontal Gaussian blur into a shared ping-pong buffer.
//  3. Vertical Gaussian blur back into the moment target.
//Linear-filterable float textures + the Gaussian blur are what give EVSM
//its smoothness — without them, per-texel variance is near-zero and the
//Chebyshev bound degenerates to a depth comparison.
//
//Four cascades by default (Plan E):
//  C0   60 m  × 2048² → ~2.9 cm/texel  (sharp wave-on-wave near camera)
//  C1  240 m  × 2048² → ~11.7 cm/texel (mid distance)
//  C2 0.4 × drawDistance × 4096²       (broad chop / mid-far)
//  C3  2  × drawDistance × 4096²       (full draw-distance horizon coverage)
//C0/C1 stay fixed because wave-scale near you is a property of the
//simulation, not the world. C2/C3 scale with drawDistance so a smaller
//world automatically gets tighter horizon shadows.
//
//Memory: 4 × moment-target (RGBA32F) = 64+64+256+256 = 640 MB. Plus two
//shared ping-pong buffers (one 2048², one 4096²) = 64+256 = 320 MB.
//Total ~960 MB. The user explicitly opted in (1070-class GPU target).
//
//Caster ring filtering: each cascade has a maxRing index. The mesh's
//ringIndex (the clipmap LOD it was built with) determines which cascades
//it can cast into — close, fine ring 0 belongs to all four cascades but
//ring 2's huge 1km tile only contributes meaningfully to C3. Each cascade
//owns a layer (7..10). At addCaster time we enable the cascade's layer
//on the mesh iff the mesh's ring is small enough to qualify; the light
//camera per-cascade renders only its own layer.

AWater.AOcean.OceanShadowCSM = function(oceanGrid, scene, configOverrides){
  this.oceanGrid = oceanGrid;
  this.scene = scene;

  //EVSM warp constant. Larger reduces light bleed but compresses depth
  //precision at extremes. ~5 is a good float32 balance for ocean depth
  //slabs up to 10 km. Receiver's evsmExpC uniform MUST match this.
  this._evsmExpC = 5.0;

  //Cascade parameters. extent sets the ortho frustum's lateral size;
  //mapSize sets moment-texture resolution. layer is the THREE.Layers bit
  //used to gate which meshes render into this cascade. maxRing is the
  //highest oceanGrid ring index that gets registered as a caster.
  //
  //cascadeDepth (the sun-direction depth slab) and lightDistance are
  //DERIVED from extent in render(), not stored on the config — at low
  //sun elevations a fragment at +halfExtent on the sea plane projects to
  //a view-z offset close to halfExtent itself, so the depth window must
  //scale with extent or large cascades silently fail their z-range check.
  const drawDistance = oceanGrid.drawDistance;
  const cfg = configOverrides || {};
  this.cascadeConfigs = cfg.cascades || [
    {extent: 60.0,                 mapSize: 2048, layer: 7,  maxRing: 0},
    {extent: 240.0,                mapSize: 2048, layer: 8,  maxRing: 1},
    {extent: 0.4 * drawDistance,   mapSize: 4096, layer: 9,  maxRing: 99},
    {extent: 2.0 * drawDistance,   mapSize: 4096, layer: 10, maxRing: 99}
  ];
  this.numCascades = this.cascadeConfigs.length;
  this._waveMargin = 50.0;

  this._shadowMatDef = AWater.AOcean.Materials.Ocean.oceanShadowMaterial;

  //Build per-cascade resources: RGBA32F color target with depth renderbuffer
  //(depth used for caster z-test, never read back), linear filtering enabled
  //so the EVSM Chebyshev bound benefits from hardware bilinear interp.
  this.cascades = [];
  for(let i = 0; i < this.numCascades; i++){
    const c = this.cascadeConfigs[i];
    const renderTarget = new THREE.WebGLRenderTarget(c.mapSize, c.mapSize, {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false
    });
    const lightCamera = new THREE.OrthographicCamera(
      -c.extent * 0.5, c.extent * 0.5,
       c.extent * 0.5, -c.extent * 0.5,
      1.0, 1000.0
    );
    lightCamera.matrixAutoUpdate = false;

    this.cascades.push({
      cfg: c,
      renderTarget: renderTarget,
      lightCamera: lightCamera,
      shadowMatrix: new THREE.Matrix4(),
      depthRange: 0.0
    });
  }

  //Two shared blur ping-pong buffers, sized to the two cascade size classes
  //we use (2048² and 4096²). Sharing avoids allocating a full ping-pong per
  //cascade — at RGBA32F that would double total memory. We never blur two
  //cascades at the same time, so one buffer per size class is sufficient.
  const blurOptions = {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false
  };
  this._blurTargetSmall = new THREE.WebGLRenderTarget(2048, 2048, blurOptions);
  this._blurTargetLarge = new THREE.WebGLRenderTarget(4096, 4096, blurOptions);

  //Inline EVSM Gaussian blur material. Separable 9-tap; weights from a
  //pixel-sigma-1.5 Gaussian normalised to sum=1. Defined here rather than
  //via the shader-build pipeline because it is used only by this component
  //and is small enough to keep in one place.
  this._blurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      sourceTexture: {value: null},
      blurDirection: {value: new THREE.Vector2(0.0, 0.0)}
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){',
      '  vUv = position.xy * 0.5 + 0.5;',
      '  gl_Position = vec4(position.xy, 0.0, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D sourceTexture;',
      'uniform vec2 blurDirection;',
      'varying vec2 vUv;',
      'const float W0 = 0.227027;',
      'const float W1 = 0.194595;',
      'const float W2 = 0.121622;',
      'const float W3 = 0.054054;',
      'const float W4 = 0.016216;',
      'void main(){',
      '  vec4 result = texture2D(sourceTexture, vUv) * W0;',
      '  result += texture2D(sourceTexture, vUv + blurDirection * 1.0) * W1;',
      '  result += texture2D(sourceTexture, vUv - blurDirection * 1.0) * W1;',
      '  result += texture2D(sourceTexture, vUv + blurDirection * 2.0) * W2;',
      '  result += texture2D(sourceTexture, vUv - blurDirection * 2.0) * W2;',
      '  result += texture2D(sourceTexture, vUv + blurDirection * 3.0) * W3;',
      '  result += texture2D(sourceTexture, vUv - blurDirection * 3.0) * W3;',
      '  result += texture2D(sourceTexture, vUv + blurDirection * 4.0) * W4;',
      '  result += texture2D(sourceTexture, vUv - blurDirection * 4.0) * W4;',
      '  gl_FragColor = result;',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });
  this._blurScene = new THREE.Scene();
  this._blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._blurMaterial);
  this._blurScene.add(this._blurQuad);

  //Static bias/shadow matrix constant — converts light clip space [-1,1]
  //into texture UV space [0,1] + depth [0,1].
  this._texSpaceMatrix = new THREE.Matrix4().set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  this._cameraWorldPos = new THREE.Vector3();
  this._lightForward = new THREE.Vector3();
  this._lightRight = new THREE.Vector3();
  this._lightUp = new THREE.Vector3();
  this._worldUp = new THREE.Vector3(0.0, 1.0, 0.0);
  this._unsnappedPivot = new THREE.Vector3();
  this._snappedPivot = new THREE.Vector3();

  //Cached "no occluder" clear color: moments for depth=1.0 (far plane).
  //Receiver Chebyshev with these reads as fully lit for any refZ < 1.0.
  //Recomputed when evsmExpC changes via setEvsmExpC().
  this._evsmClearColor = new THREE.Color();
  this._evsmClearAlpha = 0.0;
  this._recomputeEvsmClear();

  this.oceanMeshes = [];
  this.shadowMaterials = [];
  this.casterRingIndices = [];
};

AWater.AOcean.OceanShadowCSM.prototype._recomputeEvsmClear = function(){
  const c = this._evsmExpC;
  const pos = Math.exp(c);
  const neg = -Math.exp(-c);
  this._evsmClearColor.setRGB(pos, pos * pos, neg);
  this._evsmClearAlpha = neg * neg;
};

//Live-tune the EVSM warp constant. Pushes to all caster materials and
//updates the cached clear color. Receiver's evsmExpC must be updated
//separately via ocean-grid's console hook.
AWater.AOcean.OceanShadowCSM.prototype.setEvsmExpC = function(c){
  this._evsmExpC = +c;
  this._recomputeEvsmClear();
  for(let i = 0, L = this.shadowMaterials.length; i < L; i++){
    this.shadowMaterials[i].uniforms.evsmExpC.value = this._evsmExpC;
  }
};

//Register an ocean InstancedMesh as a caster. Called from ocean-grid each
//time a clipmap tile gets instantiated. ringIndex determines cascade
//membership: each cascade has a maxRing, and the mesh joins cascade c
//only if ringIndex <= c.maxRing. Layer membership is set ONCE here.
AWater.AOcean.OceanShadowCSM.prototype.addCaster = function(mesh, ringIndex){
  if(this.oceanMeshes.indexOf(mesh) !== -1) return;
  const shadowMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(this._shadowMatDef.uniforms),
    vertexShader: this._shadowMatDef.vertexShader,
    fragmentShader: this._shadowMatDef.fragmentShader,
    side: THREE.DoubleSide
  });
  shadowMat.uniforms.ringIndex.value = ringIndex;
  shadowMat.uniforms.evsmExpC.value = this._evsmExpC;
  this.oceanMeshes.push(mesh);
  this.shadowMaterials.push(shadowMat);
  this.casterRingIndices.push(ringIndex);

  for(let i = 0; i < this.numCascades; i++){
    if(ringIndex <= this.cascadeConfigs[i].maxRing){
      mesh.layers.enable(this.cascadeConfigs[i].layer);
    }
  }
};

//Per-frame: for each cascade, fit camera, render moments, blur. Materials
//are swapped to the shadow ShaderMaterial once at the start and restored
//once at the end — all four cascades render under the same swap.
AWater.AOcean.OceanShadowCSM.prototype.render = function(renderer, mainCamera, sunDirection, sharedOceanUniforms){
  if(this.oceanMeshes.length === 0) return;
  if(-sunDirection.y <= 0.0) return;

  mainCamera.getWorldPosition(this._cameraWorldPos);

  for(let i = 0, L = this.shadowMaterials.length; i < L; i++){
    const u = this.shadowMaterials[i].uniforms;
    u.cascadeDisplacementTextures.value = sharedOceanUniforms.cascadeDisplacementTextures.value;
    u.cascadePatchSizes.value = sharedOceanUniforms.cascadePatchSizes.value;
    u.cascadeSpatialOffsets.value = sharedOceanUniforms.cascadeSpatialOffsets.value;
    u.waveHeightMultiplier.value = sharedOceanUniforms.waveHeightMultiplier.value;
    u.sizeOfOceanPatch.value = sharedOceanUniforms.sizeOfOceanPatch.value;
    u.chop.value = sharedOceanUniforms.chop.value;
    u.mainCameraPosition.value.copy(this._cameraWorldPos);
  }

  const pivotX = this._cameraWorldPos.x;
  const pivotY = this.oceanGrid.heightOffset;
  const pivotZ = this._cameraWorldPos.z;

  this._lightForward.copy(sunDirection);
  this._lightRight.crossVectors(this._worldUp, this._lightForward);
  if(this._lightRight.lengthSq() < 1e-6){
    this._lightRight.set(1.0, 0.0, 0.0);
  } else {
    this._lightRight.normalize();
  }
  this._lightUp.crossVectors(this._lightForward, this._lightRight).normalize();
  this._unsnappedPivot.set(pivotX, pivotY, pivotZ);
  const pivotForward = this._unsnappedPivot.dot(this._lightForward);
  const unsnappedRight = this._unsnappedPivot.dot(this._lightRight);
  const unsnappedUp    = this._unsnappedPivot.dot(this._lightUp);

  const prevMaterials = [];
  for(let i = 0, L = this.oceanMeshes.length; i < L; i++){
    prevMaterials.push(this.oceanMeshes[i].material);
    this.oceanMeshes[i].material = this.shadowMaterials[i];
  }

  const prevTarget = renderer.getRenderTarget();
  const prevClearColor = new THREE.Color();
  renderer.getClearColor(prevClearColor);
  const prevClearAlpha = renderer.getClearAlpha();
  const prevShadowAutoUpdate = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;

  for(let i = 0; i < this.numCascades; i++){
    const cascade = this.cascades[i];
    const cfg = cascade.cfg;
    const lightCamera = cascade.lightCamera;

    const halfExtent = cfg.extent * 0.5;
    const halfDepth = halfExtent + this._waveMargin;
    const lightDistance = halfDepth + 100.0;
    cascade.depthRange = halfDepth * 2.0;

    const texelSize = cfg.extent / cfg.mapSize;
    const snappedRight = Math.round(unsnappedRight / texelSize) * texelSize;
    const snappedUp    = Math.round(unsnappedUp    / texelSize) * texelSize;
    this._snappedPivot.set(0.0, 0.0, 0.0)
      .addScaledVector(this._lightRight,   snappedRight)
      .addScaledVector(this._lightUp,      snappedUp)
      .addScaledVector(this._lightForward, pivotForward);
    const snappedPivotX = this._snappedPivot.x;
    const snappedPivotY = this._snappedPivot.y;
    const snappedPivotZ = this._snappedPivot.z;

    lightCamera.position.set(
      snappedPivotX - sunDirection.x * lightDistance,
      snappedPivotY - sunDirection.y * lightDistance,
      snappedPivotZ - sunDirection.z * lightDistance
    );
    lightCamera.updateMatrix();
    lightCamera.updateMatrixWorld(true);
    lightCamera.lookAt(snappedPivotX, snappedPivotY, snappedPivotZ);
    lightCamera.updateMatrix();
    lightCamera.updateMatrixWorld(true);
    lightCamera.near = lightDistance - halfDepth;
    lightCamera.far  = lightDistance + halfDepth;
    lightCamera.updateProjectionMatrix();
    lightCamera.matrixWorldInverse.copy(lightCamera.matrixWorld).invert();

    cascade.shadowMatrix.identity();
    cascade.shadowMatrix.multiply(this._texSpaceMatrix);
    cascade.shadowMatrix.multiply(lightCamera.projectionMatrix);
    cascade.shadowMatrix.multiply(lightCamera.matrixWorldInverse);

    lightCamera.layers.set(cfg.layer);

    //Caster pass — render into the moment color target. Clear values are
    //the EVSM moments for depth=1.0 (far plane / no occluder), so any
    //texel not covered by a caster reads as "fully lit" through the
    //Chebyshev evaluation in the receiver. clearColor is unclamped on
    //float color buffers (WebGL2 spec), so the large positive R/G values
    //(~148, ~22000) pass through unchanged.
    renderer.setRenderTarget(cascade.renderTarget);
    renderer.setClearColor(this._evsmClearColor, this._evsmClearAlpha);
    renderer.clear(true, true, false);
    renderer.render(this.scene, lightCamera);

    //Separable Gaussian blur of the moment texture. Without this, per-texel
    //variance is near zero (typically 1-2 caster triangle samples per
    //texel) and the EVSM Chebyshev bound degenerates back to a hard depth
    //comparison — exactly the artifact we replaced. The blur is what makes
    //the variance term meaningful.
    const blurTarget = (cfg.mapSize <= 2048) ? this._blurTargetSmall : this._blurTargetLarge;
    const texelUv = 1.0 / cfg.mapSize;

    this._blurMaterial.uniforms.sourceTexture.value = cascade.renderTarget.texture;
    this._blurMaterial.uniforms.blurDirection.value.set(texelUv, 0.0);
    renderer.setRenderTarget(blurTarget);
    renderer.render(this._blurScene, this._blurCamera);

    this._blurMaterial.uniforms.sourceTexture.value = blurTarget.texture;
    this._blurMaterial.uniforms.blurDirection.value.set(0.0, texelUv);
    renderer.setRenderTarget(cascade.renderTarget);
    renderer.render(this._blurScene, this._blurCamera);
  }

  renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClearColor, prevClearAlpha);

  for(let i = 0, L = this.oceanMeshes.length; i < L; i++){
    this.oceanMeshes[i].material = prevMaterials[i];
  }
};

if(typeof exports !== 'undefined'){
  module.exports = AWater.AOcean.OceanShadowCSM;
}
