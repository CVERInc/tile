// @ts-nocheck — plain untyped JS (checker pragma only, no logic change), same
// as the square-shop coral beside it, so a consumer with strict `checkJs` can
// vendor this file unmodified rather than fork a typed copy.
//
// REEF with Inbox — the visitor bubble.
//
// A dynamic coral (see ../square-shop/PROVENANCE.md for the mount contract this
// implements): one plain JS module that installs, byte-for-byte, into either
// substrate — feelreef's own pages, or a sitetile static Astro build via an
// `embed` section's <script src>.
//
// ── What this is, and what it deliberately is not ───────────────────────────
//
// It is the bubble everybody already recognises in the bottom-right corner. It
// is NOT a chat client. There is no presence, no typing indicator, no queue, no
// "an agent will be with you shortly". `docs/SPEC-visitor-messages.md` §7 gives
// the reason: those exist because the products that have them were built for a
// support DEPARTMENT, and nearly every REEF customer is one person. Our
// differentiator is that the whole layer is missing.
//
// 🔴 IT NEVER CLAIMS ANYONE IS THERE. The panel shows 「通常 N 小時內回覆」only
// when the owner has actually set a number, and shows nothing otherwise. §7:
// 「在線狀態不准說謊」— that is no-phantom applied to a person, and a person is
// far easier to feel lied to about than a widget.
//
// 🔴 THE CONVERSATION ID COMES FROM THE SERVER. This browser stores whatever
// the server minted and sends it back; it never invents one. The CMS this was
// studied against lets the browser generate the id, and a browser that can
// choose an id can choose whose conversation to open.
//
// ── Two doors, and the second one has to be pressed ────────────────────────
//
// With data-kaito="1" the panel asks the SITE first (/api/kaito, extractive:
// a stored published passage returned verbatim, or the one fixed refusal). Only
// when the machine has nothing does a button appear offering to pass the
// question to a person — and 🔴 THAT PRESS IS THE POINT. A refusal is common and
// most of them are someone browsing; turning every one of them into an
// interruption is precisely the bubble this product exists not to be. The
// deliberate act is what earns a person's attention (SPEC §2).
//
// 🔴 A KAITO ANSWER IS NEVER STORED AND NEVER JOINS THE TRANSCRIPT. It is a
// machine quoting one of the owner's own pages; a message is a person speaking.
// Mixing them would put the owner's reply next to machine text with no way to
// tell who said what — and it is the mirror of the rule that a transcript never
// enters the corpus (SPEC §5). Only the visitor's OWN question travels, verbatim,
// when they press.
//
// Once a conversation exists the panel is a conversation, permanently — the
// stored handle IS the "already asked a person" flag, so there is no second
// piece of state to disagree with it.
//
// Config (data-* attributes on the container):
//   data-kind      (required) — 'site' | 'card' | 'cardtile' | 'ext'
//   data-id        (required) — the tenant key for that kind
//   data-kaito     (optional) — "1" asks the site first (needs REEF with KAITO)
//   data-api-base  (optional) — override the feelreef origin
//   data-assistant-name (optional) — what VISITORS see the assistant called
//                  instead of "KAITO" (owner ruling, 2026-09-05: the name may
//                  change, but the panel still marks the reply as AI — see
//                  statusDefault). Trimmed to a single line, capped at 40
//                  chars; blank/whitespace falls back to "KAITO".
//   data-title / data-placeholder / data-send / data-… (optional) — copy
//
// Usage:
//   <div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="cver"></div>
//   <script type="module" src=".../inbox-bubble.js"></script>

const DEFAULT_API_BASE = 'https://feelreef.com';
const SELECTOR = '[data-dynamic-coral="inbox-bubble"]';
const PREFIX = 'dc-inbox';

/**
 * 0.7.2 (owner ruling 2026-09-06 #34). The AI marker used to be the literal characters
 * "(AI)"/"（AI）" baked into each locale's `statusDefault` PLAIN TEXT below. It is a
 * Discord-APP-style CHIP now: a styled `<span>`, never parentheses.
 *
 * 🩸 THIS LANDED IN THE WRONG REPO FIRST. It was written into reef's vendored snapshot
 * (`apps/feelreef/src/lib/dynamic-corals/inbox-bubble/`) on 2026-09-06 because that snapshot's
 * sibling test was the coral's only browser coverage anywhere — and a vendored snapshot ships
 * to nobody. The bytes a visitor runs come from this file, through the registry. It is here
 * now, and reef re-vendors 0.7.2 from the published artifact.
 *
 * 🔴 THE TOKEN, NOT THE MARKUP, LIVES IN `COPY`. Each locale's `statusDefault` still owns
 * WHERE the marker sits in its own sentence (that placement is a translation decision, and
 * stays one per locale) — it just marks the spot with this sentinel instead of typing "(AI)"
 * itself. `statusFor` below is the ONE place that turns the sentinel into real HTML, which is
 * also the one place that has to reason about escaping (see its own comment) — so there is
 * exactly one seam that can get that wrong, not five.
 *
 * 🔴 NON-REMOVABLE BY CONSTRUCTION, not by convention. There is no config attribute that
 * reaches this token or the chip it becomes — `resolveAssistantName` only ever supplies the
 * NAME, and every locale's `statusDefault` places this token unconditionally. The invariant
 * the file header already states — the AI identity may never be hidden — is enforced by there
 * being no code path that can construct a status line without it.
 *
 * 🔴 WRAPPED IN U+2063 (INVISIBLE SEPARATOR), not a plain word or a null byte: real text, so
 * grep/diff/every other text tool still treats this file as text (a null byte earlier in this
 * same edit made `grep` silently skip the whole file — measured, not theoretical), and
 * invisible enough that nothing a translator or an owner-supplied `data-assistant-name` would
 * ever legitimately type collides with it. It never reaches the DOM either way: `statusFor`
 * below splits on it and replaces it with `AI_CHIP_HTML` before anything is escaped or inserted.
 */
const AI_CHIP_TOKEN = '⁣AI_CHIP⁣';

/**
 * The chip itself — no leading/trailing text-level space either side (every locale's
 * `statusDefault` places the token flush against its neighbours); the CSS class below gives it
 * its own inline margin instead, so the visual gap is uniform across locales rather than
 * depending on whichever locale happened to type a space next to its parentheses.
 *
 * `aria-label="AI"` is belt-and-braces alongside the chip's own visible "AI" text:
 * `font-variant: all-small-caps` (the CSS below) restyles the letterforms but must never change
 * what a screen reader announces, and pinning the accessible name here means it can't, regardless
 * of how the visual styling evolves.
 */
const AI_CHIP_HTML = `<span class="${PREFIX}-ai-chip" aria-label="AI">AI</span>`;

/**
 * How long this browser remembers which conversation it is part of.
 *
 * 🩸 Was seven days, matching the studied CMS (§9). Bumped to thirty
 * (2026-09-04, from a production report on a live site): a visitor who hands off and comes
 * back a week later — entirely plausible for a shop the owner replies to by
 * hand — found their handle already gone and started over with no memory of
 * having asked. What it still buys: the visitor never logs in, we never mint a
 * session, and the handle to their own words lives on their machine with an
 * expiry date they control. What it costs, stated so nobody rediscovers it as
 * a bug: a different device is a different conversation, and after thirty
 * days a returning visitor starts a new one. The owner's copy never expires —
 * only this pointer does. (Not to be confused with `HANDOFF_STALE_MS` below,
 * which is about the CONTENT of a live conversation, not this storage TTL.)
 */
const HANDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * How long a human hand-off may sit with no fresh word from the owner before
 * the panel treats it as concluded and offers KAITO again on next open.
 *
 * 🔴 A FALLBACK, not the first choice — see `handoffConcluded` below. The
 * `/api/inbox` response this file reads is `{ messages }` today (see
 * docs/SPEC-visitor-messages.md); the server's own `InboxState` already has a
 * real `closed` (reef `$lib/inbox/conversation.ts`), it just is not on the
 * wire yet. When it is, this constant stops mattering for any site that sends
 * it. Seven days chosen to match the storage TTL's old value — long enough
 * that a normal reply cadence never trips it, short enough that "stuck in
 * human mode for days" (the bug this file exists to fix) cannot recur.
 */
const HANDOFF_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const STORE_PREFIX = 'reef-inbox:';
/** How often the panel checks for a reply while it is OPEN. Closed costs nothing. */
const POLL_MS = 15000;
/**
 * Give up polling after this many failures in a row.
 *
 * 🔴 Not politeness — arithmetic. An open panel polled every 15s forever, so a
 * server having a bad minute was being asked again by every open tab on every
 * site running this coral, for as long as those tabs stayed open, with no
 * ceiling. The visitor sees nothing either way; the difference is whether a
 * degraded endpoint gets to recover.
 *
 * Sending still works after this stops: a message is a deliberate act and gets
 * its own request. Only the background checking gives up, and reopening the
 * panel starts it again.
 */
const POLL_GIVE_UP_AFTER = 4;

let stylesInjected = false;

// ── copy ────────────────────────────────────────────────────────────────────
// Defaults come from the PAGE's declared language (`<html lang>`), which is the
// site's own statement about who it is for — not from a guess, and not from the
// visitor's browser (a Japanese reader on a Taiwanese site should see the site's
// language, the same as every other word on the page). Every string is still
// overridable per-embed via data-*, and anything unknown falls back to English.
//
// 🔴 0.7.3 (owner ruling 2026-09-07): THE ASK PANEL SAYS TWO THINGS FEWER. It used to open with
// four sentences before the visitor could type — a status line, a body line in the empty log, a
// placeholder, and a 「站主看得到」 footer under the form — and the owner's word for that was
// 「太囉唆」. What survives is the status line (now 「<名字>[AI]先回，真人會看」: the same two
// facts, in half the words) and the placeholder. `empty` and `seen` are GONE, not shortened, so
// there is no key left for a locale to re-grow them from — and `data-empty-label` went with
// `empty`, because an override for a string nothing renders is a promise this file cannot keep.
//
// 🔴 The status line keeps carrying `AI_CHIP_TOKEN` and the assistant-name slot. Shorter copy is
// exactly where a disclosure gets dropped by accident, and the 2026-09-05 ruling did not move:
// the name may change, the reply is always marked AI.
export const COPY = {
	en: {
		ask: 'Ask about this site…',
		asking: 'Looking…',
		source: 'Where this comes from',
		refused: "I don't have a record of that.",
		toHuman: 'Ask a person instead',
		toHumanAfterRefusal: 'Send this to a person',
		sentToHuman: "Passed to a person — you'll get a reply here.",
		name: 'Name (optional)',
		email: 'Email (optional)',
		emailNote: "Leave your email to get the owner's reply by email. Without it, you can only see replies by coming back to this page.",
		cancel: 'Cancel',
		open: 'Message us',
		title: 'Leave a message',
		placeholder: 'Type your question…',
		send: 'Send',
		sending: 'Sending…',
		stored: "Got it — we've saved your message.",
		within: (h) => `Usually replies within ${h} hours.`,
		you: 'You',
		them: 'Reply',
		error: "That didn't go through. Please try again.",
		rate: "That's a lot of messages — please try again in a minute.",
		closed: 'Close',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}answers first, a person reads what you send on`,
		statusHandedOffEmail: "Passed to the owner — they'll reply by email.",
		statusHandedOffNoEmail: 'Passed to the owner — the reply will show here.',
		askAgain: (a) => `Ask ${a} again`,
		newConversation: 'Start a new conversation',
		backToHuman: 'Back to your conversation',
		handoffEnded: 'Your last conversation has ended.'
	},
	'zh-tw': {
		ask: '問這個站的事…',
		asking: '找找看⋯⋯',
		source: '這段出自哪裡',
		refused: '我沒有這方面的紀錄。',
		toHuman: '還是想問真人',
		toHumanAfterRefusal: '幫我轉給真人',
		sentToHuman: '已經轉給真人了，回覆會出現在這裡。',
		name: '姓名（選填）',
		email: 'Email（選填）',
		emailNote: '留下 email 才收得到店家的回覆；不留的話，只有回到這個網頁才看得到。',
		cancel: '取消',
		open: '傳訊息',
		title: '留言給我們',
		placeholder: '想問什麼都可以⋯⋯',
		send: '送出',
		sending: '送出中⋯⋯',
		stored: '已經記下來了。',
		within: (h) => `通常 ${h} 小時內回覆。`,
		you: '你',
		them: '回覆',
		error: '沒有送出去，請再試一次。',
		rate: '訊息有點多，請稍等一分鐘再試。',
		closed: '關閉',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}先回，真人會看`,
		statusHandedOffEmail: '已交給店家，會透過信箱回覆',
		statusHandedOffNoEmail: '已交給店家，回覆會顯示在這裡',
		askAgain: (a) => `重新問 ${a}`,
		newConversation: '新對話',
		backToHuman: '回到真人對話',
		handoffEnded: '上次的對話已結束'
	},
	ja: {
		ask: 'このサイトについて質問…',
		asking: '探しています…',
		source: 'この一節の出どころ',
		refused: 'そのことについては記録がありません。',
		toHuman: 'やはり人に聞く',
		toHumanAfterRefusal: '人に取り次いでもらう',
		sentToHuman: '担当者に取り次ぎました。返信はここに表示されます。',
		name: 'お名前（任意）',
		email: 'メールアドレス（任意）',
		emailNote: 'メールアドレスを残していただくと、店主からの返信をメールで受け取れます。残さない場合は、このページに戻ったときだけ返信を確認できます。',
		cancel: 'キャンセル',
		open: 'メッセージ',
		title: 'メッセージを残す',
		placeholder: 'ご質問をどうぞ…',
		send: '送信',
		sending: '送信中…',
		stored: '受け取りました。',
		within: (h) => `通常 ${h} 時間以内に返信します。`,
		you: 'あなた',
		them: '返信',
		error: '送信できませんでした。もう一度お試しください。',
		rate: '送信が多すぎます。1分ほどお待ちください。',
		closed: '閉じる',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}が先に回答・送れば人が読みます`,
		statusHandedOffEmail: '担当者に取り次ぎました。メールで返信します。',
		statusHandedOffNoEmail: '担当者に取り次ぎました。返信はここに表示されます。',
		askAgain: (a) => `もう一度${a}に聞く`,
		newConversation: '新しい会話を始める',
		backToHuman: 'やり取りに戻る',
		handoffEnded: '前回のやり取りは終了しました。'
	},
	'zh-cn': {
		ask: '问这个网站的事…',
		asking: '找找看⋯⋯',
		source: '这段出自哪里',
		refused: '我没有这方面的记录。',
		toHuman: '还是想问真人',
		toHumanAfterRefusal: '帮我转给真人',
		sentToHuman: '已经转给真人了，回复会出现在这里。',
		name: '姓名（选填）',
		email: 'Email（选填）',
		emailNote: '留下 email 才收得到店家的回复；不留的话，只有回到这个网页才看得到。',
		cancel: '取消',
		open: '发消息',
		title: '留言给我们',
		placeholder: '想问什么都可以⋯⋯',
		send: '发送',
		sending: '发送中⋯⋯',
		stored: '已经记下来了。',
		within: (h) => `通常 ${h} 小时内回复。`,
		you: '你',
		them: '回复',
		error: '没有发送出去，请再试一次。',
		rate: '消息有点多，请稍等一分钟再试。',
		closed: '关闭',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}先回，真人会看`,
		statusHandedOffEmail: '已交给店家，会通过邮箱回复',
		statusHandedOffNoEmail: '已交给店家，回复会显示在这里',
		askAgain: (a) => `重新问 ${a}`,
		newConversation: '新对话',
		backToHuman: '回到真人对话',
		handoffEnded: '上次的对话已结束'
	}
};

/**
 * Resolve a BCP-47 `<html lang>` tag to one of this file's COPY keys.
 *
 * 🩸 The site's own `lang` attribute is not always spelled the way this
 * object's keys are. A zh-TW page can say `lang="zh-Hant-TW"` — a real,
 * common tag this file used to not recognise at all, so it silently fell
 * through to `COPY.en` and every zh-TW visitor got English (finding #5,
 * 2026-09-03 cold-read). Handled here, exhaustively, rather than leaving
 * every future locale to rediscover the same gap:
 *   - an exact key match wins first (`zh-tw`, `zh-cn`, `ja`, `en`, …)
 *   - a `hant` subtag anywhere in the tag → Traditional (`zh-tw`)
 *   - a `hans` subtag anywhere in the tag → Simplified (`zh-cn`)
 *   - a bare primary subtag `zh` (no script/region) → Traditional (`zh-tw`),
 *     REEF's own default per the owner's zh-TW-first sites
 *   - `zh-tw`/`zh-hk`/`zh-mo` region without a script subtag → Traditional
 *   - `zh-cn`/`zh-sg` region without a script subtag → Simplified
 *   - otherwise the bare primary subtag (`ja`, `en`, …), then English
 */
export function resolveLocale(lang) {
	const declared = String(lang || 'en').toLowerCase();
	if (COPY[declared]) return declared;
	const parts = declared.split('-').filter(Boolean);
	const primary = parts[0] || '';
	if (primary === 'zh') {
		if (parts.includes('hant')) return 'zh-tw';
		if (parts.includes('hans')) return 'zh-cn';
		if (parts.includes('tw') || parts.includes('hk') || parts.includes('mo')) return 'zh-tw';
		if (parts.includes('cn') || parts.includes('sg')) return 'zh-cn';
		return 'zh-tw';
	}
	return COPY[primary] ? primary : 'en';
}

function copyFor(el) {
	const declared = document.documentElement.getAttribute('lang') || 'en';
	const base = COPY[resolveLocale(declared)];
	const attr = (name, fallback) => el.getAttribute(`data-${name}`) || fallback;
	return {
		...base,
		open: attr('open-label', base.open),
		title: attr('title', base.title),
		placeholder: attr('placeholder', base.placeholder),
		send: attr('send-label', base.send)
	};
}

// ── the handle this browser keeps ───────────────────────────────────────────

function storeKey(tenant) {
	return STORE_PREFIX + tenant;
}

/**
 * Returns `{ conv, hasEmail, mode }`, or `null` when there is no live handle.
 *
 * `mode` is this browser's last CHOSEN view — `'human'` (default, and every
 * handle written before 2026-09-04 reads as this) or `'ask'`, meaning the
 * visitor pressed "ask KAITO again" / "start a new conversation" and the panel
 * should open fresh rather than jump straight to the old thread. It is a
 * preference, not the source of truth for whether a thread EXISTS — `conv`
 * still is, which is why "回到真人對話" keeps working after a reset (bug
 * report 2026-09-04: hand-off used to be a one-way door with no way back to
 * asking KAITO or starting over).
 */
function loadHandle(tenant) {
	let raw;
	try {
		raw = window.localStorage.getItem(storeKey(tenant));
	} catch {
		return null; // storage disabled — the bubble still works, just forgetfully
	}
	if (!raw) return null;
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed.conv !== 'string' || typeof parsed.ts !== 'number') return null;
	if (Date.now() - parsed.ts > HANDLE_TTL_MS) {
		try {
			window.localStorage.removeItem(storeKey(tenant));
		} catch {
			/* nothing to do; the check above already treats it as absent */
		}
		return null;
	}
	return { conv: parsed.conv, hasEmail: parsed.hasEmail === true, mode: parsed.mode === 'ask' ? 'ask' : 'human' };
}

function saveHandle(tenant, conv, hasEmail, mode = 'human') {
	try {
		window.localStorage.setItem(
			storeKey(tenant),
			JSON.stringify({ conv, ts: Date.now(), hasEmail: !!hasEmail, mode: mode === 'ask' ? 'ask' : 'human' })
		);
	} catch {
		// Storage disabled or full. The message is already stored on OUR side —
		// this browser just will not be able to follow the thread. Silently
		// degrading is right: the visitor's question was received.
	}
}

// ── the panel's title ───────────────────────────────────────────────────────

/**
 * What the panel calls the site it is sitting on.
 *
 * 🔴 NEVER `document.title` (owner ruling, 2026-09-03 cold-read finding #7).
 * A page's `<title>` is written for a browser tab and a search result — "NORTHWIND
 * | LIVE2D" told a visitor nothing about what this floating panel was FOR, and
 * on an article or product page it is often not the site's name at all. Priority:
 * an explicit `data-site-name` (the mount already knows what SiteLayout calls
 * itself), then the page's own `og:site_name` (written for the same purpose —
 * "what is this site called" — by whatever already renders it into the head),
 * then the bare hostname, which is always true even when nobody set anything.
 */
export function resolveSiteName(el, doc) {
	const fromAttr = el && el.getAttribute && el.getAttribute('data-site-name');
	if (fromAttr && fromAttr.trim()) return fromAttr.trim();
	const meta = doc && doc.querySelector && doc.querySelector('meta[property="og:site_name"]');
	const fromMeta = meta && meta.getAttribute && meta.getAttribute('content');
	if (fromMeta && fromMeta.trim()) return fromMeta.trim();
	try {
		return location.hostname || '';
	} catch {
		return '';
	}
}

const DEFAULT_ASSISTANT_NAME = 'KAITO';
const ASSISTANT_NAME_MAX = 40;

/**
 * What VISITORS see the site's Q&A assistant called (owner ruling, 2026-09-05:
 * "KAITO" is OUR product name; the site owner may rename what visitors see it
 * as — e.g. 「重新問 KAITO」→「重新問 小美」 — but the AI identity itself must
 * never be hidden, which is why `statusDefault` always appends the AI_CHIP_TOKEN
 * `statusFor` below turns into the non-removable AI chip, regardless of this
 * name). `data-assistant-name` on the mount, trimmed to a single line and
 * capped at `ASSISTANT_NAME_MAX` chars; blank/whitespace (or the attribute
 * simply being absent) falls back to "KAITO".
 */
export function resolveAssistantName(el) {
	const raw = el && el.getAttribute && el.getAttribute('data-assistant-name');
	return cleanAssistantName(raw) || DEFAULT_ASSISTANT_NAME;
}

/**
 * The one place a name from OUTSIDE this file becomes a name this file will render: single
 * line, trimmed, capped at `ASSISTANT_NAME_MAX`, and with `AI_CHIP_TOKEN` removed. Returns
 * `''` for "there is no usable name here" — each caller decides what that means (the baked
 * attribute falls back to "KAITO"; the platform read falls back to「change nothing」).
 *
 * 🩸 THE TOKEN STRIP IS NOT HOUSEKEEPING. `AI_CHIP_TOKEN` is U+2063-wrapped text, and U+2063
 * is a format character, not whitespace — so `trim()`, the newline check and the 40-char cap
 * all wave it straight through. An owner who set the name to a string containing the token
 * would make `statusFor`'s `split` yield THREE parts, and `[before, after]` drops the third:
 * 「自動回覆・需要時可轉真人」 disappears from the status line and only the chip is left. The
 * AI disclosure itself never breaks (the chip is still there, by construction), but the rest
 * of the sentence does, so the token is stripped where names arrive rather than defended
 * against where they render.
 */
function cleanAssistantName(raw) {
	const stripped = String(raw || '').split(AI_CHIP_TOKEN).join('');
	const trimmed = stripped.trim().split('\n')[0].trim();
	return trimmed ? trimmed.slice(0, ASSISTANT_NAME_MAX) : '';
}

/**
 * 🏛 THE PLATFORM'S ANSWER, WHICH BEATS THE BAKED ONE — CANON-where-values-live.md 第一條
 * (owner ruling 2026-09-06 #36/38). `data-assistant-name` above is compiled INTO the site at
 * build time, so honouring only that would mean an owner's rename did not reach visitors until
 * somebody rebuilt and republished the site. The name's home is the platform, and this is the
 * runtime read that makes 「存了就生效」 literally true.
 *
 * 🔴 THIS MAY NEVER BREAK, BLOCK, OR DELAY THE BUBBLE. It is a nicety on a label: every failure
 * — no network, a slow platform, a non-200, a malformed body, a site with no override at all —
 * resolves to `null`, and `null` means「keep whatever `resolveAssistantName` already decided」.
 * That fallback chain is the eject story working in miniature: platform value → the repo mirror
 * baked into `data-assistant-name` → "KAITO". A site that has left the platform gets the second
 * rung forever and never notices the first one is gone.
 *
 * 🔴 CAPPED AND SINGLE-LINED AGAIN HERE, through the same `cleanAssistantName` the baked
 * attribute goes through. The value already crossed two services that each say they enforce
 * this; a coral running on a customer's page is the last place that can still be sure, and
 * sharing the helper means the platform path cannot quietly enforce less than the repo path.
 *
 * 🩸 `''` HAD TWO MEANINGS AND THEY WERE MERGED HERE — review R2-P1-2, and it broke the one
 * move an owner is told is safe: CLEARING the name. `/api/inbox/assistant` answers `''` for
 *「no override, visitors see KAITO」 AND for every degraded path it has (rate limited, RSP
 * down, malformed body, no platform configured) — it says so in its own header. `''` then hit
 * `|| null` here, `null` means「nothing to correct」, and so an owner who set 小美, published
 * once (baking `data-assistant-name="小美"` into the page) and later cleared the field was told
 * 「已儲存，已生效」 while every visitor kept seeing 小美 for ever. The console half of CANON
 * 第一條 was fixed in the same PR; this was the last stretch of the road where the repo mirror
 * still won.
 *
 * 🔴 SO THE PROXY NOW SAYS WHETHER IT ACTUALLY ASKED: `resolved: true` rides ONLY on an answer
 * the platform really gave. `resolved` + `''` is a FACT (「no override」) and resolves to
 * `DEFAULT_ASSISTANT_NAME`, which is what「留空＝KAITO」 promises on screen. `''` without it
 * stays `null` — an old proxy, a rate-limited minute, a platform that could not be reached —
 * and the baked name stands, exactly as before. The two meanings are two values again, and the
 * conservative one is still what an unknown answer gets.
 */
export async function fetchAssistantName(apiBase, kind, id) {
	try {
		const res = await fetch(
			`${apiBase}/api/inbox/assistant?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
			{ headers: { accept: 'application/json' } }
		);
		if (!res.ok) return null;
		const body = await res.json();
		const raw = body && typeof body.assistantName === 'string' ? body.assistantName : '';
		const name = cleanAssistantName(raw);
		if (name) return name;
		return body && body.resolved === true ? DEFAULT_ASSISTANT_NAME : null;
	} catch {
		return null;
	}
}

/**
 * The one-line status under the title — the part of the header that actually
 * changes as the conversation moves, so the title itself (the site's name)
 * never has to. Once a conversation has a handle, hand-off has happened —
 * the wording only needs to know whether an email came with it (SPEC §9's
 * "leave your email or come back to this page" split).
 *
 * 🔴 RETURNS SAFE HTML, NOT PLAIN TEXT — owner ruling 2026-09-06 #34 moved the
 * escaping IN here rather than leaving it at the call site. `headHtml()` used
 * to `escHtml()` this function's whole return value before inserting it, which
 * worked while the AI marker was literal text; it cannot work now that the
 * marker is a real `<span>`, because escaping the chip's own markup would
 * print `&lt;span…` instead of rendering it. So this function does the one
 * escaping decision itself: `assistantName` is owner/visitor-influenced
 * (`data-assistant-name`, `resolveAssistantName`) and is ALWAYS escaped before
 * it reaches the DOM; `copy.statusHandedOffEmail`/`statusHandedOffNoEmail` are
 * fixed translated strings with no interpolation and need none. The caller
 * inserts what comes back exactly as an HTML fragment, not as text content.
 */
export function statusFor(copy, { hasConv, hasEmail, kaitoOn }, assistantName = DEFAULT_ASSISTANT_NAME) {
	if (hasConv) return hasEmail ? copy.statusHandedOffEmail : copy.statusHandedOffNoEmail;
	if (!kaitoOn) return '';
	// `copy.statusDefault(assistantName)` carries exactly one `AI_CHIP_TOKEN` — every locale's
	// entry places it unconditionally (see the token's own header comment) — splitting on it
	// yields the two plain-text halves around the chip. `String#split` on a string that never
	// contains the token would hand back a one-element array; `after` defaults to '' for that
	// case rather than rendering "undefined", though in practice every locale carries the token.
	const raw = copy.statusDefault(assistantName);
	const [before, after = ''] = raw.split(AI_CHIP_TOKEN);
	return `${escHtml(before)}${AI_CHIP_HTML}${escHtml(after)}`;
}

/**
 * Has this human hand-off wound down, from the visitor's side?
 *
 * 🔴 A SERVER-DECLARED status wins when the `/api/inbox` response actually
 * carries one — `'closed'` or `'resolved'` — since the owner (or the backend)
 * is the one source of truth for "is anyone still going to write back here".
 * Today's response is `{ messages }` only (see docs/SPEC-visitor-messages.md
 * and reef `$lib/inbox/index.ts`'s `visitorTranscript`), so this branch is
 * forward-compatible rather than load-bearing right now.
 *
 * Lacking that field, the fallback reads the transcript itself: the owner
 * replied at some point and then `HANDOFF_STALE_MS` has passed with nothing
 * newer from them. 🩸 This is an approximation, stated so nobody mistakes it
 * for a real "closed" signal: a visitor who wrote back after the owner's last
 * reply still has the clock running from that reply, not their own follow-up,
 * because this file has no way to tell "still waiting" from "gave up" without
 * one. The cost of a false positive is one extra click behind a small
 * "回到真人對話" link back to the exact same thread; the cost of never firing
 * is the bug this file exists to fix — a visitor stuck looking at a dead
 * thread with no way to ask anything again, for days.
 */
export function handoffConcluded(messages, status, now = Date.now()) {
	if (status === 'closed' || status === 'resolved') return true;
	if (status) return false;
	if (!Array.isArray(messages) || !messages.length) return false;
	let lastOwnerAt = -1;
	for (const m of messages) {
		if (m && m.author === 'owner' && typeof m.at === 'number' && m.at > lastOwnerAt) lastOwnerAt = m.at;
	}
	if (lastOwnerAt < 0) return false; // the owner never replied — nothing has concluded, still waiting
	return now - lastOwnerAt > HANDOFF_STALE_MS;
}

/**
 * Which view the panel opens into — pure so the branching mount() does is one
 * function this file's tests can drive without a browser.
 *
 *   - no hand-off thread yet → ask KAITO when it is offered, else the plain
 *     compose form (unchanged first-time behaviour).
 *   - a concluded thread → ask mode always wins, regardless of what the
 *     visitor last chose — that is the automatic "next open" return this
 *     function exists for.
 *   - otherwise, the visitor's own last choice (`storedMode`), defaulting to
 *     the existing thread — this is what used to be the ONLY behaviour, and
 *     bug #1 (2026-09-04) was that it was the only behaviour forever.
 */
export function resolveViewMode({ hasHandoffConv, storedMode, concluded, kaitoOn }) {
	if (!hasHandoffConv) return kaitoOn ? 'ask' : 'human';
	if (concluded) return 'ask';
	return storedMode === 'ask' ? 'ask' : 'human';
}

// ── rendering ───────────────────────────────────────────────────────────────

/**
 * 🩸 Safe to put in an `href`?
 *
 * `escHtml` below stops a value breaking OUT of the attribute; it does nothing
 * about the SCHEME inside it, and the two look like the same job. A citation
 * whose `source_url` is `javascript:…` renders as a perfectly escaped link that
 * runs script when a visitor clicks it. Today that URL comes from the site's own
 * published corpus — but `ext` tenants push their own, so "our content" is not a
 * guarantee this file gets to rely on.
 *
 * 🔴 Asks the PARSER, never a prefix test: `java\nscript:` and a leading space
 * both defeat `startsWith` even lowercased, and both parse to `javascript:`.
 */
function safeHref(u) {
	try {
		const p = new URL(String(u)).protocol;
		return p === 'http:' || p === 'https:' ? String(u) : null;
	} catch {
		return null;
	}
}

function escHtml(s) {
	return String(s).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
	);
}

/**
 * The closed bubble's glyph.
 *
 * A ROUNDED bubble, chosen by chodaict over the squared one: 「上面的比較好，
 * 圓圓的親切」. Support widgets are the friendliest thing on a page or they are
 * the most annoying, and the corner radius is most of that.
 *
 * 🔴 GEOMETRICALLY centred, not eyeballed. Centring the SVG BOX is not enough — a
 * glyph drawn off-centre inside a centred box still sits off-centre, which is
 * what the first attempt did (chodaict: 「注意按鈕內的位置」). The test measures
 * the path's real `getBBox()` in a chromium and fails if its centre drifts off
 * (12, 12), so redrawing this without balancing it is a red test, not a shrug.
 *
 * `currentColor` so the site's `--reef-inbox-on-accent` keeps working.
 */
const OPEN_ICON =
	'<svg class="dc-inbox-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
	'<path fill="currentColor" d="M12 3.255c-5.08 0-9.2 3.4-9.2 7.6 0 2.4 1.34 4.54 3.42 5.94-.12 1.06-.6 2.36-1.66 3.42-.22.22-.02.6.28.52 1.9-.3 3.56-1.08 4.76-2.16.76.18 1.56.28 2.4.28 5.08 0 9.2-3.4 9.2-7.6S17.08 3.4 12 3.4z"/>' +
	'</svg>';

function injectStyles() {
	if (stylesInjected) return;
	stylesInjected = true;
	const style = document.createElement('style');
	// Scoped to this coral's prefix, and every value is either a plain colour or
	// a CSS custom property the SITE may already define — so a site's own theme
	// wins without this file knowing anything about it.
	style.textContent = `
.${PREFIX}-root{position:fixed;right:1rem;bottom:1rem;z-index:2147483000;font:inherit}
.${PREFIX}-open{border:0;border-radius:999px;padding:0;cursor:pointer;
  width:3.5rem;height:3.5rem;display:flex;align-items:center;justify-content:center;
  background:var(--reef-inbox-accent,#111);color:var(--reef-inbox-on-accent,#fff);
  box-shadow:0 6px 24px rgba(0,0,0,.18);line-height:0}
.${PREFIX}-icon{width:1.6rem;height:1.6rem;display:block}
.${PREFIX}-panel{width:min(22rem,calc(100vw - 2rem));max-height:min(30rem,70vh);
  display:flex;flex-direction:column;border-radius:.9rem;overflow:hidden;
  background:var(--reef-inbox-bg,#fff);color:var(--reef-inbox-fg,#111);
  box-shadow:0 12px 40px rgba(0,0,0,.22)}
.${PREFIX}-head{display:flex;align-items:flex-start;justify-content:space-between;
  gap:.5rem;padding:.75rem .9rem;border-bottom:1px solid rgba(0,0,0,.08)}
.${PREFIX}-head-text{min-width:0}
.${PREFIX}-head h2{margin:0;font-size:1rem;font-weight:600;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.${PREFIX}-status{margin:.15rem 0 0;font-size:.75rem;opacity:.65;line-height:1.4}
/* The AI chip (owner ruling 2026-09-06 #34) — a Discord-APP-style badge, not the "(AI)" /
   "（AI）" parenthetical this replaced. Small-caps rather than shrunk-and-uppercased, so it
   reads as a label and not as shouting; the background is a neutral grey wash rather than a
   new --reef-inbox-* custom property for one badge (same non-brand posture as .${PREFIX}-msg-
   owner two rules down). inline-block so its own margin — not a text-level space baked into any
   locale string — is what separates it from its neighbours, uniformly across every locale. */
.${PREFIX}-ai-chip{display:inline-block;margin:0 .3em;padding:0 .35em;border-radius:.3em;
  font-size:.85em;font-weight:600;font-variant:all-small-caps;line-height:1.5;
  background:rgba(127,127,127,.28);vertical-align:baseline}
/* 「重新問 KAITO」/「新對話」in the human thread, or 「回到真人對話」in ask/fresh
   mode (that one carries .dc-inbox-quiet too, styled below, once it exists). */
.${PREFIX}-second{display:block;margin:.35rem 0 0;border:1px solid currentColor;border-radius:.45rem;
  padding:.2rem .5rem;cursor:pointer;background:transparent;color:inherit;font:inherit;font-size:.72rem}
.${PREFIX}-ended{margin:.3rem 0 0;text-align:left}
.${PREFIX}-close{border:0;background:none;cursor:pointer;font-size:1.1rem;line-height:1;
  padding:.25rem;color:inherit;opacity:.6}
.${PREFIX}-log{flex:1;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.6rem}
.${PREFIX}-msg{max-width:85%;padding:.5rem .7rem;border-radius:.7rem;font-size:.9rem;
  line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.${PREFIX}-msg-visitor{align-self:flex-end;background:var(--reef-inbox-accent,#111);
  color:var(--reef-inbox-on-accent,#fff)}
.${PREFIX}-msg-owner{align-self:flex-start;background:rgba(0,0,0,.06)}
.${PREFIX}-hint{font-size:.8rem;opacity:.65;margin:0;text-align:center}
/* 🩸 A .dc-inbox-seen rule lived here until 0.7.3 — the 「站主看得到」 footer under the form, with a
   comment saying it may never be hidden. The owner removed the SENTENCE (2026-09-07), and a rule
   for an element nothing renders is dead CSS that reads like a live promise, so it went with it.
   What the line was defending is unchanged and now lives in the status line above the log: the
   panel still says, before anyone types, that a person is on the other end. */
.${PREFIX}-src{display:block;margin-top:.4rem;font-size:.75rem;opacity:.7;color:inherit}
.${PREFIX}-tohuman{align-self:flex-start;border:1px solid currentColor;border-radius:.5rem;
  padding:.35rem .7rem;cursor:pointer;background:transparent;color:inherit;font:inherit;font-size:.8rem}
.${PREFIX}-tohuman[disabled]{opacity:.5;cursor:default}
.${PREFIX}-handoff{align-self:stretch;display:flex;flex-direction:column;gap:.45rem;
  padding:.7rem;border:1px solid rgba(0,0,0,.12);border-radius:.7rem}
.${PREFIX}-handoff label{font-size:.78rem}
.${PREFIX}-handoff textarea,.${PREFIX}-handoff input{box-sizing:border-box;width:100%;margin-top:.2rem;
  border:1px solid rgba(0,0,0,.15);border-radius:.45rem;padding:.45rem .55rem;font:inherit;
  font-size:max(1rem,16px);background:transparent;color:inherit}
.${PREFIX}-handoff textarea{resize:vertical;min-height:4.5rem}
.${PREFIX}-email-note{font-size:.72rem;opacity:.7;margin:0;line-height:1.4}
.${PREFIX}-handoff-actions{display:flex;justify-content:flex-end;gap:.45rem}
.${PREFIX}-handoff-actions button{border:1px solid currentColor;border-radius:.45rem;padding:.4rem .7rem;
  cursor:pointer;background:transparent;color:inherit;font:inherit}
.${PREFIX}-handoff-actions button[type="submit"]{background:var(--reef-inbox-accent,#111);color:var(--reef-inbox-on-accent,#fff)}
.${PREFIX}-handoff :disabled{opacity:.5;cursor:default}
/* After a real answer the offer is a quieter afterthought, not a second CTA
   competing with the answer the visitor just got. */
.${PREFIX}-quiet{border-color:transparent;opacity:.6;padding-left:0}
.${PREFIX}-form{display:flex;gap:.5rem;padding:.7rem;border-top:1px solid rgba(0,0,0,.08)}
.${PREFIX}-form textarea{flex:1;resize:none;border:1px solid rgba(0,0,0,.15);border-radius:.5rem;
  padding:.45rem .55rem;font:inherit;font-size:max(1rem,16px);min-height:2.6rem;max-height:7rem;
  background:transparent;color:inherit}
.${PREFIX}-form button{border:0;border-radius:.5rem;padding:0 .9rem;cursor:pointer;
  background:var(--reef-inbox-accent,#111);color:var(--reef-inbox-on-accent,#fff);font-size:.9rem}
.${PREFIX}-form button[disabled]{opacity:.5;cursor:default}
.${PREFIX}-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.${PREFIX}-error{margin:0 .9rem .6rem;font-size:.85rem;color:#b3261e}
@media (prefers-color-scheme:dark){
  .${PREFIX}-panel{background:var(--reef-inbox-bg,#1c1c1e);color:var(--reef-inbox-fg,#f2f2f7)}
  .${PREFIX}-msg-owner{background:rgba(255,255,255,.10)}
  .${PREFIX}-head,.${PREFIX}-form{border-color:rgba(255,255,255,.12)}
  .${PREFIX}-form textarea{border-color:rgba(255,255,255,.2)}
}
@media (prefers-reduced-motion:no-preference){.${PREFIX}-panel{animation:${PREFIX}-in .16s ease-out}}
@keyframes ${PREFIX}-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`;
	document.head.appendChild(style);
}

// 🔴 No `copy` parameter any more (0.7.3): `copy.empty` was the only string this function ever
// read, and a parameter nothing reads is the next thing somebody re-fills with a sentence.
function renderLog(logEl, messages) {
	// 🔴 An empty thread is EMPTY (0.7.3). This used to paint `copy.empty` —
	// 「想問什麼都可以，是真人在看。」— and that sentence was removed by the same ruling that
	// removed it from the ask panel, so the placeholder in the box below is the only invitation
	// left. Deliberately not replaced with a different sentence: the ruling was about how many
	// lines the panel says before the visitor types, and this is one of them.
	if (!messages.length) {
		logEl.innerHTML = '';
		return;
	}
	logEl.innerHTML = messages
		.map(
			(m) =>
				`<div class="${PREFIX}-msg ${PREFIX}-msg-${m.author === 'owner' ? 'owner' : 'visitor'}">${escHtml(m.text)}</div>`
		)
		.join('');
	logEl.scrollTop = logEl.scrollHeight;
}

// ── the network ─────────────────────────────────────────────────────────────

/**
 * 🔴 The conversation id travels in a HEADER, not the query string.
 *
 * It is a bearer token: whoever holds it reads this whole transcript. A query
 * string is written into edge logs, into browser history, and into a `Referer`
 * the day this panel renders any link — a header is in none of those.
 */
/**
 * Returns `{ messages, status }`, or `null` when the fetch failed outright.
 *
 * `status` is speculative — see `handoffConcluded`'s header comment. Reading
 * it here costs nothing and means the day `/api/inbox` starts sending it,
 * this file already listens.
 */
async function fetchTranscript(apiBase, kind, id, conv) {
	const url = `${apiBase}/api/inbox?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;
	const res = await fetch(url, {
		headers: { accept: 'application/json', 'x-inbox-conversation': conv }
	});
	if (!res.ok) return null;
	const body = await res.json();
	if (!Array.isArray(body && body.messages)) return null;
	return { messages: body.messages, status: typeof body.status === 'string' ? body.status : null };
}

/**
 * Ask the site. Returns a render-ready shape, or null when we could not ask.
 *
 * 🔴 CITED-ALWAYS, defence in depth: a `grounded` answer that arrives without a
 * source_url is demoted to a refusal here, exactly as `$lib/kaito/widget.ts`
 * does for our own page. KAITO shows a citation or it shows nothing — and this
 * file is a separate implementation of the same promise, so it has to keep it
 * on its own rather than trusting the wire.
 */
/**
 * Which locale THIS page is served under, as the site's own URL segment —
 * 'ja-jp', or '' for a bare page (the site's primary locale, and every
 * single-locale site).
 *
 * 🩸 The bubble has always known its page's language — `declared` above reads
 * `<html lang>` to pick this widget's own UI copy — and never told the engine.
 * So a visitor reading the Japanese page could be handed the Korean copy of the
 * same paragraph: four translations of one sentence sit almost on top of each
 * other in a multilingual embedding space, and the tie broke arbitrarily.
 * Measured 2026-08-21 across two live sites: 27 of 70 grounded answers came back
 * in a language the visitor had not asked in.
 *
 * 🔴 The URL SEGMENT, not `<html lang>`. The segment is exactly what the stored
 * citation URLs carry, so the two compare without a locale table on either side —
 * and a site that adds a locale needs no release here. `<html lang>` is a BCP-47
 * tag in a different spelling ('zh-Hant' for a page served at /zh-tw/), which is
 * the sort of near-miss that matches nothing and fails silently.
 */
function pageLocale() {
	try {
		const seg = String(location.pathname || '').replace(/^\/+/, '').split('/')[0] || '';
		return /^[a-z]{2}-[a-z]{2}$/i.test(seg) ? seg.toLowerCase() : '';
	} catch {
		return '';
	}
}

async function askKaito(apiBase, kind, id, query, copy) {
	let res;
	try {
		res = await fetch(`${apiBase}/api/kaito`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind, id, query, locale: pageLocale() })
		});
	} catch {
		return null;
	}
	if (!res.ok) return null;
	let body;
	try {
		body = await res.json();
	} catch {
		return null;
	}
	// cited-always, and now cite-SAFELY: an answer whose citation cannot be
	// linked is demoted exactly like one that has no citation at all. KAITO shows
	// a usable citation or it shows nothing.
	if (body && body.kind === 'grounded' && body.text && safeHref(body.source_url)) {
		return { kind: 'grounded', text: String(body.text), source_url: String(body.source_url) };
	}
	// 🩸 The refusal is UI COPY, not content — and the visitor's language is a
	// CLIENT fact. Until 2026-08-19 this returned the server's string verbatim, so
	// a Japanese visitor asking 「俺のこと知ってんの？」 on a Japanese page was
	// answered 「我沒有這方面的紀錄」. The server keeps its fixed string as the
	// default for callers that are not a browser (the Discord card path), and the
	// bubble — which already knows what language its page is in — says it here.
	//
	// 🔴 Only the REFUSAL. A grounded answer is a stored passage from the owner's
	// own page and is returned verbatim, in whatever language they wrote it. That
	// is the cited-always guarantee, and it is not ours to translate.
	if (body && typeof body.text === 'string' && body.text) {
		return { kind: 'refused', text: copy.refused || body.text };
	}
	return null;
}

async function send(apiBase, payload) {
	const res = await fetch(`${apiBase}/api/inbox`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	let body = null;
	try {
		body = await res.json();
	} catch {
		/* a body we cannot read is handled by status alone below */
	}
	return { status: res.status, body };
}

/** Wire the shared one-at-a-time, keyboard-safe compose behaviour. */
export function bindCompose(form, textarea, button, pendingLabel, idleLabel, onSend) {
	let sending = false;
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (sending) return;
		const text = textarea.value.trim();
		if (!text) return;

		sending = true;
		button.disabled = true;
		button.textContent = pendingLabel;
		textarea.setAttribute('aria-busy', 'true');
		let succeeded = false;
		try {
			succeeded = (await onSend(text)) === true;
			if (succeeded) textarea.value = '';
		} finally {
			sending = false;
			button.disabled = false;
			button.textContent = idleLabel;
			textarea.removeAttribute('aria-busy');
			textarea.focus();
		}
	});
	textarea.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
		event.preventDefault();
		if (!sending) form.requestSubmit();
	});
}

export function inboxPayload(kind, id, conv, text, pageUrl, hp = '', visitorName = '', visitorEmail = '') {
	const payload = { kind, id, conversation_id: conv, text, page_url: pageUrl, _hp: hp };
	if (visitorEmail.trim()) payload.visitor_email = visitorEmail.trim();
	if (visitorName.trim()) payload.visitor_name = visitorName.trim();
	return payload;
}

export function handoffFormHtml(copy, question) {
	return `<form class="${PREFIX}-handoff">
  <label>${escHtml(copy.placeholder)}<textarea name="text" rows="3">${escHtml(question)}</textarea></label>
  <label>${escHtml(copy.name)}<input name="visitor_name" autocomplete="name"></label>
  <label>${escHtml(copy.email)}<input name="visitor_email" type="email" autocomplete="email"></label>
  <p class="${PREFIX}-email-note">${escHtml(copy.emailNote)}</p>
  <label class="${PREFIX}-hp" aria-hidden="true"><span>Leave this empty</span><input type="text" name="_hp" tabindex="-1" autocomplete="off"></label>
  <div class="${PREFIX}-handoff-actions"><button type="button" data-cancel>${escHtml(copy.cancel)}</button><button type="submit">${escHtml(copy.send)}</button></div>
</form>`;
}

export function refusalNeedsHandoffForm(answer) {
	return !answer || answer.kind !== 'grounded';
}

// ── mount ───────────────────────────────────────────────────────────────────

export async function mount(el) {
	const kind = el.getAttribute('data-kind') || '';
	const id = el.getAttribute('data-id') || '';
	const kaitoOn = el.getAttribute('data-kaito') === '1';
	const apiBase = (el.getAttribute('data-api-base') || DEFAULT_API_BASE).replace(/\/$/, '');
	if (!kind || !id) {
		// Named, and visible only to whoever embedded it — a silent no-op here
		// means an owner who thinks they installed a bubble and has not.
		el.innerHTML = `<p class="${PREFIX}-error">inbox-bubble: missing data-kind / data-id</p>`;
		return;
	}

	injectStyles();
	const copy = copyFor(el);
	const site = resolveSiteName(el, document);
	// 🏛 `let`, not `const` — the baked value is only the OPENING answer. The platform read at the
	// bottom of `mount` may replace it, which is what makes an owner's rename effective without a
	// republish (CANON 第一條). Every reader below already goes through `headHtml()`/`renderClosed()`,
	// so a re-render after that read is all it takes.
	let assistantName = resolveAssistantName(el);
	const tenant = `${kind}:${id}`;
	const handle = loadHandle(tenant);
	/**
	 * The reachable human thread — 🔴 renamed from the old bare `conv` on
	 * purpose. This one only ever changes when a message actually reaches a
	 * person (the server hands back a `conversation_id`); it is NEVER nulled
	 * out just to show a fresh view. `conv` below is the ACTIVE variable the
	 * rest of this file already reads and sends — it now tracks which view is
	 * showing, not just whether a thread exists.
	 */
	let handoffConv = handle ? handle.conv : null;
	/** Whether the LIVE hand-off (if any) was made with an email address. */
	let hasEmail = handle ? handle.hasEmail : false;
	/** The visitor's last CHOSEN view — see `loadHandle`'s header comment. */
	let storedMode = handle ? handle.mode : 'human';
	/**
	 * The active conversation — `handoffConv` while showing the human thread,
	 * `null` while asking KAITO or composing fresh. Every existing `conv` read
	 * in this file (the send payloads, `refresh()`'s guard, `headHtml()`'s
	 * status) keeps working unchanged; only ASSIGNING it is new.
	 */
	let conv = storedMode === 'human' ? handoffConv : null;
	let messages = [];
	/** Speculative — see `handoffConcluded`. `null` until a fetch says otherwise. */
	let conversationStatus = null;
	/**
	 * Set only by `renderOpen()`, only when it auto-returns to ask mode because
	 * the human thread concluded — never by a deliberate "ask again" click.
	 * Read fresh at render time so it can't drift from a `messages` array that
	 * gets cleared the moment the view switches (see `renderOpen`).
	 */
	let handoffEndedNote = false;
	let open = false;
	let poller = null;
	/** Set from the server's answer. NEVER defaulted — see the file header. */
	let replyWithinHours = null;

	function headHtml() {
		// 🔴 `status` IS ALREADY SAFE HTML, NOT PLAIN TEXT (owner ruling 2026-09-06 #34) — `statusFor`
		// itself escapes the dynamic parts and splices in the AI chip's real markup, so it must be
		// inserted BELOW as an HTML fragment, never re-escaped. Re-`escHtml`ing it here (the way this
		// line used to) would print the chip's own `<span>` as literal text instead of rendering it.
		const status = statusFor(copy, { hasConv: !!conv, hasEmail, kaitoOn }, assistantName);
		// 🔑 The escape hatch bug #1 (2026-09-04) exists to add: once a hand-off
		// happens the panel used to show the human thread FOREVER, with no way
		// back to KAITO or a fresh question. `conv` truthy → viewing the human
		// thread, offer the way out. `conv` falsy with `handoffConv` still around
		// → viewing ask/fresh mode with an old thread parked behind a quiet link.
		let secondLabel = null;
		let quiet = false;
		if (conv) {
			secondLabel = kaitoOn ? copy.askAgain(assistantName) : copy.newConversation;
		} else if (handoffConv) {
			secondLabel = copy.backToHuman;
			quiet = true;
		}
		const secondBtn = secondLabel
			? `<button type="button" class="${PREFIX}-second${quiet ? ` ${PREFIX}-quiet` : ''}">${escHtml(secondLabel)}</button>`
			: '';
		const note = !conv && handoffConv && handoffEndedNote
			? `<p class="${PREFIX}-hint ${PREFIX}-ended">${escHtml(copy.handoffEnded)}</p>`
			: '';
		return `<div class="${PREFIX}-head-text"><h2>${escHtml(site)}</h2>` +
			(status ? `<p class="${PREFIX}-status">${status}</p>` : '') +
			secondBtn + note +
			`</div><button type="button" class="${PREFIX}-close" aria-label="${escHtml(copy.closed)}">×</button>`;
	}

	/** Wires the close button and, when `headHtml()` rendered one, the second action. */
	function wireHead() {
		root.querySelector(`.${PREFIX}-close`).addEventListener('click', () => {
			open = false;
			renderClosed();
		});
		const second = root.querySelector(`.${PREFIX}-second`);
		if (second) second.addEventListener('click', () => (conv ? goAsk() : goHuman()));
	}

	/**
	 * 🩸 THE LATE RENAME MUST NOT COST THE VISITOR THEIR DRAFT (0.7.2). The platform read at the
	 * bottom of `mount` used to finish with `if (open) renderOpen(); else renderClosed();`, and
	 * `renderOpen` → `renderAsk`/`renderMessages` assign `root.innerHTML` and re-`focus()` the
	 * textarea. The window is not theoretical: that fetch is queued AFTER the transcript refresh,
	 * so for a returning visitor on a slow connection it lands two round trips into a panel they
	 * can already type in. Two lines typed, or a KAITO answer just received, and the whole panel
	 * is replaced — and a send in flight would write its result into a detached `log`, which
	 * looks exactly like a message that vanished.
	 *
	 * 🔴 SO PATCH THE NAME NODES, NOT THE PANEL. There are exactly two of them, and `headHtml`
	 * above is where both are built: the status line (`statusFor`, safe HTML by contract — see
	 * its own comment — so `innerHTML`, deliberately, not `textContent`) and the second action's
	 * label when it reads 「重新問 <名字>」. Everything else in the panel — draft, log, focus,
	 * scroll — is untouched by construction, because nothing else interpolates the name.
	 *
	 * 🔴 THE CLOSED STATE NEEDS NOTHING. `renderClosed` paints one icon button whose accessible
	 * name is `copy.open`; no name reaches it. And the next `renderOpen` reads `assistantName`
	 * fresh, so a visitor who opens the panel later still gets the new name.
	 */
	function applyAssistantName() {
		const status = root.querySelector(`.${PREFIX}-status`);
		if (status) status.innerHTML = statusFor(copy, { hasConv: !!conv, hasEmail, kaitoOn }, assistantName);
		const second = root.querySelector(`.${PREFIX}-second`);
		if (second && conv && kaitoOn) second.textContent = copy.askAgain(assistantName);
	}

	/** 「重新問 KAITO」/「新對話」— leave the human thread up without discarding it. */
	function goAsk() {
		storedMode = 'ask';
		saveHandle(tenant, handoffConv, hasEmail, storedMode);
		conv = null;
		messages = [];
		handoffEndedNote = false;
		stopPolling();
		if (kaitoOn) renderAsk();
		else renderMessages();
	}

	/** 「回到真人對話」— the human thread was never gone, only not the active view. */
	function goHuman() {
		storedMode = 'human';
		saveHandle(tenant, handoffConv, hasEmail, storedMode);
		conv = handoffConv;
		handoffEndedNote = false;
		renderMessages();
	}

	const root = document.createElement('div');
	root.className = `${PREFIX}-root`;
	el.appendChild(root);

	function stopPolling() {
		if (poller) {
			clearInterval(poller);
			poller = null;
		}
	}

	let pollFailures = 0;

	async function refresh() {
		if (!conv) return;
		const got = await fetchTranscript(apiBase, kind, id, conv).catch(() => null);
		if (got) {
			pollFailures = 0;
			messages = got.messages;
			conversationStatus = got.status;
			const log = root.querySelector(`.${PREFIX}-log`);
			if (log) renderLog(log, messages);
			return;
		}
		// Counted, not ignored: a 404 for a conversation the server no longer has
		// and a network that is down look identical from here, and neither is
		// worth asking about forever.
		if (++pollFailures >= POLL_GIVE_UP_AFTER) stopPolling();
	}

	/**
	 * Which panel to show.
	 *
	 * 🩸 Used to be "a conversation, once it exists, wins forever" — the exact
	 * bug this file exists to fix (2026-09-04 report): a visitor who once used
	 * the hand-off saw the human thread on every later open, with no way back
	 * to KAITO or a new question, for days. Now the stored handle is still the
	 * "already asked a person" flag, but it is no longer the ONLY vote —
	 * `resolveViewMode` also hears the visitor's last choice and whether the
	 * thread has concluded.
	 */
	function renderOpen() {
		const concluded = handoffConcluded(messages, conversationStatus);
		const mode = resolveViewMode({ hasHandoffConv: !!handoffConv, storedMode, concluded, kaitoOn });
		if (mode === 'ask') {
			handoffEndedNote = concluded && !!handoffConv;
			conv = null;
			messages = [];
		} else {
			handoffEndedNote = false;
			conv = handoffConv;
		}
		if (mode === 'ask' && kaitoOn) return renderAsk();
		return renderMessages();
	}

	function renderClosed() {
		stopPolling();
		// 🩸 This was the label as visible TEXT — so every site's corner read
		// 「メッセージ」/「傳訊息」, and a site that wanted the icon everyone else's
		// support widget has had to override our CSS from its own page. That is
		// portability debt we handed the owner for something the coral should own.
		//
		// The words are not deleted, they MOVE: `copy.open` is now the button's
		// accessible name, so a screen reader says exactly what it said before
		// while the corner shows a glyph.
		root.innerHTML =
			`<button type="button" class="${PREFIX}-open" aria-label="${escHtml(copy.open)}">${OPEN_ICON}</button>`;
		root.querySelector(`.${PREFIX}-open`).addEventListener('click', () => {
			open = true;
			renderOpen();
		});
	}

	/**
	 * Hand the visitor's OWN question to a person. Only ever called from a click.
	 *
	 * What travels is the question, verbatim, and nothing else — not the passage
	 * KAITO offered, not the fact that it refused, not a note we wrote. The owner
	 * reads what was asked. ("KAITO could not answer this" is real and useful,
	 * but it belongs to the refusal league table (SPEC §5), not smuggled into
	 * somebody's message.)
	 */
	async function escalate(question, button, copyRef) {
		button.disabled = true;
		button.textContent = copyRef.sending;
		const { status, body } = await send(apiBase, {
			kind,
			id,
			conversation_id: conv,
			text: question,
			page_url: location.href
		}).catch(() => ({ status: 0, body: null }));

		if (status === 200 && body && body.ok) {
			conv = body.conversation_id;
			handoffConv = conv;
			storedMode = 'human';
			// The quiet "still want a person?" button carries no form — no email
			// was ever offered on this path.
			hasEmail = false;
			saveHandle(tenant, conv, hasEmail, storedMode);
			replyWithinHours = body.reply_within_hours ?? null;
			renderMessages();
			const log = root.querySelector(`.${PREFIX}-log`);
			if (log) {
				const hint = document.createElement('p');
				hint.className = `${PREFIX}-hint`;
				hint.textContent = copyRef.sentToHuman;
				log.appendChild(hint);
			}
			await refresh();
			return;
		}
		button.disabled = false;
		button.textContent = copyRef.toHumanAfterRefusal;
		showError(status, copyRef);
	}

	function showHandoffForm(question, button, copyRef) {
		button.insertAdjacentHTML('afterend', handoffFormHtml(copyRef, question));
		button.remove();
		const form = root.querySelector(`.${PREFIX}-handoff`);
		const textarea = form.querySelector('textarea');
		const sendButton = form.querySelector('button[type="submit"]');
		form.querySelector('[data-cancel]').addEventListener('click', () => {
			form.replaceWith(button);
			button.focus();
		});
		textarea.focus();
		bindCompose(form, textarea, sendButton, copyRef.sending, copyRef.send, async (text) => {
			const emailGiven = !!form.querySelector('input[name="visitor_email"]').value.trim();
			const payload = inboxPayload(kind, id, conv, text, location.href,
				form.querySelector('input[name="_hp"]').value,
				form.querySelector('input[name="visitor_name"]').value,
				form.querySelector('input[name="visitor_email"]').value);
			const { status, body } = await send(apiBase, payload).catch(() => ({ status: 0, body: null }));
			if (status >= 200 && status < 300 && body && body.ok) {
				conv = body.conversation_id;
				handoffConv = conv;
				storedMode = 'human';
				hasEmail = emailGiven;
				saveHandle(tenant, conv, hasEmail, storedMode);
				replyWithinHours = body.reply_within_hours ?? null;
				// 🩸 The confirmation used to render AFTER `await refresh()` — a real
				// network round trip — so the panel sat on the freshly-reset empty
				// state for however long that took (finding #8, 2026-09-03 cold-read:
				// ~600ms of "did my message just disappear?"). The hint now lands
				// synchronously in the SAME tick as the re-render, exactly like the
				// no-email escalate() path beside this one always has; refresh() then
			// only replaces the message list underneath it, never blanks the panel.
				renderMessages();
				const log = root.querySelector(`.${PREFIX}-log`);
				if (log) {
					const hint = document.createElement('p');
					hint.className = `${PREFIX}-hint`;
					hint.textContent = copyRef.sentToHuman;
					log.appendChild(hint);
				}
				await refresh();
				return true;
			}
			showError(status, copyRef);
			return false;
		});
	}

	function showError(status, copyRef) {
		const existing = root.querySelector(`.${PREFIX}-error`);
		if (existing) existing.remove();
		const err = document.createElement('p');
		err.className = `${PREFIX}-error`;
		err.textContent = status === 429 ? copyRef.rate : copyRef.error;
		const panel = root.querySelector(`.${PREFIX}-panel`);
		if (panel) panel.appendChild(err);
	}

	/**
	 * The ASK view — only reachable with data-kaito="1" and no conversation yet.
	 *
	 * 🔴 The button that reaches a person is rendered only AFTER an answer comes
	 * back, and it is never pre-armed. See the file header: the press is what
	 * makes the interruption deliberate.
	 */
	function renderAsk() {
		root.innerHTML = `
<div class="${PREFIX}-panel" role="dialog" aria-label="${escHtml(copy.title)}">
  <div class="${PREFIX}-head">${headHtml()}</div>
  <div class="${PREFIX}-log"></div>
  <form class="${PREFIX}-form">
    <textarea name="q" rows="1" placeholder="${escHtml(copy.ask)}"></textarea>
    <button type="submit">${escHtml(copy.send)}</button>
  </form>
</div>`;
		wireHead();

		const form = root.querySelector(`.${PREFIX}-form`);
		const textarea = form.querySelector('textarea');
		const button = form.querySelector('button');
		const log = root.querySelector(`.${PREFIX}-log`);
		textarea.focus();

		bindCompose(form, textarea, button, copy.asking, copy.send, async (question) => {
			const answer = await askKaito(apiBase, kind, id, question, copy);

			// The question the visitor asked, shown back to them, so the panel
			// reads as an exchange rather than a slot machine.
			log.innerHTML =
				`<div class="${PREFIX}-msg ${PREFIX}-msg-visitor">${escHtml(question)}</div>`;

			const src = answer && answer.kind === 'grounded' ? safeHref(answer.source_url) : null;
			if (answer && answer.kind === 'grounded' && src) {
				log.insertAdjacentHTML(
					'beforeend',
					`<div class="${PREFIX}-msg ${PREFIX}-msg-owner">${escHtml(answer.text)}` +
						`<a class="${PREFIX}-src" href="${escHtml(src)}" rel="noopener noreferrer">${escHtml(copy.source)}</a></div>` +
						`<button type="button" class="${PREFIX}-tohuman ${PREFIX}-quiet">${escHtml(copy.toHuman)}</button>`
				);
			} else {
				// A refusal, an uncited answer, and an engine we could not reach all
				// land here — and they land the same way ON PURPOSE. From the
				// visitor's side the useful fact is identical ("the site does not
				// answer that; want a person?"), and dressing our plumbing up as
				// three different experiences would tell them about us instead of
				// helping them.
				const said = answer ? answer.text : copy.error;
				log.insertAdjacentHTML(
					'beforeend',
					`<div class="${PREFIX}-msg ${PREFIX}-msg-owner">${escHtml(said)}</div>` +
						`<button type="button" class="${PREFIX}-tohuman">${escHtml(copy.toHumanAfterRefusal)}</button>`
				);
			}
			log.scrollTop = log.scrollHeight;

			const toHuman = log.querySelector(`.${PREFIX}-tohuman`);
			toHuman.addEventListener('click', () => {
				if (refusalNeedsHandoffForm(answer)) showHandoffForm(question, toHuman, copy);
				else escalate(question, toHuman, copy);
			});
			return true;
		});
	}

	function renderMessages() {
		root.innerHTML = `
<div class="${PREFIX}-panel" role="dialog" aria-label="${escHtml(copy.title)}">
  <div class="${PREFIX}-head">${headHtml()}</div>
  <div class="${PREFIX}-log"></div>
  ${replyWithinHours ? `<p class="${PREFIX}-hint">${escHtml(copy.within(replyWithinHours))}</p>` : ''}
  <form class="${PREFIX}-form">
    <label class="${PREFIX}-hp" aria-hidden="true">
      <span>Leave this empty</span><input type="text" name="_hp" tabindex="-1" autocomplete="off">
    </label>
    <textarea name="text" rows="1" placeholder="${escHtml(copy.placeholder)}"></textarea>
    <button type="submit">${escHtml(copy.send)}</button>
  </form>
</div>`;

		const log = root.querySelector(`.${PREFIX}-log`);
		renderLog(log, messages);

		wireHead();

		const form = root.querySelector(`.${PREFIX}-form`);
		const textarea = form.querySelector('textarea');
		const button = form.querySelector('button');
		textarea.focus();

		bindCompose(form, textarea, button, copy.sending, copy.send, async (text) => {
			const { status, body } = await send(apiBase, {
				kind,
				id,
				conversation_id: conv,
				text,
				page_url: location.href,
				_hp: form.querySelector('input[name="_hp"]').value
			}).catch(() => ({ status: 0, body: null }));
			if (status === 200 && body && body.ok) {
				conv = body.conversation_id;
				handoffConv = conv;
				storedMode = 'human';
				// This is the direct compose form — it has no email field, so
				// whatever `hasEmail` already recorded (from an earlier hand-off,
				// or never-set) stands.
				saveHandle(tenant, conv, hasEmail, storedMode);
				// Trust our own copy, not the local one: the server has just told us
				// what it stored, and a locally-appended message that silently failed
				// to save is the exact lie this product cannot tell.
				replyWithinHours = body.reply_within_hours ?? null;
				await refresh();
				const hint = document.createElement('p');
				hint.className = `${PREFIX}-hint`;
				hint.textContent = copy.stored;
				log.appendChild(hint);
				log.scrollTop = log.scrollHeight;
				return true;
			}

			// 🔴 Honest failure. The message is NOT shown as sent, and the words stay
			// in the box so nobody has to retype them.
			const existing = root.querySelector(`.${PREFIX}-error`);
			if (existing) existing.remove();
			const err = document.createElement('p');
			err.className = `${PREFIX}-error`;
			err.textContent = status === 429 ? copy.rate : copy.error;
			form.parentNode.insertBefore(err, form);
			return false;
		});

		refresh();
		stopPolling();
		poller = setInterval(refresh, POLL_MS);
	}

	renderClosed();
	// One read at mount so a returning visitor sees the reply waiting for them
	// behind the closed bubble — without opening a panel nobody asked for.
	if (conv) await refresh();

	// 🏛 The platform's name, applied AFTER the first paint (CANON 第一條 / ruling #36).
	//
	// 🔴 DELIBERATELY NOT AWAITED, and that is a correctness decision rather than a stylistic one.
	// `mount()` resolving is what the whole rest of the system treats as「the bubble is up」, so
	// awaiting a network round trip here would put the platform's latency in front of every
	// visitor's first paint on every page — to fix a LABEL. It also silently lengthened the async
	// chain enough to break an unrelated send-path test, which is the cheap version of the bug a
	// real visitor would have hit as a dropped first message on a slow connection.
	//
	// So the bubble draws immediately with the baked value and corrects itself a beat later.
	// `null` ⇒ nothing to correct, and the name already on screen stands.
	void fetchAssistantName(apiBase, kind, id).then((platformName) => {
		if (!platformName || platformName === assistantName) return;
		assistantName = platformName;
		applyAssistantName();
	});
}

export function mountAll() {
	document.querySelectorAll(SELECTOR).forEach((el) => {
		if (el.getAttribute('data-dynamic-coral-mounted') === '1') return;
		el.setAttribute('data-dynamic-coral-mounted', '1');
		mount(el);
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', mountAll);
} else {
	mountAll();
}
