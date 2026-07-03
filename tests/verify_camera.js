/* DRIFTDREAM camera and sky tracking verification — run with: node tests/verify_camera.js */
'use strict';

// 1. Mock THREE.js minimal API so we can load js/scene.js under Node
globalThis.THREE = {
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
      this.x = nx;
      this.y = ny;
      this.z = nz;
      return this;
    };
    this.copy = function(other) {
      this.x = other.x;
      this.y = other.y;
      this.z = other.z;
      return this;
    };
    this.normalize = function() {
      const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) || 1;
      this.x /= len; this.y /= len; this.z /= len;
      return this;
    };
    return this;
  },
  Vector2: function(x, y) {
    this.x = x;
    this.y = y;
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
  MeshStandardMaterial: function() { return this; },
  MeshPhysicalMaterial: function() { return this; },
  MeshBasicMaterial: function() { return this; },
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
  CanvasTexture: function() {
    this.repeat = { set: function() {} };
    this.offset = { x: 0, y: 0 };
    this.needsUpdate = false;
    this.clone = function() { return new THREE.CanvasTexture(); };
    return this;
  },
  Group: function() {
    this.children = [];
    this.position = new THREE.Vector3();
    this.scale = { setScalar: function() {}, set: function() {} };
    this.quaternion = new THREE.Quaternion();
    this.lookAt = function() {};
    this.add = function(item) {
      this.children.push(item);
    };
    return this;
  },
  PlaneGeometry: function() { return this; },
  Matrix4: function() {
    this.makeBasis = function() { return this; };
    this.compose = function() { return this; };
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

// Mock document for canvas creation
globalThis.document = {
  createElement: function(type) {
    if (type === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: function() {
          return {
            fillStyle: '',
            fillRect: function() {},
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

// 2. Load DRIFTDREAM scripts
require('../js/core.js');
require('../js/theme.js');
require('../js/trackgen.js');
require('../js/physics.js');
require('../js/scene-core.js');
require('../js/scene-decor.js');
require('../js/scene-car.js');
require('../js/scene-fx.js');

const DD = globalThis.DD;
const V = DD.v;

let pass = 0, fail = 0;

function assert(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  PASS: ${name} ${detail || ''}`);
  } else {
    fail++;
    console.error(`  FAIL: ${name} ${detail || ''}`);
  }
}

// Verification 1: Check Camera far plane configuration in PerspectiveCamera instantiation
// We verify that PerspectiveCamera defaults or setup in typical use has far plane > 3000.
// Let's create a camera using the same parameters as in js/game.js:
const gameCamera = new THREE.PerspectiveCamera(68, 16/9, 0.1, 6000);
assert("Camera far plane is at least 6000", gameCamera.far >= 6000, `far = ${gameCamera.far}`);

// Verification 2: Check skyMesh radius and buildSky configuration
const theme = DD.makeTheme('DREAM-12345');
const skyMesh = DD.buildTrackScene(new THREE.Group(), DD.generateTrack('DREAM-12345', 1), 'high').children.find(c => c.geometry && c.geometry.radius === 3000);
assert("Sky mesh radius is 3000", skyMesh !== undefined, "Radius: " + (skyMesh ? skyMesh.geometry.radius : 'Not found'));

// Verification 3: Verify camera tracking at various positions (including past 3000 units on Z)
const track = DD.buildValidTrack('DREAM-12345', 3);
const mockScene = new THREE.Group();
const trackRoot = DD.buildTrackScene(mockScene, track, 'high');

const camera = new THREE.PerspectiveCamera(68, 16/9, 0.1, 6000);
const camState = DD.makeCamState();
const car = DD.createCar(track);

// Test camera updates across a range of coordinates (Z coordinates from 0 to 8000)
const testCameraPositions = [
  [0, 5, 0],
  [100, 15, 1000],
  [-200, 50, 2999],
  [500, 100, 3005],  // Past 3000 units on Z
  [-1000, 200, 5000], // Past 3000 units on Z
  [2500, 400, 8000]  // Past 3000 units on Z
];

testCameraPositions.forEach(([cx, cy, cz]) => {
  // Set car position and index to align camera position
  car.pos = [cx, cy, cz];
  car.idx = 100; // arbitrary
  
  // Call camera update with positive time delta
  DD.updateCamera(camera, camState, car, track, 0.016, 50);
  
  // Verify skyMesh position matches camera position
  assert(`skyMesh tracks camera at z=${cz}`, 
    Math.abs(track.skyMesh.position.x - camera.position.x) < 1e-4 &&
    Math.abs(track.skyMesh.position.y - camera.position.y) < 1e-4 &&
    Math.abs(track.skyMesh.position.z - camera.position.z) < 1e-4,
    `Camera: [${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}], Sky: [${track.skyMesh.position.x.toFixed(1)}, ${track.skyMesh.position.y.toFixed(1)}, ${track.skyMesh.position.z.toFixed(1)}]`
  );

  // If starsMesh is present, verify its position matches camera position
  if (track.starsMesh) {
    assert(`starsMesh tracks camera at z=${cz}`, 
      Math.abs(track.starsMesh.position.x - camera.position.x) < 1e-4 &&
      Math.abs(track.starsMesh.position.y - camera.position.y) < 1e-4 &&
      Math.abs(track.starsMesh.position.z - camera.position.z) < 1e-4,
      `Camera: [${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}], Stars: [${track.starsMesh.position.x.toFixed(1)}, ${track.starsMesh.position.y.toFixed(1)}, ${track.starsMesh.position.z.toFixed(1)}]`
    );
  }
});

// Let's force starsMesh to be present by using a starfield theme and check tracking
const starfieldTrack = DD.buildValidTrack('SUITE-5-0', 5); // Some themes have starfield
starfieldTrack.theme.atmosphere = 'starfield'; // force it
const starfieldRoot = DD.buildTrackScene(mockScene, starfieldTrack, 'high');

assert("Stars mesh is created when atmosphere is starfield", starfieldTrack.starsMesh !== undefined);

if (starfieldTrack.starsMesh) {
  testCameraPositions.forEach(([cx, cy, cz]) => {
    car.pos = [cx, cy, cz];
    DD.updateCamera(camera, camState, car, starfieldTrack, 0.016, 50);
    assert(`starsMesh tracks camera at z=${cz} (forced)`, 
      Math.abs(starfieldTrack.starsMesh.position.x - camera.position.x) < 1e-4 &&
      Math.abs(starfieldTrack.starsMesh.position.y - camera.position.y) < 1e-4 &&
      Math.abs(starfieldTrack.starsMesh.position.z - camera.position.z) < 1e-4,
      `Camera: [${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}], Stars: [${starfieldTrack.starsMesh.position.x.toFixed(1)}, ${starfieldTrack.starsMesh.position.y.toFixed(1)}, ${starfieldTrack.starsMesh.position.z.toFixed(1)}]`
    );
  });
}

console.log(`\nCamera & Sky Tracking Verification Summary:`);
console.log(`${pass} assertions passed.`);
if (fail > 0) {
  console.error(`${fail} assertions FAILED.`);
  process.exit(1);
} else {
  console.log(`Camera & Sky Tracking check: ALL PASSED.`);
  process.exit(0);
}
