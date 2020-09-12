import * as THREE from '../three.js/build/three.module.js';


class PMREM
{

constructor(resolution) 
{

    this.scene = new THREE.Scene();
    this.hammersleyPointsTexture = undefined;
    this.renderTargets = [];
    for (let i = 0; i < 2; ++i)
    {
        let rt = new THREE.WebGLCubeRenderTarget(resolution, {
            format: THREE.RGBAFormat,
            magFilter: THREE.LinearFilter,
            minFilter: THREE.LinearFilter,
            type: THREE.HalfFloatType,
        });
        this.renderTargets.push(rt);
    }
    this.camera = new THREE.CubeCamera(0.1, 10, this.renderTargets[0]); 

    // Precompute a Hammersley points texture.
    // Opengl ES 2 doesn't have the GLSL capabilities to efficiently compute them at runtime. 
    {
        const Num = 4096; // Must be power-of-two.
        // See http://holger.dammertz.org/stuff/notes_HammersleyOnHemisphere.html
        let radicalInverse_VdC = function(bits) {
            bits = (bits << 16) | (bits >>> 16);
            bits = ((bits & 0x55555555) << 1) | ((bits & 0xAAAAAAAA) >>> 1);
            bits = ((bits & 0x33333333) << 2) | ((bits & 0xCCCCCCCC) >>> 2);
            bits = ((bits & 0x0F0F0F0F) << 4) | ((bits & 0xF0F0F0F0) >>> 4);
            bits = ((bits & 0x00FF00FF) << 8) | ((bits & 0xFF00FF00) >>> 8);
            var result = bits * 2.3283064365386963e-10; // / 0x100000000
            // We must correct the result b/c Javascript doesn't do unsigned arithmetic.
            // This seems to do the trick.
            // Correctness checked by comparing to  http://people.sc.fsu.edu/~jburkardt/cpp_src/hammersley/hammersley_prb_output.txt
            if (result < 0)
                result += 1;
            return result;
        }
        function hammersley2d(i, N)
        {
            return new THREE.Vector2(i/N, radicalInverse_VdC(i));
        }
        // Hammersley points in x and y components of each texel.
        var hammersleyData = new Float32Array(Num * 3);
        for (var i = 0; i < Num; ++i)
        {
            var h = hammersley2d(i, Num);
            // stride 3 because rgb components.
            hammersleyData[i * 3 + 0] = h.x;
            hammersleyData[i * 3 + 1] = h.y;
        }
        for (var i = 0; i < 3 * Num; ++i)
            hammersleyData[i] = Math.random();

        this.hammersleyPointsTexture = new THREE.DataTexture(hammersleyData, Num, 1, THREE.RGBFormat, THREE.FloatType);
        this.hammersleyPointsTexture.generateMipmaps = false;
        this.hammersleyPointsTexture.minFilter = THREE.NearestFilter;
        this.hammersleyPointsTexture.magFilter = THREE.NearestFilter;
        this.hammersleyPointsTexture.wrapS = THREE.RepeatWrapping;
        this.hammersleyPointsTexture.wrapT = THREE.RepeatWrapping;
        this.hammersleyPointsTexture.needsUpdate = true;

        //console.log(hammersleyData);
    }

    /*
    phi goes from 0 to 2pi, theta from 0 to pi/2, so phi should have about
    4 times as many steps to give nice regions on the hermisphere.
    let's go with 100 phi steps and 25 theta steps, so about 2500 samples.
    and let's divide this into 10 passes with 250 samples each.
    that's 250 samples per pass,
    */

    /*
    Sanity checks:

    1 sample, 1 pass. Randomness disabled. Cos and sin weights of sample disabled,
    Pi weight of result disabled. We then get a color that is just a little brighter than the rendered env map. Why?

    Doing just a pass-through (gl_FragColor = vec4(textureCube(u_sampleSource, normal).rgb, 1.0);) in the fs gets me exactly the right result, i.e. the env map and the lit model have exactly the same color.
    => gamma correction, exposure work the same (as they should).

    So where does the inaccuracy come from? I excluded an accidental pass-combine, that's not happening here.
    */

    this.material = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        depthFunc: THREE.AlwaysDepth,
        depthWrite: false,
        defines: {
            "PI": "3.1415926535897932384626433832795",
            "TOTAL_SAMPLES": 4096,
        },
        uniforms: {
            u_sampleSource: {},
            u_hammersley: {}
        },
        vertexShader: 
            "varying vec3 v_pos_wc;\n\
            void main() {\n\
                vec4 pos_wc = modelMatrix * vec4(position, 1.0);\n\
                v_pos_wc = pos_wc.xyz;\n\
                gl_Position = projectionMatrix * viewMatrix * pos_wc;\n\
            }",
        fragmentShader: 
            "uniform samplerCube u_sampleSource;\n\
            uniform sampler2D u_hammersley;\n\
            varying vec3 v_pos_wc;\n\
\n\
            void main()\n\
            {\n\
                vec3 normal = normalize(v_pos_wc);\n\
\n\
                // Construct a tangent frame.\n\
                vec3 up = abs(normal.y) < abs(normal.x) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);\n\
                vec3 right = cross(up, normal);\n\
                up = cross(normal, right);\n\
\n\
                /*\n\
                for (int i = 0; i < TOTAL_SAMPLES; ++i)\n\
                {\n\
                    vec2 Xi = texture2D(u_hammersley, vec2(float(i) / 4096.0, 0.5)).xy;\n\
                }\n\
                */ vec2 Xi = texture2D(u_hammersley, gl_FragCoord.xy * 0.01).xy;\n\
                gl_FragColor =vec4(Xi, 0.0, 1.0);\n\
                //gl_FragColor =vec4(gl_FragCoord.xy * 1.00, 0.0, 1.0);\n\
                //gl_FragColor = vec4(0.0, 0.5, 0.5, 1.0);\n\
\n\
\n\
\n\
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

update(renderer, inputCubeMap) {
        this.material.uniforms['u_sampleSource'].value = inputCubeMap;
        this.material.uniforms['u_hammersley'].value = this.hammersleyPointsTexture;

        this.camera.renderTarget = this.renderTargets[0];
        this.camera.update(renderer, this.scene);

        let result = [];
        result.push(this.renderTargets[0].texture);

        /*
        for (var passIndex = 0; passIndex < passCount; ++passIndex)
        {
            this.material.uniforms['u_passIndex'].value = passIndex;

            // Switches source and destination render targets
            var currentRTIndex = passIndex % 2;
            var lastPassRTIndex = 1 - currentRTIndex;

            this.camera.renderTarget = this.renderTargets[currentRTIndex];
            this.material.uniforms['u_lastPassOutput'].value = this.renderTargets[lastPassRTIndex].texture;

            this.camera.update(renderer, this.scene);

        }
        */
        return result;
    }
}

export { PMREM };