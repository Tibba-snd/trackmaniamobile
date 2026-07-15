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
    speedway:  { straight: 3.0, sweeper: 2.5, banked: 2.0, boost: 2.0, kicker: 0.6, chicane: 0.5, hairpin: 0.2, glass: 0.4, weave: 0.5, crest: 1.0, wallride: 0.6, dip: 1.0, jumpgap: 0.8, tighten: 0.4, bowl: 0.5, overunder: 0.2 },
    technical: { straight: 0.8, sweeper: 1.0, banked: 0.6, boost: 0.5, kicker: 0.4, chicane: 2.2, hairpin: 2.0, glass: 1.0, weave: 2.0, crest: 0.6, wallride: 1.0, dip: 0.6, jumpgap: 0.3, tighten: 1.4, overunder: 0.5, corkscrew: 0.3 },
    rhythm:    { straight: 1.0, sweeper: 1.0, banked: 0.8, boost: 1.0, kicker: 2.0, chicane: 0.8, hairpin: 0.4, glass: 0.6, weave: 1.8, crest: 1.8, wallride: 0.6, dip: 1.5, jumpgap: 1.4, tighten: 0.5, bigjump: 0.2, ridge: 1.2, dirtcut: 0.6 },
    drift:     { straight: 1.0, sweeper: 2.6, banked: 1.4, boost: 0.8, kicker: 0.4, chicane: 0.8, hairpin: 1.5, glass: 0.8, weave: 1.2, crest: 0.6, wallride: 1.0, dip: 0.6, jumpgap: 0.3, tighten: 1.2, bowl: 1.2, dirtcut: 0.5, ridge: 0.4 },
    vertical:  { straight: 0.8, sweeper: 1.2, banked: 1.4, boost: 1.0, kicker: 1.6, chicane: 0.6, hairpin: 0.5, glass: 0.5, weave: 0.8, crest: 2.0, wallride: 0.8, dip: 2.0, jumpgap: 1.2, tighten: 0.4, bigjump: 0.3, corkscrew: 1.2, overunder: 0.8, ridge: 0.5 },
    mixed:     { straight: 1.2, sweeper: 1.2, banked: 1.0, boost: 0.8, kicker: 0.9, chicane: 1.0, hairpin: 0.8, glass: 0.8, weave: 1.0, crest: 1.0, wallride: 0.8, dip: 1.0, jumpgap: 0.7, tighten: 0.7, bigjump: 0.15, corkscrew: 0.3, bowl: 0.4, overunder: 0.3, ridge: 0.4, dirtcut: 0.35 }
  };

  const RAIL_CHANCE = {
    straight: 0.65, sweeper: 0.8, banked: 0.7, boost: 0.7, kicker: 0, chicane: 0.85, hairpin: 0.9,
    glass: 0.9, weave: 0.8, crest: 0.45, wallride: 1, dip: 0.6, jumpgap: 0, bigjump: 0, tighten: 0.85,
    corkscrew: 0.95, bowl: 0, overunder: 0.95, ridge: 0.3, dirtcut: 0 // bowl carries wall:1 itself
  };

  // expected corner speeds (m/s) — for braking-straight insertion
  const CORNER_V = { hairpin: 26, tighten: 30, chicane: 46, weave: 50, wallride: 44, glass: 34, corkscrew: 27, overunder: 32, bowl: 56, dirtcut: 42 };

  function makePieces(rng, tier, seedStr) {
    const t01 = (tier - 1) / 4;
    // T1: wider tracks for creative driving. Old 13.5->9 left tight T5 corners as narrow as
    // 7.2m (9*0.8) — drifting a rear-end-out at 250 km/h hit the fence almost every corner.
    // New 20->14 with a higher wVar floor (0.92) keeps the tier skill curve (T1 widest, T5
    // tighter) while giving every piece enough runoff to drift through.
    const wBase = DD.lerp(20, 14, t01);
    const sharp = DD.lerp(0.75, 1.25, t01);
    const wVar = () => wBase * rng.range(0.92, 1.35);
    let ck3N = 0, bw3N = 0, ou3N = 0, rg3N = 0, dc3N = 0; // phase-3 piece occurrence counters (derived-stream variety)

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
        // T1: hairpins get extra runoff (1.25 -> 1.45) for drift entry/exit.
        const len = ang * rad, w = wVar() * 1.45;
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
        // C-infinity pitch pulse (rise then fall) instead of hard step targets — the old
        // t<0.4/t<0.7 steps kinked the pitch derivative at the seams = the visible vertical crease.
        return { name: 'crest', len, fn: (d) => {
          const t = d / len;
          return { curv: 0, pitchT: mag * Math.sin(t * Math.PI * 2), bankT: 0, widthT: w };
        } };
      },
      dip: () => {
        const len = rng.range(70, 110), w = wVar(), mag = rng.range(0.10, 0.18);
        return { name: 'dip', len, fn: (d) => {
          const t = d / len;
          return { curv: 0, pitchT: -mag * Math.sin(t * Math.PI * 2), bankT: 0, widthT: w };
        } };
      },
      kicker: () => {
        const up = rng.range(0.18, 0.28);
        const lip = rng.range(10, 16), drop = rng.range(26, 40), out = rng.range(30, 50);
        const len = lip + drop + out, w = wVar() * 1.5;
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
        const len = lip + gapLen + land, w = wVar() * 1.5;
        return { name: 'jumpgap', len, fn: (d) => {
          if (d < lip) return { curv: 0, pitchT: up, bankT: 0, widthT: w, snapPitch: d > lip - 6 };
          if (d < lip + gapLen) return { curv: 0, pitchT: -0.13, bankT: 0, widthT: w * 1.3, gap: 1, snapPitch: d < lip + 8 };
          return { curv: 0, pitchT: 0, bankT: 0, widthT: w * 1.35, snapPitch: d < lip + gapLen + 6 };
        } };
      },
      bigjump: () => {
        const jRng = DD.makeRng(seedStr + '::bigjump');
        const up = 0.22;
        const lip = jRng.range(25, 35);
        const gapLen = jRng.range(40, 70 + 15 * t01);
        const land = 48;
        const len = lip + gapLen + land;
        const w = wBase;
        return { name: 'bigjump', len, fn: (d) => {
          if (d < lip) return { curv: 0, pitchT: up, bankT: 0, widthT: w, snapPitch: d > lip - 8 };
          if (d < lip + gapLen) return { curv: 0, pitchT: -0.15, bankT: 0, widthT: w * 1.6, gap: 1, snapPitch: d < lip + 8 };
          const landD = d - (lip + gapLen);
          const pitch = -0.15 * (1.0 - DD.clamp(landD / land, 0, 1));
          return { curv: 0, pitchT: pitch, bankT: 0, widthT: w * 1.6, snapPitch: landD < 12, landing: 1 };
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
        // T1: wallride was NARROWER than normal (0.7-0.85x) — backwards for a commitment piece.
        // Wider (1.05-1.2x) so you have room. (T8 adds real banking on top of this width.)
        const len = ang * rad, w = wBase * rng.range(1.05, 1.2);
        return { name: 'wallride', len, fn: () => ({ curv: dir / rad, pitchT: 0, bankT: dir * rng.range(0.4, 0.7), widthT: w, wall: 1 }) };
      },
      weave: () => {
        const dir = rng.sign(), rad = rng.range(80, 135) / sharp, seg = rng.range(36, 50), n = rng.int(3, 5);
        const len = seg * n, w = wVar() * 0.9;
        return { name: 'weave', len, fn: (d) => {
          const k = Math.floor(d / seg) % 2 === 0 ? dir : -dir;
          return { curv: k / rad, pitchT: 0, bankT: 0, widthT: w };
        } };
      },
      /* ---- Phase 3.1 pieces — params from DERIVED streams (seed::name::occurrence), so the
         piece's internals never consume main-rng draws; the selection draw is the only main
         cost, same as every other piece. Occurrence counter keeps repeats varied. */
      corkscrew: () => {
        const r2 = DD.makeRng(seedStr + '::corkscrew::' + (ck3N++));
        // tight spiral: loop diameter 48-68 m — mid-track signature placement needs to CLEAR
        // earlier geometry (delivery rate died at rad 30-42)
        const dir = r2.sign(), ang = r2.range(4.7, 7.6), rad = r2.range(22, 30) / sharp;
        const climb = r2.sign();
        // one full loop MUST clear its own entry corridor (collision grid wants |dY| >= 14):
        // floor the pitch at 17 m per 2*pi*rad of arc, plus the draw for variety above it
        const pitch = climb * Math.max(r2.range(0.10, 0.14), 17 / (2 * Math.PI * rad));
        const bank = dir * r2.range(0.15, 0.3);
        const len = ang * rad, w = wBase * 1.05;
        return { name: 'corkscrew', len, fn: () => ({ curv: dir / rad, pitchT: pitch, bankT: bank, widthT: w }) };
      },
      bowl: () => {
        const r2 = DD.makeRng(seedStr + '::bowl::' + (bw3N++));
        const dir = r2.sign(), ang = r2.range(2.4, 3.14), rad = r2.range(68, 100) / sharp;
        const bank = dir * r2.range(0.5, 0.7);
        const len = ang * rad, w = wBase * 1.35;
        // wall:1 = half-pipe rails both sides (railWall renders both when s.wall)
        return { name: 'bowl', len, fn: () => ({ curv: dir / rad, pitchT: 0, bankT: bank, widthT: w, wall: 1 }) };
      },
      overunder: () => {
        // climbing return-hook: turns 150-210 deg back across where you came from while gaining
        // ~16-24 m — the collision grid ALLOWS the re-cross once dY >= 14, so the path legally
        // bridges its own earlier corridor (probabilistic crossing; a miss is still a dramatic
        // climbing hook). Exit levels off pointing back-ish; the grammar takes it from there.
        const r2 = DD.makeRng(seedStr + '::overunder::' + (ou3N++));
        const dir = r2.sign(), ang = r2.range(2.6, 3.6), rad = r2.range(46, 70) / sharp;
        const pitch = r2.range(0.11, 0.14);
        const turnLen = ang * rad, out = 34;
        const len = turnLen + out, w = wBase * 1.1;
        return { name: 'overunder', len, fn: (d) => {
          if (d < turnLen) return { curv: dir / rad, pitchT: pitch, bankT: dir * 0.15, widthT: w };
          return { curv: 0, pitchT: -0.05, bankT: 0, widthT: w };
        } };
      },
      ridge: () => {
        const r2 = DD.makeRng(seedStr + '::ridge::' + (rg3N++));
        const dir = r2.sign(), rad = r2.range(380, 650), len = r2.range(90, 150);
        const mag = r2.range(0.04, 0.07);
        const w = wVar() * 0.95;
        // s.ridge -> terrain uplift pulled TIGHT both sides (canyon-rim feel, see buildTerrainData)
        return { name: 'ridge', len, fn: (d) => {
          const t = d / len;
          return { curv: dir / rad, pitchT: mag * Math.sin(t * Math.PI * 2), bankT: 0, widthT: w, ridge: 1 };
        } };
      },
      dirtcut: () => {
        const r2 = DD.makeRng(seedStr + '::dirtcut::' + (dc3N++));
        const curved = r2.chance(0.5), dir = r2.sign(), rad = r2.range(250, 420);
        const len = r2.range(70, 130), w = wVar() * 1.15;
        return { name: 'dirtcut', len, fn: () => ({ curv: curved ? dir / rad : 0, pitchT: 0, bankT: 0, widthT: w, surf: DD.SURF.DIRT }) };
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

  // per-biome landform uplift beyond the safety corridor (m above the local basin) — the
  // world stopped being a uniform sunken plane in session 22: terrain follows the LOCAL road
  // height and may rise to/above track level once it's laterally clear of the racing corridor
  const TERRAIN_RISE = { dune: 20, neon: 6, canyon: 48, frozen: 32 };

  function buildTerrainData(samples, seedStr, theme, shortcuts, playgrounds) {
    const seed = DD.hashSeed(seedStr + '::terrain');
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9;
    for (const s of samples) { minX = Math.min(minX, s.p[0]); maxX = Math.max(maxX, s.p[0]); minZ = Math.min(minZ, s.p[2]); maxZ = Math.max(maxZ, s.p[2]); minY = Math.min(minY, s.p[1]); }
    const M = 340;
    minX -= M; maxX += M; minZ -= M; maxZ += M;

    const RES = 120;
    const stepX = (maxX - minX) / (RES - 1), stepZ = (maxZ - minZ) / (RES - 1);
    const amp = theme.terrainAmp;
    const riseMax = TERRAIN_RISE[theme.biome] != null ? TERRAIN_RISE[theme.biome] : 16;
    const heights = new Float32Array(RES * RES);
    let hMin = 1e9, hMax = -1e9;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const x = minX + i * stepX, z = minZ + j * stepZ;

        // ONE pass over the samples: nearest sample (for the local reference height + the
        // embankment conforming) AND the hard clearance clamp from every sample whose safety
        // radius covers this cell. (Was two full scans — this is the documented load hotspot.)
        let minDistSq = 1e18;
        let nearestSample = null;
        let clampY = 1e9;
        let deckCapY = 1e9; // hard under-deck ceiling — applied LAST, even after the carve
        for (let sIdx = 0; sIdx < samples.length; sIdx += 2) {
          const s = samples[sIdx];
          const dx = x - s.p[0];
          const dz = z - s.p[2];
          const dSq = dx * dx + dz * dz;
          if (dSq < minDistSq) { minDistSq = dSq; nearestSample = s; }
          const roadEdge = s.w / 2 + 1.0;
          const limitDist = roadEdge + 10.0;
          if (!s.gap && dSq < roadEdge * roadEdge) {
            deckCapY = Math.min(deckCapY, s.p[1] - Math.abs(s.r[1]) * (s.w / 2) - 0.08);
          }
          if (dSq < limitDist * limitDist) {
            if (s.gap) {
              clampY = Math.min(clampY, s.p[1] - 12.0); // chasm under gaps
            } else {
              const minRoadY = s.p[1] - Math.abs(s.r[1]) * (s.w / 2);
              // apron spans (masterplan 2.1): on the apron SIDE the safety clamp steps aside —
              // the clamp is a MIN over ±~9 samples, so on undulating (bumpA) straights trough
              // samples would drag crest-side shelf cells ~1 m below flush. The conform target
              // (nearest sample, exact) shapes apron terrain; allow up to 1.5 m above each
              // sample's own edge so neighbours can't re-ledge the shelf. apronReach = flag
              // blurred ±12 samples (the clamp radius), full strength.
              const ap = s.apronReach || 0;
              if (ap && (dx * s.r[0] + dz * s.r[2]) * ap > 0) {
                // apron SIDE: relaxed for the flush shelf, capped at the LOCAL road max
                // (apronCapY) so bumpA troughs can't re-ledge their crest neighbours' shelf —
                // but never above this road's own deck line
                clampY = Math.min(clampY, s.apronCapY);
              } else if (ap && dSq < roadEdge * roadEdge) {
                // UNDER the deck near an apron: flush against this sample's own edge (kills the
                // bilinear bleed on narrow decks) but never above the deck surface itself
                clampY = Math.min(clampY, minRoadY - 0.08);
              } else {
                clampY = Math.min(clampY, minRoadY - 1.25); // clear road edges on banking
              }
            }
          }
        }

        // base field referenced to the LOCAL road height (terrain follows the track
        // vertically); elevated sections keep proportionally more air underneath so bridges
        // still fly over a drop instead of dragging the world up with them
        const dist = Math.sqrt(minDistSq);
        const roadY = nearestSample.p[1];
        const elev = Math.max(0, roadY - minY);
        const localCeil = roadY - 8 - elev * 0.55;
        const localFloor = localCeil - amp * 2.2;
        const xr = (x * 0.809 + z * 0.588) / 110, zr = (-x * 0.588 + z * 0.809) / 110;
        const nz = valueNoise(seed, x / 240, z / 240) * 0.7 + valueNoise(seed ^ 0x9e37, xr, zr) * 0.3;
        let h = localFloor + nz * (localCeil - localFloor);

        // landform uplift OUTSIDE the racing corridor: fades in from corridor edge (C1) to
        // open terrain (C2); placement driven by a large-feature noise so it reads as hills /
        // walls / ridges, not a uniform berm ringing the road. RIDGE pieces (3.1) pull the
        // uplift TIGHT against the road and boost it — canyon-rim crest run.
        const roadEdgeN = nearestSample.w / 2 + 1.0;
        const onRidge = !!nearestSample.ridge;
        const C1 = roadEdgeN + (onRidge ? 8.0 : 26.0), C2 = C1 + (onRidge ? 38.0 : 85.0);
        const zoneT = DD.smoothstep(DD.clamp((dist - C1) / (C2 - C1), 0, 1));
        if (zoneT > 0) {
          const rise01 = valueNoise(seed ^ 0x51ab, x / 380, z / 380);
          let uplift = zoneT * rise01 * riseMax * (onRidge ? 1.4 : 1);
          if (theme.biome === 'canyon') {
            // ridged component: sharp mesa/wall crests instead of soft mounds
            const rn = valueNoise(seed ^ 0x77cd, x / 210, z / 210);
            const ridge = 1 - Math.abs(2 * rn - 1);
            uplift += zoneT * ridge * ridge * riseMax * 0.6;
          }
          h += uplift;
        }

        // terracing applies to the composed landform (terraced mesas, not just basin steps)
        if (theme.terraced) h = Math.round(h / 9) * 9 + (h - Math.round(h / 9) * 9) * 0.25;

        // embankment conforming: raise terrain up to just under the road where it passes close
        // (only ever RAISES toward the road underside). On apron spans the conform target blends
        // from -0.85 (permanent ledge) to -0.10 (flush) on the apron side — drive off, drive back on.
        if (!nearestSample.gap) {
          const minRoadY = roadY - Math.abs(nearestSample.r[1]) * (nearestSample.w / 2);
          let conf = 0.85, flushExt = 0;
          if (nearestSample.apron) {
            const sdx = x - nearestSample.p[0], sdz = z - nearestSample.p[2];
            const sideMatch = (sdx * nearestSample.r[0] + sdz * nearestSample.r[2]) * nearestSample.apron > 0;
            // under-deck cells flush on BOTH halves (invisible below the deck): on narrow decks
            // the bilinear footprint of an off-half -0.85 cell bleeds into the apron edge
            if (sideMatch || dist < roadEdgeN) {
              conf = DD.lerp(0.85, 0.10, Math.abs(nearestSample.apron));
              // widen the fully-flush shelf past the deck edge — the terrain grid is ~10-13 m
              // per cell, so without this the bilinear falloff smears back into the mouth and
              // the re-ground window (-0.45) is missed at the edge
              // shelf must span >= ~1 grid cell (10-13 m) or bilinear falloff eats the mouth
              flushExt = sideMatch ? 12.0 * Math.abs(nearestSample.apron) : 0;
            }
          }
          const targetH = minRoadY - conf;
          const heightDiff = targetH - h;
          if (heightDiff > 0) {
            // apron shelves may build a taller local berm (24) — the apron pass only fires on
            // near-ground spans (elev <= 6), so worst-case noise valleys still reach flush
            const maxEmbankmentHeight = flushExt > 0 ? 24.0 : 16.0;
            const clampTargetH = Math.min(targetH, h + maxEmbankmentHeight);
            if (dist < roadEdgeN + flushExt) {
              h = clampTargetH;
            } else if (dist < roadEdgeN + flushExt + 32.0) {
              const t = (dist - roadEdgeN - flushExt) / 32.0;
              const smoothT = t * t * (3 - 2 * t);
              h = DD.lerp(clampTargetH, h, smoothT);
            }
          }
        }

        // playground basins (5.2): blend toward a smooth shallow dish — the off-track playground
        // floor. Runs AFTER the embankment conform (whose 32 m falloff otherwise plows a raised
        // ramp straight through the dish — the closed-loop audit caught exactly that) but BEFORE
        // the safety clamp, so road/gap clearance still always wins. The road-distance gate keeps
        // the conform's apron shelf and embankment intact near the deck; the dish owns the rest.
        if (playgrounds && playgrounds.length) {
          for (const pg of playgrounds) {
            const dxp = x - pg.x, dzp = z - pg.z;
            const dp = Math.sqrt(dxp * dxp + dzp * dzp);
            const R1 = pg.r * 1.5; // blend skirt
            if (dp < R1) {
              // full dish inside 0.85r, skirt 0.85r→1.5r; the floor must be full-strength well
              // past the audit's 0.7r probe ring or grid-scale noise leaks into the interior
              let t = DD.smoothstep(DD.clamp((R1 - dp) / (R1 - pg.r * 0.85), 0, 1));
              // fade the dish out within ~14 m of the deck edge (apron flush shelf = 12 m)
              t *= DD.smoothstep(DD.clamp((dist - (roadEdgeN + 14.0)) / 8.0, 0, 1));
              const nd = dp / pg.r;
              const dish = pg.y - 1.2 * Math.max(0, 1 - nd * nd);
              h = DD.lerp(h, dish, t);
            }
          }
        }

        // hard safety clamp — nothing (uplift, terrace, embankment) may violate road clearance
        // or fill a gap chasm
        if (clampY < 1e9) h = Math.min(h, clampY);

        // dirt shortcut corridors (masterplan 2.2) — AFTER the clamp: the carve is a deliberate
        // cut whose safety the candidate filter already guarantees (no gap pieces near the span,
        // no unrelated geometry within 15 m at |Δy| < 14, banked mouths rejected). Left before
        // the clamp, banked/lower NEIGHBOUR samples' contributions re-dig the mouths.
        if (shortcuts) {
          for (let sc = 0; sc < shortcuts.length; sc++) {
            const cut = shortcuts[sc];
            const abx = cut.b[0] - cut.a[0], abz = cut.b[2] - cut.a[2];
            const t = DD.clamp(((x - cut.a[0]) * abx + (z - cut.a[2]) * abz) / cut.len2, 0, 1);
            const px = cut.a[0] + abx * t, pz = cut.a[2] + abz * t;
            const dC = Math.hypot(x - px, z - pz);
            const HALF = 10.0, FEATHER = 12.0; // grid cells are 10-13 m — blend must span cells
            if (dC < HALF + FEATHER) {
              const hC = DD.lerp(cut.a[1], cut.b[1], DD.smoothstep(t));
              const wC = dC < HALF ? 1 : 1 - DD.smoothstep((dC - HALF) / FEATHER);
              h = DD.lerp(h, hC, wC);
            }
          }
        }

        // absolute deck-footprint ceiling — NOTHING (conform, relax, carve) may end above a
        // deck's underside. This is the invariant Tibba's "terrain clips into the road" broke.
        if (deckCapY < 1e9) h = Math.min(h, deckCapY);

        heights[j * RES + i] = h;
        hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
      }
    }
    return { minX, minZ, stepX, stepZ, res: RES, heights, minH: hMin, maxH: hMax };
  }

  /* --- playground furniture stamps (masterplan 5.3) ---
     kickers/tabletops/rollers/bowls, stamped as height DELTAS directly into the already-baked
     dish floor (track.terrain.heights) — additive, so nothing outside the footprint is touched
     and every existing clamp/conform/clearance invariant upstream is untouched. Ground query
     (DD.terrainAt / the mesh vertices themselves) is the only collision — no new physics. */
  function furnitureDelta(f, dx, dz) {
    if (f.type === 'bowl') {
      const r = Math.hypot(dx, dz), R = f.r;
      if (r >= R * 1.15) return 0;
      if (r <= R * 0.8) { const t = r / (R * 0.8); return -f.depth * (1 - t * t); }
      const t = DD.clamp((r - R * 0.8) / (R * 0.35), 0, 1);
      return f.rim * Math.sin(Math.PI * t);
    }
    const u = dx * f.dir[0] + dz * f.dir[1];
    const v = -dx * f.dir[1] + dz * f.dir[0];
    if (Math.abs(u) > f.halfLen || Math.abs(v) > f.halfWidth) return 0;
    const vFalloff = DD.smoothstep(DD.clamp((f.halfWidth - Math.abs(v)) / (f.halfWidth * 0.35), 0, 1));
    const tu = (u + f.halfLen) / (2 * f.halfLen);
    let shape = 0;
    if (f.type === 'kicker') {
      // long smooth rise to a 60%-along lip, short steep drop — the aggressive kicker profile
      shape = tu < 0.6 ? DD.smoothstep(DD.clamp(tu / 0.6, 0, 1)) : 1 - DD.smoothstep(DD.clamp((tu - 0.6) / 0.4, 0, 1));
      shape *= f.amp;
    } else if (f.type === 'tabletop') {
      // rise / flat plateau / descent — motocross tabletop
      if (tu < 0.3) shape = f.amp * DD.smoothstep(DD.clamp(tu / 0.3, 0, 1));
      else if (tu < 0.7) shape = f.amp;
      else shape = f.amp * (1 - DD.smoothstep(DD.clamp((tu - 0.7) / 0.3, 0, 1)));
    } else if (f.type === 'roller') {
      // a short whoop train, tapered to 0 at both ends so it seats into the dish floor
      const env = DD.smoothstep(DD.clamp((f.halfLen - Math.abs(u)) / (f.halfLen * 0.25), 0, 1));
      shape = f.amp * env * (0.5 * (1 - Math.cos(2 * Math.PI * f.n * tu)));
    }
    return shape * vFalloff;
  }

  function stampFurniture(T, pg) {
    const f = pg.furniture;
    const pad = f.type === 'bowl' ? f.r * 1.2 : Math.max(f.halfLen, f.halfWidth) * 1.2;
    const i0 = Math.max(0, Math.floor((pg.x - pad - T.minX) / T.stepX));
    const i1 = Math.min(T.res - 1, Math.ceil((pg.x + pad - T.minX) / T.stepX));
    const j0 = Math.max(0, Math.floor((pg.z - pad - T.minZ) / T.stepZ));
    const j1 = Math.min(T.res - 1, Math.ceil((pg.z + pad - T.minZ) / T.stepZ));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = T.minX + i * T.stepX, z = T.minZ + j * T.stepZ;
        const delta = furnitureDelta(f, x - pg.x, z - pg.z);
        if (delta !== 0) {
          const v = T.heights[j * T.res + i] + delta;
          T.heights[j * T.res + i] = v;
          // keep the cached range honest: physics out-of-world uses minH, terrain-mesh
          // coloring normalizes on the range (a bowl dips below the pre-stamp minimum)
          if (v < T.minH) T.minH = v;
          if (v > T.maxH) T.maxH = v;
        }
      }
    }
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
  DD.generateTrack = function (seedStr, tier, attempt, isMenu = false) {
    tier = DD.clamp(tier | 0, 1, 5);
    const rng = DD.makeRng(seedStr + '::track::t' + tier + '::a' + (attempt || 0));
    const archetype = rng.pick(ARCHETYPES);
    const weights = WEIGHTS[archetype];
    const builders = makePieces(rng, tier, seedStr);
    let targetLen = isMenu ? 100 : (1300 + tier * 230 + rng.range(-150, 200));
    const theme = DD.makeTheme(seedStr);

    // Closed-circuit decision on an ISOLATED rng stream: the main rng's draw sequence is
    // untouched, so seeds that stay point-to-point generate exactly the track they always did.
    // Loop tracks get a shorter per-lap budget (raced 2-3 times, total ≈ a sprint's length).
    const wantLoop = isMenu ? false : DD.makeRng(seedStr + '::loop::t' + tier + '::a' + (attempt || 0)).chance(0.55);
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
    // 3.3 elevation ambition: vertical/speedway earn a taller soft y-corridor (skyline moments)
    const yTop = (archetype === 'vertical' || archetype === 'speedway') ? 90 : 55;
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
        if (s1.pos[1] > yTop) pitchEff -= 0.022;
        s1.yaw += (c.curv || 0) * DS;
        const cosP = Math.cos(pitchEff);
        const f = [Math.sin(s1.yaw) * cosP, Math.sin(pitchEff), Math.cos(s1.yaw) * cosP];
        s1.pos = V.addS(s1.pos, f, DS);
        arr.push({ p: V.clone(s1.pos), yaw: s1.yaw, pitch: pitchEff, bank: s1.bank, w: s1.width, surf: c.surf || 0, wall: c.wall ? 1 : (piece.rail && !c.gap ? 1 : 0), gap: c.gap ? 1 : 0, pieceName: piece.name, landing: c.landing ? 1 : 0, ridge: c.ridge ? 1 : 0 });
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
      if (['straight', 'sweeper', 'weave', 'boost', 'chicane', 'banked', 'dirtcut'].includes(name) && !p.brakingZone && rng.chance(0.55)) {
        // gentler + longer-wavelength surface undulation — old amplitude/frequency read as a
        // "weird wiggle" up and down rather than a subtle rolling surface.
        p.bumpA = rng.range(0.008, 0.022) + (tier - 1) * 0.003;
        p.bumpW = rng.range(40, 80);
        p.bumpP = rng.range(0, Math.PI * 2);
      }
      return p;
    }

    function appendPiece(piece, name, allowCkpt) {
      // collision-aware: re-roll alternates if this geometry hits existing track — two fresh
      // same-name rolls first (derived-stream pieces get NEW params each call), then downgrades
      const candidates = [piece];
      candidates.push(decorate(builders[name](), name));
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
    const sigRetried = {};
    // 3.2 signature recipes: mountain_pass / spaghetti / rally_stage joined the pool, and the
    // 'corkscrew' signature now uses the REAL corkscrew piece (was a wallride stand-in)
    const signatures = ['gorge', 'corkscrew', 'ice_slalom', 'mountain_pass', 'spaghetti', 'rally_stage'];
    let signatureType = signatures[rng.int(0, signatures.length - 1) % signatures.length];

    if (seedStr.startsWith('CAMP-')) {
      const match = seedStr.match(/CAMP-T(\d+)-/);
      if (match) {
        const tNum = parseInt(match[1], 10);
        if (tNum === 1) signatureType = 'gorge';
        else if (tNum === 2) signatureType = 'corkscrew';
        else if (tNum === 3) signatureType = 'mountain_pass';
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
      let name, fromQueue = false;
      if (forcedQueue.length > 0) {
        name = forcedQueue.shift();
        fromQueue = true;
      } else {
        const progress = total / targetLen;
        if (progress >= 0.4 && !hasSignature) {
          hasSignature = true;
          if (signatureType === 'gorge') {
            forcedQueue = ['boost', 'kicker', 'jumpgap', 'straight'];
          } else if (signatureType === 'corkscrew') {
            forcedQueue = ['boost', 'corkscrew', 'straight'];
          } else if (signatureType === 'ice_slalom') {
            forcedQueue = ['glass', 'chicane', 'weave', 'straight'];
          } else if (signatureType === 'void_extreme') {
            forcedQueue = ['boost', 'wallride', 'boost', 'kicker', 'jumpgap', 'straight'];
          } else if (signatureType === 'mountain_pass') {
            forcedQueue = ['ridge', 'corkscrew', 'bowl', 'straight'];
          } else if (signatureType === 'spaghetti') {
            forcedQueue = ['overunder', 'banked', 'overunder', 'straight'];
          } else if (signatureType === 'rally_stage') {
            forcedQueue = ['dirtcut', 'crest', 'dirtcut', 'straight'];
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

      // sequencing rewrites apply to WEIGHTED draws only — signature queue pieces are the
      // designed sequence and bypass them (the spacing rule was silently rewriting every
      // queued corkscrew/bowl/jumpgap to a sweeper because the previous queue piece had just
      // set lastSpecial). Collision downgrade still guards queue pieces.
      if (!fromQueue) {
        if (lastName === 'glass' || lastName === 'kicker' || lastName === 'jumpgap' || lastName === 'bigjump' || lastName === 'corkscrew' || lastName === 'overunder') name = 'straight';
        if (name === lastName && (name === 'hairpin' || name === 'glass' || name === 'kicker' || name === 'boost' || name === 'jumpgap' || name === 'bigjump' || name === 'tighten' || name === 'corkscrew' || name === 'overunder' || name === 'bowl' || name === 'dirtcut')) name = 'straight';
        if ((name === 'glass' || name === 'boost' || name === 'wallride' || name === 'jumpgap' || name === 'bigjump' || name === 'corkscrew' || name === 'overunder' || name === 'bowl') && total - lastSpecial < 180) name = 'sweeper';
        if ((lastName === 'crest' || lastName === 'dip') && (name === 'hairpin' || name === 'tighten')) name = 'sweeper';
      }

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
      if (name === 'glass' || name === 'boost' || name === 'wallride' || name === 'kicker' || name === 'jumpgap' || name === 'bigjump' || name === 'corkscrew' || name === 'overunder' || name === 'bowl') lastSpecial = total;
      const placed = appendPiece(p, name, true);
      // signature integrity: a queue piece that collision-downgraded gets ONE retry from the
      // new position (compact loops often reject the first corkscrew/overunder placement)
      if (fromQueue && placed !== name && !sigRetried[name]) {
        sigRetried[name] = 1;
        forcedQueue.unshift(name);
      }
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

    const checkpoints = ckpts.filter(c => c > startIdx + 20 && c < finishIdx - 20);

    // --- kerb band flags (masterplan 2.4) — mirrors buildKerbs' span exactly (entry-3 .. end+3,
    // inside edge) so the physics rumble band IS the visible kerb. Pure layout, no rng.
    for (const c of corners) {
      for (let i = Math.max(2, c.entry - 3); i < Math.min(samples.length - 1, c.end + 3); i++) {
        if (!samples[i].gap) samples[i].kerb = c.insideSign;
      }
    }

    /* --- re-entry aprons (masterplan 2.1) ---
       s.apron ∈ [-1,1]: sign = side (+1 = +r), magnitude = flush strength (ramped at span ends).
       Periodic 20-30 m spans on the outside edges of rail-free, flat straights/sweepers; the
       terrain conform target blends -0.85 → -0.10 there so casual off-tracks are recoverable.
       Derived rng stream — the main rng's draw sequence is untouched. */
    // natural-terrain probe: the SAME base-field math buildTerrainData uses. Used by the apron
    // pass (only flag where the embankment can actually reach flush) and the shortcut pass
    // (reject chords over deep basins the carve can't hide at grid scale). Deterministic —
    // reads the noise field, draws nothing from any rng.
    let minTrackY = 1e9;
    for (const s of samples) minTrackY = Math.min(minTrackY, s.p[1]);
    const tSeed = DD.hashSeed(seedStr + '::terrain');
    const natH = (x, z, roadY) => {
      const elevN = Math.max(0, roadY - minTrackY);
      const ceil = roadY - 8 - elevN * 0.55;
      const floor = ceil - theme.terrainAmp * 2.2;
      const xr = (x * 0.809 + z * 0.588) / 110, zr = (-x * 0.588 + z * 0.809) / 110;
      const nz = valueNoise(tSeed, x / 240, z / 240) * 0.7 + valueNoise(tSeed ^ 0x9e37, xr, zr) * 0.3;
      return floor + nz * (ceil - floor);
    };

    {
      const rngA = DD.makeRng(seedStr + '::apron');
      const RAMP = 4; // samples (8 m) of strength ramp at each span end
      const shelfReachable = (idx, side) => {
        const s = samples[idx];
        for (const off of [3, 8]) {
          const q = V.addS(V.clone(s.p), s.r, side * (s.w / 2 + off));
          if (s.p[1] - 0.10 - natH(q[0], q[2], s.p[1]) > 21) return false;
        }
        return true;
      };
      // 5.1 "a way back, everywhere": piece BLACKLIST instead of whitelist — every piece whose
      // hazard isn't already encoded in the per-sample checks below (pitch/bank/gap/elev) or the
      // closed-loop audit. Coverage pattern flipped from "rare windows" (10-18 m gaps, 20-36 m
      // spans) to near-continuous (4-8 m gaps, 36-68 m spans): off-track is a place to play now,
      // so the fence-free flush shelf is the DEFAULT wherever terrain allows. The audit still
      // trims every span the built grid can't actually deliver — same guarantee as before.
      const APRON_HOSTILE = { wallride: 1, glass: 1, kicker: 1, jumpgap: 1, bigjump: 1, crest: 1 };
      for (const span of pieceSpans) {
        if (APRON_HOSTILE[span.name]) continue;
        let i = span.start + 2;
        const end = span.end - 2;
        while (i < end) {
          const gapN = rngA.int(2, 4);    // 4-8 m between apron spans
          const apN = rngA.int(18, 34);   // 36-68 m apron span
          const sidePick = rngA.sign();   // used when the span has no curvature (straights)
          const a0 = i + gapN, a1 = Math.min(a0 + apN, end);
          i = a1;
          if (a1 - a0 < RAMP * 2) continue;
          // eligibility: flat (bank AND pitch), plain surface, NEAR GROUND LEVEL (elevated decks
          // can't be conformed flush — embankment cap). Railed spans are allowed: the audit's
          // survivors OPEN the rail there (wallOpen), reading as gateway breaks in the fence.
          let ok = true;
          for (let k = a0; k < a1; k++) {
            const s = samples[k];
            if (s.gap || s.surf !== 0 || Math.abs(s.bank) > 0.04 || Math.abs(s.pitch) > 0.05 || s.p[1] - minTrackY > 12.0) { ok = false; break; }
          }
          // no aprons where ANOTHER stretch of track runs close by (closure beside the opening
          // straight, near-parallel passes): the flush shelf would sit in the other road's space
          if (ok) {
            const mid = samples[(a0 + a1) >> 1];
            for (let j = 0; j < samples.length; j += 4) {
              let di = Math.abs(j - ((a0 + a1) >> 1));
              if (closed) di = Math.min(di, samples.length - di);
              if (di < 40) continue;
              const ddx = mid.p[0] - samples[j].p[0], ddz = mid.p[2] - samples[j].p[2];
              if (ddx * ddx + ddz * ddz < 34 * 34) { ok = false; break; }
            }
          }
          if (!ok) continue;
          // sweepers: apron goes on the OUTSIDE of the turn (curv>0 turns toward +r → outside -r)
          const dyaw = DD.angleDiff(samples[a0].yaw, samples[a1 - 1].yaw);
          const side = Math.abs(dyaw) > 0.02 ? -Math.sign(dyaw) : sidePick;
          // the noise field must actually allow a flush shelf here (probe both ends + middle)
          if (!shelfReachable(a0, side) || !shelfReachable((a0 + a1) >> 1, side) || !shelfReachable(a1 - 1, side)) continue;
          for (let k = a0; k < a1; k++) {
            const strength = Math.min(1, (k - a0 + 1) / RAMP, (a1 - k) / RAMP);
            samples[k].apron = side * strength;
          }
        }
      }
    }

    /* --- dirt shortcuts (masterplan 2.2) ---
       1-2 corner chords: a carved smooth dirt corridor across the inside of a sharp corner.
       Own derived rng stream. Constraints: no checkpoint inside the span (gates can't be
       skipped), chord clear of unrelated track geometry, sane length ratio + slope. The whole
       corner inside gets apron flags so the mouths are flush and the safety clamp lifts. */
    const shortcuts = [];
    const cutStats = { corners: 0, minRad: 0, span: 0, ckpt: 0, gapNear: 0, bank: 0, chord: 0, basin: 0, clear: 0, cands: 0 };
    if (!isMenu) {
      const rngS = DD.makeRng(seedStr + '::shortcut');
      const n = samples.length;
      const cands = [];
      for (const c of corners) {
        cutStats.corners++;
        if (c.minRad > 95) { cutStats.minRad++; continue; } // anything genuinely cornering; long sweepers excluded
        const e0 = Math.max(c.entry - 6, startIdx + 30);
        const e1 = Math.min(c.end + 6, finishIdx - 30);
        if (e1 - e0 < 20) { cutStats.span++; continue; }
        if (checkpoints.some(k => k > e0 && k <= e1)) { cutStats.ckpt++; continue; } // checkpoint audit
        const sA = samples[e0], sB = samples[e1];
        if (sA.gap || sB.gap) { cutStats.gapNear++; continue; }
        if (Math.abs(sA.bank) > 0.10 || Math.abs(sB.bank) > 0.10) { cutStats.bank++; continue; }
        // mouths must sit on near-level deck: a pitching neighbour's deck footprint (correctly)
        // caps the terrain under it, which would leave the mouth shelf ~1-2 m below flush
        let pitchOk = true;
        for (const m of [e0, e1]) {
          for (let j = Math.max(0, m - 5); j <= Math.min(n - 1, m + 5) && pitchOk; j++) {
            if (Math.abs(samples[j].pitch) > 0.05) pitchOk = false;
          }
        }
        if (!pitchOk) { cutStats.bank++; continue; }
        let spanOk = true;
        for (let j = e0; j <= e1; j++) { if (samples[j].gap || samples[j].surf !== 0) { spanOk = false; break; } }
        if (!spanOk) { cutStats.gapNear++; continue; }
        const side = c.insideSign;
        const a = V.addS(V.clone(sA.p), sA.r, side * (sA.w / 2 + 2.0));
        const b = V.addS(V.clone(sB.p), sB.r, side * (sB.w / 2 + 2.0));
        // mouth height = the edge on the CHORD side (mildly banked mouths put the cut on the
        // high edge — minRoadY would carve the shelf ~1.5 m under it)
        a[1] = sA.p[1] + side * sA.r[1] * (sA.w / 2) - 0.15;
        b[1] = sB.p[1] + side * sB.r[1] * (sB.w / 2) - 0.15;
        const chord = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const arc = (e1 - e0) * DS;
        // a cut pays off via distance AND entry speed (the corner brakes to ~26-30 m/s, the
        // chord doesn't) — near-par chords are still a real line choice on sharp corners
        if (chord < 20 || chord > 160 || chord > arc * 0.92) { cutStats.chord++; continue; }
        if (Math.abs(b[1] - a[1]) / chord > 0.12) { cutStats.chord++; continue; }            // dirt ramp too steep
        // deep-basin check: the carve blends over ~22 m — a chord across a natural drop much
        // deeper than that leaves cliff walls at grid scale. Probe the noise field mid-chord.
        let basinOk = true;
        for (const tq of [0.3, 0.5, 0.7]) {
          const qx = a[0] + (b[0] - a[0]) * tq, qz = a[2] + (b[2] - a[2]) * tq;
          if (DD.lerp(a[1], b[1], tq) - natH(qx, qz, DD.lerp(a[1], b[1], tq) + 0.15) > 20) { basinOk = false; break; }
        }
        if (!basinOk) { cutStats.basin++; continue; }
        // clearance: the chord must not pass near UNRELATED track geometry
        const abx = b[0] - a[0], abz = b[2] - a[2], len2 = chord * chord;
        // adjacent gap pieces poison the corridor: their chasm clamp (p[1]-12) digs a hole in
        // any cell within ~22 m — reject anchors with a gap anywhere near the span
        let clear = true;
        for (let j = Math.max(0, e0 - 20); j <= Math.min(n - 1, e1 + 20); j++) {
          if (samples[j].gap) { clear = false; break; }
        }
        if (clear) for (let j = 0; j < n; j += 2) {
          if (j >= e0 - 20 && j <= e1 + 20) continue;
          const sp = samples[j].p;
          const t = DD.clamp(((sp[0] - a[0]) * abx + (sp[2] - a[2]) * abz) / len2, 0, 1);
          const dx = sp[0] - (a[0] + abx * t), dz = sp[2] - (a[2] + abz * t);
          const near2 = samples[j].gap ? 26 * 26 : 15 * 15; // gap chasms reach further
          if (dx * dx + dz * dz < near2 && Math.abs(sp[1] - DD.lerp(a[1], b[1], t)) < 14) { clear = false; break; }
          // mouths must OWN their ground at ANY elevation: a crossing deck (legal over the
          // mid-corridor at dY>=14) plants a deckCapY footprint that would sink the shelf
          const ax0 = sp[0] - a[0], az0 = sp[2] - a[2], bx0 = sp[0] - b[0], bz0 = sp[2] - b[2];
          if (ax0 * ax0 + az0 * az0 < 16 * 16 || bx0 * bx0 + bz0 * bz0 < 16 * 16) { clear = false; break; }
        }
        if (!clear) { cutStats.clear++; continue; }
        cutStats.cands++;
        cands.push({ entry: e0, exit: e1, side, a, b, len2 });
      }
      if (cands.length) {
        const want = Math.min(2, cands.length); // Tibba: shortcuts were too rare to find
        const first = rngS.int(0, cands.length - 1);
        for (let o = 0; o < cands.length && shortcuts.length < want; o++) {
          const cand = cands[(first + o) % cands.length];
          if (shortcuts.some(sc => Math.min(cand.exit, sc.exit) + 20 > Math.max(cand.entry, sc.entry))) continue;
          shortcuts.push(cand);
          // flush the corner inside: apron flags across the whole span (shortcut wins over any
          // weaker straight/sweeper apron). The INSIDE rail opens (wallOpen — physics clamp and
          // rail render skip that side); the outside rail stays as crash protection.
          const RAMP = 4;
          for (let k = cand.entry; k <= cand.exit; k++) {
            const strength = Math.min(1, (k - cand.entry + 1) / RAMP, (cand.exit - k + 1) / RAMP);
            if (Math.abs(samples[k].apron || 0) < strength) samples[k].apron = cand.side * strength;
            samples[k].wallOpen = cand.side;
            samples[k].cut = 1; // exempts the span from the apron audit (mouths are carved exact)
          }
        }
      }
    }

    // clamp-relaxation reach: the terrain safety clamp is RADIAL (roadEdge+10 ≈ 18-22 m ≈ ±11
    // samples), so ANY sample within that radius carrying a partial/absent apron drop would cap
    // the span's cells back toward the ledge. Any sample within ±12 of an apron span carries the
    // FULL relaxation sign (the conform's per-sample ramp still shapes the visual taper — the
    // clamp just steps aside for the whole span + margin). Wrap-aware on circuits.
    {
      const n = samples.length;
      const REACH = 12;
      const reach = new Float32Array(n);
      const capY = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let best = 0, hi = -1e9;
        for (let o = -REACH; o <= REACH; o++) {
          let j = i + o;
          if (closed) j = ((j % n) + n) % n;
          else if (j < 0 || j >= n) continue;
          const a = samples[j].apron || 0;
          if (Math.abs(a) > Math.abs(best)) best = a;
          hi = Math.max(hi, samples[j].p[1]);
        }
        reach[i] = best === 0 ? 0 : Math.sign(best);
        // absolute ceiling for the relaxed clamp: the local road maximum minus a hair. High
        // enough that undulation (bumpA) troughs can't re-ledge their crest neighbours' shelf,
        // but NEVER above this road's own deck — so a second road passing legally close (e.g.
        // the closure beside the opening straight) can't have terrain conformed through it.
        capY[i] = hi - 0.08;
      }
      for (let i = 0; i < n; i++) { if (reach[i]) { samples[i].apronReach = reach[i]; samples[i].apronCapY = capY[i]; } }
    }

    /* --- playground basin pockets (masterplan 5.2) ---
       1-2 smooth driveable terrain pockets just off apron spans: the off-track playground's
       floor. Selection here (needs natH + shortcuts); the heightfield relaxation happens inside
       buildTerrainData. Own derived rng stream — main sequence untouched. Furniture (5.3 stamps)
       builds on these later. */
    const playgrounds = [];
    if (!isMenu) {
      const rngP = DD.makeRng(seedStr + '::playground');
      const n = samples.length;
      const clearOfAll = (px, pz, need) => {
        for (let j = 0; j < n; j += 3) {
          const dx = px - samples[j].p[0], dz = pz - samples[j].p[2];
          if (dx * dx + dz * dz < need * need) return false;
        }
        return true;
      };
      const clearOfCuts = (px, pz, need) => {
        for (const sc of shortcuts) {
          const abx = sc.b[0] - sc.a[0], abz = sc.b[2] - sc.a[2];
          const l2 = abx * abx + abz * abz || 1;
          const t = DD.clamp(((px - sc.a[0]) * abx + (pz - sc.a[2]) * abz) / l2, 0, 1);
          const dx = px - (sc.a[0] + abx * t), dz = pz - (sc.a[2] + abz * t);
          if (dx * dx + dz * dz < need * need) return false;
        }
        return true;
      };
      for (let i = 20; i < n - 20 && playgrounds.length < 2; i += 9) {
        const s = samples[i];
        if (!s.apron) continue;
        // no gaps near the anchor — a chasm clamp through the pocket would slice its floor
        let gapNear = false;
        for (let o = -30; o <= 30 && !gapNear; o += 3) {
          const j = closed ? ((i + o) % n + n) % n : DD.clamp(i + o, 0, n - 1);
          if (samples[j].gap) gapNear = true;
        }
        if (gapNear) continue;
        const side = Math.sign(s.apron);
        const r = rngP.range(16, 26);
        // 48-62 m out: the 0.7r audit-probe ring must clear the conform's road-distance gate
        // (roadEdge + 14 + 8 m fade) or the dish never reaches full strength where it's measured
        const off = rngP.range(48, 62);
        const px = s.p[0] + s.r[0] * side * off;
        const pz = s.p[2] + s.r[2] * side * off;
        // Playground floor anchors to the ROAD (a shallow drivable dish just below the apron
        // shelf), NOT to natH — natH is the pre-conform landform, which sits ~8 m below the road
        // by design (the embankment conform later raises it to road level near apron spans).
        // Anchoring to natH made the floor a deep pit and rejected nearly every candidate.
        // Sanity gate: the raw landform at the pocket must not already be a cliff face (slopier
        // than ~18 m over the pocket radius) or the dish can't blend smoothly onto it.
        const nyEdge = natH(px + r * 0.7, pz, s.p[1]);
        const nyCtr = natH(px, pz, s.p[1]);
        if (Math.abs(nyEdge - nyCtr) > 18) continue;
        if (!clearOfAll(px, pz, r + s.w / 2 + 6)) continue; // pocket clear of every leg
        if (!clearOfCuts(px, pz, r + 24)) continue;         // shortcut carve feather reaches 22 m
        if (playgrounds.some(pg => { const dx = pg.x - px, dz = pg.z - pz; return dx * dx + dz * dz < 120 * 120; })) continue;
        playgrounds.push({ x: px, z: pz, r, y: s.p[1] - 1.5, anchorIdx: i });
      }
    }

    const track = {
      seed: seedStr, tier, archetype,
      samples, ds: DS,
      checkpoints,
      startIdx, finishIdx,
      closed, laps,
      length: dist,
      pieceSpans,
      corners,
      shortcuts,
      playgrounds,
      overlapForced,
      theme
    };
    track._cutStats = cutStats; // shortcut-candidate funnel (debug/telemetry, deterministic)
    track.terrain = buildTerrainData(samples, seedStr, theme, shortcuts, playgrounds);

    // playground audit — CLOSED LOOP (same philosophy as the apron audit below): the dish
    // competes with conform/carve/clamp on a 10-13 m grid, so re-MEASURE every pocket's floor
    // on the built heights and demote any that isn't actually smooth. "listed pocket ⇒ playable
    // floor" is a construction guarantee, not a hope. Demoted pockets keep their (partially)
    // relaxed terrain — harmless dent — but get no furniture/cues later.
    if (playgrounds.length) {
      for (let pi = playgrounds.length - 1; pi >= 0; pi--) {
        const pg = playgrounds[pi];
        const P = 5, span = pg.r * 0.7;
        const hs = [];
        for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
          hs.push(DD.terrainAt(track.terrain, pg.x + (a / (P - 1) - 0.5) * 2 * span, pg.z + (b / (P - 1) - 0.5) * 2 * span));
        }
        let maxStep = 0;
        for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
          if (a + 1 < P) maxStep = Math.max(maxStep, Math.abs(hs[a * P + b] - hs[(a + 1) * P + b]));
          if (b + 1 < P) maxStep = Math.max(maxStep, Math.abs(hs[a * P + b] - hs[a * P + b + 1]));
        }
        if (maxStep > 2.4) playgrounds.splice(pi, 1);
      }
    }

    /* --- playground furniture v1 (masterplan 5.3): kickers, tabletops, rollers, banked bowls
       stamped INTO the heightfield of every pocket that survived the audit above. Own derived
       rng stream (main sequence untouched); direction loosely follows the anchor sample's own
       track-forward tangent (jitter ±20°) so jump lines read as "parallel to the track", not
       arbitrary. Stamped as additive deltas (see stampFurniture) then re-measured on the BUILT
       grid — same closed-loop guarantee as every other terrain feature here: a listed furniture
       piece is a real, driveable bump, not a hope that the coarse grid caught it. */
    if (playgrounds.length) {
      const rngF = DD.makeRng(seedStr + '::furniture');
      const TYPES = ['kicker', 'tabletop', 'roller', 'bowl'];
      for (const pg of playgrounds) {
        const type = rngF.pick(TYPES);
        const anchor = samples[pg.anchorIdx];
        const jitter = rngF.range(-0.35, 0.35); // ~±20 deg off the track tangent
        const cf = Math.cos(jitter), sf = Math.sin(jitter);
        const fx = anchor.f[0], fz = anchor.f[2];
        const dl = Math.hypot(fx, fz) || 1;
        const dir = [(fx * cf - fz * sf) / dl, (fx * sf + fz * cf) / dl];
        const halfLen = pg.r * rngF.range(0.42, 0.55);
        const halfWidth = pg.r * rngF.range(0.30, 0.40);
        let furniture;
        if (type === 'kicker') furniture = { type, dir, halfLen, halfWidth, amp: rngF.range(1.6, 2.4) };
        else if (type === 'tabletop') furniture = { type, dir, halfLen, halfWidth, amp: rngF.range(1.4, 2.0) };
        else if (type === 'roller') furniture = { type, dir, halfLen, halfWidth: halfWidth * 0.8, amp: rngF.range(0.5, 0.9), n: rngF.int(3, 4) };
        else furniture = { type, r: Math.min(halfLen, halfWidth), depth: rngF.range(1.6, 2.4), rim: rngF.range(0.6, 1.0) };
        pg.furniture = furniture;
        stampFurniture(track.terrain, pg);
      }
      // closed-loop furniture audit: re-measure each stamp on the built grid. Demote (drop the
      // furniture, keep the — otherwise harmless — terrain dent) if the coarse grid missed the
      // feature (amplitude undershoot) or produced an unreasonably sharp step (bad grid luck).
      for (const pg of playgrounds) {
        const f = pg.furniture;
        if (!f) continue;
        let peakWorld, expectedAmp, refWorld;
        if (f.type === 'bowl') {
          // bowl: amplitude = bottom (center) vs undisturbed floor BESIDE the rim ring
          peakWorld = [pg.x, pg.z]; expectedAmp = f.depth;
          refWorld = [pg.x + f.r * 1.4, pg.z];
        } else {
          const tuPeak = f.type === 'roller' ? 0.5 : 0.6;
          const uPeak = tuPeak * 2 * f.halfLen - f.halfLen;
          peakWorld = [pg.x + f.dir[0] * uPeak, pg.z + f.dir[1] * uPeak];
          expectedAmp = f.amp;
          // floor reference PERPENDICULAR to the stamp, past the width falloff — the pocket
          // center itself sits ON the stamp (a tabletop's plateau measures ~0 against itself,
          // which is exactly the bug that demoted every stamp on the first pass)
          refWorld = [pg.x - f.dir[1] * f.halfWidth * 1.6, pg.z + f.dir[0] * f.halfWidth * 1.6];
        }
        const floorY = DD.terrainAt(track.terrain, refWorld[0], refWorld[1]);
        const peakY = DD.terrainAt(track.terrain, peakWorld[0], peakWorld[1]);
        const gotAmp = Math.abs(peakY - floorY);
        const P = 5, span = Math.max(f.halfLen || f.r, f.halfWidth || f.r) * 0.9;
        let maxStep = 0;
        const hs = [];
        for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
          hs.push(DD.terrainAt(track.terrain, pg.x + (a / (P - 1) - 0.5) * 2 * span, pg.z + (b / (P - 1) - 0.5) * 2 * span));
        }
        for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
          if (a + 1 < P) maxStep = Math.max(maxStep, Math.abs(hs[a * P + b] - hs[(a + 1) * P + b]));
          if (b + 1 < P) maxStep = Math.max(maxStep, Math.abs(hs[a * P + b] - hs[a * P + b + 1]));
        }
        if (gotAmp < expectedAmp * 0.4 || maxStep > 5.0) pg.furniture = null;
      }
    }

    // apron audit — CLOSED LOOP: the conform/clamp interplay on a 10-13 m grid can still miss
    // flush in odd noise/undulation spots. Re-measure every apron span against the ACTUAL grid
    // and demote spans that can't deliver the re-ground window; "flagged apron ⇒ drivable" is a
    // construction guarantee, not a hope. Shortcut spans (wallOpen) are exempt — their mouths
    // are carved to exact heights. The already-built shelf terrain stays (harmless berm).
    {
      const T = track.terrain;
      const n = samples.length;
      // physics-consistent measure: terrain height expressed in the NEAREST sample's plane —
      // exactly what re-grounding (ha >= -0.45) will see when the car arrives from the shelf
      const haAt = (q, aroundIdx) => {
        let best = aroundIdx, bestD = Infinity;
        for (let k = Math.max(0, aroundIdx - 10); k <= Math.min(n - 1, aroundIdx + 10); k++) {
          const ddx = q[0] - samples[k].p[0], ddz = q[2] - samples[k].p[2];
          const d = ddx * ddx + ddz * ddz;
          if (d < bestD) { bestD = d; best = k; }
        }
        const sN = samples[best];
        const terrY = DD.terrainAt(T, q[0], q[2]);
        return (q[0] - sN.p[0]) * sN.u[0] + (terrY - sN.p[1]) * sN.u[1] + (q[2] - sN.p[2]) * sN.u[2];
      };
      // per-SAMPLE trim (not whole-span demotion): road undulation (bumpA) vs the 10-13 m grid
      // means most spans miss the line somewhere — keep exactly the drivable subset. Only the
      // RE-GROUND LINE binds: the car rides terrain continuously (dirt stick band) up any gentle
      // shelf slope; what must sit inside the -0.45 window is the terrain where |lat| crosses
      // halfW. Flag surgery only — the terrain is already built.
      const keep = new Uint8Array(n); // 0 = strip, 1 = kept core, 2 = ramp (conditional)
      for (let i = 0; i < n; i++) {
        const s = samples[i];
        if (!s.apron || s.cut) continue; // shortcut spans exempt (mouths carved exact)
        if (Math.abs(s.apron) < 0.999) { keep[i] = 2; continue; } // ramp: keep iff near kept core
        const side = Math.sign(s.apron);
        let ok = true;
        for (const off of [0.6, 1.2]) {
          const q = V.addS(V.clone(s.p), s.r, side * (s.w / 2 + off));
          const ha = haAt(q, i);
          if (ha < -0.42 || ha > 0.75) { ok = false; break; }
        }
        keep[i] = ok ? 1 : 0;
      }
      // drop cores shorter than 6 samples (12 m — too small to read or use as a mouth)
      for (let i = 0; i < n;) {
        if (keep[i] !== 1) { i++; continue; }
        let j = i;
        while (j < n && keep[j] === 1) j++;
        if (j - i < 6) for (let k = i; k < j; k++) keep[k] = 0;
        i = j;
      }
      // ramps survive only within 3 samples of a kept core; everything else is stripped
      for (let i = 0; i < n; i++) {
        if (!samples[i].apron || samples[i].cut) continue;
        if (keep[i] === 1) continue;
        let nearCore = false;
        if (keep[i] === 2) {
          for (let o = -3; o <= 3 && !nearCore; o++) {
            const k = i + o;
            if (k >= 0 && k < n && keep[k] === 1) nearCore = true;
          }
        }
        if (!nearCore) samples[i].apron = 0;
      }
      // surviving apron samples on RAILED pieces open the rail on the apron side — a gateway
      // break in the fence (physics clamp + rail render both key on wallOpen). Every surviving
      // apron edge is KERBED (Tibba: flush spans should read as kerbs instead of fence — mark
      // the creative line, rumble on crossing). Corner kerbs win where both apply.
      for (let i = 0; i < n; i++) {
        const s = samples[i];
        if (!s.apron) continue;
        if (s.wall && !s.cut) s.wallOpen = Math.sign(s.apron);
        if (!s.kerb) s.kerb = Math.sign(s.apron);
      }
    }
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
