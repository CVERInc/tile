---
sitetile-page: forms
title: Form coverage — wired to an inbox, wired to the reef, and deliberately not
lang: en-US
---

## Wired with the escape hatch
%% sitetile: form action="https://example.test/collect" submit="Send it" %%
A form with somewhere to send. `action=` is the general wiring seam — a deploy
concern, not a content one.

🩸 An `inbox="<kind>:<id>"` knob pointing straight at feelreef was tried and
withdrawn the same day: SvelteKit refuses cross-origin POSTs with a form content
type, app-wide, and that refusal is what protects every cookie-authenticated form
action in that app. See the note in Form.astro.

### Your name
### Email {email}
### What is this about
- A quote
- A question
- Something else
### Tell us more {textarea}

## Wired to the reef inbox
%% sitetile: form action=inbox submit="Send it" %%
The one special `action=` value: `inbox` posts to this site's own same-origin
forwarder (`/__reef/inbox`, relayed by the site's own `_worker.js`) — no
cross-origin CSRF wall to hit. `method=` is ignored; the forwarder only accepts
POST. `Text` below is deliberately a field label that collides with one of the
forwarder's reserved wire names.

### Your name
### Email {email}
### Text
### Tell us more {textarea}

## Not wired to anything
%% sitetile: form submit="Send it" %%
🩸 The same coral with nowhere to send. Before 2026-08-15 this rendered a LIVE
submit button that posted to the page's own URL — a 405 on any static host, which
the visitor never sees: they type, they press, the words vanish and nothing says
so. The button is now disabled, which is what "carries only structure" was always
supposed to mean.

### Your name
### Tell us more {textarea}

## Existing inbox bubble
%% sitetile: embed %%
<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="smoke-site" data-kaito="1" data-api-base="https://feelreef.com" data-title="Form coral coverage"></div><script type="module" src="https://feelreef.com/corals/inbox-bubble/v0/inbox-bubble.js"></script>
