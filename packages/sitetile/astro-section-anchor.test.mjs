// Every Astro section component stamps the section's id on its own <section>.
//   run: node packages/sitetile/astro-section-anchor.test.mjs
//
// 🩸 2026-08-18, and the reason this file exists rather than a second copy of
// `section-anchor.test.mjs`: that one tests `site-core.js`, the REFERENCE
// renderer, and passing it proves nothing about what visitors see. Production
// is the Astro layer — `Section.astro` dispatching to `sections/*.astro`, each
// of which writes its own `<section>` tag. Patching the reference renderer and
// declaring the feature done is `a-rule-you-changed-that-was-never-in-effect`:
// the edit is real, the test is green, and the live pages never change.
//
// 🔴 SOURCE-LEVEL ON PURPOSE. `Section.astro` cannot stamp the id centrally the
// way site-core.js can — an Astro component returns its own root element, so
// there is no seam between "component rendered" and "html assembled" to inject
// into, and wrapping it in a <div> would put a stranger between <section> and
// the CSS that selects it as a child. So the id goes on sixteen tags across
// fourteen files, and THIS is what makes that safe: a fifteenth component added
// next year cannot quietly ship without one.
//
// What a miss looks like in production: nothing. The page renders, the link
// resolves, the browser finds no matching id and stays at the top — which reads
// as "the citation is a bit vague", not as a defect. Nothing else goes red.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'astro/src/components/sections');

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

/**
 * Opening `<section` tags that are REAL MARKUP.
 *
 * 🩸 `Collection.astro` documents a competitor's DOM in a comment containing a
 * literal `<section class="px-6">`. A naive count of `<section` reports it as an
 * unstamped tag forever — a permanently red check nobody can fix is a check
 * everybody learns to ignore. Comments are stripped before counting; the
 * survivors all open with the component's own `st-` class or a computed one.
 */
function sectionTags(src) {
	const code = src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l))
		.join('\n');
	return [...code.matchAll(/<section\b[^>]*>/g)].map((m) => m[0]);
}

const files = readdirSync(DIR)
	.filter((f) => f.endsWith('.astro'))
	// Not a section: a cell INSIDE a grid, with no section of its own.
	.filter((f) => f !== 'GridCell.astro');

assert.ok(files.length >= 14, `expected the full component set, found ${files.length}`);

let total = 0;
for (const f of files) {
	const src = readFileSync(join(DIR, f), 'utf8');
	const tags = sectionTags(src);
	assert.ok(tags.length >= 1, `${f}: renders no <section> — is it still a section component?`);

	// It must be able to SEE the id before it can stamp it.
	assert.match(src, /\bsection\b/, `${f}: has no \`section\` prop in scope`);

	for (const tag of tags) {
		assert.match(
			tag,
			/\sid=\{section\.id\}/,
			`${f}: a <section> ships without an anchor —\n    ${tag.slice(0, 110)}`
		);
	}
	total += tags.length;
	ok(`${f} — ${tags.length} <section>, all anchored`);
}

ok(`${total} section tags across ${files.length} components`);

// ── The control, because a green regex check is worth what it can fail on ────
{
	// If the assertion above could not fail, it would be measuring the presence
	// of the string `<section` and nothing more.
	const doctored = `---\nconst { section } = Astro.props;\n---\n<section class="st-fake">x</section>`;
	const tags = sectionTags(doctored);
	assert.equal(tags.length, 1);
	assert.ok(!/\sid=\{section\.id\}/.test(tags[0]), 'the control tag should NOT be anchored');
	ok('control — an unstamped component is detected, not skipped');
}

{
	// And the comment case, since that is the one that would make this check
	// permanently red for a reason that is not a defect.
	const withComment = [
		'---',
		'const { section } = Astro.props;',
		'---',
		'{/* live DOM was `<section class="px-6">` wrapping a div */}',
		'<section id={section.id} class="st-collection">y</section>'
	].join('\n');
	assert.equal(sectionTags(withComment).length, 1, 'a <section> inside a comment was counted');
	ok('control — a <section> written inside a comment is not counted');
}

console.log(`\n${passed} passed`);
