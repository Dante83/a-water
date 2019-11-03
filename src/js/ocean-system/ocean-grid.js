function OceanGrid(data, scene, renderer){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  this.renderer = renderer;

  //Initialize all shader LUTs for future ocean viewing
  //Initialize our ocean variables and all associated shaders.
  this.oceanHeightmap = new OceanHeightmap(data, this.renderer);
  this.oceanPatch = new OceanPatch(this.scene, this.oceanHeightmap.tick(0.0));
  let self = this;

  this.tick = function(time){
    //Initialize any new ocean grid elements that have come into view

    //Delete all ocean grids that have fallen outside of our view range for too long

    //Update each of our ocean grid height maps
    self.oceanPatch.tick(self.oceanHeightmap.tick(time));
  };
}
