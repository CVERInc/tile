// The Card cell FORM — the seven typed sheets, as pure functions.
//
// 🔴 WHY THIS FILE EXISTS (2026-09-06). `w2/edit2.mjs` (the engine's web tugtile as the editing
// table, now served at the official path `/try/edit`) puts the same seven sheets on top of the
// board. There were exactly two ways to do that: copy `w/editor.mjs`'s form code, or lift it out. A
// copy would have been the third implementation of "what a link cell's body looks like" in this
// repo — and the FIRST one already shipped a bug where an edited link became a text cell whose body
// was the raw markdown line (see card-core's normalizeCell note). The composition rules below are
// the dangerous part; they live once.
//
// Everything here is DOM-free apart from the HTML it returns as strings, and every environment-
// specific thing a row needs arrives through `ctx`:
//
//   ctx.T              the editor CHROME strings (sandbox-i18n's chromeStrings(locale))
//   ctx.say(key)       a cell-definition KEY → words (cell-i18n's cellStrings(locale))
//   ctx.targetOptions  () → [{value,label}] drawer choices, or null when the card has no drawers
//   ctx.previewSrc     (value) → what to show in a picture field's thumbnail
//   ctx.cardTitle      the file's frontmatter `title:` — the profile's name field reads it
//
// The two callers differ in where the sheet is mounted and how the picker looks, and in nothing
// else: `w/editor.mjs` (the internal tool, no public route any more) renders these rows into its
// own modal, `w2/edit2.mjs` (`/try/edit`) into the sheet beside the tugtile board.
import { CONTROL, SOURCE } from '../ai-ops.mjs';
import { setToken, removeToken, quoteParam } from '../card-core.js';
import { linkOf, hostLabel } from '../card-render.mjs';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** `[text](url)` ⇄ two fields, through THE RENDERER'S OWN parse — see card-render's export note. */
export const splitLink = (body) => {
  const { label, url } = linkOf(body);
  return { text: url ? label : String(body || '').trim(), url };
};

/**
 * DERIVED fields: the value a control shows for something that is not a param.
 * Keyed `<type>.<name>` so a type can never silently inherit another's codec.
 *
 * 🔴 `profile.name` takes the title from `ctx`, not from a module-level editor state object. That is
 * the one line that made this table un-liftable before: it reached into `S.md`.
 */
export const DERIVED_READ = {
  'link.text': (cell) => splitLink(cell.body).text,
  'link.url': (cell) => { const u = splitLink(cell.body).url; return u.startsWith('#') ? '' : u; },
  'link.target': (cell) => { const u = splitLink(cell.body).url; return u.startsWith('#') ? u.slice(1) : ''; },
  'feature.target': (cell) => { const h = String((cell.params || {}).href || ''); return h.startsWith('#') ? h.slice(1) : ''; },
  'profile.name': (cell, ctx) => (ctx && ctx.cardTitle) || '',
};

/** Rows of one type's form. A type without an explicit `form` keeps the generic body+params list. */
export function formRows(def) {
  if (def.form) return def.form;
  const rows = def.body ? [{ source: SOURCE.BODY }] : [];
  return rows.concat((def.fields || []).map((f) => ({ source: SOURCE.PARAM, name: f.name })));
}

/** every row of a form, groups flattened — what `composeCell` and a `showWhen` walk both need */
export const flatRows = (def) => formRows(def).flatMap((r) => (r.group ? r.rows : [r]));

/** a row descriptor + the type definition → { name, label, hint, control, … } ready to render */
export function resolveRow(row, def, cell, ctx) {
  if (row.source === SOURCE.BODY) {
    const b = def.body || { label: ctx.T.unknownCellBodyLabel, control: CONTROL.AREA, hint: '' };
    return { ...b, ...row, name: '__body', value: cell.body || '' };
  }
  if (row.source === SOURCE.PARAM) {
    const p = def.params[row.name] || {};
    const raw = (cell.params || {})[row.name];
    // 🔴 `params` flattens a `cta="Label"→/href` token into an object. Show the RAW token text for
    // those rather than "[object Object]", and let the author edit what is actually there.
    const value = raw && typeof raw === 'object' ? `"${raw.label}"→${raw.href}` : (raw === true ? 'on' : (raw == null ? '' : raw));
    return { ...p, ...row, value: String(value) };
  }
  const read = DERIVED_READ[`${cell.type}.${row.name}`];
  return { ...row, value: read ? String(read(cell, ctx) ?? '') : '' };
}

export function controlHtml(f, ctx) {
  const id = `f-${f.name}`;
  const value = f.value == null ? '' : String(f.value);
  switch (f.control) {
    case CONTROL.SWITCH: {
      const on = value !== '' && !/^(off|false|no)$/i.test(value);
      return `<input type="checkbox" id="${id}" ${on ? 'checked' : ''}>`;
    }
    case CONTROL.SELECT: {
      // a "what does this open" select carries drawer ids; every other select carries its own options
      const opts = f.options
        ? ['', ...f.options].map((o) => ({ value: o, label: o ? ctx.say((f.optionLabels || {})[o] || o) : ctx.T.selectDefaultOption }))
        : (ctx.targetOptions() || []);
      return `<select id="${id}">${opts.map((o) =>
        `<option value="${esc(o.value)}"${value === String(o.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    }
    case CONTROL.AREA:
      return `<textarea id="${id}" rows="${Number(f.rows) || 6}" spellcheck="false">${esc(value)}</textarea>`;
    // 🔴 A REAL ADDRESS FIELD. `type=url` + `inputmode=url` is what puts `/` and `.com` on a phone
    // keyboard and keeps autocapitalise off — the difference between pasting an address and fighting
    // one. It is not validation theatre: the check that matters happens in composeCell.
    case CONTROL.URL:
      return `<input type="url" id="${id}" value="${esc(value)}" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://…">`;
    // 🔴 THE PICKER THAT DID NOT EXIST. `CONTROL.ASSET` had no case at all, so every picture field
    // fell through to a bare text box and the answer to "how do I put a photo on this" was "paste a
    // sha256 or a URL". `<input type="file" accept="image/*">` is what opens a phone's photo library;
    // the hidden input below is the value the form actually saves, so both routes (a file, a pasted
    // address) write to one place.
    case CONTROL.ASSET: {
      const isAsset = /^asset:/.test(value);
      const preview = value ? ctx.previewSrc(value) : '';
      return `<div class="ctw-asset" data-for="${id}">`
        + `<div class="ctw-asset-shot">${preview ? `<img src="${esc(preview)}" alt="">` : ''}</div>`
        + `<div class="ctw-asset-acts">`
        + `<label class="ctw-btn ctw-asset-pick">${esc(value ? ctx.T.assetReplace : ctx.T.assetPick)}`
        + `<input type="file" accept="image/*" hidden id="${id}-file"></label>`
        + `</div>`
        + `<label class="ctw-asset-orurl"><span>${esc(ctx.T.assetUrl)}</span>`
        + `<input type="url" id="${id}-url" value="${esc(isAsset ? '' : value)}" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://…"></label>`
        + `<input type="hidden" id="${id}" value="${esc(value)}">`
        + `<em class="ctw-asset-err" id="${id}-err"></em></div>`;
    }
    default:
      return `<input type="text" id="${id}" value="${esc(value)}" spellcheck="false">`;
  }
}

export function fieldHtml(f, ctx) {
  const hint = f.hint ? `<em>${esc(ctx.say(f.hint))}</em>` : '';
  const cls = `ctw-field ctw-field-${f.control || 'text'}`;
  // 🔴 A picture field is a <div>, not a <label>. Its own "choose a picture" control IS a <label>
  // wrapping the file input, and nesting labels is invalid HTML — the click would land on whichever
  // one the browser felt like, which on a phone is the difference between the photo library opening
  // and nothing happening at all.
  const tag = f.control === CONTROL.ASSET ? 'div' : 'label';
  return `<${tag} class="${cls}" data-field="${esc(f.name)}"><span>${esc(ctx.say(f.label || ''))}</span>${controlHtml(f, ctx)}${hint}<em class="ctw-err" id="e-${esc(f.name)}"></em></${tag}>`;
}

/** the whole sheet body for one cell: every row, with `<details>` groups kept intact */
export function formBodyHtml(def, cell, ctx) {
  return formRows(def).map((row) => {
    if (row.group) {
      const inner = row.rows.map((r) => fieldHtml(resolveRow(r, def, cell, ctx), ctx)).join('');
      return `<details class="ctw-group"><summary>${esc(ctx.say(row.group))}</summary>${inner}</details>`;
    }
    // a "what does this open" select with no drawers to choose between is not a choice — drop it
    if (row.drawers && !ctx.targetOptions()) return '';
    return fieldHtml(resolveRow(row, def, cell, ctx), ctx);
  }).join('');
}

/**
 * The sheet's values → the cell that will be stored. PURE: it never touches a model and never
 * normalises — the caller runs `normalizeCell` and applies the rename, because only the caller knows
 * which lane the cell is in.
 *
 * `io.read(name)`    → the control's current value ('' when empty, null when the row is not rendered)
 * `io.visible(name)` → is that row on screen right now (a `showWhen` row can be hidden)
 *
 * Returns `{ rawParams, body, rename }`, or `{ error: { field, message } }` — the two refusals a
 * person can actually hit: a link with no address, and a profile with no name.
 *
 * 🔴 The BODY is never trimmed. A prose cell's blank lines are its paragraph breaks — trimming them
 * on save is a silent edit to somebody's writing. Params are trimmed: a stray space in a token is a
 * parse problem, not a stylistic one. (The caller's `read` is what does the trimming; this contract
 * is written down here so a second surface cannot get it backwards.)
 */
export function composeCell(cell, def, io, ctx) {
  const rows = def ? flatRows(def) : [{ source: SOURCE.BODY }];
  let rawParams = cell.rawParams || '';
  let body = cell.body || '';

  const bodyRow = rows.find((r) => r.source === SOURCE.BODY);
  if (bodyRow || !def) { const v = io.read('__body'); if (v != null) body = v; }

  // ── DERIVED first: a link's body is composed here, and only here ────────────────────────────────
  if (def && cell.type === 'link') {
    const target = io.visible('target') ? (io.read('target') || '') : DERIVED_READ['link.target'](cell, ctx);
    const typed = io.read('url') || '';
    const url = target ? `#${target}` : typed;
    if (!url) return { error: { field: 'url', message: ctx.T.needAddress } };
    // 🔴 An address with no words on the button is not an error — it is the commonest case. Name it
    // after the site, which is what a person would have written, instead of printing the raw URL.
    const text = (io.read('text') || '').trim() || (target ? target : hostLabel(url));
    body = `[${text}](${url})`;
  }

  let rename = null;
  if (def && cell.type === 'profile') {
    const name = (io.read('name') || '').trim();
    if (!name) return { error: { field: 'name', message: ctx.T.needValue } };
    // applied inside the caller's single edit() — a rename and the fields beside it are ONE change
    // to undo, not two, and the person did not press 完成 twice.
    if (name !== (ctx.cardTitle || '')) rename = name;
  }

  for (const row of rows) {
    if (row.source !== SOURCE.PARAM) continue;
    let v = io.read(row.name);
    if (v == null) continue;
    // the picture-and-drawer pair: an explicit drawer choice OWNS href, so the address box is ignored
    if (cell.type === 'feature' && row.name === 'href') {
      const target = io.visible('target') ? (io.read('target') || '') : DERIVED_READ['feature.target'](cell, ctx);
      if (target) v = `#${target}`;
    }
    // 🔴 setToken/removeToken come from card-core, and so does the quoting. A form holding its own
    // idea of what a param looks like is how it starts writing tokens the parser reads differently.
    rawParams = v === '' ? removeToken(rawParams, row.name) : setToken(rawParams, row.name, quoteParam(v));
  }

  return { rawParams, body, rename };
}
