// Every icon the editor core asks for must exist in the Obsidian shim.
//
// Why this test exists: setIcon() is silent on a miss — `ICONS[name] ? svg : ''` — so an icon the shim
// doesn't have renders a BLANK button. It is still there, still sized, still clickable; it just has
// nothing drawn in it. Obsidian never sees this (it has real Lucide), so the gap only shows up on the
// hosts that use the shim — the web previews and the macOS app — and it shows up as "that button is
// missing", which is the one thing it isn't.
//
// That is exactly how the `table` button spent its life invisible on every shim host. A comment saying
// the two files agree is a wish; this is the check.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'packages', 'core');
const core = fs.readFileSync(path.join(dir, 'editor-core.js'), 'utf8');
const shim = fs.readFileSync(path.join(dir, 'obsidian-shim.js'), 'utf8');

const iconsBlock = (() => {
  const start = shim.indexOf('const ICONS = {');
  if (start < 0) throw new Error('obsidian-shim.js: ICONS map not found — did it move or get renamed?');
  const end = shim.indexOf('\n};', start);
  return shim.slice(start, end);
})();

const provided = new Set([...iconsBlock.matchAll(/'?([a-z0-9-]+)'?:\s*'/g)].map((m) => m[1]));
const requested = new Set([
  ...[...core.matchAll(/icon:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
  ...[...core.matchAll(/setIcon\([^,]+,\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
]);

let pass = 0, fail = 0;

// Deliberately not a bare "sets are equal": the shim may carry extras a host needs (arrow-left, trash-2,
// …) that the core never names. Only the one-way direction is a defect.
const missing = [...requested].filter((n) => !provided.has(n)).sort();
if (missing.length === 0) {
  pass++;
} else {
  fail++;
  console.log(`FAIL editor-core asks for icons the shim cannot draw (they render as blank buttons):`);
  missing.forEach((n) => console.log(`  · ${n}`));
}

// A guard on the guard: if the extraction ever silently matches nothing, the check above passes for the
// wrong reason. Both sides must be non-trivially populated for the result to mean anything.
if (requested.size >= 20 && provided.size >= 20) pass++;
else { fail++; console.log(`FAIL icon extraction looks broken — requested=${requested.size} provided=${provided.size}`); }

console.log(fail === 0
  ? `✅ shim-icons all pass (${pass}) — ${requested.size} requested, ${provided.size} provided`
  : `❌ shim-icons ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
