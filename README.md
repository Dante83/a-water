# A-Water

A-Water is a tad bit of a misnomer, as the library, presently, only contains code for adding an infinite procedural ocean for the [A-Frame Web Framework](https://aframe.io/). It is a simple drop-in component that allows you produce animated rolling ocean waves in your creations. Click [here](https://code-panda.com/pages/projects/a_ocean/v_0_1_0/a_ocean_example) to see this project in action (**Warning: requires a powerful GPU - do not open on a mobile phone**).

## Prerequisites

This is built for the [A-Frame Web Framework](https://aframe.io/) version 1.2.0+. It also requires a Web XR compatible web browser.

`https://aframe.io/releases/1.2.0/aframe.min.js`

## Installing

When installing A-Ocean, you'll want to copy the *a-water.v0.1.0.min.js* file, along with the *assets** folder into their own directory in your JavaScript folder. Afterwards, add the minified file into a script tag in your html.

```html
<script src="https://aframe.io/releases/1.2.0/aframe.min.js"></script>
<script src="{PATH_TO_JS_FOLDER}/a-water.v0.1.0.min.js"></script>
```

Once these references are set up, add the `<a-ocean>` component into your `<a-scene>` tag from A-Frame like so and make sure to include a camera element so the ocean can track along your position. `<a-ocean>` uses a static mesh plane around your camera, and then modifies the surface of that ocean by varying your position on the displacement map procedurally, giving you the 'appearance' of an infinite ocean without popping artifacts that occur from adding new mesh along the horizon.

```html
<a-scene>
  <a-entity camera look-controls wasd-controls></a-entity>
  <a-ocean></a-ocean>
</a-scene>
```

This barebones code will provide you with an infinite scrolling oceans that will track your scenes primary camera. In addition to this basic setup, the following parameters are also available to help you customize your ocean according to your desired environment. These can be found in the `ocean-state` attribute which should be set inside `<a-ocean>`.

**Property** | **Description**
:--- | :---
`large_normal_map` | The location of the large wave normal map used for surface details relative to the webpage folder.
`small_normal_map` | The location of the small wave normal map used for surface details relative to the webpage folder.
`height_offset` | The height, in world coordinates, of the infinite water plane relative to 0m.
`wind_velocity` | The velocity of the wind, higher wind speeds result in larger waves.
`draw_distance` | The maximum distance away from the camera, for which wave tiles will be added.
`patch_size` | The width and length of patches that will be added to the scene to fill in the space between the camera and the `draw_distance`.
`patch_data_size` | The pixel dimensions of the output FFT shader.
`patch_vertex_size` | The length and width of the number of vertices in each patch.
`wave_scale_multiple` | Increases the size of the waves by a multiple of this number.
`number_of_octaves` | The number of octaves to use in the FFT simulation.
`use_reflection_cubemap_for_environment_map` | A nifty little property that doubles the use of the internal cubemap reflection camera texture for use as the scenes environment map for other reflections. Defaults to `false`, but enabling it can produce realtime reflections using the oceans cubemap camera.

##Setting File Locations

The wave simulation makes use of two normal maps which provide multi-scale detailing to improve the look of the waves on the ocean plane. By default, the system presumes these are located in `./image-dir/a-water-assets/water-normal-1.png` (large) and `./image-dir/a-water-assets/water-normal-2.png` (small). However, you can set the locations of these files yourself in the event that you are using a different file structure for your scene with the `large_normal_map` and `small_normal_map` properties.

```html
  <a-ocean ocean-state="large_normal_map: './my-image-files/custom-large-normal-map.png';
    small_normal_map: './my-image-files/custom-small-normal-map.png';"></a-ocean>
```

Another common desire is to change the default height of the water level. This can be easily set by modifying the `height_offset` property.

```html
  <a-ocean ocean-state="height_offset: 50;"></a-ocean>
```

The ocean starts off with some pretty big waves, however, you can make the waves bigger or smaller by changing the `wind_velocity` property. Note that `wind_velocity` is a 2-D vector, as the wind has both a magnitude and a direction. Each component of this vector is the wind velocity along it's respective axis, the wind speed in the x direction and y direction, for instance. The higher the wind velocity, the larger the waves that will result.

```html
  <!-- +2 wind velocity in the positive x direction and -0.5 in the y direction -->
  <a-ocean ocean-state="wind_velocity: vec2(2.0, -0.5);"></a-ocean>
```

The `draw_distance` property says how far away to draw tiles, beyond this value, new tiles will not be generated. The size of the tiles is set by the `patch_size` property. This will also impact the size of the waves generated. The number of vertices on each individual patch, and the size of the heightmap associated with it, is set by the `patch_data_size` property. These can be used to increase the beauty of the scene or increase performance, and there is a healthy balance between the three that needs to be kept if modifying these properties. If, however, you change the patch size, because this changes the size of the output FFT texture, you will also need to modify the `number_of_octaves` that are in use by the FFT transformer. Overall, the easiest way to increase or decrease performance is through `draw_distance`, as it doesn't have sucha  complicated interplay between components.

```html
  <!-- The waves will go way out now! -->
  <a-ocean ocean-state="draw_distance: 2000.0"></a-ocean>
```

A final little helper in the code, that isn't directly related to oceans, is `use_reflection_cubemap_for_environment_map`. Because `<a-ocean>` uses a reflection cubemap centered at the camera, which creates a fresh cubemap each frame, you can use this image to drive your scene environment map for use in reflections and other lighting mechanisms in your scene without having to calculate this twice.

## Author
* **David Evans / Dante83** - *Main Developer*

## References & Special Thanks
* **[Oreon Engine](https://github.com/fynnfluegge/oreon-engine) / [Oreon Engine FFT Waves](https://youtu.be/B3YOLg0sA2g)** - These tutorials for building FFT waves using multiple GPU shader passes and the butterfly technique are the key drivers for the heightmaps used for the surface of the water.
* The [Crest](https://github.com/wave-harmonic/crest) Library is the inspiration for using an static plane centered around the camera with a scrolling texture to drive the heights.
* The normal maps from [Water Simulation](https://watersimulation.tumblr.com/post/115928250077/scrolling-normal-maps), are used as the surface details for the waves in this component.
* The normal map techniques from [Blending in Detail](https://blog.selfshadow.com/publications/blending-in-detail/) were critical to providing detailing on the wave surfaces.
* All the amazing work that has gone into [THREE.JS](https://threejs.org/) and [A-Frame](https://aframe.io/).
* *And so many other websites and individuals. Thank you for filling our worlds with amazing oceans, deep, mysterious, and uncharted.*

## License
This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details
