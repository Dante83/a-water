function ParticleSystem(upperCorner, lowerCorner, particleConstants, parentFluidParams){
  var thisParticleSystem = this;
  var parentFluidParams = parentFluidParams;
  this.upperCorner = upperCorner;
  this.lowerCorner = lowerCorner;
  this.particles = [];
  this.staticMesh = [];
  this.dynamicMesh = [];
  this.numberOfParticles = 0;
  this.maxParticleID = 0;
  const gravity = new THREE.Vector3(0.0, -9.81, 0.0);

  //Construct the bucket grid system to attach to this particle system so that we can track our particles,
  //as they're added, subtracted or moved. Not that we want our grid size equal to our particle radius.
  this.bucketGrid = new BucketGrid(particleConstants.radius, parentFluidParams.el.id, thisParticleSystem);

  //Basically, all of our particles are identical, so we calculate their universal values here and
  //then add this to every particle, allow it to reference the values through a point without redoing
  //the calculations, potentially a whole a bunch of times - even for internal functions that are called
  //countless times on every single particle.
  this.universalParticleProperties = particleConstants;

  this.addParticles = function(positions, velocities){
    for(let i = 0, particlesLen = positions.length; i < particlesLen; i++){
      //Right now this starts off with no forces and no wind...
      //TODO: In the future, we might want to consider the impact of wind on our fluid.
      //NOTE: The default value for THREE.Vector3() is actually [0,0,0]
      var newParticle = new Particle(positions[i], velocities[i], new THREE.Vector3(), new THREE.Vector3(), this.maxParticleID, thisParticleSystem.universalParticleProperties);

      //Find the bucket associated with this particle and add the particle to bucket
      this.bucketGrid.addPoint(newParticle, 'position');
      thisParticleSystem.particles.push(newParticle);
      this.maxParticleID += 1;
    }
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
