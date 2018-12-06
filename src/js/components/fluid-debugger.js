//
//Debug fluid acts on a given particle system and visually gives us insights into what
//is doing what, where and how inside of our system so that we can double check that everything
//makes sense. This is not for production usage, but only for debugging purposes.
//
AFRAME.registerComponent('fluid-debugger', {
  schema: {
    particleSystemId: {type: 'string', default: 'my-particle-system'},
    drawParticleSystem: {type: 'boolean', default: false},
    particleSystemColor: {type: 'vec4', default: {x: 1.0, y: 0.0, z: 0.0, w: 0.2}},
    drawBucketsGrid: {type: 'boolean', default: false},
    bucketGridColor: {type: 'vec4', default: {x: 0.0, y: 0.0, z: 1.0, w: 0.1}},
    drawBucketFaces: {type: 'boolean', default: false},
    bucketsColor: {type: 'vec4', default: {x: 0.0, y: 1.0, z: 1.0, w: 0.1}},
    drawStaticMesh: {type: 'boolean', default: false},
    staticMeshColor: {type: 'vec4', default: {x: 0.0, y: 1.0, z: 0.0, w: 1.0}},
    drawCollidedBuckets: {type: 'boolean', default: false},
    insideBucketColor: {type: 'vec4', default: {x: 1.0, y: 0.0, z: 0.0, w: 0.5}},
    outsideBucketColor: {type: 'vec4', default: {x: 0.0, y: 1.0, z: 0.0, w: 0.5}},
    collidedBucketColor: {type: 'vec4', default: {x: 0.0, y: 0.0, z: 1.0, w: 0.5}},
    drawStaticMeshVertexLines: {type: 'boolean', default: false},
    staticMeshVertexLinColor: {type: 'vec4', default: {x: 1.0, y: 0.0, z: 1.0, w: 1.0}},
    drawSurfaceMesh: {type: 'boolean', default: false}
  },
  drawParticleSystemContainer: function(particleSystem){
    //Grab the width depth and height of our box, as well as it's position, so we can draw it in the world view
    let glc = particleSystem.bucketGrid.gridLowerCoordinates.slice(0);
    let hold = glc[1];
    glc[1] = glc[2]; //Because our Z is THREE.JS' Y
    glc[2] = hold;
    let guc = particleSystem.bucketGrid.gridUpperCoordinates.slice(0);
    hold = guc[1];
    guc[1] = guc[2]; //Because our Z is THREE.JS' Y
    guc[2] = hold;
    let dim = [];
    for(let i = 0; i < 3; i++){
      dim[i] = guc[i] - glc[i];
    }
    let offset = particleSystem.getCenter();
    hold = offset[1];
    offset[1] = offset[2]; //Because our Z is THREE.JS' Y
    offset[2] = hold;

    //Basically a box with the given colors.
    let c = this.data.particleSystemColor;
    let c3 = new THREE.Color(c.x, c.y, c.z);
    let material = new THREE.MeshLambertMaterial( {color: c3, transparent: true, opacity: c.w, side: THREE.DoubleSide});
    let box = new THREE.Mesh(new THREE.BoxGeometry(...dim), material);
    let sceneRef = this.el.sceneEl.object3D;

    //Add the box
    sceneRef.add(box);

    //Move it to the appropriate location.
    box.position.set(...offset);
    console.log('Particle system view constructed.');
  },
  drawBucketGridBuckets: function(particleSystem){
    //All the little boxes in the big box - drawn with lines.
    let buckets = particleSystem.bucketGrid.buckets;

    //Stuff we use over and over
    let c = this.data.bucketsColor;
    let c3 = new THREE.Color(c.x, c.y, c.z);
    let material = new THREE.MeshLambertMaterial({color: c3, transparent: true, opacity: c.w, side: THREE.DoubleSide});

    for(let i = 0, numBuckets = buckets.length; i < numBuckets; i++){
      let bucket = buckets[i];

      //Grab the width depth and height of our box, as well as it's position, so we can draw it in the world view
      let blc = bucket.lowerCorner.slice(0);
      let hold = blc[1];
      blc[1] = blc[2]; //Because our Z is THREE.JS' Y
      blc[2] = hold;
      let buc = bucket.upperCorner.slice(0);
      hold = buc[1];
      buc[1] = buc[2]; //Because our Z is THREE.JS' Y
      buc[2] = hold;
      let dim = [];
      for(let i = 0; i < 3; i++){
        dim[i] = buc[i] - blc[i];
      }
      let offset = bucket.getCenter();
      hold = offset[1];
      offset[1] = offset[2]; //Because our Z is THREE.JS' Y
      offset[2] = hold;

      //Basically a box with the given colors.
      let box = new THREE.Mesh(new THREE.BoxGeometry(...dim), material);
      let sceneRef = this.el.sceneEl.object3D;

      //Add the box
      sceneRef.add(box);

      //Move it to the appropriate location.
      box.position.set(...offset);
    }
    console.log('Bucket view constructed.');
  },
  drawBucketCollidedBuckets: function(bucketCollisionData, bucketGrid){
    //All the little boxes in the big box - drawn with lines.
    let buckets = bucketGrid.buckets;

    //Stuff we use over and over
    let cIn = this.data.insideBucketColor;
    let c3In = new THREE.Color(cIn.x, cIn.y, cIn.z);
    let materialIn = new THREE.MeshLambertMaterial({color: c3In, transparent: true, opacity: cIn.w, side: THREE.DoubleSide});

    let cOut = this.data.outsideBucketColor;
    let c3Out = new THREE.Color(cOut.x, cOut.y, cOut.z);
    let materialOut = new THREE.MeshLambertMaterial({color: c3Out, transparent: true, opacity: cOut.w, side: THREE.DoubleSide});

    let cColliding = this.data.collidedBucketColor;
    let c3Colliding = new THREE.Color(cColliding.x, cColliding.y, cColliding.z);
    let materialColliding = new THREE.MeshLambertMaterial({color: c3Colliding, transparent: true, opacity: cColliding.w, side: THREE.DoubleSide});

    console.log(bucketCollisionData);

    for(let i = 0, numBuckets = buckets.length; i < numBuckets; i++){
      let bucket = buckets[i];
      let isInStaticMesh = bucketCollisionData[bucket.hash].isInMesh;

      //Grab the width depth and height of our box, as well as it's position, so we can draw it in the world view
      let blc = bucket.lowerCorner.slice(0);
      let hold = blc[1];
      blc[1] = blc[2]; //Because our Z is THREE.JS' Y
      blc[2] = hold;
      let buc = bucket.upperCorner.slice(0);
      hold = buc[1];
      buc[1] = buc[2]; //Because our Z is THREE.JS' Y
      buc[2] = hold;
      let dim = [];
      for(let i = 0; i < 3; i++){
        dim[i] = buc[i] - blc[i];
      }
      let offset = bucket.getCenter();
      hold = offset[1];
      offset[1] = offset[2]; //Because our Z is THREE.JS' Y
      offset[2] = hold;

      //Basically a box with a color dependent upon whether it is inside, outside or colliding with the mesh.
      let box;
      let addBox = false;
      if(isInStaticMesh === true){
        box = new THREE.Mesh(new THREE.BoxGeometry(...dim), materialIn);
        addBox = true;
      }
      else if(isInStaticMesh === false){
        box = new THREE.Mesh(new THREE.BoxGeometry(...dim), materialOut);
        addBox = true;
      }
      else{
        box = new THREE.Mesh(new THREE.BoxGeometry(...dim), materialColliding);
        addBox = false;
      }

      if(addBox){
        let sceneRef = this.el.sceneEl.object3D;

        //Add the box
        sceneRef.add(box);

        //Move it to the appropriate location.
        box.position.set(...offset);
      }
    }
    console.log('Collided bucket view constructed.');
  },
  drawBucketFaces: function(particleSystem){
    //All the little boxes in the big box - drawn with lines.
    let buckets = particleSystem.bucketGrid.buckets;

    //Stuff we use over and over
    let c = this.data.bucketsColor;
    let c3 = new THREE.Color(c.x, c.y, c.z);
    let material = new THREE.MeshLambertMaterial({color: c3, transparent: true, opacity: c.w, side: THREE.DoubleSide});

    for(let i = 0, numBuckets = buckets.length; i < numBuckets; i++){
      let bucket = buckets[i];
      let bucketFaces = bucket.getFaces();
      for(let j = 0, numFaces = bucketFaces.length; j < numFaces; j++){
        let bucketFace = bucketFaces[j];
        let bucketPoints = bucketFace.points;

        //Grab the width depth and height of our box, as well as it's position, so we can draw it in the world view
        let faceGeom = new THREE.Geometry();
        let v1 = new THREE.Vector3(bucketPoints[0][0], bucketPoints[0][2], bucketPoints[0][1]);
        let v2 = new THREE.Vector3(bucketPoints[1][0], bucketPoints[1][2], bucketPoints[1][1]);
        let v3 = new THREE.Vector3(bucketPoints[2][0], bucketPoints[2][2], bucketPoints[2][1]);
        let v4 = new THREE.Vector4(bucketPoints[3][0], bucketPoints[3][2], bucketPoints[3][1]);

        faceGeom.vertices.push(v1);
        faceGeom.vertices.push(v2);
        faceGeom.vertices.push(v3);
        faceGeom.vertices.push(v4);

        faceGeom.faces.push( new THREE.Face3( 0, 1, 2 ) );
        faceGeom.faces.push( new THREE.Face3( 1, 2, 3 ) );

        //Basically a box with the given colors.
        let faceMesh = new THREE.Mesh(faceGeom, material);
        let sceneRef = this.el.sceneEl.object3D;

        //Add the box
        sceneRef.add(faceMesh);

        //Move it to the appropriate location.
        faceMesh.position.set(...[0.0,0.0,0.0]);
      }
    }
    console.log('Bucket Face view constructed.');
  },
  drawStaticMeshVertexLines: function(originVertices){
    //Stuff we use over and over
    let c = this.data.staticMeshColor;
    let c3 = new THREE.Color(c.x, c.y, c.z);
    let lineGeometry = new THREE.Geometry();
    let lineMaterial = new THREE.PointsMaterial( {color: c3, size: 100.0, sizeAttenuation: false } );

    for(let i = 0, numConnectedVertices = originVertices.length; i < numConnectedVertices; i++){
        let originVertex = originVertices[i];
        let originVertexVect3 = new THREE.Vector3(originVertex.coordinates[0], originVertex.coordinates[2], originVertex.coordinates[1]);
        for(let j = 0, connectedVerticesLength = originVertex.connectedVertices.length; j < connectedVerticesLength; j++){
          let connectedVertex = originVertex.connectedVertices[j];
          let connectedVertexVect3 = new THREE.Vector3(connectedVertex.coordinates[0], connectedVertex.coordinates[2], connectedVertex.coordinates[1]);
          lineGeometry.vertices.push(originVertexVect3);
          lineGeometry.vertices.push(connectedVertexVect3);
        }
    }
    let sceneRef = this.el.sceneEl.object3D;

    //Create the scene from the points
    let lines = new THREE.Line(lineGeometry, lineMaterial);
    sceneRef.add(lines);
    console.log('Static mesh points view constructed.');
  },
  drawBucketGridStaticMesh: function(particleSystem){
    //All the little boxes in the big box - drawn with lines.
    let buckets = particleSystem.bucketGrid.buckets;

    //Stuff we use over and over
    let c = this.data.staticMeshColor;
    let c3 = new THREE.Color(c.x, c.y, c.z);
    let pointGeometry = new THREE.Geometry();
    let pointMaterial = new THREE.PointsMaterial( {color: c3, size: 10.0, sizeAttenuation: false } );
    let test = 0;
    for(let i = 0, numBuckets = buckets.length; i < numBuckets; i++){
      //Get the bucket
      let bucket = buckets[i];

      //Grab each of the points in the bucket
      let staticMeshPoints = bucket.staticMeshPoints;

      //Draw all of these points onto the screen.
      for(let i = 0; i < staticMeshPoints.length; i++){
        let staticMeshPoint = staticMeshPoints[i].position.slice(0);
        let hold = staticMeshPoint[1];
        staticMeshPoint[1] = staticMeshPoint[2]; //Because our Z is THREE.JS' Y
        staticMeshPoint[2] = hold;

        //Basically a point with the given color
        pointGeometry.vertices.push(new THREE.Vector3(...staticMeshPoint));
        test += 1;
      }
    }
    let sceneRef = this.el.sceneEl.object3D;

    //Create the scene from the points
    let points = new THREE.Points(pointGeometry, pointMaterial);
    sceneRef.add(points);
    console.log('Static mesh points view constructed.');
  },
  drawPoints: function(points, c){
    //Stuff we use over and over
    let c3 = new THREE.Color(c.x, c.y, c.z);
    let pointGeometry = new THREE.Geometry();
    let pointMaterial = new THREE.PointsMaterial( {color: c3, size: 10.0, sizeAttenuation: false } );
    let test = 0;
    for(let i = 0, numPoints = points.length; i < numPoints; i++){
      //Draw all of these points onto the screen.
      let point = points[i];

      //Basically a point with the given color
      pointGeometry.vertices.push(new THREE.Vector3(point.x, point.z, point.y));
    }
    let sceneRef = this.el.sceneEl.object3D;

    //Create the scene from the points
    let pointsGeom = new THREE.Points(pointGeometry, pointMaterial);
    sceneRef.add(pointsGeom);
    console.log('Static mesh points view constructed.');
  },
  drawBuckets: function(buckets, c){
    //Stuff we use over and over
    let c3 = new THREE.Color(c.x, c.y, c.z);
    let material = new THREE.MeshLambertMaterial({color: c3, transparent: true, opacity: c.w, side: THREE.DoubleSide});

    for(let i = 0, numBuckets = buckets.length; i < numBuckets; i++){
      let bucket = buckets[i];

      //Grab the width depth and height of our box, as well as it's position, so we can draw it in the world view
      let blc = bucket.lowerCorner.slice(0);
      let hold = blc[1];
      blc[1] = blc[2]; //Because our Z is THREE.JS' Y
      blc[2] = hold;
      let buc = bucket.upperCorner.slice(0);
      hold = buc[1];
      buc[1] = buc[2]; //Because our Z is THREE.JS' Y
      buc[2] = hold;
      let dim = [];
      for(let i = 0; i < 3; i++){
        dim[i] = buc[i] - blc[i];
      }
      let offset = bucket.getCenter();
      hold = offset[1];
      offset[1] = offset[2]; //Because our Z is THREE.JS' Y
      offset[2] = hold;

      //Basically a box with a color dependent upon whether it is inside, outside or colliding with the mesh.
      let box = new THREE.Mesh(new THREE.BoxGeometry(...dim), material);

      let sceneRef = this.el.sceneEl.object3D;

      //Add the box
      sceneRef.add(box);

      //Move it to the appropriate location.
      box.position.set(...offset);
    }
    console.log('Collided bucket view constructed.');
  },
  init: function(){
    //Set up events that are triggered from our particle system each time a critical
    //process is completed.
    this.fluidParamsEl = document.querySelector(`#${this.data.particleSystemId}`);
    let thisDebugger = this;
    console.log('Initializing fluid system debugger...');

    this.fluidParamsEl.addEventListener('bucket-grid-constructed', function (data) {
      //We actually don't do anything with the result, this is just used to trigger
      //the drawing of our our particle system box or buckets contained within.
      if(thisDebugger.data.particleSystemId === data.target.id){
        if(thisDebugger.data.drawParticleSystem){
          console.log('Constructing particle system view...');
          thisDebugger.drawParticleSystemContainer(data.detail.particleSystem);
        }
        if(thisDebugger.data.drawBucketsGrid){
          console.log('Constructing buckets view...');
          thisDebugger.drawBucketGridBuckets(data.detail.particleSystem);
        }
        if(thisDebugger.data.drawBucketFaces){
          console.log('Constructing bucket faces view...');
          thisDebugger.drawBucketFaces(data.detail.particleSystem);
        }
      }
    });

    this.fluidParamsEl.addEventListener('static-mesh-geometry-constructed', function (data) {
      //We actually don't do anything with the result, this is just used to trigger
      //the drawing of our our particle system box or buckets contained within.
      if(thisDebugger.data.particleSystemId === data.target.id){
        if(thisDebugger.data.drawStaticMesh){
          console.log('Constructing static mesh lines view...');
          thisDebugger.drawStaticMeshVertexLines(data.detail.vertices);
        }
      }
    });

    this.fluidParamsEl.addEventListener('static-mesh-constructed', function (data) {
      //We actually don't do anything with the result, this is just used to trigger
      //the drawing of our our particle system box or buckets contained within.
      if(thisDebugger.data.particleSystemId === data.target.id){
        if(thisDebugger.data.drawStaticMesh){
          console.log('Constructing static mesh points view...');
          thisDebugger.drawBucketGridStaticMesh(data.detail.particleSystem);
        }
      }
    });

    this.fluidParamsEl.addEventListener('draw-points', function(data){
      if(thisDebugger.data.particleSystemId === data.target.id){
        thisDebugger.drawPoints(data.detail.points, data.detail.color);
      }
    });

    this.fluidParamsEl.addEventListener('draw-buckets', function(data){
      if(thisDebugger.data.particleSystemId === data.target.id){
        thisDebugger.drawBuckets(data.detail.buckets, data.detail.color);
      }
    });

    this.fluidParamsEl.addEventListener('draw-collided-buckets', function(data){
      if(thisDebugger.data.particleSystemId === data.target.id){
        if(thisDebugger.data.drawCollidedBuckets){
          console.log("Beginning to draw collided buckets...");
          thisDebugger.drawBucketCollidedBuckets(data.detail.bucketCollisionData, data.detail.bucketGrid);
        }
      }
    });
  },
  tick: function (time, timeDelta) {
    //Update our particle positions and visible surface mesh once they're added.

  }
});
