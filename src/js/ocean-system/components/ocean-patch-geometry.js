//A false for any of the top, right, bottom or left values
//means we're transitioning to a lower value (coarser outer ring).
//worldSize: world-space size of this tile. numCells: cells per edge (verts = numCells+1).
AWater.OceanTile = function(worldSize, numCells, top, right, bottom, left){
  const totalNumberOfTiles = numCells * numCells;
  const numberOfInnerTiles = Math.max(numCells - 2, 0) * (numCells - 2);
  const numberOfEdgeTiles = totalNumberOfTiles - numberOfInnerTiles;
  const scaler = worldSize / (numCells * 2.0);
  const tilesOnAnEdge = Math.max((numberOfEdgeTiles - 4), 0) / 4;
  const totalNumberOfTriangles = 8 * numberOfInnerTiles + 28 * tilesOnAnEdge + (tilesOnAnEdge + Math.min(4, numberOfEdgeTiles)) * (4 + top + right + bottom + left);
  const numberOfVertices = totalNumberOfTriangles * 3;
  const vertexCoordinates = new Float32Array(numberOfVertices * 3);
  const normals = new Float32Array(numberOfVertices * 3);
  const uvs = new Float32Array(numberOfVertices * 2);
  const tangents = new Float32Array(numberOfVertices * 3);
  const bitangents = new Float32Array(numberOfVertices * 3);
  for(let i = 0; i < numberOfVertices; ++i){
    normals[i * 3 + 1] = 1.0; //Y is Normal
    tangents[i * 3] = 1.0; //X is Tangent
    bitangents[i * 3 + 2] = -1.0; //Z is bitangent
  }
  const numCellsMinusOne = numCells - 1;
  let vindex = 0;
  let triIndex = 0;
  for(let x = 0; x < numCells; ++x){
    const rightTriSkip = x === numCellsMinusOne && !right;
    const leftTriSkip = x === 0 && !left;
    for(let y = 0; y < numCells; ++y){
      const topTriSkip = y === numCellsMinusOne && !top;
      const bottomTriSkip = y === 0 && !bottom;

      //Iterate through each potential triangle in the inner tile
      for(let tri = 0; tri < 8; ++tri){
        const segmentIndex = Math.floor(tri / 2);
        const flipXY = segmentIndex % 2;
        const xSign = (((tri + 7) % 8) < 4) * 2 - 1;
        const ySign = (((tri + 9) % 8) < 4) * 2 - 1;
        const segment = tri % 2;
        const downgradeTriangle = (topTriSkip && segmentIndex === 0) || (rightTriSkip && segmentIndex === 1) || (bottomTriSkip && segmentIndex === 2) || (leftTriSkip && segmentIndex === 3);

        if(downgradeTriangle && !segment){
          //First triangle of a downgraded LOD-seam pair: emit the merged triangle.
          //The two segment triangles normally share a center vertex and each touch one
          //outer corner. Downgrading collapses them into a single triangle that spans
          //both outer corners with the cell center, eliminating the T-junction.
          //Emit: outer_B, center, outer_A (CW winding, consistent with normal triangles).

          //outer_B: the far corner owned by the second triangle (segment=1).
          //For flipXY=0 segments (top/bottom) xSign alternates; negate it.
          //For flipXY=1 segments (left/right) ySign alternates; negate it.
          vertexCoordinates[vindex + 2 * flipXY] = scaler * (1.0 + 2 * (flipXY ? y : x) + (flipXY ? -ySign : -xSign));
          vertexCoordinates[vindex + 2 * (!flipXY)] = scaler * (1.0 + 2 * (flipXY ? x : y) + (flipXY ? xSign : ySign));
          vindex += 3;

          //center
          vertexCoordinates[vindex + 2 * flipXY] = scaler * (1.0 + 2 * (flipXY ? y : x));
          vertexCoordinates[vindex + 2 * (!flipXY)] = scaler * (1.0 + 2 * (flipXY ? x : y));
          vindex += 3;

          //outer_A: the near corner of this (segment=0) triangle.
          vertexCoordinates[vindex + 2 * flipXY] = scaler * (1.0 + 2 * (flipXY ? y : x) + (flipXY ? ySign : xSign));
          vertexCoordinates[vindex + 2 * (!flipXY)] = scaler * (1.0 + 2 * (flipXY ? x : y) + (flipXY ? xSign : ySign));
          vindex += 3;
        } else if(downgradeTriangle && segment){
          //Second triangle of a downgraded pair: emit a zero-area degenerate triangle.
          //All vertices stay at their zero-initialized positions (which map to the patch
          //corner via instanceMatrix — same point, zero area, no pixels rendered).
          vindex += 9;
        } else {
          for(let v = 2; v > -1; --v){
            const triV = v + segment * 3;
            vertexCoordinates[vindex + 2 * flipXY] = scaler * (1.0 + 2 * (flipXY ? y : x) + (flipXY ? ySign : xSign) * ((triV === 0) || (triV === 5)));
            //vertexCoordinates[vindex] = 0.0 - Y is zero
            vertexCoordinates[vindex + 2 * (!flipXY)] = scaler * (1.0 + 2 * (flipXY ? x : y) + (flipXY ? xSign : ySign) * ((triV + (!segment)) % 2));
            vindex += 3;
          }
        }

        triIndex++;
      }
    }
  }

  //Set up all UV-Coordinates
  for(let i = 0; i < numberOfVertices; ++i){
    uvs[i * 2] = vertexCoordinates[i * 3] / worldSize;
    uvs[i * 2 + 1] = vertexCoordinates[i * 3 + 2] / worldSize;
  }

  //Set up all indices

  this.vertexCoordinates = vertexCoordinates;
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute( 'position', new THREE.BufferAttribute( this.vertexCoordinates, 3 ) );
  geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
  geometry.normalizeNormals();
  geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
  geometry.setAttribute( 'tangent', new THREE.BufferAttribute( tangents, 3 ) );
  geometry.setAttribute( 'bitangent', new THREE.BufferAttribute( bitangents, 3 ) );
  return geometry;
}
