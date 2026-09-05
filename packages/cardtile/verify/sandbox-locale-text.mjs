// The sandbox, RENDERED, in three languages — does an en-US visitor's document still say anything
// in Chinese?
//
//   node packages/cardtile/verify/sandbox-locale-text.mjs
//
// 🩸 WHY A HARNESS AND NOT A UNIT TEST. sandbox-i18n.test.mjs proves the nine-locale tables are
// complete and that every Chinese literal left in `w/index.html` has a key and an element
// bootSandbox() writes to. Both were green on 2026-09-05 while `card.feelreef.com/try/edit` served
// an en-US visitor a save sheet reading 「取消」 and 「存」 — because the replacement happens in the
// BROWSER, and no test in this repo had ever run it. This one runs it, against the Worker's own
// bytes (the committed bundle, not w/serve.mjs's copy — see sandbox-served.mjs's header).
//
// 🔴 THE SUBJECT IS `textContent`, NOT `innerText`. The two buttons this exists to check sit inside
// `#pubmodal`, which the sandbox never opens, and `#cardurl-block`/`#md-block` are hidden too. A
// visible-text ruler cannot see any of them, and would have signed off on the exact defect. Hidden
// is not absent — one `hidden = false` (or one tap on Markdown mode) puts it on screen. `<script>`
// and `<style>` ARE excluded: the Worker inlines the whole unminified editor bundle into the page,
// so `document.body.textContent` otherwise counts every source comment in card-render.mjs as text —
// the first run of this harness read 248,160 characters and reported 34 Chinese "strings", every
// one of them a comment. A ruler that reads the program instead of the page.
import http from 'node:http';
import { PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

// the sandbox page never touches the store; the door's parking route does. A real Map, as in
// sandbox-served.mjs — this harness does not walk through the door, but the worker is the whole one.
const kv = new Map();
const env = {
  PREVIEW: 'true',
  CARDS: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  },
};

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  let out;
  try {
    out = await worker.fetch(request, env);
  } catch (e) {
    out = new Response(`harness: worker threw — ${e.message}`, { status: 500 });
  }
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();

let bad = 0;
const fail = (m) => { console.log(`   🔴 ${m}`); bad++; };
const ok = (m) => console.log(`   ✓ ${m}`);

// Han + kana + CJK punctuation + the full/half-width forms block (＋, （）, and friends).
const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯]/;
const CJK_G = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯]+/g;

/** everything a visitor's document says, chrome and card kept apart */
const READ = () => {
  const attrs = [];
  for (const e of document.querySelectorAll('[aria-label],[title],[placeholder]')) {
    for (const a of ['aria-label', 'title', 'placeholder']) {
      const v = e.getAttribute(a);
      if (v) attrs.push(`${e.id || e.tagName}@${a}=${v}`);
    }
  }
  const clone = document.body.cloneNode(true);
  for (const n of clone.querySelectorAll('script, style, template')) n.remove();
  return {
    lang: document.documentElement.lang,
    title: document.title,
    text: clone.textContent,
    attrs: attrs.join('\n'),
    card: document.getElementById('canvas').contentDocument.body.textContent,
  };
};

async function harvest(acceptLanguage) {
  const ctx = await browser.newContext({
    locale: acceptLanguage,
    extraHTTPHeaders: { 'accept-language': acceptLanguage },
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/try/edit`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#palette .ctw-add');        // booted, and the palette has painted
  const before = await page.evaluate(READ);
  // 🔴 CONTROL, IN PLACE. Put the defect back — a Chinese label on a button inside the sheet that
  // never opens — and prove the reader above sees it THERE, still hidden, which is the one place it
  // has to look. Undone in the same evaluate; the reads either side are of the untouched page.
  const control = await page.evaluate(() => {
    const b = document.getElementById('pub-go');
    const was = b.textContent;
    b.textContent = '存';
    const clone = document.body.cloneNode(true);
    for (const n of clone.querySelectorAll('script, style, template')) n.remove();
    const seen = clone.textContent.includes('存') && document.getElementById('pubmodal').hidden;
    b.textContent = was;
    return seen;
  });
  // …and again in Markdown mode, which un-hides #md-block — the one hidden panel a visitor can
  // reach without opening the console, and whose heading and note were hard-coded until today.
  await page.click('#md-toggle');
  await page.waitForSelector('#md-block:not([hidden])');
  const after = await page.evaluate(READ);
  await ctx.close();
  return { before, after, control };
}

const runs = {};
for (const tag of ['en-US', 'ja', 'zh-TW']) {
  console.log(`\n── ${tag} ────────────────────────────────────────────`);
  const r = await harvest(tag);
  runs[tag] = r;
  console.log(`   <html lang="${r.before.lang}">  ·  <title>${r.before.title}</title>`);
  for (const [phase, snap] of [['card view', r.before], ['markdown mode', r.after]]) {
    // the CARD is the visitor's own content and is checked separately, below
    const chrome = snap.text.replace(snap.card, '');
    const hits = [...new Set([...(chrome.match(CJK_G) || []), ...(snap.attrs.match(CJK_G) || [])])];
    if (tag === 'en-US') {
      if (hits.length) fail(`${phase}: CJK in the chrome — ${JSON.stringify(hits)}`);
      else ok(`${phase}: no CJK in the chrome (${chrome.length} chars of text + ${snap.attrs.split('\n').length} attributes scanned)`);
    } else {
      ok(`${phase}: ${hits.length} CJK run(s) in the chrome — expected, this locale is written in them`);
    }
  }
}

console.log('\n── controls ─────────────────────────────────────────');
if (CJK.test(runs['zh-TW'].before.text)) ok('the CJK pattern DOES fire, on the zh-TW page');
else fail('the CJK pattern cannot see Chinese at all — it is measuring nothing');
if (runs['en-US'].before.text.length > 400) ok(`the en-US page really has text in it (${runs['en-US'].before.text.length} chars)`);
else fail(`only ${runs['en-US'].before.text.length} chars harvested — the page did not boot`);
for (const tag of ['en-US', 'ja', 'zh-TW']) {
  if (runs[tag].control) ok(`${tag}: the reader DOES see a Chinese label inside the never-opened save sheet`);
  else fail(`${tag}: the reader cannot see into the hidden save sheet — the original defect would pass`);
}

// ── the nine-locale table reached the elements, in the words that locale uses ────────────────────
const EXPECT = {
  'en-US': ['Cancel', 'Save', 'Save it online', 'markdown (exactly what gets saved)', 'Card address'],
  ja: ['キャンセル', '保存', 'オンラインに保存', 'markdown（保存されるのはこれです）', 'カードの URL'],
  'zh-TW': ['取消', '存', '存到線上', 'markdown（就是存起來的那份）', '卡片網址'],
};
for (const [tag, words] of Object.entries(EXPECT)) {
  const t = runs[tag].after.text;
  const missing = words.filter((w) => !t.includes(w));
  if (missing.length) fail(`${tag}: the sheet never got these words — ${JSON.stringify(missing)}`);
  else ok(`${tag}: all ${words.length} newly-tabled strings are in the document`);
}
// …and the Traditional Chinese is GONE from the other two, not merely joined by a translation
for (const tag of ['en-US', 'ja']) {
  const t = runs[tag].after.text;
  const leaked = ['取消', '存到線上', '先存一份', '卡片網址', '往上移'].filter((w) => t.includes(w));
  if (leaked.length) fail(`${tag}: Traditional Chinese still in the document — ${JSON.stringify(leaked)}`);
  else ok(`${tag}: none of the five zh-TW literals survived`);
}

// the card in the iframe is the VISITOR's content — it follows the persona, not the renderer
const enCard = runs['en-US'].before.card;
if (CJK.test(enCard)) fail(`the en-US card itself carries CJK — ${JSON.stringify(enCard.match(CJK_G))}`);
else ok('the en-US card (user content, in the iframe) is CJK-free too');

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} finding(s)` : '\n✅ ALL GREEN');
process.exit(bad ? 1 : 0);
