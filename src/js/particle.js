function Particle(position, velocity, force, windVelocity){
  this.position = position;
  this.velocity = velocity;
  this.force = force;
  this.localWindVelocity = windVelocity;
  this.dragCoefficient = 1E-4;
  this.mass = 1.0;
  var self = this;

  //NOTE: I have a feeling this is using Euler's method to solve our
  //position and velocity equations. I am pretty sure we can do better
  //than this using RK4 or perhaps even FEM or SEM.
  this.updateVelocity = function(deltaT){
    self.velocity = self.velocity.add(self.force.multiplyScalar(deltaT / this.mass));
  };

  this.updatePosition = function(deltaT){
    self.position = self.position.add(self.velocity.multiplyScalar(deltaT));
  };
}
