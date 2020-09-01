//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('ocean_state', {
  oceanGrid: null,
  oceanRenderer: null,
  staticMeshes: null,
  isMeshLoaded: false,
  schema: {
    'draw_distance': {type: 'number', default: 256.0},
    'patch_size': {type: 'number', default: 128.0},
    'patch_data_size': {type: 'number', default: 512},
    'number_of_octaves': {type: 'number', default: 256},
    'wind_velocity': {type: 'vec2', default: {x: 10.0, y: 8.0}},
    'default_water_depth': {type: 'number', default: 200.0},
    'surface_mesh_class': {type: 'string', default: 'static-ocean-collider'},
    'height_offset': {type: 'number', default: -10.0},
    'effect_layer': {type: 'number', default: 1, min: 1, max: 31},
    'underwater_fog_near': {type: 'number', default: 0.0, min: 0.0, max: 10000.0},
    'underwater_fog_far': {type: 'number', default: 0.0, min: 0.0, max: 10000.0},
    'underwater_fog_color': {type: 'vec3', default: new THREE.Vector3()}
  },
  init: function(){
    this.loaded = false;
    this.staticMeshes = [];

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
        self.staticMeshes = [...self.staticMeshes, ...object3D.children[0].children];

        //Check if alls models were added, if so, it's time for this entity to start rocking and rolling
        let allMeshesParsed = true;
        for(let status in self.staticCollidersAwaitingLoading){
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

    //Update the position of the objects
    scene.updateMatrixWorld();

    //Set up our ocean grid
    this.oceanGrid = new AWater.AOcean.OceanGrid(this.data, scene, renderer, camera, self.staticMeshes);

    //When we've finished loading, now we can commence ticking our grid
    this.tick = function(time, timeDelta){
      this.oceanGrid.tick(time);
    }
  },
  tick: function(time, timeDelta){
    //Do nothing to start :D
  }
});
