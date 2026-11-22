// scripts/forbidden-terms.mjs must go RED on each kind of term it claims to guard, and must not print
// the term while refusing it. Every term here is planted synthetic text — no real handle or private
// name appears in this file, because this file is published too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'forbidden-terms.mjs');
const { scan, handleHash, portableKinds } = await import(GATE);

const PLANTED_HANDLE = 'zzplantedhandlezz';
const PLANTED_PRIVATE = 'zzplantedprivatezz';
const PRIVATE_LINK = ['CVERInc', 'reef'].join('/') + '#1'; // assembled so this file does not match itself

const made = [];
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// Run from a git hook (pre-push runs this suite), git exports GIT_DIR and friends. Every `git init` / `git add` below and
// the gate it spawns would inherit them and act on THAT repository instead of the throwaway one: from a submodule
// checkout the init rewrote the parent repo's config to core.bare=true, which broke the checkout itself.
for (const k of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE)$/.test(k)) delete process.env[k];

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-terms-'));
  made.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  return dir;
}
function lists() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-lists-'));
  made.push(dir);
  const hashes = path.join(dir, 'hashes');
  fs.writeFileSync(hashes, `# synthetic\n${handleHash('someoneelse')}\n${handleHash(PLANTED_HANDLE)}\n`);
  const priv = path.join(dir, 'private');
  fs.writeFileSync(priv, `# synthetic\n${PLANTED_PRIVATE}\n`);
  return { hashes, priv };
}
const filler = () => Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f/${i}.txt`, `line ${i}\n`]));

test('control: a clean tree is green, and the scan actually read the files', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ 'a.md': 'the product owner ruled; see reef#1\n', 'b.js': '// webkitTextFillColor is not a handle\n' }), hashesFile: hashes });
  assert.equal(r.files, 2);
  assert.equal(r.privateEntries, 1);
  assert.deepEqual(r.hits, []);
});

test('RED: a hashed person handle, in any case, as a whole token — and not as a substring', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ 'a.md': `x\n(${PLANTED_HANDLE.toUpperCase()} 2026-10-31)\n`, 'b.md': `prefix${PLANTED_HANDLE}suffix\n` }), hashesFile: hashes });
  assert.deepEqual(r.hits, ['a.md:2: person handle #2']);
});

test('RED: a handle in a file PATH', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ [`docs/${PLANTED_HANDLE}-notes.md`]: 'clean\n' }), hashesFile: hashes });
  assert.equal(r.hits.length, 1);
  assert.match(r.hits[0], /\(in the path\) person handle #2$/);
});

test('RED: an entry from the private list read OUTSIDE the repo', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ 'a.md': `a sample: ${PLANTED_PRIVATE}.example\n` }), hashesFile: hashes });
  assert.deepEqual(r.hits, ['a.md:1: private list entry #1']);
});

test('RED: a link to a private repo; a bare repo#N is allowed', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ 'a.md': `ok reef#1\nbad ${PRIVATE_LINK}\nbad https://github.com/${PRIVATE_LINK.replace('#', '/issues/')}\n` }), hashesFile: hashes });
  assert.deepEqual(r.hits.map((h) => h.split(': ')[0]), ['a.md:2', 'a.md:3']);
});

test('no private list: skipped out loud, and a failure when it is required', () => {
  const { hashes } = lists();
  process.env.CVER_FORBIDDEN_TERMS = path.join(os.tmpdir(), 'there-is-no-list-here');
  const root = repo({ 'a.md': 'clean\n' });
  const loose = scan({ root, hashesFile: hashes, required: false });
  assert.equal(loose.privateEntries, 0);
  assert.ok(loose.notes.some((n) => !n.fatal && /NOT checked/.test(n.text)));
  const strict = scan({ root, hashesFile: hashes, required: true });
  assert.ok(strict.notes.some((n) => n.fatal));
});

test('CLI: exits non-zero on a hit and never prints the matched text', () => {
  const { hashes, priv } = lists();
  const root = repo({ ...filler(), 'leak.md': `by ${PLANTED_HANDLE}\nexample ${PLANTED_PRIVATE}\n` });
  const res = spawnSync(process.execPath, [GATE, '--root', root, '--hashes', hashes], { encoding: 'utf8', env: { ...process.env, CVER_FORBIDDEN_TERMS: priv } });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /leak\.md:1: person handle #2/);
  assert.match(res.stderr, /leak\.md:2: private list entry #1/);
  assert.ok(!(res.stdout + res.stderr).includes(PLANTED_HANDLE) && !(res.stdout + res.stderr).includes(PLANTED_PRIVATE), 'the refusal printed the term');
  // control: the same tree without the leak passes
  fs.rmSync(path.join(root, 'leak.md'));
  execFileSync('git', ['-C', root, 'add', '-A']);
  const ok = spawnSync(process.execPath, [GATE, '--root', root, '--hashes', hashes], { encoding: 'utf8', env: { ...process.env, CVER_FORBIDDEN_TERMS: priv } });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('the committed hash list is well-formed and non-empty', () => {
  const r = scan({ root: repo({ 'a.md': 'clean\n' }) });
  assert.ok(r.hashes >= 3, 'the real handle list is suspiciously short');
});

// ── review of #230 ───────────────────────────────────────────────────────────────────────────────

const cli = (root, hashes, env) => spawnSync(process.execPath, [GATE, '--root', root, '--hashes', hashes], { encoding: 'utf8', env: { ...process.env, ...env } });

test('P2: a forbidden term in a FILE NAME is never printed — the path is withheld, every tier, content hits too', () => {
  const { hashes, priv } = lists();
  const repoLinkDir = ['CVERInc', 'reef'].join('/');
  const root = repo({
    ...filler(),
    [`docs/${PLANTED_PRIVATE}.md`]: `clean\nby ${PLANTED_HANDLE}\n`,
    [`notes/${PLANTED_HANDLE}-log.md`]: 'clean\n',
    [`${repoLinkDir}/notes.md`]: 'clean\n',
  });
  const res = cli(root, hashes, { CVER_FORBIDDEN_TERMS: priv });
  const out = res.stdout + res.stderr;
  assert.equal(res.status, 1, out);
  for (const secret of [PLANTED_PRIVATE, PLANTED_HANDLE, repoLinkDir]) assert.ok(!out.includes(secret), `the refusal printed ${secret}`);
  assert.match(out, /path withheld/);
  assert.match(out, /\(in the path\) private list entry #1/);
  assert.match(out, /\(in the path\) person handle #2/);
  assert.match(out, /\(in the path\) link to a private repo/);
  assert.match(out, /: person handle #2$/m, 'the content hit inside the withheld file is still reported');
});

test('P3: the private-repo pattern applies to paths, with clean controls', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ [`${['CVERInc', 'reef'].join('/')}/notes.md`]: 'clean\n', 'reef/notes.md': 'clean\n', 'docs/reef-notes.md': 'clean\n' }), hashesFile: hashes });
  assert.equal(r.hits.length, 1, r.hits.join('\n'));
  assert.match(r.hits[0], /\(in the path\) link to a private repo/);
});

// The push-time content guard reads the same list as ONE extended regex: comments stripped, entries
// joined with `|`, `grep -niE`. That pipeline, run here verbatim, is the oracle.
function contentGuardOracle(listFile, line) {
  const pat = execFileSync('bash', ['-c', `grep -vE '^\\s*(#|$)' "$1" | paste -sd'|' -`, '_', listFile], { encoding: 'utf8' }).trim();
  return spawnSync('grep', ['-niE', pat], { input: `+${line}\n` }).status === 0;
}

test('P2: the private list keeps grep -E semantics — POSIX classes agree with the push guard on every sample', () => {
  const { hashes } = lists();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-ere-'));
  made.push(dir);
  const priv = path.join(dir, 'private');
  fs.writeFileSync(priv, `# synthetic, ERE with POSIX classes\n(^|[^[:alnum:]_])${PLANTED_PRIVATE}([^[:alnum:]_]|$)\n[[:digit:]]{3}-zzsynthcode\n`);
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const samples = [
    `example: ${PLANTED_PRIVATE}.`, `${PLANTED_PRIVATE.toUpperCase()}`, `x${PLANTED_PRIVATE}`, `${PLANTED_PRIVATE}_y`,
    'ref 123-zzsynthcode', 'ref 12-zzsynthcode', 'ref abc-zzsynthcode', 'nothing here',
  ];
  let agreedRed = 0;
  for (const s of samples) {
    const expected = contentGuardOracle(priv, s);
    const got = scan({ root: repo({ 'a.md': `${s}\n` }), hashesFile: hashes }).hits.length > 0;
    assert.equal(got, expected, `gate and content guard disagree on ${JSON.stringify(s)}: gate ${got}, guard ${expected}`);
    if (expected) agreedRed++;
  }
  assert.ok(agreedRed >= 3 && agreedRed < samples.length, 'the oracle samples must include both hits and misses');
});

test('P2: a private entry grep -E cannot compile is refused, not skipped', () => {
  const { hashes } = lists();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-bad-'));
  made.push(dir);
  const priv = path.join(dir, 'private');
  fs.writeFileSync(priv, 'ok-term\n[[:nosuchclass:]]x\n');
  process.env.CVER_FORBIDDEN_TERMS = priv;
  assert.throws(() => scan({ root: repo({ 'a.md': 'clean\n' }), hashesFile: hashes }), /private list entry #2/);
});

test('P3: an existing but EMPTY private list counts as missing — fatal when required', () => {
  const { hashes } = lists();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-empty-'));
  made.push(dir);
  const priv = path.join(dir, 'private');
  fs.writeFileSync(priv, '# comments only\n\n');
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const root = repo({ 'a.md': 'clean\n' });
  assert.ok(scan({ root, hashesFile: hashes, required: true }).notes.some((n) => n.fatal), 'an empty required list passed');
  assert.ok(scan({ root, hashesFile: hashes, required: false }).notes.some((n) => !n.fatal && /NOT checked/.test(n.text)));
});

// ── review round 2 of #230: portable grep protocol ───────────────────────────────────────────────
// GNU grep's `-Z` is "NUL after the file name"; Apple's grep spells that `--null` and reads `-Z` as
// "decompress". A gate that parses file-name output works on one and silently finds nothing on the
// other. This shim gives the gate Apple's meaning of those two flags (and runs the real grep for
// everything else), so the GNU machine running this suite also answers for macOS.
function appleGrepShim() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-applegrep-'));
  made.push(dir);
  const real = execFileSync('bash', ['-c', 'type -P grep'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(dir, 'grep'), `#!/usr/bin/env bash
# Apple text_cmds grep: -Z = decompress (no output change for plain text), --null = NUL after file name.
args=()
for a in "$@"; do
  case "$a" in
    -Z) ;;
    --null) args+=(-Z) ;;
    -*Z*) [[ "$a" == --* ]] && args+=("$a") || args+=("\${a//Z/}") ;;
    *) args+=("$a") ;;
  esac
done
exec ${JSON.stringify(real)} "\${args[@]}"
`, { mode: 0o755 });
  return dir;
}

for (const flavour of ['gnu', 'apple']) {
  test(`P2 portability (${flavour} grep): a private-list hit in file CONTENT is found`, () => {
    const { hashes, priv } = lists();
    const root = repo({ ...filler(), 'a.md': `x\n${PLANTED_PRIVATE}\n` });
    const PATH = flavour === 'apple' ? `${appleGrepShim()}:${process.env.PATH}` : process.env.PATH;
    const res = cli(root, hashes, { CVER_FORBIDDEN_TERMS: priv, PATH });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /a\.md:2: private list entry #1/);
  });
}

test('P3: a tracked file literally named "-" is scanned, not read as standard input', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ '-': `clean\n${PLANTED_PRIVATE}\n`, 'b.md': 'clean\n' }), hashesFile: hashes });
  assert.deepEqual(r.hits, ['-:2: private list entry #1']);
});

// ── tier 4: shapes that need no list ─────────────────────────────────────────────────────────────
// Every value below is made up, and every one that would be a hit is ASSEMBLED at run time: this file
// is tracked, so the gate reads it too, and a literal here would turn the real tree red.
const AT = '@';
const addr = (local, domain) => local + AT + domain;
const tail = (n) => 'Zz0'.repeat(Math.ceil(n / 3)).slice(0, n);
const SECRET_SAMPLES = {
  'payment-provider secret key': ['sk', 'live', tail(24)].join('_'),
  'payment-provider secret key (test mode)': ['sk', 'test', tail(24)].join('_'),
  'payment-provider secret key (restricted)': ['rk', 'live', tail(24)].join('_'),
  'webhook signing secret': ['whsec', tail(32)].join('_'),
  'GitHub token': ['ghp', tail(36)].join('_'),
  'GitHub token (fine-grained)': ['github', 'pat', tail(22), tail(40)].join('_'),
  'Slack token': ['xoxb', '000000000000', tail(24)].join('-'),
  'AWS access key id': 'AKIA' + 'Z0'.repeat(8),
  'PEM private key header': ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '),
  'PEM private key header (PKCS#8)': ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' '),
};
const tier4 = (files) => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  return scan({ root: repo(files), hashesFile: hashes }).hits;
};

test('tier 4 RED: an address on a real-looking domain, and only its kind is reported', () => {
  const real = addr('someone.made-up', 'made-up-mail-host.com');
  assert.deepEqual(tier4({ 'a.md': `clean\ncontact ${real} today\n` }), ['a.md:2: e-mail address']);
});

test('tier 4 RED: two addresses on one line are judged separately — a reserved one does not excuse its neighbour', () => {
  const line = `${addr('a', 'b.test')} ${addr('real', 'b.test.com')}`;
  assert.deepEqual(tier4({ 'a.md': `${line}\n` }), ['a.md:1: e-mail address'], 'exactly one hit for the line');
  // the same line with both on reserved domains is clean, so the hit above is the second address
  assert.deepEqual(tier4({ 'a.md': `${addr('a', 'b.test')} ${addr('real', 'b.example')}\n` }), []);
});

test('tier 4 control: reserved and example domains, a density file name, a scoped package and an action ref are not addresses', () => {
  const body = [
    addr('a', 'b.test'), addr('a', 'sub.b.example'), addr('a', 'x.invalid'), addr('a', 'x.localhost'),
    addr('a', 'example.com'), addr('a', 'www.example.org'), `<${addr('a', 'example.net')}>.`,
    `sentence ending in ${addr('a', 'b.test')}.`,
    'src="icon' + AT + '2x.png"', 'icon_16x16' + AT + '3x.webp', 'uses: actions/checkout' + AT + 'v4', 'npm i pkg' + AT + '1.2.3',
  ].join('\n') + '\n';
  assert.deepEqual(tier4({ 'a.md': body, ['img/icon' + AT + '2x.png']: 'not really an image\n' }), []);
});

test('tier 4 RED: an excuse needs the WHOLE domain and a COMPLETE address', () => {
  const lines = [
    addr('a', 'example.com.evil-made-up.net'), // reserved name as a prefix of a longer domain
    addr('a', 'notexample.com'),              // not a subdomain of the reserved name
    addr('a', '2x.com'),                      // the density shape with a real TLD
    addr('a', 'b.test') + 'é.org',       // the ASCII pattern stops early: what it judged is not what was written
    addr('a', 'b.test') + '_x.org',
  ];
  assert.deepEqual(tier4({ 'a.md': lines.join('\n') + '\n' }), lines.map((_, k) => `a.md:${k + 1}: e-mail address`));
});

for (const [label, sample] of Object.entries(SECRET_SAMPLES)) {
  test(`tier 4 RED: secret prefix — ${label}`, () => {
    const kind = `secret prefix (${label.replace(/ \((?:test mode|restricted|fine-grained|PKCS#8)\)$/, '')})`;
    assert.deepEqual(tier4({ 'conf.js': `// clean\nconst k = "${sample}";\n` }), [`conf.js:2: ${kind}`]);
    assert.deepEqual(portableKinds(`KEY=${sample}`), [kind], 'directly after an equals sign');
  });
}

test('tier 4 control: prose about a prefix, and a prefix inside a longer word, are not secrets', () => {
  const body = [
    'keys start with ' + ['sk', 'live', ''].join('_') + ' or ' + ['ghp', ''].join('_'),
    'const risk' + ['', 'live', tail(12)].join('_') + ' = 1;', // the prefix letters inside an identifier
    'the ' + ['-----BEGIN', 'CERTIFICATE-----'].join(' ') + ' block is public',
    'FAKIA' + 'Z0'.repeat(8),
  ].join('\n') + '\n';
  assert.deepEqual(tier4({ 'a.md': body }), []);
});

test('tier 4 control: a base64 blob is left alone, even one that happens to spell an access-key id', () => {
  // deterministic filler over the whole base64 alphabet, with the key-id shape buried mid-run
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let blob = '';
  for (let i = 0; i < 6000; i++) blob += B64[(i * 37 + (i >> 3) * 11) % 64];
  const buried = blob.slice(0, 3000) + 'AKIA' + 'Z0'.repeat(8) + blob.slice(3000) + '==';
  const css = `@font-face { font-family: "x"; src: url(data:font/woff2;base64,${buried}) format("woff2"); }\n`;
  assert.deepEqual(tier4({ 'fonts.css': css, 'blob.txt': `${blob}\n${buried}\n` }), []);
  // the same shape standing on its own in that file is still refused
  assert.deepEqual(tier4({ 'fonts.css': css + 'id: ' + 'AKIA' + 'Z0'.repeat(8) + '\n' }), ['fonts.css:2: secret prefix (AWS access key id)']);
});

test('tier 4 control: a binary file is not read, and its name is still judged', () => {
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]), Buffer.from(addr('someone', 'made-up-mail-host.com'))]);
  assert.deepEqual(tier4({ ['img/icon' + AT + '2x.png']: bytes }), []);
  const hits = tier4({ [`img/${addr('someone', 'made-up-mail-host.com')}.png`]: bytes });
  assert.equal(hits.length, 1);
  assert.match(hits[0], /^\[path withheld[^\]]*\]: \(in the path\) e-mail address$/);
});

test('tier 4 RED: full-width Latin letters — a run of three, and a full-width form hiding another shape', () => {
  const wide = (s) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
  assert.deepEqual(tier4({ 'a.md': `clean\nbrand ${wide('Made')}　${wide('Up')}\n` }), ['a.md:2: full-width Latin letters']);
  // one or two full-width letters is ordinary CJK typography, and full-width punctuation is not a letter
  assert.deepEqual(tier4({ 'a.md': `寬度 ${wide('A')}4，${wide('kg')}！\n` }), []);
  // a full-width at-sign or underscore does not hide what the ASCII patterns look for
  assert.deepEqual(portableKinds('someone' + wide(AT) + 'made-up-mail-host.com'), ['e-mail address']);
  assert.deepEqual(portableKinds('sk' + wide('_') + 'live_' + tail(24)), ['secret prefix (payment-provider secret key)']);
});

test('tier 4 CLI: exits non-zero, names path:line and the kind, and never prints what matched', () => {
  const { hashes, priv } = lists();
  const real = addr('someone.made-up', 'made-up-mail-host.com');
  const key = SECRET_SAMPLES['GitHub token'];
  const root = repo({ ...filler(), 'leak.md': `write to ${real}\ntoken ${key}\n` });
  const res = cli(root, hashes, { CVER_FORBIDDEN_TERMS: priv });
  const out = res.stdout + res.stderr;
  assert.equal(res.status, 1, out);
  assert.match(res.stderr, /leak\.md:1: e-mail address$/m);
  assert.match(res.stderr, /leak\.md:2: secret prefix \(GitHub token\)$/m);
  for (const secret of [real, 'made-up-mail-host', key, key.slice(0, 12)]) assert.ok(!out.includes(secret), 'the refusal printed what it matched');
});
