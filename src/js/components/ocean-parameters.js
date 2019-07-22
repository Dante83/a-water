//The party responcible for updating our view of the fluid system
var globalOceanRenderer = new OceanRenderer();
AFRAME.registerComponent('ocean-parameters', {
  oceanGrid: null,
  oceanRenderer: null,
  oceanCollider: null,
  schema: {
    'activeWidth': {type: 'number', default: 1000.0},
    'activeHeight': {type: 'number', default: 1000.0},
    'patchWidth': {type: 'number', default: 10.0},
    'maxSubdivisions': {type: 'number', default: 32},
    'defaultDepth': {type: 'number', default: -1.0},
    'regionOffset': {type: 'vec2', default: {x: 0.0, y: 0.0},
    'windSpeed': {type: 'vec2', default: {x: 0.0, y: 0.0},
    'collisionMeshID': {type: 'string', default: null},
    'fillStart': {type: vec2, default: {x: 0.0,y: 0.0}}
  },
  init: function(){
    //Set up our ocean grid
    this.oceanGrid = new OceanGrid(this.data);
    globalOceanRenderer.oceanGrids.push(this.oceanGrid);
    if(this.data.defaultDepth !== -1.0){
      if(globalOceanRenderer.defaultDepth !== 1000.0 && this.data.defaultDepth !== globalOceanRenderer.defaultDepth){
        console.warning(`Default depth changed from ${globalOceanRenderer.defaultDepth}m to ${this.data.defaultDepth}m.`);
      }
      globalOceanRenderer.defaultDepth = this.data.defaultDepth;
    }

    //Grab the physics mesh used to tell the height of our ocean waves
    const oceanColliders = document.querySelectorAll(`#${this.data.collisionMeshID}`);
    oceanColliders.addEventListener('model-loaded', function (gltf){
      let object3D = gltf.target.object3D;
      let matrixWorld = object3D.matrixWorld;
      let model = gltf.detail.model;

      model.traverse(function(child){
        if (child.isMesh) {
          //Only one mesh allowed per ocean collider
          oceanCollider.worldMatrix = child.matrixWorld;
          oceanCollider.geometry = child.geometry;

          //Once our model is loaded in, we can then proceed with addition callbacks
          this.oceanGrid.setupOcean(oceanCollider);
          return false;
        }
      });
    });
  },
  tick: function(time, timeDelta){
    //Update the time parameter of our ocean patches
    this.oceanGrid.updateTime(time);

    //Update what our current view is based on whether or not the camera is currently
    //above or below the ocean waves.

  }
}
