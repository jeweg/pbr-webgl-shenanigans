// For this pattern, see https://stackoverflow.com/a/2912492/4593802
var jw = jw || {};

/*
*/
jw.DiffuseIrradianceGenerator = function(resolution)
{
    this.scene = new THREE.Scene();
    this.camera = new THREE.CubeCamera(0.1, 10, resolution); 
    this.renderTargets = [];
    for (i = 0; i < 2; ++i)
    {
        rt = new THREE.WebGLRenderTargetCube(resolution, resolution, {
            format: THREE.RGBFormat,
            magFilter: THREE.LinearFilter,
            minFilter: THREE.LinearFilter,
            type: THREE.HalfFloatType,
        });
        this.renderTargets.push(rt);
    }

    /*
    // Precompute a Hammersley points texture.
    // Opengl ES 2 doesn't have the GLSL capabilities to efficiently compute them at runtime. 
    {
        // See http://holger.dammertz.org/stuff/notes_HammersleyOnHemisphere.html
        radicalInverse_VdC = function(bits) {
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
        var hammersleyData = new Float32Array(2048 * 3);
        for (var i = 0; i < 2048; ++i)
        {
            var h = hammersley2d(i, 2048);
            // stride 3 because rgb components.
            hammersleyData[i * 3 + 0] = h.x;
            hammersleyData[i * 3 + 1] = h.y;
        }
        this.hammersleyPointsTexture = new THREE.DataTexture(hammersleyData, 2048, 1, THREE.RGBFormat, THREE.FloatType);
        this.hammersleyPointsTexture.generateMipmaps = false;
        this.hammersleyPointsTexture.minFilter = THREE.NearestFilter;
        this.hammersleyPointsTexture.magFilter = THREE.NearestFilter;
        this.hammersleyPointsTexture.wrapS = THREE.RepeatWrapping;
        this.hammersleyPointsTexture.wrapT = THREE.RepeatWrapping;
        this.hammersleyPointsTexture.needsUpdate = true;
    }
    */

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

    var totalThetaSteps = 60;
    var maxSamplesPerPass = 500;

    var totalPhiSteps = totalThetaSteps * 4;
    var totalSamples = totalThetaSteps * totalPhiSteps;
    var phiStep = 2 * Math.PI / totalPhiSteps;
    var thetaStep = Math.PI * 0.5 / totalThetaSteps;
    var passCount = Math.ceil(totalSamples / maxSamplesPerPass);

    console.log('total samples:', totalSamples, ', #passes: ', passCount);

    this.material = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        depthFunc: THREE.AlwaysDepth,
        depthWrite: false,
        defines: {
            "PI": "3.1415926535897932384626433832795",
            "MAX_SAMPLES_PER_PASS": maxSamplesPerPass,
            "TOTAL_SAMPLES": totalSamples,
            "THETA_STEPS_TOTAL": totalThetaSteps,
            "PHI_STEPS_TOTAL": totalPhiSteps,
            "PHI_STEP": phiStep,
            "THETA_STEP": thetaStep
        },
        uniforms: {
            u_sampleSource: {},
            u_lastPassOutput: {},
            u_passIndex: {}
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
            uniform samplerCube u_lastPassOutput;\n\
            uniform int u_passIndex;\n\
            varying vec3 v_pos_wc;\n\
\n\
            // From http://byteblacksmith.com/improvements-to-the-canonical-one-liner-glsl-rand-for-opengl-es-2-0/\n\
            highp float rand(vec2 co)\n\
            {\n\
                highp float a = 12.9898;\n\
                highp float b = 78.233;\n\
                highp float c = 43758.5453;\n\
                highp float dt= dot(co.xy ,vec2(a,b));\n\
                highp float sn= mod(dt,3.14);\n\
                return fract(sin(sn) * c);\n\
            }\n\
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
                vec3 irradiance = vec3(0.0);\n\
\n\
                // We're doing stratified sampling here.\n\
                // This should give better results than Hammersley samples.\n\
\n\
                float sampleOffset = float(u_passIndex * MAX_SAMPLES_PER_PASS);\n\
                float samplesConsidered = 0.0;\n\
                for (int sample = 0; sample < MAX_SAMPLES_PER_PASS; ++sample)\n\
                {\n\
                    float realSampleIndex = float(sample) + sampleOffset;\n\
                    if (realSampleIndex >= float(TOTAL_SAMPLES))\n\
                        break;\n\
                    float phi = floor(mod(realSampleIndex, float(PHI_STEPS_TOTAL))) * PHI_STEP;\n\
                    float theta = float(floor(realSampleIndex / float(PHI_STEPS_TOTAL))) * THETA_STEP;\n\
\n\
                    vec2 randomness = vec2(rand(gl_FragCoord.xy * v_pos_wc.xy), rand(gl_FragCoord.xy));\n\
                    phi += randomness.x * PHI_STEP;\n\
                    theta += randomness.y * THETA_STEP;\n\
\n\
                    //uint foobar;\n\
\n\
                    // Sample at spherical coordinates (theta, phi).\n\
                    vec3 tangentSample = vec3(sin(theta) * cos(phi),  sin(theta) * sin(phi), cos(theta));\n\
                    // Tangent space coords to world space.\n\
                    vec3 sampleVec = tangentSample.x * right + tangentSample.y * up + tangentSample.z * normal; \n\
\n\
                    // the cos factor is the usual weighting from the rendering equation.\n\
                    // the sin factor balances the higher density of samples closer to the normal direction that\n\
                    // results from the way the samples are computed.\n\
                    irradiance += textureCube(u_sampleSource, sampleVec).rgb * cos(theta) * sin(theta);\n\
                    ++samplesConsidered;\n\
                }\n\
                irradiance /= samplesConsidered;\n\
                irradiance *= PI;\n\
                if (u_passIndex > 0)\n\
                {\n\
                    // Combine result with the last pass' result. This will ensure that\n\
                    // samples are weighted evenly across all passes.\n\
                    vec3 lastPassResult = textureCube(u_lastPassOutput, normal).rgb;\n\
                    irradiance = mix(lastPassResult, irradiance, 1.0 / (float(u_passIndex) + 1.0));\n\
                }\n\
                gl_FragColor = vec4(irradiance, 1.0);\n\
            }"
    });

    // Note that the exact type of geometry doesn't matter as long as
    // all pixels are covered when rendering around the camera.
    // A sphere would work just well, for example (but require more vertices).
    this.scene.add(new THREE.Mesh(
        new THREE.BoxBufferGeometry(1, 1, 1),
        this.material
    ));

    this.update = function(renderer, inputCubeMap)
    {
        this.material.uniforms['u_sampleSource'].value = inputCubeMap;

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
        return this.camera.renderTarget;
    };
};
