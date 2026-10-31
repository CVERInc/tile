// The source a section component renders from, for the tests that read it.
//
// Since tile-lab#52 a section's markup can live in two files: the `.astro` component, which reads
// the params (`pm.<name>` — coral-params.test.mjs), and the `packages/emit/` module it imports,
// which writes the markup. A scanner that read only the `.astro` would keep passing after the markup
// left it — measuring a wrapper with nothing in it. Every section scanner reads through here.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SECTIONS_DIR = join(HERE, 'astro', 'src', 'components', 'sections');
export const EMIT_DIR = join(HERE, '..', 'emit');

/**
 * `{ astro, emit, all }` for one component file (`'Prose.astro'`): its own text, the text of every
 * `@emit/<module>` it imports (joined), and both together.
 */
export function sectionSource(file) {
  const astro = readFileSync(join(SECTIONS_DIR, file), 'utf8');
  const emit = [...astro.matchAll(/^import\s*\{[^}]*\}\s*from\s*'@emit\/([\w-]+\.mjs)';?\s*$/gm)]
    .map((m) => readFileSync(join(EMIT_DIR, m[1]), 'utf8'))
    .join('\n');
  return { astro, emit, all: emit ? astro + '\n' + emit : astro };
}
