// This loads the wasm generated glue code
self.importScripts('water-state-module.js');

//
//Return of global variables - because this is actually it's own little world
//and so anarcho-communism still works perfectly fine... for now.
//
var wasmModule;
var wasmIsReady = false;
var readyForSimulation = false;
var CPUID;
var numberOfParticles;
var positionPtrs = [];
var velocityPtrs = [];
var forcePtrs = [];
var bucketIDPtrs = [];
var transfferablePositions;
var transfferableVelocities;
var transfferableForces;
var transfferableBucketIds;

console.log("HELLO WEB WORKER!!!!");

//
//Replacing all of the above with one giant float buffer for easy modification
//
// const float32DataArray = new Float32Array(12 + 12 + 4 + 10);
// const uInt32DataArray = new Int32Array(5);
// var buffer;
Module['onRuntimeInitialized'] = function() {
  wasmIsReady = true;
  attemptInitializiation();
};

let attemptInitializiation = function(){
  if(wasmIsReady){
    Module._main();

    let input_array = new Float32Array([4.2, 3.5, 7.88, 8.91, 9.97, 1.1, 8.0]);
    let len = input_array.length;
    let input_ptr = Module._malloc(input_array.length * input_array.BYTES_PER_ELEMENT);
    let output_ptr = Module._malloc(input_array.length * input_array.BYTES_PER_ELEMENT);

    Module.HEAPF32.set(input_array, input_ptr / input_array.BYTES_PER_ELEMENT);

    Module._modifiyStateTest(input_ptr, output_ptr, input_array.length);

    // console.log(input_ptr);
    // console.log(output_ptr);
    input_array = new Float32Array(Module.HEAPF32.buffer, input_ptr, len);
    let output_array = new Float32Array(Module.HEAPF32.buffer, output_ptr, len);

    console.log("Start");

    for(let i = 0; i < input_array.length; i++){
      console.log("val " + i);
      console.log(input_array[i]);
      console.log(output_array[i]);
    }

    //Just for testing.
    console.log("End");
  }
};

var initializeWaterWorker(numberOfCPUs, numberOfParticlesByCPU, currentCPUID){
  CPUID = currentCPUID;
  let positionPtr;
  let velocityPtr;
  let forcePtr;
  for(let i = 0; i < numberOfCPUs; ++i){
    positionPtrs.push(Module._malloc(numberOfParticlesByCPU * Float32Array.BYTES_PER_ELEMENT));
    velocityPtrs.push(Module._malloc(numberOfParticlesByCPU * Float32Array.BYTES_PER_ELEMENT));
    forcePtrs.push(Module._malloc(numberOfParticlesByCPU * Float32Array.BYTES_PER_ELEMENT));
    bucketIDPtrs.push(Module._malloc(numberOfParticlesByCPU * Int32Array.BYTES_PER_ELEMENT);

    //But we only want to make to use the particles we are responcible for
    //as transferrable to other CPU cores.
    if(i === CPUID){
      numberOfParticles = numberOfParticlesByCPU[i];
      transfferablePositions = new Float32Array(numberOfParticlesByCPU[i]);
      transfferableVelocities = new Float32Array(numberOfParticlesByCPU[i]);
      transfferableForces = new Float32Array(numberOfParticlesByCPU[i]);
      transfferableBucketIds = new Int32Array(numberOfParticlesByCPU[i]);
    }
  }
}

var requestParticleList(particlePositions, particleVelocities, particleForces, particleBucketIds){
  transfferablePositions.from(Module.HEAPF32.buffer, positionPtrs[CPUID], numberOfParticles);
  transfferableVelocities.from(Module.HEAPF32.buffer, velocityPtrs[CPUID], numberOfParticles);
  transfferableForces.from(Module.HEAPF32.buffer, forcePtrs[CPUID], numberOfParticles);
  transfferableBucketIds.from(Module.HEAP32.buffer, bucketIDPtrs[CPUID], numberOfParticles);
}

var updateParticleState(cpuID, particlePositions, particleVelocities, particleForces, particleBucketIds){
  Module.HEAPF32.set(particlePositions, positionPtrs[cpuID] / Float32Array.BYTES_PER_ELEMENT);
  Module.HEAPF32.set(particleVelocities, velocityPtrs[cpuID] / Float32Array.BYTES_PER_ELEMENT);
  Module.HEAPF32.set(particleForces, forcePtrs[cpuID] / Float32Array.BYTES_PER_ELEMENT);
  Module.HEAP32.set(particleBucketIds, bucketIDPtrs[cpuID] / Int32Array.BYTES_PER_ELEMENT);
}

var runSimulation(){
  //This is the main deal, once our code is set up, we should run the simulation on our particles.
}

const EVENT_INITIALIZATION = 1;
const UPDATE_PARTICLE_LIST = 2;
const REQUEST_PARTICLE_LIST = 3;
const RUN_PCI_SPH_SIMULATION = 4;
var onmessage = function(e){
  let postObject = e.data;

  //These are listed in the order of expected frequency
  if(e.eventType === UPDATE_PARTICLE_LIST){
    //Each CPU passes their particle list to all the others to update the state
    //of all particles in the system.
    return true;
  }
  else if(e.eventType === REQUEST_PARTICLE_LIST){
    return true;
  }
  else if(e.eventType === RUN_PCI_SPH_SIMULATION){
    //Once we have all of our particle positions updated, we run through the PCI
    //SPH Simulation for all particles that this CPU is responcible for.
    return true;
  }
  else if(e.eventType === EVENT_INITIALIZATION){
    //Upon initializing our CPU, we need to inject all of our static geometry and
    //position all particles for the simulation.
    return true;
  }

  //else
  //console.error(`CPU ${CPUID}: Invalid Event Type: ${e.eventType}.`);
  return false;
};
