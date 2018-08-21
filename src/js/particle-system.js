function ParticleSystem(particles, forces, constraints, upperGridCoord, lowerGridCoord){
  var parentParticleSystem = this;
  this.particles = [];
  this.numberOfParticles = 0;
  this.maxParticleID = 0;
  const gravity = new THREE.Vector3(0.0, -9.81, 0.0);

  //Basically, all of our particles are identical, so we calculate their universal values here and
  //then add this to every particle, allow it to reference the values through a point without redoing
  //the calculations, potentially a whole a bunch of times - even for internal functions that are called
  //countless times on every single particle.
  this.universalParticleProperties = ParticleConstants(radius, dragCoefficient, mass);

  this.addParticles = function(positions, velocities){
    for(var i = 0; i < positions.length; i++){
      //Right now this starts off with no forces and no wind...
      //TODO: In the future, we might want to consider the impact of wind on our fluid.
      //NOTE: The default value for THREE.Vector3() is actually [0,0,0]
      var newParticle = new Particle(positions[i], velocities[i], new THREE.Vector3(), new THREE.Vector3(), this.maxParticleID, parentParticleSystem.universalParticleProperties);

      //Find the bucket associated with this particle and add the particle to bucket
      this.bucketGrid.addPoint(newParticle, 'position');
      parentParticleSystem.particles.push(newParticle);
      this.maxParticleID += 1;
    }
    parentParticleSystem.numberOfParticles += positions.length;
  };

  this.cullParticles = function(){
    //For right now, we just kill all particles below -10m
    //
    //TODO: In the future we will want a more robust "Kill feature."
    //
    parentParticleSystem.particles = parentParticleSystem.particles.filter(function(particle){
      return particle.position.length() < 20.0;
    });

    //TODO: Remove particles from all of our bucket hashes

    parentParticleSystem.numberOfParticles = parentParticleSystem.particles.length;
  };

  this.particleSolver = function(){
    //TODO: Complete this.
  };

  this.updateSolver = function(){
    //TODO: Complete this.
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

    for(var i = 0; i < parentParticleSystem.particles.length; i++){
      updateParticle(parentParticleSystem.particles[i]);
    }
  };

  this.resolveCollision = function(){
    //
    //TODO: For now, we're just going to collide with the floor with a damping function
    //TODO: to obsorb energy. In the future, we require a more robust collision engine.
    //
    const fractionOfVLost = 0.5;
    var particlesThatHitFloor = parentParticleSystem.particles.filter(
      function(particle){
        //Hit the floor and going down? Time to bounce.
        return (particle.position.y <= 0.0 && particle.velocity.y < 0.0);
      }
    );

    for(var i = 0; i < particlesThatHitFloor.length; i++){
      var particle = particlesThatHitFloor[i];
      var particleVelocityClone = particle.velocity.clone();
      var currentEnergy = 0.5 * particle.mass * particleVelocityClone.lengthSq();
      particle.velocity.y = -1.0 * particleVelocityClone.y * fractionOfVLost;
    }
  };

  this.getNumberOfParticles = function(){
    return parentParticleSystem.numberOfParticles;
  };

  //Debugging methods
  this.printVector = function(vector){
    return `${vector.x}, ${vector.y}, ${vector.z}`;
  };

  this.logs = {};
  this.logOnce = function(name, msg){
    if(parentParticleSystem.logs[name] !== 'logged'){
      parentParticleSystem.logs[name] = 'logged';
      console.log(msg);
    }
  };

  this.logNTimes = function(name, maxNumLogs, msg){
    if(parentParticleSystem.logs[name] == null){
      parentParticleSystem.logs[name] = 1;
      console.log(msg);
    }
    if(parentParticleSystem.logs[name] <= maxNumLogs){
      parentParticleSystem.logs[name] += 1;
      console.log(msg);
    }
  };
}
