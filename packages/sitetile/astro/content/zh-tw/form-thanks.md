---
sitetile-page: form-thanks
title: 表單 coral — thanks=（送出成功後可編輯的頁面）
lang: zh-Hant
# R1-P3-5 (adversarial review, round 1): the ONE locale override this fixture needs — pins the
# asymmetry the review found between `return_to` (locale-aware: `Astro.url.pathname` already
# carries the `/zh-tw/` prefix on this route) and `thanks=` (author-literal: the SAME
# `thanks=/form-thanks-landing` as the base-locale page, never rewritten per locale). See
# smoke-build.mjs's `form-thanks: thanks= is literal, not locale-rewritten` assertion.
packages: lingo
---

## 設定了 thanks 頁
%% sitetile: form action=inbox thanks=/form-thanks-landing submit="送出" %%
`thanks=` 指到一個站內的一般頁面，站主可以像編輯其他頁面一樣編輯它——送出成功後訪客會被帶到那裡
（附加 `?inbox=sent`），而不是看到內建的成功卡片。

### 姓名 {required}
