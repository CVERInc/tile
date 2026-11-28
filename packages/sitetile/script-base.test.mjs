// The script base: the one origin a site may be told to load the renderer's own scripts from.
//   run: node packages/sitetile/script-base.test.mjs   (globbed into scripts/test.sh)
//
// `SCRIPT_BASE` decides which origin a page's scripts come from, so its reader is security code and
// this file is its specification:
//   1. unset or empty means OFF, and nothing else does;
//   2. the accepted values are exactly `https://<host>/corals` — each one comes back byte for byte,
//      and the WHATWG URL parser agrees with every byte of it;
//   3. every other value THROWS, naming the setting and the reason (a typo must stop the build, not
//      ship a site whose scripts a policy then blocks);
//   4. `new URL()` would have accepted most of those refused values, and quietly turned them into
//      something else — that table is pinned here so nobody "simplifies" the reader into it;
//   5. `runtimeSrc` cannot be made to name a URL outside the base;
//   6. a build with a bad value fails before it writes a page (needs the renderer's dependencies).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCRIPT_BASE_ENV, SCRIPT_BASE_GRAMMAR, RUNTIME_ID, ScriptBaseError,
  parseScriptBase, scriptBase, runtimeSrc,
} from './astro/src/lib/script-base.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASTRO = join(HERE, 'astro');
const GOOD = 'https://scripts.example.net/corals';

/** Asserts that `raw` is refused for `reason`, by an error that names the setting. */
function refused(raw, reason, parse = parseScriptBase) {
  let err = null;
  try { parse(raw); } catch (e) { err = e; }
  assert.ok(err, `accepted ${JSON.stringify(raw)}`);
  assert.ok(err instanceof ScriptBaseError, `threw something else for ${JSON.stringify(raw)}: ${err}`);
  assert.equal(err.reason, reason, `${JSON.stringify(raw)} was refused as "${err.reason}": ${err.message}`);
  assert.ok(err.message.includes(SCRIPT_BASE_ENV), `the message does not name the setting: ${err.message}`);
  assert.ok(err.message.length > SCRIPT_BASE_ENV.length + 20, `the message gives no reason: ${err.message}`);
  // What a build log shows must be printable: the refused value is quoted, never echoed raw.
  assert.ok(/^[\x20-\x7e]+$/.test(err.message), `the message is not plain printable ASCII: ${JSON.stringify(err.message)}`);
  return err;
}

test('the setting is the environment variable SCRIPT_BASE', () => {
  assert.equal(SCRIPT_BASE_ENV, 'SCRIPT_BASE');
  assert.equal(RUNTIME_ID, 'site-runtime');
});

test('unset or empty means off — and only those do', () => {
  assert.equal(parseScriptBase(undefined), '');
  assert.equal(parseScriptBase(''), '');
  assert.equal(scriptBase({}), '');
  assert.equal(scriptBase({ SCRIPT_BASE: '' }), '');
  // Things a shell or a config layer writes when it means "nothing" are NOT nothing here.
  for (const raw of [' ', '\t', '\n', '0', 'off', 'false', 'no', 'null', 'undefined', 'none', '-']) {
    assert.throws(() => parseScriptBase(raw), ScriptBaseError, `${JSON.stringify(raw)} was read as off`);
  }
  refused(null, 'not-a-string');
  refused(0, 'not-a-string');
  refused(false, 'not-a-string');
  refused(['https://scripts.example.net/corals'], 'not-a-string');
  refused({ toString: () => GOOD }, 'not-a-string');
  refused(new String(GOOD), 'not-a-string');
});

test('valid values come back byte for byte, and the URL parser agrees with every byte', () => {
  const valid = [
    GOOD,
    'https://example.net/corals',
    'https://a.b.c.d.example.net/corals',
    'https://scripts-2.example.net/corals',
    'https://abc--d.example.net/corals',
    'https://a-b-c.example.net/corals',
    'https://0scripts.example.net/corals',
    'https://9.example.net/corals',
    'https://a.io/corals',
    'https://scripts.example.co1/corals',
    `https://${'a'.repeat(63)}.example.net/corals`,
    // 253 characters of host, the longest a name can be.
    `https://${[1, 2, 3].map(() => 'a'.repeat(63)).join('.')}.${'b'.repeat(57)}.net/corals`,
  ];
  for (const v of valid) {
    assert.equal(parseScriptBase(v), v);
    assert.equal(scriptBase({ SCRIPT_BASE: v }), v);
    const u = new URL(v);
    assert.equal(u.href, v, 'the URL parser rewrote an accepted value');
    assert.equal(u.origin, v.slice(0, -'/corals'.length));
    assert.equal(u.pathname, '/corals');
    assert.equal(u.port + u.username + u.password + u.search + u.hash, '');
  }
  assert.equal(valid.at(-1).length, 'https://'.length + 253 + '/corals'.length);
});

test('the grammar is one anchored expression, exported as it is used', () => {
  assert.ok(SCRIPT_BASE_GRAMMAR instanceof RegExp);
  assert.equal(SCRIPT_BASE_GRAMMAR.flags, '', 'no flags: not case-insensitive, not multiline, not sticky');
  assert.ok(SCRIPT_BASE_GRAMMAR.source.startsWith('^https:\\/\\/'), SCRIPT_BASE_GRAMMAR.source);
  assert.ok(SCRIPT_BASE_GRAMMAR.source.endsWith('\\/corals$'), SCRIPT_BASE_GRAMMAR.source);
  // `$` without the multiline flag still matches only at the very end — a trailing newline is not
  // forgiven the way it is in some other languages' regular expressions.
  assert.equal(SCRIPT_BASE_GRAMMAR.test(GOOD + '\n'), false);
});

// Every row: [value, reason]. One list, so "at least these" is visible in one place.
const INVALID = [
  // scheme
  ['http://scripts.example.net/corals', 'scheme'],
  ['HTTPS://scripts.example.net/corals', 'scheme'],
  ['Https://scripts.example.net/corals', 'scheme'],
  ['https:/scripts.example.net/corals', 'scheme'],
  ['https:scripts.example.net/corals', 'scheme'],
  ['https:///scripts.example.net/corals', 'empty-host'],
  ['//scripts.example.net/corals', 'scheme'],
  ['scripts.example.net/corals', 'scheme'],
  ['/corals', 'scheme'],
  ['ftp://scripts.example.net/corals', 'scheme'],
  ['wss://scripts.example.net/corals', 'scheme'],
  ['data:text/javascript,alert(1)', 'scheme'],
  ['javascript:alert(1)', 'scheme'],
  ['blob:https://scripts.example.net/corals', 'scheme'],
  ['https', 'scheme'],
  ['*', 'scheme'],
  // userinfo
  ['https://user@scripts.example.net/corals', 'userinfo'],
  ['https://user:secret@scripts.example.net/corals', 'userinfo'],
  ['https://scripts.example.net@other.example/corals', 'userinfo'],
  ['https://@scripts.example.net/corals', 'userinfo'],
  // port — including the default one, which the URL parser would silently drop
  ['https://scripts.example.net:443/corals', 'port'],
  ['https://scripts.example.net:8443/corals', 'port'],
  ['https://scripts.example.net:/corals', 'port'],
  ['https://scripts.example.net:0443/corals', 'port'],
  // query, fragment — including the empty ones
  ['https://scripts.example.net/corals?v=1', 'query'],
  ['https://scripts.example.net/corals?', 'query'],
  ['https://scripts.example.net?/corals', 'query'],
  ['https://scripts.example.net/corals#x', 'fragment'],
  ['https://scripts.example.net/corals#', 'fragment'],
  ['https://scripts.example.net#/corals', 'fragment'],
  // path: exactly /corals
  ['https://scripts.example.net/corals/', 'trailing-slash'],
  ['https://scripts.example.net/corals//', 'extra-path'],
  ['https://scripts.example.net/corals/site-runtime', 'extra-path'],
  ['https://scripts.example.net/corals/..', 'extra-path'],
  ['https://scripts.example.net/corals/../corals', 'extra-path'],
  ['https://scripts.example.net', 'wrong-prefix'],
  ['https://scripts.example.net/', 'wrong-prefix'],
  ['https://scripts.example.net/coral', 'wrong-prefix'],
  ['https://scripts.example.net/coralsx', 'wrong-prefix'],
  ['https://scripts.example.net/Corals', 'wrong-prefix'],
  ['https://scripts.example.net/CORALS', 'wrong-prefix'],
  ['https://scripts.example.net//corals', 'wrong-prefix'],
  ['https://scripts.example.net/x/corals', 'wrong-prefix'],
  ['https://scripts.example.net/x/../corals', 'wrong-prefix'],
  ['https://scripts.example.net/./corals', 'wrong-prefix'],
  ['https://scripts.example.net/corals;x', 'wrong-prefix'],
  ['https://scripts.example.net/assets', 'wrong-prefix'],
  // whitespace, inside and around
  [' https://scripts.example.net/corals', 'whitespace'],
  ['https://scripts.example.net/corals ', 'whitespace'],
  ['https://scripts.example.net /corals', 'whitespace'],
  ['https://scripts. example.net/corals', 'whitespace'],
  ['https://scripts.example.net/cor als', 'whitespace'],
  ['https://scripts.example.net/corals https://other.example/corals', 'whitespace'],
  // control characters: tab, newline, carriage return, NUL, escape, DEL
  ['https://scripts.example.net/corals\n', 'control-character'],
  ['\nhttps://scripts.example.net/corals', 'control-character'],
  ['https://scripts.example.net/corals\r\n', 'control-character'],
  ['https://scripts.exa\tmple.net/corals', 'control-character'],
  ['ht\ntps://scripts.example.net/corals', 'control-character'],
  ['https://scripts.example.net/corals\0', 'control-character'],
  ['https://scripts.example.net\x1b/corals', 'control-character'],
  ['https://scripts.example.net/corals\x7f', 'control-character'],
  ['https://scripts.example.net/corals\x0b', 'control-character'],
  ['https://scripts.example.net/corals\x0c', 'control-character'],
  // quotes, angle brackets, backslash — the characters that end an attribute, a tag or a header token
  ['https://scripts.example.net/corals"', 'forbidden-character'],
  ['"https://scripts.example.net/corals"', 'forbidden-character'],
  ["'https://scripts.example.net/corals'", 'forbidden-character'],
  ['https://scripts.example.net/corals`', 'forbidden-character'],
  ['https://scripts.example.net/corals"><script>', 'forbidden-character'],
  ['https://scripts.example.net/corals>', 'forbidden-character'],
  ['<https://scripts.example.net/corals>', 'forbidden-character'],
  ['https:\\\\scripts.example.net\\corals', 'forbidden-character'],
  ['https://scripts.example.net\\corals', 'forbidden-character'],
  ['https://scripts.example.net\\@other.example/corals', 'forbidden-character'],
  // percent-escapes, anywhere
  ['https://scripts.example.net/%63orals', 'percent-escape'],
  ['https://scripts.example.net/corals%2f', 'percent-escape'],
  ['https://scripts%2eexample.net/corals', 'percent-escape'],
  ['https://scripts.example.net/corals%00', 'percent-escape'],
  ['https://scripts.example.net/corals%', 'percent-escape'],
  // non-ASCII: a real internationalised name, a look-alike letter, and the forms the URL parser
  // would FOLD into an ASCII name (full-width letters, an ideographic full stop, a soft hyphen)
  ['https://b\u00fccher.example/corals', 'non-ascii'],
  ['https://scripts.ex\u0430mple.net/corals', 'non-ascii'],
  ['https://\uff53\uff43\uff52\uff49\uff50\uff54\uff53.example.net/corals', 'non-ascii'],
  ['https://scripts\u3002example\u3002net/corals', 'non-ascii'],
  ['https://scr\u00adipts.example.net/corals', 'non-ascii'],
  ['https://scripts.example.net/corals\u00a0', 'non-ascii'],
  ['https://scripts.example.net/corals\u2028', 'non-ascii'],
  ['\ufeffhttps://scripts.example.net/corals', 'non-ascii'],
  ['https://scripts.example.net/\u0441orals', 'non-ascii'],
  // internationalised names in their ASCII spelling are refused too (see the module for why)
  ['https://xn--bcher-kva.example/corals', 'idn'],
  ['https://scripts.xn--p1ai/corals', 'idn'],
  ['https://xn--a.example.net/corals', 'idn'],
  ['https://ab--cd.example.net/corals', 'idn'],
  ['https://a---b.example.net/corals', 'idn'],
  ['https://scripts.a---b/corals', 'idn'],
  // IP literals, in every spelling the URL parser reads as an address
  ['https://192.0.2.7/corals', 'ip-literal'],
  ['https://127.0.0.1/corals', 'ip-literal'],
  ['https://127.1/corals', 'ip-literal'],
  ['https://2130706433/corals', 'ip-literal'],
  ['https://0x7f.0.0.1/corals', 'ip-literal'],
  ['https://0x7f000001/corals', 'ip-literal'],
  ['https://0177.0.0.1/corals', 'ip-literal'],
  ['https://scripts.example.7/corals', 'ip-literal'],
  ['https://[::1]/corals', 'ip-literal'],
  ['https://[2001:db8::7]/corals', 'ip-literal'],
  ['https://[::ffff:192.0.2.7]/corals', 'ip-literal'],
  ['https://[::1]:443/corals', 'ip-literal'],
  // host
  ['https:///corals', 'empty-host'],
  ['https://', 'empty-host'],
  ['https://scripts.example.net./corals', 'trailing-dot'],
  ['https://./corals', 'trailing-dot'],
  ['https://SCRIPTS.example.net/corals', 'upper-case-host'],
  ['https://scripts.example.NET/corals', 'upper-case-host'],
  ['https://localhost/corals', 'host'],
  ['https://scripts/corals', 'host'],
  ['https://.example.net/corals', 'host'],
  ['https://scripts..example.net/corals', 'host'],
  ['https://-scripts.example.net/corals', 'host'],
  ['https://scripts-.example.net/corals', 'host'],
  ['https://scripts_cdn.example.net/corals', 'host'],
  ['https://*.example.net/corals', 'host'],
  ['https://scripts.example.net,other.example/corals', 'host'],
  ['https://scripts.example.net;other.example/corals', 'host'],
  ['https://scripts.example.net&/corals', 'host'],
  ['https://scripts.example.net=/corals', 'host'],
  ['https://scripts.example.net+x/corals', 'host'],
  ['https://scripts.example.net|x/corals', 'host'],
  ['https://scripts.example.net{x}/corals', 'host'],
  ['https://scripts.example.net^/corals', 'host'],
  ['https://scripts.example.net~/corals', 'host'],
  ['https://scripts.example.net!/corals', 'host'],
  ['https://scripts.example.net$/corals', 'host'],
  ['https://(scripts.example.net)/corals', 'host'],
  [`https://${'a'.repeat(64)}.example.net/corals`, 'host'],
  // 254 characters of host: every label is fine, the name is one too long
  [`https://${[1, 2, 3].map(() => 'a'.repeat(63)).join('.')}.${'b'.repeat(58)}.net/corals`, 'host'],
];

test('every other value throws, naming the setting and the reason', () => {
  for (const [raw, reason] of INVALID) {
    refused(raw, reason);
    refused(raw, reason, (v) => scriptBase({ SCRIPT_BASE: v }));
  }
  // The classes the reader must cover, each present in the table above at least once.
  const reasons = new Set(INVALID.map(([, r]) => r));
  for (const r of ['scheme', 'userinfo', 'port', 'query', 'fragment', 'trailing-slash', 'extra-path', 'wrong-prefix',
    'whitespace', 'control-character', 'forbidden-character', 'percent-escape', 'non-ascii', 'idn', 'ip-literal',
    'empty-host', 'trailing-dot', 'upper-case-host', 'host']) {
    assert.ok(reasons.has(r), `no invalid value exercises "${r}"`);
  }
});

test('the reason is only ever a diagnosis: nothing the grammar refuses is let through by it', () => {
  // Any single character of a valid value replaced by any other ASCII character or a few
  // non-ASCII ones is either still a member of the grammar (a different, equally plain host) or
  // refused with a ScriptBaseError — never returned changed, never another kind of error.
  const alphabet = [...Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)), '\u00e9', '\u3002', '\uff0f', '\u2044'];
  let stillValid = 0;
  for (let at = 0; at <= GOOD.length; at++) {
    for (const ch of alphabet) {
      for (const candidate of [GOOD.slice(0, at) + ch + GOOD.slice(at + 1), GOOD.slice(0, at) + ch + GOOD.slice(at)]) {
        let out;
        try { out = parseScriptBase(candidate); } catch (e) {
          assert.ok(e instanceof ScriptBaseError, `${JSON.stringify(candidate)} threw ${e}`);
          assert.ok(e.message.includes('SCRIPT_BASE'));
          continue;
        }
        assert.equal(out, candidate);
        assert.ok(SCRIPT_BASE_GRAMMAR.test(candidate), `${JSON.stringify(candidate)} came back without matching the grammar`);
        assert.equal(new URL(candidate).href, candidate);
        stillValid++;
      }
    }
  }
  // Only letters, digits, hyphens and dots inside the host can vary and stay valid.
  assert.ok(stillValid > 100 && stillValid < 2500, `${stillValid} single-character edits stayed valid`);
});

test('🔴 what `new URL()` would have accepted, and what it would have turned it into', () => {
  // [value, what `new URL(value).href` is, our reason]. Every row parses without an error in the
  // WHATWG parser, and all but the last five come out as a clean-looking https URL: a reader built on
  // `new URL()` plus "is the protocol https and the path /corals" lets each of them through, having
  // changed what the operator wrote. The value is used in two places that must agree byte for byte
  // (the page's script URLs and the policy that allows them), so the reader refuses anything it
  // would have to rewrite.
  const LENIENT = [
    // tabs and newlines are deleted from anywhere in the input
    ['https://scripts.exa\tmple.net/corals', 'https://scripts.example.net/corals', 'control-character'],
    ['https://scripts.example.net/cor\nals', 'https://scripts.example.net/corals', 'control-character'],
    ['ht\ttps://scripts.example.net/corals\r\n', 'https://scripts.example.net/corals', 'control-character'],
    // leading and trailing spaces and control characters are trimmed
    ['  https://scripts.example.net/corals  ', 'https://scripts.example.net/corals', 'whitespace'],
    ['\x00https://scripts.example.net/corals\x1f', 'https://scripts.example.net/corals', 'control-character'],
    // a backslash is a slash
    ['https:\\\\scripts.example.net\\corals', 'https://scripts.example.net/corals', 'forbidden-character'],
    // the scheme and the host are lower-cased
    ['HTTPS://scripts.example.net/corals', 'https://scripts.example.net/corals', 'scheme'],
    ['https://SCRIPTS.Example.NET/corals', 'https://scripts.example.net/corals', 'upper-case-host'],
    // the slashes after the scheme are optional, and extra ones are skipped
    ['https:scripts.example.net/corals', 'https://scripts.example.net/corals', 'scheme'],
    ['https:/scripts.example.net/corals', 'https://scripts.example.net/corals', 'scheme'],
    ['https:///scripts.example.net/corals', 'https://scripts.example.net/corals', 'empty-host'],
    // the default port disappears; an empty port too
    ['https://scripts.example.net:443/corals', 'https://scripts.example.net/corals', 'port'],
    ['https://scripts.example.net:/corals', 'https://scripts.example.net/corals', 'port'],
    ['https://scripts.example.net:0443/corals', 'https://scripts.example.net/corals', 'port'],
    // dot segments are resolved
    ['https://scripts.example.net/x/../corals', 'https://scripts.example.net/corals', 'wrong-prefix'],
    ['https://scripts.example.net/./corals', 'https://scripts.example.net/corals', 'wrong-prefix'],
    ['https://scripts.example.net/corals/x/..', 'https://scripts.example.net/corals/', 'extra-path'],
    // an empty userinfo, an empty query and an empty fragment vanish or nearly do
    ['https://@scripts.example.net/corals', 'https://scripts.example.net/corals', 'userinfo'],
    ['https://scripts.example.net/corals?', 'https://scripts.example.net/corals?', 'query'],
    ['https://scripts.example.net/corals#', 'https://scripts.example.net/corals#', 'fragment'],
    // full-width letters, an ideographic full stop and a soft hyphen are folded into an ASCII name
    ['https://\uff53\uff43\uff52\uff49\uff50\uff54\uff53.example.net/corals', 'https://scripts.example.net/corals', 'non-ascii'],
    ['https://scripts\u3002example\u3002net/corals', 'https://scripts.example.net/corals', 'non-ascii'],
    ['https://scr\u00adipts.example.net/corals', 'https://scripts.example.net/corals', 'non-ascii'],
    // a percent-escaped host is decoded
    ['https://scripts%2eexample.net/corals', 'https://scripts.example.net/corals', 'percent-escape'],
    // …and these it accepts as they are, or as a DIFFERENT origin from the one that was meant:
    // a trailing dot is kept (a different host to a policy, the same server to DNS)
    ['https://scripts.example.net./corals', 'https://scripts.example.net./corals', 'trailing-dot'],
    // numbers become an IPv4 address, whatever base they were written in
    ['https://0x7f.1/corals', 'https://127.0.0.1/corals', 'ip-literal'],
    ['https://2130706433/corals', 'https://127.0.0.1/corals', 'ip-literal'],
    ['https://[::ffff:192.0.2.7]/corals', 'https://[::ffff:c000:207]/corals', 'ip-literal'],
    // credentials are kept in the URL
    ['https://user:secret@scripts.example.net/corals', 'https://user:secret@scripts.example.net/corals', 'userinfo'],
    // a percent-escape in the path is kept, for a server to decode later
    ['https://scripts.example.net/%63orals', 'https://scripts.example.net/%63orals', 'percent-escape'],
    // a Unicode name is converted to its ASCII form
    ['https://b\u00fccher.example/corals', 'https://xn--bcher-kva.example/corals', 'non-ascii'],
  ];
  for (const [raw, href, reason] of LENIENT) {
    let u = null;
    assert.doesNotThrow(() => { u = new URL(raw); }, `new URL refused ${JSON.stringify(raw)} after all`);
    assert.equal(u.href, href, `new URL(${JSON.stringify(raw)})`);
    assert.equal(u.protocol, 'https:');
    refused(raw, reason);
  }
  assert.ok(LENIENT.filter(([, href]) => href === GOOD).length >= 20, 'the rows that collapse onto the valid value');
});

test('runtimeSrc: one plain file name under <base>/site-runtime/<exact version>/', () => {
  const env = { SCRIPT_BASE: GOOD };
  assert.equal(runtimeSrc('head.js', '1.2.3', env), `${GOOD}/site-runtime/1.2.3/head.js`);
  assert.equal(runtimeSrc('announce-guard.js', '0.0.1', env), `${GOOD}/site-runtime/0.0.1/announce-guard.js`);
  assert.equal(runtimeSrc('chunk-AB12CD34.js', '10.20.30', env), `${GOOD}/site-runtime/10.20.30/chunk-AB12CD34.js`);
  assert.equal(runtimeSrc('a.js', '0.0.0', env), `${GOOD}/site-runtime/0.0.0/a.js`);
  assert.equal(runtimeSrc('grid_filter2.js', '1.0.0', env), `${GOOD}/site-runtime/1.0.0/grid_filter2.js`);
  // Whatever it returns is exactly the base, three more segments, and nothing a parser rewrites.
  for (const entry of ['head.js', 'chunk-AB12CD34.js', 'a.js', `${'a'.repeat(64)}.js`]) {
    const src = runtimeSrc(entry, '1.2.3', env);
    const u = new URL(src);
    assert.equal(u.href, src);
    assert.equal(u.origin, 'https://scripts.example.net');
    assert.deepEqual(u.pathname.split('/'), ['', 'corals', 'site-runtime', '1.2.3', entry]);
  }
});

test('runtimeSrc refuses every entry name that is not a plain file name', () => {
  const env = { SCRIPT_BASE: GOOD };
  const bad = [
    '', '.js', 'head', 'head.mjs', 'head.css', 'head.json', 'head.js.map', 'head.JS', 'head.js ', ' head.js', 'head.js\n',
    '/head.js', 'x/head.js', './head.js', '../head.js', '..', '.', '..js', 'a..js', 'a.b.js', '.head.js', '-head.js', '_head.js',
    'x/../head.js', '..%2fhead.js', '%2e%2e/head.js', 'head%2ejs', 'he%61d.js', 'head.js%00', '%',
    'x\\head.js', '..\\head.js', 'head.js?v=1', 'head.js#x', 'head.js;x', 'he ad.js', 'he\tad.js', 'head\0.js',
    'h"ead.js', "h'ead.js", 'h<ead.js', 'h>ead.js', 'h&ead.js', 'h:ead.js', 'head@.js', '@head.js', 'h*ead.js', 'h+ead.js', 'h~ead.js',
    'https://other.example/head.js', '//other.example/head.js', 'h\u00e9ad.js', '\uff48ead.js', 'head\u2024js',
    `${'a'.repeat(65)}.js`,
  ];
  for (const entry of bad) {
    assert.throws(() => runtimeSrc(entry, '1.2.3', env), (e) => e instanceof ScriptBaseError && e.reason === 'entry',
      `accepted the entry name ${JSON.stringify(entry)}`);
  }
  for (const entry of [undefined, null, 7, ['head.js'], { toString: () => 'head.js' }, new String('head.js')]) {
    assert.throws(() => runtimeSrc(entry, '1.2.3', env), (e) => e instanceof ScriptBaseError && e.reason === 'entry');
  }
});

test('runtimeSrc takes an exact version, never a channel or a range', () => {
  const env = { SCRIPT_BASE: GOOD };
  const bad = [undefined, null, '', 'v0', 'v1', 'latest', '1', '1.2', '1.2.3.4', 'v1.2.3', '1.2.x', '^1.2.3', '~1.2.3', '>=1.2.3', '*',
    '1.2.3-beta', '1.2.3-beta.1', '1.2.3+build', '01.2.3', '1.02.3', '1.2.03', '1.2.3 ', ' 1.2.3', '1.2.3\n', '1.2.3/..', '../1.2.3',
    '1.2.3/x', '1%2e2.3', '1..3', '.1.2.3', '1.2.3.', '-1.2.3', '1e1.2.3', 123, 1.2, ['1.2.3'], `1.2.${'9'.repeat(10)}`];
  for (const version of bad) {
    assert.throws(() => runtimeSrc('head.js', version, env), (e) => e instanceof ScriptBaseError && e.reason === 'version',
      `accepted the version ${JSON.stringify(version)}`);
  }
});

test('runtimeSrc with the setting off or invalid throws: there is no URL to give', () => {
  // A caller must branch on scriptBase() first. An empty string here would be written into a
  // `src=""` attribute, which a browser resolves to the page's own URL.
  assert.throws(() => runtimeSrc('head.js', '1.2.3', {}), (e) => e instanceof ScriptBaseError && e.reason === 'off');
  assert.throws(() => runtimeSrc('head.js', '1.2.3', { SCRIPT_BASE: '' }), (e) => e instanceof ScriptBaseError && e.reason === 'off');
  assert.throws(() => runtimeSrc('head.js', '1.2.3', { SCRIPT_BASE: 'http://scripts.example.net/corals' }),
    (e) => e instanceof ScriptBaseError && e.reason === 'scheme');
  // …and a bad entry is refused whether or not the setting is on (the name is checked first).
  assert.throws(() => runtimeSrc('../head.js', '1.2.3', {}), (e) => e instanceof ScriptBaseError && e.reason === 'entry');
});

test('scriptBase() and runtimeSrc() read the process environment by default', () => {
  const had = Object.hasOwn(process.env, 'SCRIPT_BASE');
  const before = process.env.SCRIPT_BASE;
  try {
    delete process.env.SCRIPT_BASE;
    assert.equal(scriptBase(), '');
    process.env.SCRIPT_BASE = GOOD;
    assert.equal(scriptBase(), GOOD);
    assert.equal(runtimeSrc('head.js', '1.2.3'), `${GOOD}/site-runtime/1.2.3/head.js`);
    process.env.SCRIPT_BASE = GOOD + '/';
    assert.throws(() => scriptBase(), (e) => e instanceof ScriptBaseError && e.reason === 'trailing-slash');
  } finally {
    if (had) process.env.SCRIPT_BASE = before; else delete process.env.SCRIPT_BASE;
  }
});

// A reader nobody calls refuses nothing. The renderer's config reads the setting when it loads, so
// a bad value stops `astro build` before a page is rendered. This needs the renderer's
// dependencies and SAYS SO when they are absent — the same shape as the other build-backed tests.
test('🔴 a build with an invalid SCRIPT_BASE fails, naming the setting and the reason, and writes nothing', (t) => {
  if (!existsSync(join(ASTRO, 'node_modules'))) {
    console.log('  · SKIPPED — no packages/sitetile/astro/node_modules (run npm install there): a real build was NOT shown to fail on a bad SCRIPT_BASE');
    t.skip('renderer dependencies absent');
    return;
  }
  const out = mkdtempSync(join(tmpdir(), 'script-base-refused-'));
  try {
    const r = spawnSync('npx', ['astro', 'build', '--outDir', out], {
      cwd: ASTRO, encoding: 'utf8',
      env: { ...process.env, SITE_ID: 'smoke-site', SCRIPT_BASE: 'https://scripts.example.net/corals/' },
    });
    const said = `${r.stdout}\n${r.stderr}`;
    assert.notEqual(r.status, 0, 'the build succeeded with an invalid SCRIPT_BASE');
    assert.match(said, /SCRIPT_BASE/, said.slice(-2000));
    assert.match(said, /trailing slash/, said.slice(-2000));
    assert.deepEqual(readdirSync(out), [], 'the refused build wrote files');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
