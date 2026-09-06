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
// 🔴 AND THIS FILE OFFERS NO API FOR A PAGE SCRIPT TO PICK ONE — WHICH IS WHY THERE IS NO
// HAND-OFF EVENT (0.7.5, review B3). 0.7.4 added `reef-inbox:handle` so a page holding an id the
// server minted by another route could push it into an already-mounted panel. 0.7.5 addressed that
// event to one mount, and addressing fixed misdelivery, not reach: the address IS the mount
// element, and any script on the page can `querySelector` it. So the EVENT is what went (tile #15,
// won't do). No event, no export, no attribute takes a conversation id from the page.
//
// 🔴 WHAT THAT DOES NOT BUY, SAID PLAINLY (review B3, round 3 — this header used to claim more).
// A same-origin script that can write `localStorage['reef-inbox:<kind>:<id>']` and then navigate
// can still choose the conversation a visitor's next message is filed under: that is the same
// intake reef's own `/report` form uses, and it belongs to storage access, not to this widget.
// Removing the event took away the IN-PLACE, INVISIBLE version — switching the thread under a
// visitor who is mid-sentence in an open panel, with no navigation and nothing on screen to see.
// It did not take away the capability, and no code in this file can. A site that loads
// third-party script it does not trust (ads, analytics, a plugin) has given that script this
// capability the same way it has already given it `localStorage` and the DOM.
//
// A hand-off is a FULL NAVIGATION instead, which is what the platform already does: reef's own
// `/report` form writes the handle to storage and sends the visitor to a page where this coral
// mounts — and this file reads its handle at mount, from storage, which stays its one intake.
// A page that wants a mounted panel to switch conversations reloads it. The thirty days that
// handle then lives for are counted from the `ts` INSIDE IT — the timestamp whoever wrote the key
// chose (see `loadHandle`); `saveHandle` only stamps `Date.now()` on the handles this file writes
// itself.
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
//   data-open-on-hash (optional) — "1" lets `#inbox` in the URL open the panel at load. Off by
//                  default: a fragment is written by whoever authored the LINK, not by the site
//                  (see shouldAutoOpenFromHash).
//   data-ai-log    (optional) — "0" opts this mount out of the deferred question
//                  log entirely (ruling 54): nothing is buffered, nothing is
//                  probed, nothing is ever sent. Any other value, including the
//                  attribute being absent, leaves it on — and「on」still writes
//                  nothing at all unless the tenant actually has an Inbox.
//   data-api-base  (optional) — override the feelreef origin
//   data-assistant-name (optional) — what VISITORS see the assistant called
//                  instead of "KAITO" (owner ruling, 2026-09-05: the name may
//                  change, but the panel still marks the reply as AI — see
//                  statusDefault). Trimmed to a single line, capped at 40
//                  grapheme clusters AND 200 UTF-16 units (a cluster has no
//                  length limit of its own — see ASSISTANT_NAME_MAX_UNITS);
//                  blank/whitespace falls back to "KAITO".
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
// 「太囉唆」. What survives is the status line (now 「<名字>[AI]先回，轉出去真人會看」: the same two
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
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}先回，轉出去真人會看`,
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
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}先回，转出去真人会看`,
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
/**
 * Is `raw` a well-formed handle — the shape `saveHandle` writes, read back out of this browser's
 * own storage by `JSON.parse`. Pure and exported because storage is a place OTHER code writes
 * (reef's own `/report` form writes this exact shape before navigating the visitor to a page the
 * coral mounts on), so「well-formed」has to be one decision this file can state and test, and a
 * malformed entry has to be provably ignored rather than thrown.
 */
export function parseHandle(raw) {
	// 🔴 `Number.isFinite`, not `typeof raw.ts === 'number'` — `typeof NaN` is 'number', and a NaN
	// timestamp passes every comparison a TTL check can make (`now - NaN > TTL` is false), so the
	// old shape test let through the one value that makes an expiry test silently answer「fresh」.
	if (!raw || typeof raw !== 'object' || typeof raw.conv !== 'string' || !Number.isFinite(raw.ts)) return null;
	// `ts` is CARRIED OUT, not dropped (review B6). The reader has to answer 「how old is this
	// handle」 without reaching past this function into the raw JSON to find out.
	return { conv: raw.conv, ts: raw.ts, hasEmail: raw.hasEmail === true, mode: raw.mode === 'ask' ? 'ask' : 'human' };
}

// 🔴 THE THIRTY DAYS ARE COUNTED FROM THE `ts` IN THE STORED VALUE, which is to say from a
// timestamp chosen by whoever wrote that key (review B3, round 3 — the header says the same). The
// handles THIS file writes are stamped `Date.now()` by `saveHandle` and nothing else, but anything
// same-origin can write the key, and a `ts` in the future never satisfies the `>` below at all.
// That is a property of the storage intake, not a check this function can make: the value is not
// signed and there is nothing here to check it against.
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
	const handle = parseHandle(parsed);
	if (!handle) return null;
	if (Date.now() - handle.ts > HANDLE_TTL_MS) {
		try {
			window.localStorage.removeItem(storeKey(tenant));
		} catch {
			/* nothing to do; the check above already treats it as absent */
		}
		return null;
	}
	return handle;
}

// 🔴 `ts` IS `Date.now()` AND NOTHING ELSE MAY SUPPLY IT (review B6). Every caller is a visitor's
// own action in this panel — they just used the thread, so the thirty days may start again. The
// fifth parameter that let a value from elsewhere be written here existed for the hand-off event,
// and went with it (B3, round 2): a TTL counted from a timestamp somebody else chose is not a TTL.
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

// ── what the visitor asked the machine, kept here until they leave ──────────
//
// Owner ruling 54 (2026-09-07, reef `docs/SPEC-inbox-bubble-position.md` §三):
//「訪客問的每一句真人都看得到，AI 只是先服務不必等」. The owner sees the questions; the
// machine's answers are still never sent anywhere (§5, and the file header above).
//
// 🔴 DEFERRED WRITE, NOT A PING PER QUESTION. The obvious shape — POST each question as
// it is asked — is the shape this coral exists not to be: it turns a browsing visitor
// into a request stream, and it makes the owner's own inbox the busiest thing on their
// site. So the questions live HERE, in this browser, in the same storage the handle
// lives in, and leave on the way out: on `pagehide` as a beacon, or the moment the visitor
// presses for a person, whichever comes first.
//
// 🔴 ONCE PER `pagehide`, AND ONLY WITH SOMETHING NEW — not once per session. A visitor who
// asks again on a second page sends the same `session_id` a second time, carrying the whole
// session, which is why the endpoint is idempotent on that id (contract §一.2) and why the
// README and the manifest may not say「once per session」(review D9).
//
// 🔴 AND ONLY WHEN THE SITE HAS AN INBOX. A KAITO-only tenant — somebody who bought the
// ask-the-site half and nothing else — writes nothing, ever. That is not a quota, it is
// whose data this is: the questions are addressed to a person, and a site with no inbox
// has no person to address them to.

/** Longest single question kept. Beyond this it is prose, and the row is not a transcript. */
export const AI_LOG_MAX_TEXT = 500;
/** Most questions carried in one session row. When full the OLDEST go — see `capAiQuestions`. */
export const AI_LOG_MAX_QUESTIONS = 20;
/** Most pages named in one session row's page sequence. */
export const AI_LOG_MAX_PAGES = 40;
/** Longest path or locale tag kept, so neither can be used to pad a row. */
export const AI_LOG_MAX_FIELD = 200;
/**
 * Longest conversation id kept — the same length the contract gives `session_id`.
 *
 * 🩸 THE FIELD D5's KNIFE MISSED (review E2). `session_id` was sliced twice and `page` four times,
 * and `handle` — the only other opaque id on this row — went from storage to the wire with a
 * `typeof` check and nothing else. Under D5's own threat model (a same-origin script writes this
 * browser's cell) the review planted 200,000 characters there and measured a 200,189-octet body:
 * three times what the beacon carries, while the README said caps were applied on the way in.
 * Both ids are minted elsewhere and are opaque here, so they are bounded by the same number.
 */
export const AI_LOG_MAX_HANDLE = 64;
/**
 * What the transport will actually carry, in OCTETS: `sendBeacon` and `fetch(keepalive)` are
 * both budgeted at ~64 KiB per origin, and a body over it is refused rather than truncated.
 */
export const AI_LOG_MAX_WIRE_BYTES = 64 * 1024;
/**
 * The page sequence's share of that budget, in octets.
 *
 * 🩸 THE ONE FIELD WITH NO LENGTH LIMIT AT ALL (review D5) — `AI_LOG_MAX_PAGES` bounded how many
 * pages, never how long each one was, while the constant beside it promised「so neither can be
 * used to pad a row」. Forty paths at the 200-character cap in Chinese is 24 KiB, and the
 * questions may already be 46; together they are the review's 70,403 bytes, which is over what
 * the beacon carries. This is what the page sequence gets, and the oldest pages go first.
 */
export const AI_LOG_MAX_PAGE_BYTES = 12 * 1024;
/**
 * How long a session may sit idle before the next page view is a NEW session.
 *
 * 🔴 A SESSION IS NOT A PAGE. On a static site every navigation is a fresh document and a
 * fresh `mount()`, so a buffer scoped to one document would make「一列一個 session」mean
 *「一列一頁」— and the page SEQUENCE, which is the whole point of the row, would never have
 * more than one entry in it. The buffer therefore lives in `localStorage` (the same place
 * the handle lives, per the ruling) and this is what ends the session instead.
 */
export const AI_LOG_IDLE_MS = 30 * 60 * 1000;
/** How long this browser trusts a DEFINITE claim-state answer before asking again. */
export const AI_LOG_CLAIM_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * How long it waits after a probe that answered「we do not know」.
 *
 * 🔴 NOT THE TTL, BECAUSE NOTHING WAS LEARNED. A failure — no network, an unreadable shape, or
 * the contract's own `throttled` — must not be cached as an answer; but it must not be free
 * either, or every question re-asks (review D8 measured eight probes for eight questions against
 * a manifest that promises at most one per six hours). So it is bounded here instead: one probe
 * per five minutes per browser until somebody actually answers.
 */
export const AI_LOG_CLAIM_RETRY_MS = 5 * 60 * 1000;
const AI_LOG_PREFIX = 'reef-inbox:ai:';

/** The buffer's own key — beside the handle's (`reef-inbox:<tenant>`), never inside it. */
export function aiLogKey(tenant) {
	return AI_LOG_PREFIX + tenant;
}

/** One line of text, bounded, with the control characters a row is not allowed to carry. */
function aiLine(raw, max) {
	if (typeof raw !== 'string') return '';
	return raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

/**
 * How many UTF-8 octets a string costs — the unit the transport and the server both count in.
 *
 * 🩸 TWO NUMBERS IN DIFFERENT COORDINATE SYSTEMS (review D4). Every cap above is applied with
 * `String.prototype.slice`, which counts UTF-16 characters, while `sendBeacon`'s ~64 KiB budget
 * counts octets — and one CJK character is three of them. So a row measured at「20 × 500」can
 * reach the transport at three times the size it was capped to: the review's worst profile came
 * to 70,403 bytes, and a beacon that big is refused. Nothing in this file had ever counted the
 * other unit.
 *
 * Spelled out rather than `new TextEncoder()`: this runs inside a `pagehide` handler, where a
 * global that may not exist is not worth a try/catch for arithmetic this small.
 */
export function utf8Bytes(text) {
	const s = typeof text === 'string' ? text : '';
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 0x80) n += 1;
		else if (c < 0x800) n += 2;
		else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
		else n += 3;
	}
	return n;
}

/**
 * 🔴 THE PATH, NEVER THE QUERY STRING. A page is `/pricing`; `?token=…&email=…` is whatever
 * the site put in its own links, and a row that carries it is a row holding somebody's
 * credentials because they happened to ask a question on the page they landed on.
 */
export function aiPagePath(href) {
	// 🔴 The non-string cases have to be refused BEFORE `new URL`, not caught after it: `new URL`
	// stringifies its first argument, so `undefined` resolves — quietly — to the page `/undefined`.
	if (typeof href !== 'string') return '/';
	try {
		return aiLine(new URL(href, 'https://x.invalid').pathname, AI_LOG_MAX_FIELD) || '/';
	} catch {
		return '/';
	}
}

/**
 * A hit is a URL, and that is what keeps the machine's answer off the wire BY SHAPE.
 *
 * 🔴 THE ONE FIELD ON THIS ROW THAT COULD EVER CARRY THE ANSWER. `text` is the visitor's own
 * sentence and `page` is a path; `hit` is the only slot where a caller could hand us the
 * machine's words by passing the wrong property of the same object — and review D3 measured
 * exactly that: swapping `answer.source_url` for `answer.text` at the one call site left all
 * hundred tests green. Prose is not a URL, so it lands here as `null` instead of on the wire.
 * The rule is enforced by the value's own shape rather than by everyone who ever calls
 * `question()` remembering it, which is what「cannot become an argument」has to mean.
 */
function aiHit(raw) {
	if (typeof raw !== 'string') return null;
	const url = aiLine(raw, AI_LOG_MAX_FIELD);
	return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/**
 * The conversation id, admitted by SHAPE and bounded in length like every other outbound field.
 *
 * 🔴 THE SHAPE `saveHandle` WRITES, AND NOTHING ELSE: a non-empty single-line string, capped. An
 * id the server minted is all of those; the 200,000-character value the review planted in this
 * browser's own cell is none of them past the cap, and one that is empty or is not a string at
 * all is DROPPED rather than sent as `""` — `handle` is the optional sixth key of the body, and
 * an absent one is the truthful way to say this session never reached a person.
 */
export function aiHandle(raw) {
	if (typeof raw !== 'string') return null;
	return aiLine(raw, AI_LOG_MAX_HANDLE) || null;
}

/**
 * The whitelist a question row is BUILT FROM — never a filter applied to something richer.
 *
 * 🔴 EVERY FIELD ON THE WIRE IS NAMED HERE, and a field that is not named here cannot get
 * there: the row is assembled by walking these keys, so「the log grew a field」and「the wire
 * grew a field」are no longer the same event. Contract §一.2 names the same five, and
 * `compose.test.mjs` asserts this list against that one — a sixth key added to the buffer,
 * to a transcript object, or to `question()`'s arguments turns those tests red rather than
 * turning up in somebody's Inbox.
 */
const AI_QUESTION_READERS = {
	text: (q) => aiLine(q.text, AI_LOG_MAX_TEXT),
	page: (q) => aiLine(q.page, AI_LOG_MAX_FIELD) || '/',
	hit: (q) => aiHit(q.hit),
	lang: (q) => aiLine(q.lang, 16),
	at: (q) => (Number.isFinite(q.at) ? q.at : 0)
};
/** The five fields of a question row, in contract order. */
export const AI_QUESTION_FIELDS = Object.keys(AI_QUESTION_READERS);
/** The six keys of the wire body — `handle` only when this session reached a person. */
export const AI_SESSION_FIELDS = ['kind', 'id', 'session_id', 'pages', 'questions', 'handle'];

/**
 * The size cap, applied where a hostile client cannot skip it — on the way IN, every time.
 *
 * 🔴 THE OLDEST GO, not the newest refused. The row is a session read back in order; a
 * visitor whose twenty-first question is the one they escalated on would otherwise have
 * that question silently dropped while twenty older ones stayed.
 */
export function capAiQuestions(list) {
	return (Array.isArray(list) ? list : []).slice(-AI_LOG_MAX_QUESTIONS).map((q) => {
		const src = q && typeof q === 'object' ? q : {};
		const row = {};
		for (const field of AI_QUESTION_FIELDS) row[field] = AI_QUESTION_READERS[field](src);
		return row;
	});
}

/**
 * Drop the OLDEST rows until the array's own JSON fits a budget of octets — the same posture as
 * every other cap here, and never down to nothing: one row, whatever it costs, still goes.
 */
function capBytes(rows, budget) {
	const sizes = rows.map((row) => utf8Bytes(JSON.stringify(row)));
	let total = sizes.reduce((n, size) => n + size + 1, 1); // the commas, and the two brackets
	let cut = 0;
	while (cut < rows.length - 1 && total > budget) total -= sizes[cut++] + 1;
	return cut ? rows.slice(cut) : rows;
}

/**
 * The page sequence, bounded the way `AI_LOG_MAX_FIELD`'s own comment says it is.
 *
 * 🩸 IT WAS BOUNDED IN COUNT ONLY (review D5). `questions[].page` went through `aiLine`, and the
 * identical value in `pages[]` did not — nothing between `localStorage` and the wire ever looked
 * at how long one of these strings was, so a 50,001-character「path」planted in this browser's own
 * cell arrived at the endpoint whole. reef truncates it on the other side, which is why this was
 * a missing layer rather than a hole; the layer is here now, where the README says it is.
 */
export function capAiPages(list) {
	const rows = (Array.isArray(list) ? list : [])
		.filter((p) => typeof p === 'string')
		.map((p) => aiLine(p, AI_LOG_MAX_FIELD) || '/')
		.slice(-AI_LOG_MAX_PAGES);
	return capBytes(rows, AI_LOG_MAX_PAGE_BYTES);
}

/** Consecutive duplicates collapse — a reload is not a second page. */
export function appendAiPage(pages, page) {
	const rows = capAiPages(pages);
	const row = aiLine(page, AI_LOG_MAX_FIELD) || '/';
	if (rows[rows.length - 1] === row) return rows;
	return capAiPages([...rows, row]);
}

/**
 * Read a buffer back out of this browser's own storage.
 *
 * Same posture as `parseHandle`: storage is a place other code can write, so「well-formed」
 * is one decision stated once and a malformed entry is provably ignored rather than thrown.
 */
export function parseAiLog(raw) {
	if (!raw || typeof raw !== 'object') return null;
	if (typeof raw.sid !== 'string' || !raw.sid) return null;
	if (!Number.isFinite(raw.started) || !Number.isFinite(raw.last)) return null;
	const questions = capAiQuestions(raw.questions);
	return {
		sid: raw.sid.slice(0, 64),
		started: raw.started,
		last: raw.last,
		pages: capAiPages(raw.pages),
		questions,
		// 🔴 CLAMPED TO WHAT IS ACTUALLY HERE. A `sent` that outran the buffer — a value
		// somebody hand-wrote, or a cap that dropped an already-counted question — would
		// permanently convince this browser it had nothing left to flush.
		sent: Number.isFinite(raw.sent) ? Math.max(0, Math.min(raw.sent, questions.length)) : 0,
		handle: aiHandle(raw.handle),
		claim: raw.claim === true || raw.claim === false ? raw.claim : null,
		// 🔴 WHEN WE LEARNED, and separately WHEN WE LAST ASKED (review E1). Both are persisted
		// because a static site's every navigation is a new document: a backoff kept in a variable
		// is a backoff that resets on the next page, and an answer's age kept in a variable is an
		// answer that is never old. Neither is on the wire — `aiSessionPayload` is a whitelist.
		claimAt: Number.isFinite(raw.claimAt) ? raw.claimAt : 0,
		probedAt: Number.isFinite(raw.probedAt) ? raw.probedAt : 0
	};
}

/**
 * The wire body — see reef `docs/SPEC-inbox-bubble-position.md` §三 and the endpoint's header.
 *
 * 🔴 ASSEMBLED FROM NAMED FIELDS, NEVER SPREAD FROM THE BUFFER. `{ ...state }` would put
 * whatever the log happens to hold — today `claim`, `claimAt`, `sent`, `started` — on the
 * wire the day somebody adds a field, and the review's mutation of exactly that shape
 * (M20) left every test green. `AI_SESSION_FIELDS` is the list, and it is asserted against
 * the bytes a real `mount()` sends, not against this literal.
 */
export function aiSessionPayload(kind, id, state) {
	const held = state && typeof state === 'object' ? state : {};
	const body = {
		kind,
		id,
		session_id: typeof held.sid === 'string' ? held.sid.slice(0, 64) : '',
		pages: capAiPages(held.pages),
		questions: capAiQuestions(held.questions)
	};
	// The same gate as on the way in, for the same reason `pages` has one at both doors: this
	// function is handed a state object, and the door it was read through is not this one's to
	// assume (review E2).
	const handle = aiHandle(held.handle);
	if (handle) body.handle = handle;
	return body;
}

/**
 * Hand one payload to the network in a way that survives the page going away.
 *
 * 🔴 `sendBeacon` FIRST, and with a `Blob` typed `application/json` — a bare string beacon
 * is sent as `text/plain`, which this endpoint refuses (see `readBody` on reef's side: an
 * unlabelled body is a client we do not recognise). `fetch(..., { keepalive: true })` is what
 * a browser without `sendBeacon` gets, what a REFUSED beacon falls through to (D4), and what a
 * caller asking to be told the outcome gets — and it is second rather than first because a
 * `pagehide` handler's ordinary `fetch` is cancelled with the document.
 *
 * 🔴 THE ANSWER COMES IN ONE OF THE TWO TENSES A BROWSER HAS, and the caller has to read
 * which one it got (review D1):
 *
 * - `false` — REFUSED. Nothing was sent and nothing will be; the buffer must survive.
 * - `true` — QUEUED, and that is everything a beacon can ever say. `sendBeacon` hands the
 *   request to the browser and the document is gone before any response exists.
 * - a `Promise<boolean>` — the fetch path, which resolves to whether the SERVER took it
 *   (a 2xx, including the idempotent replay of one). A caller that can still act — the
 *   escalation press, a bfcache restore — waits for that instead of assuming.
 *
 * `opts.confirm` asks for the third of those on purpose: the press for a person happens with
 * the document alive, so it can afford one round trip to learn what a `pagehide` never can.
 */
export function sendAiSession(url, body, env = {}, opts = {}) {
	// 🔴 `in`, NOT `??`. An injected `null` means「this world has no such thing」and `??` would
	// fall straight through to the real global — so a test asserting「no transport sends nothing」
	// would have been sending through the browser's own fetch and reading it as a pass.
	const pick = (name, real) => (name in env ? env[name] : real);
	const nav = pick('navigator', typeof navigator === 'undefined' ? null : navigator);
	const json = JSON.stringify(body);
	// 🔴 THE BUDGET IS MEASURED, NOT ASSUMED. A body over the beacon's ~64 KiB is refused by the
	// browser, so it goes to the fetch instead — the path that can say what happened, and whose
	//「no」leaves the questions in this browser rather than throwing them away (D1). The caps in
	// `capAiQuestions`/`capAiPages` are what keep an ordinary session from ever reaching this.
	const overBudget = utf8Bytes(json) > AI_LOG_MAX_WIRE_BYTES;
	if (!opts.confirm && !overBudget) {
		try {
			const BlobCtor = pick('Blob', typeof Blob === 'undefined' ? null : Blob);
			if (nav && typeof nav.sendBeacon === 'function' && BlobCtor) {
				// 🔴 `false` FALLS THROUGH TO THE FETCH, it does not return (review D4). The spec's
				// answer to「over the beacon quota」is a `false` return, not a throw — so returning it
				// here meant the fallback below covered the one case that hardly happens and missed
				// the exact case its own comment was written for.
				if (nav.sendBeacon(url, new BlobCtor([json], { type: 'application/json' })) === true) {
					return true;
				}
			}
		} catch {
			// A beacon that throws (a browser that counts it against a quota, say) falls through
			// to the fetch below rather than losing the session.
		}
	}
	const f = pick('fetch', typeof fetch === 'undefined' ? null : fetch);
	if (!f) return false;
	try {
		return f(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: json,
			keepalive: true
		}).then((res) => !!res && res.ok === true, () => false);
	} catch {
		return false;
	}
}

/**
 * The buffer itself, as a thing that can be tested without a DOM.
 *
 * Every side effect it has is an injected function — storage, the clock, the id source, the
 * transport, the claim probe — because the behaviour worth pinning here (the caps, flush-once,
 * never-when-unclaimed, escalation clears) is arithmetic, and arithmetic that can only be
 * exercised through a browser is arithmetic nobody exercises.
 */
export function createAiLog(opts) {
	const {
		tenant,
		kind,
		id,
		storage,
		now = () => Date.now(),
		newId,
		send,
		probeClaim,
		enabled = true
	} = opts;
	const key = aiLogKey(tenant);

	/**
	 * Storage took a write and then refused a later one — a full quota, not a disabled store.
	 *
	 * 🩸 THE HALF-WRITTEN CASE IS THE BAD ONE (review D7). `write()` swallowed the failure and
	 * said so in a comment:「this browser just will not be able to tell the owner about them」.
	 * That was not what happened. Every method re-reads storage, so what came back after a failed
	 * write was the state from BEFORE the newest question — three questions asked, one recorded,
	 * and the owner shown a visitor who asked once, which looks exactly like a visitor who did.
	 * A quiet PARTIAL record is worse than none. So a store that stops accepting writes stops
	 * being read as well: the session continues in memory, bounded by the same caps as ever, and
	 * what it cannot do is outlive this document or be seen by another tab — which is the thing
	 * the comment should have said all along.
	 */
	let readOnly = false;
	function read() {
		if (!storage || readOnly) return null;
		try {
			const raw = storage.getItem(key);
			return raw ? parseAiLog(JSON.parse(raw)) : null;
		} catch {
			return null;
		}
	}
	function write(state) {
		if (!storage) return;
		try {
			storage.setItem(key, JSON.stringify(state));
			readOnly = false;
		} catch {
			readOnly = true;
		}
	}
	function fresh(at, carry) {
		return {
			sid: newId(),
			started: at,
			last: at,
			pages: [],
			questions: [],
			sent: 0,
			handle: null,
			// 🔴 THE CLAIM ANSWER OUTLIVES THE SESSION, deliberately. It is a fact about the
			// SITE, not about this visit, so a second session ten minutes later must not cost
			// another probe — and a `false` must not be forgotten, since forgetting it is how a
			// KAITO-only tenant starts receiving requests again.
			claim: carry ? carry.claim : null,
			claimAt: carry ? carry.claimAt : 0,
			// The backoff outlives the session for the same reason the answer does: it says how
			// recently this browser bothered the endpoint, which is not a fact about this visit.
			probedAt: carry ? carry.probedAt : 0
		};
	}
	let state = null;
	let probing = false;

	/**
	 * Put back what a send turned out not to have delivered.
	 *
	 * 🔴 ONLY IF IT IS STILL THE SAME SESSION. A late「no」about `sid-1` must not lower the sent
	 * mark of `sid-2` — the questions it is talking about are not in this buffer any more, and
	 * re-sending a session that already went is what the server's idempotency is for anyway.
	 */
	function unsend(sid, sent) {
		const held = read() ?? state;
		if (!held || held.sid !== sid) return;
		held.sent = Math.min(held.sent, sent);
		state = held;
		write(state);
	}

	/**
	 * The live session, starting a new one when the old one has gone cold.
	 *
	 * 🩸 `read() ?? state`, NOT `read()` ALONE. Storage is re-read on every call so a second tab
	 * cannot drift, and it is the source of truth the moment there IS one — but a session that
	 * has been minted and not yet written (this coral mints one at mount and writes at the first
	 * `page()`) is not in storage yet, and treating that as「no session」made every mount mint an
	 * id, throw it away and mint a second one. The symptom was not an error: it was a page
	 * sequence that reset itself, i.e. exactly the thing the row exists to record.
	 */
	function current(at) {
		const held = read() ?? state;
		if (!held) return fresh(at, null);
		if (at - held.last > AI_LOG_IDLE_MS) return fresh(at, held);
		return held;
	}

	if (enabled) state = current(now());

	/**
	 * 🔴 AN UNCLAIMED ANSWER DROPS WHAT IS ALREADY HELD, rather than merely refusing to send it.
	 * Keeping a KAITO-only site's visitors' questions in their browsers against the day somebody
	 * claims the inbox would make the claim retroactive, and nobody asked those questions of a
	 * person.
	 */
	function dropBuffer(held) {
		held.questions = [];
		held.pages = [];
		held.sent = 0;
	}

	/**
	 * Whether「this site has no Inbox」is still in force.
	 *
	 * 🔴 AN EXPIRED NO IS NOT A NO. Past the TTL the answer is due to be asked again, and until
	 * somebody answers it this browser is in the same「we do not know」state as a throttled probe
	 * (review D2) — so the questions asked in that window are HELD, not dropped, and the next
	 * answer decides what becomes of them.
	 *
	 * The age is measured from `claimAt`, which is stamped by an ANSWER and by nothing else
	 * (review E1) — otherwise the expiry this guards is one a failed probe keeps postponing.
	 */
	function unclaimedStands() {
		return !!state && state.claim === false && now() - state.claimAt < AI_LOG_CLAIM_TTL_MS;
	}

	/**
	 * Ask whether this tenant has an inbox at all — once per TTL for an answer, once per the
	 * shorter backoff for a non-answer.
	 *
	 * 🩸 THE TWO ARE NOT THE SAME EVENT (review D2/D8). The old gate cached whatever came back
	 * for six hours and, when nothing came back, re-asked on every single question. `claimed`
	 * false is a fact about the site and is worth six hours; a throttle, a dropped connection or
	 * a shape we could not read is worth a retry and nothing else — it may never be written down
	 * as a no, because a no here also empties this visitor's buffer.
	 *
	 * 🩸 AND「WHEN WE ASKED」IS NOT「WHEN WE LEARNED」(review E1). D2 stamped `claimAt` on every
	 * reply so the backoff had something to measure from, and D10 read `claimAt` to decide how old
	 * the cached answer was — so a throttled probe, which brings back NOTHING, re-dated the answer
	 * it failed to refresh. A site whose owner opened the Inbox after a `false` never saw that
	 * `false` expire: the review ran seventy-two hours of hourly questions past it and watched
	 * sixty of them destroyed, with every test green. Two quantities, two fields, two gates.
	 */
	function ensureClaim() {
		if (!state || probing || !probeClaim) return;
		// 🩸 EVERY TIME, NOT ONLY WHEN THE ANSWER ARRIVES (review D10). The first `false` emptied
		// the buffer and then the six-hour cache took the early return below, so every question
		// asked in those six hours went on accumulating in this visitor's browser — never sent,
		// but HELD, which is the one thing the README promises does not happen to a site with no
		// Inbox. Nothing left, so nothing broke; it was just untrue.
		if (unclaimedStands() && (state.questions.length || state.pages.length)) {
			dropBuffer(state);
			write(state);
		}
		// An answer we still hold is not due to be asked again — six hours from the moment we
		// LEARNED it, never from the last time somebody failed to tell us.
		if (state.claim !== null && state.claimAt && now() - state.claimAt < AI_LOG_CLAIM_TTL_MS) return;
		// And whatever the state of the answer, a probe costs one request per backoff and no more.
		if (state.probedAt && now() - state.probedAt < AI_LOG_CLAIM_RETRY_MS) return;
		probing = true;
		const settle = (claimed) => {
			probing = false;
			if (!state) return;
			// Every reply costs one probe and no more, including「we do not know」— that is what
			// the backoff is measured from, and what the manifest's sentence was untrue about.
			state.probedAt = now();
			// 🔴 ONLY AN ANSWER RE-DATES THE ANSWER (review E1). A throttled probe learned nothing,
			// so the six hours go on running from the reply that did.
			if (typeof claimed === 'boolean') {
				state.claimAt = now();
				state.claim = claimed;
				if (!claimed) dropBuffer(state);
			}
			write(state);
		};
		void Promise.resolve()
			.then(() => probeClaim())
			.then(settle)
			.catch(() => settle(null));
	}

	return {
		/** Whether this mount is logging at all — `data-ai-log="0"` turns everything below off. */
		enabled: () => !!state,
		/** For tests and for the mount's own reads. Never a live reference. */
		state: () => (state ? JSON.parse(JSON.stringify(state)) : null),

		/** This page view, recorded at mount. Costs no request and reaches no network. */
		page(path) {
			if (!state) return;
			const at = now();
			state = current(at);
			state.last = at;
			// 🔴 A SITE WITH NO INBOX ACCUMULATES NOTHING — not the questions (see `ensureClaim`)
			// and not the page sequence either. The answer is already known here, so this costs
			// no request; what it stops is the buffer quietly refilling between questions.
			if (unclaimedStands()) dropBuffer(state);
			else state.pages = appendAiPage(state.pages, path);
			write(state);
		},

		/**
		 * One question, asked and answered by the machine.
		 *
		 * 🔴 THE ANSWER IS NOT AN ARGUMENT HERE and cannot become one. What travels is the
		 * question, the page, whether a passage was cited (and which), the language and the
		 * time — the same line `kaito_exchanges` already holds on the server. `hit` is the
		 * only argument that could hold the answer instead, and `aiHit` refuses anything
		 * that is not an http(s) URL, so passing `answer.text` here sends `null`.
		 */
		question(text, page, hit, lang) {
			if (!state) return;
			const at = now();
			state = current(at);
			const merged = [...state.questions, { text, page, hit: hit || null, lang, at }];
			const capped = capAiQuestions(merged);
			// 🔴 `sent` COUNTS FROM THE FRONT, so when the cap drops the oldest it has to come
			// down by exactly as many. Clamping it to the new LENGTH instead — which is what the
			// first draft did — makes a 21st question look already-flushed the moment the buffer
			// is full, i.e. the one shape where a hostile client and an ordinary chatty visitor
			// both silently lose the question they actually escalated on.
			const dropped = merged.length - capped.length;
			state.questions = capped;
			state.sent = Math.max(0, state.sent - dropped);
			state.last = at;
			write(state);
			ensureClaim();
		},

		/**
		 * Send what is unsent, or nothing.
		 *
		 * Returns the payload that went, or `null` — which is the ordinary case, and the
		 * reason the second `pagehide` of a page view costs nothing.
		 *
		 * 🔴 WHAT ENDS A RETRY, SPELLED OUT (review E4), because the contract delta named the wrong
		 * thing and reef would have implemented that one: a tenant whose endpoint keeps saying no
		 * is retried on EVERY `pagehide` that has something unsent, and what stops it is a 2xx or
		 * the thirty-minute idle rotation in `page()` — which ends the session and takes the unsent
		 * questions with it. The claim cache takes no part in that decision: the gate below reads
		 * `claim`, never its age, and `ensureClaim()` is reached from `question()` alone, so a
		 * visitor who has stopped asking and is only browsing never probes again at all.
		 */
		flush() {
			if (!state || !send) return null;
			// 🩸 THE ONE METHOD THAT DID NOT RE-READ ITS OWN STORAGE — and the only one that puts
			// anything on the network (review D6). `page()`, `question()` and `escalated()` all
			// begin at `current(at)`; this one used a `state` frozen at the mount of ITS tab, so a
			// visitor with two tabs open sent, from the second one, a SHORTER body under the same
			// `session_id` — and whether that truncates the row is decided on the far side of a
			// boundary this file cannot see. It knew there was fresher state and sent the older.
			//
			// 🔴 THE SAME SESSION ONLY, NOT `current()`. `current()` would rotate a session that
			// has gone idle and take the unsent questions with it; what is wanted here is the
			// freshest copy of the session this tab is holding, never a decision about whether
			// that session is over.
			const held = read();
			if (held && held.sid === state.sid) state = held;
			// 🔴 UNKNOWN IS NOT PERMISSION. A probe that never came back leaves `claim` null,
			// and null must behave exactly like `false` here: the questions stay in this
			// browser and go on the next page view, once we actually know.
			if (state.claim !== true) return null;
			if (state.questions.length <= state.sent) return null;
			const payload = aiSessionPayload(kind, id, state);
			const outcome = send(payload);
			// A refusal is not a send: nothing moves, and the next `pagehide` tries again.
			if (!outcome) return null;
			const sid = state.sid;
			const before = state.sent;
			state.sent = state.questions.length;
			write(state);
			if (typeof outcome.then === 'function') {
				// 🔴 QUEUED NOW, UNSENT IF THE SERVER SAYS NO. The fetch path can still be answered
				// while this document is alive (a bfcache restore, an escalation on the same page),
				// and a definite no has to put the questions back rather than leave them marked told.
				// A `pagehide` that really is the end of the document never sees this — which is
				// exactly why the server side is idempotent on `session_id`.
				void outcome.then((ok) => { if (ok !== true) unsend(sid, before); }, () => unsend(sid, before));
			}
			return payload;
		},

		/**
		 * The visitor pressed for a person, and the server minted a conversation.
		 *
		 * 🔴 THE PRESS PROVES THE CLAIM. A conversation id only exists because `/api/inbox`
		 * accepted a message, and it only accepts one for a claimed tenant — so this is the
		 * one place claim state is learned without asking anybody.
		 *
		 * Flushes immediately (this session is now attached to a real conversation, and the
		 * owner is about to open it) and CLEARS — but only once the send has been ANSWERED.
		 *
		 * 🩸 IT USED TO CLEAR EITHER WAY (review D1). `went` was computed, returned, and never
		 * consulted about whether to reset, so a transport that said no destroyed the whole
		 * conversation's questions in the browser — including the one the visitor escalated on,
		 * the single most valuable row this file exists to carry — and returned `null`, so the
		 * caller could not tell it had happened either. This is the one send that happens with
		 * the document alive, so it can wait for the server's own answer rather than the
		 * transport's; anything short of a 2xx leaves the buffer exactly where it was, and the
		 * next `pagehide` carries it under the same idempotency key.
		 */
		async escalated(conv) {
			if (!state) return null;
			const at = now();
			state = current(at);
			state.handle = aiHandle(conv);
			state.claim = true;
			state.claimAt = at;
			state.last = at;
			// The handle and the claim answer are facts already — a failed send must not cost
			// them, so they are written before the network is asked anything.
			write(state);
			const payload = state.questions.length > state.sent && send ? aiSessionPayload(kind, id, state) : null;
			if (!payload) return null;
			let went = false;
			try {
				went = (await send(payload, { confirm: true })) === true;
			} catch {
				went = false;
			}
			if (!went) return null;
			// 🩸 A QUESTION ASKED DURING THE ROUND TRIP WAS NOT IN THIS SEND (review E5). The report
			// argued the window was shut because the panel changes after the press — it changes to
			// a panel with an「ask <assistant> again」button on it, one click from the compose box,
			// while this `await` is still in flight. It is a narrow window (one fetch, three
			// actions) and the review agreed it is narrow; what it is not is closed, and the fix is
			// cheaper than the bet: clear only what this send actually carried.
			const held = read();
			if (held && held.sid === state.sid) state = held;
			const carried = payload.questions.length;
			const newest = payload.questions[carried - 1];
			const rows = state.questions;
			const last = rows[rows.length - 1];
			// Longer, or ending on a row this send did not carry — the second case is the buffer at
			// its cap, where a new question drops the oldest and the length never changes.
			if (rows.length > carried || !last || last.at !== newest.at || last.text !== newest.text) {
				state.sent = Math.max(0, Math.min(carried, rows.length - 1));
				// The session is NOT rotated: the question that arrived belongs to the conversation
				// this handle just opened, and the next `pagehide` carries it under the same
				// idempotency key — a repeat the endpoint is built for, unlike a lost question.
			} else {
				state = fresh(now(), state);
			}
			write(state);
			return payload;
		}
	};
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
 * The second half of the cap, and the reason there are two (review B7, 2026-09-08).
 *
 * 🩸 COUNTING GRAPHEMES REMOVED THE LENGTH LIMIT. `.slice(0, 40)` counted UTF-16 units, so it was
 * a hard ceiling as well as a cap; counting clusters is right for「40 characters」 as a person
 * means it, but a cluster has no upper bound — `('a' + '́'.repeat(500)).repeat(40)` is
 * exactly 40 clusters and 20,040 units, and the measured result was that it passed through
 * untouched into the status line and the second-action button as a page-high wall of Zalgo.
 *
 * So the cluster cap says how many characters, and this says how much text. 200 units is five
 * times the cluster cap — far past any real name in any script, including a fully-decomposed one,
 * and still a bound. The truncation lands on a cluster boundary either way, never mid-sequence.
 */
const ASSISTANT_NAME_MAX_UNITS = 200;

/**
 * Bidi/format controls (issue #17, pre-existing, found by the review of #12 R2/R3 P3): an
 * embedding override or isolate reaching the status text node is unisolated there, so a name
 * carrying U+202E could flip the reading direction of everything AFTER it in the same sentence.
 * Every code point that can do that — the five embedding/override controls, the four isolates,
 * ALM, and the two marks — is stripped at the same intake point `AI_CHIP_TOKEN` already goes
 * through, so nothing downstream (`statusFor`, the second-action label) has to defend itself.
 *
 * 🔴 `\u` ESCAPES, NEVER THE LITERAL CHARACTERS. These are exactly the code points behind
 * "Trojan Source" (CVE-2021-42574): a bidi override sitting as literal source bytes can make an
 * editor or a diff RENDER this file's own code in an order that does not match how it executes.
 * Spelling them out defeats the one thing this constant exists to strip.
 */
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069\u061C\u200E\u200F]/g;

/**
 * The characters `AI_CHIP_TOKEN` cannot exist without — the U+2063 either side of it — derived
 * FROM the token rather than retyped, so a sentinel that ever changes its wrapper is covered by
 * this the day it changes. ASCII is deliberately excluded: "AI_CHIP" as letters is a legal thing
 * for an owner to call their assistant; it is the invisible wrapper that makes `statusFor`'s
 * `split` see a marker.
 *
 * 🔴 THIS IS WHAT MAKES THE STRIP STRUCTURAL — review B1, round 2, and the reason the old
 * 「convergent order」claim was not true (see `cleanAssistantName`). Removing the token as a
 * STRING can hand back the very thing it removed: `T.slice(0, 3) + T + T.slice(3)` is one whole
 * token with its own prefix in front and its matching suffix behind, so deleting that one
 * occurrence joins the two remnants into a complete new token. Deleting the characters instead
 * has no fixed point to miss — afterwards there is no U+2063 anywhere in the name, and every step
 * that follows only ever deletes characters, so not one of them can put one back.
 *
 * 🔴 `\u{…}` AND THE `u` FLAG, WHICH IS WHAT MAKES 「covered the day it changes」 TRUE (review B14,
 * round 3). The escapes used to be four-digit `\uXXXX` with no flag, and that is a BMP-only
 * spelling: a wrapper of U+1F5A5 came out as `὚5`, which a non-unicode regex reads as
 * `὚` followed by a literal `5` — so the new wrapper was NOT stripped (B1's guarantee off,
 * silently) while U+1F5A and the digit 5 were, and nothing threw. A one-character change to the
 * sentinel would have done that. `\u{…}` with `u` spells any code point, and `[...new Set(token)]`
 * already iterates by code point, so a surrogate pair arrives here whole. Exported only so the
 * derivation can be tested against a stand-in wrapper the sentinel does not currently use — the
 * sentinel itself stays private, as it always has.
 */
export function privateCharsOf(token) {
	return new RegExp(
		`[${[...new Set(token)]
			.filter((ch) => ch.codePointAt(0) > 0x7e)
			.map((ch) => `\\u{${ch.codePointAt(0).toString(16)}}`)
			.join('')}]`,
		'gu'
	);
}

const AI_CHIP_PRIVATE_RE = privateCharsOf(AI_CHIP_TOKEN);

/**
 * How much of an incoming name is examined at all, and B7's sibling: the fixed-point loop in
 * `cleanAssistantName` is the one pass there that can run more than once, and a deeply nested
 * payload could otherwise make it quadratic in the length of an attribute nobody bounded. The
 * result is capped at `ASSISTANT_NAME_MAX_UNITS` regardless, so twenty times that is far past any
 * real name in any script and still a ceiling on the work a one-megabyte attribute can ask for.
 */
const RAW_NAME_MAX_UNITS = ASSISTANT_NAME_MAX_UNITS * 20;

/**
 * A ZERO WIDTH JOINER left dangling at the end of a truncated name (review B8) — the one format
 * character `BIDI_CONTROL_RE` deliberately does not carry, because U+200D inside a name is
 * meaningful (it is what holds an emoji sequence together) and only a TRAILING one is debris.
 * Cutting a three-person family emoji straight after its first joiner leaves one figure and a
 * joiner with nothing left to join, sitting in the DOM.
 *
 * 🔴 STRIPPED TO A FIXED POINT WITH `trim()`, NOT BEFORE IT (review B13, round 3). The claim used
 * to be 「trimmed after every cut that could produce one has already been made」 and the `.trim()`
 * on the same line was itself such a cut: taking a trailing joiner off 「小美 ZWJ SP ZWJ」 uncovers
 * the space, trimming the space uncovers the joiner before it, and one pass in one order stopped
 * there with the joiner still in the DOM. Each step only ever deletes, so alternating them
 * converges — see the end of `cleanAssistantName`.
 */
const TRAILING_JOINER_RE = /\u200D+$/;

/**
 * The three Unicode questions `fallbackGraphemes` below asks:
 *   EXTENDS — does this code point continue the cluster before it (combining marks, variation
 *             selectors, the enclosing keycap, the Fitzpatrick skin-tone modifiers)?
 *   PIC_END / PIC_START — is a ZERO WIDTH JOINER sitting between two PICTOGRAPHS? That is the
 *             one place a joiner actually welds two clusters into one (UAX #29 GB11), which is
 *             how 「👨‍👩‍👧」 and 「🏳️‍🌈」 count once each. A joiner between anything else does
 *             not, so `a` + ZWJ + `👩` stays two clusters exactly as `Intl.Segmenter` says.
 *
 * 🔴 Built with `new RegExp` inside a `try`, never as regex LITERALS. Unicode property escapes
 * are younger than some of the engines that reach the fallback at all, and a literal an engine
 * cannot parse is a SyntaxError for the WHOLE MODULE — the bubble would not render, to make a
 * name one cluster tidier. `null` means the fallback degrades to counting code points, which is
 * exactly what it did before this.
 */
const [GRAPHEME_EXTEND_RE, PICTOGRAPH_END_RE, PICTOGRAPH_START_RE] = (() => {
	try {
		return [
			new RegExp('^(?:\\p{Grapheme_Extend}|\\p{Emoji_Modifier})$', 'u'),
			new RegExp('\\p{Extended_Pictographic}(?:\\p{Grapheme_Extend}|\\p{Emoji_Modifier})*$', 'u'),
			new RegExp('^\\p{Extended_Pictographic}', 'u')
		];
	} catch {
		return [null, null, null];
	}
})();

/** U+200D, spelled as an escape for the same reason `BIDI_CONTROL_RE` is — see its comment. */
const ZWJ = '\u200D';

const REGIONAL_INDICATOR_LO = 0x1f1e6;
const REGIONAL_INDICATOR_HI = 0x1f1ff;

/**
 * The `Intl.Segmenter`-free path, and 🔴 it now AGREES with the Segmenter path rather than
 * merely avoiding lone surrogates (review B8).
 *
 * 🩸 `Array.from` alone counts CODE POINTS, so the same name was two different names depending
 * on the browser: a three-person ZWJ family ×45 capped to 40 whole families with a Segmenter and
 * to 8 without one, and Firefox only shipped `Intl.Segmenter` in 125 — this is a live split, not
 * a museum piece. Worse, the cut landed anywhere inside a sequence, which is where the dangling
 * joiner `TRAILING_JOINER_RE` above exists to clean up came from.
 *
 * Three joining rules: an extending code point glues to what precedes it, two regional
 * indicators pair up into one flag, and a joiner welds two pictographs. That is enough to agree
 * with `Intl.Segmenter` cluster-for-cluster on every sequence the review measured plus the ones
 * the tests add (families, flags, keycaps, skin tones, rainbow/kiss ZWJ sequences, Hangul,
 * combining stacks) — which is what the test asserts, against the real Segmenter, rather than
 * against a table written here.
 *
 * 🔴 IT IS NOT A UAX #29 IMPLEMENTATION and must not be described as one. Indic conjuncts
 * (virama sequences) still count as more clusters here than a Segmenter says, so a Devanagari
 * name is capped shorter on an engine without one. That is a display-length difference on a
 * label, in the same direction the old code already erred, and buying the rest of UAX #29 to
 * close it would put a segmentation table in a widget that has to stay small.
 */
function fallbackGraphemes(str) {
	const out = [];
	let joinNext = false;
	let riOpen = false;
	for (const cp of str) {
		const code = cp.codePointAt(0);
		const isRI = code >= REGIONAL_INDICATOR_LO && code <= REGIONAL_INDICATOR_HI;
		const pairsWithPrevious = isRI && riOpen;
		const previous = out.length ? out[out.length - 1] : '';
		const extendsPrevious = GRAPHEME_EXTEND_RE ? GRAPHEME_EXTEND_RE.test(cp) : false;
		// GB11: pictograph, joiner, pictograph — the joiner is already part of `previous`, so what
		// is tested for the left-hand pictograph is `previous` with that trailing joiner removed.
		const weldedByJoiner =
			joinNext &&
			!!PICTOGRAPH_START_RE &&
			PICTOGRAPH_START_RE.test(cp) &&
			PICTOGRAPH_END_RE.test(previous.slice(0, -1));
		if (out.length && (weldedByJoiner || extendsPrevious || cp === ZWJ || pairsWithPrevious)) {
			out[out.length - 1] += cp;
		} else {
			out.push(cp);
		}
		joinNext = cp === ZWJ;
		riOpen = isRI && !pairsWithPrevious;
	}
	return out;
}

/**
 * Splits `str` into user-perceived characters — an emoji or a combining sequence counts once —
 * using `Intl.Segmenter` where it exists and `fallbackGraphemes` where it does not. Either is
 * enough to stop the cap producing a lone surrogate (issue #17): a plain `.slice(0, N)` counts
 * UTF-16 units, so a 40-char cap could land inside a surrogate pair and cut an astral character
 * in half.
 */
function graphemes(str) {
	if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
		return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str), (s) => s.segment);
	}
	return fallbackGraphemes(str);
}

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
 * is a format character, not whitespace — so `trim()`, the newline check and the cap all wave it
 * straight through. An owner who set the name to a string containing the token would make
 * `statusFor`'s `split` yield THREE parts, and `[before, after]` drops the third:
 * 「先回，轉出去真人會看」 disappears from the status line and only the chip is left. The
 * AI disclosure itself never breaks (the chip is still there, by construction), but the rest
 * of the sentence does, so the token is stripped where names arrive rather than defended
 * against where they render.
 *
 * 🩸 THE ORDER WAS THE DEFENCE, AND THE ORDER WAS NOT ENOUGH — review B1, twice. 0.7.4 ran the
 * bidi strip AFTER the token strip, so a control character the token strip could not see and the
 * bidi strip then deleted smuggled a token in and reassembled it:
 *
 *   data-assistant-name = "\u2063A\u202EI_CHIP\u2063"   (\u202E written as an escape, never
 *      as a literal byte — see BIDI_CONTROL_RE)
 *     → split(AI_CHIP_TOKEN) sees no token (the U+202E is in the middle of it) and passes it on
 *     → replace(BIDI_CONTROL_RE) deletes the U+202E and hands back a COMPLETE AI_CHIP_TOKEN
 *     → `statusFor` splits into three, drops the third, and the whole sentence is gone
 *
 * Every one of the twelve stripped controls worked as the smuggling character, at any position.
 * 0.7.5 put the deletes first and called the resulting order convergent. It was not, and round 2
 * of the review supplied the eighteen characters that show why — with T for the token:
 *
 *   T.slice(0, 3) + T + T.slice(3)
 *     → ONE split(T).join('') removes the middle T, and the two remnants left either side of the
 *       hole are exactly T's own first three characters and its own last nine: T again
 *     → so the LAST step in the chain handed the DOM the token it exists to remove
 *
 * Nothing had to invent a U+2063 for that; the string arrived carrying the pieces. The fix is to
 * stop making「is the token here」a question about a string at all. The token comes out to a
 * FIXED POINT (which is what the nested payload defeats in a single pass), and then, whatever is
 * left in whatever arrangement, every character `AI_CHIP_TOKEN` cannot exist without goes — see
 * `AI_CHIP_PRIVATE_RE`. From that line to the `return` nothing does anything but delete, so the
 * name that comes back provably carries no sentinel character and has nothing to reassemble from.
 */
function cleanAssistantName(raw) {
	// 1. Bound the input before the one pass below that can repeat (see RAW_NAME_MAX_UNITS), and
	//    cut on a code point boundary so it cannot leave half a surrogate pair behind.
	let name = String(raw || '');
	if (name.length > RAW_NAME_MAX_UNITS) {
		name = name.slice(0, RAW_NAME_MAX_UNITS).replace(/[\uD800-\uDBFF]$/, '');
	}
	// 2. Format controls out — nothing downstream can be tricked by what is no longer here.
	name = name.replace(BIDI_CONTROL_RE, '');
	// 3. The token as a string, to a fixed point. This is the courtesy half: it is what makes a
	//    name that is NOTHING BUT the sentinel come out empty, and so fall back to KAITO, rather
	//    than leaving the bare letters behind as somebody's name. It is not the guarantee.
	let previous;
	do {
		previous = name;
		name = name.split(AI_CHIP_TOKEN).join('');
	} while (name !== previous);
	// 4. 🔴 THE GUARANTEE, and the whole of round 2's B1: every character the sentinel cannot
	//    exist without, gone, whatever step 3 left and however it was arranged. No line below
	//    this one adds a character to the name.
	name = name.replace(AI_CHIP_PRIVATE_RE, '');
	// 5. One line, trimmed.
	const trimmed = name.trim().split('\n')[0].trim();
	if (!trimmed) return '';
	// 6. Both halves of the cap, on the same pass and always on a cluster boundary: at most
	//    ASSISTANT_NAME_MAX clusters, and at most ASSISTANT_NAME_MAX_UNITS UTF-16 units (B7 — a
	//    single cluster can be 500 units on its own, and one that does not fit stops the name
	//    rather than being cut in half).
	let capped = '';
	let count = 0;
	for (const cluster of graphemes(trimmed)) {
		if (count >= ASSISTANT_NAME_MAX || capped.length + cluster.length > ASSISTANT_NAME_MAX_UNITS) break;
		capped += cluster;
		count++;
	}
	// 7. The joiner a cut in step 6 may have left dangling (B8), and the whitespace stripping it
	//    exposes, and the joiner stripping THAT exposes — to a fixed point (review B13, round 3).
	//    `replace(...).trim()` ran once and in that order, so 「小美 ZWJ SP ZWJ」 came back as
	//    「小美 ZWJ」: the replace took the last joiner, the trim then took the space that had been
	//    hiding the one before it, and nothing looked again. Deletes only — see step 4 — so this
	//    loop is bounded by the length of a name already capped at ASSISTANT_NAME_MAX_UNITS.
	let tail = capped;
	let before;
	do {
		before = tail;
		tail = tail.trim().replace(TRAILING_JOINER_RE, '');
	} while (tail !== before);
	return tail;
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
 * Does this tenant have an Inbox — i.e. is there a person at the other end at all?
 *
 * 🔴 THE ONLY QUESTION THIS ASKS, and it is asked LAZILY: not at mount, but the first time a
 * visitor actually types a question, and then at most once per `AI_LOG_CLAIM_TTL_MS` per
 * browser once it has an answer — once per `AI_LOG_CLAIM_RETRY_MS` while it does not. A probe
 * at mount would put a request on every page view of every site carrying this coral to answer
 * a question that matters only for the small share of visits where somebody asks something.
 *
 * `null` (a network failure, a shape we cannot read, a 429, the contract's own `throttled`) is
 * NOT `false` — it is「we do not know」, and `createAiLog`'s flush treats not-knowing exactly
 * like a no while refusing to write it down as one.
 */
export async function probeInboxClaim(apiBase, kind, id) {
	try {
		const res = await fetch(
			`${apiBase}/api/inbox/session?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
			{ headers: { accept: 'application/json' } }
		);
		if (!res.ok) return null;
		const body = await res.json();
		// 🔴 `throttled` IS THE SERVER SAYING「WE DO NOT KNOW」, and it arrives dressed as a no
		// (contract §一.1: over the read rate limit the endpoint answers 200 `claimed:false,
		// throttled:true` rather than 429, because a coral that cannot ask must not write). Reading
		// that field is the entire reason it exists: without it a rate-limited probe — the ordinary
		// case on a busy site, since the probe shares the `read` bucket with a 15-second transcript
		// poll — is indistinguishable from「this site has no Inbox」, which drops this browser's
		// buffer and poisons the answer for six hours (review D2).
		if (body?.throttled === true) return null;
		return typeof body?.claimed === 'boolean' ? body.claimed : null;
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

/**
 * The poller's identity, so that stopping it stops the requests it already made (review B2).
 *
 * 🩸 `clearInterval` STOPS THE TIMER, NOT THE FETCH THAT IS ALREADY IN THE AIR. `refresh()` read
 * `conv` once on the way in and then wrote whatever came back straight into the panel, with no
 * second look at whether it was still the same panel. So: a visitor is mid-poll on conversation
 * A; a hand-off arrives; the poller is torn down, `conv` becomes B, the log is emptied and
 * redrawn; then A's fetch resolves and paints A's messages into B's log — `.dc-inbox-log` is the
 * class both views use, so the stale reply lands in the new conversation's window looking exactly
 * like part of it. If the new handle resolved to ask mode it is worse: 「問 KAITO」 shows a human
 * transcript. The same race existed on 「重新問」 before this branch, but only a visitor's own
 * click could open the window; #15 let any script open it at will, as often as it liked.
 *
 * 🔴 A GENERATION, NOT AN AbortController. Aborting cancels the request; this has to cancel the
 * RESULT, including a response that already arrived and is sitting in a resolved promise, and it
 * has to do it for every in-flight call at once rather than one handle at a time. Exported and
 * dependency-free so the race itself is testable with a delayed fetch and no browser.
 */
export function pollGeneration() {
	let current = 0;
	return {
		/** Everything in flight is now stale; results still to come are dropped. */
		invalidate() {
			current += 1;
		},
		/**
		 * Await `work`, then hand the result to `apply` — unless `invalidate()` ran while it was in
		 * flight, in which case `apply` is never called. Resolves to whatever `apply` returned, or
		 * `false` for a result that was thrown away. A rejected `work` is a `null` result, not a
		 * throw: the caller's failure handling is the same either way and this must never reach an
		 * unhandled rejection from a background timer.
		 */
		async run(work, apply) {
			const token = current;
			const got = await work().catch(() => null);
			if (token !== current) return false;
			return apply(got);
		}
	};
}

/**
 * #13: should a page LOAD, by itself, open the panel? Pure so mount()'s one-line call is the only
 * place this reads `location.hash`, and this file's tests can drive it without a browser.
 *
 * Exactly `#inbox`, not a prefix or substring test — a page's own anchor (`#inbox-pricing`, a
 * heading id that happens to start the same way) must not trip a widget its author never asked
 * for.
 *
 * 🔴 AND THE SITE HAS TO HAVE ASKED FOR IT — `data-open-on-hash="1"`, review B5. The original
 * reasoning here was that 「a site that wants this deliberately writes the literal fragment, the
 * same way data-kind is a deliberate attribute」, and that was simply wrong about who writes a
 * URL fragment: `location.hash` comes from whoever authored the LINK. Any external page, email,
 * QR code or search result could point at `https://customer.example/anything#inbox` and make a
 * customer's site pop a message panel open and pull the cursor into it, on any page, for every
 * visitor, with no way for the owner to turn it off. It is also a WCAG 3.2.1/3.2.5 change of
 * context nobody requested, on a `role="dialog"` with no Escape binding.
 *
 * An attribute is a different thing entirely: it is in the site's own markup, so the deliberate
 * act belongs to the person whose site it is. It also settles the other half of the same
 * problem — a docs page with an `<h2 id="inbox">`, or a hash-router SPA whose `#inbox` route is
 * its own, no longer trips a widget by coincidence.
 */
export function shouldAutoOpenFromHash(hash, optedIn) {
	if (optedIn !== '1') return false;
	return hash === '#inbox';
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
	 * The one writer, so every path that changes what this panel is showing stamps storage the same
	 * way — `saveHandle`'s own `ts` default, meaning「the visitor just used this thread」. Nothing
	 * in `mount()` calls `saveHandle` direct.
	 */
	function storeHandle(convId, email, mode) {
		saveHandle(tenant, convId, email, mode);
	}
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
	 * The deferred question log (ruling 54). Built here, wired in exactly three places below —
	 * this page view, each answered question, and the escalation — plus the one `pagehide`
	 * listener at the bottom of `mount`.
	 *
	 * 🔴 IT IS HANDED ITS WORLD RATHER THAN REACHING FOR ONE, so the same object the browser
	 * runs is the object `compose.test.mjs` drives with a plain Map and a counter.
	 */
	const aiLog = createAiLog({
		tenant,
		kind,
		id,
		enabled: el.getAttribute('data-ai-log') !== '0',
		storage: (() => {
			try {
				return window.localStorage;
			} catch {
				return null;
			}
		})(),
		newId: () => {
			// 🔴 A SESSION ID IS NOT A CONVERSATION ID. The file header's rule —「the conversation
			// id comes from the server」— is about a bearer token that opens somebody's transcript.
			// This one names a row of questions nobody can read back through any endpoint; it is
			// minted here because the whole point is that the row is assembled before the first
			// request exists.
			try {
				return crypto.randomUUID();
			} catch {
				return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
			}
		},
		send: (payload, opts) => sendAiSession(`${apiBase}/api/inbox/session`, payload, {}, opts),
		probeClaim: () => probeInboxClaim(apiBase, kind, id)
	});
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
		storeHandle(handoffConv, hasEmail, storedMode);
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
		storeHandle(handoffConv, hasEmail, storedMode);
		conv = handoffConv;
		handoffEndedNote = false;
		renderMessages();
	}

	const root = document.createElement('div');
	root.className = `${PREFIX}-root`;
	el.appendChild(root);

	/** See `pollGeneration` — what makes `stopPolling()` reach the requests already in the air. */
	const generation = pollGeneration();

	function stopPolling() {
		// 🔴 UNCONDITIONAL, and before the `poller` check: there can be a `refresh()` in flight with
		// no interval running at all (mount's own first read, `escalate`'s, a poller that gave up),
		// and those are exactly the ones that used to paint a dead conversation into a live panel.
		generation.invalidate();
		if (poller) {
			clearInterval(poller);
			poller = null;
		}
	}

	let pollFailures = 0;

	async function refresh() {
		if (!conv) return;
		const at = conv;
		await generation.run(
			() => fetchTranscript(apiBase, kind, id, conv),
			(got) => {
				// Belt and braces alongside the generation: every path that changes `conv` calls
				// `stopPolling()` today, and this is what keeps the guard true of one that forgets.
				if (conv !== at) return false;
				if (got) {
					pollFailures = 0;
					messages = got.messages;
					conversationStatus = got.status;
					const log = root.querySelector(`.${PREFIX}-log`);
					if (log) renderLog(log, messages);
					return true;
				}
				// Counted, not ignored: a 404 for a conversation the server no longer has
				// and a network that is down look identical from here, and neither is
				// worth asking about forever.
				if (++pollFailures >= POLL_GIVE_UP_AFTER) stopPolling();
				return false;
			}
		);
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
			storeHandle(conv, hasEmail, storedMode);
			// The press is the flush. This session now belongs to a conversation the owner is
			// about to open, so the questions that led to it travel with it rather than waiting
			// for the visitor to close the tab.
			//
			// 🔴 NOT AWAITED, and it settles on its own: the confirmed send is a round trip and the
			// visitor is waiting for the panel to say their message went, not for our bookkeeping.
			// A send the server does not take leaves the buffer alone; the next `pagehide` carries it.
			void aiLog.escalated(conv);
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
				storeHandle(conv, hasEmail, storedMode);
				// Same press, the other door — see `escalate`.
				void aiLog.escalated(conv);
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

			// 🔴 RECORDED HERE, WHERE THE OUTCOME IS KNOWN, AND NOWHERE ELSE. What goes in is the
			// visitor's own sentence, the page they were on, the passage that was cited (or `null`
			// — a refusal, an uncited answer and an engine we could not reach are all「no hit」),
			// and the page's locale. `answer.text` is never passed: the machine's words are the
			// owner's own page quoted back, and §5 keeps them out of every record we hold.
			aiLog.question(
				question,
				aiPagePath(location.href),
				answer && answer.kind === 'grounded' ? answer.source_url : null,
				pageLocale()
			);

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
				storeHandle(conv, hasEmail, storedMode);
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

		// 🔴 STOP FIRST, THEN READ. The old order (read, stop, restart) started a fetch and then
		// invalidated its own generation one line later, so the first read after every re-render
		// would be thrown away — the read that exists so a returning visitor sees the reply
		// waiting for them.
		stopPolling();
		refresh();
		poller = setInterval(refresh, POLL_MS);
	}

	renderClosed();

	/**
	 * Opens the panel exactly as the closed bubble's own click does.
	 *
	 * 🩸 ALREADY OPEN IS NOT NOTHING (review B10). `if (open) return;` is right about not
	 * re-rendering — that would throw away a draft mid-sentence — but it used to return without
	 * doing anything at all, and the use README recommends is a site's footer 「report a problem」
	 * link. A visitor whose panel is already open, scrolled out of view at the other end of the
	 * page, clicked that link and NOTHING happened: an ordinary broken link, as far as they can
	 * tell. Refocusing the compose box is the whole fix — it scrolls the panel into view and puts
	 * the cursor where the visitor was going anyway, without touching what they have typed.
	 */
	function openPanel() {
		if (open) {
			const textarea = root.querySelector('textarea');
			if (textarea && textarea.focus) textarea.focus();
			return;
		}
		open = true;
		renderOpen();
	}

	// #13: a programmatic way in. A site's own "report a problem" footer link can open this panel
	// in place instead of sending the visitor to another page — a `reef-inbox:open` CustomEvent on
	// `window`, or `#inbox` in the URL the visitor already landed on. Both are wired only here,
	// inside a successful `mount()`, so either is inert wherever the coral is not mounted: there is
	// no listener and no hash check running for an element that failed the `data-kind`/`data-id`
	// guard at the top of this function. `openPanel` reaches `renderOpen()`, which every existing
	// path into the panel already funnels through — the ask/compose textarea's own `.focus()` call
	// (`renderAsk`/`renderMessages`) fires the same way it does for a click, with no new code path
	// to keep in sync.
	//
	// 🔴 ONE OF THE TWO `window` LISTENERS THIS FILE INSTALLS (the other is ruling 54's `pagehide`,
	// at the bottom of `mount`), and it is never removed because `mount()`
	// has no teardown to remove it from (review B9, still open). What that costs is bounded and
	// worth naming rather than implying otherwise: an SPA that tears the container out leaves this
	// listener holding `root` and `el`, and `openPanel` on a detached root re-renders into a node
	// nobody can see. `mountAll`'s `data-dynamic-coral-mounted` guard stops the same element being
	// mounted twice, so a page accumulates one listener per element it ever mounted, not per
	// re-render. `reef-inbox:open` is a BROADCAST on purpose —「open the panel」 is a request any
	// script may honestly make of every panel on the page, and it names no conversation, which is
	// the whole difference between it and the hand-off event 0.7.5 removed (review B3).
	window.addEventListener('reef-inbox:open', openPanel);
	if (shouldAutoOpenFromHash(location.hash, el.getAttribute('data-open-on-hash'))) openPanel();

	// ── the deferred write's two lines (ruling 54) ─────────────────────────────────────────
	//
	// This page view, recorded locally — no request, no cookie, nothing leaves. It is what makes
	// the row's page SEQUENCE a sequence rather than a single entry, and it is why the buffer is
	// in `localStorage` rather than scoped to this document.
	aiLog.page(aiPagePath(location.href));

	// 🔴 `pagehide`, NOT `beforeunload` OR `unload`. Both of the others are ignored or actively
	// penalised on mobile Safari (a page that registers `unload` is excluded from the back/forward
	// cache), and neither fires when an app is backgrounded and later discarded — which is exactly
	// how a phone visit ends. `pagehide` is the one that fires in all of those.
	//
	// 🔴 AND IT IS THE SAME LISTENER WHETHER OR NOT THERE IS ANYTHING TO SEND. `flush()` answers
	// `null` for a session with no unsent questions, for an unclaimed tenant and for a tenant whose
	// claim state we could not learn — so the ordinary page view, the one where nobody asked
	// anything, reaches the network exactly as often as it did before this existed: never.
	if (aiLog.enabled()) window.addEventListener('pagehide', () => aiLog.flush());

	// One read at mount so a returning visitor sees the reply waiting for them behind the closed
	// bubble — without opening a panel nobody asked for.
	//
	// 🔴 AFTER THE LISTENER, NOT BEFORE (review B5). This is a network round trip, and everything
	// below it used to be everything above: on a slow connection a site's own `DOMContentLoaded`
	// handler could dispatch `reef-inbox:open` seconds before there was a listener for it, and the
	// event went nowhere — an intermittent failure nobody would ever debug. `#inbox` had the same
	// problem from the other side: it stole focus a round trip late, by which time the visitor may
	// have started typing in the site's own search box. Registering first costs nothing; every
	// handler only runs once the panel exists, and `renderClosed()` above already built it.
	//
	// `!open` because an auto-opened panel has already started its own read through
	// `renderMessages()`, and a second one would be two requests for one paint.
	if (conv && !open) await refresh();

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
