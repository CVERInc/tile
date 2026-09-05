// No real host appears in a fixture unless somebody said it may.
//
// 🩸 WHY. On 2026-08-12 this package was audited for graduation to a public repo and ~40 customer
// identifiers came out of it — comments, a measurement table, a runbook, and the two that mattered
// most: a creator's own subdomain sitting in an allowlist test, and the same host as a render input.
// A customer's domain in a public test does not read as history. It reads as sample data.
//
// 🔴 THE LIST HERE IS THE ALLOWED ONES, NOT THE FORBIDDEN ONES, and the inversion is the whole
// point. A denylist of the customers you must not name is itself a list of your customers — it
// cannot live in a repo that may be published, and it only ever catches the names somebody thought
// to add. An allowlist catches the next one too, and it is safe to publish because it says nothing
// about who our customers are: RFC 2606 reserved names, the platforms whose favicons we fetch, and
// our own hosts.
//
// Adding an entry is cheap and that is fine — the gate is that you have to look at it and say why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = dirname(fileURLToPath(import.meta.url));

/** Hosts a fixture may name, each because of something other than "it was there already". */
const ALLOW = new Set([
  // ours
  'card.feelreef.com', 'feelreef.com', 'saas.feelreef.com', 'cver.net',
  // platforms the renderer knows by name — their marks, their embeds, their oEmbed
  'www.youtube.com', 'youtube.com', 'youtu.be', 'instagram.com', 'www.instagram.com',
  'x.com', 'twitter.com', 'www.facebook.com', 'facebook.com', 'patreon.com', 'www.patreon.com',
  'store.line.me', 'line.me', 'icons.duckduckgo.com', 'goo.gl', 'plausible.io',
  // stand-ins we minted, kept because a card needs to look like a card
  'card.inkbrush.com', 'vip.paperloom.com', 'shop.example.co.uk', 'placehold.co',
  // 🔴 Each of these was surfaced by this gate on its first run, and each is here for a reason that
  // is NOT "it was already there". That is the workflow: the check does not know what is innocent,
  // it only insists somebody looked.
  'evil.com',        // the hostile-input fixture — a link that must NOT be trusted needs a host
  'bit.ly',          // a shortener, tested as the real-world shape it is; nobody's card
  'www.w3.org',      // the SVG namespace URI. Never fetched — it is an identifier, not an address
  'cdn',             // a bare single-label host in synthetic markdown, not a real name
]);

/** …and whole families that can never belong to anyone: RFC 2606 / 6761. */
const ALLOW_RE = [
  /^(.+\.)?example(\.com|\.org|\.net)?$/,   // example.com, a.example, sub.example.org
  /^(.+\.)?(invalid|test|localhost)$/,
  /^127\.0\.0\.1$/, /^0\.0\.0\.0$/, /^localhost$/,
  /^[a-z]$/,                                 // single-letter hosts in synthetic markdown (a, b, c…)
  /^(a|b|c|d|e|f|g|h|i|j)\.com$/,            // the alphabet hosts cell-layer builds its grid from
];

const allowed = (host) => ALLOW.has(host) || ALLOW_RE.some((re) => re.test(host));

/** Files whose content is FIXTURE — things a reader would copy as an example. */
function fixtureFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { fixtureFiles(p, out); continue; }
    if (/\.test\.(mjs|js)$/.test(name) || /\.card\.md$/.test(name)) out.push(p);
  }
  return out;
}

/** Every hostname in a URL literal, with the line it sits on. */
function hostsIn(text) {
  const found = [];
  const re = /https?:\/\/([A-Za-z0-9.-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    found.push({ host: m[1].toLowerCase(), line: text.slice(0, m.index).split('\n').length });
  }
  return found;
}

test('no fixture names a host that has not been allowed', () => {
  const files = fixtureFiles(PKG);
  assert.ok(files.length >= 5, `only ${files.length} fixture file(s) found — the walk is not finding them`);

  let seen = 0;
  const bad = [];
  for (const f of files) {
    for (const { host, line } of hostsIn(readFileSync(f, 'utf8'))) {
      seen++;
      if (!allowed(host)) bad.push(`${relative(PKG, f)}:${line}  ${host}`);
    }
  }

  // 🔴 CONTROL for the scan itself: a run that found no hosts would pass on nothing at all, and
  // that is exactly how this file would rot — a walk that stops matching, reporting a clean tree.
  assert.ok(seen > 40, `only ${seen} host(s) seen across ${files.length} files — the extractor is not matching`);

  // 🔴 CONTROL for the verdict: a host that is obviously somebody's must be rejected. Without this,
  // an ALLOW_RE that accidentally matched everything would look identical to a clean tree.
  assert.equal(allowed('shop.somebodyelse.tw'), false, 'CONTROL: the allowlist accepts an arbitrary host');
  assert.equal(allowed('example.com'), true, 'CONTROL: and it does accept the reserved ones');

  assert.deepEqual(bad, [], `${bad.length} fixture host(s) nobody has allowed:\n    ${bad.join('\n    ')}\n`
    + '  → move it to example.com / a.example, or add it to ALLOW with a reason. A real host in a\n'
    + '    fixture reads as sample data, and somebody\'s card is not our sample.');
});
