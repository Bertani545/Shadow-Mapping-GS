## Shadow Mapping

This repository tries to add meshes with shadows in a Gaussian Splatting scene using Shadow mapping making some important assumptions:

- Gaussians do not move,
- Given that the light is already pre-rendered in a Gaussian-scene, gaussians do not cast shadows over other gaussians, but only over meshes,
- Meshes cast shadows over both meshes and gaussians,
- The light sources are placed in the original position of the light sources of the scene.

The first thing done was adding triangular meshes to the render pipeline. To archive thisthe following was done:

- Render the meshes as usual, writing to a color and a depth buffer. We also save the depth information in a color channel.
- Render the gaussians to a different color buffer but using the same depth buffer as before. Instead of disabling depth test and putting all the gaussians in a sinle plane, we will use the depth information of their center. Given that the gaussians are rendered front to back, we can't use the depth test directly. Instead, we enable the depth test but disable writing to the depth texture when rendering the gaussians. This way, only the gaussians infront of the triangular meshes will be rendered and the image will be rendered correctly.
- Also, because we will need depth information for shadows,  we save the depth of a fragment to some color channel (not the alpha one) to save computational power. This works because the formula used for obtaining the depth of a Gaussian Scene is as follows

$$D(\hat{x}) = \sum_{k}d_k\alpha_k(\hat{x})\prod_{j=0}^{k-1}\left(1 - \alpha_k(\hat{x})\right).$$

and the sum will be saved in the color channel at the end of the process.


After this, we need to add the shadows before blending the two uffers.


To add shadow mapping, the first step was creating a light source class. This class works similar to camera but with some changes:

- When created, it renders the gaussians' depth map using the formula given above.
- Each frame, it re-renders the depth map of the meshes.

With this two maps, it creates an special texture as an output each frame:

- The R channel contains the depth map of the scene, where each pixel have the closest value between meshes' and gaussians' depth.
- The G channel contains the depth map of the meshes
- The B channel contains if the mesh is visible from the camera, that is, if the gaussians above them are sufficiently opaque.



With this special msp we can continue to shade the renders we did in the beginning.

- We obtain the global position of each fragment of the meshes' color buffer, transform it to the light source space and check for shadows using the R channel.
- We obtain the global position of each fragment of the gaussians' color buffer, transform it to the light source space and check for shadows using the G and B channelss. If the Mesh is not visible, it would mean that the Gaussian Scene is already shadowed in that spot so nothing is done in that case. 
- We blend both results together.

This works as expected but did not give very good results.


## controls

movement (arrow keys)

- left/right arrow keys to strafe side to side
- up/down arrow keys to move forward/back
- `space` to jump

camera angle (wasd)

- `a`/`d` to turn camera left/right
- `w`/`s` to tilt camera up/down
- `q`/`e` to roll camera counterclockwise/clockwise
- `i`/`k` and `j`/`l` to orbit

trackpad
- scroll up/down to orbit down
- scroll left/right to orbit left/right
- pinch to move forward/back
- ctrl key + scroll up/down to move forward/back
- shift + scroll up/down to move up/down
- shift + scroll left/right to strafe side to side

mouse
- click and drag to orbit
- right click (or ctrl/cmd key) and drag up/down to move forward/back
- right click (or ctrl/cmd key) and drag left/right to strafe side to side

touch (mobile)
- one finger to orbit
- two finger pinch to move forward/back
- two finger rotate to rotate camera clockwise/counterclockwise
- two finger pan to move side-to-side and up-down

other
- press 0-9 to switch to one of the pre-loaded camera views
- press '-' or '+'key to cycle loaded cameras
- press `p` to resume default animation
- drag and drop .ply file to convert to .splat
- drag and drop cameras.json to load cameras

## other features

- press `v` to save the current view coordinates to the url
- open custom `.splat` files by adding a `url` param to a CORS-enabled URL
- drag and drop a `.ply` file which has been processed with the 3d gaussian splatting software onto the page and it will automatically convert the file to the `.splat` format

## examples

note that as long as your `.splat` file is hosted in a CORS-accessible way, you can open it with the `url` field. 

- https://antimatter15.com/splat/?url=plush.splat#[0.95,0.19,-0.23,0,-0.16,0.98,0.12,0,0.24,-0.08,0.97,0,-0.33,-1.52,1.53,1]
- https://antimatter15.com/splat/?url=truck.splat
- https://antimatter15.com/splat/?url=garden.splat
- https://antimatter15.com/splat/?url=treehill.splat
- https://antimatter15.com/splat/?url=stump.splat#[-0.86,-0.23,0.45,0,0.27,0.54,0.8,0,-0.43,0.81,-0.4,0,0.92,-2.02,4.1,1]
- https://antimatter15.com/splat/?url=bicycle.splat
- https://antimatter15.com/splat/?url=https://media.reshot.ai/models/nike_next/model.splat#[0.95,0.16,-0.26,0,-0.16,0.99,0.01,0,0.26,0.03,0.97,0,0.01,-1.96,2.82,1]

## notes

- written in javascript with webgl 1.0 with no external dependencies, you can just hit view source and read the unminified code. webgl 2.0 doesn't really add any new features that aren't possible with webgl 1.0 with extensions. webgpu is apparently nice but still not very well supported outside of chromium.
- splat sorts splats by a combination of size and opacity and supports progressive loading so you can see and interact with the model without having all the splats loaded. 
- does not currently support view dependent shading effects with spherical harmonics, this is primarily done to reduce the file size of the splat format so it can be loaded easily into web browsers. For third-order spherical harmonics we need 48 coefficients which is nearly 200 bytes per splat!
- splat sorting is done asynchronously on the cpu in a webworker. 


## More

More information can be found in the original repository at [this adress](https://github.com/antimatter15/splat)


