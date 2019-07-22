function OceanPatch(depths, windVelocities, distanceFromCamera){
  this.activeLOD = 3;
  this.lod = new THREE.LOD();
  this.materials = [null, null, null, null];
  this.meshes = [null, null, null, null, null, ];
  this.heightMap;
  this.windVelocities = new THREE.Vector2();
  this.activePatch;
  this.activeMaterial;

  //Set up each of our mesh and materials
  for(let i = 0; i < 4; i++){
    this.meshes[i] = new THREE.PlaneBufferGeometry(width : Float, height : Float, widthSegments : Integer, heightSegments : Integer);
  }

  this.initialize(){

  }

  this.update(timeDelta){
    //Update the time delta
  }
}
