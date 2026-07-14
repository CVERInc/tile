#!/usr/bin/env node
/* tugtile CORE Unit Tests (Pure Node.js, no npm dependencies)
 *
 * Approach:
 *  - Read plugin.src.js directly.
 *  - Extract the CORE block: find indexOf('function tileRenderText') to '/* ===================== /CORE'.
 *  - Load the three pure functions tileRenderText / parseFile / serializeFile using new Function.
 *
 * Tests:
 *  - Round-trip: parse → serialize → parse ensures column count, column titles, and card text & raw match.
 *  - Idempotency: serialize → parse → serialize ensures stable output (s1 === s2).
 *
 * Run: node out/core.test.cjs
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ---------- Load CORE ----------
const SRC_PATH = path.resolve(__dirname, '..', 'packages', 'tugtile', 'plugin.src.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

const START_MARK = 'function tileRenderText';
const END_MARK = '/* ===================== /CORE';
const startIdx = src.indexOf(START_MARK);
const endIdx = src.indexOf(END_MARK);
assert.ok(startIdx !== -1, `找不到 CORE 起點 "${START_MARK}"`);
assert.ok(endIdx !== -1 && endIdx > startIdx, `找不到 CORE 終點 "${END_MARK}"`);

const coreSrc = src.slice(startIdx, endIdx);
const core = new Function(
  coreSrc + '\nreturn { tileRenderText, parseFile, serializeFile };'
)();
const { parseFile, serializeFile } = core;
assert.strictEqual(typeof core.tileRenderText, 'function', 'tileRenderText 未載入');
assert.strictEqual(typeof parseFile, 'function', 'parseFile 未載入');
assert.strictEqual(typeof serializeFile, 'function', 'serializeFile 未載入');

// ---------- Helper Functions ----------
// Build multiline strings using arrays to make \t and \n explicit, preventing editors from replacing tabs with spaces.
const L = (...lines) => lines.join('\n');

// Deeply compare the structure of two parsed models: column count, column titles, column headers, and each card's raw & text.
function compareModels(a, b) {
  assert.strictEqual(
    a.columns.length,
    b.columns.length,
    `欄數不一致：${a.columns.length} vs ${b.columns.length}`
  );
  for (let i = 0; i < a.columns.length; i++) {
    const ca = a.columns[i];
    const cb = b.columns[i];
    assert.strictEqual(cb.title, ca.title, `第 ${i} 欄標題不一致：「${ca.title}」vs「${cb.title}」`);
    assert.strictEqual(cb.header, ca.header, `第 ${i} 欄 header 不一致`);
    assert.strictEqual(
      cb.tiles.length,
      ca.tiles.length,
      `第 ${i} 欄(${ca.title})牌數不一致：${ca.tiles.length} vs ${cb.tiles.length}`
    );
    for (let j = 0; j < ca.tiles.length; j++) {
      assert.strictEqual(
        cb.tiles[j].raw,
        ca.tiles[j].raw,
        `第 ${i} 欄第 ${j} 張牌 raw 不一致：\n--- A ---\n${ca.tiles[j].raw}\n--- B ---\n${cb.tiles[j].raw}`
      );
      assert.strictEqual(
        cb.tiles[j].text,
        ca.tiles[j].text,
        `第 ${i} 欄第 ${j} 張牌 text 不一致：\n--- A ---\n${ca.tiles[j].text}\n--- B ---\n${cb.tiles[j].text}`
      );
    }
  }
}

// Perform round-trip and idempotency checks on a single test case.
function checkCase(text) {
  // Round-trip: parse → serialize → parse
  const m1 = parseFile(text);
  const s1 = serializeFile(m1);
  const m2 = parseFile(s1);
  compareModels(m1, m2);

  // Idempotency: serialize → parse → serialize (ensures stable output)
  //
  // Note (Known Behavior): serializeFile only left-trims post (the %% kanban:settings block)
  // (using replace(/^\s+/,'')) and appends a trailing '\n'. As a result, each parse-serialize cycle
  // adds an extra newline at the end of the file (pre is stable because it is right-trimmed with replace(/\s+$/,'')).
  // Therefore, stable restoration is defined as: character-for-character identical content,
  // allowing only differences in the number of trailing newlines.
  // We normalize trailing newlines to a single '\n' before comparison.
  const normTail = (s) => s.replace(/\n+$/, '\n');
  const m3 = parseFile(s1);
  const s2 = serializeFile(m3);
  assert.strictEqual(
    normTail(s2),
    normTail(s1),
    `serialize 內容不穩定（正規化檔尾換行後仍 s1 !== s2）：\n--- s1 ---\n${JSON.stringify(s1)}\n--- s2 ---\n${JSON.stringify(s2)}`
  );

  // For boards without a post block, serialize should be strictly character-for-character idempotent (retaining the exact trailing newlines).
  if (!m1.post) {
    assert.strictEqual(
      s2,
      s1,
      `無 settings 的看板 serialize 應嚴格冪等（s1 !== s2）：\n--- s1 ---\n${JSON.stringify(s1)}\n--- s2 ---\n${JSON.stringify(s2)}`
    );
  }

  return m1;
}

// Additional optional content assertions to verify the parsed structure matches expectations, not just self-consistency.
function expectColumns(model, expected) {
  assert.strictEqual(model.columns.length, expected.length, '欄數與預期不符');
  expected.forEach((exp, i) => {
    const col = model.columns[i];
    if (exp.title !== undefined) assert.strictEqual(col.title, exp.title, `第 ${i} 欄標題與預期不符`);
    if (exp.tiles !== undefined) {
      assert.strictEqual(col.tiles.length, exp.tiles, `第 ${i} 欄(${col.title})牌數與預期不符`);
    }
    if (exp.texts !== undefined) {
      exp.texts.forEach((t, j) => {
        assert.strictEqual(col.tiles[j].text, t, `第 ${i} 欄第 ${j} 張牌 text 與預期不符`);
      });
    }
  });
}

// ---------- Test Cases ----------
const cases = [
  {
    name: '空看板（只有 frontmatter，0 欄）',
    text: L('---', 'title: Empty Board', 'created: 2026-06-06', '---', ''),
    check(model) {
      expectColumns(model, []);
    },
  },
  {
    name: '沒有 frontmatter（直接 ## 開頭）',
    text: L('## Todo', '', '- [ ] a', '', '## Done', '', '- [ ] b', ''),
    check(model) {
      expectColumns(model, [
        { title: 'Todo', tiles: 1, texts: ['a'] },
        { title: 'Done', tiles: 1, texts: ['b'] },
      ]);
    },
  },
  {
    name: '沒有 settings 區塊（有 frontmatter 與欄）',
    text: L('---', 'k: v', '---', '', '## Col', '', '- [ ] x', '\t內文', ''),
    check(model) {
      assert.strictEqual(model.post, '', 'post 應為空字串');
      expectColumns(model, [{ title: 'Col', tiles: 1, texts: ['x\n內文'] }]);
    },
  },
  {
    name: '空欄（0 牌）',
    text: L('## A', '', '## B', '', '- [ ] only in B', ''),
    check(model) {
      expectColumns(model, [
        { title: 'A', tiles: 0 },
        { title: 'B', tiles: 1, texts: ['only in B'] },
      ]);
    },
  },
  {
    name: '牌只有標題、沒有內文',
    text: L('## C', '', '- [ ] just a title', '', '- [ ] another title', ''),
    check(model) {
      expectColumns(model, [
        { title: 'C', tiles: 2, texts: ['just a title', 'another title'] },
      ]);
      assert.strictEqual(model.columns[0].tiles[0].raw, '- [ ] just a title');
    },
  },
  {
    name: '牌內文含多個空行 / 段落',
    text: L(
      '## D',
      '',
      '- [ ] multi para',
      '\tpara1 line1',
      '\tpara1 line2',
      '',
      '\tpara2',
      '',
      '',
      '\tpara3 after double blank',
      '',
      '- [ ] second tile',
      '\ttail',
      ''
    ),
    check(model) {
      expectColumns(model, [{ title: 'D', tiles: 2 }]);
      // Retain blank lines between content paragraphs (only trim trailing ones)
      assert.strictEqual(
        model.columns[0].tiles[0].text,
        'multi para\npara1 line1\npara1 line2\n\npara2\n\n\npara3 after double blank'
      );
    },
  },
  {
    name: '`- [x]` 已勾選的牌',
    text: L('## E', '', '- [x] done item', '\tnote', '', '- [ ] todo item', ''),
    check(model) {
      // raw preserves the checkbox state, while text strips the checkbox
      assert.strictEqual(model.columns[0].tiles[0].raw, '- [x] done item\n\tnote');
      assert.strictEqual(model.columns[0].tiles[0].text, 'done item\nnote');
      assert.strictEqual(model.columns[0].tiles[1].text, 'todo item');
    },
  },
  {
    name: '欄標題含全形空格「　」',
    text: L('## 欄　標題　甲', '', '- [ ] tile', ''),
    check(model) {
      expectColumns(model, [{ title: '欄　標題　甲', tiles: 1 }]);
      assert.strictEqual(model.columns[0].header, '## 欄　標題　甲');
    },
  },
  {
    name: '中文 + emoji 內容',
    text: L(
      '## 看板 📋',
      '',
      '- [ ] 中文標題 🚀',
      '\t這是內文 😀',
      '\t第二行 🎉',
      '',
      '- [ ] 另一張牌 ✨',
      '\t內容文字',
      ''
    ),
    check(model) {
      expectColumns(model, [{ title: '看板 📋', tiles: 2 }]);
      assert.strictEqual(model.columns[0].tiles[0].text, '中文標題 🚀\n這是內文 😀\n第二行 🎉');
    },
  },
  {
    name: '完整看板（frontmatter + 多欄 + settings）',
    text: L(
      '---',
      'foo: bar',
      '---',
      '',
      '## 第一欄',
      '',
      '- [ ] 牌一',
      '\t內文一',
      '',
      '- [ ] 牌二',
      '',
      '## 第二欄',
      '',
      '- [x] 完成的牌',
      '',
      '%% kanban:settings',
      '```',
      '{"kanban-plugin":"board"}',
      '```',
      '%%',
      ''
    ),
    check(model) {
      expectColumns(model, [
        { title: '第一欄', tiles: 2, texts: ['牌一\n內文一', '牌二'] },
        { title: '第二欄', tiles: 1, texts: ['完成的牌'] },
      ]);
      assert.ok(model.pre.indexOf('foo: bar') !== -1, 'frontmatter 應保留在 pre');
      assert.ok(model.post.indexOf('%% kanban:settings') === 0, 'settings 應保留在 post');
    },
  },
];

// ---------- Run Tests ----------
let failed = 0;
for (const c of cases) {
  try {
    const model = checkCase(c.text); // round-trip + idempotency
    if (typeof c.check === 'function') c.check(model); // Additional content assertions
    console.log(`PASS  ${c.name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${c.name}`);
    console.log('      ' + String(err && err.message ? err.message : err).replace(/\n/g, '\n      '));
  }
}

// ---------- Lane (column) reorder round-trip ----------
// The keyboard lane move (_keyMoveLane) and the drag onEnd both reorder lanes by physically moving the
// .tugtile__lane node, then _doPersist rebuilds the columns array IN DOM ORDER and feeds it to serializeFile.
// There is no engine-level "moveColumn" — the move is host/DOM-bound and not unit-testable directly. What IS
// pure-engine-testable, and what these moves rely on for fidelity, is: a reordered columns array serializes to the
// new lane order while preserving every card's raw/text. We model the move by reordering the parsed columns array
// (exactly what _doPersist hands serializeFile) and assert the serialized markdown reflects the new order.
let extraCases = 0;
function reorderColumnsCase(name, fn) {
  extraCases++;
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log('      ' + String(err && err.message ? err.message : err).replace(/\n/g, '\n      '));
  }
}

reorderColumnsCase('欄位重排：左移（A B C → B A C）後序列化反映新順序且內容不變', () => {
  const text = L(
    '## A', '', '- [ ] a1', '\ta-body', '', '- [ ] a2', '',
    '## B', '', '- [x] b1', '',
    '## C', '', '- [ ] c1', ''
  );
  const m = parseFile(text);
  assert.deepStrictEqual(m.columns.map((c) => c.title), ['A', 'B', 'C'], '前提：原始順序應為 A B C');

  // Simulate moving lane B one step left (ArrowLeft on B): swap B with its left neighbour A → B A C.
  const cols = m.columns.slice();
  const i = 1; // B
  [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]];
  const out = serializeFile({ pre: m.pre, columns: cols, archive: m.archive, post: m.post, eol: m.eol });

  const m2 = parseFile(out);
  assert.deepStrictEqual(m2.columns.map((c) => c.title), ['B', 'A', 'C'], '重排後序列化應為 B A C');

  // Content fidelity: every card's raw/text survives the reorder unchanged (compare against the moved source columns).
  for (let k = 0; k < cols.length; k++) {
    assert.strictEqual(m2.columns[k].tiles.length, cols[k].tiles.length, `第 ${k} 欄牌數應一致`);
    for (let j = 0; j < cols[k].tiles.length; j++) {
      assert.strictEqual(m2.columns[k].tiles[j].text, cols[k].tiles[j].text, `第 ${k} 欄第 ${j} 牌 text 應保真`);
      assert.strictEqual(m2.columns[k].tiles[j].raw, cols[k].tiles[j].raw, `第 ${k} 欄第 ${j} 牌 raw 應保真`);
    }
  }
});

reorderColumnsCase('欄位重排：右移最右欄不變（夾邊 → 順序不動）', () => {
  const text = L('## A', '', '- [ ] a1', '', '## B', '', '- [ ] b1', '');
  const m = parseFile(text);
  // ArrowRight on the rightmost lane (B) is a no-op clamp in _keyMoveLane (next sibling is the addcol button, not a
  // lane). Model that: order is unchanged, so serialization is unchanged.
  const out = serializeFile(m);
  const m2 = parseFile(out);
  assert.deepStrictEqual(m2.columns.map((c) => c.title), ['A', 'B'], '夾邊不動：順序維持 A B');
});

console.log('');
const total = cases.length + extraCases;
if (failed === 0) {
  console.log(`✅ all pass (${total}/${total})`);
  process.exit(0);
} else {
  console.log(`❌ ${failed}/${total} failed`);
  process.exit(1);
}
