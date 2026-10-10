//── Land reflection pass ─────────────────────────────────────────────────────
//
//WHAT IT FIXES. Screen-space reflection can only reflect what is ON SCREEN. Every
//miss — the reflected ray leaving the frame, pointing back behind the camera, or
//running out of steps — returned SKY (water-shader.glsl screenSpaceReflection),
//so the hill behind you never appeared in the lake in front of you, and the far
//shore vanished from the water the moment it slid off the edge of the frame.
//
//WHAT IT PRODUCES. A land-only G-BUFFER CUBE, captured from just above the water
//near the camera: six 90° faces laid out 3×2 in one MRT atlas, with the same
//three attachments as RefractionGBufferPass (it renders through that pass, with
//its material swaps and a-land's own capture material):
//  0: albedo + land mask in .a        (0 = nothing there: sky)
//  1: world-space normal
//  2: linear view depth along the face's forward axis
//The water shader's landReflectionFallback() reads it on every SSR miss.
//
//ONE SAMPLER, NOT THREE (2026-10-09). The water program had 32 texture units
//before this pass existed, which is the whole budget on a 32-unit GPU, and
//binding the three attachments took it to 35: the program stopped LINKING and
//the water did not draw at all. So the water never sees the MRT. When the sixth
//face lands, one tiny draw PACKS the three attachments into one double-height
//texture (the 3×2 face atlas twice, stacked):
//  rows [0, 2F)    albedo.rgb + land mask .a        (attachment 0, verbatim)
//  rows [2F, 4F)   world normal .rgb + depth .a     (attachments 1 and 2)
//Lossless: same half-float format, same texel grid, same bilinear filter, and the
//shader's half-texel clamp inside a face keeps the filter off the other half.
//(The MRT layout itself stays as it is: it is RefractionGBufferPass's, and
//a-land's capture material writes it.) The pack is also the swap, so the MRT
//no longer needs a second copy to stay whole while the water reads it — the
//water reads the packed texture, which only ever changes in one draw.
//
//WHY A G-BUFFER AND NOT A LIT CUBEMAP. The water RELIGHTS what it finds, with the
//exact formula an on-screen SSR hit uses (sun × N·L × the land's shadow + sky ×
//the land's sky visibility, × albedo/π). So:
//  - the reflection of a hill is the same colour whether SSR caught it on screen
//    or this pass caught it off screen, and the hand-off between the two is
//    invisible;
//  - nothing here depends on the sun: a time-of-day change, a cloud, the moon
//    rising — none of them needs a recapture. Only MOVING does;
//  - no photometric units cross the library boundary (a-land shades in lux, the
//    water's sky is a-starry-sky's units), because no lit colour does.
//
//WHERE THE LAND IS vs WHAT IT LOOKS LIKE. A cube captured from one point is
//wrong about directions seen from anywhere else (parallax), and coarse at 128²
//a face. So it is only trusted for COLOUR. Whether a missed ray is land or sky
//is answered per pixel by a-land's skyline atlas (landLightVisibility — the same
//field that shadows the land), which is exact for the terrain from the water
//fragment itself. The shader also walks the cube's depth a few steps to land the
//colour lookup on the right spot (a localised, depth-corrected cube lookup).
//
//COST. One face per frame — a G-buffer render of the scene at 128² — and only
//while a capture is in progress: a new one starts when the camera has moved
//MOVE_M from the last origin, or every REFRESH_MS to pick up streamed tiles.
//Plus one 384×512 pack draw when a capture completes.
//
//KNOWN LIMITS:
//  - a-land culls its placed OBJECTS to the main camera's frustum, so props
//    behind the camera are not in the scene to capture; terrain is (its patches
//    are chosen by distance, not view). Hills come back; a house behind you does not.
//  - the skyline atlas is swept from the GROUND, which under water is the lake
//    bed, so over deep water it reads the skyline a little high.
//  - a foreign terrain WITHOUT a-land's capture material is hidden for this pass:
//    the geometry-only twin reconstructs from gl_FragCoord over the whole target,
//    which an atlas viewport breaks.
//
//Console: ARestlessOcean.Passes.LandReflectionPass.enabled = false (A/B).

ARestlessOcean.Passes = ARestlessOcean.Passes || {};

ARestlessOcean.Passes.LandReflectionPass = function(oceanGrid){
  this.oceanGrid = oceanGrid;
  this.renderer = oceanGrid.renderer;
  this.target = null;            //the MRT the faces render into (never read by the water)
  this.packed = null;            //what the water reads: see ONE SAMPLER, NOT THREE above
  this._packScene = null;
  this._packCamera = null;
  this._packMaterial = null;
  this.cameras = [];
  this.origin = new THREE.Vector3();       //front's capture point
  this._pending = new THREE.Vector3();     //back's capture point
  this._face = -1;                         //-1 idle, else the next face to render into back
  this._valid = false;                     //front holds a complete capture
  this._lastStart = -Infinity;
  this._viewport = new THREE.Vector4();
};

(function(P){
  var LRP = ARestlessOcean.Passes.LandReflectionPass;
  LRP.enabled = true;
  LRP.FACE = 128;          //texels a face
  LRP.MOVE_M = 24;         //recapture after the camera travels this far (XZ) from the origin
  LRP.REFRESH_MS = 8000;   //…or this long, for tiles that streamed in since
  LRP.LIFT_M = 1.5;        //capture height above the water surface under the camera

  //The pack (see ONE SAMPLER, NOT THREE): texel for texel, nothing filtered or re-encoded.
  //One contract with the shader's landReflA / landReflB (water-shader.glsl).
  LRP.PACK_FRAGMENT = [
    'uniform sampler2D packAlbedo;',
    'uniform sampler2D packNormal;',
    'uniform sampler2D packDepth;',
    'void main(){',
    '  ivec2 p = ivec2(gl_FragCoord.xy);',
    '  int rows = textureSize(packAlbedo, 0).y;',
    '  if(p.y < rows){',
    '    gl_FragColor = texelFetch(packAlbedo, p, 0);',
    '  } else {',
    '    ivec2 q = ivec2(p.x, p.y - rows);',
    '    gl_FragColor = vec4(texelFetch(packNormal, q, 0).rgb, texelFetch(packDepth, q, 0).r);',
    '  }',
    '}'
  ].join('\n');

  //THE FACE TABLE — one contract with the shader's landReflFace() (water-shader.glsl).
  //Face k sits at atlas tile (k % 3, k / 3). F = forward, U = up; right R = F × U,
  //which is what three's camera.lookAt gives a camera looking down F with up U.
  LRP.FACES = [
    {F: [ 1, 0, 0], U: [0, 1, 0]},
    {F: [-1, 0, 0], U: [0, 1, 0]},
    {F: [ 0, 0, 1], U: [0, 1, 0]},
    {F: [ 0, 0,-1], U: [0, 1, 0]},
    {F: [ 0, 1, 0], U: [0, 0,-1]},
    {F: [ 0,-1, 0], U: [0, 0, 1]}
  ];

  P.init = function(){
    var F = LRP.FACE;
    //Nearest: only the pack below reads it, and it reads with texelFetch anyway.
    this.target = new THREE.WebGLRenderTarget(3 * F, 2 * F, {
      count: 3,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: true
    });
    //The packed atlas the water samples: same format and filter the MRT had, twice as tall.
    this.packed = new THREE.WebGLRenderTarget(3 * F, 4 * F, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false
    });
    this.packed.texture.generateMipmaps = false;
    //Clip-space quad: THREE.Camera has identity matrices, so the vertex stage writes
    //position straight out (A-Starry-Sky's TextureArrayBuilder does the same).
    this._packMaterial = new THREE.ShaderMaterial({
      uniforms: {
        packAlbedo: {value: null},
        packNormal: {value: null},
        packDepth: {value: null}
      },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: LRP.PACK_FRAGMENT,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._packMaterial);
    quad.frustumCulled = false;
    this._packScene = new THREE.Scene();
    this._packScene.add(quad);
    this._packCamera = new THREE.Camera();
    for(var k = 0; k < 6; k++){
      //Far reaches the whole world: a reflected ridge can be kilometres off.
      var cam = new THREE.PerspectiveCamera(90, 1, 0.5, 30000);
      this.cameras.push(cam);
    }
  };

  //Is there a sibling terrain worth reflecting?
  P.active = function(){
    return LRP.enabled && !!this.oceanGrid._landTerrainRoot && !!this.oceanGrid.refractionGBufferPass;
  };

  //The packed atlas the water samples, or null until one complete capture exists.
  P.front = function(){ return this._valid ? this.packed.texture : null; };

  //Call inside OceanGrid.tick's hide-the-ocean bracket, after the refraction G-buffer.
  //ctx: {scene, camera, time, skipMesh}
  P.tick = function(ctx){
    if(!this.active() || !this.target) return;
    var cam = ctx.camera, og = this.oceanGrid;
    var cp = cam.getWorldPosition ? cam.getWorldPosition(this._tmp || (this._tmp = new THREE.Vector3())) : cam.position;

    if(this._face < 0){
      var dx = cp.x - this.origin.x, dz = cp.z - this.origin.z;
      var moved = !this._valid || (dx * dx + dz * dz) > LRP.MOVE_M * LRP.MOVE_M;
      if(!moved && ctx.time - this._lastStart < LRP.REFRESH_MS) return;
      //From just above the water under the camera — the reflection is seen FROM the
      //water, and a camera up on a hill would otherwise look over the very ridges a
      //lake at its foot reflects. Never below the camera's own feet, though: a camera
      //standing in a dry valley above sea level captures from where it stands.
      var wy = og.waterLevelAt ? og.waterLevelAt(cp.x, cp.z) : (og.heightOffset || 0);
      this._pending.set(cp.x, Math.min(cp.y, wy + LRP.LIFT_M), cp.z);
      this._lastStart = ctx.time;
      this._face = 0;
    }

    var k = this._face, F = LRP.FACE, fc = LRP.FACES[k], c = this.cameras[k];
    c.position.copy(this._pending);
    c.up.set(fc.U[0], fc.U[1], fc.U[2]);
    c.lookAt(this._pending.x + fc.F[0], this._pending.y + fc.F[1], this._pending.z + fc.F[2]);
    c.updateMatrixWorld(true);
    this._viewport.set((k % 3) * F, Math.floor(k / 3) * F, F, F);
    og.refractionGBufferPass.tick({
      scene: ctx.scene, camera: c, skipMesh: ctx.skipMesh,
      target: this.target, viewport: this._viewport
    });

    if(++this._face >= 6){
      this._pack();
      this.origin.copy(this._pending);
      this._valid = true;
      this._face = -1;
    }
  };

  //Push the front capture into a material's uniforms (landRefl*, water-shader.glsl).
  P.updateUniforms = function(u){
    if(!u || !u.landReflOn) return;
    var f = this.front();
    if(!f){ u.landReflOn.value = 0; return; }
    u.landReflAtlas.value = f;
    u.landReflOrigin.value.copy(this.origin);
    u.landReflOn.value = 1;
  };

  //The finished MRT capture -> the one texture the water reads. A single 384×512 draw.
  P._pack = function(){
    var r = this.renderer, m = this._packMaterial;
    m.uniforms.packAlbedo.value = this.target.textures[0];
    m.uniforms.packNormal.value = this.target.textures[1];
    m.uniforms.packDepth.value = this.target.textures[2];
    var prevTarget = r.getRenderTarget();
    var prevXr = r.xr.enabled;
    r.xr.enabled = false;
    r.setRenderTarget(this.packed);
    r.render(this._packScene, this._packCamera);
    r.setRenderTarget(prevTarget);
    r.xr.enabled = prevXr;
  };

  P.dispose = function(){
    if(this.target) this.target.dispose();
    if(this.packed) this.packed.dispose();
    if(this._packMaterial) this._packMaterial.dispose();
    this.target = null;
    this.packed = null;
    this._valid = false;
  };
})(ARestlessOcean.Passes.LandReflectionPass.prototype);
