// tile#304 r3 — an object stopped partway through a commit completes it itself (review r2 #1)
//
// 🔴 Every state a crash can leave the handle's object in is finished by the object, without waiting
// for another write: the alarm that publishes a pending change is armed in the same storage write as
// the change (so no state that owes KV exists without it), and an object that starts and finds such a
// state with no alarm arms one before it answers.
//
// The cut table: each commit below is run once whole, to list its mutating operations (the object's
// storage puts, deletes and alarm, and its KV puts and deletes); then once per cut point k, with the
// object stopped after its first k operations (languages-harness.mjs `stoppedAfter`). After the restart,
// the alarm fires once if one is set — nothing else happens — and then the object's truth and what a
// visitor is served must agree (`disagreements`), and the truth is either the state before the commit
// or the state after it.
//
// run: node --test packages/cardtile/serve/languages-crash.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAIN, PLAIN, JA, GIF, call, save, saveLang, withMain, withJapanese,
  stoppedAfter, heldState, disagreements, mainMetadata, visit, quiet,
} from './languages-harness.mjs';
import { thinCard } from '../card-save.mjs';

const JA2 = JA.replace('イラストレーター。', '新しい日本語。');
const NO_JA = MAIN.replace('locales: [en-US, ja-JP, zh-TW]', 'locales: [en-US, zh-TW]');
const PNG = Buffer.from('replacement asset bytes').toString('base64');
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.json)); return r; };

// what each commit is, from which state, and how to tell its two outcomes apart
const COMMITS = [
  { name: 'a language PUT replacing a live file', setup: withJapanese,
    act: (env) => saveLang(env, 'ja-JP', JA2),
    outcome: (h) => (h.file('ja-JP') === JA ? 'before' : h.file('ja-JP') === JA2 ? 'after' : null) },
  { name: 'a language DELETE', setup: withJapanese,
    act: (env) => call(env, 'DELETE', '/_api/card/t/lang/ja-JP'),
    outcome: (h) => (h.file('ja-JP') === JA ? 'before' : !h.languages['ja-JP'] ? 'after' : null) },
  { name: 'a main save that drops a language', setup: withJapanese,
    act: (env) => save(env, thinCard(NO_JA)),
    outcome: (h) => (h.main === MAIN && h.file('ja-JP') === JA ? 'before' : h.main === NO_JA && !h.languages['ja-JP'] ? 'after' : null) },
  { name: 'an asset replaced (put_asset) on a Card with a language file', setup: withJapanese,
    act: (env) => call(env, 'PUT', '/_api/card/t/asset/pic', { base64: PNG, mime: 'image/gif' }),
    outcome: (h) => (h.main.includes(GIF) && h.file('ja-JP') === JA ? 'before' : h.main.includes(PNG) && h.file('ja-JP') === JA ? 'after' : null) },
  { name: 'a main save of a Card with no `locales:`', setup: () => withMain({}, PLAIN),
    act: (env) => save(env, thinCard(PLAIN.replace('Illustrator.', 'Painter.'))),
    outcome: (h) => (h.main === PLAIN ? 'before' : h.main === PLAIN.replace('Illustrator.', 'Painter.') ? 'after' : null) },
];

for (const c of COMMITS) {
  test(`🔴 cut table — ${c.name}: stopped after any of its operations, restarted, one alarm later the object and visitors agree`, async (t) => {
    const whole = await stoppedAfter(c.setup, c.act, Infinity);
    assert.equal(whole.died, false);
    ok(whole.result);
    assert.equal(c.outcome(heldState(whole.env)), 'after');
    assert.deepEqual(await disagreements(whole.env), [], 'CONTROL: the whole commit agrees with no alarm at all');
    const n = whole.log.length;
    assert.ok(n >= 3, `the commit has operations to cut between (${n})`);
    let after = 0;
    for (let k = 0; k <= n; k++) {
      const run = await stoppedAfter(c.setup, c.act, k);
      const fired = await run.env.CARD_LIFETIMES.tick('t');
      const outcome = c.outcome(heldState(run.env));
      const wrong = await disagreements(run.env);
      t.diagnostic(`cut ${k}/${n} after: ${k ? run.log[k - 1] : '(nothing)'} | answer ${run.result && run.result.status} | alarm ${fired ? 'fired' : 'none'} | truth ${outcome} | ${wrong.length ? wrong.join('; ') : 'agree'}`);
      assert.ok(outcome, `cut ${k}: the object holds neither the state before the commit nor the state after it`);
      assert.deepEqual(wrong, [], `cut ${k} (after "${k ? run.log[k - 1] : 'nothing'}"), alarm ${fired ? 'fired' : 'never armed'}`);
      if (outcome === 'after') after++;
    }
    assert.ok(after >= 1, 'some cut point is past the commit');
  });
}

// ── the reviewer's ruler: .lane-receipts/review-rulers/language-commit-crash.mjs ─────────────────

test('🔴 review r2 #1 — stopped right after the durable commit of a replacement, the object publishes it on its own (port of language-commit-crash.mjs)', async () => {
  let oldRev;
  const run = await stoppedAfter(async () => {
    const env = await withJapanese();
    oldRev = (await mainMetadata(env)).languages['ja-JP'];
    return env;
  }, (env) => {
    // stop the object the moment its storage names the new revision, before anything reaches KV
    env.CARD_LIFETIMES.storageOf('t').cut.when = () => { const r = heldState(env).languages['ja-JP']; return !!r && r !== oldRev; };
    return saveLang(env, 'ja-JP', JA2);
  }, Infinity);
  const { env } = run;
  assert.equal(run.died, true, 'the object was stopped');
  assert.equal(run.result.status, 500);
  const held = heldState(env);
  assert.notEqual(held.languages['ja-JP'], oldRev, 'the commit is durable: the object names the new file');
  assert.equal((await mainMetadata(env)).languages['ja-JP'], oldRev, 'KV still names the previous file');
  assert.notEqual(env.CARD_LIFETIMES.storageOf('t')._alarm, null, 'the alarm was armed with the commit');
  assert.equal(await env.CARD_LIFETIMES.tick('t'), true);
  assert.equal((await mainMetadata(env)).languages['ja-JP'], held.languages['ja-JP']);
  const page = await visit(env, '/t?lang=ja-JP');
  assert.match(page.body, /新しい日本語/);
  assert.doesNotMatch(page.body, /イラストレーター/);
  assert.deepEqual(await disagreements(env), []);
});

test('🔴 a restarted object that finds a commit KV does not have, and no alarm, arms one before it answers anything', async () => {
  let oldRev;
  const run = await stoppedAfter(async () => {
    const env = await withJapanese();
    oldRev = (await mainMetadata(env)).languages['ja-JP'];
    return env;
  }, (env) => {
    env.CARD_LIFETIMES.storageOf('t').cut.when = () => { const r = heldState(env).languages['ja-JP']; return !!r && r !== oldRev; };
    return saveLang(env, 'ja-JP', JA2);
  }, Infinity);
  const { env } = run;
  const storage = env.CARD_LIFETIMES.storageOf('t');
  storage._alarm = null; // lost: as if it had fired and been consumed before the crash, or never set (r2)
  // a visitor reads KV only: the object is not involved, and nothing changes
  assert.match((await visit(env, '/t?lang=ja-JP')).body, /イラストレーター/);
  // the object's first request after the restart — a read that writes nothing of the Card (r15)
  ok(await call(env, 'GET', '/_api/card/t/lifetime'));
  assert.notEqual(storage._alarm, null, 'the restarted object armed the alarm before it answered');
  assert.equal(await env.CARD_LIFETIMES.tick('t'), true);
  assert.deepEqual(await disagreements(env), []);
  assert.match((await visit(env, '/t?lang=ja-JP')).body, /新しい日本語/);
  // and with nothing owed, a restarted object arms nothing
  await quiet(env);
  env.CARD_LIFETIMES.restart('t');
  ok(await call(env, 'GET', '/_api/card/t/lifetime'));
  assert.equal(storage._alarm, null, 'CONTROL: nothing pending, no alarm');
});
