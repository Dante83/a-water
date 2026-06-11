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

		//Float textures are core in WebGL2 — only probe the extension on WebGL1.
		//three.js v173+ logs a console warning whenever extensions.get() misses,
		//so guarding on capabilities.isWebGL2 first keeps the console clean on
		//the WebGL2 platform we actually target.
		if ( ! renderer.capabilities.isWebGL2 &&
			 ! renderer.extensions.get( "OES_texture_float" ) ) {

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

//Root namespace for a-restless-ocean. Everything the library exposes — the
//OceanGrid renderer, the wave/LUT libraries, the materials, the config helpers —
//hangs off the global ARestlessOcean object.
ARestlessOcean = {
  DefaultData: {},
  Materials: {
    FFTWaves: {},
    Ocean: {}
  },
  Renderers: {},
  LUTlibraries: {}
};

//── Backwards compatibility ────────────────────────────────────────────────────
//The library was previously published as `a-water`, with its namespace under
//`AWater.AOcean`. Code written against the old name keeps working: reading
//`AWater.AOcean` returns (via the getter below) the same live ARestlessOcean
//object, so `AWater.AOcean.OceanGrid`, `AWater.AOcean.sampleWaterHeight`, etc. all
//still resolve. The first access logs a one-time deprecation notice. This alias is
//slated for removal — migrate `AWater.AOcean.X` references to `ARestlessOcean.X`.
(function(){
  let warned = false;
  AWater = {
    get AOcean(){
      if(!warned){
        warned = true;
        console.warn('[a-restless-ocean] `AWater.AOcean` is deprecated — use the ' +
                     '`ARestlessOcean` namespace instead. This compatibility alias ' +
                     'will be removed in a future release.');
      }
      return ARestlessOcean;
    }
  };
})();

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
ARestlessOcean.Materials.FFTWaves.noiseShaderMaterialData = {
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
ARestlessOcean.Materials.FFTWaves.h0ShaderMaterialData = {
  uniforms: {
    N: {type: 'f', value: 256.0},
    L: {type: 'f', value: 1000.0},
    A: {type: 'f', value: 20.0},
    L_: {type: 'f', value: 0.0},
    w: {type: 'v2', value: new THREE.Vector2(1.0, 0.0)},
    omega_p: {type: 'f', value: 1.0},
    gamma: {type: 'f', value: 3.3},
    noiseUVOffset: {type: 'v2', value: new THREE.Vector2(0.0, 0.0)},
    //Centered-FFT-coord band: keep maxCoord = max(|nx|, |ny|) in [sampleLow, sampleHigh).
    //Edge cascades widen to 0..N so the long-swell and capillary tails survive.
    sampleLow: {type: 'f', value: 2.0},
    sampleHigh: {type: 'f', value: 8.0},
    //Mix factor toward isotropic directional spread. 0.145 = Crest default.
    directionalTurbulence: {type: 'f', value: 0.145}
  },

  fragmentShader: [
    'precision highp float;',

    '//JONSWAP spectrum for ocean wave initialization',
    '//Ref: Hasselmann et al. 1973, Tessendorf 2001',
    'uniform float N; //256.0',
    'uniform float L; //1000.0 - patch size in meters',
    'uniform float A; //amplitude multiplier (artistic control)',
    'uniform vec2 w; //wind direction (normalized)',
    'uniform float omega_p; //peak angular frequency',
    'uniform float gamma; //JONSWAP peak enhancement (typically 3.3)',
    'uniform vec2 noiseUVOffset; //Per-cascade offset for decorrelated random phases',
    '//Centered-FFT-coord band: keep maxCoord = max(|nx|, |ny|) in [sampleLow, sampleHigh).',
    '//This is the Crest WAVE_SAMPLE_FACTOR scheme — each cascade is restricted to',
    '//a narrow octave-range of bins so the 256² spectral budget concentrates on',
    '//the wavelengths that cascade is meant to render.',
    'uniform float sampleLow;',
    'uniform float sampleHigh;',
    '//Directional spreading turbulence. 0 = pure cos²(θ) (waves perfectly aligned',
    "//to wind), 1 = fully isotropic. Crest's default is 0.145 — enough cross-wind",
    '//content to break the parallel-streak look without losing the wind direction.',
    'uniform float directionalTurbulence;',

    'const float g = 9.80665;',
    'const float pi = 3.141592653589793238462643383279502884197169;',
    'const float piTimes2 = 6.283185307179586476925286766559005768394338798750211641949;',
    'const float JONSWAP_ALPHA = 0.0081; //Pierson-Moskowitz constant',

    '//Box-Muller Method',
    'vec4 gaussRand(vec2 uv){',
      'vec2 texCoord = fract(vec2(uv.xy) + noiseUVOffset);',
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
      '//Centered DFT coord: pixel (N/2, N/2) is DC. Bins above N/2 are negative',
      '//frequencies. The pack stage applies an (-1)^(x+y) sign flip to undo the',
      '//centering shift in the IFFT output.',
      'vec2 coord = floor(uv * N) - N * 0.5;',
      'vec2 k = vec2(piTimes2 / L) * coord;',
      'float magK = length(k);',
      'if (magK < 0.0001) magK = 0.0001;',

      '//Band-limit on centered coord magnitude (Crest WAVE_SAMPLE_FACTOR scheme).',
      '//Always cull DC (maxCoord < 1) — mean sea level is 0 and normalize(vec2(0))',
      '//downstream would NaN, contaminating the entire IFFT output.',
      'float maxCoord = max(abs(coord.x), abs(coord.y));',
      'if (maxCoord < max(sampleLow, 1.0) || maxCoord >= sampleHigh){',
        'gl_FragColor = vec4(0.0);',
        'return;',
      '}',

      '//Dispersion relation',
      'float omega = sqrt(g * magK);',

      '//JONSWAP spectral width',
      'float sigma = omega <= omega_p ? 0.07 : 0.09;',

      '//Peak enhancement factor',
      'float r = exp(-pow(omega - omega_p, 2.0) / (2.0 * sigma * sigma * omega_p * omega_p));',

      '//Pierson-Moskowitz base spectrum in omega-space',
      'float pmSpectrum = JONSWAP_ALPHA * g * g / pow(omega, 5.0) * exp(-1.25 * pow(omega_p / omega, 4.0));',

      '//JONSWAP = PM * gamma^r',
      'float jonswap = pmSpectrum * pow(gamma, r);',

      '//Convert to k-space: S(k) = S(omega) * |domega/dk| = S(omega) * g/(2*omega)',
      'float Sk = jonswap * g / (2.0 * omega);',

      '//Tessendorf h0: sqrt(S_2D(k) * dk_x * dk_y / 2)',
      '//Convert 1D omnidirectional S(k) to 2D: S_2D = S(k) / k (Jacobian polar→Cartesian)',
      '//dk = 2*pi/L is the spacing between discrete k values',
      'float dk = piTimes2 / L;',
      'float h0_coefficient = A * sqrt(Sk * dk * dk / (2.0 * magK));',

      '//Directional spreading: cos^2(theta)',
      '//Use d*d instead of pow(d, 2.0) to avoid GLSL undefined behavior with negative base',
      '//Guard against zero wind to avoid NaN from normalize(vec2(0,0))',
      'if(length(w) < 0.0001){',
        'gl_FragColor = vec4(0.0);',
        'return;',
      '}',
      'float d_k = dot(normalize(k), normalize(w));',
      'float d_minus_k = dot(normalize(-k), normalize(w));',
      "//Blend cos²(θ) toward isotropic (1/2) by turbulence. Same form as Crest's",
      '//PosCosSquaredDirectionalSpreading: mix(cos²θ, ½, turbulence). The ½ is the',
      '//average of cos²θ over the full circle (so total directional integral is',
      '//preserved) — picking it instead of 1 keeps amplitude calibration intact.',
      'float spread_k = mix(d_k * d_k, 0.5, clamp(directionalTurbulence, 0.0, 1.0));',
      'float spread_minus_k = mix(d_minus_k * d_minus_k, 0.5, clamp(directionalTurbulence, 0.0, 1.0));',
      'float h0_k = h0_coefficient * spread_k;',
      'float h0_minus_k = h0_coefficient * spread_minus_k;',

      'vec4 gaussianRandomNumber = gaussRand(uv);',

      'gl_FragColor = vec4(gaussianRandomNumber.xy * h0_k, gaussianRandomNumber.zw * h0_minus_k);',
    '}',
  ].join('\n')
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
ARestlessOcean.Materials.FFTWaves.hkShaderMaterialData = {
  uniforms: {
    textureH0: {type: 't', value: null},
    N: {type: 'f', value: 256.0},
    L: {type: 'f', value: 1000.0},
    uTime: {type: 'f', value: 0.0}
  },

  fragmentShader: function(isXAxis = false, isYAxis = false, isSlope = false){
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
      '//Centered DFT coord — must match h_0-pass so the dispersion ω and the',
      '//slope/chop weights apply to the actual physical k, not the upper-half',
      '//alias. The IFFT output of this centered spectrum is shifted by N/2; the',
      '//pack stage applies an (-1)^(x+y) sign flip to undo that.',
      'vec2 coord = floor(uv * N) - N * 0.5;',
      'vec2 k = vec2(piTimes2 / L) * coord;',
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

      '#if($isSlope)',
        '//Packed analytical slope spectrum: P(k) = (kx + i*kz) * i*H(k,t)',
        '//After IFFT: R = dh/dx, G = dh/dz — exact derivatives, zero aliasing at',
        '//all frequencies. Derivation: slopeX = i*kx*H, slopeZ = i*kz*H. Pack as',
        '//P = slopeX + i*slopeZ. Then IFFT(P) = slopeX(x) + i*slopeZ(x), giving',
        '//both slopes in one FFT chain.',
        'vec2 iH = vec2(-hk_tilda.y, hk_tilda.x);',
        'hk_tilda = cMult(k, iH);',
      '#elif($isXAxis)',
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
      let updatedGLSL = originalGLSL[i].replace(/\$isSlope/g, isSlope ? '1' : '0');
      updatedGLSL = updatedGLSL.replace(/\$isXAxis/g, isXAxis ? '1' : '0');
      updatedGLSL = updatedGLSL.replace(/\$isYAxis/g, isYAxis ? '1' : '0');
      //Otherwise is z-axis, and sure, it is true these are dependent values but this is just easier

      updatedLines.push(updatedGLSL);
    }

    return updatedLines.join('\n');
  }
};

ARestlessOcean.Materials.FFTWaves.computeTwiddleIndices = function(N, renderer){
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
      twiddleTexture[0][y][2] = (indices[y] + 0.5) / N;
      twiddleTexture[0][y][3] = (indices[y + 1] + 0.5) / N;
    }
    else{
      twiddleTexture[0][y][0] = twiddle[0];
      twiddleTexture[0][y][1] = twiddle[1];
      twiddleTexture[0][y][2] = (indices[y - 1] + 0.5) / N;
      twiddleTexture[0][y][3] = (indices[y] + 0.5) / N;
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
        twiddleTexture[x][y][2] = (y + 0.5) / N;
        twiddleTexture[x][y][3] = (y + butterflySpan + 0.5) / N;
      }
      else{
        twiddleTexture[x][y][0] = twiddle[0];
        twiddleTexture[x][y][1] = twiddle[1];
        twiddleTexture[x][y][2] = (y - butterflySpan + 0.5) / N;
        twiddleTexture[x][y][3] = (y + 0.5) / N;
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
ARestlessOcean.Materials.FFTWaves.butterflyTextureData = {
  uniforms: {
    inputTexture: {type: 't', value: null},
    twiddleTexture: {type: 't', value: null},
    stageFraction: {type: 'f', value: 0.0},
    direction: {type: 'i', value: 1}
  },

  fragmentShader: [
    'precision highp float;',

    'varying vec3 vWorldPosition;',

    '//With a lot of help from https://youtu.be/i0BPrGuOdPo',
    'uniform sampler2D inputTexture;',
    'uniform sampler2D twiddleTexture;',
    'uniform float stageFraction;',
    'uniform int direction;',
    'uniform vec2 resolution;',

    'const float pi = 3.141592653589793238462643383279502884197169;',

    'vec2 cMult(vec2 a, vec2 b){',
      'return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);',
    '}',

    'vec2 cAdd(vec2 a, vec2 b){',
      'return vec2(a.x + b.x, a.y + b.y);',
    '}',

    'vec4 horizontalButterflies(vec2 position){',
      'vec4 data = texture2D(twiddleTexture, vec2(stageFraction, position.x));',

      'vec2 p = texture2D(inputTexture, vec2(data.z, position.y)).rg;',
      'vec2 q = texture2D(inputTexture, vec2(data.w, position.y)).rg;',
      'vec2 w = vec2(data.x, data.y);',

      'vec2 H = cAdd(p, cMult(w, q));',
      'return vec4(H, 0.0, 1.0);',
    '}',

    'vec4 verticalButterflies(vec2 position){',
      'vec4 data = texture2D(twiddleTexture, vec2(stageFraction, position.y));',

      'vec2 p = texture2D(inputTexture, vec2(position.x, data.z)).rg;',
      'vec2 q = texture2D(inputTexture, vec2(position.x, data.w)).rg;',
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
  ].join('\n')
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
ARestlessOcean.Materials.Ocean.positionPassMaterial = {
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

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
ARestlessOcean.Materials.Ocean.waterMaterial = {
  uniforms: {
    cascadeDisplacementTextures: {value: [null, null, null, null, null, null]},
    cascadePatchSizes: {value: [4096.0, 1024.0, 256.0, 64.0, 16.0, 4.0]},
    //Per-cascade slope variance σ² (units of slope²). Precomputed from JONSWAP
    //+ directional spread for each cascade's k-band in ocean-height-band-library.
    //The water shader sums these (weighted by per-cascade distance-fade) into
    //an effective α²_GGX driving a Karis-style horizon clamp on Fresnel — so
    //distant rough water doesn't read as a perfect sky mirror at grazing.
    //Initial zeros are placeholder; real values pushed every frame from
    //ocean-grid.js once the height-band library has integrated them.
    cascadeRMSSlope: {value: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]},
    //Per-cascade spatial UV offsets to break visual tiling periodicity.
    //Golden-ratio derived fractions of each cascade's patch size — different
    //per cascade so tile seams never align with each other.
    cascadeSpatialOffsets: {value: [
      new THREE.Vector2(1564.7, 2531.3), //C0 4096m: 0.382L, 0.618L
      new THREE.Vector2( 241.7,  632.8), //C1 1024m: 0.236L, 0.618L
      new THREE.Vector2( 218.6,   60.4), //C2  256m: 0.854L, 0.236L
      new THREE.Vector2(  30.2,   54.7), //C3   64m: 0.472L, 0.854L
      new THREE.Vector2(   1.44,   7.55),//C4   16m: 0.090L, 0.472L
      new THREE.Vector2(   2.83,   0.36) //C5    4m: 0.708L, 0.090L
    ]},
    waveHeightMultiplier: {type: 'f', value: 1.0},
    causticMap: {type: 't', value: null},
    causticIntensityMultiplier: {type: 'f', value: null},
    foamDiffuseMap: {type: 't', value: null},
    foamOpacityMap: {type: 't', value: null},
    foamNormalMap: {type: 't', value: null},
    foamRenderMap: {type: 't', value: null},
    foamStartLevel: {type: 'f', value: 0.0},
    exclusionMap: {type: 't', value: null},
    //Snapped XZ origin used when the foam/exclusion ortho cameras rendered
    //their atlas this frame. The shader MUST subtract this (not the player
    //cameraPosition) when computing atlas UVs, or the atlas pattern drifts
    //by a sub-texel amount each frame as the player moves → visible flicker.
    foamCameraXZ: {type: 'vec2', value: new THREE.Vector2()},
    exclusionCameraXZ: {type: 'vec2', value: new THREE.Vector2()},
    foamScrollVelocity: {type: 'vec2', value: new THREE.Vector2()},
    //Wind-driven foam bias (Sea-of-Thieves "Jacobian dip"). 0 = calm (unchanged);
    //CPU ramps it up with wind speed so rough seas progressively whiten over.
    foamWindBias: {type: 'f', value: 0.0},
    //Refraction G-buffer (3-attachment MRT, allocated in ocean-grid.js):
    //  refractionColorTexture = attachment 0, LINEAR albedo (decoded per-mesh
    //    in the G-buffer override shader); .a = 1 where geometry exists.
    //  gBufferNormal          = attachment 1, world-space surface normal.
    //  refractionLinearDepth  = attachment 2, view-space linear depth in .r.
    //  refractionDepthTexture = the MRT's own depth attachment (raw NDC), kept
    //    for the unprojection that recovers world-space seabed position.
    refractionColorTexture: {type: 't', value: null},
    gBufferNormal: {type: 't', value: null},
    refractionDepthTexture: {type: 't', value: null},
    refractionLinearDepth: {type: 't', value: null},
    screenResolution: {type: 'vec2', value: new THREE.Vector2()},
    cameraNearFar: {type: 'vec2', value: new THREE.Vector2()},
    inverseProjectionMatrix: {type: 'mat4', value: new THREE.Matrix4()},
    inverseViewMatrix: {type: 'mat4', value: new THREE.Matrix4()},
    ssrViewMatrix: {type: 'mat4', value: new THREE.Matrix4()},
    ssrProjectionMatrix: {type: 'mat4', value: new THREE.Matrix4()},
    //Live-tunable cap on the SSR ray-march step count (the per-pixel loop is the
    //dominant water-fragment cost). 48 = full reach (original behaviour); lower
    //trades reflection reach for fill rate; 0 skips the march (sky-only) as an
    //A/B bottleneck check. Uploaded per-frame from ocean-grid.js self.ssrMaxSteps.
    ssrMaxSteps: {type: 'f', value: 48.0},
    meteringSurveyTexture: {type: 't', value: null},
    sizeOfOceanPatch: {type: 'f', value: 1.0},
    ringIndex: {type: 'i', value: 0},
    baseHeightOffset: {type: 'f', value: 0.0},
    fogNear: {type: 'f', value: null},
    fogFar: {type: 'f', value: null},
    fogDensity: {type: 'f', value: null},
    fogColor: {type: 'v3', value: new THREE.Color()},
    t: {type: 'f', value: 0.0},
    brightestDirectionalLight: {type: 'vec3', value: new THREE.Vector3(1.0,1.0,1.0)},
    brightestDirectionalLightDirection: {type: 'vec3', value: new THREE.Vector3(1.0,1.0,1.0)},
    //Directional-light shadow-map receive. Zero flag when no caster exists; the
    //shader defaults to "unshadowed" so the pass is a no-op until a caster wires up.
    sunShadowMap: {type: 't', value: null},
    sunShadowMatrix: {type: 'mat4', value: new THREE.Matrix4()},
    sunShadowMapSize: {type: 'vec2', value: new THREE.Vector2(1024.0, 1024.0)},
    sunShadowRadius: {type: 'f', value: 1.0},
    sunShadowBias: {type: 'f', value: -0.003},
    sunShadowEnabled: {type: 'i', value: 0},
    //Ocean-only cascaded shadow map — EVSM (Exponential Variance Shadow
    //Map). Four cascades' moment textures (RGBA32F) rendered + blurred
    //by ocean-shadow-csm.js. Each fragment walks fine→coarse and samples
    //the first cascade whose UVs fall inside [0,1]. Per-cascade matrices
    //are split as oceanShadowMatrix0..3 so vertex-shader array-uniform
    //packing is not relied on.
    oceanShadowMap: {type: 't', value: [null, null, null, null]},
    oceanShadowMatrix0: {type: 'mat4', value: new THREE.Matrix4()},
    oceanShadowMatrix1: {type: 'mat4', value: new THREE.Matrix4()},
    oceanShadowMatrix2: {type: 'mat4', value: new THREE.Matrix4()},
    oceanShadowMatrix3: {type: 'mat4', value: new THREE.Matrix4()},
    oceanShadowMapSize: {type: 'v2v', value: [
      new THREE.Vector2(2048.0, 2048.0),
      new THREE.Vector2(2048.0, 2048.0),
      new THREE.Vector2(2048.0, 2048.0),
      new THREE.Vector2(2048.0, 2048.0)
    ]},
    //EVSM warp constant. MUST match the caster's evsmExpC. Larger values
    //reduce light bleed but compress depth precision; ~5 is a good
    //float32 balance for ocean depth slabs up to 10 km. Live-tunable
    //via setOceanEvsmExpC() — caster and receiver are pushed together.
    evsmExpC: {type: 'f', value: 5.0},
    //Floor on per-texel variance to prevent divide-by-zero in the
    //Chebyshev bound on perfectly flat texels. Sub-pixel value; raise
    //if grain shows in shadow gradients.
    evsmMinVariance: {type: 'f', value: 0.0001},
    //Light-bleed reduction. Linstep remaps the Chebyshev p_max so values
    //below this threshold become zero (firmly shadowed) and the rest
    //stretch to [0,1]. ~0.2 is typical for outdoor scenes.
    evsmLightBleedReduction: {type: 'f', value: 0.2},
    //Normal-offset bias in WORLD METERS. Receiver projects worldPos +
    //normal × this distance into shadow space. With EVSM the per-triangle
    //z-acne the offset was designed to mask is no longer the dominant
    //artifact, so the default is much smaller than the depth-comparison
    //era (was 0.5). Kept as a small belt-and-suspenders nudge.
    oceanShadowNormalBias: {type: 'f', value: 0.05},
    oceanShadowEnabled: {type: 'i', value: 0},
    //Debug visualisation switch (see water-shader.glsl). 0 = normal,
    //1 = shadow-factor full-screen, 2 = cascade-index full-screen.
    //Cascade-depth thumbnails and the bottom-corner jacobian/foam panels
    //draw only when this is non-zero.
    oceanShadowDebugMode: {type: 'i', value: 0},
    debugBlend: {type: 'f', value: 0.5},
    //skyAmbientColor is synthesized in ocean-grid.js from a-starry-sky's
    //y-axis hemispherical light (color * intensity). After the 2026-05-14
    //unit reconciliation it is consumed RAW in the water shader — same scale
    //as brightestDirectionalLight, no bridging scalars.
    skyAmbientColor: {type: 'vec3', value: new THREE.Vector3(0.1, 0.15, 0.2)},
    //Pope & Fry 1997 pure-water absorption at RGB sampling wavelengths
    //(615/535/465 nm) is ≈(0.35, 0.045, 0.011) m^-1; the values below are
    //the "tropical-clean" preset from the 2026-05-14 water-review SUMMARY,
    //sitting just under that for clarity. Scattering is wavelength-flat at
    //clean-ocean magnitude (~0.005 m^-1, Pope & Fry).
    //With absorption (0.30, 0.057, 0.010) and scattering (0.005, 0.005, 0.005):
    //  extinction ≈ (0.305, 0.062, 0.015), albedo ≈ (0.016, 0.080, 0.333).
    //Navy body color (not cyan), red-heavy extinction so deep water reads blue.
    waterAbsorption: {type: 'vec3', value: new THREE.Vector3(0.30, 0.057, 0.010)},
    waterScattering: {type: 'vec3', value: new THREE.Vector3(0.005, 0.005, 0.005)},
    reflectionScale: {type: 'f', value: 1.0},
    reflectionDistanceFalloff: {type: 'f', value: 0.0},
    fresnelDistanceRoughness: {type: 'f', value: 0.7},
    surfaceRoughness: {type: 'f', value: 0.15},
    //Crest-style sun-glint controls. Defaults reproduce the legacy ungated
    //additive glint exactly: gate 0 = no Fresnel gate, far falloff == near
    //(275) so the distance ramp is a no-op, boost 7.0 as before.
    specFresnelGate: {type: 'f', value: 0.0},
    specBoost: {type: 'f', value: 7.0},
    specFalloffFar: {type: 'f', value: 275.0},
    specFalloffFarDist: {type: 'f', value: 200.0},
    patchDataSize: {type: 'f', value: 1024.0},
    //Underwater state — see water-shader.glsl. Pushed every frame from
    //ocean-grid.js's submersion probe. cameraSubmersion defaults well above
    //the surface so a freshly-built material reads "above water" pre-probe.
    cameraSubmersion: {type: 'f', value: 1000.0},
    underwaterFactor: {type: 'f', value: 0.0},
    waterSurfaceY: {type: 'f', value: 0.0},
    //Underwater planar-reflection target + its world→UV texture matrix,
    //rendered + computed each submerged frame by ocean-grid.js.
    underwaterReflectionTexture: {type: 't', value: null},
    //Above-water transmission RT — separate submerged-frame render of the
    //fully-lit scene (sky dome restored, real materials, atmospheric
    //perspective, ocean grid + curtain hidden) from the submerged camera.
    //Sampled by the Snell-window transmitted-ray branch of
    //computeUnderwaterCeiling. Distinct from refractionColorTexture (raw
    //G-buffer albedo, useful only for the above-water seabed-through-water
    //lookup, not for upward Snell-window views).
    aboveWaterTransmissionTexture: {type: 't', value: null},
    underwaterReflectionMatrix: {type: 'mat4', value: new THREE.Matrix4()},
    atmosphereTransmittance: {type: 't', value: null},
    atmosphereMieInscattering: {type: 't', value: null},
    atmosphereRayleighInscattering: {type: 't', value: null},
    atmSunPosition: {type: 'vec3', value: new THREE.Vector3(0.0, 1.0, 0.0)},
    atmMoonPosition: {type: 'vec3', value: new THREE.Vector3(0.0, -1.0, 0.0)},
    atmSunHorizonFade: {type: 'f', value: 1.0},
    atmMoonHorizonFade: {type: 'f', value: 0.0},
    atmScatteringSunIntensity: {type: 'f', value: 1.0},
    atmScatteringMoonIntensity: {type: 'f', value: 0.0},
    atmMoonLightColor: {type: 'vec3', value: new THREE.Vector3(1.0, 1.0, 1.0)},
    atmCameraHeight: {type: 'f', value: 0.0},
    atmDistanceScale: {type: 'f', value: 1.0},
    blueNoiseTexture: {type: 't', value: null},
    blueNoiseTime: {type: 'f', value: 0.0},
    chop: {type: 'f', value: 0.75}
  },

  fragmentShader: function(causticsEnabled, foamEnabled, atmosphericPerspectiveEnabled, atmosphereFunctionsGLSL){
    let originalGLSL = [
    'precision highp float;',

    'varying vec2 vWorldXZ;',
    'varying vec3 vPosition;',
    'varying vec3 vDisplacedPosition;',
    'varying mat4 vInstanceMatrix;',
    'varying mat4 vModelMatrix;',
    'varying vec4 vSunShadowCoord;',
    'varying vec4 vOceanShadowCoord0;',
    'varying vec4 vOceanShadowCoord1;',
    'varying vec4 vOceanShadowCoord2;',
    'varying vec4 vOceanShadowCoord3;',

    '//uniform vec3 cameraDirection;',
    'uniform float sizeOfOceanPatch;',
    'uniform int ringIndex;',
    'uniform float chop;',
    'uniform float baseHeightOffset;',
    'uniform sampler2D cascadeDisplacementTextures[6];',
    'uniform float cascadePatchSizes[6];',
    'uniform vec2 cascadeSpatialOffsets[6];',
    '//Per-cascade slope variance σ² (in slope² units). Precomputed from JONSWAP +',
    '//directional spread in ocean-height-band-library.js. Used in the Fresnel',
    '//block to rebuild "effective roughness" of distant water — cascades whose',
    '//detail has been mipped/aliased away below the pixel grid contribute their',
    '//σ² to an α²_GGX that clamps grazing Fresnel via the Karis split-sum form.',
    'uniform float cascadeRMSSlope[6];',
    'uniform float waveHeightMultiplier;',
    'uniform sampler2D exclusionMap;',
    '//Snapped XZ origins of the foam/exclusion ortho cameras for this frame —',
    '//see template comment. Used in place of cameraPosition.xz when computing',
    "//atlas UVs so the atlas pattern doesn't drift sub-texel as the player moves.",
    'uniform vec2 foamCameraXZ;',
    'uniform vec2 exclusionCameraXZ;',
    '//Refraction G-buffer attachments — see water-shader-template.txt for the',
    "//layout. The MRT is allocated and populated in ocean-grid.js's refraction pass.",
    'uniform sampler2D refractionColorTexture;   //attachment 0: linear albedo',
    'uniform sampler2D gBufferNormal;            //attachment 1: world-space normal',
    'uniform sampler2D refractionDepthTexture;   //raw NDC depth (unprojection)',
    'uniform sampler2D refractionLinearDepth;    //attachment 2: linear view-space depth',
    'uniform vec2 screenResolution;',
    'uniform vec2 cameraNearFar;',
    'uniform mat4 inverseProjectionMatrix;',
    'uniform mat4 inverseViewMatrix;',
    'uniform mat4 ssrViewMatrix;',
    'uniform mat4 ssrProjectionMatrix;',
    '//Live-tunable cap on the SSR march step count. The 48-step ray-march (plus its',
    '//8-step binary refine and 4 silhouette taps) is the dominant per-pixel water',
    '//cost; this lets us trade reflection reach for fill rate, or set 0 to skip the',
    '//march entirely (sky-only) as an A/B bottleneck check.',
    'uniform float ssrMaxSteps;',
    'uniform sampler2D meteringSurveyTexture;',

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
      'uniform float foamStartLevel;',
    '#endif',

    '//Foam-texture scroll velocity (m/s). Driven from a randomized wind vector in',
    '//ocean-grid.js so foam drifts with the prevailing wind direction.',
    'uniform vec2 foamScrollVelocity;',
    '//Wind-driven foam bias ("dip the Jacobian", Sea-of-Thieves style). 0 in calm',
    '//seas; rises with wind so the fold threshold is met by progressively gentler',
    '//folds, and at storm strength by the open surface itself, turning the sea white.',
    '//Computed CPU-side from wind speed over a tunable range (ocean-grid.js).',
    'uniform float foamWindBias;',

    'uniform vec3 brightestDirectionalLight;',
    'uniform vec3 brightestDirectionalLightDirection;',

    '//Sun shadow map receive. When sunShadowEnabled == 0 the sample function short-',
    '//circuits to 1.0 (unshadowed) so the whole feature is a no-op with no caster.',
    'uniform sampler2D sunShadowMap;',
    'uniform vec2 sunShadowMapSize;',
    'uniform float sunShadowRadius;',
    'uniform float sunShadowBias;',
    'uniform int sunShadowEnabled;',
    '//Matrix is also declared in the vertex shader (where it builds vSunShadowCoord',
    '//for the surface fragment); the fragment shader needs its own copy so it can',
    '//project arbitrary world-space points (e.g. the Snell-refracted seabed-emergence',
    '//point) into shadow space.',
    'uniform mat4 sunShadowMatrix;',

    '//Ocean-only cascaded shadow map — EVSM (Exponential Variance Shadow Map).',
    "//Each cascade's texture stores 4 warped depth moments per texel (written",
    '//by the caster, then separable-Gaussian-blurred by ocean-shadow-csm.js):',
    '//  R = exp(c·z)',
    '//  G = exp(2c·z)',
    '//  B = -exp(-c·z)',
    '//  A = exp(-2c·z)',
    "//Receiver derives a probabilistic shadow bound via Chebyshev's inequality",
    '//on each warp pair, taking the min — the negative-warp pair is what kills',
    '//most of plain-VSM light bleed. Linear-filtered floats + the blur are',
    '//what give EVSM its smoothness; without the blur per-texel variance is',
    '//near zero and the bound degenerates to a hard depth comparison.',
    '//',
    '//Four cascades sampled fine→coarse: cascade 0 is the tightest (~60m),',
    '//cascade 3 the widest (full draw distance). The fragment shader walks',
    '//0→3 and uses the first cascade whose UVs fall inside [0,1], with a',
    '//narrow fade band into the next coarser cascade so the boundary is not',
    '//visible.',
    'uniform sampler2D oceanShadowMap[4];',
    'uniform vec2 oceanShadowMapSize[4];',
    'uniform int oceanShadowEnabled;',
    "//EVSM warp constant. MUST match the caster's evsmExpC exactly. Larger",
    '//values reduce light bleed but compress depth precision; ~5 is a good',
    '//float32 balance for ocean depth slabs up to 10 km.',
    'uniform float evsmExpC;',
    '//Floor on per-texel variance to prevent divide-by-zero in the Chebyshev',
    '//bound on perfectly flat texels. Sub-pixel value; raise if grain shows.',
    'uniform float evsmMinVariance;',
    '//Light-bleed reduction. Remaps the Chebyshev p_max via linstep so values',
    '//below this threshold become zero (firmly shadowed) and the rest stretch',
    '//to [0,1]. ~0.2 is typical for outdoor scenes; raise if penumbras look',
    '//hazy, lower if hard shadow edges feel too crisp.',
    'uniform float evsmLightBleedReduction;',
    '//Debug visualisation. 0 = normal render. 1 = full-screen shadow factor as',
    '//grayscale (white = lit, black = fully shadowed). 2 = full-screen cascade',
    '//index tint (C0=red, C1=green, C2=blue, C3=yellow, none=black). 3 =',
    "//receiver's sc.z for the selected cascade (grayscale). 4 = caster's stored",
    '//depth d at sc.xy for the selected cascade (grayscale). On flat water 3',
    '//and 4 must match texel-for-texel; any visible difference means the',
    '//caster/receiver matrices or the displacement-texture references are out',
    '//of sync. The 4-up cascade-depth thumbnail strip along the top of the',
    '//screen and the bottom-corner jacobian/foam panels are drawn only when',
    '//this is non-zero.',
    'uniform int oceanShadowDebugMode;',
    '//Opacity for the translucent cascade-band overlay (debug mode 40). 0 = scene',
    '//only, 1 = overlay only; in between blends the cascade colours over the real',
    '//render so fade boundaries can be read against the actual waves.',
    'uniform float debugBlend;',
    'uniform vec3 skyAmbientColor;',
    'uniform vec3 waterAbsorption;',
    'uniform vec3 waterScattering;',
    '//Sky-reflection attenuators. Real water has micro-roughness that statistically',
    '//averages incident sky radiance over a cone; our FFT+normal-map captures that',
    '//near camera only, so distant water acts as a perfect mirror against the HDR',
    '//sky LUT. reflectionScale is a flat global multiplier; reflectionDistanceFalloff',
    '//is the extra attenuation applied at distance to fake the roughness convolution.',
    'uniform float reflectionScale;',
    'uniform float reflectionDistanceFalloff;',
    '//Distance-based Fresnel peak compression. At sub-pixel facet density the',
    '//correct Fresnel is the integral of Schlick over the slope PDF, not the',
    '//evaluation at the LOD-flattened mean normal — without this, the horizon',
    '//reads as a bright mirror because every distant pixel collapses to a single',
    '//"flat upward" facet that gives near-100% grazing F. Compressing the grazing',
    '//peak with distance approximates the Kulla-Conty / Burley energy roll-off.',
    '//Range 0..1. 0 = standard Schlick everywhere; 0.85 ≈ ocean-photo-like horizon.',
    'uniform float fresnelDistanceRoughness;',

    '//Microfacet roughness for the Cook-Torrance sun-glint BRDF. Represents the',
    '//sub-pixel slope variance the FFT spectrum cannot resolve — capillary waves',
    "//and ripples below the smallest cascade's wavelength. The mesh-resolved",
    '//FFT slopes (cascade chain) drive the meso-normal, the roughness drives',
    '//the statistical microfacet distribution within each pixel. Low values',
    '//(~0.05) give tight pinpoint glints, higher (~0.15) widen into a soft glow.',
    '//Live-tunable from the console via setSurfaceRoughness().',
    'uniform float surfaceRoughness;',

    '//── Crest-style sun-glint controls (OceanReflection.hlsl:104-118) ────────────',
    '//specFresnelGate blends the Phong sun glint from our legacy ungated-additive',
    "//path (0.0 = byte-identical to before) to Crest's Fresnel-gated path (1.0),",
    '//where the glint rides INSIDE the reflection and shares its Schlick R_theta.',
    '//Near field (looking down, R_theta tiny) then cannot bloom however wide the',
    '//lobe; grazing mid/far (R_theta->1) brightens the glint with distance, curing',
    "//the mid-band dead zone. specBoost is Crest's _DirectionalLightBoost (the",
    '//compensation lever once the Fresnel gate dims the near field). The lobe',
    '//falloff varies from a near exponent to specFalloffFar over specFalloffFarDist',
    '//(Crest _DirectionalLightFallOffFar / _DirectionalLightFarDistance, sqrt ramp);',
    '//specFalloffFar defaults equal to the near exponent so the ramp is a no-op.',
    'uniform float specFresnelGate;',
    'uniform float specBoost;',
    'uniform float specFalloffFar;',
    'uniform float specFalloffFarDist;',

    'uniform float t;',
    'uniform float patchDataSize;',

    '//── Underwater state ─────────────────────────────────────────────────────',
    '//Signed metres of camera submersion: + above the water surface, − below.',
    '//Sourced CPU-side (ocean-grid.js) from a single-texel readback of the FFT',
    '//displacement at the camera XZ — cascades 0+1, the dominant swell.',
    'uniform float cameraSubmersion;',
    '//Smooth 0→1 underwater blend (1 = fully submerged). Crossfades the fog',
    "//model so bobbing through the waterline doesn't pop.",
    'uniform float underwaterFactor;',
    '//World-space Y of the wave-displaced water surface near the camera — the',
    '//air/water split threshold for per-fragment fog (Phase 1+ design).',
    'uniform float waterSurfaceY;',
    '//Underwater planar-reflection RT (the TIR mirror) + the world→UV texture',
    '//matrix that projects a ceiling fragment into that mirrored render.',
    'uniform sampler2D underwaterReflectionTexture;',
    'uniform mat4 underwaterReflectionMatrix;',
    '//Above-water transmission RT — a separate submerged-frame render of the',
    '//FULLY-LIT scene (sky dome restored, real materials, atmospheric perspective,',
    '//ocean grid hidden, underwater curtain hidden, scene.fog swapped back to the',
    '//a-starry-sky version). Sampled by the Snell-window transmitted-ray branch',
    '//of computeUnderwaterCeiling. The refraction G-buffer is unshaded raw',
    '//albedo with above-water content unfogged, useless for the upward view',
    '//through the surface; this target is the proper above-the-surface capture.',
    'uniform sampler2D aboveWaterTransmissionTexture;',

    '//Fog variables',
    '#if(!$atmospheric_perspective_enabled)',
      '#include <fog_pars_fragment>',
    '#endif',

    '#if($atmospheric_perspective_enabled)',
      'precision highp sampler3D;',
      'uniform sampler2D atmosphereTransmittance;',
      'uniform sampler3D atmosphereMieInscattering;',
      'uniform sampler3D atmosphereRayleighInscattering;',
      'uniform vec3 atmSunPosition;',
      'uniform vec3 atmMoonPosition;',
      'uniform float atmSunHorizonFade;',
      'uniform float atmMoonHorizonFade;',
      'uniform float atmScatteringSunIntensity;',
      'uniform float atmScatteringMoonIntensity;',
      'uniform vec3 atmMoonLightColor;',
      'uniform float atmCameraHeight;',
      'uniform float atmDistanceScale;',

      '#pragma ATMOSPHERE_FUNCTIONS_INJECTION_POINT',
    '#endif',

    '#if(!$atmospheric_perspective_enabled)',
      '//When atmospheric perspective is enabled, sRGBToLinear is provided by the',
      '//injected atmosphere functions (inside the #if block above). Otherwise we',
      '//need our own — declared here, BEFORE the SSR raymarch function that calls',
      '//it, because GLSL requires forward declarations before use.',
      'vec4 sRGBToLinear( in vec4 value ) {',
      '	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );',
      '}',
    '#endif',

    'uniform sampler2D blueNoiseTexture;',
    'uniform float blueNoiseTime;',


    "//R0 For Schlick's Approximation",
    '//With n1 = 1.33 and n0 = 1.0',
    'const float r0 = 0.02;',

    '//── Tunable shading constants ────────────────────────────────────────────',
    '//Pulled out of inline literals so the physical-review session can locate',
    '//and judge each fudge in one place. Anything labelled "empirical" here is',
    '//a candidate to derive from a physical quantity once the unified scatter',
    '//model in improvements.txt #11 lands.',

    '//Refraction-UV distortion magnitude, in screen-space, scaled by the',
    '//displaced FFT normal. Higher = more refractive shimmer but more visible',
    '//tile-edge bleed near opaque geometry.',
    'const float REFRACTION_DISTORTION = 0.03;',

    '//Wave-normal distortion applied to the underwater reflection sample — this',
    '//is what makes the planar (flat-plane) mirror ripple with the FFT waves.',
    'const float UNDERWATER_REFLECTION_DISTORTION = 0.06;',

    '//Artistic widening of the Snell-window edge, in units of cos(incidence). The',
    '//true water->air Fresnel curve spikes from ~15% to 100% within ~3 degrees of',
    '//the critical angle, so the window reads as a hard ring. This eases the',
    '//approach to total internal reflection over a wider angular band. Higher =',
    '//softer, blurrier window edge. Set to 0.0 for the strict physical curve.',
    'const float UNDERWATER_TIR_SOFTNESS = 0.13;',

    '//Effective-depth proxy: meters of underwater path per meter of horizontal',
    '//camera-to-fragment distance. Lets transmittance decay toward the horizon',
    '//even when no underwater geometry was hit by the refraction ray.',
    'const float HORIZONTAL_DEPTH_SCALE = 0.008;',

    '//Macro-normal slope clamp. Caps |∇h| before forming the cascade-0 macro',
    "//normal so a wave face steeper than ~50° tilt doesn't produce a near-",
    '//horizontal lighting normal (which blooms specular on the wrong faces).',
    '//foldBlend below is the structural fold-handling step; this clamp is a',
    '//numerical guard for the linearised slope→normal map.',
    'const float MACRO_SLOPE_MAX = 1.2;',

    '//── Crest sun back-scatter (Q8 sunset back-glow) ─────────────────────────',
    '//A thin-slab forward-scatter term that lights the visible face of a wave',
    '//crest when the sun is roughly OPPOSITE the camera (looking down-sun).',
    '//Light enters the back of the wave, scatters forward through the thin',
    '//water column at the crest, and exits toward the eye — producing the',
    '//green-gold halo on backlit crests at sunrise/sunset. Crest-style',
    '//(_SubSurfaceSunFallOff / _SubSurfaceHeightMax) shape; gated by wave',
    '//height so flat water never glows, and by Fresnel-T so grazing waves',
    '//reflect rather than transmit.',
    '//',
    '//SUB_SURFACE_HEIGHT_MIN  — wave height above rest (m) at which crests start',
    '//                          to transmit. Below this the term is zero.',
    '//SUB_SURFACE_HEIGHT_RANGE — softening range over which the term ramps in.',
    '//SUB_SURFACE_FALL_OFF    — exponent of the forward-scatter lobe along the',
    '//                          view-aligned-to-sun axis. Higher = tighter halo',
    '//                          aligned with the sun direction; ~5-8 reads as a',
    '//                          plausible Henyey-Greenstein forward peak.',
    '//SUB_SURFACE_STRENGTH    — overall scalar on the contribution.',
    'const float SUB_SURFACE_HEIGHT_MIN   = 0.4;',
    'const float SUB_SURFACE_HEIGHT_RANGE = 1.8;',
    'const float SUB_SURFACE_FALL_OFF     = 6.0;',
    'const float SUB_SURFACE_STRENGTH     = 1.4;',

    'float linearizeDepth(float depthSample){',
      'float near = cameraNearFar.x;',
      'float far = cameraNearFar.y;',
      'return near * far / (far - depthSample * (far - near));',
    '}',

    "//PCF-soft sample against the sun's shadow map. Returns 1.0 for fully lit,",
    '//0.0 for fully shadowed. Fragments outside the shadow frustum read as lit so',
    "//the map's edge doesn't produce a hard shadow seam across open ocean.",
    '//',
    '//On WebGL2 Three.js uses a depth-texture attachment for directional shadow',
    '//maps, so sampling the red channel gives the normalized depth directly. The',
    '//earlier RGBA-unpack variant was reading garbage on this pipeline, which is',
    '//what caused the wave-shaped acne we saw over the rock mesh.',
    'float getSunShadow(vec4 shadowCoord){',
      'if(sunShadowEnabled == 0) return 1.0;',
      'vec3 sc = shadowCoord.xyz / shadowCoord.w;',
      '//Depth clips stay hard — sc.z outside [0,1] genuinely means no info.',
      'if(sc.z > 1.0 || sc.z < 0.0) return 1.0;',
      '//Hard-reject only OUTSIDE the lateral frustum. Fragments just inside the',
      '//edge still sample the map; the fade band below blends them toward "lit"',
      "//so the boundary doesn't read as a hard line on the water. Without this,",
      "//a tall caster's long shadow gets sliced by the frustum edge as a sharp",
      '//diagonal — see modes 25/26 (added 2026-05-20) to visualise.',
      'vec2 edgeDist = min(sc.xy, vec2(1.0) - sc.xy);',
      'float edge = min(edgeDist.x, edgeDist.y);',
      'if(edge < 0.0) return 1.0;',
      '//Receiver-plane slope bias: dFdx/dFdy of sc.z give the rate at which shadow-space',
      '//depth changes per screen pixel. Steeply tilted surfaces need more bias to stay',
      '//above the depth-map quantisation noise, otherwise they self-shadow as acne.',
      '//Clamp because near-grazing pixels can produce huge derivatives that would push',
      '//refZ off the map entirely (peter-panning).',
      'float slopeBias = clamp(length(vec2(dFdx(sc.z), dFdy(sc.z))), 0.0, 0.01);',
      'float refZ = sc.z + sunShadowBias - slopeBias;',
      'vec2 texelSize = (1.0 / sunShadowMapSize) * sunShadowRadius;',
      'float shadow = 0.0;',
      'for(int x = -1; x <= 1; x++){',
        'for(int y = -1; y <= 1; y++){',
          'float d = texture2D(sunShadowMap, sc.xy + vec2(float(x), float(y)) * texelSize).r;',
          'shadow += refZ < d ? 1.0 : 0.0;',
        '}',
      '}',
      'shadow *= (1.0 / 9.0);',
      '//Soft edge fade: lerp from shadow value toward fully lit over the outer',
      "//5% of UV space. At a 200m frustum that's a 10m fade band; at 800m it's",
      "//40m. Wide enough to hide the cutoff, narrow enough to keep the shadow's",
      '//real silhouette inside the frustum sharp.',
      'float fade = smoothstep(0.0, 0.05, edge);',
      'return mix(1.0, shadow, fade);',
    '}',

    "//EVSM evaluation. Each cascade's texture stores 4 warped depth moments",
    '//per texel (computed by the caster, separable-Gaussian-blurred). Receiver',
    '//converts its own fragment depth to the same warped domain, then derives',
    "//a probabilistic shadow upper bound via Chebyshev's inequality on each",
    '//warp pair. The min of the two bounds is what eliminates most of plain-',
    '//VSM light bleed (the "E" in EVSM).',
    '//',
    '//Why Chebyshev: variance shadow maps replace the binary depth comparison',
    '//with a statistical comparison. The bound is sharp (=1.0 fully lit) when',
    '//the receiver depth is closer than the moment mean, and falls off',
    '//smoothly past it. Per-triangle z-acne — the core failure mode of the',
    '//old depth-comparison path on smooth ocean meshes — becomes a soft',
    '//gradient instead of binary flips between adjacent triangles.',
    '//',
    '//Sampler-array indices in GLSL ES must be constant integral expressions,',
    '//so the 4-cascade selection is unrolled rather than written as a for-loop.',
    '//The `if(found) return` pattern short-circuits the texture read once a',
    '//covering cascade is found — typically C0 near camera, C3 at horizon.',

    'float chebyshevUpperBound(vec2 moments, float d){',
      '//moments.x = E[d_warp], moments.y = E[d_warp^2]. Variance = M2 - M1^2.',
      '//If the receiver depth is at or before the mean, no occluder is closer',
      '//than this fragment so it is fully lit. Past the mean, the bound falls',
      '//off as variance / (variance + diff^2), giving a smooth shadow gradient',
      '//whose hardness depends on per-texel depth variance.',
      'if(d <= moments.x) return 1.0;',
      'float variance = max(moments.y - moments.x * moments.x, evsmMinVariance);',
      'float diff = d - moments.x;',
      'return variance / (variance + diff * diff);',
    '}',

    'float reduceLightBleed(float pmax){',
      '//Plain VSM tends to leak light through partial occluders ("light bleed"',
      '//around tall thin shadow casters). The EVSM negative-warp pair already',
      '//removes most of it; a final linstep remap kills the remainder by',
      '//pushing the lower part of the bound to zero.',
      'return clamp((pmax - evsmLightBleedReduction) / (1.0 - evsmLightBleedReduction), 0.0, 1.0);',
    '}',

    'float sampleOceanCascadeEVSM(sampler2D momentMap, vec3 sc){',
      '//Sample the 4 moments with hardware bilinear (LinearFilter on the float',
      '//target), warp the fragment depth into the same domain, and take the',
      '//min of the two Chebyshev bounds. Linear filtering of warped moments',
      '//is mathematically valid because the warp is monotonic — bilinear',
      '//interpolation of moments equals the moments of the bilinear-',
      '//interpolated warped depth.',
      'vec4 moments = texture2D(momentMap, sc.xy);',
      '//No-caster guard. A real occluder warps to M1 = E[exp(evsmExpC·z)] with',
      '//z in [0,1], so M1 >= exp(0) = 1 always; the separable Gaussian blur is a',
      '//convex average and preserves M1 >= 1. Therefore M1 < 1 is impossible for',
      '//any real occluder — it can ONLY be the caster no-occluder clear',
      '//baseline. That baseline is meant to be the far-plane moments (M1 = exp(c)',
      "//≈ 148 = fully lit), but the renderer's premultiplied alpha multiplies the",
      '//clear RGB by the clear alpha (= M4 = exp(-2c) ≈ 0), collapsing M1 to',
      '//exp(-c) ≈ 0.0067. That fake near-plane occluder shadows every open-water',
      '//texel beyond the caster footprint and kills the sun glint there (visible',
      '//as the dead band; mode 4 shows these texels black). Real M1 ≥ 1, collapsed',
      '//M1 ≈ exp(-c) < 1, so reading M1 < 1 as "no occluder → fully lit" cancels',
      '//the artifact without touching genuine wave-on-wave self-shadow inside the',
      '//footprint. (Fixing the clear at the source so mode 4 reads correctly is a',
      '//separate follow-up — this makes the shadow itself correct.)',
      'if(moments.x < 0.999) return 1.0;',
      'float dPos =  exp( evsmExpC * sc.z);',
      'float dNeg = -exp(-evsmExpC * sc.z);',
      'float pPos = chebyshevUpperBound(moments.xy, dPos);',
      'float pNeg = chebyshevUpperBound(moments.zw, dNeg);',
      'return reduceLightBleed(min(pPos, pNeg));',
    '}',

    'bool oceanCascadeContains(vec3 sc, float marginUV){',
      '//Both ends of z need gating: sc.z > 1 → past far plane, sc.z < 0 →',
      '//between light and near plane. Without the lower bound, fragments in',
      '//front of the cascade get sampled with junk depth and silently read',
      '//as lit. marginUV insets the lateral [0,1] window so fragments whose',
      '//blur-kernel reach would spill past the cascade edge fall through to',
      '//the next coarser cascade rather than reading clamp-to-edge garbage.',
      'return sc.x >= marginUV && sc.x <= 1.0 - marginUV',
          '&& sc.y >= marginUV && sc.y <= 1.0 - marginUV',
          '&& sc.z >= 0.0 && sc.z <= 1.0;',
    '}',

    '//UV margin sized to exceed the EVSM Gaussian blur reach. Blur uses a',
    '//stride-2 9-tap kernel (8 texels each side), so a 9-texel inset keeps',
    '//cascade-edge fragments out of the blur footprint and they fall through',
    '//to the next coarser cascade rather than sampling moments contaminated',
    '//by the clear-color baseline outside the caster.',
    'float oceanCascadeMarginUV(int cascadeIdx){',
      'return 9.0 / oceanShadowMapSize[cascadeIdx].x;',
    '}',

    '//Returns 1.0 if the fragment is well inside the cascade and 0.0 if it sits',
    "//right at the cascade's kernel-clipped edge — used to lerp between this",
    '//cascade and the next coarser one in the overlap zone. Without fade, the',
    '//walk-fine-to-coarse switch makes a visible discontinuity at every cascade',
    '//boundary because consecutive cascades have different texel sizes, PCF',
    '//radii, and (sometimes) caster geometry detail. The ratio scales with the',
    "//cascade's usable size so the absolute fade width grows with cascade extent",
    "//(matching three-csm's quadratic-margin idea).",
    'const float OCEAN_SHADOW_FADE_FRACTION = 0.20;',

    '//DEBUG amplifier on the ocean shadow only (NOT the scene shadow). Set to 1.0',
    '//for physically-correct output. >1.0 over-darkens the shadowed regions to',
    '//make subtle wave-on-wave occlusion visually obvious — useful when checking',
    '//whether self-shadow is firing at all. Applied as',
    '//  out = 1 - BOOST * (1 - shadow), clamped to [0,1].',
    'const float OCEAN_SHADOW_DEBUG_DARKNESS_BOOST = 1.0;',

    'float oceanCascadeFadeWeight(vec3 sc, float marginUV){',
      'float distToEdge = min(min(sc.x - marginUV, (1.0 - marginUV) - sc.x),',
                             'min(sc.y - marginUV, (1.0 - marginUV) - sc.y));',
      'float fadeWidth = OCEAN_SHADOW_FADE_FRACTION * (0.5 - marginUV);',
      'return clamp(distToEdge / fadeWidth, 0.0, 1.0);',
    '}',

    'float getOceanShadow(vec4 shadowCoord0, vec4 shadowCoord1, vec4 shadowCoord2, vec4 shadowCoord3, vec3 worldNormal, vec3 sunDir){',
      'if(oceanShadowEnabled == 0) return 1.0;',

      '//Walk fine→coarse. At each cascade hit, sample its EVSM moments; if',
      "//the fragment sits in the outer fade zone (near the cascade's edge),",
      '//also sample the next coarser cascade and lerp. This hides what would',
      '//otherwise be a visible character-change at every cascade boundary',
      '//(texel size jumps, caster detail differs because coarser cascades',
      '//pull from larger ocean rings). EVSM removes the per-cascade biasScale',
      '//gymnastics the depth-comparison path needed — the Chebyshev bound is',
      '//unitless and behaves identically across cascades.',

      '//C0 → fades into C1',
      'vec3 sc0 = shadowCoord0.xyz / shadowCoord0.w;',
      'float margin0 = oceanCascadeMarginUV(0);',
      'if(oceanCascadeContains(sc0, margin0)){',
        'float shadow0 = sampleOceanCascadeEVSM(oceanShadowMap[0], sc0);',
        'float w0 = oceanCascadeFadeWeight(sc0, margin0);',
        'if(w0 >= 1.0) return shadow0;',
        'vec3 sc1 = shadowCoord1.xyz / shadowCoord1.w;',
        'float margin1 = oceanCascadeMarginUV(1);',
        'if(oceanCascadeContains(sc1, margin1)){',
          'float shadow1 = sampleOceanCascadeEVSM(oceanShadowMap[1], sc1);',
          'return mix(shadow1, shadow0, w0);',
        '}',
        'return shadow0;',
      '}',

      '//C1 → fades into C2',
      'vec3 sc1 = shadowCoord1.xyz / shadowCoord1.w;',
      'float margin1 = oceanCascadeMarginUV(1);',
      'if(oceanCascadeContains(sc1, margin1)){',
        'float shadow1 = sampleOceanCascadeEVSM(oceanShadowMap[1], sc1);',
        'float w1 = oceanCascadeFadeWeight(sc1, margin1);',
        'if(w1 >= 1.0) return shadow1;',
        'vec3 sc2 = shadowCoord2.xyz / shadowCoord2.w;',
        'float margin2 = oceanCascadeMarginUV(2);',
        'if(oceanCascadeContains(sc2, margin2)){',
          'float shadow2 = sampleOceanCascadeEVSM(oceanShadowMap[2], sc2);',
          'return mix(shadow2, shadow1, w1);',
        '}',
        'return shadow1;',
      '}',

      '//C2 → fades into C3',
      'vec3 sc2 = shadowCoord2.xyz / shadowCoord2.w;',
      'float margin2 = oceanCascadeMarginUV(2);',
      'if(oceanCascadeContains(sc2, margin2)){',
        'float shadow2 = sampleOceanCascadeEVSM(oceanShadowMap[2], sc2);',
        'float w2 = oceanCascadeFadeWeight(sc2, margin2);',
        'if(w2 >= 1.0) return shadow2;',
        'vec3 sc3 = shadowCoord3.xyz / shadowCoord3.w;',
        'float margin3 = oceanCascadeMarginUV(3);',
        'if(oceanCascadeContains(sc3, margin3)){',
          'float shadow3 = sampleOceanCascadeEVSM(oceanShadowMap[3], sc3);',
          'return mix(shadow3, shadow2, w2);',
        '}',
        'return shadow2;',
      '}',

      '//C3 — no further cascade to fade into; hard transition to "lit" at edge.',
      '//That edge sits at the horizon for typical configs so the discontinuity',
      '//is barely visible.',
      'vec3 sc3 = shadowCoord3.xyz / shadowCoord3.w;',
      'float margin3 = oceanCascadeMarginUV(3);',
      'if(oceanCascadeContains(sc3, margin3)){',
        'return sampleOceanCascadeEVSM(oceanShadowMap[3], sc3);',
      '}',
      'return 1.0;',
    '}',

    '#if($atmospheric_perspective_enabled)',
      '//Forward declaration — defined later, alongside applyAtmosphericPerspective.',
      'vec3 computeSkyRadiance(vec3 worldDir);',
    '#endif',

    '//Screen-space reflection using the refraction color+depth buffer (already rendered',
    '//from the main camera with water hidden — zero extra render passes).',
    '//Exponential stepping covers nearby geometry detail AND distant sky.',
    '//Sky fallback: LUT-based atmosphere (when enabled) or metering survey fisheye.',
    '//Returns LINEAR radiance — caller must NOT apply sRGBToLinear to the result.',
    '//Geometry hits come from the sRGB refraction buffer and are converted here.',
    'vec3 screenSpaceReflection(vec3 worldPos, vec3 reflectDir){',
      'vec3 viewPos     = (ssrViewMatrix * vec4(worldPos,    1.0)).xyz;',
      'vec3 viewReflect = normalize(mat3(ssrViewMatrix) * reflectDir);',

      '//Sky fallback: use LUT-based sky radiance when atmosphere is enabled for correct horizon',
      '//colors; fall back to metering survey fisheye for the no-atmosphere build path.',
      '#if($atmospheric_perspective_enabled)',
        'vec3 skyColor = computeSkyRadiance(reflectDir);',
      '#else',
        'vec2 skyUV = clamp(reflectDir.xz * 0.5 + 0.5, 0.01, 0.99);',
        'vec3 skyColor = texture2D(meteringSurveyTexture, skyUV).rgb;',
      '#endif',

      '//Note: a procedural sun-disk/halo addition was attempted here to fill the',
      '//"dark hole" in computeSkyRadiance at the sun direction at sunset (the',
      '//Mie forward-scattering peak gets crushed by atmSunHorizonFade^3). It',
      "//produced wrong colors when combined with the LUT's dim plum baseline.",
      "//The proper fix is to either (a) sample a-starry-sky's actual sun render",
      '//target in the SSR fallback, or (b) hide the sun mesh during the G-buffer',
      '//refraction pass and have the sky LUT include a proper sun peak.',
      '//Deferred to a follow-up session.',

      '//Reflected ray pointing behind the camera — skip march, return sky directly.',
      'if(viewReflect.z > 0.0){',
        'return skyColor;',
      '}',

      '//Exponential step: starts at 0.25m, grows 1.2x each step. Was 0.5m / 1.3x;',
      '//the slower growth pulls the step size at mid-distance hits down by ~3x',
      '//(at iter ~15 the old curve was ~30 m/step, the new one is ~9 m/step), so',
      '//binary refinement starts from a tighter bracket and converges to ~cm-',
      '//level residual on reflections out to ~100 m instead of the metres of',
      '//residual the old curve gave at that range.',
      'float stepLen = 0.25;',
      'vec3 curPos = viewPos;',
      'vec3 prevPos = viewPos;',

      '//48 is the hard loop ceiling (GLSL ES requires a constant bound); ssrMaxSteps',
      '//caps the live count below it. Hitting the cap with no crossing falls through',
      '//to the sky return below — identical to running out of steps naturally.',
      'for(int i = 0; i < 48; i++){',
        'if(float(i) >= ssrMaxSteps){ break; }',
        'prevPos = curPos;',
        'curPos  += viewReflect * stepLen;',
        'stepLen *= 1.2;',

        'vec4 clip = ssrProjectionMatrix * vec4(curPos, 1.0);',
        'if(clip.w <= 0.0) break;',
        'vec2 uv = clip.xy / clip.w * 0.5 + 0.5;',

        '//Ray exited screen — return sky.',
        'if(uv.x < 0.01 || uv.x > 0.99 || uv.y < 0.01 || uv.y > 0.99){',
          'return skyColor;',
        '}',

        'float sceneDepth = texture2D(refractionLinearDepth, uv).r;',
        'float rayDepth   = -curPos.z;',
        'float depthDelta = rayDepth - sceneDepth;',
        'float farThreshold = cameraNearFar.y * 0.95;',
        '//Loose crossing gate — every accepted hit gets binary-search refinement',
        '//and a silhouette check below, so thickness can be generous here.',
        'float maxThickness = stepLen + 1.0;',

        '//Note: previously gated `uv.y > 0.5`, rejecting any hit whose projected',
        '//screen position lands in the lower half. That truncated reflections of',
        '//tall geometry (like the lighthouse) to whatever bit happened to project',
        '//into the upper half — usually just the very top of the base. Removed:',
        '//the depth + silhouette checks already do the work, and "lower-half hit"',
        "//is not a meaningful rejection criterion in itself (the bounced ray's",
        '//hit position has no necessary relationship to camera screen-space halves).',
        'if(depthDelta > 0.0 && depthDelta < maxThickness &&',
           'sceneDepth > 2.0 && sceneDepth < farThreshold){',

          '//Binary-search refinement: the actual crossing lies between prevPos and',
          '//curPos. 8 iterations narrows it to ~1/256 of the last step length, so',
          '//real hits converge to sub-cm residual even when the outer step has',
          '//grown to tens of metres at the horizon. Was 5 iterations (1/32);',
          '//3 extra iterations cost 3 depth taps per accepted hit and visibly',
          '//sharpen where the reflection of an object meets the waterline.',
          '//Thickness-bug rays (ray passes behind thin geometry whose back face is',
          "//not in the depth buffer) still converge, but only to the thin object's",
          '//front face — which the silhouette check below then rejects.',
          'vec3 lo = prevPos;',
          'vec3 hi = curPos;',
          'vec2  hitUV         = uv;',
          'float hitSceneDepth = sceneDepth;',
          'float hitDelta      = depthDelta;',
          'for(int j = 0; j < 8; j++){',
            'vec3 mid = 0.5 * (lo + hi);',
            'vec4 midClip = ssrProjectionMatrix * vec4(mid, 1.0);',
            'vec2 midUV   = midClip.xy / midClip.w * 0.5 + 0.5;',
            'float midDepth = texture2D(refractionLinearDepth, midUV).r;',
            'float midDelta = -mid.z - midDepth;',
            'if(midDelta > 0.0){',
              'hi            = mid;',
              'hitUV         = midUV;',
              'hitSceneDepth = midDepth;',
              'hitDelta      = midDelta;',
            '} else {',
              'lo = mid;',
            '}',
          '}',

          '//Silhouette check: sample 4 neighbors. A thick surface — even on its',
          '//edge — has at most ONE neighbor reading far background (the side',
          '//pointing away from the object). A thin object (tree, railing, wire)',
          '//has TWO opposing neighbors reading background. Using the 2nd-largest',
          '//delta instead of the max distinguishes the two cases and stops us',
          '//from rejecting the outline of every solid object.',
          'vec2 px = vec2(0.002);',
          'float dN = abs(texture2D(refractionLinearDepth, hitUV + vec2( 0.0,  px.y)).r - hitSceneDepth);',
          'float dS = abs(texture2D(refractionLinearDepth, hitUV + vec2( 0.0, -px.y)).r - hitSceneDepth);',
          'float dE = abs(texture2D(refractionLinearDepth, hitUV + vec2( px.x, 0.0)).r - hitSceneDepth);',
          'float dW = abs(texture2D(refractionLinearDepth, hitUV + vec2(-px.x, 0.0)).r - hitSceneDepth);',
          '//Second-largest of four: max of (min-of-each-pair, min-of-the-two-maxes).',
          'float secondMax = max(max(min(dN, dS), min(dE, dW)),',
                                'min(max(dN, dS), max(dE, dW)));',
          'float silhouetteThreshold = hitSceneDepth * 0.05 + 1.0;',

          '//Soft rejection: smoothstep out as the silhouette measure grows, instead',
          '//of a hard cutoff. Hard cutoffs produce moire/striping when the refined',
          '//hitUV jitters sub-pixel across adjacent fragments.',
          'float silhouetteConfidence =',
            '1.0 - smoothstep(silhouetteThreshold * 0.6, silhouetteThreshold, secondMax);',

          '//Convergence threshold scales with step size: 5 binary halvings of a',
          '//step of length L leaves at most L/32 of residual on a real crossing,',
          '//so 0.1*stepLen + 0.5 is generous margin. A constant 0.5 rejected every',
          '//far hit because exponential stepping reaches ~100m-per-step by iter 20.',
          'float convergenceThreshold = stepLen * 0.1 + 0.5;',
          'if(hitDelta < convergenceThreshold && silhouetteConfidence > 0.0){',
            'vec2  edgeDist = abs(hitUV * 2.0 - 1.0);',
            'float edgeFade = 1.0 - smoothstep(0.80, 1.0, max(edgeDist.x, edgeDist.y));',
            '//G-buffer attachment 0 is already LINEAR (the G-buffer fragment shader',
            '//sRGB-decodes source albedo before writing). The refraction sampling',
            '//below at the equivalent line correctly samples without a second decode',
            '//— this one used to do sRGBToLinear() here, which gamma-darkened the',
            '//reflection so lighthouse bricks read as near-black silhouettes.',
            'vec3  hitAlbedo = texture2D(refractionColorTexture, hitUV).rgb;',
            '//Apply approximate lighting at the hit point so the reflection matches',
            '//the lit appearance of the reflected geometry, not just raw albedo.',
            '//Lambertian sun diffuse (using gBufferNormal as the surface normal) +',
            "//skyAmbientColor as hemispheric fill. We don't have shadow info for",
            '//the hit point, so reflected-into-shadow regions will read slightly',
            '//overlit — acceptable trade for a cheap approximation.',
            'vec3  hitNormal = normalize(texture2D(gBufferNormal, hitUV).rgb);',
            'float hitNdotL  = max(0.0, dot(hitNormal, -brightestDirectionalLightDirection));',
            'vec3  hitLight  = brightestDirectionalLight * hitNdotL + skyAmbientColor;',
            'vec3  hitColor  = hitAlbedo * hitLight;',
            'return mix(skyColor, hitColor, edgeFade * silhouetteConfidence);',
          '}',
          '//Rejected — keep marching; a thicker surface may lie further along the ray.',
        '}',
      '}',

      '//Max steps without hit — sky.',
      'return skyColor;',
    '}',

    'vec4 linearTosRGB(vec4 value ) {',
      'return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );',
    '}',

    '//Including this because someone removed this in a future versio of THREE. Why?!',
    'vec3 MyAESFilmicToneMapping(vec3 color) {',
      'return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);',
    '}',

    '//Fresnel reflectance at air->water interface (for light entering the water from above)',
    '//Schlick approximation with n_water = 1.33 — uses the file-level r0 constant.',
    'float fresnelAirToWater(float cosTheta){',
      'return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);',
    '}',

    '//Henyey–Greenstein single-parameter phase function. Properly normalised',
    '//(integrates to 1 over the sphere), so the 1/(4π) is baked in. g>0 means',
    '//forward-scattering; g≈0.85 is the canonical ocean-water value (Mobley 1994).',
    'const float UW_PI = 3.14159265359;',
    '//Henyey-Greenstein asymmetry. 0.85 is the canonical clean-ocean value',
    '//(Mobley 1994), but with that peaked phase the inscatter looking',
    '//perpendicular to the sun (e.g. underwater cam at the horizon while the',
    '//sun is overhead) is ~100× weaker than the forward halo — so the horizon',
    '//read as nearly black even at midday. Dropping to 0.5 (turbid coastal',
    '//range) lifts perpendicular scatter so the horizon picks up real sun',
    '//light and asymptotes to a visible teal.',
    'const float UW_HG_G = 0.5;',
    'const float UW_INV_4PI = 0.07957747154;',
    "//How much the murk's SUN single-scatter term keeps its view (gaze) dependence.",
    '//1.0 = full Henyey-Greenstein halo (physical: brighter looking toward the sun,',
    '//dimmer away). 0.0 = collapse the sun phase to isotropic (1/4π), making the',
    '//equilibrium teal view-INDEPENDENT so the directly-viewed seabed (down gaze) and',
    '//the reflected ceiling (up gaze) fade to the SAME teal — the uniform "colour of',
    '//the water" look. Kept at 0.0: with the sky-ambient term restored the murk is no',
    '//longer dark, but the physical halo at 1.0 still reintroduces a top/bottom',
    "//difference between seabed and ceiling, which we don't want here. Flip to 1.0 if",
    "//you prefer the physical sun glow. MUST stay in lockstep with the chunk's",
    '//UW_MURK_GAZE_WEIGHT in ocean-grid.js _injectUnderwaterFogChunk so the seabed/',
    '//curtain fog uses the same phase as this ceiling/body path.',
    'const float UW_MURK_GAZE_WEIGHT = 0.0;',
    '//Underwater fog isolation taps — debugging the seabed-vs-ceiling murk match.',
    '//MUST match UW_DEBUG_FOG_MODE in ocean-grid.js _injectUnderwaterFogChunk so both',
    '//the direct-seabed (chunk) and reflected-ceiling (this applyUnderwaterFog) paths',
    '//are bisected together.',
    '//  0 = normal production blend.',
    '//  1 = NO fog (raw input passes through).',
    '//  2 = fog a CONSTANT input color (vec3(0.5)) — isolates the blend from content.',
    '//  3 = output the inscatter MURK only (full fog) — shows what each path fades to.',
    'const int UW_DEBUG_FOG_MODE = 0;',
    '//Underwater path-length scale. 1.0 = physically true geometric distance:',
    '//extinction (absorption + scattering, per metre) integrates over the REAL ray',
    '//length, with NO magnification. The distance to a rock is the distance to a',
    '//rock; a surface->floor reflection bounce is just its real, longer path. Was',
    '//0.3 — a non-physical clarity fudge that made the water ~3.3x clearer than its',
    '//Jerlov coefficients AND disagreed with the camera-depth darkening (line ~818),',
    '//which always integrated full extinction over true depth. Set water visibility',
    '//PHYSICALLY via water_type / the Jerlov coefficients instead of discounting',
    '//distance. Must match UW_DIST_SCALE in the chunk (ocean-grid.js',
    '//_injectUnderwaterFogChunk) so the ceiling and direct-view seabed agree.',
    'const float UW_DIST_SCALE = 1.0;',
    'float henyeyGreenstein(float cosTheta, float g){',
      'float g2 = g * g;',
      'return (1.0 - g2) * UW_INV_4PI',
             '/ pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5);',
    '}',

    '//Single-scatter inscatter equilibrium of the water medium, evaluated at the',
    '//surface (depth 0) for a given view direction. Two contributions:',
    '//  • Sun  — collimated downwelling, Henyey-Greenstein phase along the view ray.',
    '//           Strongly view-direction-dependent: bright halo when you look toward',
    '//           the sun, dim when you look away.',
    '//  • Sky  — diffuse hemispherical downwelling, treated as isotropic phase',
    '//           (1/4π). View-direction-independent.',
    "//Both are scaled by waterAlbedo = scattering / extinction — the medium's",
    '//single-scatter albedo, the fraction of an absorbed photon that re-emerges',
    '//as scattered radiance. Result is per-channel pre-tonemap LDR or HDR.',
    '//',
    '//Convention (matches water-shader.glsl :1640-1648): `brightestDirectionalLightDirection`',
    '//points FROM the sun TO the scene — i.e., the direction sunlight travels.',
    '//HG cos θ = dot(incident, scattered) = dot(lightDir, -viewDir) = -dot(lightDir, viewDir).',
    '//cos θ = +1 when the camera looks TOWARD the sun (viewDir = -lightDir) — HG peaks',
    '//there (forward scattering, the halo-around-the-sun look).',
    'vec3 underwaterInscatterSurface(vec3 viewDirWorld){',
      'vec3 extinction = waterAbsorption + waterScattering;',
      'vec3 albedo = waterScattering / max(extinction, vec3(1e-4));',
      '//Same directDownwelling / ambientDownwelling components the body-colour blend',
      '//uses (water-shader.glsl :1373) so all three fog paths reference one source.',
      '//Computed inline because applyUnderwaterFog is called BEFORE the main()',
      '//block that builds those variables — we redo the small calc here.',
      'float sunCosZenith = max(dot(-brightestDirectionalLightDirection, vec3(0.0, 1.0, 0.0)), 0.0);',
      'float sunTransmission = 1.0 - fresnelAirToWater(sunCosZenith);',
      'vec3 directDownwelling = brightestDirectionalLight * sunTransmission * sunCosZenith;',
      'vec3 ambientDownwelling = skyAmbientColor;',
      '//Sun: HG-phased single scatter into the view ray. Blend the HG halo toward',
      '//the isotropic phase (1/4π) by UW_MURK_GAZE_WEIGHT — at 0.0 the sun term is',
      '//view-independent so the murk equilibrium no longer depends on gaze (the',
      '//direct-vs-reflected horizon test; see the const above).',
      'float cosTheta = -dot(viewDirWorld, brightestDirectionalLightDirection);',
      'float pSun = mix(UW_INV_4PI, henyeyGreenstein(cosTheta, UW_HG_G), UW_MURK_GAZE_WEIGHT);',
      '//Sky: hemispherical isotropic approximation. 1/(2π) is the contribution of',
      '//a uniform upper hemisphere to a single-scattering point with isotropic',
      '//phase (∫ p_iso L_sky dω over the hemisphere = E_sky/(2π)).',
      'float pSky = 1.0 / (2.0 * UW_PI);',
      'vec3 singleScatter = albedo * (directDownwelling * pSun + ambientDownwelling * pSky);',
      '//Multiple-scatter diffuse glow — the dominant visible murk, and the term that',
      '//keeps the off-sun water from reading black. Single scatter (above) is',
      '//forward-peaked through pSun so it collapses to ~0 perpendicular to the sun;',
      '//real water re-scatters its own light many times into an isotropic volume',
      '//glow. Model that glow with the semi-infinite-medium diffuse reflectance',
      '//(the "ocean colour" similarity relation), R∞ = (1-√(1-a))/(1+√(1-a)) per',
      '//channel, driven by the total downwelling and spread Lambertian (1/π). This',
      '//is ~4× the old a²/(1-a)/(4π) floor at ocean albedos (~0.2), which read as a',
      '//barely-there tint — R∞ is what makes the water a real teal volume. View-',
      '//independent, so the horizon fades to that teal instead of black.',
      'vec3 totalDownwelling = directDownwelling + ambientDownwelling;',
      'vec3 sqrtOneMinusA = sqrt(max(vec3(1.0) - albedo, vec3(0.0)));',
      'vec3 rInf = (vec3(1.0) - sqrtOneMinusA) / (vec3(1.0) + sqrtOneMinusA);',
      'vec3 multiScatter = rInf * totalDownwelling * (1.0 / UW_PI);',
      '//Camera-depth darkening. Inscatter along any view ray is front-loaded near',
      '//the eye — each scattering point is weighted by exp(-ext·distanceFromCamera) —',
      "//so the equilibrium the fog fades to is the medium's radiance at the CAMERA's",
      '//depth, the same "colour of the water" in every direction. Using this here',
      '//(instead of each caller darkening by its own fragment/surface depth) is what',
      '//makes the ceiling, curtain, seabed veil and abyss all converge to one teal',
      '//rather than diverging (bright ceiling band vs black curtain). Above water',
      '//camDepth clamps to 0 — the ray enters at the surface — so the body-colour',
      '//blend keeps its surface-level inscatter unchanged.',
      'float camDepth = max(0.0, waterSurfaceY - cameraPosition.y);',
      'vec3 camDepthDarken = exp(-(waterAbsorption + waterScattering) * camDepth);',
      'return (singleScatter + multiScatter) * camDepthDarken;',
    '}',

    '//Apply underwater volumetric fog along a path through water. `color` is the',
    '//radiance of the fragment being fogged (post-shading, pre-tonemap). `dist`',
    '//is the straight path length through water for this fog segment.',
    '//`viewDirWorld` is the world-space camera→fragment direction; drives HG',
    '//forward-scatter — looking toward the sun lights the murk brighter than',
    '//looking away. This is the volumetric counterpart to the body-colour blend,',
    '//and shares the same `underwaterInscatterSurface()` source — which already',
    '//camera-depth-darkens the equilibrium — so all three paths agree on the',
    "//medium's equilibrium colour.",
    'vec3 applyUnderwaterFog(vec3 color, float dist, vec3 viewDirWorld){',
      'vec3 extinction = waterAbsorption + waterScattering;',
      'vec3 transmittance = exp(-extinction * dist);',
      '//The equilibrium is camera-depth-darkened inside underwaterInscatterSurface',
      '//(inscatter is front-loaded near the eye), so there is no per-fragment depth',
      '//term here — every long ray fades to the same camera-depth water colour.',
      'vec3 inscatter = underwaterInscatterSurface(viewDirWorld);',
      '//UW_DEBUG_FOG_MODE isolation taps (see const above), matched to the fog chunk.',
      'if(UW_DEBUG_FOG_MODE == 1){ return color; }                                          //raw input, no fog',
      'if(UW_DEBUG_FOG_MODE == 2){ return vec3(0.5) * transmittance + inscatter * (vec3(1.0) - transmittance); } //constant input',
      'if(UW_DEBUG_FOG_MODE == 3){ return inscatter; }                                      //murk only',
      'return color * transmittance + inscatter * (vec3(1.0) - transmittance);',
    '}',

    '//Fresnel reflectance for a ray INSIDE the water striking the underside of the',
    '//surface (water n≈1.333 → air n=1.0). Unlike the air→water case this has a',
    '//critical angle (~48.6°): once the incidence angle exceeds it the ray is',
    '//totally internally reflected and reflectance is 1.0 — the underside becomes',
    '//a perfect mirror. cosI is the cosine of the incidence angle at the interface.',
    'float fresnelWaterToAir(float cosI){',
      'cosI = clamp(cosI, 0.0, 1.0);',
      'float etaWA = 1.333;                          //n_water / n_air',
      'float sinT2 = etaWA * etaWA * (1.0 - cosI * cosI);',

      '//Strict physical reflectance where the ray still transmits.',
      'float physical;',
      'if(sinT2 >= 1.0){',
        'physical = 1.0;                             //total internal reflection',
      '} else {',
        'float cosT = sqrt(1.0 - sinT2);',
        'float rs = (etaWA * cosI - cosT) / (etaWA * cosI + cosT);',
        'float rp = (etaWA * cosT - cosI) / (etaWA * cosT + cosI);',
        'physical = clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);',
      '}',

      '//Artistic softening (deliberate fudge — see UNDERWATER_TIR_SOFTNESS). The',
      '//physical curve still reaches 1.0 exactly at the true critical angle, but a',
      '//smoothstep ramp climbs to 1.0 starting UNDERWATER_TIR_SOFTNESS earlier in',
      '//cos(incidence). max() keeps the window interior at its low physical',
      '//reflectance and only widens the otherwise-abrupt edge ring.',
      'float cosCrit = sqrt(max(0.0, 1.0 - 1.0 / (etaWA * etaWA)));',
      'float softEdge = smoothstep(cosCrit + UNDERWATER_TIR_SOFTNESS, cosCrit, cosI);',
      'return max(physical, softEdge);',
    '}',

    '//Smith masking-shadowing function for a Beckmann microfacet distribution.',
    '//Rational-fit Lambda approximation: cheap, accurate to ~1%, branch-friendly.',
    '//Ported verbatim from the Water sibling (Acerola FFTWater.shader) which in',
    '//turn cites Walter et al. 2007 ("Microfacet Models for Refraction"). Result',
    '//is the Lambda(omega) term that combines as G = 1/(1 + Lambda_v + Lambda_l).',
    'float smithMaskingBeckmann(vec3 H, vec3 S, float roughness){',
      'float hdots = max(0.001, dot(H, S));',
      'float a = hdots / (roughness * sqrt(1.0 - hdots * hdots));',
      'float a2 = a * a;',
      'return a < 1.6 ? (1.0 - 1.259 * a + 0.396 * a2) / (3.535 * a + 2.181 * a2) : 0.0;',
    '}',

    '#if($caustics_enabled)',
      'float causticShader(vec2 uv, float t){',
        '//Animation speed: t/8 — gentle ocean shimmer rather than rapids. Original',
        '//was t/20 (glacial); t/4 read as frantic. Two scrolling UVs with non-',
        '//parallel velocities create the interlock look.',
        'float tModified = (t / 8.0);',
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
      '//Foam amount is now pre-computed in the FFT normal map alpha channel',
    '#endif',

    '#if($atmospheric_perspective_enabled)',
      '//Compute sky radiance in a given world-space direction using the same atmosphere LUTs',
      "//as applyAtmosphericPerspective. This matches a-starry-sky's own sky rendering, so",
      '//reflection colors are continuous with the visible sky at any view direction.',
      '//Returns LINEAR radiance (same convention as the rest of the SSR path).',
      'vec3 computeSkyRadiance(vec3 worldDir){',
        '//Convert from THREE.js world coords to a-starry-sky coords (same transform as applyAtmosphericPerspective)',
        'vec3 skyDir = vec3(-worldDir.z, worldDir.y, -worldDir.x);',

        '//Clamp to horizon so reflection rays pointing slightly below horizon (off wave faces',
        '//tilted toward the viewer) snap to horizon color rather than sampling invalid LUT coords.',
        'float viewCosZenith = max(skyDir.y, 0.0);',
        'float xParam = parameterizationOfCosOfViewZenithToX(viewCosZenith);',
        'float yHeight = parameterizationOfHeightToY(RADIUS_OF_EARTH + atmCameraHeight);',

        '//Sun inscatter',
        'float zSun = parameterizationOfCosOfSourceZenithToZ(max(atmSunPosition.y, 0.0));',
        'vec3 uv3Sun = vec3(xParam, yHeight, zSun);',
        'vec3 mieSun = texture(atmosphereMieInscattering, uv3Sun).rgb;',
        'vec3 raySun = texture(atmosphereRayleighInscattering, uv3Sun).rgb;',
        'float cosViewSun = dot(skyDir, atmSunPosition);',
        'vec3 skySun = pow(atmSunHorizonFade, 3.0) * atmScatteringSunIntensity',
                    '* (miePhaseFunction(cosViewSun) * mieSun + rayleighPhaseFunction(cosViewSun) * raySun);',

        '//Moon inscatter',
        'float zMoon = parameterizationOfCosOfSourceZenithToZ(max(atmMoonPosition.y, 0.0));',
        'vec3 uv3Moon = vec3(xParam, yHeight, zMoon);',
        'vec3 mieMoon = texture(atmosphereMieInscattering, uv3Moon).rgb;',
        'vec3 rayMoon = texture(atmosphereRayleighInscattering, uv3Moon).rgb;',
        'float cosViewMoon = dot(skyDir, atmMoonPosition);',
        'vec3 skyMoon = pow(atmMoonHorizonFade, 3.0) * atmScatteringMoonIntensity * atmMoonLightColor',
                     '* (miePhaseFunction(cosViewMoon) * mieMoon + rayleighPhaseFunction(cosViewMoon) * rayMoon);',

        "//Base sky ambient — matches a-starry-sky's own atmosphere pass main() (not linearAtmosphericPass).",
        '//Small bluish floor that fades with altitude/horizon via the 2D transmittance LUT.',
        'vec3 transmittanceFade = texture(atmosphereTransmittance, vec2(xParam, yHeight)).rgb;',
        'vec3 baseSkyLighting = 0.25 * vec3(2E-3, 3.5E-3, 9E-3) * transmittanceFade;',

        'return skySun + skyMoon + baseSkyLighting;',
      '}',

      '//Atmospheric perspective for ground-level surfaces.',
      '//Uses distance-based extinction with LUT-sampled multi-scattered inscattering.',
      '//At the same height: S(A->B) = S(A->inf) * (1 - T(A->B))',
      'vec3 applyAtmosphericPerspective(vec3 color, vec3 worldPos){',
        'vec3 worldViewDir = normalize(worldPos - cameraPosition);',
        "//Convert view direction from THREE.js world space to a-starry-sky's coordinate",
        '//system. Sun world direction = (-sp.z, sp.y, -sp.x) from quadOffset, so the',
        '//inverse transform from world to sky coords is: skyDir = (-world.z, world.y, -world.x)',
        'vec3 viewDir = vec3(-worldViewDir.z, worldViewDir.y, -worldViewDir.x);',
        'float dist = length(worldPos - cameraPosition) * METERS_TO_KM * atmDistanceScale;',

        '//Distance-based extinction along the camera-to-surface path',
        'vec3 extinction = exp(-(RAYLEIGH_BETA + EARTH_MIE_BETA_EXTINCTION) * dist);',

        '//Attenuate surface color',
        'color *= extinction;',

        '//LUT coordinates for inscattering lookup',
        'float viewCosZenith = max(viewDir.y, 0.0);',
        'float xParam = parameterizationOfCosOfViewZenithToX(viewCosZenith);',
        'float yHeight = parameterizationOfHeightToY(RADIUS_OF_EARTH + atmCameraHeight);',

        '//Sun inscattering from 3D LUTs',
        'float zSun = parameterizationOfCosOfSourceZenithToZ(max(atmSunPosition.y, 0.0));',
        'vec3 uv3Sun = vec3(xParam, yHeight, zSun);',
        'vec3 mieSun = texture(atmosphereMieInscattering, uv3Sun).rgb;',
        'vec3 raySun = texture(atmosphereRayleighInscattering, uv3Sun).rgb;',
        'float cosViewSun = dot(viewDir, atmSunPosition);',
        'vec3 fogSun = pow(atmSunHorizonFade, 3.0) * atmScatteringSunIntensity',
                    '* (miePhaseFunction(cosViewSun) * mieSun + rayleighPhaseFunction(cosViewSun) * raySun)',
                    '* (1.0 - extinction);',

        '//Moon inscattering from 3D LUTs',
        'float zMoon = parameterizationOfCosOfSourceZenithToZ(max(atmMoonPosition.y, 0.0));',
        'vec3 uv3Moon = vec3(xParam, yHeight, zMoon);',
        'vec3 mieMoon = texture(atmosphereMieInscattering, uv3Moon).rgb;',
        'vec3 rayMoon = texture(atmosphereRayleighInscattering, uv3Moon).rgb;',
        'float cosViewMoon = dot(viewDir, atmMoonPosition);',
        'vec3 fogMoon = pow(atmMoonHorizonFade, 3.0) * atmScatteringMoonIntensity * atmMoonLightColor',
                     '* (miePhaseFunction(cosViewMoon) * mieMoon + rayleighPhaseFunction(cosViewMoon) * rayMoon)',
                     '* (1.0 - extinction);',

        'return color + fogSun + fogMoon;',
      '}',

      '//Appearance of the water surface seen from below — the "ceiling". The view',
      '//ray travels up through the water column and strikes the underside of the',
      '//surface; the water→air Fresnel term splits it between:',
      '//  - reflection  — total internal reflection past the ~48.6° critical angle',
      '//                  (and partial before it): the underside mirrors the',
      '//                  underwater scene via the planar reflection pass.',
      '//  - transmission— the ray refracts out into the air. refract() bends it',
      '//                  away from the normal, so as the incidence sweeps',
      '//                  0°→48.6° the air-side ray sweeps 0°→90° — the whole 180°',
      '//                  above-water hemisphere folds into the ~97° Snell-window',
      '//                  cone (zenith straight up, horizon at the cone edge).',
      '//Foam sits on top, then the camera→ceiling water column is fogged.',
      'vec3 computeUnderwaterCeiling(vec3 worldPos, vec3 surfaceNormal, vec3 foamColor,',
                                    'float foamBlend, vec2 screenUV,',
                                    'float camToFragDist){',
        '//Underside normal faces down toward the submerged camera.',
        'vec3 n = -normalize(surfaceNormal);',
        'vec3 viewDir = normalize(worldPos - cameraPosition);   //camera → ceiling (up)',
        'float cosI = max(dot(-viewDir, n), 0.0);               //incidence at the interface',

        'float reflectance = fresnelWaterToAir(cosI);',

        '//TRANSMISSION — true Snell refraction water→air (n_water=1.333 → n_air=1.0).',
        '//refract() with the per-fragment wave normal does double duty: cone',
        '//compression (whole 180° air hemisphere folds into the ~97° Snell cone,',
        '//half-angle 48.6°) AND ripple-glass jitter, in one step. The refracted',
        "//direction is then projected via the transmission camera's matrices",
        '//(= main scene camera) onto its screen UV to sample the air-side capture.',
        '//Convention: n points DOWN (toward submerged camera = INTO water from',
        '//air side), viewDir points UP (camera→ceiling = INTO the surface from',
        '//water side). refract(I, N, eta) with eta = n_in / n_out = 1.333 then',
        '//returns the air-side ray bending away from the normal.',
        'vec3 refracted = refract(viewDir, n, 1.333);',
        'vec2 refrUV;',
        'if(dot(refracted, refracted) < 0.0001){',
          '//TIR — refract() returned zero. Reflectance is 1.0 here so the mix',
          '//below is pure reflection; the transmitted sample is invisible. Sane',
          '//fallback for edge-precision pixels just below critical.',
          'refrUV = screenUV;',
        '} else {',
          '//Project a far point along the refracted ray onto the transmission',
          "//camera's screen. 1km is past the curtain hemisphere; for any",
          '//refracted direction with a forward component (clip.w > 0) the',
          '//screen UV samples the right pixel of the air-world capture. Behind-',
          '//camera tangents fall back to the non-refracted UV.',
          'vec3 virtualPoint = worldPos + refracted * 1000.0;',
          '//ssrViewMatrix/ssrProjectionMatrix mirror the scene camera matrices —',
          '//projectionMatrix/viewMatrix are auto-declared only in vertex shaders,',
          '//but these uniforms (already used by the SSR path) carry the same data',
          '//into the fragment shader.',
          'vec4 clip = ssrProjectionMatrix * ssrViewMatrix * vec4(virtualPoint, 1.0);',
          'if(clip.w > 0.001){',
            'refrUV = (clip.xy / clip.w) * 0.5 + 0.5;',
          '} else {',
            'refrUV = screenUV;',
          '}',
        '}',
        'refrUV = clamp(refrUV, vec2(0.001), vec2(0.999));',
        'vec3 transmitted = texture2D(aboveWaterTransmissionTexture, refrUV).rgb;',

        '//REFLECTION (total internal reflection — Fresnel reflectance climbs to',
        '//1.0 past the critical angle). Planar mirror: underwater scene rendered',
        '//from a camera mirrored across the rest water plane (ocean-grid.js',
        '//_renderUnderwaterReflection). Wave-normal offset ripples the flat-plane',
        '//mirror with the FFT surface.',
        'vec4 reflProj = underwaterReflectionMatrix * vec4(worldPos, 1.0);',
        'vec2 reflUV = reflProj.xy / max(reflProj.w, 0.0001);',
        'reflUV += n.xz * UNDERWATER_REFLECTION_DISTORTION;',
        'vec3 reflected = texture2D(underwaterReflectionTexture,',
                                   'clamp(reflUV, vec2(0.001), vec2(0.999))).rgb;',

        'vec3 ceiling = mix(transmitted, reflected, reflectance);',
        '//Foam is a near-opaque scattering layer — bright mottling on the ceiling.',
        '//(foamBlend arrives as 0 while submerged because the foam system is gated off',
        '//below water — see the underwaterFactor guards on the foam blocks — so this',
        '//is a no-op underwater, which is the only time this ceiling path runs anyway.)',
        'ceiling = mix(ceiling, foamColor, foamBlend);',
        '//Two-stage fog compose for the reflected bounce path:',
        '//  Stage 1 — chunk on the reflection RT fogs the post-bounce leg',
        '//            (surface→reflected-fragment) into `reflected` already.',
        '//  Stage 2 — applyUnderwaterFog here fogs the pre-bounce leg',
        '//            (cam→ceiling-fragment, all underwater).',
        '//Total = pre + post = full underwater bounce path. Without this stage',
        '//the equator of the reflected curtain reads too bright because the',
        "//chunk's (1-t)·totalLen mirror-branch only counts the post-bounce half,",
        '//and the gradient between deep-dark and shallow-bright pixels flattens.',
        '//The Snell-window `transmitted` content is above-water (chunk skipped',
        '//it) so this is its only underwater fog — also correct.',
        'vec3 viewDirCeiling = normalize(worldPos - cameraPosition);',
        '',
        'return applyUnderwaterFog(ceiling, camToFragDist * UW_DIST_SCALE, viewDirCeiling);',
      '}',
    '#endif',

    'void main(){',
      '//Shadow factor — once per fragment. 1.0 = fully lit, 0.0 = fully shadowed.',
      '//sunShadowFactor is computed LATER, after macroNormal is available — the',
      '//ocean CSM uses a normal-based slope bias to avoid the per-triangle',
      '//faceting that dFdx/dFdy produces.',

      '//Use the displaced position from the vertex shader directly — ensures worldPosition',
      '//matches the actual geometry (vertex shader applies displacementFade; resampling here',
      '//would skip that, causing LOD tile edge divergence).',
      'vec3 offsetPosition = vDisplacedPosition;',
      'vec4 worldPosition = vModelMatrix * vInstanceMatrix * vec4(offsetPosition, 1.0);',
      "//Exclusion sample. Half-width here MUST match exclusionCamera's ortho",
      '//half-width in ocean-grid.js (currently 250 m). The exclusion target',
      '//covers only the small layer-30 mask volumes near the camera (boat',
      "//interior hulls etc.), not the broad terrain — that's foamRenderMap.",
      'vec2 exclusionPosition = 0.5 * (((worldPosition.xz - exclusionCameraXZ) / vec2(250.0)) + 1.0);',
      'exclusionPosition = vec2(exclusionPosition.x, 1.0 - exclusionPosition.y);',
      '//Exclusion-map discard. The exclusion render captures layer-30 meshes',
      '//(boat hulls, etc.) from above — discardHeight is the topmost layer-30',
      '//Y at this XZ, and we discard water fragments above that height so the',
      "//water surface doesn't poke through a boat's interior. Only fires above",
      '//water: when the camera is submerged the same discard would kill the',
      '//ceiling fragments above the camera (no boat present to hide), so we',
      '//gate it on `underwaterFactor < 0.5`.',
      'if(underwaterFactor < 0.5 &&',
         'exclusionPosition.x < 1.0 && exclusionPosition.x > 0.0 &&',
         'exclusionPosition.y < 1.0 && exclusionPosition.y > 0.0){',
        'vec2 discardHeightData = texture2D(exclusionMap, exclusionPosition).ga;',
        'float discardHeight = discardHeightData.x;',
        'if((discardHeightData.y > 0.5) && worldPosition.y > discardHeight){',
          'discard;',
        '}',
      '}',
      'float distanceToWorldPosition = distance(worldPosition.xyz, cameraPosition.xyz);',

      '//Per-cascade slope sampling. The fade-by-distance built into each cascade',
      '//branch below (`clamp(1 - dist/(cascadePatchSizes[c]*10), 0, 1)`) is the',
      '//sole distance attenuation — short-wavelength cascades die at their',
      '//physical ranges (C5 by 10m, C4 by 40m, C3 by 160m, etc.). The previous',
      '//outer `normalDetailFade = mix(0.15, 1.0, ...)` keyed off sizeOfOceanPatch',
      '//was a relic of the old 256m default patch_size; at the current 8m it',
      '//flattened every wave normal past ~56m. Removed — atmospheric perspective',
      '//handles long-range haze; per-cascade fades handle distance attenuation.',

      '//Central differences on displacement for Jacobian and normals — cascades 0-1 only.',
      '//Computes full 3D displacement derivatives (not just XZ) so the surface normal',
      '//can be computed from the cross product of displaced tangent vectors (Crest-style).',
      '//Using finite differences for ALL components ensures height and chop derivatives',
      '//are consistent — mixing analytical FFT slopes with finite-difference chop derivatives',
      '//creates a precision mismatch that produces incorrect normals.',
      'vec3 rawDdx = vec3(0.0);',
      'vec3 rawDdz = vec3(0.0);',
      '//Toksvig accumulator: per-cascade slope variance that the distance fades are',
      "//throwing away at this fragment. Each cascade's `1 - fade` is the fraction",
      "//of its geometric chop we've shed; (slope·(1-fade))² estimates the",
      '//statistical micro-roughness that USED to live in that wavelet but no',
      '//longer survives as displacement. We feed the sum into a shininess',
      '//attenuation at the specular lobe so the Phong lobe widens to cover the',
      '//missing facets — distance ocean stays "shiny + rough" instead of',
      '//collapsing to "shiny + mirror-flat" when all the small cascades are gone.',
      'float lostSlopeVar = 0.0;',
      '//Cascade 0 height slope saved separately for macro normal (specular)',
      'vec2 cascade0HeightSlope;',
      '//Cascade 5 height-slope contribution to rawDdx/rawDdz saved separately so',
      '//the spec-normal block can subtract its 1-texel-eps version and add back a',
      '//wide-eps low-pass version (option 2 — sub-pixel sampling correlation for',
      '//the Beckmann lobe without disturbing displacedNormal).',
      'vec2 c5NativeHeightSlope = vec2(0.0);',
      '{',
        'float eps = 1.0 / patchDataSize;',
        'float worldStep = cascadePatchSizes[0] / patchDataSize;',
        'vec2 uv = (vWorldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0];',
        'vec3 rawL = texture2D(cascadeDisplacementTextures[0], uv + vec2(-eps,  0.0)).xyz;',
        'vec3 rawR = texture2D(cascadeDisplacementTextures[0], uv + vec2( eps,  0.0)).xyz;',
        'vec3 rawB = texture2D(cascadeDisplacementTextures[0], uv + vec2( 0.0, -eps)).xyz;',
        'vec3 rawT = texture2D(cascadeDisplacementTextures[0], uv + vec2( 0.0,  eps)).xyz;',
        'rawDdx += (rawR - rawL) / (2.0 * worldStep);',
        'rawDdz += (rawT - rawB) / (2.0 * worldStep);',
        'cascade0HeightSlope = vec2(rawDdx.y, rawDdz.y);',
      '}',
      '{',
        'float eps = 1.0 / patchDataSize;',
        'float worldStep = cascadePatchSizes[1] / patchDataSize;',
        'vec2 uv = (vWorldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1];',
        'vec3 rawL = texture2D(cascadeDisplacementTextures[1], uv + vec2(-eps,  0.0)).xyz;',
        'vec3 rawR = texture2D(cascadeDisplacementTextures[1], uv + vec2( eps,  0.0)).xyz;',
        'vec3 rawB = texture2D(cascadeDisplacementTextures[1], uv + vec2( 0.0, -eps)).xyz;',
        'vec3 rawT = texture2D(cascadeDisplacementTextures[1], uv + vec2( 0.0,  eps)).xyz;',
        'rawDdx += (rawR - rawL) / (2.0 * worldStep);',
        'rawDdz += (rawT - rawB) / (2.0 * worldStep);',
      '}',
      '//Cascades 2..5: per-cascade smoothstep distance fade. Wide ranges',
      '//(C2 ×50, C3 ×100, C4 ×250, C5 ×500) keep small-wavelength chop alive',
      '//out to multi-km — relies on mipmaps in the composer RTs to avoid',
      '//sub-pixel aliasing at the far end. `smoothstep` instead of linear',
      "//`clamp` softens the fade-out tail so the cascade's vanishing point",
      "//doesn't read as a circular ring on the surface. Keep in lockstep with",
      '//water-vertex.glsl.',
      '{',
        'float eps = 1.0 / patchDataSize;',
        'float worldStep = cascadePatchSizes[2] / patchDataSize;',
        'float fade = smoothstep(cascadePatchSizes[2] * 50.0, 0.0, distanceToWorldPosition);',
        'vec2 uv = (vWorldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2];',
        'vec3 rawL = texture2D(cascadeDisplacementTextures[2], uv + vec2(-eps,  0.0)).xyz;',
        'vec3 rawR = texture2D(cascadeDisplacementTextures[2], uv + vec2( eps,  0.0)).xyz;',
        'vec3 rawB = texture2D(cascadeDisplacementTextures[2], uv + vec2( 0.0, -eps)).xyz;',
        'vec3 rawT = texture2D(cascadeDisplacementTextures[2], uv + vec2( 0.0,  eps)).xyz;',
        'vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);',
        'vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);',
        'rawDdx += fade * cDdx;',
        'rawDdz += fade * cDdz;',
        'float oneMinusFade = 1.0 - fade;',
        'lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);',
      '}',
      '{',
        'float eps = 1.0 / patchDataSize;',
        'float worldStep = cascadePatchSizes[3] / patchDataSize;',
        'float fade = smoothstep(cascadePatchSizes[3] * 100.0, 0.0, distanceToWorldPosition);',
        'vec2 uv = (vWorldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3];',
        'vec3 rawL = texture2D(cascadeDisplacementTextures[3], uv + vec2(-eps,  0.0)).xyz;',
        'vec3 rawR = texture2D(cascadeDisplacementTextures[3], uv + vec2( eps,  0.0)).xyz;',
        'vec3 rawB = texture2D(cascadeDisplacementTextures[3], uv + vec2( 0.0, -eps)).xyz;',
        'vec3 rawT = texture2D(cascadeDisplacementTextures[3], uv + vec2( 0.0,  eps)).xyz;',
        'vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);',
        'vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);',
        'rawDdx += fade * cDdx;',
        'rawDdz += fade * cDdz;',
        'float oneMinusFade = 1.0 - fade;',
        'lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);',
      '}',
      '{',
        'float eps = 1.0 / patchDataSize;',
        'float worldStep = cascadePatchSizes[4] / patchDataSize;',
        'float fade = smoothstep(cascadePatchSizes[4] * 250.0, 0.0, distanceToWorldPosition);',
        'vec2 uv = (vWorldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4];',
        'vec3 rawL = texture2D(cascadeDisplacementTextures[4], uv + vec2(-eps,  0.0)).xyz;',
        'vec3 rawR = texture2D(cascadeDisplacementTextures[4], uv + vec2( eps,  0.0)).xyz;',
        'vec3 rawB = texture2D(cascadeDisplacementTextures[4], uv + vec2( 0.0, -eps)).xyz;',
        'vec3 rawT = texture2D(cascadeDisplacementTextures[4], uv + vec2( 0.0,  eps)).xyz;',
        'vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);',
        'vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);',
        'rawDdx += fade * cDdx;',
        'rawDdz += fade * cDdz;',
        'float oneMinusFade = 1.0 - fade;',
        'lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);',
      '}',
      '{',
        'float eps = 1.0 / patchDataSize;',
        'float worldStep = cascadePatchSizes[5] / patchDataSize;',
        'float fade = smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToWorldPosition);',
        'vec2 uv = (vWorldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5];',
        'vec3 rawL = texture2D(cascadeDisplacementTextures[5], uv + vec2(-eps,  0.0)).xyz;',
        'vec3 rawR = texture2D(cascadeDisplacementTextures[5], uv + vec2( eps,  0.0)).xyz;',
        'vec3 rawB = texture2D(cascadeDisplacementTextures[5], uv + vec2( 0.0, -eps)).xyz;',
        'vec3 rawT = texture2D(cascadeDisplacementTextures[5], uv + vec2( 0.0,  eps)).xyz;',
        'vec3 cDdx = (rawR - rawL) / (2.0 * worldStep);',
        'vec3 cDdz = (rawT - rawB) / (2.0 * worldStep);',
        'rawDdx += fade * cDdx;',
        'rawDdz += fade * cDdz;',
        "//Save cascade 5's height-slope contribution (with the same fade, pre",
        '//waveHeightMultiplier) so specNormal can swap it for a low-pass version.',
        'c5NativeHeightSlope = vec2(fade * cDdx.y, fade * cDdz.y);',
        'float oneMinusFade = 1.0 - fade;',
        'lostSlopeVar += oneMinusFade * oneMinusFade * (cDdx.y * cDdx.y + cDdz.y * cDdz.y);',
      '}',
      'rawDdx *= waveHeightMultiplier;',
      'rawDdz *= waveHeightMultiplier;',
      'c5NativeHeightSlope *= waveHeightMultiplier;',
      'lostSlopeVar *= waveHeightMultiplier * waveHeightMultiplier;',

      '//Jacobian: detect surface folds — still used for inscatter modulation and normal blending',
      'vec2 foamDdx = -chop * rawDdx.xz;',
      'vec2 foamDdz = -chop * rawDdz.xz;',
      'float jacobian = (1.0 + foamDdx.x) * (1.0 + foamDdz.y) - foamDdx.y * foamDdz.x;',
      'float turbulence = max(0.0, 1.0 - jacobian);',

      '//── Foam from the per-fragment combined fold (RESTORED 2026-05-31) ────────',
      '//Validated path (the bingo state): foam = the summed fold of ALL six cascades',
      '//at the real displaced surface (`turbulence` ~line 1212, full per-fragment',
      '//resolution), thresholded so only steep / near-breaking water fires. It tracks',
      '//every visible crest because the crest IS the constructive sum of all cascades,',
      '//which is exactly what `turbulence` measures.',
      '//',
      '//DO NOT route this back through the world-locked broadband foam RT: that pass',
      '//can only sample a SUBSET of cascades (a 64-256 m tile cannot represent the',
      '//256-4096 m swell bands), so its fold decorrelates from the all-cascade crest',
      '//and foam scatters into random splotches that miss the real crests. Persistence',
      '//(the trailing wake) and live longevity need a CAMERA-following foam history',
      '//buffer, not the world tile RT — see the broadband-foam memory for the plan.',
      '//FOAM_TURB_THRESHOLD: lower = more foam (gentler folds fire). GAIN: ramp speed.',
      'const float FOAM_TURB_THRESHOLD = 0.5;',
      'const float FOAM_TURB_GAIN      = 4.0;',
      '//foamWindBias is the wind-driven Jacobian dip: it lifts the fold signal as the',
      '//sea roughens so gentler folds cross the threshold, and once it exceeds',
      '//THRESHOLD the flat open surface itself foams (storm streaks). 0 in calm seas,',
      '//so the validated calm-water behaviour above is unchanged.',
      'float fftFoamAmount = clamp((turbulence + foamWindBias - FOAM_TURB_THRESHOLD) * FOAM_TURB_GAIN, 0.0, 1.0);',

      '//Crest-style surface normal from cross product of displaced tangent vectors.',
      '//Surface parameterization: P(u,v) = (u - chop*Dx, Dy, v - chop*Dz)',
      '//Tangent vectors include the full Jacobian of the displacement mapping:',
      '//  Tx = dP/du = (1 - chop*dDx/du, dDy/du, -chop*dDz/du)',
      '//  Tz = dP/dv = (-chop*dDx/dv, dDy/dv, 1 - chop*dDz/dv)',
      '//All derivatives come from the same finite-difference samples for consistency.',
      'vec2 totalSlope = vec2(rawDdx.y, rawDdz.y);',
      'vec3 Tx = vec3(1.0 + foamDdx.x, totalSlope.x, foamDdx.y);',
      'vec3 Tz = vec3(foamDdz.x, totalSlope.y, 1.0 + foamDdz.y);',
      'vec3 displacedNormal = normalize(cross(Tz, Tx));',
      '//Cross product Y component equals the Jacobian determinant — positive when surface is',
      '//well-behaved, negative at folds. Force upward to avoid lighting inversion (Crest does',
      '//the same: crossProd.y = max(crossProd.y, 0.0001)).',
      'if(displacedNormal.y < 0.0) displacedNormal = -displacedNormal;',
      '//Blend toward flat normal at fold points and at distance',
      'float foldBlend = smoothstep(0.0, 0.3, jacobian);',
      'displacedNormal = normalize(mix(vec3(0.0, 1.0, 0.0), displacedNormal, foldBlend));',
      'if(displacedNormal.y < 0.0) displacedNormal = -displacedNormal;',

      '//Macro-scale normal from cascade 0 only — used for GGX specular orientation.',
      '//Using cascade 0+1 normals for NdotH creates a "sand-ripple" pattern when the moon',
      '//is perpendicular to the view: each 1-4m wave face creates its own sharp specular',
      '//hotspot. Cascade 0 only gives a wide, smooth specular lobe (Sea of Thieves style).',
      '//Fresnel still uses displacedNormal (cascade 0+1) so it correctly matches the geometry.',
      'vec2 macroSlope = cascade0HeightSlope * waveHeightMultiplier;',
      'float macroSlopeLen = length(macroSlope);',
      'if(macroSlopeLen > MACRO_SLOPE_MAX) macroSlope *= MACRO_SLOPE_MAX / macroSlopeLen;',
      'vec3 macroNormal = normalize(vec3(-macroSlope.x, 1.0, -macroSlope.y));',
      'if(macroNormal.y < 0.0) macroNormal = -macroNormal;',
      'macroNormal = normalize(mix(vec3(0.0, 1.0, 0.0), macroNormal, foldBlend));',
      'if(macroNormal.y < 0.0) macroNormal = -macroNormal;',

      '//Shadow factor: scene-wide map (env casters) × ocean CSM (wave self-shadow).',
      '//Multiplied into every sun-driven term below (SSS, diffuse, specular, foam),',
      '//but NOT into sky ambient / reflection / refraction. Either being 0 forces',
      '//full shadow; both 1 means fully lit. macroNormal is the smooth wave normal',
      "//(cascade 0 only), used by the ocean shadow's normal-based slope bias.",
      'vec3 sunDirToSky = -brightestDirectionalLightDirection;',
      'float oceanShadowRaw = getOceanShadow(vOceanShadowCoord0, vOceanShadowCoord1, vOceanShadowCoord2, vOceanShadowCoord3, macroNormal, sunDirToSky);',
      '//Fade ocean self-shadow as the sun approaches zenith. EVSM on a tessellated',
      '//wave mesh produces visible triangle-silhouette artifacts at high sun angles',
      '//because the cascade depth slab is huge relative to the actual wave-height',
      '//variation, so per-triangle plane discontinuities dominate the moment',
      '//variance. Physically waves cast almost no shadow at noon (shadow length =',
      '//tan(zenith) * height → 0), so weighting the term out at exactly the angles',
      '//where it breaks is also the physically correct behavior. Fade kicks in',
      '//around 53° from zenith and is fully gone by ~32°.',
      'float sunZenithFactor = -brightestDirectionalLightDirection.y;',
      'float oceanShadowZenithFade = 1.0 - smoothstep(0.4, 0.85, sunZenithFactor);',
      'oceanShadowRaw = mix(1.0, oceanShadowRaw, oceanShadowZenithFade);',
      'float oceanShadowBoosted = clamp(1.0 - OCEAN_SHADOW_DEBUG_DARKNESS_BOOST * (1.0 - oceanShadowRaw), 0.0, 1.0);',
      'float sunShadowFactor = getSunShadow(vSunShadowCoord) * oceanShadowBoosted;',

      '//Foam textures use a fixed meter-scale tile (~2 m / ~3 m perpendicular pair) so',
      '//individual bubble structure in the source photo reads at human scale.',
      '//Scroll direction is foamScrollVelocity (random wind-derived in ocean-grid.js).',
      'vec2 foamTextureUV  = (worldPosition.xz + t * foamScrollVelocity) / 2.0;',
      'vec2 foamTextureUV2 = (vec2(-worldPosition.z, worldPosition.x) + t * foamScrollVelocity) / 3.0;',

      '#if($foam_enabled)',
        '//Foam is a top-surface effect, so the WHOLE foam system is gated off when the',
        '//camera is submerged. This is a uniform branch on underwaterFactor (same value',
        '//for every fragment), so the foam-map fetch + shore boost here AND the foam',
        '//texture sampling + Lambert lighting further down drop out wholesale for the',
        '//underwater pass — freeing budget for spray/mist. Above water: unchanged.',
        'float foamAmount = 0.0;',
        'if(underwaterFactor < 0.5){',
        '//fftFoamAmount is now the broadband foam RT sample — it already includes',
        '//Crest-style accumulation + wind advection + dt-scaled decay, so no live',
        '//turbulence boost is needed. The shore branch still adds its turbulence-',
        '//driven boost on top for the breaker-line near terrain.',
        'foamAmount = fftFoamAmount;',
        'vec2 foamPosition = 0.5 * (((worldPosition.xz - foamCameraXZ) / vec2(2048.0)) + 1.0);',
        'foamPosition = vec2(foamPosition.x, 1.0 - foamPosition.y);',
        'if(foamPosition.x < 1.0 && foamPosition.x > 0.0 && foamPosition.y < 1.0 && foamPosition.y > 0.0){',
          'vec2 foamHeightData = texture2D(foamRenderMap, foamPosition).ga;',
          'if((foamHeightData.y > 0.5)){',
            '//Shore-zone foam: gated by wave action, not a static shallow-water belt.',
            '//shoreProximity is 1 right at terrain (water within ~0.5m above the',
            '//terrain top) and falls off quadratically to 0 over the next 3.5m, so',
            '//the breaker line is bright and dissipates with a soft tail past it.',
            '//',
            '//  shoreProximity vs waterAboveTerrain:',
            '//    0.5m → 1.00   1m → 0.73   2m → 0.33   3m → 0.08   4m → 0',
            '//',
            '//Quadratic ease-out feels more like real foam than the previous',
            '//symmetric smoothstep, which had a slow start and abrupt end.',
            '//',
            '//The boost itself is driven by turbulence (jacobian fold = wave is',
            '//breaking RIGHT NOW) plus a softer term in the persistent fftFoamAmount',
            '//accumulator (wave already broke and is decaying). Net effect: foam',
            '//forms when a wave hits shore and fades as that same wave passes.',
            'float waterAboveTerrain = worldPosition.y - foamHeightData.x;',
            'float shoreFade = clamp((waterAboveTerrain - 0.5) / 3.5, 0.0, 1.0);',
            'float shoreProximity = (1.0 - shoreFade) * (1.0 - shoreFade);',
            'float shoreBoost = shoreProximity * clamp(turbulence * 2.5 + fftFoamAmount * 0.5, 0.0, 1.0);',
            'foamAmount = max(foamAmount, shoreBoost);',
          '}',
        '}',
        '} //end if(underwaterFactor < 0.5) — foam system off below the surface',
      '#else',
        'float foamAmount = 0.0;',
      '#endif',

      'vec3 normalizedViewVector = normalize(worldPosition.xyz - cameraPosition);',
      'vec2 screenUV = gl_FragCoord.xy / screenResolution;',

      '//Screen-space reflection: reflect the view ray off the displaced water normal and',
      '//ray-march against the refraction depth buffer (already rendered this frame, free).',
      '//Correctly samples sky/atmosphere at the horizon — no planar camera terrain capture.',
      'vec3 worldIncidentDir = normalize(worldPosition.xyz - cameraPosition);',
      '//Use macroNormal (cascade 0 only, ~2m/texel) for SSR ray direction — avoids the',
      '//high-frequency per-pixel noise that displacedNormal causes in reflection lookups.',
      'vec3 ssrReflectDir    = reflect(worldIncidentDir, macroNormal);',
      '//screenSpaceReflection() always returns LINEAR values (see function comment).',
      'vec3 reflectedLight   = screenSpaceReflection(worldPosition.xyz, ssrReflectDir);',

      '//Screen-space refraction',
      '//Distort UVs based on FFT normal only — same reason as reflection: avoids visible normal map tiling',
      'vec2 distortion = displacedNormal.xz * REFRACTION_DISTORTION;',
      'vec2 refractedUV = clamp(screenUV + distortion, 0.001, 0.999);',

      '//Sample refraction color and depth',
      '//Raw NDC depth is kept only for the unprojection at line ~1080',
      '//(refractedUV + refractionDepthRaw → clipPos → viewPos → world). The',
      '//linear-depth comparisons below sample the pre-linearised target — no',
      '//per-pixel divide here either.',
      'float refractionDepthRaw = texture2D(refractionDepthTexture, refractedUV).r;',
      'float refractionDepthLinear = texture2D(refractionLinearDepth, refractedUV).r;',
      '//G-buffer clear leaves linear depth at 0 in pixels with no scene geometry;',
      '//fold those into the far-plane so the isFarPlane test below behaves',
      '//identically to the old separate linearize pass (NDC=1 → far).',
      'if(refractionDepthLinear < 0.0001) refractionDepthLinear = cameraNearFar.y;',
      'float surfaceDepthLinear = linearizeDepth(gl_FragCoord.z);',

      '//If distorted UV samples something closer than the water surface, fall back to undistorted',
      'if(refractionDepthLinear < surfaceDepthLinear - 0.5){',
        'refractedUV = screenUV;',
        'refractionDepthRaw = texture2D(refractionDepthTexture, refractedUV).r;',
        'refractionDepthLinear = texture2D(refractionLinearDepth, refractedUV).r;',
        'if(refractionDepthLinear < 0.0001) refractionDepthLinear = cameraNearFar.y;',
      '}',

      '//G-buffer attachment 0 stores LINEAR albedo (sRGB-encoded source textures',
      '//are decoded inside the G-buffer fragment shader before write), so sample',
      '//directly here — no second decode.',
      'vec3 refractedLight = texture2D(refractionColorTexture, refractedUV).rgb;',

      '//Reconstruct world-space position from refraction depth',
      'vec4 clipPos = vec4(refractedUV * 2.0 - 1.0, refractionDepthRaw * 2.0 - 1.0, 1.0);',
      'vec4 viewPos = inverseProjectionMatrix * clipPos;',
      'viewPos /= viewPos.w;',
      'vec3 pointXYZ = (inverseViewMatrix * viewPos).xyz;',

      '//Unified distance-depth model — no isDeepWater branch.',
      '//  verticalDepth:   real water-column thickness (surface Y - seabed Y) when',
      '//                   the refraction ray actually hit underwater geometry, else 0.',
      '//  horizontalDist:  distance across the ocean surface between camera and fragment.',
      '//                   Acts as a grazing-path proxy: a ray skimming the surface',
      '//                   accumulates "fake" water in front of it, so transmittance',
      '//                   decays with distance even when no seabed is in the sample.',
      '//At the horizon horizontalDist → large, transmittance → 0, refractedLight asymptotes',
      '//to the backscatter equilibrium color (scattering / extinction) — which is what',
      '//a semi-infinite water column actually looks like. Kills sky-dome-through-water',
      '//leak without a depth threshold or deep-water color swap.',
      'bool isFarPlane = refractionDepthLinear > cameraNearFar.y * 0.99;',
      '//Compare the sampled point against the actual displaced water surface',
      '//(worldPosition.y), NOT the flat rest plane — wave crests routinely sit',
      '//several metres above baseHeightOffset and the flat-plane test would',
      '//wrongly call a rock under such a crest "above water."',
      'bool hasUnderwaterGeom = !isFarPlane && pointXYZ.y < worldPosition.y && refractionDepthLinear > surfaceDepthLinear;',
      '//Refraction ray hit no opaque geometry → the water column physically extends to',
      '//infinity below the surface, so we should behave as deep water and let the',
      '//refraction term hand off cleanly to inscatterEquilibrium. Without this, looking',
      '//straight down (where horizontalDist is tiny) leaves transmittance ≈ 1 and the',
      '//cleared-far-plane sky pixel from the refraction texture leaks through as white.',
      '//500.0 matches the effectiveDepth cap below — saturates transmittance to ~0.',
      '//  hasUnderwaterGeom — real water column.',
      '//  isFarPlane        — ray missed all geom; 500m saturates transmittance ~0',
      "//                      so the cleared sky pixel doesn't leak through bright.",
      '//  above-wave hit    — ray landed above the actual displaced surface; use',
      '//                      3D distance as a Beer-Lambert proxy so the blend',
      "//                      still mixes inscatter and we don't get a dark rim.",
      'float verticalDepth = hasUnderwaterGeom ? max(worldPosition.y - pointXYZ.y, 0.0)',
                                              ': (isFarPlane ? 500.0',
                                                            ': distance(worldPosition.xyz, pointXYZ));',
      'float horizontalDist = length(worldPosition.xz - cameraPosition.xz);',
      '//horizontalDepthScale: how many meters of effective depth per meter of horizontal',
      '//distance. 0.008 → 100m of horizontal fetch ≈ 0.8m of water, 1000m ≈ 8m — enough',
      '//for the horizon to asymptote to inscatter without choking shallows from a high',
      '//camera angle (where horizontalDist is large but the actual water column is thin).',
      'float effectiveDepth = min(verticalDepth + horizontalDist * HORIZONTAL_DEPTH_SCALE, 500.0);',
      '//Physically-based underwater light transport',
      '//Extinction = absorption + scattering (Beer-Lambert for both)',
      'vec3 extinction = waterAbsorption + waterScattering;',
      'vec3 transmittance = exp(-extinction * effectiveDepth);',

      '//Sun light entering the water column',
      '//Fresnel transmission at the air->water interface from above',
      'float sunCosZenith = max(dot(-brightestDirectionalLightDirection, vec3(0.0, 1.0, 0.0)), 0.0);',
      'float sunTransmission = 1.0 - fresnelAirToWater(sunCosZenith);',

      '//Backscatter equilibrium: asymptotic color of a semi-infinite water column.',
      "//(scattering / extinction) is the medium's single-scatter ALBEDO — a 0..1",
      '//reflectance — so it becomes visible radiance only when multiplied by the',
      '//actual downwelling light hitting the surface. Two drivers, à la Bruneton:',
      '//  directDownwelling  — brightestDirectionalLight * surface Fresnel * cos zenith.',
      '//                       Sun by day, moon by night (dim but physical). Zero at sub-',
      '//                       horizon so polar night ocean goes dark as it should.',
      "//  ambientDownwelling — diffuse sky hemisphere irradiance from a-starry-sky's",
      '//                       y-axis hemispherical light. After the 2026-05-14 unit',
      '//                       reconciliation (water-review SUMMARY Step 2), this is',
      '//                       used raw — same scale as brightestDirectionalLight.',
      '//Extinction ordering matters for dusk: orange sky sampled through the water is',
      '//filtered by transmittance = exp(-extinction * d). Blue must have the SMALLEST',
      '//extinction so it survives long paths (real clean ocean: Pope & Fry 1997), else',
      '//a red-heavy sky tinted by green-biased transmittance reads olive.',
      'vec3 waterAlbedo = waterScattering / max(extinction, vec3(0.0001));',
      '//Crest-style: dim the DIRECT downwelling in shadow so the body reads',
      '//visibly cooler/darker, but lerp toward a floor instead of multiplying',
      '//to zero — fully shadowed water otherwise becomes a near-black void',
      '//if ambientDownwelling happens to be tiny. The 0.65 floor keeps shadowed',
      '//crests reading as "blue but a touch deeper" rather than "ink." Reflection,',
      '//refracted scene, and ambient stay untouched.',
      'float inscatterShadow = mix(0.65, 1.0, sunShadowFactor);',
      'vec3 directDownwelling = brightestDirectionalLight * sunTransmission * sunCosZenith * inscatterShadow;',
      'vec3 ambientDownwelling = skyAmbientColor;',
      '//Body-colour inscatter equilibrium is now produced by',
      '//`underwaterInscatterSurface(viewDir)` at the blend site below — the same',
      '//HG-phased single-scatter model that the chunk fog and the underwater',
      '//ceiling fog use. The old `waterAlbedo · Edown / π` Lambertian form lived',
      '//here; it was a surface-reflectance approximation that disagreed with the',
      '//volumetric inscatter the chunk fades to. One source now, three callers.',

      '//Fresnel with a distance-driven roughness clamp on the grazing peak.',
      '//',
      '//Plain Schlick on the macro normal would tell us that distant water at',
      "//grazing angle is a near-perfect mirror of the sky. Real ocean isn't:",
      '//you see the SIDES of waves at grazing, not their sky-facing tops, and',
      '//the microfacets that WOULD reflect the horizon sky are masked by their',
      '//neighbours (Smith G2). The rendered surface compounds the problem —',
      '//small-cascade slope detail mips/aliases away with distance, so the',
      '//pixel-scale "macro normal" lies about how flat the surface really is.',
      '//',
      '//Fix: rebuild the lost-to-LOD slope variance per pixel. Each cascade',
      '//contributes its precomputed σ² (cascadeRMSSlope[c], integrated from',
      '//JONSWAP in ocean-height-band-library.js) once the viewer is far enough',
      "//that the cascade's wavelengths are sub-pixel. Sum gives α²_GGX. Apply",
      '//the Karis split-sum horizon clamp: the grazing Fresnel ceiling drops',
      '//from 1.0 toward F0 as roughness grows, exactly the energy roll-off a',
      '//GGX-prefiltered cubemap would integrate. Distance-aware, physically',
      '//motivated, and replaces the failed 2db241e fresnelNormalAlpha/',
      '//fresnelDistanceRoughness stack — which used hardcoded m-range fades',
      '//ungrounded in actual cascade slope content and so crushed mid-distance',
      '//reflection variance independently of how rough the surface really was.',
      '//',
      '//Each cascade fades from "fully resolved" at d=0.5·L to "fully lost"',
      '//at d=4·L. Cascade 0 (4096 m) is never lost in any scene we render;',
      '//cascade 5 (4 m) starts contributing roughness past ~2 m and is fully',
      '//folded in by ~16 m. The displacement-fade ranges (×50…×500·L in the',
      '//vertex block) are intentionally longer — displacement itself is',
      '//still meaningful well past where individual wavelets are resolvable.',
      'float alpha2 = 0.0;',
      'for(int c = 0; c < 6; c++){',
        'float lostFrac = smoothstep(0.5 * cascadePatchSizes[c], 4.0 * cascadePatchSizes[c], distanceToWorldPosition);',
        'alpha2 += lostFrac * cascadeRMSSlope[c];',
      '}',
      '//waveHeightMultiplier scales the displacement amplitude in the vertex',
      '//shader; slope scales linearly with amplitude so slope variance scales',
      '//quadratically. Apply on the shader side so live artistic changes to',
      '//wave_scale_multiple flow through without recomputing cascadeRMSSlope.',
      'alpha2 *= waveHeightMultiplier * waveHeightMultiplier;',
      '//Beckmann-to-GGX: α²_GGX ≈ 2·σ²_slope. Clamp keeps the horizon-ceiling',
      '//term well-defined when several cascades pile in at extreme range.',
      'alpha2 = clamp(2.0 * alpha2, 0.0, 1.0);',
      'float alphaRough = sqrt(alpha2);',

      '//Karis "Real Shading in Unreal Engine 4" environment BRDF — the grazing',
      '//Fresnel ceiling becomes max(1-α, F0) instead of 1.0. Standard Schlick',
      '//is the α=0 limit; α=1 collapses to flat F0 (no grazing peak at all).',
      'float cosTheta = clamp(dot(displacedNormal, -normalizedViewVector), 0.0, 1.0);',
      'float horizonCeiling = max(1.0 - alphaRough, r0);',
      'float fresnelFactor = r0 + (horizonCeiling - r0) * pow(1.0 - cosTheta, 5.0);',

      '//Energy-conserving Schlick: body and reflection share a single fresnelFactor.',
      '//  body weight       = 1 - fresnelFactor  (1 looking down, 0 at horizon)',
      '//  reflection weight = fresnelFactor      (0 looking down, 1 at horizon)',
      '//Sums to 1.0 — no additive double-count. The previous `fresnelBody = min(f, 0.3)`',
      '//decoupling was added to fight a pea-green tint at the horizon, but it left body',
      '//weight ≥ 0.7 everywhere AND reflection at full Schlick, summing to 1.4 — which',
      '//made the bright sky reflection dominate ~70% of every pixel and pulled the whole',
      '//ocean toward "blue-white sheet." If horizon tint returns, fix the horizon source',
      '//(inscatterEquilibrium hue) instead of double-weighting.',
      '//',
      '//Reflection HDR cap deleted in SUMMARY Step 3: the AES-Filmic tonemap below',
      '//has a smooth shoulder that absorbs HDR>1 cleanly (4.0 → 0.97, 10.0 → 1.0),',
      '//so a body-wide min(reflectedLight, 4.0) was throwing away ~1.5 stops of',
      '//sun-disk dynamic range AND distorting hue at the clamp (orange→grey). If',
      '//a firefly artifact appears on a single sun-disk specular sample, fix with',
      '//a localized clamp on the specular lobe only, not by reinstating this cap.',


      '//Relight the G-buffer sample. Two branches, picked by whether the sampled',
      '//point is below or above the water rest plane:',
      '//  (a) UNDERWATER:  Snell-bent sun + Beer-Lambert downpath + caustics +',
      '//                   underwater ambient (skyAmbient × waterAlbedo).',
      '//  (b) ABOVE WATER: standard sun × NdotL × sunShadow + skyAmbient.',
      '//Both branches drive the lit value from albedo × lighting, so at zero',
      '//ambient + zero direct, the body contribution is zero (no raw albedo leak).',
      '//Going above-water-style instead of "saturate to deep blue" lets us see',
      '//distant shore and just-above-water terrain naturally, with the thin water',
      '//layer between camera and sample handled by the transmittance blend below.',
      '//',
      '//Cheap planar Snell for the underwater branch: approximate the water surface',
      '//as a flat plane at y = worldPosition.y, refract once, attenuate the sun',
      '//leg along the refracted path (shorter than the air direction at low sun),',
      '//and sample the air-side sunShadowMap at the point where the sun ray',
      '//emerged from the surface (so the island casts a shadow on the seabed',
      '//beneath it). Ignores wave-surface curvature — that high-frequency',
      '//variation is what caustics encode.',
      '//Diagnostic: capture the raw causticShader output so debug mode 14 can',
      '//visualise it independently of the dim multiplicative chain.',
      'vec3 dbgCausticSample = vec3(0.0);',
      'if(hasUnderwaterGeom){',
        'vec3 seabedNormal = normalize(texture2D(gBufferNormal, refractedUV).rgb);',

        '//Snell refraction at the flat water surface (n_air/n_water = 1/1.33).',
        'vec3 sunDirInWater = refract(brightestDirectionalLightDirection, vec3(0.0, 1.0, 0.0), 1.0 / 1.33);',
        'vec3 sunDirToSeabed = -sunDirInWater;',
        'float upY = max(sunDirToSeabed.y, 0.05);',
        'float NdotL_seabed = max(0.0, dot(seabedNormal, sunDirToSeabed));',

        '//Refracted-path length from seabed up to the surface — shorter than',
        '//the air-direction approximation at grazing sun.',
        'float downPath = max(0.0, worldPosition.y - pointXYZ.y) / upY;',
        'vec3 sunDown = brightestDirectionalLight * sunTransmission * exp(-extinction * downPath);',

        '//Air-side surface emergence point for the shadow lookup.',
        'vec3 pSurfaceHit = pointXYZ + sunDirToSeabed * downPath;',
        'float seabedShadowFactor = 1.0;',
        'if(sunShadowEnabled == 1){',
          'vec4 seabedShadowCoord = sunShadowMatrix * vec4(pSurfaceHit, 1.0);',
          'seabedShadowFactor = getSunShadow(seabedShadowCoord);',
        '}',

        'vec3 causticMod = vec3(1.0);',
        '#if($caustics_enabled)',
          '//Caustic modulation around 1.0 (brief 04 sec 2): the divergence of',
          '//refracted sun rays redistributes energy across the seabed -- total',
          '//energy is conserved, so the operator is a mean-1 multiplier.',
          '//',
          '//Pivot at CAUSTIC_TEXTURE_MEAN, not 0.5: the smoothstep contrast',
          '//curve maps the raw min(R,G) tap distribution (already low-mean',
          '//from the double-min in causticShader) into a left-skewed [0,1]',
          '//sample whose empirical mean sits near 0.25. Subtracting 0.5',
          '//instead would darken most of the seabed because most pixels live',
          '//well below 0.5; subtracting 0.25 is the correct zero-mean shift',
          '//for THIS texture+contrast-curve.',
          '//',
          '//Depth-contrast fade (brief 04 sec 2 item 2): caustic ray bundles',
          '//spread out with depth, so even when total energy is conserved the',
          '//contrast of the pattern flattens. exp(-downPath / CONTRAST_DEPTH)',
          '//gives sharp caustic webs in 0-2 m water and a soft diffuse',
          '//modulation past 3 e-folds (~24 m at default 8 m e-fold).',
          '//',
          '//The whole factor still rides on sunDown (already Beer-Lambert',
          '//attenuated by downPath) so ABSOLUTE caustic brightness also fades',
          '//with depth and sunset on top of the contrast fade.',
          'const float CAUSTIC_AMP             = 3.0;',
          'const float CAUSTIC_TEXTURE_MEAN    = 0.25;',
          'const float CAUSTIC_CONTRAST_DEPTH  = 8.0;',
          'const float CAUSTIC_THRESHOLD_LO    = 0.15;',
          'const float CAUSTIC_THRESHOLD_HI    = 0.85;',
          '//UV multiplier sets caustic texture tile size. The texture itself encodes',
          '//multiple caustic structures, so the visible caustic period is texture_tile / N.',
          '//0.3 → ~3.3 m tile, ~0.5-1 m visible caustic scale (real pool shimmer).',
          '//Previous 0.02 (50 m tile) was invisible at close range; 1.0 (1 m tile) was',
          '//sub-pixel and averaged to flat. 0.3 is the sweet spot for 1 unit = 1 m world.',
          'float causticLightingR = causticShader(0.3 * pointXYZ.xz + 0.005, t);',
          'float causticLightingG = causticShader(0.3 * pointXYZ.xz, t);',
          'float causticLightingB = causticShader(0.3 * pointXYZ.xz - 0.005, t);',
          'vec3 causticSampleRaw = vec3(causticLightingR, causticLightingG, causticLightingB);',
          'vec3 causticSample = smoothstep(vec3(CAUSTIC_THRESHOLD_LO), vec3(CAUSTIC_THRESHOLD_HI), causticSampleRaw);',
          'dbgCausticSample = causticSample;',
          'float causticDepthFade = exp(-downPath / CAUSTIC_CONTRAST_DEPTH);',
          'causticMod = vec3(1.0) + causticDepthFade * causticIntensityMultiplier * CAUSTIC_AMP * (causticSample - vec3(CAUSTIC_TEXTURE_MEAN));',
        '#endif',

        'vec3 ambientUW = skyAmbientColor * waterAlbedo;',
        '//Pragmatic seabed scale: no /pi here even though strict Lambertian',
        '//convention would apply one (L = albedo * E * NdotL / pi). The /pi',
        '//belongs on inscatterEquilibrium (see :1147) because THAT term was',
        '//over-driving the surface; the seabed already barely beats the bright',
        '//inscatter in clean ocean (rocks dim relative to equilibrium in G/B),',
        '//so dividing it further erased it in mode 0 and made it visible only',
        '//in shallow water during the 2026-05-16 mode-5 + x10 diagnostic. We',
        '//accept the unit inconsistency between the two body terms: /pi where',
        '//it dims an over-bright term, no /pi where doing so would erase a',
        '//term that already reads as a small lift over equilibrium.',
        'refractedLight *= (sunDown * NdotL_seabed * causticMod * seabedShadowFactor + ambientUW);',
      '}',
      'else if(!isFarPlane){',
        '//Above-water terrain visible through wave distortion / grazing-angle',
        '//refraction. Light it the same way the terrain shader would: direct sun',
        '//× NdotL × sunShadow + sky ambient. The thin water column between the',
        '//water surface and the sample point is handled by the transmittance',
        '//blend below — short column ⇒ transmittance ≈ 1 ⇒ pass-through; long',
        '//column (e.g. far shore behind a wide ocean stretch) ⇒ transmittance',
        '//→ 0 ⇒ inscatter dominates.',
        'vec3 sampleNormal = normalize(texture2D(gBufferNormal, refractedUV).rgb);',
        'vec3 sunDirAir = -brightestDirectionalLightDirection;',
        'float NdotL_terrain = max(0.0, dot(sampleNormal, sunDirAir));',
        'float terrainShadowFactor = 1.0;',
        'if(sunShadowEnabled == 1){',
          'vec4 terrainShadowCoord = sunShadowMatrix * vec4(pointXYZ, 1.0);',
          'terrainShadowFactor = getSunShadow(terrainShadowCoord);',
        '}',
        'refractedLight *= (brightestDirectionalLight * NdotL_terrain * terrainShadowFactor + skyAmbientColor);',
      '}',
      '//DEBUG snapshots (read by oceanShadowDebugMode 5..10 at bottom of shader).',
      '//dbgRawRefraction here is post-seabed-relight (since we already passed the',
      "//caustics block) — that's what we actually feed into the blend, so it's the",
      '//meaningful "what would be the body-color contribution" value.',
      'vec3 dbgPostRelight = refractedLight;',
      'vec3 dbgTransmittance = transmittance;',
      'bool dbgHasUW = hasUnderwaterGeom;',
      'bool dbgIsFarPlane = isFarPlane;',
      'float dbgVerticalDepth = verticalDepth;',
      'float dbgEffectiveDepth = effectiveDepth;',
      'vec3 dbgReflectedLight = reflectedLight;',
      'float dbgFresnelFactor = fresnelFactor;',
      '//Crest sun back-scatter (Q8). Forward-scatter lobe peaks when the camera',
      '//is looking AT the sun — sun behind the wave from camera POV ⇒ light',
      '//transmits through the thin water at the crest and exits toward the eye.',
      '//',
      '//Sign convention: `brightestDirectionalLightDirection` points FROM sun TO',
      '//surface (the direction sunlight travels). `normalizedViewVector` points',
      '//FROM camera TO surface. The scattering-angle cosine in Henyey-Greenstein',
      '//is dot(incident, scattered) measured outward from the scatter point.',
      '//Incident is +lightDir; scattered toward the camera is -viewDir; so',
      '//  cosScatter = dot(lightDir, -viewDir) = -dot(lightDir, viewDir).',
      '//Equivalently dot(-lightDir, viewDir) — the form used here, mirroring',
      '//the rest of the shader where -lightDir is the toward-sun vector.',
      '//Reaches +1 when the camera looks straight at the sun.',
      '//',
      '//Multiplied by waterAlbedo so the contribution picks up the body hue, and',
      '//by brightestDirectionalLight so dawn/dusk crests glow gold (warm sun',
      '//color) rather than white.',
      '//',
      '//Three gates keep this term invisible everywhere except backlit crests:',
      '//  crestGate    — only waves above SUB_SURFACE_HEIGHT_MIN contribute, so',
      '//                 the flat near-field never blooms (the failure mode of',
      '//                 the scrapped 2026-05-15 first attempt).',
      '//  sunUp        — fades to 0 below the horizon (no moon back-glow).',
      '//  fresnelT     — grazing-view waves reflect rather than transmit.',
      '//Additionally the body weight (1 - fresnelFactor) is applied at the',
      '//final composition step, so view-aligned grazing geometry never',
      '//double-counts a transmitted halo on top of a strong specular reflection.',
      'float waveHeightAboveRest = max(0.0, worldPosition.y - baseHeightOffset);',
      'float crestGate = smoothstep(SUB_SURFACE_HEIGHT_MIN,',
                                   'SUB_SURFACE_HEIGHT_MIN + SUB_SURFACE_HEIGHT_RANGE,',
                                   'waveHeightAboveRest);',
      'float cosScatter = max(0.0, dot(-brightestDirectionalLightDirection, normalizedViewVector));',
      'float backScatterLobe = pow(cosScatter, SUB_SURFACE_FALL_OFF);',
      'float sunUpForSubsurface = smoothstep(0.0, 0.15, sunZenithFactor);',
      'float fresnelT = 1.0 - fresnelFactor;',
      'vec3 crestTranslucency = waterAlbedo * brightestDirectionalLight',
                             '* backScatterLobe * crestGate * sunUpForSubsurface',
                             '* fresnelT * sunShadowFactor * SUB_SURFACE_STRENGTH;',

      '//Blend refracted sample with backscatter equilibrium by transmittance.',
      '//Near-field, shallow: transmittance ≈ 1, refractedLight ≈ sampled scene.',
      "//Far-horizon / deep: transmittance → 0, refractedLight → the medium's",
      '//single-scatter equilibrium for the camera→surface view ray.',
      '//Continuous across the whole range — no branching, no far-plane cliff.',
      '//',
      '//Inscatter uses the same `underwaterInscatterSurface()` function the chunk',
      '//fog and the underwater-ceiling `applyUnderwaterFog` call — one HG-phased',
      '//volumetric model, three callers. View-direction dependence (HG sun phase)',
      '//means deep water reads brighter looking down-sun than perpendicular to it',
      '//— the same forward-scatter halo that paints god rays under water.',
      '//',
      "//Crest translucency adds to the body channel — it's transmitted light, so",
      '//it picks up the same (1 - fresnelFactor) weight as the rest of the body',
      '//at the final composition step.',
      'vec3 bodyInscatter = underwaterInscatterSurface(normalizedViewVector);',
      'vec3 dbgInscatterEquilibrium = bodyInscatter;',
      'refractedLight = refractedLight * transmittance + bodyInscatter * (vec3(1.0) - transmittance) + crestTranslucency;',
      'vec3 dbgBody = refractedLight;',

      '//Calculate specular lighting and surface lighting',
      'float lightMag = length(brightestDirectionalLight);',
      'vec3 normalizedLightIntensity = lightMag > 0.001 ? brightestDirectionalLight / lightMag : vec3(0.0);',
      'vec3 directionalSurfaceLighting = normalizedLightIntensity * max(dot(macroNormal, -brightestDirectionalLightDirection), 0.0) * sunShadowFactor;',

      '//── Cook-Torrance microfacet sun-glint specular ─────────────────────────',
      '//Ported from the Water sibling (Acerola FFTWater.shader): Beckmann D +',
      '//Smith-Beckmann G + roughness-aware Schlick F. The FFT cascade chain',
      '//(sampled per-fragment from the displacement textures) drives the',
      '//per-pixel meso-normal; the surfaceRoughness uniform drives the',
      '//statistical microfacet distribution width for the sub-pixel slope',
      '//variance the spectrum cannot resolve (capillary waves, sub-cascade-5',
      "//ripples). This replaces the previous Phong lobe — Phong's mesh-scale",
      '//facet integration produced wave-face-sized bright smears instead of',
      '//the pinpoint glints real ocean has, because a Phong pow(NdotR, n)',
      '//fires whenever an entire mesh facet aligns rather than statistically',
      '//weighting the unresolved facets within each pixel.',
      '//',
      '//Hypothesis (2026-05-19): the BRDF was being fed a per-pixel sample of',
      "//cascade 5's high-k content via 1-texel-eps central differences. Adjacent",
      '//pixels landed on nearly-uncorrelated samples, so Cook-Torrance fired',
      '//only on the lucky-aligned ones (quartz fleck), and widening α to',
      '//compensate collapsed everything to a fuzzy blob.',
      '//',
      '//Fix: build specNormal exactly as displacedNormal — same Crest-style',
      '//choppy cross product, same Tx/Tz form, all 6 cascades present — but',
      "//swap cascade 5's height-slope contribution from the native 1-texel-eps",
      "//to an 8-texel-eps central difference. The wider stride lets the GPU's",
      "//bilinear filter average across cascade 5's sub-meter content, giving a",
      '//slope value that varies smoothly per-pixel instead of independently',
      '//per-pixel. Cascades 0-4 (meter-to-km wave faces — the visible swell)',
      "//are untouched, so the sun pillar's geometry still rides the real waves.",
      '//',
      "//This is the analogue of Acerola's slope-texture-with-tile-8 sampling",
      '//(FFTWater.shader:251-264) but using a wide eps to get the same',
      '//implicit-low-pass behavior on a height texture.',
      'vec2 c5FilteredHeightSlope = vec2(0.0);',
      '{',
        'float specEps = 8.0 / patchDataSize;',
        'float specWorldStep = cascadePatchSizes[5] * 8.0 / patchDataSize;',
        'float fade5 = smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToWorldPosition);',
        'vec2 uv5 = (vWorldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5];',
        'float hL = texture2D(cascadeDisplacementTextures[5], uv5 + vec2(-specEps, 0.0)).y;',
        'float hR = texture2D(cascadeDisplacementTextures[5], uv5 + vec2( specEps, 0.0)).y;',
        'float hB = texture2D(cascadeDisplacementTextures[5], uv5 + vec2( 0.0, -specEps)).y;',
        'float hT = texture2D(cascadeDisplacementTextures[5], uv5 + vec2( 0.0,  specEps)).y;',
        'c5FilteredHeightSlope = vec2(hR - hL, hT - hB) / (2.0 * specWorldStep);',
        'c5FilteredHeightSlope *= fade5 * waveHeightMultiplier;',
      '}',
      '//Total height slope for spec = full displacedNormal slope minus cascade-5',
      '//native contribution plus cascade-5 filtered contribution. Same cross',
      "//product form (chop derivatives unchanged — they don't suffer from",
      '//per-pixel noise the way the height slope does).',
      'vec2 specHeightSlope = vec2(',
        'rawDdx.y - c5NativeHeightSlope.x + c5FilteredHeightSlope.x,',
        'rawDdz.y - c5NativeHeightSlope.y + c5FilteredHeightSlope.y',
      ');',
      'vec3 specTx = vec3(1.0 + foamDdx.x, specHeightSlope.x, foamDdx.y);',
      'vec3 specTz = vec3(foamDdz.x, specHeightSlope.y, 1.0 + foamDdz.y);',
      'vec3 specNormal = normalize(cross(specTz, specTx));',
      'if(specNormal.y < 0.0) specNormal = -specNormal;',
      'specNormal = normalize(mix(vec3(0.0, 1.0, 0.0), specNormal, foldBlend));',
      'if(specNormal.y < 0.0) specNormal = -specNormal;',

      '//Effective roughness: max of the artist-controlled baseline and the',
      '//distance-grown σ²_GGX from the cascade fade (already computed above',
      '//for the Fresnel horizon clamp). Near camera α ≈ surfaceRoughness;',
      '//at distance the cascade-fade slopes pile in, widening the lobe so the',
      "//horizon doesn't collapse to a mirror.",
      'float ctAlpha = max(surfaceRoughness, alphaRough);',
      'float ctAlpha2 = ctAlpha * ctAlpha;',

      'vec3 ctLightDir = -brightestDirectionalLightDirection;',
      'vec3 ctViewDir  = -normalizedViewVector;',
      'vec3 ctHalfDir  = normalize(ctLightDir + ctViewDir);',
      'vec3 ctMacroN   = vec3(0.0, 1.0, 0.0);',

      'float ctNdotH = max(0.0001, dot(specNormal, ctHalfDir));',
      'float ctNdotL = max(0.0,    dot(specNormal, ctLightDir));',
      'float ctNdotV = max(0.0001, dot(specNormal, ctViewDir));',
      'float ctMacroNdotL = max(0.001, dot(ctMacroN, ctLightDir));',
      'float ctNdotH2 = ctNdotH * ctNdotH;',

      '//Beckmann normal distribution',
      'float ctD = exp((ctNdotH2 - 1.0) / (ctAlpha2 * ctNdotH2))',
                '/ (3.14159265 * ctAlpha2 * ctNdotH2 * ctNdotH2);',

      '//Smith masking-shadowing (Beckmann form)',
      'float ctMaskV = smithMaskingBeckmann(ctHalfDir, ctViewDir,  ctAlpha);',
      'float ctMaskL = smithMaskingBeckmann(ctHalfDir, ctLightDir, ctAlpha);',
      'float ctG = 1.0 / (1.0 + ctMaskV + ctMaskL);',

      "//Roughness-aware Schlick Fresnel (Water sibling variant — Schlick's exponent",
      "//softens with α so rough surfaces don't get a sharp grazing peak).",
      'float ctFNum = pow(1.0 - ctNdotV, 5.0 * exp(-2.69 * ctAlpha));',
      'float ctF = r0 + (1.0 - r0) * ctFNum / (1.0 + 22.7 * pow(ctAlpha, 1.5));',
      'ctF = clamp(ctF, 0.0, 1.0);',

      "//Sun fade: a-starry-sky's brightestDirectionalLight carries meaningful",
      '//magnitude when the sun is below the horizon (twilight residual). Fade',
      '//specular to zero from ~9° above horizon down so post-sunset crests',
      "//don't bloom orange.",
      'float specularSunFade = smoothstep(0.0, 0.15, sunZenithFactor);',

      '//── Crest-style sun-disk highlight ─────────────────────────────────────',
      '//Crest (Ocean.shader:113): pow(dot(reflect(view, N), L), n) · boost ·',
      '//lightColor · shadow. No F, no G, no /4·NdotL_macro divider — just a',
      '//Phong term on the reflected ray with a brightness boost. Sidesteps',
      "//Cook-Torrance's lobe-width trade-off: a true microfacet BRDF can't",
      '//simultaneously be tight (peaky for pinpoint glints) and wide (covers',
      '//the actual ±15-25° wave-face spread) — too tight gives sparse flecks,',
      '//too wide smears diffusely. Phong-on-R with boost decouples the visual',
      '//sharpness (controlled by exponent) from the apparent brightness',
      "//(controlled by boost), which is why Crest's pillar reads as the",
      '//dazzling pinpoint a real sun glint looks like.',
      '//',
      "//Falloff 275.0 and boost 7.0 are Crest's defaults; tune via uniform",
      '//later if you want live control.',
      '//',
      '//The Cook-Torrance ctF/ctG/ctD machinery above is left computed so',
      "//debug modes 23/24 still work — they're free as dead code once the",
      '//compiler proves the result is unused, and they document the path we',
      '//tried.',
      'vec3 specReflectDir = reflect(-ctViewDir, specNormal);',
      'specReflectDir.y = max(specReflectDir.y, 0.0);',
      'float specRdotL = max(0.0, dot(specReflectDir, ctLightDir));',
      '//Distance-varying falloff (Crest OceanReflection.hlsl:105-111): widen the',
      '//Phong lobe with distance so the mip-flattened mid/far normal still catches',
      '//the sun instead of going dark. sqrt ramp broadens early; boost stays',
      '//constant — the Fresnel gate at compositing (not energy conservation) is',
      '//what keeps the near field from blooming. We tried this ramp BEFORE the',
      '//Fresnel gate existed and it smeared the horizon into one sheen, because',
      '//the wide lobe was the only thing controlling visibility; with the gate the',
      '//wide lobe just rides inside Fresnel. specFalloffFar defaults to the near',
      '//exponent (275) so the ramp is a no-op until dialed.',
      'const float SPEC_PHONG_FALLOFF_NEAR = 275.0;',
      'float specFallOffAlpha = sqrt(clamp(distanceToWorldPosition / max(specFalloffFarDist, 1.0), 0.0, 1.0));',
      'float specFallOff = mix(SPEC_PHONG_FALLOFF_NEAR, specFalloffFar, specFallOffAlpha);',
      'vec3 specular = brightestDirectionalLight * pow(specRdotL, specFallOff) * specBoost;',
      'specular *= specularSunFade * sunShadowFactor;',

      '//Total light. Sun shadow is applied only to direct-sun terms (specular',
      '//and the directionalSurfaceLighting / inscatterShadow contributions inside',
      '//the body blend). Sky reflection and refraction stay untouched.',
      '//The body term `refractedLight` is the unified Beer-Lambert/inscatter',
      '//blend assembled above (T * sceneBack + (1 - T) * inscatterEquilibrium).',
      '//Distance-based reflection attenuation. distanceLodFactor goes ~1 near',
      '//camera → 0 at ~7 cascade-0 wavelengths; we want the OPPOSITE shape (1',
      '//near, falls off far) for an attenuator. smoothstep keeps the transition',
      "//gentle so there's no visible band.",
      '//Falloff range is meters: 0..160 m matches the scene scale.',
      'float reflectionDistanceAttenuation = mix(1.0, 1.0 - reflectionDistanceFalloff,',
                                                'smoothstep(0.0, 1.0, distanceToWorldPosition / 160.0));',
      'vec3 attenuatedReflection = reflectedLight * reflectionScale * reflectionDistanceAttenuation;',
      '//Sun-glint placement (Crest OceanReflection.hlsl:113-118). Crest adds the',
      "//Phong glint INTO the reflection colour, so it shares the reflection's",
      '//Fresnel gate (R_theta). specFresnelGate blends our two paths:',
      '//  ungated portion  — added raw outside the Fresnel mix (legacy behavior).',
      '//  gated portion    — folded into the reflection group, multiplied by',
      "//                     fresnelFactor, so it can't bloom looking down (tiny F)",
      '//                     and strengthens toward grazing mid/far (F->1).',
      '//At specFresnelGate = 0.0 this is byte-identical to the old additive glint.',
      'vec3 specularUngated = specular * (1.0 - specFresnelGate);',
      'vec3 reflectionPlusGlint = (attenuatedReflection + specular * specFresnelGate) * fresnelFactor;',
      'vec3 totalLight = specularUngated + (2.0 / 255.0) * directionalSurfaceLighting + (253.0 / 255.0) * (refractedLight * (1.0 - fresnelFactor) + reflectionPlusGlint);',
      '//2026-05-14 unit reconciliation, Step 2 finalizer: removed the additive',
      '//"hemisphere sky fill" term that used to live here. skyAmbientColor is',
      '//already consumed inside inscatterEquilibrium (= waterAlbedo * (direct +',
      '//skyAmbientColor)), which the transmittance-weighted refractedLight blend',
      "//carries into the body color. The sky's reflective contribution is already",
      '//handled by reflectedLight * fresnelFactor. Adding skyAmbientColor a third',
      '//time here was double-counting and produced a milky-white whitewash on top',
      '//of the saturated-but-dim navy body color. The Fresnel + body model is the',
      '//correct physical answer.',

      '#if($foam_enabled)',
        '//dbg* are declared unconditionally (debug modes + computeUnderwaterCeiling read',
        '//them later); the actual foam sampling/lighting/blend is gated off underwater,',
        '//matching the foamAmount guard above. Submerged → dbgFoamBlend stays 0, so the',
        '//ceiling foam mix is a no-op and no foam textures are fetched.',
        'vec3  dbgFoamColor  = vec3(0.0);',
        'float dbgFoamMask   = 0.0;',
        'float dbgFoamBlend  = 0.0;',
        'float dbgFoamAmount = foamAmount;',
        'if(underwaterFactor < 0.5){',
        '//Two-layer foam sampling: average a 90°-rotated, differently-scaled second sample',
        '//with the first to break up the repeating brick pattern (same trick as the large normal map).',
        'vec3  foamAlbedo = 0.5 * (texture2D(foamDiffuseMap, foamTextureUV).rgb  + texture2D(foamDiffuseMap, foamTextureUV2).rgb);',
        'float foamMask   = 0.5 * (texture2D(foamOpacityMap, foamTextureUV).r    + texture2D(foamOpacityMap, foamTextureUV2).r);',
        '//Average packed normals in [0,1] space, then decode once',
        'vec2  foamNMXZ   = (texture2D(foamNormalMap, foamTextureUV).xy + texture2D(foamNormalMap, foamTextureUV2).xy) - 1.0;',

        '//Foam normal: perturb the FFT surface normal with the foam normal map.',
        'vec3 foamSurfaceNormal = normalize(displacedNormal + vec3(foamNMXZ.x, 0.0, foamNMXZ.y) * 0.5);',

        '//Energy-conserving Lambert: a real diffuse plate returns albedo/π × E_inc',
        '//after integrating the cosine lobe over the hemisphere. Foam is the only',
        "//surface in this shader actually shaded as a Lambert plate, so it's the",
        '//only place that visibly suffers from a missing 1/π. With HDR sun magnitude',
        '//~5-6 at noon and a near-white foam albedo, dropping the factor returns',
        '//~5× the radiance the plate would physically emit, slamming the AES tonemap',
        '//shoulder and leaving no headroom for the foam normal map to modulate.',
        'const float INV_PI = 0.31830988618;',
        'float foamNdotL = max(0.0, dot(foamSurfaceNormal, -brightestDirectionalLightDirection));',
        'vec3 foamDiffuse = INV_PI * foamNdotL * lightMag * normalizedLightIntensity * foamAlbedo * sunShadowFactor;',

        '//Sky ambient: same hemisphere model as the water surface ambient above.',
        'float foamSkyFactor = 0.5 + 0.5 * dot(foamSurfaceNormal, vec3(0.0, 1.0, 0.0));',
        'vec3 foamAmbient = skyAmbientColor * foamSkyFactor * foamAlbedo;',

        '//── Field-driven foam shape (2026-05-31) ──────────────────────────────────',
        "//Previously this used Crest's sliding-black-point: foamAmount only moved a",
        '//threshold on the bubble OPACITY texture, so the texture (foamMask) owned the',
        '//silhouette. Because that texture is world-locked (foamTextureUV = worldXZ/2,',
        '//~2 m tiles, line 1285), foam puffs sat at fixed world cells and just blinked',
        '//on/off as crests pulsed over them — they never tracked the waves, and the',
        '//brightest bubbles even leaked through where foamAmount was near zero.',
        '//',
        '//Now the wave-foam FIELD (foamAmount, crest-located out of the broadband RT)',
        '//owns WHERE foam is, and the bubble texture only grains the interior. Foam now',
        '//appears on — and moves with — the field instead of the static texture.',
        '//foamShapeFeather is the soft edge of a field patch; foamGrainFloor stops a',
        '//dark texel from fully eating thin/edge foam.',
        'const float foamShapeFeather = 0.04;',
        'const float foamGrainFloor   = 0.5;',
        'float foamShape = smoothstep(foamShapeFeather, 0.5, foamAmount);',
        'float foamBlend = foamShape * mix(foamGrainFloor, 1.0, foamMask);',
        'dbgFoamColor  = foamDiffuse + foamAmbient;',
        'dbgFoamMask   = foamMask;',
        'dbgFoamBlend  = foamBlend;',
        'totalLight = mix(totalLight, foamDiffuse + foamAmbient, foamBlend);',
        '} //end if(underwaterFactor < 0.5) — foam off below the surface',
      '#else',
        'vec3 dbgFoamColor = vec3(0.0);',
        'float dbgFoamMask = 0.0;',
        'float dbgFoamBlend = 0.0;',
        'float dbgFoamAmount = 0.0;',
      '#endif',

      '#if($atmospheric_perspective_enabled)',
        '//Atmospheric perspective is the most expensive post-lighting step (multiple',
        '//3D LUT samples). Any non-zero debug mode clobbers gl_FragColor below, so',
        '//skip it then — keeps debug captures snappy on dense ocean scenes.',
        '//Modes 50-55 are the ceiling bisection taps — they need the ceiling built,',
        '//so keep computing it for them (it short-circuits to the requested stage',
        '//inside the function). Everything else stays gated to mode 0.',
        'if(oceanShadowDebugMode == 0 || (oceanShadowDebugMode >= 50 && oceanShadowDebugMode <= 55)){',
          'if(underwaterFactor > 0.5){',
            '//Camera is below the surface: this fragment is the underside of the',
            '//water (the "ceiling"). Replace the above-water lighting wholesale',
            '//with the water→air ceiling model — screen-space refraction',
            '//(rippled transmission) + Fresnel/TIR planar reflection + foam,',
            '//fogged by the water column. ocean-grid.js flips the mesh to',
            '//BackSide on the same gate, so only ceiling fragments land here.',
            'totalLight = computeUnderwaterCeiling(worldPosition.xyz, displacedNormal,',
                                                  'dbgFoamColor, dbgFoamBlend,',
                                                  'screenUV,',
                                                  'distanceToWorldPosition);',
          '} else if(oceanShadowDebugMode == 0){',
            '//Above water: Mie+Rayleigh atmospheric perspective.',
            'totalLight = applyAtmosphericPerspective(totalLight, worldPosition.xyz);',
          '}',
        '}',
      '#endif',

      '//Keep the real shaded result around so translucent debug overlays (mode 40)',
      '//can blend over it instead of replacing it (debugBlend opacity).',
      'vec4 finalRenderedColor = linearTosRGB(vec4(MyAESFilmicToneMapping(totalLight), 1.0));',
      'gl_FragColor = finalRenderedColor;',

      '',

      '//Blue noise dithering to break banding (same technique as a-starry-sky).',
      "//Skipped when a debug mode is active so visualisations aren't speckled.",
      'if(oceanShadowDebugMode == 0){',
        'float goldenRatio = 1.61803398875;',
        'float framePhase = fract(blueNoiseTime * 0.001);',
        'ivec2 temporalOffset = ivec2(',
          '128.0 * fract(framePhase * goldenRatio),',
          '128.0 * fract(framePhase * goldenRatio * goldenRatio)',
        ');',
        'gl_FragColor.rgb += (texelFetch(blueNoiseTexture, (ivec2(mod(gl_FragCoord.xy, 128.0)) + temporalOffset) % 128, 0).rgb - vec3(0.5)) / vec3(128.0);',
      '}',

      '#if(!$atmospheric_perspective_enabled)',
        '#include <fog_fragment>',
      '#endif',

    '}',
    ];

    let updatedLines = [];
    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      let updatedCode = originalGLSL[i];
      updatedCode = updatedCode.replace(/\$foam_enabled/g, foamEnabled ? '1' : '0');
      updatedCode = updatedCode.replace(/\$caustics_enabled/g, causticsEnabled ? '1' : '0');
      updatedCode = updatedCode.replace(/\$atmospheric_perspective_enabled/g, (atmosphericPerspectiveEnabled && !!atmosphereFunctionsGLSL) ? '1' : '0');
      //Inject atmosphere parameterization functions where the marker is
      if(atmosphericPerspectiveEnabled && atmosphereFunctionsGLSL && updatedCode.indexOf('ATMOSPHERE_FUNCTIONS_INJECTION_POINT') !== -1){
        updatedCode = atmosphereFunctionsGLSL;
      }
      updatedLines.push(updatedCode);
    }

    return updatedLines.join('\n');
  },

  vertexShader: [
    'precision highp float;',

    'varying vec2 vWorldXZ;',
    'varying vec3 vPosition;',
    'varying vec3 vDisplacedPosition;',
    'varying mat4 vInstanceMatrix;',
    'varying mat4 vModelMatrix;',
    'varying vec4 vSunShadowCoord;',
    '//Four ocean-CSM shadow coords, fine→coarse. Split into individual varyings',
    "//rather than an array so older GLSL ES drivers don't choke on varying arrays.",
    'varying vec4 vOceanShadowCoord0;',
    'varying vec4 vOceanShadowCoord1;',
    'varying vec4 vOceanShadowCoord2;',
    'varying vec4 vOceanShadowCoord3;',

    'uniform float sizeOfOceanPatch;',
    'uniform int ringIndex;',
    'uniform sampler2D cascadeDisplacementTextures[6];',
    'uniform float cascadePatchSizes[6];',
    'uniform vec2 cascadeSpatialOffsets[6];',
    'uniform float waveHeightMultiplier;',
    'uniform float chop;',
    '//Displacement-texture pixel resolution per side (RG=dh/dx,dh/dz storage).',
    '//Used here only to size the finite-difference epsilon for the per-vertex',
    '//normal estimate that drives normal-offset shadow bias.',
    'uniform float patchDataSize;',
    '//World-meter offset distance applied along the surface normal before',
    '//projecting into each cascade shadow space. Decouples receiver sc.z from',
    '//the caster surface plane so triangle-edge sampling mismatches no longer',
    '//cross the depth-comparison threshold.',
    'uniform float oceanShadowNormalBias;',
    'uniform mat4 sunShadowMatrix;',
    '//One shadow matrix per ocean CSM cascade. ocean-shadow-csm.js fits each',
    "//cascade's light camera every frame and pushes its world→light-uv-space",
    '//matrix into the corresponding slot.',
    'uniform mat4 oceanShadowMatrix0;',
    'uniform mat4 oceanShadowMatrix1;',
    'uniform mat4 oceanShadowMatrix2;',
    'uniform mat4 oceanShadowMatrix3;',

    '#if(!$atmospheric_perspective_enabled)',
      '#include <fog_pars_vertex>',
    '#endif',


    'void main() {',
      'vec3 offsetPosition = position;',

      'vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));',
      'float distanceToVertex = distance(cameraPosition.xyz, worldPositionOfVertex.xyz);',
      'vec2 worldXZ = worldPositionOfVertex.xz;',

      '//All 6 cascades are sampled unconditionally with a per-cascade distance',
      '//fade. Small-wavelength cascades get very wide fade ranges so capillary',
      '//and chop detail survive into mid- and far-distance — mipmaps on the',
      '//displacement RTs (composer) tame the sub-pixel aliasing that would',
      '//otherwise come with pushing C4/C5 this far:',
      '//  C2 (L=256m) ×50  → 12800 m   C3 (L=64m)  ×100 → 6400 m',
      '//  C4 (L=16m)  ×250 → 4000 m    C5 (L=4m)   ×500 → 2000 m',
      "//`smoothstep` (not linear clamp) softens the fade-out so the cascade's",
      "//vanishing point doesn't read as a visible ring on the surface.",
      '//',
      '//Step ring-index gates were removed earlier — they showed as ridges at',
      '//clipmap ring boundaries. Per-cascade smooth fades take their place.',
      'vec3 displacement = vec3(0.0);',
      'displacement += texture2D(cascadeDisplacementTextures[0], (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0]).xyz;',
      'displacement += texture2D(cascadeDisplacementTextures[1], (worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[2] *  50.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[2], (worldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[3] * 100.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[3], (worldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[4] * 250.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[4], (worldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[5], (worldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5]).xyz;',
      'displacement *= waveHeightMultiplier;',
      'displacement.x *= -chop;',
      'displacement.z *= -chop;',

      'offsetPosition += displacement;',

      '//Set up our varyings',
      'vWorldXZ = worldPositionOfVertex.xz;',
      'vDisplacedPosition = offsetPosition;',
      'vPosition = position;',
      'vInstanceMatrix = instanceMatrix;',
      'vModelMatrix = modelMatrix;',

      "//Shadow coord — project the displaced world position into the sun's light-clip",
      '//space so the fragment shader can compare against the shadow depth texture.',
      '//One coord for the scene-wide Three.js map (environment casters), four for',
      '//the ocean-only CSM cascades. The fragment shader walks the four fine→coarse',
      '//and uses the first cascade whose UVs fall inside [0,1].',
      'vec4 worldDisplacedPosition = modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);',
      'vSunShadowCoord = sunShadowMatrix * worldDisplacedPosition;',

      '//Normal-offset bias: estimate surface normal from cascade-0 displacement',
      '//finite differences, then push the world position along that normal by',
      '//oceanShadowNormalBias meters before projecting into each cascade shadow',
      '//space. This is the structural fix for ocean self-shadow acne — receiver',
      '//and caster geometries are the SAME mesh, so a per-vertex sc.z that',
      '//matches the caster plane EXACTLY produces triangle-edge acne whenever a',
      '//receiver fragment samples a depth texel that the caster wrote from an',
      '//adjacent triangle. Offsetting receiver-side decouples the comparison.',
      '//Cascade 0 alone is enough — coarse waves dominate the normal, and the',
      '//offset only needs to point roughly outward from the surface.',
      'vec2 ndUV = (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0];',
      'float ndEps = 1.0 / patchDataSize;',
      'float ndStep = cascadePatchSizes[0] / patchDataSize;',
      'float hL = texture2D(cascadeDisplacementTextures[0], ndUV + vec2(-ndEps, 0.0)).y;',
      'float hR = texture2D(cascadeDisplacementTextures[0], ndUV + vec2( ndEps, 0.0)).y;',
      'float hB = texture2D(cascadeDisplacementTextures[0], ndUV + vec2( 0.0, -ndEps)).y;',
      'float hT = texture2D(cascadeDisplacementTextures[0], ndUV + vec2( 0.0,  ndEps)).y;',
      'float dHdX = (hR - hL) / (2.0 * ndStep) * waveHeightMultiplier;',
      'float dHdZ = (hT - hB) / (2.0 * ndStep) * waveHeightMultiplier;',
      'vec3 normalOffsetN = normalize(vec3(-dHdX, 1.0, -dHdZ));',
      'vec4 shadowSamplePos = vec4(worldDisplacedPosition.xyz + normalOffsetN * oceanShadowNormalBias, 1.0);',

      'vOceanShadowCoord0 = oceanShadowMatrix0 * shadowSamplePos;',
      'vOceanShadowCoord1 = oceanShadowMatrix1 * shadowSamplePos;',
      'vOceanShadowCoord2 = oceanShadowMatrix2 * shadowSamplePos;',
      'vOceanShadowCoord3 = oceanShadowMatrix3 * shadowSamplePos;',

      '//Add support for three.js fog',
      '#if(!$atmospheric_perspective_enabled)',
        '#include <fog_vertex>',
      '#endif',

      'vec4 clipPos = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);',
      '#if($horizon_skirt)',
        '//Horizon-skirt ring: pin Z just inside the far plane so rim verts (tens',
        '//of km past camera.far) survive frustum clipping. The skirt sets',
        '//depthWrite:false / renderOrder 1, so this clipPos.z value never',
        '//occludes real geometry (which writes its own correct depth). It only',
        '//makes the skirt survive long enough to draw beneath the FFT ocean and',
        "//above the sky dome's unwritten depth.",
        'clipPos.z = clipPos.w * 0.99999;',
      '#endif',
      'gl_Position = clipPos;',
    '}',
  ].join('\n'),
};

//Ocean shadow-caster material — rendered into the ocean CSM's depth targets
//by ocean-shadow-csm.js. Uniforms mirror the subset of water-shader.glsl
//needed to displace vertices: cascade textures, patch sizes, spatial offsets,
//wave-height multiplier, and chop.
ARestlessOcean.Materials.Ocean.oceanShadowMaterial = {
  uniforms: {
    cascadeDisplacementTextures: {value: [null, null, null, null, null, null]},
    cascadePatchSizes: {value: [4096.0, 1024.0, 256.0, 64.0, 16.0, 4.0]},
    cascadeSpatialOffsets: {value: [
      new THREE.Vector2(1564.7, 2531.3),
      new THREE.Vector2( 241.7,  632.8),
      new THREE.Vector2( 218.6,   60.4),
      new THREE.Vector2(  30.2,   54.7),
      new THREE.Vector2(   1.44,   7.55),
      new THREE.Vector2(   2.83,   0.36)
    ]},
    waveHeightMultiplier: {type: 'f', value: 1.0},
    sizeOfOceanPatch: {type: 'f', value: 1.0},
    chop: {type: 'f', value: 1.0},
    ringIndex: {type: 'i', value: 0},
    mainCameraPosition: {type: 'v3', value: new THREE.Vector3()},
    //EVSM warp constant. Larger values reduce light bleed but compress
    //precision at depth extremes; ~5 is a good float32 balance. MUST
    //match the receiver's evsmExpC exactly or the comparison breaks.
    evsmExpC: {type: 'f', value: 5.0}
  },

  fragmentShader: [
    'precision highp float;',

    '//Ocean shadow-caster fragment — EVSM (Exponential Variance Shadow Map).',
    '//Instead of letting the depth buffer record gl_FragDepth and reading it',
    '//back, we write four warped depth moments into an RGBA32F color target.',
    '//',
    '//Why EVSM: per-triangle z-acne on smooth meshes (the ocean) is structural',
    '//to depth-comparison shadow maps. The receiver and caster are the same',
    '//mesh, so adjacent triangles produce slightly different sc.z values that',
    '//flip the depth comparison even with a calibrated bias. EVSM replaces the',
    '//binary comparison with a probabilistic upper bound (Chebyshev), which',
    '//absorbs sub-texel depth jitter as a smooth shadow gradient.',
    '//',
    '//Layout: store positive and negative exponential warps of the linear',
    '//depth z in [0,1]. The negative warp is kept negative so monotonicity',
    '//survives linear filtering and Gaussian blur in the post-blur pass.',
    '//Receiver does Chebyshev on each warp and takes the min — this is the',
    '//"two-warp" trick that removes most of plain-VSM light bleed.',
    '//  R = exp(c·z)',
    '//  G = exp(c·z)^2 = exp(2c·z)',
    '//  B = -exp(-c·z)',
    '//  A = (-exp(-c·z))^2 = exp(-2c·z)',
    '//Storing all four moments separately rather than computing them on the',
    '//fly in the receiver is what makes the variance computation correct',
    '//across the linear-filtered + Gaussian-blurred reads.',

    'uniform float evsmExpC;',

    'void main(){',
      'float z = gl_FragCoord.z;',
      'float pos = exp(evsmExpC * z);',
      'float neg = -exp(-evsmExpC * z);',
      'gl_FragColor = vec4(pos, pos * pos, neg, neg * neg);',
    '}',
  ].join('\n'),

  vertexShader: [
    'precision highp float;',

    '//Ocean shadow-caster vertex — replicates the displacement logic from',
    '//water-vertex.glsl so the shadow depth texture captures actual wave',
    '//geometry (not a flat sea). Runs inside a sun-aligned orthographic',
    '//camera managed by ocean-shadow-csm.js.',
    '//',
    '//CRITICAL: this MUST match water-vertex.glsl exactly (same ring-gating,',
    '//same distance fade, same uniforms) — otherwise the caster surface ends',
    '//up at a different height than the receiver surface for the same world',
    '//XZ, which makes refZ < d fail everywhere and the entire cascade reads',
    '//as fully shadowed.',
    '//',
    '//distanceToVertex is keyed off the MAIN camera position, not the light',
    '//camera (the built-in cameraPosition refers to whichever camera the',
    '//renderer is currently using, which here is the light). Pushed in via',
    '//mainCameraPosition each frame.',

    'uniform float sizeOfOceanPatch;',
    'uniform int ringIndex;',
    'uniform sampler2D cascadeDisplacementTextures[6];',
    'uniform float cascadePatchSizes[6];',
    'uniform vec2 cascadeSpatialOffsets[6];',
    'uniform float waveHeightMultiplier;',
    'uniform float chop;',
    'uniform vec3 mainCameraPosition;',

    'void main() {',
      'vec3 offsetPosition = position;',
      'vec4 worldPositionOfVertex = (modelMatrix * instanceMatrix * vec4(position, 1.0));',
      'float distanceToVertex = distance(mainCameraPosition.xyz, worldPositionOfVertex.xyz);',
      'vec2 worldXZ = worldPositionOfVertex.xz;',

      '//Mirrors water-vertex.glsl exactly: smoothstep distance fade per cascade.',
      '//Ranges: C2 ×50, C3 ×100, C4 ×250, C5 ×500. Keep this in lockstep with',
      '//water-vertex.glsl — caster Y must match receiver Y at the same world XZ',
      '//or the entire EVSM shadow cascade flips to fully-shadowed.',
      'vec3 displacement = vec3(0.0);',
      'displacement += texture2D(cascadeDisplacementTextures[0], (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0]).xyz;',
      'displacement += texture2D(cascadeDisplacementTextures[1], (worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[2] *  50.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[2], (worldXZ + cascadeSpatialOffsets[2]) / cascadePatchSizes[2]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[3] * 100.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[3], (worldXZ + cascadeSpatialOffsets[3]) / cascadePatchSizes[3]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[4] * 250.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[4], (worldXZ + cascadeSpatialOffsets[4]) / cascadePatchSizes[4]).xyz;',
      'displacement += smoothstep(cascadePatchSizes[5] * 500.0, 0.0, distanceToVertex) * texture2D(cascadeDisplacementTextures[5], (worldXZ + cascadeSpatialOffsets[5]) / cascadePatchSizes[5]).xyz;',
      'displacement *= waveHeightMultiplier;',
      'displacement.x *= -chop;',
      'displacement.z *= -chop;',

      'offsetPosition += displacement;',
      'gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(offsetPosition, 1.0);',
    '}',
  ].join('\n'),
};

//Horizon skirt — pure-inscatter flat ring at y=0 that fills the angular sliver
//between the FFT ocean's last visible patch and the geometric horizon line of
//the sky dome. Reuses a-starry-sky's atmospheric LUTs so the seam between
//water and sky is continuous.
ARestlessOcean.Materials.Ocean.horizonSkirtMaterial = {
  uniforms: {
    atmosphereTransmittance: {type: 't', value: null},
    atmosphereMieInscattering: {type: 't', value: null},
    atmosphereRayleighInscattering: {type: 't', value: null},
    atmSunPosition: {type: 'vec3', value: new THREE.Vector3(0.0, 1.0, 0.0)},
    atmMoonPosition: {type: 'vec3', value: new THREE.Vector3(0.0, -1.0, 0.0)},
    atmSunHorizonFade: {type: 'f', value: 1.0},
    atmMoonHorizonFade: {type: 'f', value: 0.0},
    atmScatteringSunIntensity: {type: 'f', value: 1.0},
    atmScatteringMoonIntensity: {type: 'f', value: 0.0},
    atmMoonLightColor: {type: 'vec3', value: new THREE.Vector3(1.0, 1.0, 1.0)},
    atmCameraHeight: {type: 'f', value: 0.0},
    atmDistanceScale: {type: 'f', value: 1.0},
    //Pre-lit deep-water body color = waterAlbedo * (direct + ambient downwelling).
    //Computed CPU-side in ocean-grid.js so the skirt matches the FFT ocean's
    //inscatterEquilibrium without re-deriving the lighting on the GPU.
    oceanBodyColor: {type: 'vec3', value: new THREE.Vector3(0.04, 0.17, 0.33)},
    //Cascade displacement maps (just the two coarsest, 0+1) so the skirt can
    //reuse the FFT ocean wave normal computation and pick up the same surface
    //chop. Bound from oceanHeightComposer in the per-frame tick block.
    cascadeDisplacementTextures: {value: [null, null]},
    cascadePatchSizes: {value: [4096.0, 1024.0]},
    cascadeSpatialOffsets: {value: [
      new THREE.Vector2(1564.7, 2531.3),
      new THREE.Vector2( 241.7,  632.8)
    ]},
    patchDataSize: {type: 'f', value: 1024.0},
    waveHeightMultiplier: {type: 'f', value: 1.0},
    chop: {type: 'f', value: 0.75}
  },

  fragmentShader: function(atmosphericPerspectiveEnabled, atmosphereFunctionsGLSL){
    let originalGLSL = [
    'precision highp float;',

    'varying vec3 vWorldPos;',

    '#if($atmospheric_perspective_enabled)',
      'precision highp sampler3D;',
      'uniform sampler2D atmosphereTransmittance;',
      'uniform sampler3D atmosphereMieInscattering;',
      'uniform sampler3D atmosphereRayleighInscattering;',
      'uniform vec3 atmSunPosition;',
      'uniform vec3 atmMoonPosition;',
      'uniform float atmSunHorizonFade;',
      'uniform float atmMoonHorizonFade;',
      'uniform float atmScatteringSunIntensity;',
      'uniform float atmScatteringMoonIntensity;',
      'uniform vec3 atmMoonLightColor;',
      'uniform float atmCameraHeight;',
      'uniform float atmDistanceScale;',

      '//ATMOSPHERE_FUNCTIONS_INJECTION_POINT',
    '#endif',

    '//Pre-lit deep-water body color, computed CPU-side each frame to match the FFT',
    '//ocean inscatterEquilibrium = waterAlbedo * (direct + ambient downwelling).',
    'uniform vec3 oceanBodyColor;',

    '//FFT cascade displacement maps + their world-space patch sizes / spatial offsets,',
    '//pulled in from the same OceanHeightComposer the FFT ocean reads. We sample',
    '//cascades 0+1 only (largest wavelengths) — at the distances this skirt covers',
    '//the smaller cascades are sub-pixel and would only add aliasing.',
    'uniform sampler2D cascadeDisplacementTextures[2];',
    'uniform float cascadePatchSizes[2];',
    'uniform vec2 cascadeSpatialOffsets[2];',
    'uniform float patchDataSize;',
    'uniform float waveHeightMultiplier;',
    'uniform float chop;',

    '//Schlick water-air r0 — same constant the FFT ocean uses (water-shader.glsl L182).',
    'const float r0 = 0.02;',

    '//Compute the same wave-displacement-derived surface normal the FFT ocean uses',
    '//(water-shader.glsl L820-944), restricted to cascades 0+1 since the skirt only',
    '//covers far distances where finer cascades are sub-pixel. Returns a normal that',
    '//starts at (0,1,0) close to the camera and gradually picks up wave detail; an',
    '//LOD fade collapses it back to flat at extreme distance, matching FFT outer',
    '//tiles which do exactly the same fade.',
    'vec3 computeWaveNormal(vec3 worldPos, float distanceToVertex){',
      'vec2 worldXZ = worldPos.xz;',
      'float normalLodFactor = clamp(1.0 - distanceToVertex / (cascadePatchSizes[0] * 7.0), 0.0, 1.0);',
      'float normalDetailFade = mix(0.15, 1.0, normalLodFactor * normalLodFactor);',

      'vec3 rawDdx = vec3(0.0);',
      'vec3 rawDdz = vec3(0.0);',
      '//Cascades unrolled — GLSL ES does not allow dynamic indexing of sampler arrays.',
      '//Same pattern the FFT ocean uses (water-shader.glsl L820+).',
      '{',
        'float eps = 1.0 / patchDataSize;',
        'float worldStep = cascadePatchSizes[0] / patchDataSize;',
        'vec2 uv = (worldXZ + cascadeSpatialOffsets[0]) / cascadePatchSizes[0];',
        'vec3 rawL = texture2D(cascadeDisplacementTextures[0], uv + vec2(-eps,  0.0)).xyz;',
        'vec3 rawR = texture2D(cascadeDisplacementTextures[0], uv + vec2( eps,  0.0)).xyz;',
        'vec3 rawB = texture2D(cascadeDisplacementTextures[0], uv + vec2( 0.0, -eps)).xyz;',
        'vec3 rawT = texture2D(cascadeDisplacementTextures[0], uv + vec2( 0.0,  eps)).xyz;',
        'rawDdx += (rawR - rawL) / (2.0 * worldStep);',
        'rawDdz += (rawT - rawB) / (2.0 * worldStep);',
      '}',
      '{',
        'float eps = 1.0 / patchDataSize;',
        'float worldStep = cascadePatchSizes[1] / patchDataSize;',
        'vec2 uv = (worldXZ + cascadeSpatialOffsets[1]) / cascadePatchSizes[1];',
        'vec3 rawL = texture2D(cascadeDisplacementTextures[1], uv + vec2(-eps,  0.0)).xyz;',
        'vec3 rawR = texture2D(cascadeDisplacementTextures[1], uv + vec2( eps,  0.0)).xyz;',
        'vec3 rawB = texture2D(cascadeDisplacementTextures[1], uv + vec2( 0.0, -eps)).xyz;',
        'vec3 rawT = texture2D(cascadeDisplacementTextures[1], uv + vec2( 0.0,  eps)).xyz;',
        'rawDdx += (rawR - rawL) / (2.0 * worldStep);',
        'rawDdz += (rawT - rawB) / (2.0 * worldStep);',
      '}',
      'rawDdx *= waveHeightMultiplier;',
      'rawDdz *= waveHeightMultiplier;',

      'vec2 totalSlope = vec2(rawDdx.y, rawDdz.y);',
      'vec3 Tx = vec3(1.0 - chop * rawDdx.x, totalSlope.x, -chop * rawDdx.z);',
      'vec3 Tz = vec3(-chop * rawDdz.x,      totalSlope.y, 1.0 - chop * rawDdz.z);',
      'vec3 n = normalize(cross(Tz, Tx));',
      'if(n.y < 0.0) n = -n;',
      'n = normalize(mix(vec3(0.0, 1.0, 0.0), n, normalDetailFade));',
      'if(n.y < 0.0) n = -n;',
      'return n;',
    '}',

    '#if($atmospheric_perspective_enabled)',
      '//Sky radiance along a world-space direction. Mirrors computeSkyRadiance() in',
      '//water-shader.glsl so the skirt Fresnel reflection matches the FFT ocean',
      '//SSR-fallback sky sample.',
      'vec3 computeSkyRadiance(vec3 worldDir){',
        'vec3 skyDir = vec3(-worldDir.z, worldDir.y, -worldDir.x);',
        'float viewCosZenith = max(skyDir.y, 0.0);',
        'float xParam = parameterizationOfCosOfViewZenithToX(viewCosZenith);',
        'float yHeight = parameterizationOfHeightToY(RADIUS_OF_EARTH + atmCameraHeight);',

        'float zSun = parameterizationOfCosOfSourceZenithToZ(max(atmSunPosition.y, 0.0));',
        'vec3 uv3Sun = vec3(xParam, yHeight, zSun);',
        'vec3 mieSun = texture(atmosphereMieInscattering, uv3Sun).rgb;',
        'vec3 raySun = texture(atmosphereRayleighInscattering, uv3Sun).rgb;',
        'float cosViewSun = dot(skyDir, atmSunPosition);',
        'vec3 skySun = pow(atmSunHorizonFade, 3.0) * atmScatteringSunIntensity',
                    '* (miePhaseFunction(cosViewSun) * mieSun + rayleighPhaseFunction(cosViewSun) * raySun);',

        'float zMoon = parameterizationOfCosOfSourceZenithToZ(max(atmMoonPosition.y, 0.0));',
        'vec3 uv3Moon = vec3(xParam, yHeight, zMoon);',
        'vec3 mieMoon = texture(atmosphereMieInscattering, uv3Moon).rgb;',
        'vec3 rayMoon = texture(atmosphereRayleighInscattering, uv3Moon).rgb;',
        'float cosViewMoon = dot(skyDir, atmMoonPosition);',
        'vec3 skyMoon = pow(atmMoonHorizonFade, 3.0) * atmScatteringMoonIntensity * atmMoonLightColor',
                     '* (miePhaseFunction(cosViewMoon) * mieMoon + rayleighPhaseFunction(cosViewMoon) * rayMoon);',

        'vec3 transmittanceFade = texture(atmosphereTransmittance, vec2(xParam, yHeight)).rgb;',
        'vec3 baseSkyLighting = 0.25 * vec3(2E-3, 3.5E-3, 9E-3) * transmittanceFade;',

        'return skySun + skyMoon + baseSkyLighting;',
      '}',

      '//Mirrors applyAtmosphericPerspective() in water-shader.glsl.',
      'vec3 applyAtmosphericPerspective(vec3 color, vec3 worldPos){',
        'vec3 worldViewDir = normalize(worldPos - cameraPosition);',
        'vec3 viewDir = vec3(-worldViewDir.z, worldViewDir.y, -worldViewDir.x);',
        'float dist = length(worldPos - cameraPosition) * METERS_TO_KM * atmDistanceScale;',

        'vec3 extinction = exp(-(RAYLEIGH_BETA + EARTH_MIE_BETA_EXTINCTION) * dist);',
        'color *= extinction;',

        'float viewCosZenith = max(viewDir.y, 0.0);',
        'float xParam = parameterizationOfCosOfViewZenithToX(viewCosZenith);',
        'float yHeight = parameterizationOfHeightToY(RADIUS_OF_EARTH + atmCameraHeight);',

        'float zSun = parameterizationOfCosOfSourceZenithToZ(max(atmSunPosition.y, 0.0));',
        'vec3 uv3Sun = vec3(xParam, yHeight, zSun);',
        'vec3 mieSun = texture(atmosphereMieInscattering, uv3Sun).rgb;',
        'vec3 raySun = texture(atmosphereRayleighInscattering, uv3Sun).rgb;',
        'float cosViewSun = dot(viewDir, atmSunPosition);',
        'vec3 fogSun = pow(atmSunHorizonFade, 3.0) * atmScatteringSunIntensity',
                    '* (miePhaseFunction(cosViewSun) * mieSun + rayleighPhaseFunction(cosViewSun) * raySun)',
                    '* (1.0 - extinction);',

        'float zMoon = parameterizationOfCosOfSourceZenithToZ(max(atmMoonPosition.y, 0.0));',
        'vec3 uv3Moon = vec3(xParam, yHeight, zMoon);',
        'vec3 mieMoon = texture(atmosphereMieInscattering, uv3Moon).rgb;',
        'vec3 rayMoon = texture(atmosphereRayleighInscattering, uv3Moon).rgb;',
        'float cosViewMoon = dot(viewDir, atmMoonPosition);',
        'vec3 fogMoon = pow(atmMoonHorizonFade, 3.0) * atmScatteringMoonIntensity * atmMoonLightColor',
                     '* (miePhaseFunction(cosViewMoon) * mieMoon + rayleighPhaseFunction(cosViewMoon) * rayMoon)',
                     '* (1.0 - extinction);',

        'return color + fogSun + fogMoon;',
      '}',
    '#endif',

    'void main(){',
      '//Analytical hit point on the y=0 plane is just the interpolated vertex pos',
      '//(the ring lives in y=0 and barycentric interp on a flat plane is exact).',
      'vec3 worldViewDir = normalize(vWorldPos - cameraPosition);',
      'float distanceToVertex = length(vWorldPos - cameraPosition);',

      '//Wave-displaced normal sampled from the same cascade textures the FFT ocean',
      '//uses, so per-pixel Fresnel varies the same way wavy water does and the',
      '//skirt does NOT read as a perfect grazing mirror everywhere.',
      'vec3 normal = computeWaveNormal(vWorldPos, distanceToVertex);',

      '//Schlick Fresnel against the (now wave-tilted) normal — same form as',
      '//water-shader.glsl L1230. Wave faces tilted toward camera drop F well',
      '//below 1.0, exposing more body color.',
      'float cosTheta = clamp(dot(normal, -worldViewDir), 0.0, 1.0);',
      'float fresnelFactor = r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);',

      'vec3 color = oceanBodyColor;',

    '#if($atmospheric_perspective_enabled)',
      'vec3 reflectDir = reflect(worldViewDir, normal);',
      'vec3 skyReflection = computeSkyRadiance(reflectDir);',

      '//Same Schlick split as water-shader.glsl L1329 (without the refracted +',
      '//specular + ambient terms — those need the full FFT light setup the skirt',
      '//does not have access to). Body weight = 1 - F, reflection weight = F.',
      'color = oceanBodyColor * (1.0 - fresnelFactor) + skyReflection * fresnelFactor;',

      'color = applyAtmosphericPerspective(color, vWorldPos);',
    '#endif',

      'gl_FragColor = vec4(color, 1.0);',
    '}',
    ];

    let updatedLines = [];
    for(let i = 0, numLines = originalGLSL.length; i < numLines; ++i){
      let updatedCode = originalGLSL[i];
      updatedCode = updatedCode.replace(/\$atmospheric_perspective_enabled/g, atmosphericPerspectiveEnabled ? '1' : '0');
      if(atmosphericPerspectiveEnabled && atmosphereFunctionsGLSL && updatedCode.indexOf('//ATMOSPHERE_FUNCTIONS_INJECTION_POINT') !== -1){
        updatedCode = atmosphereFunctionsGLSL;
      }
      updatedLines.push(updatedCode);
    }

    return updatedLines.join('\n');
  },

  vertexShader: [
    'precision highp float;',

    'varying vec3 vWorldPos;',

    'void main(){',
      'vec4 worldPos4 = modelMatrix * vec4(position, 1.0);',
      'vWorldPos = worldPos4.xyz;',
      'vec4 clipPos = projectionMatrix * viewMatrix * worldPos4;',
      "//Pin verts to (just inside) the far plane so the skirt's outer rim — which sits",
      '//tens of km past camera.far — survives near/far frustum clipping. The fragment',
      '//still depthTest:false-overwrites the sky dome and is overwritten by the FFT',
      "//ocean (renderOrder:2), so the post-clamp z value doesn't matter for ordering.",
      'clipPos.z = clipPos.w * 0.999;',
      'gl_Position = clipPos;',
    '}',
  ].join('\n'),
};

//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
ARestlessOcean.Materials.Ocean.splashMaterial = {
  uniforms: {
    //Vertex stage
    uViewportHeight: {value: 1080.0},
    uMaxPointSize: {value: 512.0},
    uSizeScale: {value: 5.0},
    uWind: {value: new THREE.Vector2(0.0, 0.0)},
    sunColor: {value: new THREE.Color(1.0, 1.0, 1.0)},
    skyAmbientColor: {value: new THREE.Color(0.3, 0.4, 0.5)},
    uSunScale: {value: 0.8},
    uAmbientScale: {value: 1.0},
    sunDir: {value: new THREE.Vector3(0.0, 1.0, 0.0)},
    uSunElevation: {value: 1.0},
    uWaterBounce: {value: 0.6},
    uNightAmbient: {value: 0.07},
    uPhaseG: {value: 0.85},
    uPhaseGain: {value: 0.6},
    sunShadowMatrix: {value: new THREE.Matrix4()},
    sunShadowMap: {value: null},
    sunShadowMapSize: {value: new THREE.Vector2(2048.0, 2048.0)},
    sunShadowRadius: {value: 1.0},
    sunShadowBias: {value: 0.0},
    sunShadowEnabled: {value: 0},

    //Fragment stage
    splashSprite: {value: null},
    uLinearDepth: {value: null},
    uResolution: {value: new THREE.Vector2(1920.0, 1080.0)},
    uSoftRange: {value: 1.5},
    uOpacity: {value: 0.55},
    uDebugMode: {value: 0},
    uNoiseScale: {value: 2.5},
    uErode: {value: 0.35},
    uSoftEdge: {value: 0.25},
    uNoiseEvolve: {value: 0.6},
    uOpacityCoarse: {value: 0.95},
    uErodeCoarse: {value: 0.06},
    uSparkle: {value: 1.2},
    uDropletCells: {value: 6.0},
    uDropletRadius: {value: 1.0},
    uDropletSpread: {value: 3.0},
    uAbsorb: {value: 1.2},
    meteringSurveyTexture: {value: null},
    uHasSkyTex: {value: 0},
    uTime: {value: 0.0},
    uWobbleFreq: {value: 8.0},
    uWobbleAmp: {value: 0.18},
    uHarmonic: {value: 0.14},
    uSizeFalloff: {value: 5.0},
    uSkyBoost: {value: 3.0},
    uWindNoiseSpeed: {value: 0.4},
    uMistWindMin: {value: 7.0},
    uMistWindMax: {value: 15.0},
    uFoamMix: {value: 0.85},
    uFoamOpacity: {value: 0.9},
    uFoamAlbedo: {value: 1.2},
    uFoamSkyFill: {value: 1.2},
    uFoamCalmFade: {value: 0.5},
    uDropTopSize: {value: 0.34},
    uWindBreakup: {value: 1.5},
  },

  fragmentShader: [
    'precision highp float;',

    '//Ocean splash particle fragment stage (THREE.Points, GLSL1).',
    '//',
    '//Each point is a camera-facing sprite quad (gl_PointCoord spans 0..1). We',
    '//composite a supplied spray sprite, fade it in/out over the particle lifetime,',
    '//and soft-fade it against scene geometry using the refraction G-buffer linear',
    '//depth so droplets sink into terrain and hulls instead of hard-clipping.',

    'uniform sampler2D splashSprite;   //retained for compatibility, now unused (shape is procedural)',
    'uniform sampler2D uLinearDepth;   //G-buffer attachment 2: positive view-Z, a=hasGeom',
    'uniform vec2 uResolution;         //G-buffer / drawing-buffer size in pixels',
    'uniform float uSoftRange;         //metres over which we soft-fade into geometry',
    'uniform float uOpacity;           //global artistic opacity (FUDGE)',
    'uniform int uDebugMode;           //0 = normal, 1 = tint by emitter type',
    'uniform float uNoiseScale;        //3D noise frequency across the droplet',
    'uniform float uErode;             //silhouette erosion threshold (higher = grainier)',
    'uniform float uSoftEdge;          //erosion smoothstep width (lower = sharper, sparklier)',
    'uniform float uNoiseEvolve;       //noise dissolve rate over the particle life',
    'uniform float uOpacityCoarse;     //peak opacity at coarse=1 (droplets are dense/bright)',
    'uniform float uErodeCoarse;       //erosion threshold at coarse=1 (near 0 = coherent blob)',
    'uniform float uSparkle;           //sun-specular strength on the SDF water beads',
    'uniform float uDropletCells;      //droplet cluster: grid cells across the billboard',
    'uniform float uDropletRadius;     //droplet cluster: individual drop size scale',
    'uniform float uDropletSpread;     //droplet cluster: gaussian tightness (higher = tighter)',
    'uniform float uAbsorb;            //droplet body absorption (water tint, not soap bubble)',
    'uniform sampler2D meteringSurveyTexture; //a-starry-sky fisheye sky (worldXZ->UV) for rim reflection',
    'uniform int uHasSkyTex;           //1 = meteringSurveyTexture is bound this frame',
    'uniform float uTime;              //seconds, drives the droplet wobble animation',
    'uniform float uWobbleFreq;        //droplet wobble frequency (rad/s)',
    'uniform float uWobbleAmp;         //droplet aspect-breathe amplitude (jitters the a/b ratio)',
    'uniform float uHarmonic;          //droplet spherical-harmonic surface-wobble amplitude',
    'uniform float uSizeFalloff;       //cluster size distribution exponent (higher = big drops rarer)',
    'uniform float uSkyBoost;          //brightness lift on the drop sky-reflection (rim reads as sky)',
    'uniform float uWindNoiseSpeed;    //rate the haze noise scrolls along the wind (wisps blow past)',
    'uniform vec3 sunDir;              //world-space direction TO the BRIGHTEST light (sun by day, MOON by',
                                      '//night) — drives forward-scatter geometry, NOT the day/night gate',
    'uniform float uSunElevation;      //sin(true SOLAR elevation). Gates the daytime sky lifts so a high',
                                      '//MOON (which becomes the brightest light at night) never switches on',
                                      '//the blue day-fill — that was the night mist-glow bug.',
    'uniform float uWaterBounce;       //strength of the LIGHT-FROM-BELOW term (sunlit water bouncing its',
                                      '//colour up onto the spray underside; the other half of the ambient)',
    'uniform float uNightAmbient;      //floor the ambient (both hemisphere halves) drops to at deep night.',
                                      '//White foam over a black sea reads as a GLOW under any ambient, so',
                                      '//the sky+water fill must dim to ~this fraction once the sun is down.',
    'uniform vec2 uWind;               //wind velocity (m/s); its LENGTH gates the misty haze look',
    'uniform float uMistWindMin;       //m/s wind below which spray stays beaded droplets (no haze)',
    'uniform float uMistWindMax;       //m/s wind at/above which the haze (mist) look is fully present',
    'uniform float uFoamMix;           //0 = clear glassy beads (bubble look), 1 = opaque aerated FOAM',
    'uniform float uFoamOpacity;       //body alpha of a foam bead (aerated water is near-opaque)',
    'uniform float uFoamAlbedo;        //brightness of the foam body (white aerated water; ~1+)',
    'uniform float uFoamSkyFill;       //brightness of the blue daytime sky-bounce added to foam ambient',
                                      '//(lifts shadow-side foam off charcoal; day-gated so night is dark)',
    'uniform float uFoamCalmFade;      //0..1 how much CALM seas thin the foam (0 = constant, 1 = gone)',
    'uniform float uDropTopSize;       //cell-local radius of the LARGEST cluster drop (size variety)',
    'uniform float uWindBreakup;       //how hard rising wind shreds big drops into fine spray (0 = off)',

    "//Scene sun shadow receive (same map + params as the water shader's sunShadow*).",
    'uniform sampler2D sunShadowMap;   //THREE directional-light depth shadow map',
    'uniform vec2 sunShadowMapSize;    //shadow map resolution in texels',
    'uniform float sunShadowRadius;    //PCF tap spread (light.shadow.radius)',
    'uniform float sunShadowBias;      //depth bias (light.shadow.bias + console offset)',
    'uniform int sunShadowEnabled;     //0 = no shadow map this frame',

    'varying float vAge01;',
    'varying float vSeed;',
    'varying float vType;',
    'varying float vCoarse;',
    'varying vec3 vToCamW;       //world-space direction from the particle to the camera',
    'varying vec2 vWindDir;      //view-space (billboard-plane) wind direction, drives the noise scroll',
    'varying float vViewZ;',
    'varying vec3 vAmbient;      //smooth sky-ambient term',
    'varying vec3 vSunCol;       //sun colour * scale, wrapped over the synthesized normal',
    'varying float vGlow;        //forward-scatter additive (backlit through-glow)',
    'varying vec3 vSunDirView;   //view-space direction TO the sun',
    'varying vec4 vSunShadowCoord;',

    '//This is a raw ShaderMaterial, so (unlike THREE built-ins) no tonemap or output',
    '//color-space conversion is applied for us. The water surface self-applies the',
    '//same pair, and we blend over its already-sRGB-encoded pixels, so we must match',
    '//or the spray reads too dark on the shadow side and clips harshly on the lit one.',
    'vec3 acesTonemap(vec3 x){',
      'const float a = 2.51; const float b = 0.03;',
      'const float c = 2.43; const float d = 0.59; const float e = 0.14;',
      'return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);',
    '}',
    'vec3 linearToSrgb(vec3 c){ return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }',

    '//Compact 3D value noise (iq-style integer hash + trilinear smoothstep interp). Cheap',
    '//enough to run per-fragment on hundreds of sprites; quality is fine for soft mist.',
    'float hash3(vec3 p){',
      'p = fract(p * 0.3183099 + 0.1);',
      'p *= 17.0;',
      'return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
    '}',
    'float vnoise3(vec3 x){',
      'vec3 i = floor(x);',
      'vec3 f = fract(x);',
      'f = f * f * (3.0 - 2.0 * f);',
      'return mix(mix(mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), f.x),',
                     'mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),',
                 'mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x),',
                     'mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);',
    '}',
    '//Three-octave fractal sum -> billowy cloud-style field in roughly [0,1].',
    'float fbm3(vec3 p){',
      'float a = 0.5;',
      'float s = 0.0;',
      'for(int i = 0; i < 3; i++){',
        's += a * vnoise3(p);',
        'p *= 2.0;',
        'a *= 0.5;',
      '}',
      'return s;',
    '}',

    '//Core water-drop primitive: an oriented, volume-conserving, harmonic-wobbling spheroid at a',
    '//local billboard offset p (centred-quad pc space, y-DOWN), rest radius rad, stretched by `aspect`',
    '//(a/b) along axA, with surface-wobble amplitude wobAmp. The Wolfram aspect-breathe (uWobbleAmp)',
    '//and the spherical-harmonic surface ripple (modes 2-4, bubble_builder style) both ride uTime.',
    '//Writes a VIEW-space normal (y flipped UP, so the sun glint sits on top) plus the camera-ward',
    '//height to outZ; returns soft silhouette coverage. Used by the small-drop cluster.',
    'float wobbleDrop(vec2 p, float rad, vec2 axA, vec2 axP, float aspect, float wobAmp,',
                     'float pseed, out vec3 outN, out float outZ){',
      'outN = vec3(0.0, 0.0, 1.0);',
      'outZ = 0.0;',
      'float breathe = 1.0 + uWobbleAmp * sin(uWobbleFreq * uTime + pseed * 6.2831853);',
      'float A = max(0.35, aspect * breathe);',
      'float a = rad * pow(A, 0.6666667);                //long semi-axis along axA (a*b^2 = rad^3)',
      'float b = rad * pow(A, -0.3333333);               //short semi-axes (perpendicular + to camera)',
      'float al = dot(p, axA);',
      'float pe = dot(p, axP);',
      'float u = al / a;',
      'float v = pe / b;',
      'float rho = sqrt(u * u + v * v);                  //1 at the unperturbed edge',
      'float theta = atan(v, u);',
      'float W = 0.0;',
      'float dW = 0.0;',
      'for(int k = 0; k < 3; k++){',
        'float m = float(k) + 2.0;                       //modes 2, 3, 4',
        'float ph = uWobbleFreq * uTime * (0.7 + 0.3 * float(k)) + pseed * 6.2831853 * (float(k) + 1.0);',
        'float amp = wobAmp * (0.6 / m);                 //taper the higher modes',
        'W  += amp * sin(m * theta + ph);',
        'dW += amp * m * cos(m * theta + ph);',
      '}',
      'float edge = 1.0 + W;                             //wobbly boundary radius',
      'if(rho > edge) return 0.0;',
      'outZ = b * sqrt(max(0.0, edge * edge - rho * rho));',
      '//Surface normal: radial ellipsoid gradient tilted tangentially by the harmonic slope. Flip y:',
      '//p is y-DOWN gl_PointCoord space, lighting wants a y-UP view normal (glint on top, not bottom).',
      'vec2 tang = vec2(-sin(theta), cos(theta));',
      'vec2 nUV = vec2(u, v) - tang * dW;',
      'vec2 nxy = axA * (nUV.x / a) + axP * (nUV.y / b);',
      'outN = normalize(vec3(nxy.x, -nxy.y, outZ / (b * b)));',
      'return smoothstep(1.0, 0.8, rho / edge);          //soft wobbly silhouette',
    '}',

    '//Cluster of small SDF water droplets inside one billboard. Tiles the sprite into a grid; each',
    '//cell may host one wobbling drop, gaussian-culled toward the centre so the whole reads as a soft',
    '//puff of finite drops. Each drop now wobbles (less for the smaller ones — surface tension holds',
    '//them rigid). Writes the hit droplet view-space normal to outN; returns soft coverage.',
    'float dropletCluster(vec2 uv, float seed, out vec3 outN){',
      'outN = vec3(0.0, 0.0, 1.0);',
      'vec2 g = uv * uDropletCells;',
      'vec2 cell = floor(g);',
      'float r0 = hash3(vec3(cell, seed));',
      'float r1 = hash3(vec3(cell.yx, seed + 9.0));',
      '//Gaussian presence: cells near the billboard centre almost always carry a drop; outer',
      '//cells are progressively culled, so the cluster tapers to a soft round puff of drops.',
      'vec2 cc = (cell + 0.5) / uDropletCells - 0.5;     //cell centre in [-0.5, 0.5]',
      'float gauss = exp(-dot(cc, cc) * 4.0 * uDropletSpread);',
      'if(r0 > gauss) return 0.0;',
      'vec2 jit = (vec2(r0, r1) - 0.5) * 0.35;           //keep the drop inside its cell',
      '//Exponential size falloff: raising r1 to uSizeFalloff makes MOST drops tiny and large ones',
      '//increasingly rare (the bubble-breakup distribution). Higher uSizeFalloff = fewer big drops.',
      '//Wind SHREDS chunks: a building sea breaks big drops into fine spray, so as wind rises we bias',
      '//the size distribution smaller (steeper falloff) AND cap the top size down. Calm seas keep the',
      '//rare large chunks; storms are nearly all fine grains. (uWindBreakup dials the strength.)',
      'float wE = smoothstep(2.0, 10.0, length(uWind));',
      'float fall = uSizeFalloff * (1.0 + uWindBreakup * wE);',
      'float radMin = 0.04;',
      'float radMax = uDropTopSize / (1.0 + uWindBreakup * wE * 0.5); //smaller tops at high wind',
      'float rad = mix(radMin, radMax, pow(r1, fall)) * uDropletRadius;   //cell-local units',
      '//Map the cell-local drop into the centred billboard (pc, -1..1) frame for wobbleDrop.',
      'vec2 centerPc = ((cell + 0.5 + jit) / uDropletCells) * 2.0 - 1.0;',
      'vec2 pc = uv * 2.0 - 1.0;',
      'float radPc = rad * 2.0 / uDropletCells;',
      '//Smaller drops wobble LESS (surface tension holds them spherical); larger members jiggle more.',
      'float wobAmp = uHarmonic * clamp(rad / (radMax * uDropletRadius), 0.2, 1.0);',
      'float pseed = seed + cell.x * 1.7 + cell.y * 3.1;',
      'float zc;',
      'return wobbleDrop(pc - centerPc, radPc, vec2(1.0, 0.0), vec2(0.0, 1.0), 1.0, wobAmp, pseed, outN, zc);',
    '}',

    '//Sky reflection colour for a view-space drop normal. The water surface reflects the sky via the',
    '//atmospheric LUT (computeSkyRadiance), which the splash shader does not have; the metering-survey',
    '//fisheye it CAN reach is dim/low-res, so a drop sampling it alone read as a dark-rimmed bubble.',
    '//Instead we synthesize a reliable BRIGHT sky: a vertical gradient anchored to the scene ambient',
    '//(so it tracks time of day) and lifted by uSkyBoost so the Fresnel rim reads as real reflected',
    '//sky, then blend in the fisheye for directional detail when it is actually bound.',
    'vec3 skyReflect(vec3 viewN){',
      'vec3 worldN = normalize(viewN * mat3(viewMatrix));   //view->world (orthonormal transpose)',
      'vec3 reflectDir = reflect(-normalize(vToCamW), worldN);',
      'float up = clamp(reflectDir.y * 0.5 + 0.5, 0.0, 1.0); //horizon (0) .. zenith (1)',
      'vec3 sky = vAmbient * uSkyBoost * mix(0.8, 1.6, up);  //brighter, bluer toward the zenith',
      'if(uHasSkyTex == 1){',
        'vec2 skyUV = clamp(reflectDir.xz * 0.5 + 0.5, 0.01, 0.99);',
        'sky = mix(sky, texture2D(meteringSurveyTexture, skyUV).rgb * uSkyBoost, 0.4);',
      '}',
      'return sky;',
    '}',

    '//═══ UNIFIED aerated-water shading ═══════════════════════════════════════════════════════════',
    '//Mist and foam are ONE material — air-laden water — at different optical densities, so they share',
    '//ONE lighting model (no more two drifting paths). `N` = view-space normal (y-up). `aer` = foaminess',
    '//0..1: thin translucent MIST (light passes, forward-scatters into the warm sun glow) -> dense',
    '//opaque FOAM (multiple-scattered bright white with a real lit/shadow form). `dGlint` = wet sun',
    '//sparkle for the bead tier (0 for the mist puff).',
    'vec3 aeratedWater(vec3 N, float aer, float sunShadow, float dGlint){',
      'float wrap = clamp(dot(N, vSunDirView) * 0.5 + 0.5, 0.0, 1.0); //form: bright sun side -> dark back',
      'float glow = vGlow * (1.0 - 0.8 * aer);                        //forward-scatter glow: mist >> foam',
      '//Daytime sky irradiance on foam must DIE as the sun nears the horizon, or its (cold blue) lift',
      '//pops vividly against the warm/dark dusk water. Steeper gate => a MIDDAY lift only, gone by sunset;',
      '//dusk/night then fall back to the plain (correctly dark) hemisphere base. Gate on the TRUE solar',
      '//elevation, not sunDir.y — sunDir is the brightest light, which is the MOON at night (a high moon',
      '//would otherwise read as daytime and switch the blue fill back on => night mist glow).',
      'float dayF = smoothstep(0.04, 0.22, uSunElevation);',
      '//Ambient FILL kept MODEST relative to the sun term below, or the lit/shadow FORM washes out (the',
      '//old flat flood is exactly what erased the shadow side). Dim a-starry-sky hemisphere base (tracks',
      '//time of day) + an explicit blue sky-dome bounce so SHADOW-side spray reads blue, not charcoal.',
      '//BOTH lifts are now day-gated: brightness is ~log(energy), so a day-scaled boost reads even where',
      '//an un-gated add popped at the dark end. Night/dusk foam sits at the plain vAmbient base.',
      'vec3 ambient = vAmbient * mix(1.0, uFoamAlbedo, aer * dayF)',
                   '+ vec3(0.45, 0.62, 0.92) * (uFoamSkyFill * dayF * aer);',
      '//LIGHT FROM BELOW — the other half of the ambient. Sky lights the top; the bright sunlit water',
      "//bounces its own (teal) colour up onto the spray's UNDERSIDE. Without it the down/shadow side has",
      '//only the dim sky hemisphere and reads charcoal. downFace = how much this normal faces the water;',
      '//driven by the sun+sky energy (so it tracks time of day) and day-gated so night stays dark.',
      'vec3 worldN = normalize(N * mat3(viewMatrix));',
      'float downFace = clamp(-worldN.y * 0.5 + 0.5, 0.0, 1.0);',
      'vec3 waterBounce = vec3(0.16, 0.34, 0.40) * (vSunCol * 0.6 + vAmbient)',
                       '* (uWaterBounce * dayF * downFace * mix(0.6, 1.0, aer));',
      '//Body colour: cool translucent water (mist) -> bright near-white aerated foam.',
      'vec3 body = mix(vec3(0.60, 0.74, 0.95), vec3(1.0), aer);',
      '//Direct sun: half-Lambert WRAP supplies the form (sun side bright, anti-sun side falls to the',
      '//blue ambient = the shadow side). Glow (mist) + glint (beads) ride on top. Scene shadow gates it.',
      'vec3 direct = vSunCol * (wrap * mix(0.8, 1.1, aer) + glow) * sunShadow + vSunCol * dGlint;',
      '//AMBIENT day/night: white foam over a black sea glows under ANY ambient, so the whole hemisphere',
      '//fill (sky top + water bottom) must dim to a low floor once the sun sets. Wider window than dayF so',
      '//twilight keeps a real ambient while the blue day-fill is already gone. DIRECT (moon) is left alone',
      '//so a present moon still lights the spray — what was glowing here was the un-dimmed sky ambient.',
      'float nightDim = mix(uNightAmbient, 1.0, smoothstep(-0.08, 0.06, uSunElevation));',
      'return (ambient * body + waterBounce) * nightDim + direct;',
    '}',

    '//Scene sun shadow: 3x3 PCF on the directional-light depth map. A derivative-free',
    '//cut of the water shader getSunShadow (no dFdx slope bias) so it stays GLSL1-safe;',
    '//soft spray does not need acne suppression. Returns 1 = lit, 0 = fully shadowed.',
    'float getSplashSunShadow(){',
      'if(sunShadowEnabled == 0) return 1.0;',
      'vec3 sc = vSunShadowCoord.xyz / vSunShadowCoord.w;',
      'if(sc.z > 1.0 || sc.z < 0.0) return 1.0;',
      'vec2 edgeDist = min(sc.xy, vec2(1.0) - sc.xy);',
      'float edge = min(edgeDist.x, edgeDist.y);',
      'if(edge < 0.0) return 1.0;',
      'float refZ = sc.z + sunShadowBias;',
      'vec2 texelSize = (1.0 / sunShadowMapSize) * sunShadowRadius;',
      'float shadow = 0.0;',
      'for(int x = -1; x <= 1; x++){',
        'for(int y = -1; y <= 1; y++){',
          'float d = texture2D(sunShadowMap, sc.xy + vec2(float(x), float(y)) * texelSize).r;',
          'shadow += refZ < d ? 1.0 : 0.0;',
        '}',
      '}',
      'shadow *= (1.0 / 9.0);',
      '//Fade toward lit over the outer 5% of the frustum so the boundary is not a hard line.',
      'float fade = smoothstep(0.0, 0.05, edge);',
      'return mix(1.0, shadow, fade);',
    '}',

    'void main(){',
      '//Procedural mist droplet: a soft sphere whose silhouette is eroded by 3D noise so',
      '//each billboard reads as a rough-edged, cloud-like puff rather than a flat disc.',
      'vec2 pc = (gl_PointCoord - 0.5) * 2.0;   //-1..1 across the quad',
      'float r = length(pc);                    //0 at centre .. ~1.41 at the corner',
      '//Reconstruct a hemisphere height so the noise wraps over a 3D surface (a fake',
      '//volume cue) instead of lying flat on the disc.',
      'float z = sqrt(max(0.0, 1.0 - r * r));',
      'vec3 spherePos = vec3(pc, z);',
      '//Per-particle offset (vSeed) makes every billboard unique; advancing along Z by vAge01 evolves',
      '//the field so the puff dissolves as it ages. The noise MUST stay anchored to a view-stable frame:',
      '//the old scroll added vWindDir (the wind projected into the billboard plane), which ROTATES with',
      "//the camera, so a static particle's pattern crawled when you turned/moved — the shimmer. Advance",
      '//the field along its own evolve (Z) axis by uTime instead: the wisps still morph/flow over time,',
      '//but with no view-dependent term the puff looks identical from every angle. The bulk wind motion',
      '//still reads — the CPU sim already pushes each particle along the wind.',
      'float windAdvance = uTime * uWindNoiseSpeed;',
      'vec3 nCoord = spherePos * uNoiseScale',
                  '+ vec3(vSeed * 51.3, vSeed * 17.7, vAge01 * uNoiseEvolve + windAdvance);',
      'float n = fbm3(nCoord);                  //~0..1',

      '//── ONE MATERIAL: aerated water across a mist<->foam continuum ─────────────────────────────',
      '//`aer` (foaminess 0..1) needs BOTH a coarse/chunky particle AND an energetic sea, so LIGHT waves',
      '//stay sparse translucent droplets and only a building sea whips up dense opaque foam. uFoamMix is',
      '//the global foaminess master. windE is the shared wave-energy term (also fades + shreds size).',
      'float windE = smoothstep(2.0, 10.0, length(uWind));',
      'float aer = clamp(vCoarse * windE * uFoamMix, 0.0, 1.0);',

      '//GEOMETRY select: fine spray becomes a noise-eroded PUFF only when strong wind shreds it',
      '//(windMist); otherwise spray is resolved DROPLETS (a bead cluster). Lighting is unified below.',
      'float windMist = smoothstep(uMistWindMin, uMistWindMax, length(uWind));',
      'float beadMix = mix(1.0, smoothstep(0.4, 0.65, vCoarse), windMist);',

      '//Mist PUFF silhouette (noise-eroded soft sphere) — used when beadMix is low.',
      'float corePow = mix(2.0, 4.0, vCoarse);',
      'float erode = mix(uErode, uErodeCoarse, vCoarse);',
      'float core = pow(clamp(1.0 - r, 0.0, 1.0), corePow);',
      'float carve = smoothstep(erode, erode + uSoftEdge, n);',
      'float hazeDensity = core * carve;',

      'vec3 Hh = normalize(vSunDirView + vec3(0.0, 0.0, 1.0));//half-vector to the sun',
      'float sunShadow = getSplashSunShadow();',

      '//Bead CLUSTER silhouette + normal — used when beadMix is high. Translucent droplets (mist end)',
      '//keep a faint wet-glass sky-Fresnel rim; dense foam suppresses it (rim scaled by 1-aer).',
      'float dropCov = 0.0;',
      'vec3 dropN = vec3(0.0, 0.0, 1.0);',
      'float dGlint = 0.0;',
      'vec3 rim = vec3(0.0);',
      'if(beadMix > 0.001){',
        'dropCov = dropletCluster(gl_PointCoord, vSeed, dropN);',
        'dGlint = pow(max(0.0, dot(dropN, Hh)), 80.0) * uSparkle * sunShadow;',
        'float fres = pow(1.0 - clamp(dropN.z, 0.0, 1.0), 3.0);',
        'rim = skyReflect(dropN) * (fres * (1.0 - aer) * 1.2);',
      '}',

      '//ONE lighting model lights BOTH the mist puff (Nhaze) and the foam beads (dropN), so they share',
      '//the sun colour + form and never drift apart again. The mist puff Z-biases its normal off a',
      '//harsh terminator; the rim rides only the bead path.',
      'vec3 Nhaze = normalize(vec3(pc.x, -pc.y, z + 0.3)); //negate y: gl_PointCoord is y-down',
      'vec3 litHaze = aeratedWater(Nhaze, aer, sunShadow, 0.0);',
      'vec3 litDrop = aeratedWater(dropN, aer, sunShadow, dGlint) + rim;',
      'vec3 lit = mix(litHaze, litDrop, beadMix);',

      '//COVERAGE (silhouette) and OPACITY (translucent mist -> opaque foam) are separate: the aeration',
      '//axis drives opacity so light waves read see-through and storm foam reads solid. Calmer seas thin',
      '//the whole thing (foamWind), matching the size break-up in the cluster.',
      'float density = mix(hazeDensity, dropCov, beadMix);',
      'float foamWind = mix(1.0 - uFoamCalmFade, 1.0, windE);',
      'float opacity = mix(uOpacity, uFoamOpacity, aer) * foamWind;',

      '//Lifetime fade: a quick rise then a long ease-out, like real spray thinning.',
      'float fadeIn = smoothstep(0.0, 0.15, vAge01);',
      'float fadeOut = 1.0 - smoothstep(0.55, 1.0, vAge01);',
      'float ageAlpha = fadeIn * fadeOut;',

      '//Soft-particle fade. Sample scene depth under this fragment. .a marks where solid',
      '//geometry was written; over open water / sky it is 0 and we must NOT fade (otherwise',
      '//spray over the open sea vanishes against the cleared buffer).',
      'vec2 screenUV = gl_FragCoord.xy / uResolution;',
      'vec4 depthSample = texture2D(uLinearDepth, screenUV);',
      'float sceneZ = depthSample.r;',
      'float hasGeom = depthSample.a;',
      'float softFade = 1.0;',
      'if(hasGeom > 0.5){',
        'softFade = clamp((sceneZ - vViewZ) / max(0.001, uSoftRange), 0.0, 1.0);',
      '}',

      'float alpha = density * ageAlpha * softFade * opacity;',
      'vec3 color = linearToSrgb(acesTonemap(lit));',

      'if(uDebugMode == 1){',
        '//Crest mist = red, impact burst = magenta; procedural density kept as the alpha.',
        'vec3 tint = mix(vec3(1.0, 0.1, 0.1), vec3(1.0, 0.2, 0.8), step(0.5, vType));',
        'color = tint;',
        'alpha = density * ageAlpha;',
      '} else if(uDebugMode == 2){',
        '//Coarseness ramp: deep blue = fine mist, white = coarse droplet. Lets the emission',
        '//bands (crest/impact Coarse Min/Max) be eyeballed directly on screen while tuning.',
        'color = mix(vec3(0.1, 0.2, 0.9), vec3(1.0, 1.0, 1.0), vCoarse);',
        'alpha = density * ageAlpha;',
      '}',

      'if(alpha < 0.01) discard;',
      'gl_FragColor = vec4(color, alpha);',
    '}',
  ].join('\n'),

  vertexShader: [
    'precision highp float;',

    '//Ocean splash particle vertex stage (THREE.Points, GLSL1).',
    '//',
    '//The Points mesh lives at the world origin with an identity model matrix, so',
    '//the per-particle `position` attribute already holds a WORLD-space point and',
    '//modelViewMatrix collapses to the plain view matrix. CPU sim writes position,',
    '//age and size every frame; spawn-time constants (seed, type) ride along in',
    '//their own attributes and are only refreshed when a slot is recycled.',

    'attribute float aSize;     //world-space radius of this droplet (metres)',
    'attribute float aAge01;    //age / lifetime, 0 at birth .. 1 at death',
    'attribute float aSeed;     //per-particle random in [0,1] for shader variety',
    'attribute float aType;     //0 = open-water crest mist, 1 = impact burst',
    'attribute float aCoarse;   //0 = fine hanging mist .. 1 = coherent falling droplet',

    'uniform float uViewportHeight; //renderer drawing-buffer height in pixels',
    'uniform float uMaxPointSize;   //hardware-safe clamp for gl_PointSize',
    'uniform float uSizeScale;      //size multiplier for the mist puff + the small-drop cluster',
    'uniform vec2 uWind;            //world-space wind (x, z); projected into the billboard plane below',

    '//Lighting is per-particle (vertex) rather than per-fragment: spray is a bright',
    '//omnidirectional scatterer with no meaningful surface normal, so a single',
    '//ambient + sun term is both cheaper and visually sufficient.',
    'uniform vec3 sunColor;         //brightest directional light colour * intensity',
    'uniform vec3 skyAmbientColor;  //a-starry-sky y-hemisphere ambient',
    'uniform float uSunScale;       //artistic sun contribution (FUDGE)',
    'uniform float uAmbientScale;   //artistic ambient contribution (FUDGE)',

    '//Forward-scatter (Mie) phase. Spray droplets scatter overwhelmingly forward, so the',
    '//mist blooms when you look THROUGH it toward the sun. uSunDir is the world-space',
    '//direction TO the sun; uPhaseG is the forward-lobe tightness; uPhaseGain dials how',
    '//strongly the halo brightens the sun term.',
    'uniform vec3 sunDir;           //world-space direction TO the sun (normalised)',
    'uniform float uPhaseG;         //forward lobe asymmetry g in [0,1)',
    'uniform float uPhaseGain;      //forward-scatter halo strength (FUDGE)',

    '//Scene sun shadow receive. Same matrix the water shader uses (THREE directional',
    '//light shadow.matrix): maps world -> shadow-map UV+depth. position is already',
    '//world-space (identity model), so this matches the water surface exactly.',
    'uniform mat4 sunShadowMatrix;',

    'varying float vAge01;',
    'varying float vSeed;',
    'varying float vType;',
    'varying float vCoarse;         //fine-mist..droplet grade, drives the fragment look',
    'varying float vViewZ;          //positive view-space depth, matches G-buffer',
    'varying vec3 vAmbient;         //smooth sky-ambient term (unshadowed)',
    'varying vec3 vSunCol;          //sun colour * scale; the fragment wraps it over a normal',
    'varying float vGlow;           //forward-scatter additive (backlit through-glow)',
    'varying vec3 vSunDirView;      //view-space direction TO the sun, for the wrap normal',
    'varying vec4 vSunShadowCoord;  //world position in scene-sun shadow space',
    'varying vec3 vToCamW;          //world-space direction from the particle to the camera',
    'varying vec2 vWindDir;         //view-space (billboard-plane) wind direction for the noise scroll',

    '//Henyey-Greenstein single-lobe phase. g>0 biases scattering forward (toward sun).',
    'float hgPhase(float cosT, float g){',
      'float g2 = g * g;',
      'return (1.0 / (4.0 * 3.14159265)) * (1.0 - g2) / pow(max(1e-4, 1.0 + g2 - 2.0 * g * cosT), 1.5);',
    '}',
    '//Dual-lobe blend: a strong forward lobe (gF) plus a weak wide/back lobe. This is the',
    '//practical minimum that reads as spray Mie scattering rather than a flat sprite.',
    'float dualPhase(float cosT, float gF){',
      'const float gB = -0.2;',
      'const float w = 0.15;',
      'return mix(hgPhase(cosT, gF), hgPhase(cosT, gB), w);',
    '}',

    'void main(){',
      'vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
      'vViewZ = -mvPosition.z;',

      '//Perspective size attenuation: a droplet of world radius aSize subtends',
      '//(aSize * focalLengthPixels / distance) pixels. projectionMatrix[1][1] is',
      '//the vertical focal length in clip units, so 0.5 * viewportHeight * that',
      '//converts a world radius at unit distance into pixels.',
      'float focalPx = 0.5 * uViewportHeight * projectionMatrix[1][1];',
      '//The mist puff and the small-drop cluster share one billboard size; the cluster needs the',
      '//room for its many tiny drops, so we keep the full uSizeScale multiplier for every particle.',
      'float pointPx = aSize * uSizeScale * focalPx / max(0.001, vViewZ);',
      'gl_PointSize = clamp(pointPx, 1.0, uMaxPointSize);',

      'vAge01 = aAge01;',
      'vSeed = aSeed;',
      'vType = aType;',
      'vCoarse = aCoarse;',

      '//Forward-scatter cosine. position is world-space (identity model matrix), so the',
      '//camera ray travels camera -> particle, i.e. -toCam; it then continues toward the',
      '//sun (sunDir). cosT peaks at +1 when looking through the mist toward the sun.',
      'vec3 toCam = normalize(cameraPosition - position);',
      'vToCamW = toCam;',
      'float cosT = dot(-toCam, sunDir);',
      'float phase = dualPhase(cosT, uPhaseG);',

      '//Split the lighting so the fragment can SHAPE it: a smooth sky-ambient term, a sun',
      '//colour the fragment wraps over a synthesized spherical normal (sun-facing side',
      '//bright, far side -> ambient, so the puff reads as a 3D billow not flat steam), and',
      '//a view-dependent forward-scatter glow added ungated (the backlit bloom, which must',
      '//NOT be multiplied by the wrap or it would cancel the through-light). The ambient',
      '//term stays smooth and unshadowed (the Ghost of Tsushima Mie-vs-ambient split).',
      'vAmbient = skyAmbientColor * uAmbientScale;',
      'vSunCol = sunColor * uSunScale;',
      'vGlow = uPhaseGain * phase;',
      'vSunDirView = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);',
      'vSunShadowCoord = sunShadowMatrix * vec4(position, 1.0);',
      '//Wind direction in the billboard plane (view space), so the fragment can scroll the haze noise',
      '//along it. World wind is horizontal (uWind.x, 0, uWind.y); y is negated to match gl_PointCoord',
      "//y-down. Normalised to a pure direction — the scroll RATE is the fragment's uWindNoiseSpeed.",
      'vec3 windView = (viewMatrix * vec4(uWind.x, 0.0, uWind.y, 0.0)).xyz;',
      'vWindDir = (length(windView.xy) > 1e-4) ? normalize(vec2(windView.x, -windView.y)) : vec2(0.0, 0.0);',

      'gl_Position = projectionMatrix * mvPosition;',
    '}',
  ].join('\n'),
};

ARestlessOcean.LUTlibraries.OceanHeightBandLibrary = function(parentOceanGrid){
  let renderer = parentOceanGrid.renderer;
  let data = parentOceanGrid.data;

  //Linear filtering of float textures is core in WebGL2; only probe the
  //extension on WebGL1. The short-circuit order matters in three.js v173+,
  //where extensions.get() logs a console warning whenever the extension is
  //missing even if the result is then ignored.
  if(!renderer.capabilities.isWebGL2 && !renderer.extensions.get("OES_texture_float_linear")){
    console.error("No linear interpolation of OES textures allowed.");
    return false;
  }

  //Cascade configuration: 6 tiles at ×4 doubling, each carrying a 2-octave
  //wavelength slice [L/8, L/2]. Adopted from Crest's FFTSpectrum.compute
  //WAVE_SAMPLE_FACTOR pattern (Crest uses 16 cascades at ×2; we compress to
  //6 at ×4 since our shader-side arrays are hardcoded [6]).
  //
  //  c=0 L=4096  → λ ∈ [512, 2048] m  (long swell, no upper cap on largest)
  //  c=1 L=1024  → λ ∈ [128, 512]  m
  //  c=2 L=256   → λ ∈ [32,  128]  m
  //  c=3 L=64    → λ ∈ [8,   32]   m
  //  c=4 L=16    → λ ∈ [2,   8]    m
  //  c=5 L=4     → λ ∈ [0.5, 2]    m  (capillary chop, no lower cap on smallest)
  //
  //Contiguous: each cascade's upper bound = next cascade's lower bound.
  //
  //The point of the L/8..L/2 slice is that each tile contains only 2–8
  //wavelengths of its dominant chop, so the tile's repeat distance is many
  //times the dominant wavelength — no visible tiling artifacts. The narrow
  //spectral band concentrates the FFT's 256² bin budget into the wavelengths
  //we want at that scale, instead of dribbling it across the whole k^-4 tail
  //(which is what wasted cascade 5's content under the previous design and
  //caused the "flat goo up close" look).
  //
  //Dispersion (ω = √(g·k)) reads cascadePatchSizes as meters so wave period/
  //speed remain physical.
  this.cascadePatchSizes = [4096.0, 1024.0, 256.0, 64.0, 16.0, 4.0];
  //Per-cascade spectral band in centered-FFT coord units (maxCoord = max(|nx|, |ny|)).
  //WAVE_SAMPLE_LOW..HIGH defines the kept octaves; non-edge cascades cull both
  //ends, the largest cascade allows everything below its HIGH, and the
  //smallest cascade allows everything above its LOW (so the long-swell and
  //capillary tails aren't lost at the band edges).
  const WAVE_SAMPLE_LOW = 2.0;
  const WAVE_SAMPLE_HIGH = 8.0;
  this.numCascades = this.cascadePatchSizes.length;
  this.textureWidth = data.patch_data_size;
  this.textureHeight = data.patch_data_size;
  this.N = data.number_of_octaves;
  this.renderer = renderer;
  document.body.appendChild(renderer.domElement);

  //Wind and JONSWAP parameters (shared across cascades).
  //
  //Sanity check for the default config (wind {8,5} → U=9.43 m/s, fetch 100 km,
  //gamma 3.3, wave_scale_multiple 1.5):
  //  omega_p   ≈ 22 · (g² / (U·F))^(1/3)        ≈ 1.03 rad/s
  //  T_p       = 2π / omega_p                   ≈ 6.1 s
  //  λ_p       = g·T_p² / (2π)                  ≈ 58 m
  //  H_s (PM)  = 0.21 · U² / g                  ≈ 1.91 m
  //  H_s (J3.3) ≈ H_s_PM · gamma^0.3            ≈ 2.73 m
  //  H_s × 1.5 (artistic boost from data.wave_scale_multiple) ≈ 4.1 m
  //
  //So with default settings expect significant wave height around 4 m and a
  //dominant wavelength near 58 m.
  let windVelocity = new THREE.Vector2(data.wind_velocity.x, data.wind_velocity.y);
  this.w = windVelocity.clone().normalize();
  const g = 9.80665;
  let windSpeed = windVelocity.length();
  let fetch = data.jonswap_fetch || 100000.0;
  this.jonswapGamma = data.jonswap_gamma || 3.3;
  //ω_p, the peak angular frequency. The JONSWAP fetch formula 22·(g²/(U·F))^(1/3)
  //is calibrated for moderate-to-strong winds; at very low wind speeds it returns
  //unphysically low ω_p (e.g. U=1 m/s gives ω_p ≈ 2.17 → λ_p ≈ 13 m, but a 1 m/s
  //breeze can't actually produce 13-m waves regardless of fetch). Cap from below
  //with the full Pierson-Moskowitz rule ω_p = 0.86·g/U so the dominant wavelength
  //collapses with the wind at low speeds.
  this.omega_p = windSpeed > 0.001
    ? Math.max(22.0 * Math.pow(g * g / (windSpeed * fetch), 1.0 / 3.0), 0.86 * g / windSpeed)
    : 1000000.0;

  //Per-cascade slope variance σ², computed analytically from the same JONSWAP
  //integrand the GPU h_0 pass uses. The water shader uses this to rebuild the
  //"effective roughness" of distant water: as the renderer mips/aliases away
  //a cascade's slope detail, that cascade's σ² contributes to a Karis-style
  //horizon clamp on Fresnel. Without it, distant water collapses to a smooth
  //macroNormal (NaN slope variance at the pixel scale) → full-Schlick at
  //grazing → bright sky mirror to the horizon. See water-shader.glsl Fresnel
  //block. cascadeRMSSlope is in units of (slope)² — feed directly into α²_GGX
  //after multiplying by waveHeightMultiplier² (which the shader does).
  this.cascadeRMSSlope = ARestlessOcean.LUTlibraries.OceanHeightBandLibrary.computeCascadeSlopeVariance(
    this.cascadePatchSizes, this.N, this.omega_p, this.jonswapGamma,
    (data.directional_turbulence !== undefined) ? data.directional_turbulence : 0.145
  );

  //Shared twiddle texture (same N for all cascades)
  this.twiddleTexture = ARestlessOcean.Materials.FFTWaves.computeTwiddleIndices(this.N, renderer);

  //Make a shortcut to our materials namespace
  const materials = ARestlessOcean.Materials.FFTWaves;

  //A is a dimensionless multiplier on the JONSWAP h_0 coefficient. Physical
  //alpha (0.0081) is baked into the shader and gives the true variance, so
  //A=1.0 = strictly physical amplitudes. `wave_scale_multiple` (applied as
  //waveHeightMultiplier in the vertex shader) is the user-facing artistic
  //dial. Previous A=2.5 was a hidden 2.5× boost that doubled-up with
  //wave_scale_multiple — it dated to the pre-rescale era where the world
  //was 14× too big and physical amplitudes read too small on-screen.
  let maxWaveAmplitude = 1.0;

  //Per-cascade noise UV offsets for decorrelation (golden-ratio based)
  const noiseOffsets = [];
  const phi = (1.0 + Math.sqrt(5.0)) / 2.0;
  for(let c = 0; c < this.numCascades; c++){
    noiseOffsets.push(new THREE.Vector2(
      ((c * phi) % 1.0),
      ((c * phi * phi) % 1.0)
    ));
  }

  // ========================================================================
  // STATIC GPU COMPUTE: Noise textures (shared) + h0 per cascade
  // ========================================================================
  this.staticGPUComputer = new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer);
  let staticGPUCompute = this.staticGPUComputer;

  //Create 4 noise textures (shared across all cascades)
  let offset = this.textureWidth * this.textureHeight;
  this.noiseTexture1 = staticGPUCompute.createTexture();
  this.noiseVar1 = staticGPUCompute.addVariable('textureNoise1', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture1);
  this.noiseVar1.minFilter = THREE.ClosestFilter;
  this.noiseVar1.magFilter = THREE.ClosestFilter;
  staticGPUCompute.setVariableDependencies(this.noiseVar1, []);
  this.noiseVar1.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  this.noiseVar1.material.uniforms.offset.value = 1.0;

  this.noiseTexture2 = staticGPUCompute.createTexture();
  this.noiseVar2 = staticGPUCompute.addVariable('textureNoise2', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture2);
  staticGPUCompute.setVariableDependencies(this.noiseVar2, []);
  this.noiseVar2.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  this.noiseVar2.material.uniforms.offset.value = this.noiseVar1.material.uniforms.offset.value + offset;
  this.noiseVar2.minFilter = THREE.ClosestFilter;
  this.noiseVar2.magFilter = THREE.ClosestFilter;

  this.noiseTexture3 = staticGPUCompute.createTexture();
  this.noiseVar3 = staticGPUCompute.addVariable('textureNoise3', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture3);
  staticGPUCompute.setVariableDependencies(this.noiseVar3, []);
  this.noiseVar3.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  this.noiseVar3.material.uniforms.offset.value = this.noiseVar2.material.uniforms.offset.value + offset;
  this.noiseVar3.minFilter = THREE.ClosestFilter;
  this.noiseVar3.magFilter = THREE.ClosestFilter;

  this.noiseTexture4 = staticGPUCompute.createTexture();
  this.noiseVar4 = staticGPUCompute.addVariable('textureNoise4', materials.noiseShaderMaterialData.fragmentShader, this.noiseTexture4);
  staticGPUCompute.setVariableDependencies(this.noiseVar4, []);
  this.noiseVar4.material.uniforms = JSON.parse(JSON.stringify(materials.noiseShaderMaterialData.uniforms));
  this.noiseVar4.material.uniforms.offset.value = this.noiseVar3.material.uniforms.offset.value + offset;
  this.noiseVar4.minFilter = THREE.ClosestFilter;
  this.noiseVar4.magFilter = THREE.ClosestFilter;

  //Per-cascade coord-space band [sampleLow, sampleHigh) on max(|nx|,|ny|).
  //Largest cascade keeps everything below HIGH (no LOW cull → long-swell tail);
  //smallest cascade keeps everything above LOW (no HIGH cull → capillary tail).
  this.cascadeSampleLow = [];
  this.cascadeSampleHigh = [];
  for(let c = 0; c < this.numCascades; c++){
    this.cascadeSampleLow.push(c === 0 ? 0.0 : WAVE_SAMPLE_LOW);
    this.cascadeSampleHigh.push(c === this.numCascades - 1 ? this.N : WAVE_SAMPLE_HIGH);
  }

  //Create h0 for each cascade (different L, noise offset, and k-band)
  this.h0Vars = [];
  for(let c = 0; c < this.numCascades; c++){
    let h0Texture = staticGPUCompute.createTexture();
    let h0Var = staticGPUCompute.addVariable(`textureH0_${c}`, materials.h0ShaderMaterialData.fragmentShader, h0Texture);
    h0Var.minFilter = THREE.ClosestFilter;
    h0Var.magFilter = THREE.ClosestFilter;
    staticGPUCompute.setVariableDependencies(h0Var, [this.noiseVar1, this.noiseVar2, this.noiseVar3, this.noiseVar4]);
    h0Var.material.uniforms = {
      ...h0Var.material.uniforms,
      ...JSON.parse(JSON.stringify(materials.h0ShaderMaterialData.uniforms))
    };
    h0Var.material.uniforms.N.value = this.N;
    h0Var.material.uniforms.L.value = this.cascadePatchSizes[c];
    h0Var.material.uniforms.A.value = maxWaveAmplitude;
    h0Var.material.uniforms.L_.value = 0.0;
    //Per-cascade wind rotation — each cascade's wave fronts run a slightly
    //different direction so the dominant visual motif can't recur at a
    //single cascade's tile period. ±30° spread keeps the overall "wind
    //from one direction" feel intact while decorrelating the cascades'
    //wave-front orientations. Hardcoded; see also [c] index below.
    h0Var.material.uniforms.w.value = ARestlessOcean.LUTlibraries.OceanHeightBandLibrary.rotateWindForCascade(this.w, c);
    h0Var.material.uniforms.omega_p.value = this.omega_p;
    h0Var.material.uniforms.gamma.value = this.jonswapGamma;
    h0Var.material.uniforms.noiseUVOffset.value = noiseOffsets[c];
    h0Var.material.uniforms.sampleLow.value = this.cascadeSampleLow[c];
    h0Var.material.uniforms.sampleHigh.value = this.cascadeSampleHigh[c];
    h0Var.material.uniforms.directionalTurbulence.value = (data.directional_turbulence !== undefined) ? data.directional_turbulence : 0.145;
    this.h0Vars.push(h0Var);
  }

  //Initialize and compute static textures
  let error1 = staticGPUCompute.init();
  if(error1 !== null){
    console.error(`Static GPU Compute Renderer: ${error1}`);
  }
  staticGPUCompute.compute();
  staticGPUCompute.compute(); //Must be run twice to fill up second ping pong shader

  // ========================================================================
  // DYNAMIC GPU COMPUTE: h_k time evolution per cascade (3 axes × 6 cascades)
  // ========================================================================
  this.hkRenderer = new THREE.GPUComputationRenderer(this.textureWidth, this.textureHeight, this.renderer);

  //Create h_k variables for each cascade and axis
  //hkVars[cascade][axis] where axis: 0=X, 1=Y, 2=Z
  this.hkVars = [];
  for(let c = 0; c < this.numCascades; c++){
    let cascadeVars = [];
    let h0Texture = staticGPUCompute.getCurrentRenderTarget(this.h0Vars[c]).texture;
    let cascadeL = this.cascadePatchSizes[c];

    //Y axis (height)
    let hkYTexture = this.hkRenderer.createTexture();
    let hkYVar = this.hkRenderer.addVariable(`textureHkY_${c}`, materials.hkShaderMaterialData.fragmentShader(false, true), hkYTexture);
    hkYVar.minFilter = THREE.ClosestFilter;
    hkYVar.magFilter = THREE.ClosestFilter;
    this.hkRenderer.setVariableDependencies(hkYVar, []);
    hkYVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
    hkYVar.material.uniforms.textureH0.value = h0Texture;
    hkYVar.material.uniforms.L.value = cascadeL;
    hkYVar.material.uniforms.uTime.value = 500.0;
    hkYVar.material.uniforms.N.value = this.N;

    //X axis (horizontal displacement)
    let hkXTexture = this.hkRenderer.createTexture();
    let hkXVar = this.hkRenderer.addVariable(`textureHkX_${c}`, materials.hkShaderMaterialData.fragmentShader(true, false), hkXTexture);
    hkXVar.minFilter = THREE.ClosestFilter;
    hkXVar.magFilter = THREE.ClosestFilter;
    this.hkRenderer.setVariableDependencies(hkXVar, []);
    hkXVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
    hkXVar.material.uniforms.textureH0.value = h0Texture;
    hkXVar.material.uniforms.L.value = cascadeL;
    hkXVar.material.uniforms.uTime.value = 500.0;
    hkXVar.material.uniforms.N.value = this.N;

    //Z axis (horizontal displacement)
    let hkZTexture = this.hkRenderer.createTexture();
    let hkZVar = this.hkRenderer.addVariable(`textureHkZ_${c}`, materials.hkShaderMaterialData.fragmentShader(false, false), hkZTexture);
    hkZVar.minFilter = THREE.ClosestFilter;
    hkZVar.magFilter = THREE.ClosestFilter;
    this.hkRenderer.setVariableDependencies(hkZVar, []);
    hkZVar.material.uniforms = JSON.parse(JSON.stringify(materials.hkShaderMaterialData.uniforms));
    hkZVar.material.uniforms.textureH0.value = h0Texture;
    hkZVar.material.uniforms.L.value = cascadeL;
    hkZVar.material.uniforms.uTime.value = 500.0;
    hkZVar.material.uniforms.N.value = this.N;

    cascadeVars.push(hkXVar, hkYVar, hkZVar); //[X, Y, Z]
    this.hkVars.push(cascadeVars);
  }

  let error3 = this.hkRenderer.init();
  if(error3 !== null){
    console.error(`Dynamic GPU Compute Renderer: ${error3}`);
  }
  this.hkRenderer.compute();

  // ========================================================================
  // MANUAL PING-PONG BUTTERFLY FFT
  // ========================================================================
  //Instead of creating N GPUComputationRenderer variables per butterfly chain,
  //use 2 raw WebGLRenderTargets and alternate between them for each stage.
  //This saves massive VRAM (2 targets vs ~18 per chain).

  let numStages = Math.ceil(Math.log(this.N) / Math.log(2));
  let textureWidth = this.textureWidth;
  let textureHeight = this.textureHeight;

  //Create shared fullscreen quad for butterfly rendering
  let butterflyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let butterflyQuadGeometry = new THREE.PlaneGeometry(2, 2);
  let butterflyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      inputTexture: {type: 't', value: null},
      twiddleTexture: {type: 't', value: this.twiddleTexture},
      stageFraction: {type: 'f', value: 0.0},
      direction: {type: 'i', value: 0},
      resolution: {type: 'v2', value: new THREE.Vector2(textureWidth, textureHeight)}
    },
    fragmentShader: materials.butterflyTextureData.fragmentShader,
    depthTest: false,
    depthWrite: false
  });
  let butterflyQuad = new THREE.Mesh(butterflyQuadGeometry, butterflyMaterial);
  let butterflyScene = new THREE.Scene();
  butterflyScene.add(butterflyQuad);

  //Create render target options
  let rtOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false
  };

  //Create 2 ping-pong targets per butterfly chain
  //butterflyTargets[cascade][axis] = [pingTarget, pongTarget]
  this.butterflyTargets = [];
  for(let c = 0; c < this.numCascades; c++){
    let cascadeTargets = [];
    for(let axis = 0; axis < 3; axis++){
      const ping = new THREE.WebGLRenderTarget(textureWidth, textureHeight, rtOptions);
      const pong = new THREE.WebGLRenderTarget(textureWidth, textureHeight, rtOptions);
      //Explicitly set RepeatWrapping — constructor options may not propagate in all Three.js versions
      ping.texture.wrapS = ping.texture.wrapT = THREE.RepeatWrapping;
      pong.texture.wrapS = pong.texture.wrapT = THREE.RepeatWrapping;
      cascadeTargets.push([ping, pong]);
    }
    this.butterflyTargets.push(cascadeTargets);
  }

  //Output displacement textures per cascade: wavesPerCascade[cascade][axis]
  this.wavesPerCascade = [];
  for(let c = 0; c < this.numCascades; c++){
    this.wavesPerCascade.push([null, null, null]); //[X, Y, Z]
  }

  //Helper: run full 2D butterfly FFT on an input texture, return result texture
  let self = this;
  function runButterflyFFT(inputTexture, pingTarget, pongTarget){
    let read = pingTarget;
    let write = pongTarget;

    //Horizontal butterfly passes
    for(let i = 0; i < numStages; i++){
      butterflyMaterial.uniforms.inputTexture.value = (i === 0) ? inputTexture : read.texture;
      butterflyMaterial.uniforms.direction.value = 0;
      butterflyMaterial.uniforms.stageFraction.value = i / (numStages - 1.0);
      renderer.setRenderTarget(write);
      renderer.render(butterflyScene, butterflyCamera);
      let tmp = read; read = write; write = tmp;
    }

    //Vertical butterfly passes
    for(let i = 0; i < numStages; i++){
      butterflyMaterial.uniforms.inputTexture.value = read.texture;
      butterflyMaterial.uniforms.direction.value = 1;
      butterflyMaterial.uniforms.stageFraction.value = i / (numStages - 1.0);
      renderer.setRenderTarget(write);
      renderer.render(butterflyScene, butterflyCamera);
      let tmp = read; read = write; write = tmp;
    }

    //Restore render target
    renderer.setRenderTarget(null);

    //Result is in read.texture
    return read.texture;
  }

  // ========================================================================
  // REGENERATE H0: Re-run the static spectrum pass with new wind parameters.
  // Must be called whenever wind_velocity changes at runtime so that the
  // frozen h0 textures (which drive all hk evolution) reflect the new wind.
  // ========================================================================
  this.regenerateH0 = function(newWindVelocity){
    const g = 9.80665;
    let wv = new THREE.Vector2(newWindVelocity.x, newWindVelocity.y);
    let windSpeed = wv.length();
    let newW = windSpeed > 0.001 ? wv.clone().normalize() : new THREE.Vector2(0.0, 0.0);
    //Mirror the construction-time ω_p cap (see above). Without this, the
    //fetch formula gives unphysically low ω_p at very low wind speeds.
    let newOmega_p = windSpeed > 0.001
      ? Math.max(22.0 * Math.pow(g * g / (windSpeed * fetch), 1.0 / 3.0), 0.86 * g / windSpeed)
      : 1000000.0;

    //Update h0 uniforms for every cascade. Wind direction gets per-cascade
    //rotation (see construction-time comment) so cascades' wave-front
    //directions decorrelate, breaking visible motif recurrence at single-
    //cascade tile periods.
    for(let c = 0; c < self.numCascades; c++){
      self.h0Vars[c].material.uniforms.w.value = ARestlessOcean.LUTlibraries.OceanHeightBandLibrary.rotateWindForCascade(newW, c);
      self.h0Vars[c].material.uniforms.omega_p.value = newOmega_p;
    }

    //Re-run the static compute twice to fill both ping-pong buffers
    staticGPUCompute.compute();
    staticGPUCompute.compute();

    //Update textureH0 in every hk variable to the newly written render target
    for(let c = 0; c < self.numCascades; c++){
      let newH0Texture = staticGPUCompute.getCurrentRenderTarget(self.h0Vars[c]).texture;
      for(let axis = 0; axis < 3; axis++){
        self.hkVars[c][axis].material.uniforms.textureH0.value = newH0Texture;
      }
    }

    self.w = newW;
    self.omega_p = newOmega_p;

    //Recompute per-cascade slope variances — depends on omega_p.
    self.cascadeRMSSlope = ARestlessOcean.LUTlibraries.OceanHeightBandLibrary.computeCascadeSlopeVariance(
      self.cascadePatchSizes, self.N, self.omega_p, self.jonswapGamma,
      (data.directional_turbulence !== undefined) ? data.directional_turbulence : 0.145
    );

    //Rebuild the analytic buoyancy/query field from the new wind so physics and
    //rendered surface stay locked together.
    if(self.waveField){ self.waveField.rebuild(); }
  };

  // ========================================================================
  // TICK: Per-frame update
  // ========================================================================
  this.tick = function(time){
    //Advance the analytic buoyancy/query field on the SAME /1000 seconds base
    //as the h_k shader below, so gameplay water-height queries stay phase-locked
    //to the rendered surface's motion.
    if(self.waveField){ self.waveField.currentTimeSeconds = time / 1000.0; }

    //`time` is A-Frame's tick clock in MILLISECONDS. The h_k shader uses
    //uTime in cos(w * uTime) where w has units rad/s, so uTime must be in
    //seconds for physical dispersion to read correctly. /1000.0 = real time.
    //(The historical /512.0 ran the simulation at ~1.95x real-time, a fudge
    //tuned for the old huge-world scale where waves looked too slow.)
    for(let c = 0; c < self.numCascades; c++){
      for(let axis = 0; axis < 3; axis++){
        self.hkVars[c][axis].material.uniforms.uTime.value = time / 1000.0;
      }
    }
    self.hkRenderer.compute();

    //Run butterfly FFT for each cascade and axis (displacement)
    for(let c = 0; c < self.numCascades; c++){
      for(let axis = 0; axis < 3; axis++){
        let hkTexture = self.hkRenderer.getCurrentRenderTarget(self.hkVars[c][axis]).texture;
        let targets = self.butterflyTargets[c][axis];
        self.wavesPerCascade[c][axis] = runButterflyFFT(hkTexture, targets[0], targets[1]);
      }
    }
  };

  // ========================================================================
  // ANALYTIC WAVE FIELD: CPU twin of this spectrum for buoyancy / queries.
  // Built from the same omega_p / wind / gamma / turbulence / cascade rotation
  // resolved above, so it cannot drift from the rendered surface. Exposed
  // globally for gameplay (buoyant component, swimming, dock pilings, ...).
  // ========================================================================
  this.waveField = new ARestlessOcean.OceanWaveField(this, data);
  ARestlessOcean.waveField = this.waveField;
}

//Per-cascade wind-direction rotation. Each cascade's h_0 spectrum is built
//from a rotated copy of the master wind vector so the resulting wave-front
//orientation differs slightly between cascades. The cascades still tile at
//their physical L periods, but because each cascade's dominant wave fronts
//run a different way, the combined visual signature can't repeat with one
//cascade's period — the recurrent "motif" is broken.
//
//Angles in degrees, indexed by cascade 0..5. C0 is the anchor (0°); the
//others fan out within a ±30° envelope. Order alternates sign so adjacent
//cascades sit on opposite sides of the master direction — keeps the total
//directional moment near zero so the surface still reads as "wind from one
//direction" rather than a chaotic chop-from-everywhere look.
ARestlessOcean.LUTlibraries.OceanHeightBandLibrary.CASCADE_WIND_ANGLES_DEG = [0, 10, -10, 20, -20, 30];

//Compute per-cascade slope variance σ² by mirroring the discrete h_0 spectrum
//the GPU writes. For each cascade we loop over every (nx, ny) bin in the same
//[sampleLow, sampleHigh) centered-FFT band, build h_0_coefficient² with the
//same JONSWAP + cos² spread + amplitude scaling, then accumulate k² ·
//E[|h(k,t)|²] across the band. The result is the total slope variance the
//ocean surface would carry in that cascade if every wavelength were
//well-resolved on screen — the water shader uses this as the "energy lost
//to mipping/aliasing" budget that drives a distance-roughness Fresnel clamp.
//
//Variance derivation:
//  Each texel stores h_0(k_+) AND h_0*(k_-) in (xy, zw). gaussRand gives
//  unit-variance real+imaginary parts, so:
//    E[|h_0(k_+)|²] = 2 · h0_coef² · spread_k²       (xy magnitude squared)
//    E[|h_0(k_-)|²] = 2 · h0_coef² · spread_-k²      (zw magnitude squared)
//  The hk pass forms h(k,t) = h_0(k_+) e^{iωt} + h_0*(k_-) e^{-iωt}, whose
//  expected squared magnitude (cross terms vanish under independence) is the
//  sum of the two terms above. spread_-k² = spread_k² because the spread is
//  symmetric under k → -k.
//  Slope variance accumulates k² weight: σ²_slope += k² · E[|h(k,t)|²].
//
//Returns Float32Array length numCascades. Result is in units of (slope)² —
//feed into α²_GGX in the shader after scaling by waveHeightMultiplier².
ARestlessOcean.LUTlibraries.OceanHeightBandLibrary.computeCascadeSlopeVariance = function(
    cascadePatchSizes, N, omega_p, gamma, directionalTurbulence){
  const g = 9.80665;
  const piTimes2 = 2.0 * Math.PI;
  const JONSWAP_ALPHA = 0.0081;
  const WAVE_SAMPLE_LOW = 2.0;
  const WAVE_SAMPLE_HIGH = 8.0;
  const turb = Math.max(0.0, Math.min(1.0, directionalTurbulence));

  const numCascades = cascadePatchSizes.length;
  //Plain Array (not Float32Array) to match the three.js uniform-upload pattern
  //used for cascadePatchSizes — the GLSL `float[6]` uniform reads a JS Array.
  const out = new Array(numCascades);

  const halfN = N * 0.5;

  for(let c = 0; c < numCascades; c++){
    const L = cascadePatchSizes[c];
    const dk = piTimes2 / L;
    const sampleLow  = (c === 0) ? 0.0 : WAVE_SAMPLE_LOW;
    const sampleHigh = (c === numCascades - 1) ? N : WAVE_SAMPLE_HIGH;
    const sampleLowCulled = Math.max(sampleLow, 1.0);

    //Angle-average of spread² over the full ring (see derivation in the
    //inner-loop comment block below). Constant per cascade.
    //  <(mix(cos²θ, ½, turb))²>_θ = (1-t)²·3/8 + (1-t)·t·½ + t²/4
    const oneMinusTurb = 1.0 - turb;
    const spreadSqAvg = oneMinusTurb * oneMinusTurb * (3.0 / 8.0)
                      + oneMinusTurb * turb * 0.5
                      + turb * turb * 0.25;

    let acc = 0.0;
    for(let ny = 0; ny < N; ny++){
      const coordY = ny - halfN;
      for(let nx = 0; nx < N; nx++){
        const coordX = nx - halfN;
        const maxCoord = Math.max(Math.abs(coordX), Math.abs(coordY));
        if(maxCoord < sampleLowCulled || maxCoord >= sampleHigh) continue;

        const kx = dk * coordX;
        const ky = dk * coordY;
        const k2 = kx * kx + ky * ky;
        const magK = Math.sqrt(k2);
        if(magK < 1e-4) continue;

        //JONSWAP S(ω) → S(k) via |dω/dk| = g/(2ω); 1D-omni → 2D via /k.
        const omega = Math.sqrt(g * magK);
        const sigma = omega <= omega_p ? 0.07 : 0.09;
        const r = Math.exp(-((omega - omega_p) * (omega - omega_p)) /
                           (2.0 * sigma * sigma * omega_p * omega_p));
        const pm = JONSWAP_ALPHA * g * g / Math.pow(omega, 5.0) *
                   Math.exp(-1.25 * Math.pow(omega_p / omega, 4.0));
        const jonswap = pm * Math.pow(gamma, r);
        const Sk = jonswap * g / (2.0 * omega);

        //h_0 coefficient (A=1 in current build; physical amplitudes baked in).
        const h0CoefSq = Sk * dk * dk / (2.0 * magK);

        //Spread² is angle-averaged because we're integrating over the whole
        //band; per-bin direction cancels in the sum. Derivation:
        //  <(mix(cos²θ, ½, turb))²>_θ
        //    = (1-turb)² · <cos⁴θ> + 2(1-turb)·turb · ½ · <cos²θ> + turb² · ¼
        //    = (1-turb)² · 3/8     + (1-turb)·turb · ½             + turb² / 4
        //Cascade wind rotation doesn't affect the band sum (rotating k and w
        //by the same angle is invariant under dot). spreadSqAvg computed once
        //above this loop.

        //Texel-total variance (h_0(k_+) and h_0*(k_-) packed together).
        //gauss.xy carries variance 2; the +k and -k parts each contribute
        //2 · h0_coef² · spread² → factor of 4 combined (spread_-k² = spread_k²).
        const texelVar = 4.0 * h0CoefSq * spreadSqAvg;

        acc += k2 * texelVar;
      }
    }
    out[c] = acc;
  }

  return out;
};

ARestlessOcean.LUTlibraries.OceanHeightBandLibrary.rotateWindForCascade = function(w, c){
  const angles = ARestlessOcean.LUTlibraries.OceanHeightBandLibrary.CASCADE_WIND_ANGLES_DEG;
  const angleDeg = (c >= 0 && c < angles.length) ? angles[c] : 0;
  const angle = angleDeg * Math.PI / 180;
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  return new THREE.Vector2(w.x * cs - w.y * sn, w.x * sn + w.y * cs);
};

//=============================================================================
// OceanWaveField — analytic CPU mirror of the GPU FFT ocean, for physics.
//=============================================================================
//
// The rendered ocean is a 6-cascade GPU FFT (ocean-height-band-library.js). The
// CPU can't cheaply read that surface back every frame, so for buoyancy and any
// "what is the water height at (x, z)?" gameplay query we reconstruct a
// STATISTICAL twin of the same sea state out of a modest set of Gerstner waves.
//
// "Statistical twin" — not a per-fragment match. We pull our waves from the
// IDENTICAL JONSWAP spectrum, wind, per-cascade wind rotation, peak frequency
// (omega_p) and directional-spread formula the GPU h_0 pass uses (see
// h_0-pass.js), so the dominant wavelength, direction, period and significant
// wave height all agree with the rendered surface. The instantaneous height at
// a single point can differ from the FFT by tens of cm on chop because we use
// random phases (the GPU's phases live in noise textures we don't share) and a
// few dozen components instead of ~65k bins. For floating objects and swimmers
// that reads as correct — the body rides the right swell at the right cadence.
//
// Because every spectral parameter is read straight from the band library, the
// physics field and the renderer CANNOT drift apart: change the wind and both
// rebuild from the same omega_p. See ocean-height-band-library.js regenerateH0,
// which calls rebuild() on this field.
//
// Amplitude calibration: rather than chase the FFT's IFFT normalization
// analytically, we shape the components from the spectrum (relative energy per
// direction/scale) and then rescale the whole set so the surface variance
// matches the PHYSICAL significant wave height the band library documents
// (Hs ≈ 0.21·U²/g·gamma^0.3, ~2.73 m for the default wind). The artistic
// `wave_scale_multiple` dial is then applied on top here exactly as the vertex
// shader applies waveHeightMultiplier — so visual surface and physics surface
// share both the physical amplitude and the artistic boost.
//
// Public surface:
//   ARestlessOcean.waveField                         — active instance (or null)
//   ARestlessOcean.sampleWaterHeight(x, z)           — height at world XZ, now
//   ARestlessOcean.sampleWaterDisplacement(x,z,out)  — full Gerstner xyz, now
//   ARestlessOcean.sampleWaterNormal(x, z, out)      — surface normal, now
// The *(x, z, t)* instance methods take an explicit time (seconds) so a worker
// or a predict-ahead integrator can sample any time without a frame tick.

ARestlessOcean.OceanWaveField = function(bandLibrary, data){
  this.bandLibrary = bandLibrary;
  this.data = data;
  this.components = [];
  //Advanced once per frame by the band library tick (seconds; same /1000 base
  //as the h_k shader's uTime). The public sampleWaterHeight() convenience uses
  //this; the (x, z, t) instance methods take time explicitly instead.
  this.currentTimeSeconds = 0.0;
  this.rebuild();
};

//Number of directional buckets the spectrum energy of each cascade is collapsed
//into. Each non-empty bucket becomes one Gerstner wave whose direction is the
//energy-weighted mean of the bins that fell in it. 16 around the full circle is
//plenty to capture the wind lobe plus its cross-wind spread without producing
//more components than per-frame sampling wants to evaluate.
ARestlessOcean.OceanWaveField.NUM_DIRECTION_BUCKETS = 16;

//Buckets carrying less than this fraction of the peak bucket's energy are
//dropped — they contribute imperceptible motion but cost a full cos() per
//sample. Keeps the active component count to a few dozen.
ARestlessOcean.OceanWaveField.ENERGY_PRUNE_FRACTION = 0.0025;

//Rebuild the Gerstner component set from the band library's CURRENT spectrum
//state. Safe to call any time wind / fetch / gamma / turbulence change; the
//band library's regenerateH0 already does.
ARestlessOcean.OceanWaveField.prototype.rebuild = function(){
  const data = this.data;
  const bandLibrary = this.bandLibrary;

  //Artistic + framing dials, mirrored from the live component data so a runtime
  //change is picked up on the next rebuild. waveHeightMultiplier matches the
  //vertex shader's wave_scale_multiple; chop scales horizontal Gerstner
  //displacement like the shader's chop; heightOffset lifts the whole rest plane.
  this.heightOffset = (data.height_offset !== undefined) ? data.height_offset : 0.0;
  this.waveHeightMultiplier = (data.wave_scale_multiple !== undefined) ? data.wave_scale_multiple : 1.5;
  this.chop = (data.chop !== undefined) ? data.chop : 1.0;

  const turbulence = (data.directional_turbulence !== undefined) ? data.directional_turbulence : 0.145;
  const windSpeed = (bandLibrary.w && this.data.wind_velocity)
    ? Math.sqrt(this.data.wind_velocity.x * this.data.wind_velocity.x +
                this.data.wind_velocity.y * this.data.wind_velocity.y)
    : 0.0;

  this.components = ARestlessOcean.OceanWaveField.buildGerstnerComponents(
    bandLibrary.cascadePatchSizes, bandLibrary.N, bandLibrary.omega_p,
    bandLibrary.jonswapGamma, turbulence, bandLibrary.w, windSpeed);
};

//Deterministic small LCG so a rebuild always lays the random phases down the
//same way (reproducible physics across reloads). Seed is arbitrary but fixed.
ARestlessOcean.OceanWaveField._mulberry32 = function(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
  };
};

//Collapse the discrete JONSWAP spectrum (the same one h_0-pass.js writes to the
//GPU) into a set of Gerstner traveling waves. Mirrors the bin loop in
//OceanHeightBandLibrary.computeCascadeSlopeVariance, but instead of summing
//slope variance we bucket each bin's height energy by direction (per cascade)
//and emit one wave per non-empty bucket.
//
// Returns Array<{kx, ky, omega, amp, phase, dirX, dirZ}> in WORLD units:
//   k = (kx, ky) maps to world (x, z); amp is metres (pre-waveHeightMultiplier);
//   omega rad/s; dir is the unit propagation direction.
ARestlessOcean.OceanWaveField.buildGerstnerComponents = function(
    cascadePatchSizes, N, omega_p, gamma, directionalTurbulence, windDir, windSpeed){
  const g = 9.80665;
  const piTimes2 = 2.0 * Math.PI;
  const JONSWAP_ALPHA = 0.0081;
  const WAVE_SAMPLE_LOW = 2.0;
  const WAVE_SAMPLE_HIGH = 8.0;
  const turb = Math.max(0.0, Math.min(1.0, directionalTurbulence));
  const numCascades = cascadePatchSizes.length;
  const numBuckets = ARestlessOcean.OceanWaveField.NUM_DIRECTION_BUCKETS;
  const halfN = N * 0.5;
  const rng = ARestlessOcean.OceanWaveField._mulberry32(0x0CEA0FED);

  //Dead-calm sea: no wind, no waves. omega_p was set to a sentinel huge value
  //by the band library, which would just produce zero energy anyway — bail to a
  //flat field so callers sit objects exactly on the rest plane.
  if(!(windSpeed > 0.001)){
    return [];
  }

  const components = [];
  let modelM0 = 0.0; //Σ amp²/2 across all components == surface height variance.

  for(let c = 0; c < numCascades; c++){
    const L = cascadePatchSizes[c];
    const dk = piTimes2 / L;
    const sampleLow  = (c === 0) ? 0.0 : WAVE_SAMPLE_LOW;
    const sampleHigh = (c === numCascades - 1) ? N : WAVE_SAMPLE_HIGH;
    const sampleLowCulled = Math.max(sampleLow, 1.0);

    //Per-cascade wind rotation — identical to the h_0 pass, so each cascade's
    //wave-front orientation matches what's rendered.
    const wRot = ARestlessOcean.LUTlibraries.OceanHeightBandLibrary.rotateWindForCascade(windDir, c);
    const wLen = Math.sqrt(wRot.x * wRot.x + wRot.y * wRot.y) || 1.0;
    const wnx = wRot.x / wLen, wny = wRot.y / wLen;

    //Per-direction-bucket accumulators: energy-weighted sums of k so each
    //bucket's emitted wave points along the mean direction of its bins.
    const sumVar = new Float64Array(numBuckets);
    const sumVarKx = new Float64Array(numBuckets);
    const sumVarKy = new Float64Array(numBuckets);

    for(let ny = 0; ny < N; ny++){
      const coordY = ny - halfN;
      for(let nx = 0; nx < N; nx++){
        const coordX = nx - halfN;
        const maxCoord = Math.max(Math.abs(coordX), Math.abs(coordY));
        if(maxCoord < sampleLowCulled || maxCoord >= sampleHigh) continue;

        const kx = dk * coordX;
        const ky = dk * coordY;
        const k2 = kx * kx + ky * ky;
        const magK = Math.sqrt(k2);
        if(magK < 1e-4) continue;

        //JONSWAP S(omega) → S(k) → 2D, exactly as h_0-pass.js.
        const omega = Math.sqrt(g * magK);
        const sigma = omega <= omega_p ? 0.07 : 0.09;
        const r = Math.exp(-((omega - omega_p) * (omega - omega_p)) /
                           (2.0 * sigma * sigma * omega_p * omega_p));
        const pm = JONSWAP_ALPHA * g * g / Math.pow(omega, 5.0) *
                   Math.exp(-1.25 * Math.pow(omega_p / omega, 4.0));
        const jonswap = pm * Math.pow(gamma, r);
        const Sk = jonswap * g / (2.0 * omega);

        //h_0 coefficient (A = 1, physical) and the directional spread for THIS
        //bin's own direction — same mix(cos²θ, ½, turb) the shader uses. We loop
        //the full grid, so the +k and −k partners are visited separately and
        //get their own (asymmetric) spread, just like on the GPU.
        const h0Coef = Math.sqrt(Sk * dk * dk / (2.0 * magK));
        const dKdotW = (kx * wnx + ky * wny) / magK;
        const spread = (1.0 - turb) * (dKdotW * dKdotW) + turb * 0.5;
        const h0k = h0Coef * spread;
        const binVar = h0k * h0k; //relative height energy of this bin.
        if(binVar <= 0.0) continue;

        //Bucket by propagation direction.
        let theta = Math.atan2(ky, kx); //(-π, π]
        let b = Math.floor((theta + Math.PI) / piTimes2 * numBuckets);
        if(b < 0) b = 0; else if(b >= numBuckets) b = numBuckets - 1;
        sumVar[b]   += binVar;
        sumVarKx[b] += binVar * kx;
        sumVarKy[b] += binVar * ky;
      }
    }

    //Emit one Gerstner wave per non-empty bucket. amp = √(2·energy) so that the
    //wave's own variance amp²/2 equals the bucket's accumulated energy.
    for(let b = 0; b < numBuckets; b++){
      const v = sumVar[b];
      if(v <= 0.0) continue;
      const meanKx = sumVarKx[b] / v;
      const meanKy = sumVarKy[b] / v;
      const kMag = Math.sqrt(meanKx * meanKx + meanKy * meanKy);
      if(kMag < 1e-5) continue;
      const amp = Math.sqrt(2.0 * v);
      components.push({
        kx: meanKx, ky: meanKy,
        dirX: meanKx / kMag, dirZ: meanKy / kMag,
        omega: Math.sqrt(g * kMag),
        amp: amp,
        phase: rng() * piTimes2
      });
      modelM0 += v;
    }
  }

  if(components.length === 0 || modelM0 < 1e-12){
    return [];
  }

  //Prune negligible components (cross-wind dribble) relative to the strongest.
  let peak = 0.0;
  for(let i = 0; i < components.length; i++){
    const e = 0.5 * components[i].amp * components[i].amp;
    if(e > peak) peak = e;
  }
  const cutoff = peak * ARestlessOcean.OceanWaveField.ENERGY_PRUNE_FRACTION;
  const kept = [];
  let keptM0 = 0.0;
  for(let i = 0; i < components.length; i++){
    const e = 0.5 * components[i].amp * components[i].amp;
    if(e >= cutoff){ kept.push(components[i]); keptM0 += e; }
  }
  if(kept.length === 0 || keptM0 < 1e-12) return [];

  //Calibrate absolute amplitude to the PHYSICAL significant wave height the
  //band library documents: Hs = 0.21·U²/g · gamma^0.3 (PM × JONSWAP boost).
  //Surface variance m0 = (Hs/4)². Rescale every amp by √(m0_target / m0_model)
  //so √(Σ amp²/2) lands on the right Hs — independent of any IFFT normalization
  //constant, which is why we don't try to derive amplitude through the FFT.
  const Hs = 0.21 * windSpeed * windSpeed / g * Math.pow(gamma, 0.3);
  const m0Target = (Hs * 0.25) * (Hs * 0.25);
  const ampScale = Math.sqrt(m0Target / keptM0);
  for(let i = 0; i < kept.length; i++){
    kept[i].amp *= ampScale;
  }
  return kept;
};

//Vertical water height at world (x, z) and time t (seconds). Cheap: one cos()
//per component. Ignores the horizontal Gerstner shift (the crest "leans"), which
//is the standard forgiving approximation for height queries — multi-probe
//averaging in the buoyant component smooths the residual. Use
//sampleDisplacement when you need the full leaned position.
ARestlessOcean.OceanWaveField.prototype.sampleHeight = function(x, z, t){
  const comps = this.components;
  let h = 0.0;
  for(let i = 0; i < comps.length; i++){
    const c = comps[i];
    h += c.amp * Math.cos(c.kx * x + c.ky * z - c.omega * t + c.phase);
  }
  return this.heightOffset + this.waveHeightMultiplier * h;
};

//Full Gerstner displacement at world (x, z), t. out is a THREE.Vector3 (or any
//{x,y,z}); returns it. x/z carry the horizontal "lean" scaled by chop, y the
//height (incl. heightOffset). Useful for spray emitters, true-surface markers.
ARestlessOcean.OceanWaveField.prototype.sampleDisplacement = function(x, z, t, out){
  const comps = this.components;
  let dx = 0.0, dy = 0.0, dz = 0.0;
  for(let i = 0; i < comps.length; i++){
    const c = comps[i];
    const arg = c.kx * x + c.ky * z - c.omega * t + c.phase;
    dy += c.amp * Math.cos(arg);
    const s = c.amp * Math.sin(arg);
    dx -= c.dirX * s;
    dz -= c.dirZ * s;
  }
  out.x = this.waveHeightMultiplier * this.chop * dx;
  out.y = this.heightOffset + this.waveHeightMultiplier * dy;
  out.z = this.waveHeightMultiplier * this.chop * dz;
  return out;
};

//Surface normal at world (x, z), t via central differences of sampleHeight.
//Robust and cheap (4 height samples) — avoids the messy analytic Gerstner
//partials once the chop term is in play. out is a THREE.Vector3; returns it
//normalized.
ARestlessOcean.OceanWaveField.prototype.sampleNormal = function(x, z, t, out){
  const eps = 0.25; //metres; ~capillary-cascade scale, stable for tilt.
  const hL = this.sampleHeight(x - eps, z, t);
  const hR = this.sampleHeight(x + eps, z, t);
  const hD = this.sampleHeight(x, z - eps, t);
  const hU = this.sampleHeight(x, z + eps, t);
  out.x = -(hR - hL) / (2.0 * eps);
  out.y = 1.0;
  out.z = -(hU - hD) / (2.0 * eps);
  const inv = 1.0 / Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z);
  out.x *= inv; out.y *= inv; out.z *= inv;
  return out;
};

//===========================================================================
// Public convenience API — delegate to the active field at the current frame
// time. These are the entry points gameplay code (swimming, floating props,
// dock pilings) should reach for; they no-op gracefully before the ocean is up.
//===========================================================================
ARestlessOcean.waveField = null;

ARestlessOcean.sampleWaterHeight = function(x, z){
  const f = ARestlessOcean.waveField;
  return f ? f.sampleHeight(x, z, f.currentTimeSeconds) : 0.0;
};

ARestlessOcean.sampleWaterDisplacement = function(x, z, out){
  out = out || new THREE.Vector3();
  const f = ARestlessOcean.waveField;
  if(f) return f.sampleDisplacement(x, z, f.currentTimeSeconds, out);
  out.set(0, 0, 0);
  return out;
};

ARestlessOcean.sampleWaterNormal = function(x, z, out){
  out = out || new THREE.Vector3();
  const f = ARestlessOcean.waveField;
  if(f) return f.sampleNormal(x, z, f.currentTimeSeconds, out);
  out.set(0, 1, 0);
  return out;
};

//DEBUG: compare the analytic field (what buoyancy uses) against the ACTUAL
//rendered FFT surface (GPU readback, ocean-grid.sampleFFTHeightAt) at world
//(x, z). They share the same spectrum/wind/period, so they agree statistically
//— but their crests sit in DIFFERENT places because the analytic twin uses its
//own random phases (the GPU's phases live in noise textures we don't share). So
//a nonzero Δ at a point is EXPECTED, not a bug; it's why a float can ride a crest
//the rendered surface shows as a trough. Call from the console, e.g.
//   ARestlessOcean.debugWaveAt(2, -45)
//or watch a floating cube:  setInterval(()=>ARestlessOcean.debugWaveAt(2,-45),250)
//The FFT readback is synchronous (stalls the GPU) — debugging only, kill when done.


ARestlessOcean.LUTlibraries.OceanHeightComposer = function(parentOceanGrid){
  let data = parentOceanGrid.data;
  this.renderer = parentOceanGrid.renderer;
  this.baseTextureWidth = data.patch_data_size;
  this.baseTextureHeight = data.patch_data_size;
  this.N = data.number_of_octaves;
  this.OceanMaterialHeightBandLibrary = parentOceanGrid.oceanHeightBandLibrary;
  this.numCascades = this.OceanMaterialHeightBandLibrary.numCascades;

  // ===== Per-cascade displacement packer =====
  // Packs each cascade's x/y/z FFT outputs into the RGB of its displacement RT
  // (alpha unused). Undoes the IFFT half-texel checkerboard shift.
  const packVertShader = [
    'void main(){',
    '  gl_Position = vec4(position, 1.0);',
    '}'
  ].join('\n');

  //Displacement pack shader: sample the three FFT output textures, undo the
  //IFFT half-texel shift, write xyz to RGB (alpha unused).
  const packFragShader = [
    'uniform sampler2D xTexture;',
    'uniform sampler2D yTexture;',
    'uniform sampler2D zTexture;',
    'uniform vec2 resolution;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / resolution.xy;',
    //h_0 and h_k pack the spectrum with DC centered at (N/2, N/2). The IFFT
    //produces a result shifted by N/2 in both axes; undo it with the standard
    //checkerboard (-1)^(x+y) sign flip applied per IFFT output texel.
    '  vec2 texCoord = floor(uv * resolution);',
    '  float ifftSign = mod(texCoord.x + texCoord.y, 2.0) < 0.5 ? 1.0 : -1.0;',
    '  float dx = texture2D(xTexture, uv).x * ifftSign;',
    '  float dy = texture2D(yTexture, uv).x * ifftSign;',
    '  float dz = texture2D(zTexture, uv).x * ifftSign;',
    '  gl_FragColor = vec4(dx, dy, dz, 1.0);',
    '}'
  ].join('\n');

  const cascadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const cascadeQuadGeo = new THREE.PlaneGeometry(2, 2);
  this._packMaterial = new THREE.ShaderMaterial({
    uniforms: {
      xTexture: {type: 't', value: null},
      yTexture: {type: 't', value: null},
      zTexture: {type: 't', value: null},
      resolution: {type: 'v2', value: new THREE.Vector2(this.baseTextureWidth, this.baseTextureHeight)}
    },
    vertexShader: packVertShader,
    fragmentShader: packFragShader,
    depthTest: false,
    depthWrite: false
  });
  this._packScene = new THREE.Scene();
  this._packScene.add(new THREE.Mesh(cascadeQuadGeo, this._packMaterial));

  this._cascadeCamera = cascadeCamera;
  this._cascadePatchSizes = this.OceanMaterialHeightBandLibrary.cascadePatchSizes;
  this.waveHeightMultiplier = data.wave_scale_multiple;

  //Mipmaps on the displacement RT let the GPU pick the right LOD as the camera
  //pulls back, which stabilises the per-fragment central-difference normals:
  //they sample a mip level matched to the screen-pixel footprint, killing the
  //high-freq shimmer that comes from sub-pixel cascade content.
  //Three.js auto-calls gl.generateMipmap on the RT texture after each render
  //when generateMipmaps:true. Float RTs need OES_texture_float_linear (gated
  //in ocean-height-band-library.js).
  const cascadeRTOptions = {
    minFilter: THREE.LinearMipMapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: true
  };

  //One displacement RT per cascade. The pack pass fully rewrites every texel
  //each frame from the band library's FFT output, so there's no history to
  //keep — the ping-pong this used to need died with the alpha-channel foam.
  this.cascadeDisplacementTargets = [];
  this.cascadeDisplacementTextures = [];
  //Zero-clear at construction so any sample taken before the first tick() (or
  //a driver that returns NaN for uninitialized FloatType RTs) reads defined
  //data rather than garbage displacement.
  const prevRenderTarget = this.renderer.getRenderTarget();
  const prevClearColor = new THREE.Color();
  this.renderer.getClearColor(prevClearColor);
  const prevClearAlpha = this.renderer.getClearAlpha();
  this.renderer.setClearColor(0x000000, 0.0);
  for(let c = 0; c < this.numCascades; c++){
    const rt = new THREE.WebGLRenderTarget(this.baseTextureWidth, this.baseTextureHeight, cascadeRTOptions);
    rt.texture.wrapS = THREE.RepeatWrapping;
    rt.texture.wrapT = THREE.RepeatWrapping;
    this.renderer.setRenderTarget(rt);
    this.renderer.clear(true, false, false);
    this.cascadeDisplacementTargets.push(rt);
    this.cascadeDisplacementTextures.push(rt.texture);
  }
  this.renderer.setClearColor(prevClearColor, prevClearAlpha);
  this.renderer.setRenderTarget(prevRenderTarget);

  let self = this;
  this.tick = function(){
    //Pack each cascade's xyz displacement into the RGB of its render target.
    //Single RT per cascade (no ping-pong): the band library regenerates the
    //FFT output every frame, so the displacement is always fully rewritten.
    for(let c = 0; c < self.numCascades; c++){
      self._packMaterial.uniforms.xTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][0];
      self._packMaterial.uniforms.yTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][1];
      self._packMaterial.uniforms.zTexture.value = self.OceanMaterialHeightBandLibrary.wavesPerCascade[c][2];
      self.renderer.setRenderTarget(self.cascadeDisplacementTargets[c]);
      self.renderer.render(self._packScene, self._cascadeCamera);
    }

    self.renderer.setRenderTarget(null);
  };
}

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
ARestlessOcean.OceanTile = function(worldSize, numCells, top, right, bottom, left){
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

ARestlessOcean.OceanPatch = function(parentOceanGrid, initialPosition, instanceMeshRef, instanceID, ringIndex){
  const scene = parentOceanGrid.scene;
  this.initialPosition = initialPosition;
  this.position = new THREE.Vector3();
  this.parentOceanGrid = parentOceanGrid;
  this.instanceMeshRef = instanceMeshRef;
  this.instanceID = instanceID;
  this.ringIndex = ringIndex;
}

//Ocean-only cascaded shadow map — EVSM (Exponential Variance Shadow Map).
//
//Motivation: Three.js's main sun shadow map has to cover the entire scene
//(trees, lighthouse, rocks) and therefore its frustum is too large to
//resolve individual wave crests. This component renders a dedicated pass
//of just the ocean InstancedMeshes into N tight, sun-aligned orthographic
//frusta — giving per-wave self-shadow that a scene-wide shadow map could
//never capture.
//
//Why EVSM (vs regular depth + PCF, which we used to do): per-triangle
//z-acne on smooth meshes is structural to depth-comparison shadow maps.
//Caster and receiver are the SAME mesh, so adjacent triangles produce
//slightly different sc.z values that flip the binary depth comparison
//even with calibrated bias. EVSM stores 4 warped depth moments instead
//of a single depth, then evaluates Chebyshev's inequality to derive a
//probabilistic shadow bound — small per-triangle depth jitter becomes a
//smooth gradient rather than a binary flip. The negative-warp pair (the
//"E" in EVSM) eliminates most of plain-VSM light bleed.
//
//Pipeline per cascade per frame:
//  1. Caster pass: render ocean meshes into RGBA32F color target. The
//     caster fragment writes (exp(c·z), exp(2c·z), -exp(-c·z), exp(-2c·z)).
//  2. Horizontal Gaussian blur into a shared ping-pong buffer.
//  3. Vertical Gaussian blur back into the moment target.
//Linear-filterable float textures + the Gaussian blur are what give EVSM
//its smoothness — without them, per-texel variance is near-zero and the
//Chebyshev bound degenerates to a depth comparison.
//
//Four cascades by default:
//  C0   60 m  × 2048² → ~2.9 cm/texel  (sharp wave-on-wave near camera)
//  C1  240 m  × 2048² → ~11.7 cm/texel (mid distance)
//  C2 0.4 × drawDistance × 2048²       (broad chop / mid-far)
//  C3  2  × drawDistance × 2048²       (full draw-distance horizon coverage)
//C0/C1 stay fixed because wave-scale near you is a property of the
//simulation, not the world. C2/C3 scale with drawDistance so a smaller
//world automatically gets tighter horizon shadows.
//
//C2/C3 were 4096² in earlier iterations; halved to 2048² because at
//drawDistance 10 km, C3's texel size is ~10 m anyway, and the 9-tap
//stride-2 EVSM blur already softens any sub-blur-radius detail (~16 m
//world reach). The sun-zenith fade also kills shadows at high sun angles
//where the blur footprint would otherwise smear most. Visual cost is
//small; VRAM cost was 256+256+256 = 768 MB for the two big cascades plus
//the matching 4096² blur ping-pong. Now everything fits in the single
//2048² ping-pong.
//
//Memory: 4 × moment-target (RGBA32F 2048²) = 64+64+64+64 = 256 MB.
//Plus one 2048² ping-pong = 64 MB. Total ~320 MB (was ~960 MB).
//
//Caster ring filtering: each cascade has a maxRing index. The mesh's
//ringIndex (the clipmap LOD it was built with) determines which cascades
//it can cast into — rings 0 and 1 belong to all four cascades but ring 2's
//huge 1km tile only contributes meaningfully to C3. Each cascade owns a
//layer (7..10). At addCaster time we enable the cascade's layer on the
//mesh iff the mesh's ring is small enough to qualify; the light camera
//per-cascade renders only its own layer.
//
//C0 deliberately admits ring 1 (not just ring 0) to soften the C0/C1
//boundary. Without this the cascade swap is visible because C0's caster
//set is strictly smaller than C1's, so a fragment crossing the boundary
//can lose a shadow that came from a ring-1 wave just outside C0.

ARestlessOcean.OceanShadowCSM = function(oceanGrid, scene, configOverrides){
  this.oceanGrid = oceanGrid;
  this.scene = scene;

  //EVSM warp constant. Larger reduces light bleed but compresses depth
  //precision at extremes. ~5 is a good float32 balance for ocean depth
  //slabs up to 10 km. Receiver's evsmExpC uniform MUST match this.
  this._evsmExpC = 5.0;

  //Cascade parameters. extent sets the ortho frustum's lateral size;
  //mapSize sets moment-texture resolution. layer is the THREE.Layers bit
  //used to gate which meshes render into this cascade. maxRing is the
  //highest oceanGrid ring index that gets registered as a caster.
  //
  //cascadeDepth (the sun-direction depth slab) and lightDistance are
  //DERIVED from extent in render(), not stored on the config — at low
  //sun elevations a fragment at +halfExtent on the sea plane projects to
  //a view-z offset close to halfExtent itself, so the depth window must
  //scale with extent or large cascades silently fail their z-range check.
  const drawDistance = oceanGrid.drawDistance;
  const cfg = configOverrides || {};
  this.cascadeConfigs = cfg.cascades || [
    {extent: 60.0,                 mapSize: 2048, layer: 7,  maxRing: 1},
    {extent: 240.0,                mapSize: 2048, layer: 8,  maxRing: 1},
    {extent: 0.4 * drawDistance,   mapSize: 2048, layer: 9,  maxRing: 99},
    {extent: 2.0 * drawDistance,   mapSize: 2048, layer: 10, maxRing: 99}
  ];
  this.numCascades = this.cascadeConfigs.length;
  this._waveMargin = 50.0;

  this._shadowMatDef = ARestlessOcean.Materials.Ocean.oceanShadowMaterial;

  //Build per-cascade resources: RGBA32F color target with depth renderbuffer
  //(depth used for caster z-test, never read back), linear filtering enabled
  //so the EVSM Chebyshev bound benefits from hardware bilinear interp.
  this.cascades = [];
  for(let i = 0; i < this.numCascades; i++){
    const c = this.cascadeConfigs[i];
    const renderTarget = new THREE.WebGLRenderTarget(c.mapSize, c.mapSize, {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false
    });
    const lightCamera = new THREE.OrthographicCamera(
      -c.extent * 0.5, c.extent * 0.5,
       c.extent * 0.5, -c.extent * 0.5,
      1.0, 1000.0
    );
    lightCamera.matrixAutoUpdate = false;

    this.cascades.push({
      cfg: c,
      renderTarget: renderTarget,
      lightCamera: lightCamera,
      shadowMatrix: new THREE.Matrix4(),
      depthRange: 0.0
    });
  }

  //Shared blur ping-pong buffer. All cascades currently use 2048² so a single
  //buffer is sufficient (we never blur two cascades simultaneously). If a
  //future config introduces a larger cascade, gate this on max(cascade
  //mapSize) and reintroduce per-size-class buffers.
  this._blurTarget = new THREE.WebGLRenderTarget(2048, 2048, {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false
  });

  //Inline EVSM Gaussian blur material. Separable 9-tap; weights from a
  //pixel-sigma-1.5 Gaussian normalised to sum=1. Defined here rather than
  //via the shader-build pipeline because it is used only by this component
  //and is small enough to keep in one place.
  this._blurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      sourceTexture: {value: null},
      blurDirection: {value: new THREE.Vector2(0.0, 0.0)}
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){',
      '  vUv = position.xy * 0.5 + 0.5;',
      '  gl_Position = vec4(position.xy, 0.0, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D sourceTexture;',
      'uniform vec2 blurDirection;',
      'varying vec2 vUv;',
      'const float W0 = 0.227027;',
      'const float W1 = 0.194595;',
      'const float W2 = 0.121622;',
      'const float W3 = 0.054054;',
      'const float W4 = 0.016216;',
      'void main(){',
      '  vec4 result = texture2D(sourceTexture, vUv) * W0;',
      '  result += texture2D(sourceTexture, vUv + blurDirection * 1.0) * W1;',
      '  result += texture2D(sourceTexture, vUv - blurDirection * 1.0) * W1;',
      '  result += texture2D(sourceTexture, vUv + blurDirection * 2.0) * W2;',
      '  result += texture2D(sourceTexture, vUv - blurDirection * 2.0) * W2;',
      '  result += texture2D(sourceTexture, vUv + blurDirection * 3.0) * W3;',
      '  result += texture2D(sourceTexture, vUv - blurDirection * 3.0) * W3;',
      '  result += texture2D(sourceTexture, vUv + blurDirection * 4.0) * W4;',
      '  result += texture2D(sourceTexture, vUv - blurDirection * 4.0) * W4;',
      '  gl_FragColor = result;',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false
  });
  this._blurScene = new THREE.Scene();
  this._blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._blurMaterial);
  this._blurScene.add(this._blurQuad);

  //Static bias/shadow matrix constant — converts light clip space [-1,1]
  //into texture UV space [0,1] + depth [0,1].
  this._texSpaceMatrix = new THREE.Matrix4().set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  this._cameraWorldPos = new THREE.Vector3();
  this._lightForward = new THREE.Vector3();
  this._lightRight = new THREE.Vector3();
  this._lightUp = new THREE.Vector3();
  this._worldUp = new THREE.Vector3(0.0, 1.0, 0.0);
  this._unsnappedPivot = new THREE.Vector3();
  this._snappedPivot = new THREE.Vector3();
  //Reusable scratch for render() — keeps the per-frame path allocation-free.
  this._prevClearColor = new THREE.Color();
  this._prevMaterials = [];

  //Cached "no occluder" clear color: moments for depth=1.0 (far plane).
  //Receiver Chebyshev with these reads as fully lit for any refZ < 1.0.
  //Recomputed when evsmExpC changes via setEvsmExpC().
  this._evsmClearColor = new THREE.Color();
  this._evsmClearAlpha = 0.0;
  this._recomputeEvsmClear();

  this.oceanMeshes = [];
  this.shadowMaterials = [];
  this.casterRingIndices = [];
};

ARestlessOcean.OceanShadowCSM.prototype._recomputeEvsmClear = function(){
  const c = this._evsmExpC;
  const pos = Math.exp(c);
  const neg = -Math.exp(-c);
  this._evsmClearColor.setRGB(pos, pos * pos, neg);
  this._evsmClearAlpha = neg * neg;
};

//Live-tune the EVSM warp constant. Pushes to all caster materials and
//updates the cached clear color. Receiver's evsmExpC must be updated
//separately via ocean-grid's console hook.
ARestlessOcean.OceanShadowCSM.prototype.setEvsmExpC = function(c){
  this._evsmExpC = +c;
  this._recomputeEvsmClear();
  for(let i = 0, L = this.shadowMaterials.length; i < L; i++){
    this.shadowMaterials[i].uniforms.evsmExpC.value = this._evsmExpC;
  }
};

//Register an ocean InstancedMesh as a caster. Called from ocean-grid each
//time a clipmap tile gets instantiated. ringIndex determines cascade
//membership: each cascade has a maxRing, and the mesh joins cascade c
//only if ringIndex <= c.maxRing. Layer membership is set ONCE here.
ARestlessOcean.OceanShadowCSM.prototype.addCaster = function(mesh, ringIndex){
  if(this.oceanMeshes.indexOf(mesh) !== -1) return;
  const shadowMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(this._shadowMatDef.uniforms),
    vertexShader: this._shadowMatDef.vertexShader,
    fragmentShader: this._shadowMatDef.fragmentShader,
    side: THREE.DoubleSide
  });
  shadowMat.uniforms.ringIndex.value = ringIndex;
  shadowMat.uniforms.evsmExpC.value = this._evsmExpC;
  this.oceanMeshes.push(mesh);
  this.shadowMaterials.push(shadowMat);
  this.casterRingIndices.push(ringIndex);

  for(let i = 0; i < this.numCascades; i++){
    if(ringIndex <= this.cascadeConfigs[i].maxRing){
      mesh.layers.enable(this.cascadeConfigs[i].layer);
    }
  }
};

//Per-frame: for each cascade, fit camera, render moments, blur. Materials
//are swapped to the shadow ShaderMaterial once at the start and restored
//once at the end — all four cascades render under the same swap.
ARestlessOcean.OceanShadowCSM.prototype.render = function(renderer, mainCamera, sunDirection, sharedOceanUniforms){
  if(this.oceanMeshes.length === 0) return;
  if(-sunDirection.y <= 0.0) return;

  mainCamera.getWorldPosition(this._cameraWorldPos);

  for(let i = 0, L = this.shadowMaterials.length; i < L; i++){
    const u = this.shadowMaterials[i].uniforms;
    u.cascadeDisplacementTextures.value = sharedOceanUniforms.cascadeDisplacementTextures.value;
    u.cascadePatchSizes.value = sharedOceanUniforms.cascadePatchSizes.value;
    u.cascadeSpatialOffsets.value = sharedOceanUniforms.cascadeSpatialOffsets.value;
    u.waveHeightMultiplier.value = sharedOceanUniforms.waveHeightMultiplier.value;
    u.sizeOfOceanPatch.value = sharedOceanUniforms.sizeOfOceanPatch.value;
    u.chop.value = sharedOceanUniforms.chop.value;
    u.mainCameraPosition.value.copy(this._cameraWorldPos);
  }

  const pivotX = this._cameraWorldPos.x;
  const pivotY = this.oceanGrid.heightOffset;
  const pivotZ = this._cameraWorldPos.z;

  this._lightForward.copy(sunDirection);
  this._lightRight.crossVectors(this._worldUp, this._lightForward);
  if(this._lightRight.lengthSq() < 1e-6){
    this._lightRight.set(1.0, 0.0, 0.0);
  } else {
    this._lightRight.normalize();
  }
  this._lightUp.crossVectors(this._lightForward, this._lightRight).normalize();
  this._unsnappedPivot.set(pivotX, pivotY, pivotZ);
  const pivotForward = this._unsnappedPivot.dot(this._lightForward);
  const unsnappedRight = this._unsnappedPivot.dot(this._lightRight);
  const unsnappedUp    = this._unsnappedPivot.dot(this._lightUp);

  //Sun-aware depth slab. The original halfDepth = halfExtent + waveMargin
  //was sized for the worst case (sun grazing the horizon, where a fragment
  //at +halfExtent on the sea plane projects ~halfExtent along the light
  //ray). At high sun the lateral projection collapses and the slab is
  //wildly oversized — wave heights of a few metres get encoded across a
  //110m+ depth window, so EVSM moment precision goes to hell and triangle
  //silhouettes start showing through. Scale by the sine of the zenith
  //angle (sqrt of the horizontal component of sunDir) so the slab tracks
  //the actual depth range the casters need.
  const sunHorizontalFactor = Math.sqrt(Math.max(0.0, 1.0 - sunDirection.y * sunDirection.y));

  const prevMaterials = this._prevMaterials;
  prevMaterials.length = 0;
  for(let i = 0, L = this.oceanMeshes.length; i < L; i++){
    prevMaterials.push(this.oceanMeshes[i].material);
    this.oceanMeshes[i].material = this.shadowMaterials[i];
  }

  const prevTarget = renderer.getRenderTarget();
  const prevClearColor = this._prevClearColor;
  renderer.getClearColor(prevClearColor);
  const prevClearAlpha = renderer.getClearAlpha();
  const prevShadowAutoUpdate = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;

  for(let i = 0; i < this.numCascades; i++){
    const cascade = this.cascades[i];
    const cfg = cascade.cfg;
    const lightCamera = cascade.lightCamera;

    const halfExtent = cfg.extent * 0.5;
    const halfDepth = halfExtent * sunHorizontalFactor + this._waveMargin;
    const lightDistance = halfDepth + 100.0;
    cascade.depthRange = halfDepth * 2.0;

    const texelSize = cfg.extent / cfg.mapSize;
    const snappedRight = Math.round(unsnappedRight / texelSize) * texelSize;
    const snappedUp    = Math.round(unsnappedUp    / texelSize) * texelSize;
    this._snappedPivot.set(0.0, 0.0, 0.0)
      .addScaledVector(this._lightRight,   snappedRight)
      .addScaledVector(this._lightUp,      snappedUp)
      .addScaledVector(this._lightForward, pivotForward);
    const snappedPivotX = this._snappedPivot.x;
    const snappedPivotY = this._snappedPivot.y;
    const snappedPivotZ = this._snappedPivot.z;

    lightCamera.position.set(
      snappedPivotX - sunDirection.x * lightDistance,
      snappedPivotY - sunDirection.y * lightDistance,
      snappedPivotZ - sunDirection.z * lightDistance
    );
    lightCamera.lookAt(snappedPivotX, snappedPivotY, snappedPivotZ);
    lightCamera.updateMatrix();
    lightCamera.updateMatrixWorld(true);
    lightCamera.near = lightDistance - halfDepth;
    lightCamera.far  = lightDistance + halfDepth;
    lightCamera.updateProjectionMatrix();
    lightCamera.matrixWorldInverse.copy(lightCamera.matrixWorld).invert();

    cascade.shadowMatrix.identity();
    cascade.shadowMatrix.multiply(this._texSpaceMatrix);
    cascade.shadowMatrix.multiply(lightCamera.projectionMatrix);
    cascade.shadowMatrix.multiply(lightCamera.matrixWorldInverse);

    lightCamera.layers.set(cfg.layer);

    //Caster pass — render into the moment color target. Clear values are
    //the EVSM moments for depth=1.0 (far plane / no occluder), so any
    //texel not covered by a caster reads as "fully lit" through the
    //Chebyshev evaluation in the receiver. clearColor is unclamped on
    //float color buffers (WebGL2 spec), so the large positive R/G values
    //(~148, ~22000) pass through unchanged.
    renderer.setRenderTarget(cascade.renderTarget);
    renderer.setClearColor(this._evsmClearColor, this._evsmClearAlpha);
    renderer.clear(true, true, false);
    renderer.render(this.scene, lightCamera);

    //Separable Gaussian blur of the moment texture. Without this, per-texel
    //variance is near zero (typically 1-2 caster triangle samples per
    //texel) and the EVSM Chebyshev bound degenerates back to a hard depth
    //comparison — exactly the artifact we replaced. The blur is what makes
    //the variance term meaningful.
    //Stride of 2 texels per tap (instead of 1) doubles the kernel reach
    //from 4 to 8 texels each side without adding taps. Receiver-side
    //oceanCascadeMarginUV must stay >= 9 texels to keep cascade-edge
    //fragments out of the blur footprint.
    const blurTarget = this._blurTarget;
    const texelUv = 2.0 / cfg.mapSize;

    this._blurMaterial.uniforms.sourceTexture.value = cascade.renderTarget.texture;
    this._blurMaterial.uniforms.blurDirection.value.set(texelUv, 0.0);
    renderer.setRenderTarget(blurTarget);
    renderer.render(this._blurScene, this._blurCamera);

    this._blurMaterial.uniforms.sourceTexture.value = blurTarget.texture;
    this._blurMaterial.uniforms.blurDirection.value.set(0.0, texelUv);
    renderer.setRenderTarget(cascade.renderTarget);
    renderer.render(this._blurScene, this._blurCamera);
  }

  renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClearColor, prevClearAlpha);

  for(let i = 0, L = this.oceanMeshes.length; i < L; i++){
    this.oceanMeshes[i].material = prevMaterials[i];
  }
};



//Jerlov ocean water type presets (Jerlov 1968, 1976). Each row is
//{ absorption, scattering } in m^-1 at RGB sampling wavelengths (~615/540/465 nm).
//Index 0 is null — selects "custom" mode (use explicit water_absorption /
//water_scattering attributes). Indices 1..7 walk the Jerlov classification
//from clearest open ocean to turbid coastal water; resulting body-color
//albedo (b/(a+b)) shifts saturated-blue → blue-green → teal → green-grey
//as the type number rises, matching real ocean photography.
//
//   1 — Jerlov I:     open ocean, clearest, deep indigo/cobalt
//   2 — Jerlov IB:    clear open ocean, slightly less saturated
//   3 — Jerlov II:    typical open ocean, blue with hint of green
//   4 — Jerlov III:   Mediterranean-style blue-teal
//   5 — Coastal 1C:   clear coastal, turquoise/teal
//   6 — Coastal 3C:   green coastal
//   7 — Coastal 5C:   turbid green-grey
//
//Pope & Fry 1997 pure-water absorption sits just under Type 1. If the rendered
//water reads "too cobalt," step up the type number — higher types add CDOM /
//particulate scattering that lifts the green channel and desaturates the blue.
ARestlessOcean.JERLOV_PRESETS = [
  null,
  { absorption: {x: 0.279, y: 0.061, z: 0.015}, scattering: {x: 0.001, y: 0.002, z: 0.003} }, // I
  { absorption: {x: 0.284, y: 0.074, z: 0.025}, scattering: {x: 0.003, y: 0.004, z: 0.005} }, // IB
  { absorption: {x: 0.286, y: 0.078, z: 0.050}, scattering: {x: 0.005, y: 0.006, z: 0.008} }, // II
  { absorption: {x: 0.291, y: 0.099, z: 0.090}, scattering: {x: 0.010, y: 0.012, z: 0.015} }, // III
  { absorption: {x: 0.330, y: 0.135, z: 0.155}, scattering: {x: 0.030, y: 0.035, z: 0.040} }, // 1C
  { absorption: {x: 0.370, y: 0.190, z: 0.275}, scattering: {x: 0.050, y: 0.060, z: 0.060} }, // 3C
  { absorption: {x: 0.520, y: 0.330, z: 0.530}, scattering: {x: 0.080, y: 0.090, z: 0.090} }, // 5C
];

//Dedicated layer for ocean geometry (water patches + horizon skirt).
//
//Water meshes are taken OFF the default layer 0 and placed on this layer
//instead so that:
//  - the foam ortho camera (default layer 0) does not capture the water
//    surface itself — its position-pass output is meant to be terrain Y for
//    shore-foam height comparison, and capturing water mesh baseline Y
//    instead produced false shore-foam across the entire open ocean.
//  - the per-cascade ocean-CSM light cameras already use their own layers
//    (7..10, set by ocean-shadow-csm.js:addCaster) and are unaffected.
//  - any future cameras (or third-party scene cameras) that want to see the
//    ocean must `camera.layers.enable(ARestlessOcean.OCEAN_LAYER)` —
//    likewise any future ocean-class meshes (extra water bodies, foam
//    decals, etc.) should call `mesh.layers.set(ARestlessOcean.OCEAN_LAYER)`.
//  - cameras that should NOT see water (foam capture, exclusion capture)
//    intentionally do nothing — staying on layer 0 keeps them ignorant of
//    ocean geometry by design.
//
//Picked 29 because the exclusion camera already uses 30; keeping them
//adjacent makes the "ocean-system reserved layers" cluster obvious.
ARestlessOcean.OCEAN_LAYER = 29;

ARestlessOcean.OceanGrid = function(scene, renderer, camera, parentComponent){
  //Variable for holding all of our patches
  //For now, just create 1 plane
  this.scene = scene;
  const data = parentComponent.data;
  this.parentComponent = parentComponent;
  this.renderer = renderer;
  this.camera = camera;
  //Main scene camera needs to see the ocean even though water meshes have
  //been moved off layer 0 — see OCEAN_LAYER comment above.
  this.camera.layers.enable(ARestlessOcean.OCEAN_LAYER);
  this.oceanPatches = [];
  this.oceanPatchIsInFrustrum = [];
  this.drawDistance = data.draw_distance;
  this.patchSize = data.patch_size;
  this.dataPatchSize = data.patch_size;
  this.heightOffset = data.height_offset;
  this.causticsEnabled = data.caustics_enabled;
  this.causticsStrength = data.caustics_strength;
  this.reflectionScale = data.reflection_scale;
  this.reflectionDistanceFalloff = data.reflection_distance_falloff;
  //SSR march step cap (live-tunable via window.setSsrMaxSteps). 48 = original
  //full reach. The SSR ray-march is the dominant per-pixel water cost; lower
  //trades reflection reach for fill rate, 0 = sky-only (bottleneck A/B test).
  this.ssrMaxSteps = 48;
  this.fresnelDistanceRoughness = data.fresnel_distance_roughness;
  this.surfaceRoughness = 0.08;
  //Crest-style sun-glint controls (see water-shader.glsl). Defaults reproduce
  //the legacy ungated additive glint: gate 0, far falloff == near (275) so the
  //distance ramp is a no-op, boost 7.0. Dial via the window.setSpec* helpers.
  this.specFresnelGate = 0.0;
  this.specBoost = 7.0;
  this.specFalloffFar = 275.0;
  this.specFalloffFarDist = 200.0;
  this.foamEnabled = data.foam_enabled;
  this.foamStart = data.foam_start;
  this.data = data;
  this.time = 0.0;
  this.causticMap;
  this.foamColorMap;
  this.foamOpacityMap;
  this.foamNormalMap;
  this.foamRenderMap;
  this.exclusionMap;
  this.windVelocity = data.wind_velocity;
  this.atmosphericPerspectiveEnabled = data.atmospheric_perspective_enabled;
  this.atmosphericPerspectiveDistanceScale = data.atmospheric_perspective_distance_scale;
  this.skyDirector = null;
  this.atmosphereFunctionsGLSL = null;
  //Clip planes with small bias to prevent waterline artifacts
  this.refractionClipPlane = new THREE.Plane();
  this.refractionClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, this.heightOffset, 0));
  this.foamClipPlane = new THREE.Plane();
  this.foamClipPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, this.heightOffset + 1.0, 0));
  //Foam-texture scroll velocity: wind-relative, ~20° off wind axis at 4% of
  //wind speed. Slow drift so the foam-bubble texture doesn't read as racing
  //across the surface.
  const windAngle = Math.atan2(this.windVelocity.y, this.windVelocity.x);
  const windSpeed = Math.sqrt(this.windVelocity.x ** 2 + this.windVelocity.y ** 2);
  const foamScrollSpeed = windSpeed * 0.04;
  this.foamScrollVelocityVec = [
    foamScrollSpeed * Math.cos(windAngle + 0.34),
    foamScrollSpeed * Math.sin(windAngle + 0.34),
  ];
  //Wind-driven foam bias ("dip the Jacobian", Sea-of-Thieves style): as the sea
  //roughens we lift the fold signal in the water shader so progressively gentler
  //folds, and eventually the open surface itself, turn to foam/streaks. Ramps
  //linearly from foamWindStart (no extra bias, just real folds) to foamWindFull
  //(saturated), scaled to foamWindBiasMax added to the shader's `turbulence`.
  //With FOAM_TURB_THRESHOLD=0.5 the open surface starts foaming once the bias
  //passes ~0.5 and is fully white by ~0.75. Plain-JS, live-tunable per frame.
  this.foamWindStart = 10.0;    //m/s: whitecap-extra onset.
  this.foamWindFull = 50.0;     //m/s: bias saturates here (storm).
  this.foamWindBiasMax = 0.6;   //max value added to turbulence (FUDGE / art).
  this._foamWindBias = 0.0;     //computed each frame from current wind.
  this.raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.0,100.0,0.0),
    this.downVector
  );
  this.cameraFrustum = new THREE.Frustum();

  this.brightestDirectionalLight = false;
  this.directionalLights = [];

  let self = this;

  //Make sure the magnitude of the wind velocity is greater then 0.01, otherwise
  //set it to this to avoid data errors.
  this.windVelocity.x = Math.abs(this.data.wind_velocity.x) < 0.01 ? 0.01 : this.windVelocity.x;
  this.windVelocity.y = Math.abs(this.data.wind_velocity.y) < 0.01 ? 0.01 : this.windVelocity.y;

  const textureLoader = new THREE.TextureLoader();

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

  //Number of cascades (matches ocean-height-band-library cascade count)
  this.numberOfOceanHeightBands = 6;

  let rendererSize = new THREE.Vector2();
  this.renderer.getDrawingBufferSize(rendererSize);

  //Set up screen-space G-buffer for refraction pass. Three attachments:
  //  0: albedo + opaque-mask in .a   (stub-grey for now; per-mesh in A1)
  //  1: world-space normal in .rgb
  //  2: linear view-space depth in .r (replaces the old separate linearize pass)
  //A WebGL2 MRT — the scene is rendered once via scene.overrideMaterial below,
  //and the water shader later samples albedo + normal to relight the seabed
  //inside the body-color path (Step 5 of docs/water-review/SUMMARY.txt).
  this.refractionGBufferTarget = new THREE.WebGLRenderTarget(
    rendererSize.x, rendererSize.y,
    {
      count: 3,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(
        rendererSize.x, rendererSize.y,
        THREE.UnsignedIntType
      )
    }
  );
  this.refractionGBufferTarget.depthTexture.format = THREE.DepthFormat;

  //── Underwater planar reflection ─────────────────────────────────────────
  //The TIR "mirror" the underwater ceiling samples outside Snell's window —
  //the underwater scene rendered each submerged frame from a virtual camera
  //mirrored across the rest water plane. Half-resolution: the sample is
  //wave-distorted and fogged so it needs no crispness, and the whole pass is
  //skipped entirely above water. HalfFloat so un-tone-mapped (linear) scene
  //radiance is not clamped at 1.
  this.reflectionResolutionScale = 0.5;
  this._reflectionTarget = new THREE.WebGLRenderTarget(
    Math.max(1, (rendererSize.x * this.reflectionResolutionScale) | 0),
    Math.max(1, (rendererSize.y * this.reflectionResolutionScale) | 0),
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType
    }
  );
  this._reflectionCamera = new THREE.PerspectiveCamera();
  this._reflectionTextureMatrix = new THREE.Matrix4();

  //── Above-water transmission target ──────────────────────────────────────
  //Sampled by the underwater ceiling's Snell-window transmitted ray. The
  //refraction G-buffer is wrong for that lookup — it strips materials to
  //raw albedo, hides the sky dome, and skips above-water atmospheric fog,
  //so above-water content reads as flat unshaded ghost shapes through the
  //surface. This RT is a separate submerged-frame render of the FULLY-LIT
  //scene: sky dome restored, real materials, atmospheric perspective from
  //a-starry-sky reinstated, ocean grid + curtain hidden. Half-res HalfFloat
  //matching the reflection target — the sample is wave-distorted so it
  //needs no crispness, and HalfFloat keeps un-tone-mapped sky radiance
  //unclamped. Skipped entirely above water (the sample is never read then).
  this._aboveWaterTransmissionTarget = new THREE.WebGLRenderTarget(
    Math.max(1, (rendererSize.x * this.reflectionResolutionScale) | 0),
    Math.max(1, (rendererSize.y * this.reflectionResolutionScale) | 0),
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType
    }
  );

  //── Underwater caustic projection ────────────────────────────────────────
  //The water shader paints caustics onto the refracted seabed when the camera
  //is ABOVE water; submerged, the seabed is seen directly and never passes
  //through the water shader. To put caustics on it without touching the (often
  //imported, unknown) seabed materials, project them with a SpotLight cookie —
  //the one THREE light type whose `.map` is cast onto whatever it lights, on
  //any material, no shader surgery. SpotLight.map projects a single "slide"
  //across the cone and ignores texture repeat/offset, so the tiling AND the
  //animation are baked into the slide here: a small RT re-rendered each
  //submerged frame. The slide is periodic across [0,1] (integer tiling), and
  //the projector XZ is snapped to one tile, so the cast pattern is world-
  //stable as the camera swims (the foam-camera texel-snap trick).
  this.causticProjectionResolution = 4096;
  this.causticProjectionTiling = 48;      //caustic-map repeats across the slide (integer!)
  this.causticLightHeight = 400.0;        //metres the projector sits above the surface
  this.causticLightConeRadius = 60.0;     //ground radius the cone covers
  this.causticLightIntensity = 6.0;       //MAIN KNOB — caustic brightness on the seabed
  this._causticProjectionTarget = new THREE.WebGLRenderTarget(
    this.causticProjectionResolution, this.causticProjectionResolution,
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    }
  );
  this._causticProjectionScene = new THREE.Scene();
  this._causticProjectionCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._causticProjectionMaterial = new THREE.ShaderMaterial({
    uniforms: {
      causticMap: {value: null},
      uTime: {value: 0.0},
      uTiling: {value: this.causticProjectionTiling}
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){',
      '  vUv = uv;',
      '  gl_Position = vec4(position.xy, 0.0, 1.0);',
      '}'
    ].join('\n'),
    //Mirrors causticShader() in water-shader.glsl: two non-parallel scrolling
    //samples min'd together, then a smoothstep contrast curve. Integer uTiling
    //keeps the slide seamless across [0,1] so it tiles on the snap grid. The
    //three chromatically-offset taps give caustic light its R/B dispersion —
    //the foci of different wavelengths land slightly apart (matches the
    //+/-0.005 caustic-UV offset the water shader's causticShader uses).
    fragmentShader: [
      'uniform sampler2D causticMap;',
      'uniform float uTime;',
      'uniform float uTiling;',
      'varying vec2 vUv;',
      'float caustic(vec2 uv, float t){',
      '  vec2 uv1 = uv + vec2(0.8, 0.1) * t;',
      '  vec2 uv2 = uv - vec2(0.2, 0.7) * t;',
      '  float a = texture2D(causticMap, uv1).r;',
      '  float b = texture2D(causticMap, uv2).g;',
      '  return smoothstep(0.15, 0.85, min(a, b));',
      '}',
      'void main(){',
      '  vec2 uv = vUv * uTiling;',
      '  float t = uTime / 8.0;',
      '  float r = caustic(uv + vec2(0.005), t);',
      '  float g = caustic(uv,               t);',
      '  float b = caustic(uv - vec2(0.005), t);',
      '  gl_FragColor = vec4(r, g, b, 1.0);',
      '}'
    ].join('\n'),
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  this._causticProjectionScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 2.0), this._causticProjectionMaterial
  ));

  //The projector. distance 0 → no hard cutoff. decay 2 (inverse-square) gives
  //a soft depth falloff: fragments farther from the projector (= deeper, since
  //the projector sits above the surface and tracks the camera XZ) receive
  //less light, approximating the Beer-Lambert attenuation of sunlight on its
  //way down to the seabed. The runtime compensates intensity by
  //pow(causticLightHeight, decay) so surface-level brightness matches what
  //the old decay-0 cast produced — only the depth gradient is new.
  //castShadow stays off — the scene sun already shadows the seabed, and
  //SpotLight.map updates its projection matrix on its own (WebGLLights calls
  //shadow.updateMatrices when a map is present). Kept permanently in the
  //scene with intensity driven to 0 above water: toggling light.visible would
  //change the visible-light count and recompile every lit material on each
  //waterline crossing.
  this.causticSpotLight = new THREE.SpotLight(0xffffff, 0.0);
  this.causticSpotLight.decay = 2.0;
  this.causticSpotLight.distance = 0.0;
  this.causticSpotLight.penumbra = 0.8;
  this.causticSpotLight.angle = Math.atan(this.causticLightConeRadius / this.causticLightHeight);
  this.causticSpotLight.castShadow = false;
  this.causticSpotLight.map = this._causticProjectionTarget.texture;
  this._causticLightAdded = false;

  //── Underwater fog (via A-Starry-Sky's fog reservation hook) ──────────────
  //Geometry seen DIRECTLY underwater (the seabed) is drawn by its own
  //materials and never touches the water shader. A-Starry-Sky's `advanced`
  //atmospheric perspective globally patches THREE.ShaderChunk.fog_* and leaves
  //an empty reserved branch keyed on `fogNear < 0.0`; _injectUnderwaterFogChunk()
  //below fills that slot with a Beer-Lambert absorption fog whose colour is
  //derived from the SAME waterAlbedo/downwelling/depthDarken stack the water
  //shader uses for its ceiling fog — so the seabed murk and the ceiling murk
  //read as the same medium. THREE.Fog only carries one Color + two floats, so
  //the smuggle puts the murk colour itself in fog.color (rather than
  //extinction, which the pre-2026-05-23 chunk did and which produced a navy
  //seabed against a teal ceiling). Monochrome distance falloff in exchange.
  //  fog.color = inscatter murk colour (linear) — matches water shader
  //  fog.near  = -waterSurfaceY (selects ocean branch + world-Y gate)
  //  fog.far   = scalar transmittance density (1/m), avg of extinction
  this.underwaterFogColor = new THREE.Color(0.12, 0.24, 0.27);   //sky-dome bg swap colour fallback
  //Multiplier on the computed murk colour. Our inscatter formula
  //(albedo · (sun + ambient) / π) assumes ISOTROPIC phase, but real water
  //is strongly forward-scattering — the back-scattered radiance reaching the
  //eye is a fraction of what the isotropic formula predicts. 0.35 is the
  //empirical compensation that makes shallow water read as "subtle absorption"
  //rather than "saturated cyan." Live-tunable; will likely become a data
  //attribute once we expose a user-facing parameter.
  this.underwaterFogBrightness = 0.35;
  this._oceanFog = new THREE.Fog(0x1a2d33, -1.0, 1.0);  //near<0 + far>0 => ocean branch
  this._capturedSkyFog = undefined;            //A-Starry-Sky's fog, tracked while above water
  this._fogChunkInjected = false;
  this._uwMurkScratch = new THREE.Vector3();   //per-frame murk scratch (avoid alloc)
  //Camera-depth-darkened murk for the curtain/background. Normally recomputed
  //each frame in the underwater inscatter block — but that block is gated on
  //`_fogChunkInjected`, which is false when a-starry-sky (whose reserved fog
  //slot we hook) is absent. Seed a default dark-teal so the curtain/background
  //consumers never dereference undefined and underwater degrades gracefully
  //instead of crashing when running without a-starry-sky.
  this._uwMurkCamDepthScratch = new THREE.Vector3(0.02, 0.06, 0.08);
  this._uwSunDirScratch = new THREE.Vector3();
  //Ambient (downwelling) hemisphere light discovered standalone — fills the
  //inscatter ambient term that normally comes from a-starry-sky's y-axis
  //hemispherical. Found in the per-frame light scan; null until then.
  this._fallbackHemiLight = null;

  //Sky downwelling ambient, shared by the underwater murk, the body-colour
  //blend, and splash lighting. a-starry-sky drives THREE oriented
  //HemisphereLights as a cheap SH-ambient probe (see A-Starry-Sky
  //LightingManager.js tick): xAxis points along the sun azimuth, yAxis straight
  //up (zenith), zAxis the perpendicular horizontal; each `.color` is that axis's
  //sky-side irradiance, `.groundColor` the seabed/ground bounce side.
  //
  //We USED to read only yAxis.color as "the downwelling sky" — but that axis
  //routinely clamps to ~black. Its value is the order-2 SH irradiance evaluated
  //straight up, then max-normalised against all 18 hemi channels; at most sun
  //elevations the zenith lobe rings slightly negative and evalSHHemi clamps it to
  //0, while the two HORIZONTAL axes carry the real sky colour. So reading the
  //zenith alone gave a black ambient and the whole underwater murk collapsed to
  //the sun-only term.
  //
  //The physically-correct "downwelling sky onto a horizontal surface" is exactly
  //what THREE computes when it lights an up-facing (+Y normal) receiver with
  //these three lights: each HemisphereLight contributes
  //mix(groundColor, color, 0.5 + 0.5*dot(N, axisDir)). For N = +Y the two
  //horizontal axes land at dot=0 -> 0.5*color, and the zenith axis at dot=1 ->
  //1.0*color. We take the SKY side only (drop groundColor — the murk inscatter is
  //driven by light entering the water from the sky, not by the floor bounce):
  //    skyAmbient = 0.5*xColor + 1.0*yColor + 0.5*zColor   (each * its intensity)
  //This is robust to the zenith clamping to 0 (the horizontals still sum to the
  //full horizon sky) and stays consistent with how the rest of the scene is lit.
  //Result lands in _skyAmbientScratch (linear RGB); returns true if a source was
  //found. NOT view/camera dependent — these are global scene lights shared by
  //every render pass (main and the reflection mirror alike), so this same value
  //fogs the directly-viewed seabed and the reflected ceiling identically.
  //THREE applies LinearToSRGB to a Fog's `.color` when it uploads it as the
  //`fogColor` uniform, so a color set with raw LINEAR values arrives ~brightened
  //in the shader. The underwater fog chunk reads `fogColor` directly as a linear
  //radiance (the murk baseline `albedo·(E_sun+E_sky)/4π`), so we must pre-apply
  //the inverse (SRGBToLinear) when writing _oceanFog.color — exactly as
  //a-starry-sky's FogRenderer does for its own fog (toFogUniform). Without this
  //the chunk-fogged seabed/curtain murk renders ~3× too bright (e.g. a 0.09 sRGB
  //murk reads as 0.57) while the water-shader ceiling — which reads plain Vector3
  //uniforms, not color-managed — stays correct. That mismatch was the glowing
  //seabed. Per-channel SRGBToLinear, matching THREE's sRGB transfer function.
  this._toFogUniform = function(v){
    return v < 0.04045 ? v * 0.0773993808 : Math.pow(v * 0.9478672986 + 0.0521327014, 2.4);
  };

  this._skyAmbientScratch = new THREE.Vector3();
  this._readSkyAmbient = function(){
    const out = self._skyAmbientScratch;
    if(self.skyDirector && self.skyDirector.lightingManager){
      const lm = self.skyDirector.lightingManager;
      const xL = lm.xAxisHemisphericalLight;
      const yL = lm.yAxisHemisphericalLight;
      const zL = lm.zAxisHemisphericalLight;
      const xI = xL.intensity * 0.5, yI = yL.intensity, zI = zL.intensity * 0.5;
      out.set(
        xL.color.r * xI + yL.color.r * yI + zL.color.r * zI,
        xL.color.g * xI + yL.color.g * yI + zL.color.g * zI,
        xL.color.b * xI + yL.color.b * yI + zL.color.b * zI
      );
      return true;
    } else if(self._fallbackHemiLight){
      //Single scene HemisphereLight: an up-facing receiver gets the full sky side.
      const hL = self._fallbackHemiLight;
      out.set(hL.color.r * hL.intensity, hL.color.g * hL.intensity, hL.color.b * hL.intensity);
      return true;
    }
    return false;
  };

  //── Sky provider resolution + standalone underwater-fog scaffold ──────────
  //The underwater seabed/curtain murk (see _injectUnderwaterFogChunk) hooks a
  //reservation slot in THREE.ShaderChunk.fog_* that a-starry-sky installs as
  //part of its atmospheric-perspective fog. Without a-starry-sky that slot
  //never exists, so the seabed renders un-fogged (flat). Detection by sniffing
  //for the token can't tell "a-starry-sky not initialised yet" from "no
  //a-starry-sky at all" (both look token-absent at frame 1), so we resolve the
  //provider up front off the DOM/markup instead.
  this._resolveSkyProvider = function(){
    const declared = (self.data && typeof self.data.sky_provider === 'string')
      ? self.data.sky_provider.toLowerCase() : 'auto';
    if(declared === 'standalone' || declared === 'a-starry-sky'){
      return declared;
    }
    //auto: the element's PRESENCE in the page is a deterministic signal
    //available before a-starry-sky has initialised — unlike its patched
    //ShaderChunk, which only appears a tick or two later.
    const hasGlobal = (typeof StarrySky !== 'undefined');
    const hasElement = (typeof document !== 'undefined') &&
      !!document.querySelector('a-starry-sky');
    return (hasGlobal || hasElement) ? 'a-starry-sky' : 'standalone';
  };

  //Install a minimal, self-contained fog scaffold into THREE.ShaderChunk.fog_*
  //carrying the SAME reservation tokens a-starry-sky leaves, so the existing
  //_injectUnderwaterFogChunk() can fill them unchanged. We deliberately do NOT
  //replicate a-starry-sky's atmosphere here — only the plumbing the ocean
  //branch needs: the vFogWorldPosition varying, the sRGB helpers the chunk
  //calls, and a stock linear-fog else-branch for fogNear >= 0. Idempotent and
  //skipped entirely when a-starry-sky owns the slot.
  this._installStandaloneFogScaffold = function(){
    if(self._standaloneFogScaffoldInstalled) return;
    const fragToken = '//$$OCEAN_SHADER_SHADER_FRAGMENT_RESERVATION$$';
    const vertToken = '//$$OCEAN_SHADER_SHADER_VERTEX_RESERVATION$$';
    //If something already provided the token (a-starry-sky raced us), don't
    //clobber it — let _injectUnderwaterFogChunk fill whatever is there.
    if(THREE.ShaderChunk.fog_fragment &&
       THREE.ShaderChunk.fog_fragment.indexOf(fragToken) !== -1){
      self._standaloneFogScaffoldInstalled = true;
      return;
    }
    THREE.ShaderChunk.fog_pars_vertex = [
      '#ifdef USE_FOG',
      '  varying float vFogDepth;',
      '  varying vec3 vFogWorldPosition;',
      '#endif'
    ].join('\n');
    THREE.ShaderChunk.fog_vertex = [
      '#ifdef USE_FOG',
      '  ' + vertToken,
      '#endif'
    ].join('\n');
    THREE.ShaderChunk.fog_pars_fragment = [
      '#ifdef USE_FOG',
      '  uniform vec3 fogColor;',
      '  varying float vFogDepth;',
      '  varying vec3 vFogWorldPosition;',
      '  #ifdef FOG_EXP2',
      '    uniform float fogDensity;',
      '  #else',
      '    uniform float fogNear;',
      '    uniform float fogFar;',
      '  #endif',
      //sRGB <-> linear helpers the injected ocean branch calls by name. Match
      //a-starry-sky's signatures (vec4 in / vec4 out) so the chunk GLSL is
      //identical on both paths.
      '  vec4 fogsRGBToLinear(vec4 c){',
      '    return vec4(mix(c.rgb / 12.92, pow((c.rgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c.rgb)), c.a);',
      '  }',
      '  vec4 fogLinearTosRGB(vec4 c){',
      '    return vec4(mix(c.rgb * 12.92, 1.055 * pow(c.rgb, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c.rgb)), c.a);',
      '  }',
      //Narkowicz ACES fit — the SAME operator a-starry-sky and water-shader.glsl
      //use. The ocean branch tonemaps its fogged result on the sRGB (main-canvas)
      //path so underwater scene geometry matches the water surface and the
      //reflection (which both go through MyAES). a-starry-sky declares this itself
      //on its path, so this copy is standalone-only — the two scaffolds are never
      //both installed, so there is no duplicate-symbol collision.
      '  vec3 MyAESFilmicToneMapping(vec3 color){',
      '    return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);',
      '  }',
      '#endif'
    ].join('\n');
    THREE.ShaderChunk.fog_fragment = [
      '#ifdef USE_FOG',
      '  #ifdef FOG_EXP2',
      '    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);',
      '    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);',
      '  #else',
      //fogNear < 0 selects the ocean branch (same convention as the a-starry-sky
      //path). The reservation token is filled by _injectUnderwaterFogChunk; the
      //else is plain linear fog so any above-water fog still works standalone.
      '    if(fogNear < 0.0){',
      '      ' + fragToken,
      '    } else {',
      '      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);',
      '      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);',
      '    }',
      '  #endif',
      '#endif'
    ].join('\n');
    self._standaloneFogScaffoldInstalled = true;
  };

  //Resolve now (constructor time, before any material compiles) and, if we own
  //the sky, lay down the scaffold so the curtain/seabed fog materials built
  //below pick it up on first compile.
  this._skyProvider = this._resolveSkyProvider();
  if(this._skyProvider === 'standalone'){
    this._installStandaloneFogScaffold();
  }

  //G-buffer override material — one per source material, built on demand.
  //Writes linear albedo (baseColor × decoded albedoMap) + geometric world-
  //space normal + linear view-space depth. Per-mesh material swap in tick()
  //below picks the right variant for each mesh before the refraction render.
  //
  //Fallback texture for materials without a .map — sampling a null sampler
  //is undefined; bind a 1×1 white pixel and gate via hasAlbedoMap uniform.
  const whiteData = new Uint8Array([255, 255, 255, 255]);
  this._gBufferWhitePixel = new THREE.DataTexture(whiteData, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  this._gBufferWhitePixel.needsUpdate = true;

  const gBufferVertexShader = [
    'out vec3 vWorldNormal;',
    'out float vViewZ;',
    'out vec2 vUv;',
    'void main(){',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  vViewZ = -mvPosition.z;',
    '  vWorldNormal = normalize(mat3(modelMatrix) * normal);',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '}'
  ].join('\n');

  //Albedo path stores LINEAR values into the HalfFloat target. Source albedo
  //maps from GLTF (the island model) are sRGB-encoded, so decode here once.
  //Material.color values are already linear (THREE.Color stores linear).
  const gBufferFragmentShader = [
    'precision highp float;',
    'layout(location = 0) out vec4 gAlbedo;',
    'layout(location = 1) out vec4 gNormal;',
    'layout(location = 2) out vec4 gLinearDepth;',
    'in vec3 vWorldNormal;',
    'in float vViewZ;',
    'in vec2 vUv;',
    'uniform vec3 baseColor;',
    'uniform sampler2D albedoMap;',
    'uniform int hasAlbedoMap;',
    'vec3 srgbToLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }',
    'void main(){',
    '  vec3 albedo = baseColor;',
    '  if(hasAlbedoMap == 1){',
    '    vec3 texel = texture(albedoMap, vUv).rgb;',
    '    albedo *= srgbToLinear(texel);',
    '  }',
    '  gAlbedo = vec4(albedo, 1.0);',
    '  gNormal = vec4(normalize(vWorldNormal), 1.0);',
    '  gLinearDepth = vec4(vViewZ, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  //Cache keyed by source-material UUID; built lazily on first sight.
  this._gBufferMaterialCache = new Map();
  this._swappedMeshes = [];

  const grid = this;
  this._buildGBufferMaterialFor = function(srcMat){
    const hasMap = !!(srcMat.map && srcMat.map.isTexture);
    const fallbackColor = new THREE.Color(0.5, 0.42, 0.32);
    const baseColorRef = (srcMat.color && srcMat.color.isColor) ? srcMat.color : fallbackColor;
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        baseColor: { value: baseColorRef },
        albedoMap: { value: hasMap ? srcMat.map : grid._gBufferWhitePixel },
        hasAlbedoMap: { value: hasMap ? 1 : 0 }
      },
      vertexShader: gBufferVertexShader,
      fragmentShader: gBufferFragmentShader,
      side: srcMat.side !== undefined ? srcMat.side : THREE.FrontSide
    });
  };

  this._resolveGBufferMaterial = function(srcMat){
    if(Array.isArray(srcMat)){
      const arr = new Array(srcMat.length);
      for(let i = 0; i < srcMat.length; ++i){
        arr[i] = grid._resolveGBufferMaterial(srcMat[i]);
      }
      return arr;
    }
    let cached = grid._gBufferMaterialCache.get(srcMat.uuid);
    if(!cached){
      cached = grid._buildGBufferMaterialFor(srcMat);
      grid._gBufferMaterialCache.set(srcMat.uuid, cached);
    }
    return cached;
  };

  //Set up depth camera pointing down for edge foam
  //1024² RGBA FloatType = ~16 MB (was 4096² ≈ 268 MB). The ortho still covers
  //4096 m, so texel size is 4 m/texel (was 1 m). Shore-foam band is 0.5–4 m
  //(water-shader: shoreFade), so the breaker line quantises to ~4 m steps —
  //bump back to 2048² (2 m/texel, ~67 MB) if the shoreline reads stair-stepped.
  this.foamRenderTarget = new THREE.WebGLRenderTarget(1024, 1024, {
    type: THREE.FloatType
  });
  this.foamCameraHeight = data.foam_camera_height;
  this.foamCamera = new THREE.OrthographicCamera(-2048.0, 2048.0, 2048.0, -2048.0, 0.1, this.foamCameraHeight + 500.0);
  this.scene.add(this.foamCamera);

  //Set up a depth camera pointing down for ocean exclusion mapping.
  //Unlike foamCamera this is NOT a terrain-height capture — it renders only
  //layer-30 meshes (boat interior hulls and similar volumes that need water
  //masked inside them). One small mesh near the camera, so the render
  //target is sized to that scope: 500 m × 500 m at 1024² ≈ 0.49 m/texel.
  //The previous 4096² × 2048 m × 2048 m sizing was a 256 MB FloatType
  //buffer to mask a single boat — pure VRAM waste.
  //
  //Keep the shader's exclusion-sample radius (water-shader.glsl, divide-by
  //in vec2(...)) in sync with this ortho extent's half-width.
  //NEAREST filtering is mandatory here: the .g channel is a discard *threshold*
  //(boat world-Y) and .a is a 0/1 mask, neither of which may be interpolated
  //across the hard boat/no-boat boundary. The RT default (LinearFilter) blended
  //the below-water interior-floor height with the rim and the cleared (G=0=sea
  //level) texels, so along the hull rim discardHeight drifted below the water
  //(over-discard → ring straight to the seabed) or above it (under-discard →
  //water leaks into the hull). NEAREST gives each water fragment one clean texel.
  //NEAREST filtering is mandatory here: the .g channel is a discard *threshold*
  //(boat world-Y) and .a is a 0/1 mask, neither of which may be interpolated
  //across the hard boat/no-boat boundary. The RT default (LinearFilter) blended
  //the below-water interior-floor height with the rim and the cleared (G=0=sea
  //level) texels, so along the hull rim discardHeight drifted below the water
  //(over-discard → ring straight to the seabed) or above it (under-discard →
  //water leaks into the hull). NEAREST gives each water fragment one clean texel.
  //
  //Residual keel-crease tris + a ~1px waterline edge remain: they're texel-
  //resolution limited (~0.49 m/texel over this 500 m ortho). Confirmed via a
  //2048² test (the tris shrank with texel size). The sharp fix is a tighter
  //ortho extent (fit-to-boat, or a smaller fixed radius) for sub-decimetre
  //texels at this same 16 MB size — deferred, as it needs the hardcoded 250 m
  //half-width in water-shader.glsl uniform-ized (a create-shader.py regen).
  this.exclusionRenderTarget = new THREE.WebGLRenderTarget(1024, 1024, {
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter
  });
  this.exclusionCamera = new THREE.OrthographicCamera(-250.0, 250.0, 250.0, -250.0, 0.1, this.foamCameraHeight + 500.0);
  this.exclusionCamera.layers.disableAll();
  this.exclusionCamera.layers.set(30);
  this.scene.add(this.exclusionCamera);

  //Initialize all shader LUTs for future ocean viewing
  //Initialize our ocean variables and all associated shaders.
  this.oceanHeightBandLibrary = new ARestlessOcean.LUTlibraries.OceanHeightBandLibrary(this);
  this.oceanHeightComposer = new ARestlessOcean.LUTlibraries.OceanHeightComposer(this);

  //Discover a-starry-sky's SkyDirector for atmospheric perspective LUTs
  if(this.atmosphericPerspectiveEnabled){
    //Try the global reference first, then fall back to DOM query
    if(typeof StarrySky !== 'undefined' && StarrySky.skyDirectorRef){
      this.skyDirector = StarrySky.skyDirectorRef;
    }
    else{
      const skyEl = document.querySelector('a-starry-sky');
      if(skyEl && skyEl.components && skyEl.components.starryskywrapper){
        this.skyDirector = skyEl.components.starryskywrapper.skyDirector;
      }
    }
    if(this.skyDirector){
      const luts = this.skyDirector.getAtmosphericLUTs();
      if(luts){
        this.atmosphereFunctionsGLSL = luts.atmosphereFunctionsString;
      }
    }
  }

  //Set up our ocean material that is used for all of our ocean patches
  //If atmospheric perspective is requested but sky isn't ready yet, start with it disabled
  //and recompile when the sky becomes available
  const atmosphereReady = this.atmosphericPerspectiveEnabled && this.atmosphereFunctionsGLSL;
  //Ocean material participates in scene.fog. NOTE: water-shader.glsl gates its
  //`#include <fog_fragment>` behind `#if(!$atmospheric_perspective_enabled)`, so
  //while AP is on the chunk does not yet fog the water surface — the bespoke
  //applyUnderwaterFog / applyAtmosphericPerspective still own that. Flag is true
  //regardless (was `!atmosphereReady`) so the fog varyings/uniforms exist and the
  //water is ready to route through the unified chunk once that gate is lifted.
  const useFog = true;
  //Vertex shader takes two template flags: $atmospheric_perspective_enabled
  //and $horizon_skirt. Ocean tiles use the {AP, no-skirt} variant; the
  //horizon skirt clones the material and uses the {AP, skirt} variant
  //which pins gl_Position.z just inside the far plane.
  function buildVertexShader(atmEnabled, skirt){
    return ARestlessOcean.Materials.Ocean.waterMaterial.vertexShader
      .replace(/\$atmospheric_perspective_enabled/g, atmEnabled ? '1' : '0')
      .replace(/\$horizon_skirt/g, skirt ? '1' : '0');
  }
  const vertexShaderSource = buildVertexShader(atmosphereReady, false);
  this.oceanMaterial = new THREE.ShaderMaterial({
    vertexShader: vertexShaderSource,
    fragmentShader: ARestlessOcean.Materials.Ocean.waterMaterial.fragmentShader(this.causticsEnabled, this.foamEnabled, atmosphereReady, this.atmosphereFunctionsGLSL),
    side: THREE.FrontSide,
    transparent: false,
    lights: false,
    fog: useFog
  });
  if(useFog){
    this.oceanMaterial.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', THREE.fogParsVert);
      shader.vertexShader = shader.vertexShader.replace(`#include <fog_vertex>`, THREE.fogVert);
      shader.fragmentShader = shader.fragmentShader.replace(`#include <fog_pars_fragment>`, THREE.fogParsFrag);
      shader.fragmentShader = shader.fragmentShader.replace(`#include <fog_fragment>`, THREE.fogFrag);
    };
  }
  this.oceanMaterial.uniforms = ARestlessOcean.Materials.Ocean.waterMaterial.uniforms;
  this.oceanMaterial.uniforms.sizeOfOceanPatch.value = this.patchSize;

  this.positionPassMaterial = new THREE.ShaderMaterial({
    vertexShader: ARestlessOcean.Materials.Ocean.positionPassMaterial.vertexShader,
    fragmentShader: ARestlessOcean.Materials.Ocean.positionPassMaterial.fragmentShader,
    side: THREE.FrontSide,
    transparent: false,
    lights: false
  });
  this.positionPassMaterial.uniforms = ARestlessOcean.Materials.Ocean.positionPassMaterial.uniforms;
  this.positionPassMaterial.uniforms.worldMatrix.value = this.camera.matrixWorld;

  //Ocean-only cascaded shadow map. Dedicated tight-frustum depth pass that
  //only contains the water InstancedMeshes — gives per-wave self-shadow that
  //the scene-wide sun shadow map can't resolve. Registered with each mesh
  //below via addCaster(). Safe to skip if the shadow material isn't loaded
  //(older builds without ocean-shadow.js).
  if(ARestlessOcean.OceanShadowCSM && ARestlessOcean.Materials.Ocean.oceanShadowMaterial){
    this.oceanShadowCSM = new ARestlessOcean.OceanShadowCSM(this, scene);
  } else {
    this.oceanShadowCSM = null;
  }

  //── Splash particles ────────────────────────────────────────────────────────
  //Airborne spray for breaking crests and water-vs-solid impacts. OceanGrid owns
  //the Points mesh and hides it during every offscreen pass below (it is only
  //flipped visible at the very end of tick). Safe to skip if ocean-splash.js or
  //its generated material isn't loaded.
  if(ARestlessOcean.OceanSplash && ARestlessOcean.Materials.Ocean.splashMaterial){
    //Declarative start-time overrides from the nested <ocean-splash> element,
    //assembled by ocean-state.applyNestedConfig (e.g. impact-min-launch="9"
    //shore-jet-scale="2" enabled="false"). Any knob is settable; the same fields
    //stay live-editable on the instance via window.oceanSplash.
    const splashCfg = data.splashConfig || {};
    this.oceanSplash = new ARestlessOcean.OceanSplash(this, scene, splashCfg);
    //Hull impacts: the buoyancy component fires buoyancy-splash on water entry
    //(bubbles up to the scene). Feed it straight into the shared impact emitter.
    const splashSelf = this;
    if(this.parentComponent && this.parentComponent.el && this.parentComponent.el.sceneEl){
      this.parentComponent.el.sceneEl.addEventListener('buoyancy-splash', function(evt){
        const s = splashSelf.oceanSplash;
        if(!s) return;
        const d = evt.detail || {};
        const p = d.point;
        if(!p) return;
        s.emitImpact(p.x, p.y, p.z, 0.0, 1.0, 0.0, d.speed || 0.0);
      });
    }
  } else {
    this.oceanSplash = null;
  }

  //── Horizon skirt ─────────────────────────────────────────────────────────
  //Flat ring at y=0 that fills the angular sliver where the FFT ocean's
  //farthest patches fail the depth test against a-starry-sky's icosahedron
  //sky dome (radius 5000), or are clipped by the camera far plane.
  //
  //Architecture: the skirt mesh uses the FFT ocean material directly (cloned
  //so it has its own uniforms object that the per-frame tick loop updates
  //identically to the FFT tiles). Only difference is one substituted line in
  //the vertex shader to pin gl_Position.z to the far plane, so the outer rim
  //extends past camera.far without being frustum-clipped. Result: the skirt
  //inherits the full FFT lighting (Fresnel, refracted, body, specular,
  //scattering, atm perspective) by construction — no parallel implementation.
  //
  //Depth choreography:
  //  - Sky dome (renderOrder 0): depthWrite forced off in tick loop once its
  //    renderer wires up — the dome stops blocking anything behind it.
  //  - Skirt (renderOrder 1): depthTest:true, depthWrite:false. With the
  //    z-clamp the skirt's depth is ~0.9995 (just inside the far plane) so
  //    every closer scene object (island, lighthouse, etc.) wins the depth
  //    test and the skirt does NOT overdraw them. The dome's pixels (which
  //    skipped depthWrite) leave depth=1.0, so the skirt passes there and
  //    overdraws the dome's lower hemisphere as intended.
  //  - FFT ocean (renderOrder 2): default depth, draws last over the skirt
  //    wherever real ocean geometry exists.
  this.horizonSkirtMesh = null;
  if(this.atmosphericPerspectiveEnabled && this.skyDirector){
    const skirtMaterial = this.oceanMaterial.clone();
    skirtMaterial.depthTest = true;
    skirtMaterial.depthWrite = false;
    skirtMaterial.fog = true;
    //Rebuild the vertex shader with the $horizon_skirt template flag set so
    //the rim verts (well past camera.far) survive frustum clipping via the
    //in-shader Z clamp. See water-vertex.glsl tail.
    skirtMaterial.vertexShader = buildVertexShader(atmosphereReady, true);
    //Pin a coarse ringIndex so the vertex shader skips the finer cascades
    //2-5 in its displacement sum. The skirt is meant to be flat-ish; we just
    //want the FFT fragment shader to read wave normals at the same XZ.
    skirtMaterial.uniforms.ringIndex.value = 5;
    skirtMaterial.uniforms.sizeOfOceanPatch.value = this.patchSize;

    //RingGeometry: flat ring at y=0 rotated from the default XY plane. Outer
    //radius capped at 1e7 m (10000 km) — the z-clamp keeps the rim fragments
    //alive past camera.far.
    const skirtGeometry = new THREE.RingGeometry(8.0, 1.0e7, 256, 1);
    skirtGeometry.rotateX(-Math.PI / 2);

    //InstancedMesh with a single identity instance — the FFT vertex shader
    //multiplies by `instanceMatrix`, so we need the attribute present even
    //though there is only one "instance" of the skirt.
    this.horizonSkirtMesh = new THREE.InstancedMesh(skirtGeometry, skirtMaterial, 1);
    this.horizonSkirtMesh.setMatrixAt(0, new THREE.Matrix4());
    this.horizonSkirtMesh.instanceMatrix.needsUpdate = true;
    this.horizonSkirtMesh.frustumCulled = false;
    this.horizonSkirtMesh.castShadow = false;
    this.horizonSkirtMesh.receiveShadow = false;
    this.horizonSkirtMesh.renderOrder = 1;
    //Horizon skirt is water-class geometry — move off the default layer so
    //the foam ortho camera does not capture it. See OCEAN_LAYER comment.
    this.horizonSkirtMesh.layers.set(ARestlessOcean.OCEAN_LAYER);
    scene.add(this.horizonSkirtMesh);
  }

  //── Underwater curtain hemisphere ────────────────────────────────────────
  //A hidden BackSide hemisphere centered on the camera, drawn only while
  //submerged. Closes the gap where the sky dome (hidden underwater) used to
  //occupy pixels — the seabed silhouette + island silhouette no longer have
  //sky leaking past them in the distance; the curtain backstops every empty
  //below-horizon direction with the inscatter murk. The cap extends only
  //~10° above the horizon so the upward Snell-window view through the
  //ceiling never has the curtain in front of it. Radius chosen so
  //far-distance ceiling ripples still read against it; the per-fragment
  //underwater fog integrates the camera→curtain path and converges to murk.
  this.underwaterCurtainMesh = null;
  {
    const curtainOverhangDeg = 10.0;
    const curtainThetaStart = Math.PI * 0.5 - curtainOverhangDeg * Math.PI / 180.0;
    const curtainThetaLength = Math.PI - curtainThetaStart;
    const curtainGeom = new THREE.SphereGeometry(
      300.0, 24, 12,
      0, Math.PI * 2.0,
      curtainThetaStart, curtainThetaLength
    );
    //fog:true — the curtain runs through the underwater fog chunk so its
    //backdrop converges to the same per-fragment murk (and HG sun phase) as
    //the fogged geometry, keeping direct and reflected horizon colours matched.
    const curtainMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.BackSide,
      fog: true,
      depthWrite: false,
      depthTest: true
    });
    this.underwaterCurtainMesh = new THREE.Mesh(curtainGeom, curtainMat);
    this.underwaterCurtainMesh.frustumCulled = false;
    this.underwaterCurtainMesh.castShadow = false;
    this.underwaterCurtainMesh.receiveShadow = false;
    //Draw early so any real scene geometry (seabed, island, lighthouse base)
    //overdraws it — curtain only fills directions with nothing in front.
    this.underwaterCurtainMesh.renderOrder = -10;
    this.underwaterCurtainMesh.visible = false;
    //Off the foam-capture layer so the ortho foam camera ignores it.
    this.underwaterCurtainMesh.layers.set(ARestlessOcean.OCEAN_LAYER);
    scene.add(this.underwaterCurtainMesh);
  }

  //── Clipmap grid construction ────────────────────────────────────────────
  //All tiles use the same fixed tessellation (numCells cells/edge = numCells+1 verts/edge).
  //Ring k has tile world size patchSize*2^k.
  //Ring 0: full 4×4 grid of tiles.  Ring k≥1: 12-tile frame (4×4 minus inner 2×2).
  //The outer edge of each ring borders the next (coarser) ring and needs T-junction
  //stitching via the existing edge flags (false = coarser neighbor).
  const numCells = 32;
  const ringCount = Math.max(1, Math.ceil(Math.log2(Math.max(2, this.drawDistance / this.patchSize))));

  //Instance key encodes ring index (bits 0-3) + edge flags (bits 4-7)
  function makeClipmapKey(k, top, right, bottom, left){
    return k | ((top ? 1 : 0) << 4) | ((right ? 1 : 0) << 5) | ((bottom ? 1 : 0) << 6) | ((left ? 1 : 0) << 7);
  }

  //Enumerate every tile in the clipmap, calling cb(k, gx, gy, tileSize, top, right, bottom, left)
  //gx/gy ∈ {-2,-1,0,1}: tile grid offset (geometry spans [gx*tileSize, (gx+1)*tileSize])
  function enumerateClipmapTiles(cb){
    for(let k = 0; k < ringCount; ++k){
      const tileSize = self.patchSize * Math.pow(2, k);
      const isLastRing = (k === ringCount - 1);
      for(let gx = -2; gx <= 1; ++gx){
        for(let gy = -2; gy <= 1; ++gy){
          //Ring k≥1: skip inner 2×2 — that area is covered by ring k-1
          if(k > 0 && gx >= -1 && gx <= 0 && gy >= -1 && gy <= 0) continue;
          //Outer edge flags: false when the edge faces the next (coarser) ring
          const top    = !(gy ===  1 && !isLastRing);
          const right  = !(gx ===  1 && !isLastRing);
          const bottom = !(gy === -2 && !isLastRing);
          const left   = !(gx === -2 && !isLastRing);
          cb(k, gx, gy, tileSize, top, right, bottom, left);
        }
      }
    }
  }

  //Count instances per key
  let instanceCount = {};
  enumerateClipmapTiles(function(k, gx, gy, tileSize, top, right, bottom, left){
    const key = makeClipmapKey(k, top, right, bottom, left);
    instanceCount[key] = (instanceCount[key] || 0) + 1;
  });

  //Create instanced meshes and ocean patches
  let oceanPatchGeometryInstances = {};
  let instanceIterations = {};
  let oceanGridInstanceKeys = [];

  enumerateClipmapTiles(function(k, gx, gy, tileSize, top, right, bottom, left){
    const key = makeClipmapKey(k, top, right, bottom, left);
    if(!oceanPatchGeometryInstances.hasOwnProperty(key)){
      oceanGridInstanceKeys.push(key);
      const geometry = ARestlessOcean.OceanTile(tileSize, numCells, top, right, bottom, left);
      const mesh = new THREE.InstancedMesh(geometry, self.oceanMaterial.clone(), instanceCount[key]);
      mesh.frustumCulled = false;
      //Sit above the horizon skirt (renderOrder 1) so FFT ocean overwrites the
      //pure-inscatter skirt fragments wherever real ocean geometry exists.
      mesh.renderOrder = 2;
      //Ocean self-shadow is handled by the dedicated ocean-only CSM below;
      //casting into the scene-wide sun shadow map would re-rasterise ~900K
      //ocean triangles into a large target every render call, for no useful
      //wave-scale detail. receiveShadow stays on so environment casters
      //(trees, lighthouse, rocks) still occlude the water.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      oceanPatchGeometryInstances[key] = mesh;
      instanceIterations[key] = 0;
      scene.add(mesh);
      //Register as a caster in the ocean-only CSM. The CSM decides which
      //cascades this ring participates in based on its ring index (each
      //cascade has a maxRing). Larger rings only contribute to coarser
      //cascades; finest ring 0 contributes to all four. Layers are set
      //inside addCaster so per-cascade light cameras naturally pick the
      //right caster set without any per-frame layer toggling here.
      if(self.oceanShadowCSM){
        self.oceanShadowCSM.addCaster(mesh, k);
      }
      //Move ocean patch off the default layer onto OCEAN_LAYER. Must happen
      //after addCaster, which enables the per-cascade caster layers (7..10);
      //we keep those, only swap default 0 → OCEAN_LAYER.
      mesh.layers.disable(0);
      mesh.layers.enable(ARestlessOcean.OCEAN_LAYER);

      const uniformsRef = mesh.material.uniforms;
      uniformsRef.foamScrollVelocity.value.set(self.foamScrollVelocityVec[0], self.foamScrollVelocityVec[1]);
      //Jerlov preset wins over the explicit RGB vec3s when water_type is in
      //range (1..N). water_type == 0 ⇒ fall through to the custom values.
      const jerlovPreset = ARestlessOcean.JERLOV_PRESETS[self.data.water_type | 0];
      if(jerlovPreset){
        uniformsRef.waterAbsorption.value.copy(jerlovPreset.absorption);
        uniformsRef.waterScattering.value.copy(jerlovPreset.scattering);
      } else {
        uniformsRef.waterAbsorption.value.copy(self.data.water_absorption);
        uniformsRef.waterScattering.value.copy(self.data.water_scattering);
      }
      uniformsRef.reflectionScale.value = self.reflectionScale;
      uniformsRef.reflectionDistanceFalloff.value = self.reflectionDistanceFalloff;
      uniformsRef.fresnelDistanceRoughness.value = self.fresnelDistanceRoughness;
      uniformsRef.patchDataSize.value = self.data.patch_data_size;
      uniformsRef.chop.value = self.data.chop;
      uniformsRef.ringIndex.value = k;
      //sizeOfOceanPatch stays as base patchSize for consistent world-space normal-map UV scaling
    }
    //Tile geometry spans [0, tileSize]; placing at gx*tileSize centers the 4×4 ring on the camera
    self.oceanPatches.push(new ARestlessOcean.OceanPatch(
      self,
      new THREE.Vector3(gx * tileSize, self.heightOffset, gy * tileSize),
      oceanPatchGeometryInstances[key],
      instanceIterations[key],
      k
    ));
    instanceIterations[key] += 1;
  });

  this.numberOfPatches = this.oceanPatches.length;
  this.numCells = numCells;
  this.ringCount = ringCount;
  this.globalCameraPosition = new THREE.Vector3();

  //═══════════════════════════════════════════════════════════════════════════
  // FFT surface sampling on the CPU — the EXACT rendered water, for buoyancy.
  //═══════════════════════════════════════════════════════════════════════════
  //
  // sampleFFTHeightAt (EXACT, synchronous) reads single texels straight off the
  // GPU. Each call drains the GPU queue (a stall), so it's a DEBUG ground truth
  // only — see ARestlessOcean.debugWaveAt.
  //
  // The scalable path is the LOCAL HEIGHT FIELD below: once every ~frame a tiny
  // GPU pass composites the cascades' height into a small RT covering a region
  // that follows the camera, and we async-read just THAT (a few hundred KB, not
  // the 12 MB of full cascade textures). Every buoyancy query is then a cheap
  // bilinear lookup of the cached field — exact (it IS the rendered surface, so
  // floats ride the water you see) and O(1) per probe regardless of object
  // count. Objects outside the region return null → caller falls back to
  // analytic. Tunables: HEIGHT_FIELD_RES (grid resolution), HEIGHT_FIELD_SIZE
  // (world metres covered → SIZE/RES = m/texel, caps the smallest wave it
  // resolves), HEIGHT_FIELD_INTERVAL_MS (refresh throttle; waves move slowly so
  // ~15 Hz is plenty, the cached field is reused every frame between refreshes).
  const HEIGHT_FIELD_RES = 256;
  const HEIGHT_FIELD_SIZE = 512.0;          //metres; 2 m/texel at res 256.
  const HEIGHT_FIELD_INTERVAL_MS = 66;      //~15 Hz refresh.
  this._hfSnap = null;            //resolved {data, originX, originZ, size, res, time}.
  this._hfSnapPrev = null;        //prior resolved snapshot, kept for dH/dt (rise).
  this._hfBufs = null;            //triple-buffered readback (see _updateHeightField).
  this._hfBackIdx = 0;
  this._hfPending = false;
  this._hfWantedUntil = 0;        //only run while a consumer asked recently.
  this._hfLastIssue = 0;

  //EXACT synchronous single-texel readback — DEBUG ground truth only (each call
  //stalls the GPU queue). See ARestlessOcean.debugWaveAt.
  this.sampleFFTHeightAt = function(x, z){
    const composer = self.oceanHeightComposer;
    if(!composer || !composer.cascadeDisplacementTargets || !composer.cascadeDisplacementTargets[0]) return null;
    self._fftProbeBuf = self._fftProbeBuf || new Float32Array(4);
    const buf = self._fftProbeBuf;
    const res = composer.baseTextureWidth;
    const offsets = self.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
    const whm = composer.waveHeightMultiplier;
    let h = self.heightOffset;
    for(let c = 0; c < composer.cascadeDisplacementTargets.length; c++){
      const patch = composer._cascadePatchSizes[c];
      let u = (x + offsets[c].x) / patch;
      let v = (z + offsets[c].y) / patch;
      u -= Math.floor(u); v -= Math.floor(v);
      const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
      const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
      self.renderer.readRenderTargetPixels(composer.cascadeDisplacementTargets[c], px, py, 1, 1, buf);
      h += buf[1] * whm; //.y (green) = vertical displacement.
    }
    return h;
  };

  //── Local height-field GPU pass (composite cascades → small RT) ─────────────
  //Build the pass once. The fragment shader mirrors the water vertex shader's
  //cascade composition (sum each cascade's .y at (worldXZ+offset)/patch), but
  //over a region grid instead of mesh vertices, and bakes heightOffset + whm in.
  const HF_N = self.oceanHeightComposer.numCascades;
  let hfSumLines = '';
  for(let c = 0; c < HF_N; c++){
    hfSumLines += 'dy += texture2D(hfCascadeTex[' + c + '], (worldXZ + hfCascadeOffset[' + c + ']) / hfCascadePatch[' + c + ']).y;\n';
  }
  const hfVert = 'varying vec2 vHfUv;\nvoid main(){ vHfUv = uv; gl_Position = vec4(position, 1.0); }';
  const hfFrag = [
    'precision highp float;',
    'varying vec2 vHfUv;',
    'uniform sampler2D hfCascadeTex[' + HF_N + '];',
    'uniform vec2 hfCascadeOffset[' + HF_N + '];',
    'uniform float hfCascadePatch[' + HF_N + '];',
    'uniform float hfWhm;',
    'uniform float hfHeightOffset;',
    'uniform vec2 hfRegionOrigin;',
    'uniform float hfRegionSize;',
    'void main(){',
    '  vec2 worldXZ = hfRegionOrigin + vHfUv * hfRegionSize;',
    '  float dy = 0.0;',
    '  ' + hfSumLines,
    '  gl_FragColor = vec4(hfHeightOffset + dy * hfWhm, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');
  this._heightFieldMaterial = new THREE.ShaderMaterial({
    uniforms: {
      hfCascadeTex: {value: new Array(HF_N).fill(null)},
      hfCascadeOffset: {value: (function(){ const a = []; for(let i = 0; i < HF_N; i++) a.push(new THREE.Vector2()); return a; })()},
      hfCascadePatch: {value: new Array(HF_N).fill(1.0)},
      hfWhm: {value: 1.0},
      hfHeightOffset: {value: 0.0},
      hfRegionOrigin: {value: new THREE.Vector2()},
      hfRegionSize: {value: HEIGHT_FIELD_SIZE}
    },
    vertexShader: hfVert,
    fragmentShader: hfFrag,
    depthTest: false,
    depthWrite: false
  });
  this._heightFieldScene = new THREE.Scene();
  this._heightFieldScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._heightFieldMaterial));
  this._heightFieldCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this._heightFieldRT = new THREE.WebGLRenderTarget(HEIGHT_FIELD_RES, HEIGHT_FIELD_RES, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat, type: THREE.FloatType,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false
  });
  this._hfN = HF_N;

  //Render the field + issue the async readback. Region follows the camera,
  //snapped to the texel grid so the sampled field doesn't shimmer as it pans.
  this._updateHeightField = function(){
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if(now > self._hfWantedUntil) return;
    if(self._hfPending) return;
    if(now - self._hfLastIssue < HEIGHT_FIELD_INTERVAL_MS) return;
    const composer = self.oceanHeightComposer;
    if(!composer || !composer.cascadeDisplacementTextures || !composer.cascadeDisplacementTextures[0]) return;
    if(typeof self.renderer.readRenderTargetPixelsAsync !== 'function') return;

    const texel = HEIGHT_FIELD_SIZE / HEIGHT_FIELD_RES;
    const originX = Math.floor((self.globalCameraPosition.x - HEIGHT_FIELD_SIZE * 0.5) / texel) * texel;
    const originZ = Math.floor((self.globalCameraPosition.z - HEIGHT_FIELD_SIZE * 0.5) / texel) * texel;
    const u = self._heightFieldMaterial.uniforms;
    const offsets = self.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
    for(let c = 0; c < self._hfN; c++){
      u.hfCascadeTex.value[c] = composer.cascadeDisplacementTextures[c];
      u.hfCascadePatch.value[c] = composer._cascadePatchSizes[c];
      u.hfCascadeOffset.value[c].copy(offsets[c]);
    }
    u.hfWhm.value = composer.waveHeightMultiplier;
    u.hfHeightOffset.value = self.heightOffset;
    u.hfRegionOrigin.value.set(originX, originZ);
    u.hfRegionSize.value = HEIGHT_FIELD_SIZE;

    const prevRT = self.renderer.getRenderTarget();
    self.renderer.setRenderTarget(self._heightFieldRT);
    self.renderer.render(self._heightFieldScene, self._heightFieldCamera);
    self.renderer.setRenderTarget(prevRT);

    if(!self._hfBufs){
      const sz = HEIGHT_FIELD_RES * HEIGHT_FIELD_RES * 4;
      //Triple-buffered: only one read is ever in flight, so 3 buffers guarantee
      //the in-flight write target is neither the current nor the previous
      //snapshot. That lets us retain a stable PREVIOUS field to finite-difference
      //for surface rise (dH/dt) without the next readback clobbering it mid-transfer.
      self._hfBufs = [new Float32Array(sz), new Float32Array(sz), new Float32Array(sz)];
    }
    const buf = self._hfBufs[self._hfBackIdx];
    self._hfPending = true;
    self._hfLastIssue = now;
    self.renderer.readRenderTargetPixelsAsync(self._heightFieldRT, 0, 0, HEIGHT_FIELD_RES, HEIGHT_FIELD_RES, buf).then(function(){
      self._hfSnapPrev = self._hfSnap; //keep the prior field so consumers can read dH/dt.
      self._hfSnap = {data: buf, originX: originX, originZ: originZ, size: HEIGHT_FIELD_SIZE, res: HEIGHT_FIELD_RES, time: now};
      self._hfBackIdx = (self._hfBackIdx + 1) % 3; //rotate; never reuse current/prev.
      self._hfPending = false;
    }).catch(function(){ self._hfPending = false; });
  };

  //Bilinear lookup of a GIVEN resolved snapshot's baked height (.x) at world
  //(x,z). Returns null outside that snapshot's region. Shared by the cached-height,
  //rise and slope samplers below so they all read the same field consistently.
  this._sampleSnapHeight = function(s, x, z){
    if(!s) return null;
    const uu = (x - s.originX) / s.size;
    const vv = (z - s.originZ) / s.size;
    if(uu < 0.0 || uu > 1.0 || vv < 0.0 || vv > 1.0) return null;
    const res = s.res, data = s.data;
    const fx = uu * res - 0.5, fy = vv * res - 0.5;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    let x1 = x0 + 1, y1 = y0 + 1;
    x0 = x0 < 0 ? 0 : (x0 > res - 1 ? res - 1 : x0);
    x1 = x1 < 0 ? 0 : (x1 > res - 1 ? res - 1 : x1);
    y0 = y0 < 0 ? 0 : (y0 > res - 1 ? res - 1 : y0);
    y1 = y1 < 0 ? 0 : (y1 > res - 1 ? res - 1 : y1);
    const h00 = data[(y0 * res + x0) * 4], h10 = data[(y0 * res + x1) * 4];
    const h01 = data[(y1 * res + x0) * 4], h11 = data[(y1 * res + x1) * 4];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * ty;
  };

  //Cheap bilinear lookup of the CURRENT field. Returns null outside the region or
  //before the first field resolves → caller falls back to analytic.
  this.sampleWaterHeightFieldCached = function(x, z){
    return self._sampleSnapHeight(self._hfSnap, x, z);
  };

  //Public surface. Consumers call requestFFTSnapshot() each frame they want the
  //field kept warm (it's off when nothing floats). sampleWaterHeightFFT is the
  //cheap cached path; *Exact is the synchronous debug stall path.
  ARestlessOcean.requestFFTSnapshot = function(){
    self._hfWantedUntil = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) + 1000;
  };
  ARestlessOcean.sampleWaterHeightFFT = function(x, z){ return self.sampleWaterHeightFieldCached(x, z); };
  ARestlessOcean.sampleWaterHeightFFTExact = function(x, z){ return self.sampleFFTHeightAt(x, z); };

  //Phase-correct surface RISE (dH/dt, m/s) at world (x,z): finite difference of
  //the two most recent rendered-FFT snapshots — the rendered water's OWN vertical
  //velocity. The analytic twin shares the spectrum but not the GPU's phases, so
  //its "rising here?" answer fired spray over visibly-flat/trough water (the
  //bunched, mistimed shore bursts). Returns null until two snapshots exist or
  //outside the region → caller falls back to the analytic rate.
  ARestlessOcean.sampleWaterRiseFFT = function(x, z){
    const cur = self._hfSnap, prev = self._hfSnapPrev;
    if(!cur || !prev) return null;
    const dt = (cur.time - prev.time) / 1000.0;
    if(dt <= 1e-4) return null;
    const hc = self._sampleSnapHeight(cur, x, z);
    const hp = self._sampleSnapHeight(prev, x, z);
    if(hc === null || hp === null) return null;
    return (hc - hp) / dt;
  };

  //Phase-correct STEEPNESS (1 - normal.y) at world (x,z) from the rendered-FFT
  //height field's OWN slope (central differences, one texel eps). Same motivation
  //as the rise sampler: the analytic normal peaks on phantom crests, so mist tore
  //off flat water. Returns null outside the region → caller falls back to analytic.
  ARestlessOcean.sampleWaterSlopeFFT = function(x, z){
    const s = self._hfSnap;
    if(!s) return null;
    const eps = s.size / s.res; //one texel (~2 m).
    const hxp = self._sampleSnapHeight(s, x + eps, z);
    const hxn = self._sampleSnapHeight(s, x - eps, z);
    const hzp = self._sampleSnapHeight(s, x, z + eps);
    const hzn = self._sampleSnapHeight(s, x, z - eps);
    if(hxp === null || hxn === null || hzp === null || hzn === null) return null;
    const dhdx = (hxp - hxn) / (2.0 * eps);
    const dhdz = (hzp - hzn) / (2.0 * eps);
    const ny = 1.0 / Math.sqrt(1.0 + dhdx * dhdx + dhdz * dhdz);
    return 1.0 - ny;
  };

  //Register the horizon skirt as another instance key so the per-frame uniform
  //loop pushes the same FFT-ocean updates into its (cloned) uniforms object.
  //ringIndex was set to 5 at construction and is NOT touched in the per-frame
  //loop, so the skirt keeps its coarse cascade-displacement settings.
  if(this.horizonSkirtMesh){
    const skirtKey = '__horizon_skirt__';
    oceanPatchGeometryInstances[skirtKey] = this.horizonSkirtMesh;
    oceanGridInstanceKeys.push(skirtKey);
  }

  //Console helper — flip the ocean-shadow debug mode on every water tile
  //material at once. Call from the browser console as
  //  setOceanShadowDebug(0|1|2)
  //  0 = normal render, 1 = shadow factor as full-screen grayscale,
  //  2 = cascade-index tint (red C0, green C1, blue C2, yellow C3).
  //Cascade-depth thumbnails and the bottom-corner jacobian/foam panels
  //appear only when mode is non-zero.
  this.setOceanShadowDebug = function(mode){
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.oceanShadowDebugMode.value = mode | 0;
    }
  };
  //Opacity for the cascade-band overlay (debug mode 40). 0 = scene only,
  //1 = overlay only, 0.5 = half-and-half. Call setOceanShadowDebug(40) first,
  //then setDebugBlend(0.5) to dial how strongly the cascade colours show over
  //the real waves.
  this.setDebugBlend = function(v){
    const blend = +v;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.debugBlend.value = blend;
    }
  };
  //Diagnostic toggles — flip the scene-wide sun shadow or the ocean-only
  //CSM on/off across every water tile so we can isolate which one is
  //producing a given visible shadow. Call as setSunShadowEnabled(0) etc.
  //from the browser console.
  //Override flags so the per-frame tick can't trample the console toggle.
  //null = follow the normal per-frame logic (sun-below-horizon etc).
  //true/false = force the uniform to that state every frame.
  this._sunShadowOverride = null;
  this._oceanShadowOverride = null;
  //Additive offset on top of mainLight.shadow.bias when pushed to the water
  //shader. Sourced from the HTML attribute `sun_shadow_bias` (default
  //-0.0012, see ocean-state.js for full rationale). Positive → more
  //shadowed; negative → less shadowed. Use setSunShadowBias(x) from the
  //console for live tuning.
  this._sunShadowBiasOffset = (data && typeof data.sun_shadow_bias === 'number')
    ? data.sun_shadow_bias : -0.0012;
  this.setSunShadowBias = function(offset){
    self._sunShadowBiasOffset = +offset || 0.0;
  };
  this.setSunShadowEnabled = function(enabled){
    self._sunShadowOverride = enabled === null || enabled === undefined ? null : !!enabled;
    const v = self._sunShadowOverride === false ? 0 : 1;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.sunShadowEnabled.value = v;
    }
  };
  this.setOceanShadowEnabled = function(enabled){
    self._oceanShadowOverride = enabled === null || enabled === undefined ? null : !!enabled;
    const v = self._oceanShadowOverride === false ? 0 : 1;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.oceanShadowEnabled.value = v;
    }
  };
  //Live-tune the receiver-side normal-offset bias from the console. Pushes
  //to every water tile material at once so the change is visible next
  //frame. Pass a value in WORLD METERS — typical range 0.05 to 2.0.
  this.setOceanShadowNormalBias = function(meters){
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.oceanShadowNormalBias.value = +meters;
    }
  };
  //EVSM warp constant. Pushes to BOTH the receiver materials and the
  //caster materials (via the CSM helper). Keep them in sync — caster
  //emits exp(c·z) moments and receiver computes exp(c·refZ); a mismatch
  //makes every comparison nonsense.
  this.setOceanEvsmExpC = function(c){
    const v = +c;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.evsmExpC.value = v;
    }
    if(self.oceanShadowCSM){
      self.oceanShadowCSM.setEvsmExpC(v);
    }
  };
  //EVSM minimum variance floor. Tiny number; raise (e.g. 1e-3) if you
  //see speckle in penumbra; lower (e.g. 1e-5) if shadow gradients feel
  //too soft.
  this.setOceanEvsmMinVariance = function(v){
    const f = +v;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.evsmMinVariance.value = f;
    }
  };
  //EVSM light-bleed reduction threshold in [0, 1). Higher = harder
  //shadows, more contrast; lower = softer with risk of light bleed.
  this.setOceanEvsmLightBleedReduction = function(v){
    const f = +v;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms.evsmLightBleedReduction.value = f;
    }
  };
  this.setReflectionScale = function(v){
    self.reflectionScale = +v;
  };
  //SSR march step cap. 48 = full reach (default); try 32/16/8 to find the
  //fps/quality knee; 0 skips the march entirely (sky-only) as a bottleneck A/B.
  this.setSsrMaxSteps = function(v){
    self.ssrMaxSteps = +v;
  };
  this.setReflectionDistanceFalloff = function(v){
    self.reflectionDistanceFalloff = +v;
  };
  this.setFresnelDistanceRoughness = function(v){
    self.fresnelDistanceRoughness = +v;
  };
  this.setSurfaceRoughness = function(v){
    self.surfaceRoughness = +v;
  };
  //Crest-style sun-glint live knobs. setSpecFresnelGate(0..1): 0 = legacy
  //ungated additive glint, 1 = Crest Fresnel-gated. setSpecFalloffFar /
  //setSpecFalloffFarDist drive the distance lobe-widening ramp (far defaults
  //to 275 = near, a no-op until lowered). setSpecBoost is _DirectionalLightBoost.
  this.setSpecFresnelGate = function(v){
    self.specFresnelGate = +v;
  };
  this.setSpecBoost = function(v){
    self.specBoost = +v;
  };
  this.setSpecFalloffFar = function(v){
    self.specFalloffFar = +v;
  };
  this.setSpecFalloffFarDist = function(v){
    self.specFalloffFarDist = +v;
  };
  //Live-tune atmospheric perspective strength. Default 1.0. Set to 0.0 to
  //fully bypass extinction + inscatter on the water surface (the per-frame
  //tick will still overwrite at the next ocean-grid update unless we keep
  //it in sync — that's why we also mirror onto the cached field).
  this.setAtmDistanceScale = function(v){
    self.atmosphericPerspectiveDistanceScale = +v;
  };
  //Render every ocean tile (FFT tiles + horizon skirt) as wireframe so the
  //clipmap cell structure and per-ring tessellation density are visible.
  //ShaderMaterial honours `wireframe` natively — no shader recompile needed.
  //Call from the console: setOceanWireframe(1) on, setOceanWireframe(0) off.
  this.setOceanWireframe = function(enabled){
    const flag = !!enabled;
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.wireframe = flag;
    }
  };
  //Toggle THREE.CameraHelper wireframes for every shadow camera in play so
  //you can SEE the frustums in 3D — way more useful than reading dimensions
  //out of a dump. White = scene sun shadow (Three.js DirectionalLight), and
  //C0..C3 (ocean CSM) get red/orange/yellow/green for fine→coarse. Helpers
  //are added directly to the scene; update() is called per-frame from tick.
  //Call as setShadowHelpers(1) / setShadowHelpers(0).
  this._shadowHelpers = null;
  this.setShadowHelpers = function(enabled){
    const on = !!enabled;
    if(!on){
      if(self._shadowHelpers){
        for(let i = 0; i < self._shadowHelpers.length; i++){
          self.scene.remove(self._shadowHelpers[i]);
          self._shadowHelpers[i].dispose && self._shadowHelpers[i].dispose();
        }
        self._shadowHelpers = null;
      }
      return;
    }
    if(self._shadowHelpers) return;
    self._shadowHelpers = [];
    const colors = [0xff4040, 0xff9020, 0xffe040, 0x40e060]; //C0..C3 fine→coarse
    //THREE.CameraHelper uses vertex colours, so setting .material.color does
    //nothing visible — the default rainbow palette (yellow/magenta/red/green)
    //comes from the BufferGeometry's color attribute. Use setColors() to
    //override all five segments to a single solid colour so each helper is
    //distinguishable by its own colour rather than all wearing the rainbow.
    const tintHelper = function(helper, hex){
      const c = new THREE.Color(hex);
      if(typeof helper.setColors === 'function'){
        helper.setColors(c, c, c, c, c);
      } else {
        //Fallback for older Three.js without setColors: paint the color
        //attribute directly. Three colours per line segment vertex.
        const attr = helper.geometry && helper.geometry.attributes.color;
        if(attr){
          for(let i = 0; i < attr.count; i++){
            attr.setXYZ(i, c.r, c.g, c.b);
          }
          attr.needsUpdate = true;
        }
      }
      helper.material.depthTest = false;
      helper.material.toneMapped = false;
      helper.renderOrder = 999;
    };
    //Scene sun shadow camera (the one that gates lighthouse/terrain shadows).
    const light = self.brightestDirectionalLight;
    if(light && light.shadow && light.shadow.camera){
      const h = new THREE.CameraHelper(light.shadow.camera);
      tintHelper(h, 0xffffff);
      self.scene.add(h);
      self._shadowHelpers.push(h);
    }
    //Ocean CSM cascades.
    if(self.oceanShadowCSM && self.oceanShadowCSM.cascades){
      const cs = self.oceanShadowCSM.cascades;
      for(let i = 0; i < cs.length; i++){
        const h = new THREE.CameraHelper(cs[i].lightCamera);
        tintHelper(h, colors[i] || 0xffffff);
        self.scene.add(h);
        self._shadowHelpers.push(h);
      }
    }
  };

  
  const oceanPatchTranslationMatrices = [];
  for(let i = 0, numOceanPatches = self.oceanPatches.length; i < numOceanPatches; ++i){
    oceanPatchTranslationMatrices.push(new THREE.Matrix4());
  }
  //Snapped camera offset (reused each frame, avoids allocation)
  const ringSnapX = new Float64Array(1);
  const ringSnapZ = new Float64Array(1);
  const directionalLightDirection = new THREE.Vector3();

  //── Underwater state ───────────────────────────────────────────────────
  //Tracks whether the camera was submerged last frame so the ocean side-flip
  //only fires on the actual transition.
  this._wasUnderwater = false;

  //Flip the ocean + horizon skirt to render their underside (the "ceiling")
  //when the camera is below the surface. water-shader.glsl switches to its
  //computeUnderwaterCeiling appearance under the same underwaterFactor > 0.5
  //gate, so the geometry that draws and the shading model stay in lockstep.
  //
  //The sky/fog swaps this once owned (global FogExp2, background, dome hiding)
  //now live in tick(): a scene.fog mode-swap into A-Starry-Sky's reserved
  //underwater-fog branch, plus the sky-dome hide + murk background. This
  //function only owns the discrete per-transition material.side flip.
  this._applyUnderwaterSceneState = function(under){
    for(let i = 0, n = oceanGridInstanceKeys.length; i < n; ++i){
      const oceanMesh = oceanPatchGeometryInstances[oceanGridInstanceKeys[i]];
      if(oceanMesh && oceanMesh.material){
        //DoubleSide while submerged so the ceiling renders regardless of the
        //tile geometry's winding direction (PlaneGeometry's rotateX flips the
        //winding; the previous BackSide guess turned the ceiling invisible
        //from below). FrontSide above water keeps the cheap default.
        oceanMesh.material.side = under ? THREE.BackSide : THREE.FrontSide;
      }
    }
  };

  //Render the underwater scene from a camera mirrored across the rest water
  //plane (y = heightOffset) into the planar-reflection target — the TIR
  //mirror the ceiling samples outside Snell's window. Reflecting the camera's
  //position, forward and up across the plane and then doing a normal lookAt
  //keeps the virtual camera right-handed (no winding flip) — the
  //THREE.Reflector trick. Caller renders this while the ocean grid is hidden.
  this._renderUnderwaterReflection = function(scene, mainCamera){
    //Mirror across the DISPLACED surface at the camera's XZ (last frame's
    //CPU probe), not the flat rest plane. The chunk's `uwSurfaceY` is also
    //the displaced height (set from `-_oceanFog.near`), so this keeps the
    //mirror's reference plane and the chunk's fog-crossing plane in sync —
    //the complementary segment compose (chunk fogs |SP|, applyUnderwaterFog
    //fogs |CS|) only sums to the true bounce-path length when both planes
    //agree. Falls back to heightOffset before the first probe runs. Wave
    //amplitude away from the camera's XZ is still an unmodelled error, but
    //bringing the camera-XZ height into the mirror plane removes the bulk
    //of the mismatch under any swell.
    const h = (self._lastWaterSurfaceY !== undefined)
      ? self._lastWaterSurfaceY
      : self.heightOffset;
    const reflCam = self._reflectionCamera;
    if(!self._reflScratch){
      self._reflScratch = {
        pos: new THREE.Vector3(), fwd: new THREE.Vector3(),
        up: new THREE.Vector3(), quat: new THREE.Quaternion(),
        target: new THREE.Vector3(), clearColor: new THREE.Color(),
        murk: new THREE.Color()
      };
    }
    const s = self._reflScratch;
    mainCamera.getWorldPosition(s.pos);
    mainCamera.getWorldDirection(s.fwd);
    mainCamera.getWorldQuaternion(s.quat);
    s.up.set(0.0, 1.0, 0.0).applyQuaternion(s.quat);

    //Mirror the camera across the rest water plane: y → 2h - y, and flip the
    //y of both the forward and up vectors.
    reflCam.position.set(s.pos.x, 2.0 * h - s.pos.y, s.pos.z);
    reflCam.up.set(s.up.x, -s.up.y, s.up.z);
    s.target.set(s.pos.x + s.fwd.x,
                 (2.0 * h - s.pos.y) - s.fwd.y,
                 s.pos.z + s.fwd.z);
    reflCam.lookAt(s.target);
    reflCam.projectionMatrix.copy(mainCamera.projectionMatrix);
    reflCam.updateMatrixWorld();

    //Note: the mirror cam is the VIEWER mirrored across the rest plane, NOT the
    //camera-at-the-reflecting-pixel. When the viewer is underwater (mainCamY < h)
    //the mirror cam is ABOVE water (mirrorCamY = 2h - mainCamY > h), so the
    //chunk's uwCamDepth clamps to 0 in this pass. That's compensated by swapping
    //the pre-darkened _uwBaselineCamDepth into the fogColor for the mirror pass
    //(see the murk block), so the reflected ceiling fogs toward the same depth
    //equilibrium as the direct seabed. (This was probed as a suspected
    //direct-vs-reflected divergence — ruled out: the depth cancels between views.)

    //world position → reflection UV: bias(clip→[0,1]) · proj · view.
    self._reflectionTextureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    self._reflectionTextureMatrix.multiply(reflCam.projectionMatrix);
    self._reflectionTextureMatrix.multiply(reflCam.matrixWorldInverse);

    //Hide the sky dome — only the underwater scene belongs in the mirror;
    //empty directions then read as the dark clear colour (the ceiling shader
    //fogs them toward the murk). The ocean grid is already hidden by the
    //caller, so the water never appears in its own reflection.
    const atmRenderer = self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.atmosphereRenderer;
    const skyMesh = atmRenderer && atmRenderer.skyMesh;
    const skyWasVisible = skyMesh ? skyMesh.visible : false;
    if(skyMesh){ skyMesh.visible = false; }
    //Keep the underwater curtain visible in the mirror so the direct view and
    //the reflected view share the same backdrop. Hiding it left empty mirror
    //directions falling back to the dark clear colour while the direct view
    //filled the same directions with the murk-coloured curtain — so the
    //reflected horizon colours stopped matching the direct horizon.

    const prevRT = self.renderer.getRenderTarget();
    const prevToneMapping = self.renderer.toneMapping;
    self.renderer.getClearColor(s.clearColor);
    const prevClearAlpha = self.renderer.getClearAlpha();

    //Force scene.fog to the UNDERWATER ocean fog for the mirror RT (don't just
    //inherit it). The chunk then fogs the reflected geometry over the bounce
    //path: by the reflection-trick equivalence the mirror camera's straight-line
    //distance to a fragment equals the real cam→surface→reflected-point path, so
    //it's one segment. Setting it explicitly (rather than relying on the prior
    //frame's swap still being mounted) guarantees the reflection never picks up
    //the atmospheric fog on the boundary frame. Only do it when the ocean fog is
    //actually armed (chunk injected); otherwise leave whatever is mounted.
    const prevFog = scene.fog;
    if(self._fogChunkInjected){ scene.fog = self._oceanFog; }
    //Swap the chunk's fogColor to the CAMERA-DEPTH-darkened baseline for this
    //pass so the reflected geometry fogs toward the same teal the direct seabed
    //reaches (see _uwBaselineCamDepth). The mirror cam is above water so the
    //chunk can't derive the camera-depth darkening itself. Save/restore the raw
    //RGB (the tick rewrites fogColor from _uwMurkScratch every frame anyway).
    const prevFogColorR = self._oceanFog.color.r;
    const prevFogColorG = self._oceanFog.color.g;
    const prevFogColorB = self._oceanFog.color.b;
    if(self._uwBaselineCamDepth){
      //SRGBToLinear pre-comp (see _toFogUniform) — same reason as the main pass.
      self._oceanFog.color.setRGB(self._toFogUniform(self._uwBaselineCamDepth.x),
                                  self._toFogUniform(self._uwBaselineCamDepth.y),
                                  self._toFogUniform(self._uwBaselineCamDepth.z));
    }
    //fogFar MUST stay > 0 here. a-starry-sky's fog_fragment routes on
    //`if(fogFar <= 0.0)` → its ATMOSPHERIC-perspective branch, checked BEFORE
    //our `else if(fogNear < 0.0)` ocean branch. The old NEGATIVE sign (meant to
    //signal "linear output" to our chunk) therefore sent the whole mirror pass
    //into a-starry-sky's atmospheric fog — our ocean chunk never ran in the
    //reflection at all, so the reflected geometry read bright/atmospheric
    //instead of teal. So we carry the linear/sRGB flag in fogFar's MAGNITUDE, not its
    //sign: add a +10 offset for the linear RT pass (range [10,11]) vs the main
    //canvas's bare sunFrac (range [0,1]). The chunk reads `fogFar > 5.0` ⇒
    //linear output (skip the sRGB roundtrip — this RT is NoToneMapping linear
    //HalfFloat, composited pre-tonemap so the single main-canvas tonemap encodes
    //once), and recovers sunFrac as `fogFar - 10.0`. Both passes keep fogFar > 0
    //so both correctly land in the ocean branch. Falls back to 0.5 if the probe
    //hasn't populated _uwSunFrac yet.
    const prevFogFar = self._oceanFog.far;
    const sunFracForRT = (self._uwSunFrac !== undefined) ? self._uwSunFrac : 0.5;
    self._oceanFog.far = sunFracForRT + 10.0;

    //Clip everything above the waterline out of the mirror cam's render.
    //Without this, cave walls, the above-water portion of the lighthouse, and
    //any other stationary world geometry sitting above the surface lands in
    //the RT and gets sampled by the underwater ceiling shader's TIR lookup —
    //producing the "dark band of cave stone where the underwater rock should
    //be reflected" artifact at the waterline. The water grid itself is hidden
    //by the caller, so the wavy ocean surface never collides with this plane.
    //Plane convention: distance(p) = normal·p + constant; fragments with
    //distance < 0 are clipped. normal=(0,-1,0), constant=waterSurfaceY clips
    //fragments where y > waterSurfaceY (above water).
    if(!self._reflClipPlane){
      self._reflClipPlane = new THREE.Plane(new THREE.Vector3(0.0, -1.0, 0.0), 0.0);
    }
    self._reflClipPlane.constant = h;
    const prevClippingPlanes = self.renderer.clippingPlanes;
    const prevLocalClipping = self.renderer.localClippingEnabled;
    self.renderer.clippingPlanes = [self._reflClipPlane];
    self.renderer.localClippingEnabled = true;

    //Linear output (NoToneMapping) so the colour feeds straight into the
    //ceiling's linear composite without a tone-map / encode round-trip.
    self.renderer.toneMapping = THREE.NoToneMapping;
    self.renderer.setRenderTarget(self._reflectionTarget);
    //Clear to the SURFACE-level inscatter murk (LINEAR — the RT is NoToneMapping
    //and feeds the ceiling's linear composite directly), not black and not the
    //camera-depth murk. This RT is the reflected (post-bounce) leg, whose path
    //starts at the surface, so its infinite-depth equilibrium is the surface
    //murk — the SAME teal the reflected geometry fogs to (mirror cam above water
    //→ uwCamDepth 0). Empty/curtain-gap directions then match the reflected
    //seabed instead of going dim, so the ceiling's TIR lookup reads teal, not a
    //dark void. Falls back to the camera-depth murk, then a seeded default,
    //before the first surface-murk update (one-frame lag, invisible).
    const m = self._uwReflCamDepthMurk || self._uwReflSurfaceMurk || self._uwMurkCamDepthScratch;
    if(m){ s.murk.setRGB(m.x, m.y, m.z); } else { s.murk.setRGB(0.02, 0.06, 0.08); }
    self.renderer.setClearColor(s.murk, 1.0);
    self.renderer.clear();
    self.renderer.render(scene, reflCam);

    self.renderer.clippingPlanes = prevClippingPlanes;
    self.renderer.localClippingEnabled = prevLocalClipping;
    self._oceanFog.far = prevFogFar;
    self._oceanFog.color.setRGB(prevFogColorR, prevFogColorG, prevFogColorB);
    scene.fog = prevFog;
    self.renderer.setClearColor(s.clearColor, prevClearAlpha);
    self.renderer.toneMapping = prevToneMapping;
    self.renderer.setRenderTarget(prevRT);
    if(skyMesh){ skyMesh.visible = skyWasVisible; }
  };

  //Pre-compile the underwater shader variants during load so the FIRST dip
  //doesn't stall. The only NEW program variant introduced underwater is the
  //clipping one: _renderUnderwaterReflection renders the whole scene with a
  //renderer-level clipping plane, and going from zero clipping planes to one
  //changes NUM_CLIPPING_PLANES, forcing every scene material to recompile the
  //first time it's drawn clipped (the multi-hundred-ms hitch on first
  //submersion; smooth after, once both variants are cached). Nothing else that
  //flips underwater changes a program: the ocean fog and a-starry-sky fog are
  //both linear THREE.Fog sharing ONE program (they differ only in uniform
  //values, and the fog-chunk injection already rebuilt that program above
  //water via its own needsUpdate sweep); .side and .visible are GL state, not
  //defines. So clipping is the whole fix.
  //
  //We warm through the REAL render path, not renderer.compile(): compile() does
  //NOT bake the global clipping-plane define, so it only re-created the no-clip
  //variants that already existed (measured: Programs still jumped +37 on the
  //first dip after a compile()-based warm). Driving the actual reflection pass
  //once renders the whole visible scene under the clip plane, compiling+linking
  //every clipping variant now (one controlled frame at load) instead of
  //mid-dive. The pass sets and restores its own fog/clip/sky/RT state, so this
  //is self-contained; the throwaway RT contents are discarded. Runs once.
  this._warmUnderwaterShaders = function(){
    if(self._underwaterShadersWarmed) return;
    if(!self.scene || !self.camera || !self.renderer) return;
    if(!self._reflectionTarget || !self._aboveWaterTransmissionTarget) return;
    try {
      //Reflection = the clipping warm (the +37). Transmission adds no new
      //programs (same materials as a normal above-water frame) but is cheap and
      //keeps the Snell-window source primed too.
      self._renderUnderwaterReflection(self.scene, self.camera);
      self._renderAboveWaterTransmission(self.scene, self.camera);
    } catch(e){ /* best-effort warm; never break the frame over a precompile */ }
    self._underwaterShadersWarmed = true;
  };

  //Render the fully-lit above-water scene from the submerged camera into the
  //above-water transmission target — the source the underwater ceiling's
  //Snell-window transmitted ray samples. The refraction G-buffer can't serve
  //this role (raw albedo, sky dome hidden, no atmospheric fog), so this
  //replays the same camera with: sky dome restored, materials un-swapped,
  //scene.fog handed back to a-starry-sky's atmospheric-perspective version
  //(so above-water terrain hazes naturally), ocean grid + curtain hidden
  //(they'd occlude the upward view). Linear output so the colour drops
  //straight into the ceiling composite. Caller hides the ocean grid; we
  //handle the rest.
  this._renderAboveWaterTransmission = function(scene, mainCamera){
    if(!self._uwTxScratch){
      self._uwTxScratch = { clearColor: new THREE.Color() };
    }
    const s = self._uwTxScratch;

    const atmRenderer = self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.atmosphereRenderer;
    const skyMesh = atmRenderer && atmRenderer.skyMesh;
    const skyWasVisible = skyMesh ? skyMesh.visible : false;
    if(skyMesh){ skyMesh.visible = true; }

    //Sun/moon disk planes are hidden underwater for the main render (sky-dome
    //swap), but the Snell window should still show them refracted through the
    //surface — so force them visible just for this above-water capture and
    //restore afterward (mirrors skyMesh above).
    const rends = self.skyDirector && self.skyDirector.renderers;
    const sunMesh = rends && rends.sunRenderer && rends.sunRenderer.sunMesh;
    const moonMesh = rends && rends.moonRenderer && rends.moonRenderer.moonMesh;
    const sunWasVisible = sunMesh ? sunMesh.visible : false;
    const moonWasVisible = moonMesh ? moonMesh.visible : false;
    if(sunMesh){ sunMesh.visible = true; }
    if(moonMesh){ moonMesh.visible = true; }

    const curtain = self.underwaterCurtainMesh;
    const curtainWasVisible = curtain ? curtain.visible : false;
    if(curtain){ curtain.visible = false; }

    //Swap the ocean underwater fog for the captured above-water fog (the
    //a-starry-sky atmospheric perspective version, captured in tick on every
    //above-water frame). Above-water fragments would otherwise get NO fog
    //at all here — the ocean chunk's world-Y gate excludes them, and the
    //atmospheric perspective branch isn't entered when scene.fog is the
    //ocean fog. Fall back to whatever's mounted if no capture exists yet.
    const prevFog = scene.fog;
    if(self._capturedSkyFog !== undefined){
      scene.fog = self._capturedSkyFog;
    }

    //Background swap — while submerged scene.background was set to the
    //murk colour; for this pass we want the captured above-water bg (the
    //sky colour) so cleared/sky-dome pixels read correctly.
    const prevBackground = scene.background;
    if(self._aboveWaterBackground !== undefined){
      scene.background = self._aboveWaterBackground;
    }

    const prevRT = self.renderer.getRenderTarget();
    const prevToneMapping = self.renderer.toneMapping;
    self.renderer.getClearColor(s.clearColor);
    const prevClearAlpha = self.renderer.getClearAlpha();

    //Linear output — feeds straight into the ceiling's linear composite
    //without a tone-map / encode round-trip.
    self.renderer.toneMapping = THREE.NoToneMapping;
    self.renderer.setRenderTarget(self._aboveWaterTransmissionTarget);
    self.renderer.setClearColor(0x000000, 1.0);
    self.renderer.clear();
    self.renderer.render(scene, mainCamera);

    scene.fog = prevFog;
    scene.background = prevBackground;
    self.renderer.setClearColor(s.clearColor, prevClearAlpha);
    self.renderer.toneMapping = prevToneMapping;
    self.renderer.setRenderTarget(prevRT);
    if(skyMesh){ skyMesh.visible = skyWasVisible; }
    if(sunMesh){ sunMesh.visible = sunWasVisible; }
    if(moonMesh){ moonMesh.visible = moonWasVisible; }
    if(curtain){ curtain.visible = curtainWasVisible; }
  };

  //Refresh the underwater caustic projector. Re-renders the animated caustic
  //slide, parks the SpotLight high above the camera aimed straight down (a
  //near-parallel cast so caustic cell size barely changes with seabed depth),
  //and crossfades its intensity through the waterline via underwaterFactor.
  //The projector XZ snaps to one slide-tile so the world-projected caustic
  //pattern stays put as the camera swims. Skipped entirely above water.
  this._updateCausticProjection = function(time, waterSurfaceY, underwaterFactor){
    const light = self.causticSpotLight;
    //Scene isn't available at construction — add the projector + its target
    //once, on the first tick that has a scene.
    if(!self._causticLightAdded && self.scene){
      self.scene.add(light);
      self.scene.add(light.target);
      self._causticLightAdded = true;
    }
    //Above water, or the caustic texture hasn't loaded yet: drive intensity to
    //zero (not light.visible — see the constructor note) and skip the RT cost.
    if(!self.causticMap || underwaterFactor <= 0.001){
      light.intensity = 0.0;
      return;
    }

    //Re-render the animated caustic slide.
    const mat = self._causticProjectionMaterial;
    mat.uniforms.causticMap.value = self.causticMap;
    mat.uniforms.uTime.value = time * 0.001;
    mat.uniforms.uTiling.value = self.causticProjectionTiling;
    const prevRT = self.renderer.getRenderTarget();
    self.renderer.setRenderTarget(self._causticProjectionTarget);
    self.renderer.render(self._causticProjectionScene, self._causticProjectionCamera);
    self.renderer.setRenderTarget(prevRT);

    //Park the projector above the camera, aimed straight down. Snapping XZ to
    //one caustic tile (footprint / tiling) means each move is a whole pattern
    //period — invisible — so the cast caustics read as world-anchored.
    const metersPerTile = (2.0 * self.causticLightConeRadius) / self.causticProjectionTiling;
    const snapX = Math.floor(self.globalCameraPosition.x / metersPerTile) * metersPerTile;
    const snapZ = Math.floor(self.globalCameraPosition.z / metersPerTile) * metersPerTile;
    light.position.set(snapX, waterSurfaceY + self.causticLightHeight, snapZ);
    light.target.position.set(snapX, waterSurfaceY - 100.0, snapZ);
    light.target.updateMatrixWorld();
    light.angle = Math.atan(self.causticLightConeRadius / self.causticLightHeight);
    //Drive both the colour and the brightness from the scene directional light
    //so caustics warm and dim through golden hour and fade to nothing once the
    //sun is below the horizon. cosZenith is the same geometric "how much sun
    //overhead" factor the underwater inscatter uses (water-shader.glsl :1391),
    //so caustic falloff at low sun matches the rest of the underwater
    //lighting stack. Without cosZenith, a sun at intensity 1 at 1° above the
    //horizon would still cast full-strength caustics.
    let sunMult = 1.0;
    if(self.brightestDirectionalLight){
      const ml = self.brightestDirectionalLight;
      light.color.copy(ml.color);
      self._uwSunDirScratch.set(ml.position.x, ml.position.y, ml.position.z)
        .sub(ml.target.position).negate().normalize();
      const cosZ = Math.max(-self._uwSunDirScratch.y, 0.0);
      sunMult = ml.intensity * cosZ;
    }
    //Compensate for the projector's inverse-square decay so the surface-level
    //caustic brightness is invariant to `causticLightHeight`. A fragment at
    //y = surfaceY sits `causticLightHeight` metres from the projector; that
    //gives a `1 / height^decay` attenuation we cancel here. Fragments deeper
    //than the surface still attenuate (their distance to the projector is
    //larger), producing the depth falloff this decay was added for.
    const decayCompensation = Math.pow(self.causticLightHeight, light.decay);
    light.intensity = self.causticLightIntensity * self.causticsStrength
                    * underwaterFactor * sunMult * decayCompensation;
  };

  //Fill A-Starry-Sky's reserved underwater-fog slot. Its `advanced` atmospheric
  //perspective globally patches THREE.ShaderChunk.fog_fragment / fog_vertex and
  //leaves an empty `else if(fogNear < 0.0)` branch marked with a //$$...$$
  //token. String-replace that token with a per-channel Beer-Lambert absorption
  //fog. Polled from tick() — the token only exists once A-Starry-Sky's
  //FogRenderer has run, and only in `advanced` mode; a harmless no-op
  //otherwise. Runs once, then forces a one-time recompile so already-built
  //materials pick up the new chunk.
  this._injectUnderwaterFogChunk = function(){
    if(self._fogChunkInjected) return;
    const fragToken = '//$$OCEAN_SHADER_SHADER_FRAGMENT_RESERVATION$$';
    const vertToken = '//$$OCEAN_SHADER_SHADER_VERTEX_RESERVATION$$';
    const fragChunk = THREE.ShaderChunk.fog_fragment;
    const vertChunk = THREE.ShaderChunk.fog_vertex;
    const parsFragChunk = THREE.ShaderChunk.fog_pars_fragment;
    if(!fragChunk || fragChunk.indexOf(fragToken) === -1) return;  //not patched yet

    //fog_pars_fragment runs at file scope (uniform declarations). Append our
    //sun-direction uniform there — fog_fragment runs inside main() so uniform
    //declarations don't work in our reservation slot. Idempotent guard so
    //repeated calls don't accumulate copies.
    if(parsFragChunk && parsFragChunk.indexOf('uniform vec3 uwSunDir;') === -1){
      THREE.ShaderChunk.fog_pars_fragment = parsFragChunk + '\nuniform vec3 uwSunDir;\n';
    }

    //Per-channel extinction (1/m) baked into the chunk as a const vec3 —
    //THREE.Fog only smuggles one Color + two floats, so for per-channel
    //chromatic falloff (red dies faster than blue, the cue that distant
    //underwater geometry reads cyan/blue) we inject extinction directly. It
    //is read once at the current water_type / explicit RGB; a live water-type
    //swap would need a chunk re-injection + needsUpdate sweep (rare, paid as
    //a one-time recompile when it happens).
    const presetJ = ARestlessOcean.JERLOV_PRESETS[self.data.water_type | 0];
    const absV = presetJ ? presetJ.absorption : self.data.water_absorption;
    const sctV = presetJ ? presetJ.scattering : self.data.water_scattering;
    const ex = Math.max(absV.x + sctV.x, 1e-4);
    const ey = Math.max(absV.y + sctV.y, 1e-4);
    const ez = Math.max(absV.z + sctV.z, 1e-4);
    const extLit = 'vec3(' + ex.toFixed(6) + ',' + ey.toFixed(6) + ',' + ez.toFixed(6) + ')';
    //Per-channel multiple-scatter ratio for the diffuse "ocean colour" glow the
    //chunk adds below. fogColor already carries albedo·(E_sun+E_sky)/4π, and we
    //want fogColor·uwMsRatio == R∞·(E_sun+E_sky)/π — the semi-infinite diffuse
    //reflectance term that matches water-shader.glsl's underwaterInscatterSurface.
    //Solving: uwMsRatio = 4·R∞/albedo, R∞ = (1-√(1-a))/(1+√(1-a)). ~4× the old
    //a²/(1-a)/(4π) floor at ocean albedos (~0.2) so the murk reads as real teal.
    const rInf = function(a){ const s = Math.sqrt(Math.max(1.0 - a, 0.0)); return (1.0 - s) / (1.0 + s); };
    const albMx = (sctV.x / ex), albMy = (sctV.y / ey), albMz = (sctV.z / ez);
    const msx = 4.0 * rInf(albMx) / Math.max(albMx, 1e-4);
    const msy = 4.0 * rInf(albMy) / Math.max(albMy, 1e-4);
    const msz = 4.0 * rInf(albMz) / Math.max(albMz, 1e-4);
    const msLit = 'vec3(' + msx.toFixed(6) + ',' + msy.toFixed(6) + ',' + msz.toFixed(6) + ')';

    //Smuggle convention for the ocean branch (fogFar > 0 && fogNear < 0):
    //  fogColor.rgb = isotropic-baseline inscatter at depth 0, per channel.
    //                 `waterAlbedo · (E_sun + E_sky) / (4π)` — i.e., the
    //                 surface equilibrium AS IF both sun and sky had isotropic
    //                 phase. The chunk re-weights below to push sun through
    //                 Henyey-Greenstein while keeping sky isotropic.
    //  -fogNear     = water surface Y (the waterline) — selects ocean branch
    //                 AND drives the world-Y gate.
    //  fogFar       = signed sun-fraction smuggle:
    //                   sign(fogFar)  → linear-vs-sRGB target encoding
    //                                   (+ = sRGB canvas, − = linear RT).
    //                   |fogFar|      → fraction of E_sun in (E_sun + E_sky),
    //                                   used to split HG-vs-isotropic terms.
    //  uwSunDir     = world-space direction sunlight TRAVELS (away from sun),
    //                 matching water-shader.glsl's brightestDirectionalLightDirection.
    //                 Declared in fog_pars_fragment via the append above.
    //Per-channel extinction is the const `uwExt` baked in above.
    //NO WORLD-Y GATE: the ocean branch only runs when the camera is submerged
    //(scene.fog is swapped to the ocean fog underwater; above water it's
    //a-starry-sky's atmospheric fog and this branch is never entered). When
    //submerged the whole view is underwater, so every fragment fogs uniformly.
    //Above-water geometry (the lighthouse etc.) is never DIRECTLY visible from
    //below — any sightline from a submerged camera to an air-side point crosses
    //the surface, and the FFT surface mesh (clipmap + horizon skirt) is rendered
    //along it and overdraws those pixels with the Snell-window transmission
    //composite. So the over-fog on those hidden fragments is masked by the real
    //wavy surface; the surface mesh IS the per-fragment medium boundary. This
    //replaces the old flat `vFogWorldPosition.y < uwSurfaceY` plane gate, whose
    //single-point/2-cascade probe height left a flat fog ceiling that bobbed at
    //the wrong (long-swell-only) frequency and an un-fogged band under crests.
    //The mirror RT independently clips y>waterline (see _renderUnderwater
    //Reflection's _reflClipPlane), so its fragments are all below-surface too —
    //removing the gate doesn't change that pass. vFogWorldPosition is
    //A-Starry-Sky's existing advanced-fog varying; the vertex slot below fills
    //it for the ocean branch (still used for the per-fragment depth darkening).
    const fragGLSL = [
      'const vec3 uwExt = ' + extLit + ';',
      'const vec3 uwMsRatio = ' + msLit + ';',
      //Phase-function constants. g=0.85 is the canonical clean-ocean
      //Henyey-Greenstein asymmetry parameter (Mobley 1994), but a phase
      //that peaked makes perpendicular-to-sun scatter ~100× weaker than
      //the forward halo — the horizon under a noon sun reads nearly black.
      //0.5 (turbid coastal range) lifts the perpendicular contribution so
      //the horizon picks up real sun light and asymptotes to teal. Match
      //the same value in water-shader.glsl's underwaterInscatterSurface.
      //The 1/(4π) is the steradian-normalisation baked into HG.
      'const float UW_HG_G = 0.5;',
      'const float UW_INV_4PI = 0.07957747154;',
      //Gaze-dependence of the murk's SUN single-scatter term. 1.0 = full HG halo
      //(physical: brighter toward the sun); 0.0 = isotropic (view-independent
      //teal) so the direct seabed (down gaze) and reflected ceiling (up gaze)
      //fade to the SAME teal. Kept at 0.0 for the uniform "colour of the water"
      //look. MUST match UW_MURK_GAZE_WEIGHT in water-shader.glsl so the seabed/
      //curtain fog (this chunk) and the ceiling/body fog (the water shader) stay
      //in lockstep. Flip both to 1.0 to restore the physical sun glow.
      'const float UW_MURK_GAZE_WEIGHT = 0.0;',
      //Underwater fog isolation taps — debugging the seabed-vs-ceiling murk match.
      //MUST match UW_DEBUG_FOG_MODE in water-shader.glsl applyUnderwaterFog.
      //  0 = normal production blend.
      //  1 = NO fog (raw input color passes straight through).
      //  2 = fog a CONSTANT input color (vec3(0.5)) — isolates the fog blend
      //      from the geometry colour; both paths start from the same input.
      //  3 = output the MURK only (full fog) — shows EXACTLY what each path
      //      fades to. Top (ceiling murk) vs bottom (this seabed murk).
      'const int UW_DEBUG_FOG_MODE = 0;',
      //Underwater path-length scale. 1.0 = physically true geometric distance:
      //extinction integrates over the REAL ray length, no magnification — the
      //distance to a rock is the distance to a rock, a surface->floor reflection
      //bounce is just its real longer path. Was 0.3, a non-physical clarity fudge
      //(see the matching note in water-shader.glsl). Set water visibility via
      //water_type / the Jerlov coefficients instead. Must match the water-shader
      //UW_DIST_SCALE so the ceiling and direct-view seabed asymptote to the same
      //effective extinction.
      'const float UW_DIST_SCALE = 1.0;',
      'float uwSurfaceY = -fogNear;',
      //Path length is the true geometric distance through water (x the 1.0 scale
      //above). Direction-isotropic — a surface at the camera's own depth fogs the
      //same as one above or below it at the same range.
      //  * MAIN render (real camera below water): the whole camera→frag ray
      //    is in water → discount the full geometric length.
      //  * MIRROR render (mirror camera above water, by the reflection-trick
      //    equivalence the mirror straight-line = the real bounce path): the
      //    camera→bounce segment is ALREADY fogged by the water shader's
      //    applyUnderwaterFog at the ceiling, so this branch only fogs the
      //    post-bounce leg = (1 - t)·totalLen, then applies the same discount.
      //    For an object TOUCHING the surface t collapses to the frag →
      //    second leg = 0 → no extra fog, so the reflection of that touching
      //    point matches the surrounding water surface.
      '  vec3 dir = vFogWorldPosition - cameraPosition;',
      '  float totalLen = length(dir);',
      '  float uwDist;',
      '  if(cameraPosition.y < uwSurfaceY){',
      '    uwDist = totalLen * UW_DIST_SCALE;',
      '  } else {',
      '    float t = (uwSurfaceY - cameraPosition.y) / dir.y;',
      '    t = clamp(t, 0.0, 1.0);',
      '    uwDist = (1.0 - t) * totalLen * UW_DIST_SCALE;',
      '  }',
      '  vec3 uwT = exp(-uwExt * uwDist);',
      //HG sun phase. cosθ = dot(incident, scattered) = dot(uwSunDir, -viewDir)
      //= -dot(uwSunDir, viewDir). cosθ ≈ +1 when the camera looks TOWARD the
      //sun (forward scatter, peaked HG); ≈ -1 looking down-sun.
      '  vec3 uwViewDir = (totalLen > 1e-4) ? (dir / totalLen) : vec3(0.0, -1.0, 0.0);',
      '  float uwCosTheta = -dot(uwViewDir, uwSunDir);',
      '  float uwG2 = UW_HG_G * UW_HG_G;',
      '  float uwHG = (1.0 - uwG2) * UW_INV_4PI',
      '             / pow(max(1.0 + uwG2 - 2.0 * UW_HG_G * uwCosTheta, 1e-4), 1.5);',
      //Angular factor that turns the isotropic-baseline fogColor into the
      //actual physical inscatter. Derivation: real = α·(E_sun·p_HG + E_sky·p_sky),
      //baseline (full iso) = α·(E_sun + E_sky)·(1/4π). With sunFrac = E_sun/(E_sun+E_sky):
      //  real / baseline = 4π · sunFrac · p_HG + 2 · (1 - sunFrac)
      //  (sky uses p_sky = 1/(2π) for a uniform upper-hemisphere with isotropic
      //   phase; 4π·1/(2π) = 2). |fogFar| carries sunFrac, sign carries
      //   linear/sRGB.
      //fogFar magnitude carries BOTH the sunFrac and the output-domain flag:
      //  main canvas (sRGB) → fogFar = sunFrac        in [0,1]
      //  reflection RT (linear) → fogFar = sunFrac+10 in [10,11]
      //The sign can't carry the flag — a-starry-sky reserves fogFar<=0 for its
      //atmospheric branch (which would steal this whole pass from us). >5 ⇒
      //linear RT output, skip the sRGB roundtrip; else sRGB main canvas.
      '  bool uwInputIsSRGB = fogFar < 5.0;',
      '  float uwSunFrac = uwInputIsSRGB ? fogFar : (fogFar - 10.0);',
      //Blend the HG halo toward isotropic (1/4π) by UW_MURK_GAZE_WEIGHT — at 0.0
      //the sun term is view-independent, mirroring underwaterInscatterSurface's
      //pSun blend so the direct seabed murk matches the reflected ceiling murk.
      '  float uwHGiso = mix(UW_INV_4PI, uwHG, UW_MURK_GAZE_WEIGHT);',
      '  float uwAngFactor = 4.0 * 3.14159265359 * uwSunFrac * uwHGiso',
      '                    + 2.0 * (1.0 - uwSunFrac);',
      //Single-scatter (angular) term + isotropic multiple-scatter floor. The
      //angular term collapses toward 0 perpendicular to the sun (the horizon
      //under a high sun), which read as black; the MS floor (fogColor·uwMsRatio,
      //view-independent) keeps the distance fading to a real teal. Mirrors
      //water-shader.glsl underwaterInscatterSurface so seabed and ceiling agree.
      '  vec3 uwMurkSurface = fogColor * uwAngFactor + fogColor * uwMsRatio;',
      //Camera-depth darkening (NOT fragment depth). Inscatter is front-loaded
      //near the eye, so the equilibrium every long ray fades to is the medium's
      //radiance at the CAMERA's depth — one "colour of the water" in all
      //directions. Darkening by the far fragment's own depth instead crushed
      //the deep seabed / abyss veil to black and made it disagree with the
      //ceiling (which darkens by ~0) and the curtain (camera depth). Matches
      //water-shader.glsl underwaterInscatterSurface's camDepthDarken. In the
      //mirror RT pass cameraPosition is the above-water mirror cam, so this
      //clamps to 0 — surface-level inscatter for the post-bounce leg, correct.
      //INVESTIGATED 2026-06-06 (camera-Y console probe in _renderUnderwater
      //Reflection): RULED OUT as the direct-vs-reflected brightness divergence.
      //The probe confirmed the mirror cam is always above water when submerged
      //(mirrorCamDepth ≡ 0), so this term IS 0 in the reflection — but the same
      //real depth (mainCamDepth) is applied to BOTH views: directly here for the
      //seabed, and for the reflection via the pre-darkened fogColor swap
      //(_uwBaselineCamDepth) in stage 1 PLUS underwaterInscatterSurface's
      //camDepthDarken (real cam) in stage 2. Identical factor on both sides → it
      //cancels in the comparison and cannot open a gap between them. The real
      //asymmetry left is the HG sun-halo VIEW DIRECTION (this seabed gaze vs the
      //ceiling's up gaze), not the depth term.
      '  float uwCamDepth = max(0.0, uwSurfaceY - cameraPosition.y);',
      '  vec3 uwMurk = uwMurkSurface * exp(-uwExt * uwCamDepth);',
      //fog_fragment runs AFTER colorspace_fragment, so gl_FragColor here is
      //already in the target encoding — the sRGB roundtrip is needed ONLY
      //for the sRGB-encoded path. Doing it unconditionally pushed the
      //reflection RT's linear data through a spurious pow(·, 2.4) cycle.
      '  vec3 uwLinear = uwInputIsSRGB',
      '    ? fogsRGBToLinear(vec4(gl_FragColor.rgb, 1.0)).rgb',
      '    : gl_FragColor.rgb;',
      //Fog blend, with the UW_DEBUG_FOG_MODE isolation taps (see const above).
      '  if(UW_DEBUG_FOG_MODE == 1){ /* raw input, no fog */ }',
      '  else if(UW_DEBUG_FOG_MODE == 2){ uwLinear = vec3(0.5) * uwT + uwMurk * (vec3(1.0) - uwT); }',
      '  else if(UW_DEBUG_FOG_MODE == 3){ uwLinear = uwMurk; }',
      '  else { uwLinear = uwLinear * uwT + uwMurk * (vec3(1.0) - uwT); }',
      //sRGB (main-canvas) path: TONEMAP the fogged result with MyAES before
      //encoding — the renderer is NoToneMapping, so scene geometry arrives here
      //un-tonemapped (raw linear radiance), and without this it would sRGB-encode
      //straight, reading far brighter than the same geometry seen in the water
      //surface or the reflection (both of which go through MyAES). This mirrors
      //a-starry-sky's OWN atmospheric branch, which MyAES-tonemaps its fogged
      //ground — so above-water and below-water scene geometry now tonemap alike.
      //LINEAR RT (reflection) path: do NOT tonemap here — the ceiling composite
      //applies MyAES once when it samples this RT, so tonemapping now would
      //double it.
      '  gl_FragColor.rgb = uwInputIsSRGB',
      '    ? fogLinearTosRGB(vec4(MyAESFilmicToneMapping(uwLinear), 1.0)).rgb',
      '    : uwLinear;'
    ].join('\n');
    const vertGLSL = [
      'vFogDepth = - mvPosition.z;',
      'vFogWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    ].join('\n');

    THREE.ShaderChunk.fog_fragment = fragChunk.replace(fragToken, fragGLSL);
    if(vertChunk && vertChunk.indexOf(vertToken) !== -1){
      THREE.ShaderChunk.fog_vertex = vertChunk.replace(vertToken, vertGLSL);
    }
    self._fogChunkInjected = true;

    //Sun-direction broadcast for the chunk's HG sun phase. The chunk's GLSL
    //references `uwSunDir` (world-space, points FROM sun TO scene = the
    //direction sunlight travels — same convention as water-shader.glsl's
    //brightestDirectionalLightDirection). Three's UniformsUtils.clone deep-
    //clones Vector3, so we can't share a single reference via UniformsLib;
    //instead we patch the per-shader-lib uniforms map so NEWLY-built fog
    //materials get the slot, then per-frame traverse the scene and write
    //the current sun direction into each material's local Vector3 clone.
    //_sharedUwSunDir is the source-of-truth that the tick updates; the
    //traversal copies it onto every fog material.
    if(!self._sharedUwSunDir){
      self._sharedUwSunDir = new THREE.Vector3(0.0, -1.0, 0.0);
    }
    const shaderLibNames = ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon'];
    for(let i = 0; i < shaderLibNames.length; ++i){
      const lib = THREE.ShaderLib && THREE.ShaderLib[shaderLibNames[i]];
      if(lib && lib.uniforms && !lib.uniforms.uwSunDir){
        lib.uniforms.uwSunDir = { value: new THREE.Vector3(0.0, -1.0, 0.0) };
      }
    }
    if(THREE.UniformsLib && THREE.UniformsLib.fog && !THREE.UniformsLib.fog.uwSunDir){
      THREE.UniformsLib.fog.uwSunDir = { value: new THREE.Vector3(0.0, -1.0, 0.0) };
    }

    //Rebuild fog-enabled materials already compiled against the old chunk
    //(one-time startup hitch). At the same time, attach the uwSunDir uniform
    //to any material that lacks it — covers existing scenes that were built
    //before the ShaderLib patch above could take effect.
    if(self.scene){
      self.scene.traverse(function(obj){
        if(!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for(let i = 0; i < mats.length; ++i){
          const m = mats[i];
          if(!m || !m.fog) continue;
          if(m.uniforms && !m.uniforms.uwSunDir){
            m.uniforms.uwSunDir = { value: new THREE.Vector3(0.0, -1.0, 0.0) };
          }
          m.needsUpdate = true;
        }
      });
    }
  };

  //Per-frame broadcast of the current sun direction to every fog-receiving
  //material's `uwSunDir` uniform. Source is `self._sharedUwSunDir`, which the
  //tick updates once after probing the directional-light list. Cost is one
  //scene traversal per frame; the per-material write is a Vector3.copy().
  this._broadcastUwSunDir = function(){
    if(!self.scene || !self._sharedUwSunDir) return;
    const src = self._sharedUwSunDir;
    self.scene.traverse(function(obj){
      if(!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for(let i = 0; i < mats.length; ++i){
        const m = mats[i];
        if(!m || !m.fog || !m.uniforms) continue;
        //Self-heal: a material added to the scene AFTER the chunk-injection
        //traversal won't have the slot yet. Attach it on first sight and
        //flag needsUpdate so the next render rebuilds the program with the
        //appended fog_pars_fragment uniform declaration in scope.
        if(!m.uniforms.uwSunDir){
          m.uniforms.uwSunDir = { value: new THREE.Vector3() };
          m.needsUpdate = true;
        }
        m.uniforms.uwSunDir.value.copy(src);
      }
    });
  };

  this.tick = function(time){

    //Hide splash particles for the whole offscreen-pass block below (refraction
    //G-buffer, reflection, foam/exclusion orthos, CSM, caustics). They are
    //re-shown at the very end of tick so they appear only in the main render.
    if(self.oceanSplash) self.oceanSplash.mesh.visible = false;

    //Update directional lights list (collect all in scene)
    if(self.directionalLights.length === 0){
      for(let i = 0, numItems = self.scene.children.length; i < numItems; ++i){
        let child = self.scene.children[i];
        if(child.type === 'DirectionalLight'){
          self.directionalLights.push(child);
        }
        //Standalone ambient source for the underwater inscatter term — used
        //only when there's no a-starry-sky skyDirector to supply the y-axis
        //hemispherical. First HemisphereLight found wins.
        else if(!self._fallbackHemiLight && child.type === 'HemisphereLight'){
          self._fallbackHemiLight = child;
        }
      }
    }

    //Keep brightestDirectionalLight for backward compatibility
    if(this.brightestDirectionalLight === false && self.directionalLights.length > 0){
      self.brightestDirectionalLight = self.directionalLights[0];
    }

    //Copy the camera position in the world...
    if(self.camera !== self.parentComponent.el.sceneEl.camera){
      //Attach the scene camera if it does not exist yet
      self.camera = self.parentComponent.el.sceneEl.camera;
    }
    const sceneCamera = self.camera;
    sceneCamera.getWorldPosition(self.globalCameraPosition);

    //Ensure render targets match current drawing buffer size (A-Frame may resize after construction)
    self.renderer.getDrawingBufferSize(rendererSize);
    if(self.refractionGBufferTarget.width !== rendererSize.x || self.refractionGBufferTarget.height !== rendererSize.y){
      self.refractionGBufferTarget.setSize(rendererSize.x, rendererSize.y);
      self.refractionGBufferTarget.depthTexture = new THREE.DepthTexture(
        rendererSize.x, rendererSize.y, THREE.UnsignedIntType
      );
      self.refractionGBufferTarget.depthTexture.format = THREE.DepthFormat;
      self._reflectionTarget.setSize(
        Math.max(1, (rendererSize.x * self.reflectionResolutionScale) | 0),
        Math.max(1, (rendererSize.y * self.reflectionResolutionScale) | 0)
      );
      self._aboveWaterTransmissionTarget.setSize(
        Math.max(1, (rendererSize.x * self.reflectionResolutionScale) | 0),
        Math.max(1, (rendererSize.y * self.reflectionResolutionScale) | 0)
      );
    }

    //Update the state of our ocean grid
    self.time = time;

    //Compute a single snapped camera offset shared by all rings.
    //Snapping at ring 0's cell size prevents the mesh from sliding continuously over the
    //displacement field (which would make the wave texture and surface detail drift at
    //different apparent speeds as the camera moves). All rings use the same offset so
    //their shared boundaries stay perfectly aligned — using per-ring granularities would
    //cause gaps since ring k and ring k+1 would snap to different values.
    const snapCellSize = self.patchSize / self.numCells;
    ringSnapX[0] = Math.floor(self.globalCameraPosition.x / snapCellSize) * snapCellSize;
    ringSnapZ[0] = Math.floor(self.globalCameraPosition.z / snapCellSize) * snapCellSize;

    for(let i = 0, numOceanPatches = self.oceanPatches.length; i < numOceanPatches; ++i){
      const oceanPatch = self.oceanPatches[i];
      const xOffset = oceanPatch.initialPosition.x + ringSnapX[0];
      const yOffset = oceanPatch.initialPosition.y;
      const zOffset = oceanPatch.initialPosition.z + ringSnapZ[0];
      const translationMatrix = oceanPatchTranslationMatrices[i];
      translationMatrix.makeTranslation(xOffset, yOffset, zOffset);
      self.oceanPatches[i].instanceMeshRef.setMatrixAt(oceanPatch.instanceID, translationMatrix);
    }

    //Inform the system that we need to update all the instance matrices every frame
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].instanceMatrix.needsUpdate = true;
    }

    //Frustum Cull our grid
    //self.cameraFrustum.setFromProjectionMatrix(self.camera.projectionMatrix.clone().multiply(self.camera.matrixWorldInverse));

    //Hide all of our ocean grid elements
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].visible = false;
    }

    //Render scene to G-buffer (3 MRT attachments: albedo, world-normal,
    //linear-depth). scene.overrideMaterial can't carry per-mesh albedo, so
    //we swap each visible non-ocean mesh's material to a cached G-buffer
    //variant that reads that source material's own .color / .map. Restored
    //immediately after render.
    self._swappedMeshes.length = 0;
    const curtainSkip = self.underwaterCurtainMesh;
    scene.traverse(function(obj){
      if(!obj.isMesh || !obj.visible || !obj.material) return;
      //Skip ShaderMaterial sources — they're custom shaders (ocean, etc.)
      //whose attribute usage we can't safely replace with our G-buffer shader.
      if(obj.material.isShaderMaterial) return;
      if(Array.isArray(obj.material) && obj.material.some(function(m){ return m.isShaderMaterial; })) return;
      //Skip the underwater curtain: a 300 m BackSide sphere would write a
      //spherical shell into refraction depth and the water shader's Snell-
      //window seabed lookup would sample curtain colour instead of seabed.
      if(obj === curtainSkip) return;
      const gBuf = self._resolveGBufferMaterial(obj.material);
      self._swappedMeshes.push({ mesh: obj, original: obj.material });
      obj.material = gBuf;
    });

    const currentRefractionRT = self.renderer.getRenderTarget();
    //Suppress the scene backdrop for this pass. A-Frame's `background` component
    //drives BOTH scene.background AND the renderer clear color/alpha, and THREE
    //clears a render target to those — filling the G-buffer's open-water texels
    //with the sky colour at alpha 1 ("geometry present"), so the water samples
    //the backdrop as its refraction and blends invisibly into it. We force the
    //clear to alpha 0 ("no seabed → fall back to body colour") AND null the
    //background so no background quad re-opaques it. Both restored right after,
    //so the MAIN render still shows the sky. (Mirrors the transmission pass.)
    const _savedBackground = scene.background;
    scene.background = null;
    self._refrClearColor = self._refrClearColor || new THREE.Color();
    self.renderer.getClearColor(self._refrClearColor);
    const _savedClearAlpha = self.renderer.getClearAlpha();
    self.renderer.setClearColor(0x000000, 0.0);
    self.renderer.setRenderTarget(self.refractionGBufferTarget);
    self.renderer.clear();
    self.renderer.render(scene, sceneCamera);
    self.renderer.setRenderTarget(currentRefractionRT);
    self.renderer.setClearColor(self._refrClearColor, _savedClearAlpha);
    scene.background = _savedBackground;

    for(let i = 0, n = self._swappedMeshes.length; i < n; ++i){
      const entry = self._swappedMeshes[i];
      entry.mesh.material = entry.original;
    }
    self._swappedMeshes.length = 0;

    //Underwater planar reflection — rendered from the mirror camera while the
    //ocean grid is still hidden (so water is never in its own reflection) and
    //materials are restored to their lit originals. Gated on last frame's
    //submersion state — the probe runs later in tick, and one frame of lag on
    //the in/out transition is invisible. Pure overhead above water, so skip.
    if(self._wasUnderwater){
      self._renderUnderwaterReflection(scene, sceneCamera);
      self._renderAboveWaterTransmission(scene, sceneCamera);
    }

    //Update our sea foam camera - use position pass material to output world-space height data
    const currentRenderTarget = self.renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    //Snap foam/exclusion camera XZ to texel-sized increments so the orthos
    //sample the same world-space points across frames — otherwise the foam
    //and exclusion atlases shift by a fractional pixel each frame as the
    //player moves, producing visible flicker on the foam pattern. The water
    //shader must then sample using these SNAPPED positions (uploaded as
    //foamCameraXZ / exclusionCameraXZ uniforms), not raw cameraPosition.
    //Same pattern as the per-cell clipmap snap at the top of this tick.
    const foamTexel = (2.0 * 2048.0) / self.foamRenderTarget.width; // 4096m / 1024px = 4m
    const exclTexel = (2.0 *  250.0) / self.exclusionRenderTarget.width; // 500m / 1024px ≈ 0.488m
    const foamSnapX = Math.round(self.globalCameraPosition.x / foamTexel) * foamTexel;
    const foamSnapZ = Math.round(self.globalCameraPosition.z / foamTexel) * foamTexel;
    const exclSnapX = Math.round(self.globalCameraPosition.x / exclTexel) * exclTexel;
    const exclSnapZ = Math.round(self.globalCameraPosition.z / exclTexel) * exclTexel;
    self._foamCameraXZ = self._foamCameraXZ || new THREE.Vector2();
    self._exclusionCameraXZ = self._exclusionCameraXZ || new THREE.Vector2();
    self._foamCameraXZ.set(foamSnapX, foamSnapZ);
    self._exclusionCameraXZ.set(exclSnapX, exclSnapZ);

    //── Snap-gated re-render ───────────────────────────────────────────────
    //The foam/exclusion orthos capture STATIC terrain height from a fixed
    //top-down view, so their output is INVARIANT to camera yaw — it only
    //changes when the snapped origin translates. Re-rendering identical
    //FloatType atlases every frame during pure rotation was the bulk of the
    //per-frame GPU cost behind the "freezes when I rotate" symptom. We now
    //re-render only on a snap delta, with a periodic forced refresh so slow-
    //moving dynamic occluders (a drifting boat etc.) still imprint their
    //height within FOAM_MAX_STALE_FRAMES.
    const FOAM_MAX_STALE_FRAMES = 30;   // ~0.5 s @60 fps safety refresh
    self._foamStaleFrames = (self._foamStaleFrames || 0) + 1;
    const forceFoamRefresh = !self._foamEverRendered || self._foamStaleFrames >= FOAM_MAX_STALE_FRAMES;
    const renderFoam = forceFoamRefresh || self._lastFoamSnapX !== foamSnapX || self._lastFoamSnapZ !== foamSnapZ;
    const renderExcl = forceFoamRefresh || self._lastExclSnapX !== exclSnapX || self._lastExclSnapZ !== exclSnapZ;

    if(renderFoam || renderExcl){
      self.scene.overrideMaterial = self.positionPassMaterial;
      self.renderer.setClearAlpha(0.0);
      //Null the backdrop for these top-down position passes too. With a
      //scene.background set, THREE's background quad stamps alpha 1 into the
      //foam/exclusion atlases over open water — and the exclusion .a channel is
      //the water shader's discard gate (worldPosition.y > discardHeight). That
      //made every open-water fragment within exclusion range discard (near water
      //gone, horizon — outside range — survived). Restored at the block's end.
      var _foamSavedBackground = scene.background;
      scene.background = null;
      if(renderFoam){
        self.foamCamera.position.set(foamSnapX, this.heightOffset + self.foamCameraHeight, foamSnapZ);
        self.foamCamera.lookAt(foamSnapX, this.heightOffset - 1.0, foamSnapZ);
        self.foamCamera.updateProjectionMatrix();
        self.renderer.setRenderTarget(self.foamRenderTarget);
        self.renderer.clear();
        self.renderer.render(scene, self.foamCamera);
        self.renderer.setRenderTarget(null);
        self._lastFoamSnapX = foamSnapX;
        self._lastFoamSnapZ = foamSnapZ;
        //Copy the just-rendered terrain-height ortho to the CPU (async) so the
        //splash system can detect the shoreline. Only fires on snap-change, so
        //the transfer is rare. Half-width is 2048 m (see foamTexel above).
        if(self.oceanSplash){
          self.oceanSplash.requestTerrainReadback(self.foamRenderTarget, foamSnapX, foamSnapZ, 2048.0);
        }
      }
      if(renderExcl){
        self.exclusionCamera.position.set(exclSnapX, this.heightOffset + self.foamCameraHeight, exclSnapZ);
        self.exclusionCamera.lookAt(exclSnapX, this.heightOffset - 1.0, exclSnapZ);
        self.exclusionCamera.updateProjectionMatrix();
        self.renderer.setRenderTarget(self.exclusionRenderTarget);
        self.renderer.clear();
        //Capture the boat hull DOUBLE-SIDED for this pass only. The boat is a
        //thin/mixed-winding shell, so FrontSide back-face-culls every floor or
        //hull triangle whose normal points away from this top-down camera —
        //those texels capture nothing, read mask 0, and the water is never
        //discarded there, poking through one un-captured triangle at a time
        //("little tris" inside the hull). DoubleSide makes the capture purely
        //depth-based regardless of winding. Restored to FrontSide immediately
        //so the shared foam terrain pass is unaffected. (.side is a cull-state
        //toggle, not a #define — no shader recompile.)
        self.positionPassMaterial.side = THREE.DoubleSide;
        self.renderer.render(scene, self.exclusionCamera);
        self.positionPassMaterial.side = THREE.FrontSide;
        self.renderer.setRenderTarget(null);
        self._lastExclSnapX = exclSnapX;
        self._lastExclSnapZ = exclSnapZ;
      }
      //Restore our original materials + clear state (captured BEFORE zeroing —
      //the old code captured alpha AFTER setClearAlpha(0) and so "restored" 0,
      //leaking a 0 clear alpha into the rest of the frame).
      self.scene.overrideMaterial = null;
      self.renderer.setRenderTarget(currentRenderTarget);
      self.renderer.setClearAlpha(prevClearAlpha);
      scene.background = _foamSavedBackground;
      self._foamStaleFrames = 0;
      self._foamEverRendered = true;
    }
    //foamRenderMap / exclusionMap always point at their (persistent) textures,
    //whether or not we re-rendered this frame.
    this.foamRenderMap = self.foamRenderTarget.texture;
    this.exclusionMap = self.exclusionRenderTarget.texture;

    //Show all of our ocean grid elements again
    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].visible = true;
    }

    //Update each of our ocean grid height maps
    self.oceanHeightBandLibrary.tick(time);

    self.oceanHeightComposer.tick();

    //Refresh the local CPU height field for scalable exact buoyancy queries
    //(tiny GPU pass + async read; no-ops unless something asked for it).
    self._updateHeightField();

    //── Underwater submersion probe ────────────────────────────────────────
    //Read two 1-px FFT-displacement texels above/below the camera so the CPU
    //knows the wave-displaced water level — the only way to drive the air/water
    //swap without it popping under passing crests. Cascades 0 (4096 m) + 1
    //(1024 m) carry the dominant swell; the small cascades add at most
    //decimetre chop and are skipped.
    //
    //The read is ASYNC (PBO fence) when the renderer supports it. A synchronous
    //readRenderTargetPixels drains the ENTIRE GPU command queue before it
    //returns, and that stall grows with GPU load — which is exactly why
    //rotating (more geometry in flight) made the frame freeze. The async result
    //lands a few frames later; the surface moves at swell speed and the swap is
    //smoothed over a 1 m band, so the lag is invisible (we already accept a
    //one-frame lag for the reflection mirror plane below). A fresh pair of reads
    //is issued only once the previous pair resolves (_probePending), and the
    //last resolved height is reused every frame in between. Falls back to the
    //blocking read on renderers without readRenderTargetPixelsAsync.
    const composer = self.oceanHeightComposer;
    const probeReady = composer && composer.cascadeDisplacementTextures && composer.cascadeDisplacementTextures[1];
    const canAsyncProbe = typeof self.renderer.readRenderTargetPixelsAsync === 'function';
    if(self._probeWaterSurfaceY === undefined){ self._probeWaterSurfaceY = self.heightOffset; }
    let waterSurfaceY = self._probeWaterSurfaceY;

    if(probeReady && canAsyncProbe){
      if(!self._probePending){
        self._probePending = true;
        self._probeBuf0 = self._probeBuf0 || new Float32Array(4);
        self._probeBuf1 = self._probeBuf1 || new Float32Array(4);
        const bufs = [self._probeBuf0, self._probeBuf1];
        const res = composer.baseTextureWidth;
        const offsets = self.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
        const whm = composer.waveHeightMultiplier;
        const promises = [];
        for(let c = 0; c < 2; ++c){
          const patch = composer._cascadePatchSizes[c];
          let u = (self.globalCameraPosition.x + offsets[c].x) / patch;
          let v = (self.globalCameraPosition.z + offsets[c].y) / patch;
          u -= Math.floor(u);
          v -= Math.floor(v);
          const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
          const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
          const rt = composer.cascadeDisplacementTargets[c];
          promises.push(self.renderer.readRenderTargetPixelsAsync(rt, px, py, 1, 1, bufs[c]));
        }
        Promise.all(promises).then(function(){
          //.y (green) channel = vertical displacement, summed over both cascades.
          self._probeWaterSurfaceY = self.heightOffset + (self._probeBuf0[1] + self._probeBuf1[1]) * whm;
          self._probePending = false;
        }).catch(function(){ self._probePending = false; });
      }
      //waterSurfaceY already holds the last resolved value (set above).
    } else if(probeReady){
      //Blocking fallback (original behaviour) — renderers without async readback.
      self._surfaceProbeBuffer = self._surfaceProbeBuffer || new Float32Array(4);
      const buf = self._surfaceProbeBuffer;
      const res = composer.baseTextureWidth;
      const offsets = self.oceanMaterial.uniforms.cascadeSpatialOffsets.value;
      const whm = composer.waveHeightMultiplier;
      waterSurfaceY = self.heightOffset;
      for(let c = 0; c < 2; ++c){
        const patch = composer._cascadePatchSizes[c];
        let u = (self.globalCameraPosition.x + offsets[c].x) / patch;
        let v = (self.globalCameraPosition.z + offsets[c].y) / patch;
        u -= Math.floor(u);
        v -= Math.floor(v);
        const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
        const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
        const rt = composer.cascadeDisplacementTargets[c];
        self.renderer.readRenderTargetPixels(rt, px, py, 1, 1, buf);
        waterSurfaceY += buf[1] * whm;   //.y (green) channel = vertical displacement
      }
      self._probeWaterSurfaceY = waterSurfaceY;
    }
    //Stash this frame's displaced surface height for next frame's reflection
    //mirror plane (the RT renders BEFORE this probe runs, so there's a
    //one-frame lag — same pattern as `_wasUnderwater`).
    self._lastWaterSurfaceY = waterSurfaceY;
    const cameraSubmersion = self.globalCameraPosition.y - waterSurfaceY;
    //Smooth 0→1 underwater blend over a 1 m band centred on the surface so
    //bobbing through the waterline crossfades the fog instead of snapping.
    const uwHalfBand = 0.5;
    let uwT = (uwHalfBand - cameraSubmersion) / (2.0 * uwHalfBand);
    uwT = uwT < 0.0 ? 0.0 : (uwT > 1.0 ? 1.0 : uwT);
    const underwaterFactor = uwT * uwT * (3.0 - 2.0 * uwT);
    const isUnderwater = underwaterFactor >= 0.5;
    if(isUnderwater !== self._wasUnderwater){
      self._wasUnderwater = isUnderwater;
      self._applyUnderwaterSceneState(isUnderwater);
    }

    //Underwater caustic projector — caustics on the directly-viewed seabed.
    self._updateCausticProjection(time, waterSurfaceY, underwaterFactor);

    //Underwater fog. Fill A-Starry-Sky's reserved fog-shader slot once it is
    //available, then swap scene.fog between A-Starry-Sky's atmospheric fog
    //(above water) and our ocean fog (underwater). Both are THREE.Fog, so the
    //swap never recompiles; A-Starry-Sky's FogRenderer keeps updating its own
    //(now-detached) Fog harmlessly while we own scene.fog underwater. Negative
    //fogNear selects the injected ocean branch.
    self._injectUnderwaterFogChunk();
    //Warm the underwater (clipping) shader variants once, a short delay after
    //the fog chunk is injected — the delay lets the injection's own needsUpdate
    //recompiles flush first so the warmed clipping program builds against the
    //FINAL chunk source (warming earlier would just get invalidated and rebuilt
    //on the dip, defeating the point). If the player somehow dives within this
    //window the old lazy compile still covers correctness; this only moves the
    //hitch off the dip in the common case.
    if(!self._underwaterShadersWarmed && self._fogChunkInjected){
      self._warmCountdown = (self._warmCountdown === undefined) ? 20 : (self._warmCountdown - 1);
      if(self._warmCountdown <= 0){ self._warmUnderwaterShaders(); }
    }
    if(self.scene){
      if(isUnderwater && self._fogChunkInjected){
        //Murk colour derived from the SAME stack the water shader uses for its
        //own ceiling fog (water-shader.glsl :1344) so the seabed and the
        //ceiling read as the same medium:
        //  waterAlbedo = scattering / (absorption + scattering)
        //  direct      = sunColor * intensity * (1 - fresnelAirToWater) * cosZenith
        //  ambient     = skyAmbientColor (a-starry-sky y-hemispherical)
        //  inscatter   = waterAlbedo * (direct + ambient) / π
        //  depthDarken = exp(-extinction * cameraDepth)   (UNDERWATER_DEPTH_MURK=1)
        //  murk        = inscatter * depthDarken * userBrightness
        const presetJ = ARestlessOcean.JERLOV_PRESETS[self.data.water_type | 0];
        const absV = presetJ ? presetJ.absorption : self.data.water_absorption;
        const sctV = presetJ ? presetJ.scattering : self.data.water_scattering;
        const extX = Math.max(absV.x + sctV.x, 1e-4);
        const extY = Math.max(absV.y + sctV.y, 1e-4);
        const extZ = Math.max(absV.z + sctV.z, 1e-4);
        const albX = sctV.x / extX, albY = sctV.y / extY, albZ = sctV.z / extZ;
        let dirX = 0.0, dirY = 0.0, dirZ = 0.0;
        if(self.brightestDirectionalLight){
          const ml = self.brightestDirectionalLight;
          const i = ml.intensity;
          self._uwSunDirScratch.set(ml.position.x, ml.position.y, ml.position.z)
            .sub(ml.target.position).negate().normalize();
          //cosZenith = max(dot(-sunDir, up), 0); sunDir points sun->target, so -sunDir.y is the lift.
          const cosZ = Math.max(-self._uwSunDirScratch.y, 0.0);
          //Schlick air→water reflectance, r0 = ((1-1.333)/(1+1.333))^2 ≈ 0.02037
          const oneMinusCos = 1.0 - cosZ;
          const fres = 0.02037 + (1.0 - 0.02037) * (oneMinusCos*oneMinusCos*oneMinusCos*oneMinusCos*oneMinusCos);
          const trans = 1.0 - fres;
          const k = i * trans * cosZ;
          dirX = ml.color.r * k; dirY = ml.color.g * k; dirZ = ml.color.b * k;
        }
        //skyAmbient = hemisphere-mean sky downwelling (see _readSkyAmbient).
        //MUST match the GPU side: the skyAmbientColor uniform set below feeds
        //water-shader.glsl's underwaterInscatterSurface, and both now read the
        //same averaged source so the seabed murk and the ceiling/body fog agree.
        let ambX = 0.0, ambY = 0.0, ambZ = 0.0;
        if(self._readSkyAmbient()){
          ambX = self._skyAmbientScratch.x;
          ambY = self._skyAmbientScratch.y;
          ambZ = self._skyAmbientScratch.z;
        }
        const inv4Pi = 0.07957747154;
        const camDepth = Math.max(0.0, -cameraSubmersion);
        const dDarkenX = Math.exp(-extX * camDepth);
        const dDarkenY = Math.exp(-extY * camDepth);
        const dDarkenZ = Math.exp(-extZ * camDepth);
        //_uwMurkScratch is the COMBINED isotropic inscatter baseline at depth 0:
        //`waterAlbedo · (E_sun + E_sky) / (4π)` — the "if both sun and sky had
        //isotropic phase" version of the medium's single-scatter equilibrium.
        //The chunk then re-weights this on the GPU per fragment by an angular
        //factor that pushes E_sun's contribution through Henyey-Greenstein
        //(forward-scatter halo around the sun) and keeps E_sky isotropic. The
        //fraction-of-inscatter-from-sun (`sunFrac`) is smuggled via |fogFar|
        //so the chunk can do the split without a separate sky uniform. See
        //water-shader.glsl's `underwaterInscatterSurface` for the analogue
        //the body-colour blend uses.
        const sumX = dirX + ambX, sumY = dirY + ambY, sumZ = dirZ + ambZ;
        self._uwMurkScratch.set(
          albX * sumX * inv4Pi,
          albY * sumY * inv4Pi,
          albZ * sumZ * inv4Pi
        );
        //SRGBToLinear pre-comp (see _toFogUniform) so THREE's LinearToSRGB on
        //fogColor upload cancels and the chunk reads the true linear murk.
        self._oceanFog.color.setRGB(self._toFogUniform(self._uwMurkScratch.x),
                                    self._toFogUniform(self._uwMurkScratch.y),
                                    self._toFogUniform(self._uwMurkScratch.z));
        //Sun fraction (scalar). Computed on luminance-weighted total so it
        //collapses sensibly when E_sky dominates at night and E_sun at noon.
        //Clamped to (0, 1) and to a [0.01, 0.99] band so |fogFar| is always
        //a positive non-zero number — the chunk uses sign(fogFar) as the
        //linear/sRGB flag and abs(fogFar) as the fraction.
        const sumLuminance = sumX + sumY + sumZ;
        const sunLuminance = dirX + dirY + dirZ;
        let sunFrac = sumLuminance > 1e-6 ? (sunLuminance / sumLuminance) : 0.0;
        if(sunFrac < 0.01) sunFrac = 0.01;
        if(sunFrac > 0.99) sunFrac = 0.99;
        self._uwSunFrac = sunFrac;  //also stashed for _renderUnderwaterReflection
        //Camera-depth-darkened murk for the curtain (sky-leak fallback — the
        //curtain runs fog:true so the chunk produces its actual per-fragment
        //colour; this is only the cleared-pixel fallback). Lifted by the same
        //isotropic multiple-scatter floor the fog adds: baseline·(1+a/(1-a))
        //= baseline/(1-a) per channel. Kept OFF _uwMurkScratch itself since that
        //feeds the chunk's fogColor, which re-derives the MS term on the GPU.
        if(!self._uwMurkCamDepthScratch){
          self._uwMurkCamDepthScratch = new THREE.Vector3();
        }
        const msFullX = 1.0 / Math.max(1.0 - albX, 0.05);
        const msFullY = 1.0 / Math.max(1.0 - albY, 0.05);
        const msFullZ = 1.0 / Math.max(1.0 - albZ, 0.05);
        self._uwMurkCamDepthScratch.set(
          self._uwMurkScratch.x * msFullX * dDarkenX,
          self._uwMurkScratch.y * msFullY * dDarkenY,
          self._uwMurkScratch.z * msFullZ * dDarkenZ
        );
        //Surface-level inscatter equilibrium (R∞ "ocean colour", NO camera-depth
        //darkening) — the colour an infinite-depth ray fogs to when its path
        //starts at the SURFACE. That's exactly the reflected ray's post-bounce
        //leg, and it's what the reflected geometry reaches in the mirror RT
        //(mirror cam above water → uwCamDepth 0). The underwater-reflection RT
        //clears to THIS so its empty/infinite-depth directions match the
        //reflected seabed teal instead of going dim — otherwise the ceiling's
        //TIR lookup samples a dark void and the water surface reads black from
        //below even though looking straight down reaches teal. fogColor·(2 +
        //4·R∞/albedo): the 2 is the sky-hemisphere term, 4·R∞/albedo the diffuse
        //ocean-colour term (matches the chunk's uwMsRatio + water-shader R∞).
        if(!self._uwReflSurfaceMurk){ self._uwReflSurfaceMurk = new THREE.Vector3(); }
        const rInfA = function(a){ const s = Math.sqrt(Math.max(1.0 - a, 0.0)); return (1.0 - s) / (1.0 + s); };
        self._uwReflSurfaceMurk.set(
          self._uwMurkScratch.x * (2.0 + 4.0 * rInfA(albX) / Math.max(albX, 1e-4)),
          self._uwMurkScratch.y * (2.0 + 4.0 * rInfA(albY) / Math.max(albY, 1e-4)),
          self._uwMurkScratch.z * (2.0 + 4.0 * rInfA(albZ) / Math.max(albZ, 1e-4))
        );
        //Camera-depth-darkened murk for the MIRROR reflection pass. The reflected
        //(TIR) ray is seen by the real eye at camera depth, so — exactly like the
        //direct seabed — its inscatter equilibrium is the camera-depth murk, NOT
        //the brighter surface murk. The mirror camera sits ABOVE water, so the
        //chunk's own uwCamDepth term clamps to 0 and can't apply this; we pre-
        //darken the chunk's fogColor (it re-derives the angular + MS terms from
        //it) and the RT clear by the real camera-depth transmittance instead.
        //With BOTH fog stages now at the camera-depth equilibrium, the two-stage
        //composite collapses to one fog over the full bounce path → the reflection
        //reaches the SAME teal as the direct seabed, and faster (longer path).
        //  _uwBaselineCamDepth  → swapped into fogColor for the mirror pass.
        //  _uwReflCamDepthMurk  → the mirror RT clear (empty/infinite directions).
        if(!self._uwBaselineCamDepth){ self._uwBaselineCamDepth = new THREE.Vector3(); }
        self._uwBaselineCamDepth.set(
          self._uwMurkScratch.x * dDarkenX,
          self._uwMurkScratch.y * dDarkenY,
          self._uwMurkScratch.z * dDarkenZ
        );
        if(!self._uwReflCamDepthMurk){ self._uwReflCamDepthMurk = new THREE.Vector3(); }
        self._uwReflCamDepthMurk.set(
          self._uwReflSurfaceMurk.x * dDarkenX,
          self._uwReflSurfaceMurk.y * dDarkenY,
          self._uwReflSurfaceMurk.z * dDarkenZ
        );
        self._oceanFog.near = -Math.max(waterSurfaceY, 0.001);   //< 0 selects ocean branch; |near| = waterline
        self._oceanFog.far = sunFrac;                            //> 0: sRGB-encoded output + |fogFar| = sunFrac
        self.scene.fog = self._oceanFog;
      } else if(self.scene.fog === self._oceanFog){
        //Surfaced (or chunk not injected): hand scene.fog back to A-Starry-Sky.
        self.scene.fog = (self._capturedSkyFog !== undefined) ? self._capturedSkyFog : null;
      } else {
        //Above water: track whatever fog A-Starry-Sky currently wants mounted.
        self._capturedSkyFog = self.scene.fog;
      }
    }

    //Sky-dome swap. a-starry-sky's Preetham atmosphere dome is drawn with
    //depthWrite off; above water the horizon skirt overdraws its lower
    //hemisphere, but submerged the skirt sits ABOVE the camera and can no
    //longer cover it — the dome's bright horizon band leaks into the view as
    //a white strip. Hide the dome and clear to the murk while underwater so
    //the horizon reads as water. The Snell window still sources its sky from
    //the atmosphere LUTs (computeSkyRadiance), not this mesh, so nothing seen
    //through the surface is lost. Done per frame so it survives any restate.
    if(self.scene){
      const atmR = self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.atmosphereRenderer;
      const domeMesh = atmR && atmR.skyMesh;
      if(domeMesh){
        if(self._aboveWaterBackground === undefined){
          self._aboveWaterBackground = self.scene.background;
        }
        domeMesh.visible = !isUnderwater;
        if(isUnderwater){
          //Camera-depth-darkened murk so the bg matches what the eye would
          //see at infinity in this water column. Mostly hidden behind the
          //curtain sphere, but still the right colour in the edge-case
          //where the curtain fails to cover a pixel (sky-leak fallback).
          const cdm = self._uwMurkCamDepthScratch;
          self.underwaterFogColor.setRGB(cdm.x, cdm.y, cdm.z);
          self.scene.background = self.underwaterFogColor;
        } else {
          self.scene.background = self._aboveWaterBackground;
        }
      }
      //Sun/moon disk planes (a-starry-sky's sunRenderer/moonRenderer) are
      //SEPARATE meshes from the atmosphere dome and render with depthWrite off,
      //so submerged they punch through the curtain as hard-edged disks — the
      //sharp circular cutoff matches their angular-diameter plane size. Hide
      //them for the main underwater render; the transmission pass re-shows them
      //so the Snell window still gets a refracted sun/moon through the surface.
      const rends = self.skyDirector && self.skyDirector.renderers;
      const sunMesh = rends && rends.sunRenderer && rends.sunRenderer.sunMesh;
      const moonMesh = rends && rends.moonRenderer && rends.moonRenderer.moonMesh;
      if(sunMesh){ sunMesh.visible = !isUnderwater; }
      if(moonMesh){ moonMesh.visible = !isUnderwater; }
    }

    //Curtain hemisphere — follow the camera, pick up the camera-depth-
    //darkened murk as a base. The chunk further darkens per-fragment by
    //the curtain fragment's actual depth (the bottom of the 300m
    //hemisphere is way deeper than the camera, so it reads near-black —
    //the "abyss" you see by looking down past the seabed).
    if(self.underwaterCurtainMesh){
      self.underwaterCurtainMesh.visible = isUnderwater;
      if(isUnderwater){
        self.underwaterCurtainMesh.position.copy(self.globalCameraPosition);
        const cdm = self._uwMurkCamDepthScratch;
        self.underwaterCurtainMesh.material.color.setRGB(cdm.x, cdm.y, cdm.z);
      }
    }

    //Update all of our uniforms
    let brightestDirectionalLight;
    if(self.brightestDirectionalLight){
      brightestDirectionalLight = self.brightestDirectionalLight;
    }

    //Wind-driven foam bias, computed once per frame from the CURRENT wind (so a
    //runtime storm ramp whitens the sea as it builds). windVelocity references the
    //A-Frame data, so it tracks live wind changes that also drive regenerateH0.
    {
      const ws = Math.sqrt(self.windVelocity.x * self.windVelocity.x + self.windVelocity.y * self.windVelocity.y);
      const span = self.foamWindFull - self.foamWindStart;
      let f = span > 1e-3 ? (ws - self.foamWindStart) / span : (ws >= self.foamWindStart ? 1.0 : 0.0);
      f = f < 0.0 ? 0.0 : (f > 1.0 ? 1.0 : f);
      self._foamWindBias = f * self.foamWindBiasMax;
    }

    for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
      const uniformsRef = oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms;
      for(let c = 0; c < 6; c++){
        uniformsRef.cascadeDisplacementTextures.value[c] = self.oceanHeightComposer.cascadeDisplacementTextures[c];
      }
      uniformsRef.cascadePatchSizes.value = self.oceanHeightComposer._cascadePatchSizes;
      //Per-cascade slope variance σ² — sourced from the height-band library.
      //Re-pushed every frame because regenerateH0() (called when wind changes
      //at runtime) rewrites the array; pointing at the live ref keeps the
      //shader in sync without an extra change-detection path.
      uniformsRef.cascadeRMSSlope.value = self.oceanHeightBandLibrary.cascadeRMSSlope;
      uniformsRef.waveHeightMultiplier.value = self.oceanHeightComposer.waveHeightMultiplier;
      uniformsRef.foamWindBias.value = self._foamWindBias;
      //G-buffer attachments — albedo (0), normal (1), linear-depth (2);
      //depthTexture is the MRT's own depth attachment, kept for unprojection.
      uniformsRef.refractionColorTexture.value = self.refractionGBufferTarget.textures[0];
      uniformsRef.gBufferNormal.value = self.refractionGBufferTarget.textures[1];
      uniformsRef.refractionDepthTexture.value = self.refractionGBufferTarget.depthTexture;
      uniformsRef.refractionLinearDepth.value = self.refractionGBufferTarget.textures[2];
      //Atlas snap origins — must match the snapped positions the foam/exclusion
      //cameras rendered at, so the water shader samples the right world point.
      uniformsRef.foamCameraXZ.value.copy(self._foamCameraXZ);
      uniformsRef.exclusionCameraXZ.value.copy(self._exclusionCameraXZ);
      uniformsRef.screenResolution.value.set(self.refractionGBufferTarget.width, self.refractionGBufferTarget.height);
      uniformsRef.cameraNearFar.value.set(sceneCamera.near, sceneCamera.far);
      uniformsRef.inverseProjectionMatrix.value.copy(sceneCamera.projectionMatrixInverse);
      uniformsRef.inverseViewMatrix.value.copy(sceneCamera.matrixWorld);
      uniformsRef.ssrViewMatrix.value.copy(sceneCamera.matrixWorldInverse);
      uniformsRef.ssrProjectionMatrix.value.copy(sceneCamera.projectionMatrix);
      //Metering survey: a-starry-sky 64x64 fisheye sky texture. World-space XZ maps
      //directly to UV, giving smooth, noise-free sky color for SSR fallback.
      if(self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.meteringSurveyRenderer){
        const msr = self.skyDirector.renderers.meteringSurveyRenderer;
        const meterTex = msr.meteringSurveyRenderer.getCurrentRenderTarget(msr.meteringSurveyVar).texture;
        //Enable linear filtering for smooth sky gradients (default is NearestFilter
        //which causes visible banding). Requires OES_texture_float_linear (WebGL2 / most devices).
        if(meterTex.magFilter !== THREE.LinearFilter){
          meterTex.minFilter = THREE.LinearFilter;
          meterTex.magFilter = THREE.LinearFilter;
          meterTex.needsUpdate = true;
        }
        uniformsRef.meteringSurveyTexture.value = meterTex;
      }
      uniformsRef.causticMap.value = self.causticMap;
      uniformsRef.causticIntensityMultiplier.value = self.causticsStrength;
      uniformsRef.reflectionScale.value = self.reflectionScale;
      uniformsRef.reflectionDistanceFalloff.value = self.reflectionDistanceFalloff;
      uniformsRef.ssrMaxSteps.value = self.ssrMaxSteps;
      uniformsRef.fresnelDistanceRoughness.value = self.fresnelDistanceRoughness;
      uniformsRef.surfaceRoughness.value = self.surfaceRoughness;
      uniformsRef.specFresnelGate.value = self.specFresnelGate;
      uniformsRef.specBoost.value = self.specBoost;
      uniformsRef.specFalloffFar.value = self.specFalloffFar;
      uniformsRef.specFalloffFarDist.value = self.specFalloffFarDist;
      uniformsRef.foamStartLevel.value = self.foamStart;
      uniformsRef.foamDiffuseMap.value = self.foamColorMap;
      uniformsRef.foamOpacityMap.value = self.foamOpacityMap;
      uniformsRef.foamNormalMap.value = self.foamNormalMap;
      uniformsRef.foamRenderMap.value = self.foamRenderMap;
      uniformsRef.exclusionMap.value = self.exclusionMap;
      uniformsRef.baseHeightOffset.value = self.heightOffset;

      // Update all directional lights for ambient scattering
      if(self.directionalLights.length > 0){
        // Keep main light for backward compat
        const mainLight = self.directionalLights[0];
        const intensity = mainLight.intensity;
        const color = mainLight.color;
        uniformsRef.brightestDirectionalLight.value.set(color.r * intensity, color.g * intensity, color.b * intensity);
        directionalLightDirection.set(mainLight.position.x, mainLight.position.y, mainLight.position.z);
        directionalLightDirection.sub(mainLight.target.position).negate().normalize();
        uniformsRef.brightestDirectionalLightDirection.value.set(directionalLightDirection.x, directionalLightDirection.y, directionalLightDirection.z);
        //Stash the same direction for the chunk's HG sun phase. Convention
        //matches water-shader.glsl's `brightestDirectionalLightDirection`:
        //points FROM the sun TO the scene (the direction sunlight travels).
        //directionalLightDirection above is `(target - position).normalize()`
        //= same convention, so copy directly.
        if(self._sharedUwSunDir){
          self._sharedUwSunDir.copy(directionalLightDirection);
        }

        //Wire sun shadow-map receive. Enabled only when the main light actually
        //casts and its shadow map has been rendered at least once (shadow.map
        //is null until the renderer runs the shadow pass).
        if(mainLight.castShadow && mainLight.shadow && mainLight.shadow.map){
          //Console override (set via setSunShadowEnabled) wins over the
          //auto-detect, so toggling from devtools actually disables the
          //sampler instead of being clobbered next frame.
          uniformsRef.sunShadowEnabled.value = self._sunShadowOverride === false ? 0 : 1;
          uniformsRef.sunShadowMap.value = mainLight.shadow.map.texture;
          uniformsRef.sunShadowMatrix.value.copy(mainLight.shadow.matrix);
          uniformsRef.sunShadowMapSize.value.set(mainLight.shadow.mapSize.x, mainLight.shadow.mapSize.y);
          uniformsRef.sunShadowRadius.value = mainLight.shadow.radius;
          //Was `mainLight.shadow.bias - 0.003` — that extra -0.003 push pulled
          //water-surface refZ enough toward the light that real occluders
          //(lighthouse) could fail the depth comparison, so the lighthouse
          //shadow on the stone wall rendered correctly (Three.js's standard
          //path, no extra bias) but the SAME shadow on adjacent water did
          //not (our shader, with the -0.003 push). Now using a-starry-sky's
          //bias plus a live-tunable offset (setSunShadowBias from console).
          //Positive offset = more shadowed (refZ pushed away from light,
          //comparison fails more often). Negative = less shadowed. Range
          //typical: -0.005 to +0.005.
          uniformsRef.sunShadowBias.value = mainLight.shadow.bias + self._sunShadowBiasOffset;
        } else {
          uniformsRef.sunShadowEnabled.value = 0;
        }

      }
      else{
        uniformsRef.brightestDirectionalLight.value.set(1.0,1.0,1.0);
      }
      uniformsRef.t.value = time * 0.001;

      //Underwater state — guarded so the horizon-skirt material (separate
      //template, no underwater uniforms) is skipped without throwing.
      if(uniformsRef.underwaterFactor){
        uniformsRef.underwaterFactor.value = underwaterFactor;
        uniformsRef.cameraSubmersion.value = cameraSubmersion;
        uniformsRef.waterSurfaceY.value = waterSurfaceY;
        uniformsRef.underwaterReflectionTexture.value = self._reflectionTarget.texture;
        uniformsRef.underwaterReflectionMatrix.value.copy(self._reflectionTextureMatrix);
        uniformsRef.aboveWaterTransmissionTexture.value = self._aboveWaterTransmissionTarget.texture;
      }

      //Sky ambient color = hemisphere-mean sky downwelling (see _readSkyAmbient).
      //View-independent and colour-correct at all times of day. Reading only the
      //y-axis hemisphere (the zenith) gave a near-black ambient because that SH
      //axis clamps to ~0; averaging the three axes fixes it. Falls back to a
      //scene HemisphereLight when running standalone (no a-starry-sky).
      if(self._readSkyAmbient()){
        uniformsRef.skyAmbientColor.value.copy(self._skyAmbientScratch);
      }

      //Sync atmospheric perspective uniforms from a-starry-sky
      if(self.atmosphericPerspectiveEnabled && self.skyDirector){
        const luts = self.skyDirector.getAtmosphericLUTs();
        if(luts){
          //If we haven't recompiled with atmospheric perspective yet, do it now
          if(!self.atmosphereFunctionsGLSL){
            self.atmosphereFunctionsGLSL = luts.atmosphereFunctionsString || null;
            if(!self.atmosphereFunctionsGLSL){ return; } //functions not ready yet — retry next tick
            //Recompile all cloned materials on each ocean patch instance
            const newFragShader = ARestlessOcean.Materials.Ocean.waterMaterial.fragmentShader(
              self.causticsEnabled, self.foamEnabled, true, self.atmosphereFunctionsGLSL
            );
            //Build both vertex variants once via the shared helper so the
            //skirt z-clamp stays in lockstep with the regular ocean across
            //this AP-recompile path.
            const newVtxSrc = buildVertexShader(true, false);
            const skirtVtxSrc = buildVertexShader(true, true);
            for(let j = 0; j < oceanGridInstanceKeys.length; ++j){
              const mesh = oceanPatchGeometryInstances[oceanGridInstanceKeys[j]];
              const isSkirt = (mesh === self.horizonSkirtMesh);
              mesh.material.vertexShader = isSkirt ? skirtVtxSrc : newVtxSrc;
              mesh.material.fragmentShader = newFragShader;
              mesh.material.fog = true;
              mesh.material.needsUpdate = true;
            }
            //Also update the source material for any future clones
            self.oceanMaterial.vertexShader = newVtxSrc;
            self.oceanMaterial.fragmentShader = newFragShader;
            self.oceanMaterial.fog = true;
            self.oceanMaterial.needsUpdate = true;
            //Stop the sky dome from writing depth so the skirt (renderOrder 1)
            //can pass its depth test against dome pixels and overdraw the
            //dome's lower hemisphere. The dome itself does not need its own
            //depth in the buffer (single mesh, sky-radiance-only shader);
            //sun/moon meshes depth-test against the unwritten far depth.
            const atmRenderer = self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.atmosphereRenderer;
            if(atmRenderer && atmRenderer.skyMesh && atmRenderer.skyMesh.material){
              atmRenderer.skyMesh.material.depthWrite = false;
            }
          }
          const skyState = luts.skyState;
          uniformsRef.atmosphereTransmittance.value = luts.transmittance;
          uniformsRef.atmosphereMieInscattering.value = luts.mieInscatteringSum;
          uniformsRef.atmosphereRayleighInscattering.value = luts.rayleighInscatteringSum;
          uniformsRef.atmSunPosition.value.copy(skyState.sun.position);
          uniformsRef.atmMoonPosition.value.copy(skyState.moon.position);
          uniformsRef.atmSunHorizonFade.value = skyState.sun.horizonFade;
          uniformsRef.atmMoonHorizonFade.value = skyState.moon.horizonFade;
          uniformsRef.atmScatteringSunIntensity.value = skyState.sun.intensity * luts.atmosphericParameters.solarIntensity / 1367.0;
          uniformsRef.atmScatteringMoonIntensity.value = skyState.moon.intensity * luts.atmosphericParameters.lunarMaxIntensity / 29.0;
          uniformsRef.atmMoonLightColor.value.copy(skyState.moon.lightingModifier);
          uniformsRef.atmCameraHeight.value = luts.atmosphericParameters.cameraHeight;
          uniformsRef.atmDistanceScale.value = self.atmosphericPerspectiveDistanceScale;
          if(luts.blueNoiseTexture){
            uniformsRef.blueNoiseTexture.value = luts.blueNoiseTexture;
          }
        }
      }

      //Blue noise dithering — always update time, texture comes from sky if available
      uniformsRef.blueNoiseTime.value = performance.now();
    }

    //Horizon skirt follows the camera in XZ and sits at the FFT ocean's rest
    //plane (heightOffset) so it is coplanar with the clipmap. Pinning it at
    //y=0 left a flat water sheet heightOffset metres below the real surface —
    //invisible from a normal above-water eye height but starkly visible as an
    //"odd second water mesh" once the camera drops underwater. All uniform
    //updates happen via the per-instance loop above — the skirt is registered
    //in oceanGridInstanceKeys so it gets the same FFT cascade textures, light
    //state, atm LUTs, etc. that real ocean tiles get.
    if(self.horizonSkirtMesh){
      self.horizonSkirtMesh.position.set(sceneCamera.position.x, self.heightOffset, sceneCamera.position.z);
    }

    //Ocean-only CSM pass. Runs after every ocean material has had its cascade
    //textures/uniforms refreshed for this frame, so the shadow material picks
    //up the current FFT state by reference. Then we push the resulting depth
    //texture + shadow matrix back to each water material.
    if(self.oceanShadowCSM && self.directionalLights.length > 0 && oceanGridInstanceKeys.length > 0){
      const mainLight = self.directionalLights[0];
      directionalLightDirection.set(mainLight.position.x, mainLight.position.y, mainLight.position.z);
      directionalLightDirection.sub(mainLight.target.position).negate().normalize();
      const firstMeshUniforms = oceanPatchGeometryInstances[oceanGridInstanceKeys[0]].material.uniforms;
      self.oceanShadowCSM.render(self.renderer, sceneCamera, directionalLightDirection, firstMeshUniforms);

      //Sun below horizon → CSM.render() early-exits; disable the sampler so
      //the water shader doesn't read stale maps.
      const sunBelowHorizon = -directionalLightDirection.y <= 0.0;
      const cascades = self.oceanShadowCSM.cascades;
      const numCascades = self.oceanShadowCSM.numCascades;
      for(let i = 0, numKeys = oceanGridInstanceKeys.length; i < numKeys; ++i){
        const u = oceanPatchGeometryInstances[oceanGridInstanceKeys[i]].material.uniforms;
        if(sunBelowHorizon || self._oceanShadowOverride === false){
          u.oceanShadowEnabled.value = 0;
          if(sunBelowHorizon) continue;
        } else {
          u.oceanShadowEnabled.value = 1;
        }
        //Push every cascade's moment texture (RGBA32F, post-blur), shadow
        //matrix, and map size. Matrices live as separate uniform names
        //(oceanShadowMatrix0..3) and must be projected per-vertex;
        //texture/mapSize are arrays sampled in the fragment cascade walk.
        for(let c = 0; c < numCascades; c++){
          u.oceanShadowMap.value[c] = cascades[c].renderTarget.texture;
          u.oceanShadowMapSize.value[c].set(cascades[c].cfg.mapSize, cascades[c].cfg.mapSize);
        }
        u.oceanShadowMatrix0.value.copy(cascades[0].shadowMatrix);
        u.oceanShadowMatrix1.value.copy(cascades[1].shadowMatrix);
        u.oceanShadowMatrix2.value.copy(cascades[2].shadowMatrix);
        u.oceanShadowMatrix3.value.copy(cascades[3].shadowMatrix);
      }
    }

    //Refresh shadow-frustum visualisers if active. Both the scene sun shadow
    //camera and each CSM lightCamera move every frame; helpers need .update()
    //to redraw their wireframes against the current matrices.
    if(self._shadowHelpers){
      for(let i = 0; i < self._shadowHelpers.length; i++){
        self._shadowHelpers[i].update();
      }
    }

    //Broadcast the current sun direction to every fog-receiving material so
    //the underwater chunk's HG sun phase reads the right vector. Cheap scene
    //traversal; the per-material write is a Vector3.copy().
    self._broadcastUwSunDir();

    //── Splash particles ──────────────────────────────────────────────────────
    //Run emission + sim last (the offscreen passes are done), then re-show the
    //mesh so it lands in this frame's main render only.
    if(self.oceanSplash){
      const sp = self.oceanSplash;
      self._splashSunColor = self._splashSunColor || new THREE.Color();
      self._splashAmbient = self._splashAmbient || new THREE.Color();
      self._splashSunDir = self._splashSunDir || new THREE.Vector3(0.0, 1.0, 0.0);
      if(self.brightestDirectionalLight){
        const ml = self.brightestDirectionalLight;
        self._splashSunColor.copy(ml.color).multiplyScalar(ml.intensity);
        //Direction TO the sun (world): the light points position -> target, so the
        //sun lies along (position - target). Feeds the splash forward-scatter phase.
        self._splashSunDir.set(ml.position.x, ml.position.y, ml.position.z)
          .sub(ml.target.position).normalize();
      } else {
        self._splashSunColor.setRGB(1.0, 1.0, 1.0);
      }
      //TRUE solar elevation (sin), independent of which light is brightest. brightestDirectionalLight
      //becomes the MOON at night, so its .y cannot tell day from night; the sky state's sun position
      //can. The splash gates its daytime sky-fill on this so a high moon never reads as daytime.
      let _sunElev = 1.0;
      if(self.skyDirector && self.skyDirector.getAtmosphericLUTs){
        const _luts = self.skyDirector.getAtmosphericLUTs();
        if(_luts && _luts.skyState && _luts.skyState.sun){
          const _sp = _luts.skyState.sun.position;
          const _spl = Math.sqrt(_sp.x * _sp.x + _sp.y * _sp.y + _sp.z * _sp.z);
          _sunElev = _spl > 1e-4 ? _sp.y / _spl : _sp.y;
        }
      }
      if(self._readSkyAmbient()){
        self._splashAmbient.setRGB(self._skyAmbientScratch.x, self._skyAmbientScratch.y, self._skyAmbientScratch.z);
      } else {
        self._splashAmbient.setRGB(0.3, 0.4, 0.5);
      }
      //Camera forward, flattened to the XZ plane and normalised. The shore scan
      //biases its detector density toward what the camera is actually looking at
      //(dense in front, thinned behind) so the budget is spent on visible spray.
      self._splashFwd = self._splashFwd || new THREE.Vector3();
      self.camera.getWorldDirection(self._splashFwd);
      let _fwdX = self._splashFwd.x, _fwdZ = self._splashFwd.z;
      const _fwdL = Math.sqrt(_fwdX * _fwdX + _fwdZ * _fwdZ);
      if(_fwdL > 1e-4){ _fwdX /= _fwdL; _fwdZ /= _fwdL; } else { _fwdX = 0.0; _fwdZ = 1.0; }
      //Scene sun shadow: hand the splash the SAME directional-light shadow map + params
      //the water surface receives (see the sunShadow* wiring above), so spray darkens
      //under the rocks / lighthouse consistently. Auto-detect + console override match.
      let _shEnabled = 0, _shMap = null, _shMatrix = null, _shW = 2048.0, _shH = 2048.0,
          _shRadius = 1.0, _shBias = 0.0;
      const _sLight = self.brightestDirectionalLight;
      if(_sLight && _sLight.castShadow && _sLight.shadow && _sLight.shadow.map){
        _shEnabled = (self._sunShadowOverride === false) ? 0 : 1;
        _shMap = _sLight.shadow.map.texture;
        _shMatrix = _sLight.shadow.matrix;
        _shW = _sLight.shadow.mapSize.x; _shH = _sLight.shadow.mapSize.y;
        _shRadius = _sLight.shadow.radius;
        _shBias = _sLight.shadow.bias + (self._sunShadowBiasOffset || 0.0);
      }
      //Sky reflection source for the bead rims: the same a-starry-sky metering fisheye the
      //water SSR fallback samples (worldXZ -> UV). Null when no sky system is present, in
      //which case the splash shader falls back to the flat sky-ambient colour.
      let _meterTex = null;
      if(self.skyDirector && self.skyDirector.renderers && self.skyDirector.renderers.meteringSurveyRenderer){
        const _msr = self.skyDirector.renderers.meteringSurveyRenderer;
        _meterTex = _msr.meteringSurveyRenderer.getCurrentRenderTarget(_msr.meteringSurveyVar).texture;
      }
      sp.tick({
        time: time,
        camX: self.globalCameraPosition.x,
        camZ: self.globalCameraPosition.z,
        camFwdX: _fwdX,
        camFwdZ: _fwdZ,
        //Real wind velocity (m/s, world X/Z), NOT foamScrollVelocityVec — that
        //one is a deliberately-slowed foam-texture drift (windSpeed*0.04) and
        //would barely budge the spray. windVelocity.x->world X, .y->world Z.
        windX: self.windVelocity.x,
        windZ: self.windVelocity.y,
        sunColor: self._splashSunColor,
        skyAmbient: self._splashAmbient,
        sunDir: self._splashSunDir,
        sunElevation: _sunElev,
        sunShadowEnabled: _shEnabled,
        sunShadowMap: _shMap,
        sunShadowMatrix: _shMatrix,
        sunShadowMapW: _shW,
        sunShadowMapH: _shH,
        sunShadowRadius: _shRadius,
        sunShadowBias: _shBias,
        skyReflectTex: _meterTex,
        viewportHeight: self.refractionGBufferTarget.height,
        resW: self.refractionGBufferTarget.width,
        resH: self.refractionGBufferTarget.height,
        linearDepthTexture: self.refractionGBufferTarget.textures[2]
      });
      //Airborne spray is an above-water phenomenon: hide it whenever the camera is submerged, or the
      //mist/foam billboards punch through the underwater ceiling (they render on OCEAN_LAYER in the
      //main pass and do not depth-interact with the from-below surface). _wasUnderwater is the same
      //committed submersion state that drives the underwater fog/ceiling swap.
      sp.mesh.visible = sp.enabled && !self._wasUnderwater;
    }
  };
}

//Ocean splash particles — airborne spray for breaking wave crests and for the
//unified "moving water hits a solid" impact (shore/terrain AND boat hulls).
//
//Design (see plan dreamy-noodling-petal):
//  - One packed, fixed-capacity CPU particle pool (structure-of-arrays). Indices
//    [0, liveCount) are alive; death is an O(1) swap-remove with the last live
//    slot, which keeps the GPU draw range contiguous.
//  - One THREE.Points mesh drawn ONLY in the main pass. OceanGrid owns this
//    object and toggles mesh.visible so it never enters the refraction / shadow /
//    foam offscreen passes (those run earlier in OceanGrid.tick).
//  - Three emitters, one spawn pool:
//      crest  — sample the analytic Gerstner field around the camera; steep +
//               rising tops throw mist.
//      shore  — sample the same field against a CPU copy of the foam-camera
//               terrain-height ortho; water arriving at the waterline bursts.
//      hull   — driven by the buoyancy-splash event via OceanGrid.
//  - shore and hull both funnel through emitImpact(): your "treat them the same"
//    framing. Crest steepness / impact speed thresholds are physical; the spray
//    counts, sizes and lifetimes are artistic and flagged FUDGE.
//
//CPU sim (not GPU) is deliberate for v1: a few-thousand-particle pool is trivially
//60fps and debuggable, and avoids CPU->GPU emission plumbing. GPUComputeRenderer
//is the documented scale-up path if we ever need far more particles.

ARestlessOcean.OceanSplash = function(oceanGrid, scene, configOverrides){
  this.oceanGrid = oceanGrid;
  this.scene = scene;
  this.renderer = oceanGrid.renderer;

  const cfg = configOverrides || {};
  //12000 (~0.6 MB of SoA backing) gives headroom so the denser crest clusters and
  //the shore sheet can both be live without either starving the pool (spawn() drops
  //silently when full). Bumped 8000->12000 for denser mist + the per-particle beads.
  const capacity = cfg.capacity || 24000;
  this.capacity = capacity;
  this.liveCount = 0;

  //── Live-tunable knobs (plain JS, not A-Frame data — hot-editable from the
  //   console per the live-uniforms workflow). Physical where it matters,
  //   FUDGE where it is art direction. ───────────────────────────────────────
  this.enabled = true;
  this.gravity = 9.81;          //m/s^2, real.
  this.airDrag = 0.7;           //per-second velocity retention exponent (FUDGE).
  this.maxEmitDistance = 160.0; //m: do not emit beyond this from camera.
  this.useRenderedHeight = true;//Spawn against the ACTUAL rendered FFT surface (the
                                //async height-field snapshot), not the analytic twin.
                                //The analytic field shares the spectrum but NOT the
                                //GPU's phases, so its crests sit elsewhere — left on,
                                //bursts fired over visibly-flat/trough water. Falls
                                //back to analytic outside the snapshot's ~512 m window.

  //Crest mist.
  this.crestEnabled = true;
  this.crestRadius = 120.0;            //m scan radius around camera.
  this.crestGridStep = 11.0;           //m grid spacing for candidate tops.
  this.crestSteepnessThreshold = 0.05; //1 - normal.y. NOW a near-flat REJECT, not the
                                       //primary gate. The phase-correct slope reads off
                                       //the 2 m/texel FFT field, which is smooth — it
                                       //cuts the sharp short-wave slopes, so the old
                                       //0.18 (~35deg) almost never passed there and crest
                                       //mist vanished. Crest selection is now carried by
                                       //"elevated AND rising" (the upper front face of a
                                       //crest), which the smoothed field DOES resolve.
  this.crestRiseThreshold = 0.4;       //m/s upward surface velocity (rendered FFT dH/dt).
  this.crestMinHeight = 0.0;           //m ABOVE MEAN sea level a candidate must sit.
                                       //This is now the PRIMARY crest selector (with
                                       //rise): spray tears off elevated, rising water,
                                       //not flat sea or troughs. Raise toward Hs/2 to
                                       //pick only the biggest tops; lower for more mist.
  this.crestSpawnChance = 0.75;        //per-candidate cell per-frame (FUDGE). Was 0.10,
                                       //which thinned 90% of cells so survivors were lone
                                       //specks; combined with the cluster emit below this
                                       //now lets crests read as PUFFS, like the shore sheet.
  this.crestClusterCount = 30;         //particles per qualifying crest cell (FUDGE). The
                                       //crest analogue of the shore sheet: a cluster reads
                                       //as a puff of mist congregating on the top, where a
                                       //single particle just zipped past unnoticed.
  this.crestClusterRadius = 1.3;       //m horizontal spread of a cluster around the crest.
  this.crestSize = 0.26;               //m base droplet radius (FUDGE). Lifts the BASE size of the
                                       //mist puff AND the cluster drops inside it (rendered size =
                                       //crestSize * sizeScale), so the spray sits at a comfortable
                                       //overall scale.
  this.crestLifetime = 0.6;            //s (FUDGE). Short on purpose: crest mist is a
                                       //near-field puff that dissipates within ~10 m,
                                       //not a streak that flies across the view. At
                                       //high wind, drift (~10 m/s) × lifetime sets the
                                       //travel range, so lifetime is the range cap.
  this.crestVelInherit = 0.8;          //fraction of the surface's own rise the
                                       //spray launches with — physical: torn
                                       //spray is the crest continuing ballistically.
  this.crestUpSpeed = 1.6;             //m/s additive launch floor (FUDGE).
  this.crestWindFactor = 0.5;          //fraction of wind carried by mist (FUDGE).
  this.spindriftStart = 16.0;          //m/s wind at which the air begins STRIPPING low mist off
                                       //the whole surface (spindrift), not just the breaking crests.
  this.spindriftFull = 34.0;           //m/s (~hurricane) at which spindrift is in full force.
  this.spindriftBoost = 2.0;           //extra crest-emission coverage at full spindrift (more cells
                                       //fire, gates drop so flatter/lower water mists, launched low
                                       //+ finer so it streams as a torn surface haze, not arcs).
  //SURFACE HAZE FLOOR — true spindrift at gale force is wind SHEAR stripping the whole surface, not
  //crest-driven, so it does not come in bursts. This UNGATED uniform low mist fills the gaps between
  //the crest emitter's moving patches (which track the wave groups). Ramps in on the same spin
  //window; spawns fine mist over OPEN WATER only, launched low, then the wind-grab carries it.
  this.hazeFloorChance = 0.2;          //per-cell spawn probability at FULL spin (0 = floor disabled).
  this.hazeFloorCount = 2;             //fine-mist particles per firing cell (kept small — many cells).
  this.hazeFloorCoarse = 0.22;         //coarseness of the haze (low = fine translucent mist, no foam).
  this.hazeFloorUp = 1.0;              //m/s upward launch (low: it hugs the surface and streams).

  //Impact (shore + hull).
  this.impactEnabled = true;
  this.shoreEnabled = true;
  this.shoreBand = 0.6;          //m |waterY - terrainY| counted as "at shore".
  this.cliffMinHeight = 2.0;     //m a neighbour must rise above sea level for THIS
                                 //waterline cell to count as the foot of a vertical
                                 //cliff/wall (lighthouse base, sea stack). Taller than
                                 //a wave crest so a beach swell is never read as a wall.
  this.cliffCountScale = 0.03;   //particles-per-cell for CLIFF cells (vs shoreCountScale for
                                 //beaches). A wall packs a wave column into one cell, so the
                                 //beach scale KABOOMs into a wall of foam; cliffs need far fewer
                                 //per cell. 0.15->0.03 with the emitImpact floor removed (~1/10).
                                 //Live dial: window.oceanSplash.cliffCountScale.
  this.shoreRiseThreshold = 0.5; //m/s rising water needed to break.
  this.shoreGridStep = 2.0;      //m scan spacing within the readback ortho. Finer
                                 //than the old 4 m so the waterline resolves as a
                                 //continuous edge, not a handful of scattered cells.
  this.shoreGradEps = 6.0;       //m baseline for the terrain-slope finite difference.
                                 //CRITICAL: the foam-height ortho is ~4 m/texel, so the
                                 //old 1 m eps sampled the SAME texel twice → gradient 0
                                 //→ a flat (0,1,0) normal → the reflection launch had no
                                 //surface to bounce off and every burst fired straight
                                 //UP. The eps is clamped to >=1.5 texels at runtime so
                                 //neighbouring samples land in DIFFERENT texels and the
                                 //cliff slope (hence the reflected, forward spray) is
                                 //actually resolved.
  this.shoreScanRadius = 90.0;   //m around camera to look for shoreline.
  this.shoreNearRadius = 45.0;   //m: inside this every shore cell fires (dense, a
                                 //solid sheet); beyond it cells are probabilistically
                                 //thinned — far spray reads fine sparse and folds
                                 //into foam coverage anyway.
  this.shoreFarKeep = 0.25;      //prob a far (> shoreNearRadius) cell still fires.
  this.shoreFrontBias = -0.2;    //skip cells whose direction-from-camera dotted with
                                 //camera-forward is below this (~ behind the camera).
  this.shoreCountScale = 0.05;   //particles-per-cell multiplier for the shore sheet (was a
                                 //hardcoded 0.25). Many cells x few each = a sheet; this is the
                                 //"few each" dial. 0.65->0.4->0.28->0.05: with the floor-of-1
                                 //removed in emitImpact, low values now really bite (~1/10 the
                                 //old blizzard). Live dial: window.oceanSplash.shoreCountScale.
  this.shoreSheetSpan = 2.5;     //m: spread each cell's burst ALONG the waterline
                                 //tangent so adjacent cells overlap into a sheet
                                 //rather than each firing as an isolated point geyser.
  this.shoreJetScale = 1.6;      //multiplier on the Torricelli surge-jet launch
                                 //(v = shoreJetScale * sqrt(2 g H), H = wave surge
                                 //above mean). 1.0 = physical; raise it for taller,
                                 //more dramatic spray off tall cliffs (the 2 m FFT
                                 //field SMOOTHS crest height, so the physical jet runs
                                 //a touch conservative — a small boost reads truer).
  this.impactBurstPerSpeed = 6.0;//particles per m/s of impact speed (FUDGE).
  this.impactMinBurst = 4;
  this.impactMaxBurst = 60;
  this.impactSize = 0.26;        //m (FUDGE) — base droplet size at impactSizeRefSpeed. Pulled
                                 //0.36->0.26 to MATCH crestSize: impact spray was the source of the
                                 //oversized lighthouse-base blobs (its energy-scaled aSize feeds the
                                 //same cluster billboards crest does, but bigger), so matching the
                                 //crest base puts impact and crest drops on the same size footing.
  this.impactSizeRefSpeed = 8.0; //m/s impact speed that yields the nominal impactSize.
                                 //Droplet scale grows with impact energy so a big
                                 //breaker throws fat sheets and a small lap a fine fizz.
                                 //Without this every burst rendered the SAME droplet
                                 //size regardless of wave, so all spray read alike.
  this.impactSizeMaxScale = 1.4; //cap on the energy size multiplier (a freak surge speed must
                                 //not spawn giant blobs). Pulled 2.5->1.4: at sizeScale 10 the old
                                 //2.5x cap let a strong impact spawn ~1.3 m aSize -> multi-metre
                                 //cluster billboards (the giant blobs). 1.4 keeps energy variation
                                 //without the runaway.
  this.impactLifetime = 1.4;     //s (FUDGE).
  this.impactVelScale = 0.9;     //launch speed as fraction of impact speed (FUDGE).
  this.impactMinLaunch = 7.0;    //m/s FLOOR on burst launch speed (FUDGE). The shore
                                 //`rise` now reads the phase-correct FFT field, whose
                                 //vertical velocity is gentle (~0.5-2 m/s) — far below
                                 //the energy of water actually striking a rock. Without
                                 //a floor the launch was ~1 m/s and spray just sat at the
                                 //waterline. The floor stands in for the impact jet (run-up
                                 //momentum we do not measure), so spray reflects UP off the
                                 //ground. Tune up for taller spray, down for a low fizz.
  this.impactMaxLaunch = 26.0;   //m/s HARD CAP on burst launch speed. Was 7 to tame the
                                 //old ANALYTIC rise (it read 20+ m/s from a phantom
                                 //phase → 25 m geysers). The launch now comes from the
                                 //physical surge jet (sqrt(2 g H)), bounded by real wave
                                 //height, so the cap can sit high enough for a big wave
                                 //to genuinely leap up a cliff (~16 m/s ≈ 13 m of reach)
                                 //without re-admitting the runaway analytic spike.
  this.impactSpread = 0.55;      //cone half-spread around the launch axis.
  this.impactReflect = 1.0;      //0 = launch coned about the surface NORMAL (old
                                 //behaviour); 1 = launch coned about the MIRROR of the
                                 //incoming water velocity reflected off that surface, so
                                 //water thrown at a cliff sprays BACK along its path
                                 //(directional sheet) rather than always straight up the
                                 //rock. Only engages when the caller supplies an incoming
                                 //velocity (shore does; hull falls back to the normal cone).
  this.impactRunUp = 1.2;        //wall run-up: inviscid mirror reflection alone leaves a
                                 //vertical cliff spraying horizontally (no up). Real water
                                 //climbs the face on a head-on slam, so we add upward lift
                                 //proportional to how square-on the impact is (-incoming·n).
                                 //Glancing flat-beach backwash gets little → low seaward
                                 //wash; head-on cliff strikes get a tall sheet. (FUDGE: the
                                 //run-up term is not in the inviscid bounce.)
  this.impactWindRampTime = 1.1; //s for impact spray to feel its FULL wind share.
                                 //Impact droplets are knocked off a solid (shore/hull)
                                 //and should arc up ballistically first; the wind they
                                 //feel ramps 0->1 over this time so a strong wind does
                                 //not instantly blow the launch flat. Crest mist is
                                 //exempt (torn off already moving with the air). Raised
                                 //0.6->1.1 because the reflected forward launch was being
                                 //bent downwind before it could carry — the longer ramp
                                 //lets the ballistic arc read first. (Pairs with
                                 //coarseWindCouple for the eventual drift strength.)
  //── Coarseness-driven aerodynamics. Terminal velocity and wind pickup both scale with
  //   coarseness: fine MIST has high drag (low terminal velocity — sheds its launch fast,
  //   catches the breeze early, then hangs and drifts) and couples to the full wind; a
  //   heavy BEAD has low drag (keeps momentum, flies out to build the crest, falls under
  //   gravity) and only feels a fraction of the wind. ─────────────────────────────────
  this.mistDrag = 1.8;           //drag-scale at coarse=0 (high: quick to terminal/wind).
  this.beadDrag = 0.4;           //drag-scale at coarse=1 (low: momentum, builds the arc).
  this.coarseWindCouple = 0.25;  //wind fraction a fully-coarse bead drifts at (fine = 1.0).
  this.windGrabStart = 14.0;     //m/s wind at which the air starts OVERPOWERING the spray's own
                                 //ballistics — beyond this even heavy beads get dragged downwind.
  this.windGrabFull = 32.0;      //m/s (~hurricane) at which spray is FULLY captured by the wind:
                                 //coupling -> 1 and drag -> mist-fast for every particle, so the
                                 //whole field streams with the gale instead of arcing.

  //Render-side art knobs (pushed to uniforms each frame).
  this.opacity = 0.1;          //MIST-END opacity (aer=0) in the unified opacity ramp
                                 //mix(opacity, foamOpacity, aer). 0.1->0.28: pure mist stays
                                 //wispy, but the FOAM/droplet elements (made from foam chunks)
                                 //needed real depth — they read as ghostly blobs at 0.1.
  this.sizeScale = 10.0;         //mist puffs are clumps of aerosol, not single droplets, so blow
                                 //the world radius up over the spawn size. Bumped 5->10 (~2x) so
                                 //the haze reads bigger and softer.
  this.softRange = 1.5;          //m soft-particle fade depth.
  this.maxPointSize = 512.0;     //raised from 256 so the 5x-larger near puffs are not
                                 //clamped flat (watch fill-rate: big translucent sprites
                                 //+ 3-octave noise is the main cost here).
  this.debugMode = 0;            //0 normal, 1 tint-by-type.
  this.ambientScale = 1.8;       //multiplier on the sky-hemisphere ambient that lights the mist
                                 //(and anchors the drop sky-reflection). a-starry-sky's hemisphere
                                 //ambient is DIM, so backlit mist read as dark grey smoke at 1.0;
                                 //lifted so daylight spray reads as bright water vapour. Lower in
                                 //overcast/night and it tracks down with the sky automatically.
  this.skyBoost = 3.0;           //brightness lift on the DROP sky-reflection. The drops cannot
                                 //reach the water's atmospheric-LUT sky, only the dim metering
                                 //fisheye, so the Fresnel rim is synthesized from the (boosted)
                                 //ambient as a bright sky gradient — this is the rim brightness.

  //── Forward-scatter (Mie) phase knobs. The mist blooms when the view ray passes
  //   near the sun direction — the dependable "sunlit spray" cue. Applied to the sun
  //   term only (ambient stays smooth). ───────────────────────────────────────────
  this.phaseG = 0.85;            //forward-lobe asymmetry; toward 1 = tighter sun halo.
  this.phaseGain = 0.6;          //halo strength multiplier on the sun term (FUDGE).
  this.receiveShadow = true;     //darken puffs that sit in the scene sun shadow
                                 //(rocks / lighthouse). Spray does NOT cast — point
                                 //sprites cannot write a usable shape into the shadow
                                 //map; receive-only is the practical path.

  //── Procedural mist-shape knobs. Each billboard is a soft sphere eroded by 3D noise
  //   (no sprite texture). erode/softEdge are the spray-vs-fog dial. ────────────────
  this.noiseScale = 2.5;         //3D noise frequency across the droplet.
  this.erode = 0.35;             //silhouette erosion threshold (higher = grainier).
  this.softEdge = 0.25;          //erosion smoothstep width (lower = sharper, sparklier).
  this.noiseEvolve = 0.6;        //how fast the noise field dissolves over the life.
  this.windNoiseSpeed = 0.4;     //rate the haze noise SCROLLS along the wind direction, so the
                                 //wisps appear to stream with the breeze (0 = static noise, just
                                 //the per-particle age dissolve). Noise units per second.

  //── Three-tier coarseness continuum. aCoarse in [0,1] grades each particle from a
  //   fine hanging MIST (0) to a coherent falling DROPLET (1). One axis drives BOTH the
  //   look (size/opacity/erosion/sparkle — vertex+fragment) and the motion (gravity,
  //   below in tick). The two emitters draw from their own bands, so a single rock-slam
  //   can throw a fine haze AND chunky droplets — the cue that sells mist, not fog.
  //   Collapse to the pre-tier single look by setting each *Coarse render knob equal to
  //   its base (sizeScale/opacity/erode) and the bands to 0. ─────────────────────────
  this.wobbleFreq = 8.0;         //droplet surface-wobble rate (rad/s). The physical 2 mm raindrop
                                 //mode (~268 rad/s) is a visual blur; this gentle value reads as a
                                 //wobble. Volume is conserved (a*b^2 const) so a drop only breathes.
  this.wobbleAmp = 0.28;         //droplet aspect-breathe amplitude (0 = rigid sphere). Up 0.18->0.28.
  this.harmonic = 0.5;           //droplet spherical-harmonic SURFACE wobble (modes 2-4, animated):
                                 //makes each cluster drop jiggle like a real airborne bead instead
                                 //of a rigid sphere (smaller drops wobble less — surface tension).
                                 //0 = smooth. 0.28->0.5: foam chunks are JAGGED/torn, not round
                                 //beads, so the silhouette wobble is pushed up to break the blizzard
                                 //of identical circles. The analytic stand-in for the old Blender
                                 //per-vertex icosphere keyframe wobble (bubble_builder).
  this.dropTopSize = 0.34;       //cell-local radius of the LARGEST cluster drop (was a hardcoded
                                 //0.20). Bigger top + the small radMin = a WIDER size range, so the
                                 //cluster reads as varied foam chunks not uniform grains. Live dial:
                                 //window.oceanSplash.dropTopSize.
  this.windBreakup = 1.5;        //how hard rising wind SHREDS big drops into fine spray: at high
                                 //wind the size falloff steepens AND the top size shrinks, so a
                                 //storm is nearly all fine grains (giant chunks were too common at
                                 //high wind). 0 = size ignores wind. Live: window.oceanSplash.windBreakup.
  this.sizeFalloff = 7.0;        //cluster drop SIZE distribution exponent: member radius =
                                 //mix(min, max, rand^sizeFalloff). Higher = large drops die off
                                 //exponentially faster (most drops tiny, the big ones rare). 3->7:
                                 //real spray is a STRONG exponential — a far larger fraction of
                                 //small drops, with the (now bigger) tops as rare chunks. Pair with
                                 //dropTopSize for variety. Live dial: window.oceanSplash.sizeFalloff.
  this.mistWindMin = 5.0;        //m/s wind below which spray stays coherent BEADS (no misty
                                 //haze). Mist is wind-shredded spray, so in light air even a
                                 //wall-breaker throws droplets, not fog.
  this.mistWindMax = 15.0;       //m/s wind at/above which the haze (mist) look is fully present.
                                 //Between min and max the haze fades in with wind speed.
  this.foamMix = 0.85;           //GLOBAL FOAMINESS MASTER for the unified water shader. Scales the
                                 //aeration `aer = vCoarse * windE * foamMix`: 0 = always thin
                                 //translucent droplets (never foam), 1 = full mist<->foam continuum.
                                 //Light waves stay translucent regardless (windE->0). Live: foamMix.
  this.foamOpacity = 1.0;        //body alpha of a foam bead (aerated water is near-opaque, unlike
                                 //the hollow clear bead whose centre transmits).
  this.foamAlbedo = 1.2;         //brightness of the foam body (white aerated water lit by sky).
  this.nightAmbient = 0.07;      //fraction the ambient (sky+water hemisphere fill) drops to at deep
                                 //night. White foam glows over a black sea under any ambient, so this
                                 //floors it dark once the sun is down (DIRECT moonlight is untouched).
                                 //Live dial: window.oceanSplash.nightAmbient (1.0 = no night dimming).
  this.waterBounce = 0.6;        //LIGHT-FROM-BELOW strength: the sunlit water bounces its teal colour
                                 //up onto the spray underside (the OTHER half of the ambient, sky
                                 //being the top half). Lifts the down/shadow side off charcoal. Day-
                                 //gated in-shader. 0 = off. Live dial: window.oceanSplash.waterBounce.
  this.foamSkyFill = 1.2;        //BRIGHTNESS of the explicit blue daytime sky-bounce added to the
                                 //foam ambient (NOT a 0-1 mix any more). The dim a-starry-sky
                                 //hemisphere term left shadow foam charcoal under a blue sky, so we
                                 //add a real blue dome fill on top. Day-gated in-shader by sun
                                 //ELEVATION so a bright low sun still lights it and night switches
                                 //off (no glow). Live dial: window.oceanSplash.foamSkyFill.
  this.foamCalmFade = 0.5;       //0..1 how much CALMER seas thin the foam (wind 2->10 m/s ramp in
                                 //shader). 0 = same foam at any wind; 1 = no foam when dead calm.
                                 //Tones the storm blizzard down to a fizz on gentle swell. Live
                                 //dial: window.oceanSplash.foamCalmFade.
  this.opacityCoarse = 0.95;     //peak opacity at coarse=1 (droplets are dense/bright).
  this.erodeCoarse = 0.06;       //erosion threshold at coarse=1 (only shapes the haze end
                                 //now; the droplet end is the SDF cluster).
  this.sparkle = 1.2;            //sun-specular punch on the water drops (the wet glint).

  //── Droplet-cluster render knobs. A coarse billboard hosts a gaussian cluster of small
  //   SDF-sphere drops (each with sky-fresnel + sun glint + a little absorption so it
  //   reads as water, not a hollow soap bubble). ─────────────────────────────────────
  this.dropletCells = 6.0;       //grid cells across the billboard (6 -> up to ~36 drops,
                                 //gaussian-culled to ~12-32). More = more, smaller drops.
  this.dropletRadius = 0.7;      //individual cluster-drop size scale within its cell. Pulled
                                 //1.0->0.7 so the larger cluster members (the "blue" drops) come
                                 //down too — scales ONLY the cluster drops, not the haze or the
                                 //billboard, so the mist stays the size you tuned.
  this.dropletSpread = 3.0;      //gaussian tightness of the cluster (higher = tighter core).
  this.absorb = 0.5;             //rim absorption (Beer-Lambert): tints the Fresnel rim toward
                                 //water at grazing angles. Pulled 1.2->0.5 — at 1.2 it darkened
                                 //the sky reflection back into a dark-rimmed bubble. 0 = no tint.
  this.mistGravityFactor = 0.12; //gravity multiplier at coarse=0: fine mist barely falls
                                 //(hangs and drifts on wind); coarse=1 feels full gravity.
  this.dropLifeBoost = 4.0;      //lifetime multiplier added in proportion to coarseness: a
                                 //coarse droplet lives (1 + dropLifeBoost*coarse) ~ up to 5x as
                                 //long as a fine mist puff, so it has time to complete its fall
                                 //arc and land in the water instead of fizzling out mid-air.
  this.dropSinkDepth = 1.5;      //how far (in particle radii, scaled by coarseness) a falling
                                 //droplet sinks BELOW the water surface before it is removed. A
                                 //real drop does not pop the instant it grazes the surface — it
                                 //punches in and splashes. Mist (coarse~0) still dies at the
                                 //surface. The splash itself is handled elsewhere; this just
                                 //stops the mid-fall droplets blinking out at the waterline.
  this.crestCoarseMin = 0.0;     //crest mist draws coarseness r^3-biased across this band: a
  this.crestCoarseMax = 1.0;     //wave top throws MOSTLY fine aerosol (r^3 keeps the median
                                 //near coarse~0.12) with a sparse tail of coherent droplets and
                                 //a few fat falling drops — so the open-sea spray (which is all
                                 //crest mist) actually exercises the bead + big-drop tiers, not
                                 //pure haze. Lower the max back toward 0.2 for aerosol-only crests.
  this.impactCoarseMin = 0.0;    //impact bursts span fine->coarse, biased fine (r^3): a
  this.impactCoarseMax = 0.85;   //rock slam is mostly haze with a tail of fat droplets.
  this.chunkCoarseThresh = 0.5;  //coarseness above which a particle reads as a foam CHUNK (the
                                 //bead/droplet cluster) rather than the mist haze behind it.
  this.chunkKeepChance = 0.4;    //fraction of would-be CHUNK particles actually spawned. Thins the
                                 //big foam droplets by COUNT without touching the fine mist (which
                                 //always spawns), so the haze stays dense while the chunks sparsen.
                                 //Live dial: window.oceanSplash.chunkKeepChance (1.0 = no thinning).

  //── Debug surface probe. A single bright ball parked ON the sampled emission
  //   surface (the same rendered-FFT _surfaceHeight the crest/shore emitters
  //   spawn against), placed in front of the camera. Lets us eyeball whether the
  //   spawn HEIGHT actually sits on the visible waterline — isolating "is my
  //   spawn point right?" from "do the particles look right?". buoyancy reads the
  //   same height source and bobs correctly, so if this ball rides the surface,
  //   position is good and the analytic RISE gate is the remaining suspect.
  this.debugMarker = false;      //window.setSplashMarker(1) to turn on.
  this.debugMarkerAhead = 20.0;  //m in front of camera to park the probe.

  //── Apply caller overrides. Every knob above is a plain field, so a config
  //   object passed at construction (e.g. from the ocean component / scene HTML)
  //   can dial in or down ANY of them at start — capacity was already consumed
  //   above for the pool sizing, the rest take effect live. Unknown keys are
  //   harmless. Same fields stay hot-editable on the instance at runtime. ──────
  for(const k in cfg){
    if(cfg.hasOwnProperty(k)) this[k] = cfg[k];
  }

  //── Pool storage (structure-of-arrays). position/aSize/aAge01/aSeed/aType are
  //   GPU attribute backings; vel/age/lifetime stay CPU-only. ────────────────
  this._positions = new Float32Array(capacity * 3);
  this._sizes = new Float32Array(capacity);
  this._age01 = new Float32Array(capacity);
  this._seeds = new Float32Array(capacity);
  this._types = new Float32Array(capacity);
  this._coarse = new Float32Array(capacity);
  this._vel = new Float32Array(capacity * 3);
  this._age = new Float32Array(capacity);
  this._life = new Float32Array(capacity);

  const geometry = new THREE.BufferGeometry();
  this._posAttr = new THREE.BufferAttribute(this._positions, 3).setUsage(THREE.DynamicDrawUsage);
  this._sizeAttr = new THREE.BufferAttribute(this._sizes, 1).setUsage(THREE.DynamicDrawUsage);
  this._ageAttr = new THREE.BufferAttribute(this._age01, 1).setUsage(THREE.DynamicDrawUsage);
  this._seedAttr = new THREE.BufferAttribute(this._seeds, 1).setUsage(THREE.DynamicDrawUsage);
  this._typeAttr = new THREE.BufferAttribute(this._types, 1).setUsage(THREE.DynamicDrawUsage);
  this._coarseAttr = new THREE.BufferAttribute(this._coarse, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', this._posAttr);
  geometry.setAttribute('aSize', this._sizeAttr);
  geometry.setAttribute('aAge01', this._ageAttr);
  geometry.setAttribute('aSeed', this._seedAttr);
  geometry.setAttribute('aType', this._typeAttr);
  geometry.setAttribute('aCoarse', this._coarseAttr);
  geometry.setDrawRange(0, 0);
  this.geometry = geometry;

  const def = ARestlessOcean.Materials.Ocean.splashMaterial;
  this.material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(def.uniforms),
    vertexShader: def.vertexShader,
    fragmentShader: def.fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending
  });

  //Procedural soft-droplet sprite so the system renders before a real sprite is
  //supplied. Swap later with setSprite().
  this._defaultSprite = ARestlessOcean.OceanSplash.makeRadialSprite();
  this.material.uniforms.splashSprite.value = this._defaultSprite;

  this.mesh = new THREE.Points(geometry, this.material);
  this.mesh.frustumCulled = false; //positions move every frame; bounds are stale.
  this.mesh.renderOrder = 10;      //draw after opaque scene + water.
  this.mesh.visible = false;       //OceanGrid flips this on after offscreen passes.
  this.mesh.layers.set(ARestlessOcean.OCEAN_LAYER);
  scene.add(this.mesh);

  //Terrain-height field, copied from the foam ortho on snap-change (async).
  this._terrain = null;          //Float32Array RGBA, G = world Y, A = hasGeom.
  this._terrainW = 0;
  this._terrainH = 0;
  this._terrainCamX = 0;
  this._terrainCamZ = 0;
  this._terrainHalf = 2048.0;    //foam ortho half-width (metres).
  this._terrainReadPending = false;

  this._prevTime = -1.0;
};

//Camera-facing soft sprite: white core easing to transparent, faint speckle so a
//cluster reads as droplets rather than a flat disc.
ARestlessOcean.OceanSplash.makeRadialSprite = function(){
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, 0.0, size * 0.5, size * 0.5, size * 0.5);
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
};

//Splash is configured declaratively via the nested <ocean-splash> element, whose
//kebab-case attributes ocean-state.applyNestedConfig converts to the camelCase cfg
//object handed to this constructor's third arg. Any knob below is settable that
//way (impact-min-launch -> impactMinLaunch) and stays live-editable on the instance
//via window.oceanSplash.

//Swap in an authored spray sprite (a THREE.Texture).
ARestlessOcean.OceanSplash.prototype.setSprite = function(texture){
  if(texture && texture.isTexture){
    this.material.uniforms.splashSprite.value = texture;
  }
};

//Spawn one particle. type: 0 crest mist, 1 impact burst. coarse: [0,1] mist->droplet
//grade (optional; defaults to 0 = finest mist).
ARestlessOcean.OceanSplash.prototype.spawn = function(px, py, pz, vx, vy, vz, size, life, type, coarse){
  if(this.liveCount >= this.capacity) return; //pool full: drop (cheap, bounded).
  const i = this.liveCount++;
  const p3 = i * 3;
  this._positions[p3] = px; this._positions[p3 + 1] = py; this._positions[p3 + 2] = pz;
  this._vel[p3] = vx; this._vel[p3 + 1] = vy; this._vel[p3 + 2] = vz;
  this._sizes[i] = size;
  //Coarser (droplet) particles live proportionally longer so they complete a full fall arc
  //rather than fizzling mid-air; fine mist keeps its short dissipation life.
  this._life[i] = life * (1.0 + this.dropLifeBoost * (coarse || 0.0));
  this._age[i] = 0.0;
  this._age01[i] = 0.0;
  this._seeds[i] = Math.random();
  this._types[i] = type;
  this._coarse[i] = coarse || 0.0;
};

//Unified impact burst — shore and hull both call this. worldPos is the contact
//point, (nx,ny,nz) the surface normal (the solid face the water strikes), speed the
//closing speed of water vs solid in m/s. (tanX,tanZ,span) are optional: when given,
//each particle's spawn point is jittered up to ±span/2 ALONG the (tanX,tanZ) tangent,
//so a row of shore cells lays down one continuous SHEET instead of isolated point
//geysers. Omit them (hull impacts) for a burst from a single point.
//(inVx,inVy,inVz) are optional: the incoming WATER velocity. When supplied (shore),
//the launch axis becomes the mirror of that velocity reflected off the surface (plus
//run-up), so spray leaves DIRECTIONALLY along the bounce instead of coning straight
//up the normal. Omit them (hull) to keep the old normal-cone launch.
ARestlessOcean.OceanSplash.prototype.emitImpact = function(px, py, pz, nx, ny, nz, speed, tanX, tanZ, span, countScale, inVx, inVy, inVz){
  if(!this.enabled || !this.impactEnabled) return;
  if(speed <= 0.0) return;
  let count = Math.round(speed * this.impactBurstPerSpeed);
  if(count < this.impactMinBurst) count = this.impactMinBurst;
  if(count > this.impactMaxBurst) count = this.impactMaxBurst;
  //countScale lets the dense shore-contour scan emit a FEW particles per cell
  //(many cells × few each = a sheet) without each cell dumping a full hull-sized
  //burst and overflowing the pool. The fractional remainder is emitted PROBABILISTICALLY
  //(not floored to 1) so a low scale truly thins the sheet — a hard floor of 1 meant every
  //firing cell showed a particle no matter how low countScale went, capping the reduction.
  if(countScale !== undefined){
    const scaled = count * countScale;
    count = Math.floor(scaled);
    if(Math.random() < (scaled - count)) count += 1;
    if(count <= 0) return; //this cell sits out this frame; the sheet accumulates over frames.
  }
  const nl = Math.max(1e-4, Math.sqrt(nx * nx + ny * ny + nz * nz));
  nx /= nl; ny /= nl; nz /= nl;
  //Launch axis. By default spray cones up the surface normal (old behaviour). When
  //the caller hands us the incoming water velocity AND reflection is enabled, the
  //axis becomes the MIRROR of that velocity bounced off the surface: water moving
  //into the face (incoming·n < 0) is thrown back out along the reflection, so a wave
  //hitting a cliff sprays seaward along its own path rather than dribbling up the
  //rock. Inviscid reflection alone leaves a vertical wall spraying flat, so we add
  //run-up — upward lift scaled by how square-on the slam is (-incoming·n) — which is
  //what lifts a real sheet up the face. Glancing flat-beach backwash gets little of
  //either and washes low; head-on cliff strikes throw a tall directional sheet.
  let axisX = nx, axisY = ny, axisZ = nz;
  if(this.impactReflect > 0.0 && inVx !== undefined){
    const vl = Math.sqrt(inVx * inVx + inVy * inVy + inVz * inVz);
    if(vl > 1e-4){
      const ivx = inVx / vl, ivy = inVy / vl, ivz = inVz / vl;
      const idotn = ivx * nx + ivy * ny + ivz * nz; //<0 => water moves INTO the face.
      if(idotn < 0.0){
        const rx = ivx - 2.0 * idotn * nx; //mirror reflection (unit in, unit out).
        const ry = ivy - 2.0 * idotn * ny;
        const rz = ivz - 2.0 * idotn * nz;
        const runUp = this.impactRunUp * (-idotn);
        const b = this.impactReflect;
        let ax = rx * b + nx * (1.0 - b);
        let ay = ry * b + ny * (1.0 - b) + runUp;
        let az = rz * b + nz * (1.0 - b);
        const al = Math.sqrt(ax * ax + ay * ay + az * az);
        if(al > 1e-4){ axisX = ax / al; axisY = ay / al; axisZ = az / al; }
      }
    }
  }
  //Cap the launch: shore "rise" can read 20+ m/s, which fires spray dozens of
  //metres up (the geyser). Torn shore spray actually leaves at a few m/s.
  let launch = speed * this.impactVelScale;
  if(launch < this.impactMinLaunch) launch = this.impactMinLaunch;
  if(launch > this.impactMaxLaunch) launch = this.impactMaxLaunch;
  const haveTan = (span && span > 0.0 && (tanX !== undefined));
  //Per-burst size scale from impact energy. sqrt so droplet scale tracks momentum
  //gently (spray scale grows slower than raw speed); 1.0 at the reference speed.
  let sizeE = Math.sqrt(speed / Math.max(0.1, this.impactSizeRefSpeed));
  if(sizeE > this.impactSizeMaxScale) sizeE = this.impactSizeMaxScale;
  const burstSize = this.impactSize * sizeE;
  for(let k = 0; k < count; ++k){
    //Random direction within a cone around the launch axis, biased upward so a
    //burst sheets into the air rather than spraying sideways.
    let rx = Math.random() * 2.0 - 1.0;
    let ry = Math.random() * 2.0 - 1.0;
    let rz = Math.random() * 2.0 - 1.0;
    let dx = axisX + rx * this.impactSpread;
    let dy = axisY + ry * this.impactSpread;
    let dz = axisZ + rz * this.impactSpread;
    if(dy < 0.2) dy = 0.2;
    const dl = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy + dz * dz));
    const sp = launch * (0.5 + Math.random() * 0.7);
    //Smear the spawn position along the waterline tangent (sheet) when supplied.
    let sx = px, sz = pz;
    if(haveTan){
      const off = (Math.random() - 0.5) * span;
      sx += tanX * off; sz += tanZ * off;
    }
    //Per-droplet coarseness, biased toward fine (r^3) so a burst is mostly haze with a
    //sparse tail of fat droplets — the spread that reads as "mist plus droplets".
    const cr = this.impactCoarseMin + (this.impactCoarseMax - this.impactCoarseMin) * Math.pow(Math.random(), 3.0);
    //CHUNK thin: a would-be big foam droplet is dropped most of the time, so the coarse beads
    //sparsen while the fine mist (cr below threshold) is always kept — fewer chunks, same haze.
    if(cr > this.chunkCoarseThresh && Math.random() > this.chunkKeepChance) continue;
    this.spawn(
      sx, py, sz,
      (dx / dl) * sp, (dy / dl) * sp, (dz / dl) * sp,
      burstSize * (0.7 + Math.random() * 0.7),
      this.impactLifetime * (0.7 + Math.random() * 0.6),
      1.0, cr
    );
  }
};

//Sample the cached terrain-height field at world (x,z). Returns the terrain Y, or
//null when outside the ortho or where no geometry was captured (open water/sky).
ARestlessOcean.OceanSplash.prototype.sampleTerrainHeight = function(x, z){
  const data = this._terrain;
  if(!data) return null;
  const half = this._terrainHalf;
  //Mirror the foam-map mapping in water-shader.glsl exactly:
  //  u = 0.5 * ((x - camX)/half + 1);  v = 1 - 0.5 * ((z - camZ)/half + 1)
  const u = 0.5 * (((x - this._terrainCamX) / half) + 1.0);
  let v = 0.5 * (((z - this._terrainCamZ) / half) + 1.0);
  v = 1.0 - v;
  if(u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return null;
  const px = Math.min(this._terrainW - 1, Math.max(0, Math.floor(u * this._terrainW)));
  const py = Math.min(this._terrainH - 1, Math.max(0, Math.floor(v * this._terrainH)));
  const idx = (py * this._terrainW + px) * 4;
  if(data[idx + 3] < 0.5) return null; //alpha 0 => no geometry there.
  return data[idx + 1];                //G channel = world Y (position pass output).
};

//Kick an async readback of the foam terrain-height ortho into a CPU array. Called
//by OceanGrid only when the foam camera actually re-rendered (snap-change), so the
//(16 MB at 1024^2) transfer is rare and never blocks the frame.
ARestlessOcean.OceanSplash.prototype.requestTerrainReadback = function(renderTarget, camX, camZ, half){
  if(!this.shoreEnabled || this._terrainReadPending) return;
  if(typeof this.renderer.readRenderTargetPixelsAsync !== 'function') return;
  const w = renderTarget.width;
  const h = renderTarget.height;
  if(!this._terrainBuf || this._terrainBuf.length !== w * h * 4){
    this._terrainBuf = new Float32Array(w * h * 4);
  }
  const buf = this._terrainBuf;
  const self = this;
  this._terrainReadPending = true;
  this.renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, w, h, buf).then(function(){
    self._terrain = buf;
    self._terrainW = w;
    self._terrainH = h;
    self._terrainCamX = camX;
    self._terrainCamZ = camZ;
    self._terrainHalf = half;
    self._terrainReadPending = false;
  }).catch(function(){ self._terrainReadPending = false; });
};

//Height of the WATER WE ACTUALLY SEE at world (x,z). Prefers the rendered FFT
//surface (async cached snapshot, ~15 Hz, no GPU stall) so spray spawns where the
//visible wave is; falls back to the analytic twin when the snapshot is cold or the
//point is outside its ~512 m window. Use this for spawn POSITION and elevation
//GATES; use the analytic field for rates (rise) so a finite difference stays
//within one phase system. (ocean-grid keeps the snapshot warm only on request, so
//tick() calls requestFFTSnapshot each frame.)
ARestlessOcean.OceanSplash.prototype._surfaceHeight = function(field, x, z, t){
  if(this.useRenderedHeight && ARestlessOcean.sampleWaterHeightFFT){
    const h = ARestlessOcean.sampleWaterHeightFFT(x, z);
    if(h !== null && h !== undefined) return h;
  }
  return field.sampleHeight(x, z, t);
};

//Emit crest mist by scanning the analytic field around the camera for steep,
//rising tops. Vertical velocity via a small time difference; steepness via the
//surface normal.
ARestlessOcean.OceanSplash.prototype._emitCrest = function(field, t, camX, camZ, windX, windZ){
  if(!this.crestEnabled) return;
  const step = this.crestGridStep;
  const r = this.crestRadius;
  const maxD2 = this.maxEmitDistance * this.maxEmitDistance;
  const dt = 0.05;
  const nrm = this._scratchN || (this._scratchN = new THREE.Vector3());
  //Jitter the grid origin per frame so spawn points are not a static lattice.
  const jx = (Math.random() - 0.5) * step;
  const jz = (Math.random() - 0.5) * step;
  //SPINDRIFT: as the wind climbs toward a gale the air strips mist off the WHOLE surface, not just
  //the breaking crests — so more cells fire, the elevation/rise gates relax (flatter, lower water
  //mists too), and the spray is launched LOWER and FINER so it streams as a torn surface haze that
  //the wind-grab then carries downwind. spin (0 below spindriftStart, 1 at full) ramps it all in.
  const windSpeed = Math.sqrt(windX * windX + windZ * windZ);
  let spin = (windSpeed - this.spindriftStart) / Math.max(0.001, this.spindriftFull - this.spindriftStart);
  spin = spin < 0.0 ? 0.0 : (spin > 1.0 ? 1.0 : spin);
  spin = spin * spin * (3.0 - 2.0 * spin); //smoothstep
  const spawnChance = Math.min(1.0, this.crestSpawnChance * (1.0 + spin * this.spindriftBoost));
  const minHeight = this.crestMinHeight * (1.0 - 0.85 * spin); //wind strips lower than the crests
  const riseThresh = this.crestRiseThreshold * (1.0 - 0.6 * spin);
  const cluster = Math.round(this.crestClusterCount * (1.0 + spin * 0.6));
  for(let gx = -r; gx <= r; gx += step){
    for(let gz = -r; gz <= r; gz += step){
      const d2 = gx * gx + gz * gz;
      if(d2 > maxD2) continue;
      if(Math.random() > spawnChance) continue;
      const x = camX + gx + jx;
      const z = camZ + gz + jz;
      //All gates read the RENDERED FFT field (phase-correct) wherever the snapshot
      //covers this point; the analytic twin is only a cold-start fallback. Reading
      //them off the water we SEE (same source as _surfaceHeight) is what stops mist
      //erupting where the analytic phase has a crest but the rendered surface is flat.
      //
      //PRIMARY crest selector = "elevated AND rising": the upper front face of a
      //crest, which the smoothed 2 m field resolves well. (Steepness from that field
      //is unreliable — it cuts short-wave slopes — so it is demoted to a near-flat
      //reject below, not the gate that decides where mist lives.)
      const h0 = this._surfaceHeight(field, x, z, t);
      if((h0 - field.heightOffset) < minHeight) continue;
      let rise = (this.useRenderedHeight && ARestlessOcean.sampleWaterRiseFFT)
        ? ARestlessOcean.sampleWaterRiseFFT(x, z) : null;
      if(rise === null){
        const h0a = field.sampleHeight(x, z, t);
        const h1a = field.sampleHeight(x, z, t + dt);
        rise = (h1a - h0a) / dt;
      }
      if(rise < riseThresh) continue;
      let steepness = (this.useRenderedHeight && ARestlessOcean.sampleWaterSlopeFFT)
        ? ARestlessOcean.sampleWaterSlopeFFT(x, z) : null;
      if(steepness === null){ field.sampleNormal(x, z, t, nrm); steepness = 1.0 - nrm.y; }
      if(steepness < this.crestSteepnessThreshold) continue;
      //Emit a CLUSTER, not a lone particle, so the crest reads as a puff of mist
      //congregating on the top (the shore sheet's analogue). Each droplet is spread
      //over a small radius and re-sampled onto the surface so the puff hugs the crest.
      //Launch inherits the surface's own upward speed (`rise`): torn spray is the
      //crest's water continuing ballistically once the wave form decelerates past its
      //peak. crestUpSpeed is a small additive floor so gentle seas still mist a little.
      for(let c = 0; c < cluster; ++c){
        const sx = x + (Math.random() - 0.5) * this.crestClusterRadius;
        const sz = z + (Math.random() - 0.5) * this.crestClusterRadius;
        const sh = this._surfaceHeight(field, sx, sz, t);
        //Spindrift launches LOWER (hugs the surface, wind carries it) and FINER (mistier).
        const up = (rise * this.crestVelInherit * (0.7 + Math.random() * 0.5) + this.crestUpSpeed) * (1.0 - 0.45 * spin);
        const cr = (this.crestCoarseMin + (this.crestCoarseMax - this.crestCoarseMin) * Math.pow(Math.random(), 3.0)) * (1.0 - 0.6 * spin);
        //CHUNK thin (same as the impact path): sparsen the coarse beads, keep the fine crest mist.
        if(cr > this.chunkCoarseThresh && Math.random() > this.chunkKeepChance) continue;
        this.spawn(
          sx, sh + 0.1, sz,
          windX * this.crestWindFactor + (Math.random() - 0.5) * 0.6,
          up,
          windZ * this.crestWindFactor + (Math.random() - 0.5) * 0.6,
          this.crestSize * (0.7 + Math.random() * 0.6),
          this.crestLifetime * (0.7 + Math.random() * 0.6),
          0.0, cr
        );
      }
    }
  }
};

//Surface haze FLOOR: at gale force the wind shears mist off the WHOLE surface continuously, not
//just off breaking crests, so it spreads instead of bursting in patches. This emits a thin, UNGATED
//(no rise/steepness condition) uniform fine mist over open water, scaled by the same spin ramp as
//the crest spindrift, launched low so the wind-grab carries it downwind. Off below gale force.
ARestlessOcean.OceanSplash.prototype._emitSurfaceHaze = function(field, t, camX, camZ, windX, windZ){
  if(!this.crestEnabled || this.hazeFloorChance <= 0.0) return;
  const windSpeed = Math.sqrt(windX * windX + windZ * windZ);
  let spin = (windSpeed - this.spindriftStart) / Math.max(0.001, this.spindriftFull - this.spindriftStart);
  spin = spin < 0.0 ? 0.0 : (spin > 1.0 ? 1.0 : spin);
  spin = spin * spin * (3.0 - 2.0 * spin); //smoothstep
  if(spin <= 0.001) return;                 //only near gale force
  const step = this.crestGridStep;
  const r = this.crestRadius;
  const maxD2 = this.maxEmitDistance * this.maxEmitDistance;
  const chance = this.hazeFloorChance * spin;
  const count = this.hazeFloorCount;
  const jx = (Math.random() - 0.5) * step;
  const jz = (Math.random() - 0.5) * step;
  for(let gx = -r; gx <= r; gx += step){
    for(let gz = -r; gz <= r; gz += step){
      if(gx * gx + gz * gz > maxD2) continue;
      if(Math.random() > chance) continue;
      const x = camX + gx + jx;
      const z = camZ + gz + jz;
      const h0 = this._surfaceHeight(field, x, z, t);
      //Open water only: skip cells where terrain pokes above the water (shore spray owns those).
      const terrainY = this._terrain ? this.sampleTerrainHeight(x, z) : null;
      if(terrainY !== null && terrainY > h0) continue;
      for(let c = 0; c < count; ++c){
        const sx = x + (Math.random() - 0.5) * step;
        const sz = z + (Math.random() - 0.5) * step;
        const sh = this._surfaceHeight(field, sx, sz, t);
        //Fine mist (low coarseness -> translucent, no foam), launched LOW so it streams not arcs.
        const cr = this.hazeFloorCoarse * Math.random();
        this.spawn(
          sx, sh + 0.1, sz,
          windX * this.crestWindFactor + (Math.random() - 0.5) * 0.6,
          this.hazeFloorUp * (0.5 + Math.random()),
          windZ * this.crestWindFactor + (Math.random() - 0.5) * 0.6,
          this.crestSize * (0.7 + Math.random() * 0.6),
          this.crestLifetime * (0.9 + Math.random() * 0.6),
          0.0, cr
        );
      }
    }
  }
};

//Emit shore impact bursts as a continuous SHEET along the waterline. We scan a
//fine grid for cells sitting on the rest-waterline contour, and at each one lay a
//short ribbon of spray ALONG the contour tangent (not a single point cone) so the
//whole shoreline reads as a wall of spray rather than scattered geysers. Density
//is biased toward the camera-forward direction and thinned with distance, so the
//budget goes to visible spray. Needs the terrain field. (fwdX,fwdZ) = camera fwd.
ARestlessOcean.OceanSplash.prototype._emitShore = function(field, t, camX, camZ, fwdX, fwdZ){
  if(!this.shoreEnabled || !this._terrain) return;
  const step = this.shoreGridStep;
  const r = this.shoreScanRadius;
  const maxD2 = this.maxEmitDistance * this.maxEmitDistance;
  const nearR2 = this.shoreNearRadius * this.shoreNearRadius;
  const dt = 0.05;
  //Terrain-slope finite-difference step. Must straddle at least ~1.5 foam-ortho
  //texels or both samples land in the same texel and the gradient reads zero (the
  //"every burst poofs straight up" bug — a flat normal gives the reflection nothing
  //to bounce off). Derive the texel size from the readback resolution so this holds
  //if the ortho is ever resized.
  const texel = (this._terrainW > 0 && this._terrainHalf > 0)
    ? (2.0 * this._terrainHalf / this._terrainW) : 4.0;
  const eps = Math.max(this.shoreGradEps, texel * 1.5);
  for(let gx = -r; gx <= r; gx += step){
    for(let gz = -r; gz <= r; gz += step){
      const d2 = gx * gx + gz * gz;
      if(d2 > maxD2) continue;
      //Camera-front bias: skip cells roughly behind the camera. (gx,gz) is the
      //offset from camera; dot with forward, normalised by distance.
      const dist = Math.sqrt(d2);
      if(dist > 1e-3){
        const fdot = (gx * fwdX + gz * fwdZ) / dist;
        if(fdot < this.shoreFrontBias) continue;
      }
      //Distance thinning: keep every near cell (solid sheet), probabilistically
      //drop far ones (sparse far spray is fine and accumulates over frames).
      if(d2 > nearR2 && Math.random() > this.shoreFarKeep) continue;
      const x = camX + gx;
      const z = camZ + gz;
      const seaLevel = field.heightOffset;
      //Two kinds of shore throw spray: a GENTLE BEACH (terrain that breaks the surface
      //near the rest waterline) and a VERTICAL CLIFF/WALL (a lighthouse base, harbour
      //wall, sea stack — solid that plunges through the waterline). The foam ortho is a
      //top-down HEIGHTFIELD, so a vertical face shows up not as terrain-at-sea-level but
      //as a one-texel JUMP from open water (null) to a tall top. Classify each cell from
      //its own height + its neighbours, treating null (no geometry) as sea level.
      const rawT = this.sampleTerrainHeight(x, z);
      const hereT = (rawT === null) ? seaLevel : rawT;
      //Neighbour terrain (null -> sea level) — reused for BOTH classification and the
      //uphill gradient, so a wall edge yields a strong gradient pointing into the wall.
      const xpR = this.sampleTerrainHeight(x + eps, z), xpH = (xpR === null) ? seaLevel : xpR;
      const xmR = this.sampleTerrainHeight(x - eps, z), xmH = (xmR === null) ? seaLevel : xmR;
      const zpR = this.sampleTerrainHeight(x, z + eps), zpH = (zpR === null) ? seaLevel : zpR;
      const zmR = this.sampleTerrainHeight(x, z - eps), zmH = (zmR === null) ? seaLevel : zmR;
      const maxNbr = Math.max(xpH, xmH, zpH, zmH);
      //BEACH: this cell's terrain sits within shoreBand of the rest waterline. Gating
      //against MEAN sea level (not the swinging instantaneous wave) keeps the contact a
      //fixed beach contour rather than firing wherever a passing wave grazes the seabed.
      const isBeach = (rawT !== null) && Math.abs(rawT - seaLevel) <= this.shoreBand;
      //CLIFF BASE: this cell is at/below the waterline (open water or submerged) but a
      //neighbour rises a full wall-height above it — the foot of a vertical face the
      //wave smashes into. cliffMinHeight is taller than a wave crest so passing swell on
      //a beach is never mistaken for a wall.
      const isCliff = !isBeach && (hereT <= seaLevel + this.shoreBand) &&
                      (maxNbr >= seaLevel + this.cliffMinHeight);
      if(!isBeach && !isCliff) continue;
      //Rise = the RENDERED FFT water's own dH/dt (phase-correct) so a burst only fires
      //when the water you SEE is actually surging — not when the analytic phantom wave
      //happens to peak here. Analytic finite difference is the cold-start fallback only.
      let rise = (this.useRenderedHeight && ARestlessOcean.sampleWaterRiseFFT)
        ? ARestlessOcean.sampleWaterRiseFFT(x, z) : null;
      if(rise === null){
        const h0a = field.sampleHeight(x, z, t);
        const h1a = field.sampleHeight(x, z, t + dt);
        rise = (h1a - h0a) / dt;
      }
      if(rise < this.shoreRiseThreshold) continue;
      //Water must be present and elevated against the shore, read off the rendered FFT
      //so a burst can't erupt where the analytic phase is high but the visible water is
      //in a trough. For a BEACH the surface must have climbed onto the sand (h0 >= the
      //terrain top); for a CLIFF the wall top is metres up, so instead require the wave
      //to be crested above sea level (a surge actually slapping the face) — never
      //"above the wall", which would never happen.
      const h0 = this._surfaceHeight(field, x, z, t);
      if(isBeach){ if(h0 < rawT) continue; }
      else { if(h0 <= seaLevel) continue; }
      //Uphill gradient from the (sea-level-filled) neighbours — central differences.
      //At a wall edge this points strongly toward the wall, so -grad launches the spray
      //back over the water and up; the Torricelli jet below supplies the vertical leap.
      const gradX = (xpH - xmH) / (2.0 * eps);
      const gradZ = (zpH - zmH) / (2.0 * eps);
      //Waterline tangent = the horizontal direction ALONG the shore = perpendicular
      //to the (gradX,gradZ) uphill direction in the XZ plane. The burst is smeared
      //along this so neighbouring cells overlap into one continuous sheet.
      let tanX = -gradZ, tanZ = gradX;
      const tl = Math.sqrt(tanX * tanX + tanZ * tanZ);
      if(tl > 1e-4){ tanX /= tl; tanZ /= tl; } else { tanX = 1.0; tanZ = 0.0; }
      //Impact ENERGY, not just the gentle surface rise-rate. A wave that has surged
      //high above mean carries the momentum a cliff turns into a vertical jet; model
      //the jet speed with Torricelli's head->velocity v = sqrt(2 g H) on the surge
      //height H. So a 3 m wave throws ~7-8 m/s and big storm waves really leap, while
      //gentle swell stays a low fizz — spray that scales with wave size. `rise` (the
      //timing gate) is the floor so a fast-rising small wave still pops.
      const surge = Math.max(0.0, h0 - field.heightOffset);
      const jet = this.shoreJetScale * Math.sqrt(2.0 * this.gravity * surge);
      const impactSpeed = Math.max(rise, jet);
      //Incoming water velocity for the reflection launch: the surge climbs the beach
      //UPHILL (the +gradient horizontal direction) at roughly the jet speed and lifts
      //at `rise`. We pass the TRUE geometric face normal (-gradX,1,-gradZ) — not an
      //up-biased one — because the reflection needs the real surface; the upward throw
      //now emerges from run-up inside emitImpact instead of a hand-tuned ny. (With
      //impactReflect=0 the launch falls back to coning about this geometric normal.)
      const gl = Math.sqrt(gradX * gradX + gradZ * gradZ);
      let ux = 0.0, uz = 0.0;
      if(gl > 1e-4){ ux = gradX / gl; uz = gradZ / gl; }
      //A vertical wall concentrates a whole wave column into one waterline cell, so the
      //naive count (speed x burst) explodes into a KABOOM cloud. Cliffs get their own,
      //much lower per-cell scale — the wall already reads dense from many cells firing.
      const cellCount = isCliff ? this.cliffCountScale : this.shoreCountScale;
      this.emitImpact(x, h0 + 0.1, z, -gradX, 1.0, -gradZ, impactSpeed,
        tanX, tanZ, this.shoreSheetSpan, cellCount, ux * jet, rise, uz * jet);
    }
  }
};



//Per-frame update. ctx: {time, camX, camZ, windX, windZ, sunColor(THREE.Color),
//skyAmbient(THREE.Color), viewportHeight, resW, resH, linearDepthTexture}.
ARestlessOcean.OceanSplash.prototype.tick = function(ctx){
  const u = this.material.uniforms;
  //Push art / lighting uniforms regardless of enable state so a toggle is instant.
  u.uOpacity.value = this.opacity;
  u.uSizeScale.value = this.sizeScale;
  u.uSoftRange.value = this.softRange;
  u.uMaxPointSize.value = this.maxPointSize;
  u.uDebugMode.value = this.debugMode;
  u.uViewportHeight.value = ctx.viewportHeight;
  u.uResolution.value.set(ctx.resW, ctx.resH);
  u.uPhaseG.value = this.phaseG;
  u.uPhaseGain.value = this.phaseGain;
  u.uNoiseScale.value = this.noiseScale;
  u.uErode.value = this.erode;
  u.uSoftEdge.value = this.softEdge;
  u.uNoiseEvolve.value = this.noiseEvolve;
  u.uWindNoiseSpeed.value = this.windNoiseSpeed;
  //World wind (x, z) for the haze noise scroll; the vertex projects it into the billboard plane.
  u.uWind.value.set(ctx.windX || 0.0, ctx.windZ || 0.0);
  u.uMistWindMin.value = this.mistWindMin;
  u.uMistWindMax.value = this.mistWindMax;
  u.uFoamMix.value = this.foamMix;
  u.uFoamOpacity.value = this.foamOpacity;
  u.uFoamAlbedo.value = this.foamAlbedo;
  u.uWaterBounce.value = this.waterBounce;
  u.uNightAmbient.value = this.nightAmbient;
  u.uFoamSkyFill.value = this.foamSkyFill;
  //True solar elevation (sin), NOT the brightest-light direction (that is the moon at night). Gates
  //the daytime sky lifts in-shader so a high moon does not switch the blue day-fill back on.
  if(ctx.sunElevation !== undefined) u.uSunElevation.value = ctx.sunElevation;
  u.uFoamCalmFade.value = this.foamCalmFade;
  u.uDropTopSize.value = this.dropTopSize;
  u.uWindBreakup.value = this.windBreakup;
  u.uOpacityCoarse.value = this.opacityCoarse;
  u.uErodeCoarse.value = this.erodeCoarse;
  u.uSparkle.value = this.sparkle;
  u.uDropletCells.value = this.dropletCells;
  u.uDropletRadius.value = this.dropletRadius;
  u.uDropletSpread.value = this.dropletSpread;
  u.uAbsorb.value = this.absorb;
  //Mist ambient lift + drop sky-reflection brightness (the dim-sky / dark-rim fixes).
  u.uAmbientScale.value = this.ambientScale;
  u.uSkyBoost.value = this.skyBoost;
  //Cluster drop wobble + size distribution. uTime animates the surface wobble.
  u.uTime.value = ctx.time / 1000.0;
  u.uWobbleFreq.value = this.wobbleFreq;
  u.uWobbleAmp.value = this.wobbleAmp;
  u.uHarmonic.value = this.harmonic;
  u.uSizeFalloff.value = this.sizeFalloff;
  //Sky reflection source for the bead rim: a-starry-sky metering fisheye. When absent
  //(no sky system), the shader falls back to the flat sky-ambient colour.
  if(ctx.skyReflectTex){
    u.meteringSurveyTexture.value = ctx.skyReflectTex;
    u.uHasSkyTex.value = 1;
  } else {
    u.uHasSkyTex.value = 0;
  }
  if(ctx.linearDepthTexture) u.uLinearDepth.value = ctx.linearDepthTexture;
  if(ctx.sunColor) u.sunColor.value.copy(ctx.sunColor);
  if(ctx.skyAmbient) u.skyAmbientColor.value.copy(ctx.skyAmbient);
  if(ctx.sunDir) u.sunDir.value.copy(ctx.sunDir);

  //Scene sun shadow receive. ocean-grid hands us the same shadow map + params it
  //wires into the water surface, so spray darkens consistently under the rocks /
  //lighthouse. Gated by our own receiveShadow knob so it can be toggled alone.
  if(this.receiveShadow && ctx.sunShadowEnabled && ctx.sunShadowMap){
    u.sunShadowEnabled.value = 1;
    u.sunShadowMap.value = ctx.sunShadowMap;
    u.sunShadowMatrix.value.copy(ctx.sunShadowMatrix);
    u.sunShadowMapSize.value.set(ctx.sunShadowMapW, ctx.sunShadowMapH);
    u.sunShadowRadius.value = ctx.sunShadowRadius;
    u.sunShadowBias.value = ctx.sunShadowBias;
  } else {
    u.sunShadowEnabled.value = 0;
  }

  let dt = 0.0;
  if(this._prevTime >= 0.0) dt = (ctx.time - this._prevTime) / 1000.0;
  this._prevTime = ctx.time;
  if(dt < 0.0) dt = 0.0;
  if(dt > 0.05) dt = 0.05; //clamp big stalls so bursts do not teleport.

  const field = ARestlessOcean.waveField;

  //Keep the rendered-FFT height snapshot warm so the emitters can spawn against the
  //water we actually see (see _surfaceHeight). ocean-grid renders it only on demand.
  if((this.enabled || this.debugMarker) && this.useRenderedHeight && ARestlessOcean.requestFFTSnapshot){
    ARestlessOcean.requestFFTSnapshot();
  }

  

  if(this.enabled && field && dt > 0.0){
    this._emitCrest(field, field.currentTimeSeconds, ctx.camX, ctx.camZ, ctx.windX, ctx.windZ);
    this._emitSurfaceHaze(field, field.currentTimeSeconds, ctx.camX, ctx.camZ, ctx.windX, ctx.windZ);
    if(this.impactEnabled){
      this._emitShore(field, field.currentTimeSeconds, ctx.camX, ctx.camZ,
                      ctx.camFwdX || 0.0, ctx.camFwdZ || 1.0);
    }
  }

  //── Simulate + compact. Swap-remove dead slots with the last live slot. ─────
  const pos = this._positions, vel = this._vel, age = this._age, life = this._life;
  const sizes = this._sizes, age01 = this._age01, seeds = this._seeds, types = this._types;
  const coarseArr = this._coarse;
  //Drag retention at the two coarseness ends; lerped per particle in the loop. Fine mist =
  //high drag scale (low terminal velocity), heavy bead = low drag (keeps its momentum).
  const dragMist = Math.exp(-this.airDrag * this.mistDrag * dt);
  const dragBead = Math.exp(-this.airDrag * this.beadDrag * dt);
  //Air drag is a force on the velocity RELATIVE TO THE AIR, so it damps the
  //horizontal velocity toward the air velocity it FEELS — which is what carries
  //spray downwind. Vertical wind is ~0, so vy keeps damping toward 0 under gravity.
  //The drag scale is per-particle (coarseness): fine mist converges to the wind in well
  //under its lifetime (drifts and reaches terminal fast), a heavy bead barely converges
  //(keeps its launch arc and momentum).
  //
  //The air a droplet feels also ramps from STILL (0) to full wind for IMPACT spray: it is
  //knocked off a solid and arcs ballistically before the wind grabs it (early couple~0 →
  //drag damps its launch toward zero, so the up-arc reads), then the wind ramps in and
  //carries the survivors. Crest mist couples instantly.
  const windX = ctx.windX || 0.0;
  const windZ = ctx.windZ || 0.0;
  const impactRamp = this.impactWindRampTime;
  //Wind GRAB: as the wind climbs toward a gale it overpowers each drop's own ballistics. windGrab
  //(0 below windGrabStart, 1 at windGrabFull/hurricane) lifts EVERY particle's wind coupling toward
  //full and its drag toward mist-fast, so the field stops arcing and streams bodily downwind.
  const windSpeed = Math.sqrt(windX * windX + windZ * windZ);
  let windGrab = (windSpeed - this.windGrabStart) / Math.max(0.001, this.windGrabFull - this.windGrabStart);
  windGrab = windGrab < 0.0 ? 0.0 : (windGrab > 1.0 ? 1.0 : windGrab);
  windGrab = windGrab * windGrab * (3.0 - 2.0 * windGrab); //smoothstep
  let n = this.liveCount;
  let i = 0;
  while(i < n){
    age[i] += dt;
    if(age[i] >= life[i]){
      //Swap-remove: move last live particle into slot i, shrink, retry i.
      const last = n - 1;
      if(i !== last){
        const di = i * 3, dl = last * 3;
        pos[di] = pos[dl]; pos[di + 1] = pos[dl + 1]; pos[di + 2] = pos[dl + 2];
        vel[di] = vel[dl]; vel[di + 1] = vel[dl + 1]; vel[di + 2] = vel[dl + 2];
        age[i] = age[last]; life[i] = life[last];
        sizes[i] = sizes[last]; seeds[i] = seeds[last]; types[i] = types[last];
        coarseArr[i] = coarseArr[last];
      }
      n--;
      continue;
    }
    const p3 = i * 3;
    //Ballistic integrate with air drag toward the FELT air velocity. Everything below is
    //per-particle by coarseness (cz): drag (terminal velocity), wind coupling, gravity.
    const cz = coarseArr[i];
    //Air drag sets terminal velocity: fine mist has HIGH drag (sheds its launch fast,
    //reaches the wind/terminal quickly, then hangs and drifts); a heavy bead has LOW drag
    //(keeps momentum, flies out to build the crest, then falls under gravity).
    let drag = dragMist + (dragBead - dragMist) * cz;
    //A gale converges even heavy beads to the wind fast (drag -> mist-fast).
    drag += (dragMist - drag) * windGrab;
    //Wind coupling: fine mist catches the full breeze, a heavy bead only a fraction
    //(coarseWindCouple). Impact spray (type 1) still ramps its felt wind in over
    //impactWindRampTime so it arcs up ballistically first; crest mist feels wind at once.
    let couple = 1.0 - (1.0 - this.coarseWindCouple) * cz;
    if(types[i] > 0.5){
      let ramp = impactRamp > 0.0 ? age[i] / impactRamp : 1.0;
      if(ramp > 1.0) ramp = 1.0;
      couple *= ramp;
    }
    //...but a gale overrides even the heavy-bead fraction AND the impact arc-ramp: at hurricane
    //force the felt wind is the FULL wind, so the spray is torn away the instant it is born.
    couple += (1.0 - couple) * windGrab;
    const fwX = windX * couple, fwZ = windZ * couple;
    //Gravity scales with coarseness (fine mist hangs, a bead falls) AND a small seed-based
    //jitter, so neighbouring drops fall at visibly different speeds.
    const gFac = (this.mistGravityFactor + (1.0 - this.mistGravityFactor) * cz) * (0.75 + 0.5 * seeds[i]);
    vel[p3] = fwX + (vel[p3] - fwX) * drag;
    vel[p3 + 1] = (vel[p3 + 1] - this.gravity * gFac * dt) * drag;
    vel[p3 + 2] = fwZ + (vel[p3 + 2] - fwZ) * drag;
    pos[p3] += vel[p3] * dt;
    pos[p3 + 1] += vel[p3 + 1] * dt;
    pos[p3 + 2] += vel[p3 + 2] * dt;
    //Re-absorbed once it falls (descending) back to the surface it lands on: the
    //WATER we see in open sea, or the LAND where terrain rises above the water
    //(shore spray arcs up a rock and dies ON the rock, instead of sinking through
    //it to the distant waterline). killY = whichever surface is higher here.
    if(field){
      let killY = this._surfaceHeight(field, pos[p3], pos[p3 + 2], field.currentTimeSeconds);
      if(this._terrain){
        const tY = this.sampleTerrainHeight(pos[p3], pos[p3 + 2]);
        if(tY !== null && tY > killY) killY = tY;
      }
      //Droplets punch through the surface a little before dying (they splash, they do not blink
      //out at the waterline); mist (coarse ~0) still dies right at the surface. Sink margin is a
      //few particle radii scaled by coarseness.
      const sink = this.dropSinkDepth * sizes[i] * coarseArr[i];
      if(pos[p3 + 1] < killY - sink && vel[p3 + 1] < 0.0){
        const last = n - 1;
        if(i !== last){
          const di = i * 3, dl = last * 3;
          pos[di] = pos[dl]; pos[di + 1] = pos[dl + 1]; pos[di + 2] = pos[dl + 2];
          vel[di] = vel[dl]; vel[di + 1] = vel[dl + 1]; vel[di + 2] = vel[dl + 2];
          age[i] = age[last]; life[i] = life[last];
          sizes[i] = sizes[last]; seeds[i] = seeds[last]; types[i] = types[last];
          coarseArr[i] = coarseArr[last];
        }
        n--;
        continue;
      }
    }
    age01[i] = age[i] / life[i];
    i++;
  }
  this.liveCount = n;

  this._posAttr.needsUpdate = true;
  this._sizeAttr.needsUpdate = true;
  this._ageAttr.needsUpdate = true;
  this._seedAttr.needsUpdate = true;
  this._typeAttr.needsUpdate = true;
  this._coarseAttr.needsUpdate = true;
  this.geometry.setDrawRange(0, n);
};

//── Nested-element config (a-starry-sky-style authoring) ───────────────────────
//<a-restless-ocean> accepts grouped child elements as a more legible alternative
//to one long flat ocean-state attribute string — the same idea a-starry-sky uses
//with <sky-time>, <sky-lighting>, etc. The children are inert HTML (no component
//is registered for them) that we read once at init and OVERLAY onto this.data, so
//OceanGrid keeps reading the same flat keys. Authoring example:
//
//   <a-restless-ocean>
//     <ocean-water type="5" chop="1.0" wind="0 3" height-offset="6"></ocean-water>
//     <ocean-foam enabled="true" start="0.1"></ocean-foam>
//     <ocean-splash capacity="24000" impact-min-launch="9"></ocean-splash>
//   </a-restless-ocean>
//
//Flat ocean-state="..." still works and acts as the default layer; any nested
//element attribute overrides it. Nested config is read at init only (static
//scene authoring), matching how a-starry-sky consumes its tags.

//Map each config element's kebab-case attributes to the flat ocean-state schema
//key they overlay. <ocean-splash> is handled separately (any knob, kebab->camel).
ARestlessOcean.OCEAN_CONFIG_ELEMENTS = {
  'ocean-water': {
    'type': 'water_type',
    'absorption': 'water_absorption',
    'scattering': 'water_scattering',
    'chop': 'chop',
    'height-offset': 'height_offset',
    'wind': 'wind_velocity',
    'jonswap-gamma': 'jonswap_gamma',
    'jonswap-fetch': 'jonswap_fetch',
    'directional-turbulence': 'directional_turbulence',
    'draw-distance': 'draw_distance',
    'patch-size': 'patch_size',
    'patch-data-size': 'patch_data_size',
    'wave-scale-multiple': 'wave_scale_multiple',
    'number-of-octaves': 'number_of_octaves'
  },
  'ocean-foam': {
    'enabled': 'foam_enabled',
    'start': 'foam_start',
    'color-map': 'foam_color_map',
    'opacity-map': 'foam_opacity_map',
    'normal-map': 'foam_normal_map',
    'camera-height': 'foam_camera_height'
  },
  'ocean-caustics': {
    'enabled': 'caustics_enabled',
    'strength': 'caustics_strength',
    'map': 'caustics_map'
  },
  'ocean-reflection': {
    'scale': 'reflection_scale',
    'distance-falloff': 'reflection_distance_falloff',
    'fresnel-distance-roughness': 'fresnel_distance_roughness'
  },
  'ocean-atmosphere': {
    'enabled': 'atmospheric_perspective_enabled',
    'distance-scale': 'atmospheric_perspective_distance_scale',
    'sky-provider': 'sky_provider'
  },
  'ocean-shadow': {
    'sun-bias': 'sun_shadow_bias'
  }
};

//The config child elements are inert unknown HTML tags, so until our JS reads
//them the browser renders their text-content values as raw inline text — a brief
//"5 1.0 0 3 …" flash on first paint. Inject a stylesheet that hides them, the way
//a-starry-sky hides its own <sky-*> tags. Hiding the group/structural elements is
//enough: display:none cascades, so every nested value tag (and the <ocean-splash-*>
//knobs) goes with its parent. Runs once at script load, before <body> is parsed.
ARestlessOcean.injectConfigElementStyle = function(){
  if(typeof document === 'undefined') return;
  const head = document.head || document.documentElement;
  if(!head || document.getElementById('a-restless-ocean-config-style')) return;
  const tags = Object.keys(ARestlessOcean.OCEAN_CONFIG_ELEMENTS).concat(['ocean-splash', 'ocean-assets-dir']);
  const style = document.createElement('style');
  style.id = 'a-restless-ocean-config-style';
  style.textContent = tags.join(',') + '{display:none !important;}';
  head.appendChild(style);
};
ARestlessOcean.injectConfigElementStyle();

//── Value-tag authoring (a-starry-sky text-content style) ──────────────────────
//The same settings as OCEAN_CONFIG_ELEMENTS, but expressed the way a-starry-sky
//does it: one <ocean-*> child element per value, the value held as that element's
//text content, e.g.
//   <ocean-water>
//     <ocean-water-type>5</ocean-water-type>
//     <ocean-chop>1.0</ocean-chop>
//     <ocean-wind>0 3</ocean-wind>
//   </ocean-water>
//Leaf names follow a-starry-sky's flat <sky-*> namespace, not the group path:
//distinctive settings drop the group noun (<ocean-chop>, <ocean-wind>), generic
//ones keep it so they stay globally unique (<ocean-foam-enabled>,
//<ocean-caustics-strength>). This is a flat map (leaf tag -> flat schema key); the
//grouping element it sits under is purely organisational. Value tags override the
//group element's attributes, which override the flat ocean-state string.
ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS = {
  //<ocean-water>
  'ocean-water-type': 'water_type',
  'ocean-water-absorption': 'water_absorption',
  'ocean-water-scattering': 'water_scattering',
  'ocean-chop': 'chop',
  'ocean-height-offset': 'height_offset',
  'ocean-wind': 'wind_velocity',
  'ocean-jonswap-gamma': 'jonswap_gamma',
  'ocean-jonswap-fetch': 'jonswap_fetch',
  'ocean-directional-turbulence': 'directional_turbulence',
  'ocean-draw-distance': 'draw_distance',
  'ocean-patch-size': 'patch_size',
  'ocean-patch-data-size': 'patch_data_size',
  'ocean-wave-scale-multiple': 'wave_scale_multiple',
  'ocean-number-of-octaves': 'number_of_octaves',
  //<ocean-foam>
  'ocean-foam-enabled': 'foam_enabled',
  'ocean-foam-start': 'foam_start',
  'ocean-foam-color-map': 'foam_color_map',
  'ocean-foam-opacity-map': 'foam_opacity_map',
  'ocean-foam-normal-map': 'foam_normal_map',
  'ocean-foam-camera-height': 'foam_camera_height',
  //<ocean-caustics>
  'ocean-caustics-enabled': 'caustics_enabled',
  'ocean-caustics-strength': 'caustics_strength',
  'ocean-caustics-map': 'caustics_map',
  //<ocean-reflection>
  'ocean-reflection-scale': 'reflection_scale',
  'ocean-reflection-distance-falloff': 'reflection_distance_falloff',
  'ocean-fresnel-distance-roughness': 'fresnel_distance_roughness',
  //<ocean-atmosphere>
  'ocean-atmosphere-enabled': 'atmospheric_perspective_enabled',
  'ocean-atmosphere-distance-scale': 'atmospheric_perspective_distance_scale',
  'ocean-sky-provider': 'sky_provider',
  //<ocean-shadow>
  'ocean-shadow-sun-bias': 'sun_shadow_bias'
};

//── Bundled asset resolution (a-starry-sky <sky-assets-dir> style) ─────────────
//Textures resolve through a nested <ocean-assets-dir> tree instead of four
//hardcoded per-texture paths — set the folder once and flag which sub-dir holds
//which asset group, exactly like a-starry-sky's <sky-assets-dir dir="moon" moon-path>:
//   <ocean-assets-dir dir="image-dir/a-water-assets">
//     <ocean-assets-dir dir="foam" foam-path></ocean-assets-dir>
//     <ocean-assets-dir dir="." caustics-path></ocean-assets-dir>
//   </ocean-assets-dir>
//ASSET_FILENAMES is the single source of truth for the bundled filenames (also
//feeds the schema defaults below via defaultAssetPath). A *-path flag resolves
//every filename in its group under the joined dir.
ARestlessOcean.DEFAULT_ASSET_DIR = './image-dir/a-water-assets';
ARestlessOcean.ASSET_FILENAMES = {
  //flagged with foam-path: the three bundled foam textures
  foam: {
    'foam_color_map': 'Foam002_1K_Color.png',
    'foam_opacity_map': 'Foam002_1K_Opacity.png',
    'foam_normal_map': 'Foam002_1K_NormalGL.png'
  },
  //flagged with caustics-path: the caustic projection texture
  caustics: {
    'caustics_map': 'caustic-map.webp'
  }
};

//Flat set of every schema key that names a bundled texture (derived from
//ASSET_FILENAMES) — used to detect an explicit per-texture override so the
//<ocean-assets-dir> resolution never clobbers it.
ARestlessOcean.ASSET_KEYS = (function(){
  const set = {};
  for(const group in ARestlessOcean.ASSET_FILENAMES){
    for(const key in ARestlessOcean.ASSET_FILENAMES[group]){ set[key] = true; }
  }
  return set;
})();

//Schema default path for a texture key: DEFAULT_ASSET_DIR + the bundled filename.
ARestlessOcean.defaultAssetPath = function(key){
  for(const group in ARestlessOcean.ASSET_FILENAMES){
    const names = ARestlessOcean.ASSET_FILENAMES[group];
    if(names[key]){ return ARestlessOcean.DEFAULT_ASSET_DIR + '/' + names[key]; }
  }
  return '';
};

//Join path segments with single slashes, dropping leading ./ or /, trailing /,
//and bare '.' segments so dir="." (asset lives in the parent dir) collapses away.
ARestlessOcean.joinPath = function(){
  const parts = [];
  for(let i = 0; i < arguments.length; i++){
    let seg = ('' + (arguments[i] === undefined || arguments[i] === null ? '' : arguments[i])).trim();
    seg = seg.replace(/^\.?\/+/, '').replace(/\/+$/, '');
    if(seg === '' || seg === '.'){ continue; }
    parts.push(seg);
  }
  return parts.join('/');
};

//Resolve one <ocean-assets-dir> tree onto data's texture keys. base = the root
//element's dir; each nested <ocean-assets-dir> with a *-path flag resolves its
//group's filenames under join(base, sub). With no flagged children the base dir
//itself is taken to hold every bundled asset. explicitKeys (keys already set by an
//attribute/value-tag override) are skipped so an explicit path always wins.
ARestlessOcean.applyAssetDir = function(data, rootEl, explicitKeys){
  explicitKeys = explicitKeys || {};
  const base = rootEl.getAttribute('dir') || '';
  const targets = [];
  const kids = rootEl.children;
  for(let i = 0; i < kids.length; i++){
    const kid = kids[i];
    if(!kid.tagName || kid.tagName.toLowerCase() !== 'ocean-assets-dir'){ continue; }
    const dir = ARestlessOcean.joinPath(base, kid.getAttribute('dir') || '');
    if(kid.hasAttribute('foam-path')){ targets.push({group: 'foam', dir: dir}); }
    if(kid.hasAttribute('caustics-path')){ targets.push({group: 'caustics', dir: dir}); }
  }
  if(targets.length === 0){
    const baseDir = ARestlessOcean.joinPath(base);
    for(const group in ARestlessOcean.ASSET_FILENAMES){ targets.push({group: group, dir: baseDir}); }
  }
  for(let i = 0; i < targets.length; i++){
    const names = ARestlessOcean.ASSET_FILENAMES[targets[i].group];
    for(const key in names){
      if(explicitKeys[key]){ continue; }
      data[key] = ARestlessOcean.joinPath(targets[i].dir, names[key]);
    }
  }
};

//Coerce a raw HTML attribute string to bool / number / vec2 / vec3 / string,
//mirroring A-Frame's own attribute typing so overlays match schema field types.
ARestlessOcean.coerceConfigValue = function(raw){
  if(raw === null || raw === undefined) return raw;
  const t = ('' + raw).trim();
  if(t === 'true') return true;
  if(t === 'false') return false;
  const parts = t.split(/[\s,]+/).filter(function(s){ return s.length > 0; });
  if(parts.length > 1){
    const nums = parts.map(Number);
    if(nums.every(function(n){ return !isNaN(n); })){
      if(nums.length === 2) return {x: nums[0], y: nums[1]};
      return {x: nums[0], y: nums[1], z: nums[2]};
    }
  }
  if(t !== '' && !isNaN(Number(t))) return Number(t);
  return t;
};

ARestlessOcean.kebabToCamel = function(s){
  return s.replace(/-([a-z])/g, function(_, c){ return c.toUpperCase(); });
};

//Read the nested config elements that are direct children of the entity and
//overlay them: structural elements onto component.data (flat schema keys); the
//<ocean-splash> element into component.data.splashConfig (consumed by OceanGrid
//when it builds the OceanSplash system).
ARestlessOcean.applyNestedConfig = function(component){
  const el = component.el;
  const data = component.data;
  if(!el || !el.children) return;
  const maps = ARestlessOcean.OCEAN_CONFIG_ELEMENTS;
  const valueTags = ARestlessOcean.OCEAN_CONFIG_VALUE_TAGS;
  const children = el.children;
  //Texture keys set explicitly here (attribute or value tag) — an <ocean-assets-dir>
  //tree, resolved last, must not clobber them.
  const explicitAssetKeys = {};
  const assetDirEls = [];

  const setKey = function(key, raw){
    data[key] = ARestlessOcean.coerceConfigValue(raw);
    if(ARestlessOcean.ASSET_KEYS[key]){ explicitAssetKeys[key] = true; }
  };

  for(let i = 0; i < children.length; i++){
    const child = children[i];
    const tag = child.tagName ? child.tagName.toLowerCase() : '';
    if(maps[tag]){
      const map = maps[tag];
      //Compact form: values as attributes on the group element.
      for(let a = 0; a < child.attributes.length; a++){
        const attr = child.attributes[a];
        const key = map[attr.name];
        if(key){ setKey(key, attr.value); }
      }
      //a-starry-sky form: <ocean-*> value tags as text-content children. These
      //sit one level under the group element and override its attributes.
      const leaves = child.children;
      for(let g = 0; g < leaves.length; g++){
        const leaf = leaves[g];
        const ltag = leaf.tagName ? leaf.tagName.toLowerCase() : '';
        const key = valueTags[ltag];
        if(key){ setKey(key, leaf.textContent); }
      }
    } else if(tag === 'ocean-splash'){
      const cfg = data.splashConfig || {};
      //Compact form: any OceanSplash knob as a kebab-case attribute.
      for(let a = 0; a < child.attributes.length; a++){
        const attr = child.attributes[a];
        cfg[ARestlessOcean.kebabToCamel(attr.name)] = ARestlessOcean.coerceConfigValue(attr.value);
      }
      //Value-tag form: <ocean-splash-impact-min-launch>9</…> → impactMinLaunch.
      const leaves = child.children;
      for(let g = 0; g < leaves.length; g++){
        const leaf = leaves[g];
        const ltag = leaf.tagName ? leaf.tagName.toLowerCase() : '';
        if(ltag.indexOf('ocean-splash-') === 0){
          const knob = ARestlessOcean.kebabToCamel(ltag.slice('ocean-splash-'.length));
          cfg[knob] = ARestlessOcean.coerceConfigValue(leaf.textContent);
        }
      }
      data.splashConfig = cfg;
    } else if(tag === 'ocean-assets-dir'){
      assetDirEls.push(child);
    }
  }

  //Resolve <ocean-assets-dir> trees last so explicit per-texture paths win.
  for(let i = 0; i < assetDirEls.length; i++){
    ARestlessOcean.applyAssetDir(data, assetDirEls[i], explicitAssetKeys);
  }
};

//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('ocean-state', {
  oceanGrid: null,
  oceanRenderer: null,
  schema: {
    'draw_distance': {type: 'number', default: 10000.0},
    'patch_size': {type: 'number', default: 256.0},
    'patch_data_size': {type: 'number', default: 512.0},
    'wave_scale_multiple': {type: 'number', default: 1.5},
    'number_of_octaves': {type: 'number', default: 512.0},
    'wind_velocity': {type: 'vec2', default: {x: 8.0, y: 5.0}},
    'height_offset': {type: 'number', default: 0.0},
    //Bundled-texture defaults come from ARestlessOcean.ASSET_FILENAMES (single
    //source of truth); override the folder once with an <ocean-assets-dir> tree
    //or an individual path with the matching <ocean-…-map> value tag / attribute.
    'caustics_map': {type: 'string', default: ARestlessOcean.defaultAssetPath('caustics_map')},
    'foam_color_map': {type: 'string', default: ARestlessOcean.defaultAssetPath('foam_color_map')},
    'foam_opacity_map': {type: 'string', default: ARestlessOcean.defaultAssetPath('foam_opacity_map')},
    'foam_normal_map': {type: 'string', default: ARestlessOcean.defaultAssetPath('foam_normal_map')},
    //Height (m) of the foam + exclusion ortho cameras above rest water plane.
    //Raise above your tallest island/cliff or its top gets clipped.
    'foam_camera_height': {type: 'number', default: 100.0},
    'caustics_enabled': {type: 'bool', default: true},
    'caustics_strength': {type: 'number', default: 1.0},
    'foam_enabled': {type: 'bool', default: true},
    'foam_start': {type: 'number', default: 0.10},
    //Jerlov water type preset selector. 0 = custom (use the explicit
    //water_absorption/water_scattering vec3 attributes below). 1..7 picks a
    //preset from ARestlessOcean.JERLOV_PRESETS in ocean-grid.js — open-ocean
    //types 1..4, coastal types 5..7. See that table for the (a, b) values
    //and a per-type description.
    'water_type': {type: 'number', default: 0},
    //Custom absorption/scattering in m^-1, used only when water_type == 0.
    //Tropical-clean preset from the 2026-05-14 water-review SUMMARY, sitting
    //just under Pope & Fry 1997 pure-water (R=0.35, G=0.045, B=0.011) at RGB
    //sampling wavelengths. Wavelength-flat scattering at clean-ocean magnitude.
    //Yields albedo ≈(0.016, 0.080, 0.333) — navy body, red-heavy extinction so
    //deep water reads blue. Keep in sync with water-shader-template.txt.
    'water_absorption': {type: 'vec3', default: {x: 0.30, y: 0.057, z: 0.010}},
    'water_scattering': {type: 'vec3', default: {x: 0.005, y: 0.005, z: 0.005}},
    //Sky-reflection attenuators. 1.0 = full HDR sky reflection (current physical
    //value, can look unrealistically bright vs photo). reflection_distance_falloff
    //subtracts additional reflection at horizon-ish distances to fake the
    //statistical roughness convolution real water provides at range.
    'reflection_scale': {type: 'number', default: 1.0},
    'reflection_distance_falloff': {type: 'number', default: 0.0},
    //Distance-based Fresnel grazing-peak cap (Kulla-Conty-style roll-off).
    //0 = no effect. 0.85 ≈ ocean-photo-like horizon.
    'fresnel_distance_roughness': {type: 'number', default: 0.85},
    'atmospheric_perspective_enabled': {type: 'bool', default: true},
    'atmospheric_perspective_distance_scale': {type: 'number', default: 1.0},
    //Who provides the sky/atmosphere this ocean integrates with.
    //  'auto'         — detect at runtime: if an <a-starry-sky> element is in
    //                   the page (or the StarrySky global is registered) use it,
    //                   otherwise run standalone. The default; "drop it in and
    //                   it figures itself out."
    //  'a-starry-sky' — force the a-starry-sky path (wait for its reserved fog
    //                   slot; never install our own).
    //  'standalone'   — force standalone even if a-starry-sky is on the page:
    //                   install our own minimal underwater-fog scaffold so the
    //                   seabed murk works off a plain DirectionalLight +
    //                   HemisphereLight, no atmosphere dependency.
    'sky_provider': {type: 'string', default: 'auto'},
    'jonswap_gamma': {type: 'number', default: 3.3},
    'jonswap_fetch': {type: 'number', default: 100000.0},
    //Directional spreading turbulence: 0 = pure cos²(θ) (waves aligned to wind),
    //1 = isotropic. Crest default 0.145 — enough cross-wind chop to avoid the
    //parallel-streak look without losing wind direction.
    'directional_turbulence': {type: 'number', default: 0.145},
    'chop': {type: 'number', default: 1.0},
    //Additive offset applied on top of the scene DirectionalLight's
    //shadow.bias when the water shader samples the sun shadow map.
    //Negative pushes water-receiver refZ TOWARD the light (less shadow);
    //positive pushes it AWAY (more shadow, helps surface ledges of small
    //caster). The default -0.0012 cancels a depth-fight stripe seen at
    //grazing sun where submerged terrain just below the water surface
    //was shadowing the water itself (world-Y deltas of ~1 m collapse to
    //sub-bias deltas in shadow space at near-horizon sun). Tune via the
    //live setSunShadowBias() console hook.
    'sun_shadow_bias': {type: 'number', default: -0.0012}
    //Splash/spray is configured via the nested <ocean-splash> child element
    //(see ARestlessOcean.OCEAN_CONFIG_ELEMENTS above), not a flat attribute —
    //its ~100 art-direction knobs would swamp this schema. Any OceanSplash knob
    //is settable there by its kebab-case name (impact-min-launch, shore-jet-scale,
    //…) and stays live-editable at runtime via window.oceanSplash.
  },
  init: function(){
    //Overlay any nested config child elements (<ocean-water>, <ocean-splash>, …)
    //onto this.data BEFORE OceanGrid reads it (the grid captures data by reference
    //in its constructor), so grouped XML authoring and the flat attribute string
    //feed the exact same state.
    ARestlessOcean.applyNestedConfig(this);

    //Get our renderer to pass in
    let renderer = this.el.sceneEl.renderer;
    let scene = this.el.sceneEl.object3D;
    let camera = this.el.sceneEl.camera;
    let self = this;

    //Update the position of the objects
    scene.updateMatrixWorld();

    //Set up our ocean grid
    this.oceanGrid = new ARestlessOcean.OceanGrid(scene, renderer, camera, this);

    //When we've finished loading, now we can commence ticking our grid
    this.tick = function(time, timeDelta){
      this.oceanGrid.tick(time);
    }
  },
  update: function(oldData){
    if(!this.oceanGrid) return;
    if(oldData.wind_velocity &&
       (oldData.wind_velocity.x !== this.data.wind_velocity.x ||
        oldData.wind_velocity.y !== this.data.wind_velocity.y)){
      this.oceanGrid.oceanHeightBandLibrary.regenerateH0(this.data.wind_velocity);
    }
  },
  tick: function(time, timeDelta){
    //Do nothing to start :D
  }
});

//<a-restless-ocean> is the a-water public-API primitive — a single tag that
//wires up the OceanGrid system on a regular A-Frame entity. The name
//mirrors how a-starry-sky exposes <a-starry-sky>: a descriptive adjective
//("restless" for the always-moving FFT wave field, like "starry" for the
//star-filled sky) prefixed to the natural element it renders. The chosen
//adjective also dodges a name clash with A-Frame core's built-in <a-ocean>
//(a stylized animated wave plane with mapping keys amplitudeVariance /
//speedVariance), so no override gymnastics are needed.
//
//Configuration is read at init by ocean-state.applyNestedConfig in three layers
//(each overrides the one before it):
//  1. the flat  ocean-state="key: value; ..."  attribute (default layer)
//  2. grouped child elements with values as ATTRIBUTES (compact):
//       <ocean-water type="5" chop="1.0" wind="0 3"></ocean-water>
//  3. the same grouped elements with values as a-starry-sky-style TEXT-CONTENT
//     child tags (most legible, wins):
//       <ocean-water><ocean-chop>1.0</ocean-chop><ocean-wind>0 3</ocean-wind></ocean-water>
//Groups: <ocean-water> <ocean-foam> <ocean-caustics> <ocean-reflection>
//        <ocean-atmosphere> <ocean-shadow>, and <ocean-splash> (any OceanSplash
//knob by kebab-case name / <ocean-splash-*> tag). See OCEAN_CONFIG_ELEMENTS
//(attribute map) and OCEAN_CONFIG_VALUE_TAGS (value-tag map) in ocean-state.js.
//
//Textures resolve through a nested <ocean-assets-dir> tree, like a-starry-sky's
//<sky-assets-dir> — set the folder once and flag the sub-dirs:
//  <ocean-assets-dir dir="image-dir/a-water-assets">
//    <ocean-assets-dir dir="foam" foam-path></ocean-assets-dir>
//    <ocean-assets-dir dir="." caustics-path></ocean-assets-dir>
//  </ocean-assets-dir>
AFRAME.registerPrimitive('a-restless-ocean', {
  defaultComponents: {
    'ocean-state': {}
  }
});

//The party responcible for updating our view of the fluid system
AFRAME.registerComponent('ocean-static-mask', {
  schema: {},
  init: function(){
    const maskMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: false,
      colorWrite: false,
    });
    let mesh = this.el.getObject3D('mesh');
    mesh.traverse( node => {
        if(!node.isMesh){
           return;
        }
        node.material = maskMaterial;
    });
  },
  tick: null
});

//=============================================================================
// buoyant — float an entity on the analytic ocean wave field.
//=============================================================================
//
// Two solvers, picked with `solver:`:
//
//   rigid  (default) — a real force-based buoyancy integrator. We sample the
//     submerged volume of the object column-by-column over its footprint and
//     apply Archimedes' force (ρ_water·g·V_submerged) against gravity, plus the
//     righting TORQUE that arises because the deeper side of a tilted hull gets
//     pushed up harder. So a body finds its own waterline from its `density`,
//     bobs, and rocks/rights itself in a swell — genuine physics, not a fake.
//     What keeps it from the classic exploding-rigid-body failure ("BOING") is
//     an ENERGY GOVERNOR: drag is physically ~quadratic (form drag) and we
//     additionally scale it by the body's instantaneous mechanical energy, so
//     calm bodies float freely while energetic ones get bled hard at the
//     extremes. That governor — plus implicit (unconditionally stable) damping
//     and hard velocity/tilt clamps — is what lets us run real torque physics on
//     whatever geometry/scale a player throws in without it x-flipping into
//     orbit.
//
//   kinematic — the forgiving plane-fit fallback. No forces: we fit a plane
//     through the sampled water heights under the probes and drive position +
//     tilt toward it (damped), with a gravity/spring ENTRY phase so a dropped or
//     submerged object falls/rises onto the surface before latching to wave
//     tracking. Can't tip or oscillate; good for a buoy or a "junk geometry"
//     prop where you never want surprises.
//
// Probe layout (the footprint we sample over) comes from a sibling
// `buoyancy-hull` component if present, else it's auto-derived from the object's
// bounding box (4 footprint corners). Bare `buoyant` on any model Just Works.
//
// ASSUMPTION: the entity is a direct child of the scene (its object3D transform
// is world space). That covers the common "prop floating on the sea" case. If
// you nest it under a moving rig, parent-relative handling isn't done yet.
//
// Needs the ocean's analytic field (ocean-wave-field.js) live at
// ARestlessOcean.waveField; until the ocean finishes booting, tick no-ops.

AFRAME.registerComponent('buoyancy-hull', {
  schema: {
    //Local-space probe footprint as "x z, x z, ..." (metres, object local XZ
    //before scale). Empty → auto: 4 corners of the bounding-box footprint.
    'points': {type: 'string', default: ''},
    //Pull auto bbox corners inward by this factor so probes sit on the hull,
    //not out past the bowsprit/overhang. 1 = exact corners.
    'inset': {type: 'number', default: 0.85}
  },
  init: function(){
    this.localProbes = null; //Array<{x, z}> resolved lazily (model loads async).
    this.parseExplicit();
    //Re-resolve the auto bbox whenever the model swaps in.
    this.el.addEventListener('object3dset', () => { if(!this.explicit) this.localProbes = null; });
    this.el.addEventListener('model-loaded', () => { if(!this.explicit) this.localProbes = null; });
  },
  update: function(){
    this.parseExplicit();
  },
  parseExplicit: function(){
    const raw = (this.data.points || '').trim();
    if(raw.length === 0){ this.explicit = false; this.localProbes = null; return; }
    const probes = [];
    raw.split(',').forEach((pair) => {
      const t = pair.trim().split(/\s+/).map(parseFloat);
      if(t.length >= 2 && isFinite(t[0]) && isFinite(t[1])){ probes.push({x: t[0], z: t[1]}); }
    });
    this.explicit = probes.length > 0;
    this.localProbes = this.explicit ? probes : null;
  },
  //Resolve (and cache) the local-space probe XZ list. Returns null until a
  //non-empty bounding box is available (async model still loading).
  getLocalProbes: function(){
    if(this.localProbes) return this.localProbes;
    const box = new THREE.Box3().setFromObject(this.el.object3D);
    if(box.isEmpty()) return null;
    //Bounding box is in WORLD units; convert footprint half-extents back to the
    //object's LOCAL frame so probes ride with its scale/yaw at sample time.
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const inv = new THREE.Matrix4().copy(this.el.object3D.matrixWorld).invert();
    const corners = [
      new THREE.Vector3(center.x + size.x * 0.5, center.y, center.z + size.z * 0.5),
      new THREE.Vector3(center.x - size.x * 0.5, center.y, center.z + size.z * 0.5),
      new THREE.Vector3(center.x + size.x * 0.5, center.y, center.z - size.z * 0.5),
      new THREE.Vector3(center.x - size.x * 0.5, center.y, center.z - size.z * 0.5)
    ];
    const inset = this.data.inset;
    this.localProbes = corners.map((c) => {
      c.applyMatrix4(inv);
      return {x: c.x * inset, z: c.z * inset};
    });
    return this.localProbes;
  }
});

AFRAME.registerComponent('buoyant', {
  //buoyancy-hull is optional but, if present, supplies the probe footprint.
  dependencies: [],
  schema: {
    'enabled': {type: 'boolean', default: true},
    //'rigid' = force-based Archimedes + torque (real physics, energy-governed).
    //'kinematic' = forgiving plane-fit + spring entry (can't tip or ring).
    'solver': {type: 'string', default: 'rigid'},
    //Where height samples come from (rigid solver):
    //  'fft' (default) = the EXACT rendered surface via the cached local height
    //               field (ocean-grid: a small camera-following RT, one tiny
    //               async read/frame shared by every float). Rides the water you
    //               SEE. Outside that region (far from camera) or before it
    //               resolves, falls back to analytic PER SAMPLE automatically.
    //  'analytic' = the CPU Gerstner twin (ocean-wave-field.js): ~46 cos across
    //               all cascades, ZERO GPU readback, worker/headless-friendly and
    //               the seam a future SIMD/WASM accel slots under — but its
    //               crests are phase-decoupled, so a float hovers over rendered
    //               troughs on big swell. Use for crowds / far-field / no-GPU.
    'source': {type: 'string', default: 'fft'},
    //Explicit body box dimensions "x y z" in LOCAL units (same convention as
    //`geometry` width/height/depth — the entity's scale is applied on top). This
    //drives the mass/volume/inertia AND the auto probe footprint, so you can size
    //the float exactly instead of trusting the bounding box. 0 0 0 (default) =
    //auto: read a box `geometry` if the entity has one, else fall back to the
    //world bounding box. So set `geometry` and `size` to the same numbers (or
    //just set `geometry` and let it bind) and the mesh + physics stay in lockstep.
    'size': {type: 'vec3', default: {x: 0, y: 0, z: 0}},
    //Density RELATIVE to water. <1 floats; the body settles with this fraction
    //of its volume submerged (0.5 ⇒ half under). 1 = neutrally buoyant; >1 sinks.
    'density': {type: 'number', default: 0.5},
    //Gravitational acceleration (m/s²). Drives both the rigid weight and the
    //kinematic entry free-fall.
    'gravity': {type: 'number', default: 9.8},
    //Apply pitch/roll. rigid: enables righting torque. kinematic: tilt to slope.
    //Off = pure bob (buoy).
    'tilt': {type: 'boolean', default: true},
    //Clamp total tilt away from upright (degrees). A hard safety wall; on hit we
    //also bleed angular energy so it doesn't pump against the clamp.
    'maxTilt': {type: 'number', default: 25.0},

    //--- rigid-solver drag / energy governor ---------------------------------
    //Linear viscous drag (1/s): gentle damping that's always present.
    'linearDrag': {type: 'number', default: 0.8},
    //Linear FORM drag (per m/s): the quadratic, fluid-like term that bites hard
    //at speed — this is most of what kills vertical "BOING".
    'formDrag': {type: 'number', default: 0.25},
    //Angular viscous + form drag, same idea for pitch/roll.
    'angularDrag': {type: 'number', default: 1.2},
    'angularFormDrag': {type: 'number', default: 0.4},
    //Energy-governor gain. Drag is multiplied by (1 + energyDamping · E/E_ref),
    //so the more mechanical energy the body carries, the more it's dissipated at
    //the extremes. 0 = pure (quadratic) fluid drag, no governor. This is the
    //artificial energy reduction that keeps the solver tame on bad input.
    'energyDamping': {type: 'number', default: 0.6},

    //--- kinematic-solver knobs (ignored by rigid) ---------------------------
    //Vertical origin offset vs. the surface at rest (metres).
    'draft': {type: 'number', default: 0.0},
    //Plane-follow response time constant (seconds).
    'damping': {type: 'number', default: 0.25},
    //Entry-phase bob period (seconds) of the spring that lifts a submerged body.
    'bobPeriod': {type: 'number', default: 1.6}
  },
  init: function(){
    //Reusable scratch so tick allocates nothing.
    this._up = new THREE.Vector3(0, 1, 0);
    this._n = new THREE.Vector3(0, 1, 0);
    this._nrm = new THREE.Vector3();
    this._euler = new THREE.Euler();
    this._scratchV = new THREE.Vector3();
    this._axis = new THREE.Vector3(1, 0, 0);
    this._dq = new THREE.Quaternion();
    this._qIdent = new THREE.Quaternion();
    this._qTilt = new THREE.Quaternion();
    this._qPhysTilt = new THREE.Quaternion(); //rigid: accumulated tilt-from-up.
    this._qTarget = new THREE.Quaternion();
    //Authored orientation (heading + model base) we tilt ON TOP of.
    this._baseQuat = this.el.object3D.quaternion.clone();

    //Rigid state.
    this._vy = 0.0;            //vertical velocity (m/s).
    this._wx = 0.0; this._wz = 0.0; //angular velocity about world x / z (rad/s).
    this._body = null;         //cached mass/volume/inertia (see _ensureBody).

    //Kinematic state.
    this._started = false;     //first valid sample snaps; afterwards we damp.
    this._settled = false;     //latched true once the entry phase comes to rest.
    this._buoyStiffness = 0.0;

    //Wave-impact splash state. Splashing is CONTINUOUS — a floating body throws spray whenever
    //the water washes up over it fast, NOT only on a one-time air->water entry (a settled body
    //tracks the surface and essentially never leaves it, so an entry-crossing test never fires).
    this._prevErr = 0.0;       //last frame's submersion error, for the surface-vs-body closing speed.
    this._splashPrimed = false;//false until the first _detectSplash call seeds _prevErr (no frame-1 spike).
    this._splashCooldown = 0.0;//s remaining before this body may splash again (anti-spam).
    this.splashMinSpeed = 0.6; //m/s closing speed (water rising onto the body) needed to throw spray.
    this.splashCooldownTime = 0.18; //s minimum gap between this body's impact splashes.
    this.splashSpeedCap = 12.0;//m/s cap so a freak frame cannot launch a geyser.
    this.splashContactBand = 0.5;//m: body counts as "in contact" when err > -this (so a floating
                                 //body sprays on wave-slaps, but a body still up in the air mid-fall
                                 //does NOT spray until it actually reaches the water).
  },
  update: function(){
    //Re-capture the authored heading if the user re-set rotation.
    this._baseQuat.copy(this.el.object3D.quaternion);
    //Buoyant-spring stiffness ω² from the desired bob period (kinematic entry).
    const T = Math.max(0.1, this.data.bobPeriod);
    const omega = (2.0 * Math.PI) / T;
    this._buoyStiffness = omega * omega;
    //size/density/gravity feed the cached body + footprint; force a recompute.
    this._body = null;
    this._autoLocal = null;
  },
  //Resolve the body's LOCAL box extents (pre-scale), or null to fall back to the
  //bounding box. Priority: explicit `size` → a box `geometry` component → null.
  _resolveLocalSize: function(){
    const s = this.data.size;
    if(s && (s.x > 0 || s.y > 0 || s.z > 0)){
      return {x: Math.max(1e-3, s.x), y: Math.max(1e-3, s.y), z: Math.max(1e-3, s.z)};
    }
    //Bind to a box geometry if the entity has one (a-box, geometry="primitive:box").
    const geo = this.el.getAttribute('geometry');
    if(geo && (geo.primitive === 'box' || geo.primitive === undefined) &&
       geo.width > 0 && geo.height > 0 && geo.depth > 0){
      return {x: geo.width, y: geo.height, z: geo.depth};
    }
    return null;
  },
  tick: function(time, timeDelta){
    if(!this.data.enabled) return;
    const field = ARestlessOcean.waveField;
    if(!field) return; //ocean not up yet.

    const hull = this.el.components['buoyancy-hull'];
    const local = hull ? hull.getLocalProbes() : this._autoProbes();
    if(!local || local.length === 0) return; //model still loading.

    const obj = this.el.object3D;
    obj.updateMatrixWorld();

    if(this.data.solver === 'kinematic'){
      this._solveKinematic(local, field, obj, time, timeDelta);
    } else {
      this._solveRigid(local, field, obj, time, timeDelta);
    }
  },

  //===========================================================================
  // RIGID — force-based Archimedes buoyancy + righting torque, energy-governed.
  //===========================================================================
  _solveRigid: function(local, field, obj, time, timeDelta){
    const body = this._ensureBody(local.length);
    if(!body) return;

    const t = time / 1000.0;
    //Clamp dt: a long stall (tab-out) must not inject a huge impulse.
    const dt = Math.min(0.05, Math.max(0.0, (timeDelta || 16.7) / 1000.0));
    if(dt <= 0.0) return;

    //Pick the height source once per tick. fft → the cached GPU snapshot (exact
    //rendered surface); keep the snapshot warm by requesting it. Until it
    //resolves (or on a renderer without async readback) sampleWaterHeightFFT
    //returns null and we fall back to the analytic twin per-sample.
    const useFFT = (this.data.source !== 'analytic');
    let fftSampler = null;
    if(useFFT && typeof ARestlessOcean.sampleWaterHeightFFT === 'function'){
      if(typeof ARestlessOcean.requestFFTSnapshot === 'function'){ ARestlessOcean.requestFFTSnapshot(); }
      fftSampler = ARestlessOcean.sampleWaterHeightFFT;
    }

    const com = obj.position; //world centre of mass (direct scene child).
    const v = this._scratchV;
    let Fup = 0.0, Tx = 0.0, Tz = 0.0, submHSum = 0.0, waterYSum = 0.0;

    //Sum buoyancy column-by-column. Each probe owns an equal share of the
    //footprint area; its submerged height × that area is the column's submerged
    //volume → Archimedes force. localToWorld bakes in scale + heading + the
    //CURRENT tilt, so a rolled hull's lower corners read deeper and push back.
    for(let i = 0; i < local.length; i++){
      v.set(local[i].x, 0.0, local[i].z);
      obj.localToWorld(v);
      let waterY = fftSampler ? fftSampler(v.x, v.z) : null;
      if(waterY == null){ waterY = field.sampleHeight(v.x, v.z, t); } //snapshot not ready / analytic.
      waterYSum += waterY;
      //Submerged height of this column, clamped to the body's vertical extent.
      const submH = Math.min(2.0 * body.halfH, Math.max(0.0, waterY - (v.y - body.halfH)));
      submHSum += submH;
      if(submH <= 0.0) continue;
      const Fy = body.rhoG * body.colArea * submH; //upward (N).
      Fup += Fy;
      //Torque about COM from this up-force at lever (rx, rz): τ = r × F.
      const rx = v.x - com.x, rz = v.z - com.z;
      Tx += -rz * Fy;
      Tz +=  rx * Fy;
    }

    //--- Wave-impact splash (before integration, so bodyY is this frame's pre-move
    //    value matching the sampled surface). err = mean water surface across the
    //    footprint minus the COM: closing>0 = the sea washing up onto the body, or
    //    the body slamming down into it on a fall.
    const avgWaterY = waterYSum / local.length;
    this._detectSplash(obj, avgWaterY - com.y, avgWaterY, dt);

    //--- Integrate linear (vertical) + angular (pitch/roll) ------------------
    const weight = body.mass * this.data.gravity;
    this._vy += ((Fup - weight) / body.mass) * dt;
    if(this.data.tilt){
      this._wx += (Tx / body.Ix) * dt;
      this._wz += (Tz / body.Iz) * dt;
    } else {
      this._wx = 0.0; this._wz = 0.0;
    }

    //--- Energy governor + fluid drag (implicit ⇒ unconditionally stable) -----
    //E = ½m·v² + ½(Ix·ωx² + Iz·ωz²). Drag grows with E so the more violently the
    //body is moving the harder it's bled — the "more energy ⇒ more edge damping"
    //model. The quadratic form-drag term is real fluid drag; the energy factor
    //is the explicit stability governor on top.
    //Fluid drag only acts on the SUBMERGED part — air drag is negligible, so a
    //body in free fall must not feel water resistance (that bug made gravity look
    //weak: terminal velocity in "air" was ~5 m/s). dragGate is the submerged
    //fraction (0 airborne → 1 fully under), so it's true free-fall above the
    //surface and full damping once it's in.
    const dragGate = submHSum / (local.length * 2.0 * body.halfH);
    const Ek = 0.5 * body.mass * this._vy * this._vy
             + 0.5 * (body.Ix * this._wx * this._wx + body.Iz * this._wz * this._wz);
    const gov = 1.0 + this.data.energyDamping * (Ek / body.eRef);
    const linC = (this.data.linearDrag + this.data.formDrag * Math.abs(this._vy)) * gov * dragGate;
    const angSpeed = Math.sqrt(this._wx * this._wx + this._wz * this._wz);
    const angC = (this.data.angularDrag + this.data.angularFormDrag * angSpeed) * gov * dragGate;
    this._vy /= (1.0 + linC * dt);
    const angAtt = 1.0 / (1.0 + angC * dt);
    this._wx *= angAtt; this._wz *= angAtt;

    //Hard final guards against pathological input (the last line vs. BOING).
    this._vy = Math.max(-40.0, Math.min(40.0, this._vy));

    //--- Apply ----------------------------------------------------------------
    obj.position.y += this._vy * dt;

    if(this.data.tilt){
      //Accumulate the world-frame tilt from angular velocity this step.
      const wlen = Math.sqrt(this._wx * this._wx + this._wz * this._wz);
      if(wlen > 1e-6){
        this._axis.set(this._wx / wlen, 0.0, this._wz / wlen);
        this._dq.setFromAxisAngle(this._axis, wlen * dt);
        this._qPhysTilt.premultiply(this._dq);
        this._qPhysTilt.normalize();
      }
      //Clamp total tilt; if we hit the wall, bleed angular energy so we don't
      //pump against it.
      const maxAng = this.data.maxTilt * Math.PI / 180.0;
      const tiltAng = 2.0 * Math.acos(Math.min(1.0, Math.abs(this._qPhysTilt.w)));
      if(tiltAng > maxAng && tiltAng > 1e-5){
        this._qIdent.identity();
        this._qPhysTilt.slerp(this._qIdent, 1.0 - maxAng / tiltAng);
        this._wx *= 0.3; this._wz *= 0.3;
      }
      this._qTarget.copy(this._qPhysTilt).multiply(this._baseQuat);
      obj.quaternion.copy(this._qTarget);
    }
  },

  //Wave-impact splash detector shared by BOTH solvers. `err` = waterSurfaceY - bodyY
  //(>0 submerged, <0 in air); `surfaceY` is where to spawn the spray. closing = d(err)/dt
  //is the surface-vs-body relative vertical speed: >0 means the water is rising onto the
  //body faster than the body follows (a wave slapping it) OR the body striking the surface
  //on a fall. We gate on CONTACT (err > -contactBand) so an airborne body mid-fall does not
  //spray until it reaches the water, and on a cooldown to limit the rate. NOT an air->water
  //crossing test: a settled body tracks the surface and never re-crosses, so a crossing
  //test never fired (the original bug). OceanGrid forwards 'buoyancy-splash' to the splash
  //system's emitImpact, so this is the same channel the shore wall spray uses.
  _detectSplash: function(obj, err, surfaceY, dt){
    if(!this._splashPrimed || !(dt > 1e-4)){
      this._splashPrimed = true; this._prevErr = err; return;
    }
    const closing = (err - this._prevErr) / dt;
    this._prevErr = err;
    this._splashCooldown = Math.max(0.0, this._splashCooldown - dt);
    const inContact = err > -this.splashContactBand;
    if(inContact && closing > this.splashMinSpeed && this._splashCooldown <= 0.0){
      this.el.emit('buoyancy-splash', {
        speed: Math.min(closing, this.splashSpeedCap),
        point: {x: obj.position.x, y: surfaceY, z: obj.position.z}
      }, true);
      this._splashCooldown = this.splashCooldownTime;
    }
  },

  //Cache mass / volume / inertia for the rigid solver. Recomputed when the
  //schema changes (density/gravity) or the bbox wasn't ready yet.
  _ensureBody: function(nProbes){
    if(this._body) return this._body;
    //World extents: explicit/geometry LOCAL size × entity scale, else world bbox.
    let sx, sy, sz;
    const localSize = this._resolveLocalSize();
    if(localSize){
      const sc = this.el.object3D.scale;
      sx = Math.max(1e-3, localSize.x * Math.abs(sc.x));
      sy = Math.max(1e-3, localSize.y * Math.abs(sc.y));
      sz = Math.max(1e-3, localSize.z * Math.abs(sc.z));
    } else {
      const box = new THREE.Box3().setFromObject(this.el.object3D);
      if(box.isEmpty()) return null;
      const size = box.getSize(new THREE.Vector3());
      sx = Math.max(1e-3, size.x); sy = Math.max(1e-3, size.y); sz = Math.max(1e-3, size.z);
    }
    const footprint = sx * sz;
    const volume = footprint * sy;
    const RHO_W = 1000.0; //water density (kg/m³); cancels in accelerations but
                          //keeps forces/energy in honest SI units.
    const mass = Math.max(1e-3, this.data.density * RHO_W * volume);
    this._body = {
      halfH: sy * 0.5,
      colArea: footprint / Math.max(1, nProbes),
      mass: mass,
      //Box inertia about world x (pitch) and z (roll) — valid near upright,
      //which maxTilt keeps us within.
      Ix: mass / 12.0 * (sy * sy + sz * sz),
      Iz: mass / 12.0 * (sx * sx + sy * sy),
      rhoG: RHO_W * this.data.gravity,
      //Energy scale ≈ work to lift the body its own half-height. Normalises the
      //governor so its gain is dimensionless and scale-independent.
      eRef: Math.max(1e-3, mass * this.data.gravity * sy * 0.5)
    };
    return this._body;
  },

  //===========================================================================
  // KINEMATIC — forgiving plane-fit + gravity/spring entry. No torque.
  //===========================================================================
  _solveKinematic: function(local, field, obj, time, timeDelta){
    //World position + yaw of the object so probes ride its heading. We read yaw
    //from the authored base quaternion (the current quaternion includes the tilt
    //WE applied last frame, which we don't want feeding back into placement).
    const px = obj.position.x, pz = obj.position.z;
    this._euler.setFromQuaternion(this._baseQuat, 'YXZ');
    const cosY = Math.cos(this._euler.y), sinY = Math.sin(this._euler.y);
    //Probes are stored pre-scale; reapply world scale so the footprint matches.
    const sx = obj.scale.x, sz = obj.scale.z;

    const t = time / 1000.0;
    //Least-squares plane y = a*x + b*z + c through the sampled probe heights.
    let n = 0, Sx = 0, Sz = 0, Sxx = 0, Szz = 0, Sxz = 0, Sy = 0, Sxy = 0, Szy = 0;
    for(let i = 0; i < local.length; i++){
      const lx = local[i].x * sx, lz = local[i].z * sz;
      const wx = px + (lx * cosY + lz * sinY);
      const wz = pz + (-lx * sinY + lz * cosY);
      const wy = field.sampleHeight(wx, wz, t);
      n++; Sx += wx; Sz += wz; Sy += wy;
      Sxx += wx * wx; Szz += wz * wz; Sxz += wx * wz;
      Sxy += wx * wy; Szy += wz * wy;
    }

    let a = 0, b = 0, c = Sy / n;
    if(n >= 3){
      const m11 = Sxx, m12 = Sxz, m13 = Sx;
      const m22 = Szz, m23 = Sz, m33 = n;
      const det = m11 * (m22 * m33 - m23 * m23)
                - m12 * (m12 * m33 - m23 * m13)
                + m13 * (m12 * m23 - m22 * m13);
      if(Math.abs(det) > 1e-9){
        const inv = 1.0 / det;
        a = inv * (Sxy * (m22 * m33 - m23 * m23)
                 - m12 * (Szy * m33 - m23 * Sy)
                 + m13 * (Szy * m23 - m22 * Sy));
        b = inv * (m11 * (Szy * m33 - m23 * Sy)
                 - Sxy * (m12 * m33 - m23 * m13)
                 + m13 * (m12 * Sy - Szy * m13));
        c = inv * (m11 * (m22 * Sy - Szy * m23)
                 - m12 * (m12 * Sy - Szy * m13)
                 + Sxy * (m12 * m23 - m22 * m13));
      }
    }

    const targetY = a * px + b * pz + c + this.data.draft;
    this._n.set(-a, 1.0, -b).normalize();

    const dt = Math.max(0.0, (timeDelta || 16.7) / 1000.0);
    const tau = this.data.damping;
    const k = tau > 1e-4 ? (1.0 - Math.exp(-dt / tau)) : 1.0;

    const err = targetY - obj.position.y; //>0 submerged, <0 in air.

    //── Wave-impact splash (shared with the rigid solver). Runs every frame once started:
    //   a floating body throws spray whenever the water washes up over it fast. See
    //   _detectSplash for the closing-speed / contact / cooldown logic.
    if(this._started){ this._detectSplash(obj, err, targetY, dt); }
    else { this._prevErr = err; }

    //Vertical: gravity/spring ENTRY until settled, then plane FOLLOW.
    if(this.data.gravity > 1e-4 && !this._settled){
      const inAir = err < -1e-3;
      if(inAir){
        this._vy -= this.data.gravity * dt;
      } else {
        this._vy += this._buoyStiffness * err * dt;
        this._vy *= Math.exp(-dt / Math.max(1e-3, tau));
      }
      obj.position.y += this._vy * dt;
      if(Math.abs(err) < 0.06 && Math.abs(this._vy) < 0.08){
        this._settled = true; this._vy = 0.0;
      }
    } else {
      const lerp = this._started ? k : 1.0; //snap on first valid frame.
      obj.position.y += (targetY - obj.position.y) * lerp;
    }

    if(this.data.tilt){
      const lerp = this._started ? k : 1.0;
      let nrm = this._n;
      const dot = Math.min(1.0, Math.max(-1.0, this._up.dot(nrm)));
      const ang = Math.acos(dot);
      const maxAng = this.data.maxTilt * Math.PI / 180.0;
      if(ang > maxAng && ang > 1e-5){
        const s = maxAng / ang;
        nrm = this._nrm.copy(this._n).lerp(this._up, 1.0 - s).normalize();
      }
      this._qTilt.setFromUnitVectors(this._up, nrm);
      this._qTarget.copy(this._qTilt).multiply(this._baseQuat);
      obj.quaternion.slerp(this._qTarget, lerp);
    }

    this._started = true;
  },

  //Auto probe footprint when no buoyancy-hull is attached. Cached; recomputed
  //if the bbox wasn't ready yet (async model).
  _autoProbes: function(){
    if(this._autoLocal) return this._autoLocal;
    const inset = 0.85;
    //Explicit/geometry size → 4 footprint corners directly in LOCAL space (no
    //bbox wait; localToWorld reapplies scale at sample time, like the bbox path).
    const localSize = this._resolveLocalSize();
    if(localSize){
      const hx = localSize.x * 0.5 * inset, hz = localSize.z * 0.5 * inset;
      this._autoLocal = [
        {x:  hx, z:  hz}, {x: -hx, z:  hz}, {x:  hx, z: -hz}, {x: -hx, z: -hz}
      ];
      return this._autoLocal;
    }
    const box = new THREE.Box3().setFromObject(this.el.object3D);
    if(box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const inv = new THREE.Matrix4().copy(this.el.object3D.matrixWorld).invert();
    const corners = [
      new THREE.Vector3(center.x + size.x * 0.5, center.y, center.z + size.z * 0.5),
      new THREE.Vector3(center.x - size.x * 0.5, center.y, center.z + size.z * 0.5),
      new THREE.Vector3(center.x + size.x * 0.5, center.y, center.z - size.z * 0.5),
      new THREE.Vector3(center.x - size.x * 0.5, center.y, center.z - size.z * 0.5)
    ];
    this._autoLocal = corners.map((cc) => {
      cc.applyMatrix4(inv);
      return {x: cc.x * inset, z: cc.z * inset};
    });
    return this._autoLocal;
  }
});
