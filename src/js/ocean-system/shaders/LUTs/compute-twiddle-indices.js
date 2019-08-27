function computeTwiddleIndices(N, renderer){
  //Determine the twiddle indices using JS and then
  //return the results as an image.
  let twiddleTexture = [];
  let twiddleIndices = [];
  let textureWidth = Math.round(Math.log(N) / Math.log(2));
  let textureHeight = N;

  //Get the bit reversed order of our twiddle indices.
  for(let y = 0; y < textureHeight; y++){
    let binary = y.toString(2).split("");
    let padding = textureWidth - binary.length;
    for(let i = 0; i < padding; i++){
      binary.push('0');
    }
    let constantSignBitReversedInteger = binary.reverse();
    constantSignBitReversedInteger.push('1');
    let bitReversedInteger = parseInt(constantSignBitReversedInteger.join(""), 2);
    twiddleIndices.push(bitReversedInteger);
  }

  //Initialize our data array for storing our image texture
  for(let x = 0; x < textureWidth; x++){
    twiddleTexture.push([]);
    for(let y = 0; y < textureHeight; y++){
      twiddleTexture[x].push([0.0, 0.0, 0.0, 0.0]);
    }
  }

  let butterflySpan = 1.0;
  //Initialization, x = 0
  let nextButterflySpan = butterflySpan * 2.0;
  let twoPiOverN = 2.0 * Math.PI / N;
  for(let y = 0; y < textureHeight; y++){
    let k = (y * N / nextButterflySpan) % N;
    let twiddle = [Math.cos(twoPiOverN * k), Math.sin(twoPiOverN * k)];
    if((y % nextButterflySpan) < butterflySpan){
      twiddleTexture[0][y][0] = twiddle[0];
      twiddleTexture[0][y][1] = twiddle[1];
      twiddleTexture[0][y][2] = twiddleIndices[y];
      twiddleTexture[0][y][3] = twiddleIndices[y + 1];
    }
    else{
      twiddleTexture[0][y][0] = twiddle[0];
      twiddleTexture[0][y][1] = twiddle[1];
      twiddleTexture[0][y][2] = twiddleIndices[y - 1];
      twiddleTexture[0][y][3] = twiddleIndices[y];
    }
  }
  butterflySpan = nextButterflySpan;

  //Remaining iterations, x > 0
  for(let x = 1; x < textureWidth; x++){
    nextButterflySpan *= 2.0;
    for(let y = 0; y < textureHeight; y++){
      let k = (y * N / nextButterflySpan) % N;
      let twiddle = [Math.cos(2.0 * Math.PI * k / N), Math.sin(2.0 * Math.PI * k / N)];
      if((y % nextButterflySpan) < butterflySpan){
        twiddleTexture[x][y][0] = twiddle[0];
        twiddleTexture[x][y][1] = twiddle[1];
        twiddleTexture[x][y][2] = y;
        twiddleTexture[x][y][3] = (y + butterflySpan);
      }
      else{
        twiddleTexture[x][y][0] = twiddle[0];
        twiddleTexture[x][y][1] = twiddle[1];
        twiddleTexture[x][y][2] = (y - butterflySpan);
        twiddleTexture[x][y][3] = y;
      }
    }
    butterflySpan = nextButterflySpan;
  }

  //Create our twiddle texture
  let data = [];
  for(let y = 0; y < textureHeight; y++){
    for(let x = 0; x < textureWidth; x++){
      //For each R, G, B and A component
      data.push(Math.max(Math.min(Math.floor(255.0 * twiddleTexture[x][y][0]), 255), 0));
      data.push(Math.max(Math.min(Math.floor(255.0 * twiddleTexture[x][y][1]), 255), 0));
      data.push(Math.max(Math.min(Math.floor(255.0 * twiddleTexture[x][y][2]), 255), 0));
      data.push(Math.max(Math.min(Math.floor(255.0 * twiddleTexture[x][y][3]), 255), 0));
    }
  }

  //console.log(data);
  let dataTexture = new THREE.DataTexture(new Uint8Array(data), textureWidth, textureHeight, THREE.RGBAFormat);
  dataTexture.needsUpdate = true

  return dataTexture;
}
