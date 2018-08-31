//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('fluid-params', {
  fractionalSeconds: 0,
  dependencies: [],
  fluidParticles: [],
  schema: {
    'search-bucket-diameter': {type: 'number', default: 10.0},
    'upper-corner': {type: 'vec3', default: {x: 0.0, y: 0.0, z: 0.0}},
    'lower-corner': {type: 'vec3', default: {x: 0.0, y: 0.0, z: 0.0}},
    'target-density': {type: 'number', default: 997.0},
    'particle-radius': {type: 'number', default: 0.1},
    'drag-coeficient': {type: 'number', default: 1.0},
    'particle-mass': {type: 'number', default: 1.0},
    'static-scene-accuracy': {type: 'number', default: 2},
    'draw-style': {type: 'string', default: 'particles'},
    'sph-iterations-per-second': {type: 'number', default: 60.0},
    'time-between-sph-iteration-writes': {type: 'number', default: 5*60}
  },
  init: function(){
    this.drawParticles = this.data['draw-style'] === 'particles';
    this.drawSurface = this.data['draw-style'] === 'surface';
    this.particleSystem = new ParticleSystem(this.data['particle-radius'], this.data['drag-coeficient'], this.data['particle-mass']);
    this.staticScene = new StaticScene(this.data['static-scene-accuracy']);

    //Get all static assets attached to this fluid system and attach them to our static scene
    //
    //NOTE: For web workers, we probably want to create a combined mesh in this thread, and then pass the collection of
    //vertices, and nodes into a a web worker intializer.
    //
    const fluidSystemId = this.el.id;
    const staticColliders = document.querySelectorAll(`.${fluidSystemId} .static-fluid-collider`);

    //Traverse the mesh objects passed over
    for(let i = 0, staticCollidersLen = staticColliders.length; i < staticCollidersLen; i++){
      let staticCollider = staticColliders[i].object3D;
      staticCollider.traverse(function(node){
        if (node instanceof THREE.Mesh){
          this.staticScene.addMesh(node.geometry);
        }
      });
    }

    //Trigger construction of static KD Trees


    //Get all particle entities attached to this fluid system


    //Add all particles into the grid at periodic positions
    //that also fall inside of the particle system grid and inside of the colliders.

    //
    //NOTE: A future objective is to cover the surface in some super-fast adaptive grid
    //technique
    //
    this.useHardSpheres = true;
    this.geometry = new THREE.SphereGeometry( 0.1, 4, 4);
    this.material = new THREE.MeshBasicMaterial( {color: '#00AAFF'} );
    this.numberOfParticles = 0;

    //Initialize our time trackers for sub-frame calculations.
    //TODO: Move to time weighted average
    let storedDataForSecondsPerFrameEstimate = localStorage.getItem("a-fluid-system.spf.data");
    const maxPreviousSPFTimeDeltas = 12;
    this.dataNotUpdated = true;
    this.dataForSecondsPerFrameEstimate = storedDataForSecondsPerFrameEstimate ? storedDataForSecondsPerFrameEstimate : [].fill(0, maxPreviousSPFTimeDeltas, 0.016);
    if(this.dataForSecondsPerFrameEstimate > maxPreviousSPFTimeDeltas){
      //Cut off the oldest values
      let difference = this.dataForSecondsPerFrameEstimate.length - maxPreviousSPFTimeDeltas;
      this.dataForSecondsPerFrameEstimate = this.dataForSecondsPerFrameEstimate.splice(maxPreviousSPFTimeDeltas - 1, difference);
    }
    else if(this.dataForSecondsPerFrameEstimate < maxPreviousSPFTimeDeltas){
      //Populate the rest of the data with the average value.
      let difference = maxPreviousSPFTimeDeltas - this.dataForSecondsPerFrameEstimate;
      let avg = this.dataForSecondsPerFrameEstimate.reduce((accumulator, currentValue) => currentValue + accumulator) / this.dataForSecondsPerFrameEstimate.length;
      this.dataForSecondsPerFrameEstimate = [...this.dataForSecondsPerFrameEstimate, ...[].fill(0, difference, avg)];
    }
    this.estimatedSecondsPerFrameSum = this.dataForSecondsPerFrameEstimate.reduce((accumulator, currentValue) => currentValue + accumulator);
    this.inverseDataForSecondsPerFrameEstimateLength = 1.0 / this.dataForSecondsPerFrameEstimate.length;
    this.estimatedSecondsPerFrame = this.estimatedSecondsPerFrameSum * this.inverseDataForSecondsPerFrameEstimateLength;
    this.sphWriterTimeTracker = 0.0;
  },
  tick: function (time, timeDelta) {
    //Update our FPS Tracking System
    this.previousFPSValues.unshift(timeDelta);
    let lastValue = this.previousFPSValues.pop();
    this.estimatedSecondsPerFrame = (this.estimatedSecondsPerFrameSum - lastValue + timeDelta) * this.inverseDataForSecondsPerFrameEstimateLength;
    let sphIterationsPerSecond = this.data['sph-iterations-per-second'];
    let numberOfSPCIterations = Math.ceil(sphIterationsPerSecond * this.estimatedSecondsPerFrame);
    let timeStep = timeDelta / numberOfSPCIterations;

    let previousParticlePositions = [];
    let cachedParticlePositions = [];

    //
    //NOTE: A lot of these things require a kind of parent over-arching system to handle all sub-systems.
    //

    //
    //NOTE: Re-Add Code to add new particles here from sources and remove particles from sinks.
    //

    //
    //NOTE: We might also wish to keep track of particle system visibility for a certain period of time
    //unless the user is able to observe the system before it can be updated with information from a heightmap
    //for another constant of time. Perhaps an adaptive learning mechnism would prove useful here.
    //

    //
    //NOTE: Implement adaptive grid accuracies that reflect less accuracy with greater distance.
    //

    //
    //NOTE: Implement a wave solver that attempts to solve certain grids as normal deep ocean systems, possibly with just splash effects at great distances.
    //

    //
    //TODO: Pull this out into it's own solver in the solver that we can just update and call
    //for each worker thread.
    //
    // for(let i = 0; i < numberOfSPCIterations; i++){
    //   //Implement our fluid solver
    //   this.particleSystem.updateParticles(timeDelta/1000.0);
    //   this.particleSystem.resolveCollision();
    //
    //   if(){
    //
    //   }
    //   else if(){
    //
    //   }
    // }

    //Update the draw position or redraw the fluid surface
    if(this.drawParticles){
      for(let i = 0; i < this.numberOfParticles; i++){
        var partPos = this.particleSystem.particles[i].position;
        var drawPos = this.fluidParticles[i].position.set(partPos.x, partPos.y, partPos.z);
      }
    }

    if(this.dataNotUpdated){
      if(this.sphWriterTimeTracker >= this.data['time-between-sph-iteration-writes']){
        this.dataNotUpdated = false;
        localStorage.setItem("a-fluid-system.spf.data", this.previousFPSValues);
      }
      this.sphWriterTimeTracker += timeDelta;
    }
  },
  getRandomColor() {
    let letters = '0123456789ABCDEF';
    let color = '#';
    for (var i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  },
  logNTimes: function(name, maxNumLogs, msg){
    if(self.logs[name] == null){
      self.logs[name] = 1;
      console.log(msg);
    }
    if(self.logs[name] <= maxNumLogs){
      self.logs[name] += 1;
      console.log(msg);
    }
  }
});
