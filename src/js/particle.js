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
function ParticleConstants(dragCoefficient, particleRadius, viscosityCoeficient, interpolator){
  ////
  //PARTICLE CONSTANTS
  ////
  this.radius = particleRadius; //The radius is interpreted as the target target spacing
  this.oneOverRadiusSquared = 1.0 / (particleRadius * particleRadius);
  this.targetSpacing = particleRadius;
  this.dragCoefficient = dragCoefficient;

  //Calculate the mass from our target density and target spacing
  //We're constructing a grid of particles in a cubic grid in order
  //to estimate our delta to avoid errors associated with low density particles.
  //This seems like an excellent method to improve in the future for situations
  //that involve complicated geometries.
  let points = [];
  let sampleBoxLength = 1.5 * particleRadius;
  let halfSpacing = particleRadius * 0.5;
  let numIters = Math.ceil(halfSpacing / sampleBoxLength);
  let hasOffset = false;
  let x = 0.0;
  let y = 0.0;
  let z = 0.0;

  //As this is just used for a constant, we can set the lower corner to 0.0
  //and because it's square we can keep all the interations equal.
  //Also, because we're doing a sample we don't need to do all of them
  //and we will never break early.
  for(let i = 0; i <= numIters; i++){
    y += halfSpacing;
    let halfSpacingPlusOffset = halfSpacing + (hasOffset ? halfSpacing : 0.0);
    for(let j = 0; j <= numIters; j++){
      z += halfSpacingPlusOffset;
      for(let k = 0; k <= numIters; k++){
        x += halfSpacingPlusOffset;
      }
    }
    hasOffset = !hasOffset;
  }
  points.push(new THREE.Vector3(x, y, z));

  let maxNumberDensity = 0.0;
  for(let i = 0; i < points.length; i++){
    let sum = 0.0;
    for(let j = 0; j < points.length; j++){
      let distance2Point = points[i].distanceTo(points[j]);
      interpolator.evalFKernalState(distance2Point);
      sum += interpolator.evalFMullerKernal(distance2Point);
    }

    maxNumberDensity = Math.max(maxNumberDensity, sum);
  }

  this.mass = targetDensity / maxNumberDensity;
  this.inverseOfMass = 1.0 / mass;
  this.massSquared = mass * mass;
  this.viscocityCoeficient = viscosityCoeficient;
  this.viscosityCoefficientTimesMassSquared = viscocityCoeficient * this.massSquared;
}
