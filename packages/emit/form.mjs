// `form` — a contact / inquiry form: an optional lead, then one field per `### <label>` (a trailing
// `{email}`/`{tel}`/`{textarea}` sets the kind, `- option` lines make a <select>, `{required}` /
// `{required: false}` state it). A native <form>; the THEME paints `.st-form-*`. Mirrors the
// reference renderSection 'form' case. Form.astro's header carries the full contract (why an
// unwired form's button is disabled, what `action=inbox` posts and why it is same-origin).
//
// Everything a build knows and a pure function cannot is an INPUT here, not a lookup:
//   · `returnTo`  — the page's own built path (Astro.url.pathname in sitetile);
//   · `homeHref`  — the home of the locale `returnTo` sits under (sitetile reads it off the
//                   content files with import.meta.glob);
//   · `thanksMark`— the id recordThanks() handed out for a `thanks=` target (a build-time side
//                   effect, so it stays in the host);
//   · `copy`      — the locale's inbox strings (`inboxFormCopy(lang)`).
//
// 🔴 The inline `<script>` an `action=inbox` form ships is NOT a hoisted Astro script: it is
// site-core's INBOX_FORM_SCRIPT, one shared string the reference renderer emits too, and it finds
// its form through `document.currentScript.closest('.st-form-section')` — so it has to sit inside
// the section it drives. It is emitted here, in place, exactly as before.
//
// Markdown is the CALLER's dialect (tile-lab#52 ruling 2026-10-31): `ctx.inline` / `ctx.block`.
import { INBOX_FORM_SCRIPT } from '../sitetile/site-core.js';
import { attr, boolAttr, text, when } from './html.mjs';

// The forwarder's reserved field names — an owner field must never land on the wire under one of
// these, or it would be read as routing data instead of message content. Case-insensitive; only
// the wire `name=` gets `field_` prefixed, the visible label never changes.
const RESERVED_INBOX_NAMES = new Set(['kind', 'id', 'text', 'conversation_id', 'page_url', 'return_to', 'return_fragment', 'thanks_to', '_hp', 'visitor_email', 'email_field']);
const inboxNameFor = (label, kind) => {
  if (kind === 'email') return 'visitor_email';
  const s = String(label);
  return RESERVED_INBOX_NAMES.has(s.toLowerCase()) ? `field_${s}` : s;
};

/**
 * @param {{ eyebrow?: unknown, submit: unknown, isInbox: boolean, formAction?: string, method: string,
 *           thanksPath: string | null, thanksMark?: string, returnTo: string, homeHref: string,
 *           copy: Record<string, string> }} params
 *   `formAction` is already gated (`safeHref`, or the fixed `/__reef/inbox`); `thanksPath` by `safeInternalPath`.
 * @param {{ hero?: boolean, index: number, inline: (md: string) => string, block: (md: string) => string }} ctx
 *   `index` is the section's position on the page — it keys the field ids and reason fragments.
 */
export function emitForm(section, params, ctx) {
  const { eyebrow, submit, isInbox, formAction, method, thanksPath, thanksMark, returnTo, homeHref, copy: fieldCopy } = params;
  const index = ctx.index;
  const Title = ctx.hero && section.title ? 'h1' : 'h2';   // first section on the page → its title is the <h1>
  const idOf = (i) => `st-form-${index}-f${i + 1}`;
  // JSON outcome → fragment IDs (without #), echoed by the forwarder on refusal.
  const returnFragments = {
    inbox_storage_full: `inbox-storage-full-${index}`,
    not_claimed: `inbox-not-claimed-${index}`,
  };
  const nameFor = (f) => (isInbox ? inboxNameFor(f.label, f.kind) : f.label);
  // A form with nowhere to send renders its button DISABLED (an unwired submit posts to the page
  // itself — a 405 on a static host that the visitor never sees).
  const wired = Boolean(formAction);
  // `f.required` wins whenever an author states one; unstated, `action=inbox` defaults ONLY its
  // message textarea and email field — the two the forwarder needs — and everything else stays opt-in.
  const isRequired = (f) => (typeof f.required === 'boolean' ? f.required : isInbox && (f.kind === 'textarea' || f.kind === 'email'));
  const renderFields = (section.fields || []).map((f, i) => ({ ...f, id: idOf(i), name: nameFor(f), required: isRequired(f) }));
  // Which success sentence applies is a fact about this form's configuration: a REQUIRED email
  // field is filled on every submission the browser lets through.
  const emailGuaranteed = isInbox && renderFields.some((f) => f.kind === 'email' && f.required);
  const inboxSentText = emailGuaranteed ? fieldCopy.sentWithEmailGeneric : fieldCopy.sentNoEmail;
  const emailFieldName = renderFields.some((f) => f.kind === 'email') ? 'visitor_email' : null;
  const excerptField = renderFields.find((f) => f.kind === 'textarea');
  const inboxCopy = isInbox ? {
    submitting: fieldCopy.submitting,
    successHeading: fieldCopy.successHeading,
    errorNetwork: fieldCopy.errorNetwork,
    errorServer: fieldCopy.errorServer,
    errorNotClaimed: fieldCopy.errorNotClaimed,
    errorInboxStorageFull: fieldCopy.errorInboxStorageFull,
    errorTooLong: fieldCopy.errorTooLong,
    errorRateLimited: fieldCopy.errorRateLimited,
    sentWithEmail: fieldCopy.sentWithEmail,
    sentNoEmail: fieldCopy.sentNoEmail,
    emailField: emailFieldName,
    excerptField: excerptField ? excerptField.name : null,
    // `undefined`, not `false`, when absent: JSON.stringify drops it, so a form without `thanks=`
    // carries the payload byte-identical to before `thanks=` existed.
    redirectsToThanks: thanksPath ? true : undefined,
  } : null;
  const req = (f) => boolAttr('required', f.required || undefined) + attr('aria-required', f.required || undefined)
    + attr('data-required-msg', f.required ? fieldCopy.fieldRequired : undefined);

  return '<section class="st-form-section"' + attr('id', section.id) + attr('data-inbox-copy', inboxCopy ? JSON.stringify(inboxCopy) : undefined) + '> '
    + '<div class="st-form-head"> '
    + when(eyebrow, () => '<p class="st-form-eyebrow">' + ctx.inline(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<' + Title + '>' + ctx.inline(section.title) + '</' + Title + '>') + ' '
    + when(section.body, () => ctx.block(section.body))
    + ' </div> '
    + when(isInbox, () => '<div class="st-form-success" data-inbox-success role="status" tabindex="-1" hidden> '
      + '<svg class="st-form-success-check" viewBox="0 0 48 48" width="40" height="40" aria-hidden="true" focusable="false"> '
      + '<circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="3"></circle> '
      + '<path d="M14 25l7 7 14-15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path> </svg> '
      + '<p class="st-form-success-heading" role="heading" aria-level="3">' + text(fieldCopy.successHeading) + '</p>  '
      + '<p class="st-form-success-next" data-inbox-next>' + ctx.inline(inboxSentText) + '</p>  '
      + '<p class="st-form-success-excerpt" data-inbox-excerpt hidden></p>  '
      + '<p class="st-form-success-again"><a' + attr('href', returnTo) + ' data-inbox-again>' + text(fieldCopy.sendAnother) + '</a></p> '
      + '<p class="st-form-success-back"><a' + attr('href', homeHref) + '>' + text(fieldCopy.backHome) + '</a></p> </div>') + ' '
    + '<form class="st-form"' + attr('action', formAction) + attr('method', method) + attr('data-sitetile-thanks', thanksMark) + '> '
    + when(isInbox, () => (thanksPath
      ? '<input type="hidden" name="return_to"' + attr('value', returnTo) + '><input type="hidden" name="thanks_to"' + attr('value', thanksPath) + '>'
      : '<input type="hidden" name="return_to"' + attr('value', returnTo) + '>')) + ' '
    + when(isInbox, () => '<input type="hidden" name="return_fragment"' + attr('value', JSON.stringify(returnFragments)) + '>') + ' '
    // Honeypot: off-screen + zero-size, deliberately NOT display:none (a bot's autofill reads the DOM).
    + when(isInbox, () => '<input type="text" name="_hp" autocomplete="off" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;">') + ' '
    + renderFields.map((f) => '<div class="st-form-field">  '
      + (f.required
        ? '<label class="st-form-label"' + attr('for', f.id) + '> <span>' + ctx.inline(f.label) + '</span><span class="st-form-required-mark" aria-hidden="true"> *</span> </label>'
        : '<label class="st-form-label"' + attr('for', f.id) + '>' + ctx.inline(f.label) + '</label>') + ' '
      + (f.kind === 'textarea'
        ? '<textarea class="st-form-input st-form-textarea"' + attr('id', f.id) + attr('name', f.name) + ' rows="5"' + req(f) + '></textarea>'
        : f.kind === 'select'
          ? '<select class="st-form-input st-form-select"' + attr('id', f.id) + attr('name', f.name) + req(f) + '> <option value="" disabled selected>—</option> '
            + (f.options || []).map((o) => '<option' + attr('value', o) + '>' + text(o) + '</option>').join('') + ' </select>'
          : '<input class="st-form-input"' + attr('id', f.id) + attr('name', f.name) + attr('type', f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : 'text') + req(f) + '>')
      + ' </div>').join('') + ' '
    + when(isInbox, () => ' <p class="st-form-error" data-inbox-error hidden>' + ctx.inline(fieldCopy.errorServer) + '</p> <noscript> '
      + '<p class="st-form-error"' + attr('id', returnFragments.inbox_storage_full) + ' hidden>' + ctx.inline(fieldCopy.errorInboxStorageFull) + '</p> '
      + '<p class="st-form-error"' + attr('id', returnFragments.not_claimed) + ' hidden>' + ctx.inline(fieldCopy.errorNotClaimed) + '</p> </noscript> ') + ' '
    + '<button class="st-form-submit" type="submit"' + boolAttr('disabled', !wired) + '>' + text(submit) + '</button> </form> '
    + when(isInbox, () => '<script>' + INBOX_FORM_SCRIPT + '</script>')
    + ' </section>';
}
