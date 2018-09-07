//Figuring out intersection is difficult. But suppose that, having mapped our static mesh,
//until x% of squares map to "inside mesh" or "outside mesh" that we take the remainder
//and provide a value between 0 and 1 for the probability of being each of the degenerate cases.
//After this is complete, we then 'flatten' our tree into a 3-D hash by making duplicate grid structures,
//so that the smallest possible grid size is duplicated across the tree, but most of these other grid hashes
//are themselves degenerate, pointing back to the original grid object stating inside or out.

//
//NOTE: These statical octrees might also be useful for registering particles with their 'nearest neighbors'
//As a particle could look for updates from it's parent hash function, and the parent hash function could in turn
//register for events from all points within the 'radius' (using statistics for the edges) and then, each time a particle
//changes it's hash, it fires and event that is picked up by all particles within that particles radius, and both exchange 'friends lists'
//about who is currently in the spot.
//
function FlattenedStatisticalOctree(){

}
