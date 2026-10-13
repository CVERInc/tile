// The editing table draws the SAME mark the published card does (CVERInc/reef#2015).
//
//   node --test packages/cardtile/w2/board-marks.test.mjs
//
// 🩸 tile#123 (reef#2011) gave the card a drawn Instagram/Threads mark (removed again by reef#2026:
// marks are fetched live, DuckDuckGo then Google) — but the board face kept its own copy of the favicon derive, so the same card
// showed a broken favicon while being edited and the drawn mark once published, and `icon=` /
// `iconhost=` did nothing on the table at all. One brand table, one override rule: link-marks.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCard } from '../card-core.js';
import { boardSlots, tileFace } from './board-bridge.mjs';
import { faceMarkHtml } from './edit2.mjs';
import { ICONS } from '../serve/card-assets.mjs';
import { renderCardHTML } from '../serve/card-worker.mjs';

const card = (...cells) => ['---', 'card-page: x', 'title: X', '---', '', '## grid', '', ...cells].join('\n') + '\n';
const ctx = { faceLabel: 'face', title: 'X', typeName: (t) => t, opensLabel: '→ {title}', drawerTitle: (id) => id };
const faces = (...cells) => boardSlots(parseCard(card(...cells)), ctx).map((s) => tileFace(s.cell, ctx));
const face = (cell) => faces(cell)[0];

test('🔴 the board walks the SAME live-fetch chain as the card: no automatic built-in SVG (reef#2026)', () => {
  // tile#123 drew Instagram/Threads by host; reef#2026 removed that. Link and social rows both get the
  // favicon chain (/_icon asks DuckDuckGo, then Google) — and so does the card, asserted below.
  for (const u of ['https://www.instagram.com/x', 'https://instagram.com/x', 'https://www.threads.net/@x', 'https://foo.instagram.com/x']) {
    const host = new URL(u).hostname;
    for (const cell of [`- [ ] %% card: link %% [IG](${u})`, `- [ ] %% card: social w=6 %% [IG](${u})`]) {
      const icons = face(cell).icons;
      assert.equal(icons.length, 1, u);
      assert.ok(icons[0].host && !icons[0].icon, `${u} got a built-in mark: ${JSON.stringify(icons)}`);
      assert.equal(icons[0].host, host, u);
    }
  }
  // what the tile SHOWS for a host mark is an <img> at /_icon; a NAMED icon is the card's own svg
  assert.match(faceMarkHtml({ host: 'instagram.com' }), /<img[^>]*src="\/_icon\/instagram\.com\.ico"/);
  const named = faceMarkHtml({ icon: 'instagram' });
  assert.ok(named.includes(ICONS.instagram) && !/<img/.test(named), named);
  // and the author's `icon=instagram` is that svg on the board too
  assert.deepEqual(face('- [ ] %% card: link icon=instagram %% [IG](https://example.org/x)').icons, [{ icon: 'instagram' }]);
});

test('🔴 a look-alike host keeps its own favicon on the board too', () => {
  for (const u of ['https://foo.instagram.com/x', 'https://notinstagram.com/x', 'https://instagram.com.evil.tld/x']) {
    const host = new URL(u).hostname;
    assert.deepEqual(face(`- [ ] %% card: link %% [A](${u})`).icons, [{ host }], u);
    assert.deepEqual(face(`- [ ] %% card: social w=6 %% [A](${u})`).icons, [{ host }], u);
  }
  assert.match(faceMarkHtml({ host: 'foo.instagram.com' }), /<img[^>]*src="\/_icon\/foo\.instagram\.com\.ico"/);
});

test('🔴 icon= and iconhost= win on the board exactly as they win on the card', () => {
  // link cell: params
  assert.deepEqual(face('- [ ] %% card: link icon=shop %% [IG](https://www.instagram.com/x)').icons, [{ icon: 'shop' }]);
  assert.deepEqual(face('- [ ] %% card: link iconhost=x.com %% [IG](https://www.instagram.com/x)').icons, [{ host: 'x.com' }]);
  // an icon= the card does not ship falls through to the default, on both
  assert.deepEqual(face('- [ ] %% card: link icon=nope %% [IG](https://www.instagram.com/x)').icons, [{ host: 'www.instagram.com' }]);
  // social row: tokens after a [name](url) line, and after a bare address
  const row = face('- [ ] %% card: social w=6 %% [A](https://www.instagram.com/a) icon=shop\n\t'
    + 'https://example.org/b iconhost=x.com\n\t[C](https://www.threads.net/@c)');
  assert.deepEqual(row.icons, [{ icon: 'shop' }, { host: 'x.com' }, { host: 'www.threads.net' }]);
  // the bare address's tokens never leak into the label the tile shows
  assert.equal(row.sub, 'A · example.org · C');
  // mail: no mark by default, but the author's named one is honoured, as the card honours it
  assert.deepEqual(face('- [ ] %% card: social w=6 %% [M](mailto:a@example.org)').icons, []);
  assert.deepEqual(face('- [ ] %% card: social w=6 %% [M](mailto:a@example.org) icon=shop').icons, [{ icon: 'shop' }]);
});

test('🔴 board and card agree, case by case (the shared table, not two copies of it)', () => {
  const cases = [
    '- [ ] %% card: link %% [A](https://www.instagram.com/x)',
    '- [ ] %% card: link %% [A](https://foo.instagram.com/x)',
    '- [ ] %% card: link icon=shop %% [A](https://www.instagram.com/x)',
    '- [ ] %% card: link iconhost=x.com %% [A](https://www.threads.com/x)',
    '- [ ] %% card: link %% [A](https://www.books.com.tw/x)',
  ];
  for (const c of cases) {
    const html = renderCardHTML(card(c), { handle: 'x' }).replace(/<style>[\s\S]*?<\/style>/g, '');
    const drawn = /<div class="st-cell-head">(<svg[\s\S]*?<\/svg>|<img[^>]*>)/.exec(html)[1];
    const [m] = face(c).icons;
    if (m.icon) assert.equal(drawn, ICONS[m.icon], c);
    else assert.equal(/src="([^"]+)"/.exec(drawn)[1], `/_icon/${m.host}.ico`, c);
  }
});

// 🩸 review P2 (tile#124): the behavioural tests above stay green if the editor swaps the shared
// import for a local copy that returns the same values today. Structure guard: the board must
// IMPORT these four from link-marks.mjs and must not define any of them itself.
test('🔴 the board imports the shared mark rules and defines no local copy', async () => {
  const { readFileSync } = await import('node:fs');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const names = ['linkOf', 'socialLineOf', 'overrideMark', 'defaultMark'];
  const bridge = strip(readFileSync(new URL('./board-bridge.mjs', import.meta.url), 'utf8'));
  const imp = bridge.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/link-marks\.mjs['"]/);
  assert.ok(imp, 'board-bridge.mjs must import from ../link-marks.mjs');
  const got = imp[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop());
  for (const n of names) assert.ok(got.includes(n), `board-bridge.mjs must import ${n} from link-marks.mjs`);
  for (const f of ['./board-bridge.mjs', './edit2.mjs']) {
    const src = strip(readFileSync(new URL(f, import.meta.url), 'utf8'));
    for (const n of names) {
      const def = new RegExp(`(function\\s*\\*?\\s*${n}\\b|\\b(?:const|let|var)\\s+${n}\\b|\\b${n}\\s*[:=]\\s*(?:async\\s*)?(?:function|\\())`);
      assert.ok(!def.test(src), `${f} must not define its own ${n}`);
    }
  }
});
