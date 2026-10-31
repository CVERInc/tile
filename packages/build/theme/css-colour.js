// css-colour.js — a small, STRICT test for "is this a CSS colour", for the theme CLI.
//
// Strict on purpose: it accepts the forms a theme author writes — hex (3/4/6/8 digits), rgb()/rgba()
// and hsl()/hsla() with numeric arguments (comma or space syntax, optional `/ alpha`), the CSS named
// colours, `transparent`, `currentColor`, and `var(--name)` with an optional fallback that is itself
// a colour. Anything else is "not a colour" even if some browser would accept it (lab(), color-mix(),
// …) — a refusal the author can act on beats a silent wrong background.
//
// Not imported by the compiler: what reef (or anyone) vendors from theme-compile.js does not change.

const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown '
  + 'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray '
  + 'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue '
  + 'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite '
  + 'forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory '
  + 'khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen '
  + 'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime '
  + 'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue '
  + 'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive '
  + 'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum '
  + 'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue '
  + 'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow '
  + 'yellowgreen transparent currentcolor').split(' '));

const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?';
const PCT = `${NUM}%`;
const ANGLE = `${NUM}(?:deg|grad|rad|turn)?`;
const ALPHA = `(?:${NUM}|${PCT})`;
const fn = (names, a, b, c) => new RegExp(
  `^(?:${names})\\(\\s*(?:`
  + `${a}\\s*,\\s*${b}\\s*,\\s*${c}(?:\\s*,\\s*${ALPHA})?`       // legacy comma syntax
  + `|${a}\\s+${b}\\s+${c}(?:\\s*\\/\\s*${ALPHA})?`               // space syntax, optional / alpha
  + `)\\s*\\)$`, 'i');
const RGB = fn('rgba?', `(?:${NUM}|${PCT})`, `(?:${NUM}|${PCT})`, `(?:${NUM}|${PCT})`);
const HSL = fn('hsla?', ANGLE, `(?:${PCT}|${NUM})`, `(?:${PCT}|${NUM})`);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const VAR = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([\s\S]*?))?\s*\)$/;

/** true when `value` is a CSS colour in one of the forms listed above. */
export function isCssColour(value) {
  const v = String(value ?? '').trim();
  if (!v) return false;
  if (HEX.test(v) || RGB.test(v) || HSL.test(v) || NAMED.has(v.toLowerCase())) return true;
  const m = VAR.exec(v);
  return !!m && (m[2] === undefined || isCssColour(m[2]));
}
