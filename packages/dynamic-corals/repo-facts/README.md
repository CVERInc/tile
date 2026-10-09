# repo-facts — the facts nobody should retype

A page lists some open-source projects. A person chose them, ordered them and wrote a sentence
for each — and then also typed "v0.6.2" and "Updated yesterday", which were true for about a day.

This coral takes the second kind of thing off the page author's hands and leaves the first alone.
For every repository card **already on the page** it adds one small fragment to the card's meta
row: the latest release with its date — or, when the repo is archived, a badge saying so.

```
v0.40.0 · October 7, 2026          v0.40.0 · 2026年10月7日          已封存
```

That is all it ever says. A repo with no release gets nothing, because the only other date there
is — the last push — would sit in the same place with no label and be read as a release date. An
archived repo gets the badge and no date, because a date beside "archived" reads as the day it
was archived, and nothing here knows that day.

```html
<div data-dynamic-coral="repo-facts"
     data-api-base="https://<the origin serving /v0/repo-facts>"
     data-scope=".st-collection"></div>
<script type="module" src="https://<registry>/corals/repo-facts/v0/repo-facts.js"></script>
```

| attribute | |
|---|---|
| `data-api-base` | **required**, https — the origin that serves `GET /v0/repo-facts` (the worker in this directory). There is no default: a coral cannot know where a deployment put its edge, and a guessed origin is a 404 that reads as an outage. Without it the coral asks nobody and changes nothing |
| `data-scope` | a selector for the container to look for repository links in. Default: the whole page |
| `data-forge` | `github`, the only forge there is today, and the default. An unknown value asks nobody |

Dates are formatted by the browser for the page's `<html lang>`, and are always absolute. The one
word the coral owns — the archived badge — exists in English, Traditional Chinese, Japanese and
Korean, chosen by the primary language subtag of `<html lang>` (the whole subtag: `jam` is not
Japanese); every other language reads the English one.

## What it never does

- **It never lists an owner's repositories.** The list is the page: it reads the repository links
  that are already inside cards and asks about exactly those, at most 30. A repo that became public
  yesterday appears on a page when a person adds a card for it, and not before.
- **It never shows free text from the forge.** Not a description, not a release title, not a topic.
  The edge returns six fields — `tag`, `releasedAt`, `pushedAt`, `license`, `archived`, `fullName` —
  each checked against a shape, here and again in the browser, and the browser writes them with
  `textContent`. There is no path from an upstream string to markup.
- **No star counts, and no date without a tag in front of it.**
- **No third-party call from the visitor's browser.** The one request goes to `data-api-base`,
  without cookies. The forge is asked by the edge and never sees the visitor.
- **It never rewrites a link.** Whatever name the answer carries, the link the author wrote stays
  as written.
- **It never follows a redirect.** The request is made with `redirect: 'error'`: the visitor's
  browser talks to the origin the page named, whatever that origin would like to send it on to.
- **It never says "loading", and never says "error".** If the answer is late (3 s), redirected,
  not ok or not JSON, the document is left byte-for-byte as it was rendered. A card whose repo is
  missing from an otherwise good answer — or whose entry has one field of the wrong shape — is
  left alone while the others are filled.

## Reading what it did

```js
window.__coralVersions['repo-facts']      // '0.1.0' — which version this page is running
window.__coralDiagnostics['repo-facts']   // { filled: 11, renamed: {} }
                                          // or { error: 1 } — nothing was written
```

`filled` is the number of fragments on the page — the number to assert on, since "it rendered
something" is also true of a page where one card in sixteen was filled. It is counted off the
document, so it stays true when the script is loaded twice or mounted on two containers, and a
later run that fails does not erase it. Each fragment also carries
`data-dc-repo-facts="<owner/repo>"`, which is how a second run knows the card is done.

`renamed` maps a linked name to the `fullName` the endpoint answered with, when the two differ by
more than letter case. 🔴 **The worker in this directory never produces one**: it answers from the
owner's current listing, where an old name simply is not, so its `fullName` is always the name
that was asked. The field is there for an endpoint that follows renames; against this one it is
always `{}`. A rename shows up the other way:

A link to a name the forge no longer lists — a repo that was renamed away, or a typo — is simply a
card that is not filled: `filled` comes up one short of the cards you counted.

## 🔴 The contract with the renderer, which nothing else writes down

The coral finds its cards and its slot by the class names sitetile's `collection` section renders
today. They are the renderer's, not this coral's, and a rename there breaks this silently — the
page simply stops being filled:

| class | what the coral needs from it |
|---|---|
| `.st-item` | a card. A repository link counts only if it is inside one, and a card gets one fragment — for the first repository link in it. The link may be the card's own GitHub anchor (`a.st-item-gh`) or the card-wide cover link (`a.st-item-cover`); the coral does not care which |
| `.st-item-meta-left` | where the fragment goes. A card without one is skipped |
| `.st-item-gh` | the fragment is inserted before it, when it is there; otherwise appended |
| `.st-item-updated`, `.st-item-badge` | **borrowed for looks.** The fragment is `<span class="st-item-updated">` and the badge `<span class="st-item-badge">`, so both take the theme's own muted-meta and pill styles and the coral injects no stylesheet at all |

A repository link is `https://github.com/<owner>/<repo>`, with an optional `.git` or trailing slash.
Anything deeper (`/issues/3`, `/releases`) is not treated as the card's repository.

`repo-facts-page.test.mjs` runs the coral against a saved copy of a real `collection` page, so a
change to that markup that this coral cannot survive shows up there — but only when the fixture is
refreshed, which is the weakness of an unwritten contract.

**Proposed for the next sitetile minor (not implemented):** the renderer puts
`data-repo="<owner>/<repo>"` on each card that links one, and exposes a named slot for the fragment.
The coral would then read `[data-repo]` first and keep the class names as the fallback for pages
rendered before that. That turns four class names into one attribute the renderer owns on purpose.

## The edge: `repo-facts-worker.mjs`

```
GET /v0/repo-facts?repos=acme/tool,acme/other,acme/typo

→ 200 { "acme/tool":  { "tag": "v1.2.0", "releasedAt": "2026-10-07", "pushedAt": "2026-10-07",
                        "license": "MIT", "archived": false, "fullName": "acme/tool" },
        "acme/other": { "pushedAt": "2026-09-28", "license": "MIT", "archived": false,
                        "fullName": "acme/other", "tag": null, "releasedAt": null } }
```

- a repo with no release has `"tag": null, "releasedAt": null`;
- a repo whose release has not been read yet has the listing's four fields and no `tag` key;
- a repo of an owner whose listing could not be read at all is `{}`;
- a name that is not a **public** repository of its owner — a typo, a private repo, a repo renamed
  away — is absent, and those cannot be told apart;
- a field whose value fails its shape check is dropped rather than passed through;
- `repos` is 1 to 30 names, each `^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$`, not a dot
  segment, and **of an owner on the allow-list**; anything else is `400` before the forge is
  contacted.

It answers with `Access-Control-Allow-Origin: *` (a cross-origin module's fetch needs it) and
never with `Access-Control-Allow-Credentials` or `Set-Cookie`; with `X-Content-Type-Options:
nosniff`; and with `Cache-Control: public, max-age=300, s-maxage=3600,
stale-while-revalidate=86400, stale-if-error=604800` — or thirty seconds, for an answer that still
has a hole in it. Of the visitor's request it reads the method and the `repos` parameter, and
nothing else, so no header of the visitor's can reach the forge or the cache.

| binding | |
|---|---|
| `ALLOWED_OWNERS` | comma-separated owners this deployment answers for; letter case does not matter. Default `CVERInc`. Setting it replaces the default |
| `GITHUB_TOKEN` | optional. A token that can read **public** repositories only, from an account used for nothing else — a spent quota is then nobody else's problem. It is sent to the forge and nowhere else |

### How it asks, and what that costs

Unauthenticated, the forge allows 60 calls an hour per calling address, and a name that does not
exist costs a call like any other. So the worker never asks the forge whether a name exists:

1. **One listing per owner.** `GET /orgs/<owner>/repos?type=public&per_page=100` (falling back to
   `/users/<owner>/repos`; at most three pages), kept for an hour. It carries the name, the last
   push, the licence and the archived flag of every public repo. A name that is not in it is
   absent from the answer **with no upstream call at all**. The listing itself never leaves:
   the answer holds only the repos that were asked for.
2. **One call per repo, remembered per repo.** `releases/latest`, kept for an hour, including the
   answer "has none". A subset or a reordering of a list already answered costs nothing.
3. **A ceiling.** One request makes at most 24 upstream calls, within 5 s, and nothing is retried.
4. **One refresh at a time, as far as that can be had.** Requests that arrive together in the
   same isolate share one refresh per owner: the second waits for the first and finds the work
   done. Across isolates there is only a lease in the cache — read, then written, so two that
   start in the same instant can both take it. That is a best effort, not a lock; what bounds the
   damage is that each of them stops at the ceiling, and that what they learn is merged rather
   than overwritten.
5. **A failure is remembered.** A read that failed is not repeated for five minutes, so a forge
   that is down is asked a dozen times an hour per repo and not sixty.
6. **A stop.** When the forge answers `403`/`429` with its rate-limit headers, every upstream call
   stops until the reset it named (at least a minute, at most an hour), for every owner.

Records are fresh for an hour, served stale while they are refreshed for a day, and served stale
for a week if the forge is failing. They live in the Cache API, one entry per owner — a Worker's
own response is not stored by the cache in front of it, so the `Cache-Control` above describes the
policy and the worker carries it out. `X-Repo-Facts-Cache` says what happened (`hit`, `stale`,
`miss`, `backoff`).

**Nobody waits for the forge.** A request is answered within two seconds with whatever is known by
then, and the refresh finishes behind it. The first visitor after a cold start may get an answer
with holes; the next gets the whole thing.

🔴 **What is still exposed.** The first sight of each real, public repo of an allowed owner costs
one call, and an owner's listing one call an hour — per Cloudflare location, since the Cache API
is local to each. Someone who knows an allowed owner's repo names can therefore spend up to (one +
the number of its public repos) calls an hour per location, and no more: junk names, other owners,
subsets and reorderings are free. That is the bound for one owner; every owner added to the
allow-list adds its own. What bounds the *request rate* is not in this file: a rate-limiting rule
on the route is the operator's step, and belongs in the deployment's checklist.

## Shape

`repo-facts-core.mjs` is the brain: which links count, what a valid answer is, what is written
where. `repo-facts-client.mjs` is the few lines that find `[data-dynamic-coral="repo-facts"]` and
hand each one over. `repo-facts.js` is BUILT from those two — do not edit it. `repo-facts-worker.mjs`
is the edge half. `repo-facts-fields.mjs` is the shape of the six fields, imported by both halves:
each still validates what it receives, but against one table, so they cannot come to disagree
about what a date is. `fake-page.mjs` and `fixtures/` are test fixtures and never ship.

Publishing is the registry chain, not a copy: bump `package.json` → `node ../build.mjs repo-facts`
with the deployment's `--registry` → repoint the deployment's channel table → deploy the registry.
The worker is a separate deploy, with a config the deployment owns.
