// The exact public static routes that got a markdown twin in this build, and where each one landed.
//
// Build-internal, following reef-verdict.json.js: the build runner consumes this file and hands it
// to the site worker emitter, which serves the mapped asset when a caller asks for `text/markdown`.
// The worker never rebuilds a URL family from it — private gated paths and RSP-forwarded routes are
// absent because they were never public static routes of this build in the first place.
//
// 🔴 Edge-rendered routes are NOT filtered here. A storefront page and a site-owned buyer page are
// public content pages of this build, so they can appear in this file; only the emitter knows which
// paths the worker answers itself, and it drops them (naming each) when it bakes the mapping. Read
// this file as "what this build wrote", not as "what the worker will negotiate".
import { agentArtifacts } from '../lib/agent-corpus.mjs';

export function GET({ site }) {
  const { mapping } = agentArtifacts(site);
  if (!mapping) return new Response(null);
  return new Response(JSON.stringify(mapping), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
