// REEF with Repo Facts — the dynamic-coral client, SOURCE form. The distributable `repo-facts.js`
// is BUILT from this file (`node packages/dynamic-corals/build.mjs repo-facts`) — do not edit
// repo-facts.js by hand.
//
// Deliberately tiny, like sponsor's and for the same reason: find the mount points, hand each one
// to the core, and nothing else. Everything that could be wrong — which links count, what a valid
// answer looks like, what is written where — lives in repo-facts-core.mjs where `node --test` can
// drive it against a real page.
import { SELECTOR, mountRepoFacts } from './repo-facts-core.mjs';

// A module script is deferred, so the DOM is normally ready by the time this runs. The guard is for
// the host that injects this file some other way.
const mountAll = () => document.querySelectorAll(SELECTOR).forEach((root) => mountRepoFacts(root));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
else mountAll();
