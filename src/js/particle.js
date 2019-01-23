function Particle(position, velocity, force, windVelocity, id, bucketGrid, constants){
  this.constants = constants;
  this.position = position;
  this.previousPosition = position; //In the event that we ever find ourselves inside of a bucket, we can use this to bounce out.
  this.velocity = velocity;
  this.force = force;
  this.id = id;
  this.bucketGrid = bucketGrid;
  this.bucket;
  this.localWindVelocity = windVelocity;
  this.windResistanceForce = new THREE.Vector3(0.0,0.0,0.0);
  this.density = 0.0;
  this.inverseDensity;
  this.inverseDensitySquared;
  this.pressure;
  this.pressureForce = new THREE.Vector3(0.0,0.0,0.0);
  this.viscocityForce = new THREE.Vector3(0.0,0.0,0.0);
  this.particlesInNeighborhood;
}

Particle.cloneToPCITemp = function(){
  return {
    velocity: this.velocity.clone(),
    position: this.position.clone(),
    pressureForce: this.pressureForce.clone()
  };
}

Particle.prototype.updateVelocity = function(deltaT){
  let x = this.force.clone();
  x.multiplyScalar(deltaT * this.constants.inverseOfMass);
  this.velocity.add(x);
}

Particle.prototype.updatePosition = function(deltaT){
  let x = this.velocity.clone();
  let y = this.position.clone();
  this.position = y.add(x.multiplyScalar(deltaT));
}

Particle.prototype.updateParticlesInNeighborhood = function(){
  this.particlesInNeighborhood = this.bucketGrid.findPointsInSphere(this.position, this.radius);
}

//Particles are created numerous times, but there's no duplicating code that's just used for stuff
//over and over again, so we're just going to use pointers to the same propertives over and over instead.
function ParticleConstants(dragCoefficient, targetDensity, targetSpacing, viscosityCoeficient){
  //
  //NOTE: Come back here and check for stuff like calculating our target mass from density and radius.
  //

  ////
  //PARTICLE CONSTANTS
  ////
  this.radius = targetSpacing; //The radius is interpreted as the target target spacing
  this.oneOverRadiusSquared = 1.0 / (this.radius * this.radius);
  this.targetSpacing = targetSpacing;
  this.dragCoefficient = dragCoefficient;

  //Calculate the mass from our target density and target spacing
  this.mass = mass;
  this.inverseOfMass = 1.0 / mass;
  this.massSquared = mass * mass;
  this.viscocityCoeficient = viscosityCoeficient;
  this.viscosityCoefficientTimesMassSquared = viscocityCoeficient * this.massSquared;
}
