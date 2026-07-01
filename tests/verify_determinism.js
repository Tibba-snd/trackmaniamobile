/* DRIFTDREAM determinism test suite.
   Checks that generating a track multiple times for the same seed/tier produces identical results,
   verifying that theme generation and other modules do not leak or shift the RNG stream. */
'use strict';

const assert = require('assert');

// Require game files
require('../js/core.js');
require('../js/theme.js');
require('../js/trackgen.js');
require('../js/physics.js');

const DD = globalThis.DD;

const SEEDS = [
  'DREAM-12345',
  'DAILY-20260616',
  'CAMP-T1-01',
  'CAMP-T2-04',
  'CAMP-T3-08',
  'CAMP-T4-10',
  'CAMP-T5-01',
  'JUMPSEED-0',
  'FLAT'
];

let failed = false;

function verifySeed(seed, tier) {
  console.log(`Verifying seed: ${seed}, tier: ${tier}`);
  
  // Generate first time
  const track1 = DD.buildValidTrack(seed, tier);
  // Generate second time
  const track2 = DD.buildValidTrack(seed, tier);

  try {
    assert.strictEqual(track1.samples.length, track2.samples.length, `Sample length mismatch: ${track1.samples.length} vs ${track2.samples.length}`);
    for (let i = 0; i < track1.samples.length; i++) {
      const s1 = track1.samples[i];
      const s2 = track2.samples[i];
      
      // Compare position coordinates
      for (let j = 0; j < 3; j++) {
        assert.strictEqual(s1.p[j], s2.p[j], `Sample ${i} position coordinate ${j} mismatch for seed ${seed}: ${s1.p[j]} vs ${s2.p[j]}`);
        assert.strictEqual(s1.f[j], s2.f[j], `Sample ${i} forward vector ${j} mismatch for seed ${seed}`);
        assert.strictEqual(s1.u[j], s2.u[j], `Sample ${i} up vector ${j} mismatch for seed ${seed}`);
        assert.strictEqual(s1.r[j], s2.r[j], `Sample ${i} right vector ${j} mismatch for seed ${seed}`);
      }
      
      // Compare angles and widths
      assert.strictEqual(s1.yaw, s2.yaw, `Sample ${i} yaw mismatch for seed ${seed}`);
      assert.strictEqual(s1.pitch, s2.pitch, `Sample ${i} pitch mismatch for seed ${seed}`);
      assert.strictEqual(s1.bank, s2.bank, `Sample ${i} bank mismatch for seed ${seed}`);
      assert.strictEqual(s1.w, s2.w, `Sample ${i} width mismatch for seed ${seed}`);
      assert.strictEqual(s1.surf, s2.surf, `Sample ${i} surf mismatch for seed ${seed}`);
      assert.strictEqual(s1.wall, s2.wall, `Sample ${i} wall mismatch for seed ${seed}`);
      assert.strictEqual(s1.gap, s2.gap, `Sample ${i} gap mismatch for seed ${seed}`);
      assert.strictEqual(s1.pieceName, s2.pieceName, `Sample ${i} pieceName mismatch for seed ${seed}`);
    }

    // Compare terrain
    const t1 = track1.terrain;
    const t2 = track2.terrain;
    
    assert.strictEqual(t1.minX, t2.minX, `Terrain minX mismatch`);
    assert.strictEqual(t1.minZ, t2.minZ, `Terrain minZ mismatch`);
    assert.strictEqual(t1.stepX, t2.stepX, `Terrain stepX mismatch`);
    assert.strictEqual(t1.stepZ, t2.stepZ, `Terrain stepZ mismatch`);
    assert.strictEqual(t1.res, t2.res, `Terrain resolution mismatch`);
    
    assert.strictEqual(t1.heights.length, t2.heights.length, `Terrain heights length mismatch`);
    for (let i = 0; i < t1.heights.length; i++) {
      assert.strictEqual(t1.heights[i], t2.heights[i], `Terrain height at index ${i} mismatch: ${t1.heights[i]} vs ${t2.heights[i]}`);
    }

    // Compare theme parameters
    const keys = ['skyHorizon', 'skyBand', 'skyTop', 'sunColor', 'groundColor', 'accent', 'accent2', 'trackLow', 'trackHigh', 'fogColor', 'fogNear', 'fogFar'];
    for (const key of keys) {
      const v1 = track1.theme[key];
      const v2 = track2.theme[key];
      if (Array.isArray(v1)) {
        for (let j = 0; j < v1.length; j++) {
          assert.strictEqual(v1[j], v2[j], `Theme key ${key} index ${j} mismatch`);
        }
      } else {
        assert.strictEqual(v1, v2, `Theme key ${key} mismatch`);
      }
    }
    console.log(`  PASS: ${seed} (tier ${tier}) is deterministic.`);
  } catch (err) {
    console.log(`  FAIL: ${seed} (tier ${tier}) failed determinism check!`);
    console.error(err);
    failed = true;
  }
}

console.log("Starting determinism verification...");
for (const seed of SEEDS) {
  for (let tier = 1; tier <= 5; tier++) {
    verifySeed(seed, tier);
  }
}

if (failed) {
  console.log("Result: DETERMINISM CHECK FAILED");
  process.exit(1);
} else {
  console.log("Result: ALL DETERMINISM CHECKS PASSED SUCCESSFULLY");
  process.exit(0);
}
