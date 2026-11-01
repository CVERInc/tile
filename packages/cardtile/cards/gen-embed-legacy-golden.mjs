// What every LEGACY `embed` line rendered before reef#2725 renamed the carousel `slides`.
//
//   node packages/cardtile/cards/gen-embed-legacy-golden.mjs <tile checkout at the pre-rename ref>
//
// Writes cards/embed-legacy.golden.json: for each line, the card's grid (`<div class="st-cells">…`)
// as THAT checkout's renderer drew it. embed-html.test.mjs renders the same lines with the current
// renderer and compares. 🔴 Two renders of HEAD agree with each other whatever HEAD does — the
// expectation has to come from the renderer that was there before the change, and be frozen.
//
// The grid only, not the page: the page carries the footer's year, which would turn this red every
// January for no reason. The ref is recorded in the file; regenerating it from HEAD would make the
// comparison a tautology, and the generator refuses a checkout whose renderer knows `slides`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LEGACY_EMBED_LINES, gridOf, legacyCard } from './embed-legacy-lines.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tree = process.argv[2];
if (!tree) { console.error('usage: gen-embed-legacy-golden.mjs <tile checkout at the pre-rename ref>'); process.exit(2); }
const src = fs.readFileSync(path.join(tree, 'packages/cardtile/card-render.mjs'), 'utf8');
if (/case 'slides'/.test(src)) { console.error('✗ that renderer already knows `slides` — the golden must come from BEFORE the rename'); process.exit(1); }
const ref = execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const { renderCardHTML } = await import(path.join(tree, 'packages/cardtile/serve/card-worker.mjs'));
const out = { ref, generator: 'packages/cardtile/cards/gen-embed-legacy-golden.mjs', grids: {} };
for (const line of LEGACY_EMBED_LINES) out.grids[line] = gridOf(renderCardHTML(legacyCard(line), { handle: 't', cardUrl: 'https://t.example/' }));
fs.writeFileSync(path.join(HERE, 'embed-legacy.golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote embed-legacy.golden.json — ${LEGACY_EMBED_LINES.length} lines from tile@${ref.slice(0, 7)}`);
