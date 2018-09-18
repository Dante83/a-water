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
    bucketsColor: {type: 'vec4', default: {x: 0.0, y: 0.0, z: 1.0, w: 0.4}},
    drawStaticMesh: {type: 'boolean', default: false},
    staticMeshColor: {type: 'vec4', default: {x: 1.0, y: 1.0, z: 1.0, w: 1.0}},
    drawPoints: {type: 'boolean', default: false},
    drawSurfaceMesh: {type: 'boolean', default: false}
  },
  drawParticleSystemContainer: function(particleSystem){
    //Grab the width depth and height of our box, as well as it's position, so we can draw it in the world view
    let glc = particleSystem.bucketGrid.gridLowerCoordinates.slice(0);
    let hold = glc[1];
    glc[1] = glc[2]; //Because our Z is THREE.JS' Y
    glc[2] = hold;
    let guc = particleSystem.bucketGrid.gridUpperCoordinates.slice(0);
    hold = guc[1];
    guc[1] = guc[2]; //Because our Z is THREE.JS' Y
    guc[2] = hold;
    let dim = [];
    for(let i = 0; i < 3; i++){
      dim[i] = guc[i] - glc[i];
    }
    let offset = particleSystem.getCenter();
    hold = offset[1];
    offset[1] = offset[2]; //Because our Z is THREE.JS' Y
    offset[2] = hold;

    //Basically a box with the given colors.
    let c = this.data.particleSystemColor;
    let c3 = new THREE.Color(c.x, c.y, c.z);
    let material = new THREE.MeshLambertMaterial( {color: c3, transparent: true, opacity: c.w});
    let box = new THREE.Mesh(new THREE.BoxGeometry(...dim), material);
    let sceneRef = this.el.sceneEl.object3D;

    //Add the box
    sceneRef.add(box);

    //Move it to the appropriate location.
    box.position.set(...offset);
    console.log('Particle system view constructed.');
  },
  drawBucketGridBuckets: function(particleSystem){
    //All the little boxes in the big box - drawn with lines.
    let buckets = particleSystem.bucketGrid.buckets;

    //Stuff we use over and over
    let c = this.data.bucketsColor;
    let c3 = new THREE.Color(c.x, c.y, c.z);
    let material = new THREE.MeshLambertMaterial({color: c3, transparent: true, opacity: c.w});

    for(let i = 0, numBuckets = buckets.length; i < numBuckets; i++){
      let bucket = buckets[i];

      //Grab the width depth and height of our box, as well as it's position, so we can draw it in the world view
      let blc = bucket.lowerCorner.slice(0);
      let hold = blc[1];
      blc[1] = blc[2]; //Because our Z is THREE.JS' Y
      blc[2] = hold;
      let buc = bucket.upperCorner.slice(0);
      hold = buc[1];
      buc[1] = buc[2]; //Because our Z is THREE.JS' Y
      buc[2] = hold;
      let dim = [];
      for(let i = 0; i < 3; i++){
        dim[i] = buc[i] - blc[i];
      }
      let offset = bucket.getCenter();
      hold = offset[1];
      offset[1] = offset[2]; //Because our Z is THREE.JS' Y
      offset[2] = hold;

      //Basically a box with the given colors.
      let box = new THREE.Mesh(new THREE.BoxGeometry(...dim), material);
      let sceneRef = this.el.sceneEl.object3D;

      //Add the box
      sceneRef.add(box);

      //Move it to the appropriate location.
      box.position.set(...offset);
    }
    console.log('Bucket view constructed.');
  },
  drawBucketGridStaticMesh: function(){
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
      //We actually don't do anything with the result, this is just used to trigger
      //the drawing of our our particle system box or buckets contained within.
      if(thisDebugger.data.particleSystemId === data.target.id){
        if(thisDebugger.data.drawParticleSystem){
          console.log('Constructing particle system view...');
          thisDebugger.drawParticleSystemContainer(data.detail.particleSystem);
        }
        if(thisDebugger.data.drawBuckets){
          console.log('Constructing buckets view...');
          thisDebugger.drawBucketGridBuckets(data.detail.particleSystem);
        }
      }
    });
  },
  tick: function (time, timeDelta) {
    //Update our particle positions and visible surface mesh once they're added.

  }
});
