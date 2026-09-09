---
sitetile-page: form-thanks
title: Form coral — thanks= (an editable page after a successful submit)
lang: en-US
---

## Thanks page configured
%% sitetile: form action=inbox thanks=/form-thanks-landing submit="Send it" %%
`thanks=` names an ordinary, site-internal page the owner writes and edits like any other page —
on a successful submit the visitor lands there (`?inbox=sent` appended) instead of seeing the
built-in success card in place. A failed submit still returns HERE, so the inline retry error
above the button keeps working exactly as it does without `thanks=`.

### Your name {required}
### Email {email}

## Thanks page not configured (control)
%% sitetile: form action=inbox submit="Send it" %%
The same coral, no `thanks=` — proving the check above did not change anything for a form that
never opts in: a successful submit shows the built-in success card in place, on this page, same
as before `thanks=` existed.

### Your name {required}

## Thanks page, invalid destination (dropped)
%% sitetile: form action=inbox thanks=https://example.test/collect submit="Send it" %%
`thanks=` must be a path on THIS site — an off-site destination is dropped at build time and
never reaches the page. Behaves exactly like the coral above with no `thanks=` at all.

### Your name {required}

## Thanks landing page
%% sitetile: prose %%
The plain, ordinary page the first form's `thanks=` points at — editable copy, no different
from any other page on the site.
