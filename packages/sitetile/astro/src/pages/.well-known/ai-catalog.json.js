// REEF with Site — /.well-known/ai-catalog.json, the discovery list an arriving agent reads first.
//
// Every optional target it names is `null` unless this same build actually produced it, so nothing
// here can point at a URL that answers 404. `mcp` holds a place for a later anonymous MCP endpoint
// and is null: this build has none, and claiming one would be the same dangling promise.
import { agentArtifacts } from '../../lib/agent-corpus.mjs';

export function GET({ site }) {
  const { catalog } = agentArtifacts(site);
  if (!catalog) return new Response(null);
  return new Response(JSON.stringify(catalog), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
