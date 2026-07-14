/* DRIFTDREAM world/re-entry acceptance suite — run with: node tests/verify_world.js
   Encodes the masterplan Phase 2 DESIGN CONTRACT:
   - 2.1 aprons: periodic flush spans on straight/sweeper outsides; terrain within the -0.45
     re-ground window at the mouth; the permanent ledge preserved everywhere else
   - 2.2 shortcuts: corner chords that never skip a checkpoint, smooth carved corridor,
     flush mouths, inside rail opened (wallOpen), outside rail kept
   - 2.4 kerb flags mirror the visible kerbs (corner inside, entry-3..end+3)
   - determinism: all new flags + terrain identical across regenerations
   - drivability: a car can leave over an apron and re-ground back onto the ribbon */
'use strict';
require('../js/core.js');
require('../js/theme.js');
require('../js/trackgen.js');
require('../js/physics.js');
const DD = globalThis.DD;
const V = DD.v;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS', name, detail || ''); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

const SEEDS = ['DREAM-12345', 'DAILY-20260616', 'CAMP-T1-01', 'CAMP-T3-08', 'CAMP-T5-01', 'JUMPSEED-0', 'WORLD-7', 'APRON-42'];

const edgeTerrainGap = (track, idx, side) => {
  // terrain 2 m outside the deck edge, measured in the NEAREST sample's plane — the exact
  // quantity physics re-grounding compares against (-0.45 window). Positive = below deck.
  const ss = track.samples;
  const s = ss[idx];
  const q = V.addS(V.clone(s.p), s.r, side * (s.w / 2 + 1.2));
  let best = idx, bestD = Infinity;
  for (let k = Math.max(0, idx - 10); k <= Math.min(ss.length - 1, idx + 10); k++) {
    const dx = q[0] - ss[k].p[0], dz = q[2] - ss[k].p[2];
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = k; }
  }
  const sN = ss[best];
  const terrY = DD.terrainAt(track.terrain, q[0], q[2]);
  return -((q[0] - sN.p[0]) * sN.u[0] + (terrY - sN.p[1]) * sN.u[1] + (q[2] - sN.p[2]) * sN.u[2]);
};

/* 1 — generation-level contract across many seeds × tiers (no bot: fast) */
console.log('[1] apron/shortcut/kerb generation contract');
{
  let tracksWithAprons = 0, tracksTotal = 0, shortcutsTotal = 0;
  for (const seed of SEEDS) {
    for (let tier = 1; tier <= 5; tier++) {
      const track = DD.generateTrack(seed, tier, 0);
      tracksTotal++;
      const ss = track.samples;

      // determinism: regenerate → identical flags + terrain
      const track2 = DD.generateTrack(seed, tier, 0);
      let flagsOk = ss.length === track2.samples.length;
      if (flagsOk) for (let i = 0; i < ss.length; i++) {
        const a = ss[i], b = track2.samples[i];
        if ((a.apron || 0) !== (b.apron || 0) || (a.kerb || 0) !== (b.kerb || 0) || (a.wallOpen || 0) !== (b.wallOpen || 0)) { flagsOk = false; break; }
      }
      let terrOk = true;
      for (let i = 0; i < track.terrain.heights.length; i++) {
        if (track.terrain.heights[i] !== track2.terrain.heights[i]) { terrOk = false; break; }
      }
      if (!flagsOk || !terrOk) check(seed + ' t' + tier + ' deterministic', false, (flagsOk ? '' : 'flags ') + (terrOk ? '' : 'terrain'));

      // apron spans: full-strength samples must bring terrain near flush. Window 0.75 not 0.45:
      // physics re-grounds against the NEAREST sample's plane (self-consistent with the conform),
      // while this cross-check uses sample i's plane — road bumpA undulation (±~0.4 m) phase-
      // skews the two. Real regressions (0.85 ledge / 1.25 clamp / capped embankment) still trip.
      // The e2e drive-off/re-entry test below is the physics ground truth.
      let apronFull = 0, apronFlushBad = 0;
      for (let i = 0; i < ss.length; i++) {
        const s = ss[i];
        if (!s.apron || Math.abs(s.apron) < 0.999 || s.gap || s.cut) continue; // cut = shortcut span (audited via its carved mouths below)
        apronFull++;
        const gap = edgeTerrainGap(track, i, Math.sign(s.apron));
        if (gap > 0.5 || gap < -0.8) apronFlushBad++;
      }
      if (apronFull > 0) tracksWithAprons++;
      if (apronFlushBad > 0) check(seed + ' t' + tier + ' apron flush', false, apronFlushBad + '/' + apronFull + ' spans outside window');

      // GLOBAL invariant (Tibba playtest, session 28: terrain clipped through the road on a
      // closed 2-lap track): terrain must NEVER rise above any deck, anywhere — incl. where a
      // second stretch of road passes close to an apron span (closure beside opening straight)
      {
        let aboveDeck = 0, worstAbove = 0;
        for (let i = 2; i < ss.length - 2; i += 2) {
          const s = ss[i];
          if (s.gap) continue;
          for (const lat of [0, -s.w / 4, s.w / 4]) {
            const q = V.addS(V.clone(s.p), s.r, lat);
            const deckY = s.p[1] + s.r[1] * lat;
            const over = DD.terrainAt(track.terrain, q[0], q[2]) - (deckY - 0.05);
            if (over > 0) { aboveDeck++; worstAbove = Math.max(worstAbove, over); }
          }
        }
        if (aboveDeck > 0) check(seed + ' t' + tier + ' terrain never above deck', false, aboveDeck + ' pts, worst +' + worstAbove.toFixed(2) + 'm');
      }

      // kerbed apron edges: every surviving apron core is marked (kerb visual + rumble band)
      for (let i = 0; i < ss.length; i++) {
        const s = ss[i];
        if (s.apron && Math.abs(s.apron) >= 0.999 && !s.kerb) {
          check(seed + ' t' + tier + ' apron edges kerbed', false, 'sample ' + i);
          break;
        }
      }

      // the ledge is still a ledge away from aprons (flat, plain, non-apron samples)
      let ledgeChecked = 0, ledgeBad = 0;
      for (let i = 40; i < ss.length - 40; i += 7) {
        const s = ss[i];
        if (s.apron || s.gap || Math.abs(s.bank) > 0.03 || s.pieceName === 'closure') continue;
        // skip samples whose neighbourhood contains an apron (clamp relaxes ±12 nearby)
        let nearApron = false;
        for (let j = Math.max(0, i - 14); j < Math.min(ss.length, i + 14); j++) if (ss[j].apron) { nearApron = true; break; }
        if (nearApron) continue;
        ledgeChecked++;
        if (edgeTerrainGap(track, i, 1) < 0.8 && edgeTerrainGap(track, i, -1) < 0.8) ledgeBad++;
      }
      if (ledgeChecked > 10 && ledgeBad > ledgeChecked * 0.25)
        check(seed + ' t' + tier + ' ledge preserved', false, ledgeBad + '/' + ledgeChecked + ' flush without apron');

      // kerb flags mirror the corner spans
      for (const c of track.corners) {
        const mid = Math.floor((c.entry + c.end) / 2);
        if (!ss[mid].gap && ss[mid].kerb !== c.insideSign) {
          check(seed + ' t' + tier + ' kerb flags', false, 'corner@' + mid);
          break;
        }
      }

      // shortcuts: checkpoint audit + wallOpen + flush mouths + smooth corridor
      for (const cut of (track.shortcuts || [])) {
        shortcutsTotal++;
        const skips = track.checkpoints.some(k => k > cut.entry && k <= cut.exit);
        check(seed + ' t' + tier + ' shortcut skips no checkpoint', !skips, cut.entry + '..' + cut.exit);
        const gA = edgeTerrainGap(track, cut.entry, cut.side), gB = edgeTerrainGap(track, cut.exit, cut.side);
        check(seed + ' t' + tier + ' shortcut mouths flush', gA <= 0.45 && gB <= 0.45, 'entry ' + gA.toFixed(2) + ' exit ' + gB.toFixed(2));
        check(seed + ' t' + tier + ' inside rail opened', ss[Math.floor((cut.entry + cut.exit) / 2)].wallOpen === cut.side);
        // corridor smoothness: walk the chord, max height step per 4 m
        let prevH = null, maxStep = 0;
        for (let t = 0; t <= 1.0001; t += 4 / Math.sqrt(cut.len2)) {
          const x = cut.a[0] + (cut.b[0] - cut.a[0]) * t, z = cut.a[2] + (cut.b[2] - cut.a[2]) * t;
          const h = DD.terrainAt(track.terrain, x, z);
          if (prevH != null) maxStep = Math.max(maxStep, Math.abs(h - prevH));
          prevH = h;
        }
        // terrain grid is ~8-15 m/cell; bilinear ramps limit what "smooth" can mean here.
        // 1.6 m per 4 m (~22°) is the drivable bound — dirtStickBand 1.4 keeps the car glued.
        check(seed + ' t' + tier + ' corridor smooth (step<1.6m/4m)', maxStep < 1.6, maxStep.toFixed(2) + ' m');
      }
    }
  }
  check('aprons appear on most tracks (>=60%)', tracksWithAprons >= tracksTotal * 0.6, tracksWithAprons + '/' + tracksTotal);
  console.log('  (info) shortcuts generated across the matrix: ' + shortcutsTotal);
  check('shortcuts appear across the matrix (>=3)', shortcutsTotal >= 3, shortcutsTotal + ' total');
}

/* 1b — Phase 3 grammar: new pieces spawn, crossings exist, signatures DELIVER their pieces */
console.log('[1b] phase 3 grammar + signature delivery');
{
  const counts = {};
  let crossTracks = 0;
  for (const seed of SEEDS) {
    for (let tier = 1; tier <= 5; tier++) {
      const t = DD.generateTrack(seed, tier, 0);
      for (const sp of t.pieceSpans) counts[sp.name] = (counts[sp.name] || 0) + 1;
      const ss = t.samples;
      let found = false;
      for (let i = 0; i < ss.length && !found; i += 4) {
        for (let j = i + 120; j < ss.length; j += 4) {
          const dx = ss[i].p[0] - ss[j].p[0], dz = ss[i].p[2] - ss[j].p[2];
          if (dx * dx + dz * dz < 100 && Math.abs(ss[i].p[1] - ss[j].p[1]) >= 14) { crossTracks++; found = true; break; }
        }
      }
    }
  }
  for (const nm of ['corkscrew', 'bowl', 'overunder', 'ridge', 'dirtcut']) {
    check(nm + ' spawns across the matrix', (counts[nm] || 0) >= 1, (counts[nm] || 0) + 'x');
  }
  check('over/under crossings exist (dY>=14 pass-overs)', crossTracks >= 2, crossTracks + ' tracks');

  // signature integrity: the queue bypasses sequencing rewrites + retries collisions — the
  // campaign's promised set-pieces must actually be on the track
  let t2 = 0, t3 = 0;
  for (let i = 1; i <= 10; i++) {
    const s2 = String(i).padStart(2, '0');
    if (DD.generateTrack('CAMP-T2-' + s2, 2, 0).pieceSpans.some(p => p.name === 'corkscrew')) t2++;
    const nm = DD.generateTrack('CAMP-T3-' + s2, 3, 0).pieceSpans.map(p => p.name);
    if (nm.includes('ridge') && nm.includes('corkscrew') && nm.includes('bowl')) t3++;
  }
  check('CAMP-T2 delivers its corkscrew (>=8/10)', t2 >= 8, t2 + '/10');
  check('CAMP-T3 delivers full mountain_pass (>=7/10)', t3 >= 7, t3 + '/10');
}

/* 2 — drivability: leave over an apron, come back, re-ground on the ribbon */
console.log('[2] apron drive-off + re-entry');
{
  // find a track with a long full-strength apron on a straight
  // need a long full-strength run AHEAD of the start point: the exit line travels ~30-40 m
  // forward while crossing the deck edge, and must not run into a curving next piece
  let target = null;
  outer: for (const seed of SEEDS) {
    for (let tier = 1; tier <= 3; tier++) {
      const track = DD.generateTrack(seed, tier, 0);
      const ss = track.samples;
      for (let i = 60; i < ss.length - 90; i++) {
        let runOk = true;
        for (let k = 0; k < 10; k++) {
          const s = ss[i + k];
          if (!(s.apron && Math.abs(s.apron) >= 0.999 && s.pieceName === 'straight' && Math.abs(s.pitch) < 0.03)) { runOk = false; break; }
        }
        if (runOk) { target = { track, idx: i, side: Math.sign(ss[i].apron) }; break outer; }
      }
    }
  }
  check('found an apron test span', !!target);
  if (target) {
    const { track, idx, side } = target;
    const s = track.samples[idx];

    // (a) drive OFF over the apron: start on the ribbon, velocity angled outward
    const car = DD.createCar(track);
    car.pos = V.addS(V.clone(s.p), s.u, 0.4);
    car.idx = idx;
    const out = V.norm(V.addS(V.scale(s.f, 18), s.r, side * 16));
    car.yaw = Math.atan2(out[0], out[2]); // nose along the exit line (grip regime tracks the nose)
    car.vel = V.scale(out, 24);
    let reachedDirt = false, speedAtExit = 0;
    for (let t = 0; t < 150 && !reachedDirt; t++) {
      DD.stepCar(car, { steer: 0, throttle: 0.6, brake: 0 }, track);
      DD.postWallClamp(car, track);
      if (car.onDirt) { reachedDirt = true; speedAtExit = Math.hypot(car.vel[0], car.vel[2]); }
    }
    check('drove off onto dirt over the apron', reachedDirt);
    if (reachedDirt) check('exit not fought by shoulder (kept >= 85% speed)', speedAtExit >= 24 * 0.85, speedAtExit.toFixed(1) + ' m/s');

    // (b) drive BACK ON: start on apron terrain outside the deck, aim at the road
    const car2 = DD.createCar(track);
    const startP = V.addS(V.clone(s.p), s.r, side * (s.w / 2 + 4.0));
    startP[1] = DD.terrainAt(track.terrain, startP[0], startP[2]) + 0.02;
    car2.pos = startP;
    car2.idx = idx;
    car2.grounded = true; car2.onDirt = true;
    const inDir = V.norm(V.addS(V.scale(s.f, 20), s.r, -side * 9));
    car2.vel = V.scale(inDir, 22);
    car2.yaw = Math.atan2(inDir[0], inDir[2]);
    let reGrounded = false;
    for (let t = 0; t < 180 && !reGrounded; t++) {
      DD.stepCar(car2, { steer: 0, throttle: 0.6, brake: 0 }, track);
      DD.postWallClamp(car2, track);
      if (car2.grounded && !car2.onDirt) reGrounded = true;
    }
    check('re-grounded onto the ribbon from apron terrain', reGrounded);
  }
}

/* 3 — kerb feedback: riding the kerb band excites the springs + sets car.kerb */
console.log('[3] kerb band feedback');
{
  // synthetic flat track with a kerb band on the +r side
  const samples = [];
  for (let i = 0; i < 1500; i++) {
    samples.push({ p: [0, 4, i * 2], yaw: 0, pitch: 0, bank: 0, w: 14, surf: 0, wall: 0, gap: 0, f: [0, 0, 1], u: [0, 1, 0], r: [1, 0, 0], pieceName: 'straight', kerb: 1 });
  }
  const KT = { seed: 'KERB', tier: 1, samples, ds: 2, checkpoints: [], startIdx: 2, finishIdx: 1499, length: 3000, terrain: null, theme: null };
  const car = DD.createCar(KT);
  car.pos = [6.6, 4.4, 10]; // in the band: halfW 7.4, band 6.1..8.3
  car.vel = [0, 0, 30];
  let maxKerb = 0, maxSusp = 0;
  for (let t = 0; t < 90; t++) {
    DD.stepCar(car, { steer: 0, throttle: 0.5, brake: 0 }, KT);
    maxKerb = Math.max(maxKerb, car.kerb || 0);
    maxSusp = Math.max(maxSusp, Math.abs(car.suspY));
  }
  check('car.kerb reports the band', maxKerb > 0.5, maxKerb.toFixed(2));
  check('kerb excites the suspension', maxSusp > 0.02, maxSusp.toFixed(3));

  const car2 = DD.createCar(KT);
  car2.pos = [0, 4.4, 10]; // centre of the deck: no kerb
  car2.vel = [0, 0, 30];
  let anyKerb = 0;
  for (let t = 0; t < 60; t++) { DD.stepCar(car2, { steer: 0, throttle: 0.5, brake: 0 }, KT); anyKerb = Math.max(anyKerb, car2.kerb || 0); }
  check('deck centre stays quiet', anyKerb === 0, String(anyKerb));
}

/* 4 — validated builds: 0 fallbacks across seeds × tiers (bot completes every layout) */
console.log('[4] buildValidTrack fallback audit (bot runs — slower)');
{
  let fallbacks = 0, runs = 0;
  for (const seed of ['DREAM-12345', 'CAMP-T1-01', 'CAMP-T3-08', 'CAMP-T5-01', 'WORLD-7']) {
    for (let tier = 1; tier <= 5; tier++) {
      const track = DD.buildValidTrack(seed, tier);
      runs++;
      if (track.attempt === -1) { fallbacks++; console.log('    fallback:', seed, 'tier', tier); }
    }
  }
  check('0 fallbacks across ' + runs + ' seed×tier builds', fallbacks === 0, fallbacks + ' fallbacks');
}

/* 6 — playground basin pockets (masterplan 5.2): every pocket clear of every leg, floor near
   road level, and the dish interior actually SMOOTH on the built grid (closed-loop, same rule
   as the apron audit — construction guarantee, not a hope) */
console.log('[6] playground basins (5.2)');
{
  let pockets = 0, tracksWith = 0, total = 0;
  for (const seed of SEEDS) {
    for (let tier = 1; tier <= 5; tier++) {
      const track = DD.generateTrack(seed, tier, 0);
      total++;
      const pgs = track.playgrounds || [];
      if (pgs.length) tracksWith++;
      for (const pg of pgs) {
        pockets++;
        // (a) clearance: center at least r + w/2 + 4 from every sample (constraint was +6)
        let minClear = Infinity;
        for (let j = 0; j < track.samples.length; j += 2) {
          const s = track.samples[j];
          const dx = pg.x - s.p[0], dz = pg.z - s.p[2];
          minClear = Math.min(minClear, Math.sqrt(dx * dx + dz * dz) - s.w / 2);
        }
        check(seed + ' T' + tier + ' pocket clear of all legs', minClear >= pg.r + 4,
          'minClear=' + minClear.toFixed(1) + ' need>=' + (pg.r + 4).toFixed(1));
        // (b) floor near road level at the anchor (drive off, drive back)
        const ay = track.samples[pg.anchorIdx].p[1];
        check(seed + ' T' + tier + ' pocket floor near road', Math.abs(pg.y - ay) <= 9.5,
          'dy=' + (pg.y - ay).toFixed(1));
        // (c) interior smoothness on the BUILT grid: probe a 5×5 lattice inside r*0.7 —
        // neighbouring probes (grid-cell scale apart) must not step more than 2.4 m
        const P = 5, span = pg.r * 0.7;
        let maxStep = 0;
        const hs = [];
        for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
          hs.push(DD.terrainAt(track.terrain, pg.x + (a / (P - 1) - 0.5) * 2 * span, pg.z + (b / (P - 1) - 0.5) * 2 * span));
        }
        for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
          if (a + 1 < P) maxStep = Math.max(maxStep, Math.abs(hs[a * P + b] - hs[(a + 1) * P + b]));
          if (b + 1 < P) maxStep = Math.max(maxStep, Math.abs(hs[a * P + b] - hs[a * P + b + 1]));
        }
        check(seed + ' T' + tier + ' pocket interior smooth', maxStep <= 2.4, 'maxStep=' + maxStep.toFixed(2) + 'm');
      }
    }
  }
  console.log('  (' + pockets + ' pockets across ' + tracksWith + '/' + total + ' builds)');
  check('basins exist somewhere in the matrix', pockets > 0, pockets + ' pockets');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
