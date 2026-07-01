/* DRIFTDREAM core — seeded RNG, vector math, helpers. THREE-free (node-testable). */
(function (global) {
  'use strict';
  const DD = global.DD = global.DD || {};

  // ---- Seeded RNG ----
  DD.hashSeed = function (str) {
    str = String(str).toUpperCase().trim();
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return h >>> 0;
  };

  DD.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  DD.makeRng = function (seedStr) {
    const r = DD.mulberry32(DD.hashSeed(seedStr));
    return {
      next: r,
      range: (a, b) => a + r() * (b - a),
      int: (a, b) => a + Math.floor(r() * (b - a + 1)), // inclusive
      pick: (arr) => arr[Math.floor(r() * arr.length) % arr.length],
      chance: (p) => r() < p,
      sign: () => (r() < 0.5 ? -1 : 1),
      weighted: (pairs) => { // [[item, weight], ...]
        let tot = 0; for (const p of pairs) tot += p[1];
        let x = r() * tot;
        for (const p of pairs) { x -= p[1]; if (x <= 0) return p[0]; }
        return pairs[pairs.length - 1][0];
      }
    };
  };

  // Random readable seed like DREAM-7F3K2
  DD.randomSeedString = function () {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return 'DREAM-' + s;
  };

  DD.dailySeedString = function (date) {
    const d = date || new Date();
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return 'DAILY-' + y + m + dd;
  };

  // ---- Vec3 as [x,y,z] ----
  const V = DD.v = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    addS: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
    lenSq: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
    dist: (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return Math.sqrt(dx * dx + dy * dy + dz * dz); },
    distSq: (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return dx * dx + dy * dy + dz * dz; },
    norm: (a) => { const l = V.len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    clone: (a) => [a[0], a[1], a[2]]
  };

  // ---- scalar helpers ----
  DD.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  DD.lerp = (a, b, t) => a + (b - a) * t;
  DD.smoothstep = (t) => t * t * (3 - 2 * t);
  DD.dampTo = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  DD.angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

  DD.formatTime = function (ms) {
    if (ms == null || !isFinite(ms)) return '--:--.---';
    ms = Math.max(0, Math.round(ms));
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), x = ms % 1000;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(x).padStart(3, '0');
  };

  DD.formatDelta = function (ms) {
    const sign = ms >= 0 ? '+' : '−';
    return sign + (Math.abs(ms) / 1000).toFixed(2);
  };

  // ---- test mode globals ----
  DD.testMode = false;
  DD.seed = null;
  DD.tier = null;
  DD.autodrive = false;
  DD.duration = null;
  DD.mockKeys = null;

  // ---- storage ----
  const SAVE_KEY = 'driftdream_v1';
  DD.loadSave = function () {
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(SAVE_KEY) : null;
      if (raw) return JSON.parse(raw);
    } catch (e) { /* corrupted */ }
    return { settings: { tilt: true, tiltSens: 1.0, invertTilt: false, sfx: 0.8, engine: 0.7, music: 0.5, quality: 'high', controlMode: 'tilt' }, garage: { grad: 6, finish: 1, form: 2 }, tracks: {}, meta: { created: Date.now() } };
  };
  DD.persistSave = function (save) {
    if (DD.testMode) return;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* full */ }
  };

})(typeof window !== 'undefined' ? window : globalThis);
