// reef#2044 ④ — a card that is still only the blank template is not indexed; a card with content is.
// run: node --test card-blank-noindex.test.mjs
//
// The fixtures are built by the CODE THAT CREATES BLANK CARDS, not typed from memory:
//   · create_card's starter — reef `apps/reef-mcp/src/create-card.js` `starterCardMarkdown`, which
//     builds its two cells from THIS repo's `BLANKS` (ai-ops.mjs). Mirrored below line for line,
//     because reef is another repo; what it reads (BLANKS) is imported, not copied.
//   · the sandbox door — `w/sandbox-i18n.mjs` `buildSandboxCard`, carried into a real card by reef's
//     `rekeyCardMarkdown` (rewrites `card-page` and `title` only; mirrored below).
//   · a tile added in the editor and never filled — `ai-ops.mjs` `blankCell` + `w/cell-i18n.mjs`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './card-worker.mjs';
import { parseCard, serializeCard } from '../card-core.js';
import { BLANKS, blankCell } from '../ai-ops.mjs';
import { buildSandboxCard, LOCALE_KEYS } from '../w/sandbox-i18n.mjs';
import { cellStrings } from '../w/cell-i18n.mjs';
import { isTemplateOnly } from '../card-blank.mjs';
import { ICON_PATHS } from '../card-icon.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RICH = readFileSync(join(here, '..', 'cards', 'specimens', 'specimen-rich.card.md'), 'utf8');
const OWN = 'links.creator-example.test';      // made-up vanity host — the one host a card is indexable on

// reef create-card.js starterCardMarkdown({ handle, title, tagline, social }), same lines.
const starter = ({ handle = 'maple', title = 'Maple', tagline, social } = {}) => [
  '---', `card-page: ${handle}`, `title: ${title}`, 'theme: light', 'cols: 6', '---', '', '## grid', '',
  `- [ ] %% card: ${BLANKS.profile.type} ${BLANKS.profile.rawParams} %% ${String(tagline ?? '').trim() || BLANKS.profile.body}`,
  `- [ ] %% card: ${BLANKS.social.type} ${BLANKS.social.rawParams} %%`,
  ...(String(social ?? '').trim() || BLANKS.social.body).split('\n').map((l) => `\t${l.trim()}`),
  '',
].join('\n');
// reef cardTryDraft.ts rekeyCardMarkdown(md, { handle, title }), for these fixtures' shape.
const rekey = (md, { handle = 'maple', title = 'Maple' } = {}) =>
  md.replace(/^card-page: .*$/m, `card-page: ${handle}`).replace(/^title: .*$/m, `title: ${title}`);
// 🔴 `blocks` are RANGES into `cells` (card-core.js) — a pushed cell outside every range is silently not
// serialised, which would make every "+ a tile" fixture below a copy of its base. So the range grows,
// and the result is re-parsed to prove the cell is really in the file.
const withCell = (md, cell) => {
  const m = parseCard(md);
  m.cells.push(cell);
  m.blocks[m.blocks.length - 1].count += 1;
  const out = serializeCard(m);
  assert.equal(parseCard(out).cells.length, m.cells.length, 'withCell lost the cell it added');
  return out;
};

const envFor = (md, extra = {}) => {
  const kv = new Map([['maple', md], [`vanity:${OWN}`, 'maple']]);
  return { PREVIEW: 'false', CARDS: { get: async (k) => kv.get(k) ?? null }, ...extra };
};
const robots = async (md, { url = `https://${OWN}/`, headers = {}, extra } = {}) => {
  const res = await worker.fetch(new Request(url, { redirect: 'manual', headers }), envFor(md, extra));
  assert.equal(res.status, 200, `${url} did not serve the card`);
  return res.headers.get('x-robots-tag');
};

// ── template-only → noindex ─────────────────────────────────────────────────────────────────────
const BLANK = {
  'create_card, no tagline': starter(),
  'create_card, blank.profile resolved (en)': starter({ tagline: cellStrings('en')['blank.profile'] }),
  'empty grid': ['---', 'card-page: maple', 'title: Maple', '---', '', '## grid', ''].join('\n'),
};
for (const loc of LOCALE_KEYS) BLANK[`sandbox carried unedited (${loc})`] = rekey(buildSandboxCard(loc));
for (const type of Object.keys(BLANKS)) {
  BLANK[`sandbox + an unfilled ${type} tile (ja)`] = withCell(rekey(buildSandboxCard('ja')), blankCell(type, cellStrings('ja')));
  BLANK[`starter + an unfilled ${type} tile (key form)`] = withCell(starter(), blankCell(type));
}
// the editor's link form with the address cleared — the card-tap test's own shape
BLANK['sandbox link with the address cleared'] = rekey(buildSandboxCard('en').replace('(https://example.com)', '()'));

test('a template-only card on its own (vanity) host answers X-Robots-Tag: noindex — html, thin and full markdown', async () => {
  for (const [name, md] of Object.entries(BLANK)) {
    assert.equal(await robots(md), 'noindex', `${name} — html`);
    assert.equal(await robots(md, { headers: { accept: 'text/markdown' } }), 'noindex', `${name} — thin markdown`);
    assert.equal(await robots(md, { url: `https://${OWN}/index.md` }), 'noindex', `${name} — /index.md`);
  }
});

// ── controls: anything the author put there → indexable ──────────────────────────────────────────
const SANDBOX = rekey(buildSandboxCard('en'));
const REAL = {
  'create_card with a tagline': starter({ tagline: 'Bookbinder in a small town.' }),
  'create_card with the social row filled': starter({ social: '[Instagram](https://instagram.com/maple)' }),
  'sandbox with the bio rewritten': SANDBOX.replace(/(%% card: profile w=6 %% ).*/, '$1I bind books by hand.'),
  'sandbox with the link pointed somewhere': SANDBOX.replace('https://example.com', 'https://shop.example.co.uk/'),
  'starter + an avatar on the profile': starter().replace('profile w=6', 'profile w=6 avatar=https://placehold.co/96.png'),
  'sandbox + a sub line on the link': SANDBOX.replace('link w=3', 'link w=3 sub=Tuesdays'),
  'starter + a written text tile': withCell(starter(), { ...blankCell('text'), body: 'Open on weekends.' }),
  'starter + an image in the assets lane': starter().replace('title: Maple', 'title: Maple\nbackdrop: asset:sha256-0000000000000000')
    + '\n## assets\n\n- [ ] %% card: asset id=sha256-0000000000000000 mime=image/png %% iVBORw0KGgo=\n',
  'specimen-rich': RICH,
};

test('control: a card with author content on its vanity host carries no X-Robots-Tag (indexable)', async () => {
  for (const [name, md] of Object.entries(REAL)) {
    assert.equal(await robots(md), null, `${name} — html`);
    assert.equal(await robots(md, { headers: { accept: 'text/markdown' } }), null, `${name} — thin markdown`);
  }
});

test('the canonical host keeps its stricter rule for a blank card (never weakened to plain noindex)', async () => {
  assert.equal(await robots(starter(), { url: 'https://card.feelreef.com/maple' }), 'noindex, nofollow');
});

test('the kill switch and the blank rule agree: switch on → noindex on a real card as before', async () => {
  assert.equal(await robots(REAL['create_card with a tagline'], { extra: { CARD_NOINDEX_ALL: '1' } }), 'noindex');
  assert.equal(await robots(starter(), { extra: { CARD_NOINDEX_ALL: '1' } }), 'noindex');
});

// ── the pure judgement, on the shapes the Worker fixtures above do not reach ─────────────────────
test('isTemplateOnly: a drawer, a section label, prose before the first lane, or no card at all → not blank', () => {
  const base = starter();
  assert.equal(isTemplateOnly(base), true, 'control: the starter itself is blank');
  assert.equal(isTemplateOnly(base + '\n## drawer: more | More\n\n- [ ] %% card: text %% blank.text\n'), false, 'drawer');
  assert.equal(isTemplateOnly(base + '\n## Shop\n\n- [ ] %% card: text %% blank.text\n'), false, 'labelled block');
  assert.equal(isTemplateOnly(base.replace('---\n\n## grid', '---\nhello\n\n## grid')), false, 'prose before the lane');
  for (const v of [null, undefined, 42]) assert.equal(isTemplateOnly(v), false, String(v));
});

// ── tile#191 review P2: a cell type that names an Object.prototype member ─────────────────────────
// The parser accepts any type word and the renderer draws an unknown one through its default case,
// so these cards rendered 200 before ④. A plain-object lookup handed back the INHERITED member
// (`TEMPLATE_BODIES.constructor` is a function) and the request threw. An unknown type is something
// the author wrote: served, and indexable.
const PROTO_TYPES = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'];
test('a cell typed after an Object.prototype member still serves 200 and counts as authored (indexable)', async () => {
  for (const type of PROTO_TYPES) {
    const md = ['---', 'card-page: maple', 'title: Maple', '---', '', '## grid', '',
      `- [ ] %% card: ${type} w=6 %% Open weekends`, ''].join('\n');
    for (const [url, headers] of [[`https://${OWN}/`, {}], [`https://${OWN}/`, { accept: 'text/markdown' }], [`https://${OWN}/index.md`, {}]]) {
      const res = await worker.fetch(new Request(url, { redirect: 'manual', headers }), envFor(md));
      assert.equal(res.status, 200, `${type} — ${url} ${headers.accept || ''}`);
      assert.equal(res.headers.get('x-robots-tag'), null, `${type} — ${url} ${headers.accept || ''}`);
    }
    // …and with an EMPTY body, which is the shape most likely to be mistaken for a blank tile
    assert.equal(isTemplateOnly(md.replace(' Open weekends', '')), false, `${type}, empty body`);
  }
});

// ── the other exits the blank rule reaches, and the rules it must lose to ───────────────────────
const exitHeader = async (md, path, { handle = 'maple', extra } = {}) => {
  const kv = new Map([[handle, md], [`vanity:${OWN}`, handle]]);
  const env = { PREVIEW: 'false', CARDS: { get: async (k) => kv.get(k) ?? null }, ...extra };
  return (await worker.fetch(new Request(`https://${OWN}${path}`, { redirect: 'manual' }), env)).headers.get('x-robots-tag');
};
test('the avatar and every icon exit of a blank card carry noindex; a real card\'s do not', async () => {
  const paths = ['/avatar', ...Object.values(ICON_PATHS)];
  assert.ok(paths.length >= 3, `expected the avatar plus ≥2 icon paths, got ${paths.join(' ')}`);
  for (const p of paths) {
    assert.equal(await exitHeader(starter(), p), 'noindex', `blank ${p}`);
    assert.equal(await exitHeader(REAL['create_card with a tagline'], p), null, `real ${p}`);
  }
});

test('preview deployments and demo- handles keep noindex, nofollow on a blank card (the blank rule never wins)', async () => {
  for (const extra of [{ PREVIEW: 'true' }, { PREVIEW: undefined }]) {
    assert.equal(await exitHeader(starter(), '/', { extra }), 'noindex, nofollow', `PREVIEW=${extra.PREVIEW}`);
  }
  assert.equal(await exitHeader(starter({ handle: 'demo-maple' }), '/', { handle: 'demo-maple' }), 'noindex, nofollow', 'demo- handle');
  // control: the same blank card on production, ordinary handle → the blank rule's plain noindex
  assert.equal(await exitHeader(starter(), '/'), 'noindex');
});
