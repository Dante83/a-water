//This helps
//--------------------------v
//https://github.com/mrdoob/three.js/wiki/Uniforms-types
AWater.AOcean.Materials.Ocean.splashMaterial = {
  uniforms: {
    //Vertex stage
    uViewportHeight: {value: 1080.0},
    uMaxPointSize: {value: 256.0},
    uSizeScale: {value: 1.0},
    sunColor: {value: new THREE.Color(1.0, 1.0, 1.0)},
    skyAmbientColor: {value: new THREE.Color(0.3, 0.4, 0.5)},
    uSunScale: {value: 0.8},
    uAmbientScale: {value: 1.0},

    //Fragment stage
    splashSprite: {value: null},
    uLinearDepth: {value: null},
    uResolution: {value: new THREE.Vector2(1920.0, 1080.0)},
    uSoftRange: {value: 1.5},
    uOpacity: {value: 1.0},
    uDebugMode: {value: 0},
  },

  fragmentShader: [
    'precision highp float;',

    '//Ocean splash particle fragment stage (THREE.Points, GLSL1).',
    '//',
    '//Each point is a camera-facing sprite quad (gl_PointCoord spans 0..1). We',
    '//composite a supplied spray sprite, fade it in/out over the particle lifetime,',
    '//and soft-fade it against scene geometry using the refraction G-buffer linear',
    '//depth so droplets sink into terrain and hulls instead of hard-clipping.',

    'uniform sampler2D splashSprite;   //alpha-bearing droplet/mist sprite',
    'uniform sampler2D uLinearDepth;   //G-buffer attachment 2: positive view-Z, a=hasGeom',
    'uniform vec2 uResolution;         //G-buffer / drawing-buffer size in pixels',
    'uniform float uSoftRange;         //metres over which we soft-fade into geometry',
    'uniform float uOpacity;           //global artistic opacity (FUDGE)',
    'uniform int uDebugMode;           //0 = normal, 1 = tint by emitter type',

    'varying float vAge01;',
    'varying float vSeed;',
    'varying float vType;',
    'varying float vViewZ;',
    'varying vec3 vColor;',

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

    'void main(){',
      '//Sprite. gl_PointCoord has its origin top-left; flip Y so authored sprites',
      '//read the conventional way. Spin each droplet a little by its seed so a',
      '//single round sprite does not betray the point-grid.',
      'vec2 pc = gl_PointCoord - 0.5;',
      'float ang = (vSeed - 0.5) * 6.2831853;',
      'float cs = cos(ang); float sn = sin(ang);',
      'vec2 spriteUV = vec2(cs * pc.x - sn * pc.y, sn * pc.x + cs * pc.y) + 0.5;',
      'spriteUV.y = 1.0 - spriteUV.y;',
      'vec4 sprite = texture2D(splashSprite, spriteUV);',

      '//Lifetime fade: a quick rise then a long ease-out, like real spray thinning.',
      'float fadeIn = smoothstep(0.0, 0.15, vAge01);',
      'float fadeOut = 1.0 - smoothstep(0.55, 1.0, vAge01);',
      'float ageAlpha = fadeIn * fadeOut;',

      '//Soft-particle fade. Sample scene depth under this fragment. .a marks where',
      '//solid geometry was written; over open water / sky it is 0 and we must NOT',
      '//fade (otherwise spray over the open sea vanishes against the cleared buffer).',
      'vec2 screenUV = gl_FragCoord.xy / uResolution;',
      'vec4 depthSample = texture2D(uLinearDepth, screenUV);',
      'float sceneZ = depthSample.r;',
      'float hasGeom = depthSample.a;',
      'float softFade = 1.0;',
      'if(hasGeom > 0.5){',
        'softFade = clamp((sceneZ - vViewZ) / max(0.001, uSoftRange), 0.0, 1.0);',
      '}',

      'float alpha = sprite.a * ageAlpha * softFade * uOpacity;',

      'vec3 color = linearToSrgb(acesTonemap(vColor * sprite.rgb));',

      'if(uDebugMode == 1){',
        '//Crest mist = red, impact burst = magenta; alpha-only sprite shape kept.',
        'vec3 tint = mix(vec3(1.0, 0.1, 0.1), vec3(1.0, 0.2, 0.8), step(0.5, vType));',
        'color = tint;',
        'alpha = sprite.a * ageAlpha;',
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

    'uniform float uViewportHeight; //renderer drawing-buffer height in pixels',
    'uniform float uMaxPointSize;   //hardware-safe clamp for gl_PointSize',
    'uniform float uSizeScale;      //global artistic size multiplier (FUDGE)',

    '//Lighting is per-particle (vertex) rather than per-fragment: spray is a bright',
    '//omnidirectional scatterer with no meaningful surface normal, so a single',
    '//ambient + sun term is both cheaper and visually sufficient.',
    'uniform vec3 sunColor;         //brightest directional light colour * intensity',
    'uniform vec3 skyAmbientColor;  //a-starry-sky y-hemisphere ambient',
    'uniform float uSunScale;       //artistic sun contribution (FUDGE)',
    'uniform float uAmbientScale;   //artistic ambient contribution (FUDGE)',

    'varying float vAge01;',
    'varying float vSeed;',
    'varying float vType;',
    'varying float vViewZ;          //positive view-space depth, matches G-buffer',
    'varying vec3 vColor;',

    'void main(){',
      'vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
      'vViewZ = -mvPosition.z;',

      '//Perspective size attenuation: a droplet of world radius aSize subtends',
      '//(aSize * focalLengthPixels / distance) pixels. projectionMatrix[1][1] is',
      '//the vertical focal length in clip units, so 0.5 * viewportHeight * that',
      '//converts a world radius at unit distance into pixels.',
      'float focalPx = 0.5 * uViewportHeight * projectionMatrix[1][1];',
      'float pointPx = aSize * uSizeScale * focalPx / max(0.001, vViewZ);',
      'gl_PointSize = clamp(pointPx, 1.0, uMaxPointSize);',

      'vAge01 = aAge01;',
      'vSeed = aSeed;',
      'vType = aType;',
      'vColor = skyAmbientColor * uAmbientScale + sunColor * uSunScale;',

      'gl_Position = projectionMatrix * mvPosition;',
    '}',
  ].join('\n'),
};
