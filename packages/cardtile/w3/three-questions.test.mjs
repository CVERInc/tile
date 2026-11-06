// Owner rule 2: every screen answers three questions — what is this, what can I do here, what
// happens next. These pin the sentences that answer them, in all nine locales, so a screen cannot
// quietly lose its answer in one language.
//
//   node --test packages/cardtile/w3/three-questions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_STRINGS_BY_KEY } from '../w/cell-i18n.mjs';
import { LOCALE_KEYS, CHROME_STRINGS, SANDBOX_LOCALES } from '../w/sandbox-i18n.mjs';
import { EDIT3_STRINGS, EDIT3_KEYS, editStrings, fmt } from './edit3-i18n.mjs';
import { CELL_TYPES, PALETTE, DISPOSITION } from '../ai-ops.mjs';

const NINE = ['en', 'zh', 'ja', 'zh-Hans', 'ko', 'de', 'fr', 'es', 'pt'];
const filled = (table, key) => NINE.filter((l) => !(typeof table[key]?.[l] === 'string' && table[key][l].trim()));

test('the nine here are the sandbox’s nine', () => {
  assert.deepEqual([...LOCALE_KEYS].sort(), [...NINE].sort());
});

test('every kind in the picker has a title AND a one-line description in all nine', () => {
  assert.equal(PALETTE.length, 8);   // reef#2725: `slides` (the carousel's own name) joined `embed` (HTML)
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
    // an example address, not a real id: examples end in an ellipsis (youtube.com/watch?v=…)
    assert.match(CELL_STRINGS_BY_KEY['type.video.yt.hint'][l], /youtube\.com\/watch\?v=/, l);
    assert.match(CELL_STRINGS_BY_KEY['type.video.channel.hint'][l], /youtube\.com\/channel\//, l);
  }
});

test('the editor answers the three questions in full in English and Traditional Chinese, with their slots', () => {
  // what is this (the row, Cards settings), what can I do (add, turn over, pair), what happens next (Save)
  for (const l of ['en', 'zh']) {
    assert.deepEqual(EDIT3_KEYS.filter((k) => !(typeof EDIT3_STRINGS[l][k] === 'string' && EDIT3_STRINGS[l][k].trim())), [], l);
  }
  const slots = { docTitle: ['{t}'], addBetween: ['{a}', '{b}'], replaced: ['{a}', '{b}'], badFile: ['{n}'], handleWarn: ['{o}'], typeOld: ['{o}'], handleDone: ['{h}'], palEcho: ['{q}'] };
  for (const l of NINE) {
    const t = editStrings(l);
    for (const [k, need] of Object.entries(slots)) for (const s of need) assert.ok(t[k].includes(s), `${k}/${l} lacks ${s}`);
    // a locale's own strings never carry a slot the English does not
    for (const [k, v] of Object.entries(EDIT3_STRINGS[l])) for (const m of v.matchAll(/\{\w+\}/g)) assert.ok(EDIT3_STRINGS.en[k].includes(m[0]), `${k}/${l} has ${m[0]}`);
  }
  assert.equal(fmt('{a} of {b}', { a: 1, b: 2 }), '1 of 2');
  assert.equal(fmt('{a} of {b}', { a: 1 }), '1 of {b}', 'a slot with no value is left as written');
});

test('the door says what happens next in all nine: sign in by email, and the card comes along', () => {
  for (const l of NINE) {
    const s = SANDBOX_LOCALES[l];
    for (const k of ['doorCta', 'doorNote', 'doorContinue', 'doorBack']) assert.ok(s[k]?.trim(), `${k}/${l}`);
    assert.match(s.doorNote, /e-?mail|correo|メール|이메일/i, l);
  }
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
    ['https://www.youtube.com/@Some.Body', '@Some.Body'],           // the channel page's share button
    ['youtube.com/@some_body/videos?si=abc', '@some_body'],
    ['https://m.youtube.com/@somebody', '@somebody'],
    ['@somebody', '@somebody'],
    [CH, CH],
    ['', ''],
  ];
  for (const [input, want] of table) assert.equal(youtubeRef(input), want, input);
  // controls: things that are not a video or channel are left exactly as typed
  for (const other of ['https://video.example/123456789', 'https://example.com/watch?v=dQw4w9WgXcQ', 'youtube.com/@ab', 'hello']) {
    assert.equal(youtubeRef(other), other, other);
  }
});

test('the Video sheet stores the id when a link is pasted (composeCell, end to end)', async () => {
  const { composeCell } = await import('../w/cell-form-core.mjs');
  const vals = { __body: '', yt: 'https://youtu.be/dQw4w9WgXcQ?si=x', channel: '', poster: '', w: '' };
  const io = { read: (n) => (n in vals ? vals[n] : null), visible: () => true };
    // the def exactly as edit3.mjs builds it: FORM params become `fields`
  const v = CELL_TYPES.video;
  const def = { ...v, fields: Object.entries(v.params).filter(([, p]) => p.disposition === DISPOSITION.FORM).map(([name, p]) => ({ name, ...p })) };
  const out = composeCell({ type: 'video', rawParams: '', body: '' }, def, io, { T: {} });
  assert.match(out.rawParams, /yt=dQw4w9WgXcQ\b/);
  assert.doesNotMatch(out.rawParams, /youtu\.be/);
});
