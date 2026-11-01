// reef#2790: the bubble's corner dock is a VERBATIM COPY of shared/dock.mjs's — a coral has no
// imports, so it cannot share the file. This is the gate that makes「verbatim」a fact rather than a
// comment: the two DOCK-BASE blocks must be byte-identical, and the copy must behave like the
// original. (search-filter-sync.test.mjs is the same gate for the in-site filter.)
//   run: node --test packages/dynamic-corals/inbox-bubble/dock-sync.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BEGIN = '// ── DOCK-BASE-BEGIN';
const END = '// ── DOCK-BASE-END ──';
const block = (src, where) => {
	const b = src.indexOf(BEGIN);
	const e = src.indexOf(END);
	assert.ok(b >= 0 && e > b, `${where}: no DOCK-BASE block`);
	assert.equal(src.indexOf(BEGIN, b + 1), -1, `${where}: two DOCK-BASE blocks`);
	return src.slice(b, e + END.length);
};

const moduleSrc = readFileSync(new URL('../shared/dock.mjs', import.meta.url), 'utf8');
const coralSrc = readFileSync(new URL('./inbox-bubble.js', import.meta.url), 'utf8');

test('🔴 inbox-bubble.js carries shared/dock.mjs\'s DOCK-BASE block byte for byte', () => {
	assert.equal(block(coralSrc, 'inbox-bubble.js'), block(moduleSrc, 'shared/dock.mjs'),
		'the bubble\'s dock drifted from the module — edit shared/dock.mjs, then paste the block into inbox-bubble.js');
});

test('the copy answers like the module (ink, shadow budget, the contract\'s event name)', async () => {
	const mod = await import('../shared/dock.mjs');
	const copy = new Function(`${block(coralSrc, 'inbox-bubble.js')}\nreturn { dockInk, DOCK_SHADOW, DOCK_OPEN, DOCK_TAG, DOCK_CSS };`)();
	for (const c of ['#fff', '#111', '#ff5d61', 'rgb(0, 128, 0)', 'nope']) assert.equal(copy.dockInk(c), mod.dockInk(c), c);
	assert.equal(copy.DOCK_SHADOW, mod.DOCK_SHADOW);
	assert.equal(copy.DOCK_OPEN, 'dc-dock:open');
	assert.equal(copy.DOCK_TAG, 'dc-dock');
	assert.equal(copy.DOCK_CSS, mod.DOCK_CSS);
});

test('the bubble joins the dock as the module says, with its own element as the anchor', () => {
	assert.match(coralSrc, /dockJoin\(host, el, 'right'\)/, 'the inbox no longer joins the right dock anchored at its element');
	assert.match(coralSrc, /if \(dock\) dockAnnounce\(host\);/, 'opening no longer announces itself (contract ②)');
	assert.match(coralSrc, /dockListen\(host, \(\) => \{ if \(open\) hide\(false\); \}\)/, 'another item opening no longer closes the panel');
});
