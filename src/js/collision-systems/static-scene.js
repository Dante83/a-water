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
function StaticScene(numberOfDigitsBeforeMergingVertices = 2){
  this.vertices = [];
  this.faces = [];
  this.searchablePoints = [];
  this.bucketGrid;
  this.hashedVertices = [];
  this.hashedFaces = [];
  this.hashedPoints = [];
  this.hashDigitsCount = numberOfDigitsBeforeMergingVertices;
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
        let vInW = v.applyMatrix4(worldMatrix);

        //NOTE: We flip x and y here because our system treats z as up, not y.
        let newVertex = new Vertex(vInW.x, vInW.z, vInW.y);
        vertices.push(newVertex);
        vertexHashes.push(newVertex.hash);
      }
      faceHash = vertexHashes.join('<->');

      //
      //NOTE: We seem to have the appropriate vertices, but not the appropriate faces.
      //

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
  }

  this.makeHashString = function(values, deliminator){
    let strings = [];
    for(let i = 0, valuesLength = values.length; i < valuesLength; i++){
      strings.push(`${values[i].toFixed(thisStaticScene.hashDigitsCount)}${deliminator}`);
    }
    return strings.join('');
  }

  //Turns out that we might also have triangles that simply intersect our buckets
  //and don't have valid vertices inside of them. While all vertices should be searchable points
  //(to include faces completely within a hashed bucket) any intersections should also be points.
  this.attachMeshToBucketGrid = function(bucketGrid){
    //Clear out points in case this oddly gets run a second time
    //and add all our intial vertices by default - as every vertice is searchable
    this.bucketGrid = bucketGrid;
    bucketGrid.staticScene = thisStaticScene;
    let minDistanceToBeSamePoint = 10**(-1.0 * thisStaticScene.hashDigitsCount);
    let minDistanceToBeSamePointSquared = minDistanceToBeSamePoint * minDistanceToBeSamePoint;
    let hashedLines = [];
    let bucketRadiusOver2 = bucketGrid.approximateSearchDiameter * 0.5;
    let bucketRadiusOver2Squared = bucketRadiusOver2 * bucketRadiusOver2;

    //Trigger an alert that our geometry points are parsed and ready to be displayed for debugging
    this.bucketGrid.parentParticleSystem.parentFluidParams.el.emit('static-mesh-geometry-constructed', {vertices: thisStaticScene.vertices});

    //Add all of our vertices so long as they're inside of a bucket
    //These points have all of their faces attached.
    console.log(bucketGrid.hashedBuckets);
    for(let i = 0, verticesLength = thisStaticScene.vertices.length; i < verticesLength; i++){
      let vertex = thisStaticScene.vertices[i];
      let bucketGrid = thisStaticScene.bucketGrid;
      let vertexBucketHash = bucketGrid.getHashKeyFromPosition(vertex.coordinates);
      if(vertexBucketHash in bucketGrid.hashedBuckets){
        console.log(vertexBucketHash);
        let hash = this.makeHashString(vertex.coordinates, '-');
        let newPoint = {
          position: [...vertex.coordinates],
          faces: [...vertex.faces]
        };
        thisStaticScene.searchablePoints.push(newPoint);
        thisStaticScene.hashedPoints[hash] = newPoint;
        bucketGrid.hashedBuckets[vertexBucketHash].staticMeshPoints.push(newPoint);
      }
      else{
        console.log("We're outside?!");
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

                if(!(hash in thisStaticScene.hashedPoints)){
                  thisStaticScene.searchablePoints.push(newPoint);
                  thisStaticScene.hashedPoints[hash] = newPoint;
                  bucket.staticMeshPoints.push(newPoint);

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
    //TODO: Come back and finish this up once we're solved problems with the above.
    //
    //In order to fill in the central potential points, we will use a variation of Bresenham's Algorithm
    //That makes sure we get ALL of our points to see if they intersection the lines drawn inwards from the longest
    //edge of our triangle.
    // for(let i = 0, numFaces = thisStaticScene.faces.length; i < numFaces; i++){
    //   let face = thisStaticScene.faces[i];
    //
    //   //For every face, we need to decide the longest line in the face.
    //   for(){
    //
    //   }
    //
    //   //Convert the longest line into a hash
    //   //Use this hash to acquire the origin points
    //
    //   //For each line point...
    //   for(){
    //     //We want to cast a line that in the plane of the triangle and perpendicular
    //     //to the given edge.
    //
    //     //Get all cubes intersected by our points using the variation of Brsenham's algorithm in 3D.
    //     //Algorithm described here: http://playtechs.blogspot.com/2007/03/raytracing-on-grid.html
    //
    //     //Find out where this line intersects all faces above. Add points at each of these points.
    //
    //   }
    // }

    //When we're finished, now we should just be able to search out our faces whenever we want in our buckets
    //using the results to find when a collision has occured.
    console.log("If we made it this far, we're nearly finished with the construction of our static mesh system. :)");
    thisStaticScene.bucketGrid.constructStaticMeshOctree();
  }

  this.findRelevantBucketsToLine(line){
    //Get the interpolations for the line
    let p0 = line.start
    let bucketGrid = this.bucketGrid;
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
        if(previousBucket !=== false){
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
  }

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
  }

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
  }
}
