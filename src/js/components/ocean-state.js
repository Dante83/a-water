//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('ocean_state', {
  oceanGrid: null,
  oceanRenderer: null,
  staticMeshes: null,
  isMeshLoaded: false,
  schema: {
    'draw_distance': {type: 'number', default: 64.0},
    'patch_size': {type: 'number', default: 16.0},
    'patch_data_size': {type: 'number', default: 512},
    'number_of_octaves': {type: 'number', default: 512},
    'wind_velocity': {type: 'vec2', default: {x: 26.0, y: 0.0}},
    'default_water_depth': {type: 'number', default: 100.0},
    'surface_mesh_class': {type: 'string', default: 'static-ocean-collider'}
  },
  init: function(){
    this.loaded = false;
    this.staticMeshes = {
      geometries: [],
      worldMatrices: []
    };

    //Get all static assets loaded so we can attach them to the upcoming static scene that we will attach them all to
    const fluidSystemId = this.el.id;
    const staticColliders = document.querySelectorAll(`.${this.data.surface_mesh_class}`);
    this.staticCollidersAwaitingLoading = [];
    for(let i = 0, staticCollidersLen = staticColliders.length; i < staticCollidersLen; i++){
      this.staticCollidersAwaitingLoading[staticColliders[i].object3D.uuid] = false;
    }

    //Traverse the mesh objects passed over
    let self = this;
    for(let i = 0, staticCollidersLen = staticColliders.length; i < staticCollidersLen; i++){
      let staticCollider = staticColliders[i];

      //If not, load it.
      staticCollider.addEventListener('model-loaded', function (gltf) {
        let object3D = gltf.target.object3D;
        self.staticCollidersAwaitingLoading[object3D.uuid] = true;
        let matrixWorld = object3D.matrixWorld;
        let model = gltf.detail.model;

        model.traverse(function(child){
          if (child.isMesh) {
            self.staticMeshes.worldMatrices.push(child.matrixWorld);
            self.staticMeshes.geometries.push(child.geometry);
          }
        });

        //Check if alls models were added, if so, it's time for this entity to start rocking and rolling
        let allMeshesParsed = true;
        for(let status in thisFluidParams.staticCollidersAwaitingLoading){
          if(status === false){
            allMeshesParsed = false;
            break;
          }
        }
        if(allMeshesParsed){
          self.postLoadInit();
        }
      });
    }

    if(staticColliders.length === 0){
      self.postLoadInit();
    }
  },
  postLoadInit: function(){
    //Get our renderer to pass in
    let renderer = this.el.sceneEl.renderer;
    let scene = this.el.sceneEl.object3D;
    let camera = this.el.sceneEl.camera.el.object3D;
    let self = this;

    //Set up our ocean grid
    this.oceanGrid = new OceanGrid(this.data, scene, renderer, camera, self.staticMeshes);

    //When we've finished loading, now we can commence ticking our grid
    this.tick = function(time, timeDelta){
      this.oceanGrid.tick(time);
    }
  },
  tick: function(time, timeDelta){
    //Do nothing to start :D
  }
});
