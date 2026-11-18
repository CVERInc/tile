// The Content-Security-Policy of a person's page (cardtile-page-csp.mjs), asked of the cardtile worker.
//
// What is proved here, without a browser:
//   · the setting: exactly "report-only" or "enforce" is on; unset and everything else is off, and
//     off is the committed before-fixture's 714 answers, byte for byte (service-host-off fixture);
//   · on, only a header is added: every body, status and store read of the same 714 is unchanged;
//   · the STATIC CHECK: on a page holding every tile type, every inline script and every inline
//     event handler the page carries is in the policy by hash, and every address class the page
//     loads from is allowed — and the same check FAILS on a page with one script added;
//   · a page that carries an embed gets no policy (a srcdoc frame inherits its parent's policy);
//   · the setting leaves every other answer alone, the `.md` exits included (their nosniff is
//     cardtile-md-nosniff.test.mjs, and does not depend on this setting).
// What a browser does with the policy is verify/page-csp.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import worker, { renderCardHTML } from './card-worker.mjs';
import { gridCases, answerOf, answerDiff, atFixedClock, readFixture } from './gen-service-host-off-fixture.mjs';
import { pageCspStage, pageCspHeaderName, pagePolicy, pageCspHeaders, bootScriptOf, isBootData, carriesEmbed, fileNamesEmbed,
  videoScript, pictureScript, hashSource, PAGE_HANDLERS, DECK_FILE_ONERROR, ICON_ONERROR, PAGE_CSP_STAGES } from './cardtile-page-csp.mjs';
import { DECK_HEAD_JS, DECK_JS_PATH } from '../w3/deck-page.mjs';
import { ON_DEMAND_TILES } from './size-tier.mjs';
import { PNG, EVERY_TILE, PLAIN, WITH_EMBED, HOSTILE_FRONT, long } from './cardtile-page-csp-fixtures.mjs';

const ENFORCED = 'content-security-policy';
const REPORTED = 'content-security-policy-report-only';

const CARDS = { every: EVERY_TILE, plain: PLAIN, embedded: WITH_EMBED, hostile: HOSTILE_FRONT,
  long: long(ON_DEMAND_TILES + 40), longembedded: long(ON_DEMAND_TILES + 40, '- [ ] %% card: embed w=6 %% <script>1</script>\n'),
  [`_preview:${'c'.repeat(32)}`]: EVERY_TILE, [`_preview:${'d'.repeat(32)}`]: WITH_EMBED };
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
  for (const tag of ['form', 'base', 'object', 'embed', 'iframe', 'video', 'audio', 'source']) if (new RegExp(`<${tag}\\b`).test(page)) out.push(`a <${tag}>`);
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
    'frame-src https://www.youtube-nocookie.com',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '));
  const d = directives(policy);
  for (const banned of ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", '*', 'https:', 'http:', 'data:', 'blob:']) assert.ok(!d['script-src'].includes(banned), `script-src holds ${banned}`);
  assert.ok(!d['script-src'].some((s) => s.startsWith("'nonce-")), 'a nonce in a cached page is one nonce for every visitor');
  assert.ok(!('frame-ancestors' in d) && !('report-uri' in d) && !('report-to' in d));
  assert.equal(pagePolicy(), "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; form-action 'none'");
});

// ── the static check ───────────────────────────────────────────────────────────────────────────
test('STATIC CHECK: every inline script, inline handler and address class of a page with every tile type fits its policy', async () => {
  for (const [path, settings] of [['/every', ON], ['/every?lang=ja', ON], ['/plain', ON], ['/hostile', ON], ['/long', ON], ['/long?w=2', ON], [`/_preview/${'c'.repeat(32)}`, ON],
    ['/every', { ...ON, CARD_CANONICAL_HOST: 'reef.cards', CARDS_SERVICE_HOST: 'cards.feelreef.com' }]]) {
    const host = settings.CARD_CANONICAL_HOST ? 'https://reef.cards' : 'http://localhost';
    const r = await worker.fetch(new Request(`${host}${path}`, { redirect: 'manual' }), { CARDS: store(), ...settings });
    assert.equal(r.status, 200, path);
    const policy = r.headers.get(ENFORCED);
    assert.ok(policy, `${path}: no policy`);
    const page = await r.text();
    assert.deepEqual(refusals(page, policy).filter((x) => !/^a <(iframe)>/.test(x)), [], path);
    assert.ok(!/<iframe\b/.test(page), `${path}: a frame in a page that should have none`);
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

test('the local picture switch: a page whose pictures travel by address still fits its policy', async () => {
  const withAsset = `${EVERY_TILE.replace(PNG, 'asset:pic')}\n\n## assets\n\n- pic: ${PNG}\n`;
  for (const mode of ['hybrid', 'urls', 'all', 'after-paint', '1']) {
    const env = { CARDS: { ...store(), get: async (k) => (k === 'every' ? withAsset : CARDS[k] ?? null) }, ...ON, CARDS_PICTURES: mode };
    const r = await worker.fetch(new Request('http://localhost/every'), env);
    const page = await r.text();
    assert.equal(r.status, 200);
    assert.deepEqual(refusals(page, r.headers.get(ENFORCED)), [], `CARDS_PICTURES=${mode}`);
  }
});

// ── the embed ──────────────────────────────────────────────────────────────────────────────────
test('a page that carries an embed gets no policy in either stage, and is the page it was', async () => {
  for (const path of ['/embedded', `/_preview/${'d'.repeat(32)}`, '/longembedded', '/longembedded?w=2']) {
    const off = await ask(path);
    for (const stage of ['report-only', 'enforce']) {
      const r = await ask(path, { CARDS_PAGE_CSP: stage });
      assert.equal(r.status, 200, path);
      assert.equal(r.headers.get(ENFORCED), null, `${path} ${stage}`);
      assert.equal(r.headers.get(REPORTED), null, `${path} ${stage}`);
      assert.deepEqual([...r.headers], [...off.headers], `${path} ${stage}: the headers differ from off`);
    }
  }
  const page = await (await ask('/embedded')).text();
  assert.ok(/<iframe sandbox="allow-scripts" srcdoc="/.test(page), 'the embed is still a sandboxed srcdoc frame');
  assert.equal(carriesEmbed(page), true);
  // the first window of the long file holds no frame itself: the file is what says so
  const first = await (await ask('/longembedded')).text();
  assert.equal(carriesEmbed(first), false, 'the fixture\'s embed must be in a later window');
  assert.equal(fileNamesEmbed(CARDS.longembedded), true);
  assert.equal(carriesEmbed(await (await ask('/every')).text()), false);
  assert.equal(fileNamesEmbed(CARDS.long), false);
  // CONTROL: the same long file without the embed does get the policy on its first window
  assert.ok((await ask('/long', ON)).headers.get(ENFORCED));
  assert.deepEqual(await pageCspHeaders(ON, page), {});
  assert.deepEqual(await pageCspHeaders({ CARDS_PAGE_CSP: 'report-only' }, first, { windowedFile: CARDS.longembedded }), {});
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
