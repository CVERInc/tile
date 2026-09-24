// The one table describing every dynamic coral this repo builds: its source file, whether
// build.mjs bundles it (esbuild) or only stamps a hand-written self-contained file, and whether
// it is a REGISTRY PARTICIPANT.
//
// Registry participant: requires a source manifest.json, has it validated, and build.mjs may
// write an immutable <registry>/versions/<coral>/<version>/ for it.
// Local-only (not a registry participant): build.mjs still produces its generated local artifact
// (<coral>/<coral>.js), but requires no manifest and never touches the registry — qr and drawer
// are served through Cardtile's own embed step (see packages/cardtile/serve/gen-assets.mjs), not
// through a registry channel.
//
// Plain data, no side effects, and no import beyond what the data needs — this has to stay
// importable on a bare checkout with no node_modules anywhere. build.mjs itself is NOT importable
// for that purpose: it throws at load time when it finds no esbuild and runs the whole build loop
// as a side effect. This file is what build.mjs, and anything else that needs to ask "which corals
// are bundled" or "which are registry participants", reads instead of scraping build.mjs's source.
export const CORALS = {
  'events': { src: 'events-client.mjs', bundle: true, registry: true },
  'square-shop': { src: 'square-shop.js', bundle: false, registry: true },
  // Self-contained by design, not by accident: a dynamic coral must install
  // byte-for-byte into feelreef's own pages or a sitetile static build, so it
  // has no imports to bundle. Stamp only.
  'inbox-bubble': { src: 'inbox-bubble.js', bundle: false, registry: true },
  'qr': { src: 'qr-client.mjs', bundle: true, registry: false },
  'drawer': { src: 'drawer-client.mjs', bundle: true, registry: false },
  // Same split as events: the client is four lines of mounting and imports the node-tested core,
  // so the logic that decides what an amount is has exactly one home.
  'sponsor': { src: 'sponsor-client.mjs', bundle: true, registry: true },
};

export const REGISTRY_CORALS = Object.keys(CORALS).filter((name) => CORALS[name].registry);
export const LOCAL_ONLY_CORALS = Object.keys(CORALS).filter((name) => !CORALS[name].registry);
