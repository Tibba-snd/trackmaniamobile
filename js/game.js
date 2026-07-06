/* DRIFTDREAM game — state machine, menus, HUD, loop, ghosts, save. */
(function (global) {
  'use strict';
  const DD = global.DD;
  const V = DD.v;

  const $ = (id) => document.getElementById(id);

  DD.trackCache = {};

  let cachedHudWarn = null;
  let cachedHudSpeed = null;
  let cachedHudGear = null;
  let cachedHudSpeedBox = null;
  let cachedRpmFill = null;
  let cachedHudDelta = null;
  let cachedHudLeftBox = null;
  let cachedHudMedals = null;

  const drawPosScratch = [0, 0, 0];

  const scratchColor = new THREE.Color();

  // T12 cross-section editor — cached vectors for the camera tween (no per-frame allocation).
  const crossFromPos = new THREE.Vector3();
  const crossToPos = new THREE.Vector3();
  const crossCurPos = new THREE.Vector3();
  const easeOut = (x) => 1 - Math.pow(1 - x, 3); // cubic ease-out for the 300ms snap

  const G = DD.game = {
    state: 'menu', // menu | loading | countdown | play | finish
    save: null,
    renderer: null, scene: null, camera: null,
    track: null, trackRoot: null,
    car: null, carMesh: null, trail: null, speedLines: null,
    ghostMesh: null, ghostData: null, ghostPlayhead: 0,
    recFrames: [], recEvery: 2, tickCount: 0,
    lastAttemptFrames: [],
    camState: null,
    countdownT: 0, finishShownAt: 0,
    acc: 0, lastT: 0,
    prevPos: null, prevYaw: 0,
    wheelSpin: 0
  };

  /* ---------------- campaign ---------------- */
  const CAMPAIGN = [];
  for (let t = 1; t <= 5; t++) {
    const list = [];
    for (let i = 1; i <= 10; i++) list.push('CAMP-T' + t + '-' + String(i).padStart(2, '0'));
    CAMPAIGN.push(list);
  }
  const MEDAL_ORDER = ['bronze', 'silver', 'gold', 'author'];
  const MEDAL_ICON = { author: '◆', gold: '★', silver: '●', bronze: '▲', none: '○' };

  function seedKey(seed, tier) { return seed + '|t' + tier; }

  function medalFor(ms, medals) {
    if (ms <= medals.author) return 'author';
    if (ms <= medals.gold) return 'gold';
    if (ms <= medals.silver) return 'silver';
    if (ms <= medals.bronze) return 'bronze';
    return 'none';
  }

  function tierMedalCount(tier) {
    let n = 0;
    for (const seed of CAMPAIGN[tier - 1]) {
      const rec = G.save.tracks[seedKey(seed, tier)];
      if (rec && rec.medal && rec.medal !== 'none') n++;
    }
    return n;
  }
  function tierUnlocked(tier) {
    if (tier === 1) return true;
    return tierMedalCount(tier - 1) >= 5;
  }

  /* ---------------- ghosts ---------------- */
  function encodeGhost(frames) {
    const f32 = new Float32Array(frames.length * 4);
    frames.forEach((fr, i) => f32.set(fr, i * 4));
    const u8 = new Uint8Array(f32.buffer);
    let bin = '';
    for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(bin);
  }
  function decodeGhost(b64) {
    try {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Float32Array(u8.buffer);
    } catch (e) { return null; }
  }

  function updateHudGhostTag() {
    const tag = $('hudGhostTag');
    if (!tag) return;
    if (!G.track || !G.racedGhostType || G.racedGhostType === 'off') {
      tag.style.display = 'none';
      tag.textContent = '';
    } else {
      tag.style.display = 'inline-block';
      tag.textContent = G.racedGhostType === 'pb' ? 'vs PB' : 'vs AUTHOR';
    }
  }

  function updateActiveGhost() {
    if (!G.track) return;
    const track = G.track;
    if (G.ghostMesh) {
      DD.disposeGroup(G.scene, G.ghostMesh);
      G.ghostMesh = null;
    }
    const rec = G.save.tracks[seedKey(track.seed, track.tier)];
    const ghostOpt = G.save.settings.ghost || 'pb';
    let ghostToPlay = null;
    let racedGhostType = 'off';
    let racedGhostTime = null;

    if (ghostOpt === 'pb') {
      if (rec && rec.ghost) {
        ghostToPlay = decodeGhost(rec.ghost);
        racedGhostType = 'pb';
        racedGhostTime = rec.pb;
      } else if (track.authorGhost) {
        ghostToPlay = track.authorGhost;
        racedGhostType = 'author';
        racedGhostTime = track.medals.author;
      }
    } else if (ghostOpt === 'author') {
      if (track.authorGhost) {
        ghostToPlay = track.authorGhost;
        racedGhostType = 'author';
        racedGhostTime = track.medals.author;
      }
    }

    G.racedGhostType = racedGhostType;
    G.racedGhostTime = racedGhostTime;
    G.ghostData = ghostToPlay;
    G.ghostTimes = precomputeGhostTimes(track, G.ghostData);

    if (G.ghostData) {
      G.ghostMesh = DD.buildCar(G.save.garage, true, G.scene.environment, G.save.customDesigns);
      G.scene.add(G.ghostMesh);
    }
    
    updateHudGhostTag();
  }

  function precomputeGhostTimes(track, ghostData) {
    if (!ghostData) return null;
    const N = track.samples.length;
    const laps = track.laps || 1;
    const len = N * laps; // circuits: one slot per sample PER LAP (progress index = lap*N + idx)
    const times = new Float32Array(len).fill(-1);
    // walk the ghost tracking UNWRAPPED progress so each lap's pass maps to its own slot.
    // (This mapper was dead code until now — it read s[0] on sample OBJECTS (undefined → NaN
    // distances), so every frame "matched" index 0 and the tail-fill extrapolated a constant
    // pace. The live delta has been a linear approximation since it shipped.)
    let lastAbs = 0;
    const numFrames = ghostData.length / 4;

    for (let fi = 0; fi < numFrames; fi++) {
      const gx = ghostData[fi * 4];
      const gy = ghostData[fi * 4 + 1];
      const gz = ghostData[fi * 4 + 2];

      let bestOff = 0;
      let minDist = Infinity;
      for (let o = -30; o <= 100; o++) {
        const abs = lastAbs + o;
        if (abs < 0 || abs >= len) continue;
        const s = track.samples[abs % N];
        const dx = gx - s.p[0];
        const dy = gy - s.p[1];
        const dz = gz - s.p[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < minDist) {
          minDist = d;
          bestOff = o;
        }
      }
      lastAbs = Math.max(0, Math.min(len - 1, lastAbs + bestOff));
      const timeMs = fi * G.recEvery * DD.TICK * 1000;
      if (times[lastAbs] === -1 || timeMs < times[lastAbs]) {
        times[lastAbs] = timeMs;
      }
    }
    
    // Linear interpolation for missing sample indices
    let prevIdx = -1;
    for (let i = 0; i < len; i++) {
      if (times[i] !== -1) {
        if (prevIdx !== -1 && i - prevIdx > 1) {
          const t0 = times[prevIdx];
          const t1 = times[i];
          for (let j = prevIdx + 1; j < i; j++) {
            const alpha = (j - prevIdx) / (i - prevIdx);
            times[j] = t0 + (t1 - t0) * alpha;
          }
        }
        prevIdx = i;
      }
    }
    
    if (times[0] === -1) {
      let firstSet = -1;
      for (let i = 0; i < len; i++) {
        if (times[i] !== -1) { firstSet = i; break; }
      }
      if (firstSet !== -1) {
        const tVal = times[firstSet];
        for (let i = 0; i < firstSet; i++) {
          times[i] = tVal * (i / firstSet);
        }
      } else {
        times.fill(0);
      }
    }
    
    if (prevIdx !== -1) {
      const tVal = times[prevIdx];
      for (let i = prevIdx + 1; i < len; i++) {
        times[i] = tVal + (i - prevIdx) * (G.recEvery * DD.TICK * 1000);
      }
    }
    
    return times;
  }

  /* ---------------- track lifecycle ---------------- */
  function startTrack(seed, tier, isMenu = false) {
    G.unlockedTiersBefore = [];
    for (let t = 1; t <= 5; t++) {
      if (tierUnlocked(t)) G.unlockedTiersBefore.push(t);
    }

    G.state = 'loading';
    showScreen('loading');
    $('loadBiomeHeader').textContent = 'ACQUIRING SECTOR...';
    dialInText($('loadSeed'), seed + '  ·  TIER ' + tier);
    setTimeout(() => {
      const cacheKey = seed + '|' + tier + (isMenu ? '|menu' : '');
      let track = DD.trackCache[cacheKey];
      if (!track) {
        track = DD.buildValidTrack(seed, tier, isMenu);
        DD.trackCache[cacheKey] = track;
      }
      G.track = track;
      applyCssTheme(track.theme);
      const biomeText = track.theme.biome.toUpperCase() + ' // ' + track.theme.weather.toUpperCase();
      dialInText($('loadBiomeHeader'), biomeText);
      if (DD.testMode) {
        console.log('[TEST] TRACK_LOAD: seed=' + seed + ', tier=' + tier);
      }
      // scene
      DD.disposeGroup(G.scene, G.trackRoot);
      G.trackRoot = DD.buildTrackScene(G.scene, track, G.save.settings.quality);
      DD.captureEnvironment(G.renderer, G.scene, track); // reflections for PBR car
      // car
      if (G.carMesh) DD.disposeGroup(G.scene, G.carMesh);
      G.carMesh = DD.buildCar(G.save.garage, false, G.scene.environment, G.save.customDesigns);
      G.scene.add(G.carMesh);
      if (G.trail) DD.disposeGroup(G.scene, G.trail);
      G.trail = DD.buildTrail(G.carMesh.userData.grad);
      G.scene.add(G.trail);
      if (G.speedLines) DD.disposeGroup(G.scene, G.speedLines);
      G.speedLines = DD.buildSpeedLines(track.theme);
      G.scene.add(G.speedLines);
      if (G.smoke) DD.disposeGroup(G.scene, G.smoke);
      G.smoke = DD.buildSmoke(track.theme);
      G.scene.add(G.smoke);
      if (G.sparks) DD.disposeGroup(G.scene, G.sparks);
      if (DD.buildSparks) {
        G.sparks = DD.buildSparks(track.theme);
        G.scene.add(G.sparks);
      }
      if (G.weather) DD.disposeGroup(G.scene, G.weather);
      if (DD.buildWeather) {
        G.weather = DD.buildWeather(track.theme);
        if (G.weather) G.scene.add(G.weather);
      }
      if (G.skid) DD.disposeGroup(G.scene, G.skid);
      G.skid = DD.buildSkidmarks();
      G.scene.add(G.skid);
      if (G.shadow) DD.disposeGroup(G.scene, G.shadow);
      G.shadow = DD.buildShadow();
      G.scene.add(G.shadow);
      // ghost
      updateActiveGhost();
      // hud targets
      // (rec was hoisted into updateActiveGhost by the A2 refactor — redeclare locally or the
      // whole loader tail dies on a ReferenceError and the game never leaves 'loading')
      const rec = G.save.tracks[seedKey(seed, tier)];
      $('valAuthor').textContent = DD.formatTime(track.medals.author);
      $('valGold').textContent = DD.formatTime(track.medals.gold);
      $('valSilver').textContent = DD.formatTime(track.medals.silver);
      $('valBronze').textContent = DD.formatTime(track.medals.bronze);
      $('hudPB').textContent = rec && rec.pb ? 'PB ' + DD.formatTime(rec.pb) : '';
      $('hudLap').textContent = 'LAP 1/' + (track.laps || 1);
      $('hudArch').textContent = track.archetype + ' · ' + track.theme.name;

      if (isMenu) {
        G.state = 'menu';
        G.car = DD.createCar(G.track);
        G.prevPos = [G.car.pos[0], G.car.pos[1], G.car.pos[2]];
        G.prevYaw = G.car.yaw;
        G.camState = DD.makeCamState();

        // Pre-position camera, car and shadow for the menu state first render frame,
        // so WebGL compiles all shaders for the correct assets and viewport
        const radius = 12.0;
        const height = 3.8;
        const carPos = G.car.pos;
        G.camera.position.set(carPos[0], carPos[1] + height, carPos[2] - radius);
        G.camera.lookAt(carPos[0], carPos[1] + 0.4, carPos[2]);

        const s0 = G.track.samples[G.track.startIdx];
        DD.poseCar(G.carMesh, G.car.pos, G.car.yaw, s0.u, 0, 0, 0, 0, 0);
        if (G.shadow) {
          DD.updateShadow(G.shadow, G.car.pos, s0.u, G.car.yaw, G.car, G.track);
        }

        // Force synchronous WebGL shader compilation behind the loading screen via a pre-render pass
        if (G.composer) G.composer.render(); else G.renderer.render(G.scene, G.camera);

        showScreen('menu');
      } else {
        DD.startPads(track.theme);
        resetRun();
      }
    }, 30);
  }

  function triggerHudStreak() {
    const leftBox = $('hudLeftBox');
    const medals = $('hudMedals');
    const speedBox = $('hudSpeedBox');
    if (leftBox) { leftBox.classList.remove('streak-in'); void leftBox.offsetWidth; leftBox.classList.add('streak-in'); }
    if (medals) { medals.classList.remove('streak-in'); void medals.offsetWidth; medals.classList.add('streak-in'); }
    if (speedBox) { speedBox.classList.remove('streak-in'); void speedBox.offsetWidth; speedBox.classList.add('streak-in'); }
  }

  function startReplay() {
    if (G.recFrames && G.recFrames.length > 0) {
      G.lastAttemptFrames = [...G.recFrames];
    }
    if (!G.lastAttemptFrames || G.lastAttemptFrames.length === 0) return;
    G.state = 'replay';
    showScreen('replay');
    
    G.replayPlayhead = 0;
    G.replayPlaying = true;
    
    const slider = $('repSlider');
    if (slider) {
      slider.max = G.lastAttemptFrames.length - 1;
      slider.value = 0;
    }
    
    const pp = $('repPlayPause');
    if (pp) pp.textContent = '⏸';
    
    const warnEl = cachedHudWarn;
    if (warnEl) warnEl.style.opacity = 0;
  }

  function updateReplay(dtReal, t) {
    if (!G.lastAttemptFrames || G.lastAttemptFrames.length === 0) return;
    if (!G.car || !G.carMesh) return;

    const framesPerSec = 1 / (G.recEvery * DD.TICK);
    if (G.replayPlaying) {
      G.replayPlayhead += dtReal * framesPerSec;
      if (G.replayPlayhead >= G.lastAttemptFrames.length - 1) {
        G.replayPlayhead = G.lastAttemptFrames.length - 1;
        G.replayPlaying = false;
        const pp = $('repPlayPause');
        if (pp) pp.textContent = '▶';
      }
    }

    const slider = $('repSlider');
    if (slider) {
      slider.value = Math.floor(G.replayPlayhead);
    }

    const currentTimeMs = G.replayPlayhead * G.recEvery * DD.TICK * 1000;
    const totalTimeMs = (G.lastAttemptFrames.length - 1) * G.recEvery * DD.TICK * 1000;
    const timeEl = $('repTime');
    if (timeEl) {
      timeEl.textContent = DD.formatTime(currentTimeMs) + ' / ' + DD.formatTime(totalTimeMs);
    }

    const fi = Math.min(Math.floor(G.replayPlayhead), G.lastAttemptFrames.length - 2);
    if (fi >= 0) {
      const a = fi, b = fi + 1;
      const tt = G.replayPlayhead - fi;
      
      const frameA = G.lastAttemptFrames[a];
      const frameB = G.lastAttemptFrames[b];

      const gp = [
        DD.lerp(frameA[0], frameB[0], tt),
        DD.lerp(frameA[1], frameB[1], tt),
        DD.lerp(frameA[2], frameB[2], tt)
      ];
      const gy = frameA[3] + DD.angleDiff(frameA[3], frameB[3]) * tt;

      G.car.pos = gp;
      G.car.yaw = gy;

      const dx = frameB[0] - frameA[0];
      const dy = frameB[1] - frameA[1];
      const dz = frameB[2] - frameA[2];
      G.car.vel = [dx / (G.recEvery * DD.TICK), dy / (G.recEvery * DD.TICK), dz / (G.recEvery * DD.TICK)];
      const speed = V.len(G.car.vel);
      const speedNorm = DD.clamp(speed / DD.PHYS.vmax, 0, 1);

      G.car.idx = DD.trackQuery(G.track, gp, G.car.idx);
      G.car.grounded = true;
      G.car.onDirt = false;
      G.car.sliding = false;
      G.car.rollVis = 0;
      G.car.pitchVis = 0;
      G.car.wheelAngle = 0;
      G.car.suspY = 0;
      G.car.suspV = 0;

      const s = G.track.samples[Math.min(G.car.idx, G.track.samples.length - 1)];
      const carUp = s.u;
      G.wheelSpin = speed * dtReal * 2.2;
      DD.poseCar(G.carMesh, gp, gy, carUp, 0, 0, G.wheelSpin, 0, 0);
      DD.updateShadow(G.shadow, gp, carUp, gy, G.car, G.track);

      if (G.track && G.track.sunLight) {
        const theme = G.track.theme;
        G.track.sunLight.position.set(
          gp[0] + Math.sin(theme.lightAngle) * 120,
          gp[1] + 48.0,
          gp[2] + Math.cos(theme.lightAngle) * 120
        );
        if (G.track.sunLight.target) {
          G.track.sunLight.target.position.set(gp[0], gp[1], gp[2]);
        }
      }

      if (G.replayPlaying) {
        let gear = 1;
        while (gear < DD.PHYS.gearV.length - 1 && speed > DD.PHYS.gearV[gear]) gear++;
        const lo = DD.PHYS.gearV[gear - 1], hi = DD.PHYS.gearV[gear];
        const rpm01 = DD.clamp((speed - lo) / Math.max(hi - lo, 1), 0, 1.05);
        DD.updateEngine(speed, 0.5, true, 'road', dtReal, gear, rpm01);
      } else {
        DD.engineQuiet();
      }
    } else {
      DD.engineQuiet();
    }

    if (G.track) {
      if (G.track.nebulaeMesh) { G.track.nebulaeMesh.rotation.y = t * 0.000015; G.track.nebulaeMesh.position.copy(G.camera.position); }
      if (G.track.planetMesh) { G.track.planetMesh.rotation.y = -t * 0.00003; G.track.planetMesh.position.copy(G.camera.position); }
      if (G.track.starsMesh) { G.track.starsMesh.rotation.y = t * 0.000007; const _sm = G.track.starsMesh.material; if (_sm.uniforms && _sm.uniforms.time) _sm.uniforms.time.value = t * 0.001; }
      const breath = Math.sin(t * 0.001 * Math.PI * 2 * DD.GLOW.breathHz);
      if (G.track.gateMeshes) {
        for (const m of G.track.gateMeshes) m.material.opacity = DD.GLOW.gate.base + DD.GLOW.gate.amp * breath;
      }
      if (G.track.emissiveDecorMesh) {
        const mat = G.track.emissiveDecorMesh.userData.mat;
        if (mat) mat.emissiveIntensity = (DD.GLOW.decor.base + DD.GLOW.decor.amp * breath) * DD.glowMul(G.save.settings, G.track.theme);
      }
    }
    if (G.weather && DD.updateWeather) {
      DD.updateWeather(G.weather, G.camera, dtReal, t * 0.001);
    }
    if (G.track && DD.updateLightPool) DD.updateLightPool(G.track, G.camera.position.x, G.camera.position.y, G.camera.position.z);

    const speed = V.len(G.car.vel);
    DD.updateCamera(G.camera, G.camState, G.car, G.track, dtReal, speed);

    if (G.ghostMesh) G.ghostMesh.visible = false;

    applyBloom(0, 0, 0); // static screen — steady base glow
    applySpeedBlur(0);
    if (G.composer) G.composer.render(); else G.renderer.render(G.scene, G.camera);
  }

  // fast=true for retries (restart key / two-finger tap / retry button): time-attack is a
  // retry-spam genre, so skip most of the countdown. Full 3.2s only on the first load of a track.
  function resetRun(fast) {
    if (G.recFrames && G.recFrames.length > 0) {
      G.lastAttemptFrames = [...G.recFrames];
    }
    G.car = DD.createCar(G.track);
    G.car.lapSplits = [];
    const finLaps = $('finLaps');
    if (finLaps) {
      finLaps.style.display = 'none';
      finLaps.innerHTML = '';
    }
    G.recFrames = [];
    G.tickCount = 0;
    G.ghostPlayhead = 0;
    G.prevPos = [G.car.pos[0], G.car.pos[1], G.car.pos[2]];
    G.prevYaw = G.car.yaw;
    G.camState = DD.makeCamState();
    const s0 = G.track.samples[G.track.startIdx];
    G.camState.pos = V.addS(V.addS(V.clone(s0.p), s0.f, -10), s0.u, 4);
    G.camState.look = V.clone(s0.p);
    G.state = 'countdown';
    G.countdownT = DD.testMode ? 0.05 : (fast ? 0.8 : 3.2);
    DD.calibrateTilt();
    showScreen('game');
    $('countdown').style.display = 'flex';
    updateHudTime(0);
    $('hudDelta').textContent = '';
    const ribbon = $('hudDeltaRibbon');
    if (ribbon) ribbon.style.width = '0%';
    G.lastBeep = 4;
    G.prevSlideState = false;
    $('hudLap').textContent = 'LAP 1/' + ((G.track && G.track.laps) || 1);
    G.driftFlash = 0;
    G.prevSecondsVal = -1;
    G.prevSpeedVal = -1;
    const leftBox = $('hudLeftBox');
    if (leftBox) leftBox.classList.remove('purple-flash');
    const finishEl = $('finish');
    if (finishEl) finishEl.classList.remove('pb-celebration');
    const warnEl = $('hudWarn');
    if (warnEl) {
      warnEl.classList.remove('final-sector-pulse');
      warnEl.style.opacity = 0;
    }
    triggerHudStreak();
  }

  function finishRun() {
    G.state = 'finish';
    const ms = G.car.finalMs;
    if (DD.testMode) {
      console.log('[TEST] RESULT: PASS: time=' + ms + 'ms, respawns=' + G.car.respawns + ', splits=' + JSON.stringify(G.car.splits));
    }
    const track = G.track;
    const key = seedKey(track.seed, track.tier);
    const medal = medalFor(ms, track.medals);
    let rec = G.save.tracks[key] || { attempts: 0 };
    rec.attempts = (rec.attempts || 0) + 1;
    rec.lastPlayed = Date.now();
    const isPB = !rec.pb || ms < rec.pb;
    if (isPB) {
      rec.pb = ms;
      rec.splits = G.car.splits.slice();
      rec.ghost = encodeGhost(G.recFrames);
      const oldRank = MEDAL_ORDER.indexOf(rec.medal), newRank = MEDAL_ORDER.indexOf(medal);
      if (newRank > oldRank || !rec.medal) rec.medal = medal;
    }
    G.save.tracks[key] = rec;
    pruneGhosts();
    DD.persistSave(G.save);

    // Live-refresh the ghost to the new PB line so the very next retry races it. Ghosts used to
    // load only in loadTrack, so the retry loop — the way a time-attack game is actually played —
    // never saw the PB set moments earlier; you only met your ghost after exiting to the menu and
    // re-entering the same seed.
    if (isPB) {
      const flat = new Float32Array(G.recFrames.length * 4);
      for (let i = 0; i < G.recFrames.length; i++) {
        const fr = G.recFrames[i];
        flat[i * 4] = fr[0]; flat[i * 4 + 1] = fr[1]; flat[i * 4 + 2] = fr[2]; flat[i * 4 + 3] = fr[3];
      }
      const ghostOpt = G.save.settings.ghost || 'pb';
      if (ghostOpt === 'pb') {
        G.ghostData = flat;
        G.ghostTimes = precomputeGhostTimes(track, flat);
        G.racedGhostType = 'pb';
        G.racedGhostTime = ms;
        if (!G.ghostMesh) {
          G.ghostMesh = DD.buildCar(G.save.garage, true, G.scene.environment, G.save.customDesigns);
          G.scene.add(G.ghostMesh);
        }
      }
      $('hudPB').textContent = 'PB ' + DD.formatTime(ms);
      updateHudGhostTag();
    }

    DD.engineQuiet();
    DD.sfxFinish(medal);

    dialInText($('finTime'), DD.formatTime(ms));

    const finDelta = $('finDelta');
    if (finDelta) {
      if (G.racedGhostType !== 'off' && G.racedGhostTime > 0) {
        const d = ms - G.racedGhostTime;
        finDelta.textContent = DD.formatDelta(d) + ' vs ' + (G.racedGhostType === 'pb' ? 'PB' : 'AUTHOR');
        finDelta.className = d <= 0 ? 'neg' : 'pos';
        finDelta.style.display = 'block';
      } else {
        finDelta.style.display = 'none';
        finDelta.textContent = '';
      }
    }

    $('finMedal').textContent = medal === 'none' ? 'no medal' : (medal === 'author' ? '◆ AUTHOR' : '● ' + medal.toUpperCase());
    $('finMedal').className = 'md ' + medal;
    $('finPB').textContent = isPB ? (rec.attempts === 1 ? 'first run!' : 'new personal best!') : ('PB ' + DD.formatTime(rec.pb));
    dialInText($('finSeed'), track.seed + '  ·  TIER ' + track.tier);

    const finLaps = $('finLaps');
    if (finLaps) {
      if (track.laps > 1) {
        finLaps.innerHTML = '';
        finLaps.style.display = 'flex';
        const splits = G.car.lapSplits || [];
        let prevTime = 0;
        for (let l = 0; l < track.laps; l++) {
          const endTime = (l === track.laps - 1) ? ms : (splits[l] || ms);
          const lapTime = endTime - prevTime;
          prevTime = endTime;
          
          const row = document.createElement('div');
          row.className = 'finLapRow';
          finLaps.appendChild(row);
          dialInText(row, 'LAP ' + (l + 1) + '  ·  ' + DD.formatTime(lapTime));
        }
      } else {
        finLaps.style.display = 'none';
        finLaps.innerHTML = '';
      }
    }

    const finishEl = $('finish');
    if (finishEl) {
      if (isPB) {
        finishEl.classList.add('pb-celebration');
      } else {
        finishEl.classList.remove('pb-celebration');
      }
    }

    showScreen('finish');
  }

  function pruneGhosts() {
    const keys = Object.keys(G.save.tracks).filter(k => G.save.tracks[k].ghost);
    if (keys.length > 40) {
      keys.sort((a, b) => (G.save.tracks[a].lastPlayed || 0) - (G.save.tracks[b].lastPlayed || 0));
      for (let i = 0; i < keys.length - 40; i++) delete G.save.tracks[keys[i]].ghost;
    }
  }

  // Drive the bloom pass toward the shared target strength (DD.bloomStrength) — the ONE formula all
  // render states share, so the glow reads consistently instead of "all over the place". dt>0 damps
  // toward the target (drift/speed accents swell in rather than pop); dt<=0 snaps (static screens).
  function applyBloom(speedNorm, driftFlash, dt) {
    const c = G.composer;
    if (!c || !c._bloom) return;
    const target = DD.bloomStrength(G.save.settings, G.track && G.track.theme, speedNorm, driftFlash);
    if (dt && dt > 0) {
      c._bloom.strength += (target - c._bloom.strength) * (1 - Math.exp(-8 * dt));
    } else {
      c._bloom.strength = target;
    }
  }

  // Drive the radial speed-blur strength from normalized speed. Ramps in above half speed so slow
  // driving and menus pay nothing (the shader early-outs at strength 0). DD.speedBlurMax tunes the
  // peak (live-adjustable from the console).
  function applySpeedBlur(speedNorm) {
    const sb = G.composer && G.composer._speedBlur;
    if (sb) sb.uniforms.uStrength.value = Math.max(0, (speedNorm - 0.5) / 0.5) * (DD.speedBlurMax || 0);
  }

  // Adaptive DPR (dynamic resolution). Frame cost swings by track section (emissive overdraw, draw
  // count); a FIXED pixel ratio either wastes headroom on light sections or drops to a vsync-quantized
  // 40fps on heavy ones. We trade resolution to hold 60. KEY: under vsync, frame time is pinned at
  // ~16.7ms whenever we hit 60 — so it can't reveal spare GPU headroom. Instead we PROBE: shed pixels
  // fast when frames miss 60, and after holding 60 for a while, nudge the ratio back up to reclaim
  // sharpness; if that nudge causes drops, the drop path reverts it. No GPU timer needed (EXT can be
  // absent/HUD-gated), so this works on every browser. Isolated one-offs (GC, track build) ignored.
  function updateAdaptiveDPR(dt) {
    if (!DD.adaptiveDPR || !G.renderer || !G._dprCap) return;
    const a = G._adpt || (G._adpt = { dpr: G.renderer.getPixelRatio(), down: 0, up: 0, cd: 0 });
    const ms = dt * 1000;
    if (ms > 60) return;                    // one-off hitch (GC / first track-build frame) — ignore
    if (a.cd > 0) { a.cd--; return; }       // settle window after a change — don't react while the
                                            // reallocated render targets warm up (that realloc is itself
                                            // a one-frame cost, so changes must be RARE, not per-second)
    const MIN = 1.0, STEP = 0.05;
    // count only CONSECUTIVE runs — a single stray frame resets the tally, so we act on sustained
    // load, never noise. Down is responsive (4 frames); up is deliberately slow (300 clean frames ≈ 5s)
    // so a section that dips even occasionally never climbs → the controller settles and stops pumping.
    if (ms > 18.5) { a.down++; a.up = 0; } else if (ms < 16.7) { a.up++; a.down = 0; } else { a.down = 0; a.up = 0; }
    if (a.down >= 4 && a.dpr > MIN) {
      a.dpr = Math.max(MIN, +(a.dpr - STEP).toFixed(3)); DD.setDPR(a.dpr); a.down = 0; a.cd = 90;
    } else if (a.up >= 300 && a.dpr < G._dprCap) {
      a.dpr = Math.min(G._dprCap, +(a.dpr + STEP).toFixed(3)); DD.setDPR(a.dpr); a.up = 0; a.cd = 90;
    }
  }

  /* ---------------- main loop ---------------- */
  function loop(t) {
    requestAnimationFrame(loop);
    const dtReal = Math.min((t - G.lastT) / 1000, 0.1);
    G.lastT = t;
    // Dev: spike hunter. Set DD.spikeLog=true (or a ms threshold) then race; any long frame logs the
    // renderer.info deltas since the previous frame, so the culprit (texture upload, new geometry,
    // shader program) shows up as a +N. Isolates the 1%low stutter source, which is DPR-independent.
    if (DD.spikeLog && (G.state === 'play' || G.state === 'countdown')) {
      const ms = dtReal * 1000, thr = (DD.spikeLog === true ? 22 : DD.spikeLog);
      const inf = G.renderer.info, p = G._spikePrev || {};
      const d = (cur, prev) => (cur - (prev || 0) >= 0 ? '+' : '') + (cur - (prev || 0));
      if (ms > thr && G._spikePrev) {
        console.log(`[SPIKE] ${ms.toFixed(1)}ms | draws ${inf.render.calls} ${d(inf.render.calls, p.calls)} | tris ${(inf.render.triangles / 1000).toFixed(0)}k | tex ${inf.memory.textures} ${d(inf.memory.textures, p.tex)} | geo ${inf.memory.geometries} ${d(inf.memory.geometries, p.geo)} | prog ${inf.programs ? inf.programs.length : '?'}`);
      }
      G._spikePrev = { calls: inf.render.calls, tex: inf.memory.textures, geo: inf.memory.geometries };
    }
    if (G.state === 'play' || G.state === 'countdown') updateAdaptiveDPR(dtReal);
    if (G.state === 'loading') return;

    if (G.state === 'replay') {
      updateReplay(dtReal, t);
      return;
    }

    if (G.state === 'menu' || G.state === 'garage') {
      const orbitSpeed = G.state === 'garage' ? 0.00018 : 0.00008;
      // Freeze the ambient auto-spin while customizing — a moving target makes precision ring-dragging
      // unusable. Manual drag-to-orbit (garageDragYaw) still works in every mode.
      const autoSpin = (G.state === 'garage' && G.workingSpec) ? 0 : t * orbitSpeed;
      const dragAngle = G.garageDragYaw || 0;
      const angle = autoSpin + dragAngle;
      // T6: pinch-zoom adjusts the orbit radius (zoom > 1 = closer). Default 1 = original framing.
      const zoom = G.state === 'garage' ? (G.garageZoom || 1) : 1;
      const radius = (G.state === 'garage' ? 7.5 : 12.0) / zoom;
      const height = G.state === 'garage' ? 2.4 : 3.8;

      const carPos = G.car ? G.car.pos : [0, 4, 0];

      // T12 cross-section editor camera: when a cross-session is active, override the orbit and tween
      // the camera end-on down the spine so the grabbed ring reads as a flat 2D outline. The tween
      // eases over ~300ms from the orbit position the player was in when they grabbed the ring.
      if (G.state === 'garage' && G.crossSession) {
        const cs = G.crossSession;
        const elapsed = (t - cs.tweenStart) / 1000;
        // target = station world position. Position = target + spine-axis offset (look down -Z toward nose).
        const hp = G.workingSpec.chassis.hardpoints, L = G.workingSpec.chassis.L;
        const frontZ = hp.frontZ * L, rearZ = hp.rearZ * L, midZ = (frontZ + rearZ) / 2;
        const wheelbase = frontZ - rearZ;
        const st = G.workingSpec.chassis.hull.station[cs.stationIndex];
        const stWz = st[0] * wheelbase + midZ;
        crossToPos.set(carPos[0], carPos[1] + 0.4, carPos[2] + stWz + radius); // behind the car, looking forward
        if (elapsed >= 0.3) {
          crossCurPos.copy(crossToPos);
        } else {
          const e = easeOut(elapsed / 0.3);
          crossCurPos.lerpVectors(cs.fromPos, crossToPos, e);
        }
        G.camera.position.copy(crossCurPos);
        G.camera.lookAt(carPos[0], carPos[1] + 0.4, carPos[2] + stWz);
      } else {
        G.camera.position.set(
          carPos[0] + Math.sin(angle) * radius,
          carPos[1] + height,
          carPos[2] - Math.cos(angle) * radius
        );
        G.camera.lookAt(carPos[0], carPos[1] + 0.4, carPos[2]);
      }

      // Garage stage: a dedicated platform for the showcase car (see DD.buildGarageStage) so it
      // doesn't look parked in the middle of the actual raceway; hides the start/checkpoint gate
      // arches while here. Sky/mountains/stars/decor are untouched — only the immediate ground +
      // gate props swap out, keeping the surrounding world/theme intact.
      // Camera FOV smooth ease: 60 in garage, 68 in menus/race
      const targetFov = G.state === 'garage' ? 60 : 68;
      if (Math.abs(G.camera.fov - targetFov) > 0.05) {
        G.camera.fov += (targetFov - G.camera.fov) * 0.1;
        G.camera.updateProjectionMatrix();
      }

      // Hide track and weather meshes in the garage
      if (G.trackRoot && G.state === 'garage' && G.trackRoot.parent === G.scene) {
        G.scene.remove(G.trackRoot);
      } else if (G.trackRoot && G.state !== 'garage' && G.trackRoot.parent !== G.scene) {
        G.scene.add(G.trackRoot);
      }
      if (G.weather) G.weather.visible = G.state !== 'garage';

      // Initialize dedicated garage room and capture envMap once
      if (!G.garageStage) {
        G.garageStage = DD.buildGarageStage(null, G.track && G.track.theme);
        G.scene.add(G.garageStage);
        G.garageStage.position.set(carPos[0], carPos[1], carPos[2]);

        const trackWasInScene = G.trackRoot && G.trackRoot.parent === G.scene;
        if (G.trackRoot && trackWasInScene) G.scene.remove(G.trackRoot);
        G.garageStage.visible = true;

        const originalStagePos = G.garageStage.position.clone();
        G.garageStage.position.set(0, 0, 0);

        const garageEnv = DD.captureGarageEnvironment(G.renderer, G.scene, G.carMesh);
        
        G.garageStage.position.copy(originalStagePos);
        if (G.trackRoot && trackWasInScene) G.scene.add(G.trackRoot);

        if (garageEnv) {
          G.garageEnvMap = garageEnv;
          const floorMesh = G.garageStage.children[0];
          if (floorMesh && floorMesh.material) {
            floorMesh.material.envMap = garageEnv;
            floorMesh.material.needsUpdate = true;
          }
        }
      }
      G.garageStage.position.set(carPos[0], carPos[1], carPos[2]);
      G.garageStage.visible = G.state === 'garage';

      if (G.track && G.track.gateMeshes) {
        G.track.gateMeshes.forEach((m) => { m.visible = G.state !== 'garage'; });
      }
      if (G.track && G.track.garageHide) {
        for (const m of G.track.garageHide) m.visible = G.state !== 'garage';
      }

      // Manage garage state entry/exit configuration changes (background, fog, envMap)
      if (G.state === 'garage') {
        if (!G.inGarageSetup) {
          G.inGarageSetup = true;
          G.prevFog = G.scene.fog;
          G.prevBackground = G.scene.background;
          G.prevEnv = G.scene.environment;

          G.scene.background = new THREE.Color(0x06060c);
          G.scene.fog = new THREE.Fog(0x06060c, 10, 50);
          if (G.garageEnvMap) {
            G.scene.environment = G.garageEnvMap;
          }
        }


      } else {
        if (G.inGarageSetup) {
          G.inGarageSetup = false;
          G.scene.fog = G.prevFog;
          G.scene.background = G.prevBackground;
          G.scene.environment = G.prevEnv;
        }
      }

      const s0 = G.track ? G.track.samples[G.track.startIdx] : null;
      if (G.car && G.carMesh && s0) {
        DD.poseCar(G.carMesh, G.car.pos, G.car.yaw, s0.u, 0, 0, 0, 0, 0);
        if (G.shadow) {
          DD.updateShadow(G.shadow, G.car.pos, s0.u, G.car.yaw, G.car, G.track);
        }
      }
      if (G.ghostMesh) G.ghostMesh.visible = false;

      if (G.track && G.state !== 'garage') {
        if (G.track.nebulaeMesh) { G.track.nebulaeMesh.rotation.y = t * 0.000015; G.track.nebulaeMesh.position.copy(G.camera.position); }
        if (G.track.planetMesh) { G.track.planetMesh.rotation.y = -t * 0.00003; G.track.planetMesh.position.copy(G.camera.position); }
        if (G.track.starsMesh) { G.track.starsMesh.rotation.y = t * 0.000007; const _sm = G.track.starsMesh.material; if (_sm.uniforms && _sm.uniforms.time) _sm.uniforms.time.value = t * 0.001; }
        // one shared breath LFO (DD.GLOW.breathHz) — world glow pulses together, gently
        const breath = Math.sin(t * 0.001 * Math.PI * 2 * DD.GLOW.breathHz);
        if (G.track.gateMeshes) {
          for (const m of G.track.gateMeshes) m.material.opacity = DD.GLOW.gate.base + DD.GLOW.gate.amp * breath;
        }
        if (G.track.emissiveDecorMesh) {
          const mat = G.track.emissiveDecorMesh.userData.mat;
          if (mat) mat.emissiveIntensity = (DD.GLOW.decor.base + DD.GLOW.decor.amp * breath) * DD.glowMul(G.save.settings, G.track.theme);
        }
      }
      if (G.carMesh && G.carMesh.userData.iridescent) {
        const h = (t * 0.00012) % 1;
        G.carMesh.userData.iridescent.emissive = new THREE.Color().setHSL(h, 0.7, 0.25);
        G.carMesh.userData.iridescent.emissiveIntensity = 0.5;
      }
      if (G.weather && DD.updateWeather) {
        DD.updateWeather(G.weather, G.camera, dtReal, t * 0.001);
      }

      applyBloom(0, 0, dtReal); // non-racing animated state — ease to steady base glow
      applySpeedBlur(0);
      if (G.track && DD.updateLightPool) DD.updateLightPool(G.track, G.camera.position.x, G.camera.position.y, G.camera.position.z);
      if (G.composer) G.composer.render(); else G.renderer.render(G.scene, G.camera);
      return;
    }

    const input = (DD.testMode && DD.autodrive && G.car && G.track) ? DD.getBotInput(G.car, G.track) : DD.pollInput(G.save.settings);

    if (DD.input.restartReq) {
      DD.input.restartReq = false;
      if (G.state === 'play' || G.state === 'finish' || G.state === 'countdown') { DD.sfxClick(); resetRun(true); return; }
    }
    if (DD.input.respawnReq) {
      DD.input.respawnReq = false;
      if (G.state === 'play') { DD.respawnCheckpoint(G.car, G.track); DD.sfxRespawn(); }
    }

    if (G.state === 'countdown') {
      G.countdownT -= dtReal;
      const n = Math.ceil(G.countdownT);
      const el = $('countNum');
      if (G.countdownT > 0) {
        if (el.textContent !== String(n)) {
          el.textContent = n;
          el.classList.remove('pulse-tick');
          void el.offsetWidth;
          el.classList.add('pulse-tick');
        }
        if (n < G.lastBeep) { G.lastBeep = n; DD.sfxCountdown(false); }
      } else {
        $('countdown').style.display = 'none';
        DD.sfxCountdown(true);
        G.state = 'play';
        if (DD.testMode) {
          console.log('[TEST] RACE_START');
        }
      }
    }

    if (G.state === 'play') {
      G.acc += dtReal;
      let steps = 0;
      let frameHitWall = false;
      while (G.acc >= DD.TICK && steps < 4) {
        DD._ipSet(G.prevPos, G.car.pos[0], G.car.pos[1], G.car.pos[2]);
        G.prevYaw = G.car.yaw;
        DD.stepCar(G.car, input, G.track);
        DD.postWallClamp(G.car, G.track);
        if (G.car.hitWall) frameHitWall = true;
        G.tickCount++;
        // ghost record
        if (G.tickCount % G.recEvery === 0) G.recFrames.push([G.car.pos[0], G.car.pos[1], G.car.pos[2], G.car.yaw]);
        // events
        if (G.car.justCkpt) {
          const i = G.car.justCkpt - 1; G.car.justCkpt = 0;
          DD.sfxCheckpoint(i);
          if (G.track) {
            G.track.flashingGantries = G.track.flashingGantries || {};
            G.track.flashingGantries[i] = 1.0;
          }
          if (DD.testMode) {
            console.log('[TEST] CHECKPOINT: index=' + i + ', time=' + G.car.splits[i] + 'ms');
          }
          const rec = G.save.tracks[seedKey(G.track.seed, G.track.tier)];
          const ghostOpt = G.save.settings.ghost || 'pb';
          let targetSplits = null;
          if (ghostOpt === 'pb') {
            targetSplits = (rec && rec.ghost) ? rec.splits : (G.track.authorSplits || null);
          } else if (ghostOpt === 'author') {
            targetSplits = G.track.authorSplits || null;
          }
          if (targetSplits && targetSplits[i] != null) {
            const d = G.car.splits[i] - targetSplits[i];
            // (the live delta number is driven continuously below; here we only fire the ahead-of-PB flash)
            if (d <= 0) {
              const leftBox = $('hudLeftBox');
              if (leftBox) {
                leftBox.classList.remove('purple-flash');
                void leftBox.offsetWidth;
                leftBox.classList.add('purple-flash');
              }
              if (i === G.track.checkpoints.length * (G.track.laps || 1) - 1) {
                const warnEl = $('hudWarn');
                if (warnEl) {
                  warnEl.textContent = 'FINAL SECTOR';
                  warnEl.style.opacity = 1;
                  warnEl.classList.remove('final-sector-pulse');
                  void warnEl.offsetWidth;
                  warnEl.classList.add('final-sector-pulse');
                  setTimeout(() => {
                    if (warnEl.textContent === 'FINAL SECTOR') warnEl.style.opacity = 0;
                  }, 1500);
                }
              }
            }
          }
        }
        if (G.car.justLap) {
          // circuits: crossed the lap line — bump the LAP counter, chime, sector flash
          const lapN = G.car.justLap; G.car.justLap = 0;
          if (!G.car.lapSplits) G.car.lapSplits = [];
          G.car.lapSplits.push(Math.round(G.car.time));
          $('hudLap').textContent = 'LAP ' + (lapN + 1) + '/' + (G.track.laps || 1);
          DD.sfxCheckpoint(0);
          const lb = $('hudLeftBox');
          if (lb) { lb.classList.remove('purple-flash'); void lb.offsetWidth; lb.classList.add('purple-flash'); }
          if (G.track.laps && lapN === G.track.laps - 1) {
            const warnEl = $('hudWarn');
            if (warnEl) {
              warnEl.textContent = 'FINAL LAP';
              warnEl.style.opacity = 1;
              warnEl.classList.remove('final-sector-pulse');
              void warnEl.offsetWidth;
              warnEl.classList.add('final-sector-pulse');
              setTimeout(() => {
                if (warnEl.textContent === 'FINAL LAP') warnEl.style.opacity = 0;
              }, 1500);
            }
          }
        }
        if (G.car.fellOff) {
          G.car.fellOff = false;
          DD.respawnCheckpoint(G.car, G.track);
          DD.sfxRespawn();
        }
        if (G.car.finished) { finishRun(); break; }
        if (DD.testMode && DD.duration !== null && G.car.time >= DD.duration) {
          G.state = 'finish';
          const durSec = (G.car.time / 1000).toFixed(3);
          console.log('[TEST] RESULT: FAIL: reason=timeout, duration=' + durSec + 's, current checkpoint=' + G.car.nextCkpt);
          break;
        }
        G.acc -= DD.TICK;
        steps++;
      }
      if (steps > 0) {
        G.car.hitWall = frameHitWall;
      }
      if (steps === 4) G.acc = 0; // spiral-of-death guard
      updateHudTime(G.car.time);
    }

    // ---- render (interp) ----
    const alpha = G.state === 'play' ? DD.clamp(G.acc / DD.TICK, 0, 1) : 1;
    const pP = G.prevPos, cP = G.car.pos;
    drawPosScratch[0] = pP[0] + (cP[0] - pP[0]) * alpha;
    drawPosScratch[1] = pP[1] + (cP[1] - pP[1]) * alpha;
    drawPosScratch[2] = pP[2] + (cP[2] - pP[2]) * alpha;
    const drawPos = drawPosScratch;

    const drawYaw = G.prevYaw + DD.angleDiff(G.prevYaw, G.car.yaw) * alpha;
    const s = G.track.samples[Math.min(G.car.idx, G.track.samples.length - 1)];
    const speed = V.len(G.car.vel);
    const speedNorm = DD.clamp(speed / DD.PHYS.vmax, 0, 1);

    // O4: Speed-recede for HUD side panels (subtle opacity fade down to 0.5 at max speed)
    const hudOpacity = 1.0 - speedNorm * 0.5;
    if (cachedHudLeftBox) cachedHudLeftBox.style.opacity = hudOpacity;
    if (cachedHudSpeedBox) cachedHudSpeedBox.style.opacity = hudOpacity;
    if (cachedHudMedals) cachedHudMedals.style.opacity = hudOpacity;

    G.wheelSpin = speed * dtReal * 2.2;
    const carUp = G.car.onDirt && G.track.terrain ? DD.terrainNormal(G.track.terrain, drawPos[0], drawPos[2]) : s.u;
    DD.poseCar(G.carMesh, drawPos, drawYaw, carUp, G.car.rollVis, G.car.grounded ? G.car.suspV * 0.04 : G.car.pitchVis, G.wheelSpin, G.car.wheelAngle, G.car.suspY);

    DD.updateShadow(G.shadow, drawPos, carUp, drawYaw, G.car, G.track);
    if (G.track && G.track.sunLight && G.car) {
      const theme = G.track.theme;
      G.track.sunLight.position.set(
        drawPos[0] + Math.sin(theme.lightAngle) * 120,
        drawPos[1] + 48.0,
        drawPos[2] + Math.cos(theme.lightAngle) * 120
      );
      if (G.track.sunLight.target) {
        G.track.sunLight.target.position.set(drawPos[0], drawPos[1], drawPos[2]);
      }
    }
    DD.updateTrail(G.trail, G.car, G.track, speedNorm);
    if (DD._sceneShared.updateBoostPads) {
      DD._sceneShared.updateBoostPads(G.track, dtReal);
    }
    if (DD._sceneShared.updateGates) {
      DD._sceneShared.updateGates(G.track, dtReal, G.state, G.countdownT, G.car ? G.car.nextCkpt : 0);
    }
    if (DD._sceneShared.updateLandingPads) {
      DD._sceneShared.updateLandingPads(G.track, t);
    }
    DD.updateSpeedLines(G.speedLines, G.camera, speedNorm);
    DD.updateFireflies(G.track.fireflies, t * 0.001);
    if (G.weather && DD.updateWeather) {
      DD.updateWeather(G.weather, G.camera, dtReal, t * 0.001);
    }

    // Rotate distant celestial objects (kinetic space drift)
    if (G.track.nebulaeMesh) G.track.nebulaeMesh.rotation.y = t * 0.000015;
    if (G.track.planetMesh) G.track.planetMesh.rotation.y = -t * 0.00003;
    if (G.track.starsMesh) G.track.starsMesh.rotation.y = t * 0.000007;
    const slideAmt = G.car.slipMax || 0;
    DD.updateSkidmarks(G.skid, G.car, G.track, G.car.sliding && slideAmt > 0.1 && G.state === 'play');
    DD.updateSmoke(G.smoke, G.car, G.track, dtReal, (G.car.sliding && slideAmt > 0.32) || (G.car.onDirt && speed > 14));
    
    // Check for clean drift release
    const isCurrentlyDrifting = G.car.sliding && G.car.slideState;
    if (G.prevSlideState && !isCurrentlyDrifting && !G.car.hitWall && speed > 10) {
      G.driftFlash = 1.0;
    }
    G.prevSlideState = isCurrentlyDrifting;

    if (G.driftFlash > 0) {
      G.driftFlash = Math.max(0, G.driftFlash - dtReal * DD.GLOW.bloom.flashDecay);
    }

    if (G.sparks && DD.updateSparks) {
      const isDrifting = G.car.sliding && G.car.slideState && speed > 10;
      DD.updateSparks(G.sparks, G.car, G.track, dtReal, (G.car.hitWall && speed > 10) || isDrifting, isDrifting);
      if (G.car.hitWall && speed > 5 && !G.prevHitWall) { DD.sfxWallThud(speedNorm); } G.prevHitWall = G.car.hitWall && speed > 5;
    }
    DD.updateSurfaceAudio(G.car.sliding ? DD.clamp(slideAmt * 3, 0, 1) : 0, speed, G.car.onDirt, G.car.hitWall);
    // off-track / missed checkpoint warnings
    const warnEl = cachedHudWarn;
    if (G.car.missedCkpt) { warnEl.textContent = 'checkpoint missed — respawn (⚑)'; warnEl.style.opacity = 1; }
    else if (G.car.onDirt && G.state === 'play') { warnEl.textContent = 'off track'; warnEl.style.opacity = 0.55; }
    else {
      if (warnEl.textContent !== 'FINAL SECTOR' && warnEl.textContent !== 'FINAL LAP') {
        warnEl.style.opacity = 0;
      }
    }
    if (G.camState.prevGrounded === false && G.car.grounded && (G.camState.prevVelY || 0) < -2) { DD.sfxLandingWhump(-(G.camState.prevVelY || 0) / 22); }
    DD.updateCamera(G.camera, G.camState, G.car, G.track, dtReal, speed);

    // iridescent shimmer
    if (G.carMesh.userData.iridescent) {
      const h = (t * 0.00012) % 1;
      G.carMesh.userData.iridescent.emissive.copy(scratchColor.setHSL(h, 0.7, 0.25));
      G.carMesh.userData.iridescent.emissiveIntensity = 0.5;
    }
    // car boost glow — pulse the body shell while on a boost pad (consumes car.boostGlow)
    const ud = G.carMesh.userData;
    if (ud.boostShell && ud.baseEmis && !ud.iridescent) {
      const m = ud.boostShell, bg = G.car.boostGlow || 0, bc = G.track.theme.boostColor;
      if (bg > 0.001) {
        m.emissive.setRGB(
          ud.baseEmis.r + (bc[0] - ud.baseEmis.r) * bg,
          ud.baseEmis.g + (bc[1] - ud.baseEmis.g) * bg,
          ud.baseEmis.b + (bc[2] - ud.baseEmis.b) * bg);
        m.emissiveIntensity = ud.baseEmisI + bg * 1.6;
      } else if (m.emissiveIntensity !== ud.baseEmisI) {
        m.emissive.copy(ud.baseEmis);
        m.emissiveIntensity = ud.baseEmisI;
      }
    }
    // world glow: one shared breath LFO (DD.GLOW.breathHz) — boost pads, decor and gates
    // pulse together, gently, instead of three sines at competing frequencies
    const breath = Math.sin(t * 0.001 * Math.PI * 2 * DD.GLOW.breathHz);
    if (G.track.boostBaseMat) G.track.boostBaseMat.opacity = (DD.GLOW.boost.base + DD.GLOW.boost.amp * breath) * 1.5;
    if (G.track.boostChevronMat) G.track.boostChevronMat.opacity = 0.5 + (DD.GLOW.boost.base + DD.GLOW.boost.amp * breath) * 0.8;
    if (G.track && G.track.emissiveDecorMesh) {
      const mat = G.track.emissiveDecorMesh.userData.mat;
      if (mat) mat.emissiveIntensity = (DD.GLOW.decor.base + DD.GLOW.decor.amp * breath) * DD.glowMul(G.save.settings, G.track.theme);
    }
    if (G.track.gateMeshes) {
      for (let i = 0; i < G.track.gateMeshes.length; i++) {
        const passed = i < G.car.nextCkpt;
        G.track.gateMeshes[i].material.opacity = passed ? DD.GLOW.gate.passed : DD.GLOW.gate.base + DD.GLOW.gate.amp * breath;
      }
    }

    // ghost playback
    if (G.ghostMesh && G.ghostData && (G.state === 'play')) {
      const fi = Math.min(Math.floor(G.tickCount / G.recEvery), G.ghostData.length / 4 - 2);
      if (fi >= 0) {
        const a = fi * 4, b = (fi + 1) * 4;
        const tt = (G.tickCount % G.recEvery) / G.recEvery;
        const gp = [
          DD.lerp(G.ghostData[a], G.ghostData[b], tt),
          DD.lerp(G.ghostData[a + 1], G.ghostData[b + 1], tt),
          DD.lerp(G.ghostData[a + 2], G.ghostData[b + 2], tt)
        ];
        const gy = G.ghostData[a + 3] + DD.angleDiff(G.ghostData[a + 3], G.ghostData[b + 3]) * tt;
        // ghost wheels spin at the GHOST's own speed (distance between recorded frames), not the player's
        const gdx = G.ghostData[b] - G.ghostData[a], gdz = G.ghostData[b + 2] - G.ghostData[a + 2];
        const ghostSpd = Math.sqrt(gdx * gdx + gdz * gdz) / (G.recEvery * DD.TICK);
        DD.poseCar(G.ghostMesh, gp, gy, [0, 1, 0], 0, 0, ghostSpd * dtReal * 2.2);
        G.ghostMesh.visible = true;
      }
    } else if (G.ghostMesh) G.ghostMesh.visible = G.state === 'play';

    // audio
    const th = G.state === 'play' ? input.throttle : 0;
    DD.updateEngine(G.state === 'finish' ? speed * 0.3 : speed, th, G.car.grounded, G.car.surf, dtReal, G.car.gear, G.car.rpm01);
    // HUD speed/gear
    const speedVal = Math.round(speed * 3.6);
    if (speedVal !== G.prevSpeedVal) {
      G.prevSpeedVal = speedVal;
      const speedEl = cachedHudSpeed;
      if (speedEl) {
        speedEl.textContent = speedVal;
        speedEl.classList.remove('digit-change');
        void speedEl.offsetWidth;
        speedEl.classList.add('digit-change');
      }
    }
    const gearEl = cachedHudGear;
    if (gearEl) {
      gearEl.textContent = G.state === 'play' || G.state === 'finish' ? G.car.gear : '·';
      gearEl.classList.toggle('shift-cut', G.car.shiftCut > 0);
    }

    // RPM tach: fill the arc around the gear; redline drives the shift state (red arc + red gear)
    const speedBox = cachedHudSpeedBox;
    if (speedBox && G.car) {
      const fill = cachedRpmFill;
      if (fill) fill.style.strokeDasharray = (184.3 * DD.clamp(G.car.rpm01, 0, 1)).toFixed(1) + ' 276.46';
      speedBox.classList.toggle('redline', G.car.rpm01 > 0.92 && (G.state === 'play'));
    }

    // continuous delta vs the player ghost — shown as a live coloured NUMBER (green ahead / red behind)
    const deltaEl = cachedHudDelta;
    if (deltaEl && G.state === 'play') {
      if (G.ghostTimes && G.car) {
        const pIdx = Math.min((G.car.lap || 0) * G.track.samples.length + G.car.idx, G.ghostTimes.length - 1);
        const gt = G.ghostTimes[pIdx];
        if (gt > 0 && G.car.time > 250) {
          const d = G.car.time - gt;
          deltaEl.textContent = DD.formatDelta(d);
          deltaEl.className = d <= 0 ? 'neg' : 'pos';
        } else {
          deltaEl.textContent = '';
        }
      }
    }

    // Update timing tower
    if (G.track && G.car && (G.state === 'play' || G.state === 'finish')) {
      const t = G.state === 'play' ? G.car.time : G.car.finalMs;
      const authorTime = G.track.medals.author;
      const goldTime = G.track.medals.gold;
      const silverTime = G.track.medals.silver;
      const bronzeTime = G.track.medals.bronze;

      const rowA = $('towerAuthor');
      const rowG = $('towerGold');
      const rowS = $('towerSilver');
      const rowB = $('towerBronze');

      if (rowA && rowG && rowS && rowB) {
        if (t < authorTime) {
          rowA.className = 'tower-row active';
          rowG.className = 'tower-row';
          rowS.className = 'tower-row';
          rowB.className = 'tower-row';
        } else if (t < goldTime) {
          rowA.className = 'tower-row missed';
          rowG.className = 'tower-row active';
          rowS.className = 'tower-row';
          rowB.className = 'tower-row';
        } else if (t < silverTime) {
          rowA.className = 'tower-row missed';
          rowG.className = 'tower-row missed';
          rowS.className = 'tower-row active';
          rowB.className = 'tower-row';
        } else if (t < bronzeTime) {
          rowA.className = 'tower-row missed';
          rowG.className = 'tower-row missed';
          rowS.className = 'tower-row missed';
          rowB.className = 'tower-row active';
        } else {
          rowA.className = 'tower-row missed';
          rowG.className = 'tower-row missed';
          rowS.className = 'tower-row missed';
          rowB.className = 'tower-row missed';
        }
      }
    }

    // race glow: speed swell + drift accent, smoothed so surges never pop or white out (hard-capped)
    applyBloom(speed / DD.PHYS.vmax, G.driftFlash || 0, dtReal);
    applySpeedBlur(speed / DD.PHYS.vmax);

    if (G.track && DD.updateLightPool) DD.updateLightPool(G.track, G.camera.position.x, G.camera.position.y, G.camera.position.z);
    if (G.composer) G.composer.render(); else G.renderer.render(G.scene, G.camera);
  }

  function updateHudTime(ms) {
    const secVal = Math.floor(ms / 1000);
    const timeEl = $('hudTime');
    if (timeEl) {
      const newText = DD.formatTime(ms);
      if (timeEl.textContent !== newText) {
        timeEl.textContent = newText;
        if (secVal !== G.prevSecondsVal) {
          G.prevSecondsVal = secVal;
          timeEl.classList.remove('digit-change');
          void timeEl.offsetWidth;
          timeEl.classList.add('digit-change');
        }
      }
    }
  }

  /* ---------------- theme coloring ---------------- */
  const DEFAULT_THEME = {
    accent: [157/255, 123/255, 255/255],
    accent2: [255/255, 123/255, 213/255],
    sunColor: [255/255, 179/255, 123/255]
  };

  function applyCssTheme(theme) {
    const th = theme || DEFAULT_THEME;
    const r1 = Math.round(th.accent[0] * 255);
    const g1 = Math.round(th.accent[1] * 255);
    const b1 = Math.round(th.accent[2] * 255);
    const r2 = Math.round(th.accent2[0] * 255);
    const g2 = Math.round(th.accent2[1] * 255);
    const b2 = Math.round(th.accent2[2] * 255);
    const warmColor = th.sunColor || th.accent2 || DEFAULT_THEME.sunColor;
    const rw = Math.round(warmColor[0] * 255);
    const gw = Math.round(warmColor[1] * 255);
    const bw = Math.round(warmColor[2] * 255);

    const root = document.documentElement.style;
    root.setProperty('--accent', `rgb(${r1},${g1},${b1})`);
    root.setProperty('--accent-rgb', `${r1},${g1},${b1}`);
    root.setProperty('--accent2', `rgb(${r2},${g2},${b2})`);
    root.setProperty('--accent2-rgb', `${r2},${g2},${b2}`);
    root.setProperty('--warm', `rgb(${rw},${gw},${bw})`);
    root.setProperty('--warm-rgb', `${rw},${gw},${bw}`);
  }

  function dialInText(element, targetText, callback) {
    if (!element) return;
    if (element._dialInterval) clearInterval(element._dialInterval);
    let iteration = 0;
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-·_';
    element._dialInterval = setInterval(() => {
      element.innerHTML = targetText
        .split('')
        .map((char, index) => {
          if (char === ' ') return ' ';
          if (index < iteration) {
            return targetText[index];
          }
          return chars[Math.floor(Math.random() * chars.length)];
        })
        .join('');
      
      if (iteration >= targetText.length) {
        clearInterval(element._dialInterval);
        element._dialInterval = null;
        if (callback) callback();
      }
      iteration += 1.5;
    }, 16);
  }

  /* ---------------- screens & menus ---------------- */
  function showScreen(name) {
    for (const id of ['menu', 'loading', 'finish', 'gameHud', 'campaign', 'settings', 'garage', 'replayHud']) {
      const el = $(id === 'gameHud' ? 'gameHud' : id);
      if (el) el.style.display = 'none';
    }
    if (name === 'menu') {
      applyCssTheme(DEFAULT_THEME);
      $('menu').style.display = 'flex';
      DD.trackCache = {}; // clear track cache when entering main menu
    }
    if (name === 'loading') $('loading').style.display = 'flex';
    if (name === 'finish') { $('finish').style.display = 'flex'; $('gameHud').style.display = 'block'; }
    if (name === 'game') $('gameHud').style.display = 'block';
    if (name === 'replay') {
      const el = $('replayHud');
      if (el) el.style.display = 'flex';
    }
    if (name === 'campaign') $('campaign').style.display = 'flex';
    if (name === 'settings') $('settings').style.display = 'flex';
    if (name === 'garage') $('garage').style.display = 'flex';
    const touchUI = (name === 'game' || name === 'finish');
    const touchControlsOn = touchUI && isTouch();
    $('touchControls').style.display = touchControlsOn ? 'block' : 'none';
    // When the touch pads are up, the GAS pad sits in the bottom-right corner where
    // the speed HUD lives — flag the body so CSS can move the HUD clear (bottom-center).
    document.body.classList.toggle('touch-controls-on', touchControlsOn);
    $('gameButtons').style.display = touchUI ? 'flex' : 'none';
    // Disable the animated film grain during active racing — its per-step transform over the live
    // canvas forces a full-screen recomposite each frame (mobile perf). Keep it on the lighter
    // menu/garage/finish showcase screens.
    const grain = $('grain');
    if (grain) grain.style.display = (name === 'game') ? 'none' : 'block';
  }
  function isTouch() { return 'ontouchstart' in window; }

  let selectedCampTrack = null;
  function drawTrackMiniMap(track, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    track.samples.forEach(s => {
      const x = s.p[0], z = s.p[2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    });

    const w = maxX - minX;
    const h = maxZ - minZ;
    const pad = 24;
    const maxDim = Math.max(w, h) || 1;
    const scale = (canvas.width - pad * 2) / maxDim;

    const cx = (canvas.width - w * scale) / 2;
    const cz = (canvas.height - h * scale) / 2;

    const project = (x, z) => [
      cx + (x - minX) * scale,
      cz + (z - minZ) * scale
    ];

    const c = track.theme.accent || [0.6, 0.5, 1.0];
    const cRGB = 'rgb(' + c.map(x => Math.round(x * 255)).join(',') + ')';
    const cRGBGlow = 'rgba(' + c.map(x => Math.round(x * 255)).join(',') + ', 0.25)';

    ctx.beginPath();
    track.samples.forEach((s, idx) => {
      const [px, py] = project(s.p[0], s.p[2]);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();

    ctx.strokeStyle = cRGBGlow;
    ctx.lineWidth = 9;
    ctx.stroke();

    ctx.strokeStyle = cRGB;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    const startS = track.samples[track.startIdx];
    const [sx, sz] = project(startS.p[0], startS.p[2]);
    ctx.beginPath();
    ctx.arc(sx, sz, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff7b55';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    track.checkpoints.forEach(ckptIdx => {
      const s = track.samples[ckptIdx];
      const [cx, cz] = project(s.p[0], s.p[2]);
      ctx.beginPath();
      ctx.arc(cx, cz, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return 'NEVER';
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'JUST NOW';
    if (mins < 60) return mins + 'M AGO';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'H AGO';
    return new Date(timestamp).toLocaleDateString();
  }

  function selectCampaignTrack(seed, tier, btn) {
    document.querySelectorAll('.trackBtn').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');

    selectedCampTrack = { seed, tier };
    const cacheKey = seed + '|' + tier;
    let track = DD.trackCache[cacheKey];
    if (!track) {
      track = DD.buildValidTrack(seed, tier);
      DD.trackCache[cacheKey] = track;
    }
    applyCssTheme(track.theme);

    dialInText($('campTrackName'), 'TRACK ' + seed.split('-').pop());
    dialInText($('campTrackInfo'), track.archetype.toUpperCase() + '  ·  ' + Math.round(track.length) + 'M');
    dialInText($('campTrackTheme'), track.theme.biome.toUpperCase() + '  ·  ' + track.theme.weather.toUpperCase() + (track.theme.emotion ? '  ·  ' + track.theme.emotion.toUpperCase() + ' (' + track.theme.timeOfDream.toUpperCase() + ')' : ''));

    dialInText($('campTimeAuthor'), DD.formatTime(track.medals.author));
    dialInText($('campTimeGold'), DD.formatTime(track.medals.gold));
    dialInText($('campTimeSilver'), DD.formatTime(track.medals.silver));
    dialInText($('campTimeBronze'), DD.formatTime(track.medals.bronze));

    const key = seedKey(seed, tier);
    const rec = G.save.tracks[key];
    const pbBox = $('campTrackPB');
    if (rec && rec.pb) {
      pbBox.innerHTML = 'PERSONAL BEST: <span class="pb-val" id="campTrackPBVal">' + DD.formatTime(rec.pb) + '</span>';
      pbBox.style.display = 'block';
      dialInText($('campTrackPBVal'), DD.formatTime(rec.pb));
    } else {
      pbBox.style.display = 'none';
    }

    const statsBox = $('campTrackStats');
    if (statsBox) {
      if (rec && rec.attempts) {
        statsBox.style.display = 'flex';
        dialInText($('campAttemptsVal'), String(rec.attempts));
        const agoText = formatTimeAgo(rec.lastPlayed);
        dialInText($('campLastPlayedVal'), 'LAST PLAYED: ' + agoText);
      } else {
        statsBox.style.display = 'none';
      }
    }

    const canvas = $('campMapCanvas');
    if (canvas) {
      drawTrackMiniMap(track, canvas);
    }

    $('campDetailsPlaceholder').style.display = 'none';
    $('campDetailsContent').style.display = 'flex';
  }

  function buildCampaignMenu() {
    const wrap = $('campList');
    wrap.innerHTML = '';

    // Calculate total campaign medals
    let totalMedals = 0;
    for (let t = 1; t <= 5; t++) {
      totalMedals += tierMedalCount(t);
    }
    const totalMedalsVal = $('campaign-total-medals-val');
    if (totalMedalsVal) {
      totalMedalsVal.textContent = totalMedals + ' / 50';
    }

    // Find last played track key
    let lastPlayedKey = null;
    let maxLastPlayed = 0;
    for (const k of Object.keys(G.save.tracks)) {
      const r = G.save.tracks[k];
      if (r && r.lastPlayed && r.lastPlayed > maxLastPlayed) {
        maxLastPlayed = r.lastPlayed;
        lastPlayedKey = k;
      }
    }

    // Determine target selection candidate
    let targetSeed = selectedCampTrack ? selectedCampTrack.seed : null;
    let targetTier = selectedCampTrack ? selectedCampTrack.tier : null;

    if (!targetSeed) {
      // Find first unlocked track without an author medal
      for (let t = 1; t <= 5; t++) {
        if (!tierUnlocked(t)) continue;
        const list = CAMPAIGN[t - 1];
        for (let i = 0; i < list.length; i++) {
          const seed = list[i];
          const rec = G.save.tracks[seedKey(seed, t)];
          if (!rec || rec.medal !== 'author') {
            targetSeed = seed;
            targetTier = t;
            break;
          }
        }
        if (targetSeed) break;
      }
    }

    let fallbackBtn = null;
    let fallbackSeed = null;
    let fallbackTier = null;
    let selectedBtn = null;

    for (let t = 1; t <= 5; t++) {
      const unlocked = tierUnlocked(t);
      
      // Celebrate newly unlocked tier if it changed state
      let celebrateUnlock = false;
      if (unlocked && G.unlockedTiersBefore && !G.unlockedTiersBefore.includes(t)) {
        celebrateUnlock = true;
      }

      const tierCard = document.createElement('div');
      tierCard.className = 'tier-card' + (unlocked ? '' : ' locked') + (celebrateUnlock ? ' tier-unlock-flash' : '');

      // 1. Tier Header
      const tierHeader = document.createElement('div');
      tierHeader.className = 'tier-header';

      // Check for full clear in tier t
      let allAuthor = unlocked;
      if (unlocked) {
        for (const seed of CAMPAIGN[t - 1]) {
          const rec = G.save.tracks[seedKey(seed, t)];
          if (!rec || rec.medal !== 'author') {
            allAuthor = false;
            break;
          }
        }
      }

      const tierTitle = document.createElement('span');
      tierTitle.className = 'tier-title';
      tierTitle.innerHTML = 'TIER ' + t + (!unlocked ? ' <span class="lock-icon">🔒</span>' : '');
      
      if (allAuthor) {
        const clearBadge = document.createElement('span');
        clearBadge.className = 'tier-author-badge';
        clearBadge.textContent = '◆ FULL CLEAR';
        tierTitle.appendChild(clearBadge);
      }
      
      tierHeader.appendChild(tierTitle);

      const mCount = tierMedalCount(t);
      const tierComp = document.createElement('span');
      tierComp.className = 'tier-completion';
      tierComp.textContent = mCount + ' / 10 MEDALS';
      tierHeader.appendChild(tierComp);

      tierCard.appendChild(tierHeader);

      // 2. Progress / Lock hint
      const barContainer = document.createElement('div');
      barContainer.className = 'tier-progress-container';

      if (unlocked) {
        const progressBar = document.createElement('div');
        progressBar.className = 'tier-progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'tier-progress-fill';
        progressFill.style.width = (mCount * 10) + '%';
        progressBar.appendChild(progressFill);
        barContainer.appendChild(progressBar);
      } else {
        const lockHint = document.createElement('div');
        lockHint.className = 'tier-lock-hint';
        const prevTierMedals = tierMedalCount(t - 1);
        const needed = 5 - prevTierMedals;
        lockHint.textContent = needed + ' more medal' + (needed > 1 ? 's' : '') + ' in Tier ' + (t - 1) + ' to unlock';
        barContainer.appendChild(lockHint);
      }
      tierCard.appendChild(barContainer);

      // 3. Track list grid (only if unlocked)
      if (unlocked) {
        const row = document.createElement('div');
        row.className = 'tierRow';
        CAMPAIGN[t - 1].forEach((seed, i) => {
          const rec = G.save.tracks[seedKey(seed, t)];
          const key = seedKey(seed, t);
          const isLastPlayed = key === lastPlayedKey;

          const b = document.createElement('button');
          b.className = 'trackBtn md ' + (rec && rec.medal ? rec.medal : 'none') + (isLastPlayed ? ' last-played' : '');
          b.innerHTML = '<span class="num">' + (i + 1) + '</span><span class="ico">' + MEDAL_ICON[rec && rec.medal ? rec.medal : 'none'] + '</span>' +
            (rec && rec.pb ? '<span class="pb">' + DD.formatTime(rec.pb) + '</span>' : '<span class="pb">—</span>');
          b.onclick = () => { DD.sfxClick(); selectCampaignTrack(seed, t, b); };
          row.appendChild(b);

          if (!fallbackBtn) {
            fallbackBtn = b;
            fallbackSeed = seed;
            fallbackTier = t;
          }
          if (seed === targetSeed && t === targetTier) {
            selectedBtn = b;
          }
        });
        tierCard.appendChild(row);
      }

      wrap.appendChild(tierCard);
    }

    // Reset unlock celebration flag so it runs once
    G.unlockedTiersBefore = null;

    if (selectedBtn && targetSeed && targetTier) {
      selectCampaignTrack(targetSeed, targetTier, selectedBtn);
    } else if (fallbackBtn && fallbackSeed && fallbackTier) {
      selectCampaignTrack(fallbackSeed, fallbackTier, fallbackBtn);
    }
  }

  // shared with the ring-drag handler (P2 slice A) — not local to buildGarageMenu, since dragging
  // happens from the pointermove listener bound once in DD.boot, not from a menu rebuild.
  function updateEditHandles() {
    if (G.editHandles) { DD.disposeGroup(G.carMesh, G.editHandles); G.editHandles = null; }
    if (G.workingSpec && (G.editMode === 'length' || G.editMode === 'move' || G.editMode === 'cross') && G.carMesh) {
      G.editHandles = DD.buildEditHandles(G.workingSpec);
      G.carMesh.add(G.editHandles);
    }
  }
  function updateShowcaseCar() {
    if (G.carMesh) DD.disposeGroup(G.scene, G.carMesh);
    const spec = G.workingSpec || DD.resolveSpec(G.save.garage, G.save.customDesigns);
    const env = (G.state === 'garage' && G.garageEnvMap) ? G.garageEnvMap : G.scene.environment;
    G.carMesh = DD.buildCarFromSpec(spec, { ghost: false, envMap: env, garage: G.save.garage });
    G.scene.add(G.carMesh);
    updateEditHandles();
  }

  function buildGarageMenu() {
    const g = G.save.garage, GA = DD.GARAGE;
    G.editMode = G.editMode || 'orbit';
    const mk = (containerId, items, sel, render, set) => {
      const c = $(containerId); c.innerHTML = '';
      items.forEach((item, i) => {
        const b = document.createElement('button');
        b.className = 'gItem' + (i === sel ? ' sel' : '');
        b.innerHTML = render(item);
        b.onclick = () => { set(i); DD.persistSave(G.save); buildGarageMenu(); updateShowcaseCar(); DD.sfxClick(); };
        c.appendChild(b);
      });
    };
    mk('gGrads', GA.gradients, g.grad, (it) => {
      const c1 = 'rgb(' + it.a.map(x => Math.round(x * 255)).join(',') + ')';
      const c2 = 'rgb(' + it.b.map(x => Math.round(x * 255)).join(',') + ')';
      return '<span class="sw" style="background:linear-gradient(135deg,' + c1 + ',' + c2 + ')"></span>' + it.name;
    }, (i) => g.grad = i);
    mk('gFinish', GA.finishes, g.finish, (it) => it, (i) => g.finish = i);
    mk('gForms', GA.forms, g.form, (it) => it, (i) => {
      g.form = i;
      g.activeCustom = null;
      G.workingSpec = null;
      G._editingDesignId = null;
      if (G._handlesGroup) { G.scene.remove(G._handlesGroup); G._handlesGroup = null; }
    });

    // Tab switching wiring with 6 tabs and auto-forking on customization tabs
    $('tabBtnPaint').onclick = () => showTab('Paint');
    $('tabBtnFinish').onclick = () => showTab('Finish');
    $('tabBtnForm').onclick = () => showTab('Form');
    $('tabBtnBody').onclick = () => showTab('Body');
    $('tabBtnWheels').onclick = () => showTab('Wheels');
    $('tabBtnParts').onclick = () => showTab('Parts');

    function autoFork() {
      if (!G.workingSpec) {
        let src;
        if (g.activeCustom) {
          src = (G.save.customDesigns || []).find(d => d.id === g.activeCustom) || DD.CAR_PRESETS[g.form % DD.CAR_PRESETS.length];
        } else {
          src = DD.CAR_PRESETS[g.form % DD.CAR_PRESETS.length];
        }
        G.workingSpec = DD.normalizeSpec(JSON.parse(JSON.stringify(src)));
        G._editingDesignId = g.activeCustom || null;
        G.editMode = 'orbit';
        buildGarageMenu();
        updateShowcaseCar();
      }
    }

    function showTab(name) {
      if (['Body', 'Wheels', 'Parts'].indexOf(name) >= 0 && !G.workingSpec) {
        autoFork();
      }
      ['Paint', 'Finish', 'Form', 'Body', 'Wheels', 'Parts'].forEach(t => {
        const btn = $('tabBtn' + t);
        const panel = $('tab' + t);
        if (btn) btn.classList.toggle('active', t === name);
        if (panel) panel.style.display = t === name ? 'block' : 'none';
      });
    }

    // Keep all tab buttons visible; toggle action panels and edit mode toolbars
    $('editModeBar').style.display = G.workingSpec ? 'flex' : 'none';
    const actPanel = $('garageActionPanel');
    if (actPanel) actPanel.style.display = G.workingSpec ? 'flex' : 'none';

    function currentTab() {
      const tabs = ['Paint','Finish','Form','Body','Wheels','Wings','Parts'];
      for (const t of tabs) {
        const btn = $('tabBtn' + t);
        if (btn && btn.classList.contains('active')) return t;
      }
      return 'Paint';
    }

    // G4 slider builder — binds a numeric knob in G.workingSpec to a range input. No transitions on
    // pseudo-elements (WebView freeze). On `input` it mutates the spec in place (the captured ws/hp/
    // hull/st refs must stay live across drags, so we NEVER reassign G.workingSpec here — normalizeSpec
    // returns a fresh object that would orphan the closures). Slider min/max already enforce schema
    // bounds, so no extra clamp is needed. Renders into containerId, returns nothing.
    if (G.workingSpec) {
      const SC = DD.CAR_SCHEMA;
      const mkSlider = (containerId, label, get, set, lo, hi, step, fmt) => {
        const c = $(containerId);
        const wrap = document.createElement('div'); wrap.className = 'gSlider';
        const cur = get();
        const row = document.createElement('div'); row.className = 'gSlider-row';
        const lab = document.createElement('span'); lab.textContent = label;
        const val = document.createElement('span'); val.className = 'gSlider-val'; val.textContent = fmt ? fmt(cur) : cur.toFixed(2);
        row.appendChild(lab); row.appendChild(val);
        const inp = document.createElement('input'); inp.type = 'range'; inp.min = lo; inp.max = hi; inp.step = step; inp.value = cur;
        inp.oninput = () => {
          const v = parseFloat(inp.value);
          set(v);
          val.textContent = fmt ? fmt(v) : v.toFixed(2);
          updateShowcaseCar();
        };
        wrap.appendChild(row); wrap.appendChild(inp); c.appendChild(wrap);
      };
      // Hull caps (G1) — segmented buttons (enum, not a slider)
      const mkSeg = (containerId, label, opts, get, set) => {
        const c = $(containerId);
        const seg = document.createElement('div'); seg.className = 'gSeg';
        opts.forEach(opt => {
          const b = document.createElement('button'); b.className = 'gSegBtn' + (get() === opt ? ' sel' : ''); b.textContent = opt;
          b.onclick = () => { DD.sfxClick(); set(opt); G.workingSpec = DD.normalizeSpec(G.workingSpec); buildGarageMenu(); updateShowcaseCar(); };
          seg.appendChild(b);
        });
        if (label) {
          const lab = document.createElement('p'); lab.className = 'section-title'; lab.textContent = label; lab.style.marginTop = '0';
          c.appendChild(lab);
        }
        c.appendChild(seg);
      };

      const ws = G.workingSpec;
      const hp = ws.chassis.hardpoints;
      const hull = ws.chassis.hull;

      // Body tab — cap styles + active station picker + station w/h/y sliders + cabin specs
      $('gBody').innerHTML = ''; $('gBodyStations').innerHTML = '';
      $('gCabinStyle').innerHTML = ''; $('gCabinSpecs').innerHTML = '';
      mkSeg('gBody', 'front cap', DD.CAP_STYLES || ['flat','pointed','rounded','hollow'],
        () => hull.capStyleFront || 'flat', (v) => hull.capStyleFront = v);
      mkSeg('gBody', 'rear cap', DD.CAP_STYLES || ['flat','pointed','rounded','hollow'],
        () => hull.capStyleRear || 'flat', (v) => hull.capStyleRear = v);
      
      G.activeStationIndex = (G.activeStationIndex != null) ? G.activeStationIndex : Math.floor(hull.station.length / 2);
      const stations = hull.station.map((_, idx) => idx);
      mkSeg('gBodyStations', 'active station', stations, () => G.activeStationIndex, (v) => { G.activeStationIndex = parseInt(v); buildGarageMenu(); });

      const st = hull.station[G.activeStationIndex] || hull.station[0];
      if (st) {
        mkSlider('gBodyStations', 'station width', () => st[1], (v) => st[1] = v, SC.stW[0], SC.stW[1], 0.01);
        mkSlider('gBodyStations', 'station height', () => st[2], (v) => st[2] = v, SC.stH[0], SC.stH[1], 0.01);
        mkSlider('gBodyStations', 'station rise', () => st[3], (v) => st[3] = v, SC.stY[0], SC.stY[1], 0.01);
      }

      ws.canopy = ws.canopy || { kind: 'bubble', scale: [0.22, 0.13, 0.55], z: 0.25, y: 0.46 };
      const canopy = ws.canopy;
      mkSeg('gCabinStyle', 'style', ['bubble', 'open', 'recessed', 'speedster'], () => canopy.kind || 'bubble', (v) => canopy.kind = v);
      mkSlider('gCabinSpecs', 'cabin width', () => canopy.scale[0], (v) => canopy.scale[0] = v, 0.1, 0.45, 0.01);
      mkSlider('gCabinSpecs', 'cabin height', () => canopy.scale[1], (v) => canopy.scale[1] = v, 0.05, 0.35, 0.01);
      mkSlider('gCabinSpecs', 'cabin length', () => canopy.scale[2], (v) => canopy.scale[2] = v, 0.1, 1.2, 0.01);
      mkSlider('gCabinSpecs', 'cabin rise (y)', () => canopy.y, (v) => canopy.y = v, 0.2, 0.9, 0.01);
      mkSlider('gCabinSpecs', 'cabin position (z)', () => canopy.z, (v) => canopy.z = v, -0.5, 1.0, 0.01);

      // Wheels tab — wheel size/width/rim/roundness/spokes + track widths
      $('gWheels').innerHTML = '';
      mkSlider('gWheels', 'front radius', () => hp.frontR, (v) => hp.frontR = v, SC.frontR[0], SC.frontR[1], 0.01);
      mkSlider('gWheels', 'rear radius', () => hp.rearR, (v) => hp.rearR = v, SC.rearR[0], SC.rearR[1], 0.01);
      mkSlider('gWheels', 'tyre width', () => hp.tyreW, (v) => hp.tyreW = v, SC.tyreW[0], SC.tyreW[1], 0.01);
      mkSlider('gWheels', 'track width front', () => hp.trackF, (v) => hp.trackF = v, SC.trackF[0], SC.trackF[1], 0.01);
      mkSlider('gWheels', 'track width rear', () => hp.trackR, (v) => hp.trackR = v, SC.trackR[0], SC.trackR[1], 0.01);
      mkSlider('gWheels', 'rim size %', () => hp.rimRadiusPct, (v) => hp.rimRadiusPct = v, SC.rimRadiusPct[0], SC.rimRadiusPct[1], 0.01,
        (v) => Math.round(v * 100) + '%');
      mkSlider('gWheels', 'tyre roundness', () => hp.tyreRoundness, (v) => hp.tyreRoundness = v, SC.tyreRoundness[0], SC.tyreRoundness[1], 0.01);
      mkSlider('gWheels', 'spoke count', () => hp.spokeCount || 5, (v) => hp.spokeCount = Math.round(v), 3, 8, 1, (v) => Math.round(v));
      
      // New suspension controls
      mkSlider('gWheels', 'suspension height', () => hp.suspensionY || 0, (v) => hp.suspensionY = v, SC.suspensionY[0], SC.suspensionY[1], 0.01);
      mkSlider('gWheels', 'suspension splay', () => hp.suspensionZ != null ? hp.suspensionZ : 0.18, (v) => hp.suspensionZ = v, SC.suspensionZ[0], SC.suspensionZ[1], 0.01);
      
      // Hollow hub control
      mkSeg('gWheels', 'center hub', ['solid', 'hollow'],
        () => (hp.hollowHub || 0) > 0.5 ? 'hollow' : 'solid',
        (v) => hp.hollowHub = (v === 'hollow' ? 1 : 0));

      // Independent rim paint and finish
      const gradNames = GA.gradients.map(it => it.name);
      mkSeg('gWheels', 'rim paint', gradNames,
        () => GA.gradients[(g.rimGrad != null ? g.rimGrad : 1) % GA.gradients.length].name,
        (v) => {
          const idx = GA.gradients.findIndex(it => it.name === v);
          g.rimGrad = idx >= 0 ? idx : 1;
          ws.gallery.rimGrad = g.rimGrad;
        });

      mkSeg('gWheels', 'rim finish', GA.finishes,
        () => GA.finishes[(g.rimFinish != null ? g.rimFinish : 1) % GA.finishes.length],
        (v) => {
          const idx = GA.finishes.indexOf(v);
          g.rimFinish = idx >= 0 ? idx : 1;
          ws.gallery.rimFinish = g.rimFinish;
        });

      // Wheel style segmented buttons (enum)
      $('gWheelStyles').innerHTML = '';
      const wStyles = DD.CAR_WHEEL_STYLES || ['multiSpoke','turbofan','glowDisc','classicSpoke','meshBBS','starFive','deepDish6'];
      mkSeg('gWheelStyles', 'style', wStyles, () => ws.wheelStyle, (v) => ws.wheelStyle = v);
    }
    // T5: custom-designs list in the chassis tab. Lets the player create/select/rename/delete named
    // designs persisted to localStorage (save.customDesigns[]). "customize" now forks from the active
    // custom design if one is selected, otherwise from the locked preset — and "save" writes back.
    const renderDesigns = () => {
      const c = $('gDesigns'); if (!c) return;
      c.innerHTML = '';
      const cds = G.save.customDesigns || [];
      g.activeCustom = g.activeCustom || null;
      // "+" create button — forks the currently-selected preset (g.form) into a fresh named design
      const create = document.createElement('button'); create.className = 'gItem'; create.style.fontWeight = '600';
      create.innerHTML = '<span style="font-size:18px;color:var(--warm);">+</span> new design from current chassis';
      create.onclick = () => {
        DD.sfxClick();
        const seq = (G.save.meta.customSeq = (G.save.meta.customSeq || 0) + 1);
        const d = DD.createCustomDesign(g.form | 0, seq);
        G.save.customDesigns.push(d);
        g.activeCustom = d.id;
        DD.persistSave(G.save);
        buildGarageMenu(); updateShowcaseCar();
      };
      c.appendChild(create);
      // list each saved design — select / edit / rename / delete
      cds.forEach((d, i) => {
        const row = document.createElement('div'); row.className = 'gItem' + (g.activeCustom === d.id ? ' sel' : '');
        row.style.flexDirection = 'column'; row.style.alignItems = 'stretch'; row.style.gap = '6px';
        const top = document.createElement('div'); top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;';
        const nm = document.createElement('span'); nm.textContent = d.name; nm.style.fontWeight = '600';
        const acts = document.createElement('div'); acts.style.cssText = 'display:flex;gap:4px;';
        const mkAct = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.className = 'gSegBtn'; b.style.flex = '0 0 auto'; b.onclick = (e) => { e.stopPropagation(); DD.sfxClick(); fn(); }; acts.appendChild(b); return b; };
        mkAct('select', () => {
          g.activeCustom = (g.activeCustom === d.id) ? null : d.id;
          G.workingSpec = null;
          G._editingDesignId = null;
          if (G._handlesGroup) { G.scene.remove(G._handlesGroup); G._handlesGroup = null; }
          DD.persistSave(G.save);
          buildGarageMenu();
          updateShowcaseCar();
        });
        mkAct('edit', () => {
          // fork the saved design into the working spec for live editing
          G.workingSpec = DD.normalizeSpec(JSON.parse(JSON.stringify(d)));
          G._editingDesignId = d.id; G.editMode = 'orbit';
          buildGarageMenu(); updateShowcaseCar();
        });
        mkAct('rename', () => {
          const nv = prompt('Rename design:', d.name);
          if (nv != null && nv.trim()) { d.name = nv.trim().slice(0, 40); DD.persistSave(G.save); buildGarageMenu(); }
        });
        mkAct('delete', () => {
          if (!confirm('Delete "' + d.name + '"?')) return;
          G.save.customDesigns.splice(i, 1);
          if (g.activeCustom === d.id) g.activeCustom = null;
          if (G._editingDesignId === d.id) G._editingDesignId = null;
          DD.persistSave(G.save); buildGarageMenu(); updateShowcaseCar();
        });
        top.appendChild(nm); top.appendChild(acts); row.appendChild(top);
        c.appendChild(row);
      });
    };
    renderDesigns();

    // G7 share codes — export the current working spec (or active design) and import a foreign code.
    // Decode runs migrate → normalizeSpec so any imported code is always safe to render.
    const renderShare = () => {
      let bar = $('gShare');
      if (!bar) { bar = document.createElement('div'); bar.id = 'gShare'; bar.className = 'gGroup'; $('gDesigns').parentElement.appendChild(bar); }
      bar.innerHTML = '';
      const exp = document.createElement('button'); exp.className = 'gItem';
      exp.innerHTML = '<span style="color:var(--warm);">↗</span> export share code';
      exp.onclick = () => {
        DD.sfxClick();
        const src = G.workingSpec || (g.activeCustom && (G.save.customDesigns || []).find(d => d.id === g.activeCustom));
        if (!src) { alert('Customize a design first, then export.'); return; }
        const code = DD.encodeShareCode(src);
        prompt('Copy this share code:', code); // prompt() lets the user select-all+copy on mobile + desktop
      };
      const imp = document.createElement('button'); imp.className = 'gItem';
      imp.innerHTML = '<span style="color:var(--warm);">↙</span> import share code';
      imp.onclick = () => {
        DD.sfxClick();
        const code = prompt('Paste a share code:');
        if (!code || !code.trim()) return;
        const spec = DD.decodeShareCode(code);
        if (!spec) { alert('Invalid share code.'); return; }
        const seq = (G.save.meta.customSeq = (G.save.meta.customSeq || 0) + 1);
        const d = DD.createCustomDesign(spec, seq, 'Imported ' + seq);
        G.save.customDesigns.push(d);
        g.activeCustom = d.id;
        DD.persistSave(G.save);
        buildGarageMenu(); updateShowcaseCar();
      };
      bar.appendChild(exp); bar.appendChild(imp);
    };
    renderShare();
    const renderParts = () => {
      const c = $('gParts'); if (!c) return;
      c.innerHTML = '';
      if (!G.workingSpec) {
        c.innerHTML = '<p class="section-title" style="text-align:center;padding:12px;opacity:0.5;">select another tab to auto-customize</p>';
        return;
      }
      const ws = G.workingSpec;
      ws.mounts = ws.mounts || [];
      G.selectedPartName = G.selectedPartName || 'frontWing';
      
      DD.CAR_PART_NAMES.forEach(partName => {
        const row = document.createElement('div');
        row.className = 'gItem' + (G.selectedPartName === partName ? ' sel' : '');
        row.style.justifyContent = 'space-between';
        
        const label = document.createElement('span');
        label.textContent = partName.replace(/([A-Z])/g, ' $1').toLowerCase();
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        const mountedIdx = ws.mounts.findIndex(m => m && m.part === partName);
        chk.checked = mountedIdx >= 0;
        chk.style.cursor = 'pointer';
        chk.style.accentColor = 'var(--warm)';
        
        const togglePart = () => {
          DD.sfxClick();
          if (chk.checked) {
            if (ws.mounts.length >= 16) {
              chk.checked = false;
              return;
            }
            if (ws.mounts.findIndex(m => m && m.part === partName) < 0) {
              ws.mounts.push({ part: partName, knobs: {} });
            }
            G.selectedPartName = partName;
          } else {
            const idx = ws.mounts.findIndex(m => m && m.part === partName);
            if (idx >= 0) ws.mounts.splice(idx, 1);
          }
          G.workingSpec = DD.normalizeSpec(ws);
          buildGarageMenu();
          updateShowcaseCar();
        };
        
        row.onclick = () => {
          G.selectedPartName = partName;
          buildGarageMenu();
        };
        chk.onclick = (e) => {
          e.stopPropagation();
          togglePart();
        };
        
        row.appendChild(label);
        row.appendChild(chk);
        c.appendChild(row);
      });

      // Show sliders underneath the list for the selected part (if mounted)
      const mount = ws.mounts.find(m => m && m.part === G.selectedPartName);
      if (mount) {
        mount.knobs = mount.knobs || {};
        const k = mount.knobs;
        const slidersDiv = document.createElement('div');
        slidersDiv.style.cssText = 'margin-top: 12px; padding: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.25);';
        
        const title = document.createElement('p');
        title.className = 'section-title';
        title.textContent = G.selectedPartName.replace(/([A-Z])/g, ' $1').toLowerCase() + ' settings';
        title.style.marginTop = '0';
        slidersDiv.appendChild(title);
        
        const addKnobSlider = (label, key, lo, hi, step, dflt) => {
          const wrap = document.createElement('div'); wrap.className = 'gSlider';
          const cur = k[key] != null ? k[key] : dflt;
          const row = document.createElement('div'); row.className = 'gSlider-row';
          const lab = document.createElement('span'); lab.textContent = label;
          const val = document.createElement('span'); val.className = 'gSlider-val'; val.textContent = cur.toFixed(2);
          row.appendChild(lab); row.appendChild(val);
          const inp = document.createElement('input'); inp.type = 'range'; inp.min = lo; inp.max = hi; inp.step = step; inp.value = cur;
          inp.oninput = () => {
            const v = parseFloat(inp.value);
            k[key] = v;
            val.textContent = v.toFixed(2);
            updateShowcaseCar();
          };
          wrap.appendChild(row); wrap.appendChild(inp); slidersDiv.appendChild(wrap);
        };
        
        if (['frontWing', 'rearWingBiplane', 'rearSpoilerLow'].indexOf(G.selectedPartName) >= 0) {
          addKnobSlider('angle', 'angle', -0.6, 0.6, 0.01, G.selectedPartName === 'frontWing' ? 0.10 : -0.12);
          addKnobSlider('scale', 'scale', 0.5, 2.0, 0.01, 1.0);
          addKnobSlider('width', 'width', 0.5, 1.5, 0.01, 1.0);
        } else if (G.selectedPartName === 'hoverFins') {
          addKnobSlider('angle', 'angle', -0.6, 0.6, 0.01, -0.15);
          addKnobSlider('scale', 'scale', 0.5, 2.0, 0.01, 1.0);
        } else if (G.selectedPartName === 'lightBar') {
          addKnobSlider('pos x', 'x', 0.4, 1.2, 0.01, 0.70);
          addKnobSlider('pos y', 'y', 0.1, 1.0, 0.01, 0.28);
          addKnobSlider('pos z', 'z', -1.5, 1.5, 0.01, -0.4);
          addKnobSlider('length', 'len', 0.2, 2.5, 0.01, 1.3);
        } else {
          addKnobSlider('scale', 'scale', 0.5, 2.0, 0.01, 1.0);
          const dfltZ = G.selectedPartName === 'splitter' || G.selectedPartName === 'splitterGlow' ? 2.5 :
                        G.selectedPartName === 'sharkFin' ? -0.6 :
                        G.selectedPartName === 'diffuser' || G.selectedPartName === 'glowCore' ? -2.0 :
                        G.selectedPartName === 'exhausts' ? -0.9 :
                        G.selectedPartName === 'exposedEngine' ? -0.55 :
                        G.selectedPartName === 'ducktail' ? -1.7 : 0.0;
          if (['splitter', 'splitterGlow', 'sharkFin', 'diffuser', 'exhausts', 'exposedEngine', 'glowCore', 'ducktail'].indexOf(G.selectedPartName) >= 0) {
            addKnobSlider('pos z', 'z', dfltZ - 1.0, dfltZ + 1.0, 0.01, dfltZ);
          }
        }
        c.appendChild(slidersDiv);
      }
    };
    renderParts();

    // Wire up Save and Discard buttons in bottom action panel
    const editId = G._editingDesignId;
    const container = $('saveBtnContainer');
    if (container) {
      container.innerHTML = '';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'backBtn';
      saveBtn.style.cssText = 'flex: 1; margin: 0; padding: 10px; font-size: 11px;';
      
      if (G.workingSpec && editId) {
        saveBtn.textContent = 'save design';
        saveBtn.onclick = () => {
          DD.sfxClick();
          const idx = (G.save.customDesigns || []).findIndex(d => d.id === editId);
          if (idx >= 0) {
            const saved = G.save.customDesigns[idx];
            saved.chassis = G.workingSpec.chassis; saved.canopy = G.workingSpec.canopy;
            saved.mounts = G.workingSpec.mounts; saved.wheelStyle = G.workingSpec.wheelStyle;
            saved.palette = G.workingSpec.palette; saved.gallery = G.workingSpec.gallery;
            DD.normalizeSpec(saved);
            DD.persistSave(G.save);
          }
          G.workingSpec = null; G._editingDesignId = null; G.editMode = 'orbit';
          buildGarageMenu(); updateShowcaseCar();
        };
        container.appendChild(saveBtn);
        
        const saveAsBtn = document.createElement('button');
        saveAsBtn.className = 'backBtn';
        saveAsBtn.style.cssText = 'flex: 1; margin: 0; padding: 10px; font-size: 11px;';
        saveAsBtn.textContent = 'save as new';
        saveAsBtn.onclick = () => {
          DD.sfxClick();
          const seq = (G.save.meta.customSeq = (G.save.meta.customSeq || 0) + 1);
          const d = DD.createCustomDesign(G.workingSpec, seq);
          G.save.customDesigns.push(d);
          g.activeCustom = d.id;
          DD.persistSave(G.save);
          G.workingSpec = null; G._editingDesignId = null; G.editMode = 'orbit';
          buildGarageMenu(); updateShowcaseCar();
        };
        container.appendChild(saveAsBtn);
      } else if (G.workingSpec) {
        saveBtn.textContent = 'save design';
        saveBtn.onclick = () => {
          DD.sfxClick();
          const seq = (G.save.meta.customSeq = (G.save.meta.customSeq || 0) + 1);
          const d = DD.createCustomDesign(G.workingSpec, seq);
          G.save.customDesigns.push(d);
          g.activeCustom = d.id;
          DD.persistSave(G.save);
          G.workingSpec = null; G._editingDesignId = null; G.editMode = 'orbit';
          buildGarageMenu(); updateShowcaseCar();
        };
        container.appendChild(saveBtn);
      }
    }

    const discardBtn = $('btnDiscard');
    if (discardBtn) {
      discardBtn.onclick = () => {
        DD.sfxClick();
        G.workingSpec = null; G._editingDesignId = null; G.editMode = 'orbit';
        buildGarageMenu(); updateShowcaseCar();
      };
    }
    
    // Set customize button click for hidden compat
    $('btnCustomize').onclick = () => {
      autoFork();
    };
    ['orbit', 'length', 'move', 'cross'].forEach((mode) => {
      const b = $('editMode_' + mode);
      if (!b) return;
      b.classList.toggle('sel', G.editMode === mode);
      b.disabled = false; // T12: cross-section now live (was disabled "coming soon")
      b.removeAttribute('disabled');
      b.onclick = () => {
        DD.sfxClick();
        G.editMode = mode;
        // entering cross mode: exit any active cross-session so a fresh one starts on next ring pick
        if (mode !== 'cross' && G.crossSession) G.crossSession = null;
        buildGarageMenu(); updateEditHandles();
      };
    });
  }

  function buildSettingsMenu() {
    const s = G.save.settings;
    $('setTilt').checked = s.controlMode === 'tilt';
    $('setSens').value = s.tiltSens;
    $('setInvert').checked = !!s.invertTilt;
    $('setEngine').value = s.engine;
    $('setSfx').value = s.sfx;
    $('setMusic').value = s.music;
    $('setQuality').value = s.quality;
    $('setGlow').value = s.glow || 'standard';
    $('setCamera').value = s.camera || 'close';
    $('setGhost').value = s.ghost || 'pb';
    $('setCrt').checked = !!s.crt;
  }

  /* ---------------- boot ---------------- */
  DD.boot = function () {
    cachedHudWarn = $('hudWarn');
    cachedHudSpeed = $('hudSpeed');
    cachedHudGear = $('hudGear');
    cachedHudSpeedBox = $('hudSpeedBox');
    cachedRpmFill = document.querySelector('#hudRpmArc .rpm-fill');
    cachedHudDelta = $('hudDelta');
    cachedHudLeftBox = $('hudLeftBox');
    cachedHudMedals = $('hudMedals');

    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    DD.testMode = params.get('testMode') === 'true';
    DD.seed = params.get('seed');
    DD.tier = params.get('tier') ? parseInt(params.get('tier'), 10) : null;
    DD.autodrive = params.get('autodrive') === 'true';
    DD.duration = params.get('duration') ? parseFloat(params.get('duration')) : null;
    DD.mockKeys = params.get('mockKeys');

    G.save = DD.loadSave();
    if (G.save.settings.crt === undefined) G.save.settings.crt = false;
    document.body.classList.toggle('no-crt', !G.save.settings.crt);
    if (DD.testMode) {
      G.save.settings.controlMode = 'keys';
      G.save.settings.quality = 'low';
      DD._G = G; // test-only introspection hook (e2e / preview verification); never set outside testMode
    }
    DD.cameraProfile = G.save.settings.camera || 'close'; // saved framing profile (see DD.CAM_PROFILES)
    const canvas = $('gl');
    G.renderer = DD.createRenderer(canvas, G.save.settings.quality);
    // Adaptive-DPR ceiling = the quality-capped ratio createRenderer chose. updateAdaptiveDPR scales
    // between 1.0 and this to hold 60fps. Off at low quality (no composer / already minimal).
    G._dprCap = G.renderer.getPixelRatio();
    // Adaptive DPR OFF by default — a fixed cap (createRenderer) holds 60 without the render-target
    // realloc hitches dynamic resolution caused. Still available: set DD.adaptiveDPR=true to re-enable.
    if (DD.adaptiveDPR === undefined) DD.adaptiveDPR = false;
    if (DD.speedBlurMax === undefined) DD.speedBlurMax = 0.03; // peak radial speed-blur; tune live from console
    G.scene = new THREE.Scene();
    G.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 6000);
    G.composer = DD.createComposer(G.renderer, G.scene, G.camera, G.save.settings.quality);
    DD.initInput(G.save.settings);
    DD.bindCanvasGestures(canvas);

    window.addEventListener('resize', () => {
      G.renderer.setSize(window.innerWidth, window.innerHeight);
      if (G.composer) {
        G.composer.setSize(window.innerWidth, window.innerHeight);
        // composer.setSize resets every pass to full res; re-apply half-res bloom (see createComposer)
        if (G.composer._bloom && G.composer._bloomScale) {
          G.composer._bloom.setSize(
            Math.round(window.innerWidth * G.composer._bloomScale),
            Math.round(window.innerHeight * G.composer._bloomScale));
        }
        // keep FXAA's texel size in sync with the drawing-buffer (size * pixelRatio)
        if (G.composer._fxaa) {
          const dpr = G.renderer.getPixelRatio();
          G.composer._fxaa.material.uniforms['resolution'].value.set(1 / (window.innerWidth * dpr), 1 / (window.innerHeight * dpr));
        }
      }
      G.camera.aspect = window.innerWidth / window.innerHeight;
      G.camera.updateProjectionMatrix();
    });

    // Dev: live-set the device-pixel-ratio to profile fill-rate cost WITHOUT reloading. Try
    // DD.setDPR(1.0) vs DD.setDPR(1.25) vs DD.setDPR(1.5) mid-race and watch GPU ms in the perf HUD;
    // returns the new drawing-buffer dims. Fill scales with pixel count = (dims), so this isolates
    // the single biggest GPU lever on high-DPI screens.
    DD.setDPR = function (x) {
      G.renderer.setPixelRatio(x);
      G.renderer.setSize(window.innerWidth, window.innerHeight);
      if (G.composer) {
        G.composer.setPixelRatio(x);
        G.composer.setSize(window.innerWidth, window.innerHeight);
        if (G.composer._bloom && G.composer._bloomScale) {
          G.composer._bloom.setSize(
            Math.round(window.innerWidth * G.composer._bloomScale),
            Math.round(window.innerHeight * G.composer._bloomScale));
        }
        if (G.composer._fxaa) {
          G.composer._fxaa.material.uniforms['resolution'].value.set(1 / (window.innerWidth * x), 1 / (window.innerHeight * x));
        }
      }
      return { dpr: x, buffer: [G.renderer.domElement.width, G.renderer.domElement.height] };
    };
    // Dev: read the live adaptive-DPR state (call repeatedly mid-race to watch it hold 60).
    DD.dprInfo = function () {
      return { dpr: +G.renderer.getPixelRatio().toFixed(3), cap: G._dprCap, adaptive: DD.adaptiveDPR };
    };

    const audioKick = () => { DD.initAudio(G.save.settings); };
    window.addEventListener('pointerdown', audioKick, { once: true });
    window.addEventListener('keydown', audioKick, { once: true });

    // menu buttons
    $('btnDaily').onclick = async () => { DD.sfxClick(); await ensureTilt(); startTrack(DD.dailySeedString(), 3); };
    $('btnRandom').onclick = async () => {
      DD.sfxClick(); await ensureTilt();
      startTrack(DD.randomSeedString(), parseInt($('randTier').value, 10));
    };
    $('btnCampaign').onclick = () => { DD.sfxClick(); buildCampaignMenu(); showScreen('campaign'); };
    $('btnSeed').onclick = async () => {
      const v = $('seedInput').value.trim();
      if (!v) return;
      DD.sfxClick(); await ensureTilt();
      startTrack(v.toUpperCase(), parseInt($('randTier').value, 10));
    };
    $('btnGarage').onclick = () => {
      DD.sfxClick();
      buildGarageMenu();
      ['Paint', 'Finish', 'Form'].forEach(t => {
        $('tabBtn' + t).classList.toggle('active', t === 'Paint');
        $('tab' + t).style.display = t === 'Paint' ? 'block' : 'none';
      });
      G.state = 'garage';
      showScreen('garage');
    };
    $('btnSettings').onclick = () => { DD.sfxClick(); buildSettingsMenu(); showScreen('settings'); };
    $('btnPlayCampTrack').onclick = () => {
      if (selectedCampTrack) {
        DD.sfxClick();
        startTrack(selectedCampTrack.seed, selectedCampTrack.tier);
      }
    };
    document.querySelectorAll('.backBtn').forEach(b => b.onclick = () => { DD.sfxClick(); G.state = 'menu'; showScreen('menu'); });

    $('dailyLabel').textContent = DD.dailySeedString();

    // finish buttons
    $('finRetry').onclick = () => { DD.sfxClick(); resetRun(true); };
    $('finReplay').onclick = () => { DD.sfxClick(); startReplay(); };
    $('finNext').onclick = () => {
      DD.sfxClick();
      if (G.track.seed.startsWith('CAMP-')) {
        const t = G.track.tier, list = CAMPAIGN[t - 1];
        const i = list.indexOf(G.track.seed);
        if (i >= 0 && i < list.length - 1) { startTrack(list[i + 1], t); return; }
        buildCampaignMenu(); showScreen('campaign'); G.state = 'menu'; return;
      }
      startTrack(DD.randomSeedString(), G.track.tier);
    };
    $('finMenu').onclick = () => { DD.sfxClick(); DD.engineQuiet(); DD.stopPads(); G.state = 'menu'; showScreen('menu'); };
    $('finShare').onclick = () => {
      const text = 'DRIFTDREAM ' + G.track.seed + ' (tier ' + G.track.tier + ') — ' + DD.formatTime(G.car.finalMs);
      if (navigator.share) navigator.share({ text }).catch(() => {});
      else { navigator.clipboard && navigator.clipboard.writeText(text); $('finShare').textContent = 'copied!'; setTimeout(() => $('finShare').textContent = 'share', 1500); }
    };

    // in-game buttons
    $('btnRestart').onclick = () => { DD.input.restartReq = true; };
    $('btnRespawn').onclick = () => { DD.input.respawnReq = true; };
    $('btnExit').onclick = () => { DD.sfxClick(); DD.engineQuiet(); DD.stopPads(); G.state = 'menu'; showScreen('menu'); };

    // replay HUD buttons
    $('repPlayPause').onclick = () => {
      DD.sfxClick();
      G.replayPlaying = !G.replayPlaying;
      $('repPlayPause').textContent = G.replayPlaying ? '⏸' : '▶';
    };
    $('repSlider').oninput = (e) => {
      G.replayPlaying = false;
      const pp = $('repPlayPause');
      if (pp) pp.textContent = '▶';
      G.replayPlayhead = parseFloat(e.target.value);
    };
    $('repRetry').onclick = () => {
      DD.sfxClick();
      DD.engineQuiet();
      showScreen('game');
      resetRun(true);
    };
    $('repExit').onclick = () => {
      DD.sfxClick();
      DD.engineQuiet();
      G.state = 'finish';
      showScreen('finish');
    };

    // settings wiring
    $('setTilt').onchange = (e) => { G.save.settings.controlMode = e.target.checked ? 'tilt' : 'touch'; saveSet(); };
    $('setSens').oninput = (e) => { G.save.settings.tiltSens = parseFloat(e.target.value); saveSet(); };
    $('setInvert').onchange = (e) => { G.save.settings.invertTilt = e.target.checked; saveSet(); };
    $('setEngine').oninput = (e) => { G.save.settings.engine = parseFloat(e.target.value); DD.audio.volumes.engine = G.save.settings.engine; saveSet(); };
    $('setSfx').oninput = (e) => { G.save.settings.sfx = parseFloat(e.target.value); DD.audio.volumes.sfx = G.save.settings.sfx; saveSet(); };
    $('setMusic').oninput = (e) => { G.save.settings.music = parseFloat(e.target.value); DD.audio.volumes.music = G.save.settings.music; if (DD.audio.nodes.padMaster) DD.audio.nodes.padMaster.gain.value = 0.1 * G.save.settings.music; saveSet(); };
    $('setQuality').onchange = (e) => { G.save.settings.quality = e.target.value; saveSet(); };
    $('setGlow').onchange = (e) => { G.save.settings.glow = e.target.value; saveSet(); }; // live — bloom recomposes per frame
    $('setCamera').onchange = (e) => { G.save.settings.camera = e.target.value; DD.cameraProfile = e.target.value; saveSet(); };
    $('setGhost').onchange = (e) => { G.save.settings.ghost = e.target.value; saveSet(); updateActiveGhost(); };
    $('setCrt').onchange = (e) => { G.save.settings.crt = e.target.checked; document.body.classList.toggle('no-crt', !e.target.checked); saveSet(); };
    function saveSet() { DD.persistSave(G.save); }

    // touch controls
    DD.bindTouch({ gas: $('padGas'), brake: $('padBrake'), steerL: $('padL'), steerR: $('padR') });
    updateSteerPadsVisibility();

    // Pointer drag for orbit camera manual rotation in garage, PLUS (P2 slice A) ring-handle
    // picking/dragging in Length-rings edit mode. A hit on a handle starts a handle-drag instead of
    // the orbit-drag; the two are mutually exclusive per gesture. T6 adds a third mode "move" which
    // drags a station's fore-aft (z, horizontal screen delta) and raise-lower (y, vertical delta),
    // plus pinch-zoom for the turntable (two-finger gesture).
    let isDragging = false;
    let prevX = 0;
    let handleDrag = null; // { stationIndex, mode, startX, startY, startZ, startY0, startW, startH }
    const raycaster = new THREE.Raycaster();
    const pickNdc = new THREE.Vector2();
    const R_STW = DD.CAR_SCHEMA.stW, R_STH = DD.CAR_SCHEMA.stH;
    const HANDLE_SENS = 0.003; // screen px -> station w/h/y units
    const Z_SENS = 0.0025;     // screen px -> station z units (z ∈ [-1,1] along the spine)
    // multi-pointer registry for pinch-zoom (mobile + trackpad). keyed by pointerId.
    const pointers = new Map();
    let pinchStartDist = 0, pinchStartZoom = 1;
    function pickHandle(clientX, clientY) {
      if (!G.editHandles) return null;
      const rect = canvas.getBoundingClientRect();
      pickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pickNdc, G.camera);
      const hits = raycaster.intersectObjects(G.editHandles.children);
      return hits.length ? hits[0].object.userData.stationIndex : null;
    }
    // T12 cross-section helpers
    function synthRingPts() {
      // synthesize the default unit-circle outline (K=18) so a fresh override starts from the
      // current global ellipse shape, not from all-zeros
      const out = [];
      for (let i = 0; i < 18; i++) {
        const th = (i / 18) * Math.PI * 2;
        out.push({ x: Math.cos(th), y: Math.sin(th), smooth: true });
      }
      return out;
    }
    function pickCrossPoint(clientX, clientY) {
      // raycast against the cross-handle dots (G.crossHandles) → returns pointIndex
      if (!G.crossHandles) return null;
      const rect = canvas.getBoundingClientRect();
      pickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pickNdc, G.camera);
      const hits = raycaster.intersectObjects(G.crossHandles.children);
      return hits.length ? hits[0].object.userData.pointIndex : null;
    }
    function enterCrossSession(stationIndex, e) {
      DD.sfxClick();
      crossFromPos.copy(G.camera.position);
      G.crossSession = {
        stationIndex: stationIndex,
        tweenStart: performance.now(),
        fromPos: crossFromPos.clone()
      };
      // swap to 18-point cross handles for this station
      if (G.crossHandles) { DD.disposeGroup(G.carMesh, G.crossHandles); G.crossHandles = null; }
      if (G.editHandles) { DD.disposeGroup(G.carMesh, G.editHandles); G.editHandles = null; }
      G.crossHandles = DD.buildCrossHandles(G.workingSpec, stationIndex);
      G.carMesh.add(G.crossHandles);
    }
    function exitCrossSession() {
      DD.sfxClick();
      G.crossSession = null;
      if (G.crossHandles) { DD.disposeGroup(G.carMesh, G.crossHandles); G.crossHandles = null; }
      // restore the per-station ring handles so the player can pick another station
      if (G.workingSpec && G.editMode === 'cross') {
        G.editHandles = DD.buildEditHandles(G.workingSpec);
        G.carMesh.add(G.editHandles);
      }
    }
    const isEditPickMode = () => G.editMode === 'length' || G.editMode === 'move';
    // T12 cross: in cross mode, picking a station ring STARTS a cross-session (camera tween to end-on
    // + swap to 18-point cross handles). Once active, picking a cross point DRAGS it.
    const inCrossSession = () => G.editMode === 'cross' && G.crossSession;
    window.addEventListener('pointerdown', (e) => {
      if (G.state !== 'garage' || e.clientX <= 370) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // pinch-zoom disabled during an active cross-session (camera is locked to end-on)
      if (pointers.size === 2 && !inCrossSession()) {
        const pts = Array.from(pointers.values());
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchStartZoom = G.garageZoom || 1;
        handleDrag = null; isDragging = false;
        return;
      }
      // T12: if a cross-session is active, pick a cross POINT to drag
      if (inCrossSession()) {
        const pi = pickCrossPoint(e.clientX, e.clientY);
        if (pi != null) {
          const hull = G.workingSpec.chassis.hull;
          const ix = G.crossSession.stationIndex;
          if (!hull.rings[ix]) hull.rings[ix] = { pts: synthRingPts(), mirror: true };
          const pt = hull.rings[ix].pts[pi];
          handleDrag = { crossPoint: pi, stationIndex: ix, startX: e.clientX, startY: e.clientY,
                         startPx: pt.x, startPy: pt.y };
        } else {
          // click empty space → exit cross-session
          exitCrossSession();
        }
        return;
      }
      // T12: if in cross mode (no session yet), pick a station ring to START a session
      if (G.editMode === 'cross') {
        const si = pickHandle(e.clientX, e.clientY);
        if (si != null) {
          enterCrossSession(si, e);
          return;
        }
        return; // cross mode: no orbit-drag, no length/move drag — only ring picking
      }
      const si = isEditPickMode() ? pickHandle(e.clientX, e.clientY) : null;
      if (si != null) {
        const st = G.workingSpec.chassis.hull.station[si];
        handleDrag = { stationIndex: si, mode: G.editMode, startX: e.clientX, startY: e.clientY,
                       startZ: st[0], startY0: st[3], startW: st[1], startH: st[2] };
      } else {
        isDragging = true;
        prevX = e.clientX;
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (G.state !== 'garage') return;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // pinch-zoom: adjust garageZoom (consumed by the orbit camera in the loop)
      if (pointers.size === 2 && pinchStartDist > 0) {
        const pts = Array.from(pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        G.garageZoom = Math.max(0.5, Math.min(2.5, pinchStartZoom * (dist / pinchStartDist)));
        return;
      }
      if (handleDrag) {
        if (handleDrag.crossPoint != null) {
          // T12 cross-point drag — screen delta maps to ring pt x/y (normalized [-1,1]). Vertical is
          // inverted (screen down = +y up). Mirror axis X=0: also move the partner point (K - i) % K.
          const hull = G.workingSpec.chassis.hull;
          const ring = hull.rings[handleDrag.stationIndex];
          const pt = ring.pts[handleDrag.crossPoint];
          pt.x = DD.clamp(handleDrag.startPx + (e.clientX - handleDrag.startX) * 0.005, -1.5, 1.5);
          pt.y = DD.clamp(handleDrag.startPy - (e.clientY - handleDrag.startY) * 0.005, -1.5, 1.5);
          if (ring.mirror !== false) {
            const mi = (18 - handleDrag.crossPoint) % 18;
            ring.pts[mi].x = -pt.x;
            ring.pts[mi].y = pt.y;
          }
          DD.updateHullGeometry(G.carMesh, G.workingSpec);
          DD.updateCrossHandlePositions(G.crossHandles, G.workingSpec, handleDrag.stationIndex);
        } else {
          const st = G.workingSpec.chassis.hull.station[handleDrag.stationIndex];
          if (handleDrag.mode === 'length') {
            // shape: horizontal=w, vertical=h (original session-15 behaviour)
            st[1] = DD.clamp(handleDrag.startW + (e.clientX - handleDrag.startX) * HANDLE_SENS, R_STW[0], R_STW[1]);
            st[2] = DD.clamp(handleDrag.startH - (e.clientY - handleDrag.startY) * HANDLE_SENS, R_STH[0], R_STH[1]);
          } else { // 'move' — horizontal=fore-aft (z), vertical=raise-lower (y)
            st[0] = DD.clamp(handleDrag.startZ + (e.clientX - handleDrag.startX) * Z_SENS, -1, 1);
            st[3] = DD.clamp(handleDrag.startY0 - (e.clientY - handleDrag.startY) * HANDLE_SENS, 0, DD.CAR_SCHEMA.stY[1]);
          }
          // cheap live preview: only the hull's geometry + handle positions need updating for a
          // width/height/z/y edit (wheels/canopy/wings/parts don't depend on station data) — a full
          // updateShowcaseCar() rebuild here was the source of the unbearable per-pixel drag lag.
          DD.updateHullGeometry(G.carMesh, G.workingSpec);
          DD.updateEditHandlePositions(G.editHandles, G.workingSpec);
        }
      } else if (isDragging) {
        const dx = e.clientX - prevX;
        G.garageDragYaw = (G.garageDragYaw || 0) + dx * 0.007;
        prevX = e.clientX;
      }
    });
    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStartDist = 0;
      if (pointers.size === 0) {
        if (handleDrag) {
          buildGarageMenu();
          updateShowcaseCar();
        }
        isDragging = false;
        handleDrag = null;
      }
    };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);
    // T12: Esc exits a cross-session (tween back, edits already applied live are kept)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && G.state === 'garage' && G.crossSession) exitCrossSession();
    });

    if (DD.testMode) {
      const startSeed = DD.seed || 'DREAM-12345';
      const startTier = DD.tier || 1;
      startTrack(startSeed, startTier);
    } else {
      const startSeed = DD.dailySeedString() || 'DREAM-12345';
      startTrack(startSeed, 1, true);
    }
    G.lastT = performance.now();
    requestAnimationFrame(loop);
  };

  async function ensureTilt() {
    if (G.save.settings.controlMode === 'tilt' && isTouch()) {
      const ok = await DD.requestTiltPermission();
      if (!ok) { G.save.settings.controlMode = 'touch'; DD.persistSave(G.save); }
    }
    updateSteerPadsVisibility();
  }
  function updateSteerPadsVisibility() {
    const touchSteer = G.save.settings.controlMode !== 'tilt';
    $('padL').style.display = touchSteer ? 'block' : 'none';
    $('padR').style.display = touchSteer ? 'block' : 'none';
  }

  window.addEventListener('DOMContentLoaded', DD.boot);

})(typeof window !== 'undefined' ? window : globalThis);
