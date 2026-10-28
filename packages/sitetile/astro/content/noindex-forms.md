---
sitetile-page: noindex-forms
title: Noindex — form thanks targets
lang: en-US
# reef#2554: two thanks= targets with different outcomes.
#   • /noindex-thanks-kept — written with a query string; its page says `noindex: false`, which
#     wins over the thanks default (stays indexed, stays in sitemap.xml).
#   • /noindex-plain-target — named by a form with NO action=inbox, where thanks= is never wired
#     (Form.astro), so no visitor is ever sent there: it is not a thanks page and stays indexed.
---

## Thanks page that opted back in
%% sitetile: form action=inbox thanks=/noindex-thanks-kept?from=form submit="Send it" %%
### Your name {required}

## A thanks= that is never wired
%% sitetile: form thanks=/noindex-plain-target submit="Send it" %%
### Your name {required}
