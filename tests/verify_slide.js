/* DRIFTDREAM powerslide + wall + grounding acceptance suite — run with: node tests/verify_slide.js
   Encodes the slide DESIGN CONTRACT so it can't regress into feel-only tuning:
   - slide is the fastest tool ONLY in corners too sharp for the grip yaw cap at speed
   - entry builds progressively (no shunt, no snap), throttle holds it, straighten exits it
   - walls: grazes nearly free, square hits hurt, nose never clips through
   - grounding: no teleport-up from terrain, tunneling protection kept */
'use strict';
require('../js/core.js');
require('../js/theme.js');
require('../js/trackgen.js');
require('../js/physics.js');
const DD = globalThis.DD;
const V = DD.v;
const P = DD.PHYS;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS', name, detail || ''); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

function flatTrack(width, wall) {
  const samples = [];
  for (let i = 0; i < 3000; i++) {
    samples.push({ p: [0, 4, i * 2], yaw: 0, pitch: 0, bank: 0, w: width || 500, surf: 0, wall: wall ? 1 : 0, gap: 0, f: [0, 0, 1], u: [0, 1, 0], r: [1, 0, 0], pieceName: 'straight' });
  }
  return { seed: 'FLAT', tier: 1, samples, ds: 2, checkpoints: [], startIdx: 2, finishIdx: 2999, length: 6000, terrain: null, theme: null };
}
const FT = flatTrack();
const WT = flatTrack(14, true); // narrow walled corridor

function spawn(track, speed) {
  const car = DD.createCar(track);
  car.vel = [0, 0, speed];
  return car;
}
// chassis slip angle (velocity vs nose), signed, in the car's horizontal frame
function beta(car) {
  const f = [Math.sin(car.yaw), 0, Math.cos(car.yaw)];
  const r = [f[2], 0, -f[0]];
  const vLong = V.dot(car.vel, f), vLat = V.dot(car.vel, r);
  return Math.atan2(vLat, vLong);
}
const spd = (car) => Math.hypot(car.vel[0], car.vel[2]);

/* 1 — entry is weight transfer, not an anchor (the "shunt" test) */
console.log('[1] slide entry — no shunt');
{
  const car = spawn(FT, 60);
  let maxAbsBetaEarly = 0;
  for (let t = 0; t < 18; t++) { // 0.3 s: brake-tap window
    DD.stepCar(car, { steer: 1, throttle: 0, brake: t < 15 ? 1 : 0 }, FT);
    if (t <= 9) maxAbsBetaEarly = Math.max(maxAbsBetaEarly, Math.abs(beta(car)));
  }
  check('latched the slide', car.slideHold === true);
  check('speed kept through the tap (>=52 of 60)', spd(car) >= 52, spd(car).toFixed(1) + ' m/s');
  check('angle builds, not snaps (|beta|@0.15s < 0.35)', maxAbsBetaEarly < 0.35, maxAbsBetaEarly.toFixed(2) + ' rad');
}

/* 2 — held slide: sits sideways at a bounded angle, throttle holds it, no spin */
console.log('[2] held slide');
{
  const car = spawn(FT, 62);
  for (let t = 0; t < 15; t++) DD.stepCar(car, { steer: 1, throttle: 0, brake: 1 }, FT);
  let maxB = 0;
  for (let t = 0; t < 90; t++) { // 1.5 s carried on throttle
    DD.stepCar(car, { steer: 1, throttle: 1, brake: 0 }, FT);
    maxB = Math.max(maxB, Math.abs(beta(car)));
  }
  check('still latched under throttle', car.slideHold === true);
  check('visibly sideways (|beta| >= 0.25 rad)', maxB >= 0.25, maxB.toFixed(2) + ' rad');
  check('never spins (|beta| < 1.1 rad)', maxB < 1.1, maxB.toFixed(2) + ' rad');
  check('carries speed (>= 40 m/s)', spd(car) >= 40, spd(car).toFixed(1) + ' m/s');
}

/* 3 — purpose: at speed, the slide out-rotates the grip regime (the corner-too-sharp tool) */
console.log('[3] slide beats grip rotation at speed');
{
  const grip = spawn(FT, 60);
  for (let t = 0; t < 150; t++) DD.stepCar(grip, { steer: 1, throttle: 1, brake: 0 }, FT);
  const slide = spawn(FT, 60);
  for (let t = 0; t < 150; t++) {
    DD.stepCar(slide, { steer: 1, throttle: t < 15 ? 0 : 1, brake: t < 15 ? 1 : 0 }, FT);
  }
  const gy = Math.abs(grip.yaw), sy = Math.abs(slide.yaw);
  check('slide rotates >= 1.25x grip over 2.5s', sy >= gy * 1.25, 'slide ' + sy.toFixed(2) + ' vs grip ' + gy.toFixed(2) + ' rad');
  check('slide still fast (>= 0.55x entry)', spd(slide) >= 33, spd(slide).toFixed(1) + ' m/s');
}

/* 4 — grip stays king on gentle input and below the speed gate */
console.log('[4] grip line untouched');
{
  const car = spawn(FT, 60);
  let maxMix = 0;
  for (let t = 0; t < 120; t++) {
    DD.stepCar(car, { steer: 0.4, throttle: 1, brake: 0 }, FT);
    maxMix = Math.max(maxMix, car.regimeMix);
  }
  check('moderate sweeper steer never enters slide dynamics', maxMix < 0.2, 'mix ' + maxMix.toFixed(2));

  const slow = spawn(FT, 30); // below slideAssistVLo
  for (let t = 0; t < 60; t++) DD.stepCar(slow, { steer: 1, throttle: 0, brake: t < 15 ? 1 : 0 }, FT);
  check('no latch below the speed gate', slow.slideHold === false);
}

/* 5 — exit: straighten the wheel, the car gathers itself up */
console.log('[5] slide exit');
{
  const car = spawn(FT, 62);
  for (let t = 0; t < 15; t++) DD.stepCar(car, { steer: 1, throttle: 0, brake: 1 }, FT);
  for (let t = 0; t < 60; t++) DD.stepCar(car, { steer: 1, throttle: 1, brake: 0 }, FT);
  for (let t = 0; t < 90; t++) DD.stepCar(car, { steer: 0, throttle: 1, brake: 0 }, FT); // release
  check('latch released on straighten', car.slideHold === false);
  check('car gathered up (|beta| < 0.15)', Math.abs(beta(car)) < 0.15, Math.abs(beta(car)).toFixed(2) + ' rad');
  check('no residual spin (|yawRate| < 0.5)', Math.abs(car.yawRate) < 0.5, car.yawRate.toFixed(2));
}

/* 6 — walls: graze nearly free, square hit hurts, nose contained */
console.log('[6] walls');
{
  // graze: steer held gently INTO the wall — the classic pinned scrape along the fence
  const car = spawn(WT, 60);
  car.pos[0] = 5.5; car.vel = [0, 0, 60];
  let hitTicks = 0;
  for (let t = 0; t < 90; t++) {
    DD.stepCar(car, { steer: -0.3, throttle: 1, brake: 0 }, WT); // negative steer = toward +x wall
    DD.postWallClamp(car, WT);
    if (car.hitWall) hitTicks++;
  }
  check('grazing contact happened', hitTicks > 5, hitTicks + ' contact ticks');
  check('pinned scrape is cheap (>= 45 of ~60 m/s)', spd(car) >= 45, spd(car).toFixed(1) + ' m/s');
  const lim = 7 - P.carHalfW;
  check('held inside the wall', Math.abs(car.pos[0]) <= lim + 0.35, 'x=' + car.pos[0].toFixed(2));

  // square-ish hit: 45° into the wall at speed
  const car2 = spawn(WT, 60);
  car2.pos[0] = 0; car2.vel = [40, 0, 40]; car2.yaw = Math.atan2(40, 40);
  let minVz = 1e9, maxYawRate = 0;
  for (let t = 0; t < 60; t++) {
    DD.stepCar(car2, { steer: 0, throttle: 1, brake: 0 }, WT);
    DD.postWallClamp(car2, WT);
    minVz = Math.min(minVz, car2.vel[2]);
    maxYawRate = Math.max(maxYawRate, Math.abs(car2.yawRate));
  }
  check('hard hit costs real speed (< 52 m/s after)', spd(car2) < 52, spd(car2).toFixed(1) + ' m/s');
  check('never reverses/flings backwards', minVz > -1, 'min vz ' + minVz.toFixed(1));
  check('no spin from the wall', maxYawRate <= 3.4 + 1e-6, maxYawRate.toFixed(2));
  check('body stays clamped', Math.abs(car2.pos[0]) <= lim + 0.35, 'x=' + car2.pos[0].toFixed(2));

  // nose containment: car angled at the wall — the FRONT point must not clip through
  const car3 = spawn(WT, 40);
  car3.pos[0] = lim - 0.1; car3.yaw = 0.5; car3.vel = [Math.sin(0.5) * 40, 0, Math.cos(0.5) * 40];
  for (let t = 0; t < 30; t++) {
    DD.stepCar(car3, { steer: 0, throttle: 1, brake: 0 }, WT);
    DD.postWallClamp(car3, WT);
    const fx = car3.pos[0] + Math.sin(car3.yaw) * P.cgF;
    check.noseOk = (check.noseOk === undefined ? true : check.noseOk) && fx <= lim + 0.05;
  }
  check('front point never passes the wall plane', check.noseOk === true);
}

/* 7 — grounding: no teleport-up, tunneling protection kept */
console.log('[7] re-ground rules');
{
  // arriving from terrain 0.8 m below deck: must NOT snap up onto the road
  const car = spawn(FT, 30);
  car.grounded = true; car.onDirt = true;
  car.pos = [0, 4 - 0.8, 10]; car.vel = [0, 0, 30];
  DD.stepCar(car, { steer: 0, throttle: 1, brake: 0 }, FT);
  check('no teleport up from dirt beside/below deck', car.pos[1] < 3.6, 'y=' + car.pos[1].toFixed(2));

  // falling fast through the deck band: still caught (tunneling protection)
  const car2 = spawn(FT, 30);
  car2.grounded = false;
  car2.pos = [0, 4 - 1.5, 10]; car2.vel = [0, -20, 30];
  DD.stepCar(car2, { steer: 0, throttle: 0, brake: 0 }, FT);
  check('falling car still grounds (no tunnel-through)', car2.grounded === true && Math.abs(car2.pos[1] - 4.02) < 0.1, 'y=' + car2.pos[1].toFixed(2));

  // rising underneath the deck: must NOT get sucked up through it
  const car3 = spawn(FT, 30);
  car3.grounded = false;
  car3.pos = [0, 4 - 1.5, 10]; car3.vel = [0, 1.0, 30];
  DD.stepCar(car3, { steer: 0, throttle: 0, brake: 0 }, FT);
  check('rising car not snapped through the deck', car3.grounded === false, 'y=' + car3.pos[1].toFixed(2));
}

/* 8 — determinism: identical inputs, identical trajectory */
console.log('[8] determinism');
{
  const run = () => {
    const car = spawn(FT, 60);
    for (let t = 0; t < 200; t++) {
      DD.stepCar(car, { steer: 1, throttle: t < 15 ? 0 : 1, brake: t < 15 ? 1 : 0 }, FT);
      DD.postWallClamp(car, FT);
    }
    return [car.pos[0], car.pos[1], car.pos[2], car.yaw, car.yawRate];
  };
  const a = run(), b = run();
  check('bit-identical replay', a.every((v, i) => v === b[i]), JSON.stringify(a.map(x => +x.toFixed(4))));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
