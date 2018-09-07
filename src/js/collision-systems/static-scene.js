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

  function Face(vertices, normal){
    this.vertices = vertices;
    this.triangle = new THREE.triangle(this.vertices[0].toVect3(), this.vertices[1].toVect3(), this.vertices[2].toVect3());
    this.normal = normal;
  }

  function Vertex(){
    this.coordinates = [];
    this.faces = [];
    this.connectedVertices = [];

    this.toVect3 = function(){
      return new THREE.Vect3(this.coordinates[0], this.coordinates[1], this.coordinates[2]);
    }
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
    let geometry;
    if(meshObject instanceof THREE.Geometry){
      geometry = meshObject.clone();
    }
    else if(typeof meshObject instanceof THREE.BufferGeometry){ //For buffered Geometry
      geometry = new THREE.Geometry();
      geometry.fromBufferGeometry(meshObject);
    }

    //get all faces
    let geometryFaces = geometry.faces;
    for(let i = 0, geometryFacesLength = geometryFaces.length; i < geometryFacesLength; i++){
      //get vertices for each of the faces attached to each face
      let geometryFace = geometryFaces[i];
      let vertices = [];
      let vertexHashes = [];
      for(let faceVertexIndex in ['a', 'b', 'c']){
        //The geometry object has all of our vertices, but the face stores the indices
        let geometryVertexIndex = geometryFace[faceVertexIndex];
        let v = geometry.vertices[geometryVertexIndex];
        let vInW = v.clone().applyMatrix4(worldMatrix);
        let newVertex = new Vertex(vInW.x.toFixed(this.hashDigitsCount), vInW.y.toFixed(this.hashDigitsCount), vInW.z.toFixed(this.hashDigitsCount));
        vertices.push(newVertex);
        vertexHashes.push(newVertex.coordinates.join('-'));
      }
      faceHash = vertexHashes.join('<->');

      //Check for duplicatefaces
      isNotDuplicateFace = !this.hashedFaces.hasKey(faceHash);

      if(isNotDuplicateFace){
        //Congrats, you have been accepted.
        thisStaticScene.hashedFaces[faceHash] = new Face(vertices);
        facePoint.normalVector = geometryFace.normal.clone().applyMatrix4(worldMatrix);

        for(let j = 0; j < 3; j++){
          //Connect all of our vertices together
          let jPlus1 = (j + 1) % 3;
          let jPlus2 = (j + 2) % 3;
          var vertex = vertices[j];
          vertices[j].connectedVertices.push(vertices[jPlus1]);
          vertices[j].connectedVertices.push(vertices[jPlus2]);

          //Check if there are any duplicate vertices inside of our hash though before adding our vertices to the list.
          //if they already exist, just attach the new faces and new vertices.
          if(thisStaticScene.hashedVertices.hasKey(hash)){
            //It already exists? Add a new face and connected vertices to these other
            //vertices (these should not be duplicates because otherwise the face would be a duplicate)
            thisStaticScene.hashedVertices[hash].connectedVertices.push(vertex.connectedVertices[0]);
            thisStaticScene.hashedVertices[hash].connectedVertices.push(vertex.connectedVertices[1]);
            thisStaticScene.hashedVertices[hash].faces.push(facePoint);
          }
          else{
            //Not found? Add it.
            thisStaticScene.hashedVertices[hash] = vertex;
            thisStaticScene.vertices.push(vertex);
          }
        }
      }
    }

    //Finished addMesh Method.
  }

  //Turns out that we might also have triangles that simply intersect our buckets
  //and don't have valid vertices inside of them. While all vertices should be searchable points
  //(to include faces completely within a hashed bucket) any intersections should also be points.
  this.attachMeshToBucketGrid = function(bucketGrid){
    //Clear out points in case this oddly gets run a second time
    //and add all our intial vertices by default - as every vertice is searchable
    thisStaticScene.searchablePoints = [...thisStaticScene.vertices];
    thisStaticScene.bucketGrid = bucketGrid;
    bucketGrid.staticScene = thisStaticScene;

    //Construct all connectors between each points all associated planes (the intersection of both points planes).
    for(let i = 0, verticesLength = thisStaticScene.vertices.length; i < verticesLength; i++){
      let originVertex = thisStaticScene.vertices[i];
      for(let j = 0, connectedVerticesLength = originVertex.connectedVertices.length; j < connectedVerticesLength; j++){
        let connectedVertex = originVertex.connectedVertices[j];

        //Determine which connectors intersect the planes of our buckets. At each intersection point, create a new searchablePoint,
        //which has attached faces associated with the parent connector.
        let lineFormedByVectors = THREE.Line3(originVertex.toVect3(), connectedVertex.toVect3());
        for(let k = 0, bucketsLength = thisStaticScene.bucketGrid.buckets.length; k < bucketsLength; k++){
          let bucket = thisStaticScene.bucketGrid.buckets[k];

          //Now check for intersections between our line and our planes
          for(let faceIndex = 0; faceIndex < 6; faceIndex++){
            //Get the plane of the face
            let face = bucket.faces[faceIndex];

            if(face.plane.intersectsLine(lineFormedByVectors)){
              let p = new THREE.Vect3();
              face.plane.intersectLine(lineFormedByVectors, p);

              //If any intersections are found in the range of the plane, then add these to our list of searchable points
              let pointIsOnFace = face.isPointOnFace([p.x, p.y, p.z]);
              if(pointIsOnFace){
                let newPoint = new SearchablePoint(p.x, p.y, p.z, face);
                let newPointForHash = new SearchablePoint(p.x.toFixed(thisStaticScene.hashDigitsCount), p.y.toFixed(thisStaticScene.hashDigitsCount), p.z.toFixed(thisStaticScene.hashDigitsCount), face);
                let hash = newPointForHash.coordinates.join('-');
                if(!thisStaticScene.hashedPoints.hasKey(hash)){
                  thisStaticScene.searchablePoints.push(newPoint);
                  thisStaticScene.hashedPoints[hash] = newPoint;
                  bucket.staticMeshSearchablePoints.push(newPoint);
                }
              }
            }
          }
        }
      }
    }

    //When we're finished, call back and update our bucket hashes with searchable
    //KD Trees which we can query whenever we want to find all the nearest points,
    //their faces, and normals.case
    console.log("If we made it this far, we're nearly finished with the construction of our static mesh system. :)");
    thisStaticScene.bucketGrid.constructStaticMeshOctree();
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
