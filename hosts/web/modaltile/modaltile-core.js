// modaltile-core — the tile family's FULL-SCREEN EDITOR surface: one post, opened over whatever
// page you were on, saved back through a handful of JSON endpoints.
//
// Given its family name at last. This lived at ejecta/core/editor/editor-modal.js and answered to no family name,
// which is why looking for "modaltile" found nothing and building a third editor kept feeling
// reasonable. It was never ejecta's: `API_BASE` has hung off two different backends already
// (ejecta's own admin, and the Heroku editor at /editor/), and nothing here assumes a filesystem.
// The surface is the tile family's; ejecta was just the first host.
//
// Header: editable title + the three-mode viewcycle, then a top-right action cluster (icon+text):
// Delete / Preview / Cancel / Save / Publish. TOC uses marktile's native onToc button. Cancel warns
// if dirty.
//
// 🔴 ONE PART OF THIS IS NOT FAMILY CODE. The smart-preview path below reaches for
// `article.ast-article-single` / `.entry-content` — Astra, a WordPress theme, because the first
// host was a WordPress mirror. It is host-specific and belongs behind an option; it is left exactly
// as it was so this move changes NO behaviour, and it is written down so the next person does not
// mistake it for a family selector. See README.md → "What is still host-specific".
import { editabilize } from './editabilize.js';
import { domToMd } from './htmlmd.js';

// API base — host-configurable so the editor works under any mount point.
// Default '' = same-origin /api (ejecta's own admin); a host sets
// window.__EJECTA_API_BASE (reef sets '/editor') so the calls land in the
// editor backend wherever it's mounted, not at the host's root /api.
const API_BASE = (typeof window !== 'undefined' && window.__EJECTA_API_BASE) || '';

export async function openEditorModal(stem, opts = {}) {
  const D = opts.dict || window.__T || {};
  const T = (k, v) => { let s = D[k] != null ? D[k] : k; if (v) for (const n in v) s = s.replace('{' + n + '}', v[n]); return s; };
  let post; try { post = await (await fetch(API_BASE + '/api/post/' + encodeURIComponent(stem))).json(); } catch { post = null; }
  if (!post || !post.ok) return null;
  const seed = post.body_format === 'md' ? post.body : domToMd(new DOMParser().parseFromString(post.body || '', 'text/html').body);
  let modeIx = 0, dirty = false, status = post.status || 'publish', busy = false;
  const setIcon = window.setIcon || (() => {});

  // header structure: [← back] [🖊️ view cycle] [👁️ preview] · title (centred) · [🗑️ delete] [✔️ save] [✈️ publish]
  // (no lock here — this is a place where you CAN save; the lock belongs to read-only hosts)
  const bd = document.createElement('div'); bd.className = 'ej-modal-backdrop ej-full';
  bd.innerHTML = `<div class="ej-modal ej-modal-full">
    <div class="ej-modal-head">
      <div class="ej-actions">
        <button class="ej-act ghost" data-a="back"></button>
        <button class="ej-act ghost" data-a="mode"></button>
        <button class="ej-act ghost" data-a="preview"></button>
      </div>
      <input class="ej-title">
      <div class="ej-actions">
        <button class="ej-act del" data-a="del"></button>
        <button class="ej-act save" data-a="save"></button>
        <button class="ej-act publish" data-a="pub"></button>
      </div>
      <span class="ej-mb-msg" data-a="msg"></span>
    </div>
    <div class="ej-modal-body"><div class="ej-mount"></div></div>
  </div>`;
  document.body.appendChild(bd);
  document.body.classList.add('ej-modal-open');   // lock page scroll behind the modal (scroll-chaining guard)
  const $ = (s) => bd.querySelector(s);
  const msg = $('[data-a=msg]');
  // status toast: Lucide icon + text (no UI emoji); text is escaped (api error strings)
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const note = (icon, text) => { msg.innerHTML = (icon && window.lucideSvg ? window.lucideSvg(icon) : '') + '<span>' + esc(text) + '</span>'; };
  const titleEl = $('.ej-title'); titleEl.value = post.title || ''; titleEl.placeholder = T('TB_TITLE_PH');
  const onKey = (e) => { if (e.key === 'Escape' && document.activeElement !== titleEl) tryClose(); };
  function close() { bd.remove(); document.body.classList.remove('ej-modal-open'); document.removeEventListener('keydown', onKey); (opts.onClose || (() => {}))(); }
  function tryClose() { if (dirty && !confirm(T('TB_DIRTY_CONFIRM'))) return; close(); }   // cancel warns if changed
  document.addEventListener('keydown', onKey);

  const mount = $('.ej-mount');
  const api = editabilize({ region: mount, seed, slug: stem, dict: D, onChange() { dirty = true; } });   // TOC: editabilize wires the shared one (toc.js)

  // editable title
  const saveTitle = async () => { const v = titleEl.value.trim(); if (v === (post.title || '')) return; post.title = v;
    try { await fetch(API_BASE + '/api/field', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: stem, field: 'title', value: v }) }); (opts.onChange || (() => {}))(stem, { title: v }); } catch {} };
  titleEl.addEventListener('blur', saveTitle);
  titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });

  // action buttons (Lucide icon + text)
  const act = (sel, icon, text) => { const b = $(sel); b.innerHTML = ''; const s = document.createElement('span'); setIcon(s, icon); const t = document.createElement('span'); t.textContent = text; b.append(s, t); b.setAttribute('aria-label', text); };

  // viewcycle: a 3-mode cycle presented as a regular header button. Two of the three labels are
  // the family's and come from the shared dictionary; the first is this surface's own — marktile
  // cycles 調味 → 渲染 → 原味, and modaltile cycles 編輯 → 調味 → 原味. Checked against
  // i18n/zh-TW.json rather than assumed, because "same as marktile" was the obvious thing to
  // write and it is not true:
  //   編輯 / edit     = markers hidden + table grid (LOOKS WYSIWYG, no HTML render)
  //   調味 / seasoned = markers VISIBLE + table grid (source and text coexist — marktile's Seasoned)
  //   原味 / plain    = raw monospace source (grid off, pipes editable)
  // Default = edit. 'marktile-grid' is the shared-core gate class for the in-place table grid.
  const MODES = [
    { cls: ['tugtile-preview', 'marktile-grid'], icon: 'square-pen', name: 'TB_EDITMODE' },
    { cls: ['marktile-grid'], icon: 'square-m', name: 'TB_SEASONED' },
    { cls: ['tugtile-plain'], icon: 'square-code', name: 'TB_PLAIN' },
  ];
  const renderVc = () => { const m = MODES[modeIx];
    for (const c of ['tugtile-preview', 'marktile-grid', 'tugtile-plain']) mount.classList.toggle(c, m.cls.includes(c));
    act('[data-a=mode]', m.icon, T(m.name)); };
  $('[data-a=mode]').onclick = () => { modeIx = (modeIx + 1) % MODES.length; renderVc(); };
  renderVc();

  act('[data-a=back]', 'arrow-left', T('TB_BACK'));
  act('[data-a=preview]', 'eye', T('TB_PREVIEW'));
  act('[data-a=del]', 'trash-2', T('TB_DELETE'));
  act('[data-a=save]', 'check-big', T('TB_SAVE_ONLY'));
  const renderPub = () => act('[data-a=pub]', 'send', status === 'publish' ? T('TB_UNPUBLISH') : T('TB_PUBLISH'));
  renderPub(); $('[data-a=pub]').classList.toggle('on', status === 'publish');

  $('[data-a=back]').onclick = tryClose;
  $('[data-a=del]').onclick = async () => { if (!confirm(T('TB_DELETE_CONFIRM'))) return;
    try { const j = await (await fetch(API_BASE + '/api/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: stem }) })).json(); if (j.ok) { (opts.onDeleted || (() => {}))(stem); close(); } else note('x', j.error || ''); } catch (e) { note('x', e.message); } };
  $('[data-a=save]').onclick = async () => { if (busy) return; busy = true; note('', T('TB_SAVING'));
    try { const j = await (await fetch(API_BASE + '/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: stem, md: api.getMd() }) })).json();
      if (j.ok) { dirty = false; note('check-big', T('TB_SAVED_TOAST')); (opts.onSaved || (() => {}))(stem); } else note('x', j.error || ''); } catch (e) { note('x', e.message); }
    busy = false; };
  // Publish / retract via dedicated routes (save-before-publish so the served dist matches the committed IR).
  // API_BASE prefix keeps it host-mountable (reef sets '/editor').
  $('[data-a=pub]').onclick = async () => {
    if (busy) return; busy = true;
    try {
      if (status !== 'publish') {
        // publish: save first if dirty (publish renders from committed IR)
        if (dirty) {
          note('', T('TB_SAVING'));
          const sj = await (await fetch(API_BASE + '/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: stem, md: api.getMd() }) })).json();
          if (!sj.ok) { note('x', sj.error || ''); busy = false; return; }
          dirty = false;
        }
        note('', T('TB_SAVING'));
        const j = await (await fetch(API_BASE + '/api/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: stem }) })).json();
        if (j.ok) { status = 'publish'; renderPub(); $('[data-a=pub]').classList.toggle('on', true); note('check-big', T('TB_PUBLISHED_LIVE')); (opts.onChange || (() => {}))(stem, { status }); } else note('x', j.error || '');
      } else {
        // retract
        const j = await (await fetch(API_BASE + '/api/unpublish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: stem }) })).json();
        if (j.ok) { status = 'draft'; renderPub(); $('[data-a=pub]').classList.toggle('on', false); note('check-big', T('TB_UNPUBLISHED_LIVE')); (opts.onChange || (() => {}))(stem, { status }); } else note('x', j.error || '');
      }
    } catch (e) { note('x', e.message); }
    busy = false;
  };
  // Server-render preview (ejecta standalone): /api/preview bakes the current md into the frozen template.
  const serverPreview = async () => {
    const j = await (await fetch(API_BASE + '/api/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: stem, md: api.getMd() }) })).json();
    if (j.ok) { window.open(j.url, '_blank'); msg.innerHTML = ''; } else note('x', j.error || '');
  };
  $('[data-a=preview]').onclick = async () => { note('', T('TB_PREVIEWING'));
    // Smart preview: fetch the already-served live page (the livepage proxy
    // injects <base> so its assets resolve), splice the current edit into the
    // content region client-side, and open it — no server render, no 2GB mirror
    // (from the smart-preview research). Uses the SAME region selectors as
    // editabilize.findRegion and the editor's own renderHtml() for fidelity.
    // Falls back to /api/preview server-render when no host livepage proxy is
    // mounted (ejecta standalone admin) — keeps both behaviors working.
    try {
      let res; try { res = await fetch(API_BASE + '/_ejecta/livepage?slug=' + encodeURIComponent(stem)); } catch { res = null; }
      if (!res || !res.ok) { await serverPreview(); return; }
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const art = doc.querySelector('article.ast-article-single') ||
                  doc.querySelector('article[class*="ast-article-single"]') ||
                  doc.querySelector('#primary article');
      const region = art && (art.querySelector(':scope .entry-content') || art.querySelector('.entry-content'));
      if (region) region.innerHTML = api.renderHtml();
      const w = window.open('', '_blank');
      if (w) { w.document.open(); w.document.write('<!doctype html>' + doc.documentElement.outerHTML); w.document.close(); }
      msg.innerHTML = '';
    } catch (e) { note('x', e.message); }
  };

  // tooltips: aria-label -> title for web hover
  setTimeout(() => mount.querySelectorAll('.tugtile-iconbtn[aria-label]').forEach((b) => { if (!b.title) b.title = b.getAttribute('aria-label'); }), 60);

  // image/video tools now come from the SHARED CORE toolbar — editabilize wires opts.pickImage/pickVideo (web upload
  // → ![](url); core promptVideoEmbed → <figure>). No per-surface injection; the toolbar is identical everywhere.

  return { close };
}
