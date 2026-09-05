// The qr coral must not talk to a server. It renders its own content — that is precisely the rule
// that lets it live on a Card (`docs/PLAN-card-site-convergence.md` §三: a coral is admissible iff
// it needs no external fetch). It also used to be false: the owner edit-mode picker POSTed to
// `/api/update-settings` on the Heroku Python app, dead on every native card but very much present
// in the bundle. Cut 2026-07-29; this gate is what stops it walking back in — the next person to
// re-lift something from qr-anim.js gets a failing test instead of a silent umbilical.
//
// 🔴 This file asserts on the BUILT artifact (qr.js), not the source. The source is generated, and
// a check that only reads the generator would pass while shipping something else.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const built = fs.readFileSync(join(DIR, 'qr.js'), 'utf8');
const legacy = fs.readFileSync(join(DIR, 'qr-anim.legacy.js'), 'utf8');

/** Network calls the coral would make at runtime. Kept as one list so the message names the culprit. */
const NETWORK = [/\bfetch\s*\(/, /XMLHttpRequest/, /navigator\.sendBeacon/, /new\s+WebSocket/, /import\s*\(/];

test('qr coral makes no network calls — it computes its own matrix', () => {
  for (const re of NETWORK) {
    assert.equal(built.match(re), null, `built qr.js contains ${re} — a coral that fetches cannot live on a Card`);
  }
});

test('no owner edit-mode picker, and no route back to the Python app', () => {
  for (const dead of ['_coralEditMode', 'update-settings', 'guild_id', 'site_01KWXZGR6MAMH6ZD149FQSQ4GP']) {
    assert.ok(!built.includes(dead), `built qr.js still mentions ${dead}`);
  }
});

// CONTROL — without this, "all clear" and "the check is looking at the wrong string" are the same
// result. The legacy source is the thing the gate was built to catch: it MUST trip every assertion
// above. If this test ever fails, the gate above has stopped meaning anything.
test('CONTROL: the same gate fires on the legacy source it was written to catch', () => {
  assert.ok(NETWORK.some((re) => re.test(legacy)), 'legacy qr-anim.js has no fetch — gate proves nothing');
  assert.ok(legacy.includes('_coralEditMode'), 'legacy qr-anim.js has no picker — gate proves nothing');
  assert.ok(legacy.includes('update-settings'), 'legacy qr-anim.js has no Heroku POST — gate proves nothing');
});

// 🔴 The coral is MULTI-TENANT. It was lifted from a file that only ever ran on one card, so every
// colour in it was that card's — correct there, and one creator's brand appearing on another's page
// here. `#b890e8` is one creator's accent, and it painted QR cells on ANOTHER creator's card. Every colour the coral
// paints must come from the host's tokens; a hex literal in this bundle is by definition somebody's.
test('the QR paints the HOST card\'s accent — no tenant colour is baked in', () => {
  assert.ok(!built.includes('b890e8'), "built qr.js still bakes a creator's accent — it will paint on every other card");
  // …and not by having stopped painting. 🔴 The assertion is on the BUILT file, so it must not
  // assume the source's spelling: the bundler rewrites `cl.style.background='…'` into
  // `….background = "…"`. Match the assignment of the token as a whole string instead.
  // Measured across the change: HEAD had 1 (the initial fill), the fix has 7 (that one plus the six
  // cell paths in modes I and K). A count is the discriminator, so it is written as one.
  const uses = (built.match(/=\s*"var\(--cp-accent\)"/g) || []).length;
  assert.ok(uses >= 7, `expected the cell paths to paint var(--cp-accent); found ${uses}`);
});

test('CONTROL: the tenant-colour gate fires on the legacy source', () => {
  assert.ok(legacy.includes('b890e8'), 'legacy qr-anim.js has no baked accent — the gate above proves nothing');
  // and the count really discriminates: the pre-fix bundle had exactly one such assignment
  assert.ok((legacy.match(/=\s*['"]var\(--cp-accent\)['"]/g) || []).length < 7,
    'the legacy source already assigns the token seven times — the count above separates nothing');
});

// The cut was surgical: everything chodaict tuned is still in the bundle. Named individually so a
// failure says WHICH part of the 表演 went missing rather than "the file got smaller".
test('the 表演 survived intact — 11 modes, morph, and the focus trap', () => {
  for (const mode of ['_modeA', '_modeB', '_modeC', '_modeD', '_modeE', '_modeF', '_modeG', '_modeH', '_modeI', '_modeJ', '_modeK']) {
    assert.ok(built.includes(`function ${mode}(`), `mode ${mode} missing from the bundle`);
  }
  for (const piece of ['_backCircle', 'aria-modal', '_qrTrapHandler', '_qrEscHandler', '_qrReroll', 'qr-modal-title']) {
    assert.ok(built.includes(piece), `${piece} missing — the popup lost part of its behaviour`);
  }
});
