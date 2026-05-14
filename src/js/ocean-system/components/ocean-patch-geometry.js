//A false for any of the top, right, bottom or left values means we are
//bordering a lower-resolution outer ring at that edge. The affected outer
//cells merge their two triangles along that edge into a single triangle
//that skips the edge midpoint, eliminating the T-junction crack that
//would otherwise appear where this ring abuts the next coarser one.
//
//worldSize: world-space size of this tile. numCells: cells per edge.
//
//Vertex layout: a regular (2*numCells+1) × (2*numCells+1) grid of unique
//positions, stored once and reused by indices.
//  even gx, even gy = cell corner
//  odd  gx, odd  gy = cell center
//  mixed parity     = edge midpoint
//Cell (cx, cy) has its center at grid index (2*cx+1, 2*cy+1) and emits up
//to 8 indexed triangles fanning from that center to alternating
//corner/edge-midpoint pairs. A downgraded outer segment emits 1 merged
//triangle instead of 2.
//
//The water vertex shader only reads `position`; no normal / uv / tangent /
//bitangent attribute is written here. The displaced normal is reconstructed
//in the fragment shader from cascade-displacement central differences.
AWater.OceanTile = function(worldSize, numCells, top, right, bottom, left){
  const gridSize = 2 * numCells + 1;
  const numberOfVertices = gridSize * gridSize;
  const positions = new Float32Array(numberOfVertices * 3);
  const scaler = worldSize / (numCells * 2.0);

  for(let gy = 0; gy < gridSize; ++gy){
    for(let gx = 0; gx < gridSize; ++gx){
      const i = gy * gridSize + gx;
      positions[i * 3 + 0] = gx * scaler;
      //positions[i * 3 + 1] stays 0 — FFT vertex shader displaces Y at draw time.
      positions[i * 3 + 2] = gy * scaler;
    }
  }

  //Each cell contributes 8 triangles by default; each downgraded outer-edge
  //segment removes 1 triangle (two triangles merged into one).
  const downgradeCount = numCells *
    ((!top ? 1 : 0) + (!right ? 1 : 0) + (!bottom ? 1 : 0) + (!left ? 1 : 0));
  const totalNumberOfTriangles = 8 * numCells * numCells - downgradeCount;

  //Default numCells (32) → gridSize 65 → 4225 verts, fits comfortably in
  //16-bit indices. Promote to Uint32 automatically for very dense tiles.
  const indices = (numberOfVertices < 65536)
    ? new Uint16Array(totalNumberOfTriangles * 3)
    : new Uint32Array(totalNumberOfTriangles * 3);
  let iWrite = 0;

  const numCellsMinusOne = numCells - 1;
  for(let cx = 0; cx < numCells; ++cx){
    const downgradeRight = cx === numCellsMinusOne && !right;
    const downgradeLeft  = cx === 0 && !left;
    for(let cy = 0; cy < numCells; ++cy){
      const downgradeTop    = cy === numCellsMinusOne && !top;
      const downgradeBottom = cy === 0 && !bottom;

      const gx0 = 2 * cx,     gx1 = 2 * cx + 1, gx2 = 2 * cx + 2;
      const gy0 = 2 * cy,     gy1 = 2 * cy + 1, gy2 = 2 * cy + 2;
      const center      = gy1 * gridSize + gx1;
      const bottomLeft  = gy0 * gridSize + gx0;
      const bottomRight = gy0 * gridSize + gx2;
      const topLeft     = gy2 * gridSize + gx0;
      const topRight    = gy2 * gridSize + gx2;
      const bottomMid   = gy0 * gridSize + gx1;
      const topMid      = gy2 * gridSize + gx1;
      const leftMid     = gy1 * gridSize + gx0;
      const rightMid    = gy1 * gridSize + gx2;

      //Each segment is a pair of triangles around one edge midpoint, or a
      //single merged triangle that skips the midpoint when downgraded.
      //Winding matches the original non-indexed mesh exactly.
      if(downgradeTop){
        indices[iWrite++] = topRight;    indices[iWrite++] = center; indices[iWrite++] = topLeft;
      } else {
        indices[iWrite++] = topMid;      indices[iWrite++] = center; indices[iWrite++] = topLeft;
        indices[iWrite++] = topRight;    indices[iWrite++] = center; indices[iWrite++] = topMid;
      }

      if(downgradeRight){
        indices[iWrite++] = bottomRight; indices[iWrite++] = center; indices[iWrite++] = topRight;
      } else {
        indices[iWrite++] = rightMid;    indices[iWrite++] = center; indices[iWrite++] = topRight;
        indices[iWrite++] = bottomRight; indices[iWrite++] = center; indices[iWrite++] = rightMid;
      }

      if(downgradeBottom){
        indices[iWrite++] = bottomLeft;  indices[iWrite++] = center; indices[iWrite++] = bottomRight;
      } else {
        indices[iWrite++] = bottomMid;   indices[iWrite++] = center; indices[iWrite++] = bottomRight;
        indices[iWrite++] = bottomLeft;  indices[iWrite++] = center; indices[iWrite++] = bottomMid;
      }

      if(downgradeLeft){
        indices[iWrite++] = topLeft;     indices[iWrite++] = center; indices[iWrite++] = bottomLeft;
      } else {
        indices[iWrite++] = leftMid;     indices[iWrite++] = center; indices[iWrite++] = bottomLeft;
        indices[iWrite++] = topLeft;     indices[iWrite++] = center; indices[iWrite++] = leftMid;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}
