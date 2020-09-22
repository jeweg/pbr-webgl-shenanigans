# PBR Experiments
[<img src="https://github.com/jeweg/pbr-webgl-shenanigans/raw/master/pbr-screenshot.png">](https://weggemann.de/pbr/)
[> WebGL Demo <](https://weggemann.de/pbr/)

Meshes rendered through rasterization, shadows use raytracing towards the lights.

Implements/explores
* Physically-based rendering and its various approaches and approximations 
    * Roughness-metalness material parametrization 
    * Analytic physics-based lights
    * Additional image-based HDR lighting
* Simple raytracing for (smooth) shadows
* Reinhard tone mapping

I've implemented the following approaches to approximating the parts of the rendering equation:

* Diffuse model
    * **Lambert**
    * **Burley (Disney)**
    * **[Hammon 2017](https://twvideo01.ubm-us.net/o1/vault/gdc2017/Presentations/Hammon_Earl_PBR_Diffuse_Lighting.pdf)**

* NDF (Normal distribution function)
    * **GGX**
    * **Blinn-Phong (not considered physically-based, but interesting for comparison)**

* Fresnel term
    * **Schlick**
    * **Schlick with the [Unreal Engine 4 optimization](https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf) (see Eq.(5))**

* Specular geometric attenuation
    * **Smith**
    * **Height-correlated Smith**
    * **Schlick with the [Unreal Engine 4 optimization](https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf) (see Eq.(4))**
    * **Kelemen**
    * **Implicit**

This experiments builds on [three.js](https://threejs.org/) which comes with everything and the kitchen sink, notably PBR shaders and the preprocessing tools for image-based rendering. In the interest of actually learning things, I'm completely ignoring those helpers here.
Instead I've built my own tools:

* **modules/CubeMapConverter.js**: Converts an environment map in latitude-longitude format to a cube map.
* **modules/DiffuseIrradianceGenerator.js**: Creates the diffuse irradiance map. Multiple passes used with a ping-pong scheme and stratified sampling with random offset. This seems to get better results than Hammersley samples.
* **modules/PMREM.js**: My own pre-filtered environment map generator, not finished.

Shadows are done with a single (or 8 against the vertices of a small cube around the lights when smooth shadows enabled) shadow ray(s) per light, intersection against the perfect sphere equations.

Status:
* Very much unoptimized shader code. The goal here was to collect proofs-of-concept.
* No specular environment reflection yet. We really want explicit roughness-based mipmap level selection for this which WebGL didn't have at the time. Might come back to this as time allows.
