// Owner rule 2: every screen answers three questions — what is this, what can I do here, what
// happens next. These pin the sentences that answer them, in all nine locales, so a screen cannot
// quietly lose its answer in one language.
//
//   node --test packages/cardtile/w2/three-questions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_STRINGS_BY_KEY } from '../w/cell-i18n.mjs';
import { LOCALE_KEYS, CHROME_STRINGS, SANDBOX_LOCALES } from '../w/sandbox-i18n.mjs';
import { BOARD_STRINGS_BY_KEY } from './board-i18n.mjs';
import { CELL_TYPES, PALETTE, DISPOSITION } from '../ai-ops.mjs';

const NINE = ['en', 'zh', 'ja', 'zh-Hans', 'ko', 'de', 'fr', 'es', 'pt'];
const filled = (table, key) => NINE.filter((l) => !(typeof table[key]?.[l] === 'string' && table[key][l].trim()));

test('the nine here are the sandbox’s nine', () => {
  assert.deepEqual([...LOCALE_KEYS].sort(), [...NINE].sort());
});

test('every kind in the picker has a title AND a one-line description in all nine', () => {
  assert.equal(PALETTE.length, 7);
  const gaps = [];
  for (const t of PALETTE) {
    const def = CELL_TYPES[t];
    for (const key of [def.title, def.hint]) {
      assert.ok(key, `${t}: no key`);
      for (const l of filled(CELL_STRINGS_BY_KEY, key)) gaps.push(`${key}/${l}`);
    }
  }
  assert.deepEqual(gaps, []);
});

test('every field with a helper line has it in all nine (none is blank anywhere)', () => {
  const gaps = [];
  let n = 0;
  for (const t of PALETTE) {
    const def = CELL_TYPES[t];
    const hints = [];
    if (def.body?.hint) hints.push(def.body.hint);
    for (const p of Object.values(def.params)) if (p.disposition === DISPOSITION.FORM && p.hint) hints.push(p.hint);
    for (const r of (def.form || []).flatMap((r) => (r.group ? r.rows : [r]))) if (r.hint) hints.push(r.hint);
    for (const key of new Set(hints)) {
      if (!CELL_STRINGS_BY_KEY[key]) continue;   // not a table key (a RAW-only note) — never shown
      n++;
      for (const l of filled(CELL_STRINGS_BY_KEY, key)) gaps.push(`${key}/${l}`);
    }
  }
  assert.ok(n >= 12, `only ${n} helper lines scanned`);
  assert.deepEqual(gaps, []);
});

test('the Video sheet says which address it takes — an example in every locale', () => {
  for (const l of NINE) {
    assert.match(CELL_STRINGS_BY_KEY['type.video.yt.hint'][l], /watch\?v=dQw4w9WgXcQ/, l);
    assert.match(CELL_STRINGS_BY_KEY['type.video.channel.hint'][l], /youtube\.com\/channel\//, l);
  }
});

test('the Board, Markdown and picker one-liners exist in all nine, with their slots', () => {
  const need = { 'board.tableHint': ['{front}'], 'board.mdLead': ['{back}'], 'board.pickWhere': ['{lane}'], 'board.pickTitle': [] };
  for (const [key, slots] of Object.entries(need)) {
    assert.deepEqual(filled(BOARD_STRINGS_BY_KEY, key), [], key);
    for (const l of NINE) for (const s of slots) assert.ok(BOARD_STRINGS_BY_KEY[key][l].includes(s), `${key}/${l} lacks ${s}`);
  }
  // the slots are filled from strings that exist in all nine
  for (const l of NINE) {
    assert.ok(CHROME_STRINGS[l].faceTabLabel && CHROME_STRINGS[l].mdBack, l);
  }
});

test('the door says what happens next in all nine: sign in by email, and the card comes along', () => {
  for (const l of NINE) {
    const s = SANDBOX_LOCALES[l];
    for (const k of ['doorCta', 'doorNote', 'doorContinue', 'doorBack']) assert.ok(s[k]?.trim(), `${k}/${l}`);
    assert.match(s.doorNote, /e-?mail|correo|メール|이메일/i, l);
  }
});

test('🔴 the coach mark never covers the card: it sits in flow above the frame, at every width', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('./edit2.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]*\.ctw-coach[^{}]*)\{([^}]*)\}/g)].filter((m) => /\.ctw-coach\s*$/.test(m[1].trim().split(',').pop()));
  assert.ok(rules.length >= 1, 'no .ctw-coach rule found — the check is reading nothing');
  for (const m of rules) assert.doesNotMatch(m[2], /position:\s*(absolute|fixed)/, `overlaying rule: ${m[1].trim()}`);
  assert.match(css, /\.ctw-w2-preview\s*\{\s*flex-direction:\s*column/);
  // control: the old overlay would have been caught
  assert.match('position: absolute; top: 14px', /position:\s*(absolute|fixed)/);
});

test('youtubeRef: what the share button gives a person → the id or channel code the card stores', async () => {
  const { youtubeRef } = await import('../w/cell-form-core.mjs');
  const ID = 'dQw4w9WgXcQ', CH = 'UCabcdefghijklmnopqrstuv';
  const table = [
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`youtube.com/watch?v=${ID}&t=42s&list=PL1`, ID],
    [`https://m.youtube.com/watch?feature=share&v=${ID}`, ID],
    [`https://youtu.be/${ID}?si=abc123`, ID],
    [`youtu.be/${ID}`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://www.youtube.com/embed/${ID}?start=10`, ID],
    [`  ${ID}  `, ID],
    [`https://www.youtube.com/channel/${CH}`, CH],
    [`youtube.com/channel/${CH}/videos`, CH],
    [CH, CH],
    ['', ''],
  ];
  for (const [input, want] of table) assert.equal(youtubeRef(input), want, input);
  // controls: things that are not a video or channel are left exactly as typed
  for (const other of ['https://video.example/123456789', 'https://example.com/watch?v=dQw4w9WgXcQ', 'youtube.com/@somebody', 'hello']) {
    assert.equal(youtubeRef(other), other, other);
  }
});

test('the Video sheet stores the id when a link is pasted (composeCell, end to end)', async () => {
  const { composeCell } = await import('../w/cell-form-core.mjs');
  const vals = { __body: '', yt: 'https://youtu.be/dQw4w9WgXcQ?si=x', channel: '', poster: '', w: '' };
  const io = { read: (n) => (n in vals ? vals[n] : null), visible: () => true };
    // the def exactly as edit2.mjs builds it: FORM params become `fields`
  const v = CELL_TYPES.video;
  const def = { ...v, fields: Object.entries(v.params).filter(([, p]) => p.disposition === DISPOSITION.FORM).map(([name, p]) => ({ name, ...p })) };
  const out = composeCell({ type: 'video', rawParams: '', body: '' }, def, io, { T: {} });
  assert.match(out.rawParams, /yt=dQw4w9WgXcQ\b/);
  assert.doesNotMatch(out.rawParams, /youtu\.be/);
});
