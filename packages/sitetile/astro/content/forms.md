---
sitetile-page: forms
title: Form coverage — wired to an inbox, and deliberately not
lang: en-US
---

## Wired to an inbox
%% sitetile: form inbox="site:smoke" submit="Send it" %%
The `inbox="<kind>:<id>"` knob: one param instead of four hand-written hidden
inputs. Posts form-encoded to feelreef's `/api/inbox`, with **no JavaScript** —
a contact form is often the only way a visitor can reach a business.

### Your name
### Email {email}
### What is this about
- A quote
- A question
- Something else
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
