# qr coral — provenance of qr-client.mjs

`qr-client.mjs` is **not hand-written**. Its QR popup (the avatar-morph 表演 with 11 mask modes,
backCircle, blur overlay, focus trap) is lifted **verbatim** from a live card
`qr-anim.js` — chodaict's labour of love, born in Python, carried to Svelte, and made portable
here so it never gets re-hand-carried (and re-broken) again.

## The exact transform (the whole diff)

Source: the live `qr-anim.js` (one IIFE that also runs that card's `#cp-midwater` fish sim).
Generator: `packages/dynamic-corals/qr/gen-qr-client.mjs`. It applies **only** these edits:

1. **Cut** the `var icon=…if(icon){ … }` block (the QR subsystem). The fish *ambient* loop
   (`tick`/`dodge`/`spawnBubble`) is left behind — it is profile decoration, not the QR, and it
   was the source of the `if(!mw)return` gate that made the whole file dead without `#cp-midwater`.
2. **Strip** the baked config run (`var _qrCoralName="NORTHWIND"…var _qrN=33;`). The matrix is now
   **computed** by `qr-core.mjs` (vendored `qrcode-generator`) from `data-url`, so ANY URL works —
   this is the re-break fix (no more server-baked `_qrMatrix` literal to carry).
3. **Guard** the two ambient-fish touch points (`attract`, the open-swarm) with `if(!mw)return;`
   so the popup runs on a host with no swimmers. A card with swimmers keeps its fish swarm; a bare Site gets
   the full popup without it. Nothing removed from the show.
4. **Cut** the owner edit-mode picker — the `if(window._coralEditMode){…}` branch (3,205 bytes).
   Every one of its buttons `fetch`ed `/api/update-settings` on the **Heroku Python app**, and no
   native card ever sets `_coralEditMode`, so it was dead code that also happened to be the coral's
   last umbilical to the backend being switched off. The three declarations only it read
   (`_qrSetting`, `_qrLabelOff`, `_qrLabelRandom`) go with it, each after the generator proves it
   has zero remaining readers. The boundary is found by **brace-matching, never by eye**.
   → `data-site-id` left the mount contract with it (coral 0.10.0).

Verified byte-for-byte: applying this excision to the previous `qr-client.mjs` by hand reproduces
the current one exactly — 19,755 bytes of 表演, unchanged. `no-backend.test.mjs` keeps it that way
and carries a control that fires on the legacy source.

Everything else — the 11 modes (Breath/Sonar/Ripple/Glow/Tide/Serpent/Abyss/Wave/Pulse/Grid/
Nautilus), the morph choreography, the accessibility (role=dialog, Esc, Tab trap, focus return) —
is byte-for-byte chodaict's.

## Regenerate

    node packages/dynamic-corals/qr/gen-qr-client.mjs   # rewrites qr/qr-client.mjs
    node packages/dynamic-corals/build.mjs qr     # rebuilds qr.js + registry artifact

## Mount contract

    <div data-dynamic-coral="qr"
         data-url="https://card.example.com"
         data-name="NORTHWIND"
         data-version="4">       <!-- optional: pin QR density (4 = 33×33, matches live); default auto -->
      <img class="cp-icon" src="…/avatar.jpg" role="button" tabindex="0" aria-label="顯示 QR code">
    </div>

Themed off host CSS vars `--cp-accent` / `--cp-ground` / `--r-*` / `--s-*` (cardtile & sitetile both provide them).
