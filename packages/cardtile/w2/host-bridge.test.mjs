// host-bridge — the message logic of HOST MODE, without a DOM. See host-bridge.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostBridge, validHostOrigin, splitCard, readsAsCard, HOST_V } from './host-bridge.mjs';
import { parseCard, serializeCard } from '../card-core.js';
import { assembleSave } from '../card-save.mjs';

const HOST = 'https://feelreef.com';
const THIN = ['---', 'card-page: mei', 'title: 小美', '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 avatar="asset:pic" %% a bio',
  '- [ ] %% card: link w=6 %% [Instagram](https://instagram.com/x)'].join('\n') + '\n';
const FAT = serializeCard({ ...parseCard(THIN), assets: {
  pic: { mime: 'image/png', b64: 'iVBORw0K' },
  stale: { mime: 'image/png', b64: 'AAAA' },           // in the lane, referenced by nothing
} });

/** a bridge wired to recorders and a hand-cranked clock */
function rig() {
  const sent = []; const loads = []; const statuses = []; const timers = new Map(); let n = 0;
  const bridge = createHostBridge({
    host: HOST,
    post: (msg, origin) => sent.push({ msg, origin }),
    onLoad: (x) => loads.push(x),
    onStatus: (s, m) => statuses.push(m ? `${s}:${m}` : s),
    setTimer: (fn, ms) => { const id = ++n; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const tick = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  const from = (data, origin = HOST) => bridge.receive({ origin, data: { v: HOST_V, ...data } });
  return { bridge, sent, loads, statuses, timers, tick, from };
}

test('validHostOrigin: exact allowed origins only', () => {
  assert.equal(validHostOrigin('https://feelreef.com'), 'https://feelreef.com');
  assert.equal(validHostOrigin('https://feelreef.com/'), 'https://feelreef.com');
  assert.equal(validHostOrigin('https://staging.feelreef.com'), 'https://staging.feelreef.com');
  assert.equal(validHostOrigin('http://localhost:8788'), 'http://localhost:8788');
  assert.equal(validHostOrigin('http://localhost'), 'http://localhost');
  for (const bad of [undefined, '', '*', 'null', 'feelreef.com', 'http://feelreef.com', 'https://feelreef.com.evil.example',
    'https://evil.example', 'https://feelreef.com/dashboard', 'https://feelreef.com?x', 'https://a@feelreef.com',
    'https://localhost:3000', 'http://127.0.0.1:3000', 'https://FEELREEF.com:443/x']) {
    assert.equal(validHostOrigin(bad), null, String(bad));
  }
  assert.throws(() => createHostBridge({ host: '*', post() {}, onLoad() {} }));
});

test('ready → card:ready to the named origin, never *', () => {
  const r = rig();
  r.bridge.ready();
  assert.deepEqual(r.sent, [{ msg: { v: 1, type: 'card:ready' }, origin: HOST }]);
});

test('🔴 card:ready repeats every 500ms until card:load, one message shape, then stops', () => {
  const r = rig();
  r.bridge.ready();
  assert.equal(r.bridge.status, 'waiting');
  assert.equal([...r.timers.values()][0].ms, 500);
  r.tick(); r.tick(); r.tick();
  const readies = r.sent.filter((s) => s.msg.type === 'card:ready');
  assert.equal(readies.length, 4);
  for (const x of readies) assert.deepEqual(x, { msg: { v: 1, type: 'card:ready' }, origin: HOST });
  r.from({ type: 'card:load', md: THIN, handle: 'mei' });
  assert.equal(r.timers.size, 0, 'load cancels the next announcement');
  r.tick();
  assert.equal(r.sent.filter((s) => s.msg.type === 'card:ready').length, 4);
  r.bridge.ready();
  assert.equal(r.sent.length, 4, 'ready after load is a no-op');
});

test('card:ready gives up after 60s — and says so (status stays waiting, gaveUp true), never silently', () => {
  const r = rig();
  r.bridge.ready();
  let guard = 0;
  while (r.timers.size && guard++ < 1000) r.tick();
  const n = r.sent.filter((s) => s.msg.type === 'card:ready').length;
  assert.equal(n, 120, '60s / 500ms announcements');
  assert.equal(r.bridge.gaveUp, true);
  assert.equal(r.bridge.status, 'waiting');
  assert.equal(r.statuses.at(-1), 'waiting');
  // a late load still works
  r.from({ type: 'card:load', md: THIN, handle: 'mei' });
  assert.equal(r.bridge.loaded, true);
});

test('messages from any other origin are ignored — even a well-formed card:load', () => {
  const r = rig();
  for (const o of ['https://evil.example', 'null', 'https://staging.feelreef.com', '', 'https://feelreef.com/']) {
    assert.equal(r.from({ type: 'card:load', md: THIN, handle: 'mei' }, o), false);
  }
  assert.equal(r.bridge.receive({ origin: HOST, data: { type: 'card:load', md: THIN, v: 2 } }), false, 'unknown version');
  assert.deepEqual(r.loads, []);
  assert.deepEqual(r.sent, []);
});

test('card:load hands the card to the editor; a non-card answers card:load-failed', () => {
  const r = rig();
  assert.ok(r.from({ type: 'card:load', md: FAT, handle: 'mei', cardUrl: 'https://card.feelreef.com/mei', version: 'v1:x' }));
  assert.equal(r.loads.length, 1);
  assert.equal(r.loads[0].md, FAT);
  assert.equal(r.loads[0].handle, 'mei');
  assert.equal(r.loads[0].cardUrl, 'https://card.feelreef.com/mei');
  assert.equal(r.bridge.dirty, false);
  for (const md of ['', 'just prose', 42, undefined]) {
    r.sent.length = 0;
    r.from({ type: 'card:load', md, handle: 'mei' });
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].msg.type, 'card:load-failed');
    assert.equal(typeof r.sent[0].msg.message, 'string');
    assert.equal(r.sent[0].origin, HOST);
  }
  assert.equal(r.loads.length, 1, 'a failed load must not replace the model');
});

test('changes before a load are not reported (the editor holds no real card yet)', () => {
  const r = rig();
  r.bridge.changed(THIN);
  r.tick();
  assert.deepEqual(r.sent, []);
  assert.equal(r.bridge.save(), false);
});

test('card:change is debounced 150ms and carries the FAT md, assets lane intact', () => {
  const r = rig();
  r.from({ type: 'card:load', md: FAT, handle: 'mei' });
  const edited1 = FAT.replace('a bio', 'bio one');
  const edited2 = FAT.replace('a bio', 'bio two');
  r.bridge.changed(edited1);
  r.bridge.changed(edited2);
  assert.equal(r.timers.size, 1, 'one pending timer, not two');
  assert.equal([...r.timers.values()][0].ms, 150);
  assert.equal(r.bridge.status, 'unsaved');
  r.tick();
  assert.equal(r.sent.length, 1);
  const { msg, origin } = r.sent[0];
  assert.equal(origin, HOST);
  assert.equal(msg.type, 'card:change');
  assert.equal(msg.v, 1);
  assert.equal(msg.dirty, true);
  assert.ok(msg.md.includes('bio two'));
  assert.equal(msg.md, edited2, 'md is the editor\'s card byte-for-byte, lane included');
  assert.ok(msg.md.includes('## assets') && msg.md.includes('iVBORw0K'));
  assert.equal('assets' in msg, false);
});

test('🔴 the parent\'s split: save_card drops a fat lane, splitCard + put_asset keeps the picture', () => {
  // control first: a NEW picture posted inside a FAT md is silently dropped by save_card — that is
  // why assets travel beside md and the parent put_asset()s them
  const stored = THIN;                                   // the store has no bytes for `pic` yet
  assert.equal(parseCard(assembleSave(FAT, stored).md).assets.pic, undefined, 'save_card drops an incoming lane');
  const { md, assets } = splitCard(FAT);
  const storedWithPic = serializeCard({ ...parseCard(stored), assets }); // after put_asset(pic)
  const saved = assembleSave(md, storedWithPic);
  assert.equal(saved.md, serializeCard({ ...parseCard(FAT), assets }), 'thin md + put assets = the card');
  assert.deepEqual(saved.orphans, []);
  assert.equal(splitCard(md).md, md, 'already thin → unchanged');
});

test('save → saving → saved; a change during saving stays unsaved', () => {
  const r = rig();
  r.from({ type: 'card:load', md: FAT, handle: 'mei' });
  r.bridge.changed(FAT.replace('a bio', 'x'));
  assert.equal(r.bridge.save(), true);
  const types = r.sent.map((s) => s.msg.type);
  assert.deepEqual(types, ['card:change', 'card:save'], 'a pending change flushes before the save');
  const save = r.sent[1].msg;
  assert.equal(save.md, FAT.replace('a bio', 'x'), 'the fat card, as the sandbox parks it');
  assert.equal(r.bridge.status, 'saving');
  assert.equal(r.bridge.save(), false, 'no second save while one is out');
  r.from({ type: 'card:saved', version: 'v1:new' });
  assert.equal(r.bridge.status, 'saved');
  assert.equal(r.bridge.dirty, false);

  r.bridge.changed(FAT.replace('a bio', 'y'));
  r.bridge.save();
  r.bridge.changed(FAT.replace('a bio', 'z'));          // typed while the save was out
  assert.equal(r.bridge.status, 'saving');
  r.from({ type: 'card:saved', version: 'v1:newer' });
  assert.equal(r.bridge.status, 'unsaved');
  assert.equal(r.bridge.dirty, true);
});

test('save-failed shows the parent\'s message verbatim; a stray answer is ignored', () => {
  const r = rig();
  r.from({ type: 'card:load', md: FAT, handle: 'mei' });
  r.from({ type: 'card:saved', version: 'v1:x' });       // answer to nothing
  assert.equal(r.bridge.status, 'idle');
  r.bridge.changed(FAT.replace('a bio', 'q'));
  r.bridge.save();
  r.from({ type: 'card:save-failed', message: 'Someone else saved this card — reload to see theirs.' });
  assert.equal(r.bridge.status, 'failed');
  assert.equal(r.bridge.message, 'Someone else saved this card — reload to see theirs.');
  assert.equal(r.statuses.at(-1), 'failed:Someone else saved this card — reload to see theirs.');
  assert.equal(r.bridge.dirty, true);
  assert.equal(r.bridge.save(), true, 'can retry');
});

test('a card:load after edits resets dirty and drops the pending change', () => {
  const r = rig();
  r.from({ type: 'card:load', md: FAT, handle: 'mei' });
  r.bridge.changed(FAT.replace('a bio', 'q'));
  r.from({ type: 'card:load', md: THIN, handle: 'mei' });
  r.tick();
  assert.deepEqual(r.sent, []);
  assert.equal(r.bridge.dirty, false);
  assert.equal(readsAsCard(THIN), true);
});
