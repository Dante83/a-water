//
//Debug fluid acts on a given particle system and visually gives us insights into what
//is doing what, where and how inside of our system so that we can double check that everything
//makes sense. This is not for production usage, but only for debugging purposes.
//
AFRAME.registerComponent('fluid-debugger', {
  schema: {
    particleSystemId: {type: 'string', default: 'my-particle-system'},
    drawParticleSystem: {type: 'boolean', default: false},
    particleSystemColor: {type: 'vec4', default: {x: 1.0, y: 0.0, z: 0.0, w: 0.2}},
    drawBuckets: {type: 'boolean', default: false},
    bucketsColor: {type: 'vec4', default: {x: 1.0, y: 1.0, z: 0.0, w: 0.4}},
    drawStaticMesh: {type: 'boolean', default: false},
    staticMeshColor: {type: 'vec4', default: {x: 1.0, y: 1.0, z: 1.0, w: 1.0}},
    drawPoints: {type: 'boolean', default: false},
    drawSurfaceMesh: {type: 'boolean', default: false}
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
  drawParticleSystemContainer: function(particleSystem){
    //Grab the width depth and height of our box, as well as it's position, so we can draw it in the world view
    console.log("BUCKET GRID:");
    console.log(particleSystem.bucketGrid);

    let glc = particleSystem.bucketGrid.gridLowerCoordinates;
    let offset = [glc.x, glc.y, glc.z];
    let guc = particleSystem.bucketGrid.gridUpperCoordinates;
    let dim = [guc.x - glc.x, guc.y - glc.y, guc.z - glc.z];

    //Basically a box with the given colors.
    let c = this.data.particleSystemColor;
    let c3 = new THREE.Color(c.x, c.y, c.z);
    let material = new THREE.MeshLambertMaterial( {color: c3, transparent: true, opacity: this.data.particleSystemColor.w});
    let box = new THREE.Mesh(new THREE.BoxGeometry(guc.x, guc.y, guc.z, glc.x, glc.y, glc.z), material);
    var sceneRef = this.el.sceneEl.object3D;

    //Add the box
    sceneRef.add(box);

    //Move it to the appropriate location.
    box.position.set(0, 0, 0);
    console.log('Particle system container constructed.');
  },
  initDrawBuckets: function(){
    //All the little boxes in the big box - drawn with lines.

  },
  initDrawStaticMesh: function(){
    //A series of dots where the vertices of the static mesh are, with lines connecting them.

  },
  init: function(){
    console.log(this.data);
    //Set up events that are triggered from our particle system each time a critical
    //process is completed.
    this.fluidParamsEl = document.querySelector(`#${this.data.particleSystemId}`);
    let thisDebugger = this;
    console.log('Initializing fluid system debugger...');

    this.fluidParamsEl.addEventListener('bucket-grid-constructed', function (data) {
      console.log('Constructing particle system container...');

      //We actually don't do anything with the result, this is just used to trigger
      //the drawing of our our particle system box.
      if(thisDebugger.data.drawParticleSystem && thisDebugger.data.particleSystemId === data.originalTarget.attributes.id.value){
        thisDebugger.drawParticleSystemContainer(data.detail.particleSystem);
      }
    });
  },
  tick: function (time, timeDelta) {
    //Update our particle positions and visible surface mesh once they're added.

  }
});
