// The script base: the one origin a site may be told to load the renderer's own scripts from.
//   run: node packages/sitetile/script-base.test.mjs   (globbed into scripts/test.sh)
//
// `SCRIPT_BASE` decides which origin a page's scripts come from, so its reader is security code and
// this file is its specification:
//   1. unset or empty means OFF, and nothing else does;
//   2. the accepted values are exactly `https://<host>/corals` — each one comes back byte for byte,
//      and the WHATWG URL parser agrees with every byte of it;
//   3. every other value THROWS, naming the setting and the reason (a typo must stop the build, not
//      ship a site whose scripts a policy then blocks) — and never showing the value: what was
//      pasted into the setting by mistake may be a secret, and a build log is not private;
//   4. `new URL()` would have accepted most of those refused values, and quietly turned them into
//      something else — that table is pinned here so nobody "simplifies" the reader into it;
//   5. `runtimeSrc` cannot be made to name a URL outside the base;
//   6. the setting is read ONCE per process and the outcome kept: a later change of the environment
//      changes nothing. Tests read other environments through `scriptBaseReader(env)`, one reader
//      per case; there is no reset, here or anywhere. What is kept on the process is taken back
//      only in the exact shape the reader writes; anything else found there stops the build;
//   7. a build with a bad value fails before it writes a page (needs the renderer's dependencies).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import {
  SCRIPT_BASE_ENV, SCRIPT_BASE_GRAMMAR, RUNTIME_ID, ScriptBaseError,
  parseScriptBase, scriptBase, runtimeSrc, scriptBaseReader,
} from './astro/src/lib/script-base.mjs';
import * as scriptBaseModule from './astro/src/lib/script-base.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASTRO = join(HERE, 'astro');
const GOOD = 'https://scripts.example.net/corals';
const OTHER = 'https://other.example.org/corals';
const MODULE_URL = new URL('./astro/src/lib/script-base.mjs', import.meta.url).href;

/** What a fresh reader makes of an environment: each call is a new reader over a new object. */
const readEnv = (env) => scriptBaseReader({ ...env }).scriptBase();
const srcIn = (env, entry, version) => scriptBaseReader({ ...env }).runtimeSrc(entry, version);

/** Runs `body` (module source; `m` is the reader module) in a new process with `env` as given. */
function inFreshProcess(env, body) {
  const clean = { ...process.env };
  delete clean.SCRIPT_BASE;
  const source = `import * as m from ${JSON.stringify(MODULE_URL)};\nimport assert from 'node:assert/strict';\n${body}\nconsole.log('FRESH-PROCESS-OK');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', env: { ...clean, ...env } });
  assert.equal(r.status, 0, `the child process failed:\n${r.stderr}`);
  assert.match(r.stdout, /FRESH-PROCESS-OK/);
}

/** Asserts that `raw` is refused for `reason`, by an error that names the setting. */
function refused(raw, reason, parse = parseScriptBase) {
  let err = null;
  try { parse(raw); } catch (e) { err = e; }
  assert.ok(err, `accepted ${JSON.stringify(raw)}`);
  assert.ok(err instanceof ScriptBaseError, `threw something else for ${JSON.stringify(raw)}: ${err}`);
  assert.equal(err.reason, reason, `${JSON.stringify(raw)} was refused as "${err.reason}": ${err.message}`);
  assert.ok(err.message.includes(SCRIPT_BASE_ENV), `the message does not name the setting: ${err.message}`);
  assert.ok(err.message.length > SCRIPT_BASE_ENV.length + 20, `the message gives no reason: ${err.message}`);
  // What a build log shows must be printable: no control character of a refused value can reach a
  // terminal, because no character of it is in the message at all.
  assert.ok(/^[\x20-\x7e]+$/.test(err.message), `the message is not plain printable ASCII: ${JSON.stringify(err.message)}`);
  // The value is described by its size, never shown. No ten consecutive characters of it are
  // anywhere in what the error carries (ten: longer than anything the fixed wording shares with
  // a value, such as `https://` or `/corals`).
  if (typeof raw === 'string') {
    assert.ok(err.message.includes(`${raw.length} character`), `the message does not give the value's length (${raw.length}): ${err.message}`);
    const carried = everythingIn(err);
    for (let i = 0; i + 10 <= raw.length; i++) {
      assert.ok(!carried.includes(raw.slice(i, i + 10)), `the error shows part of the refused value (${JSON.stringify(raw.slice(i, i + 10))}): ${err.message}`);
    }
  }
  return err;
}

/** Every string an error could put in a log: message, stack, cause, own properties, its inspection. */
function everythingIn(err) {
  const seen = new Set();
  const parts = [];
  (function collect(v, depth) {
    if (v === null || v === undefined || depth > 6) return;
    if (typeof v !== 'object' && typeof v !== 'function') { parts.push(String(v)); return; }
    if (seen.has(v)) return;
    seen.add(v);
    if (v instanceof Error) parts.push(String(v), String(v.stack), inspect(v, { depth: 8, showHidden: true }));
    for (const key of Reflect.ownKeys(v)) {
      parts.push(String(key));
      let value;
      try { value = v[key]; } catch { continue; }
      collect(value, depth + 1);
    }
  })(err, 0);
  let json = '';
  try { json = JSON.stringify(err) ?? ''; } catch { json = ''; }
  return parts.join('\n') + '\n' + json;
}

test('the setting is the environment variable SCRIPT_BASE', () => {
  assert.equal(SCRIPT_BASE_ENV, 'SCRIPT_BASE');
  assert.equal(RUNTIME_ID, 'site-runtime');
});

test('unset or empty means off — and only those do', () => {
  assert.equal(parseScriptBase(undefined), '');
  assert.equal(parseScriptBase(''), '');
  assert.equal(readEnv({}), '');
  assert.equal(readEnv({ SCRIPT_BASE: '' }), '');
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
    assert.equal(readEnv({ SCRIPT_BASE: v }), v);
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
    refused(raw, reason, (v) => readEnv({ SCRIPT_BASE: v }));
  }
  // The classes the reader must cover, each present in the table above at least once.
  const reasons = new Set(INVALID.map(([, r]) => r));
  for (const r of ['scheme', 'userinfo', 'port', 'query', 'fragment', 'trailing-slash', 'extra-path', 'wrong-prefix',
    'whitespace', 'control-character', 'forbidden-character', 'percent-escape', 'non-ascii', 'idn', 'ip-literal',
    'empty-host', 'trailing-dot', 'upper-case-host', 'host']) {
    assert.ok(reasons.has(r), `no invalid value exercises "${r}"`);
  }
});

// ── No echo ────────────────────────────────────────────────────────────────────────────────────
// The setting is one paste away from a secret: a deploy token dropped into the wrong variable, a
// URL with credentials in it. The error says which setting and why, gives the value's length and,
// for a character that does not belong, its class and position — and none of the characters.
const SECRET = 'Zq7Xv9Kp2Lm4Nw8Rt6Yb3Hd5Jc1Gf0Qs';

test('🔴 a pasted secret is not in the error: not in its message, its stack, its cause or its properties', () => {
  const pasted = [
    [SECRET, 'scheme'],                                                             // a bare token
    [SECRET.repeat(12), 'scheme'],                                                  // a long one (384 characters)
    [`https://deploy:${SECRET}@scripts.example.net/corals`, 'userinfo'],            // credentials in a URL
    [`https://${SECRET}@scripts.example.net/corals`, 'userinfo'],
    [`https://scripts.example.net/corals?token=${SECRET}`, 'query'],
    [`https://scripts.example.net/corals#${SECRET}`, 'fragment'],
    [`https://scripts.example.net/corals/${SECRET}`, 'extra-path'],
    [`https://scripts.example.net:8443/${SECRET}`, 'port'],
    [`Bearer ${SECRET}`, 'whitespace'],
    [`${SECRET}\n`, 'control-character'],                                           // a token with its newline
    [`\x1b]0;${SECRET}\x07`, 'control-character'],                                  // …or inside a terminal escape
    [`"${SECRET}"`, 'forbidden-character'],
    [`${SECRET}%3D`, 'percent-escape'],
    [`${SECRET}\u00e9`, 'non-ascii'],
    [`https://${SECRET.toLowerCase()}.example.net/corals/`, 'trailing-slash'],      // a secret that is a valid host label
  ];
  const leaks = (err, raw) => {
    const carried = everythingIn(err);
    // Five consecutive characters of the secret, in either case, are enough to call it shown.
    for (let i = 0; i + 5 <= SECRET.length; i++) {
      const piece = SECRET.slice(i, i + 5);
      if (carried.includes(piece) || carried.includes(piece.toLowerCase())) return `${JSON.stringify(piece)} of the secret`;
    }
    if (/deploy|Bearer/.test(carried)) return 'the text beside the secret';
    if (carried.includes(raw)) return 'the whole value';
    return '';
  };
  for (const [raw, reason] of pasted) {
    const errors = [refused(raw, reason), refused(raw, reason, (v) => readEnv({ SCRIPT_BASE: v }))];
    try { srcIn({ SCRIPT_BASE: raw }, 'head.js', '1.2.3'); } catch (e) { errors.push(e); }
    assert.equal(errors.length, 3);
    for (const err of errors) {
      assert.equal(leaks(err, raw), '', `the error for a ${reason} value shows ${leaks(err, raw)}: ${err.message}`);
      assert.equal(err.cause, undefined, 'the error has a cause, which a logger would print');
      assert.deepEqual(Object.keys(err).sort(), ['name', 'reason'], 'the error carries a property beyond its name and reason');
      assert.ok(err.message.includes(`${raw.length} characters`), err.message);
    }
  }
  // A value that is not a string is described by its type, and its contents are not looked at.
  const notAString = refused([`https://deploy:${SECRET}@scripts.example.net/corals`], 'not-a-string');
  assert.equal(leaks(notAString, SECRET), '');
  assert.match(notAString.message, /a value of type object/);
  // An accepted base is not a secret, and a runtimeSrc error about its other arguments still does
  // not repeat it.
  const on = scriptBaseReader({ SCRIPT_BASE: GOOD });
  for (const call of [() => on.runtimeSrc('../x.js', '1.2.3'), () => on.runtimeSrc('head.js', 'latest')]) {
    assert.throws(call, (e) => e instanceof ScriptBaseError && !everythingIn(e).includes('scripts.example.net'));
  }
});

test('🔴 the error says what kind of character does not belong and where, without showing it', () => {
  const says = (raw, reason, pattern) => assert.match(refused(raw, reason).message, pattern);
  says('https://scripts.exa\tmple.net/corals', 'control-character', /a control character at position 20 /);
  says('\x1b[31mhttps://scripts.example.net/corals', 'control-character', /a control character at position 1 /);
  says(GOOD + '\n', 'control-character', new RegExp(`a control character at position ${GOOD.length + 1} `));
  says(' ' + GOOD, 'whitespace', /a space at position 1\. /);
  says('https://scripts.example.net /corals', 'whitespace', /a space at position 28\. /);
  says(GOOD + '"', 'forbidden-character', new RegExp(`a quote, an angle bracket or a backslash at position ${GOOD.length + 1}[ .]`));
  says('https://scripts%2eexample.net/corals', 'percent-escape', /a percent sign at position 16 /);
  says('https://b\u00fccher.example/corals', 'non-ascii', /a non-ASCII character at position 10 /);
  // The length is of the value as given, however long, and is all that is said of its size.
  assert.match(refused('x'.repeat(5000), 'scheme').message, /a value of 5000 characters/);
  assert.match(refused('*', 'scheme').message, /a value of 1 character,/);
  assert.match(refused(GOOD + '/', 'trailing-slash').message, new RegExp(`a value of ${GOOD.length + 1} characters`));
  // Two different values of one length, refused for one reason, give the very same message: the
  // message is a function of the reason, the length and a position, and of nothing else.
  assert.equal('https://one.example.org/corals/'.length, 'https://two.example.net/corals/'.length);
  assert.equal(refused('https://one.example.org/corals/', 'trailing-slash').message, refused('https://two.example.net/corals/', 'trailing-slash').message);
  assert.equal(refused('https://one.example.org/cor\tals', 'control-character').message, refused('https://two.example.net/cor\x1bals', 'control-character').message);
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
  const on = scriptBaseReader({ SCRIPT_BASE: GOOD });
  assert.equal(on.runtimeSrc('head.js', '1.2.3'), `${GOOD}/site-runtime/1.2.3/head.js`);
  assert.equal(on.runtimeSrc('announce-guard.js', '0.0.1'), `${GOOD}/site-runtime/0.0.1/announce-guard.js`);
  assert.equal(on.runtimeSrc('chunk-AB12CD34.js', '10.20.30'), `${GOOD}/site-runtime/10.20.30/chunk-AB12CD34.js`);
  assert.equal(on.runtimeSrc('a.js', '0.0.0'), `${GOOD}/site-runtime/0.0.0/a.js`);
  assert.equal(on.runtimeSrc('grid_filter2.js', '1.0.0'), `${GOOD}/site-runtime/1.0.0/grid_filter2.js`);
  // Whatever it returns is exactly the base, three more segments, and nothing a parser rewrites.
  for (const entry of ['head.js', 'chunk-AB12CD34.js', 'a.js', `${'a'.repeat(64)}.js`]) {
    const src = on.runtimeSrc(entry, '1.2.3');
    const u = new URL(src);
    assert.equal(u.href, src);
    assert.equal(u.origin, 'https://scripts.example.net');
    assert.deepEqual(u.pathname.split('/'), ['', 'corals', 'site-runtime', '1.2.3', entry]);
  }
});

test('runtimeSrc refuses every entry name that is not a plain file name', () => {
  const on = scriptBaseReader({ SCRIPT_BASE: GOOD });
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
    assert.throws(() => on.runtimeSrc(entry, '1.2.3'), (e) => e instanceof ScriptBaseError && e.reason === 'entry',
      `accepted the entry name ${JSON.stringify(entry)}`);
  }
  for (const entry of [undefined, null, 7, ['head.js'], { toString: () => 'head.js' }, new String('head.js')]) {
    assert.throws(() => on.runtimeSrc(entry, '1.2.3'), (e) => e instanceof ScriptBaseError && e.reason === 'entry');
  }
});

test('runtimeSrc takes an exact version, never a channel or a range', () => {
  const on = scriptBaseReader({ SCRIPT_BASE: GOOD });
  const bad = [undefined, null, '', 'v0', 'v1', 'latest', '1', '1.2', '1.2.3.4', 'v1.2.3', '1.2.x', '^1.2.3', '~1.2.3', '>=1.2.3', '*',
    '1.2.3-beta', '1.2.3-beta.1', '1.2.3+build', '01.2.3', '1.02.3', '1.2.03', '1.2.3 ', ' 1.2.3', '1.2.3\n', '1.2.3/..', '../1.2.3',
    '1.2.3/x', '1%2e2.3', '1..3', '.1.2.3', '1.2.3.', '-1.2.3', '1e1.2.3', 123, 1.2, ['1.2.3'], `1.2.${'9'.repeat(10)}`];
  for (const version of bad) {
    assert.throws(() => on.runtimeSrc('head.js', version), (e) => e instanceof ScriptBaseError && e.reason === 'version',
      `accepted the version ${JSON.stringify(version)}`);
  }
});

test('runtimeSrc with the setting off or invalid throws: there is no URL to give', () => {
  // A caller must branch on scriptBase() first. An empty string here would be written into a
  // `src=""` attribute, which a browser resolves to the page's own URL.
  assert.throws(() => srcIn({}, 'head.js', '1.2.3'), (e) => e instanceof ScriptBaseError && e.reason === 'off');
  assert.throws(() => srcIn({ SCRIPT_BASE: '' }, 'head.js', '1.2.3'), (e) => e instanceof ScriptBaseError && e.reason === 'off');
  assert.throws(() => srcIn({ SCRIPT_BASE: 'http://scripts.example.net/corals' }, 'head.js', '1.2.3'),
    (e) => e instanceof ScriptBaseError && e.reason === 'scheme');
  // …and a bad entry is refused whether or not the setting is on (the name is checked first).
  assert.throws(() => srcIn({}, '../head.js', '1.2.3'), (e) => e instanceof ScriptBaseError && e.reason === 'entry');
});

// ── Read once ──────────────────────────────────────────────────────────────────────────────────
// One build must not be able to have the setting off on one page and on on another, or two bases.
// So a reader's first use is its only read: the outcome — a base, off, or the refusal — is kept.

test('🔴 a reader reads its environment once: a later change does not change the answer', () => {
  // on stays on, with the same base
  let env = { SCRIPT_BASE: GOOD };
  let reader = scriptBaseReader(env);
  assert.equal(reader.scriptBase(), GOOD);
  env.SCRIPT_BASE = OTHER;
  assert.equal(reader.scriptBase(), GOOD, 'a second valid origin replaced the first within one reader');
  assert.equal(reader.runtimeSrc('head.js', '1.2.3'), `${GOOD}/site-runtime/1.2.3/head.js`);
  delete env.SCRIPT_BASE;
  assert.equal(reader.scriptBase(), GOOD, 'the setting went from on to off within one reader');
  env.SCRIPT_BASE = GOOD + '/';
  assert.equal(reader.scriptBase(), GOOD, 'a later invalid value was read');

  // off stays off — "off" is an outcome like any other, not "not read yet"
  env = {};
  reader = scriptBaseReader(env);
  assert.equal(reader.scriptBase(), '');
  env.SCRIPT_BASE = GOOD;
  assert.equal(reader.scriptBase(), '', 'the setting went from off to on within one reader');
  assert.throws(() => reader.runtimeSrc('head.js', '1.2.3'), (e) => e instanceof ScriptBaseError && e.reason === 'off');

  // a refusal stays a refusal: the same error, not a second reading that might pass
  env = { SCRIPT_BASE: GOOD + '/' };
  reader = scriptBaseReader(env);
  let first = null;
  try { reader.scriptBase(); } catch (e) { first = e; }
  assert.ok(first instanceof ScriptBaseError && first.reason === 'trailing-slash');
  env.SCRIPT_BASE = GOOD;
  assert.throws(() => reader.scriptBase(), (e) => e === first, 'a refused value was read again and accepted');
  assert.throws(() => reader.runtimeSrc('head.js', '1.2.3'), (e) => e === first);

  // the first use is the read, whichever function it is and however late it comes
  env = {};
  reader = scriptBaseReader(env);
  env.SCRIPT_BASE = GOOD;
  assert.equal(reader.runtimeSrc('head.js', '1.2.3'), `${GOOD}/site-runtime/1.2.3/head.js`);
  delete env.SCRIPT_BASE;
  assert.equal(reader.scriptBase(), GOOD);
  // an argument that is refused before the base is asked for is not a read
  env = {};
  reader = scriptBaseReader(env);
  assert.throws(() => reader.runtimeSrc('../head.js', '1.2.3'), (e) => e.reason === 'entry');
  env.SCRIPT_BASE = GOOD;
  assert.equal(reader.scriptBase(), GOOD);

  // readers do not share anything, and a reader cannot be altered
  assert.equal(readEnv({ SCRIPT_BASE: OTHER }), OTHER);
  assert.ok(Object.isFrozen(reader));
  assert.deepEqual(Object.keys(reader).sort(), ['runtimeSrc', 'scriptBase']);
  for (const notAnEnv of [undefined, null, GOOD, 7]) assert.throws(() => scriptBaseReader(notAnEnv), TypeError);
});

test('🔴 the build\'s own read is once per process: process.env may change, the answer does not', () => {
  // Each case is a new process, because this is the one thing that cannot be done twice in one.
  inFreshProcess({ SCRIPT_BASE: GOOD }, `
    assert.equal(m.scriptBase(), ${JSON.stringify(GOOD)});
    process.env.SCRIPT_BASE = ${JSON.stringify(OTHER)};
    assert.equal(m.scriptBase(), ${JSON.stringify(GOOD)}, 'a second origin within one process');
    assert.equal(m.runtimeSrc('head.js', '1.2.3'), ${JSON.stringify(GOOD + '/site-runtime/1.2.3/head.js')});
    delete process.env.SCRIPT_BASE;
    assert.equal(m.scriptBase(), ${JSON.stringify(GOOD)}, 'on became off within one process');
    process.env.SCRIPT_BASE = 'not a base';
    assert.equal(m.scriptBase(), ${JSON.stringify(GOOD)});
  `);
  inFreshProcess({}, `
    assert.equal(m.scriptBase(), '');
    process.env.SCRIPT_BASE = ${JSON.stringify(GOOD)};
    assert.equal(m.scriptBase(), '', 'off became on within one process');
    assert.throws(() => m.runtimeSrc('head.js', '1.2.3'), (e) => e.reason === 'off');
  `);
  inFreshProcess({ SCRIPT_BASE: GOOD + '/' }, `
    let first = null;
    try { m.scriptBase(); } catch (e) { first = e; }
    assert.equal(first?.reason, 'trailing-slash');
    process.env.SCRIPT_BASE = ${JSON.stringify(GOOD)};
    assert.throws(() => m.scriptBase(), (e) => e === first, 'a refused value was read again');
    assert.throws(() => m.runtimeSrc('head.js', '1.2.3'), (e) => e === first);
  `);
  // The first read may be runtimeSrc's; and the environment as it is AT that read is what counts.
  inFreshProcess({}, `
    process.env.SCRIPT_BASE = ${JSON.stringify(GOOD)};
    assert.equal(m.runtimeSrc('head.js', '1.2.3'), ${JSON.stringify(GOOD + '/site-runtime/1.2.3/head.js')});
    delete process.env.SCRIPT_BASE;
    assert.equal(m.scriptBase(), ${JSON.stringify(GOOD)});
  `);
});

test('🔴 a second copy of the module in the same process gives the first copy\'s answer', () => {
  // A bundler evaluates this file again for the pages it builds; the config has already read the
  // setting through the first copy. Both must agree, so the outcome is kept on the process.
  inFreshProcess({ SCRIPT_BASE: GOOD }, `
    assert.equal(m.scriptBase(), ${JSON.stringify(GOOD)});
    process.env.SCRIPT_BASE = ${JSON.stringify(OTHER)};
    const again = await import(${JSON.stringify(MODULE_URL + '?a-second-copy')});
    assert.notEqual(again.scriptBase, m.scriptBase, 'the second import was not a second copy');
    assert.equal(again.scriptBase(), ${JSON.stringify(GOOD)}, 'a second copy read the environment again');
    assert.equal(again.runtimeSrc('head.js', '1.2.3'), ${JSON.stringify(GOOD + '/site-runtime/1.2.3/head.js')});
    // …and the kept outcome cannot be replaced or removed.
    const slot = Object.getOwnPropertySymbols(globalThis).filter((k) => /script-base/.test(String(k)));
    assert.equal(slot.length, 1);
    const d = Object.getOwnPropertyDescriptor(globalThis, slot[0]);
    assert.equal(d.writable, false);
    assert.equal(d.configurable, false);
    assert.equal(d.enumerable, false);
    assert.ok(Object.isFrozen(d.value));
    assert.throws(() => { delete globalThis[slot[0]]; }, TypeError);
    assert.throws(() => { globalThis[slot[0]] = { value: ${JSON.stringify(OTHER)} }; }, TypeError);
    assert.equal(m.scriptBase(), ${JSON.stringify(GOOD)});
  `);
});

// ── The slot on the process ────────────────────────────────────────────────────────────────────
// The kept outcome lives on `globalThis`, under a registered symbol any code in the process can
// name. What the reader guarantees about it is exactly this, and no more:
//   · ONE ANSWER PER PROCESS, and that answer ALWAYS PASSES THE GRAMMAR (or is off, or a refusal);
//   · anything in the slot that is not of the exact shape the reader writes stops the build.
// It does NOT guarantee that the answer came from the environment: see the last test of the three.
const SLOT = `Symbol.for('sitetile.script-base.first-read')`;
const sealed = (outcome) => `Object.defineProperty(globalThis, ${SLOT}, { value: ${outcome} });`;

test('🔴 a refusal is kept as its reason only: a second copy throws its own error for it, not the first copy\'s object', () => {
  inFreshProcess({ SCRIPT_BASE: GOOD + '/' }, `
    let first = null;
    try { m.scriptBase(); } catch (e) { first = e; }
    assert.equal(first?.reason, 'trailing-slash');
    // what is on the process is plain data: one frozen object with one string in it
    const d = Object.getOwnPropertyDescriptor(globalThis, ${SLOT});
    assert.deepEqual(Reflect.ownKeys(d.value), ['refused']);
    assert.equal(d.value.refused, 'trailing-slash');
    assert.ok(Object.isFrozen(d.value));
    assert.equal(Object.getPrototypeOf(d.value), Object.prototype);
    assert.equal([d.writable, d.configurable, d.enumerable].join(), 'false,false,false');

    process.env.SCRIPT_BASE = ${JSON.stringify(GOOD)};
    const again = await import(${JSON.stringify(MODULE_URL + '?a-second-copy')});
    assert.notEqual(again.ScriptBaseError, m.ScriptBaseError, 'the second import was not a second copy');
    let second = null;
    try { again.scriptBase(); } catch (e) { second = e; }
    assert.ok(second instanceof again.ScriptBaseError, 'the second copy threw an error that is not its own type');
    assert.ok(!(second instanceof m.ScriptBaseError));
    assert.notEqual(second, first);
    assert.equal(second.reason, 'trailing-slash');
    assert.ok(second.message.includes('SCRIPT_BASE') && second.message.includes('trailing-slash'));
    assert.ok(!second.message.includes('scripts.example'), 'the re-created refusal shows the value');
    // each copy keeps throwing its own one error
    assert.throws(() => again.scriptBase(), (e) => e === second);
    assert.throws(() => again.runtimeSrc('head.js', '1.2.3'), (e) => e === second);
    assert.throws(() => m.scriptBase(), (e) => e === first);
  `);
  // Every reason the reader can refuse for can be kept and re-created — none is mistaken for
  // tampering. (A value with a NUL in it cannot be put in a child's environment; another of the
  // same reason is used.)
  for (const reason of new Set(INVALID.map(([, r]) => r))) {
    const [raw] = INVALID.find(([v, r]) => r === reason && typeof v === 'string' && !v.includes('\0'));
    inFreshProcess({ SCRIPT_BASE: raw }, `
      assert.throws(() => m.scriptBase(), (e) => e.reason === ${JSON.stringify(reason)});
      const again = await import(${JSON.stringify(MODULE_URL + '?a-second-copy')});
      assert.throws(() => again.scriptBase(), (e) => e instanceof again.ScriptBaseError && e.reason === ${JSON.stringify(reason)});
    `);
  }
});

test('🔴 anything in the slot that is not exactly what the reader writes is refused as tampering, and nothing of it is shown', () => {
  // `setup` runs before the first read, with SCRIPT_BASE set to a good value the planted thing
  // would override. Every case must stop the build, every time, with this copy's own error.
  const tampering = (setup, after = '') => inFreshProcess({ SCRIPT_BASE: GOOD }, `
    const S = ${SLOT};
    ${setup}
    for (const read of [() => m.scriptBase(), () => m.runtimeSrc('head.js', '1.2.3'), () => m.scriptBase()]) {
      let err = null, got;
      try { got = read(); } catch (e) { err = e; }
      assert.ok(err, 'a planted outcome was returned: ' + got);
      assert.ok(err instanceof m.ScriptBaseError, 'not this reader\\'s own error: ' + err);
      assert.equal(err.reason, 'slot-tampered', err.message);
      assert.match(err.message, /SCRIPT_BASE/);
      assert.match(err.message, /tampered/);
      assert.ok(!/attacker|planted|example/.test(err.message + err.stack), 'the error shows what was planted: ' + err.message);
      assert.deepEqual(Object.keys(err), ['name', 'reason']);
      assert.equal(err.cause, undefined);
      ${after}
    }
  `);
  const BAD = `'https://attacker.example/corals'`;
  // a non-frozen object: it could be changed between two calls
  tampering(sealed(`{ value: ${BAD} }`));
  tampering(`const o = { value: '' }; ${sealed('o')}`, `o.value = ${BAD};`);
  tampering(sealed(`Object.seal({ value: ${BAD} })`));
  tampering(sealed(`Object.preventExtensions({ value: ${BAD} })`));
  // a getter, on the process or inside the outcome
  tampering(`Object.defineProperty(globalThis, S, { get() { return Object.freeze({ value: ${BAD} }); } });`);
  tampering(`let n = 0; Object.defineProperty(globalThis, S, { get() { return Object.freeze({ value: n++ ? ${BAD} : '' }); } });`);
  tampering(sealed(`Object.freeze(Object.defineProperty({}, 'value', { enumerable: true, get() { return ${BAD}; } }))`));
  // a property that is not sealed the way the reader seals it
  tampering(`globalThis[S] = Object.freeze({ value: ${BAD} });`);
  tampering(`Object.defineProperty(globalThis, S, { value: Object.freeze({ value: ${BAD} }), writable: true });`);
  tampering(`Object.defineProperty(globalThis, S, { value: Object.freeze({ value: ${BAD} }), configurable: true });`);
  tampering(`Object.defineProperty(globalThis, S, { value: Object.freeze({ value: ${BAD} }), enumerable: true });`);
  // extra keys, in any combination
  tampering(sealed(`Object.freeze({ value: ${BAD}, extra: 1 })`));
  tampering(sealed(`Object.freeze({ value: ${BAD}, refused: 'port' })`));
  tampering(sealed(`Object.freeze({ value: ${BAD}, [Symbol('extra')]: 1 })`));
  tampering(sealed(`Object.freeze(Object.defineProperty({ value: ${BAD} }, 'hidden', { value: 1 }))`));
  tampering(sealed(`Object.freeze({})`));
  // a foreign error object, however it is wrapped — it is never thrown onwards
  tampering(sealed(`Object.freeze({ error: new Error('planted, from https://attacker.example/corals') })`));
  tampering(sealed(`Object.freeze({ error: new m.ScriptBaseError('port', 'planted') })`));
  tampering(sealed(`Object.freeze({ refused: new m.ScriptBaseError('port', 'planted') })`));
  tampering(sealed(`Object.freeze(new Error('planted'))`));
  tampering(sealed(`Object.freeze(Object.assign(new m.ScriptBaseError('port', 'planted'), { refused: 'port' }))`));
  // a refusal that is not one of the reader's own reason codes for the setting
  tampering(sealed(`Object.freeze({ refused: 'planted' })`));
  tampering(sealed(`Object.freeze({ refused: 'slot-tampered' })`));
  tampering(sealed(`Object.freeze({ refused: 'off' })`));
  tampering(sealed(`Object.freeze({ refused: '' })`));
  tampering(sealed(`Object.freeze({ refused: 7 })`));
  tampering(sealed(`Object.freeze({ refused: ['port'] })`));
  // the right shape around a value the grammar refuses, or around no string at all
  tampering(sealed(`Object.freeze({ value: 'https://attacker.example/elsewhere' })`));
  tampering(sealed(`Object.freeze({ value: 'http://attacker.example/corals' })`));
  tampering(sealed(`Object.freeze({ value: undefined })`));
  tampering(sealed(`Object.freeze({ value: [${BAD}] })`));
  tampering(sealed(`Object.freeze({ value: new String(${BAD}) })`));
  tampering(sealed(`Object.freeze({ value: Object.freeze({ toString() { return ${BAD}; } }) })`));
  // not a plain object
  tampering(sealed(`null`));
  tampering(sealed(`undefined`));
  tampering(sealed(BAD));
  tampering(sealed(`Object.freeze([${BAD}])`));
  tampering(sealed(`Object.freeze(Object.assign(Object.create(null), { value: ${BAD} }))`));
  tampering(sealed(`Object.freeze(Object.assign(Object.create({ inherited: 1 }), { value: ${BAD} }))`));
  tampering(sealed(`Object.freeze(Object.create({ value: ${BAD} }))`));
  tampering(sealed(`Object.freeze(Object.assign(() => {}, { value: ${BAD} }))`));
  tampering(sealed(`new Proxy({ value: ${BAD} }, {})`));
});

test('a planted outcome of exactly the reader\'s own shape, holding a base that passes the grammar, IS accepted — by design: '
  + 'it cannot be told from the reader\'s own write, and code that runs before the first read can set SCRIPT_BASE itself; '
  + 'the guarantee is one answer per process that always passes the grammar, not that the answer came from the environment', () => {
  // Not something the slot adds: whatever can run this line before the config's read can run
  // `process.env.SCRIPT_BASE = …` instead, and the two are indistinguishable by construction.
  inFreshProcess({ SCRIPT_BASE: GOOD }, `
    ${sealed(`Object.freeze({ value: ${JSON.stringify(OTHER)} })`)}
    assert.equal(m.scriptBase(), ${JSON.stringify(OTHER)});
    assert.equal(m.runtimeSrc('head.js', '1.2.3'), ${JSON.stringify(OTHER + '/site-runtime/1.2.3/head.js')});
    assert.equal(m.scriptBase(), ${JSON.stringify(OTHER)}, 'one answer per process');
  `);
  // the same thing, done the way that needs no slot
  inFreshProcess({ SCRIPT_BASE: GOOD }, `
    process.env.SCRIPT_BASE = ${JSON.stringify(OTHER)};
    assert.equal(m.scriptBase(), ${JSON.stringify(OTHER)});
  `);
  // "off" and a refusal can be planted the same way; they are the other two things an environment can say
  inFreshProcess({ SCRIPT_BASE: GOOD }, `
    ${sealed(`Object.freeze({ value: '' })`)}
    assert.equal(m.scriptBase(), '');
    assert.throws(() => m.runtimeSrc('head.js', '1.2.3'), (e) => e.reason === 'off');
  `);
  inFreshProcess({ SCRIPT_BASE: GOOD }, `
    ${sealed(`Object.freeze({ refused: 'port' })`)}
    let first = null;
    try { m.scriptBase(); } catch (e) { first = e; }
    assert.ok(first instanceof m.ScriptBaseError && first.reason === 'port');
    assert.throws(() => m.runtimeSrc('head.js', '1.2.3'), (e) => e === first);
  `);
});

test('🔴 there is no reset, and no way to hand the build\'s reader another environment', () => {
  // The whole public surface. A reset, a "for tests" export or a setter would have to be added here.
  assert.deepEqual(Object.keys(scriptBaseModule).sort(), [
    'RUNTIME_ID', 'SCRIPT_BASE_ENV', 'SCRIPT_BASE_GRAMMAR', 'ScriptBaseError',
    'parseScriptBase', 'runtimeSrc', 'scriptBase', 'scriptBaseReader',
  ]);
  // The old spelling, `scriptBase(env)`, would now be silently ignored — so it is refused instead.
  // (Refused before anything is read: this process's own outcome is not touched by these calls.)
  assert.throws(() => scriptBase({ SCRIPT_BASE: GOOD }), TypeError);
  assert.throws(() => scriptBase(undefined), TypeError);
  assert.throws(() => runtimeSrc('head.js', '1.2.3', { SCRIPT_BASE: GOOD }), TypeError);
  assert.equal(scriptBase.length, 0);
});

// A reader nobody calls refuses nothing. The renderer's config reads the setting when it loads, so
// a bad value stops `astro build` before a page is rendered. This needs the renderer's
// dependencies and SAYS SO when they are absent — the same shape as the other build-backed tests.
// The config's call is also the process's one read (above): whatever the build asks later comes
// from it.
test('🔴 a build with an invalid SCRIPT_BASE fails, naming the setting and the reason without showing the value, and writes nothing', (t) => {
  if (!existsSync(join(ASTRO, 'node_modules'))) {
    console.log('  · SKIPPED — no packages/sitetile/astro/node_modules (run npm install there): a real build was NOT shown to fail on a bad SCRIPT_BASE');
    t.skip('renderer dependencies absent');
    return;
  }
  const out = mkdtempSync(join(tmpdir(), 'script-base-refused-'));
  try {
    const r = spawnSync('npx', ['astro', 'build', '--outDir', out], {
      cwd: ASTRO, encoding: 'utf8',
      env: { ...process.env, SITE_ID: 'smoke-site', SCRIPT_BASE: `https://deploy:${SECRET}@scripts.example.net/corals` },
    });
    const said = `${r.stdout}\n${r.stderr}`;
    assert.notEqual(r.status, 0, 'the build succeeded with an invalid SCRIPT_BASE');
    assert.match(said, /SCRIPT_BASE/, said.slice(-2000));
    assert.match(said, /userinfo/, said.slice(-2000));
    // What the build printed — the message, and whatever the build tool adds around it — does not
    // show the value: not the credentials, and not the host they were pasted beside.
    assert.ok(!said.includes(SECRET) && !said.includes(SECRET.slice(8, 16)), 'the build log shows the secret in the refused value');
    assert.ok(!/deploy:|scripts\.example\.net/.test(said), 'the build log shows part of the refused value');
    assert.deepEqual(readdirSync(out), [], 'the refused build wrote files');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
