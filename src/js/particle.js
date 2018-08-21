function Particle(position, velocity, force, windVelocity, id,  bucketGrids, radius, constants){
  this.position = position;
  this.velocity = velocity;
  this.force = force;
  this.id = id;
  this.bucketGrids = bucketGrids;
  this.particlesInNeighborHood = [];
  this.localWindVelocity = windVelocity;
  this.constants = constants;

  //
  //TODO: Make a neighborhood predictor that determines the number of time steps before a particle
  //leaves the neighborhood of this particle, and also a double radius checkpoint that estimates when particles in
  //that zone are likely to enter the inner radius and when we need to update the outer radius
  //

  //NOTE: I have a feeling this is using Euler's method to solve our
  //position and velocity equations. I am pretty sure we can do better
  //than this using RK4 or perhaps even FEM or SEM.
  this.updateVelocity = function(deltaT){
    var x = this.force.clone();
    x.multiplyScalar(deltaT * this.constants.inverseOfMass);
    this.velocity.add(x);
  };

  this.updatePosition = function(deltaT){
    var x = this.velocity.clone();
    var y = this.position.clone();
    this.position = y.add(x.multiplyScalar(deltaT));
  };

  //
  //Interpolated quantities for SPH
  //
  //
  //TODO: Return here.
  //
  this.density = null;
  this.updateQuantities(){

  }
}

//Particles are created numerous times, but there's no duplicating code that's just used for stuff
//over and over again, so we're just going to use pointers to the same propertives over and over instead.
function ParticleConstants(radius, dragCoefficient, mass){
  ////
  //PARTICLE CONSTANTS
  ////
  this.radius = radius;
  this.dragCoefficient = dragCoefficient;
  this.mass = mass;
  this.inverseOfMass = 1.0 / this.mass;
}
