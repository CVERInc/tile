// reef#2554 — which emitted pages are noindex, decided after the build over the files it wrote.
//   run: node packages/sitetile/noindex.test.mjs
//
// noindex-pass.mjs reads an output dir — each page's stamps (what its own source said, put in its
// head by SiteLayout), its robots metas, and the route's sitemap.xml for order and spelling — and
// the thanks manifest the build's inbox forms recorded (counted only for a form whose mark reached
// an emitted file). These tests hand it output dirs written the way the
// build writes them and read back what it wrote. The built-site half (real Astro builds, every
// review's inputs, the byte comparison) is in astro/smoke-build.mjs.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyNoindex, fileForPath } from './astro/noindex-pass.mjs';
import { noindexFlag, routeOutputFile } from './astro/src/lib/noindex.mjs';

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push([name, fn]);

const ROBOTS = '<meta name="robots" content="noindex">';
/** A page as SiteLayout writes it: the noindex stamp ('' = not said, written bare like Astro does),
 *  the sitemap stamp, and the body (forms go here). `stamp: null` = a page no [...path] view made. */
const html = ({ flag = '', sitemap = 'list', stamp = true, robots = false, body = '<p>Text.</p>', title = 'T' } = {}) =>
  `<!DOCTYPE html><html><head><title>${title}</title>`
  + (robots ? ROBOTS : '')
  + (stamp && !robots ? (flag === '' ? '<meta name="sitetile:noindex" content>' : `<meta name="sitetile:noindex" content="${flag}">`) : '')
  + (stamp ? `<meta name="sitetile:sitemap" content="${sitemap}">` : '')
  + `<meta property="og:type" content="website"></head><body>${body}</body></html>`;
/** Form.astro's inbox form: `thanks_to` rides beside `return_to` only when thanks= was accepted, and
 *  then the form recorded `{ id, thanks }` in the build's manifest and carries the id. The next
 *  site() hands the recorded entries to the pass. */
let recorded = [];
let nextId = 0;
const form = (...targets) => targets.map((t) => {
  const id = t == null ? null : `id-${++nextId}`;
  if (id) recorded.push({ id, thanks: t });
  return `<form class="st-form" action="/__reef/inbox" method="post"${id ? ` data-sitetile-thanks="${id}"` : ''}>`
    + '<input type="hidden" name="return_to" value="/c/">'
    + (t == null ? '' : `<input type="hidden" name="thanks_to" value="${t.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`)
    + '</form>';
}).join('');
const sitemapOf = (dir, files) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map(([loc, lastmod]) => `  <url>\n    <loc>https://example.com${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`).join('\n')}
</urlset>\n`;

const dirs = [];
/** Write an output dir: { 'rel/path.html': html } plus an optional route sitemap; run the pass. */
function site(files, routeSitemap) {
  const dir = mkdtempSync(join(tmpdir(), 'noindex-pass-'));
  dirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  if (routeSitemap) writeFileSync(join(dir, 'sitemap.xml'), sitemapOf(dir, routeSitemap));
  const out = applyNoindex(dir, recorded);
  recorded = [];
  const read = (rel) => readFileSync(join(dir, rel), 'utf8');
  return { dir, decided: out.noindex, untouched: out.untouched, read, bytes: (rel) => readFileSync(join(dir, rel)), sitemap: () => read('sitemap.xml'),
    listed: () => [...read('sitemap.xml').matchAll(/<loc>https:\/\/example\.com([^<]*)<\/loc>/g)].map((m) => m[1]) };
}
const which = (files) => site(files).decided;

test('own flag: noindex: true → noindex; noindex: false and not said → not', () => {
  assert.deepEqual(which({ 'on/index.html': html({ flag: 'true' }), 'off/index.html': html({ flag: 'false' }), 'plain/index.html': html() }),
    ['on/index.html']);
});

test('a form\'s thanks target is noindex by default; an explicit noindex: false wins; the form page itself is untouched', () => {
  assert.deepEqual(which({
    'contact/index.html': html({ body: form('/thanks', '/kept/?from=order#top') }),
    'thanks/index.html': html(),
    'kept/index.html': html({ flag: 'false' }),
  }), ['thanks/index.html']);
});

// codex r1 P3: the target is the page, not its query.
test('a query/fragment target with NO flag is noindex', () => {
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/plain/?x=1#top') }), 'plain/index.html': html() }), ['plain/index.html']);
});

test('only an emitted thanks_to counts: a form with none (no thanks=, or one Form.astro refused) makes no thanks page', () => {
  assert.deepEqual(which({ 'c/index.html': html({ body: form(null) }), 'thanks/index.html': html() }), []);
});

// codex r4 P2 (displaced form): a form that reached no emitted HTML is no input at all. The control
// is the same site with the form on a page that WAS emitted.
test('a thanks target counts only from a form in an emitted file — and from any emitted file, noindex or not', () => {
  assert.deepEqual(which({ 'devlog/shared/index.html': html({ title: 'Post' }), 'public/index.html': html() }), []);
  assert.deepEqual(which({ 'devlog/shared/index.html': html({ flag: 'true', body: form('/public/') }), 'public/index.html': html() }),
    ['devlog/shared/index.html', 'public/index.html']);
});

// codex r1 P2: content/thanks.fr.md is written to thanks.fr/index.html — a directory.
test('a dotted page: /thanks.fr/ and /merci.fr both land on their index.html', () => {
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/thanks.fr/', '/merci.fr') }), 'thanks.fr/index.html': html(), 'merci.fr/index.html': html() }),
    ['merci.fr/index.html', 'thanks.fr/index.html']);
});

// codex r1 P3, r4 P2 (double slash): resolved like the browser resolves it, then as a filesystem path.
test('resolved like navigation, then as a path: /./x, %-escapes, /x/index.html (the file), and x//y is the file x/y', () => {
  const s = site({
    'c/index.html': html({ body: form('/./dot-thanks', '/%74ilde', '/idx/index.html', '/x//y/') }),
    ...Object.fromEntries(['dot-thanks', 'tilde', 'idx', 'x/y'].map((n) => [`${n}/index.html`, html()])),
  });
  assert.deepEqual(s.decided, ['dot-thanks/index.html', 'idx/index.html', 'tilde/index.html', 'x/y/index.html']);
  assert.equal(fileForPath(s.dir, '/x//y/'), 'x/y/index.html');
  assert.equal(fileForPath(s.dir, '/x/y'), 'x/y/index.html');
});

test('a thanks target naming `/` or /index.html is the home page', () => {
  assert.deepEqual(which({ 'index.html': html(), 'c/index.html': html({ body: form('/') }) }), ['index.html']);
  assert.deepEqual(which({ 'index.html': html(), 'c/index.html': html({ body: form('/index.html') }) }), ['index.html']);
});

// codex r2 P2: identity is the file — /done/index.html/ (done/index.html/index.html) and /done/
// (done/index.html) are two pages; /parent/ is not the page at parent/index.html/index.html.
test('/done/index.html/ and /done/ are two files: each target reaches only its own', () => {
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/done/index.html/') }), 'done/index.html/index.html': html(), 'done/index.html.keep/index.html': html() }),
    ['done/index.html/index.html']);
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/parent/') }), 'parent/index.html/index.html': html() }), []);
});

test('no case folding: /INDEX.HTML is not index.html; a missing target matches nothing', () => {
  assert.deepEqual(which({ 'index.html': html(), 'c/index.html': html({ body: form('/INDEX.HTML', '/missing') }) }), []);
});

// codex r2 P3: each segment decoded on its own.
test('percent-encoded reserved characters name the file: /thank%26you/ → thank&you; %2F names no file', () => {
  assert.deepEqual(which({
    'c/index.html': html({ body: form('/thank%26you/', '/a%3Db/', '/a%2Fb/', '/devlog/caf%C3%A9/') }),
    'thank&you/index.html': html(), 'a=b/index.html': html(), 'a/b/index.html': html(), 'devlog/café/index.html': html(),
  }), ['a=b/index.html', 'devlog/café/index.html', 'thank&you/index.html']);
});

test('the target is the path the form recorded, not its attribute spelling: /a&b/ is the file a&b', () => {
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/a&b/') }), 'a&b/index.html': html() }), ['a&b/index.html']);
});

test('the robots meta takes the noindex stamp\'s place; every other byte, and every other page, is as rendered minus the stamps', () => {
  const s = site({ 'on/index.html': html({ flag: 'true' }), 'plain/index.html': html() });
  const bare = (opts) => html({ ...opts, stamp: false });
  assert.equal(s.read('on/index.html'), bare({}).replace('<meta property="og:type"', ROBOTS + '<meta property="og:type"'));
  assert.equal(s.read('plain/index.html'), bare({}));
});

test('a page with no stamp (not a [...path] view) gets robots before </head> when targeted; one that already says robots is untouched', () => {
  const s = site({ 'c/index.html': html({ body: form('/language/', '/404') }), 'language/index.html': html({ stamp: false }), '404.html': html({ stamp: false, robots: true }) });
  assert.deepEqual(s.decided, ['language/index.html']);
  assert.equal(s.read('language/index.html'), html({ stamp: false }).replace('</head>', ROBOTS + '</head>'));
  assert.equal(s.read('404.html'), html({ stamp: false, robots: true }));
});

test('stamps are read from the head only: a body that quotes one decides nothing', () => {
  assert.deepEqual(which({ 'q/index.html': html({ body: '<pre><meta name="sitetile:noindex" content="true"></pre>' }) }), []);
});

test('sitemap: the route\'s order and spelling, minus noindex files, `omit` pages, and <loc>s that name no emitted file', () => {
  const s = site({
    'index.html': html(), 'about/index.html': html(), 'on/index.html': html({ flag: 'true' }),
    'devlog/page/2/index.html': html({ sitemap: 'omit' }), 'thanks.fr/index.html': html(),
  }, [['/about/'], ['/'], ['/on/'], ['/devlog/page/2/'], ['/thanks.fr'], ['/gone/']]);
  assert.deepEqual(s.listed(), ['/about/', '/', '/thanks.fr']);
});

// codex r3/r4: the page on disk is the producer — its stamp, not whichever route claimed the URL.
test('sitemap: a file is listed by its own stamp and lastmod, once, under the first <loc> that names it', () => {
  const s = site({
    'devlog/shared/index.html': html({ sitemap: 'list 2026-01-03' }),
    'devlog/hidden/index.html': html({ sitemap: 'omit' }),
    'x/y/index.html': html({ flag: 'false' }),
  }, [['/devlog/shared/'], ['/devlog/hidden/'], ['/x/y/'], ['/devlog/shared/', '2026-01-01'], ['/x//y/', '2026-01-09']]);
  assert.equal(s.sitemap(), sitemapOf(null, [['/devlog/shared/', '2026-01-03'], ['/x/y/']]));
});

test('sitemap: a page with no stamp (a term archive) is listed only when the route names it, with the route\'s lastmod', () => {
  const s = site({ 'tag/a/index.html': html({ stamp: false }), 'author/b/index.html': html({ stamp: false }) }, [['/tag/a/']]);
  assert.deepEqual(s.listed(), ['/tag/a/']);
});

test('sitemap: a listed page the route never names is appended, spelled from its file', () => {
  const s = site({ 'index.html': html(), 'caf&é/index.html': html() }, [['/']]);
  assert.deepEqual(s.listed(), ['/', '/caf%26%C3%A9/']);
});

test('sitemap: every page noindex → a valid, empty urlset in the route\'s format', () => {
  const s = site({ 'index.html': html({ flag: 'true' }) }, [['/']]);
  assert.equal(s.sitemap(), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n</urlset>\n');
});

test('no sitemap.xml in the output → none is written', () => {
  const s = site({ 'index.html': html() });
  assert.equal(existsSync(join(s.dir, 'sitemap.xml')), false);
});

// codex r5 P2 (template / third-party): a `thanks_to` spelling in markup sitetile did not emit as an
// inbox form — an embed's inert <template>, another service's form — is text, not a thanks target.
// The control is the same target named by a real inbox form.
test('a thanks_to inside a <template> or a third-party form takes no page out of search', () => {
  const inbox = '<form action="/__reef/inbox" method="post"><input type="hidden" name="thanks_to" value="/template-target/"></form>';
  assert.deepEqual(which({ 'e/index.html': html({ body: `<template>${inbox}</template>` }), 'template-target/index.html': html() }), []);
  assert.deepEqual(which({
    'e/index.html': html({ body: '<form action="https://forms.example/submit" method="post"><input type="hidden" name="thanks_to" value="/template-target/"><button>Send</button></form>' }),
    'template-target/index.html': html(),
  }), []);
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/template-target/') }), 'template-target/index.html': html() }), ['template-target/index.html']);
});

// codex r5 P2 (permissive robots): a robots meta already on a thanks target is MERGED — `noindex`
// in, a contradicting `index`/`all` out, every other directive kept, still one robots meta. The only
// opt-out is the page's own `noindex: false`.
test('an existing permissive robots meta on a thanks target is merged into noindex, never obeyed', () => {
  const pub = (content) => `<!DOCTYPE html><html><head><title>Thanks</title><meta name="robots" content="${content}"></head><body>Thank you.</body></html>`;
  const s = site({
    'c/index.html': html({ body: form('/indexable.html', '/preview.html', '/all.html', '/done.html') }),
    'indexable.html': pub('index,follow'), 'preview.html': pub('max-image-preview:large'),
    'all.html': pub('all'), 'done.html': pub('noindex, nofollow'),
  });
  assert.deepEqual(s.decided, ['all.html', 'done.html', 'indexable.html', 'preview.html']);
  assert.equal(s.read('indexable.html'), pub('follow,noindex'));
  assert.equal(s.read('preview.html'), pub('max-image-preview:large,noindex'));
  assert.equal(s.read('all.html'), pub('follow,noindex'));
  assert.equal(s.read('done.html'), pub('noindex, nofollow'));
});

test('a robots meta is found however a public/ page writes it, merged in place; never a second tag; an opted-out page keeps its own', () => {
  const s = site({
    'c/index.html': html({ body: form('/a.html', '/b.html', '/kept/') }),
    'a.html': '<html><head><META CONTENT=\'INDEX, max-snippet:-1\' NAME=Robots></head><body></body></html>',
    'b.html': '<html><head><meta name="robots"></head><body></body></html>',
    'kept/index.html': html({ flag: 'false' }).replace('</head>', '<meta name="robots" content="index"></head>'),
  });
  assert.deepEqual(s.decided, ['a.html', 'b.html']);
  assert.equal(s.read('a.html'), '<html><head><META content="max-snippet:-1,noindex" NAME=Robots></head><body></body></html>');
  assert.equal(s.read('b.html'), '<html><head><meta name="robots" content="noindex"></head><body></body></html>');
  assert.match(s.read('kept/index.html'), /<meta name="robots" content="index"><\/head>/);
  for (const f of ['a.html', 'b.html']) assert.equal((s.read(f).match(/robots/gi) || []).length, 1);
});

// codex r6 P2 ×2 (comment, uppercase): the pass read the head as a string — a robots tag inside a
// comment counted as the page's robots meta (so none was inserted), and `</HEAD>` was not
// `</head>` (so nothing was). The page is HTML: these are read with an HTML parser that is not the
// pass's own (parse5 straight from the renderer's deps, walked here), and each output must be the
// input plus exactly the robots bytes — the comment, script and template text untouched.
const require5 = createRequire(new URL('./astro/package.json', import.meta.url));
const { parse: parseHtml } = require5('parse5');
/** The `content` of every robots <meta> ELEMENT in the document (comments, script text and
 *  <template> contents are not elements of it). */
const activeRobots = (text) => {
  const out = [];
  (function walk(n) {
    if (n.tagName === 'meta' && n.attrs.some((a) => a.name === 'name' && a.value.trim().toLowerCase() === 'robots'))
      out.push(n.attrs.find((a) => a.name === 'content')?.value ?? null);
    for (const c of n.childNodes || []) walk(c);
  })(parseHtml(text));
  return out;
};
test('a robots tag in a comment, in script text or in a <template> is not a robots meta: the page still gets one', () => {
  const pages = {
    'comment.html': '<html><head><!-- <meta name="robots" content="index,follow"> --></head><body>Thanks</body></html>',
    'script.html': '<html><head><script>document.write(\'<meta name="robots" content="index">\')</script></head><body>Thanks</body></html>',
    'template.html': '<html><head><template><meta name="robots" content="index"></template></head><body>Thanks</body></html>',
  };
  const s = site({ 'c/index.html': html({ body: form(...Object.keys(pages).map((f) => '/' + f)) }), ...pages });
  assert.deepEqual(s.decided, Object.keys(pages));
  for (const [f, src] of Object.entries(pages)) {
    assert.deepEqual(activeRobots(src), [], `${f}: the input has no robots element`);
    assert.equal(s.read(f), src.replace('</head>', ROBOTS + '</head>'), `${f}: input + one robots meta before </head>`);
    assert.deepEqual(activeRobots(s.read(f)), ['noindex'], `${f}: one active robots meta`);
  }
});

test('the head is found whatever its case or however it ends: </HEAD>, <META NAME="ROBOTS">, no </head> at all', () => {
  const pages = {
    'upper.html': '<!DOCTYPE html><HTML><HEAD><TITLE>Thanks</TITLE></HEAD><BODY>Thanks</BODY></HTML>',
    'upper-meta.html': '<!DOCTYPE html><HTML><HEAD><META NAME="ROBOTS" CONTENT="INDEX"></HEAD><BODY>Thanks</BODY></HTML>',
    'open.html': '<head><title>x</title><body>Thanks',
    'implied.html': '<!DOCTYPE html><title>x</title><p>Thanks',
    // a byte-order mark, which the HTML decoder strips and parse5 (given a string) does not
    'bom.html': String.fromCharCode(0xfeff) + '<html><head><title>x</title></head><body>Thanks</body></html>',
  };
  const s = site({ 'c/index.html': html({ body: form(...Object.keys(pages).map((f) => '/' + f)) }), ...pages });
  assert.deepEqual(s.decided, Object.keys(pages).sort());
  assert.equal(s.read('upper.html'), pages['upper.html'].replace('</HEAD>', ROBOTS + '</HEAD>'));
  assert.equal(s.read('upper-meta.html'), pages['upper-meta.html'].replace('CONTENT="INDEX"', 'content="noindex"'));
  assert.equal(s.read('open.html'), '<head><title>x</title>' + ROBOTS + '<body>Thanks');
  assert.equal(s.read('implied.html'), '<!DOCTYPE html><title>x</title>' + ROBOTS + '<p>Thanks');
  assert.equal(s.read('bom.html'), pages['bom.html'].replace('</head>', ROBOTS + '</head>'));
  for (const f of Object.keys(pages)) assert.deepEqual(activeRobots(s.read(f)), ['noindex'], `${f}: one active robots meta`);
});

// codex r7 P2: the pass read every file as UTF-8 and wrote it back, so a windows-1252 public/ page
// came out with ef bf bd where each é was — in the body too. A page is bytes; the only bytes that
// may change are the robots edit in its head.
const b = (s, enc = 'latin1') => Buffer.from(s, enc);
const ROBOTS_BYTES = b(ROBOTS);
/** `src` with ROBOTS_BYTES (or `ins`) spliced in at the first `</head>` (located as `at` bytes). */
const insertedBefore = (src, at = b('</head>'), ins = ROBOTS_BYTES) => {
  const i = src.indexOf(at);
  assert.ok(i > 0, 'fixture has the anchor');
  return Buffer.concat([src.subarray(0, i), ins, src.subarray(i)]);
};
test('a page not in UTF-8 keeps every byte but the head edit: windows-1252, Shift_JIS, a 4-byte emoji, a UTF-8 BOM', () => {
  const pages = {
    // codex's input, verbatim bytes (Café / André — reçu, em dash 0x97)
    'cp1252.html': b('<!doctype html><html><head><meta charset="windows-1252"><title>Caf\xe9</title></head><body>Merci, Andr\xe9 \x97 re\xe7u.</body></html>'),
    // ありがとう・ソ表 — ソ (83 5C) and 表 (95 5C) end in an ASCII byte; all of it before </head>
    'sjis.html': Buffer.concat([b('<html><head><meta charset="shift_jis"><title>'),
      Buffer.from([0x82, 0xa0, 0x82, 0xe8, 0x82, 0xaa, 0x82, 0xc6, 0x82, 0xa4, 0x81, 0x45, 0x83, 0x5c, 0x95, 0x5c]),
      b('</title><meta name="description" content="'), Buffer.from([0x83, 0x5c, 0x95, 0x5c]), b('"></head><body>'),
      Buffer.from([0x82, 0xa0]), b('</body></html>')]),
    'emoji.html': b('<html><head><title>Thanks 🙏 ✓ ü</title></head><body>🙏</body></html>', 'utf8'),
    'bom8.html': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b('<html><head><title>Merci André</title></head><body>é</body></html>', 'utf8')]),
  };
  const s = site({ 'c/index.html': html({ body: form(...Object.keys(pages).map((f) => '/' + f)) }), ...pages });
  assert.deepEqual(s.decided, Object.keys(pages).sort());
  for (const [f, src] of Object.entries(pages)) {
    const want = insertedBefore(src);
    assert.ok(s.bytes(f).equals(want), `${f}: input bytes + one robots meta before </head>\n      got  ${s.bytes(f).toString('hex')}\n      want ${want.toString('hex')}`);
  }
  assert.deepEqual([...s.bytes('bom8.html').subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the UTF-8 BOM stays first');
});

// UTF-16 is the one family where an ASCII meta is not ASCII bytes. A browser takes it only from a BOM
// (WHATWG: a <meta charset="utf-16"> found by the ASCII prescan means UTF-8), so the BOM decides; the
// edit is made in UTF-16 (each code unit is two bytes, so a parser offset is half a byte offset).
// UTF-32 no browser decodes: left as it is, out of the sitemap, and reported.
test('a UTF-16 page (by its BOM) is edited in UTF-16; a UTF-32 page is left untouched, unlisted, and reported', () => {
  const doc = '<html><head><title>Merci André 🙏</title></head><body>reçu</body></html>';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), b(doc, 'utf16le')]);
  const be = Buffer.from(le).swap16();          // FE FF + big-endian units
  const u32 = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), ...[...doc].map((ch) => { const x = Buffer.alloc(4); x.writeUInt32LE(ch.codePointAt(0)); return x; })]);
  const s = site({ 'c/index.html': html({ body: form('/le.html', '/be.html', '/u32.html') }), 'le.html': le, 'be.html': be, 'u32.html': u32, 'index.html': html() },
    [['/'], ['/le.html'], ['/be.html'], ['/u32.html']]);
  assert.deepEqual(s.decided, ['be.html', 'le.html', 'u32.html']);
  const want = insertedBefore(le, b('</head>', 'utf16le'), b(ROBOTS, 'utf16le'));
  assert.ok(s.bytes('le.html').equals(want), `le.html: UTF-16LE input + one robots meta in UTF-16LE\n      got  ${s.bytes('le.html').toString('hex')}`);
  assert.ok(s.bytes('be.html').equals(Buffer.from(want).swap16()), `be.html: UTF-16BE input + one robots meta in UTF-16BE\n      got  ${s.bytes('be.html').toString('hex')}`);
  assert.ok(s.bytes('u32.html').equals(u32), 'u32.html: untouched');
  assert.deepEqual(s.untouched, ['u32.html']);
  assert.deepEqual(s.listed(), ['/', '/c/'], 'the three noindex pages are not listed');
});

test('the thanks mark is removed from every emitted form; a form recorded but never emitted counts for nothing', () => {
  const body = form('/t/');
  recorded.push({ id: 'never-emitted', thanks: '/u/' });
  const s = site({ 'c/index.html': html({ body }), 't/index.html': html(), 'u/index.html': html() });
  assert.deepEqual(s.decided, ['t/index.html']);
  assert.doesNotMatch(s.read('c/index.html'), /data-sitetile-thanks/);
});

test('routeOutputFile (build-log collision naming): one file per route param; x//y is the file x/y', () => {
  assert.equal(routeOutputFile(undefined), 'index.html');
  assert.equal(routeOutputFile('about'), 'about/index.html');
  assert.equal(routeOutputFile('/about/'), 'about/index.html');
  assert.equal(routeOutputFile('done/index.html'), 'done/index.html/index.html');
  assert.equal(routeOutputFile('thank&you'), 'thank&you/index.html');
  assert.equal(routeOutputFile('x//y'), 'x/y/index.html');
  assert.equal(routeOutputFile('404'), '404.html');
});

test('noindexFlag: absent/empty → undefined; false (any case, padded) → false; any other value → true', () => {
  assert.equal(noindexFlag(undefined), undefined);
  assert.equal(noindexFlag(''), undefined);
  assert.equal(noindexFlag('false'), false);
  assert.equal(noindexFlag(' FALSE '), false);
  assert.equal(noindexFlag(false), false);
  assert.equal(noindexFlag('true'), true);
  assert.equal(noindexFlag(true), true);
  assert.equal(noindexFlag('no'), true);
});

for (const [name, fn] of pending) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}
for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(`\n${process.exitCode ? '❌' : '✅'} noindex: ${passed} passed`);
