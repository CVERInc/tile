// The drawer relation in WORDS, not lines (owner ruling 2026-09-24: "a view answers one question").
// Pins board-bridge's `drawerLabels`, the lines' removal, and the board being pinned to light.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCard } from '../card-core.js';
import { drawerLabels, BOARD_LIGHT_CSS, boardSlots, tileFace } from './board-bridge.mjs';
import { boardStrings, BOARD_STRINGS_BY_KEY } from './board-i18n.mjs';
import { LOCALE_KEYS } from '../w/sandbox-i18n.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const card = (...lines) => ['---', 'card-page: try', 'title: 小美', 'lang: zh-TW', '---', '',
  '## cards', '', ...lines].join('\n') + '\n';
const MD = card(
  '- [ ] %% card: link w=6 %% [About me](#about)',
  '- [ ] %% card: link w=6 %% [Shops](#stockists)',
  '- [ ] %% card: link w=6 %% [Elsewhere](https://example.com/)',
  '',
  '## drawer: about | About', '',
  '- [ ] %% card: text %% inside',
  '',
  '## drawer: extra | Extra', '',
  '- [ ] %% card: text %% nobody opens me',
);
const ctx = { faceLabel: 'F' };

// the words the editor hands board-bridge (edit2's bridgeCtx): drawerTitle is '' for a missing drawer
const ctxFor = (m, loc) => ({ faceLabel: 'F', opensLabel: boardStrings(loc)['board.opensLabel'],
  drawerTitle: (id) => { const d = (m.drawers || []).find((x) => x.id === id); return d ? (d.title || d.id) : ''; } });
const subs = (m, loc) => boardSlots(m, ctxFor(m, loc)).map((s) => tileFace(s.cell, ctxFor(m, loc)).sub);

test('a link→drawer pair: the tile SUBTITLE says where it goes, the lane says who opens it', () => {
  const m = parseCard(MD);
  assert.equal(subs(m, 'en')[0], '→ Opens: About');
  assert.equal(subs(m, 'zh')[0], '→ 開啟：About');
  assert.ok(!subs(m, 'en').some((s) => /Drawer:|抽屜：/.test(s)), 'the old "Drawer:" prefix is back');
  assert.equal(drawerLabels(m, ctxFor(m, 'en'), boardStrings('en')).lanes
    .find((l) => l.laneKey === 'drawer:about').heading, 'About (opened by “About me”)');
  assert.equal(drawerLabels(m, ctxFor(m, 'zh'), boardStrings('zh')).lanes
    .find((l) => l.laneKey === 'drawer:about').heading, 'About（由〈About me〉打開）');
});

test('a drawer nothing opens: the heading is the plain title', () => {
  const m = parseCard(MD);
  assert.equal(drawerLabels(m, ctxFor(m, 'en'), boardStrings('en')).lanes.find((l) => l.laneKey === 'drawer:extra').heading, 'Extra');
});

test('a dangling link reads ⚠ <id> in its subtitle; a plain external link says its domain', () => {
  const m = parseCard(MD);
  const s = subs(m, 'en');
  assert.equal(s[1], '⚠ stockists');
  assert.equal(s[2], 'example.com');
});

test('both new strings exist in all nine locales and carry their slots', () => {
  for (const loc of LOCALE_KEYS) {
    assert.match(BOARD_STRINGS_BY_KEY['board.opensLabel'][loc] || '', /\{title\}/, `opensLabel ${loc}`);
    const s = BOARD_STRINGS_BY_KEY['board.drawerOpenedBy'][loc] || '';
    assert.ok(s.includes('{title}') && s.includes('{by}'), `drawerOpenedBy ${loc}`);
  }
});

// 🔴 the connector-line code path is gone. Control: the same needles, run on text that still has
// the old code, must hit — so a needle typo cannot make this pass vacuously.
const LINE_NEEDLES = ['drawWires', 'ct2-wire', 'stroke-dasharray', 'ct2-tug'];
const hits = (src) => LINE_NEEDLES.filter((n) => src.includes(n));
test('no connector-line code remains in the editor or its generated bundle', () => {
  const OLD = "function drawWires() {}\n  .ct2-wire path { stroke-dasharray: 4 4; }\n  .ct2-tug { }";
  assert.deepEqual(hits(OLD), LINE_NEEDLES, 'control: the needles no longer detect the old code');
  for (const f of ['edit2.mjs', 'edit2.css', 'index.html', '../serve/edit2-assets.mjs']) {
    assert.deepEqual(hits(fs.readFileSync(join(DIR, f), 'utf8')), [], `${f} still draws lines`);
  }
});

test('the board is pinned to the shell\'s light scheme, and the editor injects it', () => {
  assert.match(BOARD_LIGHT_CSS, /color-scheme:\s*light/);
  assert.match(BOARD_LIGHT_CSS, /--background-primary:\s*#ffffff/);
  assert.doesNotMatch(BOARD_LIGHT_CSS, /prefers-color-scheme/, 'must not depend on the OS');
  // the values are the host's own light set: every token here matches hosts/web/tugtile/index.html
  const host = fs.readFileSync(join(DIR, '../../../hosts/web/tugtile/index.html'), 'utf8');
  const light = /prefers-color-scheme: light\) \{ :root \{([\s\S]*?)\}\}/.exec(host)[1];
  for (const [, k, v] of BOARD_LIGHT_CSS.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    assert.ok(light.includes(`${k}: ${v}`), `${k} drifted from the host's light value`);
  }
  assert.match(fs.readFileSync(join(DIR, 'edit2.mjs'), 'utf8'), /BOARD_CSS \+ BOARD_LIGHT_CSS/);
});
