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
  const gravity = new THREE.Vector3(0.0, -9.81, 0.0);

  //Basically, all of our particles are identical, so we calculate their universal values here and
  //then add this to every particle, allow it to reference the values through a point without redoing
  //the calculations, potentially a whole a bunch of times - even for internal functions that are called
  //countless times on every single particle.
  this.particleConstants = particleConstants;

  //Construct the bucket grid system to attach to this particle system so that we can track our particles,
  //as they're added, subtracted or moved. Not that we want our grid size equal to our particle radius.
  let bucketConstants = new BucketConstants();
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

  this.addParticles = function(positions, velocities){
    let pointsByHash = [];
    let particlesByHash = [];
    let bucketsWithPoints = [];

    //Sort our particles being added by hash
    for(let i = 0, particlesLen = positions.length; i < particlesLen; i++){
      //Right now this starts off with no forces and no wind...
      //TODO: In the future, we might want to consider the impact of wind on our fluid.
      //NOTE: The default value for THREE.Vector3() is actually [0,0,0]
      let position = positions[i];
      let newParticle = new Particle(position, velocities[i], new THREE.Vector3(), new THREE.Vector3(), this.maxParticleID, this.bucketGrid, thisParticleSystem.particleConstants);

      //Find the bucket associated with this particle and add the particle to bucket
      let hash = this.bucketGrid.getHashKeyFromPosition(position);
      if(bucketsWithPoints.includes(hash)){
        pointsByHash[hash].push(position);
        particlesByHash[hash].push(newParticle);
      }
      else{
        pointsByHash[hash] = [];
        particlesByHash[hash] = [];
        pointsByHash[hash].push(position);
        particlesByHash[hash].push(newParticle);
        bucketsWithPoints.push(hash);
      }

      thisParticleSystem.particles.push(newParticle);
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
        let bucket = this.bucketGrid.hashedBuckets[hash];
        bucket.addPoints(pointsByHash[hash]);
      }
    }

    //Flush all grids
    this.bucketGrid.flush();

    thisParticleSystem.numberOfParticles += positions.length;
  };

  this.cullParticles = function(){
    //For right now, we just kill all particles below -10m
    //
    //TODO: In the future we will want a more robust "Kill feature."
    //
    thisParticleSystem.particles = thisParticleSystem.particles.filter(function(particle){
      return particle.position.length() < 20.0;
    });

    //TODO: Remove particles from all of our bucket hashes

    thisParticleSystem.numberOfParticles = thisParticleSystem.particles.length;
  };

  this.updateParticles = function(deltaT){
    //Our function for summing up the forces, which we will implement in parallel.
    var updateParticle = function(particle){
      //
      //Update Forces
      //
      var gravitationalForce = gravity.clone().multiplyScalar(particle.mass);
      var windResistanceForce = particle.velocity.clone().add(particle.localWindVelocity.negate()).multiplyScalar(particle.dragCoefficient);
      var netForces = gravitationalForce.add(windResistanceForce.negate());

      particle.force = netForces;

      //
      //Time Integration
      //
      particle.updateVelocity(deltaT);
      particle.updatePosition(deltaT);

      //
      //NOTE: Until we have predictive schedualing for our particles, we need to update all particle hashes each time
      //their position updates
      //
    }

    for(let i = 0, particlesLen = this.particles.length; i < particlesLen; i++){
      updateParticle(thisParticleSystem.particles[i]);
    }
  };

  this.resolveCollision = function(){
    //
    //TODO: For now, we're just going to collide with the floor with a damping function
    //TODO: to obsorb energy. In the future, we require a more robust collision engine.
    //
    const fractionOfVLost = 0.5;
    let particlesThatHitFloor = thisParticleSystem.particles.filter(
      function(particle){
        //Hit the floor and going down? Time to bounce.
        return (particle.position.y <= 0.0 && particle.velocity.y < 0.0);
      }
    );

    const particleMass = particle.mass;
    for(let i = 0, particlesThatHitTheFloorLen = particlesThatHitFloor.length; i < particlesThatHitTheFloorLen; i++){
      let particle = particlesThatHitFloor[i];
      let particleVelocityClone = particle.velocity.clone();
      let currentEnergy = 0.5 * particleMass * particleVelocityClone.lengthSq();
      particle.velocity.y = -1.0 * particleVelocityClone.y * fractionOfVLost;
    }
  };

  this.getNumberOfParticles = function(){
    return thisParticleSystem.numberOfParticles;
  };

  //Debugging methods
  this.printVector = function(vector){
    return `${vector.x}, ${vector.y}, ${vector.z}`;
  };

  this.logs = {};
  this.logOnce = function(name, msg){
    if(thisParticleSystem.logs[name] !== 'logged'){
      thisParticleSystem.logs[name] = 'logged';
      console.log(msg);
    }
  };

  this.logNTimes = function(name, maxNumLogs, msg){
    if(thisParticleSystem.logs[name] == null){
      thisParticleSystem.logs[name] = 1;
      console.log(msg);
    }
    if(thisParticleSystem.logs[name] <= maxNumLogs){
      thisParticleSystem.logs[name] += 1;
      console.log(msg);
    }
  };
}

ParticleSystem.prototype.getCenter = function(){
  let center = [];
  console.log(this.upperCorner);
  console.log(this.lowerCorner);
  for(let i = 0; i < 3; i++){
    center.push((this.upperCorner[i] + this.lowerCorner[i]) * 0.5);
  }

  return center;
}
