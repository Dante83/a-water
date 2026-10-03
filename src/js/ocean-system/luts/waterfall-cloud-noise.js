//── WaterfallCloudNoise ─────────────────────────────────────────────────────
//
//The two tileable 3D noises the waterfall's billowy clouds are eroded by (waterfall-cloud.glsl),
//baked on the GPU once, the first time a cloud is wanted, and shared by anyone who asks:
//  shape   128^3 RGBA8  r Perlin-Worley (the billowing masses), g/b/a Worley fBms at 8/16/32 cells
//  detail   32^3 RGBA8  r Worley fBm of fBms (edge erosion), g/b Worley fBms at 4/8 cells
//The recipe is A-Starry-Sky's cloud bake (CloudLUTLibrary.js, cloud-noise.glsl), ported rather than
//borrowed so the falls do not depend on the sky having its clouds switched on.
//
//THE BAKE is spread over frames: `slicesPerFrame` slices of the shape a tick (the detail in one go
//after), so the first fall that wants clouds does not hitch. `ready` turns true when both are done.
//
//⚠ three r173's WebGL3DRenderTarget replaces its texture with a fresh Data3DTexture and DROPS the
//options object (as WebGLArrayRenderTarget does: the texture-array conversion found that out), so
//every filter and wrap is set on the texture itself, before the first bind.
ARestlessOcean.WaterfallCloudNoise = ARestlessOcean.WaterfallCloudNoise || {
  SHAPE_SIZE: 128,
  DETAIL_SIZE: 32,
  slicesPerFrame: 16,
  ready: false,
  shape: null,     //THREE.Data3DTexture once ready (the render targets' textures)
  detail: null,
  _shapeTarget: null,
  _detailTarget: null,
  _material: null,
  _scene: null,
  _camera: null,
  _next: 0,
  bakeMs: 0
};

(function(N){
  const makeTarget = function(size){
    const target = new THREE.WebGL3DRenderTarget(size, size, size, {depthBuffer: false, stencilBuffer: false});
    const tex = target.texture;
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    return target;
  };

  const renderSlice = function(renderer, target, size, slice, mode){
    const u = N._material.uniforms;
    u.uNoiseMode.value = mode;
    u.uSize.value = size;
    u.uSlice.value = slice;
    target.viewport.set(0, 0, size, size);
    target.scissorTest = false;
    renderer.setRenderTarget(target, slice);
    renderer.render(N._scene, N._camera);
  };

  //Bake some more; call every frame until it returns true.
  N.step = function(renderer){
    if(N.ready) return true;
    const def = ARestlessOcean.Materials && ARestlessOcean.Materials.Ocean && ARestlessOcean.Materials.Ocean.waterfallCloudNoiseMaterial;
    if(!def || !renderer || !renderer.capabilities.isWebGL2) return false;
    const t0 = performance.now();
    if(!N._material){
      N._material = new THREE.ShaderMaterial({
        uniforms: ARestlessOcean.cloneUniforms ? ARestlessOcean.cloneUniforms(def.uniforms) : THREE.UniformsUtils.clone(def.uniforms),
        vertexShader: def.vertexShader,
        fragmentShader: def.fragmentShader,
        blending: THREE.NoBlending,
        depthTest: false,
        depthWrite: false
      });
      N._scene = new THREE.Scene();
      N._camera = new THREE.Camera();
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), N._material);
      quad.frustumCulled = false;
      N._scene.add(quad);
      N._shapeTarget = makeTarget(N.SHAPE_SIZE);
      N._detailTarget = makeTarget(N.DETAIL_SIZE);
      N._next = 0;
    }
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const prevAutoClear = renderer.autoClear;
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    const end = Math.min(N._next + N.slicesPerFrame, N.SHAPE_SIZE);
    for(let z = N._next; z < end; ++z) renderSlice(renderer, N._shapeTarget, N.SHAPE_SIZE, z, 0);
    N._next = end;
    if(N._next >= N.SHAPE_SIZE){
      for(let z = 0; z < N.DETAIL_SIZE; ++z) renderSlice(renderer, N._detailTarget, N.DETAIL_SIZE, z, 1);
      N.shape = N._shapeTarget.texture;
      N.detail = N._detailTarget.texture;
      N.ready = true;
      N._scene.children[0].geometry.dispose();
      N._material.dispose();
      N._material = null;
      N._scene = null;
    }
    renderer.autoClear = prevAutoClear;
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.setRenderTarget(prevTarget, prevFace, prevMip);
    N.bakeMs += performance.now() - t0;
    return N.ready;
  };
})(ARestlessOcean.WaterfallCloudNoise);
