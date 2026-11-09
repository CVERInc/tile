// styleText — the text of an inline <style> element, made unable to close that element.
//
// A <style> element's content is RAWTEXT: the only thing that ends it is `</style` (ASCII
// case-insensitive). Every `<style set:html={…}>` in the layout passes its text through here, so
// what the element contains is CSS whatever the upstream producer (the theme compiler, a package
// sheet, a route's sheet) did or did not strip. This is the sink-side half; the compiler's
// fixed-point strip is the source-side half, and neither relies on the other.
//
// `</style` becomes `<\/style`. That is no longer an end tag, and inside a CSS string `\/` is an
// escape for `/`, so a string that legitimately spells it keeps its value. The replacement cannot
// create a new match (it never emits `</`), so one pass is already a fixed point. Text without
// `</style` is returned unchanged, byte for byte.
export function styleText(css) {
  return String(css ?? '').replace(/<\/(style)/gi, '<\\/$1');
}
