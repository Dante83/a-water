//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('a-fluid', {
  fractionalSeconds: 0,
  dependencies: [],
  fluidParticles: [],
  schema: {
  },
  init: function(){
    this.initializationTime = new Date();
    this.currentTime = new Date();

    //Get all constraints.

    //NOTE: variable color properties will likely be the object of hte future
    //and in fact, we will probably draw a mesh around our points rather than
    //just drawing out the original particles themselves.
    //Come up with our basic particle color qualities
    this.geometry = new THREE.SphereGeometry( 0.1, 4, 4);
    this.material = new THREE.MeshBasicMaterial( {color: this.getRandomColor()} );
    this.numberOfParticles = 0;
    this.nextParticleTriggerTime = 0;

    //Create a particle system
    this.particleSystem = new ParticleSystem();
  },
  tick: function (time, timeDelta) {
    // Do something on every scene tick or frame.
    this.currentTime.setTime(this.initializationTime.getTime() + time);

    //NOTE: This is just a temporary function while we're learning.
    //We're just going to randomly add new particles into the system at the location, with
    //the provided velocity and a random x and y velocity, approximately once every tenth of a second.
    if(time > this.nextParticleTriggerTime){
      this.particleSystem.cullParticles();
      var startPosition = new THREE.Vector3(0.0,10.0,0.0);
      var spreadV = 0.0;
      var startingVelocity = new THREE.Vector3(Math.random(), 10.0 + Math.random() * 2.0, Math.random());
      this.particleSystem.addParticles([startPosition], [startingVelocity]);
      this.nextParticleTriggerTime += 1000;
    }

    //
    //NOTE: For now, we are simply using hard spheres to simulate our particles
    //In the future, we probably don't want a sphere at all, but just a surface rendered in
    //The glsl, given a massive series of points.
    //
    var diff = this.particleSystem.getNumberOfParticles() - this.numberOfParticles
    if(diff > 0){
      for(var i = this.numberOfParticles; i < (this.numberOfParticles + diff); i++){
        //If new particles are added to the system
        var sphere = new THREE.Mesh(new THREE.SphereGeometry( 0.1, 4, 4), new THREE.MeshBasicMaterial( {color: this.getRandomColor()} ));
        sphere.name = `a-fluid-${i}`;
        var sceneRef = this.el.sceneEl.object3D;
        sceneRef.add(sphere);
        this.fluidParticles.push(sphere);
      }
    }
    else if(diff < 0){
      for(var i = this.numberOfParticles; i > (this.numberOfParticles - diff); i--){
        //If new old particles are being removed from the system
        var sphere = this.fluidParticles.pop();
        this.el.sceneEl.object3D.remove(sphere.name);
      }
    }
    //Reset the number of particles so that all of this makes sense
    this.numberOfParticles += diff;

    //Implement our fluid solver
    this.particleSystem.updateParticles(timeDelta / 1000.0);

    //Move each of our particles to it's new position
    //NOTE: We might want to do this in the future using a parallel for loop
    for(var i = 0; i < this.numberOfParticles; i++){
      var partPos = this.particleSystem.particles[i].position;
      var drawPos = this.fluidParticles[i].position.set(partPos.x, partPos.y, partPos.z);
    }
  },
  getRandomColor() {
    var letters = '0123456789ABCDEF';
    var color = '#';
    for (var i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  },
  logNTimes: function(name, maxNumLogs, msg){
    if(self.logs[name] == null){
      self.logs[name] = 1;
      console.log(msg);
    }
    if(self.logs[name] <= maxNumLogs){
      self.logs[name] += 1;
      console.log(msg);
    }
  }
});
