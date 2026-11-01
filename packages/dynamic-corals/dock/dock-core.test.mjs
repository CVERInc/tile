// dock-core.mjs — the parts of an item that are rules rather than layout: which links are allowed,
// which names a hash may open, and that the built bundle carries the shared base. Opening, closing,
// stacking, retiring and the installed-app bar are measured in a browser by dock.smoke.mjs.
//   run: node --test packages/dynamic-corals/dock/dock-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeItemHref, itemName, autoKey, closeLabel } from './dock-core.mjs';

test('a link item goes to http(s), mailto, tel, a fragment or a same-site path — nothing else', () => {
  for (const ok of ['https://line.me/R/ti/p/@x', 'http://a.test/', 'mailto:a@b.test', 'tel:+81312345678', '#top', '/contact', './a', '../b']) {
    assert.equal(safeItemHref(ok), ok, ok);
  }
  for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'java\nscript:x', 'data:text/html,x', '//evil.test/x', 'vbscript:x', '']) {
    assert.equal(safeItemHref(bad), null, JSON.stringify(bad));
  }
});

test('#name: a short token opens a panel; anything else names nothing', () => {
  const el = (v) => ({ getAttribute: () => v });
  assert.equal(itemName(el('cohort6')), 'cohort6');
  assert.equal(itemName(el(' sale-2026 ')), 'sale-2026');
  for (const bad of [null, '', '1 2', 'a"b', 'x'.repeat(65), '#sale']) assert.equal(itemName(el(bad)), '', String(bad));
});

test('the built bundle carries the shared base, one copy, bundled in', () => {
  const bundle = readFileSync(new URL('./dock.js', import.meta.url), 'utf8');
  assert.match(bundle, /dc-dock:open/);
  assert.match(bundle, /function dockJoin\(/);
  assert.equal((bundle.match(/function dockJoin\(/g) || []).length, 1);
});

test('once per visit: the key is the item\'s name, else its corner and its label — never empty', () => {
  const el = (attrs) => ({ getAttribute: (n) => (n in attrs ? attrs[n] : null), querySelector: () => null });
  assert.equal(autoKey(el({ 'data-open-on-hash': 'cohort6', 'data-label': 'X' })), 'dc-dock:cohort6');
  assert.equal(autoKey(el({ 'data-label': 'Sale ends soon' })), 'dc-dock:right:Sale ends soon');
  assert.equal(autoKey(el({ 'data-label': 'Sale ends soon', 'data-dock': 'left' })), 'dc-dock:left:Sale ends soon');
  // Two unnamed items in different corners, or with different labels, are remembered apart.
  assert.notEqual(autoKey(el({ 'data-label': 'A' })), autoKey(el({ 'data-label': 'B' })));
});

test('the open bubble is called「Close」in the page\'s language (the inbox\'s nine)', () => {
  for (const [lang, word] of [['en', 'Close'], ['en-US', 'Close'], ['zh-TW', '關閉'], ['zh-Hant-HK', '關閉'], ['zh', '關閉'],
    ['zh-CN', '关闭'], ['zh-Hans', '关闭'], ['ja', '閉じる'], ['ko-KR', '닫기'], ['de', 'Schließen'], ['fr-CA', 'Fermer'],
    ['es', 'Cerrar'], ['pt-BR', 'Fechar'], ['nl', 'Close'], [null, 'Close']]) {
    assert.equal(closeLabel(lang), word, String(lang));
  }
});
