// tile#148 — a paragraph that is ONLY a YouTube link renders as a click-to-play block.
//   run: node packages/sitetile/youtube-line.test.mjs
//
// Measured on a Wix recast (2026-10-16): 54 YouTube embeds across 19 posts, dropped by the
// migration and restored as `[https://www.youtube.com/watch?v=ID](https://www.youtube.com/watch?v=ID)`
// on a line of their own — clickable, not a player. They upgrade with no content change.
//
// What must hold, and why each one is here:
//   · the address rules are cardtile's (yt.mjs) — one reading of "is this a YouTube video";
//   · the line is a player in EVERY body bodyHtml renders — a post, and a prose section, where the
//     links-only test would otherwise have made it a button (or, for a "Back to", a plain link);
//   · 🔴 nothing in the block reaches Google before the press: the poster is our /_yt/ path;
//   · a link someone labelled, a link in a sentence, two links, a channel: still links;
//   · with no script the block IS the author's link; the script swaps it for a nocookie player.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bodyHtml, proseBodyHtml, youtubeLine, youtubeLines, renderSiteToHtml, parseSite } from './site-core.js';
import { youtubeVideoOf, posterPath, VIDEO_RE } from '../cardtile/yt.mjs';
import { YOUTUBE_LINE_SCRIPT } from './youtube-line-script.js';

const HERE = dirname(fileURLToPath(import.meta.url));
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const { flowingHtml } = await import('./astro/src/lib/blog.mjs');

console.log('youtube-line');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

// ── the address → { id, start } ─────────────────────────────────────────────────────────────
// Non-uniform ids, so a parser that returned the wrong segment cannot match by accident.
const PARSE = [
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 0],
  ['http://youtube.com/watch?v=Ab_cd-EF012', 'Ab_cd-EF012', 0],
  ['https://m.youtube.com/watch?v=Zy9xW8vU7tS&feature=share', 'Zy9xW8vU7tS', 0],
  ['https://www.youtube.com/watch?feature=youtu.be&v=Q1w2E3r4T5y', 'Q1w2E3r4T5y', 0],      // v= not first
  ['https://youtu.be/K9j8H7g6F5d', 'K9j8H7g6F5d', 0],
  ['https://youtu.be/K9j8H7g6F5d?si=AbCdEfGh123', 'K9j8H7g6F5d', 0],                      // share-sheet tracking param
  ['https://www.youtube.com/shorts/s0rTsVid3oX', 's0rTsVid3oX', 0],
  ['https://www.youtube.com/embed/eMb3dV1d30X', 'eMb3dV1d30X', 0],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'dQw4w9WgXcQ', 42],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ', 42],
  ['https://youtu.be/K9j8H7g6F5d?t=1m30s', 'K9j8H7g6F5d', 90],
  ['https://youtu.be/K9j8H7g6F5d?t=1h2m3s', 'K9j8H7g6F5d', 3723],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=7', 'dQw4w9WgXcQ', 7],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=65', 'dQw4w9WgXcQ', 65],               // the old fragment form
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=soon', 'dQw4w9WgXcQ', 0],              // unreadable t= → the start
];
const NOT_A_VIDEO = [
  'https://vimeo.com/123456789',
  'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',                             // a channel, not a video
  'https://www.youtube.com/@someone',                                                     // a handle
  'https://www.youtube.com/watch?v=short',                                                // not 11 characters
  'https://www.youtube.com/watch?v=dQw4w9WgXcQx',                                         // 12
  'https://www.youtube.com/playlist?list=PL0123456789',
  'https://youtube.com.example.org/watch?v=dQw4w9WgXcQ',                                  // a host that only starts with it
  'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
  'youtube.com/watch?v=dQw4w9WgXcQ',                                                      // no scheme: a published link has one
  'javascript:alert(1)//youtu.be/dQw4w9WgXcQ',
  'ftp://youtu.be/dQw4w9WgXcQ',
];

test('the address rules: watch?v=, youtu.be/, shorts/, embed/, extra params, t=/start=/#t= → seconds', () => {
  for (const [href, id, start] of PARSE) assert.deepEqual(youtubeVideoOf(href), { id, start }, href);
});
test('anything that is not one YouTube video is null — channels, handles, wrong lengths, look-alike hosts, no scheme', () => {
  for (const href of NOT_A_VIDEO) assert.equal(youtubeVideoOf(href), null, href);
});
test('every id the parser returns is a VIDEO_RE id (the shape the poster relay accepts)', () => {
  for (const [href] of PARSE) assert.ok(VIDEO_RE.test(youtubeVideoOf(href).id), href);
});

// ── which paragraphs are a YouTube line ─────────────────────────────────────────────────────
const W = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
test('a YouTube line is the bare address, or [address](address) with the label equal to the destination', () => {
  assert.deepEqual(youtubeLine(W), { id: 'dQw4w9WgXcQ', start: 0, href: W });
  assert.deepEqual(youtubeLine(`[${W}](${W})`), { id: 'dQw4w9WgXcQ', start: 0, href: W });
  assert.deepEqual(youtubeLine('[https://youtu.be/K9j8H7g6F5d?t=90](https://youtu.be/K9j8H7g6F5d?t=90)'),
    { id: 'K9j8H7g6F5d', start: 90, href: 'https://youtu.be/K9j8H7g6F5d?t=90' });
  // A converter that backslash-escapes markdown in link text (`_` → `\_`) wrote the same label.
  assert.deepEqual(youtubeLine('[https://youtu.be/Ab\\_cd-EF012](https://youtu.be/Ab_cd-EF012)'),
    { id: 'Ab_cd-EF012', start: 0, href: 'https://youtu.be/Ab_cd-EF012' });
});
test('🔴 a link someone labelled stays a link: label ≠ address, even when both are YouTube', () => {
  for (const s of [
    `[Watch the video](${W})`,
    `[${W}](https://youtu.be/K9j8H7g6F5d)`,                   // two different videos: which one?
    `[https://youtu.be/dQw4w9WgXcQ](${W})`,                   // same video, but not the label the author linked
  ]) assert.equal(youtubeLine(s), null, s);
});
test('🔴 NEGATIVE CONTROL: a YouTube link with any other word, or a second link, is not a line', () => {
  for (const s of [
    `Watch ${W} now`, `See [${W}](${W}).`, `[${W}](${W}) [${W}](${W})`, `${W} ${W}`, `${W}\n${W}`,
    `- ${W}`, `> ${W}`, `**${W}**`, `<${W}>`,
  ]) assert.equal(youtubeLine(s), null, JSON.stringify(s));
});

// ── the block, written out by hand and derived from neither renderer ────────────────────────
const block = (id, href, start = 0) => '<figure class="st-video st-video-youtube"><a class="st-video-yt" href="' + href +
  '" target="_blank" rel="noopener" data-yt="' + id + '"' + (start ? ' data-yt-start="' + start + '"' : '') +
  ' aria-label="YouTube ' + id + '"><img class="st-video-yt-poster" src="/_yt/' + id + '.jpg" alt="" loading="lazy" decoding="async">';

test('bodyHtml: the line is figure.st-video-youtube > a(the author\'s link) > our poster — then the script', () => {
  const html = bodyHtml(`Before.\n\n[${W}](${W})\n\nAfter.`);
  assert.ok(html.startsWith('<p>Before.</p>\n' + block('dQw4w9WgXcQ', W)), html.slice(0, 400));
  assert.ok(html.includes('<script>' + YOUTUBE_LINE_SCRIPT + '</script></figure>\n<p>After.</p>'), 'the script closes the figure, then the next paragraph');
  // the bare form renders the same block
  assert.equal(bodyHtml(W), bodyHtml(`[${W}](${W})`));
  // t= → data-yt-start, and the `&` in the author's link is escaped once
  assert.ok(bodyHtml(W + '&t=1m5s').startsWith(block('dQw4w9WgXcQ', W + '&amp;t=1m5s', 65)));
});
test('🔴 nothing in the block points at Google before the press: no i.ytimg.com, no youtube iframe', () => {
  const html = bodyHtml(W);
  assert.ok(!/ytimg|<iframe/i.test(html), 'the block loads something from Google on page load');
  assert.ok(html.includes('src="' + posterPath('dQw4w9WgXcQ') + '"'), 'the poster is not our relayed path');
  // the only Google address that is ever FETCHED is in the script, and it is the nocookie one
  assert.ok(!/www\.youtube\.com\/embed/.test(YOUTUBE_LINE_SCRIPT) && /youtube-nocookie\.com\/embed\//.test(YOUTUBE_LINE_SCRIPT));
});
test('🔴 a prose section: the line is the block, not a .st-prose-btns button row and not a .st-prose-plain link', () => {
  const html = proseBodyHtml(`Intro.\n\n[${W}](${W})\n\n[Only link](/only)`);
  assert.ok(html.includes(block('dQw4w9WgXcQ', W)), html);
  assert.equal((html.match(/st-prose-btns/g) || []).length, 1, 'only the real links-only paragraph is a row');
  assert.ok(!/st-prose-plain/.test(html));
  assert.ok(!html.includes('st-prose-btn st-prose-btn-primary" href="' + W), 'the YouTube line became a button');
});
test('a post body (flowingHtml — what PostArticle renders) gets the same block, br mode too', () => {
  const body = 'Day one.\n\n' + `[${W}](${W})` + '\n\n## After\nText.';
  for (const html of [flowingHtml(body), flowingHtml(body, { br: true })]) {
    assert.ok(html.includes(block('dQw4w9WgXcQ', W)), html);
  }
});
test('🔴 NEGATIVE CONTROL in a body: inline in a sentence, labelled, in a list, in a fence — all stay what they were', () => {
  assert.equal(bodyHtml(`See ${W} today.`), `<p>See ${W} today.</p>`);
  assert.equal(bodyHtml(`[Watch](${W})`), `<p><a href="${W}" target="_blank" rel="noopener">Watch</a></p>`);
  assert.equal(proseBodyHtml(`[Watch](${W})`).includes('st-prose-btns'), true, 'a labelled link in prose is still a button row');
  for (const b of [`- [${W}](${W})`, '```\n' + W + '\n```', `> [${W}](${W})`, `Text\n${W}`]) {
    assert.ok(!bodyHtml(b).includes('st-video-youtube'), JSON.stringify(b));
  }
});
test('any section body that goes through bodyHtml gets it — a FAQ answer, through the string renderer', () => {
  const site = parseSite('---\nsitetile-page: home\ntitle: T\n---\n\n## Questions\n%% sitetile: faq %%\n### Where is the video?\nHere:\n\n' + W + '\n');
  assert.ok(renderSiteToHtml(site).includes(block('dQw4w9WgXcQ', W)));
});

// ── tile#150 L1: a whole-cell link is one link — no player (an <a>) inside it ────────────────
const cellPage = (marker, title) => '---\nsitetile-page: home\ntitle: T\n---\n\n## Cells\n' + marker + '\n'
  + '### ' + title + '\n' + W + '\n\n### Plain\n' + W + '\n';
test('🔴 a linked grid / gallery / carousel cell keeps its YouTube line as the paragraph it was; an unlinked one gets the player', () => {
  for (const marker of ['%% sitetile: grid cols=2 %%', '%% sitetile: grid cols=2 cards=image %%', '%% sitetile: gallery %%', '%% sitetile: carousel %%']) {
    const html = renderSiteToHtml(parseSite(cellPage(marker, 'Linked →/internal')));
    const linked = html.slice(html.indexOf('href="/internal"'), html.indexOf('<h3>Plain</h3>'));
    assert.ok(linked.includes('<p>' + W + '</p>') && !linked.includes('st-video-youtube'), marker + ': ' + linked.slice(0, 300));
    assert.ok(!/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/.test(linked), marker + ': an <a> inside the cell\'s <a>');
    assert.equal((html.match(/st-video-youtube/g) || []).length, 1, marker + ': the unlinked cell lost its player, or the linked one kept it');
  }
  // the overlay pattern (`→href` plus a `[Label →href]` action) is a linked cell too
  const overlay = renderSiteToHtml(parseSite(cellPage('%% sitetile: grid cols=2 %%', 'Both [Open →/open] →/internal')));
  assert.equal((overlay.match(/st-video-youtube/g) || []).length, 1);
  assert.ok(bodyHtml(W, { inLink: true }) === '<p>' + W + '</p>');
  // `[url](url)` in a linked cell renders as it always did — the author's own <a> in a <p>. That one
  // nests an <a> in the cell's <a>, as every labelled link in a linked cell always has; not new here.
  assert.equal(bodyHtml(`[${W}](${W})`, { inLink: true }), `<p><a href="${W}" target="_blank" rel="noopener">${W}</a></p>`);
});

// ── tile#150 L4 / N1 ────────────────────────────────────────────────────────────────────────
test('a 4-space-indented line keeps CommonMark\'s literal signal: not a player', () => {
  assert.ok(!bodyHtml('    ' + W).includes('st-video-youtube'));
});
test('a start past a year is not a start: 0, never `1e+23` in the markup', () => {
  assert.equal(youtubeVideoOf(W + '&t=99999999999999999999999').start, 0);
  assert.equal(youtubeVideoOf(W + '&t=31536001').start, 0);
  assert.equal(youtubeVideoOf(W + '&t=31536000').start, 31536000);
  assert.ok(!bodyHtml(W + '&t=99999999999999999999999').includes(' data-yt-start="'));
});

// ── the body's list of videos (blog featured image) ─────────────────────────────────────────
test('youtubeLines: the lines bodyHtml turns into players, in order, with their poster path', () => {
  const body = ['Intro.', `[${W}](${W})`, 'Inline https://youtu.be/K9j8H7g6F5d here.', '```', 'https://youtu.be/F3nc3dC0d3x', '```',
    'https://youtu.be/K9j8H7g6F5d?t=5', 'text\nhttps://youtu.be/Gl0u3dT0txt'].join('\n\n');
  assert.deepEqual(youtubeLines(body).map((v) => [v.id, v.start, v.poster]),
    [['dQw4w9WgXcQ', 0, '/_yt/dQw4w9WgXcQ.jpg'], ['K9j8H7g6F5d', 5, '/_yt/K9j8H7g6F5d.jpg']]);
  // …and they are exactly the ones bodyHtml rendered as blocks
  assert.deepEqual([...bodyHtml(body).matchAll(/data-yt="([^"]+)"/g)].map((m) => m[1]), ['dQw4w9WgXcQ', 'K9j8H7g6F5d']);
});
// tile#150 L2: the shapes where a second walk over raw lines disagreed with bodyHtml's paragraphs.
test('🔴 youtubeLines and the rendered post agree on the shapes a line walk got wrong — heading above, fence above, inside a comment', () => {
  const ids = (html) => [...html.matchAll(/data-yt="([^"]+)"/g)].map((m) => m[1]);
  for (const [body, want] of [
    ['### T\nhttps://youtu.be/K9j8H7g6F5d', ['K9j8H7g6F5d']],
    ['```\ncode\n```\nhttps://youtu.be/K9j8H7g6F5d', ['K9j8H7g6F5d']],
    ['<!--\n\nhttps://youtu.be/K9j8H7g6F5d\n\n-->', []],
    ['Intro.\n\n<!-- https://youtu.be/dQw4w9WgXcQ -->\n\nhttps://youtu.be/K9j8H7g6F5d', ['K9j8H7g6F5d']],
  ]) {
    const at = JSON.stringify(body);
    assert.deepEqual(youtubeLines(body).map((v) => v.id), want, at + ': youtubeLines');
    assert.deepEqual(ids(bodyHtml(body)), want, at + ': bodyHtml');
    assert.deepEqual(ids(flowingHtml(body)), want, at + ': the post page (flowingHtml)');
  }
});

// ── the script, run against a stand-in DOM ──────────────────────────────────────────────────
function runScript(times) {
  const listeners = [];
  const win = {};
  const doc = { addEventListener: (type, fn) => listeners.push([type, fn]), createElement: (tag) => ({ tag, focus() { this.focused = true; } }) };
  for (let i = 0; i < times; i++) new Function('window', 'document', YOUTUBE_LINE_SCRIPT)(win, doc);
  return listeners;
}
function link(attrs) {
  const a = { attrs, replaced: null, getAttribute: (k) => (k in attrs ? attrs[k] : null), replaceWith(el) { this.replaced = el; } };
  return a;
}
function click(listeners, a, extra = {}) {
  const e = { target: { closest: (sel) => (sel === 'a.st-video-yt[data-yt]' ? a : null) }, button: 0, defaultPrevented: false, prevented: false,
    preventDefault() { this.prevented = true; }, ...extra };
  for (const [, fn] of listeners) fn(e);
  return e;
}
test('the script: one listener per page however many blocks carry it (idempotent)', () => {
  assert.equal(runScript(3).length, 1);
});
test('the script: a press swaps the link for a youtube-nocookie player, autoplaying, at the start time', () => {
  const ls = runScript(1);
  const a = link({ 'data-yt': 'K9j8H7g6F5d', 'data-yt-start': '90' });
  const e = click(ls, a);
  assert.ok(e.prevented, 'the link was followed instead of swapped');
  assert.equal(a.replaced.tag, 'iframe');
  assert.equal(a.replaced.src, 'https://www.youtube-nocookie.com/embed/K9j8H7g6F5d?autoplay=1&start=90');
  assert.equal(a.replaced.title, 'YouTube K9j8H7g6F5d');
  assert.equal(a.replaced.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.equal(a.replaced.allowFullscreen, true);
  assert.ok(/encrypted-media/.test(a.replaced.allow) && /picture-in-picture/.test(a.replaced.allow));
  const b = link({ 'data-yt': 'dQw4w9WgXcQ' });
  click(ls, b);
  assert.equal(b.replaced.src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1');
});
test('the script: a modifier click, another button, or a bad id is left to the browser — it is a link', () => {
  const ls = runScript(1);
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    const a = link({ 'data-yt': 'K9j8H7g6F5d' });
    const e = click(ls, a, extra);
    assert.ok(!e.prevented && !a.replaced, JSON.stringify(extra));
  }
  const bad = link({ 'data-yt': '"><script>' });
  assert.ok(!click(ls, bad).prevented && !bad.replaced);
});

console.log(`  ${passed} passed`);
