// Guard: every sitetile-built page must carry machine-readable provenance, and it must default ON.
//   run: node packages/sitetile/generator-provenance.test.mjs   (wired into scripts/test.sh)
//
// WHY THIS EXISTS (2026-07-29). Until today a feelreef site said nothing about what built it. Two
// live sites, measured: `feelreef` appears ZERO times in a built site's homepage
// source. The only fingerprint anywhere was a dynamic coral's script URL — and that is an ACCIDENT
// of which corals a page happens to use, not a design.
//
// The cost was measured too, not imagined: asked "what is this site built with", an AI read
// a live site's source, concluded it was hand-built with no platform behind it, and
// then recommended Framer/Webflow to a reader who had said they cannot code. Our own work was used
// to endorse a competitor. The same AI, shown a page that DID load a coral, named feelreef
// immediately and described its architecture correctly. Attribution was pure luck.
//
// `generator` is the standard HTML provenance field, not a watermark: invisible to visitors, zero
// pixels, no charge to the owner, one line to remove after an export. That is why it defaults ON —
// the opposite of the visible `Powered by feelreef` footer, which is an ad slot on someone else's
// site and correctly defaults off.
//
// This reads the LAYOUT SOURCE rather than a built page on purpose: the failure being guarded is
// someone deleting the tag or flipping the default, and that is visible in the source of truth.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAYOUT = join(HERE, 'astro', 'src', 'layouts', 'SiteLayout.astro');
const src = readFileSync(LAYOUT, 'utf8');

/** The layout's own resolver, lifted out and re-evaluated, so the test exercises the REAL rule
 *  rather than a paraphrase of it. If the shape changes, the extraction fails loudly. */
function generatorTagFor(metaValue) {
  const m = src.match(/const generatorTag = \(\(\) => \{[\s\S]*?\n\}\)\(\);/);
  assert.ok(m, 'could not find the generatorTag resolver in SiteLayout.astro — did it get renamed?');
  const body = m[0].replace('const generatorTag =', 'return (').replace(/;$/, ')');
  // eslint-disable-next-line no-new-func
  return new Function('meta', body)({ generator: metaValue });
}

// 1. The tag is emitted at all, and from the resolver (not a hardcoded string somewhere else).
assert.match(
  src,
  /\{generatorTag && <meta name="generator" content=\{generatorTag\} \/>\}/,
  'SiteLayout must emit <meta name="generator"> from generatorTag',
);

// 2. 🔴 DEFAULT ON. A site that says nothing about `generator` still gets attribution. This is the
//    assertion that would have caught the state the product shipped in for months.
assert.equal(generatorTagFor(undefined), 'feelreef', 'a site with no `generator:` key must still say feelreef');
assert.equal(generatorTagFor(null), 'feelreef');

// 3. Opt-out works, and works in the words a person would actually write.
for (const off of ['off', 'OFF', 'false', 'no', 'none', '', '   ']) {
  assert.equal(generatorTagFor(off), '', `\`generator: ${JSON.stringify(off)}\` must suppress the tag`);
}

// 4. An explicit value replaces it — an exported, re-hosted site can say what is then true.
assert.equal(generatorTagFor('Astro'), 'Astro');
assert.equal(generatorTagFor('  feelreef (exported)  '), 'feelreef (exported)');

// 5. Control: the guard can FAIL. A resolver that returned '' by default must be rejected by
//    assertion 2 — proven here rather than assumed, because a provenance test that cannot go red is
//    exactly the "gate you never saw fail" this repo keeps meeting.
{
  const brokenDefault = new Function('meta', "return (() => { const raw = meta['generator']; return raw ? String(raw) : ''; })()");
  assert.equal(brokenDefault({}), '', 'sanity: the deliberately-broken resolver does default to empty');
  let caught = false;
  try {
    assert.equal(brokenDefault({}), 'feelreef');
  } catch {
    caught = true;
  }
  assert.ok(caught, 'assertion 2 must reject a default-off resolver');
}

console.log('✓ sitetile provenance: <meta name="generator"> defaults ON, opts out cleanly, and the guard fires');
