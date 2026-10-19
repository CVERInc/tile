import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Follow only runtime local imports, never tests, generated bundles or sibling tools.
export function sourceFor(entry, seen = new Set()) {
  if (seen.has(entry)) return '';
  seen.add(entry);
  const source = readFileSync(entry, 'utf8');
  return source + [...source.matchAll(/\bimport\s[\s\S]*?from\s*['"](\.[^'"]+)['"]/g)]
    .map(([, path]) => sourceFor(resolve(dirname(entry), path), seen)).join('\n');
}

export function attributeReads(source) {
  const names = new Set();
  for (const [, name] of source.matchAll(/\bgetAttribute\(\s*['"](data-[\w-]+)['"]/g)) names.add(name);
  // Both helpers in this catalogue take literal names; inbox prefixes data-, sponsor doesn't.
  for (const [, name] of source.matchAll(/\battr\(\s*['"]([\w-]+)['"]/g)) names.add(name.startsWith('data-') ? name : `data-${name}`);
  for (const match of source.matchAll(/\.dataset(?:\.([\w]+)\b|\[['"]([\w-]+)['"]\])(?!\s*=(?!=))/g)) {
    names.add('data-' + (match[1] || match[2]).replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
  }
  for (const [, name] of source.matchAll(/(?:closest|querySelector(?:All)?)\(\s*['"]\[(data-[\w-]+)/g)) names.add(name);
  // Constants used as getAttribute arguments are still statically resolvable.
  for (const [, symbol, name] of source.matchAll(/\bconst\s+(\w+)\s*=\s*['"](data-[\w-]+)['"]/g)) {
    if (source.includes(`getAttribute(${symbol})`)) names.add(name);
  }
  return names;
}

// These are read from generated content or the document, not embed configuration.
export const INTERNAL = {
  'data-dynamic-coral': 'Mount selector shared by every coral.',
  'data-dynamic-coral-mounted': 'Runtime mount guard written by the coral.',
  'data-dynamic-coral-css': 'Document-level CSS layering policy, not a mount option.',
  'data-cancel': 'Cancel control inside the generated inbox dialog.',
  'data-loc': 'Location on generated event links.',
  'data-start': 'Timestamp on generated event entries.',
  'data-end': 'Timestamp on generated event entries.',
  'data-amount': 'Amount on generated sponsor preset buttons.',
  'data-variation-id': 'Variation on server-rendered shop cards.',
  'data-price': 'Price on server-rendered shop cards.',
  'data-variant-count': 'Variant count on server-rendered shop cards.',
  'data-price-min': 'Minimum price on server-rendered shop cards.',
  'data-price-max': 'Maximum price on server-rendered shop cards.',
  'data-variants': 'Variants on server-rendered shop cards.',
  'data-currency': 'Currency on server-rendered shop cards (also a sponsor option).',
  'data-slug': 'Slug on server-rendered shop cards.',
};

// Explicitly account for the names passed through inbox-bubble's computed data-${name} helper.
export const DYNAMIC_NAMES = {
  'inbox-bubble': {
    'data-open-label': 'copyFor passes open-label through the prefixing attr helper.',
    'data-title': 'copyFor passes title through the prefixing attr helper.',
    'data-placeholder': 'copyFor passes placeholder through the prefixing attr helper.',
    'data-send-label': 'copyFor passes send-label through the prefixing attr helper.',
  },
};
