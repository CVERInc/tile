// pagetile photobook source — the layout vocabulary full / mat / focus (reef#2283,
// reef docs/SPEC-pagetile-photobook-source.md), through the model and the reader projection.
//
// 🩸 The defect this guards: a photobook page is COMPOSED (photo + kind + focus), and before this a
// book with one portrait and one landscape photo drew both the same way — contain, centred, no mat
// — because the fixed source has no words for composition. The spec's taste-as-default (portrait →
// mat, landscape → full) is decided from the photo's own pixels, so its unit half is resolveLayout;
// the drawn half (computed styles on a phone and a desktop, and the page turn) was measured in
// Chromium against a real build — see LANE report for reef#2283.
//
// 🔴 The other half matters as much: a comic or PDF (a live comic site depends on it) must come out EXACTLY as it
// did. The golden below was captured from the tree BEFORE this vocabulary existed, as a literal,
// not recomputed — a golden produced by the code under test agrees with any change to it.
//   run: node packages/sitetile/pagetile-photobook.test.mjs
import {
  parseBook, serializeBook, isPhotobook, defaultKind, resolveLayout, parseFocus, DEFAULT_FOCUS,
} from '../pagetile/book-core.js';
import { loadReaderBook } from './astro/src/lib/pagetile.mjs';

let pass = 0;
const fail = [];
const t = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass += 1;
  else fail.push(`${name}\n     got  ${g}\n     want ${w}`);
};

const fm = (extra) => ['---', 'pagetile-book: true', 'title: Summer', ...extra, '---', ''];

// ── the specimen: one portrait photo and one landscape photo, nothing declared ──────────────
const TWO = [...fm(['source: photobook']),
  '# Summer', '', '## Portrait', '![[pb/port.jpg]]', '', '## Landscape', '![[pb/land.jpg]]', ''].join('\n');
const two = parseBook(TWO);
const [portrait, landscape] = two.chapters[0].pages;
const PORTRAIT = { width: 600, height: 900 }, LANDSCAPE = { width: 900, height: 600 };

t('RED: a portrait and a landscape photo do not get the same default layout',
  resolveLayout(portrait, PORTRAIT).kind === resolveLayout(landscape, LANDSCAPE).kind, false);
t('portrait → mat, centred focus', resolveLayout(portrait, PORTRAIT), { kind: 'mat', focus: '50% 50%' });
t('landscape → full, centred focus', resolveLayout(landscape, LANDSCAPE), { kind: 'full', focus: '50% 50%' });
t('a square photo goes on a mat (full-bleed would crop half of it on an upright phone)', defaultKind(800, 800), 'mat');
t('size not known yet → no decision', [defaultKind(0, 0), defaultKind(undefined, 600), defaultKind('x', 1)], ['', '', '']);
t('the default focus is the centre', DEFAULT_FOCUS, '50% 50%');
t('isPhotobook reads the frontmatter', [isPhotobook(two), isPhotobook(parseBook(fm([]).join('\n')))], [true, false]);
t('undeclared kind/focus are empty, not a guessed value', [portrait.kind, portrait.focus], ['', '']);

// ── what the author declares wins over the orientation ──────────────────────────────────────
const DECLARED = [...fm(['source: photobook']),
  '# Summer', '',
  '## Portrait, forced full', 'kind: full', 'focus: 50% 20%', '![[pb/port.jpg]]', '',
  '## Landscape, matted', '![[pb/land.jpg]]', 'kind: mat', '',        // after the image: still the page head
  '## Focus only', 'focus: "30% 40%"', '![[pb/land.jpg]]', 'Harbour at dawn.', '',
].join('\n');
const declared = parseBook(DECLARED);
const [forced, matted, focusOnly] = declared.chapters[0].pages;
t('declared kind beats a portrait default', resolveLayout(forced, PORTRAIT), { kind: 'full', focus: '50% 20%' });
t('declared kind beats a landscape default', resolveLayout(matted, LANDSCAPE), { kind: 'mat', focus: '50% 50%' });
t('focus alone: kind still from the photo, quotes accepted', resolveLayout(focusOnly, LANDSCAPE), { kind: 'full', focus: '30% 40%' });
t('layout lines are not caption', [forced.caption, matted.caption, focusOnly.caption], ['', '', 'Harbour at dawn.']);
t('images unaffected by the layout lines', declared.chapters[0].pages.map((p) => p.images.length), [1, 1, 1]);

// ── what is NOT vocabulary stays visible text (nothing is swallowed) ────────────────────────
const NOT = [...fm(['source: photobook']),
  '# Summer', '',
  '## Text first', '![[a.jpg]]', 'A caption.', 'kind: full', '',         // after the caption: text
  '## Unknown kind', 'kind: duo', '![[a.jpg]]', '',                     // duo is not in this vocabulary yet
  '## Bad focus', 'focus: 120% 10%', '![[a.jpg]]', '',
  '## Not a focus', 'focus: 50% 50%; background: url(x)', '![[a.jpg]]', '',
  '## Twice', 'kind: full', 'kind: mat', '![[a.jpg]]', '',
].join('\n');
const [textFirst, unknown, badFocus, notFocus, twice] = parseBook(NOT).chapters[0].pages;
t('a layout-looking line after the caption is caption', [textFirst.kind, textFirst.caption], ['', 'A caption.\nkind: full']);
t('kind: duo stays caption, not guessed', [unknown.kind, unknown.caption], ['', 'kind: duo']);
t('focus outside 0–100 stays caption', [badFocus.focus, badFocus.caption], ['', 'focus: 120% 10%']);
t('focus that is not two percentages never reaches the model', [notFocus.focus, notFocus.caption], ['', 'focus: 50% 50%; background: url(x)']);
t('a repeated key is caption, so the second line survives', [twice.kind, twice.caption], ['full', 'kind: mat']);
t('parseFocus normalises and refuses', [parseFocus('50.5%   3%'), parseFocus("'0% 100%'"), parseFocus('50%'), parseFocus('-1% 2%')],
  ['50.5% 3%', '0% 100%', '', '']);

// ── round trip ──────────────────────────────────────────────────────────────────────────────
const md1 = serializeBook(declared);
const md1Lines = md1.split('\n');
const at = md1Lines.indexOf('## Portrait, forced full');
t('serialized layout lines sit under the page heading', at < 0 ? md1Lines : md1Lines.slice(at, at + 4),
  ['## Portrait, forced full', 'kind: full', 'focus: 50% 20%', '![[pb/port.jpg]]']);
t('serialize is idempotent across a re-parse', serializeBook(parseBook(md1)), md1);
t('round trip keeps every declared kind/focus',
  parseBook(md1).chapters[0].pages.map((p) => [p.kind, p.focus]), [['full', '50% 20%'], ['mat', ''], ['', '30% 40%']]);
const mdNot = serializeBook(parseBook(NOT));
t('non-vocabulary lines survive a round trip as text', serializeBook(parseBook(mdNot)), mdNot);

// ── the reader projection ───────────────────────────────────────────────────────────────────
const rb = loadReaderBook(DECLARED);
t('photobook projection says so', rb.source, 'photobook');
t('photobook pages carry what was declared (reader.js decides the rest)',
  rb.chapters[0].pages.map((p) => [p.kind, p.focus]), [['full', '50% 20%'], ['mat', ''], ['', '30% 40%']]);

// ── 🔴 fixed sources: byte-identical model and projection ───────────────────────────────────
// The same `kind:` / `focus:` lines a photobook reads, in a comic: they are its caption text, as
// they always were. Golden captured from the pre-vocabulary tree (tile 1d6c6d5), pasted, not computed.
const COMIC = ['---', 'pagetile-book: true', 'title: 長得要命的新婚旅行', 'direction: rtl', 'mode: paged',
  'blurb: New chapters land on [Patreon](https://patreon.com/x) first.', '---', '',
  '# 第1話 · 出発', '', '## Page 1', '![[pagetile/ch1/p01.jpg]]', 'kind: full', '',
  '## Page 2', '![[pagetile/ch1/p02.jpg|早朝]]', 'focus: 50% 38%', '',
  '## Page 3', '![p03](pagetile/ch1/p03.jpg)', '', '## Page 4', '![[pagetile/ch1/p04.jpg]]', '',
  '## Page 5', '![[pagetile/ch1/p05.jpg]]', '', '# 第2話', '', '## Page 1', '![[pagetile/ch2/p01.jpg]]',
  'A quiet morning.', '', '## Page 2', '![[pagetile/ch2/p02.jpg]]', ''].join('\n');
const COMIC_READER_GOLDEN = {"title":"長得要命的新婚旅行","direction":"rtl","mode":"paged","totalPages":7,"chapters":[{"id":"c1-第1話-出発","title":"第1話 · 出発","index":0,"pageCount":5,"startGlobalIndex":0,"coverSrc":"/pagetile/ch1/p01.jpg","pages":[{"id":"c1-第1話-出発-p1","pageInChapter":1,"globalIndex":0,"imageSrc":"/pagetile/ch1/p01.jpg","thumbSrc":"/pagetile-thumbs/ch1/p01.jpg","caption":"kind: full"},{"id":"c1-第1話-出発-p2","pageInChapter":2,"globalIndex":1,"imageSrc":"/pagetile/ch1/p02.jpg","thumbSrc":"/pagetile-thumbs/ch1/p02.jpg","caption":"focus: 50% 38%"},{"id":"c1-第1話-出発-p3","pageInChapter":3,"globalIndex":2,"imageSrc":"/pagetile/ch1/p03.jpg","thumbSrc":"/pagetile-thumbs/ch1/p03.jpg","caption":""},{"id":"c1-第1話-出発-p4","pageInChapter":4,"globalIndex":3,"imageSrc":"/pagetile/ch1/p04.jpg","thumbSrc":"/pagetile-thumbs/ch1/p04.jpg","caption":""},{"id":"c1-第1話-出発-p5","pageInChapter":5,"globalIndex":4,"imageSrc":"/pagetile/ch1/p05.jpg","thumbSrc":"/pagetile-thumbs/ch1/p05.jpg","caption":""}]},{"id":"c2-第2話","title":"第2話","index":1,"pageCount":2,"startGlobalIndex":5,"coverSrc":"/pagetile/ch2/p01.jpg","pages":[{"id":"c2-第2話-p1","pageInChapter":1,"globalIndex":5,"imageSrc":"/pagetile/ch2/p01.jpg","thumbSrc":"/pagetile-thumbs/ch2/p01.jpg","caption":"A quiet morning."},{"id":"c2-第2話-p2","pageInChapter":2,"globalIndex":6,"imageSrc":"/pagetile/ch2/p02.jpg","thumbSrc":"/pagetile-thumbs/ch2/p02.jpg","caption":""}]}],"notice":"","blurb":{"before":"New chapters land on ","link":{"label":"Patreon","href":"https://patreon.com/x"},"after":" first."}};
const COMIC_SERIALIZED_GOLDEN = "---\npagetile-book: true\ntitle: 長得要命的新婚旅行\ndirection: rtl\nmode: paged\nblurb: New chapters land on [Patreon](https://patreon.com/x) first.\n---\n\n# 第1話 · 出発\n\n## Page 1\n![[pagetile/ch1/p01.jpg]]\nkind: full\n\n## Page 2\n![[pagetile/ch1/p02.jpg|早朝]]\nfocus: 50% 38%\n\n## Page 3\n![p03](pagetile/ch1/p03.jpg)\n\n## Page 4\n![[pagetile/ch1/p04.jpg]]\n\n## Page 5\n![[pagetile/ch1/p05.jpg]]\n\n# 第2話\n\n## Page 1\n![[pagetile/ch2/p01.jpg]]\nA quiet morning.\n\n## Page 2\n![[pagetile/ch2/p02.jpg]]\n";
t('comic: reader projection identical to the pre-vocabulary golden', loadReaderBook(COMIC), COMIC_READER_GOLDEN);
t('comic: serialization identical to the pre-vocabulary golden', serializeBook(parseBook(COMIC)), COMIC_SERIALIZED_GOLDEN);
t('comic: no page grows a kind/focus key', parseBook(COMIC).chapters.flatMap((c) => c.pages)
  .filter((p) => 'kind' in p || 'focus' in p).length, 0);
// the control: the SAME pages declared a photobook do read those lines — so the comic result above
// is the gate working, not a parser that never reads them
const asPhotobook = parseBook(COMIC.replace('mode: paged', 'mode: paged\nsource: photobook')).chapters[0].pages;
t('control: the comic lines ARE vocabulary once the book is a photobook',
  [asPhotobook[0].kind, asPhotobook[1].focus], ['full', '50% 38%']);

if (fail.length) {
  console.error(`✗ pagetile photobook: ${fail.length} failed, ${pass} passed\n  ` + fail.join('\n  '));
  process.exit(1);
}
console.log(`✓ pagetile photobook: ${pass} passed`);
