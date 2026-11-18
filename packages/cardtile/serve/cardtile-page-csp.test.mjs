// The Content-Security-Policy of a person's page (cardtile-page-csp.mjs), asked of the cardtile worker.
//
// What is proved here, without a browser:
//   · the setting: exactly "report-only" or "enforce" is on; unset and everything else is off, and
//     off is the committed before-fixture's 714 answers, byte for byte (service-host-off fixture);
//   · on, only a header is added: every body, status and store read of the same 714 is unchanged;
//   · the STATIC CHECK: on a page holding every tile type, every inline script and every inline
//     event handler the page carries is in the policy by hash, and every address class the page
//     loads from is allowed — and the same check FAILS on a page with one script added;
//   · the policy is on EVERY person's page and preview, whatever it holds: nothing a person writes, and
//     nothing in the rendered page, decides whether it is sent (an embed, the word "embed" in a file
//     served in windows, ` srcdoc="` in the page — the r1 review's cases);
//   · with the setting on, an embed is its own document (cardtile-embed-document.mjs): its frame names a
//     same-origin address with the same sandbox, that address answers with exactly the document the
//     srcdoc held under a policy of its own, and only for an embed tile of the file it names; with the
//     setting off that address is an unknown path, answer for answer;
//   · the setting leaves every other answer alone, the `.md` exits included (their nosniff is
//     cardtile-md-nosniff.test.mjs, and does not depend on this setting).
// What a browser does with the policy is verify/page-csp.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import worker, { renderCardHTML } from './card-worker.mjs';
import { gridCases, answerOf, answerDiff, atFixedClock, readFixture } from './gen-service-host-off-fixture.mjs';
import vm from 'node:vm';
import { deflateSync, crc32 } from 'node:zlib';
import { pageCspStage, pageCspHeaderName, pagePolicy, pageCspHeaders, bootScriptOf, isBootData,
  videoScript, pictureScript, hashSource, PAGE_HANDLERS, DECK_FILE_ONERROR, ICON_ONERROR, PAGE_CSP_STAGES } from './cardtile-page-csp.mjs';
import { embedDocuments, framesAsDocuments, EMBED_DOCUMENT_POLICY } from './cardtile-embed-document.mjs';
import { parseCard } from '../card-core.js';
import { PICTURE_STRATEGIES } from './asset-urls.mjs';
import { WINDOW_TILES } from './size-tier.mjs';
import { GRID_STAGES, GRID_HOSTS, GRID_PREVIEW } from './gen-service-host-off-fixture.mjs';
import { DECK_HEAD_JS, DECK_JS_PATH } from '../w3/deck-page.mjs';
import { ON_DEMAND_TILES } from './size-tier.mjs';
import { PNG, EVERY_TILE, PLAIN, WITH_EMBED, HOSTILE_FRONT, long, proseNamingEmbed, wordsNamingEmbed, EMBED_ON_BACK, OTHER_EMBED } from './cardtile-page-csp-fixtures.mjs';

const ENFORCED = 'content-security-policy';
const REPORTED = 'content-security-policy-report-only';

const CARDS = { every: EVERY_TILE, plain: PLAIN, embedded: WITH_EMBED, hostile: HOSTILE_FRONT,
  long: long(ON_DEMAND_TILES + 40), longembedded: long(ON_DEMAND_TILES + 40, '- [ ] %% card: embed w=6 %% <script>1</script>\n'),
  prose: proseNamingEmbed(ON_DEMAND_TILES + 1), words: wordsNamingEmbed(ON_DEMAND_TILES + 5), onback: EMBED_ON_BACK, other: OTHER_EMBED,
  [`_preview:${'c'.repeat(32)}`]: EVERY_TILE, [`_preview:${'d'.repeat(32)}`]: WITH_EMBED };
// the window of `longembedded` that holds its embed (its last tile)
const EMBED_WINDOW = Math.ceil((ON_DEMAND_TILES + 41) / WINDOW_TILES);
const store = () => ({ get: async (k) => CARDS[k] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } });
const ask = (path, settings = {}, init = {}) => worker.fetch(new Request(`http://localhost${path}`, init), { CARDS: store(), ...settings });
const ON = { CARDS_PAGE_CSP: 'enforce' };

// ── the static check: an independent reading of a page against a policy ────────────────────────
const sha = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const directives = (policy) => Object.fromEntries(String(policy).split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...v]) => [name, v]));
/** everything on `page` that `policy` would refuse, as a list of sentences ([] = the page fits the policy) */
function refusals(page, policy) {
  const d = directives(policy);
  const out = [];
  const script = d['script-src'] || [];
  for (const m of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = /\ssrc="([^"]*)"/.exec(m[1]);
    if (src) { if (!(src[1].startsWith('/') && !src[1].startsWith('//') && script.includes("'self'"))) out.push(`script file ${src[1]}`); }
    else if (!script.includes(sha(m[2]))) out.push(`inline script ${JSON.stringify(m[2].slice(0, 60))}`);
  }
  for (const m of page.matchAll(/\son[a-z]+=(?:"([^"]*)"|'([^']*)')/g)) {
    const text = unescape(m[1] ?? m[2]);
    if (!(script.includes("'unsafe-hashes'") && script.includes(sha(text)))) out.push(`inline handler ${JSON.stringify(text.slice(0, 60))}`);
  }
  if (/javascript:/i.test(page)) out.push('a javascript: address');
  for (const tag of ['form', 'base', 'object', 'embed', 'video', 'audio', 'source']) if (new RegExp(`<${tag}\\b`).test(page)) out.push(`a <${tag}>`);
  // a frame: a srcdoc document inherits this policy (its script is refused); a frame by address must be one frame-src allows
  const frame = d['frame-src'] || [];
  for (const m of page.matchAll(/<iframe\b([^>]*)>/g)) {
    if (/\ssrcdoc="/.test(m[1])) { out.push('a srcdoc frame (it inherits this policy)'); continue; }
    const src = (/\ssrc="([^"]*)"/.exec(m[1]) || [])[1] || '';
    const ok = src.startsWith('/') && !src.startsWith('//') ? frame.includes("'self'") : frame.some((h) => /^https:\/\//.test(h) && src.startsWith(`${h}/`));
    if (!ok) out.push(`a frame ${src.slice(0, 60)}`);
  }
  const img = d['img-src'] || [];
  const imgOk = (u) => (u.startsWith('data:') ? img.includes('data:') : /^https:/i.test(u) ? img.includes('https:') : /^http:/i.test(u) ? img.includes('http:')
    : u.startsWith('/') && !u.startsWith('//') ? img.includes("'self'") : false);
  for (const m of page.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/g)) if (!imgOk(unescape(m[1]))) out.push(`picture ${m[1].slice(0, 60)}`);
  for (const m of page.matchAll(/url\((?:&quot;|["'])?([^)"']*?)(?:&quot;|["'])?\)/g)) if (!imgOk(unescape(m[1]))) out.push(`css picture ${m[1].slice(0, 60)}`);
  for (const m of page.matchAll(/<link\b[^>]*>/g)) {
    const rel = /\srel="([^"]*)"/.exec(m[0])[1]; const href = unescape(/\shref="([^"]*)"/.exec(m[0])[1]);
    if (rel === 'stylesheet' && !(href.startsWith('/') && (d['style-src'] || []).includes("'self'"))) out.push(`stylesheet ${href}`);
    if (/icon|preload/.test(rel) && !imgOk(href)) out.push(`icon ${href}`);
  }
  if (/<style\b/.test(page) && !(d['style-src'] || []).includes("'unsafe-inline'")) out.push('an inline <style>');
  return out;
}

// ── the setting ────────────────────────────────────────────────────────────────────────────────
test('the setting: exactly "report-only" and "enforce" are on; unset and anything else is off', () => {
  assert.deepEqual([...PAGE_CSP_STAGES], ['off', 'report-only', 'enforce']);
  assert.equal(pageCspStage({ CARDS_PAGE_CSP: 'report-only' }), 'report-only');
  assert.equal(pageCspStage({ CARDS_PAGE_CSP: 'enforce' }), 'enforce');
  for (const v of [undefined, null, '', 'off', 'on', '1', 'true', true, 1, 'Enforce', 'ENFORCE', ' enforce', 'enforce ', 'enforce\n', 'enforced', 'report', 'report_only', 'Report-Only', 'report-only ', ['enforce'], { toString: () => 'enforce' }]) {
    assert.equal(pageCspStage({ CARDS_PAGE_CSP: v }), 'off', `${JSON.stringify(v)} must be off`);
  }
  assert.equal(pageCspStage(undefined), 'off');
  assert.equal(pageCspStage(null), 'off');
  assert.equal(pageCspHeaderName('report-only'), 'Content-Security-Policy-Report-Only');
  assert.equal(pageCspHeaderName('enforce'), 'Content-Security-Policy');
  for (const s of ['off', 'toString', '__proto__', undefined]) assert.equal(pageCspHeaderName(s), undefined);
});

test('unset: a person\'s page, a preview and the .md exits carry no policy header', async () => {
  for (const path of ['/every', '/plain', `/_preview/${'c'.repeat(32)}`, '/every.md']) {
    const r = await ask(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get(ENFORCED), null, path);
    assert.equal(r.headers.get(REPORTED), null, path);
  }
});

test('report-only sends the policy in the report-only header alone; enforce in the enforcing header alone; the text is one text', async () => {
  for (const path of ['/every', '/plain', `/_preview/${'c'.repeat(32)}`]) {
    const reported = await ask(path, { CARDS_PAGE_CSP: 'report-only' });
    const enforced = await ask(path, ON);
    assert.equal(reported.headers.get(ENFORCED), null, path);
    assert.equal(enforced.headers.get(REPORTED), null, path);
    assert.ok(reported.headers.get(REPORTED), `${path}: no report-only header`);
    assert.equal(enforced.headers.get(ENFORCED), reported.headers.get(REPORTED), path);
    // …and the page itself is the page served with the setting unset
    const [a, b, c] = await Promise.all([reported.text(), enforced.text(), (await ask(path)).text()]);
    assert.equal(a, c, `${path}: report-only changed the body`);
    assert.equal(b, c, `${path}: enforce changed the body`);
  }
});

test('the policy text, whole', async () => {
  const policy = (await ask('/plain', ON)).headers.get(ENFORCED);
  const page = await (await ask('/plain')).text();
  assert.equal(policy, [
    "default-src 'none'",
    `script-src 'self' ${sha(DECK_HEAD_JS)} ${sha(videoScript())} ${sha(bootScriptOf(page))} 'unsafe-hashes' ${sha(ICON_ONERROR)} ${sha(DECK_FILE_ONERROR)}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http:",
    "connect-src 'self'",
    "frame-src 'self' https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '));
  const d = directives(policy);
  for (const banned of ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", '*', 'https:', 'http:', 'data:', 'blob:']) assert.ok(!d['script-src'].includes(banned), `script-src holds ${banned}`);
  assert.ok(!d['script-src'].some((s) => s.startsWith("'nonce-")), 'a nonce in a cached page is one nonce for every visitor');
  assert.ok(!('frame-ancestors' in d) && !('report-uri' in d) && !('report-to' in d));
  assert.equal(pagePolicy(), "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; form-action 'none'");
});

// ── the static check ───────────────────────────────────────────────────────────────────────────
test('STATIC CHECK: every inline script, inline handler and address class of a page with every tile type fits its policy', async () => {
  for (const [path, settings] of [['/every', ON], ['/every?lang=ja', ON], ['/plain', ON], ['/hostile', ON], ['/long', ON], ['/long?w=2', ON], [`/_preview/${'c'.repeat(32)}`, ON],
    ['/embedded', ON], ['/onback', ON], [`/_preview/${'d'.repeat(32)}`, ON], [`/longembedded?w=${EMBED_WINDOW}`, ON], ['/prose', ON], ['/words?w=5', ON],
    ['/every', { ...ON, CARD_CANONICAL_HOST: 'reef.cards', CARDS_SERVICE_HOST: 'cards.feelreef.com' }]]) {
    const host = settings.CARD_CANONICAL_HOST ? 'https://reef.cards' : 'http://localhost';
    const r = await worker.fetch(new Request(`${host}${path}`, { redirect: 'manual' }), { CARDS: store(), ...settings });
    assert.equal(r.status, 200, path);
    const policy = r.headers.get(ENFORCED);
    assert.ok(policy, `${path}: no policy`);
    const page = await r.text();
    assert.deepEqual(refusals(page, policy), [], path);
    // the page did carry what the check is about
    assert.ok((page.match(/<script>/g) || []).length >= 2, `${path}: fewer than two inline scripts`);
    assert.ok(page.includes(` onerror="${DECK_FILE_ONERROR}"`), `${path}: the deck file's handler is not the one the policy hashes`);
  }
  const every = await (await ask('/every')).text();
  // the fixture reaches each thing the policy names: a mark with a handler, the video script, each picture class, a style of every kind
  assert.ok(every.includes(" onerror='"), 'no brand mark with a handler on the page');
  assert.ok(every.includes(videoScript()), 'no video script on the page');
  for (const needle of ['src="data:image/png', 'https://pictures.example/me.png', 'http://pictures.example/plain.jpg', 'src="/_icon/', 'src="/_yt/', 'url(', '<style id="cp-accent">', 'st-backdrop'])
    assert.ok(every.includes(needle), `the fixture page does not hold ${needle}`);
  const handlers = new Set([...every.matchAll(/\son[a-z]+=(?:"([^"]*)"|'([^']*)')/g)].map((m) => unescape(m[1] ?? m[2])));
  assert.deepEqual([...handlers].sort(), [...PAGE_HANDLERS].sort(), 'the page carries exactly the two handlers the policy knows');
});

test('CONTROL: the static check refuses a page with one script, one handler or one frame more than the renderer wrote', async () => {
  const page = await (await ask('/every')).text();
  const env = { ...ON };
  const policyOf = async (p) => (await pageCspHeaders(env, p))['Content-Security-Policy'];
  assert.deepEqual(refusals(page, await policyOf(page)), []);
  for (const [what, added, sentence] of [
    ['an inline script in the body', '<script>alert(1)</script>', /inline script "alert\(1\)"/],
    ['a script file from elsewhere', '<script src="https://evil.example/x.js"></script>', /script file https:\/\/evil\.example/],
    ['a handler', '<img src="/x" onerror="alert(1)">', /inline handler "alert\(1\)"/],
    ['a javascript: link', '<a href="javascript:alert(1)">x</a>', /javascript:/],
    ['a base', '<base href="https://evil.example/">', /a <base>/],
    ['a form', '<form action="https://evil.example/"></form>', /a <form>/],
    ['an object', '<object data="https://evil.example/x"></object>', /a <object>/],
    ['a frame from elsewhere', '<iframe src="https://evil.example/"></iframe>', /a frame https:\/\/evil\.example/],
    ['a srcdoc frame', '<iframe sandbox="allow-scripts" srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>', /a srcdoc frame/],
  ]) {
    const tampered = page.replace('<main', `${added}<main`);
    assert.notEqual(tampered, page, what);
    const bad = refusals(tampered, await policyOf(tampered));
    assert.ok(bad.some((s) => sentence.test(s)), `${what}: not refused (${JSON.stringify(bad)})`);
  }
  // a script written where the boot line stands is not taken for the boot line
  const at = page.lastIndexOf(`<script src="${DECK_JS_PATH}"`);
  const beside = `${page.slice(0, at)}<script>alert(1)</script>${page.slice(at)}`;
  assert.equal(bootScriptOf(beside), null);
  assert.ok(refusals(beside, await policyOf(beside)).some((s) => /alert\(1\)/.test(s)));
});

// ── the boot line ──────────────────────────────────────────────────────────────────────────────
test('the boot line is read by position, and only as data', async () => {
  for (const path of ['/every', '/plain', '/hostile', '/every?lang=ja', '/long?w=2']) {
    const page = await (await ask(path)).text();
    const boot = bootScriptOf(page);
    assert.ok(boot, `${path}: no boot line`);
    assert.ok(page.endsWith(`<script>${boot}</script><script src="${DECK_JS_PATH}" onerror="${DECK_FILE_ONERROR}"></script></body></html>`), path);
    assert.ok(boot.startsWith('window.__cardFront='), path);
  }
  // what a person aims at it stays inside a string
  const hostile = bootScriptOf(await (await ask('/hostile')).text());
  const front = JSON.parse(/^window\.__cardFront=("(?:[^"\\]|\\.)*");/.exec(hostile)[1]);
  assert.ok(front.includes('</script><script>alert(4)//') && front.includes('alert(3)'), 'the hostile values are in the fence, as text');
  assert.ok(!hostile.includes('<'));

  assert.equal(isBootData('window.__a="x";'), true);
  assert.equal(isBootData('window.__a="x";window.__b={"k":["v",1,true,null,{"q":"}\\"];"}]};window.__c=false;'), true);
  for (const code of ['', 'alert(1)', 'window.__a="x";alert(1);', 'window.__a="x"', 'window.__a="x";;', 'window.__a=alert(1);', 'window.__a="x"+alert(1);', 'window.__a={"k":alert(1)};',
    'window.__a=[alert(1)];', 'window.__a="x";\nalert(1);', 'window.a="x";', 'window.__a="x";//', 'window.__a="</script>";', 'window.__a=`x`;', "window.__a='x';", 'window.__a=function(){};',
    'window.__a={k:1};', 'window.__a="x\n";', 'window.__a=1;window.__proto__.x=1;', 'top.__a="x";', 'window.__a="x";window.__b=', 'window.__a="\\";alert(1);//";alert(2);']) {
    assert.equal(isBootData(code), false, `taken for data: ${JSON.stringify(code)}`);
  }
  // a breakout from the boot line's own string would be code in the boot line: it is not hashed
  const page = await (await ask('/plain')).text();
  const boot = bootScriptOf(page);
  const broken = page.replace(`<script>${boot}</script>`, () => `<script>${boot.replace('window.__cardFront="', 'window.__cardFront="";fetch("//evil.example");"')}</script>`);
  assert.notEqual(broken, page);
  assert.equal(bootScriptOf(broken), null);
  const policy = (await pageCspHeaders(ON, broken))['Content-Security-Policy'];
  assert.ok(refusals(broken, policy).some((s) => /inline script "window\.__cardFront=\\"\\";fetch/.test(s)), 'the broken boot line is refused');
  // a page that does not end as withDeck ends one has no boot line
  assert.equal(bootScriptOf('<script>window.__a="x";</script></body></html>'), null);
  assert.equal(bootScriptOf(`${page}<!-- -->`), null);
  assert.equal(bootScriptOf(''), null);
});

test('with the service on its own host the re-addressed boot line is the one hashed', async () => {
  const env = { CARDS: store(), ...ON, CARD_CANONICAL_HOST: 'reef.cards', CARDS_SERVICE_HOST: 'cards.feelreef.com' };
  const r = await worker.fetch(new Request('https://reef.cards/plain'), env);
  const policy = r.headers.get(ENFORCED);
  const page = await r.text();
  const boot = bootScriptOf(page);
  assert.ok(boot.includes('window.__deckTry="https://cards.feelreef.com/try/edit";'));
  assert.ok(directives(policy)['script-src'].includes(sha(boot)));
});

test('the renderer\'s own scripts are read from the renderer, and the after-paint script follows its prefix', async () => {
  assert.ok(videoScript().includes('youtube-nocookie.com/embed/'));
  assert.equal(pictureScript(''), null);
  assert.equal(pictureScript('/x/a/"]);alert(1)//'), null, 'a prefix the renderer would refuse writes no script');
  const page = renderCardHTML(PLAIN, { handle: 'plain', cardUrl: 'https://card.feelreef.com/plain', pictures: { afterPaint: '/plain/a/' } });
  assert.ok(page.includes(`<script>${pictureScript('/plain/a/')}</script>`), 'the script the renderer wrote is the one this module expects');
  const without = (await pageCspHeaders(ON, page))['Content-Security-Policy'];
  assert.ok(refusals(page, without).some((s) => /inline script "addEventListener/.test(s)), 'CONTROL: without the prefix the after-paint script is not in the policy');
  const policy = (await pageCspHeaders(ON, page, { afterPaint: '/plain/a/' }))['Content-Security-Policy'];
  assert.deepEqual(refusals(page, policy), []);
  assert.equal(await hashSource('x'), sha('x'));
});

// a real PNG past the inline threshold (asset-urls.mjs INLINE_MAX_BYTES): rows of bytes that do not compress
const bigPng = (seed) => {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const w = 32, h = 32;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + 3 * w));
  let x = seed;
  for (let i = 0; i < raw.length; i += 1) { x = (x * 1103515245 + 12345) >>> 0; raw[i] = i % (1 + 3 * w) === 0 ? 0 : x >>> 24; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
test('the local picture switch: a page whose pictures travel by address still fits its policy, in every strategy', async () => {
  // four pictures of the file's own, past the inline threshold: the first screen takes two, the rest go by address
  const pics = [1, 2, 3, 4].map((i) => ({ id: `pic${i}`, b: bigPng(i) }));
  assert.ok(pics.every((p) => p.b.length > 1024), 'the pictures are past the inline threshold');
  const withAssets = `${EVERY_TILE.replace(`img=${PNG}`, 'img=asset:pic1').replace('## back: about',
    '- [ ] %% card: feature w=6 img=asset:pic2 %% Two.\n- [ ] %% card: feature w=6 img=asset:pic3 %% Three.\n- [ ] %% card: feature w=6 img=asset:pic4 %% Four.\n\n## back: about')}\n## assets\n\n${pics.map((p) => `- [ ] %% card: asset id=${p.id} mime=image/png %% ${p.b.toString('base64')}`).join('\n')}\n`;
  assert.equal(parseCard(withAssets).assets.pic4 != null, true, 'the assets lane parses');
  const seen = [];
  for (const mode of PICTURE_STRATEGIES) {
    const env = { CARDS: { ...store(), get: async (k) => (k === 'every' ? withAssets : CARDS[k] ?? null) }, ...ON, CARDTILE_PICTURES: mode };
    const r = await worker.fetch(new Request('http://localhost/every'), env);
    const page = await r.text();
    assert.equal(r.status, 200, mode);
    const policy = r.headers.get(ENFORCED);
    assert.deepEqual(refusals(page, policy), [], `CARDTILE_PICTURES=${mode}`);
    const byAddress = (page.match(/\/every\/a\/[0-9a-f]{64}\.png/g) || []).length;
    const afterPaint = pictureScript('/every/a/');
    // the switch did switch: by address for every strategy but inline, and the after-paint script exactly where asked
    if (mode === 'inline') assert.equal(byAddress, 0, mode);
    else assert.ok(byAddress > 0, `${mode}: no picture by address`);
    assert.equal(page.includes(`<script>${afterPaint}</script>`), mode.endsWith('-after-paint'), `${mode}: the after-paint script`);
    if (mode.endsWith('-after-paint')) assert.ok(directives(policy)['script-src'].includes(sha(afterPaint)), `${mode}: the after-paint script is not in the policy`);
    seen.push(`${mode}:${byAddress}`);
  }
  console.log(`# picture switch: ${seen.join(' ')}`);
});

// ── the embed ──────────────────────────────────────────────────────────────────────────────────
test('the policy is on EVERY person\'s page and preview, whatever it holds (r1: an embed, the word "embed", a window)', async () => {
  const words = Math.ceil((ON_DEMAND_TILES + 5) / WINDOW_TILES);
  const longEmbedded = Array.from({ length: EMBED_WINDOW }, (_, i) => `/longembedded?w=${i + 1}`);
  const prose = Array.from({ length: Math.ceil((ON_DEMAND_TILES + 1) / WINDOW_TILES) }, (_, i) => `/prose?w=${i + 1}`);
  const paths = ['/embedded', '/onback', `/_preview/${'d'.repeat(32)}`, '/longembedded', ...longEmbedded, '/prose', ...prose,
    '/words', ...Array.from({ length: words }, (_, i) => `/words?w=${i + 1}`)];
  let sent = 0;
  for (const path of paths) {
    const plain = (await ask('/plain', ON)).headers.get(ENFORCED);
    for (const stage of ['report-only', 'enforce']) {
      const r = await ask(path, { CARDS_PAGE_CSP: stage });
      assert.equal(r.status, 200, path);
      const policy = r.headers.get(pageCspHeaderName(stage));
      assert.ok(policy, `${path} ${stage}: no policy`);
      // the same policy as any page, but for the page's own boot line
      const strip = (p) => p.replace(/'sha256-[^']*'/g, 'H');
      assert.equal(strip(policy), strip(plain), `${path} ${stage}: not the policy every page gets`);
      sent += 1;
    }
  }
  console.log(`# cardtile page csp: ${sent} answers of ${paths.length} pages with an embed or the word, all with the policy`);
  // the review's exact case: a file served in windows whose title says "embed", and no frame anywhere
  assert.ok(CARDS.prose.includes('title: How to embed a video'));
  assert.ok(!(await (await ask('/prose', ON)).text()).includes('<iframe'));
});

test('r1 (third review): ` srcdoc="` in an injected payload does not take the policy away, and the injected script is refused', async () => {
  const page = await (await ask('/plain')).text();
  const tampered = page.replace('<main', '<script>alert(1)</script><!-- srcdoc=" --><main');
  assert.notEqual(tampered, page);
  const headers = await pageCspHeaders(ON, tampered);
  assert.ok(headers['Content-Security-Policy'], 'no policy for a page holding the string');
  assert.ok(refusals(tampered, headers['Content-Security-Policy']).some((s) => /inline script "alert\(1\)"/.test(s)));
  // …and a frame an escaping bug writes is not an embed: it is left as it is, and inherits the policy
  const forged = page.replace('<main', '<iframe sandbox="allow-scripts" srcdoc="&lt;script&gt;parent.x=1&lt;/script&gt;"></iframe><main');
  const docs = await embedDocuments(parseCard(PLAIN), () => '');
  assert.equal(framesAsDocuments(forged, docs, '/plain/'), forged);
  assert.ok(refusals(forged, (await pageCspHeaders(ON, forged))['Content-Security-Policy']).some((s) => /srcdoc frame/.test(s)));
});

/** the frames of a page: [{ attrs, src, srcdoc }] */
const framesOf = (page) => [...page.matchAll(/<iframe\b([^>]*)>/g)].map((m) => ({ attrs: m[1], src: (/\ssrc="([^"]*)"/.exec(m[1]) || [])[1], srcdoc: (/\ssrcdoc="([^"]*)"/.exec(m[1]) || [])[1] }));
const fromSrcdoc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const EMBED_HEADERS = [['cache-control', 'public, max-age=60'], ['content-security-policy', EMBED_DOCUMENT_POLICY], ['content-type', 'text/html; charset=utf-8'],
  ['cross-origin-resource-policy', 'same-origin'], ['x-content-type-options', 'nosniff'], ['x-robots-tag', 'noindex']];

test('setting on: an embed is its own document — same sandbox, a same-origin address, exactly the srcdoc\'s document, its own policy', async () => {
  assert.equal(EMBED_DOCUMENT_POLICY, "sandbox allow-scripts; frame-ancestors 'self'");
  for (const [path, base, query] of [['/embedded', '/embedded/', ''], ['/onback', '/onback/', ''], [`/_preview/${'d'.repeat(32)}`, `/_preview/${'d'.repeat(32)}/`, ''],
    [`/longembedded?w=${EMBED_WINDOW}`, '/longembedded/', `?w=${EMBED_WINDOW}`]]) {
    const off = await (await ask(path)).text();
    const offFrames = framesOf(off);
    assert.equal(offFrames.length, 1, `${path}: the fixture holds one embed`);
    assert.ok(offFrames[0].srcdoc && !offFrames[0].src, `${path}: off, the embed is a srcdoc frame`);
    assert.ok(!off.includes('/_embed/'), `${path}: off, no embed address`);
    for (const stage of ['report-only', 'enforce']) {
      const r = await ask(path, { CARDS_PAGE_CSP: stage });
      const on = await r.text();
      const [f] = framesOf(on);
      assert.match(f.src, new RegExp(`^${base.replace(/[/.?]/g, '\\$&')}_embed/[0-9a-f]{64}${query.replace('?', '\\?')}$`), `${path} ${stage}: ${f.src}`);
      assert.equal(f.srcdoc, undefined);
      assert.match(f.attrs, /^ sandbox="allow-scripts" src="/, `${path}: the sandbox is the one token, as before`);
      assert.ok(!/allow-same-origin/.test(on));
      // every other byte of the page is the page served with the setting off
      assert.equal(on, off.replace(` srcdoc="${offFrames[0].srcdoc}"`, ` src="${f.src}"`), `${path} ${stage}: the page changed elsewhere`);
      // the address answers with exactly the document the srcdoc held, under its own policy
      const doc = await ask(f.src, { CARDS_PAGE_CSP: stage });
      assert.equal(doc.status, 200, `${path} ${stage}: ${f.src}`);
      assert.equal(await doc.text(), fromSrcdoc(offFrames[0].srcdoc), `${path} ${stage}: not the srcdoc's document`);
      const preview = path.startsWith('/_preview/');
      assert.deepEqual([...doc.headers], preview
        ? EMBED_HEADERS.map(([k, v]) => [k, k === 'cache-control' ? 'no-store' : k === 'x-robots-tag' ? 'noindex, nofollow' : v])
        : EMBED_HEADERS, `${path}: the embed document's headers`);
      const head = await ask(f.src, { CARDS_PAGE_CSP: stage }, { method: 'HEAD' });
      assert.equal(head.status, 200);
    }
  }
});

test('setting on, a person\'s own domain and the root card: the address is under the page\'s own base, and answers there', async () => {
  const seed = { aster: WITH_EMBED, 'vanity:own.example': 'aster', 'vanityof:aster:0': 'own.example', 'vanitybind:aster:0:own.example': '1' };
  const env = { CARDS: { get: async (k) => seed[k] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } }, ...ON, PREVIEW: 'false' };
  const page = await (await worker.fetch(new Request('https://own.example/'), env)).text();
  const [f] = framesOf(page);
  assert.match(f.src, /^\/_embed\/[0-9a-f]{64}$/);
  const doc = await worker.fetch(new Request(`https://own.example${f.src}`), env);
  assert.equal(doc.status, 200);
  assert.equal(doc.headers.get('content-security-policy'), EMBED_DOCUMENT_POLICY);
  // the same document under /<handle>/ on the domain (the root card's spelling) answers too
  assert.equal((await worker.fetch(new Request(`https://own.example/aster${f.src}`), env)).status, 200);
});

test('the embed address cannot be made to answer with anything but an embed tile of the file it names', async () => {
  const src = framesOf(await (await ask('/embedded', ON)).text())[0].src;
  const theirs = framesOf(await (await ask('/other', ON)).text())[0].src;
  const unknown = await ask('/embedded/nope', ON);
  const unknownBody = await unknown.text();
  const missOn = async (path, why) => {
    const r = await ask(path, ON);
    assert.equal(r.status, unknown.status, `${why}: ${path}`);
    assert.deepEqual([...r.headers], [...unknown.headers], `${why}: ${path}`);
    assert.equal(await r.text(), unknownBody, `${why}: ${path}`);
  };
  const hexOf = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
  await missOn(theirs.replace('/other/', '/embedded/'), 'somebody else\'s embed under this handle');
  await missOn(`/embedded/_embed/${hexOf('<script>alert(1)</script>')}`, 'arbitrary HTML');
  await missOn(`/embedded/_embed/${hexOf(await (await ask('/embedded')).text())}`, 'the page itself');
  await missOn(`/plain/_embed/${src.split('/').pop()}`, 'this embed under a handle that has none');
  await missOn(`/nobody/_embed/${src.split('/').pop()}`, 'a handle with no file');
  await missOn(src.toUpperCase().replace('/EMBEDDED/_EMBED/', '/embedded/_embed/'), 'an upper-case hash');
  await missOn(`${src}/`, 'a trailing slash');
  // the word "embed", a link address and an `embed kind=slider` are no embed tile: no frame, no document
  assert.deepEqual(await embedDocuments(parseCard(wordsNamingEmbed(ON_DEMAND_TILES + 5)), () => ''), []);
  // a window that does not hold the embed does not answer for it, nor does a window that does not exist
  const longSrc = framesOf(await (await ask(`/longembedded?w=${EMBED_WINDOW}`, ON)).text())[0].src;
  assert.equal((await ask(longSrc, ON)).status, 200);
  for (const q of ['', '?w=1', `?w=${EMBED_WINDOW + 1}`, '?w=0', '?w=x']) {
    const r = await ask(longSrc.replace(/\?.*$/, '') + q, ON);
    assert.notEqual(r.status, 200, `the long file's embed answered at ${q || 'no window'}`);
  }
  // a preview's embed: under its own preview only
  const pv = framesOf(await (await ask(`/_preview/${'d'.repeat(32)}`, ON)).text())[0].src;
  assert.equal((await ask(pv, ON)).status, 200);
  for (const p of [pv.replace('d'.repeat(32), 'c'.repeat(32)), pv.replace('d'.repeat(32), 'e'.repeat(32)), pv.replace(/[0-9a-f]{64}$/, '0'.repeat(64))]) {
    const r = await ask(p, ON);
    assert.equal(r.status, 404, p);
    assert.equal(await r.text(), '', p);
  }
});

test('setting off: the embed address is an unknown path, answer for answer (status, headers, body, store reads) on every stage and host', async () => {
  const hex = 'a'.repeat(64);
  const pairs = [[`/aster/_embed/${hex}`, `/aster/_embee/${hex}`], [`/_embed/${hex}`, `/_embee/${hex}`], [`/aster/_embed/${hex}?w=1`, `/aster/_embee/${hex}?w=1`],
    [`/_preview/${GRID_PREVIEW}/_embed/${hex}`, `/_preview/${GRID_PREVIEW}/_embee/${hex}`], [`/feelreef/_embed/${hex}`, `/feelreef/_embee/${hex}`]];
  let compared = 0;
  const bad = [];
  await atFixedClock(async () => {
    for (const stage of Object.keys(GRID_STAGES)) for (const host of GRID_HOSTS) for (const [path, sibling] of pairs) for (const init of [{}, { method: 'HEAD' }, { method: 'POST', body: 'x' }]) {
      for (const extra of [{}, { CARDS_PAGE_CSP: 'off' }, { CARDS_PAGE_CSP: 'Enforce' }]) {
        const got = await answerOf(worker, { stage, host, path, init }, extra);
        const asked = await answerOf(worker, { stage, host, path: sibling, init }, extra);
        // a redirect names the path it was asked: that one header is the sibling's path, and is read as ours
        const want = { ...asked, headers: asked.headers.map(([k, v]) => [k, k === 'location' ? v.replace('/_embee/', '/_embed/') : v]) };
        const d = answerDiff(got, want);
        if (d) bad.push(`${stage} ${host} ${init.method || 'GET'} ${path}: ${d}`);
        compared += 1;
      }
    }
  });
  console.log(`# cardtile page csp off: ${compared} embed addresses compared with an unknown path, ${bad.length} mismatches`);
  assert.deepEqual(bad, []);
  // and a page with an embed is the srcdoc page
  const off = await (await ask('/embedded')).text();
  assert.ok(/<iframe sandbox="allow-scripts" srcdoc="/.test(off) && !off.includes('/_embed/'));
});

test('r1: the boot line under the review\'s adversarial values — hashed, and running it runs nothing but data', async () => {
  const payloads = ['";globalThis.__pwn=1;//', '</script><script>globalThis.__pwn=2</script>', '\u2028globalThis.__pwn=3\u2029', '\\u0022;globalThis.__pwn=4;//', '\\u003c/script\\u003e',
    '\\\\";globalThis.__pwn=5;//', '\u0000\r', 'a'.repeat(200000), '\ud800', '"};window.__x={"__proto__":{"pwn":1}};//'];
  for (const [i, v] of payloads.entries()) {
    const md = `---\nview: stack\nback: ${v}\n---\n\n## grid\n\n- [ ] %% card: text %% safe\n`;
    const r = await worker.fetch(new Request('http://localhost/attack'), { CARDS: { get: async (k) => (k === 'attack' ? md : null), async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } }, ...ON });
    const page = await r.text();
    const boot = bootScriptOf(page);
    assert.ok(boot, `payload ${i}: no boot line`);
    assert.ok(directives(r.headers.get(ENFORCED))['script-src'].includes(sha(boot)), `payload ${i}: the boot line is not hashed`);
    const ctx = { window: {} };
    vm.runInNewContext(boot, ctx, { timeout: 1000 });
    assert.equal(ctx.__pwn, undefined, `payload ${i}`);
    assert.ok(!('pwn' in Object.getPrototypeOf(ctx.window)), `payload ${i}`);
    assert.deepEqual(refusals(page, r.headers.get(ENFORCED)), [], `payload ${i}`);
  }
  for (const [code, data] of [['window.__x="";alert(1);', false], ['window.__x={"x":(alert(1))};', false], ['window.__x="\\u0022;alert(1);//";', true], ['window.__proto__={};', false]]) {
    assert.equal(isBootData(code), data, code);
  }
});

// ── where it is NOT sent ───────────────────────────────────────────────────────────────────────
test('only a person\'s page and a preview: not the editor, the API, the report page, the nothing-here page, the .md exits, pictures or the deck\'s files', async () => {
  const split = { CARD_CANONICAL_HOST: 'reef.cards', PREVIEW: 'false' };
  const own = [];
  for (const [host, path, settings, init] of [
    ['localhost', '/try/edit', {}], ['localhost', '/edit?host=https://feelreef.com', {}], ['localhost', '/nope', {}], ['localhost', '/', {}],
    ['localhost', '/every.md', {}], ['localhost', '/every', {}, { headers: { accept: 'text/markdown' } }], ['localhost', '/every/avatar', {}], ['localhost', '/every/favicon.ico', {}],
    ['localhost', DECK_JS_PATH, {}], ['localhost', DECK_JS_PATH.replace(/\.js$/, '.css'), {}], ['localhost', '/_api/card/every', {}], ['localhost', '/.well-known/security.txt', {}],
    ['reef.cards', '/report', split], ['reef.cards', '/nope', split], ['unbound.example', '/', {}],
  ]) {
    const scheme = host === 'localhost' ? 'http' : 'https';
    const off = await worker.fetch(new Request(`${scheme}://${host}${path}`, init), { CARDS: store(), ...settings });
    for (const stage of ['report-only', 'enforce']) {
      const r = await worker.fetch(new Request(`${scheme}://${host}${path}`, init), { CARDS: store(), ...settings, CARDS_PAGE_CSP: stage });
      assert.equal(r.status, off.status, `${host}${path}`);
      assert.deepEqual([...r.headers], [...off.headers], `${host}${path} ${stage}: the setting changed this answer's headers`);
      assert.equal(r.headers.get(REPORTED), null, `${host}${path}`);
    }
    if (off.headers.get(ENFORCED)) own.push(`${host}${path}`);
  }
  // the two pages with a policy of their own keep exactly theirs
  assert.deepEqual(own, ['localhost/edit?host=https://feelreef.com', 'reef.cards/report']);
});

// ── off is the before-fixture; on adds a header and nothing else ───────────────────────────────
const FIXTURE = readFixture();
const CASES = gridCases();
test('off values: all 714 answers of the before-fixture, byte for byte, headers and store reads included', async () => {
  for (const [name, extra] of [['unset', {}], ['empty', { CARDS_PAGE_CSP: '' }], ['"off"', { CARDS_PAGE_CSP: 'off' }], ['"1"', { CARDS_PAGE_CSP: '1' }], ['"true"', { CARDS_PAGE_CSP: 'true' }],
    ['another case', { CARDS_PAGE_CSP: 'Enforce' }], ['a trailing space', { CARDS_PAGE_CSP: 'report-only ' }], ['a typo', { CARDS_PAGE_CSP: 'reportonly' }]]) {
    const bad = [];
    await atFixedClock(async () => {
      for (const c of CASES) { const d = answerDiff(await answerOf(worker, c, extra), FIXTURE.answers[c.key]); if (d) bad.push(`${c.key}: ${d}`); }
    });
    console.log(`# cardtile page csp ${name}: ${CASES.length} answers compared, ${bad.length} mismatches`);
    assert.deepEqual(bad, [], name);
  }
});

test('on: of the same 714, only people\'s pages and the preview change, and only by the one header', async () => {
  for (const stage of ['report-only', 'enforce']) {
    const header = pageCspHeaderName(stage).toLowerCase();
    const changed = [];
    await atFixedClock(async () => {
      for (const c of CASES) {
        const got = await answerOf(worker, c, { CARDS_PAGE_CSP: stage });
        const want = FIXTURE.answers[c.key];
        const added = got.headers.filter(([k]) => k === header);
        const rest = { ...got, headers: got.headers.filter(([k]) => k !== header) };
        // the report page and host mode have a policy of their own in the fixture: that one is not ours
        const theirs = want.headers.some(([k]) => k === header);
        assert.equal(answerDiff(theirs ? got : rest, want), '', `${stage} ${c.key}`);
        if (added.length && !theirs) {
          assert.equal(added.length, 1);
          assert.equal(got.status, 200, c.key);
          assert.ok(got.headers.some(([k, v]) => k === 'content-type' && v === 'text/html; charset=utf-8'), c.key);
          changed.push(c.key);
        }
      }
    });
    const paths = [...new Set(changed.map((k) => k.split(' ').slice(2).join(' ')))].sort();
    console.log(`# cardtile page csp ${stage}: ${changed.length} of ${CASES.length} answers carry the header; requests: ${paths.join(' | ')}`);
    assert.ok(changed.length > 0);
    for (const p of paths) assert.match(p, /^(GET|HEAD) \/(\?lang=ja|\?ref=aster|aster|aster\?utm=qr|feelreef|_preview\/b{32})?$/, `an answer that is not a person's page carries the header: ${p}`);
  }
});
