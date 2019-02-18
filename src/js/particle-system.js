function ParticleSystem(upperCorner, lowerCorner, particleConstants, parentFluidParams){
  var thisParticleSystem = this;
  var parentFluidParams = parentFluidParams;
  this.parentFluidParams = parentFluidParams;
  this.upperCorner = upperCorner;
  this.lowerCorner = lowerCorner;
  this.particles = [];
  this.staticMesh = [];
  this.dynamicMesh = [];
  this.numberOfParticles = 0;
  this.maxParticleID = 0;
  this.PCISystemSolver;
  this.logs = {};

  //Basically, all of our particles are identical, so we calculate their universal values here and
  //then add this to every particle, allow it to reference the values through a point without redoing
  //the calculations, potentially a whole a bunch of times - even for internal functions that are called
  //countless times on every single particle.
  this.particleConstants = particleConstants;

  //Construct the bucket grid system to attach to this particle system so that we can track our particles,
  //as they're added, subtracted or moved. Not that we want our grid size equal to our particle radius.
  let bucketConstants = new BucketConstants(particleConstants.radius);
  this.bucketGrid = new BucketGrid(upperCorner, lowerCorner, particleConstants.radius, parentFluidParams.el.id, thisParticleSystem, bucketConstants);

  //TODO: In the future, we might automatically construct an optimal grid from a gltf mesh.
  //Or allow for several choices. For now, we're just providing an upper and lower corner and building the optimal grid from that.
  let lowerCornerX = lowerCorner[0];
  let lowerCornerY = lowerCorner[1];
  let lowerCornerZ = lowerCorner[2];
  let targetXDiff = upperCorner[0] - lowerCorner[0];
  let targetYDiff = upperCorner[1] - lowerCorner[1];
  let targetZDiff = upperCorner[2] - lowerCorner[2];
  //NOTE: We're choosing a bucket grid radius equal to the radius.
  let radius = particleConstants.radius;
  let boxesAlongX = Math.ceil(targetXDiff / radius);
  let boxesAlongY = Math.ceil(targetYDiff / radius);
  let boxesAlongZ = Math.ceil(targetZDiff / radius);
  lowerCornerX -= ((boxesAlongX * radius) - targetXDiff) * 0.5;
  lowerCornerY -= ((boxesAlongY * radius) - targetYDiff) * 0.5;
  lowerCornerZ -= ((boxesAlongZ * radius) - targetZDiff) * 0.5;

  //Main bucket construction loop.
  let upperBucketCornerX = lowerCornerX;
  for(let x = 1; x <= boxesAlongX; x++){
    upperBucketCornerX += radius;
    let upperBucketCornerY = lowerCornerY;
    for(let y = 1; y <= boxesAlongY; y++){
      upperBucketCornerY += radius;
      let upperBucketCornerZ = lowerCornerZ;
      for(let z = 1; z <= boxesAlongZ; z++){
        upperBucketCornerZ += radius;
        let upperBucketCorner = [upperBucketCornerX, upperBucketCornerY, upperBucketCornerZ];
        this.bucketGrid.addBucket(upperBucketCorner, radius);
      }
    }
  }
  this.bucketGrid.connectBuckets();
  //perfDebug.outputPerformanceResults();

  //Trigger an alert that our bucket system is now completed for our debugger. We can comment this out in the final release
  //once everything works.
  parentFluidParams.el.emit('bucket-grid-constructed', {particleSystem: this});
}

ParticleSystem.prototype.addParticles = function(positions, velocities){
  let particlePositionByHash = [];
  let particlesByHash = [];
  let bucketsWithPoints = [];

  //Grab each position/velocity and create a particle for it, hashing the results
  //into the above variables so they can be rapidly appended to their respective buckets.
  for(let i = 0, particlesLen = positions.length; i < particlesLen; i++){
    //Right now this starts off with no forces and no wind...
    //TODO: In the future, we might want to consider the impact of wind on our fluid.
    //NOTE: The default value for THREE.Vector3() is actually [0,0,0]
    let position = positions[i];
    let newParticle = new Particle(new THREE.Vector3(...position), new THREE.Vector3(...velocities[i]), new THREE.Vector3(), new THREE.Vector3(), this.maxParticleID, this.bucketGrid, this.particleConstants);

    //Find the bucket associated with this particle and add the particle to bucket
    let hash = this.bucketGrid.getHashKeyFromPosition(position);
    if(bucketsWithPoints.includes(hash)){
      particlePositionByHash[hash].push(position);
      particlesByHash[hash].push(newParticle);
    }
    else{
      particlePositionByHash[hash] = [];
      particlesByHash[hash] = [];
      particlePositionByHash[hash].push(position);
      particlesByHash[hash].push(newParticle);
      bucketsWithPoints.push(hash);
    }

    this.particles.push(newParticle);
    this.maxParticleID += 1;
  }

  //Add all of these points to the buckets
  //
  //NOTE: Not adding in links ot each of our particles for our point detector seems a bit
  //odd. It would seem to me, both for mid-section tracking and to update our particles,
  //We would either need to rebuild our hash from scratch, or we would need to pass a pointer,
  //to the particle inside so that each hash could be updated as needed.
  //
  for(let i = 0, numHashes = bucketsWithPoints.length; i < numHashes; i++){
    let hash = bucketsWithPoints[i];
    if(hash in this.bucketGrid.hashedBuckets){
      var bucket = this.bucketGrid.hashedBuckets[hash];
      bucket.addParticles(particlesByHash[hash]);
    }
  }

  //Flush all grids
  this.bucketGrid.flushPoints();
  this.numberOfParticles += positions.length;
};

ParticleSystem.prototype.cullParticles = function(){
  //For right now, we just kill all particles below -10m
  //
  //TODO: In the future we will want a more robust "Kill feature."
  //
  this.particles = this.particles.filter(function(particle){
    return particle.position.length() < 20.0;
  });

  //TODO: Remove particles from all of our bucket hashes
  this.numberOfParticles = this.particles.length;
};

ParticleSystem.prototype.setPCISystemSolver = function(system){
  this.PCISystemSolver = system;
}

ParticleSystem.prototype.updateParticles = function(timeIntervalInSeconds){
  //Update our neighbors list
  this.PCISystemSolver.interpolator.updateParticles();

  //Update our particle forces.
  this.PCISystemSolver.updateForces(timeIntervalInSeconds);

  //Implement time integration.
  for(let i = 0, particlesLen = this.particles.length; i < particlesLen; i++){
    let particle = this.particles[i];
    particle.updateVelocity(timeIntervalInSeconds);
    particle.updatePosition(timeIntervalInSeconds);

    //
    //NOTE: Until we have predictive schedualing for our particles, we need to update all particle hashes each time
    //their position updates
    //
  }
};

ParticleSystem.prototype.getNumberOfParticles = function(){
  return this.numberOfParticles;
};

ParticleSystem.prototype.getCenter = function(){
  let center = [];
  console.log(this.upperCorner);
  console.log(this.lowerCorner);
  for(let i = 0; i < 3; i++){
    center.push((this.upperCorner[i] + this.lowerCorner[i]) * 0.5);
  }

  return center;
}

//
//Debugging methods
//
ParticleSystem.prototype.printVector = function(vector){
  return `${vector.x}, ${vector.y}, ${vector.z}`;
};

ParticleSystem.prototype.logOnce = function(name, msg){
  if(this.logs[name] !== 'logged'){
    this.logs[name] = 'logged';
    console.log(msg);
  }
};

ParticleSystem.prototype.logNTimes = function(name, maxNumLogs, msg){
  if(this.logs[name] == null){
    this.logs[name] = 1;
    console.log(msg);
  }
  if(this.logs[name] <= maxNumLogs){
    this.logs[name] += 1;
    console.log(msg);
  }
};
