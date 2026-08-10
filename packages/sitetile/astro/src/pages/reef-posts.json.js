// The CURRENT post list: every post's slug and the URL its page lives at.
//
// Task #39 step ②③. When a build renders only the posts that changed, something has to supply the
// pages it skipped, and that something is the site's own previous deployment (measured at 2.0 ms
// per page against 34.5 ms to re-render — reef docs/REF-platform-ceilings.md §2.3.1). The fetcher
// needs to know which URLs to ask for; this file is that answer.
//
// 🔴 It is written from the CURRENT corpus, and that is the whole safety argument. The alternative —
// walking whatever the last deployment happened to contain — is how a deleted or renamed post gets
// merged back in and redeployed as a live dead-end route. Not hypothetical: a live site's blog-path
// rename on 2026-07-13 left the old /devlog in a shared dist and it went live, silently, with no
// test able to see it. A post that no longer exists is simply absent from this list, so it is never
// fetched, so it cannot come back.
//
// 🩸 The name. This wants to live at `_reef/posts.json`, beside the build stamp — and it cannot:
// Astro excludes any `src/pages` path with a leading underscore from routing, so the first version
// of this file emitted nothing at all and the build looked fine. build-deploy-sitetile.sh moves the
// emitted `reef-posts.json` into `_reef/` right after the build, where the stamp already goes.
//
// Emitted on EVERY build, incremental or not, because the next build's fetcher reads the one this
// build deployed. Cheap: allPosts() parses raw markdown and renders no HTML.
import { allPosts, siteMeta, postUrl } from '../lib/blog.mjs';

const posts = allPosts(import.meta.glob('../../blog/*.md', { query: '?raw', import: 'default', eager: true }));
const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

export function GET() {
  const body = JSON.stringify(posts.map((p) => ({ slug: p.slug, url: postUrl(p, meta) })));
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
