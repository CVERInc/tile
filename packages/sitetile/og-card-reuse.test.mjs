// Guard: what a build may keep from the build before it.
//   run: node packages/sitetile/og-card-reuse.test.mjs   (picked up by scripts/test.sh's glob)
//
// A share card costs real time to draw, so a build is handed the cards of the previous one and
// draws only what changed. The ruler for that is not a stopwatch — it is a COUNT of cards drawn,
// read from the build's own summary — and one rule that every scenario below is held to:
//
//   🔴 what ships must be byte-for-byte what a build with nothing to reuse would have shipped.
//
// Reuse that is observable in the output is not reuse, it is a stale picture. So every scenario
// builds the same site a third time, from nothing, and compares every card.
//
// Each scenario runs twice, because a previous card can reach a build two ways and they fail in
// opposite directions when the check is "the file exists":
//   · in place — already sitting at its path in dist/. Kept blindly, a renamed site keeps every old
//     card: the count says 0 drawn and all of them are wrong.
//   · offered  — in a separate directory passed as --reuse. Ignored, every build draws every card:
//     nothing is wrong and nothing was saved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync, readdirSync, statSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

const BUILD_OG = fileURLToPath(new URL('./og/build-og.mjs', import.meta.url));
const NODE_MODULES = fileURLToPath(new URL('./astro/node_modules', import.meta.url));
// The drawing itself is the subject here, so these need the real renderer. Said out loud when it is
// missing: a file of skipped tests scrolling past inside a green run proves nothing about reuse.
const REAL = existsSync(join(NODE_MODULES, 'satori')) && existsSync(join(NODE_MODULES, '@resvg', 'resvg-js'));
if (!REAL) console.log('  · CARD REUSE AGAINST THE REAL RENDERER SKIPPED — no packages/sitetile/astro/node_modules (run npm ci there)');
const real = (name, fn) => test(name, { skip: REAL ? false : 'the renderer is not installed' }, fn);

// ── a small site, as the renderer leaves it in dist/ ─────────────────────────────────────────────
// Titles differ per page and across scripts, so one page's card can never pass for another's. One
// path is percent-encoded, the way a non-ASCII route reaches an og:image.
const SITE = [
  { path: '', title: 'Home' },
  { path: '/about', title: 'About the workshop' },
  { path: '/notes/first', title: 'A first note' },
  { path: '/notes/second', title: '把任何文字變成網站' },
  { path: '/notes/%E7%AD%86%E8%A8%98', title: 'こんにちは、世界' },
  { path: '/guide/setup', title: 'Setting things up, step by step' },
];
const N = SITE.length;
const cardOf = (page) => `/og${page.path === '' ? '/index' : page.path}.png`;
const edit = (pages, path, change) => pages.map((p) => (p.path === path ? { ...p, ...change } : p));

function html(page, { site = 'Example Works', theme = '#0b5560' } = {}) {
  const name = page.site ?? site;
  const image = `https://example.test${cardOf(page)}`;
  return '<!doctype html><html><head>'
    + `<meta name="theme-color" content="${page.theme ?? theme}" media="(prefers-color-scheme: light)">`
    + '<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">'
    + `<meta property="og:title" content="${page.title}${name ? ` — ${name}` : ''}">`
    + (name ? `<meta property="og:site_name" content="${name}">` : '')
    + `<meta name="sitetile:og-card" content="${page.policy ?? 'strict'}">`
    + `<meta property="og:image" content="${image}"><meta name="twitter:image" content="${image}">`
    + '<meta name="twitter:card" content="summary_large_image">'
    + `</head><body>${page.body ?? 'the first version of this page'}</body></html>`;
}
function writeSite(dir, pages, siteWide) {
  for (const page of pages) {
    const file = join(dir, page.path, 'index.html');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html(page, siteWide));
  }
}

/** Run the real CLI and read its own summary. A summary that is not there is an error, never zeros:
 *  "0 drawn" and "said nothing" must not look alike. */
function build(dist, args = []) {
  const r = spawnSync(process.execPath, [BUILD_OG, dist, ...args], { encoding: 'utf8' });
  const line = /▸ og cards: [^\n]*/.exec(r.stdout)?.[0] ?? '';
  const n = (re) => Number(re.exec(line)?.[1] ?? 0);
  return {
    status: r.status, stdout: r.stdout, stderr: r.stderr, line,
    rendered: n(/og cards: (\d+) rendered/), unchanged: n(/(\d+) unchanged/), omitted: n(/(\d+) omitted/),
  };
}
const ok = (b) => { assert.equal(b.status, 0, b.stderr || b.stdout); assert.ok(b.line, `no summary line in: ${b.stdout}`); return b; };

function files(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, out); else out.push(p);
  }
  return out;
}
const cards = (dist) => Object.fromEntries(files(join(dist, 'og')).map((f) => [relative(dist, f), readFileSync(f)]));

// A build with nothing to reuse is the expensive part, and most scenarios share one: the same site
// and flags are built once and copied. Only builds that START FROM NOTHING are shared — the build
// under test, the one handed previous cards, is always run for real.
const FROM_NOTHING = new Map();
const SHARED = mkdtempSync(join(tmpdir(), 'card-reuse-shared-'));
process.on('exit', () => rmSync(SHARED, { recursive: true, force: true }));
function builtFromNothing(pages, siteWide, args) {
  const id = JSON.stringify([pages, siteWide ?? null, args]);
  if (!FROM_NOTHING.has(id)) {
    const dir = join(SHARED, String(FROM_NOTHING.size));
    writeSite(dir, pages, siteWide);
    ok(build(dir, args));
    FROM_NOTHING.set(id, dir);
  }
  return FROM_NOTHING.get(id);
}

/**
 * previous build → (something changes) → next build, plus the same next site built from nothing.
 * `how` is the route the previous cards take into the next build.
 */
function rebuild({ before = SITE, after = SITE, beforeSite, afterSite, how, tamper, args = [], firstArgs = args }) {
  const root = mkdtempSync(join(tmpdir(), 'card-reuse-'));
  try {
    const prev = join(root, 'prev'), next = join(root, 'next');
    cpSync(builtFromNothing(before, beforeSite, firstArgs), prev, { recursive: true });   // a copy: `tamper` edits it
    if (tamper) tamper(join(prev, 'og'));
    writeSite(next, after, afterSite);
    if (how === 'in place' && existsSync(join(prev, 'og'))) cpSync(join(prev, 'og'), join(next, 'og'), { recursive: true });
    const second = ok(build(next, how === 'offered' ? ['--reuse', prev, ...args] : args));
    const shipped = cards(next), control = cards(builtFromNothing(after, afterSite, args));
    const wrong = Object.keys(control).filter((rel) => !shipped[rel] || !shipped[rel].equals(control[rel]));
    const extra = Object.keys(shipped).filter((rel) => !control[rel]);
    return { second, wrong, extra, controlCount: Object.keys(control).length };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function assertShipsWhatAFreshBuildShips(r) {
  assert.ok(r.controlCount > 0, 'the control build drew nothing, so the comparison compared nothing');
  assert.deepEqual(r.wrong, [], 'cards that differ from a build with nothing to reuse');
  assert.deepEqual(r.extra, [], 'cards a build with nothing to reuse would not have shipped');
}

// ── the counts ───────────────────────────────────────────────────────────────────────────────────
real(`a first build draws every card (${N})`, () => {
  const dist = mkdtempSync(join(tmpdir(), 'card-reuse-'));
  try {
    writeSite(dist, SITE);
    const b = ok(build(dist));
    assert.deepEqual([b.rendered, b.unchanged], [N, 0], b.line);
    assert.equal(Object.keys(cards(dist)).length, N);
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

const SCENARIOS = [
  ['nothing changed', {}, 0],
  ['one page retitled', { after: edit(SITE, '/notes/first', { title: 'A first note, revised' }) }, 1],
  ['one page with only its body edited', { after: edit(SITE, '/about', { body: 'the second version of this page' }) }, 0],
  ['the site renamed', { afterSite: { site: 'Example Works & Sons' } }, N],
  ['the theme colour changed', { afterSite: { theme: '#7a1f3d' } }, N],
  ['a page added', { after: [...SITE, { path: '/notes/fourth', title: 'A fourth note' }] }, 1],
  ['a colour forced by flag', { args: ['--bg', '#222222'], firstArgs: [] }, N],
  ['the same flags as last time', { args: ['--brand', 'EXAMPLE', '--fg', '#fefefe'] }, 0],
];
for (const how of ['in place', 'offered']) {
  for (const [name, change, drawn] of SCENARIOS) {
    real(`${name} ⇒ ${drawn} drawn (previous cards ${how})`, () => {
      const r = rebuild({ ...change, how });
      const total = (change.after || SITE).length;
      assert.deepEqual([r.second.rendered, r.second.unchanged], [drawn, total - drawn], r.second.line);
      assertShipsWhatAFreshBuildShips(r);
    });
  }
}

// ── previous cards that must not be believed ─────────────────────────────────────────────────────
const everyCard = (og, fn) => { for (const f of files(og)) writeFileSync(f, fn(readFileSync(f), f)); };
/** Independent of the module under test: walks the chunks with zlib's CRC, not ours. */
function pngChunks(buf) {
  assert.equal(buf.subarray(0, 8).toString('latin1'), '\x89PNG\r\n\x1a\n', 'PNG signature');
  const out = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    assert.equal(zlib.crc32(buf.subarray(at + 4, at + 8 + len)), buf.readUInt32BE(at + 8 + len), `${type} checksum`);
    out.push({ type, bytes: buf.subarray(at, at + 12 + len), data: buf.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  return out;
}
const isKey = (c) => c.type === 'tEXt' && c.data.toString('latin1').startsWith('sitetile:card\0');
const withoutKey = (buf) => Buffer.concat([buf.subarray(0, 8), ...pngChunks(buf).filter((c) => !isKey(c)).map((c) => c.bytes)]);

const SUSPECTS = [
  ['none at all — cards were switched on after the last build', (og) => rmSync(og, { recursive: true }), N],
  ['only some — the last build could not draw two', (og) => { rmSync(join(og, 'about.png')); rmSync(join(og, 'index.png')); }, 2],
  ['two cards under each other\'s names', (og) => {
    renameSync(join(og, 'about.png'), join(og, 'tmp')); renameSync(join(og, 'index.png'), join(og, 'about.png')); renameSync(join(og, 'tmp'), join(og, 'index.png'));
  }, 2],
  ['one cut short', (og) => { const f = join(og, 'about.png'); const b = readFileSync(f); writeFileSync(f, b.subarray(0, b.length - 40)); }, 1],
  ['one with a single byte flipped', (og) => { const f = join(og, 'about.png'); const b = readFileSync(f); b[b.length >> 1] ^= 1; writeFileSync(f, b); }, 1],
  ['one that is not a picture', (og) => writeFileSync(join(og, 'about.png'), '<!doctype html><title>Home</title>'), 1],
  ['all drawn before cards carried a key', (og) => everyCard(og, withoutKey), N],
];
for (const how of ['in place', 'offered']) {
  for (const [name, tamper, drawn] of SUSPECTS) {
    real(`previous cards: ${name} ⇒ ${drawn} drawn (${how})`, () => {
      const r = rebuild({ how, tamper });
      assert.deepEqual([r.second.rendered, r.second.unchanged], [drawn, N - drawn], r.second.line);
      assertShipsWhatAFreshBuildShips(r);
    });
  }
}

real('previous cards drawn by a different renderer ⇒ every card drawn', async () => {
  const { cardStamp, stampCard } = await import('./og/og-card.mjs');
  for (const how of ['in place', 'offered']) {
    const r = rebuild({
      how,
      // The same pixels, the same inputs — only the half of the key that names the renderer moves.
      tamper: (og) => everyCard(og, (buf) => {
        const [v, renderer, inputs] = cardStamp(buf).split(' ');
        const other = renderer.replace(/^./, (c) => (c === '0' ? '1' : '0'));
        return stampCard(withoutKey(buf), `${v} ${other} ${inputs}`);
      }),
    });
    assert.deepEqual([r.second.rendered, r.second.unchanged], [N, 0], `${how}: ${r.second.line}`);
    assertShipsWhatAFreshBuildShips(r);
  }
});

real('the summary says when cards came back and were not kept, and --report carries the counts', () => {
  const root = mkdtempSync(join(tmpdir(), 'card-reuse-'));
  try {
    const prev = join(root, 'prev'), next = join(root, 'next'), report = join(root, 'report.json');
    writeSite(prev, SITE);
    ok(build(prev));
    writeSite(next, edit(SITE, '/about', { title: 'About us' }));
    const b = ok(build(next, ['--reuse', prev, '--report', report]));
    assert.match(b.line, /^▸ og cards: 1 rendered \(1 in place of a card that no longer matches\), 5 unchanged \(\d+ms\) — all 6 og:image target\(s\) exist$/);
    assert.deepEqual(JSON.parse(readFileSync(report, 'utf8')), { v: 1, cards: N, rendered: 1, reused: N - 1, replaced: 1, omitted: 0 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

real('a card that cannot be drawn leaves no old picture behind, and is counted', () => {
  // No font here covers a private-use codepoint, and this page names no site, so nothing in its card
  // can be drawn. It asks for a card only by default, so the build goes on without one.
  const undrawable = { title: '\u{e000}\u{e001}', site: '', policy: 'optional' };
  const root = mkdtempSync(join(tmpdir(), 'card-reuse-'));
  try {
    const prev = join(root, 'prev'), next = join(root, 'next'), report = join(root, 'report.json');
    writeSite(prev, SITE);
    ok(build(prev));
    writeSite(next, edit(SITE, '/about', undrawable));
    cpSync(join(prev, 'og'), join(next, 'og'), { recursive: true });   // the old card is already at the path
    const b = ok(build(next, ['--report', report]));
    assert.deepEqual([b.rendered, b.unchanged, b.omitted], [0, N - 1, 1], b.line);
    assert.equal(existsSync(join(next, 'og/about.png')), false, 'the previous card for that page must not ship');
    assert.doesNotMatch(readFileSync(join(next, 'about/index.html'), 'utf8'), /og:image|twitter:image/);
    assert.deepEqual(JSON.parse(readFileSync(report, 'utf8')), { v: 1, cards: N - 1, rendered: 0, reused: N - 1, replaced: 0, omitted: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

real('--reuse cannot be walked out of, and a site with no cards still reports', () => {
  const root = mkdtempSync(join(tmpdir(), 'card-reuse-'));
  try {
    const prev = join(root, 'prev'), next = join(root, 'next'), none = join(root, 'none'), report = join(root, 'report.json');
    writeSite(prev, SITE);
    ok(build(prev));
    // A valid card for these exact inputs, one level ABOVE the directory that was offered.
    cpSync(join(prev, 'og/about.png'), join(root, 'about.png'));
    writeSite(next, SITE);
    const page = join(next, 'about/index.html');
    writeFileSync(page, readFileSync(page, 'utf8').replaceAll('/og/about.png', '/og/../../about.png'));
    const b = build(next, ['--reuse', prev]);
    assert.equal(b.status, 0, b.stderr);
    assert.equal(b.unchanged, N - 1, `a path with .. in it is not one of our cards: ${b.line}`);
    assert.ok(readFileSync(join(root, 'about.png')).equals(readFileSync(join(prev, 'og/about.png'))), 'nothing outside dist was touched');

    mkdirSync(none);
    writeFileSync(join(none, 'index.html'), '<!doctype html><html><head><meta property="og:title" content="x"></head></html>');
    const quiet = build(none, ['--report', report]);
    assert.equal(quiet.stdout, '▸ og cards: none requested\n');
    assert.deepEqual(JSON.parse(readFileSync(report, 'utf8')), { v: 1, cards: 0, rendered: 0, reused: 0, replaced: 0, omitted: 0 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── the key itself (no renderer needed) ──────────────────────────────────────────────────────────
const og = await import('./og/og-card.mjs');

/** A 1×1 PNG built with zlib's CRC — so the module's own checksum code is checked against another. */
function tinyPng() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(zlib.crc32(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0]))), chunk('IEND', Buffer.alloc(0))]);
}
const RENDERER = 'ab'.repeat(32);

test('every input of a card moves its key — including one added later', () => {
  const base = { title: 'Title', brand: 'Brand', bg: '#101010', fg: '#fefefe' };
  // Iterated over what cardInputs RETURNS, not over a list typed here: a new input is covered the
  // day it is added, and it cannot be added anywhere else and still reach the drawing.
  const keys = Object.keys(og.cardInputs(base));
  assert.deepEqual(keys.sort(), ['bg', 'brand', 'fg', 'title'], 'this list is only here so a change to it is seen');
  for (const k of keys) {
    assert.notEqual(og.inputsDigest({ ...base, [k]: base[k] + 'x' }), og.inputsDigest(base), `${k} is not in the key`);
  }
  assert.equal(og.inputsDigest({ title: 'Title' }), og.inputsDigest({ title: 'Title', brand: '', bg: '#111111', fg: '#ffffff' }),
    'a default and the same value spelled out are one card');
  assert.notEqual(og.inputsDigest({ title: 'ab', brand: 'c' }), og.inputsDigest({ title: 'a', brand: 'bc' }),
    'a character moving between fields is a different card');
  assert.notEqual(og.cardKey(RENDERER, base), og.cardKey('cd'.repeat(32), base), 'and so is another renderer');
});

test('a key survives the round trip, and the stamped file is still a well-formed PNG', () => {
  const key = og.cardKey(RENDERER, { title: 'Title' });
  const stamped = og.stampCard(tinyPng(), key);
  assert.equal(og.cardStamp(stamped), key);
  const chunks = pngChunks(stamped);   // zlib's CRC over every chunk, ours included
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'tEXt', 'IDAT', 'IEND']);
  assert.ok(withoutKey(stamped).equals(tinyPng()), 'stamping adds one chunk and changes nothing else');
});

test('🔴 anything short of one intact PNG with exactly one key has no key', () => {
  const key = og.cardKey(RENDERER, { title: 'Title' });
  const good = og.stampCard(tinyPng(), key);
  const flipped = (at) => { const b = Buffer.from(good); b[at] ^= 1; return b; };
  const twice = (() => {   // a second key chunk, well-formed, saying something else
    const chunks = pngChunks(good);
    const second = pngChunks(og.stampCard(tinyPng(), og.cardKey(RENDERER, { title: 'Other' }))).find(isKey);
    return Buffer.concat([good.subarray(0, 8), chunks[0].bytes, chunks[1].bytes, second.bytes, ...chunks.slice(2).map((c) => c.bytes)]);
  })();
  const suspects = {
    'no key': tinyPng(),
    'cut short': good.subarray(0, good.length - 5),
    'cut inside the end marker': good.subarray(0, good.length - 1),
    'bytes after the end': Buffer.concat([good, Buffer.from('x')]),
    'a flipped byte in the key': flipped(8 + 25 + 8 + 20),
    'a flipped byte in the pixels': flipped(good.length - 12 - 6),
    'two keys': twice,
    'not a PNG': Buffer.from('<!doctype html>'),
    'empty': Buffer.alloc(0),
    'a key of the wrong shape': og.stampCard(tinyPng(), 'v1 short'),
  };
  for (const [name, bytes] of Object.entries(suspects)) {
    assert.equal(og.cardStamp(bytes), null, name);
    assert.equal(og.cardMatches(bytes, { key }), false, name);
  }
  // The control: the same checks on the good one, or every line above proves nothing.
  assert.equal(og.cardStamp(good), key);
  assert.equal(og.cardMatches(good, { key }), true);
  assert.throws(() => og.stampCard(good, key), /already stamped/);
  assert.throws(() => og.stampCard(Buffer.from('fixture image'), key), /not a complete PNG/);
});

test('with no renderer to compare, a card is kept only for its own inputs — and never with neither', () => {
  const inputs = { title: 'Title', brand: 'Brand' };
  const card = og.stampCard(tinyPng(), og.cardKey(RENDERER, inputs));
  assert.equal(og.cardMatches(card, { inputs }), true);
  assert.equal(og.cardMatches(card, { inputs: { ...inputs, brand: 'Renamed' } }), false);
  assert.equal(og.cardMatches(card, {}), false, 'nothing to compare against is not a match');
  assert.equal(og.cardMatches(card, { key: og.cardKey('cd'.repeat(32), inputs), inputs }), false,
    'a full key, when there is one, is the only thing compared');
});

test('🔴 the renderer identity moves when ANY file it is made of moves, and is absent without a record of the install', () => {
  const root = mkdtempSync(join(tmpdir(), 'card-identity-'));
  try {
    const nm = join(root, 'astro', 'node_modules');
    const put = (rel, text) => { const f = join(nm, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
    put('.package-lock.json', '{"packages":{"node_modules/satori":{"version":"1.0.0"}}}');
    put('satori/package.json', '{"name":"satori","version":"1.0.0"}');
    put('@resvg/resvg-js/package.json', '{"name":"@resvg/resvg-js","version":"2.0.0"}');
    put('@fontsource/alpha/700.css', '@font-face{src:url(./files/alpha-a.woff);unicode-range:U+0-7F;}@font-face{src:url(./files/alpha-b.woff);unicode-range:U+80-FF;}');
    put('@fontsource/alpha/files/alpha-a.woff', 'font a');
    put('@fontsource/alpha/files/alpha-b.woff', 'font b');
    const identity = () => og.rendererIdentity({
      nodeModulesDir: nm, packages: ['alpha'], weight: 700, index: og.indexFontPackage(nm, 'alpha', 700),
    });
    const id = identity();
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.equal(identity(), id, 'the same install is the same renderer');
    // Every file in the fixture, found by walking it: nothing here is exempt by being forgotten.
    const parts = files(nm);
    assert.equal(parts.length, 6);
    for (const f of parts) {
      const was = readFileSync(f);
      writeFileSync(f, Buffer.concat([was, Buffer.from(' ')]));
      assert.notEqual(identity(), id, `${relative(nm, f)} changed and the identity did not`);
      writeFileSync(f, was);
    }
    assert.equal(identity(), id, 'and it comes back when they do');
    // Same ranges file under another weight's name: only the weight itself is different.
    put('@fontsource/alpha/400.css', readFileSync(join(nm, '@fontsource/alpha/700.css')));
    assert.notEqual(og.rendererIdentity({ nodeModulesDir: nm, packages: ['alpha'], weight: 400, index: og.indexFontPackage(nm, 'alpha', 400) }), id, 'weight');

    // 🔴 …and when the MACHINE moves, which no file in the tree records: a newer runtime breaks
    // lines differently, and the two C-library builds of the rasteriser are installed side by side.
    // Iterated over what currentRuntime() returns, so a part added later is covered the day it is.
    const runtime = og.currentRuntime();
    assert.deepEqual(Object.keys(runtime).sort(), ['arch', 'glibc', 'icu', 'node', 'platform'], 'this list is only here so a change to it is seen');
    const on = (rt) => og.rendererIdentity({ nodeModulesDir: nm, packages: ['alpha'], weight: 700, index: og.indexFontPackage(nm, 'alpha', 700), runtime: rt });
    assert.equal(on(runtime), id, 'the default is the machine this is running on');
    for (const k of Object.keys(runtime)) {
      assert.notEqual(on({ ...runtime, [k]: `${runtime[k]}+` }), id, `runtime.${k} changed and the identity did not`);
    }
    assert.notEqual(on({ ...runtime, node: runtime.platform, platform: runtime.node }), id, 'two parts trading values is a different machine');

    rmSync(join(nm, '.package-lock.json'));
    assert.equal(identity(), null, 'no record of what is installed ⇒ no identity ⇒ nothing is reused');
    writeFileSync(join(root, 'astro', 'package-lock.json'), '{"packages":{}}');
    assert.match(identity(), /^[0-9a-f]{64}$/, 'the lockfile beside node_modules is the other record');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

real('the real renderer: its PNG passes our checksum walk, and the same card twice is the same bytes', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'card-reuse-'));
  try {
    writeSite(dist, SITE.slice(0, 2));
    ok(build(dist));
    const first = cards(dist);
    for (const [rel, bytes] of Object.entries(first)) {
      assert.match(og.cardStamp(bytes) ?? '', /^v1 [0-9a-f]{64} [0-9a-f]{64}$/, `${rel} carries a key`);
      assert.deepEqual(pngChunks(bytes).filter(isKey).length, 1, 'exactly one, by a walk that is not ours');
    }
    rmSync(join(dist, 'og'), { recursive: true });
    ok(build(dist));
    const second = cards(dist);
    for (const rel of Object.keys(first)) assert.ok(first[rel].equals(second[rel]), `${rel} drawn twice differs`);
  } finally { rmSync(dist, { recursive: true, force: true }); }
});
