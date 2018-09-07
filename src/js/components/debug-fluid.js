//
//Debug fluid acts on a given particle system and visually gives us insights into what
//is doing what, where and how inside of our system so that we can double check that everything
//makes sense. This is not for production usage, but only for debugging purposes.
//
AFRAME.registerComponent('debug-fluid', {
  schema: {
    'particle-system-id': {type: 'string', default: 'my-particle-system'},
    'draw-particle-system': {type: 'boolean', default: false},
    'particle-system-color': {type: 'vec4', default: {x: 1.0, y: 0.0, z: 0.0, w: 0.2}},
    'draw-buckets': {type: 'boolean', default: false},
    'buckets-color': {type: 'vec4', default: {x: 1.0, y: 1.0, z: 0.0, w: 0.4}},
    'draw-static-mesh': {type: 'boolean', default: false},
    'static-mesh-color': {type: 'vec4', default: {x: 1.0, y: 1.0, z: 1.0, w: 1.0}},
    'draw-points': {type: 'boolean', default: false},
    'draw-surface-mesh': {type: 'boolean', default: false}
  },
  rgb2HexColor: function(colorVect){
    let intR = Math.floor(255.0 * colorVect.x);
    let intG = Math.floor(255.0 * colorVect.y);
    let intB = Math.floor(255.0 * colorVect.z);
    let hexCodes = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
    function int2Hex(intColor){
      return `${hexCodes[Math.floor(intColor / 16)]}${hexCodes[Math.floor(intColor % 16)]}`;
    }
    let hexR = int2Hex(intR);
    let hexG = int2Hex(intG);
    let hexB = int2Hex(intB);

    return `0x${hexR}${hexG}${hexB}`;
  },
  drawParticleSystemContainer: function(){
    if(this.data['draw-particle-system']){
      //Grab the width depth and height of our box, as well as it's position, so we can draw it in the world view
      this.particleSystem

      //Basically a box with the given colors.
      let material = new THREE.MeshBasicMaterial( {color: rgb2HexColor(this.data['particle-system-color']), opacity: this.data['particle-system-color'].w});
      let box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4, 4), material);
      var sceneRef = this.el.sceneEl.object3D;

      //Add the box
      sceneRef.add(box);

      //Move it to the appropriate location.

    }
  },
  initDrawBuckets: function(){
    //All the little boxes in the big box - drawn with lines.

  },
  initDrawStaticMesh: function(){
    //A series of dots where the vertices of the static mesh are, with lines connecting them.
  },
  init: function(){
    //Set up events that are triggered from our particle system each time a critical
    //process is completed.
    this.fluidParamsEl = document.querySelector(`#${this.data['particle-system-id']}`);
    console.log(this.fluidParamsEl);
    this.particleSystem = this.fluidParamsEl.components['fluid-params'].particleSystem;
    let thisDebugger = this;

    staticCollider.addEventListener('bucket-grid-constructed', function (result) {
      //We actually don't do anything with the result, this is just used to trigger
      //the drawing of our our particle system box.
      thisDebugger.drawParticleSystemContainer();
    });
  },
  tick: function (time, timeDelta) {
    //Update our particle positions and surface mesh.

  }
});
