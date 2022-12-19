**Version 0.2.0**
* Added a new attribute for making the water vertices transparent, which is useful for simple open boats, but is not useful for boats with transparency, or where the camera might go underwater.
* Implemented a basic LOD system for the water surface to reduce the number of triangle in the scene to allow for greater draw distances, including instanced mesh to reduce the number of draw calls.
* Swapped out per vertex normals with per fragment normals for less shimmering per pixel for distant tiles.
* Added clip planes for reflections and refractions for improved reflections.
* Implemented normal and height map fading to alleviate edge conditions (weird normal map behaviors) and
* Added basic specular sparkles and surface lighting from the sun.
* Fixed a bug with reflection cubemap camera positioning for better reflections.

**Version 0.1.0**
* Implemented ocean FFT heightmap based on [Oreon Engine FFT Waves Tutorial](https://youtu.be/B3YOLg0sA2g).
* Emulated infinite ocean with a viewport-oriented approach (follows the camera) with motion emulated by moving the uv-coordinates.
* Added camera-centered, cubemap based refraction, reflection and depth exponential scattering.
* Added water surface detailing by combining normal maps from [Water Simulation](https://watersimulation.tumblr.com/post/115928250077/scrolling-normal-maps) along with additive normal map techniques from [Blending in Detail](https://blog.selfshadow.com/publications/blending-in-detail/).
* Added height based scattering glow to the waves with scattering glow dependent upon the brightest direct lighting in the scene.
