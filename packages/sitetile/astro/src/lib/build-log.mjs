// The build log, for what a render has to say about the author's own params: the sink the Astro
// components hand to site-core as `report` (Hero.astro → heroVariant, for an unrecognised
// `logo-pos=`).
//
// site-core itself prints nothing and remembers nothing — it also runs inside long-lived processes,
// one tenant after another, where a "said it once" set never resets (heroVariant). This module is
// loaded only by `astro build`, a fresh process per build (packages/build spawns it), so the set
// below lives exactly one build, of one site: a page rendered once per locale says a thing once,
// and two different messages are both heard. Same lifetime as blog.mjs's warnedDateFormats.
const said = new Set();
export function warnOncePerBuild(message) {
  if (said.has(message)) return;
  said.add(message);
  console.warn(message);
}
