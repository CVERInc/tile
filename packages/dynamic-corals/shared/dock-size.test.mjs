// reef#3306: the corner bubbles' size, edge distance and motion numbers, read from the stylesheet and
// the sources that must agree with it. Layout and the animations themselves are measured in a real
// browser by dock/dock-motion.smoke.mjs; this is the part that fails in `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOCK_CSS, DOCK_SHADOW, DOCK_IN_MS, DOCK_IN_EASE, DOCK_OUT_MS, DOCK_LATE_MS } from './dock.mjs';

const rule = (css, head) => {
  const i = css.indexOf(head);
  assert.ok(i >= 0, `no rule ${head}`);
  return css.slice(i, css.indexOf('}', i));
};
const host = rule(DOCK_CSS, ':host{');
const wide = rule(DOCK_CSS, '@media (min-width:700px){:host{');
const bar = rule(DOCK_CSS, ':host([name="bar"]){');

test('phone size, glyph and edge distance are the defaults: 44px, 20px, 16px', () => {
  assert.match(host, /--dc-dock-size:44px/);
  assert.match(host, /--dc-dock-icon:20px/);
  assert.match(host, /--dc-dock-margin:max\(1rem,16px\)/);
  assert.match(host, /--dc-dock-gap:\.5rem/, 'bubbles stay 8px apart');
});

test('from 700px: 52px, 22px glyph, 20px off the edges', () => {
  assert.match(wide, /--dc-dock-size:52px/);
  assert.match(wide, /--dc-dock-icon:22px/);
  assert.match(wide, /--dc-dock-margin:max\(1\.25rem,20px\)/);
});

test('no bubble is smaller than 44px at any width', () => {
  const sizes = [...DOCK_CSS.matchAll(/--dc-dock-size:(\d+)px/g)].map((m) => +m[1]);
  assert.ok(sizes.length >= 2);
  for (const n of sizes) assert.ok(n >= 44, `${n}px`);
});

test('the shadow still fits inside the smallest margin (16px)', () => {
  const reach = DOCK_SHADOW.split(/,(?![^(]*\))/).map((l) => {
    const m = l.trim().match(/^(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+([\d.]+)/);
    return Math.max(Math.abs(+m[1]), Math.abs(+m[2])) + +m[3];
  });
  assert.ok(Math.max(...reach) <= 16, String(reach));
});

test('the installed-app bar is not a bubble: it has its own 3.5rem and does not follow the bubble size', () => {
  assert.match(bar, /--dc-dock-bar-size:3\.5rem/);
  assert.match(bar, /--dc-dock-size:var\(--dc-dock-bar-size\)/);
  assert.match(bar, /--dc-dock-icon:1\.6rem/);
  assert.match(bar, /--dc-dock-margin:max\(1rem,16px\)/);
  assert.ok(!/\b(44|52)px/.test(bar), 'no bubble size inside the bar rule');
});

test('the item coral and the bubble draw their glyph from --dc-dock-icon and fall back to the phone size', () => {
  const core = readFileSync(new URL('../dock/dock-core.mjs', import.meta.url), 'utf8');
  const inbox = readFileSync(new URL('../inbox-bubble/inbox-bubble.js', import.meta.url), 'utf8');
  assert.match(core, /\.d,::slotted\(svg\)\{width:var\(--dc-dock-icon,20px\)!important;height:var\(--dc-dock-icon,20px\)!important/);
  assert.match(core, /\.x\{display:none;width:var\(--dc-dock-icon,20px\)/);
  assert.match(inbox, /-icon\{width:var\(--dc-dock-icon,1\.6rem\);height:var\(--dc-dock-icon,1\.6rem\)/);
  for (const [name, src] of [['dock-core', core], ['inbox-bubble', inbox]]) {
    assert.ok(!/var\(--dc-dock-size,3\.5rem\)/.test(src), `${name}: a --dc-dock-size fallback still says 3.5rem`);
    assert.match(src, /var\(--dc-dock-size,44px\)/, name);
  }
});

test('motion numbers: 320ms spring-in after 180ms into an empty corner, 160ms out', () => {
  assert.equal(DOCK_IN_MS, 320);
  assert.equal(DOCK_IN_EASE, 'cubic-bezier(.34,1.3,.64,1)');
  assert.equal(DOCK_OUT_MS, 160);
  assert.equal(DOCK_LATE_MS, 180);
  assert.match(DOCK_CSS, /::slotted\(\[hidden\]\[data-dc-leaving\]\)\{display:flex!important\}/, 'a leaving item stays drawn until its exit ends');
});
