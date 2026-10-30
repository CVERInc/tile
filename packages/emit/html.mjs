// The four primitives every section emitter is written in — each one the string an Astro template
// produces for the same construct, so an emitter called from a `.astro` wrapper through `set:html`
// gives the page the bytes the template gave it (tile-lab#52: golden diff zero).
//
// Pinned against Astro's own runtime by html.test.mjs (escapeHTML, addAttribute, renderChild). If
// Astro changes how it escapes, that test goes red here instead of a page changing quietly.

/** `{value}` with a string value: Astro escapes all five, `'` included. */
export function text(v) {
  if (typeof v !== 'string') return falsy(v) ?? text(String(v));
  return v.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}

/** `name={value}` on an ordinary attribute: absent when null/undefined, bare when '', else quoted
 *  with only `&` and `"` escaped. `false` is not special here — it prints `name="false"`. */
export function attr(name, v) {
  if (v == null) return '';
  if (v === '') return ' ' + name;
  return ' ' + name + '="' + String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"';
}

/** `name={value}` on an HTML boolean attribute (`open`, `hidden`…): the bare name when truthy. */
export function boolAttr(name, v) {
  return v ? ' ' + name : '';
}

/** `{cond && <markup/>}`: the markup when cond is truthy, else whatever Astro prints for the falsy
 *  value itself — nothing, except the number 0, which prints "0". */
export function when(cond, markup) {
  return cond ? markup() : (falsy(cond) ?? '');
}

/** What Astro prints for a falsy child; undefined for a truthy one. */
function falsy(v) {
  if (v) return undefined;
  return v === 0 ? '0' : '';
}
