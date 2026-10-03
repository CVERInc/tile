// Guard: a share card is written where a request for its og:image will look.
//   run: node packages/sitetile/og-card-file.test.mjs   (picked up by scripts/test.sh's glob)
//
// A page's og:image is a URL, and a URL is percent-encoded: the page at /notes/筆記/ names its card
// /og/notes/%E7%AD%86%E8%A8%98.png. A static host decodes a request path once before looking for the
// file, so that request is answered from og/notes/筆記.png. The card therefore has to be WRITTEN at
// the decoded name — written at the encoded one, it sits on disk with percent signs in its name and
// every request for it is a 404, while a gate that compares the same undecoded string with the disk
// reports it present.
//
// The oracle below is deliberately not the module under test: "what a host serves" is computed here
// with the platform's own decodeURIComponent on the URL's pathname, the way a host does it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync, readdirSync, statSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const og = await import('./og/og-card.mjs');
const BUILD_OG = fileURLToPath(new URL('./og/build-og.mjs', import.meta.url));
const NODE_MODULES = fileURLToPath(new URL('./astro/node_modules', import.meta.url));
const REAL = existsSync(join(NODE_MODULES, 'satori')) && existsSync(join(NODE_MODULES, '@resvg', 'resvg-js'));
if (!REAL) console.log('  · CARD FILE NAMES AGAINST THE REAL RENDERER SKIPPED — no packages/sitetile/astro/node_modules (run npm ci there)');
const real = (name, fn) => test(name, { skip: REAL ? false : 'the renderer is not installed' }, fn);

/** What a static host looks up for this og:image: the pathname, decoded once, relative to the root. */
const served = (img) => decodeURIComponent(new URL(img, 'https://example.test').pathname).slice(1);

// ── the conversion ───────────────────────────────────────────────────────────────────────────────
// Uneven on purpose: different scripts, depths, letter cases of the hex digits, and characters that
// mean something in a query string but nothing in a path.
const PLACED = [
  ['https://example.test/og/notes/%E7%AD%86%E8%A8%98.png', '/og/notes/筆記.png'],
  ['/og/notes/%E3%81%8B%E3%81%AA/%E3%83%8E%E3%83%BC%E3%83%88.png', '/og/notes/かな/ノート.png'],
  ['/og/notes/%e7%ad%86%e8%a8%98.png', '/og/notes/筆記.png'],
  ['/og/our%20team%20&%20friends.png', '/og/our team & friends.png'],
  ['/og/a+b.png', '/og/a+b.png'],            // a path's `+` is a plus, not a space
  ['/og/a%2Bb.png', '/og/a+b.png'],
  ['/og/100%25.png', '/og/100%.png'],          // decoded ONCE: a literal percent sign stays one
  ['/og/about.png', '/og/about.png'],
  ['https://example.test/og/guide/deep/setup.png', '/og/guide/deep/setup.png'],
  ['/og/index.png', '/og/index.png'],
];
test('a card URL names the file a host serves for it', () => {
  for (const [img, file] of PLACED) {
    assert.equal(og.cardFile(img), file, img);
    assert.equal(og.cardFile(img).slice(1), served(img), `${img}: the same file a host would look up`);
  }
});

test('an ASCII card URL names exactly the file it always did', () => {
  for (const img of ['/og/about.png', '/og/index.png', 'https://example.test/og/guide/deep/setup.png', '/og/a+b.png', '/og/x-y_z.png']) {
    assert.equal(og.cardFile(img), og.ourCardPath(img), img);
  }
});

test('the name is decoded byte for byte, never normalised', () => {
  // é as one code point (NFC) and as e + combining acute (NFD) are two different file names on a
  // case- and normalisation-preserving disk; a host asked for one does not serve the other.
  const nfc = og.cardFile('/og/caf%C3%A9.png');
  const nfd = og.cardFile('/og/cafe%CC%81.png');
  assert.deepEqual(Buffer.from(nfc), Buffer.from('/og/café.png'));
  assert.deepEqual(Buffer.from(nfd), Buffer.from('/og/café.png'));
  assert.notEqual(nfc, nfd);
  assert.equal(og.cardFile('/og/Notes/A.png'), '/og/Notes/A.png', 'letter case is kept');
});

test('a malformed escape names no file, and does not throw', () => {
  for (const img of ['/og/notes/%E7%.png', '/og/%zz.png', '/og/%E7%AD.png', '/og/%FF.png', '/og/%.png', '/og/%2.png']) {
    assert.equal(og.cardFile(img), '', img);
  }
});

test('a name that decodes into another directory names no file', () => {
  for (const img of [
    '/og/%2E%2E/%2E%2E/escape.png', '/og/%2e%2e/x.png', '/og/a/%2E%2E/%2E%2E/%2E%2E/etc.png',
    '/og/%2E/x.png',                  // `.` — the same directory, under a second name
    '/og/a%2Fb.png', '/og/%2Fetc%2Fpasswd.png', '/og/a%2fb.png',   // an encoded slash: a host splits on it
    '/og/a%5Cb.png', '/og/%5C..%5Cx.png',                           // backslash
    '/og/a%00.png',                                                   // NUL
    '/og//x.png',                                                     // an empty segment
    '/og/../about.png', 'https://example.test/og/../../x.png',
  ]) {
    assert.equal(og.cardFile(img), '', img);
  }
});

test('somebody else\'s image is not a card file', () => {
  for (const img of ['', '/custom/mine.jpg', 'https://example.test/og/x.svg', '/ogx/a.png']) assert.equal(og.cardFile(img), '', img);
});

// ── the gate ─────────────────────────────────────────────────────────────────────────────────────
test('the gate looks for the decoded file', () => {
  const page = { img: 'https://example.test/og/notes/%E7%AD%86%E8%A8%98.png' };
  const onDisk = (names) => (rel) => names.includes(rel);
  assert.deepEqual(og.deadCards([page], onDisk(['/og/notes/筆記.png'])), [], 'present under the name a host serves');
  assert.deepEqual(og.deadCards([page], onDisk(['/og/notes/%E7%AD%86%E8%A8%98.png'])), [page],
    'a file named with the percent signs is one no request reaches');
});

test('a claim that names no file is dead, never skipped', () => {
  // Skipping it would leave a tag aimed at a 404 that nothing checks — the failure the gate is for.
  const pages = [{ img: '/og/%E7%.png' }, { img: '/og/%2E%2E/x.png' }, { img: '/custom/c.jpg' }];
  assert.deepEqual(og.deadCards(pages, () => true).map((p) => p.img), ['/og/%E7%.png', '/og/%2E%2E/x.png']);
});

// ── the build ────────────────────────────────────────────────────────────────────────────────────
const SITE = [
  { path: '', title: 'Home' },
  { path: '/about', title: 'About the workshop' },
  { path: '/notes/%E7%AD%86%E8%A8%98', title: '筆記本' },
  { path: '/notes/%E3%81%8B%E3%81%AA/%E3%83%8E%E3%83%BC%E3%83%88', title: 'かなのノート' },
  { path: '/our%20team%20+%20friends', title: 'Our team + friends' },
  { path: '/guide/deep/setup', title: 'Deep setup' },
];
const ASCII = SITE.filter((p) => !p.path.includes('%'));
const imageOf = (page) => page.img ?? `https://example.test/og${page.path === '' ? '/index' : page.path}.png`;
function html(page) {
  const image = imageOf(page);
  return '<!doctype html><html><head>'
    + `<meta property="og:title" content="${page.title} — Example Works"><meta property="og:site_name" content="Example Works">`
    + `<meta name="sitetile:og-card" content="${page.policy ?? 'strict'}">`
    + `<meta property="og:image" content="${image}"><meta name="twitter:image" content="${image}">`
    + '<meta name="twitter:card" content="summary_large_image"></head><body>a page</body></html>';
}
function writeSite(dir, pages) {
  for (const page of pages) {
    // The directory a page lives in is its decoded path, as the renderer writes it.
    const file = join(dir, decodeURIComponent(page.dir ?? page.path), 'index.html');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html(page));
  }
}
function files(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, out); else out.push(p);
  }
  return out;
}
const cardNames = (dist) => files(join(dist, 'og')).map((f) => relative(dist, f)).sort();
function build(dist, args = []) {
  const r = spawnSync(process.execPath, [BUILD_OG, dist, ...args], { encoding: 'utf8' });
  const line = /▸ og cards: [^\n]*/.exec(r.stdout)?.[0] ?? '';
  const n = (re) => Number(re.exec(line)?.[1] ?? 0);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, line,
    rendered: n(/og cards: (\d+) rendered/), unchanged: n(/(\d+) unchanged/), omitted: n(/(\d+) omitted/) };
}
const ok = (b) => { assert.equal(b.status, 0, b.stderr || b.stdout); assert.ok(b.line, `no summary line in: ${b.stdout}`); return b; };
const ogImage = (file) => /<meta property="og:image" content="([^"]*)"/.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
const withTemp = (fn) => { const root = mkdtempSync(join(tmpdir(), 'card-file-')); try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };

real('every card is written where a request for its og:image is answered from, and the tag stays a URL', () => withTemp((dist) => {
  writeSite(dist, SITE);
  const before = Object.fromEntries(files(dist).map((f) => [f, readFileSync(f)]));
  ok(build(dist));
  assert.deepEqual(cardNames(dist), SITE.map((p) => served(imageOf(p))).sort());
  assert.deepEqual(cardNames(dist).filter((n) => n.includes('%')), [], 'no file name carries an escape');
  for (const [file, bytes] of Object.entries(before)) {
    assert.ok(readFileSync(file).equals(bytes), `${relative(dist, file)}: the page itself is not rewritten`);
    assert.match(ogImage(file), /^https:\/\/example\.test\/og\/[A-Za-z0-9/%.+_-]*\.png$/, 'og:image is still percent-encoded');
  }
}));

real('an ASCII-only site is written exactly as before: every card at the path its og:image spells', () => withTemp((dist) => {
  writeSite(dist, ASCII);
  ok(build(dist));
  assert.deepEqual(cardNames(dist), ASCII.map((p) => new URL(imageOf(p)).pathname.slice(1)).sort());
}));

real('a card whose URL cannot be decoded: an optional page loses its image tags, a strict one fails the gate — neither throws', () => withTemp((root) => {
  for (const policy of ['optional', 'strict']) {
    const dist = join(root, policy);
    const broken = { path: '/broken', title: 'Broken escape', policy, img: 'https://example.test/og/%E7%.png' };
    writeSite(dist, [...ASCII, broken]);
    const b = build(dist);
    assert.doesNotMatch(b.stderr, /URIError|\n\s+at /, `${policy}: no exception escapes`);
    if (policy === 'optional') {
      ok(b);
      assert.equal(b.omitted, 1, b.line);
      assert.doesNotMatch(readFileSync(join(dist, 'broken/index.html'), 'utf8'), /og:image|twitter:image/);
    } else {
      assert.equal(b.status, 1, b.stdout);
      assert.match(b.stderr, /claim an og:image that does not exist on disk/);
      assert.match(b.stderr, /%E7%\.png/);
    }
  }
}));

real('a card URL that decodes outside og/ writes nothing anywhere', () => withTemp((root) => {
  for (const policy of ['optional', 'strict']) {
    const dist = join(root, policy, 'dist');
    const escape = { path: '/escape', title: 'Escape', policy, img: 'https://example.test/og/%2E%2E/%2E%2E/escaped.png' };
    const slash = { path: '/slash', title: 'Slash', policy, img: 'https://example.test/og/a%2Fb.png' };
    writeSite(dist, [...ASCII, escape, slash]);
    const b = build(dist);
    assert.doesNotMatch(b.stderr, /URIError|\n\s+at /, `${policy}: no exception escapes`);
    assert.equal(b.status, policy === 'optional' ? 0 : 1, b.stderr);
    assert.deepEqual(files(join(root, policy)).filter((f) => f.endsWith('.png')).map((f) => relative(dist, f)).sort(),
      ASCII.map((p) => served(imageOf(p))).sort(), `${policy}: only the ASCII pages' cards, all inside og/`);
  }
}));

// ── reuse across the change ──────────────────────────────────────────────────────────────────────
// A build from before this change left its non-ASCII cards under their encoded names. Simulated by
// building now and moving each card back to the name the earlier build gave it.
const NON_ASCII = SITE.filter((p) => p.path.includes('%'));
function previousLayout(dir) {
  for (const p of NON_ASCII) {
    const img = imageOf(p);
    const from = join(dir, served(img)), to = join(dir, new URL(img).pathname.slice(1));
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }
}

real('cards a previous build left under encoded names: drawn once at the new name, then reused (offered)', () => withTemp((root) => {
  const prev = join(root, 'prev'), next = join(root, 'next'), third = join(root, 'third');
  writeSite(prev, SITE); ok(build(prev)); previousLayout(prev);
  writeSite(next, SITE);
  const b = ok(build(next, ['--reuse', prev]));
  assert.deepEqual([b.rendered, b.unchanged], [NON_ASCII.length, SITE.length - NON_ASCII.length], b.line);
  assert.deepEqual(cardNames(next), SITE.map((p) => served(imageOf(p))).sort(), 'no encoded name is carried across');
  writeSite(third, SITE);
  const c = ok(build(third, ['--reuse', next]));
  assert.deepEqual([c.rendered, c.unchanged], [0, SITE.length], `found at the new name: ${c.line}`);
}));

real('cards a previous build left under encoded names, already in place: one copy ships, at the new name', () => withTemp((root) => {
  const prev = join(root, 'prev'), next = join(root, 'next');
  writeSite(prev, SITE); ok(build(prev)); previousLayout(prev);
  writeSite(next, SITE);
  cpSync(join(prev, 'og'), join(next, 'og'), { recursive: true });
  const b = ok(build(next));
  assert.deepEqual([b.rendered, b.unchanged], [NON_ASCII.length, SITE.length - NON_ASCII.length], b.line);
  assert.deepEqual(cardNames(next), SITE.map((p) => served(imageOf(p))).sort(), 'the encoded copy is gone');
}));

real('a file whose decoded name is a card is not taken for an old copy of another', () => withTemp((dist) => {
  // `/og/%25E7%25AD%2586%25E8%25A8%2598.png` decodes to the literal name `%E7%AD%86%E8%A8%98.png` —
  // the very name the earlier build gave the 筆記 card. Both pages are real; both cards must ship.
  const literal = { path: '/literal', dir: '/literal', title: 'Percent signs', img: 'https://example.test/og/notes/%25E7%25AD%2586%25E8%25A8%2598.png' };
  writeSite(dist, [...SITE, literal]);
  ok(build(dist));
  assert.ok(cardNames(dist).includes('og/notes/%E7%AD%86%E8%A8%98.png'), 'the literal-percent card is there');
  assert.ok(cardNames(dist).includes('og/notes/筆記.png'));
}));
