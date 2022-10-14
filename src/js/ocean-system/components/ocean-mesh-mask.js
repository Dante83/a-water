//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('ocean-mesh-mask', {
  schema: {
    'layer_index': {type: 'number', default: 1, max: 31, min: 0}
  },
  init: function(){
    const depthMaterial = new THREE.MeshDepthMaterial();
    let mesh = this.el.getObject3D('mesh');
    mesh.traverse( node => {
        if(!node.isMesh){
           return;
        }
        node.material = depthMaterial;
        node.layers.set(this.data.layer_index);
    });
  },
  update: function(){
    mesh.traverse( node => {
        if(!node.isMesh){
           return;
        }
        node.layers.set(this.data.layer_index);
    });
  },
  tick: null
});
