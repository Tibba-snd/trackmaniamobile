/* DRIFTDREAM input — keyboard, touch zones, tilt steering. */
(function (global) {
  'use strict';
  const DD = global.DD;

  const state = {
    steer: 0, throttle: 0, brake: 0,
    restartReq: false, respawnReq: false,
    keys: {},
    tiltNeutral: null, tiltRaw: 0,
    touchSteer: 0, touchGas: false, touchBrake: false,
    leftSteerTouch: null,
    mode: 'auto' // resolved from settings: 'tilt' | 'touch' | 'keys'
  };
  DD.input = state;

  DD.initInput = function (settings) {
    state.settings = settings;

    // ---- keyboard ----
    window.addEventListener('keydown', (e) => {
      state.keys[e.code] = true;
      if (e.code === 'KeyR') state.restartReq = true;
      if (e.code === 'KeyE') state.respawnReq = true;
      if (['ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { state.keys[e.code] = false; });

    if (DD.testMode && DD.mockKeys) {
      const parts = DD.mockKeys.split(',');
      for (const p of parts) {
        const trimmed = p.trim();
        if (trimmed) {
          state.keys[trimmed] = true;
        }
      }
    }

    // ---- tilt ----
    window.addEventListener('deviceorientation', (e) => {
      // landscape: device beta tilts left/right around long axis
      let v = 0;
      const o = (screen.orientation && screen.orientation.type) || '';
      if (o.startsWith('landscape')) {
        v = e.beta || 0;
        if (o === 'landscape-secondary') v = -v;
      } else {
        v = e.gamma || 0;
      }
      state.tiltRaw = v;
      if (state.tiltNeutral === null) state.tiltNeutral = v;
    }, true);

    // ---- touch buttons are wired by game.js via DD.bindTouch ----
  };

  DD.requestTiltPermission = async function () {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        const r = await DeviceOrientationEvent.requestPermission();
        return r === 'granted';
      }
    } catch (e) { return false; }
    return true; // Android: no permission needed
  };

  DD.calibrateTilt = function () { state.tiltNeutral = state.tiltRaw; };

  DD.bindTouch = function (els) {
    // els: { gas, brake, steerL, steerR }
    const hold = (el, on, off) => {
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); off(); }, { passive: false });
      el.addEventListener('touchcancel', off);
      el.addEventListener('mousedown', on);
      el.addEventListener('mouseup', off);
      el.addEventListener('mouseleave', off);
    };
    hold(els.gas, () => state.touchGas = true, () => state.touchGas = false);
    hold(els.brake, () => state.touchBrake = true, () => state.touchBrake = false);
    hold(els.steerL, () => state.touchSteer = -1, () => { if (state.touchSteer < 0) state.touchSteer = 0; });
    hold(els.steerR, () => state.touchSteer = 1, () => { if (state.touchSteer > 0) state.touchSteer = 0; });
  };

  // two-finger tap = restart (on the canvas)
  DD.bindCanvasGestures = function (canvas) {
    let twoFingerStart = 0;
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) twoFingerStart = performance.now();
    }, { passive: true });
    canvas.addEventListener('touchend', (e) => {
      if (twoFingerStart && e.touches.length === 0 && performance.now() - twoFingerStart < 350) {
        state.restartReq = true;
      }
      if (e.touches.length === 0) twoFingerStart = 0;
    }, { passive: true });
  };

  /* called each frame; returns {steer, throttle, brake} */
  DD.pollInput = function (settings) {
    const k = state.keys;
    let steer = 0, throttle = 0, brake = 0;

    // keyboard (always active — desktop dev)
    if (k['ArrowLeft'] || k['KeyA']) steer -= 1;
    if (k['ArrowRight'] || k['KeyD']) steer += 1;
    if (k['ArrowUp'] || k['KeyW']) throttle = 1;
    if (k['ArrowDown'] || k['KeyS']) brake = 1;

    // touch gas/brake
    if (state.touchGas) throttle = 1;
    if (state.touchBrake) brake = 1;

    // steering source
    if (settings.controlMode === 'tilt' && state.tiltNeutral !== null) {
      let d = (state.tiltRaw - state.tiltNeutral) * (settings.invertTilt ? -1 : 1);
      d = d / (22 / (settings.tiltSens || 1)); // ±22° = full lock at sens 1
      if (Math.abs(d) > Math.abs(steer)) steer = DD.clamp(d, -1, 1);
    }
    if (state.touchSteer !== 0) steer = state.touchSteer;

    return { steer: DD.clamp(steer, -1, 1), throttle, brake };
  };

})(typeof window !== 'undefined' ? window : globalThis);
