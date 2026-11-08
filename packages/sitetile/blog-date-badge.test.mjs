// The blog list's date, server-rendered vs re-rendered by the archive island (?ym= / ?tag=).
//
// 🩸 2026-11-08. The `cjk-badge` date is three spans (month / day / year). The server views wrote
// them with whitespace between; the island built them with createElement and no whitespace, so a
// filtered month read 「2月192024」 where the page it replaced read 「2月 19 2024」. A site had to add
// `gap` in its theme to hide it. The other formats were worse: the island printed the raw index
// date (2024-02-19) where the server printed the site's chosen format (2024/02/19, 2024 年 2 月 19 日…).
//
// The fix gives both sides ONE source for the markup — packages/emit/entry-date.mjs — and has the
// server hand the island the date spec it rendered with (`data-bl-date` on `.bl-list`). This test
// runs the real island over a stub DOM and checks the filtered card's <time> against the server's.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro', 'src');
const EMIT = join(HERE, '..', 'emit');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

// ── a DOM just big enough for the island ──
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
class Text { constructor(t) { this.data = String(t); } get textContent() { return this.data; } get outerHTML() { return esc(this.data); } }
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.className = ''; this.dataset = {}; this.attrs = {}; this.style = {}; this.parentNode = null; this.classList = { toggle() {}, contains: () => false }; }
  appendChild(c) {
    if (c instanceof Frag) { for (const k of c.children) this.appendChild(k); c.children = []; return c; }
    c.parentNode = this; this.children.push(c); return c;
  }
  insertBefore(n, ref) { n.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, n); return n; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() {}
  set textContent(v) { this.children = v === '' || v == null ? [] : [new Text(v)]; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  *walk() { for (const c of this.children) if (c instanceof El) { yield c; yield* c.walk(); } }
  querySelectorAll(sel) {
    if (!/^\.[\w-]+$/.test(sel)) return [];
    const cls = sel.slice(1);
    return [...this.walk()].filter((e) => e.className.split(/\s+/).includes(cls));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get outerHTML() {
    const cls = this.className ? ` class="${esc(this.className)}"` : '';
    const tag = this.tagName.toLowerCase();
    return `<${tag}${cls}>${this.children.map((c) => c.outerHTML).join('')}</${tag}>`;
  }
}
class Frag extends El { constructor() { super('#fragment'); } }

const ISLAND_SRC = readFileSync(join(SRC, 'packages', 'blog-archive', 'blog-archive.js'), 'utf8')
  .replace(/(['"])@emit\//g, `$1${pathToFileURL(EMIT).href}/`);
const ISLAND_DIR = mkdtempSync(join(tmpdir(), 'bl-date-island-'));

/** Run the island on a page whose server-rendered list carries `serverTime` (a <time> El) and the
 *  given spec, filtered to `ym`, over an index holding `rows`. Returns the rebuilt list. */
async function runIsland({ serverTime, spec, rows, ym, copy }) {
  const body = new El('body');
  const main = body.appendChild(new El('div')); main.className = 'bl-main';
  const list = main.appendChild(new El('ul')); list.className = 'bl-list';
  if (spec) list.dataset.blDate = JSON.stringify(spec);
  const li = list.appendChild(new El('li')); li.className = 'bl-entry';
  const a = li.appendChild(new El('a')); a.className = 'bl-entry-link';
  if (serverTime) a.appendChild(serverTime);
  const copyEl = { textContent: JSON.stringify(copy || {}) };
  globalThis.document = {
    querySelector: (sel) => (sel.startsWith('script[') ? copyEl : body.querySelector(sel)),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    createElement: (t) => new El(t),
    createTextNode: (t) => new Text(t),
    createDocumentFragment: () => new Frag(),
  };
  globalThis.location = { search: `?ym=${ym}`, pathname: '/blog/' };
  globalThis.fetch = async () => ({ ok: true, json: async () => rows });
  const file = join(ISLAND_DIR, `island-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, ISLAND_SRC);
  await import(pathToFileURL(file).href);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return list;
}

// Noon local time, so the day cannot slide across midnight with the test machine's time zone.
const DATE = '2024-02-19T12:00:00';
const ROWS = [{ t: 'A post', u: '/blog/a/', g: [], d: DATE, i: '' }];
const ZH_MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);

let emit = null;
try { emit = await import(pathToFileURL(join(EMIT, 'entry-date.mjs')).href); } catch { /* asserted below */ }

await test('the shared date emitter exists (packages/emit/entry-date.mjs)', () => {
  assert.ok(emit && typeof emit.entryDate === 'function' && typeof emit.entryDateHtml === 'function',
    'expected entryDate / entryDateHtml exported from packages/emit/entry-date.mjs');
});

// [label, the spec the server renders with, the text a visitor reads on the server page]
const CASES = [
  ['cjk-badge', { badge: true, months: ZH_MONTHS }, '2月 19 2024'],
  ['ymd-slash', { format: 'ymd-slash' }, '2024/02/19'],
  ['cjk-full', { format: 'cjk-full' }, '2024 年 2 月 19 日'],
  ['cjk-md', { format: 'cjk-md' }, '2月19日'],
  ['locale default (en-US)', { format: 'intl', tag: 'en-US' }, 'February 19, 2024'],
];

for (const [label, spec, text] of CASES) {
  await test(`🔴 ${label}: the filtered card's date reads exactly like the server's — "${text}"`, async () => {
    const serverTime = new El('time');
    serverTime.className = spec.badge ? 'bl-date bl-date-badge' : 'bl-date';
    const list = await runIsland({ serverTime, spec, rows: ROWS, ym: '2024-02', copy: { months: ZH_MONTHS } });
    const time = list.querySelector('.bl-date');
    assert.ok(time, 'the island rendered no date');
    assert.equal(time.textContent, text, 'text content, whitespace included');
    if (emit) {
      assert.equal(time.outerHTML, emit.entryDateHtml(DATE, spec),
        'the island\'s <time> must be the server\'s markup: same classes, same order, same whitespace');
    }
  });
}

await test('the server writes the badge with the same emitter, and its whitespace is what the island writes', () => {
  assert.ok(emit, 'no emitter');
  assert.equal(emit.entryDateHtml(DATE, CASES[0][1]),
    '<time class="bl-date bl-date-badge"><span class="bl-date-month">2月</span> <span class="bl-date-day">19</span> <span class="bl-date-year">2024</span></time>');
});

const SERVER_VIEWS = [
  ['components/BlogIndexView.astro', true],
  ['components/ArchiveView.astro', true],
  ['pages/search/label/[tag]/index.astro', false],
  ['pages/search/label/[tag]/page/[n].astro', false],
];

await test('🔴 every server list writes its date through entryDateHtml — no hand-kept second copy', () => {
  for (const [rel] of SERVER_VIEWS) {
    const s = readFileSync(join(SRC, rel), 'utf8');
    assert.match(s, /entryDateHtml\(p\.date, dateSpec\)/, `${rel}: the date is not written by the shared emitter`);
    assert.doesNotMatch(s, /bl-date-(month|day|year)/, `${rel}: still hand-writes badge spans`);
    assert.match(s, /const dateSpec = entryDateSpec\(dateFormat, lang, meta\.lang\)/, `${rel}: the spec is not resolved once per page`);
  }
});

await test('🔴 the views the island serves hand it the spec they rendered with', () => {
  for (const [rel, island] of SERVER_VIEWS) {
    if (!island) continue;
    const s = readFileSync(join(SRC, rel), 'utf8');
    assert.match(s, /<ul class="bl-list" data-bl-date=\{JSON\.stringify\(dateSpec\)\}>/, `${rel}: .bl-list carries no data-bl-date`);
  }
});

await test('🔴 the island renders the date through the same emitter', () => {
  const s = readFileSync(join(SRC, 'packages', 'blog-archive', 'blog-archive.js'), 'utf8');
  assert.match(s, /from '@emit\/entry-date\.mjs'/, 'the island does not import the shared emitter');
  assert.doesNotMatch(s, /'bl-date-(month|day|year)'/, 'the island still names the badge spans itself');
});

await test('CONTROL: the stub DOM tells adjacent spans from spaced ones', () => {
  const t = new El('time');
  for (const v of ['2月', '19', '2024']) { const s = new El('span'); s.textContent = v; t.appendChild(s); }
  assert.equal(t.textContent, '2月192024', 'the pre-fix shape must read run together here, or the checks above prove nothing');
});

console.log(`blog-date-badge: ${passed} passed`);
