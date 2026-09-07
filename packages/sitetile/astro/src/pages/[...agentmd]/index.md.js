// REEF with Site — one markdown representation per public static route, at the route's own HTML
// shape: `/about/index.html` → `/about/index.md`, and the home page at `/index.md`.
//
// getStaticPaths IS the route set: it returns the documents lib/agent-corpus.mjs resolved from the
// same globs the routers read, so this route cannot emit a twin for a page the build never built,
// and it emits nothing at all when the gate is off. Private posts are not in that set — a guessed
// `.md` path under a gated URL does not exist, which is the point.
import { agentArtifacts, markdownRoutes } from '../../lib/agent-corpus.mjs';

export function getStaticPaths() {
  return markdownRoutes;
}

export function GET({ site, props }) {
  const { markdown } = agentArtifacts(site);
  const body = markdown.get(props && props.path);
  if (!body) return new Response(null);
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
