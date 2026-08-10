# themes/ — build-time staging only (ships EMPTY)

This directory is intentionally empty in git. A site's theme is **not** shipped by the renderer — it
travels with the site's own repo and is copied in here at build time by
`build-deploy-sitetile.sh --theme <site-repo>/theme.css` (staged as `<theme-name>.css`, then removed on
exit). `SiteLayout.astro` globs `../themes/*.css` to inline whichever theme the current build staged.

The renderer therefore carries **only** the base `site.css` — no named theme lives here permanently.
That's the portable-IR doctrine (`SPEC-theming-as-portable-ir.md §1.2`): the look belongs to the site,
not the renderer. A light reference theme used to sit here (the one §1.2 violation); the design now
ships as `examples/lilac/theme.css`, out of the build path.
