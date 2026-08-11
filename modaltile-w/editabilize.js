// editabilize (runtime) — turn ONE frozen mirror post page into an editable one, in-browser.
// The frozen HTML is byte-untouched; this module (injected before </body>) does the DOM surgery on load:
//   1. locate the single-article content region (.entry-content inside article.ast-article-single)
//   2. read its current HTML -> markdown (figures/embeds kept verbatim as opaque blocks; see htmlmd.js)
//   3. tag the region with data-ejecta-id (the "one id, three uses" handle) and mount the marktile editor
//      seeded with that markdown — everything else on the page (chrome/decorations) stays frozen
//   4. onSave: markdown -> HTML, ready to write back to the IR + rebuild the frozen template
// Proves the editabilize loop: frozen chrome + live content region + edit + save->render. No fork of marktile.
import './obsidian-shim.js';
import { mountEditor, equipEditor, promptVideoEmbed } from './vendor/tile-core.js';
import { makeWebHost } from './host.js';
import { domToMd, mdToHtml } from './htmlmd.js';

// Web image hook for the shared core toolbar's 🖼 button: pick a file → upload → insert the family-canonical
// ![[ref]] embed (SAME token Obsidian writes — one editor, one dialect). ref = the stored filename; the web
// resolves ![[ref]] → /media/uploads/<ref> (resolveSrc for the editor, mdToHtml for the published page). Video is
// already byte-identical across platforms (core <figure>); now image markup is too, only resolution is per-platform.
function webPickImage() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) return resolve(null);
      try {
        const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
        const j = await (await fetch('/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f.name, dataUrl }) })).json();
        resolve(j && j.ok ? '![[' + String(j.url).split('/').pop() + ']]' : null);   // ref = stored filename; ![[ref]] resolves to /media/uploads/<ref>
      } catch (e) { resolve(null); }
    };
    inp.click();
  });
}

function findRegion() {
  const art = document.querySelector('article.ast-article-single') ||
              document.querySelector('article[class*="ast-article-single"]') ||
              document.querySelector('#primary article');
  if (!art) return null;
  return art.querySelector(':scope .entry-content') ||
         art.querySelector('.entry-content');
}

export function editabilize(opts = {}) {
  const slug = opts.slug || window.__EJECTA_SLUG || (location.pathname.split('/').filter(Boolean).pop() || 'post');
  const region = opts.region || findRegion();
  if (!region) { console.error('editabilize: content region not found (no .entry-content in single article)'); return null; }

  // seed from the latest content: an already-edited post passes its IR markdown via __EJECTA_SEED;
  // an original post seeds from the frozen region's HTML (domToMd). Re-editing must not revert to the
  // never-rewritten frozen mirror content.
  const seedMd = (opts.seed != null ? opts.seed : (window.__EJECTA_SEED != null ? window.__EJECTA_SEED : domToMd(region)));
  region.setAttribute('data-ejecta-id', 'post:' + slug + ':body');   // the one handle: emit = MCP edit = verify join
  region.classList.add('ejecta-editable');
  region.innerHTML = '';

  // NOTE: marktile's onChange() is a no-arg notification — the text lives on the returned controller
  // (ctrl.getValue()), NOT in the callback arg. Reading it any other way yields undefined.
  // The TOC is wired HERE so every editor surface (admin modal + /edit page) gets the SAME one (toc.js —
  // marktile's native sidebar); hosts don't build their own.
  let rig = null;
  const T = (k) => { const D = opts.dict || window.__T || {}; return D[k] != null ? D[k] : k; };
  const ctrl = mountEditor(region, {
    text: seedMd,
    onChange() { window.__ejectaChanged = true; if (rig && rig.toc) rig.toc.refresh(); (opts.onChange || (() => {}))(); },
    ...(opts.onSave ? { onSave: opts.onSave } : {}),     // native ✓ button
    ...(opts.onCancel ? { onCancel: opts.onCancel } : {}),   // native ✕ button
    onToc() { if (rig && rig.toc) rig.toc.toggle(); },   // native TOC toggle
    pickImage: webPickImage, pickVideo: () => promptVideoEmbed(),   // 🖼/🎞 from the shared core toolbar
  }, makeWebHost());

  // expose the loop's seams for the smoke test + the admin Save button + a future preview action
  const getMd = () => ctrl.getValue();
  const api = { slug, region, ctrl, seedMd, getMd, renderHtml: () => mdToHtml(getMd()) };
  window.__ejecta = api;

  // Equip the SHARED editor rig (mode classes + in-grid tables + inline images + TOC) — the same equipEditor that
  // marktile / modaltile-o use, so all four editor surfaces run one engine. Web hooks: resolveSrc passes URLs
  // through; no saveImage yet (no web upload) so image paste stays off here. Default mode = Seasoned (marktile-grid,
  // markers visible). editor-modal's own MODES cycle still toggles the classes for the admin modal on top of this.
  rig = equipEditor({
    mount: region, ctrl,
    // resolve the family-canonical ![[ref]] embed for display: a bare ref is an uploaded file → /media/uploads/<ref>;
    // an explicit URL / absolute path passes through (legacy ![](url) + already-resolved content).
    resolveSrc: (raw) => { raw = String(raw).split('|')[0].trim(); return /^(https?:|data:|\/)/i.test(raw) ? raw : '/media/uploads/' + raw; },
    toc: { Sortable: (typeof window !== 'undefined' ? window.Sortable : null), labels: { title: T('TB_TOC'), empty: T('TB_TOC_EMPTY') }, onReorder() { window.__ejectaChanged = true; (opts.onChange || (() => {}))(); } },
  });
  api.rig = rig;
  return api;
}


// auto-run when injected as a module into a frozen page
if (!window.__EJECTA_NO_AUTORUN) editabilize();
