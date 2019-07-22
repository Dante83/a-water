function OceanGrid(data){
  //Convert our heights and widths to ocean data
  this.patches = [];
  this.gridPoints = [];
  this.width = data.activeWidth;
  this.height = data.activeHeight;
  this.patchWidth = data.patchWidth;
  this.maxSubdivisions = data.maxSubdivisions;
  this.xOffSet = data.regionOffset.x;
  this.yOffset = data.regionOffset.y;

  this.setupOcean(){
    //Start by splitting up our grid into the highest possible collision points
    //That is, the vertices on each patch that are used to determine the height
    //of our waves.

    //Get the closest such point to the fill initialization point we provided.

    //Use the fill method to slowly expand out from this point at about 10 feet above sea level

    //Determine which points create this set of the ocean

    //Create a 2-D image for our ocean state, either initialized to edges that are
    //defined by a saved ocean state with variable phases in the fourier series
    //or the edge system. Note that r and g store the velocity, while b stores the amplitude.
    //Create a second and third 2-D state to store the previous image in for interpolating between
    //ocean states.

    //Create all of our ocean grids and associate each ocean grid with
    //a region of the 2-D ocean state.

  }

  this.loadOceanState(){

  }

  this.saveOceanState(){

  }

  this.updateState(){

  }

  this.update(){
    //Update the uniform that interpolates between the two ocean states

    //Update this uniform for each of our active ocean grids

    //If we are approaching the end of the second state, drop the first grid and calculate a new third
    //state and reset our interpolation to the appropriate location.

    //Set the actual uniform

    //The shaders for each of our ocean patches will now use the ocean grid information
    //and their current LOD to produce the surface height of the water with additional
    //points used to smooth the surface via normals.

    //The normal map returned here is used to determine reflection, fresnel
    //and refraction, while the distance from the camera to the surface
    //and the distance from the camera to the scene are used to determine scattering

  }
}
OceanGrid.prototype.seaLevelOffset = false;
