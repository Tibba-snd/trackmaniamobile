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

  const G = DD.game = {
    state: 'menu', // menu | loading | countdown | play | finish
    save: null,
    renderer: null, scene: null, camera: null,
    track: null, trackRoot: null,
    car: null, carMesh: null, trail: null, speedLines: null,
    ghostMesh: null, ghostData: null, ghostPlayhead: 0,
    recFrames: [], recEvery: 2, tickCount: 0,
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
      G.ghostMesh = DD.buildCar(G.save.garage, true, G.scene.environment);
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
  function startTrack(seed, tier) {
    G.unlockedTiersBefore = [];
    for (let t = 1; t <= 5; t++) {
      if (tierUnlocked(t)) G.unlockedTiersBefore.push(t);
    }

    G.state = 'loading';
    showScreen('loading');
    $('loadBiomeHeader').textContent = 'ACQUIRING SECTOR...';
    dialInText($('loadSeed'), seed + '  ·  TIER ' + tier);
    setTimeout(() => {
      const cacheKey = seed + '|' + tier;
      let track = DD.trackCache[cacheKey];
      if (!track) {
        track = DD.buildValidTrack(seed, tier);
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
      G.carMesh = DD.buildCar(G.save.garage, false, G.scene.environment);
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

      DD.startPads(track.theme);
      resetRun();
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

  // fast=true for retries (restart key / two-finger tap / retry button): time-attack is a
  // retry-spam genre, so skip most of the countdown. Full 3.2s only on the first load of a track.
  function resetRun(fast) {
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
          G.ghostMesh = DD.buildCar(G.save.garage, true, G.scene.environment);
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

  /* ---------------- main loop ---------------- */
  function loop(t) {
    requestAnimationFrame(loop);
    const dtReal = Math.min((t - G.lastT) / 1000, 0.1);
    G.lastT = t;
    if (G.state === 'loading') return;

    if (G.state === 'menu' || G.state === 'garage') {
      const orbitSpeed = G.state === 'garage' ? 0.00018 : 0.00008;
      // Freeze the ambient auto-spin while customizing — a moving target makes precision ring-dragging
      // unusable. Manual drag-to-orbit (garageDragYaw) still works in every mode.
      const autoSpin = (G.state === 'garage' && G.workingSpec) ? 0 : t * orbitSpeed;
      const dragAngle = G.garageDragYaw || 0;
      const angle = autoSpin + dragAngle;
      const radius = G.state === 'garage' ? 7.5 : 12.0;
      const height = G.state === 'garage' ? 2.4 : 3.8;
      
      const carPos = G.car ? G.car.pos : [0, 4, 0];
      G.camera.position.set(
        carPos[0] + Math.sin(angle) * radius,
        carPos[1] + height,
        carPos[2] - Math.cos(angle) * radius
      );
      G.camera.lookAt(carPos[0], carPos[1] + 0.4, carPos[2]);

      // Garage stage: a dedicated platform for the showcase car (see DD.buildGarageStage) so it
      // doesn't look parked in the middle of the actual raceway; hides the start/checkpoint gate
      // arches while here. Sky/mountains/stars/decor are untouched — only the immediate ground +
      // gate props swap out, keeping the surrounding world/theme intact.
      if (!G.garageStage) {
        G.garageStage = DD.buildGarageStage(G.scene.environment, G.track && G.track.theme);
        G.scene.add(G.garageStage);
      }
      G.garageStage.position.set(carPos[0], carPos[1], carPos[2]);
      G.garageStage.visible = G.state === 'garage';
      if (G.track && G.track.gateMeshes) {
        G.track.gateMeshes.forEach((m) => { m.visible = G.state !== 'garage'; });
      }
      // tall glowing verticals (poles/props/arches/pylons) — hidden in garage so a lamp behind
      // the stage can't bloom into a beam through the showcase car
      if (G.track && G.track.garageHide) {
        for (const m of G.track.garageHide) m.visible = G.state !== 'garage';
      }

      const s0 = G.track ? G.track.samples[G.track.startIdx] : null;
      if (G.car && G.carMesh && s0) {
        DD.poseCar(G.carMesh, G.car.pos, G.car.yaw, s0.u, 0, 0, 0, 0, 0);
        if (G.shadow) {
          DD.updateShadow(G.shadow, G.car.pos, s0.u, G.car.yaw, G.car, G.track);
        }
      }
      if (G.ghostMesh) G.ghostMesh.visible = false;

      if (G.track) {
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

      if (G.composer && G.composer._bloom) {
        G.composer._bloom.strength = Math.min(
          DD.GLOW.bloom.base * DD.glowMul(G.save.settings, G.track && G.track.theme), DD.GLOW.bloom.cap);
      }
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

    if (G.composer && G.composer._bloom) {
      const speedNorm = speed / DD.PHYS.vmax;
      const bloomSpeedCreep = Math.max(0, speedNorm - 0.6) * DD.GLOW.bloom.speedCreep;
      const flash = (G.driftFlash || 0) * DD.GLOW.bloom.driftFlash;
      // composed strength scales with the user/biome glow multiplier and is hard-capped —
      // event surges can accent the scene but never white it out
      G.composer._bloom.strength = Math.min(
        (DD.GLOW.bloom.base + bloomSpeedCreep + flash) * DD.glowMul(G.save.settings, G.track.theme),
        DD.GLOW.bloom.cap);
    }

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
    for (const id of ['menu', 'loading', 'finish', 'gameHud', 'campaign', 'settings', 'garage']) {
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
    if (G.workingSpec && G.editMode === 'length' && G.carMesh) {
      G.editHandles = DD.buildEditHandles(G.workingSpec);
      G.carMesh.add(G.editHandles);
    }
  }
  function updateShowcaseCar() {
    if (G.carMesh) DD.disposeGroup(G.scene, G.carMesh);
    const spec = G.workingSpec || DD.resolveSpec(G.save.garage);
    G.carMesh = DD.buildCarFromSpec(spec, { ghost: false, envMap: G.scene.environment, garage: G.save.garage });
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
    mk('gForms', GA.forms, g.form, (it) => it, (i) => g.form = i);

    // Tab switching wiring
    $('tabBtnPaint').onclick = () => showTab('Paint');
    $('tabBtnFinish').onclick = () => showTab('Finish');
    $('tabBtnForm').onclick = () => showTab('Form');
    function showTab(name) {
      ['Paint', 'Finish', 'Form'].forEach(t => {
        $('tabBtn' + t).classList.toggle('active', t === name);
        $('tab' + t).style.display = t === name ? 'block' : 'none';
      });
    }

    // Customize / Reset / edit-mode toolbar (P2 slice A — Length-rings editing). A working spec
    // forks away from the locked-preset selector, so the chassis tab (which just re-resolves a
    // preset) would silently discard the fork — hide it while customizing instead.
    if (G.workingSpec && $('tabBtnForm').classList.contains('active')) showTab('Paint');
    $('tabBtnForm').style.display = G.workingSpec ? 'none' : '';
    $('btnCustomize').style.display = G.workingSpec ? 'none' : '';
    $('btnEditReset').style.display = G.workingSpec ? '' : 'none';
    $('editModeBar').style.display = G.workingSpec ? 'flex' : 'none';
    $('btnCustomize').onclick = () => {
      DD.sfxClick();
      G.workingSpec = DD.normalizeSpec(JSON.parse(JSON.stringify(DD.CAR_PRESETS[g.form % DD.CAR_PRESETS.length])));
      G.editMode = 'orbit';
      buildGarageMenu();
      updateShowcaseCar();
    };
    $('btnEditReset').onclick = () => {
      DD.sfxClick();
      G.workingSpec = null;
      G.editMode = 'orbit';
      buildGarageMenu();
      updateShowcaseCar();
    };
    ['orbit', 'length'].forEach((mode) => {
      const b = $('editMode_' + mode);
      b.classList.toggle('sel', G.editMode === mode);
      b.onclick = () => { DD.sfxClick(); G.editMode = mode; buildGarageMenu(); updateEditHandles(); };
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
    if (DD.testMode) {
      G.save.settings.controlMode = 'keys';
      G.save.settings.quality = 'low';
      DD._G = G; // test-only introspection hook (e2e / preview verification); never set outside testMode
    }
    DD.cameraProfile = G.save.settings.camera || 'close'; // saved framing profile (see DD.CAM_PROFILES)
    const canvas = $('gl');
    G.renderer = DD.createRenderer(canvas, G.save.settings.quality);
    G.scene = new THREE.Scene();
    G.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 6000);
    G.composer = DD.createComposer(G.renderer, G.scene, G.camera, G.save.settings.quality);
    DD.initInput(G.save.settings);
    DD.bindCanvasGestures(canvas);

    window.addEventListener('resize', () => {
      G.renderer.setSize(window.innerWidth, window.innerHeight);
      if (G.composer) {
        G.composer.setSize(window.innerWidth, window.innerHeight);
        // keep FXAA's texel size in sync with the drawing-buffer (size * pixelRatio)
        if (G.composer._fxaa) {
          const dpr = G.renderer.getPixelRatio();
          G.composer._fxaa.material.uniforms['resolution'].value.set(1 / (window.innerWidth * dpr), 1 / (window.innerHeight * dpr));
        }
      }
      G.camera.aspect = window.innerWidth / window.innerHeight;
      G.camera.updateProjectionMatrix();
    });

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
    $('finReplay').onclick = () => { DD.sfxClick(); startTrack(G.track.seed, G.track.tier); };
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
    function saveSet() { DD.persistSave(G.save); }

    // touch controls
    DD.bindTouch({ gas: $('padGas'), brake: $('padBrake'), drift: $('padDrift'), steerL: $('padL'), steerR: $('padR') });
    updateSteerPadsVisibility();

    // Pointer drag for orbit camera manual rotation in garage, PLUS (P2 slice A) ring-handle
    // picking/dragging in Length-rings edit mode. A hit on a handle starts a handle-drag instead of
    // the orbit-drag; the two are mutually exclusive per gesture.
    let isDragging = false;
    let prevX = 0;
    let handleDrag = null; // { stationIndex, startX, startY, startW, startH }
    const raycaster = new THREE.Raycaster();
    const pickNdc = new THREE.Vector2();
    const R_STW = DD.CAR_SCHEMA.stW, R_STH = DD.CAR_SCHEMA.stH;
    const HANDLE_SENS = 0.003; // screen px -> station w/h units
    function pickHandle(clientX, clientY) {
      if (!G.editHandles) return null;
      const rect = canvas.getBoundingClientRect();
      pickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pickNdc, G.camera);
      const hits = raycaster.intersectObjects(G.editHandles.children);
      return hits.length ? hits[0].object.userData.stationIndex : null;
    }
    window.addEventListener('pointerdown', (e) => {
      if (G.state !== 'garage' || e.clientX <= 370) return;
      const si = (G.editMode === 'length') ? pickHandle(e.clientX, e.clientY) : null;
      if (si != null) {
        const st = G.workingSpec.chassis.hull.station[si];
        handleDrag = { stationIndex: si, startX: e.clientX, startY: e.clientY, startW: st[1], startH: st[2] };
      } else {
        isDragging = true;
        prevX = e.clientX;
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (G.state !== 'garage') return;
      if (handleDrag) {
        const st = G.workingSpec.chassis.hull.station[handleDrag.stationIndex];
        st[1] = DD.clamp(handleDrag.startW + (e.clientX - handleDrag.startX) * HANDLE_SENS, R_STW[0], R_STW[1]);
        st[2] = DD.clamp(handleDrag.startH - (e.clientY - handleDrag.startY) * HANDLE_SENS, R_STH[0], R_STH[1]);
        // cheap live preview: only the hull's geometry + handle positions need updating for a
        // width/height edit (wheels/canopy/wings/parts don't depend on station data) — a full
        // updateShowcaseCar() rebuild here was the source of the unbearable per-pixel drag lag.
        DD.updateHullGeometry(G.carMesh, G.workingSpec);
        DD.updateEditHandlePositions(G.editHandles, G.workingSpec);
      } else if (isDragging) {
        const dx = e.clientX - prevX;
        G.garageDragYaw = (G.garageDragYaw || 0) + dx * 0.007;
        prevX = e.clientX;
      }
    });
    window.addEventListener('pointerup', () => {
      isDragging = false;
      handleDrag = null;
    });

    if (DD.testMode) {
      const startSeed = DD.seed || 'DREAM-12345';
      const startTier = DD.tier || 1;
      startTrack(startSeed, startTier);
    } else {
      const startSeed = DD.dailySeedString() || 'DREAM-12345';
      startTrack(startSeed, 1);
      setTimeout(() => {
        G.state = 'menu';
        showScreen('menu');
      }, 50);
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
