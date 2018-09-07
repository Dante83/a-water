function ParticleFiller(bucketHasher){
  //
  //NOTE: We want to construct this after we have both the particle system,
  //and the static environment set up. Particles will then be added into the system,
  //such that they fill in the space between those particles and then forces will
  //be minimized.
  //
  this.particles = [];
  this.targetDensity;
  this.parentParticleSystem;
  this.staticMesh;
  this.particleFillerMesh;
  this.bucketHasherDimensions;
  this.intersectionMesh;

  this.constructInstersectionMesh = function(){
    //Clone the static scene

    //Add the outer faces of the bucket grid to this static scene
    //Anything that falls within this static scene is fair game, anything outside is not.

    //Callback...
    this.fillMesh();
  }

  this.fillMesh = function(){
    //Use the density function to add particles to the mesh using a hexagonal packing structure.
    //this should be fairly stable, but the instabilities of the system might need to be worked out.


    //Callback...
    this.zeroOutForces();
  }

  this.zeroOutForces = function(){
    //
    //NOTE: We'll worry about this later.
    //
    //Iterate our particles multiple times through a solver, with variable positions,
    //with the objective of minimizing the forces while staying inside of the box.

    //Flush all the particles to the system.
    this.particleSystem.addParticles();
  }
}
