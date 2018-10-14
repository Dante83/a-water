function ParticleFiller(bucketHasher, staticMesh){
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

  this.fillMesh = function(){
    //TODO: Get the intersection of the two meshes in order to reduce the amount of space spent creating fluids.

    //Create a new static mesh from this mesh.

    //In the future, we probably want a random walk method, but for now...
    //Just walk through each bucket. If colliding with the static mesh for this object, but
    //is also inside the other static mesh, then keep the particle. Otherwise, dispose of it.

  }
}
