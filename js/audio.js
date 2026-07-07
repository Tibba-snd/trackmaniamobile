/* DRIFTDREAM audio — synth engine with auto gearbox, whoosh, chimes, ambient pads. Web Audio, no samples. */
(function (global) {
  'use strict';
  const DD = global.DD;

  const A = DD.audio = {
    ctx: null, started: false,
    gear: 1, rpm: 0.2, shiftT: 0,
    nodes: {}, padNodes: [],
    volumes: { engine: 0.7, sfx: 0.8, music: 0.5 }
  };

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    DD.debugAudio = params.has('debugAudio') && params.get('debugAudio') !== 'false';
  } else {
    DD.debugAudio = false;
  }

  const GEARS = [0, 18, 32, 48, 66, 86, 200]; // upshift speeds (m/s) per gear 1..6
  const NGEARS = 6;
  let noiseBuf = null;

  DD.initAudio = function (volumes) {
    if (A.started) return;
    Object.assign(A.volumes, volumes || {});
    const ctx = A.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = A.nodes.master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    // ---- engine: 2 detuned saws + sub sine + airy noise through lowpass ----
    const eGain = A.nodes.engineGain = ctx.createGain(); eGain.gain.value = 0;
    const eFilt = A.nodes.engineFilt = ctx.createBiquadFilter();
    eFilt.type = 'lowpass'; eFilt.frequency.value = 900; eFilt.Q.value = 2.2;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 14;
    const o3 = ctx.createOscillator(); o3.type = 'sine';
    const g1 = ctx.createGain(); g1.gain.value = 0.30;
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    const g3 = ctx.createGain(); g3.gain.value = 0.5; // sub
    o1.connect(g1).connect(eFilt); o2.connect(g2).connect(eFilt); o3.connect(g3).connect(eFilt);
    eFilt.connect(eGain).connect(master);
    o1.start(); o2.start(); o3.start();
    A.nodes.o1 = o1; A.nodes.o2 = o2; A.nodes.o3 = o3;

    // ---- wind whoosh: filtered noise ----
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
    const nFilt = A.nodes.windFilt = ctx.createBiquadFilter(); nFilt.type = 'bandpass'; nFilt.frequency.value = 600; nFilt.Q.value = 0.6;
    const nGain = A.nodes.windGain = ctx.createGain(); nGain.gain.value = 0;
    noise.connect(nFilt).connect(nGain).connect(master);
    noise.start();

    // ---- tire screech: bandpass noise, audible the moment you slide ----
    const sc = ctx.createBufferSource(); sc.buffer = noiseBuf; sc.loop = true;
    const scFilt = A.nodes.screechFilt = ctx.createBiquadFilter(); scFilt.type = 'bandpass'; scFilt.frequency.value = 1300; scFilt.Q.value = 3.5;
    const scGain = A.nodes.screechGain = ctx.createGain(); scGain.gain.value = 0;
    sc.connect(scFilt).connect(scGain).connect(master);
    sc.start();

    // ---- dirt rumble ----
    const rm = ctx.createBufferSource(); rm.buffer = noiseBuf; rm.loop = true;
    const rmFilt = ctx.createBiquadFilter(); rmFilt.type = 'lowpass'; rmFilt.frequency.value = 160; rmFilt.Q.value = 0.5;
    const rmGain = A.nodes.rumbleGain = ctx.createGain(); rmGain.gain.value = 0;
    rm.connect(rmFilt).connect(rmGain).connect(master);
    rm.start();

    // ---- wall scrape: grinding bandpass noise ----
    const scr = ctx.createBufferSource(); scr.buffer = noiseBuf; scr.loop = true;
    const scrFilt = A.nodes.scrapeFilt = ctx.createBiquadFilter(); scrFilt.type = 'bandpass'; scrFilt.frequency.value = 400; scrFilt.Q.value = 1.2;
    const scrGain = A.nodes.scrapeGain = ctx.createGain(); scrGain.gain.value = 0;
    scr.connect(scrFilt).connect(scrGain).connect(master);
    scr.start();

    A.started = true;
  };

  DD.startPads = function (theme) {
    if (!A.started) return;
    DD.stopPads();
    const ctx = A.ctx;
    // dreamy chord from theme hue: root from palette name hash
    const base = 110 * Math.pow(2, (DD.hashSeed(theme.name + theme.seed) % 12) / 12);
    const intervals = [1, 1.5, 2, 2.978]; // root, fifth, octave, ~7th
    const padMaster = ctx.createGain();
    padMaster.gain.value = 0;
    padMaster.connect(A.nodes.master);
    padMaster.gain.linearRampToValueAtTime(0.05 * A.volumes.music * 2, ctx.currentTime + 4);
    for (const iv of intervals) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = base * iv;
      o.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain(); g.gain.value = 0.25;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.12;
      lfo.connect(lfoG).connect(g.gain);
      o.connect(g).connect(padMaster);
      o.start(); lfo.start();
      A.padNodes.push(o, lfo);
    }
    A.padNodes.push(padMaster);
    A.nodes.padMaster = padMaster;
  };

  DD.stopPads = function () {
    for (const n of A.padNodes) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) {} }
    A.padNodes = [];
  };

  /* per-frame engine update. Reads the PHYSICS gearbox (gear + rpm01) when provided. */
  DD.updateEngine = function (speed, throttle, grounded, surf, dt, physGear, physRpm) {
    if (!A.started) return;
    const ctx = A.ctx, n = A.nodes;

    let gear, rpm;
    if (physGear != null) {
      if (physGear !== A.gear) A.shiftT = physGear > A.gear ? 0.12 : 0.2;
      A.gear = gear = physGear;
      rpm = physRpm != null ? physRpm : 0.5;
    } else {
      gear = A.gear;
      if (speed > GEARS[gear] && gear < NGEARS) { gear++; A.shiftT = 0.12; }
      else if (gear > 1 && speed < GEARS[gear - 1] * 0.82) { gear--; A.shiftT = 0.09; }
      A.gear = gear;
      const lo = gear === 1 ? 0 : GEARS[gear - 1] * 0.82;
      const hi = GEARS[gear];
      rpm = DD.clamp((speed - lo) / Math.max(hi - lo, 1), 0, 1.04);
    }
    if (A.shiftT > 0) { A.shiftT -= dt; rpm *= 0.55; } // shift drop
    // idle / clutch
    rpm = Math.max(rpm, 0.12 + throttle * 0.1);
    A.rpm = DD.dampTo(A.rpm, rpm, 18, dt);

    const limiter = A.rpm > 1.0;
    const f = 50 + A.rpm * 430 + gear * 6;
    const jitter = limiter ? (Math.random() * 22 - 11) : 0;
    n.o1.frequency.setTargetAtTime(f + jitter, ctx.currentTime, 0.016);
    n.o2.frequency.setTargetAtTime(f * 1.005 + jitter, ctx.currentTime, 0.016);
    n.o3.frequency.setTargetAtTime(f * 0.5, ctx.currentTime, 0.02);

    let cut = 380 + A.rpm * 2600 + throttle * 800;
    let vol = (0.08 + A.rpm * 0.16 + throttle * 0.10) * A.volumes.engine;
    if (!grounded) { cut *= 0.45; vol *= 0.7; }            // distant hum in air
    if (surf === DD.SURF.GLASS) cut *= 1.5;                 // crystalline
    if (limiter) vol *= 0.82 + Math.random() * 0.18;        // rev limiter buzz
    n.engineFilt.frequency.setTargetAtTime(cut, ctx.currentTime, 0.03);
    n.engineGain.gain.setTargetAtTime(vol, ctx.currentTime, 0.03);

    // wind
    n.windGain.gain.setTargetAtTime(Math.min(speed / 110, 1) * 0.16 * A.volumes.sfx, ctx.currentTime, 0.08);
    n.windFilt.frequency.setTargetAtTime(300 + speed * 14, ctx.currentTime, 0.1);
  };

  /* slide intensity 0..1, dirt flag, hitWall flag, kerb intensity 0..1 — call each frame */
  DD.updateSurfaceAudio = function (slide, speed, onDirt, hitWall, kerb) {
    if (!A.started) return;
    const ctx = A.ctx, n = A.nodes;
    const sc = DD.clamp(slide, 0, 1) * DD.clamp(speed / 30, 0, 1);
    n.screechGain.gain.setTargetAtTime(sc * 0.22 * A.volumes.sfx, ctx.currentTime, 0.04);
    n.screechFilt.frequency.setTargetAtTime(1100 + slide * 600 + speed * 3, ctx.currentTime, 0.06);
    // rumble serves dirt AND the corner kerb band (kerb slightly quieter, same noise loop)
    const rumble = onDirt ? DD.clamp(speed / 35, 0, 1) * 0.3
      : DD.clamp(kerb || 0, 0, 1) * DD.clamp(speed / 35, 0, 1) * 0.22;
    n.rumbleGain.gain.setTargetAtTime(rumble * A.volumes.sfx, ctx.currentTime, 0.07);

    // ---- wall scrape: grinding bandpass noise while hitWall & speed > 5 ----
    const active = !!hitWall && speed > 5;
    const targetScVol = active ? DD.clamp((speed - 5) / 35, 0, 1) * 0.25 * A.volumes.sfx : 0;
    n.scrapeGain.gain.setTargetAtTime(targetScVol, ctx.currentTime, active ? 0.03 : 0.08);
    if (active) {
      const f = 200 + speed * 6 + Math.random() * 80;
      n.scrapeFilt.frequency.setTargetAtTime(f, ctx.currentTime, 0.04);
    }
  };

  DD.engineQuiet = function () {
    if (!A.started) return;
    A.nodes.engineGain.gain.setTargetAtTime(0, A.ctx.currentTime, 0.1);
    A.nodes.windGain.gain.setTargetAtTime(0, A.ctx.currentTime, 0.1);
    if (A.nodes.scrapeGain) A.nodes.scrapeGain.gain.setTargetAtTime(0, A.ctx.currentTime, 0.1);
  };

  function blip(freq, dur, type, vol, when) {
    if (!A.started || !A.ctx) return;
    const ctx = A.ctx;
    const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime + (when || 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * A.volumes.sfx, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(A.nodes.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  DD.sfxCheckpoint = function (i) {
    if (!A.started) return;
    const f = 520 * Math.pow(2, i * 2 / 12);
    blip(f, 0.5, 'sine', 0.5);
    blip(f * 1.5, 0.7, 'sine', 0.25, 0.06);
  };
  DD.sfxFinish = function (medal) {
    if (!A.started) return;
    const roots = { author: 660, gold: 587, silver: 523, bronze: 466, none: 392 };
    const r = roots[medal] || 392;
    [0, 0.12, 0.24, 0.42].forEach((w, i) => blip(r * Math.pow(2, [0, 4, 7, 12][i] / 12), 0.8, 'triangle', 0.4, w));
  };
  DD.sfxRespawn = function () { if (A.started) { blip(220, 0.25, 'sine', 0.3); blip(165, 0.35, 'sine', 0.25, 0.05); } };
  DD.sfxClick = function () { if (A.started) blip(880, 0.08, 'sine', 0.2); };
  DD.sfxCountdown = function (go) { if (A.started) blip(go ? 880 : 440, go ? 0.5 : 0.15, 'square', 0.22); };

  function noiseSfx(filterType, filterFreq, dur, vol, q) {
    if (!A.started || !noiseBuf) return;
    const ctx = A.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    
    const filt = ctx.createBiquadFilter();
    filt.type = filterType || 'lowpass';
    filt.frequency.setValueAtTime(filterFreq, ctx.currentTime);
    if (q !== undefined) filt.Q.setValueAtTime(q, ctx.currentTime);
    
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * A.volumes.sfx, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    
    src.connect(filt).connect(g).connect(A.nodes.master);
    const offset = Math.random() * 1.5;
    src.start(t, offset);
    src.stop(t + dur + 0.05);
  }

  DD.sfxWallThud = function (speedScale) {
    const vol = DD.clamp(speedScale, 0, 1) * 0.7;
    if (DD.debugAudio) {
      console.log('[SFX] WallThud - speedScale:', speedScale.toFixed(3), 'vol:', vol.toFixed(3));
    }
    if (vol > 0.02) {
      noiseSfx('lowpass', 150, 0.2, vol, 1.0);
    }
  };

  DD.sfxLandingWhump = function (speedScale) {
    const vol = DD.clamp(speedScale, 0, 1) * 0.6;
    if (DD.debugAudio) {
      console.log('[SFX] LandingWhump - speedScale:', speedScale.toFixed(3), 'vol:', vol.toFixed(3));
    }
    if (vol > 0.02) {
      noiseSfx('lowpass', 140, 0.3, vol, 0.8);
      blip(70, 0.25, 'sine', vol * 0.8); // 70 Hz body tap
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
