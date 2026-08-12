#!/usr/bin/env node
/* tugtile migration tests: kanban-format → clean tugtile-native format.
 * Loads the CORE block from plugin.src.js (same approach as core.test.cjs) and exercises migrateToTugtile.
 * Run: node test/migrate.test.cjs
 */
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'hosts', 'obsidian', 'tugtile', 'plugin.src.js'), 'utf8');
const startIdx = src.indexOf('function tileRenderText');
const endIdx = src.indexOf('/* ===================== /CORE');
assert.ok(startIdx !== -1 && endIdx > startIdx, 'CORE block not found');
const core = new Function(src.slice(startIdx, endIdx) + '\nreturn { parseFile, serializeFile, migrateToTugtile, hasKanbanFormat };')();
const { parseFile, serializeFile, migrateToTugtile, hasKanbanFormat } = core;
assert.strictEqual(typeof migrateToTugtile, 'function', 'migrateToTugtile not loaded');

const L = (...lines) => lines.join('\n');
const F = '```';
const kanban = L(
  '---', '', 'kanban-plugin: board', '', '---', '',
  '## To Do', '',
  '- [ ] Card A', '\tcontinuation', '- [ ] Card B ^abc123', '', '',
  '## Done', '', '**Complete**', '',
  '- [x] Done card', '', '',
  '%% kanban:settings', F,
  '{"kanban-plugin":"board","list-collapse":[false,false],"tag-action":"kanban","date-colors":[{"color":"red"}],"show-checkboxes":true}',
  F, '%%', ''
);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

const before = parseFile(kanban);
const out = migrateToTugtile(kanban);
const after = parseFile(out);

// Markers renamed
ok(/tugtile-plugin: board/.test(out), 'frontmatter → tugtile-plugin');
ok(!/kanban-plugin/.test(out), 'no kanban-plugin token remains');
ok(out.indexOf('%% tugtile:settings') !== -1, 'settings marker → tugtile:settings');
ok(out.indexOf('kanban:settings') === -1, 'no kanban:settings marker remains');

// Structure preserved
ok(after.columns.length === before.columns.length, 'lane count preserved');
ok(after.columns[0].tiles.length === before.columns[0].tiles.length, 'tile count preserved');
ok(after.columns[0].tiles.map((t) => t.raw).join('|') === before.columns[0].tiles.map((t) => t.raw).join('|'), 'tile raw preserved (incl ^blockId / continuation)');
ok((after.columns[1].lead || []).join('\n').indexOf('**Complete**') !== -1, 'Complete lane lead preserved');

// Settings cleaned
ok(JSON.stringify(after.settings['list-collapse']) === '[false,false]', 'known key list-collapse kept');
ok(after.settings['show-checkboxes'] === true, 'known key show-checkboxes kept');
ok(after.settings['tag-action'] === 'board', 'tag-action kanban → board');
ok(after.settings['date-colors'] === undefined, 'kanban-only key date-colors dropped');
ok(after.settings['kanban-plugin'] === undefined, 'kanban-plugin settings key dropped');

// Idempotent
ok(migrateToTugtile(out) === out, 'migration is idempotent');

// Detection
ok(hasKanbanFormat(kanban) === true, 'hasKanbanFormat true for kanban file');
ok(hasKanbanFormat(out) === false, 'hasKanbanFormat false after upgrade');

console.log('✅ migrate all pass (' + pass + ')');
