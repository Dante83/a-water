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
  this.vertices;
  this.faces;
  this.searchablePoints;
  this.bucketGrid;
  this.hashedVertices;
  this.hashedFaces;
  this.hashedPoints;
  this.hashDigitsCount = numberOfDigitsBeforeMergingVertices;

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
  this.addMesh = function(meshObject){
    //Create a new geometry object if necessary
    var geometry;
    isBufferedGeometry = false;
    if(typeof meshObject === 'THREE.Geometry'){
      geometry = meshObject.clone();
    }
    else if(typeof meshObject === 'THREE.BufferGeometry'){ //For buffered Geometry
      geometry = new THREE.Geometry();
      geometry.fromBufferGeometry(meshObject);
    }

    //get all faces
    var geometryFaces = geometry.faces;
    for(let i = 0; i < geometryFaces.length; i++){
      //get vertices for each of the faces attached to each face
      var geometryFace = geometryFaces[i];
      var vertices = [];
      var vertexHashes = [];
      for(let faceVertexIndex in ['a', 'b', 'c']){
        //The geometry object has all of our vertices, but the face stores the indices
        let geometryVertexIndex = geometryFace[faceVertexIndex];
        var v = geometry.vertices[geometryVertexIndex];
        var newVertex = new Vertex(v.x.toFixed(this.hashDigitsCount), v.y.toFixed(this.hashDigitsCount), v.z.toFixed(this.hashDigitsCount));
        vertices.push(newVertex);
        vertexHashes.push(newVertex.coordinates.join('-'));
      }
      faceHash = vertexHashes.join('<->');

      //Check for duplicatefaces
      isNotDuplicateFace = !this.hashedFaces.hasKey(faceHash);

      if(isNotDuplicateFace){
        //Congrats, you have been accepted.
        this.hashedFaces[faceHash] = new Face(vertices);
        var facePointer = this.hashedFaces[faceHash];
        facePoint.normalVector = geometryFace.normal;

        for(let j = 0; j < 3; j++){
          //Connect all of our vertices together
          let jPlus1 = (j + 1) % 3;
          let jPlus2 = (j + 2) % 3;
          var vertex = vertices[j];
          vertices[j].connectedVertices.push(vertices[jPlus1]);
          vertices[j].connectedVertices.push(vertices[jPlus2]);

          //Check if there are any duplicate vertices inside of our hash though before adding our vertices to the list.
          //if they already exist, just attach the new faces and new vertices.
          if(this.hashedVertices.hasKey(hash)){
            //It already exists? Add a new face and connected vertices to these other
            //vertices (these should not be duplicates because otherwise the face would be a duplicate)
            this.hashedVertices[hash].connectedVertices.push(vertex.connectedVertices[0]);
            this.hashedVertices[hash].connectedVertices.push(vertex.connectedVertices[1]);
            this.hashedVertices[hash].faces.push(facePoint);
          }
          else{
            //Not found? Add it.
            this.hashedVertices[hash] = vertex;
            this.vertices.push(vertex);
          }
        }
      }
    }

    //Clean up if we passed in buffered geometry as we no longer need it.
    geometry.dispose();
  }

  //Turns out that we might also have triangles that simply intersect our buckets
  //and don't have valid vertices inside of them. While all vertices should be searchable points
  //(to include faces completely within a hashed bucket) any intersections should also be points.
  this.attachMeshToBucketGrid = function(bucketGrid){
    //Clear out points in case this oddly gets run a second time
    //and add all our intial vertices by default - as every vertice is searchable
    //
    //TODO: We're building searchable points wrong. We need to construct the actual objects and not just pass over vectors
    //
    this.searchablePoints = [...this.vertices];
    this.bucketGrid = bucketGrid;
    bucketGrid.staticScene = this;

    //Construct all connectors between each points all associated planes (the intersection of both points planes).
    for(let i = 0; i < this.vertices; i++){
      var originVertex = this.vertices[i];
      for(let j = 0; j < originVertex.connectedVertices.length; j++){
        let connectedVertex = originVertex.connectedVertices[j];

        //Determine which connectors intersect the planes of our buckets. At each intersection point, create a new searchablePoint,
        //which has attached faces associated with the parent connector.
        var lineFormedByVectors = THREE.Line3(originVertex.toVect3(), connectedVertex.toVect3());
        for(let k = 0; k < this.bucketGrid.buckets.length; k++){
          var bucket = this.bucketGrid.buckets[k];

          //Now check for intersections between our line and our planes
          for(let faceIndex = 0; faceIndex < 6; faceIndex++){
            //Get the plane of the face
            var face = bucket.faces[faceIndex];
            if(face.intersectsLine(lineFormedByVectors)){
              var p = new THREE.Vect3();
              face.intersectLine(lineFormedByVectors, p);

              //If any intersections are found in the range of the plane, then add these to our list of searchable points
              let pointIsOnFace = face.isPointOnFace([p.x, p.y, p.z]);
              if(pointIsOnFace){
                var newPoint = new SearchablePoint(p.x, p.y, p.z, face);
                var newPointForHash = new SearchablePoint(p.x.toFixed(this.hashDigitsCount), p.y.toFixed(this.hashDigitsCount), p.z.toFixed(this.hashDigitsCount), face);
                var hash = newPointForHash.coordinates.join('-');
                if(!this.hashedPoints.hasKey(hash)){
                  this.searchablePoints.push(newPoint);
                  this.hashedPoints[hash] = newPoint;
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
    //their faces, and normals.
    this.bucketGrid.updateStaticMeshKDTrees();
  }

  this.findFacesFromVertices = function(vertices){
    var faces  [];
    for(let i = 0; i < vertices; i++){
      var vertex = vertices[i];
      var facesOfVertex = vertex.faces;
      for(let j = 0; j < facesOfVertex.length; j++){
        var face = facesOfVertex[i];
        if(!faces.includes(face)){
          faces.push(face);
        }
      }
    }

    return faces;
  }

  this.findNormalsFromVertices = function(vertices){
    var faces  [];
    for(let i = 0; i < vertices; i++){
      var vertex = vertices[i];
      var facesOfVertex = vertex.faces;
      for(let j = 0; j < facesOfVertex.length; j++){
        var face = facesOfVertex[i];
        if(!faces.includes(face)){
          faces.push(face.normal);
        }
      }
    }

    return faces;
  }
}
