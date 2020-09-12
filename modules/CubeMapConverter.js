import * as THREE from '../three.js/build/three.module.js';

// At the moment this assumes a LatLong input texture and renders a cube map.
class CubeMapConverter  {

    constructor(resolution) {
        this.scene = new THREE.Scene();

        this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(resolution, {
            format: THREE.RGBAFormat,
            magFilter: THREE.LinearFilter,
            minFilter: THREE.LinearFilter,
            type: THREE.HalfFloatType
        } );

        this.camera = new THREE.CubeCamera(0.1, 10, this.cubeRenderTarget); 
        // Replace the CubeCamera's render target with a floating point one.

        this.material = new THREE.ShaderMaterial({
            side: THREE.DoubleSide,
            depthFunc: THREE.AlwaysDepth,
            depthWrite: false,
            defines: {
                "Pi": "3.1415926535897932384626433832795"
            },
            uniforms: {
                u_inputMap: {}
            },
            vertexShader: 
                "varying vec3 v_pos_mc;\n\
                void main() {\n\
                    v_pos_mc = position;\n\
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n\
                }",
            fragmentShader: 
                "uniform sampler2D u_inputMap;\n\
                varying vec3 v_pos_mc;\n\
    \n\
                // Decodes png-hdr. Currently not used. \n\
                vec3 decode(const in vec4 color) {\n\
                    return color.rgb; \n\
                    if ( color.w > 0.0 ) {\n\
                        float f = pow(2.0, 127.0*(color.w-0.5));\n\
                        return color.xyz * f;\n\
                    }\n\
                    else return vec3(0.0, 0.0, 0.0);\n\
                }\n\
    \n\
                vec4 sampleInputMap(vec3 dir)\n\
                {\n\
                    // TODO: might make a good uniform.\n\
                    const float envMapRotation = 0.0;\n\
                    vec3 v = normalize(dir); // This is important.\n\
                    vec2 tc = vec2(\n\
                        (atan(v.z, v.x) + envMapRotation) / (Pi + Pi),\n\
                        asin(v.y) / Pi + 0.5 \n\
                    );\n\
                    return texture2D(u_inputMap, tc);\n\
                }\n\
    \n\
                void main() {\n\
                    vec3 color = sampleInputMap(v_pos_mc).rgb;\n\
                    //vec3 dir = normalize(v_pos_mc);\n\
                    //color += dir * vec3(0.2, 0.3, 0.4);\n\
                    gl_FragColor = vec4(color, 1.0);\n\
                }"
        });

        // Note that the exact type of geometry doesn't matter as long as
        // all pixels are covered when rendering around the camera.
        // A sphere would work just well, for example (but require more vertices).
        this.scene.add(new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            this.material
        ));

    }

    convertFromLatLong(renderer, inputTexture) {
            inputTexture.wrapS = THREE.RepeatWrapping;
            inputTexture.wrapT = THREE.RepeatWrapping;
            inputTexture.flipY = true;
            inputTexture.needsUpdate = true;
            this.material.uniforms['u_inputMap'].value = inputTexture;

            this.camera.update(renderer, this.scene);

            // Without cloning we could not use CubeMapConverter objects twice.
            return this.cubeRenderTarget.texture;
            /* I don't yet know how to deep copy a texture in three.js...
            var tex = this.camera.renderTarget.texture.clone();
            tex.needsUpdate = true;
            return tex; */
    }
}

export { CubeMapConverter };