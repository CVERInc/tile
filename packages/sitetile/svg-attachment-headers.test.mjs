// REEF with Site — the `_headers` merge: every `*.svg` a site serves is an attachment, and a site's
// own `_headers` can neither drop that rule nor be rewritten by it.
//   run: node packages/sitetile/svg-attachment-headers.test.mjs   (globbed into scripts/test.sh)
//
// The merge runs at `astro:build:done` on the output directory, where a site's own `_headers` has
// already arrived via public/. These tests drive the same function the hook calls, on real files in
// a scratch directory, and compare BYTES — "the rule is in there somewhere" is also what a
// duplicated rule or a reordered owner file would satisfy. The smoke build asserts the same through
// a real `astro build`.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PLATFORM_RULE, SVG_PATH, MAX_RULES,
  parseRules, hasPlatformRule, mergeHeaders, writeMergedHeaders, svgAttachmentHeaders,
} from './astro/svg-attachment-headers.mjs';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const OWNER_TWO_RULES = `# the owner's own file
/*
  X-Frame-Options: DENY

/blog/*
  Cache-Control: public, max-age=60
`;
/** How many `/*.svg` + attachment blocks a text carries — `hasPlatformRule` only says "at least one". */
const platformRuleCount = (text) => parseRules(text).filter((r) => r.path === SVG_PATH
  && r.headers.some((h) => /^content-disposition:\s*attachment$/i.test(h))).length;

const scratch = mkdtempSync(join(tmpdir(), 'svg-headers-'));
/** A fresh output directory per case, with or without the owner's file in it. */
const makeDist = (name, ownerText) => {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  if (ownerText != null) writeFileSync(join(dir, '_headers'), ownerText, 'utf8');
  return dir;
};

try {
  test('no owner _headers ⇒ the build writes one carrying exactly the platform rule', () => {
    const dir = makeDist('none', null);
    writeMergedHeaders(dir);
    const out = readFileSync(join(dir, '_headers'), 'utf8');
    assert.equal(out, PLATFORM_RULE);
    assert.equal(platformRuleCount(out), 1);
    assert.match(out, /^\/\*\.svg\n  Content-Disposition: attachment\n$/m);
  });

  test('owner _headers with two rules ⇒ owner bytes first, verbatim, platform rule once and last', () => {
    const dir = makeDist('two', OWNER_TWO_RULES);
    writeMergedHeaders(dir);
    const out = readFileSync(join(dir, '_headers'), 'utf8');
    assert.ok(out.startsWith(OWNER_TWO_RULES), 'owner text is a byte-for-byte prefix');
    assert.equal(platformRuleCount(out), 1);
    assert.deepEqual(parseRules(out).map((r) => r.path), ['/*', '/blog/*', SVG_PATH]);
    assert.equal(out, OWNER_TWO_RULES + '\n' + PLATFORM_RULE);
  });

  test('rebuild ⇒ identical bytes (merging an already-merged file changes nothing)', () => {
    for (const [name, owner] of [['re-none', null], ['re-two', OWNER_TWO_RULES], ['re-nonl', '/*\n  X-A: 1']]) {
      const dir = makeDist(name, owner);
      const first = writeMergedHeaders(dir);
      const again = writeMergedHeaders(dir);
      assert.equal(again, first, name);
      assert.equal(readFileSync(join(dir, '_headers'), 'utf8'), first, name);
      assert.equal(platformRuleCount(first), 1, name);
    }
  });

  test('an owner file that already carries the rule is left exactly as it is (not duplicated)', () => {
    const owner = `/*\n  X-Frame-Options: DENY\n\n/*.svg\n\tcontent-disposition:   attachment\n  X-Extra: kept\n`;
    const dir = makeDist('already', owner);
    writeMergedHeaders(dir);
    const out = readFileSync(join(dir, '_headers'), 'utf8');
    assert.equal(out, owner);
    assert.equal(platformRuleCount(out), 1);
  });

  test('CONTROL: things that only LOOK like the rule do not count as it (the rule is still appended)', () => {
    for (const owner of [
      '/*.svg\n  Content-Disposition: inline\n',          // same path, other disposition
      '/img/*.svg\n  Content-Disposition: attachment\n',  // narrower path
      '# /*.svg\n#   Content-Disposition: attachment\n',  // commented out
      '/*.svg\n\n/x\n  Content-Disposition: attachment\n', // header belongs to the next rule
    ]) {
      assert.equal(hasPlatformRule(owner), false, JSON.stringify(owner));
      const out = mergeHeaders(owner);
      assert.ok(out.startsWith(owner));
      assert.ok(out.endsWith(PLATFORM_RULE));
    }
  });

  test('owner CRLF line endings are kept, and the appended rule follows them', () => {
    const owner = '/*\r\n  X-A: 1\r\n';
    const out = mergeHeaders(owner);
    assert.equal(out, owner + '\r\n' + PLATFORM_RULE.replace(/\n/g, '\r\n'));
    assert.equal(mergeHeaders(out), out);
  });

  test('an owner file already at Cloudflare\'s rule limit fails the build instead of shipping without the rule', () => {
    const full = Array.from({ length: MAX_RULES }, (_, i) => `/p${i}\n  X-N: ${i}\n`).join('');
    assert.throws(() => mergeHeaders(full), /limit of 100/);
    const roomForOne = Array.from({ length: MAX_RULES - 1 }, (_, i) => `/p${i}\n  X-N: ${i}\n`).join('');
    assert.equal(parseRules(mergeHeaders(roomForOne)).length, MAX_RULES);
  });

  test('the Astro integration hook merges into the directory Astro hands it', () => {
    const dir = makeDist('hook', OWNER_TWO_RULES);
    const integration = svgAttachmentHeaders();
    integration.hooks['astro:build:done']({ dir: pathToFileURL(dir + '/') });
    assert.equal(readFileSync(join(dir, '_headers'), 'utf8'), OWNER_TWO_RULES + '\n' + PLATFORM_RULE);
  });

  test('the renderer is wired to it: astro.config.mjs registers the integration', () => {
    const config = readFileSync(new URL('./astro/astro.config.mjs', import.meta.url), 'utf8');
    assert.match(config, /integrations:\s*\[[^\]]*svgAttachmentHeaders\(\)/);
    // and the renderer ships no `_headers` of its own in public/: an owner's file would replace it,
    // which is the whole reason the rule is added after the copy instead
    assert.equal(existsSync(new URL('./astro/public/_headers', import.meta.url)), false);
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${process.exitCode ? '❌' : '✅'} svg-attachment-headers: ${passed} passed`);
