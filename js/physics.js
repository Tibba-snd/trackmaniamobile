/* DRIFTDREAM physics — two-axle slip model (front steers, rear drives), fixed 60Hz, deterministic.
   TM-inspired: steering input ramps like a wheel, brake-tap initiates drift, grip fades slightly
   with speed, downforce stabilises, slides are controllable and carry speed. THREE-free. */
(function (global) {
  'use strict';
  const DD = global.DD;
  const V = DD.v;

  const TICK = 1 / 60;
  DD.TICK = TICK;

  const P = DD.PHYS = {
    gravity: 30,
    // longitudinal
    /* gearbox IS the physics (TM gear-drop puzzle): per-gear punch, torque rises with rpm,
       shifts cut drive — downshifts cut it longer. Scrub speed mid-corner = drop a gear = dead exit. */
    gearV: [0, 14, 24, 38, 56, 78, 109],   // upshift speeds (m/s); 6 gears
    gearAccel: [26, 22, 18, 14, 11, 8.5],  // peak accel per gear (m/s^2) — punchy launch, tapering top end
    rpmTorqueLo: 0.6,                       // torque fraction at bottom of a gear (rises to 1.0 at top)
    shiftCutUp: 0.10,                       // s of zero drive on upshift
    shiftCutDown: 0.26,                     // s of zero drive on downshift — the "gear drop" pain
    downshiftHyst: 0.86,                    // drop below 86% of the gear floor to downshift
    vmax: 108,             // ~390 km/h
    brakeDec: 34,
    dragK: 0.00052,
    rollDrag: 0.2,
    slopeFactor: 0.55,
    boostAccel: 30,
    boostMaxV: 126,
    // chassis
    wheelbase: 3.1, cgF: 1.55, cgR: 1.55,
    yawInertia: 2.2,
    // steering (front wheels)
    steerMaxLow: 0.62,     // rad at standstill -> ~4.5m turn radius (slide regime + low-speed kinematic)
    steerMaxHigh: 0.19,    // rad at vmax
    yawMax: 1.4,           // grip-regime yaw cap (rad/s) — tight, eager turn-in
    yawTrack: 15,          // how fast yaw reaches target — high = immediate, sharp bite
    reverseMax: 9,         // m/s reverse cap
    steerRampUp: 14,       // input slew /s — quick, eager wheel
    steerRampDown: 18,
    // tires — tuned for CONSISTENCY (learnable), not realism
    /* FLAT grip curve: ~2.8g low speed → ~3.6g high. Same input feels the same at any
       speed, so the car is readable. Downforce only gently extends it for fast sweepers. */
    gripF: 15,             // mechanical grip per axle (m/s^2); front+rear ≈ 3.2g total
    gripR: 16,             // rear bias = stability
    stiffK: 10,            // cornering stiffness — crisp turn-in (knee near 5.7° slip)
    tireKnee: 2.2,         // smoothness of the grip rolloff (higher = sharper, more grip available)
    steerAssistLim: 1.4,   // invisible assist: useful-lock band (× saturation slip)
    overdriveGain: 0.4,    // steering past the band still adds turn, but at 40% — proportional, not clipped
    counterAssist: 16,     // invisible assist: continuous auto-countersteer (rad/s² per rad rear slip)
    highSpeedFade: 0,
    downforceV: 30,
    downforceK: 0.085,     // total grip rises ~3.2g→4.1g with speed — fast corners stay planted
    // weight transfer-ish grip modifiers
    brakeFrontGripMul: 0.85,
    brakeRearGripMul: 0.5,  // brake-tap = rear washes out = drift entry
    driveRearGripMul: 0.45, // throttle cuts rear grip — but only at low speed (donuts), fades by powerOversteerV
    powerOversteerV: 45,    // m/s above which throttle no longer destabilises the rear
    driftBtnRearMul: 0.42,
    driftYawAuthority: 5.5, // yaw acceleration factor when steering in drift (arcade authority)
    // C4b v2: velocity-to-heading coupling while drift is HELD. The v1 curve (Lo 7 -> Hi 3.5) made
    // drift WEAKEST at race speed — exactly backwards. Real corner entry is 250-300+ km/h, and that's
    // where drift must beat grip/coast/wall-riding. So the curve INVERTS: modest at low speed (grip
    // still wins tight low-speed corners = honest skill curve), STRONG at high speed (drift is the
    // fast-corner tool — coupling rises above grip's 12/s so the velocity vector actually follows
    // the nose against high momentum). Combined with speed-capped scrub below, drift holds speed and
    // tightens the line through fast corners.
    driftCouplingLo: 4.5,   // coupling /s at low speed — grip stays the tighter line for slow hairpins
    driftCouplingHi: 18.0,  // coupling /s at high speed (>= ~55 m/s / 200 km/h) — drift rotates through tight fast corners grip can't hold (yaw-capped)
    slideRearMul: 0.92,     // once sliding, rear stays a touch loose (drifts hold, weak feedback loop)
    slideYawDamp: 1.6,      // extra yaw damping while sliding — drifts recover, don't spin
    slideEnter: 0.15, slideExit: 0.07, // rad rear slip hysteresis
    sdBoost: 1.4,           // speed-drift exploit: small accel while sliding shallow at speed
    // surfaces
    glassGripMul: 0.12, glassSteerMul: 0.6, // glass = ICE: nearly no lateral friction, glide it sideways
    dirtGripMul: 0.5, dirtDragK: 0.008, dirtAccelMul: 0.62,
    dirtStickBand: 1.4, dirtLaunchVu: 7,
    // air
    airSteer: 1.1,
    airPitch: 1.6,
    landKeepMin: 0.7,
    // track interaction
    edgeMargin: 0.4,
    shoulderWidth: 2.2,
    shoulderScrub: 0.99,
    shoulderPush: 9,
    wallBounce: 0.22,
    wallFriction: 0.94,      // C4b v2: 0.986 -> 0.94. Wall-riding was nearly free (kept 98.6% speed
                             // per impact), so railing the fence beat drifting in every corner.
                             // 0.94 makes a real scrape cost ~6% speed/contact — sparks stay cool,
                             // but leaning on the wall every corner is no longer the fast line.
    launchVu: 2.5,          // upward speed rel. surface that releases the car (jumps!)
    outOfWorld: 60          // below terrain min -> respawn
  };

  DD.SURF = DD.SURF || {};
  DD.SURF.DIRT = 3;

  DD.createCar = function (track) {
    const s0 = track.samples[track.startIdx];
    return {
      pos: V.addS(V.clone(s0.p), s0.u, 0.4),
      vel: [0, 0, 0],
      yaw: s0.yaw,
      yawRate: 0,
      steerPos: 0,
      gear: 1, rpm01: 0, shiftCut: 0, suspY: 0, suspV: 0, lastPitch: 0, wheelAngle: 0,
      pitchVis: 0, rollVis: 0,
      grounded: true, onDirt: false,
      idx: track.startIdx,
      slideState: false, sliding: false, slipR: 0, slipF: 0,
      airTime: 0,
      surf: 0,
      finished: false,
      missedCkpt: false,
      nextCkpt: 0,
      lap: 0,
      awaitSeam: false, // circuits: set after a non-final lap-line crossing until idx wraps
      time: 0,
      splits: [],
      ckptState: null,
      boostGlow: 0,
      respawns: 0
    };
  };

  DD.snapshotCheckpoint = function (car) {
    car.ckptState = { speed: V.len(car.vel), idx: car.idx, nextCkpt: car.nextCkpt, lap: car.lap, awaitSeam: car.awaitSeam };
  };

  DD.respawnCheckpoint = function (car, track) {
    const c = car.ckptState;
    const idx = c ? c.idx : track.startIdx;
    const s = track.samples[idx];
    car.pos = V.addS(V.clone(s.p), s.u, 0.4);
    car.yaw = s.yaw;
    const sp = c ? Math.min(c.speed, 28) : 0;
    car.vel = V.scale(s.f, sp);
    car.idx = idx;
    car.nextCkpt = c ? c.nextCkpt : 0;
    car.lap = c ? (c.lap || 0) : 0;
    car.awaitSeam = c ? !!c.awaitSeam : false;
    car.grounded = true; car.onDirt = false; car.slideState = false;
    car.yawRate = 0; car.steerPos = 0; car.airTime = 0; car.missedCkpt = false;
    car.shiftCut = 0; car.suspY = 0; car.suspV = 0;
    car.gear = 1;
    while (car.gear < P.gearV.length - 1 && sp > P.gearV[car.gear]) car.gear++;
    car.respawns++;
  };

  function updateGear(car, speed, dt) {
    const GV = P.gearV;
    if (speed > GV[car.gear] && car.gear < GV.length - 1) {
      car.gear++; car.shiftCut = Math.max(car.shiftCut, P.shiftCutUp); car.justShifted = 1;
    } else if (car.gear > 1 && speed < GV[car.gear - 1] * P.downshiftHyst) {
      car.gear--; car.shiftCut = Math.max(car.shiftCut, P.shiftCutDown); car.justShifted = -1;
    }
    const lo = GV[car.gear - 1], hi = GV[car.gear];
    car.rpm01 = DD.clamp((speed - lo) / Math.max(hi - lo, 1), 0, 1.05);
    if (car.shiftCut > 0) car.shiftCut = Math.max(0, car.shiftCut - dt);
  }

  function carForward(car, u) {
    const f0 = [Math.sin(car.yaw), 0, Math.cos(car.yaw)];
    const d = V.dot(f0, u);
    return V.norm(V.addS(f0, u, -d));
  }

  /* input: { throttle 0..1, brake 0..1, steer -1..1, drift bool } */
  DD.stepCar = function (car, input, track) {
    if (car.finished) return;
    car.hitWall = false;
    const dt = TICK;
    car.time += dt * 1000;

    // ---- ribbon query ----
    car.idx = DD.trackQuery(track, car.pos, car.idx);
    const s = track.samples[car.idx];
    const rel = V.sub(car.pos, s.p);
    const lat = V.dot(rel, s.r);
    const ha = V.dot(rel, s.u);
    const halfW = s.w / 2 + P.edgeMargin;
    const gap = !!s.gap;
    const onRibbon = !gap && Math.abs(lat) <= halfW;
    const onShoulder = !gap && !onRibbon && Math.abs(lat) <= halfW + P.shoulderWidth;

    // ---- checkpoints / finish (gate proximity enforced; circuits add lap semantics) ----
    const cks = track.checkpoints;
    if (car.awaitSeam) {
      // circuits: just crossed the lap line — hold checkpoint/miss logic until the ribbon
      // index wraps back past the start seam, so the high pre-seam idx can't false-trigger
      if (car.idx < 60) car.awaitSeam = false;
    } else {
      if (car.nextCkpt < cks.length && car.idx >= cks[car.nextCkpt]) {
        const g = track.samples[cks[car.nextCkpt]];
        if (V.dist(car.pos, g.p) < g.w * 1.9) {
          car.splits.push(Math.round(car.time));
          car.nextCkpt++;
          DD.snapshotCheckpoint(car);
          car.justCkpt = car.splits.length; // absolute split index (lap-safe), 1-based
          car.missedCkpt = false;
        } else if (car.idx > cks[car.nextCkpt] + 40) {
          car.missedCkpt = true;
        }
      }
      if (car.idx >= track.finishIdx) {
        if (car.nextCkpt >= cks.length) {
          car.lap++;
          if (car.lap >= (track.laps || 1)) {
            car.finished = true;
            car.finalMs = Math.round(car.time);
            return;
          }
          // next lap: checkpoint cycle restarts once we're across the seam
          car.nextCkpt = 0;
          car.awaitSeam = true;
          car.justLap = car.lap; // consumed by the HUD (LAP n/m + chime)
          DD.snapshotCheckpoint(car);
        } else {
          car.missedCkpt = true;
        }
      }
    }

    // ---- ground resolution: ribbon > terrain > air ----
    const vu = V.dot(car.vel, s.u);
    let groundFrame = null; // {u, pitch, bank, surf, mode}

    if ((onRibbon || onShoulder) && ha <= 0.45 && ha >= -2.0 && vu <= P.launchVu) {
      // ribbon grounded
      car.pos = V.addS(car.pos, s.u, -ha + 0.02);
      const vuNow = V.dot(car.vel, s.u);
      if (vuNow < 0) car.vel = V.addS(car.vel, s.u, -vuNow);
      groundFrame = { u: s.u, pitch: s.pitch, bank: s.bank, surf: s.surf, mode: 'ribbon', wall: s.wall, lat, halfW, shoulder: onShoulder, r: s.r };
    } else if (track.terrain) {
      const th = DD.terrainAt(track.terrain, car.pos[0], car.pos[2]);
      const ha2 = car.pos[1] - th;
      const stick = car.onDirt ? P.dirtStickBand : 0.4; // sticky once driving dirt — no bump-hopping
      if (ha2 <= stick && car.vel[1] <= (car.onDirt ? P.dirtLaunchVu : P.launchVu)) {
        car.pos[1] = th + 0.02;
        if (car.vel[1] < 0) car.vel[1] = 0;
        const n = DD.terrainNormal(track.terrain, car.pos[0], car.pos[2]);
        const fwdH = [Math.sin(car.yaw), 0, Math.cos(car.yaw)];
        const ahead = DD.terrainAt(track.terrain, car.pos[0] + fwdH[0] * 3, car.pos[2] + fwdH[2] * 3);
        groundFrame = { u: n, pitch: Math.atan2(ahead - th, 3), bank: 0, surf: DD.SURF.DIRT, mode: 'dirt' };
      }
    }

    const wasGrounded = car.grounded;
    if (groundFrame) {
      if (!wasGrounded) {
        // landing: nose alignment decides how much speed you KEEP — but velocity
        // direction is preserved (sideways landings stay sideways, e.g. on ice)
        const u = groundFrame.u;
        const horiz = V.sub(car.vel, V.scale(u, V.dot(car.vel, u)));
        const hs = V.len(horiz);
        const fwd = carForward(car, u);
        const align = hs > 1 ? DD.clamp(Math.abs(V.dot(V.norm(horiz), fwd)), 0, 1) : 1;
        const keep = DD.lerp(P.landKeepMin, 1, align * align);
        car.vel = V.scale(hs > 0.01 ? V.norm(horiz) : fwd, hs * keep);
        car.yawRate *= 0.3;
        car.suspV -= Math.min(car.airTime, 1.2) * 5; // landing compresses the springs
      }
      car.grounded = true;
      car.airTime = 0;
      car.onDirt = groundFrame.mode === 'dirt';
      car.surf = groundFrame.surf;
      stepGrounded(car, input, groundFrame, dt);
    } else {
      car.grounded = false;
      car.onDirt = false;
      stepAirborne(car, input, dt);
    }

    // ---- out of world safety ----
    if (track.terrain && car.pos[1] < track.terrain.minH - P.outOfWorld) car.fellOff = true;

    // visual lean: subtle, body stays flat on its 4 wheels
    const targetRoll = car.grounded ? -car.steerPos * (car.slideState ? 0.09 : 0.035) : -car.steerPos * 0.15;
    car.rollVis = DD.dampTo(car.rollVis, targetRoll, 8, dt);
    car.sliding = car.grounded && (car.slideState || Math.abs(car.slipF || 0) > 0.1);
  };

  function stepGrounded(car, input, gf, dt) {
    const u = gf.u;
    const fwd = carForward(car, u);
    const right = V.norm(V.cross(u, fwd));

    let vLong = V.dot(car.vel, fwd);
    let vLat = V.dot(car.vel, right);
    let r = car.yawRate;

    const speed = Math.abs(vLong);
    const sv = DD.clamp(speed / P.vmax, 0, 1);
    const glass = gf.surf === DD.SURF.GLASS;
    const boost = gf.surf === DD.SURF.BOOST;
    const dirt = gf.mode === 'dirt';

    // ---- steering ramp (the "wheel") ----
    const target = DD.clamp(input.steer || 0, -1, 1);
    const rampRate = (Math.abs(target) > Math.abs(car.steerPos) ? P.steerRampUp : P.steerRampDown) * dt;
    car.steerPos += DD.clamp(target - car.steerPos, -rampRate, rampRate);
    let maxSteer = DD.lerp(P.steerMaxLow, P.steerMaxHigh, Math.pow(sv, 0.7));
    if (glass) maxSteer *= P.glassSteerMul;
    // NOTE: screen-right = -x in our frame, so positive (right) input maps to negative wheel angle
    let delta = -car.steerPos * maxSteer;

    // ---- axle grips ----
    const df = Math.max(0, speed - P.downforceV) * P.downforceK;
    const bankBonus = 1 + Math.abs(gf.bank) * 0.9;
    let surfMul = 1;
    if (glass) surfMul = P.glassGripMul;
    if (dirt) surfMul = P.dirtGripMul;
    const fade = 1 - P.highSpeedFade * sv;
    let gF = (P.gripF * fade + df) * bankBonus * surfMul;
    let gR = (P.gripR * fade + df) * bankBonus * surfMul;
    const gRBase = gR; // unmodified rear capacity (for the longitudinal traction circle)

    // friction circle / weight transfer
    const throttle = input.throttle || 0, brake = input.brake || 0;
    gF *= DD.lerp(1, P.brakeFrontGripMul, brake);
    gR *= DD.lerp(1, P.brakeRearGripMul, brake);
    gR *= DD.lerp(1, P.driveRearGripMul, throttle * Math.max(0, 1 - speed / P.powerOversteerV)); // power oversteer only at low speed
    const prevSlip = Math.abs(car.slipR || 0);
    if (prevSlip < 0.5) { // beyond ~30° the rear "catches" — slides stay shapely, no spinouts
      if (input.drift) gR *= P.driftBtnRearMul;
      if (car.slideState) gR *= P.slideRearMul;
    }
    // wheelspin: dumping full power at low speed lights up the rears (burnouts, donuts)
    if (throttle > 0.85 && speed < 24) gR *= 0.5;
    gR = Math.max(gR, 3.5 * surfMul); // floor scales with surface — ice stays truly slick
    gF = Math.max(gF, 3.5 * surfMul);

    // ---- invisible assist #1: traction-limited steering ----
    // Full lock means "max useful lock" — the front can't be accidentally overdriven.
    // Disabled whenever the player is ASKING for a slide (drift btn, brake-tap, wheelspin, ice).
    const vRef = Math.max(speed, 2.5);
    const dir = vLong >= 0 ? 1 : -1;
    const wantSlide = input.drift || brake > 0.4 || (throttle > 0.85 && speed < 24) || glass;
    if (!wantSlide && speed > 8) {
      // soft overdrive: light inputs stay fully proportional (you can FEEL the modulation);
      // only steering past the useful band gives diminishing return — no hard clamp, no dead zone.
      const beta = Math.atan2(vLat + P.cgF * r, vRef) * dir;
      const lim = P.steerAssistLim / P.stiffK;
      const hi = beta + lim, lo = beta - lim;
      if (delta > hi) delta = hi + (delta - hi) * P.overdriveGain;
      else if (delta < lo) delta = lo + (delta - lo) * P.overdriveGain;
    }
    car.wheelAngle = delta; // actual front-wheel angle (radians) for the visual — real, not amplified

    // ---- slip angles & lateral forces ----
    // Smooth saturating tire (no cliff): force grows, knee near saturation slip, gentle rolloff.
    // The progressive edge is what makes the limit FEELABLE instead of a binary flick.
    const alphaF = Math.atan2(vLat + P.cgF * r, vRef) * dir - delta;
    const alphaR = Math.atan2(vLat - P.cgR * r, vRef) * dir;
    const tire = (g, a) => {
      const n = P.stiffK * a;                       // normalised demand (≈1 at the knee)
      const s = n / Math.pow(1 + Math.pow(Math.abs(n), P.tireKnee), 1 / P.tireKnee);
      return -g * s;
    };
    const FyF = tire(gF, alphaF);
    const FyR = tire(gR, alphaR);

    // slide hysteresis (drift state)
    const slip = Math.abs(alphaR);
    car.slideState = car.slideState ? slip > P.slideExit : slip > P.slideEnter;
    car.slipF = alphaF; car.slipR = alphaR;
    car.slipMax = Math.max(Math.abs(alphaF), Math.abs(alphaR)); // either axle sliding = visible/audible slide

    // ---- yaw + lateral: TWO REGIMES ----
    // The grip regime is what you feel 95% of the time: stick position maps to a
    // proportional fraction of the corner (half stick = half the turn), grip-capped so
    // pure throttle can NEVER spin. Full slip dynamics only when you ASK for a slide.
    const aGrip = gF + gR; // total lateral capability (sum of both axles)
    const slideRegime = wantSlide || car.slideState;
    if (!slideRegime) {
      const yawCap = Math.min(P.yawMax, 0.95 * aGrip / Math.max(speed, 6));
      const rTarget = -car.steerPos * yawCap;       // screen-right = -yaw
      r = DD.dampTo(r, rTarget, P.yawTrack, dt);     // predictable, proportional, planted
      // velocity tracks heading (car GOES where it points) with a hair of slip for feel
      const vLatTarget = -r * speed * 0.06;
      vLat = DD.dampTo(vLat, vLatTarget, 12, dt);
    } else {
      r += ((P.cgF * FyF - P.cgR * FyR) / P.yawInertia) * dt;
      if (input.drift) {
        // steer-proportional yaw authority when drift is held (arcade authority)
        r += -car.steerPos * P.driftYawAuthority * dt;
      }
      if (!wantSlide) { // catching an unwanted breakaway: continuous auto-countersteer
        const ramp = DD.smoothstep(DD.clamp((Math.abs(alphaR) - 0.04) / 0.10, 0, 1));
        r += DD.clamp(alphaR * dir * P.counterAssist * ramp, -2.6, 2.6) * dt;
      }
      // drop slideYawDamp for player-held drifts
      const yawDamp = input.drift ? 0 : DD.lerp(0.6, P.slideYawDamp, DD.clamp(speed / 40, 0, 1));
      r *= Math.exp(-dt * yawDamp);
      vLat += (FyF + FyR - r * vLong) * dt;

      // velocity-follows-heading coupling while drift is held (arcade tightening).
      // C4b v2: speed-scaled so drift DOMINATES fast corners (the curve inverts — modest at low
      // speed where grip wins, strong at race speed where drift must win). Transition 20->55 m/s.
      // v1's flat-ish curve made drift weakest at the speeds you actually corner at (250-300+ km/h),
      // so the nose rotated in but velocity plowed wide against high momentum.
      if (input.drift) {
        const velSpeed = Math.sqrt(vLong * vLong + vLat * vLat);
        if (velSpeed > 1) {
          const coupling = DD.lerp(P.driftCouplingLo, P.driftCouplingHi, DD.clamp((speed - 20) / 35, 0, 1));
          let theta = Math.atan2(vLat, vLong);
          theta -= theta * coupling * dt;
          vLong = velSpeed * Math.cos(theta);
          vLat = velSpeed * Math.sin(theta);
        }
      }
    }
    r = DD.clamp(r, -3.4, 3.4);

    // ---- gearbox drive (the TM puzzle: hold the gear, dodge the shift cuts) ----
    updateGear(car, speed, dt);
    let drive = 0;
    if (car.shiftCut <= 0) {
      const ga = P.gearAccel[car.gear - 1];
      const torque = P.rpmTorqueLo + (1 - P.rpmTorqueLo) * Math.min(car.rpm01, 1);
      drive = throttle * ga * torque * Math.max(0, 1 - Math.pow(speed / ((boost ? P.boostMaxV : P.vmax) + 2), 8));
    }
    if (dirt) drive *= P.dirtAccelMul;
    // traction circle on the tire's BASE grip (gRBase): lateral load consumes drive capacity,
    // but the throttle/slide grip *modifiers* don't double-dip into longitudinal force
    const rearLongCap = Math.max(0, gRBase - Math.abs(FyR)) + 5;
    drive = Math.min(drive, boost ? drive : rearLongCap);
    let longAcc = drive + r * vLat * 0.5;
    // scrubbing tires drag the car (slides cost speed — the drift tradeoff) — except on ice.
    // C4b v2: scrub fades with speed above ~40 m/s so high-speed drift (the fast-corner regime)
    // holds momentum. v1's flat coefficient bled catastrophic speed at race pace (335 m/s lost
    // over 3s at 299 km/h) — drift was both looser AND slower than grip. The fade keeps a real
    // low/mid-speed cost (drift is still a commitment below the crossover) without making it
    // punitive at the speeds you actually corner at.
    if (!glass) {
      // Scrub fades PARTIALLY at high speed (1.0 -> 0.55) so high-speed drift is viable through
      // tight corners but still pays a real cost — drift must NOT beat grip on long sweepers, only
      // where grip is yaw-capped (tight fast corners). A near-zero fade (the v2 mistake) let drift
      // win everywhere, including full-throttle sweepers where grip should dominate.
      const scrubFade = DD.clamp(1 - (speed - 35) / 80, 0.55, 1);
      longAcc -= (Math.abs(Math.sin(alphaR)) * gR * 0.38 + Math.abs(Math.sin(alphaF)) * gF * 0.16) * scrubFade * Math.sign(vLong);
    }
    // brake: decelerates while moving forward; engages capped reverse only near standstill
    if (vLong > 0.5) longAcc -= brake * P.brakeDec;
    else if (vLong > -P.reverseMax) longAcc -= brake * 8;
    if (vLong < -0.5) longAcc += Math.min(-vLong, 6) * 1.2; // reverse self-slows; throttle always recovers
    longAcc -= P.dragK * vLong * Math.abs(vLong) + P.rollDrag * Math.sign(vLong);
    if (dirt) longAcc -= P.dirtDragK * vLong * Math.abs(vLong);
    longAcc -= Math.sin(gf.pitch) * P.gravity * P.slopeFactor; // climbs cost speed, drops give it back
    vLong += longAcc * dt;
    if (boost) { vLong += P.boostAccel * dt; car.boostGlow = 1; }

    // speed-drift exploit: shallow slide at speed = free accel
    if (car.slideState && throttle > 0.5 && speed > 42 && slip < 0.28) vLong += P.sdBoost * dt;

    // ---- low-speed kinematic blend (clean tight circles, no jitter) ----
    if (speed < 7) {
      const w = 1 - speed / 7;
      const rKin = (vLong / P.wheelbase) * Math.tan(delta);
      r = DD.lerp(r, rKin, w * 0.85);
      vLat *= 1 - w * 0.4;
    }

    car.yawRate = r;
    car.yaw += r * dt;

    // recompose world velocity
    const fwd2 = carForward(car, u);
    const right2 = V.norm(V.cross(u, fwd2));
    car.vel = V.addS(V.scale(fwd2, vLong), right2, vLat);

    // ---- shoulder & walls (ribbon only) ----
    if (gf.mode === 'ribbon' && gf.shoulder) {
      car.vel = V.scale(car.vel, P.shoulderScrub);
      car.vel = V.addS(car.vel, gf.r, -Math.sign(gf.lat) * P.shoulderPush * dt);
    }

    car.pos = V.addS(car.pos, car.vel, dt);
    car.boostGlow = Math.max(0, car.boostGlow - dt * 2);

    // suspension: bumps and crests excite the springs (cosmetic bob, sells the surface)
    const pitchRate = (gf.pitch - car.lastPitch) / dt;
    car.lastPitch = gf.pitch;
    const exc = DD.clamp(pitchRate * speed * 0.004, -3, 3);
    car.suspV += (-110 * car.suspY - 11 * car.suspV + exc) * dt;
    car.suspY = DD.clamp(car.suspY + car.suspV * dt, -0.22, 0.22);
  }

  function stepAirborne(car, input, dt) {
    car.airTime += dt;
    car.vel[1] -= P.gravity * dt;
    // TM air control: brake instantly stabilises rotation; steer spins the car
    if (input.brake) {
      car.yawRate = DD.dampTo(car.yawRate, 0, 14, dt);
      car.yaw -= (input.steer || 0) * P.airSteer * 0.2 * dt;
    } else {
      car.yaw -= (input.steer || 0) * P.airSteer * dt;
      car.yawRate = DD.dampTo(car.yawRate, 0, 2, dt);
    }
    car.steerPos = DD.dampTo(car.steerPos, input.steer || 0, 6, dt);
    car.wheelAngle = -car.steerPos * 0.3; // visual only, in air
    // air pitch: throttle noses down, brake noses up (visual + landing posture)
    car.pitchVis = DD.dampTo(car.pitchVis, (input.brake ? 0.4 : 0) - (input.throttle ? 0.22 : 0), 4, dt);
    car.pos = V.addS(car.pos, car.vel, dt);
    car.slideState = false;
    // suspension relaxes in air
    car.suspV += (-110 * car.suspY - 11 * car.suspV) * dt;
    car.suspY = DD.clamp(car.suspY + car.suspV * dt, -0.22, 0.22);
  }

  /* wall clamp pass — called from stepCar context via track sample after integration */
  DD.postWallClamp = function (car, track) {
    const s = track.samples[car.idx];
    if (!s.wall || s.gap) return;
    const rel = V.sub(car.pos, s.p);
    const lat = V.dot(rel, s.r);
    const lim = s.w / 2 - 0.55;
    if (Math.abs(lat) > lim && car.grounded && !car.onDirt) {
      car.pos = V.addS(car.pos, s.r, (Math.sign(lat) * lim) - lat);
      const vr = V.dot(car.vel, s.r);
      car.vel = V.addS(car.vel, s.r, -vr * (1 + P.wallBounce));
      car.vel = V.scale(car.vel, P.wallFriction);
      car.yawRate *= 0.7;
      car.hitWall = true;
    }
  };

  function buildExpertData(track) {
    const ss = track.samples;
    const N = ss.length;
    const closed = !!track.closed;
    // circuits wrap every scan/neighbor across the start/finish seam
    const wr = (i) => closed ? ((i % N) + N) % N : Math.min(N - 1, Math.max(0, i));

    // 1. Precompute Racing Line
    const offsets = new Float32Array(N);
    const iterations = 100;
    const relaxLo = closed ? 0 : track.startIdx + 1;
    const relaxHi = closed ? N : track.finishIdx;
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = relaxLo; i < relaxHi; i++) {
        const im = wr(i - 1), ip = wr(i + 1);
        const prev = V.addS(V.clone(ss[im].p), ss[im].r, offsets[im]);
        const next = V.addS(V.clone(ss[ip].p), ss[ip].r, offsets[ip]);
        const target = V.scale(V.add(prev, next), 0.5);
        const toTarget = V.sub(target, ss[i].p);
        const w = V.dot(toTarget, ss[i].r);

        // Lookahead buffer checks for ice, kickers, and gaps
        let isIce = false;
        let isKicker = false;
        let isGap = false;

        const iceBuffer = 12;
        const kickerBuffer = 8;
        const gapBuffer = 8;

        for (let o = 0; o < 15; o++) {
          const j = closed ? wr(i + o) : i + o;
          if (!closed && j >= N) break;
          const sj = ss[j];
          if (o < iceBuffer && sj.surf === DD.SURF.GLASS) isIce = true;
          if (o < kickerBuffer && sj.pieceName === 'kicker') isKicker = true;
          if (o < gapBuffer && sj.gap) isGap = true;
        }

        let limit = ss[i].w * 0.35;
        if (isIce || isKicker || isGap) {
          limit = 0; // force centerline on/before dangerous features
        }
        // circuits: pin the line to center through the seam so laps hand over seamlessly
        if (closed && (i < track.startIdx + 6 || i > N - 8)) limit = 0;

        offsets[i] = DD.clamp(w, -limit, limit);
      }
    }

    const positions = [];
    const BLEND = 0.70;
    for (let i = 0; i < N; i++) {
      positions.push(V.addS(V.clone(ss[i].p), ss[i].r, offsets[i] * BLEND));
    }

    // Use Centerline Curvature for the Speed Solver (for safety)
    const curvatures = new Float32Array(N);
    for (let i = closed ? 0 : 1; i < (closed ? N : N - 1); i++) {
      curvatures[i] = Math.abs(DD.angleDiff(ss[wr(i - 1)].yaw, ss[i].yaw)) / track.ds;
    }

    // 2. Precompute Target Speeds — corner-limit table first, then constraint sweeps
    const nearIceAt = (i) => {
      for (let o = 0; o < 15; o++) {
        const j = closed ? wr(i + o) : i + o;
        if (!closed && j >= N) break;
        if (ss[j].surf === DD.SURF.GLASS) return true;
      }
      return false;
    };
    const gmulAt = (i) => ss[i].surf === DD.SURF.GLASS ? P.glassGripMul : (ss[i].surf === DD.SURF.DIRT ? P.dirtGripMul : 1.0);
    const vCornerAt = (i) => {
      const curv = curvatures[i];
      const gmul = gmulAt(i);
      let vCorner = ss[i].surf === DD.SURF.GLASS ? 46 : P.vmax;
      if (curv > 1e-4) {
        const rad = (1 / curv) * (1 + Math.abs(ss[i].bank) * 0.9);
        const bankBonus = 1 + Math.abs(ss[i].bank) * 0.9;
        // C4c: grip budget must track the player's actual GRIP-REGIME capability, not half of it.
        // The old (gripF+gripR)*0.5 = 15.5 budgeted ~1.66g lateral; the player's grip regime allows
        // ~0.95*(gripF+gripR) ~= 29 m/s^2 (~3g). A bot cornering at 0.74x human speed made every
        // medal trivial. Use 0.90 of the player's available grip — fast, but a hair of margin so the
        // bot is beatable by a cleaner line rather than a coin-flip at the limit.
        const gripAvail = (P.gripF + P.gripR) * 0.90;
        const vEst = Math.sqrt(gripAvail * bankBonus * gmul * rad);
        const df = Math.max(0, vEst - P.downforceV) * P.downforceK;
        const gripCombined = gripAvail + df;
        vCorner = Math.min(vCorner, Math.sqrt(gripCombined * bankBonus * gmul * rad));
      }
      if (nearIceAt(i)) vCorner = Math.min(vCorner, 18);
      return vCorner;
    };

    const botSpeeds = new Float32Array(N);
    if (closed) {
      // circuits: steady-state solve around the loop — two modular sweeps each way; the seam
      // speed must be continuous (lap 2 arrives flying), so there is NO standing-start zero
      for (let i = 0; i < N; i++) botSpeeds[i] = vCornerAt(i);
      for (let k = 2 * N - 1; k >= 0; k--) {
        const i = k % N, nx = (i + 1) % N;
        const maxDecel = P.brakeDec * gmulAt(i) * 0.90;
        botSpeeds[i] = Math.min(botSpeeds[i], Math.sqrt(botSpeeds[nx] * botSpeeds[nx] + 2 * maxDecel * track.ds));
      }
      for (let k = 0; k < 2 * N; k++) {
        const i = k % N, pv = (i - 1 + N) % N;
        const maxAccel = 16 * gmulAt(i);
        botSpeeds[i] = Math.min(botSpeeds[i], Math.sqrt(botSpeeds[pv] * botSpeeds[pv] + 2 * maxAccel * track.ds));
      }
    } else {
      botSpeeds[N - 1] = P.vmax;
      for (let i = N - 2; i >= 0; i--) {
        const maxDecel = P.brakeDec * gmulAt(i) * 0.90;
        botSpeeds[i] = Math.min(vCornerAt(i), Math.sqrt(botSpeeds[i + 1] * botSpeeds[i + 1] + 2 * maxDecel * track.ds));
      }
      botSpeeds[0] = 0;
      for (let i = 1; i < N; i++) {
        const maxAccel = 16 * gmulAt(i);
        botSpeeds[i] = Math.min(botSpeeds[i], Math.sqrt(botSpeeds[i - 1] * botSpeeds[i - 1] + 2 * maxAccel * track.ds));
      }
    }

    for (let i = 0; i < N; i++) {
      const floor = nearIceAt(i) ? 18 : 22;
      botSpeeds[i] = DD.clamp(botSpeeds[i], floor, P.vmax);
    }

    return { positions, botSpeeds, curvatures };
  }

  DD.getBotInput = function (car, track) {
    if (!track.expert) {
      track.expert = buildExpertData(track);
    }

    const idx = car.idx;
    const speed = V.len(car.vel);
    const data = track.expert;
    const ss = track.samples;
    const N = ss.length;

    const vT = data.botSpeeds[idx];
    const aimRaw = idx + 3 + Math.floor(speed * 0.14);
    const aimI = track.closed ? aimRaw % N : Math.min(N - 1, aimRaw);

    const targetPos = data.positions[aimI];

    const to = V.sub(targetPos, car.pos);

    let steer;
    const isIce = ss[idx].surf === DD.SURF.GLASS;

    if (car.slideState && !isIce && speed > 10) {
      const velYaw = Math.atan2(car.vel[0], car.vel[2]);
      const errVel = DD.angleDiff(car.yaw, velYaw);
      steer = DD.clamp(-(errVel * 4.0 - car.yawRate * 0.2), -1, 1);
    } else {
      const err = DD.angleDiff(car.yaw, Math.atan2(to[0], to[2]));
      steer = DD.clamp(-(err * 3.4 - car.yawRate * 0.18), -1, 1);
    }

    let throttle = speed < vT * 1.02 ? 1 : 0.15;
    let brake = speed > vT * 1.02 ? 1 : 0;
    let drift = false; // Grip corner-cutting is more stable and faster for the bot than drift initiation

    return { steer, throttle, brake, drift };
  };

  /* ---------- headless bot (medals + validation) ---------- */
  DD.runBot = function (track, opts) {
    opts = opts || {};
    const car = DD.createCar(track);
    const laps = track.laps || 1;
    const maxTicks = (opts.maxSeconds || 120 + 110 * laps) * 60;
    const n = track.samples.length;
    let stuckTicks = 0, lastProgress = 0;
    const recordFrames = !!opts.recordFrames;
    const frames = recordFrames ? [] : null;

    for (let t = 0; t < maxTicks; t++) {
      const input = DD.getBotInput(car, track);
      DD.stepCar(car, input, track);
      DD.postWallClamp(car, track);

      if (recordFrames && (t % 2 === 0)) {
        frames.push(car.pos[0], car.pos[1], car.pos[2], car.yaw);
      }

      if (car.fellOff) { car.fellOff = false; DD.respawnCheckpoint(car, track); }
      if (car.finished) {
        return {
          ok: true,
          ms: car.finalMs,
          respawns: car.respawns,
          splits: car.splits.slice(),
          frames: recordFrames ? new Float32Array(frames) : null
        };
      }
      if (t % 120 === 0) {
        // lap-aware progress so the seam wrap (idx n-1 → 0) never reads as "stuck"
        const progress = (car.lap || 0) * n + car.idx;
        if (progress <= lastProgress + 2) stuckTicks++; else stuckTicks = 0;
        lastProgress = progress;
        if (stuckTicks > 5) return { ok: false, reason: 'stuck', at: car.idx, frames: null };
      }
    }
    return { ok: false, reason: 'timeout', frames: null };
  };

  DD.buildValidTrack = function (seedStr, tier) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const track = DD.generateTrack(seedStr, tier, attempt);
      if (track.overlapForced > 0) continue; // self-intersecting layout: regenerate
      const bot = DD.runBot(track, { recordFrames: true });
      if (bot.ok && bot.respawns === 0 && bot.ms > 25000) {
        // C4c: with the bot now cornering at ~human grip (0.90 of available), it's near-optimal,
        // so author = the bot's own time (the reference lap). Gold/silver/bronze spreads tightened
        // from 1.10/1.25/1.55 to 1.08/1.20/1.45 so tiers feel meaningful against a fast bot while
        // bronze stays achievable. Final numbers subject to Tibba playtests (C4 is judgment work),
        // but the bot-speed fix itself is correcting a defect, not a judgment call.
        const author = Math.round(bot.ms * 1.00);
        track.medals = {
          author,
          gold: Math.round(author * 1.08),
          silver: Math.round(author * 1.20),
          bronze: Math.round(author * 1.45)
        };
        track.attempt = attempt;
        track.authorGhost = bot.frames;
        track.authorSplits = bot.splits;
        return track;
      }
    }
    const track = DD.generateTrack(seedStr, tier, 0);
    const est = Math.round(track.length / 28 * 1000);
    track.medals = { author: est, gold: Math.round(est * 1.08), silver: Math.round(est * 1.20), bronze: Math.round(est * 1.45) };
    track.attempt = -1;
    return track;
  };

})(typeof window !== 'undefined' ? window : globalThis);
