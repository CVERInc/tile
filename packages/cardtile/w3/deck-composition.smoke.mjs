// What fits on a tile — measured in a real browser, because the numbers COMPOSITION (ai-ops.mjs) gives an agent are
// about layout: how many lines a tile shows before it scrolls, how many characters a line holds, how much of a tile a
// picture covers, how many rows of links fit. The unit suite has no layout; ai-ops-composition.test.mjs holds the
// guide to the receipt this file writes (deck-composition.measured.json), and this file holds the receipt to a browser.
//
//   text     A `text` tile in the stack: the body is grown one character at a time until the tile's side scrolls
//            (scrollHeight > clientHeight); the lines are the browser's own (a Range over each character, grouped by
//            the top of its box). Body alone, under a one-line heading, under a two-line one. Characters per line: the
//            median over the full lines; for CJK, over the lines that hold nothing but CJK. Read at 360 × 640 (the
//            342 px design, zoomed down), 390 × 844 (a phone) and 1280 × 800, and in the list view.
//   advice   The limits the guide tells an agent to aim for hold: a Latin heading and a CJK one of that many characters
//            take at most two lines, a body of that many takes at most the lines it names, and the guide's own example
//            does not scroll.
//   picture  A `feature` tile that is only a picture, 16:9 and 3:4, in the stack and the list: the picture is drawn in
//            one colour inside a frame, the tile is photographed, and the pixels of that colour are counted. Whole: the
//            box of those pixels has the picture's own proportions. On the wall the same at no `w`, `w=3` and `w=6`.
//            A feature that is NOT bare is drawn by other rules, so it is measured too: with a `title` and a `cta`
//            (fitted inside its box in every view, its words over it) and with `label=on` (on the wall a square
//            below `w=6` and 2:1 at `w=6`). And an `embed`: square on the wall, as tall as the front in a pile.
//   links    A `social` tile of twelve links in the stack: rows are taken away until the side stops scrolling. Rows
//            carry a label in the stack and the list and none on the wall.
//   wall     What `w` does: the width of each type at no `w` and at `w=6`; a `text` tile is full width whatever its `w`
//            and has no frame.
//   opens    The view a page opens on: the stack with no `view:`, the named one with it; `views: stack list` leaves
//            two buttons in the switcher.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/w3/deck-composition.smoke.mjs [<base URL>]
//   … --engine chromium|webkit   (default chromium)
//   … --table                    print the measured table (Markdown)
//   … --write                    write what was measured to deck-composition.measured.json (chromium only)
//   … --shots <folder>           photograph the wall and the not-bare pictures into it, to be looked at
//
// 🔴 Lines per tile, the picture's share and rows of links follow from lengths the stylesheet fixes in px: they are
// held EXACTLY. Characters per line depend on the fonts of the machine (the stylesheet names system fonts), so they are
// held to within a fifth of the receipt, and the guide says "about" for them and only them. The fonts this machine
// drew with are printed with the table.
//
// The base URL scripts/test.sh hands every browser smoke is accepted and not used: the pages are the cardtile worker's
// own (serve/card-worker.mjs, answered in-process through page.route). Exits 1 on any failure, 2 when the browser does
// not launch.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../serve/card-worker.mjs';
import { COMPOSITION } from '../ai-ops.mjs';
import { CELL_STRINGS_BY_KEY } from '../w/cell-i18n.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] || '' : '');
const ENGINE = opt('--engine') || 'chromium';
const TABLE = args.includes('--table');
const WRITE = args.includes('--write');
const SHOTS = opt('--shots');   // a folder: the wall and the not-bare pictures are photographed into it, to be looked at
const RECEIPT = join(dirname(fileURLToPath(import.meta.url)), 'deck-composition.measured.json');

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const lib = pw.default ?? pw;

// ── the specimens: real sentences, the product's own. Every type's and param's hint, in English, Chinese and Japanese.
const hints = (loc, glue) => Object.entries(CELL_STRINGS_BY_KEY).filter(([k, v]) => /\.hint$/.test(k) && v[loc]).map(([, v]) => v[loc]).join(glue);
const EN = hints('en', ' '), ZH = hints('zh', ''), JA = hints('ja', '');
// CJK only: the Chinese hints with everything that is not a CJK character or its punctuation taken out
const CJK_RE = /[　-〿぀-ヿ㐀-鿿＀-￯]/;
const CJK = [...ZH].filter((c) => CJK_RE.test(c)).join('');
// the limits the guide tells an agent to aim for, read out of the guide's own sentence: what is measured is what it says
const AIM = /a heading within (\d+) Latin or (\d+) CJK characters, a body within (\d+) or (\d+)\./.exec(COMPOSITION.text);
if (!AIM) { console.log('💥 COMPOSITION.text no longer states its limits in the sentence this file reads'); process.exit(1); }
const ADVICE = { headLatin: +AIM[1], headCjk: +AIM[2], bodyLatin: +AIM[3], bodyCjk: +AIM[4], bodyLines: 6 };
const RED = 'ff0000';
// 🔴 Not one flat colour to its edge: the side behind a picture takes the picture's own edge colour (deck.css, "edge-colour
// mat"), so a flat picture would be counted with its mat. The picture is a dark frame, a twentieth of each side, around the
// counted colour: the counted box has the picture's proportions and FRAME of its area.
const FRAME = 0.9 * 0.9;
const pic = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#000080"/><rect x="${w / 20}" y="${h / 20}" width="${w * 0.9}" height="${h * 0.9}" fill="#${RED}"/></svg>`;
const SOCIAL = ['instagram.com/a', 'youtube.com/@a', 'x.com/a', 'facebook.com/a', 'threads.net/@a', 'tiktok.com/@a', 'github.com/a', 'linkedin.com/in/a', 'twitch.tv/a', 'pinterest.com/a', 'discord.gg/a', 'open.spotify.com/a'];
const social = (w) => `- [ ] %% card: social${w} %%\n\t${SOCIAL.map((s) => `[${s.split('.')[0]}](https://${s})`).join('\n\t')}`;
// a feature that is not a bare picture: with words of its own (`title`, `cta`), or with its `alt` shown under it (`label=on`)
const TITLED = 'title=Heading cta=Go href=https://example.org/', LABELLED = 'label=on alt=Label';
const T = {
  latin: `- [ ] %% card: text %%\n\t### ${EN.slice(0, 200)}\n\t${EN}`,
  cjk: `- [ ] %% card: text %%\n\t### ${CJK.slice(0, 80)}\n\t${CJK}`,
  ja: `- [ ] %% card: text %%\n\t### ${JA.slice(0, 80)}\n\t${JA}`,
  wide: '- [ ] %% card: feature img=http://card.test/_p/1600x900.svg %%',
  tall: '- [ ] %% card: feature img=http://card.test/_p/900x1200.svg %%',
  social: social(''),
  titled: `- [ ] %% card: feature ${TITLED} img=http://card.test/_p/1600x900.svg %%`,
  labelled: `- [ ] %% card: feature ${LABELLED} img=http://card.test/_p/1600x900.svg %%`,
  embed: '- [ ] %% card: embed %% <p>One line.</p>',
};
const PILE = ['latin', 'cjk', 'ja', 'wide', 'tall', 'social', 'titled', 'labelled', 'embed'];
const WALL = [
  '- [ ] %% card: feature img=http://card.test/_p/1600x900.svg %%', '- [ ] %% card: feature w=3 img=http://card.test/_p/1600x900.svg %%',
  '- [ ] %% card: feature w=6 img=http://card.test/_p/1600x900.svg %%', '- [ ] %% card: feature w=6 img=http://card.test/_p/900x1200.svg %%',
  '- [ ] %% card: link %% [Read the full plan](https://example.org/plan)', '- [ ] %% card: link w=6 %% [Read the full plan](https://example.org/plan)',
  social(''), social(' w=6'),
  '- [ ] %% card: profile %% One line.', '- [ ] %% card: profile w=6 %% One line.',
  '- [ ] %% card: text w=2 %%\n\t### A heading\n\tOne line of body.', '- [ ] %% card: text %%\n\t### A second heading\n\tAnother line of body.',
  // not bare (appended: the tiles above are read by position)
  ...['w=3 ', 'w=6 '].map((w) => `- [ ] %% card: feature ${w}${TITLED} img=http://card.test/_p/1600x900.svg %%`), `- [ ] %% card: feature w=6 ${TITLED} img=http://card.test/_p/900x1200.svg %%`,
  ...['w=3 ', 'w=6 '].map((w) => `- [ ] %% card: feature ${w}${LABELLED} img=http://card.test/_p/1600x900.svg %%`), `- [ ] %% card: feature w=6 ${LABELLED} img=http://card.test/_p/900x1200.svg %%`,
  '- [ ] %% card: embed w=3 %% <p>One line.</p>', '- [ ] %% card: embed w=6 %% <p>One line.</p>',
  `- [ ] %% card: feature ${TITLED} img=http://card.test/_p/1600x900.svg %%`,
];
const file = (fm, tiles) => ['---', 'card-page: m', 'title: Specimen', ...fm, '---', '', '## grid', '', ...tiles, ''].join('\n');
const FILES = {
  stack: file([], PILE.map((k) => T[k])), list: file(['view: list'], PILE.map((k) => T[k])), wall: file(['view: wall'], WALL),
  two: file(['views: stack list'], PILE.map((k) => T[k])), example: COMPOSITION.example, 'example-wall': COMPOSITION.example.replace('---\n', '---\nview: wall\n'),
};
const store = { get: async (h) => FILES[h] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } };

let browser;
try { browser = await lib[ENGINE].launch(); } catch (e) { console.log(`💥 ${ENGINE} did not launch: ${String(e && e.message || e).split('\n')[0]}`); process.exit(2); }
console.log(`deck-composition smoke — ${ENGINE} ${browser.version()}`);

const failures = [];
let passes = 0;
const check = (name, ok, detail = '') => { if (ok) passes++; else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`   🔴 ${name}${detail ? ' — ' + detail : ''}`); } return ok; };
const r1 = (x) => Math.round(x * 10) / 10;

async function open(handle, [vw, vh]) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.host !== 'card.test') return route.abort();
    const m = /^\/_p\/(\d+)x(\d+)\.svg$/.exec(u.pathname);
    if (m) return route.fulfill({ contentType: 'image/svg+xml', body: pic(+m[1], +m[2]) });
    if (/^\/_icon\//.test(u.pathname)) return route.fulfill({ contentType: 'image/svg+xml', body: pic(8, 8).replace(RED, '888888') });
    const r = await worker.fetch(new Request('http://x' + u.pathname + u.search), { CARDS: store, PREVIEW: 'true' });
    const headers = Object.fromEntries(r.headers); delete headers['content-length'];
    return route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
  });
  await page.goto('http://card.test/' + handle);
  await page.waitForFunction(() => window.__deckBoot === 'ready' || !!document.querySelector('.deck-seg button'), null, { timeout: 15000 });
  await page.waitForTimeout(1800);   // the deal is over
  await page.mouse.move(2, 2);
  await page.evaluate((cjkSrc) => {
    const CJK = new RegExp(cjkSrc);
    // the lines of an element's text as the browser broke them: each character's own box, grouped by its top
    window.__lines = (el) => { const out = []; let top = null; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), r = document.createRange();
      for (let n = w.nextNode(); n; n = w.nextNode()) for (let i = 0; i < n.data.length; i++) { r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getClientRects()[0];
        if (!b) { if (out.length) out[out.length - 1] += n.data[i]; continue; }
        if (top === null || Math.abs(b.top - top) > b.height / 2) { out.push(''); top = b.top; } out[out.length - 1] += n.data[i]; }
      return out; };
    const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : 0; };
    // characters on a full line: the median over every line but the last; `pure` keeps only lines that are all CJK
    window.__perLine = (lines, pure) => median(lines.slice(0, -1).filter((l) => !pure || [...l].every((c) => CJK.test(c))).map((l) => [...l].length));
    // the tile on top of the pile (stack), or the i-th (list): its side and the tile on it
    window.__side = (i) => { const c = document.documentElement.classList.contains('list') ? document.querySelectorAll('.deck-stack > .deck-card')[i] : document.querySelector('.deck-card.is-top'); const side = c.querySelector('.deck-front'); return { side, tile: side.querySelector(':scope > .st-cell') }; };
    window.__text = (i, pure) => { const { side, tile } = window.__side(i); const p = tile.querySelector('p'), h = tile.querySelector('h5'); const body = p.textContent, head = h.textContent; const fits = () => side.scrollHeight <= side.clientHeight;
      const grow = () => { let lo = 0, hi = body.length; while (lo < hi) { const mid = (lo + hi + 1) >> 1; p.textContent = body.slice(0, mid); if (fits()) lo = mid; else hi = mid - 1; } p.textContent = body.slice(0, lo); return window.__lines(p); };
      const out = { type: tile.dataset.coralType, k: Number(getComputedStyle(document.documentElement).getPropertyValue('--deck-k')) || 1 };
      h.style.display = 'none'; let L = grow(); out.bodyOnly = L.length; out.perBody = window.__perLine(L, pure); out.chars = [...p.textContent].length; h.style.display = '';
      for (const want of [1, 2]) { let best = 0; for (let n = 1; n <= head.length; n++) { h.textContent = head.slice(0, n); const hl = window.__lines(h).length; if (hl > want) break; if (hl === want) best = n; }
        h.textContent = head.slice(0, best); const hl = window.__lines(h); if (want === 2) out.perHead = window.__perLine([...hl, ''], pure); L = grow(); out['head' + want] = L.length; }
      // the box, as the stylesheet resolves it (CSS px, before the zoom of a narrow tile and before any transform)
      const cs = (e) => getComputedStyle(e); const n = (v) => Math.round(parseFloat(v) * 100) / 100;
      out.box = { textW: n(cs(p).width), bodyLine: n(cs(p).lineHeight), headLine: n(cs(h).lineHeight), headGap: n(cs(h).marginBottom), tilePadV: n(cs(tile).paddingTop), tilePadH: n(cs(tile).paddingLeft), tileBorder: n(cs(tile).borderTopWidth), sidePad: n(cs(side).paddingTop), sideBorder: n(cs(side).borderTopWidth), sideH: n(cs(side).height), sideW: n(cs(side).width) };
      out.fonts = { body: cs(p).fontFamily, head: cs(h).fontFamily };
      p.textContent = body; h.textContent = head; return out; };
    // does this text take at most `lines` lines? (head: in the heading; else in the body under a one-line heading)
    window.__holds = (i, head, body) => { const { side, tile } = window.__side(i); const p = tile.querySelector('p'), h = tile.querySelector('h5'); const was = [h.textContent, p.textContent]; h.textContent = head; p.textContent = body; const o = { head: window.__lines(h).length, body: window.__lines(p).length, scrolls: side.scrollHeight > side.clientHeight }; h.textContent = was[0]; p.textContent = was[1]; return o; };
    window.__rows = (i) => { const { side, tile } = window.__side(i); const b = [...tile.querySelectorAll('.st-social-btn')]; const fits = () => side.scrollHeight <= side.clientHeight; let n = b.length; const all = n; while (n > 0 && !fits()) { b[n - 1].style.display = 'none'; n--; }
      const cs = getComputedStyle(b[0]); const o = { all, fit: n, labelled: getComputedStyle(b[0], '::after').content !== 'none', row: Math.round(parseFloat(cs.height) * 100) / 100, gap: parseFloat(getComputedStyle(tile).rowGap), pad: parseFloat(getComputedStyle(tile).paddingTop), border: parseFloat(getComputedStyle(tile).borderTopWidth) }; b.forEach((x) => (x.style.display = '')); return o; };
    // a picture as it is drawn: its box, and whether all of it is in the box (fitted inside it, or a box of its own proportions)
    window.__drawn = (im) => { const r = im.getBoundingClientRect(), fit = getComputedStyle(im).objectFit, nat = im.naturalWidth / im.naturalHeight; return { box: `${Math.round(r.width)} × ${Math.round(r.height)}`, fit, whole: r.width > 0 && r.height > 0 && (fit === 'contain' || fit === 'scale-down' || Math.abs(r.width / r.height / nat - 1) < 0.01) }; };
    window.__box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  }, CJK_RE.source);
  return { ctx, page };
}
const jump = async (page, i) => { await page.evaluate((i) => window.__deckJump(i), i); await page.waitForTimeout(700); };

// the pixels of the specimen colour in a picture of `clip`: how many, and the box they fill
const counter = await (await browser.newContext()).newPage();
async function red(page, clip, fullPage = false) {
  const png = await page.screenshot({ clip, fullPage });
  return counter.evaluate(async (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' })); const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data; let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) { const i = (y * bmp.width + x) * 4; if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    return { n, w: x1 - x0 + 1, h: y1 - y0 + 1, of: bmp.width * bmp.height, in: [bmp.width, bmp.height] }; }, png.toString('base64'));
}
const whole = (r, w, h) => r.n > 0 && Math.abs(r.w / r.h - w / h) / (w / h) < 0.03;
// …and in a photograph of the picture's own box: its frame is there on all four sides (a 16:9 picture cut to 2:1 keeps
// nearly its proportions in the counted colour, and loses its frame at the top and the bottom)
const framed = (r, w, h) => whole(r, w, h) && r.w <= r.in[0] - 2 && r.h <= r.in[1] - 2;
// a picture fitted inside its box with words drawn over part of it: its counted colour is as wide as the fitted picture
// (neither side is cut) and stands clear of the box's sides; `over`: the colour stops short of the picture's height,
// because a dark gradient (the ground its words are read on) is drawn over the picture's lower part
const fitted = (box, w, h) => { const [bw, bh] = box.split(' × ').map(Number); const fw = Math.min(bw, bh * w / h); return [fw, fw * h / w]; };
const sides = (r, box, w, h) => r.n > 0 && Math.abs(r.w - 0.9 * fitted(box, w, h)[0]) <= 3 && r.w <= r.in[0] - 2;
const over = (r, box, w, h) => r.h < 0.9 * fitted(box, w, h)[1] - 3;
const picture = async (page, i) => { await page.evaluate((i) => { const im = window.__side(i).tile.querySelector('img'); im.loading = 'eager'; return Promise.race([im.decode().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]); }, i); await page.waitForTimeout(150); return red(page, await page.evaluate((i) => window.__box(window.__side(i).side), i)); };

// ── the pile: stack at three sizes, list at the phone's ────────────────────────────────────────────────────────────
const SIZES = { design: [360, 640], phone: [390, 844], desktop: [1280, 800] };
const M = { engine: ENGINE, sizes: SIZES, advice: ADVICE, stack: {}, list: {}, wall: {} };
async function pile(handle, size) {
  const { ctx, page } = await open(handle, SIZES[size]); const o = {};
  const at = (k) => PILE.indexOf(k);
  await jump(page, at('latin')); const la = await page.evaluate((i) => window.__text(i, false), at('latin'));
  await jump(page, at('cjk')); const cj = await page.evaluate((i) => window.__text(i, true), at('cjk'));
  await jump(page, at('ja')); const ja = await page.evaluate((i) => window.__text(i, true), at('ja'));
  Object.assign(o, { k: la.k, tile: [r1(la.box.sideW), r1(la.box.sideH)], bodyOnly: la.bodyOnly, head1: la.head1, head2: la.head2, latinBody: la.perBody, latinHead: la.perHead, latinChars: la.chars, cjkBody: cj.perBody, cjkHead: cj.perHead, cjkChars: cj.chars, jaBody: ja.perBody, cjkLines: [cj.bodyOnly, cj.head1, cj.head2], box: la.box, fonts: la.fonts });
  // the advice, in real words: the specimen cut to the limit
  await jump(page, at('latin')); o.adviceLatin = await page.evaluate(([i, h, b]) => window.__holds(i, h, b), [at('latin'), EN.slice(0, ADVICE.headLatin), EN.slice(0, ADVICE.bodyLatin)]);
  await jump(page, at('cjk')); o.adviceCjk = await page.evaluate(([i, h, b]) => window.__holds(i, h, b), [at('cjk'), CJK.slice(0, ADVICE.headCjk), CJK.slice(0, ADVICE.bodyCjk)]);
  for (const k of ['wide', 'tall']) { await jump(page, at(k)); const r = await picture(page, at(k)); const [w, h] = k === 'wide' ? [16, 9] : [3, 4]; o[k] = { share: Math.round(r.n / FRAME / r.of * 100), whole: whole(r, w, h) }; }
  await jump(page, at('social')); o.social = await page.evaluate((i) => window.__rows(i), at('social'));
  // not bare: the picture's own box is photographed (a titled one has its words and its button on the tile with it)
  for (const k of ['titled', 'labelled']) { await jump(page, at(k)); await picture(page, at(k)); const d = await page.evaluate((i) => window.__drawn(window.__side(i).tile.querySelector('img')), at(k)); const r = await red(page, await page.evaluate((i) => window.__box(window.__side(i).tile.querySelector('img')), at(k))); o[k] = { box: d.box, whole: d.whole && (k === 'titled' ? sides(r, d.box, 16, 9) : framed(r, 16, 9)) }; if (k === 'titled') o[k].shaded = over(r, d.box, 16, 9); if (SHOTS && size === 'phone') await page.screenshot({ path: `${SHOTS}/${handle}-${k}.png` }); }
  await jump(page, at('embed')); o.embed = await page.evaluate((i) => { const { side, tile } = window.__side(i); const t = tile.getBoundingClientRect(), s = side.getBoundingClientRect(); return { box: `${Math.round(t.width)} × ${Math.round(t.height)}`, ofFront: Math.round(t.height / s.height * 100), tall: t.height > t.width * 1.2 }; }, at('embed'));
  if (ENGINE === 'chromium' && handle === 'stack' && size === 'phone') { // the fonts the engine drew with, by name (the stylesheet names system fonts)
    await jump(page, at('latin')); const cdp = await ctx.newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const used = async (sel) => { const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }); return (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts.map((f) => f.familyName).join(' + '); };
    o.drawnWith = { latinBody: await used('.deck-card.is-top .st-prose p'), latinHead: await used('.deck-card.is-top .st-prose h5') };
    await jump(page, at('cjk')); o.drawnWith.cjkBody = await used('.deck-card.is-top .st-prose p'); o.drawnWith.cjkHead = await used('.deck-card.is-top .st-prose h5');
  }
  await ctx.close(); return o;
}
console.log('\ntext, picture, links — the stack');
for (const size of Object.keys(SIZES)) M.stack[size] = await pile('stack', size);
console.log('text, picture, links — the list');
M.list.phone = await pile('list', 'phone');

const S = M.stack;
check('CONTROL: the 360 px page is the 342 px design zoomed down, the phone is not zoomed', S.design.k < 1 && S.phone.k === 1, `k ${S.design.k} and ${S.phone.k}`);
check('the phone\'s tile is the design\'s, to the line: body, one-line heading, two-line heading', ['bodyOnly', 'head1', 'head2'].every((k) => S.design[k] === S.phone[k]), JSON.stringify([S.design, S.phone].map((x) => [x.bodyOnly, x.head1, x.head2])));
check('CJK text gets the same lines as Latin (the line is set in px, not by the font)', JSON.stringify(S.phone.cjkLines) === JSON.stringify([S.phone.bodyOnly, S.phone.head1, S.phone.head2]), JSON.stringify(S.phone.cjkLines));
check('the list shows the stack\'s lines, or one fewer (its tiles are smaller, and zoomed)', ['bodyOnly', 'head1', 'head2'].every((k) => S.phone[k] - M.list.phone[k] >= 0 && S.phone[k] - M.list.phone[k] <= 1), JSON.stringify([M.list.phone.bodyOnly, M.list.phone.head1, M.list.phone.head2]));
check('a larger screen shows more, never less (the zoom is capped at 1)', S.desktop.bodyOnly > S.phone.bodyOnly && S.desktop.k === 1, `${S.desktop.bodyOnly} lines`);
for (const [v, o] of [['stack', S.design], ['stack', S.phone], ['list', M.list.phone]]) {
  check(`${v}: a picture is shown whole, 16:9 and 3:4`, o.wide.whole && o.tall.whole, JSON.stringify([o.wide, o.tall]));
  check(`${v}: a social tile's rows carry their labels`, o.social.labelled);
  check(`${v}: a feature with a \`title\` and a \`cta\`, and one with \`label=on\`, are shown whole too`, o.titled.whole && o.labelled.whole, JSON.stringify([o.titled, o.labelled]));
  check(`${v}: an \`embed\` fills the front: it is taller than it is wide`, o.embed.ofFront >= 90 && o.embed.tall, JSON.stringify(o.embed));
  const more = v === 'list' ? 1 : 0;   // the list's smaller tile may break a line sooner
  check(`${v}: a Latin heading of ${ADVICE.headLatin} characters is at most two lines; a body of ${ADVICE.bodyLatin} at most ${ADVICE.bodyLines + more}, and nothing scrolls`, o.adviceLatin.head <= 2 && o.adviceLatin.body <= ADVICE.bodyLines + more && !o.adviceLatin.scrolls, JSON.stringify(o.adviceLatin));
  check(`${v}: a CJK heading of ${ADVICE.headCjk} characters is at most two lines; a body of ${ADVICE.bodyCjk} at most ${ADVICE.bodyLines + more}, and nothing scrolls`, o.adviceCjk.head <= 2 && o.adviceCjk.body <= ADVICE.bodyLines + more && !o.adviceCjk.scrolls, JSON.stringify(o.adviceCjk));
}
check('CONTROL: twelve links are more than a tile shows: the social tile is not capped, it scrolls', S.phone.social.all === 12 && S.phone.social.fit < 12, JSON.stringify(S.phone.social));

// ── the guide's own example ────────────────────────────────────────────────────────────────────────────────────────
console.log('the guide\'s example');
for (const size of ['design', 'phone']) { const { ctx, page } = await open('example', SIZES[size]);
  const n = await page.evaluate(() => window.__deckCount()); const scrolls = [];
  for (let i = 0; i < n; i++) { await jump(page, i); scrolls.push(await page.evaluate(() => { const s = document.querySelector('.deck-card.is-top .deck-front'); return s.scrollHeight > s.clientHeight; })); }
  check(`example (${size}): it opens on the stack, and none of its ${n} tiles scrolls`, n === 4 && scrolls.every((x) => !x) && await page.evaluate(() => document.documentElement.dataset.view) === 'stack', JSON.stringify(scrolls));
  await ctx.close(); }
{ const { ctx, page } = await open('example-wall', SIZES.phone);
  const w = await page.evaluate(() => { const full = document.querySelector('main .st-cells').getBoundingClientRect().width; return [...document.querySelectorAll('main .st-cell')].map((c) => [c.dataset.coralType, Math.round(c.getBoundingClientRect().width / full * 100)]); });
  check('example (wall): every tile is as wide as the wall', w.length === 4 && w.every(([, p]) => p >= 99), JSON.stringify(w));
  await ctx.close(); }

// ── the wall ───────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('the wall — what `w` does');
for (const size of ['phone', 'desktop']) { const { ctx, page } = await open('wall', SIZES[size]);
  const cells = await page.evaluate(async () => { const out = []; const full = document.querySelector('main .st-cells').getBoundingClientRect().width;
    for (const c of document.querySelectorAll('main .st-cell')) { c.scrollIntoView({ block: 'center' }); const im = c.querySelector('img.st-gal-img'); if (im) { im.loading = 'eager'; await Promise.race([im.decode().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]); }
      const cs = getComputedStyle(c), b = c.querySelector('.st-social-btn'), t = c.querySelector('.st-cell-title');
      out.push({ type: c.dataset.coralType, w: c.dataset.w, px: Math.round(c.getBoundingClientRect().width), high: Math.round(c.getBoundingClientRect().height), drawn: im ? window.__drawn(im) : null, share: Math.round(c.getBoundingClientRect().width / full * 100), frame: cs.borderTopWidth !== '0px' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)', labelled: b ? getComputedStyle(b, '::after').content !== 'none' : null, titleCut: t ? t.scrollWidth > t.clientWidth + 1 || t.getBoundingClientRect().width < 1 : null }); }
    return out; });
  const shots = [];
  for (const i of [0, 1, 2, 3, 12, 13, 14, 15, 16, 17]) { await page.evaluate((i) => scrollTo({ top: Math.max(0, scrollY + document.querySelectorAll('main .st-cell')[i].getBoundingClientRect().top - 60), behavior: 'instant' }), i); await page.waitForTimeout(400);
    // the whole page is photographed: a tall picture is taller than the window, and the window's edge is not a crop
    const clip = await page.evaluate((i) => { const c = document.querySelectorAll('main .st-cell')[i]; const b = window.__box(i < 12 ? c : c.querySelector('img.st-gal-img')); return { ...b, y: b.y + scrollY }; }, i); shots[i] = ({ ...(await red(page, clip, true)), cell: [Math.round(clip.width), Math.round(clip.height)] }); }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/wall-${size}.png`, fullPage: true });
  const [f1, f3, f6, f6tall, l1, l6, s1, s6, p1, p6, t2, t0, ti3, ti6, ti6tall, la3, la6, la6tall, e3, e6, ti1] = cells;
  // a picture that is not bare: the box it is drawn in, and whether all of it is there (the pixels are asked too)
  const titled = (c, i, w, h) => ({ box: c.drawn.box, whole: c.drawn.whole && sides(shots[i], c.drawn.box, w, h), shaded: over(shots[i], c.drawn.box, w, h) });
  const labelled = (c, i, w, h) => ({ box: c.drawn.box, whole: c.drawn.whole || framed(shots[i], w, h) });
  M.wall[size] = { wallPx: Math.round(f6.px), noW: { feature: f1.px, link: l1.px, social: s1.px, profile: p1.px }, feature: { noW: { whole: whole(shots[0], 16, 9), box: shots[0].cell.join(' × ') }, w3: { whole: whole(shots[1], 16, 9), box: shots[1].cell.join(' × ') }, w6: { whole: whole(shots[2], 16, 9), box: shots[2].cell.join(' × ') }, w6tall: { whole: whole(shots[3], 3, 4), box: shots[3].cell.join(' × ') } }, linkTitleCutAtNoW: l1.titleCut, socialLabelled: s6.labelled, textShare: [t2.share, t0.share], textFrame: t2.frame || t0.frame,
    titled: { noW: ti1.drawn.box, w3: titled(ti3, 12, 16, 9), w6: titled(ti6, 13, 16, 9), w6tall: titled(ti6tall, 14, 3, 4) }, labelled: { w3: labelled(la3, 15, 16, 9), w6: labelled(la6, 16, 16, 9), w6tall: labelled(la6tall, 17, 3, 4) }, embed: { w3: `${e3.px} × ${e3.high}`, w6: `${e6.px} × ${e6.high}` } };
  const ratio = (box) => { const [a, b] = box.split(' × ').map(Number); return a / b; };
  const W = M.wall[size];
  check(`wall (${size}): a feature with a \`title\` and a \`cta\` is not cropped, at \`w=3\` or \`w=6\`, 16:9 or 3:4`, W.titled.w3.whole && W.titled.w6.whole && W.titled.w6tall.whole, JSON.stringify(W.titled));
  check(`wall (${size}): \`label=on\` narrower than \`w=6\` is cropped to a square`, !W.labelled.w3.whole && Math.abs(ratio(W.labelled.w3.box) - 1) < 0.02, JSON.stringify(W.labelled.w3));
  check(`wall (${size}): \`label=on\` at \`w=6\` is cropped to 2:1, 16:9 and 3:4`, [W.labelled.w6, W.labelled.w6tall].every((x) => !x.whole && Math.abs(ratio(x.box) - 2) < 0.02), JSON.stringify(W.labelled));
  check(`wall (${size}): an \`embed\` is as tall as it is wide`, [W.embed.w3, W.embed.w6].every((b) => Math.abs(ratio(b) - 1) < 0.02), JSON.stringify(W.embed));
  check(`wall (${size}): with no \`w\` a feature, a link and a social tile are one column of six`, [f1, l1, s1].every((c) => c.w === '1' && c.share < 17), JSON.stringify([f1, l1, s1].map((c) => [c.type, c.w, c.share])));
  check(`wall (${size}): at \`w=6\` they are as wide as the wall`, [f6, l6, s6, p6].every((c) => c.share >= 99), JSON.stringify([f6, l6, s6, p6].map((c) => c.share)));
  check(`wall (${size}): a picture narrower than \`w=6\` is cropped to a square (no \`w\`, and \`w=3\`)`, !whole(shots[0], 16, 9) && !whole(shots[1], 16, 9) && [shots[0], shots[1]].every((s) => Math.abs(s.cell[0] - s.cell[1]) <= 2), JSON.stringify(shots.slice(0, 2)));
  check(`wall (${size}): a picture at \`w=6\` is shown whole, 16:9 and 3:4`, whole(shots[2], 16, 9) && whole(shots[3], 3, 4), JSON.stringify(shots.slice(2, 4)));
  check(`wall (${size}): a text tile is as wide as the wall whatever its \`w\`, and has no frame`, t2.share >= 99 && t0.share >= 99 && !t2.frame && !t0.frame, JSON.stringify([t2, t0]));
  check(`wall (${size}): a social tile is icons, with no labels`, s1.labelled === false && s6.labelled === false);
  await ctx.close(); }

// ── the view a page opens on ───────────────────────────────────────────────────────────────────────────────────────
console.log('the view it opens on');
{ const seen = {};
  for (const h of ['stack', 'list', 'wall', 'two']) { const { ctx, page } = await open(h, SIZES.phone); seen[h] = await page.evaluate(() => ({ view: document.documentElement.dataset.view, buttons: [...document.querySelectorAll('.deck-seg button')].filter((b) => getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0).length })); await ctx.close(); }
  M.opens = seen;
  check('with no `view:` the page opens on the stack; `view: list` and `view: wall` open on those', seen.stack.view === 'stack' && seen.list.view === 'list' && seen.wall.view === 'wall', JSON.stringify(seen));
  check('`views: stack list` leaves two views to switch between, and opens on the stack', seen.two.view === 'stack' && seen.two.buttons === 2 && seen.stack.buttons === 3, JSON.stringify(seen)); }

await browser.close();

// ── the table, and the receipt ─────────────────────────────────────────────────────────────────────────────────────
const row = (name, f) => `| ${name} | ${f(S.design)} | ${f(S.phone)} | ${f(M.list.phone)} | ${f(S.desktop)} |`;
const table = [
  `| measured (${ENGINE}) | stack 360 × 640 (the 342 px design, zoomed) | stack 390 × 844 | list 390 × 844 | stack 1280 × 800 |`, '|---|---:|---:|---:|---:|',
  row('tile, CSS px', (o) => `${o.tile[0]} × ${o.tile[1]}`), row('zoom (--deck-k)', (o) => o.k),
  row('body lines before it scrolls, no heading', (o) => o.bodyOnly), row('… under a one-line heading', (o) => o.head1), row('… under a two-line heading', (o) => o.head2),
  row('Latin characters per body line (median)', (o) => o.latinBody), row('Latin characters per heading line', (o) => o.latinHead), row('Latin characters of body that fit, no heading', (o) => o.latinChars),
  row('CJK characters per body line (median)', (o) => o.cjkBody), row('CJK characters per heading line', (o) => o.cjkHead), row('CJK characters of body that fit, no heading', (o) => o.cjkChars), row('Japanese characters per body line', (o) => o.jaBody),
  row(`Latin heading of ${ADVICE.headLatin} / body of ${ADVICE.bodyLatin}: lines`, (o) => `${o.adviceLatin.head} / ${o.adviceLatin.body}`), row(`CJK heading of ${ADVICE.headCjk} / body of ${ADVICE.bodyCjk}: lines`, (o) => `${o.adviceCjk.head} / ${o.adviceCjk.body}`),
  row('16:9 picture: share of the tile (pixels), whole', (o) => `${o.wide.share}%, ${o.wide.whole ? 'whole' : 'CROPPED'}`), row('3:4 picture: share of the tile (pixels), whole', (o) => `${o.tall.share}%, ${o.tall.whole ? 'whole' : 'CROPPED'}`),
  row('16:9 feature with `title` and `cta`: picture drawn', (o) => `${o.titled.box}, ${o.titled.whole ? 'whole' : 'CROPPED'}`), row('16:9 feature with `label=on`: picture drawn', (o) => `${o.labelled.box}, ${o.labelled.whole ? 'whole' : 'CROPPED'}`), row('embed: tile, and its share of the front\'s height', (o) => `${o.embed.box}, ${o.embed.ofFront}%`),
  row('social rows before it scrolls (of 12)', (o) => o.social.fit), row('social rows labelled', (o) => (o.social.labelled ? 'yes' : 'no')),
  '', '| the wall | 390 × 844 | 1280 × 800 |', '|---|---:|---:|',
  ...[['wall width, px', (w) => w.wallPx], ['feature / link / social / profile with no `w`, px wide', (w) => Object.values(w.noW).join(' / ')], ['16:9 feature, no `w`: picture drawn', (w) => `${w.feature.noW.box}, ${w.feature.noW.whole ? 'whole' : 'cropped'}`], ['16:9 feature, `w=3`', (w) => `${w.feature.w3.box}, ${w.feature.w3.whole ? 'whole' : 'cropped'}`], ['16:9 feature, `w=6`', (w) => `${w.feature.w6.box}, ${w.feature.w6.whole ? 'whole' : 'cropped'}`], ['3:4 feature, `w=6`', (w) => `${w.feature.w6tall.box}, ${w.feature.w6tall.whole ? 'whole' : 'cropped'}`], ['16:9 feature with `title` and `cta`, no `w`: picture drawn', (w) => w.titled.noW], ['16:9 feature with `title` and `cta`, `w=3`', (w) => `${w.titled.w3.box}, ${w.titled.w3.whole ? 'not cropped' : 'CROPPED'}`], ['16:9 feature with `title` and `cta`, `w=6`', (w) => `${w.titled.w6.box}, ${w.titled.w6.whole ? 'not cropped' : 'CROPPED'}`], ['3:4 feature with `title` and `cta`, `w=6`', (w) => `${w.titled.w6tall.box}, ${w.titled.w6tall.whole ? 'not cropped' : 'CROPPED'}`], ['… a dark gradient is drawn over its lower part', (w) => (w.titled.w6.shaded ? 'yes' : 'no')], ['16:9 feature with `label=on`, `w=3`', (w) => `${w.labelled.w3.box}, ${w.labelled.w3.whole ? 'whole' : 'cropped'}`], ['16:9 / 3:4 feature with `label=on`, `w=6`', (w) => `${w.labelled.w6.box} / ${w.labelled.w6tall.box}, ${w.labelled.w6.whole || w.labelled.w6tall.whole ? 'WHOLE' : 'cropped'}`], ['embed at `w=3` / `w=6`', (w) => `${w.embed.w3} / ${w.embed.w6}`], ['link with no `w`: its words are cut', (w) => (w.linkTitleCutAtNoW ? 'yes' : 'no')], ['text tile at `w=2` / no `w`: share of the wall; frame', (w) => `${w.textShare.join('% / ')}%; ${w.textFrame ? 'framed' : 'none'}`], ['social rows labelled', (w) => (w.socialLabelled ? 'yes' : 'no')]].map(([n, f]) => `| ${n} | ${f(M.wall.phone)} | ${f(M.wall.desktop)} |`),
  '', `Opens on: no \`view:\` → ${M.opens.stack.view} (${M.opens.stack.buttons} views offered); \`view: list\` → ${M.opens.list.view}; \`view: wall\` → ${M.opens.wall.view}; \`views: stack list\` → ${M.opens.two.view} (${M.opens.two.buttons} offered).`,
  ...(S.phone.drawnWith ? ['', `Fonts this machine drew with: Latin body ${S.phone.drawnWith.latinBody}; Latin heading ${S.phone.drawnWith.latinHead}; CJK body ${S.phone.drawnWith.cjkBody}; CJK heading ${S.phone.drawnWith.cjkHead}.`] : []),
].join('\n');
if (TABLE) console.log('\n' + table + '\n');

// what the guide states, from what was measured on the phone (the design gives the same lines)
const P = S.phone;
const receipt = {
  '//': 'Written by w3/deck-composition.smoke.mjs --write (chromium). Do not edit by hand: measure again.',
  engine: 'chromium', viewport: SIZES.phone, tile: P.tile, box: P.box,
  lines: { bodyOnly: P.bodyOnly, head1: P.head1, head2: P.head2 },
  perLine: { latinBody: P.latinBody, latinHead: P.latinHead, cjkBody: P.cjkBody, cjkHead: P.cjkHead },
  picture: { wide: P.wide.share, tall: P.tall.share }, social: { rows: P.social.fit, row: P.social.row, gap: P.social.gap, pad: P.social.pad, border: P.social.border },
  wall: { column: M.wall.phone.noW.feature, of: M.wall.phone.wallPx, bare: M.wall.phone.feature, titled: M.wall.phone.titled, labelled: M.wall.phone.labelled, embed: M.wall.phone.embed },
  pile: { stack: { titled: P.titled, labelled: P.labelled, embed: P.embed }, list: { titled: M.list.phone.titled, labelled: M.list.phone.labelled, embed: M.list.phone.embed } },
  advice: ADVICE, fonts: P.fonts, drawnWith: P.drawnWith || null, desktop: { viewport: SIZES.desktop, bodyOnly: S.desktop.bodyOnly, latinBody: S.desktop.latinBody },
};
if (WRITE) {
  if (ENGINE !== 'chromium') { console.log('💥 --write is chromium\'s: the receipt names one engine'); process.exit(1); }
  if (failures.length) console.log('   (not written: there are failures)'); else { writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2) + '\n'); console.log(`   wrote ${RECEIPT}`); }
} else {
  let was = null; try { was = JSON.parse(readFileSync(RECEIPT, 'utf8')); } catch (_) { /* reported below */ }
  if (check('the receipt (deck-composition.measured.json) is there', !!was, 'run with --write')) {
    // exact: what the stylesheet fixes in px. (Engines round a picture's edge differently: a point of share is allowed.)
    check('receipt: lines per tile are what this browser shows', JSON.stringify(was.lines) === JSON.stringify(receipt.lines), `receipt ${JSON.stringify(was.lines)}, measured ${JSON.stringify(receipt.lines)}`);
    check('receipt: rows of links are what this browser shows', was.social.rows === receipt.social.rows, `receipt ${was.social.rows}, measured ${receipt.social.rows}`);
    check('receipt: a picture\'s share of the tile is what this browser shows', Math.abs(was.picture.wide - receipt.picture.wide) <= 1 && Math.abs(was.picture.tall - receipt.picture.tall) <= 1, `receipt ${JSON.stringify(was.picture)}, measured ${JSON.stringify(receipt.picture)}`);
    check('receipt: one column of the wall is as wide as recorded, within 2 px (a scrollbar drawn over the page makes the wall 10 px wider)', Math.abs(was.wall.column - receipt.wall.column) <= 2 && Math.abs(was.wall.of - receipt.wall.of) <= 12, `receipt ${JSON.stringify(was.wall)}, measured ${JSON.stringify(receipt.wall)}`);
    check('receipt: the advice measured is the advice recorded', JSON.stringify(was.advice) === JSON.stringify(ADVICE));
    if (ENGINE === 'chromium') check('receipt: a picture that is not bare, and an embed, are drawn in the boxes recorded, on the wall and in the piles', JSON.stringify([was.wall.bare, was.wall.titled, was.wall.labelled, was.wall.embed, was.pile]) === JSON.stringify([receipt.wall.bare, receipt.wall.titled, receipt.wall.labelled, receipt.wall.embed, receipt.pile]), `measured ${JSON.stringify([receipt.wall, receipt.pile])}`);
    if (ENGINE === 'chromium') check('receipt: the text box is the one recorded, to a hundredth of a px', JSON.stringify(was.box) === JSON.stringify(receipt.box), `receipt ${JSON.stringify(was.box)}, measured ${JSON.stringify(receipt.box)}`);
    // within a fifth: what depends on this machine's fonts
    for (const k of Object.keys(receipt.perLine)) check(`receipt: ${k} characters per line is within a fifth of the receipt`, Math.abs(receipt.perLine[k] - was.perLine[k]) <= was.perLine[k] / 5, `receipt ${was.perLine[k]}, measured ${receipt.perLine[k]}`);
  }
}

if (failures.length) { console.log('\n' + failures.map((f) => '🔴 ' + f).join('\n')); process.exit(1); }
console.log(`\n✅ ${passes} checks`);
