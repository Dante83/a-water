//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('fluid-params', {
  fractionalSeconds: 0,
  dependencies: [],
  fluidParticles: [],
  timeTracker: false,
  tickerIterator: 1,
  fluidParamsInitialized: false,
  tickOneComplete: false,
  particleSolver: false,
  particleInterpolator: false,
  kernalConstants: false,
  schema: {
    'searchBucketDiameter': {type: 'number', default: 10.0},
    'upperCorner': {type: 'vec3', default: {x: 0.0, y: 0.0, z: 0.0}},
    'lowerCorner': {type: 'vec3', default: {x: 0.0, y: 0.0, z: 0.0}},
    'particleRadius': {type: 'number', default: 0.5},
    'particleDrawRadius': {type: 'number', default: 0.1},
    'targetSpacing' : {type: 'number', default: 0.1},
    'pciTimeStep': {type: 'number', default: 0.0013},
    'gravity': {type: 'vec3', default: {x: 0.0, y: 0.0, z: -0.02}},
    'localWindVelocity': {type: 'vec3', default: {x: 0.0, y: 0.0, z: 0.0}},
    'dragCoeficient': {type: 'number', default: 0.1},
    'targetDensity': {type: 'number', default: 997.0},
    'viscosity': {type: 'number', default: 0.801e-6},
    'pseudoViscosityCoefficient': {type: 'number', default: 0.01},
    'eosExponent': {type: 'number', default: 7.0}, //Thanks to http://www.infomus.org/Events/proceedings/CASA2009/Bao.pdf
    'speedOfSound': {type: 'number', default: 1498.0},
    'staticSceneAccuracy': {type: 'number', default: 2},
    'maxNumberOfPCISteps': {type: 'number', default: 1},
    'maxDensityErrorRatio': {type: 'number', default: 0.1},
    'negativePressureScale': {type: 'number', default: 0.0}
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
          thisFluidParams.postLoadInit();
        }
      });
    }
  },
  postLoadInit: function(thisFluidParams){
    //We might as well construct our buckets and things all the way down here, after the models have loaded.
    //Most of this stuff could probably be done inside of a web worker for increased speed.
    let kernalConstants = new KernalConstants(this.data.particleRadius);
    this.kernal = new Kernal(kernalConstants);
    this.particleConstants = new ParticleConstants(this.data.dragCoeficient, this.data.particleRadius, this.data.targetSpacing, this.data.particleDrawRadius, this.data.viscosity, this.data.targetDensity, this.data.gravity, this.kernal, this.data.localWindVelocity);
    let staticSceneConstants = new StaticSceneConstants();
    this.particleSystem = new ParticleSystem([2.5, 2.5, 3.0], [-2.5, -2.5, -0.5], this.particleConstants, this);
    this.el.emit('particle-system-constructed', {finished: true});
    this.staticScene = new StaticScene(this.particleSystem.bucketGrid, staticSceneConstants, this.data.staticSceneAccuracy);

    //Trigger the partitioning of our mesh into a set of intersectable point for easy searching
    //in each bucket.
    let staticGeometries = this.staticMeshes.geometries;
    let staticWorldMatrices = this.staticMeshes.worldMatrices;
    for(let i = 0, geometriesLength = staticGeometries.length; i < geometriesLength; i++){
      this.staticScene.addMesh(staticGeometries[i], staticWorldMatrices[i]);
    }
    this.staticScene.getFaceCollisionPoints();
    let collisionSurfaceHashedBuckets = this.staticScene.filterBucketsInsideVersesOutside();
    this.staticScene.attachMeshToBucketGrid(collisionSurfaceHashedBuckets);

    //
    //NOTE: For testing purposes only...
    //
    //let vectPoints = this.staticScene.searchablePoints.map(x => new THREE.Vector3(...x.position));
    //For testing purposes only...
    // this.el.emit('draw-points', {
    //   points: vectPoints,
    //   color: new THREE.Vector3(0.0,0.0,1.0)
    // });
    this.el.emit('static-mesh-constructed', {particleSystem: this.particleSystem});

    //
    //TODO: Replace this. For now, I'm just grabbing the curren box geometry, but I probably want
    //something a bit more dynamic in the future.
    //
    var fluidSystemId = this.el.id;
    this.currentFluidGeometries = document.querySelectorAll(`.fluid.${fluidSystemId}`);

    //Populate our initial particles
    //TODO: In the future this should be done by AI approximation to estimate what
    //we expect the system to look like.
    let fluidCollisionBound = new StaticScene(this.particleSystem.bucketGrid, staticSceneConstants, this.data.staticSceneAccuracy);
    for(let i = 0, numOfFluidGeometries = this.currentFluidGeometries.length; i < numOfFluidGeometries; i++){
      let fluidBufferGeometry = this.currentFluidGeometries[i].components.geometry.geometry;
      let worldMatrixOfFluidBufferGeometry = this.currentFluidGeometries[i].object3D.matrixWorld;
      fluidCollisionBound.addMesh(fluidBufferGeometry, worldMatrixOfFluidBufferGeometry);
    }
    fluidCollisionBound.getFaceCollisionPoints();
    let fluidSurfaceHashedBuckets = fluidCollisionBound.filterBucketsInsideVersesOutside();
    fluidCollisionBound.triggerDrawCollidedBuckets(fluidSurfaceHashedBuckets);

    //
    //NOTE: For testing purposes only
    //
    //let vectPoints2 = fluidCollisionBound.searchablePoints.map(x => new THREE.Vector3(...x.position));
    // this.el.emit('draw-points', {
    //   points: vectPoints2,
    //   color: new THREE.Vector3(1.0,0.0,1.0)
    // });

    let particleFiller = new ParticleFiller(this.particleSystem, collisionSurfaceHashedBuckets, this.staticScene, fluidSurfaceHashedBuckets, fluidCollisionBound);
    particleFiller.fillMesh(this.data.targetSpacing);

    //Unlike our static geometry above, we want to remove our geometries from the screen
    //just as soon as we've finished populating all of those particles.
    for(let i = 0, numOfFluidGeometries = this.currentFluidGeometries.length; i < numOfFluidGeometries; i++){
      let fluidBufferGeometry = this.currentFluidGeometries[i];
      fluidBufferGeometry.parentNode.removeChild(fluidBufferGeometry);
    }

    //During the first pass, let's initialize by determining the location of all neighboring particles.
    let particles = this.particleSystem.particles;
    for(let i = 0, numParticles = particles.length; i < numParticles; i++){
      particles[i].updateParticlesInNeighborhood();
    }

    //Set up our fluid solver which simulates fluid dynamics for our particles
    //mainly by calling accumulatePressureForce during the update process.
    this.interpolationEngine = new InterpolationEngine(this.particleSystem.bucketGrid, this.kernal, kernalConstants, 1000);
    let particleSolverContants = new ParticleSolverConstants(this.data.targetDensity, this.data.eosExponent, this.data.speedOfSound, this.data.negativePressureScale, this.data.viscosity, this.data.pseudoViscosityCoefficient, this.data.maxDensityErrorRatio, this.data.maxNumberOfPCISteps);
    this.pciSPHSystemSolver = new PCISPHSystemSolver(this.interpolationEngine, particleSolverContants, this.particleSystem);
    this.pciSPHSystemSolver.setDeltaConstant(this.data.pciTimeStep);
    this.particleSystem.setPCISystemSolver(this.pciSPHSystemSolver);

    //Trigger a call to track our particles over time if we want to.
    this.el.emit('draw-sph-test-particles', {
      particleSystem: this.particleSystem
    });

    self = this;
    this.avgRunningTime = 1000.0 / 60.0;
    this.timeTracker;
    this.el.sceneEl.addEventListener('set-frame-timer-references', this.setFrameTimerReferences);
    this.el.emit('get-frame-timer-references');
  },
  setFrameTimerReferences: function(data){
    self.timeTracker = data.detail.timeTracker;
    if(self.timeTracker){
      self.fluidParamsInitialized = true;
      self.el.removeEventListener('set-frame-timer-references', this.setFrameTimerReferences);
    }
  },
  tick: function (time, timeDelta) {
    //Wait until post load is completed before attempting to tick through our system.
    if(this.fluidParamsInitialized){
      //How long do we expect the current frame will last
      let estTimeIntervalInSeconds = Math.min(this.timeTracker.averageTickTime * 0.001, 0.07);

      //
      //Knowledge about this fluid section and the computational
      //limits of our system are used here to determine which solvers to implement.
      //
      let numSPISPHIterations = Math.ceil(estTimeIntervalInSeconds / this.data.pciTimeStep);
      numSPISPHIterations = numSPISPHIterations < 1 ? 1 : numSPISPHIterations;
      for(let i = 0; i < numSPISPHIterations; i++){
        //Gerstner Wave Solver

        //Heightmap Fluid Solver

        //SPH Fluid Solver
        this.particleSystem.updateParticles(this.data.pciTimeStep); //Update our neighbors list and densities
      }

      //
      //Purge any particles not in the particle system
      //

      //
      //Using information from the above, merge the results into
      //a mesh that represents the surface of the water.
      //

      //
      //Update shaders
      //

      //
      //Add new particles for the next iteration
      //

      //DONE :D
      this.tickOneComplete = true;
    }
    else if(this.tickerIterator % 5 === 0){
      //Retry every ten frames until someone picks up
      this.el.emit('get-frame-timer-references');
      this.tickerIterator = 1;
    }
    else{
      this.tickerIterator += 1;
    }
  },
  tock: function (time, timeDelta) {
    if(this.tickOneComplete){
      //
      //Combine Shader images and apply post processing.
      //
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
