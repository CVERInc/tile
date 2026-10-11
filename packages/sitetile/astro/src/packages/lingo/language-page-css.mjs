// REEF with Lingo — which layer each part of the `/language` chooser's box is emitted in.
//
// language-page.css lifts the BOX of the chooser's parts into `reef.responsive`, the layer after the
// site's theme, so a site-wide rule (`main * { max-width }`) cannot crush a page its owner was not
// looking at (CVERInc/reef#1887). A cascade layer cannot tell that rule from the opposite case: an
// owner who restyled the chooser ON PURPOSE. Measured on a real theme, `.rf-lang-list { display:
// grid; grid-template-columns: repeat(3, …) }` came out as one stacked flex column.
//
// The one difference between the two is that the deliberate rule NAMES the part. So, per part:
//
//   NAME IT AND YOU OWN IT. If the theme's CSS mentions `.rf-lang-page`, `.rf-lang-head` or
//   `.rf-lang-list`, that part's box is emitted in `reef.theme`, ahead of the theme, where it is
//   only a default and the owner's rules win as written. A part the theme never mentions keeps its
//   box above the theme. A theme that names none gets the sheet exactly as the file has it.
//
// Pure and dependency-free: (sheet source, theme CSS) → the CSS to emit. No CSS parser — the sheet
// is ours and has a fixed shape (flat rules inside one `@layer reef.responsive` block), and
// anything else in there throws rather than being guessed at.

const stripCssComments = (css) => String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');

/** The three parts, by the class a theme has to mention. A part covers its descendants' rules too
 *  (`.rf-lang-head h1`, `.rf-lang-list > li`, `.rf-lang-list a`). */
export const CHOOSER_PARTS = ['.rf-lang-page', '.rf-lang-head', '.rf-lang-list'];

const LIFTED = 'reef.responsive';
const DEFAULT = 'reef.theme';
// The class as a whole token: `.rf-lang-list` is not named by `.rf-lang-listing` or `.rf-lang-list_x`.
const token = (cls) => new RegExp(cls.replace(/[.]/g, '\\.') + '(?![\\w-])');

/**
 * Which parts a theme names. Deliberately a text test, not a selector parse:
 *   - comments are stripped first, so a note that mentions the class is not a rule about it;
 *   - ANY mention in the dot form counts, wherever it sits in a selector — `.rf-lang-page
 *     .rf-lang-list a` names both parts, and so do `body:has(.rf-lang-page)` and
 *     `:not(.rf-lang-list)`. Whoever wrote it had this page in front of them, which is the thing
 *     the protection assumes they did not;
 *   - an attribute selector (`[class~="rf-lang-list"]`) has no dot form and does NOT count. Missing
 *     a spelling leaves the part protected, which is the documented default and has two ways out
 *     (the tokens, `!important`); counting a loose substring would drop the protection silently.
 */
export function namedChooserParts(themeCss) {
  const theme = stripCssComments(themeCss);
  return CHOOSER_PARTS.filter((cls) => token(cls).test(theme));
}

const partOf = (selector) => {
  const cls = CHOOSER_PARTS.find((c) => selector.startsWith(c) && token(c).test(selector.slice(0, c.length + 1)));
  if (!cls) throw new Error(`language-page.css: \`${selector}\` in ${LIFTED} does not start with one of ${CHOOSER_PARTS.join(', ')}`);
  return cls;
};

/**
 * @param {string} sheet     language-page.css as written
 * @param {string} themeCss  everything the site's author supplied (the theme file, compiled tokens
 *                           and hand-written CSS alike); '' for a site with no theme
 * @returns {string} the sheet without comments, with the box of every part the theme names moved
 *                   from `reef.responsive` into a `reef.theme` block of its own
 */
export function chooserCss(sheet, themeCss = '') {
  const text = stripCssComments(sheet);
  const open = new RegExp('@layer\\s+' + LIFTED.replace('.', '\\.') + '\\s*\\{').exec(text);
  if (!open) throw new Error(`language-page.css: no @layer ${LIFTED} block`);
  const from = open.index + open[0].length;
  let to = from;                                    // the block's own closing brace
  for (let depth = 1; to < text.length; to++) {
    if (text[to] === '{') depth++; else if (text[to] === '}' && --depth === 0) break;
  }
  const body = text.slice(from, to);
  if (to >= text.length || /@/.test(body)) throw new Error(`language-page.css: @layer ${LIFTED} is not a closed, flat list of rules`);
  if (text.slice(to + 1).trim()) throw new Error(`language-page.css: @layer ${LIFTED} must be the last block`);

  const owned = new Set(namedChooserParts(themeCss));
  const moved = [];
  let left = 0;
  const kept = body.replace(/(\s*)([^{}]+?)(\s*\{[^{}]*\})/g, (rule, lead, selectors, decls) => {
    const all = selectors.split(',').map((s) => s.trim());
    const mine = all.filter((s) => owned.has(partOf(s)));
    if (mine.length) moved.push(mine.join(', ') + decls);
    if (!mine.length) { left++; return rule; }           // untouched, byte for byte
    if (mine.length === all.length) return '';
    left++;
    return lead + all.filter((s) => !mine.includes(s)).join(', ') + decls;
  });
  if (!moved.length) return text;
  const defaults = `@layer ${DEFAULT} {\n${moved.join('\n')}\n}\n`;
  return text.slice(0, open.index) + defaults + (left ? open[0] + kept + text.slice(to) : '');
}
