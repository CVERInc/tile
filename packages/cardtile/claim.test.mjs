// The frontmatter claim, in both spellings.  run: node --test claim.test.mjs
//
// `cardtile: <handle>` is accepted wherever `card-page: <handle>` is (claim.mjs; docs/VOCABULARY.md,
// "The frontmatter claim"). Step one of four: readers accept it, writers still write `card-page:`,
// and no save changes one into the other.
//
// 🔴 Every reader here is asked BOTH ways: each thing shown for `cardtile:` is shown for
// `card-page:` in the same test, so a pass means "the two behave alike", not "the new one happens
// to do something".
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readClaim, rekeyClaim, CLAIM_KEYS, CLAIM_KEY_WRITTEN, _internal } from './claim.mjs';
import { parseCard, serializeCard, setTitle } from './card-core.js';
import { assembleSave, thinCard, cardVersion } from './card-save.mjs';
import { isTemplateOnly } from './card-blank.mjs';
import { buildSandboxCard } from './w/sandbox-i18n.mjs';
import { fmRead, fmWrite, applySetting } from './w3/card-settings.mjs';
import { frontOf } from './w3/deck-page.mjs';
import { renderCardHTML } from './serve/card-worker.mjs';
import { VALID_HANDLE } from './serve/card-api.mjs';
import { splitFrontmatter } from '../sitetile/site-core.js';
import { parseFile, serializeFile } from '../tugtile/board-core.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** one card with the claim lines given — canonical, as a stored file is, so a round trip can be compared byte for byte */
const cardWith = (...claims) => serializeCard(parseCard(handTyped(...claims)));
const handTyped = (...claims) => [
  '---', ...claims, 'title: Aster', 'accent: #0556ff', 'back: "#about"', '---', '',
  '## grid', '',
  '- [ ] %% card: profile w=6 avatar="asset:pic" %% hello',
  '- [ ] %% cardtile: link w=3 %% [Site](https://example.com)',
  '',
  '## back: about', '',
  '- [ ] %% card: text %% more',
  '',
  '## assets', '',
  `- [ ] %% card: asset id=pic mime=image/gif %% ${GIF}`,
  '',
].join('\n');
const OLD = cardWith('card-page: aster');
const NEW = cardWith('cardtile: aster');
const SPELLINGS = [['card-page', OLD], ['cardtile', NEW]];
/** the claim line(s) of a file's fence, as written */
const claimsOf = (md) => /^---\n([\s\S]*?)\n---/.exec(md)[1].split('\n').filter((l) => /^(cardtile|card-page):/.test(l));

// ── reading ──────────────────────────────────────────────────────────────────────────────────────

test('🔴 readClaim reads `cardtile:` exactly as it reads `card-page:`', () => {
  assert.deepEqual(readClaim(OLD), { key: 'card-page', handle: 'aster' });
  assert.deepEqual(readClaim(NEW), { key: 'cardtile', handle: 'aster' });
  // the same shapes of line, in either spelling
  for (const key of CLAIM_KEYS) {
    assert.deepEqual(readClaim(`---\n${key}:aster\n---\n`), { key, handle: 'aster' }, `${key}: no space after the colon`);
    assert.deepEqual(readClaim(`---\n${key}:   aster  \t\n---\n`), { key, handle: 'aster' }, `${key}: padded`);
    assert.deepEqual(readClaim(`---\ntitle: T\n${key}: aster\n---\n`), { key, handle: 'aster' }, `${key}: not the first line`);
    assert.deepEqual(readClaim(`---\r\n${key}: aster\r\ntitle: T\r\n---\r\n`), { key, handle: 'aster' }, `${key}: CRLF`);
    assert.deepEqual(readClaim(`---\n${key}: aster\n---`), { key, handle: 'aster' }, `${key}: a fence that ends the file`);
    assert.equal(readClaim(`---\n${key}:\ntitle: T\n---\n`), null, `${key}: nothing after the colon is not a claim`);
    assert.equal(readClaim(`---\n ${key}: aster\n---\n`), null, `${key}: indented is not a key`);
    assert.equal(readClaim(`---\ntitle: T\n---\n\n${key}: aster\n`), null, `${key}: below the fence is the author's text`);
    assert.equal(readClaim(`${key}: aster\n`), null, `${key}: no fence`);
    assert.equal(readClaim(`\n---\n${key}: aster\n---\n`), null, `${key}: a fence that is not on the first line is not frontmatter`);
  }
});

test('readClaim: only these two words are a claim, and no file is no claim', () => {
  for (const near of ['cardtiles', 'card', 'cards', 'card-pages', 'cardtile-page', 'xcardtile', 'Cardtile', 'CARD-PAGE', 'sitetile', 'tugtile']) {
    assert.equal(readClaim(`---\n${near}: aster\ntitle: T\n---\n`), null, near);
  }
  assert.equal(readClaim('---\ncardtile : aster\n---\n'), null, 'a space before the colon is not this key');
  for (const nothing of [undefined, null, '', '---\n---\n', '## grid\n\n- [ ] %% cardtile: text %% hi\n']) assert.equal(readClaim(nothing), null);
  assert.deepEqual([...CLAIM_KEYS], ['cardtile', 'card-page']);
  assert.ok(Object.isFrozen(CLAIM_KEYS));
});

test('🔴 a file with BOTH keys: `cardtile:` wins, in either order — and is the answer that survives the old key going away', () => {
  const newFirst = cardWith('cardtile: aster', 'card-page: older');
  const oldFirst = cardWith('card-page: older', 'cardtile: aster');
  assert.deepEqual(readClaim(newFirst), { key: 'cardtile', handle: 'aster' });
  assert.deepEqual(readClaim(oldFirst), { key: 'cardtile', handle: 'aster' });
  // the reason it is this way round: delete the old line (what dropping the old key amounts to) and
  // the file claims the same handle it claimed before
  for (const both of [newFirst, oldFirst]) {
    const afterTheOldKeyIsGone = both.replace(/^card-page:.*\n/m, '');
    assert.equal(readClaim(afterTheOldKeyIsGone).handle, readClaim(both).handle);
  }
  // CONTROL: the old key is still read when it is the only one that says anything
  assert.deepEqual(readClaim(cardWith('cardtile:', 'card-page: older')), { key: 'card-page', handle: 'older' });
  assert.deepEqual(readClaim(cardWith('card-page: older')), { key: 'card-page', handle: 'older' });
  // within one key the first line wins
  assert.deepEqual(readClaim(cardWith('cardtile: one', 'cardtile: two')), { key: 'cardtile', handle: 'one' });
  assert.deepEqual(readClaim(cardWith('card-page: one', 'card-page: two')), { key: 'card-page', handle: 'one' });
});

// ── re-keying ────────────────────────────────────────────────────────────────────────────────────

test('🔴 rekeyClaim gives the file a new handle and keeps the key it was written with', () => {
  assert.equal(rekeyClaim(OLD, 'maple'), OLD.replace('card-page: aster', 'card-page: maple'));
  assert.equal(rekeyClaim(NEW, 'maple'), NEW.replace('cardtile: aster', 'cardtile: maple'));
  for (const [key, md] of SPELLINGS) {
    const moved = rekeyClaim(md, 'maple');
    assert.deepEqual(readClaim(moved), { key, handle: 'maple' }, key);
    assert.deepEqual(claimsOf(moved), [`${key}: maple`], `${key}: one claim line, same key`);
    assert.equal(rekeyClaim(moved, 'aster'), md, `${key}: and back again is the file it was, byte for byte`);
    assert.equal(rekeyClaim(md, 'aster'), md, `${key}: re-keying to the handle it has changes nothing`);
  }
  // the re-keyer this replaces, for files it could already handle: the same bytes
  const before = (md, handle) => md.replace(/^card-page: .*$/m, `card-page: ${handle}`);
  assert.equal(rekeyClaim(OLD, 'maple'), before(OLD, 'maple'));
  assert.equal(rekeyClaim(buildSandboxCard('ja'), 'maple'), before(buildSandboxCard('ja'), 'maple'));
});

test('rekeyClaim: a file with both keys keeps both, and they agree afterwards', () => {
  const both = cardWith('card-page: older', 'cardtile: aster');
  const moved = rekeyClaim(both, 'maple');
  assert.deepEqual(claimsOf(moved), ['card-page: maple', 'cardtile: maple']);
  assert.deepEqual(readClaim(moved), { key: 'cardtile', handle: 'maple' });
  assert.equal(moved.replace(/^(cardtile|card-page): maple$/gm, ''), both.replace(/^(cardtile: aster|card-page: older)$/gm, ''), 'something other than the claim lines moved');
});

test('rekeyClaim touches the fence only: no claim, no fence, CRLF, and a claim-shaped line in the body', () => {
  const none = '---\ntitle: T\n---\n\n## grid\n\n- [ ] %% card: text %% hi\n';
  assert.equal(rekeyClaim(none, 'maple'), none, 'a file with no claim is not given one');
  assert.equal(rekeyClaim('## grid\n\n- [ ] %% card: text %% hi\n', 'maple'), '## grid\n\n- [ ] %% card: text %% hi\n');
  assert.equal(rekeyClaim('', 'maple'), '');
  for (const key of CLAIM_KEYS) {
    const crlf = `---\r\n${key}: aster\r\ntitle: T\r\n---\r\n\r\n## grid\r\n`;
    assert.equal(rekeyClaim(crlf, 'maple'), crlf.replace('aster', 'maple'), `${key}: CRLF kept`);
    const inBody = `---\n${key}: aster\ntitle: T\n---\n\n## grid\n\n- [ ] %% card: text %%\n\t${key}: aster\n\n${key}: aster\n`;
    assert.equal(rekeyClaim(inBody, 'maple'), inBody.replace('aster', 'maple'), `${key}: only the fence's line moved`);
    const emptyValue = `---\n${key}:\ntitle: T\n---\n`;
    assert.equal(rekeyClaim(emptyValue, 'maple'), `---\n${key}: maple\ntitle: T\n---\n`, `${key}: an empty claim line is filled, with its own key`);
  }
});

test('🔴 rekeyClaim refuses a value that is not a handle — it is written into somebody\'s frontmatter', () => {
  for (const bad of ['', 'Maple', 'a b', '-a', 'a\ntitle: Owned', 'a\r\nrobots: index', 'a: b', 'x'.repeat(64), null, undefined, 7, {}, ['a']]) {
    for (const [key, md] of SPELLINGS) assert.throws(() => rekeyClaim(md, bad), TypeError, `${key} ← ${JSON.stringify(bad)}`);
  }
  // CONTROL: the longest and the shortest handle the API takes are taken here too, and the grammar is the API's
  for (const ok of ['a', '0', 'x'.repeat(63), 'a-b-c', 'cards', 'cardtile']) assert.equal(readClaim(rekeyClaim(NEW, ok)).handle, ok);
  assert.equal(String(_internal.HANDLE), String(VALID_HANDLE), 'claim.mjs repeats the API\'s handle grammar and the two have drifted');
});

// ── nothing else in the file's path treats the new key as anything ───────────────────────────────

test('🔴 the two spellings parse to the same Cards and each round-trips byte for byte', () => {
  const strip = (m) => ({ ...m, pre: m.pre.replace(/^(cardtile|card-page): /m, '<claim>: ') });
  assert.deepEqual(strip(parseCard(NEW)), strip(parseCard(OLD)), 'the claim key changed what the parser read');
  for (const [key, md] of SPELLINGS) {
    assert.equal(serializeCard(parseCard(md)), md, `${key}: parse → serialize`);
    assert.deepEqual(claimsOf(serializeCard(parseCard(md))), [`${key}: aster`], key);
    // the board machine underneath, which has frontmatter keys of its own that it does rewrite
    assert.match(serializeFile(parseFile(md)), new RegExp(`^---\\n${key}: aster\\n`), `${key}: the board serializer kept the line`);
  }
  // a file with both keeps both, in the order written
  const both = cardWith('card-page: older', 'cardtile: aster');
  assert.equal(serializeCard(parseCard(both)), both);
});

test('🔴 a save keeps the claim as written: thin, assemble, and the version follow the bytes, never the other spelling', async () => {
  for (const [key, md] of SPELLINGS) {
    const thin = thinCard(md);
    assert.deepEqual(claimsOf(thin), [`${key}: aster`], `${key}: the thin read`);
    const saved = assembleSave(thin.replace('hello', 'edited'), md).md;
    assert.deepEqual(claimsOf(saved), [`${key}: aster`], `${key}: the assembled save`);
    assert.equal(assembleSave(thin, md).md, md, `${key}: a save with no edit is the stored file`);
  }
  assert.notEqual(await cardVersion(NEW), await cardVersion(OLD), 'the version is a hash of the bytes; the two spellings are two files');
  // saving a `cardtile:` thin card over a stored `card-page:` one stores what the caller sent, and the other way round
  assert.deepEqual(claimsOf(assembleSave(thinCard(NEW), OLD).md), ['cardtile: aster']);
  assert.deepEqual(claimsOf(assembleSave(thinCard(OLD), NEW).md), ['card-page: aster']);
});

test('🔴 the editor\'s frontmatter writes keep the claim line: a settings change, a rename, a removed key', () => {
  for (const [key, md] of SPELLINGS) {
    const model = parseCard(md);
    assert.equal(fmRead(model.pre)[key], 'aster', `${key}: the settings reader sees it as one more key`);
    for (const [what, pre] of [
      ['theme set', applySetting(model.pre, 'theme', 'dark')],
      ['accent changed', applySetting(model.pre, 'accent', '#112233')],
      ['accent removed', fmWrite(model.pre, 'accent', null)],
      ['a key added', fmWrite(model.pre, 'icons', 'mono')],
      ['renamed', setTitle(model, 'Maple').pre],
    ]) {
      assert.deepEqual(claimsOf(pre), [`${key}: aster`], `${key}: ${what}`);
      assert.deepEqual(readClaim(pre), { key, handle: 'aster' }, `${key}: ${what}`);
    }
  }
  // the two spellings come out of each write differing in the claim key and nothing else
  const settle = (pre) => pre.replace(/^(cardtile|card-page): /m, '<claim>: ');
  assert.equal(settle(applySetting(parseCard(NEW).pre, 'theme', 'dark')), settle(applySetting(parseCard(OLD).pre, 'theme', 'dark')));
});

test('🔴 the renderer, the deck and the blank-card judgement do not read the claim: both spellings give the same page', () => {
  const page = (md) => renderCardHTML(md, { handle: 'aster', cardUrl: 'https://cards.example/aster' });
  assert.equal(page(NEW), page(OLD), 'the page differs by the claim key');
  // CONTROL: the page is not blind to the frontmatter — a key it does read changes it
  assert.notEqual(page(NEW.replace('title: Aster', 'title: Maple')), page(NEW));
  // the handle a page is rendered for is the one it was asked for, whatever the file claims
  assert.equal(page(rekeyClaim(NEW, 'someone-else')), page(NEW));
  assert.equal(frontOf(NEW), frontOf(OLD));
  assert.equal(frontOf(NEW), '---\nback: "#about"\n---\n', 'the deck was handed the claim');
  // blank-card: the sandbox card is template-only under either key, and stops being so on the same edit
  const sandbox = buildSandboxCard('en');
  const asNew = sandbox.replace(/^card-page: /m, 'cardtile: ');
  assert.notEqual(asNew, sandbox, 'the fixture did not change the key — this measures nothing');
  assert.equal(isTemplateOnly(sandbox), true);
  assert.equal(isTemplateOnly(asNew), true);
  for (const md of [sandbox, asNew]) assert.equal(isTemplateOnly(md.replace(/(%% card: text[^\n]*%%)[^\n]*/, '$1 my own words')), isTemplateOnly(sandbox.replace(/(%% card: text[^\n]*%%)[^\n]*/, '$1 my own words')));
});

test('a frontmatter key named `cardtile` is an ordinary key to the family\'s parsers — not a marker, not a setting', () => {
  // sitetile's frontmatter reader (the one parseCard uses): one more key, read like any other
  assert.deepEqual(splitFrontmatter('---\ncardtile: aster\ntitle: T\n---\nbody\n').meta, { cardtile: 'aster', title: 'T' });
  assert.deepEqual(splitFrontmatter('---\ncard-page: aster\ntitle: T\n---\nbody\n').meta, { 'card-page': 'aster', title: 'T' });
  // the line marker is `%% cardtile: <type> %%`; a frontmatter line has no `%%`, and a marker is not a claim
  const m = parseCard(NEW);
  assert.deepEqual(m.cells.map((c) => c.type), ['profile', 'link'], 'the claim line was read as a tile, or a tile was lost');
  assert.deepEqual(m.cells.map((c) => c.type), parseCard(OLD).cells.map((c) => c.type));
  assert.equal(readClaim('---\ntitle: T\n---\n\n## grid\n\n- [ ] %% cardtile: text %% hi\n'), null);
  // the board machine rewrites one frontmatter key of its own on save (its plugin key); `cardtile` is not it
  for (const key of CLAIM_KEYS) assert.ok(serializeFile(parseFile(`---\n${key}: aster\n---\n\n## grid\n\n- [ ] x\n`)).startsWith(`---\n${key}: aster\n---\n`), key);
});

// ── writers ──────────────────────────────────────────────────────────────────────────────────────

test('🔴 writers still write `card-page:` — the new key is accepted, not yet written', () => {
  assert.equal(CLAIM_KEY_WRITTEN, 'card-page');
  // the sandbox's starter, every locale
  for (const loc of ['en', 'ja', 'zh-TW', 'zh-CN', 'ko']) {
    assert.deepEqual(claimsOf(buildSandboxCard(loc)), ['card-page: try'], loc);
  }
  // the editor's starter (a browser module: read as text) and the specimen generator with its output
  const read = (rel) => fs.readFileSync(join(DIR, rel), 'utf8');
  assert.match(read('w/editor.mjs'), /const STARTER = \['---', 'card-page: card',/);
  for (const rel of ['w/editor.mjs', 'w/sandbox-i18n.mjs', 'cards/gen-specimens.mjs']) {
    assert.doesNotMatch(read(rel), /^\s*'?cardtile: /m, `${rel} writes the new claim key`);
    assert.match(read(rel), /card-page: /, `${rel} no longer writes a claim at all — this list is stale`);
  }
  // (a specimen file opens with a comment banner, so its fence is not on the first line: matched as text)
  for (const name of ['specimen-plain', 'specimen-assets', 'specimen-rich']) {
    const specimen = read(`cards/specimens/${name}.card.md`);
    assert.match(specimen, new RegExp(`^card-page: ${name}$`, 'm'), name);
    assert.doesNotMatch(specimen, /^cardtile: /m, name);
  }
});
