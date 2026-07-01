/* DRIFTDREAM car spec — the THREE-free data layer for the cars-as-data design system.
   Holds the schema ranges, normalizeSpec (the guardrail), the 4 locked preset CarSpecs, and
   resolveSpec. No THREE here — this is Node-testable like core/theme/trackgen/physics.
   The renderer (DD.buildCarFromSpec) + primitive/part builders live in scene.js (they need THREE).
   See CAR_DESIGN_SYSTEM.md for the full model. */
(function (global) {
  'use strict';
  const DD = global.DD;

  // ---- schema ranges (normalizeSpec clamps to these; also drive the future editor controls) ----
  const R = {
    L:          [0.70, 1.20, 1.00],
    frontR:     [0.20, 0.70, 0.34],
    rearR:      [0.20, 0.70, 0.40],
    tyreW:      [0.10, 0.60, 0.34],
    trackF:     [0.50, 1.20, 0.86],
    trackR:     [0.50, 1.20, 0.90],
    frontZ:     [0.80, 2.00, 1.50],
    rearZ:      [-2.00, -0.80, -1.35],
    stW:        [0.02, 1.20, 0.30],
    stH:        [0.02, 0.80, 0.20],
    stY:        [0.00, 0.60, 0.16],
    fenderClamp:[0.30, 1.20, 0.70],
    glowI:      [0.00, 2.00, 0.9],
    metalBias:  [-0.30, 0.30, 0.0],
    sectionExp: [0.30, 1.50, 1.0]
  };
  const MAX_STATIONS = 24, MAX_PARTS = 16, MAX_MOUNT_BLOCKS = 64;
  DD.CAR_SCHEMA = R;

  const clamp = (v, lo, hi, dflt) => {
    v = (typeof v === 'number' && isFinite(v)) ? v : dflt;
    return v < lo ? lo : (v > hi ? hi : v);
  };
  const cl = (v, key) => clamp(v, R[key][0], R[key][1], R[key][2]);

  // Known part + wheel-style names (unknown ones are dropped by normalize → forward-compat).
  const PARTS = ['frontWing', 'rearWingBiplane', 'rearSpoilerLow', 'hoverFins', 'splitter',
    'splitterGlow', 'halo', 'sharkFin', 'diffuser', 'exhausts', 'exposedEngine', 'hoverChannels',
    'glowCore', 'ducktail', 'chromeTrim'];
  const WHEEL_STYLES = ['multiSpoke', 'turbofan', 'glowDisc', 'classicSpoke'];
  DD.CAR_PART_NAMES = PARTS;
  DD.CAR_WHEEL_STYLES = WHEEL_STYLES;

  /* normalizeSpec — make any edited/saved/shared spec safe: clamp ranges, fill defaults, drop
     unknown parts, cap counts. Output is always renderable + contract-valid. Pure (clones input). */
  DD.normalizeSpec = function (spec) {
    spec = spec || {};
    const ch = spec.chassis || {};
    const hp = ch.hardpoints || {};
    const hull = ch.hull || {};

    // hull stations
    let station = Array.isArray(hull.station) ? hull.station.slice(0, MAX_STATIONS) : [];
    station = station.map((s) => {
      if (Array.isArray(s)) return [Number(s[0]) || 0, cl(s[1], 'stW'), cl(s[2], 'stH'), cl(s[3], 'stY')];
      return [Number(s.z) || 0, cl(s.w, 'stW'), cl(s.h, 'stH'), cl(s.y, 'stY')];
    });
    if (station.length < 2) { // never let a degenerate hull through
      station = [[1, 0.1, 0.05, 0.06], [0.5, 0.5, 0.18, 0.12], [0, 0.5, 0.4, 0.22],
        [-0.5, 0.6, 0.24, 0.14], [-1, 0.4, 0.12, 0.1]];
    }

    const section = hull.section || {};
    const kind = (section.kind === 'superellipse') ? 'superellipse' : 'ellipse';

    const out = {
      schemaVersion: 1,
      name: typeof spec.name === 'string' ? spec.name.slice(0, 40) : 'Custom',
      basePreset: spec.basePreset || null,
      chassis: {
        L: cl(ch.L, 'L'),
        hardpoints: {
          frontZ: cl(hp.frontZ, 'frontZ'), rearZ: cl(hp.rearZ, 'rearZ'),
          trackF: cl(hp.trackF, 'trackF'), trackR: cl(hp.trackR, 'trackR'),
          frontR: cl(hp.frontR, 'frontR'), rearR: cl(hp.rearR, 'rearR'),
          tyreW: cl(hp.tyreW, 'tyreW')
        },
        hull: {
          station: station,
          section: { kind: kind, exp: cl(section.exp, 'sectionExp') },
          fenderClamp: cl(hull.fenderClamp, 'fenderClamp')
        },
        floor: ch.floor === null ? null : {
          w: clamp((ch.floor || {}).w, 0.4, 1.6, 1.0),
          h: clamp((ch.floor || {}).h, 0.02, 0.2, 0.07),
          z: clamp((ch.floor || {}).z, -1, 1, 0.05)
        }
      },
      wheelStyle: WHEEL_STYLES.indexOf(spec.wheelStyle) >= 0 ? spec.wheelStyle : 'multiSpoke',
      canopy: {
        kind: (spec.canopy && spec.canopy.kind) || 'bubble',
        scale: (spec.canopy && Array.isArray(spec.canopy.scale)) ? spec.canopy.scale.map(Number) : [0.22, 0.13, 0.55],
        z: clamp((spec.canopy || {}).z, -0.5, 1, 0.25),
        y: clamp((spec.canopy || {}).y, 0.2, 0.9, 0.46),
        halo: !!(spec.canopy && spec.canopy.halo)
      },
      // parts: list of {part, knobs, at?}; drop unknown part names, cap count + per-part blocks
      mounts: (Array.isArray(spec.mounts) ? spec.mounts : []).map((m) => {
        if (typeof m === 'string') m = { part: m };
        return m;
      }).filter((m) => PARTS.indexOf(m.part) >= 0).slice(0, MAX_PARTS).map((m) => ({
        part: m.part,
        knobs: (m.knobs && typeof m.knobs === 'object') ? m.knobs : {},
        at: m.at || null
      })),
      palette: {
        glowI: cl((spec.palette || {}).glowI, 'glowI'),
        metalBias: cl((spec.palette || {}).metalBias, 'metalBias')
      },
      gallery: {
        grad: clamp((spec.gallery || {}).grad, 0, 7, 6) | 0,
        finish: clamp((spec.gallery || {}).finish, 0, 4, 1) | 0
      }
    };
    return out;
  };

  // ---------------------------- the 4 locked presets (read-only seeds) ----------------------------
  // Hull station tables = the silhouettes Tibba sculpted in the editor. See CAR_DESIGN_SYSTEM.md §8.
  DD.CAR_PRESETS = [
    { // 0 — Apex Formula
      schemaVersion: 1, name: 'Apex Formula', basePreset: 'apex',
      chassis: {
        L: 0.94,
        hardpoints: { frontZ: 1.5, rearZ: -1.35, trackF: 0.86, trackR: 0.90, frontR: 0.34, rearR: 0.40, tyreW: 0.47 },
        hull: {
          station: [[1, 0.07, 0.05, 0.09], [0.75, 0.19, 0.21, 0.19], [0.5, 0.32, 0.29, 0.27],
            [0.25, 0.49, 0.35, 0.23], [0, 0.70, 0.38, 0.27], [-0.25, 0.74, 0.37, 0.26],
            [-0.5, 0.43, 0.42, 0.25], [-0.75, 0.39, 0.25, 0.25], [-1, 0.37, 0.15, 0.33]],
          section: { kind: 'ellipse', exp: 0.85 }, fenderClamp: 0.76
        },
        floor: { w: 0.95, h: 0.07, z: 0.05 }
      },
      wheelStyle: 'multiSpoke',
      canopy: { kind: 'open', scale: [0.20, 0.12, 0.45], z: 0.25, y: 0.46, halo: true },
      mounts: ['frontWing', 'rearWingBiplane', 'halo', 'splitter', 'diffuser'],
      palette: { glowI: 0.95, metalBias: 0.05 },
      gallery: { grad: 2, finish: 1 }
    },
    { // 1 — Endurance Prototype
      schemaVersion: 1, name: 'Endurance Prototype', basePreset: 'endurance',
      chassis: {
        L: 0.93,
        hardpoints: { frontZ: 1.5, rearZ: -1.35, trackF: 0.86, trackR: 0.90, frontR: 0.34, rearR: 0.42, tyreW: 0.34 },
        hull: {
          station: [[1, 0.24, 0.08, 0.06], [0.75, 0.54, 0.40, 0.22], [0.5, 0.84, 0.44, 0.28],
            [0.25, 0.70, 0.43, 0.28], [0, 0.72, 0.48, 0.28], [-0.25, 0.72, 0.52, 0.30],
            [-0.5, 0.85, 0.52, 0.30], [-0.75, 0.81, 0.54, 0.35], [-1, 0.60, 0.13, 0.52]],
          section: { kind: 'ellipse', exp: 1.0 }, fenderClamp: 0.95
        },
        floor: { w: 1.05, h: 0.07, z: 0.05 }
      },
      wheelStyle: 'turbofan',
      canopy: { kind: 'bubble', scale: [0.26, 0.14, 0.65], z: 0.2, y: 0.5, halo: false },
      mounts: ['splitter', 'rearSpoilerLow', 'sharkFin', 'diffuser'],
      palette: { glowI: 0.7, metalBias: 0.1 },
      gallery: { grad: 6, finish: 1 }
    },
    { // 2 — Neon Speeder
      schemaVersion: 1, name: 'Neon Speeder', basePreset: 'neon',
      chassis: {
        L: 0.98,
        hardpoints: { frontZ: 1.5, rearZ: -1.35, trackF: 0.86, trackR: 0.90, frontR: 0.40, rearR: 0.50, tyreW: 0.42 },
        hull: {
          station: [[1, 0.16, 0.08, 0.08], [0.75, 0.34, 0.16, 0.12], [0.5, 0.46, 0.37, 0.18],
            [0.25, 0.52, 0.46, 0.24], [0, 0.89, 0.50, 0.26], [-0.25, 0.88, 0.52, 0.27],
            [-0.5, 0.74, 0.47, 0.24], [-0.75, 0.44, 0.20, 0.20], [-1, 0.50, 0.31, 0.32]],
          section: { kind: 'superellipse', exp: 0.5 }, fenderClamp: 0.95
        },
        floor: { w: 1.0, h: 0.08, z: 0.05 }
      },
      wheelStyle: 'glowDisc',
      canopy: { kind: 'recessed', scale: [0.24, 0.11, 0.50], z: 0.2, y: 0.5, halo: false },
      mounts: ['splitterGlow', 'hoverFins', 'hoverChannels', 'glowCore'],
      palette: { glowI: 1.4, metalBias: -0.05 },
      gallery: { grad: 0, finish: 4 }
    },
    { // 3 — Classic Cigar
      schemaVersion: 1, name: 'Classic Cigar', basePreset: 'classic',
      chassis: {
        L: 1.02,
        hardpoints: { frontZ: 1.5, rearZ: -1.35, trackF: 0.86, trackR: 0.90, frontR: 0.40, rearR: 0.44, tyreW: 0.20 },
        hull: {
          station: [[1, 0.10, 0.10, 0.10], [0.75, 0.22, 0.18, 0.14], [0.5, 0.30, 0.22, 0.16],
            [0.25, 0.34, 0.26, 0.18], [0, 0.36, 0.30, 0.20], [-0.25, 0.34, 0.26, 0.18],
            [-0.5, 0.32, 0.22, 0.16], [-0.75, 0.26, 0.18, 0.14], [-1, 0.18, 0.12, 0.12]],
          section: { kind: 'ellipse', exp: 1.0 }, fenderClamp: 0.70
        },
        floor: { w: 0.7, h: 0.06, z: 0.05 }
      },
      wheelStyle: 'classicSpoke',
      canopy: { kind: 'speedster', scale: [0.18, 0.12, 0.34], z: 0.2, y: 0.44, halo: false },
      mounts: ['ducktail', 'exposedEngine', 'exhausts', 'chromeTrim'],
      palette: { glowI: 0.5, metalBias: 0.15 },
      gallery: { grad: 7, finish: 1 }
    }
  ];

  /* resolveSpec — which CarSpec to build for a given garage selection. P0: the locked preset for
     garage.form. (P3 will return a player's custom working spec when one is selected.) Always
     normalized so the renderer can trust it. */
  DD.resolveSpec = function (garage) {
    const presets = DD.CAR_PRESETS;
    const idx = ((garage && garage.form) | 0) % presets.length;
    const preset = presets[(idx + presets.length) % presets.length];
    // deep clone so the locked preset is never mutated, then normalize
    const spec = JSON.parse(JSON.stringify(preset));
    // honor the live garage paint/finish over the preset's gallery defaults
    if (garage) { spec.gallery = { grad: garage.grad | 0, finish: garage.finish | 0 }; }
    return DD.normalizeSpec(spec);
  };

})(typeof window !== 'undefined' ? window : globalThis);
