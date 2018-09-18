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
    'particle-radius': {type: 'number', default: 0.5},
    'drag-coeficient': {type: 'number', default: 1.0},
    'particle-mass': {type: 'number', default: 1.0},
    'static-scene-accuracy': {type: 'number', default: 2},
    'draw-style': {type: 'string', default: 'particles'},
    'sph-iterations-per-second': {type: 'number', default: 60.0},
    'time-between-sph-iteration-writes': {type: 'number', default: 5*60}
  },
  init: function(){
    this.runProgram = false;
    this.drawParticles = this.data['draw-style'] === 'particles';
    this.drawSurface = this.data['draw-style'] === 'surface';
    this.loaded = false;
    this.initialized = false;
    this.staticMeshes = {
      geometries: [],
      worldMatrices: []
    };
    let thisFluidParams = this;

    //Get all static assets loaded so we can attach them to the upcoming static scene that we will attach them all to
    const fluidSystemId = this.el.id;
    const staticColliders = document.querySelectorAll(`.static-fluid-collider.${fluidSystemId}`);
    this.staticCollidersAwaitingLoading = [];
    for(let i = 0, staticCollidersLen = staticColliders.length; i < staticCollidersLen; i++){
      this.staticCollidersAwaitingLoading[staticColliders[i].object3D.uuid] = false;
    }

    //Traverse the mesh objects passed over
    for(let i = 0, staticCollidersLen = staticColliders.length; i < staticCollidersLen; i++){
      let staticCollider = staticColliders[i];

      //If not, load it.
      staticCollider.addEventListener('model-loaded', function (gltf) {
        let object3D = gltf.target.object3D;
        thisFluidParams.staticCollidersAwaitingLoading[object3D.uuid] = true;
        let matrixWorld = object3D.matrixWorld;
        let model = gltf.detail.model;
        geometries = [];
        worldMatrices = [];

        model.traverse(function(child){
          if (child.isMesh) {
            worldMatrices.push(child.matrixWorld);
            geometries.push(child.geometry);
          }
        });

        //Add these to our growing list of objects to watch on the next stage of initialization
        thisFluidParams.staticMeshes.geometries.concat(geometries);
        thisFluidParams.staticMeshes.worldMatrices.concat(worldMatrices);

        //Check if alls models were added, if so, it's time for this entity to start rocking and rolling
        let allMeshesParsed = true;
        for(let status in thisFluidParams.staticCollidersAwaitingLoading){
          if(status === false){
            allMeshesParsed = false;
            break;
          }
        }
        if(allMeshesParsed){
          thisFluidParams.postLoadInit();
        }
      });
    }
  },
  postLoadInit: function(){
    //We might as well construct our buckets and things all the way down here, after the models have loaded.
    //Most of this stuff could probably be done inside of a web worker for increased speed.
    this.particleConstants = new ParticleConstants(this.data['particle-radius'], this.data['drag-coeficient'], this.data['particle-mass']);
    this.particleSystem = new ParticleSystem([2.1, 2.1, 1.5], [-2.1, -2.1, -0.1], this.particleConstants, this);
    this.el.emit('particle-system-constructed', {finished: true});
    this.staticScene = new StaticScene(this.data['static-scene-accuracy']);

    //Trigger the partitioning of our mesh into a set of intersectable point for easy searching
    //in each bucket.
    let staticGeometries = this.staticMeshes.geometries;
    let staticWorldMatrices = this.staticMeshes.worldMatrices;
    for(let i = 0, geometriesLength = staticGeometries.length; i < geometriesLength; i++){
      this.staticScene.addMesh(staticGeometries[i], staticWorldMatrices[i]);
    }
    console.log(this.particleSystem);
    this.staticScene.attachMeshToBucketGrid(this.particleSystem.bucketGrid);
    this.el.emit('static-mesh-constructed', {finished: true});

    //Solve the particle system for the situation that minimizes the forces on
    //all particles. That is, the sum of the magnitude of all forces, using
    //Newton's method. I would normally use BFGS, but past experience suggests that
    //Newton's method is somewhat more stable. We initialize the system with an estimate
    //for all particles that assumes a hexagonal packing structure - which actually should
    //be pretty good for a lot of situations.
    //
    //NOTE: For now, we're just going to populate our little boxes with lots of particles.
    //We can do the fun stuff after we get the fluid system working.
    //



    //
    //NOTE: A future objective is to cover the surface in some super-fast adaptive grid
    //technique
    //
    // this.useHardSpheres = true;
    // this.geometry = new THREE.SphereGeometry( 0.1, 4, 4);
    // this.material = new THREE.MeshBasicMaterial( {color: '#00AAFF'} );
    // this.numberOfParticles = 0;
    //
    // //Initialize our time trackers for sub-frame calculations.
    // //TODO: Move to time weighted average
    // let storedDataForSecondsPerFrameEstimate = localStorage.getItem("a-fluid-system.spf.data");
    // const maxPreviousSPFTimeDeltas = 12;
    // this.dataNotUpdated = true;
    // this.dataForSecondsPerFrameEstimate = storedDataForSecondsPerFrameEstimate ? storedDataForSecondsPerFrameEstimate : [].fill(0, maxPreviousSPFTimeDeltas, 0.016);
    // if(this.dataForSecondsPerFrameEstimate > maxPreviousSPFTimeDeltas){
    //   //Cut off the oldest values
    //   let difference = this.dataForSecondsPerFrameEstimate.length - maxPreviousSPFTimeDeltas;
    //   this.dataForSecondsPerFrameEstimate = this.dataForSecondsPerFrameEstimate.splice(maxPreviousSPFTimeDeltas - 1, difference);
    // }
    // else if(this.dataForSecondsPerFrameEstimate < maxPreviousSPFTimeDeltas){
    //   //Populate the rest of the data with the average value.
    //   let difference = maxPreviousSPFTimeDeltas - this.dataForSecondsPerFrameEstimate;
    //   let avg = this.dataForSecondsPerFrameEstimate.reduce((accumulator, currentValue) => currentValue + accumulator) / this.dataForSecondsPerFrameEstimate.length;
    //   this.dataForSecondsPerFrameEstimate = [...this.dataForSecondsPerFrameEstimate, ...[].fill(0, difference, avg)];
    // }
    // this.estimatedSecondsPerFrameSum = this.dataForSecondsPerFrameEstimate.reduce((accumulator, currentValue) => currentValue + accumulator);
    // this.inverseDataForSecondsPerFrameEstimateLength = 1.0 / this.dataForSecondsPerFrameEstimate.length;
    // this.estimatedSecondsPerFrame = this.estimatedSecondsPerFrameSum * this.inverseDataForSecondsPerFrameEstimateLength;
    // this.sphWriterTimeTracker = 0.0;
    // this.runProgram = true;
  },
  tick: function (time, timeDelta) {
    //Wait until post load is completed before attempting to tick through our system.
    if(this.initialized){
      //Update our FPS Tracking System
      // this.previousFPSValues.unshift(timeDelta);
      // let lastValue = this.previousFPSValues.pop();
      // this.estimatedSecondsPerFrame = (this.estimatedSecondsPerFrameSum - lastValue + timeDelta) * this.inverseDataForSecondsPerFrameEstimateLength;
      // let sphIterationsPerSecond = this.data['sph-iterations-per-second'];
      // let numberOfSPCIterations = Math.ceil(sphIterationsPerSecond * this.estimatedSecondsPerFrame);
      // let timeStep = timeDelta / numberOfSPCIterations;
      //
      // let previousParticlePositions = [];
      // let cachedParticlePositions = [];

      //
      //NOTE: A lot of these things require a kind of parent over-arching system to handle all sub-systems.
      //

      //
      //NOTE: Re-Add Code to add new particles here from sources and remove particles from sinks.
      //

      //
      //NOTE:
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
      // if(this.drawParticles){
      //   for(let i = 0; i < this.numberOfParticles; i++){
      //     var partPos = this.particleSystem.particles[i].position;
      //     var drawPos = this.fluidParticles[i].position.set(partPos.x, partPos.y, partPos.z);
      //   }
      // }
      //
      // if(this.dataNotUpdated){
      //   if(this.sphWriterTimeTracker >= this.data['time-between-sph-iteration-writes']){
      //     this.dataNotUpdated = false;
      //     localStorage.setItem("a-fluid-system.spf.data", this.previousFPSValues);
      //   }
      //   this.sphWriterTimeTracker += timeDelta;
      // }
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
