// The inline script an `action=inbox` form ships — ONE copy, read by both renderers.
//
// Form.astro emits it as `<script is:inline set:html={INBOX_FORM_SCRIPT}>` and the string render
// (site-core.js, `case 'form'`) emits the same text, so the page an editor previews and the page a
// site ships run the same code. It used to be an `is:inline` literal inside Form.astro, which the
// string side could not import. The text below is that literal verbatim (leading indent included),
// only with `\`, backtick and `${` escaped for a template string.
//
// CVERInc/reef#1933 (S4b).
//
// reef#2204 — the outcome → sentence mapping and the "which shape did the forwarder answer in"
// reader are ONE source text, embedded verbatim in the browser script below AND evaluated by
// `inboxOutcomeHelpers()` for the unit tests, so what is tested is the code a page ships.
// Plain string (no template escapes) so it can be spliced into the template literal as-is.
//
// Shapes, read off feelreef's `src/routes/api/inbox/+server.ts`:
//   • form-encoded POST, no `Accept: application/json` (a no-JS submit, and this script's own
//     `fetch(action, {body: FormData})`, which sends no Accept) → 303 `<return_to>?inbox=<reason>`.
//     fetch() follows it, so the AJAX path reads the outcome off the FINAL response's URL;
//   • `Accept: application/json` or a JSON body → `{ ok:false, reason }`, 404 for `not_claimed`,
//     422 for every other refusal; `{ ok:true, … }` on success.
// `not_claimed` = the owner never claimed Inbox; it will fail until they do, so it is the ONE
// outcome that must not say "try again". Every other refusal keeps the generic retry sentence.
const INBOX_OUTCOME_HELPERS_SRC = [
  "        function inboxErrorKey(outcome) { return outcome === 'not_claimed' ? 'errorNotClaimed' : 'errorServer'; }",
  // An older build's payload has no errorNotClaimed; fall back to errorServer rather than show nothing.
  "        function inboxErrorCopy(copy, outcome) { return copy ? (copy[inboxErrorKey(outcome)] || copy.errorServer || null) : null; }",
  '        function inboxOutcomeOf(res) {',
  "          let outcome = '';",
  "          try { outcome = new URL(res.url, location.href).searchParams.get('inbox') || ''; } catch (e) {}",
  '          if (outcome) return Promise.resolve(outcome);',
  "          const ct = (res.headers && typeof res.headers.get === 'function' && res.headers.get('content-type')) || '';",
  "          if (!/application\\/json/i.test(ct) || typeof res.json !== 'function') return Promise.resolve('');",
  "          return res.json().then((b) => (b && b.ok === true ? 'sent' : String((b && b.reason) || '')), () => '');",
  '        }',
  // tile#159 r2 — where a `thanks=` form goes on success. A followed 303 already landed on the
  // forwarder's destination, so `res.url` is it (unchanged). A JSON success did not move: its
  // `res.url` is the Inbox endpoint, never a page — use the form's own build-validated `thanks_to`.
  '        function inboxSuccessDest(res, thanksPath) {',
  '          let followed = false;',
  "          try { followed = new URL(res.url, location.href).searchParams.has('inbox'); } catch (e) {}",
  "          return followed ? res.url : (thanksPath || '');",
  '        }',
].join('\n');

/**
 * The helpers above, evaluated from the same text the browser runs. `location` is the only free
 * variable in that text; pass a `{ href }` to stand in for it. Node-only (tests).
 */
export function inboxOutcomeHelpers(location = { href: 'http://localhost/' }) {
  // eslint-disable-next-line no-new-func
  return new Function('location', INBOX_OUTCOME_HELPERS_SRC + '\nreturn { inboxErrorKey, inboxErrorCopy, inboxOutcomeOf, inboxSuccessDest };')(location);
}
inboxOutcomeHelpers.source = INBOX_OUTCOME_HELPERS_SRC;

export const INBOX_FORM_SCRIPT = `
      (() => {
        const root = document.currentScript.closest('.st-form-section');
        if (!root) return;
${INBOX_OUTCOME_HELPERS_SRC}
        // Localized required-field messages (2026-09-03, finding #9): native \`required\` already
        // blocks an empty submit with ZERO js — this only swaps the browser's own generic bubble
        // text for the site-language one baked into \`data-required-msg\` at build time. \`invalid\`
        // fires per-field on a blocked submit attempt; \`input\` clears the custom message again the
        // moment the visitor starts fixing it, so a since-filled field doesn't keep re-showing it.
        root.querySelectorAll('[data-required-msg]').forEach((el) => {
          el.addEventListener('invalid', () => { el.setCustomValidity(el.validity.valueMissing ? el.dataset.requiredMsg : ''); });
          el.addEventListener('input', () => { el.setCustomValidity(''); });
        });
        // ── post-submit feedback (owner ruling, 2026-09-03) ─────────────────────────────────────
        const form = root.querySelector('.st-form');
        const successEl = root.querySelector('[data-inbox-success]');
        const errorEl = root.querySelector('[data-inbox-error]');
        const nextEl = root.querySelector('[data-inbox-next]');
        const excerptEl = root.querySelector('[data-inbox-excerpt]');
        const btn = form && form.querySelector('.st-form-submit');
        // The button's OWN rendered label (whatever \`submit="…"\` the author wrote, or the
        // default) — captured now, before anything can change it, so a failed submit restores
        // exactly this rather than a hardcoded guess.
        const btnDefaultText = btn ? btn.textContent : null;
        let copy = null;
        try { copy = JSON.parse(root.dataset.inboxCopy || 'null'); } catch (e) { copy = null; }

        // Two LINES, the way a person reads a quoted excerpt back — split on the visitor's own
        // newlines rather than a character count, which would cut mid-word; a single very long
        // line still gets a CSS line-clamp as a visual fallback (site.css \`.st-form-success-excerpt\`).
        function twoLineExcerpt(raw) {
          return String(raw || '').trim().split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2).join('\\n');
        }

        // \`fd\` is the FormData captured at submit time — only ever present on the JS-handled path.
        // A no-JS visitor's real POST navigates away and back; nothing they typed survives that
        // round trip, so \`fd\` is null there and the excerpt/exact-address text stay at their
        // build-time defaults (already rendered: the generic sentence, no excerpt paragraph).
        function showSuccess(fd) {
          if (form) form.hidden = true;
          // 🔑 bug #2, bullet (c): clear the typed values now, not just hide them — the excerpt
          // paragraph already has its own COPY of what was typed (read from \`fd\` above, a
          // snapshot independent of the live form fields), so resetting the form here cannot lose
          // it. Without this, pressing "再送一則" would re-show the visitor's PREVIOUS message
          // still sitting in the fields behind the fresh form.
          if (form) form.reset();
          if (errorEl) errorEl.hidden = true;
          if (!successEl) return;
          if (copy && nextEl && fd) {
            const addr = copy.emailField ? String(fd.get(copy.emailField) || '').trim() : '';
            nextEl.textContent = addr ? copy.sentWithEmail.replace('{email}', addr) : copy.sentNoEmail;
          }
          if (excerptEl) {
            const excerpt = copy && copy.excerptField && fd ? twoLineExcerpt(fd.get(copy.excerptField)) : '';
            if (excerpt) { excerptEl.textContent = excerpt; excerptEl.hidden = false; }
            else excerptEl.hidden = true;
          }
          successEl.hidden = false;
          successEl.focus();
          if (successEl.scrollIntoView) successEl.scrollIntoView({ block: 'center' });
        }

        // Failure keeps the form exactly as the visitor left it — this never touches field
        // values, only the error line and the button — and re-enables the button so trying again
        // is pressing it, not retyping anything.
        function showError(message) {
          if (errorEl) {
            if (message) errorEl.textContent = message;
            errorEl.hidden = false;
          }
          if (btn) {
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
            if (btnDefaultText != null) btn.textContent = btnDefaultText;
          }
        }

        // No-JS-equivalent fallback: a real submit navigated away and the browser came back here
        // with \`?inbox=<outcome>\` — the forwarder's own 303 contract, unchanged. Same two states,
        // just without a captured FormData to enrich them with.
        const v = new URLSearchParams(location.search).get('inbox');
        if (v === 'sent') showSuccess(null);
        else if (v) showError(inboxErrorCopy(copy, v));

        // 🔑 bug #2, bullet (a) (2026-09-04): strip \`?inbox=\` the moment it has been shown once, so
        // a reload / the back button / a shared URL land on the clean page instead of re-showing
        // this same one-time confirmation forever — the exact production report. \`replaceState\`
        // (not \`pushState\`): this is a correction of the CURRENT entry, not a new stop in history —
        // pressing back from here should leave the site, not bounce to the same page again.
        // 🩸 JS-only, by construction: a no-JS visitor's \`?inbox=sent\` survives on their address
        // bar and a reload of THAT URL still re-shows the card (their real POST → 303 landed them
        // there and nothing here can rewrite it without a script). That is today's behaviour,
        // unchanged for them — see the file header on why this whole enhancement stays optional.
        if (v && window.history && typeof window.history.replaceState === 'function') {
          const clean = new URL(location.href);
          clean.searchParams.delete('inbox');
          window.history.replaceState(window.history.state, '', clean.pathname + clean.search + clean.hash);
        }

        // 「再送一則」/「もう一度送る」— bullet (b). The \`<a href={returnTo}>\` in the markup above
        // already works with zero JS (a plain navigation to the form's own clean path); here it is
        // upgraded to reset-in-place so a visitor who already has JS running doesn't lose the page.
        const againLink = root.querySelector('[data-inbox-again]');
        if (againLink && form) {
          againLink.addEventListener('click', (ev) => {
            ev.preventDefault();
            form.reset();
            form.hidden = false;
            if (successEl) successEl.hidden = true;
            if (errorEl) errorEl.hidden = true;
            if (excerptEl) excerptEl.hidden = true;
            if (btn) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              if (btnDefaultText != null) btn.textContent = btnDefaultText;
            }
            const firstField = form.querySelector('.st-form-input');
            if (firstField && firstField.focus) firstField.focus();
          });
        }

        if (!form || !btn || typeof window.fetch !== 'function') return; // native submit still works fine without this

        let submitting = false;
        form.addEventListener('submit', (ev) => {
          if (submitting) { ev.preventDefault(); return; } // no double submit — the button is
          ev.preventDefault();                              // disabled too, but Enter can outrace a click
          submitting = true;
          if (errorEl) errorEl.hidden = true;
          btn.disabled = true;
          btn.setAttribute('aria-busy', 'true');
          if (copy && copy.submitting) btn.textContent = copy.submitting;
          const fd = new FormData(form);
          fetch(form.getAttribute('action'), { method: 'POST', body: fd })
            .then((res) => {
              submitting = false;
              // fetch() follows the forwarder's 303 itself — the visible page never navigates —
              // so the outcome is read off the FINAL response's own URL, the same \`?inbox=\`
              // vocabulary a no-JS round trip would have landed the browser on. inboxOutcomeOf
              // also reads the forwarder's JSON shape (\`{ok, reason}\`) when that is what came back.
              return inboxOutcomeOf(res).then((outcome) => {
              if (outcome === 'sent') {
                // \`thanks=\`: the forwarder re-validates its own \`thanks_to\` before it ever
                // becomes a \`Location\` (shop-function-template.js), so \`res.url\` (fetch follows
                // a redirect itself) is meant to already be that owner-edited page. This script
                // is the last thing that acts on it, though, so it checks the one property it
                // actually needs rather than trusting the forwarder's promise outright: a page
                // on THIS origin. On a match, navigate there — a real navigation, not the
                // in-place card, since this page is not where the visitor is meant to end up and
                // showing "sent" here first would be a lie the navigation immediately corrects.
                // On a mismatch, do not navigate to the untrusted value AND do not show the
                // in-place card either (that would silently hide that this page could not land
                // where \`thanks=\` names) — fall back to a full top-level reload of this page.
                // The no-JS round trip has no script here to run this check; it is covered
                // instead by the forwarder's own result-side check on the \`Location\` it builds.
                // 🩸 tile#159 r2: a JSON success never followed a 303, so its \`res.url\` is the
                // Inbox endpoint — navigating there sent the visitor to the API. inboxSuccessDest
                // hands back the form's own \`thanks_to\` (the value safeInternalPath let into the
                // markup, read from \`fd\` — exactly what was POSTed) for that shape, and the same
                // same-origin check gates it; a form with no \`thanks_to\` gets the in-place card.
                // (Read off \`fd\`, not a selector: a selector literal naming the hidden field would
                // sit in every page's script and read as that field to anything scanning the HTML.)
                if (copy && copy.redirectsToThanks) {
                  const dest = inboxSuccessDest(res, String(fd.get('thanks_to') || ''));
                  if (dest) {
                    let sameOrigin = false;
                    try { sameOrigin = new URL(dest, location.href).origin === location.origin; } catch (e) {}
                    if (sameOrigin) { location.assign(dest); return; }
                    location.reload();
                    return;
                  }
                }
                showSuccess(fd);
              } else showError(inboxErrorCopy(copy, outcome));
              });
            })
            .catch(() => {
              submitting = false;
              showError(copy ? copy.errorNetwork : null);
            });
        });
      })();
    `;
