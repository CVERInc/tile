// The shared section emitter (tile-lab#52): one pure function per section, `(section, params, ctx)
// → HTML string`. No Astro, no DOM, no I/O — sitetile's `.astro` components call it through
// `set:html`, and a Worker can call the same function. See README.md for the call shape.
export { text, attr, boolAttr, when } from './html.mjs';
