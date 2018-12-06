/**
*  Static Mesh
*
*  @PARAM: numberOfDigitsBeforeMerginVertices
*  A collection of faces (constructed of points) which make up all static meshes in our scene
*  WARNING: This object is immutable, once completed, it will be used to produce KD-Trees in our
*  each bucket of the bucket hasher. These buckets can then be used to determine whether or not
*  any particles contained are interacting with the static environment, if that environment intersects
*  the bucket rapidly (by constructing their own KD-Tree).
*/
function StaticScene(bucketGrid, staticSceneConstants, numberOfDigitsBeforeMergingVertices = 2){
  this.vertices = [];
  this.faces = [];
  this.searchablePoints = [];
  this.bucketGrid = bucketGrid;
  this.hashedVertices = [];
  this.hashedFaces = [];
  this.collidedBuckets = [];
  this.hashedPoints = [];
  this.bucketCollisionPoints = [];
  this.hashDigitsCount = numberOfDigitsBeforeMergingVertices;
  this.staticSceneConstants = staticSceneConstants;
  var thisStaticScene = this;

  function Face(vertices, normal, hash){
    this.vertices = vertices;
    this.triangle = new THREE.Triangle(this.vertices[0].toVect3(), this.vertices[1].toVect3(), this.vertices[2].toVect3());
    this.normal = normal;
    this.hash = hash;
  }

  function Vertex(x, y, z){
    this.coordinates = [x, y, z];
    this.faces = [];
    this.faceHashes = [];
    this.connectedVertices = [];
    this.connectedVerticeHashes = [];
    this.coordinateStrings = [];
    this.hash = this.coordinates.map(x => x.toFixed(this.hashDigitsCount)).join(',');
    this.vertexCount = 0;

    this.connectToVertex = function(vertex){
      this.connectedVertices.push(vertex);
      this.connectedVerticeHashes.push(vertex.hash);
      this.vertexCount += 1;
    };

    this.addFaceIfItDoesNotExist = function(face){
      if(!(face.hash in this.faceHashes)){
        this.faces.push(face);
        this.faceHashes.push(face.hash);
      }
    };

    this.toVect3 = function(){
      return new THREE.Vector3(this.coordinates[0], this.coordinates[1], this.coordinates[2]);
    };
  }

  function SearchablePoint(x, y, z, faces){
    //Points are not the same as vertices, they all lie in the same
    //plane as each of their connected faces, but they do not actuall form the face
    //like the vertices do.
    this.coordinates = [x, y, z];
    this.faces = [faces];
  }

  //Automatically merges geometries together into our singular searchable mesh.
  this.addMesh = function(meshObject, worldMatrix){
    //Create a new geometry object if necessary
    var geometry;
    if(meshObject.type === "Geometry"){
      geometry = meshObject.clone();
    }
    else if(meshObject.type === "BufferGeometry"){ //For buffered Geometry
      geometry = new THREE.Geometry();
      geometry.fromBufferGeometry(meshObject);
    }

    //get all faces
    let geometryFaces = geometry.faces;
    let vertexNames = ['a', 'b', 'c'];
    for(let i = 0, geometryFacesLength = geometryFaces.length; i < geometryFacesLength; i++){
      //get vertices for each of the faces attached to each face
      let geometryFace = geometryFaces[i];
      let vertices = [];
      let vertexHashes = [];
      for(let i = 0; i < 3; i++){
        //The geometry object has all of our vertices, but the face stores the indices
        let faceVertexIndex = vertexNames[i];
        let geometryVertexIndex = geometryFace[faceVertexIndex];
        let v = geometry.vertices[geometryVertexIndex].clone();

        //
        //NOTE: This probably does nothing right now. For whatever reason, our vertices are not showing up in world space.
        //
        let vInW = v.applyMatrix4(worldMatrix);

        //NOTE: We flip x and y here because our system treats z as up, not y.
        let newVertex = new Vertex(vInW.x, vInW.z, vInW.y);
        vertices.push(newVertex);
        vertexHashes.push(newVertex.hash);
      }
      faceHash = vertexHashes.join('<->');

      //Make sure we don't add any duplicate faces
      if(!(faceHash in this.hashedFaces)){
        //Congrats, you have been accepted as a face in our collection
        let faceNormalVectorInW = geometryFace.normal.clone().applyMatrix4(worldMatrix);
        let faceNormalVector= new THREE.Vector3(faceNormalVectorInW.x, faceNormalVectorInW.z, faceNormalVectorInW.y);
        let newFace = new Face(vertices, faceNormalVector, faceHash);
        thisStaticScene.hashedFaces[faceHash] = newFace;

        for(let j = 0; j < 3; j++){
          //Connect all of our vertices together
          let jPlus1 = (j + 1) % 3;
          let jPlus2 = (j + 2) % 3;
          var jPlus1Vertex = vertices[jPlus1];
          if(jPlus1Vertex.hash in thisStaticScene.hashedVertices){
            jPlus1Vertex = thisStaticScene.hashedVertices[jPlus1Vertex.hash];
          }
          var jPlus2Vertex = vertices[jPlus2];
          if(jPlus2Vertex.hash in thisStaticScene.hashedVertices){
            jPlus2Vertex = thisStaticScene.hashedVertices[jPlus2Vertex.hash];
          }
          var vertex = vertices[j];

          //Check if there are any duplicate vertices inside of our hash though before adding our vertices to the list.
          //if they already exist, just attach the new faces and new vertices.
          if(vertex.hash in thisStaticScene.hashedVertices){
            vertex = thisStaticScene.hashedVertices[vertex.hash];

            //It already exists? Add a new face and connected vertices to these other
            //vertices (these should not be duplicates because otherwise the face would be a duplicate)
            if(!vertex.connectedVerticeHashes.includes(jPlus1Vertex.hash)){
              vertex.connectToVertex(jPlus1Vertex);
            }
            if(!vertex.connectedVerticeHashes.includes(jPlus2Vertex.hash)){
              vertex.connectToVertex(jPlus2Vertex);
            }
          }
          else{
            vertex.connectToVertex(jPlus1Vertex);
            vertex.connectToVertex(jPlus2Vertex);
            thisStaticScene.hashedVertices[vertex.hash] = vertex;
            thisStaticScene.vertices.push(vertex);
          }
          vertex.addFaceIfItDoesNotExist(newFace);
        }
      }
    }

    //Finished addMesh Method.
    console.log("Finished add mesh method.");
  };

  this.makeHashString = function(values, deliminator){
    let strings = [];
    for(let i = 0, valuesLength = values.length; i < valuesLength; i++){
      strings.push(`${values[i].toFixed(thisStaticScene.hashDigitsCount)}${deliminator}`);
    }
    return strings.join('');
  };

  this.getFaceCollisionPoints  = function(){
    let bucketGrid = thisStaticScene.bucketGrid;
    let minDistanceToBeSamePoint = 10**(-1.0 * thisStaticScene.hashDigitsCount);
    let minDistanceToBeSamePointSquared = minDistanceToBeSamePoint * minDistanceToBeSamePoint;
    let hashedLines = [];
    let bucketRadiusOver2 = bucketGrid.approximateSearchDiameter * 0.5;
    let bucketRadiusOver2Squared = bucketRadiusOver2 * bucketRadiusOver2;

    //This is the key value we're looking for...
    thisStaticScene.bucketCollisionPoints = [];

    //Trigger an alert that our geometry points are parsed and ready to be displayed for debugging
    thisStaticScene.bucketGrid.parentParticleSystem.parentFluidParams.el.emit('static-mesh-geometry-constructed', {vertices: thisStaticScene.vertices});

    //Add all of our vertices so long as they're inside of a bucket
    //These points have all of their faces attached.
    for(let i = 0, verticesLength = thisStaticScene.vertices.length; i < verticesLength; i++){
      let vertex = thisStaticScene.vertices[i];
      let bucketGrid = thisStaticScene.bucketGrid;
      let vertexBucketHash = bucketGrid.getHashKeyFromPosition(vertex.coordinates);
      if(vertexBucketHash in bucketGrid.hashedBuckets){
        let hash = this.makeHashString(vertex.coordinates, '-');
        let newPoint = {
          position: [...vertex.coordinates],
          faces: [...vertex.faces]
        };
        thisStaticScene.searchablePoints.push(newPoint);
        thisStaticScene.hashedPoints[hash] = newPoint;

        if(!(vertexBucketHash in thisStaticScene.bucketCollisionPoints)){
          thisStaticScene.bucketCollisionPoints[vertexBucketHash] = [];
        }
        //thisStaticScene.collidedBuckets[vertexBucketHash] = bucketGrid.hashedBuckets[vertexBucketHash];
        thisStaticScene.bucketCollisionPoints[vertexBucketHash].push(newPoint);
      }
    }

    //Construct all connectors between each points all associated planes (the intersection of both points planes).
    for(let i = 0, verticesLength = thisStaticScene.vertices.length; i < verticesLength; i++){
      let originVertex = thisStaticScene.vertices[i];
      for(let j = 0, connectedVerticesLength = originVertex.connectedVertices.length; j < connectedVerticesLength; j++){
        let connectedVertex = originVertex.connectedVertices[j];

        //Get all faces shared between vertex 1 and vertex 2
        let potentialHashes = originVertex.faces.map(x => x.hash);
        let sharedFaces = [];
        for(let k = 0, numFaces = connectedVertex.faces.length; k < numFaces; k++){
          let face = connectedVertex.faces[k];
          if(potentialHashes.includes(face.hash)){
            sharedFaces.push(face);
          }
        }

        //Determine which connectors intersect the planes of our buckets. At each intersection point, create a new searchablePoint,
        //which has attached faces associated with the parent connector.
        let originVertexVect3 = originVertex.toVect3();
        let connectedVertexVect3 = connectedVertex.toVect3();
        let lineFormedByVectors = new THREE.Line3(originVertexVect3, connectedVertexVect3);
        let lineHash = originVertex.hash + '<->' + connectedVertexVect3.hash;
        hashedLines[lineHash] = [];
        for(let k = 0, bucketsLength = thisStaticScene.bucketGrid.buckets.length; k < bucketsLength; k++){
          let bucket = thisStaticScene.bucketGrid.buckets[k];

          //Now check for intersections between our line and our planes
          let bucketFaces = bucket.getFaces();
          for(let faceIndex = 0; faceIndex < 6; faceIndex++){
            //Get the plane of the face
            let bucketFace = bucketFaces[faceIndex];

            if(bucketFace.plane.intersectsLine(lineFormedByVectors)){
              //Now to get down to business and track where this hits
              let p = new THREE.Vector3();
              bucketFace.plane.intersectLine(lineFormedByVectors, p);

              //If any intersections are found in the range of the plane, then add these to our list of searchable points
              let pointIsOnFace = bucketFace.isPointOnFace([p.x, p.y, p.z]);
              if(pointIsOnFace){
                let newPoint = {
                  position: [p.x, p.y, p.z],
                  faces: sharedFaces
                };
                let newPointForHash = {
                  position: [p.x, p.y, p.z],
                  faces: sharedFaces
                };
                let hash = this.makeHashString(newPointForHash.position, '-');
                let bucketHash = bucket.hash;
                //if(!(hash in thisStaticScene.hashedPoints)){
                if(true){
                  thisStaticScene.searchablePoints.push(newPoint);
                  thisStaticScene.hashedPoints[hash] = newPoint;

                  if(!(bucketHash in thisStaticScene.bucketCollisionPoints)){
                    thisStaticScene.bucketCollisionPoints[bucketHash] = [];
                  }
                  thisStaticScene.collidedBuckets[bucketHash] = bucketGrid.hashedBuckets[bucketHash];
                  thisStaticScene.bucketCollisionPoints[bucketHash].push(newPoint);

                  //
                  //NOTE: WE might be able to delete this step.
                  //
                  // //Because all of our points live on the boundaries of two buckets,
                  // //we must also check whether we've included the connected bucket in this collision
                  // //as well.
                  // let otherPotentialBucketHash = bucketFace.getConnectedBucketHash();
                  // if((otherPotentialBucketHash in bucketGrid.hashedBuckets) &&
                  //   !(otherPotentialBucketHash in thisStaticScene.collidedBuckets)
                  // ){
                  //   if(!(otherPotentialBucketHash in thisStaticScene.bucketCollisionPoints)){
                  //     thisStaticScene.bucketCollisionPoints[otherPotentialBucketHash] = [];
                  //   }
                  //   //thisStaticScene.collidedBuckets[otherPotentialBucketHash] = bucketGrid.hashedBuckets[otherPotentialBucketHash];
                  //   thisStaticScene.bucketCollisionPoints[otherPotentialBucketHash].push(newPoint);
                  // }

                  //While we're here, let's also store these points up in the hash because we will likely
                  //create all centers from the results.
                  hashedLines[lineHash].push([p.x, p.y, p.z]);
                }
              }
            }
          }
        }
      }
    }

    //For each face on our geometry.
    let meshFaces = Object.keys(thisStaticScene.hashedFaces).map(x => thisStaticScene.hashedFaces[x]);
    for(let i = 0, numMeshFaces = meshFaces.length; i < numMeshFaces; i++){
      //Get each of our vertices and find the longest edge in the triangle
      //(Oh, they're ALL triangles.)
      let meshFace = meshFaces[i];
      let vect1 = meshFace.vertices[0].toVect3();
      let vect2 = meshFace.vertices[1].toVect3();
      let vect3 = meshFace.vertices[2].toVect3();
      let longestLegVect1 = vect1;
      let longestLegVect2 = vect2;
      let unusedVector = vect3;

      let testDistance = vect1.distanceToSquared(vect2);
      let testDistance2 = vect2.distanceToSquared(vect3);
      if(testDistance2 > testDistance){
        testDistance = testDistance2;
        longestLegVect1 = vect2;
        longestLegVect2 = vect3;
        unusedVector = vect1;
      }
      testDistance2 = vect3.distanceToSquared(vect1);
      if(testDistance2 > testDistance){
        testDistance = testDistance2;
        longestLegVect1 = vect3;
        longestLegVect2 = vect1;
        unusedVector = vect2;
      }

      //Now that we have the longest vector. Interpolate along the length regularly
      //At a distance that will allow us to intercept all other cubes. To this end,
      //we want to find interpolations for projections along the x, y and z axis st
      //these interpolations result in a spacing equivalent to our bucket grid spacing.
      //Then, we will take the highest frequency interpolation from these and use it
      //as our point spacing.
      let vectDiff = longestLegVect1.clone().sub(longestLegVect2);
      let inverseApproximateSearchDiameter = 1.0 / bucketGrid.approximateSearchDiameter;
      let x = vectDiff.x;
      let y = vectDiff.y;
      let xInterpolations = Math.ceil(Math.sqrt(x * x + y * y) * inverseApproximateSearchDiameter);
      x = vectDiff.y;
      y = vectDiff.z;
      let yInterpolations = Math.ceil(Math.sqrt(x * x + y * y) * inverseApproximateSearchDiameter);
      x = vectDiff.x;
      y = vectDiff.z;
      let zInterpolations = Math.ceil(Math.sqrt(x * x + y * y) * inverseApproximateSearchDiameter);
      let maxInterpolation = Math.max(xInterpolations, yInterpolations, zInterpolations);

      //We will never go over this number, even though we could probably break earlier if we did a check
      //on each iteration to see when we gathered all prime factors.
      let secondaryCancellationCondition  = Math.ceil(maxInterpolation / 2.0);

      //Now find the common prime factors of the above and multiply them. Why? I don't know. It's just a wierd hunch!
      //primes are magic!
      let largestNumInterpolations = 1;
      let primeNumberIndex = 0;
      let first1000Primes = this.staticSceneConstants.first1000Primes;
      let interpolationsList = [xInterpolations, yInterpolations, zInterpolations];
      let currentPrime;
      do{
        //Get the next prime.
        currentPrime = first1000Primes[primeNumberIndex];

        //Determine if the prime divides any of our numbers...
        //If so, remove it from the remainder of that number
        //and then multiply it by our largestNumInterpolations
        let multiplyTimesLargestNumInterpolations = true;
        let nextFactorToTheNthPower = currentPrime;
        let factorToTheNthPower = 1.0;

        //Check if this prime is a common factor of any of the given three numbers.
        //and use the largest factor multiple in the group.
        for(let i = 0; i < 3; i++){
          let interpolation = interpolationsList[i];
          while((interpolation % nextFactorToTheNthPower === 0)){
            factorToTheNthPower = nextFactorToTheNthPower;
            nextFactorToTheNthPower *= currentPrime;
          }
        }
        largestNumInterpolations *= factorToTheNthPower;

        primeNumberIndex++;
      }while(currentPrime < secondaryCancellationCondition && primeNumberIndex < 1000)

      //
      //Subcalculations useful for speeding up our interpolations
      //
      //Convert our triangle into 2D
      let vectDiffSq = longestLegVect1.distanceToSquared(longestLegVect2);
      let vectDiffDistance = Math.sqrt(vectDiffSq);
      let triangleHalf1 = unusedVector.clone().sub(longestLegVect1);
      let triangleHalfDist1Sq = unusedVector.distanceToSquared(longestLegVect1);
      let inverseTriangleHalfDist1Sq = 1.0 / triangleHalfDist1Sq;
      let inverseHalfDistance1 = Math.sqrt(inverseTriangleHalfDist1Sq);
      let triangleHalf2 = unusedVector.clone().sub(longestLegVect2);
      let triangleHalfDist2Sq = unusedVector.distanceToSquared(longestLegVect2);
      let inverseTriangleHalfDist2Sq = 1.0 / triangleHalfDist2Sq;
      let inverseHalfDistance2 = Math.sqrt(inverseTriangleHalfDist2Sq);
      let midPointDist = (triangleHalfDist1Sq + vectDiffSq - triangleHalfDist2Sq) / (2.0 * vectDiffDistance);
      let midPointDistSq = midPointDist * midPointDist;
      let xRemainder = vectDiffDistance - midPointDist;
      let theta = Math.acos(midPointDist * inverseHalfDistance1);
      let gamma = Math.acos(xRemainder * inverseHalfDistance2);
      let heightToApexVertexSq = triangleHalfDist1Sq - midPointDistSq;
      let heightToApexVertex = Math.sqrt(heightToApexVertexSq);
      let cosecantTheta = 1.0 / Math.cos(theta);
      let cosecantGamma = 1.0 / Math.cos(gamma);

      //Now create lines perpendicular to this leg along those spacings.
      let line = new THREE.Line3(longestLegVect1, longestLegVect2);
      let triangleLine1 = new THREE.Line3(longestLegVect1, unusedVector);
      let triangleLine2 = new THREE.Line3(longestLegVect2, unusedVector);
      let diffT = 1.0 / largestNumInterpolations;

      //Now for the internal stuff!
      for(let j = 0; j < largestNumInterpolations; j++){
        let x0 = new THREE.Vector3();
        let t0 = j * diffT;
        line.at(t0, x0);
        let vectorToOrigin = x0.clone().sub(longestLegVect1);

        //
        //NOTE: This is probably not what we think it is. We are just getting the x vector, and then the y height.
        //What we need is that actual vertex position, which probbaly requires a tad bit more trig.
        //
        //Grab the appropriate coefficient dependent upon which side of the triangle we're on.
        let xf = new THREE.Vector3();
        let endPointT;
        if(longestLegVect1.distanceToSquared(x0) <= midPointDistSq){
          let tf = x0.distanceTo(longestLegVect1) * cosecantTheta * inverseHalfDistance1;
          triangleLine1.at(tf, xf);
        }
        else{
          let tf = x0.distanceTo(longestLegVect2) * cosecantGamma * inverseHalfDistance2;
          triangleLine2.at(tf, xf);
        }

        //Draw a line in the plane with the unused line, until the intersection of that unused line.
        //This line will be used to find our bucket intercepts.
        let lineFormedByVectors = new THREE.Line3(x0, xf);

        //
        //NOTE: Wow, so much code duplication. I can improve this, but for now, we will keep these seperate.
        //

        //For each of our buckets, determine where this line intercepts each given bucket.
        //Basically, we are duplicating the above.
        let originVertex = new Vertex(x0.x, x0.y, x0.z);
        let connectedVertexVect3 = new Vertex(xf.x, xf.y, xf.z);
        let lineHash = originVertex.hash + '<->' + connectedVertexVect3.hash;
        hashedLines[lineHash] = []
        for(let k = 0, bucketsLength = thisStaticScene.bucketGrid.buckets.length; k < bucketsLength; k++){
          let bucket = thisStaticScene.bucketGrid.buckets[k];

          //Now check for intersections between our line and our planes
          let bucketFaces = bucket.getFaces();
          for(let faceIndex = 0; faceIndex < 6; faceIndex++){
            //Get the plane of the face
            let bucketFace = bucketFaces[faceIndex];

            if(bucketFace.plane.intersectsLine(lineFormedByVectors)){
              let p = new THREE.Vector3();
              bucketFace.plane.intersectLine(lineFormedByVectors, p);

              //If any intersections are found in the range of the plane, then add these to our list of searchable points
              //Also, we only have one face per cube here.
              let pointIsOnFace = bucketFace.isPointOnFace([p.x, p.y, p.z]);
              if(pointIsOnFace){
                let newPoint = {
                  position: [p.x, p.y, p.z],
                  faces: [meshFace]
                };
                let newPointForHash = {
                  position: [p.x, p.y, p.z],
                  faces: [meshFace]
                };
                let hash = this.makeHashString(newPointForHash.position, '-');
                let bucketHash = bucketGrid.getHashKeyFromPosition(newPoint.position);
                if(!(hash in thisStaticScene.hashedPoints) &&
                  (bucketHash in bucketGrid.hashedBuckets)
                ){
                  thisStaticScene.searchablePoints.push(newPoint);
                  thisStaticScene.hashedPoints[hash] = newPoint;

                  if(!(bucketHash in thisStaticScene.bucketCollisionPoints)){
                    thisStaticScene.bucketCollisionPoints[bucketHash] = [];
                  }
                  thisStaticScene.collidedBuckets[bucketHash] = bucketGrid.hashedBuckets[bucketHash];
                  thisStaticScene.bucketCollisionPoints[bucketHash].push(newPoint);

                  //Because all of our points live on the boundaries of two buckets,
                  //we must also check whether we've included the connected bucket in this collision
                  //as well.
                  let otherPotentialBucketHash = bucketFace.getConnectedBucketHash();
                  if((otherPotentialBucketHash in bucketGrid.hashedBuckets) &&
                    !(otherPotentialBucketHash in thisStaticScene.collidedBuckets)
                  ){
                    if(!(otherPotentialBucketHash in thisStaticScene.bucketCollisionPoints)){
                      thisStaticScene.bucketCollisionPoints[otherPotentialBucketHash] = [];
                    }
                    //thisStaticScene.collidedBuckets[otherPotentialBucketHash] = bucketGrid.hashedBuckets[otherPotentialBucketHash];
                    thisStaticScene.bucketCollisionPoints[otherPotentialBucketHash].push(newPoint);
                  }

                  //While we're here, let's also store these points up in the hash because we will likely
                  //create all centers from the results.
                  hashedLines[lineHash].push([p.x, p.y, p.z]);
                }
              }
            }
          }
        }
        //
        //END OF POINT ADDITION LOOP
        //
      }
      //
      //END OF LINE LOOP
      //
    }
    //
    //END OF ADDING CENTER POINTS
    //
  };

  //This is just when we want to get the buckets inside verses outside
  this.filterBucketsInsideVersesOutside = function(){
    //Grab all buckets that presently collide with the mesh.
    let listOfPreviouslyTrackedBucketHashes = Object.keys(thisStaticScene.collidedBuckets);
    let listOfTrackedBuckets = listOfPreviouslyTrackedBucketHashes.map(x => thisStaticScene.collidedBuckets[x]);
    let lastLayerOfBuckets = listOfTrackedBuckets.slice(0);
    let terminationLength = thisStaticScene.bucketGrid.buckets.length;
    let hashedBucketDistances = [];

    //For debugging purposes let's find out where everything starts
    let initialbucketList = listOfTrackedBuckets.slice(0);

    //These buckets ACTUALLY collide with the mesh - so we cannot really call them inside or outside.
    for(let i = 0, numBuckets = lastLayerOfBuckets.length; i < numBuckets; i++){
      let bucket = lastLayerOfBuckets[i];
      let closestBucketDistance = {
        score: 0,
        isInMesh: null,
        associatedBucket: bucket
      };
      hashedBucketDistances[bucket.hash] = closestBucketDistance;
    }

    //While buckets yet remain that are not yet tagged...
    while(listOfTrackedBuckets.length < terminationLength){
      //Reset our next layer of buckets for populating.
      nextLayerOfBuckets = [];
      for(let i = 0, numOriginBuckets = lastLayerOfBuckets.length; i < numOriginBuckets; i++){
        let bucket = lastLayerOfBuckets[i];
        let smallSetOfNextLayersBuckets = bucket.listOfConnectedBuckets;
        for(let j = 0, numConnectedBuckets = smallSetOfNextLayersBuckets.length; j < numConnectedBuckets; j++){
          //For each bucket adjacent to our last layer, but not in the system already.
          let potentiallyUntrackedBucket = smallSetOfNextLayersBuckets[j];
          let bucketCenter = potentiallyUntrackedBucket.getCenter();
          //Note: Because we started off with all buckets associated with a face - we pre-filter
          //out these results below by just checking if they're in our list of bucket hashes.
          if(!(listOfPreviouslyTrackedBucketHashes.includes(potentiallyUntrackedBucket.hash.toString()))){
            //Change your thought context to this new bucket, at this point we know we're not tracking the bucket
            //and we just want to find out if the bucket is inside or outisde of the mesh based on the nearest points,
            //or other nearby buckets.
            let untrackedBucket = potentiallyUntrackedBucket; //Syntactic sugar for making our code easier to read
            let nearbyBuckets = untrackedBucket.listOfConnectedBuckets;
            //Check if any of our neighbors have collision points. If so, store them up
            //and then find the closest point among them. Use this bucket as our
            //closest bucket set our value to one and then search for the closest point
            //to our center among the faces. The normal relative to this face will decide whether we are inside or outside.
            let noBucketCollisionPointsFound = true;
            let numClosestCollisionPoints = 0;
            let closestCollisionPointDistSq =  false;
            let closestCollisionPoint;
            for(let k = 0, numOfNearbyBuckets = nearbyBuckets.length; k < numOfNearbyBuckets; k++){
              let nearbyBucket = nearbyBuckets[k];
              let nearbyBucketCollisionPoints = thisStaticScene.bucketCollisionPoints[nearbyBucket.hash];

              if(nearbyBucketCollisionPoints !== undefined){
                //Looks like we're directly adjacent to some mesh. So we can determine whether
                //we're inside or outside from the closest normal (once we find the closest face).
                noBucketCollisionPointsFound = false;
                for(let l = 0, numCollisionPoints = nearbyBucketCollisionPoints.length; l < numCollisionPoints; l++){
                  //Now to find the closest collision point.
                  let collisionPoint = nearbyBucketCollisionPoints[l];
                  let collisionPointPosition = collisionPoint.position;

                  let distSq = 0.0;
                  for(let m = 0; m < 3; m++){
                    let diff = collisionPointPosition[m] - bucketCenter[m];
                    diffSq = diff * diff;
                    distSq += diffSq;
                  }

                  //Check if the distance between each collisionPoint and the center of our bucket
                  //the closest collisionPoint wins...
                  //NOTE: We should probably do a range calculation instead for this.
                  if(distSq === closestCollisionPointDistSq && numClosestCollisionPoints > 0){
                    if(numClosestCollisionPoints === 1){
                      let holdPoint = closestCollisionPoint;
                      closestCollisionPoint = [holdPoint, closestCollisionPoint];
                      numClosestCollisionPoints = 2;
                    }
                    else{
                      closestCollisionPoint.push(collisionPoint);
                      numClosestCollisionPoints++;
                    }
                  }
                  else if(closestCollisionPointDistSq === false || closestCollisionPointDistSq > distSq){
                    closestCollisionPointDistSq = distSq;
                    closestCollisionPoint = collisionPoint;

                    //Reset our variables used for multiple collisionPoints
                    numClosestCollisionPoints = 1;
                  }
                }
              }
            }

            //If none of our neighbors have points on the face, just use the data from
            //the neighbor closest to a side and set our counter to one plus the depth of this neighbor.
            //we are going to presume the manhattan distance is a good approximation for deciding the
            //closest point on the surface of our surface.
            if(noBucketCollisionPointsFound){
              let closestBucketDistanceData;
              let closestBucketScore  = false;
              let isInMesh = null;
              for(let k = 0, numOfNearbyBuckets = nearbyBuckets.length; k < numOfNearbyBuckets; k++){
                let nearbyBucket = nearbyBuckets[k];
                let otherPotentiallyClosestBucketDistance = nearbyBucket.hash in hashedBucketDistances ? hashedBucketDistances[nearbyBucket.hash] : false;
                if(otherPotentiallyClosestBucketDistance !== false &&
                  (closestBucketScore === false || otherPotentiallyClosestBucketDistance < closestBucketScore)
                ){
                  let closerBucketDistance = hashedBucketDistances[nearbyBucket.hash];
                  closestBucketScore = closerBucketDistance.score;
                  isInMesh = closerBucketDistance.isInMesh;
                }
              }
              let closestBucketDistance = {
                score: closestBucketScore + 1,
                isInMesh: isInMesh,
                associatedBucket: untrackedBucket
              };
              hashedBucketDistances[untrackedBucket.hash] = closestBucketDistance;
            }
            else{
              //If a collision point is found, however, we use that to determine what our closest bucket is.
              //Only once we've grabbed the closest collision point from all neighboring points can we decide whether
              //or not we're inside the box or not - first by getting the face closest associated with these points.
              //---------------------
              //Get all the mesh faces associated with each of these collisionPoints and determine the closest collisionPoint on each face.
              let closestFaces = [];
              if(numClosestCollisionPoints === 1){
                //Just get all faces associated with this collisionPoint
                closestFaces = closestCollisionPoint.faces.slice(0);
              }
              else{
                //We have multiple collisionPoints? Add all the faces together into one list
                for(let i = 0; i < numClosestCollisionPoints; i++){
                  closestFaces = [...closestFaces, ...closestCollisionPoint[i].faces.slice(0)];
                }
              }

              //Now figure out the closest face to our collisionPoint
              let closestFace = closestFaces[0];
              let nearbyFace = closestFaces[0];
              let originPoint = new THREE.Vector3(...bucketCenter);
              let closestPointOnFace = new THREE.Vector3();
              nearbyFace.triangle.closestPointToPoint(originPoint, closestPointOnFace);
              if(closestFaces.length > 1){
                let distToPointSq = originPoint.distanceToSquared(closestPointOnFace);
                //Get the closest collisionPoint on the first mesh face and the distance to that collisionPoint
                for(let i = 1, numMeshFaces = closestFaces.length; i < numMeshFaces; i++){
                  //Create a triangle from our mesh and then use the built in closest collisionPoint to collisionPoint method
                  //from THREE JS in order to find the closest collisionPoint
                  nearbyFace = closestFaces[i];
                  originPoint = new THREE.Vector3(...bucketCenter);
                  closestPointOnFace = new THREE.Vector3();
                  nearbyFace.triangle.closestPointToPoint(originPoint, closestPointOnFace);

                  //Check if the distance to this collisionPoint is less than the previous distance
                  let newDistanceToPointSq = originPoint.distanceToSquared(closestPointOnFace);
                  if(newDistanceToPointSq < distToPointSq){
                    //If it's closer, replace the previous face
                    distToPointSq = newDistanceToPointSq;
                    closestFace = nearbyFace;
                  }
                }
              }

              //Use the method described here:
              //https://blender.stackexchange.com/questions/31693/how-to-find-if-a-point-is-inside-a-mesh
              //to determine if each particle is inside of the mesh.
              console.log(closestFace.normal.clone().add(closestPointOnFace));
              let isInsideMesh = originPoint.sub(closestPointOnFace).dot(closestFace.normal.clone()) < 0.0;
              let closestBucketDistance = {
                score: 1,
                isInMesh: isInsideMesh,
                associatedBucket: untrackedBucket
              };

              hashedBucketDistances[untrackedBucket.hash] = closestBucketDistance;
            }

            //Either way, add this new bucket to our list of hashed buckets so we don't run through these calculations again.
            listOfPreviouslyTrackedBucketHashes.push(untrackedBucket.hash.toString());
            nextLayerOfBuckets.push(untrackedBucket);
            listOfTrackedBuckets.push(untrackedBucket);
          }
        }
      }

      //Reset our last layer of buckets so we can find everything connected to this bucket.
      lastLayerOfBuckets = nextLayerOfBuckets;
    }

    return hashedBucketDistances;
  };

  //
  //TODO: Make a specific function to determine if a specific point is inside or outside of this mesh.
  //

  //
  //TODO: Make a specific function to determine if a point collided with our mesh, and if so, where.
  //

  //Turns out that we might also have triangles that simply intersect our buckets
  //and don't have valid vertices inside of them. While all vertices should be searchable points
  //(to include faces completely within a hashed bucket) any intersections should also be points.
  this.attachMeshToBucketGrid = function(){
    //For our intersecting points
    let bucketGrid = thisStaticScene.bucketGrid;
    let points = thisStaticScene.bucketCollisionPoints;
    let hashedBuckets = bucketGrid.hashedBuckets;
    let buckets = bucketGrid.buckets;
    let bucketMarkings = this.filterBucketsInsideVersesOutside();
    thisStaticScene.bucketGrid.parentParticleSystem.parentFluidParams.el.emit('draw-collided-buckets', {bucketCollisionData: bucketMarkings, bucketGrid: bucketGrid});
    let pointBucketHashes = [];
    for(let i = 0, numPoints = points.length; i < numPoints; i++){
      let point = points[i];
      let pointBucketHash = bucketGrid.getHashKeyFromPosition(point.position);
      hashedBuckets[pointBucketHash].instersectsStaticMesh = true;
      bucket.staticMeshPoints.push(point);
    }

    //Now use our markings to record whether we're inside or out.
    for(let i = 0, numBuckets = buckets.length; i < numBuckets; i++){
      let bucket = buckets[i];
      let bucketMarking = bucketMarkings[bucket.hash];
      bucket.isInStaticMesh = bucketMarking.isInMesh;
    }
  };

  this.findRelevantBucketsToLine = function(line){
    //Get the interpolations for the line
    let p0 = line.start
    let bucketGrid = thisStaticScene.bucketGrid;
    let interpolations = Math.ceil(line.distance);
    let inverseTotalInterpolations = 1.0 / interpolations;
    let hashedFilteredBuckets = [];

    //We don't include the start or ending intpolation.
    let previousBucketHash = bucketGrid.getHashKeyFromPosition([p0.x, p0.y, p0.z]);
    let previousBucket = false;
    let previousBucketCenter = false;
    if(vertexBucketHash in bucketGrid.hashedBuckets){
      previousBucket = bucketGrid.hashedBuckets[previousBucketHash];
      previousBucketCenter = previousBucket.getCenter();
    }
    //Add the hashed interpolations of our line to the function.
    let pointOnLine = new THREE.Vector3();
    let interpolationsMinus1 = interpolations - 1;
    let OneTenthApproximateSearchDiameter = bucketGrid.approximateSearchDiameter * 0.1;

    for(let i = 1; i < interpolations; i++){
      line.at(inverseTotalInterpolations * i, pointOnLine);
      let bucketHash = bucketGrid.getHashKeyFromPosition([pointOnLine.x, pointOnLine.y, pointOnLine.z]);
      if(bucketHash in bucketGrid.hashedBuckets){
        //Do not add the final bucket, this is just for checking buckets behind it for
        //total cover.
        let newBucket = bucketGrid.hashedBuckets[bucketHash];
        if(i !== interpolationsMinus1){
          hashedFilteredBuckets[bucketHash] = newBucket;
        }

        //This step is only if there was a previous bucket on the grid
        if(previousBucket !== false){
          //Check if this bucket is off-axis to the previous bucket along x, y or z.
          let bucketCenter = bucket.getCenter();

          let xDiffers = Math.abs(bucketCenter[0] - previousBucketCenter[0]) > OneTenthApproximateSearchDiameter;
          let yDiffers = Math.abs(bucketCenter[1] - previousBucketCenter[1]) > OneTenthApproximateSearchDiameter;
          let zDiffers = Math.abs(bucketCenter[2] - previousBucketCenter[2]) > OneTenthApproximateSearchDiameter;

          //Add the other buckets necessary to achieve super cover
          if(xDiffers && yDiffers && zDiffers){
            let coverBucketHash = bucketGrid.getHashKeyFromPosition([bucketCenter.x, previousBucketCenter.y, previousBucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
            coverBucketHash = bucketGrid.getHashKeyFromPosition([previousBucketCenter.x, bucketCenter.y, previousBucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
            coverBucketHash = bucketGrid.getHashKeyFromPosition([previousBucketCenter.x, previousBucketCenter.y, bucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
            coverBucketHash = bucketGrid.getHashKeyFromPosition([bucketCenter.x, bucketCenter.y, previousBucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
            coverBucketHash = bucketGrid.getHashKeyFromPosition([bucketCenter.x, previousBucketCenter.y, bucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
            coverBucketHash = bucketGrid.getHashKeyFromPosition([previousBucketCenter.x, bucketCenter.y, bucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
          }
          else if(xDiffers && yDiffers){
            let coverBucketHash = bucketGrid.getHashKeyFromPosition([bucketCenter.x, previousBucketCenter.y, previousBucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
            coverBucketHash = bucketGrid.getHashKeyFromPosition([previousBucketCenter.x, bucketCenter.y, previousBucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
          }
          else if(xDiffers && zDiffers){
            let coverBucketHash = bucketGrid.getHashKeyFromPosition([bucketCenter.x, previousBucketCenter.y, previousBucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
            coverBucketHash = bucketGrid.getHashKeyFromPosition([previousBucketCenter.x, previousBucketCenter.y, bucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
          }
          else if(yDiffers && zDiffers){
            let coverBucketHash = bucketGrid.getHashKeyFromPosition([previousBucketCenter.x, bucketCenter.y, previousBucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
            coverBucketHash = bucketGrid.getHashKeyFromPosition([previousBucketCenter.x, previousBucketCenter.y, bucketCenter.z]);
            hashedFilteredBuckets[coverBucketHash] = bucketGrid.hashedBuckets[coverBucketHash];
          }
          //If only one of the three has changed, we are moving orthorgonal from one cube to the next and do not need to worry
          //about the cover being lost.
        }

        //When we're all said and done, refresh the previous bucket value
        previousBucket = bucketGrid.hashedBuckets[previousBucketHash];
        previousBucketCenter = previousBucket.getCenter();
      }
    }

    //Use map to quickly remove all of our keys. We only used the keys to avoid duplicate buckets.
    let filteredBuckets = hashedFilteredBuckets.map(x => x);
    return filteredBuckets;
  };

  this.findFacesFromVertices = function(vertices){
    let faces = [];
    for(let i = 0, verticesLength = vertices.length; i < verticesLength; i++){
      let vertex = vertices[i];
      let facesOfVertex = vertex.faces;
      let facesOfVertexLength = facesOfVertex.length;
      for(let j = 0; j < facesOfVertexLength; j++){
        let face = facesOfVertex[i];
        if(!faces.includes(face)){
          faces.push(face);
        }
      }
    }

    return faces;
  };

  this.findNormalsFromVertices = function(vertices){
    let faces = [];
    for(let i = 0, verticesLength = vertices.length; i < verticesLength; i++){
      let vertex = vertices[i];
      let facesOfVertex = vertex.faces;
      let facesOfVertexLength = facesOfVertex.length;
      for(let j = 0; j < facesOfVertexLength; j++){
        var face = facesOfVertex[i];
        if(!faces.includes(face)){
          faces.push(face.normal);
        }
      }
    }

    return faces;
  };
}

function StaticSceneConstants(){
  //Useful for finding our prime factors by number.
  this.first1000Primes = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97,101,103,107,109,113,127,131,137,139,149,151,157,163,167,173,179,181,191,193,197,199,211,223,227,229,233,239,241,251,257,263,269,271,277,281,283,293,307,311,313,317,331,337,347,349,353,359,367,373,379,383,389,397,401,409,419,421,431,433,439,443,449,457,461,463,467,479,487,491,499,503,509,521,523,541,547,557,563,569,571,577,587,593,599,601,607,613,617,619,631,641,643,647,653,659,661,673,677,683,691,701,709,719,727,733,739,743,751,757,761,769,773,787,797,809,811,821,823,827,829,839,853,857,859,863,877,881,883,887,907,911,919,929,937,941,947,953,967,971,977,983,991,997,1009,1013,1019,1021,1031,1033,1039,1049,1051,1061,1063,1069,1087,1091,1093,1097,1103,1109,1117,1123,1129,1151,1153,1163,1171,1181,1187,1193,1201,1213,1217,1223,1229,1231,1237,1249,1259,1277,1279,1283,1289,1291,1297,1301,1303,1307,1319,1321,1327,1361,1367,1373,1381,1399,1409,1423,1427,1429,1433,1439,1447,1451,1453,1459,1471,1481,1483,1487,1489,1493,1499,1511,1523,1531,1543,1549,1553,1559,1567,1571,1579,1583,1597,1601,1607,1609,1613,1619,1621,1627,1637,1657,1663,1667,1669,1693,1697,1699,1709,1721,1723,1733,1741,1747,1753,1759,1777,1783,1787,1789,1801,1811,1823,1831,1847,1861,1867,1871,1873,1877,1879,1889,1901,1907,1913,1931,1933,1949,1951,1973,1979,1987,1993,1997,1999,2003,2011,2017,2027,2029,2039,2053,2063,2069,2081,2083,2087,2089,2099,2111,2113,2129,2131,2137,2141,2143,2153,2161,2179,2203,2207,2213,2221,2237,2239,2243,2251,2267,2269,2273,2281,2287,2293,2297,2309,2311,2333,2339,2341,2347,2351,2357,2371,2377,2381,2383,2389,2393,2399,2411,2417,2423,2437,2441,2447,2459,2467,2473,2477,2503,2521,2531,2539,2543,2549,2551,2557,2579,2591,2593,2609,2617,2621,2633,2647,2657,2659,2663,2671,2677,2683,2687,2689,2693,2699,2707,2711,2713,2719,2729,2731,2741,2749,2753,2767,2777,2789,2791,2797,2801,2803,2819,2833,2837,2843,2851,2857,2861,2879,2887,2897,2903,2909,2917,2927,2939,2953,2957,2963,2969,2971,2999,3001,3011,3019,3023,3037,3041,3049,3061,3067,3079,3083,3089,3109,3119,3121,3137,3163,3167,3169,3181,3187,3191,3203,3209,3217,3221,3229,3251,3253,3257,3259,3271,3299,3301,3307,3313,3319,3323,3329,3331,3343,3347,3359,3361,3371,3373,3389,3391,3407,3413,3433,3449,3457,3461,3463,3467,3469,3491,3499,3511,3517,3527,3529,3533,3539,3541,3547,3557,3559,3571,3581,3583,3593,3607,3613,3617,3623,3631,3637,3643,3659,3671,3673,3677,3691,3697,3701,3709,3719,3727,3733,3739,3761,3767,3769,3779,3793,3797,3803,3821,3823,3833,3847,3851,3853,3863,3877,3881,3889,3907,3911,3917,3919,3923,3929,3931,3943,3947,3967,3989,4001,4003,4007,4013,4019,4021,4027,4049,4051,4057,4073,4079,4091,4093,4099,4111,4127,4129,4133,4139,4153,4157,4159,4177,4201,4211,4217,4219,4229,4231,4241,4243,4253,4259,4261,4271,4273,4283,4289,4297,4327,4337,4339,4349,4357,4363,4373,4391,4397,4409,4421,4423,4441,4447,4451,4457,4463,4481,4483,4493,4507,4513,4517,4519,4523,4547,4549,4561,4567,4583,4591,4597,4603,4621,4637,4639,4643,4649,4651,4657,4663,4673,4679,4691,4703,4721,4723,4729,4733,4751,4759,4783,4787,4789,4793,4799,4801,4813,4817,4831,4861,4871,4877,4889,4903,4909,4919,4931,4933,4937,4943,4951,4957,4967,4969,4973,4987,4993,4999,5003,5009,5011,5021,5023,5039,5051,5059,5077,5081,5087,5099,5101,5107,5113,5119,5147,5153,5167,5171,5179,5189,5197,5209,5227,5231,5233,5237,5261,5273,5279,5281,5297,5303,5309,5323,5333,5347,5351,5381,5387,5393,5399,5407,5413,5417,5419,5431,5437,5441,5443,5449,5471,5477,5479,5483,5501,5503,5507,5519,5521,5527,5531,5557,5563,5569,5573,5581,5591,5623,5639,5641,5647,5651,5653,5657,5659,5669,5683,5689,5693,5701,5711,5717,5737,5741,5743,5749,5779,5783,5791,5801,5807,5813,5821,5827,5839,5843,5849,5851,5857,5861,5867,5869,5879,5881,5897,5903,5923,5927,5939,5953,5981,5987,6007,6011,6029,6037,6043,6047,6053,6067,6073,6079,6089,6091,6101,6113,6121,6131,6133,6143,6151,6163,6173,6197,6199,6203,6211,6217,6221,6229,6247,6257,6263,6269,6271,6277,6287,6299,6301,6311,6317,6323,6329,6337,6343,6353,6359,6361,6367,6373,6379,6389,6397,6421,6427,6449,6451,6469,6473,6481,6491,6521,6529,6547,6551,6553,6563,6569,6571,6577,6581,6599,6607,6619,6637,6653,6659,6661,6673,6679,6689,6691,6701,6703,6709,6719,6733,6737,6761,6763,6779,6781,6791,6793,6803,6823,6827,6829,6833,6841,6857,6863,6869,6871,6883,6899,6907,6911,6917,6947,6949,6959,6961,6967,6971,6977,6983,6991,6997,7001,7013,7019,7027,7039,7043,7057,7069,7079,7103,7109,7121,7127,7129,7151,7159,7177,7187,7193,7207,7211,7213,7219,7229,7237,7243,7247,7253,7283,7297,7307,7309,7321,7331,7333,7349,7351,7369,7393,7411,7417,7433,7451,7457,7459,7477,7481,7487,7489,7499,7507,7517,7523,7529,7537,7541,7547,7549,7559,7561,7573,7577,7583,7589,7591,7603,7607,7621,7639,7643,7649,7669,7673,7681,7687,7691,7699,7703,7717,7723,7727,7741,7753,7757,7759,7789,7793,7817,7823,7829,7841,7853,7867,7873,7877,7879,7883,7901,7907,7919];

  //
}
