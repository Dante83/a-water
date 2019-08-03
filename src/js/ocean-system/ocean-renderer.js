function OceanRenderer(){
  this.defaultDepth = 1000.0;
  this.isAboveWater = true;
  this.extendsForever = true;
  this.drawDistance;
  this.oceanGrids = [];
  this.windVector;
  this.LValue = new THREE.Vector2();

  this.update = function(){
    //Get the cameras current height

    //Determine the height of the water at this very point

    //Use this value to set the above water parameter

    //Gather all visible ocean patches

    //Check if any default patches have come into view

    //Create or destroy default patches as needed

    //Determine how far away each of these patches is

    //Use this information to set their LOD

    //Update the L-Value for our shaders
    this.LValue = (this.windVector.clone().multiply(this.windVector)).multiplyScalar(1.0 / 9.80665);
    this.windDirection = this.windVector.clone().normalize();

    //Update our ocean grids
    for(let i = 0; i < this.oceanGrids.length; i++){
      this.oceanGrids[i].update();
    }

    //Update the rendering on our default patches

  }
}
