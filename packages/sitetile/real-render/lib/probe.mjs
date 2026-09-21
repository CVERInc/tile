// probe — the browser-side computed-style measurements (serialized into the page with
// page.evaluate) and the Node-side verdicts derived from them. Facts are recorded raw so a
// reviewer can re-judge without re-running the browser.
//
// 🔴 Everything below the "Node: verdicts" divider is PURE: facts in, verdicts out, no browser and
// no filesystem. That is deliberate — it is what lets verdicts.test.mjs drive the mode-aware rules
// with synthetic facts in the ordinary suite, so the expectations are covered by a check that runs
// without Playwright, without a renderer install and in milliseconds.

// ── in-page: raw facts ───────────────────────────────────────────────────────────────────────────
export function measure(spec) {
  const cs = (el) => getComputedStyle(el);
  const px = (v) => parseFloat(v) || 0;
  const main = document.querySelector('main');
  const vw = document.documentElement.clientWidth;

  // Resolved token values in main's context: a probe element whose only styling is var() reads.
  const tokenProbe = document.createElement('span');
  tokenProbe.setAttribute('data-harness-probe', '');
  tokenProbe.style.cssText = 'position:absolute;visibility:hidden;border-style:solid;border-width:1px;' +
    'background-color:var(--gd-btn-fill, var(--gd-accent));color:var(--gd-accent-ink, #fff);' +
    'border-top-left-radius:var(--gd-btn-radius, var(--gd-radius, 8px));border-top-right-radius:var(--gd-radius);' +
    'border-top-color:var(--gd-border);border-left-color:var(--gd-accent);border-right-color:var(--gd-muted);' +
    'border-bottom-color:var(--gd-text);font-family:var(--gd-font);';
  (main || document.body).appendChild(tokenProbe);
  const tp = cs(tokenProbe);
  const tokens = {
    btnFill: tp.backgroundColor, ink: tp.color, btnRadius: tp.borderTopLeftRadius, radius: tp.borderTopRightRadius,
    border: tp.borderTopColor, accent: tp.borderLeftColor, muted: tp.borderRightColor, text: tp.borderBottomColor, font: tp.fontFamily,
  };
  tokenProbe.remove();

  // Build-time references: the renderer's OWN primitives, rendered in this same page/theme.
  const ref = document.createElement('div');
  ref.setAttribute('data-harness-ref', '');
  ref.innerHTML = '<section class="st-prose"><h1>Reference heading</h1><p>ref</p></section>' +
    '<section class="st-form-section"><form class="st-form"><input class="st-form-input" type="email"><button class="st-form-submit" type="button">Ref</button></form></section>' +
    '<section class="st-cta"><a class="st-cta-btn" href="#r">Ref</a></section>';
  (main || document.body).appendChild(ref);
  const pick = (el, props) => { if (!el) return null; const s = cs(el); const o = {}; for (const p of props) o[p] = s[p]; return o; };
  const refs = {
    h1: pick(ref.querySelector('h1'), ['fontFamily', 'color', 'fontSize', 'fontWeight']),
    submit: pick(ref.querySelector('.st-form-submit'), ['backgroundColor', 'color', 'borderTopLeftRadius', 'cursor']),
    input: pick(ref.querySelector('.st-form-input'), ['fontFamily', 'fontSize', 'borderTopLeftRadius', 'borderTopColor', 'backgroundColor']),
    cta: pick(ref.querySelector('.st-cta-btn'), ['backgroundColor', 'color', 'borderTopLeftRadius']),
  };
  ref.remove();

  const box = (el) => {
    const r = el.getBoundingClientRect(); const s = cs(el);
    return { left: r.left, right: r.right, width: r.width, contentLeft: r.left + px(s.paddingLeft) + px(s.borderLeftWidth),
      contentRight: r.right - px(s.paddingRight) - px(s.borderRightWidth), maxWidth: s.maxWidth, display: s.display };
  };
  const describe = (el) => el ? { tag: el.tagName.toLowerCase(), classes: el.className && typeof el.className === 'string' ? el.className : '' } : null;

  const rootEl = spec.root ? document.querySelector(spec.root) : null;
  const topLevel = rootEl && main ? [...main.children].find((c) => c.contains(rootEl)) : null;
  const runtimeContainer = rootEl ? rootEl.closest('.st-runtime') : null;
  const headingEl = spec.heading ? document.querySelector(spec.heading) : null;
  const insetEl = headingEl || rootEl;

  const facts = {
    htmlLang: document.documentElement.getAttribute('lang'),
    // What the renderer stamped for this site's declaration. Recorded in every state's facts so a
    // reader of one facts file can tell which mode produced it without opening build.json.
    coralCssStamp: document.documentElement.getAttribute('data-dynamic-coral-css') || '',
    bodyThemeCustom: document.body.hasAttribute('data-theme-custom'),
    viewport: { width: vw, scrollWidth: document.documentElement.scrollWidth },
    shell: { header: !!document.querySelector('header.rf-header'), nav: !!document.querySelector('header.rf-header nav, nav.rf-nav'), footer: !!document.querySelector('footer.rf-footer'), mainCount: document.querySelectorAll('main').length },
    body: pick(document.body, ['fontFamily', 'fontSize', 'color']),
    tokens, refs,
    root: rootEl ? { ...describe(rootEl), ...box(rootEl) } : null,
    topLevel: topLevel ? { ...describe(topLevel), ...box(topLevel) } : null,
    runtimeContainer: runtimeContainer ? { ...describe(runtimeContainer), ...box(runtimeContainer) } : null,
    inset: insetEl ? { measured: headingEl ? 'heading' : 'root', ...box(insetEl) } : null,
    heading: headingEl ? { ...describe(headingEl), ...pick(headingEl, ['fontFamily', 'color', 'fontSize', 'fontWeight']), text: headingEl.textContent.trim().slice(0, 80) } : null,
  };

  const media = [...document.querySelectorAll('main img, main video, main iframe, main svg')].map((m) => {
    const r = m.getBoundingClientRect(); return { tag: m.tagName.toLowerCase(), src: (m.getAttribute('src') || '').slice(0, 80), left: r.left, right: r.right, width: r.width, height: r.height };
  }).filter((m) => m.width > 0);
  facts.media = media;

  if (spec.cards) {
    const cards = [...document.querySelectorAll(spec.cards)];
    const container = cards[0] ? cards[0].parentElement : null;
    facts.cards = {
      count: cards.length,
      container: container ? { ...describe(container), ...pick(container, ['display', 'listStyleType', 'paddingLeft', 'gridTemplateColumns', 'gap']) } : null,
      items: cards.slice(0, 3).map((c) => ({ ...describe(c), ...pick(c, ['display', 'listStyleType', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'boxShadow', 'borderTopLeftRadius']),
        width: c.getBoundingClientRect().width,
        media: [...c.querySelectorAll('img')].map((i) => ({ width: i.getBoundingClientRect().width, height: i.getBoundingClientRect().height })) })),
    };
  }

  facts.actions = (spec.actions || []).map((a) => {
    const els = [...document.querySelectorAll(a.sel)];
    const el = els[0];
    if (!el) return { ...a, found: false };
    return { ...a, found: true, count: els.length, ...describe(el), disabled: !!el.disabled, text: el.textContent.trim().slice(0, 60),
      ...pick(el, ['backgroundColor', 'color', 'borderTopLeftRadius', 'cursor', 'opacity', 'borderTopStyle', 'borderTopWidth', 'fontFamily', 'fontWeight', 'textDecorationLine', 'paddingLeft', 'display']) };
  });
  facts.inputs = (spec.inputs || []).map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { sel, found: false };
    return { sel, found: true, ...describe(el), ...pick(el, ['fontFamily', 'fontSize', 'borderTopLeftRadius', 'borderTopColor', 'borderTopWidth', 'backgroundColor', 'color', 'paddingLeft', 'width']) };
  });
  facts.status = (spec.status || []).map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { sel, found: false };
    return { sel, found: true, ...describe(el), text: el.textContent.trim().slice(0, 80), height: el.getBoundingClientRect().height, ...pick(el, ['color', 'fontSize', 'marginTop']) };
  });
  if (spec.ordersSection) {
    const el = document.querySelector(spec.ordersSection);
    facts.orders = el ? { whiteSpace: cs(el).whiteSpace, height: el.getBoundingClientRect().height } : null;
  }
  return facts;
}

// in-page: mark the first enabled focus target (action or input) for the keyboard walk
export function markFocusTarget(spec) {
  const sels = [...(spec.actions || []).filter((a) => a.expect === 'enabled').map((a) => a.sel), ...(spec.inputs || [])];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (el && !el.disabled) { el.setAttribute('data-harness-focus', ''); return sel; }
  }
  return null;
}
export function readFocus() {
  const el = document.activeElement;
  if (!el || !el.hasAttribute('data-harness-focus')) return { onTarget: false, active: el ? el.tagName.toLowerCase() : null };
  const s = getComputedStyle(el);
  return { onTarget: true, focusVisible: el.matches(':focus-visible'), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, outlineOffset: s.outlineOffset, boxShadow: s.boxShadow };
}

// in-page: cascade controls. `target` is 'action' (first button-kind action) or 'container'
// (main's top-level child holding the runtime root). Rules are injected with a harness attribute
// selector so they reach the element whatever class vocabulary the surface ends up using.
//   pre  : `@layer harness-pre` inserted as the FIRST <head> child — declared before the page's own
//          layer-order statement → lowest-priority layer. It must NOT win if a reef.base rule sets
//          the property (negative control).
//   theme: the same rule inside `@layer reef.theme` appended at the end of <head> → must win
//          (positive control: the probe can see a layer win at all).
//
// 🔴 On a coral state the `action` target is the coral's OWN button, and whether the injected
// reef.theme rule wins there is precisely the site's declaration — so that one reading is the
// measurement, not a control. Its verdict is mode-aware below; the injection itself is identical
// in both modes, which is what makes the pair comparable.
export function cascadeControls(spec) {
  const out = {};
  const rootEl = spec.root ? document.querySelector(spec.root) : null;
  const main = document.querySelector('main');
  const btn = (spec.actions || []).filter((a) => a.kind === 'button').map((a) => document.querySelector(a.sel)).find(Boolean);
  const top = rootEl && main ? [...main.children].find((c) => c.contains(rootEl)) : null;
  // probe values differ from the custom theme's own override values (3px / 777px) on purpose
  const targets = { action: [btn, 'border-top-left-radius', 'borderTopLeftRadius', '5px'], container: [top, 'max-width', 'maxWidth', '555px'] };
  for (const [name, [el, prop, cprop, val]] of Object.entries(targets)) {
    if (!el) { out[name] = null; continue; }
    el.setAttribute('data-harness-cascade', name);
    const read = () => getComputedStyle(el)[cprop];
    const rule = `[data-harness-cascade="${name}"] { ${prop}: ${val}; }`;
    const base = read();
    const pre = document.createElement('style');
    pre.textContent = `@layer harness-pre { ${rule} }`;
    document.head.insertBefore(pre, document.head.firstChild);
    const withPre = read();
    pre.remove();
    const th = document.createElement('style');
    th.textContent = `@layer reef.theme { ${rule} }`;
    document.head.appendChild(th);
    const withTheme = read();
    th.remove();
    const after = read();
    el.removeAttribute('data-harness-cascade');
    out[name] = { element: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''), property: prop, value: val, base, withPre, withTheme, after };
  }
  return out;
}

// in-page (custom-theme arms): read the build-time theme selector overrides, then DELETE each
// override rule from the theme's own `@layer reef.theme` block and read again — the value must
// revert (when the override reached at all).
export function themeOverrideControls({ spec, overrides }) {
  const rootEl = spec.root ? document.querySelector(spec.root) : null;
  const label = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const actions = (spec.actions || []).filter((a) => a.kind === 'button').map((a) => document.querySelector(a.sel)).filter(Boolean);
  const els = { action: actions, container: rootEl && rootEl.closest('.st-runtime') ? [rootEl.closest('.st-runtime')] : [] };
  const findRules = (selector) => {
    const hits = [];
    const walk = (list, parent) => {
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r instanceof CSSStyleRule) { if (r.selectorText === selector && parent && parent.name === 'reef.theme') hits.push({ parent, index: i }); }
        else if (r.cssRules && r.cssRules.length) walk(r.cssRules, r);
      }
    };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules, null); } catch { /* cross-origin */ } }
    return hits;
  };
  const snapshots = overrides.map((o) => ({ o, items: els[o.probe].map((el) => ({ el, element: label(el), matchesSelector: el.matches(o.selector), withTheme: getComputedStyle(el)[o.computed] })) }));
  // Remove every override rule first, THEN read: overrides are independent properties.
  const removed = {};
  for (const o of overrides) { const hits = findRules(o.selector); removed[o.id] = hits.length; for (const h of hits.reverse()) h.parent.deleteRule(h.index); }
  return snapshots.map(({ o, items }) => ({
    id: o.id, selector: o.selector, property: o.property, expect: o.expect, probeTarget: o.probe,
    elementFound: items.length > 0, themeRulesFound: removed[o.id],
    items: items.map((it) => ({ element: it.element, matchesSelector: it.matchesSelector, withTheme: it.withTheme, afterRemoval: getComputedStyle(it.el)[o.computed] })),
  }));
}

// ── Node: verdicts ───────────────────────────────────────────────────────────────────────────────
const rgbOf = (hex) => { const h = hex.replace('#', ''); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; };
const firstFamily = (f) => String(f || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
export { rgbOf };

/**
 * @param spec      the state
 * @param theme     'plain' | 'tokens' | 'custom' — the theme treatment this arm wears
 * @param declared  true when this arm's site declares `dynamic-coral-css: layered`
 * @param vp        'desktop' | 'narrow'
 */
export function verdicts({ spec, theme, declared, vp, facts, expectedLang, themeTokens, headingOverride }) {
  const checks = [];
  const add = (id, result, detail = '') => checks.push({ id, result, detail });
  const T = facts.tokens;
  const coral = !!spec.coral;

  // shell + language
  const sh = facts.shell;
  add('shell', sh.header && sh.nav && sh.footer && sh.mainCount === 1 ? 'PASS' : 'FAIL', `header=${sh.header} nav=${sh.nav} footer=${sh.footer} main=${sh.mainCount}`);
  add('lang', facts.htmlLang === expectedLang ? 'PASS' : 'FAIL', `html lang=${facts.htmlLang} expected=${expectedLang}`);
  // The mode the page actually carries must be the mode this arm asked for. Cheap, and it is the
  // difference between "the override did not reach" being a finding and being a broken fixture.
  const wantStamp = declared ? 'layered' : '';
  add('coral-css-mode', facts.coralCssStamp === wantStamp ? 'PASS' : 'FAIL',
    `document root data-dynamic-coral-css=${JSON.stringify(facts.coralCssStamp)} expected ${JSON.stringify(wantStamp)}`);

  // content inset / bounded width
  if (!facts.inset) add('inset', 'FAIL', `runtime root not found (${spec.root})`);
  else {
    const i = facts.inset; const vw = facts.viewport.width;
    const leftOk = i.contentLeft >= 16; const rightOk = vw - i.contentRight >= 16; const widthOk = vp !== 'desktop' || (i.contentRight - i.contentLeft) <= 1200;
    add('inset', leftOk && rightOk && widthOk ? 'PASS' : 'FAIL',
      `${i.measured} content-left=${i.contentLeft.toFixed(1)}px right-gap=${(vw - i.contentRight).toFixed(1)}px width=${(i.contentRight - i.contentLeft).toFixed(0)}px${leftOk ? '' : ' [left<16]'}${rightOk ? '' : ' [right<16]'}${widthOk ? '' : ' [width>1200]'}`);
  }

  // heading typography equals the build-time heading under the same theme
  //
  // 🔴 Except on a coral state, where the heading is painted by the coral's OWN package CSS
  // (`.dc-pp-title { color: var(--gd-text, inherit) }`). There the answer is the site's
  // declaration, and BOTH answers are correct for the site that chose them:
  //   undeclared  the theme's `h1, h2 { color: … }` cannot reach it and the heading follows
  //               --gd-text. That is what every site built before the declaration existed looks
  //               like, so it is asserted as a LOCKED NEGATIVE CONTROL, not tolerated as a gap.
  //   declared    the coral CSS is in reef.corals, the theme's selector wins, and the heading
  //               matches the build-time reference like every other heading on the site.
  if (spec.heading) {
    const h = facts.heading; const r = facts.refs.h1;
    const overrideColor = headingOverride ? rgbOf(headingOverride.value) : null;
    if (!h) add('heading', 'FAIL', `heading not found (${spec.heading})`);
    else if (coral && !declared) {
      const followsToken = h.color === T.text;
      // With no heading override in the theme there is nothing for the override to fail to reach,
      // so the negative control is only meaningful on an arm that has one.
      const notOverridden = !overrideColor || h.color !== overrideColor;
      add('coral-heading:undeclared-keeps-token-colour', followsToken && notOverridden ? 'PASS' : 'FAIL',
        `${h.color} (--gd-text ${T.text})${overrideColor ? `; theme h1/h2 override ${overrideColor} must NOT reach coral markup` : '; theme declares no heading override'}` +
        `${followsToken ? '' : ' [coral heading is not following --gd-text]'}${notOverridden ? '' : ' [the theme override reached an undeclared site]'}`);
    } else {
      const bad = []; if (h.fontFamily !== r.fontFamily) bad.push(`font-family ${h.fontFamily} ≠ ref ${r.fontFamily}`); if (h.color !== r.color) bad.push(`color ${h.color} ≠ ref ${r.color}`);
      add(coral ? 'coral-heading:declared-follows-theme' : 'heading', bad.length ? 'FAIL' : 'PASS', bad.join('; ') || `font=${firstFamily(h.fontFamily)} color=${h.color}`);
    }
  }

  // actions
  for (const a of facts.actions || []) {
    const id = `action:${a.expect}:${a.sel}`;
    if (!a.found) { add(id, 'FAIL', 'not found'); continue; }
    if (a.kind === 'link') {
      const button = a.backgroundColor === T.btnFill && a.color === T.ink;
      add(id, button || a.color === T.accent ? 'PASS' : 'FAIL', `${button ? 'button-styled' : a.color === T.accent ? 'accent link' : 'not token-derived'} color=${a.color} bg=${a.backgroundColor}`);
      continue;
    }
    if (a.expect === 'disabled') {
      const aff = parseFloat(a.opacity) < 1 || a.cursor === 'not-allowed';
      add(id, a.disabled && aff ? 'PASS' : 'FAIL', `disabled=${a.disabled} opacity=${a.opacity} cursor=${a.cursor} bg=${a.backgroundColor}${aff ? '' : ' [no disabled affordance]'}`);
      continue;
    }
    const bad = [];
    const fillOk = a.backgroundColor === T.btnFill || (coral && a.backgroundColor === T.accent);
    if (!fillOk) bad.push(`bg ${a.backgroundColor} ≠ --gd-btn-fill ${T.btnFill}`);
    if (a.color !== T.ink) bad.push(`color ${a.color} ≠ --gd-accent-ink ${T.ink}`);
    if (a.cursor !== 'pointer') bad.push(`cursor ${a.cursor}`);
    // Radius is the property the custom theme overrides and the property coral CSS pins to
    // --gd-pill, so it is only a token question on a renderer-painted action under a theme that
    // does not overwrite it.
    if (theme !== 'custom' && !coral && a.borderTopLeftRadius !== T.btnRadius) bad.push(`radius ${a.borderTopLeftRadius} ≠ --gd-btn-radius ${T.btnRadius}`);
    if (a.disabled) bad.push('unexpectedly disabled');
    add(id, bad.length ? 'FAIL' : 'PASS', bad.join('; ') || `bg=${a.backgroundColor} color=${a.color} radius=${a.borderTopLeftRadius}`);
  }

  // card / list treatment
  if (spec.cards) {
    const c = facts.cards;
    if (!c || !c.count) add('cards', 'FAIL', `no cards (${spec.cards})`);
    else {
      const bad = [];
      const cont = c.container;
      if (!/grid|flex/.test(cont.display)) bad.push(`container ${cont.tag}.${cont.classes} display=${cont.display}`);
      if ((cont.tag === 'ul' || cont.tag === 'ol') && (cont.listStyleType !== 'none' || parseFloat(cont.paddingLeft) > 0)) bad.push(`list bullets/padding list-style=${cont.listStyleType} padding-left=${cont.paddingLeft}`);
      for (const it of c.items) {
        if (it.display === 'list-item' && it.listStyleType !== 'none') bad.push(`card ${it.tag} shows list marker`);
        const treated = !/rgba\(0, 0, 0, 0\)|transparent/.test(it.backgroundColor) || parseFloat(it.borderTopWidth) > 0 && it.borderTopStyle !== 'none' || it.boxShadow !== 'none';
        if (!treated) { bad.push(`card ${it.tag} has no surface/border/shadow`); break; }
        for (const m of it.media) if (m.width > it.width + 1) { bad.push(`card media ${m.width}px wider than card ${it.width}px`); break; }
      }
      add('cards', bad.length ? 'FAIL' : 'PASS', bad.join('; ') || `${c.count} cards in ${cont.tag} display=${cont.display}`);
    }
  }

  // inputs
  for (const inp of facts.inputs || []) {
    const id = `input:${inp.sel}`;
    if (!inp.found) { add(id, 'FAIL', 'not found'); continue; }
    const fontOk = inp.fontFamily === facts.body.fontFamily;
    const shapeOk = inp.borderTopLeftRadius === T.radius || inp.borderTopColor === T.border;
    add(id, fontOk && shapeOk ? 'PASS' : 'FAIL', `${fontOk ? '' : `font ${firstFamily(inp.fontFamily)} ≠ body ${firstFamily(facts.body.fontFamily)}; `}${shapeOk ? '' : `radius ${inp.borderTopLeftRadius}/border ${inp.borderTopColor} not token (${T.radius}/${T.border}); `}size=${inp.fontSize}`);
  }

  // status text
  for (const s of facts.status || []) {
    const id = `status:${s.sel}`;
    if (!s.found) { add(id, 'FAIL', 'not found'); continue; }
    const filled = s.text.length > 0 && s.height > 0;
    const tone = s.color === T.muted || s.color === T.text;
    add(id, filled && tone ? 'PASS' : 'FAIL', `${filled ? '' : '[empty/hidden] '}color=${s.color}${tone ? '' : ` not muted ${T.muted}/text ${T.text}`} size=${s.fontSize}`);
  }

  // account orders section keeps island newlines
  if (spec.ordersSection) {
    const o = facts.orders;
    add('orders-lines', o && /pre/.test(o.whiteSpace) ? 'PASS' : 'FAIL', o ? `white-space=${o.whiteSpace}` : 'orders section not found');
  }

  // keyboard focus-visible
  if (facts.focus) {
    const f = facts.focus;
    if (!f.target) add('focus-visible', 'NA', 'no enabled control');
    else if (!f.onTarget) add('focus-visible', 'FAIL', `could not focus ${f.target} (${f.method})`);
    else {
      const ringOk = (f.outlineStyle !== 'none' && f.outlineStyle !== 'auto' && parseFloat(f.outlineWidth) >= 1) || (f.boxShadow && f.boxShadow !== 'none');
      const res = ringOk ? 'PASS' : (coral ? 'NA' : 'FAIL');
      add('focus-visible', res, `${f.method} → ${f.target}: outline=${f.outlineStyle} ${f.outlineWidth} ${f.outlineColor} box-shadow=${f.boxShadow}${ringOk ? '' : f.outlineStyle === 'auto' ? ' [UA default ring only]' : ' [no ring]'}${coral && !ringOk ? ' (coral package CSS ships no focus ring: informational)' : ''}`);
    }
  }

  // overflow + media escape
  {
    const over = facts.viewport.scrollWidth > facts.viewport.width + 1;
    const escaped = (facts.media || []).filter((m) => m.right > facts.viewport.width + 1 || m.width > facts.viewport.width + 1);
    const id = vp === 'narrow' ? 'overflow' : 'overflow(desktop)';
    add(id, !over && !escaped.length ? 'PASS' : 'FAIL', `scrollWidth=${facts.viewport.scrollWidth} clientWidth=${facts.viewport.width}${escaped.length ? ` media escape: ${escaped.map((m) => `${m.tag} w=${m.width.toFixed(0)} right=${m.right.toFixed(0)}`).join(', ')}` : ''}`);
  }

  // token literal inheritance (theme arms) — unchanged by the declaration, in either mode, which is
  // the point: layering moves selector reach, not token reads.
  if (themeTokens) {
    const btn = (facts.actions || []).find((a) => a.found && a.kind === 'button' && a.expect === 'enabled');
    const accent = rgbOf(themeTokens.accent);
    if (btn) add('token-literal:action', btn.backgroundColor === accent ? 'PASS' : 'FAIL', `action bg=${btn.backgroundColor} theme --gd-accent=${accent}`);
    const fam = firstFamily(themeTokens.font);
    const bodyOk = firstFamily(facts.body.fontFamily) === fam;
    const inpBad = (facts.inputs || []).filter((i) => i.found && firstFamily(i.fontFamily) !== fam);
    add('token-literal:font', bodyOk && !inpBad.length ? 'PASS' : 'FAIL', `body=${firstFamily(facts.body.fontFamily)} theme=${fam}${inpBad.length ? ` inputs not inheriting: ${inpBad.map((i) => firstFamily(i.fontFamily)).join(',')}` : ''}`);
  }

  // cascade controls (injected layers)
  // Not on a custom-theme arm: its build-time theme overrides the same properties, which would
  // confound "pre-layer loses to reef.base" (it would lose to reef.theme instead). A custom arm is
  // proven by the build-time selector-override + rule-removal control below.
  if (facts.cascade && theme === 'custom') {
    add('cascade', 'NA', 'injected layer controls run in the plain/tokens arms; a custom arm uses its build-time theme rules');
  } else if (facts.cascade) {
    for (const [name, c] of Object.entries(facts.cascade)) {
      // The container target is renderer markup on every state, coral or not — it is the
      // `.st-runtime`/section wrapper, never the coral's own element — so on a coral state it says
      // nothing about the declaration and is left NA rather than given a mode-aware reading it
      // cannot support.
      if (coral && name !== 'action') { add(`cascade:${name}`, 'NA', 'container is renderer markup; the declaration only moves the coral\'s own CSS'); continue; }
      if (!c) { add(`cascade:${name}`, 'NA', name === 'action' ? 'no button action in state' : 'no runtime top-level element'); continue; }
      const preLoses = c.withPre === c.base && c.base !== c.value;
      const themeWins = c.withTheme === c.value;
      const reverts = c.after === c.base;
      add(`cascade:${name}:pre-layer-loses`, preLoses ? 'PASS' : 'FAIL', `${c.element} ${c.property}: base=${c.base} with @layer-before-reef.base=${c.withPre}${preLoses ? '' : c.base === c.value ? ' [base already equals probe value]' : ' [pre-layer rule won → no reef.base rule sets this property on the element]'}`);
      if (coral && !declared) {
        // The locked negative control: unlayered coral CSS outranks every layer, so an injected
        // reef.theme rule must NOT move it, and removing that rule must change nothing.
        const themeLoses = c.withTheme === c.base && c.base !== c.value;
        add(`cascade:${name}:undeclared-coral-css-outranks-theme`, themeLoses && reverts ? 'PASS' : 'FAIL',
          `${c.element} ${c.property}: base=${c.base} with injected reef.theme=${c.withTheme} after removal=${c.after}` +
          `${themeLoses ? '' : ' [a reef.theme rule reached unlayered coral CSS on an undeclared site]'}`);
      } else {
        add(`cascade:${name}:reef.theme-wins`, themeWins && reverts ? 'PASS' : 'FAIL', `${c.element} ${c.property}: with injected reef.theme=${c.withTheme} after removal=${c.after}`);
      }
    }
  }

  // build-time theme selector overrides (custom-theme arms)
  if (facts.themeOverrides) {
    for (const o of facts.themeOverrides) {
      const id = `reef.theme-selector:${o.id}`;
      // Same split as the cascade controls: only the `action` probe lands on coral markup.
      if (coral && o.probeTarget !== 'action') { add(id, 'NA', 'container is renderer markup; the declaration only moves the coral\'s own CSS'); continue; }
      if (!o.elementFound) {
        if (o.id === 'container-max-width') add(id, 'FAIL', 'runtime root has no .st-runtime ancestor (the container override selector cannot reach it)');
        else add(id, 'NA', 'no button action in state');
        continue;
      }
      if (coral && !declared) {
        // Locked negative control: the theme rule exists, matches the element as a selector, and
        // still must not win — because unlayered coral CSS outranks it. `matchesSelector` is what
        // separates "the theme could not reach it" from "there was nothing to reach".
        const bad = o.items.filter((i) => !i.matchesSelector || i.withTheme === o.expect || i.afterRemoval !== i.withTheme);
        add(`${id}:undeclared-does-not-reach`, !bad.length && o.themeRulesFound > 0 ? 'PASS' : 'FAIL',
          `${o.property} via \`${o.selector}\` must NOT reach coral markup: ` + o.items.map((i) =>
            `${i.element} matches=${i.matchesSelector} value=${i.withTheme} removed→${i.afterRemoval}` +
            `${i.withTheme === o.expect ? ` [override reached an undeclared site: ${o.expect}]` : ''}` +
            `${i.afterRemoval !== i.withTheme ? ' [removing the theme rule moved it, so it WAS applying]' : ''}`).join('; ') +
          (o.themeRulesFound ? '' : ' [theme rule not found in reef.theme layer]'));
        continue;
      }
      // After the theme rule is removed the value must fall back to a value the page itself sets —
      // for a renderer action, the token radius; for a coral action, the coral's own pill radius —
      // or the arm only proved "theme beats the browser", not "theme beats what was there".
      const baseValue = (i) => (o.id === 'action-radius' && !coral ? i.afterRemoval === T.btnRadius : i.afterRemoval !== 'none');
      const bad = o.items.filter((i) => i.withTheme !== o.expect || i.afterRemoval === o.expect || !baseValue(i));
      add(coral ? `${id}:declared-reaches-coral-markup` : id, !bad.length && o.themeRulesFound > 0 ? 'PASS' : 'FAIL',
        `${o.property} via \`${o.selector}\` (expect ${o.expect}): ` + o.items.map((i) => `${i.element} theme=${i.withTheme} removed→${i.afterRemoval}${i.withTheme !== o.expect ? ' [override did not win]' : ''}${i.afterRemoval === o.expect ? ' [did not revert]' : ''}${i.afterRemoval !== o.expect && !baseValue(i) ? ` [reverts to non-renderer value; expected ${o.id === 'action-radius' ? `--gd-btn-radius ${T.btnRadius}` : 'a reef.base max-width'}]` : ''}`).join('; ') +
        (o.themeRulesFound ? '' : ' [theme rule not found in reef.theme layer]'));
    }
  }

  const overall = checks.some((c) => c.result === 'FAIL') ? 'FAIL' : 'PASS';
  return { overall, checks };
}

// ── Node: the no-regression pass across a legacy/declared PAIR ──────────────────────────────────
// A declared arm and its legacy twin are built from the same IR, the same theme text and the same
// fixtures; one line of `_site.md` is the whole difference. So every computed-style fact the two
// runs record should be identical EXCEPT where the declaration is supposed to bite, and listing
// the exceptions is a stronger statement than any list of properties someone remembered to check.
//
// That is also the no-regression arm: the renderer's own package CSS (locale banner, signet,
// bleedblend) sits in reef.theme, and moving coral CSS into reef.corals puts it under all of that
// for the first time. If any of it starts painting `dc-*` markup, it shows up here as a delta
// nobody asked for.

/** Measurement keys whose values are not a property of the page: they are the harness's own
 *  instrumentation, or they record how a reading was taken rather than what was read. */
const DELTA_IGNORE = new Set(['focus', 'cascade', 'themeOverrides', 'consoleErrors']);

/** Properties the custom theme's selector overrides are ALLOWED to move on coral markup. Anything
 *  else moving is the finding this pass exists for. */
export const INTENDED_OVERRIDE_PROPS = new Set(['color', 'borderTopLeftRadius', 'maxWidth']);

const round = (n) => Math.round(n * 100) / 100;

/** Flatten a facts object to `path → primitive`, so two runs can be compared leaf by leaf. */
export function flattenFacts(value, prefix = '', out = new Map()) {
  if (value === null || typeof value !== 'object') { out.set(prefix, typeof value === 'number' ? round(value) : value); return out; }
  if (Array.isArray(value)) { value.forEach((v, i) => flattenFacts(v, `${prefix}[${i}]`, out)); return out; }
  for (const [k, v] of Object.entries(value)) {
    if (DELTA_IGNORE.has(k)) continue;
    flattenFacts(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/** Every leaf that differs between a legacy run and its declared twin. */
export function modeDelta(legacyFacts, declaredFacts) {
  const a = flattenFacts(legacyFacts);
  const b = flattenFacts(declaredFacts);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const out = [];
  for (const p of paths) {
    // The stamp itself is the input that differs; it is asserted by `coral-css-mode`, not here.
    if (p === 'coralCssStamp') continue;
    const l = a.has(p) ? a.get(p) : undefined;
    const d = b.has(p) ? b.get(p) : undefined;
    if (l !== d) out.push({ path: p, legacy: l, declared: d });
  }
  return out;
}

/**
 * Verdict on one pair's deltas.
 * @param coral        the state measures a dynamic coral's own package CSS
 * @param overrides    the theme carries selector overrides (the custom-theme arms)
 */
export function modeDeltaVerdict({ coral, overrides, deltas }) {
  const leaf = (p) => p.split('.').pop().replace(/\[\d+\]$/, '');
  const allowed = coral && overrides ? deltas.filter((d) => INTENDED_OVERRIDE_PROPS.has(leaf(d.path))) : [];
  const unexpected = deltas.filter((d) => !allowed.includes(d));
  const show = (list) => list.slice(0, 6).map((d) => `${d.path}: ${d.legacy} → ${d.declared}`).join('; ') + (list.length > 6 ? ` (+${list.length - 6} more)` : '');
  if (unexpected.length) {
    return { result: 'FAIL', detail:
      `${unexpected.length} computed-style ${unexpected.length === 1 ? 'value' : 'values'} moved that the declaration should not touch` +
      `${coral ? '' : ' (this state paints no coral package CSS, so nothing here should move at all)'}: ${show(unexpected)}` };
  }
  if (!deltas.length) return { result: 'PASS', detail: 'byte-identical measurement against the legacy twin' };
  return { result: 'PASS', detail: `${deltas.length} intended override ${deltas.length === 1 ? 'delta' : 'deltas'} on coral markup: ${show(allowed)}` };
}
