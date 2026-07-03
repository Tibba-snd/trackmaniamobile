/* DRIFTDREAM track generator — seeded piece-grammar -> sampled ribbon + ground-level terrain.
   Incremental integration with self-intersection avoidance. THREE-free. */
(function (global) {
  'use strict';
  const DD = global.DD;
  const V = DD.v;

  const DS = 2; // meters per sample
  DD.TRACK_DS = DS;

  DD.SURF = Object.assign(DD.SURF || {}, { NORMAL: 0, GLASS: 1, BOOST: 2, DIRT: 3 });

  const ARCHETYPES = ['speedway', 'technical', 'rhythm', 'drift', 'vertical', 'mixed'];

  const WEIGHTS = {
    speedway:  { straight: 3.0, sweeper: 2.5, banked: 2.0, boost: 2.0, kicker: 0.6, chicane: 0.5, hairpin: 0.2, glass: 0.4, weave: 0.5, crest: 1.0, wallride: 0.6, dip: 1.0, jumpgap: 0.8, tighten: 0.4 },
    technical: { straight: 0.8, sweeper: 1.0, banked: 0.6, boost: 0.5, kicker: 0.4, chicane: 2.2, hairpin: 2.0, glass: 1.0, weave: 2.0, crest: 0.6, wallride: 1.0, dip: 0.6, jumpgap: 0.3, tighten: 1.4 },
    rhythm:    { straight: 1.0, sweeper: 1.0, banked: 0.8, boost: 1.0, kicker: 2.0, chicane: 0.8, hairpin: 0.4, glass: 0.6, weave: 1.8, crest: 1.8, wallride: 0.6, dip: 1.5, jumpgap: 1.4, tighten: 0.5 },
    drift:     { straight: 1.0, sweeper: 2.6, banked: 1.4, boost: 0.8, kicker: 0.4, chicane: 0.8, hairpin: 1.5, glass: 0.8, weave: 1.2, crest: 0.6, wallride: 1.0, dip: 0.6, jumpgap: 0.3, tighten: 1.2 },
    vertical:  { straight: 0.8, sweeper: 1.2, banked: 1.4, boost: 1.0, kicker: 1.6, chicane: 0.6, hairpin: 0.5, glass: 0.5, weave: 0.8, crest: 2.0, wallride: 0.8, dip: 2.0, jumpgap: 1.2, tighten: 0.4 },
    mixed:     { straight: 1.2, sweeper: 1.2, banked: 1.0, boost: 0.8, kicker: 0.9, chicane: 1.0, hairpin: 0.8, glass: 0.8, weave: 1.0, crest: 1.0, wallride: 0.8, dip: 1.0, jumpgap: 0.7, tighten: 0.7 }
  };

  const RAIL_CHANCE = {
    straight: 0.65, sweeper: 0.8, banked: 0.7, boost: 0.7, kicker: 0, chicane: 0.85, hairpin: 0.9,
    glass: 0.9, weave: 0.8, crest: 0.45, wallride: 1, dip: 0.6, jumpgap: 0, tighten: 0.85
  };

  // expected corner speeds (m/s) — for braking-straight insertion
  const CORNER_V = { hairpin: 26, tighten: 30, chicane: 46, weave: 50, wallride: 44, glass: 34 };

  function makePieces(rng, tier) {
    const t01 = (tier - 1) / 4;
    const wBase = DD.lerp(13.5, 9, t01);
    const sharp = DD.lerp(0.75, 1.25, t01);
    const wVar = () => wBase * rng.range(0.8, 1.35);

    return {
      straight: () => {
        const len = rng.range(45, 150), w = wVar();
        return { name: 'straight', len, fn: () => ({ curv: 0, pitchT: 0, bankT: 0, widthT: w }) };
      },
      sweeper: () => {
        const dir = rng.sign(), ang = rng.range(0.6, 1.5), rad = rng.range(150, 290) / sharp;
        const len = ang * rad, w = wVar(), bank = rng.chance(0.35) ? rng.range(0.1, 0.25) : 0;
        return { name: 'sweeper', len, fn: () => ({ curv: dir / rad, pitchT: 0, bankT: dir * bank, widthT: w }) };
      },
      hairpin: () => {
        const dir = rng.sign(), ang = rng.range(2.4, 3.1), rad = rng.range(24, 40) / sharp;
        const len = ang * rad, w = wVar() * 1.25;
        return { name: 'hairpin', len, fn: () => ({ curv: dir / rad, pitchT: 0, bankT: 0, widthT: w }) };
      },
      tighten: () => {
        const dir = rng.sign(), r0 = rng.range(130, 190) / sharp, r1 = rng.range(40, 60) / sharp;
        const len = rng.range(85, 130), w = wVar();
        return { name: 'tighten', len, fn: (d) => {
          const t = d / len;
          const rad = DD.lerp(r0, r1, t);
          return { curv: dir / rad, pitchT: 0, bankT: 0, widthT: w * (1 - 0.15 * t) };
        } };
      },
      chicane: () => {
        const dir = rng.sign(), rad = rng.range(65, 105) / sharp, seg = rng.range(34, 52);
        const len = seg * 2, w = wVar() * 0.95;
        return { name: 'chicane', len, fn: (d) => ({ curv: (d < seg ? dir : -dir) / rad, pitchT: 0, bankT: 0, widthT: w }) };
      },
      banked: () => {
        const dir = rng.sign(), ang = rng.range(1.0, 2.0), rad = rng.range(90, 170) / sharp;
        const len = ang * rad, w = wVar() * 1.1, bank = rng.range(0.3, 0.55);
        return { name: 'banked', len, fn: () => ({ curv: dir / rad, pitchT: 0, bankT: dir * bank, widthT: w }) };
      },
      crest: () => {
        const len = rng.range(70, 110), w = wVar(), mag = rng.range(0.10, 0.20) * DD.lerp(0.8, 1.3, t01);
        return { name: 'crest', len, fn: (d) => {
          const t = d / len;
          return { curv: 0, pitchT: t < 0.4 ? mag : (t < 0.7 ? -mag : 0), bankT: 0, widthT: w };
        } };
      },
      dip: () => {
        const len = rng.range(70, 110), w = wVar(), mag = rng.range(0.10, 0.18);
        return { name: 'dip', len, fn: (d) => {
          const t = d / len;
          return { curv: 0, pitchT: t < 0.4 ? -mag : (t < 0.7 ? mag : 0), bankT: 0, widthT: w };
        } };
      },
      kicker: () => {
        const up = rng.range(0.18, 0.28);
        const lip = rng.range(10, 16), drop = rng.range(26, 40), out = rng.range(30, 50);
        const len = lip + drop + out, w = wVar() * 1.15;
        return { name: 'kicker', len, fn: (d) => {
          let pitchT;
          if (d < lip) pitchT = up;
          else if (d < lip + drop) pitchT = -up * 1.6;
          else pitchT = 0;
          return { curv: 0, pitchT, bankT: 0, widthT: w, snapPitch: d >= lip && d < lip + 6 };
        } };
      },
      jumpgap: () => {
        const up = rng.range(0.17, 0.24);
        const lip = 14, gapLen = rng.range(16, 26 + 8 * t01), land = 38;
        const len = lip + gapLen + land, w = wVar() * 1.1;
        return { name: 'jumpgap', len, fn: (d) => {
          if (d < lip) return { curv: 0, pitchT: up, bankT: 0, widthT: w, snapPitch: d > lip - 6 };
          if (d < lip + gapLen) return { curv: 0, pitchT: -0.13, bankT: 0, widthT: w * 1.3, gap: 1, snapPitch: d < lip + 8 };
          return { curv: 0, pitchT: 0, bankT: 0, widthT: w * 1.35, snapPitch: d < lip + gapLen + 6 };
        } };
      },
      glass: () => {
        const dir = rng.sign(), curved = rng.chance(0.5), rad = rng.range(240, 400);
        const len = rng.range(50, 90 + 40 * t01), w = wVar() * 1.1;
        return { name: 'glass', len, fn: () => ({ curv: curved ? dir / rad : 0, pitchT: 0, bankT: 0, widthT: w, surf: DD.SURF.GLASS }) };
      },
      boost: () => {
        const len = rng.range(60, 110), w = wVar();
        return { name: 'boost', len, fn: (d) => ({ curv: 0, pitchT: 0, bankT: 0, widthT: w, surf: (d > len * 0.15 && d < len * 0.7) ? DD.SURF.BOOST : 0 }) };
      },
      wallride: () => {
        const dir = rng.sign(), rad = rng.range(60, 120) / sharp, ang = rng.range(0.8, 1.6);
        const len = ang * rad, w = wBase * rng.range(0.7, 0.85);
        return { name: 'wallride', len, fn: () => ({ curv: dir / rad, pitchT: 0, bankT: 0, widthT: w, wall: 1 }) };
      },
      weave: () => {
        const dir = rng.sign(), rad = rng.range(80, 135) / sharp, seg = rng.range(36, 50), n = rng.int(3, 5);
        const len = seg * n, w = wVar() * 0.9;
        return { name: 'weave', len, fn: (d) => {
          const k = Math.floor(d / seg) % 2 === 0 ? dir : -dir;
          return { curv: k / rad, pitchT: 0, bankT: 0, widthT: w };
        } };
      }
    };
  }

  /* ---------------- terrain (heightfield that FOLLOWS the track) ---------------- */
  function noise2(seed, x, y) {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (seed | 0);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function valueNoise(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = noise2(seed, xi, yi), b = noise2(seed, xi + 1, yi);
    const c = noise2(seed, xi, yi + 1), d = noise2(seed, xi + 1, yi + 1);
    return DD.lerp(DD.lerp(a, b, sx), DD.lerp(c, d, sx), sy);
  }

  function buildTerrainData(samples, seedStr, theme) {
    const seed = DD.hashSeed(seedStr + '::terrain');
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9;
    for (const s of samples) { minX = Math.min(minX, s.p[0]); maxX = Math.max(maxX, s.p[0]); minZ = Math.min(minZ, s.p[2]); maxZ = Math.max(maxZ, s.p[2]); minY = Math.min(minY, s.p[1]); }
    const M = 340;
    minX -= M; maxX += M; minZ -= M; maxZ += M;

    const RES = 120;
    const stepX = (maxX - minX) / (RES - 1), stepZ = (maxZ - minZ) / (RES - 1);
    const amp = theme.terrainAmp;
    const ceiling = minY - 8;          // terrain top stays 8m below the lowest track point
    const floor = ceiling - amp * 2.2; // basin depth from rolling noise
    const heights = new Float32Array(RES * RES);
    let hMin = 1e9, hMax = -1e9;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const x = minX + i * stepX, z = minZ + j * stepZ;
        const xr = (x * 0.809 + z * 0.588) / 110, zr = (-x * 0.588 + z * 0.809) / 110;
        const nz = valueNoise(seed, x / 240, z / 240) * 0.7 + valueNoise(seed ^ 0x9e37, xr, zr) * 0.3;
        const hBase = floor + nz * (ceiling - floor);
        let h = hBase;
        if (theme.terraced) h = Math.round(h / 9) * 9 + (h - Math.round(h / 9) * 9) * 0.25;
        if (h > ceiling) h = ceiling;   // hard guarantee: never reaches the track

        // Track conforming: shape terrain to fit road where close, leave chasms for jumps/elevated bridges
        let minDistSq = 1e18;
        let nearestSample = null;
        // Search every 2nd sample for performance
        for (let sIdx = 0; sIdx < samples.length; sIdx += 2) {
          const s = samples[sIdx];
          const dx = x - s.p[0];
          const dz = z - s.p[2];
          const dSq = dx * dx + dz * dz;
          if (dSq < minDistSq) {
            minDistSq = dSq;
            nearestSample = s;
          }
        }

        if (nearestSample && !nearestSample.gap) {
          const dist = Math.sqrt(minDistSq);
          const roadEdge = nearestSample.w / 2 + 1.0;
          // Calculate lowest point of road cross section at this sample (accounting for banking tilt)
          const minRoadY = nearestSample.p[1] - Math.abs(nearestSample.r[1]) * (nearestSample.w / 2);
          const targetH = minRoadY - 0.85; // anchor below road bottom
          const heightDiff = targetH - h;
          if (heightDiff > 0) {
            const maxEmbankmentHeight = 16.0;
            const clampTargetH = Math.min(targetH, h + maxEmbankmentHeight);
            if (dist < roadEdge) {
              h = clampTargetH;
            } else if (dist < roadEdge + 32.0) {
              const t = (dist - roadEdge) / 32.0;
              const smoothT = t * t * (3 - 2 * t);
              h = DD.lerp(clampTargetH, h, smoothT);
            }
          }
        }

        // Bounded clearance check against all nearby samples to prevent spilling/clipping (crucial on banked curves)
        for (let sIdx = 0; sIdx < samples.length; sIdx += 2) {
          const s = samples[sIdx];
          const dx = x - s.p[0];
          const dz = z - s.p[2];
          const distSq = dx * dx + dz * dz;
          const roadEdge = s.w / 2 + 1.0;
          const limitDist = roadEdge + 10.0;
          if (distSq < limitDist * limitDist) {
            const minRoadY = s.p[1] - Math.abs(s.r[1]) * (s.w / 2);
            if (s.gap) {
              h = Math.min(h, s.p[1] - 12.0); // push down under gaps
            } else {
              h = Math.min(h, minRoadY - 1.25); // clear road edges on banking
            }
          }
        }

        heights[j * RES + i] = h;
        hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
      }
    }
    return { minX, minZ, stepX, stepZ, res: RES, heights, minH: hMin, maxH: hMax };
  }

  DD.terrainAt = function (T, x, z) {
    const fx = DD.clamp((x - T.minX) / T.stepX, 0, T.res - 1.001);
    const fz = DD.clamp((z - T.minZ) / T.stepZ, 0, T.res - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const H = T.heights, R = T.res;
    const a = H[j * R + i], b = H[j * R + i + 1], c = H[(j + 1) * R + i], d = H[(j + 1) * R + i + 1];
    return DD.lerp(DD.lerp(a, b, tx), DD.lerp(c, d, tx), tz);
  };
  DD.terrainNormal = function (T, x, z) {
    const e = 3;
    const hx1 = DD.terrainAt(T, x + e, z), hx0 = DD.terrainAt(T, x - e, z);
    const hz1 = DD.terrainAt(T, x, z + e), hz0 = DD.terrainAt(T, x, z - e);
    return V.norm([-(hx1 - hx0) / (2 * e), 1, -(hz1 - hz0) / (2 * e)]);
  };

  /* ---------------- main generator (incremental, collision-aware) ---------------- */
  DD.generateTrack = function (seedStr, tier, attempt) {
    tier = DD.clamp(tier | 0, 1, 5);
    const rng = DD.makeRng(seedStr + '::track::t' + tier + '::a' + (attempt || 0));
    const archetype = rng.pick(ARCHETYPES);
    const weights = WEIGHTS[archetype];
    const builders = makePieces(rng, tier);
    let targetLen = 1300 + tier * 230 + rng.range(-150, 200);
    const theme = DD.makeTheme(seedStr);

    // Closed-circuit decision on an ISOLATED rng stream: the main rng's draw sequence is
    // untouched, so seeds that stay point-to-point generate exactly the track they always did.
    // Loop tracks get a shorter per-lap budget (raced 2-3 times, total ≈ a sprint's length).
    const wantLoop = DD.makeRng(seedStr + '::loop::t' + tier + '::a' + (attempt || 0)).chance(0.55);
    if (wantLoop) targetLen *= 0.62;

    // occupancy grid for self-intersection avoidance
    const OC = 22;
    const occ = new Map();
    const okey = (cx, cz) => cx + ':' + cz;
    function collides(arr, baseIdx) {
      for (let i = 0; i < arr.length; i += 2) {
        const s = arr[i];
        const cx = Math.round(s.p[0] / OC), cz = Math.round(s.p[2] / OC);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const e = occ.get(okey(cx + dx, cz + dz));
          if (e && (baseIdx + i - e.idx) > 80 && Math.abs(s.p[1] - e.y) < 14) return true;
        }
      }
      return false;
    }
    function commit(arr, baseIdx) {
      for (let i = 0; i < arr.length; i += 2) {
        const s = arr[i];
        const key = okey(Math.round(s.p[0] / OC), Math.round(s.p[2] / OC));
        if (!occ.has(key)) occ.set(key, { idx: baseIdx + i, y: s.p[1] });
      }
    }

    // incremental integration
    let st = { pos: [0, 4, 0], yaw: 0, pitch: 0, bank: 0, width: 12 };
    function integratePiece(piece, st0) {
      const s1 = { pos: V.clone(st0.pos), yaw: st0.yaw, pitch: st0.pitch, bank: st0.bank, width: st0.width };
      const arr = [];
      const steps = Math.max(2, Math.round(piece.len / DS));
      for (let i = 0; i < steps; i++) {
        const d = (i / steps) * piece.len;
        const c = piece.fn(d);
        if (piece.bumpA) c.pitchT = (c.pitchT || 0) + Math.sin(d / piece.bumpW * Math.PI * 2 + piece.bumpP) * piece.bumpA;
        const k = 1 - Math.exp(-DS / 14);
        const kp = c.snapPitch ? 1 - Math.exp(-DS / 3) : 1 - Math.exp(-DS / 9);
        s1.pitch += ((c.pitchT || 0) - s1.pitch) * kp;
        s1.bank += ((c.bankT || 0) - s1.bank) * k;
        s1.width += ((c.widthT || 12) - s1.width) * k;
        let pitchEff = s1.pitch;
        if (s1.pos[1] < 2) pitchEff += 0.022;
        if (s1.pos[1] > 55) pitchEff -= 0.022;
        s1.yaw += (c.curv || 0) * DS;
        const cosP = Math.cos(pitchEff);
        const f = [Math.sin(s1.yaw) * cosP, Math.sin(pitchEff), Math.cos(s1.yaw) * cosP];
        s1.pos = V.addS(s1.pos, f, DS);
        arr.push({ p: V.clone(s1.pos), yaw: s1.yaw, pitch: pitchEff, bank: s1.bank, w: s1.width, surf: c.surf || 0, wall: c.wall ? 1 : (piece.rail && !c.gap ? 1 : 0), gap: c.gap ? 1 : 0, pieceName: piece.name });
      }
      return { arr, st: s1 };
    }

    const samples = [];
    const pieceSpans = [];
    const ckpts = [];
    let total = 0, dist = 0, distSinceCkpt = 0, overlapForced = 0;
    let nextCkptAt = 340 + rng.range(0, 120);
    let lastName = '', lastSpecial = -999, vEst = 20;

    function decorate(p, name) {
      p.rail = rng.chance(RAIL_CHANCE[name] != null ? RAIL_CHANCE[name] : 0.7);
      if (['straight', 'sweeper', 'weave', 'boost', 'chicane', 'banked'].includes(name) && !p.brakingZone && rng.chance(0.65)) {
        p.bumpA = rng.range(0.015, 0.05) + (tier - 1) * 0.005;
        p.bumpW = rng.range(22, 55);
        p.bumpP = rng.range(0, Math.PI * 2);
      }
      return p;
    }

    function appendPiece(piece, name, allowCkpt) {
      // collision-aware: re-roll up to 3 alternates if this geometry hits existing track
      const candidates = [piece];
      candidates.push(decorate(builders[name](), name));
      candidates.push(decorate(builders.straight(), 'straight'));
      candidates.push(decorate(builders.sweeper(), 'sweeper'));
      let chosen = null, result = null;
      for (const cand of candidates) {
        const r = integratePiece(cand, st);
        if (!collides(r.arr, samples.length)) { chosen = cand; result = r; break; }
      }
      if (!chosen) { // give up gracefully: accept and flag (validator will regenerate)
        chosen = candidates[0];
        result = integratePiece(chosen, st);
        overlapForced++;
      }
      const startSample = samples.length;
      commit(result.arr, samples.length);
      for (const s of result.arr) samples.push(s);
      st = result.st;
      const lenReal = result.arr.length * DS;
      total += lenReal; dist += lenReal; distSinceCkpt += lenReal;
      pieceSpans.push({ name: chosen.name, start: startSample, end: samples.length });
      if (allowCkpt && distSinceCkpt > nextCkptAt && chosen.name !== 'jumpgap') {
        ckpts.push(samples.length - 1);
        distSinceCkpt = 0;
        nextCkptAt = 340 + rng.range(0, 120);
      }
      return chosen.name;
    }

    // opening straight
    {
      const p = builders.straight(); p.len = Math.max(p.len, 80); p.rail = true;
      appendPiece(p, 'straight', false);
      lastName = 'straight';
    }

    let guard = 0;
    let hasSignature = false;
    let forcedQueue = [];
    const signatures = ['gorge', 'corkscrew', 'ice_slalom'];
    let signatureType = signatures[rng.int(0, signatures.length - 1) % signatures.length];

    if (seedStr.startsWith('CAMP-')) {
      const match = seedStr.match(/CAMP-T(\d+)-/);
      if (match) {
        const tNum = parseInt(match[1], 10);
        if (tNum === 1) signatureType = 'gorge';
        else if (tNum === 2) signatureType = 'corkscrew';
        else if (tNum === 3) signatureType = 'gorge';
        else if (tNum === 4) signatureType = 'ice_slalom';
        else if (tNum === 5) signatureType = 'void_extreme';
      }
    }

    while (total < targetLen && guard++ < 220) {
      // loop tracks: stop the grammar when the remaining budget is roughly what the closure
      // path home will cost (straight-line distance + arc overhead) — never mid-signature
      if (wantLoop && hasSignature && forcedQueue.length === 0 && total > targetLen * 0.45) {
        const dHome = Math.hypot(st.pos[0], st.pos[2]);
        if (total + dHome + 320 >= targetLen) break;
      }
      let name;
      if (forcedQueue.length > 0) {
        name = forcedQueue.shift();
      } else {
        const progress = total / targetLen;
        if (progress >= 0.4 && !hasSignature) {
          hasSignature = true;
          if (signatureType === 'gorge') {
            forcedQueue = ['boost', 'kicker', 'jumpgap', 'straight'];
          } else if (signatureType === 'corkscrew') {
            forcedQueue = ['boost', 'wallride', 'banked', 'straight'];
          } else if (signatureType === 'ice_slalom') {
            forcedQueue = ['glass', 'chicane', 'weave', 'straight'];
          } else if (signatureType === 'void_extreme') {
            forcedQueue = ['boost', 'wallride', 'boost', 'kicker', 'jumpgap', 'straight'];
          }
          name = forcedQueue.shift();
        } else {
          // Pacing curve weight adjustments
          let activeWeights = Object.assign({}, weights);
          if (progress < 0.3) {
            // Flowing start
            activeWeights.straight = (activeWeights.straight || 1) * 2.0;
            activeWeights.sweeper = (activeWeights.sweeper || 1) * 1.5;
            activeWeights.hairpin = (activeWeights.hairpin || 1) * 0.15;
            activeWeights.tighten = (activeWeights.tighten || 1) * 0.15;
            activeWeights.chicane = (activeWeights.chicane || 1) * 0.3;
          } else if (progress < 0.75) {
            // Technical middle
            activeWeights.hairpin = (activeWeights.hairpin || 1) * 1.8;
            activeWeights.tighten = (activeWeights.tighten || 1) * 1.8;
            activeWeights.chicane = (activeWeights.chicane || 1) * 1.5;
            activeWeights.straight = (activeWeights.straight || 1) * 0.5;
          } else {
            // Fast finish
            activeWeights.straight = (activeWeights.straight || 1) * 2.5;
            activeWeights.boost = (activeWeights.boost || 1) * 2.0;
            activeWeights.sweeper = (activeWeights.sweeper || 1) * 1.5;
            activeWeights.hairpin = (activeWeights.hairpin || 1) * 0.1;
            activeWeights.tighten = (activeWeights.tighten || 1) * 0.1;
          }
          const pairs = Object.keys(activeWeights).map(k => [k, activeWeights[k]]);
          name = rng.weighted(pairs);
        }
      }

      if (lastName === 'glass' || lastName === 'kicker' || lastName === 'jumpgap') name = 'straight';
      if (name === lastName && (name === 'hairpin' || name === 'glass' || name === 'kicker' || name === 'boost' || name === 'jumpgap' || name === 'tighten')) name = 'straight';
      if ((name === 'glass' || name === 'boost' || name === 'wallride' || name === 'jumpgap') && total - lastSpecial < 180) name = 'sweeper';
      if ((lastName === 'crest' || lastName === 'dip') && (name === 'hairpin' || name === 'tighten')) name = 'sweeper';

      // anticipation: braking straight before sharp stuff arriving fast
      const vc = CORNER_V[name];
      if (vc != null && vc < vEst - 12) {
        const need = (vEst * vEst - vc * vc) / (2 * 30);
        const bp = builders.straight();
        bp.len = DD.clamp(need * 0.75, 45, 170);
        bp.rail = rng.chance(0.75);
        bp.brakingZone = true;
        appendPiece(bp, 'straight', true);
      }

      const p = decorate(builders[name](), name);
      if (name === 'glass' || name === 'boost' || name === 'wallride' || name === 'kicker' || name === 'jumpgap') lastSpecial = total;
      const placed = appendPiece(p, name, true);
      lastName = placed;

      const vcP = CORNER_V[placed];
      if (vcP != null) vEst = vcP;
      else if (placed === 'straight' || placed === 'boost') vEst = Math.min(95, vEst + p.len * 0.22);
      else vEst = Math.min(92, vEst + p.len * 0.1);
    }
    /* ---------------- loop closure (closed circuits / multilap) ----------------
       Dubins CSC path (arc–straight–arc, comfortable radius) from the grammar's end state back
       to the origin state ([0,4,0], yaw 0) — the same primitive family the grammar itself uses,
       so a closure reads like any other sweeper+straight section. Vertical closure = a per-step
       glide-slope controller toward y=4. Deterministic: fixed radius candidates, shortest
       feasible variant, no rng. Falls back to the classic open sprint when every candidate
       collides with mid-track geometry. */
    const mod2pi = (a) => { a = a % (Math.PI * 2); return a < 0 ? a + Math.PI * 2 : a; };

    // heading-space: dir(θ) = (sinθ, cosθ) in xz; left turn (curv>0) center at p + R·(cosθ,−sinθ)
    function dubinsCSC(x0, z0, th0, R) {
      const paths = [];
      const cL0 = [x0 + R * Math.cos(th0), z0 - R * Math.sin(th0)];
      const cR0 = [x0 - R * Math.cos(th0), z0 + R * Math.sin(th0)];
      const cL1 = [R * Math.cos(0), -R * Math.sin(0)];  // target: origin, θ=0
      const cR1 = [-R * Math.cos(0), R * Math.sin(0)];
      const add = (dir0, dir1, c0, c1, inner) => {
        const Dx = c1[0] - c0[0], Dz = c1[1] - c0[1];
        const d = Math.hypot(Dx, Dz);
        let ths;
        if (!inner) {
          if (d < 1e-6) return;
          ths = Math.atan2(Dx, Dz);
        } else {
          if (d < 2 * R + 1e-6) return;
          const psi = Math.atan2(Dx, Dz);
          // LSR: sin(ψ−θs) = −2R/d → θs = ψ + asin(2R/d);  RSL: θs = ψ − asin(2R/d)
          ths = dir0 > 0 ? psi + Math.asin(2 * R / d) : psi - Math.asin(2 * R / d);
        }
        const s = inner ? Math.sqrt(Math.max(0, d * d - 4 * R * R)) : d;
        const d0 = dir0 > 0 ? mod2pi(ths - th0) : mod2pi(th0 - ths);
        const d1 = dir1 > 0 ? mod2pi(0 - ths) : mod2pi(ths - 0);
        paths.push({ R, dir0, dir1, d0, d1, s, len: R * (d0 + d1) + s });
      };
      add(+1, +1, cL0, cL1, false); // LSL
      add(-1, -1, cR0, cR1, false); // RSR
      add(+1, -1, cL0, cR1, true);  // LSR
      add(-1, +1, cR0, cL1, true);  // RSL
      paths.sort((a, b) => a.len - b.len);
      return paths;
    }

    // analytic endpoint of a CSC path from (x,z,θ) — used to reject any variant whose closed
    // form doesn't land at the origin (guards the sign conventions above forever)
    function cscEndpoint(x, z, th, path) {
      const arc = (x, z, th, dir, sweep) => {
        const cx = x + path.R * Math.cos(th) * dir, cz = z - path.R * Math.sin(th) * dir;
        const th1 = th + dir * sweep;
        return [cx - path.R * Math.cos(th1) * dir, cz + path.R * Math.sin(th1) * dir, th1];
      };
      let [ax, az, ath] = arc(x, z, th, path.dir0, path.d0);
      ax += Math.sin(ath) * path.s; az += Math.cos(ath) * path.s;
      return arc(ax, az, ath, path.dir1, path.d1);
    }

    // integrate a CSC path into ribbon samples with vertical closure toward y=4. Two passes:
    // the second injects the measured yaw drift correction; the position residual is then
    // sheared out linearly so the final sample lands EXACTLY one DS before samples[0].
    function integrateClosure(path, st0, targetW) {
      const totalLen = path.len;
      const run = (yawCorrPerStep) => {
        const arr = [];
        const s1 = { pos: V.clone(st0.pos), yaw: st0.yaw, pitch: st0.pitch, bank: st0.bank, width: st0.width };
        let traveled = 0;
        const segs = [
          { curv: path.dir0 / path.R, len: path.R * path.d0 },
          { curv: 0, len: path.s },
          { curv: path.dir1 / path.R, len: path.R * path.d1 }
        ];
        for (const seg of segs) {
          const steps = Math.max(1, Math.round(seg.len / DS));
          for (let i = 0; i < steps; i++) {
            const remaining = Math.max(totalLen - traveled, DS);
            const dy = 4 - s1.pos[1];
            const pitchT = DD.clamp(Math.asin(DD.clamp(dy / remaining, -0.99, 0.99)), -0.135, 0.135);
            s1.pitch += (pitchT - s1.pitch) * (1 - Math.exp(-DS / 9));
            const k = 1 - Math.exp(-DS / 14);
            s1.bank += (0 - s1.bank) * k;
            s1.width += (targetW - s1.width) * k;
            s1.yaw += seg.curv * DS + yawCorrPerStep;
            const cosP = Math.cos(s1.pitch);
            const f = [Math.sin(s1.yaw) * cosP, Math.sin(s1.pitch), Math.cos(s1.yaw) * cosP];
            s1.pos = V.addS(s1.pos, f, DS);
            arr.push({ p: V.clone(s1.pos), yaw: s1.yaw, pitch: s1.pitch, bank: s1.bank, w: s1.width, surf: 0, wall: 1, gap: 0, pieceName: seg.curv !== 0 ? 'sweeper' : 'straight' });
            traveled += DS;
          }
        }
        return arr;
      };
      let arr = run(0);
      const yawErr = DD.angleDiff(arr[arr.length - 1].yaw, 0);
      arr = run(yawErr / arr.length);
      // shear the whole closure so the endpoint is exact (residual is a few meters over
      // hundreds — sub-degree bending per sample)
      const end = arr[arr.length - 1].p;
      const err = [0 - end[0], 4 - end[1], 0 - end[2]];
      for (let i = 0; i < arr.length; i++) {
        const t = (i + 1) / arr.length;
        arr[i].p = V.addS(arr[i].p, err, t);
      }
      return arr;
    }

    // occupancy check for the closure: same rule as collides(), but entries near the START
    // (idx < 60) are the closure's legitimate destination, not a crossing
    function closureCollides(arr, baseIdx) {
      for (let i = 0; i < arr.length; i += 2) {
        const s = arr[i];
        const cx = Math.round(s.p[0] / OC), cz = Math.round(s.p[2] / OC);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const e = occ.get(okey(cx + dx, cz + dz));
          if (e && e.idx >= 60 && (baseIdx + i - e.idx) > 80 && Math.abs(s.p[1] - e.y) < 14) return true;
        }
      }
      return false;
    }

    let closed = false;
    if (wantLoop) {
      const targetW = samples[0].w;
      const RADII = [85, 60, 115, 72, 140, 50];
      outer: for (const R of RADII) {
        for (const path of dubinsCSC(st.pos[0], st.pos[2], st.yaw, R)) {
          const [ex, ez, eth] = cscEndpoint(st.pos[0], st.pos[2], st.yaw, path);
          if (Math.hypot(ex, ez) > 0.5 || Math.abs(DD.angleDiff(eth, 0)) > 0.02) continue; // sign-guard
          if (path.len < 60) continue; // too short to descend/settle
          const arr = integrateClosure(path, st, targetW);
          if (closureCollides(arr, samples.length)) continue;
          const startSample = samples.length;
          commit(arr, samples.length);
          for (const s of arr) samples.push(s);
          const lenReal = arr.length * DS;
          total += lenReal; dist += lenReal;
          pieceSpans.push({ name: 'closure', start: startSample, end: samples.length });
          // closures can run 300-900m — keep respawn gates coming at the usual cadence
          // (stay clear of the seam: the finish filter needs c < finishIdx - 20)
          let sinceCkpt = distSinceCkpt;
          for (let ci = startSample; ci < samples.length - 40; ci++) {
            sinceCkpt += DS;
            if (sinceCkpt > nextCkptAt) {
              ckpts.push(ci);
              sinceCkpt = 0;
              nextCkptAt = 340 + rng.range(0, 120);
            }
          }
          closed = true;
          break outer;
        }
      }
    }
    if (!closed) {
      // classic open sprint: closing straight
      const p = builders.straight(); p.len = 70; p.rail = true;
      appendPiece(p, 'straight', false);
    }

    // --- frames ---
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const pNext = (i < samples.length - 1) ? samples[i + 1].p
        : (closed ? samples[0].p : V.add(s.p, V.sub(s.p, samples[i - 1].p)));
      let f = V.norm(V.sub(pNext, s.p));
      let r0 = V.norm(V.cross([0, 1, 0], f));
      if (!isFinite(r0[0]) || V.lenSq(r0) < 1e-6) r0 = [1, 0, 0];
      let u0 = V.norm(V.cross(f, r0));
      if (u0[1] < 0) { u0 = V.scale(u0, -1); r0 = V.scale(r0, -1); }
      const b = s.bank;
      const u = V.norm(V.addS(V.scale(u0, Math.cos(b)), r0, Math.sin(b)));
      const r = V.norm(V.cross(u, f));
      s.f = f; s.u = u; s.r = r;
    }

    const startIdx = 2;
    // closed circuits: the finish line IS the start line (one lap = the whole sample loop);
    // open sprints keep the classic near-the-end finish
    const finishIdx = closed ? samples.length - 2 : samples.length - 3;
    // lap count from lap length so total race distance stays in sprint territory
    const laps = closed ? (dist < 1350 ? 3 : 2) : 1;

    // --- detect sharp corners (for signage/beacons) ---
    const corners = [];
    {
      let i = 0;
      while (i < samples.length - 6) {
        const c0 = DD.angleDiff(samples[i].yaw, samples[i + 4].yaw) / (4 * DS);
        if (Math.abs(c0) > 1 / 75 && samples[i].pieceName !== 'wallride') {
          const entry = i;
          let minRad = 1e9;
          while (i < samples.length - 6) {
            const c2 = DD.angleDiff(samples[i].yaw, samples[i + 4].yaw) / (4 * DS);
            if (Math.abs(c2) < 1 / 95) break;
            minRad = Math.min(minRad, 1 / Math.abs(c2));
            i += 4;
          }
          if (minRad < 110 && i - entry >= 6) {
            const sE = samples[entry], sM = samples[Math.min(Math.floor((entry + i) / 2), samples.length - 1)];
            const latDisp = V.dot(V.sub(sM.p, sE.p), sE.r);
            corners.push({ entry, end: i, apex: Math.floor((entry + i) / 2), minRad, insideSign: Math.sign(latDisp) || 1 });
          }
        } else i += 4;
      }
    }

    const track = {
      seed: seedStr, tier, archetype,
      samples, ds: DS,
      checkpoints: ckpts.filter(c => c > startIdx + 20 && c < finishIdx - 20),
      startIdx, finishIdx,
      closed, laps,
      length: dist,
      pieceSpans,
      corners,
      overlapForced,
      theme
    };
    track.terrain = buildTerrainData(samples, seedStr, theme);
    return track;
  };

  DD.trackQuery = function (track, pos, lastIdx) {
    const ss = track.samples;
    const n = ss.length;
    let best = -1, bestD = Infinity;
    if (track.closed) {
      // circuits: the search window wraps across the start/finish seam
      for (let o = -8; o <= 26; o++) {
        const i = (lastIdx + o + n) % n;
        const d = V.distSq(ss[i].p, pos);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    const lo = Math.max(0, lastIdx - 8), hi = Math.min(n - 1, lastIdx + 26);
    for (let i = lo; i <= hi; i++) {
      const d = V.distSq(ss[i].p, pos);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

})(typeof window !== 'undefined' ? window : globalThis);
