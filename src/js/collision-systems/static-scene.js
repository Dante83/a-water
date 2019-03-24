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
function StaticScene(bucketGrid, numberOfDigitsBeforeMergingVertices = 3){
  this.vertices = [];
  this.faces = [];
  this.searchablePoints = [];
  this.bucketGrid = bucketGrid;
  this.hashedVertices = {};
  this.hashedFaces = {};
  this.collidedBuckets = [];
  this.hashedPoints = {};
  this.bucketCollisionPoints = {};
  this.hashDigitsCount = numberOfDigitsBeforeMergingVertices;
  var thisStaticScene = this;

  function Face(vertices, normal, hash){
    this.vertices = vertices;
    this.triangle = new THREE.Triangle(this.vertices[0].toVect3(), this.vertices[1].toVect3(), this.vertices[2].toVect3());
    let triangleNormal = new THREE.Vector3();
    this.triangle.getNormal(triangleNormal);
    triangleNormal.normalize();
    normal.normalize();
    let diff = normal.clone().sub(triangleNormal).manhattanLength();
    if(diff > 1E-6){
      this.triangle = new THREE.Triangle(this.vertices[0].toVect3(), this.vertices[2].toVect3(), this.vertices[1].toVect3());
    }
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
    let nonNegativeZeroCoordinates = this.coordinates.map(x => x == 0 ? 0 : x);
    this.hash = this.coordinates.map(x => x.toFixed(thisStaticScene.hashDigitsCount)).join(',');
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

        //Eliminate stupid negative zeros
        vertexHashes.push(newVertex.hash);
      }
      faceHash = vertexHashes.join('<->');

      //Make sure we don't add any duplicate faces
      if(!(faceHash in this.hashedFaces)){
        //Congrats, you have been accepted as a face in our collection
        let faceNormalVectorInW = geometryFace.normal.clone();
        let faceNormalVector = new THREE.Vector3(faceNormalVectorInW.x, faceNormalVectorInW.z, faceNormalVectorInW.y);
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
    let bucketPreviousHashedPoints = [];
    for(let i = 0, numBuckets = bucketGrid.buckets.length; i < numBuckets; i++){
      bucketPreviousHashedPoints[bucketGrid.buckets[i].hash] = [];
    }

    //Trigger an alert that our geometry points are parsed and ready to be displayed for debugging
    thisStaticScene.bucketGrid.parentParticleSystem.parentFluidParams.el.emit('static-mesh-geometry-constructed', {vertices: thisStaticScene.vertices});

    //Add all of our vertices so long as they're inside of a bucket
    //These points have all of their faces attached.
    for(let i = 0, verticesLength = thisStaticScene.vertices.length; i < verticesLength; i++){
      let vertex = thisStaticScene.vertices[i];
      let bucketGrid = thisStaticScene.bucketGrid;
      let vertexBucketHash = bucketGrid.getHashKeyFromPosition(vertex.coordinates);
      if(vertexBucketHash in bucketGrid.hashedBuckets){
        let pointHash = this.makeHashString(vertex.coordinates, '-');
        let newPoint = {
          position: [...vertex.coordinates],
          faces: [...vertex.faces]
        };
        if(bucketPreviousHashedPoints[vertexBucketHash].indexOf(pointHash) === -1){
          bucketPreviousHashedPoints[vertexBucketHash].push(pointHash);
          thisStaticScene.searchablePoints.push(newPoint);
          thisStaticScene.hashedPoints[pointHash] = newPoint;

          if(!(vertexBucketHash in thisStaticScene.bucketCollisionPoints)){
            thisStaticScene.bucketCollisionPoints[vertexBucketHash] = [];
          }
          thisStaticScene.collidedBuckets[vertexBucketHash] = bucketGrid.hashedBuckets[vertexBucketHash];
          thisStaticScene.bucketCollisionPoints[vertexBucketHash].push(newPoint);
        }
      }
    }

    //Construct all connectors between each points all associated planes (the union of both points planes).
    for(let i = 0, verticesLength = thisStaticScene.vertices.length; i < verticesLength; i++){
      let originVertex = thisStaticScene.vertices[i];
      for(let j = 0, connectedVerticesLength = originVertex.connectedVertices.length; j < connectedVerticesLength; j++){
        //Determine which connectors intersect the planes of our buckets. At each intersection point, create a new searchablePoint,
        //which has attached faces associated with the parent connector.
        let connectedVertex = originVertex.connectedVertices[j];
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
                //Get all faces associated with this line segment, which is the intersection of faces in both
                //ending vertices.
                let intersectionOfFaces = originVertex.faces.filter(x => connectedVertex.faces.indexOf(x) !== -1);
                let newPoint = {
                  position: [p.x, p.y, p.z],
                  faces: intersectionOfFaces
                };
                let pointHash = this.makeHashString(newPoint.position, '-');
                let bucketHash = bucket.hash;
                if(bucketPreviousHashedPoints[bucketHash].indexOf(pointHash) === -1){
                  bucketPreviousHashedPoints[bucketHash].push(pointHash);
                  thisStaticScene.searchablePoints.push(newPoint);
                  thisStaticScene.hashedPoints[pointHash] = newPoint;

                  if(!(bucketHash in thisStaticScene.bucketCollisionPoints)){
                    thisStaticScene.bucketCollisionPoints[bucketHash] = [];
                  }
                  thisStaticScene.collidedBuckets[bucketHash] = bucketGrid.hashedBuckets[bucketHash];
                  thisStaticScene.bucketCollisionPoints[bucketHash].push(newPoint);

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

    //
    //NOTE: Despite all of the below, it might just be better to do a collision test
    //between each bucket box and each triangle to see if there are any collisions.
    //In the end, because we're doing ray casts on each point, I don't think we need to
    //create a set of searchable points. The collision system creates rays and those rays
    //create intersection points.
    //

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
      let remainingVector = vect3;

      let testDistance = vect1.distanceToSquared(vect2);
      let testDistance2 = vect2.distanceToSquared(vect3);
      if(testDistance2 > testDistance){
        testDistance = testDistance2;
        longestLegVect1 = vect2;
        longestLegVect2 = vect3;
        remainingVector = vect1;
      }
      testDistance2 = vect3.distanceToSquared(vect1);
      if(testDistance2 > testDistance){
        testDistance = testDistance2;
        longestLegVect1 = vect3;
        longestLegVect2 = vect1;
        remainingVector = vect2;
      }

      //Now that we have the longest vector. Interpolate along the length regularly
      //At a distance that will allow us to intercept all other cubes. To this end,
      //we want to find interpolations for projections along the x, y and z axis st
      //these interpolations result in a spacing equivalent to our bucket grid spacing.
      //Then, we will take the highest frequency interpolation from these and use it
      //as our point spacing.
      let vectDiff = longestLegVect1.clone().sub(longestLegVect2);
      let inverseApproximateSearchDiameter = 1.0 / bucketGrid.approximateSearchDiameter;
      let xInterpolations = Math.ceil(Math.abs(vectDiff.x) * inverseApproximateSearchDiameter);
      let yInterpolations = Math.ceil(Math.abs(vectDiff.y) * inverseApproximateSearchDiameter);
      let zInterpolations = Math.ceil(Math.abs(vectDiff.z) * inverseApproximateSearchDiameter);
      let largestNumInterpolations = Math.max(xInterpolations, yInterpolations, zInterpolations) * 3;

      //
      //Subcalculations useful for speeding up our interpolations
      //
      //Convert our triangle into 2D
      let vectDiffSq = longestLegVect1.distanceToSquared(longestLegVect2);
      let vectDiffDistance = Math.sqrt(vectDiffSq);
      let triangleHalf1 = remainingVector.clone().sub(longestLegVect1);
      let triangleHalfDist1Sq = remainingVector.distanceToSquared(longestLegVect1);
      let inverseTriangleHalfDist1Sq = 1.0 / triangleHalfDist1Sq;
      let inverseHalfDistance1 = Math.sqrt(inverseTriangleHalfDist1Sq);
      let triangleHalf2 = remainingVector.clone().sub(longestLegVect2);
      let triangleHalfDist2Sq = remainingVector.distanceToSquared(longestLegVect2);
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
      let triangleLine1 = new THREE.Line3(longestLegVect1, remainingVector);
      let triangleLine2 = new THREE.Line3(longestLegVect2, remainingVector);
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
                let hash = this.makeHashString(newPoint.position, '-');
                let bucketHash = bucketGrid.getHashKeyFromPosition(newPoint.position);
                if(bucketHash in bucketGrid.hashedBuckets){
                  thisStaticScene.searchablePoints.push(newPoint);
                  thisStaticScene.hashedPoints[hash] = newPoint;

                  if(!(bucketHash in thisStaticScene.bucketCollisionPoints)){
                    thisStaticScene.bucketCollisionPoints[bucketHash] = [];
                  }
                  thisStaticScene.collidedBuckets[bucketHash] = bucketGrid.hashedBuckets[bucketHash];
                  thisStaticScene.bucketCollisionPoints[bucketHash].push(newPoint);

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

    //
    //NOTE: We should just be able to spread our result from one bucket to the next while building this
    //until we fill in all the buckets. No use slowly spreading out and driving ourselves crazy for each.
    //

    //While buckets yet remain that are not yet tagged...
    while(listOfTrackedBuckets.length < terminationLength){
      //Reset our next layer of buckets for populating.
      nextLayerOfBuckets = [];
      if(listOfTrackedBuckets.length < terminationLength && lastLayerOfBuckets.length == 0){
        throw 'Error: Infinite loop condition detected in filterBucketsInsideVersesOutside';
      }

      for(let i = 0, numOriginBuckets = lastLayerOfBuckets.length; i < numOriginBuckets; i++){
        let bucket = lastLayerOfBuckets[i];
        let smallSetOfNextLayersBuckets = bucket.listOfConnectedBuckets;
        for(let j = 0, numConnectedBuckets = smallSetOfNextLayersBuckets.length; j < numConnectedBuckets; j++){
          //For each bucket adjacent to our last layer, but not in the system already.
          let potentiallyUntrackedBucket = smallSetOfNextLayersBuckets[j];
          let bucketCenter = potentiallyUntrackedBucket.getCenter();
          //Note: Because we started off with all buckets associated with a face - we pre-filter
          //out these results below by just checking if they're in our list of bucket hashes.

          if(listOfPreviouslyTrackedBucketHashes.indexOf(potentiallyUntrackedBucket.hash.toString()) === -1){
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
            let closestCollisionFaces;
            for(let k = 0, numOfNearbyBuckets = nearbyBuckets.length; k < numOfNearbyBuckets; k++){
              let nearbyBucket = nearbyBuckets[k];
              let nearbyBucketCollisionPoints = thisStaticScene.bucketCollisionPoints[nearbyBucket.hash];

              if(nearbyBucketCollisionPoints !== undefined){
                let nearbyBucketCollisionFaces = nearbyBucketCollisionPoints.map(x => x.faces);
                closestCollisionFaces = [].concat.apply([], nearbyBucketCollisionFaces);

                //Looks like we're directly adjacent to some mesh. So we can determine whether
                //we're inside or outside from the closest normal (once we find the closest face).
                noBucketCollisionPointsFound = false;
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
                  let closerBucketDistance = otherPotentiallyClosestBucketDistance;
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

              //Now figure out the closest face to our collisionPoint
              let closestFace = closestCollisionFaces[0];
              let nearbyFace = closestCollisionFaces[0];
              let originPoint = new THREE.Vector3(...bucketCenter);
              let closestPointOnFace = new THREE.Vector3();
              nearbyFace.triangle.closestPointToPoint(originPoint, closestPointOnFace);

              if(closestCollisionFaces.length > 1){
                let distToPointSq = originPoint.distanceToSquared(closestPointOnFace);
                //Get the closest collisionPoint on the first mesh face and the distance to that collisionPoint
                for(let i = 1, numMeshFaces = closestCollisionFaces.length; i < numMeshFaces; i++){
                  //Create a triangle from our mesh and then use the built in closest collisionPoint to collisionPoint method
                  //from THREE JS in order to find the closest collisionPoint
                  nearbyFace = closestCollisionFaces[i];
                  closestPointOnThisTriangle = new THREE.Vector3();
                  nearbyFace.triangle.closestPointToPoint(originPoint, closestPointOnThisTriangle);

                  //Check if the distance to this collisionPoint is less than the previous distance
                  let newDistanceToPointSq = originPoint.distanceToSquared(closestPointOnThisTriangle);
                  if(newDistanceToPointSq < distToPointSq){
                    //If it's closer, replace the previous face
                    distToPointSq = newDistanceToPointSq;
                    closestFace = closestCollisionFaces[i];
                    closestPointOnFace = closestPointOnThisTriangle.clone();
                  }
                }
              }

              //Use the method described here:
              //https://blender.stackexchange.com/questions/31693/how-to-find-if-a-point-is-inside-a-mesh
              //to determine if each particle is inside of the mesh.
              let testDist = (originPoint.clone().sub(closestPointOnFace)).dot(closestFace.normal.clone());
              let isInsideMesh = testDist < 0.0;

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

  this.triggerDrawCollidedBuckets = function(bucketMarkings){
    thisStaticScene.bucketGrid.parentParticleSystem.parentFluidParams.el.emit('draw-collided-buckets', {bucketCollisionData: bucketMarkings, bucketGrid: thisStaticScene.bucketGrid});
  }

  //Turns out that we might also have triangles that simply intersect our buckets
  //and don't have valid vertices inside of them. While all vertices should be searchable points
  //(to include faces completely within a hashed bucket) any intersections should also be points.
  this.attachMeshToBucketGrid = function(bucketMarkings){
    //For our intersecting points
    let bucketGrid = thisStaticScene.bucketGrid;
    let hashedCollisionPoints = thisStaticScene.bucketCollisionPoints;
    let hashedBuckets = bucketGrid.hashedBuckets;
    let buckets = bucketGrid.buckets;
    let bucketHashes = buckets.map((x) => x.hash);
    let pointBucketHashes = [];
    for(let i = 0, numBucketHashes = bucketHashes.length; i < numBucketHashes; i++){
      let bucketHash = bucketHashes[i];
      let points = bucketHash in hashedCollisionPoints ? hashedCollisionPoints[bucketHash] : [];
      if(points.length > 0){
        hashedBuckets[bucketHash].instersectsStaticMesh = true;
        hashedBuckets[bucketHash].staticMeshPoints = points;
      }
      else{
        hashedBuckets[bucketHash].instersectsStaticMesh = false;
        hashedBuckets[bucketHash].staticMeshPoints = [];
      }
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
