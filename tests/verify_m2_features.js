/* Programmatic verification of Milestone 2 features:
   1. MeshPhysicalMaterial bodyMat, cockpitMat, and carbon with bumpMap.
   2. Synchronized wheel spinning (tyre, hub, rim, spokes all in spinGroup).
   3. Custom soft box contact shadow using sdBox shader.
   4. Low-poly flat shading, non-indexed terrain with rotated coordinate noise.
*/
'use strict';

const fs = require('fs');
const path = require('path');

// 1. Mock THREE.js minimal API
globalThis.THREE = {
  translate: function() { return this; },
  Color: function(r, g, b) {
    return { r, g, b };
  },
  BackSide: 1,
  DoubleSide: 2,
  NormalBlending: 3,
  AdditiveBlending: 4,
  sRGBEncoding: 5,
  ACESFilmicToneMapping: 6,
  LinearMipmapLinearFilter: 7,
  Vector3: function(x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
    this.set = function(nx, ny, nz) {
      this.x = nx; this.y = ny; this.z = nz;
      return this;
    };
    this.copy = function(other) {
      this.x = other.x; this.y = other.y; this.z = other.z;
      return this;
    };
    this.normalize = function() {
      const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) || 1;
      this.x /= len; this.y /= len; this.z /= len;
      return this;
    };
    this.setFromMatrixPosition = function(m) {
      return this;
    };
    return this;
  },
  Vector2: function(x, y) {
    this.x = x; this.y = y;
    return this;
  },
  SphereGeometry: function(radius, widthSegments, heightSegments) {
    this.radius = radius;
    this.widthSegments = widthSegments;
    this.heightSegments = heightSegments;
    return this;
  },
  ShaderMaterial: function(params) {
    this.uniforms = params.uniforms;
    this.vertexShader = params.vertexShader;
    this.fragmentShader = params.fragmentShader;
    this.isShaderMaterial = true;
    return this;
  },
  Mesh: function(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.scale = {
      setScalar: function() {},
      set: function() {}
    };
    this.lookAt = function() {};
    this.rotateX = function() {};
    this.rotateY = function() {};
    this.rotateZ = function() {};
    this.rotation = { x: 0, y: 0, z: 0, set: function(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
    this.add = function() {};
    return this;
  },
  BufferGeometry: function() {
    this.attributes = {};
    this.setAttribute = function(name, attr) {
      this.attributes[name] = attr;
    };
    this.getAttribute = function(name) {
      return this.attributes[name];
    };
    this.setIndex = function(idx) {
      this.index = idx;
    };
    this.toNonIndexed = function() {
      const newGeo = new THREE.BufferGeometry();
      newGeo.isNonIndexed = true;
      const posAttr = this.attributes['position'];
      if (posAttr && this.index) {
        const idx = this.index;
        const arr = posAttr.array;
        const newArr = new Float32Array(idx.length * 3);
        for (let i = 0; i < idx.length; i++) {
          const k = idx[i];
          newArr[i * 3] = arr[k * 3];
          newArr[i * 3 + 1] = arr[k * 3 + 1];
          newArr[i * 3 + 2] = arr[k * 3 + 2];
        }
        newGeo.setAttribute('position', new THREE.BufferAttribute(newArr, 3));
      } else if (posAttr) {
        newGeo.setAttribute('position', posAttr);
      }
      return newGeo;
    };
    this.computeVertexNormals = function() {};
    this.dispose = function() {};
    return this;
  },
  BufferAttribute: function(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    return this;
  },
  PointsMaterial: function(params) {
    this.color = params.color;
    this.size = params.size;
    return this;
  },
  Points: function(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.lookAt = function() {};
    this.rotateX = function() {};
    this.rotateY = function() {};
    this.rotateZ = function() {};
    this.scale = { setScalar: function() {}, set: function() {} };
    this.userData = {};
    return this;
  },
  MeshStandardMaterial: function(params) {
    this.isMeshStandardMaterial = true;
    this.vertexColors = params?.vertexColors;
    this.roughness = params?.roughness;
    this.metalness = params?.metalness;
    this.flatShading = params?.flatShading;
    return this;
  },
  MeshPhysicalMaterial: function(params) {
    this.isMeshPhysicalMaterial = true;
    Object.assign(this, params);
    return this;
  },
  MeshBasicMaterial: function(params) {
    this.isMeshBasicMaterial = true;
    Object.assign(this, params);
    return this;
  },
  RepeatWrapping: 1,
  WebGLRenderTarget: function(w, h, params) {
    this.isWebGLRenderTarget = true;
    this.dispose = function() {};
    this.texture = { minFilter: 0, magFilter: 0 };
    return this;
  },
  WebGLMultisampleRenderTarget: function(w, h, params) {
    this.isWebGLMultisampleRenderTarget = true;
    this.dispose = function() {};
    this.texture = { minFilter: 0, magFilter: 0 };
    return this;
  },
  CanvasTexture: function(canvas) {
    this.isCanvasTexture = true;
    this.canvas = canvas;
    this.repeat = { set: function() {} };
    this.offset = { x: 0, y: 0 };
    this.needsUpdate = false;
    this.clone = function() { return new THREE.CanvasTexture(this.canvas); };
    return this;
  },
  Group: function() {
    this.children = [];
    this.position = new THREE.Vector3();
    this.scale = { setScalar: function() {}, set: function() {} };
    this.quaternion = new THREE.Quaternion();
    this.rotation = { x: 0, y: 0, z: 0, set: function(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
    this.userData = {};
    this.lookAt = function() {};
    this.rotateX = function() {};
    this.rotateY = function() {};
    this.rotateZ = function() {};
    this.add = function(item) {
      this.children.push(item);
    };
    return this;
  },
  PlaneGeometry: function(w, h) {
    this.w = w; this.h = h;
    return this;
  },
  Matrix4: function() {
    this.makeBasis = function() { return this; };
    this.compose = function() { return this; };
    this.multiplyMatrices = function() { return this; };
    this.copy = function() { return this; };
    this.identity = function() { return this; };
    return this;
  },
  Quaternion: function() {
    this.setFromRotationMatrix = function() { return this; };
    this.setFromEuler = function() { return this; };
    this.copy = function() { return this; };
    return this;
  },
  Euler: function() {
    this.set = function() { return this; };
    return this;
  },
  InstancedMesh: function() {
    this.setMatrixAt = function() {};
    this.instanceMatrix = { needsUpdate: false };
    return this;
  },
  TorusGeometry: function() { return this; },
  OctahedronGeometry: function() { return this; },
  ConeGeometry: function() {
    this.translate = function() { return this; };
    return this;
  },
  BoxGeometry: function(w, h, d) {
    this.w = w; this.h = h; this.d = d;
    return this;
  },
  CylinderGeometry: function(rt, rb, h, segments) {
    this.rt = rt; this.rb = rb; this.h = h; this.segments = segments;
    return this;
  },
  CircleGeometry: function() { return this; },
  RingGeometry: function() { return this; },
  Fog: function() { return this; },
  HemisphereLight: function() {
    this.position = new THREE.Vector3();
    return this;
  },
  DirectionalLight: function() {
    this.position = new THREE.Vector3();
    return this;
  },
  SpotLight: function() {
    this.position = new THREE.Vector3();
    return this;
  },
  Object3D: function() {
    this.position = new THREE.Vector3();
    return this;
  },
  PerspectiveCamera: function(fov, aspect, near, far) {
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.position = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.lookAt = function() {};
    this.updateProjectionMatrix = function() {};
    return this;
  }
};

globalThis.document = {
  createElement: function(type) {
    if (type === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: function() {
          return {
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 0,
            font: '',
            textAlign: '',
            textBaseline: '',
            fillRect: function() {},
            strokeRect: function() {},
            fillText: function() {},
            drawImage: function() {},
            createImageData: function(w, h) {
              return { data: new Uint8ClampedArray(w * h * 4) };
            },
            putImageData: function() {},
            createRadialGradient: function() {
              return { addColorStop: function() {} };
            },
            createLinearGradient: function() {
              return { addColorStop: function() {} };
            }
          };
        }
      };
    }
  }
};

// 2. Load game files
require('../js/core.js');
require('../js/theme.js');
require('../js/carspec.js');
require('../js/trackgen.js');
require('../js/physics.js');
require('../js/scene-core.js');
require('../js/scene-decor.js');
require('../js/scene-car.js');
require('../js/scene-fx.js');

const DD = globalThis.DD;

let pass = 0, fail = 0;
function assert(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  PASS: ${name}`);
  } else {
    fail++;
    console.error(`  FAIL: ${name} ${detail || ''}`);
  }
}

console.log("Starting Milestone 2 detailed feature verification...");

// 1. Car: lofted monocoque hull + carbon underfloor + transmissive canopy + turbofan wheels.
const garage = { grad: 0, finish: 1, form: 0 }; // Gloss
const carGroup = DD.buildCar(garage, false, {});

const hullMat = carGroup.userData.boostShell;
assert("Hull material exists (userData.boostShell)", !!hullMat);
assert("Hull material is MeshPhysicalMaterial", !!hullMat && hullMat.isMeshPhysicalMaterial);
assert("Hull material has clearcoat (Gloss finish)", !!hullMat && hullMat.clearcoat === 1.0);

const carbonMesh = carGroup.children.find(c => c.geometry instanceof THREE.BoxGeometry && c.material && c.material.isMeshPhysicalMaterial && c.material.bumpMap && c.material.bumpMap.isCanvasTexture);
assert("Carbon underfloor (Box + bumpMap) exists", carbonMesh !== undefined);

const canopyMesh = carGroup.children.find(c => c.material && c.material.transmission === 0.65 && c.material.ior === 1.52);
assert("Transmissive canopy mesh exists", canopyMesh !== undefined);
assert("Canopy material is MeshPhysicalMaterial", !!canopyMesh && canopyMesh.material.isMeshPhysicalMaterial);

assert("Car has 4 wheels", carGroup.wheels && carGroup.wheels.length === 4);
const wheel = carGroup.wheels[0];
assert("Wheel has spinGroup in userData", wheel.userData && wheel.userData.spinGroup !== undefined);
const spinGroup = wheel.userData.spinGroup;
assert("spinGroup has tyre+disc+hub+accent", spinGroup.children.length >= 3);

const initialRot = spinGroup.rotation.x;
DD.poseCar(carGroup, [0, 0, 0], 0, [0, 1, 0], 0, 0, 1.5, 0, 0);
assert("poseCar rotates spinGroup", spinGroup.rotation.x > initialRot);

// 3. Verify Contact Shadow
const shadow = DD.buildShadow();
assert("Shadow exists", shadow !== undefined);
assert("Shadow is a Mesh with ShaderMaterial", shadow.material.isShaderMaterial);
assert("Shadow shader contains sdBox functions and 5 boxes", 
  shadow.material.fragmentShader.includes("sdBox") && 
  shadow.material.fragmentShader.includes("dBody") && 
  shadow.material.fragmentShader.includes("dFL") && 
  shadow.material.fragmentShader.includes("dFR") && 
  shadow.material.fragmentShader.includes("dRL") && 
  shadow.material.fragmentShader.includes("dRR")
);

// Verify Terrain properties
const track = DD.buildValidTrack('DREAM-12345', 1);
const mockScene = new THREE.Group();
const trackRoot = DD.buildTrackScene(mockScene, track, 'high');

function findMesh(node, predicate) {
  if (predicate(node)) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findMesh(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

const terrainMesh = findMesh(mockScene, c => c.material && c.material.isMeshStandardMaterial && c.material.flatShading);

assert("Terrain mesh exists in scene", terrainMesh !== null);
assert("Terrain is flatShading", terrainMesh.material.flatShading === true);
assert("Terrain is non-indexed", terrainMesh.geometry.isNonIndexed === true);
assert("Terrain uses vertexColors", terrainMesh.material.vertexColors === true);

// Verify coordinates rotation code in trackgen.js via regex
const trackgenContent = fs.readFileSync(path.join(__dirname, '../js/trackgen.js'), 'utf8');
assert("trackgen.js has rotated coordinate calculations", 
  trackgenContent.includes("0.809") && trackgenContent.includes("0.588") && trackgenContent.includes("xr") && trackgenContent.includes("zr")
);

console.log(`\nMilestone 2 Detailed Feature Verification Summary:`);
console.log(`${pass} assertions passed.`);
if (fail > 0) {
  console.error(`${fail} assertions FAILED.`);
  process.exit(1);
} else {
  console.log(`Milestone 2 Detailed Features check: ALL PASSED.`);
  process.exit(0);
}
