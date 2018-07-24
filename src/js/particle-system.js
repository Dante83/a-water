function ParticleSystem(particles, forces, constraints){
  var self = this;
  this.particles = [];
  this.numberOfParticles = 0;
  const gravity = new THREE.Vector3(0.0, -9.81, 0.0);

  this.addParticles = function(positions, velocities){
    for(var i = 0; i < positions.length; i++){
      //Right now this starts off with no forces and no wind...
      //TODO: In the future, we might want to consider the impact of wind on our fluid.
      //NOTE: The default value for THREE.Vector3() is actually [0,0,0]
      self.particles.push(new Particle(positions[i], velocities[i], new THREE.Vector3(), new THREE.Vector3()));
    }
    self.numberOfParticles += positions.length;
  };

  this.cullParticles = function(){
    //For right now, we just kill all particles below -10m
    //
    //TODO: In the future we will want a more robust "Kill feature."
    //
    self.particles = self.particles.filter(function(particle){
      return particle.position.length() < 20.0;
    });
    self.numberOfParticles = self.particles.length;
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

      particle.force.add(netForces);

      //
      //Time Integration
      //
      particle.updateVelocity(deltaT);
      particle.updatePosition(deltaT);
      self.logNTimes('particleState', 10, particle);
    }

    //
    //TODO: We might want to run this in parrallel, but for now, just run through and update each of our particles.
    //
    for(var i = 0; i < self.particles.length; i++){
      var particle = self.particles[i];
      updateParticle(particle);
    }
  };

  this.resolveCollision = function(){
    //
    //TODO: For now, we're just going to collide with the floor with a damping function
    //TODO: to obsorb energy. In the future, we require a more robust collision engine.
    //
    const fractionOfVLost = 0.5;
    var particlesThatHitFloor = self.particles.filter(
      function(particle){
        //Hit the floor and going down? Time to bounce.
        return (particle.position.y <= 0.0 && particle.velocity.y < 0.0);
      }
    );

    for(var i = 0; i < particlesThatHitFloor; i++){
      var particle = particlesThatHitFloor[i];
      var currentEnergy = 0.5 * particle.mass * particle.velocity.lengthSq();
      particle.velocity.y = -1.0 * particle.velocity.y * fractionOfVLost;
       //We're just going to take a chunk of this velocity every time even though this is probably inaccurate.
      particle.velocity.multiplyScalar(fractionOfVLost);
    }
  };

  this.getNumberOfParticles = function(){
    return self.numberOfParticles;
  };

  //Debugging methods
  this.printVector = function(vector){
    return `${vector.x}, ${vector.y}, ${vector.z}`;
  };

  this.logs = {};
  this.logOnce = function(name, msg){
    if(self.logs[name] !== 'logged'){
      self.logs[name] = 'logged';
      console.log(msg);
    }
  };

  this.logNTimes = function(name, maxNumLogs, msg){
    if(self.logs[name] == null){
      self.logs[name] = 1;
      console.log(msg);
    }
    if(self.logs[name] <= maxNumLogs){
      self.logs[name] += 1;
      console.log(msg);
    }
  };
}
