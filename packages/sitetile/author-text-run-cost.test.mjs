// sitetile author-text run cost — text a page's author writes must cost one read on the render path,
// not one read per word or per opener, and must never make a page fail to render.
//   run: node packages/sitetile/author-text-run-cost.test.mjs
//
// 🩸 Why this file exists. The link and image parsers in site-core.js were made linear in an earlier
// change (bracket-run-cost.test.mjs). The same shape — a regex that re-reads the rest of the text from
// every candidate start — was still on the render path in the places below, each reachable from text
// any page author can type:
//   - parseParams, a section's `%% sitetile: <type> … %%` line: one `new RegExp` built per bare word,
//     each run over the whole line, and `(\w+)=` re-read every long word from each of its letters.
//     A bare word of about 33,000 letters made the built pattern too large for the engine: a
//     SyntaxError, and the whole page failed to render.
//   - footerListItem (blog.mjs), each line of the home page's popular-posts list and tag cloud, which
//     the layout reads for the footer of every page of every site: `- [` and thousands of `](` was
//     quadratic, so its cost was multiplied by the number of pages.
//   - parsePost (blog.mjs), a post's featured image and excerpt: two image regexes read to the end of
//     the body from every `![`, in every post, on every route that lists posts.
//   - parseBlurb (pagetile.mjs), a book's one-line blurb: a lazy prefix tried every `[` in turn and
//     read each one's label to its end.
//
// The same two rulers as the other *-run-cost tests:
//   1. SAME ANSWER — each replaced implementation is kept below, verbatim, as the reference, and an
//      uneven random corpus is read by both. Any difference is a failure.
//   2. LINEAR COST — each path is timed in CPU time at n and at 8n. From n to 8n linear work grows 8×
//      and quadratic work 64×. The limit is 22×, the geometric middle (√(8·64) ≈ 22.6): a linear path
//      has to be slowed 2.8× more at 8n than at n to cross it, and a quadratic one sped up 2.9× to
//      pass. The earlier files allowed max(8, 2 × the control's growth) from n to 4n, where a
//      quadratic path reads 15–21× — only about twice the limit, and a noisy control could raise the
//      limit to meet it. Here the control (the same path on text it has nothing to re-read in) is shown beside the
//      reading but does not move the limit. Sizes keep the replaced code's slowest reading near a
//      second, so putting it back is a red line, not a run that never ends.
// Each ruler is shown to fire: the controls at the bottom time a replaced implementation itself, and
// hand the same-answer ruler near-miss rewrites; both must go red.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as core from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// blog.mjs imports the model layer as `@sitetile`, an Astro alias plain node cannot resolve
// (same shim as dialogue-sides.test.mjs).
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const blog = await import('./astro/src/lib/blog.mjs');

const { parseParams } = core;
const { footerListItem, footerWidgets, parsePost } = blog;
const { parseBlurb } = await import('./astro/src/lib/pagetile.mjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + String(e && e.message ? e.message : e).slice(0, 600)); process.exitCode = 1; }
}

const SAMPLES = Number(process.env.SITETILE_AUTHOR_TEXT_SAMPLES || 20000);
let seed = 271828183;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const words = (alphabet, max) => { let s = ''; for (let n = Math.floor(rnd() * max); n > 0; n--) s += pick(alphabet); return s; };

// Characters that must pass through a run untouched: `\s` inside and outside ASCII, next to look-alikes
// `\s` does not match (U+200B, U+0085, U+180E); CJK; a surrogate pair and a lone surrogate.
const SPACE = [' ', ' ', ' ', '\t', '\n', '\r', '\u3000', '\u00a0', '\u2028', '\ufeff', '\u2003', '\v', '\f', '\u200b', '\u0085', '\u180e'];

// ── the code that was replaced, verbatim ────────────────────────────────────────────────────────
function refParseParams(raw) {
  const map = {};
  if (!raw) return map;
  const re = /(\w+)=("[^"]*"(?:→\S+)?|\S+)/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = m[1]; const val = m[2];
    if (val.charAt(0) === '"') {
      const lm = /^"([^"]*)"(?:→(\S+))?$/.exec(val);
      if (lm) map[key] = lm[2] !== undefined ? { label: lm[1], href: lm[2] } : lm[1];
      else map[key] = val;
    } else map[key] = val;
  }
  const bare = raw.replace(/"[^"]*"(?:→\S+)?/g, (q) => ' '.repeat(q.length));
  let bm; const bre = /(?:^|\s)([a-zA-Z]\w*)(?=\s|$)/g;
  while ((bm = bre.exec(bare))) {
    const w = bm[1];
    if (!(w in map) && !new RegExp('\\b' + w + '\\s*=').test(bare)) map[w] = true;
  }
  return map;
}

// footerWidgets as it was, with its list-line parser.
const refFooterListItem = (line) => {
  const m = String(line).trim().match(/^-\s*\[(.+)\]\(([^)]+)\)\s*$/);
  return m ? { label: m[1], href: m[2] } : null;
};
function refFooterWidgets(contentGlob) {
  let homeRaw = null;
  for (const [path, raw] of Object.entries(contentGlob || {})) {
    if (/(^|\/)home\.md$/.test(path)) { homeRaw = String(raw || ''); break; }
  }
  if (!homeRaw) return null;
  let sections = [];
  try { sections = core.parseSite(homeRaw).sections || []; } catch { return null; }
  const parseLine = refFooterListItem;
  const listItems = (body) => String(body || '').split('\n').map((l) => l.trim()).filter(Boolean).map(parseLine);
  const asWidget = (s) => {
    const items = listItems(s.body);
    return items.length && items.every(Boolean) ? { heading: s.title || '', items } : null;
  };
  const popular = (() => {
    const s = sections.find((x) => x.type === 'prose' && x.title && asWidget(x));
    return s ? asWidget(s) : null;
  })();
  const categories = (() => {
    const s = sections.find((x) => x.type === 'tagcloud');
    return s ? asWidget(s) : null;
  })();
  return (popular || categories) ? { popular, categories } : null;
}

// parsePost's featured image and excerpt, as they were.
const refFeatured = (b) => [...b.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]).find((s) => !/\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i.test(s));
const refExcerptText = (b) => b.replace(/!\[[^\]]*\]\([^)]*\)/g, '').split('\n')
  .map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.startsWith('[') && !s.startsWith('>'))
  .join(' ');

// parseBlurb, as it was.
function refParseBlurb(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const m = /^([\s\S]*?)\[([^\]]+)\]\(([^)\s]+)\)([\s\S]*)$/.exec(text);
  if (!m) return { before: text, link: null, after: '' };
  const href = m[3];
  const safe = /^(https?:\/\/|\/|#)/i.test(href);
  if (!safe) return { before: text, link: null, after: '' };
  return { before: m[1], link: { label: m[2], href }, after: m[4] };
}

// ── inputs ──────────────────────────────────────────────────────────────────────────────────────
// A param line: keys, values, quoted labels with and without `→href`, bare flags, and everything that
// can break a word or a value. The prototype's own names are here because the map is a plain object:
// `x in map` is true for `constructor` before anyone sets it, and `__proto__=` writes the prototype.
const PARAM_WORD = ['cols', 'wide', 'ordered', 'layout', 'a', 'A1', '_x', 'x_y', '9', '9a', 'w0', 'cta', 'button',
  'constructor', 'toString', '__proto__', 'hasOwnProperty', '中文', 'é', 'wide2', 'Wide'];
const PARAM_TOKEN = [...PARAM_WORD, '=', '=', '=', '"', '"', '→', '-', ',', '.', '/x', '#y', 'https://e.com/a?b=c', '"Go wide now"',
  '"a b"→/x', '""', '"→', '\\"', '==', '=3', '"x"y'];
function paramLine() {
  const r = rnd();
  if (r < 0.01) return '';
  if (r < 0.03) return pick(SPACE).repeat(1 + Math.floor(rnd() * 4));
  if (r < 0.06) return pick(PARAM_WORD).repeat(1 + Math.floor(rnd() * 300)) + pick(['', '=', '=1', ' ', ' = 2']);   // a long word
  if (r < 0.45) {                                                       // what a section line looks like
    let s = pick(['', ' ', 'layout=split ']);
    for (let n = Math.floor(rnd() * 6); n > 0; n--) {
      const k = pick(PARAM_WORD);
      s += pick([
        () => k + '=' + pick(['3', 'split', 'a=b', '"' + words(['x', ' ', 'wide', '中', '=', 'a b'], 4) + '"', '"Go"→/a', '"x"→', '']),
        () => k + pick(['', ' ', '  ', '\t']) + '=' + pick([' 1', '1']),
        () => k,
      ])() + pick([' ', ' ', '  ', '\t', '\u3000', '\u00a0', '', ',']);
    }
    return s;
  }
  return words([...PARAM_TOKEN, ...SPACE], rnd() < 0.9 ? 16 : 120);
}
// A list line: an item, nearly one, or none — brackets inside the title, a `)` inside the href, line
// terminators the label's `.` stops at, and the runs that used to cost the most.
const LINK_BITS = ['[', ']', '(', ')', '](', '] (', '-', '- ', '-\t', '- [', '\\', '\\]', '*', '#', 'a', 'x y', '中文', '😀', '\ud83d',
  '[Series] ', '/a', 'https://e.com/(x)y', '?q=1', '&amp;'];
function listLine() {
  const r = rnd();
  if (r < 0.01) return '';
  if (r < 0.04) return pick(['', '- [', '-[']) + pick(['](', '[', ')', '](x', ']()']).repeat(1 + Math.floor(rnd() * 200)) + pick(['', ')', 'x)', ' )']);
  if (r < 0.7) {
    const label = words([...LINK_BITS, ...SPACE], 5) + pick(['', 'Title', '[x] y', 'a](b', '中文']);
    const href = pick(['/a', '/p/1', 'https://e.com/x', '', 'a b', 'a)b', 'x(y', '#t', words([...LINK_BITS, ...SPACE], 3)]);
    return pick(['', ' ', '\t', '\u3000']) + pick(['- ', '-', '-  ', '- \t', '* ', '', '-\u00a0']) + pick(['[', '[', '[', '', ' [']) + label +
      pick(['](', '](', '](', ']', '] (', '](\n', ')(']) + href + pick([')', ')', ')', '', ' )', '))', ') x', ')\u3000', ')\r']);
  }
  return words([...LINK_BITS, ...SPACE], rnd() < 0.9 ? 16 : 120);
}
// A post body: images, nearly images, videos that must be passed over, and prose the excerpt keeps.
const IMG_BITS = ['![', '![', '[', ']', '(', ')', '](', '![[', ']]', '!', ' ', '\n', '\n\n', '# ', '> ', '- ', 'a', 'Text 中文', '😀', '\\',
  '/i.jpg', 'clip.mp4', 'clip.webm?x=1', 'v.MOV#t', 'x.mp4.jpg', 'data:image/png;base64,AA', 'data:image/svg+xml,<svg>', 'javascript:alert(1)', 'a b'];
function postBody() {
  const r = rnd();
  if (r < 0.01) return '';
  if (r < 0.04) return pick(['', 'x ']) + pick(['![', '![a](', '](', '![](', '![[']).repeat(1 + Math.floor(rnd() * 200)) + pick(['', ')', ']', ' ', '\n']);
  if (r < 0.75) {
    let out = '';
    for (let n = 1 + Math.floor(rnd() * 5); n > 0; n--) {
      out += pick(['', ' ', '\n', '\n\n', 'Some words ', '# H\n', '> q\n', '[a](/b) ']) + pick(['![', '![', '!', '[', '']) + words([...IMG_BITS, ...SPACE], 3) +
        pick(['](', '](', ']', '] (', '](\n']) + pick(['/i.jpg', 'clip.mp4', 'v.webm', '', 'a b', 'x(y', 'https://e.com/p.png?mp4', 'data:image/png;base64,AA', words(IMG_BITS, 2)]) +
        pick([')', ')', '', ' )', ')x', '\n']);
    }
    return out;
  }
  return words([...IMG_BITS, ...SPACE], rnd() < 0.9 ? 24 : 200);
}
// A map's own entries and, when `__proto__=` replaced it, its prototype's: deepEqual alone would
// compare the two prototypes by identity.
const snapshot = (m) => {
  const proto = Object.getPrototypeOf(m);
  return JSON.stringify([Object.entries(m), proto === Object.prototype ? 'Object.prototype' : proto && Object.entries(proto), Object.keys(m).map((k) => typeof m[k])]);
};

// ── ruler 1: same answer ───────────────────────────────────────────────────────────────────────
const params = Array.from({ length: SAMPLES }, paramLine);

test('parseParams reads a param line exactly as before', () => {
  let flags = 0, keys = 0;
  for (const raw of params) {
    assert.equal(snapshot(parseParams(raw)), snapshot(refParseParams(raw)), JSON.stringify(raw));
    const want = refParseParams(raw);
    if (Object.values(want).includes(true)) flags++;
    if (Object.values(want).some((v) => v !== true)) keys++;
  }
  // 🔴 A differential test over inputs that never take a branch proves nothing about it.
  assert.ok(flags > SAMPLES / 10 && keys > SAMPLES / 10, 'the samples carry both flags (' + flags + ') and keys (' + keys + ')');
});

test('a bare word too long to fit in a pattern is a flag, and the page still renders', () => {
  for (const n of [33000, 40000, 100000]) {
    const w = 'w'.repeat(n);
    assert.deepEqual({ ...parseParams('layout=split ' + w + ' wide') }, { layout: 'split', [w]: true, wide: true }, n + ' letters');
    assert.deepEqual({ ...parseParams(w + '=3 ' + w) }, { [w]: '3' }, n + ' letters, also a key');
  }
  // the same reading as a short word, so length is the only thing that changed
  assert.deepEqual({ ...parseParams('layout=split www wide') }, { layout: 'split', www: true, wide: true });
  const md = '---\nsitetile-page: home\ntitle: T\n---\n\n## G\n%% sitetile: grid cols=2 ' + 'w'.repeat(40000) + ' %%\n### A\nx\n';
  const html = core.renderSiteToHtml(core.parseSite(md));
  assert.ok(/<section/.test(html), 'renderSiteToHtml returned a page');
});

const lines = Array.from({ length: SAMPLES }, listLine);
test("footerWidgets reads each list line exactly as before", () => {
  let items = 0;
  for (const l of lines) {
    const want = refFooterListItem(l);
    assert.deepEqual(footerListItem(l), want, JSON.stringify(l));
    if (want) items++;
  }
  assert.ok(items > SAMPLES / 10 && items < SAMPLES * 0.9, 'both verdicts are common (' + items + ' of ' + SAMPLES + ' lines are items)');
  // and through the home page it is read from, against footerWidgets as it was
  for (let i = 0; i < lines.length; i += 10) {
    const glob = { 'src/content/home.md': '---\nsitetile-page: home\ntitle: T\n---\n\n## Popular\n\n' + lines[i] + '\n' + lines[i + 1] +
      '\n\n## Tags\n%% sitetile: tagcloud %%\n' + lines[i + 2] + '\n' };
    assert.deepEqual(footerWidgets(glob), refFooterWidgets(glob), JSON.stringify(glob));
  }
});

const blurbs = Array.from({ length: SAMPLES }, () => (rnd() < 0.5 ? postBody() : listLine()).replace(/!\[/g, () => pick(['![', '[', 'Read [', ''])));
test('parseBlurb splits a blurb exactly as before', () => {
  let links = 0, refused = 0;
  for (const b of blurbs) {
    const want = refParseBlurb(b);
    assert.deepEqual(parseBlurb(b), want, JSON.stringify(b));
    if (want && want.link) links++;
    else if (want && /\[[^\]]+\]\([^)\s]+\)/.test(b)) refused++;     // a link whose href is not allowed
  }
  assert.ok(links > SAMPLES / 20 && refused > SAMPLES / 50 && links + refused < SAMPLES * 0.9, 'the samples exercise a link (' + links + '), a refused link (' + refused + ') and none');
});

const bodies = Array.from({ length: SAMPLES }, postBody);
test("parsePost finds a post's featured image and excerpt exactly as before", () => {
  let images = 0, videos = 0, text = 0;
  for (const b of bodies) {
    const raw = '---\ntitle: T\n---\n' + b;
    const body = core.splitFrontmatter(raw).body || '';
    const post = parsePost('p', raw);
    const img = refFeatured(body);
    assert.equal(post.image, core.safeSrc(img) || '', 'image of ' + JSON.stringify(b));
    assert.equal(post.excerptText, refExcerptText(body), 'excerpt of ' + JSON.stringify(b));
    if (img) images++;
    if (/!\[[^\]]*\]\([^)\s]+\.(mp4|webm|mov)/i.test(body)) videos++;
    if (post.excerptText) text++;
  }
  for (const [k, v] of Object.entries({ images, videos, text })) assert.ok(v > SAMPLES / 50 && v < SAMPLES * 0.95, 'the samples exercise "' + k + '" both ways (' + v + ')');
});

// ── ruler 2: linear cost ───────────────────────────────────────────────────────────────────────
// CPU milliseconds this process has used, not the wall clock: on a busy machine a wall-clock reading
// counts the time spent waiting for a core.
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
// CPU milliseconds per call: calls repeated until 20 ms have been spent, so a fast one is not read off
// the clock's resolution, and the best of three such readings, so a garbage collection landing in one
// of them does not count. A call slow enough to fill 100 ms alone is read once.
function perCall(fn) {
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t = cpuMs();
    let reps = 0, ms;
    do { fn(); reps++; ms = cpuMs() - t; } while (ms < 20);
    best = Math.min(best, ms / reps);
    if (ms > 100) break;
  }
  return best;
}
const LIMIT = 22;
const show = (a) => a.map((v) => v.toFixed(3)).join(' / ');
// How much a path's time grows from n to 8n: the best reading per size over two rounds, and up to three
// more while it is over the limit. Load only ever slows a reading down, so more rounds can only bring
// a linear path back under; a quadratic one stays over however many.
function growth(run, make, n, control) {
  const subject = [make(n), make(8 * n)];
  const ctl = control ? [control(n), control(8 * n)] : null;
  const s = [Infinity, Infinity], c = [Infinity, Infinity];
  let grew = Infinity, rounds = 0;
  while (rounds < 2 || (rounds < 5 && grew > LIMIT)) {
    for (let i = 0; i < 2; i++) {
      if (ctl) c[i] = Math.min(c[i], perCall(() => run(ctl[i])));
      s[i] = Math.min(s[i], perCall(() => run(subject[i])));
    }
    rounds++;
    grew = s[1] / s[0];
  }
  const said = 'grew ' + grew.toFixed(1) + '× from n to 8n (limit ' + LIMIT + '×) after ' + rounds + ' rounds; CPU ms per call at n / 8n: ' +
    show(s) + (ctl ? ', its control ' + show(c) + ' (' + (c[1] / c[0]).toFixed(1) + '×)' : '');
  if (process.env.SITETILE_AUTHOR_TEXT_VERBOSE) console.log('    ' + said);
  return { grew, said };
}

const keyedLater = (k, tail) => Array.from({ length: k }, (_, i) => 'w' + (i % 50) + tail).join(' ') + ' ' + Array.from({ length: 50 }, (_, i) => 'w' + i + ' =').join(' ');
const homeWith = (line) => ({ 'src/content/home.md': '---\nsitetile-page: home\ntitle: T\n---\n\n## Popular\n\n' + line + '\n' });
const post = (b) => parsePost('p', '---\ntitle: T\n---\n' + b);
const PATHS = [
  // [name, n, (n) → input, what consumes it, (n) → its control: the same path on text it has nothing to re-read in]
  ['parseBlurb: a blurb of `[`', 2000, (k) => '['.repeat(k), parseBlurb, (k) => 'x'.repeat(k)],
  ['parseBlurb: a blurb of `[a](`', 1000, (k) => '[a]('.repeat(k), parseBlurb, (k) => 'xxxx'.repeat(k)],
  ['parsePost: a body of `![`', 2000, (k) => '!['.repeat(k), post, (k) => 'xx'.repeat(k)],
  ['parsePost: a body of `![a](`', 1500, (k) => '![a]('.repeat(k), post, (k) => 'xxxxx'.repeat(k)],
  ['footerWidgets: a home list line of `](`', 2000, (k) => homeWith('- [' + ']('.repeat(k)), footerWidgets, (k) => homeWith('- [' + 'xx'.repeat(k))],
  ['footerListItem: `- [` and a run of `](`', 2000, (k) => '- [' + ']('.repeat(k), footerListItem, (k) => '- [' + 'xx'.repeat(k)],
  // Closed with a `)`, the replaced regex was linear too (its greedy label tries the last `](` first);
  // these two hold the reader that replaced it to the same.
  ['footerListItem: `- [` and a run of `](x`, closed', 1500, (k) => '- [' + '](x'.repeat(k) + ')', footerListItem, (k) => '- [' + 'xxx'.repeat(k) + ')'],
  ['footerWidgets: a home list line of `](x`, closed', 1500, (k) => homeWith('- [' + '](x'.repeat(k) + ')'), footerWidgets, (k) => homeWith('- [' + 'xxx'.repeat(k) + ')')],
  ['parseParams: one long bare word', 2000, (k) => 'cols=2 ' + 'w'.repeat(k), parseParams, (k) => 'cols=2 ' + 'w x'.repeat(k / 3)],
  ['parseParams: one long word with no `=`, among keys', 2000, (k) => 'cols=2 ' + 'w'.repeat(k) + '-x', parseParams, (k) => 'cols=2 ' + 'w-'.repeat(k / 2)],
  // Bare words, each written again at the end of the line as a `key =` (with the space, so it is not a
  // value): none is a flag, the map stays empty, and the replaced code built and ran a pattern for
  // every one of them, each reading the line up to that word's last appearance. Fifty names in turn,
  // so the reading is the scan rather than a set of thousands of different strings outgrowing a cache.
  ['parseParams: many bare words, each a key later on the line', 1000, (k) => keyedLater(k, ''), parseParams, (k) => keyedLater(k, '-')],
];
for (const [name, n, make, run, control] of PATHS) {
  test(name + ' grows linearly (n = ' + n.toLocaleString('en-US') + ')', () => {
    const { grew, said } = growth(run, make, n, control);
    assert.ok(grew <= LIMIT, said);
  });
}

// ── controls: both rulers fire ─────────────────────────────────────────────────────────────────
test('control: the cost ruler goes red on the code it replaced', () => {
  // The replaced parseParams itself, on the inputs above (a long word stays under the size that throws).
  const { grew, said } = growth(refParseParams, (k) => 'cols=2 ' + 'w'.repeat(k), 1500);
  assert.ok(grew > LIMIT, 'the replaced parseParams ' + said);
  const footer = growth(refFooterListItem, (k) => '- [' + ']('.repeat(k), 1500);
  assert.ok(footer.grew > LIMIT, 'the replaced list-line regex ' + footer.said);
  const image = growth(refFeatured, (k) => '!['.repeat(k), 1500);
  assert.ok(image.grew > LIMIT, 'the replaced featured-image regex ' + image.said);
  const excerpt = growth(refExcerptText, (k) => '![a]('.repeat(k), 1000);
  assert.ok(excerpt.grew > LIMIT, 'the replaced excerpt regex ' + excerpt.said);
  const blurb = growth(refParseBlurb, (k) => '['.repeat(k), 2000);
  assert.ok(blurb.grew > LIMIT, 'the replaced blurb regex ' + blurb.said);
});
test('control: the same-answer ruler goes red on a near-miss rewrite', () => {
  // A flag scan that forgets a key may have space before its `=` (`cols =2` is not a flag `cols`).
  const tight = (raw) => {
    const m = refParseParams(raw);
    const bare = raw.replace(/"[^"]*"(?:→\S+)?/g, (q) => ' '.repeat(q.length));
    for (const k of new Set([...bare.matchAll(/\b([a-zA-Z]\w*)\s+=/g)].map((x) => x[1]))) {
      if (!(k in m) && !new RegExp('\\b' + k + '=').test(bare) && new RegExp('(?:^|\\s)' + k + '(?=\\s|$)').test(bare)) m[k] = true;
    }
    return m;
  };
  let missed = 0;
  for (const raw of params) if (snapshot(tight(raw)) !== snapshot(refParseParams(raw))) missed++;
  // and one that reads flags out of the quoted labels again
  let quoted = 0;
  for (const raw of params) {
    const m = refParseParams(raw.replace(/"/g, ' '));
    if (snapshot(m) !== snapshot(refParseParams(raw))) quoted++;
  }
  // a list-line reader whose label may cross a line terminator, and one whose label is lazy
  const anyChar = (l) => { const m = String(l).trim().match(/^-\s*\[([\s\S]+)\]\(([^)]+)\)\s*$/); return m ? { label: m[1], href: m[2] } : null; };
  const lazy = (l) => { const m = String(l).trim().match(/^-\s*\[(.+?)\]\(([^)]+)\)\s*$/); return m ? { label: m[1], href: m[2] } : null; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // a featured image that does not skip videos, and an excerpt that keeps an unclosed image's alt
  let video = 0, unclosed = 0;
  for (const b of bodies) {
    if ([...b.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1])[0] !== refFeatured(b)) video++;
    if (b.replace(/!\[[^\]]*\]\([^)]*\)?/g, '') !== b.replace(/!\[[^\]]*\]\([^)]*\)/g, '')) unclosed++;
  }
  // a blurb reader that takes the LAST link rather than the first
  let last = 0;
  for (const b of blurbs) {
    const t = b.trim(), all = [...t.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)], m = all[all.length - 1];
    const got = !t ? null : !m || !/^(https?:\/\/|\/|#)/i.test(m[2]) ? { before: t, link: null, after: '' }
      : { before: t.slice(0, m.index), link: { label: m[1], href: m[2] }, after: t.slice(m.index + m[0].length) };
    if (JSON.stringify(got) !== JSON.stringify(refParseBlurb(b))) last++;
  }
  let crossed = 0, early = 0;
  for (const l of lines) {
    if (!same(anyChar(l), refFooterListItem(l))) crossed++;
    if (!same(lazy(l), refFooterListItem(l))) early++;
  }
  if (process.env.SITETILE_AUTHOR_TEXT_VERBOSE) console.log('    near-misses differ on ' + [missed, quoted, crossed, early, video, unclosed, last].join(' / ') + ' of ' + SAMPLES + ' samples');
  assert.ok(missed && quoted && crossed && early && video && unclosed && last, 'each near-miss is caught (' + [missed, quoted, crossed, early, video, unclosed, last] + ')');
});

console.log('\nsitetile author-text run cost: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
