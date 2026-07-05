/* DRIFTDREAM drivability test suite — run with: node tests/drivability.js
   Tests the car on a synthetic test track at low/mid/high speed, anchored to real-world lateral g. */
'use strict';
require('../js/core.js');
require('../js/theme.js');
require('../js/trackgen.js');
require('../js/physics.js');
const DD = globalThis.DD;
const V = DD.v;
const P = DD.PHYS;
const G = 9.81;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS', name, detail || ''); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

function flatTrack(width) {
  const samples = [];
  for (let i = 0; i < 3000; i++) {
    samples.push({ p: [0, 4, i * 2], yaw: 0, pitch: 0, bank: 0, w: width || 500, surf: 0, wall: 0, gap: 0, f: [0, 0, 1], u: [0, 1, 0], r: [1, 0, 0], pieceName: 'straight' });
  }
  return { seed: 'FLAT', tier: 1, samples, ds: 2, checkpoints: [], startIdx: 2, finishIdx: 2999, length: 6000, terrain: null, theme: null };
}
const FT = flatTrack();
function spawn(speed) {
  const car = DD.createCar(FT);
  car.vel = [0, 0, speed];
  return car;
}

/* 1 — steering direction: positive steer (right key) must move the car toward screen-right (-x) */
console.log('[1] steering direction');
{
  const car = spawn(40);
  for (let t = 0; t < 90; t++) DD.stepCar(car, { steer: 1, throttle: 0.5, brake: 0 }, FT);
  check('right input goes screen-right', car.pos[0] < -2, 'x=' + car.pos[0].toFixed(1));
  const car2 = spawn(40);
  for (let t = 0; t < 90; t++) DD.stepCar(car2, { steer: -1, throttle: 0.5, brake: 0 }, FT);
  check('left input goes screen-left', car2.pos[0] > 2, 'x=' + car2.pos[0].toFixed(1));
}

/* 2 — braking: from 80 m/s, full brake stops the car and never launches it backwards */
console.log('[2] braking');
{
  const car = spawn(80);
  let stopT = -1, minV = 1e9;
  for (let t = 0; t < 60 * 8; t++) {
    DD.stepCar(car, { steer: 0, throttle: 0, brake: 1 }, FT);
    const vf = car.vel[2];
    minV = Math.min(minV, vf);
    if (stopT < 0 && Math.abs(vf) < 1) stopT = t / 60;
  }
  check('stops from 290 km/h', stopT > 0 && stopT < 5, stopT.toFixed(2) + 's');
  check('no reverse runaway under brake', minV > -P.reverseMax - 0.5, 'min vLong ' + minV.toFixed(1));
}

/* 3 — reverse: capped and recoverable */
console.log('[3] reverse');
{
  const car = spawn(0);
  for (let t = 0; t < 60 * 8; t++) DD.stepCar(car, { steer: 0, throttle: 0, brake: 1 }, FT);
  const revSpeed = -car.vel[2];
  check('reverse capped', revSpeed <= P.reverseMax + 0.5, revSpeed.toFixed(1) + ' m/s');
  for (let t = 0; t < 60 * 3; t++) DD.stepCar(car, { steer: 0, throttle: 1, brake: 0 }, FT);
  check('throttle recovers from reverse', car.vel[2] > 10, 'v=' + car.vel[2].toFixed(1));
}

/* 4 — grip ladder: max sustained lateral g without sliding at low/mid/high speed */
console.log('[4] grip ladder (real-world anchored)');
function maxLatG(speed) {
  // sweep steer to find the largest input that corners steadily without slide
  let best = 0;
  for (let frac = 0.1; frac <= 1.001; frac += 0.05) {
    const car = spawn(speed);
    let slid = false, sumLat = 0, n = 0;
    for (let t = 0; t < 60 * 3; t++) {
      DD.stepCar(car, { steer: frac, throttle: 0.42, brake: 0 }, FT);
      if (t > 60) { // steady state
        if (car.slideState) { slid = true; break; }
        const v = V.len(car.vel);
        sumLat += Math.abs(car.yawRate) * v; n++;
      }
    }
    if (!slid && n > 0) best = Math.max(best, sumLat / n);
  }
  return best / G;
}
{
  const low = maxLatG(20), mid = maxLatG(55), high = maxLatG(95);
  check('low speed (~70 km/h) corners at 1.3-2.6g', low > 1.3 && low < 2.6, low.toFixed(2) + 'g');
  check('mid speed (~200 km/h) corners at 2.4-4.0g', mid > 2.4 && mid < 4.0, mid.toFixed(2) + 'g');
  check('high speed (~340 km/h) corners at 3.8-6g', high > 3.8 && high < 6, high.toFixed(2) + 'g');
  check('grip grows with speed (downforce)', high > mid && mid > low, low.toFixed(1) + ' < ' + mid.toFixed(1) + ' < ' + high.toFixed(1));
}

/* 5 — slide on excess g: pushing past the limit must break traction (and be recoverable) */
console.log('[5] slide behaviour');
{
  const car = spawn(55);
  let slid = false;
  for (let t = 0; t < 60 * 3; t++) {
    DD.stepCar(car, { steer: 1, throttle: 1, brake: 0 }, FT); // way past steady-state grip
    if (car.sliding) { slid = true; break; } // either axle (front plow or rear breakaway)
  }
  check('overdriving breaks traction', slid);
  // recovery: straighten + ease off
  let recT = -1;
  for (let t = 0; t < 60 * 4; t++) {
    DD.stepCar(car, { steer: 0, throttle: 0.4, brake: 0 }, FT);
    if (recT < 0 && !car.slideState && Math.abs(car.slipR) < 0.05) recT = t / 60;
  }
  check('slide recovers when released', recT >= 0 && recT < 2.5, recT.toFixed(2) + 's');
}

/* 6 — slalom at speed: car must stay controllable through quick transitions */
console.log('[6] slalom control');
{
  const car = spawn(60);
  let maxSlip = 0, spun = false;
  for (let t = 0; t < 60 * 6; t++) {
    const steer = Math.sin(t / 60 * Math.PI) > 0 ? 0.7 : -0.7;
    DD.stepCar(car, { steer, throttle: 0.8, brake: 0 }, FT);
    maxSlip = Math.max(maxSlip, Math.abs(car.slipR));
    if (Math.abs(car.slipR) > 1.2) spun = true;
  }
  check('no spin in slalom', !spun, 'max slip ' + (maxSlip * 57.3).toFixed(0) + 'deg');
  check('keeps pace in slalom', V.len(car.vel) > 30, V.len(car.vel).toFixed(1) + ' m/s');
}

/* 7 — donut: full throttle + full lock from standstill */
console.log('[7] donut');
{
  const car = spawn(0);
  let yawTot = 0, prevYaw = 0, maxSlip = 0;
  for (let t = 0; t < 60 * 8; t++) {
    DD.stepCar(car, { steer: 1, throttle: 1, brake: 0 }, FT);
    yawTot += Math.abs(DD.angleDiff(prevYaw, car.yaw)); prevYaw = car.yaw;
    maxSlip = Math.max(maxSlip, Math.abs(car.slipR));
  }
  check('donut spins the car', yawTot > Math.PI * 4, (yawTot / (2 * Math.PI)).toFixed(1) + ' turns');
  check('donut slides the rear', maxSlip > 0.25, (maxSlip * 57.3).toFixed(0) + 'deg');
}

/* 8 — brake-tap drift at speed (the TM move) */
console.log('[8] brake-tap drift');
{
  const car = spawn(60);
  let slid = false;
  for (let t = 0; t < 60 * 3; t++) {
    const brake = (t > 30 && t < 50) ? 1 : 0;
    const steer = t > 24 ? 0.85 : 0;
    DD.stepCar(car, { steer, throttle: brake ? 0 : 1, brake }, FT);
    if (car.slideState) { slid = true; break; }
  }
  check('steer + brake-tap initiates drift', slid);
}

/* 9 — jump: car launches off a kicker instead of sticking */
console.log('[9] jump');
{
  let found = null;
  for (let n = 0; n < 100 && !found; n++) {
    const tr = DD.generateTrack('JUMPSEED-' + n, 3, 0);
    for (const span of tr.pieceSpans) {
      if (span.name === 'kicker' || span.name === 'jumpgap') {
        const car = DD.createCar(tr);
        car.idx = Math.max(2, span.start - 40);
        const s0 = tr.samples[car.idx];
        car.pos = V.addS(V.clone(s0.p), s0.u, 0.4); car.yaw = s0.yaw;
        car.vel = V.scale(s0.f, 55);
        let maxAir = 0;
        for (let t = 0; t < 60 * 6; t++) {
          DD.stepCar(car, { steer: 0, throttle: 1, brake: 0 }, tr);
          maxAir = Math.max(maxAir, car.airTime);
        }
        if (maxAir > 0.4) {
          found = { tr, span };
          break;
        }
      }
    }
  }
  const { tr, span } = found;
  const car = DD.createCar(tr);
  car.idx = Math.max(2, span.start - 40);
  const s0 = tr.samples[car.idx];
  car.pos = V.addS(V.clone(s0.p), s0.u, 0.4); car.yaw = s0.yaw;
  car.vel = V.scale(s0.f, 55);
  let maxAir = 0;
  for (let t = 0; t < 60 * 6; t++) {
    DD.stepCar(car, { steer: 0, throttle: 1, brake: 0 }, tr);
    maxAir = Math.max(maxAir, car.airTime);
  }
  check('kicker launches the car (' + span.name + ')', maxAir > 0.4, maxAir.toFixed(2) + 's airtime');
}

/* 10 — terrain: drivable, slower, grounded */
console.log('[10] terrain driving');
{
  const tr = DD.generateTrack('TERRSEED-1', 2, 0);
  const car = DD.createCar(tr);
  const s = tr.samples[40];
  car.pos = V.addS(V.clone(s.p), s.r, s.w / 2 + 12);
  car.pos[1] = DD.terrainAt(tr.terrain, car.pos[0], car.pos[2]) + 0.1;
  car.idx = 40; car.yaw = s.yaw; car.onDirt = true;
  car.vel = V.scale([Math.sin(s.yaw), 0, Math.cos(s.yaw)], 20);
  let dirtTicks = 0, maxV = 0;
  for (let t = 0; t < 60 * 6; t++) {
    DD.stepCar(car, { steer: 0, throttle: 1, brake: 0 }, tr);
    if (car.onDirt) dirtTicks++;
    maxV = Math.max(maxV, V.len(car.vel));
  }
  check('stays grounded on dirt', dirtTicks > 60 * 6 * 0.7, Math.round(dirtTicks / (60 * 6) * 100) + '%');
  check('dirt is slower than asphalt', maxV < 45, 'max ' + maxV.toFixed(1) + ' m/s');
}

/* 11 — full track suite */
console.log('[11] generated track suite');
{
  let bad = 0, n = 0;
  for (let tier = 1; tier <= 5; tier++) for (let i = 0; i < 3; i++) {
    const tr = DD.buildValidTrack('SUITE-' + tier + '-' + i, tier);
    n++;
    if (tr.attempt < 0) bad++;
  }
  check('all generated tracks bot-completable', bad === 0, (n - bad) + '/' + n);
  const a = DD.buildValidTrack('DET-CHECK', 3), b = DD.buildValidTrack('DET-CHECK', 3);
  check('deterministic', a.medals.author === b.medals.author);
}

/* 12 — gearbox: punchy 0-100, downshift kills drive (the gear-drop puzzle) */
console.log('[12] gearbox');
{
  const car = spawn(0);
  let t100 = -1;
  for (let t = 0; t < 60 * 6; t++) {
    DD.stepCar(car, { steer: 0, throttle: 1, brake: 0 }, FT);
    if (t100 < 0 && car.vel[2] >= 27.8) { t100 = t / 60; break; }
  }
  check('0-100 km/h punchy', t100 > 0.8 && t100 < 2.6, t100.toFixed(2) + 's');
  // gear-drop: cruise in 3rd, scrub below the band, observe the cut
  const c2 = spawn(30); c2.gear = 3; c2.rpm01 = 0.5;
  for (let t = 0; t < 40; t++) DD.stepCar(c2, { steer: 0, throttle: 1, brake: 0 }, FT); // settle
  const gearBefore = c2.gear;
  let guard = 0;
  while (c2.vel[2] > 19.5 && guard++ < 300) DD.stepCar(c2, { steer: 0, throttle: 0, brake: 1 }, FT); // scrub below the band
  DD.stepCar(c2, { steer: 0, throttle: 0, brake: 0 }, FT);
  const cutSeen = c2.shiftCut > 0.1 && c2.gear < gearBefore;
  check('scrubbing speed drops a gear with a long cut', cutSeen, 'gear ' + gearBefore + '->' + c2.gear + ' cut ' + c2.shiftCut.toFixed(2) + 's');
  // during the cut, throttle produces no drive
  const v0 = c2.vel[2];
  for (let t = 0; t < 8; t++) DD.stepCar(c2, { steer: 0, throttle: 1, brake: 0 }, FT);
  check('no drive during shift cut', c2.vel[2] <= v0 + 0.15, (c2.vel[2] - v0).toFixed(2) + ' m/s gained');
}

/* 13 — ice (glass): lateral velocity persists, glide it sideways */
console.log('[13] ice glide');
{
  const iceT = flatTrack();
  for (const s of iceT.samples) s.surf = DD.SURF.GLASS;
  const car = DD.createCar(iceT);
  car.vel = [20, 0, 45]; // entering sideways
  const lat0 = 20;
  for (let t = 0; t < 60 * 2; t++) DD.stepCar(car, { steer: 0, throttle: 0.5, brake: 0 }, iceT);
  const lat = Math.abs(car.vel[0]);
  check('ice keeps sideways momentum', lat > lat0 * 0.45, lat.toFixed(1) + ' of ' + lat0 + ' m/s lateral left after 2s');
}

/* 14 — air brake stabilises rotation */
console.log('[14] air control');
{
  const car = spawn(50);
  car.grounded = false; car.pos[1] = 60; car.vel[1] = 5; car.yawRate = 1.8;
  for (let t = 0; t < 45; t++) DD.stepCar(car, { steer: 0, throttle: 0, brake: 1 }, FT);
  check('air brake stops rotation', Math.abs(car.yawRate) < 0.25, 'yawRate ' + car.yawRate.toFixed(2));
}

/* 15 — brake-tap slide: steady-state turn radius (pure brake-tap, no drift button / no arcade)
   Measures settled circular radius at fixed speed, full steer:
   - GRIP circle: full steer, no brake → radius set by the grip yaw cap.
   - BRAKE-SLIDE circle: brake-tap (8 ticks) to break the rear loose, then throttle through it
     with full steer → radius set by the bicycle-model yaw moment + damped recovery.
   Design now: grip is the tight line at race speed; a brake-tap slide is the controlled-rotation
   move (wider than grip, never understeers into infinity, never spins). The old test asserted a
   drift-tighter-than-grip crossover — that was the arcade-coupling regime, since removed. */
console.log('[15] brake-tap slide (steady-state radius)');
{
  // Steady-state turn radius from a settled circular path: radius = mean distance to the path's
  // centroid over the measurement window (once the circle has settled).
  function settledRadius(pathTrail) {
    let cx = 0, cz = 0;
    for (const p of pathTrail) { cx += p[0]; cz += p[2]; }
    cx /= pathTrail.length; cz /= pathTrail.length;
    let sumR = 0;
    for (const p of pathTrail) sumR += Math.hypot(p[0] - cx, p[2] - cz);
    return sumR / pathTrail.length;
  }

  const SETTLE = 60 * 2;  // 2s to settle into the circle
  const MEASURE = 60 * 3; // 3s of path to measure radius over

  function gripRad(V0) {
    const c = spawn(V0); const tr = [];
    for (let t = 0; t < SETTLE + MEASURE; t++) { DD.stepCar(c, { steer: 1.0, throttle: 1, brake: 0 }, FT); if (t >= SETTLE) tr.push(c.pos.slice()); }
    return settledRadius(tr);
  }
  function brakeSlideRad(V0) {
    const c = spawn(V0); const tr = [];
    for (let t = 0; t < SETTLE + MEASURE; t++) { const brake = (t < 8) ? 1 : 0; const thr = brake ? 0 : 1; DD.stepCar(c, { steer: 1.0, throttle: thr, brake }, FT); if (t >= SETTLE) tr.push(c.pos.slice()); }
    return settledRadius(tr);
  }

  // 25 m/s: just past the kinematic-blend handoff, where grip's yaw cap binds (~v/yawMax).
  const V = 25;
  const rG = gripRad(V), rB = brakeSlideRad(V);

  // Sanity: both regimes produce real circles (not straight / not spinning on the spot). Brake-
  // slide floor is low (3m) — a brake-tap at 25 m/s can settle into a tight pivot, like grip's
  // low-speed kinematic circle; the spin-out check below guards the real failure mode.
  check('grip circle plausible', rG > 10 && rG < 120, 'grip ' + rG.toFixed(1) + 'm');
  check('brake-slide circle plausible', rB > 3 && rB < 200, 'brake-slide ' + rB.toFixed(1) + 'm');

  // Brake-slide is bounded — does NOT plow off into a near-straight line (the understeer failure
  // mode). Cap at 3x grip radius: a controlled slide, not momentum carrying the car wide.
  check('brake-slide bounded (no understeer plow)', rB <= rG * 3.0, 'brake-slide ' + rB.toFixed(1) + 'm vs grip ' + rG.toFixed(1) + 'm');

  // Brake-slide must not spin out.
  const carBrakeSpin = spawn(V);
  for (let t = 0; t < SETTLE + MEASURE; t++) { const brake = (t < 8) ? 1 : 0; const thr = brake ? 0 : 1; DD.stepCar(carBrakeSpin, { steer: 1.0, throttle: thr, brake }, FT); }
  check('brake-slide did not spin out', Math.abs(carBrakeSpin.slipR) < 1.0, 'final slipR ' + (carBrakeSpin.slipR * 57.3).toFixed(1) + ' deg');
}

/* ---- [16] closed circuits: loop closure geometry + multilap completion ---- */
console.log('[16] closed circuits (multilap)');
{
  let closedTrack = null, seedUsed = null;
  for (let i = 0; i < 30 && !closedTrack; i++) {
    const t = DD.generateTrack('DRIVLOOP-' + i, 3, 0);
    if (t.closed && t.overlapForced === 0) { closedTrack = t; seedUsed = 'DRIVLOOP-' + i; }
  }
  check('closed circuits generate', !!closedTrack, seedUsed || 'none in 30 seeds');
  if (closedTrack) {
    const t = closedTrack;
    const a = t.samples[t.samples.length - 1].p, b = t.samples[0].p;
    const seam = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const yawErr = Math.abs(DD.angleDiff(t.samples[t.samples.length - 1].yaw, 0));
    check('loop seam is one sample step', seam < t.ds * 1.5, 'seam gap ' + seam.toFixed(2) + 'm');
    check('loop heading closes', yawErr < 0.03, 'yaw err ' + (yawErr * 57.3).toFixed(2) + ' deg');
    check('circuit runs multiple laps', t.laps >= 2, t.laps + ' laps of ' + Math.round(t.length) + 'm');
    const bot = DD.runBot(t, { recordFrames: true });
    check('bot completes all laps', bot.ok && bot.respawns === 0, bot.ok ? (bot.ms + 'ms, ' + bot.respawns + ' respawns') : bot.reason);
    if (bot.ok) {
      check('splits cover every lap', bot.splits.length === t.checkpoints.length * t.laps,
        bot.splits.length + ' splits vs ' + t.checkpoints.length + ' ckpts x ' + t.laps + ' laps');
    }
  }
}

/* ---- [17] terrain landforms: rise beyond the corridor, never touch the road ---- */
console.log('[17] terrain landforms (C3 height policy)');
{
  let worstClear = 1e9, gapWorst = 1e9, canyonRise = -1e9;
  for (const [s, tier] of [['TERRA-0', 5], ['TERRA-1', 3], ['CAMP-T3-01', 3], ['CAMP-T2-03', 2]]) {
    const t = DD.generateTrack(s, tier, 0);
    const T = t.terrain;
    const oldCeiling = Math.min.apply(null, t.samples.map(x => x.p[1])) - 8;
    let maxH = -1e9;
    for (let k = 0; k < T.heights.length; k++) maxH = Math.max(maxH, T.heights[k]);
    if (t.theme.biome === 'canyon') canyonRise = Math.max(canyonRise, maxH - oldCeiling);
    for (const smp of t.samples) {
      const th = DD.terrainAt(T, smp.p[0], smp.p[2]);
      if (smp.gap) gapWorst = Math.min(gapWorst, smp.p[1] - th);
      else worstClear = Math.min(worstClear, (smp.p[1] - Math.abs(smp.r[1]) * (smp.w / 2)) - th);
    }
  }
  check('road always clears terrain', worstClear > 1.0, 'worst clearance ' + worstClear.toFixed(2) + 'm');
  check('gap chasms stay deep', gapWorst > 10, 'shallowest chasm ' + gapWorst.toFixed(1) + 'm');
  check('canyon walls rise above the old global ceiling', canyonRise > 20, '+' + canyonRise.toFixed(1) + 'm (CAMP-T3-01)');
}

/* ---- [18] bot corner speed tracks the player's grip budget (C4c regression lock) ----
   The expert solver used to budget only (gripF+gripR)*0.5 = 1.66g lateral while the player's grip
   regime allows ~3g — so the bot cornered at ~0.74x human speed and every medal was trivial. This
   test locks the fix: on a known-radius constant corner, the bot's target corner speed must be
   within 10% of the physics grip-limit prediction v = sqrt(gripAvail * R), where gripAvail is the
   player's available grip (0.90 of gripF+gripR, matching the solver). */
console.log('[18] bot corner speed tracks grip budget (C4c)');
{
  // Build a flat track with a long constant-radius corner (R = 80m) so the speed solver settles.
  const R = 80, DS = 2;
  const pre = 60, post = 60;   // straights either side
  const arcSamples = Math.round((Math.PI / 2) * R / DS); // 90 degrees of arc
  const samples = [];
  for (let i = 0; i < pre; i++) samples.push({ p: [0, 4, i * DS], yaw: 0, pitch: 0, bank: 0, w: 30, surf: 0, wall: 0, gap: 0, f: [0,0,1], u: [0,1,0], r: [1,0,0], pieceName: 'straight' });
  const cx = R, cz = pre * DS;
  for (let i = 0; i < arcSamples; i++) {
    const a = (i + 1) * DS / R;
    const px = cx - R * Math.sin(a), pz = cz + R * Math.cos(a), yaw = a;
    samples.push({ p: [px, 4, pz], yaw, pitch: 0, bank: 0, w: 30, surf: 0, wall: 0, gap: 0,
                   f: [Math.sin(yaw),0,Math.cos(yaw)], u: [0,1,0], r: [Math.cos(yaw),0,-Math.sin(yaw)], pieceName: 'sweeper' });
  }
  const last = samples[samples.length - 1];
  for (let i = 0; i < post; i++) {
    const px = last.p[0] + Math.sin(Math.PI/2)*(i+1)*DS, pz = last.p[2] + Math.cos(Math.PI/2)*(i+1)*DS;
    samples.push({ p: [px, 4, pz], yaw: Math.PI/2, pitch: 0, bank: 0, w: 30, surf: 0, wall: 0, gap: 0, f: [1,0,0], u: [0,1,0], r: [0,0,-1], pieceName: 'straight' });
  }
  const total = samples.length;
  const CT = { seed: 'CORNER18', tier: 3, samples, ds: DS, checkpoints: [], startIdx: 2, finishIdx: total - 1, length: total * DS, terrain: null, theme: null };
  const cornerMidIdx = pre + Math.floor(arcSamples / 2);

  // The bot's expert data carries the per-sample target speeds. buildExpertData is file-local in
  // physics.js and is populated lazily onto track.expert by getBotInput (via runBot). Run the bot
  // to populate it, then read the corner target speed.
  DD.runBot(CT, { recordFrames: false });
  const expert = CT.expert;
  const botV = expert.botSpeeds[cornerMidIdx];

  // Physics grip-limit prediction at this radius (no bank, no downforce at this speed regime):
  // v = sqrt(gripAvail * R), gripAvail = 0.90*(gripF+gripR) — the solver's budget.
  const gripAvail = (P.gripF + P.gripR) * 0.90;
  const predictedV = Math.sqrt(gripAvail * R);

  // The solver also applies accel/decel sweeps and a 22 m/s floor, so the realized speed may be a
  // touch under the pure corner limit. Allow the bot within 10% of prediction (above 0.90x would
  // mean it's not using the grip; the old code landed near 0.74x).
  check('bot corner speed within 10% of grip-limit prediction', botV >= predictedV * 0.90 && botV <= predictedV * 1.05,
    'bot ' + botV.toFixed(1) + ' m/s vs predicted ' + predictedV.toFixed(1) + ' m/s (R=' + R + 'm)');
  // And the old defect must be gone: bot speed clearly above the half-grip prediction (the bug).
  const buggyV = Math.sqrt((P.gripF + P.gripR) * 0.5 * R);
  check('bot faster than the old half-grip budget', botV > buggyV * 1.10,
    'bot ' + botV.toFixed(1) + ' m/s vs old buggy ' + buggyV.toFixed(1) + ' m/s');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
