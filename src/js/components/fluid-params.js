//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('fluid-params', {
  fractionalSeconds: 0,
  dependencies: [],
  fluidParticles: [],
  sphWebWorkers: [],
  timeTracker: false,
  tickerIterator: 1,
  numberOfCores: null,
  initializedWebWorkers: [],
  webWorkersInitialized: false,
  particlesRequestsFullfilled: [],
  particleRequests: [],
  particleUpdatesFullfilled: false,
  updateIterator: 0,
  sphSimulationsFullfilled: [],
  numberOfParticlesByCPU: [],
  fluidParamsInitialized: false,
  tickOneComplete: false,
  renderParticles: false,
  allDataUpdated: false,
  particleSolver: false,
  particleInterpolator: false,
  kernalConstants: false,
  transfferableBuffers: {
    positionArrays: [],
    velocityArrays: [],
    forceArrays: [],
    bucketIdArrays: []
  }
  eventConstants: {
    EVENT_INITIALIZATION: 1,
    UPDATE_PARTICLE_LIST: 2,
    REQUEST_PARTICLE_LIST: 3,
    RUN_PCI_SPH_SIMULATION: 4
  },
  schema: {
    'searchBucketDiameter': {type: 'number', default: 10.0},
    'upperCorner': {type: 'vec3', default: {x: 0.0, y: 0.0, z: 0.0}},
    'lowerCorner': {type: 'vec3', default: {x: 0.0, y: 0.0, z: 0.0}},
    'particleRadius': {type: 'number', default: 0.5},
    'particleDrawRadius': {type: 'number', default: 0.5},
    'targetSpacing' : {type: 'number', default: 0.25},
    'pciTimeStep': {type: 'number', default: 0.0013},
    'gravity': {type: 'vec3', default: {x: 0.0, y: 0.0, z: -9.8}},
    'localWindVelocity': {type: 'vec3', default: {x: 0.0, y: 0.0, z: 0.0}},
    'dragCoeficient': {type: 'number', default: 0.1},
    'targetDensity': {type: 'number', default: 997.0},
    'viscosity': {type: 'number', default: 0.801e-6},
    'pseudoViscosityCoefficient': {type: 'number', default: 0.01},
    'eosExponent': {type: 'number', default: 7.0}, //Thanks to http://www.infomus.org/Events/proceedings/CASA2009/Bao.pdf
    'speedOfSound': {type: 'number', default: 1498.0},
    'staticSceneAccuracy': {type: 'number', default: 3},
    'maxNumberOfPCISteps': {type: 'number', default: 5},
    'maxDensityErrorRatio': {type: 'number', default: 0.1},
    'negativePressureScale': {type: 'number', default: -0.01},
    'minimumCollisionRestorationDistance': {type: 'number', default: 0.08},
    'maxCollisionReflections': {type: 'number', default: 50},
    'numberOfCPUCores': {type: 'number', default: null}
  },
  init: function(){
    this.loaded = false;
    this.fluidParamsInitialized = false;
    this.tickOneComplete = false;
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

        model.traverse(function(child){
          if (child.isMesh) {
            thisFluidParams.staticMeshes.worldMatrices.push(child.matrixWorld);
            thisFluidParams.staticMeshes.geometries.push(child.geometry);
          }
        });

        //Check if alls models were added, if so, it's time for this entity to start rocking and rolling
        let allMeshesParsed = true;
        for(let status in thisFluidParams.staticCollidersAwaitingLoading){
          if(status === false){
            allMeshesParsed = false;
            break;
          }
        }
        if(allMeshesParsed){
          thisFluidParams.setUpWebWorkers();
        }
      });
    }
  },
  setUpWebWorkers: function(thisFluidParams){
    //Set up each of the primary workers associated with running our fluid simulation.
    //Leave the main core alone.
    let this.numberOfCores;
    if(this.data.numberOfCPUCores){
      this.numberOfCores = this.data.numberOfCPUCores;
    }
    else if(navigator.hardwareConcurrency){
      //I need the number of actual CPU cores, not logical cores as each core has a pretty heavy workload.
      //I presume hyperthreading will be enabled for any system with more then 8 cores as
      //this is a relatively high level feature. I am so sorry people with core i7-9700k.
      //I'm not trying to hurt you, just trying to do what's best for everyone else.
      //Hyperthreading also exists on lower level core counts, but I suspect they won't have the power to really
      //make use of the SPH feature anyways.
      this.numberOfCores = navigator.hardwareConcurrency >= 8 ? navigator.hardwareConcurrency / 2 : navigator.hardwareConcurrency;
    }
    else{
      //If no information given, we will presume that this user has 4 cores.
      //In the worst case scenario, they won't be able to run the simulation.
      this.numberOfCores = 4;
    }
    //Oh, and leave CPU 0 alone. That core already has enough food on his plate.
    this.numberOfCores -= 1;

    //For testing purposes
    //
    //TODO: Remove this when we move to all cores
    //
    this.numberOfCores = 1;

    let self = this;
    for(let i = 0; i < this.numberOfCores; ++i){
      let worker = new Worker("../../src/cpp/water-worker.js");
      this.sphWebWorkers.push(worker);

      //For now I am just putting the same number of particles on every thread
      this.numberOfParticlesByCPU = 1000;

      //
      //TODO: Before actually setting the number of particles, we should set up
      //the static geometry for the particles to collide with. However, for now,
      //we will just presume our particles start off in a box and work our way
      //through Doyub Kim's text again.
      //
      initializedWebWorkers.push(false),
      particlesRequestsFullfilled.push(false),
      particleRequests.push(false),
      particleUpdatedFullfilled.push(false),
      sphSimulationsFullfilled.push(false),

      //Set up our listener events for events fired from each of our web workers.
      let self = this;
      this.sphWebWorkers[i].onmessage = function(e){
        if(e.eventType === self.EVENT_INITIALIZATION){
          initializedWebWorkers[e.data.CPUID] = true;
          let allWorkersInitialized = true;
          for(let i = 0; i < self.numberOfCores; ++i){
            if(!initializedWebWorkers[i]){
              allWorkersInitialized = false;
              break;
            }
          }
          if(allWorkersInitialized){
            self.webWorkersInitialized = true;
            for(let i = 0; i < self.numberOfCores; ++i){
              transfferableBuffers.positionArrays.push(new Float32Array(this.numberOfParticlesByCPU * 3));
              transfferableBuffers.velocityArrays.push(new Float32Array(this.numberOfParticlesByCPU * 3));
              transfferableBuffers.forceArrays.push(new Float32Array(this.numberOfParticlesByCPU * 3));
              transfferableBuffers.bucketIdArrays.push(new Int32Array(this.numberOfParticlesByCPU));

              sphWebWorkers[i].postMessage({
                eventType: self.REQUEST_PARTICLE_LIST,
                positions: transfferableBuffers.positionArrays[i],
                velocities: transfferableBuffers.velocityArrays[i],
                forces: transfferableBuffers.forceArrays[i],
                bucketIDs: transfferableBuffers.bucketIdArrays[i]
              }, [
                  transfferableBuffers.positionArrays[i],
                  transfferableBuffers.velocityArrays[i],
                  transfferableBuffers.forceArrays[i],
                  transfferableBuffers.bucketIdArrays[i]
                ]
              );
            }
          }
        }
        else if(e.eventType === self.UPDATE_PARTICLE_LIST){
          let allWorkersReturnedValues = true;
          for(let i = 0; i < self.numberOfCores; ++i){
            if(!initializedWebWorkers[i]){
              allWorkersReturnedValues = false;
              break;
            }
          }
          if(allWorkersReturnedValues){
            if(eventI === self.numberOfCPUs){
              self.particleUpdatesFullfilled = true;
            }
            else{
              //Pass the arrays to the next CPU for copying.

            }
          }
        }
        else if(e.eventType === self.REQUEST_PARTICLE_LIST){
          initializedWebWorkers[e.data.CPUID] = true;
          let allWorkersReturnedValues = true;
          for(let i = 0; i < self.numberOfCores; ++i){
            if(!initializedWebWorkers[i]){
              allWorkersReturnedValues = false;
              break;
            }
          }
          if(allWorkersReturnedValues){
            self.updateIterator = 0;

            for(let i = 0; i < self.numberOfCores; ++i){
              let nextCPUArrayID = (i + 1) % self.numberOfCores;
              sphWebWorkers[i].postMessage({
                eventType: self.UPDATE_PARTICLE_LIST,
                eventI: nextCPUArrayID,
                positions: transfferableBuffers.positionArrays[nextCPUArrayID],
                velocities: transfferableBuffers.velocityArrays[nextCPUArrayID],
                forces: transfferableBuffers.forceArrays[nextCPUArrayID],
                bucketIDs: transfferableBuffers.bucketIdArrays[nextCPUArrayID]
              }, [
                  transfferableBuffers.positionArrays[nextCPUArrayID],
                  transfferableBuffers.velocityArrays[nextCPUArrayID],
                  transfferableBuffers.forceArrays[nextCPUArrayID],
                  transfferableBuffers.bucketIdArrays[nextCPUArrayID]
                ]
              );
            }
          }
        }
        else if(e.eventType === self.RUN_PCI_SPH_SIMULATION){

        }
      }

      //Now that our web worker responds to message from the worker itself
      //we can fire off our first message requesting that this web worker be set up.
      //Pass our data into the web worker to initialize construction
      this.sphWebWorkers[i].postMessage({
        eventType: self.EVENT_INITIALIZATION,
        data: {
          componentData: this.data,
          staticMeshes: this.staticMeshes.geometries,
          worldMatrices: this.staticMeshes.worldMatrices,
          numberOfCPUS: numberOfCores,
          currentCPUID: i,
          numberOfParticlesByCPU: 1000,
        }
      });
    }
  },
  buildBucketGrid: function(){
    //We might as well construct our buckets and things all the way down here, after the models have loaded.
    //Most of this stuff could probably be done inside of a web worker for increased speed.
    // let kernalConstants = new KernalConstants(this.data.particleRadius);
    // this.kernal = new Kernal(kernalConstants);
    // this.particleConstants = new ParticleConstants(this.data.dragCoeficient, this.data.particleRadius, this.data.targetSpacing, this.data.particleDrawRadius, this.data.viscosity, this.data.targetDensity, this.data.gravity, this.kernal, this.data.localWindVelocity);
    // this.particleSystem = new ParticleSystem([2.5, 2.5, 3.0], [-2.5, -2.5, -0.5], this.particleConstants, this, this.data.minimumCollisionRestorationDistance, this.data.maxCollisionReflections);
    // this.el.emit('particle-system-constructed', {finished: true});
    //this.staticScene = new StaticScene(this.particleSystem.bucketGrid, this.data.staticSceneAccuracy);

    //Trigger the partitioning of our mesh into a set of intersectable point for easy searching
    //in each bucket.
    // let staticGeometries = this.staticMeshes.geometries;
    // let staticWorldMatrices = this.staticMeshes.worldMatrices;
    // for(let i = 0, geometriesLength = staticGeometries.length; i < geometriesLength; i++){
    //   this.staticScene.addMesh(staticGeometries[i], staticWorldMatrices[i]);
    // }
    // this.staticScene.getFaceCollisionPoints();
    // let collisionSurfaceHashedBuckets = this.staticScene.filterBucketsInsideVersesOutside();
    // this.staticScene.triggerDrawCollidedBuckets(collisionSurfaceHashedBuckets);
    // this.staticScene.attachMeshToBucketGrid(collisionSurfaceHashedBuckets);

    //
    //NOTE: For testing purposes only...
    //
    //let vectPoints = this.staticScene.searchablePoints.map(x => new THREE.Vector3(...x.position));
    //For testing purposes only...
    // this.el.emit('draw-points', {
    //   points: vectPoints,
    //   color: new THREE.Vector3(0.0,0.0,1.0)
    // });
    //this.el.emit('static-mesh-constructed', {particleSystem: this.particleSystem});

    //
    //TODO: Replace this. For now, I'm just grabbing the curren box geometry, but I probably want
    //something a bit more dynamic in the future.
    //
    // var fluidSystemId = this.el.id;
    // this.currentFluidGeometries = document.querySelectorAll(`.fluid.${fluidSystemId}`);

    //Populate our initial particles
    //TODO: In the future this should be done by AI approximation to estimate what
    //we expect the system to look like.
    // let fluidCollisionBound = new StaticScene(this.particleSystem.bucketGrid, this.data.staticSceneAccuracy);
    // for(let i = 0, numOfFluidGeometries = this.currentFluidGeometries.length; i < numOfFluidGeometries; i++){
    //   let fluidBufferGeometry = this.currentFluidGeometries[i].components.geometry.geometry;
    //   let worldMatrixOfFluidBufferGeometry = this.currentFluidGeometries[i].object3D.matrixWorld;
    //   fluidCollisionBound.addMesh(fluidBufferGeometry, worldMatrixOfFluidBufferGeometry);
    // }
    // fluidCollisionBound.getFaceCollisionPoints();
    // let fluidSurfaceHashedBuckets = fluidCollisionBound.filterBucketsInsideVersesOutside();
    //fluidCollisionBound.triggerDrawCollidedBuckets(fluidSurfaceHashedBuckets);

    //
    //NOTE: For testing purposes only
    //
    //let vectPoints2 = fluidCollisionBound.searchablePoints.map(x => new THREE.Vector3(...x.position));
    // this.el.emit('draw-points', {
    //   points: vectPoints2,
    //   color: new THREE.Vector3(1.0,0.0,1.0)
    // });

    // let particleFiller = new ParticleFiller(this.particleSystem, collisionSurfaceHashedBuckets, this.staticScene, fluidSurfaceHashedBuckets, fluidCollisionBound);
    // particleFiller.fillMesh(this.data.targetSpacing);

    //Unlike our static geometry above, we want to remove our geometries from the screen
    //just as soon as we've finished populating all of those particles.
    // for(let i = 0, numOfFluidGeometries = this.currentFluidGeometries.length; i < numOfFluidGeometries; i++){
    //   let fluidBufferGeometry = this.currentFluidGeometries[i];
    //   fluidBufferGeometry.parentNode.removeChild(fluidBufferGeometry);
    // }

    //During the first pass, let's initialize by determining the location of all neighboring particles.
    // let particles = this.particleSystem.particles;
    // for(let i = 0, numParticles = particles.length; i < numParticles; i++){
    //   particles[i].updateParticlesInNeighborhood();
    // }

    //Set up our fluid solver which simulates fluid dynamics for our particles
    //mainly by calling accumulatePressureForce during the update process.
    // this.interpolationEngine = new InterpolationEngine(this.particleSystem.bucketGrid, this.kernal, kernalConstants, 1000);
    // let particleSolverContants = new ParticleSolverConstants(this.data.targetDensity, this.data.eosExponent, this.data.speedOfSound, this.data.negativePressureScale, this.data.viscosity, this.data.pseudoViscosityCoefficient, this.data.maxDensityErrorRatio, this.data.maxNumberOfPCISteps);
    // this.pciSPHSystemSolver = new PCISPHSystemSolver(this.interpolationEngine, particleSolverContants, this.particleSystem);
    // this.pciSPHSystemSolver.setDeltaConstant(this.data.pciTimeStep);
    // this.particleSystem.setPCISystemSolver(this.pciSPHSystemSolver);

    //Trigger a call to track our particles over time if we want to.
    // this.el.emit('draw-sph-test-particles', {
    //   particleSystem: this.particleSystem
    // });
    //
    // self = this;
    // this.avgRunningTime = 1000.0 / 60.0;
    // this.timeTracker;
    // this.el.sceneEl.addEventListener('set-frame-timer-references', this.setFrameTimerReferences);
    // this.el.emit('get-frame-timer-references');
  },
  setFrameTimerReferences: function(data){
    // self.timeTracker = data.detail.timeTracker;
    // if(self.timeTracker){
    //   self.fluidParamsInitialized = true;
    //   self.el.removeEventListener('set-frame-timer-references', this.setFrameTimerReferences);
    // }
  },
  tick: function (time, timeDelta) {
    //Wait until post load is completed before attempting to tick through our system.
    if(this.renderParticles){
      this.renderParticles = false;

      //Run our rendering update here

      //Start the next cycle

    }
  },
  tock: function (time, timeDelta) {
    //Combine our mesh with our ocean mesh. Visualization is done in the post-processing stage.

    //Check if our simulation is done.
    //If so, grab the results for rendering in the next tick cycle
    //If not, skip this frame and come back at the end of next frame.
    if(this.allDataUpdated){
      this.allDataUpdated = false;
      this.renderParticles = true;
    }
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
