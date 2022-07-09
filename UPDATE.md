**Version 0.2.0**
* Added support for simple ocean masking using the technique described by [How to hide a water plane inside a floating boat in threejs](https://woodenraft.games/blog/how-to-hide-water-plane-inside-hollow-boat-threejs).

**Version 0.1.1**
* Fixed issues associated with build 137 of THREE which is found in A-Frame Version 1.3.0.

**Version 0.1.0**
* Implemented ocean FFT heightmap based on [Oreon Engine FFT Waves Tutorial](https://youtu.be/B3YOLg0sA2g).
* Emulated infinite ocean with a viewport-oriented approach (follows the camera) with motion emulated by moving the uv-coordinates.
* Added camera-centered, cubemap based refraction, reflection and depth exponential scattering.
* Added water surface detailing by combining normal maps from [Water Simulation](https://watersimulation.tumblr.com/post/115928250077/scrolling-normal-maps) along with additive normal map techniques from [Blending in Detail](https://blog.selfshadow.com/publications/blending-in-detail/).
* Added height based scattering glow to the waves with scattering glow dependent upon the brightest direct lighting in the scene.
