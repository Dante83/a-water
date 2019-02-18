function Particle(position, velocity, force, windVelocity, id, bucketGrid, constants){
  this.constants = constants;
  this.position = position;
  this.lastPosition = position;
  this.previousPosition = position; //In the event that we ever find ourselves inside of a bucket, we can use this to bounce out.
  this.velocity = velocity;
  this.force = force;
  this.id = id;
  this.bucketGrid = bucketGrid;
  this.bucket;
  this.lastBucket;
  this.windResistanceForce = new THREE.Vector3(0.0,0.0,0.0);
  this.density = 0.0;
  this.inverseDensity = 0.0;
  this.inverseDensitySquared = 0.0;
  this.pressure = 0.0;
  this.pressureForce = new THREE.Vector3(0.0,0.0,0.0);
  this.viscocityForce = new THREE.Vector3(0.0,0.0,0.0);
  this.particlesInNeighborhood;
  this.mullerSpikyKernalFirstDerivative = [];
  this.mullerSpikyKernalSecondDerivative = [];
}

Particle.prototype.cloneToPCITemp = function(){
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
  this.particlesInNeighborhood = this.bucketGrid.findPointsInSphere(this.position, this.constants.radius, this.id);
}

//Particles are created numerous times, but there's no duplicating code that's just used for stuff
//over and over again, so we're just going to use pointers to the same propertives over and over instead.
function ParticleConstants(dragCoefficient, influenceRadius, targetSpacing, drawRadius, viscosityCoeficient, targetDensity, gravity, kernal, localWindVelocity){
  ////
  //PARTICLE CONSTANTS
  ////
  this.drawRadius = drawRadius;
  this.radius = influenceRadius;
  this.radiusSquared = this.radius * this.radius;
  this.inverseRadius = 1.0 / influenceRadius;
  this.oneOverRadiusSquared = this.inverseRadius * this.inverseRadius;
  this.targetSpacing = targetSpacing;
  this.localWindVelocity = localWindVelocity;
  this.dragCoefficient = dragCoefficient;

  //Calculate the mass from our target density and target spacing
  //We're constructing a grid of particles in a cubic grid in order
  //to estimate our delta to avoid errors associated with low density particles.
  //This seems like an excellent method to improve in the future for situations
  //that involve complicated geometries.
  let points = [];
  let sampleBoxLength = 3.0 * influenceRadius;
  let halfSpacing = targetSpacing * 0.5;
  let hasOffset = false;
  let initalLoc = -1.5 * influenceRadius;
  let z = initalLoc;
  let y;
  let x;
  let maxZNumIterations = Math.floor((3.0 * influenceRadius) / halfSpacing);
  let maxXYNumIterationsWHasOffset = Math.floor((sampleBoxLength - halfSpacing) / targetSpacing);
  let maxXYNumIterationsWOHasOffset = Math.floor((sampleBoxLength) / targetSpacing);

  //As this is just used for a constant, we can set the lower corner to 0.0
  //and because it's square we can keep all the interations equal.
  //Also, because we're doing a sample we don't need to do all of them
  //and we will never break early.
  let offset;
  let maxXYNumIterations;
  for(let i = 0; i <= maxZNumIterations; i++){
    z += halfSpacing;
    if(hasOffset){
      offset = halfSpacing;
      maxXYNumIterations = maxXYNumIterationsWHasOffset;
    }
    else{
      offset = 0.0;
      maxXYNumIterations = maxXYNumIterationsWOHasOffset;
    }
    y = initalLoc + offset;
    for(let j = 0; j < maxXYNumIterations; j++){
      y += targetSpacing;
      x = initalLoc + offset;
      for(let k = 0; k < maxXYNumIterations; k++){
        x += targetSpacing;
        points.push(new THREE.Vector3(x, y, z));
      }
    }

    hasOffset = !hasOffset;
  }

  let maxKernalVal = 0.0;
  for(let i = 0; i < points.length; i++){
    let sum = 0.0;
    for(let j = 0; j < points.length; j++){
      let distance2PointSquared = points[i].distanceToSquared(points[j]);
      sum += kernal.getMullerKernal(distance2PointSquared);
    }

    maxKernalVal = Math.max(maxKernalVal, sum);
  }

  this.targetDensity = targetDensity;
  //This mass is in line with the result from Kelager (2006)
  //mass= (targetDensity * volume) / numParticles
  //https://nccastaff.bournemouth.ac.uk/jmacey/MastersProjects/MSc15/06Burak/BurakErtekinMScThesis.pdf
  //They differ by about 7% in my tests.
  this.mass = targetDensity / maxKernalVal;
  let gravityVector = new THREE.Vector3(gravity.x, gravity.y, gravity.z);
  this.gravitationalForce = gravityVector.clone().multiplyScalar(this.mass);
  this.inverseOfMass = 1.0 / this.mass;
  this.massSquared = this.mass * this.mass;
  this.viscocityCoeficient = viscosityCoeficient;
  this.viscosityCoefficientTimesMassSquared = viscosityCoeficient * this.massSquared;
}
