// reef#2758 — `reef.cards/report`: the one door for reporting a Card. A page and its POST, nothing else.
//
// WHERE IT LIVES, AND WHY HERE. reef.cards is answered by the Card Worker and nothing else
// (card-worker.mjs: the host is dark until CARD_CANONICAL_HOST says `reef.cards`, and there is no
// fall-through to the feelreef app on it). So the page is this Worker's, served on that host only.
//
// 🔴 WHERE A REPORT LANDS: THE INBOX feelreef ALREADY READS, THROUGH THE DOOR SITES ALREADY USE. No
// mailbox, no second mail path. A Site's `_worker.js` relays its contact form server-to-server to
// feelreef's `/api/inbox` (dynamic-corals/square-shop/shop-function-template.js, handleInboxForward);
// this does the same, to the tenant feelreef's own `/report` form writes into — `ext:feelreef`
// (reef apps/feelreef/src/lib/inbox/feelreef-bubble.ts), which is also what this Worker's
// security.txt already sends Card reports to. From there everything is the existing service:
// storage, the owner notification, and the one automatic 「已受理」 mail when the reporter left an
// address (receiveVisitorMessage's form-entry acknowledgement). Nobody gets an account, nobody gets
// any other reply.
//
// 🔴 THE TENANT IS A CONSTANT HERE. The browser never names it: a field the visitor can edit would be
// a way to drop reports into somebody else's inbox (same reasoning as reef's /report action).
//
// 🔴 RATE LIMITING IS THE INBOX'S, AND IT IS PER VISITOR ONLY WHEN THE FORWARD IS SIGNED. The limiter
// is reef's D1 fixed window (apps/feelreef/src/lib/inbox/ratelimit.ts — a KV counter was measured not
// to stop a burst). Forwarded server-to-server, the request arrives from the Worker's egress address,
// so the visitor's address travels in `x-reef-visitor-ip` under the signed-forward contract
// (`verifyForward` there): with `INBOX_FORWARD_KEY` set (= hex HMAC-SHA256(INBOX_FORWARD_IP_SECRET,
// 'ext:feelreef'), a secret on this Worker) every reporter has their own 5/minute, 40/day buckets.
// Without it the forward is unsigned and every report shares the egress address's buckets — slower
// for honest reporters, never a free pass. No second limiter lives here: a per-isolate counter in a
// Worker resets whenever the isolate does, so it would be a limiter in name only.
//
// What this file holds itself: the size caps (refused before anything is parsed or sent), the
// reason list, the words in feelreef's nine locales, and the page. No script runs on the page at
// all — a plain form, so it works with nothing loaded and nothing from anyone else.

import { SANDBOX_LOCALES, primaryLocale, localeFromAcceptLanguage } from '../w/sandbox-i18n.mjs';

export const REPORT_PATH = '/report';

/** The inbox the report lands in. A constant — see the header. */
export const REPORT_INBOX = { kind: 'ext', id: 'feelreef' };
export const REPORT_TENANT = `${REPORT_INBOX.kind}:${REPORT_INBOX.id}`;

/** The reasons, in the order the page lists them (reef#2758). The ids are what the inbox line carries. */
export const REPORT_REASONS = ['impersonation', 'sexual_or_violent', 'scam_or_phishing', 'other'];

// ── caps ─────────────────────────────────────────────────────────────────────────────────────────
// The whole body first, read with a ceiling (a declared Content-Length over it is refused unread).
// Three fields and a honeypot fit in a fraction of it; anything bigger is not a report.
export const REPORT_MAX_BODY_BYTES = 2048;
// A Card address: reef.cards/<handle> is under 90 characters, a Card on its own domain is a
// hostname (≤ 253) plus a path; 512 leaves room and keeps the inbox line far below its 2000.
export const REPORT_MAX_CARD_CHARS = 512;
// reef's looksLikeEmailShape: the same shape and the same 320 ceiling, so this page never accepts an
// address the inbox would then quietly drop.
export const REPORT_MAX_EMAIL_CHARS = 320;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// card-api's handle grammar
const HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;

const FORWARD_TIMEOUT_MS = 8000;
const DEFAULT_PLATFORM_ORIGIN = 'https://feelreef.com';

// ── the doors' URL contract ──────────────────────────────────────────────────────────────────────
// reef.cards' own footer links to `https://reef.cards/report`; each /draw card back links with its
// handle. `?card=<address>` prefills a pasted address (a Card on its own domain). Both only prefill
// the address field: the handle in the report is always worked out again from the address, here.
/** reportHref({ handle?, card? }) → the report page's address for a door. */
export function reportHref({ handle, card } = {}, origin = 'https://reef.cards') {
  const u = new URL(REPORT_PATH, origin);
  const h = String(handle ?? '').trim().toLowerCase();
  if (HANDLE.test(h)) u.searchParams.set('handle', h);
  else if (card) u.searchParams.set('card', String(card));
  return u.href;
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────
// feelreef's nine console locales, keyed like the sandbox (sandbox-i18n.mjs LOCALE_KEYS), resolved
// the same way: `?lang=`, then Accept-Language, then English.
//
// title / reasonLabel / submit / done / unavailable / reason `other`, and `impersonation` outside
// Chinese, are feelreef's reviewed CARD_REPORT_* rows (reef packages/i18n/messages.json), copied
// verbatim. zh-TW's four reasons are reef#2758's own words. The rest are new.
export const REPORT_WORDS = {
  en: {
    pageTitle: 'Report a card · reef.cards',
    title: 'Report this card',
    cardLabel: 'Card address',
    reasonLabel: 'Reason',
    impersonation: 'Impersonation',
    sexual_or_violent: 'Sexual or violent content',
    scam_or_phishing: 'Scam or phishing',
    other: 'Something else',
    emailLabel: 'Email (optional)',
    emailHint: 'Only used to reply to you.',
    submit: 'Submit report',
    done: "Thanks — we've received your report.",
    unavailable: "Couldn't send your report just now — please try again.",
    rateLimited: 'Too many reports from here — please try again later.',
    cardMissing: "Paste the card's address.",
    cardInvalid: "That doesn't look like an address.",
    tooLong: "That's too long.",
    reasonInvalid: 'Choose a reason.',
    emailInvalid: 'That email address looks incomplete.',
  },
  zh: {
    pageTitle: '檢舉卡片 · reef.cards',
    title: '檢舉這張卡片',
    cardLabel: '卡片網址',
    reasonLabel: '原因',
    impersonation: '冒充',
    sexual_or_violent: '色情或暴力',
    scam_or_phishing: '詐騙或釣魚',
    other: '其他',
    emailLabel: 'Email（選填）',
    emailHint: '只用來回覆你。',
    submit: '送出檢舉',
    done: '謝謝你，我們已收到你的檢舉。',
    unavailable: '目前無法送出檢舉，請再試一次。',
    rateLimited: '送出太多次了，請稍後再試。',
    cardMissing: '請貼上卡片網址。',
    cardInvalid: '這看起來不是網址。',
    tooLong: '內容太長了。',
    reasonInvalid: '請選一個原因。',
    emailInvalid: '這個 email 看起來不完整。',
  },
  ja: {
    pageTitle: 'カードを報告 · reef.cards',
    title: 'このカードを報告する',
    cardLabel: 'カードのURL',
    reasonLabel: '理由',
    impersonation: 'なりすまし',
    sexual_or_violent: '性的・暴力的な内容',
    scam_or_phishing: '詐欺・フィッシング',
    other: 'その他',
    emailLabel: 'メールアドレス（任意）',
    emailHint: '返信にのみ使います。',
    submit: '報告を送信',
    done: 'ありがとうございます。報告を受け付けました。',
    unavailable: 'ただいま報告を送信できませんでした。もう一度お試しください。',
    rateLimited: '送信が多すぎます。しばらくしてからもう一度お試しください。',
    cardMissing: 'カードのURLを貼り付けてください。',
    cardInvalid: 'URLではないようです。',
    tooLong: '長すぎます。',
    reasonInvalid: '理由を選んでください。',
    emailInvalid: 'メールアドレスが不完全なようです。',
  },
  ko: {
    pageTitle: '카드 신고 · reef.cards',
    title: '이 카드 신고',
    cardLabel: '카드 주소',
    reasonLabel: '사유',
    impersonation: '사칭',
    sexual_or_violent: '선정적이거나 폭력적인 콘텐츠',
    scam_or_phishing: '사기 또는 피싱',
    other: '기타',
    emailLabel: '이메일 (선택 사항)',
    emailHint: '답장을 보낼 때만 사용해요.',
    submit: '신고 제출',
    done: '감사합니다. 신고가 접수되었어요.',
    unavailable: '지금은 신고를 보낼 수 없어요. 다시 시도해 주세요.',
    rateLimited: '너무 많이 보냈어요. 잠시 후 다시 시도해 주세요.',
    cardMissing: '카드 주소를 붙여 넣어 주세요.',
    cardInvalid: '주소 형식이 아닌 것 같아요.',
    tooLong: '너무 길어요.',
    reasonInvalid: '사유를 선택해 주세요.',
    emailInvalid: '이메일 주소가 완전하지 않은 것 같아요.',
  },
  'zh-Hans': {
    pageTitle: '举报卡片 · reef.cards',
    title: '举报这张卡片',
    cardLabel: '卡片网址',
    reasonLabel: '原因',
    impersonation: '冒充',
    sexual_or_violent: '色情或暴力',
    scam_or_phishing: '诈骗或钓鱼',
    other: '其他',
    emailLabel: 'Email（选填）',
    emailHint: '只用来回复你。',
    submit: '提交举报',
    done: '谢谢，我们已收到你的举报。',
    unavailable: '举报暂时无法送出，请再试一次。',
    rateLimited: '提交次数太多了，请稍后再试。',
    cardMissing: '请粘贴卡片网址。',
    cardInvalid: '这看起来不是网址。',
    tooLong: '内容太长了。',
    reasonInvalid: '请选择一个原因。',
    emailInvalid: '这个 email 看起来不完整。',
  },
  de: {
    pageTitle: 'Card melden · reef.cards',
    title: 'Diese Card melden',
    cardLabel: 'Adresse der Card',
    reasonLabel: 'Grund',
    impersonation: 'Vorgetäuschte Identität',
    sexual_or_violent: 'Sexuelle oder gewalttätige Inhalte',
    scam_or_phishing: 'Betrug oder Phishing',
    other: 'Etwas anderes',
    emailLabel: 'E-Mail (optional)',
    emailHint: 'Wird nur verwendet, um dir zu antworten.',
    submit: 'Meldung senden',
    done: 'Danke – wir haben deine Meldung erhalten.',
    unavailable: 'Deine Meldung konnte gerade nicht gesendet werden – bitte versuch es erneut.',
    rateLimited: 'Zu viele Meldungen – bitte versuch es später noch einmal.',
    cardMissing: 'Füge die Adresse der Card ein.',
    cardInvalid: 'Das sieht nicht nach einer Adresse aus.',
    tooLong: 'Das ist zu lang.',
    reasonInvalid: 'Wähle einen Grund.',
    emailInvalid: 'Diese E-Mail-Adresse sieht unvollständig aus.',
  },
  fr: {
    pageTitle: 'Signaler une carte · reef.cards',
    title: 'Signaler cette carte',
    cardLabel: 'Adresse de la carte',
    reasonLabel: 'Motif',
    impersonation: 'Usurpation d’identité',
    sexual_or_violent: 'Contenu sexuel ou violent',
    scam_or_phishing: 'Arnaque ou hameçonnage',
    other: 'Autre chose',
    emailLabel: 'E-mail (facultatif)',
    emailHint: 'Utilisée uniquement pour vous répondre.',
    submit: 'Envoyer le signalement',
    done: 'Merci — votre signalement a bien été reçu.',
    unavailable: 'Impossible d’envoyer votre signalement pour l’instant — veuillez réessayer.',
    rateLimited: 'Trop de signalements — veuillez réessayer plus tard.',
    cardMissing: 'Collez l’adresse de la carte.',
    cardInvalid: 'Cela ne ressemble pas à une adresse.',
    tooLong: 'C’est trop long.',
    reasonInvalid: 'Choisissez un motif.',
    emailInvalid: 'Cette adresse e-mail semble incomplète.',
  },
  es: {
    pageTitle: 'Denunciar una tarjeta · reef.cards',
    title: 'Denunciar esta tarjeta',
    cardLabel: 'Dirección de la tarjeta',
    reasonLabel: 'Motivo',
    impersonation: 'Suplantación de identidad',
    sexual_or_violent: 'Contenido sexual o violento',
    scam_or_phishing: 'Estafa o phishing',
    other: 'Otro motivo',
    emailLabel: 'Correo electrónico (opcional)',
    emailHint: 'Solo lo usaremos para responderte.',
    submit: 'Enviar denuncia',
    done: 'Gracias. Hemos recibido tu denuncia.',
    unavailable: 'No hemos podido enviar tu denuncia. Inténtalo de nuevo.',
    rateLimited: 'Demasiadas denuncias. Inténtalo de nuevo más tarde.',
    cardMissing: 'Pega la dirección de la tarjeta.',
    cardInvalid: 'Eso no parece una dirección.',
    tooLong: 'Es demasiado largo.',
    reasonInvalid: 'Elige un motivo.',
    emailInvalid: 'Esa dirección de correo parece incompleta.',
  },
  pt: {
    pageTitle: 'Denunciar um card · reef.cards',
    title: 'Denunciar este card',
    cardLabel: 'Endereço do card',
    reasonLabel: 'Motivo',
    impersonation: 'Falsa identidade',
    sexual_or_violent: 'Conteúdo sexual ou violento',
    scam_or_phishing: 'Golpe ou phishing',
    other: 'Outro motivo',
    emailLabel: 'E-mail (opcional)',
    emailHint: 'Usado só para responder a você.',
    submit: 'Enviar denúncia',
    done: 'Obrigado — recebemos sua denúncia.',
    unavailable: 'Não foi possível enviar sua denúncia agora — tente novamente.',
    rateLimited: 'Denúncias demais — tente novamente mais tarde.',
    cardMissing: 'Cole o endereço do card.',
    cardInvalid: 'Isso não parece um endereço.',
    tooLong: 'Está longo demais.',
    reasonInvalid: 'Escolha um motivo.',
    emailInvalid: 'Esse e-mail parece incompleto.',
  },
};

/** What each refusal says to the visitor. The reason NAME is what the page and the tests key on. */
const REFUSAL_WORD = {
  too_large: 'tooLong',
  card_too_long: 'tooLong',
  email_too_long: 'tooLong',
  card_missing: 'cardMissing',
  card_invalid: 'cardInvalid',
  reason_invalid: 'reasonInvalid',
  email_invalid: 'emailInvalid',
  rate_limited: 'rateLimited',
  unavailable: 'unavailable',
};

// The line in the inbox names the reason in the language the inbox is read in, plus its id.
const INBOX_REASON = { impersonation: '冒充', sexual_or_violent: '色情或暴力', scam_or_phishing: '詐騙或釣魚', other: '其他' };

// ── input ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The card field → a normalised absolute http(s) URL, or a refusal name. Pure.
 * A pasted `reef.cards/x` (no scheme) is read as https — that is how people copy addresses.
 */
export function readCardAddress(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { refused: 'card_missing' };
  if (v.length > REPORT_MAX_CARD_CHARS) return { refused: 'card_too_long' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return { refused: 'card_invalid' };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`); } catch { return { refused: 'card_invalid' }; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || !u.hostname.includes('.')) {
    return { refused: 'card_invalid' };
  }
  if (u.href.length > REPORT_MAX_CARD_CHARS) return { refused: 'card_too_long' };
  return { url: u };
}

/** The email field → '' (none), the address, or a refusal name. Same rule as reef's inbox. */
export function readEmail(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { email: '' };
  if (v.length > REPORT_MAX_EMAIL_CHARS) return { refused: 'email_too_long' };
  return EMAIL_SHAPE.test(v) ? { email: v } : { refused: 'email_invalid' };
}

/** The body, read with a ceiling. `null` = over it (a declared length is judged before reading). */
async function readCapped(request, max) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { try { await reader.cancel(); } catch { /* already closed */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PAGE_CSS = `:root{--bg:#f6f8fa;--surface:#fff;--ink:#0b2140;--muted:#4f6478;--line:#d5dde5;--accent:#b8391f;--on-accent:#fff;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#0b2140;--surface:#102d52;--ink:#f4f6f6;--muted:#a9bccf;--line:rgba(255,255,255,.14);--accent:#ff6b4a;--on-accent:#0b2140;--err:#ffb4ab}}
*{box-sizing:border-box}html{color-scheme:light dark;accent-color:var(--accent)}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:32rem;margin:0 auto;padding:40px 16px}
h1{font-size:1.4rem;margin:0 0 24px}
form{display:grid;gap:20px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px}
label,legend{font-weight:600;display:block;margin-bottom:6px}
fieldset{border:0;margin:0;padding:0}
.opt{display:flex;gap:8px;align-items:center;font-weight:400;margin:6px 0}
input[type=url],input[type=email],input[type=text]{width:100%;font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px;padding:10px 12px}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.hint{color:var(--muted);font-size:.875rem;margin:6px 0 0}
.err{color:var(--err);margin:0}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
button{font:inherit;font-weight:600;color:var(--on-accent);background:var(--accent);border:0;border-radius:999px;padding:12px 20px;cursor:pointer;justify-self:start}
.done{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px;margin:0}
footer{margin-top:24px;font-size:.875rem}footer a{color:var(--muted);text-decoration:none}footer a:hover{color:var(--accent)}`;

/**
 * reportPageHtml(localeKey, { card, reason, email, refused, sent }) → the whole page. Pure.
 * Every value that came from a request is escaped; nothing here loads a script.
 */
export function reportPageHtml(localeKey, { card = '', reason = '', email = '', refused = '', sent = false } = {}) {
  const key = REPORT_WORDS[localeKey] ? localeKey : 'en';
  const w = REPORT_WORDS[key];
  const lang = SANDBOX_LOCALES[key]?.lang || 'en-US';
  const langField = key === 'en' ? '' : `<input type="hidden" name="lang" value="${esc(lang)}">`;
  const refusal = refused
    ? `<p class="err" role="alert" data-reason="${esc(refused)}">${esc(w[REFUSAL_WORD[refused] || 'unavailable'])}</p>`
    : '';
  const body = sent
    ? `<p class="done" role="status">${esc(w.done)}</p>`
    : `<form method="post" action="${REPORT_PATH}" accept-charset="utf-8">
${refusal}
<div><label for="card">${esc(w.cardLabel)}</label>
<input id="card" name="card" type="text" inputmode="url" autocomplete="off" required maxlength="${REPORT_MAX_CARD_CHARS}" value="${esc(card)}" placeholder="https://reef.cards/…"></div>
<fieldset><legend>${esc(w.reasonLabel)}</legend>
${REPORT_REASONS.map((r) => `<label class="opt"><input type="radio" name="reason" value="${r}" required${r === reason ? ' checked' : ''}> ${esc(w[r])}</label>`).join('\n')}
</fieldset>
<div><label for="email">${esc(w.emailLabel)}</label>
<input id="email" name="email" type="email" autocomplete="email" maxlength="${REPORT_MAX_EMAIL_CHARS}" value="${esc(email)}">
<p class="hint">${esc(w.emailHint)}</p></div>
<div class="hp" aria-hidden="true"><input type="text" name="_hp" tabindex="-1" autocomplete="off"></div>
${langField}
<button type="submit">${esc(w.submit)}</button>
</form>`;
  return `<!doctype html>
<html lang="${esc(lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(w.pageTitle)}</title>
<style>${PAGE_CSS}</style></head>
<body><main>
<h1>${esc(w.title)}</h1>
${body}
<footer><a href="/">reef.cards</a></footer>
</main></body></html>`;
}

// 🔴 No script, from anywhere: `script-src 'none'` makes that a property of the response, not a hope.
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

const page = (localeKey, state, status = 200, head = false) =>
  new Response(head ? null : reportPageHtml(localeKey, state), { status, headers: PAGE_HEADERS });

const localeOf = (lang, request) =>
  lang ? primaryLocale(lang) : localeFromAcceptLanguage(request.headers.get('accept-language'));

/** The prefill for a GET: `?handle=` (a /draw card back) wins over `?card=` (anything else). */
function prefill(params, origin) {
  const h = String(params.get('handle') ?? '').trim().toLowerCase();
  if (HANDLE.test(h)) return `${origin}/${h}`;
  const c = String(params.get('card') ?? '').trim();
  return c.length <= REPORT_MAX_CARD_CHARS ? c : '';
}

// ── the forward ──────────────────────────────────────────────────────────────────────────────────

async function hmacHex(keyText, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

const platformOrigin = (env) => {
  const v = String(env?.INBOX_PLATFORM_ORIGIN ?? '').trim();
  try { if (v && new URL(v).protocol === 'https:') return new URL(v).origin; } catch { /* the default */ }
  return DEFAULT_PLATFORM_ORIGIN;
};

/**
 * forwardReport — ONE POST to the platform's /api/inbox, in the shape a Site's forwarder sends
 * (`fields` composed there into one message; `visitor_email` lifted for the 「已受理」 mail).
 * → 'sent' | 'rate_limited' | 'unavailable'.
 */
async function forwardReport(env, { card, handle, reason, email, at, ip, lang }) {
  const fields = {
    來源: 'reef.cards/report',
    卡片網址: card,
    handle: handle || '（無法判定）',
    原因: `${INBOX_REASON[reason]}（${reason}）`,
    時間: new Date(at).toISOString(),
  };
  const payload = {
    ...REPORT_INBOX,
    fields,
    ...(email ? { visitor_email: email } : {}),
    page_url: `https://reef.cards${REPORT_PATH}`,
    _hp: '',
  };
  // Start fresh: nothing the visitor sent (cookies, forwarding headers) is passed on.
  const headers = { 'content-type': 'application/json', accept: 'application/json', 'accept-language': lang };
  const forwardKey = String(env?.INBOX_FORWARD_KEY ?? '').trim();
  if (forwardKey) {
    const ts = String(Math.floor(at / 1000));
    headers['x-reef-forward-ts'] = ts;
    headers['x-reef-forward-sig'] = await hmacHex(forwardKey, `${REPORT_TENANT}\n${ip}\n${ts}`);
    if (ip) headers['x-reef-visitor-ip'] = ip;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const res = await fetch(`${platformOrigin(env)}/api/inbox`, {
      method: 'POST', headers, body: JSON.stringify(payload), credentials: 'omit', signal: controller.signal,
    });
    if (res.ok) return 'sent';
    return res.status === 429 ? 'rate_limited' : 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

// ── the handler ──────────────────────────────────────────────────────────────────────────────────

/**
 * handleReport(request, env, { handleOf }) → Response. The caller has already decided this request is
 * `/report` on reef.cards with the switch on. `handleOf(url)` → the handle a Card address names, or
 * null (card-worker.mjs knows the hosts and the domain bindings; this file does not).
 */
export async function handleReport(request, env, { handleOf = async () => null } = {}) {
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'GET' || method === 'HEAD') {
    const locale = localeOf(url.searchParams.get('lang'), request);
    if (url.searchParams.get('sent') === '1') return page(locale, { sent: true }, 200, method === 'HEAD');
    return page(locale, { card: prefill(url.searchParams, url.origin) }, 200, method === 'HEAD');
  }
  if (method !== 'POST') {
    return new Response('', { status: 405, headers: { Allow: 'GET, HEAD, POST', 'Cache-Control': 'no-store' } });
  }

  // A browser on another site posting here is refused (as /try/park does). This stops a page, not curl.
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    return page(localeOf('', request), { refused: 'cross_origin' }, 403);
  }
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('application/x-www-form-urlencoded')) {
    return page(localeOf('', request), { refused: 'unsupported_type' }, 415);
  }
  const text = await readCapped(request, REPORT_MAX_BODY_BYTES);
  if (text == null) return page(localeOf('', request), { refused: 'too_large' }, 413);

  const form = new URLSearchParams(text);
  const locale = localeOf(form.get('lang'), request);
  const typed = { card: form.get('card') ?? '', reason: form.get('reason') ?? '', email: form.get('email') ?? '' };
  const keep = { card: typed.card.slice(0, REPORT_MAX_CARD_CHARS), reason: typed.reason, email: typed.email.slice(0, REPORT_MAX_EMAIL_CHARS) };
  const refuse = (refused, status) => page(locale, { ...keep, refused }, status);

  const card = readCardAddress(typed.card);
  if (card.refused) return refuse(card.refused, card.refused === 'card_too_long' ? 413 : 400);
  if (!REPORT_REASONS.includes(typed.reason)) return refuse('reason_invalid', 400);
  const email = readEmail(typed.email);
  if (email.refused) return refuse(email.refused, email.refused === 'email_too_long' ? 413 : 400);

  const sentTo = `${REPORT_PATH}?sent=1${form.get('lang') ? `&lang=${encodeURIComponent(SANDBOX_LOCALES[locale]?.lang || 'en-US')}` : ''}`;
  const sent = () => new Response(null, { status: 303, headers: { Location: sentTo, 'Cache-Control': 'no-store' } });

  // Honeypot: a filled hidden field is a bot. It is told exactly what a person is told, and nothing is sent.
  if ((form.get('_hp') ?? '').trim()) return sent();

  let handle = null;
  try { handle = await handleOf(card.url); } catch { handle = null; }
  if (handle != null && !HANDLE.test(handle)) handle = null;

  const outcome = await forwardReport(env, {
    card: card.url.href,
    handle,
    reason: typed.reason,
    email: email.email,
    at: Date.now(),
    ip: (request.headers.get('cf-connecting-ip') || '').trim(),
    lang: SANDBOX_LOCALES[locale]?.lang || 'en-US',
  });
  if (outcome === 'sent') return sent();
  return refuse(outcome, outcome === 'rate_limited' ? 429 : 503);
}
