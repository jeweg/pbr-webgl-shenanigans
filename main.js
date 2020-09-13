// Prefer the minified version for load times?
import * as THREE from './three.js/build/three.module.js';

import Stats from './three.js/examples/jsm/libs/stats.module.js';
import {GUI} from './three.js/examples/jsm/libs/dat.gui.module.js';
import {OrbitControls} from './three.js/examples/jsm/controls/OrbitControls.js';
import {HDRCubeTextureLoader} from './three.js/examples/jsm/loaders/HDRCubeTextureLoader.js';
import {WEBGL} from './three.js/examples/jsm/WebGL.js';
import { RGBELoader } from './three.js/examples/jsm/loaders/RGBELoader.js';

import {CubeMapConverter} from './modules/CubeMapConverter.js';
import {DiffuseIrradianceGenerator} from './modules/DiffuseIrradianceGenerator.js';
import {PMREM} from './modules/PMREM.js';

var stats;
var container;
var scene;
var camera;
var renderer;
var material;
var controls;
var currentCombinedFShader;
var parameters;
var blackTexture;

var envScene, envCamera, envMaterial;

var environments = [];
var currentEnvironment;

var startTime = new Date();

const NUM_LIGHTS = 4;
const NUM_SPHERES = 9;
const USE_ORBIT_CONTROLS = true;

const impls_diffuse = {
    'Lambert': {
        elem: 'fshader_diffuse_lambert'
    },
    'Burley': {
        elem: 'fshader_diffuse_burley'
    },
    'HammonEarl2017': {
        elem: 'fshader_diffuse_HammonEarl'
    }
};
const impls_BRDF_G = {
    'Smith': {
        elem: 'fshader_brdfG_Smith'
    },
    'Smith (height-corr)': {
        elem: 'fshader_brdfG_Smith_heightCorr'
    }, 
    'Schlick (Unreal4)': {
        elem: 'fshader_brdfG_SchlickUnreal4'
    },
    'Kelemen': {
        elem: 'fshader_brdfG_Kelemen'
    },
    'Implicit': {
        elem: 'fshader_brdfG_Implicit'
    }
};
const impls_BRDF_D = {
    'GGX': {
        elem: 'fshader_brdfD_GGX'
    },
    'Blinn-Phong': {
        elem: 'fshader_brdfD_BlinnPhong'
    }
};
const impls_BRDF_F = {
    'None': {
        elem: 'fshader_fresnel_none'
    },
    'Schlick': {
        elem: 'fshader_fresnel_schlick'
    },
    'Schlick (Unreal4 optim)': 
    {
        elem: 'fshader_fresnel_schlickUnreal4'
    }
};
const values_F0 = {
    // Values from http://blog.selfshadow.com/publications/s2013-shading-course/hoffman/s2013_pbs_physics_math_notes.pdf
    // page 17. Linear, not sRGB.
    'Water': new THREE.Vector3(.02, .02, .02),
    'Plastic/Glass': new THREE.Vector3(.03, .03, .03),
    'Plastic High': new THREE.Vector3(.05, .05, .05),
    'Glass/Ruby': new THREE.Vector3(.08, .08, .08),
    'Diamond': new THREE.Vector3(.17, .17, .17),
    'Iron': new THREE.Vector3(.56, .57, .58),
    'Copper': new THREE.Vector3(.95, .64, .54),
    'Gold': new THREE.Vector3(1, .71, .29),
    'Aluminum': new THREE.Vector3(.91, .92, .92),
    'Silver': new THREE.Vector3(.95, .93, .88)
};

function transformedVector3(vec, mat)
{
    var p = new THREE.Vector3();
    p.copy(vec);
    p.applyMatrix4(mat);
    return p;
}

class Environment 
{

    constructor(name, sourceOrSources)
    {
        this.name = name;
        this.envMap = undefined;
        this.iem = undefined; // Prefiltered irradiance environment map (texture)
        this.pmrem = undefined; // Prefiltered mipmapped radiance map (rendertarget)
        this.sources = sourceOrSources;
        this.loadingStarted = false;
    }

    prepare(renderer) 
    {
        let self = this; // I need the current 'this' value in callbacks later on.
        if (!this.envMap && !this.loadingStarted)
        {
            console.log('Loading environment map', name);
            this.loadingStarted = true;
            if (this.sources instanceof Array)
            {
                if (Environment.hdrCubeLoader === undefined) {
                    Environment.hdrCubeLoader = new HDRCubeTextureLoader().setDataType(THREE.HalfFloatType);
                }
                Environment.hdrCubeLoader.load(this.sources, function(texture) { self.envMap = texture; });
            }
            else
            {
                // Interpret as single .hdr image
                if (Environment.hdrLoader === undefined)
                {
                    Environment.hdrLoader = new RGBELoader().setDataType(THREE.HalfFloatType);
                }
                Environment.hdrLoader.load([this.sources], function(texture) {
                    self.envMap = new CubeMapConverter(512).convertFromLatLong(renderer, texture);
                });
            }
            if (self.envMap) {
                self.envMap.magFilter = THREE.LinearFilter;
                self.envMap.minFilter = THREE.LinearFilter;
                self.envMap.needsUpdate = true;
            }
        }
        if (this.envMap && !this.iem)
        {
            console.log('Prefiltering diffuse irradiance...');
            var gen = new DiffuseIrradianceGenerator(32, this.envMap);
            this.iem = gen.update(renderer, this.envMap);
        }
        if (this.envMap && !this.pmrem)
        {
            console.log('Prefiltering mipmapped radiance...');
            //var pmremGenerator = new THREE.PMREMGenerator(this.envMap);
            //pmremGenerator.update(renderer);
            //this.pmrem = pmremGenerator.cubeLods;
            var pmrem = new PMREM(32);
            this.pmrem = pmrem.update(renderer);
        }
    }
}


function PunctualLight(params) // color, power, pos_wc
{
    params = params || {};

    // Flag to help the GUI presentation. It is factored into the power
    // parameter.
    this.enabled = true;

    this.color = params.color !== undefined ? params.color : '#ffffff';
    // Luminous power in Lux.
    this.power = params.power !== undefined ? params.power : 1.0;
    this.pos_wc = params.pos_wc !== undefined ? params.pos_wc : new THREE.Vector3();
    this.attRadius = params.attRadius !== undefined ? params.attRadius : 100.0;
    this.spotForward_wc = params.spotForward_wc !== undefined ? params.spotForward_vc : new THREE.Vector3();
    this.spotOuterAngle_deg = params.spotOuterAngle_deg !== undefined ? params.spotOuterAngle_deg : 50;
    this.spotInnerAngle_deg = params.spotInnerAngle_deg !== undefined ? params.spotInnerAngle_deg : 35;

    // Mesh to represent the light in the scene. Not passed to the shaders
    // and not part of any lighting calculations.
    this.visuMesh = null;
};


function SphereParams(params) // pos_wc, radius
{
    params = params || {};

    this.pos_wc = params.pos_wc !== undefined ? params.pos_wc : new THREE.Vector3();
    this.radius = params.radius !== undefined ? params.radius : 1.0;

    // Mesh to represent the light in the scene. Not passed to the shaders, of course.
    this.visuMesh = null;
};


function Parameters()
{
    this.impl_diffuse = 'Lambert';
    this.impl_BRDF_G = 'Schlick (Unreal4)';
    this.impl_BRDF_D = 'GGX';
    this.impl_BRDF_F = 'Schlick (Unreal4 optim)';
    this.baseColor = '#b2e6fc';
    //this.baseColor = '#168979';
    this.F0 = 'Iron';
    this.roughness = .2;
    this.metalness = .0;
    this.reflectivity = .0;
    this.debug_diffuseOnly = false;
    this.enable_shadows = true;
    this.smooth_shadows = true;
    this.lights = [
        new PunctualLight({
            color: '#ffffff',
            power: 15000,
            pos_wc: new THREE.Vector3(-12, 8, 8)
            }),
        new PunctualLight({
            color: '#ff7000', 
            power: 40000,
            pos_wc: new THREE.Vector3(8, -4, 7)
            }),
        new PunctualLight({
            color: '#005000',
            power: 3000,
            pos_wc: new THREE.Vector3(1, 4, 6)
            }),
        new PunctualLight({
            color: '#4080ff',
            power: 5000,
            pos_wc: new THREE.Vector3(5, 6, -4)})
    ];

    this.sphere_params = [];
    for (let u = -1; u <= 1; ++u)
    {
        for (let v = -1; v <= 1; ++v)
        {
            this.sphere_params.push(new SphereParams({
                pos_wc: new THREE.Vector3(u * 11, 0, v * 11),
                radius: 3
            }));
        }
    }

    // A Reinhard tone mapping exposure value of 2.5 looks similar to
    // Blender with the filmic blender addon and log encoding + base contrast.
    this.exposure = 1.3;
    this.gamma = 2.2;
    this.environment = '';
    this.env_renderMode = 'irradiance';
    this.env_strength = 0.6;
    this.enable_parametric_lights = true;
};

if ( WEBGL.isWebGLAvailable() ) {
    init();
    animate();
} else {
	var warning = WEBGL.getWebGLErrorMessage();
	document.getElementById( 'container' ).appendChild( warning );
}

function readElemText(elemName)
{
    return document.getElementById(elemName).textContent;
}

function setCurrentEnvironment(name)
{
    currentEnvironment = null;
    parameters.environment = name;
    for (var i = 0; i < environments.length; ++i)
    {
        if (environments[i].name == name)
        {
            currentEnvironment = environments[i];
            break;
        }
    }
}

function init()
{
    scene = new THREE.Scene();

    parameters = new Parameters();

    renderer = new THREE.WebGLRenderer({
        antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.autoClear = false;

    var c = renderer.getContext();
    console.log(c.getParameter(c.VERSION));
    console.log(c.getParameter(c.SHADING_LANGUAGE_VERSION));
    console.log(c.getParameter(c.VENDOR)); 

    container = document.getElementById('container');
    container.appendChild(renderer.domElement);

    stats = new Stats();
    container.appendChild(stats.domElement);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    //camera.position.set(0, 0, 20);
    camera.position.set(-43, 8, -30)


    camera.updateMatrix();
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    let data = new Int32Array(4 * 4 * 4);
    data.fill(0x000000ff);
    blackTexture = new THREE.DataTexture(data, 4, 4);
    blackTexture.format = THREE.RGBAFormat;
    blackTexture.generateMipmaps = false;
    blackTexture.needsUpdate = true;
    //delete data;

    // A separate scene for the environment rendering (a sky box)
    {
        envScene = new THREE.Scene();
        // envCamera receives its state from the main camera later.
        envCamera = new THREE.PerspectiveCamera();
        envMaterial = new THREE.ShaderMaterial({
            side: THREE.DoubleSide,
            //depthTest: false,
            depthTest: true,
            depthWrite: false,
            uniforms: {
                u_envMap: {},
                u_exposure: {},
                u_gamma: {},
            },
            vertexShader: readElemText('vshader_sky'),
            fragmentShader: readElemText('fshader_sky')
        });
        envScene.add(new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            //new THREE.SphereBufferGeometry(1, 32, 32),
            envMaterial
        ));
    }

    var genCubeUrls = function( prefix, postfix ) {
        return [
            prefix + 'px' + postfix, prefix + 'nx' + postfix,
            prefix + 'py' + postfix, prefix + 'ny' + postfix,
            prefix + 'pz' + postfix, prefix + 'nz' + postfix
        ];
    };
    
    environments.push(new Environment('brum_night', 'textures/04-07_Brum_Night_A.hdr'));
    environments.push(new Environment('testenv2', 'textures/testenv2.hdr'));
    environments.push(new Environment('testHDR', genCubeUrls("textures/testHDR/", ".hdr")));
    environments.push(new Environment('grey 128', 'textures/grey128.hdr'));
    environments.push(new Environment('black & white', 'textures/bw.hdr'));
    environments.push(new Environment('diffused', genCubeUrls("textures/diffused/diffused_cube_", ".hdr")));
    environments.push(new Environment('fromlatlong', genCubeUrls("textures/fromlatlong/fromLatLong_cube_", ".hdr")));
    //environments.push(new Environment('pngtest', ["textures/pngtest/1.png", "textures/pngtest/2.png", "textures/pngtest/3.png", "textures/pngtest/4.png", "textures/pngtest/5.png", "textures/pngtest/6.png" ]));
    //setCurrentEnvironment('None');
    //setCurrentEnvironment('testenv2');
    setCurrentEnvironment('testHDR');
    //setCurrentEnvironment('pngtest');

    if (USE_ORBIT_CONTROLS)
    {
        controls = new OrbitControls(camera, renderer.domElement);
        //controls.enableDamping = true;
        //controls.dampingFactor = .25;
        // Only when not using animation loop.
        //controls.addEventListener('change', animate);
    }

    updateFShader();

    material = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
            u_time: { type: "f", value: 0.0 },
            u_baseColor: { type: "v3", value: new THREE.Vector3(parameters.baseColor) },
            u_lightPos_vc: { type: "v3", value: new THREE.Vector3(-15, 0, -5) },
            u_F0: { type: "v3" },
            u_roughness: { type: "f" },
            u_metalness: { type: "f" },
            u_reflectivity: new THREE.Uniform(0.0),
            u_exposure: {},
            u_gamma: {},
            u_normalViewToWorldMatrix: new THREE.Matrix3(),
            u_lights: { value: [ 
                { power:{},color:{},pos_wc:{},pos_vc:{},invSqrAttRadius:{},cosOuterAngle:{},cosInnerAngle:{},angleScale:{},angleOffset:{},spotForward_vc:{}},
                { power:{},color:{},pos_wc:{},pos_vc:{},invSqrAttRadius:{},cosOuterAngle:{},cosInnerAngle:{},angleScale:{},angleOffset:{},spotForward_vc:{}},
                { power:{},color:{},pos_wc:{},pos_vc:{},invSqrAttRadius:{},cosOuterAngle:{},cosInnerAngle:{},angleScale:{},angleOffset:{},spotForward_vc:{}},
                { power:{},color:{},pos_wc:{},pos_vc:{},invSqrAttRadius:{},cosOuterAngle:{},cosInnerAngle:{},angleScale:{},angleOffset:{},spotForward_vc:{}}
            ]},
            u_spheres: { value: [
                { center_wc:{}, radius:{} },
                { center_wc:{}, radius:{} },
                { center_wc:{}, radius:{} },
                { center_wc:{}, radius:{} },
                { center_wc:{}, radius:{} },
                { center_wc:{}, radius:{} },
                { center_wc:{}, radius:{} },
                { center_wc:{}, radius:{} },
                { center_wc:{}, radius:{} },
            ]},
            u_iblFactor: {},
            u_irradianceMap: {},
            u_pmrem: {},
            u_debug_diffuseOnly: {},
            u_enable_shadows: {},
            u_smooth_shadows: {}
        },
        vertexShader: readElemText('vertexShader'),
        fragmentShader: currentCombinedFShader
    });
    updateUniforms();

    /*
    for (let u = -1; u <= 1; ++u)
    {
        for (let v = -1; v <= 1; ++v)
        {
            var mesh = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 32), material);
            mesh.translateX(u * 11);
            mesh.translateZ(v * 11);
            scene.add(mesh);
        }
    }
    */

    let plane_mesh = new THREE.Mesh(new THREE.PlaneGeometry(50, 50, 10, 10), material);
    plane_mesh.rotateX(-3.14159265 * 0.5);
    plane_mesh.translateZ(-5);
    //mesh.rotateX(1);
    scene.add(plane_mesh);

    // GUI //////////////////////////////////////////////////////////////////////

    let gui = new GUI();

    gui.add({
        renderer_info: function() {
            console.log('memory:');
            console.log('    geometries:' + renderer.info.memory.geometries);
            console.log('    textures:' + renderer.info.memory.textures);
            console.log('render:');
            console.log('    calls:' + renderer.info.render.calls);
            console.log('    vertices:' + renderer.info.render.vertices);
            console.log('    faces:' + renderer.info.render.faces);
            console.log('    points:' + renderer.info.render.points);
            console.log('programs:' + renderer.info.memory.programs);
        }},
        'renderer_info');
    gui.add({
        camera_info: function() {
            console.log(camera.toJSON());
            console.log(camera.position);
        }},
        'camera_info');
    gui.add(parameters, 'debug_diffuseOnly');

    gui.add(parameters, 'exposure', 0.1, 20.0);
    gui.add(parameters, 'gamma', 0.0, 5.0);

    var shadowFolder = gui.addFolder('Shadows');
    shadowFolder.add(parameters, 'enable_shadows');
    shadowFolder.add(parameters, 'smooth_shadows');
    shadowFolder.open();

    var envFolder = gui.addFolder('Environment');
    var envNames = ['None'];
    for (var i = 0; i < environments.length; ++i)
        envNames.push(environments[i].name);
    envFolder.add(parameters, 'environment', envNames).onChange(function(value) {
        setCurrentEnvironment(value);
    });
    envFolder.add(parameters, 'env_renderMode', ['environment', 'irradiance', 'radiance 0', 'radiance 1', 'radiance 2', 'radiance 3', 'radiance 4', 'radiance 5']);
    envFolder.add(parameters, 'env_strength', 0.0, 5.0);
    envFolder.open();

    var materialFolder = gui.addFolder('Material');
    materialFolder.add(parameters, 'impl_diffuse', Object.keys(impls_diffuse)).onChange(function(value) {
        updateFShader();
    });
    materialFolder.add(parameters, 'impl_BRDF_G', Object.keys(impls_BRDF_G)).onChange(function(value) {
        updateFShader();
    });
    materialFolder.add(parameters, 'impl_BRDF_D', Object.keys(impls_BRDF_D)).onChange(function(value) {
        updateFShader();
    });;
    materialFolder.add(parameters, 'impl_BRDF_F', Object.keys(impls_BRDF_F)).onChange(function(value) {
        updateFShader();
    });;

    // Disabled because it's not used by the current shader model
    //materialFolder.add(parameters, 'F0', Object.keys(values_F0));
    
    materialFolder.addColor(parameters, 'baseColor');
    materialFolder.add(parameters, 'roughness', .01, 1.0);
    materialFolder.add(parameters, 'metalness', 0.0, 1.0);

    // Disabled because it's not used by the current shader model
    //materialFolder.add(parameters, 'reflectivity', 0.0, 1.0);

    materialFolder.open();

    var lightingFolder = gui.addFolder('Parametric Light');
    lightingFolder.add(parameters, 'enable_parametric_lights');
    for (i = 0; i < NUM_LIGHTS; ++i)
    {
        var folder = lightingFolder.addFolder('Light ' + i);
        folder.add(parameters.lights[i], 'enabled');
        folder.add(parameters.lights[i], 'power', 0, 50000);
        folder.addColor(parameters.lights[i], 'color'); 
        folder.close();
    }

    /////////////////////////////////////////////////////////////////////////////

    OnWindowResize();
    window.addEventListener('resize', OnWindowResize, false);
}


function updateFShader()
{
    var fshader = '';
    fshader += '#define NUM_LIGHTS ' + NUM_LIGHTS + '\n';
    fshader += '#define NUM_SPHERES ' + NUM_SPHERES + '\n';
    
    fshader += readElemText('fshader_preamble');
    fshader += readElemText(impls_diffuse[parameters.impl_diffuse].elem);
    fshader += readElemText(impls_BRDF_G[parameters.impl_BRDF_G].elem);
    fshader += readElemText(impls_BRDF_D[parameters.impl_BRDF_D].elem);
    fshader += readElemText(impls_BRDF_F[parameters.impl_BRDF_F].elem);
    fshader += readElemText('fshader_epilogue');

    currentCombinedFShader = fshader;
    if (material != null)
    {
        material.fragmentShader = fshader;
        material.needsUpdate = true;
    }
}


function OnWindowResize(event)
{
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}


function gammaToLinear(color, gamma)
{
    var exp = gamma;
    if (color.r === undefined)
    {
        // Assume color is specified as a hex string
        color = new THREE.Color(color);
    }
    return new THREE.Color(Math.pow(color.r, exp),Math.pow(color.g, exp),Math.pow(color.b, exp));
}


function updateUniforms()
{
    var time = (new Date() - startTime) * .001;

    material.uniforms['u_time'].value = time;
    material.uniforms['u_baseColor'].value = gammaToLinear(parameters.baseColor, 2.2);
    material.uniforms['u_F0'].value = values_F0[parameters.F0];
    material.uniforms['u_roughness'].value = parameters.roughness;
    material.uniforms['u_metalness'].value = parameters.metalness;
    material.uniforms['u_reflectivity'].value = parameters.reflectivity;
    material.uniforms['u_exposure'].value = parameters.exposure;
    material.uniforms['u_gamma'].value = parameters.gamma;
    material.uniforms['u_debug_diffuseOnly'].value = parameters.debug_diffuseOnly;
    material.uniforms['u_enable_shadows'].value = parameters.enable_shadows;
    material.uniforms['u_smooth_shadows'].value = parameters.smooth_shadows;
    material.uniforms['u_iblFactor'].value = parameters.env_strength;
    material.uniforms['u_irradianceMap'].value = currentEnvironment ? currentEnvironment.iem : blackTexture;
    material.uniforms['u_pmrem'].value = currentEnvironment && currentEnvironment.pmrem ? currentEnvironment.pmrem[0].texture : blackTexture;

    // three.js itself gets the view matrix from camera.matrixWorldInverse.
    // To get the normals from view coords to world coords we must compute
    // transpose(inverse(inverse(viewMatrix))) = transpose(viewMatrix)
    let m = new THREE.Matrix3();
    m.setFromMatrix4(camera.matrixWorldInverse);
    m.transpose();
    material.uniforms['u_normalViewToWorldMatrix'].value = m;

    for (let i = 0; i < NUM_SPHERES; ++i)
    {
        let p = parameters.sphere_params[i];

        if (p.visuMesh == null) {
            p.visuMesh = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 48, 32), material);
            scene.add(p.visuMesh)
        }
        p.visuMesh.position.copy(p.pos_wc);
        p.visuMesh.updateMatrix();

        let uni = material.uniforms['u_spheres'].value[i]; // The target uniform block
        uni.center_wc = p.pos_wc; //transformedVector3(p.pos_wc, camera.matrixWorldInverse);
        uni.radius = p.radius;
    }

    for (let i = 0; i < NUM_LIGHTS; ++i)
    {
        let p = parameters.lights[i];
        let uni = material.uniforms['u_lights'].value[i]; // The target uniform block

        const time_scale = 2;
        let new_pos = p.pos_wc;
        if (i == 0) {
            new_pos.x += Math.sin(0.7 + time * 0.5 * time_scale) * 0.19;
            new_pos.z += Math.sin(1.17 + time * 0.3 * time_scale) * 0.21;
        } else if (i == 1) {
            new_pos.x += Math.sin(0.27 + time * 0.8 * time_scale) * 0.13;
            new_pos.z += Math.sin(1.07 + time * 0.2 * time_scale) * 0.17;
        } else if (i == 2) {
            new_pos.x += Math.sin(0.55 + time * 0.3 * time_scale) * 0.18;
            new_pos.z += Math.sin(1.8 + time * 0.7 * time_scale) * 0.27;
        } else if (i == 3) {
            new_pos.x += Math.sin(3.05 + time * 0.7 * time_scale) * 0.08;
            new_pos.z += Math.sin(2.8 + time * 0.6 * time_scale) * 0.18;
        }

        if (p.visuMesh == null) {
            p.visuMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial());
            scene.add(p.visuMesh)
        }
        p.visuMesh.position.copy(new_pos);
        p.visuMesh.updateMatrix();
        p.visuMesh.visible = p.enabled;
        p.visuMesh.material.color.copy(new THREE.Color(p.color));

        var effectivePower = parameters.lights[i].power;
        if (!parameters.enable_parametric_lights || !parameters.lights[i].enabled)
            effectivePower = 0.0;

        const DegToRadFactor = Math.pi / 180.0;

        uni.power = effectivePower;
        uni.color = gammaToLinear(p.color, 2.2);
        uni.invSqrAttRadius = 1.0 / Math.pow(parameters.lights[i].attRadius, 2.0);
        uni.color = new THREE.Color(p.color);
        uni.cosOuterAngle = Math.cos(p.spotOuterAngle_deg * DegToRadFactor);
        uni.cosInnerAngle = Math.cos(p.spotInnerAngle_deg * DegToRadFactor);

        uni.pos_wc = new_pos;
        uni.pos_vc = transformedVector3(new_pos, camera.matrixWorldInverse);
        uni.spotForward_vc = transformedVector3(p.spotForward_wc, camera.matrixWorldInverse);

        // Precomputed terms.
        uni.angleScale = -1.0 / Math.max(0.001, uni.cosInner - uni.cosOuter);
        uni.angleOffset = -uni.cosOuter * uni.angleScale;
    }
}


function animate()
{
    requestAnimationFrame(animate);

    controls.update();
    // The following two lines are vital because otherwise the matrices are not updated
    // and computation of uniform values might use the wrong matrices. This leads to funny
    // problems like lighting "lagging" behind camera movement.
    camera.updateMatrix();
    camera.updateMatrixWorld();

    if (currentEnvironment) {
        currentEnvironment.prepare(renderer);
    }
    updateUniforms();

    renderer.clear(true, true);
    envCamera.copy(camera);
    envCamera.position.set(0, 0, 0);

    if (currentEnvironment)
    {
        switch (parameters.env_renderMode) {
            default:
            case 'environment':
                envMaterial.uniforms['u_envMap'].value = currentEnvironment.envMap;
                break;
            case 'irradiance':
                envMaterial.uniforms['u_envMap'].value = 0;
                if (currentEnvironment.iem !== undefined) {
                    envMaterial.uniforms['u_envMap'].value = currentEnvironment.iem;
                }
                break;
            case 'radiance 0':
            case 'radiance 1':
            case 'radiance 2':
            case 'radiance 3':
            case 'radiance 4':
            case 'radiance 5':
                if (currentEnvironment.pmrem)
                {
                    var i = Number(parameters.env_renderMode.substr(9, 1));
                    i = Math.min(i, currentEnvironment.pmrem.length - 1);
                    //console.log(parameters.env_renderMode.substr(9, 1),'Showing prefiltered radiance mipmap', i);
                    envMaterial.uniforms['u_envMap'].value = currentEnvironment.pmrem[i];
                }
                break;
        };
        envMaterial.uniforms['u_exposure'].value = parameters.exposure;
        envMaterial.uniforms['u_gamma'].value = parameters.gamma;
        renderer.render(envScene, envCamera);
    }
    renderer.render(scene, camera);

    stats.update();
}
