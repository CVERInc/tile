// REEF with Site — /llms-full.txt, the same public corpus as /llms.txt with the text included.
//
// Absent when the gate is off, and absent when the corpus is bigger than the size guard in
// lib/agent-artifacts.mjs — never truncated. A half dump reads as a whole site to whoever fetched
// it; an absent one is a `null` the catalog can state honestly.
import { agentArtifacts } from '../lib/agent-corpus.mjs';

export function GET({ site }) {
  const { llmsFull } = agentArtifacts(site);
  if (!llmsFull) return new Response(null);
  return new Response(llmsFull, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
