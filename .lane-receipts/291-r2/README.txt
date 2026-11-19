Second closing review of the post-body marks change (head before this fix: 02995af).

red-02995af.txt            the r2 test file run against 02995af's site-core.js (before the fix): 29 passed, 5 failed
pins-on-origin-main.txt    the r2 test file run against origin/main's site-core.js: every "(as on main)" case
                           and the new guard pass there (the strike/rule/task cases fail, as main has none)
post-body-marks-green.txt  the r2 test file after the fix: 34 passed, 0 failed
mutation-*.txt             the r2 test file against site-core.js with one part of the fix removed; each file
                           starts with the diff from the fixed source to the mutant
each-file.txt              rendering test files run one at a time after the fix
source-spans.txt, cardtile-worker-test.txt   neighbouring single test files after the fix

Variants were loaded with:
  git show origin/main:packages/sitetile/site-core.js > <tmp>/main-site-core.js
  VARIANT=<tmp>/main-site-core.js node --import ./.lane-receipts/291-r2/as-variant.mjs packages/sitetile/post-body-marks.test.mjs
02995af's red run is the test file run in the worktree before site-core.js was edited.
