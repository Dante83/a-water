/**
 * @author yomboprime https://github.com/yomboprime
 *
 * GPUComputationRenderer, based on SimulationRenderer by zz85
 *
 * The GPUComputationRenderer uses the concept of variables. These variables are RGBA float textures that hold 4 floats
 * for each compute element (texel)
 *
 * Each variable has a fragment shader that defines the computation made to obtain the variable in question.
 * You can use as many variables you need, and make dependencies so you can use textures of other variables in the shader
 * (the sampler uniforms are added automatically) Most of the variables will need themselves as dependency.
 *
 * The renderer has actually two render targets per variable, to make ping-pong. Textures from the current frame are used
 * as inputs to render the textures of the next frame.
 *
 * The render targets of the variables can be used as input textures for your visualization shaders.
 *
 * Variable names should be valid identifiers and should not collide with THREE GLSL used identifiers.
 * a common approach could be to use 'texture' prefixing the variable name; i.e texturePosition, textureVelocity...
 *
 * The size of the computation (sizeX * sizeY) is defined as 'resolution' automatically in the shader. For example:
 * #DEFINE resolution vec2( 1024.0, 1024.0 )
 *
 * -------------
 *
 * Basic use:
 *
 * // Initialization...
 *
 * // Create computation renderer
 * var gpuCompute = new THREE.GPUComputationRenderer( 1024, 1024, renderer );
 *
 * // Create initial state float textures
 * var pos0 = gpuCompute.createTexture();
 * var vel0 = gpuCompute.createTexture();
 * // and fill in here the texture data...
 *
 * // Add texture variables
 * var velVar = gpuCompute.addVariable( "textureVelocity", fragmentShaderVel, pos0 );
 * var posVar = gpuCompute.addVariable( "texturePosition", fragmentShaderPos, vel0 );
 *
 * // Add variable dependencies
 * gpuCompute.setVariableDependencies( velVar, [ velVar, posVar ] );
 * gpuCompute.setVariableDependencies( posVar, [ velVar, posVar ] );
 *
 * // Add custom uniforms
 * velVar.material.uniforms.time = { value: 0.0 };
 *
 * // Check for completeness
 * var error = gpuCompute.init();
 * if ( error !== null ) {
 *		console.error( error );
  * }
 *
 *
 * // In each frame...
 *
 * // Compute!
 * gpuCompute.compute();
 *
 * // Update texture uniforms in your visualization materials with the gpu renderer output
 * myMaterial.uniforms.myTexture.value = gpuCompute.getCurrentRenderTarget( posVar ).texture;
 *
 * // Do your rendering
 * renderer.render( myScene, myCamera );
 *
 * -------------
 *
 * Also, you can use utility functions to create ShaderMaterial and perform computations (rendering between textures)
 * Note that the shaders can have multiple input textures.
 *
 * var myFilter1 = gpuCompute.createShaderMaterial( myFilterFragmentShader1, { theTexture: { value: null } } );
 * var myFilter2 = gpuCompute.createShaderMaterial( myFilterFragmentShader2, { theTexture: { value: null } } );
 *
 * var inputTexture = gpuCompute.createTexture();
 *
 * // Fill in here inputTexture...
 *
 * myFilter1.uniforms.theTexture.value = inputTexture;
 *
 * var myRenderTarget = gpuCompute.createRenderTarget();
 * myFilter2.uniforms.theTexture.value = myRenderTarget.texture;
 *
 * var outputRenderTarget = gpuCompute.createRenderTarget();
 *
 * // Now use the output texture where you want:
 * myMaterial.uniforms.map.value = outputRenderTarget.texture;
 *
 * // And compute each frame, before rendering to screen:
 * gpuCompute.doRenderTarget( myFilter1, myRenderTarget );
 * gpuCompute.doRenderTarget( myFilter2, outputRenderTarget );
 *
 *
 *
 * @param {int} sizeX Computation problem size is always 2d: sizeX * sizeY elements.
 * @param {int} sizeY Computation problem size is always 2d: sizeX * sizeY elements.
 * @param {WebGLRenderer} renderer The renderer
  */

THREE.GPUComputationRenderer = function ( sizeX, sizeY, renderer ) {

	this.variables = [];

	this.currentTextureIndex = 0;

	var scene = new THREE.Scene();

	var camera = new THREE.Camera();
	camera.position.z = 1;

	var passThruUniforms = {
		passThruTexture: { value: null }
	};

	var passThruShader = createShaderMaterial( getPassThroughFragmentShader(), passThruUniforms );

	var mesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), passThruShader );
	scene.add( mesh );


	this.addVariable = function ( variableName, computeFragmentShader, initialValueTexture ) {

		var material = this.createShaderMaterial( computeFragmentShader );

		var variable = {
			name: variableName,
			initialValueTexture: initialValueTexture,
			material: material,
			dependencies: null,
			renderTargets: [],
			wrapS: null,
			wrapT: null,
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter
		};

		this.variables.push( variable );

		return variable;

	};

	this.setVariableDependencies = function ( variable, dependencies ) {

		variable.dependencies = dependencies;

	};

	this.init = function () {

		if ( ! renderer.extensions.get( "OES_texture_float" ) &&
			 ! renderer.capabilities.isWebGL2 ) {

			return "No OES_texture_float support for float textures.";

		}

		if ( renderer.capabilities.maxVertexTextures === 0 ) {

			return "No support for vertex shader textures.";

		}

		for ( var i = 0; i < this.variables.length; i ++ ) {

			var variable = this.variables[ i ];

			// Creates rendertargets and initialize them with input texture
			variable.renderTargets[ 0 ] = this.createRenderTarget( sizeX, sizeY, variable.wrapS, variable.wrapT, variable.minFilter, variable.magFilter );
			variable.renderTargets[ 1 ] = this.createRenderTarget( sizeX, sizeY, variable.wrapS, variable.wrapT, variable.minFilter, variable.magFilter );
			this.renderTexture( variable.initialValueTexture, variable.renderTargets[ 0 ] );
			this.renderTexture( variable.initialValueTexture, variable.renderTargets[ 1 ] );

			// Adds dependencies uniforms to the ShaderMaterial
			var material = variable.material;
			var uniforms = material.uniforms;
			if ( variable.dependencies !== null ) {

				for ( var d = 0; d < variable.dependencies.length; d ++ ) {

					var depVar = variable.dependencies[ d ];

					if ( depVar.name !== variable.name ) {

						// Checks if variable exists
						var found = false;
						for ( var j = 0; j < this.variables.length; j ++ ) {

							if ( depVar.name === this.variables[ j ].name ) {

								found = true;
								break;

							}

						}
						if ( ! found ) {

							return "Variable dependency not found. Variable=" + variable.name + ", dependency=" + depVar.name;

						}

					}

					uniforms[ depVar.name ] = { value: null };

					material.fragmentShader = "\nuniform sampler2D " + depVar.name + ";\n" + material.fragmentShader;

				}

			}

		}

		this.currentTextureIndex = 0;

		return null;

	};

	this.compute = function () {

		var currentTextureIndex = this.currentTextureIndex;
		var nextTextureIndex = this.currentTextureIndex === 0 ? 1 : 0;

		for ( var i = 0, il = this.variables.length; i < il; i ++ ) {
			var variable = this.variables[ i ];

			// Sets texture dependencies uniforms
			if ( variable.dependencies !== null ) {

				var uniforms = variable.material.uniforms;
				for ( var d = 0, dl = variable.dependencies.length; d < dl; d ++ ) {

					var depVar = variable.dependencies[ d ];

					uniforms[ depVar.name ].value = depVar.renderTargets[ currentTextureIndex ].texture;

				}

			}

			// Performs the computation for this variable
			this.doRenderTarget( variable.material, variable.renderTargets[ nextTextureIndex ] );

		}

		this.currentTextureIndex = nextTextureIndex;

	};

	this.getCurrentRenderTarget = function ( variable ) {

		return variable.renderTargets[ this.currentTextureIndex ];

	};

	this.getAlternateRenderTarget = function ( variable ) {

		return variable.renderTargets[ this.currentTextureIndex === 0 ? 1 : 0 ];

	};

	function addResolutionDefine( materialShader ) {

		materialShader.defines.resolution = 'vec2( ' + sizeX.toFixed( 1 ) + ', ' + sizeY.toFixed( 1 ) + " )";

	}
	this.addResolutionDefine = addResolutionDefine;


	// The following functions can be used to compute things manually

	function createShaderMaterial( computeFragmentShader, uniforms ) {

		uniforms = uniforms || {};

		var material = new THREE.ShaderMaterial( {
			uniforms: uniforms,
			vertexShader: getPassThroughVertexShader(),
			fragmentShader: computeFragmentShader
		} );

		addResolutionDefine( material );

		return material;

	}

	this.createShaderMaterial = createShaderMaterial;

	this.createRenderTarget = function ( sizeXTexture, sizeYTexture, wrapS, wrapT, minFilter, magFilter ) {

		sizeXTexture = sizeXTexture || sizeX;
		sizeYTexture = sizeYTexture || sizeY;

		wrapS = wrapS || THREE.ClampToEdgeWrapping;
		wrapT = wrapT || THREE.ClampToEdgeWrapping;

		minFilter = minFilter || THREE.NearestFilter;
		magFilter = magFilter || THREE.NearestFilter;

		var renderTarget = new THREE.WebGLRenderTarget( sizeXTexture, sizeYTexture, {
			wrapS: wrapS,
			wrapT: wrapT,
			minFilter: minFilter,
			magFilter: magFilter,
			format: THREE.RGBAFormat,
			type: ( /(iPad|iPhone|iPod)/g.test( navigator.userAgent ) ) ? THREE.HalfFloatType : THREE.FloatType,
			stencilBuffer: false,
			depthBuffer: false
		} );

		return renderTarget;

	};

	this.createTexture = function () {

		var data = new Float32Array( sizeX * sizeY * 4 );
		return new THREE.DataTexture( data, sizeX, sizeY, THREE.RGBAFormat, THREE.FloatType );

	};

	this.renderTexture = function ( input, output ) {

		// Takes a texture, and render out in rendertarget
		// input = Texture
		// output = RenderTarget

		passThruUniforms.passThruTexture.value = input;

		this.doRenderTarget( passThruShader, output );

		passThruUniforms.passThruTexture.value = null;

	};

  this.doRenderTarget = function ( material, output ) {

		var currentRenderTarget = renderer.getRenderTarget();

		mesh.material = material;

		//Using guidance from https://github.com/mrdoob/three.js/issues/18746#issuecomment-591441598
		var currentXrEnabled = renderer.xr.enabled;
		var currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

		renderer.xr.enabled = false;
		renderer.shadowMap.autoUpdate = false;

		renderer.setRenderTarget( output );
		renderer.clear();

    renderer.render( scene, camera );

		renderer.xr.enabled = currentXrEnabled;
		renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

		mesh.material = passThruShader;

		renderer.setRenderTarget( currentRenderTarget );
	};

	// Shaders

	function getPassThroughVertexShader() {

		return	"void main()	{\n" +
				"\n" +
				"	gl_Position = vec4( position, 1.0 );\n" +
				"\n" +
				"}\n";

	}

	function getPassThroughFragmentShader() {

		return	"uniform sampler2D passThruTexture;\n" +
				"\n" +
				"void main() {\n" +
				"\n" +
				"	vec2 uv = gl_FragCoord.xy / resolution.xy;\n" +
				"\n" +
				"	gl_FragColor = texture2D( passThruTexture, uv );\n" +
				"\n" +
				"}\n";

	}

};

/**
 * @author mrdoob / http://mrdoob.com/
 */

THREE.BufferGeometryUtils = {

	computeTangents: function ( geometry ) {

		var index = geometry.index;
		var attributes = geometry.attributes;

		// based on http://www.terathon.com/code/tangent.html
		// (per vertex tangents)

		if ( index === null ||
			 attributes.position === undefined ||
			 attributes.normal === undefined ||
			 attributes.uv === undefined ) {

			console.error( 'THREE.BufferGeometryUtils: .computeTangents() failed. Missing required attributes (index, position, normal or uv)' );
			return;

		}

		var indices = index.array;
		var positions = attributes.position.array;
		var normals = attributes.normal.array;
		var uvs = attributes.uv.array;

		var nVertices = positions.length / 3;

		if ( attributes.tangent === undefined ) {

			geometry.setAttribute( 'tangent', new THREE.BufferAttribute( new Float32Array( 4 * nVertices ), 4 ) );

		}

		var tangents = attributes.tangent.array;

		var tan1 = [], tan2 = [];

		for ( var i = 0; i < nVertices; i ++ ) {

			tan1[ i ] = new THREE.Vector3();
			tan2[ i ] = new THREE.Vector3();

		}

		var vA = new THREE.Vector3(),
			vB = new THREE.Vector3(),
			vC = new THREE.Vector3(),

			uvA = new THREE.Vector2(),
			uvB = new THREE.Vector2(),
			uvC = new THREE.Vector2(),

			sdir = new THREE.Vector3(),
			tdir = new THREE.Vector3();

		function handleTriangle( a, b, c ) {

			vA.fromArray( positions, a * 3 );
			vB.fromArray( positions, b * 3 );
			vC.fromArray( positions, c * 3 );

			uvA.fromArray( uvs, a * 2 );
			uvB.fromArray( uvs, b * 2 );
			uvC.fromArray( uvs, c * 2 );

			vB.sub( vA );
			vC.sub( vA );

			uvB.sub( uvA );
			uvC.sub( uvA );

			var r = 1.0 / ( uvB.x * uvC.y - uvC.x * uvB.y );

			// silently ignore degenerate uv triangles having coincident or colinear vertices

			if ( ! isFinite( r ) ) return;

			sdir.copy( vB ).multiplyScalar( uvC.y ).addScaledVector( vC, - uvB.y ).multiplyScalar( r );
			tdir.copy( vC ).multiplyScalar( uvB.x ).addScaledVector( vB, - uvC.x ).multiplyScalar( r );

			tan1[ a ].add( sdir );
			tan1[ b ].add( sdir );
			tan1[ c ].add( sdir );

			tan2[ a ].add( tdir );
			tan2[ b ].add( tdir );
			tan2[ c ].add( tdir );

		}

		var groups = geometry.groups;

		if ( groups.length === 0 ) {

			groups = [ {
				start: 0,
				count: indices.length
			} ];

		}

		for ( var i = 0, il = groups.length; i < il; ++ i ) {

			var group = groups[ i ];

			var start = group.start;
			var count = group.count;

			for ( var j = start, jl = start + count; j < jl; j += 3 ) {

				handleTriangle(
					indices[ j + 0 ],
					indices[ j + 1 ],
					indices[ j + 2 ]
				);

			}

		}

		var tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
		var n = new THREE.Vector3(), n2 = new THREE.Vector3();
		var w, t, test;

		function handleVertex( v ) {

			n.fromArray( normals, v * 3 );
			n2.copy( n );

			t = tan1[ v ];

			// Gram-Schmidt orthogonalize

			tmp.copy( t );
			tmp.sub( n.multiplyScalar( n.dot( t ) ) ).normalize();

			// Calculate handedness

			tmp2.crossVectors( n2, t );
			test = tmp2.dot( tan2[ v ] );
			w = ( test < 0.0 ) ? - 1.0 : 1.0;

			tangents[ v * 4 ] = tmp.x;
			tangents[ v * 4 + 1 ] = tmp.y;
			tangents[ v * 4 + 2 ] = tmp.z;
			tangents[ v * 4 + 3 ] = w;

		}

		for ( var i = 0, il = groups.length; i < il; ++ i ) {

			var group = groups[ i ];

			var start = group.start;
			var count = group.count;

			for ( var j = start, jl = start + count; j < jl; j += 3 ) {

				handleVertex( indices[ j + 0 ] );
				handleVertex( indices[ j + 1 ] );
				handleVertex( indices[ j + 2 ] );

			}

		}

	},

	/**
	 * @param  {Array<THREE.BufferGeometry>} geometries
	 * @param  {Boolean} useGroups
	 * @return {THREE.BufferGeometry}
	 */
	mergeBufferGeometries: function ( geometries, useGroups ) {

		var isIndexed = geometries[ 0 ].index !== null;

		var attributesUsed = new Set( Object.keys( geometries[ 0 ].attributes ) );
		var morphAttributesUsed = new Set( Object.keys( geometries[ 0 ].morphAttributes ) );

		var attributes = {};
		var morphAttributes = {};

		var morphTargetsRelative = geometries[ 0 ].morphTargetsRelative;

		var mergedGeometry = new THREE.BufferGeometry();

		var offset = 0;

		for ( var i = 0; i < geometries.length; ++ i ) {

			var geometry = geometries[ i ];
			var attributesCount = 0;

			// ensure that all geometries are indexed, or none

			if ( isIndexed !== ( geometry.index !== null ) ) {

				console.error( 'THREE.BufferGeometryUtils: .mergeBufferGeometries() failed with geometry at index ' + i + '. All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.' );
				return null;

			}

			// gather attributes, exit early if they're different

			for ( var name in geometry.attributes ) {

				if ( ! attributesUsed.has( name ) ) {

					console.error( 'THREE.BufferGeometryUtils: .mergeBufferGeometries() failed with geometry at index ' + i + '. All geometries must have compatible attributes; make sure "' + name + '" attribute exists among all geometries, or in none of them.' );
					return null;

				}

				if ( attributes[ name ] === undefined ) attributes[ name ] = [];

				attributes[ name ].push( geometry.attributes[ name ] );

				attributesCount ++;

			}

			// ensure geometries have the same number of attributes

			if ( attributesCount !== attributesUsed.size ) {

				console.error( 'THREE.BufferGeometryUtils: .mergeBufferGeometries() failed with geometry at index ' + i + '. Make sure all geometries have the same number of attributes.' );
				return null;

			}

			// gather morph attributes, exit early if they're different

			if ( morphTargetsRelative !== geometry.morphTargetsRelative ) {

				console.error( 'THREE.BufferGeometryUtils: .mergeBufferGeometries() failed with geometry at index ' + i + '. .morphTargetsRelative must be consistent throughout all geometries.' );
				return null;

			}

			for ( var name in geometry.morphAttributes ) {

				if ( ! morphAttributesUsed.has( name ) ) {

					console.error( 'THREE.BufferGeometryUtils: .mergeBufferGeometries() failed with geometry at index ' + i + '.  .morphAttributes must be consistent throughout all geometries.' );
					return null;

				}

				if ( morphAttributes[ name ] === undefined ) morphAttributes[ name ] = [];

				morphAttributes[ name ].push( geometry.morphAttributes[ name ] );

			}

			// gather .userData

			mergedGeometry.userData.mergedUserData = mergedGeometry.userData.mergedUserData || [];
			mergedGeometry.userData.mergedUserData.push( geometry.userData );

			if ( useGroups ) {

				var count;

				if ( isIndexed ) {

					count = geometry.index.count;

				} else if ( geometry.attributes.position !== undefined ) {

					count = geometry.attributes.position.count;

				} else {

					console.error( 'THREE.BufferGeometryUtils: .mergeBufferGeometries() failed with geometry at index ' + i + '. The geometry must have either an index or a position attribute' );
					return null;

				}

				mergedGeometry.addGroup( offset, count, i );

				offset += count;

			}

		}

		// merge indices

		if ( isIndexed ) {

			var indexOffset = 0;
			var mergedIndex = [];

			for ( var i = 0; i < geometries.length; ++ i ) {

				var index = geometries[ i ].index;

				for ( var j = 0; j < index.count; ++ j ) {

					mergedIndex.push( index.getX( j ) + indexOffset );

				}

				indexOffset += geometries[ i ].attributes.position.count;

			}

			mergedGeometry.setIndex( mergedIndex );

		}

		// merge attributes

		for ( var name in attributes ) {

			var mergedAttribute = this.mergeBufferAttributes( attributes[ name ] );

			if ( ! mergedAttribute ) {

				console.error( 'THREE.BufferGeometryUtils: .mergeBufferGeometries() failed while trying to merge the ' + name + ' attribute.' );
				return null;

			}

			mergedGeometry.setAttribute( name, mergedAttribute );

		}

		// merge morph attributes

		for ( var name in morphAttributes ) {

			var numMorphTargets = morphAttributes[ name ][ 0 ].length;

			if ( numMorphTargets === 0 ) break;

			mergedGeometry.morphAttributes = mergedGeometry.morphAttributes || {};
			mergedGeometry.morphAttributes[ name ] = [];

			for ( var i = 0; i < numMorphTargets; ++ i ) {

				var morphAttributesToMerge = [];

				for ( var j = 0; j < morphAttributes[ name ].length; ++ j ) {

					morphAttributesToMerge.push( morphAttributes[ name ][ j ][ i ] );

				}

				var mergedMorphAttribute = this.mergeBufferAttributes( morphAttributesToMerge );

				if ( ! mergedMorphAttribute ) {

					console.error( 'THREE.BufferGeometryUtils: .mergeBufferGeometries() failed while trying to merge the ' + name + ' morphAttribute.' );
					return null;

				}

				mergedGeometry.morphAttributes[ name ].push( mergedMorphAttribute );

			}

		}

		return mergedGeometry;

	},

	/**
	 * @param {Array<THREE.BufferAttribute>} attributes
	 * @return {THREE.BufferAttribute}
	 */
	mergeBufferAttributes: function ( attributes ) {

		var TypedArray;
		var itemSize;
		var normalized;
		var arrayLength = 0;

		for ( var i = 0; i < attributes.length; ++ i ) {

			var attribute = attributes[ i ];

			if ( attribute.isInterleavedBufferAttribute ) {

				console.error( 'THREE.BufferGeometryUtils: .mergeBufferAttributes() failed. InterleavedBufferAttributes are not supported.' );
				return null;

			}

			if ( TypedArray === undefined ) TypedArray = attribute.array.constructor;
			if ( TypedArray !== attribute.array.constructor ) {

				console.error( 'THREE.BufferGeometryUtils: .mergeBufferAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes.' );
				return null;

			}

			if ( itemSize === undefined ) itemSize = attribute.itemSize;
			if ( itemSize !== attribute.itemSize ) {

				console.error( 'THREE.BufferGeometryUtils: .mergeBufferAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes.' );
				return null;

			}

			if ( normalized === undefined ) normalized = attribute.normalized;
			if ( normalized !== attribute.normalized ) {

				console.error( 'THREE.BufferGeometryUtils: .mergeBufferAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes.' );
				return null;

			}

			arrayLength += attribute.array.length;

		}

		var array = new TypedArray( arrayLength );
		var offset = 0;

		for ( var i = 0; i < attributes.length; ++ i ) {

			array.set( attributes[ i ].array, offset );

			offset += attributes[ i ].array.length;

		}

		return new THREE.BufferAttribute( array, itemSize, normalized );

	},

	/**
	 * @param {Array<THREE.BufferAttribute>} attributes
	 * @return {Array<THREE.InterleavedBufferAttribute>}
	 */
	interleaveAttributes: function ( attributes ) {

		// Interleaves the provided attributes into an InterleavedBuffer and returns
		// a set of InterleavedBufferAttributes for each attribute
		var TypedArray;
		var arrayLength = 0;
		var stride = 0;

		// calculate the the length and type of the interleavedBuffer
		for ( var i = 0, l = attributes.length; i < l; ++ i ) {

			var attribute = attributes[ i ];

			if ( TypedArray === undefined ) TypedArray = attribute.array.constructor;
			if ( TypedArray !== attribute.array.constructor ) {

				console.error( 'AttributeBuffers of different types cannot be interleaved' );
				return null;

			}

			arrayLength += attribute.array.length;
			stride += attribute.itemSize;

		}

		// Create the set of buffer attributes
		var interleavedBuffer = new THREE.InterleavedBuffer( new TypedArray( arrayLength ), stride );
		var offset = 0;
		var res = [];
		var getters = [ 'getX', 'getY', 'getZ', 'getW' ];
		var setters = [ 'setX', 'setY', 'setZ', 'setW' ];

		for ( var j = 0, l = attributes.length; j < l; j ++ ) {

			var attribute = attributes[ j ];
			var itemSize = attribute.itemSize;
			var count = attribute.count;
			var iba = new THREE.InterleavedBufferAttribute( interleavedBuffer, itemSize, offset, attribute.normalized );
			res.push( iba );

			offset += itemSize;

			// Move the data for each attribute into the new interleavedBuffer
			// at the appropriate offset
			for ( var c = 0; c < count; c ++ ) {

				for ( var k = 0; k < itemSize; k ++ ) {

					iba[ setters[ k ] ]( c, attribute[ getters[ k ] ]( c ) );

				}

			}

		}

		return res;

	},

	/**
	 * @param {Array<THREE.BufferGeometry>} geometry
	 * @return {number}
	 */
	estimateBytesUsed: function ( geometry ) {

		// Return the estimated memory used by this geometry in bytes
		// Calculate using itemSize, count, and BYTES_PER_ELEMENT to account
		// for InterleavedBufferAttributes.
		var mem = 0;
		for ( var name in geometry.attributes ) {

			var attr = geometry.getAttribute( name );
			mem += attr.count * attr.itemSize * attr.array.BYTES_PER_ELEMENT;

		}

		var indices = geometry.getIndex();
		mem += indices ? indices.count * indices.itemSize * indices.array.BYTES_PER_ELEMENT : 0;
		return mem;

	},

	/**
	 * @param {THREE.BufferGeometry} geometry
	 * @param {number} tolerance
	 * @return {THREE.BufferGeometry>}
	 */
	mergeVertices: function ( geometry, tolerance = 1e-4 ) {

		tolerance = Math.max( tolerance, Number.EPSILON );

		// Generate an index buffer if the geometry doesn't have one, or optimize it
		// if it's already available.
		var hashToIndex = {};
		var indices = geometry.getIndex();
		var positions = geometry.getAttribute( 'position' );
		var vertexCount = indices ? indices.count : positions.count;

		// next value for triangle indices
		var nextIndex = 0;

		// attributes and new attribute arrays
		var attributeNames = Object.keys( geometry.attributes );
		var attrArrays = {};
		var morphAttrsArrays = {};
		var newIndices = [];
		var getters = [ 'getX', 'getY', 'getZ', 'getW' ];

		// initialize the arrays
		for ( var i = 0, l = attributeNames.length; i < l; i ++ ) {

			var name = attributeNames[ i ];

			attrArrays[ name ] = [];

			var morphAttr = geometry.morphAttributes[ name ];
			if ( morphAttr ) {

				morphAttrsArrays[ name ] = new Array( morphAttr.length ).fill().map( () => [] );

			}

		}

		// convert the error tolerance to an amount of decimal places to truncate to
		var decimalShift = Math.log10( 1 / tolerance );
		var shiftMultiplier = Math.pow( 10, decimalShift );
		for ( var i = 0; i < vertexCount; i ++ ) {

			var index = indices ? indices.getX( i ) : i;

			// Generate a hash for the vertex attributes at the current index 'i'
			var hash = '';
			for ( var j = 0, l = attributeNames.length; j < l; j ++ ) {

				var name = attributeNames[ j ];
				var attribute = geometry.getAttribute( name );
				var itemSize = attribute.itemSize;

				for ( var k = 0; k < itemSize; k ++ ) {

					// double tilde truncates the decimal value
					hash += `${ ~ ~ ( attribute[ getters[ k ] ]( index ) * shiftMultiplier ) },`;

				}

			}

			// Add another reference to the vertex if it's already
			// used by another index
			if ( hash in hashToIndex ) {

				newIndices.push( hashToIndex[ hash ] );

			} else {

				// copy data to the new index in the attribute arrays
				for ( var j = 0, l = attributeNames.length; j < l; j ++ ) {

					var name = attributeNames[ j ];
					var attribute = geometry.getAttribute( name );
					var morphAttr = geometry.morphAttributes[ name ];
					var itemSize = attribute.itemSize;
					var newarray = attrArrays[ name ];
					var newMorphArrays = morphAttrsArrays[ name ];

					for ( var k = 0; k < itemSize; k ++ ) {

						var getterFunc = getters[ k ];
						newarray.push( attribute[ getterFunc ]( index ) );

						if ( morphAttr ) {

							for ( var m = 0, ml = morphAttr.length; m < ml; m ++ ) {

								newMorphArrays[ m ].push( morphAttr[ m ][ getterFunc ]( index ) );

							}

						}

					}

				}

				hashToIndex[ hash ] = nextIndex;
				newIndices.push( nextIndex );
				nextIndex ++;

			}

		}

		// Generate typed arrays from new attribute arrays and update
		// the attributeBuffers
		const result = geometry.clone();
		for ( var i = 0, l = attributeNames.length; i < l; i ++ ) {

			var name = attributeNames[ i ];
			var oldAttribute = geometry.getAttribute( name );

			var buffer = new oldAttribute.array.constructor( attrArrays[ name ] );
			var attribute = new THREE.BufferAttribute( buffer, oldAttribute.itemSize, oldAttribute.normalized );

			result.setAttribute( name, attribute );

			// Update the attribute arrays
			if ( name in morphAttrsArrays ) {

				for ( var j = 0; j < morphAttrsArrays[ name ].length; j ++ ) {

					var oldMorphAttribute = geometry.morphAttributes[ name ][ j ];

					var buffer = new oldMorphAttribute.array.constructor( morphAttrsArrays[ name ][ j ] );
					var morphAttribute = new THREE.BufferAttribute( buffer, oldMorphAttribute.itemSize, oldMorphAttribute.normalized );
					result.morphAttributes[ name ][ j ] = morphAttribute;

				}

			}

		}

		// indices

		result.setIndex( newIndices );

		return result;

	},

	/**
	 * @param {THREE.BufferGeometry} geometry
	 * @param {number} drawMode
	 * @return {THREE.BufferGeometry>}
	 */
	toTrianglesDrawMode: function ( geometry, drawMode ) {

		if ( drawMode === THREE.TrianglesDrawMode ) {

			console.warn( 'THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles.' );
			return geometry;

		}

		if ( drawMode === THREE.TriangleFanDrawMode || drawMode === THREE.TriangleStripDrawMode ) {

			var index = geometry.getIndex();

			// generate index if not present

			if ( index === null ) {

				var indices = [];

				var position = geometry.getAttribute( 'position' );

				if ( position !== undefined ) {

					for ( var i = 0; i < position.count; i ++ ) {

						indices.push( i );

					}

					geometry.setIndex( indices );
					index = geometry.getIndex();

				} else {

					console.error( 'THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible.' );
					return geometry;

				}

			}

			//

			var numberOfTriangles = index.count - 2;
			var newIndices = [];

			if ( drawMode === THREE.TriangleFanDrawMode ) {

				// gl.TRIANGLE_FAN

				for ( var i = 1; i <= numberOfTriangles; i ++ ) {

					newIndices.push( index.getX( 0 ) );
					newIndices.push( index.getX( i ) );
					newIndices.push( index.getX( i + 1 ) );

				}

			} else {

				// gl.TRIANGLE_STRIP

				for ( var i = 0; i < numberOfTriangles; i ++ ) {

					if ( i % 2 === 0 ) {

						newIndices.push( index.getX( i ) );
						newIndices.push( index.getX( i + 1 ) );
						newIndices.push( index.getX( i + 2 ) );


					} else {

						newIndices.push( index.getX( i + 2 ) );
						newIndices.push( index.getX( i + 1 ) );
						newIndices.push( index.getX( i ) );

					}

				}

			}

			if ( ( newIndices.length / 3 ) !== numberOfTriangles ) {

				console.error( 'THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.' );

			}

			// build final geometry

			var newGeometry = geometry.clone();
			newGeometry.setIndex( newIndices );
			newGeometry.clearGroups();

			return newGeometry;

		} else {

			console.error( 'THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:', drawMode );
			return geometry;

		}

	}

};

//Basic skeleton for the overall namespace of the A-Starry-Sky
AWater = {
  AOcean:{
    DefaultData: {},
    Materials: {
      FFTWaves: {},
      Ocean: {}
    },
    Renderers: {},
    LUTlibraries: {},
  },
  setActiveCamera: (camera) => {
      if(AWater.AOcean.OceanGrid !== null){
        AWater.AOcean.OceanGrid.camera = camera;
      }
    },
    getActiveCamera: () => {s
      if(AWater.AOcean.OceanGrid !== null){
        return AWater.AOcean.OceanGrid.camera;
      }
      return false;
    }
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.noiseShaderMaterialData = {
  uniforms: {
    offset: {type: 'f', value: 1.0},
  },

  fragmentShader: [
    'precision highp float;',

    'uniform float offset;',

    '//From http://byteblacksmith.com/improvements-to-the-canonical-one-liner-glsl-rand-for-opengl-es-2-0/',
    'float rand(float x){',
        'float a = 12.9898;',
        'float b = 78.233;',
        'float c = 43758.5453;',
        'float dt= dot(vec2(x, x) ,vec2(a,b));',
        'float sn= mod(dt,3.14);',
        'return fract(sin(sn) * c);',
    '}',

    'void main(){',
      'vec2 uv = gl_FragCoord.xy / resolution.xy;',
      'gl_FragColor = vec4(vec3(rand((resolution.x * (uv.x + uv.y * resolution.y)) * offset)), 1.0);',
    '}',
  ].join('\n')
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.h0ShaderMaterialData = {
  uniforms: {
    N: {type: 'f', value: 256.0},
    L: {type: 'f', value: 1000.0},
    A: {type: 'f', value: 20.0},
    L_: {type: 'f', value: 0.0},
    w: {type: 'v2', value: new THREE.Vector2(1.0, 0.0)}
  },

  fragmentShader: [
    'precision highp float;',

    '//With a lot of help from https://youtu.be/i0BPrGuOdPo',
    'uniform float N; //256.0',
    'uniform float L; //1000.0',
    'uniform float A; //20',
    'uniform vec2 w;//(1,0)',
    'uniform float L_; //Windspeed squared over the gravitational acceleration',

    'const float g = 9.80665;',
    'const float pi = 3.141592653589793238462643383279502884197169;',
    'const float piTimes2 = 6.283185307179586476925286766559005768394338798750211641949;',
    'const float oneOverSqrtOf2 = 0.707106781186547524400844362104849039284835937688474036588;',

    '//Box-Muller Method',
    'vec4 gaussRand(vec2 uv){',
      'vec2 texCoord = vec2(uv.xy);',
      'float noise00 = clamp(texture2D(textureNoise1, texCoord).r + 0.00001, 0.0, 1.0);',
      'float noise01 = clamp(texture2D(textureNoise2, texCoord).r + 0.00001, 0.0, 1.0);',
      'float noise02 = clamp(texture2D(textureNoise3, texCoord).r + 0.00001, 0.0, 1.0);',
      'float noise03 = clamp(texture2D(textureNoise4, texCoord).r + 0.00001, 0.0, 1.0);',

      'float u0 = piTimes2 * noise00;',
      'float v0 = sqrt(-2.0 * log(noise01));',
      'float u1 = piTimes2 * noise02;',
      'float v1 = sqrt(-2.0 * log(noise03));',

      'return vec4(v0 * cos(u0), v0 * sin(u0), v1 * cos(u1), v1 * sin(u1));',
    '}',

    'void main(){',
      'vec2 uv = gl_FragCoord.xy / resolution.xy;',
      'vec2 x = uv.xy * N;',
      'vec2 k = vec2(piTimes2 / L) * x;',
      'float magK = length(k);',
      'if (magK < 0.0001) magK = 0.0001;',
      'float magSq = magK * magK;',
      'float L_ = 26.0 * 26.0 / 9.80665;',
      'float h0_coeficient = sqrt(A / (magSq * magSq)) * exp(-1.0/(magSq * L_ * L_)) * exp(-magSq * pow(L / 2000.0, 2.0)) / sqrt(2.0);',

      '//sqrt(Ph(k) / sqrt(2))',
      'float h0_k = clamp(h0_coeficient * pow(dot(normalize(k), normalize(w)), 2.0), 0.0, 1000000.0);',

      '//sqrt(Ph(-k) / sqrt(2))',
      'float h0_minus_k = clamp(h0_coeficient * pow(dot(normalize(-k), normalize(w)), 2.0), 0.0, 1000000.0);',

      'vec4 gaussianRandomNumber = gaussRand(uv);',

      'gl_FragColor =vec4(gaussianRandomNumber.xy * h0_k, gaussianRandomNumber.zw * h0_minus_k);',
    '}',
  ].join('\n')
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.hkShaderMaterialData = {
  uniforms: {
    textureH0: {type: 't', value: null},
    N: {type: 'f', value: 256.0},
    L: {type: 'f', value: 1000.0},
    uTime: {type: 'f', value: 0.0}
  },

  fragmentShader: function(isXAxis = false, isYAxis = false){
    let originalGLSL = [
    'precision highp float;',

    '//With a lot of help from https://youtu.be/i0BPrGuOdPo',
    'uniform sampler2D textureH0;',
    'uniform float L; //1000.0',
    'uniform float N; //256.0',
    'uniform float uTime; //0.0',
    'const float g = 9.80665;',
    'const float piTimes2 = 6.283185307179586476925286766559005768394338798750211641949;',
    'const float pi = 3.141592653589793238462643383279502884197169;',

    'vec2 cMult(vec2 a, vec2 b){',
      'return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);',
    '}',

    'vec2 cAdd(vec2 a, vec2 b){',
      'return vec2(a.x + b.x, a.y + b.y);',
    '}',

    'vec2 conjugate(vec2 a){',
      'return vec2(a.x, -1.0 * a.y);',
    '}',

    'void main(){',
      'vec2 uv = gl_FragCoord.xy / resolution.xy;',
      'vec2 x = uv.xy * N;',
      'vec2 k = vec2(piTimes2 / L) * x;',
      'float magK = length(k);',
      'if (magK < 0.0001) magK = 0.0001;',
      'float w = sqrt(g * magK);',

      'vec4 tilda_h0 = texture2D(textureH0, uv.xy);',
      'vec2 tilda_h0_k = tilda_h0.rg;',
      'vec2 tilda_h0_minus_k_conj = conjugate(tilda_h0.ba);',

      'float cosOfWT = cos(w * uTime);',
      'float sinOfWT = sin(w * uTime);',

      '//Euler Formula',
      'vec2 expIwt = vec2(cosOfWT, sinOfWT);',
      'vec2 expIwtConj = vec2(cosOfWT, -sinOfWT);',

      '//dy',
      'vec2 hk_tilda = cAdd(cMult(tilda_h0_k, expIwt), cMult(tilda_h0_minus_k_conj, expIwtConj));',

      '#if($isXAxis)',
        'vec2 dx = vec2(0.0, -k.x / magK);',
        'hk_tilda = cMult(dx, hk_tilda);',
      '#elif(!$isXAxis && !$isYAxis)',
        'vec2 dy = vec2(0.0, -k.y / magK);',
        'hk_tilda = cMult(dy, hk_tilda);',
      '#endif',
      'gl_FragColor = vec4(hk_tilda, 0.0, 1.0);',
    '}',
    ];

    let updatedLines = [];
    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      let updatedGLSL = originalGLSL[i].replace(/\$isXAxis/g, isXAxis ? '1' : '0');
      updatedGLSL = updatedGLSL.replace(/\$isYAxis/g, isYAxis ? '1' : '0');
      //Otherwise is z-axis, and sure, it is true these are dependent values but this is just easier

      updatedLines.push(updatedGLSL);
    }

    return updatedLines.join('\n');
  }
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.heightMapShaderData = {
  uniforms: {
    pingpongTexture: {type: 't', value: null},
    oneOverNSquared: {type: 'f', value: 1.0},
  },

  fragmentShader: [
    'precision highp float;',

    '//With a lot of help from https://youtu.be/8kgpxtggFog',
    'uniform sampler2D pingpongTexture;',
    'uniform float oneOverNSquared;',

    '//We might want to do this in the vertex shader rather then',
    '//running through another shader pass for this.',
    'void main(){',
      'vec2 uv = vWorldPosition.xy;',
      '//float h = texture2D(pingpongTexture, position).r;',
      '//gl_FragColor = vec4(vec3(h * oneOverNSquared), 1.0);',
      'gl_FragColor = vec4(texture2D(pingpongTexture, position).r, 0.0, 0.0, 1.0);',
    '}',
  ].join('\n')
};

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

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.butterflyTextureData = {
  uniforms: {
    twiddleTexture: {type: 't', value: null},
    stageFraction: {type: 'f', value: 0.0},
    direction: {type: 'i', value: 1}
  },

  fragmentShader: function(pingpong_id, injectVariable = false){
    let glsl = [
    'precision highp float;',

    'varying vec3 vWorldPosition;',

    '//With a lot of help from https://youtu.be/i0BPrGuOdPo',
    'uniform sampler2D twiddleTexture;',
    'uniform float stageFraction;',
    'uniform int direction;',

    'const float pi = 3.141592653589793238462643383279502884197169;',

    'vec2 cMult(vec2 a, vec2 b){',
      'return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);',
    '}',

    'vec2 cAdd(vec2 a, vec2 b){',
      'return vec2(a.x + b.x, a.y + b.y);',
    '}',

    'vec4 horizontalButterflies(vec2 position){',
      'vec4 data = texture2D(twiddleTexture, vec2(stageFraction, position.x));',

      `vec2 p = texture2D(pingpong_${pingpong_id}, vec2(data.z, position.y)).rg;`,
      `vec2 q = texture2D(pingpong_${pingpong_id}, vec2(data.w, position.y)).rg;`,
      'vec2 w = vec2(data.x, data.y);',

      'vec2 H = cAdd(p, cMult(w, q));',
      'return vec4(H, 0.0, 1.0);',
    '}',

    'vec4 verticalButterflies(vec2 position){',
      'vec4 data = texture2D(twiddleTexture, vec2(stageFraction, position.y));',

      `vec2 p = texture2D(pingpong_${pingpong_id}, vec2(position.x, data.z)).rg;`,
      `vec2 q = texture2D(pingpong_${pingpong_id}, vec2(position.x, data.w)).rg;`,
      'vec2 w = vec2(data.x, data.y);',

      'vec2 H = cAdd(p, cMult(w, q));',
      'return vec4(H, 0.0, 1.0);',
    '}',

    'void main(){',
      'if(direction == 0){',
    '		gl_FragColor = horizontalButterflies(gl_FragCoord.xy / resolution.xy);',
      '}',
    '	else if(direction == 1){',
    '		gl_FragColor = verticalButterflies(gl_FragCoord.xy / resolution.xy);',
      '}',
    '}',
    ];

    if(injectVariable){
      glsl = [`uniform sampler2D pingpong_${pingpong_id};`, ...glsl];
    }

    return glsl.join('\n');
  }
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.amplitudeFilterShaderMaterial = {
  uniforms: {
    frequencyRadiusStart: {type: 'f', value: 0.00},
    maxBandwidthStart: {type: 'f', value: 30000000.0},
  },

  fragmentShader: function(){
    return [
    'precision highp float;',

    'varying vec3 vWorldPosition;',

    'uniform float frequencyRadiusStart;',
    'uniform float maxBandwidthStart;',

    'void main(){',
      'vec2 position = gl_FragCoord.xy / resolution.xy;',
      'vec2 hkTexel = texture2D(textureHk, position).rg;',

      '//Low has a radius greater than 0.05 and a band limit of 10000',
      '//Low medium has a radius greater than 0.01 and a band limit of 750000',
      '//medium has a radius greater than 0.002 and a band limit of 10000000.0',
      '//medium high as a radius greater than 0.0014 and a band limit of 30000000.0',

      "//This could use fading... but for now, we don't need fading, we need this to work",
      '//So our filters are hard.',
      'float redChannelOut = 0.0;',
      'float greenChannelOut = 0.0;',
      'float radiusOfFrequency = sqrt(position.x * position.x + position.y * position.y);',
      'bool frequencyInRange = radiusOfFrequency > frequencyRadiusStart;',
      'if(abs(hkTexel.r) < maxBandwidthStart && frequencyInRange){',
        'redChannelOut = hkTexel.r;',
      '}',
      'if(abs(hkTexel.g) < maxBandwidthStart && frequencyInRange){',
        'greenChannelOut = hkTexel.g;',
      '}',

      'gl_FragColor = vec4(redChannelOut, greenChannelOut, 0.0, 1.0);',
    '}',
    ].join('\n');
  }
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.waveComposerShaderMaterial = {
  uniforms: function(numberOfWaveComponents){
    return {
      xWavetextures: {value: new Array(numberOfWaveComponents)},
      yWavetextures: {value: new Array(numberOfWaveComponents)},
      zWavetextures: {value: new Array(numberOfWaveComponents)},
      N: {type: 'f', value: 0.0}
    };
  },

  fragmentShader: function(numberOfWaveComponents){
    let originalGLSL = [
    'varying vec3 vWorldPosition;',

    'uniform sampler2D xWavetextures[$total_offsets];',
    'uniform sampler2D yWavetextures[$total_offsets];',
    'uniform sampler2D zWavetextures[$total_offsets];',
    'uniform float N;',

    'float fModulo1(float a){',
      'return (a - floor(a));',
    '}',

    'void main(){',
      'vec2 position = gl_FragCoord.xy / resolution.xy;',
      'float sizeExpansion = (resolution.x + 1.0) / resolution.x; //Expand by exactly one pixel',
      'vec2 uv = sizeExpansion * position;',
      'vec2 wrappedUV = vec2(fModulo1(uv.x), fModulo1(uv.y));',
      'vec3 combinedWaveHeight = vec3(0.0);',

      '//Interpolations',
      'float waveHeight_x;',
      'float waveHeight_y;',
      'float waveHeight_z;',

      '$unrolled_wave_composer',

      'gl_FragColor = vec4(combinedWaveHeight / ($total_offsets_float * N * N), 1.0);',
    '}',
    ];

    let numberOfWaveComponentsGLSL = "";
    for(let i = 0; i < numberOfWaveComponents; ++i){
      numberOfWaveComponentsGLSL += `waveHeight_x = texture2D(xWavetextures[${i}], wrappedUV).x;\n`;
      numberOfWaveComponentsGLSL += `waveHeight_y = texture2D(yWavetextures[${i}], wrappedUV).x;\n`;
      numberOfWaveComponentsGLSL += `waveHeight_z = texture2D(zWavetextures[${i}], wrappedUV).x;\n`;
      numberOfWaveComponentsGLSL += "combinedWaveHeight += vec3(waveHeight_x, waveHeight_y, waveHeight_z);\n";
    }

    let updatedLines = [];

    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      let updatedCode = originalGLSL[i];
      updatedCode = updatedCode.replace(/\$unrolled_wave_composer/g, numberOfWaveComponentsGLSL);
      updatedCode = updatedCode.replace(/\$total_offsets_float/g, numberOfWaveComponents + '.0');
      updatedCode = updatedCode.replace(/\$total_offsets/g, numberOfWaveComponents);
      updatedLines.push(updatedCode);
    }

    return updatedLines.join('\n');
  }
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.FFTWaves.waveHeightShaderMaterialData = {
  uniforms: {
    combinedWaveHeights: {type: 't', value: null},
    N: {type: 'f', value: 0.0},
    waveHeightMultiplier: {type: 'f', value: 1.0}
  },

  fragmentShader: [
    'precision highp float;',

    'uniform sampler2D combinedWaveHeights;',
    'uniform float N;',
    'uniform float waveHeightMultiplier;',

    'void main(){',
      'vec2 uv = gl_FragCoord.xy / resolution.xy;',
      'float outputputColor = waveHeightMultiplier * texture2D(combinedWaveHeights, uv).xyz / (N * N);',

      'gl_FragColor = vec4(vec3(outputColor), determinant);',
    '}',
  ].join('\n')
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.Ocean.positionPassMaterial = {
  uniforms: {
    worldMatrix: {type: 'mat4', value: new THREE.Matrix4()},
    viewMatrix: {type: 'mat4', value: new THREE.Matrix4()},
  },

  fragmentShader: [
    'varying vec3 vWorldPosition;',

    'void main(){',
      '//Check if we are above or below the water to see what kind of fog is applied',
      'gl_FragColor = vec4(vWorldPosition, 1.0);',
    '}',
  ].join('\n'),

  vertexShader: [
    'precision highp float;',

    '//attribute vec3 baseDepth;',
    'varying vec3 vWorldPosition;',
    'uniform mat4 worldMatrix;',

    'void main() {',
      'vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
      'vWorldPosition = worldPosition.xyz / worldPosition.w;',

      'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n'),
};

AWater.AOcean.LUTlibraries.OceanHeightBandLibrary = function(parentOceanGrid){
  let renderer = parentOceanGrid.renderer;
  let data = parentOceanGrid.data;
  this.numLevels = parentOceanGrid.numberOfOceanHeightBands;

  //Enable the OES_texture_float_linear extension
  if(!renderer.capabilities.isWebGL2 && !renderer.extensions.get("OES_texture_float_linear")){
    console.error("No linear interpolation of OES textures allowed.");
    return false;
  }

  //Key inner variables
  this.staticGPUComputer;
  this.hkRenderer;
  this.noiseVar1;
  this.noiseVar2;
  this.noiseVar3;
  this.noiseVar4;
  this.noiseTexture1;
  this.noiseTexture2;
  this.noiseTexture3;
  this.noiseTexture4;
  this.h0Var;
  this.h0Texture;
  this.hkXVar;
  this.hkYVar;
  this.hkZVar;
  this.hkXTexture;
  this.hkYTexture;
  this.hkZTexture;
  this.textureWidth = data.patch_data_size;
  this.textureHeight = data.patch_data_size;

  //The main library that is used in our wave engine
  this.filteredHkXTextures = new Array(this.numLevels);
  this.filteredHkYTextures = new Array(this.numLevels);
  this.filteredHkZTextures = new Array(this.numLevels);
  this.wavesXFilteredByAmplitude = new Array(this.numLevels);
  this.wavesYFilteredByAmplitude = new Array(this.numLevels);
  this.wavesZFilteredByAmplitude = new Array(this.numLevels);

  this.N = data.number_of_octaves; //N is The number of octaves that are used for the FFT
  this.L = data.patch_size; //L is the horizontal dimension of the patch
  let windVelocity = new THREE.Vector2(data.wind_velocity.x, data.wind_velocity.y);
  this.L_ = windVelocity.dot(windVelocity) * data.patch_data_size; //(Wind speed squared divided by gravity) (For some reason this gets multipled by the patch size?)
  this.w = windVelocity.clone().normalize(); //w is the wind direction
  this.renderer = renderer;
  document.body.appendChild(renderer.domElement);

  //Now compute our twiddle data for injection
  this.twiddleTexture = AWater.AOcean.Materials.FFTWaves.computeTwiddleIndices(this.N, renderer);

  //From https://planetcalc.com/4442/
  let maxWaveAmplitutude = 0.54 * this.L_;

  this.staticGPUComputer = new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer);
  this.hkRenderer = new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer);
  let hkRenderer = this.hkRenderer;

  //Make a shortcut to our materials namespace
  const materials = AWater.AOcean.Materials.FFTWaves;

  //Create 4 different textures for each of our noise LUTs.
  let offset = this.textureWidth * this.textureHeight;
  let staticGPUCompute = this.staticGPUComputer;
  this.noiseTexture1 = staticGPUCompute.createTexture();
  this.noiseVar1 = staticGPUCompute.addVariable('textureNoise1', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture1);
  let noiseVar1 = this.noiseVar1;
  noiseVar1.minFilter = THREE.ClosestFilter;
  noiseVar1.magFilter = THREE.ClosestFilter;
  staticGPUCompute.setVariableDependencies(noiseVar1, []);
  noiseVar1.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  noiseVar1.material.uniforms.offset.value = 1.0;
  this.noiseTexture2 = staticGPUCompute.createTexture();
  this.noiseVar2 = staticGPUCompute.addVariable('textureNoise2', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture2);
  let noiseVar2 = this.noiseVar2;
  staticGPUCompute.setVariableDependencies(noiseVar2, []);
  noiseVar2.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  noiseVar2.material.uniforms.offset.value = noiseVar1.material.uniforms.offset.value + this.textureWidth * this.textureHeight;
  noiseVar2.minFilter = THREE.ClosestFilter;
  noiseVar2.magFilter = THREE.ClosestFilter;
  this.noiseTexture3 = staticGPUCompute.createTexture();
  this.noiseVar3 = staticGPUCompute.addVariable('textureNoise3', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture3);
  let noiseVar3 = this.noiseVar3;
  staticGPUCompute.setVariableDependencies(noiseVar3, []);
  noiseVar3.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  noiseVar3.material.uniforms.offset.value = noiseVar2.material.uniforms.offset.value + this.textureWidth * this.textureHeight;
  noiseVar3.minFilter = THREE.ClosestFilter;
  noiseVar3.magFilter = THREE.ClosestFilter;
  this.noiseTexture4 = staticGPUCompute.createTexture();
  this.noiseVar4 = staticGPUCompute.addVariable('textureNoise4', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture4);
  let noiseVar4 = this.noiseVar4;
  staticGPUCompute.setVariableDependencies(noiseVar4, []);
  noiseVar4.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  noiseVar4.material.uniforms.offset.value = noiseVar3.material.uniforms.offset.value + this.textureWidth * this.textureHeight;
  noiseVar4.minFilter = THREE.ClosestFilter;
  noiseVar4.magFilter = THREE.ClosestFilter;

  //Produce the textures for our h0 shader
  this.h0Texture = staticGPUCompute.createTexture();
  this.h0Var = staticGPUCompute.addVariable('textureH0', materials.h0ShaderMaterialData.fragmentShader, this.h0Texture);
  this.h0Var.minFilter = THREE.ClosestFilter;
  this.h0Var.magFilter = THREE.ClosestFilter;
  let h0Var = this.h0Var;
  staticGPUCompute.setVariableDependencies(h0Var, [noiseVar1, noiseVar2, noiseVar3, noiseVar4]);
  h0Var.material.uniforms = {
    ...h0Var.material.uniforms,
    ...JSON.parse(JSON.stringify(materials.h0ShaderMaterialData.uniforms))
  }
  h0Var.material.uniforms.N.value = this.N;
  h0Var.material.uniforms.L.value = this.L;
  h0Var.material.uniforms.A.value = maxWaveAmplitutude;
  h0Var.material.uniforms.L_.value = this.L_;
  h0Var.material.uniforms.w.value = this.w.clone();

  //Now compute our h_0 texture for future use
  let error1 = staticGPUCompute.init();
  if(error1 !== null){
    console.error(`Static GPU Compute Renderer: ${error1}`);
  }
  staticGPUCompute.compute();
  staticGPUCompute.compute(); //Must be run twice to fill up second ping pong shader? Weird.

  //Initialize our h_k shader
  this.hkYTexture = hkRenderer.createTexture();
  this.hkYVar = hkRenderer.addVariable('textureHk', materials.hkShaderMaterialData.fragmentShader(false, true), this.hkYTexture);
  let hkYVar = this.hkYVar;
  this.hkYVar.minFilter = THREE.ClosestFilter;
  this.hkYVar.magFilter = THREE.ClosestFilter;
  hkRenderer.setVariableDependencies(hkYVar, []);//Note: We use manual texture dependency injection here.
  hkYVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
  hkYVar.material.uniforms.textureH0.value = this.staticGPUComputer.getCurrentRenderTarget(h0Var).texture;
  hkYVar.material.uniforms.L.value = 1000.0;
  hkYVar.material.uniforms.uTime.value = 500.0;
  hkYVar.material.uniforms.N.value = this.N;

  //Z-Shader
  this.hkXTexture = hkRenderer.createTexture();
  this.hkXVar = hkRenderer.addVariable('textureHk', materials.hkShaderMaterialData.fragmentShader(true, false), this.hkXTexture);
  let hkXVar = this.hkXVar;
  this.hkXVar.minFilter = THREE.ClosestFilter;
  this.hkXVar.magFilter = THREE.ClosestFilter;
  hkRenderer.setVariableDependencies(hkXVar, []);//Note: We use manual texture dependency injection here.
  hkXVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
  hkXVar.material.uniforms.textureH0.value = this.staticGPUComputer.getCurrentRenderTarget(h0Var).texture;
  hkXVar.material.uniforms.L.value = 1000.0;
  hkXVar.material.uniforms.uTime.value = 500.0;
  hkXVar.material.uniforms.N.value = this.N;

  //X-Axis
  this.hkZTexture = hkRenderer.createTexture();
  this.hkZVar = hkRenderer.addVariable('textureHk', materials.hkShaderMaterialData.fragmentShader(false, false), this.hkZTexture);
  let hkZVar = this.hkZVar;
  this.hkZVar.minFilter = THREE.ClosestFilter;
  this.hkZVar.magFilter = THREE.ClosestFilter;
  hkRenderer.setVariableDependencies(hkZVar, []);//Note: We use manual texture dependency injection here.
  hkZVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
  hkZVar.material.uniforms.textureH0.value = this.staticGPUComputer.getCurrentRenderTarget(h0Var).texture;
  hkZVar.material.uniforms.L.value = 1000.0;
  hkZVar.material.uniforms.uTime.value = 500.0;
  hkZVar.material.uniforms.N.value = this.N;

  //Now set up each of our filters
  this.hkXBandTextures = [];
  this.hkXBandVars = [];
  this.hkYBandTextures = [];
  this.hkYBandVars = [];
  this.hkZBandTextures = [];
  this.hkZBandVars = [];

  //This. This is totally ad-hoc crud. It's probably some exponentials or hyper-exponentials,
  //but fact that the numbers are as they are really makes little sense to me.
  //Honestly, the mere sight of this fills me with disgust. Blegh! I spit upon thee magic numbers!
  let frequencyRadaii = [0.05, 0.01, 0.002, 0.0014, 0.0];
  let bandFrequencyLimits = [10000.0, 750000.0, 10000000.0, 30000000.0, 100000000.0];
  for(let i = 0; i < this.numLevels; i++){
    this.hkYBandTextures.push(hkRenderer.createTexture());
    this.hkYBandVars.push(hkRenderer.addVariable(`textureHkYBand_${i}`, materials.amplitudeFilterShaderMaterial.fragmentShader(false, true), this.hkYBandTextures[i]));
    hkRenderer.setVariableDependencies(this.hkYBandVars[i], [hkYVar]);//Note: We use manual texture dependency injection here.
    this.hkYBandVars[i].material.uniforms = JSON.parse(JSON.stringify(materials.amplitudeFilterShaderMaterial.uniforms));
    this.hkYBandVars[i].material.uniforms.frequencyRadiusStart.value = frequencyRadaii[i];
    this.hkYBandVars[i].material.uniforms.maxBandwidthStart.value = bandFrequencyLimits[i];
    this.hkYBandVars[i].minFilter = THREE.ClosestFilter;
    this.hkYBandVars[i].magFilter = THREE.ClosestFilter;

    this.hkXBandTextures.push(hkRenderer.createTexture());
    this.hkXBandVars.push(hkRenderer.addVariable(`textureHkXBand_${i}`, materials.amplitudeFilterShaderMaterial.fragmentShader(true, false), this.hkXBandTextures[i]));
    hkRenderer.setVariableDependencies(this.hkXBandVars[i], [hkXVar]);//Note: We use manual texture dependency injection here.
    this.hkXBandVars[i].material.uniforms = JSON.parse(JSON.stringify(materials.amplitudeFilterShaderMaterial.uniforms));
    this.hkXBandVars[i].material.uniforms.frequencyRadiusStart.value = frequencyRadaii[i];
    this.hkXBandVars[i].material.uniforms.maxBandwidthStart.value = bandFrequencyLimits[i];
    this.hkXBandVars[i].minFilter = THREE.ClosestFilter;
    this.hkXBandVars[i].magFilter = THREE.ClosestFilter;

    this.hkZBandTextures.push(hkRenderer.createTexture());
    this.hkZBandVars.push(hkRenderer.addVariable(`textureHkZBand_${i}`, materials.amplitudeFilterShaderMaterial.fragmentShader(false, false), this.hkZBandTextures[i]));
    hkRenderer.setVariableDependencies(this.hkZBandVars[i], [hkZVar]);//Note: We use manual texture dependency injection here.
    this.hkZBandVars[i].material.uniforms = JSON.parse(JSON.stringify(materials.amplitudeFilterShaderMaterial.uniforms));
    this.hkZBandVars[i].material.uniforms.frequencyRadiusStart.value = frequencyRadaii[i];
    this.hkZBandVars[i].material.uniforms.maxBandwidthStart.value = bandFrequencyLimits[i];
    this.hkZBandVars[i].minFilter = THREE.ClosestFilter;
    this.hkZBandVars[i].magFilter = THREE.ClosestFilter;
  }

  let error3 = hkRenderer.init();
  if(error3 !== null){
    console.error(`Dynamic GPU Compute Renderer: ${error3}`);
  }
  hkRenderer.compute();

  //Now hook each of the above bands into each of our ocean wave height bands
  this.butterflyRenderers = [];
  this.butterflyTextureVarHolder = [];
  this.finalButterflyTextureVars = [];
  for(let dimension = 0; dimension < 3; dimension++){
    this.butterflyRenderers.push([]);
    this.butterflyTextureVarHolder.push([]);
    this.finalButterflyTextureVars.push([]);
    for(let i = 0; i < this.numLevels; i++){
      //Initialize our GPU Compute Renderer
      this.butterflyRenderers[dimension].push(new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer));
      let butterflyRenderer = this.butterflyRenderers[dimension][i];

      //Set up our butterfly height generator
      let butterflyTextureVars = [];
      let numPingPongIterations = Math.ceil(Math.log(this.N) / Math.log(2));
      let butterflyTextureInit = this.hkRenderer.createTexture();
      butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_0`, materials.butterflyTextureData.fragmentShader('hk_texture', true), butterflyTextureInit));
      butterflyRenderer.setVariableDependencies(butterflyTextureVars[0], []);
      butterflyTextureVars[0].material.uniforms = JSON.parse(JSON.stringify(materials.butterflyTextureData.uniforms));
      butterflyTextureVars[0].material.uniforms.pingpong_hk_texture = {};
      butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.type = 't';
      butterflyTextureVars[0].material.uniforms.pingpong_hk_texture.value = null;
      butterflyTextureVars[0].material.uniforms.direction.value = 0;
      butterflyTextureVars[0].material.uniforms.stageFraction.value = 0.0;
      butterflyTextureVars[0].material.uniforms.twiddleTexture.value = this.twiddleTexture;

      //Now we can perform the remaining butterfly operations using the above texture
      for(let i = 1; i < numPingPongIterations; i++){
        let butterFlyTexture = butterflyRenderer.createTexture();
        butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_${i}`, materials.butterflyTextureData.fragmentShader(i - 1), butterFlyTexture));
        butterflyRenderer.setVariableDependencies(butterflyTextureVars[i], [butterflyTextureVars[i - 1]]);
        butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(materials.butterflyTextureData.uniforms));
        butterflyTextureVars[i].material.uniforms.direction.value = 0;
        butterflyTextureVars[i].material.uniforms.stageFraction.value = i / (numPingPongIterations - 1.0);
        butterflyTextureVars[i].material.uniforms.twiddleTexture.value = this.twiddleTexture;
        butterflyTextureVars[i].minFilter = THREE.NearestFilter;
        butterflyTextureVars[i].magFilter = THREE.NearestFilter;
      }
      let numPingPongIterationsTimes2 = numPingPongIterations * 2;
      for(let i = numPingPongIterations; i < numPingPongIterationsTimes2; i++){
        let butterFlyTexture = butterflyRenderer.createTexture();
        butterflyTextureVars.push(butterflyRenderer.addVariable(`pingpong_${i}`, materials.butterflyTextureData.fragmentShader(i - 1), butterFlyTexture));
        butterflyRenderer.setVariableDependencies(butterflyTextureVars[i], [butterflyTextureVars[i - 1]]);
        butterflyTextureVars[i].material.uniforms = JSON.parse(JSON.stringify(materials.butterflyTextureData.uniforms));
        butterflyTextureVars[i].material.uniforms.direction.value = 1;
        butterflyTextureVars[i].material.uniforms.stageFraction.value = (i - numPingPongIterations) / (numPingPongIterations - 1.0);
        butterflyTextureVars[i].material.uniforms.twiddleTexture.value = this.twiddleTexture;
        butterflyTextureVars[i].minFilter = THREE.NearestFilter;
        butterflyTextureVars[i].magFilter = THREE.NearestFilter;
      }
      this.finalButterflyTextureVars[dimension].push(butterflyTextureVars[numPingPongIterationsTimes2 - 1]);
      this.butterflyTextureVarHolder[dimension].push(butterflyTextureVars);

      let error4 = butterflyRenderer.init();
      if(error4 !== null){
        console.error(`Butterfly Texture Renderer: ${error4}`);
      }
      butterflyRenderer.compute();
    }
  }

  let self = this;
  this.tick = function(time, activeTextures){
    //Update the time variable of our phillipse spectrum and update hk
    self.hkXVar.material.uniforms.uTime.value = time / 512.0;
    self.hkYVar.material.uniforms.uTime.value = time / 512.0;
    self.hkZVar.material.uniforms.uTime.value = time / 512.0;
    self.hkRenderer.compute();

    //Grab each of the textures from each of our filters
    for(let i = 0; i < self.numLevels; ++i){
      //Get the hk for the given band
      self.butterflyTextureVarHolder[0][i][0].material.uniforms.pingpong_hk_texture.value = self.hkRenderer.getCurrentRenderTarget(self.hkXBandVars[i]).texture;
      self.butterflyRenderers[0][i].compute();

      //Store this for future requests
      self.wavesXFilteredByAmplitude[i] = self.butterflyRenderers[0][i].getCurrentRenderTarget(self.finalButterflyTextureVars[0][i]).texture;
    }

    for(let i = 0; i < self.numLevels; ++i){
      //Get the hk for the given band
      self.butterflyTextureVarHolder[1][i][0].material.uniforms.pingpong_hk_texture.value = self.hkRenderer.getCurrentRenderTarget(self.hkYBandVars[i]).texture;
      self.butterflyRenderers[1][i].compute();

      //Store this for future requests
      self.wavesYFilteredByAmplitude[i] = self.butterflyRenderers[1][i].getCurrentRenderTarget(self.finalButterflyTextureVars[1][i]).texture;
    }

    for(let i = 0; i < self.numLevels; ++i){
      //Get the hk for the given band
      self.butterflyTextureVarHolder[2][i][0].material.uniforms.pingpong_hk_texture.value = self.hkRenderer.getCurrentRenderTarget(self.hkZBandVars[i]).texture;
      self.butterflyRenderers[2][i].compute();

      //Store this for future requests
      self.wavesZFilteredByAmplitude[i] = self.butterflyRenderers[2][i].getCurrentRenderTarget(self.finalButterflyTextureVars[2][i]).texture;
    }
  };
}

AWater.AOcean.LUTlibraries.OceanHeightComposer = function(parentOceanGrid){
  let data = parentOceanGrid.data;
  this.renderer = parentOceanGrid.renderer;
  this.baseTextureWidth = data.patch_data_size;
  this.baseTextureHeight = data.patch_data_size;
  this.outputTextureWidth = this.baseTextureWidth;
  this.outputTextureHeight = this.baseTextureHeight;
  this.N = data.number_of_octaves;
  this.OceanMaterialHeightBandLibrary = parentOceanGrid.oceanHeightBandLibrary;
  this.numberOfWaveComponents = parentOceanGrid.numberOfOceanHeightBands;
  this.parentOceanGrid = parentOceanGrid;
  this.combinedWaveHeights;
  this.displacementMap;

  //Make a shortcut to our materials namespace
  const materials = AWater.AOcean.Materials.FFTWaves;

  //Initialize our wave height composer renderer
  this.waveHeightComposerRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
  this.waveFoamRenderer = new THREE.GPUComputationRenderer(this.baseTextureWidth, this.baseTextureHeight, this.renderer);
  this.waveHeightComposerTexture = this.waveHeightComposerRenderer.createTexture();
  this.waveHeightComposerVar = this.waveHeightComposerRenderer.addVariable('waveHeightTexture', materials.waveComposerShaderMaterial.fragmentShader(this.numberOfWaveComponents), this.waveHeightComposerTexture);
  let whcVar = this.waveHeightComposerVar;
  this.waveHeightComposerVar.material.uniforms.waveHeightMultiplier = data.wave_scale_multiple;
  this.waveHeightComposerVar.minFilter = THREE.LinearFilter;
  this.waveHeightComposerVar.magFilter = THREE.LinearFilter;
  this.waveHeightComposerVar.format = THREE.RGBAFormat;
  this.waveHeightComposerVar.type = THREE.FloatType;
  this.waveHeightComposerVar.anisotropy = 4;
  this.waveHeightComposerVar.samples = 8;
  this.waveHeightComposerVar.wrapS = THREE.RepeatWrapping;
  this.waveHeightComposerVar.wrapT = THREE.RepeatWrapping;
  this.waveHeightComposerVar.generateMipmaps = true;
  this.waveHeightComposerVar.needsUpdate = true;
  this.waveHeightComposerRenderer.setVariableDependencies(whcVar, []);//Note: We use manual texture dependency injection here.
  whcVar.material.uniforms = materials.waveComposerShaderMaterial.uniforms(this.numberOfWaveComponents);

  //Set our uniforms
  whcVar.material.uniforms.N.value = this.N;

  let error5 = this.waveHeightComposerRenderer.init();
  if(error5 !== null){
    console.error(`Wave Height Composer Renderer: ${error5}`);
  }
  this.waveHeightComposerRenderer.compute();

  let self = this;
  this.tick = function(){
    //Update our uniforms
    for(let i = 0; i < this.numberOfWaveComponents; ++i){
      self.waveHeightComposerVar.material.uniforms.xWavetextures.value[i] = this.OceanMaterialHeightBandLibrary.wavesXFilteredByAmplitude[i];
      self.waveHeightComposerVar.material.uniforms.yWavetextures.value[i] = this.OceanMaterialHeightBandLibrary.wavesYFilteredByAmplitude[i];
      self.waveHeightComposerVar.material.uniforms.zWavetextures.value[i] = this.OceanMaterialHeightBandLibrary.wavesZFilteredByAmplitude[i];
    }
    self.waveHeightComposerRenderer.compute();
    this.displacementMap = self.waveHeightComposerRenderer.getCurrentRenderTarget(self.waveHeightComposerVar).texture;
  };
}

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.Ocean.waterMaterial = {
  uniforms: {
    displacementMap: {type: 't', value: null},
    smallNormalMap: {type: 't', value: null},
    largeNormalMap: {type: 't', value: null},
    causticMap: {type: 't', value: null},
    causticIntensityMultiplier: {type: 'f', value: null},
    foamDiffuseMap: {type: 't', value: null},
    foamOpacityMap: {type: 't', value: null},
    foamNormalMap: {type: 't', value: null},
    foamRoughnessMap: {type: 't', value: null},
    foamRenderMap: {type: 't', value: null},
    foamStartLevel: {type: 'f', value: 0.0},
    exclusionMap: {type: 't', value: null},
    smallNormalMapVelocity: {type: 'vec2', value: new THREE.Vector2()},
    largeNormalMapVelocity: {type: 'vec2', value: new THREE.Vector2()},
    reflectionCubeMap: {value: null},
    refractionCubeMap: {value: null},
    depthCubeMap: {value: null},
    sizeOfOceanPatch: {type: 'f', value: 1.0},
    baseHeightOffset: {type: 'f', value: 0.0},
    fogNear: {type: 'f', value: null},
    fogFar: {type: 'f', value: null},
    fogDensity: {type: 'f', value: null},
    fogColor: {type: 'v3', value: new THREE.Color()},
    t: {type: 'f', value: 0.0},
    brightestDirectionalLight: {type: 'vec3', value: new THREE.Vector3(1.0,1.0,1.0)},
    brightestDirectionalLightDirection: {type: 'vec3', value: new THREE.Vector3(1.0,1.0,1.0)},
    largeNormalMapStrength: {type: 'f', value: 0.45},
    smallNormalMapStrength: {type: 'f', value: 0.35},
    lightScatteringAmounts: {type: 'vec3', value: new THREE.Vector3(88.0, 108.0, 112.0)},
    linearScatteringHeightOffset: {type: 'f', value: 10.0},
    linearScatteringTotalScatteringWaveHeight: {type: 'f', value: 20.0}
  },

  fragmentShader: function(causticsEnabled, foamEnabled){
    let originalGLSL = [
    'precision highp float;',

    'varying vec2 vUv;',
    'varying vec3 vPosition;',
    'varying vec3 vTangent;',
    'varying vec3 vBitangent;',
    'varying vec3 vInView;',
    'varying mat4 vInstanceMatrix;',
    'varying mat4 vModelMatrix;',
    'varying mat3 vNormalMatrix;',

    '//uniform vec3 cameraDirection;',
    'uniform float sizeOfOceanPatch;',
    'uniform float largeNormalMapStrength;',
    'uniform float smallNormalMapStrength;',
    'uniform float baseHeightOffset;',
    'uniform sampler2D displacementMap;',
    'uniform sampler2D smallNormalMap;',
    'uniform sampler2D largeNormalMap;',
    'uniform sampler2D exclusionMap;',
    'uniform samplerCube reflectionCubeMap;',
    'uniform samplerCube refractionCubeMap;',
    'uniform samplerCube depthCubeMap;',

    '#if($caustics_enabled)',
      'uniform sampler2D causticMap;',
      'uniform float causticIntensityMultiplier;',
    '#endif',

    '#if($foam_enabled)',
      '//Foam maps',
      'uniform sampler2D foamRenderMap;',
      'uniform sampler2D foamDiffuseMap;',
      'uniform sampler2D foamOpacityMap;',
      'uniform sampler2D foamNormalMap;',
      'uniform sampler2D foamRoughnessMap;',
      'uniform float foamStartLevel;',
    '#endif',

    'uniform vec2 smallNormalMapVelocity;',
    'uniform vec2 largeNormalMapVelocity;',

    'uniform vec3 brightestDirectionalLight;',
    'uniform vec3 brightestDirectionalLightDirection;',
    'uniform vec3 lightScatteringAmounts;',

    'uniform float linearScatteringHeightOffset;',
    'uniform float linearScatteringTotalScatteringWaveHeight;',

    'uniform float t;',

    '//Fog variables',
    '#include <fog_pars_fragment>',


    "//R0 For Schlick's Approximation",
    '//With n1 = 1.33 and n0 = 1.0',
    'const float r0 = 0.02;',
    'const vec3 inverseGamma = vec3(0.454545454545454545454545);',
    'const vec3 gamma = vec3(2.2);',

    'vec2 vec2Modulo(vec2 inputUV){',
        'return (inputUV - floor(inputUV));',
    '}',

    'vec4 sRGBToLinear( in vec4 value ) {',
    '	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );',
    '}',

    'vec4 linearTosRGB(vec4 value ) {',
      'return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );',
    '}',

    '//From https://blog.selfshadow.com/publications/blending-in-detail/',
    'vec3 combineNormals(vec3 normal1, vec3 normal2){',
      'vec4 n1 = vec4(normal1.xyz, 1.0);',
      'vec4 n2 = vec4(normal2.xyz, 1.0);',
      'n1 = n1.xyzz * vec4(2.0, 2.0, 2.0, -2.0) + vec4(-1.0, -1.0, -1.0, 1.0);',
      'n2 = n2 * 2.0 - vec4(1.0);',
      'vec3 r;',
      'r.x = dot(n1.zxx,  n2.xyz);',
      'r.y = dot(n1.yzy,  n2.xyz);',
      'r.z = dot(n1.xyw, -n2.xyz);',

      'return 0.5 * (normalize(r) + vec3(1.0));',
    '}',

    '//Including this because someone removed this in a future versio of THREE. Why?!',
    'vec3 MyAESFilmicToneMapping(vec3 color) {',
      'return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);',
    '}',

    '#if($caustics_enabled)',
      'float causticShader(vec2 uv, float t){',
        'float tModified = (t / 20.0);',
        'vec2 uv1 = uv + vec2(0.8, 0.1) * tModified;',
        'vec2 uv2 = uv - vec2(0.2, 0.7) * tModified;',
        'float aSample1 = texture(causticMap, uv1).r;',
        'float aSample2 = texture(causticMap, uv2).g;',
        'return min(aSample1, aSample2);',
      '}',
    '#endif',

    '//Converted from the Minstrel Water Engine',
    '/*',
    'MIT License',

    'Copyright (c) 2018 Jingping Yu',

    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',

    'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.',

    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
    'SOFTWARE.',
    '*/',
    '#if($foam_enabled)',
      'float foamAmount(vec2 vUv, float textureSize){',
        'float texelSize = 1.0 / textureSize;',
      '	vec2 dDdy = -0.5 * (texture2D(displacementMap, vUv + vec2(0.0, texelSize)).xz - texture2D(displacementMap, vUv + vec2(0.0, -texelSize)).xz) / 8.0;',
      '	vec2 dDdx = -0.5 * (texture2D(displacementMap, vUv + vec2(texelSize, 0.0)).xz - texture2D(displacementMap, vUv + vec2(-texelSize, 0.0)).xz) / 8.0;',
      '	float jacobian = (1.0 + dDdx.x) * (1.0 + dDdy.y) - dDdx.y * dDdy.x;',
      '	float turb = max(0.0, 1.0 - jacobian);',
      '	float xx = smoothstep(0.0, 1.0, turb);',
      '	return xx;',
      '}',
    '#endif',

    'void main(){',
      'mat3 instanceMatrixMat3 = mat3(vInstanceMatrix[0].xyz, vInstanceMatrix[1].xyz, vInstanceMatrix[2].xyz );',
      'mat3 modelMatrixMat3 = mat3(vModelMatrix[0].xyz, vModelMatrix[1].xyz, vModelMatrix[2].xyz );',
      'vec2 cameraOffset = vec2(cameraPosition.x, cameraPosition.z);',

      'vec2 uvOffset = (vUv * sizeOfOceanPatch + cameraOffset) / sizeOfOceanPatch;',
      'vec3 displacement = texture2D(displacementMap, uvOffset).xyz;',
      'displacement.x *= -1.0;',
      'displacement.z *= -1.0;',
      'vec3 offsetPosition = vPosition + displacement;',
      'float height = (offsetPosition.y  + linearScatteringHeightOffset) / linearScatteringTotalScatteringWaveHeight;',
      'vec4 worldPosition = vModelMatrix * vInstanceMatrix * vec4(offsetPosition, 1.0);',
      'vec2 exclusionPosition = 0.5 * (((worldPosition.xz - cameraPosition.xz) / vec2(1024.0)) + 1.0);',
      'exclusionPosition = vec2(exclusionPosition.x, 1.0 - exclusionPosition.y);',
      'if(exclusionPosition.x < 1.0 && exclusionPosition.x > 0.0 && exclusionPosition.y < 1.0 && exclusionPosition.y > 0.0){',
        'vec2 discardHeightData = texture2D(exclusionMap, exclusionPosition).ga;',
        'float discardHeight = discardHeightData.x;',
        'if((discardHeightData.y > 0.5) && worldPosition.y > discardHeight){',
          'discard;',
        '}',
      '}',
      'float distanceToWorldPosition = distance(worldPosition.xyz, cameraPosition.xyz);',
      'float LOD = pow(2.0, clamp(7.0 - (distanceToWorldPosition / (sizeOfOceanPatch * 7.0)), 2.0, 7.0));',

      '//Calculate our normal for this vertex',
      'float displacementFadeout = clamp((2500.0 - distanceToWorldPosition) / 2500.0, 0.0, 1.0);',
      'displacement *= displacementFadeout;',
      'vec3 tangent = vTangent;',
      'vec3 bitangent = vBitangent;',
      'vec3 deltaTangent = tangent / LOD;',
      'vec2 tangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset + deltaTangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;',
      'vec3 vt = texture2D(displacementMap, tangentUVOffset).xyz * displacementFadeout;',
      'vt.x *= -1.0;',
      'vt.z *= -1.0;',
      'vec3 deltaBitangent = bitangent / LOD;',
      'vec2 biTangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset + deltaBitangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;',
      'vec3 vb = texture2D(displacementMap, biTangentUVOffset).xyz * displacementFadeout;',
      'vb.x *= -1.0;',
      'vb.z *= -1.0;',
      '//Change in height with respect to x',
      'vec3 dhDt = normalize((vt + deltaTangent * sizeOfOceanPatch) - displacement);',
      '//Change in height with respect to z',
      'vec3 dhDbt = normalize((vb + deltaBitangent * sizeOfOceanPatch) - displacement);',
      'vec3 displacedNormal = cross(dhDt, dhDbt);',

      'tangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset - deltaTangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;',
      'vt = texture2D(displacementMap, tangentUVOffset).xyz * displacementFadeout;',
      'vt.x *= -1.0;',
      'vt.z *= -1.0;',
      'biTangentUVOffset = (vUv * sizeOfOceanPatch + cameraOffset - deltaBitangent.xz * sizeOfOceanPatch) / sizeOfOceanPatch;',
      'vb = texture2D(displacementMap, biTangentUVOffset).xyz * displacementFadeout;',
      'vb.x *= -1.0;',
      'vb.z *= -1.0;',
      '//Change in height with respect to x',
      'dhDt = normalize((vt - deltaTangent * sizeOfOceanPatch) - displacement);',
      '//Change in height with respect to z',
      'dhDbt = normalize((vb - deltaBitangent * sizeOfOceanPatch) - displacement);',
      'displacedNormal = (cross(dhDt, dhDbt) + displacedNormal) * 0.5;',
      'displacedNormal = normalize(displacedNormal);',

      '//Get the reflected and refracted information of the scene',
      'vec2 smallNormalMapOffset = (((vUv * 2.0) * (sizeOfOceanPatch / 2.0) + cameraOffset + t * smallNormalMapVelocity) / (sizeOfOceanPatch / 2.0));',
      'vec2 largeNormalMapOffset = (((vUv * 1.0) * (sizeOfOceanPatch / 1.0) + cameraOffset - t * largeNormalMapVelocity) / (sizeOfOceanPatch / 1.0));',
      'vec3 smallNormalMap = texture2D(smallNormalMap, smallNormalMapOffset).xyz;',
      'smallNormalMap = 2.0 * smallNormalMap - 1.0;',
      'float smallNormalMapFadeout = clamp((500.0 - distanceToWorldPosition) / 250.0, 0.0, 1.0);',
      'smallNormalMap.x *= smallNormalMapStrength * smallNormalMapFadeout;',
      'smallNormalMap.y *= smallNormalMapStrength * smallNormalMapFadeout;',
      'smallNormalMap = normalize(smallNormalMap);',
      'smallNormalMap = (smallNormalMap + 1.0) * 0.5;',
      'vec3 largeNormalMap = texture2D(largeNormalMap, largeNormalMapOffset).xyz;',
      'largeNormalMap = 2.0 * largeNormalMap - 1.0;',
      'float largeNormalMapFadeout = clamp((3000.0 - distanceToWorldPosition) / 2500.0, 0.0, 1.0);',
      'largeNormalMap.x *= largeNormalMapStrength * largeNormalMapFadeout;',
      'largeNormalMap.y *= largeNormalMapStrength * largeNormalMapFadeout;',
      'largeNormalMap = normalize(largeNormalMap);',
      'largeNormalMap = (largeNormalMap + 1.0) * 0.5;',
      'vec3 combinedNormalMap = combineNormals(smallNormalMap, largeNormalMap);',
      '#if($foam_enabled)',
        'vec3 foamNormal = texture2D(foamNormalMap, smallNormalMapOffset).xyz;',
        'foamNormal = 2.0 * foamNormal - 1.0;',
        'float foamAmount = foamAmount(uvOffset, 512.0);',
        'vec2 foamPosition = 0.5 * (((worldPosition.xz - cameraPosition.xz) / vec2(2048.0)) + 1.0);',
        'foamPosition = vec2(foamPosition.x, 1.0 - foamPosition.y);',
        'if(foamPosition.x < 1.0 && foamPosition.x > 0.0 && foamPosition.y < 1.0 && foamPosition.y > 0.0){',
          'vec2 foamHeightData = texture2D(foamRenderMap, foamPosition).ga;',
          'if((foamHeightData.y > 0.5)){',
            'foamAmount = max(foamAmount, 1.0 - abs(clamp(worldPosition.y - foamHeightData.x - 10.0, 0.0, 10.0) / 10.0));',
          '}',
        '}',
        'foamNormal.x *= 0.5 * foamAmount * largeNormalMapFadeout;',
        'foamNormal.y *= 0.5 * foamAmount * largeNormalMapFadeout;',
        'foamNormal = normalize(foamNormal);',
        'foamNormal = (foamNormal + 1.0) * 0.5;',
        'combinedNormalMap = combineNormals(combinedNormalMap, foamNormal);',
      '#endif',
      'vec3 normalizedDisplacedNormalMap = (normalize(displacedNormal) + vec3(1.0)) * 0.5;',
      'combinedNormalMap = combineNormals(normalizedDisplacedNormalMap, combinedNormalMap);',
      'combinedNormalMap = combinedNormalMap * 2.0 - vec3(1.0);',
      'combinedNormalMap = normalize(combinedNormalMap);',
      'combinedNormalMap = combinedNormalMap.xzy;',

      'vec3 normalizedViewVector = normalize(worldPosition.xyz - cameraPosition);',
      'vec3 reflectedCoordinates = reflect(normalizedViewVector, combinedNormalMap);',
      '//Why?! O_O, ok, so I grabbed this from https://www.youtube.com/watch?v=kXH1-uY0wjY',
      '//and... it makes absolutely no sense, but apparently 1.0/1.333 - the actual',
      '//refraction coeficient for water is way too high. Is this not physically based',
      '//or maybe I am thinking about cubemaps wrong?',
      'vec3 refractedCoordinates = refract(normalizedViewVector, combinedNormalMap, 1.0 / 1.025);',
      'vec3 reflectedLight = textureCube(reflectionCubeMap, reflectedCoordinates).rgb; //Reflection',
      'vec3 refractedLight = textureCube(refractionCubeMap, refractedCoordinates).rgb; //Refraction',
      'vec3 pointXYZ = textureCube(depthCubeMap, refractedCoordinates).xyz; //Scattering',
      'float distanceToPoint = distance(pointXYZ, worldPosition.xyz);',
      '// When the depth cubemap misses geometry (hits sky/background), it returns (0,0,0).',
      '// distance(worldPos, vec3(0)) for distant vertices becomes hundreds of meters,',
      '// driving percentOfSourceLight to zero and maximising inscatterLight everywhere.',
      '// Cap at a physically reasonable ocean depth to prevent this haze.',
      'distanceToPoint = min(distanceToPoint, 100.0);',
      'vec3 normalizedTransmittancePercentColor = normalize(lightScatteringAmounts);',
      'vec3 percentOfSourceLight = clamp(exp(-2.25 * distanceToPoint / (lightScatteringAmounts)), 0.0, 1.0);',
      'refractedLight = sRGBToLinear(vec4(refractedLight, 1.0)).rgb;',
      '//Increasing brightness with height inspired by, https://80.lv/articles/tutorial-ocean-shader-with-gerstner-waves/',
      'vec3 normalizedLightIntensity = normalize(brightestDirectionalLight);',
      'vec3 inscatterLight = pow(max(height, 0.0) * length(vec3(1.0) - percentOfSourceLight) * pow(normalizedTransmittancePercentColor, vec3(2.5)) * normalizedLightIntensity, gamma);',

      "//Apply Schlick's approximation for the fresnel amount",
      '//https://graphicscompendium.com/raytracing/11-fresnel-beer',

      'float cosTheta = clamp(dot(combinedNormalMap, -normalizedViewVector), 0.0, 1.0);',
      'float fresnelFactor = r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);',
      'reflectedLight = sRGBToLinear(vec4(reflectedLight, 1.0)).rgb;',

      '#if($caustics_enabled)',
        '//Caculate caustic lighting',
        "//Probably needs offsetting based on height but let's just see how this is",
        'float causticLightingR = causticShader(0.01 * pointXYZ.xz + 0.005, t);',
        'float causticLightingG = causticShader(0.01 * pointXYZ.xz, t);',
        'float causticLightingB = causticShader(0.01 * pointXYZ.xz - 0.005, t);',
        'vec3 causticLighting = causticIntensityMultiplier * 20.0 * vec3(causticLightingR, causticLightingG, causticLightingB);',
        'if(distance(cameraPosition, pointXYZ.xyz) > 2500.0){',
          'causticLighting = vec3(1.0);',
        '}',
        'refractedLight *= (causticLighting);',
      '#endif',
      'refractedLight *= percentOfSourceLight;',

      '//Calculate specular lighting and surface lighting',
      'vec3 directionalSurfaceLighting = normalizedLightIntensity * max(dot(combinedNormalMap, -brightestDirectionalLightDirection), 0.0);',
      'vec3 specular = 1.7 * normalizedLightIntensity * clamp((dot(reflectedCoordinates, -brightestDirectionalLightDirection) - 0.995) / 0.005, 0.0, 1.0);',

      '//Total light',
      'vec3 totalLight = specular + (2.0 / 255.0) * directionalSurfaceLighting + (253.0 / 255.0) * ((inscatterLight + refractedLight) * (1.0 - fresnelFactor) + reflectedLight * fresnelFactor);',
      '#if($foam_enabled)',
        'float foamOpacity = foamAmount * texture2D(foamOpacityMap, smallNormalMapOffset).r;',
        'vec3 foamLight = texture2D(foamDiffuseMap, smallNormalMapOffset).rgb;',
        'totalLight = mix(totalLight, 2.0 * directionalSurfaceLighting * foamLight, (foamOpacity * foamAmount));',
      '#endif',

      'gl_FragColor = linearTosRGB(vec4(MyAESFilmicToneMapping(totalLight), 1.0));',

      '#include <fog_fragment>',
    '}',
    ];

    let updatedLines = [];
    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      let updatedCode = originalGLSL[i];
      updatedCode = updatedCode.replace(/\$foam_enabled/g, foamEnabled ? '1' : '0');
      updatedCode = updatedCode.replace(/\$caustics_enabled/g, causticsEnabled ? '1' : '0');
      updatedLines.push(updatedCode);
    }

    return updatedLines.join('\n');
  },

  vertexShader: [
    'precision highp float;',

    'attribute vec3 tangent;',
    'attribute vec3 bitangent;',

    'varying vec2 vUv;',
    'varying vec3 vPosition;',
    'varying vec3 vTangent;',
    'varying vec3 vBitangent;',
    'varying vec3 vInView;',
    'varying mat4 vInstanceMatrix;',
    'varying mat4 vModelMatrix;',
    'varying mat3 vNormalMatrix;',

    'uniform float sizeOfOceanPatch;',
    'uniform sampler2D displacementMap;',
    'uniform float linearScatteringHeightOffset;',
    'uniform float linearScatteringTotalScatteringWaveHeight;',

    '#include <fog_pars_vertex>',

    'vec2 vec2Modulo(vec2 inputUV){',
        'return (inputUV - floor(inputUV));',
    '}',

    'void main() {',
      '//Set up our displacement map',
      'vec3 offsetPosition = position;',
      'mat3 instanceMatrixMat3 = mat3(instanceMatrix[0].xyz, instanceMatrix[1].xyz, instanceMatrix[2].xyz );',
      'mat3 modelMatrixMat3 = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz );',

      'vec2 cameraOffset = vec2(cameraPosition.x, cameraPosition.z);',
      'vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));',
      'float distanceToVertex = distance(cameraPosition.xyz, worldPositionOfVertex.xyz);',
      'vec2 uvOffset = (uv * sizeOfOceanPatch + cameraOffset) / sizeOfOceanPatch;',
      'float displacementFadeout = clamp((2500.0 - distanceToVertex) / 2500.0, 0.0, 1.0);',
      'vec3 displacement = texture2D(displacementMap, uvOffset).xyz * displacementFadeout;',
      'displacement.x *= -1.0;',
      'displacement.z *= -1.0;',
      'offsetPosition += displacement;',

      '//Set up our varyings',
      'vUv = uv;',
      'vTangent = tangent;',
      'vBitangent = bitangent;',
      'vPosition = position;',
      '//From https://stackoverflow.com/questions/59492385/angle-between-view-vector-and-normal',
      'vec4 posInView = (modelViewMatrix * instanceMatrix * vec4(offsetPosition, 1.0));',
      'posInView /= posInView[3];',
      'vInView = normalize(-posInView.xyz);',
      'vInstanceMatrix = instanceMatrix;',
      'vModelMatrix = modelMatrix;',
      'vNormalMatrix = normalMatrix;',

      '//Add support for three.js fog',
      '#include <fog_vertex>',

      'gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);',
    '}',
  ].join('\n'),
};

AWater.AOcean.OceanPatch = function(parentOceanGrid, initialPosition, instanceMeshRef, instanceID){
  const scene = parentOceanGrid.scene;
  this.initialPosition = initialPosition;
  this.position = new THREE.Vector3();
  this.parentOceanGrid = parentOceanGrid;
  this.instanceMeshRef = instanceMeshRef;
  this.instanceID = instanceID;
}

AWater.AOcean.OceanGrid = function(scene, renderer, camera, parentComponent){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  data = parentComponent.data;
  this.parentComponent = parentComponent;
  this.renderer = renderer;
  this.camera = camera;
  this.oceanPatches = [];
  this.oceanPatchIsInFrustrum = [];
  this.drawDistance = data.draw_distance;
  this.patchSize = data.patch_size;
  this.dataPatchSize = data.patch_size;
  this.heightOffset = data.height_offset;
  this.causticsEnabled = data.caustics_enabled;
  this.causticsStrength = data.caustics_strength;
  this.foamEnabled = data.foam_enabled;
  this.foamStart = data.foam_start;
  this.data = data;
  this.time = 0.0;
  this.smallNormalMap;
  this.largeNormalMap;
  this.causticMap;
  this.foamColorMap;
  this.foamOpacityMap;
  this.foamNormalMap;
  this.foamRoughnessMap;
  this.foamRenderMap;
  this.exclusionMap;
  this.windVelocity = data.wind_velocity;
  this.reflectionClipPlane = new THREE.Plane();
  this.reflectionClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, this.heightOffset * 2.0, 0));
  this.refractionClipPlane = new THREE.Plane();
  this.refractionClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, this.heightOffset * 2.0, 0));
  this.foamClipPlane = new THREE.Plane();
  this.foamClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, this.heightOffset * 2.0 + 1.0, 0));
  const randomAngle1 = Math.random() * 2.0 * Math.PI;
  const randomAngle2 = Math.random() * 2.0 * Math.PI;
  this.randomWindVelocities = [
    2.0 * Math.cos(randomAngle1),
    2.0 * Math.sin(randomAngle1),
    1.0 * Math.cos(randomAngle2),
    1.0 * Math.sin(randomAngle2),
  ];
  this.raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.0,100.0,0.0),
    this.downVector
  );
  this.cameraFrustum = new THREE.Frustum();

  this.brightestDirectionalLight = false;

  //Make sure the magnitude of the wind velocity is greater then 0.01, otherwise
  //set it to this to avoid data errors.
  this.windVelocity.x = Math.abs(this.data.wind_velocity.x) < 0.01 ? 0.01 : this.windVelocity.x;
  this.windVelocity.y = Math.abs(this.data.wind_velocity.y) < 0.01 ? 0.01 : this.windVelocity.y;

  //Load up the textures for our ocean smaller waves
  const textureLoader = new THREE.TextureLoader();
  let smallNormalMapTexturePromise = new Promise(function(resolve, reject){
    textureLoader.load(data.small_normal_map, function(texture){resolve(texture);});
  });
  smallNormalMapTexturePromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.smallNormalMap = texture;
  }, function(err){
    console.error(err);
  });

  let largeNormalMapTexturePromise = new Promise(function(resolve, reject){
    textureLoader.load(data.large_normal_map, function(texture){resolve(texture);});
  });
  largeNormalMapTexturePromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.largeNormalMap = texture;
  }, function(err){
    console.error(err);
  });

  //Load our caustics texture
  let causticMapTexturePromise = new Promise(function(resolve, reject){
    textureLoader.load(data.caustics_map, function(texture){resolve(texture);});
  });
  causticMapTexturePromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.causticMap = texture;
  }, function(err){
    console.error(err);
  });

  //Pull in each of our foam textures
  let foamColorPromise = new Promise(function(resolve, reject){
    textureLoader.load(data.foam_color_map, function(texture){resolve(texture);});
  });
  foamColorPromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.foamColorMap = texture;
  }, function(err){
    console.error(err);
  });

  let foamOpacityPromise = new Promise(function(resolve, reject){
    textureLoader.load(data.foam_opacity_map, function(texture){resolve(texture);});
  });
  foamOpacityPromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.foamOpacityMap = texture;
  }, function(err){
    console.error(err);
  });

  let foamNormalMapPromise = new Promise(function(resolve, reject){
    textureLoader.load(data.foam_normal_map, function(texture){resolve(texture);});
  });
  foamNormalMapPromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.foamNormalMap = texture;
  }, function(err){
    console.error(err);
  });

  let foamRoughnessMapPromise = new Promise(function(resolve, reject){
    textureLoader.load(data.foam_roughness_map, function(texture){resolve(texture);});
  });
  foamRoughnessMapPromise.then(function(texture){
    //Fill in the details of our texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.format = THREE.RGBAFormat;
    self.foamRoughnessMap = texture;
  }, function(err){
    console.error(err);
  });

  //Determine what our fade out start and end heights are
  //This is a bit of a hack but we're going to leave it static for now
  this.numberOfOceanHeightBands = 5;
  this.beginsFadingOutAtHeight = [];
  this.vanishingHeight = [];
  let distanceBetweenBands = 80.0;
  for(let i = 0; i < this.numberOfOceanHeightBands; ++i){
    this.beginsFadingOutAtHeight.push(distanceBetweenBands * i);
    this.vanishingHeight.push(0.0);
  }

  //Set up our cube camera for reflections and refractions
  this.reflectionCubeRenderTarget = new THREE.WebGLCubeRenderTarget(1024, {});
  this.reflectionCubeCamera = new THREE.CubeCamera(0.1, 10000.0, this.reflectionCubeRenderTarget);
  this.scene.add(this.reflectionCubeCamera);

  this.refractionCubeRenderTarget = new THREE.WebGLCubeRenderTarget(1024, {
    mapping: THREE.CubeRefractionMapping
  });
  this.refractionCubeRenderTarget.needsUpdate = true;
  this.refractionCubeCamera = new THREE.CubeCamera(0.1, 10000.0, this.refractionCubeRenderTarget);
  this.scene.add(this.refractionCubeCamera);

  //Set up another cube camera for depth
  this.depthCubeMapRenderTarget = new THREE.WebGLCubeRenderTarget(1024, {
    mapping: THREE.CubeRefractionMapping,
    type: THREE.FloatType
  });
  this.depthCubeCamera = new THREE.CubeCamera(0.1, 10000.0, this.depthCubeMapRenderTarget);
  this.scene.add(this.depthCubeCamera);

  //Set up depth camera pointing down for edge foam
  this.foamRenderTarget = new THREE.WebGLRenderTarget(4096, 4096, {
    type: THREE.FloatType
  });
  this.foamCamera = new THREE.OrthographicCamera(-2048.0, 2048.0, 2048.0, -2048.0, 0.1, 1000.0);
  this.scene.add(this.foamCamera);

  //Set up a depth camera pointing down for ocean exclusion mapping
  this.exclusionRenderTarget = new THREE.WebGLRenderTarget(4096, 4096, {
    type: THREE.FloatType
  });
  this.exclusionCamera = new THREE.OrthographicCamera(-1024.0, 1024.0, 1024.0, -1024.0, 0.1, 1000.0);
  this.exclusionCamera.layers.disableAll();
  this.exclusionCamera.layers.set(30);
  this.scene.add(this.exclusionCamera);

  //Initialize all shader LUTs for future ocean viewing
  //Initialize our ocean variables and all associated shaders.
  this.oceanHeightBandLibrary = new AWater.AOcean.LUTlibraries.OceanHeightBandLibrary(this);
  this.oceanHeightComposer = new AWater.AOcean.LUTlibraries.OceanHeightComposer(this);

  //Set up our ocean material that is used for all of our ocean patches
  this.oceanMaterial = new THREE.ShaderMaterial({
    vertexShader: AWater.AOcean.Materials.Ocean.waterMaterial.vertexShader,
    fragmentShader: AWater.AOcean.Materials.Ocean.waterMaterial.fragmentShader(this.causticsEnabled, this.foamEnabled),
    side: THREE.FrontSide,
    transparent: false,
    lights: false,
    fog: true
  });
  this.oceanMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', THREE.fogParsVert);
    shader.vertexShader = shader.vertexShader.replace(`#include <fog_vertex>`, THREE.fogVert);
    shader.fragmentShader = shader.fragmentShader.replace(`#include <fog_pars_fragment>`, THREE.fogParsFrag);
    shader.fragmentShader = shader.fragmentShader.replace(`#include <fog_fragment>`, THREE.fogFrag);
  };
  this.oceanMaterial.uniforms = AWater.AOcean.Materials.Ocean.waterMaterial.uniforms;
  this.oceanMaterial.uniforms.sizeOfOceanPatch.value = this.patchSize;

  let self = this;
  this.positionPassMaterial = new THREE.ShaderMaterial({
    vertexShader: AWater.AOcean.Materials.Ocean.positionPassMaterial.vertexShader,
    fragmentShader: AWater.AOcean.Materials.Ocean.positionPassMaterial.fragmentShader,
    side: THREE.FrontSide,
    transparent: false,
    lights: false
  });
  this.positionPassMaterial.uniforms = AWater.AOcean.Materials.Ocean.positionPassMaterial.uniforms;
  this.positionPassMaterial.uniforms.worldMatrix.value = this.camera.matrixWorld;

  //Get all ocean patch offsets
  const maxHalfPatchesPerSide = Math.ceil((this.drawDistance + this.patchSize) / this.patchSize);
  const drawDistanceSquared = this.drawDistance * this.drawDistance;
  const minDistanceForUpdatedLOD = this.patchSize;
  let patchLODByBucketID = {};
  const numberOfLODs = 7;
  for(let x = -maxHalfPatchesPerSide; x < maxHalfPatchesPerSide; ++x){
    const xForID = x + maxHalfPatchesPerSide;
    for(let y = -maxHalfPatchesPerSide; y < maxHalfPatchesPerSide; ++y){
      const yForID = y + maxHalfPatchesPerSide;
      const xCoord = (x - 0.5) * this.patchSize;
      const yCoord = (y - 0.5) * this.patchSize;
      const xyDistToPlaneSquared = xCoord * xCoord + yCoord * yCoord;
      if(xyDistToPlaneSquared <= drawDistanceSquared){
        //Bit mask these into the same number to make a unique 32 bit integer id
        const bucketID = xForID | (4294901760 & (yForID * 65536));
        const distanceToPlane = Math.sqrt(xyDistToPlaneSquared);
        //Not sure why this works best when draw distance is at a 1/4. Maybe it's just the angle? But not sure...
        const tesselationFactor = Math.min(Math.max(Math.round(numberOfLODs * (1.0 - ( distanceToPlane / (this.patchSize * numberOfLODs) ) )), 1), numberOfLODs);
        patchLODByBucketID[bucketID] = 2 ** tesselationFactor;
      }
    }
  }

  //Get the instance count for each tile type with all down grades to enable instanced meshes
  let instanceCount = {};
  for(let x = -maxHalfPatchesPerSide; x < maxHalfPatchesPerSide; ++x){
    const xForID = x + maxHalfPatchesPerSide;
    for(let y = -maxHalfPatchesPerSide; y < maxHalfPatchesPerSide; ++y){
      const yForID = y + maxHalfPatchesPerSide;
      const xCoord = (x - 0.5) * this.patchSize;
      const yCoord = (y - 0.5) * this.patchSize;
      const xyDistToPlaneSquared = xCoord * xCoord + yCoord * yCoord;
      if(xyDistToPlaneSquared <= drawDistanceSquared){
        //Bit mask these into the same number to make a unique 32 bit integer id
        const LODID = xForID | (4294901760 & (yForID * 65536));
        const LOD = patchLODByBucketID[LODID];
        const LODTopID = xForID | (4294901760 & ((yForID + 1) * 65536));
        const LODTop = LODTopID in patchLODByBucketID ? patchLODByBucketID[LODTopID] >= LOD : true;
        const LODRightID = (xForID + 1) | (4294901760 & (yForID * 65536));
        const LODRight = LODRightID in patchLODByBucketID ? patchLODByBucketID[LODRightID] >= LOD : true;
        const LODBottomID = xForID | (4294901760 & ((yForID - 1) * 65536));
        const LODBottom = LODBottomID in patchLODByBucketID ? patchLODByBucketID[LODBottomID] >= LOD : true;
        const LODLeftID = (xForID - 1) | (4294901760 & (yForID * 65536));
        const LODLeft = LODLeftID in patchLODByBucketID ? patchLODByBucketID[LODLeftID] >= LOD : true;

        //I'm just going to presume our LODs will never be beyond 128
        //Which would have so many triangles, it would be silly.
        //We then just go down by one or stay the same, so we can add on
        //a couple of binary flags like so.
        let instanceCountID = Math.round(Math.log(LOD) / Math.log(2));
        instanceCountID += LODTop * 256;
        instanceCountID += LODRight * 512;
        instanceCountID += LODBottom * 1024;
        instanceCountID += LODLeft * 2048;
        if(!instanceCount.hasOwnProperty(instanceCountID)){
          instanceCount[instanceCountID] = 1;
        }
        else{
          instanceCount[instanceCountID]++;
        }
      }
    }
  }

  let oceanPatchGeometryInstances = {};
  let instanceIterations = {};
  let oceanGridInstanceKeys = [];
  const windVelocity = new THREE.Vector2(this.windVelocity.x, this.windVelocity.y);
  const windVelocityMagnitude = windVelocity.length();
  const windVelocityDirection = windVelocity.divideScalar(windVelocityMagnitude);
  for(let x = -maxHalfPatchesPerSide; x < maxHalfPatchesPerSide; ++x){
    const xForID = x + maxHalfPatchesPerSide;
    for(let y = -maxHalfPatchesPerSide; y < maxHalfPatchesPerSide; ++y){
      const yForID = y + maxHalfPatchesPerSide;
      const xCoord = (x - 0.5) * this.patchSize;
      const yCoord = (y - 0.5) * this.patchSize;
      const xyDistToPlaneSquared = xCoord * xCoord + yCoord * yCoord;
      if(xyDistToPlaneSquared <= drawDistanceSquared){
        //Bit mask these into the same number to make a unique 32 bit integer id
        const LOD = patchLODByBucketID[xForID | (4294901760 & (yForID * 65536))];
        const LODTopID = xForID | (4294901760 & ((yForID + 1) * 65536));
        const LODTop = LODTopID in patchLODByBucketID ? patchLODByBucketID[LODTopID] >= LOD : true;
        const LODRightID = (xForID + 1) | (4294901760 & (yForID * 65536));
        const LODRight = LODRightID in patchLODByBucketID ? patchLODByBucketID[LODRightID] >= LOD : true;
        const LODBottomID = xForID | (4294901760 & ((yForID - 1) * 65536));
        const LODBottom = LODBottomID in patchLODByBucketID ? patchLODByBucketID[LODBottomID] >= LOD : true;
        const LODLeftID = (xForID - 1) | (4294901760 & (yForID * 65536));
        const LODLeft = LODLeftID in patchLODByBucketID ? patchLODByBucketID[LODLeftID] >= LOD : true;

        let instanceCountID = Math.round(Math.log(LOD) / Math.log(2));
        instanceCountID += LODTop * 256;
        instanceCountID += LODRight * 512;
        instanceCountID += LODBottom * 1024;
        instanceCountID += LODLeft * 2048;
        if(!oceanPatchGeometryInstances.hasOwnProperty(instanceCountID)){
          oceanGridInstanceKeys.push(instanceCountID);
          const geometry = AWater.OceanTile(this.patchSize, LOD, LODTop, LODRight, LODBottom, LODLeft);
          oceanPatchGeometryInstances[instanceCountID] = new THREE.InstancedMesh(geometry, this.oceanMaterial.clone(), instanceCount[instanceCountID]);
          oceanPatchGeometryInstances[instanceCountID].frustumCulled = false;
          instanceIterations[instanceCountID] = 0;
          scene.add(oceanPatchGeometryInstances[instanceCountID]);

          //Set the velocity of the small water waves on the surface
          const uniformsRef = oceanPatchGeometryInstances[instanceCountID].material.uniforms;
          uniformsRef.smallNormalMapVelocity.value.set(this.randomWindVelocities[0], this.randomWindVelocities[1]);
          uniformsRef.largeNormalMapVelocity.value.set(this.randomWindVelocities[2], this.randomWindVelocities[3]);
          uniformsRef.lightScatteringAmounts.value.copy(this.data.light_scattering_amounts);
          uniformsRef.smallNormalMapStrength.value = this.data.small_normal_map_strength;
          uniformsRef.largeNormalMapStrength.value = this.data.large_normal_map_strength;
          uniformsRef.linearScatteringHeightOffset.value = this.data.linear_scattering_height_offset;
          uniformsRef.linearScatteringTotalScatteringWaveHeight.value = this.data.linear_scattering_total_wave_height;
        }
        const instanceIteration = instanceIterations[instanceCountID];
        this.oceanPatches.push(new AWater.AOcean.OceanPatch(this, new THREE.Vector3(xCoord, this.heightOffset, yCoord), oceanPatchGeometryInstances[instanceCountID], instanceIteration));
        instanceIterations[instanceCountID] += 1;
      }
    }
  }

  this.numberOfPatches = this.oceanPatches.length;
  this.globalCameraPosition = new THREE.Vector3();
  const patchOffsetMatrix = new THREE.Matrix4();
  const oceanPatchTranslationMatrices = [];
  for(let i = 0; numOceanPatches = self.oceanPatches.length, i < numOceanPatches; ++i){
    oceanPatchTranslationMatrices.push(new THREE.Matrix4());
  }
  const directionalLightDirection = new THREE.Vector3();
  this.tick = function(time){
    //Update the brightest directional light if we don't have one
    if(this.brightestDirectionalLight === false){
      for(let i = 0, numItems = self.scene.children.length; i < numItems; ++i){
        let child = self.scene.children[i];
        if(child.type === 'DirectionalLight' &&
        (this.brightestDirectionalLight === false ||
          child.intensity > self.brightestDirectionalLight.intensity)){
          self.brightestDirectionalLight = child;
        }
      }
    }

    //Copy the camera position in the world...
    if(self.camera !== self.parentComponent.el.sceneEl.camera){
      //Attach the scene camera if it does not exist yet
      self.camera = self.parentComponent.el.sceneEl.camera;
    }
    const sceneCamera = self.camera;
    sceneCamera.getWorldPosition(self.globalCameraPosition);

    //Update the state of our ocean grid
    self.time = time;
    for(let i = 0; numOceanPatches = self.oceanPatches.length, i < numOceanPatches; ++i){
      const oceanPatch = self.oceanPatches[i];
      const xOffset = oceanPatch.initialPosition.x + self.globalCameraPosition.x;
      const yOffset = oceanPatch.initialPosition.y;
      const zOffset = oceanPatch.initialPosition.z + self.globalCameraPosition.z;
      const translationMatrix = oceanPatchTranslationMatrices[i];
      translationMatrix.makeTranslation(xOffset, yOffset, zOffset);
      self.oceanPatches[i].instanceMeshRef.setMatrixAt(oceanPatch.instanceID, translationMatrix);
    }

    //Inform the system that we need to update all the instance matrices every frame
    for(let i = 0; numKeys = oceanGridInstanceKeys.length, i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].instanceMatrix.needsUpdate = true;
    }

    //Frustum Cull our grid
    //self.cameraFrustum.setFromProjectionMatrix(self.camera.projectionMatrix.clone().multiply(self.camera.matrixWorldInverse));

    //Hide all of our ocean grid elements
    for(let i = 0; numKeys = oceanGridInstanceKeys.length, i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].visible = false;
    }

    //Snap a cubemap picture of our environment to create reflections and refractions
    self.depthCubeCamera.position.copy(self.globalCameraPosition);
    self.reflectionCubeCamera.position.copy(self.globalCameraPosition);
    self.reflectionCubeCamera.position.y = 0.0;
    self.refractionCubeCamera.position.copy(self.globalCameraPosition);
    const rendererClippingEnabledBefore = self.renderer.localClippingEnabled;
    const originalGlobalClipPlane = self.renderer.clippingPlanes.length > 0 ? self.renderer.clippingPlanes : [];
    self.renderer.clippingPlanes = [self.reflectionClipPlane];
    self.reflectionCubeCamera.update(self.renderer, self.scene);
    self.renderer.clippingPlanes = [self.refractionClipPlane];
    self.refractionCubeCamera.update(self.renderer, self.scene);
    self.scene.overrideMaterial = self.positionPassMaterial;
    self.depthCubeCamera.update(self.renderer, self.scene);
    self.renderer.clippingPlanes = originalGlobalClipPlane;

    //Update our sea foam camera
    self.renderer.setClearAlpha(0.0);
    const currentRenderTarget = self.renderer.getRenderTarget();
    self.foamCamera.position.copy(self.globalCameraPosition);
    self.foamCamera.position.y = this.heightOffset + 100.0;
    self.foamCamera.lookAt(self.globalCameraPosition.x, this.heightOffset - 1.0, self.globalCameraPosition.z);
    self.foamCamera.updateProjectionMatrix();
    self.renderer.setRenderTarget(self.foamRenderTarget);
    const clearAlpha = renderer.getClearAlpha();
    self.renderer.clear();
    self.renderer.render(scene, self.foamCamera);
    this.foamRenderMap = self.foamRenderTarget.texture;
    self.renderer.setRenderTarget(null);

    //Update our exclusion camera
    self.exclusionCamera.position.copy(self.globalCameraPosition);
    self.exclusionCamera.position.y = this.heightOffset + 100.0;
    self.exclusionCamera.lookAt(self.globalCameraPosition.x, this.heightOffset - 1.0, self.globalCameraPosition.z);
    self.exclusionCamera.updateProjectionMatrix();
    self.renderer.setRenderTarget(self.exclusionRenderTarget);
    self.renderer.clear();
    self.renderer.render(scene, self.exclusionCamera);
    this.exclusionMap = self.exclusionRenderTarget.texture;
    self.renderer.setRenderTarget(null);

    //Restore our original materials
    self.scene.overrideMaterial = null;
    self.renderer.setRenderTarget(currentRenderTarget);
    self.renderer.setClearAlpha(clearAlpha);

    //Show all of our ocean grid elements again
    for(let i = 0; numKeys = oceanGridInstanceKeys.length, i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].visible = true;
    }

    //Update each of our ocean grid height maps
    self.oceanHeightBandLibrary.tick(time);
    self.oceanHeightComposer.tick();

    //Update all of our uniforms
    let brightestDirectionalLight;
    if(self.brightestDirectionalLight){
      brightestDirectionalLight = self.brightestDirectionalLight;
    }
    for(let i = 0; numKeys = oceanGridInstanceKeys.length, i < numKeys; ++i){
      const uniformsRef = oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms;
      uniformsRef.displacementMap.value = self.oceanHeightComposer.displacementMap;
      uniformsRef.refractionCubeMap.value = self.refractionCubeCamera.renderTarget.texture;
      uniformsRef.reflectionCubeMap.value = self.reflectionCubeCamera.renderTarget.texture;
      uniformsRef.depthCubeMap.value = self.depthCubeCamera.renderTarget.texture;
      uniformsRef.smallNormalMap.value = self.smallNormalMap;
      uniformsRef.largeNormalMap.value = self.largeNormalMap;
      uniformsRef.causticMap.value = self.causticMap;
      uniformsRef.foamDiffuseMap.value = self.foamColorMap;
      uniformsRef.foamOpacityMap.value = self.foamOpacityMap;
      uniformsRef.foamNormalMap.value = self.foamNormalMap;
      uniformsRef.foamRoughnessMap.value = self.foamRoughnessMap;
      uniformsRef.foamRenderMap.value = self.foamRenderMap;
      uniformsRef.exclusionMap.value = self.exclusionMap;
      uniformsRef.baseHeightOffset.value = self.heightOffset;
      if(self.brightestDirectionalLight){
        const intensity = brightestDirectionalLight.intensity;
        const color = brightestDirectionalLight.color;
        uniformsRef.brightestDirectionalLight.value.set(color.r * intensity, color.g * intensity, color.b * intensity);
        directionalLightDirection.set(brightestDirectionalLight.position.x, brightestDirectionalLight.position.y, brightestDirectionalLight.position.z);
        directionalLightDirection.sub(brightestDirectionalLight.target.position).negate().normalize();
        uniformsRef.brightestDirectionalLightDirection.value.set(directionalLightDirection.x, directionalLightDirection.y, directionalLightDirection.z);
      }
      else{
        uniformsRef.brightestDirectionalLight.value.set(1.0,1.0,1.0);
      }
      uniformsRef.t.value = time * 0.001;
    }
  };
}

//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('ocean-state', {
  oceanGrid: null,
  oceanRenderer: null,
  schema: {
    'draw_distance': {type: 'number', default: 5000.0},
    'patch_size': {type: 'number', default: 256.0},
    'patch_data_size': {type: 'number', default: 512.0},
    'wave_scale_multiple': {type: 'number', default: 1.0},
    'number_of_octaves': {type: 'number', default: 256.0},
    'wind_velocity': {type: 'vec2', default: {x: 4.0, y: 3.5}},
    'height_offset': {type: 'number', default: 0.0},
    'large_normal_map': {type: 'string', default: './image-dir/a-water-assets/water-normal-1.png'},
    'small_normal_map': {type: 'string', default: './image-dir/a-water-assets/water-normal-2.png'},
    'caustics_map': {type: 'string', default: './image-dir/a-water-assets/caustic-map.webp'},
    'foam_color_map': {type: 'string', default: './image-dir/a-water-assets/Foam002_1K_Color.png'},
    'foam_opacity_map': {type: 'string', default: './image-dir/a-water-assets/Foam002_1K_Opacity.png'},
    'foam_normal_map': {type: 'string', default: './image-dir/a-water-assets/Foam002_1K_NormalGL.png'},
    'foam_roughness_map': {type: 'string', default: './image-dir/a-water-assets/Foam002_1K_Roughness.png'},
    'caustics_enabled': {type: 'bool', default: 1},
    'caustics_strength': {type: 'number', default: 1.0},
    'foam_enabled': {type: 'bool', default: 1},
    'foam_start': {type: 'number', default: 0.15},
    'large_normal_map_strength': {type: 'number', default: 0.45},
    'small_normal_map_strength': {type: 'number', default: 0.35},
    'light_scattering_amounts': {type: 'vec3', default: {x: 88.0, y: 108.0, z: 112.0}},
    'linear_scattering_height_offset': {type: 'number', default: 10.0},
    'linear_scattering_total_wave_height': {type: 'number', default: 20.0}
  },
  init: function(){
    //Get our renderer to pass in
    let renderer = this.el.sceneEl.renderer;
    let scene = this.el.sceneEl.object3D;
    let camera = this.el.sceneEl.camera;
    let self = this;

    //Update the position of the objects
    scene.updateMatrixWorld();

    //Set up our ocean grid
    this.oceanGrid = new AWater.AOcean.OceanGrid(scene, renderer, camera, this);

    //When we've finished loading, now we can commence ticking our grid
    this.tick = function(time, timeDelta){
      this.oceanGrid.tick(time);
    }
  },
  tick: function(time, timeDelta){
    //Do nothing to start :D
  }
});

AFRAME.registerPrimitive('a-ocean', {
  defaultComponents: {
    'ocean-state': {}
  }
});
