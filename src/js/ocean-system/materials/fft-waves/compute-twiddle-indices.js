AWater.AOcean.Materials.FFTWaves.computeTwiddleIndices = function(N, renderer){
  //Determine the twiddle indices using JS and then
  //return the results as an image.
  let twiddleTexture = [];
  let indices = [];
  let textureWidth = Math.ceil(Math.log(N) / Math.log(2));
  let textureHeight = N;

  //Get the bit reversed order of our twiddle indices.
  for(let y = 0; y < textureHeight; ++y){
    let binary = y.toString(2).split("");

    for(let i = binary.length; i < textureWidth; ++i){
      binary = ['0', ...binary];
    }
    //Reverse the bits
    binary.reverse();

    //constantSignBitReversedInteger.push('1');
    let bitReversedInteger = parseInt(binary.join(""), 2);
    indices.push(bitReversedInteger);
  }

  //Initialize our data array for storing our image texture
  for(let x = 0; x < textureWidth; ++x){
    twiddleTexture.push([]);
    for(let y = 0; y < textureHeight; ++y){
      twiddleTexture[x].push([0.0, 0.0, 0.0, 0.0]);
    }
  }

  let butterflySpan = 1.0;
  //Initialization, x = 0
  let nextButterflySpan = butterflySpan * 2.0;
  let twoPiOverN = (2.0 * Math.PI) / N;
  for(let y = 0; y < textureHeight; ++y){
    let k = (y * N / nextButterflySpan) % N;
    let twiddle = [Math.cos(twoPiOverN * k), Math.sin(twoPiOverN * k)];
    if((y % nextButterflySpan) < butterflySpan){
      twiddleTexture[0][y][0] = twiddle[0];
      twiddleTexture[0][y][1] = twiddle[1];
      twiddleTexture[0][y][2] = indices[y] / N;
      twiddleTexture[0][y][3] = indices[y + 1] / N;
    }
    else{
      twiddleTexture[0][y][0] = twiddle[0];
      twiddleTexture[0][y][1] = twiddle[1];
      twiddleTexture[0][y][2] = indices[y - 1]  / N;
      twiddleTexture[0][y][3] = indices[y] / N;
    }
  }
  butterflySpan = nextButterflySpan;

  //Remaining iterations, x > 0
  for(let x = 1; x < textureWidth; ++x){
    nextButterflySpan *= 2.0;
    for(let y = 0; y < textureHeight; ++y){
      let k = (y * N / nextButterflySpan) % N;
      let twiddle = [Math.cos(twoPiOverN * k ), Math.sin(twoPiOverN * k)];
      if((y % nextButterflySpan) < butterflySpan){
        twiddleTexture[x][y][0] = twiddle[0];
        twiddleTexture[x][y][1] = twiddle[1];
        twiddleTexture[x][y][2] = y / N;
        twiddleTexture[x][y][3] = (y + butterflySpan)  / N;
      }
      else{
        twiddleTexture[x][y][0] = twiddle[0];
        twiddleTexture[x][y][1] = twiddle[1];
        twiddleTexture[x][y][2] = (y - butterflySpan)  / N;
        twiddleTexture[x][y][3] = y / N;
      }
    }
    butterflySpan = nextButterflySpan;
  }

  //Create our twiddle texture
  let data = [];
  let bandWidth = Math.round(textureHeight / textureWidth);
  for(let y = 0; y < textureHeight; y++){
    for(let x = 0; x < textureWidth; x++){
      for(let i = 0; i < 4; ++i){
        //For each R, G, B and A component
        data.push(twiddleTexture[x][y][0]);
        data.push(twiddleTexture[x][y][1]);
        data.push(twiddleTexture[x][y][2]);
        data.push(twiddleTexture[x][y][3]);
      }
    }
  }
  let actualTextureWidth = 4 * textureWidth;

  let dataTexture = new THREE.DataTexture(
    new Float32Array(data),
    actualTextureWidth,
    textureHeight,
    THREE.RGBAFormat,
    ( /(iPad|iPhone|iPod)/g.test( navigator.userAgent ) ) ? THREE.HalfFloatType : THREE.FloatType,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.NearestFilter,
    THREE.NearestFilter
  );
  dataTexture.needsUpdate = true;

  return dataTexture;
}
