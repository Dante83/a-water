function StaticOctree(){
  //Basically, I'm building an octree, but instead of asking what nodes are in each
  //branch, I ask if either corner has a different closest-point in the mesh.
  //If none of the corners have a differing closest point, we leave this as a branch.
  //Otherwise, we create eight new sub elements, each with a new set of closest points.
  //
  this.createHashTree = function(objects, coordinateProperty, upperSearchCorner, lowerSearchCorner,  maxDepth){
    //
    //TODO: Populate this later.
    //
  }

  //Octrees are great for finding a good point in O(log(N)) time - but wouldn't it be
  //nice to find a particle in avg O(C) time? Well, why not just flatten the tree and use,
  //the highest level hashing algorithm, with pointers between all the larger cells and,
  //child smaller cells with variable hashes. This preserves the resolution of the rapidly
  //changing data, but doesn't require multiple searches down the tree in order to hunt for the
  //"Best branch" as all of the branches are top level. This makes an exchange of shorter lookup
  //times in exhange for significantly more memory usage for all of those pointers.
  this.flattenOctree = function(){
    //
    //TODO: Populate this later.
    //
  }
}
