// REEF with Site — /llms.txt, the agent-readable map of everything this site publishes openly.
//
// Emitted ONLY when the build says so. `ai-usage` is resolved once, in Reef, and reaches this
// renderer as a single neutral flag: no level names exist on this side. Gate off → this route
// returns an empty response and Astro writes no file at all, which is what `search-only` means.
// Owner's own llms.txt → also no file from here: theirs ships through their assets, exactly as a
// hand-written robots.txt does, and the catalog still points at /llms.txt because that path is
// served either way.
//
// A private post appears here as its title and its path and nothing else — the same non-content
// metadata rss.xml and search-index.json already carry for it.
import { agentArtifacts } from '../lib/agent-corpus.mjs';

export function GET({ site }) {
  const { llms } = agentArtifacts(site);
  if (!llms) return new Response(null);
  return new Response(llms, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
