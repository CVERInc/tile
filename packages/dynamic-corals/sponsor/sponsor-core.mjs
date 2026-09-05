// REEF with Sponsor — the sponsor coral, CORE. The distributable `sponsor.js` is BUILT from
// sponsor-client.mjs, which imports this file; do not edit sponsor.js by hand.
//
// Everything the widget does lives here, and every function either is pure or takes the node it
// works on as an argument — so `node --test` drives the whole thing without a browser, the same
// core/client split the events coral uses. The client beside this file is the few lines that find
// the mount points and hand them over.
//
// ── WHY A CORAL OF ITS OWN ──────────────────────────────────────────────────────────────────
// Not the `cta` section, and that is an owner ruling rather than a preference (feelreef 金流表面
// 主線 D6a). A generic action button has a destination and no state. A sponsor block has an
// AMOUNT: a field the visitor types into, a few suggested values, a default the owner picked, and
// bounds. None of that grows out of a link — the amount IS the shape of the thing, so it gets its
// own coral.
//
// ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────
// 🔴 IT COLLECTS AN AMOUNT. That is the entire job. There is no payment SDK here, no card field,
// no merchant id, no provider-specific redirect built in the browser. It POSTs
// {guild_id, amount, currency} to the feelreef backend and follows the `url` the backend hands
// back — the same "ask the backend for a link, then go there" shape the shop coral beside it uses
// for its own money path. WHICH rail the site owner is connected to is decided on the backend and
// is invisible from here; adding a rail must never mean editing this file.
//
// Config (data-* attributes on the container — the mount contract is ../README.md):
//   data-guild-id        (required) — which seller receives the sponsorship.
//   data-api-base        (required) — the origin of the feelreef backend this mount asks for a
//                        link. There is no default; see WHERE IT SENDS IT below.
//   data-currency        (optional) — ISO 4217 code, default "TWD".
//   data-currency-symbol (optional) — what the visitor SEES beside the field (default: the code).
//   data-presets         (optional) — suggested amounts, comma separated: "100,300,500".
//   data-default-amount  (optional) — what the field starts at when the URL says nothing.
//   data-min / data-max  (optional) — the field's accepted range (default 1 … 1000000).
//   data-amount-param    (optional) — the query parameter that prefills the field (default "amount").
//   data-title / data-note                        (optional) — copy above the field.
//   data-amount-label / data-submit-label /
//   data-invalid-label / data-error-label /
//   data-not-activated-label / data-unconnected-label (optional) — copy, so a zh-TW page passes
//                                                     native strings.
//
// Usage:
//   <div data-dynamic-coral="sponsor" data-guild-id="123" data-presets="100,300,500"></div>
//   <script type="module" src=".../sponsor.js"></script>

/**
 * ── WHERE IT SENDS IT ──
 * 🔴 THERE IS NO DEFAULT ORIGIN, and removing the one that was here is the point.
 *
 * It used to fall back to the `feelreef.com` front door, which answers this route on no
 * deployment that exists. The front door there is a Pages app with no `/api/v2/shop/*` route of
 * its own; a path it does not name falls through to the legacy Python backend, which registers
 * `catalog`, `catalog/item` and `cart` under that prefix and no `sponsor` at all. The serving
 * plane that does answer it sits on its own hostname, a different one per environment — which is
 * a fact about where the SITE was deployed, and this file cannot know it.
 *
 * So a fallback buys nothing but a 404 that reads as a backend outage to the visitor and as a
 * working block to whoever shipped the page. A mount with no `data-api-base` has nowhere to send
 * the money, which is the same condition as a mount with no seller — and it degrades the same way.
 */

/** Names the attribute a mount refused over, for whoever has to fix the page. */
export const UNMOUNTED_ATTR = 'data-dc-sponsor-unmounted';

/** The one route this coral calls. Processor-neutral by name on purpose — see the header. */
export const SPONSOR_PATH = '/api/v2/shop/sponsor';

export const SELECTOR = '[data-dynamic-coral="sponsor"]';
const PREFIX = 'dc-sponsor';

/** Marker put back on the page URL when the visitor returns having paid. */
export const RETURN_PARAM = 'dc_sponsor';

/** The query parameter that prefills the field, when the page does not name another. */
const DEFAULT_AMOUNT_PARAM = 'amount';

/**
 * Field bounds used when the page states none. They are an INPUT AFFORDANCE — a fat-finger guard
 * and a sanity ceiling — never an authorisation: the backend re-checks whatever arrives.
 */
const DEFAULT_MIN = '1';
const DEFAULT_MAX = '1000000';

/** Longest string this coral will even try to read out of a URL. */
const MAX_RAW_LEN = 32;

let mountSeq = 0;
let stylesInjected = false;

// ── amounts ────────────────────────────────────────────────────────────────────────────────────

/**
 * Turn whatever a human (or a URL) supplied into ONE canonical decimal string, or say why not.
 *
 * 🔴 STRINGS, NOT FLOATS, ALL THE WAY THROUGH. `parseFloat('0.1') * 100` is 10.000000000000002,
 * and money that goes through a float comes out the other side needing a rounding policy nobody
 * wrote down. The comparison against min/max runs on an integer number of HUNDREDTHS derived by
 * padding the fraction — exact for the two decimal places this accepts.
 *
 * 🔴 `hundredths` IS FOR COMPARING, NEVER FOR THE WIRE. It is not the minor unit: TWD and JPY have
 * no minor unit at all, so multiplying by 100 and calling it "cents" is a 100x error waiting for
 * its first zero-decimal currency. The wire carries the decimal string plus the currency, and the
 * backend — which knows the rail and its exponent — does that conversion.
 *
 * @param {unknown} raw
 * @param {{min?: string|number, max?: string|number}} [opts]
 * @returns {{ok: true, amount: string, hundredths: number} | {ok: false, reason: string}}
 */
export function normalizeAmount(raw, opts) {
  const o = opts || {};
  if (raw === null || raw === undefined) return { ok: false, reason: 'empty' };
  // thousands separators and stray spaces are typing, not intent
  const s = String(raw).trim().replace(/[,\s]/g, '');
  if (!s) return { ok: false, reason: 'empty' };
  if (s.length > MAX_RAW_LEN) return { ok: false, reason: 'not_a_number' };
  // Digits, at most one dot. No sign, no exponent, no hex — every one of those is somebody
  // probing, not somebody sponsoring.
  if (!/^\d*(?:\.\d*)?$/.test(s) || s === '.') return { ok: false, reason: 'not_a_number' };

  const dot = s.indexOf('.');
  const intPart = (dot === -1 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, '') || '0';
  const fracRaw = dot === -1 ? '' : s.slice(dot + 1);
  if (fracRaw.length > 2) return { ok: false, reason: 'too_many_decimals' };
  const frac = fracRaw.replace(/0+$/, '');

  const amount = frac ? intPart + '.' + frac : intPart;
  const hundredths = Number(intPart) * 100 + Number((fracRaw + '00').slice(0, 2));
  if (!Number.isFinite(hundredths)) return { ok: false, reason: 'not_a_number' };
  if (hundredths === 0) return { ok: false, reason: 'zero' };

  const min = boundHundredths(o.min, DEFAULT_MIN);
  const max = boundHundredths(o.max, DEFAULT_MAX);
  if (min !== null && hundredths < min) return { ok: false, reason: 'below_min' };
  if (max !== null && hundredths > max) return { ok: false, reason: 'above_max' };

  return { ok: true, amount, hundredths };
}

/** A bound, in the same hundredths the comparison uses. An unreadable bound falls back, not off. */
function boundHundredths(value, fallback) {
  for (const candidate of [value, fallback]) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const s = String(candidate).trim().replace(/[,\s]/g, '');
    if (s === '' || s === '.' || !/^\d*(?:\.\d{0,2})?$/.test(s)) continue;
    const dot = s.indexOf('.');
    const intPart = dot === -1 ? s : s.slice(0, dot);
    const fracRaw = dot === -1 ? '' : s.slice(dot + 1);
    return Number(intPart || '0') * 100 + Number((fracRaw + '00').slice(0, 2));
  }
  return null;
}

/**
 * The amount a shared link asks the field to start at — "sponsor me NT$500" as a URL.
 *
 * 🔴 THIS VALUE IS UNTRUSTED, AND IT PREFILLS THE FIELD. NOTHING ELSE.
 * Anyone can write that URL: the visitor, whoever sent them the link, a page that framed it. So it
 * gets exactly one power, which is to decide what the box says when the page opens. The amount
 * that is actually charged is read back OUT of the box at the moment the button is pressed (see
 * `mountSponsor`) and re-validated there, so a visitor who types over the prefill overrides the
 * link completely — and a link carrying nonsense simply does not prefill.
 *
 * 🔴 AND THE SERVER VALIDATES AGAIN. All of the above happens in a browser that the sender of the
 * link may control, so none of it is a security property — it is honesty about which value is the
 * real one. The backend re-checks the amount it receives against the site's own rules before it
 * mints anything; a bound in this file is an affordance, never an authorisation.
 */
export function readPrefillAmount(search, param, bounds) {
  let raw;
  try {
    raw = new URLSearchParams(search || '').get(param || DEFAULT_AMOUNT_PARAM);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const parsed = normalizeAmount(raw, bounds);
  // Out of range / not a number → no prefill at all. Silently clamping a hostile number to the
  // maximum would put a figure in front of the visitor that nobody chose.
  return parsed.ok ? parsed.amount : null;
}

/** Suggested amounts, in the order the owner wrote them. Unreadable entries are dropped, not guessed. */
export function parsePresets(raw, bounds) {
  if (!raw) return [];
  const out = [];
  for (const piece of String(raw).split('|').join(',').split(',')) {
    const parsed = normalizeAmount(piece, bounds);
    if (parsed.ok && !out.includes(parsed.amount)) out.push(parsed.amount);
  }
  return out;
}

// ── the request ────────────────────────────────────────────────────────────────────────────────

/**
 * The body this coral sends. Its own function so the wire shape is one readable object that a test
 * can assert on and the backend baton can read straight off (the RSP-side landing point, D6b).
 *
 * `amount` is a canonical decimal string in MAJOR units — '500', '12.5' — paired with `currency`.
 * See normalizeAmount for why the browser does not convert to minor units.
 */
export function buildSponsorRequest(input) {
  return {
    guild_id: input.guildId,
    amount: input.amount,
    currency: input.currency,
    redirect_url: input.redirectUrl || undefined,
    client_request_ref: input.clientRequestRef,
  };
}

/**
 * Mints the idempotency token, and reuses it for the SAME amount.
 *
 * Copied in policy from the shop coral next door, which documents why the backend requires one: a
 * retry after a lost response must reconcile to the same link instead of minting a second
 * projection. Keying by the amount is what makes "stable per intent, distinct per intent" true by
 * shape — press twice on 500 and it is one intent; change to 1000 and it is genuinely another.
 * A fresh page load starts a fresh map; nothing is persisted.
 */
export function requestRefFor(refs, amount) {
  let ref = refs.get(amount);
  if (!ref) {
    ref = newClientRequestRef();
    refs.set(amount, ref);
  }
  return ref;
}

function newClientRequestRef() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // `crypto.randomUUID` is secure-context-gated, so an http:// page has none. Still cryptographic
  // entropy — never Math.random — because this token is half of the backend's idempotency key.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [];
  for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

// ── configuration ──────────────────────────────────────────────────────────────────────────────

/**
 * The origin exactly as the page named it, minus a trailing slash, and '' when it named none.
 * Trimmed and de-slashed because this attribute is the ONLY source of the origin now: with the
 * fallback gone, an origin written with a trailing slash doubles it into every request the site
 * makes, out of one keystroke nobody would look at twice.
 */
function apiBaseFrom(raw) {
  return (raw || '').trim().replace(/\/+$/, '');
}

/** Every knob is a data-* attribute on the container. */
export function readConfig(el) {
  const attr = (name) => el.getAttribute(name);
  const currency = (attr('data-currency') || 'TWD').trim().toUpperCase();
  const bounds = { min: attr('data-min') || DEFAULT_MIN, max: attr('data-max') || DEFAULT_MAX };
  return {
    guildId: attr('data-guild-id'),
    apiBase: apiBaseFrom(attr('data-api-base')),
    currency,
    currencyLabel: attr('data-currency-symbol') || currency,
    bounds,
    presets: parsePresets(attr('data-presets'), bounds),
    defaultAmount: attr('data-default-amount') || '',
    amountParam: attr('data-amount-param') || DEFAULT_AMOUNT_PARAM,
    title: attr('data-title') || '',
    note: attr('data-note') || '',
    labels: {
      amount: attr('data-amount-label') || 'Amount',
      submit: attr('data-submit-label') || 'Sponsor',
      invalid: attr('data-invalid-label') || 'Enter an amount to sponsor.',
      error: attr('data-error-label') || 'Could not start that just now — try again.',
      notActivated: attr('data-not-activated-label') || "This site hasn't turned on payments yet.",
      unconnected: attr('data-unconnected-label') || 'Sponsoring is not set up on this site yet.',
    },
  };
}

// ── rendering ──────────────────────────────────────────────────────────────────────────────────

export const SPONSOR_CSS = [
  `.${PREFIX}{display:block;padding:18px 20px;border-radius:var(--gd-radius,14px);background:var(--gd-soft,rgba(0,0,0,.04));border:1px solid var(--gd-border,rgba(0,0,0,.08));color:var(--gd-text,inherit)}`,
  `.${PREFIX}-title{font-size:1.1rem;font-weight:700;margin:0 0 6px;color:var(--gd-text,inherit)}`,
  `.${PREFIX}-note{margin:0 0 14px;opacity:.8;line-height:1.5}`,
  `.${PREFIX}-presets{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}`,
  `.${PREFIX}-preset{padding:8px 14px;border-radius:999px;cursor:pointer;font:inherit;`
    + `border:1px solid var(--gd-accent-deep,var(--gd-accent,#875fb6));`
    + `background:var(--gd-surface,transparent);color:var(--gd-accent-deep,var(--gd-accent,#875fb6))}`,
  `.${PREFIX}-preset[aria-pressed="true"]{background:var(--gd-accent,#875fb6);color:var(--gd-surface,#fff)}`,
  `.${PREFIX}-row{display:flex;flex-wrap:wrap;align-items:stretch;gap:10px}`,
  `.${PREFIX}-field{display:flex;align-items:center;gap:6px;flex:1 1 160px;min-width:0;padding:0 12px;`
    + `border-radius:var(--gd-radius,10px);border:1px solid var(--gd-border,rgba(0,0,0,.2));background:var(--gd-surface,#fff)}`,
  `.${PREFIX}-currency{opacity:.7;font-variant-numeric:tabular-nums}`,
  `.${PREFIX}-amount{flex:1 1 0%;min-width:0;border:0;background:transparent;color:inherit;`
    + `font:inherit;font-size:1.1rem;padding:12px 0;font-variant-numeric:tabular-nums}`,
  `.${PREFIX}-amount:focus{outline:none}`,
  `.${PREFIX}-field:focus-within{outline:2px solid var(--gd-accent,#875fb6);outline-offset:2px}`,
  `.${PREFIX}-submit{padding:12px 22px;border:0;border-radius:var(--gd-radius,10px);cursor:pointer;`
    + `font:inherit;font-weight:700;background:var(--gd-accent,#875fb6);color:var(--gd-surface,#fff)}`,
  `.${PREFIX}-submit[disabled]{opacity:.6;cursor:default}`,
  `.${PREFIX}-status{margin:10px 0 0;min-height:1.2em;color:var(--gd-text,inherit);opacity:.85}`,
  `.${PREFIX}-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}`,
].join('');

function injectStyles(doc) {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = doc.createElement('style');
  style.setAttribute('data-dc', 'sponsor');
  style.textContent = SPONSOR_CSS;
  doc.head.appendChild(style);
}

/** Test seam only: styles inject once per page, and a test process is many pages in one page. */
export function resetStyleInjectionForTests() {
  stylesInjected = false;
}

function make(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null && text !== '') node.textContent = text;
  return node;
}

/**
 * Build the block and hand back the nodes that matter.
 *
 * 🔴 EVERY NODE IS createElement, NEVER innerHTML. The title, the note and the labels are the site
 * owner's own strings arriving through data-* attributes; assigning them as `textContent` means
 * they can never become markup. It is also what lets the mount test drive the real code with a
 * handful of objects instead of an HTML parser.
 */
export function renderSponsor(doc, cfg) {
  const id = `${PREFIX}-amount-${++mountSeq}`;
  const root = make(doc, 'form', PREFIX);
  root.setAttribute('novalidate', 'novalidate');

  if (cfg.title) root.appendChild(make(doc, 'div', `${PREFIX}-title`, cfg.title));
  if (cfg.note) root.appendChild(make(doc, 'p', `${PREFIX}-note`, cfg.note));

  const presetNodes = [];
  if (cfg.presets.length) {
    const strip = make(doc, 'div', `${PREFIX}-presets`);
    for (const amount of cfg.presets) {
      const b = make(doc, 'button', `${PREFIX}-preset`, `${cfg.currencyLabel} ${amount}`);
      b.setAttribute('type', 'button');
      b.setAttribute('data-amount', amount);
      b.setAttribute('aria-pressed', 'false');
      strip.appendChild(b);
      presetNodes.push(b);
    }
    root.appendChild(strip);
  }

  const row = make(doc, 'div', `${PREFIX}-row`);
  const field = make(doc, 'div', `${PREFIX}-field`);
  const label = make(doc, 'label', `${PREFIX}-label`, cfg.labels.amount);
  label.setAttribute('for', id);
  field.appendChild(label);
  field.appendChild(make(doc, 'span', `${PREFIX}-currency`, cfg.currencyLabel));

  const input = make(doc, 'input', `${PREFIX}-amount`);
  input.setAttribute('id', id);
  input.setAttribute('name', 'amount');
  // `type=text` + `inputmode=decimal`: a number spinner rounds, steps and localises behind your
  // back, and this value is money.
  input.setAttribute('type', 'text');
  input.setAttribute('inputmode', 'decimal');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-describedby', `${id}-status`);
  field.appendChild(input);
  row.appendChild(field);

  const submit = make(doc, 'button', `${PREFIX}-submit`, cfg.labels.submit);
  submit.setAttribute('type', 'submit');
  row.appendChild(submit);
  root.appendChild(row);

  const status = make(doc, 'p', `${PREFIX}-status`);
  status.setAttribute('id', `${id}-status`);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.appendChild(status);

  return { root, input, submit, status, presets: presetNodes };
}

// ── the mount ──────────────────────────────────────────────────────────────────────────────────

/**
 * Wire one container. Returns the parts, so a test can press the same button a visitor presses.
 *
 * `deps` exists for that test and for nothing else: with it absent the coral reads the page's own
 * `document`, `window` and `fetch`, exactly as its siblings do.
 */
export function mountSponsor(el, deps) {
  const doc = (deps && deps.document) || document;
  const win = (deps && deps.window) || window;
  const send = (deps && deps.fetch) || ((url, init) => fetch(url, init));
  const cfg = readConfig(el);

  injectStyles(doc);

  // Two things have to be present before a button can do anything: somebody to receive the money,
  // and somewhere to ask for the link. Missing either is the same outcome for the visitor and a
  // DIFFERENT repair for whoever built the page, so the refusal names which one was absent — one
  // shared "not set up" would send the owner looking at the wrong attribute.
  const missing = !cfg.guildId ? 'data-guild-id' : !cfg.apiBase ? 'data-api-base' : '';
  if (missing) {
    // Honest degrade: say the block is not set up rather than show a button that cannot work.
    el.setAttribute(UNMOUNTED_ATTR, missing);
    el.appendChild(make(doc, 'p', `${PREFIX} ${PREFIX}-status`, cfg.labels.unconnected));
    return null;
  }

  const parts = renderSponsor(doc, cfg);
  el.appendChild(parts.root);

  // ── prefill ──
  // The URL gets to choose what the box SAYS. That is the whole of its authority; see
  // readPrefillAmount. The owner's data-default-amount is the fallback when the URL says nothing.
  const fromUrl = readPrefillAmount(safeSearch(win), cfg.amountParam, cfg.bounds);
  const fallback = normalizeAmount(cfg.defaultAmount, cfg.bounds);
  const prefill = fromUrl || (fallback.ok ? fallback.amount : '');
  // The PROPERTY, not the attribute: the attribute is the field's default, the property is what
  // the visitor sees and what their typing replaces.
  if (prefill) parts.input.value = prefill;
  syncPresets(parts, prefill);

  for (const b of parts.presets) {
    b.addEventListener('click', () => {
      parts.input.value = b.getAttribute('data-amount');
      parts.status.textContent = '';
      syncPresets(parts, parts.input.value);
    });
  }

  parts.input.addEventListener('input', () => syncPresets(parts, parts.input.value));

  const refs = new Map();
  let inFlight = false;

  parts.root.addEventListener('submit', (ev) => {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (inFlight) return;

    // 🔴 THE AMOUNT THAT WILL BE CHARGED IS READ HERE, OUT OF THE FIELD, AT THE MOMENT OF THE
    // PRESS. Not from the URL, and not from a value captured when the page loaded — a visitor who
    // typed over the prefill means it, and a link that said 500 has no say once they have. It is
    // re-validated on the way through, because the box has been open to editing the whole time.
    const parsed = normalizeAmount(parts.input.value, cfg.bounds);
    if (!parsed.ok) {
      parts.status.textContent = cfg.labels.invalid;
      if (typeof parts.input.focus === 'function') parts.input.focus();
      return;
    }
    // Show exactly what is being sent, so the field and the request cannot tell different stories.
    parts.input.value = parsed.amount;
    syncPresets(parts, parsed.amount);
    inFlight = true;
    return startSponsorship(parsed.amount).then(() => { inFlight = false; });
  });

  function startSponsorship(amount) {
    const original = parts.submit.textContent;
    parts.submit.disabled = true;
    parts.submit.textContent = '…';
    parts.status.textContent = '';
    // Mint-or-reuse BEFORE the request, so a retry after a lost response asks for the same link.
    const body = buildSponsorRequest({
      guildId: cfg.guildId,
      amount,
      currency: cfg.currency,
      redirectUrl: returnUrl(win),
      clientRequestRef: requestRefFor(refs, amount),
    });
    return Promise.resolve()
      .then(() => send(cfg.apiBase + SPONSOR_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      }))
      .then((res) => Promise.resolve(res.json()).catch(() => null).then((payload) => ({ res, payload })))
      .then(({ res, payload }) => {
        if (res.ok && payload && payload.url) {
          win.location.href = payload.url;
          return 'navigated';
        }
        if (res.status === 403 && payload && payload.error === 'checkout_module_not_activated') {
          return 'not_activated';
        }
        return 'error';
      })
      .catch(() => 'error')
      .then((outcome) => {
        if (outcome === 'navigated') return;
        parts.submit.disabled = false;
        parts.submit.textContent = original;
        parts.status.textContent = outcome === 'not_activated'
          ? cfg.labels.notActivated
          : cfg.labels.error;
      });
  }

  return parts;
}

function syncPresets(parts, amount) {
  for (const b of parts.presets) {
    b.setAttribute('aria-pressed', b.getAttribute('data-amount') === amount ? 'true' : 'false');
  }
}

function safeSearch(win) {
  try {
    return win.location.search || '';
  } catch {
    return '';
  }
}

/** Where the backend sends the visitor back to. The marker lets a page notice the return. */
function returnUrl(win) {
  try {
    return win.location.origin + win.location.pathname + `?${RETURN_PARAM}=done`;
  } catch {
    return undefined;
  }
}
