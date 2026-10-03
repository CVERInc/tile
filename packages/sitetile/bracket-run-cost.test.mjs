// sitetile bracket run cost — an unclosed `![`, `[`, `](`, `![[` or `{` must cost one read of the text
// after it, not one read per opener.
//   run: node bracket-run-cost.test.mjs
//
// 🩸 Why this file exists. Every link and image on the render path was found by a regex that read
// forward from each opener to the delimiter closing it — /!\[([^\]]*)\]\(([^)\s]+)\)/g and seven
// siblings — and a form field's `{kind}` by one more. With no closer in sight, every opener read to the
// end of the text: one line of 32,000 `![` cost seconds a render, a gallery cell more. They were
// replaced by bracketMatches(), which reads each run once, and trailingBraces().
//
// The same two rulers as whitespace-run-cost.test.mjs and render-run-cost.test.mjs:
//   1. SAME ANSWER — the replaced regexes are kept below, verbatim, as the reference. Each shape is
//      compared with its regex match by match (position, text, every group), replaceMatches with
//      String#replace callback by callback, and the call sites whose old body is short enough to keep
//      here with that body.
//   2. LINEAR COST — each fixed path is timed, in CPU time, at n, 2n and 4n beside a control: the
//      same path carrying letters. From n to 4n linear work grows 4× and quadratic work 16×, so the
//      ruler is how much a path's time grows, held against its control's growth — never a number of
//      milliseconds. The sizes keep the replaced code's slowest reading to a second or two, so
//      putting a regex back is a red line, not a run that never ends.
// Each ruler is shown to fire: the controls at the bottom time a replaced regex itself, and hand the
// same-answer ruler near-miss rewrites; both must go red.

import assert from 'node:assert/strict';
import * as core from './site-core.js';

const { parseSite, renderSiteToHtml, inlineHtml, firstImage, heroParts, socialParts, deriveDescription } = core;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

const SAMPLES = Number(process.env.SITETILE_BRACKET_SAMPLES || 20000);
let seed = 141421356;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const words = (alphabet, max) => { let s = ''; for (let n = Math.floor(rnd() * max); n > 0; n--) s += pick(alphabet); return s; };

const FM = '---\nsitetile-page: home\ntitle: T\n---\n\n';
const render = (md) => renderSiteToHtml(parseSite(md));

// ── the regexes that were replaced, verbatim ────────────────────────────────────────────────────
const REF = {
  MD_IMAGE: /!\[([^\]]*)\]\(([^)\s]+)\)/g,
  WIKI_IMAGE: /!\[\[([^\]]+)\]\]/g,
  MD_LINK: /\[([^\]]+)\]\(([^)\s]+)\)/g,
  LINK_DEST: /\]\(([^)\s]+)\)/g,
  CTA_LINK: /\[([^\]]+)\]\(([^)]+)\)/g,
  TAG_LINK: new RegExp('\\[([^\\]]+)\\]\\((' + '(?:[^()\\s]|\\([^()\\s]*\\))+' + ')\\)', 'g'),
  DESC_IMAGE: /!\[[^\]]*\]\([^)]*\)/g,
  DESC_LINK: /\[([^\]]*)\]\([^)]*\)/g,
};
const RE_CTA_LINK = REF.CTA_LINK;
function refIsImageOnly(t) {
  const stripped = t.replace(/!\[\[([^\]]+)\]\]/g, '').replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '').trim();
  return t.trim() !== '' && stripped === '';
}
function refSplitCtaBody(body) {
  const buttons = [], caption = [];
  String(body || '').split(/\n\s*\n/).forEach((para) => {
    const p = para.trim(); if (!p) return;
    const onlyLinks = p.match(RE_CTA_LINK) && p.replace(RE_CTA_LINK, '').replace(/[·,\s]+/g, '') === '';
    if (onlyLinks) { let m; RE_CTA_LINK.lastIndex = 0; while ((m = RE_CTA_LINK.exec(p))) buttons.push({ label: m[1].trim(), href: m[2].trim() }); }
    else caption.push(p);
  });
  return { buttons, caption: caption.join('\n\n') };
}
function refHeroParts(body) {
  const text = [], buttons = [], images = [];
  String(body || '').split(/\n\s*\n/).forEach((para) => {
    const p = para.trim(); if (!p) return;
    if (refIsImageOnly(p)) {
      const reMd = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
      let m;
      while ((m = reMd.exec(p))) images.push({ alt: m[1], src: m[2] });
      const reWiki = /!\[\[([^\]]+)\]\]/g;
      while ((m = reWiki.exec(p))) images.push({ alt: (m[1] || '').split('/').pop(), src: m[1] });
      return;
    }
    const onlyLinks = p.match(RE_CTA_LINK) && p.replace(RE_CTA_LINK, '').replace(/[·,\s]+/g, '') === '';
    const singleBackLink = onlyLinks && /^\[Back to /i.test(p) && (p.match(RE_CTA_LINK) || []).length === 1;
    if (onlyLinks) {
      let m; RE_CTA_LINK.lastIndex = 0;
      while ((m = RE_CTA_LINK.exec(p))) buttons.push({ label: m[1].trim(), href: m[2].trim(), primary: buttons.length === 0 && !singleBackLink, plain: singleBackLink });
    } else text.push(p);
  });
  return { text: text.join('\n\n'), buttons, image: images[0] || null, images };
}
function refFirstImage(body) {
  const text = String(body || '');
  let img = null;
  const md = /!\[([^\]]*)\]\(([^)\s]+)\)/.exec(text);
  const wk = /!\[\[([^\]]+)\]\]/.exec(text);
  let matchStr = null;
  if (md && (!wk || md.index <= wk.index)) { img = { alt: md[1], src: md[2] }; matchStr = md[0]; }
  else if (wk) { const inner = wk[1]; img = { alt: inner.split('/').pop(), src: inner }; matchStr = wk[0]; }
  if (!matchStr) return { img: null, rest: text };
  return { img, rest: text.replace(matchStr, '').trim() };
}
// deriveDescription's two link/image steps, on text the fenced-code step has already seen.
const refDescribe = (t) => t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
// A form field label → [label, brace content], as the parse read it.
function refBraces(label) {
  const km = /\{([^}]*)\}\s*$/.exec(label);
  return km ? [label.replace(/\s*\{[^}]*\}\s*$/, '').trim(), km[1]] : [label, null];
}

// ── inputs: link-shaped text, uneven on purpose ─────────────────────────────────────────────────
// Everything that can open, close or interrupt a run, plus what must pass through one untouched:
// escapes, entities, code ticks, comment markers, CJK, a surrogate pair and a lone surrogate, the
// placeholder character the destination stash uses, and `\s` both inside and outside ASCII next to
// look-alikes `\s` does not match (U+200B, U+0085, U+180E).
const STRUCT = ['![', '[', ']', '(', ')', '](', '![[', ']]', '!', '[[', ')(', '] (', '{', '}'];
const TEXT = ['a', 'x y', 'Back to ', '/i.jpg', 'https://e.com/a_b_c', 'javascript:alert(1)', 'data:image/png;base64,AA',
  'clip.mp4', '#top', '中文', '漢字テキスト', '😀', '\ud83d', '&amp;', '&#58;', '<br>', '<!--', '-->', '`', '*', '_', '\\', '\\[',
  '\\]', '\\(', '·', ',', '\u0001', '0', '\u00010\u0001', 'textarea required', 'required: false'];
const SPACE = [' ', '\t', '\n', '\n\n', '\r', '\u3000', '\u00a0', '\u2028', '\ufeff', '\u2003', '\v', '\f', '\u200b', '\u0085', '\u180e'];
const ALL = [...STRUCT, ...TEXT, ...SPACE];
function dest() {
  return pick(['', 'x', '/i.jpg', 'a(b)', 'a(b', 'a)b', '((x))', 'a b', '(', 'https://e.com/(x)y', words(TEXT, 3)]);
}
function construct(depth) {
  const open = pick(['![', '![', '[', '[', '![[', '', '!', '[[', '\\[']);
  const label = depth < 2 && rnd() < 0.2 ? construct(depth + 1) : words([...TEXT, ...SPACE, ']', '[', '(', ')'], 4);
  const mid = open === '![[' && rnd() < 0.6 ? ']]' : pick(['](', '](', '](', '](', ']', ']]', '] (', '', ')(', '](\n']);
  const close = mid === ']]' ? pick(['', ' ', ']', ')']) : pick([')', ')', ')', ')', '', ' )', '))', ']]', ') x']);
  return open + label + mid + dest() + close;
}
function sample() {
  const r = rnd();
  if (r < 0.01) return '';
  if (r < 0.03) return pick(STRUCT);                                     // only an opener, only a closer
  if (r < 0.08) return pick(['', 'x']) + pick(['![', '[', '](', '![[', '![a](', '[a](', '{']).repeat(1 + Math.floor(rnd() * 200)) +
    pick(['', ']', ')', '](e)', ']]', '}', ' ']);                       // many openers, then maybe a closer
  if (r < 0.16) {                                                       // a row of images: a figure, or nearly one
    let s = '';
    for (let n = 1 + Math.floor(rnd() * 4); n > 0; n--) {
      s += pick(['', ' ', '\n', '\t', '\u3000']) + (rnd() < 0.4
        ? '![[' + pick(['p/q.png', 'a b', '中.png', '', 'x]']) + ']]'
        : '![' + words(TEXT, 2) + '](' + pick(['/i.jpg', 'clip.mp4', 'x', 'a(b)', 'a b', '']) + ')');
    }
    return s + pick(['', '', ' ', '\n', 'x']);
  }
  if (r < 0.24) {                                                       // a row of links: buttons, or nearly
    let s = rnd() < 0.2 ? '[Back to ' + pick(['', 'x', ']']) : '';
    for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) {
      s += pick(['', ' ', ' · ', ', ', '\n', '·']) + '[' + pick(['Go', 'x y', '中文', words(TEXT, 2)]) + pick(['](', '](', '](', ']']) +
        pick(['/a', 'https://e.com/x', 'mailto:a@b', 'a b', dest()]) + pick([')', ')', ')', ' )', '']);
    }
    return s + pick(['', '', ' ', '\n', 'x', ' ·']);
  }
  if (r < 0.7) { let s = ''; for (let n = 1 + Math.floor(rnd() * 4); n > 0; n--) s += pick(['', ' ', '\n', '\n\n', ' · ', 'x ']) + construct(0); return s; }
  return words(ALL, rnd() < 0.9 ? 24 : 300);
}
const braceLabel = (s) => s.replace(/[\n\r\u2028\u2029]/g, ' ').slice(0, 12) + pick(['', ' ', '{', '}', '{x']) + pick([' {', '{', '{{', '']) +
  pick(['', 'email', 'textarea required', 'a{b', 'x}y', ' ', '{']) + pick(['}', '}', '} ', '}\t', '}}', '} x', '']) + pick(['', ' ', '\u3000']);

// ── ruler 1: same answer ───────────────────────────────────────────────────────────────────────
const refAll = (re, s) => { const out = []; re.lastIndex = 0; let m; while ((m = re.exec(s))) out.push(m); return out; };
const shapeAgrees = (shape, re, s) => {
  const want = refAll(re, s), got = core.bracketMatches(s, shape);
  if (want.length !== got.length) return false;
  return want.every((m, i) => m.index === got[i].index && m.every((g, k) => g === got[i][k]));
};
const corpus = Array.from({ length: SAMPLES }, sample);

test('each shape finds exactly the matches of the regex it replaced', () => {
  assert.equal(typeof core.bracketMatches, 'function', 'site-core.js exports bracketMatches');
  assert.deepEqual(Object.keys(core.BRACKET_SHAPES).sort(), Object.keys(REF).sort());
  for (const [name, re] of Object.entries(REF)) {
    let yes = 0;
    for (const s of corpus) {
      assert.ok(shapeAgrees(core.BRACKET_SHAPES[name], re, s), name + ' on ' + JSON.stringify(s));
      if (refAll(re, s).length) yes++;
    }
    // 🔴 A differential test over inputs that never match proves nothing. Both verdicts must be common.
    assert.ok(yes > SAMPLES / 10 && yes < SAMPLES * 0.9, name + ': both verdicts are common (' + yes + ' of ' + SAMPLES + ' match)');
  }
});

test('replaceMatches calls back and splices exactly as String#replace did', () => {
  assert.equal(typeof core.replaceMatches, 'function', 'site-core.js exports replaceMatches');
  for (const [name, re] of Object.entries(REF)) {
    const groups = new RegExp(re.source + '|').exec('').length - 1;
    for (let i = 0; i < corpus.length; i += 4) {
      const s = corpus[i];
      const record = (log) => (...a) => { log.push(JSON.stringify([a[0], a[a.length - 2], a[a.length - 1] === s, a.slice(1, 1 + groups)])); return '<' + log.length + '>'; };
      const want = [], got = [];
      assert.equal(core.replaceMatches(s, core.BRACKET_SHAPES[name], record(got)), s.replace(re, record(want)), name + ' on ' + JSON.stringify(s));
      assert.deepEqual(got, want, name + ' callbacks on ' + JSON.stringify(s));
    }
  }
});

test('hero, cta, gallery image and description read a body exactly as before', () => {
  const seen = { images: 0, buttons: 0, text: 0, first: 0 };
  for (const s of corpus) {
    const want = refHeroParts(s);
    assert.deepEqual(heroParts(s), want, 'heroParts ' + JSON.stringify(s));
    assert.deepEqual(socialParts(s), (({ buttons, caption }) => ({ caption, links: buttons.map((b, i) => ({ ...b, primary: i === 0 })) }))(refSplitCtaBody(s)), 'cta ' + JSON.stringify(s));
    const fi = refFirstImage(s);
    assert.deepEqual(firstImage(s), fi, 'firstImage ' + JSON.stringify(s));
    const desc = refDescribe(s).replace(/[*_`>#|]/g, ' ').replace(/\s+/g, ' ').replace(/\s+([,.;:!?)\]}，。；：！？」』）】])/g, '$1').trim();
    if (!/```/.test(s)) assert.equal(deriveDescription([{ type: 'prose', body: s }], 1e6), desc, 'description ' + JSON.stringify(s));
    if (want.images.length) seen.images++;
    if (want.buttons.length) seen.buttons++;
    if (want.text) seen.text++;
    if (fi.img) seen.first++;
  }
  for (const [k, v] of Object.entries(seen)) assert.ok(v > SAMPLES / 50, 'the samples exercise "' + k + '" (' + v + ')');
});

test("a form field's {kind} is split off exactly as the regexes it replaced did", () => {
  let yes = 0;
  for (let i = 0; i < corpus.length; i += 2) {
    const raw = braceLabel(corpus[i]);
    const label = raw.trim();
    const [wantLabel, content] = refBraces(label);
    const field = parseSite(FM + '## F\n%% sitetile: form %%\n### ' + raw + '\n').sections[0].fields[0];
    if (!/\S/.test(raw)) continue;   // `### ` alone is not a field
    assert.equal(field.label, wantLabel, JSON.stringify(raw));
    if (content !== null) {
      yes++;
      // the kind and `required` are read from the content by code this change did not touch
      const kind = content.replace(/required\s*:\s*(true|false)/i, '').replace(/(^|[\s,])required($|[\s,])/i, '$1$2').replace(/[\s,]+/g, ' ').trim().toLowerCase();
      assert.equal(field.kind, kind || 'text', JSON.stringify(raw));
    } else assert.equal(field.kind, 'text', JSON.stringify(raw));
  }
  assert.ok(yes > SAMPLES / 10 && yes < SAMPLES * 0.45, 'both verdicts are common (' + yes + ' labels carry a {kind})');
});

// ── ruler 2: linear cost ───────────────────────────────────────────────────────────────────────
// CPU milliseconds this process has used, not the wall clock. On a busy machine a process waits its
// turn, and a wall-clock reading counts the wait: beside other work, the linear paths below read up
// to 15× from n to 4n on the wall clock, and at most 4.5× on CPU time.
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
// How much a path's time grows from n to 4n, and its control's: the best reading per size over two
// rounds, and up to two more while the path is over its limit. Load only ever slows a reading down,
// so more rounds can only bring a linear path back under; a quadratic one stays over however many.
const show = (a) => a.map((v) => v.toFixed(3)).join(' / ');
function growth(run, unit, wrap, n) {
  const sizes = [n, 2 * n, 4 * n];
  const subject = sizes.map((k) => wrap(unit.repeat(k)));
  const control = sizes.map((k) => wrap('x'.repeat(unit.length * k)));
  const s = [Infinity, Infinity, Infinity], c = [Infinity, Infinity, Infinity];
  let grew = Infinity, controlGrew = 1, rounds = 0;
  while (rounds < 2 || (rounds < 4 && grew > limitFor(controlGrew))) {
    for (let i = 0; i < 3; i++) {
      c[i] = Math.min(c[i], perCall(() => run(control[i])));
      s[i] = Math.min(s[i], perCall(() => run(subject[i])));
    }
    rounds++;
    grew = s[2] / s[0]; controlGrew = c[2] / c[0];
  }
  const said = 'grew ' + grew.toFixed(1) + '× from n to 4n, its control ' + controlGrew.toFixed(1) + '×, limit ' + limitFor(controlGrew).toFixed(1) +
    '× after ' + rounds + ' rounds (CPU ms per call at n / 2n / 4n: ' + show(s) + ', control ' + show(c) + ')';
  if (process.env.SITETILE_BRACKET_VERBOSE) console.log('    ' + said);
  return { grew, controlGrew, said };
}
// From n to 4n linear work grows 4× and quadratic work 16×. A path may grow 8× — the geometric middle —
// or twice what its control grew, whichever is more: a machine busy enough to bend a linear control
// past 4× bends the limit with it, and never below 8.
const limitFor = (controlGrew) => Math.max(8, 2 * controlGrew);
const PATHS = [
  // [name, n, repeated unit, (run of units) → input, what consumes it]
  ['`](` in a line', 4000, '](', (f) => f, inlineHtml],
  ['`![[` in a line', 2000, '![[', (f) => f, inlineHtml],
  ['`![` in a line', 4000, '![', (f) => f, inlineHtml],
  ['`[` in a line', 8000, '[', (f) => f, inlineHtml],
  ['`![a](` in a line', 1500, '![a](', (f) => f, inlineHtml],
  ['`[a](` in a line', 2000, '[a](', (f) => f, inlineHtml],
  ['`![` in a prose paragraph', 4000, '![', (f) => FM + '## T\n\n' + f + '\n', render],
  ['`![[` in a prose paragraph', 2000, '![[', (f) => FM + '## T\n\n' + f + '\n', render],
  ['`![` in a gallery cell', 3000, '![', (f) => FM + '## G\n%% sitetile: gallery %%\n### A\n' + f + '\n', render],
  ['`![[` in a gallery cell', 2000, '![[', (f) => FM + '## G\n%% sitetile: gallery %%\n### A\n' + f + '\n', render],
  // A hero reads its body with heroParts only when it has a `layout=`; without one it is bodyHtml, above.
  ['`[` in a split hero', 6000, '[', (f) => FM + '## H\n%% sitetile: hero layout=split %%\n' + f + '\n', render],
  ['`![[` inside a split hero\'s image', 2000, '![[', (f) => FM + '## H\n%% sitetile: hero layout=split %%\n![' + f + '](e)\n', render],
  ['`[` in a cta', 6000, '[', (f) => FM + '## C\n%% sitetile: cta %%\n' + f + '\n', render],
  ['`[a](` in a cta', 2000, '[a](', (f) => FM + '## C\n%% sitetile: cta %%\n' + f + '\n', render],
  ['`[` in a tagcloud', 8000, '[', (f) => FM + '## T\n%% sitetile: tagcloud %%\n' + f + '\n', render],
  ['`![` in a description', 4000, '![', (f) => f, (b) => deriveDescription([{ type: 'prose', body: b }])],
  ['`[a](` in a description', 3000, '[a](', (f) => f, (b) => deriveDescription([{ type: 'prose', body: b }])],
  ['`{` in a form field label', 8000, '{', (f) => FM + '## F\n%% sitetile: form %%\n### Name ' + f + '}x\n', parseSite],
];
for (const [name, n, unit, wrap, run] of PATHS) {
  test(name + ' grows like the same path carrying letters (n = ' + n.toLocaleString('en-US') + ')', () => {
    const { grew, controlGrew, said } = growth(run, unit, wrap, n);
    assert.ok(grew <= limitFor(controlGrew), said);
  });
}

// ── controls: both rulers fire ─────────────────────────────────────────────────────────────────
test('control: the cost ruler goes red on the regex it was written for', () => {
  // The replaced image regex itself, at a quarter of the size the paths use: still quadratic.
  const { grew, controlGrew, said } = growth((t) => t.replace(REF.MD_IMAGE, ''), '![', (f) => f, 1000);
  assert.ok(grew > limitFor(controlGrew), 'the replaced regex ' + said);
});
test('control: the same-answer ruler goes red on a near-miss rewrite', () => {
  const { MD_IMAGE, TAG_LINK, LINK_DEST } = core.BRACKET_SHAPES;
  const nonEmptyAlt = [MD_IMAGE[0], { ...MD_IMAGE[1], min: 1 }, ...MD_IMAGE.slice(2)];
  const oneEnd = [...TAG_LINK.slice(0, 3), { ...TAG_LINK[3], oneClass: true }, TAG_LINK[4]];
  const asciiSpace = [LINK_DEST[0], { ...LINK_DEST[1], end: (s, from) => { const m = /[) \t\n\r]/g; m.lastIndex = from; return m.exec(s) ? m.lastIndex - 1 : s.length; } }, LINK_DEST[2]];
  const nonEmptyBraces = (l) => { const m = /\{([^}]+)\}\s*$/.exec(l); return m ? m[1] : null; };
  let alt = 0, tag = 0, space = 0, braces = 0;
  for (const s of corpus) {
    if (!shapeAgrees(nonEmptyAlt, REF.MD_IMAGE, s)) alt++;
    if (!shapeAgrees(oneEnd, REF.TAG_LINK, s)) tag++;
    if (!shapeAgrees(asciiSpace, REF.LINK_DEST, s)) space++;
    const l = braceLabel(s).trim();
    if (nonEmptyBraces(l) !== refBraces(l)[1]) braces++;
  }
  assert.ok(alt && tag && space && braces, 'each near-miss is caught (' + [alt, tag, space, braces] + ')');
});

console.log('\nsitetile bracket run cost: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
