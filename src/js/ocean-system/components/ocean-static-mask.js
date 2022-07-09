//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('ocean-static-mask', {
  schema: {},
  init: function(){
    const maskMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: false,
      colorWrite: false,
    });
    maskMaterial.needsUpdate = true;
    let mesh = this.el.getObject3D('mesh');
    mesh.traverse( node => {
        if(!node.isMesh){
           return;
        }
        node.material = maskMaterial;
    });
  },
  tick: null
});
