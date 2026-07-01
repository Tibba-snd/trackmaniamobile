/* DRIFTDREAM sky color validation — run with: node tests/verify_colors.js */
'use strict';

require('../js/core.js');
require('../js/theme.js');

const DD = globalThis.DD;

let pass = 0, fail = 0;

function assert(name, condition, detail) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL: ${name} ${detail || ''}`);
  }
}

// Helper to convert RGB [0..1] back to HSL [0..360, 0..1, 0..1]
// This is to verify that the RGB colors generated actually fall within the expected HSL bands.
function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [Math.round(h * 360), parseFloat(s.toFixed(4)), parseFloat(l.toFixed(4))];
}

console.log("Validating sky colors for 500 random seeds...");

for (let i = 0; i < 500; i++) {
  const seed = "SEED_" + i + "_" + Math.random().toString(36).substring(2, 7);
  const theme = DD.makeTheme(seed);

  // Convert RGB back to HSL for checking
  const [hHorizon, sHorizon, lHorizon] = rgbToHsl(...theme.skyHorizon);
  const [hBand, sBand, lBand] = rgbToHsl(...theme.skyBand);
  const [hTop, sTop, lTop] = rgbToHsl(...theme.skyTop);

  // 1. Validate Peach Horizon
  // Hue should be warm (red-orange to orange-yellow): 15 to 33 degrees
  // Saturation should be high: 0.75 to 0.85
  // Lightness should be mid-light: 0.60 to 0.65
  assert(`Horizon Hue for ${seed}`, hHorizon >= 15 && hHorizon <= 33, `Hue: ${hHorizon}° (expected 15°-33°)`);
  assert(`Horizon Sat for ${seed}`, sHorizon >= 0.75 && sHorizon <= 0.85, `Sat: ${sHorizon} (expected 0.75-0.85)`);
  assert(`Horizon Lit for ${seed}`, lHorizon >= 0.60 && lHorizon <= 0.65, `Lit: ${lHorizon} (expected 0.60-0.65)`);

  // 2. Validate Lilac Band
  // Hue should be purple/violet: 265 to 285 degrees
  // Saturation should be moderate: 0.45 to 0.55
  // Lightness should be mid-level: 0.52 to 0.58
  assert(`Band Hue for ${seed}`, hBand >= 265 && hBand <= 285, `Hue: ${hBand}° (expected 265°-285°)`);
  assert(`Band Sat for ${seed}`, sBand >= 0.45 && sBand <= 0.55, `Sat: ${sBand} (expected 0.45-0.55)`);
  assert(`Band Lit for ${seed}`, lBand >= 0.52 && lBand <= 0.58, `Lit: ${lBand} (expected 0.52-0.58)`);

  // 3. Validate Deep Blue Top
  // Hue should be blue/dark blue: 220 to 250 degrees
  // Saturation should be moderate-high: 0.50 to 0.60
  // Lightness should be dark: 0.08 to 0.16
  assert(`Top Hue for ${seed}`, hTop >= 220 && hTop <= 250, `Hue: ${hTop}° (expected 220°-250°)`);
  assert(`Top Sat for ${seed}`, sTop >= 0.50 && sTop <= 0.60, `Sat: ${sTop} (expected 0.50-0.60)`);
  assert(`Top Lit for ${seed}`, lTop >= 0.08 && lTop <= 0.16, `Lit: ${lTop} (expected 0.08-0.16)`);
}

console.log(`\nSky Color Verification Summary:`);
console.log(`${pass} assertions passed.`);
if (fail > 0) {
  console.error(`${fail} assertions FAILED.`);
  process.exit(1);
} else {
  console.log(`Sunset Palette color specs: ALL PASSED.`);
  process.exit(0);
}
