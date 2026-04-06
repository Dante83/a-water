AWater.AOcean.OceanPatch = function(parentOceanGrid, initialPosition, instanceMeshRef, instanceID, ringIndex){
  const scene = parentOceanGrid.scene;
  this.initialPosition = initialPosition;
  this.position = new THREE.Vector3();
  this.parentOceanGrid = parentOceanGrid;
  this.instanceMeshRef = instanceMeshRef;
  this.instanceID = instanceID;
  this.ringIndex = ringIndex;
}
