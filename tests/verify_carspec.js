/* DRIFTDREAM carspec test — the garage foundation (schema clamps, normalizeSpec guardrail,
   createCustomDesign, resolveSpec, and the loadSave custom-designs migration).
   THREE-free — runs under Node like the other sim tests. Run: node tests/verify_carspec.js */
'use strict';

require('../js/core.js');
require('../js/carspec.js');
const DD = globalThis.DD;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  FAIL: ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// 1. Every locked preset normalizes, and the NEW fields default to the pre-change look (backward-compat).
DD.CAR_PRESETS.forEach((p, i) => {
  const n = DD.normalizeSpec(p);
  eq(n.chassis.hull.capStyleFront, 'flat', `preset ${i} capStyleFront default`);
  eq(n.chassis.hull.capStyleRear, 'flat', `preset ${i} capStyleRear default`);
  eq(n.chassis.hardpoints.rimRadiusPct, 0.82, `preset ${i} rimRadiusPct default (== old hardcoded 0.82)`);
  eq(n.chassis.hardpoints.tyreRoundness, 0, `preset ${i} tyreRoundness default (== old flat cylinder)`);
  eq(n.chassis.hardpoints.spokeCount, null, `preset ${i} spokeCount default null (== style native count)`);
  ok(Array.isArray(n.chassis.hull.station) && n.chassis.hull.station.length >= 2, `preset ${i} station intact`);
});

// 2. normalize is idempotent: normalize(normalize(x)) deep-equals normalize(x).
DD.CAR_PRESETS.forEach((p, i) => {
  const a = DD.normalizeSpec(p), b = DD.normalizeSpec(a);
  ok(JSON.stringify(a) === JSON.stringify(b), `preset ${i} normalize idempotent`);
});

// 3. Range clamps + enum coercion.
const s = DD.normalizeSpec({ chassis: { hardpoints: { rimRadiusPct: 5, tyreRoundness: -1, spokeCount: 99 },
  hull: { capStyleFront: 'banana', capStyleRear: 'pointed' } } });
eq(s.chassis.hardpoints.rimRadiusPct, 0.9, 'rimRadiusPct clamp hi');
eq(s.chassis.hardpoints.tyreRoundness, 0, 'tyreRoundness clamp lo');
eq(s.chassis.hardpoints.spokeCount, 8, 'spokeCount clamp hi');
eq(s.chassis.hull.capStyleFront, 'flat', 'invalid capStyle -> flat');
eq(s.chassis.hull.capStyleRear, 'pointed', 'valid capStyle kept');

// 4. Knob safety: non-finite numbers + non-primitives dropped, valid values kept.
const k = DD.normalizeSpec({ mounts: [{ part: 'lightBar', knobs: { len: 1.3, x: Infinity, y: NaN, bad: {}, tag: 'ok', flag: true } }] });
const kn = k.mounts[0].knobs;
eq(kn.len, 1.3, 'finite knob kept');
ok(!('x' in kn), 'Infinity knob dropped');
ok(!('y' in kn), 'NaN knob dropped');
ok(!('bad' in kn), 'object knob dropped');
eq(kn.tag, 'ok', 'string knob kept');
eq(kn.flag, true, 'bool knob kept');

// 5. Unknown part names are dropped (forward-compat).
const up = DD.normalizeSpec({ mounts: [{ part: 'frontWing' }, { part: 'notAThing' }] });
eq(up.mounts.length, 1, 'unknown part dropped');
eq(up.mounts[0].part, 'frontWing', 'known part kept');

// 6. id passthrough (custom designs carry an id; presets do not).
eq(DD.normalizeSpec({ id: 'cd7' }).id, 'cd7', 'id preserved');
eq(DD.normalizeSpec({}).id, null, 'no id -> null');

// 7. createCustomDesign — stable id, default + custom name, provenance, deterministic, renderable.
const cd = DD.createCustomDesign(0, 3);
eq(cd.id, 'cd3', 'createCustomDesign id from seq');
eq(cd.name, 'My Design 3', 'createCustomDesign default name');
eq(cd.basePreset, 'apex', 'createCustomDesign keeps basePreset');
ok(cd.chassis.hull.station.length >= 2, 'createCustomDesign is renderable');
eq(DD.createCustomDesign(1, 4, 'Speedy').name, 'Speedy', 'createCustomDesign custom name');
ok(JSON.stringify(DD.createCustomDesign(2, 5)) === JSON.stringify(DD.createCustomDesign(2, 5)),
  'createCustomDesign deterministic (no Math.random / Date.now)');

// 8. resolveSpec backward-compat: no customDesigns arg -> locked preset for garage.form, paint layered.
const r0 = DD.resolveSpec({ grad: 3, finish: 2, form: 1 });
eq(r0.basePreset, 'endurance', 'resolveSpec form 1 -> Endurance');
eq(r0.gallery.grad, 3, 'resolveSpec garage paint overrides grad');
eq(r0.gallery.finish, 2, 'resolveSpec garage paint overrides finish');
eq(r0.id, null, 'resolveSpec preset path has null id');

// 9. resolveSpec with an active custom design present -> that design drives.
const designs = [DD.createCustomDesign(3, 1, 'MyCigar')]; // id cd1
const ra = DD.resolveSpec({ grad: 0, finish: 1, form: 0, activeCustom: 'cd1' }, designs);
eq(ra.id, 'cd1', 'resolveSpec returns active custom design');
eq(ra.name, 'MyCigar', 'resolveSpec active custom name');

// 10. resolveSpec active custom not found -> falls back to the locked preset for garage.form.
const rb = DD.resolveSpec({ grad: 0, finish: 1, form: 2, activeCustom: 'cdMISSING' }, designs);
eq(rb.basePreset, 'neon', 'resolveSpec missing custom -> preset form 2 (Neon)');
eq(rb.id, null, 'resolveSpec fallback preset has null id');

// 11. loadSave gains the custom-designs fields (additive migration; testMode so nothing persists).
DD.testMode = true;
const save = DD.loadSave();
ok(Array.isArray(save.customDesigns), 'loadSave: customDesigns is an array');
eq(save.garage.activeCustom, null, 'loadSave: garage.activeCustom default null');
eq(typeof save.meta.customSeq, 'number', 'loadSave: meta.customSeq is a number');

// 12. The load-time guardrail path (a hand-edited/legacy design is re-normalized on load).
eq(DD.normalizeSpec({ chassis: { hardpoints: { rimRadiusPct: 99 } } }).chassis.hardpoints.rimRadiusPct, 0.9,
  'load-path normalize clamps an out-of-range design');

// 13. migrate() stamps schemaVersion and is idempotent + pure (does not mutate input).
const migIn = { chassis: { hardpoints: {} } };
const migOut = DD.migrate(migIn);
eq(migOut.schemaVersion, DD.SCHEMA_VERSION, 'migrate stamps current schemaVersion');
eq(migIn.schemaVersion, undefined, 'migrate is pure — input untouched');
eq(DD.migrate(migOut).schemaVersion, DD.SCHEMA_VERSION, 'migrate idempotent');

// 14. encodeShareCode / decodeShareCode round-trip — every preset survives the journey with its
//     chassis/canopy/mounts/wheels intact and the player-local id/name stripped.
DD.CAR_PRESETS.forEach((preset, i) => {
  const code = DD.encodeShareCode(preset);
  ok(typeof code === 'string' && code.indexOf('DD1:') === 0, 'preset ' + i + ' encodes with DD1: prefix');
  const decoded = DD.decodeShareCode(code);
  ok(decoded != null, 'preset ' + i + ' decodes to a valid spec');
  eq(decoded.id, null, 'preset ' + i + ' share code strips id');
  eq(decoded.wheelStyle, preset.wheelStyle, 'preset ' + i + ' wheelStyle survives round-trip');
  eq(decoded.chassis.hull.station.length, preset.chassis.hull.station.length,
    'preset ' + i + ' hull station count survives round-trip');
});

// 15. decodeShareCode rejects malformed codes gracefully (returns null, never throws).
eq(DD.decodeShareCode('not-a-real-code!!!'), null, 'malformed share code returns null');
eq(DD.decodeShareCode('DD1:' + '!!!garbage'), null, 'garbage after prefix returns null');
eq(DD.decodeShareCode(null), null, 'null input returns null');
eq(DD.decodeShareCode(123), null, 'non-string input returns null');

// 16. decodeShareCode re-normalizes, so an out-of-range value embedded in a foreign code is clamped.
const foreignCode = DD.encodeShareCode({ chassis: { hardpoints: { frontR: 99 } }, schemaVersion: 1 });
eq(DD.decodeShareCode(foreignCode).chassis.hardpoints.frontR, DD.CAR_SCHEMA.frontR[1],
  'foreign share code with out-of-range frontR is clamped on decode');

console.log(`\ncarspec: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
